#!/usr/bin/env node
// Read-only cross-file chapter references, bounded to the verified PS4 build.
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
const hash = (b) => createHash('sha256').update(b).digest('hex');
const HANDLE_EVIDENCE = 'ev_60e1a32a3592e55b483b7cc367db4824bdabe601462d80c8530f4d7703568d6f';
const LOADER_EVIDENCE = 'ev_ec2b575e84cb4f06b1aba8c75f1ce0d82f7db4a2852eab4ef8b43300b51f0e8b';
const GLOBAL_NAMESPACE = 0x2694be8e; // native string hash of lowercase "global.bld"
const MAX_FILE = 256 * 1024 * 1024;

export function globalHandleLocation(nameId, namespaceHash, bootstrapCount, globalCount) {
  check(
    [nameId, namespaceHash, bootstrapCount, globalCount].every(
      (x) => Number.isSafeInteger(x) && x >= 0 && x <= 0xffffffff,
    ),
    'Expected bounded unsigned handle/count',
  );
  if (namespaceHash !== GLOBAL_NAMESPACE) return { status: 'unresolved-other-namespace' };
  if (nameId === 0) return { status: 'unresolved-null-or-cycle' };
  const base = bootstrapCount + 1,
    source = nameId < base ? 'bootstrap' : 'global';
  const rootIndex = nameId < base ? nameId - 1 : nameId - base;
  if (rootIndex >= (source === 'bootstrap' ? bootstrapCount : globalCount))
    return { status: 'unresolved-root-index' };
  return { status: 'located', source, rootIndex };
}

export function createRegistryView({ bootstrap, global, initializer, expectedHashes, metadata }) {
  check(metadata?.executableSha256 === EXECUTABLE_SHA256, 'Matching native executable metadata required');
  const membership = metadata.classes.find((c) => c.name === 'OpChangeMembership');
  const combiners = metadata.enums.find((e) => e.name === 'Combiner');
  check(
    membership?.fields.some((f) => f.name === '_LHS' && f.offset === 0x38) &&
      membership.fields.some((f) => f.name === '_combineOp' && f.offset === 0x40) &&
      membership.fields.some((f) => f.name === '_RHS' && f.offset === 0x48) &&
      combiners,
    'Verified membership metadata required',
  );
  const contexts = {};
  for (const [key, buffer] of Object.entries({ bootstrap, global, initializer })) {
    check(Buffer.isBuffer(buffer) && buffer.length <= MAX_FILE, 'Expected bounded IGZ Buffer: ' + key);
    const digest = hash(buffer);
    check(
      /^[a-f0-9]{64}$/.test(expectedHashes?.[key] ?? '') && digest === expectedHashes[key],
      'Source SHA-256 mismatch: ' + key,
    );
    const z = parseIgz(buffer),
      external = new Set(z.offsetTables.get('REXT')?.offsets ?? []);
    contexts[key] = { key, z, buffer, sha256: digest, external };
  }
  const label = (c, o) =>
    c.z.stringReferencesByOffset.get(o.offset + (o.type === 'OpCreateVariable' ? 0x38 : 0x10))?.value ?? '';
  const object = (c, o) => ({
    source: c.key,
    id: `igz:${c.sha256}:object:${o.index}`,
    objectIndex: o.index,
    type: o.type,
    name: label(c, o),
    fileOffset: o.offset,
    size: o.size,
  });
  function list(c, o) {
    check(o && o.size >= 0x28, 'Expected serialized object-list layout');
    const count = c.z.u32(o.offset + 0xc),
      pointer = c.z.pointerReferencesByOffset.get(o.offset + 0x20);
    check(count <= 100000, 'List count exceeds registry budget');
    if (!count) return [];
    check(pointer, 'Nonempty list requires an ordinary data pointer');
    c.z.resolvePointer(BigInt(pointer.encoded), count * 8);
    return Array.from({ length: count }, (_, i) => pointer.targetOffset + i * 8);
  }
  function root(c) {
    const f = c.z.fixupMap.get('ROOT');
    check(f?.count === 1, 'Exactly one ROOT is required');
    const o = c.z.objectsByOffset.get(c.z.resolvePointer(c.z.u32(f.dataOffset), 0x28).offset);
    check(o?.type === 'igObjectList', 'ROOT must target igObjectList');
    return { object: object(c, o), slots: list(c, o) };
  }
  const roots = { bootstrap: root(contexts.bootstrap), global: root(contexts.global) };
  const base = roots.bootstrap.slots.length + 1;
  function externalEntry(c, index) {
    const f = c.z.fixupMap.get('EXID');
    check(
      f && index >= 0 && index < f.count && f.dataOffset + (index + 1) * 8 <= f.end,
      'EXID index outside table',
    );
    return {
      index,
      fileOffset: f.dataOffset + index * 8,
      nameId: c.z.u32(f.dataOffset + index * 8),
      namespaceHash: c.z.u32(f.dataOffset + index * 8 + 4),
    };
  }
  function handle(entry, visited = new Set()) {
    const location = globalHandleLocation(
      entry.nameId,
      entry.namespaceHash,
      base - 1,
      roots.global.slots.length,
    );
    if (location.status !== 'located') return location;
    if (visited.has(entry.nameId) || visited.size >= 64) return { status: 'unresolved-null-or-cycle' };
    const { source, rootIndex } = location;
    const next = new Set(visited);
    next.add(entry.nameId);
    const target = slot(contexts[source], roots[source].slots[rootIndex], next);
    return {
      status: target.kind === 'local-object' ? 'resolved-static-native-registration' : 'unresolved-root-slot',
      source,
      rootIndex,
      target,
      evidence: HANDLE_EVIDENCE,
    };
  }
  function slot(c, at, visited = new Set()) {
    const p = c.z.pointerReferencesByOffset.get(at);
    if (p) {
      const o = c.z.objects[p.targetObjectIndex];
      return o
        ? { kind: 'local-object', ...object(c, o) }
        : { kind: 'untyped-data', targetFileOffset: p.targetOffset };
    }
    const raw = c.z.u64(at);
    if (c.external.has(at)) {
      const index = raw & 0x7fffffffffffffffn;
      check(index <= 0xffffffffn, 'EXID slot index exceeds budget');
      const entry = externalEntry(c, Number(index));
      return {
        kind: 'external-object',
        rawHex: c.buffer.subarray(at, at + 8).toString('hex'),
        ...entry,
        resolution: handle(entry, visited),
        loaderEvidence: LOADER_EVIDENCE,
      };
    }
    return {
      kind: raw === 0n ? 'null' : 'unresolved-slot',
      rawHex: c.buffer.subarray(at, at + 8).toString('hex'),
    };
  }
  const targetObject = (s) =>
    s.kind === 'local-object'
      ? s
      : s.resolution?.target?.kind === 'local-object'
        ? s.resolution.target
        : null;
  const stack = (c, o) => ({
    ...object(c, o),
    entries: list(c, o).map((at) => ({ fileOffset: at, ...slot(c, at) })),
  });
  const globalHandles = Object.entries(roots).flatMap(([source, r]) =>
    r.slots.map((at, index) => ({
      namespaceHash: GLOBAL_NAMESPACE,
      nameId: index + (source === 'bootstrap' ? 1 : base),
      rootIndex: index,
      source,
      rootSlotFileOffset: at,
      target: slot(contexts[source], at),
    })),
  );
  const ic = contexts.initializer,
    exid = ic.z.fixupMap.get('EXID');
  const externalReferences = Array.from({ length: exid?.count ?? 0 }, (_, i) => {
    const entry = externalEntry(ic, i);
    return { ...entry, resolution: handle(entry) };
  });
  const titleSets = [];
  for (const name of ['Level_AdventureTitles', 'Level_Loads']) {
    const matches = contexts.global.z.objects.filter(
      (o) => o.type === 'ScriptSet' && label(contexts.global, o) === name,
    );
    check(matches.length === 1, 'Expected unique global chapter set: ' + name);
    const o = matches[0],
      pointer = contexts.global.z.pointerReferencesByOffset.get(o.offset + 0x30);
    const members = contexts.global.z.objects[pointer?.targetObjectIndex];
    check(members?.type === 'ScriptSetList', 'Chapter set must point to ScriptSetList');
    titleSets.push({
      ...object(contexts.global, o),
      layoutBasis: 'observed ScriptSet +0x30 to ScriptSetList',
      members: stack(contexts.global, members),
    });
  }
  const scripts = ic.z.objects.filter(
    (o) => o.type === 'tfbScriptInfo' && label(ic, o).endsWith('/Init_Setup_Adventure.ai'),
  );
  check(scripts.length === 1, 'Expected unique Init_Setup_Adventure script');
  const code = ic.z.objects[ic.z.pointerReferencesByOffset.get(scripts[0].offset + 0x28)?.targetObjectIndex];
  check(code?.type === 'OpCodeList', 'Adventure initializer requires OpCodeList');
  let macro = null;
  const statements = list(ic, code).map((at, row) => {
    const reference = slot(ic, at),
      o = ic.z.objects[reference.objectIndex];
    check(reference.kind === 'local-object' && o, 'Opcode row must be a local object');
    if (o.type === 'OpDefineMacro') macro = label(ic, o);
    const result = {
      row,
      macro,
      ...object(ic, o),
      rawObjectHex: ic.buffer.subarray(o.offset, o.offset + o.size).toString('hex'),
      references: ic.z.summarizeObject(o),
    };
    if (o.type === 'OpChangeMembership') {
      check(o.size === membership.size, 'Membership MTSZ/native size mismatch');
      const lhs = ic.z.objects[ic.z.pointerReferencesByOffset.get(o.offset + 0x38)?.targetObjectIndex];
      const rhs = ic.z.objects[ic.z.pointerReferencesByOffset.get(o.offset + 0x48)?.targetObjectIndex];
      check(lhs?.type === 'SetStack' && rhs?.type === 'ScriptGroupStack', 'Unsupported membership operands');
      const value = ic.z.u32(o.offset + 0x40);
      result.membership = {
        operation: { value, name: combiners.values.find((x) => x.value === value)?.name ?? null },
        lhs: stack(ic, lhs),
        rhs: stack(ic, rhs),
        fieldEvidence: membership.evidence,
        enumEvidence: combiners.evidence,
      };
    }
    return result;
  });
  const adventureOrder = statements
    .filter(
      (s) =>
        s.macro === 'Global - Set Up Adventure Data' &&
        s.membership?.lhs.entries.length === 1 &&
        targetObject(s.membership.lhs.entries[0])?.name === 'adv order',
    )
    .map((s) => ({
      row: s.row,
      opcodeId: s.id,
      operation: s.membership.operation,
      references: s.membership.rhs.entries,
    }));
  return {
    schema: 'skylanders-chapter-registry-v1',
    executableSha256: EXECUTABLE_SHA256,
    sources: Object.fromEntries(
      Object.entries(contexts).map(([k, c]) => [k, { sha256: c.sha256, size: c.buffer.length }]),
    ),
    registration: {
      namespace: 'global.bld',
      namespaceHash: GLOBAL_NAMESPACE,
      bootstrapRootCount: base - 1,
      globalFirstNameId: base,
      formula: 'bootstrap index + 1; global index + bootstrap root count + 1',
      evidence: HANDLE_EVIDENCE,
    },
    globalHandles,
    externalReferences,
    titleSets,
    script: object(ic, scripts[0]),
    statements,
    adventureOrder,
    runtimeValidated: false,
    chapterInsertionSupported: false,
    limitations: [
      'Native startup proves handle registration; this is static resolution, not a captured runtime registry.',
      'Adventure-order statements retain script order and named set operations; the entire script VM is not evaluated.',
      'Root/title-set order is not asserted to be UI chapter order; localized titles and final level paths are not decoded here.',
      'Other handle namespaces, script-dependent unlocks, resource loading, save-bit allocation and new chapter insertion remain separate work.',
    ],
  };
}

export function exportChapterRegistry({
  bootstrap,
  global,
  initializer,
  expectedHashes,
  executable,
  output,
}) {
  check(
    [bootstrap, global, initializer, executable, output].every((x) => typeof x === 'string'),
    'Three sources, executable and new output required',
  );
  const fds = [],
    snapshots = {};
  try {
    for (const [key, filename] of Object.entries({ bootstrap, global, initializer })) {
      const fd = fs.openSync(
        filename,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
      );
      fds.push(fd);
      const stat = fs.fstatSync(fd);
      check(stat.isFile() && stat.size <= MAX_FILE, 'Expected bounded regular source');
      snapshots[key] = { fd, filename, stat, bytes: fs.readFileSync(fd) };
    }
    const result = createRegistryView({
      ...Object.fromEntries(Object.entries(snapshots).map(([k, s]) => [k, s.bytes])),
      expectedHashes,
      metadata: extractMetadata(executable),
    });
    for (const s of Object.values(snapshots)) {
      const now = fs.fstatSync(s.fd),
        current = fs.lstatSync(s.filename);
      check(
        !current.isSymbolicLink() &&
          current.ino === s.stat.ino &&
          current.dev === s.stat.dev &&
          now.size === s.stat.size &&
          now.mtimeMs === s.stat.mtimeMs &&
          now.ctimeMs === s.stat.ctimeMs,
        'Source changed during registry export',
      );
    }
    const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
    check(bytes.length <= 64 * 1024 * 1024, 'Registry JSON exceeds 64 MiB');
    fs.writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
    check(hash(fs.readFileSync(output)) === hash(bytes), 'Output readback mismatch');
    return {
      output: path.resolve(output),
      sha256: hash(bytes),
      size: bytes.length,
      registration: result.registration,
      globalHandles: result.globalHandles.length,
      externalReferences: result.externalReferences.length,
      resolvedExternalReferences: result.externalReferences.filter(
        (e) => e.resolution.status === 'resolved-static-native-registration',
      ).length,
      adventureOrderStatements: result.adventureOrder.length,
    };
  } finally {
    fds.forEach((fd) => fs.closeSync(fd));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2),
      options = { expectedHashes: {} },
      flags = new Map([
        ['--bootstrap', 'bootstrap'],
        ['--global', 'global'],
        ['--initializer', 'initializer'],
        ['--elf', 'executable'],
        ['--output', 'output'],
      ]);
    while (args.length) {
      const flag = args.shift();
      check(args.length, 'Missing option value');
      const key = flags.get(flag),
        hashKey = /^--(bootstrap|global|initializer)-sha256$/.exec(flag)?.[1];
      if (hashKey) {
        check(!options.expectedHashes[hashKey], 'Duplicate hash');
        options.expectedHashes[hashKey] = args.shift();
      } else {
        check(key && options[key] === undefined, 'Unknown/duplicate option');
        options[key] = args.shift();
      }
    }
    console.log(JSON.stringify(exportChapterRegistry(options)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
