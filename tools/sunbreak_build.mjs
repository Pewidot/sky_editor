#!/usr/bin/env node
// Reproduce the native short mission from the owner's unmodified extraction.
// Build-only: registration, installation and profile migration are separate.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSunbreakWorld } from './native_sunbreak_world.mjs';
import { buildSunbreakMission } from './native_sunbreak_mission.mjs';
import { buildSunbreakObjectivesUi } from './sunbreak_objectives_ui.mjs';
import { replaceMember } from './iga_replace.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const defaultExtractor = fileURLToPath(new URL('./iga_extract', import.meta.url));
const profile = {
  arena: ['level/arena_mesh_303.bld', '27d374305a08087abfcde0d91f6db147b6591440a088949643aa2bcfe4551145'],
  global: ['permanent/global.bld', 'f1358f785eb6fb2826adbf028aa30ebdbd1b02b32b3dc3d8f3c70dbd634bcb4f'],
  soda: ['level/level_313_tutorial.bld', 'e95d323e2377587cc549361427ab50d14551a1a7269ea6b6d2966973b7f0d6ff'],
  objectives: [
    'misc/ui_objectivesscreen.bld',
    'f67aaed9846a20a84ac934af51db39021daeb939760300f84384bba9618ab159',
  ],
};
function readInput(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    assert.ok(
      before.isFile() && before.size > 0 && before.size <= 512 * 1024 * 1024,
      'Input outside supported size/type: ' + filename,
    );
    const bytes = fs.readFileSync(fd),
      after = fs.fstatSync(fd);
    assert.ok(
      before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
      'Input changed during read',
    );
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
function writeNew(filename, bytes) {
  const fd = fs.openSync(filename, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function unpack(extractor, archive, destination) {
  assert.ok(!fs.existsSync(destination), 'Extraction output must be new');
  const run = spawnSync(extractor, [archive, 'level.bld', destination], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(run.status, 0, run.error?.message ?? run.stderr);
  fs.chmodSync(destination, 0o600);
  return readInput(destination);
}
export function parseSunbreakArguments(args) {
  const names = new Map([
      ['--game', 'game'],
      ['--output', 'output'],
      ['--extractor', 'extractor'],
    ]),
    options = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = names.get(args[i]);
    assert.ok(
      name && !Object.hasOwn(options, name) && args[i + 1] && !args[i + 1].startsWith('--'),
      'Unknown, duplicate or incomplete option',
    );
    options[name] = args[i + 1];
  }
  assert.ok(
    options.game && options.output,
    'Supply --game ORIGINAL-EXTRACTED-GAME and --output NEW-DIRECTORY',
  );
  return options;
}
export async function buildSunbreakFiles({ game, output, extractor = defaultExtractor, ...unknown }) {
  assert.equal(Object.keys(unknown).length, 0, 'Unknown build option');
  assert.ok(
    typeof game === 'string' && typeof output === 'string' && typeof extractor === 'string',
    'Paths must be strings',
  );
  game = fs.realpathSync(game);
  output = path.resolve(output);
  extractor = path.resolve(extractor);
  assert.ok(fs.statSync(game).isDirectory(), 'Game must be an extracted directory');
  assert.ok(!fs.existsSync(output), 'Output directory must be new');
  // Reject outputs inside the source tree, including a parent directory alias.
  const outputParent = fs.realpathSync(path.dirname(output));
  const relative = path.relative(game, outputParent);
  assert.ok(
    relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative),
    'Output must be outside the source game tree',
  );
  const sources = {};
  for (const [key, [relative, expected]] of Object.entries(profile)) {
    const filename = path.join(game, relative),
      digest = sha(readInput(filename));
    assert.equal(digest, expected, 'Unsupported original archive: ' + relative);
    sources[key] = { path: filename, sha256: digest };
  }
  assert.ok(fs.statSync(extractor).isFile(), 'Extractor must be a file');
  fs.accessSync(extractor, fs.constants.X_OK);
  fs.mkdirSync(output, { mode: 0o700 });
  fs.mkdirSync(path.join(output, 'sources'), { mode: 0o700 });
  const inner = {};
  for (const [key, source] of Object.entries(sources)) {
    inner[key] = unpack(extractor, source.path, path.join(output, 'sources', key + '.bld'));
    // Pin the archive again across extraction, not just before starting a process.
    assert.equal(sha(readInput(source.path)), source.sha256, 'Source changed while extracting');
    source.innerSha256 = sha(inner[key]);
  }
  const world = buildSunbreakWorld(inner.arena);
  const mission = buildSunbreakMission({
    world: world.buffer,
    global: inner.global,
    soda: inner.soda,
    skipPropertyFields: true,
  });
  const objectives = buildSunbreakObjectivesUi(inner.objectives);
  assert.equal(
    mission.manifest.outputSha256,
    'f84806dfc61170c09c59729ed6e7b86c1d163d6ca0cb13607932ea0ccc69324b',
  );
  assert.equal(
    objectives.manifest.outputSha256,
    'e0a093bcaa202923cf68128736d970edb221782615d02931e569663de60d1700',
  );
  writeNew(path.join(output, 'world.bld'), world.buffer);
  writeNew(path.join(output, 'level.bld'), mission.buffer);
  writeNew(path.join(output, 'objectives-inner.bld'), objectives.buffer);
  const artifacts = {};
  for (const [key, source, replacement, name, expected] of [
    [
      'mission',
      'arena',
      'level.bld',
      'level_901_sunbreak.bld',
      'cac1da3a2ac461d51203129f7e15b954518c0cfbc8cb392427215058503ca891',
    ],
    [
      'objectives',
      'objectives',
      'objectives-inner.bld',
      'ui_objectivesscreen.bld',
      '5eaf739fe95bd81fe2ab0a639aa631cf1f1c51423e0f8fe0113c91e592a939de',
    ],
  ]) {
    const r = await replaceMember({
      source: sources[source].path,
      selector: 'level.bld',
      replacement: path.join(output, replacement),
      output: path.join(output, name),
      manifest: path.join(output, key + '-archive.json'),
    });
    assert.equal(r.source.sha256, sources[source].sha256);
    assert.equal(r.output.sha256, expected);
    const verified = unpack(extractor, r.output.path, path.join(output, key + '-verified.bld'));
    assert.equal(sha(verified), sha(readInput(path.join(output, replacement))));
    artifacts[key] = r.output;
  }
  const manifest = {
    schema: 'skylanders-sunbreak-build-v1',
    sources,
    artifacts,
    world: world.manifest,
    mission: mission.manifest,
    objectives: objectives.manifest,
    independentReadbackVerified: true,
    gameFilesWritten: false,
    saveFilesWritten: false,
    runtimeValidated: false,
    requires:
      'Matching 24-entry registration, objective strings3052..3054, progress UI and migrated/fresh save profile. See docs/SUNBREAK.md.',
    limitation:
      'Pinned short traversal mission, not an arbitrary AI chapter compiler. Newly built files are not themselves a new runtime test.',
  };
  writeNew(path.join(output, 'manifest.json'), Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  return {
    output,
    artifacts,
    independentReadbackVerified: true,
    runtimeValidated: false,
    gameFilesWritten: false,
    saveFilesWritten: false,
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).includes('--help')) {
    console.log(
      'node tools/sunbreak_build.mjs --game ORIGINAL-CUSA00697-DIRECTORY --output NEW-DIRECTORY [--extractor PATH]',
    );
    console.log(
      'Builds native level901 and its objectives UI from your own extraction. No installation, chapter registration or save edits. See docs/SUNBREAK.md.',
    );
  } else
    try {
      console.log(
        JSON.stringify(await buildSunbreakFiles(parseSunbreakArguments(process.argv.slice(2))), null, 2),
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
}
