import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, createCipheriv } from 'node:crypto';
import { inspectWiiSaveBuffer, inspectWiiSave, makePs4SlotCandidate } from '../tools/wii_save_inspect.mjs';
import { fnv1a32 } from '../tools/save_inspect.mjs';

const HEADER = 0xf0c0;
const key = Buffer.from('ab01b9d8e1622b08afbad84dbfc2a55d', 'hex');
const iv = Buffer.from('216712e6aa1f689f95c5a22324dc6a98', 'hex');
const blanker = Buffer.from('0e65378199be4517ab06ec22451a5793', 'hex');
const sha = (b) => createHash('sha256').update(b).digest('hex');
function encrypt(data, vector) {
  const cipher = createCipheriv('aes-128-cbc', key, vector);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}
function ps4Slot() {
  // The two nonzero bytes of the observed unused PS4 slot; no game assets.
  const bytes = Buffer.alloc(1004);
  bytes[330] = 8;
  bytes[577] = 0x80;
  bytes.writeUInt32LE(fnv1a32(bytes.subarray(0, 1000)), 1000);
  return bytes;
}
function wiiSlot(ps4 = ps4Slot()) {
  const bytes = Buffer.from(ps4);
  bytes.subarray(0, 1000).swap32();
  bytes.writeUInt32BE(fnv1a32(bytes.subarray(0, 1000)), 1000);
  return bytes;
}
function container(
  members = [
    { name: 'Save_Slot_1', data: wiiSlot() },
    { name: 'Save_Slot_4', data: wiiSlot() },
    { name: 'backup', type: 2 },
    { name: 'backup/Save_Slot_1', data: wiiSlot() },
  ],
) {
  const header = Buffer.alloc(HEADER);
  header.writeBigUInt64BE(0x00010000534b3845n);
  header.writeUInt32BE(0x72a0, 8);
  header.write('WIBN', 32, 'ascii');
  for (const [i, c] of [...'Synthetic save'].entries()) header.writeUInt16BE(c.charCodeAt(0), 0x40 + i * 2);
  blanker.copy(header, 14);
  createHash('md5').update(header).digest().copy(header, 14);
  const records = members.map(({ name, data = Buffer.alloc(0), type = 1 }) => {
    const h = Buffer.alloc(0x80),
      vector = Buffer.alloc(16, 0x23);
    h.writeUInt32BE(0x03adf17e);
    h.writeUInt32BE(data.length, 4);
    h[8] = 0x35;
    h[10] = type;
    h.write(name, 11, 64, 'ascii');
    vector.copy(h, 0x50);
    const padded = Buffer.alloc(Math.ceil(data.length / 64) * 64);
    data.copy(padded);
    return Buffer.concat([h, type === 1 ? encrypt(padded, vector) : Buffer.alloc(0)]);
  });
  const files = Buffer.concat(records),
    backup = Buffer.alloc(0x80),
    footer = Buffer.alloc(0x340);
  backup.writeUInt32BE(0x70);
  backup.writeUInt32BE(0x426b0001, 4);
  backup.writeUInt32BE(members.length, 12);
  backup.writeUInt32BE(files.length, 16);
  backup.writeUInt32BE(files.length + 0x3c0, 28);
  backup.writeBigUInt64BE(0x00010000534b3845n, 0x60);
  footer.writeUInt32BE(0x2f536969, 0x3c);
  return Buffer.concat([encrypt(header, iv), backup, files, footer]);
}
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wii-save-inspect-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('slot word swap is exact, input-preserving, and recalculates checksum', () => {
  const ps4 = Buffer.alloc(1004);
  for (let i = 0; i < 1000; i++) ps4[i] = (i * 17 + 5) & 255;
  ps4.writeUInt32LE(fnv1a32(ps4.subarray(0, 1000)), 1000);
  const wii = wiiSlot(ps4),
    original = Buffer.from(wii),
    { data, manifest } = makePs4SlotCandidate(wii);
  assert.deepEqual(data, ps4);
  assert.deepEqual(wii, original);
  assert.notEqual(data.readUInt32LE(1000), wii.readUInt32BE(1000));
  assert.equal(manifest.experimental, true);
  assert.equal(manifest.runtimeValidated, false);
  assert.equal(manifest.headerConverted, false);
  assert.equal(manifest.outputSha256, sha(data));
});

test('observed empty slot matches all 1004 bytes after swap and checksum recomputation', () => {
  const ps4 = ps4Slot(),
    wii = wiiSlot(ps4);
  assert.equal(ps4.readUInt32LE(1000), 0x0814259d);
  assert.equal(wii.readUInt32BE(1000), 0x08f8c68d);
  assert.equal(sha(ps4), 'bf8d303783ffc74276bb6b1d453febdb427a7ac305cf9341413cd5a6f3741bd7');
  assert.equal(sha(wii), 'aa225279f47e071bd4397d9f4a8633acb2cbcf1eec0a1c4ee72d01f5caeb64b8');
  assert.deepEqual(makePs4SlotCandidate(wii).data, ps4);
});

test('candidate rejects headers, malformed lengths, and bad big-endian checksums', () => {
  for (const length of [0, 380, 1000, 1005])
    assert.throws(() => makePs4SlotCandidate(Buffer.alloc(length)), /1004-byte/);
  const corrupt = wiiSlot();
  corrupt[123] ^= 1;
  assert.throws(() => makePs4SlotCandidate(corrupt), /checksum/);
  assert.throws(() => makePs4SlotCandidate(ps4Slot()), /checksum/);
});

test('synthetic container decrypts per-file IVs, directory, checksums and header', () => {
  const source = container(),
    original = Buffer.from(source),
    { report, entries } = inspectWiiSaveBuffer(source);
  assert.equal(report.title.id, '00010000534b3845');
  assert.equal(report.title.bannerTitle, 'Synthetic save');
  assert.equal(report.headerMd5.valid, true);
  assert.equal(report.signature.authenticated, false);
  assert.equal(entries.length, 4);
  assert.deepEqual(entries[0].data, wiiSlot());
  assert.equal(entries[0].checksum.validBigEndian, true);
  assert.equal(entries[2].type, 'directory');
  assert.equal(entries[2].data, null);
  assert.deepEqual(source, original);
});

test('malformed container bounds, header authentication and footer fail closed', () => {
  const mutations = [
    (b) => b.subarray(0, b.length - 1),
    (b) => {
      b[20] ^= 1;
      return b;
    },
    (b) => {
      b.writeUInt32BE(4097, HEADER + 12);
      return b;
    },
    (b) => {
      b.writeUInt32BE(0xffffffff, HEADER + 0x80 + 4);
      return b;
    },
    (b) => {
      b[HEADER + 0x67] ^= 1;
      return b;
    },
    (b) => {
      b[b.length - 0x340 + 0x3c] ^= 1;
      return b;
    },
    (b) => {
      b[HEADER + 0x80 + 10] = 3;
      return b;
    },
  ];
  for (const mutate of mutations) assert.throws(() => inspectWiiSaveBuffer(mutate(container())));
});

test('unsafe, duplicate and file-parent paths are rejected before extraction', () => {
  for (const name of ['../Save', '/Save', 'a/../Save', 'a//Save', 'a\\Save', 'C:Save'])
    assert.throws(() => inspectWiiSaveBuffer(container([{ name, data: wiiSlot() }])), /Unsafe/);
  assert.throws(() => inspectWiiSaveBuffer(container([{ name: 'same' }, { name: 'same' }])), /Duplicate/);
  assert.throws(
    () => inspectWiiSaveBuffer(container([{ name: 'parent' }, { name: 'parent/file' }])),
    /parent file/,
  );
});

test('extraction and explicit candidate create private new files and preserve inputs', (t) => {
  const root = temporary(t),
    source = path.join(root, 'input.bin'),
    reference = path.join(root, 'ps4-empty');
  const output = path.join(root, 'inspection'),
    bytes = container();
  fs.writeFileSync(source, bytes);
  fs.writeFileSync(reference, ps4Slot());
  const before = fs.statSync(source);
  const report = inspectWiiSave({
    source,
    expectedSha256: sha(bytes),
    ps4Empty: reference,
    outputDirectory: output,
    candidateSlot1: true,
  });
  assert.equal(report.emptySlotComparison.exactMatch, true);
  assert.equal(report.candidate.runtimeValidated, false);
  assert.deepEqual(fs.readFileSync(path.join(output, report.candidate.path)), ps4Slot());
  assert.deepEqual(fs.readFileSync(path.join(output, 'wii-payloads/Save_Slot_1')), wiiSlot());
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'inspection.json'))), report);
  assert.equal(fs.statSync(output).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(output, report.candidate.path)).mode & 0o777, 0o600);
  assert.deepEqual(fs.readFileSync(source), bytes);
  assert.equal(fs.statSync(source).mtimeMs, before.mtimeMs);
  assert.deepEqual(fs.readFileSync(reference), ps4Slot());
  assert.throws(
    () => inspectWiiSave({ source, expectedSha256: sha(bytes), outputDirectory: output }),
    /EEXIST/,
  );
});

test('read-only default, hash gates, and symlink handling never overwrite paths', (t) => {
  const root = temporary(t),
    source = path.join(root, 'input.bin'),
    output = path.join(root, 'new'),
    bytes = container();
  fs.writeFileSync(source, bytes);
  const before = fs.readdirSync(root);
  inspectWiiSave({ source });
  assert.deepEqual(fs.readdirSync(root), before);
  assert.throws(() => inspectWiiSave({ source, outputDirectory: output }), /expectedSha256/);
  assert.throws(
    () => inspectWiiSave({ source, expectedSha256: '0'.repeat(64), outputDirectory: output }),
    /SHA-256/,
  );
  assert.throws(() => inspectWiiSave({ source, candidateSlot1: true }), /outputDirectory/);
  assert.equal(fs.existsSync(output), false);
  fs.symlinkSync(source, path.join(root, 'source-link'));
  assert.throws(() => inspectWiiSave({ source: path.join(root, 'source-link') }), /ELOOP/);
  fs.symlinkSync(path.join(root, 'absent'), output);
  assert.throws(
    () => inspectWiiSave({ source, expectedSha256: sha(bytes), outputDirectory: output }),
    /EEXIST/,
  );
  assert.equal(fs.existsSync(path.join(root, 'absent')), false);
});

test(
  'optional user-owned Wii/PS4 comparison is read-only',
  {
    skip: !process.env.SKYLANDERS_TEST_WII_SAVE || !process.env.SKYLANDERS_TEST_PS4_EMPTY,
  },
  () => {
    const report = inspectWiiSave({
      source: process.env.SKYLANDERS_TEST_WII_SAVE,
      ps4Empty: process.env.SKYLANDERS_TEST_PS4_EMPTY,
    });
    assert.equal(report.title.id, '00010000534b3845');
    assert.equal(report.emptySlotComparison.exactMatch, true);
    assert.equal(report.files.filter((e) => e.type === 'file').length, 6);
    assert.ok(report.files.filter((e) => e.type === 'file').every((e) => e.checksum?.validBigEndian));
  },
);
