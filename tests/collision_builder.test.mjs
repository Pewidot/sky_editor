import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { makeCollisionIgz } from './fixtures/collision_fixture.mjs';
import { parseIgz } from '../tools/igz.mjs';
import { runRequest, FEET_TO_WORLD } from '../tools/collision_builder.mjs';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
function fixture(t, options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-collision-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.bld'),
    output = path.join(dir, 'edited.bld'),
    bytes = makeCollisionIgz(options);
  fs.writeFileSync(source, bytes);
  return { source, output, bytes, expectedSourceHash: sha256(bytes) };
}
function build(f, edits, overrides = {}) {
  return runRequest({
    operation: 'build',
    path: f.source,
    output: f.output,
    expectedSourceHash: f.expectedSourceHash,
    edits,
    ...overrides,
  });
}

test('inspection proves one private root BOX and explicitly converts feet to world units', (t) => {
  const f = fixture(t),
    result = runRequest({ operation: 'inspect', path: f.source });
  assert.equal(result.editableCount, 1);
  assert.equal(result.actors.length, 2);
  const a = result.actors[0];
  assert.equal(a.editable, true);
  assert.equal(a.collisionId, 3);
  assert.deepEqual(a.dimensionsFeet, [35, 35, 3]);
  assert.deepEqual(
    a.dimensionsWorld,
    [35, 35, 3].map((n) => Math.fround(n * FEET_TO_WORLD)),
  );
  assert.equal(a.properties, 0x69);
  assert.equal(a.incomingReferenceCount, 1);
  assert.deepEqual(fs.readFileSync(f.source), f.bytes);
});

test('build modifies only selected scalar spans, reparses, retains flags, and records rounding', (t) => {
  const f = fixture(t),
    dims = [12.3456789, 0.5, 30],
    offset = [0, -0.25, 1.23456789];
  const result = build(f, [{ actorId: 1, dimensionsWorld: dims, offsetWorld: offset }]);
  const output = fs.readFileSync(result.output),
    before = parseIgz(f.bytes),
    after = parseIgz(output),
    ci = after.objects[3];
  assert.equal(result.runtimeTested, false);
  assert.equal(result.changedActors, 1);
  for (let i = 0; i < output.length; i++) {
    const allowed =
      (i >= ci.offset + 0x34 && i < ci.offset + 0x40) || (i >= ci.offset + 0x4c && i < ci.offset + 0x58);
    if (!allowed) assert.equal(output[i], f.bytes[i], `unrelated byte ${i}`);
  }
  assert.equal(after.u32(ci.offset + 0x30), before.u32(before.objects[3].offset + 0x30));
  dims.forEach((n, i) =>
    assert.equal(output.readFloatLE(ci.offset + 0x4c + i * 4), Math.fround(n / FEET_TO_WORLD)),
  );
  offset.forEach((n, i) => assert.equal(output.readFloatLE(ci.offset + 0x34 + i * 4), Math.fround(n)));
  assert.deepEqual(fs.readFileSync(f.source), f.bytes);
  const manifest = JSON.parse(fs.readFileSync(result.manifest));
  assert.equal(manifest.source.sha256, f.expectedSourceHash);
  assert.equal(manifest.output.sha256, sha256(output));
  assert.deepEqual(manifest.verification, {
    reparsed: true,
    unchangedOutsideFields: true,
    collisionFlagsUnchanged: true,
    gameRuntimeTested: false,
  });
  assert.equal(manifest.changes[0].storageUnits, 'feet');
  assert.equal(manifest.changes[1].storageUnits, 'world meters');
  assert.deepEqual(
    manifest.changes[0].effectiveWorld,
    dims.map((n) => Math.fround(Math.fround(n / FEET_TO_WORLD) * FEET_TO_WORLD)),
  );
});

test('shared/interior references, unsupported transforms/types/flags and ambiguous fixups reject', (t) => {
  for (const options of [
    { shared: true },
    { interiorReference: true },
    { parent: true },
    { missingPointer: true },
    { scale: [100, 50, 100] },
    { rotation: [1, 0, 0] },
    { rotation: [0, 361, 0] },
    { collisionRotation: [0, 1, 0] },
    { collisionSize: 0x88 },
    { actorSize: 0x178 },
    { properties: 0x68 },
    { properties: 0x09 },
    { dimensionsFeet: [0, 1, 1] },
    { dimensionsFeet: [NaN, 1, 1] },
    { offsetWorld: [Infinity, 0, 0] },
    { unresolvedRofs: true },
    { scalarFixup: true },
    { placementFlags: 1 },
  ]) {
    const f = fixture(t, options),
      inspection = runRequest({ operation: 'inspect', path: f.source, actorId: 1 });
    assert.equal(inspection.actors[0].editable, false, JSON.stringify(options));
    assert.throws(() => build(f, [{ actorId: 1, dimensionsWorld: [1, 1, 1] }]), /not editable/);
    assert.equal(fs.existsSync(f.output), false);
    assert.deepEqual(fs.readFileSync(f.source), f.bytes);
  }
});

test('bounded actor yaw is accepted but never changed', (t) => {
  const f = fixture(t, { rotation: [0, 90, 0] });
  const result = build(f, [{ actorId: 1, dimensionsWorld: [0.1, 1000, 3] }]);
  assert.equal(
    runRequest({ operation: 'inspect', path: result.output, actorId: 1 }).actors[0].rotationDegrees[1],
    90,
  );
});

test('null-looking external parent/attachment slots and runtime initializer slots reject', (t) => {
  const options = [
    ...[0xa0, 0xa8].map((attachmentField) => ({ attachmentField })),
    ...[0x80, 0xa0, 0xa8].map((specialNullField) => ({ specialNullField })),
    ...['RNEX', 'REXT', 'RPID', 'RHND'].flatMap((externalMagic) =>
      [0x80, 0xa0, 0xa8, 0x120].map((externalField) => ({ externalMagic, externalField })),
    ),
  ];
  for (const option of options) {
    const f = fixture(t, option),
      result = runRequest({ operation: 'inspect', path: f.source, actorId: 1 });
    assert.equal(result.editableCount, 0, JSON.stringify(option));
    assert.throws(() => build(f, [{ actorId: 1, dimensionsWorld: [1, 1, 1] }]), /not editable/);
    assert.equal(fs.existsSync(f.output), false);
  }
});

test('invalid requests and field expansions fail before creating files', (t) => {
  for (const edit of [
    { actorId: 1 },
    { actorId: 0, dimensionsWorld: [1, 1, 1] },
    { actorId: -1, dimensionsWorld: [1, 1, 1] },
    { actorId: 1, dimensionsWorld: [0, 1, 1] },
    { actorId: 1, dimensionsWorld: [1001, 1, 1] },
    { actorId: 1, dimensionsWorld: [NaN, 1, 1] },
    { actorId: 1, dimensionsWorld: ['1', 1, 1] },
    { actorId: 1, offsetWorld: [0, 0] },
    { actorId: 1, offsetWorld: [0, 1001, 0] },
    { actorId: 1, offsetWorld: [0, 0, Infinity] },
    { actorId: 1, properties: 0x69 },
    { actorId: 1, position: [0, 0, 0] },
    { actorId: 1, dimensionsFeet: [1, 1, 1] },
  ]) {
    const f = fixture(t);
    assert.throws(() => build(f, [edit]));
    assert.equal(fs.existsSync(f.output), false);
  }
  const f = fixture(t),
    edit = { actorId: 1, dimensionsWorld: [1, 1, 1] };
  for (const edits of [[], [edit, edit], Array(33).fill(edit), null]) assert.throws(() => build(f, edits));
  for (const expectedSourceHash of [undefined, '0'.repeat(64), 'garbage'])
    assert.throws(() => build(f, [edit], { expectedSourceHash }), /SHA-256/);
  assert.throws(() => build(f, [edit], { force: true }), /unsupported/);
  assert.deepEqual(fs.readFileSync(f.source), f.bytes);
});

test('source aliases, existing output/manifest and symlinks are never overwritten', (t) => {
  for (const kind of ['output', 'manifest', 'symlink', 'dangling', 'source']) {
    const f = fixture(t);
    let output = f.output;
    if (kind === 'output') fs.writeFileSync(output, 'retain');
    if (kind === 'manifest') fs.writeFileSync(output + '.manifest.json', 'retain');
    if (kind === 'symlink') fs.symlinkSync(f.source, output);
    if (kind === 'dangling') fs.symlinkSync(output + '.absent', output);
    if (kind === 'source') output = f.source;
    assert.throws(() => build(f, [{ actorId: 1, dimensionsWorld: [1, 1, 1] }], { output }));
    assert.deepEqual(fs.readFileSync(f.source), f.bytes);
    if (kind === 'output') assert.equal(fs.readFileSync(output, 'utf8'), 'retain');
    if (kind === 'manifest') assert.equal(fs.readFileSync(output + '.manifest.json', 'utf8'), 'retain');
    if (kind === 'dangling') assert.equal(fs.lstatSync(output).isSymbolicLink(), true);
  }
});

test('CLI emits a single JSON result or error', (t) => {
  const f = fixture(t);
  for (const input of ['bad json', JSON.stringify({ operation: 'inspect', path: f.source, actorId: 1 })]) {
    const child = spawnSync(process.execPath, ['tools/collision_builder.mjs'], { input, encoding: 'utf8' });
    const result = JSON.parse(child.stdout);
    assert.equal(child.stderr, '');
    assert.equal(child.stdout.trim().split('\n').length, 1);
    if (input === 'bad json') {
      assert.equal(child.status, 1);
      assert.ok(result.error.message);
    } else {
      assert.equal(child.status, 0);
      assert.equal(result.editableCount, 1);
    }
  }
});

const localSource = 'research/arena_challenge_303_000/level.bld';
test(
  'local GarageDoor_4 is structurally eligible; integration is inspection-only',
  { skip: !fs.existsSync(localSource) },
  () => {
    const before = sha256(fs.readFileSync(localSource));
    assert.equal(before, 'de0ecd5bc5f5f2b3d99ec81592e8fef97a3228e6777e99f1c169e6cd584e7a32');
    const result = runRequest({
      operation: 'inspect',
      path: localSource,
      actorId: 26175,
      expectedSourceHash: before,
    });
    const door = result.actors[0];
    assert.equal(door.name, 'GarageDoor_4');
    assert.equal(door.editable, true);
    assert.equal(door.collisionOffset, 0x2d6454);
    assert.equal(door.properties, 0x69);
    assert.deepEqual(door.dimensionsFeet, [35, 35, 3]);
    assert.deepEqual(door.offsetWorld, [0, 0, 0]);
    assert.equal(sha256(fs.readFileSync(localSource)), before);
  },
);
