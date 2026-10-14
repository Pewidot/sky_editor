#!/usr/bin/env node
// Experimental scalar edits to private, native-verified actor BOX collisions.
// Never serializes Havok objects, changes flags, or modifies the source file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseIgz } from './igz.mjs';

export const PROFILE = 'trap-team-ps4-private-box-collision-v1';
export const FEET_TO_WORLD = Math.fround(0.3048);
export const LIMITS = Object.freeze({
  minDimensionWorld: 0.1,
  maxDimensionWorld: 1000,
  maxOffsetWorld: 1000,
  maxYawDegrees: 360,
});
const EVIDENCE = [
  'ev_67886c33d7ae7e4031a12a83856a342d1be15cbbe656073e844138e447b7b3f8',
  'ev_32d7fcf50c20733ab721df586c13180abcb43faebc6b52490fe94d4dcc805607',
  'ev_8ebd053ee9b062fa91cf80c4df5c1d9cf04020932ca7c4290f10f0ce447d075f',
  'ev_edd62a352d475ada6d619701d0967bc7b1a8afb9651f487b996f4a9cd87a05fc',
  'ev_87aaf07255f683a53578f8cad7305b0bcab8094e93e3af6ea9e7f02be51a86ac',
];
const WARNINGS = [
  'Experimental scalar authoring only; this tool does not validate player grounding, gameplay or loading of its output.',
  'Only existing private BOX+solid+actor-surface+actor-physics collisions are writable. Flags, angles, actor positions and all Havok bytes remain unchanged.',
  'Scripts and actor parameters may change or disable collision at runtime. Structural eligibility does not establish that an actor is safe to repurpose.',
  'Dimensions are width/height/length in world meters, stored as feet. Collision-local offsets are already world units at the required default scale. Box origin is at its base, not its center.',
  'Schema is tied to CUSA00697 ELF SHA-256 423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3, not all IGZ v8 games.',
];
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
function check(ok, message) {
  if (!ok) throw new Error(message);
}
function object(value, label) {
  check(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
}
function keys(value, allowed, label) {
  check(
    Object.keys(value).every((k) => allowed.includes(k)),
    `${label} contains unsupported fields`,
  );
}
function filename(value, label) {
  check(
    typeof value === 'string' && value.length > 0 && !value.includes('\0'),
    `${label} must be a nonempty path`,
  );
  return path.resolve(value);
}
function integer(value, label, max) {
  check(Number.isSafeInteger(value) && value >= 0 && value <= max, `${label} must be a valid object index`);
  return value;
}
function vec3(buffer, at) {
  return [0, 1, 2].map((i) => buffer.readFloatLE(at + i * 4));
}
function finite3(v) {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}
function inBounds(v, lo, hi) {
  return finite3(v) && v.every((n) => n >= lo && n <= hi);
}

function indexReferences(igz) {
  const result = new Map();
  for (const ref of igz.pointerReferences) {
    const owner = igz.objectContaining(ref.targetOffset);
    if (!owner) continue;
    if (!result.has(owner.index)) result.set(owner.index, []);
    result.get(owner.index).push(ref);
  }
  const externalSlots = new Set(
    ['RNEX', 'REXT', 'RPID', 'RHND'].flatMap((magic) =>
      Array.from(igz.offsetTables.get(magic)?.offsets ?? []),
    ),
  );
  return { incoming: result, externalSlots };
}

function inspectActor(igz, actor, { incoming, externalSlots }) {
  const reasons = [],
    result = {
      actorId: actor.index,
      type: actor.type,
      actorOffset: actor.offset,
      name: igz.stringReferencesByOffset.get(actor.offset + 0x10)?.value ?? '',
    };
  const reject = (condition, reason) => {
    if (!condition) reasons.push(reason);
  };
  reject(
    actor.type === 'tfbActorInfo' && actor.size === 0x170,
    'Actor must be exact tfbActorInfo size 0x170',
  );
  if (reasons.length) return { ...result, editable: false, reasons };
  result.position = vec3(igz.buffer, actor.offset + 0x40);
  result.rotationDegrees = vec3(igz.buffer, actor.offset + 0x4c);
  result.scalePercent = vec3(igz.buffer, actor.offset + 0x114);
  result.placementFlags = igz.u32(actor.offset + 0x38);
  reject(
    (result.placementFlags & 1) === 0,
    'Placement flag bit 0 disables native solid/world-interaction mapping',
  );
  reject(inBounds(result.position, -1e6, 1e6), 'Actor initial position is invalid');
  reject(
    result.scalePercent.every((n) => n === 100),
    'Actor must have default [100,100,100] scale',
  );
  reject(
    finite3(result.rotationDegrees) &&
      result.rotationDegrees[0] === 0 &&
      result.rotationDegrees[2] === 0 &&
      Math.abs(result.rotationDegrees[1]) <= LIMITS.maxYawDegrees,
    'Actor must have only bounded Y rotation',
  );
  const nullField = (field) => {
    const slot = actor.offset + field;
    return (
      igz.u64(slot) === 0n &&
      !igz.pointerReferencesByOffset.has(slot) &&
      !igz.specialRelocationsByOffset.has(slot) &&
      !externalSlots.has(slot)
    );
  };
  reject(nullField(0x80), 'Actor must have a serialized null parent');
  reject(
    nullField(0xa0) && nullField(0xa8),
    'Actor attachment slots must be serialized null without external or initializer relocations',
  );
  reject(igz.unresolvedFixupEntries.length === 0, 'Unresolved fixups prevent private ownership verification');
  const slot = actor.offset + 0x120,
    ref = igz.pointerReferencesByOffset.get(slot);
  reject(
    !externalSlots.has(slot) && !igz.specialRelocationsByOffset.has(slot),
    'Collision pointer slot has ambiguous external or initializer relocation',
  );
  const collision = ref ? igz.objectsByOffset.get(ref.targetOffset) : null;
  reject(
    collision?.type === 'CollisionInfo' && collision?.size === 0x80,
    'Collision pointer must resolve to exact CollisionInfo size 0x80',
  );
  if (!collision || collision.type !== 'CollisionInfo' || collision.size !== 0x80)
    return { ...result, editable: false, reasons };
  result.collisionId = collision.index;
  result.collisionOffset = collision.offset;
  const users = incoming.get(collision.index) ?? [];
  result.incomingReferenceCount = users.length;
  reject(
    users.length === 1 && users[0].offset === slot && users[0].targetOffset === collision.offset,
    'CollisionInfo must be private to this actor, with exactly one incoming pointer and no interior references',
  );
  result.properties = igz.u32(collision.offset + 0x30);
  result.shapeType = result.properties & 7;
  reject(
    result.shapeType === 1 && (result.properties & 0x68) === 0x68,
    'Existing collision must already be BOX+solid+actor-surface+actor-physics',
  );
  result.offsetWorld = vec3(igz.buffer, collision.offset + 0x34);
  result.collisionRotationDegrees = vec3(igz.buffer, collision.offset + 0x40);
  result.dimensionsFeet = vec3(igz.buffer, collision.offset + 0x4c);
  result.dimensionsWorld = result.dimensionsFeet.map((n) => Math.fround(n * FEET_TO_WORLD));
  reject(
    inBounds(result.offsetWorld, -LIMITS.maxOffsetWorld, LIMITS.maxOffsetWorld),
    'Existing local collision offset is outside supported bounds',
  );
  reject(
    result.collisionRotationDegrees.every((n) => n === 0),
    'Collision-local rotation must be zero',
  );
  reject(
    inBounds(result.dimensionsWorld, LIMITS.minDimensionWorld - 1e-6, LIMITS.maxDimensionWorld + 1e-4),
    'Existing dimensions must be finite and within supported bounds',
  );
  // Any runtime patch to these slots would invalidate their scalar interpretation.
  const spans = [
    [collision.offset + 0x34, 12],
    [collision.offset + 0x4c, 12],
  ];
  for (const [magic, table] of igz.offsetTables) {
    if (magic === 'ROOT' || magic === 'RVTB') continue;
    const width = magic === 'RSTT' ? 4 : 8;
    reject(
      ![...table.offsets].some((at) =>
        spans.some(([start, size]) => at < start + size && at + width > start),
      ),
      `${magic} relocation overlaps collision scalar fields`,
    );
  }
  return { ...result, editable: reasons.length === 0, reasons };
}

export function runRequest(request) {
  object(request, 'Request');
  check(['inspect', 'build'].includes(request.operation), 'operation must be inspect or build');
  keys(
    request,
    request.operation === 'inspect'
      ? ['operation', 'path', 'actorId', 'expectedSourceHash']
      : ['operation', 'path', 'output', 'expectedSourceHash', 'edits'],
    'Request',
  );
  const source = filename(request.path, 'path'),
    stat = fs.statSync(source);
  check(stat.isFile() && stat.size <= 1024 ** 3, 'Source must be a regular file of at most 1 GiB');
  const igz = parseIgz(source),
    sourceHash = hash(igz.buffer),
    references = indexReferences(igz);
  if (request.expectedSourceHash !== undefined || request.operation === 'build') {
    check(
      typeof request.expectedSourceHash === 'string' && /^[0-9a-f]{64}$/.test(request.expectedSourceHash),
      'expectedSourceHash must be a lowercase SHA-256 hash',
    );
    check(request.expectedSourceHash === sourceHash, 'Source SHA-256 does not match expectedSourceHash');
  }
  if (request.operation === 'inspect') {
    const actors =
      request.actorId === undefined
        ? igz.objects.filter((o) => o.type === 'tfbActorInfo')
        : [igz.objects[integer(request.actorId, 'actorId', igz.objects.length - 1)]];
    const collisions = actors.map((actor) => inspectActor(igz, actor, references));
    return {
      profile: PROFILE,
      path: source,
      sha256: sourceHash,
      limits: LIMITS,
      feetToWorld: FEET_TO_WORLD,
      actors: collisions,
      editableCount: collisions.filter((c) => c.editable).length,
      runtimeTested: false,
      warnings: WARNINGS,
    };
  }
  const output = filename(request.output, 'output'),
    manifestPath = output + '.manifest.json';
  check(output !== source && manifestPath !== source, 'Input and output paths must differ');
  check(
    !fs.existsSync(output) && !fs.existsSync(manifestPath),
    'Output or manifest already exists; choose new paths',
  );
  check(
    Array.isArray(request.edits) && request.edits.length >= 1 && request.edits.length <= 32,
    'edits must contain 1..32 collision edits',
  );
  const edited = Buffer.from(igz.buffer),
    changes = [],
    seen = new Set();
  for (const edit of request.edits) {
    object(edit, 'Edit');
    keys(edit, ['actorId', 'dimensionsWorld', 'offsetWorld'], 'Edit');
    const actorId = integer(edit.actorId, 'actorId', igz.objects.length - 1);
    check(!seen.has(actorId), `Duplicate actor edit ${actorId}`);
    seen.add(actorId);
    const item = inspectActor(igz, igz.objects[actorId], references);
    check(item.editable, `Actor ${actorId} is not editable: ${item.reasons.join('; ')}`);
    check(
      edit.dimensionsWorld !== undefined || edit.offsetWorld !== undefined,
      'Edit must specify dimensionsWorld or offsetWorld',
    );
    for (const [field, delta] of [
      ['dimensionsWorld', 0x4c],
      ['offsetWorld', 0x34],
    ]) {
      if (edit[field] === undefined) continue;
      const dimensions = field === 'dimensionsWorld',
        value = edit[field];
      check(
        inBounds(
          value,
          dimensions ? LIMITS.minDimensionWorld : -LIMITS.maxOffsetWorld,
          dimensions ? LIMITS.maxDimensionWorld : LIMITS.maxOffsetWorld,
        ),
        `${field} must be a finite three-vector within documented bounds`,
      );
      const offset = item.collisionOffset + delta;
      value.forEach((n, i) => edited.writeFloatLE(dimensions ? n / FEET_TO_WORLD : n, offset + i * 4));
      const stored = vec3(edited, offset),
        effectiveWorld = dimensions ? stored.map((n) => Math.fround(n * FEET_TO_WORLD)) : stored;
      check(finite3(stored) && finite3(effectiveWorld), 'Float32 conversion overflow');
      changes.push({
        actorId,
        actorName: item.name,
        collisionId: item.collisionId,
        field,
        offset,
        length: 12,
        beforeStored: vec3(igz.buffer, offset),
        afterStored: stored,
        requestedWorld: value,
        effectiveWorld,
        storageUnits: dimensions ? 'feet' : 'world meters',
      });
    }
  }
  const verified = parseIgz(edited),
    afterReferences = indexReferences(verified);
  check(verified.objects.length === igz.objects.length, 'Internal error: object count changed');
  for (const id of seen)
    check(
      inspectActor(verified, verified.objects[id], afterReferences).editable,
      'Internal error: edited collision no longer passes validation',
    );
  let cursor = 0,
    changedByteCount = 0;
  for (const span of [...changes].sort((a, b) => a.offset - b.offset)) {
    check(span.offset >= cursor, 'Internal error: overlapping edits');
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
  check(hash(fs.readFileSync(source)) === sourceHash, 'Source changed during build');
  const manifest = {
    format: 'skylanders-collision-edit-manifest',
    version: 1,
    profile: PROFILE,
    source: { path: source, sha256: sourceHash, size: igz.size },
    output: { path: output, sha256: hash(edited), size: edited.length },
    changes,
    changedActors: seen.size,
    changedByteCount,
    evidenceIds: EVIDENCE,
    verification: {
      reparsed: true,
      unchangedOutsideFields: true,
      collisionFlagsUnchanged: true,
      gameRuntimeTested: false,
    },
    warnings: WARNINGS,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  let wroteOutput = false,
    wroteManifest = false;
  try {
    const fd = fs.openSync(output, 'wx');
    wroteOutput = true;
    try {
      fs.writeFileSync(fd, edited);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const mf = fs.openSync(manifestPath, 'wx');
    wroteManifest = true;
    try {
      fs.writeFileSync(mf, JSON.stringify(manifest, null, 2) + '\n');
      fs.fsyncSync(mf);
    } finally {
      fs.closeSync(mf);
    }
  } catch (error) {
    if (wroteManifest) fs.unlinkSync(manifestPath);
    if (wroteOutput) fs.unlinkSync(output);
    throw error;
  }
  return {
    output,
    manifest: manifestPath,
    sha256: manifest.output.sha256,
    changedActors: seen.size,
    changedByteCount,
    runtimeTested: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--help'))
      console.log('Usage: node tools/collision_builder.mjs < request.json; see docs/COLLISION_AUTHORING.md.');
    else {
      const chunks = [],
        buffer = Buffer.alloc(65536);
      let total = 0,
        length;
      while ((length = fs.readSync(0, buffer, 0, buffer.length, null)) > 0) {
        total += length;
        check(total <= 1024 * 1024, 'Request exceeds 1 MiB');
        chunks.push(Buffer.from(buffer.subarray(0, length)));
      }
      console.log(JSON.stringify(runRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')))));
    }
  } catch (error) {
    console.log(JSON.stringify({ error: { message: error.message } }));
    process.exitCode = 1;
  }
}
