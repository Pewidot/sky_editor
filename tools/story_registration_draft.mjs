#!/usr/bin/env node
// Exact-source initializer draft. It is never an install/deployment command.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseIgz } from './igz.mjs';
import { appendIgz, inspectAppendTarget } from './igz_append.mjs';
import { createRegistryView } from './chapter_registry.mjs';
import { extractMetadata } from './elf_metadata.mjs';
import { EXECUTABLE_SHA256 } from './level_builder.mjs';

const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MAX_FILE = 256 * 1024 * 1024;
export const STORY_DRAFT_PROFILE = Object.freeze({
  initializer: '2d1fabe7de81e6057b676909ecb58c56883bd825ba99b274f45ab38860f989e7',
  global: 'c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c',
  bootstrap: 'a56888faa11114d848daf16e74e1d41560a03ff15adbde55249355a23c1534e9',
  scriptEncoded: 61680,
  listEncoded: 61736,
  insertAt: 86,
  originalRows: 624,
});
const EVIDENCE = Object.freeze({
  binder: 'ev_d58a4911372b4f0f950adcbaf73894382bbfe8848a8d2bf75f77b54db85dace6',
  binderCaller: 'ev_852bed13b0f7b503617aeb64b22a46e5008da01ad0ca81a72065c76daf1fcade',
  nativeHandle: 'ev_60e1a32a3592e55b483b7cc367db4824bdabe601462d80c8530f4d7703568d6f',
  loader: 'ev_ec2b575e84cb4f06b1aba8c75f1ce0d82f7db4a2852eab4ef8b43300b51f0e8b',
  pointerFieldConstructor: 'ev_56512d45baf33ce010361ccd2711a9b6890fe6bbdf28aad75c257e887d7ccf12',
  pointerFieldDefaults: 'ev_8bea158d0d6cb779251b55654c3ccf26aded557020b4978a7b2aaa32633e0852',
  pointerFieldConfiguration: 'ev_78d0c0d3ae32a759d284034d056afe149190e42814200d416ae5e482e7daee02',
  pointerFieldTypeBinding: 'ev_3e0c598567b0d2949cd4ebb672500f31b79d41ff4e76bc2fd7fe6e0d2a790805',
  pointerFieldOwningCallback: 'ev_e5fac96d0aaa54b788e49c6e6f582aa204a3af84f4497a63328ac5fbd8b9bdac',
  nullableRelease: 'ev_eb76cacb52c339edfd89458aea1d394c333d9fabd7ee0bd5f50a0ebecb85ed99',
  opcodeListAndDestruction: 'ev_76fc2124c4a4c4944b884838ef22cc0a207b47db510328d7e7d2aadd00051774',
  objectListOwningRelease: 'ev_faca8c4b6942c014242c19968236ba435acc9661f37f4f02660e24170a9182fc',
});
function keys(value, allowed, label) {
  check(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).every((k) => allowed.includes(k)),
    `Invalid ${label} fields`,
  );
}
function source(buffer, expected, key, pinned = null) {
  check(
    Buffer.isBuffer(buffer) &&
      buffer.length <= MAX_FILE &&
      /^[a-f0-9]{64}$/.test(expected ?? '') &&
      (!pinned || expected === pinned) &&
      hash(buffer) === expected,
    `${pinned ? 'Pinned ' : ''}${key} source SHA-256 mismatch`,
  );
  inspectAppendTarget(buffer, expected);
  return parseIgz(buffer);
}
const byEncoded = (z, encoded) => z.objectsByOffset.get(z.resolvePointer(encoded).offset);
const label = (z, o) => z.stringReferencesByOffset.get(o.offset + 16)?.value ?? '';
const relocationLookups = new WeakMap();
function list(z, o) {
  check(o && o.size >= 40, 'Missing object-list header');
  const count = z.u32(o.offset + 12),
    data = z.pointerReferencesByOffset.get(o.offset + 32);
  check(
    count <= 100000 && z.u32(o.offset + 16) === count && z.u32(o.offset + 24) === count * 8 && data,
    'Unsupported list count/capacity/span',
  );
  z.resolvePointer(data.encoded, count * 8);
  return {
    object: o,
    count,
    data,
    slots: Array.from({ length: count }, (_, i) => data.targetOffset + i * 8),
  };
}
function root(z) {
  const roots = z.offsetTables.get('ROOT')?.encodedOffsets;
  check(roots?.length === 1, 'Expected one ROOT');
  const o = byEncoded(z, roots[0]);
  check(o?.type === 'igObjectList', 'Expected igObjectList ROOT');
  return list(z, o);
}
function slotIdentity(z, at) {
  let lookups = relocationLookups.get(z);
  if (!lookups) {
    lookups = new Map(
      ['ROFS', 'REXT', 'RNEX'].map((k) => [k, new Set(z.offsetTables.get(k)?.offsets ?? [])]),
    );
    relocationLookups.set(z, lookups);
  }
  const kinds = [...lookups].filter(([, offsets]) => offsets.has(at)).map(([kind]) => kind);
  check(kinds.length === 1, 'Expected one supported list-entry relocation');
  return `${kinds[0]}:${z.u64(at).toString(16)}`;
}
function pairedRegistration(original, paired, bootstrap) {
  const a = root(original),
    b = root(paired),
    boot = root(bootstrap);
  check(
    a.count === 3022 && b.count === a.count + 2 && boot.count === 25,
    'Paired global ROOT cardinality mismatch',
  );
  check(
    paired.strings.length === original.strings.length + 2 &&
      original.strings.every((s, i) => paired.strings[i] === s),
    'Original global string identities changed',
  );
  check(
    JSON.stringify(original.types) === JSON.stringify(paired.types) &&
      JSON.stringify(original.typeSizes) === JSON.stringify(paired.typeSizes),
    'Paired global type metadata changed',
  );
  for (let i = 0; i < a.count; i++)
    check(
      slotIdentity(original, a.slots[i]) === slotIdentity(paired, b.slots[i]),
      'Original global ROOT handle changed',
    );
  for (const name of ['EXID', 'EXNM']) {
    const x = original.fixupMap.get(name),
      y = paired.fixupMap.get(name);
    check(
      x?.count === y?.count &&
        original.buffer.subarray(x.dataOffset, x.end).equals(paired.buffer.subarray(y.dataOffset, y.end)),
      'Paired global external table changed: ' + name,
    );
  }
  const additions = [],
    changedHeaders = [a.object.encoded];
  for (const name of ['Level_AdventureTitles', 'Level_Loads']) {
    const find = (z) => {
      const sets = z.objects.filter((o) => o.type === 'ScriptSet' && label(z, o) === name);
      check(sets.length === 1, 'Expected unique chapter set');
      const o = z.objects[z.pointerReferencesByOffset.get(sets[0].offset + 48)?.targetObjectIndex];
      check(o?.type === 'ScriptSetList', 'Chapter set member-list type mismatch');
      return list(z, o);
    };
    const x = find(original),
      y = find(paired);
    check(
      x.count === 22 && y.count === 23 && x.object.encoded === y.object.encoded,
      'Chapter set count/identity mismatch',
    );
    changedHeaders.push(x.object.encoded);
    for (let i = 0; i < x.count; i++)
      check(
        slotIdentity(original, x.slots[i]) === slotIdentity(paired, y.slots[i]),
        'Existing title/load order changed',
      );
    const p = paired.pointerReferencesByOffset.get(y.slots[22]),
      added = paired.objects[p?.targetObjectIndex];
    check(
      added?.type === 'StringInfo' &&
        added.size === 72 &&
        !original.objects.some((o) => o.encoded === added.encoded),
      'Expected newly appended StringInfo',
    );
    const rootIndices = b.slots.flatMap((at, index) =>
      paired.pointerReferencesByOffset.get(at)?.targetObjectIndex === added.index ? [index] : [],
    );
    check(
      rootIndices.length === 1 && rootIndices[0] >= a.count,
      'New StringInfo must occupy one appended ROOT slot',
    );
    additions.push({
      name: label(paired, added),
      encoded: added.encoded,
      objectIndex: added.index,
      rootIndex: rootIndices[0],
      nameId: rootIndices[0] + boot.count + 1,
      namespaceHash: 0x2694be8e,
    });
  }
  check(
    new Set(additions.map((a) => a.encoded)).size === 2 &&
      paired.objects.length === original.objects.length + 2,
    'Unexpected paired global typed objects',
  );
  // Original pool bytes must remain exact except the three relocated list headers.
  const allowed = new Set(
    changedHeaders.flatMap((e) =>
      [
        [12, 4],
        [16, 4],
        [24, 4],
        [32, 8],
      ].flatMap(([at, width]) => Array.from({ length: width }, (_, i) => e + at + i)),
    ),
  );
  const oldPool = original.descriptors[1],
    newPool = paired.descriptors[1];
  for (let i = 0; i < oldPool.dataSize; i++)
    check(
      original.buffer[oldPool.offset + i] === paired.buffer[newPool.offset + i] || allowed.has(i),
      'Unexpected original global pool edit',
    );
  for (const o of original.objects) {
    const next = byEncoded(paired, o.encoded);
    check(next?.type === o.type && next.size === o.size, 'Original global object identity changed');
  }
  return {
    title: additions[0],
    load: additions[1],
    originalGlobalHandlesPreserved: a.count,
    originalBootstrapHandlesPreserved: boot.count,
    count: b.count,
  };
}
function rows(z, code) {
  return list(z, code).slots.map((at) => {
    const p = z.pointerReferencesByOffset.get(at),
      o = z.objects[p?.targetObjectIndex];
    check(o && z.u64(at) === BigInt(o.encoded), 'Opcode row must be ordinary local reference');
    return o;
  });
}
function bindingWalk(z, codeRows) {
  check(
    (z.buffer.readUInt16LE(codeRows[0].offset + 48) & 0x80) === 0,
    'Native binder already-initialized flag is set',
  );
  const definitions = [];
  let row = 5;
  while (row < codeRows.length - 2) {
    const o = codeRows[row];
    check(o.type === 'OpDefineMacro', 'Native macro span walk missed a definition');
    check(
      (z.buffer.readUInt16LE(o.offset + 48) & 4) === 0 &&
        z.u32(o.offset + 64) === 0 &&
        z.u64(o.offset + 72) === 0n,
      'Unsupported prebound macro fields/flags',
    );
    definitions.push({ row, encoded: o.encoded });
    row += 1 + z.buffer.readUInt16LE(o.offset + 50);
  }
  check(definitions.length === 10 && row === codeRows.length - 2, 'Native macro span walk terminal mismatch');
  return definitions;
}

export function createStoryRegistrationDraft(options) {
  keys(
    options,
    ['initializer', 'global', 'pairedGlobal', 'bootstrap', 'expectedHashes', 'metadata'],
    'story draft',
  );
  const { expectedHashes, metadata } = options,
    parsed = {};
  for (const key of ['initializer', 'global', 'bootstrap', 'pairedGlobal'])
    parsed[key] = source(options[key], expectedHashes?.[key], key, STORY_DRAFT_PROFILE[key]);
  check(
    metadata?.executableSha256 === EXECUTABLE_SHA256 && Array.isArray(metadata.classes),
    'Matching native metadata required',
  );
  const field = (type, name, offset) =>
    check(
      metadata.classes
        .find((c) => c.name === type)
        ?.fields.some((f) => f.name === name && f.offset === offset),
      'Native field guard: ' + type + '.' + name,
    );
  for (const entry of [
    ['OpCode', '_branchPC', 50],
    ['OpChangeMembership', '_LHS', 56],
    ['OpChangeMembership', '_RHS', 72],
    ['tfbScriptInfo', '_opList', 40],
    ['OpAbstractDefinition', '_thisPC', 64],
    ['OpAbstractDefinition', '_scriptInfo', 72],
  ])
    field(...entry);
  const pair = pairedRegistration(parsed.global, parsed.pairedGlobal, parsed.bootstrap),
    z = parsed.initializer;
  const target = inspectAppendTarget(options.initializer, expectedHashes.initializer),
    code = byEncoded(z, STORY_DRAFT_PROFILE.listEncoded),
    script = byEncoded(z, STORY_DRAFT_PROFILE.scriptEncoded);
  check(
    code?.type === 'OpCodeList' &&
      script?.type === 'tfbScriptInfo' &&
      label(z, script).endsWith('/Init_Setup_Adventure.ai') &&
      z.pointerReferencesByOffset.get(script.offset + 40)?.targetObjectIndex === code.index,
    'Pinned adventure script identity mismatch',
  );
  const oldRows = rows(z, code);
  check(
    oldRows.length === 624 &&
      oldRows[84].index === 799 &&
      oldRows[85].index === 753 &&
      oldRows[86].index === 801,
    'Pinned insertion boundary mismatch',
  );
  const beforeWalk = bindingWalk(z, oldRows),
    opcode = z.objects[799],
    group = z.objects[800],
    lhs = z.objects[757];
  check(
    opcode.type === 'OpChangeMembership' &&
      opcode.size === 80 &&
      group.type === 'ScriptGroupStack' &&
      group.size === 48 &&
      lhs.type === 'SetStack',
    'Pinned templates mismatch',
  );
  check(
    z.pointerReferencesByOffset.get(opcode.offset + 56)?.targetObjectIndex === lhs.index &&
      z.pointerReferencesByOffset.get(opcode.offset + 72)?.targetObjectIndex === group.index,
    'Pinned membership operand mismatch',
  );
  const incoming = z.pointerReferences.filter((p) => p.targetObjectIndex === lhs.index);
  check(
    incoming.length === 18 &&
      z.u32(lhs.offset + 8) === 18 &&
      incoming.every((p) => {
        const owner = z.objectContaining(p.offset);
        return owner?.type === 'OpChangeMembership' && p.offset === owner.offset + 56;
      }),
    'Shared LHS ownership profile mismatch',
  );
  for (const o of [opcode, group])
    check(
      z.u32(o.offset + 8) === 1 &&
        z.pointerReferences.filter((p) => p.targetObjectIndex === o.index).length === 1,
      'Template unique-ownership profile mismatch',
    );
  const rhsList = list(z, group),
    exnm = z.fixupMap.get('EXNM'),
    at = exnm.dataOffset + 9 * 8;
  check(
    rhsList.count === 1 &&
      z.u64(group.offset + 40) === 0x8000000000000009n &&
      z.offsetTables.get('RNEX').offsets.includes(group.offset + 40) &&
      z.strings[z.u32(at)] === 'StringInfo' &&
      z.strings[z.u32(at + 4)] === 'metaobject',
    'Pinned group type/retain profile mismatch',
  );
  check(
    z.u64(rhsList.slots[0]) === 0x800000000000002dn && target.externalIdCount === 580,
    'Pinned title external reference mismatch',
  );
  const external = { nameId: pair.title.nameId, namespaceHash: pair.title.namespaceHash };
  const payload = Buffer.alloc(136);
  options.initializer.copy(payload, 0, opcode.offset, opcode.offset + opcode.size);
  options.initializer.copy(payload, 80, group.offset, group.offset + group.size);
  payload.writeBigUInt64LE(BigInt(target.appendOffset + 80), 72);
  payload.writeBigUInt64LE(BigInt(target.appendOffset + 128), 80 + 32);
  payload.writeBigUInt64LE(0x8000000000000000n | BigInt(target.externalIdCount), 128);
  const appended = appendIgz(options.initializer, {
    expectedSha256: expectedHashes.initializer,
    appendedDefaultPool: payload,
    appendedObjects: [
      { offset: 0, type: opcode.type },
      { offset: 80, type: group.type },
    ],
    fixupSlots: { RSTT: [16], ROFS: [56, 72, 112], RNEX: [120], REXT: [128] },
    newExternalIds: [external],
    objectLists: [
      { listEncoded: code.encoded, expectedType: 'OpCodeList', insertAt: 86, appendObjects: [0] },
    ],
  });
  const buffer = Buffer.from(appended.buffer),
    prepatch = parseIgz(buffer),
    edits = [];
  for (const [objectIndex, fieldOffset, width, before, after, reason] of [
    [649, 50, 2, 623, 624, 'PRESCRIPT crossing span'],
    [651, 50, 2, 618, 619, 'MACROS crossing span'],
    [652, 50, 2, 292, 293, 'setup macro crossing span'],
    [757, 8, 4, 18, 19, 'one added owning LHS slot'],
  ]) {
    const original = z.objects[objectIndex],
      next = byEncoded(prepatch, original.encoded),
      offset = next.offset + fieldOffset;
    check(
      (width === 2 ? buffer.readUInt16LE(offset) : buffer.readUInt32LE(offset)) === before,
      'Pinned scalar preimage mismatch',
    );
    if (width === 2) buffer.writeUInt16LE(after, offset);
    else buffer.writeUInt32LE(after, offset);
    edits.push({
      originalObjectIndex: objectIndex,
      encoded: original.encoded,
      fieldOffset,
      fileOffset: offset,
      width,
      before,
      after,
      reason,
    });
  }
  const changedBytes = new Set(
    edits.flatMap((e) => Array.from({ length: e.width }, (_, i) => e.fileOffset + i)),
  );
  for (let i = 0; i < buffer.length; i++)
    check(buffer[i] === appended.buffer[i] || changedBytes.has(i), 'Unexpected post-append scalar change');
  const next = parseIgz(buffer),
    nextRows = rows(next, byEncoded(next, code.encoded)),
    afterWalk = bindingWalk(next, nextRows);
  check(
    nextRows.length === 625 && nextRows[86].encoded === target.appendOffset,
    'Inserted opcode position mismatch',
  );
  for (let i = 0; i < oldRows.length; i++)
    check(nextRows[i < 86 ? i : i + 1].encoded === oldRows[i].encoded, 'Original opcode row order changed');
  check(
    afterWalk.every(
      (d, i) =>
        d.encoded === beforeWalk[i].encoded &&
        d.row === beforeWalk[i].row + (beforeWalk[i].row >= 86 ? 1 : 0),
    ),
    'Bound macro row shift mismatch',
  );
  const newLhs = byEncoded(next, lhs.encoded);
  check(
    next.u32(newLhs.offset + 8) === 19 &&
      next.pointerReferences.filter((p) => p.targetObjectIndex === newLhs.index).length === 19,
    'New shared LHS ownership count mismatch',
  );
  const initializerHash = hash(buffer),
    registry = createRegistryView({
      bootstrap: options.bootstrap,
      global: options.pairedGlobal,
      initializer: buffer,
      expectedHashes: {
        bootstrap: expectedHashes.bootstrap,
        global: expectedHashes.pairedGlobal,
        initializer: initializerHash,
      },
      metadata,
    });
  check(
    registry.adventureOrder.length === 19 && registry.adventureOrder.at(-1).row === 86,
    'Independent registry did not recover 19 story includes',
  );
  const resolved = registry.adventureOrder.at(-1).references[0];
  check(
    resolved.index === 580 &&
      resolved.nameId === pair.title.nameId &&
      resolved.resolution?.target?.name === pair.title.name,
    'Independent new title handle resolution failed',
  );
  const oldRegistry = createRegistryView({
    bootstrap: options.bootstrap,
    global: options.global,
    initializer: options.initializer,
    expectedHashes: {
      bootstrap: expectedHashes.bootstrap,
      global: expectedHashes.global,
      initializer: expectedHashes.initializer,
    },
    metadata,
  });
  check(
    registry.adventureOrder
      .slice(0, 18)
      .every(
        (s, i) =>
          s.row === oldRegistry.adventureOrder[i].row &&
          s.references[0].nameId === oldRegistry.adventureOrder[i].references[0].nameId,
      ),
    'Original story includes changed',
  );
  return {
    buffer,
    manifest: {
      schema: 'skylanders-story-registration-draft-v1',
      deployable: false,
      runtimeValidated: false,
      ownershipVerifiedAtRuntime: false,
      ownershipFieldsStaticallyCorroborated: true,
      saveMigrationSupported: false,
      executableSha256: EXECUTABLE_SHA256,
      evidence: EVIDENCE,
      sources: Object.fromEntries(
        ['initializer', 'global', 'pairedGlobal', 'bootstrap'].map((k) => [
          k,
          { sha256: expectedHashes[k], size: options[k].length },
        ]),
      ),
      outputSha256: initializerHash,
      pair,
      insertion: {
        row: 86,
        previousRows: 624,
        rows: 625,
        previousStoryIncludes: 18,
        storyIncludes: 19,
        opcodeEncoded: target.appendOffset,
        groupStackEncoded: target.appendOffset + 80,
        externalIndex: 580,
        externalHandle: external,
        externalRawHex: payload.subarray(128).toString('hex'),
        originalRowsPreserved: true,
      },
      ownership: {
        sharedLhsEncoded: lhs.encoded,
        previousSerializedCount: 18,
        serializedCount: 19,
        incomingOrdinarySlots: 19,
        newOpcodeCount: 1,
        newGroupStackCount: 1,
        taggedTypeRetainPreserved: true,
        taggedTitleRetainPreserved: true,
        basis:
          'Pinned template counts and exact incoming owning-field profile; loader retains tagged external type/title references at load time.',
        staticEvidenceScope:
          'Native list-entry release and default reference-owning pointer-field metadata callback; active runtime mode and object lifecycle/teardown are not observed.',
      },
      binding: {
        original: beforeWalk,
        rebuilt: afterWalk,
        serializedZeroPcAndNullScriptPreserved: true,
        runtimeExecuted: false,
      },
      scalarEdits: edits,
      append: appended.manifest,
      independentRegistry: {
        storyIncludes: 19,
        newTitle: resolved.resolution.target,
        globalHandles: registry.globalHandles.length,
      },
      blockers: [
        'No chapter assets, dependency closure, objectives or completion flow are authored by this tool.',
        'Initializer save counts change with the paired registry; existing saves require an independently verified migration policy.',
        'Chapter selection, unlock progression, lighting, reference lifecycle and complete gameplay are not runtime-validated.',
        'Use all corresponding rebuilt language dictionaries; this tool neither creates nor verifies their contents.',
      ],
    },
  };
}

function same(a, b) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}
function owned(filename, stat) {
  try {
    const s = fs.lstatSync(filename);
    return s.dev === stat.dev && s.ino === stat.ino;
  } catch {
    return false;
  }
}
function readAtStart(fd, size) {
  const bytes = Buffer.alloc(size);
  let at = 0;
  while (at < size) {
    const n = fs.readSync(fd, bytes, at, Math.min(1024 * 1024, size - at), at);
    check(n > 0, 'File ended early');
    at += n;
  }
  return bytes;
}
export function writeStoryRegistrationDraft(options) {
  keys(
    options,
    ['initializer', 'global', 'pairedGlobal', 'bootstrap', 'expectedHashes', 'executable', 'outputDirectory'],
    'story draft request',
  );
  const { expectedHashes, executable } = options;
  check(
    typeof executable === 'string' &&
      typeof options.outputDirectory === 'string' &&
      options.outputDirectory.length > 0,
    'ELF and new outputDirectory required',
  );
  const outputDirectory = path.resolve(options.outputDirectory),
    sources = {},
    files = [];
  let directoryStat,
    complete = false;
  try {
    for (const key of ['initializer', 'global', 'pairedGlobal', 'bootstrap']) {
      check(typeof options[key] === 'string' && options[key].length > 0, 'Missing source path: ' + key);
      const filename = path.resolve(options[key]),
        fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const entry = (sources[key] = { filename, fd, stat: fs.fstatSync(fd) });
      check(entry.stat.isFile() && entry.stat.size <= MAX_FILE, 'Expected bounded regular source');
      entry.bytes = readAtStart(fd, entry.stat.size);
    }
    const unchanged = () => {
      for (const s of Object.values(sources))
        check(
          same(s.stat, fs.fstatSync(s.fd)) && same(s.stat, fs.lstatSync(s.filename)),
          'Source changed during story draft creation',
        );
    };
    unchanged();
    const result = createStoryRegistrationDraft({
      ...Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, s.bytes])),
      expectedHashes,
      metadata: extractMetadata(executable),
    });
    unchanged();
    fs.mkdirSync(outputDirectory, { mode: 0o700 });
    directoryStat = fs.lstatSync(outputDirectory);
    const outputs = [];
    result.manifest.outputs = [
      {
        path: 'init_setup.story-registration-draft.igz',
        size: result.buffer.length,
        sha256: hash(result.buffer),
      },
    ];
    for (const [name, bytes] of [
      ['init_setup.story-registration-draft.igz', result.buffer],
      ['manifest.json', Buffer.from(JSON.stringify(result.manifest, null, 2) + '\n')],
    ]) {
      const filename = path.join(outputDirectory, name),
        fd = fs.openSync(filename, 'wx+', 0o600),
        stat = fs.fstatSync(fd);
      files.push({ filename, stat });
      try {
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
        check(
          fs.fstatSync(fd).size === bytes.length && hash(readAtStart(fd, bytes.length)) === hash(bytes),
          'Story draft readback mismatch',
        );
      } finally {
        fs.closeSync(fd);
      }
      check(owned(filename, stat), 'Story draft path changed');
      outputs.push({ path: filename, sha256: hash(bytes), size: bytes.length });
    }
    unchanged();
    check(
      files.every((f) => owned(f.filename, f.stat)) && owned(outputDirectory, directoryStat),
      'Story draft output paths changed',
    );
    complete = true;
    return { outputDirectory, outputs, deployable: false, runtimeValidated: false, storyIncludes: 19 };
  } finally {
    for (const s of Object.values(sources)) fs.closeSync(s.fd);
    if (!complete) {
      for (const f of files.reverse()) if (owned(f.filename, f.stat)) fs.unlinkSync(f.filename);
      if (directoryStat && owned(outputDirectory, directoryStat)) {
        try {
          fs.rmdirSync(outputDirectory);
        } catch (error) {
          if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
        }
      }
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    check(process.argv.length === 3, 'Usage: node tools/story_registration_draft.mjs request.json');
    const filename = process.argv[2],
      stat = fs.lstatSync(filename);
    check(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024,
      'Expected regular request JSON <=1 MiB',
    );
    console.log(JSON.stringify(writeStoryRegistrationDraft(JSON.parse(fs.readFileSync(filename, 'utf8')))));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
