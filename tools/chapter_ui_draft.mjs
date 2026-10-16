#!/usr/bin/env node
// Exact-source UI experiment. Does not install archives or claim playability.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseIgz } from './igz.mjs';
import { appendIgz, inspectAppendTarget } from './igz_append.mjs';
import { rebuildStringDictionary, rebuildLanguageDictionary } from './chapter_registration_draft.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
export const UI_SHA = 'bf0879a08c951f5b2e44bdd81c0b5cebbfe9b79bdd8bbe3d3bde666d64b65f6a';
export const UI_LANGUAGES = [
  ['DANISH', 4, '9946c9d52a84fb8a0d44d9f9e439b343763be3d5288f5436dbf5e4920b9f5453'],
  ['DUTCH', 5, '64e6a2b2684c36612322f85762f5aba6ff0b8e801995f0bd73c8d0af63bca85d'],
  ['ENGLISH', 6, '0859409bb474321f855960391636de8e689664611d2c2cd5d2c26c4a7f421b56'],
  ['FINNISH', 7, '2ded1cdb3b2a51612043d34e972bc8438b4daba2782bf3dc7cf28f9171e2a569'],
  ['FRENCH', 8, '28a4f8fc2af957a32a5c3fa3f05900227139b18718d27efd8e73edf7c9108446'],
  ['GERMAN', 9, 'ecde4d8498fd5ce2689fc2b08928447be7553abea4b30f639aa20c1aaa3abc29'],
  ['ITALIAN', 14, '14dca3f600d64177a4a12d7f92e5b570b57433140653d62ccfc998616c1e0266'],
  ['NORWEGIAN', 17, '3d8e887e40cb60aede50e2c18315c94e85ae60f40b62533945cd36c0f4b0cea7'],
  ['SPANISH', 21, '0d4750eafa5f232ba0f5f47472586c69ed6bca98234749f0b3b2fda715b8be46'],
  ['SWEDISH', 23, 'fcd413b4ed56391cd332df9831ae83b91d0c79a07b8f7469595f09782caf7500'],
];
const description = 'A sunlit grid test ground featuring a Gallardo display model.';
const encodedObject = (z, e) => z.objectsByOffset.get(z.resolvePointer(e).offset);
export function createChapterBackdropDraft(global) {
  const pinned = 'b50e058af937b75db5611c3679946c8c3e71c883f82af37a2cf5e6413560c6f1';
  assert.ok(Buffer.isBuffer(global) && sha(global) === pinned, 'Pinned paired global mismatch');
  const z = parseIgz(global),
    list = encodedObject(z, 258216),
    sprite = encodedObject(z, 243184);
  assert.equal(list.type, 'ScriptSetList');
  assert.equal(z.u32(list.offset + 12), 22);
  assert.equal(sprite.type, 'tfbSpriteInfo');
  assert.equal(z.stringReferencesByOffset.get(sprite.offset + 16)?.value, '303_UI_LevelBackdrop_S');
  const references = z.pointerReferences.filter((p) => p.targetObjectIndex === sprite.index);
  assert.equal(references.length, 3);
  assert.equal(z.u32(sprite.offset + 8), 3);
  // Existing references all belong to ordinary igObjectList/ScriptSetList
  // backing arrays. Their owning releases were statically corroborated.
  const lists = z.objects.filter((o) => ['igObjectList', 'ScriptSetList'].includes(o.type));
  for (const ref of references)
    assert.ok(
      lists.some((o) => {
        const data = z.pointerReferencesByOffset.get(o.offset + 32),
          count = z.u32(o.offset + 12);
        return (
          data &&
          ref.offset >= data.targetOffset &&
          ref.offset < data.targetOffset + count * 8 &&
          (ref.offset - data.targetOffset) % 8 === 0
        );
      }),
      'Sprite incoming slot not a known owning list',
    );
  const result = appendIgz(global, {
    expectedSha256: pinned,
    appendedDefaultPool: Buffer.alloc(0),
    appendedObjects: [],
    objectLists: [
      {
        listEncoded: list.encoded,
        expectedType: 'ScriptSetList',
        appendObjects: [],
        appendExistingObjects: [sprite.encoded],
      },
    ],
  });
  const before = parseIgz(result.buffer),
    next = encodedObject(before, sprite.encoded),
    buffer = Buffer.from(result.buffer);
  assert.equal(before.u32(next.offset + 8), 3);
  buffer.writeUInt32LE(4, next.offset + 8);
  for (let i = 0; i < buffer.length; i++)
    assert.ok(buffer[i] === result.buffer[i] || (i >= next.offset + 8 && i < next.offset + 12));
  const out = parseIgz(buffer);
  assert.equal(out.pointerReferences.filter((p) => p.targetObjectIndex === next.index).length, 4);
  return {
    global: buffer,
    manifest: {
      schema: 'skylanders-chapter-backdrop-draft-v1',
      sourceSha256: pinned,
      outputSha256: sha(buffer),
      runtimeValidated: false,
      deployable: false,
      append: result.manifest,
      referenceCount: { encoded: sprite.encoded, before: 3, after: 4 },
      backdropPolicy:
        'Explicit existing Arena303 loading-backdrop reuse for the authored demo, not Gallardo artwork.',
      limitation:
        'No new sprite or texture. Static ownership only; test actual loadscreen/teardown independently.',
    },
  };
}
export function createChapterUiDraft({ ui, languages }) {
  assert.ok(Buffer.isBuffer(ui) && sha(ui) === UI_SHA, 'Pinned UI SHA-256 mismatch');
  assert.deepEqual(
    Object.keys(languages).sort(),
    UI_LANGUAGES.map(([n]) => n + '.pak').sort(),
    'Exactly ten pinned UI languages required',
  );
  for (const [name, , hash] of UI_LANGUAGES)
    assert.equal(sha(languages[name + '.pak']), hash, 'Pinned language ' + name);
  const z = parseIgz(ui),
    target = inspectAppendTarget(ui, UI_SHA),
    loop = z.objects[3142],
    rhs = z.objects[3143],
    stack = z.objects[3144],
    list = z.objects[2251];
  assert.equal(loop.type, 'OpLoopValue');
  assert.equal(loop.encoded, 296272);
  assert.equal(rhs.type, 'ValueRHSVariant');
  assert.equal(rhs.size, 56);
  assert.equal(stack.type, 'RHSValueStack');
  assert.equal(stack.size, 72);
  assert.equal(list.type, 'ScriptSetList');
  assert.equal(z.u32(list.offset + 12), 22);
  assert.equal(z.pointerReferencesByOffset.get(loop.offset + 56)?.targetObjectIndex, rhs.index);
  assert.equal(z.pointerReferencesByOffset.get(rhs.offset + 16)?.targetObjectIndex, stack.index);
  const incoming = z.pointerReferences.filter((p) => p.targetObjectIndex === rhs.index);
  assert.equal(incoming.length, 3);
  assert.equal(z.u32(rhs.offset + 8), 3);
  assert.deepEqual(
    incoming.map((p) => p.objectIndex).sort((a, b) => a - b),
    [3142, 4263, 4353],
  );
  assert.equal(z.u32(stack.offset + 64), 22);
  assert.equal(z.u64(stack.offset + 24), 0x0800000000000000n);
  assert.equal(z.u64(stack.offset + 56), 9n);
  assert.equal(z.u32(z.objects[2281].offset + 12), 23, 'Existing 23rd button required');
  assert.equal(z.objects[3098].type, 'tfbActorInfo');
  const name = 'AI_Workshop_Description';
  assert.ok(!z.strings.includes(name));
  const payload = Buffer.alloc(200);
  ui.copy(payload, 0, rhs.offset, rhs.offset + 56);
  ui.copy(payload, 56, stack.offset, stack.offset + 72);
  payload.writeUInt32LE(1, 8);
  payload.writeBigUInt64LE(BigInt(target.appendOffset + 56), 16);
  payload.writeUInt32LE(23, 56 + 64);
  payload.writeUInt32LE(target.types.find((t) => t.type === 'StringInfo').typeIndex, 128);
  payload.writeUInt32LE(2, 136);
  payload.writeUInt32LE(target.stringCount, 144);
  const appended = appendIgz(ui, {
    expectedSha256: UI_SHA,
    appendedDefaultPool: payload,
    appendedObjects: [
      { offset: 0, type: 'ValueRHSVariant' },
      { offset: 56, type: 'RHSValueStack' },
      { offset: 128, type: 'StringInfo' },
    ],
    fixupSlots: { ROFS: [16], RPID: [80], RNEX: [112], RSTT: [144] },
    newStrings: [name],
    rootList: { rootEncoded: target.roots[0], appendObjects: [128] },
    objectLists: [
      { listEncoded: list.encoded, expectedType: 'ScriptSetList', appendObjects: [128], insertAt: 18 },
    ],
  });
  const buffer = Buffer.from(appended.buffer),
    before = parseIgz(buffer),
    nextLoop = encodedObject(before, loop.encoded),
    nextRhs = encodedObject(before, rhs.encoded);
  assert.equal(before.u64(nextLoop.offset + 56), BigInt(rhs.encoded));
  assert.equal(before.u32(nextRhs.offset + 8), 3);
  buffer.writeBigUInt64LE(BigInt(target.appendOffset), nextLoop.offset + 56);
  buffer.writeUInt32LE(2, nextRhs.offset + 8);
  const edits = [
    {
      offset: nextLoop.offset + 56,
      width: 8,
      before: rhs.encoded,
      after: target.appendOffset,
      reason: 'Only the available-title loop uses new literal23',
    },
    {
      offset: nextRhs.offset + 8,
      width: 4,
      before: 3,
      after: 2,
      reason: 'One statically owning incoming RHS slot redirected',
    },
  ];
  // Runtime adventure order is 18 old stories, the new story, then four
  // expansions. Description lookup uses that ID, not the title-list index.
  // The two remaining users of the old 22 literal are display bounds checks.
  const displayStack = encodedObject(before, stack.encoded);
  buffer.writeUInt32LE(23, displayStack.offset + 64);
  edits.push({
    offset: displayStack.offset + 64,
    width: 4,
    before: 22,
    after: 23,
    reason: 'Include all 23 adventure IDs in both display bounds checks',
  });
  const thresholdRhs = z.objects[2211],
    thresholdStack = z.objects[2212];
  assert.equal(thresholdRhs.type, 'ValueRHSVariant');
  assert.equal(thresholdStack.type, 'RHSValueStack');
  assert.deepEqual(
    z.pointerReferences.filter((p) => p.targetObjectIndex === 2211).map((p) => p.objectIndex),
    [2208],
  );
  assert.deepEqual(
    z.pointerReferences.filter((p) => p.targetObjectIndex === 2212).map((p) => p.objectIndex),
    [2211],
  );
  assert.equal(z.u32(thresholdStack.offset + 64), 17);
  const nextThreshold = encodedObject(before, thresholdStack.encoded);
  buffer.writeUInt32LE(18, nextThreshold.offset + 64);
  edits.push({
    offset: nextThreshold.offset + 64,
    width: 4,
    before: 17,
    after: 18,
    reason: 'Only adventure IDs above 18 use the expansion unlock branch',
  });
  const allowed = new Set(edits.flatMap((e) => Array.from({ length: e.width }, (_, i) => e.offset + i)));
  for (let i = 0; i < buffer.length; i++)
    assert.ok(buffer[i] === appended.buffer[i] || allowed.has(i), 'Unexpected post-append edit');
  const rebuilt = parseIgz(buffer),
    newRhs = encodedObject(rebuilt, target.appendOffset),
    newStack = encodedObject(rebuilt, target.appendOffset + 56);
  assert.equal(rebuilt.pointerReferencesByOffset.get(nextLoop.offset + 56)?.targetObjectIndex, newRhs.index);
  assert.equal(rebuilt.u32(newStack.offset + 64), 23);
  assert.equal(rebuilt.u32(encodedObject(rebuilt, stack.encoded).offset + 64), 23);
  const descriptionList = encodedObject(rebuilt, list.encoded),
    descriptionData = rebuilt.pointerReferencesByOffset.get(descriptionList.offset + 32).targetOffset;
  assert.equal(rebuilt.u64(descriptionData + 18 * 8), BigInt(target.appendOffset + 128));
  const oldDescriptionData = z.pointerReferencesByOffset.get(list.offset + 32).targetOffset;
  for (let i = 0; i < 22; i++)
    assert.equal(rebuilt.u64(descriptionData + (i < 18 ? i : i + 1) * 8), z.u64(oldDescriptionData + i * 8));
  for (const id of [4263, 4353, 3098, 2281]) {
    const a = z.objects[id],
      b = encodedObject(rebuilt, a.encoded);
    assert.ok(
      ui.subarray(a.offset, a.offset + a.size).equals(buffer.subarray(b.offset, b.offset + b.size)),
      'Existing check/button changed',
    );
  }
  const outputs = {},
    languageReports = [];
  for (const [name, languageId, hash] of UI_LANGUAGES) {
    const input = languages[name + '.pak'],
      l = parseIgz(input),
      pack = l.objects.find((o) => o.type === 'LanguagePackInfo'),
      ref = l.pointerReferencesByOffset.get(pack.offset + 48);
    const dictionary = input.subarray(ref.targetOffset, ref.targetOffset + l.u32(pack.offset + 40));
    const reordered = rebuildStringDictionary(
      z,
      rebuilt,
      dictionary,
      new Map([[target.appendOffset + 128, description]]),
    );
    const out = rebuildLanguageDictionary(input, reordered.buffer, hash, languageId, name);
    outputs[name + '.pak'] = out.buffer;
    languageReports.push({
      member: name + '.pak',
      policy: name === 'ENGLISH' ? 'authored English' : 'explicit English fallback',
      previousCount: reordered.previousCount,
      count: reordered.count,
      assignments: reordered.assignments,
      rebuild: out.manifest,
    });
  }
  return {
    ui: buffer,
    languages: outputs,
    manifest: {
      schema: 'skylanders-chapter-ui-draft-v1',
      deployable: false,
      runtimeValidated: false,
      sourceSha256: UI_SHA,
      outputSha256: sha(buffer),
      description,
      descriptionAdventureId: 18,
      expansionThreshold: { before: 17, after: 18 },
      loopLimit: { before: 22, after: 23, sharedDisplayLimit: 23 },
      existingButtonReused: 3098,
      buttonCount: 23,
      edits,
      append: appended.manifest,
      languages: languageReports,
      evidence: {
        loopMetadata: 'ev_ce2e384244e06a9d8c0f05bbf84e64769dcc66bf155c1c96895769ce14bfd389',
        memoryFlags: 'ev_d10b7df50bfe4ac9739b83ea127c4cf19ecbad22e00b23d0dcf43a63859f0dd7',
      },
      limitations: [
        'Requires coordinated global title/load/backdrop and initializer changes; no game install.',
        'No runtime selection, chapter-load, gameplay or ownership/teardown acceptance yet.',
        'Description is English fallback in nine non-English dictionaries, not translated.',
        'Existing generic 23rd chapter-button art retained; no Gallardo UI thumbnail authored.',
      ],
    },
  };
}
function read(file, max) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const s = fs.fstatSync(fd);
    assert.ok(s.isFile() && s.size <= max);
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
export function writeChapterUiDraft(uiPath, languagesDirectory, outputDirectory) {
  const ui = read(uiPath, 32 * 1024 * 1024),
    languages = Object.fromEntries(
      UI_LANGUAGES.map(([n]) => [n + '.pak', read(path.join(languagesDirectory, n + '.pak'), 1024 * 1024)]),
    );
  const result = createChapterUiDraft({ ui, languages });
  fs.mkdirSync(outputDirectory, { mode: 0o700 });
  for (const [name, data] of [
    ['level.bld', result.ui],
    ...Object.entries(result.languages),
    ['manifest.json', Buffer.from(JSON.stringify(result.manifest, null, 2) + '\n')],
  ])
    fs.writeFileSync(path.join(outputDirectory, name), data, { flag: 'wx', mode: 0o600 });
  return {
    outputDirectory,
    uiSha256: sha(result.ui),
    languages: Object.keys(result.languages).length,
    runtimeValidated: false,
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(
      process.argv.length,
      5,
      'Usage: chapter_ui_draft.mjs original-inner-ui.bld original-language-directory new-output-directory',
    );
    console.log(JSON.stringify(writeChapterUiDraft(...process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
