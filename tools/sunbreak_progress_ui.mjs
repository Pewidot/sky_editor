// A narrow display policy for the experimental chapter, not a save migration.
// Its first icon reflects the adventure's actual completion flag. The other
// three stay neutral until this chapter has independent category accounting.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseIgz } from './igz.mjs';
import { appendIgz, inspectAppendTarget } from './igz_append.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
export function buildSunbreakProgressUi(source, original) {
  assert.equal(sha(source), '24577732f4ae112e2880871866cdabbb4c2052480aa47a42025904fab48307f9');
  assert.equal(sha(original), 'bf0879a08c951f5b2e44bdd81c0b5cebbfe9b79bdd8bbe3d3bde666d64b65f6a');
  const z = parseIgz(source),
    old = parseIgz(original),
    t = inspectAppendTarget(source, sha(source));
  const byEncoded = (p, e) => p.objectsByOffset.get(p.resolvePointer(e).offset);
  const o = (id) => byEncoded(z, old.objects[id].encoded);
  const payload = Buffer.alloc(2048),
    objects = [],
    fixups = {};
  let cursor = 0;
  const slot = (kind, at) => (fixups[kind] ??= new Set()).add(at);
  const clone = (id) => {
    const object = o(id),
      at = cursor;
    cursor += Math.ceil(object.size / 8) * 8;
    source.copy(payload, at, object.offset, object.offset + object.size);
    objects.push({ offset: at, type: object.type });
    for (const [kind, table] of z.offsetTables) {
      if (['ROOT', 'RVTB'].includes(kind)) continue;
      for (const loc of table.offsets)
        if (loc >= object.offset && loc < object.offset + object.size) slot(kind, at + loc - object.offset);
    }
    return at;
  };
  const ptr = (at, to) => {
    payload.writeBigUInt64LE(BigInt(to), at);
    slot('ROFS', at);
  };
  const local = (at, to) => ptr(at, t.appendOffset + to);
  function list(at, ids) {
    const data = cursor;
    cursor += ids.length * 8;
    payload.writeUInt32LE(ids.length, at + 12);
    payload.writeUInt32LE(ids.length, at + 16);
    payload.writeUInt32LE(ids.length * 8, at + 24);
    local(at + 32, data);
    ids.forEach((id, i) => ptr(data + i * 8, o(id).encoded));
  }
  const threshold = clone(2211),
    thresholdValue = clone(2212);
  local(threshold + 16, thresholdValue);
  payload.writeUInt32LE(19, thresholdValue + 64);
  // Use an existing three-member RHS stack. Empty literal stacks use an RPID
  // descriptor, whereas populated stacks use a byte-sized owned allocation.
  const complete = clone(2211),
    completeStack = clone(594);
  local(complete + 16, completeStack);
  payload.writeUInt32LE(0, completeStack + 64);
  list(completeStack, [3600, 2234, 2194]);
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const op = clone(i === 0 ? 2208 : 2188),
      lhs = clone(2189);
    rows.push(op);
    local(op + 56, lhs);
    list(lhs, i === 0 ? [3600, 2234, 2210] : [3623 + i]);
    if (i === 0) {
      local(op + 72, threshold);
      payload.writeUInt32LE(1, op + 64);
      payload.writeUInt16LE(4, op + 50);
    } else if (i === 1) local(op + 64, complete);
    else ptr(op + 64, o(398).encoded);
  }
  const code = o(2175),
    data = z.pointerReferencesByOffset.get(code.offset + 32).targetOffset;
  const entries = Array.from({ length: z.u32(code.offset + 12) }, (_, i) => Number(z.u64(data + i * 8)));
  const insertAt = entries.indexOf(o(3628).encoded);
  assert.equal(insertAt, 198);
  const r = appendIgz(source, {
    expectedSha256: sha(source),
    appendedDefaultPool: payload.subarray(0, cursor),
    appendedObjects: objects,
    fixupSlots: Object.fromEntries(Object.entries(fixups).map(([k, v]) => [k, [...v].sort((a, b) => a - b)])),
    objectLists: [{ listEncoded: code.encoded, expectedType: 'OpCodeList', insertAt, appendObjects: rows }],
  });
  const buffer = Buffer.from(r.buffer);
  let a = parseIgz(buffer);
  // Only the five enclosing spans cross this boundary. In particular the
  // existing exact-ID18 check ends here and must not swallow the new policy.
  for (const id of [2176, 2177, 3571, 3612, 3618]) {
    const next = byEncoded(a, o(id).encoded);
    buffer.writeUInt16LE(z.buffer.readUInt16LE(o(id).offset + 50) + 5, next.offset + 50);
  }
  const counts = (p) => {
    const m = new Map();
    for (const ref of p.pointerReferences)
      if (ref.targetObjectIndex !== null) {
        const e = p.objects[ref.targetObjectIndex].encoded;
        m.set(e, (m.get(e) ?? 0) + 1);
      }
    return m;
  };
  const before = counts(z),
    after = counts(a);
  for (const object of z.objects)
    if ((before.get(object.encoded) ?? 0) !== (after.get(object.encoded) ?? 0)) {
      assert.equal(z.u32(object.offset + 8), before.get(object.encoded) ?? 0);
      buffer.writeUInt32LE(after.get(object.encoded) ?? 0, byEncoded(a, object.encoded).offset + 8);
    }
  for (const object of objects) {
    const e = t.appendOffset + object.offset;
    buffer.writeUInt32LE(after.get(e) ?? 0, byEncoded(a, e).offset + 8);
  }
  a = parseIgz(buffer);
  assert.equal(a.unresolvedFixupEntries.length, 0);
  return {
    buffer,
    manifest: {
      sourceSha256: sha(source),
      outputSha256: sha(buffer),
      adventureId: 19,
      insertAt,
      rows: rows.map((offset) => t.appendOffset + offset),
      completionRhs: t.appendOffset + complete,
      policy:
        'Chapter20 only: first icon follows adventure.complete; other categories neutral. No save writes.',
      runtimeValidated: false,
      limitation: 'This does not allocate independent portal-master stars or change reward accounting.',
      append: r.manifest,
    },
  };
}
