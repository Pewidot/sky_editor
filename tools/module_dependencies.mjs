#!/usr/bin/env node
// Read-only source-bound closure candidate. Never author/copy game resources.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseIgz } from './igz.mjs';

const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MAX_SOURCE = 1024 ** 3;
const LIMITS = Object.freeze({ maxObjects: 4096, maxReferences: 32768, maxDataBytes: 128 * 1024 * 1024 });
const LOADER_EVIDENCE = 'ev_ec2b575e84cb4f06b1aba8c75f1ce0d82f7db4a2852eab4ef8b43300b51f0e8b';
// Exact list profiles already consumed by igz_geometry/igz_texture/material.
// The name suffix "List" alone does NOT establish a list schema.
const LISTS = new Map([
  ['igObjectList', [0x28, 0xc]],
  ['DrawableList', [0x28, 0xc]],
  ['EntityList', [0x28, 0xc]],
  ['BoneAttachInfoList', [0x28, 0xc]],
  ['igCachedAttrListList', [0x28, 0xc]],
  ['igCachedAttrList', [0x40, 0x10]],
  ['igShaderConstantDataList', [0x28, 0x10]],
  ['igCustomMaterialAnimationList', [0x28, 0xc]],
]);
const MEMORY = new Map([
  ['igVertexBuffer', [0x58, 0x20, 0]],
  ['igIndexBuffer', [0x50, 0x20, 0]],
  ['igImage2', [0x80, 0x60, 0x30000000]],
]);
const TABLES = new Map([
  ['REXT', ['EXID', 8]],
  ['RNEX', ['EXNM', 8]],
  ['RHND', ['EXID', 8]],
  ['RMHN', ['TMHN', 16]],
]);
const KNOWN_FIXUPS = new Set([
  'RVTB',
  'ROOT',
  'RSTT',
  'ROFS',
  'RPID',
  'REXT',
  'RNEX',
  'RHND',
  'RMHN',
  'TSTR',
  'TMET',
  'MTSZ',
  'TMHN',
  'EXID',
  'EXNM',
  'TDEP',
]);

function lowerBound(items, offset) {
  let lo = 0,
    hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (items[mid].offset < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function preflight(buffer, expectedSha256) {
  check(
    Buffer.isBuffer(buffer) && buffer.length >= 0x34 && buffer.length <= MAX_SOURCE,
    'Expected IGZ Buffer <=1 GiB',
  );
  check(
    typeof expectedSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(expectedSha256) &&
      hash(buffer) === expectedSha256,
    'Explicit source SHA-256 mismatch',
  );
  const first = buffer.readUInt32LE(0x18),
    end = first + buffer.readUInt32LE(0x1c);
  check(first >= 0x224 && end <= buffer.length && end >= first, 'Invalid fixup extent');
  let blocks = 0,
    count = 0;
  for (let at = first; at < end; ) {
    check(at + 16 <= end, 'Truncated fixup header');
    const bytes = buffer.readUInt32LE(at + 8);
    count += buffer.readUInt32LE(at + 4);
    blocks++;
    check(bytes >= 16 && at + bytes <= end, 'Invalid fixup block');
    check(blocks <= 256 && count <= 2_000_000, 'Fixup allocation budget exceeded');
    at += bytes;
  }
}

/** A finite traversal of recorded pointer edges plus explicitly supported raw
 * spans. Closed pointer coverage is NOT a portable module or ownership proof.
 */
export function inspectModuleDependencies(buffer, options = {}) {
  check(options && typeof options === 'object' && !Array.isArray(options), 'Options must be an object');
  check(
    Object.keys(options).every((k) => ['expectedSha256', 'objectIds', ...Object.keys(LIMITS)].includes(k)),
    'Unknown dependency option',
  );
  const { expectedSha256, objectIds } = options;
  preflight(buffer, expectedSha256);
  const limits = Object.fromEntries(
    Object.entries(LIMITS).map(([key, cap]) => {
      const n = options[key] ?? cap;
      check(Number.isSafeInteger(n) && n >= 1 && n <= cap, `Invalid ${key}`);
      return [key, n];
    }),
  );
  check(
    Array.isArray(objectIds) &&
      objectIds.length > 0 &&
      objectIds.length <= 128 &&
      objectIds.every((i) => Number.isSafeInteger(i) && i >= 0) &&
      new Set(objectIds).size === objectIds.length,
    'objectIds must select 1..128 distinct original RVTB indices',
  );
  const z = parseIgz(buffer);
  check(
    objectIds.every((i) => z.objects[i]),
    'Selected object index is outside RVTB',
  );
  check(
    z.typeEntries.every((e) => e.byteLength <= 4096) &&
      z.stringEntries.every((e) => e.byteLength <= 1024 * 1024),
    'Source type/string exceeds diagnostic length limit',
  );
  let reportedStringBytes = 0;
  const accountString = (value) => {
    reportedStringBytes += Buffer.byteLength(value ?? '');
    check(reportedStringBytes <= 8 * 1024 * 1024, 'Diagnostic string budget exceeded');
    return value;
  };
  const memoryHandles = new Map(z.tmhnReferences.map((r) => [r.offset, r]));
  const slots = [];
  for (const [magic, table] of z.offsetTables)
    if (!['RVTB', 'ROOT'].includes(magic))
      for (let index = 0; index < table.offsets.length; index++)
        if (table.offsets[index])
          slots.push({
            magic,
            index,
            offset: table.offsets[index],
            declaredEncoded: table.encodedOffsets[index],
          });
  slots.sort((a, b) => a.offset - b.offset || a.magic.localeCompare(b.magic));
  const objectsInOrder = [...z.objects].sort((a, b) => a.offset - b.offset);
  const selected = new Set(),
    queue = [],
    scannedSlots = new Set(),
    scannedPointerSlots = new Set(),
    nodes = [],
    references = [],
    dataSpans = [],
    frontier = [],
    strings = new Map(),
    tableEntries = new Map(),
    incoming = [];
  const dataByKey = new Map(),
    knownSpanSlots = new Set();
  let dataBytes = 0;
  const sourceLocation = (offset) => {
    const o = z.objectContaining(offset);
    return { fileOffset: offset, objectId: o?.index ?? null, fieldOffset: o ? offset - o.offset : null };
  };
  const note = (reason, location, details = {}) => {
    check(frontier.length < limits.maxReferences, 'Frontier budget exceeded');
    frontier.push({ reason, ...location, ...details });
  };
  const enqueue = (index) => {
    if (selected.has(index)) return;
    check(selected.size < limits.maxObjects, 'Object closure budget exceeded; choose a smaller seed');
    selected.add(index);
    queue.push(index);
  };
  objectIds.forEach(enqueue);
  function addSpan(owner, field, encoded, size, kind, extra = {}) {
    check(Number.isSafeInteger(size) && size > 0, 'Unsupported raw span');
    check(size <= limits.maxDataBytes, 'Raw-data closure budget exceeded');
    const target = z.resolvePointer(encoded, size);
    // Never assign an arbitrary typed object or its interior to a raw allocation.
    const at = lowerBound(objectsInOrder, target.offset),
      previous = objectsInOrder[at - 1],
      next = objectsInOrder[at];
    check(
      !(previous && previous.offset + previous.size > target.offset) &&
        !(next && next.offset < target.offset + size),
      'Raw span overlaps a typed object',
    );
    const key = `${target.offset}:${size}`;
    let span = dataByKey.get(key);
    if (!span) {
      check(dataBytes + size <= limits.maxDataBytes, 'Raw-data closure budget exceeded');
      dataBytes += size;
      span = {
        id: `data:${key}`,
        fileOffset: target.offset,
        encodedOffset: encoded,
        size,
        poolIndex: target.section,
        poolName: z.descriptors[target.section].name,
        sha256: hash(buffer.subarray(target.offset, target.offset + size)),
        kind,
        owners: [],
        ...extra,
      };
      dataByKey.set(key, span);
      dataSpans.push(span);
      // Relocations in list backing arrays belong to this explicit allocation,
      // not to the nearest preceding RVTB object.
      scan(target.offset, size, span.id);
    }
    span.owners.push({ objectId: owner.index, fieldOffset: field });
    knownSpanSlots.add(owner.offset + field);
    return span;
  }
  function tableReference(slot, output) {
    const [table, width] = TABLES.get(slot.magic),
      f = z.fixupMap.get(table);
    const signedReference = ['REXT', 'RNEX'].includes(slot.magic);
    const raw = signedReference ? buffer.readBigUInt64LE(slot.offset) : BigInt(z.u32(slot.offset));
    const index = signedReference ? raw & 0x7fffffffffffffffn : BigInt(z.u32(slot.offset));
    output.table = table;
    output.tableIndexDecimal = index.toString();
    if (signedReference) output.retainOnResolve = raw >> 63n !== 0n;
    output.crossArtifactResolution = 'not-attempted';
    if (!f || f.end - f.dataOffset !== f.count * width || index >= BigInt(f.count)) {
      note('invalid-or-unsupported-table-reference', sourceLocation(slot.offset), {
        magic: slot.magic,
        table,
      });
      return;
    }
    const key = `${table}:${index}`,
      at = f.dataOffset + Number(index) * width;
    if (!tableEntries.has(key))
      tableEntries.set(key, {
        table,
        index: Number(index),
        fileOffset: at,
        rawHex: buffer.subarray(at, at + width).toString('hex'),
        words: Array.from({ length: width / 4 }, (_, i) => z.u32(at + i * 4)),
        meaning: 'source table record; no cross-file resolution',
      });
    if (slot.magic !== 'RMHN')
      note('external-identity-or-handle-not-linked', sourceLocation(slot.offset), {
        magic: slot.magic,
        table,
        index: Number(index),
      });
  }
  function scan(offset, size, sourceNode) {
    for (let i = lowerBound(slots, offset); i < slots.length && slots[i].offset < offset + size; i++) {
      const slot = slots[i],
        key = `${slot.magic}:${slot.index}`;
      if (scannedSlots.has(key)) continue;
      check(references.length < limits.maxReferences, 'Reference closure budget exceeded');
      const width = ['RSTT', 'RPID', 'RMHN'].includes(slot.magic) ? 4 : 8;
      check(slot.offset + width <= offset + size, 'Relocation straddles the selected allocation');
      // The v8 loader reads 64-bit external slots; parser bounds some tables at
      // four bytes, so validate the actual read independently here.
      check(slot.offset + width <= buffer.length, 'Truncated relocation slot');
      scannedSlots.add(key);
      const output = {
        ...slot,
        sourceNode,
        source: sourceLocation(slot.offset),
        rawSlotHex: buffer.subarray(slot.offset, slot.offset + width).toString('hex'),
      };
      references.push(output);
      if (slot.magic === 'ROFS') {
        scannedPointerSlots.add(slot.offset);
        const special = z.specialRelocationsByOffset.get(slot.offset);
        if (special) {
          output.kind = 'runtime-initializer';
          note('runtime-initializer-semantics-unknown', output.source);
          continue;
        }
        const ref = z.pointerReferencesByOffset.get(slot.offset),
          target = z.objectContaining(ref.targetOffset);
        output.target = {
          fileOffset: ref.targetOffset,
          encodedOffset: ref.encoded,
          objectId: target?.index ?? null,
          interiorOffset: target ? ref.targetOffset - target.offset : null,
        };
        output.kind = target ? 'object-reference' : 'untyped-reference';
        if (target) enqueue(target.index);
      } else if (slot.magic === 'RSTT') {
        const ref = z.stringReferencesByOffset.get(slot.offset);
        output.stringIndex = ref.stringIndex;
        if (!strings.has(ref.stringIndex))
          strings.set(ref.stringIndex, { index: ref.stringIndex, value: accountString(ref.value) });
      } else if (TABLES.has(slot.magic)) tableReference(slot, output);
      else
        note('pool-id-relocation-remap-required', output.source, {
          magic: slot.magic,
          rawIndex: z.u32(slot.offset),
        });
    }
  }
  function rawSpans(object) {
    const specs = [];
    const list = LISTS.get(object.type);
    if (list && object.size === list[0]) {
      const count = z.u32(object.offset + list[1]),
        size = z.u32(object.offset + 0x18);
      check(count <= 100000 && count * 8 <= size, 'Unsupported list count/byte span');
      if (list[1] === 0xc) check(count <= z.u32(object.offset + 0x10), 'List count exceeds capacity');
      if (size) specs.push([0x20, size, 'object-pointer-list', { count, countField: list[1] }]);
    }
    if (object.type === 'igVertexFormat' && object.size === 0x80) {
      const size = z.u32(object.offset + 0x10);
      check(size >= 12 && size <= 384 && size % 12 === 0, 'Unsupported vertex element table');
      specs.push([0x18, size, 'vertex-elements', {}]);
    }
    for (const [field, size, kind, extra] of specs) {
      const ref = z.pointerReferencesByOffset.get(object.offset + field);
      check(ref, 'Declared data span has no ordinary ROFS relocation');
      addSpan(object, field, ref.encoded, size, kind, extra);
    }
    const memory = MEMORY.get(object.type);
    if (memory && object.size === memory[0]) {
      const ref = memoryHandles.get(object.offset + memory[1]),
        f = z.fixupMap.get('TMHN');
      check(ref && f && f.end - f.dataOffset === f.count * 16, 'Missing/unsupported memory handle');
      const at = f.dataOffset + ref.tableIndex * 16,
        size = z.u32(at),
        flags = z.u32(at + 4),
        encoded = z.u32(at + 8);
      check(flags === memory[2] && z.u32(at + 12) === 0, 'Unsupported memory flags/high pointer');
      if (size)
        addSpan(object, memory[1], encoded, size, 'memory-handle-payload', {
          tableIndex: ref.tableIndex,
          flags,
        });
      else knownSpanSlots.add(object.offset + memory[1]);
    }
  }
  for (let at = 0; at < queue.length; at++) {
    const o = z.objects[queue[at]];
    nodes.push({
      id: o.index,
      encodedOffset: o.encoded,
      fileOffset: o.offset,
      size: o.size,
      type: accountString(o.type),
      typeIndex: o.typeIndex,
      name: accountString(z.stringReferencesByOffset.get(o.offset + 0x10)?.value ?? null),
      poolIndex: o.section,
      poolName: z.descriptors[o.section].name,
      sha256: hash(buffer.subarray(o.offset, o.offset + o.size)),
      ownership: 'not-inferred',
    });
    scan(o.offset, o.size, `object:${o.index}`);
    try {
      rawSpans(o);
    } catch (error) {
      // Bounds/resource budgets abort rather than quietly returning a partial
      // report indistinguishable from a supported span.
      if (/budget exceeded/.test(error.message)) throw error;
      note('data-schema-rejected', sourceLocation(o.offset), { type: o.type, detail: error.message });
    }
  }
  for (const ref of references) {
    if (ref.kind === 'untyped-reference' && !knownSpanSlots.has(ref.offset)) {
      const at = ref.target.fileOffset;
      const havokMagic =
        at + 8 <= buffer.length &&
        buffer.readUInt32LE(at) === 0x57e0e057 &&
        buffer.readUInt32LE(at + 4) === 0x10c0c010;
      note(
        havokMagic
          ? 'havok-packfile-needs-independent-schema-and-transform'
          : 'untyped-target-extent-unknown',
        ref.source,
        { target: ref.target },
      );
    }
    if (ref.magic === 'RMHN' && !knownSpanSlots.has(ref.offset))
      note('memory-payload-schema-unknown', ref.source, { tableIndexDecimal: ref.tableIndexDecimal });
  }
  for (const ref of z.pointerReferences) {
    const target = z.objectContaining(ref.targetOffset);
    if (target && selected.has(target.index) && !scannedPointerSlots.has(ref.offset)) {
      check(incoming.length < limits.maxReferences, 'Incoming reference budget exceeded');
      incoming.push({
        source: sourceLocation(ref.offset),
        targetObjectId: target.index,
        targetInteriorOffset: ref.targetOffset - target.offset,
        ownership: 'unknown; do not rewrite counts from pointer totals alone',
      });
    }
  }
  nodes.sort((a, b) => a.id - b.id);
  dataSpans.sort((a, b) => a.fileOffset - b.fileOffset);
  const unknownFixups = z.fixups.filter((f) => !KNOWN_FIXUPS.has(f.magic)).map((f) => f.magic);
  return {
    schema: 'skylanders-module-dependencies-v1',
    artifact: { sha256: expectedSha256, size: buffer.length, version: z.version, platform: z.platform },
    seeds: [...objectIds],
    evidenceKind: 'read-only-serialized-structure',
    runtimeValidated: false,
    portable: false,
    semanticsComplete: false,
    coverage: {
      supportedPointerTraversalClosed:
        frontier.length === 0 && unknownFixups.length === 0 && z.unresolvedFixupEntries.length === 0,
      unknownFixups,
      unresolvedFixupEntries: z.unresolvedFixupEntries,
      limits,
      basis:
        'ROFS typed targets/interiors and exact supported list, vertex-format, buffer and image spans only',
    },
    counts: {
      objects: nodes.length,
      references: references.length,
      dataSpans: dataSpans.length,
      declaredDataBytes: dataBytes,
      strings: strings.size,
      tableEntries: tableEntries.size,
      incomingReferences: incoming.length,
      frontier: frontier.length,
    },
    objects: nodes,
    references,
    dataSpans,
    strings: [...strings.values()].sort((a, b) => a.index - b.index),
    tableEntries: [...tableEntries.values()],
    incomingReferences: incoming,
    frontier,
    artifactDependencies: z.dependencies.map((d, index) => ({
      index,
      name: accountString(d.name),
      path: accountString(d.path),
      usedBySelection: 'unknown; TDEP is file-level, not per-object',
      resolution: 'not-attempted',
    })),
    evidence: {
      loader: LOADER_EVIDENCE,
      existingSchemaImplementations: [
        'igz_geometry.mjs',
        'igz_texture.mjs',
        'igz_material.mjs',
        'igz_append.mjs',
      ],
    },
    limitations: [
      'This is a dependency candidate report, not an extraction recipe, serializer, transplant writer or runtime module.',
      'A complete pointer traversal does not establish field ownership, activation, script semantics, reference counts, or portability.',
      'Incoming references cover ordinary ROFS targets in selected typed objects only; aliases into raw spans and cross-file inbound references are not enumerated.',
      'EXID/EXNM hashes, RHND handles and file-level TDEP are retained but not linked across files; same indices in different files are unrelated.',
      'Unknown untyped spans are frontiers, not guessed from adjacent objects or pointer-looking words.',
      'Havok collision/MOPP, navigation, scripts, animation and stored-world coordinate transformations need independent authoring policies.',
      'The generic append writer cannot yet add types, pools, EXID/EXNM/TMHN entries or dependencies required by a cross-chapter resource import.',
    ],
  };
}

export function inspectModuleFile({ source, ...options } = {}) {
  check(typeof source === 'string' && source.length > 0, 'source path is required');
  source = path.resolve(source);
  const fd = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    check(before.isFile() && before.size <= MAX_SOURCE, 'Source must be a regular file <=1 GiB');
    const bytes = Buffer.alloc(before.size);
    let at = 0;
    while (at < bytes.length) {
      const n = fs.readSync(fd, bytes, at, Math.min(1024 * 1024, bytes.length - at), at);
      check(n > 0, 'Source ended early');
      at += n;
    }
    const after = fs.fstatSync(fd),
      current = fs.lstatSync(source);
    check(
      !current.isSymbolicLink() &&
        before.dev === current.dev &&
        before.ino === current.ino &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs,
      'Source changed while reading',
    );
    return { source, ...inspectModuleDependencies(bytes, options) };
  } finally {
    fs.closeSync(fd);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2),
      options = {},
      flags = new Map([
        ['--source', 'source'],
        ['--expect-sha256', 'expectedSha256'],
        ['--objects', 'objectIds'],
        ['--max-objects', 'maxObjects'],
        ['--max-references', 'maxReferences'],
        ['--max-data-bytes', 'maxDataBytes'],
      ]);
    while (args.length) {
      const key = flags.get(args.shift());
      check(key && options[key] === undefined && args.length, 'Unknown/duplicate/missing option');
      const value = args.shift();
      options[key] =
        key === 'objectIds'
          ? value.split(',').map((v) => (/^\d+$/.test(v) ? Number(v) : NaN))
          : key.startsWith('max')
            ? Number(value)
            : value;
    }
    console.log(JSON.stringify(inspectModuleFile(options), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
