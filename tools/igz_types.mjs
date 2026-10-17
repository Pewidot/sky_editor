// Append type-table declarations without changing any existing object or pool.
// A declaration does not establish native support or a safe ownership policy.
// Callers must obtain names and sizes from matching shipped-artifact evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseIgz } from './igz.mjs';
import { inspectAppendTarget } from './igz_append.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const align = (n, a) => Math.ceil(n / a) * a;

// FUN_0051b8d0 hashes each eligible flattened metadata field: uint16 storage
// size, field name, then metadata class name (strings without terminators).
// It continues the header +8 accumulator; it does not hash the type's name.
// The uint16 is canonical BIG endian, even in the little-endian PS4 file:
// 505580 returns14; 5055c0(14)=1 invokes unsigned-short byte swapping first.
// REA ev_8b8a6695e1b0f4496e00420d2522f4fdc87c32c45fd63aaa0df0b204cbb12cf3.
// Eligibility and platform-specific sizes must be established by the caller.
export function extendTypeSignature(signature, fields) {
  assert.ok(Number.isInteger(signature) && signature >= 0 && signature <= 0xffffffff);
  assert.ok(Array.isArray(fields) && fields.length <= 1024);
  const hash = (bytes) => {
    for (const b of bytes) signature = Math.imul(signature ^ b, 0x1000193) >>> 0;
  };
  for (const f of fields) {
    assert.deepEqual(Object.keys(f).sort(), ['metaType', 'name', 'size']);
    assert.ok(Number.isInteger(f.size) && f.size >= 0 && f.size <= 65535);
    assert.match(f.name, /^[\x20-\x7e]{1,255}$/);
    assert.match(f.metaType, /^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16BE(f.size);
    hash(bytes);
    hash(Buffer.from(f.name, 'ascii'));
    hash(Buffer.from(f.metaType, 'ascii'));
  }
  return signature;
}

// PositionStack -> ScriptObjectList -> igObjectList, no local extra fields.
// Native flattened metadata observed read-only in runtime-sunbreak-probe-04;
// field vtables f7ee20/f7f0a0, sizes from 546aa0 / 547770 (PS4 pointer=8).
export const POSITION_STACK_FIELDS = Object.freeze([
  Object.freeze({ size: 4, name: '_count', metaType: 'igIntMetaField' }),
  Object.freeze({ size: 4, name: '_capacity', metaType: 'igIntMetaField' }),
  Object.freeze({ size: 16, name: '_data', metaType: 'igMemoryRefMetaField' }),
]);

// Native flattened metadata sampled from the owned probe06 process. Static
// fields are excluded by their +220 method. This profile retains the property
// field: callers must explicitly filter it if their loader's +10b option is1.
// Constructor566870 defaults that option to0, but56acd0 can override it.
// Runtime-only fields can participate even when serialized pointers are null.
export const OP_USER_BEHAVIOR_FIELDS = Object.freeze(
  [
    { size: 8, name: '_name', metaType: 'igStringMetaField' },
    { size: 8, name: '_getFunc', metaType: 'igRawRefMetaField' },
    { size: 8, name: '_setFunc', metaType: 'igRawRefMetaField' },
    { size: 8, name: '_resetFunc', metaType: 'igRawRefMetaField' },
    { size: 2, name: '_internalFlagsStorage', metaType: 'igUnsignedShortMetaField' },
    { size: 2, name: '_branchPC', metaType: 'igUnsignedShortMetaField' },
    { size: 0, name: '_internalFlags', metaType: 'igPropertyFieldMetaField' },
    { size: 4, name: '_thisPC', metaType: 'igUnsignedIntMetaField' },
    { size: 8, name: '_scriptInfo', metaType: 'igObjectRefMetaField' },
  ].map(Object.freeze),
);

// Same pinned runtime metadata profile as above; these declarations are only
// signatures, not a claim that a constructed script executes correctly.
export const VALUE_INFO_FIELDS = Object.freeze(
  [
    ...OP_USER_BEHAVIOR_FIELDS.slice(0, 4),
    { size: 8, name: '_type', metaType: 'igObjectRefMetaField' },
    { size: 4, name: '_value', metaType: 'igIntMetaField' },
    { size: 4, name: '_resetValue', metaType: 'igIntMetaField' },
  ].map(Object.freeze),
);
export const OP_SET_VALUE_FIELDS = Object.freeze(
  [
    ...OP_USER_BEHAVIOR_FIELDS.slice(0, 7),
    { size: 8, name: '_LHS', metaType: 'igObjectRefMetaField' },
    { size: 8, name: '_RHS', metaType: 'igObjectRefMetaField' },
  ].map(Object.freeze),
);

export function appendTypeDeclarations(source, { expectedSha256, types }) {
  inspectAppendTarget(source, expectedSha256);
  assert.ok(
    Array.isArray(types) && types.length > 0 && types.length <= 64,
    'Supply 1–64 explicit type declarations',
  );
  const z = parseIgz(source),
    names = new Set(z.types);
  for (const t of types) {
    assert.deepEqual(Object.keys(t).sort(), ['fields', 'size', 'type']);
    assert.match(t.type, /^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
    assert.ok(!names.has(t.type), 'Type must be new and unique');
    names.add(t.type);
    assert.ok(
      Number.isSafeInteger(t.size) && t.size >= 8 && t.size <= 65536 && t.size % 8 === 0,
      'Unsupported type size',
    );
    extendTypeSignature(0, t.fields);
  }
  const blocks = z.fixups.map((f) => {
    if (f.magic === 'TMET') {
      const last = z.typeEntries.at(-1),
        end = last ? align(last.offset + last.byteLength + 1, 2) : f.dataOffset;
      assert.ok(
        source.subarray(end, f.end).every((b) => b === 0),
        'Nonzero TMET trailing data',
      );
      const strings = types.map((t) => {
        const b = Buffer.alloc(align(t.type.length + 1, 2));
        b.write(t.type, 'ascii');
        return b;
      });
      const b = Buffer.alloc(align(end - f.offset + strings.reduce((n, s) => n + s.length, 0), 4));
      source.copy(b, 0, f.offset, end);
      let cursor = end - f.offset;
      for (const s of strings) {
        s.copy(b, cursor);
        cursor += s.length;
      }
      b.writeUInt32LE(f.count + types.length, 4);
      b.writeUInt32LE(b.length, 8);
      return b;
    }
    if (f.magic === 'MTSZ') {
      assert.equal(f.end - f.dataOffset, f.count * 4);
      const b = Buffer.alloc(f.length + types.length * 4);
      source.copy(b, 0, f.offset, f.end);
      types.forEach((t, i) => b.writeUInt32LE(t.size, f.length + i * 4));
      b.writeUInt32LE(f.count + types.length, 4);
      b.writeUInt32LE(b.length, 8);
      return b;
    }
    return source.subarray(f.offset, f.end);
  });
  const fixups = Buffer.concat(blocks),
    old = z.descriptors[0],
    delta = fixups.length - old.dataSize;
  const prefix = Buffer.from(source.subarray(0, old.offset));
  prefix.writeUInt32LE(fixups.length, 0x1c);
  const originalSignature = source.readUInt32LE(8);
  const signature = types.reduce((value, type) => extendTypeSignature(value, type.fields), originalSignature);
  prefix.writeUInt32LE(signature, 8);
  for (const d of z.descriptors.slice(1)) prefix.writeUInt32LE(d.offset + delta, 0x14 + d.index * 16 + 4);
  const buffer = Buffer.concat([prefix, fixups, source.subarray(old.offset + old.dataSize)]),
    a = parseIgz(buffer);
  assert.deepEqual(a.types, [...z.types, ...types.map((t) => t.type)]);
  assert.deepEqual(a.typeSizes, [...z.typeSizes, ...types.map((t) => t.size)]);
  assert.equal(a.unresolvedFixupEntries.length, 0);
  assert.equal(a.objects.length, z.objects.length);
  for (const [o, i] of z.objects.map((o, i) => [o, i])) {
    assert.equal(a.objects[i].encoded, o.encoded);
    assert.equal(a.objects[i].type, o.type);
    assert.ok(
      source
        .subarray(o.offset, o.offset + o.size)
        .equals(buffer.subarray(a.objects[i].offset, a.objects[i].offset + o.size)),
    );
  }
  for (const d of z.descriptors.slice(1)) {
    const next = a.descriptors[d.index];
    assert.equal(next.offset, d.offset + delta);
    assert.equal(next.dataSize, d.dataSize);
  }
  assert.ok(source.subarray(old.offset + old.dataSize).equals(buffer.subarray(old.offset + fixups.length)));
  for (const f of z.fixups.filter((f) => !['TMET', 'MTSZ'].includes(f.magic))) {
    const next = a.fixupMap.get(f.magic);
    assert.ok(source.subarray(f.offset, f.end).equals(buffer.subarray(next.offset, next.end)));
  }
  return {
    buffer,
    manifest: {
      schema: 'skylanders-igz-type-declarations-v1',
      sourceSha256: expectedSha256,
      outputSha256: sha(buffer),
      added: types.map((t, i) => ({ ...t, typeIndex: z.types.length + i })),
      typeSignature: { before: originalSignature, after: signature },
      existingPoolsByteExact: true,
      nativeSupportVerified: false,
      runtimeValidated: false,
    },
  };
}
