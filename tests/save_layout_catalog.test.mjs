import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  projectSequentialFields,
  integerExpression,
  createSaveLayoutCatalog,
  exportSaveLayoutCatalog,
} from '../tools/save_layout_catalog.mjs';
import { extractMetadata } from '../tools/elf_metadata.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');

test('explicit sequential projection preserves bit spans and never claims runtime validation', () => {
  const fields = [
    ['version', 1, 8],
    ['expansions', 4, 1],
    ['volumes', 4, 8],
    ['options', 8, 1],
    ['portal master', 2, 32],
    ['slot level IDs', 4, 8],
    ['minions', 1, 9],
    ['completion percent', 4, 8],
  ].map(([name, count, bits]) => ({ name, count, bits }));
  const r = projectSequentialFields(fields);
  assert.deepEqual(
    r.spans.map((s) => s.bitIndex),
    [0, 8, 12, 44, 52, 116, 148, 157],
  );
  assert.equal(r.totalBits, 189);
  assert.equal(r.runtimeValidated, false);
  assert.equal(projectSequentialFields([]).totalBits, 0);
  assert.equal(projectSequentialFields([{ name: 'empty', count: 0, bits: 32 }]).totalBits, 0);
  for (const count of [-1, 0.5, NaN, Infinity, 10000001])
    assert.throws(() => projectSequentialFields([{ name: 'invalid', count, bits: 1 }]), /bounded/);
  assert.throws(() => projectSequentialFields([null]), /bounded/);
  assert.throws(() => projectSequentialFields(null), /sequence/);
});

test('constant extraction accepts only signed 32-bit typed literals and NO_OP wrappers', () => {
  assert.equal(integerExpression({ kind: 'integer-literal', value: -1 }), -1);
  const literalWrapper = {
    kind: 'arithmetic',
    operation: 'NO_OP',
    conditioner: { kind: 'null' },
    serializedResultFunction: { kind: 'null' },
    left: { kind: 'integer-literal', value: 20 },
  };
  assert.equal(integerExpression(literalWrapper), 20);
  for (const conditioner of [undefined, { kind: 'object' }, { kind: 'unresolved' }])
    assert.equal(integerExpression({ ...literalWrapper, conditioner }), null);
  for (const serializedResultFunction of [undefined, { kind: 'object' }, { kind: 'unresolved' }])
    assert.equal(integerExpression({ ...literalWrapper, serializedResultFunction }), null);
  const cyclic = { ...literalWrapper };
  cyclic.left = cyclic;
  assert.equal(integerExpression(cyclic), null);
  assert.equal(
    integerExpression({
      kind: 'arithmetic',
      operation: 'MULT_OP',
      left: { kind: 'integer-literal', value: 20 },
    }),
    null,
  );
  assert.equal(integerExpression({ kind: 'uninterpreted-literal', rawWord: 1069547520 }), null);
  for (const value of [NaN, Infinity, '8', 0.5, 0x80000000, -0x80000001])
    assert.equal(integerExpression({ kind: 'integer-literal', value }), null);
  assert.equal(integerExpression(null), null);
  assert.throws(() => createSaveLayoutCatalog({}), /metadata/);
});

const files = {
  initializer: 'research/init_setup/level.bld',
  global: 'research/permanent_global/level.bld',
  registry: 'research/chapter-registry-v1.json',
};
const executable = 'extracted/CUSA00697/eboot.elf';
const available = [...Object.values(files), executable].every((f) => fs.existsSync(f));
function inputs() {
  const bytes = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.readFileSync(f)]));
  return {
    ...bytes,
    registry: JSON.parse(bytes.registry),
    metadata: extractMetadata(executable),
    expectedHashes: Object.fromEntries(Object.entries(bytes).map(([k, b]) => [k, hash(b)])),
  };
}
const names = (node) => node.components?.map((c) => c.name);

test(
  'owned save script preserves 88 call sites, widths, symbolic counts and allocation formulas',
  { skip: !available },
  () => {
    const options = inputs(),
      r = createSaveLayoutCatalog(options);
    assert.equal(r.opcodeRows, 1209);
    assert.equal(r.script.objectIndex, 10760);
    assert.equal(r.declarations.length, 88);
    assert.equal(r.definitionMacro.objectIndex, 2578);
    for (const d of r.declarations) {
      assert.equal(d.arguments.length, 6);
      assert.equal(d.runtimeExecuted, 'unknown');
      assert.equal(d.finalBitIndex, null);
      assert.ok(d.arguments.every((a) => a.valueFieldEvidence && a.ownerFieldEvidence));
    }
    const declaration = (row) => r.declarations.find((d) => d.row === row);
    assert.equal(declaration(36).saveName, 'header - savegame version');
    assert.equal(declaration(36).constantFieldCount, 1);
    assert.equal(declaration(36).constantBitWidth, 8);
    assert.equal(declaration(134).constantFieldCount, null);
    assert.equal(declaration(134).headerFlag, 1);
    assert.deepEqual(
      [503, 513, 523, 533].map((row) => declaration(row).constantBitWidth),
      [8, 20, 4, 30],
    );
    assert.ok([503, 513, 523, 533].every((row) => declaration(row).constantFieldCount === null));
    assert.equal(declaration(1161).constantBitWidth, null);
    const assignment = (row) => r.assignments.find((a) => a.row === row);
    assert.deepEqual(names(assignment(35).rhs.left), ['Level_Loads', 'SetVariant::count']);
    assert.equal(assignment(35).rhs.object.objectIndex, 683);
    assert.equal(assignment(502).rhs.operation, 'MULT_OP');
    assert.deepEqual(names(assignment(502).rhs.left), ['DifficultyTracking_SegmentsPerLevel']);
    assert.deepEqual(names(assignment(502).rhs.right), ['level count']);
    assert.equal(assignment(1180).rhs.operation, 'MULT_OP');
    assert.deepEqual(names(assignment(1180).rhs.left), ['param', 'num bits']);
    assert.deepEqual(names(assignment(1180).rhs.right), ['param', 'fields total']);
    assert.deepEqual(names(assignment(1181).lhs), ['param', 'bit index']);
    assert.deepEqual(names(assignment(1181).rhs.left), ['bit ct']);
    assert.equal(assignment(1182).rhs.operation, 'ADD_OP');
    assert.equal(assignment(1184).rhs.operation, 'DIV_OP');
    assert.equal(integerExpression(assignment(1184).rhs.right), 32);
    assert.deepEqual(names(assignment(1185).lhs), ['fill savegame set', 'SetVariant::count']);
    assert.equal(integerExpression(assignment(1185).rhs.right), 1);
    assert.equal(assignment(9).rhs.left.kind, 'uninterpreted-literal'); // Float bits must not become an integer constant.
    assert.equal(assignment(9).rhs.left.rawWord, 1069547520);
    assert.equal(r.conditionals.find((c) => c.row === 986).comparison, 'EQ_OP');
    assert.deepEqual(
      r.inputSnapshots.map((s) => s.serializedMemberCount ?? s.serializedValueWord),
      [22, 22, 4, 3],
    );
    assert.equal(r.runtimeValidated, false);
    assert.equal(r.offsetsFullyResolved, false);
    assert.equal(r.saveMigrationSupported, false);
    assert.throws(
      () =>
        createSaveLayoutCatalog({
          ...options,
          expectedHashes: { ...options.expectedHashes, initializer: '0'.repeat(64) },
        }),
      /SHA-256/,
    );
    assert.throws(
      () =>
        createSaveLayoutCatalog({
          ...options,
          metadata: {
            ...options.metadata,
            classes: options.metadata.classes.filter((c) => c.name !== 'OpParameter'),
          },
        }),
      /Native field/,
    );
  },
);

test(
  'catalog export is exclusive, hash-bound and leaves source bytes unchanged',
  { skip: !available },
  () => {
    const options = inputs(),
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'save-layout-test-')),
      output = path.join(dir, 'catalog.json');
    try {
      const args = { ...files, executable, output, expectedHashes: options.expectedHashes };
      const result = exportSaveLayoutCatalog(args);
      assert.equal(result.declarations, 88);
      assert.equal(hash(fs.readFileSync(output)), result.sha256);
      assert.throws(() => exportSaveLayoutCatalog(args), /EEXIST/);
      assert.throws(
        () =>
          exportSaveLayoutCatalog({
            ...args,
            output: path.join(dir, 'rejected.json'),
            expectedHashes: { ...args.expectedHashes, registry: '0'.repeat(64) },
          }),
        /SHA-256/,
      );
      assert.equal(fs.existsSync(path.join(dir, 'rejected.json')), false);
      const link = path.join(dir, 'source-link');
      fs.symlinkSync(path.resolve(files.initializer), link);
      assert.throws(
        () => exportSaveLayoutCatalog({ ...args, initializer: link, output: path.join(dir, 'symlink.json') }),
        /ELOOP/,
      );
      for (const [key, filename] of Object.entries(files))
        assert.equal(hash(fs.readFileSync(filename)), options.expectedHashes[key]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
