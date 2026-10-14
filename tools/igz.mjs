import fs from 'node:fs';
import path from 'node:path';

// Read-only structural reader for Skylanders Trap Team PS4 IGZ v8/platform 14.
// No object field schema is inferred here. Format references:
// NefariousTechSupport/igArchiveExtractor (v8 offset codec),
// kishimisu/Crash-NST-Level-Editor (chunk fields and typed fixup semantics).
// v8 ROFS/RMHN loader semantics were verified in CUSA00697 FUN_00568430:
// REA ev_ec2b575e84cb4f06b1aba8c75f1ce0d82f7db4a2852eab4ef8b43300b51f0e8b.
const LOADER_EVIDENCE = 'ev_ec2b575e84cb4f06b1aba8c75f1ce0d82f7db4a2852eab4ef8b43300b51f0e8b';
const OFFSET_FIXUPS = new Set(['RVTB', 'RSTT', 'ROFS', 'RPID', 'REXT', 'RHND', 'RNEX', 'RMHN']);
const MAX_U32 = 0xffffffff;
function check(condition, message) {
  if (!condition) throw new Error(message);
}
function lowerBound(items, value, key = (x) => x) {
  let lo = 0,
    hi = items.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (key(items[mid]) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function parseIgz(input, options = {}) {
  const file = typeof input === 'string' ? path.resolve(input) : (options.file ?? null);
  const buffer = typeof input === 'string' ? fs.readFileSync(file) : input;
  check(Buffer.isBuffer(buffer), 'parseIgz expects a file path or Buffer');
  const size = buffer.length;
  function range(offset, length, label = 'read') {
    check(
      Number.isSafeInteger(offset) &&
        Number.isSafeInteger(length) &&
        offset >= 0 &&
        length >= 0 &&
        offset + length <= size,
      `${label}: out-of-range access at 0x${offset.toString(16)} (${length} bytes)`,
    );
  }
  function u32(offset) {
    range(offset, 4);
    return buffer.readUInt32LE(offset);
  }
  function u64(offset) {
    range(offset, 8);
    return buffer.readBigUInt64LE(offset);
  }
  function cstring(offset, end, label) {
    range(offset, end - offset, label);
    const relativeStop = buffer.subarray(offset, end).indexOf(0);
    check(relativeStop >= 0, `${label}: unterminated string at 0x${offset.toString(16)}`);
    const stop = offset + relativeStop;
    return {
      offset,
      byteLength: stop - offset,
      value: buffer.toString('utf8', offset, stop),
      next: stop + 1,
    };
  }
  range(0, 0x24, 'IGZ header');
  check(u32(0) === 0x49475a01, 'Expected little-endian IGZ signature 01 5a 47 49');
  const version = u32(4),
    platform = u32(12),
    declaredFixupCount = u32(16);
  check(
    version === 8 && platform === 14,
    `Unsupported IGZ version/platform ${version}/${platform}; reader validated only for v8/PS4 (14)`,
  );
  const descriptors = [];
  // Descriptor begins at 0x14: pool-name offset, file offset, size, alignment.
  for (let at = 0x14; ; at += 16) {
    range(at, 16, 'descriptor');
    check(at + 16 <= 0x224, 'Descriptor list overlaps the pool-name table');
    const identifier = u32(at),
      offset = u32(at + 4),
      declaredSize = u32(at + 8),
      alignment = u32(at + 12);
    if (offset === 0) break;
    descriptors.push({ index: descriptors.length, identifier, offset, size: declaredSize, alignment });
  }
  check(descriptors.length >= 2, 'IGZ requires fixup and object descriptors');
  for (let i = 0; i < descriptors.length; i++) {
    const d = descriptors[i],
      boundary = descriptors[i + 1]?.offset ?? size;
    check(boundary >= d.offset, `Descriptor ${i} is out of file order`);
    d.name = cstring(0x224 + d.identifier, descriptors[0].offset, `pool ${i} name`).value;
    d.sentinel = d.size === MAX_U32;
    if (d.sentinel) {
      // Observed -1-size pools contain one zero word; do not treat as four GiB
      // or silently allow object/data pointers into these placeholder slots.
      check(
        d.alignment === 0 && boundary - d.offset === 4 && u32(d.offset) === 0,
        `Descriptor ${i}: unrecognized 0xffffffff-size pool representation`,
      );
      d.storageSize = 4;
      d.dataSize = 0;
    } else {
      range(d.offset, d.size, `descriptor ${i}`);
      check(d.offset + d.size <= boundary, `Descriptor ${i} overlaps the next pool`);
      d.storageSize = d.size;
      d.dataSize = d.size;
    }
  }
  function resolvePointer(encoded, length = 1) {
    if (typeof encoded === 'bigint') {
      check(
        encoded >= 0n && encoded <= 0xffffffffn,
        `Pointer exceeds serialized uint32: 0x${encoded.toString(16)}`,
      );
      encoded = Number(encoded);
    }
    check(Number.isInteger(encoded) && encoded >= 0 && encoded <= MAX_U32, 'Invalid encoded pointer');
    check(Number.isSafeInteger(length) && length >= 0, 'Invalid pointer span');
    const section = Math.floor(encoded / 0x08000000) + 1,
      relative = encoded % 0x08000000;
    const descriptor = descriptors[section];
    check(
      descriptor !== undefined,
      `Pointer 0x${encoded.toString(16)} references missing section ${section}`,
    );
    check(
      !descriptor.sentinel && relative + length <= descriptor.dataSize,
      `Pointer 0x${encoded.toString(16)} is outside section ${section} (${descriptor.name})`,
    );
    return { encoded, section, relative, offset: descriptor.offset + relative };
  }
  const fixups = [],
    fixupMap = new Map();
  const fixupEnd = descriptors[0].offset + descriptors[0].dataSize;
  for (let at = descriptors[0].offset; at < fixupEnd; ) {
    check(at + 16 <= fixupEnd, 'Truncated fixup header');
    const magic = buffer.toString('ascii', at, at + 4),
      count = u32(at + 4),
      length = u32(at + 8),
      startOfData = u32(at + 12);
    check(
      /^[A-Z0-9]{4}$/.test(magic) &&
        length >= 16 &&
        at + length <= fixupEnd &&
        startOfData >= 16 &&
        startOfData <= length,
      `Invalid ${magic} fixup at 0x${at.toString(16)}`,
    );
    check(!fixupMap.has(magic), `Duplicate ${magic} fixup`);
    const fixup = {
      magic,
      count,
      length,
      startOfData,
      offset: at,
      dataOffset: at + startOfData,
      end: at + length,
    };
    fixups.push(fixup);
    fixupMap.set(magic, fixup);
    at += length;
  }
  check(
    fixups.length === declaredFixupCount,
    `Expected ${declaredFixupCount} fixups, decoded ${fixups.length}`,
  );
  function alignedStrings(magic) {
    const f = fixupMap.get(magic);
    if (!f) return [];
    check(f.count <= (f.end - f.dataOffset) / 2, `${magic} count exceeds aligned string capacity`);
    const entries = [];
    let at = f.dataOffset;
    for (let i = 0; i < f.count; i++) {
      const entry = cstring(at, f.end, `${magic}[${i}]`);
      entries.push({ index: i, offset: entry.offset, byteLength: entry.byteLength, value: entry.value });
      at = entry.next + (entry.next % 2);
      check(at <= f.end, `${magic}[${i}] padding exceeds fixup`);
      if (at !== entry.next) check(buffer[entry.next] === 0, `${magic}[${i}] has nonzero alignment padding`);
    }
    check(
      f.end - at <= 3 && buffer.subarray(at, f.end).every((x) => x === 0),
      `${magic} contains unexplained trailing data`,
    );
    return entries;
  }
  const typeEntries = alignedStrings('TMET'),
    stringEntries = alignedStrings('TSTR');
  const types = typeEntries.map((e) => e.value),
    strings = stringEntries.map((e) => e.value);
  const mtsz = fixupMap.get('MTSZ');
  check(
    mtsz && mtsz.count === types.length && mtsz.dataOffset + mtsz.count * 4 <= mtsz.end,
    'TMET/MTSZ type counts or lengths disagree',
  );
  const typeSizes = Array.from({ length: mtsz.count }, (_, i) => u32(mtsz.dataOffset + i * 4));
  const unresolvedFixupEntries = [];
  function offsetTable(f) {
    let nibbleIndex = 0;
    const nibbleCount = (f.end - f.dataOffset) * 2;
    check(f.count <= nibbleCount, `${f.magic} count exceeds packed offset capacity`);
    function nextNibble() {
      check(nibbleIndex < nibbleCount, `${f.magic} packed offsets end early`);
      const value = buffer[f.dataOffset + Math.floor(nibbleIndex / 2)];
      return nibbleIndex++ % 2 ? value >>> 4 : value & 15;
    }
    const encodedOffsets = new Uint32Array(f.count),
      offsets = new Uint32Array(f.count);
    let previous = 0;
    for (let i = 0; i < f.count; i++) {
      let value = 0,
        multiplier = 1,
        nibble;
      do {
        nibble = nextNibble();
        value += (nibble & 7) * multiplier;
        multiplier *= 8;
        check(value <= MAX_U32 && multiplier <= 2 ** 36, `${f.magic}[${i}] encoded delta overflows`);
      } while (nibble & 8);
      previous += value * 4 + 4; // v8 uses +4; v9+ does not.
      check(previous <= MAX_U32, `${f.magic}[${i}] accumulated pointer overflows`);
      let resolved;
      // ROFS reserves bit 26 for a runtime initializer. Pool index still
      // occupies bits 27+, while the source slot uses a 26-bit offset.
      const location = f.magic === 'ROFS' ? (previous & ~0x04000000) >>> 0 : previous;
      try {
        resolved = resolvePointer(location, f.magic === 'ROFS' ? 8 : 4);
      } catch (error) {
        if (f.magic !== 'ROFS') throw new Error(`${f.magic}[${i}]: ${error.message}`);
        unresolvedFixupEntries.push({ magic: f.magic, index: i, encoded: previous, reason: error.message });
      }
      encodedOffsets[i] = previous;
      offsets[i] = resolved?.offset ?? 0;
    }
    while (nibbleIndex < nibbleCount)
      check(nextNibble() === 0, `${f.magic} contains unexplained trailing data`);
    return { encodedOffsets, offsets };
  }
  const offsetTables = new Map();
  for (const f of fixups) if (OFFSET_FIXUPS.has(f.magic)) offsetTables.set(f.magic, offsetTable(f));
  // Unlike the later-game ROOT nibble codec, these v8 ROOT records are raw
  // uint32 encoded offsets. Their value 8 resolves to RVTB's igObjectList.
  const rootFixup = fixupMap.get('ROOT');
  if (rootFixup) {
    check(
      rootFixup.dataOffset + rootFixup.count * 4 === rootFixup.end,
      'ROOT uint32 payload length mismatch',
    );
    const encodedOffsets = new Uint32Array(rootFixup.count),
      offsets = new Uint32Array(rootFixup.count);
    for (let i = 0; i < rootFixup.count; i++) {
      encodedOffsets[i] = u32(rootFixup.dataOffset + i * 4);
      offsets[i] = resolvePointer(encodedOffsets[i], 4).offset;
    }
    offsetTables.set('ROOT', { encodedOffsets, offsets });
  }
  const rvtb = offsetTables.get('RVTB');
  check(rvtb, 'IGZ has no RVTB object table');
  const objects = [],
    objectsByOffset = new Map();
  for (let i = 0; i < rvtb.offsets.length; i++) {
    const offset = rvtb.offsets[i],
      typeIndex = u32(offset);
    check(typeIndex < types.length, `Object ${i} has invalid type index ${typeIndex}`);
    const objectSize = typeSizes[typeIndex];
    check(objectSize >= 4, `Object ${i} has invalid MTSZ size ${objectSize}`);
    const location = resolvePointer(rvtb.encodedOffsets[i], objectSize);
    const object = { index: i, ...location, typeIndex, type: types[typeIndex], size: objectSize };
    objects.push(object);
    check(!objectsByOffset.has(offset), `Duplicate RVTB object at 0x${offset.toString(16)}`);
    objectsByOffset.set(offset, object);
  }
  const objectsInFileOrder = [...objects].sort((a, b) => a.offset - b.offset);
  for (const offset of offsetTables.get('ROOT')?.offsets ?? [])
    check(objectsByOffset.has(offset), `ROOT 0x${offset.toString(16)} does not name an RVTB object`);
  for (let i = 1; i < objectsInFileOrder.length; i++) {
    const a = objectsInFileOrder[i - 1],
      b = objectsInFileOrder[i];
    check(a.offset + a.size <= b.offset, `MTSZ object spans overlap at 0x${b.offset.toString(16)}`);
  }
  function objectContaining(offset) {
    const at = lowerBound(objectsInFileOrder, offset + 1, (o) => o.offset) - 1;
    const o = objectsInFileOrder[at];
    return o && offset < o.offset + o.size ? o : null;
  }
  const rstt = offsetTables.get('RSTT')?.offsets ?? new Uint32Array();
  const stringReferences = [],
    stringReferencesByOffset = new Map();
  for (const offset of rstt) {
    const stringIndex = u32(offset);
    check(
      stringIndex < strings.length,
      `RSTT slot 0x${offset.toString(16)} has invalid TSTR index ${stringIndex}`,
    );
    const owner = objectContaining(offset);
    const ref = {
      offset,
      stringIndex,
      value: strings[stringIndex],
      objectIndex: owner?.index ?? null,
      fieldOffset: owner ? offset - owner.offset : null,
    };
    stringReferences.push(ref);
    stringReferencesByOffset.set(offset, ref);
  }
  stringReferences.sort((a, b) => a.offset - b.offset);
  const rofsTable = offsetTables.get('ROFS');
  const rofs = rofsTable?.offsets ?? new Uint32Array();
  const pointerReferences = [],
    pointerReferencesByOffset = new Map();
  const specialRelocations = [],
    specialRelocationsByOffset = new Map();
  for (let i = 0; i < rofs.length; i++) {
    const offset = rofs[i];
    if (offset === 0) continue; // explicitly retained in unresolvedFixupEntries
    const owner = objectContaining(offset);
    if (rofsTable.encodedOffsets[i] & 0x04000000) {
      // The loader clears this slot and calls FUN_0051e460(slot) and
      // FUN_005088a0(slot, 1). Its on-disk word is NOT a relocated pointer.
      const relocation = {
        magic: 'ROFS',
        index: i,
        encoded: rofsTable.encodedOffsets[i],
        offset,
        flag: 0x04000000,
        runtimeAction: 'zero-and-initialize',
        runtimeCalls: ['FUN_0051e460(slot)', 'FUN_005088a0(slot, 1)'],
        limitation: 'Initializer callee semantics are not yet decoded',
        evidenceId: LOADER_EVIDENCE,
        objectIndex: owner?.index ?? null,
        fieldOffset: owner ? offset - owner.offset : null,
      };
      specialRelocations.push(relocation);
      specialRelocationsByOffset.set(offset, relocation);
      continue;
    }
    const target = resolvePointer(u32(offset)); // loader reads the serialized low uint32
    const targetObject = objectsByOffset.get(target.offset);
    const ref = {
      offset,
      targetOffset: target.offset,
      encoded: target.encoded,
      targetObjectIndex: targetObject?.index ?? null,
      objectIndex: owner?.index ?? null,
      fieldOffset: owner ? offset - owner.offset : null,
    };
    pointerReferences.push(ref);
    pointerReferencesByOffset.set(offset, ref);
  }
  pointerReferences.sort((a, b) => a.offset - b.offset);
  specialRelocations.sort((a, b) => a.offset - b.offset);
  const tmhnReferences = [];
  const rmhn = offsetTables.get('RMHN'),
    tmhn = fixupMap.get('TMHN');
  if (rmhn) {
    check(tmhn !== undefined, 'RMHN exists without its TMHN table');
    for (const offset of rmhn.offsets) {
      const tableIndex = u32(offset),
        owner = objectContaining(offset);
      check(
        tableIndex < tmhn.count,
        `RMHN slot 0x${offset.toString(16)} has invalid TMHN index ${tableIndex}`,
      );
      tmhnReferences.push({
        offset,
        tableIndex,
        table: 'TMHN',
        evidenceId: LOADER_EVIDENCE,
        objectIndex: owner?.index ?? null,
        fieldOffset: owner ? offset - owner.offset : null,
      });
    }
    tmhnReferences.sort((a, b) => a.offset - b.offset);
  }
  function referencesWithin(refs, object) {
    const from = lowerBound(refs, object.offset, (r) => r.offset),
      to = lowerBound(refs, object.offset + object.size, (r) => r.offset);
    return refs.slice(from, to);
  }
  function summarizeObject(objectOrIndex) {
    const o = typeof objectOrIndex === 'number' ? objects[objectOrIndex] : objectOrIndex;
    check(o !== undefined, 'Object index out of range');
    return {
      ...o,
      stringReferences: referencesWithin(stringReferences, o),
      pointerReferences: referencesWithin(pointerReferences, o),
      specialRelocations: referencesWithin(specialRelocations, o),
      tmhnReferences: referencesWithin(tmhnReferences, o),
    };
  }
  const dependencies = [],
    tdep = fixupMap.get('TDEP');
  if (tdep) {
    let at = tdep.dataOffset;
    for (let i = 0; i < tdep.count; i++) {
      const name = cstring(at, tdep.end, `TDEP[${i}].name`),
        depPath = cstring(name.next, tdep.end, `TDEP[${i}].path`);
      dependencies.push({ name: name.value, path: depPath.value });
      at = depPath.next;
    }
    check(
      tdep.end - at <= 4 && buffer.subarray(at, tdep.end).every((x) => x === 0),
      'TDEP contains unexplained trailing data',
    );
  }
  return {
    file,
    size,
    version,
    platform,
    declaredFixupCount,
    descriptors,
    fixups,
    fixupMap,
    types,
    typeSizes,
    typeEntries,
    strings,
    stringEntries,
    dependencies,
    offsetTables,
    objects,
    objectsByOffset,
    stringReferences,
    stringReferencesByOffset,
    pointerReferences,
    pointerReferencesByOffset,
    specialRelocations,
    specialRelocationsByOffset,
    tmhnReferences,
    unresolvedFixupEntries,
    resolvePointer,
    objectContaining,
    summarizeObject,
    buffer,
    u32,
    u64,
  };
}
