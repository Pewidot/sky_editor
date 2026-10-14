import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createScriptGraph, describeOpcodeFlow, exportScriptGraph } from '../tools/script_graph.mjs';
import { encodeV8Offsets } from '../tools/igz_append.mjs';
import { extractMetadata } from '../tools/elf_metadata.mjs';
import { EXECUTABLE_SHA256 } from '../tools/level_builder.mjs';
import { parseIgz } from '../tools/igz.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const align = (n) => Math.ceil(n / 4) * 4;
const fixtureClass = (name, size, fields, parent) => ({
  name,
  size,
  ...(parent ? { parent } : {}),
  fields: Object.entries(fields).map(([name, offset]) => ({ name, offset })),
  evidence: 'synthetic-field-evidence',
});
const metadata = {
  executableSha256: EXECUTABLE_SHA256,
  classes: [
    fixtureClass('tfbScriptInfo', 0x38, { _opList: 0x28, _masterVarList: 0x30 }),
    fixtureClass('OpCode', 0x38, {
      _internalFlagsStorage: 0x30,
      _branchPC: 0x32,
      _internalFlags: 0,
      _toolTip: 0,
    }),
    fixtureClass('OpAbstractCheckValue', 0x50, { _LHS: 0x38, _relOperator: 0x40, _RHS: 0x48 }),
    fixtureClass('OpCheckValue', 0x50, {}, 'OpAbstractCheckValue'),
    fixtureClass('OpAbstractDefinition', 0x50, { _thisPC: 0x40, _scriptInfo: 0x48 }),
    fixtureClass('OpDefineMacro', 0x60, { _macroVarList: 0x50, _returnMacro: 0x58 }, 'OpAbstractDefinition'),
    fixtureClass('OpUserBehavior', 0x40, { _thisPC: 0x34, _scriptInfo: 0x38 }),
    fixtureClass('ValueInfo', 0x48, { _value: 0x40, _resetValue: 0x30, _interface: 0 }),
    fixtureClass('ValueRHSVariant', 0x38, {
      _varOp1: 0x10,
      _arithOperator: 0x18,
      _varOp2: 0x20,
      _resultFunc: 0x28,
      _conditioner: 0x30,
    }),
    fixtureClass('RHSValueStack', 0x48, { _type: 0x38, _value: 0x40, _properties: 0x30, _isRandom: 0 }),
    fixtureClass('Placement', 0x138, { _script: 0xf8 }),
    fixtureClass('tfbActorInfo', 0x170, {}, 'Placement'),
  ],
  enums: [
    { name: 'RelOp', values: [{ value: 1, name: 'EQ_OP' }], evidence: 'synthetic-enum-evidence' },
    {
      name: 'ArithOp',
      values: [
        { value: -1, name: 'NO_OP' },
        { value: 0, name: 'ADD_OP' },
        { value: 1, name: 'SUB_OP' },
        { value: 2, name: 'MULT_OP' },
        { value: 3, name: 'DIV_OP' },
      ],
      evidence: 'synthetic-arithmetic-evidence',
    },
  ],
};

// Entirely synthetic object graph, with one deliberately unresolved EXID.
function fixture({ externalKind = 'REXT', literal = false } = {}) {
  const specs = [
    ['igObjectList', 0x28],
    ['tfbScriptInfo', 0x38, 'Fixture/Start.ai'],
    ['OpCodeList', 0x28],
    ['OpStartUp', 0x38, 'STARTUP'],
    ['OpCheckValue', 0x50, 'check value'],
    ['OpUnknownFixture', 0x40, 'Unknown'],
    ['OpAbstractFlow', 0x38, 'flow'],
    ['ValueStack', 0x30],
    ['ValueInfo', 0x48, 'counter'],
    ['tfbActorInfo', 0x170, 'Owner'],
    ['OpDefineMacro', 0x60, 'Macro'],
    ['OpUserBehavior', 0x40, 'Behavior'],
    ['ValueRHSVariant', 0x38],
    ['RHSValueStack', 0x48],
  ].map(([type, size, name]) => ({ type, size, name }));
  let cursor = 8;
  specs.forEach((o, index) => {
    o.index = index;
    o.offset = cursor;
    cursor += o.size;
  });
  const arrays = [
    [0, [1, 9]],
    [2, [3, 4, 5, 6, 10, 11]],
    [7, [8, 'external']],
  ].map(([index, values]) => {
    const array = { index, values, offset: cursor };
    cursor += values.length * 8;
    return array;
  });
  const data = Buffer.alloc(cursor),
    strings = [],
    rofs = [],
    rstt = [],
    rext = [];
  specs.forEach((o) => {
    data.writeUInt32LE(o.index, o.offset);
    if (o.name) {
      data.writeUInt32LE(strings.length, o.offset + 0x10);
      strings.push(o.name);
      rstt.push(o.offset + 0x10);
    }
  });
  const externalName = strings.length;
  strings.push('IntMeasurement', 'metaobject');
  function pointer(index, field, target) {
    const at = specs[index].offset + field;
    data.writeBigUInt64LE(BigInt(specs[target].offset), at);
    rofs.push(at);
  }
  pointer(1, 0x28, 2);
  pointer(1, 0x30, 7);
  pointer(4, 0x38, 7);
  pointer(4, 0x48, 12);
  pointer(12, 0x10, literal ? 13 : 8);
  pointer(9, 0xf8, 1);
  pointer(10, 0x48, 1);
  pointer(10, 0x50, 7);
  pointer(11, 0x38, 1);
  data.writeUInt16LE(1, specs[3].offset + 0x30);
  data.writeUInt16LE(2, specs[3].offset + 0x32);
  data.writeUInt16LE(0xfffe, specs[4].offset + 0x30);
  data.writeUInt16LE(1, specs[4].offset + 0x32);
  data.writeUInt32LE(1, specs[4].offset + 0x40);
  data.writeUInt16LE(65535, specs[6].offset + 0x32);
  data.writeUInt32LE(7, specs[8].offset + 0x40);
  data.writeUInt32LE(3, specs[8].offset + 0x30);
  data.writeInt32LE(-1, specs[10].offset + 0x40);
  data.writeInt32LE(5, specs[11].offset + 0x34);
  data.writeInt32LE(-1, specs[12].offset + 0x18);
  data.writeBigUInt64LE(literal ? 0n : 0x1234n, specs[12].offset + 0x28);
  data.writeUInt32LE(200, specs[13].offset + 0x40);
  rext.push(specs[13].offset + 0x38);
  data.writeBigUInt64LE(0x8000000000000000n, specs[5].offset + 0x38);
  rext.push(specs[5].offset + 0x38);
  for (const a of arrays) {
    const o = specs[a.index];
    data.writeUInt32LE(a.values.length, o.offset + 0xc);
    data.writeUInt32LE(a.values.length, o.offset + 0x10);
    data.writeUInt32LE(a.values.length * 8, o.offset + 0x18);
    data.writeBigUInt64LE(BigInt(a.offset), o.offset + 0x20);
    rofs.push(o.offset + 0x20);
    a.values.forEach((target, index) => {
      const at = a.offset + index * 8;
      if (target === 'external') {
        data.writeBigUInt64LE(0x8000000000000000n, at);
        rext.push(at);
      } else {
        data.writeBigUInt64LE(BigInt(specs[target].offset), at);
        rofs.push(at);
      }
    });
  }
  function block(magic, count, payload) {
    const b = Buffer.alloc(align(payload.length + 16));
    b.write(magic);
    b.writeUInt32LE(count, 4);
    b.writeUInt32LE(b.length, 8);
    b.writeUInt32LE(16, 12);
    payload.copy(b, 16);
    return b;
  }
  const text = (list) =>
    Buffer.concat(
      list.map((s) => {
        const b = Buffer.from(s + '\0');
        return b.length % 2 ? Buffer.concat([b, Buffer.alloc(1)]) : b;
      }),
    );
  const words = (values) => {
    const b = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => b.writeUInt32LE(v, i * 4));
    return b;
  };
  const offsetBlock = (name, values) =>
    block(name, values.length, encodeV8Offsets(values.sort((a, b) => a - b)));
  const blocks = [
    block('TSTR', strings.length, text(strings)),
    block('TMET', specs.length, text(specs.map((o) => o.type))),
    block('MTSZ', specs.length, words(specs.map((o) => o.size))),
    offsetBlock(
      'RVTB',
      specs.map((o) => o.offset),
    ),
    offsetBlock('RSTT', rstt),
    offsetBlock('ROFS', rofs),
    block(
      externalKind === 'RNEX' ? 'EXNM' : 'EXID',
      1,
      words(externalKind === 'RNEX' ? [externalName, externalName + 1] : [1945, 0x2694be8e]),
    ),
    offsetBlock(externalKind, rext),
    block('ROOT', 1, words([8])),
  ];
  const fixups = Buffer.concat(blocks),
    b = Buffer.alloc(0x800 + fixups.length + data.length);
  b.writeUInt32LE(0x49475a01);
  b.writeUInt32LE(8, 4);
  b.writeUInt32LE(14, 12);
  b.writeUInt32LE(blocks.length, 16);
  [0, 0x800, fixups.length, 0x800, 0, 0x800 + fixups.length, data.length, 8].forEach((v, i) =>
    b.writeUInt32LE(v, 0x14 + i * 4),
  );
  b.write('Default\0', 0x224);
  fixups.copy(b, 0x800);
  data.copy(b, 0x800 + fixups.length);
  return b;
}
const graph = (bytes, extra = {}) =>
  createScriptGraph(bytes, { expectedSha256: hash(bytes), metadata, ...extra });

test('native PC pre-increment, conditional offsets, out-of-list targets and unknowns stay distinct', () => {
  const check = describeOpcodeFlow('OpCheckValue', 4, 3, 10);
  assert.deepEqual(
    check.edges.map((e) => e.targetRow),
    [5, 8],
  );
  assert.equal(check.complete, false);
  assert.equal(describeOpcodeFlow('OpCheckValue', 9, 0, 10).edges[0].targetStatus, 'one-past-list');
  assert.equal(describeOpcodeFlow('OpCheckValue', 9, 65535, 10).edges[1].targetStatus, 'outside-list');
  const unknown = describeOpcodeFlow('OpCheckValueDerived', 4, 3, 10);
  assert.equal(unknown.edges.length, 0);
  assert.equal(unknown.serializedSkipCandidate.semanticsProvenForThisOpcode, false);
  const flow = describeOpcodeFlow('OpAbstractFlow', 4, 3, 10);
  assert.equal(flow.edges.length, 0);
  assert.equal(flow.immediatePCUpdate.targetRow, 8);
  assert.match(flow.dynamicContinuation, /callbacks/);
  const sequence = describeOpcodeFlow('OpStartSequence', 2, 2, 10);
  assert.equal(sequence.edges.length, 1);
  assert.equal(sequence.edges[0].targetRow, 5);
  assert.match(sequence.dynamicContinuation, /execution frame/);
  assert.deepEqual(
    describeOpcodeFlow('OpCheckMembership', 4, 9, 15).edges.map((e) => e.targetRow),
    [5, 14],
  );
  assert.deepEqual(
    describeOpcodeFlow('OpShutDown', 2, 1, 15).edges.map((e) => e.targetRow),
    [4, 3],
  );
  for (const type of ['OpControl', 'OpSpawn', 'OpSetBehavior', 'OpFlowLoop', 'OpRemove', 'OpSetValue']) {
    const f = describeOpcodeFlow(type, 0, 1, 5);
    assert.equal(f.edges.length, 0);
    assert.ok(f.nativeEffect.evidence.length > 0);
    assert.equal(f.nativeEffect.runtimeValidated, false);
  }
  assert.match(describeOpcodeFlow('OpSpawn', 0, 1, 5).nativeEffect.observation, /For placement templates/);
  assert.match(describeOpcodeFlow('OpSpawn', 0, 1, 5).nativeEffect.observation, /Non-placement templates/);
  assert.throws(() => describeOpcodeFlow('x', 0, -1, 1), /coordinates/);
});

test('synthetic rows, source IDs, unsigned storage, attached owners and operands preserve exact source', () => {
  const b = fixture(),
    before = Buffer.from(b),
    g = graph(b),
    s = g.scripts[0];
  assert.equal(g.schema, 'skylanders-script-graph-v1');
  assert.equal(s.rows.length, 6);
  assert.equal(s.id, `igz:${hash(b)}:object:1`);
  assert.equal(s.owners[0].objectIndex, 9);
  assert.equal(s.owners[0].runtimeActive, 'unknown');
  assert.equal(s.rows[1].attributes[0].value, 0xfffe);
  assert.equal(s.rows[1].attributes[2].enumName, 'EQ_OP');
  assert.equal(s.rows[1].references.find((r) => r.fieldOffset === 0x38).fields[0].name, '_LHS');
  assert.equal(s.rows[4].attributes.find((f) => f.name === '_thisPC').value, -1);
  assert.equal(s.rows[5].attributes.find((f) => f.name === '_thisPC').value, 5);
  assert.equal(s.rows[4].declaredPointerFields.find((f) => f.name === '_returnMacro').target.kind, 'null');
  assert.ok(s.rows.every((row) => row.attributes.every((a) => a.fieldOffset !== 0)));
  assert.equal(g.runtimeValidated, false);
  assert.equal(g.semanticsComplete, false);
  assert.equal(g.executableScriptSourceRecovered, false);
  assert.deepEqual(b, before);
});

test('unresolved EXID operands and object-array items keep table provenance without fabricated resolution', () => {
  const g = graph(fixture()),
    ext = g.scripts[0].rows[2].references.find((r) => r.fieldOffset === 0x38).target;
  assert.equal(ext.kind, 'external-reference');
  assert.equal(ext.table, 'EXID');
  assert.equal(ext.nameId, 1945);
  assert.equal(ext.namespaceHash, 0x2694be8e);
  assert.equal(ext.crossArtifactResolution, 'not-attempted');
  const stack = g.operandObjects.find((o) => o.type === 'ValueStack');
  assert.equal(stack.listEntries.length, 2);
  assert.equal(stack.listEntries[1].target.kind, 'external-reference');
  assert.equal(g.operandObjects.find((o) => o.type === 'ValueInfo').attributes[0].value, 7);
});

test('ValueRHSVariant arithmetic is signed, pointers are labelled and resultFunc is not guessed as an object', () => {
  for (const [value, enumName] of [
    [-1, 'NO_OP'],
    [0, 'ADD_OP'],
    [1, 'SUB_OP'],
    [2, 'MULT_OP'],
    [3, 'DIV_OP'],
    [-2, null],
  ]) {
    const b = fixture(),
      z = parseIgz(b),
      variant = z.objects.find((o) => o.type === 'ValueRHSVariant');
    b.writeInt32LE(value, variant.offset + 0x18);
    const v = graph(b).operandObjects.find((o) => o.type === 'ValueRHSVariant'),
      a = v.attributes.find((a) => a.name === '_arithOperator');
    assert.equal(a.encoding, 'int32le');
    assert.equal(a.value, value);
    assert.equal(a.enumName, enumName);
    assert.deepEqual(
      v.declaredPointerFields.map((f) => f.name),
      ['_varOp1', '_varOp2', '_conditioner'],
    );
    assert.equal(v.declaredPointerFields[0].target.kind, 'local-object');
    assert.equal(v.declaredPointerFields[1].target.kind, 'null');
    assert.ok(!v.attributes.some((f) => f.name === '_resultFunc'));
    assert.ok(!v.references.some((f) => f.fieldOffset === 0x28));
  }
});

test('only the exact SetVariant::count EXID pair receives native identity, never object resolution or a computed value', () => {
  for (const [nameId, namespaceHash, expected] of [
    [967958004, 1549491124, true],
    [967958005, 1549491124, false],
    [967958004, 1549491125, false],
  ]) {
    const b = fixture(),
      z = parseIgz(b),
      exid = z.fixupMap.get('EXID');
    b.writeUInt32LE(nameId, exid.dataOffset);
    b.writeUInt32LE(namespaceHash, exid.dataOffset + 4);
    const target = graph(b).scripts[0].rows[2].references.find((r) => r.fieldOffset === 0x38).target;
    assert.equal(target.kind, 'external-reference');
    assert.equal(target.crossArtifactResolution, 'not-attempted');
    assert.equal(!!target.nativeBuiltinIdentity, expected);
    assert.equal(target.objectIndex, undefined);
    if (expected) {
      assert.equal(target.nativeBuiltinIdentity.symbol, 'SetVariant::count');
      assert.equal(target.nativeBuiltinIdentity.valueEvaluated, false);
      assert.equal(target.nativeBuiltinIdentity.getter, '0x4814a0');
      assert.equal(target.nativeBuiltinIdentity.evidence.length, 4);
    }
  }
});

test('Placement range properties use exact native registration pairs without interpreting input units', () => {
  for (const [nameId, symbol, setter] of [
    [664674460, 'Placement::activation range', '0x47b9d0'],
    [54063584, 'Placement::deactivation buffer', '0x47ba50'],
  ]) {
    const b = fixture(),
      z = parseIgz(b),
      exid = z.fixupMap.get('EXID');
    b.writeUInt32LE(nameId, exid.dataOffset);
    b.writeUInt32LE(893222784, exid.dataOffset + 4);
    const ext = graph(b).scripts[0].rows[2].references.find((r) => r.fieldOffset === 0x38).target;
    assert.equal(ext.nativeBuiltinIdentity.symbol, symbol);
    assert.equal(ext.nativeBuiltinIdentity.setter, setter);
    assert.equal(ext.nativeBuiltinIdentity.valueEvaluated, false);
    assert.match(ext.nativeBuiltinIdentity.limitation, /units/);
    b.writeUInt32LE(893222785, exid.dataOffset + 4);
    assert.equal(
      graph(b).scripts[0].rows[2].references.find((r) => r.fieldOffset === 0x38).target.nativeBuiltinIdentity,
      undefined,
    );
  }
});

test('ActorInfo removed set identity cannot be confused with the different SpriteInfo namespace', () => {
  const b = fixture(),
    z = parseIgz(b),
    at = z.fixupMap.get('EXID').dataOffset;
  b.writeUInt32LE(1073217499, at);
  b.writeUInt32LE(1483773250, at + 4);
  const target = graph(b).scripts[0].rows[2].references.find((r) => r.fieldOffset === 0x38).target;
  assert.equal(target.nativeBuiltinIdentity.symbol, 'ActorInfo::removed');
  assert.equal(target.nativeBuiltinIdentity.getter, '0x40cd30');
  assert.equal(target.nativeBuiltinIdentity.valueEvaluated, false);
  b.writeUInt32LE(2698395392, at + 4);
  assert.equal(
    graph(b).scripts[0].rows[2].references.find((r) => r.fieldOffset === 0x38).target.nativeBuiltinIdentity,
    undefined,
  );
});

test('OpTopLevelBehavior my identity is an exact registered ScriptReference, not an inferred self object', () => {
  const b = fixture(),
    z = parseIgz(b),
    at = z.fixupMap.get('EXID').dataOffset;
  b.writeUInt32LE(1278082707, at);
  b.writeUInt32LE(2288385111, at + 4);
  const target = graph(b).scripts[0].rows[2].references.find((r) => r.fieldOffset === 0x38).target;
  assert.equal(target.nativeBuiltinIdentity.symbol, 'OpTopLevelBehavior::my');
  assert.equal(target.nativeBuiltinIdentity.registeredType, 'ScriptReference');
  assert.equal(target.nativeBuiltinIdentity.valueEvaluated, false);
  assert.equal(target.objectIndex, undefined);
  assert.match(target.nativeBuiltinIdentity.limitation, /not established/);
  b.writeUInt32LE(2288385112, at + 4);
  assert.equal(
    graph(b).scripts[0].rows[2].references.find((r) => r.fieldOffset === 0x38).target.nativeBuiltinIdentity,
    undefined,
  );
});

test('native direct-literal annotation is restricted to empty, unconditioned, zero-property NO_OP operands', () => {
  const original = fixture({ externalKind: 'RNEX', literal: true }),
    z = parseIgz(original),
    variant = z.objects.find((o) => o.type === 'ValueRHSVariant'),
    rhs = z.objects.find((o) => o.type === 'RHSValueStack');
  const get = (b) => graph(b).operandObjects.find((o) => o.type === 'ValueRHSVariant').directLiteral;
  const literal = get(original);
  assert.equal(literal.rawUint32, 200);
  assert.equal(literal.type.stringIdentity.name.value, 'IntMeasurement');
  assert.equal(literal.nativeGetter, '0x48e630');
  assert.equal(literal.conversionApplied, false);
  for (const [at, value] of [
    [variant.offset + 0x18, 0],
    [variant.offset + 0x28, 1],
    [variant.offset + 0x30, 1],
    [rhs.offset + 0x30, 1],
  ]) {
    const b = Buffer.from(original);
    b.writeUInt32LE(value, at);
    assert.equal(get(b), undefined);
  }
});

test('EXNM decodes native-backed TSTR name/namespace with source locations, not object resolution', () => {
  const b = fixture({ externalKind: 'RNEX' }),
    z = parseIgz(b);
  const ext = graph(b).scripts[0].rows[2].references.find((r) => r.fieldOffset === 0x38).target;
  assert.equal(ext.kind, 'external-reference');
  assert.equal(ext.table, 'EXNM');
  assert.equal(ext.stringIdentity.name.value, 'IntMeasurement');
  assert.equal(ext.stringIdentity.namespace.value, 'metaobject');
  assert.equal(
    ext.stringIdentity.name.fileOffset,
    z.stringEntries[ext.stringIdentity.name.stringIndex].offset,
  );
  assert.equal(ext.stringIdentity.status, 'decoded-tstr-name-namespace');
  assert.equal(ext.stringIdentity.objectResolution, 'not-attempted');
  assert.equal(ext.crossArtifactResolution, 'not-attempted');
  assert.equal(ext.objectIndex, undefined);
});

test('out-of-range EXNM TSTR words stay explicit unknowns instead of crashing or being masked', () => {
  const b = fixture({ externalKind: 'RNEX' }),
    z = parseIgz(b),
    exnm = z.fixupMap.get('EXNM');
  b.writeUInt32LE(0xffffffff, exnm.dataOffset);
  const ext = graph(b).scripts[0].rows[2].references.find((r) => r.fieldOffset === 0x38).target;
  assert.equal(ext.inBounds, true);
  assert.equal(ext.stringIdentity.name.stringIndex, 0xffffffff);
  assert.equal(ext.stringIdentity.name.inBounds, false);
  assert.equal(ext.stringIdentity.name.value, undefined);
  assert.equal(ext.stringIdentity.namespace.value, 'metaobject');
  assert.equal(ext.stringIdentity.status, 'unresolved-tstr-index');
});

test('selection, budgets, bad native metadata, malformed lists and hashes fail closed', () => {
  const b = fixture();
  assert.equal(graph(b, { scriptName: 'start.AI', scriptIds: [1] }).scripts.length, 1);
  assert.throws(() => graph(b, { scriptIds: [9] }), /matches/);
  assert.throws(() => graph(b, { expectedSha256: '0'.repeat(64) }), /SHA-256/);
  assert.throws(() => graph(b, { metadata: {} }), /native executable/);
  assert.throws(() => graph(b, { metadata: { ...metadata, classes: [] } }), /native script field/);
  assert.throws(() => graph(b, { maxRows: 2 }), /row budget/);
  assert.throws(() => graph(b, { operandDepth: 7 }), /bounded option/);
  const truncated = graph(b, { maxOperandObjects: 1 });
  assert.equal(truncated.budgets.operandExpansionComplete, false);
  assert.ok(truncated.budgets.omittedOperandObjects > 0);
  const damaged = Buffer.from(b),
    z = parseIgz(b);
  damaged.writeUInt32LE(0, z.objects[2].offset + 0x18);
  assert.throws(() => graph(damaged), /capacity or serialized array span/);
  damaged.writeUInt32LE(2_000_001, 0x804);
  assert.throws(() => graph(damaged), /allocation budget/);
});

const executable = 'extracted/CUSA00697/eboot.elf';
test(
  'source-only export refuses overwrite and symlinks, preserves original bytes',
  { skip: !fs.existsSync(executable) },
  (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-script-graph-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const source = path.join(directory, 'source.bld'),
      output = path.join(directory, 'graph.json'),
      b = fixture();
    fs.writeFileSync(source, b);
    const options = { source, output, executable, expectedSha256: hash(b) };
    const r = exportScriptGraph(options);
    assert.equal(r.sha256, hash(fs.readFileSync(output)));
    assert.equal(r.counts.rows, 6);
    assert.throws(() => exportScriptGraph(options), /EEXIST/);
    const link = path.join(directory, 'symlink.bld');
    fs.symlinkSync(source, link);
    assert.throws(
      () => exportScriptGraph({ ...options, source: link, output: path.join(directory, 'next.json') }),
      /ELOOP/,
    );
    assert.deepEqual(fs.readFileSync(source), b);
  },
);

test(
  'local Arena script rows and exact native conditional edges match serialized evidence',
  {
    skip: ![executable, 'research/arena_challenge_303_000/level.bld'].every((f) => fs.existsSync(f)),
  },
  () => {
    const bytes = fs.readFileSync('research/arena_challenge_303_000/level.bld');
    const g = graph(bytes, { metadata: extractMetadata(executable), scriptName: 'ArenaScript_303_000.ai' }),
      s = g.scripts[0];
    assert.equal(s.objectIndex, 4273);
    assert.equal(s.rows.length, 1233);
    assert.equal(s.owners[0].objectIndex, 4272);
    assert.deepEqual(
      s.rows[1].controlFlow.edges.map((e) => e.targetRow),
      [2, 11],
    );
    assert.deepEqual(
      s.rows[43].controlFlow.edges.map((e) => e.targetRow),
      [44, 50],
    );
    assert.equal(s.rows[43].attributes[2].enumName, 'GT_OP');
    assert.equal(g.counts.flowCounts['proven-conditional-skip'], 149);
    const variants = g.operandObjects.filter((o) => o.type === 'ValueRHSVariant');
    assert.ok(variants.length > 0);
    assert.ok(variants.some((v) => v.attributes.some((a) => a.value === -1 && a.enumName === 'NO_OP')));
    assert.ok(variants.every((v) => !v.declaredPointerFields.some((f) => f.name === '_resultFunc')));
  },
);

test(
  'local Soda Springs preserves six different feature scripts without claiming their names prove behavior',
  {
    skip: ![executable, 'research/chapter-catalog-v2/level_313_tutorial/level.bld'].every((f) =>
      fs.existsSync(f),
    ),
  },
  () => {
    const bytes = fs.readFileSync('research/chapter-catalog-v2/level_313_tutorial/level.bld');
    assert.equal(hash(bytes), 'ffb0550f8f11d53e0db9aaa32bc977c887a5f5c0b8f1a139555859a4034b6cd3');
    const g = graph(bytes, {
      metadata: extractMetadata(executable),
      scriptIds: [17780, 26794, 27139, 45815, 48006, 66176],
    });
    assert.equal(g.selection.availableScripts, 194);
    assert.equal(g.counts.rows, 2944);
    assert.equal(g.counts.owners, 6);
    const end = g.scripts.find((s) => s.objectIndex === 48006);
    assert.equal(end.name.split('/').at(-1), 'TEMP_LevelEnd.ai');
    assert.equal(end.owners[0].name, 'Vat_Puzzle_Complete');
    assert.deepEqual(
      end.rows[6].controlFlow.edges.map((e) => e.targetRow),
      [7, 14],
    );
    assert.equal(g.semanticsComplete, false);
    assert.equal(g.runtimeValidated, false);
    const builtins = g.operandObjects
      .flatMap((o) => [...o.references, ...(o.listEntries ?? [])])
      .filter((r) => r.target.nativeBuiltinIdentity);
    assert.ok(builtins.some((r) => r.target.nativeBuiltinIdentity.symbol === 'SetVariant::count'));
    assert.ok(builtins.some((r) => r.target.nativeBuiltinIdentity.symbol === 'ActorInfo::removed'));
    assert.ok(builtins.some((r) => r.target.nativeBuiltinIdentity.symbol === 'OpTopLevelBehavior::my'));
    const guardOperand = g.operandObjects.find((o) => o.objectIndex === 26798),
      exnm = guardOperand.references.find((r) => r.fieldOffset === 0x28).target;
    assert.equal(exnm.stringIdentity.name.value, 'tfbActorInfo');
    assert.equal(exnm.stringIdentity.namespace.value, 'metaobject');
    const gate = g.scripts.find((s) => s.objectIndex === 26794);
    assert.deepEqual(
      gate.rows[4].controlFlow.edges.map((e) => e.targetRow),
      [5, 14],
    );
    assert.equal(gate.rows[4].attributes.find((a) => a.name === '_membershipOp').enumName, 'includes');
    const rhs = g.operandObjects.find((o) => o.objectIndex === 19038);
    assert.equal(rhs.attributes.find((a) => a.name === '_value').value, 200);
    assert.equal(
      rhs.declaredPointerFields.find((f) => f.name === '_type').target.stringIdentity.name.value,
      'IntMeasurement',
    );
    assert.ok(!rhs.attributes.some((a) => ['_funcRHS', '_typeIsNumber', '_isRandom'].includes(a.name)));
    assert.equal(g.operandObjects.find((o) => o.objectIndex === 19037).directLiteral.rawUint32, 200);
  },
);
