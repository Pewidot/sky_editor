#!/usr/bin/env node
// Structural append/rebuild only. This is not an actor-cloning policy or proof
// that an appended object is gameplay-safe. Originals are never opened writable.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseIgz } from './igz.mjs';

const MAX_SOURCE = 1024 * 1024 * 1024,
  MAX_APPEND = 16 * 1024 * 1024;
const DEFAULT_LIMIT = 0x04000000,
  U32 = 0xffffffff;
const SLOT_KINDS = new Set(['RSTT', 'ROFS', 'RPID', 'REXT', 'RHND', 'RNEX', 'RMHN']);
const OFFSET_KINDS = new Set(['RVTB', ...SLOT_KINDS]);
const KNOWN_FIXUPS = new Set([
  ...OFFSET_KINDS,
  'TSTR',
  'TMET',
  'MTSZ',
  'EXID',
  'EXNM',
  'TMHN',
  'ROOT',
  'TDEP',
]);
const LIST_SIZES = new Map([
  ['igObjectList', 0x28],
  ['ScriptSetList', 0x38],
  ['OpCodeList', 0x28],
]);
export const IGZ_APPEND_EVIDENCE = Object.freeze({
  loader: 'ev_ec2b575e84cb4f06b1aba8c75f1ce0d82f7db4a2852eab4ef8b43300b51f0e8b',
  writer: 'ev_8f1e689ccb70dca6b4dee9abc703e8f62259cc6343ce8643a7e9ed3e376cd5ca',
});
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const align = (n, a) => Math.ceil(n / a) * a;
function integer(n, lo, hi, label) {
  check(Number.isSafeInteger(n) && n >= lo && n <= hi, `Invalid ${label}`);
  return n;
}
function keys(value, allowed, label) {
  check(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  check(
    Object.keys(value).every((key) => allowed.includes(key)),
    `${label} contains unsupported fields`,
  );
}

/** v8: positive four-byte deltas, low nibble first, three data bits/nibble. */
export function encodeV8Offsets(values) {
  check(Array.isArray(values) || values instanceof Uint32Array, 'Offsets must be an array');
  check(values.length <= 2_000_000, 'Excessive offset count');
  const nibbles = [];
  let previous = 0;
  for (const value of values) {
    integer(value, 4, U32, 'encoded offset');
    check(value % 4 === 0 && value > previous, 'Offsets must be strictly increasing four-byte addresses');
    let delta = (value - previous) / 4 - 1;
    do {
      const digit = delta % 8;
      delta = Math.floor(delta / 8);
      nibbles.push(digit | (delta ? 8 : 0));
    } while (delta);
    previous = value;
  }
  const bytes = Buffer.alloc(Math.ceil(nibbles.length / 2));
  for (let i = 0; i < nibbles.length; i++) bytes[i >> 1] |= nibbles[i] << ((i & 1) * 4);
  return bytes;
}

function sourceProfile(input, expectedSha256) {
  check(Buffer.isBuffer(input) && input.length <= MAX_SOURCE, 'Source must be a Buffer of at most 1 GiB');
  check(
    typeof expectedSha256 === 'string' && /^[a-f0-9]{64}$/.test(expectedSha256),
    'An explicit lowercase expectedSha256 is required',
  );
  check(hash(input) === expectedSha256, 'Source SHA-256 mismatch');
  // Bound declared allocations before the general parser allocates typed
  // offset arrays or constructs object/reference inventories.
  check(input.length >= 0x34, 'Truncated source header');
  const start = input.readUInt32LE(0x18),
    end = start + input.readUInt32LE(0x1c);
  check(start >= 0x224 && end <= input.length && end >= start, 'Invalid source fixup span');
  let declaredEntries = 0,
    declaredBlocks = 0;
  for (let at = start; at < end; ) {
    check(at + 16 <= end, 'Truncated source fixup header');
    const length = input.readUInt32LE(at + 8);
    check(length >= 16 && at + length <= end, 'Invalid source fixup length');
    declaredEntries += input.readUInt32LE(at + 4);
    declaredBlocks++;
    check(
      declaredEntries <= 2_000_000 && declaredBlocks <= KNOWN_FIXUPS.size,
      'Excessive source fixup count',
    );
    at += length;
  }
  const z = parseIgz(input),
    pool = z.descriptors[1];
  check(
    pool.name === 'Default' && !pool.sentinel && pool.dataSize < DEFAULT_LIMIT,
    'Requires a Default object pool smaller than 64 MiB',
  );
  check(z.unresolvedFixupEntries.length === 0, 'Unresolved fixups prohibit structural writes');
  check(
    z.fixups.every((f) => KNOWN_FIXUPS.has(f.magic)),
    'Unknown fixup kind prohibits structural writes',
  );
  check(
    z.fixups.every((f) => f.length % 4 === 0 && f.startOfData % 4 === 0),
    'Unaligned fixup blocks are unsupported',
  );
  for (const [name, width] of [
    ['EXID', 8],
    ['EXNM', 8],
    ['TMHN', 16],
    ['MTSZ', 4],
  ]) {
    const f = z.fixupMap.get(name);
    if (f) check(f.end - f.dataOffset === f.count * width, `Unsupported ${name} payload extent`);
  }
  for (const [kind, table] of z.offsetTables) {
    if (kind === 'ROOT') continue;
    check(table.encodedOffsets.length <= 2_000_000, 'Excessive source fixup count');
  }
  return { z, pool, appendOffset: align(pool.dataSize, 16) };
}

/** Discover the encoded address where caller-supplied appended bytes will begin.
 * Offsets accepted by appendIgz are relative to that appended byte region.
 */
export function inspectAppendTarget(input, expectedSha256) {
  const { z, pool, appendOffset } = sourceProfile(input, expectedSha256);
  return {
    sourceSha256: expectedSha256,
    defaultPoolSize: pool.dataSize,
    appendOffset,
    types: z.types.map((type, typeIndex) => ({ type, typeIndex, size: z.typeSizes[typeIndex] })),
    roots: Array.from(z.offsetTables.get('ROOT')?.encodedOffsets ?? []),
    objectCount: z.objects.length,
    stringCount: z.strings.length,
    externalIdCount: z.fixupMap.get('EXID')?.count ?? 0,
  };
}

function rebuildOffsetBlock(z, fixup, values) {
  const payload = encodeV8Offsets(values),
    block = Buffer.alloc(align(fixup.startOfData + payload.length, 4));
  z.buffer.copy(block, 0, fixup.offset, fixup.dataOffset); // retain any header extension
  block.writeUInt32LE(values.length, 4);
  block.writeUInt32LE(block.length, 8);
  payload.copy(block, fixup.startOfData);
  return block;
}

/** Append caller-authored bytes and typed objects to Default. Only explicitly
 * selected ROOT/ScriptSetList/OpCodeList headers may be edited in the existing pool. All original
 * pointers and objects keep their encoded pool-relative addresses. RVTB indices
 * in later pools can change; they are not stable serialized object identities.
 */
export function appendIgz(input, options) {
  keys(
    options,
    [
      'expectedSha256',
      'appendedDefaultPool',
      'appendedObjects',
      'fixupSlots',
      'rootList',
      'objectLists',
      'newStrings',
      'newExternalIds',
    ],
    'Append options',
  );
  const { z, pool, appendOffset } = sourceProfile(input, options.expectedSha256);
  const newExternalIds = options.newExternalIds ?? [],
    exid = z.fixupMap.get('EXID');
  check(
    Array.isArray(newExternalIds) && newExternalIds.length <= 10_000,
    'newExternalIds must contain at most 10000 pairs',
  );
  check(!newExternalIds.length || exid, 'Cannot add a new EXID fixup block');
  check((exid?.count ?? 0) + newExternalIds.length <= 2_000_000, 'Enlarged EXID table exceeds entry limit');
  const externalPairs = new Set();
  if (newExternalIds.length)
    for (let i = 0; i < exid.count; i++)
      externalPairs.add(`${z.u32(exid.dataOffset + i * 8)}:${z.u32(exid.dataOffset + i * 8 + 4)}`);
  for (const pair of newExternalIds) {
    keys(pair, ['nameId', 'namespaceHash'], 'newExternalIds entry');
    integer(pair.nameId, 0, U32, 'external nameId');
    integer(pair.namespaceHash, 0, U32, 'external namespaceHash');
    const key = `${pair.nameId}:${pair.namespaceHash}`;
    check(!externalPairs.has(key), 'New EXID pairs must be unique and absent from the existing table');
    externalPairs.add(key);
  }
  const newStrings = options.newStrings ?? [];
  check(
    Array.isArray(newStrings) && newStrings.length <= 10_000,
    'newStrings must contain at most 10000 strings',
  );
  const stringSet = new Set(z.strings);
  let stringBytes = 0;
  for (const value of newStrings) {
    check(
      typeof value === 'string' && /^[\x20-\x7e]{1,255}$/.test(value),
      'New strings must be 1–255 printable ASCII characters',
    );
    check(!stringSet.has(value), 'New strings must be unique and absent from the existing TSTR table');
    stringSet.add(value);
    stringBytes += align(value.length + 1, 2);
  }
  check(stringBytes <= 1024 * 1024, 'Appended TSTR strings exceed 1 MiB');
  check(!newStrings.length || z.fixupMap.has('TSTR'), 'Cannot add a new TSTR fixup block');
  const bytes = options.appendedDefaultPool;
  const listOnly =
    Buffer.isBuffer(bytes) &&
    bytes.length === 0 &&
    Array.isArray(options.appendedObjects) &&
    options.appendedObjects.length === 0;
  check(
    Buffer.isBuffer(bytes) && (bytes.length > 0 || listOnly) && bytes.length <= MAX_APPEND,
    'appendedDefaultPool must contain 1 byte–16 MiB, or be empty for list-only growth',
  );
  check(appendOffset + bytes.length < DEFAULT_LIMIT, 'Default append crosses the 26-bit ROFS slot boundary');
  check(
    Array.isArray(options.appendedObjects) &&
      (options.appendedObjects.length > 0 || listOnly) &&
      options.appendedObjects.length <= 10_000,
    'appendedObjects must contain 1–10000 explicit typed objects',
  );
  const added = new Map([...OFFSET_KINDS].map((kind) => [kind, []]));
  const removed = new Map([...SLOT_KINDS].map((kind) => [kind, new Set()])),
    objectOffsets = new Set();
  const appendedObjects = options.appendedObjects
    .map((object) => {
      keys(object, ['offset', 'type'], 'Appended object');
      const offset = integer(object.offset, 0, bytes.length - 1, 'appended object offset');
      check(
        offset % 8 === 0 && !objectOffsets.has(offset),
        'Appended objects must have unique eight-byte-aligned offsets',
      );
      const typeIndex = z.types.indexOf(object.type),
        size = z.typeSizes[typeIndex];
      check(
        typeIndex >= 0 && z.types.lastIndexOf(object.type) === typeIndex,
        'Appended object type must uniquely exist in TMET',
      );
      check(size >= 8 && offset + size <= bytes.length, 'Appended object exceeds explicit byte region');
      check(
        bytes.readUInt32LE(offset) === typeIndex,
        'Appended object type word disagrees with explicit type',
      );
      objectOffsets.add(offset);
      added.get('RVTB').push(appendOffset + offset);
      return { offset, encoded: appendOffset + offset, type: object.type, typeIndex, size };
    })
    .sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < appendedObjects.length; i++)
    check(
      appendedObjects[i - 1].offset + appendedObjects[i - 1].size <= appendedObjects[i].offset,
      'Appended object spans overlap',
    );

  const slots = options.fixupSlots ?? {};
  keys(slots, [...SLOT_KINDS], 'fixupSlots');
  const occupied = appendedObjects.map((o) => ({ start: o.offset, end: o.offset + 8, kind: 'RVTB' }));
  let slotCount = 0;
  for (const [kind, values] of Object.entries(slots)) {
    check(z.fixupMap.has(kind), `Cannot add a new ${kind} fixup block; source must already contain it`);
    check(Array.isArray(values), `${kind} additions must be an array of appended byte offsets`);
    slotCount += values.length;
    check(slotCount <= 100_000, 'Excessive appended fixup count');
    for (const value of values) {
      const offset = integer(value, 0, bytes.length - 8, `${kind} slot`);
      check(offset % 4 === 0, `${kind} slot must be four-byte aligned`);
      occupied.push({ start: offset, end: offset + 8, kind });
      // New initializer-flag ROFS locations are intentionally not admitted:
      // their callee/ownership semantics are not an object-cloning policy.
      const highWord = bytes.readUInt32LE(offset + 4);
      if (kind === 'REXT' || kind === 'RNEX')
        check(
          highWord === 0 || highWord === 0x80000000,
          `${kind} serialized slot permits only an optional sign-retain high bit`,
        );
      else if (kind === 'RPID')
        // Native loader 0x568430 reads a uint32 pool index then calls
        // 0x514e20 on this eight-byte memory descriptor. That helper preserves
        // its top five flags while installing the runtime pool ID. Do not
        // erase e.g. an empty RHSValueStack's 0x0800000000000000 flag.
        check(
          (highWord & 0x07ffffff) === 0,
          'RPID serialized slot permits only top-five memory flags besides the pool index',
        );
      else check(highWord === 0, `${kind} serialized slot requires a zero high word`);
      const word = bytes.readUInt32LE(offset);
      if (kind !== 'ROFS') {
        const limit =
          kind === 'RSTT'
            ? z.strings.length + newStrings.length
            : kind === 'RPID'
              ? z.descriptors.length - 1
              : kind === 'REXT'
                ? (exid?.count ?? 0) + newExternalIds.length
                : (z.fixupMap.get(kind === 'RNEX' ? 'EXNM' : kind === 'RMHN' ? 'TMHN' : 'EXID')?.count ?? 0);
        check(word < limit, `${kind} index exceeds the preserved or explicitly extended table`);
      }
      added.get(kind).push(appendOffset + offset);
    }
  }
  occupied.sort((a, b) => a.start - b.start);
  for (let i = 1; i < occupied.length; i++)
    check(
      occupied[i - 1].end <= occupied[i].start,
      'Appended fixup slots overlap each other or a vtable word',
    );

  const listPlans = [],
    listChanges = [],
    requests = [];
  let rootPlan = null,
    appendedEnd = appendOffset + bytes.length;
  if (options.rootList !== undefined) {
    const request = options.rootList;
    keys(request, ['rootEncoded', 'appendObjects'], 'rootList');
    const rootEncoded = integer(request.rootEncoded, 4, DEFAULT_LIMIT - 0x28, 'root encoded address');
    check(
      Array.from(z.offsetTables.get('ROOT')?.encodedOffsets ?? []).includes(rootEncoded),
      'Requested list is not a declared ROOT object',
    );
    requests.push({
      listEncoded: rootEncoded,
      expectedType: 'igObjectList',
      appendObjects: request.appendObjects,
      root: true,
    });
  }
  const objectLists = options.objectLists ?? [];
  check(
    Array.isArray(objectLists) && objectLists.length <= 32,
    'objectLists must be an array of at most 32 extensions',
  );
  for (const request of objectLists) {
    keys(
      request,
      ['listEncoded', 'expectedType', 'appendObjects', 'appendExistingObjects', 'insertAt'],
      'objectLists entry',
    );
    check(
      ['ScriptSetList', 'OpCodeList'].includes(request.expectedType),
      'Only explicit expectedType ScriptSetList or OpCodeList is supported',
    );
    integer(
      request.listEncoded,
      4,
      DEFAULT_LIMIT - LIST_SIZES.get(request.expectedType),
      'list encoded address',
    );
    requests.push({ ...request, root: false });
  }
  check(
    new Set(requests.map((r) => r.listEncoded)).size === requests.length,
    'List extensions must select distinct objects',
  );
  check(
    !listOnly ||
      (requests.length > 0 &&
        options.rootList === undefined &&
        newStrings.length === 0 &&
        newExternalIds.length === 0),
    'List-only growth requires typed list requests and cannot add ROOT, strings or external IDs',
  );
  const knownListSpans = new Map();
  function knownListSpan(object) {
    if (knownListSpans.has(object.encoded)) return knownListSpans.get(object.encoded);
    const expectedSize = LIST_SIZES.get(object.type);
    if (expectedSize === undefined) return null;
    check(object.size === expectedSize, 'Known list backing span has an unsupported object size');
    const count = z.u32(object.offset + 0xc),
      capacity = z.u32(object.offset + 0x10),
      size = z.u32(object.offset + 0x18);
    check(
      count <= capacity && capacity <= 1_000_000 && size === capacity * 8,
      'Known list backing span has invalid/unsupported count/capacity/span',
    );
    let span = null;
    if (size) {
      const ref = z.pointerReferencesByOffset.get(object.offset + 0x20);
      check(
        ref && z.u64(object.offset + 0x20) === BigInt(ref.encoded),
        'Known list backing span requires an ordinary ROFS data pointer',
      );
      const start = z.resolvePointer(ref.encoded, size).offset;
      span = { start, end: start + size };
    }
    knownListSpans.set(object.encoded, span);
    return span;
  }
  for (const request of requests) {
    const listEncoded = request.listEncoded,
      label = request.root ? 'ROOT' : request.expectedType;
    const root = z.objectsByOffset.get(z.resolvePointer(listEncoded).offset),
      expectedSize = LIST_SIZES.get(request.expectedType);
    check(
      root?.section === 1 && root.type === request.expectedType && root.size === expectedSize,
      `${label} must be a Default ${request.expectedType} size 0x${expectedSize.toString(16)}`,
    );
    const existing = request.appendExistingObjects ?? [];
    check(
      Array.isArray(existing) &&
        existing.length <= 10000 &&
        (!existing.length || request.expectedType === 'ScriptSetList'),
      'Existing references require a bounded ScriptSetList extension',
    );
    check(
      Array.isArray(request.appendObjects) &&
        request.appendObjects.length + existing.length > 0 &&
        request.appendObjects.length + existing.length <= 10_000,
      `${label} additions must contain 1–10000 appended object offsets`,
    );
    const addedEncoded = [],
      addedSet = new Set();
    for (const offset of request.appendObjects) {
      check(
        objectOffsets.has(offset) && !addedSet.has(offset),
        `${label} additions must uniquely name appended typed objects`,
      );
      addedSet.add(offset);
      addedEncoded.push(appendOffset + offset);
    }
    const existingSeen = new Set();
    for (const encoded of existing) {
      integer(encoded, 4, 0xffffffff, 'existing object encoded address');
      const object = z.objects.find((o) => o.encoded === encoded);
      check(
        object && !existingSeen.has(encoded),
        'Existing references must uniquely identify original typed object starts',
      );
      existingSeen.add(encoded);
      addedEncoded.push(encoded);
    }
    const count = z.u32(root.offset + 0xc),
      capacity = z.u32(root.offset + 0x10),
      dataSize = z.u32(root.offset + 0x18);
    check(
      count === capacity && count <= 1_000_000 && dataSize === count * 8,
      `Invalid/unsupported source ${label} list count/capacity/span`,
    );
    check(count + addedEncoded.length <= 1_000_000, `Enlarged ${label} list exceeds count limit`);
    const insertAt =
      request.insertAt === undefined ? count : integer(request.insertAt, 0, count, `${label} insertAt`);
    const oldEntries = [],
      dataRef = z.pointerReferencesByOffset.get(root.offset + 0x20);
    check(
      dataRef && z.u64(root.offset + 0x20) === BigInt(dataRef.encoded),
      `${label} requires an existing ordinary ROFS data pointer`,
    );
    z.resolvePointer(dataRef.encoded, count * 8);
    const arrayStart = dataRef.targetOffset,
      arrayEnd = arrayStart + count * 8,
      entryFixups = new Map();
    // Do not overwrite a scalar header word that is actually declared as a
    // relocation. The only allowed relocation in changed fields is the data
    // pointer itself; ScriptSetList's external type at +0x28 is outside them.
    for (const kind of SLOT_KINDS) {
      const table = z.offsetTables.get(kind);
      if (!table) continue;
      for (let i = 0; i < table.offsets.length; i++) {
        const slot = table.offsets[i];
        if (
          ![
            [0xc, 4],
            [0x10, 4],
            [0x18, 4],
            [0x20, 8],
          ].some(([field, width]) => slot < root.offset + field + width && slot + 8 > root.offset + field)
        )
          continue;
        check(
          kind === 'ROFS' && slot === root.offset + 0x20 && !(table.encodedOffsets[i] & 0x04000000),
          `${label} header has a conflicting relocation`,
        );
      }
    }
    check(
      !z.objects.some((o) => o.offset < arrayEnd && o.offset + o.size > arrayStart),
      `Source ${label} array overlaps a typed object`,
    );
    // A different list may start before this array yet include its entries.
    // Checking only pointer targets inside the moved range would miss that
    // alias and strand the other list's entries without their relocated fixups.
    for (const other of z.objects) {
      if (other.encoded === listEncoded) continue;
      const span = knownListSpan(other);
      check(
        !span || count === 0 || span.start >= arrayEnd || span.end <= arrayStart,
        `Source ${label} array is shared/aliased: overlaps another known list backing span`,
      );
    }
    check(
      !z.pointerReferences.some(
        (ref) =>
          ref.offset !== root.offset + 0x20 && ref.targetOffset >= arrayStart && ref.targetOffset < arrayEnd,
      ),
      `Source ${label} array is shared/aliased; moving its fixups is unsafe`,
    );
    for (const offset of slots.ROFS ?? []) {
      const target = bytes.readUInt32LE(offset);
      check(
        target < dataRef.encoded || target >= dataRef.encoded + count * 8,
        `New ROFS aliases the old ${label} array`,
      );
    }
    const tmhn = z.fixupMap.get('TMHN');
    for (let i = 0; i < (tmhn?.count ?? 0); i++) {
      const at = tmhn.dataOffset + i * 16,
        size = z.u32(at),
        target = z.u32(at + 8);
      if (z.u32(at + 12) !== 0) continue; // No inferred 64-bit pointer schema.
      check(
        !(target < dataRef.encoded + count * 8 && target + Math.max(1, size) > dataRef.encoded),
        `Source ${label} array is aliased by a TMHN data span`,
      );
    }
    // Move, do not duplicate, the old array's relocation slots. In particular
    // a sign-tagged REXT/RNEX entry retains its external object while loading;
    // leaving the old slot active would introduce a second, orphaned retain.
    for (const kind of SLOT_KINDS) {
      const table = z.offsetTables.get(kind);
      if (!table) continue;
      for (let i = 0; i < table.offsets.length; i++) {
        const at = table.offsets[i];
        if (at >= arrayEnd || at + 8 <= arrayStart) continue;
        check(
          at >= arrayStart && at + 8 <= arrayEnd && (at - arrayStart) % 8 === 0 && !entryFixups.has(at),
          `Source ${label} array has overlapping/misaligned fixups`,
        );
        check(
          kind === 'ROFS' || kind === 'REXT' || kind === 'RNEX',
          `Source ${label} array has an unsupported relocation kind`,
        );
        check(
          kind !== 'ROFS' || !(table.encodedOffsets[i] & 0x04000000),
          `${label} array initializer-flag ROFS cannot be moved`,
        );
        entryFixups.set(at, kind);
        removed.get(kind).add(table.encodedOffsets[i]);
      }
    }
    for (let i = 0; i < count; i++) {
      const slot = arrayStart + i * 8,
        ref = z.pointerReferencesByOffset.get(slot),
        raw = z.u64(slot),
        kind = entryFixups.get(slot) ?? null;
      if (kind === 'ROFS')
        check(
          ref && ref.targetObjectIndex !== null && raw === BigInt(ref.encoded),
          `Source ${label} array contains an unresolved/non-object pointer`,
        );
      else if (kind === 'REXT' || kind === 'RNEX') {
        const count = z.fixupMap.get(kind === 'REXT' ? 'EXID' : 'EXNM')?.count ?? 0;
        check(
          (raw & 0x7fffffffffffffffn) < BigInt(count),
          `Source ${label} external index exceeds its preserved table`,
        );
      } else check(raw === 0n, `Source ${label} array has an unexplained nonzero unrelocated entry`);
      oldEntries.push({ kind, raw });
    }
    const arrayOffset = align(appendedEnd, 8),
      entries = [
        ...oldEntries.slice(0, insertAt),
        ...addedEncoded.map((encoded) => ({ kind: 'ROFS', raw: BigInt(encoded) })),
        ...oldEntries.slice(insertAt),
      ];
    appendedEnd = arrayOffset + entries.length * 8;
    check(
      appendedEnd < DEFAULT_LIMIT && appendedEnd - pool.dataSize <= MAX_APPEND,
      `Relocated ${label} array exceeds append limit`,
    );
    const plan = {
      listEncoded,
      type: root.type,
      label,
      oldArrayEncoded: dataRef.encoded,
      arrayOffset,
      entries,
      oldCount: count,
      addedEncoded,
      existingEncoded: existing,
      insertAt,
      changes: [],
      movedRelocations: Object.fromEntries(
        [...new Set(entryFixups.values())].map((kind) => [
          kind,
          [...entryFixups.values()].filter((value) => value === kind).length,
        ]),
      ),
    };
    listPlans.push(plan);
    if (request.root) rootPlan = plan;
    for (let i = 0; i < entries.length; i++)
      if (entries[i].kind) added.get(entries[i].kind).push(arrayOffset + i * 8);
    for (const [field, before, after, width] of [
      [0xc, count, entries.length, 4],
      [0x10, capacity, entries.length, 4],
      [0x18, dataSize, entries.length * 8, 4],
      [0x20, dataRef.encoded, arrayOffset, 8],
    ]) {
      const change = { encoded: listEncoded + field, fieldOffset: field, width, before, after };
      plan.changes.push(change);
      listChanges.push(change);
    }
  }

  const nextDefault = Buffer.alloc(appendedEnd);
  input.copy(nextDefault, 0, pool.offset, pool.offset + pool.dataSize);
  bytes.copy(nextDefault, appendOffset);
  for (const plan of listPlans) {
    for (const change of plan.changes) {
      if (change.width === 8) nextDefault.writeBigUInt64LE(BigInt(change.after), change.encoded);
      else nextDefault.writeUInt32LE(change.after, change.encoded);
    }
    plan.entries.forEach((entry, i) => nextDefault.writeBigUInt64LE(entry.raw, plan.arrayOffset + i * 8));
  }
  const changedFixups = [],
    expectedOffsets = new Map();
  const blocks = z.fixups.map((f) => {
    if (f.magic === 'EXID' && newExternalIds.length) {
      const next = Buffer.alloc(f.length + newExternalIds.length * 8);
      input.copy(next, 0, f.offset, f.end);
      newExternalIds.forEach((pair, i) => {
        next.writeUInt32LE(pair.nameId, f.length + i * 8);
        next.writeUInt32LE(pair.namespaceHash, f.length + i * 8 + 4);
      });
      next.writeUInt32LE(f.count + newExternalIds.length, 4);
      next.writeUInt32LE(next.length, 8);
      changedFixups.push({
        kind: 'EXID',
        previousCount: f.count,
        addedCount: newExternalIds.length,
        count: f.count + newExternalIds.length,
        previousSize: f.length,
        size: next.length,
      });
      return next;
    }
    if (f.magic === 'TSTR' && newStrings.length) {
      // Existing entries are two-byte aligned; only the old block's final
      // zero padding is replaced. Never re-encode/rename existing strings.
      const last = z.stringEntries.at(-1),
        oldEnd = last ? align(last.offset + last.byteLength + 1, 2) : f.dataOffset;
      const payloads = newStrings.map((value) => {
        const bytes = Buffer.alloc(align(value.length + 1, 2));
        bytes.write(value, 'ascii');
        return bytes;
      });
      const next = Buffer.alloc(align(oldEnd - f.offset + stringBytes, 4));
      input.copy(next, 0, f.offset, oldEnd);
      let cursor = oldEnd - f.offset;
      for (const payload of payloads) {
        payload.copy(next, cursor);
        cursor += payload.length;
      }
      next.writeUInt32LE(f.count + newStrings.length, 4);
      next.writeUInt32LE(next.length, 8);
      changedFixups.push({
        kind: 'TSTR',
        previousCount: f.count,
        addedCount: newStrings.length,
        count: f.count + newStrings.length,
        previousSize: f.length,
        size: next.length,
      });
      return next;
    }
    const additions = added.get(f.magic) ?? [],
      removals = removed.get(f.magic) ?? new Set();
    if (!additions.length && !removals.size) return input.subarray(f.offset, f.end);
    const existing = Array.from(z.offsetTables.get(f.magic).encodedOffsets).filter(
      (offset) => !removals.has(offset),
    );
    const values = [...existing, ...additions].sort((a, b) => a - b);
    expectedOffsets.set(f.magic, values);
    const block = rebuildOffsetBlock(z, f, values);
    changedFixups.push({
      kind: f.magic,
      previousCount: f.count,
      addedCount: additions.length,
      removedCount: removals.size,
      count: values.length,
      previousSize: f.length,
      size: block.length,
    });
    return block;
  });
  check(
    (added.get('RVTB').length > 0 || listOnly) && z.fixupMap.has('RVTB'),
    'Source has no writable RVTB table',
  );
  check(
    blocks.reduce((total, block) => total + block.readUInt32LE(4), 0) <= 2_000_000,
    'Rebuilt fixup entries exceed source-profile allocation limit',
  );
  const fixups = Buffer.concat(blocks),
    fixup = z.descriptors[0];
  check(fixups.length <= 64 * 1024 * 1024, 'Rebuilt fixups exceed 64 MiB');
  const fixupDelta = fixups.length - fixup.dataSize,
    defaultDelta = nextDefault.length - pool.dataSize;
  const outputSize = input.length + fixupDelta + defaultDelta;
  check(outputSize <= MAX_SOURCE && outputSize <= U32, 'Output exceeds the 1 GiB structural writer limit');
  const prefix = Buffer.from(input.subarray(0, fixup.offset));
  prefix.writeUInt32LE(fixups.length, 0x14 + 8);
  for (const descriptor of z.descriptors.slice(1)) {
    const at = 0x14 + descriptor.index * 16;
    prefix.writeUInt32LE(descriptor.offset + fixupDelta + (descriptor.index > 1 ? defaultDelta : 0), at + 4);
    if (descriptor.index === 1) prefix.writeUInt32LE(nextDefault.length, at + 8);
  }
  const buffer = Buffer.concat(
    [
      prefix,
      fixups,
      input.subarray(fixup.offset + fixup.dataSize, pool.offset),
      nextDefault,
      input.subarray(pool.offset + pool.dataSize),
    ],
    outputSize,
  );

  // Independent parser + explicit byte/identity invariants. Reparse alone is
  // insufficient: it would not detect accidental edits to opaque pool content.
  const verified = parseIgz(buffer),
    newPool = verified.descriptors[1];
  check(verified.unresolvedFixupEntries.length === 0, 'Output introduced unresolved fixups');
  check(
    verified.objects.length === z.objects.length + appendedObjects.length,
    'Output object count mismatch',
  );
  const allowedHeader = new Set();
  for (const descriptor of z.descriptors) {
    if (descriptor.index > 0)
      for (let i = 0; i < 4; i++) allowedHeader.add(0x14 + descriptor.index * 16 + 4 + i);
    if (descriptor.index <= 1)
      for (let i = 0; i < 4; i++) allowedHeader.add(0x14 + descriptor.index * 16 + 8 + i);
  }
  for (let at = 0; at < prefix.length; at++)
    check(input[at] === buffer[at] || allowedHeader.has(at), 'Unrelated header byte changed');
  const rootSpans = [...listChanges].sort((a, b) => a.encoded - b.encoded);
  let cursor = 0;
  for (const span of rootSpans) {
    check(
      input
        .subarray(pool.offset + cursor, pool.offset + span.encoded)
        .equals(buffer.subarray(newPool.offset + cursor, newPool.offset + span.encoded)),
      'Unrelated Default bytes changed',
    );
    cursor = span.encoded + span.width;
  }
  check(
    input
      .subarray(pool.offset + cursor, pool.offset + pool.dataSize)
      .equals(buffer.subarray(newPool.offset + cursor, newPool.offset + pool.dataSize)),
    'Unrelated trailing Default bytes changed',
  );
  check(
    input.subarray(pool.offset + pool.dataSize).equals(buffer.subarray(newPool.offset + newPool.dataSize)),
    'Later pools/gaps changed',
  );
  check(
    input
      .subarray(fixup.offset + fixup.dataSize, pool.offset)
      .equals(buffer.subarray(fixup.offset + fixups.length, newPool.offset)),
    'Inter-pool padding changed',
  );
  check(
    nextDefault.equals(buffer.subarray(newPool.offset, newPool.offset + newPool.dataSize)),
    'Default rebuild differs from the explicit plan',
  );
  check(
    bytes.equals(
      buffer.subarray(newPool.offset + appendOffset, newPool.offset + appendOffset + bytes.length),
    ),
    'Caller-supplied appended bytes changed',
  );
  check(verified.descriptors.length === z.descriptors.length, 'Pool count changed');
  for (const [i, descriptor] of z.descriptors.entries()) {
    const next = verified.descriptors[i];
    check(
      next.identifier === descriptor.identifier &&
        next.name === descriptor.name &&
        next.alignment === descriptor.alignment &&
        next.sentinel === descriptor.sentinel,
      'Pool identity/flags changed',
    );
    const offset = descriptor.offset + (i > 0 ? fixupDelta : 0) + (i > 1 ? defaultDelta : 0);
    check(
      next.offset === offset &&
        next.dataSize === descriptor.dataSize + (i === 0 ? fixupDelta : i === 1 ? defaultDelta : 0),
      'Pool extent disagrees with append plan',
    );
  }
  for (const f of z.fixups) {
    const next = verified.fixupMap.get(f.magic);
    if (f.magic === 'EXID' && newExternalIds.length) {
      check(
        next.count === f.count + newExternalIds.length && next.end - next.dataOffset === next.count * 8,
        'EXID append count/span mismatch',
      );
      check(
        input
          .subarray(f.dataOffset, f.end)
          .equals(buffer.subarray(next.dataOffset, next.dataOffset + f.count * 8)),
        'Existing EXID pairs/indices changed',
      );
      check(
        input
          .subarray(f.offset + 12, f.dataOffset)
          .equals(buffer.subarray(next.offset + 12, next.dataOffset)),
        'EXID header extension changed',
      );
      newExternalIds.forEach((pair, i) => {
        const at = next.dataOffset + (f.count + i) * 8;
        check(
          verified.u32(at) === pair.nameId && verified.u32(at + 4) === pair.namespaceHash,
          'Appended EXID pair differs from plan',
        );
      });
    } else if (f.magic === 'TSTR' && newStrings.length) {
      check(
        JSON.stringify(verified.strings) === JSON.stringify([...z.strings, ...newStrings]),
        'TSTR append did not retain exact string identities',
      );
      const last = z.stringEntries.at(-1),
        oldEnd = last ? align(last.offset + last.byteLength + 1, 2) : f.dataOffset;
      check(
        input
          .subarray(f.dataOffset, oldEnd)
          .equals(buffer.subarray(next.dataOffset, next.dataOffset + oldEnd - f.dataOffset)),
        'Existing TSTR payload bytes changed',
      );
      check(
        input
          .subarray(f.offset + 12, f.dataOffset)
          .equals(buffer.subarray(next.offset + 12, next.dataOffset)),
        'TSTR header extension changed',
      );
    } else if (!expectedOffsets.has(f.magic))
      check(
        input.subarray(f.offset, f.end).equals(buffer.subarray(next.offset, next.end)),
        `${f.magic} changed unexpectedly`,
      );
    else
      check(
        JSON.stringify(Array.from(verified.offsetTables.get(f.magic).encodedOffsets)) ===
          JSON.stringify(expectedOffsets.get(f.magic)),
        `${f.magic} failed codec roundtrip`,
      );
  }
  const outputObjects = new Map(verified.objects.map((o) => [o.encoded, o]));
  for (const object of z.objects) {
    const next = outputObjects.get(object.encoded);
    check(
      next?.typeIndex === object.typeIndex && next.size === object.size,
      'Original typed object identity changed',
    );
  }
  const addedObjects = appendedObjects.map((o) => {
    const next = outputObjects.get(o.encoded);
    check(
      next?.typeIndex === o.typeIndex && next.size === o.size && next.section === 1,
      'Appended typed object identity changed',
    );
    return { ...o, index: next.index };
  });
  for (const plan of listPlans) {
    const root = outputObjects.get(plan.listEncoded);
    check(
      verified.u32(root.offset + 0xc) === plan.entries.length &&
        verified.u32(root.offset + 0x10) === plan.entries.length &&
        verified.u32(root.offset + 0x18) === plan.entries.length * 8 &&
        verified.u64(root.offset + 0x20) === BigInt(plan.arrayOffset),
      `${plan.label} list header does not match the requested relocation`,
    );
    for (const [i, entry] of plan.entries.entries()) {
      const slot = newPool.offset + plan.arrayOffset + i * 8;
      const ref = verified.pointerReferencesByOffset.get(slot);
      check(verified.u64(slot) === entry.raw, `Relocated ${plan.label} entry bytes changed`);
      if (entry.kind === 'ROFS')
        check(
          ref?.encoded === Number(entry.raw) && ref.targetObjectIndex !== null,
          `Relocated ${plan.label} pointer is not the requested typed object`,
        );
    }
  }
  const listManifest = (plan) => ({
    listEncoded: plan.listEncoded,
    type: plan.type,
    previousArrayEncoded: plan.oldArrayEncoded,
    arrayEncoded: plan.arrayOffset,
    previousCount: plan.oldCount,
    count: plan.entries.length,
    addedEncodedObjects: plan.addedEncoded,
    reusedExistingEncodedObjects: plan.existingEncoded,
    changes: plan.changes,
    previousArrayPreserved: true,
    insertAt: plan.insertAt,
    originalEntryOrderPreserved: true,
    originalEntryIndicesPreserved: plan.insertAt === plan.oldCount,
    movedRelocations: plan.movedRelocations,
  });
  const manifest = {
    format: 'skylanders-igz-append-manifest',
    version: 1,
    evidence: IGZ_APPEND_EVIDENCE,
    source: { sha256: options.expectedSha256, size: input.length, objectCount: z.objects.length },
    appended: {
      sha256: hash(bytes),
      size: bytes.length,
      encodedStart: appendOffset,
      objects: addedObjects,
      strings: newStrings.map((value, i) => ({ index: z.strings.length + i, value })),
      externalIds: newExternalIds.map((pair, i) => ({ index: exid.count + i, ...pair })),
    },
    output: { sha256: hash(buffer), size: buffer.length, objectCount: verified.objects.length },
    pools: z.descriptors.map((d, i) => ({
      index: i,
      name: d.name,
      previousOffset: d.offset,
      offset: verified.descriptors[i].offset,
      previousSize: d.size,
      size: verified.descriptors[i].size,
    })),
    fixups: changedFixups,
    originalObjectIndicesShifted: z.objects.filter((o) => outputObjects.get(o.encoded).index !== o.index)
      .length,
    rootList: rootPlan ? { ...listManifest(rootPlan), rootEncoded: rootPlan.listEncoded } : null,
    objectLists: listPlans.filter((plan) => plan !== rootPlan).map(listManifest),
    limitations: [
      'Structural validation only; no runtime compatibility, ownership, actor-cloning or new-level claim.',
      'No new types, dependencies, EXNM/TMHN entries, pools or initializer-flag ROFS slots; EXID pairs are explicit append-only additions.',
      'Existing encoded addresses and relative old-list-entry order stay stable; insertion shifts list indices and later-pool RVTB indices may shift.',
      'List growth is structural only. Caller supplies item types/ownership counts, sign-retain policy and any branch/PC updates; original object fields remain unchanged.',
    ],
  };
  return { buffer, manifest };
}

function sameStat(a, b) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}
function readExact(fd, size, label) {
  const bytes = Buffer.alloc(size);
  for (let position = 0; position < size; ) {
    const count = fs.readSync(fd, bytes, position, Math.min(size - position, 1024 * 1024), position);
    check(count > 0, `${label} changed or ended early`);
    position += count;
  }
  return bytes;
}
function readBounded(filename, limit, label) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    check(before.isFile() && before.size <= limit, `${label} must be a regular file <=${limit} bytes`);
    const bytes = readExact(fd, before.size, label);
    check(
      sameStat(before, fs.fstatSync(fd)) && sameStat(before, fs.statSync(filename)),
      `${label} changed during read`,
    );
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
function ownsPath(filename, owned) {
  const now = fs.lstatSync(filename);
  return now.isFile() && now.dev === owned.dev && now.ino === owned.ino;
}
function removeOwned(filename, owned) {
  if (!owned) return;
  try {
    const now = fs.lstatSync(filename);
    if (now.dev === owned.dev && now.ino === owned.ino) fs.unlinkSync(filename);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/** File wrapper: fully validate before exclusive creation, fsync, clean up only
 * files this invocation created on failure. Existing files and dangling symlinks
 * both fail O_EXCL. Parent directories must already exist.
 */
export function writeIgzAppend({ source, output, ...options }) {
  check(
    typeof source === 'string' && typeof output === 'string',
    'Explicit source and output paths are required',
  );
  source = path.resolve(source);
  output = path.resolve(output);
  const manifestPath = output + '.manifest.json';
  check(source !== output && source !== manifestPath, 'Source and destinations must differ');
  const sourceFd = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  let outputFd,
    manifestFd,
    ownedOutput,
    ownedManifest,
    completed = false;
  try {
    const stat = fs.fstatSync(sourceFd);
    check(stat.isFile() && stat.size <= MAX_SOURCE, 'Source must be a regular file of at most 1 GiB');
    const input = readExact(sourceFd, stat.size, 'Source');
    check(
      sameStat(stat, fs.fstatSync(sourceFd)) && sameStat(stat, fs.statSync(source)),
      'Source changed during bounded read',
    );
    const result = appendIgz(input, options);
    check(
      sameStat(stat, fs.fstatSync(sourceFd)) && sameStat(stat, fs.statSync(source)),
      'Source changed during append planning',
    );
    outputFd = fs.openSync(output, 'wx+', 0o600);
    ownedOutput = fs.fstatSync(outputFd);
    manifestFd = fs.openSync(manifestPath, 'wx', 0o600);
    ownedManifest = fs.fstatSync(manifestFd);
    fs.writeFileSync(outputFd, result.buffer);
    fs.fsyncSync(outputFd);
    const digest = createHash('sha256'),
      chunk = Buffer.alloc(1024 * 1024);
    for (let position = 0; position < result.buffer.length; ) {
      const n = fs.readSync(
        outputFd,
        chunk,
        0,
        Math.min(chunk.length, result.buffer.length - position),
        position,
      );
      check(n > 0, 'Output readback ended early');
      digest.update(chunk.subarray(0, n));
      position += n;
    }
    check(digest.digest('hex') === result.manifest.output.sha256, 'Output file readback SHA-256 mismatch');
    check(
      fs.fstatSync(outputFd).size === result.buffer.length && ownsPath(output, ownedOutput),
      'Output path/length changed concurrently',
    );
    check(
      sameStat(stat, fs.fstatSync(sourceFd)) && sameStat(stat, fs.statSync(source)),
      'Source changed during append output',
    );
    result.manifest.source.path = source;
    result.manifest.output.path = output;
    fs.writeFileSync(manifestFd, JSON.stringify(result.manifest, null, 2) + '\n');
    fs.fsyncSync(manifestFd);
    check(
      ownsPath(manifestPath, ownedManifest) && ownsPath(output, ownedOutput),
      'Output/manifest path changed concurrently',
    );
    completed = true;
    return {
      output,
      manifest: manifestPath,
      sha256: result.manifest.output.sha256,
      addedObjects: result.manifest.appended.objects,
      objectCount: result.manifest.output.objectCount,
      runtimeValidated: false,
    };
  } finally {
    if (manifestFd !== undefined) fs.closeSync(manifestFd);
    if (outputFd !== undefined) fs.closeSync(outputFd);
    fs.closeSync(sourceFd);
    if (!completed) {
      removeOwned(manifestPath, ownedManifest);
      removeOwned(output, ownedOutput);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    check(process.argv.length === 3, 'Usage: node tools/igz_append.mjs /absolute/path/to/request.json');
    const filename = path.resolve(process.argv[2]);
    const request = JSON.parse(readBounded(filename, 4 * 1024 * 1024, 'Request').toString('utf8'));
    keys(
      request,
      [
        'source',
        'output',
        'expectedSha256',
        'appendFile',
        'appendedObjects',
        'fixupSlots',
        'rootList',
        'objectLists',
        'newStrings',
        'newExternalIds',
      ],
      'Request',
    );
    check(typeof request.appendFile === 'string', 'Explicit appendFile is required');
    const appendFile = path.resolve(request.appendFile);
    const { appendFile: ignored, ...options } = request;
    console.log(
      JSON.stringify(
        writeIgzAppend({
          ...options,
          appendedDefaultPool: readBounded(appendFile, MAX_APPEND, 'appendFile'),
        }),
      ),
    );
  } catch (error) {
    console.log(JSON.stringify({ error: { message: error.message } }));
    process.exitCode = 1;
  }
}
