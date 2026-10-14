import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { makeIgz } from './fixtures/igz_fixture.mjs';
import { parseIgz } from '../tools/igz.mjs';
import { runRequest } from '../tools/level_builder.mjs';
import { buildRecipe } from '../tools/build_recipe.mjs';

function fixture(options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skylanders-builder-test-'));
  const source = path.join(dir, 'source.bld'),
    output = path.join(dir, 'edited.bld');
  const bytes = makeIgz(options);
  fs.writeFileSync(source, bytes);
  return { dir, source, output, bytes };
}
test('inspection and pagination only advertise exact verified layouts', () => {
  const f = fixture({ includeUnknown: true });
  const info = runRequest({ operation: 'inspect', path: f.source });
  assert.equal(info.editableObjectCount, 2);
  assert.equal(info.objectCount, 4);
  const list = runRequest({ operation: 'objects', path: f.source, type: 'tfbActorInfo', limit: 1 });
  assert.equal(list.total, 2);
  assert.equal(list.nextOffset, 1);
  assert.deepEqual(list.objects[0].position, [1.25, 2.5, -3.75]);
  const second = runRequest({ operation: 'objects', path: f.source, type: 'tfbActorInfo', offset: 1 });
  assert.equal(second.objects[0].name, 'Beta');
  assert.equal(second.nextOffset, null);
  const query = runRequest({ operation: 'objects', path: f.source, query: 'ALpHa' });
  assert.equal(query.total, 1);
  const unverified = runRequest({ operation: 'objects', path: f.source, type: 'UnknownPlacementFixture' });
  assert.equal(unverified.objects[0].editable, false);
});
test('position output reparses and changes only 12 allowed bytes; source and angles stay unchanged', () => {
  const f = fixture();
  const info = runRequest({ operation: 'inspect', path: f.source });
  const result = runRequest({
    operation: 'build',
    path: f.source,
    output: f.output,
    expectedSha256: info.sha256,
    edits: [{ objectId: 1, position: [123.123456789, -25, 36] }],
  });
  assert.equal(result.changedObjects, 1);
  assert.equal(result.runtimeTested, false);
  const output = fs.readFileSync(result.output),
    igz = parseIgz(output),
    start = igz.objects[1].offset + 0x40;
  assert.deepEqual(fs.readFileSync(f.source), f.bytes);
  assert.deepEqual(output.subarray(0, start), f.bytes.subarray(0, start));
  assert.deepEqual(output.subarray(start + 12), f.bytes.subarray(start + 12));
  assert.equal(output.readFloatLE(start), Math.fround(123.123456789));
  const manifest = JSON.parse(fs.readFileSync(result.manifest));
  assert.equal(manifest.verification.unchangedOutsideFields, true);
  assert.equal(manifest.verification.reparsed, true);
  assert.equal(manifest.source.sha256, info.sha256);
  assert.equal(manifest.output.sha256, createHash('sha256').update(output).digest('hex'));
});
test('all three verified classes are editable, same name with wrong size is not', () => {
  for (const type of ['AbstractPlacement', 'Placement', 'tfbActorInfo']) {
    const f = fixture({ objects: [{ type, name: 'Known', position: [0, 0, 0] }] });
    assert.equal(runRequest({ operation: 'inspect', path: f.source }).editableObjectCount, 1);
  }
  const f = fixture({ objects: [{ type: 'tfbActorInfo', size: 0x180, name: 'WrongSize' }] });
  assert.equal(runRequest({ operation: 'inspect', path: f.source }).editableObjectCount, 0);
});
test('invalid edits fail without producing files or changing input', () => {
  const edits = [
    [{ objectId: 0, position: [1, 2, 3] }],
    [{ objectId: 3, position: [1, 2, 3] }],
    [{ objectId: -1, position: [1, 2, 3] }],
    [{ objectId: 1, position: [1, 2] }],
    [{ objectId: 1, position: [NaN, 2, 3] }],
    [{ objectId: 1, position: [Infinity, 2, 3] }],
    [{ objectId: 1, position: [1000001, 2, 3] }],
    [{ objectId: 1, position: ['1', 2, 3] }],
    [{ objectId: 1, position: [1, 2, 3], rotation: [0, 0, 0] }],
    [
      { objectId: 1, position: [1, 2, 3] },
      { objectId: 1, position: [2, 3, 4] },
    ],
  ];
  for (const edit of edits) {
    const f = fixture({ includeUnknown: true });
    assert.throws(() => runRequest({ operation: 'build', path: f.source, output: f.output, edits: edit }));
    assert.equal(fs.existsSync(f.output), false);
    assert.equal(fs.existsSync(f.output + '.manifest.json'), false);
    assert.deepEqual(fs.readFileSync(f.source), f.bytes);
  }
});
test('existing output/manifest, aliases and symlink destinations are never overwritten', () => {
  for (const kind of ['output', 'manifest', 'symlink', 'source']) {
    const f = fixture();
    let output = f.output;
    if (kind === 'output') fs.writeFileSync(output, 'retain');
    if (kind === 'manifest') fs.writeFileSync(output + '.manifest.json', 'retain');
    if (kind === 'symlink') fs.symlinkSync(f.source, output);
    if (kind === 'source') output = f.source;
    assert.throws(() => runRequest({ operation: 'build', path: f.source, output, edits: [] }));
    assert.deepEqual(fs.readFileSync(f.source), f.bytes);
    if (kind === 'output') assert.equal(fs.readFileSync(output, 'utf8'), 'retain');
    if (kind === 'manifest') assert.equal(fs.readFileSync(output + '.manifest.json', 'utf8'), 'retain');
  }
});
test('stale hashes, invalid pagination and unsupported formats reject', () => {
  const f = fixture();
  assert.throws(
    () => runRequest({ operation: 'inspect', path: f.source, expectedSha256: '0'.repeat(64) }),
    /SHA-256/,
  );
  for (const limit of [0, 501, -1, 1.2, '1'])
    assert.throws(() => runRequest({ operation: 'objects', path: f.source, limit }));
  assert.throws(() => runRequest({ operation: 'objects', path: f.source, offset: -1 }));
  const invalid = Buffer.from(f.bytes);
  invalid.writeUInt32LE(10, 4);
  fs.writeFileSync(f.source, invalid);
  assert.throws(() => runRequest({ operation: 'inspect', path: f.source }), /Unsupported IGZ/);
});
test('no-op copy is byte-exact and keeps unresolved fixup diagnostics', () => {
  const f = fixture({ unresolvedRofs: true });
  const info = runRequest({ operation: 'inspect', path: f.source });
  assert.ok(info.unresolvedFixupCount > 0);
  const result = runRequest({ operation: 'build', path: f.source, output: f.output, edits: [] });
  assert.equal(result.changedObjects, 0);
  assert.equal(result.changedByteCount, 0);
  assert.deepEqual(fs.readFileSync(f.output), f.bytes);
});
test('scene returns all root placements and excludes nonspatial records from map', () => {
  const f = fixture({ includeUnknown: true });
  const scene = runRequest({ operation: 'scene', path: f.source });
  assert.equal(scene.objectCount, 2);
  assert.equal(scene.worldObjectCount, 2);
  assert.equal(scene.unresolvedParentCount, 0);
  assert.equal(scene.meshes.length, 0);
  assert.equal(scene.geometryIncluded, false);
  assert.deepEqual(scene.objects[0].worldPosition, [1.25, 2.5, -3.75]);
  assert.equal(scene.objects[0].worldEditable, true);
  assert.equal(scene.objects[0].representation, 'placement marker (proxy)');
  assert.equal(scene.objects[0].proxyReason, 'No serialized actor model');
  assert.equal(scene.actorGeometryCounts.renderedActors, 0);
  assert.equal(scene.actorGeometryCounts.proxies, 2);
  assert.equal(scene.actorGeometryProxies.length, 2);
  assert.ok(scene.warnings.some((w) => w.includes('Actor markers')));
  assert.throws(() => runRequest({ operation: 'scene', path: f.source, includeGeometry: 'true' }), /boolean/);
});
test('material diagnostics validate paging and isolate keys before returning any arrays', () => {
  const f = fixture();
  const r = runRequest({ operation: 'materials', path: f.source, limit: 2 });
  assert.equal(r.total, 0);
  assert.equal(r.gameFilesWritten, false);
  assert.equal(r.shaderMappingVerified, false);
  assert.throws(() => runRequest({ operation: 'materials', path: f.source, limit: 201 }), /limit/);
  assert.throws(() => runRequest({ operation: 'materials', path: f.source, textureImageId: 1 }), /requires/);
  assert.throws(
    () => runRequest({ operation: 'scene', path: f.source, previewMeshKey: 'geometry:999' }),
    /one decoded/,
  );
  assert.throws(() => runRequest({ operation: 'scene', path: f.source, uvChannel: 8 }), /uvChannel/);
});

// Optional local-asset integration. No proprietary bytes are embedded in this
// suite, and a clean source checkout skips this check when extraction is absent.
const challenge303 = 'research/arena_challenge_303_000/level.bld';
const arena303 = 'research/arena_mesh_303/level.bld';
test(
  'local arena scene preserves static geometry and instantiates only supported actor models',
  { skip: !fs.existsSync(challenge303) || !fs.existsSync(arena303) },
  () => {
    const fileHash = (filename) => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    const beforeHashes = [fileHash(challenge303), fileHash(arena303)];
    const scene = runRequest({
      operation: 'scene',
      path: challenge303,
      geometryPath: arena303,
      includeGeometry: true,
    });
    assert.deepEqual(scene.geometryCounts, {
      worlds: 3,
      drawables: 77,
      meshes: 77,
      vertices: 78066,
      triangles: 89758,
    });
    assert.equal(scene.actorGeometryCounts.renderedActors, 74);
    assert.equal(scene.actorGeometryCounts.instantiatedMeshes, 107);
    const staticMeshes = scene.meshes.filter((m) => m.actorId === undefined),
      props = scene.meshes.filter((m) => m.actorId !== undefined);
    assert.equal(staticMeshes.length, 77);
    assert.ok(staticMeshes.every((m) => m.editable === false));
    assert.equal(props.length, 107);
    assert.ok(props.every((m) => m.editable === true));
    assert.equal(new Set(scene.meshes.map((m) => m.selectionKey)).size, scene.meshes.length);
    const door = scene.objects.find((o) => o.name === 'GarageDoor_1');
    assert.equal(door.representation, 'decoded simple actor model');
    assert.deepEqual(door.meshSelectionKeys, ['actor:26060:mesh:26068', 'actor:26060:mesh:26087']);
    for (const mesh of props.filter((m) => m.actorId === door.id)) {
      assert.deepEqual(mesh.actorBasePosition, door.position);
      assert.deepEqual(
        mesh.bounds.min,
        mesh.localBounds.min.map((v, i) => v + door.position[i]),
      );
      assert.deepEqual(
        mesh.bounds.max,
        mesh.localBounds.max.map((v, i) => v + door.position[i]),
      );
    }
    const ramp = scene.objects.find((o) => o.name === 'LaunchPad_Ramp');
    assert.equal(ramp.representation, 'placement marker (proxy)');
    assert.match(ramp.proxyReason, /unverified mixed\/baked coordinates/);
    assert.equal(
      props.some((m) => m.actorId === ramp.id),
      false,
    );
    for (const name of [
      'RocketHatch_Dummy',
      'Door_Right_large',
      'RocketHatch_1',
      'RocketHatch_2',
      'RocketHatch_3',
      'RocketHatch_4',
    ]) {
      const actor = scene.objects.find((o) => o.name === name);
      assert.equal(actor.representation, 'decoded simple actor model');
      assert.match(actor.transformEvidence, /native-verified.*Y rotation/);
      for (const mesh of props.filter((m) => m.actorId === actor.id)) {
        for (let i = 0; i < mesh.positions.length; i++) {
          assert.ok(
            mesh.positions[i] >= mesh.bounds.min[i % 3] && mesh.positions[i] <= mesh.bounds.max[i % 3],
          );
        }
      }
    }
    for (const name of [
      'Enemy_S4_FuturePirate_Gun',
      'Enemy_S4_HealingMage_Staff',
      'Enemy_S4_PhaseJumper_Executioner_Weapon',
      'DeathBomb',
      'TimeLimit_Bomb',
      ...Array.from({ length: 10 }, (_, i) => `number actor ${i}`),
    ]) {
      const actor = scene.objects.find((o) => o.name === name);
      assert.equal(actor.representation, 'decoded simple actor model');
      assert.ok(props.some((mesh) => mesh.actorId === actor.id));
    }
    const warp = scene.objects.find((o) => o.name === 'Enemy_S4_HealingMage_Warp');
    assert.equal(warp.representation, 'placement marker (proxy)');
    assert.match(warp.proxyReason, /non-Y rotation/);
    const flag = scene.objects.find((o) => o.name === 'FlagDefense_FlagTip');
    assert.equal(flag.representation, 'decoded actor model (time-zero hierarchy preview)');
    assert.deepEqual(flag.pose, {
      kind: 'entity-hierarchy-time-zero',
      timeSeconds: 0,
      runtimeAnimation: false,
      source3Ids: [32129, 32130],
    });
    const flagMeshes = props.filter((m) => m.actorId === flag.id);
    assert.equal(flagMeshes.length, 3);
    assert.deepEqual(
      flagMeshes.map((m) => m.source.entityIndex),
      [1, 2, 0],
    );
    assert.ok(flagMeshes.every((m) => m.coordinateSpace.includes('explicit t=0')));
    assert.equal(flagMeshes[0].source.entityModelMatrix[2], -0.0027281634975224733);
    assert.equal(flagMeshes[1].source.entityModelMatrix[2], 0.0027281634975224733);
    assert.equal(flagMeshes[2].source.entityModelMatrix[13], -8.265833854675293);
    assert.equal(scene.actorGeometryProxies.length, 129);
    assert.deepEqual(scene.contentBounds, {
      min: [-478.0484619140625, -84.07365417480469, -113.6871566772461],
      max: [-375.6129455566406, 53.15470504760742, -9.011222839355469],
    });
    assert.deepEqual([fileHash(challenge303), fileHash(arena303)], beforeHashes);
  },
);
test('CLI returns exactly one JSON error/result', () => {
  const f = fixture();
  for (const input of ['not json', JSON.stringify({ operation: 'inspect', path: f.source })]) {
    const child = spawnSync(process.execPath, ['tools/level_builder.mjs'], { input, encoding: 'utf8' });
    const result = JSON.parse(child.stdout);
    assert.equal(child.stderr, '');
    assert.equal(child.stdout.trim().split('\n').length, 1);
    if (input === 'not json') {
      assert.equal(child.status, 1);
      assert.ok(result.error.message);
    } else {
      assert.equal(child.status, 0);
      assert.equal(result.editableObjectCount, 2);
    }
  }
});
test('recipes pin the input hash and require unique named selectors', () => {
  const f = fixture(),
    recipePath = path.join(f.dir, 'recipe.json');
  const info = runRequest({ operation: 'inspect', path: f.source });
  const recipe = {
    format: 'skylanders-position-recipe',
    version: 1,
    name: 'synthetic',
    sourceSha256: info.sha256,
    edits: [{ type: 'tfbActorInfo', name: 'Beta', position: [5, 6, 7] }],
  };
  fs.writeFileSync(recipePath, JSON.stringify(recipe));
  assert.equal(buildRecipe(recipePath, f.source, f.output).changedObjects, 1);
  recipe.sourceSha256 = '0'.repeat(64);
  fs.writeFileSync(recipePath, JSON.stringify(recipe));
  assert.throws(() => buildRecipe(recipePath, f.source, f.output + '.other'), /different source/);
  recipe.sourceSha256 = info.sha256;
  recipe.edits[0].name = 'Absent';
  fs.writeFileSync(recipePath, JSON.stringify(recipe));
  assert.throws(() => buildRecipe(recipePath, f.source, f.output + '.other'), /exactly one/);
});
