#!/usr/bin/env node

// Narrow, append-only IGA v0x0B member replacement. This deliberately preserves
// the original lookup tables, chunk properties, compressed data and unknown fields.
import { createHash } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADER_SIZE = 0x38;
const UINT32_MAX = 0xffffffff;
const COPY_SIZE = 1024 * 1024;
const hex = (value) => `0x${value.toString(16).padStart(8, '0')}`;
const align = (value, alignment) => Math.ceil(value / alignment) * alignment;

function checkRange(start, length, end, what) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(length) ||
    start < 0 ||
    length < 0 ||
    start > end ||
    length > end - start
  ) {
    throw new Error(`${what} exceeds file bounds`);
  }
}

async function readExact(handle, length, position) {
  const bytes = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(bytes, done, length - done, position + done);
    if (bytesRead === 0) throw new Error(`Unexpected EOF at ${position + done}`);
    done += bytesRead;
  }
  return bytes;
}

async function writeExact(handle, bytes, position) {
  let done = 0;
  while (done < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, done, bytes.length - done, position + done);
    if (bytesWritten === 0) throw new Error(`Unable to write at ${position + done}`);
    done += bytesWritten;
  }
}

async function regularFile(handle, label) {
  const stat = await handle.stat();
  if (!stat.isFile()) throw new Error(`${label} must be a regular file`);
  if (!Number.isSafeInteger(stat.size) || stat.size > UINT32_MAX) {
    throw new Error(`${label} exceeds this tool's conservative 32-bit size limit`);
  }
  return stat;
}

async function sameStat(handle, before, label) {
  const after = await handle.stat();
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    before.ino !== after.ino
  ) {
    throw new Error(`${label} changed during replacement`);
  }
}

// Validate each source member's stored extent without decompressing it. The 0x20
// chunk discriminator matches iga_extract.cpp / igArchiveExtractor. This checks
// ranges; it does not prove that every compressed stream is semantically valid.
async function storedEnd(handle, entry, archiveSize, alignment) {
  if (entry.size === 0) return entry.start;
  if (entry.mode >>> 24 === 0xff) {
    checkRange(entry.start, entry.size, archiveSize, `Member ${entry.index}`);
    return entry.start + entry.size;
  }
  if (entry.mode >>> 24 !== 0x20) {
    throw new Error(`Unsupported source compression ${hex(entry.mode)} at member ${entry.index}`);
  }
  let cursor = entry.start;
  for (let produced = 0; produced < entry.size; produced += 0x8000) {
    const expected = Math.min(0x8000, entry.size - produced);
    const available = Math.min(7, archiveSize - cursor);
    checkRange(cursor, available, archiveSize, `Member ${entry.index} chunk header`);
    const bytes = await readExact(handle, available, cursor);
    const compressed = bytes.length === 7 && bytes[2] === 0x5d && bytes.readUInt32LE(3) <= 0x8000;
    const length = compressed ? 7 + bytes.readUInt16LE(0) : expected;
    if (compressed && length === 7) throw new Error(`Empty compressed chunk in member ${entry.index}`);
    checkRange(cursor, length, archiveSize, `Member ${entry.index} chunk`);
    cursor += length;
    if (produced + expected < entry.size) cursor = align(cursor, alignment);
  }
  return cursor;
}

export async function inspectArchive(handle, archiveSize) {
  checkRange(0, HEADER_SIZE, archiveSize, 'Header');
  const header = await readExact(handle, HEADER_SIZE, 0);
  if (header.subarray(0, 4).toString('hex') !== '4947411a') {
    throw new Error('Only little-endian IGA archives are supported');
  }
  if (header.readUInt32LE(4) !== 0x0b) throw new Error('Only IGA version 0x0B is supported');
  const count = header.readUInt32LE(0x0c);
  const alignment = header.readUInt32LE(0x10);
  if (count === 0 || count > 1000000) throw new Error('Unsupported archive member count');
  if (alignment === 0 || alignment > 0x100000 || (alignment & (alignment - 1)) !== 0) {
    throw new Error('Invalid or unsupported chunk alignment');
  }
  const tableDataSize = header.readUInt32LE(0x08);
  if (tableDataSize < count * 20) throw new Error('Declared table extent is too small');
  checkRange(HEADER_SIZE, tableDataSize, archiveSize, 'Lookup and chunk-property tables');
  const tablesEnd = HEADER_SIZE + tableDataSize;
  const descriptorStart = HEADER_SIZE + count * 4;
  const nameStart = header.readUInt32LE(0x28);
  const nameLength = header.readUInt32LE(0x30);
  checkRange(nameStart, nameLength, archiveSize, 'Name table');
  if (nameStart < tablesEnd || nameLength < count * 4 || nameLength > 64 * 1024 * 1024) {
    throw new Error('Invalid or unsupported name table');
  }
  const tables = await readExact(handle, count * 20, HEADER_SIZE);
  const names = await readExact(handle, nameLength, nameStart);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const nameOffset = names.readUInt32LE(index * 4);
    if (nameOffset < count * 4 || nameOffset >= names.length) {
      throw new Error(`Invalid name offset for member ${index}`);
    }
    const nameEnd = names.indexOf(0, nameOffset);
    if (nameEnd < 0) throw new Error(`Unterminated name for member ${index}`);
    const offset = count * 4 + index * 16;
    const entry = {
      index,
      path: names.subarray(nameOffset, nameEnd).toString('utf8'),
      nameHash: hex(tables.readUInt32LE(index * 4)),
      descriptorOffset: descriptorStart + index * 16,
      start: tables.readUInt32LE(offset),
      preservedWord: hex(tables.readUInt32LE(offset + 4)),
      size: tables.readUInt32LE(offset + 8),
      mode: tables.readUInt32LE(offset + 12),
    };
    if (entry.start < tablesEnd || entry.start > archiveSize || entry.start % alignment !== 0) {
      throw new Error(`Invalid or unaligned start for member ${index}`);
    }
    entry.storedEnd = await storedEnd(handle, entry, archiveSize, alignment);
    if (entry.start < nameStart + nameLength && entry.storedEnd > nameStart) {
      throw new Error(`Member ${index} overlaps the name table`);
    }
    entries.push(entry);
  }
  const extents = entries.filter((entry) => entry.storedEnd > entry.start).sort((a, b) => a.start - b.start);
  for (let index = 1; index < extents.length; index += 1) {
    if (extents[index].start < extents[index - 1].storedEnd) {
      throw new Error(`Source members ${extents[index - 1].index} and ${extents[index].index} overlap`);
    }
  }
  return { version: 11, count, alignment, tablesEnd, nameStart, nameLength, entries };
}

async function copyAndHash(input, output, length, outputOffset) {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(Math.min(COPY_SIZE, length));
  for (let position = 0; position < length; ) {
    const amount = Math.min(buffer.length, length - position);
    const { bytesRead } = await input.read(buffer, 0, amount, position);
    if (bytesRead === 0) throw new Error('Unexpected EOF while copying');
    const bytes = buffer.subarray(0, bytesRead);
    hash.update(bytes);
    await writeExact(output, bytes, outputOffset + position);
    position += bytesRead;
  }
  return hash.digest('hex');
}

async function hashFile(handle, size) {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(Math.min(COPY_SIZE, size));
  for (let position = 0; position < size; ) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - position), position);
    if (bytesRead === 0) throw new Error('Unexpected EOF while hashing');
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest('hex');
}

export async function replaceMember({ source, selector, replacement, output, manifest }) {
  source = path.resolve(source);
  replacement = path.resolve(replacement);
  output = path.resolve(output);
  manifest = path.resolve(manifest ?? `${output}.manifest.json`);
  if (new Set([source, replacement, output, manifest]).size !== 4) {
    throw new Error('Source, replacement, output and manifest must be distinct paths');
  }
  const sourceHandle = await open(source, 'r');
  let replacementHandle;
  let outputHandle;
  let manifestHandle;
  let completed = false;
  let createdOutput = false;
  let createdManifest = false;
  try {
    replacementHandle = await open(replacement, 'r');
    const sourceStat = await regularFile(sourceHandle, 'Source');
    const replacementStat = await regularFile(replacementHandle, 'Replacement');
    const archive = await inspectArchive(sourceHandle, sourceStat.size);
    const matches = /^\d+$/.test(String(selector))
      ? archive.entries.filter((entry) => entry.index === Number(selector))
      : archive.entries.filter((entry) => entry.path === selector);
    if (matches.length !== 1) throw new Error('Selector must identify exactly one existing member');
    const entry = matches[0];
    const newStart = align(sourceStat.size, archive.alignment);
    const newSize = newStart + replacementStat.size;
    if (newSize > UINT32_MAX) throw new Error('Output would exceed the conservative 32-bit size limit');
    const changes = [
      { field: 'start', offset: entry.descriptorOffset, before: entry.start, after: newStart },
      { field: 'size', offset: entry.descriptorOffset + 8, before: entry.size, after: replacementStat.size },
      { field: 'mode', offset: entry.descriptorOffset + 12, before: hex(entry.mode), after: '0xffffffff' },
    ];

    await mkdir(path.dirname(output), { recursive: true });
    await mkdir(path.dirname(manifest), { recursive: true });
    // Exclusive opens also reject existing symlinks and hard-link destinations.
    manifestHandle = await open(manifest, 'wx', 0o644);
    createdManifest = true;
    outputHandle = await open(output, 'wx+', 0o644);
    createdOutput = true;
    const sourceSha256 = await copyAndHash(sourceHandle, outputHandle, sourceStat.size, 0);
    if (newStart > sourceStat.size) {
      await writeExact(outputHandle, Buffer.alloc(newStart - sourceStat.size), sourceStat.size);
    }
    const replacementSha256 = await copyAndHash(
      replacementHandle,
      outputHandle,
      replacementStat.size,
      newStart,
    );
    for (const change of changes) {
      const bytes = Buffer.alloc(4);
      bytes.writeUInt32LE(typeof change.after === 'number' ? change.after : Number(change.after));
      await writeExact(outputHandle, bytes, change.offset);
    }
    await outputHandle.sync();
    await sameStat(sourceHandle, sourceStat, 'Source');
    await sameStat(replacementHandle, replacementStat, 'Replacement');
    const parsedOutput = await inspectArchive(outputHandle, newSize);
    const selectedOutput = parsedOutput.entries[entry.index];
    if (
      selectedOutput.start !== newStart ||
      selectedOutput.size !== replacementStat.size ||
      selectedOutput.mode !== UINT32_MAX
    )
      throw new Error('Output descriptor verification failed');
    const outputSha256 = await hashFile(outputHandle, newSize);
    const result = {
      schema: 'skylanders-iga-replacement-v1',
      strategy: 'append-uncompressed-preserve-original-prefix-except-selected-descriptor',
      source: { path: source, size: sourceStat.size, sha256: sourceSha256 },
      replacement: { path: replacement, size: replacementStat.size, sha256: replacementSha256 },
      output: { path: output, size: newSize, sha256: outputSha256 },
      archive: {
        version: archive.version,
        byteOrder: 'little',
        memberCount: archive.count,
        alignment: archive.alignment,
        nameTable: { offset: archive.nameStart, size: archive.nameLength, preserved: true },
      },
      member: {
        index: entry.index,
        path: entry.path,
        nameHash: entry.nameHash,
        preservedDescriptorWord: entry.preservedWord,
      },
      changes,
      appended: { zeroPadding: newStart - sourceStat.size, start: newStart, length: replacementStat.size },
      preservation: {
        originalStoredPayloadsRetained: true,
        otherMemberDescriptorsPreserved: true,
        nameHashesAndOrderPreserved: true,
        originalChunkPropertiesPreserved: true,
      },
      validation: {
        outputTablesAndStoredRangesChecked: true,
        sourceCompressedStreamsDecoded: false,
        gameRuntimeTested: false,
      },
      limitations: [
        'The old selected payload remains as unused bytes; output grows on each replacement.',
        'The name table remains at its original offset, before the appended payload.',
        'Game acceptance of this layout and of the replacement payload needs a runtime test.',
        'No outer PKG, disc map, signatures or game-specific asset metadata are changed.',
      ],
    };
    await writeExact(manifestHandle, Buffer.from(`${JSON.stringify(result, null, 2)}\n`), 0);
    await manifestHandle.sync();
    completed = true;
    return result;
  } finally {
    await Promise.allSettled([
      sourceHandle.close(),
      replacementHandle?.close(),
      outputHandle?.close(),
      manifestHandle?.close(),
    ]);
    // These paths were created exclusively by this invocation; never remove inputs.
    if (!completed) {
      if (createdOutput) await unlink(output);
      if (createdManifest) await unlink(manifest);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 && !(args.length === 6 && args[4] === '--manifest')) {
    throw new Error(
      'Usage: node tools/iga_replace.mjs <archive> <entry-index|exact-member-path> <replacement-file> <new-output-archive> [--manifest <new-json-file>]',
    );
  }
  const [source, selector, replacement, output, , manifest] = args;
  const result = await replaceMember({ source, selector, replacement, output, manifest });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`iga_replace: ${error.message}`);
    process.exitCode = 1;
  });
}
