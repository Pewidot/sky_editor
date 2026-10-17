import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSunbreakFiles, parseSunbreakArguments } from '../tools/sunbreak_build.mjs';
test('Sunbreak build CLI requires explicit source and new destination', () => {
  assert.deepEqual(parseSunbreakArguments(['--game', 'a', '--output', 'b']), { game: 'a', output: 'b' });
  for (const args of [
    [],
    ['--game', 'a'],
    ['--game', 'a', '--output'],
    ['--game', 'a', '--output', 'b', '--game', 'c'],
    ['--game', 'a', '--output', 'b', '--install', 'yes'],
  ])
    assert.throws(() => parseSunbreakArguments(args));
});
test('Sunbreak build rejects unknown inputs, occupied outputs and source-tree writes without creating outputs', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sunbreak-build-test-'));
  try {
    const game = path.join(temp, 'game'),
      output = path.join(temp, 'new');
    fs.mkdirSync(game);
    fs.mkdirSync(path.join(game, 'level'));
    fs.writeFileSync(path.join(game, 'level', 'arena_mesh_303.bld'), 'not an archive');
    await assert.rejects(buildSunbreakFiles({ game, output }), /Unsupported original archive/);
    assert.equal(fs.existsSync(output), false);
    await assert.rejects(buildSunbreakFiles({ game, output: game }), /must be new/);
    await assert.rejects(buildSunbreakFiles({ game, output: path.join(game, 'new') }), /outside the source/);
    await assert.rejects(buildSunbreakFiles({ game, output, install: true }), /Unknown build option/);
    assert.equal(fs.readFileSync(path.join(game, 'level', 'arena_mesh_303.bld'), 'utf8'), 'not an archive');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
