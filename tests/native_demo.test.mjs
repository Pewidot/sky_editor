import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { buildNativeDemo, ARENA_INNER_SHA256 } from '../tools/native_demo_builder.mjs';
import { parseArguments } from '../tools/native_demo.mjs';
import { parseIgz } from '../tools/igz.mjs';
import { loadGeometry } from '../tools/igz_geometry.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');

test('native demo CLI requires explicit inputs, scene digest and a new destination', () => {
  const args = [
    '--inner',
    'a',
    '--archive',
    'b',
    '--scene',
    'c',
    '--expect-scene-sha256',
    'a'.repeat(64),
    '--output',
    'd',
  ];
  assert.equal(parseArguments(args).output, 'd');
  for (const bad of [
    [],
    args.slice(0, -1),
    [...args, '--scene', 'x'],
    [...args, '--other', 'x'],
    args.map((v) => (v === 'a'.repeat(64) ? 'invalid' : v)),
  ]) {
    assert.throws(() => parseArguments(bad));
  }
});
test('native demo rejects unrecognized source before parsing the scene', () => {
  assert.throws(() => buildNativeDemo(Buffer.alloc(16), Buffer.from('{}')), /Unsupported Arena303 revision/);
});
test(
  'private native demo reproduces the runtime-tested archive payload',
  {
    skip: !process.env.SKY_DEMO_INNER || !process.env.SKY_DEMO_SCENE,
  },
  () => {
    const source = fs.readFileSync(process.env.SKY_DEMO_INNER),
      scene = fs.readFileSync(process.env.SKY_DEMO_SCENE);
    const sceneHash = sha(scene);
    assert.equal(sha(source), ARENA_INNER_SHA256);
    assert.throws(
      () => buildNativeDemo(source, scene, { expectedSceneSha256: '0'.repeat(64) }),
      /Scene SHA-256 mismatch/,
    );
    const r = buildNativeDemo(source, scene, { expectedSceneSha256: sceneHash });
    assert.equal(sha(source), ARENA_INNER_SHA256);
    assert.equal(sha(scene), sceneHash);
    assert.equal(sha(r.buffer), '1b2f88812a04305a7f4dd79c1fcbff0e352e41bfc387b116db7ee1fed60a5721');
    const z = parseIgz(r.buffer);
    assert.equal(z.unresolvedFixupEntries.length, 0);
    assert.equal(loadGeometry(z).warnings.length, 0);
    assert.equal(r.manifest.stages.car.triangles, 342761);
    assert.equal(r.manifest.stages.car.chunks, 35);
    assert.equal(r.manifest.stages.car.textures, 33);
    assert.equal(r.manifest.stages.collision.newSize, 1216);
    for (const encoded of [
      r.manifest.stages.placements.floorEncoded,
      r.manifest.stages.placements.carCollisionEncoded,
    ]) {
      const o = z.objectsByOffset.get(z.resolvePointer(encoded).offset);
      assert.equal(z.u32(o.offset + 8), 2);
      assert.equal(z.pointerReferences.filter((p) => p.targetObjectIndex === o.index).length, 2);
    }
  },
);
