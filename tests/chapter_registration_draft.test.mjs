import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseIgz } from '../tools/igz.mjs';
import { appendIgz, inspectAppendTarget } from '../tools/igz_append.mjs';
import { decodeUtf16Dictionary } from '../tools/chapter_entrypoints.mjs';
import {
  REGISTRATION_DRAFT_PROFILE as PROFILE,
  registrationNameHash,
  validateNewRegistrationNames,
  rebuildStringDictionary,
  rebuildEnglishDictionary,
  createChapterRegistrationDraft,
  writeChapterRegistrationDraft,
  REGISTRATION_ARCHIVE_PROFILE as ARCHIVE_PROFILE,
  REGISTRATION_LANGUAGE_PROFILES as LANGUAGES,
  rebuildPinnedLanguageDictionary,
  inspectRegistrationLanguageInventory,
  createMultilingualChapterRegistrationDraft,
  writeMultilingualChapterRegistrationDraft,
} from '../tools/chapter_registration_draft.mjs';
import { makeIgz } from './fixtures/igz_fixture.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const align = (n, a) => Math.ceil(n / a) * a;
const utf16 = (...strings) => Buffer.from(strings.join('\0') + '\0', 'utf16le');
// Independent codec: octal digits hold three data bits; low nibble first.
function pack(values) {
  let previous = 0,
    nibbles = '';
  for (const value of values) {
    const digits = ((value - previous - 4) / 4).toString(8).split('').reverse();
    nibbles += digits.map((d, i) => (Number(d) | (i < digits.length - 1 ? 8 : 0)).toString(16)).join('');
    previous = value;
  }
  if (nibbles.length % 2) nibbles += '0';
  return Buffer.from(nibbles.match(/../g)?.map((pair) => Number.parseInt(pair[1] + pair[0], 16)) ?? []);
}
function block(magic, count, payload) {
  const result = Buffer.alloc(align(16 + payload.length, 4));
  result.write(magic);
  result.writeUInt32LE(count, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(16, 12);
  payload.copy(result, 16);
  return result;
}
function stringBlock(strings) {
  return block(
    'TSTR',
    strings.length,
    Buffer.concat(
      strings.map((s) => {
        const raw = Buffer.from(s + '\0'),
          result = Buffer.alloc(align(raw.length, 2));
        raw.copy(result);
        return result;
      }),
    ),
  );
}
function modifyBlocks(input, callback) {
  const z = parseIgz(input),
    original = z.descriptors[0];
  const blocks = callback(
    z.fixups.map((f) => Buffer.from(input.subarray(f.offset, f.end))),
    z,
  );
  const next = Buffer.concat(blocks),
    delta = next.length - original.dataSize,
    header = Buffer.from(input.subarray(0, original.offset));
  header.writeUInt32LE(blocks.length, 16);
  header.writeUInt32LE(next.length, 0x1c);
  for (const d of z.descriptors.slice(1)) header.writeUInt32LE(d.offset + delta, 0x14 + d.index * 16 + 4);
  return Buffer.concat([header, next, input.subarray(original.offset + original.dataSize)]);
}
function appendPool(input, name, contents) {
  const bytes = Buffer.concat([input, contents]);
  bytes.write(`Default\0${name}\0`, 0x224, 'ascii');
  [8, input.length, contents.length, 4].forEach((n, i) => bytes.writeUInt32LE(n, 0x34 + i * 4));
  return bytes;
}
function stringsInTwoPools() {
  let bytes = makeIgz({
    objects: [
      { type: 'StringInfo', size: 0x48, name: 'ExistingA' },
      { type: 'StringInfo', size: 0x48, name: '^RuntimeOnly' },
    ],
  });
  const later = Buffer.alloc(0x50);
  later.writeUInt32LE(1, 8);
  later.writeUInt32LE(2, 24);
  bytes = appendPool(bytes, 'String', later);
  return modifyBlocks(bytes, (blocks, z) =>
    blocks.map((b) => {
      const kind = b.toString('ascii', 0, 4);
      if (kind === 'TSTR') return stringBlock([...z.strings, 'ExistingB']);
      if (['RVTB', 'RSTT'].includes(kind)) {
        const values = [...z.offsetTables.get(kind).encodedOffsets, 0x08000008 + (kind === 'RSTT' ? 16 : 0)];
        return block(kind, values.length, pack(values));
      }
      return b;
    }),
  );
}
function addTwoStrings(input) {
  const target = inspectAppendTarget(input, sha(input)),
    payload = Buffer.alloc(0x90);
  for (let i = 0; i < 2; i++) {
    payload.writeUInt32LE(1, i * 0x48);
    payload.writeUInt32LE(2, i * 0x48 + 8);
    payload.writeUInt32LE(target.stringCount + i, i * 0x48 + 16);
  }
  return {
    target,
    result: appendIgz(input, {
      expectedSha256: sha(input),
      appendedDefaultPool: payload,
      appendedObjects: [
        { offset: 0, type: 'StringInfo' },
        { offset: 0x48, type: 'StringInfo' },
      ],
      fixupSlots: { RSTT: [16, 0x58] },
      newStrings: ['NewTitle', 'NewLoad'],
      rootList: { rootEncoded: 8, appendObjects: [0, 0x48] },
    }),
  };
}
function englishFixture({ alias = false, tmhn = false } = {}) {
  let bytes = makeIgz({ objects: [{ type: 'LanguagePackInfo', size: 0x38, name: 'ENGLISH' }] });
  const z = parseIgz(bytes),
    info = z.objects[1],
    dictionary = utf16('Old title', '\ufeffOld 🌴 load');
  bytes = appendPool(bytes, 'Text', Buffer.concat([Buffer.alloc(4), dictionary]));
  bytes.writeUInt32LE(6, info.offset + 0x24);
  bytes.writeUInt32LE(dictionary.length, info.offset + 0x28);
  bytes.writeUInt32LE(0x80000000, info.offset + 0x2c);
  bytes.writeBigUInt64LE(0x08000004n, info.offset + 0x30);
  if (alias) bytes.writeBigUInt64LE(0x08000004n, info.offset + 0x18);
  return modifyBlocks(bytes, (blocks, parsed) => {
    const result = blocks.map((b) => {
      if (b.toString('ascii', 0, 4) !== 'ROFS') return b;
      const values = [
        ...parsed.offsetTables.get('ROFS').encodedOffsets,
        info.encoded + 0x30,
        ...(alias ? [info.encoded + 0x18] : []),
      ].sort((a, b) => a - b);
      return block('ROFS', values.length, pack(values));
    });
    if (tmhn) {
      const entry = Buffer.alloc(16);
      entry.writeUInt32LE(dictionary.length, 0);
      entry.writeUInt32LE(0x08000004, 8);
      result.push(block('TMHN', 1, entry));
    }
    return result;
  });
}

test('native lowercase hash matches namespace evidence and rejects real hash collisions', () => {
  assert.equal(registrationNameHash('GLOBAL.bld'), 0x2694be8e);
  assert.equal(registrationNameHash('costarring'), registrationNameHash('liquid'));
  assert.throws(() => validateNewRegistrationNames(['costarring'], ['liquid', 'Another']), /collision/);
  assert.throws(() => validateNewRegistrationNames(['Existing'], ['existing', 'Another']), /collision/);
  assert.throws(() => validateNewRegistrationNames([], ['Same', 'SAME']), /collision/);
  assert.throws(() => validateNewRegistrationNames([], ['Bad/Path', 'Another']), /Invalid/);
  assert.deepEqual(
    validateNewRegistrationNames([], ['AI_Workshop_Title', 'AI_Workshop_Load']).map((n) => n.name),
    ['AI_Workshop_Title', 'AI_Workshop_Load'],
  );
});

test('actual RVTB insertion before later-pool StringInfo preserves every old assignment byte', () => {
  const source = stringsInTwoPools(),
    original = parseIgz(source),
    sourceHash = sha(source);
  const { target, result } = addTwoStrings(source),
    next = parseIgz(result.buffer),
    dictionary = utf16('', '\ufeffA 🌴 later-pool text');
  const translated = rebuildStringDictionary(
    original,
    next,
    dictionary,
    new Map([
      [target.appendOffset, 'Modular Test Island'],
      [target.appendOffset + 0x48, 'Level_900_AIWorkshop'],
    ]),
  );
  assert.deepEqual(
    decodeUtf16Dictionary(translated.buffer).map((e) => e.text),
    ['', 'Modular Test Island', 'Level_900_AIWorkshop', '\ufeffA 🌴 later-pool text'],
  );
  assert.deepEqual(
    translated.assignments.map((a) => a.previousOrdinal),
    [0, null, null, 1],
  );
  assert.equal(translated.assignments[3].encodedObject, 0x08000008);
  assert.equal(translated.assignments[3].objectIndex, original.objects.length + 1);
  assert.equal(translated.assignments[3].sha256, sha(utf16('\ufeffA 🌴 later-pool text')));
  assert.equal(translated.assignments[0].byteLength, 2);
  assert.equal(translated.count, 4);
  assert.equal(translated.previousCount, 2);
  assert.equal(sha(source), sourceHash);
});

test('dictionary rejects missing texts, replaced identities, malformed UTF-16 and changed names', () => {
  const source = stringsInTwoPools(),
    original = parseIgz(source),
    { target, result } = addTwoStrings(source),
    next = parseIgz(result.buffer);
  const valid = new Map([
    [target.appendOffset, 'New title'],
    [target.appendOffset + 0x48, 'New load'],
  ]);
  assert.throws(() => rebuildStringDictionary(original, next, utf16('A'), valid), /count mismatch/);
  assert.throws(
    () =>
      rebuildStringDictionary(original, next, utf16('A', 'B'), new Map([[target.appendOffset, 'Only one']])),
    /Unexpected StringInfo count/,
  );
  assert.throws(
    () =>
      rebuildStringDictionary(
        original,
        next,
        utf16('A', 'B'),
        new Map([
          [original.objects[1].encoded, 'Replace'],
          [target.appendOffset, 'New'],
        ]),
      ),
    /replace an original/,
  );
  assert.throws(
    () => rebuildStringDictionary(original, next, Buffer.from([0, 216, 0, 0, 0, 0]), valid),
    /encoded data|UTF/i,
  );
  for (const invalid of ['', 'nul\0inside', '\ud800', 'x'.repeat(257)]) {
    assert.throws(
      () =>
        rebuildStringDictionary(
          original,
          next,
          utf16('A', 'B'),
          new Map([
            [target.appendOffset, invalid],
            [target.appendOffset + 0x48, 'Valid'],
          ]),
        ),
      /Invalid|encoded data/,
    );
  }
  const changed = { ...next, stringReferencesByOffset: new Map(next.stringReferencesByOffset) };
  changed.stringReferencesByOffset.set(next.objects[1].offset + 16, { value: 'Renamed' });
  assert.throws(() => rebuildStringDictionary(original, changed, utf16('A', 'B'), valid), /name changed/);
});

test('English rewrite appends full dictionary and changes only three declared old spans', () => {
  const source = englishFixture(),
    before = Buffer.from(source),
    z = parseIgz(source),
    dictionary = utf16('Old title', '\ufeffOld 🌴 load', 'New title', 'Level_900_AIWorkshop');
  const result = rebuildEnglishDictionary(source, dictionary, sha(source)),
    next = parseIgz(result.buffer),
    info = next.objects.find((o) => o.type === 'LanguagePackInfo');
  const pointer = next.pointerReferencesByOffset.get(info.offset + 0x30);
  assert.deepEqual(source, before);
  assert.equal(result.manifest.previousDictionaryPreserved, true);
  assert.deepEqual(
    result.buffer.subarray(z.descriptors.at(-1).offset, source.length),
    source.subarray(z.descriptors.at(-1).offset),
  );
  assert.deepEqual(result.buffer.subarray(pointer.targetOffset), dictionary);
  assert.equal(next.u32(info.offset + 0x28), dictionary.length);
  assert.equal(next.u32(info.offset + 0x2c), 0x80000000);
  const allowed = new Set(
    result.manifest.edits.flatMap((e) => Array.from({ length: e.width }, (_, i) => e.offset + i)),
  );
  for (let i = 0; i < source.length; i++)
    if (!allowed.has(i)) assert.equal(result.buffer[i], source[i], `offset ${i}`);
  for (const f of z.fixups)
    assert.deepEqual(result.buffer.subarray(f.offset, f.end), source.subarray(f.offset, f.end));
});

test('English helper rejects pointer and memory-table aliases, unsupported flags and allocation bombs', () => {
  const dictionary = utf16('New');
  for (const [options, error] of [
    [{ alias: true }, /ordinary pointer alias/],
    [{ tmhn: true }, /TMHN data alias/],
  ]) {
    const source = englishFixture(options);
    assert.throws(() => rebuildEnglishDictionary(source, dictionary, sha(source)), error);
  }
  const source = englishFixture(),
    z = parseIgz(source),
    info = z.objects[1];
  for (const [at, value, error] of [
    [info.offset + 0x24, 7, /English/],
    [info.offset + 0x2c, 0, /memory flags/],
    [z.fixupMap.get('RVTB').offset + 4, 2000001, /Excessive source fixup count/],
  ]) {
    const bad = Buffer.from(source);
    bad.writeUInt32LE(value, at);
    assert.throws(() => rebuildEnglishDictionary(bad, dictionary, sha(bad)), error);
  }
  assert.throws(() => rebuildEnglishDictionary(source, dictionary, '0'.repeat(64)), /SHA-256/);
  assert.throws(() => rebuildEnglishDictionary(source, Buffer.from([0]), sha(source)), /even-length/);
});

test('full draft refuses unpinned buffers and unsupported option keys before writes', () => {
  assert.throws(
    () =>
      createChapterRegistrationDraft({
        global: Buffer.alloc(10),
        language: Buffer.alloc(10),
        expectedHashes: { global: PROFILE.globalSha256, language: PROFILE.englishSha256 },
      }),
    /Pinned global/,
  );
  assert.throws(() => createChapterRegistrationDraft({ deployable: true }), /Invalid draft fields/);
});

test('multilingual mode rejects unpinned inventories, profiles and implicit translation claims', () => {
  const source = englishFixture();
  assert.throws(
    () => inspectRegistrationLanguageInventory(Buffer.alloc(0), ARCHIVE_PROFILE.sha256),
    /archive SHA-256/,
  );
  assert.throws(
    () => rebuildPinnedLanguageDictionary(source, utf16('New'), 'GERMAN.pak', sha(source)),
    /pinned language profile/,
  );
  assert.throws(
    () => rebuildPinnedLanguageDictionary(source, utf16('New'), 'UNKNOWN.pak', sha(source)),
    /pinned language profile/,
  );
  assert.throws(
    () => createMultilingualChapterRegistrationDraft({ expectedHashes: {} }),
    /Explicit titleFallback/,
  );
  assert.throws(
    () =>
      writeMultilingualChapterRegistrationDraft({
        languages: { 'ENGLISH.pak': 'unused' },
        expectedHashes: { languages: { 'ENGLISH.pak': PROFILE.englishSha256 } },
      }),
    /All ten/,
  );
  assert.equal(LANGUAGES.length, 10);
  assert.equal(new Set(LANGUAGES.map((p) => p.languageId)).size, 10);
  assert.ok(Object.isFrozen(LANGUAGES) && LANGUAGES.every(Object.isFrozen));
});

const globalPath = process.env.SKYLANDERS_TEST_GLOBAL,
  languagePath = process.env.SKYLANDERS_TEST_ENGLISH;
const real = globalPath && languagePath && fs.existsSync(globalPath) && fs.existsSync(languagePath);
const request = {
  expectedHashes: { global: PROFILE.globalSha256, language: PROFILE.englishSha256 },
  titleName: 'AI_Workshop_Title',
  loadName: 'AI_Workshop_Load',
  titleText: 'Modular Test Island',
  loadText: 'Level_900_AIWorkshop',
};
test(
  'optional private source paired structural draft, exclusive writes and partial-failure cleanup',
  { skip: !real },
  (t) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chapter-registration-draft-test-'));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true })); // This test's unique temporary tree only.
    const originalGlobal = fs.readFileSync(globalPath),
      originalLanguage = fs.readFileSync(languagePath),
      originalStats = [globalPath, languagePath].map((p) => fs.statSync(p));
    const result = createChapterRegistrationDraft({
        ...request,
        global: originalGlobal,
        language: originalLanguage,
      }),
      g = parseIgz(originalGlobal),
      next = parseIgz(result.global);
    assert.equal(result.manifest.deployable, false);
    assert.equal(result.manifest.runtimeValidated, false);
    assert.equal(result.manifest.languageCoverageComplete, false);
    assert.equal(result.manifest.dictionary.count, 804);
    assert.equal(result.manifest.dictionary.originalAssignmentsPreserved, 802);
    assert.equal(result.manifest.registration.count, 23);
    assert.equal(result.manifest.dictionary.originalOrdinalsShifted, 0);
    assert.equal(result.manifest.globalAppend.rootList.count, 3024);
    const rootOld = g.pointerReferencesByOffset.get(g.objects[0].offset + 0x20),
      rootNew = next.pointerReferencesByOffset.get(next.objects[0].offset + 0x20);
    assert.deepEqual(
      result.global.subarray(rootNew.targetOffset, rootNew.targetOffset + 3022 * 8),
      originalGlobal.subarray(rootOld.targetOffset, rootOld.targetOffset + 3022 * 8),
    );
    assert.deepEqual(
      result.manifest.registration.objects.map((o) => o.globalNameId),
      [3048, 3049],
    );
    for (const added of result.manifest.registration.objects) {
      const o = next.objects[added.objectIndex];
      assert.equal(o.encoded, added.encoded);
      assert.equal(next.u32(o.offset + 8), 2);
      assert.equal(next.stringReferencesByOffset.get(o.offset + 16).value, added.name);
      assert.deepEqual(
        next.pointerReferences.filter((r) => r.targetObjectIndex === o.index).map((r) => r.offset).length,
        2,
      );
    }
    const out = path.join(temp, 'paired'),
      write = writeChapterRegistrationDraft({
        ...request,
        global: globalPath,
        language: languagePath,
        outputDirectory: out,
      });
    assert.equal(write.deployable, false);
    assert.equal(sha(fs.readFileSync(path.join(out, 'global.registration-draft.igz'))), sha(result.global));
    assert.equal(
      sha(fs.readFileSync(path.join(out, 'ENGLISH.registration-draft.igz'))),
      sha(result.language),
    );
    assert.equal(sha(fs.readFileSync(write.manifest.path)), write.manifest.sha256);
    assert.throws(
      () =>
        writeChapterRegistrationDraft({
          ...request,
          global: globalPath,
          language: languagePath,
          outputDirectory: out,
        }),
      /EEXIST/,
    );
    const link = path.join(temp, 'linked-source');
    fs.symlinkSync(path.resolve(globalPath), link);
    assert.throws(
      () =>
        writeChapterRegistrationDraft({
          ...request,
          global: link,
          language: languagePath,
          outputDirectory: path.join(temp, 'symlink-test'),
        }),
      /ELOOP/,
    );
    const partial = path.join(temp, 'partial'),
      originalWrite = fs.writeFileSync;
    let writes = 0;
    try {
      fs.writeFileSync = (...args) => {
        if (++writes === 2) throw new Error('Injected second output failure');
        return originalWrite(...args);
      };
      assert.throws(
        () =>
          writeChapterRegistrationDraft({
            ...request,
            global: globalPath,
            language: languagePath,
            outputDirectory: partial,
          }),
        /Injected/,
      );
    } finally {
      fs.writeFileSync = originalWrite;
    }
    assert.equal(fs.existsSync(partial), false);
    const partialWithForeign = path.join(temp, 'partial-with-foreign');
    writes = 0;
    try {
      fs.writeFileSync = (...args) => {
        if (++writes === 2) {
          originalWrite(path.join(partialWithForeign, 'foreign.txt'), 'Preserve this unrelated file', {
            flag: 'wx',
          });
          throw new Error('Injected foreign-file failure');
        }
        return originalWrite(...args);
      };
      assert.throws(
        () =>
          writeChapterRegistrationDraft({
            ...request,
            global: globalPath,
            language: languagePath,
            outputDirectory: partialWithForeign,
          }),
        /Injected foreign-file/,
      );
    } finally {
      fs.writeFileSync = originalWrite;
    }
    assert.deepEqual(fs.readdirSync(partialWithForeign), ['foreign.txt']);
    assert.equal(
      fs.readFileSync(path.join(partialWithForeign, 'foreign.txt'), 'utf8'),
      'Preserve this unrelated file',
    );
    assert.equal(sha(fs.readFileSync(globalPath)), PROFILE.globalSha256);
    assert.equal(sha(fs.readFileSync(languagePath)), PROFILE.englishSha256);
    for (const [i, p] of [globalPath, languagePath].entries())
      assert.equal(fs.statSync(p).mtimeMs, originalStats[i].mtimeMs);
  },
);

const archivePath = process.env.SKYLANDERS_TEST_GLOBAL_ARCHIVE,
  languageDirectory = process.env.SKYLANDERS_TEST_LANGUAGE_DIRECTORY;
const allReal =
  real &&
  archivePath &&
  languageDirectory &&
  fs.existsSync(archivePath) &&
  LANGUAGES.every((p) => fs.existsSync(path.join(languageDirectory, p.member)));
test(
  'optional all-language archive inventory, original text preservation, deterministic global and group cleanup',
  { skip: !allReal },
  (t) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chapter-multilingual-draft-test-'));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true })); // Unique test-owned tree only.
    const archive = fs.readFileSync(archivePath),
      global = fs.readFileSync(globalPath);
    const languages = Object.fromEntries(
      LANGUAGES.map((p) => [p.member, fs.readFileSync(path.join(languageDirectory, p.member))]),
    );
    const expectedHashes = {
      archive: ARCHIVE_PROFILE.sha256,
      global: PROFILE.globalSha256,
      languages: Object.fromEntries(LANGUAGES.map((p) => [p.member, p.sha256])),
    };
    const options = { ...request, archive, global, languages, expectedHashes, titleFallback: 'english' };
    const inventory = inspectRegistrationLanguageInventory(archive, ARCHIVE_PROFILE.sha256);
    assert.equal(inventory.memberCount, 11);
    assert.equal(inventory.languageCount, 10);
    assert.deepEqual(
      inventory.entries.filter((e) => e.role === 'language').map((e) => e.member),
      LANGUAGES.map((p) => p.member),
    );
    for (const invalid of [
      Buffer.from(archive).fill(0, 0, 4),
      Buffer.from(archive).fill(0, archive.length - 1),
    ])
      assert.throws(
        () => inspectRegistrationLanguageInventory(invalid, ARCHIVE_PROFILE.sha256),
        /archive SHA-256/,
      );
    const missing = { ...languages };
    delete missing['GERMAN.pak'];
    assert.throws(
      () => createMultilingualChapterRegistrationDraft({ ...options, languages: missing }),
      /All ten/,
    );
    assert.throws(
      () =>
        createMultilingualChapterRegistrationDraft({
          ...options,
          languages: { ...languages, 'UNKNOWN.pak': languages['ENGLISH.pak'] },
        }),
      /Invalid language members/,
    );
    assert.throws(
      () =>
        createMultilingualChapterRegistrationDraft({
          ...options,
          languages: { ...languages, 'GERMAN.pak': languages['ENGLISH.pak'] },
        }),
      /Pinned language source/,
    );
    assert.throws(
      () => createMultilingualChapterRegistrationDraft({ ...options, titleFallback: 'translated' }),
      /Explicit titleFallback/,
    );
    const paired = createChapterRegistrationDraft({ ...request, global, language: languages['ENGLISH.pak'] });
    const result = createMultilingualChapterRegistrationDraft(options);
    assert.deepEqual(result.global, paired.global);
    assert.deepEqual(result.languages['ENGLISH.pak'], paired.language);
    assert.equal(sha(result.global), 'b50e058af937b75db5611c3679946c8c3e71c883f82af37a2cf5e6413560c6f1');
    assert.equal(result.manifest.languageCoverageComplete, true);
    assert.equal(result.manifest.authoredTitleTranslationsComplete, false);
    assert.equal(result.manifest.runtimeValidated, false);
    assert.equal(result.manifest.deployable, false);
    assert.equal(result.manifest.languages.length, 10);
    for (const profile of LANGUAGES) {
      const before = parseIgz(languages[profile.member]),
        after = parseIgz(result.languages[profile.member]);
      const getDictionary = (z) => {
        const p = z.objects.find((o) => o.type === 'LanguagePackInfo'),
          r = z.pointerReferencesByOffset.get(p.offset + 0x30);
        return z.buffer.subarray(r.targetOffset, r.targetOffset + z.u32(p.offset + 0x28));
      };
      const oldDictionary = getDictionary(before),
        newDictionary = getDictionary(after),
        entries = decodeUtf16Dictionary(newDictionary);
      assert.deepEqual(newDictionary.subarray(0, oldDictionary.length), oldDictionary, profile.member);
      assert.equal(entries.length, 804);
      assert.deepEqual(
        entries.slice(-2).map((e) => e.text),
        [request.titleText, request.loadText],
      );
      const record = result.manifest.languages.find((r) => r.member === profile.member);
      assert.equal(record.originalAssignmentsPreserved, 802);
      assert.equal(record.originalOrdinalsShifted, 0);
      assert.equal(record.rebuild.outputSha256, sha(result.languages[profile.member]));
      assert.equal(sha(languages[profile.member]), profile.sha256);
      if (profile.languageId !== 6) assert.match(record.titlePolicy, /English fallback; not a translation/);
      const p = after.objects.find((o) => o.type === 'LanguagePackInfo');
      assert.equal(after.u32(p.offset + 0x24), profile.languageId);
      assert.equal(after.stringReferencesByOffset.get(p.offset + 0x10).value, profile.member.slice(0, -4));
    }
    const paths = Object.fromEntries(
      LANGUAGES.map((p) => [p.member, path.join(languageDirectory, p.member)]),
    );
    const fileOptions = {
      ...request,
      archive: archivePath,
      global: globalPath,
      languages: paths,
      expectedHashes,
      titleFallback: 'english',
      outputDirectory: path.join(temp, 'complete'),
    };
    const written = writeMultilingualChapterRegistrationDraft(fileOptions);
    assert.equal(written.outputs.length, 11);
    assert.equal(written.languageCoverageComplete, true);
    assert.deepEqual(
      new Set(written.outputs.map((o) => o.archiveMember)),
      new Set(['level.bld', ...LANGUAGES.map((p) => p.member)]),
    );
    for (const output of written.outputs)
      assert.equal(sha(fs.readFileSync(path.join(written.outputDirectory, output.path))), output.sha256);
    const manifest = JSON.parse(fs.readFileSync(written.manifest.path));
    assert.equal(manifest.outputs.length, 11);
    assert.throws(() => writeMultilingualChapterRegistrationDraft(fileOptions), /EEXIST/);
    const partial = path.join(temp, 'partial'),
      originalWrite = fs.writeFileSync;
    let writes = 0;
    try {
      fs.writeFileSync = (...args) => {
        if (++writes === 7) {
          originalWrite(path.join(partial, 'foreign.txt'), 'Keep foreign data', { flag: 'wx' });
          throw new Error('Injected multilingual failure');
        }
        return originalWrite(...args);
      };
      assert.throws(
        () => writeMultilingualChapterRegistrationDraft({ ...fileOptions, outputDirectory: partial }),
        /Injected multilingual failure/,
      );
    } finally {
      fs.writeFileSync = originalWrite;
    }
    assert.deepEqual(fs.readdirSync(partial), ['foreign.txt']);
    assert.equal(sha(fs.readFileSync(archivePath)), ARCHIVE_PROFILE.sha256);
    assert.equal(sha(fs.readFileSync(globalPath)), PROFILE.globalSha256);
    for (const profile of LANGUAGES)
      assert.equal(sha(fs.readFileSync(paths[profile.member])), profile.sha256);
  },
);
