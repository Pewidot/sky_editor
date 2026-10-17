import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeIgz } from './fixtures/igz_fixture.mjs';
import { appendTypeDeclarations, extendTypeSignature, POSITION_STACK_FIELDS } from '../tools/igz_types.mjs';
import { appendIgz, inspectAppendTarget } from '../tools/igz_append.mjs';
import { parseIgz } from '../tools/igz.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
test('type declarations preserve old objects, names, fixups and sentinel pools', () => {
  const source = makeIgz({ sentinelPool: true, specialRelocation: true, tmhnReference: true }),
    original = Buffer.from(source);
  const r = appendTypeDeclarations(source, {
    expectedSha256: sha(source),
    types: [
      { type: 'PositionStack', size: 40, fields: POSITION_STACK_FIELDS },
      { type: 'ExampleInfo', size: 72, fields: [] },
    ],
  });
  const z = parseIgz(r.buffer);
  assert.deepEqual(z.types.slice(-2), ['PositionStack', 'ExampleInfo']);
  assert.ok(source.equals(original));
  assert.equal(r.manifest.nativeSupportVerified, false);
  assert.equal(r.manifest.runtimeValidated, false);
});
test('new type can be explicitly instantiated by the independent append primitive', () => {
  const source = makeIgz(),
    r = appendTypeDeclarations(source, {
      expectedSha256: sha(source),
      types: [{ type: 'ExampleInfo', size: 40, fields: [] }],
    });
  const t = inspectAppendTarget(r.buffer, sha(r.buffer)),
    payload = Buffer.alloc(40);
  payload.writeUInt32LE(t.types.find((t) => t.type === 'ExampleInfo').typeIndex);
  const next = appendIgz(r.buffer, {
    expectedSha256: sha(r.buffer),
    appendedDefaultPool: payload,
    appendedObjects: [{ offset: 0, type: 'ExampleInfo' }],
  });
  assert.equal(parseIgz(next.buffer).objects.at(-1).type, 'ExampleInfo');
});
test('type signature hashes field storage sizes and names, continuing the old accumulator', () => {
  const input = makeIgz(),
    before = input.readUInt32LE(8);
  const result = appendTypeDeclarations(input, {
    expectedSha256: sha(input),
    types: [{ type: 'PositionStack', size: 40, fields: POSITION_STACK_FIELDS }],
  });
  let hash = BigInt(before);
  for (const f of POSITION_STACK_FIELDS) {
    const size = Buffer.alloc(2);
    size.writeUInt16BE(f.size);
    for (const b of Buffer.concat([size, Buffer.from(f.name), Buffer.from(f.metaType)]))
      hash = ((hash ^ BigInt(b)) * 16777619n) & 0xffffffffn;
  }
  assert.equal(result.buffer.readUInt32LE(8), Number(hash));
  assert.equal(extendTypeSignature(0x7a279809, POSITION_STACK_FIELDS), 0xa81c32cc);
  assert.equal(extendTypeSignature(before, []), before);
  assert.throws(() => extendTypeSignature(before, [{ size: 65536, name: 'x', metaType: 'X' }]));
  assert.throws(() =>
    appendTypeDeclarations(input, { expectedSha256: sha(input), types: [{ type: 'Unknown', size: 40 }] }),
  );
});
test('invalid or duplicate declarations and mismatched inputs fail closed', () => {
  const source = makeIgz(),
    expectedSha256 = sha(source);
  for (const types of [
    [],
    [{ type: 'tfbActorInfo', size: 368 }],
    [{ type: 'bad\0name', size: 40 }],
    [{ type: 'A', size: 7 }],
    [{ type: 'A', size: 41 }],
    [
      { type: 'A', size: 40 },
      { type: 'A', size: 40 },
    ],
    [{ type: 'A', size: 40, extra: true }],
  ])
    assert.throws(() => appendTypeDeclarations(source, { expectedSha256, types }));
  assert.throws(() =>
    appendTypeDeclarations(source, { expectedSha256: '0'.repeat(64), types: [{ type: 'A', size: 40 }] }),
  );
});
