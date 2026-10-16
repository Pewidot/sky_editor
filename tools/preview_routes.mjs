// On-demand native launch recipes. No filename-only chapter guesses, game
// installation, save migration, or emulator launch happens in this module.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import {
  buildFastbootTitle,
  PROFILE as TITLE_PROFILE,
  resolveResidentLoadString,
} from './native_fastboot_title.mjs';
import { buildDemoFiles } from './native_demo.mjs';
import { ARENA_ARCHIVE_SHA256 } from './native_demo_builder.mjs';
import { buildAuthoredScene, parseAuthoredScene } from './authored_scene.mjs';
import { runRequest } from './level_builder.mjs';
import { parseIgz } from './igz.mjs';
import { decodeUtf16Dictionary } from './chapter_entrypoints.mjs';

const run = promisify(execFile),
  sha = (b) => createHash('sha256').update(b).digest('hex');
function json(filename) {
  const s = fs.lstatSync(filename);
  assert.ok(s.isFile() && !s.isSymbolicLink() && s.size <= 4 * 1024 * 1024, 'Invalid recipe JSON');
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}
function safeArchive(name) {
  assert.match(name ?? '', /^level_[a-z0-9_]+\.bld$/, 'Invalid chapter archive name');
  return name;
}
function regular(filename) {
  const s = fs.lstatSync(filename);
  assert.ok(
    s.isFile() && !s.isSymbolicLink() && s.size <= 1024 * 1024 * 1024,
    'Expected bounded regular recipe input',
  );
  return filename;
}

export function validateOnDemandProfile(p) {
  assert.ok(p && typeof p === 'object' && !Array.isArray(p), 'Invalid on-demand profile');
  assert.ok(
    Object.keys(p).every((k) => ['extractor', 'extractorSha256', 'sourceGameRoot', 'catalogs'].includes(k)),
    'Unknown on-demand setting',
  );
  for (const key of ['extractor', 'sourceGameRoot'])
    assert.ok(
      typeof p[key] === 'string' && path.isAbsolute(p[key]) && !/[\0\r\n]/.test(p[key]),
      'Absolute on-demand path required',
    );
  assert.match(p.extractorSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.ok(
    Array.isArray(p.catalogs) && p.catalogs.length <= 16,
    'Expected at most 16 source-bound catalogs',
  );
  for (const c of p.catalogs) {
    assert.deepEqual(Object.keys(c).sort(), ['path', 'sha256']);
    assert.ok(path.isAbsolute(c.path));
    assert.match(c.sha256 ?? '', /^[a-f0-9]{64}$/);
  }
}

// Catalogs are discovery inputs, never proof of native registration. The
// selected archive, payload and resident load string are verified separately.
export function identifyOnDemandRoute(profile, request, hashFile) {
  const settings = profile.onDemand;
  validateOnDemandProfile(settings);
  assert.equal(hashFile(settings.extractor), settings.extractorSha256, 'Extractor changed');
  const candidates = [];
  for (const c of settings.catalogs) {
    assert.equal(hashFile(c.path), c.sha256, 'Catalog changed');
    const catalog = json(c.path);
    assert.equal(catalog.schema, 'skylanders-chapter-catalog-v1');
    for (const row of catalog.results ?? [])
      if (row.inner?.sha256 === request.expectedSha256) {
        const name = safeArchive(row.archive);
        candidates.push({
          kind: 'native',
          archivePath: 'level/' + name,
          archiveSource: path.join(settings.sourceGameRoot, 'level', name),
          archiveSourceSha256: row.archiveIdentity.sha256,
          rootSha256: request.expectedSha256,
          lineage: [],
        });
      }
  }
  if (candidates.length) {
    const unique = [...new Map(candidates.map((c) => [JSON.stringify(c), c])).values()];
    assert.equal(unique.length, 1, 'Ambiguous chapter identity');
    return unique[0];
  }
  if (/\.scene\.json$/i.test(request.levelPath)) {
    const bytes = fs.readFileSync(regular(request.levelPath));
    assert.equal(sha(bytes), request.expectedSha256);
    const { document } = parseAuthoredScene(bytes);
    if (document.nativeRecipe !== 'cusa00697-static-workshop-v1') {
      assert.equal(
        document.provenance?.archive?.sha256,
        '71d28f33448400829784265b5b4fc24aced3bfacd712f49a351a3ee1c6b83b8b',
        'No native build recipe for this authored scene',
      );
      assert.equal(
        document.provenance?.shapeSha256,
        '18a67907117904a604280021e193ec41544830e5d2f032bb1bb17d9a1b9bb204',
      );
    }
    return {
      kind: 'gallardo',
      archivePath: 'level/level_900_aiworkshop.bld',
      archiveSource: path.join(settings.sourceGameRoot, 'level/arena_mesh_303.bld'),
      archiveSourceSha256: ARENA_ARCHIVE_SHA256,
      rootSha256: request.expectedSha256,
      lineage: [],
    };
  }
  // Build-copy ancestry is bounded and hash-checked. Each hop is replayed
  // below before accepting its output; a sidecar alone is not trusted.
  let current = request.levelPath,
    currentHash = request.expectedSha256;
  const lineage = [],
    seen = new Set();
  for (let depth = 0; depth < 16; depth++) {
    assert.ok(!seen.has(currentHash), 'Cyclic edit ancestry');
    seen.add(currentHash);
    const sidecar = current + '.manifest.json';
    if (!fs.existsSync(sidecar)) break;
    const m = json(sidecar);
    if (m.format !== 'skylanders-position-edit-manifest') break;
    assert.equal(m.output?.sha256, currentHash, 'Edited document manifest mismatch');
    assert.ok(path.isAbsolute(m.source?.path ?? ''));
    assert.equal(hashFile(m.source.path), m.source.sha256, 'Edited document source changed');
    lineage.push({ file: current, sha256: currentHash, manifest: m });
    current = m.source.path;
    currentHash = m.source.sha256;
    for (const c of settings.catalogs) {
      const catalog = json(c.path);
      for (const row of catalog.results ?? [])
        if (row.inner?.sha256 === currentHash) {
          const name = safeArchive(row.archive);
          return {
            kind: 'native',
            archivePath: 'level/' + name,
            archiveSource: path.join(settings.sourceGameRoot, 'level', name),
            archiveSourceSha256: row.archiveIdentity.sha256,
            rootSha256: currentHash,
            lineage,
          };
        }
    }
  }
  const manifestPath = path.join(path.dirname(current), 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const m = json(manifestPath);
    if (m.outputSha256 === currentHash && m.archive?.path && m.archive?.sha256) {
      const name = safeArchive(path.basename(m.archive.path));
      assert.ok(path.isAbsolute(m.archive.path));
      return {
        kind: 'native',
        archivePath: 'level/' + name,
        archiveSource: m.archive.path,
        archiveSourceSha256: m.archive.sha256,
        rootSha256: currentHash,
        lineage,
      };
    }
  }
  throw Error(
    'No native archive recipe for this document. Add its source chapter catalog or preserve its build manifest; no map was launched.',
  );
}

function residentNames(global, language) {
  const g = parseIgz(global),
    l = parseIgz(language),
    packs = l.objects.filter((o) => o.type === 'LanguagePackInfo');
  assert.equal(packs.length, 1);
  const p = packs[0],
    data = l.pointerReferencesByOffset.get(p.offset + 48),
    length = l.u32(p.offset + 40);
  assert.ok(data);
  l.resolvePointer(data.encoded, length);
  const dictionary = decodeUtf16Dictionary(language.subarray(data.targetOffset, data.targetOffset + length));
  const strings = g.objects.filter(
    (o) => o.type === 'StringInfo' && !g.stringReferencesByOffset.get(o.offset + 16)?.value.startsWith('^'),
  );
  assert.equal(strings.length, dictionary.length, 'Mismatched global language pack');
  return dictionary.map((d) => d.text).filter((t) => /^Level_[A-Za-z0-9_]{1,80}$/.test(t));
}

export async function buildOnDemandRoute(profile, request, route, output, hashFile, progress = () => {}) {
  progress('Resolving chapter registration');
  const settings = profile.onDemand;
  assert.equal(hashFile(route.archiveSource), route.archiveSourceSha256, 'Chapter archive changed');
  const dir = path.join(output, 'recipe');
  fs.mkdirSync(dir, { mode: 0o700 });
  const extract = async (archive, member, name) => {
    const target = path.join(dir, name),
      input = fs.realpathSync(archive),
      before = hashFile(input);
    await run(settings.extractor, [input, member, target], { timeout: 120000, maxBuffer: 1024 * 1024 });
    regular(target);
    assert.equal(hashFile(input), before, 'Archive changed while extracting');
    return target;
  };
  const globalArchive = path.join(profile.gameRoot, 'permanent/global.bld');
  const bootstrap = await extract(
    path.join(profile.gameRoot, 'permanent/bootstrap.bld'),
    'level.bld',
    'bootstrap.bld',
  );
  const global = await extract(globalArchive, 'level.bld', 'global.bld');
  const language = await extract(globalArchive, 'ENGLISH.pak', 'ENGLISH.pak');
  const registration = {
    bootstrap: fs.readFileSync(bootstrap),
    global: fs.readFileSync(global),
    language: fs.readFileSync(language),
  };
  const archiveName = path.basename(route.archivePath, '.bld');
  const matches = [
    ...new Set(
      residentNames(registration.global, registration.language).filter(
        (s) => s.toLowerCase() === archiveName,
      ),
    ),
  ];
  assert.equal(matches.length, 1, 'Chapter has no unique load string in the installed game: ' + archiveName);
  const loadString = matches[0],
    resident = resolveResidentLoadString(registration, loadString);
  const titleArchive = path.join(settings.sourceGameRoot, 'level/title.bld');
  assert.equal(hashFile(titleArchive), TITLE_PROFILE.archiveSha256, 'Original title archive required');
  const titleInner = await extract(titleArchive, 'level.bld', 'title-original.bld');
  progress('Building direct chapter start');
  const title = await buildFastbootTitle({
    source: titleInner,
    archive: titleArchive,
    outputDir: path.join(dir, 'title'),
    map: loadString,
    stage: 'auto-slot',
    registration,
  });
  const sourceInner = await extract(route.archiveSource, 'level.bld', 'source-level.bld');
  let inner = sourceInner,
    archive = route.archiveSource;
  if (route.kind === 'gallardo') {
    progress('Building models, textures and collision');
    const scene = buildAuthoredScene(fs.readFileSync(request.levelPath), {
      expectedSha256: request.expectedSha256,
      edits: request.edits.map(({ id, ...e }) => ({ objectId: id, ...e })),
    });
    const scenePath = path.join(dir, 'current.scene.json');
    fs.writeFileSync(scenePath, scene.buffer, { flag: 'wx' });
    const demoDir = path.join(dir, 'native');
    await buildDemoFiles({
      inner: sourceInner,
      archive,
      scene: scenePath,
      expectedSceneSha256: sha(scene.buffer),
      output: demoDir,
    });
    inner = path.join(demoDir, 'level.bld');
    archive = path.join(demoDir, 'level_900_aiworkshop.bld');
  } else {
    assert.equal(
      hashFile(sourceInner),
      route.rootSha256,
      'Catalog/manifest payload does not match the chapter archive',
    );
    for (const [index, hop] of [...route.lineage].reverse().entries()) {
      const replay = runRequest({
        operation: 'build',
        path: hop.manifest.source.path,
        expectedSha256: hop.manifest.source.sha256,
        output: path.join(dir, 'ancestry-' + index + '.bld'),
        edits: hop.manifest.changes.map((c) => ({ objectId: c.objectId, position: c.requested })),
      });
      assert.equal(replay.sha256, hop.sha256, 'Build-copy ancestry cannot be reproduced');
    }
    inner = request.levelPath;
  }
  return {
    sourceSha256: request.expectedSha256,
    loadString,
    label: route.kind === 'gallardo' ? 'Model workshop' : loadString,
    archivePath: route.archivePath,
    archiveSource: archive,
    archiveSourceSha256: hashFile(archive),
    previewInner: inner,
    previewInnerSha256: hashFile(inner),
    titleArchive: title.outer,
    titleArchiveSha256: title.outerSha256,
    onDemand: true,
    editsApplied: route.kind === 'gallardo',
    recipe: route.kind,
    resident,
  };
}
