import { parseIgz } from './igz.mjs';

// CUSA00697 PS4 layouts corroborated by REA metadata registration routines.
// Vertex element interpretation is checked against every exported buffer; the
// exporter supports only unskinned Drawables, float3 positions, uint16
// triangle lists and the observed zero/zero geometry subset configuration.
export const GEOMETRY_EVIDENCE = Object.freeze({
  vertexBuffer: 'ev_0f769de1fd57633784e3c2fea3a41ba98508b87703938e8a18b2695aef525ead',
  indexBuffer: 'ev_696baeed23a3d05cf07bd80bfbdc9745a8d03ad874f6cb832d6d3a675264a9bc',
  geometry: 'ev_e3f0912c6cef1e14279e15ceb528b41d20947e2cb3b92482ec405d9ce1780dbf',
  vertexFormat: 'ev_43a6d5dfff8d8c6e8c05915cb412b494f42aba72ffbd94b35ef732c1d09d9d16',
  primitiveEnum: 'ev_2ea9ae925eeb4d1e5c10f63557a98f4f2958005405cc6a8e4422e9b9ae6a7833',
  vertexTypeEnum: 'ev_d3eeca417ba4bce623d2e9ad130e1e02450cb8181238e26b64e33532c081b7f3',
  vertexUsageEnum: 'ev_5ea7fd96d2bd137366b9253485ab3f5bb3abcfa906877d1c29ce5335d52a4dbd',
  bodyInfo: 'ev_854d7f98c902cffa822629e88d4ca29df3903819bf155037b5430d854426f6c8',
  modelInfo: 'ev_fd966f0a18d34eb508ecf7985aa1d1016fa99c95550855786960835c24b3c0a8',
  sceneInfo: 'ev_e8dbb7b2956b1d99c69b50e37087df7a5570261b7474b9e89009d628cb09396e',
  group: 'ev_536af69bd46d48c716c974d368a75c3a6647070f05cbc08c7b7594448f4ac7a1',
  bodyEntityInfo: 'ev_971581f92e870e2d41143b6ceaf6e7a4556e848dde455943f034a11957aa45f4',
  entityInfo: 'ev_c55c504f47c6f70ad5ddd47574af12c9266ec51b134685efb5b7af0644a1dd26',
  placementScale: 'ev_6ba0db4facb80181374263871073835ff56dc1c17a248d2f50dc9b02a8dba9fc',
  initialEulerMatrix: 'ev_2e9d0250f42ec71f1ecbb95187cf0bb0bc0502c6c6a1bee938741f533398b08f',
  boneAttachInfo: 'ev_6e530406e478daacf1058676e6d2615b6a95281fbe9987f640f8222be70197ee',
  attachmentPostload: 'ev_1a27559762706cb767bf481d6eed5fcb9675483821b4345710ff83abfa1f5461',
  attachmentMatrix: 'ev_cc95956b4abcdff6b33d49fbe75661b6515d16863b31314f31b31898d0a14962',
  transformSource3: 'ev_5d3398b340f63a8285e240be3c8a3cfa6a67d5433e17adcc04af765096b0d26b',
  source3Evaluator: 'ev_62f827cc775eeffb31fc6d09a6d260340c64da5be3974457ff801d9fdd4747ce',
  source3TimeSelector: 'ev_0890ef432f79747abba5de2dbe05249b2e3568d99f308c94d7373fc35214b9be',
  quaternionInterpolation: 'ev_ea627189289b9dbd1468aeda019aca81e53610383cd34ab2f7e4bf02a91f3b5b',
  quaternionMatrix: 'ev_ef129432184d850afe1e097d68e3793fae53b6b055bbbbd13fa8f6bc33320a1a',
  entityHierarchy: 'ev_9da2f9ee04bd100e4fca979c53248235fa65ace6e32709b7d0e5641341d6b736',
  entityParentComposition: 'ev_5310330f39555896aa8273ccc79cf557f7a7ebd21e7eb2787e6298b9a89fd83c',
  matrixMultiply: 'ev_2174a21c7aa92371b1d3ca311b8baa73f764c26f7ba51964068c56967cd70d2c',
});
const SIZES = {
  tfbPhysicsWorld: 0x70,
  tfbWorldEntityInfo: 0x38,
  DrawableList: 0x28,
  Drawable: 0x30,
  igGeometryAttr: 0x48,
  igVertexBuffer: 0x58,
  igIndexBuffer: 0x50,
  igVertexFormat: 0x80,
  tfbActorInfo: 0x170,
  tfbPhysicsModel: 0x70,
  tfbPhysicsBody: 0x70,
  tfbBodyEntityInfo: 0x50,
  igGroup: 0x40,
  EntityList: 0x28,
  Entity: 0x20,
  igTransform: 0xa0,
  igTransformSource3: 0x70,
  BoneAttachInfoList: 0x28,
  BoneAttachInfo: 0x60,
};
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
function emptyBounds() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}
function includePoint(bounds, xyz) {
  for (let i = 0; i < 3; i++) {
    bounds.min[i] = Math.min(bounds.min[i], xyz[i]);
    bounds.max[i] = Math.max(bounds.max[i], xyz[i]);
  }
}
function finalized(bounds) {
  return bounds.min.every(Number.isFinite) ? bounds : null;
}
const F = Math.fround,
  add = (a, b) => F(a + b),
  mul = (a, b) => F(a * b);
const identityMatrix = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Exact alpha=0 reduction of FUN_005bf060, not standard SLERP. The
 * polynomial branch does NOT return the first quaternion exactly. Coefficients
 * are the float32 literals at ELF VA d0e434..d0e450; arithmetic order follows
 * 5bf229..5bf2a9 after all finite alpha-multiplied terms reduce to zero.
 */
export function source3QuaternionAtZero(first, second) {
  const valid = (q) =>
    Array.isArray(q) &&
    q.length === 4 &&
    q.every(Number.isFinite) &&
    Math.abs(q.reduce((n, v) => n + v * v, 0) - 1) < 0.001;
  check(valid(first) && valid(second), 'Source3 quaternion is not finite and approximately unit length');
  const a = first.map(F),
    b = second.map(F),
    products = a.map((v, i) => mul(v, b[i]));
  let dot = add(products[0], add(products[1], add(products[2], products[3])));
  if (dot < 0) {
    dot = -dot;
    for (let i = 0; i < 4; i++) b[i] = -b[i];
  }
  if (F(1 - dot) <= F(0.08)) return a.map((v, i) => add(v, mul(F(b[i] - v), 0)));
  const squared = mul(dot, dot),
    cubed = mul(dot, squared);
  const weightA = add(
    add(
      mul(cubed, F(0.0014658536529168487)),
      add(mul(dot, F(0.003932726103812456)), mul(squared, F(-0.004032631870359182))),
    ),
    F(0.9986340403556824),
  );
  const weightB = add(
    add(
      mul(cubed, F(0.0014658503932878375)),
      add(mul(dot, F(0.003932731691747904)), mul(squared, F(-0.004032634198665619))),
    ),
    F(-0.0013659476535394788),
  );
  return a.map((v, i) => add(mul(b[i], weightB), mul(v, weightA)));
}

// FUN_005b38f0(local, parent), expressed in column-major point convention.
function composeEntityMatrix(local, parent) {
  return Array.from({ length: 16 }, (_, i) => {
    const column = Math.floor(i / 4) * 4,
      row = i % 4;
    return add(
      add(mul(local[column], parent[row]), mul(local[column + 1], parent[row + 4])),
      add(mul(local[column + 2], parent[row + 8]), mul(local[column + 3], parent[row + 12])),
    );
  });
}

/** The pure-Y branch of CUSA00697 FUN_00494d10. No scale normalization or
 * general Euler order is inferred. A caller must separately establish a root.
 * Native angle multiplication uses float32; libm results here are preview
 * approximations, not a claim of bit-identical PS4 trigonometric execution.
 */
export function initialRootYawMatrix(position, rotationDegrees, scale) {
  const vector = (values) =>
    Array.isArray(values) &&
    values.length === 3 &&
    values.every((value) => Number.isFinite(value) && Math.abs(value) <= 1e8);
  if (
    ![position, rotationDegrees, scale].every(vector) ||
    rotationDegrees[0] !== 0 ||
    rotationDegrees[2] !== 0 ||
    !scale.every((value) => value === 100)
  )
    return null;
  if (rotationDegrees[1] === 0) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...position, 1];
  const radians = Math.fround(Math.fround(rotationDegrees[1]) * Math.fround(Math.PI / 180));
  const sine = Math.fround(Math.sin(radians)),
    cosine = Math.fround(Math.cos(radians));
  return [cosine, 0, -sine, 0, 0, 1, 0, 0, sine, 0, cosine, 0, ...position, 1];
}

// Known observed exception, not a guessed universal origin/size heuristic.
// Its actual indexed vertices and stored AABox include map-sized coordinates;
// applying an actor matrix is not yet validated for this model.
function modelSpaceLimitation(modelName) {
  return /(?:^|\/)Level_303\/models\/303_retracting_ledge\.mdl$/i.test(modelName.replaceAll('\\', '/'))
    ? 'Known retracting-ledge model has unverified mixed/baked coordinates; world placement requires runtime validation'
    : null;
}

function geometryReader(input, { maxVertices = 2_000_000, maxIndices = 12_000_000 } = {}) {
  const z = input?.objects && input?.buffer ? input : parseIgz(input);
  check(
    Number.isSafeInteger(maxVertices) &&
      maxVertices > 0 &&
      Number.isSafeInteger(maxIndices) &&
      maxIndices > 0,
    'Invalid geometry resource limits',
  );
  const bounds = emptyBounds(),
    contentBounds = emptyBounds();
  const handles = new Map(z.tmhnReferences.map((r) => [r.offset, r]));
  const tmhn = z.fixupMap.get('TMHN');
  let vertexCount = 0,
    indexCount = 0;

  function typed(object, type) {
    check(
      object?.type === type && object.size === SIZES[type],
      `Expected ${type} size 0x${SIZES[type].toString(16)}`,
    );
    return object;
  }
  function pointer(object, field, span = 1) {
    check(field >= 0 && field + 8 <= object.size, `${object.type} pointer field exceeds object span`);
    const p = z.pointerReferencesByOffset.get(object.offset + field);
    check(p, `${object.type}#${object.index}+0x${field.toString(16)} has no ordinary ROFS pointer`);
    z.resolvePointer(p.encoded, span);
    return p;
  }
  function objectRef(object, field, type) {
    return typed(z.objectsByOffset.get(pointer(object, field).targetOffset), type);
  }
  function memoryHandle(object, field) {
    const ref = handles.get(object.offset + field);
    check(ref && tmhn, `${object.type}#${object.index} lacks RMHN data handle`);
    check(tmhn.end - tmhn.dataOffset === tmhn.count * 16, 'Unsupported TMHN entry layout');
    const at = tmhn.dataOffset + ref.tableIndex * 16;
    const size = z.u32(at),
      flags = z.u32(at + 4),
      encoded = z.u32(at + 8);
    check(flags === 0, `Unsupported geometry memory flags 0x${flags.toString(16)}`);
    check(z.u32(at + 12) === 0, 'Nonzero upper TMHN encoded pointer');
    return {
      size,
      flags,
      encoded,
      offset: z.resolvePointer(encoded, size).offset,
      tableIndex: ref.tableIndex,
    };
  }
  function listObjects(list, type) {
    const count = z.u32(list.offset + 0xc),
      capacity = z.u32(list.offset + 0x10),
      byteSize = z.u32(list.offset + 0x18);
    check(
      count <= capacity && count <= 100_000 && byteSize >= count * 8,
      `Invalid ${list.type} count/capacity/byte span`,
    );
    if (!count) return [];
    const data = pointer(list, 0x20, count * 8).targetOffset;
    const result = [];
    for (let i = 0; i < count; i++) {
      const p = z.pointerReferencesByOffset.get(data + i * 8);
      check(p, `${list.type} item ${i} lacks a relocation`);
      result.push(typed(z.objectsByOffset.get(p.targetOffset), type));
    }
    return result;
  }
  function decodeDrawable(drawable, world, worldName) {
    const geometry = objectRef(drawable, 0x18, 'igGeometryAttr');
    const vb = objectRef(geometry, 0x18, 'igVertexBuffer'),
      ib = objectRef(geometry, 0x20, 'igIndexBuffer');
    const format = objectRef(vb, 0x28, 'igVertexFormat');
    const nv = z.u32(vb.offset + 0xc),
      ni = z.u32(ib.offset + 0xc),
      stride = z.u32(format.offset + 0xc);
    check(
      nv > 0 && ni > 0 && nv <= maxVertices && ni <= maxIndices,
      'Invalid or excessive vertex/index count',
    );
    // Native GPU allocation also consumes the per-stream count array. A
    // scalar-only resize can look valid in an offline mesh and fail in-game.
    for (const [b, count] of [
      [vb, nv],
      [ib, ni],
    ]) {
      check(z.u32(b.offset + 0x10) === 4, 'Only single-stream count arrays are supported');
      const counts = pointer(b, 0x18, 4).targetOffset;
      check(z.u32(counts) === count, `${b.type} scalar and stream counts disagree`);
    }
    check(
      vertexCount + nv <= maxVertices && indexCount + ni <= maxIndices,
      'Scene exceeds geometry resource limits',
    );
    const vertexPrimitive = z.u32(vb.offset + 0x30),
      indexPrimitive = z.u32(ib.offset + 0x30);
    check(
      vertexPrimitive === 3 && indexPrimitive === 3 && ni % 3 === 0,
      'Only triangle-list primitive type 3 is supported',
    );
    const subsetOffset = z.u32(geometry.offset + 0x28),
      subsetPrimitiveCount = z.u32(geometry.offset + 0x2c);
    check(
      subsetOffset === 0 && subsetPrimitiveCount === 0,
      'Nonzero geometry draw subsets need additional runtime validation',
    );
    const vertexData = memoryHandle(vb, 0x20),
      indexData = memoryHandle(ib, 0x20);
    check(
      stride >= 12 && stride <= 256 && vertexData.size === nv * stride,
      'Vertex data length does not equal count × stride',
    );
    check(
      indexData.size === Math.ceil((ni * 2) / 4) * 4,
      'Index data is not a uint16 array padded to four bytes',
    );
    const elementsSize = z.u32(format.offset + 0x10);
    check(
      elementsSize >= 12 && elementsSize <= 12 * 32 && elementsSize % 12 === 0,
      'Invalid vertex-element table size',
    );
    const elementsAt = pointer(format, 0x18, elementsSize).targetOffset;
    const elements = [];
    for (let at = elementsAt; at < elementsAt + elementsSize; at += 12)
      elements.push({
        type: z.buffer[at],
        stream: z.buffer[at + 1],
        mapToElement: z.buffer[at + 2],
        count: z.buffer[at + 3],
        usage: z.buffer[at + 4],
        usageIndex: z.buffer[at + 5],
        packDataOffset: z.buffer[at + 6],
        packHint: z.buffer[at + 7],
        offset: z.buffer.readUInt16LE(at + 8),
        frequency: z.buffer.readUInt16LE(at + 10),
      });
    const positionsElements = elements.filter((e) => e.type !== 44 && e.usage === 0 && e.usageIndex === 0);
    check(positionsElements.length === 1, 'Vertex format must expose exactly one position element');
    const positionElement = positionsElements[0];
    check(
      positionElement.type === 2 &&
        positionElement.stream === 0 &&
        positionElement.offset + 12 <= stride &&
        positionElement.packHint === 0,
      'Unsupported packed/multistream/non-float3 position format',
    );
    check(
      z.buffer.readUInt16LE(drawable.offset + 0x2a) === 0xffff,
      'Skinned/blended Drawable needs its transform hierarchy',
    );
    const positions = new Array(nv * 3),
      indices = new Array(ni),
      meshBounds = emptyBounds();
    for (let i = 0; i < nv; i++) {
      const xyz = [];
      for (let axis = 0; axis < 3; axis++) {
        const value = z.buffer.readFloatLE(
          vertexData.offset + i * stride + positionElement.offset + axis * 4,
        );
        check(
          Number.isFinite(value) && Math.abs(value) <= 1e8,
          'Vertex position is nonfinite or outside supported range',
        );
        positions[i * 3 + axis] = value;
        xyz.push(value);
      }
      includePoint(meshBounds, xyz);
    }
    for (let i = 0; i < ni; i++) {
      const index = z.buffer.readUInt16LE(indexData.offset + i * 2);
      check(index < nv, `Triangle index ${index} exceeds vertex count ${nv}`);
      indices[i] = index;
    }
    vertexCount += nv;
    indexCount += ni;
    const modelLocal = world.type === 'tfbPhysicsModel';
    const sky = !modelLocal && /(?:^|[\\/])_?sky(?:[\\/_]|$)/i.test(worldName);
    includePoint(bounds, meshBounds.min);
    includePoint(bounds, meshBounds.max);
    if (!sky) {
      includePoint(contentBounds, meshBounds.min);
      includePoint(contentBounds, meshBounds.max);
    }
    return {
      id: drawable.index,
      geometryId: geometry.index,
      ...(modelLocal ? { modelId: world.index, modelName: worldName } : { worldId: world.index, worldName }),
      name: `${worldName} / Drawable ${drawable.index}`,
      sky,
      positions,
      indices,
      bounds: meshBounds,
      vertexCount: nv,
      triangleCount: ni / 3,
      coordinateSpace: modelLocal
        ? 'model-local vertex coordinates; placement transform not applied'
        : 'stored static-world vertex coordinates',
      source: {
        drawableOffset: drawable.offset,
        geometryOffset: geometry.offset,
        vertexBufferId: vb.index,
        indexBufferId: ib.index,
        vertexFormatId: format.index,
        stride,
        positionOffset: positionElement.offset,
        vertexDataOffset: vertexData.offset,
        indexDataOffset: indexData.offset,
        indexWidth: 2,
        subsetOffset,
        subsetPrimitiveCount,
        exportMode: 'complete-index-buffer',
        entityIndex: z.buffer.readUInt16LE(drawable.offset + 0x28),
      },
    };
  }
  return {
    z,
    typed,
    pointer,
    objectRef,
    listObjects,
    decodeDrawable,
    get totals() {
      return { vertices: vertexCount, triangles: indexCount / 3 };
    },
    get bounds() {
      return finalized(bounds);
    },
    get contentBounds() {
      return finalized(contentBounds);
    },
  };
}

/** Read static world triangle meshes without changing an IGZ or its graph. */
export function loadGeometry(input, limits = {}) {
  const reader = geometryReader(input, limits);
  const { z, typed, objectRef, listObjects, decodeDrawable } = reader;
  const warnings = [],
    meshes = [];
  let drawableCount = 0;
  const worlds = z.objects.filter((o) => o.type === 'tfbPhysicsWorld');
  for (const world of worlds) {
    const worldName = z.stringReferencesByOffset.get(world.offset + 0x10)?.value ?? `World ${world.index}`;
    let drawables;
    try {
      typed(world, 'tfbPhysicsWorld');
      const worldInfo = objectRef(world, 0x50, 'tfbWorldEntityInfo');
      drawables = listObjects(objectRef(worldInfo, 0x28, 'DrawableList'), 'Drawable');
    } catch (error) {
      warnings.push(`${worldName}: ${error.message}`);
      continue;
    }
    drawableCount += drawables.length;
    for (const drawable of drawables) {
      try {
        meshes.push(decodeDrawable(drawable, world, worldName));
      } catch (error) {
        warnings.push(`${worldName} / Drawable ${drawable.index}: ${error.message}`);
      }
    }
  }
  if (!worlds.length)
    warnings.push(
      'No static tfbPhysicsWorld graph: actor templates and their transform hierarchies are not exported as world geometry.',
    );
  return {
    meshes,
    warnings,
    bounds: reader.bounds,
    contentBounds: reader.contentBounds,
    counts: { worlds: worlds.length, drawables: drawableCount, meshes: meshes.length, ...reader.totals },
    limitations: [
      'Static render geometry only; no texture/material shader reproduction or Havok collision export.',
      'Exports stored coordinates. Runtime animation, actor transforms and skinned meshes are not applied.',
      'Zero offset/count geometry is exported as its complete index buffer; nonzero draw subsets are rejected.',
    ],
    evidence: GEOMETRY_EVIDENCE,
  };
}

/** Decode bounded unskinned actor models without model animation/state data.
 * Supported entity trees are explicit time-zero previews. Geometry remains local.
 * worldMatrix is supplied exclusively for a null-parent, unattached, yaw-only actor
 * with the observed default scale and no known model-space ambiguity.
 */
export function loadActorGeometry(input, limits = {}) {
  const { z, typed, pointer, objectRef, listObjects, decodeDrawable } = geometryReader(input, limits);
  const meshes = [],
    models = [],
    actors = [],
    proxies = [],
    warnings = [],
    modelCache = new Map();
  const actorObjects = z.objects.filter((o) => o.type === 'tfbActorInfo');
  const name = (o) => z.stringReferencesByOffset.get(o.offset + 0x10)?.value ?? `${o.type} ${o.index}`;
  const externalSlots = new Set(
    ['RNEX', 'REXT', 'RPID', 'RHND'].flatMap((magic) =>
      Array.from(z.offsetTables?.get(magic)?.offsets ?? []),
    ),
  );
  const nullField = (o, field) =>
    z.buffer.readBigUInt64LE(o.offset + field) === 0n &&
    !z.pointerReferencesByOffset.has(o.offset + field) &&
    !z.specialRelocationsByOffset?.has(o.offset + field) &&
    !externalSlots.has(o.offset + field);
  const vec3 = (o, field) => [0, 1, 2].map((i) => z.buffer.readFloatLE(o.offset + field + i * 4));
  const finiteValues = (values) => values.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e8);
  function affineMatrix(values) {
    check(
      finiteValues(values) && values[3] === 0 && values[7] === 0 && values[11] === 0 && values[15] === 1,
      'Entity matrix is nonfinite, nonaffine or outside supported range',
    );
    return values;
  }
  function source3AtZero(source) {
    typed(source, 'igTransformSource3');
    const stride = z.u32(source.offset + 0xc),
      dataCount = z.u32(source.offset + 0x10),
      timeCount = z.u32(source.offset + 0x28);
    check(
      stride === 12 && timeCount >= 2 && timeCount <= 4096 && dataCount === timeCount * stride,
      'Unsupported Source3 time-zero stride/frame count',
    );
    for (const [field, count, flags] of [
      [0x10, dataCount, 0x90000000],
      [0x28, timeCount, 0x80000000],
    ]) {
      check(
        z.u32(source.offset + field + 4) === 0 &&
          z.u32(source.offset + field + 8) === count * 4 &&
          z.u32(source.offset + field + 12) === flags,
        'Unsupported Source3 memory span/flags',
      );
    }
    const data = pointer(source, 0x20, dataCount * 4).targetOffset;
    const times = pointer(source, 0x38, timeCount * 4).targetOffset;
    const duration = z.buffer.readFloatLE(source.offset + 0x40),
      timeOffset = z.buffer.readFloatLE(source.offset + 0x44);
    check(
      Number.isFinite(duration) &&
        duration > 0 &&
        duration <= 1e8 &&
        timeOffset === 0 &&
        z.u32(source.offset + 0x54) === 0,
      'Source3 preview requires zero time offset and observed play mode 0',
    );
    let previous = -1;
    for (let i = 0; i < timeCount; i++) {
      const time = z.buffer.readFloatLE(times + i * 4);
      check(
        Number.isFinite(time) && time > previous && time <= duration && (i !== 0 || time === 0),
        'Source3 times must start at zero and be finite, strictly increasing and within duration',
      );
      previous = time;
    }
    check(
      z.u32(source.offset + 0x48) === 11 &&
        z.buffer.subarray(source.offset + 0x4c, source.offset + 0x52).equals(Buffer.from([4, 0, 7, 1, 3, 1])),
      'Unsupported Source3 channels/offsets/interpolation',
    );
    const frames = [0, 1].map((frame) =>
      Array.from({ length: stride }, (_, i) => z.buffer.readFloatLE(data + (frame * stride + i) * 4)),
    );
    check(frames.every(finiteValues), 'Source3 first interpolation interval contains invalid data');
    const [x, y, qz, w] = source3QuaternionAtZero(frames[0].slice(0, 4), frames[1].slice(0, 4));
    const xx = mul(x, x),
      yy = mul(y, y),
      zz = mul(qz, qz),
      xy = mul(x, y),
      xz = mul(x, qz),
      yz = mul(y, qz);
    const xw = mul(x, w),
      yw = mul(y, w),
      zw = mul(qz, w),
      twice = (v) => add(v, v);
    const matrix = [
      add(mul(add(yy, zz), -2), 1),
      twice(F(xy - zw)),
      twice(add(xz, yw)),
      0,
      twice(add(xy, zw)),
      F(1 - twice(add(xx, zz))),
      twice(F(yz - xw)),
      0,
      twice(F(xz - yw)),
      twice(add(yz, xw)),
      F(1 - twice(add(xx, yy))),
      0,
      0,
      0,
      0,
      1,
    ];
    const center = vec3(source, 0x60);
    check(
      finiteValues(center) && z.buffer.readFloatLE(source.offset + 0x6c) === 0,
      'Unsupported Source3 center of rotation',
    );
    for (let axis = 0; axis < 3; axis++) {
      const rotated = add(
        add(mul(center[0], matrix[axis]), mul(center[1], matrix[4 + axis])),
        mul(center[2], matrix[8 + axis]),
      );
      // The vector lerp at alpha=0 yields the first translation/scale; unlike
      // quaternion mode3, these channels have no endpoint polynomial residual.
      matrix[12 + axis] = add(F(center[axis] - rotated), frames[0][4 + axis]);
    }
    for (let axis = 0; axis < 3; axis++)
      for (let row = 0; row < 4; row++)
        matrix[axis * 4 + row] = mul(matrix[axis * 4 + row], frames[0][7 + axis]);
    return affineMatrix(matrix);
  }
  function entityHierarchy(list) {
    check(z.u32(list.offset + 0xc) <= 1024, 'Entity hierarchy exceeds native preview limit');
    const entities = listObjects(list, 'Entity'),
      result = [];
    for (const [index, entity] of entities.entries()) {
      const parentIndex = z.buffer.readUInt16LE(entity.offset + 0x1c);
      check(
        z.buffer.readUInt16LE(entity.offset + 0x1e) === 0,
        'Articulated/flagged entity hierarchy is not supported',
      );
      check(
        parentIndex === 0xffff || parentIndex < index,
        'Entity parent must precede child; cycles and forward references are unsupported',
      );
      let local = identityMatrix(),
        transformId = null,
        sourceId = null;
      if (!nullField(entity, 0x10)) {
        const transform = objectRef(entity, 0x10, 'igTransform');
        transformId = transform.index;
        check(nullField(transform, 0x88), 'Legacy entity transform input is not supported');
        local = affineMatrix(
          Array.from({ length: 16 }, (_, i) => z.buffer.readFloatLE(transform.offset + 0x40 + i * 4)),
        );
        if (!nullField(transform, 0x90)) {
          const source = objectRef(transform, 0x90, 'igTransformSource3');
          sourceId = source.index;
          // FUN_004d05c0 replaces _m with source output; it does not multiply
          // the evaluated source by the stored matrix a second time.
          local = source3AtZero(source);
        }
      }
      result.push({
        id: entity.index,
        parentIndex,
        transformId,
        sourceId,
        matrix: affineMatrix(
          parentIndex === 0xffff ? local : composeEntityMatrix(local, result[parentIndex].matrix),
        ),
      });
    }
    return result;
  }
  function applyEntity(mesh, entity, pose) {
    const matrix = entity.matrix,
      positions = new Array(mesh.positions.length),
      bounds = emptyBounds();
    for (let at = 0; at < mesh.positions.length; at += 3) {
      const point = [0, 1, 2].map((axis) =>
        add(
          add(
            add(mul(mesh.positions[at], matrix[axis]), mul(mesh.positions[at + 1], matrix[4 + axis])),
            mul(mesh.positions[at + 2], matrix[8 + axis]),
          ),
          matrix[12 + axis],
        ),
      );
      check(finiteValues(point), 'Entity-composed vertex exceeds supported range');
      for (let axis = 0; axis < 3; axis++) positions[at + axis] = point[axis];
      includePoint(bounds, point);
    }
    return {
      ...mesh,
      positions,
      bounds,
      pose,
      coordinateSpace: 'entity-composed model-local coordinates; explicit time-zero hierarchy preview',
      source: {
        ...mesh.source,
        entityId: entity.id,
        transformId: entity.transformId,
        source3Id: entity.sourceId,
        entityModelMatrix: matrix,
        storedVerticesTransformed: true,
      },
    };
  }
  function socketDefinitions(model) {
    if (nullField(model, 0x50)) return [];
    const list = objectRef(model, 0x50, 'BoneAttachInfoList');
    return listObjects(list, 'BoneAttachInfo').map((socket) => {
      // Native postload resolves these names into a bone index; the separate
      // attachment matrix routines consume their Euler transform. Neither
      // operation transforms the owning model's vertex buffers. The supported
      // body below has no skeleton/entity hierarchy, so only unresolved-bone,
      // ordinary type-0 sockets without exported visuals are accepted.
      const boneIndex = z.buffer.readInt16LE(socket.offset + 0x40);
      const exportsVisuals = z.buffer[socket.offset + 0x42],
        attachmentType = z.u32(socket.offset + 0x5c);
      check(
        boneIndex === -1 && exportsVisuals === 0 && attachmentType === 0,
        'Bone-dependent/exported-visual/special-type attachment socket is not supported',
      );
      const boneName = z.stringReferencesByOffset.get(socket.offset + 0x38)?.value ?? null;
      check(
        boneName !== null || nullField(socket, 0x38),
        'Attachment bone name lacks a resolved string reference',
      );
      const position = vec3(socket, 0x44),
        rotationDegrees = vec3(socket, 0x50);
      check(
        [...position, ...rotationDegrees].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e8),
        'Attachment socket transform is nonfinite or outside supported range',
      );
      return {
        id: socket.index,
        name: z.stringReferencesByOffset.get(socket.offset + 0x10)?.value ?? null,
        boneName,
        boneIndex,
        exportsVisuals: false,
        attachmentType,
        position,
        rotationDegrees,
        definitionOnly: true,
      };
    });
  }
  function decodeModel(model) {
    typed(model, 'tfbPhysicsModel');
    for (const field of [0x38, 0x40])
      check(nullField(model, field), 'Animated/state-driven model is not supported');
    const body = objectRef(model, 0x28, 'tfbPhysicsBody');
    for (const field of [0x50, 0x58])
      check(nullField(body, field), 'Body combiner/viseme hierarchy is not supported');
    const group = z.objectsByOffset.get(pointer(body, 0x40).targetOffset);
    check(group?.type === 'igGroup' || group?.type === 'igTransform', 'Unsupported model scene graph root');
    typed(group, group.type);
    check(nullField(group, 0x38), 'Model scene child hierarchy is not supported');
    const info = objectRef(body, 0x60, 'tfbBodyEntityInfo');
    check(
      (z.u32(info.offset + 0x38) & 3) === 0 && nullField(info, 0x48),
      'Skinned/articulated model is not supported',
    );
    const entities = objectRef(info, 0x30, 'EntityList');
    const hierarchy = entityHierarchy(entities);
    check(
      hierarchy.length > 0 || group.type === 'igGroup',
      'Transform-root model without entity hierarchy is unsupported',
    );
    check(!hierarchy.length || nullField(model, 0x50), 'Sockets on hierarchical models are not supported');
    const pose = hierarchy.length
      ? {
          kind: 'entity-hierarchy-time-zero',
          timeSeconds: 0,
          runtimeAnimation: false,
          source3Ids: [...new Set(hierarchy.map((entity) => entity.sourceId).filter((id) => id !== null))],
        }
      : null;
    const sockets = socketDefinitions(model);
    const drawables = listObjects(objectRef(info, 0x28, 'DrawableList'), 'Drawable');
    check(drawables.length > 0, 'Model has no render Drawables');
    const modelMeshes = [],
      modelBounds = emptyBounds();
    for (const drawable of drawables) {
      const entityIndex = z.buffer.readUInt16LE(drawable.offset + 0x28);
      check(
        entityIndex === 0xffff || entityIndex < hierarchy.length,
        'Drawable references an unresolved entity transform',
      );
      let mesh = decodeDrawable(drawable, model, name(model));
      if (entityIndex !== 0xffff) mesh = applyEntity(mesh, hierarchy[entityIndex], pose);
      modelMeshes.push(mesh);
      includePoint(modelBounds, mesh.bounds.min);
      includePoint(modelBounds, mesh.bounds.max);
    }
    const result = {
      id: model.index,
      name: name(model),
      bodyId: body.index,
      meshIds: modelMeshes.map((m) => m.id),
      bounds: finalized(modelBounds),
      modelSpaceLimitation: modelSpaceLimitation(name(model)),
      sockets,
      pose,
    };
    meshes.push(...modelMeshes);
    models.push(result);
    return result;
  }
  let modelLinkedActors = 0;
  for (const actor of actorObjects) {
    try {
      typed(actor, 'tfbActorInfo');
      if (nullField(actor, 0x158)) {
        proxies.push({ actorId: actor.index, reason: 'No serialized actor model' });
        continue;
      }
      modelLinkedActors++;
      const model = objectRef(actor, 0x158, 'tfbPhysicsModel');
      if (!modelCache.has(model.index)) {
        try {
          modelCache.set(model.index, { value: decodeModel(model) });
        } catch (error) {
          modelCache.set(model.index, { error: error.message });
          warnings.push(`${name(model)}: ${error.message}`);
        }
      }
      const cached = modelCache.get(model.index);
      check(!cached.error, cached.error);
      const position = vec3(actor, 0x40),
        rotationDegrees = vec3(actor, 0x4c),
        scale = vec3(actor, 0x114);
      check(
        [...position, ...rotationDegrees, ...scale].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e8),
        'Actor transform is nonfinite or outside supported range',
      );
      const root = nullField(actor, 0x80);
      const unattached = nullField(actor, 0xa0) && nullField(actor, 0xa8);
      const matrix = initialRootYawMatrix(position, rotationDegrees, scale);
      const modelSpaceIssue = cached.value.modelSpaceLimitation;
      const worldMatrix = root && unattached && !modelSpaceIssue ? matrix : null;
      let transformStatus = worldMatrix
        ? rotationDegrees[1] === 0
          ? 'translation-only initial root transform; default scale'
          : 'native-verified initial root Y rotation and translation; default scale'
        : !root
          ? 'parent-relative transform composition not implemented'
          : !unattached
            ? 'actor attachment-relative transform composition not implemented'
            : (modelSpaceIssue ?? 'nondefault scale or non-Y rotation not implemented');
      if (worldMatrix && cached.value.pose)
        transformStatus += '; explicit entity-hierarchy preview at t=0, not runtime animation';
      actors.push({
        id: actor.index,
        name: name(actor),
        modelId: model.index,
        meshIds: cached.value.meshIds,
        position,
        rotationDegrees,
        scale,
        worldMatrix,
        transformStatus,
        pose: cached.value.pose,
      });
      if (!worldMatrix) proxies.push({ actorId: actor.index, reason: transformStatus });
    } catch (error) {
      proxies.push({ actorId: actor.index, reason: error.message });
    }
  }
  return {
    meshes,
    models,
    actors,
    proxies,
    warnings,
    counts: {
      actorObjects: actorObjects.length,
      modelLinkedActors,
      uniqueModels: modelCache.size,
      decodedModels: models.length,
      decodedActors: actors.length,
      worldReadyActors: actors.filter((a) => a.worldMatrix).length,
      proxies: proxies.length,
      meshes: meshes.length,
      vertices: meshes.reduce((n, m) => n + m.vertexCount, 0),
      triangles: meshes.reduce((n, m) => n + m.triangleCount, 0),
    },
    limitations: [
      'Unskinned models without model animation/state data; flat models or bounded nonarticulated entity trees only. Unresolved models remain proxies.',
      'Supported Source3 entity transforms are explicitly sampled at t=0 with the native endpoint polynomial; this is not a bind pose or live animation.',
      'Meshes are model-local. A worldMatrix requires serialized null parent/attachment fields, Y-only rotation and default [100,100,100] scale; known model-space ambiguity remains a proxy.',
      'Type-0 non-visual socket definitions on flat models are metadata only; socket transforms are not applied to owning vertices and attached children are not instantiated.',
      'World matrices describe the initial serialized layout, not script-driven runtime positions, template activation or runtime visibility.',
      'No skeletal poses, materials, texture shaders, collision or model edits are exported.',
    ],
    evidence: GEOMETRY_EVIDENCE,
  };
}
