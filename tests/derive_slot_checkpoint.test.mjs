import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deriveSlotCheckpoint, SLOT_PATH, HEADER_PATH } from '../tools/derive_slot_checkpoint.mjs';
import { restoreCheckpoint } from '../tools/runtime_checkpoint.mjs';
import { fnv1a32 } from '../tools/save_inspect.mjs';
import { createFigure, inspectFigure } from '../tools/sky_figure.mjs';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function save(size, edit = () => {}) {
  const bytes = Buffer.alloc(size);
  edit(bytes);
  bytes.writeUInt32LE(fnv1a32(bytes.subarray(0, -4)), size - 4);
  return bytes;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-slot-checkpoint-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'original'),
    output = path.join(root, 'derived'),
    candidate = path.join(root, 'candidate.bin');
  fs.mkdirSync(source);
  const figure = createFigure(16),
    slot = save(1004, (b) => {
      b[323] = 2;
    });
  const members = new Map([
    [SLOT_PATH, slot],
    [HEADER_PATH, save(380)],
    ['user/config.json', Buffer.from('{"untouched":true}')],
    [SLOT_PATH.replace('_1', '_2'), save(1004)],
    ['figures/test.sky', figure],
  ]);
  for (const [name, bytes] of members) {
    const filename = path.join(source, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, bytes);
  }
  const manifest = {
    format: 'skylanders-runtime-checkpoint-v1',
    createdAt: '2000-01-01T00:00:00.000Z',
    sourceSession: '/synthetic-only',
    emulator: '/not-launched',
    game: '/not-launched/eboot.bin',
    launchArguments: ['synthetic-test-metadata'],
    figures: [{ slot: 0, path: 'figures/test.sky', ...inspectFigure(figure) }],
    files: [...members].map(([name, bytes]) => ({ path: name, size: bytes.length, sha256: sha(bytes) })),
  };
  const manifestFile = path.join(source, 'checkpoint.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const candidateBytes = save(1004, (b) => {
    b[323] = 2;
    b[500] = 0xa9;
  });
  fs.writeFileSync(candidate, candidateBytes);
  const options = {
    sourceCheckpoint: source,
    candidate,
    outputDirectory: output,
    expectedCandidateSha256: sha(candidateBytes),
    expectedCheckpointSha256: sha(fs.readFileSync(manifestFile)),
  };
  return { root, source, output, candidate, candidateBytes, members, manifest, manifestFile, options };
}

test('derived checkpoint changes only slot 1 and is independently restorable, with honest provenance', (t) => {
  const f = fixture(t),
    beforeManifest = fs.readFileSync(f.manifestFile),
    beforeStat = fs.statSync(f.manifestFile);
  const result = deriveSlotCheckpoint(f.options);
  assert.equal(result.runtimeValidated, false);
  assert.equal(result.sourceSession, null);
  assert.equal(result.experiment.emulatorLaunched, false);
  assert.equal(result.experiment.headerConverted, false);
  assert.equal(result.derivedFrom.manifestSha256, sha(beforeManifest));
  assert.equal(result.experiment.changedFiles.length, 1);
  assert.equal(result.experiment.changedFiles[0].path, SLOT_PATH);
  assert.equal(result.experiment.unchangedFileCount, f.members.size - 1);
  assert.equal(result.experiment.preservedHeaderSha256, sha(f.members.get(HEADER_PATH)));
  for (const [name, bytes] of f.members) {
    assert.deepEqual(fs.readFileSync(path.join(f.source, name)), bytes);
    assert.deepEqual(
      fs.readFileSync(path.join(f.output, name)),
      name === SLOT_PATH ? f.candidateBytes : bytes,
    );
    assert.notEqual(fs.statSync(path.join(f.source, name)).ino, fs.statSync(path.join(f.output, name)).ino);
  }
  assert.deepEqual(fs.readFileSync(f.manifestFile), beforeManifest);
  assert.equal(fs.statSync(f.manifestFile).mtimeMs, beforeStat.mtimeMs);
  assert.deepEqual(fs.readFileSync(f.candidate), f.candidateBytes);
  assert.equal(fs.existsSync(path.join(f.output, 'portal-events.jsonl')), false);
  assert.equal(fs.statSync(f.output).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(f.output, 'checkpoint.json')).mode & 0o777, 0o600);
  assert.ok(!fs.readdirSync(f.root).some((name) => name.startsWith('.checkpoint-validation-')));
  const restored = path.join(f.root, 'restored');
  fs.mkdirSync(restored);
  assert.deepEqual(restoreCheckpoint(f.output, restored).files, result.files);
  assert.deepEqual(fs.readFileSync(path.join(restored, SLOT_PATH)), f.candidateBytes);
});

test('candidate and source hash gates reject before creating output', (t) => {
  const f = fixture(t);
  for (const options of [
    { ...f.options, expectedCandidateSha256: undefined },
    { ...f.options, expectedCandidateSha256: '0'.repeat(64) },
    { ...f.options, expectedCheckpointSha256: '0'.repeat(64) },
  ]) {
    assert.throws(() => deriveSlotCheckpoint(options), /[Ss][Hh][Aa]|expectedCandidate/);
    assert.equal(fs.existsSync(f.output), false);
  }
  for (const bytes of [Buffer.alloc(1005), save(380), Buffer.alloc(1004)]) {
    fs.writeFileSync(f.candidate, bytes);
    assert.throws(
      () => deriveSlotCheckpoint({ ...f.options, expectedCandidateSha256: sha(bytes) }),
      /bounded|1004 bytes/,
    );
    assert.equal(fs.existsSync(f.output), false);
  }
});

test('existing destinations, dangling links, source aliases and source descendants cannot be overwritten', (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.output);
  fs.writeFileSync(path.join(f.output, 'keep'), 'untouched');
  assert.throws(() => deriveSlotCheckpoint(f.options), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(f.output, 'keep'), 'utf8'), 'untouched');
  const dangling = path.join(f.root, 'dangling');
  fs.symlinkSync(path.join(f.root, 'missing'), dangling);
  assert.throws(() => deriveSlotCheckpoint({ ...f.options, outputDirectory: dangling }), /EEXIST/);
  const alias = path.join(f.root, 'source-alias');
  fs.symlinkSync(f.source, alias);
  assert.throws(
    () => deriveSlotCheckpoint({ ...f.options, outputDirectory: path.join(alias, 'nested') }),
    /outside/,
  );
  assert.equal(fs.existsSync(path.join(f.source, 'nested')), false);
  assert.throws(() => deriveSlotCheckpoint({ ...f.options, sourceCheckpoint: alias }), /symlink/);
});

test('candidate and checkpoint member symlinks reject without changing their targets', (t) => {
  const f = fixture(t),
    candidateLink = path.join(f.root, 'candidate-link');
  fs.symlinkSync(f.candidate, candidateLink);
  assert.throws(() => deriveSlotCheckpoint({ ...f.options, candidate: candidateLink }), /ELOOP/);
  const member = path.join(f.source, SLOT_PATH);
  fs.unlinkSync(member);
  fs.symlinkSync(f.candidate, member);
  assert.throws(() => deriveSlotCheckpoint(f.options), /symlink/);
  assert.equal(fs.existsSync(f.output), false);
  assert.deepEqual(fs.readFileSync(f.candidate), f.candidateBytes);
});

test('traversal, duplicate inventory, unlisted members and altered source bytes reject', (t) => {
  const f = fixture(t);
  for (const modify of [
    (m) => {
      m.files[0].path = 'user/../../outside';
    },
    (m) => {
      m.files[0].path = '/outside';
    },
    (m) => {
      m.files.push({ ...m.files[0] });
    },
    (m) => {
      m.files[0].sha256 = '0'.repeat(64);
    },
    (m) => {
      m.files = m.files.filter((entry) => entry.path !== HEADER_PATH);
    },
  ]) {
    const manifest = structuredClone(f.manifest);
    modify(manifest);
    fs.writeFileSync(f.manifestFile, JSON.stringify(manifest));
    assert.throws(
      () => deriveSlotCheckpoint({ ...f.options, expectedCheckpointSha256: undefined }),
      /[Ii]nventory|checkpoint|Checkpoint/,
    );
    assert.equal(fs.existsSync(f.output), false);
  }
  fs.writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
  fs.writeFileSync(path.join(f.source, 'user/unlisted'), 'no');
  assert.throws(() => deriveSlotCheckpoint(f.options), /inventory/);
  assert.equal(fs.existsSync(f.output), false);
});

test('source save checksums and exact target presence are required; no-op candidates reject', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.candidate, f.members.get(SLOT_PATH));
  assert.throws(
    () => deriveSlotCheckpoint({ ...f.options, expectedCandidateSha256: sha(f.members.get(SLOT_PATH)) }),
    /not change/,
  );
  fs.writeFileSync(f.candidate, f.candidateBytes);
  const header = Buffer.from(f.members.get(HEADER_PATH));
  header[0] ^= 1;
  fs.writeFileSync(path.join(f.source, HEADER_PATH), header);
  const manifest = structuredClone(f.manifest);
  manifest.files.find((file) => file.path === HEADER_PATH).sha256 = sha(header);
  fs.writeFileSync(f.manifestFile, JSON.stringify(manifest));
  assert.throws(
    () => deriveSlotCheckpoint({ ...f.options, expectedCheckpointSha256: undefined }),
    /valid PS4 checksums/,
  );
  assert.equal(fs.existsSync(f.output), false);
});
