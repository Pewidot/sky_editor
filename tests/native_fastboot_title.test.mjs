import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { patchFastbootTitle, PROFILE } from '../tools/native_fastboot_title.mjs';
import { parseIgz } from '../tools/igz.mjs';
import { decodeUtf16Dictionary } from '../tools/chapter_entrypoints.mjs';
import { bufferSha256 } from '../tools/native_script_writer.mjs';
const file = 'research/directboot-title-inner.bld';
const present = fs.existsSync(file);
let input, output, manifest, before, after;
test('public builder rejects unsupported requests before parsing any private artifact', () => {
  assert.throws(() => patchFastbootTitle(Buffer.alloc(32), { map: '../../outside' }), /allowlist/);
  assert.throws(
    () => patchFastbootTitle(Buffer.alloc(32), { map: PROFILE.allowedMaps[0], stage: 'unknown' }),
    /Unsupported fastboot/,
  );
  assert.throws(
    () => patchFastbootTitle(Buffer.alloc(32), { map: PROFILE.allowedMaps[0] }),
    /Original Title/,
  );
});
test(
  'source-bound post-slot startup patch has exactly five opcode-list replacements',
  { skip: !present },
  () => {
    input = fs.readFileSync(file);
    before = parseIgz(input);
    ({ buffer: output, manifest } = patchFastbootTitle(input, { map: 'Level_314_Tutorial_2' }));
    after = parseIgz(output);
    assert.equal(manifest.runtimeValidated, false);
    assert.equal(after.unresolvedFixupEntries.length, 0);
    assert.deepEqual(
      manifest.changes.map((c) => [c.scriptId, c.row, c.beforeId]),
      [
        [4749, 25, 4840],
        [2496, 1902, 2974],
        [2496, 1903, 1423],
        [2496, 1904, 3966],
        [2496, 1905, 3967],
      ],
    );
    assert.equal(after.objects.length, before.objects.length + 5);
  },
);
test(
  'request points to the native title variable and exact allowlisted StringInfo',
  { skip: !present },
  () => {
    const at = (encoded) => after.objects.find((o) => o.encoded === encoded);
    const find = at(manifest.changes[1].afterEncoded);
    assert.equal(find.type, 'OpFindVariable');
    assert.equal(after.stringReferencesByOffset.get(find.offset + 72).value, 'title force load to level');
    assert.equal(after.u64(find.offset + 64), before.u64(before.objects[4733].offset + 72));
    assert.equal(after.pointerReferencesByOffset.get(find.offset + 96).encoded, before.objects[2494].encoded);
    const op = at(manifest.changes[2].afterEncoded);
    assert.equal(op.type, 'OpSetReference');
    const lhs = at(after.pointerReferencesByOffset.get(op.offset + 56).encoded);
    const lhsData = after.pointerReferencesByOffset.get(lhs.offset + 32).targetOffset;
    assert.equal(after.pointerReferencesByOffset.get(lhsData).encoded, find.encoded);
    const rhs = at(after.pointerReferencesByOffset.get(op.offset + 64).encoded);
    assert.equal(rhs.type, 'RHSReferenceStack');
    const entries = after.pointerReferencesByOffset.get(rhs.offset + 32).targetOffset;
    assert.equal(after.u32(rhs.offset + 12), 1);
    assert.equal(after.pointerReferencesByOffset.has(entries), false);
    assert.ok(after.offsetTables.get('REXT').offsets.includes(entries));
    const raw = after.u64(entries);
    assert.equal(raw >> 63n, 1n);
    const index = Number(raw & 0x7fffffffffffffffn),
      exid = after.fixupMap.get('EXID');
    assert.equal(after.u32(exid.dataOffset + index * 8), 1983);
    assert.equal(after.u32(exid.dataOffset + index * 8 + 4), 647282318);
    assert.deepEqual(
      after.objects.filter((o) => o.type === 'StringInfo').map((o) => o.encoded),
      before.objects.filter((o) => o.type === 'StringInfo').map((o) => o.encoded),
    );
    const jump = at(manifest.changes[4].afterEncoded);
    assert.equal(jump.type, 'OpAbstractFlow');
    assert.equal(output.readUInt16LE(jump.offset + 50), 2);
    assert.equal(1905 + 1 + 2, 1908);
  },
);
test(
  'original chapter handle resolves to the exact registered UTF-16 load string',
  {
    skip:
      !fs.existsSync('research/permanent_global/level.bld') ||
      !fs.existsSync('research/permanent_global/ENGLISH.pak'),
  },
  () => {
    const profile = PROFILE.loadStrings.Level_314_Tutorial_2;
    const gb = fs.readFileSync('research/permanent_global/level.bld'),
      lb = fs.readFileSync('research/permanent_global/ENGLISH.pak');
    assert.equal(bufferSha256(gb), profile.sourceSha256);
    assert.equal(bufferSha256(lb), profile.languageSha256);
    const g = parseIgz(gb),
      l = parseIgz(lb),
      root = g.objects[0];
    assert.equal(root.type, 'igObjectList');
    const data = g.pointerReferencesByOffset.get(root.offset + 32).targetOffset;
    const object =
      g.objects[g.pointerReferencesByOffset.get(data + (profile.nameId - 26) * 8).targetObjectIndex];
    assert.equal(object.index, profile.sourceObjectId);
    assert.equal(object.type, 'StringInfo');
    assert.equal(g.stringReferencesByOffset.get(object.offset + 16).value, profile.sourceName);
    const pack = l.objects.find((o) => o.type === 'LanguagePackInfo'),
      start = l.pointerReferencesByOffset.get(pack.offset + 48).targetOffset;
    const dictionary = decodeUtf16Dictionary(lb.subarray(start, start + l.u32(pack.offset + 40)));
    const strings = g.objects.filter(
      (o) => o.type === 'StringInfo' && !g.stringReferencesByOffset.get(o.offset + 16)?.value.startsWith('^'),
    );
    assert.equal(strings.length, dictionary.length);
    assert.equal(strings[profile.dictionaryOrdinal].index, profile.sourceObjectId);
    assert.equal(dictionary[profile.dictionaryOrdinal].text, 'Level_314_Tutorial_2');
  },
);
test('all original object bodies are preserved apart from reference counts', { skip: !present }, () => {
  const byEncoded = new Map(after.objects.map((o) => [o.encoded, o]));
  for (const original of before.objects) {
    const current = byEncoded.get(original.encoded);
    assert.equal(current.type, original.type);
    const a = Buffer.from(input.subarray(original.offset, original.offset + original.size));
    const b = Buffer.from(output.subarray(current.offset, current.offset + current.size));
    a.writeUInt32LE(0, 8);
    b.writeUInt32LE(0, 8);
    assert.deepEqual(b, a, `Original object changed: ${original.index} ${original.type}`);
  }
});
test('reject unsupported maps, modified source and unknown stages', { skip: !present }, () => {
  assert.throws(() => patchFastbootTitle(input, { map: '../../evil' }), /allowlist/);
  assert.throws(
    () => patchFastbootTitle(Buffer.alloc(32), { map: PROFILE.allowedMaps[0] }),
    /Original Title/,
  );
  assert.throws(
    () => patchFastbootTitle(input, { map: PROFILE.allowedMaps[0], stage: 'unknown' }),
    /Unsupported fastboot/,
  );
});
test(
  'auto-slot retains native bootstrap/header guards and complete original slot load call',
  { skip: !present },
  () => {
    const built = patchFastbootTitle(input, { map: 'Level_901_Sunbreak', stage: 'auto-slot' }),
      z = parseIgz(built.buffer);
    const object = (encoded) => z.objects.find((o) => o.encoded === encoded);
    const original = (id) => object(before.objects[id].encoded);
    const script = original(2496),
      list = object(z.pointerReferencesByOffset.get(script.offset + 40).encoded);
    assert.equal(z.u32(list.offset + 12), 3027);
    const data = z.pointerReferencesByOffset.get(list.offset + 32).targetOffset;
    const row = (n) => object(z.pointerReferencesByOffset.get(data + n * 8).encoded);
    assert.equal(row(1724).encoded, before.objects[3973].encoded);
    assert.equal(row(1725).encoded, before.objects[3974].encoded);
    assert.equal(row(1729).encoded, before.objects[21086].encoded);
    assert.equal(row(1730).encoded, before.objects[1338].encoded);
    for (const n of [1731, 1732])
      assert.equal(z.pointerReferencesByOffset.get(row(n).offset + 88).encoded, before.objects[1237].encoded);
    assert.equal(row(1734).encoded, before.objects[1254].encoded);
    assert.equal(row(1735).encoded, before.objects[1285].encoded);
    assert.equal(row(1736).encoded, before.objects[3978].encoded);
    assert.deepEqual(
      built.manifest.branchAdjustments.map((a) => [a.objectId, a.before, a.after]),
      [
        [2498, 2644, 2646],
        [3071, 2132, 2134],
        [3647, 59, 61],
        [3973, 10, 12],
      ],
    );
    assert.equal(row(2646 + 2).encoded, before.objects[4738].encoded);
    assert.equal(row(2647 + 2).encoded, before.objects[4740].encoded);
    assert.equal(row(2648 + 2).encoded, before.objects[1126].encoded);
    assert.equal(row(2650 + 2).encoded, before.objects[2967].encoded);
    assert.equal(row(2654 + 2).encoded, before.objects[4746].encoded);
    assert.equal(row(2655 + 2).encoded, before.objects[6377].encoded);
    assert.equal(row(2657 + 2).encoded, before.objects[6381].encoded);
    assert.equal(z.unresolvedFixupEntries.length, 0);
    assert.equal(built.manifest.autoSlot.newGame, false);
    assert.equal(built.manifest.autoSlot.slot, 0);
  },
);
test(
  'auto-slot executes native title-controller binding without constructing the title presentation',
  { skip: !present },
  () => {
    const built = patchFastbootTitle(input, { map: 'Level_314_Tutorial_2', stage: 'auto-slot' }),
      z = parseIgz(built.buffer);
    const at = (encoded) => z.objects.find((o) => o.encoded === encoded),
      original = (id) => at(before.objects[id].encoded);
    const script = original(4749),
      list = at(z.pointerReferencesByOffset.get(script.offset + 40).encoded);
    const data = z.pointerReferencesByOffset.get(list.offset + 32).targetOffset;
    const row = (n) => at(z.pointerReferencesByOffset.get(data + n * 8).encoded);
    assert.equal(row(226).encoded, before.objects[6185].encoded);
    assert.equal(row(227).type, 'OpAbstractFlow');
    assert.equal(227 + 1 + built.buffer.readUInt16LE(row(227).offset + 50), 536);
    assert.deepEqual(
      Array.from({ length: 6 }, (_, i) => row(536 + i).encoded),
      [4263, 1423, 4266, 6216, 1254, 1285].map((id) => before.objects[id].encoded),
    );
    assert.equal(row(542).type, 'OpAbstractFlow');
    assert.equal(542 + 1 + built.buffer.readUInt16LE(row(542).offset + 50), 655);
    assert.equal(row(655).encoded, before.objects[6310].encoded);
    assert.equal(row(683).encoded, before.objects[6339].encoded);
    assert.equal(row(706).encoded, before.objects[6349].encoded);
    for (const id of [6185, 4263, 4266, 6216, 6310, 6339, 6349]) {
      const old = before.objects[id],
        cur = original(id),
        a = Buffer.from(input.subarray(old.offset, old.offset + old.size)),
        b = Buffer.from(built.buffer.subarray(cur.offset, cur.offset + cur.size));
      a.writeUInt32LE(0, 8);
      b.writeUInt32LE(0, 8);
      assert.deepEqual(a, b);
    }
    assert.equal(
      built.manifest.changes.some((c) => c.scriptId === 2496 && c.row >= 2650 && c.row <= 2658),
      false,
    );
  },
);
