// Source-bound result-screen policy for the short Sunbreak mission. The stock
// macro constructs collectible/enemy goals even when a level supplies none.
// Keep its real story-goal loop, but omit those unrelated categories for ID19.
// No portal-master star is written into an older adventure's bit allocation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseIgz } from './igz.mjs';
import { appendIgz, inspectAppendTarget } from './igz_append.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
export const SUNBREAK_OBJECTIVES_UI_SOURCE =
  'b412ed5639096a1aaeb76bf8e1a396ef02f2c703e225b75f5c3190d525f4f766';

export function buildSunbreakObjectivesUi(source) {
  assert.equal(sha(source), SUNBREAK_OBJECTIVES_UI_SOURCE, 'Unsupported objectives UI revision');
  const z = parseIgz(source),
    t = inspectAppendTarget(source, sha(source));
  const payload = Buffer.alloc(2048),
    objects = [],
    fixups = {};
  let cursor = 0;
  const slot = (kind, at) => (fixups[kind] ??= new Set()).add(at);
  function clone(id) {
    const o = z.objects[id],
      at = cursor;
    cursor += Math.ceil(o.size / 8) * 8;
    assert.ok(cursor <= payload.length);
    source.copy(payload, at, o.offset, o.offset + o.size);
    objects.push({ offset: at, type: o.type });
    for (const [kind, table] of z.offsetTables) {
      if (['ROOT', 'RVTB'].includes(kind)) continue;
      for (const loc of table.offsets)
        if (loc >= o.offset && loc < o.offset + o.size) slot(kind, at + loc - o.offset);
    }
    return at;
  }
  const ptr = (at, to) => {
    payload.writeBigUInt64LE(BigInt(to), at);
    slot('ROFS', at);
  };
  const local = (at, to) => ptr(at, t.appendOffset + to);
  const threshold = clone(323),
    value = clone(324);
  local(threshold + 16, value);
  payload.writeUInt32LE(19, value + 64);
  const identity = clone(3971),
    data = cursor;
  cursor += 24;
  payload.writeUInt32LE(3, identity + 12);
  payload.writeUInt32LE(3, identity + 16);
  payload.writeUInt32LE(24, identity + 24);
  local(identity + 32, data);
  [3966, 4172, 4427].forEach((id, i) => ptr(data + i * 8, z.objects[id].encoded));
  function guard(operator, skip) {
    const at = clone(3970);
    local(at + 56, identity);
    local(at + 72, threshold);
    payload.writeUInt32LE(operator, at + 64);
    payload.writeUInt16LE(skip, at + 50);
    return at;
  }
  const equal = guard(1, 1),
    singleTab = clone(3959),
    skipCommon = guard(5, 425),
    skipStarWrite = guard(5, 9);
  const added = [equal, singleTab, skipCommon, skipStarWrite];
  const code = z.objects[3397],
    array = z.pointerReferencesByOffset.get(code.offset + 32).targetOffset;
  const oldRows = Array.from({ length: z.u32(code.offset + 12) }, (_, i) => Number(z.u64(array + i * 8)));
  assert.equal(oldRows.length, 2746);
  assert.equal(oldRows[414], z.objects[3988].encoded);
  assert.equal(oldRows[848], z.objects[4424].encoded);
  assert.equal(oldRows[857], z.objects[330].encoded);
  const a = appendIgz(source, {
    expectedSha256: sha(source),
    appendedDefaultPool: payload.subarray(0, cursor),
    appendedObjects: objects,
    fixupSlots: Object.fromEntries(Object.entries(fixups).map(([k, v]) => [k, [...v].sort((a, b) => a - b)])),
    objectLists: [
      { listEncoded: code.encoded, expectedType: 'OpCodeList', insertAt: 414, appendObjects: added },
    ],
  });
  const buffer = Buffer.from(a.buffer);
  let out = parseIgz(buffer);
  const at = (e) => out.objectsByOffset.get(out.resolvePointer(e).offset),
    newCode = at(code.encoded);
  const newArray = out.pointerReferencesByOffset.get(newCode.offset + 32).targetOffset;
  const finalRows = [
    ...oldRows.slice(0, 414),
    ...added.slice(0, 3).map((o) => t.appendOffset + o),
    ...oldRows.slice(414, 848),
    t.appendOffset + skipStarWrite,
    ...oldRows.slice(848),
  ];
  // All list elements remain ROFS object pointers; only the fourth new row
  // moves. Relocations and reference multiplicities are unchanged by this move.
  finalRows.forEach((e, i) => {
    assert.ok(out.offsetTables.get('ROFS').offsets.includes(newArray + i * 8));
    buffer.writeBigUInt64LE(BigInt(e), newArray + i * 8);
  });
  const branchEdits = [];
  for (let row = 0; row < oldRows.length; row++) {
    const o = z.objectsByOffset.get(z.resolvePointer(oldRows[row]).offset),
      delta = source.readUInt16LE(o.offset + 50);
    if (delta === 65535) continue;
    const target = row + 1 + delta;
    const extra = (row < 414 && target > 414 ? 3 : 0) + (row < 848 && target > 848 ? 1 : 0);
    if (!extra) continue;
    assert.equal(
      oldRows.filter((e) => e === o.encoded).length,
      1,
      'Shared crossing branch needs a row-local clone',
    );
    assert.ok(delta + extra < 65535);
    buffer.writeUInt16LE(delta + extra, at(o.encoded).offset + 50);
    branchEdits.push({ row, encoded: o.encoded, type: o.type, before: delta, after: delta + extra });
  }
  assert.deepEqual(
    branchEdits.map((e) => e.row),
    [0, 4, 371, 840, 841, 846],
  );
  out = parseIgz(buffer);
  const counts = (p) => {
    const m = new Map();
    for (const r of p.pointerReferences)
      if (r.targetObjectIndex !== null) {
        const e = p.objects[r.targetObjectIndex].encoded;
        m.set(e, (m.get(e) ?? 0) + 1);
      }
    return m;
  };
  const before = counts(z),
    after = counts(out);
  for (const o of z.objects)
    if ((before.get(o.encoded) ?? 0) !== (after.get(o.encoded) ?? 0)) {
      assert.equal(z.u32(o.offset + 8), before.get(o.encoded) ?? 0);
      buffer.writeUInt32LE(after.get(o.encoded) ?? 0, at(o.encoded).offset + 8);
    }
  for (const o of objects) {
    const e = t.appendOffset + o.offset;
    buffer.writeUInt32LE(after.get(e) ?? 0, at(e).offset + 8);
  }
  assert.equal(parseIgz(buffer).unresolvedFixupEntries.length, 0);
  return {
    buffer,
    manifest: {
      schema: 'skylanders-sunbreak-objectives-ui-v1',
      sourceSha256: sha(source),
      outputSha256: sha(buffer),
      adventureId: 19,
      opcodeList: code.encoded,
      addedRows: added.map((o) => t.appendOffset + o),
      branchEdits,
      policy:
        'ID19 only: original story goals, one results tab, no aliased portal-master star writes; all other IDs retain the original path.',
      runtimeValidated: false,
      limitation: 'This does not allocate new portal-master stars or add collectibles/enemies.',
      append: a.manifest,
    },
  };
}
