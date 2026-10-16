#!/usr/bin/env node
// Explicit-schema raw-bit migration only. No schema discovery or save install.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fnv1a32 } from './save_inspect.mjs';

const MAX_PAYLOAD = 1024 * 1024,
  MAX_FIELDS = 4096,
  MAX_JSON = 8 * 1024 * 1024;
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bit = (bytes, at) => (bytes[at >>> 3] >>> (at & 7)) & 1;
const setBit = (bytes, at) => {
  bytes[at >>> 3] |= 1 << (at & 7);
};
function keys(value, allowed, label) {
  check(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).every((k) => allowed.includes(k)),
    'Invalid ' + label + ' fields',
  );
}
function integer(value, minimum, maximum, label) {
  check(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    'Invalid unsigned safe integer: ' + label,
  );
  return value;
}
function text(value, label, maximum) {
  check(
    typeof value === 'string' &&
      value.length > 0 &&
      value.length <= maximum &&
      !/[\u0000-\u001f\u007f]/.test(value),
    'Invalid ' + label,
  );
  return value;
}
function normalizeSchema(schema, label) {
  keys(schema, ['payloadBytes', 'fields'], label);
  const payloadBytes = integer(schema.payloadBytes, 1, MAX_PAYLOAD, label + '.payloadBytes'),
    payloadBits = payloadBytes * 8;
  check(
    Array.isArray(schema.fields) && schema.fields.length <= MAX_FIELDS,
    label + ' requires at most 4096 explicit fields',
  );
  const seen = new Set();
  const fields = schema.fields.map((field, index) => {
    keys(field, ['key', 'name', 'bitIndex', 'width', 'count'], label + '.field');
    const key = text(field.key, 'stable field key', 256);
    check(!seen.has(key), 'Duplicate stable field key: ' + key);
    seen.add(key);
    const name = field.name === undefined ? {} : { name: text(field.name, 'field name', 1024) };
    const bitIndex = integer(field.bitIndex, 0, payloadBits, `${label}[${index}].bitIndex`);
    const width = integer(field.width, 1, payloadBits, `${label}[${index}].width`);
    const count = integer(field.count, 0, payloadBits, `${label}[${index}].count`);
    const length = width * count;
    check(
      Number.isSafeInteger(length) && length <= payloadBits && bitIndex + length <= payloadBits,
      'Field bit range exceeds payload: ' + key,
    );
    return { key, ...name, bitIndex, width, count };
  });
  const spans = fields
    .filter((f) => f.count > 0)
    .map((f) => ({ start: f.bitIndex, end: f.bitIndex + f.width * f.count, key: f.key }))
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++)
    check(
      spans[i].start >= spans[i - 1].end,
      'Overlapping field ranges: ' + spans[i - 1].key + ' / ' + spans[i].key,
    );
  const coverage = Buffer.alloc(payloadBytes);
  for (const span of spans) for (let at = span.start; at < span.end; at++) setBit(coverage, at);
  return {
    schema: { payloadBytes, fields },
    coverage,
    bits: payloadBits,
    assignedBits: spans.reduce((n, span) => n + span.end - span.start, 0),
  };
}
function addRange(ranges, at) {
  const last = ranges.at(-1);
  if (last && last.bitIndex + last.bitLength === at) last.bitLength++;
  else ranges.push({ bitIndex: at, bitLength: 1 });
}
const rangeSize = (ranges) => ranges.reduce((n, range) => n + range.bitLength, 0);

/** Caller supplies complete old/new observed schemas; this tool cannot prove
 * their runtime provenance. Bit numbering is LSB-first inside each byte.
 */
export function migrateSaveLayout(options) {
  keys(options, ['source', 'expectedSha256', 'oldSchema', 'newSchema', 'elementMaps'], 'migration request');
  const { source, expectedSha256 } = options;
  check(
    Buffer.isBuffer(source) && source.length >= 5 && source.length <= MAX_PAYLOAD + 4,
    'Expected bounded save Buffer including a four-byte checksum',
  );
  check(
    typeof expectedSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(expectedSha256) &&
      sha(source) === expectedSha256,
    'Source SHA-256 mismatch',
  );
  const old = normalizeSchema(options.oldSchema, 'oldSchema'),
    next = normalizeSchema(options.newSchema, 'newSchema');
  check(
    source.length === old.schema.payloadBytes + 4,
    'Source length does not equal explicit old payloadBytes plus checksum',
  );
  const oldPayload = source.subarray(0, -4),
    stored = source.readUInt32LE(source.length - 4),
    computed = fnv1a32(oldPayload);
  check(stored === computed, 'Invalid source trailing little-endian FNV-1a-32 checksum');
  check(
    old.schema.fields.length === next.schema.fields.length,
    'Field additions/removals are unsupported; only element counts may grow',
  );
  for (let i = 0; i < old.schema.fields.length; i++) {
    const a = old.schema.fields[i],
      b = next.schema.fields[i];
    check(a.key === b.key && a.name === b.name, 'Field key/name/order changed at index ' + i);
    check(a.width === b.width, 'Field width changed: ' + a.key);
    check(b.count >= a.count, 'Field count decreased: ' + a.key);
  }
  const elementMaps = options.elementMaps ?? {};
  keys(
    elementMaps,
    old.schema.fields.map((f) => f.key),
    'elementMaps',
  );
  const destinations = old.schema.fields.map((a, index) => {
    const map = Object.hasOwn(elementMaps, a.key)
      ? elementMaps[a.key]
      : Array.from({ length: a.count }, (_, i) => i);
    check(
      Array.isArray(map) && map.length === a.count,
      'Element map must contain exactly one destination per source element: ' + a.key,
    );
    for (const destination of map)
      integer(destination, 0, next.schema.fields[index].count - 1, 'element destination: ' + a.key);
    check(new Set(map).size === map.length, 'Duplicate element destination: ' + a.key);
    return [...map];
  });
  const buffer = Buffer.alloc(next.schema.payloadBytes + 4),
    output = buffer.subarray(0, -4);
  const unknownPreserved = [],
    unknownConsumedZero = [],
    unknownTruncatedZero = [],
    newUnknownZero = [];
  let preservedUnknownOneBits = 0;
  for (let at = 0; at < old.bits; at++) {
    if (bit(old.coverage, at)) continue;
    if (at < next.bits && !bit(next.coverage, at)) {
      addRange(unknownPreserved, at);
      if (bit(oldPayload, at)) {
        setBit(output, at);
        preservedUnknownOneBits++;
      }
    } else {
      check(
        bit(oldPayload, at) === 0,
        'Nonzero unknown source bit would be ' +
          (at >= next.bits ? 'truncated' : 'consumed by a field') +
          ': ' +
          at,
      );
      addRange(at >= next.bits ? unknownTruncatedZero : unknownConsumedZero, at);
    }
  }
  for (let at = 0; at < next.bits; at++)
    if (!bit(next.coverage, at) && (at >= old.bits || bit(old.coverage, at))) addRange(newUnknownZero, at);
  const fields = old.schema.fields.map((a, index) => {
    const b = next.schema.fields[index],
      map = destinations[index];
    // Copy each original element's raw encoding. Never decode signed values,
    // clamp to limits, adjust sentinels, set progress or guess new defaults.
    for (let element = 0; element < a.count; element++)
      for (let j = 0; j < a.width; j++)
        if (bit(oldPayload, a.bitIndex + element * a.width + j))
          setBit(output, b.bitIndex + map[element] * b.width + j);
    if (Object.hasOwn(elementMaps, a.key)) {
      const used = new Set(map),
        empty = Array.from({ length: b.count }, (_, i) => i).filter((i) => !used.has(i));
      return {
        key: a.key,
        ...(a.name === undefined ? {} : { name: a.name }),
        width: a.width,
        previousCount: a.count,
        count: b.count,
        copied: {
          sourceBitIndex: a.bitIndex,
          destinationBitIndex: b.bitIndex,
          elements: a.count,
          strideBits: a.width,
          bitLength: a.count * a.width,
          destinationElementBySourceElement: map,
        },
        zeroInitialized: {
          destinationElements: empty,
          elements: empty.length,
          strideBits: a.width,
          bitLength: empty.length * a.width,
        },
      };
    }
    return {
      key: a.key,
      ...(a.name === undefined ? {} : { name: a.name }),
      width: a.width,
      previousCount: a.count,
      count: b.count,
      copied: {
        sourceBitIndex: a.bitIndex,
        destinationBitIndex: b.bitIndex,
        elements: a.count,
        strideBits: a.width,
        bitLength: a.count * a.width,
        bitDelta: b.bitIndex - a.bitIndex,
      },
      zeroInitialized: {
        destinationBitIndex: b.bitIndex + a.count * a.width,
        firstElement: a.count,
        elements: b.count - a.count,
        strideBits: a.width,
        bitLength: (b.count - a.count) * a.width,
      },
    };
  });
  // Independent readback from completed buffers, including all zero-grown slots.
  for (const [index, a] of old.schema.fields.entries()) {
    const b = next.schema.fields[index],
      map = destinations[index],
      used = new Set(map);
    for (let i = 0; i < a.count; i++)
      for (let j = 0; j < a.width; j++)
        check(
          bit(oldPayload, a.bitIndex + i * a.width + j) === bit(output, b.bitIndex + map[i] * b.width + j),
          'Copied field readback mismatch',
        );
    for (let i = 0; i < b.count; i++)
      if (!used.has(i))
        for (let j = 0; j < b.width; j++)
          check(bit(output, b.bitIndex + i * b.width + j) === 0, 'Added element is not zero');
  }
  for (const range of unknownPreserved)
    for (let j = 0; j < range.bitLength; j++)
      check(
        bit(oldPayload, range.bitIndex + j) === bit(output, range.bitIndex + j),
        'Unknown-bit preservation mismatch',
      );
  const checksum = fnv1a32(output);
  buffer.writeUInt32LE(checksum, output.length);
  const oldJson = Buffer.from(JSON.stringify(old.schema)),
    newJson = Buffer.from(JSON.stringify(next.schema));
  return {
    buffer,
    manifest: {
      schema: 'skylanders-explicit-save-layout-migration-v1',
      runtimeValidated: false,
      deployable: false,
      unlocksModifiedIntentionally: false,
      schemaProvenanceVerified: false,
      sourceSha256: expectedSha256,
      outputSha256: sha(buffer),
      sourceBytes: source.length,
      outputBytes: buffer.length,
      bitOrder: 'least-significant-bit-first within each byte',
      schemas: {
        old: { sha256: sha(oldJson), value: old.schema },
        new: { sha256: sha(newJson), value: next.schema },
        hashEncoding:
          'UTF-8 JSON.stringify of normalized explicit schema; not a hash of the caller JSON file',
      },
      checksum: {
        algorithm: 'FNV-1a-32',
        storage: 'trailing uint32 little-endian',
        previous: stored,
        computedSource: computed,
        output: checksum,
        sourceValid: true,
      },
      fields,
      totals: {
        copiedFieldBits: old.assignedBits,
        addedZeroFieldBits: next.assignedBits - old.assignedBits,
        assignedBitGrowth: next.assignedBits - old.assignedBits,
        payloadBitGrowth: next.bits - old.bits,
        preservedUnknownBits: rangeSize(unknownPreserved),
        preservedUnknownOneBits,
        consumedZeroUnknownBits: rangeSize(unknownConsumedZero),
        truncatedZeroUnknownBits: rangeSize(unknownTruncatedZero),
        newZeroUnknownBits: rangeSize(newUnknownZero),
      },
      unknownBits: {
        policy:
          'preserve only at identical still-unassigned positions; reject consumed/truncated nonzero source unknown bits',
        preservedAtSamePositions: unknownPreserved,
        consumedButVerifiedZero: unknownConsumedZero,
        truncatedButVerifiedZero: unknownTruncatedZero,
        newlyZeroUnassigned: newUnknownZero,
      },
      validation: {
        sourceUnmodified: sha(source) === expectedSha256,
        everyOriginalFieldBitCopied: true,
        addedElementsZero: true,
        unknownBitPolicyPassed: true,
        outputChecksumValid: buffer.readUInt32LE(output.length) === fnv1a32(output),
      },
      limitations: [
        'Schemas are caller-supplied observations; this tool does not discover or independently validate the executed runtime layout.',
        'Optional per-field element maps are explicit caller policy; chapter ordering must be established independently for each field.',
        'Raw signed/sentinel encodings are preserved without interpreting field semantics or changing version values.',
        'Zero for a new element is a structural initialization policy, not proof of a valid gameplay default.',
        'No unlock, chapter ID, old-progress compatibility, runtime loading or saving acceptance is claimed.',
        'No emulator launch, save installation, original-file overwrite or automatic word-aligned sizing.',
      ],
    },
  };
}

function same(a, b) {
  return ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every((k) => a[k] === b[k]);
}
function owned(filename, stat) {
  try {
    const now = fs.lstatSync(filename);
    return now.dev === stat.dev && now.ino === stat.ino;
  } catch {
    return false;
  }
}
function readStart(fd, length) {
  const bytes = Buffer.alloc(length);
  let at = 0;
  while (at < length) {
    const n = fs.readSync(fd, bytes, at, Math.min(1048576, length - at), at);
    check(n > 0, 'Input ended early');
    at += n;
  }
  return bytes;
}
/** Exclusive new-directory output only; never opens an existing save writable. */
export function writeSaveLayoutMigration(options) {
  keys(
    options,
    ['source', 'expectedSha256', 'oldSchema', 'newSchema', 'elementMaps', 'outputDirectory'],
    'file migration request',
  );
  check(
    typeof options.source === 'string' &&
      options.source.length > 0 &&
      typeof options.outputDirectory === 'string' &&
      options.outputDirectory.length > 0,
    'Source path and new outputDirectory required',
  );
  const source = path.resolve(options.source),
    outputDirectory = path.resolve(options.outputDirectory);
  const fd = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const files = [];
  let directoryStat,
    completed = false;
  try {
    const stat = fs.fstatSync(fd);
    check(stat.isFile() && stat.size >= 5 && stat.size <= MAX_PAYLOAD + 4, 'Expected bounded regular source');
    const bytes = readStart(fd, stat.size);
    check(
      typeof options.expectedSha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(options.expectedSha256) &&
        sha(bytes) === options.expectedSha256,
      'Source SHA-256 mismatch',
    );
    const unchanged = () =>
      check(
        same(stat, fs.fstatSync(fd)) &&
          same(stat, fs.lstatSync(source)) &&
          sha(readStart(fd, stat.size)) === options.expectedSha256,
        'Source identity/content changed during migration',
      );
    unchanged();
    const result = migrateSaveLayout({
      source: bytes,
      expectedSha256: options.expectedSha256,
      oldSchema: options.oldSchema,
      newSchema: options.newSchema,
      elementMaps: options.elementMaps,
    });
    unchanged();
    fs.mkdirSync(outputDirectory, { mode: 0o700 });
    directoryStat = fs.lstatSync(outputDirectory);
    result.manifest.sourcePath = source;
    result.manifest.outputPath = path.join(outputDirectory, 'save-layout-migration.candidate.bin');
    const outputRecords = [];
    for (const [name, data] of [
      ['save-layout-migration.candidate.bin', result.buffer],
      ['manifest.json', Buffer.from(JSON.stringify(result.manifest, null, 2) + '\n')],
    ]) {
      const filename = path.join(outputDirectory, name),
        outputFd = fs.openSync(filename, 'wx+', 0o600),
        identity = fs.fstatSync(outputFd);
      files.push({ filename, identity });
      try {
        fs.writeFileSync(outputFd, data);
        fs.fsyncSync(outputFd);
        check(
          fs.fstatSync(outputFd).size === data.length && sha(readStart(outputFd, data.length)) === sha(data),
          'Output readback mismatch',
        );
      } finally {
        fs.closeSync(outputFd);
      }
      check(owned(filename, identity), 'Output identity changed');
      outputRecords.push({ path: filename, size: data.length, sha256: sha(data) });
    }
    unchanged();
    check(
      owned(outputDirectory, directoryStat) && files.every((f) => owned(f.filename, f.identity)),
      'Output paths changed',
    );
    completed = true;
    return { outputDirectory, outputs: outputRecords, runtimeValidated: false, deployable: false };
  } finally {
    fs.closeSync(fd);
    if (!completed) {
      for (const file of files.reverse())
        if (owned(file.filename, file.identity)) fs.unlinkSync(file.filename);
      if (directoryStat && owned(outputDirectory, directoryStat)) {
        try {
          fs.rmdirSync(outputDirectory);
        } catch (error) {
          if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
        }
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    check(process.argv.length === 3, 'Usage: node tools/save_layout_migrate.mjs request.json');
    const fd = fs.openSync(
      process.argv[2],
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    let request;
    try {
      const stat = fs.fstatSync(fd);
      check(stat.isFile() && stat.size <= MAX_JSON, 'Expected bounded regular request JSON');
      request = JSON.parse(readStart(fd, stat.size));
    } finally {
      fs.closeSync(fd);
    }
    console.log(JSON.stringify(writeSaveLayoutMigration(request)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
