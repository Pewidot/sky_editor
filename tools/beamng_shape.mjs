// Read-only, bounded BeamNG v31 shape parser. No bundled asset scripts execute.
// Format: https://documentation.beamng.com/modding/file_formats/cdae/
import { zstdDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const MAX = 128 * 1024 * 1024;
export class MessagePackReader {
  constructor(bytes) {
    check(Buffer.isBuffer(bytes) && bytes.length <= MAX, 'Invalid MessagePack buffer');
    this.bytes = bytes;
    this.at = 0;
    this.items = 0;
  }
  take(n) {
    check(Number.isSafeInteger(n) && n >= 0 && n <= this.bytes.length - this.at, 'Truncated MessagePack');
    const b = this.bytes.subarray(this.at, this.at + n);
    this.at += n;
    return b;
  }
  read(depth = 0) {
    check(depth <= 32 && ++this.items < 2000000, 'MessagePack complexity limit');
    const tag = this.take(1)[0];
    const text = (n) => {
      check(n <= 1048576, 'String budget');
      return new TextDecoder('utf-8', { fatal: true }).decode(this.take(n));
    };
    const array = (n) => {
      check(n <= 100000, 'Array budget');
      return Array.from({ length: n }, () => this.read(depth + 1));
    };
    const map = (n) => {
      check(n <= 100000, 'Map budget');
      const o = Object.create(null);
      for (let i = 0; i < n; i++) {
        const k = this.read(depth + 1);
        check(typeof k === 'string' && !Object.hasOwn(o, k), 'Invalid/duplicate map key');
        o[k] = this.read(depth + 1);
      }
      return o;
    };
    if (tag <= 0x7f) return tag;
    if (tag >= 0xe0) return tag - 256;
    if ((tag & 0xe0) === 0xa0) return text(tag & 31);
    if ((tag & 0xf0) === 0x90) return array(tag & 15);
    if ((tag & 0xf0) === 0x80) return map(tag & 15);
    switch (tag) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4:
        return this.take(this.take(1)[0]);
      case 0xc5:
        return this.take(this.take(2).readUInt16BE());
      case 0xc6:
        return this.take(this.take(4).readUInt32BE());
      case 0xca:
        return this.take(4).readFloatBE();
      case 0xcb:
        return this.take(8).readDoubleBE();
      case 0xcc:
        return this.take(1)[0];
      case 0xcd:
        return this.take(2).readUInt16BE();
      case 0xce:
        return this.take(4).readUInt32BE();
      case 0xcf: {
        const n = this.take(8).readBigUInt64BE();
        check(n <= BigInt(Number.MAX_SAFE_INTEGER), 'Unsafe integer');
        return Number(n);
      }
      case 0xd0:
        return this.take(1).readInt8();
      case 0xd1:
        return this.take(2).readInt16BE();
      case 0xd2:
        return this.take(4).readInt32BE();
      case 0xd3: {
        const n = this.take(8).readBigInt64BE();
        check(n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER), 'Unsafe integer');
        return Number(n);
      }
      case 0xd9:
        return text(this.take(1)[0]);
      case 0xda:
        return text(this.take(2).readUInt16BE());
      case 0xdb:
        return text(this.take(4).readUInt32BE());
      case 0xdc:
        return array(this.take(2).readUInt16BE());
      case 0xdd:
        return array(this.take(4).readUInt32BE());
      case 0xde:
        return map(this.take(2).readUInt16BE());
      case 0xdf:
        return map(this.take(4).readUInt32BE());
      default:
        throw new Error('Unsupported MessagePack tag 0x' + tag.toString(16));
    }
  }
}
export function parseBeamngShape(bytes) {
  check(Buffer.isBuffer(bytes) && bytes.length >= 8 && bytes.length <= MAX, 'Invalid shape size');
  const version = bytes.readUInt32LE(0),
    headerSize = bytes.readUInt32LE(4);
  check(
    (version & 0xffff) === 31 && headerSize <= 1048576 && headerSize <= bytes.length - 8,
    'Only bounded v31 shapes supported',
  );
  const hr = new MessagePackReader(bytes.subarray(8, 8 + headerSize)),
    header = hr.read();
  check(hr.at === headerSize && header && typeof header.compression === 'boolean', 'Malformed shape header');
  const stored = bytes.subarray(8 + headerSize);
  check(header.bodysize === stored.length, 'Stored body size mismatch');
  const body = header.compression ? zstdDecompressSync(stored, { maxOutputLength: MAX }) : stored;
  const r = new MessagePackReader(body);
  const number = (label) => {
    const n = r.read();
    check(typeof n === 'number' && Number.isFinite(n), 'Expected finite number: ' + label);
    return n;
  };
  const integer = (label, min = -0x80000000, max = 0xffffffff) => {
    const n = number(label);
    check(Number.isInteger(n) && n >= min && n <= max, 'Invalid integer: ' + label);
    return n;
  };
  const string = (label) => {
    const s = r.read();
    check(typeof s === 'string', 'Expected string: ' + label);
    return s;
  };
  const floats = (n, label) => {
    const v = r.read();
    const a = Buffer.isBuffer(v)
      ? (check(v.length === n * 4, 'Float buffer length: ' + label),
        Array.from({ length: n }, (_, i) => v.readFloatLE(i * 4)))
      : v;
    check(Array.isArray(a) && a.length === n && a.every(Number.isFinite), 'Float vector: ' + label);
    return a;
  };
  const vector = (label, expected) => {
    const count = integer(label + '.count', 0, 10000000),
      stride = integer(label + '.stride', 0, 256),
      data = r.read();
    check(Buffer.isBuffer(data) && data.length === count * stride, 'Vector size mismatch: ' + label);
    check(
      expected === undefined || stride === expected,
      'Unsupported vector stride: ' + label + ' ' + stride,
    );
    return { count, stride, data };
  };
  const info = {
    smallestVisibleSize: number('smallestVisibleSize'),
    smallestVisibleDetail: integer('smallestVisibleDetail'),
    radius: number('radius'),
    tubeRadius: number('tubeRadius'),
    center: floats(3, 'center'),
    bounds: floats(6, 'bounds'),
  };
  const vectors = {};
  for (const [label, stride] of [
    ['nodes', 20],
    ['objects', 24],
    ['subShapeFirstNode', 4],
    ['subShapeFirstObject', 4],
    ['subShapeNumNodes', 4],
    ['subShapeNumObjects', 4],
    ['defaultRotations', 8],
    ['defaultTranslations', 12],
    ['nodeRotations', 8],
    ['nodeTranslations', 12],
    ['nodeUniformScales', 4],
    ['nodeAlignedScales', 12],
    ['nodeArbitraryScaleFactors', 12],
    ['nodeArbitraryScaleRots', 8],
    ['groundTranslations', 12],
    ['groundRotations', 8],
    ['objectStates', 12],
    ['triggers', 8],
    ['details', 52],
  ])
    vectors[label] = vector(label, stride);
  const names = Array.from({ length: integer('names', 0, 100000) }, () => string('name'));
  const meshes = [];
  const total = integer('meshes', 0, 10000);
  for (let i = 0; i < total; i++) {
    const mesh = { index: i, type: integer('meshType', 0, 4) };
    meshes.push(mesh);
    if (mesh.type === 4) continue;
    check(mesh.type === 0 || mesh.type === 1, 'Unsupported mesh type ' + mesh.type);
    Object.assign(mesh, {
      numFrames: integer('numFrames', 0),
      numMatFrames: integer('numMatFrames', 0),
      parentMesh: integer('parentMesh'),
      bounds: floats(6, 'meshBounds'),
      center: floats(3, 'meshCenter'),
      radius: number('meshRadius'),
    });
    for (const [label, stride] of [
      ['verts', 12],
      ['tverts', 8],
      ['tverts2', 8],
      ['colors', 4],
      ['norms', 12],
      ['encodedNorms', 1],
      ['primitives', 12],
      ['indices', 4],
      ['tangents', 16],
    ])
      mesh[label] = vector('mesh.' + label, stride);
    mesh.vertsPerFrame = integer('vertsPerFrame', 0);
    mesh.flags = integer('meshFlags', 0);
    if (mesh.type === 1) {
      mesh.skin = {};
      if (mesh.parentMesh < 0) {
        mesh.skin.initialVerts = vector('initialVerts', 12);
        mesh.skin.initialNorms = vector('initialNorms', 12);
      }
      mesh.skin.initialTransforms = vector('initialTransforms', 64);
      if (mesh.parentMesh < 0)
        for (const label of ['vertexIndex', 'boneIndex', 'weight', 'nodeIndex'])
          mesh.skin[label] = vector(label, 4);
    }
  }
  const sequences = [];
  for (let i = 0, n = integer('sequences', 0, 10000); i < n; i++) {
    const s = {};
    for (const label of [
      'nameIndex',
      'flags',
      'numKeyframes',
      'duration',
      'priority',
      'firstGroundFrame',
      'numGroundFrames',
      'baseRotation',
      'baseTranslation',
      'baseScale',
      'baseObjectState',
      'baseDecalState',
      'firstTrigger',
      'numTriggers',
      'toolBegin',
    ])
      s[label] = number('sequence.' + label);
    for (const label of [
      'rotationMatters',
      'translationMatters',
      'scaleMatters',
      'visMatters',
      'frameMatters',
      'matFrameMatters',
    ]) {
      const v = r.read();
      check(Buffer.isBuffer(v) || Array.isArray(v), 'Invalid sequence set');
      s[label] = v;
    }
    sequences.push(s);
  }
  const materials = [];
  if (r.at < body.length)
    for (let i = 0, n = integer('materials', 0, 100000); i < n; i++)
      materials.push({
        name: string('materialName'),
        flags: integer('materialFlags', 0),
        reflectanceMap: integer('reflectanceMap', 0),
        bumpMap: integer('bumpMap', 0),
        detailMap: integer('detailMap', 0),
        detailScale: number('detailScale'),
        reflectionAmount: number('reflectionAmount'),
      });
  check(r.at === body.length, 'Trailing shape data');
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    version: 31,
    exporterVersion: version >>> 16,
    header,
    bodyBytes: body.length,
    info,
    vectors,
    names,
    meshes,
    sequences,
    materials,
  };
}

// TSShape Node/Object layouts are documented by BeamNG's cdae_dump_info.py.
// Row-major Torque quaternion matrix convention, not a guessed Euler order.
export function shapeObjects(shape) {
  const v = shape.vectors,
    count = v.nodes.count;
  check(
    v.defaultRotations.count === count && v.defaultTranslations.count === count,
    'Missing default node transforms',
  );
  const matrices = new Array(count),
    visiting = new Set();
  const multiply = (a, b) =>
    Array.from({ length: 16 }, (_, i) =>
      [0, 1, 2, 3].reduce((s, k) => s + a[(i >> 2) * 4 + k] * b[k * 4 + (i % 4)], 0),
    );
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  function transform(i, depth = 0) {
    if (i === -1) return identity;
    check(Number.isInteger(i) && i >= 0 && i < count && depth < 128, 'Invalid node parent/depth');
    if (matrices[i]) return matrices[i];
    check(!visiting.has(i), 'Cyclic shape nodes');
    visiting.add(i);
    const parent = v.nodes.data.readInt32LE(i * 20 + 4);
    const q = Array.from({ length: 4 }, (_, k) => v.defaultRotations.data.readInt16LE(i * 8 + k * 2) / 32767);
    const [x, y, z, w] = q,
      t = Array.from({ length: 3 }, (_, k) => v.defaultTranslations.data.readFloatLE(i * 12 + k * 4));
    check(t.every(Number.isFinite) && q.reduce((s, n) => s + n * n, 0) > 0.5, 'Invalid node transform');
    const local = [
      1 - 2 * (y * y + z * z),
      2 * (x * y + z * w),
      2 * (x * z - y * w),
      t[0],
      2 * (x * y - z * w),
      1 - 2 * (x * x + z * z),
      2 * (y * z + x * w),
      t[1],
      2 * (x * z + y * w),
      2 * (y * z - x * w),
      1 - 2 * (x * x + y * y),
      t[2],
      0,
      0,
      0,
      1,
    ];
    matrices[i] = multiply(transform(parent, depth + 1), local);
    visiting.delete(i);
    return matrices[i];
  }
  return Array.from({ length: v.objects.count }, (_, i) => {
    const at = i * 24,
      nameId = v.objects.data.readInt32LE(at),
      meshCount = v.objects.data.readInt32LE(at + 4),
      firstMesh = v.objects.data.readInt32LE(at + 8),
      nodeIndex = v.objects.data.readInt32LE(at + 12);
    check(
      nameId >= 0 &&
        nameId < shape.names.length &&
        meshCount >= 0 &&
        firstMesh >= 0 &&
        firstMesh + meshCount <= shape.meshes.length,
      'Invalid shape object references',
    );
    return {
      index: i,
      name: shape.names[nameId],
      nodeIndex,
      meshCount,
      firstMesh,
      matrix: transform(nodeIndex),
    };
  });
}

export function meshPrimitives(mesh, materialCount) {
  check(
    mesh.type === 0 && mesh.parentMesh < 0 && mesh.numFrames === 1,
    'Only independent single-frame StandardMesh is supported',
  );
  check(mesh.verts.count === mesh.vertsPerFrame, 'Vertex/frame count mismatch');
  return Array.from({ length: mesh.primitives.count }, (_, i) => {
    const at = i * 12,
      start = mesh.primitives.data.readUInt32LE(at),
      count = mesh.primitives.data.readUInt32LE(at + 4),
      flags = mesh.primitives.data.readUInt32LE(at + 8),
      mode = flags >>> 30,
      material = flags & 0xfffffff,
      indexed = Boolean(flags & 0x20000000);
    check(mode < 3 && !(flags & 0x10000000) && material < materialCount, 'Unsupported primitive/material');
    check(start + count <= (indexed ? mesh.indices.count : mesh.verts.count), 'Primitive span out of bounds');
    const source = Array.from({ length: count }, (_, j) =>
      indexed ? mesh.indices.data.readUInt32LE((start + j) * 4) : start + j,
    );
    check(
      source.every((n) => n < mesh.verts.count),
      'Vertex index out of bounds',
    );
    const indices = [];
    if (mode === 0) {
      check(count % 3 === 0, 'Invalid triangle count');
      indices.push(...source);
    } else
      for (let j = 2; j < count; j++) {
        const tri =
          mode === 1
            ? j % 2
              ? [source[j - 1], source[j - 2], source[j]]
              : [source[j - 2], source[j - 1], source[j]]
            : [source[0], source[j - 1], source[j]];
        if (new Set(tri).size === 3) indices.push(...tri);
      }
    return { index: i, material, flags, indices };
  });
}
