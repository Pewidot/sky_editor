import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { parseIgz } from '../tools/igz.mjs';
import { buildSunbreakMission } from '../tools/native_sunbreak_mission.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
test('mission rejects unrelated source bytes before constructing a script', () => {
  assert.throws(
    () =>
      buildSunbreakMission({
        world: Buffer.alloc(100),
        global: Buffer.alloc(100),
        soda: Buffer.alloc(100),
        skipPropertyFields: true,
      }),
    /Unsupported mission donor/,
  );
});
test(
  'private mission has independent behavior owners and fail-closed goal branches',
  {
    skip: process.env.SKY_NATIVE_MISSION !== '1',
  },
  () => {
    const inputs = {
      world: fs.readFileSync('builds/sunbreak-world-03/level.bld'),
      global: fs.readFileSync('research/permanent_global/level.bld'),
      soda: fs.readFileSync('research/chapter-catalog-v2/level_313_tutorial/level.bld'),
    };
    const hashes = Object.fromEntries(Object.entries(inputs).map(([k, b]) => [k, sha(b)]));
    const r = buildSunbreakMission({ ...inputs, skipPropertyFields: true }),
      z = parseIgz(r.buffer),
      old = parseIgz(inputs.world);
    for (const [k, b] of Object.entries(inputs)) assert.equal(sha(b), hashes[k]);
    assert.equal(z.unresolvedFixupEntries.length, 0);
    assert.equal(r.manifest.runtimeValidated, false);
    assert.equal(r.manifest.completionVerified, false);
    const object = (e) => z.objectsByOffset.get(z.resolvePointer(e).offset),
      ref = (o, n) => z.objects[z.pointerReferencesByOffset.get(o.offset + n).targetObjectIndex];
    const meta = (o, n) => {
      const f = z.fixupMap.get('EXNM'),
        index = Number(z.u64(o.offset + n) & 0x7fffffffffffffffn);
      assert.ok(z.offsetTables.get('RNEX').offsets.includes(o.offset + n));
      return z.strings[z.u32(f.dataOffset + index * 8)];
    };
    const root = object(z.offsetTables.get('ROOT').encodedOffsets[0]);
    const rootData = z.resolvePointer(z.u64(root.offset + 32)).offset;
    const roots = new Set(
      Array.from({ length: z.u32(root.offset + 12) }, (_, i) => Number(z.u64(rootData + i * 8))),
    );
    for (const c of r.manifest.controllers) {
      const actor = object(c.actorEncoded),
        script = object(c.scriptEncoded);
      assert.equal(actor.type, 'tfbActorInfo');
      assert.equal(ref(actor, 248).encoded, script.encoded);
      assert.equal(z.u32(actor.offset + 8), 2);
      assert.equal(ref(script, 40).type, 'OpCodeList');
      assert.ok(roots.has(script.encoded), 'Script must participate in native ROOT registration');
      assert.equal(z.u32(script.offset + 8), 2);
      const rows = c.rows.map((row) => object(row.encoded));
      assert.equal(rows[6].type, 'OpUserBehavior');
      assert.equal(z.buffer.readUInt16LE(rows[0].offset + 50) + 1, 6);
      assert.equal(6 + 1 + z.buffer.readUInt16LE(rows[6].offset + 50), rows.length);
      assert.equal(rows.at(-1).type, 'OpFlowBuiltInBehavior');
      const checks = rows.filter((o) => o.type === 'OpCheckValue');
      assert.equal(checks.length, c.name === 'beacon' ? 4 : 2);
      for (const check of checks.slice(0, c.name === 'beacon' ? 3 : 2)) {
        const i = rows.indexOf(check);
        assert.equal(i + 1 + z.buffer.readUInt16LE(check.offset + 50), rows.length - 1);
      }
      assert.equal(rows.filter((o) => o.type === 'OpSetValue').length, 1);
      if (c.name === 'beacon') {
        const guard = rows.at(-4),
          settle = rows.at(-3);
        assert.equal(guard.type, 'OpCheckValue');
        assert.equal(z.buffer.readUInt16LE(guard.offset + 50), 1);
        assert.equal(z.u32(guard.offset + 64), 1);
        assert.equal(settle.type, 'OpSetValue');
        assert.equal(
          rows.at(-5).type,
          'OpFlowBuiltInBehavior',
          'Consume notification only after the native completion call',
        );
        assert.equal(ref(guard, 56).encoded, ref(settle, 56).encoded);
        const rhs = ref(guard, 72);
        assert.equal(z.u32(ref(rhs, 16).offset + 64), 2);
        const settledRhs = ref(settle, 64);
        assert.equal(z.u32(ref(settledRhs, 16).offset + 64), 1);
        const lhs = ref(guard, 56),
          data = z.resolvePointer(z.u64(lhs.offset + 32)).offset;
        assert.equal(z.u32(lhs.offset + 12), 3);
        const external = z.fixupMap.get('EXID'),
          index = Number(z.u64(data) & 0x7fffffffffffffffn);
        assert.equal(z.u32(external.dataOffset + index * 8), 1730);
        for (const [i, name] of [
          [1, 'level adventure data'],
          [2, 'complete'],
        ]) {
          const member = object(Number(z.u64(data + i * 8)));
          assert.equal(member.type, 'OpCreateVariable');
          assert.equal(z.stringReferencesByOffset.get(member.offset + 56).value, name);
        }
      }
      assert.equal(rows.filter((o) => o.type === 'OpUseMacro').length, c.name === 'beacon' ? 2 : 1);
      for (const argument of rows.filter((o) => o.type === 'OpMacroParameter')) {
        assert.equal(
          z.buffer.readUInt16LE(argument.offset + 48) & 0x8000,
          0,
          'Call arguments must retain their authored RHS',
        );
        assert.equal(
          meta(ref(argument, 88), 72),
          'StringInfo',
          'Objective and destination stacks must not retain the My actor type',
        );
      }
    }
    const parameter = object(old.objects[1662].encoded),
      rhs = ref(parameter, 88),
      p = z.resolvePointer(z.u64(rhs.offset + 32)).offset;
    assert.equal(
      z.buffer.readUInt16LE(parameter.offset + 48) & 0x8000,
      0,
      'An authored argument must not be replaced with the default',
    );
    assert.equal(
      meta(parameter, 64),
      'ScriptSetReference',
      'RNEX identities must be translated, never copied as numeric modes',
    );
    assert.equal(meta(rhs, 72), 'StringInfo');
    const set = object(Number(z.u64(p))),
      list = ref(set, 48);
    assert.equal(set.type, 'ScriptSet');
    assert.equal(z.u32(list.offset + 12), 3);
    assert.equal(meta(list, 40), 'StringInfo', 'The objective list must accept strings, not actors');
    const names = z.fixupMap.get('EXID');
    const array = z.resolvePointer(z.u64(list.offset + 32)).offset;
    assert.deepEqual(
      [0, 1, 2].map((i) => z.u32(names.dataOffset + Number(z.u64(array + i * 8) & 0x7fffffffffffffffn) * 8)),
      [3052, 3053, 3054],
    );
    assert.equal(r.manifest.stateVariables.length, 2);
    for (const encoded of r.manifest.stateVariables) {
      const o = object(encoded);
      assert.equal(o.type, 'ValueInfo');
      assert.ok(roots.has(encoded), 'State values follow the original ROOT registration policy');
      assert.equal(z.u32(o.offset + 48), 0);
      assert.equal(z.u32(o.offset + 64), 0);
    }
  },
);
