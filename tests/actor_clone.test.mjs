import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cloneActor,
  inspectCloneTarget,
  runRequest,
  SOURCE_SHA256,
  SOURCE_SIZE,
  REFCOUNT_MASK,
} from '../tools/actor_clone.mjs';
import { parseIgz } from '../tools/igz.mjs';
import { FEET_TO_WORLD } from '../tools/collision_builder.mjs';

const hash = (b) => createHash('sha256').update(b).digest('hex');
const request = { expectedSourceHash: SOURCE_SHA256, name: 'Structural_Test_Door', position: [-400, 5, -40] };
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-actor-clone-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('clone request rejects unsupported fields, ambiguous names and unbounded transforms before parsing', () => {
  const invalid = [
    null,
    {},
    { ...request, force: true },
    { ...request, actorId: 26175 },
    ...['', ' name', 'name ', 'line\nname', '非ASCII', 'a'.repeat(81)].map((name) => ({ ...request, name })),
    ...[null, [], [0, 0], [0, 0, 0, 0], [0, NaN, 0], [0, Infinity, 0], [0, '1', 0], [0, 10001, 0]].map(
      (position) => ({ ...request, position }),
    ),
    ...[
      [0, 1, 1],
      [-1, 1, 1],
      [0.09, 1, 1],
      [1001, 1, 1],
      [NaN, 1, 1],
      [1, 1],
    ].map((dimensionsWorld) => ({ ...request, dimensionsWorld })),
  ];
  for (const r of invalid) assert.throws(() => cloneActor(Buffer.alloc(0), r));
});

test('only the pinned original digest and exact source length can enter the policy', () => {
  for (const digest of [undefined, '', '0'.repeat(64), SOURCE_SHA256.toUpperCase()])
    assert.throws(() => inspectCloneTarget(Buffer.alloc(0), digest), /exact original/);
  for (const bytes of [null, new Uint8Array(0), Buffer.alloc(0), Buffer.alloc(128)])
    assert.throws(() => inspectCloneTarget(bytes, SOURCE_SHA256), /exactly 91745564/);
  assert.throws(() => inspectCloneTarget(Buffer.alloc(SOURCE_SIZE), SOURCE_SHA256), /SHA-256 mismatch/);
});

test('file requests and CLI reject invalid input without creating outputs', (t) => {
  const dir = temporary(t),
    source = path.join(dir, 'short.bld'),
    output = path.join(dir, 'clone.bld');
  fs.writeFileSync(source, 'not an IGZ');
  for (const r of [
    {},
    { operation: 'delete', path: source },
    { operation: 'inspect', path: source, output },
    { operation: 'inspect', path: dir },
    { operation: 'build', path: source, output, ...request },
  ])
    assert.throws(() => runRequest(r));
  assert.equal(fs.existsSync(output), false);
  assert.equal(fs.existsSync(output + '.manifest.json'), false);
  assert.equal(fs.readFileSync(source, 'utf8'), 'not an IGZ');
  const cliRequest = path.join(dir, 'request.json');
  for (const contents of ['bad JSON', JSON.stringify({ operation: 'inspect', path: source })]) {
    fs.writeFileSync(cliRequest, contents);
    const child = spawnSync(process.execPath, ['tools/actor_clone.mjs', cliRequest], { encoding: 'utf8' });
    assert.equal(child.status, 1);
    assert.equal(child.stderr, '');
    assert.equal(child.stdout.trim().split('\n').length, 1);
    assert.ok(JSON.parse(child.stdout).error.message);
  }
});

// Explicit opt-in; source-only distributions need no copyrighted game bytes.
// Real cloning tests remain in memory. No game payload is written or installed.
const source = process.env.SKYLANDERS_TEST_LEVEL;
test(
  'pinned real arena: one root actor, private owners, exact model count and bounded byte changes',
  { skip: !source },
  () => {
    const stat = fs.statSync(source),
      input = fs.readFileSync(source),
      before = parseIgz(input);
    assert.equal(hash(input), SOURCE_SHA256);
    const inspection = inspectCloneTarget(input, SOURCE_SHA256);
    assert.equal(inspection.eligible, true);
    assert.equal(inspection.sharedModelReferenceCount, 1);
    assert.equal(inspection.rootCount, 1459);
    assert.equal(inspection.runtimeValidated, false);
    assert.deepEqual(inspection.privateObjectIds, [26176, 26222]);
    const dimensionsWorld = [10, 1, 10];
    const { buffer, manifest } = cloneActor(input, { ...request, dimensionsWorld });
    const after = parseIgz(buffer),
      actor = after.objects[manifest.clone.actorId],
      ci = after.objects[manifest.clone.collisionId];
    const params = after.objects[manifest.clone.parametersId],
      model = after.objects[26177];
    assert.equal(after.objects.length, 32669);
    assert.equal(after.objects.length, before.objects.length + 3);
    assert.equal(after.strings.length, before.strings.length + 1);
    assert.deepEqual(after.strings.slice(0, -1), before.strings);
    assert.equal(after.strings.at(-1), request.name);
    assert.equal(after.unresolvedFixupEntries.length, 0);
    assert.deepEqual([actor.index, ci.index, params.index], [32129, 32130, 32131]);
    assert.equal(actor.encoded, 3165360);
    assert.equal(after.u32(actor.offset + 0x70), 4);
    assert.equal(after.u64(actor.offset + 0xf8), 0n);
    assert.equal(after.u32(ci.offset + 0x30), 0x69);
    assert.equal(after.u64(ci.offset + 0x60), 0n);
    assert.equal(after.u64(params.offset + 0x10), 0n);
    assert.equal(after.u32(model.offset + 8), 2);
    assert.equal(REFCOUNT_MASK, 0x7ffff);
    for (const o of [actor, ci, params]) {
      assert.equal(after.u32(o.offset + 8), 1);
      assert.equal(
        after.pointerReferences.filter(
          (r) => r.targetOffset >= o.offset && r.targetOffset < o.offset + o.size,
        ).length,
        1,
      );
    }
    assert.deepEqual(
      after.summarizeObject(actor.index).pointerReferences.map((r) => [r.fieldOffset, r.targetObjectIndex]),
      [
        [0x120, ci.index],
        [0x158, model.index],
        [0x160, params.index],
      ],
    );
    assert.deepEqual(
      after.summarizeObject(actor.index).stringReferences.map((r) => [r.fieldOffset, r.value]),
      [[0x10, request.name]],
    );
    assert.deepEqual(
      after.pointerReferences.filter((r) => r.targetObjectIndex === model.index).map((r) => r.objectIndex),
      [26175, actor.index],
    );
    const root = after.objects[0],
      rootData = after.pointerReferencesByOffset.get(root.offset + 0x20).targetOffset;
    assert.equal(after.u32(root.offset + 0xc), 1460);
    assert.equal(after.pointerReferencesByOffset.get(rootData + 1459 * 8).targetObjectIndex, actor.index);
    assert.equal(after.u64(rootData + 1458 * 8), 0x800000000000014dn);
    assert.equal(Array.from(after.offsetTables.get('REXT').offsets).includes(rootData + 1458 * 8), true);
    assert.equal(after.pointerReferencesByOffset.has(rootData + 1458 * 8), false);
    // No original object changes except the declared ROOT header and shared-model count.
    const oldPool = before.descriptors[1],
      newPool = after.descriptors[1];
    const allowed = [...manifest.append.rootList.changes, manifest.sharedModelCountEdit].sort(
      (a, b) => a.encoded - b.encoded,
    );
    let cursor = 0;
    for (const span of allowed) {
      assert.deepEqual(
        buffer.subarray(newPool.offset + cursor, newPool.offset + span.encoded),
        input.subarray(oldPool.offset + cursor, oldPool.offset + span.encoded),
      );
      cursor = span.encoded + span.width;
    }
    assert.deepEqual(
      buffer.subarray(newPool.offset + cursor, newPool.offset + oldPool.dataSize),
      input.subarray(oldPool.offset + cursor, oldPool.offset + oldPool.dataSize),
    );
    assert.deepEqual(
      buffer.subarray(newPool.offset + newPool.dataSize),
      input.subarray(oldPool.offset + oldPool.dataSize),
    );
    // New private parameters match byte-for-byte. Actor/CI edits are only declared scalar/pointer spans.
    assert.deepEqual(
      buffer.subarray(params.offset, params.offset + params.size),
      input.subarray(before.objects[26222].offset, before.objects[26222].offset + params.size),
    );
    const changedActor = new Set([
      ...[8, 0x10, 0x40, 0x120, 0x160].flatMap((at, i) =>
        Array.from({ length: [4, 8, 12, 8, 8][i] }, (_, j) => at + j),
      ),
    ]);
    for (let i = 0; i < actor.size; i++)
      if (!changedActor.has(i))
        assert.equal(buffer[actor.offset + i], input[before.objects[26175].offset + i]);
    for (let i = 0; i < ci.size; i++)
      if (i < 0x4c || i >= 0x58) assert.equal(buffer[ci.offset + i], input[before.objects[26176].offset + i]);
    dimensionsWorld.forEach((n, i) =>
      assert.equal(buffer.readFloatLE(ci.offset + 0x4c + i * 4), Math.fround(n / FEET_TO_WORLD)),
    );
    assert.deepEqual(manifest.clone.position, request.position);
    assert.deepEqual(manifest.clone.dimensionsWorld, dimensionsWorld);
    assert.equal(manifest.verification.runtimeValidated, false);
    assert.equal(manifest.append.originalObjectIndicesShifted, 537);
    assert.equal(manifest.output.sha256, hash(buffer));
    assert.equal(manifest.output.size, buffer.length);
    const undoCount = Buffer.from(buffer);
    undoCount.writeUInt32LE(1, model.offset + 8);
    assert.equal(hash(undoCount), manifest.structuralAppendIntermediateSha256);
    assert.equal(manifest.append.output.sha256, manifest.structuralAppendIntermediateSha256);
    assert.equal(hash(input), SOURCE_SHA256);
    assert.equal(hash(fs.readFileSync(source)), SOURCE_SHA256);
    assert.equal(fs.statSync(source).mtimeMs, stat.mtimeMs);
  },
);

test(
  'pinned real arena: optional dimensions retain the template; duplicates and second-generation clones reject',
  { skip: !source },
  () => {
    const input = fs.readFileSync(source);
    for (const name of ['GarageDoor_4', 'garagedoor_4'])
      assert.throws(() => cloneActor(input, { ...request, name }), /already exists/);
    const { buffer, manifest } = cloneActor(input, { ...request, name: 'Structural_Test_Door_Unscaled' });
    const z = parseIgz(buffer),
      ci = z.objects[manifest.clone.collisionId],
      original = z.objects[26176];
    assert.deepEqual(
      buffer.subarray(ci.offset, ci.offset + ci.size),
      buffer.subarray(original.offset, original.offset + original.size),
    );
    assert.deepEqual(manifest.clone.dimensionsFeet, [35, 35, 3]);
    assert.throws(() => cloneActor(buffer, { ...request, name: 'Second_Clone' }), /exactly 91745564/);
    assert.throws(
      () => runRequest({ operation: 'build', path: source, output: source, ...request }),
      /must differ/,
    );
    assert.equal(hash(fs.readFileSync(source)), SOURCE_SHA256);
  },
);

test(
  'pinned real arena: occupied output, manifest and dangling symlink are never overwritten',
  { skip: !source },
  (t) => {
    const dir = temporary(t);
    for (const kind of ['output', 'manifest', 'symlink']) {
      const output = path.join(dir, `${kind}.bld`),
        sidecar = output + '.manifest.json';
      if (kind === 'output') fs.writeFileSync(output, 'retain output');
      if (kind === 'manifest') fs.writeFileSync(sidecar, 'retain manifest');
      if (kind === 'symlink') fs.symlinkSync(output + '.missing', output);
      assert.throws(() => runRequest({ operation: 'build', path: source, output, ...request }), /EEXIST/);
      if (kind === 'output') assert.equal(fs.readFileSync(output, 'utf8'), 'retain output');
      if (kind === 'manifest') {
        assert.equal(fs.readFileSync(sidecar, 'utf8'), 'retain manifest');
        assert.equal(fs.existsSync(output), false);
      }
      if (kind === 'symlink') {
        assert.equal(fs.lstatSync(output).isSymbolicLink(), true);
        assert.equal(fs.existsSync(output + '.missing'), false);
      }
    }
    assert.equal(hash(fs.readFileSync(source)), SOURCE_SHA256);
  },
);
