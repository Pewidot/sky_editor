import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { parseIgz } from '../tools/igz.mjs';
import { loadGeometry } from '../tools/igz_geometry.mjs';
import {
  halfToFloat,
  decodeBcBlock,
  bcMipLayout,
  thinMicrotileBlockIndex,
  decodePs4BcMip,
  loadMeshTextures,
  MATERIAL_SAMPLER_PROFILE,
} from '../tools/igz_texture.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');
test('BC1 reference colors, opaque interpolation and one-bit transparency', () => {
  const block = Buffer.alloc(8);
  block.writeUInt16LE(0xf800, 0);
  block.writeUInt16LE(0x07e0, 2);
  block.writeUInt32LE(0xe4, 4);
  const rgba = decodeBcBlock(block, 'dxt1_tile_ps4');
  assert.deepEqual(
    [...rgba.subarray(0, 16)],
    [255, 0, 0, 255, 0, 255, 0, 255, 170, 85, 0, 255, 85, 170, 0, 255],
  );
  block.writeUInt16LE(0, 0);
  block.writeUInt16LE(0xffff, 2);
  block.writeUInt32LE(0xe4, 4);
  assert.deepEqual(
    [...decodeBcBlock(block, 'dxt1_tile_ps4').subarray(8, 16)],
    [128, 128, 128, 255, 0, 0, 0, 0],
  );
  assert.throws(() => decodeBcBlock(Buffer.alloc(7), 'dxt1_tile_ps4'), /length/);
  assert.throws(() => decodeBcBlock(block, 'bc5_tile_ps4'), /format/);
});
test('BC3 alpha both interpolation branches and non-transparent RGB branch', () => {
  const block = Buffer.alloc(16);
  block[0] = 255;
  block[1] = 0;
  let bits = 0;
  for (let i = 0; i < 16; i++) bits += (i % 8) * 2 ** (i * 3);
  block.writeUIntLE(bits, 2, 6);
  block.writeUInt16LE(0, 8);
  block.writeUInt16LE(0xffff, 10);
  block.writeUInt32LE(0xffffffff, 12);
  const result = decodeBcBlock(block, 'dxt5_tile_ps4');
  assert.deepEqual([...result.subarray(0, 3)], [170, 170, 170]);
  assert.deepEqual(
    Array.from({ length: 8 }, (_, i) => result[i * 4 + 3]),
    [255, 0, 219, 182, 146, 109, 73, 36],
  );
  block[0] = 0;
  block[1] = 255;
  const other = decodeBcBlock(block, 'dxt5_tile_ps4');
  assert.deepEqual(
    Array.from({ length: 8 }, (_, i) => other[i * 4 + 3]),
    [0, 255, 51, 102, 153, 204, 0, 255],
  );
});
test('HALF2 range and microtile indexing are bounded and bijective', () => {
  assert.equal(halfToFloat(0x3c00), 1);
  assert.equal(halfToFloat(0xc000), -2);
  assert.equal(halfToFloat(0x8000), -0);
  assert.equal(halfToFloat(1), 2 ** -24);
  assert.equal(halfToFloat(0x7c00), Infinity);
  assert.ok(Number.isNaN(halfToFloat(0x7c01)));
  assert.deepEqual(
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [2, 0],
      [0, 2],
      [7, 7],
      [8, 0],
      [0, 8],
    ].map(([x, y]) => thinMicrotileBlockIndex(x, y, 16)),
    [0, 1, 2, 4, 8, 63, 64, 128],
  );
  const indices = new Set();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) indices.add(thinMicrotileBlockIndex(x, y, 16));
  assert.equal(indices.size, 256);
  assert.equal(Math.max(...indices), 255);
  assert.throws(() => thinMicrotileBlockIndex(0, 0, 7));
  assert.throws(() => thinMicrotileBlockIndex(8, 0, 8));
});
test('Stored mip selection, tiled blocks, partial edge blocks and payload validation', () => {
  const layout = bcMipLayout(64, 32, 2, 8);
  assert.deepEqual(
    layout.map((m) => m.size),
    [1024, 512],
  );
  const payload = Buffer.alloc(1536);
  // Each stored BC1 block encodes its index as a red intensity.
  for (let block = 0; block < 192; block++) payload.writeUInt16LE(block % 32 << 11, block * 8);
  const first = decodePs4BcMip(payload, 64, 32, 2, 'dxt1_tile_ps4', 64);
  assert.equal(first.level, 0);
  assert.equal(first.rgba[(4 * 64 + 0) * 4], Math.round((2 * 255) / 31));
  assert.equal(first.rgba[(0 * 64 + 8) * 4], Math.round((4 * 255) / 31));
  const second = decodePs4BcMip(payload, 64, 32, 2, 'dxt1_tile_ps4', 32);
  assert.deepEqual([second.level, second.width, second.height, second.rgba.length], [1, 32, 16, 2048]);
  assert.equal(decodePs4BcMip(Buffer.alloc(512), 3, 2, 1, 'dxt1_tile_ps4', 32).rgba.length, 24);
  assert.throws(() => decodePs4BcMip(payload.subarray(0, 1535), 64, 32, 2, 'dxt1_tile_ps4'), /size/);
  assert.throws(() => bcMipLayout(8193, 1, 1, 8), /dimensions/);
  assert.throws(() => decodePs4BcMip(payload, 64, 32, 2, 'dxt1_tile_ps4', 2048), /dimension/);
});
const arena = 'research/arena_mesh_303/level.bld';
test(
  'Local-only arena texture/UV linkage, deduplication, honest layered fallback and immutability',
  { skip: !fs.existsSync(arena) },
  () => {
    const executable = 'extracted/CUSA00697/eboot.elf';
    if (fs.existsSync(executable)) {
      const elf = fs.readFileSync(executable);
      assert.equal(hash(elf), '423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3');
      // The source-bound format initializer and native tile-mode13 register.
      const signature = Buffer.from('418a44241884c9750424feeb020c014188442418', 'hex');
      assert.deepEqual(elf.subarray(0x847ad3, 0x847ad3 + signature.length), signature);
      assert.equal(elf.readUInt32LE(0xb350a4), 0x00400308);
    }
    const z = parseIgz(arena),
      before = hash(z.buffer),
      geometry = loadGeometry(z),
      result = loadMeshTextures(z, geometry.meshes);
    assert.equal(result.textures.size, 30);
    assert.equal(result.budget.bytes, 6325312);
    assert.equal([...result.meshTextures.values()].filter((t) => t.textureId).length, 61);
    assert.match(result.meshTextures.get(133).textureFallbackReason, /composition/);
    assert.ok(result.meshTextures.get(133).uvs.length > 0, 'UV inspection must work for missing materials');
    assert.equal(result.meshTextures.get(133).materialName, 'ZZ_corrugated_wall_1v2blend_DUP');
    assert.equal(result.meshTextures.get(133).uvInfo.materialTransformApplied, false);
    const first = result.meshTextures.get(5),
      image = result.textures.get(first.textureId);
    assert.equal(first.uvs.length, geometry.meshes.find((m) => m.id === 5).vertexCount * 2);
    assert.equal(first.textureWrapS, 'repeat');
    assert.equal(first.textureWrapT, 'repeat');
    assert.equal(first.textureFilter, 'linear');
    const namedHeight = result.meshTextures.get(939);
    assert.equal(namedHeight.textureSourceSelection, 'reflected-diffuse-sampler');
    assert.ok(namedHeight.textureId);
    assert.match(namedHeight.textureBindings.find((b) => b.cachedUnitId === 0).name, /^HeightMap#/);
    assert.deepEqual(
      [image.sourceWidth, image.sourceHeight, image.width, image.height, image.sourceMip],
      [512, 1024, 128, 256, 2],
    );
    const rgba = Buffer.from(image.rgbaBase64, 'base64');
    assert.equal(hash(rgba), image.rgbaSha256);
    assert.equal(rgba.length, image.width * image.height * 4);
    const budget = loadMeshTextures(z, geometry.meshes, { maxTotalBytes: 0 });
    assert.equal(budget.textures.size, 0);
    assert.equal(budget.budget.bytes, 0);
    assert.match(budget.meshTextures.get(5).textureFallbackReason, /budget/);
    assert.equal(hash(z.buffer), before);
    assert.equal(hash(fs.readFileSync(arena)), before);
  },
);
const actors = 'research/arena_challenge_303_000/level.bld';
test(
  'local-only non-diffuse ColorMap slots do not create false layers and minimum stored mips obey both caps',
  { skip: !fs.existsSync(actors) },
  async () => {
    const { loadActorGeometry } = await import('../tools/igz_geometry.mjs');
    const z = parseIgz(actors),
      geometry = loadActorGeometry(z);
    const mesh = geometry.meshes.find((m) => m.id === 5376),
      result = loadMeshTextures(z, [mesh]);
    const record = result.meshTextures.get(mesh.id);
    assert.ok(record.textureBindings.some((b) => b.cachedUnitId === 2 && b.name.startsWith('ColorMap#')));
    assert.equal(record.textureSourceImageId, 5382);
    assert.ok(record.textureId);
    const strip = geometry.meshes.find((m) => m.id === 13799);
    const strict = loadMeshTextures(z, [strip], { maxDimension: 128 });
    assert.match(strict.meshTextures.get(strip.id).textureFallbackReason, /eligible stored/);
    const fallback = loadMeshTextures(z, [strip], { maxDimension: 128, fallbackMaxDimension: 256 });
    const image = fallback.textures.get(fallback.meshTextures.get(strip.id).textureId);
    assert.deepEqual([image.width, image.height, image.minimumMipFallback], [256, 32, true]);
    assert.equal(fallback.budget.bytes, 32768);
    const capped = loadMeshTextures(z, [strip], {
      maxDimension: 128,
      fallbackMaxDimension: 256,
      maxTotalBytes: 32767,
    });
    assert.match(capped.meshTextures.get(strip.id).textureFallbackReason, /budget/);
    for (const fallbackMaxDimension of [64, 1025, 256.5])
      assert.throws(
        () => loadMeshTextures(z, [], { maxDimension: 128, fallbackMaxDimension }),
        /fallback dimension/,
      );
  },
);
test(
  'Local-only bootstrap sampler reflection separates diffuse, layered diffuse2 and emission slots',
  { skip: !fs.existsSync('research/permanent_bootstrap/level.bld') },
  () => {
    const z = parseIgz('research/permanent_bootstrap/level.bld');
    assert.equal(hash(z.buffer), MATERIAL_SAMPLER_PROFILE.bootstrapSha256);
    for (const [prefix, expected] of [
      ['UberShaderOutdoor', { diffuse: 0, diffuse2: 4, emissive: 5 }],
      ['CharacterOutdoor', { diffuse: 0, diffuse2: 4, emissive: 5 }],
    ]) {
      for (const [suffix, unit] of Object.entries(expected)) {
        const objects = z.objects.filter(
          (o) =>
            ['igTextureSamplerSource', 'igTechniqueSampler'].includes(o.type) &&
            z.stringReferencesByOffset.get(o.offset + 16)?.value === `${prefix}_${suffix}`,
        );
        assert.ok(objects.length > 0);
        for (const o of objects) assert.equal(z.u32(o.offset + 24), unit);
      }
    }
  },
);
test(
  'Local-only emission exclusion requires the exact effect namespace and cached slot',
  { skip: !fs.existsSync(arena) },
  () => {
    const z = parseIgz(arena),
      mesh = loadGeometry(z).meshes.find((m) => m.id === 1287);
    const good = loadMeshTextures(z, [mesh]).meshTextures.get(mesh.id);
    assert.ok(good.textureId);
    const emission = good.textureBindings.find((b) => b.name.startsWith('ColorMap#') && b.cachedUnitId === 5);
    assert.ok(emission);
    assert.equal(emission.reflectedSamplerRole, 'emissive');
    const exid = z.fixupMap.get('EXID'),
      at = exid.dataOffset + good.materialEffect.exidIndex * 8;
    const unknownEffect = Buffer.from(z.buffer);
    unknownEffect.writeUInt32LE(0x12345678, at + 4);
    const unknown = loadMeshTextures(parseIgz(unknownEffect), [mesh]).meshTextures.get(mesh.id);
    assert.equal(unknown.textureId, undefined);
    assert.match(unknown.textureFallbackReason, /Multiple/);
    const notEmission = Buffer.from(z.buffer);
    notEmission.writeInt16LE(4, z.objects[emission.bindId].offset + 0xc);
    const layered = loadMeshTextures(parseIgz(notEmission), [mesh]).meshTextures.get(mesh.id);
    assert.equal(layered.textureId, undefined);
    assert.match(layered.textureFallbackReason, /Multiple/);
  },
);
test(
  'Local-only diagnostic bound-image overrides retain UVs and refuse absent images/channels',
  { skip: !fs.existsSync(arena) },
  () => {
    const z = parseIgz(arena),
      mesh = loadGeometry(z).meshes.find((m) => m.id === 133);
    const strict = loadMeshTextures(z, [mesh]).meshTextures.get(133);
    assert.ok(strict.textureFallbackReason);
    assert.ok(strict.uvs.length > 0);
    const override = loadMeshTextures(z, [mesh], { imageOverride: 139, maxDimension: 1024 });
    const record = override.meshTextures.get(133);
    assert.ok(record.textureId);
    assert.equal(record.textureDiagnosticOverride, true);
    assert.equal(record.textureSourceImageId, 139);
    assert.match(record.textureStatus, /NOT verified/);
    assert.deepEqual(record.uvs, strict.uvs);
    assert.match(
      loadMeshTextures(z, [mesh], { imageOverride: 999999 }).meshTextures.get(133).textureFallbackReason,
      /absent/,
    );
    assert.match(
      loadMeshTextures(z, [mesh], { imageOverride: 139, uvChannel: 7 }).meshTextures.get(133)
        .uvFallbackReason,
      /TEXCOORD7/,
    );
    assert.throws(() => loadMeshTextures(z, [mesh], { uvChannel: 8 }), /channel/);
  },
);
test(
  'Local-only malformed UV and unsupported image fail closed without dropping geometry',
  { skip: !fs.existsSync(arena) },
  () => {
    const z = parseIgz(arena),
      geometry = loadGeometry(z),
      mesh = geometry.meshes.find((m) => m.id === 5);
    const image = z.objects[11],
      copy = Buffer.from(z.buffer);
    copy.writeUInt32LE(6, image.offset + 0x48);
    const invalidImage = loadMeshTextures(parseIgz(copy), [mesh]);
    assert.match(invalidImage.meshTextures.get(5).textureFallbackReason, /single 2D/);
    const badUv = Buffer.from(z.buffer);
    badUv.writeUInt16LE(0x7c00, mesh.source.vertexDataOffset);
    const invalidUv = loadMeshTextures(parseIgz(badUv), [mesh]);
    assert.match(invalidUv.meshTextures.get(5).textureFallbackReason, /UV component/);
  },
);
