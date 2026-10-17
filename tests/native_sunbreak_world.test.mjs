import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { buildSunbreakWorld } from '../tools/native_sunbreak_world.mjs';
import { parseIgz } from '../tools/igz.mjs';
import { loadGeometry } from '../tools/igz_geometry.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
test('Sunbreak rejects unrelated bytes before attempting native writes', () => {
  assert.throws(() => buildSunbreakWorld(Buffer.alloc(1024)), /Unsupported native donor/);
});
test(
  'private Sunbreak world preserves sky/images and activates matching collisions',
  {
    skip: !process.env.SKY_DEMO_INNER,
  },
  () => {
    const source = fs.readFileSync(process.env.SKY_DEMO_INNER),
      before = sha(source),
      z = parseIgz(source);
    const result = buildSunbreakWorld(source),
      out = parseIgz(result.buffer),
      a = loadGeometry(z),
      b = loadGeometry(out);
    assert.equal(sha(source), before);
    assert.equal(out.unresolvedFixupEntries.length, 0);
    assert.equal(b.warnings.length, 0);
    assert.equal(result.manifest.platforms.length, 5);
    assert.equal(result.manifest.collisionBoxes.length, 66);
    assert.equal(result.manifest.missionLogicIncluded, false);
    assert.equal(result.manifest.runtimeValidated, false);
    const byEncoded = (e) => out.objectsByOffset.get(out.resolvePointer(e).offset);
    // Camera heading must not change the shared zero used by other parameters.
    const parameter = byEncoded(z.objects[1569].encoded),
      variant = out.objects[out.pointerReferencesByOffset.get(parameter.offset + 88).targetObjectIndex];
    const literal = out.objects[out.pointerReferencesByOffset.get(variant.offset + 16).targetObjectIndex];
    assert.equal(variant.type, 'ValueRHSVariant');
    assert.equal(literal.type, 'RHSValueStack');
    assert.notEqual(variant.encoded, z.objects[1570].encoded);
    assert.equal(out.u32(literal.offset + 64), 180);
    assert.equal(out.u32(byEncoded(z.objects[1571].encoded).offset + 64), 0);
    assert.equal(out.u32(byEncoded(z.objects[1570].encoded).offset + 8), 16);
    assert.equal(out.u32(variant.offset + 8), 1);
    assert.equal(out.u32(literal.offset + 8), 1);
    assert.equal(result.manifest.cameraHeadingDegrees, 180);
    for (const old of a.meshes.filter((m) => m.sky)) {
      const next = b.meshes.find((m) => out.objects[m.id].encoded === z.objects[old.id].encoded);
      assert.deepEqual(next.positions, old.positions);
      assert.deepEqual(next.indices, old.indices);
    }
    const allocation = (p, o) => {
      const r = p.tmhnReferences.find((r) => r.offset === o.offset + 96),
        at = p.fixupMap.get('TMHN').dataOffset + r.tableIndex * 16;
      const n = p.u32(at),
        start = p.resolvePointer(p.u32(at + 8), n).offset;
      return p.buffer.subarray(start, start + n);
    };
    for (const image of z.objects.filter((o) => o.type === 'igImage2'))
      assert.equal(sha(allocation(out, byEncoded(image.encoded))), sha(allocation(z, image)));
    for (const o of out.objects.filter(
      (o) =>
        o.type === 'tfbActorInfo' &&
        out.stringReferencesByOffset.get(o.offset + 16)?.value.startsWith('Sunbreak '),
    )) {
      assert.equal(out.u32(o.offset + 8), 2);
      assert.equal(out.pointerReferences.filter((p) => p.targetObjectIndex === o.index).length, 2);
      const c = out.objects[out.pointerReferencesByOffset.get(o.offset + 288).targetObjectIndex];
      assert.equal(c.type, 'CollisionInfo');
      assert.equal(out.u32(c.offset + 48), 0x69);
    }
    const rim = a.meshes.find((m) => m.id === 537),
      newRim = b.meshes.find((m) => m.id === 537);
    for (let i = 0; i < rim.vertexCount; i++)
      assert.equal(
        result.buffer.readUInt32LE(newRim.source.vertexDataOffset + i * 40),
        source.readUInt32LE(rim.source.vertexDataOffset + i * 40),
        'Native atlas UVs must stay exact',
      );
  },
);
