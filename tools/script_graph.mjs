#!/usr/bin/env node
// Read-only, source-bound script structure and deliberately partial native flow.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseIgz } from './igz.mjs';
import { extractMetadata } from './elf_metadata.mjs';
import { EXECUTABLE_SHA256 } from './level_builder.mjs';

const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MAX_SOURCE = 1024 ** 3,
  MAX_OUTPUT = 64 * 1024 * 1024;
const IGZ_LOADER_EVIDENCE = 'ev_ec2b575e84cb4f06b1aba8c75f1ce0d82f7db4a2852eab4ef8b43300b51f0e8b';
// Seen in the selected PS4 sources: common reference-array header +0xc/+0x20.
// This is a structural profile, not recovered stack evaluation semantics.
const OBSERVED_REFERENCE_ARRAY_TYPES = new Set([
  'OpCreateVariableList',
  'ScriptSetList',
  'ReferenceStack',
  'RHSReferenceStack',
  'ValueStack',
  'RHSValueStack',
  'SetStack',
  'ScriptGroupStack',
  'PositionStack',
]);
const SCRIPT_POINTER_FIELDS = new Set([
  '_opList',
  '_masterVarList',
  '_macroVarList',
  '_returnMacro',
  '_scriptInfo',
  '_LHS',
  '_RHS',
  '_NP',
  '_indexRHS',
  '_cachedObject',
  '_lastReceiver',
  '_facingRHS',
  '_varOp1',
  '_varOp2',
  '_conditioner',
  '_type',
  '_cachedType',
  '_cachedObj',
]);
function nativeBuiltinIdentity(nameId, namespaceHash) {
  // Exact pair from this executable's native class/property registration. This
  // annotates identity only; it neither links an IGZ object nor reads live state.
  if (nameId === 1278082707 && namespaceHash === 2288385111)
    return {
      symbol: 'OpTopLevelBehavior::my',
      kind: 'native-property-registration',
      evidenceKind: 'native-static',
      registeredType: 'ScriptReference',
      valueEvaluated: false,
      limitation:
        'The name/type registration is proven; runtime getter/context binding and a self-placement interpretation are not established here.',
      evidence: [
        'ev_3c2a8d6d1b133ff67a3e36e2299003ec10a36813dbdfad5a9614ad752d5d0275',
        'ev_1ccf46bf73a4a6e4bfc96a74ef78539b25ae37426b71079b3c6acf39ea9a833b',
        'ev_fe8028a89ebb7d05dbae502b7fa5b4aede3a10c45c170196c2e42c82af6043c6',
      ],
    };
  if (nameId === 1073217499 && namespaceHash === 1483773250)
    return {
      symbol: 'ActorInfo::removed',
      nativeClass: 'tfbActorInfo',
      kind: 'native-property-registration',
      evidenceKind: 'native-static',
      getter: '0x40cd30',
      valueEvaluated: false,
      resultType: 'SetVariant',
      getterObservation:
        'Returns the static removed-set reference at (*DAT_0103b950)+0x50; no runtime set contents are evaluated.',
      evidence: [
        'ev_8106957a62ac8ed7cd3e2fa0ee5073c00777d48f5292117ab75394ffc2f1bb1d',
        'ev_1aebdac05b6820eae8348572204ed2efca9cd6af2dac4743a8206ab360777166',
        'ev_fe8028a89ebb7d05dbae502b7fa5b4aede3a10c45c170196c2e42c82af6043c6',
      ],
    };
  if (namespaceHash === 893222784 && [664674460, 54063584].includes(nameId)) {
    const activationRange = nameId === 664674460;
    return {
      symbol: activationRange ? 'Placement::activation range' : 'Placement::deactivation buffer',
      kind: 'native-property-registration',
      evidenceKind: 'native-static',
      valueEvaluated: false,
      getter: activationRange ? '0x47b9b0' : '0x47ba30',
      setter: activationRange ? '0x47b9d0' : '0x47ba50',
      setterObservation: `Writes a float to placement ${activationRange ? '+0x130' : '+0x134'} after the property conversion path.`,
      limitation:
        'No runtime property conversion or units are evaluated; serialized IntMeasurement payloads are not assumed to be raw destination floats.',
      evidence: [
        'ev_e8d2900f6f4b86d87a40917197817a8af55dfdd2462bd4ee7822608e7769c3a2',
        activationRange
          ? 'ev_6f68b112a19a09ac7bdba65933531b43f86787970787ef94217f0fe1996b4e47'
          : 'ev_76f0a9f6aa2c732f1c1d318268eadb0643ee32c3a5287691e5c3cb52f126a7c4',
      ],
    };
  }
  if (nameId !== 967958004 || namespaceHash !== 1549491124) return null;
  return {
    symbol: 'SetVariant::count',
    kind: 'native-property-registration',
    evidenceKind: 'native-static',
    getter: '0x4814a0',
    setter: '0x4814c0',
    valueEvaluated: false,
    getterObservation:
      'Reads the wrapped container uint32 field at +0xc; no runtime container is evaluated here.',
    evidence: [
      'ev_11fdeffa6dbac8c21e58bab96a17dcae08a8da71ca801acc343674010484d77a',
      'ev_66062c938ad3ea1141fbd0aaa3244f0bd27a747a56c9871557b1a4d3a1d601b3',
      'ev_fe8028a89ebb7d05dbae502b7fa5b4aede3a10c45c170196c2e42c82af6043c6',
      'ev_9f8ccd6874c8a1fcd07054d9ef18fa78cec79d6e6073469251e8efa953188b05',
    ],
  };
}
export const SCRIPT_FLOW_EVIDENCE = Object.freeze({
  dispatch: 'ev_2addc8e3584f70ff48a61616569d25775fe47acc2a2822f5e5909f0c1403c529',
  checkValue: 'ev_2c88a29517b630dab0677b08161c134fe0f6a55f0304e67ed02f8a6a7446f26e',
  startUp: 'ev_e872ece293219684d14c773af553584cc117330241f9969a5e9cb70f6ae5ede4',
  abstractFlow: 'ev_21610eacc7ea28b5fbd6fad87a7df29a802e72b57db84575e5baeb0ac2771d50',
  startSequence: 'ev_3423bad0fc27338437f047cecb30b5585c22515ed740526e13ec4bd1118cd6a9',
  pushFrame: 'ev_535653798383380c2ea43ec2c380043a5388979a63091e22cc19a22f1e194e80',
  control: 'ev_87388b0731d96e652030148cc3f15b8fa8185e232ad7b30f601b9deccac5552c',
  controlReceiver: 'ev_b9f267d2c2ece311bb1c75ec202101a9a8c48cd7abd10c6ad46926b778c63d9c',
  spawn: 'ev_8d420bd6c140794e9905b9313ccc0c50eeb673920714c880490be24306b93ac0',
  clone: 'ev_20f44c4cb45309e629d2f10c921ea1a64aed23061cfbf5f89269a49998968518',
  setBehavior: 'ev_e270fd3ad33e84d2d1d36613f7ca9ed4c0b9410293c012e56ae592fb8ca75ae7',
  flowLoop: 'ev_90c4cb64abbec35e68570778036cde84b441111991221dd2135b92f31bcfeca0',
  checkMembership: 'ev_00236125db2bf634bc338de9fbfdbd1f10b4528b763de96d2c4110823cacb10e',
  remove: 'ev_438bbebfce277e4b5e8329436a6b172e6536d54202fdf04ce1a5190bde840ab8',
  shutDown: 'ev_05695876e7f43d96c5ce21d4f4cf63d5f943f33ce05c9ce3d3467e73ef193216',
  setValue: 'ev_2d7c1a4b06d36f40044636e1d16e51deed715f02af941539853749d71b9980ee',
});

/** Only exact native implementations with evidence get conditional successors.
 * Unknown names (including subclasses) do not inherit behavior by spelling.
 */
export function describeOpcodeFlow(type, row, branchDelta, rowCount) {
  check(
    typeof type === 'string' &&
      [row, branchDelta, rowCount].every(Number.isSafeInteger) &&
      row >= 0 &&
      row < rowCount &&
      branchDelta >= 0 &&
      branchDelta <= 65535,
    'Invalid opcode flow coordinates',
  );
  const location = (target) => ({
    targetRow: target,
    targetStatus: target < rowCount ? 'within-list' : target === rowCount ? 'one-past-list' : 'outside-list',
  });
  const next = row + 1,
    skipped = next + branchDelta;
  const result = {
    classification: 'unknown-opcode-semantics',
    complete: false,
    edges: [],
    dispatch: { preIncrementedPC: next, evidence: SCRIPT_FLOW_EVIDENCE.dispatch },
    serializedSkipCandidate: {
      ...location(skipped),
      formula: 'row + 1 + unsigned branchPC',
      semanticsProvenForThisOpcode: false,
      note: 'A serialized number is not proof that this opcode takes this edge.',
    },
  };
  const edge = (condition, target, evidence, extra = {}) => ({
    condition,
    ...location(target),
    evidence,
    evidenceKind: 'native-static',
    ...extra,
  });
  if (type === 'OpCheckValue') {
    result.classification = 'proven-conditional-skip';
    result.edges = [
      edge('comparison succeeds', next, SCRIPT_FLOW_EVIDENCE.checkValue),
      edge('comparison false or operand resolution fails', skipped, SCRIPT_FLOW_EVIDENCE.checkValue),
    ];
    result.serializedSkipCandidate.semanticsProvenForThisOpcode = true;
    result.note = 'Operand values and runtime reachability are not evaluated.';
  } else if (type === 'OpStartUp') {
    result.classification = 'proven-once-per-placement-startup-guard';
    result.edges = [
      edge(
        'placement +0x38 flag mask 0x8 not set: set it and enter block',
        next,
        SCRIPT_FLOW_EVIDENCE.startUp,
      ),
      edge('placement +0x38 flag mask 0x8 already set: skip block', skipped, SCRIPT_FLOW_EVIDENCE.startUp),
    ];
    result.serializedSkipCandidate.semanticsProvenForThisOpcode = true;
    result.note = 'This is a placement flag, not a global once-only guarantee or runtime observation.';
  } else if (type === 'OpAbstractFlow') {
    result.classification = 'proven-immediate-skip-with-dynamic-stack-unwind';
    result.immediatePCUpdate = edge(
      'before execution-stack callbacks',
      skipped,
      SCRIPT_FLOW_EVIDENCE.abstractFlow,
    );
    result.dynamicContinuation =
      'Unwinds 24-byte execution frames and invokes saved opcode +0xe0 callbacks; callbacks may change PC.';
    result.serializedSkipCandidate.semanticsProvenForThisOpcode = true;
  } else if (type === 'OpStartSequence') {
    result.classification = 'proven-sequence-start-with-dynamic-frame';
    result.edges = [
      edge(
        'required operand resolution or sequence creation fails',
        skipped,
        SCRIPT_FLOW_EVIDENCE.startSequence,
      ),
    ];
    result.dynamicContinuation =
      'Success creates the sequence and pushes an execution frame; this is not a statically resolved next-script edge.';
    result.frameEvidence = SCRIPT_FLOW_EVIDENCE.pushFrame;
    result.serializedSkipCandidate.semanticsProvenForThisOpcode = true;
  } else if (type === 'OpCheckMembership') {
    result.classification = 'proven-membership-conditional-skip';
    result.edges = [
      edge('membership predicate succeeds', next, SCRIPT_FLOW_EVIDENCE.checkMembership),
      edge(
        'membership predicate false or operand resolution fails',
        skipped,
        SCRIPT_FLOW_EVIDENCE.checkMembership,
      ),
    ];
    result.serializedSkipCandidate.semanticsProvenForThisOpcode = true;
    result.note = 'Full set conversion, selected membership relation and runtime contents are not evaluated.';
  } else if (type === 'OpShutDown') {
    result.classification = 'proven-shutdown-guard-with-execution-frame';
    result.edges = [
      edge('placement +0x38 flag mask 0x2 absent: skip block', skipped, SCRIPT_FLOW_EVIDENCE.shutDown),
      edge(
        'placement +0x38 flag mask 0x2 set: push frame and enter block',
        next,
        SCRIPT_FLOW_EVIDENCE.shutDown,
      ),
    ];
    result.serializedSkipCandidate.semanticsProvenForThisOpcode = true;
    result.dynamicContinuation =
      'Entered block uses an execution frame; later frame callbacks and lifecycle state are not simulated.';
  }
  if (type === 'OpControl')
    result.nativeEffect = {
      evidence: [SCRIPT_FLOW_EVIDENCE.control, SCRIPT_FLOW_EVIDENCE.controlReceiver],
      runtimeValidated: false,
      observation:
        'Resolves LHS and index; null receiver or activity state >=3 skips by branchPC. Eligible receiver state 2 becomes 1; pushes a frame and changes receiver/context.',
      limitation:
        'Receiver availability, dynamic frame continuation and complete control flow are not modeled.',
    };
  if (type === 'OpSpawn')
    result.nativeEffect = {
      evidence: [SCRIPT_FLOW_EVIDENCE.spawn, SCRIPT_FLOW_EVIDENCE.clone],
      runtimeValidated: false,
      observation:
        'For placement templates, clones the template, applies position and facing, registers and activates the clone. Non-placement templates use a separate generic factory/copy branch.',
      limitation:
        'Required template resource closure, operand evaluation, generic non-placement factory semantics and runtime spawn success are not established for authored content.',
    };
  if (type === 'OpSetBehavior')
    result.nativeEffect = {
      evidence: [SCRIPT_FLOW_EVIDENCE.setBehavior],
      runtimeValidated: false,
      observation:
        'Writes placement execution behavior at +0x100 only when selected behavior script +0x38 matches placement script +0xf8.',
      limitation:
        'Matching owner/script binding is necessary; serialized nulls can be populated at runtime and are not simulated here.',
    };
  if (type === 'OpFlowLoop')
    result.nativeEffect = {
      evidence: [SCRIPT_FLOW_EVIDENCE.flowLoop],
      runtimeValidated: false,
      observation:
        'Restores PC from the top execution frame, invokes saved opcode +0xe0 and conditionally unwinds outer frames.',
      limitation:
        'Dynamic loop/frame continuation is not a statically resolved successor edge; complete loop semantics remain unknown.',
    };
  if (type === 'OpRemove')
    result.nativeEffect = {
      evidence: [SCRIPT_FLOW_EVIDENCE.remove],
      runtimeValidated: false,
      observation:
        'Resolves NP; for a SetVariant, clones its set before iteration. Each resolved placement with activity below 3 is passed to native activity transition 0x478240(target, 3); singleton operands follow the same rule.',
      limitation:
        'Does not erase archive objects; the lifecycle/visibility effects of activity transition 3 and runtime NP resolution are not simulated.',
    };
  if (type === 'OpSetValue')
    result.nativeEffect = {
      evidence: [SCRIPT_FLOW_EVIDENCE.setValue],
      runtimeValidated: false,
      observation:
        'Resolves LHS, evaluates RHS through resultFunc +0x28, converts through the selected property type callback +0x98, and calls its setter when conversion succeeds.',
      limitation:
        'Not a raw field store: property conversion, runtime expression functions, setter side effects and failed conversions are not evaluated.',
    };
  return result;
}

function preflight(bytes, expectedSha256) {
  check(
    Buffer.isBuffer(bytes) && bytes.length >= 0x34 && bytes.length <= MAX_SOURCE,
    'Expected bounded IGZ Buffer <=1 GiB',
  );
  check(
    /^[a-f0-9]{64}$/.test(expectedSha256 ?? '') && hash(bytes) === expectedSha256,
    'Explicit source SHA-256 mismatch',
  );
  const first = bytes.readUInt32LE(0x18),
    end = first + bytes.readUInt32LE(0x1c);
  check(first >= 0x224 && end >= first && end <= bytes.length, 'Invalid fixup region');
  let entries = 0,
    blocks = 0;
  for (let at = first; at < end; ) {
    check(at + 16 <= end, 'Truncated fixup header');
    const length = bytes.readUInt32LE(at + 8);
    check(length >= 16 && at + length <= end, 'Invalid fixup extent');
    entries += bytes.readUInt32LE(at + 4);
    blocks++;
    check(entries <= 2_000_000 && blocks <= 256, 'Script graph fixup allocation budget exceeded');
    at += length;
  }
}

export function createScriptGraph(
  bytes,
  {
    expectedSha256,
    metadata,
    scriptIds,
    scriptName,
    maxScripts = 1024,
    maxRows = 100000,
    maxOperandObjects = 4096,
    operandDepth = 3,
  } = {},
) {
  preflight(bytes, expectedSha256);
  check(
    metadata?.executableSha256 === EXECUTABLE_SHA256 && Array.isArray(metadata.classes),
    'Matching native executable metadata required',
  );
  const classes = new Map(metadata.classes.map((c) => [c.name, c]));
  for (const [type, name, offset] of [
    ['tfbScriptInfo', '_opList', 0x28],
    ['tfbScriptInfo', '_masterVarList', 0x30],
    ['OpCode', '_internalFlagsStorage', 0x30],
    ['OpCode', '_branchPC', 0x32],
  ]) {
    check(
      classes.get(type)?.fields.some((f) => f.name === name && f.offset === offset),
      'Required native script field missing: ' + type + '.' + name,
    );
  }
  for (const [name, value, cap] of [
    ['maxScripts', maxScripts, 4096],
    ['maxRows', maxRows, 250000],
    ['maxOperandObjects', maxOperandObjects, 50000],
    ['operandDepth', operandDepth, 6],
  ]) {
    check(
      Number.isSafeInteger(value) && value >= 0 && value <= cap && (value > 0 || name === 'operandDepth'),
      'Invalid bounded option: ' + name,
    );
  }
  check(
    scriptName === undefined ||
      (typeof scriptName === 'string' && scriptName.length > 0 && scriptName.length <= 1024),
    'Invalid scriptName substring',
  );
  check(
    scriptIds === undefined ||
      (Array.isArray(scriptIds) &&
        scriptIds.length > 0 &&
        scriptIds.length <= maxScripts &&
        scriptIds.every((i) => Number.isSafeInteger(i) && i >= 0)),
    'Invalid scriptIds',
  );
  const z = parseIgz(bytes),
    id = (index) => `igz:${expectedSha256}:object:${index}`;
  const name = (o) => z.stringReferencesByOffset.get(o.offset + 0x10)?.value ?? '';
  const object = (o) => ({
    id: id(o.index),
    objectIndex: o.index,
    type: o.type,
    name: name(o),
    fileOffset: o.offset,
    size: o.size,
    sourceBytesSha256: hash(bytes.subarray(o.offset, o.offset + o.size)),
  });
  const externalOffsets = new Map(),
    otherOffsets = new Map();
  for (const kind of ['REXT', 'RNEX', 'RHND', 'RPID'])
    for (const at of z.offsetTables.get(kind)?.offsets ?? []) {
      if (!at) continue;
      const owner = z.objectContaining(at);
      if (owner) {
        const entries = otherOffsets.get(owner.index) ?? [];
        entries.push({ at, kind });
        otherOffsets.set(owner.index, entries);
      }
      externalOffsets.set(at, kind);
    }
  function exnmStringIdentity(entryAt) {
    function string(index) {
      const entry = z.stringEntries[index];
      return entry
        ? {
            stringIndex: index,
            inBounds: true,
            value: entry.value,
            fileOffset: entry.offset,
            byteLength: entry.byteLength,
          }
        : { stringIndex: index, inBounds: false };
    }
    const name = string(z.u32(entryAt)),
      namespace = string(z.u32(entryAt + 4));
    return {
      name,
      namespace,
      status: name.inBounds && namespace.inBounds ? 'decoded-tstr-name-namespace' : 'unresolved-tstr-index',
      evidence: IGZ_LOADER_EVIDENCE,
      objectResolution: 'not-attempted',
    };
  }
  function slot(at) {
    const p = z.pointerReferencesByOffset.get(at);
    if (p) {
      const target = z.objects[p.targetObjectIndex];
      if (target) return { kind: 'local-object', ...object(target) };
      const owner = z.objectContaining(p.targetOffset);
      return {
        kind: owner ? 'object-interior' : 'untyped-data',
        targetFileOffset: p.targetOffset,
        ...(owner ? { ownerObjectId: id(owner.index), interiorOffset: p.targetOffset - owner.offset } : {}),
      };
    }
    const special = z.specialRelocationsByOffset.get(at);
    if (special)
      return {
        kind: 'runtime-initializer',
        runtimeAction: special.runtimeAction,
        evidence: special.evidenceId,
      };
    check(at >= 0 && at + 8 <= bytes.length, 'Reference slot exceeds source');
    const raw = bytes.readBigUInt64LE(at),
      rawHex = bytes.subarray(at, at + 8).toString('hex'),
      relocation = externalOffsets.get(at);
    if (relocation) {
      if (relocation === 'REXT' || relocation === 'RNEX') {
        const table = relocation === 'REXT' ? 'EXID' : 'EXNM',
          index = raw & 0x7fffffffffffffffn,
          fixup = z.fixupMap.get(table);
        const inBounds =
          !!fixup && index < BigInt(fixup.count) && fixup.dataOffset + (Number(index) + 1) * 8 <= fixup.end;
        const entryAt = inBounds ? fixup.dataOffset + Number(index) * 8 : null;
        const builtin =
          inBounds && table === 'EXID' ? nativeBuiltinIdentity(z.u32(entryAt), z.u32(entryAt + 4)) : null;
        return {
          kind: 'external-reference',
          relocation,
          table,
          indexDecimal: index.toString(),
          rawHex,
          inBounds,
          crossArtifactResolution: 'not-attempted',
          ...(inBounds
            ? {
                entryFileOffset: entryAt,
                rawEntryHex: bytes.subarray(entryAt, entryAt + 8).toString('hex'),
                ...(table === 'EXID'
                  ? { nameId: z.u32(entryAt), namespaceHash: z.u32(entryAt + 4) }
                  : { stringIdentity: exnmStringIdentity(entryAt) }),
              }
            : {}),
          ...(builtin ? { nativeBuiltinIdentity: builtin } : {}),
        };
      }
      return { kind: 'uninterpreted-relocation', relocation, rawHex };
    }
    return { kind: raw === 0n ? 'null' : 'unresolved-slot', rawHex };
  }
  function localFieldMetadata(o, offset) {
    const result = [],
      visited = new Set();
    let type = o.type;
    while (type && !visited.has(type)) {
      visited.add(type);
      const c = classes.get(type);
      if (!c) break;
      result.push(
        ...c.fields
          .filter((f) => f.offset === offset && offset > 0)
          .map((f) => ({
            name: f.name,
            declaringClass: c.name,
            ...(c.evidence ? { evidence: c.evidence } : {}),
          })),
      );
      type = c.parent;
    }
    return result;
  }
  function declaredPointerFields(o) {
    const result = [],
      visited = new Set();
    let type = o.type;
    while (type && !visited.has(type)) {
      visited.add(type);
      const c = classes.get(type);
      if (!c) break;
      for (const field of c.fields)
        if (SCRIPT_POINTER_FIELDS.has(field.name) && field.offset > 0 && field.offset + 8 <= o.size) {
          result.push({
            name: field.name,
            declaringClass: c.name,
            fieldOffset: field.offset,
            fileOffset: o.offset + field.offset,
            target: slot(o.offset + field.offset),
            ...(c.evidence ? { evidence: c.evidence } : {}),
          });
        }
      type = c.parent;
    }
    return result;
  }
  function references(o) {
    const s = z.summarizeObject(o),
      entries = new Map();
    for (const p of [...s.pointerReferences, ...s.specialRelocations])
      entries.set(p.offset, {
        fileOffset: p.offset,
        fieldOffset: p.fieldOffset,
        fields: localFieldMetadata(o, p.fieldOffset),
        target: slot(p.offset),
      });
    for (const r of s.stringReferences)
      entries.set(r.offset, {
        fileOffset: r.offset,
        fieldOffset: r.fieldOffset,
        fields: localFieldMetadata(o, r.fieldOffset),
        target: { kind: 'string', stringIndex: r.stringIndex, value: r.value },
      });
    for (const r of otherOffsets.get(o.index) ?? [])
      entries.set(r.at, {
        fileOffset: r.at,
        fieldOffset: r.at - o.offset,
        fields: localFieldMetadata(o, r.at - o.offset),
        target: slot(r.at),
      });
    for (const r of s.tmhnReferences)
      entries.set(r.offset, {
        fileOffset: r.offset,
        fieldOffset: r.fieldOffset,
        target: { kind: 'tmhn-reference', tableIndex: r.tableIndex, evidence: r.evidenceId },
      });
    return [...entries.values()].sort((a, b) => a.fileOffset - b.fileOffset);
  }
  function list(o) {
    check(o && o.size >= 0x28, 'Expected observed object-reference list header');
    const count = z.u32(o.offset + 0xc);
    check(count <= maxRows, 'List count exceeds graph row budget');
    if (!count) return [];
    check(
      z.u32(o.offset + 0x10) >= count && z.u32(o.offset + 0x18) >= count * 8,
      'Object list count exceeds capacity or serialized array span',
    );
    const p = z.pointerReferencesByOffset.get(o.offset + 0x20);
    check(p, 'Nonempty object list lacks ordinary data pointer');
    z.resolvePointer(p.encoded, count * 8);
    return Array.from({ length: count }, (_, index) => ({
      index,
      fileOffset: p.targetOffset + index * 8,
      target: slot(p.targetOffset + index * 8),
    }));
  }
  function scalar(o, declaringClass, fieldName, offset, encoding) {
    const c = classes.get(declaringClass),
      f = c?.fields.find((f) => f.name === fieldName && f.offset === offset);
    check(f && offset > 0, 'Required native field missing: ' + declaringClass + '.' + fieldName);
    const width = encoding === 'uint16le' ? 2 : 4;
    check(offset + width <= o.size, 'Native field exceeds serialized object: ' + o.type + '.' + fieldName);
    const value =
      encoding === 'uint16le'
        ? bytes.readUInt16LE(o.offset + offset)
        : encoding === 'int32le'
          ? bytes.readInt32LE(o.offset + offset)
          : bytes.readUInt32LE(o.offset + offset);
    return {
      name: fieldName,
      declaringClass,
      fileOffset: o.offset + offset,
      fieldOffset: offset,
      encoding,
      value,
      ...(c.evidence ? { evidence: c.evidence } : {}),
    };
  }
  function fields(o, isOpcode = false) {
    const output = isOpcode
      ? [
          scalar(o, 'OpCode', '_internalFlagsStorage', 0x30, 'uint16le'),
          scalar(o, 'OpCode', '_branchPC', 0x32, 'uint16le'),
        ]
      : [];
    if (o.type === 'OpUserBehavior') output.push(scalar(o, o.type, '_thisPC', 0x34, 'int32le'));
    if (o.type === 'OpDefineMacro')
      output.push(scalar(o, 'OpAbstractDefinition', '_thisPC', 0x40, 'int32le'));
    if (o.type === 'ValueInfo')
      output.push(
        scalar(o, o.type, '_value', 0x40, 'uint32le'),
        scalar(o, o.type, '_resetValue', 0x30, 'uint32le'),
      );
    if (o.type === 'RHSValueStack')
      output.push(
        scalar(o, o.type, '_value', 0x40, 'uint32le'),
        scalar(o, o.type, '_properties', 0x30, 'int32le'),
      );
    const operator =
      o.type === 'OpCheckValue'
        ? ['OpAbstractCheckValue', '_relOperator', 'RelOp']
        : o.type === 'OpChangeMembership'
          ? ['OpChangeMembership', '_combineOp', 'Combiner']
          : o.type === 'OpCheckMembership'
            ? ['OpCheckMembership', '_membershipOp', 'MembershipTest']
            : null;
    if (operator) {
      const s = scalar(o, operator[0], operator[1], 0x40, 'uint32le'),
        enumeration = metadata.enums?.find((e) => e.name === operator[2]);
      output.push({
        ...s,
        enumeration: operator[2],
        enumName: enumeration?.values.find((v) => v.value === s.value)?.name ?? null,
        ...(enumeration?.evidence ? { enumEvidence: enumeration.evidence } : {}),
      });
    }
    if (o.type === 'ValueRHSVariant') {
      const s = scalar(o, o.type, '_arithOperator', 0x18, 'int32le'),
        enumeration = metadata.enums?.find((e) => e.name === 'ArithOp');
      output.push({
        ...s,
        enumeration: 'ArithOp',
        enumName: enumeration?.values.find((v) => v.value === s.value)?.name ?? null,
        ...(enumeration?.evidence ? { enumEvidence: enumeration.evidence } : {}),
      });
    }
    return output;
  }
  function directLiteral(o) {
    if (
      o.type !== 'ValueRHSVariant' ||
      o.size !== 0x38 ||
      bytes.readInt32LE(o.offset + 0x18) !== -1 ||
      slot(o.offset + 0x30).kind !== 'null' ||
      slot(o.offset + 0x28).kind !== 'null'
    )
      return null;
    const operand = slot(o.offset + 0x10),
      rhs = z.objects[operand.objectIndex];
    if (
      operand.kind !== 'local-object' ||
      rhs?.type !== 'RHSValueStack' ||
      rhs.size !== 0x48 ||
      z.u32(rhs.offset + 0xc) !== 0 ||
      z.u32(rhs.offset + 0x30) !== 0
    )
      return null;
    // Requiring all properties zero is stricter than the native funcRHS test;
    // no unverified bit mask or result-function pointer is interpreted here.
    const payload = scalar(rhs, rhs.type, '_value', 0x40, 'uint32le');
    return {
      kind: 'native-static-direct-literal',
      operandObjectId: id(rhs.index),
      rawUint32: payload.value,
      payloadFileOffset: payload.fileOffset,
      type: slot(rhs.offset + 0x38),
      nativeSelector: '0x470e70',
      nativeGetter: '0x48e630',
      runtimeValidated: false,
      conversionApplied: false,
      evidence: [
        'ev_2834b716a4acd86c1241f5da4d2f5484442ec8896fe9791f14cb609373dc3b1c',
        'ev_d574b616d9d13a985395c1eb1db06faa21ddb4858a74930528aa23dabe905521',
      ],
      limitation:
        'Only NO_OP, empty RHSValueStack, zero properties and null serialized conditioner/resultFunc are admitted. The native getter copies raw32 plus type; destination conversion and runtime state are not evaluated.',
    };
  }
  const available = z.objects.filter((o) => o.type === 'tfbScriptInfo');
  const selected = available.filter(
    (o) =>
      (!scriptIds || scriptIds.includes(o.index)) &&
      (!scriptName || name(o).toLowerCase().includes(scriptName.toLowerCase())),
  );
  check(selected.length > 0, 'No tfbScriptInfo matches the requested selection');
  check(selected.length <= maxScripts, 'Selected scripts exceed maxScripts; select a smaller set');
  if (scriptIds)
    check(
      scriptIds.every((i) => selected.some((o) => o.index === i)),
      'Requested script ID is missing or excluded by the name filter',
    );
  const selectedIds = new Set(selected.map((o) => o.index));
  const owners = new Map(selected.map((o) => [o.index, []]));
  function isPlacement(type) {
    const seen = new Set();
    while (type && !seen.has(type)) {
      if (type === 'Placement') return true;
      seen.add(type);
      type = classes.get(type)?.parent;
    }
    return false;
  }
  const placementField = classes
    .get('Placement')
    ?.fields.find((f) => f.name === '_script' && f.offset === 0xf8);
  if (placementField)
    for (const o of z.objects)
      if (isPlacement(o.type) && o.size >= 0x100) {
        const target = z.pointerReferencesByOffset.get(o.offset + 0xf8)?.targetObjectIndex;
        if (selectedIds.has(target))
          owners.get(target).push({
            ...object(o),
            relationship: 'Placement._script',
            fieldOffset: 0xf8,
            fileOffsetOfReference: o.offset + 0xf8,
            runtimeActive: 'unknown',
            inheritanceBasis: 'native metadata parent chain only',
          });
      }
  let totalRows = 0;
  const operandSeeds = new Set(),
    allRowIds = new Set(),
    scripts = selected.map((o) => {
      check(o.size === classes.get('tfbScriptInfo').size, 'tfbScriptInfo native/MTSZ size mismatch');
      const opReference = slot(o.offset + 0x28),
        opList = z.objects[opReference.objectIndex];
      check(
        opReference.kind === 'local-object' && opList?.type === 'OpCodeList',
        'Script _opList does not resolve to local OpCodeList',
      );
      const items = list(opList);
      totalRows += items.length;
      check(totalRows <= maxRows, 'Selected opcode rows exceed maxRows');
      const masterVariables = slot(o.offset + 0x30);
      if (masterVariables.kind === 'local-object') operandSeeds.add(masterVariables.objectIndex);
      const rows = items.map((item) => {
        const op = z.objects[item.target.objectIndex];
        check(
          item.target.kind === 'local-object' && op && op.size >= 0x38,
          'Opcode row must target a local object large enough for OpCode storage',
        );
        allRowIds.add(op.index);
        const refs = references(op);
        for (const r of refs) if (r.target.kind === 'local-object') operandSeeds.add(r.target.objectIndex);
        const attributes = fields(op, true),
          branchDelta = attributes.find((f) => f.name === '_branchPC').value;
        return {
          row: item.index,
          listSlotFileOffset: item.fileOffset,
          ...object(op),
          attributes,
          references: refs,
          declaredPointerFields: declaredPointerFields(op),
          controlFlow: describeOpcodeFlow(op.type, item.index, branchDelta, items.length),
        };
      });
      return {
        ...object(o),
        opcodeList: object(opList),
        masterVariables,
        owners: owners.get(o.index),
        rows,
        ownerCoverage:
          'Direct local Placement._script references in native-metadata-known placement classes only; not all runtime instances.',
      };
    });
  const queue = [...operandSeeds].map((index) => ({ index, depth: 0 })),
    visited = new Set(),
    operandObjects = [],
    omitted = new Set();
  let depthLimitedReferences = 0,
    unexpandedUntypedReferences = 0;
  for (let head = 0; head < queue.length; head++) {
    const { index, depth } = queue[head];
    if (visited.has(index)) continue;
    visited.add(index);
    const o = z.objects[index];
    if (!o || allRowIds.has(index) || o.type === 'tfbScriptInfo' || o.type === 'OpCodeList') continue;
    if (operandObjects.length >= maxOperandObjects) {
      omitted.add(index);
      continue;
    }
    const refs = references(o);
    // Only the observed common object-reference list shape is expanded; other
    // arrays (scalar/vector buffers etc.) remain explicit untyped data.
    const listEntries = OBSERVED_REFERENCE_ARRAY_TYPES.has(o.type) ? list(o) : null;
    unexpandedUntypedReferences += refs.filter(
      (r) =>
        ['untyped-data', 'object-interior'].includes(r.target.kind) &&
        !(listEntries && r.fieldOffset === 0x20),
    ).length;
    const literal = directLiteral(o);
    const row = {
      ...object(o),
      attributes: fields(o),
      references: refs,
      declaredPointerFields: declaredPointerFields(o),
      expansionDepth: depth,
      ...(literal ? { directLiteral: literal } : {}),
      ...(listEntries
        ? {
            listEntries,
            listLayoutBasis:
              'observed reference-array header count +0xc / pointer +0x20; stack evaluation unknown',
          }
        : {}),
    };
    operandObjects.push(row);
    const children = [...refs, ...(listEntries ?? [])].filter((r) => r.target.kind === 'local-object');
    for (const r of children) {
      if (depth < operandDepth && !isPlacement(o.type))
        queue.push({ index: r.target.objectIndex, depth: depth + 1 });
      else depthLimitedReferences++;
    }
  }
  const opcodeCounts = {},
    flowCounts = {};
  for (const s of scripts)
    for (const row of s.rows) {
      opcodeCounts[row.type] = (opcodeCounts[row.type] ?? 0) + 1;
      flowCounts[row.controlFlow.classification] = (flowCounts[row.controlFlow.classification] ?? 0) + 1;
    }
  return {
    schema: 'skylanders-script-graph-v1',
    source: { sha256: expectedSha256, size: bytes.length },
    executableSha256: EXECUTABLE_SHA256,
    evidenceKind: 'serialized-structure-with-selected-native-static-flow',
    runtimeValidated: false,
    semanticsComplete: false,
    executableScriptSourceRecovered: false,
    selection: {
      scriptIds: scriptIds ?? null,
      scriptName: scriptName ?? null,
      matchMode: 'case-insensitive-name-substring-and-exact-object-index',
      availableScripts: available.length,
    },
    counts: {
      scripts: scripts.length,
      rows: totalRows,
      owners: scripts.reduce((n, s) => n + s.owners.length, 0),
      operandObjects: operandObjects.length,
      opcodeCounts,
      flowCounts,
    },
    budgets: {
      maxScripts,
      maxRows,
      maxOperandObjects,
      operandDepth,
      omittedOperandObjects: omitted.size,
      depthLimitedReferences,
      unexpandedUntypedReferences,
      operandExpansionComplete:
        omitted.size === 0 && depthLimitedReferences === 0 && unexpandedUntypedReferences === 0,
    },
    dispatch: {
      nativeProcedure: '0x477fd0',
      evidence: SCRIPT_FLOW_EVIDENCE.dispatch,
      observation:
        'VM increments PC before dispatching opcode vtable +0xd0; flow procedures can subsequently change it.',
    },
    scripts,
    operandObjects,
    limitations: [
      'Not original .ai source, a complete VM emulator, a runtime trace, or a safe script compiler.',
      'Only exact opcode implementations explicitly listed as proven have flow edges; unknown names/subclasses do not imply semantics.',
      'A row can execute under dynamic behavior/sequence stacks. Pre-increment and branch candidates do not establish runtime reachability.',
      'External EXID/EXNM references remain unresolved; names, hashes, flags and scalar values are not evaluated as gameplay behavior.',
      'Exact known native builtin pairs may have identity annotations; these are not local-object resolution or evaluated runtime values.',
      'Offset-zero virtual metadata fields are never decoded as serialized data. Internal flag bits are retained without guessed meanings.',
      'Operand traversal is bounded and excludes expansion through placements into models. All reached references retain source locations even at the frontier.',
      'Direct serialized placement ownership does not prove activation, spawned instances or every owner class.',
      'Does not rewrite game data, register a new chapter, validate imported geometry/collision/resources, or prove a level playable.',
    ],
  };
}

export function exportScriptGraph({ source, executable, output, ...options }) {
  check(
    [source, executable, output].every((s) => typeof s === 'string' && s.length > 0),
    'Explicit source, executable and new output required',
  );
  const fd = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    check(before.isFile() && before.size <= MAX_SOURCE, 'Expected regular source <=1 GiB');
    const bytes = fs.readFileSync(fd),
      graph = createScriptGraph(bytes, { ...options, metadata: extractMetadata(executable) });
    const now = fs.fstatSync(fd),
      current = fs.lstatSync(source);
    check(
      !current.isSymbolicLink() &&
        current.dev === before.dev &&
        current.ino === before.ino &&
        now.size === before.size &&
        now.mtimeMs === before.mtimeMs &&
        now.ctimeMs === before.ctimeMs,
      'Source changed during script graph export',
    );
    const data = Buffer.from(JSON.stringify(graph) + '\n');
    check(data.length <= MAX_OUTPUT, 'Graph exceeds 64 MiB output budget; select fewer scripts');
    fs.writeFileSync(output, data, { flag: 'wx', mode: 0o600 });
    check(hash(fs.readFileSync(output)) === hash(data), 'Graph output readback mismatch');
    return {
      output: path.resolve(output),
      sha256: hash(data),
      size: data.length,
      source: graph.source,
      counts: graph.counts,
      budgets: graph.budgets,
      runtimeValidated: false,
      semanticsComplete: false,
    };
  } finally {
    fs.closeSync(fd);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2),
      options = {},
      flags = new Map([
        ['--source', 'source'],
        ['--elf', 'executable'],
        ['--output', 'output'],
        ['--expect-sha256', 'expectedSha256'],
        ['--script-name', 'scriptName'],
        ['--max-scripts', 'maxScripts'],
        ['--max-rows', 'maxRows'],
        ['--max-operand-objects', 'maxOperandObjects'],
        ['--operand-depth', 'operandDepth'],
      ]);
    while (args.length) {
      const flag = args.shift();
      check(args.length > 0, 'Missing option value');
      if (flag === '--script-id') {
        options.scriptIds ??= [];
        options.scriptIds.push(Number(args.shift()));
        continue;
      }
      const key = flags.get(flag);
      check(key && options[key] === undefined, 'Unknown or duplicate option: ' + flag);
      const value = args.shift();
      options[key] = key.startsWith('max') || key === 'operandDepth' ? Number(value) : value;
    }
    console.log(JSON.stringify(exportScriptGraph(options), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}
