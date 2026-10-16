// Editor-only JSON scene backend. Never parses/writes IGZ or installs a level.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateTransform, createRebase } from './object_transform.mjs';

export const AUTHORED_SCENE_SCHEMA = 'skylanders-authored-scene-v1';
export const AUTHORED_SCENE_PROFILE = 'authored-preview-v1';
const MAX_FILE = 128 * 1024 * 1024,
  MAX_VERTICES = 2000000,
  MAX_INDICES = 12000000;
const MAX_TEXTURE_BYTES = 32 * 1024 * 1024;
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const own = (value, key) => Object.hasOwn(value, key);
const flags = {
  profile: AUTHORED_SCENE_PROFILE,
  previewOnly: true,
  authoredPreview: true,
  runtimeTested: false,
  playable: false,
  igz: false,
  gameFilesWritten: false,
};
const limitations = [
  'Authored editor preview document, not an IGZ resource or playable game chapter.',
  'Build changes explicit root transforms and world-baked positions/normals; no game files are written by this JSON backend.',
  'Geometry, lighting and material provenance are author-supplied, not evidence of runtime compatibility.',
  'No collision, scripts, navigation, chapter registration, resource linking or gameplay validation is created.',
];
function integer(value, minimum, maximum, label) {
  check(Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'Invalid ' + label);
  return value;
}
function text(value, label, maximum = 1024) {
  check(
    typeof value === 'string' &&
      value.length > 0 &&
      value.length <= maximum &&
      !/[\u0000-\u001f]/.test(value),
    'Invalid ' + label,
  );
  return value;
}
function vec3(value, label, maximum = 1000000) {
  check(
    Array.isArray(value) &&
      value.length === 3 &&
      value.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= maximum),
    'Invalid ' + label,
  );
  return value;
}
function equal3(a, b) {
  return a.every((n, i) => n === b[i]);
}
function bounds(value, label) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'Invalid ' + label);
  vec3(value.min, label + '.min');
  vec3(value.max, label + '.max');
  check(
    value.min.every((n, i) => n <= value.max[i]),
    'Inverted ' + label,
  );
}
function meshBounds(positions) {
  const result = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    result.min[axis] = Math.min(result.min[axis], positions[i]);
    result.max[axis] = Math.max(result.max[axis], positions[i]);
  }
  return result;
}
function aggregate(meshes, excludeSky = false) {
  const result = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let any = false;
  for (const mesh of meshes) {
    if (excludeSky && mesh.sky) continue;
    any = true;
    const b = meshBounds(mesh.positions);
    for (let axis = 0; axis < 3; axis++) {
      result.min[axis] = Math.min(result.min[axis], b.min[axis]);
      result.max[axis] = Math.max(result.max[axis], b.max[axis]);
    }
  }
  return any ? result : null;
}
function validateData(root) {
  const ancestors = new Set();
  let nodes = 0;
  function visit(value, depth) {
    check(++nodes <= 24000000 && depth <= 32, 'Authored document exceeds node/depth budget');
    if (typeof value === 'number')
      check(
        Number.isFinite(value) && Math.abs(value) <= 1e12,
        'All authored numeric data must be finite and bounded',
      );
    else if (typeof value === 'string')
      check(value.length <= 48 * 1024 * 1024, 'Authored string exceeds budget');
    else if (value !== null && typeof value === 'object') {
      check(
        !ancestors.has(value) &&
          (Array.isArray(value) ||
            Object.getPrototypeOf(value) === Object.prototype ||
            Object.getPrototypeOf(value) === null),
        'Authored data must be acyclic JSON',
      );
      ancestors.add(value);
      if (Array.isArray(value))
        for (let i = 0; i < value.length; i++) {
          check(own(value, i), 'Authored arrays must be dense JSON arrays');
          visit(value[i], depth + 1);
        }
      else
        for (const key of Object.keys(value)) {
          check(key.length <= 1024, 'Authored key exceeds budget');
          visit(value[key], depth + 1);
        }
      ancestors.delete(value);
    } else check(value === null || typeof value === 'boolean', 'Authored data must contain only JSON values');
  }
  visit(root, 0);
}

/** Strict render/selection contract; unknown JSON metadata stays read-only. */
export function validateAuthoredScene(document) {
  validateData(document);
  check(document && document.schema === AUTHORED_SCENE_SCHEMA, 'Unsupported authored scene schema');
  check(
    Array.isArray(document.objects) &&
      document.objects.length <= 10000 &&
      Array.isArray(document.meshes) &&
      document.meshes.length <= 20000,
    'Invalid authored object/mesh inventory',
  );
  const objects = new Map(),
    selections = new Set(),
    textureMap = new Map();
  for (const object of document.objects) {
    integer(object.id, 0, Number.MAX_SAFE_INTEGER, 'actor id');
    check(!objects.has(object.id), 'Duplicate actor id');
    objects.set(object.id, object);
    text(object.name, 'actor name');
    text(object.type, 'actor type');
    vec3(object.position, 'actor position');
    vec3(object.worldPosition, 'actor worldPosition');
    check(
      equal3(object.position, object.worldPosition) &&
        (object.parentObjectId === undefined || object.parentObjectId === null),
      'Authored actors require explicit root/world positions',
    );
    check(
      typeof object.editable === 'boolean' &&
        typeof object.worldEditable === 'boolean' &&
        object.editable === object.worldEditable,
      'Actor editability must describe the same explicit root',
    );
    if (object.bounds !== undefined) bounds(object.bounds, 'actor bounds');
    validateTransform(object);
    if (object.collision !== undefined) {
      const c = object.collision;
      check(c?.shape === 'box', 'Only box collision supported');
      vec3(c.dimensions, 'collision dimensions', 10000);
      vec3(c.offset, 'collision offset', 10000);
      check(
        c.dimensions.every((v) => v >= 0.01),
        'Collision dimensions must be positive',
      );
    }
  }
  const textures = document.textures ?? [];
  check(Array.isArray(textures) && textures.length <= 256, 'Invalid authored texture inventory');
  let textureBytes = 0;
  for (const texture of textures) {
    check(
      /^[a-f0-9]{64}$/.test(texture.id ?? '') && !textureMap.has(texture.id),
      'Invalid or duplicate texture id',
    );
    integer(texture.width, 1, 1024, 'texture width');
    integer(texture.height, 1, 1024, 'texture height');
    const size = texture.width * texture.height * 4;
    textureBytes += size;
    check(textureBytes <= MAX_TEXTURE_BYTES, 'Authored textures exceed 32 MiB');
    check(
      typeof texture.rgbaBase64 === 'string' &&
        texture.rgbaBase64.length === Math.ceil(size / 3) * 4 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(texture.rgbaBase64),
      'Invalid texture base64 extent',
    );
    const rgba = Buffer.from(texture.rgbaBase64, 'base64');
    check(
      rgba.length === size &&
        rgba.toString('base64') === texture.rgbaBase64 &&
        sha(rgba) === texture.rgbaSha256,
      'Texture bytes/hash mismatch',
    );
    textureMap.set(texture.id, texture);
  }
  let vertices = 0,
    indices = 0;
  for (const mesh of document.meshes) {
    integer(mesh.id, 0, Number.MAX_SAFE_INTEGER, 'mesh id');
    text(mesh.name, 'mesh name');
    text(mesh.selectionKey, 'mesh selectionKey');
    check(!selections.has(mesh.selectionKey), 'Duplicate mesh selectionKey');
    selections.add(mesh.selectionKey);
    check(
      Array.isArray(mesh.positions) && mesh.positions.length >= 3 && mesh.positions.length % 3 === 0,
      'Invalid mesh positions',
    );
    const count = mesh.positions.length / 3;
    vertices += count;
    check(vertices <= MAX_VERTICES, 'Authored vertex budget exceeded');
    check(
      mesh.positions.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1000000),
      'Invalid bounded mesh position',
    );
    check(
      Array.isArray(mesh.indices) && mesh.indices.length >= 3 && mesh.indices.length % 3 === 0,
      'Invalid triangle indices',
    );
    indices += mesh.indices.length;
    check(indices <= MAX_INDICES, 'Authored index budget exceeded');
    check(
      mesh.indices.every((n) => Number.isSafeInteger(n) && n >= 0 && n < count),
      'Mesh index outside vertices',
    );
    if (mesh.vertexCount !== undefined) check(mesh.vertexCount === count, 'vertexCount mismatch');
    if (mesh.triangleCount !== undefined)
      check(mesh.triangleCount === mesh.indices.length / 3, 'triangleCount mismatch');
    if (mesh.normals !== undefined) {
      check(
        Array.isArray(mesh.normals) &&
          mesh.normals.length === mesh.positions.length &&
          mesh.normals.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1.0001),
        'Invalid bounded vertex normals',
      );
      for (let i = 0; i < mesh.normals.length; i += 3) {
        const length = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
        check(length > 1e-8 && length <= 1.0002, 'Invalid normal vector length');
      }
    }
    if (mesh.uvs !== undefined)
      check(
        Array.isArray(mesh.uvs) &&
          mesh.uvs.length === count * 2 &&
          mesh.uvs.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 65504),
        'Invalid bounded mesh UVs',
      );
    if (mesh.bounds !== undefined) bounds(mesh.bounds, 'mesh bounds');
    if (mesh.localBounds !== undefined) bounds(mesh.localBounds, 'mesh localBounds');
    if (mesh.sky !== undefined) check(typeof mesh.sky === 'boolean', 'Invalid mesh sky flag');
    if (mesh.editable !== undefined) check(typeof mesh.editable === 'boolean', 'Invalid mesh editable flag');
    if (own(mesh, 'actorId')) {
      integer(mesh.actorId, 0, Number.MAX_SAFE_INTEGER, 'mesh actorId');
      const actor = objects.get(mesh.actorId);
      check(actor, 'Mesh refers to missing actor');
      vec3(mesh.actorBasePosition, 'mesh actorBasePosition');
      check(equal3(mesh.actorBasePosition, actor.position), 'Mesh actorBasePosition differs from actor root');
      if (mesh.editable !== undefined)
        check(mesh.editable === actor.editable, 'Mesh/actor editability mismatch');
    } else
      check(
        mesh.actorBasePosition === undefined && mesh.editable !== true,
        'Static mesh cannot be editable or have an actor base',
      );
    if (mesh.textureId !== undefined) {
      check(
        textureMap.has(mesh.textureId) && mesh.uvs !== undefined,
        'Textured mesh requires an embedded texture and UVs',
      );
      check(
        ['clamp', 'repeat'].includes(mesh.textureWrapS) && ['clamp', 'repeat'].includes(mesh.textureWrapT),
        'Invalid texture wrapping',
      );
      if (mesh.textureFilter !== undefined)
        check(['linear', 'nearest'].includes(mesh.textureFilter), 'Invalid texture filter');
    }
  }
  for (const object of document.objects)
    if (object.meshSelectionKeys !== undefined) {
      const keys = document.meshes.filter((m) => m.actorId === object.id).map((m) => m.selectionKey);
      check(
        Array.isArray(object.meshSelectionKeys) &&
          object.meshSelectionKeys.length === keys.length &&
          new Set(object.meshSelectionKeys).size === keys.length &&
          keys.every((k) => object.meshSelectionKeys.includes(k)),
        'Actor meshSelectionKeys mismatch',
      );
    }
  if (document.bounds !== undefined && document.bounds !== null) bounds(document.bounds, 'scene bounds');
  if (document.contentBounds !== undefined && document.contentBounds !== null)
    bounds(document.contentBounds, 'scene contentBounds');
  return {
    document,
    objects,
    textureBytes,
    vertices,
    triangles: indices / 3,
    bounds: aggregate(document.meshes),
    contentBounds: aggregate(document.meshes, true),
  };
}
export function parseAuthoredScene(bytes) {
  check(Buffer.isBuffer(bytes) && bytes.length <= MAX_FILE, 'Authored document must be a Buffer <=128 MiB');
  return validateAuthoredScene(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
function stripGeometry(mesh, included) {
  const result = {
    ...mesh,
    vertexCount: mesh.positions.length / 3,
    triangleCount: mesh.indices.length / 3,
    bounds: meshBounds(mesh.positions),
  };
  if (!included) for (const key of ['positions', 'indices', 'normals', 'uvs']) delete result[key];
  return result;
}
function unrelated(document, changedIds) {
  const value = structuredClone(document);
  delete value.bounds;
  delete value.contentBounds;
  for (const object of value.objects)
    if (changedIds.has(object.id))
      for (const key of ['position', 'worldPosition', 'bounds', 'rotationDegrees', 'scale'])
        delete object[key];
  for (const mesh of value.meshes)
    if (changedIds.has(mesh.actorId))
      for (const key of ['positions', 'normals', 'actorBasePosition', 'bounds']) delete mesh[key];
  return JSON.stringify(value);
}
export function buildAuthoredScene(bytes, { expectedSha256, edits }) {
  check(Buffer.isBuffer(bytes) && bytes.length <= MAX_FILE, 'Authored document must be a Buffer <=128 MiB');
  check(
    typeof expectedSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(expectedSha256) &&
      sha(bytes) === expectedSha256,
    'Authored build requires matching expectedSha256',
  );
  const original = parseAuthoredScene(bytes),
    document = structuredClone(original.document),
    byId = new Map(document.objects.map((o) => [o.id, o]));
  check(Array.isArray(edits) && edits.length <= 10000, 'Expected at most 10000 explicit position edits');
  const seen = new Set(),
    changes = [];
  for (const edit of edits) {
    check(
      edit &&
        typeof edit === 'object' &&
        !Array.isArray(edit) &&
        Object.keys(edit).every((k) => ['objectId', 'position', 'rotationDegrees', 'scale'].includes(k)),
      'Unsupported transform field',
    );
    integer(edit.objectId, 0, Number.MAX_SAFE_INTEGER, 'objectId');
    check(!seen.has(edit.objectId), 'Duplicate actor edit');
    seen.add(edit.objectId);
    vec3(edit.position, 'edited position');
    const object = byId.get(edit.objectId);
    check(object?.editable && object.worldEditable, 'Object is not an editable authored root');
    const oldTransform = validateTransform(object),
      newTransform = validateTransform({ ...oldTransform, ...edit });
    if (
      equal3(object.position, edit.position) &&
      equal3(oldTransform.rotationDegrees, newTransform.rotationDegrees) &&
      equal3(oldTransform.scale, newTransform.scale)
    )
      continue;
    const before = [...object.position],
      delta = edit.position.map((n, i) => n - before[i]),
      movedMeshes = [];
    const from = { position: before, ...oldTransform },
      to = { position: edit.position, ...newTransform };
    const rebase = createRebase(from, to);
    object.position = [...edit.position];
    object.worldPosition = [...edit.position];
    if (edit.rotationDegrees) object.rotationDegrees = [...newTransform.rotationDegrees];
    if (edit.scale) object.scale = [...newTransform.scale];
    const translationOnly =
      equal3(oldTransform.rotationDegrees, newTransform.rotationDegrees) &&
      equal3(oldTransform.scale, newTransform.scale);
    for (const mesh of document.meshes)
      if (mesh.actorId === object.id) {
        if (translationOnly) mesh.positions = mesh.positions.map((n, i) => n + delta[i % 3]);
        else {
          for (let i = 0; i < mesh.positions.length; i += 3) {
            const p = rebase.point(mesh.positions.slice(i, i + 3));
            for (let a = 0; a < 3; a++) mesh.positions[i + a] = p[a];
          }
          if (mesh.normals)
            for (let i = 0; i < mesh.normals.length; i += 3) {
              const n = rebase.normal(mesh.normals.slice(i, i + 3));
              for (let a = 0; a < 3; a++) mesh.normals[i + a] = n[a];
            }
        }
        mesh.actorBasePosition = [...edit.position];
        mesh.bounds = meshBounds(mesh.positions);
        movedMeshes.push(mesh.selectionKey);
      }
    if (object.bounds) object.bounds = aggregate(document.meshes.filter((m) => m.actorId === object.id));
    changes.push({
      objectId: object.id,
      name: object.name,
      before,
      after: [...edit.position],
      delta,
      beforeTransform: oldTransform,
      afterTransform: newTransform,
      translatedMeshes: movedMeshes,
    });
  }
  if (changes.length) {
    document.bounds = aggregate(document.meshes);
    document.contentBounds = aggregate(document.meshes, true);
  }
  const changedIds = new Set(changes.map((c) => c.objectId));
  validateAuthoredScene(document);
  check(
    unrelated(original.document, changedIds) === unrelated(document, changedIds),
    'Unrelated authored document data changed',
  );
  const buffer = changes.length ? Buffer.from(JSON.stringify(document) + '\n') : Buffer.from(bytes);
  check(buffer.length <= MAX_FILE, 'Rebuilt authored document exceeds 128 MiB');
  parseAuthoredScene(buffer);
  return {
    buffer,
    manifest: {
      format: 'skylanders-authored-scene-edit-manifest-v1',
      ...flags,
      source: { size: bytes.length, sha256: expectedSha256 },
      output: { size: buffer.length, sha256: sha(buffer) },
      changes,
      changedObjects: changes.length,
      verification: {
        reparsed: true,
        unrelatedJsonDataPreserved: true,
        provenancePreserved: true,
        staticMeshesPreserved: true,
        uvsMaterialsPreserved: true,
        normalsRebasedByInverseTranspose: true,
        gameRuntimeTested: false,
        semanticJsonPreservationNotByteOffsets: true,
      },
      limitations,
    },
  };
}

function same(a, b) {
  return ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every((k) => a[k] === b[k]);
}
function owned(filename, stat) {
  try {
    const s = fs.lstatSync(filename);
    return s.dev === stat.dev && s.ino === stat.ino;
  } catch {
    return false;
  }
}
function readStart(fd, size) {
  const bytes = Buffer.alloc(size);
  let at = 0;
  while (at < size) {
    const n = fs.readSync(fd, bytes, at, Math.min(1048576, size - at), at);
    check(n > 0, 'Input ended early');
    at += n;
  }
  return bytes;
}
export function runAuthoredSceneRequest(request) {
  check(
    ['inspect', 'objects', 'scene', 'materials', 'build'].includes(request.operation),
    'Unsupported authored operation',
  );
  const source = path.resolve(text(request.path, 'path', 8192));
  check(/\.scene\.json$/i.test(source), 'Authored sources require .scene.json extension');
  const fd = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK),
    written = [];
  let complete = false;
  try {
    const stat = fs.fstatSync(fd);
    check(stat.isFile() && stat.size <= MAX_FILE, 'Expected bounded regular authored source');
    const bytes = readStart(fd, stat.size),
      digest = sha(bytes);
    if (request.expectedSha256 !== undefined)
      check(request.expectedSha256 === digest, 'Source SHA-256 does not match expectedSha256');
    const loaded = parseAuthoredScene(bytes),
      document = loaded.document;
    // Recipe metadata for old, immutable Gallardo documents. Never write it
    // back during inspection or alter the source hash/build reproducibility.
    const objectsForEditor = document.objects.map((o) =>
      o.id === 1 &&
      !o.collision &&
      document.provenance?.shapeSha256 === '18a67907117904a604280021e193ec41544830e5d2f032bb1bb17d9a1b9bb204'
        ? { ...o, collision: { shape: 'box', dimensions: [2, 1.15, 4.4], offset: [0, 0, 0] } }
        : o,
    );
    const unchanged = () =>
      check(
        same(stat, fs.fstatSync(fd)) &&
          same(stat, fs.lstatSync(source)) &&
          sha(readStart(fd, stat.size)) === digest,
        'Authored source changed during request',
      );
    unchanged();
    const base = { path: source, sha256: digest, ...flags };
    if (request.operation === 'inspect') {
      const counts = new Map();
      for (const o of document.objects) counts.set(o.type, (counts.get(o.type) ?? 0) + 1);
      return {
        ...base,
        schema: AUTHORED_SCENE_SCHEMA,
        version: 1,
        platform: null,
        objectCount: document.objects.length,
        editableObjectCount: document.objects.filter((o) => o.editable).length,
        types: [...counts].map(([name, count]) => ({ name, count })),
        limitations,
      };
    }
    if (request.operation === 'objects') {
      const offset = integer(request.offset ?? 0, 0, Number.MAX_SAFE_INTEGER, 'offset'),
        limit = integer(request.limit ?? 100, 1, 500, 'limit');
      if (request.type !== undefined) check(typeof request.type === 'string', 'type must be a string');
      if (request.query !== undefined) check(typeof request.query === 'string', 'query must be a string');
      const query = (request.query ?? '').toLowerCase(),
        objects = objectsForEditor.filter(
          (o) =>
            (!request.type || o.type === request.type) &&
            `${o.id} ${o.name} ${o.type}`.toLowerCase().includes(query),
        );
      return {
        ...base,
        total: objects.length,
        objects: objects.slice(offset, offset + limit),
        nextOffset: offset + limit < objects.length ? offset + limit : null,
      };
    }
    if (request.operation === 'scene' || request.operation === 'materials') {
      for (const key of ['includeGeometry', 'includeTextures'])
        if (request[key] !== undefined) check(typeof request[key] === 'boolean', key + ' must be boolean');
      const includeGeometry = request.operation === 'materials' || (request.includeGeometry ?? false),
        includeTextures = request.operation === 'materials' || (request.includeTextures ?? false);
      check(!includeTextures || includeGeometry, 'includeTextures requires includeGeometry:true');
      if (request.geometryPath !== undefined)
        check(
          path.resolve(text(request.geometryPath, 'geometryPath', 8192)) === source,
          'Authored scenes do not support a separate geometryPath',
        );
      if (request.uvChannel !== undefined)
        check(request.uvChannel === 0, 'Authored scenes expose only their explicit UV channel 0');
      check(request.textureImageId === undefined, 'Authored scenes do not support native image-ID overrides');
      if (request.texturePreviewSize !== undefined)
        integer(request.texturePreviewSize, 32, 1024, 'texturePreviewSize');
      let selected = document.meshes;
      if (request.previewMeshKey !== undefined) {
        text(request.previewMeshKey, 'previewMeshKey');
        selected = selected.filter((m) => m.selectionKey === request.previewMeshKey);
        check(selected.length === 1, 'previewMeshKey must identify one authored mesh');
      }
      const textures = includeTextures ? (document.textures ?? []) : [],
        meshes = selected.map((m) => stripGeometry(m, includeGeometry));
      const textureCounts = {
        images: textures.length,
        rgbaBytes: includeTextures ? loaded.textureBytes : 0,
        texturedMeshes: includeTextures ? meshes.filter((m) => m.textureId !== undefined).length : 0,
        flatMeshes: meshes.filter((m) => !includeTextures || m.textureId === undefined).length,
        embeddedTexturesNotRemipped: true,
      };
      if (request.operation === 'materials') {
        const offset = integer(request.offset ?? 0, 0, Number.MAX_SAFE_INTEGER, 'offset'),
          limit = integer(request.limit ?? 50, 1, 200, 'limit');
        return {
          ...base,
          geometrySha256: digest,
          total: meshes.length,
          offset,
          nextOffset: offset + limit < meshes.length ? offset + limit : null,
          meshes: selected.slice(offset, offset + limit).map((m) => stripGeometry(m, false)),
          textures: textures.map(({ rgbaBase64, ...metadata }) => metadata),
          textureCounts,
          shaderMappingVerified: false,
        };
      }
      const modeled = new Set(document.meshes.filter((m) => m.actorId !== undefined).map((m) => m.actorId));
      return {
        ...document,
        ...base,
        objects: objectsForEditor,
        objectCount: document.objects.length,
        worldObjectCount: document.objects.length,
        unresolvedParentCount: 0,
        coordinateSystem:
          'Y-up; explicit authored world-baked vertices and root positions, not game runtime state',
        geometryPath: source,
        geometrySha256: digest,
        meshes,
        textures,
        geometryIncluded: includeGeometry,
        texturesIncluded: includeTextures,
        textureCounts,
        geometryCounts: {
          worlds: 1,
          drawables: document.meshes.length,
          meshes: document.meshes.length,
          vertices: loaded.vertices,
          triangles: loaded.triangles,
        },
        actorGeometryCounts: {
          renderedActors: modeled.size,
          instantiatedMeshes: document.meshes.filter((m) => m.actorId !== undefined).length,
        },
        bounds: loaded.bounds,
        contentBounds: loaded.contentBounds,
        warnings: [
          ...(Array.isArray(document.warnings) ? document.warnings : []),
          ...(Array.isArray(document.limitations) ? document.limitations : []),
          ...limitations,
        ],
      };
    }
    const output = path.resolve(text(request.output, 'output', 8192)),
      manifestPath = output + '.manifest.json';
    check(
      /\.scene\.json$/i.test(output),
      'Authored build output must end in .scene.json; IGZ output is unsupported',
    );
    check(output !== source && manifestPath !== source, 'Source and output must differ');
    const result = buildAuthoredScene(bytes, {
      expectedSha256: request.expectedSha256,
      edits: request.edits,
    });
    unchanged();
    result.manifest.source.path = source;
    result.manifest.output.path = output;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    for (const [filename, data] of [
      [output, result.buffer],
      [manifestPath, Buffer.from(JSON.stringify(result.manifest, null, 2) + '\n')],
    ]) {
      const outFd = fs.openSync(filename, 'wx+', 0o600),
        identity = fs.fstatSync(outFd);
      written.push({ filename, identity });
      try {
        fs.writeFileSync(outFd, data);
        fs.fsyncSync(outFd);
        check(
          fs.fstatSync(outFd).size === data.length && readStart(outFd, data.length).equals(data),
          'Authored output readback mismatch',
        );
      } finally {
        fs.closeSync(outFd);
      }
      check(owned(filename, identity), 'Authored output identity changed');
    }
    unchanged();
    check(
      written.every((f) => owned(f.filename, f.identity)),
      'Authored output paths changed',
    );
    complete = true;
    return {
      output,
      manifest: manifestPath,
      changedObjects: result.manifest.changedObjects,
      sha256: result.manifest.output.sha256,
      ...flags,
    };
  } finally {
    fs.closeSync(fd);
    if (!complete)
      for (const file of written.reverse())
        if (owned(file.filename, file.identity)) fs.unlinkSync(file.filename);
  }
}
