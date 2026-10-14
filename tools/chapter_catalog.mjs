#!/usr/bin/env node
// Reproducible private reference export from the user's own extracted archives.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { inspectArchive } from './iga_replace.mjs';

const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const here = path.dirname(fileURLToPath(import.meta.url));
const NAME = /^level_\d{3}_[a-z0-9_]+\.bld$/;
const MAX_FILE = 1024 ** 3;
const categories = ['enemy', 'chest', 'crate', 'gate'];
export function selectArchives(names) {
  const selected = names.filter((name) => NAME.test(name)).sort();
  check(selected.length > 0 && selected.length <= 64, 'Expected 1..64 numbered level archive candidates');
  return selected;
}
async function hashFile(filename) {
  // Opening first refreshes network-filesystem attributes; a path stat taken
  // before open can be stale immediately after an extractor closes a new file.
  const fd = await fsp.open(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const stat = await fd.stat();
    check(stat.isFile() && stat.size <= MAX_FILE, 'Expected regular non-symlink file <=1 GiB: ' + filename);
    const h = createHash('sha256');
    for await (const chunk of fd.createReadStream({ autoClose: false })) h.update(chunk);
    const after = await fd.stat(),
      current = fs.lstatSync(filename);
    check(
      !current.isSymbolicLink() &&
        stat.ino === current.ino &&
        stat.dev === current.dev &&
        stat.size === after.size &&
        stat.mtimeMs === after.mtimeMs &&
        stat.ctimeMs === after.ctimeMs,
      'Input changed while hashing: ' + filename,
    );
    return { sha256: h.digest('hex'), size: stat.size };
  } finally {
    await fd.close();
  }
}
async function run(program, args, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' },
    });
    let stdout = '',
      stderr = '',
      error;
    const timer = setTimeout(() => {
      error = new Error('Owned child exceeded time limit');
      child.kill('SIGKILL');
    }, timeoutMs);
    const collect = (key, chunk) => {
      if (key === 'out') stdout += chunk;
      else stderr += chunk;
      if (stdout.length + stderr.length > 16 * 1024 * 1024) {
        error = new Error('Child output budget exceeded');
        child.kill('SIGKILL');
      }
    };
    child.stdout.on('data', (c) => collect('out', c));
    child.stderr.on('data', (c) => collect('err', c));
    child.on('error', (e) => {
      error = e;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (error || code !== 0) reject(error ?? new Error(`Child exit ${code}: ${stderr.slice(-4000)}`));
      else resolve({ stdout, stderr });
    });
  });
}
function writeNew(filename, value) {
  fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
async function* rows(filename) {
  const input = fs.createReadStream(filename),
    gz = input.pipe(createGunzip());
  input.on('error', (e) => gz.destroy(e));
  const reader = createInterface({ input: gz, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      check(line.length < 16 * 1024 * 1024, 'JSONL row exceeds limit');
      yield JSON.parse(line);
    }
  } finally {
    reader.close();
    input.destroy();
    gz.destroy();
  }
}
async function featureSelection(directory, perCategory) {
  const found = Object.fromEntries(categories.map((c) => [c, []]));
  for await (const row of rows(path.join(directory, 'feature-candidates.jsonl.gz'))) {
    if (row.type !== 'tfbActorInfo' || !found[row.category] || found[row.category].length >= perCategory)
      continue;
    found[row.category].push({
      category: row.category,
      objectId: row.objectId,
      objectIndex: row.objectIndex,
      fileOffset: row.fileOffset,
      classificationBasis: row.classificationBasis,
      semanticProof: false,
    });
  }
  return found;
}

export async function buildChapterCatalog({
  gameRoot,
  outputDirectory,
  extractor,
  editor,
  featuresPerCategory = 0,
  only,
} = {}) {
  check(
    typeof gameRoot === 'string' && typeof outputDirectory === 'string' && typeof extractor === 'string',
    'gameRoot, new outputDirectory and extractor are required',
  );
  check(
    Number.isInteger(featuresPerCategory) && featuresPerCategory >= 0 && featuresPerCategory <= 3,
    'featuresPerCategory must be 0..3',
  );
  check(
    !featuresPerCategory || typeof editor === 'string',
    'Feature screenshots require an editor executable',
  );
  gameRoot = fs.realpathSync(gameRoot);
  outputDirectory = path.resolve(outputDirectory);
  extractor = path.resolve(extractor);
  outputDirectory = path.join(fs.realpathSync(path.dirname(outputDirectory)), path.basename(outputDirectory));
  const relative = path.relative(gameRoot, outputDirectory);
  check(
    relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative),
    'Output must be outside the extracted game tree',
  );
  const levelDirectory = path.join(gameRoot, 'level');
  check(!fs.lstatSync(levelDirectory).isSymbolicLink(), 'Level directory cannot be a symlink');
  let names = selectArchives(fs.readdirSync(levelDirectory));
  if (only) {
    check(
      Array.isArray(only) &&
        only.length &&
        only.every((n) => names.includes(n)) &&
        new Set(only).size === only.length,
      'Invalid only archive selection',
    );
    names = names.filter((n) => only.includes(n));
  }
  const toolIdentities = {
    extractor: { path: extractor, ...(await hashFile(extractor)) },
    ...(editor ? { editor: { path: path.resolve(editor), ...(await hashFile(path.resolve(editor))) } } : {}),
  };
  fs.mkdirSync(outputDirectory, { mode: 0o700 });
  outputDirectory = fs.realpathSync(outputDirectory);
  const plan = {
    schema: 'skylanders-chapter-catalog-plan-v1',
    gameRoot,
    outputDirectory,
    createdAt: new Date().toISOString(),
    selectionRule: NAME.source,
    chapterOrderKnown: false,
    candidates: names,
    tools: toolIdentities,
    featuresPerCategory,
    limitations: [
      'File names select candidate level archives, not chapter order or registry membership.',
      'One inner level.bld per archive; archive .arc resources, localization and streamed dependencies are not all decoded.',
      'Structural catalog and preview screenshots do not establish gameplay semantics, game lighting or runtime playability.',
    ],
  };
  writeNew(path.join(outputDirectory, 'plan.json'), plan);
  const results = [];
  for (const name of names) {
    const directory = path.join(outputDirectory, path.basename(name, '.bld'));
    fs.mkdirSync(directory, { mode: 0o700 });
    const source = path.join(levelDirectory, name),
      result = { archive: name, status: 'incomplete', screenshots: [] };
    const progress = (stage) => process.stderr.write(JSON.stringify({ archive: name, stage }) + '\n');
    try {
      progress('inspect');
      const original = await hashFile(source);
      result.archiveIdentity = original;
      const h = await fsp.open(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      let inventory;
      try {
        inventory = await inspectArchive(h, original.size);
      } finally {
        await h.close();
      }
      writeNew(path.join(directory, 'archive.json'), { source, ...original, ...inventory });
      const members = inventory.entries.filter((e) => e.path === 'level.bld');
      check(
        members.length === 1 && members[0].size <= MAX_FILE,
        'Exactly one bounded inner level.bld required',
      );
      progress('extract');
      const inner = path.join(directory, 'level.bld');
      await run(extractor, [source, 'level.bld', inner]);
      const innerIdentity = await hashFile(inner);
      check(innerIdentity.size === members[0].size, 'Extracted length disagrees with archive descriptor');
      check((await hashFile(source)).sha256 === original.sha256, 'Source archive changed during extraction');
      result.inner = { path: 'level.bld', ...innerIdentity, memberIndex: members[0].index };
      progress('catalog');
      const catalog = path.join(directory, 'structure');
      await run(process.execPath, [
        path.join(here, 'igz_catalog.mjs'),
        '--source',
        inner,
        '--expect-sha256',
        innerIdentity.sha256,
        '--output-dir',
        catalog,
      ]);
      const manifest = JSON.parse(fs.readFileSync(path.join(catalog, 'catalog.json')));
      result.structure = {
        path: 'structure/catalog.json',
        counts: manifest.counts,
        ...(await hashFile(path.join(catalog, 'catalog.json'))),
      };
      const selected = await featureSelection(catalog, featuresPerCategory);
      result.featureCandidates = selected;
      if (editor) {
        const snapshots = [
          { filename: 'overview.png' },
          ...Object.values(selected)
            .flat()
            .map((f) => ({
              filename: `${f.category}-${f.objectIndex}.png`,
              ...f,
            })),
        ];
        for (const snapshot of snapshots) {
          progress('render:' + snapshot.filename);
          try {
            const out = path.join(directory, snapshot.filename),
              args = [inner, '--render-scene', out];
            if (snapshot.objectIndex !== undefined) args.push('--frame-object', String(snapshot.objectIndex));
            const rendered = await run(path.resolve(editor), args);
            const report = JSON.parse(rendered.stdout);
            const identity = await hashFile(out);
            check(
              report.sourceSha256 === innerIdentity.sha256 && report.pngSha256 === identity.sha256,
              'Screenshot provenance mismatch',
            );
            const entry = {
              ...snapshot,
              status: 'rendered-preview',
              ...report,
              ...identity,
              visuallyReviewed: false,
            };
            writeNew(out + '.json', entry);
            result.screenshots.push(entry);
          } catch (error) {
            result.screenshots.push({ ...snapshot, status: 'failed', error: error.message });
          }
        }
      }
      result.status = 'structural-export-complete';
    } catch (error) {
      result.error = error.message;
      progress('failed:' + error.message);
    }
    writeNew(path.join(directory, 'result.json'), result);
    results.push(result);
    progress(result.status);
  }
  const index = {
    ...plan,
    schema: 'skylanders-chapter-catalog-v1',
    completedAt: new Date().toISOString(),
    gameplaySchemaComplete: false,
    results,
    exported: results.filter((r) => r.status === 'structural-export-complete').length,
  };
  writeNew(path.join(outputDirectory, 'index.json'), index);
  return index;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2),
      options = {},
      flags = new Map([
        ['--game-root', 'gameRoot'],
        ['--output-dir', 'outputDirectory'],
        ['--extractor', 'extractor'],
        ['--editor', 'editor'],
        ['--features-per-category', 'featuresPerCategory'],
        ['--only', 'only'],
      ]);
    while (args.length) {
      const k = flags.get(args.shift());
      check(k && options[k] === undefined && args.length, 'Unknown/duplicate/missing option');
      options[k] = args.shift();
    }
    if (options.featuresPerCategory !== undefined)
      options.featuresPerCategory = Number(options.featuresPerCategory);
    if (options.only) options.only = options.only.split(',');
    const index = await buildChapterCatalog(options);
    console.log(
      JSON.stringify({
        index: path.join(index.outputDirectory, 'index.json'),
        candidates: index.candidates.length,
        exported: index.exported,
      }),
    );
    if (index.exported !== index.candidates.length) process.exitCode = 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
