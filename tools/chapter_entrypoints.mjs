#!/usr/bin/env node
// Read-only, source-bound chapter title/load pairing. No chapter insertion.
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
const MAX_FILE = 256 * 1024 * 1024;
const SET_REFERENCE_EXECUTE = 'ev_c3fe69571e63c15f7493e9fa271e59e889854fd6ac6c11cf582cdb47845c547c';
const STRING_POSTLOAD = 'ev_d5331c43aeaadcbbff8d89bf8123a0efba6c744e246a14eb01239bc8db9b4edd';
const RVTB_CALLBACK_ORDER = 'ev_e4efcca476e72dea97ca79ba07af045ce80540d37ac391aae79acaf3757f3109';
const LANGUAGE_CURSOR_SETUP = 'ev_6ac0f127420b57fa405f8529bf180541024cfd1e07c3d6964f0c95c656619c8f';

export function decodeUtf16Dictionary(bytes, baseFileOffset = 0) {
  check(
    Buffer.isBuffer(bytes) && bytes.length <= 64 * 1024 * 1024 && bytes.length % 2 === 0,
    'Expected bounded even-length UTF-16LE dictionary',
  );
  check(Number.isSafeInteger(baseFileOffset) && baseFileOffset >= 0, 'Invalid dictionary file offset');
  const decoder = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true }),
    result = [];
  let start = 0;
  for (let at = 0; at < bytes.length; at += 2)
    if (bytes.readUInt16LE(at) === 0) {
      check(result.length < 1000000, 'Dictionary entry budget exceeded');
      result.push({
        ordinal: result.length,
        fileOffset: baseFileOffset + start,
        byteLength: at - start,
        text: decoder.decode(bytes.subarray(start, at)),
      });
      start = at + 2;
    }
  check(start === bytes.length, 'Dictionary ends without a UTF-16 NUL terminator');
  return result;
}

export function createChapterEntrypoints({
  registry,
  global,
  initializer,
  language,
  expectedHashes,
  metadata,
}) {
  check(
    registry?.schema === 'skylanders-chapter-registry-v1' && registry.executableSha256 === EXECUTABLE_SHA256,
    'Matching chapter registry required',
  );
  check(metadata?.executableSha256 === EXECUTABLE_SHA256, 'Matching executable metadata required');
  const field = (type, name, expected) => {
    const c = metadata.classes.find((c) => c.name === type),
      f = c?.fields.find((f) => f.name === name);
    check(f?.offset === expected && c.evidence, `Native field metadata required: ${type}.${name}`);
    return c;
  };
  const setReference = field('OpSetReference', '_LHS', 0x38);
  field('OpSetReference', '_RHS', 0x40);
  field('OpSetReference', '_indexRHS', 0x48);
  const languageClass = field('LanguagePackInfo', '_stringDict', 0x28);
  const stringClass = field('StringInfo', '_unicodeText', 0x30);
  const contexts = {};
  for (const [key, bytes] of Object.entries({ global, initializer, language })) {
    check(Buffer.isBuffer(bytes) && bytes.length <= MAX_FILE, `Expected bounded source Buffer: ${key}`);
    const sha256 = hash(bytes);
    check(
      /^[a-f0-9]{64}$/.test(expectedHashes?.[key] ?? '') && expectedHashes[key] === sha256,
      `Source SHA-256 mismatch: ${key}`,
    );
    if (key !== 'language')
      check(registry.sources?.[key]?.sha256 === sha256, `Registry/source mismatch: ${key}`);
    contexts[key] = { key, bytes, sha256, z: parseIgz(bytes) };
  }
  const gc = contexts.global,
    ic = contexts.initializer,
    lc = contexts.language;
  const label = (c, o) =>
    c.z.stringReferencesByOffset.get(o.offset + (o.type === 'OpCreateVariable' ? 0x38 : 0x10))?.value ?? '';
  const identify = (c, o) => ({
    source: c.key,
    id: `igz:${c.sha256}:object:${o.index}`,
    objectIndex: o.index,
    type: o.type,
    name: label(c, o),
    fileOffset: o.offset,
    size: o.size,
  });
  const pointed = (c, o, offset) =>
    c.z.objects[c.z.pointerReferencesByOffset.get(o.offset + offset)?.targetObjectIndex];
  function localFromRegistry(c, entry) {
    check(
      entry?.source === c.key && Number.isSafeInteger(entry.objectIndex),
      'Expected registry local object',
    );
    const o = c.z.objects[entry.objectIndex];
    check(
      o && entry.type === o.type && entry.id === identify(c, o).id && entry.name === label(c, o),
      'Registry object identity mismatch',
    );
    return o;
  }
  const exid = ic.z.fixupMap.get('EXID'),
    externalSlots = new Set(ic.z.offsetTables.get('REXT')?.offsets ?? []);
  function slot(c, at) {
    const p = c.z.pointerReferencesByOffset.get(at),
      o = c.z.objects[p?.targetObjectIndex];
    if (o) return { slotFileOffset: at, kind: 'local-object', ...identify(c, o) };
    if (c !== ic || !externalSlots.has(at))
      return { slotFileOffset: at, kind: 'unresolved', rawHex: c.bytes.subarray(at, at + 8).toString('hex') };
    const index = Number(c.z.u64(at) & 0x7fffffffffffffffn);
    check(Number.isSafeInteger(index) && index >= 0 && index < exid.count, 'External index outside EXID');
    const entry = registry.externalReferences[index],
      exAt = exid.dataOffset + index * 8;
    check(
      entry?.nameId === c.z.u32(exAt) && entry.namespaceHash === c.z.u32(exAt + 4),
      'Registry EXID mismatch',
    );
    const target = entry.resolution?.target;
    if (target?.source === 'global' && target.kind === 'local-object') {
      const resolved = localFromRegistry(gc, target);
      return { slotFileOffset: at, kind: 'resolved-external', exidIndex: index, ...identify(gc, resolved) };
    }
    return {
      slotFileOffset: at,
      kind: 'unresolved-external',
      exidIndex: index,
      nameId: entry.nameId,
      namespaceHash: entry.namespaceHash,
    };
  }
  function list(c, o) {
    check(o && /(?:Stack|List)$/.test(o.type) && o.size >= 0x28, 'Expected bounded list/stack');
    const count = c.z.u32(o.offset + 0xc),
      p = c.z.pointerReferencesByOffset.get(o.offset + 0x20);
    check(count <= 100000, 'List count budget exceeded');
    if (!count) return [];
    check(p, 'Nonempty list has no data pointer');
    c.z.resolvePointer(BigInt(p.encoded), count * 8);
    return Array.from({ length: count }, (_, i) => slot(c, p.targetOffset + i * 8));
  }
  const packs = lc.z.objects.filter((o) => o.type === 'LanguagePackInfo');
  check(
    packs.length === 1 && packs[0].size === languageClass.size,
    'Expected one native-sized LanguagePackInfo',
  );
  const pack = packs[0],
    data = lc.z.pointerReferencesByOffset.get(pack.offset + 0x30),
    byteLength = lc.z.u32(pack.offset + 0x28);
  check(data && byteLength <= 64 * 1024 * 1024, 'Missing or oversized language dictionary');
  lc.z.resolvePointer(BigInt(data.encoded), byteLength);
  const strings = decodeUtf16Dictionary(
    lc.bytes.subarray(data.targetOffset, data.targetOffset + byteLength),
    data.targetOffset,
  );
  const stringObjects = gc.z.objects.filter((o) => o.type === 'StringInfo' && !label(gc, o).startsWith('^'));
  check(
    stringObjects.length === strings.length && stringObjects.every((o) => o.size === stringClass.size),
    'StringInfo/UTF-16 dictionary count or size mismatch; no partial ordinal mapping is allowed',
  );
  const translations = new Map(
    stringObjects.map((o, i) => [
      o.index,
      {
        ...strings[i],
        source: 'language',
        assignment: 'native RVTB-order StringInfo post-load cursor; supplied corresponding language pack',
        runtimeValidated: false,
        postLoadEvidence: STRING_POSTLOAD,
        callbackOrderEvidence: RVTB_CALLBACK_ORDER,
      },
    ]),
  );

  const sets = ['Level_AdventureTitles', 'Level_Loads'].map((name) => {
    const found = registry.titleSets.filter((s) => s.name === name);
    check(found.length === 1, 'Expected unique chapter set: ' + name);
    const o = localFromRegistry(gc, found[0]),
      members = pointed(gc, o, 0x30);
    check(members?.type === 'ScriptSetList', 'Chapter set lacks ScriptSetList');
    return { object: identify(gc, o), members: list(gc, members) };
  });
  check(sets[0].members.length === sets[1].members.length, 'Title/load set lengths differ');
  const referenceRows = registry.statements
    .filter((s) => s.macro === 'Global - Set Up Adventure Data' && s.type === 'OpSetReference')
    .map((row) => {
      const o = localFromRegistry(ic, row);
      check(o.size === setReference.size, 'OpSetReference size mismatch');
      const lhs = pointed(ic, o, 0x38),
        rhs = pointed(ic, o, 0x40),
        index = pointed(ic, o, 0x48);
      return {
        row: row.row,
        opcode: identify(ic, o),
        lhs: list(ic, lhs),
        rhs: list(ic, rhs),
        index: index ? identify(ic, index) : null,
        fieldEvidence: setReference.evidence,
        executionEvidence: SET_REFERENCE_EXECUTE,
      };
    });
  const selectors = sets.map((s) =>
    referenceRows.filter((r) => r.rhs.length === 1 && r.rhs[0].id === s.object.id),
  );
  check(
    selectors.every((a) => a.length === 1),
    'Expected unique initializer reference selection for both chapter sets',
  );
  const titleSelection = selectors[0][0],
    loadSelection = selectors[1][0];
  check(
    titleSelection.index?.id && titleSelection.index.id === loadSelection.index?.id,
    'Title/load index expressions differ',
  );
  const indexObject = ic.z.objects[titleSelection.index.objectIndex],
    indexStack = pointed(ic, indexObject, 0x10);
  const indexOperands = indexStack ? list(ic, indexStack) : [];
  check(
    indexObject.type === 'ValueRHSVariant' &&
      indexOperands.length === 1 &&
      indexOperands[0].type === 'OpLoopValue',
    'Expected shared loop-index RHS expression',
  );
  const membershipClass = field('OpChangeMembership', '_LHS', 0x38);
  field('OpChangeMembership', '_combineOp', 0x40);
  field('OpChangeMembership', '_RHS', 0x48);
  const loadMembershipStatements = registry.statements
    .filter((s) => s.macro === 'Global - Set Up Adventure Data' && s.type === 'OpChangeMembership')
    .flatMap((row) => {
      const o = localFromRegistry(ic, row),
        lhs = list(ic, pointed(ic, o, 0x38));
      if (lhs.at(-1)?.name !== 'level loads') return [];
      const rhs = list(ic, pointed(ic, o, 0x48)).map((entry) => ({
        ...entry,
        ...(entry.source === 'global' && translations.has(entry.objectIndex)
          ? { text: translations.get(entry.objectIndex) }
          : {}),
      }));
      return [
        {
          row: row.row,
          opcode: identify(ic, o),
          lhs,
          rhs,
          operationValue: ic.z.u32(o.offset + 0x40),
          fieldEvidence: membershipClass.evidence,
          association:
            'Serialized membership operands only; macro-return and dynamic references are not evaluated.',
        },
      ];
    });
  const pairs = sets[0].members.map((title, setIndex) => {
    const load = sets[1].members[setIndex];
    check(title.type === 'StringInfo' && load.type === 'StringInfo', 'Chapter set member is not StringInfo');
    const titleText = translations.get(title.objectIndex),
      loadText = translations.get(load.objectIndex);
    check(titleText && loadText, 'Chapter member absent from dictionary mapping');
    const storyIncludes = registry.adventureOrder.flatMap((s, i) =>
      s.references.some((r) => (r.kind === 'local-object' ? r : r.resolution?.target)?.id === title.id)
        ? [{ statementRow: s.row, opcodeId: s.opcodeId, includeOrdinal: i, operation: s.operation }]
        : [],
    );
    const safeLoadName = /^[a-zA-Z0-9_]+$/.test(loadText.text);
    return {
      setIndex,
      title,
      titleText,
      load,
      loadText,
      storyIncludes,
      archivePathCandidates: safeLoadName
        ? ['bld', 'arc'].map((ext) => `level/${loadText.text.toLowerCase()}.${ext}`)
        : [],
      archivePathBasis:
        'load string lowercased plus level directory/extension; candidate, not observed file-open',
      chapterNumber: null,
    };
  });
  return {
    schema: 'skylanders-chapter-entrypoints-v1',
    executableSha256: EXECUTABLE_SHA256,
    sources: Object.fromEntries(
      Object.entries(contexts).map(([k, c]) => [k, { sha256: c.sha256, size: c.bytes.length }]),
    ),
    language: {
      object: identify(lc, pack),
      languageId: lc.z.u32(pack.offset + 0x24),
      dictionaryFileOffset: data.targetOffset,
      dictionaryByteLength: byteLength,
      stringCount: strings.length,
      fieldEvidence: languageClass.evidence,
      mappingStatus:
        'native two-pass RVTB callback order and sequential StringInfo cursor verified statically',
      callbackOrderEvidence: RVTB_CALLBACK_ORDER,
      cursorSetupEvidence: LANGUAGE_CURSOR_SETUP,
      sourceAssociation:
        'Caller supplies the language pack belonging to this source archive; automatic archive association is not inferred.',
    },
    pairing: {
      titleSet: sets[0].object,
      loadSet: sets[1].object,
      titleSelection,
      loadSelection,
      sameIndexExpression: titleSelection.index,
      indexOperands,
      status: 'static shared-index assignment; no VM or chapter-select execution performed',
    },
    pairs,
    loadMembershipStatements,
    runtimeValidated: false,
    chapterInsertionSupported: false,
    limitations: [
      'String dictionary assignment follows verified native callback order, assuming the supplied corresponding language pack is selected; no runtime language load was captured.',
      'Include ordinal is not asserted to be a displayed chapter number; startup branches and the complete VM are not evaluated.',
      'Archive names are candidates, not a decoded final loader/open path or a dependency closure.',
      'Localized UI resources, unlock/completion logic, save-bit allocation and a playable extra chapter need separate validation.',
    ],
  };
}

export function exportChapterEntrypoints({
  registry,
  global,
  initializer,
  language,
  expectedHashes,
  executable,
  output,
}) {
  check(
    [registry, global, initializer, language, executable, output].every((x) => typeof x === 'string'),
    'Registry, three sources, ELF and new output required',
  );
  const fds = [],
    snapshots = {};
  try {
    for (const [key, filename] of Object.entries({ registry, global, initializer, language })) {
      const fd = fs.openSync(
        filename,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
      );
      fds.push(fd);
      const stat = fs.fstatSync(fd);
      check(stat.isFile() && stat.size <= MAX_FILE, 'Expected bounded regular source');
      const bytes = fs.readFileSync(fd);
      check(hash(bytes) === expectedHashes?.[key], 'Source SHA-256 mismatch: ' + key);
      snapshots[key] = { fd, filename, stat, bytes };
    }
    const result = createChapterEntrypoints({
      registry: JSON.parse(snapshots.registry.bytes.toString('utf8')),
      ...Object.fromEntries(['global', 'initializer', 'language'].map((k) => [k, snapshots[k].bytes])),
      expectedHashes,
      metadata: extractMetadata(executable),
    });
    result.registrySource = { sha256: expectedHashes.registry, size: snapshots.registry.bytes.length };
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
        'Source changed during entrypoint export',
      );
    }
    const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
    check(bytes.length <= 16 * 1024 * 1024, 'Entrypoint report exceeds budget');
    fs.writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
    check(hash(fs.readFileSync(output)) === hash(bytes), 'Output readback mismatch');
    return {
      output: path.resolve(output),
      sha256: hash(bytes),
      size: bytes.length,
      pairs: result.pairs.length,
      storyIncludes: result.pairs.reduce((n, p) => n + p.storyIncludes.length, 0),
      languageStrings: result.language.stringCount,
    };
  } finally {
    fds.forEach((fd) => fs.closeSync(fd));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2),
      options = { expectedHashes: {} };
    const flags = new Map(
      ['registry', 'global', 'initializer', 'language', 'output'].map((k) => [`--${k}`, k]),
    );
    flags.set('--elf', 'executable');
    while (args.length) {
      const flag = args.shift();
      check(args.length, 'Missing option value');
      const key = flags.get(flag),
        hashKey = /^--(registry|global|initializer|language)-sha256$/.exec(flag)?.[1];
      if (hashKey) {
        check(!options.expectedHashes[hashKey], 'Duplicate hash');
        options.expectedHashes[hashKey] = args.shift();
      } else {
        check(key && options[key] === undefined, 'Unknown/duplicate option');
        options[key] = args.shift();
      }
    }
    console.log(JSON.stringify(exportChapterEntrypoints(options)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
