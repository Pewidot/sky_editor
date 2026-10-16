import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseIgz } from '../tools/igz.mjs';
import { patchLegalDurations } from '../tools/native_fastboot_legal.mjs';
const file = 'research/directboot-legal-inner.bld',
  present = fs.existsSync(file);
test('unknown assets are rejected without needing private fixtures', () => {
  assert.throws(
    () => patchLegalDurations(Buffer.from('not the supported legal payload')),
    /Original legal payload required/,
  );
});
test('only the three known presentation durations and reference counts change', { skip: !present }, () => {
  const original = fs.readFileSync(file),
    before = parseIgz(original),
    { buffer, manifest } = patchLegalDurations(original),
    after = parseIgz(buffer);
  assert.equal(manifest.runtimeValidated, false);
  assert.deepEqual(
    manifest.changes.map((c) => [c.objectId, c.row, c.beforeDuration, c.afterDuration]),
    [
      [124, 40, 0.5, 0],
      [146, 49, 5, 0],
      [160, 57, 0.5, 0],
    ],
  );
  const allowed = new Set();
  for (const c of manifest.changes)
    for (let i = 0; i < 8; i++) allowed.add(before.objects[c.objectId].offset + 64 + i);
  for (const o of before.objects) for (let i = 0; i < 4; i++) allowed.add(o.offset + 8 + i);
  assert.equal(original.length, buffer.length);
  for (let i = 0; i < original.length; i++)
    if (original[i] !== buffer[i]) assert.ok(allowed.has(i), `Unexpected byte change ${i}`);
  for (const id of [120, 158, 168, 170, 172, 174, 175, 176]) {
    const o = before.objects[id];
    assert.deepEqual(
      buffer.subarray(o.offset, o.offset + o.size),
      original.subarray(o.offset, o.offset + o.size),
    );
  }
  assert.equal(after.unresolvedFixupEntries.length, 0);
});
test('modified input is rejected', { skip: !present }, () => {
  const b = fs.readFileSync(file);
  b[100] ^= 1;
  assert.throws(() => patchLegalDurations(b), /Original legal/);
});
