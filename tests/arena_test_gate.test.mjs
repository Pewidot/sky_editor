import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ARENA_TEST_GATE,
  ARENA_RETURN_GATE,
  patchArenaTestGate,
  buildArenaTestGate,
} from '../tools/arena_test_gate.mjs';

test('arena test gate refuses unknown payloads and pins the native-proven single field', () => {
  assert.throws(() => patchArenaTestGate(Buffer.alloc(100)), /size/);
  assert.throws(() => patchArenaTestGate(Buffer.alloc(ARENA_TEST_GATE.size)), /SHA-256/);
  assert.equal(ARENA_TEST_GATE.objectOffset + ARENA_TEST_GATE.fieldOffset, 0x18c2dc);
  assert.equal(ARENA_TEST_GATE.originalOperator, 4);
  assert.equal(ARENA_TEST_GATE.testOperator, 2);
});

test('separate return-menu profile remains exact-hash guarded', () => {
  assert.equal(ARENA_RETURN_GATE.objectOffset + ARENA_RETURN_GATE.fieldOffset, 0x965b0);
  assert.throws(() => patchArenaTestGate(Buffer.alloc(ARENA_RETURN_GATE.size)), /SHA-256/);
});

const input = process.env.SKYLANDERS_TEST_TITLE;
test('exact private Title payload changes only its shared arena debug comparison', { skip: !input }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-arena-gate-'));
  try {
    const before = fs.readFileSync(input),
      output = path.join(dir, 'level.bld');
    const built = buildArenaTestGate(input, output);
    assert.deepEqual(built.changedBytes, [{ offset: 0x18c2dc, before: 4, after: 2 }]);
    assert.deepEqual(fs.readFileSync(input), before);
    assert.throws(() => buildArenaTestGate(input, output), /must both be new/);
    assert.throws(() => patchArenaTestGate(fs.readFileSync(output)), /SHA-256/);
    const manifest = JSON.parse(fs.readFileSync(output + '.manifest.json'));
    assert.equal(manifest.runtimeValidated, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const returnInput = process.env.SKYLANDERS_TEST_ARENA_MENU;
test(
  'exact private return-menu payload changes only the shared arena debug check',
  { skip: !returnInput },
  () => {
    const before = fs.readFileSync(returnInput);
    const result = patchArenaTestGate(before);
    assert.equal(result.manifest.profile, ARENA_RETURN_GATE.profile);
    assert.deepEqual(result.manifest.changedBytes, [{ offset: 0x965b0, before: 4, after: 2 }]);
    assert.deepEqual(fs.readFileSync(returnInput), before);
    assert.throws(() => patchArenaTestGate(result.bytes), /SHA-256/);
  },
);
