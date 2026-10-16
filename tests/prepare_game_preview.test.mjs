import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  prepareGamePreview,
  readPreviewProfile,
  validatePreviewRequest,
} from '../tools/prepare_game_preview.mjs';
import { makeIgz } from './fixtures/igz_fixture.mjs';
import { parseIgz } from '../tools/igz.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
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
function fixture() {
  const root = fs.mkdtempSync(
    path.join(process.env.SKYLANDERS_PREVIEW_TEST_TMP ?? os.tmpdir(), 'sky-preview-test-'),
  );
  const put = (rel, bytes) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return file;
  };
  const inner = makeIgz(),
    outer = archive(inner),
    levelPath = put('inner.bld', inner),
    gameRoot = path.join(root, 'game'),
    outputRoot = path.join(root, 'runs');
  fs.mkdirSync(outputRoot);
  const emulator = put('shadps4', 'synthetic emulator - never executed');
  put('game/eboot.bin', 'synthetic game');
  const archiveSource = put('original.bld', outer),
    titleArchive = put('title.bld', 'synthetic title');
  put('game/level/level_test.bld', outer);
  put('game/level/title.bld', 'old title');
  put('game/permanent/global.bld', 'registration');
  const asset = put('assets/texture.bld', 'linked source asset');
  fs.symlinkSync(asset, path.join(gameRoot, 'level/texture.bld'));
  const checkpoint = path.join(root, 'checkpoint');
  put('checkpoint/checkpoint.json', JSON.stringify({ format: 'skylanders-runtime-checkpoint-v1' }));
  const profile = {
    schema: 'skylanders-game-preview-v1',
    emulator,
    emulatorSha256: sha(fs.readFileSync(emulator)),
    gameRoot,
    gameExecutableSha256: sha('synthetic game'),
    checkpoint,
    outputRoot,
    gamePins: { 'permanent/global.bld': sha('registration') },
    assetRoots: [path.join(root, 'assets')],
    maps: [
      {
        sourceSha256: sha(inner),
        loadString: 'Level_Test',
        label: 'Synthetic chapter',
        archivePath: 'level/level_test.bld',
        archiveSource,
        archiveSourceSha256: sha(outer),
        previewInner: levelPath,
        previewInnerSha256: sha(inner),
        titleArchive,
        titleArchiveSha256: sha('synthetic title'),
      },
    ],
  };
  const profilePath = put('profile.json', JSON.stringify(profile));
  return {
    root,
    profile,
    profilePath,
    levelPath,
    inner,
    outer,
    put,
    save: () => fs.writeFileSync(profilePath, JSON.stringify(profile)),
    request: {
      profilePath,
      levelPath,
      expectedSha256: sha(inner),
      edits: [{ id: 1, position: [10, 20, 30] }],
    },
  };
}
test('preview request rejects ambiguous source, unknown fields and malformed edits', () => {
  const valid = {
    profilePath: '/profile.json',
    levelPath: '/level.bld',
    expectedSha256: 'a'.repeat(64),
    edits: [],
  };
  assert.doesNotThrow(() => validatePreviewRequest(valid));
  for (const r of [
    { ...valid, levelPath: 'relative' },
    { ...valid, launch: true },
    { ...valid, expectedSha256: 'x' },
    { ...valid, edits: [{ id: 1, position: [NaN, 0, 0] }] },
    {
      ...valid,
      edits: [
        { id: 1, position: [0, 0, 0] },
        { id: 1, position: [1, 2, 3] },
      ],
    },
  ])
    assert.throws(() => validatePreviewRequest(r));
});
test('unbound or changed map never prepares another chapter', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      prepareGamePreview({ ...f.request, expectedSha256: '0'.repeat(64) }),
      /no configured native chapter/,
    );
    fs.appendFileSync(f.levelPath, 'changed');
    await assert.rejects(prepareGamePreview(f.request), /SHA-256 changed/);
    assert.deepEqual(fs.readdirSync(f.profile.outputRoot), []);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
test('profiles reject duplicate bindings, traversal and unlisted asset links before preparation', async () => {
  const f = fixture();
  try {
    f.profile.maps.push({ ...f.profile.maps[0] });
    f.save();
    assert.throws(() => readPreviewProfile(f.profilePath), /Duplicate/);
    f.profile.maps.pop();
    f.profile.maps[0].archivePath = '../game.bld';
    f.save();
    assert.throws(() => readPreviewProfile(f.profilePath), /Unsafe/);
    f.profile.maps[0].archivePath = 'level/level_test.bld';
    f.profile.assetRoots = [];
    f.save();
    await assert.rejects(prepareGamePreview(f.request), /escapes configured/);
    assert.deepEqual(fs.readdirSync(f.profile.outputRoot), []);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
test('current staged edit is packed in a new independent game, with fresh session and intact sources', async (t) => {
  const f = fixture();
  try {
    let r;
    try {
      r = await prepareGamePreview(f.request);
    } catch (e) {
      if (['EXDEV', 'EOPNOTSUPP', 'ENOTSUP', 'ENOSYS'].includes(e.cause?.code)) {
        t.skip('Host temporary filesystem cannot create reflinks');
        return;
      }
      throw e;
    }
    assert.equal(r.emulatorStarted, false);
    assert.equal(r.editCount, 1);
    assert.equal(r.map.sourceSha256, f.request.expectedSha256);
    assert.equal(r.levelPath, f.levelPath);
    assert.equal(fs.existsSync(r.session), false);
    assert.equal(r.x11, true);
    const packed = fs.readFileSync(path.join(path.dirname(r.game), r.map.archivePath)),
      start = packed.readUInt32LE(0x3c),
      length = packed.readUInt32LE(0x44);
    const z = parseIgz(packed.subarray(start, start + length));
    assert.deepEqual(
      [0, 1, 2].map((i) => z.buffer.readFloatLE(z.objects[1].offset + 0x40 + i * 4)),
      [10, 20, 30],
    );
    assert.deepEqual(fs.readFileSync(f.levelPath), f.inner);
    assert.deepEqual(fs.readFileSync(f.profile.maps[0].archiveSource), f.outer);
    assert.equal(fs.readFileSync(path.join(f.profile.gameRoot, 'level/title.bld'), 'utf8'), 'old title');
    assert.equal(
      fs.readFileSync(path.join(path.dirname(r.game), 'level/title.bld'), 'utf8'),
      'synthetic title',
    );
    assert.notEqual(fs.statSync(r.game).ino, fs.statSync(path.join(f.profile.gameRoot, 'eboot.bin')).ino);
    assert.equal(fs.lstatSync(path.join(path.dirname(r.game), 'level/texture.bld')).isSymbolicLink(), true);
    const again = await prepareGamePreview(f.request);
    assert.notEqual(again.session, r.session);
    assert.notEqual(again.game, r.game);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
