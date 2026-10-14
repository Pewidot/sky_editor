import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { makeIgz } from './fixtures/igz_fixture.mjs';
import { parseIgz } from '../tools/igz.mjs';
import { loadGeometry } from '../tools/igz_geometry.mjs';
import { loadMeshTextures } from '../tools/igz_texture.mjs';
import { readShaderConstant, readMaterialAnimations, readMaterialStateAttr } from '../tools/igz_material.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function constant(type, size = type === 'igShaderConstantVector' ? 0x30 : 0x28) {
  const z = parseIgz(makeIgz({ objects: [{ type, size, name: 'synthetic_parameter' }] }));
  const o = z.objects[1];
  z.buffer.writeInt32LE(-1, o.offset + 0x1c);
  return { z, o };
}
test('shader constants preserve typed values, byte offsets and non-runtime provenance without mutations', () => {
  for (const [type, values] of [
    ['igShaderConstantVector', [4, 40, 0.03, -2]],
    ['igShaderConstantFloat', [-0.494]],
  ]) {
    const { z, o } = constant(type);
    values.forEach((v, i) => z.buffer.writeFloatLE(v, o.offset + 0x20 + i * 4));
    const before = hash(z.buffer),
      r = readShaderConstant(z, 1);
    assert.deepEqual(r.value, values.length === 1 ? Math.fround(values[0]) : values.map(Math.fround));
    assert.equal(r.name, 'synthetic_parameter');
    assert.equal(r.dataOffset, o.offset + 0x20);
    assert.equal(r.enabledRaw, 0);
    assert.equal(r.handleRaw, -1);
    assert.equal(r.appliedToPreview, false);
    assert.equal(r.activeAtRuntime, 'unknown');
    assert.match(r.evidence, /^ev_[0-9a-f]{64}$/);
    assert.equal(hash(z.buffer), before);
  }
});
test('shader booleans are 32-bit integers, not floating-point subnormals or truncated bytes', () => {
  const { z, o } = constant('igShaderConstantBool');
  for (const value of [0, 1]) {
    z.buffer.writeInt32LE(value, o.offset + 0x20);
    const r = readShaderConstant(z, 1);
    assert.equal(r.value, !!value);
    assert.equal(r.rawInt32, value);
  }
  for (const value of [-1, 2, 256]) {
    z.buffer.writeInt32LE(value, o.offset + 0x20);
    assert.throws(() => readShaderConstant(z, 1), /Noncanonical/);
  }
});
test('unsupported layouts, invalid IDs and nonfinite shader values fail closed', () => {
  for (const [type, size] of [
    ['UnknownShaderConstant', 0x28],
    ['igShaderConstantVector', 0x28],
  ]) {
    const { z } = constant(type, size);
    assert.throws(() => readShaderConstant(z, 1), /layout/);
  }
  const { z, o } = constant('igShaderConstantVector');
  for (const value of [Infinity, -Infinity, NaN]) {
    z.buffer.writeFloatLE(value, o.offset + 0x2c);
    assert.throws(() => readShaderConstant(z, 1), /Nonfinite/);
  }
  for (const id of [-1, 1.5, '1', 999]) assert.throws(() => readShaderConstant(z, id));
  assert.throws(() => readShaderConstant({ ...z, platform: 8 }, 1), /PS4/);
});
test('a null material transform list is not interpreted as a UV matrix; unrelocated nonnull pointers reject', () => {
  const { z, o } = constant('tfbRuntimeMaterial', 0x58);
  assert.deepEqual(readMaterialAnimations(z, 1), []);
  z.buffer.writeBigUInt64LE(123n, o.offset + 0x48);
  assert.throws(() => readMaterialAnimations(z, 1), /relocation/);
  assert.throws(() => readMaterialAnimations(z, 0), /owner/);
});
const arena = 'research/arena_mesh_303/level.bld';
test('material color and unsigned mask pairs preserve source fields, not inferred active shader choices', () => {
  const { z, o } = constant('igColorAttr', 0x30),
    values = [0.3, 2, -0.5, 0.618];
  values.forEach((v, i) => z.buffer.writeFloatLE(v, o.offset + 0x20 + i * 4));
  const before = hash(z.buffer),
    color = readMaterialStateAttr(z, 1);
  assert.deepEqual(color.value, values.map(Math.fround));
  assert.equal(color.dataOffset, o.offset + 0x20);
  assert.equal(color.appliedToPreview, false);
  assert.equal(color.activeAtRuntime, 'unknown');
  assert.equal(hash(z.buffer), before);
  for (const stage of ['Vertex', 'Pixel']) {
    const { z: m, o: a } = constant(`ig${stage}ShaderVariantMaskAttr`, 0x20);
    m.buffer.writeUInt32LE(0x80000000, a.offset + 0x14);
    m.buffer.writeUInt32LE(0xffffffff, a.offset + 0x18);
    const r = readMaterialStateAttr(m, 1);
    assert.equal(r.stage, stage.toLowerCase());
    assert.equal(r.baseMask, 0x80000000);
    assert.equal(r.ignoreMask, 0xffffffff);
    assert.equal(r.ignoreMaskOffset, a.offset + 0x18);
    assert.equal(r.appliedToPreview, false);
    assert.equal(r.activeAtRuntime, 'unknown');
  }
});
test('material state rejects wrong layouts, invalid IDs, and nonfinite colors without guessing', () => {
  for (const [type, size] of [
    ['UnknownAttr', 0x30],
    ['igColorAttr', 0x28],
    ['igPixelShaderVariantMaskAttr', 0x28],
  ]) {
    const { z } = constant(type, size);
    assert.throws(() => readMaterialStateAttr(z, 1), /layout/);
  }
  const { z, o } = constant('igColorAttr', 0x30);
  z.buffer.writeFloatLE(NaN, o.offset + 0x20);
  assert.throws(() => readMaterialStateAttr(z, 1), /Nonfinite/);
  for (const id of [-1, 1.5, '1', 999]) assert.throws(() => readMaterialStateAttr(z, id));
  assert.throws(() => readMaterialStateAttr({ ...z, platform: 8 }, 1), /PS4/);
});
test(
  'local-only material diagnosis exposes real layered/height parameters and UV animation tracks',
  { skip: !fs.existsSync(arena) },
  () => {
    const z = parseIgz(arena),
      before = hash(z.buffer);
    const meshes = loadGeometry(z).meshes.filter((m) => [133, 351].includes(m.id));
    const r = loadMeshTextures(z, meshes);
    const layered = r.meshTextures.get(133),
      wall = r.meshTextures.get(351);
    const params = new Map(layered.shaderParameters.map((p) => [p.name, p]));
    assert.equal(params.get('ubershaderblended__thresholdBlendInverse').value, Math.fround(6.060606));
    assert.equal(params.get('ubershaderblended__thresholdBias').value, Math.fround(-0.494));
    assert.equal(params.get('ubershaderblended__alphaThreshold').value, true);
    assert.equal(params.get('ubershaderblended__directionalBlend').value, false);
    assert.ok(params.get('ubershaderblended__thresholdBias').occurrences.length > 1);
    assert.match(layered.textureFallbackReason, /composition/);
    const color = layered.materialStateAttrs.find((a) => a.id === 153);
    assert.deepEqual(
      color.value,
      Array.from({ length: 4 }, (_, i) => z.buffer.readFloatLE(z.objects[153].offset + 0x20 + i * 4)),
    );
    assert.ok(color.occurrences.length > 1);
    const masks = layered.materialStateAttrs.filter((a) => a.stage);
    assert.ok(masks.some((a) => a.stage === 'vertex' && a.baseMask === 0 && a.ignoreMask === 14));
    assert.ok(masks.some((a) => a.stage === 'pixel' && a.baseMask === 8 && a.ignoreMask === 10));
    assert.equal(
      wall.shaderParameters.find((p) => p.name === 'ubershaderoutdoor__parallaxMapping').value,
      true,
    );
    const parallax = wall.shaderParameters.find((p) => p.name === 'ubershaderoutdoor__parallaxParams');
    assert.deepEqual(parallax.value, [4, 40, Math.fround(0.03), 0]);
    assert.ok(wall.textureId);
    assert.deepEqual(wall.materialDiagnosticWarnings, []);
    const material = z.objects.find(
      (o) =>
        o.type === 'tfbRuntimeMaterial' &&
        z.pointerReferencesByOffset.get(o.offset + 0x48)?.targetObjectIndex === 1352,
    );
    assert.ok(material);
    const animations = readMaterialAnimations(z, material.index);
    assert.equal(animations.length, 2);
    assert.equal(animations[0].fieldName, '_textureTransform');
    assert.equal(animations[0].transform.id, 1354);
    assert.equal(animations[0].track.id, 1355);
    assert.equal(animations[0].appliedToPreview, false);
    assert.equal(animations[1].fieldName, '_color');
    assert.equal(hash(z.buffer), before);
    // Invalid diagnostic constants do not hide a valid RGB preview.
    const copy = Buffer.from(z.buffer);
    copy.writeFloatLE(NaN, parallax.dataOffset);
    const bad = loadMeshTextures(parseIgz(copy), meshes).meshTextures.get(351);
    assert.ok(bad.textureId);
    assert.match(bad.shaderParameters.find((p) => p.id === parallax.id).diagnosticError, /Nonfinite/);
  },
);
