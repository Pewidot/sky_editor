import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadGeometry,
  loadActorGeometry,
  initialRootYawMatrix,
  source3QuaternionAtZero,
} from '../tools/igz_geometry.mjs';
import { instantiateActorMeshes } from '../tools/level_builder.mjs';

// Test double for parseIgz's already-validated graph API, backed by binary
// fields at their actual PS4 offsets. The IGZ container codec is tested in
// igz.test.mjs; these tests isolate geometry interpretation and bounds checks.
function makeGeometryGraph({ sky = false } = {}) {
  const buffer = Buffer.alloc(0x4000);
  const definitions = [
    ['tfbPhysicsWorld', 0x70],
    ['tfbWorldEntityInfo', 0x38],
    ['DrawableList', 0x28],
    ['Drawable', 0x30],
    ['igGeometryAttr', 0x48],
    ['igVertexBuffer', 0x58],
    ['igIndexBuffer', 0x50],
    ['igVertexFormat', 0x80],
  ];
  const objects = definitions.map(([type, size], index) => ({
    type,
    size,
    index,
    offset: (index + 1) * 0x100,
  }));
  const objectsByOffset = new Map(objects.map((o) => [o.offset, o]));
  const pointers = new Map();
  function ptr(offset, targetOffset) {
    buffer.writeUInt32LE(targetOffset, offset);
    pointers.set(offset, { offset, targetOffset, encoded: targetOffset });
  }
  const [world, info, list, draw, geom, vb, ib, fmt] = objects;
  ptr(world.offset + 0x50, info.offset);
  ptr(info.offset + 0x28, list.offset);
  buffer.writeUInt32LE(1, list.offset + 0xc);
  buffer.writeUInt32LE(1, list.offset + 0x10);
  buffer.writeUInt32LE(8, list.offset + 0x18);
  ptr(list.offset + 0x20, 0x900);
  ptr(0x900, draw.offset);
  ptr(draw.offset + 0x18, geom.offset);
  buffer.writeUInt16LE(0xffff, draw.offset + 0x2a);
  ptr(geom.offset + 0x18, vb.offset);
  ptr(geom.offset + 0x20, ib.offset);
  ptr(vb.offset + 0x28, fmt.offset);
  buffer.writeUInt32LE(3, vb.offset + 0xc);
  buffer.writeUInt32LE(3, ib.offset + 0xc);
  for (const [b, at] of [
    [vb, 0x980],
    [ib, 0x984],
  ]) {
    buffer.writeUInt32LE(4, b.offset + 0x10);
    ptr(b.offset + 0x18, at);
    buffer.writeUInt32LE(3, at);
  }
  buffer.writeUInt32LE(3, vb.offset + 0x30);
  buffer.writeUInt32LE(3, ib.offset + 0x30);
  buffer.writeUInt32LE(16, fmt.offset + 0xc);
  buffer.writeUInt32LE(24, fmt.offset + 0x10);
  ptr(fmt.offset + 0x18, 0xa00);
  buffer[0xa00] = 2;
  buffer.writeUInt16LE(4, 0xa08);
  buffer[0xa0c] = 44;
  // Poison the unused four bytes before each position: taking xyz from byte
  // zero instead of the declared position element will fail the expected mesh.
  [
    [0, 0, 0],
    [2, 0, 0],
    [0, 0, 3],
  ].forEach((xyz, i) => {
    buffer.writeFloatLE(9999, 0xb00 + i * 16);
    xyz.forEach((n, axis) => buffer.writeFloatLE(n, 0xb04 + i * 16 + axis * 4));
  });
  [0, 1, 2].forEach((n, i) => buffer.writeUInt16LE(n, 0xc00 + i * 2));
  buffer.writeUInt32LE(48, 0xd00);
  buffer.writeUInt32LE(0xb00, 0xd08);
  buffer.writeUInt32LE(8, 0xd10);
  buffer.writeUInt32LE(0xc00, 0xd18);
  return {
    buffer,
    objects,
    objectsByOffset,
    pointerReferencesByOffset: pointers,
    tmhnReferences: [
      { offset: vb.offset + 0x20, tableIndex: 0 },
      { offset: ib.offset + 0x20, tableIndex: 1 },
    ],
    stringReferencesByOffset: new Map([
      [world.offset + 0x10, { value: sky ? 'Levels/_SKY/SKY_test.ma' : 'Levels/TestArena.ma' }],
    ]),
    fixupMap: new Map([['TMHN', { count: 2, dataOffset: 0xd00, end: 0xd20 }]]),
    u32: (offset) => buffer.readUInt32LE(offset),
    resolvePointer(encoded, length = 1) {
      assert.ok(
        Number.isSafeInteger(encoded) && encoded >= 0 && encoded + length <= buffer.length,
        'Fixture pointer exceeds pool',
      );
      return { offset: encoded, encoded, section: 1, relative: encoded };
    },
  };
}

function makeActorGraph({ duplicateActor = false } = {}) {
  const z = makeGeometryGraph();
  z.buffer.writeUInt16LE(0xffff, 0x400 + 0x28);
  const ptr = (offset, targetOffset) => {
    z.buffer.writeUInt32LE(targetOffset, offset);
    z.pointerReferencesByOffset.set(offset, { offset, targetOffset, encoded: targetOffset });
  };
  function object(type, size, offset) {
    const result = { type, size, offset, index: z.objects.length };
    z.objects.push(result);
    z.objectsByOffset.set(offset, result);
    return result;
  }
  const actor = object('tfbActorInfo', 0x170, 0xe00),
    model = object('tfbPhysicsModel', 0x70, 0x1100);
  const body = object('tfbPhysicsBody', 0x70, 0x1200),
    group = object('igGroup', 0x40, 0x1300);
  const info = object('tfbBodyEntityInfo', 0x50, 0x1400),
    entities = object('EntityList', 0x28, 0x1500);
  ptr(actor.offset + 0x158, model.offset);
  ptr(model.offset + 0x28, body.offset);
  ptr(body.offset + 0x40, group.offset);
  ptr(body.offset + 0x60, info.offset);
  ptr(info.offset + 0x28, 0x300);
  ptr(info.offset + 0x30, entities.offset);
  z.stringReferencesByOffset.set(actor.offset + 0x10, { value: 'Test prop' });
  z.stringReferencesByOffset.set(model.offset + 0x10, { value: 'Test prop.mdl' });
  [10, 20, 30].forEach((v, i) => z.buffer.writeFloatLE(v, actor.offset + 0x40 + i * 4));
  [100, 100, 100].forEach((v, i) => z.buffer.writeFloatLE(v, actor.offset + 0x114 + i * 4));
  z.specialRelocationsByOffset = new Map();
  if (duplicateActor) {
    const second = object('tfbActorInfo', 0x170, 0x1600);
    z.buffer.copy(z.buffer, second.offset, actor.offset, actor.offset + actor.size);
    ptr(second.offset + 0x158, model.offset);
    z.stringReferencesByOffset.set(second.offset + 0x10, { value: 'Second prop' });
    z.buffer.writeFloatLE(15, second.offset + 0x40);
  }
  return z;
}

function addSocketDefinition(z) {
  const ptr = (offset, targetOffset) => {
    z.buffer.writeUInt32LE(targetOffset, offset);
    z.pointerReferencesByOffset.set(offset, { offset, targetOffset, encoded: targetOffset });
  };
  const list = { type: 'BoneAttachInfoList', size: 0x28, offset: 0x1800, index: z.objects.length };
  const socket = { type: 'BoneAttachInfo', size: 0x60, offset: 0x1900, index: z.objects.length + 1 };
  for (const o of [list, socket]) {
    z.objects.push(o);
    z.objectsByOffset.set(o.offset, o);
  }
  ptr(0x1100 + 0x50, list.offset);
  ptr(list.offset + 0x20, 0x1a00);
  ptr(0x1a00, socket.offset);
  z.buffer.writeUInt32LE(1, list.offset + 0xc);
  z.buffer.writeUInt32LE(1, list.offset + 0x10);
  z.buffer.writeUInt32LE(8, list.offset + 0x18);
  z.buffer.writeInt16LE(-1, socket.offset + 0x40);
  z.buffer.writeUInt32LE(17, socket.offset + 0x38);
  z.stringReferencesByOffset.set(socket.offset + 0x38, { value: '*root*' });
  z.stringReferencesByOffset.set(socket.offset + 0x10, { value: 'test muzzle' });
  [5, 6, 7, 10, 20, 30].forEach((v, i) => z.buffer.writeFloatLE(v, socket.offset + 0x44 + i * 4));
  return z;
}

function addEntityHierarchy(z, { source3 = false } = {}) {
  const ptr = (offset, targetOffset) => {
    z.buffer.writeUInt32LE(targetOffset, offset);
    z.pointerReferencesByOffset.set(offset, { offset, targetOffset, encoded: targetOffset });
  };
  const object = (type, size, offset) => {
    const o = { type, size, offset, index: z.objects.length };
    z.objects.push(o);
    z.objectsByOffset.set(offset, o);
    return o;
  };
  const root = object('Entity', 0x20, 0x1800),
    child = object('Entity', 0x20, 0x1900);
  const rootTransform = object('igTransform', 0xa0, 0x1b00),
    childTransform = object('igTransform', 0xa0, 0x1c00);
  ptr(0x1500 + 0x20, 0x1a00);
  ptr(0x1a00, root.offset);
  ptr(0x1a08, child.offset);
  z.buffer.writeUInt32LE(2, 0x1500 + 0xc);
  z.buffer.writeUInt32LE(2, 0x1500 + 0x10);
  z.buffer.writeUInt32LE(16, 0x1500 + 0x18);
  ptr(root.offset + 0x10, rootTransform.offset);
  ptr(child.offset + 0x10, childTransform.offset);
  z.buffer.writeUInt16LE(0xffff, root.offset + 0x1c);
  z.buffer.writeUInt16LE(0, child.offset + 0x1c);
  z.buffer.writeUInt16LE(1, 0x400 + 0x28);
  for (const [o, matrix] of [
    [rootTransform, initialRootYawMatrix([2, 3, 4], [0, 90, 0], [100, 100, 100])],
    [childTransform, initialRootYawMatrix([5, 0, 0], [0, 0, 0], [100, 100, 100])],
  ])
    matrix.forEach((v, i) => z.buffer.writeFloatLE(v, o.offset + 0x40 + i * 4));
  if (source3) {
    const source = object('igTransformSource3', 0x70, 0x1d00);
    ptr(childTransform.offset + 0x90, source.offset);
    z.buffer.writeUInt32LE(12, source.offset + 0xc);
    for (const [field, count, flags, data] of [
      [0x10, 24, 0x90000000, 0x1e00],
      [0x28, 2, 0x80000000, 0x1f00],
    ]) {
      z.buffer.writeUInt32LE(count, source.offset + field);
      z.buffer.writeUInt32LE(count * 4, source.offset + field + 8);
      z.buffer.writeUInt32LE(flags, source.offset + field + 12);
      ptr(source.offset + field + 0x10, data);
    }
    z.buffer.writeFloatLE(1, 0x1f04);
    z.buffer.writeFloatLE(1, source.offset + 0x40);
    z.buffer.writeUInt32LE(11, source.offset + 0x48);
    Buffer.from([4, 0, 7, 1, 3, 1]).copy(z.buffer, source.offset + 0x4c);
    [10, 20, 30].forEach((v, i) => z.buffer.writeFloatLE(v, source.offset + 0x60 + i * 4));
    [
      [0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0],
      [0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0],
    ]
      .flat()
      .forEach((v, i) => z.buffer.writeFloatLE(v, 0x1e00 + i * 4));
  }
  return z;
}

test('exports a static indexed triangle using the declared position element offset', () => {
  const fixture = makeGeometryGraph(),
    original = Buffer.from(fixture.buffer);
  const result = loadGeometry(fixture);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.counts, { worlds: 1, drawables: 1, meshes: 1, vertices: 3, triangles: 1 });
  assert.deepEqual(result.meshes[0].positions, [0, 0, 0, 2, 0, 0, 0, 0, 3]);
  assert.deepEqual(result.meshes[0].indices, [0, 1, 2]);
  assert.deepEqual(result.bounds, { min: [0, 0, 0], max: [2, 0, 3] });
  assert.deepEqual(result.contentBounds, result.bounds);
  assert.equal(result.meshes[0].source.positionOffset, 4);
  assert.deepEqual(fixture.buffer, original);
});

test('rejects stale stream counts after a scalar-only buffer resize', () => {
  for (const at of [0x980, 0x984]) {
    const z = makeGeometryGraph();
    z.buffer.writeUInt32LE(2, at);
    const result = loadGeometry(z);
    assert.equal(result.meshes.length, 0);
    assert.match(result.warnings.join('\n'), /scalar and stream counts disagree/);
  }
});

test('keeps sky geometry separate from the playable-scene framing bounds', () => {
  const result = loadGeometry(makeGeometryGraph({ sky: true }));
  assert.equal(result.meshes[0].sky, true);
  assert.equal(result.contentBounds, null);
  assert.ok(result.bounds);
});

test('unsupported topology, subsets, skinning and vertex formats produce explicit warnings', () => {
  for (const [mutate, pattern] of [
    [(z) => z.buffer.writeUInt32LE(4, 0x700 + 0x30), /triangle-list/],
    [(z) => z.buffer.writeUInt32LE(1, 0x500 + 0x2c), /draw subsets/],
    [(z) => z.buffer.writeUInt16LE(0, 0x400 + 0x2a), /Skinned/],
    [
      (z) => {
        z.buffer[0xa00] = 1;
      },
      /non-float3/,
    ],
    [
      (z) => {
        z.buffer[0xa01] = 1;
      },
      /multistream/,
    ],
  ]) {
    const z = makeGeometryGraph();
    mutate(z);
    const result = loadGeometry(z);
    assert.equal(result.meshes.length, 0);
    assert.match(result.warnings[0], pattern);
  }
});

test('rejects malformed indices, vertex spans and nonfinite coordinates', () => {
  for (const [mutate, pattern] of [
    [(z) => z.buffer.writeUInt16LE(3, 0xc00), /exceeds vertex count/],
    [(z) => z.buffer.writeUInt32LE(44, 0xd00), /count × stride/],
    [(z) => z.buffer.writeUInt32LE(4, 0xd10), /uint16 array/],
    [(z) => z.buffer.writeFloatLE(NaN, 0xb04), /nonfinite/],
    [(z) => z.buffer.writeUInt32LE(z.buffer.length, 0xd08), /exceeds pool/],
  ]) {
    const z = makeGeometryGraph();
    mutate(z);
    const result = loadGeometry(z);
    assert.equal(result.meshes.length, 0);
    assert.match(result.warnings[0], pattern);
  }
});

test('resource budgets and malformed list topology cannot trigger unbounded allocation', () => {
  const budget = loadGeometry(makeGeometryGraph(), { maxVertices: 2 });
  assert.equal(budget.meshes.length, 0);
  assert.match(budget.warnings[0], /excessive/);
  const z = makeGeometryGraph();
  z.buffer.writeUInt32LE(0xffffffff, 0x300 + 0xc);
  const list = loadGeometry(z);
  assert.equal(list.meshes.length, 0);
  assert.match(list.warnings[0], /count/);
  assert.throws(() => loadGeometry(makeGeometryGraph(), { maxVertices: Infinity }), /resource limits/);
});

test('a file with no static world graph does not expose actor template vertices as world geometry', () => {
  const z = makeGeometryGraph();
  z.objects = z.objects.filter((o) => o.type !== 'tfbPhysicsWorld');
  const result = loadGeometry(z);
  assert.equal(result.meshes.length, 0);
  assert.match(result.warnings[0], /No static/);
});

test('exports model-local geometry and a translation-only root actor matrix without modifying bytes', () => {
  const z = makeActorGraph(),
    original = Buffer.from(z.buffer),
    result = loadActorGeometry(z);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.proxies, []);
  assert.deepEqual(result.counts, {
    actorObjects: 1,
    modelLinkedActors: 1,
    uniqueModels: 1,
    decodedModels: 1,
    decodedActors: 1,
    worldReadyActors: 1,
    proxies: 0,
    meshes: 1,
    vertices: 3,
    triangles: 1,
  });
  assert.deepEqual(result.meshes[0].positions, [0, 0, 0, 2, 0, 0, 0, 0, 3]);
  assert.match(result.meshes[0].coordinateSpace, /model-local/);
  assert.equal(result.meshes[0].worldId, undefined);
  assert.equal(result.meshes[0].modelId, 9);
  assert.deepEqual(result.actors[0].worldMatrix, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]);
  assert.deepEqual(result.actors[0].meshIds, [3]);
  assert.deepEqual(result.models[0].meshIds, [3]);
  assert.deepEqual(z.buffer, original);
});

test('shared actor models are decoded once while retaining distinct actor transforms', () => {
  const result = loadActorGeometry(makeActorGraph({ duplicateActor: true }));
  assert.equal(result.counts.actorObjects, 2);
  assert.equal(result.counts.uniqueModels, 1);
  assert.equal(result.meshes.length, 1);
  assert.equal(result.actors.length, 2);
  assert.equal(result.actors[0].worldMatrix[12], 10);
  assert.equal(result.actors[1].worldMatrix[12], 15);
  assert.deepEqual(result.actors[0].meshIds, result.actors[1].meshIds);
});

test('animated, skinned, articulated and unsupported child/entity graphs remain explicit actor proxies', () => {
  for (const [offset, value, pattern] of [
    [0x1100 + 0x38, 1, /Animated/],
    [0x1100 + 0x40, 1, /state-driven/],
    [0x1100 + 0x50, 1, /no ordinary ROFS/],
    [0x1200 + 0x50, 1, /combiner/],
    [0x1200 + 0x58, 1, /viseme/],
    [0x1300 + 0x38, 1, /child hierarchy/],
    [0x1400 + 0x38, 1, /Skinned/],
    [0x1400 + 0x38, 2, /articulated/],
    [0x1400 + 0x48, 1, /Skinned/],
    [0x1500 + 0xc, 1, /EntityList count/],
  ]) {
    const z = makeActorGraph();
    z.buffer.writeUInt32LE(value, offset);
    const result = loadActorGeometry(z);
    assert.equal(result.meshes.length, 0);
    assert.equal(result.actors.length, 0);
    assert.match(result.proxies[0].reason, pattern);
    assert.equal(result.warnings.length, 1);
  }
  const z = makeActorGraph();
  z.buffer.writeUInt16LE(0, 0x400 + 0x28);
  assert.match(loadActorGeometry(z).proxies[0].reason, /unresolved entity transform/);
});

test('flat-model socket definitions do not transform or duplicate their owning mesh', () => {
  const z = addSocketDefinition(makeActorGraph()),
    original = Buffer.from(z.buffer);
  const local = loadActorGeometry(z);
  assert.deepEqual(local.proxies, []);
  assert.deepEqual(local.warnings, []);
  assert.equal(local.counts.worldReadyActors, 1);
  assert.equal(local.meshes.length, 1);
  assert.deepEqual(local.meshes[0].positions, [0, 0, 0, 2, 0, 0, 0, 0, 3]);
  assert.deepEqual(local.models[0].sockets, [
    {
      id: 15,
      name: 'test muzzle',
      boneName: '*root*',
      boneIndex: -1,
      exportsVisuals: false,
      attachmentType: 0,
      position: [5, 6, 7],
      rotationDegrees: [10, 20, 30],
      definitionOnly: true,
    },
  ]);
  const scene = instantiateActorMeshes(local, rootPlacements(local), { includeGeometry: true });
  assert.equal(scene.meshes.length, 1);
  assert.deepEqual(scene.meshes[0].positions, [10, 20, 30, 12, 20, 30, 10, 20, 33]);
  assert.deepEqual(z.buffer, original);
});

test('unsupported or malformed socket definitions cannot silently enable a model', () => {
  for (const [mutate, pattern] of [
    [(z) => z.buffer.writeInt16LE(0, 0x1900 + 0x40), /Bone-dependent/],
    [
      (z) => {
        z.buffer[0x1900 + 0x42] = 1;
      },
      /exported-visual/,
    ],
    [(z) => z.buffer.writeUInt32LE(2, 0x1900 + 0x5c), /special-type/],
    [(z) => z.buffer.writeFloatLE(NaN, 0x1900 + 0x44), /nonfinite/],
    [(z) => z.buffer.writeFloatLE(Infinity, 0x1900 + 0x58), /nonfinite/],
    [(z) => z.stringReferencesByOffset.delete(0x1900 + 0x38), /resolved string/],
    [(z) => z.pointerReferencesByOffset.delete(0x1a00), /lacks a relocation/],
    [(z) => z.buffer.writeUInt32LE(0xffffffff, 0x1800 + 0xc), /count\/capacity/],
    [(z) => z.buffer.writeUInt32LE(0, 0x1800 + 0x18), /byte span/],
    [
      (z) => {
        z.objectsByOffset.get(0x1900).size = 0x58;
      },
      /Expected BoneAttachInfo/,
    ],
    [
      (z) => {
        z.objectsByOffset.get(0x1800).type = 'UnknownList';
      },
      /Expected BoneAttachInfoList/,
    ],
  ]) {
    const z = addSocketDefinition(makeActorGraph());
    mutate(z);
    const result = loadActorGeometry(z);
    assert.equal(result.meshes.length, 0);
    assert.equal(result.actors.length, 0);
    assert.match(result.proxies[0].reason, pattern);
  }
});

test('an attached actor remains a proxy even when its model only has ordinary sockets', () => {
  for (const field of [0xa0, 0xa8]) {
    for (const mutate of [
      (z) => z.buffer.writeUInt32LE(1, 0xe00 + field),
      (z) => {
        z.offsetTables = new Map([['RNEX', { offsets: Uint32Array.from([0xe00 + field]) }]]);
      },
    ]) {
      const z = addSocketDefinition(makeActorGraph());
      mutate(z);
      const result = loadActorGeometry(z);
      assert.equal(result.meshes.length, 1);
      assert.equal(result.counts.worldReadyActors, 0);
      assert.equal(result.actors[0].worldMatrix, null);
      assert.match(result.proxies[0].reason, /attachment-relative/);
    }
  }
});

test('entity hierarchy composes parent * local once, using the Drawable entity index', () => {
  const z = addEntityHierarchy(makeActorGraph()),
    before = Buffer.from(z.buffer),
    g = loadActorGeometry(z);
  assert.deepEqual(g.proxies, []);
  assert.equal(g.meshes.length, 1);
  const mesh = g.meshes[0],
    expected = [2, 3, -1, 2, 3, -3, 5, 3, -1];
  mesh.positions.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-5));
  assert.equal(mesh.source.entityId, 15);
  assert.equal(mesh.source.transformId, 17);
  assert.equal(mesh.source.storedVerticesTransformed, true);
  assert.deepEqual(mesh.pose, {
    kind: 'entity-hierarchy-time-zero',
    timeSeconds: 0,
    runtimeAnimation: false,
    source3Ids: [],
  });
  assert.match(g.actors[0].transformStatus, /preview at t=0/);
  const scene = instantiateActorMeshes(g, rootPlacements(g), { includeGeometry: true });
  assert.match(scene.meshes[0].coordinateSpace, /explicit t=0/);
  scene.meshes[0].positions.forEach((v, i) =>
    assert.ok(Math.abs(v - (expected[i] + [10, 20, 30][i % 3])) < 1e-5),
  );
  assert.deepEqual(z.buffer, before);
});

test('Source3 mode3 time-zero quaternion retains the native polynomial endpoint residual', () => {
  const first = [0, 0, 0, 1];
  assert.deepEqual(source3QuaternionAtZero(first, first), first);
  assert.deepEqual(source3QuaternionAtZero(first, [0, 0, 0, -1]), first);
  // At dot=0, only the two literal constant terms survive at alpha=0.
  assert.deepEqual(source3QuaternionAtZero(first, [0, 1, 0, 0]), [
    0,
    Math.fround(-0.0013659476535394788),
    0,
    Math.fround(0.9986340403556824),
  ]);
  assert.deepEqual(
    source3QuaternionAtZero(first, [0, 1, 0, Math.fround(4.3711388e-8)]),
    [0, -0.001365947537124157, 0, 0.9986340403556824],
  );
  assert.deepEqual(
    source3QuaternionAtZero(first, [0, 1, 0, Math.fround(-4.3711388e-8)]),
    [0, 0.001365947537124157, 0, 0.9986340403556824],
  );
  for (const q of [
    [0, 0, 0, 0],
    [0, 0, 0, 2],
    [NaN, 0, 0, 1],
    [0, 1],
  ])
    assert.throws(() => source3QuaternionAtZero(first, q), /quaternion/);
});

test('Source3 time-zero output replaces stored _m and preserves the center before parent composition', () => {
  const z = addEntityHierarchy(makeActorGraph(), { source3: true }),
    before = Buffer.from(z.buffer);
  const g = loadActorGeometry(z),
    mesh = g.meshes[0];
  assert.deepEqual(g.proxies, []);
  assert.deepEqual(mesh.pose.source3Ids, [18]);
  assert.equal(mesh.source.source3Id, 18);
  const matrix = mesh.source.entityModelMatrix,
    center = [10, 20, 30];
  const transformed = [0, 1, 2].map(
    (i) => center[0] * matrix[i] + center[1] * matrix[4 + i] + center[2] * matrix[8 + i] + matrix[12 + i],
  );
  [32, 23, -6].forEach((value, i) => assert.ok(Math.abs(transformed[i] - value) < 1e-4));
  const full = instantiateActorMeshes(g, rootPlacements(g), { includeGeometry: true });
  const metadata = instantiateActorMeshes(g, rootPlacements(g));
  assert.deepEqual(full.meshes[0].bounds, metadata.meshes[0].bounds);
  assert.deepEqual(metadata.meshes[0].pose, mesh.pose);
  assert.equal('positions' in metadata.meshes[0], false);
  assert.deepEqual(z.buffer, before);
  z.buffer.writeFloatLE(12345, 0x1c00 + 0x70);
  assert.deepEqual(
    loadActorGeometry(z).meshes[0].positions,
    mesh.positions,
    'stored _m must not be multiplied by source output',
  );
});

test('invalid entity trees and unsupported Source3 variants remain proxies without partial geometry', () => {
  for (const [mutate, pattern] of [
    [(z) => z.buffer.writeUInt16LE(1, 0x1800 + 0x1c), /parent must precede/],
    [(z) => z.buffer.writeUInt16LE(1, 0x1900 + 0x1c), /cycles/],
    [(z) => z.buffer.writeUInt16LE(8, 0x1900 + 0x1c), /forward/],
    [(z) => z.buffer.writeUInt16LE(1, 0x1900 + 0x1e), /Articulated/],
    [(z) => z.buffer.writeUInt32LE(1025, 0x1500 + 0xc), /native preview limit/],
    [(z) => z.pointerReferencesByOffset.delete(0x1a08), /relocation/],
    [(z) => z.buffer.writeUInt16LE(2, 0x400 + 0x28), /unresolved entity/],
    [(z) => z.buffer.writeUInt32LE(1, 0x1c00 + 0x88), /Legacy/],
    [(z) => z.buffer.writeFloatLE(1, 0x1b00 + 0x4c), /nonaffine/],
    [(z) => z.buffer.writeFloatLE(NaN, 0x1b00 + 0x40), /nonfinite/],
    [(z) => z.buffer.writeUInt32LE(1, 0x1100 + 0x50), /Sockets on hierarchical/],
    [(z) => z.buffer.writeUInt32LE(0xffffffff, 0x1d00 + 0x28), /frame count/],
    [(z) => z.buffer.writeUInt32LE(11, 0x1d00 + 0xc), /stride/],
    [(z) => z.buffer.writeUInt32LE(8, 0x1d00 + 0x18), /memory span/],
    [(z) => z.buffer.writeUInt32LE(0, 0x1d00 + 0x34), /flags/],
    [(z) => z.buffer.writeFloatLE(0.5, 0x1f00), /start at zero/],
    [(z) => z.buffer.writeFloatLE(0, 0x1f04), /strictly increasing/],
    [(z) => z.buffer.writeFloatLE(2, 0x1f04), /within duration/],
    [(z) => z.buffer.writeFloatLE(1, 0x1d00 + 0x44), /zero time offset/],
    [(z) => z.buffer.writeUInt32LE(1, 0x1d00 + 0x54), /play mode/],
    [(z) => z.buffer.writeUInt32LE(7, 0x1d00 + 0x48), /channels/],
    [
      (z) => {
        z.buffer[0x1d00 + 0x50] = 1;
      },
      /interpolation/,
    ],
    [(z) => z.buffer.writeFloatLE(NaN, 0x1e00), /invalid data/],
    [(z) => z.buffer.writeFloatLE(2, 0x1e00 + 12), /quaternion/],
    [(z) => z.buffer.writeFloatLE(Infinity, 0x1d00 + 0x60), /center/],
  ]) {
    const z = addEntityHierarchy(makeActorGraph(), { source3: true });
    mutate(z);
    const g = loadActorGeometry(z);
    assert.equal(g.meshes.length, 0);
    assert.equal(g.actors.length, 0);
    assert.match(g.proxies[0].reason, pattern);
  }
});

test('non-Y rotation, scaling or parent-relative actors keep local meshes but get no world matrix', () => {
  for (const mutate of [
    (z) => z.buffer.writeFloatLE(90, 0xe00 + 0x4c),
    (z) => z.buffer.writeFloatLE(90, 0xe00 + 0x54),
    (z) => z.buffer.writeFloatLE(50, 0xe00 + 0x114),
    (z) => z.buffer.writeUInt32LE(1, 0xe00 + 0x80),
    (z) => z.specialRelocationsByOffset.set(0xe00 + 0x80, { runtimeAction: 'zero-and-initialize' }),
  ]) {
    const z = makeActorGraph();
    mutate(z);
    const result = loadActorGeometry(z);
    assert.equal(result.meshes.length, 1);
    assert.equal(result.actors[0].worldMatrix, null);
    assert.equal(result.counts.worldReadyActors, 0);
    assert.equal(result.proxies.length, 1);
  }
});

test('native pure-Y matrix preserves handedness, translation and default-scale boundary', () => {
  const matrix = initialRootYawMatrix([10, 20, 30], [0, 90, 0], [100, 100, 100]);
  assert.ok(Math.abs(matrix[0]) < 1e-6);
  assert.equal(matrix[2], -1);
  assert.equal(matrix[8], 1);
  assert.deepEqual(matrix.slice(12), [10, 20, 30, 1]);
  for (const [position, rotation, scale] of [
    [
      [NaN, 0, 0],
      [0, 0, 0],
      [100, 100, 100],
    ],
    [
      [0, 0, 0],
      [1, 0, 0],
      [100, 100, 100],
    ],
    [
      [0, 0, 0],
      [0, 0, 1],
      [100, 100, 100],
    ],
    [
      [0, 0, 0],
      [0, Infinity, 0],
      [100, 100, 100],
    ],
    [
      [0, 0, 0],
      [0, 90, 0],
      [100, 50, 100],
    ],
  ])
    assert.equal(initialRootYawMatrix(position, rotation, scale), null);
  const z = makeActorGraph();
  z.buffer.writeFloatLE(90, 0xe00 + 0x50);
  const original = Buffer.from(z.buffer),
    result = loadActorGeometry(z);
  assert.equal(result.counts.worldReadyActors, 1);
  assert.deepEqual(result.proxies, []);
  assert.deepEqual(result.actors[0].worldMatrix, matrix);
  assert.match(result.actors[0].transformStatus, /native-verified.*Y rotation/);
  assert.deepEqual(z.buffer, original);
});

test('known mixed/baked-coordinate ramp remains a proxy even with a proven Y transform', () => {
  const z = makeActorGraph();
  z.buffer.writeFloatLE(18, 0xe00 + 0x50);
  z.stringReferencesByOffset.set(0x1100 + 0x10, {
    value: 'C:/tfb/Content/Levels/Level_303/models/303_retracting_ledge.mdl',
  });
  const result = loadActorGeometry(z);
  assert.equal(result.meshes.length, 1, 'local bytes remain inspectable');
  assert.equal(result.actors[0].worldMatrix, null);
  assert.match(result.proxies[0].reason, /unverified mixed\/baked coordinates/);
  assert.match(result.models[0].modelSpaceLimitation, /runtime validation/);
});

test('missing, unresolved and malformed actor model references are never invented', () => {
  const missing = makeActorGraph();
  missing.buffer.writeBigUInt64LE(0n, 0xe00 + 0x158);
  missing.pointerReferencesByOffset.delete(0xe00 + 0x158);
  assert.match(loadActorGeometry(missing).proxies[0].reason, /No serialized/);
  const unresolved = makeActorGraph();
  unresolved.pointerReferencesByOffset.delete(0xe00 + 0x158);
  assert.match(loadActorGeometry(unresolved).proxies[0].reason, /no ordinary ROFS/);
  for (const magic of ['RNEX', 'REXT', 'RPID', 'RHND']) {
    const external = makeActorGraph();
    external.buffer.writeBigUInt64LE(0n, 0xe00 + 0x158);
    external.pointerReferencesByOffset.delete(0xe00 + 0x158);
    external.offsetTables = new Map([[magic, { offsets: Uint32Array.from([0xe00 + 0x158]) }]]);
    assert.match(
      loadActorGeometry(external).proxies[0].reason,
      /no ordinary ROFS/,
      'external index zero is not a null model',
    );
  }
  const malformed = makeActorGraph();
  malformed.buffer.writeFloatLE(NaN, 0xe00 + 0x40);
  assert.equal(loadActorGeometry(malformed).actors.length, 0);
  assert.match(loadActorGeometry(malformed).proxies[0].reason, /nonfinite/);
  const bounded = loadActorGeometry(makeActorGraph(), { maxVertices: 2 });
  assert.equal(bounded.meshes.length, 0);
  assert.match(bounded.proxies[0].reason, /excessive/);
});

function rootPlacements(geometry) {
  return geometry.actors.map((a) => ({
    id: a.id,
    type: 'tfbActorInfo',
    editable: true,
    worldEditable: true,
    position: [...a.position],
    worldPosition: [...a.position],
    rotationDegrees: [...a.rotationDegrees],
  }));
}

test('scene actor instances transform positions and bounds once, with unique actor selection keys', () => {
  const local = loadActorGeometry(makeActorGraph({ duplicateActor: true }));
  const before = JSON.stringify(local),
    result = instantiateActorMeshes(local, rootPlacements(local), { includeGeometry: true });
  assert.deepEqual(result.proxies, []);
  assert.equal(result.meshes.length, 2);
  assert.equal(result.counts.renderedActors, 2);
  assert.equal(result.counts.instantiatedMeshes, 2);
  assert.equal(result.counts.instantiatedVertices, 6);
  assert.deepEqual(result.meshes[0].positions, [10, 20, 30, 12, 20, 30, 10, 20, 33]);
  assert.deepEqual(result.meshes[1].positions, [15, 20, 30, 17, 20, 30, 15, 20, 33]);
  assert.deepEqual(result.meshes[0].bounds, { min: [10, 20, 30], max: [12, 20, 33] });
  assert.deepEqual(result.meshes[0].localBounds, { min: [0, 0, 0], max: [2, 0, 3] });
  assert.deepEqual(result.meshes[0].actorBasePosition, [10, 20, 30]);
  assert.equal(result.meshes[0].actorId, 8);
  assert.equal(result.meshes[0].editable, true);
  assert.equal(result.meshes[0].selectionKey, 'actor:8:mesh:3');
  assert.equal(result.meshes[1].selectionKey, 'actor:14:mesh:3');
  assert.equal(JSON.stringify(local), before);
});

test('metadata-only scenes retain actor links and world bounds without vertex/index arrays', () => {
  const local = loadActorGeometry(makeActorGraph());
  const result = instantiateActorMeshes(local, rootPlacements(local));
  assert.equal(result.meshes.length, 1);
  assert.equal('positions' in result.meshes[0], false);
  assert.equal('indices' in result.meshes[0], false);
  assert.deepEqual(result.meshes[0].bounds, { min: [10, 20, 30], max: [12, 20, 33] });
});

test('Y-rotated scene vertices and exact bounds agree in full and metadata-only modes', () => {
  const z = makeActorGraph();
  z.buffer.writeFloatLE(270, 0xe00 + 0x50);
  const local = loadActorGeometry(z),
    before = JSON.stringify(local);
  const full = instantiateActorMeshes(local, rootPlacements(local), { includeGeometry: true });
  const metadata = instantiateActorMeshes(local, rootPlacements(local));
  assert.equal(full.counts.renderedActors, 1);
  assert.deepEqual(full.proxies, []);
  const expected = [10, 20, 30, 10, 20, 32, 7, 20, 30];
  full.meshes[0].positions.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-5));
  assert.deepEqual(full.meshes[0].bounds, metadata.meshes[0].bounds);
  assert.equal(full.meshes[0].bounds.min[0], 7);
  assert.equal(full.meshes[0].bounds.max[2], 32);
  for (let i = 0; i < full.meshes[0].positions.length; i++) {
    const value = full.meshes[0].positions[i],
      axis = i % 3;
    assert.ok(value >= full.meshes[0].bounds.min[axis] && value <= full.meshes[0].bounds.max[axis]);
  }
  assert.equal('positions' in metadata.meshes[0], false);
  assert.equal(JSON.stringify(local), before);
});

test('scene instancing requires a matching editable root and never exposes unsupported local geometry', () => {
  for (const mutate of [
    (local, placements) => {
      placements[0].worldEditable = false;
    },
    (local, placements) => {
      placements[0].editable = false;
    },
    (local, placements) => {
      placements[0].type = 'UnknownPlacement';
    },
    (local, placements) => {
      placements[0].position[0] = 999;
    },
    (local, placements) => {
      placements[0].rotationDegrees[1] = 90;
    },
    (local) => {
      local.actors[0].worldMatrix[0] = 2;
    },
    (local) => {
      local.actors[0].meshIds = [999];
    },
  ]) {
    const local = loadActorGeometry(makeActorGraph()),
      placements = rootPlacements(local);
    mutate(local, placements);
    const result = instantiateActorMeshes(local, placements, { includeGeometry: true });
    assert.equal(result.meshes.length, 0);
    assert.equal(result.proxies.length, 1);
  }
  const z = makeActorGraph();
  z.buffer.writeFloatLE(90, 0xe00 + 0x4c);
  const local = loadActorGeometry(z);
  assert.equal(
    instantiateActorMeshes(local, rootPlacements(local), { includeGeometry: true }).meshes.length,
    0,
  );
});

test('actor instancing budgets account for duplicates and reject whole actors without partial meshes', () => {
  const local = loadActorGeometry(makeActorGraph({ duplicateActor: true }));
  const result = instantiateActorMeshes(local, rootPlacements(local), {
    includeGeometry: true,
    maxVertices: 3,
  });
  assert.equal(result.meshes.length, 1);
  assert.equal(result.counts.renderedActors, 1);
  assert.equal(result.proxies.length, 1);
  assert.match(result.proxies[0].reason, /resource limits/);
  assert.throws(
    () => instantiateActorMeshes(local, rootPlacements(local), { maxIndices: Infinity }),
    /resource limits/,
  );
});
