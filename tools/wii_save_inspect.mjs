#!/usr/bin/env node
// Read-only Wii SD save inspection; optional extraction to a NEW private
// directory. A separately requested endian candidate is NOT a proven converter.
// Container facts/constants: Dolphin Emulator's WiiSaveStructs.h, WiiSave.cpp
// and IOSC.cpp at the pinned upstream revision below. No emulator is launched.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createDecipheriv } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fnv1a32, readBitsLSB } from './save_inspect.mjs';

const HEADER = 0xf0c0,
  BACKUP = 0x80,
  ENTRY = 0x80,
  LIMIT = 64 * 1024 * 1024;
const SD_KEY = Buffer.from('ab01b9d8e1622b08afbad84dbfc2a55d', 'hex');
const HEADER_IV = Buffer.from('216712e6aa1f689f95c5a22324dc6a98', 'hex');
const MD5_BLANKER = Buffer.from('0e65378199be4517ab06ec22451a5793', 'hex');
export const WII_SAVE_UPSTREAM = Object.freeze({
  project: 'dolphin-emu/dolphin',
  revision: '8d2ad1a662472955497e5bb79d7b9ec6999e1f0d',
  paths: [
    'Source/Core/Core/HW/WiiSaveStructs.h',
    'Source/Core/Core/HW/WiiSave.cpp',
    'Source/Core/Core/IOS/IOSC.cpp',
  ],
});
const check = (ok, text) => {
  if (!ok) throw new Error(text);
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const align = (n, a) => Math.ceil(n / a) * a;
const hex32 = (n) => '0x' + n.toString(16).padStart(8, '0');
function decrypt(bytes, iv) {
  check(bytes.length % 16 === 0 && iv.length === 16, 'Invalid AES-CBC extent');
  const cipher = createDecipheriv('aes-128-cbc', SD_KEY, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(bytes), cipher.final()]);
}
function checksum(data) {
  if (data.length !== 380 && data.length !== 1004) return null;
  const computed = fnv1a32(data.subarray(0, -4)),
    be = data.readUInt32BE(data.length - 4),
    le = data.readUInt32LE(data.length - 4);
  return {
    algorithm: 'FNV-1a-32',
    payloadBytes: data.length - 4,
    computed: hex32(computed),
    storedBigEndian: hex32(be),
    storedLittleEndian: hex32(le),
    validBigEndian: be === computed,
    validLittleEndian: le === computed,
  };
}
function safeMemberName(bytes) {
  const end = bytes.indexOf(0),
    nameBytes = end < 0 ? bytes : bytes.subarray(0, end);
  check(
    nameBytes.length > 0 && nameBytes.every((b) => b >= 0x20 && b <= 0x7e),
    'Unsupported/non-ASCII member name',
  );
  const name = nameBytes.toString('ascii');
  check(
    !name.includes('\\') &&
      !name.includes(':') &&
      !name.startsWith('/') &&
      name.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Unsafe member path',
  );
  return name;
}
function titleText(bytes) {
  let text = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const value = bytes.readUInt16BE(i);
    if (!value) break;
    text += String.fromCharCode(value);
  }
  return text;
}

/** Identify and decrypt in memory, without executing or importing the save.
 * Header MD5 is checked, but ECC signatures are NOT authenticated.
 */
export function inspectWiiSaveBuffer(input) {
  check(
    Buffer.isBuffer(input) && input.length >= HEADER + BACKUP + 0x340 && input.length <= LIMIT,
    'Expected a bounded Wii SD data.bin container (maximum 64 MiB)',
  );
  const header = decrypt(input.subarray(0, HEADER), HEADER_IV),
    md5Stored = Buffer.from(header.subarray(14, 30));
  const forMd5 = Buffer.from(header);
  MD5_BLANKER.copy(forMd5, 14);
  const md5Computed = createHash('md5').update(forMd5).digest();
  check(md5Stored.equals(md5Computed), 'Wii decrypted header MD5 mismatch');
  const bannerSize = header.readUInt32BE(8),
    titleId = header.readBigUInt64BE(0);
  check(
    bannerSize >= 0x72a0 && bannerSize <= 0xf0a0 && (bannerSize - 0x60a0) % 0x1200 === 0,
    'Unsupported Wii banner size',
  );
  check(header.toString('ascii', 32, 36) === 'WIBN', 'Missing Wii banner magic');
  check(
    input.readUInt32BE(HEADER) === 0x70 && input.readUInt32BE(HEADER + 4) === 0x426b0001,
    'Invalid Wii backup header',
  );
  check(input.readBigUInt64BE(HEADER + 0x60) === titleId, 'Wii header and backup title IDs disagree');
  const count = input.readUInt32BE(HEADER + 12),
    filesSize = input.readUInt32BE(HEADER + 16),
    totalSize = input.readUInt32BE(HEADER + 28);
  check(
    count <= 4096 && filesSize + 0x3c0 === totalSize && HEADER + totalSize === input.length,
    'Invalid Wii backup counts/extents',
  );
  const filesEnd = HEADER + BACKUP + filesSize;
  check(filesEnd <= input.length - 0x340, 'Wii member region exceeds container');
  let at = HEADER + BACKUP;
  const entries = [],
    names = new Map();
  for (let i = 0; i < count; i++) {
    check(
      at + ENTRY <= filesEnd && input.readUInt32BE(at) === 0x03adf17e,
      'Truncated/invalid Wii member header',
    );
    const headerOffset = at,
      size = input.readUInt32BE(at + 4),
      type = input[at + 10],
      name = safeMemberName(input.subarray(at + 11, at + 75));
    check((type === 1 || type === 2) && (type !== 2 || size === 0), 'Unsupported Wii member type/size');
    check(!names.has(name), 'Duplicate Wii member path');
    names.set(name, type);
    const paddedSize = type === 1 ? align(size, 64) : 0,
      iv = input.subarray(at + 0x50, at + 0x60);
    at += ENTRY;
    check(at + paddedSize <= filesEnd, 'Wii member payload exceeds declared region');
    const data = type === 1 ? decrypt(input.subarray(at, at + paddedSize), iv).subarray(0, size) : null;
    const info = {
      path: name,
      type: type === 1 ? 'file' : 'directory',
      size,
      headerOffset,
      dataOffset: at,
      paddedSize,
      permissions: input[headerOffset + 8],
      attributes: input[headerOffset + 9],
      ...(data
        ? {
            sha256: sha(data),
            checksum: checksum(data),
            nonzeroPayloadBytes: data.subarray(0, Math.max(0, data.length - 4)).filter((b) => b !== 0).length,
          }
        : {}),
    };
    entries.push({ ...info, data });
    at += paddedSize;
  }
  check(at === filesEnd, 'Wii member sizes do not consume the declared file region');
  for (const [name] of names) {
    const parts = name.split('/');
    while (parts.length > 1) {
      parts.pop();
      check(names.get(parts.join('/')) !== 1, 'Wii file path overlaps a parent file');
    }
  }
  check(input.readUInt32BE(filesEnd + 0x3c) === 0x2f536969, 'Missing Wii signature trailer marker');
  const report = {
    schema: 'skylanders-wii-save-inspection-v1',
    upstream: WII_SAVE_UPSTREAM,
    source: { size: input.length, sha256: sha(input) },
    format: 'Wii SD data.bin',
    title: {
      id: titleId.toString(16).padStart(16, '0'),
      gameCode: header.subarray(4, 8).toString('ascii'),
      bannerTitle: titleText(header.subarray(0x40, 0x80)),
      bannerSubtitle: titleText(header.subarray(0x80, 0xc0)),
      bannerSize,
    },
    headerMd5: { stored: md5Stored.toString('hex'), computed: md5Computed.toString('hex'), valid: true },
    backup: { count, filesSize, totalSize, deviceId: hex32(input.readUInt32BE(HEADER + 8)) },
    signature: {
      offset: filesEnd,
      size: input.length - filesEnd,
      sha256: sha(input.subarray(filesEnd)),
      markerValid: true,
      authenticated: false,
      limitation: 'ECC certificate/signature authenticity was not verified.',
    },
    files: entries.map(({ data, ...info }) => info),
    limitations: [
      'Decrypted structure and checksums are not proof that a save is complete or that it works in another platform/version.',
      'No save was imported; no installed game, emulator profile or checkpoint was modified.',
    ],
  };
  return { report, entries };
}

/** A candidate only: word swap the 1000-byte slot payload, then recalculate its
 * FNV checksum over the NEW byte order. Never merely swap the old checksum.
 */
export function makePs4SlotCandidate(wiiSlot) {
  check(
    Buffer.isBuffer(wiiSlot) && wiiSlot.length === 1004,
    'Experimental candidate requires exactly a 1004-byte Wii slot',
  );
  check(checksum(wiiSlot).validBigEndian, 'Wii slot FNV-1a checksum is not valid big-endian');
  const data = Buffer.from(wiiSlot);
  data.subarray(0, 1000).swap32();
  data.writeUInt32LE(fnv1a32(data.subarray(0, 1000)), 1000);
  return {
    data,
    manifest: {
      method: 'swap32 each payload word; recompute FNV-1a-32; store checksum little-endian',
      sourceSha256: sha(wiiSlot),
      outputSha256: sha(data),
      size: data.length,
      checksum: checksum(data),
      experimental: true,
      runtimeValidated: false,
      headerConverted: false,
      limitation:
        'Matching an empty slot does not establish completed-progress semantics, version compatibility or tutorial skipping.',
    },
  };
}

function readRegular(filename, maximum = LIMIT) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    check(stat.isFile() && stat.size <= maximum, 'Input must be a bounded regular file');
    const bytes = Buffer.alloc(stat.size);
    let at = 0;
    while (at < bytes.length) {
      const n = fs.readSync(fd, bytes, at, Math.min(1024 * 1024, bytes.length - at), at);
      check(n > 0, 'Input ended early');
      at += n;
    }
    const after = fs.fstatSync(fd),
      current = fs.lstatSync(filename);
    check(
      stat.dev === current.dev &&
        stat.ino === current.ino &&
        stat.size === after.size &&
        stat.mtimeMs === after.mtimeMs &&
        stat.ctimeMs === after.ctimeMs,
      'Input changed during read',
    );
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

export function inspectWiiSave({
  source,
  expectedSha256,
  outputDirectory,
  ps4Empty,
  candidateSlot1 = false,
}) {
  check(
    typeof source === 'string' && typeof candidateSlot1 === 'boolean',
    'Explicit source and boolean candidateSlot1 required',
  );
  source = path.resolve(source);
  const input = readRegular(source),
    digest = sha(input);
  if (expectedSha256 !== undefined)
    check(
      typeof expectedSha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(expectedSha256) &&
        digest === expectedSha256,
      'Source SHA-256 mismatch',
    );
  const { report, entries } = inspectWiiSaveBuffer(input);
  report.source.path = source;
  if (ps4Empty !== undefined) {
    ps4Empty = path.resolve(ps4Empty);
    const empty = readRegular(ps4Empty, 1004);
    check(
      empty.length === 1004 && checksum(empty).validLittleEndian,
      'Reference must be a valid little-endian PS4 slot-sized file',
    );
    const slot4 = entries.find((e) => e.path === 'Save_Slot_4' && e.type === 'file');
    check(slot4, 'Container lacks Save_Slot_4 for comparison');
    const converted = makePs4SlotCandidate(slot4.data);
    const differences = [];
    for (let i = 0; i < empty.length; i++) if (empty[i] !== converted.data[i]) differences.push(i);
    report.emptySlotComparison = {
      wiiMember: slot4.path,
      referencePath: ps4Empty,
      referenceSha256: sha(empty),
      wordSwappedRechecksummedSha256: sha(converted.data),
      exactMatch: empty.equals(converted.data),
      differingByteOffsets: differences,
      semanticProof: 'Only byte equality to this supplied reference; not a general conversion proof.',
    };
  }
  const header = entries.find((e) => e.path === 'Save_Header' && e.size === 380);
  if (header) {
    const normalized = Buffer.from(header.data.subarray(0, 376));
    normalized.swap32();
    report.headerRawCandidates = {
      transformation: 'swap32 in memory only; no header conversion is supplied',
      verifiedSemantics: false,
      windows: [12, 153, 157].map((bitOffset) => ({
        bitOffset,
        bitOrder: 'LSB-first',
        elementBits: 8,
        values: Array.from({ length: 4 }, (_, i) => readBitsLSB(normalized, bitOffset + i * 8, 8)),
      })),
    };
  }
  let candidate;
  if (candidateSlot1) {
    check(outputDirectory !== undefined, 'Candidate output requires an explicit new outputDirectory');
    check(
      report.title.id === '00010000534b3845',
      'Experimental slot candidate is limited to the observed SK8E title',
    );
    const slot = entries.find((e) => e.path === 'Save_Slot_1' && e.type === 'file');
    check(slot, 'Container lacks Save_Slot_1');
    candidate = makePs4SlotCandidate(slot.data);
    report.candidate = {
      ...candidate.manifest,
      sourceMember: slot.path,
      path: 'experimental-ps4-Save_Slot_1.bin',
    };
  }
  if (outputDirectory !== undefined) {
    check(
      typeof outputDirectory === 'string' && expectedSha256 !== undefined,
      'Extraction requires outputDirectory and an explicit expectedSha256',
    );
    outputDirectory = path.resolve(outputDirectory);
    fs.mkdirSync(outputDirectory, { mode: 0o700 }); // deliberately non-recursive/exclusive
    outputDirectory = fs.realpathSync(outputDirectory);
    report.outputDirectory = outputDirectory;
    const payloadRoot = path.join(outputDirectory, 'wii-payloads');
    fs.mkdirSync(payloadRoot, { mode: 0o700 });
    const writeNew = (filename, data) => {
      fs.writeFileSync(filename, data, { flag: 'wx', mode: 0o600 });
      check(sha(readRegular(filename)) === sha(data), 'Extracted file failed SHA-256 readback');
    };
    for (const entry of entries) {
      const target = path.join(payloadRoot, entry.path),
        directory = entry.type === 'directory' ? target : path.dirname(target);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      check(fs.realpathSync(directory) === directory, 'Output member directory contains a symlink');
      if (entry.type === 'file') writeNew(target, entry.data);
    }
    if (candidate) writeNew(path.join(outputDirectory, report.candidate.path), candidate.data);
    check(sha(readRegular(source)) === digest, 'Source changed while creating research output');
    writeNew(
      path.join(outputDirectory, 'inspection.json'),
      Buffer.from(JSON.stringify(report, null, 2) + '\n'),
    );
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2),
      options = { source: args.shift() };
    check(
      options.source,
      'Usage: node tools/wii_save_inspect.mjs INPUT [--expect-sha256 SHA] [--ps4-empty FILE] [--output-dir NEWDIR] [--candidate-slot1]',
    );
    const flags = new Map([
      ['--expect-sha256', 'expectedSha256'],
      ['--ps4-empty', 'ps4Empty'],
      ['--output-dir', 'outputDirectory'],
    ]);
    while (args.length) {
      const flag = args.shift();
      if (flag === '--candidate-slot1') {
        check(options.candidateSlot1 === undefined, 'Duplicate candidate flag');
        options.candidateSlot1 = true;
        continue;
      }
      const field = flags.get(flag);
      check(
        field && options[field] === undefined && args.length > 0,
        'Unknown, duplicate or missing CLI argument',
      );
      options[field] = args.shift();
    }
    console.log(JSON.stringify(inspectWiiSave(options), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}
