// Source-bound native scenery assembly for a small floating workshop chapter.
// All materials, UV layouts on reused modules, sky and light objects come from
// the owner's exact Arena303 artifact. No game resources are embedded here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseIgz } from './igz.mjs';
import { loadGeometry } from './igz_geometry.mjs';
import { appendIgz, inspectAppendTarget } from './igz_append.mjs';
import { replaceMemoryPayloads } from './igz_memory_replace.mjs';
import { ARENA_INNER_SHA256 } from './native_demo_builder.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const find = (z, e) => z.objectsByOffset.get(z.resolvePointer(e).offset);
const normalize = (v) => {
  const n = Math.hypot(...v);
  assert.ok(n > 0.00001);
  return v.map((x) => x / n);
};
// Some donor vertices intentionally carry a zero normal/tangent (unlit faces).
// Preserve that source value rather than inventing a direction.
const unitOrZero = (v) => (Math.hypot(...v) > 0.00001 ? normalize(v) : v);
function half(value) {
  assert.ok(Number.isFinite(value) && Math.abs(value) <= 65504);
  const f = new Float32Array([value]),
    bits = new Uint32Array(f.buffer)[0],
    sign = (bits >>> 16) & 0x8000;
  const e = ((bits >>> 23) & 255) - 112,
    m = bits & 0x7fffff;
  if (e <= 0) return e < -10 ? sign : sign | Math.min(1023, Math.round((m | 0x800000) / 2 ** (14 - e)));
  const r = Math.round(m / 8192);
  return sign | ((e + (r === 1024 ? 1 : 0)) << 10) | (r & 1023);
}

export function buildSunbreakWorld(source) {
  assert.equal(sha(source), ARENA_INNER_SHA256, 'Unsupported native donor');
  const z = parseIgz(source),
    geometry = loadGeometry(z),
    buffer = Buffer.from(source),
    replacements = [],
    plans = [];
  assert.equal(geometry.warnings.length, 0);
  const platforms = [
    { name: 'Arrival', center: [-420, 100, -94], radius: 6.5 },
    { name: 'Junction', center: [-420, 100, -72], radius: 6.5 },
    { name: 'Beacon', center: [-420, 100, -50], radius: 6.5 },
    { name: 'West relay', center: [-436, 100, -72], radius: 3.5 },
    { name: 'East relay', center: [-404, 100, -72], radius: 3.5 },
  ];
  const spawn = [-420, 101, -96],
    goal = [-420, 100.05, -52],
    relayWest = [-436, 100.05, -73],
    relayEast = [-404, 100.05, -73];
  const floorBoxes = [],
    deck = [];
  // The same short strips form the visible deck and its collision. Their outer
  // stair-step edge sits under the native circular stone rim.
  for (const p of platforms) {
    const r = p.radius * 0.96,
      d = (2 * r) / 11;
    for (let i = 0; i < 11; i++) {
      const offset = -r + (i + 0.5) * d,
        w = 2 * Math.sqrt(r * r - offset * offset);
      const c = [p.center[0], 99.35, p.center[2] + offset],
        size = [w, 0.65, d];
      floorBoxes.push({ name: p.name + ' deck', center: c, size });
      deck.push({ center: c, size });
    }
  }
  const bridges = [
    { name: 'Arrival bridge', center: [-420, 99.35, -83], size: [3.5, 0.65, 10] },
    { name: 'Beacon bridge', center: [-420, 99.35, -61], size: [3.5, 0.65, 10] },
    { name: 'West bridge', center: [-429, 99.35, -72], size: [7, 0.65, 2.8] },
    { name: 'East bridge', center: [-411, 99.35, -72], size: [7, 0.65, 2.8] },
  ];
  for (const b of bridges) {
    floorBoxes.push(b);
    deck.push(b);
  }
  // Low traversal steps are part of both the visible and physical recipe.
  for (const [x, y, z0, w, h, d] of [
    [-420, 100, -85, 3.5, 0.35, 1.5],
    [-420, 100, -81, 3.5, 0.65, 1.5],
  ]) {
    const b = { name: 'Bridge step', center: [x, y, z0], size: [w, h, d] };
    floorBoxes.push(b);
    deck.push(b);
  }
  function handle(tableIndex, bytes) {
    assert.ok(!replacements.some((r) => r.tableIndex === tableIndex), 'Shared GPU allocation selected twice');
    const at = z.fixupMap.get('TMHN').dataOffset + tableIndex * 16,
      length = z.u32(at),
      where = z.resolvePointer(z.u32(at + 8), length);
    const ownerSlots = z.tmhnReferences
      .filter((r) => r.tableIndex === tableIndex)
      .map((r) => {
        const d = z.descriptors.find((d) => r.offset >= d.offset && r.offset + 8 <= d.offset + d.dataSize);
        return (d.index - 1) * 0x08000000 + r.offset - d.offset;
      });
    replacements.push({
      tableIndex,
      expectedPayloadSha256: sha(source.subarray(where.offset, where.offset + length)),
      ownerSlots,
      pool: 'Vertex',
      flags: z.u32(at + 4),
      bytes,
    });
  }
  function install(mesh, vertices, indices, reason) {
    const stride = mesh.source.stride,
      nv = vertices.length / stride;
    assert.ok(Number.isInteger(nv) && nv > 0 && nv < 65536);
    assert.ok(indices.length % 3 === 0 && indices.every((n) => n >= 0 && n < nv));
    const vb = z.objects[mesh.source.vertexBufferId],
      ib = z.objects[mesh.source.indexBufferId];
    assert.equal(mesh.source.indexWidth, 2);
    const ibytes = Buffer.alloc(Math.ceil((indices.length * 2) / 4) * 4);
    indices.forEach((n, i) => ibytes.writeUInt16LE(n, i * 2));
    for (const [o, count, bytes] of [
      [vb, nv, vertices],
      [ib, indices.length, ibytes],
    ]) {
      buffer.writeUInt32LE(count, o.offset + 12);
      assert.equal(z.u32(o.offset + 16), 4);
      buffer.writeUInt32LE(count, z.pointerReferencesByOffset.get(o.offset + 24).targetOffset);
      handle(z.tmhnReferences.find((r) => r.offset === o.offset + 32).tableIndex, bytes);
    }
    const box = z.objects[z.pointerReferencesByOffset.get(z.objects[mesh.id].offset + 32).targetObjectIndex];
    assert.equal(box.type, 'igAABox');
    assert.equal(z.pointerReferences.filter((p) => p.targetObjectIndex === box.index).length, 1);
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nv; i++)
      for (let a = 0; a < 3; a++) {
        const v = vertices.readFloatLE(i * stride + mesh.source.positionOffset + a * 4);
        min[a] = Math.min(min[a], v);
        max[a] = Math.max(max[a], v);
      }
    for (let a = 0; a < 3; a++) {
      buffer.writeFloatLE(min[a], box.offset + 12 + a * 4);
      buffer.writeFloatLE(max[a], box.offset + 24 + a * 4);
    }
    plans.push({
      drawable: mesh.id,
      reason,
      vertices: nv,
      triangles: indices.length / 3,
      bounds: { min, max },
    });
  }
  function repeat(id, instances, reason) {
    const m = geometry.meshes.find((m) => m.id === id);
    assert.ok(m);
    const stride = m.source.stride,
      positionOffset = m.source.positionOffset;
    assert.ok(
      [40, 44, 48].includes(stride) && positionOffset === stride - 36,
      'Verified position/normal/tangent suffix required',
    );
    const vertices = Buffer.alloc(instances.length * m.vertexCount * stride),
      indices = [];
    instances.forEach(({ origin, target, scale = 1, yaw = 0 }, k) => {
      const s = Array.isArray(scale) ? scale : [scale, scale, scale],
        c = Math.cos(yaw),
        sn = Math.sin(yaw);
      const rotate = (v) => [c * v[0] + sn * v[2], v[1], -sn * v[0] + c * v[2]];
      for (let i = 0; i < m.vertexCount; i++) {
        const from = m.source.vertexDataOffset + i * stride,
          to = (k * m.vertexCount + i) * stride;
        source.copy(vertices, to, from, from + stride);
        const pos = rotate(
          [0, 1, 2].map((a) => (source.readFloatLE(from + positionOffset + a * 4) - origin[a]) * s[a]),
        ).map((v, a) => v + target[a]);
        const normal = unitOrZero(
          rotate([0, 1, 2].map((a) => source.readFloatLE(from + positionOffset + 12 + a * 4) / s[a])),
        );
        const tangent = unitOrZero(
          rotate([0, 1, 2].map((a) => source.readFloatLE(from + positionOffset + 24 + a * 4) * s[a])),
        );
        for (const [off, v] of [
          [0, pos],
          [12, normal],
          [24, tangent],
        ])
          v.forEach((n, a) => vertices.writeFloatLE(n, to + positionOffset + off + a * 4));
      }
      for (const v of m.indices) indices.push(v + k * m.vertexCount);
    });
    install(m, vertices, indices, reason);
  }
  // Platform rims preserve their atlas UVs; they are not guessed planar UVs.
  repeat(
    537,
    platforms.map((p) => ({ origin: [-415.764, 0, -62.483], target: p.center, scale: p.radius / 26.45 })),
    'Five native stone rims',
  );
  repeat(
    351,
    platforms.map((p) => ({
      origin: [-415.7, -3.3, -62.5],
      target: [p.center[0], 99.35, p.center[2]],
      scale: [p.radius / 22.45, 0.13, p.radius / 22.45],
    })),
    'Cliff skirts beneath each platform',
  );
  // Full rocket assemblies serve as three large, readable visual landmarks.
  const rockets = [
    { origin: [-448.5, 7.4, -54], target: [-420, 100, -47], scale: 0.22 },
    { origin: [-448.5, 7.4, -54], target: [-436, 100, -70.5], scale: 0.095 },
    { origin: [-448.5, 7.4, -54], target: [-404, 100, -70.5], scale: 0.095 },
  ];
  for (const id of [5, 40, 199, 225, 247, 263, 285, 307, 329, 995, 1018, 1021, 1049])
    repeat(id, rockets, 'Native rocket beacon assembly');
  for (const [x, z0, w, h, d] of [
    [-420, -47, 3.8, 10, 3.8],
    [-436, -70.5, 1.65, 4.4, 1.65],
    [-404, -70.5, 1.65, 4.4, 1.65],
  ])
    floorBoxes.push({ name: 'Beacon body', center: [x, 100, z0], size: [w, h, d] });
  repeat(
    477,
    [
      { origin: [-443.18, -4.15, -106.71], target: [-441, 91, -94], scale: 0.85 },
      { origin: [-443.18, -4.15, -106.71], target: [-398, 89, -49], scale: 0.9, yaw: 1.8 },
      { origin: [-443.18, -4.15, -106.71], target: [-435, 90, -40], scale: 0.55 },
    ],
    'Outlying native grass-rock islands',
  );
  repeat(
    1088,
    [
      { origin: [-439.24, -1.77, -82.64], target: [-425.2, 99.5, -96], scale: 0.45 },
      { origin: [-439.24, -1.77, -82.64], target: [-414.8, 99.5, -69], scale: 0.38, yaw: 1.2 },
    ],
    'Small decorative rocks at deck edges',
  );
  floorBoxes.push(
    { name: 'Arrival rock', center: [-425.2, 100, -96], size: [1.8, 2.8, 2.4] },
    { name: 'Junction rock', center: [-414.8, 100, -69], size: [1.7, 2.4, 2.2] },
  );
  const selected = new Set(plans.map((p) => p.drawable));
  selected.add(807);
  const scenery = new Set([
    133, 556, 576, 596, 599, 602, 614, 617, 629, 648, 661, 700, 716, 735, 779, 792, 804, 821, 835, 838, 852,
    899, 912, 939, 1074, 1110, 1194, 1213, 1216, 1219, 1232, 1235, 1238, 1253, 1256, 1270, 1284, 1287, 1309,
    1312,
  ]);
  for (const id of scenery) {
    repeat(
      id,
      [{ origin: [-416, 0, -62.5], target: [-459, 91, -61], scale: 0.52 }],
      'Background workshop silhouette',
    );
    selected.add(id);
  }
  // Original blue metal material with planar metric UVs for newly authored decks.
  // No texture bytes or native shader bindings are changed.
  const mesh = geometry.meshes.find((m) => m.id === 807);
  assert.equal(mesh.source.stride, 40);
  assert.equal(mesh.source.positionOffset, 4);
  const verts = [],
    inds = [];
  function quad(points, normal, tangent, uv) {
    const base = verts.length;
    points.forEach((p, i) => verts.push({ p, normal, tangent, uv: uv[i] }));
    inds.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  for (const {
    center: [x, y, z0],
    size: [w, h, d],
  } of deck) {
    const x0 = x - w / 2,
      x1 = x + w / 2,
      z1 = z0 + d / 2,
      z2 = z0 - d / 2;
    const top = [
      [x0, y + h, z2],
      [x1, y + h, z2],
      [x1, y + h, z1],
      [x0, y + h, z1],
    ];
    quad(
      top,
      [0, 1, 0],
      [1, 0, 0],
      top.map((p) => [(p[0] + 420) / 3, (p[2] + 94) / 3]),
    );
    for (const [p0, p1, n] of [
      [
        [x0, y, z2],
        [x1, y, z2],
        [0, 0, -1],
      ],
      [
        [x1, y, z2],
        [x1, y, z1],
        [1, 0, 0],
      ],
      [
        [x1, y, z1],
        [x0, y, z1],
        [0, 0, 1],
      ],
      [
        [x0, y, z1],
        [x0, y, z2],
        [-1, 0, 0],
      ],
    ]) {
      const len = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]),
        t = normalize(p1.map((v, a) => v - p0[a]));
      quad([p0, p1, [p1[0], y + h, p1[2]], [p0[0], y + h, p0[2]]], n, t, [
        [0, 0],
        [len / 3, 0],
        [len / 3, h / 3],
        [0, h / 3],
      ]);
    }
  }
  const vbytes = Buffer.alloc(verts.length * 40);
  verts.forEach((v, i) => {
    v.uv.forEach((x, a) => vbytes.writeUInt16LE(half(x), i * 40 + a * 2));
    for (const [off, vector] of [
      [4, v.p],
      [16, v.normal],
      [28, v.tangent],
    ])
      vector.forEach((x, a) => vbytes.writeFloatLE(x, i * 40 + off + a * 4));
  });
  install(mesh, vbytes, inds, 'Authored visible decks, bridges and step faces');
  for (const m of geometry.meshes.filter((m) => m.worldId === 1 && !selected.has(m.id)))
    buffer.fill(0, m.source.indexDataOffset, m.source.indexDataOffset + m.indices.length * 2);
  // Spawn/recovery and empty donor statistics. The quest layer is separate.
  spawn.forEach((v, a) => buffer.writeFloatLE(v, z.objects[1708].offset + 64 + a * 4));
  buffer.writeUInt32LE(90, z.objects[1671].offset + 64);
  buffer.writeUInt32LE(0, z.objects[1665].offset + 64);
  const empty = z.pointerReferencesByOffset.get(z.objects[1].offset + 48),
    old = z.pointerReferencesByOffset.get(z.objects[1317].offset + 48);
  assert.equal(z.u32(z.objects[1].offset + 40), 1216);
  assert.equal(z.u32(z.objects[1317].offset + 40), 18976);
  source.copy(buffer, old.targetOffset, empty.targetOffset, empty.targetOffset + 1216);
  buffer.writeUInt32LE(1216, z.objects[1317].offset + 40);
  const replaced = replaceMemoryPayloads(buffer, { expectedSha256: sha(buffer), replacements }),
    a = parseIgz(replaced.buffer);
  const target = inspectAppendTarget(replaced.buffer, sha(replaced.buffer)),
    payload = Buffer.alloc(floorBoxes.length * 496),
    objects = [],
    strings = [],
    fixups = { RSTT: [], ROFS: [] };
  for (const [b, index] of floorBoxes.map((b, i) => [b, i])) {
    const offset = index * 496,
      actor = find(a, z.objects[1823].encoded),
      collision = find(a, z.objects[1824].encoded);
    replaced.buffer.copy(payload, offset, actor.offset, actor.offset + 368);
    replaced.buffer.copy(payload, offset + 368, collision.offset, collision.offset + 128);
    payload.writeUInt32LE(2, offset + 8);
    payload.writeUInt32LE(1, offset + 376);
    payload.writeUInt32LE(target.stringCount + strings.length, offset + 16);
    strings.push('Sunbreak ' + b.name + ' ' + index);
    payload.writeBigUInt64LE(BigInt(target.appendOffset + offset + 368), offset + 288);
    b.center.forEach((v, k) => payload.writeFloatLE(v, offset + 64 + k * 4));
    payload.writeUInt32LE(0x69, offset + 368 + 48);
    b.size.forEach((v, k) => payload.writeFloatLE(v / Math.fround(0.3048), offset + 368 + 76 + k * 4));
    objects.push({ offset, type: 'tfbActorInfo' }, { offset: offset + 368, type: 'CollisionInfo' });
    fixups.RSTT.push(offset + 16);
    fixups.ROFS.push(offset + 288);
  }
  const actors = objects.filter((o) => o.type === 'tfbActorInfo').map((o) => o.offset);
  const appended = appendIgz(replaced.buffer, {
    expectedSha256: sha(replaced.buffer),
    appendedDefaultPool: payload,
    appendedObjects: objects,
    fixupSlots: fixups,
    newStrings: strings,
    rootList: { rootEncoded: target.roots[0], appendObjects: actors },
    objectLists: [{ listEncoded: 189400, expectedType: 'ScriptSetList', appendObjects: actors }],
  });
  // Only this camera's heading gets a private literal. The donor zero variant
  // is shared by 17 parameters and must not be edited in place.
  const scene = parseIgz(appended.buffer),
    cameraTarget = inspectAppendTarget(appended.buffer, sha(appended.buffer));
  const cameraBytes = Buffer.alloc(128),
    variant = find(scene, z.objects[1570].encoded),
    rhs = find(scene, z.objects[1571].encoded);
  appended.buffer.copy(cameraBytes, 0, variant.offset, variant.offset + 56);
  appended.buffer.copy(cameraBytes, 56, rhs.offset, rhs.offset + 72);
  cameraBytes.writeUInt32LE(1, 8);
  cameraBytes.writeUInt32LE(1, 64);
  cameraBytes.writeBigUInt64LE(BigInt(cameraTarget.appendOffset + 56), 16);
  cameraBytes.writeInt32LE(180, 120);
  const camera = appendIgz(appended.buffer, {
    expectedSha256: sha(appended.buffer),
    appendedDefaultPool: cameraBytes,
    appendedObjects: [
      { offset: 0, type: 'ValueRHSVariant' },
      { offset: 56, type: 'RHSValueStack' },
    ],
    fixupSlots: { ROFS: [16], RPID: [80], RNEX: [112] },
  });
  const final = Buffer.from(camera.buffer),
    cameraParsed = parseIgz(final),
    oldVariant = find(cameraParsed, variant.encoded);
  assert.equal(cameraParsed.u32(oldVariant.offset + 8), 17);
  final.writeUInt32LE(16, oldVariant.offset + 8);
  final.writeBigUInt64LE(
    BigInt(cameraTarget.appendOffset),
    find(cameraParsed, z.objects[1569].encoded).offset + 88,
  );
  const out = parseIgz(final),
    decoded = loadGeometry(out);
  assert.equal(out.unresolvedFixupEntries.length, 0);
  assert.equal(decoded.warnings.length, 0);
  assert.equal(sha(source), ARENA_INNER_SHA256);
  return {
    buffer: final,
    manifest: {
      schema: 'skylanders-sunbreak-world-v1',
      sourceSha256: sha(source),
      outputSha256: sha(final),
      spawn,
      goal,
      relayWest,
      relayEast,
      platforms,
      collisionBoxes: floorBoxes,
      geometry: plans,
      skyAndMaterialsPreserved: true,
      runtimeValidated: false,
      missionLogicIncluded: false,
      cameraHeadingDegrees: 180,
      memory: replaced.manifest,
      append: appended.manifest,
      cameraAppend: camera.manifest,
    },
  };
}
