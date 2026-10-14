import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  decodeUtf16Dictionary,
  createChapterEntrypoints,
  exportChapterEntrypoints,
} from '../tools/chapter_entrypoints.mjs';
import { extractMetadata } from '../tools/elf_metadata.mjs';
import { parseIgz } from '../tools/igz.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');

test('UTF-16 dictionaries retain empty strings, source offsets, supplementary characters and BOM values', () => {
  const b = Buffer.from('A\0\0ä🌍\0\ufeffB\0', 'utf16le');
  assert.deepEqual(decodeUtf16Dictionary(b, 100), [
    { ordinal: 0, fileOffset: 100, byteLength: 2, text: 'A' },
    { ordinal: 1, fileOffset: 104, byteLength: 0, text: '' },
    { ordinal: 2, fileOffset: 106, byteLength: 6, text: 'ä🌍' },
    { ordinal: 3, fileOffset: 114, byteLength: 4, text: '\ufeffB' },
  ]);
  assert.deepEqual(decodeUtf16Dictionary(Buffer.alloc(0)), []);
});

test('malformed dictionaries and missing registry/native identity fail closed', () => {
  assert.throws(() => decodeUtf16Dictionary(Buffer.from([1])), /even-length/);
  assert.throws(() => decodeUtf16Dictionary(Buffer.from('A', 'utf16le')), /terminator/);
  assert.throws(() => decodeUtf16Dictionary(Buffer.from([0, 0xd8, 0, 0])), /encoded data/);
  assert.throws(() => decodeUtf16Dictionary(Buffer.alloc(0), -1), /offset/);
  assert.throws(() => createChapterEntrypoints({}), /registry/);
});

const files = {
  registry: 'research/chapter-registry-v1.json',
  global: 'research/permanent_global/level.bld',
  initializer: 'research/init_setup/level.bld',
  language: 'research/permanent_global/ENGLISH.pak',
};
const executable = 'extracted/CUSA00697/eboot.elf';
const available = [...Object.values(files), executable].every((f) => fs.existsSync(f));
function inputs() {
  const bytes = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.readFileSync(f)]));
  return {
    ...bytes,
    registry: JSON.parse(bytes.registry),
    metadata: extractMetadata(executable),
    expectedHashes: Object.fromEntries(Object.entries(bytes).map(([k, b]) => [k, hash(b)])),
  };
}

test(
  'owned chapter sources pair 22 native-indexed titles/loads and preserve 18 story include identities',
  { skip: !available },
  () => {
    const options = inputs(),
      r = createChapterEntrypoints(options);
    assert.equal(r.pairs.length, 22);
    assert.equal(r.language.stringCount, 802);
    assert.equal(
      r.pairs.reduce((n, p) => n + p.storyIncludes.length, 0),
      18,
    );
    assert.equal(r.pairing.titleSelection.row, 21);
    assert.equal(r.pairing.loadSelection.row, 22);
    assert.equal(r.pairing.sameIndexExpression.objectIndex, 700);
    assert.equal(r.pairing.indexOperands[0].objectIndex, 694);
    const tutorial = r.pairs[12];
    assert.equal(tutorial.titleText.text, 'Soda Springs');
    assert.equal(tutorial.titleText.ordinal, 35);
    assert.equal(tutorial.loadText.text, 'Level_313_Tutorial');
    assert.equal(tutorial.loadText.ordinal, 139);
    assert.equal(tutorial.storyIncludes[0].includeOrdinal, 0);
    assert.equal(tutorial.chapterNumber, null);
    assert.equal(r.pairs[1].load.name, 'Level_301_TheMachine');
    assert.equal(r.pairs[1].loadText.text, 'Level_301_The_Machine');
    assert.equal(r.pairs[9].loadText.text, 'Level_310_DreamLand');
    assert.deepEqual(r.pairs[9].archivePathCandidates, [
      'level/level_310_dreamland.bld',
      'level/level_310_dreamland.arc',
    ]);
    assert.equal(r.pairs[18].storyIncludes.length, 0);
    const finalBattle = r.loadMembershipStatements.find((s) => s.row === 38);
    assert.equal(finalBattle.rhs[0].name, 'FinalBattleLoadString');
    assert.equal(finalBattle.rhs[0].text.text, 'level_317_finalbattle');
    assert.equal(r.loadMembershipStatements.find((s) => s.row === 23).rhs[0].name, 'String Scratch G1');
    assert.equal(r.runtimeValidated, false);
    assert.equal(r.chapterInsertionSupported, false);
    assert.throws(
      () =>
        createChapterEntrypoints({
          ...options,
          expectedHashes: { ...options.expectedHashes, language: '0'.repeat(64) },
        }),
      /SHA-256/,
    );
    assert.throws(
      () => createChapterEntrypoints({ ...options, metadata: { ...options.metadata, classes: [] } }),
      /Native field/,
    );
    const broken = Buffer.from(options.language),
      z = parseIgz(broken),
      p = z.objects.find((o) => o.type === 'LanguagePackInfo');
    broken.writeUInt32LE(z.u32(p.offset + 0x28) - 2, p.offset + 0x28);
    assert.throws(
      () =>
        createChapterEntrypoints({
          ...options,
          language: broken,
          expectedHashes: { ...options.expectedHashes, language: hash(broken) },
        }),
      /terminator/,
    );
  },
);

test(
  'entrypoint export hashes every source, creates output exclusively and preserves source bytes',
  { skip: !available },
  () => {
    const options = inputs(),
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapter-entrypoints-test-')),
      output = path.join(dir, 'entrypoints.json');
    try {
      const args = { ...files, executable, output, expectedHashes: options.expectedHashes };
      const r = exportChapterEntrypoints(args);
      assert.equal(r.pairs, 22);
      assert.equal(r.storyIncludes, 18);
      assert.equal(hash(fs.readFileSync(output)), r.sha256);
      assert.throws(() => exportChapterEntrypoints(args), /EEXIST/);
      assert.throws(
        () =>
          exportChapterEntrypoints({
            ...args,
            output: path.join(dir, 'no.json'),
            expectedHashes: { ...args.expectedHashes, registry: '0'.repeat(64) },
          }),
        /SHA-256/,
      );
      assert.equal(fs.existsSync(path.join(dir, 'no.json')), false);
      for (const [key, f] of Object.entries(files))
        assert.equal(hash(fs.readFileSync(f)), options.expectedHashes[key]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
