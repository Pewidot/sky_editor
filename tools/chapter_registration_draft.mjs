#!/usr/bin/env node
// Paired, non-deployable chapter-registration draft. No archive/game installation.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseIgz } from './igz.mjs';
import { appendIgz, inspectAppendTarget } from './igz_append.mjs';
import { decodeUtf16Dictionary } from './chapter_entrypoints.mjs';

const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const hash = (b) => createHash('sha256').update(b).digest('hex');
const align = (n) => Math.ceil(n / 4) * 4;
const MAX_FILE = 256 * 1024 * 1024,
  MAX_DICT = 64 * 1024 * 1024;
export const REGISTRATION_DRAFT_PROFILE = Object.freeze({
  globalSha256: 'c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c',
  englishSha256: '826712f658a803b1f03419ef571cd3b48c157e440d4eef43ac5f2613a6265e22',
  bootstrapSha256: 'a56888faa11114d848daf16e74e1d41560a03ff15adbde55249355a23c1534e9',
  bootstrapRootCount: 25,
  globalRootCount: 3022,
  dictionaryStrings: 802,
  stringInfoSize: 0x48,
  languageInfoSize: 0x38,
  englishLanguageId: 6,
});
export const REGISTRATION_ARCHIVE_PROFILE = Object.freeze({
  sha256: 'f1358f785eb6fb2826adbf028aa30ebdbd1b02b32b3dc3d8f3c70dbd634bcb4f',
  size: 13283554,
  memberCount: 11,
  globalMemberIndex: 6,
  globalMemberSize: 41032288,
});
// Exact original archive members, independently extracted with iga_extract.
// Order follows the original archive inventory, not language IDs or locale names.
export const REGISTRATION_LANGUAGE_PROFILES = Object.freeze(
  [
    {
      member: 'FRENCH.pak',
      index: 0,
      size: 161266,
      languageId: 8,
      sha256: '0b108adc1b854fb8c42ef4e9e685f09a5fa65ce7047802e9a5e1ee5e2d22e7f0',
    },
    {
      member: 'SPANISH.pak',
      index: 1,
      size: 162312,
      languageId: 21,
      sha256: '1d4724c04d5cac4caa59da4ad46bfd0420cb0ba2bdbad1a60ff3d17720a9baee',
    },
    {
      member: 'SWEDISH.pak',
      index: 2,
      size: 157640,
      languageId: 23,
      sha256: '46fe8842c7e2f1d70145a48356c842b0a55d4195024726273b9ac2ca4b956f78',
    },
    {
      member: 'FINNISH.pak',
      index: 3,
      size: 159070,
      languageId: 7,
      sha256: 'f16c25a821f12fc5b4153bb95f40d2aaf348c6c7046e08d2fd5d3a2bcfe94265',
    },
    {
      member: 'DUTCH.pak',
      index: 4,
      size: 159448,
      languageId: 5,
      sha256: 'cd2c5678400a5dfebfe2e8e8fd5a800bbda797d35809ca39cb8641effcb3a5e9',
    },
    {
      member: 'NORWEGIAN.pak',
      index: 5,
      size: 157358,
      languageId: 17,
      sha256: 'd5505473162722c78930287af654d0987308b20cb4efd78a1e7a8591dbf74905',
    },
    {
      member: 'DANISH.pak',
      index: 7,
      size: 157766,
      languageId: 4,
      sha256: 'b1c0ae8ca87f054695fc36b73869c6eec08d526d821a350834162e5ae8713bac',
    },
    {
      member: 'ENGLISH.pak',
      index: 8,
      size: 157668,
      languageId: 6,
      sha256: '826712f658a803b1f03419ef571cd3b48c157e440d4eef43ac5f2613a6265e22',
    },
    {
      member: 'GERMAN.pak',
      index: 9,
      size: 159842,
      languageId: 9,
      sha256: '987aa27d2806007be0397b2603a752f3f3eb9f9e80572e45c2e076487e8f2144',
    },
    {
      member: 'ITALIAN.pak',
      index: 10,
      size: 162430,
      languageId: 14,
      sha256: '14c84e620d7dab809875a573d64a14b8826d714c6b3fa3a6aeaa8e48073d9370',
    },
  ].map(Object.freeze),
);
const EVIDENCE = Object.freeze({
  stringPostload: 'ev_d5331c43aeaadcbbff8d89bf8123a0efba6c744e246a14eb01239bc8db9b4edd',
  callbackOrder: 'ev_e4efcca476e72dea97ca79ba07af045ce80540d37ac391aae79acaf3757f3109',
  dictionaryLayout: 'ev_59dc599ed20f44f8411e0e19ec5fc0303e8ff7a445f362ce3b00004c71ab0d92',
  listVtables: 'ev_1af4b13090a5a0bdef740ac29b530f5dfdbe96f0ece28b337dda8ca3cac29d52',
  listOwningRelease: 'ev_faca8c4b6942c014242c19968236ba435acc9661f37f4f02660e24170a9182fc',
  loader: 'ev_ec2b575e84cb4f06b1aba8c75f1ce0d82f7db4a2852eab4ef8b43300b51f0e8b',
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
function textBytes(text, label, maximum = 256) {
  check(
    typeof text === 'string' && text.length > 0 && text.length <= maximum && !text.includes('\0'),
    `Invalid ${label}`,
  );
  const bytes = Buffer.from(text + '\0', 'utf16le');
  // JS Buffer encoding otherwise preserves lone UTF-16 surrogates silently.
  check(decodeUtf16Dictionary(bytes)[0].text === text, `Invalid UTF-16 ${label}`);
  return bytes;
}
function stringObjects(z) {
  return z.objects
    .filter((o) => o.type === 'StringInfo')
    .filter((o) => {
      check(o.size === 0x48, 'Unsupported StringInfo size');
      const name = z.stringReferencesByOffset.get(o.offset + 0x10)?.value;
      check(typeof name === 'string', 'StringInfo lacks an RSTT name');
      return !name.startsWith('^');
    });
}

/** Native ASCII-lowercase FNV-1a namespace; non-ASCII bytes are left unchanged.
 * New identifiers are ASCII-only. Existing names are conservatively checked
 * across all global TSTR entries, not merely the StringInfo subset.
 */
export function registrationNameHash(name) {
  check(typeof name === 'string' && !name.includes('\0'), 'Invalid registration hash name');
  let value = 0x811c9dc5;
  for (let byte of Buffer.from(name, 'utf8')) {
    if (byte >= 65 && byte <= 90) byte += 32;
    value = Math.imul(value ^ byte, 0x01000193) >>> 0;
  }
  return value;
}
export function validateNewRegistrationNames(existing, names) {
  check(
    Array.isArray(existing) && existing.length <= 1000000 && Array.isArray(names) && names.length === 2,
    'Expected bounded existing names and two new names',
  );
  const hashes = new Set(existing.map(registrationNameHash));
  return names.map((name) => {
    check(
      typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_ ()-]{0,79}$/.test(name) && name.trim() === name,
      'Invalid new registration name',
    );
    const nameHash = registrationNameHash(name);
    check(!hashes.has(nameHash), 'New registration name has a lowercase FNV-1a collision');
    hashes.add(nameHash);
    return { name, lowercaseFnv1a: nameHash };
  });
}

/** Pure native-order reconstruction. Inserting Default objects before a later
 * pool's StringInfo changes its dictionary ordinal, never its assigned bytes.
 */
export function rebuildStringDictionary(original, rebuilt, dictionary, newTexts) {
  check(
    original?.objects &&
      rebuilt?.objects &&
      Buffer.isBuffer(dictionary) &&
      newTexts instanceof Map &&
      newTexts.size <= 128,
    'Expected parsed graphs, dictionary Buffer and bounded new-text Map',
  );
  const entries = decodeUtf16Dictionary(dictionary),
    oldObjects = stringObjects(original),
    nextObjects = stringObjects(rebuilt);
  check(entries.length === oldObjects.length, 'Original StringInfo/dictionary count mismatch');
  const byEncoded = new Map(
    oldObjects.map((o, i) => [
      o.encoded,
      {
        object: o,
        entry: entries[i],
        bytes: dictionary.subarray(entries[i].fileOffset, entries[i].fileOffset + entries[i].byteLength + 2),
      },
    ]),
  );
  check(byEncoded.size === oldObjects.length, 'Duplicate original encoded StringInfo identity');
  check(
    nextObjects.length === oldObjects.length + newTexts.size,
    'Unexpected StringInfo count in rebuilt graph',
  );
  const pieces = [],
    assignments = [],
    seen = new Set();
  let bytes = 0;
  for (const [ordinal, o] of nextObjects.entries()) {
    check(!seen.has(o.encoded), 'Duplicate encoded StringInfo identity');
    seen.add(o.encoded);
    const old = byEncoded.get(o.encoded);
    let encoded;
    if (old) {
      check(!newTexts.has(o.encoded), 'New text attempts to replace an original StringInfo');
      check(
        original.stringReferencesByOffset.get(old.object.offset + 16).value ===
          rebuilt.stringReferencesByOffset.get(o.offset + 16).value,
        'Original StringInfo name changed',
      );
      encoded = old.bytes;
    } else {
      check(newTexts.has(o.encoded), 'Rebuilt StringInfo has no explicit text');
      encoded = textBytes(newTexts.get(o.encoded), 'new dictionary text');
    }
    bytes += encoded.length;
    check(bytes <= MAX_DICT, 'Rebuilt dictionary exceeds 64 MiB');
    pieces.push(encoded);
    assignments.push({
      encodedObject: o.encoded,
      objectIndex: o.index,
      previousOrdinal: old?.entry.ordinal ?? null,
      ordinal,
      byteLength: encoded.length,
      sha256: hash(encoded),
      originalAssignmentPreserved: !!old,
    });
  }
  check(
    [...byEncoded.keys(), ...newTexts.keys()].every((encoded) => seen.has(encoded)),
    'A StringInfo assignment was removed or ignored',
  );
  return {
    buffer: Buffer.concat(pieces),
    assignments,
    previousCount: oldObjects.length,
    count: nextObjects.length,
  };
}

/** Narrow existing-final-Text-pool rewrite, not a generic IGZ pool writer.
 * Keeps the complete original dictionary allocation; no old bytes are deleted.
 */
export function rebuildEnglishDictionary(input, dictionary, expectedSha256) {
  return rebuildLanguageDictionary(input, dictionary, expectedSha256, 6);
}
export function rebuildPinnedLanguageDictionary(input, dictionary, member, expectedSha256) {
  const profile = REGISTRATION_LANGUAGE_PROFILES.find((p) => p.member === member);
  check(
    profile && expectedSha256 === profile.sha256 && input?.length === profile.size,
    'Unknown or mismatched pinned language profile',
  );
  return rebuildLanguageDictionary(
    input,
    dictionary,
    expectedSha256,
    profile.languageId,
    member.slice(0, -4),
  );
}
export function rebuildLanguageDictionary(
  input,
  dictionary,
  expectedSha256,
  expectedLanguageId,
  expectedName = null,
) {
  check(
    Buffer.isBuffer(input) &&
      input.length <= MAX_FILE &&
      /^[a-f0-9]{64}$/.test(expectedSha256 ?? '') &&
      hash(input) === expectedSha256,
    'Language source SHA-256 mismatch or size limit',
  );
  decodeUtf16Dictionary(dictionary);
  // Reuse the bounded fixup preflight and unknown/unresolved-table rejection.
  inspectAppendTarget(input, expectedSha256);
  const z = parseIgz(input),
    packs = z.objects.filter((o) => o.type === 'LanguagePackInfo'),
    pool = z.descriptors.at(-1);
  check(packs.length === 1 && packs[0].size === 0x38, 'Expected one exact LanguagePackInfo');
  const pack = packs[0],
    data = z.pointerReferencesByOffset.get(pack.offset + 0x30),
    oldLength = z.u32(pack.offset + 0x28);
  check(
    z.u32(pack.offset + 0x24) === expectedLanguageId,
    'Pinned language ID mismatch (English-only helper requires ID 6)',
  );
  if (expectedName !== null)
    check(
      z.stringReferencesByOffset.get(pack.offset + 16)?.value === expectedName,
      'Pinned LanguagePackInfo name mismatch',
    );
  check(
    z.u32(pack.offset + 0x2c) === 0x80000000 && data && z.u64(pack.offset + 0x30) === BigInt(data.encoded),
    'Unsupported language memory flags/pointer',
  );
  check(
    pool.index > 1 &&
      pool.name === 'Text' &&
      !pool.sentinel &&
      pool.offset + pool.dataSize === input.length &&
      pool.alignment === 4,
    'Requires the observed final Text pool',
  );
  check(
    data.targetOffset === pool.offset + 4 && oldLength === pool.dataSize - 4 && z.u32(pool.offset) === 0,
    'Dictionary must occupy the original Text pool after its zero prefix',
  );
  decodeUtf16Dictionary(input.subarray(data.targetOffset, data.targetOffset + oldLength));
  check(!z.objects.some((o) => o.section === pool.index), 'Typed objects in the Text pool are unsupported');
  for (const [kind, table] of z.offsetTables)
    for (const slot of table.offsets)
      check(slot < pool.offset || slot >= input.length, `Unexpected ${kind} relocation inside Text payload`);
  check(
    !z.pointerReferences.some(
      (r) =>
        r.offset !== pack.offset + 0x30 && r.targetOffset >= pool.offset && r.targetOffset < input.length,
    ),
    'Language dictionary has an additional ordinary pointer alias',
  );
  const poolEncoded = (pool.index - 1) * 0x08000000,
    tmhn = z.fixupMap.get('TMHN');
  for (let i = 0; i < (tmhn?.count ?? 0); i++) {
    const at = tmhn.dataOffset + i * 16,
      size = z.u32(at),
      target = z.u32(at + 8);
    check(z.u32(at + 12) === 0, 'Unsupported 64-bit TMHN data pointer');
    check(
      !(target < poolEncoded + pool.dataSize && target + Math.max(1, size) > poolEncoded),
      'Language dictionary has a TMHN data alias',
    );
  }
  for (const [kind, table] of z.offsetTables)
    if (!['RVTB', 'ROOT'].includes(kind))
      for (const slot of table.offsets) {
        const overlaps = slot < pack.offset + 0x38 && slot + 8 > pack.offset + 0x28;
        check(
          !overlaps || (kind === 'ROFS' && slot === pack.offset + 0x30),
          'Language fields have a conflicting relocation',
        );
      }
  const relative = align(pool.dataSize),
    nextSize = relative + dictionary.length;
  check(
    dictionary.length > 0 &&
      dictionary.length <= MAX_DICT &&
      nextSize < 0x08000000 &&
      pool.offset + nextSize <= MAX_FILE,
    'Language output exceeds bounded pool/file size',
  );
  const encoded = (pool.index - 1) * 0x08000000 + relative;
  const buffer = Buffer.concat([input, Buffer.alloc(relative - pool.dataSize), dictionary]);
  const edits = [
    { offset: 0x14 + pool.index * 16 + 8, width: 4, before: pool.dataSize, after: nextSize },
    { offset: pack.offset + 0x28, width: 4, before: oldLength, after: dictionary.length },
    { offset: pack.offset + 0x30, width: 8, before: data.encoded, after: encoded },
  ];
  for (const edit of edits)
    if (edit.width === 8) buffer.writeBigUInt64LE(BigInt(edit.after), edit.offset);
    else buffer.writeUInt32LE(edit.after, edit.offset);
  const allowed = new Set(edits.flatMap((e) => Array.from({ length: e.width }, (_, i) => e.offset + i)));
  for (let i = 0; i < input.length; i++)
    check(input[i] === buffer[i] || allowed.has(i), 'Unrelated language bytes changed');
  const after = parseIgz(buffer),
    nextData = after.pointerReferencesByOffset.get(pack.offset + 0x30);
  check(
    after.objects.length === z.objects.length &&
      nextData.encoded === encoded &&
      after.u32(pack.offset + 0x28) === dictionary.length,
    'Language rebuild metadata mismatch',
  );
  check(
    buffer.subarray(nextData.targetOffset, nextData.targetOffset + dictionary.length).equals(dictionary),
    'Language dictionary readback mismatch',
  );
  return {
    buffer,
    manifest: {
      sourceSha256: expectedSha256,
      outputSha256: hash(buffer),
      previousBytes: input.length,
      bytes: buffer.length,
      previousDictionarySha256: hash(input.subarray(data.targetOffset, data.targetOffset + oldLength)),
      dictionarySha256: hash(dictionary),
      previousDictionaryPreserved: true,
      originalRelocationsUnchanged: true,
      edits,
      pool: { index: pool.index, name: pool.name, previousSize: pool.dataSize, size: nextSize },
    },
  };
}

/** Exact-hash inventory, not a generic archive parser or decompressor. The
 * supplied original archive binds the finite ten-language completeness claim.
 */
export function inspectRegistrationLanguageInventory(archive, expectedSha256) {
  const profile = REGISTRATION_ARCHIVE_PROFILE;
  check(
    Buffer.isBuffer(archive) &&
      archive.length === profile.size &&
      expectedSha256 === profile.sha256 &&
      hash(archive) === profile.sha256,
    'Pinned registration archive SHA-256/size mismatch',
  );
  check(
    archive.readUInt32LE(0) === 0x1a414749 &&
      archive.readUInt32LE(4) === 11 &&
      archive.readUInt32LE(12) === profile.memberCount,
    'Pinned archive header mismatch',
  );
  const namesAt = archive.readUInt32LE(0x28),
    namesLength = archive.readUInt32LE(0x30),
    count = profile.memberCount;
  check(
    namesAt + namesLength === archive.length && namesLength >= count * 4,
    'Pinned archive name span mismatch',
  );
  const names = archive.subarray(namesAt),
    entries = [];
  for (let index = 0; index < count; index++) {
    const relative = names.readUInt32LE(index * 4),
      end = names.indexOf(0, relative),
      descriptor = 0x38 + count * 4 + index * 16;
    check(relative >= count * 4 && end >= relative, 'Invalid pinned archive name');
    const member = names.toString('utf8', relative, end),
      size = archive.readUInt32LE(descriptor + 8),
      language = REGISTRATION_LANGUAGE_PROFILES.find((p) => p.index === index);
    check(
      language
        ? member === language.member && size === language.size
        : index === profile.globalMemberIndex && member === 'level.bld' && size === profile.globalMemberSize,
      'Complete archive member inventory differs from supported profile',
    );
    entries.push({
      index,
      member,
      size,
      start: archive.readUInt32LE(descriptor),
      mode: archive.readUInt32LE(descriptor + 12),
      role: language ? 'language' : 'global',
      ...(language
        ? { languageId: language.languageId, extractedSha256: language.sha256 }
        : { extractedSha256: REGISTRATION_DRAFT_PROFILE.globalSha256 }),
    });
  }
  check(new Set(entries.map((e) => e.member)).size === count, 'Duplicate pinned archive member');
  return {
    sha256: profile.sha256,
    size: profile.size,
    memberCount: count,
    languageCount: REGISTRATION_LANGUAGE_PROFILES.length,
    coverageScope:
      'all language members of this exact original permanent/global.bld only; not other archives or game revisions',
    entries,
  };
}

function completeLanguages(languages, expectedHashes) {
  const names = REGISTRATION_LANGUAGE_PROFILES.map((p) => p.member);
  keys(languages, names, 'language members');
  keys(expectedHashes, names, 'language hashes');
  check(
    names.every((name) => Object.hasOwn(languages, name) && Object.hasOwn(expectedHashes, name)),
    'All ten language members and hashes are required',
  );
}

export function createMultilingualChapterRegistrationDraft(options) {
  keys(
    options,
    [
      'archive',
      'global',
      'languages',
      'expectedHashes',
      'titleName',
      'loadName',
      'titleText',
      'loadText',
      'titleFallback',
    ],
    'multilingual draft',
  );
  const {
    archive,
    global,
    languages,
    expectedHashes,
    titleName,
    loadName,
    titleText,
    loadText,
    titleFallback,
  } = options;
  keys(expectedHashes, ['archive', 'global', 'languages'], 'multilingual source hashes');
  check(
    titleFallback === 'english',
    'Explicit titleFallback: english is required; authored translations are not supplied',
  );
  const inventory = inspectRegistrationLanguageInventory(archive, expectedHashes.archive);
  completeLanguages(languages, expectedHashes.languages);
  for (const p of REGISTRATION_LANGUAGE_PROFILES)
    check(
      Buffer.isBuffer(languages[p.member]) &&
        languages[p.member].length === p.size &&
        expectedHashes.languages[p.member] === p.sha256 &&
        hash(languages[p.member]) === p.sha256,
      `Pinned language source SHA-256/size mismatch: ${p.member}`,
    );
  // Reuse the exact existing global authoring path. Its bytes must not depend
  // on how many language packs are supplied.
  const paired = createChapterRegistrationDraft({
    global,
    language: languages['ENGLISH.pak'],
    expectedHashes: { global: expectedHashes.global, language: expectedHashes.languages['ENGLISH.pak'] },
    titleName,
    loadName,
    titleText,
    loadText,
  });
  const original = parseIgz(global),
    rebuilt = parseIgz(paired.global),
    rebuiltLanguages = {},
    reports = [];
  const newTexts = new Map(paired.manifest.registration.objects.map((o) => [o.encoded, o.text]));
  for (const profile of REGISTRATION_LANGUAGE_PROFILES) {
    const input = languages[profile.member],
      z = parseIgz(input),
      pack = z.objects.find((o) => o.type === 'LanguagePackInfo');
    const ref = z.pointerReferencesByOffset.get(pack?.offset + 0x30);
    check(pack && ref, 'Missing pinned language dictionary');
    const dictionary = input.subarray(ref.targetOffset, ref.targetOffset + z.u32(pack.offset + 0x28));
    const translated = rebuildStringDictionary(original, rebuilt, dictionary, newTexts);
    check(
      translated.previousCount === 802 && translated.count === 804,
      'Pinned multilingual StringInfo count mismatch',
    );
    const result = rebuildPinnedLanguageDictionary(input, translated.buffer, profile.member, profile.sha256);
    if (profile.member === 'ENGLISH.pak')
      check(result.buffer.equals(paired.language), 'All-language English output differs from paired API');
    rebuiltLanguages[profile.member] = result.buffer;
    reports.push({
      member: profile.member,
      archiveIndex: profile.index,
      languageId: profile.languageId,
      titlePolicy:
        profile.languageId === 6 ? 'authored English title' : 'explicit English fallback; not a translation',
      loadPolicy: 'identical nonlocalized load identity in all language packs',
      previousCount: translated.previousCount,
      count: translated.count,
      originalAssignmentsPreserved: translated.assignments.filter((a) => a.originalAssignmentPreserved)
        .length,
      originalOrdinalsShifted: translated.assignments.filter(
        (a) => a.originalAssignmentPreserved && a.ordinal !== a.previousOrdinal,
      ).length,
      assignments: translated.assignments,
      rebuild: result.manifest,
    });
  }
  const manifest = {
    ...paired.manifest,
    schema: 'skylanders-chapter-registration-multilingual-draft-v1',
    languageCoverageComplete: true,
    archiveInventory: inventory,
    authoredTitleLanguage: 'English',
    authoredTitleTranslationsComplete: false,
    titleFallback: 'english',
    sources: {
      archive: { sha256: inventory.sha256, size: archive.length },
      global: paired.manifest.sources.global,
      languages: REGISTRATION_LANGUAGE_PROFILES.map((p) => ({
        member: p.member,
        sha256: p.sha256,
        size: p.size,
        languageId: p.languageId,
      })),
    },
    dictionary: {
      ...paired.manifest.dictionary,
      assignmentTextSource: 'ENGLISH.pak',
      perLanguageAssignments: 'languages[].assignments',
    },
    languages: reports,
    blockers: paired.manifest.blockers
      .filter((text) => !text.startsWith('Only English'))
      .concat([
        'All original global language members have matching dictionaries, but new titles outside English are explicit English fallbacks, not translations.',
        'Coverage is limited to the exact pinned original global archive; no runtime language-switch acceptance is established.',
      ]),
  };
  delete manifest.languageRebuild; // Each language owns its independent rebuild record.
  return { global: paired.global, languages: rebuiltLanguages, manifest };
}

export function createChapterRegistrationDraft(options) {
  keys(
    options,
    ['global', 'language', 'expectedHashes', 'titleName', 'loadName', 'titleText', 'loadText'],
    'draft',
  );
  const { global, language, expectedHashes, titleName, loadName, titleText, loadText } = options;
  for (const [key, buffer, pinned] of [
    ['global', global, REGISTRATION_DRAFT_PROFILE.globalSha256],
    ['language', language, REGISTRATION_DRAFT_PROFILE.englishSha256],
  ])
    check(
      Buffer.isBuffer(buffer) &&
        buffer.length <= MAX_FILE &&
        expectedHashes?.[key] === pinned &&
        hash(buffer) === pinned,
      `Pinned ${key} source SHA-256 mismatch`,
    );
  textBytes(titleText, 'titleText');
  textBytes(loadText, 'loadText', 96);
  check(
    /^Level_[0-9]{3}_[A-Za-z0-9_]+$/.test(loadText),
    'loadText must be a bounded Level_NNN_Name candidate, not a path',
  );
  const g = parseIgz(global),
    l = parseIgz(language),
    target = inspectAppendTarget(global, expectedHashes.global);
  const newNameHashes = validateNewRegistrationNames(g.strings, [titleName, loadName]);
  const pack = l.objects.find((o) => o.type === 'LanguagePackInfo'),
    dictRef = l.pointerReferencesByOffset.get(pack?.offset + 0x30);
  check(pack?.size === 0x38 && dictRef, 'Missing pinned language dictionary');
  const dictionary = language.subarray(
    dictRef.targetOffset,
    dictRef.targetOffset + l.u32(pack.offset + 0x28),
  );
  const dictionaryEntries = decodeUtf16Dictionary(dictionary);
  check(
    dictionaryEntries.length === REGISTRATION_DRAFT_PROFILE.dictionaryStrings &&
      stringObjects(g).length === dictionaryEntries.length,
    'Pinned dictionary/StringInfo count mismatch',
  );
  check(
    !dictionaryEntries.some((s) => s.text.toLowerCase() === loadText.toLowerCase()),
    'Candidate load text already exists',
  );
  const lists = ['Level_AdventureTitles', 'Level_Loads'].map((name) => {
    const sets = g.objects.filter(
      (o) => o.type === 'ScriptSet' && g.stringReferencesByOffset.get(o.offset + 16)?.value === name,
    );
    check(sets.length === 1 && sets[0].size === 0x38, 'Expected unique pinned chapter set');
    const list = g.objects[g.pointerReferencesByOffset.get(sets[0].offset + 0x30)?.targetObjectIndex];
    check(
      list?.type === 'ScriptSetList' && list.size === 0x38 && g.u32(list.offset + 0xc) === 22,
      'Pinned chapter list mismatch',
    );
    return list;
  });
  check(target.roots.length === 1, 'Expected one pinned ROOT');
  const root = g.objectsByOffset.get(g.resolvePointer(target.roots[0]).offset);
  check(
    g.u32(root.offset + 0xc) === REGISTRATION_DRAFT_PROFILE.globalRootCount,
    'Pinned global ROOT count mismatch',
  );
  const type = target.types.find((t) => t.type === 'StringInfo');
  check(type?.size === 0x48, 'Unsupported StringInfo metadata');
  const payload = Buffer.alloc(0x90);
  for (let i = 0; i < 2; i++) {
    const at = i * 0x48;
    payload.writeUInt32LE(type.typeIndex, at);
    // ROOT and one ScriptSetList have statically corroborated owning releases.
    // This is not a runtime test of construction, initialization or teardown.
    payload.writeUInt32LE(2, at + 8);
    payload.writeUInt32LE(target.stringCount + i, at + 16);
  }
  const globalResult = appendIgz(global, {
    expectedSha256: expectedHashes.global,
    appendedDefaultPool: payload,
    appendedObjects: [0, 0x48].map((offset) => ({ offset, type: 'StringInfo' })),
    fixupSlots: { RSTT: [16, 0x58] },
    newStrings: [titleName, loadName],
    rootList: { rootEncoded: root.encoded, appendObjects: [0, 0x48] },
    objectLists: lists.map((list, i) => ({
      listEncoded: list.encoded,
      expectedType: 'ScriptSetList',
      appendObjects: [i * 0x48],
    })),
  });
  const rebuilt = parseIgz(globalResult.buffer),
    newTexts = new Map([
      [target.appendOffset, titleText],
      [target.appendOffset + 0x48, loadText],
    ]);
  const translated = rebuildStringDictionary(g, rebuilt, dictionary, newTexts);
  const languageResult = rebuildEnglishDictionary(language, translated.buffer, expectedHashes.language);
  const firstNameId = REGISTRATION_DRAFT_PROFILE.bootstrapRootCount + 1;
  return {
    global: globalResult.buffer,
    language: languageResult.buffer,
    manifest: {
      schema: 'skylanders-chapter-registration-draft-v1',
      deployable: false,
      runtimeValidated: false,
      languageCoverageComplete: false,
      ownershipVerifiedAtRuntime: false,
      evidence: EVIDENCE,
      sources: {
        global: { sha256: expectedHashes.global, size: global.length },
        language: { sha256: expectedHashes.language, size: language.length },
      },
      requiredUnchangedBootstrap: {
        sha256: REGISTRATION_DRAFT_PROFILE.bootstrapSha256,
        rootCount: REGISTRATION_DRAFT_PROFILE.bootstrapRootCount,
        status: 'not modified; required identity from original registration evidence, not a live-game check',
      },
      registration: {
        previousCount: 22,
        count: 23,
        chapterSelectAdded: false,
        initializerModified: false,
        nameHashCheck: {
          algorithm: 'ASCII-lowercase FNV-1a-32',
          scope: 'all original global TSTR entries plus both new names',
          checkedNames: g.strings.length,
        },
        originalGlobalHandlePositionsPreserved: true,
        originalGlobalNameIdRange: [
          firstNameId,
          firstNameId + REGISTRATION_DRAFT_PROFILE.globalRootCount - 1,
        ],
        objects: [titleName, loadName].map((name, i) => ({
          ...newNameHashes[i],
          text: i ? loadText : titleText,
          encoded: target.appendOffset + i * 0x48,
          objectIndex: globalResult.manifest.appended.objects[i].index,
          globalNameId: firstNameId + REGISTRATION_DRAFT_PROFILE.globalRootCount + i,
          initialReferenceCount: 2,
          ownershipPolicy: 'two statically corroborated owning slots: global ROOT plus one ScriptSetList',
        })),
      },
      dictionary: {
        previousCount: translated.previousCount,
        count: translated.count,
        order: 'rebuilt RVTB StringInfo order, excluding caret-prefixed names',
        originalAssignmentsPreserved: translated.assignments.filter((a) => a.originalAssignmentPreserved)
          .length,
        originalOrdinalsShifted: translated.assignments.filter(
          (a) => a.originalAssignmentPreserved && a.ordinal !== a.previousOrdinal,
        ).length,
        assignments: translated.assignments,
      },
      globalAppend: globalResult.manifest,
      languageRebuild: languageResult.manifest,
      blockers: [
        'Only English has a rebuilt paired dictionary; other language packs are not supplied or rebuilt.',
        'No story-order/init scripts, unlocks, visuals, objectives, save allocation or migration are authored.',
        'Candidate load filename/number is not a registered or collision-free game/save identity.',
        'No playable level archive, resource closure, collision, encounters, completion path or runtime acceptance is provided.',
        'Ownership has static supporting evidence only; new StringInfo lifecycle is not runtime-tested.',
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
  while (at < bytes.length) {
    const n = fs.readSync(fd, bytes, at, Math.min(1024 * 1024, bytes.length - at), at);
    check(n > 0, 'File ended early');
    at += n;
  }
  return bytes;
}
export function writeChapterRegistrationDraft({
  global: globalPath,
  language: languagePath,
  outputDirectory,
  ...request
}) {
  return writeDraftGroup({ global: globalPath, language: languagePath }, outputDirectory, (sources) => {
    const result = createChapterRegistrationDraft({
      ...request,
      global: sources.global,
      language: sources.language,
    });
    return {
      files: [
        ['global.registration-draft.igz', result.global],
        ['ENGLISH.registration-draft.igz', result.language],
      ],
      manifest: result.manifest,
    };
  });
}
export function writeMultilingualChapterRegistrationDraft({
  archive,
  global,
  languages,
  outputDirectory,
  ...request
}) {
  completeLanguages(languages, request.expectedHashes?.languages);
  const sources = {
    archive,
    global,
    ...Object.fromEntries(
      REGISTRATION_LANGUAGE_PROFILES.map((p) => ['language:' + p.member, languages[p.member]]),
    ),
  };
  return writeDraftGroup(sources, outputDirectory, (sources) => {
    const result = createMultilingualChapterRegistrationDraft({
      ...request,
      archive: sources.archive,
      global: sources.global,
      languages: Object.fromEntries(
        REGISTRATION_LANGUAGE_PROFILES.map((p) => [p.member, sources['language:' + p.member]]),
      ),
    });
    return {
      files: [
        ['global.registration-draft.igz', result.global, 'level.bld'],
        ...REGISTRATION_LANGUAGE_PROFILES.map((p) => [
          p.member.slice(0, -4) + '.registration-draft.igz',
          result.languages[p.member],
          p.member,
        ]),
      ],
      manifest: result.manifest,
    };
  });
}
function writeDraftGroup(sourcePaths, outputDirectory, plan) {
  check(
    [...Object.values(sourcePaths), outputDirectory].every((v) => typeof v === 'string' && v.length > 0),
    'Bounded source paths and a new outputDirectory are required',
  );
  const sources = {},
    files = [];
  let directoryStat,
    complete = false;
  outputDirectory = path.resolve(outputDirectory);
  try {
    for (const [key, filename] of Object.entries(sourcePaths)) {
      const sourcePath = path.resolve(filename),
        fd = fs.openSync(
          sourcePath,
          fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
        );
      const entry = (sources[key] = { path: sourcePath, fd });
      entry.stat = fs.fstatSync(fd);
      check(entry.stat.isFile() && entry.stat.size <= MAX_FILE, 'Expected bounded regular source');
      entry.bytes = readAtStart(fd, entry.stat.size);
    }
    const unchanged = () => {
      for (const s of Object.values(sources))
        check(
          same(s.stat, fs.fstatSync(s.fd)) && same(s.stat, fs.lstatSync(s.path)),
          'Source changed during draft creation',
        );
    };
    unchanged();
    const result = plan(Object.fromEntries(Object.entries(sources).map(([key, s]) => [key, s.bytes])));
    unchanged();
    fs.mkdirSync(outputDirectory, { mode: 0o700 });
    directoryStat = fs.lstatSync(outputDirectory);
    const outputRecords = [];
    for (const [name, bytes, member] of result.files) {
      const filename = path.join(outputDirectory, name),
        fd = fs.openSync(filename, 'wx+', 0o600),
        stat = fs.fstatSync(fd);
      files.push({ filename, stat });
      try {
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
        check(
          fs.fstatSync(fd).size === bytes.length && hash(readAtStart(fd, bytes.length)) === hash(bytes),
          'Draft output readback mismatch',
        );
      } finally {
        fs.closeSync(fd);
      }
      check(owned(filename, stat), 'Draft output path changed');
      outputRecords.push({
        path: name,
        sha256: hash(bytes),
        size: bytes.length,
        ...(member ? { archiveMember: member } : {}),
      });
    }
    result.manifest.outputs = outputRecords;
    const manifestFile = path.join(outputDirectory, 'manifest.json'),
      manifestBytes = Buffer.from(JSON.stringify(result.manifest, null, 2) + '\n');
    const fd = fs.openSync(manifestFile, 'wx+', 0o600),
      stat = fs.fstatSync(fd);
    files.push({ filename: manifestFile, stat });
    try {
      fs.writeFileSync(fd, manifestBytes);
      fs.fsyncSync(fd);
      check(
        fs.fstatSync(fd).size === manifestBytes.length &&
          hash(readAtStart(fd, manifestBytes.length)) === hash(manifestBytes),
        'Draft manifest readback mismatch',
      );
    } finally {
      fs.closeSync(fd);
    }
    unchanged();
    check(
      files.every((f) => owned(f.filename, f.stat)) && owned(outputDirectory, directoryStat),
      'Draft output paths changed',
    );
    complete = true;
    return {
      outputDirectory,
      outputs: outputRecords,
      manifest: { path: manifestFile, sha256: hash(manifestBytes) },
      deployable: false,
      runtimeValidated: false,
      languageCoverageComplete: result.manifest.languageCoverageComplete,
    };
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
    check(process.argv.length === 3, 'Usage: node tools/chapter_registration_draft.mjs request.json');
    const filename = process.argv[2],
      stat = fs.lstatSync(filename);
    check(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024,
      'Expected regular request JSON <=1 MiB',
    );
    const request = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (request.mode === 'all-languages') {
      const { mode, ...options } = request;
      console.log(JSON.stringify(writeMultilingualChapterRegistrationDraft(options)));
    } else console.log(JSON.stringify(writeChapterRegistrationDraft(request)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
