import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { cubeGlb } from './fixtures/glb.mjs';
import { importGlb } from '../tools/glb_import.mjs';
import { buildAuthoredScene } from '../tools/authored_scene.mjs';
import {
  transformedBoxCorners,
  transformPoint,
  rebasePoint,
  rebaseNormal,
} from '../tools/object_transform.mjs';
import { buildNativeDemo } from '../tools/native_demo_builder.mjs';
import { parseIgz } from '../tools/igz.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-5, `${a} != ${b}`));
test('embedded PNG and UVs decode without URI access', () => {
  const chunk = (type, data) => {
    const b = Buffer.alloc(data.length + 12);
    b.writeUInt32BE(data.length);
    b.write(type, 4);
    data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, -4)), b.length - 4);
    return b;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk(
      'IDAT',
      deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255])),
    ),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const { document } = importGlb(cubeGlb({ texture: png }));
  assert.equal(document.textures[0].width, 2);
  assert.equal(document.textures[0].height, 2);
  assert.equal(document.meshes[0].uvs.length, 16);
  const rgba = Buffer.from(document.textures[0].rgbaBase64, 'base64');
  assert.equal(rgba[0] > 0, true);
  assert.equal(rgba[1], 0);
  assert.equal(rgba[4], 0);
  assert.equal(rgba[5] > 0, true);
  const alphaPng = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk(
      'IDAT',
      deflateSync(Buffer.from([0, 255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255])),
    ),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  for (const mode of ['BLEND', 'MASK']) {
    const bytes = cubeGlb({
      texture: alphaPng,
      mutate: (g) => {
        g.materials[0].alphaMode = mode;
      },
    });
    const converted = importGlb(bytes);
    assert.equal(converted.materialConversions.length, 1);
    assert.equal(Buffer.from(converted.document.textures[0].rgbaBase64, 'base64')[3], 255);
    assert.throws(() => importGlb(bytes, { alphaPolicy: 'reject' }), /transparency requires/);
  }
});
test('GLB yields editable textured geometry and automatic collision, without modifying input', () => {
  const bytes = cubeGlb(),
    hash = sha(bytes),
    { document } = importGlb(bytes);
  assert.equal(sha(bytes), hash);
  assert.equal(document.meshes[0].indices.length, 36);
  assert.equal(document.textures.length, 1);
  assert.deepEqual(document.objects[0].collision.dimensions, [2, 2, 2]);
  assert.equal(document.nativeRecipe, 'cusa00697-static-workshop-v1');
  const second = importGlb(bytes, { base: document }).document;
  assert.equal(second.objects.length, 2);
  assert.equal(second.objects[1].id, 2);
  assert.equal(document.objects.length, 1);
});
test('reject unsupported/broken GLB rather than silently losing critical geometry', () => {
  for (const mutate of [
    (g) => (g.asset.version = '1.0'),
    (g) => (g.buffers[0].uri = 'https://example.com/a'),
    (g) => (g.animations = [{}]),
    (g) => (g.nodes[0].children = [0]),
    (g) => (g.accessors[0].count = 999999999),
    (g) => (g.accessors[0].byteOffset = 999999),
    (g) => (g.meshes[0].primitives[0].mode = 1),
    (g) => (g.materials[0].alphaMode = 'INVALID'),
    (g) => (g.extensionsRequired = ['KHR_draco_mesh_compression']),
    (g) => (g.nodes[0].scale = [0, 1, 1]),
  ])
    assert.throws(() => importGlb(cubeGlb({ mutate })));
  assert.throws(() => importGlb(cubeGlb().subarray(0, 40)));
});
test('BLEND and MASK with no visible alpha effect import without material loss', () => {
  for (const mode of ['OPAQUE', 'MASK', 'BLEND']) {
    const bytes = cubeGlb({
      mutate: (g) => {
        g.materials[0].alphaMode = mode;
      },
    });
    const result = importGlb(bytes, { alphaPolicy: 'reject' });
    assert.deepEqual(result.materialConversions, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.document.meshes[0].indices.length, 36);
  }
});
test('real alpha has an explicit opaque fallback and an optional strict rejection', () => {
  for (const mode of ['MASK', 'BLEND']) {
    const bytes = cubeGlb({
      mutate: (g) => {
        g.materials[0].alphaMode = mode;
        g.materials[0].pbrMetallicRoughness.baseColorFactor[3] = 0.25;
      },
    });
    const before = sha(bytes),
      result = importGlb(bytes);
    assert.equal(sha(bytes), before);
    assert.equal(result.materialConversions.length, 1);
    assert.equal(result.materialConversions[0].alphaMode, mode);
    assert.match(result.warnings[0], /transparency imported as opaque/);
    assert.equal(Buffer.from(result.document.textures[0].rgbaBase64, 'base64')[3], 255);
    assert.equal(result.document.imports[0].alphaPolicy, 'opaque');
    assert.throws(() => importGlb(bytes, { alphaPolicy: 'reject' }), /transparency requires/);
  }
  assert.throws(() => importGlb(cubeGlb(), { alphaPolicy: 'silent' }), /alphaPolicy/);
  assert.throws(
    () =>
      importGlb(
        cubeGlb({
          mutate: (g) => {
            g.materials[0].alphaMode = 'MASK';
            g.materials[0].alphaCutoff = -1;
          },
        }),
      ),
    /alpha cutoff/,
  );
});
test('node hierarchy, mirrored winding and normals survive nonuniform scale', () => {
  const { document } = importGlb(
    cubeGlb({
      mutate: (g) => {
        g.nodes = [
          { children: [1], translation: [4, 3, 2] },
          { mesh: 0, scale: [-2, 3, 4] },
        ];
      },
    }),
  );
  assert.deepEqual(document.objects[0].collision.dimensions, [4, 6, 8]);
  assert.deepEqual(document.meshes[0].indices.slice(0, 3), [0, 1, 2]);
  for (let i = 0; i < document.meshes[0].normals.length; i += 3)
    assert.ok(Math.abs(Math.hypot(...document.meshes[0].normals.slice(i, i + 3)) - 1) < 1e-6);
});
test('absolute transform/rebase matches native Euler and preserves local collision', () => {
  const document = importGlb(cubeGlb()).document,
    bytes = Buffer.from(JSON.stringify(document));
  const to = { position: [3, 1, 2], rotationDegrees: [25, 40, -15], scale: [2, 0.5, 3] },
    from = { position: [0, 0, 0], rotationDegrees: [0, 0, 0], scale: [1, 1, 1] };
  const result = JSON.parse(
    buildAuthoredScene(bytes, { expectedSha256: sha(bytes), edits: [{ objectId: 1, ...to }] }).buffer,
  );
  near(result.meshes[0].positions.slice(0, 3), transformPoint([-1, 0, -1], to.position, to));
  assert.deepEqual(result.objects[0].collision, document.objects[0].collision);
  const p = [0.2, 0.7, -0.4];
  near(rebasePoint(rebasePoint(p, from, to), to, from), p);
  const n = [0, 1, 0];
  near(rebaseNormal(rebaseNormal(n, from, to), to, from), n);
  near(transformPoint([1, 0, 0], [0, 0, 0], { rotationDegrees: [0, 90, 0] }), [0, 0, -1]);
  assert.equal(transformedBoxCorners([2, 2, 2], [0, 0, 0], to.position, to).length, 8);
});
test(
  'private native GLB build serializes every collision exactly once',
  { skip: !process.env.SKY_DEMO_INNER },
  () => {
    let scene = importGlb(
      cubeGlb({
        mutate: (g) => {
          g.materials[0].alphaMode = 'BLEND';
          g.materials[0].pbrMetallicRoughness.baseColorFactor[3] = 0.4;
        },
      }),
    ).document;
    assert.equal(scene.imports[0].materialConversions.length, 1);
    scene = importGlb(cubeGlb(), { base: scene }).document;
    const original = Buffer.from(JSON.stringify(scene));
    const edited = buildAuthoredScene(original, {
      expectedSha256: sha(original),
      edits: [
        { objectId: 1, position: [1, 0, 1], rotationDegrees: [15, 45, 5], scale: [2, 1, 3] },
        { objectId: 2, position: [-3, 0, 0] },
      ],
    }).buffer;
    const source = fs.readFileSync(process.env.SKY_DEMO_INNER),
      result = buildNativeDemo(source, edited, { expectedSceneSha256: sha(edited) }),
      z = parseIgz(result.buffer);
    assert.equal(result.manifest.stages.car.triangles, 24);
    assert.equal(result.manifest.placementRecords.length, 2);
    assert.equal(z.unresolvedFixupEntries.length, 0);
    for (const record of result.manifest.placementRecords) {
      const actor = z.objectsByOffset.get(z.resolvePointer(record.carCollisionEncoded).offset),
        collision = z.pointerReferencesByOffset.get(actor.offset + 0x120).targetOffset;
      near(
        [0, 1, 2].map((i) => result.buffer.readFloatLE(actor.offset + 0x114 + i * 4)),
        record.carTransform.scale.map((v) => v * 100),
      );
      near(
        [0, 1, 2].map((i) => result.buffer.readFloatLE(collision + 0x4c + i * 4) * Math.fround(0.3048)),
        [2, 2, 2],
      );
    }
  },
);
