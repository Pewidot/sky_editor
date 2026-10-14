#!/usr/bin/env node

import { open } from 'node:fs/promises';
import path from 'node:path';

function usage() {
  console.error('Usage: node tools/iga_inspect.mjs <archive> [--match <regex>] [--limit <count>] [--json]');
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length === 0) usage();

const archivePath = path.resolve(args.shift());
let match = null;
let limit = 200;
let json = false;

while (args.length > 0) {
  const option = args.shift();
  if (option === '--match') {
    if (args.length === 0) usage();
    match = new RegExp(args.shift(), 'i');
  } else if (option === '--limit') {
    if (args.length === 0) usage();
    limit = Number.parseInt(args.shift(), 10);
    if (!Number.isSafeInteger(limit) || limit < 1) usage();
  } else if (option === '--json') {
    json = true;
  } else {
    usage();
  }
}

const handle = await open(archivePath, 'r');
try {
  const stat = await handle.stat();
  const header = Buffer.alloc(0x38);
  const headerRead = await handle.read(header, 0, header.length, 0);
  if (headerRead.bytesRead !== header.length) throw new Error('Archive is shorter than the IGA header');

  const magic = header.subarray(0, 4).toString('hex');
  const littleEndian = magic === '4947411a';
  const bigEndian = magic === '1a414749';
  if (!littleEndian && !bigEndian) throw new Error(`Unsupported IGA magic: ${magic}`);

  const readU32 = littleEndian
    ? (buffer, offset) => buffer.readUInt32LE(offset)
    : (buffer, offset) => buffer.readUInt32BE(offset);

  const version = readU32(header, 0x04);
  if (version !== 0x0b) throw new Error(`Unsupported IGA version: 0x${version.toString(16)}`);

  const numberOfFiles = readU32(header, 0x0c);
  const chunkAlignment = readU32(header, 0x10);
  const slop = readU32(header, 0x18);
  const nameTableOffset = readU32(header, 0x28);
  const nameTableLength = readU32(header, 0x30);
  const flags = readU32(header, 0x34);
  const checksumOffset = 0x38;
  const localHeaderOffset = checksumOffset + numberOfFiles * 4;
  const descriptorBytes = numberOfFiles * 16;

  if (localHeaderOffset + descriptorBytes > stat.size)
    throw new Error('Descriptor table exceeds archive size');
  if (nameTableOffset + nameTableLength > stat.size) throw new Error('Name table exceeds archive size');
  if (nameTableLength < numberOfFiles * 4) throw new Error('Name table is too small for its offset table');

  const checksums = Buffer.alloc(numberOfFiles * 4);
  const descriptors = Buffer.alloc(descriptorBytes);
  const names = Buffer.alloc(nameTableLength);
  await handle.read(checksums, 0, checksums.length, checksumOffset);
  await handle.read(descriptors, 0, descriptors.length, localHeaderOffset);
  await handle.read(names, 0, names.length, nameTableOffset);

  const entries = [];
  for (let index = 0; index < numberOfFiles; index += 1) {
    const nameOffset = readU32(names, index * 4);
    if (nameOffset >= names.length) throw new Error(`Name offset for entry ${index} exceeds the name table`);
    const nameEnd = names.indexOf(0, nameOffset);
    if (nameEnd === -1) throw new Error(`Name for entry ${index} is not NUL-terminated`);

    const descriptorOffset = index * 16;
    const start = readU32(descriptors, descriptorOffset);
    const size = readU32(descriptors, descriptorOffset + 8);
    const mode = readU32(descriptors, descriptorOffset + 12);
    const memberPath = names.subarray(nameOffset, nameEnd).toString('utf8');
    const entry = {
      index,
      checksum: `0x${readU32(checksums, index * 4)
        .toString(16)
        .padStart(8, '0')}`,
      start,
      size,
      mode: `0x${mode.toString(16).padStart(8, '0')}`,
      path: memberPath,
    };
    if (!match || match.test(memberPath)) entries.push(entry);
  }

  const result = {
    archive: archivePath,
    archiveSize: stat.size,
    byteOrder: littleEndian ? 'little' : 'big',
    version,
    numberOfFiles,
    chunkAlignment,
    slop,
    flags: `0x${flags.toString(16).padStart(8, '0')}`,
    nameTableOffset,
    nameTableLength,
    matchedEntries: entries.length,
    entries: entries.slice(0, limit),
    truncated: entries.length > limit,
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`archive=${result.archive}`);
    console.log(
      `size=${result.archiveSize} version=0x${version.toString(16)} files=${numberOfFiles} alignment=0x${chunkAlignment.toString(16)} flags=${result.flags}`,
    );
    console.log(`matched=${entries.length} shown=${result.entries.length} truncated=${result.truncated}`);
    for (const entry of result.entries) {
      console.log(`${entry.index}\t${entry.size}\t${entry.mode}\t${entry.checksum}\t${entry.path}`);
    }
  }
} finally {
  await handle.close();
}
