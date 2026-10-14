import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIgz } from '../tools/igz.mjs';
import { makeIgz } from './fixtures/igz_fixture.mjs';

test('parses named actors, typed spans, root, strings and pointer targets', () => {
  const z = parseIgz(makeIgz());
  assert.deepEqual(z.types, ['igObjectList', 'tfbActorInfo']);
  assert.equal(z.objects.length, 3);
  assert.equal(z.objects[0].encoded, 8);
  assert.equal(z.objectsByOffset.get(z.offsetTables.get('ROOT').offsets[0]), z.objects[0]);
  assert.deepEqual(z.strings, ['Alpha', 'Beta']);
  assert.equal(z.objects[1].size, 0x170);
  assert.equal(z.stringReferencesByOffset.get(z.objects[1].offset + 0x10).value, 'Alpha');
  assert.deepEqual(
    Array.from({ length: 6 }, (_, i) => z.buffer.readFloatLE(z.objects[1].offset + 0x40 + i * 4)),
    [1.25, 2.5, -3.75, 0, 90, 0],
  );
  assert.equal(z.pointerReferences.length, 3);
  assert.equal(z.pointerReferences.filter((r) => r.targetObjectIndex !== null).length, 2);
  assert.equal(z.objectContaining(z.objects[1].offset + 0x16f), z.objects[1]);
  assert.equal(z.objectContaining(z.descriptors[1].offset + 48), null);
  assert.equal(z.summarizeObject(1).stringReferences.length, 1);
});

test('retains aligned empty strings without shifting subsequent indices', () => {
  const z = parseIgz(makeIgz({ objects: [{ name: 'Odd' }, { name: '' }, { name: 'Even' }] }));
  assert.deepEqual(z.strings, ['Odd', '', 'Even']);
  assert.equal(z.stringEntries[1].byteLength, 0);
  assert.equal(z.stringEntries[2].offset - z.stringEntries[1].offset, 2);
  assert.equal(z.stringReferencesByOffset.get(z.objects[3].offset + 16).value, 'Even');
});

test('fixture supports each known placement size and an unknown type', () => {
  const z = parseIgz(
    makeIgz({ objects: [{ type: 'AbstractPlacement' }, { type: 'Placement' }], includeUnknown: true }),
  );
  assert.deepEqual(
    z.objects.slice(1).map((o) => [o.type, o.size]),
    [
      ['AbstractPlacement', 0xf0],
      ['Placement', 0x138],
      ['UnknownPlacementFixture', 0x40],
    ],
  );
});

test('recognizes a four-byte zero sentinel pool and rejects pointers into it', () => {
  const z = parseIgz(makeIgz({ sentinelPool: true }));
  assert.equal(z.descriptors[2].sentinel, true);
  assert.equal(z.descriptors[2].storageSize, 4);
  assert.equal(z.descriptors[2].dataSize, 0);
  assert.throws(() => z.resolvePointer(0x08000000), /outside section/);
  const bad = Buffer.from(z.buffer);
  bad[z.descriptors[2].offset] = 1;
  assert.throws(() => parseIgz(bad), /pool representation/);
});

test('preserves genuinely out-of-bounds ROFS locations after flag decoding', () => {
  const z = parseIgz(makeIgz({ unresolvedRofs: true }));
  assert.equal(z.unresolvedFixupEntries.length, 1);
  assert.equal(z.unresolvedFixupEntries[0].encoded, 0x07fffffc);
  assert.equal(z.offsetTables.get('ROFS').offsets.at(-1), 0);
  assert.equal(z.pointerReferences.length, 3);
});

test('flagged ROFS slots describe runtime initialization and are never pointers', () => {
  const z = parseIgz(makeIgz({ specialRelocation: true }));
  assert.equal(z.unresolvedFixupEntries.length, 0);
  assert.equal(z.specialRelocations.length, 1);
  const special = z.specialRelocations[0];
  assert.equal(special.offset, z.objects[1].offset + 0x20);
  assert.equal(special.runtimeAction, 'zero-and-initialize');
  assert.equal(special.flag, 0x04000000);
  assert.equal(special.objectIndex, 1);
  assert.equal(special.fieldOffset, 0x20);
  assert.equal(z.pointerReferencesByOffset.has(special.offset), false);
  assert.equal(z.u32(special.offset), 0xffffffff); // read-only parser preserves disk bytes
  assert.equal(z.summarizeObject(1).specialRelocations.length, 1);
});

test('decodes RMHN slot locations and bounds-checks their TMHN indices', () => {
  const buffer = makeIgz({ tmhnReference: true }),
    z = parseIgz(buffer);
  assert.equal(z.tmhnReferences.length, 1);
  assert.equal(z.tmhnReferences[0].offset, z.objects[1].offset + 0x28);
  assert.equal(z.tmhnReferences[0].tableIndex, 0);
  assert.equal(z.summarizeObject(1).tmhnReferences.length, 1);
  buffer.writeUInt32LE(1, z.tmhnReferences[0].offset);
  assert.throws(() => parseIgz(buffer), /invalid TMHN index/);
});

test('rejects malformed signatures, versions, platforms and truncated inputs', () => {
  for (const [offset, value, pattern] of [
    [0, 0, /signature/],
    [4, 9, /Unsupported/],
    [12, 6, /Unsupported/],
  ]) {
    const bad = makeIgz();
    bad.writeUInt32LE(value, offset);
    assert.throws(() => parseIgz(bad), pattern);
  }
  assert.throws(() => parseIgz(makeIgz().subarray(0, 24)), /out-of-range/);
  assert.throws(() => parseIgz(makeIgz().subarray(0, -1)), /out-of-range/);
});

test('rejects inflated fixup counts and lengths before unbounded allocation', () => {
  for (const [offset, value, pattern] of [
    [0x804, 0xffffffff, /string capacity/],
    [0x808, 0xffffffff, /Invalid TSTR/],
  ]) {
    const bad = makeIgz();
    bad.writeUInt32LE(value, offset);
    assert.throws(() => parseIgz(bad), pattern);
  }
  const bad = makeIgz(),
    z = parseIgz(bad);
  bad.writeUInt32LE(0xffffffff, z.fixupMap.get('RVTB').offset + 4);
  assert.throws(() => parseIgz(bad), /packed offset capacity/);
});

test('rejects invalid type indices, strings, object sizes and root pointers', () => {
  for (const [mutate, pattern] of [
    [(b, z) => b.writeUInt32LE(500, z.objects[1].offset), /invalid type index/],
    [(b, z) => b.writeUInt32LE(500, z.objects[1].offset + 16), /invalid TSTR index/],
    [
      (b, z) => b.writeUInt32LE(0x178, z.fixupMap.get('MTSZ').dataOffset + 4),
      /outside section|spans overlap/,
    ],
    [(b, z) => b.writeUInt32LE(12, z.fixupMap.get('ROOT').dataOffset), /does not name an RVTB/],
  ]) {
    const bad = makeIgz(),
      z = parseIgz(bad);
    mutate(bad, z);
    assert.throws(() => parseIgz(bad), pattern);
  }
});

test('rejects invalid pointer width, missing pools and out-of-bounds spans', () => {
  const z = parseIgz(makeIgz());
  assert.throws(() => z.resolvePointer(0x100000000n), /exceeds serialized uint32/);
  assert.throws(() => z.resolvePointer(0x08000000), /missing section/);
  assert.throws(() => z.resolvePointer(z.descriptors[1].size - 4, 8), /outside section/);
});

test('ordinary ROFS target reads the serialized low uint32 as the v8 loader does', () => {
  const z = parseIgz(makeIgz());
  const bad = Buffer.from(z.buffer);
  const slot = z.objects[0].offset + 32;
  bad.writeBigUInt64LE(0x100000000n | BigInt(z.u32(slot)), slot);
  const reparsed = parseIgz(bad);
  assert.equal(
    reparsed.pointerReferencesByOffset.get(slot).targetOffset,
    z.pointerReferencesByOffset.get(slot).targetOffset,
  );
});
