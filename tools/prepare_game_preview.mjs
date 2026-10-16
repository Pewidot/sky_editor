#!/usr/bin/env node
// Prepare, but never launch, one private native preview of the current document.
// A profile binds exact document hashes to previously validated chapter recipes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runRequest } from './level_builder.mjs';
import { replaceMember } from './iga_replace.mjs';
import { validateOnDemandProfile, identifyOnDemandRoute, buildOnDemandRoute } from './preview_routes.mjs';
import { validateTransform } from './object_transform.mjs';

const MAX_FILE = 1024 * 1024 * 1024;
function keys(value, allowed, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected ' + label);
  assert.ok(
    Object.keys(value).every((k) => allowed.includes(k)),
    'Unknown ' + label + ' field',
  );
}
function absolute(value) {
  assert.ok(
    typeof value === 'string' && path.isAbsolute(value) && !/[\r\n\0]/.test(value),
    'Expected an absolute path',
  );
  return path.resolve(value);
}
function relative(value) {
  assert.ok(
    typeof value === 'string' &&
      !/[\\\r\n\0]/.test(value) &&
      !path.isAbsolute(value) &&
      value.split('/').every((p) => p && p !== '.' && p !== '..'),
    'Unsafe relative game path',
  );
  return value;
}
function digest(value) {
  assert.match(value ?? '', /^[a-f0-9]{64}$/, 'Expected SHA-256');
  return value;
}
function inside(root, filename) {
  const r = path.relative(root, filename);
  return !r || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r));
}
function state(stat) {
  return ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs', 'nlink'].map((k) => stat[k]);
}
function regular(filename) {
  filename = absolute(filename);
  const s = fs.lstatSync(filename);
  assert.ok(
    s.isFile() && !s.isSymbolicLink() && s.size <= MAX_FILE,
    'Expected a regular non-symlink file <=1 GiB: ' + filename,
  );
  return { path: filename, state: state(s), size: s.size };
}
function unchanged(file) {
  assert.deepEqual(state(fs.lstatSync(file.path)), file.state, 'Source changed: ' + file.path);
}
export function hashPreviewFile(filename) {
  const file = regular(filename),
    fd = fs.openSync(file.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    assert.deepEqual(state(fs.fstatSync(fd)), file.state);
    const h = createHash('sha256'),
      chunk = Buffer.alloc(1024 * 1024);
    for (let at = 0; at < file.size; ) {
      const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, file.size - at), at);
      assert.ok(n > 0);
      h.update(chunk.subarray(0, n));
      at += n;
    }
    unchanged(file);
    return h.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}
function pinned(filename, expected) {
  const file = regular(filename);
  assert.equal(hashPreviewFile(file.path), digest(expected), 'Source SHA-256 changed: ' + filename);
  return file;
}
function directory(filename) {
  filename = absolute(filename);
  const s = fs.lstatSync(filename);
  assert.ok(s.isDirectory() && !s.isSymbolicLink(), 'Expected a real directory');
  return fs.realpathSync(filename);
}
function jsonFile(filename) {
  const f = regular(filename);
  assert.ok(f.size <= 1024 * 1024, 'JSON exceeds 1 MiB');
  return JSON.parse(fs.readFileSync(f.path, 'utf8'));
}

export function validatePreviewRequest(request) {
  keys(request, ['profilePath', 'levelPath', 'expectedSha256', 'edits'], 'preview request');
  absolute(request.profilePath);
  absolute(request.levelPath);
  digest(request.expectedSha256);
  assert.ok(
    Array.isArray(request.edits) && request.edits.length <= 10000,
    'Expected at most 10000 position edits',
  );
  const ids = new Set();
  for (const e of request.edits) {
    keys(e, ['id', 'position', 'rotationDegrees', 'scale'], 'transform edit');
    validateTransform(e);
    assert.ok(Number.isSafeInteger(e.id) && e.id >= 0 && !ids.has(e.id), 'Invalid or duplicate object id');
    ids.add(e.id);
    assert.ok(
      Array.isArray(e.position) &&
        e.position.length === 3 &&
        e.position.every((n) => Number.isFinite(n) && Math.abs(n) <= 1000000),
      'Invalid position',
    );
  }
}
export function readPreviewProfile(filename) {
  const p = jsonFile(filename);
  keys(
    p,
    [
      'schema',
      'emulator',
      'emulatorSha256',
      'gameRoot',
      'gameExecutableSha256',
      'checkpoint',
      'outputRoot',
      'gamePins',
      'assetRoots',
      'maps',
      'onDemand',
    ],
    'preview profile',
  );
  assert.equal(p.schema, 'skylanders-game-preview-v1', 'Unsupported preview profile');
  for (const k of ['emulator', 'gameRoot', 'checkpoint', 'outputRoot']) absolute(p[k]);
  digest(p.emulatorSha256);
  digest(p.gameExecutableSha256);
  keys(p.gamePins, Object.keys(p.gamePins ?? {}), 'game pins');
  for (const [name, sha] of Object.entries(p.gamePins)) {
    relative(name);
    digest(sha);
  }
  assert.ok(Array.isArray(p.assetRoots) && p.assetRoots.length <= 16, 'Expected explicit linked asset roots');
  p.assetRoots.forEach(absolute);
  if (p.onDemand) validateOnDemandProfile(p.onDemand);
  assert.ok(
    Array.isArray(p.maps) && (p.maps.length > 0 || p.onDemand) && p.maps.length <= 64,
    'Expected configured maps or on-demand recipes',
  );
  const sources = new Set();
  for (const m of p.maps) {
    keys(
      m,
      [
        'sourceSha256',
        'loadString',
        'label',
        'archivePath',
        'archiveSource',
        'archiveSourceSha256',
        'previewInner',
        'previewInnerSha256',
        'titleArchive',
        'titleArchiveSha256',
      ],
      'map binding',
    );
    for (const k of ['sourceSha256', 'archiveSourceSha256', 'previewInnerSha256', 'titleArchiveSha256'])
      digest(m[k]);
    assert.ok(!sources.has(m.sourceSha256), 'Duplicate map source binding');
    sources.add(m.sourceSha256);
    assert.match(m.loadString ?? '', /^Level_[A-Za-z0-9_]{1,80}$/, 'Invalid registered load string');
    assert.ok(typeof m.label === 'string' && m.label.length <= 200, 'Expected short map label');
    relative(m.archivePath);
    assert.match(m.archivePath, /^level\/[^/]+\.bld$/, 'Expected a level archive');
    for (const k of ['archiveSource', 'previewInner', 'titleArchive']) absolute(m[k]);
  }
  return p;
}

function inventory(root, assetRoots) {
  const entries = [];
  const walk = (dir, prefix = '', depth = 0) => {
    assert.ok(depth <= 16, 'Game tree nesting exceeds limit');
    for (const name of fs.readdirSync(dir).sort()) {
      const rel = relative(prefix + name),
        file = path.join(dir, name),
        s = fs.lstatSync(file);
      // These are preserved investigation backups, not runtime dependencies.
      if (name.includes('.before-fastboot-') || name.endsWith('.network-source')) continue;
      assert.ok(entries.length < 10000, 'Game tree exceeds 10000 entries');
      if (s.isDirectory()) {
        entries.push({ relative: rel, kind: 'directory', path: file, state: state(s) });
        walk(file, rel + '/', depth + 1);
      } else if (s.isSymbolicLink()) {
        const target = fs.realpathSync(file);
        assert.ok(
          assetRoots.some((r) => inside(r, target)),
          'Asset link escapes configured game roots: ' + rel,
        );
        assert.ok(fs.statSync(target).isFile(), 'Only regular-file asset links are allowed');
        entries.push({ relative: rel, kind: 'symlink', path: file, state: state(s), target });
      } else {
        const f = regular(file);
        entries.push({ ...f, relative: rel, kind: 'file' });
      }
    }
  };
  walk(root);
  return entries;
}
function copyPinned(file, output, clone = false) {
  unchanged(file);
  fs.copyFileSync(
    file.path,
    output,
    fs.constants.COPYFILE_EXCL | (clone ? fs.constants.COPYFILE_FICLONE_FORCE : 0),
  );
  const copied = fs.lstatSync(output);
  assert.ok(
    copied.isFile() && !copied.isSymbolicLink() && copied.nlink === 1,
    'Output must have an independent inode',
  );
  assert.ok(copied.ino !== file.state[1] || copied.dev !== file.state[0], 'Hardlinks are forbidden');
  unchanged(file);
}

export async function prepareGamePreview(request, progress = () => {}) {
  progress('Checking source files');
  validatePreviewRequest(request);
  const profile = readPreviewProfile(request.profilePath);
  const selected = profile.maps.filter((m) => m.sourceSha256 === request.expectedSha256);
  assert.ok(
    selected.length === 1 || profile.onDemand,
    'Current map has no configured native chapter binding; refusing to launch a different map',
  );
  let map = selected[0];
  const level = pinned(request.levelPath, request.expectedSha256);
  const route = map ? null : identifyOnDemandRoute(profile, request, hashPreviewFile);
  const emulator = pinned(profile.emulator, profile.emulatorSha256),
    sourceGame = directory(profile.gameRoot),
    outputRoot = directory(profile.outputRoot);
  const checkpoint = directory(profile.checkpoint),
    checkpointManifest = regular(path.join(checkpoint, 'checkpoint.json'));
  assert.equal(
    jsonFile(checkpointManifest.path).format,
    'skylanders-runtime-checkpoint-v1',
    'Invalid saved-profile checkpoint',
  );
  assert.ok(
    !inside(sourceGame, outputRoot) && !inside(checkpoint, outputRoot),
    'Preview output must be outside game and checkpoint trees',
  );
  assert.ok(
    !fs.existsSync(path.join(sourceGame, 'sce_module/libSceUsbd.sprx')),
    'LLE USB would bypass the emulated portal',
  );
  const pins = [
    pinned(path.join(sourceGame, 'eboot.bin'), profile.gameExecutableSha256),
    ...Object.entries(profile.gamePins).map(([rel, sha]) => pinned(path.join(sourceGame, rel), sha)),
  ];
  const entries = inventory(sourceGame, profile.assetRoots.map(directory));
  assert.ok(
    entries.some((e) => e.relative === (map ?? route).archivePath) &&
      entries.some((e) => e.relative === 'level/title.bld'),
    'Map/title are absent from prepared game',
  );
  // mkdtemp creates a unique owned destination; failed preparations remain for
  // diagnosis and are never mistaken for a successfully prepared launch.
  const output = fs.mkdtempSync(path.join(outputRoot, 'preview-'));
  let result;
  try {
    if (route) map = await buildOnDemandRoute(profile, request, route, output, hashPreviewFile, progress);
    progress('Packing current map');
    const inner = pinned(map.previewInner, map.previewInnerSha256),
      archive = pinned(map.archiveSource, map.archiveSourceSha256),
      title = pinned(map.titleArchive, map.titleArchiveSha256);
    const edited = path.join(output, 'level.bld');
    const built = runRequest({
      operation: 'build',
      path: inner.path,
      expectedSha256: map.previewInnerSha256,
      output: edited,
      edits: map.editsApplied ? [] : request.edits.map(({ id, ...e }) => ({ objectId: id, ...e })),
    });
    const replacement = path.join(output, 'map.bld');
    const packed = await replaceMember({
      source: archive.path,
      selector: 'level.bld',
      replacement: edited,
      output: replacement,
    });
    const game = path.join(output, 'CUSA00697');
    fs.mkdirSync(game, { mode: 0o700 });
    progress('Creating private game copy');
    for (const e of entries) {
      unchanged(e);
      const dst = path.join(game, e.relative);
      if (e.kind === 'directory') {
        fs.mkdirSync(dst, { mode: 0o700 });
        continue;
      }
      if (e.relative === map.archivePath) {
        copyPinned(regular(replacement), dst, true);
        continue;
      }
      if (e.relative === 'level/title.bld') {
        copyPinned(title, dst);
        continue;
      }
      if (e.kind === 'symlink') {
        assert.equal(fs.realpathSync(e.path), e.target, 'Source asset link changed');
        fs.symlinkSync(e.target, dst);
      } else copyPinned(e, dst, true);
    }
    for (const f of [level, emulator, inner, archive, title, ...pins, checkpointManifest]) unchanged(f);
    progress('Verifying prepared files');
    assert.equal(hashPreviewFile(path.join(game, map.archivePath)), packed.output.sha256);
    assert.equal(hashPreviewFile(path.join(game, 'level/title.bld')), map.titleArchiveSha256);
    result = {
      schema: 'skylanders-prepared-preview-v1',
      levelPath: fs.realpathSync(level.path),
      sourceSha256: request.expectedSha256,
      editCount: request.edits.length,
      map: {
        sourceSha256: map.sourceSha256,
        loadString: map.loadString,
        label: map.label,
        archivePath: map.archivePath,
        innerSha256: built.sha256,
        archiveSha256: packed.output.sha256,
        onDemand: map.onDemand === true,
        ...(map.resident ? { resident: map.resident, recipe: map.recipe } : {}),
      },
      emulator: emulator.path,
      game: path.join(game, 'eboot.bin'),
      session: path.join(output, 'session'),
      resumeFrom: checkpoint,
      x11: true,
      preparationDirectory: output,
      profilePath: fs.realpathSync(request.profilePath),
      titleSha256: map.titleArchiveSha256,
      sourceGameUnchanged: true,
      emulatorStarted: false,
      limitations: [
        'Native archives must match a source catalog/build manifest and the installed registration; authored scenes need a native build recipe.',
        'Saved-profile checkpoint, not an emulator RAM state.',
        'Position edits are packed; runtime collision/script effects still require testing.',
        'Unmodified linked assets remain dependent on configured source game roots.',
      ],
    };
    fs.writeFileSync(path.join(output, 'preview.json'), JSON.stringify(result, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    return result;
  } catch (error) {
    fs.writeFileSync(
      path.join(output, 'preparation-error.json'),
      JSON.stringify({ error: error.message, emulatorStarted: false }) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    throw new Error(error.message + '; retained preparation: ' + output, { cause: error });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let bytes = '';
    for await (const part of process.stdin) {
      bytes += part;
      assert.ok(Buffer.byteLength(bytes) <= 4 * 1024 * 1024, 'Request exceeds 4 MiB');
    }
    console.log(
      JSON.stringify(
        await prepareGamePreview(JSON.parse(bytes), (stage) =>
          process.stderr.write('PREVIEW_STAGE ' + stage + '\n'),
        ),
      ),
    );
  } catch (error) {
    console.log(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}
