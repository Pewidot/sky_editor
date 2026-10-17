import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { parseIgz } from '../tools/igz.mjs';
import { buildSunbreakProgressUi } from '../tools/sunbreak_progress_ui.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
test('Sunbreak UI policy refuses an unpinned revision', () => {
  assert.throws(() => buildSunbreakProgressUi(Buffer.alloc(100), Buffer.alloc(100)));
});
test(
  'private Sunbreak icon follows completion with an exact-ID guard, no save opcodes',
  {
    skip: process.env.SKY_SUNBREAK_UI !== '1',
  },
  () => {
    const source = fs.readFileSync('builds/chapter-sunbreak-registration-04/ui/new-level.bld'),
      original = fs.readFileSync('research/ui_levelselect/level.bld');
    const before = sha(source),
      originalHash = sha(original),
      r = buildSunbreakProgressUi(source, original),
      z = parseIgz(r.buffer);
    assert.equal(sha(source), before);
    assert.equal(sha(original), originalHash);
    assert.equal(z.unresolvedFixupEntries.length, 0);
    const at = (e) => z.objectsByOffset.get(z.resolvePointer(e).offset),
      ref = (o, offset) => z.objects[z.pointerReferencesByOffset.get(o.offset + offset).targetObjectIndex];
    const entries = (o) => {
      const p = z.pointerReferencesByOffset.get(o.offset + 32).targetOffset;
      return Array.from({ length: z.u32(o.offset + 12) }, (_, i) => Number(z.u64(p + i * 8)));
    };
    const rows = r.manifest.rows.map(at),
      old = parseIgz(original),
      oldObject = (id) => at(old.objects[id].encoded);
    assert.deepEqual(
      rows.map((o) => o.type),
      ['OpCheckValue', 'OpSetValue', 'OpSetValue', 'OpSetValue', 'OpSetValue'],
    );
    assert.equal(z.u32(rows[0].offset + 64), 1);
    assert.equal(z.buffer.readUInt16LE(rows[0].offset + 50), 4);
    assert.equal(z.u32(ref(ref(rows[0], 72), 16).offset + 64), 19);
    for (let i = 1; i < 5; i++) assert.deepEqual(entries(ref(rows[i], 56)), [old.objects[3623 + i].encoded]);
    const completion = ref(ref(rows[1], 64), 16);
    assert.deepEqual(
      entries(completion),
      [3600, 2234, 2194].map((id) => old.objects[id].encoded),
    );
    assert.equal(
      z.u64(completion.offset + 56),
      z.u64(oldObject(2212).offset + 56),
      'Completion uses the original IntMeasurement type',
    );
    assert.ok(
      !z.offsetTables.get('RPID').offsets.includes(completion.offset + 24),
      'Populated stack is not an empty literal RPID descriptor',
    );
    for (let i = 2; i < 5; i++) assert.equal(ref(rows[i], 64).encoded, old.objects[398].encoded);
    const originalRows = entries(oldObject(2175));
    assert.deepEqual(originalRows.slice(r.manifest.insertAt, r.manifest.insertAt + 5), r.manifest.rows);
    assert.equal(r.manifest.runtimeValidated, false);
  },
);
