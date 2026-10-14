#!/usr/bin/env node

// Read-only observations for the CUSA00697 save files seen in this workspace.
// A matching length/checksum is not proof of a file's origin or field semantics.
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hex32 = (value) => `0x${value.toString(16).padStart(8, '0')}`;
const hexOffset = (value) => `0x${value.toString(16)}`;

export function fnv1a32(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected bytes');
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}

export function readBitsLSB(bytes, bitOffset, bitCount) {
  if (
    !(bytes instanceof Uint8Array) ||
    !Number.isSafeInteger(bitOffset) ||
    bitOffset < 0 ||
    !Number.isSafeInteger(bitCount) ||
    bitCount < 1 ||
    bitCount > 32 ||
    bitOffset + bitCount > bytes.length * 8
  )
    throw new RangeError('Invalid bit window');
  let value = 0;
  for (let bit = 0; bit < bitCount; bit += 1) {
    const sourceBit = bitOffset + bit;
    value += ((bytes[sourceBit >>> 3] >>> (sourceBit & 7)) & 1) * 2 ** bit;
  }
  return value;
}

function payloadOf(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Expected a Buffer');
  if (bytes.length !== 380 && bytes.length !== 1004) {
    throw new Error('Unsupported save length: expected the observed 380 or 1004 bytes');
  }
  return bytes.subarray(0, -4);
}

export function inspectSaveBuffer(bytes) {
  const payload = payloadOf(bytes);
  const stored = bytes.readUInt32LE(bytes.length - 4);
  const computed = fnv1a32(payload);
  const nonzeroPayloadBytes = [];
  for (let offset = 0; offset < payload.length; offset += 1) {
    if (payload[offset])
      nonzeroPayloadBytes.push({ offset, offsetHex: hexOffset(offset), value: payload[offset] });
  }
  const rawBitWindows =
    bytes.length === 380
      ? [12, 157].map((bitOffset) => ({
          bitOffset,
          bitOrder: 'least-significant-bit-first',
          elementBits: 8,
          values: Array.from({ length: 4 }, (_, index) => readBitsLSB(payload, bitOffset + index * 8, 8)),
          verifiedSemantics: false,
        }))
      : [];
  return {
    schema: 'skylanders-save-inspection-v1',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    observedLayout: bytes.length === 380 ? 'header-sized' : 'slot-sized',
    checksum: {
      algorithm: 'FNV-1a-32',
      payloadBytes: payload.length,
      storage: 'last 4 bytes, little-endian',
      stored: hex32(stored),
      computed: hex32(computed),
      valid: stored === computed,
    },
    nonzeroPayloadBytes,
    rawBitWindows,
    warning:
      'Read-only structural observations; no unlock, difficulty, intro or level-ID field semantics are verified.',
  };
}

export function compareSaveBuffers(left, right) {
  const a = payloadOf(left);
  const b = payloadOf(right);
  if (a.length !== b.length) throw new Error('Cannot compare different save layouts');
  const payloadDifferences = [];
  for (let offset = 0; offset < a.length; offset += 1) {
    if (a[offset] === b[offset]) continue;
    const changedBitsLSB = [];
    for (let bit = 0; bit < 8; bit += 1) {
      if (((a[offset] ^ b[offset]) >>> bit) & 1) changedBitsLSB.push(offset * 8 + bit);
    }
    payloadDifferences.push({
      offset,
      offsetHex: hexOffset(offset),
      left: a[offset],
      right: b[offset],
      changedBitsLSB,
    });
  }
  return { payloadBytes: a.length, checksumBytesExcluded: 4, payloadDifferences };
}

function readSaveFile(filename) {
  const resolved = path.resolve(filename);
  const before = lstatSync(resolved);
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error('Save input must be a regular, non-symlink file');
  if (before.size !== 380 && before.size !== 1004)
    throw new Error('Unsupported save length: expected 380 or 1004 bytes');
  const fd = openSync(
    resolved,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    ) {
      throw new Error('Save input changed before reading');
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error('Save input ended unexpectedly');
      offset += count;
    }
    const after = fstatSync(fd);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw new Error('Save input changed while reading; stop the emulator before inspection');
    }
    return { filename: resolved, bytes };
  } finally {
    closeSync(fd);
  }
}

export function inspectSaveFile(filename) {
  const input = readSaveFile(filename);
  return { path: input.filename, ...inspectSaveBuffer(input.bytes) };
}

function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node tools/save_inspect.mjs SAVE_FILE [--compare OTHER_SAVE_FILE]');
    return;
  }
  if (
    (args.length !== 1 && args.length !== 3) ||
    args[0].startsWith('--') ||
    (args.length === 3 && args[1] !== '--compare')
  ) {
    throw new Error('Usage: node tools/save_inspect.mjs SAVE_FILE [--compare OTHER_SAVE_FILE]');
  }
  const left = readSaveFile(args[0]);
  const result = { path: left.filename, ...inspectSaveBuffer(left.bytes) };
  if (args.length === 3) {
    const right = readSaveFile(args[2]);
    result.compare = {
      path: right.filename,
      ...inspectSaveBuffer(right.bytes),
      ...compareSaveBuffers(left.bytes, right.bytes),
    };
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.checksum.valid || (result.compare && !result.compare.checksum.valid)) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`save_inspect: ${error.message}`);
    process.exitCode = 1;
  }
}
