#!/usr/bin/env node
// One exact-arena experimental clone. This is not a generic actor serializer.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseIgz } from './igz.mjs';
import { appendIgz, inspectAppendTarget } from './igz_append.mjs';
import { FEET_TO_WORLD, LIMITS as COLLISION_LIMITS } from './collision_builder.mjs';

export const ACTOR_CLONE_PROFILE = 'trap-team-arena303-garagedoor4-clone-v1';
export const SOURCE_SHA256 = 'de0ecd5bc5f5f2b3d99ec81592e8fef97a3228e6777e99f1c169e6cd584e7a32';
export const SOURCE_SIZE = 91745564;
export const REFCOUNT_MASK = 0x7ffff;
const ELF_SHA256 = '423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3';
const TEMPLATE = Object.freeze({
  actor: Object.freeze({ index: 26175, encoded: 0x287090, size: 0x170, type: 'tfbActorInfo' }),
  collision: Object.freeze({ index: 26176, encoded: 0x287200, size: 0x80, type: 'CollisionInfo' }),
  parameters: Object.freeze({ index: 26222, encoded: 0x288618, size: 0x58, type: 'ActorParameters' }),
  model: Object.freeze({ index: 26177, encoded: 0x287280, size: 0x70, type: 'tfbPhysicsModel' }),
});
const EVIDENCE = Object.freeze({
  actorPostLoad: 'ev_a579e926669fa754f26fbe8260703633dae3997f99a4b247e8108a7800dab6a4',
  privateObjectCopy: 'ev_97266d31f260fd9d0bb2547e89b01f2b79df1114c9d86c6ddca256863fbb120b',
  nullScriptTick: 'ev_2addc8e3584f70ff48a61616569d25775fe47acc2a2822f5e5909f0c1403c529',
  appendRootDispatch: 'ev_ef25bbb58bb2ef767ca62ab22dd793c6415cd77324e0297db037e1ed2559aea1',
  appendPlacement: 'ev_82048b225158bb4d240a562f3852b756113fcd44dbcadaa4249e5c092c6d1dcd',
  stateChangeListener: 'ev_8eea412f3d507951336fed4b6f787219f3780bd8ca19777b5519e83fafefe6c1',
  runtimeActorCreation: 'ev_f7fdd2a975abf3dc02f199b4f668d88c8de604d3755a54879da9a6c6f1fd5bc7',
  dimensions: 'ev_8ebd053ee9b062fa91cf80c4df5c1d9cf04020932ca7c4290f10f0ce447d075f',
  rootWriter: 'ev_8f1e689ccb70dca6b4dee9abc703e8f62259cc6343ce8643a7e9ed3e376cd5ca',
  loader: 'ev_ec2b575e84cb4f06b1aba8c75f1ce0d82f7db4a2852eab4ef8b43300b51f0e8b',
  releaseReference: 'ev_34f9859d2eb1f122807395902ce58ca151e8493495a366c9378bfeda1aeee56f',
  retainReference: 'ev_0d2008a3fb5e310915be2a7cbbfc3d569ba781c68e2a77f60c1468b31e06da49',
});
const WARNINGS = Object.freeze([
  'Experimental structural prototype; loading, visibility, grounding and teardown are not runtime-validated by this tool.',
  'Adds one door-model actor, not a new authored render mesh or a complete playable map. Optional collision dimensions do not resize the visible door model.',
  'Only the new actor joins the ROOT list. No original ScriptSetList, door-control group or script ValueStack receives it.',
  'Activity remains serialized UNMANAGED (4). Native AppendObjectMessage seeds state 2; the scheduler decides whether to activate the placement.',
  'The model resource is shared with an explicit serialized reference-count increment 1 to 2. CollisionInfo and ActorParameters are private copies.',
]);
const hash = (b) => createHash('sha256').update(b).digest('hex');
const check = (ok, text) => {
  if (!ok) throw new Error(text);
};
function keys(o, allowed, label) {
  check(o && typeof o === 'object' && !Array.isArray(o), `${label} must be an object`);
  check(
    Object.keys(o).every((k) => allowed.includes(k)),
    `${label} contains unsupported fields`,
  );
}
function vector(v, low, high, label) {
  check(
    Array.isArray(v) &&
      v.length === 3 &&
      v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= low && x <= high),
    `${label} must contain three finite numbers in [${low},${high}]`,
  );
}
function v3(b, at) {
  return [0, 1, 2].map((i) => b.readFloatLE(at + i * 4));
}
function same(a, b, label) {
  check(JSON.stringify(a) === JSON.stringify(b), `Unexpected ${label}`);
}
function nameValid(name) {
  check(
    typeof name === 'string' && /^[\x20-\x7e]{1,80}$/.test(name) && name.trim() === name,
    'name must be 1–80 printable ASCII characters without surrounding whitespace',
  );
}
function target(input, expectedSourceHash) {
  check(
    expectedSourceHash === SOURCE_SHA256,
    'Only the exact original arena303 expectedSourceHash is supported',
  );
  check(
    Buffer.isBuffer(input) && input.length === SOURCE_SIZE,
    `Source must be a Buffer of exactly ${SOURCE_SIZE} bytes`,
  );
  check(hash(input) === SOURCE_SHA256, 'Source SHA-256 mismatch; modified or other arenas are unsupported');
  const z = parseIgz(input),
    objects = {};
  check(z.unresolvedFixupEntries.length === 0, 'Unresolved source relocations');
  for (const [key, spec] of Object.entries(TEMPLATE)) {
    const o = z.objects[spec.index];
    check(
      o && o.encoded === spec.encoded && o.size === spec.size && o.type === spec.type && o.section === 1,
      `Unexpected ${key} layout`,
    );
    objects[key] = o;
  }
  const { actor, collision, parameters, model } = objects;
  same(
    z.summarizeObject(actor.index).pointerReferences.map((r) => [r.fieldOffset, r.targetObjectIndex]),
    [
      [0x120, collision.index],
      [0x158, model.index],
      [0x160, parameters.index],
    ],
    'actor outgoing pointers',
  );
  same(
    z.summarizeObject(actor.index).stringReferences.map((r) => [r.fieldOffset, r.value]),
    [[0x10, 'GarageDoor_4']],
    'actor name',
  );
  // Reject unexpected relocations even in fields that currently store zero.
  for (const o of [actor, collision, parameters]) {
    const expected = new Map([['RVTB', [0]]]);
    if (o === actor) {
      expected.set('RSTT', [0x10]);
      expected.set('ROFS', [0x120, 0x158, 0x160]);
    }
    for (const [kind, table] of z.offsetTables) {
      const inside = Array.from(table.offsets)
        .filter((at) => at >= o.offset && at < o.offset + o.size)
        .map((at) => at - o.offset);
      same(inside, expected.get(kind) ?? [], `${o.type} ${kind} relocations`);
    }
  }
  const incoming = (o) =>
    z.pointerReferences.filter((r) => r.targetOffset >= o.offset && r.targetOffset < o.offset + o.size);
  same(
    incoming(actor).map((r) => r.offset),
    [0x512b4, 0x2c6f14, 0x2d2ed4, 0x2d8b5c, 0x2e9a8c],
    'actor incoming references',
  );
  for (const [o, field] of [
    [collision, 0x120],
    [model, 0x158],
    [parameters, 0x160],
  ]) {
    const refs = incoming(o);
    check(
      refs.length === 1 && refs[0].offset === actor.offset + field && refs[0].targetOffset === o.offset,
      `${o.type} must have exactly the verified incoming reference and no interior aliases`,
    );
    check(z.u32(o.offset + 8) === 1, `${o.type} requires exact small serialized reference count 1`);
  }
  check(
    z.u32(actor.offset + 8) === 5 && z.u32(actor.offset + 0x70) === 4 && z.u32(actor.offset + 0x38) === 0,
    'Unexpected actor reference count, state or placement flags',
  );
  for (const field of [0x80, 0xa0, 0xa8, 0xf8, 0x148, 0x150, 0x168])
    check(z.u64(actor.offset + field) === 0n, 'Unexpected actor runtime/link field');
  same(v3(input, actor.offset + 0x114), [100, 100, 100], 'actor scale');
  same(v3(input, actor.offset + 0x4c), [0, 0, 0], 'actor angles');
  check(
    input.subarray(actor.offset + 0x58, actor.offset + 0x70).every((b) => b === 0),
    'Unexpected current matrix',
  );
  check(
    z.u32(collision.offset + 0x30) === 0x69,
    'Collision requires original BOX+solid+surface+physics properties',
  );
  check(
    input.subarray(collision.offset + 0x34, collision.offset + 0x4c).every((b) => b === 0),
    'Unexpected collision transform',
  );
  check(
    input.subarray(collision.offset + 0x60, collision.offset + 0x80).every((b) => b === 0),
    'Unexpected collision owner/contacts',
  );
  check(z.u64(parameters.offset + 0x10) === 0n, 'Unexpected parameter owner');
  const root = z.objects[0];
  check(
    root.type === 'igObjectList' && root.encoded === 8 && z.u32(root.offset + 0xc) === 1459,
    'Unexpected root list',
  );
  return { z, ...objects, append: inspectAppendTarget(input, expectedSourceHash) };
}

export function inspectCloneTarget(input, expectedSourceHash) {
  const { z, actor, collision, parameters, model, append } = target(input, expectedSourceHash);
  return {
    profile: ACTOR_CLONE_PROFILE,
    sourceSha256: SOURCE_SHA256,
    eligible: true,
    template: TEMPLATE,
    position: v3(input, actor.offset + 0x40),
    dimensionsWorld: v3(input, collision.offset + 0x4c).map((n) => Math.fround(n * FEET_TO_WORLD)),
    privateObjectIds: [collision.index, parameters.index],
    sharedModelId: model.index,
    sharedModelReferenceCount: z.u32(model.offset + 8),
    rootCount: 1459,
    appendOffset: append.appendOffset,
    runtimeValidated: false,
    warnings: WARNINGS,
  };
}

/** In-memory clone; no disk or emulator writes. Always requires the original hash. */
export function cloneActor(input, request) {
  keys(request, ['expectedSourceHash', 'name', 'position', 'dimensionsWorld'], 'Clone request');
  nameValid(request.name);
  vector(request.position, -10000, 10000, 'position');
  if (request.dimensionsWorld !== undefined)
    vector(
      request.dimensionsWorld,
      COLLISION_LIMITS.minDimensionWorld,
      COLLISION_LIMITS.maxDimensionWorld,
      'dimensionsWorld',
    );
  const { z, actor, collision, parameters, model, append } = target(input, request.expectedSourceHash);
  check(
    !z.strings.some((s) => s.toLowerCase() === request.name.toLowerCase()),
    'name already exists in TSTR (case-insensitive)',
  );
  const actorAt = 0,
    collisionAt = 0x170,
    parametersAt = 0x1f0;
  const bytes = Buffer.alloc(0x248);
  input.copy(bytes, actorAt, actor.offset, actor.offset + actor.size);
  input.copy(bytes, collisionAt, collision.offset, collision.offset + collision.size);
  input.copy(bytes, parametersAt, parameters.offset, parameters.offset + parameters.size);
  bytes.writeUInt32LE(1, 8); // ROOT is the clone's only serialized owner.
  bytes.writeBigUInt64LE(BigInt(z.strings.length), 0x10);
  request.position.forEach((n, i) => bytes.writeFloatLE(n, 0x40 + i * 4));
  bytes.writeBigUInt64LE(BigInt(append.appendOffset + collisionAt), 0x120);
  bytes.writeBigUInt64LE(BigInt(append.appendOffset + parametersAt), 0x160);
  if (request.dimensionsWorld !== undefined)
    request.dimensionsWorld.forEach((n, i) =>
      bytes.writeFloatLE(n / FEET_TO_WORLD, collisionAt + 0x4c + i * 4),
    );
  const result = appendIgz(input, {
    expectedSha256: SOURCE_SHA256,
    appendedDefaultPool: bytes,
    appendedObjects: [
      { offset: actorAt, type: actor.type },
      { offset: collisionAt, type: collision.type },
      { offset: parametersAt, type: parameters.type },
    ],
    fixupSlots: { RSTT: [0x10], ROFS: [0x120, 0x158, 0x160] },
    newStrings: [request.name],
    rootList: { rootEncoded: 8, appendObjects: [actorAt] },
  });
  const intermediateHash = result.manifest.output.sha256;
  const beforeCount = parseIgz(result.buffer),
    newModel = beforeCount.objectsByOffset.get(beforeCount.resolvePointer(model.encoded).offset);
  check(
    newModel.type === model.type && beforeCount.u32(newModel.offset + 8) === 1,
    'Shared model changed during append',
  );
  // Native low-19-bit count is retained by RVTB; ordinary ROFS does not retain.
  // This policy admits only exact 1 -> 2, never arbitrary header-bit editing.
  const buffer = Buffer.from(result.buffer);
  buffer.writeUInt32LE(2, newModel.offset + 8);
  check(
    buffer.subarray(0, newModel.offset + 8).equals(result.buffer.subarray(0, newModel.offset + 8)) &&
      buffer.subarray(newModel.offset + 12).equals(result.buffer.subarray(newModel.offset + 12)),
    'Unexpected post-append byte change',
  );
  const output = parseIgz(buffer),
    added = result.manifest.appended.objects;
  const newActor = output.objects[added[0].index],
    newCollision = output.objects[added[1].index],
    newParameters = output.objects[added[2].index];
  const refsTo = (o) =>
    output.pointerReferences.filter((r) => r.targetOffset >= o.offset && r.targetOffset < o.offset + o.size);
  for (const o of [newActor, newCollision, newParameters]) {
    const refs = refsTo(o);
    check(
      refs.length === 1 && refs[0].targetOffset === o.offset && output.u32(o.offset + 8) === 1,
      'New private object ownership mismatch',
    );
  }
  const modelRefs = refsTo(output.objectsByOffset.get(output.resolvePointer(model.encoded).offset));
  same(
    modelRefs.map((r) => r.objectIndex).sort((a, b) => a - b),
    [actor.index, newActor.index].sort((a, b) => a - b),
    'shared model owners',
  );
  same(
    output.summarizeObject(newActor.index).pointerReferences.map((r) => [r.fieldOffset, r.targetObjectIndex]),
    [
      [0x120, newCollision.index],
      [0x158, model.index],
      [0x160, newParameters.index],
    ],
    'new actor graph',
  );
  check(
    output.u32(newActor.offset + 0x70) === 4 &&
      output.u64(newActor.offset + 0xf8) === 0n &&
      output.u32(newCollision.offset + 0x30) === 0x69 &&
      output.u32(output.objects[0].offset + 0xc) === 1460 &&
      output.unresolvedFixupEntries.length === 0,
    'New graph state/root verification failed',
  );
  check(hash(input) === SOURCE_SHA256, 'Source buffer changed');
  const manifest = {
    format: 'skylanders-actor-clone-manifest',
    version: 1,
    profile: ACTOR_CLONE_PROFILE,
    source: { sha256: SOURCE_SHA256, size: input.length },
    output: { sha256: hash(buffer), size: buffer.length },
    request: {
      name: request.name,
      position: request.position,
      dimensionsWorld: request.dimensionsWorld ?? null,
    },
    clone: {
      actorId: newActor.index,
      actorEncoded: newActor.encoded,
      collisionId: newCollision.index,
      parametersId: newParameters.index,
      sharedModelId: model.index,
      position: v3(buffer, newActor.offset + 0x40),
      dimensionsFeet: v3(buffer, newCollision.offset + 0x4c),
      dimensionsWorld: v3(buffer, newCollision.offset + 0x4c).map((n) => Math.fround(n * FEET_TO_WORLD)),
      rootOnly: true,
      activityState: 4,
    },
    sharedModelCountEdit: {
      encoded: model.encoded + 8,
      outputOffset: newModel.offset + 8,
      width: 4,
      before: 1,
      after: 2,
      countMask: REFCOUNT_MASK,
    },
    append: result.manifest,
    structuralAppendIntermediateSha256: intermediateHash,
    evidence: EVIDENCE,
    assemblyEvidence: {
      elfSha256: ELF_SHA256,
      directoryFields: '0xbf852c',
      directoryNames: '0xf8a5e0',
      directoryOffsets: '0xc823c0',
      release: '0x51c280',
      retain: '0x51ca90',
      atomicIncrement: '0x57e780',
      scheduler: '0x411ca0',
    },
    verification: {
      reparsed: true,
      originalInputUnchanged: true,
      rootCount: 1460,
      newObjectCount: 3,
      sharedModelCountIncrement: 1,
      noScriptOrGroupReferencesAdded: true,
      runtimeValidated: false,
    },
    warnings: WARNINGS,
  };
  return { buffer, manifest };
}

function sameStat(a, b) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}
function readBounded(filename, exactSize, limit, label) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    check(
      stat.isFile() && stat.size <= limit && (exactSize === null || stat.size === exactSize),
      `${label} must be a regular file ${exactSize === null ? `at most ${limit}` : `of exactly ${exactSize}`} bytes`,
    );
    const bytes = Buffer.alloc(stat.size);
    for (let at = 0; at < bytes.length; ) {
      const n = fs.readSync(fd, bytes, at, Math.min(bytes.length - at, 1024 * 1024), at);
      check(n > 0, `${label} changed during bounded read`);
      at += n;
    }
    check(
      sameStat(stat, fs.fstatSync(fd)) && sameStat(stat, fs.statSync(filename)),
      `${label} changed during read`,
    );
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
function readSource(filename) {
  return readBounded(filename, SOURCE_SIZE, SOURCE_SIZE, 'Source');
}
function filepath(value, label) {
  check(typeof value === 'string' && value.length > 0 && !value.includes('\0'), `${label} is required`);
  return path.resolve(value);
}
function removeOwned(filename, stat) {
  if (!stat) return;
  try {
    const now = fs.lstatSync(filename);
    if (now.dev === stat.dev && now.ino === stat.ino) fs.unlinkSync(filename);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
export function runRequest(request) {
  keys(
    request,
    ['operation', 'path', 'expectedSourceHash', 'output', 'name', 'position', 'dimensionsWorld'],
    'Request',
  );
  check(['inspect', 'build'].includes(request.operation), 'operation must be inspect or build');
  if (request.operation === 'inspect')
    keys(request, ['operation', 'path', 'expectedSourceHash'], 'Inspect request');
  const source = filepath(request.path, 'path'),
    input = readSource(source);
  if (request.operation === 'inspect')
    return { ...inspectCloneTarget(input, request.expectedSourceHash), path: source };
  const output = filepath(request.output, 'output'),
    manifestPath = output + '.manifest.json';
  check(source !== output && source !== manifestPath, 'Source and destinations must differ');
  const result = cloneActor(input, {
    expectedSourceHash: request.expectedSourceHash,
    name: request.name,
    position: request.position,
    ...(request.dimensionsWorld === undefined ? {} : { dimensionsWorld: request.dimensionsWorld }),
  });
  check(hash(readSource(source)) === SOURCE_SHA256, 'Source changed while planning');
  let outputFd,
    manifestFd,
    outputStat,
    manifestStat,
    complete = false;
  try {
    outputFd = fs.openSync(output, 'wx+', 0o600);
    outputStat = fs.fstatSync(outputFd);
    manifestFd = fs.openSync(manifestPath, 'wx', 0o600);
    manifestStat = fs.fstatSync(manifestFd);
    fs.writeFileSync(outputFd, result.buffer);
    fs.fsyncSync(outputFd);
    const readback = Buffer.alloc(result.buffer.length);
    let read = 0;
    while (read < readback.length) {
      const n = fs.readSync(outputFd, readback, read, readback.length - read, read);
      check(n > 0, 'Output readback ended early');
      read += n;
    }
    check(
      hash(readback) === result.manifest.output.sha256 && fs.fstatSync(outputFd).size === readback.length,
      'Output readback mismatch',
    );
    check(hash(readSource(source)) === SOURCE_SHA256, 'Source changed during output');
    result.manifest.source.path = source;
    result.manifest.output.path = output;
    fs.writeFileSync(manifestFd, JSON.stringify(result.manifest, null, 2) + '\n');
    fs.fsyncSync(manifestFd);
    for (const [file, stat] of [
      [output, outputStat],
      [manifestPath, manifestStat],
    ]) {
      const now = fs.lstatSync(file);
      check(now.dev === stat.dev && now.ino === stat.ino, 'Output path changed concurrently');
    }
    complete = true;
    return {
      output,
      manifest: manifestPath,
      sha256: result.manifest.output.sha256,
      clone: result.manifest.clone,
      runtimeValidated: false,
    };
  } finally {
    if (manifestFd !== undefined) fs.closeSync(manifestFd);
    if (outputFd !== undefined) fs.closeSync(outputFd);
    if (!complete) {
      removeOwned(manifestPath, manifestStat);
      removeOwned(output, outputStat);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    check(process.argv.length === 3, 'Usage: node tools/actor_clone.mjs /path/to/request.json');
    const file = path.resolve(process.argv[2]);
    console.log(
      JSON.stringify(
        runRequest(JSON.parse(readBounded(file, null, 1024 * 1024, 'Request').toString('utf8'))),
      ),
    );
  } catch (e) {
    console.log(JSON.stringify({ error: { message: e.message } }));
    process.exitCode = 1;
  }
}
