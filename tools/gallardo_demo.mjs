#!/usr/bin/env node
// Static data import only. Never evaluate JBeam expressions or archive scripts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inflateRawSync, crc32 } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { parseBeamngShape, shapeObjects, meshPrimitives } from './beamng_shape.mjs';
import { validateAuthoredScene } from './authored_scene.mjs';
const check = (v, m) => {
  if (!v) throw new Error(m);
};
const hash = (b) => createHash('sha256').update(b).digest('hex');
const ROOT = 'vehicles/LXRGall/';
const MiB = 1024 * 1024;

export class BoundedZip {
  constructor(filename) {
    this.fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    this.entries = new Map();
    try {
      const stat = fs.fstatSync(this.fd);
      check(stat.isFile() && stat.size >= 22 && stat.size <= 1024 * MiB, 'ZIP size/type limit');
      this.size = stat.size;
      const tail = this.readSpan(Math.max(0, this.size - 65557), Math.min(this.size, 65557));
      let end = -1;
      for (let i = tail.length - 22; i >= 0; i--)
        if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) {
          end = i;
          break;
        }
      check(end >= 0, 'ZIP end record missing');
      const n = tail.readUInt16LE(end + 10),
        length = tail.readUInt32LE(end + 12),
        offset = tail.readUInt32LE(end + 16);
      check(
        tail.readUInt32LE(end + 4) === 0 &&
          tail.readUInt16LE(end + 8) === n &&
          n < 10000 &&
          length <= 16 * MiB,
        'Unsupported ZIP volume/count',
      );
      check(offset + length <= this.size - tail.length + end, 'ZIP directory bounds');
      const central = this.readSpan(offset, length);
      let at = 0;
      for (let i = 0; i < n; i++) {
        check(at + 46 <= central.length && central.readUInt32LE(at) === 0x02014b50, 'Invalid ZIP directory');
        const nl = central.readUInt16LE(at + 28),
          el = central.readUInt16LE(at + 30),
          cl = central.readUInt16LE(at + 32);
        check(at + 46 + nl + el + cl <= central.length, 'ZIP name bounds');
        const name = new TextDecoder('utf-8', { fatal: true }).decode(
          central.subarray(at + 46, at + 46 + nl),
        );
        check(
          name.length > 0 &&
            !name.startsWith('/') &&
            !name.includes('\\') &&
            !name.includes('\0') &&
            !name.split('/').some((p) => p === '..' || p === '.'),
          'Unsafe ZIP member name',
        );
        check(!this.entries.has(name), 'Duplicate ZIP member');
        this.entries.set(name, {
          name,
          flags: central.readUInt16LE(at + 8),
          method: central.readUInt16LE(at + 10),
          crc: central.readUInt32LE(at + 16),
          compressed: central.readUInt32LE(at + 20),
          size: central.readUInt32LE(at + 24),
          offset: central.readUInt32LE(at + 42),
          mode: central.readUInt32LE(at + 38) >>> 16,
        });
        at += 46 + nl + el + cl;
      }
      check(at === central.length, 'ZIP directory trailing bytes');
      const digest = createHash('sha256'),
        chunk = Buffer.alloc(8 * MiB);
      for (let pos = 0; pos < this.size; ) {
        const got = fs.readSync(this.fd, chunk, 0, Math.min(chunk.length, this.size - pos), pos);
        check(got > 0, 'ZIP changed while hashing');
        digest.update(chunk.subarray(0, got));
        pos += got;
      }
      this.sha256 = digest.digest('hex');
    } catch (e) {
      this.close();
      throw e;
    }
  }
  readSpan(at, n) {
    check(
      Number.isSafeInteger(at) && Number.isSafeInteger(n) && at >= 0 && n >= 0 && at + n <= this.size,
      'ZIP span bounds',
    );
    const b = Buffer.alloc(n);
    check(fs.readSync(this.fd, b, 0, n, at) === n, 'Short ZIP read');
    return b;
  }
  read(name, max = 128 * MiB) {
    const e = this.entries.get(name);
    check(e && !name.endsWith('/'), 'Missing ZIP member ' + name);
    check(
      !(e.flags & 1) && [0, 8].includes(e.method) && (e.mode & 0xf000) !== 0xa000,
      'Unsupported encrypted/symlink/compression member',
    );
    check(e.size <= max && e.compressed <= 128 * MiB, 'ZIP member budget');
    const h = this.readSpan(e.offset, 30);
    check(h.readUInt32LE(0) === 0x04034b50 && h.readUInt16LE(8) === e.method, 'Invalid ZIP local header');
    const nl = h.readUInt16LE(26),
      el = h.readUInt16LE(28);
    check(this.readSpan(e.offset + 30, nl).toString('utf8') === name, 'ZIP local name mismatch');
    const data = this.readSpan(e.offset + 30 + nl + el, e.compressed);
    const out = e.method === 0 ? data : inflateRawSync(data, { maxOutputLength: Math.max(e.size, 1) });
    check(out.length === e.size && crc32(out) === e.crc, 'ZIP size/CRC mismatch');
    return out;
  }
  close() {
    if (this.fd !== undefined) {
      fs.closeSync(this.fd);
      this.fd = undefined;
    }
  }
}

// BeamNG data accepts comments, trailing/omitted commas. This parser accepts
// only JSON values; no eval, Function, Lua, includes or host property lookup.
export function parseJbeam(text) {
  check(typeof text === 'string' && text.length <= 8 * MiB, 'JBeam text budget');
  let at = 0,
    items = 0;
  function skip() {
    while (at < text.length) {
      if (/\s/.test(text[at])) {
        at++;
        continue;
      }
      if (text.startsWith('//', at)) {
        at = text.indexOf('\n', at);
        if (at < 0) at = text.length;
        continue;
      }
      if (text.startsWith('/*', at)) {
        const end = text.indexOf('*/', at + 2);
        check(end >= 0, 'Unterminated JBeam comment');
        at = end + 2;
        continue;
      }
      break;
    }
  }
  function string() {
    const start = at++;
    while (at < text.length) {
      if (text[at] === '\\') {
        at += 2;
        continue;
      }
      if (text[at++] === '"') return JSON.parse(text.slice(start, at));
    }
    throw new Error('Unterminated JBeam string');
  }
  function value(depth = 0) {
    skip();
    check(depth <= 64 && ++items <= 1000000, 'JBeam complexity limit');
    const c = text[at];
    if (c === '"') return string();
    if (c === '{' || c === '[') {
      at++;
      const object = c === '{',
        out = object ? Object.create(null) : [],
        end = object ? '}' : ']';
      skip();
      while (text[at] !== end) {
        check(at < text.length, 'Unterminated JBeam container');
        if (text[at] === ',') {
          at++;
          skip();
          continue;
        }
        if (object) {
          check(text[at] === '"', 'Expected quoted JBeam key');
          const key = string();
          skip();
          check(text[at++] === ':', 'Expected JBeam colon');
          check(!['__proto__', 'prototype', 'constructor'].includes(key), 'Unsafe JBeam key');
          out[key] = value(depth + 1);
        } else out.push(value(depth + 1));
        skip();
      }
      at++;
      return out;
    }
    for (const [token, v] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ])
      if (text.startsWith(token, at)) {
        at += token.length;
        return v;
      }
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at));
    check(m, 'Unsupported JBeam token at ' + at);
    at += m[0].length;
    const n = Number(m[0]);
    check(Number.isFinite(n), 'Nonfinite JBeam number');
    return n;
  }
  const result = value();
  skip();
  check(at === text.length, 'Trailing JBeam tokens');
  return result;
}

export function numericSetting(value, vars) {
  if (typeof value === 'number') {
    check(Number.isFinite(value) && Math.abs(value) <= 10000, 'Transform numeric limit');
    return value;
  }
  check(typeof value === 'string', 'Unsupported transform setting');
  if (/^\$[A-Za-z_][A-Za-z_0-9]*$/.test(value)) return numericSetting(vars[value], vars);
  const m =
    /^\$=case\(\$(trackwidth_[FR]) == nil, \$(trackoffset_[FR])\+([0-9.]+), \$(trackwidth_[FR])\)$/.exec(
      value,
    );
  check(
    m && m[1] === m[4] && m[1].at(-1) === m[2].at(-1),
    'Unsupported transform expression (not executed): ' + value,
  );
  return Object.hasOwn(vars, '$' + m[1])
    ? numericSetting(vars['$' + m[1]], vars)
    : numericSetting(vars['$' + m[2]], vars) + Number(m[3]);
}
const xyz = (o, def, vars) =>
  ['x', 'y', 'z'].map((k) => (o && Object.hasOwn(o, k) ? numericSetting(o[k], vars) : def));

export function selectFlexbodies(config, parts) {
  check(
    config && typeof config.mainPartName === 'string' && config.parts && config.vars,
    'Invalid vehicle configuration',
  );
  const instances = [],
    missingParts = [],
    visited = new Set(),
    selectedParts = [];
  function visit(name, slotPath, offset = [0, 0, 0], depth = 0) {
    check(depth < 40 && visited.size < 1000, 'Part graph complexity');
    const key = slotPath + '|' + name;
    if (visited.has(key)) return;
    visited.add(key);
    const part = parts.get(name);
    if (!part) {
      missingParts.push({ name, slotPath });
      return;
    }
    selectedParts.push(name);
    let defaults = {};
    for (const row of part.flexbodies || []) {
      if (!Array.isArray(row)) {
        if (row && typeof row === 'object') defaults = { ...defaults, ...row };
        continue;
      }
      if (row[0] === 'mesh' || typeof row[0] !== 'string') continue;
      const options = {
        ...defaults,
        ...(row.find((v, i) => i > 0 && v && !Array.isArray(v) && typeof v === 'object') || {}),
      };
      instances.push({ part: name, slotPath, mesh: row[0], options, offset: [...offset], groups: row[1] });
    }
    for (const row of part.slots || []) {
      if (!Array.isArray(row) || row[0] === 'type' || typeof row[0] !== 'string') continue;
      const nextPath = slotPath + row[0] + '/',
        selected = Object.hasOwn(config.parts, nextPath)
          ? config.parts[nextPath]
          : Object.hasOwn(config.parts, row[0])
            ? config.parts[row[0]]
            : row[1];
      if (!selected) continue;
      const opt = row.find((v, i) => i > 1 && v && !Array.isArray(v) && typeof v === 'object') || {};
      const extra = xyz(opt.nodeOffset, 0, config.vars);
      visit(
        selected,
        nextPath,
        offset.map((n, i) => n + extra[i]),
        depth + 1,
      );
    }
  }
  visit(config.mainPartName, '/');
  return { instances, missingParts, selectedParts: [...new Set(selectedParts)] };
}

function rotate(p, r) {
  let [x, y, z] = p;
  for (let axis = 0; axis < 3; axis++) {
    const a = (r[axis] * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    if (axis === 0) [y, z] = [c * y - s * z, s * y + c * z];
    if (axis === 1) [x, z] = [c * x + s * z, -s * x + c * z];
    if (axis === 2) [x, y] = [c * x - s * y, s * x + c * y];
  }
  return [x, y, z];
}
export function instancePoint(p, matrix, options, offset, vars) {
  const transformed = [0, 1, 2].map(
    (i) => matrix[i * 4] * p[0] + matrix[i * 4 + 1] * p[1] + matrix[i * 4 + 2] * p[2] + matrix[i * 4 + 3],
  );
  const scale = xyz(options.scale, 1, vars),
    pos = xyz(options.pos, 0, vars),
    rot = xyz(options.rot, 0, vars);
  const v = rotate(
    transformed.map((n, i) => n * scale[i]),
    rot,
  ).map((n, i) => n + pos[i]);
  // BeamNG nodeOffset X is mirrored about the vehicle centerline.
  v[0] += Math.sign(pos[0] || v[0]) * offset[0];
  v[1] += offset[1];
  v[2] += offset[2];
  return [v[0], v[2], -v[1]];
}

export function instanceNormal(n, matrix, options, vars) {
  const scale = xyz(options.scale, 1, vars);
  check(
    scale.every((s) => Math.abs(s) > 1e-8),
    'Singular normal transform',
  );
  const rotated = [0, 1, 2].map(
    (i) => matrix[i * 4] * n[0] + matrix[i * 4 + 1] * n[1] + matrix[i * 4 + 2] * n[2],
  );
  const v = rotate(
      rotated.map((n, i) => n / scale[i]),
      xyz(options.rot, 0, vars),
    ),
    length = Math.hypot(...v);
  check(Number.isFinite(length) && length > 1e-8, 'Invalid source normal');
  return [v[0] / length, v[2] / length, -v[1] / length];
}

// Authored geometric environment, not an imported Skylanders sky/light actor.
export function authoredSky(addTexture) {
  const rgba = Buffer.alloc(256 * 128 * 4);
  for (let y = 0; y < 128; y++) {
    const elevation = Math.cos((y / 127) * Math.PI),
      t = Math.pow(Math.max(0, elevation), 0.5);
    const horizon = [190, 211, 226],
      zenith = [58, 112, 177];
    for (let x = 0; x < 256; x++) {
      const at = (y * 256 + x) * 4;
      for (let c = 0; c < 3; c++) rgba[at + c] = Math.round(horizon[c] * (1 - t) + zenith[c] * t);
      rgba[at + 3] = 255;
    }
  }
  const p = [],
    uv = [],
    ix = [],
    columns = 48,
    rows = 24;
  for (let y = 0; y <= rows; y++)
    for (let x = 0; x <= columns; x++) {
      const lat = (y / rows) * Math.PI,
        lon = (x / columns) * Math.PI * 2;
      p.push(300 * Math.sin(lat) * Math.cos(lon), 300 * Math.cos(lat), 300 * Math.sin(lat) * Math.sin(lon));
      uv.push(x / columns, y / rows);
    }
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const a = y * (columns + 1) + x,
        b = a + columns + 1;
      ix.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const sky = {
    name: 'Authored daylight sky',
    selectionKey: 'authored:sky',
    sky: true,
    unlit: true,
    positions: p,
    indices: ix,
    uvs: uv,
    textureId: addTexture({ width: 256, height: 128, rgba }),
    textureWrapS: 'repeat',
    textureWrapT: 'clamp',
    textureFilter: 'linear',
  };
  const normalize = (v) => {
      const l = Math.hypot(...v);
      return v.map((n) => n / l);
    },
    cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const direction = normalize([0.5, 0.8, 0.3]),
    right = normalize(cross(direction, [0, 1, 0])),
    up = cross(right, direction),
    center = direction.map((n) => n * 200),
    sunP = [...center],
    sunIx = [];
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    sunP.push(...center.map((n, c) => n + 4 * (right[c] * Math.cos(a) + up[c] * Math.sin(a))));
    if (i < 32) sunIx.push(0, i + 1, i + 2);
  }
  return [
    sky,
    {
      name: 'Authored sun disc',
      selectionKey: 'authored:sun',
      sky: true,
      unlit: true,
      baseColor: [1, 0.97, 0.86, 1],
      positions: sunP,
      indices: sunIx,
    },
  ];
}

function decodedTexture(zip, name, maxSize = 512) {
  const b = zip.read(name, 64 * MiB);
  let format;
  if (b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) format = 'png';
  else if (b.toString('ascii', 0, 4) === 'DDS ') format = 'dds';
  else if (b[0] === 255 && b[1] === 216 && b[2] === 255) format = 'jpeg';
  else throw new Error('Only PNG/JPEG/DDS raster inputs accepted: ' + name);
  const child = spawnSync(
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
      '2GiB',
      '-limit',
      'map',
      '2GiB',
      '-limit',
      'disk',
      '0',
      format + ':-',
      '-resize',
      maxSize + 'x' + maxSize + '>',
      '-alpha',
      'on',
      '-depth',
      '8',
      'pam:-',
    ],
    { input: b, maxBuffer: 8 * MiB, timeout: 20000 },
  );
  check(child.status === 0, 'Texture decoder failed: ' + name + ' ' + String(child.stderr).slice(0, 200));
  const end = child.stdout.indexOf(Buffer.from('ENDHDR\n'));
  check(end > 0 && end < 1024, 'Invalid decoded texture header');
  const h = child.stdout.toString('ascii', 0, end),
    w = Number(/WIDTH (\d+)/.exec(h)?.[1]),
    height = Number(/HEIGHT (\d+)/.exec(h)?.[1]),
    depth = Number(/DEPTH (\d+)/.exec(h)?.[1]);
  check(
    w > 0 && height > 0 && w <= maxSize && height <= maxSize && depth === 4,
    'Invalid RGBA output dimensions',
  );
  const rgba = child.stdout.subarray(end + 7);
  check(rgba.length === w * height * 4, 'Invalid RGBA output size');
  return { width: w, height, rgba, source: name, sourceSha256: hash(b) };
}
const textureRecord = (t) => {
  const id = hash(t.rgba);
  return {
    id,
    rgbaSha256: id,
    width: t.width,
    height: t.height,
    rgbaBase64: t.rgba.toString('base64'),
    ...(t.source ? { source: t.source, sourceSha256: t.sourceSha256 } : { authored: true }),
  };
};

export function createGallardoScene(filename, { textures = true, configName = 'LP_560_4.pc' } = {}) {
  check(configName === 'LP_560_4.pc', 'Only the LP_560_4.pc configuration is currently supported');
  const zip = new BoundedZip(filename);
  try {
    const sourceFiles = [];
    const read = (name, max) => {
      const b = zip.read(name, max);
      sourceFiles.push({ member: name, sha256: hash(b), bytes: b.length });
      return b;
    };
    const shape = parseBeamngShape(read(ROOT + 'LXRGall.dts')),
      config = parseJbeam(read(ROOT + configName, MiB).toString('utf8')),
      parts = new Map(),
      duplicateParts = [];
    for (const name of [...zip.entries.keys()]
      .filter((n) => n.startsWith(ROOT + 'jbeam/') && n.endsWith('.jbeam'))
      .sort()) {
      const data = parseJbeam(read(name, 8 * MiB).toString('utf8'));
      for (const [key, value] of Object.entries(data)) {
        if (parts.has(key)) {
          duplicateParts.push({ part: key, ignoredMember: name });
          continue;
        }
        parts.set(key, value);
      }
    }
    const selection = selectFlexbodies(config, parts),
      objects = shapeObjects(shape),
      byName = new Map(objects.map((o) => [o.name, o])),
      materials = new Map();
    for (const name of [...zip.entries.keys()]
      .filter((n) => n.startsWith(ROOT) && n.endsWith('.materials.json'))
      .sort())
      for (const [key, value] of Object.entries(parseJbeam(read(name, 8 * MiB).toString('utf8')))) {
        materials.set(value.mapTo || key, value);
      }
    const sceneTextures = [],
      textureIds = new Set(),
      materialCache = new Map(),
      decodeCache = new Map(),
      missingMeshes = [],
      textureWarnings = [];
    let textureBytes = 0;
    function addTexture(t) {
      const rec = textureRecord(t);
      if (!textureIds.has(rec.id)) {
        check(textureBytes + t.rgba.length <= 32 * MiB, 'Scene texture budget');
        textureIds.add(rec.id);
        sceneTextures.push(rec);
        textureBytes += t.rgba.length;
      }
      return rec.id;
    }
    function material(name) {
      if (materialCache.has(name)) return materialCache.get(name);
      const def = materials.get(name) || {},
        stage = def.Stages?.[0] || {},
        paint = stage.instanceDiffuse === true || def.instanceDiffuse === true;
      const factor = paint
        ? config.paints?.[0]?.baseColor
        : stage.baseColorFactor || stage.diffuseColor || [0.62, 0.65, 0.69, 1];
      const rgbaColor = [0, 1, 2].map((i) =>
        Math.round(Math.max(0, Math.min(1, Number(factor?.[i] ?? 0.65))) * 255),
      );
      rgbaColor.push(255);
      const map = stage.baseColorMap || stage.colorMap || stage.diffuseMap;
      let tex,
        source = null;
      if (textures && map && !paint) {
        const member = String(map).replace(/^\//, '');
        if (zip.entries.has(member)) {
          try {
            if (!decodeCache.has(member)) decodeCache.set(member, decodedTexture(zip, member));
            tex = decodeCache.get(member);
            source = member;
          } catch (e) {
            textureWarnings.push({ material: name, reason: e.message });
          }
        } else textureWarnings.push({ material: name, missingTexture: member });
      }
      if (!tex) tex = { width: 1, height: 1, rgba: Buffer.from(rgbaColor) };
      const out = {
        textureId: addTexture(tex),
        materialName: name,
        baseColor: rgbaColor.map((n) => n / 255),
        textureSource: source,
        previewMaterialMode: source
          ? 'source-base-color'
          : paint
            ? 'configured-paint-swatch'
            : 'material-color-swatch',
        sourceMaterial: def.name || null,
        opacity: stage.opacityFactor ?? 1,
        textureWrapS: 'repeat',
        textureWrapT: 'repeat',
        textureFilter: 'linear',
      };
      materialCache.set(name, out);
      return out;
    }
    const meshes = [],
      instances = [];
    let totalVertices = 0,
      totalTriangles = 0;
    for (const [instanceId, instance] of selection.instances.entries()) {
      const object = byName.get(instance.mesh);
      if (!object) {
        missingMeshes.push({ part: instance.part, mesh: instance.mesh });
        continue;
      }
      check(object.meshCount === 1, 'Multiple detail meshes require explicit LOD policy');
      const mesh = shape.meshes[object.firstMesh],
        primitives = meshPrimitives(mesh, shape.materials.length);
      check(mesh.tverts.count === mesh.verts.count || mesh.tverts.count === 0, 'UV/vertex mismatch');
      // This exact archive stores some flexbody rest meshes in assembly space
      // despite translated shape nodes. Explicit demo authoring correction, NOT
      // a claim about the game's generic flexbody transform implementation.
      const matrix = [...object.matrix],
        nodeTranslation = [matrix[3], matrix[7], matrix[11]];
      const correction =
        shape.sha256 === '18a67907117904a604280021e193ec41544830e5d2f032bb1bb17d9a1b9bb204' &&
        nodeTranslation.some((n) => Math.abs(n) > 1e-6);
      if (correction) for (const i of [3, 7, 11]) matrix[i] = 0;
      const uv = mesh.tverts,
        positions = Array.from({ length: mesh.verts.count }, (_, i) =>
          instancePoint(
            [0, 1, 2].map((k) => mesh.verts.data.readFloatLE(i * 12 + k * 4)),
            matrix,
            instance.options,
            instance.offset,
            config.vars,
          ),
        );
      check(
        positions.every((p) => p.every((n) => Number.isFinite(n) && Math.abs(n) < 10000)),
        'Invalid transformed positions',
      );
      check(mesh.norms.count === mesh.verts.count, 'Source smooth normal count mismatch');
      const normals = Array.from({ length: mesh.norms.count }, (_, i) =>
        instanceNormal(
          [0, 1, 2].map((k) => mesh.norms.data.readFloatLE(i * 12 + k * 4)),
          matrix,
          instance.options,
          config.vars,
        ),
      );
      instances.push({
        instanceId,
        part: instance.part,
        mesh: instance.mesh,
        shapeObject: object.index,
        shapeNode: object.nodeIndex,
        shapeMesh: object.firstMesh,
        slotPath: instance.slotPath,
        options: instance.options,
        nodeOffset: instance.offset,
        sourceNodeMatrix: object.matrix,
        authoredLayoutCorrection: correction
          ? {
              removedNodeTranslation: nodeTranslation,
              reason: 'Source-pinned static assembly authoring; generic BeamNG placement not proven',
            }
          : null,
      });
      for (const primitive of primitives) {
        const remap = new Map(),
          p = [],
          u = [],
          n = [],
          ix = [];
        for (const index of primitive.indices) {
          if (!remap.has(index)) {
            remap.set(index, remap.size);
            p.push(...positions[index]);
            n.push(...normals[index]);
            u.push(
              ...(uv.count ? [uv.data.readFloatLE(index * 8), uv.data.readFloatLE(index * 8 + 4)] : [0, 0]),
            );
          }
          ix.push(remap.get(index));
        }
        const mat = material(shape.materials[primitive.material].name);
        check(u.every(Number.isFinite), 'Invalid UV values');
        meshes.push({
          name: instance.mesh + ' / ' + mat.materialName,
          selectionKey:
            'gallardo:' + instance.part + ':' + instanceId + ':' + object.index + ':' + primitive.index,
          actorId: 1,
          actorBasePosition: [0, 0, 0],
          positions: p,
          indices: ix,
          uvs: u,
          normals: n,
          vertexCount: p.length / 3,
          triangleCount: ix.length / 3,
          ...mat,
          source: {
            part: instance.part,
            shapeObject: object.index,
            shapeMesh: object.firstMesh,
            primitive: primitive.index,
          },
        });
        totalVertices += p.length / 3;
        totalTriangles += ix.length / 3;
        check(totalVertices < 2000000 && totalTriangles < 2000000, 'Scene geometry budget');
      }
    }
    check(meshes.length > 0, 'No selected meshes found');
    const carBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const m of meshes)
      for (let i = 0; i < m.positions.length; i += 3)
        for (let a = 0; a < 3; a++) {
          carBounds.min[a] = Math.min(carBounds.min[a], m.positions[i + a]);
          carBounds.max[a] = Math.max(carBounds.max[a], m.positions[i + a]);
        }
    const floorRgba = Buffer.alloc(128 * 128 * 4);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const at = (y * 128 + x) * 4,
          line = x < 2 || y < 2,
          value = line ? 93 : x < 64 === y < 64 ? 166 : 172;
        floorRgba[at] = value;
        floorRgba[at + 1] = value + 5;
        floorRgba[at + 2] = value + 9;
        floorRgba[at + 3] = 255;
      }
    const floorId = addTexture({ width: 128, height: 128, rgba: floorRgba });
    meshes.push({
      name: 'Authored flat grid floor',
      selectionKey: 'authored:floor',
      editable: false,
      positions: [-6, 0, -6, 6, 0, -6, 6, 0, 6, -6, 0, 6],
      indices: [0, 2, 1, 0, 3, 2],
      uvs: [0, 0, 12, 0, 12, 12, 0, 12],
      textureId: floorId,
      textureWrapS: 'repeat',
      textureWrapT: 'repeat',
      textureFilter: 'linear',
    });
    const carPrimitives = meshes.length - 1;
    meshes.push(...authoredSky(addTexture));
    meshes.forEach((m, id) => {
      m.id = id;
    });
    const scene = {
      schema: 'skylanders-authored-scene-v1',
      name: 'Gallardo LP 560-4 — authored static demonstration',
      coordinateSystem: 'Y-up, metres; BeamNG (x,y,z) mapped to (x,z,-y)',
      objects: [
        {
          id: 1,
          index: 1,
          name: 'Gallardo LP 560-4',
          type: 'AuthoredStaticModel',
          position: [0, 0, 0],
          worldPosition: [0, 0, 0],
          parentObjectId: null,
          editable: true,
          worldEditable: true,
        },
      ],
      meshes,
      textures: sceneTextures,
      contentBounds: { min: [-6, Math.min(0, carBounds.min[1]), -6], max: [6, carBounds.max[1], 6] },
      environment: {
        authored: true,
        skyColor: [0.34, 0.48, 0.66],
        ambientColor: [0.34, 0.38, 0.43],
        sunDirection: [-0.5, -0.8, -0.3],
        sunColor: [1, 0.94, 0.83],
        sunIntensity: 0.8,
      },
      provenance: {
        generator: 'tools/gallardo_demo.mjs',
        archive: { name: path.basename(filename), sha256: zip.sha256, bytes: zip.size },
        shapeSha256: shape.sha256,
        configuration: ROOT + configName,
        sourceFiles,
        selectedParts: selection.selectedParts,
        instances,
        missingParts: selection.missingParts,
        missingMeshes,
        duplicateParts,
        textureWarnings,
        statistics: {
          shapeObjects: objects.length,
          selectedInstances: instances.length,
          carPrimitives,
          carVertices: totalVertices,
          carTriangles: totalTriangles,
          textures: sceneTextures.length,
        },
        carBounds,
      },
      limitations: [
        'Static editor demonstration, not an installed or playable PS4 level.',
        'JBeam flexbodies only; dynamic props, deformation, suspension simulation and controllers are not executed.',
        'External BeamNG common assets absent from this ZIP are reported, not fabricated.',
        'One detail mesh; translated flexbody nodes have explicit source-pinned authored rest-assembly corrections recorded per instance. No animated or skinned mesh import.',
        'PBR, multilayer palette paint, reflections and glass blending are not reproduced; configured paint uses an explicitly labelled color swatch.',
        'Only documented numeric transforms and the exact wheel-offset expression profile are interpreted without evaluating scripts.',
        'The source ZIP and generated geometry/textures are private assets, not part of the redistributable editor source package.',
      ],
    };
    validateAuthoredScene(scene);
    return scene;
  } finally {
    zip.close();
  }
}

export function writeGallardoDemo(zipPath, output, options = {}) {
  check(typeof output === 'string' && output.endsWith('.scene.json'), 'Output must end in .scene.json');
  check(!fs.existsSync(output), 'Refusing to overwrite output');
  const scene = createGallardoScene(zipPath, options),
    data = Buffer.from(JSON.stringify(scene));
  check(data.length <= 256 * MiB, 'Scene file budget');
  fs.writeFileSync(output, data, { flag: 'wx', mode: 0o600 });
  return {
    output: path.resolve(output),
    sha256: hash(data),
    bytes: data.length,
    ...scene.provenance.statistics,
    missingParts: scene.provenance.missingParts.length,
    missingMeshes: scene.provenance.missingMeshes.length,
    textureWarnings: scene.provenance.textureWarnings.length,
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    check(
      args.length === 2 || (args.length === 3 && args[2] === '--no-textures'),
      'Usage: node tools/gallardo_demo.mjs gallardo.zip fresh.scene.json [--no-textures]',
    );
    console.log(
      JSON.stringify(writeGallardoDemo(args[0], args[1], { textures: args[2] !== '--no-textures' }), null, 2),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
