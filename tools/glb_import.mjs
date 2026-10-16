// Static glTF 2.0 / GLB import. No URI fetching, scripts, skins or animation.
// The authored document is also the input to the source-pinned native workshop.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateAuthoredScene, buildAuthoredScene } from './authored_scene.mjs';

const hash = (b) => createHash('sha256').update(b).digest('hex');
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const multiply = (a, b) =>
  Array.from({ length: 16 }, (_, i) =>
    [0, 1, 2, 3].reduce((v, k) => v + a[k * 4 + (i % 4)] * b[Math.floor(i / 4) * 4 + k], 0),
  );
const point = (m, p) => [0, 1, 2].map((i) => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);
function vec(v, n, label) {
  assert.ok(Array.isArray(v) && v.length === n && v.every(Number.isFinite), 'Invalid ' + label);
  return v;
}
function index(list, i, label) {
  assert.ok(Number.isSafeInteger(i) && i >= 0 && i < list.length, 'Invalid ' + label);
  return list[i];
}
export function boundsOf(meshes) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes)
    for (let i = 0; i < m.positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3], m.positions[i]);
      max[i % 3] = Math.max(max[i % 3], m.positions[i]);
    }
  return { min, max };
}
function nodeMatrix(n) {
  if (n.matrix) {
    assert.ok(!n.translation && !n.rotation && !n.scale, 'Node cannot have both matrix and TRS');
    const m = vec(n.matrix, 16, 'matrix');
    assert.ok(m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] === 1, 'Expected affine matrix');
    return m;
  }
  const [x, y, z, w] = vec(n.rotation ?? [0, 0, 0, 1], 4, 'quaternion');
  assert.ok(Math.abs(Math.hypot(x, y, z, w) - 1) < 1e-4, 'Non-unit quaternion');
  const s = vec(n.scale ?? [1, 1, 1], 3, 'scale'),
    t = vec(n.translation ?? [0, 0, 0], 3, 'translation');
  assert.ok(
    s.every((v) => Math.abs(v) > 1e-8),
    'Singular node scale',
  );
  return [
    (1 - 2 * y * y - 2 * z * z) * s[0],
    (2 * x * y + 2 * w * z) * s[0],
    (2 * x * z - 2 * w * y) * s[0],
    0,
    (2 * x * y - 2 * w * z) * s[1],
    (1 - 2 * x * x - 2 * z * z) * s[1],
    (2 * y * z + 2 * w * x) * s[1],
    0,
    (2 * x * z + 2 * w * y) * s[2],
    (2 * y * z - 2 * w * x) * s[2],
    (1 - 2 * x * x - 2 * y * y) * s[2],
    0,
    ...t,
    1,
  ];
}
function normalMatrix(m) {
  const a = m[0],
    b = m[4],
    c = m[8],
    d = m[1],
    e = m[5],
    f = m[9],
    g = m[2],
    h = m[6],
    i = m[10];
  const cof = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
  const det = a * cof[0] + b * cof[3] + c * cof[6];
  assert.ok(Number.isFinite(det) && Math.abs(det) > 1e-12, 'Singular node matrix');
  return {
    det,
    apply: (n) => {
      const p = [0, 1, 2].map((i) => (cof[i] * n[0] + cof[3 + i] * n[1] + cof[6 + i] * n[2]) / det),
        length = Math.hypot(...p);
      assert.ok(length > 1e-10, 'Zero normal');
      return p.map((v) => v / length);
    },
  };
}
function image(bytes, mime) {
  assert.ok(['image/png', 'image/jpeg'].includes(mime), 'Only embedded PNG/JPEG textures are supported');
  assert.ok(bytes.length <= 16 * 1024 * 1024, 'Image exceeds 16 MiB');
  assert.ok(
    mime === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : bytes[0] === 255 && bytes[1] === 216,
    'Image signature mismatch',
  );
  const r = spawnSync(
    'magick',
    [
      '-limit',
      'width',
      '8192',
      '-limit',
      'height',
      '8192',
      '-limit',
      'memory',
      '128MiB',
      '-limit',
      'map',
      '128MiB',
      '-limit',
      'disk',
      '0',
      (mime === 'image/png' ? 'png' : 'jpeg') + ':-',
      '-resize',
      '512x512>',
      '-colorspace',
      'sRGB',
      '-alpha',
      'on',
      '-depth',
      '8',
      'pam:-',
    ],
    { input: bytes, timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
  );
  assert.ok(
    !r.error && r.status === 0,
    'Texture decoding failed (ImageMagick magick is required): ' +
      (r.error?.message ?? r.stderr?.toString().slice(0, 200)),
  );
  const end = r.stdout.indexOf('ENDHDR\n');
  assert.ok(end > 0 && end < 1024, 'Invalid decoded image header');
  const header = r.stdout.subarray(0, end).toString();
  const width = Number(/WIDTH (\d+)/.exec(header)?.[1]),
    height = Number(/HEIGHT (\d+)/.exec(header)?.[1]);
  assert.ok(
    /DEPTH 4\n/.test(header) &&
      /MAXVAL 255\n/.test(header) &&
      width > 0 &&
      height > 0 &&
      width <= 512 &&
      height <= 512,
    'Unsupported decoded image',
  );
  const rgba = r.stdout.subarray(end + 7);
  assert.equal(rgba.length, width * height * 4);
  return { width, height, rgba };
}

export function importGlb(bytes, { name = 'Imported model', base = null, alphaPolicy = 'opaque' } = {}) {
  assert.ok(['opaque', 'reject'].includes(alphaPolicy), 'alphaPolicy must be opaque or reject');
  assert.ok(
    Buffer.isBuffer(bytes) && bytes.length >= 28 && bytes.length <= 128 * 1024 * 1024,
    'GLB size limit',
  );
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'Expected GLB');
  assert.equal(bytes.readUInt32LE(4), 2, 'Expected glTF 2.0');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'GLB length mismatch');
  const chunks = [];
  for (let at = 12; at < bytes.length; ) {
    assert.ok(at + 8 <= bytes.length, 'Truncated chunk');
    const length = bytes.readUInt32LE(at);
    assert.ok(length % 4 === 0 && at + 8 + length <= bytes.length, 'Invalid chunk length');
    chunks.push({ type: bytes.readUInt32LE(at + 4), data: bytes.subarray(at + 8, at + 8 + length) });
    at += 8 + length;
  }
  assert.ok(
    chunks.length === 2 && chunks[0].type === 0x4e4f534a && chunks[1].type === 0x004e4942,
    'Expected JSON and BIN chunks',
  );
  assert.ok(chunks[0].data.length <= 8 * 1024 * 1024, 'GLB JSON limit');
  const g = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(chunks[0].data)),
    bin = chunks[1].data;
  assert.equal(g.asset?.version, '2.0');
  assert.ok(!g.extensionsRequired?.length, 'Required glTF extensions are unsupported');
  assert.ok(
    !g.animations?.length && !g.skins?.length,
    'Export a static mesh: skins/animations are unsupported',
  );
  assert.ok(
    g.buffers?.length === 1 &&
      !g.buffers[0].uri &&
      Number.isSafeInteger(g.buffers[0].byteLength) &&
      g.buffers[0].byteLength > 0 &&
      g.buffers[0].byteLength <= bin.length &&
      bin.length - g.buffers[0].byteLength <= 3,
    'Expected embedded BIN buffer',
  );
  assert.ok(g.nodes?.length > 0 && g.nodes.length <= 10000, 'Node count limit');
  const view = (i) => {
    const v = index(g.bufferViews ?? [], i, 'buffer view');
    assert.equal(v.buffer, 0);
    const at = v.byteOffset ?? 0;
    assert.ok(
      Number.isSafeInteger(at) &&
        at >= 0 &&
        Number.isSafeInteger(v.byteLength) &&
        v.byteLength > 0 &&
        at + v.byteLength <= g.buffers[0].byteLength,
      'Buffer view out of bounds',
    );
    return { ...v, at };
  };
  let decodedValues = 0;
  function accessor(i, type) {
    const a = index(g.accessors ?? [], i, 'accessor');
    assert.equal(a.type, type, 'Accessor type mismatch');
    assert.ok(!a.sparse, 'Sparse accessors unsupported');
    const format = {
      5121: [1, 'readUInt8'],
      5123: [2, 'readUInt16LE'],
      5125: [4, 'readUInt32LE'],
      5126: [4, 'readFloatLE'],
    }[a.componentType];
    assert.ok(format, 'Unsupported component type');
    const count = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type],
      v = view(a.bufferView),
      start = a.byteOffset ?? 0,
      stride = v.byteStride ?? count * format[0];
    assert.ok(Number.isSafeInteger(a.count) && a.count > 0 && a.count <= 2000000, 'Accessor count limit');
    decodedValues += a.count * count;
    assert.ok(decodedValues <= 16000000, 'Decoded accessor budget');
    assert.ok(
      Number.isSafeInteger(start) &&
        start >= 0 &&
        (v.at + start) % format[0] === 0 &&
        Number.isSafeInteger(stride) &&
        stride >= count * format[0] &&
        stride <= 252 &&
        stride % format[0] === 0 &&
        start + (a.count - 1) * stride + count * format[0] <= v.byteLength,
      'Accessor out of bounds/alignment',
    );
    if (a.normalized) assert.ok([5121, 5123].includes(a.componentType), 'Invalid normalized accessor');
    const result = Array.from(
      { length: a.count * count },
      (_, n) =>
        bin[format[1]](v.at + start + Math.floor(n / count) * stride + (n % count) * format[0]) /
        (a.normalized ? (a.componentType === 5121 ? 255 : 65535) : 1),
    );
    assert.ok(result.every(Number.isFinite), 'Nonfinite accessor');
    return result;
  }
  const document = base
    ? structuredClone(base)
    : {
        schema: 'skylanders-authored-scene-v1',
        name: 'Model workshop',
        objects: [],
        meshes: [],
        textures: [],
        environment: {
          authored: true,
          skyColor: [0.34, 0.48, 0.66],
          ambientColor: [0.34, 0.38, 0.43],
          sunDirection: [-0.5, -0.8, -0.3],
          sunColor: [1, 0.94, 0.83],
          sunIntensity: 0.8,
        },
      };
  if (base) validateAuthoredScene(base);
  const actorId = Math.max(0, ...document.objects.map((o) => o.id)) + 1;
  let meshId = Math.max(0, ...document.meshes.map((m) => m.id)) + 1;
  const meshes = [],
    warnings = new Set(),
    materials = new Map(),
    images = new Map(),
    visited = new Set(),
    materialConversions = [];
  function material(i) {
    if (materials.has(i)) return materials.get(i);
    const m = i === undefined ? {} : index(g.materials ?? [], i, 'material'),
      p = m.pbrMetallicRoughness ?? {},
      factor = vec(p.baseColorFactor ?? [1, 1, 1, 1], 4, 'base color');
    assert.ok(
      factor.every((v) => v >= 0 && v <= 1),
      'Invalid base color factor',
    );
    const alphaMode = m.alphaMode ?? 'OPAQUE';
    assert.ok(['OPAQUE', 'MASK', 'BLEND'].includes(alphaMode), 'Invalid material alphaMode');
    const cutoff = m.alphaCutoff ?? 0.5;
    if (alphaMode === 'MASK') assert.ok(Number.isFinite(cutoff) && cutoff >= 0, 'Invalid alpha cutoff');
    let decoded = { width: 1, height: 1, rgba: Buffer.from([255, 255, 255, 255]) },
      wrapS = 'repeat',
      wrapT = 'repeat';
    if (p.baseColorTexture) {
      assert.equal(p.baseColorTexture.texCoord ?? 0, 0, 'Only TEXCOORD_0 supported');
      assert.ok(!p.baseColorTexture.extensions, 'Texture transforms unsupported');
      const t = index(g.textures ?? [], p.baseColorTexture.index, 'texture'),
        im = index(g.images ?? [], t.source, 'image');
      assert.ok(!im.uri, 'External/data URI images unsupported; embed images in GLB');
      if (!images.has(t.source)) {
        const v = view(im.bufferView);
        images.set(t.source, image(bin.subarray(v.at, v.at + v.byteLength), im.mimeType));
      }
      decoded = images.get(t.source);
      const sampler = t.sampler === undefined ? {} : index(g.samplers ?? [], t.sampler, 'sampler');
      assert.ok(
        [10497, 33071].includes(sampler.wrapS ?? 10497) && [10497, 33071].includes(sampler.wrapT ?? 10497),
        'Mirrored texture wrapping unsupported',
      );
      wrapS = (sampler.wrapS ?? 10497) === 10497 ? 'repeat' : 'clamp';
      wrapT = (sampler.wrapT ?? 10497) === 10497 ? 'repeat' : 'clamp';
    }
    // Exporters often mark fully opaque materials BLEND. Accept those without
    // a warning. Actual transparency is an explicit, recorded approximation;
    // the current native material pipeline does not implement alpha blending.
    let losesAlpha = false;
    for (let n = 3; alphaMode !== 'OPAQUE' && n < decoded.rgba.length; n += 4) {
      const alpha = (decoded.rgba[n] / 255) * factor[3];
      if (alphaMode === 'MASK' ? alpha < cutoff : alpha < 1) {
        losesAlpha = true;
        break;
      }
    }
    if (losesAlpha) {
      const label = typeof m.name === 'string' ? m.name.slice(0, 128) : `Material ${i ?? 'default'}`;
      assert.notEqual(
        alphaPolicy,
        'reject',
        `${label}: transparency requires alphaPolicy=opaque (approximation); native alpha rendering is not implemented`,
      );
      warnings.add(
        `${label}: ${alphaMode} transparency imported as opaque. Glass and cutout edges will not render transparently.`,
      );
      materialConversions.push({
        material: i ?? null,
        name: label,
        alphaMode,
        alphaCutoff: alphaMode === 'MASK' ? cutoff : null,
        policy: 'opaque',
      });
    }
    const rgba = Buffer.from(decoded.rgba),
      linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4),
      srgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
    for (let n = 0; n < rgba.length; n += 4) {
      for (let c = 0; c < 3; c++) rgba[n + c] = Math.round(srgb(linear(rgba[n + c] / 255) * factor[c]) * 255);
      rgba[n + 3] = 255;
    }
    const digest = hash(rgba),
      id = hash(Buffer.concat([Buffer.from(`${decoded.width},${decoded.height}:`), rgba]));
    if (!document.textures.some((t) => t.id === id))
      document.textures.push({
        id,
        width: decoded.width,
        height: decoded.height,
        rgbaBase64: rgba.toString('base64'),
        rgbaSha256: digest,
      });
    if (m.normalTexture || m.occlusionTexture || m.emissiveTexture || p.metallicRoughnessTexture)
      warnings.add('Native material uses base color only; normal/PBR/emissive maps are not imported.');
    const result = {
      textureId: id,
      textureWrapS: wrapS,
      textureWrapT: wrapT,
      textureFilter: 'linear',
      requiresUv: !!p.baseColorTexture,
    };
    materials.set(i, result);
    return result;
  }
  function visit(id, parent, depth) {
    assert.ok(depth <= 64 && !visited.has(id), 'Cyclic/shared node hierarchy or depth limit');
    visited.add(id);
    const node = index(g.nodes, id, 'node');
    assert.ok(node.skin === undefined && !node.weights, 'Skinned/morphed nodes unsupported');
    const world = multiply(parent, nodeMatrix(node)),
      nm = normalMatrix(world);
    if (node.mesh !== undefined)
      for (const primitive of index(g.meshes ?? [], node.mesh, 'mesh').primitives ?? []) {
        assert.equal(primitive.mode ?? 4, 4, 'Only triangle primitives supported');
        assert.ok(!primitive.targets && !primitive.extensions, 'Morph/compressed primitives unsupported');
        assert.equal(
          index(g.accessors, primitive.attributes?.POSITION, 'position accessor').componentType,
          5126,
          'POSITION must be float',
        );
        const positions = accessor(primitive.attributes.POSITION, 'VEC3'),
          count = positions.length / 3;
        if (primitive.indices !== undefined) {
          const a = index(g.accessors, primitive.indices, 'indices');
          assert.ok(
            [5121, 5123, 5125].includes(a.componentType) && !a.normalized,
            'Indices must be unsigned integers',
          );
        }
        const indices =
          primitive.indices === undefined
            ? Array.from({ length: count }, (_, i) => i)
            : accessor(primitive.indices, 'SCALAR');
        assert.ok(
          indices.length % 3 === 0 && indices.every((v) => Number.isSafeInteger(v) && v >= 0 && v < count),
          'Invalid triangle indices',
        );
        for (let n = 0; n < positions.length; n += 3) {
          const p = point(world, positions.slice(n, n + 3));
          for (let c = 0; c < 3; c++) positions[n + c] = p[c];
        }
        if (nm.det < 0)
          for (let n = 0; n < indices.length; n += 3)
            [indices[n + 1], indices[n + 2]] = [indices[n + 2], indices[n + 1]];
        let normals;
        if (primitive.attributes.NORMAL !== undefined) {
          normals = accessor(primitive.attributes.NORMAL, 'VEC3');
          assert.equal(normals.length, positions.length);
          for (let n = 0; n < normals.length; n += 3) {
            const p = nm.apply(normals.slice(n, n + 3));
            for (let c = 0; c < 3; c++) normals[n + c] = p[c];
          }
        } else {
          normals = Array(positions.length).fill(0);
          for (let n = 0; n < indices.length; n += 3) {
            const [a, b, c] = indices.slice(n, n + 3).map((i) => positions.slice(i * 3, i * 3 + 3)),
              u = b.map((v, i) => v - a[i]),
              v = c.map((v, i) => v - a[i]);
            const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            for (const i of indices.slice(n, n + 3))
              for (let c = 0; c < 3; c++) normals[i * 3 + c] += normal[c];
          }
          for (let n = 0; n < normals.length; n += 3) {
            const length = Math.hypot(...normals.slice(n, n + 3));
            if (length < 1e-12) {
              normals[n] = 0;
              normals[n + 1] = 1;
              normals[n + 2] = 0;
            } else for (let c = 0; c < 3; c++) normals[n + c] /= length;
          }
        }
        const mat = material(primitive.material);
        assert.ok(
          !mat.requiresUv || primitive.attributes.TEXCOORD_0 !== undefined,
          'Textured mesh has no UV0',
        );
        const uvs =
          primitive.attributes.TEXCOORD_0 === undefined
            ? Array(count * 2).fill(0)
            : accessor(primitive.attributes.TEXCOORD_0, 'VEC2');
        assert.equal(uvs.length, count * 2);
        const { requiresUv, ...renderMaterial } = mat;
        meshes.push({
          id: meshId++,
          name: node.name ?? name,
          selectionKey: `glb:${actorId}:${meshId}`,
          actorId,
          actorBasePosition: [0, 0, 0],
          editable: true,
          positions,
          normals,
          uvs,
          indices,
          ...renderMaterial,
        });
      }
    for (const child of node.children ?? []) visit(child, world, depth + 1);
  }
  for (const id of index(g.scenes ?? [], g.scene ?? 0, 'scene').nodes ?? []) visit(id, identity(), 0);
  assert.ok(meshes.length > 0, 'GLB has no static triangles');
  const bounds = boundsOf(meshes),
    pivot = [(bounds.min[0] + bounds.max[0]) / 2, bounds.min[1], (bounds.min[2] + bounds.max[2]) / 2];
  // One editable root per import. Place the bottom-center at the origin.
  for (const m of meshes) m.positions = m.positions.map((v, i) => v - pivot[i % 3]);
  const local = boundsOf(meshes),
    dimensions = local.max.map((v, i) => Math.max(0.05, v - local.min[i]));
  document.objects.push({
    id: actorId,
    index: actorId,
    name,
    type: 'ImportedStaticModel',
    position: [0, 0, 0],
    worldPosition: [0, 0, 0],
    parentObjectId: null,
    editable: true,
    worldEditable: true,
    rotationDegrees: [0, 0, 0],
    scale: [1, 1, 1],
    collision: { shape: 'box', dimensions, offset: [0, 0, 0], generated: true },
    bounds: local,
  });
  document.meshes.push(...meshes);
  document.bounds = boundsOf(document.meshes);
  document.contentBounds = boundsOf(document.meshes.filter((m) => !m.sky));
  document.nativeRecipe = 'cusa00697-static-workshop-v1';
  document.warnings = [...new Set([...(document.warnings ?? []), ...warnings])];
  document.imports ??= [];
  document.imports.push({
    format: 'glb',
    sha256: hash(bytes),
    name,
    actorId,
    pivot,
    alphaPolicy,
    materialConversions,
    triangles: meshes.reduce((n, m) => n + m.indices.length / 3, 0),
    warnings: [...warnings],
  });
  validateAuthoredScene(document);
  return { document, actorId, warnings: [...warnings], materialConversions };
}
function read(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    assert.ok(before.isFile() && before.size <= 128 * 1024 * 1024, 'Input size/type limit');
    const b = fs.readFileSync(fd),
      after = fs.fstatSync(fd);
    assert.ok(
      before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
      'Input changed',
    );
    return b;
  } finally {
    fs.closeSync(fd);
  }
}
export function runGlbImport(request) {
  assert.ok(
    request &&
      Object.keys(request).every((k) =>
        ['path', 'output', 'basePath', 'expectedSha256', 'edits', 'alphaPolicy'].includes(k),
      ),
    'Invalid import request',
  );
  assert.ok(
    path.isAbsolute(request.path) &&
      path.isAbsolute(request.output) &&
      request.output.endsWith('.scene.json'),
    'Absolute GLB and new .scene.json output required',
  );
  assert.ok(!fs.existsSync(request.output), 'Import output already exists');
  let base = null;
  if (request.basePath) {
    const b = read(request.basePath);
    base = JSON.parse(
      buildAuthoredScene(b, { expectedSha256: request.expectedSha256, edits: request.edits ?? [] }).buffer,
    );
  }
  const result = importGlb(read(request.path), {
    name: path.basename(request.path, '.glb'),
    base,
    alphaPolicy: request.alphaPolicy,
  });
  const bytes = Buffer.from(JSON.stringify(result.document) + '\n');
  assert.ok(bytes.length <= 128 * 1024 * 1024, 'Imported scene exceeds document budget');
  fs.writeFileSync(request.output, bytes, { flag: 'wx', mode: 0o600 });
  return {
    output: request.output,
    sha256: hash(bytes),
    actorId: result.actorId,
    warnings: result.warnings,
    materialConversions: result.materialConversions,
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let input = '';
    for await (const c of process.stdin) {
      input += c;
      assert.ok(input.length < 4 * 1024 * 1024, 'Request budget');
    }
    console.log(JSON.stringify(runGlbImport(JSON.parse(input))));
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
    process.exitCode = 1;
  }
}
