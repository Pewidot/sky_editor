#!/usr/bin/env node
// Narrow edits to REA-verified fields, preserving every other input byte.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseIgz } from './igz.mjs';
import { loadGeometry, loadActorGeometry, initialRootYawMatrix } from './igz_geometry.mjs';
import { loadMeshTextures, TEXTURE_LIMITATIONS } from './igz_texture.mjs';
import { runAuthoredSceneRequest } from './authored_scene.mjs';

export const PROFILE = 'trap-team-ps4-igz8-placement-v1';
export const EXECUTABLE_SHA256 = '423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3';
// Do not infer inheritance from a name or a sufficiently large object.
const PLACEMENTS = new Map([
  ['AbstractPlacement', 0xf0],
  ['Placement', 0x138],
  ['tfbActorInfo', 0x170],
]);
const EVIDENCE = [
  'ev_73149e2c670fd8caad841b69d5a7857cac6dc56b121fb64a3a21fcaca9d13bb5',
  'ev_6e8c2a28061c58fccd410ee7b6a4a37052162defb4f70f2f0c7b9a3fbce58139',
  'ev_d03688bf1dfdf668c17648da1550b0971d0d1ec6d6fb8d7037bd7c301b3dbb01',
  'ev_8eb83d599d2f81547d093036cd928717f69f36f55af63f0f6f8c2e726d685504',
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function check(ok, message) {
  if (!ok) throw new Error(message);
}
function string(value, label) {
  check(
    typeof value === 'string' && value.length > 0 && !value.includes('\0'),
    `${label} must be a nonempty path/string`,
  );
  return value;
}
function integer(value, label, min, max) {
  check(
    Number.isSafeInteger(value) && value >= min && value <= max,
    `${label} must be an integer in ${min}..${max}`,
  );
  return value;
}
function vec3(buffer, offset) {
  return [0, 1, 2].map((i) => buffer.readFloatLE(offset + i * 4));
}
function finitePosition(position) {
  return (
    Array.isArray(position) &&
    position.length === 3 &&
    position.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6)
  );
}
export function describeObject(igz, object) {
  const name = igz.stringReferencesByOffset.get(object.offset + 0x10)?.value ?? '';
  const known = PLACEMENTS.get(object.type) === object.size;
  const position = known ? vec3(igz.buffer, object.offset + 0x40) : undefined;
  const editable = known && finitePosition(position);
  const ref = (offset) =>
    igz.pointerReferencesByOffset.get(object.offset + offset)?.targetObjectIndex ?? null;
  return {
    id: object.index,
    type: object.type,
    offset: object.offset,
    size: object.size,
    name,
    editable,
    ...(known
      ? {
          position,
          rotationDegrees: vec3(igz.buffer, object.offset + 0x4c),
          parentObjectId: ref(0x80),
          collisionObjectId: object.size >= 0x138 ? ref(0x120) : null,
          coordinateSpace: 'serialized initial transform; may be relative to parent',
        }
      : {}),
  };
}
function limitations(igz) {
  return [
    'Experimental static-file editor; runtime loading and gameplay are not validated.',
    'Edits only the initial position of existing verified placement classes. No new objects, meshes, scripts or level slots are created.',
    'Coordinates can be parent-relative. Collision, navigation, scripts and streamed sectors may impose additional constraints.',
    'Schema derived from CUSA00697 eboot SHA-256 ' +
      EXECUTABLE_SHA256 +
      '; matching version/platform/type sizes alone do not prove another game build is compatible.',
    ...(igz.unresolvedFixupEntries.length
      ? [
          `${igz.unresolvedFixupEntries.length} relocation locations remain unresolved and are preserved unchanged.`,
        ]
      : []),
  ];
}

/** Instantiate previously verified model-local meshes only for editable root
 * actors. Keep this separate from parsing so the transform/selection contract
 * can be tested without embedding game assets in the test suite.
 */
export function instantiateActorMeshes(
  actorGeometry,
  objects,
  { includeGeometry = false, maxVertices = 2_000_000, maxIndices = 12_000_000 } = {},
) {
  check(
    Number.isSafeInteger(maxVertices) &&
      maxVertices > 0 &&
      Number.isSafeInteger(maxIndices) &&
      maxIndices > 0,
    'Invalid actor instance resource limits',
  );
  const objectMap = new Map(objects.map((o) => [o.id, o]));
  const meshMap = new Map(actorGeometry.meshes.map((m) => [m.id, m]));
  const meshes = [],
    representedActorIds = new Set(),
    proxies = [];
  let vertices = 0,
    indices = 0;
  for (const actor of actorGeometry.actors) {
    if (!actor.worldMatrix) continue;
    try {
      const object = objectMap.get(actor.id),
        matrix = actor.worldMatrix;
      check(
        object?.type === 'tfbActorInfo' && object.editable && object.worldEditable,
        'Decoded actor is not an editable root placement',
      );
      const expectedMatrix = initialRootYawMatrix(actor.position, actor.rotationDegrees, actor.scale);
      check(
        expectedMatrix &&
          matrix.length === 16 &&
          matrix.every((value, index) => value === expectedMatrix[index]),
        'Only a proven default-scale root Y-rotation/translation matrix can be instantiated',
      );
      check(
        Array.isArray(object.rotationDegrees) &&
          object.rotationDegrees.length === 3 &&
          object.rotationDegrees.every((value, index) => value === actor.rotationDegrees[index]),
        'Actor rotation does not match its root placement',
      );
      check(
        finitePosition(object.position) &&
          finitePosition(object.worldPosition) &&
          object.position.every(
            (v, i) => v === matrix[12 + i] && v === object.worldPosition[i] && v === actor.position[i],
          ),
        'Actor matrix does not match its root placement',
      );
      const localMeshes = actor.meshIds.map((id) => meshMap.get(id));
      check(
        localMeshes.length > 0 && localMeshes.every((m) => m && m.modelId === actor.modelId),
        'Actor references missing or mismatched model geometry',
      );
      const nv = localMeshes.reduce((n, m) => n + m.vertexCount, 0),
        ni = localMeshes.reduce((n, m) => n + m.indices.length, 0);
      check(
        vertices + nv <= maxVertices && indices + ni <= maxIndices,
        'Actor instances exceed geometry resource limits',
      );
      const worldPoint = (p) =>
        [0, 1, 2].map((i) => matrix[i] * p[0] + matrix[4 + i] * p[1] + matrix[8 + i] * p[2] + matrix[12 + i]);
      for (const mesh of localMeshes) {
        const { positions, indices: localIndices, ...metadata } = mesh;
        const worldPositions = includeGeometry ? new Array(positions.length) : undefined;
        // Transform actual vertices for exact bounds. Transforming only the old
        // AABB min/max is incorrect when a matrix contains any rotation.
        const worldBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        for (let vertex = 0; vertex < positions.length; vertex += 3) {
          const point = worldPoint(positions.slice(vertex, vertex + 3));
          for (let axis = 0; axis < 3; axis++) {
            worldBounds.min[axis] = Math.min(worldBounds.min[axis], point[axis]);
            worldBounds.max[axis] = Math.max(worldBounds.max[axis], point[axis]);
            if (includeGeometry) worldPositions[vertex + axis] = point[axis];
          }
        }
        meshes.push({
          ...metadata,
          name: `${actor.name} / Drawable ${mesh.id}`,
          actorId: actor.id,
          actorBasePosition: [...object.position],
          selectionKey: `actor:${actor.id}:mesh:${mesh.id}`,
          editable: true,
          coordinateSpace: mesh.pose
            ? 'explicit t=0 entity hierarchy in initial root actor world coordinates; not live animation'
            : 'initial root actor world coordinates; native-verified model yaw/translation applied',
          localBounds: mesh.bounds,
          bounds: worldBounds,
          ...(includeGeometry ? { positions: worldPositions, indices: localIndices } : {}),
        });
      }
      vertices += nv;
      indices += ni;
      representedActorIds.add(actor.id);
    } catch (error) {
      proxies.push({ actorId: actor.id, reason: error.message });
    }
  }
  return {
    meshes,
    representedActorIds,
    proxies,
    counts: {
      renderedActors: representedActorIds.size,
      instantiatedMeshes: meshes.length,
      instantiatedVertices: vertices,
      instantiatedTriangles: indices / 3,
    },
  };
}

export function runRequest(request) {
  check(request && typeof request === 'object' && !Array.isArray(request), 'Expected a JSON object');
  if (typeof request.path === 'string' && /\.scene\.json$/i.test(request.path))
    return runAuthoredSceneRequest(request);
  if (request.operation === 'materials') {
    const offset = integer(request.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER);
    const limit = integer(request.limit ?? 50, 'limit', 1, 200);
    const scene = runRequest({
      ...request,
      operation: 'scene',
      includeGeometry: true,
      includeTextures: true,
    });
    const entries = scene.meshes.map(({ positions, indices, uvs, ...mesh }) => mesh);
    return {
      path: scene.path,
      sha256: scene.sha256,
      geometrySha256: scene.geometrySha256,
      textureCounts: scene.textureCounts,
      total: entries.length,
      offset,
      nextOffset: offset + limit < entries.length ? offset + limit : null,
      meshes: entries.slice(offset, offset + limit),
      textures: scene.textures.map(({ rgbaBase64, ...texture }) => texture),
      previewOnly: true,
      shaderMappingVerified: false,
      gameFilesWritten: false,
    };
  }
  check(
    ['inspect', 'objects', 'scene', 'build'].includes(request.operation),
    'operation must be inspect, objects, scene or build',
  );
  const source = path.resolve(string(request.path, 'path'));
  const stat = fs.statSync(source);
  check(stat.isFile(), 'Input must be a regular file');
  check(stat.size <= 1024 * 1024 * 1024, 'Input exceeds the 1 GiB backend safety limit');
  const igz = parseIgz(source);
  const digest = sha256(igz.buffer);
  if (request.expectedSha256 !== undefined)
    check(request.expectedSha256 === digest, 'Source SHA-256 does not match expectedSha256');
  if (request.operation === 'inspect') {
    const counts = new Map();
    let editableObjectCount = 0;
    for (const object of igz.objects) {
      counts.set(object.type, (counts.get(object.type) ?? 0) + 1);
      if (describeObject(igz, object).editable) editableObjectCount++;
    }
    return {
      path: source,
      sha256: digest,
      profile: PROFILE,
      version: igz.version,
      platform: igz.platform,
      objectCount: igz.objects.length,
      types: [...counts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      editableObjectCount,
      unresolvedFixupCount: igz.unresolvedFixupEntries.length,
      limitations: limitations(igz),
    };
  }
  if (request.operation === 'scene') {
    if (request.includeGeometry !== undefined)
      check(typeof request.includeGeometry === 'boolean', 'includeGeometry must be a boolean');
    if (request.includeTextures !== undefined)
      check(typeof request.includeTextures === 'boolean', 'includeTextures must be a boolean');
    if (request.texturePreviewSize !== undefined)
      integer(request.texturePreviewSize, 'texturePreviewSize', 32, 1024);
    if (request.uvChannel !== undefined) integer(request.uvChannel, 'uvChannel', 0, 7);
    if (request.previewMeshKey !== undefined)
      check(
        typeof request.previewMeshKey === 'string' &&
          /^(geometry:\d+|actor:\d+:mesh:\d+)$/.test(request.previewMeshKey),
        'Invalid previewMeshKey',
      );
    if (request.textureImageId !== undefined) {
      integer(request.textureImageId, 'textureImageId', 0, Number.MAX_SAFE_INTEGER);
      check(
        request.previewMeshKey !== undefined && request.includeTextures,
        'textureImageId requires previewMeshKey and includeTextures',
      );
    }
    check(
      !request.includeTextures || request.includeGeometry === true,
      'includeTextures requires includeGeometry:true',
    );
    const objects = [];
    let unresolvedParentCount = 0;
    for (const object of igz.objects) {
      const item = describeObject(igz, object);
      if (!item.editable) continue;
      // A null parent plus no relocation establishes a root serialized transform.
      // This is the stored initial layout, not a claim about later script motion.
      const root =
        item.parentObjectId === null &&
        igz.u64(object.offset + 0x80) === 0n &&
        !igz.pointerReferencesByOffset.has(object.offset + 0x80) &&
        !igz.specialRelocationsByOffset.has(object.offset + 0x80);
      if (!root) unresolvedParentCount++;
      objects.push({
        ...item,
        worldEditable: root,
        ...(root ? { worldPosition: item.position } : {}),
        representation: 'placement marker; actor model not decoded',
        transformEvidence: root
          ? 'verified initial transform with serialized null parent'
          : 'parent-relative transform; world composition not implemented',
      });
    }
    let geometryIgz = igz,
      geometryPath = source;
    if (request.geometryPath !== undefined) {
      geometryPath = path.resolve(string(request.geometryPath, 'geometryPath'));
      const gs = fs.statSync(geometryPath);
      check(
        gs.isFile() && gs.size <= 1024 * 1024 * 1024,
        'Geometry input must be a regular file of at most 1 GiB',
      );
      if (geometryPath !== source) geometryIgz = parseIgz(geometryPath);
    }
    const geometry = loadGeometry(geometryIgz);
    const actorGeometry = loadActorGeometry(igz);
    const includeGeometry = request.includeGeometry ?? false;
    let meshes = geometry.meshes.map((mesh) => {
      const { positions, indices, ...metadata } = mesh;
      return {
        ...metadata,
        selectionKey: `geometry:${mesh.id}`,
        editable: false,
        ...(includeGeometry ? { positions, indices } : {}),
      };
    });
    const actorInstances = instantiateActorMeshes(actorGeometry, objects, { includeGeometry });
    meshes.push(...actorInstances.meshes);
    if (request.previewMeshKey !== undefined) {
      meshes = meshes.filter((m) => m.selectionKey === request.previewMeshKey);
      check(meshes.length === 1, 'previewMeshKey must identify one decoded scene mesh');
    }
    const textureMap = new Map(),
      textureBudget = { bytes: 0 },
      textureWarnings = [];
    const texturePreviewSize = request.texturePreviewSize ?? 256;
    let budgetAdjustedTextureSize = texturePreviewSize;
    if (request.includeTextures) {
      const options = {
        maxDimension: texturePreviewSize,
        maxTotalBytes: 8 * 1024 * 1024,
        textures: textureMap,
        budget: textureBudget,
        uvChannel: request.uvChannel ?? 0,
        imageOverride: request.textureImageId,
        fallbackMaxDimension: texturePreviewSize,
      };
      const staticIds = new Set(meshes.filter((m) => m.actorId === undefined).map((m) => m.id));
      const actorIds = new Set(meshes.filter((m) => m.actorId !== undefined).map((m) => m.id));
      let staticTextures, actorTextures;
      // Fair scene-wide mip reduction prevents archive iteration order from
      // consuming the entire budget before later actors (doors/hatches) load.
      // Only existing stored mips are used, never synthesized replacement data.
      for (;;) {
        textureMap.clear();
        textureBudget.bytes = 0;
        options.maxDimension = budgetAdjustedTextureSize;
        staticTextures = loadMeshTextures(
          geometryIgz,
          geometry.meshes.filter((m) => staticIds.has(m.id)),
          options,
        );
        actorTextures = loadMeshTextures(
          igz,
          actorGeometry.meshes.filter((m) => actorIds.has(m.id)),
          options,
        );
        const exhausted = [...staticTextures.warnings, ...actorTextures.warnings].some((w) =>
          w.includes('total memory budget exhausted'),
        );
        if (!exhausted || budgetAdjustedTextureSize <= 32) break;
        budgetAdjustedTextureSize = Math.max(32, Math.floor(budgetAdjustedTextureSize / 2));
      }
      for (const mesh of meshes)
        Object.assign(
          mesh,
          (mesh.actorId === undefined ? staticTextures : actorTextures).meshTextures.get(mesh.id) ?? {},
        );
      textureWarnings.push(
        ...staticTextures.warnings.map((w) => `Static texture: ${w}`),
        ...actorTextures.warnings.map((w) => `Actor texture: ${w}`),
      );
      if (budgetAdjustedTextureSize !== texturePreviewSize)
        textureWarnings.push(
          `Stored preview mip target reduced scene-wide from ${texturePreviewSize} to ${budgetAdjustedTextureSize} to fit 8 MiB; larger minimum stored mips may remain within the original size cap. Isolate a mesh for high-resolution diagnosis.`,
        );
    }
    const actorGeometryProxies = [...actorGeometry.proxies, ...actorInstances.proxies];
    const proxyReasons = new Map(actorGeometryProxies.map((p) => [p.actorId, p.reason]));
    const actorInfo = new Map(actorGeometry.actors.map((a) => [a.id, a]));
    for (const object of objects) {
      if (actorInstances.representedActorIds.has(object.id)) {
        const actor = actorInfo.get(object.id);
        object.representation = actor.pose
          ? 'decoded actor model (time-zero hierarchy preview)'
          : 'decoded simple actor model';
        if (actor.pose) object.pose = actor.pose;
        object.modelId = actor.modelId;
        object.meshSelectionKeys = actor.meshIds.map((id) => `actor:${actor.id}:mesh:${id}`);
        object.transformEvidence = actor.transformStatus;
      } else {
        object.representation = 'placement marker (proxy)';
        object.proxyReason =
          proxyReasons.get(object.id) ?? 'No supported actor model for this placement class';
      }
    }
    return {
      path: source,
      sha256: digest,
      profile: PROFILE,
      coordinateSystem: 'Y-up; stored initial/root and static-world coordinates, not runtime state',
      objects,
      objectCount: objects.length,
      worldObjectCount: objects.length - unresolvedParentCount,
      unresolvedParentCount,
      meshes,
      geometryPath,
      geometrySha256: sha256(geometryIgz.buffer),
      geometryCounts: geometry.counts,
      textures: [...textureMap.values()],
      texturesIncluded: request.includeTextures ?? false,
      textureCounts: {
        images: textureMap.size,
        rgbaBytes: textureBudget.bytes,
        maxPreviewDimension: texturePreviewSize,
        budgetAdjustedMaxDimension: budgetAdjustedTextureSize,
        minimumMipFallbackImages: [...textureMap.values()].filter((t) => t.minimumMipFallback).length,
        texturedMeshes: meshes.filter((m) => m.textureId).length,
        flatMeshes: meshes.filter((m) => !m.textureId).length,
      },
      actorGeometryCounts: { ...actorGeometry.counts, ...actorInstances.counts },
      actorGeometryProxies,
      bounds: geometry.bounds,
      contentBounds: geometry.contentBounds,
      geometryIncluded: includeGeometry,
      warnings: [
        ...limitations(igz),
        ...geometry.warnings,
        ...geometry.limitations,
        ...actorGeometry.warnings,
        ...actorGeometry.limitations,
        ...textureWarnings,
        ...(request.includeTextures ? TEXTURE_LIMITATIONS : []),
        ...actorInstances.proxies.map((p) => `Actor ${p.actorId}: ${p.reason}`),
        'Actor markers are proxies only where model geometry or transforms are unsupported. Static meshes are read-only; prop movement changes the actor position, not mesh data. Collision is not rendered.',
        ...(unresolvedParentCount
          ? [`${unresolvedParentCount} parent-relative placements omitted from world-space editing.`]
          : []),
      ],
    };
  }
  if (request.operation === 'objects') {
    const offset = integer(request.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER);
    const limit = integer(request.limit ?? 100, 'limit', 1, 500);
    if (request.type !== undefined) check(typeof request.type === 'string', 'type must be a string');
    if (request.query !== undefined) check(typeof request.query === 'string', 'query must be a string');
    const query = (request.query ?? '').toLowerCase();
    const matches = [];
    for (const object of igz.objects) {
      if (request.type && object.type !== request.type) continue;
      const item = describeObject(igz, object);
      if (query && !`${item.id} ${item.type} ${item.name}`.toLowerCase().includes(query)) continue;
      matches.push(item);
    }
    return {
      path: source,
      sha256: digest,
      total: matches.length,
      objects: matches.slice(offset, offset + limit),
      nextOffset: offset + limit < matches.length ? offset + limit : null,
    };
  }

  const output = path.resolve(string(request.output, 'output'));
  const manifestPath = output + '.manifest.json';
  check(output !== source && manifestPath !== source, 'Input and output paths must differ');
  check(
    Array.isArray(request.edits) && request.edits.length <= 10000,
    'edits must be an array of at most 10000 position edits',
  );
  check(
    !fs.existsSync(output) && !fs.existsSync(manifestPath),
    'Output or manifest already exists; choose new paths',
  );
  const edited = Buffer.from(igz.buffer),
    seen = new Set(),
    changes = [];
  for (const edit of request.edits) {
    check(edit && typeof edit === 'object' && !Array.isArray(edit), 'Each edit must be an object');
    check(
      Object.keys(edit).every((key) => ['objectId', 'position'].includes(key)),
      'Unsupported edit field; only objectId and position are accepted',
    );
    const id = integer(edit.objectId, 'objectId', 0, igz.objects.length - 1);
    check(!seen.has(id), `Duplicate edit for object ${id}`);
    seen.add(id);
    check(
      finitePosition(edit.position),
      `Object ${id}: position must be three finite numbers in [-1000000,1000000]`,
    );
    const object = igz.objects[id],
      item = describeObject(igz, object);
    check(item.editable, `Object ${id} (${object.type}) is not a verified editable placement`);
    const offset = object.offset + 0x40;
    for (let i = 0; i < 3; i++) edited.writeFloatLE(edit.position[i], offset + i * 4);
    const after = vec3(edited, offset);
    if (!edited.subarray(offset, offset + 12).equals(igz.buffer.subarray(offset, offset + 12))) {
      changes.push({
        objectId: id,
        type: object.type,
        name: item.name,
        field: '_initMatrix.position',
        offset,
        length: 12,
        before: item.position,
        after,
        requested: edit.position,
      });
    }
  }
  // Independently re-parse the emitted byte image and constrain every differing
  // byte to the requested scalar fields. Fixups and all unrelated data stay exact.
  const verified = parseIgz(edited);
  check(verified.objects.length === igz.objects.length, 'Internal error: object count changed');
  const spans = [...changes].sort((a, b) => a.offset - b.offset);
  let cursor = 0,
    changedByteCount = 0;
  for (const span of spans) {
    check(
      edited.subarray(cursor, span.offset).equals(igz.buffer.subarray(cursor, span.offset)),
      'Internal error: unrelated bytes changed',
    );
    for (let at = span.offset; at < span.offset + span.length; at++)
      if (edited[at] !== igz.buffer[at]) changedByteCount++;
    cursor = span.offset + span.length;
  }
  check(
    edited.subarray(cursor).equals(igz.buffer.subarray(cursor)),
    'Internal error: unrelated trailing bytes changed',
  );
  const afterStat = fs.statSync(source);
  check(
    stat.size === afterStat.size &&
      stat.mtimeMs === afterStat.mtimeMs &&
      stat.ctimeMs === afterStat.ctimeMs &&
      stat.ino === afterStat.ino,
    'Source changed during build',
  );
  const manifest = {
    format: 'skylanders-position-edit-manifest',
    version: 1,
    profile: PROFILE,
    source: { path: source, size: igz.size, sha256: digest },
    output: { path: output, size: edited.length, sha256: sha256(edited) },
    changes,
    changedObjects: changes.length,
    changedByteCount,
    evidenceIds: EVIDENCE,
    verification: { reparsed: true, unchangedOutsideFields: true, gameRuntimeTested: false },
    limitations: limitations(igz),
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  let wroteOutput = false,
    wroteManifest = false;
  try {
    // Exclusive creation protects against symlinks and concurrent writers too.
    const outputFd = fs.openSync(output, 'wx');
    wroteOutput = true;
    try {
      fs.writeFileSync(outputFd, edited);
      fs.fsyncSync(outputFd);
    } finally {
      fs.closeSync(outputFd);
    }
    const manifestFd = fs.openSync(manifestPath, 'wx');
    wroteManifest = true;
    try {
      fs.writeFileSync(manifestFd, JSON.stringify(manifest, null, 2) + '\n');
      fs.fsyncSync(manifestFd);
    } finally {
      fs.closeSync(manifestFd);
    }
  } catch (error) {
    if (wroteManifest) fs.unlinkSync(manifestPath);
    if (wroteOutput) fs.unlinkSync(output);
    throw error;
  }
  return {
    output,
    manifest: manifestPath,
    changedObjects: changes.length,
    changedByteCount,
    sha256: manifest.output.sha256,
    runtimeTested: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--help')) {
      console.log(
        'Usage: node tools/level_builder.mjs < request.json\nRequests: {operation:"inspect"|"objects"|"scene"|"build",path,...}. See docs/LEVEL_FORMAT.md and editor/README.md.',
      );
    } else {
      const parts = [],
        chunk = Buffer.alloc(65536);
      let total = 0,
        count;
      while ((count = fs.readSync(0, chunk, 0, chunk.length, null)) > 0) {
        total += count;
        check(total <= 4 * 1024 * 1024, 'Request exceeds 4 MiB');
        parts.push(Buffer.from(chunk.subarray(0, count)));
      }
      const input = Buffer.concat(parts).toString('utf8');
      console.log(JSON.stringify(runRequest(JSON.parse(input))));
    }
  } catch (error) {
    console.log(JSON.stringify({ error: { message: error.message } }));
    process.exitCode = 1;
  }
}
