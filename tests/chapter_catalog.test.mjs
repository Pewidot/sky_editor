import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeIgz } from './fixtures/igz_fixture.mjs';
import { selectArchives, buildChapterCatalog } from '../tools/chapter_catalog.mjs';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-chapter-test-'));
const extractor = path.join(temp, 'iga_extract');
execFileSync('c++', ['-std=c++17', '-O2', 'tools/iga_extract.cpp', '-llzma', '-o', extractor]);
function archive(data) {
  const b = Buffer.alloc(0x800 + data.length);
  for (const [at, v] of [
    [0, 0x1a414749],
    [4, 11],
    [8, 20],
    [12, 1],
    [16, 0x800],
    [0x28, 0x100],
    [0x30, 14],
    [0x38, 0xba91d879],
    [0x3c, 0x800],
    [0x44, data.length],
    [0x48, 0xffffffff],
    [0x100, 4],
  ])
    b.writeUInt32LE(v, at);
  b.write('level.bld\0', 0x104);
  data.copy(b, 0x800);
  return b;
}
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
test('candidate selection does not invent chapter order or accept traversal', () => {
  assert.deepEqual(
    selectArchives([
      'level_313_tutorial.bld',
      'arena_challenge_303_000.bld',
      '../level_300_x.bld',
      'level_300_x.bld',
    ]),
    ['level_300_x.bld', 'level_313_tutorial.bld'],
  );
  assert.throws(() => selectArchives([]), /1..64/);
});
test('private batch extracts and exports synthetic archives, preserves source and refuses overwrite', async () => {
  const gameRoot = path.join(temp, 'game');
  fs.mkdirSync(path.join(gameRoot, 'level'), { recursive: true });
  const source = path.join(gameRoot, 'level/level_313_tutorial.bld'),
    bytes = archive(makeIgz());
  fs.writeFileSync(source, bytes);
  const outputDirectory = path.join(temp, 'out');
  const r = await buildChapterCatalog({ gameRoot, outputDirectory, extractor });
  assert.equal(r.exported, 1);
  assert.equal(r.chapterOrderKnown, false);
  assert.equal(r.gameplaySchemaComplete, false);
  assert.equal(r.results[0].structure.counts.objects, 3);
  assert.deepEqual(r.results[0].screenshots, []);
  assert.deepEqual(fs.readFileSync(source), bytes);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDirectory, 'index.json'))).exported, 1);
  await assert.rejects(buildChapterCatalog({ gameRoot, outputDirectory, extractor }), /EEXIST/);
  await assert.rejects(
    buildChapterCatalog({ gameRoot, outputDirectory: path.join(gameRoot, 'output'), extractor }),
    /outside/,
  );
  await assert.rejects(
    buildChapterCatalog({ gameRoot, outputDirectory: path.join(temp, 'bad'), extractor, only: ['../fake'] }),
    /selection/,
  );
});
test('malformed or symlink candidate is recorded as failed, not as complete', async () => {
  const gameRoot = path.join(temp, 'badgame');
  fs.mkdirSync(path.join(gameRoot, 'level'), { recursive: true });
  fs.writeFileSync(path.join(gameRoot, 'level/level_300_bad.bld'), 'bad');
  fs.symlinkSync(
    path.join(gameRoot, 'level/level_300_bad.bld'),
    path.join(gameRoot, 'level/level_301_link.bld'),
  );
  const r = await buildChapterCatalog({ gameRoot, outputDirectory: path.join(temp, 'failed'), extractor });
  assert.equal(r.exported, 0);
  assert.equal(r.results.length, 2);
  assert.ok(r.results.every((x) => x.status === 'incomplete' && x.error));
});
