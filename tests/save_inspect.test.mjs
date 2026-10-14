import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  compareSaveBuffers,
  fnv1a32,
  inspectSaveBuffer,
  inspectSaveFile,
  readBitsLSB,
} from '../tools/save_inspect.mjs';

const cli = fileURLToPath(new URL('../tools/save_inspect.mjs', import.meta.url));
function synthetic(size = 1004) {
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32LE(fnv1a32(bytes.subarray(0, -4)), size - 4);
  return bytes;
}
function checksum(bytes) {
  bytes.writeUInt32LE(fnv1a32(bytes.subarray(0, -4)), bytes.length - 4);
  return bytes;
}

test('FNV-1a-32 matches independent standard test vectors', () => {
  assert.equal(fnv1a32(Buffer.alloc(0)), 0x811c9dc5);
  assert.equal(fnv1a32(Buffer.from('a')), 0xe40c292c);
  assert.equal(fnv1a32(Buffer.from('foobar')), 0xbf9cf968);
  assert.throws(() => fnv1a32('a'), /Expected bytes/);
});

test('observed lengths, little-endian checksum and tampering are explicit', () => {
  for (const size of [380, 1004]) {
    const bytes = synthetic(size);
    const result = inspectSaveBuffer(bytes);
    assert.equal(result.checksum.valid, true);
    assert.equal(result.checksum.payloadBytes, size - 4);
    assert.equal(result.observedLayout, size === 380 ? 'header-sized' : 'slot-sized');
    bytes[17] ^= 0x40;
    assert.equal(inspectSaveBuffer(bytes).checksum.valid, false);
    checksum(bytes);
    assert.equal(inspectSaveBuffer(bytes).checksum.valid, true);
  }
  for (const size of [0, 4, 379, 381, 1003, 1005]) {
    assert.throws(() => inspectSaveBuffer(Buffer.alloc(size)), /Unsupported save length/);
  }
  assert.throws(() => inspectSaveBuffer(new Uint8Array(380)), /Expected a Buffer/);
});

test('differences exclude checksum bytes and identify exact LSB-first bits', () => {
  const left = synthetic();
  const right = synthetic();
  left[0x143] = 2;
  checksum(left);
  const before = Buffer.from(left);
  assert.deepEqual(compareSaveBuffers(left, right), {
    payloadBytes: 1000,
    checksumBytesExcluded: 4,
    payloadDifferences: [{ offset: 323, offsetHex: '0x143', left: 2, right: 0, changedBitsLSB: [2585] }],
  });
  assert.deepEqual(left, before, 'inspection never modifies inputs');
  assert.throws(() => compareSaveBuffers(left, synthetic(380)), /different save layouts/);
});

test('bounded raw bit windows do not claim save field semantics', () => {
  const data = Buffer.from([0x80, 0x01, 0xff, 0xff, 0xff]);
  assert.equal(readBitsLSB(data, 7, 2), 3);
  assert.equal(readBitsLSB(Buffer.alloc(4, 255), 0, 32), 0xffffffff);
  for (const [offset, count] of [
    [-1, 1],
    [0.5, 2],
    [0, 0],
    [0, 33],
    [39, 2],
  ]) {
    assert.throws(() => readBitsLSB(data, offset, count), /Invalid bit window/);
  }
  const windows = inspectSaveBuffer(synthetic(380)).rawBitWindows;
  assert.deepEqual(
    windows.map((entry) => entry.bitOffset),
    [12, 157],
  );
  assert.ok(windows.every((entry) => entry.verifiedSemantics === false));
});

test('file reader refuses symlinks and unsupported sizes, preserving original data', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'save-inspect-'));
  const file = path.join(directory, 'synthetic-save');
  const bytes = synthetic();
  writeFileSync(file, bytes);
  assert.equal(inspectSaveFile(file).checksum.valid, true);
  assert.deepEqual(readFileSync(file), bytes);
  const link = path.join(directory, 'link');
  symlinkSync(file, link);
  assert.throws(() => inspectSaveFile(link), /non-symlink/);
  assert.throws(() => inspectSaveFile(directory), /regular/);
  const invalid = path.join(directory, 'invalid');
  writeFileSync(invalid, Buffer.alloc(1005));
  assert.throws(() => inspectSaveFile(invalid), /Unsupported save length/);
});

test('CLI reports valid JSON and distinct invalid-checksum/input statuses without writing', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'save-inspect-cli-'));
  const file = path.join(directory, 'left');
  const other = path.join(directory, 'right');
  const bytes = synthetic();
  writeFileSync(file, bytes);
  writeFileSync(other, bytes);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const success = run(file, '--compare', other);
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(JSON.parse(success.stdout).compare.payloadDifferences, []);
  bytes[5] ^= 1;
  writeFileSync(other, bytes);
  const invalid = run(file, '--compare', other);
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stdout).compare.checksum.valid, false);
  assert.equal(run(file, '--write', other).status, 1);
  assert.equal(run().status, 1);
  assert.equal(run('--help').status, 0);
  assert.deepEqual(readFileSync(file), synthetic());
  assert.deepEqual(readFileSync(other), bytes);
});
