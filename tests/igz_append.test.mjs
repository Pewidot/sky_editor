import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseIgz } from '../tools/igz.mjs';
import { appendIgz, encodeV8Offsets, inspectAppendTarget, writeIgzAppend } from '../tools/igz_append.mjs';
import { makeIgz } from './fixtures/igz_fixture.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const align = (n, a) => Math.ceil(n / a) * a;

// Independent little-endian-nibble reference implementation for codec tests.
function referencePack(values) {
  let previous = 0,
    nibbles = '';
  for (const value of values) {
    const digits = ((value - previous - 4) / 4).toString(8).split('').reverse();
    nibbles += digits.map((d, i) => (Number(d) | (i < digits.length - 1 ? 8 : 0)).toString(16)).join('');
    previous = value;
  }
  if (nibbles.length % 2) nibbles += '0';
  return Buffer.from(nibbles.match(/../g)?.map((pair) => Number.parseInt(pair[1] + pair[0], 16)) ?? []);
}
function referenceUnpack(bytes, count) {
  const nibbles = [...bytes].flatMap((byte) => [byte & 15, byte >> 4]);
  const values = [];
  let at = 0,
    previous = 0;
  while (values.length < count) {
    let number = 0,
      multiplier = 1,
      nibble;
    do {
      nibble = nibbles[at++];
      assert.notEqual(nibble, undefined);
      number += (nibble & 7) * multiplier;
      multiplier *= 8;
    } while (nibble & 8);
    previous += (number + 1) * 4;
    values.push(previous);
  }
  assert.ok(nibbles.slice(at).every((n) => n === 0));
  return values;
}
function block(magic, count, payload, headerExtension = Buffer.alloc(0)) {
  const result = Buffer.alloc(align(16 + headerExtension.length + payload.length, 4));
  result.write(magic);
  result.writeUInt32LE(count, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(16 + headerExtension.length, 12);
  headerExtension.copy(result, 16);
  payload.copy(result, 16 + headerExtension.length);
  return result;
}
function modifyBlocks(input, callback) {
  const z = parseIgz(input),
    original = z.descriptors[0];
  const blocks = callback(
    z.fixups.map((f) => Buffer.from(input.subarray(f.offset, f.end))),
    z,
  );
  const next = Buffer.concat(blocks),
    delta = next.length - original.dataSize;
  const header = Buffer.from(input.subarray(0, original.offset));
  header.writeUInt32LE(blocks.length, 16);
  header.writeUInt32LE(next.length, 0x1c);
  for (const d of z.descriptors.slice(1)) header.writeUInt32LE(d.offset + delta, 0x14 + d.index * 16 + 4);
  return Buffer.concat([header, next, input.subarray(original.offset + original.dataSize)]);
}
function multiPoolFixture() {
  let bytes = makeIgz({ specialRelocation: true, tmhnReference: true });
  // An additional typed object in a later pool exercises stable serialized
  // addresses despite shifted RVTB indices. Opaque padding stays nonzero.
  const z = parseIgz(bytes),
    later = Buffer.alloc(64, 0xa5);
  later.fill(0, 8, 48);
  bytes = Buffer.concat([bytes, later, Buffer.alloc(4)]);
  for (const [at, nameOffset, offset, size, alignment] of [
    [0x34, 8, z.descriptors[1].offset + z.descriptors[1].dataSize, later.length, 16],
    [0x44, 16, bytes.length - 4, 0xffffffff, 0],
  ])
    [nameOffset, offset, size, alignment].forEach((word, i) => bytes.writeUInt32LE(word, at + i * 4));
  bytes.write('Default\0Vertex\0\0String\0', 0x224, 'ascii');
  return modifyBlocks(bytes, (blocks, parsed) =>
    blocks.map((b) => {
      if (b.toString('ascii', 0, 4) !== 'RVTB') return b;
      const values = [...parsed.offsetTables.get('RVTB').encodedOffsets, 0x08000008];
      return block('RVTB', values.length, referencePack(values), Buffer.from('12345678', 'hex'));
    }),
  );
}
function addition(input, extra = {}) {
  const expectedSha256 = sha(input),
    target = inspectAppendTarget(input, expectedSha256),
    payload = Buffer.alloc(0x170);
  payload.writeUInt32LE(1);
  payload.writeUInt32LE(1, 16);
  return {
    expectedSha256,
    appendedDefaultPool: payload,
    appendedObjects: [{ offset: 0, type: 'tfbActorInfo' }],
    fixupSlots: { RSTT: [16] },
    ...extra,
    target,
  };
}
function optionsFor(input, extra = {}) {
  const { target, ...options } = addition(input, extra);
  return options;
}

test('list-only extension reuses explicit existing typed objects without changing ownership counts', () => {
  const input = chapterListsFixture(),
    z = parseIgz(input),
    original = chapterListsOptions(input),
    list = original.objectLists[0];
  const member = z.objects.find((o) => o.type === 'StringInfo');
  const options = {
    expectedSha256: sha(input),
    appendedDefaultPool: Buffer.alloc(0),
    appendedObjects: [],
    objectLists: [
      {
        listEncoded: list.listEncoded,
        expectedType: 'ScriptSetList',
        appendObjects: [],
        appendExistingObjects: [member.encoded],
      },
    ],
  };
  const result = appendIgz(input, options),
    out = parseIgz(result.buffer);
  assert.equal(out.objects.length, z.objects.length);
  assert.deepEqual(result.manifest.objectLists[0].reusedExistingEncodedObjects, [member.encoded]);
  const after = out.objects.find((o) => o.encoded === member.encoded);
  assert.ok(
    input
      .subarray(member.offset, member.offset + member.size)
      .equals(result.buffer.subarray(after.offset, after.offset + after.size)),
  );
  for (const bad of [[member.encoded, member.encoded], [member.encoded + 4], [0xffffffff]]) {
    const changed = structuredClone(options);
    changed.appendedDefaultPool = Buffer.alloc(0);
    changed.objectLists[0].appendExistingObjects = bad;
    assert.throws(() => appendIgz(input, changed));
  }
  assert.throws(() => appendIgz(input, { ...options, objectLists: [] }), /List-only/);
  assert.throws(
    () =>
      appendIgz(input, {
        ...options,
        objectLists: [{ ...options.objectLists[0], expectedType: 'OpCodeList' }],
      }),
    /OpCodeList|ScriptSetList/,
  );
});

test('authored RPID preserves top-five memory flags and reserves its full eight-byte descriptor', () => {
  const input = modifyBlocks(makeIgz(), (blocks) => [...blocks, block('RPID', 0, Buffer.alloc(0))]);
  const options = optionsFor(input),
    payload = options.appendedDefaultPool;
  payload.writeUInt32LE(0, 24);
  payload.writeUInt32LE(0x08000000, 28);
  options.fixupSlots.RPID = [24];
  const r = appendIgz(input, options),
    z = parseIgz(r.buffer),
    appended = z.objects.at(-1);
  assert.equal(z.u64(appended.offset + 24), 0x0800000000000000n);
  assert.ok(Array.from(z.offsetTables.get('RPID').offsets).includes(appended.offset + 24));
  payload.writeUInt32LE(0xf8000000, 28);
  assert.doesNotThrow(() => appendIgz(input, options));
  payload.writeUInt32LE(0x08000001, 28);
  assert.throws(() => appendIgz(input, options), /top-five memory flags/);
  payload.writeUInt32LE(0x08000000, 28);
  options.fixupSlots.RPID = [24, 28];
  assert.throws(() => appendIgz(input, options), /pool|index|overlap/);
});
function withTemp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'igz-append-test-'));
  // Only remove this test's own uniquely created directory after assertions.
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Two typed lists with local, signed external, and null entries. A separate
// signed RNEX type reference at list+0x28 must never move or change.
function chapterListsFixture({ opcode = false } = {}) {
  let input = makeIgz({
    objects: [
      {
        type: opcode ? 'OpCodeList' : 'ScriptSetList',
        size: opcode ? 0x28 : 0x38,
        name: 'Unused list string 1',
      },
      {
        type: opcode ? 'OpCodeList' : 'ScriptSetList',
        size: opcode ? 0x28 : 0x38,
        name: 'Unused list string 2',
      },
      { type: opcode ? 'OpPreScript' : 'StringInfo', size: opcode ? 0x38 : 0x48, name: 'Original title' },
      { type: opcode ? 'OpPreScript' : 'StringInfo', size: opcode ? 0x38 : 0x48, name: 'Original load' },
    ],
  });
  const z = parseIgz(input),
    pool = z.descriptors[1],
    first = align(pool.dataSize, 8),
    rofs = [],
    rext = [],
    rnex = [];
  input = Buffer.concat([input, Buffer.alloc(first - pool.dataSize + 48)]);
  input.writeUInt32LE(first + 48, 0x2c);
  for (let i = 0; i < 2; i++) {
    const list = z.objects[i + 1],
      array = first + i * 24;
    input.writeUInt32LE(3, list.offset + 0xc);
    input.writeUInt32LE(3, list.offset + 0x10);
    input.writeUInt32LE(24, list.offset + 0x18);
    input.writeUInt32LE(0x88000000, list.offset + 0x1c);
    input.writeBigUInt64LE(BigInt(array), list.offset + 0x20);
    if (!opcode) input.writeBigUInt64LE(0x8000000000000000n, list.offset + 0x28);
    input.writeBigUInt64LE(BigInt(z.objects[i + 3].encoded), pool.offset + array);
    input.writeBigUInt64LE(0x8000000000000000n, pool.offset + array + 8);
    rofs.push(list.encoded + 0x20, array);
    (opcode && i === 1 ? rnex : rext).push(array + 8);
    if (!opcode) rnex.push(list.encoded + 0x28);
    else {
      input.writeUInt16LE(17, z.objects[i + 3].offset + 0x30);
      input.writeUInt16LE(123, z.objects[i + 3].offset + 0x32);
    }
  }
  return modifyBlocks(input, (blocks, parsed) => [
    ...blocks.map((b) => {
      const magic = b.toString('ascii', 0, 4);
      if (magic === 'ROFS') {
        const offsets = [...parsed.offsetTables.get(magic).encodedOffsets, ...rofs].sort((a, b) => a - b);
        return block(magic, offsets.length, referencePack(offsets));
      }
      if (magic === 'RSTT') {
        const offsets = [...parsed.offsetTables.get(magic).encodedOffsets].filter(
          (v) => v !== z.objects[1].encoded + 16 && v !== z.objects[2].encoded + 16,
        );
        return block(magic, offsets.length, referencePack(offsets));
      }
      return b;
    }),
    block('EXID', 1, Buffer.alloc(8)),
    block('EXNM', 1, Buffer.alloc(8)),
    block('REXT', rext.length, referencePack(rext)),
    block('RNEX', rnex.length, referencePack(rnex)),
  ]);
}
function chapterListsOptions(input, { root = false } = {}) {
  const target = inspectAppendTarget(input, sha(input)),
    z = parseIgz(input),
    type = target.types.find((t) => t.type === 'StringInfo');
  const payload = Buffer.alloc(type.size * 2);
  for (let i = 0; i < 2; i++) {
    payload.writeUInt32LE(type.typeIndex, type.size * i);
    payload.writeUInt32LE(target.stringCount + i, type.size * i + 16);
  }
  return {
    expectedSha256: sha(input),
    appendedDefaultPool: payload,
    appendedObjects: [0, type.size].map((offset) => ({ offset, type: 'StringInfo' })),
    fixupSlots: { RSTT: [16, type.size + 16] },
    newStrings: ['Synthetic new title', 'Synthetic new load'],
    objectLists: [1, 2].map((index, i) => ({
      listEncoded: z.objects[index].encoded,
      expectedType: 'ScriptSetList',
      appendObjects: [i * type.size],
    })),
    ...(root ? { rootList: { rootEncoded: 8, appendObjects: [0, type.size] } } : {}),
  };
}

test('coordinated ScriptSetList growth preserves root order, strings, old arrays and signed RNEX types', () => {
  for (const growRoot of [false, true]) {
    const input = chapterListsFixture(),
      before = Buffer.from(input),
      source = parseIgz(input),
      options = chapterListsOptions(input, { root: growRoot });
    const result = appendIgz(input, options),
      z = parseIgz(result.buffer),
      oldRoot = source.objects[0],
      newRoot = z.objects[0];
    assert.deepEqual(input, before);
    assert.deepEqual(z.strings, [...source.strings, ...options.newStrings]);
    assert.equal(result.manifest.objectLists.length, 2);
    assert.equal(z.u32(newRoot.offset + 0xc), source.u32(oldRoot.offset + 0xc) + (growRoot ? 2 : 0));
    const originalRootData = source.pointerReferencesByOffset.get(oldRoot.offset + 0x20),
      rootData = z.pointerReferencesByOffset.get(newRoot.offset + 0x20);
    for (let i = 0; i < source.u32(oldRoot.offset + 0xc); i++)
      assert.equal(z.u64(rootData.targetOffset + i * 8), source.u64(originalRootData.targetOffset + i * 8));
    for (let i = 0; i < 2; i++) {
      const original = source.objects[i + 1],
        list = z.objectsByOffset.get(z.resolvePointer(original.encoded).offset);
      assert.equal(z.u32(list.offset + 0xc), 4);
      assert.equal(z.u32(list.offset + 0x10), 4);
      assert.equal(z.u32(list.offset + 0x18), 32);
      assert.equal(z.u32(list.offset + 0x1c), 0x88000000);
      assert.equal(z.u64(list.offset + 0x28), 0x8000000000000000n);
      const old = source.pointerReferencesByOffset.get(original.offset + 0x20),
        next = z.pointerReferencesByOffset.get(list.offset + 0x20);
      assert.deepEqual(
        z.buffer.subarray(next.targetOffset, next.targetOffset + 24),
        source.buffer.subarray(old.targetOffset, old.targetOffset + 24),
      );
      assert.deepEqual(
        z.buffer.subarray(z.resolvePointer(old.encoded).offset, z.resolvePointer(old.encoded).offset + 24),
        source.buffer.subarray(old.targetOffset, old.targetOffset + 24),
      );
      assert.equal(z.u64(next.targetOffset + 24), BigInt(result.manifest.appended.encodedStart + i * 0x48));
      assert.equal(z.pointerReferencesByOffset.has(z.resolvePointer(old.encoded).offset), false);
      assert.equal(
        z.offsetTables.get('REXT').offsets.includes(z.resolvePointer(old.encoded).offset + 8),
        false,
      );
      assert.equal(result.manifest.objectLists[i].originalEntryOrderPreserved, true);
      assert.deepEqual(result.manifest.objectLists[i].movedRelocations, { ROFS: 1, REXT: 1 });
    }
    assert.equal(z.fixupMap.get('REXT').count, 2, 'Signed external entries are moved, not duplicated');
    assert.deepEqual(
      [...z.offsetTables.get('RNEX').encodedOffsets],
      [...source.offsetTables.get('RNEX').encodedOffsets],
    );
    if (!growRoot) assert.equal(result.manifest.rootList, null);
  }
});

test('typed-list extension rejects duplicates, wrong layouts, existing and newly authored aliases/interiors', () => {
  const base = chapterListsFixture();
  for (const mutate of [
    (o) => {
      o.objectLists.push(o.objectLists[0]);
    },
    (o) => {
      o.objectLists[0].expectedType = 'igObjectList';
    },
    (o) => {
      o.objectLists[0].listEncoded = 8;
    },
    (o) => {
      o.objectLists[0].appendObjects = [8];
    },
    (o) => {
      o.objectLists[0].appendObjects = [0, 0];
    },
    (o) => {
      o.objectLists = Array(33).fill(o.objectLists[0]);
    },
  ]) {
    const options = chapterListsOptions(base);
    mutate(options);
    assert.throws(() => appendIgz(base, options));
  }
  for (const interior of [0, 8]) {
    let input = Buffer.from(base);
    let z = parseIgz(input);
    const old = z.pointerReferencesByOffset.get(z.objects[1].offset + 32);
    input.writeBigUInt64LE(BigInt(old.encoded + interior), z.objects[2].offset + 32);
    assert.throws(() => appendIgz(input, chapterListsOptions(input)), /shared\/aliased/);
    const options = chapterListsOptions(base);
    options.appendedDefaultPool.writeBigUInt64LE(BigInt(old.encoded + interior), 0x38);
    options.fixupSlots.ROFS = [0x38];
    assert.throws(() => appendIgz(base, options), /aliases the old ScriptSetList/);
  }
  const typedOverlap = Buffer.from(base),
    z = parseIgz(typedOverlap);
  typedOverlap.writeBigUInt64LE(BigInt(z.objects[3].encoded + 8), z.objects[1].offset + 32);
  assert.throws(() => appendIgz(typedOverlap, chapterListsOptions(typedOverlap)), /overlaps a typed object/);
});

test('typed-list changed fields cannot hide relocations and memory handles cannot alias the old arrays', () => {
  const source = chapterListsFixture();
  const badHeader = modifyBlocks(source, (blocks, z) =>
    blocks.map((b) => {
      if (b.toString('ascii', 0, 4) !== 'RSTT') return b;
      const values = [...z.offsetTables.get('RSTT').encodedOffsets, z.objects[1].encoded + 0x14].sort(
        (a, b) => a - b,
      );
      return block('RSTT', values.length, referencePack(values));
    }),
  );
  assert.throws(
    () => appendIgz(badHeader, chapterListsOptions(badHeader)),
    /header has a conflicting relocation/,
  );
  const memoryAlias = modifyBlocks(source, (blocks, z) => {
    const array = z.pointerReferencesByOffset.get(z.objects[1].offset + 32),
      entry = Buffer.alloc(16);
    entry.writeUInt32LE(16);
    entry.writeUInt32LE(array.encoded + 8, 8);
    return [...blocks, block('TMHN', 1, entry)];
  });
  assert.throws(() => appendIgz(memoryAlias, chapterListsOptions(memoryAlias)), /aliased by a TMHN/);
});

test('list range aliases beginning before a moved array are rejected even when the other list is not selected', () => {
  const base = chapterListsFixture(),
    z = parseIgz(base),
    first = z.objects[2],
    other = z.objects[1];
  const old = z.pointerReferencesByOffset.get(first.offset + 0x20);
  for (const selected of ['first', 'both', 'both-reversed']) {
    const input = Buffer.from(base);
    input.writeBigUInt64LE(BigInt(old.encoded - 8), other.offset + 0x20);
    input.writeUInt32LE(4, other.offset + 0xc);
    input.writeUInt32LE(4, other.offset + 0x10);
    input.writeUInt32LE(32, other.offset + 0x18);
    const options = chapterListsOptions(input);
    if (selected === 'first') options.objectLists = options.objectLists.slice(1, 2);
    if (selected === 'both-reversed') options.objectLists.reverse();
    assert.throws(() => appendIgz(input, options), /overlaps another known list backing span/);
  }
  const disjoint = chapterListsOptions(base);
  disjoint.objectLists = disjoint.objectLists.slice(0, 1);
  assert.doesNotThrow(() => appendIgz(base, disjoint));
});

test('unselected known-list ranges must have validated headers and bounded ordinary data pointers', () => {
  const base = chapterListsFixture(),
    z = parseIgz(base),
    other = z.objects[2];
  for (const [field, value] of [
    [0xc, 4],
    [0x18, 23],
    [0x10, 1_000_001],
    [0x20, z.descriptors[1].dataSize - 8],
  ]) {
    const input = Buffer.from(base);
    input.writeUInt32LE(value, other.offset + field);
    const options = chapterListsOptions(input);
    options.objectLists = options.objectLists.slice(0, 1);
    assert.throws(() => appendIgz(input, options), /Known list backing span|outside section/);
  }
});

test('typed-list plans retain exclusive file-output behavior', (t) => {
  const dir = withTemp(t),
    source = path.join(dir, 'source.igz'),
    output = path.join(dir, 'extended.igz'),
    input = chapterListsFixture();
  fs.writeFileSync(source, input);
  const options = chapterListsOptions(input, { root: true });
  const result = writeIgzAppend({ source, output, ...options });
  assert.equal(JSON.parse(fs.readFileSync(result.manifest)).objectLists.length, 2);
  assert.throws(() => writeIgzAppend({ source, output, ...options }), /EEXIST/);
  assert.deepEqual(fs.readFileSync(source), input);
});

test('EXID additions preserve old bytes/indices and header extensions while new retained slots use the enlarged table', () => {
  const input = modifyBlocks(chapterListsFixture(), (blocks) =>
    blocks.map((b) =>
      b.toString('ascii', 0, 4) === 'EXID'
        ? block('EXID', 1, b.subarray(16), Buffer.from('12345678', 'hex'))
        : b,
    ),
  );
  const original = Buffer.from(input),
    z = parseIgz(input),
    options = chapterListsOptions(input);
  options.objectLists = [];
  options.newExternalIds = [
    { nameId: 0xffffffff, namespaceHash: 0xffffffff },
    { nameId: 123, namespaceHash: 0 },
  ];
  options.appendedDefaultPool.writeBigUInt64LE(0x8000000000000001n, 0x28);
  options.appendedDefaultPool.writeBigUInt64LE(2n, 0x30);
  options.appendedDefaultPool.writeBigUInt64LE(0x8000000000000000n, 0x38);
  options.fixupSlots.REXT = [0x28, 0x30];
  options.fixupSlots.RNEX = [0x38];
  assert.equal(inspectAppendTarget(input, sha(input)).externalIdCount, 1);
  const result = appendIgz(input, options),
    out = parseIgz(result.buffer),
    before = z.fixupMap.get('EXID'),
    after = out.fixupMap.get('EXID');
  assert.equal(after.count, 3);
  assert.equal(after.startOfData, before.startOfData);
  assert.deepEqual(
    input.subarray(before.dataOffset, before.end),
    result.buffer.subarray(after.dataOffset, after.dataOffset + 8),
  );
  assert.deepEqual(
    result.manifest.appended.externalIds,
    options.newExternalIds.map((pair, i) => ({ index: i + 1, ...pair })),
  );
  assert.equal(out.u32(after.dataOffset + 8), 0xffffffff);
  assert.equal(out.u32(after.dataOffset + 12), 0xffffffff);
  const added = out.objects.find((o) => o.encoded === result.manifest.appended.encodedStart);
  for (const [field, raw, kind] of [
    [0x28, 0x8000000000000001n, 'REXT'],
    [0x30, 2n, 'REXT'],
    [0x38, 0x8000000000000000n, 'RNEX'],
  ]) {
    assert.equal(out.u64(added.offset + field), raw);
    assert.ok(out.offsetTables.get(kind).offsets.includes(added.offset + field));
  }
  assert.deepEqual(input, original);
});

test('EXID extension rejects duplicate, malformed, excessive, or absent-table requests and bounds new indices', () => {
  const input = chapterListsFixture();
  for (const pairs of [
    [{ nameId: 0, namespaceHash: 0 }],
    [
      { nameId: 1, namespaceHash: 2 },
      { nameId: 1, namespaceHash: 2 },
    ],
    [{ nameId: -1, namespaceHash: 1 }],
    [{ nameId: 0x100000000, namespaceHash: 1 }],
    [{ nameId: 1.5, namespaceHash: 2 }],
    [{ nameId: '1', namespaceHash: 2 }],
    [{ nameId: 1 }],
    [{ nameId: 1, namespaceHash: null }],
    [{ nameId: 1, namespaceHash: 2, extra: true }],
    [null],
    Array(10001).fill({ nameId: 1, namespaceHash: 2 }),
    {},
  ]) {
    const options = chapterListsOptions(input);
    options.newExternalIds = pairs;
    assert.throws(() => appendIgz(input, options));
  }
  const absent = makeIgz();
  assert.throws(
    () => appendIgz(absent, optionsFor(absent, { newExternalIds: [{ nameId: 1, namespaceHash: 2 }] })),
    /EXID fixup block/,
  );
  for (const [kind, index] of [
    ['REXT', 2],
    ['RNEX', 1],
  ]) {
    const options = chapterListsOptions(input);
    options.newExternalIds = [{ nameId: 1, namespaceHash: 2 }];
    options.appendedDefaultPool.writeBigUInt64LE(0x8000000000000000n | BigInt(index), 0x28);
    options.fixupSlots[kind] = [0x28];
    assert.throws(() => appendIgz(input, options), /index exceeds/);
  }
});

test('authored REXT/RNEX permit only the sign-retain bit; other relocation high words remain zero-only', () => {
  const input = chapterListsFixture();
  for (const kind of ['REXT', 'RNEX'])
    for (const high of [1, 0x40000000, 0x80000001, 0xffffffff]) {
      const options = chapterListsOptions(input);
      options.fixupSlots[kind] = [0x28];
      options.appendedDefaultPool.writeUInt32LE(high, 0x2c);
      assert.throws(() => appendIgz(input, options), /optional sign-retain high bit/);
    }
  for (const kind of ['ROFS', 'RSTT']) {
    const options = chapterListsOptions(input);
    options.fixupSlots[kind] = [...(options.fixupSlots[kind] ?? []), 0x28];
    options.appendedDefaultPool.writeBigUInt64LE(0x8000000000000000n, 0x28);
    assert.throws(() => appendIgz(input, options), /zero high word/);
  }
});

function opcodeOptions(input, insertAt) {
  const z = parseIgz(input),
    typeIndex = z.types.indexOf('OpPreScript'),
    size = z.typeSizes[typeIndex],
    payload = Buffer.alloc(size * 2);
  payload.writeUInt32LE(typeIndex);
  payload.writeUInt32LE(typeIndex, size);
  return {
    expectedSha256: sha(input),
    appendedDefaultPool: payload,
    appendedObjects: [0, size].map((offset) => ({ offset, type: 'OpPreScript' })),
    objectLists: z.objects
      .filter((o) => o.type === 'OpCodeList')
      .map((o) => ({
        listEncoded: o.encoded,
        expectedType: 'OpCodeList',
        appendObjects: [size, 0],
        ...(insertAt === undefined ? {} : { insertAt }),
      })),
  };
}

test('OpCodeList insertion preserves relative old order, signed relocation ownership and all old opcode bytes', () => {
  const input = chapterListsFixture({ opcode: true }),
    z = parseIgz(input);
  for (const insertAt of [0, 1, 3, undefined]) {
    const options = opcodeOptions(input, insertAt),
      result = appendIgz(input, options),
      out = parseIgz(result.buffer),
      at = insertAt ?? 3;
    for (const [i, list] of z.objects.filter((o) => o.type === 'OpCodeList').entries()) {
      const oldArray = z.pointerReferencesByOffset.get(list.offset + 0x20),
        next = out.objectsByOffset.get(out.resolvePointer(list.encoded).offset);
      const array = out.pointerReferencesByOffset.get(next.offset + 0x20);
      const oldValues = Array.from({ length: 3 }, (_, n) => z.u64(oldArray.targetOffset + n * 8));
      const added = options.objectLists[i].appendObjects.map((offset) =>
        BigInt(result.manifest.appended.encodedStart + offset),
      );
      assert.deepEqual(
        Array.from({ length: 5 }, (_, n) => out.u64(array.targetOffset + n * 8)),
        [...oldValues.slice(0, at), ...added, ...oldValues.slice(at)],
      );
      assert.equal(out.pointerReferencesByOffset.has(out.resolvePointer(oldArray.encoded).offset), false);
      const externalKind = i === 0 ? 'REXT' : 'RNEX',
        externalRow = 1 + (at <= 1 ? 2 : 0);
      assert.ok(out.offsetTables.get(externalKind).offsets.includes(array.targetOffset + externalRow * 8));
      assert.equal(
        out.offsetTables.get(externalKind).offsets.includes(out.resolvePointer(oldArray.encoded).offset + 8),
        false,
      );
      assert.equal(out.fixupMap.get(externalKind).count, z.fixupMap.get(externalKind).count);
      assert.equal(result.manifest.objectLists[i].insertAt, at);
      assert.equal(result.manifest.objectLists[i].originalEntryIndicesPreserved, at === 3);
    }
    for (const op of z.objects.filter((o) => o.type === 'OpPreScript')) {
      const after = out.objectsByOffset.get(out.resolvePointer(op.encoded).offset);
      assert.deepEqual(
        input.subarray(op.offset, op.offset + op.size),
        result.buffer.subarray(after.offset, after.offset + after.size),
      );
      assert.equal(
        result.buffer.readUInt16LE(after.offset + 0x32),
        123,
        'generic insertion must not patch branch deltas',
      );
    }
  }
});

test('insertAt is bounded for typed lists only, ROOT stays append-only and OpCodeList aliases are rejected', () => {
  const input = chapterListsFixture({ opcode: true }),
    z = parseIgz(input);
  for (const at of [-1, 4, 1.5, NaN, null, '1'])
    assert.throws(() => appendIgz(input, opcodeOptions(input, at)), /insertAt/);
  const root = opcodeOptions(input, 1);
  root.rootList = { rootEncoded: 8, appendObjects: [0], insertAt: 0 };
  assert.throws(() => appendIgz(input, root), /unsupported fields/);
  const alias = Buffer.from(input),
    first = z.objects[1],
    second = z.objects[2],
    array = z.pointerReferencesByOffset.get(second.offset + 0x20);
  alias.writeBigUInt64LE(BigInt(array.encoded - 8), first.offset + 0x20);
  for (const field of [0xc, 0x10]) alias.writeUInt32LE(4, first.offset + field);
  alias.writeUInt32LE(32, first.offset + 0x18);
  const options = opcodeOptions(alias, 1);
  options.objectLists = options.objectLists.slice(1);
  assert.throws(() => appendIgz(alias, options), /overlaps another known list backing span/);
  const typed = chapterListsFixture(),
    selected = chapterListsOptions(typed);
  selected.objectLists[0].insertAt = 1;
  assert.equal(appendIgz(typed, selected).manifest.objectLists[0].insertAt, 1);
});

test('CLI carries EXID additions and typed-list insertion through an exclusive output manifest', (t) => {
  const dir = withTemp(t),
    source = path.join(dir, 'opcodes.igz'),
    output = path.join(dir, 'inserted.igz');
  const appendFile = path.join(dir, 'payload.bin'),
    requestFile = path.join(dir, 'request.json'),
    input = chapterListsFixture({ opcode: true });
  const { appendedDefaultPool, ...options } = opcodeOptions(input, 1);
  const request = {
    source,
    output,
    appendFile,
    ...options,
    newExternalIds: [{ nameId: 123, namespaceHash: 456 }],
  };
  fs.writeFileSync(source, input);
  fs.writeFileSync(appendFile, appendedDefaultPool);
  fs.writeFileSync(requestFile, JSON.stringify(request));
  const run = () =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../tools/igz_append.mjs', import.meta.url)), requestFile],
      { encoding: 'utf8' },
    );
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const manifest = JSON.parse(fs.readFileSync(output + '.manifest.json'));
  assert.deepEqual(manifest.appended.externalIds, [{ index: 1, nameId: 123, namespaceHash: 456 }]);
  assert.deepEqual(
    manifest.objectLists.map((l) => l.insertAt),
    [1, 1],
  );
  assert.equal(run().status, 1);
  assert.deepEqual(fs.readFileSync(source), input);
});

test('v8 codec matches independent vectors, delta boundaries and large pooled addresses', () => {
  for (const values of [
    [],
    [4],
    [8, 12, 48, 64],
    [4, 36, 292, 2340],
    [8, 0x04000008, 0x08000008, 0xf0000008, 0xfffffffc],
  ]) {
    assert.deepEqual(encodeV8Offsets(values), referencePack(values));
    assert.deepEqual(referenceUnpack(encodeV8Offsets(values), values.length), values);
  }
  const values = [];
  let position = 0;
  for (let i = 0; i < 10000; i++) {
    position += 4 * (((i * 137) % 8192) + 1);
    values.push(position);
  }
  assert.deepEqual(referenceUnpack(encodeV8Offsets(new Uint32Array(values)), values.length), values);
  for (const bad of [[0], [5], [8, 8], [8, 4], [-4], [0x100000000], [NaN]])
    assert.throws(() => encodeV8Offsets(bad));
});

test('append-only typed object retains source bytes, root, special ROFS and TMHN semantics', () => {
  const input = makeIgz({ specialRelocation: true, tmhnReference: true, sentinelPool: true }),
    before = Buffer.from(input);
  const options = optionsFor(input),
    target = inspectAppendTarget(input, options.expectedSha256);
  options.appendedDefaultPool.writeUInt32LE(8, 0x20);
  options.fixupSlots.ROFS = [0x20];
  options.fixupSlots.RMHN = [0x28];
  const { buffer, manifest } = appendIgz(input, options),
    source = parseIgz(input),
    result = parseIgz(buffer);
  assert.deepEqual(input, before);
  assert.equal(result.objects.length, 4);
  assert.equal(manifest.rootList, null);
  assert.equal(manifest.originalObjectIndicesShifted, 0);
  assert.deepEqual(
    buffer.subarray(
      result.descriptors[1].offset,
      result.descriptors[1].offset + source.descriptors[1].dataSize,
    ),
    input.subarray(
      source.descriptors[1].offset,
      source.descriptors[1].offset + source.descriptors[1].dataSize,
    ),
  );
  assert.equal(result.objects[3].encoded, target.appendOffset);
  assert.equal(result.stringReferencesByOffset.get(result.objects[3].offset + 16).value, 'Beta');
  assert.equal(result.pointerReferencesByOffset.get(result.objects[3].offset + 0x20).targetObjectIndex, 0);
  assert.equal(result.specialRelocations.length, 1);
  assert.equal(result.tmhnReferences.length, 2);
  assert.equal(result.descriptors[2].sentinel, true);
  assert.equal(manifest.output.sha256, sha(buffer));
  assert.ok(manifest.limitations.some((s) => s.includes('no runtime compatibility')));
});

test('relocated ROOT list preserves old array and flags, shifts later pools, keeps encoded identities', () => {
  const input = multiPoolFixture(),
    source = parseIgz(input),
    originalRoot = source.objects[0];
  input.writeUInt32LE(0x88000000, originalRoot.offset + 0x1c);
  const options = optionsFor(input, { rootList: { rootEncoded: 8, appendObjects: [0] } });
  options.appendedDefaultPool.writeUInt32LE(0x08000008, 0x20);
  options.fixupSlots.ROFS = [0x20];
  const { buffer, manifest } = appendIgz(input, options),
    z = parseIgz(buffer),
    root = z.objects[0];
  assert.equal(z.objects.length, 5);
  assert.equal(manifest.originalObjectIndicesShifted, 1);
  assert.equal(z.objects[4].encoded, 0x08000008);
  assert.equal(z.objects[4].type, 'igObjectList');
  assert.equal(z.u32(root.offset + 0xc), 3);
  assert.equal(z.u32(root.offset + 0x10), 3);
  assert.equal(z.u32(root.offset + 0x18), 24);
  assert.equal(z.u32(root.offset + 0x1c), 0x88000000);
  const array = z.pointerReferencesByOffset.get(root.offset + 0x20),
    expected = [source.objects[1].encoded, source.objects[2].encoded, z.objects[3].encoded];
  assert.deepEqual(
    expected.map((_, i) => Number(z.u64(array.targetOffset + i * 8))),
    expected,
  );
  assert.deepEqual(
    buffer.subarray(z.descriptors[1].offset + 48, z.descriptors[1].offset + 64),
    input.subarray(source.descriptors[1].offset + 48, source.descriptors[1].offset + 64),
  );
  assert.equal(z.pointerReferencesByOffset.get(z.objects[3].offset + 0x20).targetObjectIndex, 4);
  assert.deepEqual(buffer.subarray(z.descriptors[2].offset), input.subarray(source.descriptors[2].offset));
  const rvtb = z.fixupMap.get('RVTB');
  assert.equal(rvtb.startOfData, 20);
  assert.equal(buffer.subarray(rvtb.offset + 16, rvtb.dataOffset).toString('hex'), '12345678');
  assert.equal(manifest.rootList.previousArrayPreserved, true);
});

test('several explicit objects can be registered in chosen root order', () => {
  const input = makeIgz(),
    options = optionsFor(input);
  options.appendedDefaultPool = Buffer.concat([options.appendedDefaultPool, options.appendedDefaultPool]);
  options.appendedObjects.push({ offset: 0x170, type: 'tfbActorInfo' });
  options.fixupSlots.RSTT.push(0x180);
  options.rootList = { rootEncoded: 8, appendObjects: [0x170, 0] };
  const { buffer, manifest } = appendIgz(input, options),
    z = parseIgz(buffer);
  assert.equal(z.objects.length, 5);
  assert.equal(manifest.rootList.count, 4);
  assert.deepEqual(manifest.rootList.addedEncodedObjects, [z.objects[4].encoded, z.objects[3].encoded]);
});

test('new unique TSTR names append without renaming or renumbering original strings', () => {
  for (const newStrings of [
    ['NewActor_01'],
    ['A', 'BB', 'CCC', 'DDDD'],
    ['Name with spaces'],
    ['X'.repeat(255)],
  ]) {
    const input = makeIgz(),
      options = optionsFor(input, { newStrings });
    const count = inspectAppendTarget(input, options.expectedSha256).stringCount;
    options.appendedDefaultPool.writeUInt32LE(count + newStrings.length - 1, 16);
    const { buffer, manifest } = appendIgz(input, options),
      z = parseIgz(buffer);
    assert.deepEqual(z.strings, ['Alpha', 'Beta', ...newStrings]);
    assert.equal(z.stringReferencesByOffset.get(z.objects[3].offset + 16).value, newStrings.at(-1));
    assert.deepEqual(
      manifest.appended.strings,
      newStrings.map((value, i) => ({ value, index: count + i })),
    );
    assert.equal(z.stringReferencesByOffset.get(z.objects[1].offset + 16).value, 'Alpha');
  }
  const input = makeIgz();
  for (const newStrings of [
    ['Alpha'],
    ['New', 'New'],
    [''],
    ['nul\0byte'],
    ['new\nline'],
    ['ümlaut'],
    ['x'.repeat(256)],
    [42],
    'bad',
  ])
    assert.throws(() => appendIgz(input, optionsFor(input, { newStrings })), /strings|Strings/);
});

function externalRootFixture(kind = 'REXT', raw = 0x8000000000000000n) {
  const input = makeIgz(),
    z = parseIgz(input);
  input.writeBigUInt64LE(raw, z.descriptors[1].offset + 56);
  return modifyBlocks(input, (blocks, parsed) => [
    ...blocks.map((b) =>
      b.toString('ascii', 0, 4) === 'ROFS'
        ? block(
            'ROFS',
            2,
            referencePack([...parsed.offsetTables.get('ROFS').encodedOffsets].filter((v) => v !== 56)),
          )
        : b,
    ),
    block(kind === 'RNEX' ? 'EXNM' : 'EXID', 1, Buffer.alloc(8)),
    block(kind, 1, referencePack([56])),
  ]);
}

test('ROOT external signed references move their fixups instead of duplicating runtime retains', () => {
  for (const kind of ['REXT', 'RNEX']) {
    const input = externalRootFixture(kind),
      options = optionsFor(input, { rootList: { rootEncoded: 8, appendObjects: [0] } });
    const { buffer, manifest } = appendIgz(input, options),
      z = parseIgz(buffer),
      pool = z.descriptors[1];
    const arrayOffset = manifest.rootList.arrayEncoded;
    assert.equal(z.u64(pool.offset + arrayOffset + 8), 0x8000000000000000n);
    assert.equal(z.u64(pool.offset + 56), 0x8000000000000000n);
    assert.deepEqual([...z.offsetTables.get(kind).encodedOffsets], [arrayOffset + 8]);
    assert.equal(z.pointerReferencesByOffset.has(pool.offset + 48), false);
    assert.equal(z.pointerReferencesByOffset.get(pool.offset + arrayOffset).targetObjectIndex, 1);
    assert.deepEqual(manifest.rootList.movedRelocations, { ROFS: 1, [kind]: 1 });
    const change = manifest.fixups.find((f) => f.kind === kind);
    assert.equal(change.count, 1);
    assert.equal(change.addedCount, 1);
    assert.equal(change.removedCount, 1);
  }
  const input = externalRootFixture('REXT', 0x8000000000000001n);
  assert.throws(
    () => appendIgz(input, optionsFor(input, { rootList: { rootEncoded: 8, appendObjects: [0] } })),
    /external index exceeds/,
  );
});

test('moving a ROOT array refuses pre-existing and newly authored aliases', () => {
  let input = makeIgz(),
    z = parseIgz(input),
    actor = z.objects[1];
  input.writeUInt32LE(48, actor.offset + 0x20);
  input = modifyBlocks(input, (blocks, parsed) =>
    blocks.map((b) => {
      if (b.toString('ascii', 0, 4) !== 'ROFS') return b;
      const values = [...parsed.offsetTables.get('ROFS').encodedOffsets, actor.encoded + 0x20].sort(
        (a, b) => a - b,
      );
      return block('ROFS', values.length, referencePack(values));
    }),
  );
  assert.throws(
    () => appendIgz(input, optionsFor(input, { rootList: { rootEncoded: 8, appendObjects: [0] } })),
    /shared\/aliased/,
  );
  input = makeIgz();
  const options = optionsFor(input, { rootList: { rootEncoded: 8, appendObjects: [0] } });
  options.appendedDefaultPool.writeUInt32LE(48, 0x20);
  options.fixupSlots.ROFS = [0x20];
  assert.throws(() => appendIgz(input, options), /aliases the old ROOT/);
});

test('all supported index fixup additions validate the existing preserved tables', () => {
  const input = modifyBlocks(makeIgz({ tmhnReference: true }), (blocks) => [
    ...blocks,
    block('EXID', 1, Buffer.alloc(8), Buffer.from('01000000', 'hex')),
    block('EXNM', 1, Buffer.alloc(8)),
    ...['RPID', 'REXT', 'RHND', 'RNEX'].map((kind) => block(kind, 0, Buffer.alloc(0))),
  ]);
  const options = optionsFor(input);
  Object.assign(options.fixupSlots, { RPID: [0x20], REXT: [0x28], RHND: [0x30], RNEX: [0x38], RMHN: [0x70] });
  const result = appendIgz(input, options),
    z = parseIgz(result.buffer);
  for (const kind of ['RPID', 'REXT', 'RHND', 'RNEX']) assert.equal(z.fixupMap.get(kind).count, 1);
  for (const [kind, [slot]] of Object.entries(options.fixupSlots)) {
    const bad = { ...options, appendedDefaultPool: Buffer.from(options.appendedDefaultPool) };
    bad.appendedDefaultPool.writeUInt32LE(0xffffffff, slot);
    assert.throws(() => appendIgz(input, bad), new RegExp(`${kind} index`));
  }
});

test('source SHA and unknown or unresolved source fixups fail closed', () => {
  const input = makeIgz();
  assert.throws(
    () => appendIgz(input, { ...optionsFor(input), expectedSha256: '0'.repeat(64) }),
    /SHA-256 mismatch/,
  );
  assert.throws(() => inspectAppendTarget(input), /expectedSha256/);
  const unknown = Buffer.from(input),
    root = parseIgz(unknown).fixupMap.get('ROOT');
  unknown.write('ZZZZ', root.offset);
  assert.throws(() => appendIgz(unknown, optionsForUnsafe(unknown)), /Unknown fixup/);
  const unresolved = makeIgz({ unresolvedRofs: true });
  assert.throws(() => appendIgz(unresolved, optionsForUnsafe(unresolved)), /Unresolved fixups/);
  function optionsForUnsafe(source) {
    return { ...optionsFor(input), expectedSha256: sha(source) };
  }
});

test('oversized declarations and truncated fixup headers fail before parser allocation', () => {
  const original = makeIgz(),
    options = optionsFor(original),
    f = parseIgz(original).fixupMap.get('RVTB');
  for (const [field, value, expected] of [
    [f.offset + 4, 2_000_001, /Excessive source fixup count/],
    [f.offset + 8, 0xffffffff, /Invalid source fixup length/],
    [0x1c, 0xffffffff, /Invalid source fixup span/],
  ]) {
    const input = Buffer.from(original);
    input.writeUInt32LE(value, field);
    assert.throws(() => appendIgz(input, { ...options, expectedSha256: sha(input) }), expected);
  }
  const input = Buffer.alloc(12);
  assert.throws(
    () => appendIgz(input, { ...options, expectedSha256: sha(input) }),
    /Truncated source header/,
  );
});

test('bad appended object and relocation plans are rejected without mutating input', () => {
  const input = makeIgz(),
    before = Buffer.from(input);
  const cases = [
    [
      (o) => {
        o.unknown = true;
      },
      /unsupported fields/,
    ],
    [
      (o) => {
        o.appendedDefaultPool = Buffer.alloc(0);
      },
      /1 byte/,
    ],
    [
      (o) => {
        o.appendedObjects = [];
      },
      /1–10000/,
    ],
    [
      (o) => {
        o.appendedObjects[0].type = 'NoSuchType';
      },
      /uniquely exist/,
    ],
    [
      (o) => {
        o.appendedObjects[0].offset = 4;
      },
      /eight-byte/,
    ],
    [
      (o) => {
        o.appendedObjects[0].offset = 8;
      },
      /exceeds/,
    ],
    [
      (o) => {
        o.appendedDefaultPool.writeUInt32LE(0);
      },
      /type word/,
    ],
    [
      (o) => {
        o.appendedObjects.push({ offset: 0, type: 'tfbActorInfo' });
      },
      /unique/,
    ],
    [
      (o) => {
        o.appendedObjects.push({ offset: 8, type: 'igObjectList' });
      },
      /spans overlap/,
    ],
    [
      (o) => {
        o.fixupSlots.RSTT = [0];
      },
      /overlap/,
    ],
    [
      (o) => {
        o.fixupSlots.RSTT = [16, 16];
      },
      /overlap/,
    ],
    [
      (o) => {
        o.fixupSlots.RSTT = [16, 20];
      },
      /overlap/,
    ],
    [
      (o) => {
        o.fixupSlots.RSTT = [17];
      },
      /four-byte/,
    ],
    [
      (o) => {
        o.fixupSlots.RSTT = [0x16c];
      },
      /Invalid RSTT slot/,
    ],
    [
      (o) => {
        o.fixupSlots.RMHN = [32];
      },
      /source must already contain/,
    ],
    [
      (o) => {
        o.fixupSlots.ROFS = [32];
        o.appendedDefaultPool.writeUInt32LE(0x08000000, 32);
      },
      /missing section/,
    ],
    [
      (o) => {
        o.appendedDefaultPool.writeUInt32LE(1, 20);
      },
      /zero high word/,
    ],
    [
      (o) => {
        o.rootList = { rootEncoded: 16, appendObjects: [0] };
      },
      /not a declared ROOT/,
    ],
    [
      (o) => {
        o.rootList = { rootEncoded: 8, appendObjects: [8] };
      },
      /uniquely name/,
    ],
    [
      (o) => {
        o.rootList = { rootEncoded: 8, appendObjects: [0, 0] };
      },
      /uniquely name/,
    ],
  ];
  for (const [change, expected] of cases) {
    const options = optionsFor(input);
    change(options);
    assert.throws(() => appendIgz(input, options), expected);
  }
  assert.deepEqual(input, before);
});

test('invalid root metadata and empty/no-relocation root are rejected conservatively', () => {
  for (const field of [0xc, 0x10, 0x18]) {
    const input = makeIgz(),
      z = parseIgz(input),
      root = z.objects[0];
    input.writeUInt32LE(field === 0xc ? 3 : 0, root.offset + field);
    assert.throws(
      () => appendIgz(input, optionsFor(input, { rootList: { rootEncoded: 8, appendObjects: [0] } })),
      /count\/capacity\/span/,
    );
  }
  const input = makeIgz({ objects: [] }),
    payload = Buffer.alloc(0x28);
  assert.throws(
    () =>
      appendIgz(input, {
        expectedSha256: sha(input),
        appendedDefaultPool: payload,
        appendedObjects: [{ offset: 0, type: 'igObjectList' }],
        rootList: { rootEncoded: 8, appendObjects: [0] },
      }),
    /ordinary ROFS data pointer/,
  );
});

test('file wrapper produces an exclusive output and manifest, preserving source', (t) => {
  const dir = withTemp(t),
    source = path.join(dir, 'source.igz'),
    output = path.join(dir, 'result.igz'),
    input = makeIgz();
  fs.writeFileSync(source, input);
  const before = fs.statSync(source),
    options = optionsFor(input, { rootList: { rootEncoded: 8, appendObjects: [0] } });
  const result = writeIgzAppend({ source, output, ...options }),
    manifest = JSON.parse(fs.readFileSync(result.manifest));
  assert.equal(result.runtimeValidated, false);
  assert.equal(result.objectCount, 4);
  assert.equal(sha(fs.readFileSync(output)), result.sha256);
  assert.equal(manifest.source.path, source);
  assert.equal(manifest.output.sha256, result.sha256);
  assert.equal(sha(fs.readFileSync(source)), sha(input));
  assert.equal(fs.statSync(source).mtimeMs, before.mtimeMs);
  assert.throws(() => writeIgzAppend({ source, output, ...options }), /EEXIST/);
  assert.equal(sha(fs.readFileSync(output)), result.sha256);
});

test('failed file creation never overwrites symlinks, existing outputs or manifests', (t) => {
  const dir = withTemp(t),
    source = path.join(dir, 'source.igz'),
    input = makeIgz(),
    options = optionsFor(input);
  fs.writeFileSync(source, input);
  for (const variant of ['same-source', 'hardlink', 'symlink', 'dangling', 'manifest']) {
    const output = variant === 'same-source' ? source : path.join(dir, variant + '.igz');
    if (variant === 'hardlink') fs.linkSync(source, output);
    if (variant === 'symlink') fs.symlinkSync(source, output);
    if (variant === 'dangling') fs.symlinkSync(path.join(dir, 'missing'), output);
    if (variant === 'manifest') fs.writeFileSync(output + '.manifest.json', 'keep this');
    assert.throws(() => writeIgzAppend({ source, output, ...options }), /differ|EEXIST/);
    assert.equal(sha(fs.readFileSync(source)), sha(input));
    if (variant === 'manifest') {
      assert.equal(fs.existsSync(output), false);
      assert.equal(fs.readFileSync(output + '.manifest.json', 'utf8'), 'keep this');
    } else assert.ok(fs.lstatSync(output));
  }
  const output = path.join(dir, 'invalid.igz');
  assert.throws(
    () => writeIgzAppend({ source, output, ...options, expectedSha256: 'f'.repeat(64) }),
    /SHA-256 mismatch/,
  );
  assert.equal(fs.existsSync(output), false);
  assert.equal(fs.existsSync(output + '.manifest.json'), false);
});

test('partial output or manifest write failure cleans up only the newly created files', (t) => {
  const dir = withTemp(t),
    source = path.join(dir, 'source.igz'),
    input = makeIgz(),
    options = optionsFor(input);
  fs.writeFileSync(source, input);
  for (const failAt of [1, 2]) {
    const output = path.join(dir, `partial-${failAt}.igz`),
      originalWrite = fs.writeFileSync;
    let calls = 0;
    const mock = t.mock.method(fs, 'writeFileSync', (fd, data, ...args) => {
      if (++calls === failAt) {
        fs.writeSync(fd, Buffer.from(data).subarray(0, 8));
        throw new Error('injected write failure');
      }
      return originalWrite(fd, data, ...args);
    });
    try {
      assert.throws(() => writeIgzAppend({ source, output, ...options }), /injected write failure/);
    } finally {
      mock.mock.restore();
    }
    assert.equal(fs.existsSync(output), false);
    assert.equal(fs.existsSync(output + '.manifest.json'), false);
    assert.equal(sha(fs.readFileSync(source)), sha(input));
  }
});

test('CLI reads an explicit payload, writes new files, and refuses repeat overwrite', (t) => {
  const dir = withTemp(t),
    input = makeIgz(),
    options = optionsFor(input);
  const source = path.join(dir, 'source.igz'),
    output = path.join(dir, 'output.igz'),
    appendFile = path.join(dir, 'append.bin'),
    requestFile = path.join(dir, 'request.json');
  fs.writeFileSync(source, input);
  fs.writeFileSync(appendFile, options.appendedDefaultPool);
  const { appendedDefaultPool, ...request } = options;
  fs.writeFileSync(requestFile, JSON.stringify({ source, output, appendFile, ...request }));
  const executable = fileURLToPath(new URL('../tools/igz_append.mjs', import.meta.url));
  const run = () =>
    spawnSync(process.execPath, [executable, requestFile], { encoding: 'utf8', timeout: 10000 });
  let result = run();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(JSON.parse(result.stdout).runtimeValidated, false);
  result = run();
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error.message, /EEXIST/);
});
