// Original test geometry, not extracted game content.
export function cubeGlb({ mutate = () => {}, texture = null } = {}) {
  const positions = [-1, 0, -1, 1, 0, -1, 1, 2, -1, -1, 2, -1, -1, 0, 1, 1, 0, 1, 1, 2, 1, -1, 2, 1];
  const indices = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6,
    5,
  ];
  const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const data = Buffer.alloc(
    positions.length * 4 + indices.length * 2 + uv.length * 4 + (texture ? (texture.length + 3) & ~3 : 0),
  );
  positions.forEach((v, i) => data.writeFloatLE(v, i * 4));
  indices.forEach((v, i) => data.writeUInt16LE(v, 96 + i * 2));
  uv.forEach((v, i) => data.writeFloatLE(v, 168 + i * 4));
  if (texture) texture.copy(data, 232);
  const g = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: data.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 96 },
      { buffer: 0, byteOffset: 96, byteLength: 72 },
      { buffer: 0, byteOffset: 168, byteLength: 64 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: 8, type: 'VEC2' },
    ],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.08, 0.55, 0.8, 1] } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 2 }, indices: 1, material: 0 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  if (texture) {
    g.bufferViews.push({ buffer: 0, byteOffset: 232, byteLength: texture.length });
    g.images = [{ bufferView: 3, mimeType: 'image/png' }];
    g.textures = [{ source: 0 }];
    g.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
  }
  mutate(g);
  const json = Buffer.from(JSON.stringify(g)),
    padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const out = Buffer.alloc(28 + padded.length + data.length);
  out.writeUInt32LE(0x46546c67);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(padded.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(out, 20);
  out.writeUInt32LE(data.length, 20 + padded.length);
  out.writeUInt32LE(0x004e4942, 24 + padded.length);
  data.copy(out, 28 + padded.length);
  return out;
}
