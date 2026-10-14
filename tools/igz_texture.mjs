// Read-only CUSA00697 diffuse-color preview. No texture/IGZ writes.
import { createHash } from 'node:crypto';
import { parseIgz } from './igz.mjs';
import { readShaderConstant, readMaterialAnimations, readMaterialStateAttr } from './igz_material.mjs';
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const TEXTURE_EVIDENCE = Object.freeze({
  image: 'ev_248fa95c73761d30d805f1209ce74892c54134c9b6dcb00b92e6d0a6b3bb4896',
  texture: 'ev_fb0a5edf830923a1fc3d73dabe62f9bafaf7633fbbf2162ae467acb8772c3e26',
  material: 'ev_c9f89d3afcfb0bbb6028ea06734a4411fe3c15164cf34f58ba3defb439b0f4d6',
  bind: 'ev_b9995ee6961d031caa23358bd93e1bef7e5e722a8fdae83ee437856046ed4180',
  cachedUnit: 'ev_a7403a20d499fa733910c32faf04d4788784bad252a677c6af5121efd3fc0d17',
  filterEnum: 'ev_d94f006e171cbef5408d1eb4d8cd794f2397c52fb222c8af56d36ee3e8288d87',
  wrap: 'ev_cd8dfe3b7f3f63ca373f4eb7ec63206ff2b9bc926413e71f852236a124e897a5',
  tileCallback: 'ev_77dfbd4d82d02353ff5c0027e402453055da8cec15b08d71b1b22dd04dcb094c',
  detileCallback: 'ev_2be162701f1852c2d5e48dd74d7517023ad77d8d9b1dd88f19cfdfbec16fa163',
  microtileIndex: 'ev_91c0c57eb44d168d8f81d25f27288b24b0dabdaae106120104f8ab5cb4c34556',
  microtileAddress: 'ev_9acd89797374027d4ace9ddbb654534ef03079a50a76cf6f32d2d14e6aa663b8',
  blockDimensions: 'ev_32b9c82061b1b9d1c4ef612669d0677addd03abbfe0da260478ef689c6621730',
  formatTileSelector: 'ev_ff271290b60ca912bdab757e99fb537a1fc018d2d4afd1ce50cbec66e221f1f6',
  surfaceTileSelector: 'ev_22b1ce3763655e923e6eda285e4f2170086e6d39d27e7fc1c1437db8f4597417',
  microtileSelector: 'ev_04984c2b158d3d2adcb2ae830e2d7a694446b51902f478a7c3ce257eb8fff749',
  tileModeSelector: 'ev_77f1d1c0a703cf3a9691381cc7e15b2e79928b081439d83664ecc684281f5584',
});
// Exact original ELF initialization c43010 (not modeled by REA) sets the
// registered dxt1/dxt5_tile_ps4 object's +18 bit0 at c43ad3..c43ae2, after
// resolving base formats through RELA pairs fe9e20/fe9e60. For one 2D slice,
// the retained selectors above yield array2/micro1/tile13; native f310a4 holds
// 00400308. This is source-bound to CUSA00697 eboot SHA423a4513...95f1c3.
// See docs/TEXTURE_PREVIEW.md; no general macrotiling or cubemap inference.
export const TEXTURE_LIMITATIONS = Object.freeze([
  'Read-only RGB color-map preview, not the game shader: no layer blending, normal maps, lighting match, alpha blend/test, animated UVs or cubemaps.',
  'Only one distinct diffuse image per material is eligible; exact Outdoor/Character effect profiles use reflected diffuse units 0/4, other effects use conservative ColorMap names. Layered materials retain flat shading.',
  'Preview uses one stored mip at or below the requested maximum dimension; original game image data is never changed.',
]);
const FORMATS = new Map([
  [0xf8313483, 'dxt1_tile_ps4'],
  [0xf0b976cf, 'dxt5_tile_ps4'],
]);
// Source-bound bootstrap reflection, SHA a56888fa...34e9: named sampler
// UberShaderOutdoor/CharacterOutdoor_diffuse=unit0, diffuse2=unit4.
// Native igAttr._cachedUnitID is int16 at +0xc, NOT _unitID at +0x20.
// This selects the RGB preview only; it does not reproduce the shader.
export const MATERIAL_SAMPLER_PROFILE = Object.freeze({
  bootstrapSha256: 'a56888faa11114d848daf16e74e1d41560a03ff15adbde55249355a23c1534e9',
  samplerSourceEvidence: 'ev_bff299531d1940f8c1c618308d378a134aac2d1a4c5f9f826313f6072bf73c14',
  techniqueSamplerEvidence: 'ev_0bfba58542200ddb6800f5d2e032d4a7fbd169c0e8c22e694a3684f00ce30a39',
});
const OUTDOOR_EFFECTS = new Map([
  [0x889d65c8, 'ubershaderoutdoor'],
  [0xaf60fb5c, 'characteroutdoor'],
]);
const WRAPS = ['clamp', 'repeat'];
export function halfToFloat(bits) {
  const sign = bits & 0x8000 ? -1 : 1,
    exponent = (bits >>> 10) & 31,
    fraction = bits & 1023;
  return exponent === 31
    ? fraction
      ? NaN
      : sign * Infinity
    : sign * (exponent === 0 ? fraction * 2 ** -24 : (1 + fraction / 1024) * 2 ** (exponent - 15));
}
// BC1/BC3 layout and interpolation: Microsoft Direct3D block-compression spec.
// https://learn.microsoft.com/en-us/windows/win32/direct3d10/d3d10-graphics-programming-guide-resources-block-compression
export function decodeBcBlock(bytes, format) {
  const bc3 = format === 'dxt5_tile_ps4';
  check(bc3 || format === 'dxt1_tile_ps4', 'Unsupported BC color format');
  check(Buffer.isBuffer(bytes) && bytes.length === (bc3 ? 16 : 8), 'Invalid BC block length');
  const at = bc3 ? 8 : 0,
    c0 = bytes.readUInt16LE(at),
    c1 = bytes.readUInt16LE(at + 2);
  const rgb = (n) => [
    Math.round((((n >>> 11) & 31) * 255) / 31),
    Math.round((((n >>> 5) & 63) * 255) / 63),
    Math.round(((n & 31) * 255) / 31),
    255,
  ];
  const colors = [rgb(c0), rgb(c1)];
  if (bc3 || c0 > c1) {
    colors.push(colors[0].map((v, i) => Math.round((2 * v + colors[1][i]) / 3)));
    colors.push(colors[0].map((v, i) => Math.round((v + 2 * colors[1][i]) / 3)));
  } else {
    colors.push(colors[0].map((v, i) => Math.round((v + colors[1][i]) / 2)));
    colors.push([0, 0, 0, 0]);
  }
  const alpha = bc3 ? [bytes[0], bytes[1]] : [];
  if (bc3) {
    const steps = alpha[0] > alpha[1] ? 7 : 5;
    for (let i = 1; i < steps; i++) alpha.push(Math.round(((steps - i) * alpha[0] + i * alpha[1]) / steps));
    if (steps === 5) alpha.push(0, 255);
  }
  const colorBits = bytes.readUInt32LE(at + 4),
    alphaBits = bc3 ? bytes.readUIntLE(2, 6) : 0;
  const rgba = Buffer.alloc(64);
  for (let i = 0; i < 16; i++) {
    const color = colors[(colorBits >>> (i * 2)) & 3];
    for (let axis = 0; axis < 3; axis++) rgba[i * 4 + axis] = color[axis];
    rgba[i * 4 + 3] = bc3 ? alpha[Math.floor(alphaBits / 2 ** (i * 3)) & 7] : color[3];
  }
  return rgba;
}

export function bcMipLayout(width, height, levels, blockBytes) {
  check(
    [width, height, levels, blockBytes].every(Number.isSafeInteger) &&
      width > 0 &&
      height > 0 &&
      width <= 8192 &&
      height <= 8192 &&
      levels > 0 &&
      levels <= 14 &&
      [8, 16].includes(blockBytes),
    'Invalid or excessive image dimensions',
  );
  let offset = 0;
  return Array.from({ length: levels }, (_, level) => {
    const w = Math.max(1, Math.floor(width / 2 ** level)),
      h = Math.max(1, Math.floor(height / 2 ** level));
    const pitch = Math.ceil(Math.ceil(w / 4) / 8) * 8,
      rows = Math.ceil(Math.ceil(h / 4) / 8) * 8;
    const size = pitch * rows * blockBytes,
      result = { level, width: w, height: h, pitch, rows, offset, size };
    offset += size;
    return result;
  });
}
export function thinMicrotileBlockIndex(x, y, pitch) {
  check(
    [x, y, pitch].every(Number.isSafeInteger) &&
      x >= 0 &&
      y >= 0 &&
      pitch > 0 &&
      pitch % 8 === 0 &&
      x < pitch,
    'Invalid microtile coordinate',
  );
  const morton = (x & 1) | ((y & 1) << 1) | ((x & 2) << 1) | ((y & 2) << 2) | ((x & 4) << 2) | ((y & 4) << 3);
  return (Math.floor(y / 8) * (pitch / 8) + Math.floor(x / 8)) * 64 + morton;
}
export function decodePs4BcMip(payload, width, height, levels, format, maxDimension = 256) {
  check(Buffer.isBuffer(payload), 'Image payload must be bytes');
  check(
    Number.isSafeInteger(maxDimension) && maxDimension >= 32 && maxDimension <= 1024,
    'Preview dimension must be 32..1024',
  );
  check(['dxt1_tile_ps4', 'dxt5_tile_ps4'].includes(format), 'Unsupported PS4 image format');
  const blockBytes = format === 'dxt1_tile_ps4' ? 8 : 16,
    layouts = bcMipLayout(width, height, levels, blockBytes);
  const last = layouts.at(-1);
  check(last.offset + last.size === payload.length, 'Image size does not match the supported 2D mip layout');
  const mip = layouts.find((m) => m.width <= maxDimension && m.height <= maxDimension);
  check(mip, 'No stored mip within the preview size budget');
  const rgba = Buffer.alloc(mip.width * mip.height * 4);
  for (let by = 0; by < Math.ceil(mip.height / 4); by++)
    for (let bx = 0; bx < Math.ceil(mip.width / 4); bx++) {
      const offset = mip.offset + thinMicrotileBlockIndex(bx, by, mip.pitch) * blockBytes;
      check(offset + blockBytes <= mip.offset + mip.size, 'Tiled block exceeds selected mip');
      const block = decodeBcBlock(payload.subarray(offset, offset + blockBytes), format);
      for (let y = 0; y < 4 && by * 4 + y < mip.height; y++)
        for (let x = 0; x < 4 && bx * 4 + x < mip.width; x++)
          block.copy(rgba, ((by * 4 + y) * mip.width + bx * 4 + x) * 4, (y * 4 + x) * 4, (y * 4 + x + 1) * 4);
    }
  return { width: mip.width, height: mip.height, level: mip.level, rgba };
}

/** Returns per-drawable metadata without changing the passed meshes or input.
 * A shared budget and texture map may be used across actor/static IGZ sources.
 */
export function loadMeshTextures(
  input,
  meshes,
  {
    maxDimension = 256,
    maxTotalBytes = 16 * 1024 * 1024,
    textures = new Map(),
    budget = { bytes: 0 },
    uvChannel = 0,
    imageOverride,
    fallbackMaxDimension = maxDimension,
  } = {},
) {
  check(Number.isSafeInteger(uvChannel) && uvChannel >= 0 && uvChannel <= 7, 'UV channel must be 0..7');
  check(
    imageOverride === undefined || (Number.isSafeInteger(imageOverride) && imageOverride >= 0),
    'Invalid diagnostic image override',
  );
  check(
    Number.isSafeInteger(maxDimension) && maxDimension >= 32 && maxDimension <= 1024,
    'Invalid texture preview dimension',
  );
  check(
    Number.isSafeInteger(fallbackMaxDimension) &&
      fallbackMaxDimension >= maxDimension &&
      fallbackMaxDimension <= 1024,
    'Invalid minimum-mip fallback dimension',
  );
  check(
    Number.isSafeInteger(maxTotalBytes) && maxTotalBytes >= 0 && maxTotalBytes <= 32 * 1024 * 1024,
    'Invalid texture memory budget',
  );
  check(
    textures instanceof Map &&
      Number.isSafeInteger(budget?.bytes) &&
      budget.bytes >= 0 &&
      budget.bytes <= maxTotalBytes,
    'Invalid shared texture budget',
  );
  const z = input?.objects && input?.buffer ? input : parseIgz(input);
  check(z.version === 8 && z.platform === 14, 'Texture decoder requires PS4 IGZ v8');
  const relocations = new Set([...z.offsetTables.values()].flatMap((t) => Array.from(t.offsets)));
  const external = new Set(z.offsetTables.get('REXT')?.offsets ?? []),
    exid = z.fixupMap.get('EXID');
  const handleLocations = new Set(z.offsetTables.get('RHND')?.offsets ?? []);
  const handles = new Map(z.tmhnReferences.map((r) => [r.offset, r])),
    tmhn = z.fixupMap.get('TMHN');
  const meshTextures = new Map(),
    warnings = [],
    decodedImages = new Map();
  const typed = (o, type, size) => {
    check(o?.type === type && o.size === size, `Unsupported ${type} layout`);
    return o;
  };
  const pointer = (o, field, span = 8) => {
    check(field >= 0 && field + 8 <= o.size, 'Pointer field exceeds object');
    const ref = z.pointerReferencesByOffset.get(o.offset + field);
    check(ref, 'Missing ordinary object relocation');
    z.resolvePointer(ref.encoded, span);
    return ref.targetOffset;
  };
  const object = (o, field, type, size) => typed(z.objectsByOffset.get(pointer(o, field)), type, size);
  const list = (o, countField) => {
    const count = z.u32(o.offset + countField),
      span = z.u32(o.offset + 0x18);
    check(count <= 4096 && span >= count * 8, 'Invalid material attribute list span');
    if (!count) return [];
    const at = pointer(o, 0x20, count * 8),
      result = [];
    for (let i = 0; i < count; i++) {
      const slot = at + i * 8,
        ref = z.pointerReferencesByOffset.get(slot);
      if (!ref && !relocations.has(slot) && z.buffer.readBigUInt64LE(slot) === 0n) continue;
      check(ref, 'Unresolved material list item');
      const item = z.objectsByOffset.get(ref.targetOffset);
      check(item, 'Material list item is not an object');
      result.push(item);
    }
    return result;
  };
  function decodeImage(image) {
    if (decodedImages.has(image.index)) return decodedImages.get(image.index);
    check(external.has(image.offset + 0x50) && exid, 'Image format is not a validated external reference');
    const index = z.u32(image.offset + 0x50);
    check(index < exid.count, 'Image EXID index out of bounds');
    const format = FORMATS.get(z.u32(exid.dataOffset + index * 8));
    check(
      format && z.u32(exid.dataOffset + index * 8 + 4) === 0x843cd0c2,
      'Unsupported format or format namespace',
    );
    const width = z.buffer.readUInt16LE(image.offset + 0x40),
      height = z.buffer.readUInt16LE(image.offset + 0x42);
    const levels = z.buffer.readUInt16LE(image.offset + 0x46);
    check(
      z.buffer.readUInt16LE(image.offset + 0x44) === 1 && z.u32(image.offset + 0x48) === 1,
      'Only single 2D images are supported',
    );
    const ref = handles.get(image.offset + 0x60);
    check(ref && tmhn && tmhn.end - tmhn.dataOffset === tmhn.count * 16, 'Invalid image memory handle');
    const at = tmhn.dataOffset + ref.tableIndex * 16,
      size = z.u32(at),
      flags = z.u32(at + 4);
    check(flags === 0x30000000 && z.u32(at + 12) === 0, 'Unsupported image handle flags or upper pointer');
    const location = z.resolvePointer(z.u32(at + 8), size);
    check(z.descriptors[location.section].name === 'Image', 'Image payload is outside the Image pool');
    const payload = z.buffer.subarray(location.offset, location.offset + size);
    const layouts = bcMipLayout(width, height, levels, format === 'dxt1_tile_ps4' ? 8 : 16);
    let mip = layouts.find((m) => m.width <= maxDimension && m.height <= maxDimension);
    const minimumMipFallback = !mip;
    // Some original images stop at a larger minimum stored mip. A scene-wide
    // budget retry may use that smallest mip if it still obeys the caller's
    // original dimension cap AND the shared byte budget. Never synthesize it.
    if (!mip)
      mip = layouts.findLast((m) => m.width <= fallbackMaxDimension && m.height <= fallbackMaxDimension);
    check(mip, 'No eligible stored preview mip');
    const payloadSha256 = sha256(payload),
      id = sha256(Buffer.from(`${payloadSha256}:${format}:${width}:${height}:${levels}:${mip.level}`));
    if (!textures.has(id)) {
      check(
        budget.bytes + mip.width * mip.height * 4 <= maxTotalBytes,
        'Texture preview total memory budget exhausted',
      );
      const decoded = decodePs4BcMip(
        payload,
        width,
        height,
        levels,
        format,
        Math.max(maxDimension, mip.width, mip.height),
      );
      const texture = {
        id,
        width: decoded.width,
        height: decoded.height,
        rgbaBase64: decoded.rgba.toString('base64'),
        rgbaSha256: sha256(decoded.rgba),
        sourceWidth: width,
        sourceHeight: height,
        sourceMip: decoded.level,
        sourceImageId: image.index,
        sourceImageName: z.stringReferencesByOffset.get(image.offset + 0x10)?.value ?? '',
        format,
        payloadSha256,
        previewOnly: true,
        reducedResolution: decoded.level !== 0,
        minimumMipFallback,
      };
      textures.set(id, texture);
      budget.bytes += decoded.rgba.length;
    }
    decodedImages.set(image.index, id);
    return id;
  }
  // UV decoding must not depend on a successfully decoded material. Otherwise
  // the checker would conceal exactly the missing-material cases under review.
  function readUvs(drawable, mesh) {
    const format = typed(z.objects[mesh.source?.vertexFormatId], 'igVertexFormat', 0x80);
    const span = z.u32(format.offset + 0x10);
    check(span >= 12 && span <= 384 && span % 12 === 0, 'Invalid vertex format descriptor span');
    const at = pointer(format, 0x18, span),
      uvElements = [],
      channels = [];
    for (let o = at; o < at + span; o += 12)
      if (z.buffer[o + 4] === 5 && z.buffer[o] !== 44) {
        channels.push({
          channel: z.buffer[o + 5],
          type: z.buffer[o],
          stream: z.buffer[o + 1],
          offset: z.buffer.readUInt16LE(o + 8),
          packHint: z.buffer[o + 7],
        });
        if (z.buffer[o + 5] === uvChannel) uvElements.push(o);
      }
    check(uvElements.length === 1, `No unique TEXCOORD${uvChannel} element`);
    const uv = uvElements[0],
      offset = z.buffer.readUInt16LE(uv + 8),
      stride = mesh.source.stride;
    check(
      z.buffer[uv] === 42 && z.buffer[uv + 1] === 0 && z.buffer[uv + 7] === 0 && offset + 4 <= stride,
      `Unsupported packed or non-HALF2 TEXCOORD${uvChannel}`,
    );
    const vb = object(object(drawable, 0x18, 'igGeometryAttr', 0x48), 0x18, 'igVertexBuffer', 0x58);
    check(
      vb.index === mesh.source.vertexBufferId &&
        z.u32(vb.offset + 0xc) === mesh.vertexCount &&
        mesh.vertexCount <= 2_000_000,
      'Mesh and texture vertex source mismatch',
    );
    const vertexRef = handles.get(vb.offset + 0x20);
    check(vertexRef && tmhn, 'Missing UV vertex memory handle');
    const vertexAt = tmhn.dataOffset + vertexRef.tableIndex * 16;
    check(
      z.u32(vertexAt) === mesh.vertexCount * stride &&
        z.u32(vertexAt + 4) === 0 &&
        z.u32(vertexAt + 12) === 0,
      'Invalid UV buffer extent',
    );
    const vertexOffset = z.resolvePointer(z.u32(vertexAt + 8), z.u32(vertexAt)).offset;
    check(vertexOffset === mesh.source.vertexDataOffset, 'UV vertex payload mismatch');
    const uvs = new Array(mesh.vertexCount * 2),
      min = [Infinity, Infinity],
      max = [-Infinity, -Infinity];
    for (let i = 0; i < uvs.length; i++) {
      const value = halfToFloat(
        z.buffer.readUInt16LE(vertexOffset + Math.floor(i / 2) * stride + offset + (i % 2) * 2),
      );
      check(Number.isFinite(value) && Math.abs(value) <= 65504, 'Invalid UV component');
      uvs[i] = value;
      min[i % 2] = Math.min(min[i % 2], value);
      max[i % 2] = Math.max(max[i % 2], value);
    }
    return {
      uvs,
      uvInfo: {
        channel: uvChannel,
        channels,
        min,
        max,
        encoding: 'HALF2',
        vertexBufferId: vb.index,
        vertexDataOffset: vertexOffset,
        stride,
        offset,
        materialTransformApplied: false,
        shaderChannelSelectionVerified: false,
      },
    };
  }
  for (const mesh of meshes) {
    if (meshTextures.has(mesh.id)) continue;
    const result = {
      textureStatus: 'flat fallback',
      textureDiagnosticOverride: imageOverride !== undefined || uvChannel !== 0,
    };
    meshTextures.set(mesh.id, result);
    let drawable;
    try {
      drawable = typed(z.objects[mesh.id], 'Drawable', 0x30);
      Object.assign(result, readUvs(drawable, mesh));
    } catch (error) {
      result.uvFallbackReason = error.message;
    }
    try {
      typed(drawable, 'Drawable', 0x30);
      const material = object(drawable, 0x10, 'tfbRuntimeMaterial', 0x58);
      result.materialId = material.index;
      result.materialName = z.stringReferencesByOffset.get(material.offset + 0x10)?.value ?? '';
      let outdoorFamily;
      if (handleLocations.has(material.offset + 0x38) && exid) {
        const index = z.buffer.readBigUInt64LE(material.offset + 0x38);
        if (index < BigInt(exid.count)) {
          const at = exid.dataOffset + Number(index) * 8,
            nameHash = z.u32(at),
            namespaceHash = z.u32(at + 4);
          if (nameHash === 0xebea2dbb) outdoorFamily = OUTDOOR_EFFECTS.get(namespaceHash);
          result.materialEffect = {
            exidIndex: Number(index),
            nameHash,
            namespaceHash,
            ...(outdoorFamily ? { family: outdoorFamily, samplerProfile: MATERIAL_SAMPLER_PROFILE } : {}),
          };
        }
      }
      result.materialTransformObjectId =
        z.objectsByOffset.get(z.pointerReferencesByOffset.get(material.offset + 0x48)?.targetOffset)?.index ??
        null;
      result.materialDiagnosticWarnings = [];
      try {
        result.materialAnimations = readMaterialAnimations(z, material.index);
      } catch (error) {
        result.materialDiagnosticWarnings.push(error.message);
      }
      const lists = object(material, 0x40, 'igCachedAttrListList', 0x28);
      const candidates = new Map(),
        bindings = new Map(),
        parameters = new Map(),
        states = new Map();
      result.shaderParameters = [];
      result.materialStateAttrs = [];
      result.textureBindings = [];
      for (const cached of list(lists, 0xc)) {
        typed(cached, 'igCachedAttrList', 0x40);
        const attrs = list(cached, 0x10);
        for (const [ordinal, attr] of attrs.entries())
          if (
            ['igColorAttr', 'igVertexShaderVariantMaskAttr', 'igPixelShaderVariantMaskAttr'].includes(
              attr.type,
            )
          ) {
            try {
              if (!states.has(attr.index)) {
                check(states.size < 128, 'Material state diagnostic limit reached');
                let record;
                try {
                  record = readMaterialStateAttr(z, attr.index);
                } catch (error) {
                  record = {
                    id: attr.index,
                    type: attr.type,
                    objectOffset: attr.offset,
                    diagnosticError: error.message,
                    appliedToPreview: false,
                    activeAtRuntime: 'unknown',
                  };
                }
                record.occurrences = [];
                states.set(attr.index, record);
                result.materialStateAttrs.push(record);
              }
              const record = states.get(attr.index);
              check(record.occurrences.length < 128, 'Material state occurrence limit reached');
              record.occurrences.push({ cachedListId: cached.index, attributeOrdinal: ordinal });
            } catch (error) {
              if (!result.materialDiagnosticWarnings.includes(error.message))
                result.materialDiagnosticWarnings.push(error.message);
            }
          }
        for (const attr of attrs)
          if (attr.type === 'igShaderParametersAttr') {
            try {
              typed(attr, 'igShaderParametersAttr', 0x20);
              for (const constant of list(object(attr, 0x18, 'igShaderConstantDataList', 0x28), 0x10)) {
                if (!parameters.has(constant.index)) {
                  check(parameters.size < 128, 'Shader parameter diagnostic limit reached');
                  let record;
                  try {
                    record = readShaderConstant(z, constant.index);
                  } catch (error) {
                    record = {
                      id: constant.index,
                      type: constant.type,
                      objectOffset: constant.offset,
                      name: z.stringReferencesByOffset.get(constant.offset + 0x10)?.value ?? '',
                      diagnosticError: error.message,
                      appliedToPreview: false,
                      activeAtRuntime: 'unknown',
                    };
                  }
                  record.occurrences = [];
                  parameters.set(constant.index, record);
                  result.shaderParameters.push(record);
                }
                const record = parameters.get(constant.index);
                check(record.occurrences.length < 128, 'Shader parameter occurrence limit reached');
                record.occurrences.push({ cachedListId: cached.index, parametersAttrId: attr.index });
              }
            } catch (error) {
              if (!result.materialDiagnosticWarnings.includes(error.message))
                result.materialDiagnosticWarnings.push(error.message);
            }
          }
        let bindingOrdinal = 0;
        for (const attr of attrs)
          if (attr.type === 'tfbTextureBindAttr') {
            typed(attr, 'tfbTextureBindAttr', 0x38);
            const texture = object(attr, 0x18, 'igTextureAttr2', 0x60),
              image = object(texture, 0x38, 'igImage2', 0x80);
            const name = z.stringReferencesByOffset.get(image.offset + 0x10)?.value ?? '';
            const cachedUnitId = z.buffer.readInt16LE(attr.offset + 0xc);
            const wrapRaw = [z.u32(texture.offset + 0x24), z.u32(texture.offset + 0x28)];
            if (!bindings.has(attr.index)) {
              const binding = {
                bindId: attr.index,
                textureId: texture.index,
                imageId: image.index,
                name,
                sourceWidth: z.buffer.readUInt16LE(image.offset + 0x40),
                sourceHeight: z.buffer.readUInt16LE(image.offset + 0x42),
                wrapRaw,
                magFilterRaw: z.u32(texture.offset + 0x1c),
                minFilterRaw: z.u32(texture.offset + 0x20),
                cachedUnitId,
                serializedUnitId: z.buffer.readInt32LE(attr.offset + 0x20),
                shaderRoleVerified: false,
                occurrences: [],
              };
              bindings.set(attr.index, binding);
              result.textureBindings.push(binding);
              if (outdoorFamily && [0, 4, 5].includes(cachedUnitId))
                binding.reflectedSamplerRole =
                  cachedUnitId === 0 ? 'diffuse' : cachedUnitId === 4 ? 'diffuse2' : 'emissive';
            }
            bindings
              .get(attr.index)
              .occurrences.push({ cachedListId: cached.index, bindingOrdinal: bindingOrdinal++ });
            // Image names are storage/deduplication labels, not shader roles:
            // native assets can bind HeightMap#default_h as diffuse, or reuse a
            // ColorMap in a packed/non-diffuse slot. Only recognized effect
            // profiles can replace the name heuristic with reflected units.
            if (
              imageOverride !== undefined
                ? image.index !== imageOverride
                : outdoorFamily
                  ? ![0, 4].includes(cachedUnitId)
                  : !name.startsWith('ColorMap#')
            )
              continue;
            const wrapS = WRAPS[wrapRaw[0]],
              wrapT = WRAPS[wrapRaw[1]];
            check(wrapS && wrapT, 'Unsupported color-map sampler wrap mode');
            const magFilterRaw = z.u32(texture.offset + 0x1c),
              minFilterRaw = z.u32(texture.offset + 0x20);
            candidates.set(`${image.index}:${wrapS}:${wrapT}:${magFilterRaw}:${minFilterRaw}`, {
              image,
              wrapS,
              wrapT,
              magFilterRaw,
              minFilterRaw,
            });
          }
      }
      check(
        candidates.size === 1,
        imageOverride !== undefined
          ? 'Diagnostic image is absent or has ambiguous samplers in this material'
          : candidates.size
            ? 'Multiple diffuse candidates; shader composition is not decoded'
            : outdoorFamily
              ? 'No bound reflected diffuse sampler'
              : 'No unique named ColorMap image',
      );
      check(result.uvs, result.uvFallbackReason ?? 'Missing UVs');
      const { image, wrapS, wrapT, magFilterRaw, minFilterRaw } = [...candidates.values()][0];
      const linear = [1, 4, 5, 6, 7, 8];
      check(
        magFilterRaw <= 8 &&
          minFilterRaw <= 8 &&
          linear.includes(magFilterRaw) === linear.includes(minFilterRaw),
        'Unsupported or mixed within-mip sampler filters',
      );
      const textureId = decodeImage(image);
      Object.assign(result, {
        textureId,
        textureWrapS: wrapS,
        textureWrapT: wrapT,
        textureStatus:
          imageOverride !== undefined
            ? 'diagnostic bound-image override; NOT verified material rendering'
            : outdoorFamily
              ? 'single reflected diffuse sampler RGB preview'
              : 'single named ColorMap RGB preview',
        textureSourceSelection:
          imageOverride !== undefined
            ? 'diagnostic-override'
            : outdoorFamily
              ? 'reflected-diffuse-sampler'
              : 'image-name-candidate',
        textureSourceImageId: image.index,
      });
      // A single stored mip cannot reproduce native trilinear/anisotropic LOD.
      // Honor proven within-mip linear vs nearest filtering, and disclose this.
      result.textureFilter = linear.includes(magFilterRaw) ? 'linear' : 'nearest';
      result.textureMagFilter = linear.includes(magFilterRaw) ? 'linear' : 'nearest';
      result.textureMinFilter = linear.includes(minFilterRaw) ? 'linear' : 'nearest';
      result.textureFilteringLimitation = 'One stored mip; no native mip-chain LOD or anisotropy';
    } catch (error) {
      result.textureFallbackReason = error.message;
      warnings.push(`Drawable ${mesh.id}: ${error.message}`);
    }
  }
  return { meshTextures, textures, budget, warnings, limitations: TEXTURE_LIMITATIONS };
}
