// Native static demonstration for the exact CUSA00697 Arena303 profile.
// Reverse-engineered serialization, not the game's source or a general compiler.
// Input game/model assets and generated buffers must remain private.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseIgz } from './igz.mjs';
import { loadGeometry } from './igz_geometry.mjs';
import {
  bcMipLayout,
  thinMicrotileBlockIndex,
  decodePs4BcMip,
  loadMeshTextures,
  halfToFloat,
} from './igz_texture.mjs';
import { appendIgz, inspectAppendTarget } from './igz_append.mjs';
import { replaceMemoryPayloads } from './igz_memory_replace.mjs';
import { encodePs4Bc1Mips } from './ps4_bc1_encode.mjs';
import { parseAuthoredScene } from './authored_scene.mjs';
import { validateTransform } from './object_transform.mjs';

export const NATIVE_DEMO_PROFILE = 'cusa00697-arena303-gallardo-v1';
export const ARENA_INNER_SHA256 = '7488dc91cbb5e801c2d47f13e84c14df6d0724ecf61a579179fcea386dc97899';
export const ARENA_ARCHIVE_SHA256 = '27d374305a08087abfcde0d91f6db147b6591440a088949643aa2bcfe4551145';
const sha = (b) => createHash('sha256').update(b).digest('hex');

export function buildNativeDemo(source, sceneBytes, { expectedSceneSha256 } = {}) {
  assert.ok(Buffer.isBuffer(source) && source.length < 256 * 1024 * 1024, 'Bounded source buffer required');
  assert.equal(sha(source), ARENA_INNER_SHA256, 'Unsupported Arena303 revision');
  assert.match(expectedSceneSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.ok(
    Buffer.isBuffer(sceneBytes) && sceneBytes.length <= 128 * 1024 * 1024,
    'Bounded scene buffer required',
  );
  assert.equal(sha(sceneBytes), expectedSceneSha256, 'Scene SHA-256 mismatch');
  const { document } = parseAuthoredScene(sceneBytes);
  const workshop = document.nativeRecipe === 'cusa00697-static-workshop-v1';
  if (!workshop) {
    assert.equal(
      document.provenance?.archive?.sha256,
      '71d28f33448400829784265b5b4fc24aced3bfacd712f49a351a3ee1c6b83b8b',
      'Unsupported model source',
    );
    assert.equal(
      document.provenance?.shapeSha256,
      '18a67907117904a604280021e193ec41544830e5d2f032bb1bb17d9a1b9bb204',
    );
    assert.equal(document.objects.length, 1, 'This native recipe supports one Gallardo model');
    assert.equal(document.objects[0].id, 1, 'Expected the imported Gallardo actor');
  }
  assert.ok(
    document.objects.length > 0 && document.objects.length <= 128,
    'Workshop supports 1..128 static objects',
  );
  const grid = buildGrid(source);
  const car = importCar(grid.buffer, sceneBytes);
  let placements = { buffer: car.buffer },
    placementRecords = [];
  for (const [i, object] of document.objects.entries()) {
    const box =
      object.collision ??
      (object.id === 1 && document.provenance?.shapeSha256
        ? { shape: 'box', dimensions: [2, 1.15, 4.4], offset: [0, 0, 0] }
        : null);
    assert.ok(box?.shape === 'box', 'Every imported object requires a box collision');
    assert.ok(
      box.dimensions.length === 3 &&
        box.dimensions.every((n) => Number.isFinite(n) && n >= 0.01 && n <= 10000),
      'Invalid collision dimensions',
    );
    assert.ok(
      box.offset.length === 3 && box.offset.every((n) => Number.isFinite(n) && Math.abs(n) <= 10000),
      'Invalid collision offset',
    );
    placements = activatePlacements(
      placements.buffer,
      object.position,
      validateTransform(object),
      box,
      i === 0,
    );
    placementRecords.push({ ...placements.manifest, actorId: object.id });
  }
  const collision = clearDonorCollision(placements.buffer);
  assert.equal(sha(source), ARENA_INNER_SHA256, 'Source mutated');
  return {
    buffer: collision.buffer,
    manifest: {
      schema: 'skylanders-native-demo-v1',
      profile: NATIVE_DEMO_PROFILE,
      sourceSha256: sha(source),
      sceneSha256: sha(sceneBytes),
      outputSha256: sha(collision.buffer),
      stages: {
        grid: grid.manifest,
        car: car.manifest,
        placements: placements.manifest,
        collision: collision.manifest,
      },
      placementRecords,
      runtimeValidated: false,
      limitations: [
        'Static sandbox with a simple car box proxy, not a drivable vehicle or a quest campaign.',
        'Retains donor sky, camera and native outdoor lighting; not an exact editor-light match.',
        'Opaque BC1 model textures; no PBR, reflections or transparent glass.',
        'Missing source resources retain labelled fallback swatches from the scene import.',
        'Chapter registration, matching save migration and UI policy are separate prerequisites.',
        'Exit through the pause/chapter menu; no authored completion reward or end trigger.',
      ],
    },
  };
}

function buildGrid(source) {
  assert.equal(sha(source), '7488dc91cbb5e801c2d47f13e84c14df6d0724ecf61a579179fcea386dc97899');
  const z = parseIgz(source),
    geometry = loadGeometry(z),
    buffer = Buffer.from(source),
    changes = [];
  const record = (offset, length, reason) => changes.push({ offset, length, reason });
  const vector = (at, v) => {
    v.forEach((n, i) => buffer.writeFloatLE(n, at + i * 4));
  };
  const center = [-420, 100, -68],
    spawn = [-423, 101, -71],
    half = 6,
    floor = geometry.meshes.find((m) => m.id === 76);
  assert.equal(geometry.warnings.length, 0);
  assert.equal(floor.source.stride, 40);
  assert.equal(floor.vertexCount, 64);
  const textures = loadMeshTextures(z, [floor]);
  assert.equal(textures.meshTextures.get(76).textureSourceImageId, 82);
  // Hide only old static render triangles, not the sky. Keeping allocation sizes
  // avoids changing GPU buffer descriptors during this first geometry trial.
  for (const mesh of geometry.meshes.filter((m) => m.worldId === 1)) {
    const at = mesh.source.indexDataOffset,
      length = mesh.indices.length * 2;
    buffer.fill(0, at, at + length);
    record(at, length, 'Old world triangles degenerated; sky untouched');
  }
  const vertices = [
      [-half, 0, -half],
      [half, 0, -half],
      [half, 0, half],
      [-half, 0, half],
    ],
    uv = [
      [0, 0],
      [12, 0],
      [12, 12],
      [0, 12],
    ];
  // Exact observed layout: HALF2 UV at 0, float3 position/normal/tangent at
  // 4/16/28. Usage/type table is checked before writing, not inferred by stride.
  const format = z.objects[floor.source.vertexFormatId],
    formatAt = z.pointerReferencesByOffset.get(format.offset + 24).targetOffset;
  assert.equal(
    source.subarray(formatAt, formatAt + z.u32(format.offset + 16)).toString('hex'),
    '2a000000050000000000000002000000000000000400000002000000010000001000000002000000020000001c0000002c0000000000000000000000',
  );
  for (let i = 0; i < floor.vertexCount; i++) {
    const at = floor.source.vertexDataOffset + i * 40,
      k = i < 4 ? i : 0;
    for (let a = 0; a < 2; a++) buffer.writeUInt16LE(uv[k][a] === 12 ? 0x4a00 : 0, at + a * 2);
    vector(
      at + 4,
      vertices[k].map((n, a) => n + center[a]),
    );
    vector(at + 16, [0, 1, 0]);
    vector(at + 28, [1, 0, 0]);
  }
  record(
    floor.source.vertexDataOffset,
    floor.vertexCount * 40,
    'Authored 12m floor, 1m repeating UV cells, up normals',
  );
  [0, 2, 1, 0, 3, 2].forEach((n, i) => buffer.writeUInt16LE(n, floor.source.indexDataOffset + i * 2));
  const box = z.objects[z.pointerReferencesByOffset.get(z.objects[76].offset + 32).targetObjectIndex];
  assert.equal(box.type, 'igAABox');
  assert.equal(box.size, 40);
  // Native class initializer c0ad4e: _min +12, _max +24.
  vector(box.offset + 12, [-426, 99.99, -74]);
  vector(box.offset + 24, [-414, 100.01, -62]);
  record(box.offset + 12, 24, 'Authored drawable bounds');
  vector(z.objects[1708].offset + 64, spawn);
  record(z.objects[1708].offset + 64, 12, 'Player initial location above authored floor');
  for (const [id, before, after, reason] of [
    [1671, 0xfffffc18, 90, 'Fall recovery above retained donor collision'],
    [1665, 2000, 0, 'Empty demo has zero enemies'],
  ]) {
    const o = z.objects[id];
    assert.equal(o.type, 'RHSValueStack');
    assert.equal(z.u32(o.offset + 64), before);
    assert.equal(z.pointerReferences.filter((p) => p.targetObjectIndex === id).length, 1);
    buffer.writeUInt32LE(after, o.offset + 64);
    record(o.offset + 64, 4, reason);
  }
  const rgb565 = ([r, g, b]) =>
    (Math.round((r * 31) / 255) << 11) | (Math.round((g * 63) / 255) << 5) | Math.round((b * 31) / 255);
  function texture(imageId, kind) {
    const image = z.objects[imageId];
    assert.equal(image.type, 'igImage2');
    const exid = z.fixupMap.get('EXID'),
      index = z.u32(image.offset + 80),
      formatHash = z.u32(exid.dataOffset + index * 8);
    const format =
      formatHash === 0xf8313483 ? 'dxt1_tile_ps4' : formatHash === 0xf0b976cf ? 'dxt5_tile_ps4' : null;
    assert.ok(format);
    const width = source.readUInt16LE(image.offset + 64),
      height = source.readUInt16LE(image.offset + 66),
      levels = source.readUInt16LE(image.offset + 70);
    assert.equal(source.readUInt16LE(image.offset + 68), 1);
    assert.equal(z.u32(image.offset + 72), 1);
    const handle = z.tmhnReferences.find((r) => r.offset === image.offset + 96),
      table = z.fixupMap.get('TMHN').dataOffset + handle.tableIndex * 16;
    assert.equal(z.u32(table + 4), 0x30000000);
    const length = z.u32(table),
      at = z.resolvePointer(z.u32(table + 8), length).offset,
      blockBytes = format === 'dxt1_tile_ps4' ? 8 : 16;
    const layouts = bcMipLayout(width, height, levels, blockBytes);
    assert.equal(layouts.at(-1).offset + layouts.at(-1).size, length);
    buffer.fill(0, at, at + length);
    for (const mip of layouts)
      for (let y = 0; y < mip.rows; y++)
        for (let x = 0; x < mip.pitch; x++) {
          const block = at + mip.offset + thinMicrotileBlockIndex(x, y, mip.pitch) * blockBytes,
            color = block + (blockBytes === 16 ? 8 : 0);
          if (blockBytes === 16) {
            buffer[block] = 255;
            buffer[block + 1] = 255;
          }
          const light = kind === 'normal' ? [128, 128, 255] : [180, 185, 190],
            dark = kind === 'normal' ? light : [85, 91, 98];
          buffer.writeUInt16LE(rgb565(light), color);
          buffer.writeUInt16LE(rgb565(dark), color + 2);
          let bits = 0;
          for (let py = 0; py < 4; py++)
            for (let px = 0; px < 4; px++) {
              const u = (x * 4 + px) / mip.width,
                v = (y * 4 + py) / mip.height;
              const line = kind === 'grid' && (u < 0.035 || v < 0.035);
              bits = (bits | ((line ? 1 : 0) << ((py * 4 + px) * 2))) >>> 0;
            }
          buffer.writeUInt32LE(bits, color + 4);
        }
    decodePs4BcMip(buffer.subarray(at, at + length), width, height, levels, format, 256);
    record(at, length, 'Authored ' + kind + ' texture, all existing tiled mips');
  }
  texture(82, 'grid');
  // Reuse the native default_n's exact encoded constant normal block. Both
  // images use the same source-pinned 16-byte-block format. Constant blocks are
  // independent of tiling order; do not reinterpret this as RGBA/BC1 data.
  function imagePayload(id) {
    const o = z.objects[id],
      ref = z.tmhnReferences.find((r) => r.offset === o.offset + 96);
    const at = z.fixupMap.get('TMHN').dataOffset + ref.tableIndex * 16,
      length = z.u32(at);
    const ex = z.fixupMap.get('EXID').dataOffset + z.u32(o.offset + 80) * 8;
    assert.equal(source.subarray(ex, ex + 8).toString('hex'), '6a1e087dc2d03c84');
    return { offset: z.resolvePointer(z.u32(at + 8), length).offset, length };
  }
  const normal = imagePayload(85),
    flatNormal = imagePayload(14),
    block = source.subarray(flatNormal.offset, flatNormal.offset + 16);
  assert.equal(block.toString('hex'), '81804992244992248180499224499224');
  assert.equal(normal.length % 16, 0);
  for (let at = normal.offset; at < normal.offset + normal.length; at += 16) block.copy(buffer, at);
  record(normal.offset, normal.length, 'Native default normal repeated through all normal-map blocks');
  const allowed = new Uint8Array(buffer.length);
  for (const c of changes) allowed.fill(1, c.offset, c.offset + c.length);
  for (let i = 0; i < buffer.length; i++) assert.ok(buffer[i] === source[i] || allowed[i], 'Unexpected edit');
  const target = inspectAppendTarget(buffer, sha(buffer)),
    actor = z.objects[1823],
    collision = z.objects[1824],
    payload = Buffer.alloc(496);
  source.copy(payload, 0, actor.offset, actor.offset + 368);
  source.copy(payload, 368, collision.offset, collision.offset + 128);
  payload.writeUInt32LE(1, 8);
  payload.writeUInt32LE(target.stringCount, 16);
  payload.writeBigUInt64LE(BigInt(target.appendOffset + 368), 288);
  [-420, 99, -68].forEach((n, i) => payload.writeFloatLE(n, 64 + i * 4));
  payload.writeUInt32LE(0x69, 368 + 48);
  [12, 1, 12].forEach((n, i) => payload.writeFloatLE(n / Math.fround(0.3048), 368 + 76 + i * 4));
  const appended = appendIgz(buffer, {
    expectedSha256: sha(buffer),
    appendedDefaultPool: payload,
    appendedObjects: [
      { offset: 0, type: 'tfbActorInfo' },
      { offset: 368, type: 'CollisionInfo' },
    ],
    fixupSlots: { RSTT: [16], ROFS: [288] },
    newStrings: ['Demo_Grid_Floor'],
    rootList: { rootEncoded: target.roots[0], appendObjects: [0] },
  });
  const result = parseIgz(appended.buffer),
    authored = result.objects.find((o) => o.encoded === target.appendOffset);
  assert.equal(result.u32(authored.offset + 8), 1);
  assert.equal(result.pointerReferences.filter((p) => p.targetObjectIndex === authored.index).length, 1);
  const decoded = loadGeometry(result);
  assert.equal(decoded.warnings.length, 0);
  const grid = decoded.meshes.find((m) => m.id === 76);
  assert.deepEqual(grid.positions.slice(0, 3), [-426, 100, -74]);
  return {
    buffer: appended.buffer,
    manifest: {
      sourceSha256: sha(source),
      outputSha256: sha(appended.buffer),
      spawn,
      center,
      dimensions: [12, 1, 12],
      changes,
      append: appended.manifest,
      actorEncoded: target.appendOffset,
      collisionEncoded: target.appendOffset + 368,
    },
  };
}

function importCar(source, sceneBytes) {
  const scene = JSON.parse(sceneBytes),
    z = parseIgz(source),
    geometry = loadGeometry(z),
    textures = loadMeshTextures(z, geometry.meshes);
  const groups = new Map(),
    center = [-420, 100, -68];
  const importedMeshes = scene.meshes.filter((m) => Number.isSafeInteger(m.actorId));
  const triangleCount = importedMeshes.reduce((n, m) => n + m.indices.length / 3, 0);
  for (const mesh of importedMeshes) {
    assert.equal(mesh.positions.length / 3, mesh.normals.length / 3);
    assert.equal(mesh.positions.length / 3, mesh.uvs.length / 2);
    const key = scene.nativeRecipe
      ? mesh.textureId + ':' + mesh.textureWrapS + ':' + mesh.textureWrapT
      : mesh.textureId;
    if (!groups.has(key))
      groups.set(key, {
        texture: scene.textures.find((t) => t.id === mesh.textureId),
        wrapS: mesh.textureWrapS,
        wrapT: mesh.textureWrapT,
        chunks: [],
      });
    const group = groups.get(key);
    let chunk = group.chunks.at(-1);
    const fresh = () => ({ positions: [], normals: [], uvs: [], indices: [], remap: new Map() });
    if (!chunk) {
      chunk = fresh();
      group.chunks.push(chunk);
    }
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const tri = mesh.indices.slice(i, i + 3),
        keys = tri.map((v) => mesh.id + ':' + v);
      if (chunk.positions.length / 3 + new Set(keys.filter((k) => !chunk.remap.has(k))).size > 60000) {
        chunk = fresh();
        group.chunks.push(chunk);
      }
      for (let j = 0; j < 3; j++) {
        const key = keys[j],
          v = tri[j];
        if (!chunk.remap.has(key)) {
          chunk.remap.set(key, chunk.positions.length / 3);
          chunk.positions.push(...mesh.positions.slice(v * 3, v * 3 + 3).map((n, a) => n + center[a]));
          chunk.normals.push(...mesh.normals.slice(v * 3, v * 3 + 3));
          chunk.uvs.push(...mesh.uvs.slice(v * 2, v * 2 + 2));
        }
        chunk.indices.push(chunk.remap.get(key));
      }
    }
  }
  if (!scene.nativeRecipe) assert.equal(groups.size, 33);
  const selected = geometry.meshes.filter((m) => m.worldId === 1 && m.id !== 76 && m.source.stride === 40);
  const chunks = [...groups.values()].flatMap((g) => g.chunks.map((c) => ({ ...c, group: g })));
  assert.ok(
    chunks.length > 0 && chunks.length <= selected.length,
    'Model exceeds native drawable capacity: ' + chunks.length + ' / ' + selected.length,
  );
  assert.equal(
    chunks.reduce((n, c) => n + c.indices.length / 3, 0),
    triangleCount,
  );
  // Every old image object sharing a repurposed handle is also given matching
  // dimensions/format. The preserved sky and floor bindings are never borrowed.
  const reserved = new Set(
    geometry.meshes
      .filter((m) => m.sky || m.id === 76)
      .flatMap((m) => textures.meshTextures.get(m.id).textureBindings.map((b) => b.imageId)),
  );
  const donorImages = z.objects.filter((o) => o.type === 'igImage2' && !reserved.has(o.index));
  assert.ok(donorImages.length >= groups.size);
  const target = inspectAppendTarget(source, sha(source)),
    templateStart = 7200,
    templateEnd = 9328,
    templateSize = templateEnd - templateStart;
  assert.equal(z.objects[77].encoded, templateStart);
  assert.equal(z.objects[97].encoded, templateEnd);
  const templateObjects = z.objects.filter(
    (o) => o.encoded >= templateStart && o.encoded < templateEnd && o.section === 1,
  );
  assert.equal(templateObjects.length, 20);
  const templateFile = z.descriptors[1].offset + templateStart,
    template = source.subarray(templateFile, templateFile + templateSize);
  const payload = Buffer.alloc(templateSize * groups.size),
    objects = [],
    fixups = {},
    increments = new Map(),
    imagePlans = [];
  const increment = (id, n) => increments.set(id, (increments.get(id) ?? 0) + n);
  const sourceTable = z.fixupMap.get('TMHN');
  for (const [groupIndex, g] of [...groups.values()].entries()) {
    const offset = groupIndex * templateSize,
      base = target.appendOffset + offset;
    template.copy(payload, offset);
    g.materialEncoded = base;
    if (scene.nativeRecipe)
      for (const o of templateObjects.filter((o) => o.type === 'igTextureAttr2')) {
        // The floor material template uses the documented igTextureAttr enums.
        const local = offset + o.encoded - templateStart;
        payload.writeUInt32LE(g.wrapS === 'repeat' ? 1 : 0, local + 0x24);
        payload.writeUInt32LE(g.wrapT === 'repeat' ? 1 : 0, local + 0x28);
      }
    const donor = donorImages[groupIndex],
      donorHandle = z.tmhnReferences.find((r) => r.offset === donor.offset + 96);
    assert.ok(donorHandle);
    const tex = g.texture;
    assert.ok(tex);
    let rgba = Buffer.from(tex.rgbaBase64, 'base64'),
      width = tex.width,
      height = tex.height;
    assert.equal(sha(rgba), tex.rgbaSha256);
    if (width === 1 && height === 1) {
      rgba = Buffer.concat(Array.from({ length: 16 }, () => rgba));
      width = height = 4;
    }
    if (width & (width - 1) || height & (height - 1)) {
      // Preview decoding may have resized a source to a non-power-of-two edge.
      // Resample explicitly for this conservative native image profile.
      const w = 2 ** Math.ceil(Math.log2(width)),
        h = 2 ** Math.ceil(Math.log2(height)),
        resampled = Buffer.alloc(w * h * 4);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const u = Math.max(0, Math.min(width - 1, ((x + 0.5) * width) / w - 0.5)),
            v = Math.max(0, Math.min(height - 1, ((y + 0.5) * height) / h - 0.5));
          const x0 = Math.floor(u),
            y0 = Math.floor(v),
            x1 = Math.min(width - 1, x0 + 1),
            y1 = Math.min(height - 1, y0 + 1),
            fx = u - x0,
            fy = v - y0;
          for (let c = 0; c < 4; c++)
            resampled[(y * w + x) * 4 + c] = Math.round(
              (rgba[(y0 * width + x0) * 4 + c] * (1 - fx) + rgba[(y0 * width + x1) * 4 + c] * fx) * (1 - fy) +
                (rgba[(y1 * width + x0) * 4 + c] * (1 - fx) + rgba[(y1 * width + x1) * 4 + c] * fx) * fy,
            );
        }
      rgba = resampled;
      width = w;
      height = h;
    }
    const encodedTexture = encodePs4Bc1Mips(rgba, width, height),
      diffuse = offset + z.objects[82].encoded - templateStart;
    payload.writeUInt16LE(width, diffuse + 64);
    payload.writeUInt16LE(height, diffuse + 66);
    payload.writeUInt16LE(encodedTexture.levels, diffuse + 70);
    payload.writeBigUInt64LE(BigInt(donorHandle.tableIndex), diffuse + 96);
    imagePlans.push({
      donorEncoded: donor.encoded,
      clonedEncoded: base + z.objects[82].encoded - templateStart,
      tableIndex: donorHandle.tableIndex,
      textureId: tex.id,
      sourceDimensions: [tex.width, tex.height],
      width,
      height,
      levels: encodedTexture.levels,
      bytes: encodedTexture.buffer,
    });
    for (const o of templateObjects) {
      const local = o.encoded - templateStart;
      objects.push({ offset: offset + local, type: o.type });
      const inside = z.pointerReferences.filter(
        (r) =>
          r.targetObjectIndex === o.index &&
          r.offset >= templateFile &&
          r.offset < templateFile + templateSize,
      ).length;
      payload.writeUInt32LE(o.index === 77 ? g.chunks.length : inside, offset + local + 8);
    }
    for (const [kind, t] of z.offsetTables) {
      if (['RVTB', 'ROOT'].includes(kind)) continue;
      for (const at of t.offsets)
        if (at >= templateFile && at < templateFile + templateSize) {
          fixups[kind] ??= [];
          fixups[kind].push(offset + at - templateFile);
          if (kind === 'ROFS') {
            const ref = z.pointerReferencesByOffset.get(at);
            assert.ok(ref, 'Initializer ROFS unsupported in material template');
            if (ref.encoded >= templateStart && ref.encoded < templateEnd)
              payload.writeBigUInt64LE(
                BigInt(base + ref.encoded - templateStart),
                offset + at - templateFile,
              );
            else {
              assert.ok(ref.targetObjectIndex !== null);
              increment(ref.targetObjectIndex, 1);
            }
          }
        }
    }
  }
  const appended = appendIgz(source, {
    expectedSha256: sha(source),
    appendedDefaultPool: payload,
    appendedObjects: objects,
    fixupSlots: fixups,
  });
  const buffer = Buffer.from(appended.buffer),
    a = parseIgz(buffer),
    find = (e) => a.objectsByOffset.get(a.resolvePointer(e).offset),
    replacements = [];
  function handleReplacement(tableIndex, bytes, pool) {
    assert.ok(!replacements.some((r) => r.tableIndex === tableIndex), 'Handle selected twice');
    const at = a.fixupMap.get('TMHN').dataOffset + tableIndex * 16,
      size = a.u32(at),
      where = a.resolvePointer(a.u32(at + 8), size);
    const ownerSlots = a.tmhnReferences
      .filter((r) => r.tableIndex === tableIndex)
      .map((r) => {
        const d = a.descriptors.find((d) => r.offset >= d.offset && r.offset + 8 <= d.offset + d.dataSize);
        return (d.index - 1) * 0x08000000 + r.offset - d.offset;
      });
    replacements.push({
      tableIndex,
      expectedPayloadSha256: sha(buffer.subarray(where.offset, where.offset + size)),
      ownerSlots,
      pool,
      flags: a.u32(at + 4),
      bytes,
    });
  }
  for (const plan of imagePlans) {
    const donor = find(plan.donorEncoded),
      clone = find(plan.clonedEncoded);
    assert.ok(a.offsetTables.get('REXT').offsets.includes(donor.offset + 80));
    buffer.copy(buffer, donor.offset + 64, clone.offset + 64, clone.offset + 96);
    handleReplacement(plan.tableIndex, plan.bytes, 'Image');
  }
  function half(value) {
    assert.ok(Number.isFinite(value) && Math.abs(value) <= 65504);
    const f = new Float32Array([value]),
      bits = new Uint32Array(f.buffer)[0],
      sign = (bits >>> 16) & 0x8000,
      e = ((bits >>> 23) & 255) - 127 + 15,
      m = bits & 0x7fffff;
    if (e <= 0) {
      if (e < -10) return sign;
      return sign | Math.min(1023, Math.round((m | 0x800000) / 2 ** (14 - e)));
    }
    const rounded = Math.round(m / 8192);
    return sign | ((e + (rounded === 1024 ? 1 : 0)) << 10) | (rounded & 1023);
  }
  for (const [i, chunk] of chunks.entries()) {
    const mesh = selected[i],
      drawable = find(z.objects[mesh.id].encoded),
      oldMaterial = z.pointerReferencesByOffset.get(z.objects[mesh.id].offset + 16);
    assert.ok(oldMaterial && oldMaterial.targetObjectIndex !== null);
    increment(oldMaterial.targetObjectIndex, -1);
    buffer.writeBigUInt64LE(BigInt(chunk.group.materialEncoded), drawable.offset + 16);
    const vb = find(z.objects[mesh.source.vertexBufferId].encoded),
      ib = find(z.objects[mesh.source.indexBufferId].encoded);
    const nv = chunk.positions.length / 3,
      ni = chunk.indices.length,
      vbytes = Buffer.alloc(nv * 40),
      ibytes = Buffer.alloc(Math.ceil((ni * 2) / 4) * 4);
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < nv; v++) {
      for (let uv = 0; uv < 2; uv++) {
        const original = chunk.uvs[v * 2 + uv],
          h = half(original);
        assert.ok(Number.isFinite(halfToFloat(h)));
        vbytes.writeUInt16LE(h, v * 40 + uv * 2);
      }
      let normal = chunk.normals.slice(v * 3, v * 3 + 3),
        length = Math.hypot(...normal);
      assert.ok(length > 0.01);
      normal = normal.map((n) => n / length);
      const axis = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
      let tangent = [
        normal[1] * axis[2] - normal[2] * axis[1],
        normal[2] * axis[0] - normal[0] * axis[2],
        normal[0] * axis[1] - normal[1] * axis[0],
      ];
      length = Math.hypot(...tangent);
      tangent = tangent.map((n) => n / length);
      for (let c = 0; c < 3; c++) {
        const p = chunk.positions[v * 3 + c];
        vbytes.writeFloatLE(p, v * 40 + 4 + c * 4);
        vbytes.writeFloatLE(normal[c], v * 40 + 16 + c * 4);
        vbytes.writeFloatLE(tangent[c], v * 40 + 28 + c * 4);
        min[c] = Math.min(min[c], p);
        max[c] = Math.max(max[c], p);
      }
    }
    chunk.indices.forEach((n, i) => ibytes.writeUInt16LE(n, i * 2));
    buffer.writeUInt32LE(nv, vb.offset + 12);
    buffer.writeUInt32LE(ni, ib.offset + 12);
    for (const [o, count] of [
      [vb, nv],
      [ib, ni],
    ]) {
      assert.equal(a.u32(o.offset + 16), 4, 'Single-stream count array required');
      const counts = a.pointerReferencesByOffset.get(o.offset + 24);
      assert.ok(counts);
      buffer.writeUInt32LE(count, counts.targetOffset);
    }
    for (const [o, bytes] of [
      [vb, vbytes],
      [ib, ibytes],
    ])
      handleReplacement(a.tmhnReferences.find((r) => r.offset === o.offset + 32).tableIndex, bytes, 'Vertex');
    const box = a.objects[a.pointerReferencesByOffset.get(drawable.offset + 32).targetObjectIndex];
    assert.equal(box.type, 'igAABox');
    assert.equal(a.pointerReferences.filter((r) => r.targetObjectIndex === box.index).length, 1);
    for (let c = 0; c < 3; c++) {
      buffer.writeFloatLE(min[c], box.offset + 12 + c * 4);
      buffer.writeFloatLE(max[c], box.offset + 24 + c * 4);
    }
  }
  for (const [id, delta] of increments) {
    const original = z.objects[id],
      o = find(original.encoded),
      before = z.u32(original.offset + 8);
    assert.equal(before, z.pointerReferences.filter((p) => p.targetObjectIndex === id).length);
    assert.ok(before + delta >= 0);
    buffer.writeUInt32LE(before + delta, o.offset + 8);
  }
  const metadata = parseIgz(buffer);
  for (const o of metadata.objects) {
    const original = z.objects.find((p) => p.encoded === o.encoded);
    if (
      (o.encoded >= target.appendOffset && o.encoded < target.appendOffset + payload.length) ||
      (original && increments.has(original.index))
    )
      assert.equal(
        metadata.u32(o.offset + 8),
        metadata.pointerReferences.filter((r) => r.targetObjectIndex === o.index).length,
        'Material ownership ' + o.encoded,
      );
  }
  const result = replaceMemoryPayloads(buffer, { expectedSha256: sha(buffer), replacements }),
    out = parseIgz(result.buffer),
    decoded = loadGeometry(out);
  assert.equal(decoded.warnings.length, 0);
  assert.equal(out.unresolvedFixupEntries.length, 0);
  const imported = decoded.meshes.filter((m) =>
    selected.slice(0, chunks.length).some((s) => z.objects[s.id].encoded === out.objects[m.id].encoded),
  );
  assert.equal(imported.length, chunks.length);
  assert.equal(
    imported.reduce((n, m) => n + m.triangleCount, 0),
    triangleCount,
  );
  return {
    buffer: result.buffer,
    manifest: {
      sourceSha256: sha(source),
      sceneSha256: sha(sceneBytes),
      outputSha256: sha(result.buffer),
      center,
      chunks: chunks.length,
      triangles: triangleCount,
      textures: groups.size,
      append: appended.manifest,
      memory: result.manifest,
      materials: imagePlans.map(({ bytes, ...p }) => ({ ...p, bytes: bytes.length })),
    },
  };
}

function activatePlacements(
  source,
  carPosition = [0, 0, 0],
  carTransform = { rotationDegrees: [0, 0, 0], scale: [1, 1, 1] },
  box = { dimensions: [2, 1.15, 4.4], offset: [0, 0, 0] },
  activateFloor = true,
) {
  const z = parseIgz(source),
    object = (e) => z.objectsByOffset.get(z.resolvePointer(e).offset);
  const floor = object(202656),
    collision = object(203024),
    list = object(189400),
    target = inspectAppendTarget(source, sha(source));
  assert.equal(floor.type, 'tfbActorInfo');
  assert.equal(list.type, 'ScriptSetList');
  assert.equal(z.u32(floor.offset + 8), activateFloor ? 1 : 2);
  const payload = Buffer.alloc(496);
  source.copy(payload, 0, floor.offset, floor.offset + 368);
  source.copy(payload, 368, collision.offset, collision.offset + 128);
  payload.writeUInt32LE(2, 8);
  payload.writeUInt32LE(target.stringCount, 16);
  payload.writeBigUInt64LE(BigInt(target.appendOffset + 368), 288);
  [-420, 100, -68].forEach((n, i) => payload.writeFloatLE(n + carPosition[i], 64 + i * 4));
  carTransform.rotationDegrees.forEach((n, i) => payload.writeFloatLE(n, 0x4c + i * 4));
  // The native physics producer applies placement scale once. Leave the
  // CollisionInfo dimensions in their original local units.
  carTransform.scale.forEach((n, i) => payload.writeFloatLE(n * 100, 0x114 + i * 4));
  box.dimensions.forEach((n, i) => payload.writeFloatLE(n / Math.fround(0.3048), 368 + 76 + i * 4));
  box.offset.forEach((n, i) => payload.writeFloatLE(n, 368 + 0x34 + i * 4));
  const r = appendIgz(source, {
    expectedSha256: sha(source),
    appendedDefaultPool: payload,
    appendedObjects: [
      { offset: 0, type: 'tfbActorInfo' },
      { offset: 368, type: 'CollisionInfo' },
    ],
    fixupSlots: { RSTT: [16], ROFS: [288] },
    newStrings: [activateFloor ? 'Demo_Gallardo_Collision' : 'Demo_Model_Collision_' + target.appendOffset],
    rootList: { rootEncoded: 8, appendObjects: [0] },
    objectLists: [
      {
        listEncoded: list.encoded,
        expectedType: 'ScriptSetList',
        appendObjects: [0],
        appendExistingObjects: activateFloor ? [floor.encoded] : [],
      },
    ],
  });
  const buffer = Buffer.from(r.buffer),
    a = parseIgz(buffer),
    nextFloor = a.objectsByOffset.get(a.resolvePointer(floor.encoded).offset);
  buffer.writeUInt32LE(2, nextFloor.offset + 8);
  const out = parseIgz(buffer);
  for (const e of [floor.encoded, target.appendOffset]) {
    const o = out.objectsByOffset.get(out.resolvePointer(e).offset);
    assert.equal(out.u32(o.offset + 8), 2);
    assert.equal(out.pointerReferences.filter((p) => p.targetObjectIndex === o.index).length, 2);
  }
  return {
    buffer,
    manifest: {
      sourceSha256: sha(source),
      outputSha256: sha(buffer),
      activationSetEncoded: list.encoded,
      floorEncoded: floor.encoded,
      carCollisionEncoded: target.appendOffset,
      collisionDimensions: box.dimensions,
      collisionOffset: box.offset,
      carPosition,
      carTransform,
      append: r.manifest,
    },
  };
}

function clearDonorCollision(source) {
  const z = parseIgz(source),
    buffer = Buffer.from(source);
  function pack(id) {
    const o = z.objects[id];
    assert.equal(o.type, 'tfbPhysicsWorld');
    assert.equal(o.size, 112);
    const r = z.pointerReferencesByOffset.get(o.offset + 48),
      size = z.u32(o.offset + 40);
    assert.ok(r && r.targetObjectIndex === null);
    assert.equal(z.u32(o.offset + 44), 0x90000000);
    return {
      object: o,
      offset: r.targetOffset,
      size,
      bytes: source.subarray(r.targetOffset, r.targetOffset + size),
    };
  }
  const empty = pack(1),
    sky = pack(1323),
    old = pack(1317);
  assert.equal(empty.size, 1216);
  assert.ok(empty.bytes.equals(sky.bytes));
  assert.equal(sha(empty.bytes), '8ec07b93277afec38fc85b84504f96361d5723fc291981286cbe650a02cffcf0');
  assert.equal(old.size, 18976);
  assert.equal(sha(old.bytes), '8c11933eb4e6a5f3ea0eeb3d2ef0253be52cb4c7ec05e297f0104e1988d7398c');
  empty.bytes.copy(buffer, old.offset);
  buffer.writeUInt32LE(empty.size, old.object.offset + 40);
  const allowed = (i) =>
    (i >= old.offset && i < old.offset + empty.size) ||
    (i >= old.object.offset + 40 && i < old.object.offset + 44);
  for (let i = 0; i < source.length; i++) assert.ok(source[i] === buffer[i] || allowed(i));
  assert.equal(loadGeometry(parseIgz(buffer)).warnings.length, 0);
  return {
    buffer,
    manifest: {
      sourceSha256: sha(source),
      outputSha256: sha(buffer),
      ownerEncoded: old.object.encoded,
      oldSize: old.size,
      newSize: empty.size,
      emptySha256: sha(empty.bytes),
    },
  };
}
