import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { parseIgz } from '../tools/igz.mjs';
import { buildSunbreakObjectivesUi } from '../tools/sunbreak_objectives_ui.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
test('Sunbreak objectives policy refuses unknown donor bytes', () => {
  assert.throws(() => buildSunbreakObjectivesUi(Buffer.alloc(100)), /Unsupported objectives UI revision/);
});
test(
  'private objectives policy preserves old rows and guards category and reward paths',
  {
    skip: process.env.SKY_SUNBREAK_UI !== '1',
  },
  () => {
    const source = fs.readFileSync('research/sunbreak-objectives-ui-01/level.bld'),
      hash = sha(source);
    const old = parseIgz(source),
      r = buildSunbreakObjectivesUi(source),
      z = parseIgz(r.buffer);
    assert.equal(sha(source), hash);
    assert.equal(z.unresolvedFixupEntries.length, 0);
    const at = (e) => z.objectsByOffset.get(z.resolvePointer(e).offset);
    const ref = (o, f) => z.objects[z.pointerReferencesByOffset.get(o.offset + f).targetObjectIndex];
    const list = (p, o) => {
      const data = p.pointerReferencesByOffset.get(o.offset + 32).targetOffset;
      return Array.from({ length: p.u32(o.offset + 12) }, (_, i) => Number(p.u64(data + i * 8)));
    };
    const rows = list(z, at(r.manifest.opcodeList)),
      previous = list(old, old.objects[3397]);
    assert.deepEqual(
      rows.filter((e) => !r.manifest.addedRows.includes(e)),
      previous,
    );
    assert.deepEqual(
      r.manifest.addedRows.map((e) => rows.indexOf(e)),
      [414, 415, 416, 851],
    );
    for (const [i, operator, skip] of [
      [0, 1, 1],
      [2, 5, 425],
      [3, 5, 9],
    ]) {
      const o = at(r.manifest.addedRows[i]);
      assert.equal(o.type, 'OpCheckValue');
      assert.equal(z.u32(o.offset + 64), operator);
      assert.equal(z.buffer.readUInt16LE(o.offset + 50), skip);
      assert.deepEqual(
        list(z, ref(o, 56)),
        [3966, 4172, 4427].map((id) => old.objects[id].encoded),
      );
      assert.equal(z.u32(ref(ref(o, 72), 16).offset + 64), 19);
    }
    assert.equal(at(r.manifest.addedRows[1]).type, 'OpSetValue');
    assert.equal(ref(at(r.manifest.addedRows[1]), 64).encoded, old.objects[323].encoded);
    assert.equal(rows[416 + 1 + 425], previous[839]);
    assert.equal(rows[851 + 1 + 9], previous[857]);
    // Every original branch still lands at the original target, or at a newly
    // inserted guard immediately before it. Shared flow rows remain untouched.
    for (let i = 0; i < previous.length; i++) {
      const o = old.objectsByOffset.get(old.resolvePointer(previous[i]).offset),
        d = source.readUInt16LE(o.offset + 50);
      if (d === 65535 || i + 1 + d > previous.length) continue;
      const mapped = i + (i >= 414 ? 3 : 0) + (i >= 848 ? 1 : 0),
        target = i + 1 + d;
      const expected = target + (target > 414 ? 3 : 0) + (target > 848 ? 1 : 0);
      assert.equal(
        mapped + 1 + z.buffer.readUInt16LE(at(o.encoded).offset + 50),
        expected,
        'branch at old row ' + i,
      );
    }
    assert.equal(r.manifest.runtimeValidated, false);
  },
);
