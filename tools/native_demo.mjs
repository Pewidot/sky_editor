#!/usr/bin/env node
// Build only. This command never installs files or changes a game/save profile.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildNativeDemo, ARENA_ARCHIVE_SHA256 } from './native_demo_builder.mjs';
import { replaceMember } from './iga_replace.mjs';

const hash = (b) => createHash('sha256').update(b).digest('hex');
function readInput(filename, budget) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    assert.ok(before.isFile() && before.size > 0 && before.size <= budget, 'Input size/type outside profile');
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
export async function buildDemoFiles({ inner, archive, scene, expectedSceneSha256, output }) {
  const source = readInput(inner, 256 * 1024 * 1024);
  const sceneBytes = readInput(scene, 128 * 1024 * 1024);
  assert.equal(
    hash(readInput(archive, 256 * 1024 * 1024)),
    ARENA_ARCHIVE_SHA256,
    'Unsupported source archive',
  );
  assert.ok(!fs.existsSync(output), 'Output directory must be new');
  const result = buildNativeDemo(source, sceneBytes, { expectedSceneSha256 });
  fs.mkdirSync(output, { mode: 0o700 });
  const replacement = path.join(output, 'level.bld');
  writeNew(replacement, result.buffer);
  const packed = await replaceMember({
    source: archive,
    selector: 'level.bld',
    replacement,
    output: path.join(output, 'level_900_aiworkshop.bld'),
    manifest: path.join(output, 'archive.manifest.json'),
  });
  assert.equal(packed.source.sha256, ARENA_ARCHIVE_SHA256, 'Archive changed before packing');
  const manifest = { ...result.manifest, archive: packed.output };
  writeNew(path.join(output, 'manifest.json'), Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  return {
    output: path.resolve(output),
    innerSha256: hash(result.buffer),
    archive: packed.output,
    runtimeValidated: false,
  };
}

export function parseArguments(args) {
  const names = new Map([
    ['--inner', 'inner'],
    ['--archive', 'archive'],
    ['--scene', 'scene'],
    ['--expect-scene-sha256', 'expectedSceneSha256'],
    ['--output', 'output'],
  ]);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = names.get(args[i]);
    assert.ok(
      name && !Object.hasOwn(options, name) && args[i + 1] && !args[i + 1].startsWith('--'),
      'Unknown, duplicate or incomplete option',
    );
    options[name] = args[i + 1];
  }
  assert.equal(Object.keys(options).length, names.size, 'All five options are required');
  assert.match(options.expectedSceneSha256, /^[a-f0-9]{64}$/);
  return options;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).includes('--help')) {
    console.log(
      'node tools/native_demo.mjs --inner extracted-level.bld --archive arena_mesh_303.bld --scene imported.scene.json --expect-scene-sha256 HEX --output NEW-DIRECTORY',
    );
    console.log(
      'Exact CUSA00697/Gallardo profile. Builds private assets; does not register or install the chapter. See docs/NATIVE_DEMO.md.',
    );
  } else {
    try {
      console.log(JSON.stringify(await buildDemoFiles(parseArguments(process.argv.slice(2))), null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
