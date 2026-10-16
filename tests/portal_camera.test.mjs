import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PortalController } from '../tools/portal_controller.mjs';

function syntheticCamera(portal, { slow = 0, failRestore = false } = {}) {
  let held = false;
  const events = [];
  portal.nativeCamera = {
    transport: { pinned: true },
    status: () => ({ enabled: held, remainingMs: held ? 15000 : 0 }),
    async enable() {
      events.push('enable-start');
      await delay(slow);
      held = true;
      events.push('enable-end');
    },
    async step() {
      events.push('step');
      await delay(slow);
    },
    async renew() {
      events.push('renew');
      await delay(slow);
    },
    async disable() {
      events.push('restore');
      if (failRestore) throw Error('synthetic restore failure');
      held = false;
    },
  };
  return events;
}
function readyPortal() {
  const p = new PortalController();
  p.alive = p.ready = p.handshake = true;
  p.capabilities = { inputPulse: true, captureGameFrame: true };
  return p;
}
async function ownedMock() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-camera-owner-'));
  const emulator = path.join(directory, 'mock-shadps4'),
    game = path.join(directory, 'synthetic-game');
  fs.copyFileSync(new URL('./fixtures/mock_shadps4.mjs', import.meta.url), emulator);
  fs.chmodSync(emulator, 0o700);
  fs.writeFileSync(game, JSON.stringify({ extended: true }));
  const p = new PortalController();
  p.start({ emulator, game, session: path.join(directory, 'session') });
  for (let i = 0; i < 100 && !p.ready; i++) await delay(20);
  assert.ok(p.ready);
  return p;
}
test('camera status is read-only and availability never claims validation', () => {
  const p = readyPortal();
  assert.equal(p.cameraStatus().validated, false);
  assert.equal(p.cameraStatus().available, true);
  assert.equal(p.cameraStatus().maximumTravel, null);
  assert.equal(p.cameraStatus().maximumStep, 5);
  p.capabilities.captureGameFrame = false;
  assert.equal(p.cameraStatus().available, false);
});
test('renewal uses the same owned-operation gate and retains the active hold', async () => {
  const p = readyPortal(),
    events = syntheticCamera(p, { slow: 10 });
  await p.cameraEnable();
  const renewal = p.cameraRenew({ durationMs: 8000 });
  await assert.rejects(p.cameraMove({ right: 1 }), /already running/);
  assert.equal((await renewal).enabled, true);
  await p.cameraDisable();
  assert.deepEqual(events, ['enable-start', 'enable-end', 'renew', 'restore']);
});
test('camera work gates concurrent input, captures, sequences and repeated camera requests', async () => {
  const p = readyPortal(),
    events = syntheticCamera(p, { slow: 30 });
  const enable = p.cameraEnable();
  assert.equal(p.cameraStatus().busy, true);
  await assert.rejects(p.input({ kind: 'button', name: 'cross', durationMs: 20 }), /camera request/);
  await assert.rejects(p.capture(), /camera request/);
  await assert.rejects(p.sequence({ steps: [] }), /camera request/);
  await assert.rejects(p.cameraMove({ right: 1 }), /already running/);
  const state = await enable;
  assert.equal(state.busy, false);
  assert.equal(state.enabled, true);
  await p.cameraDisable();
  assert.deepEqual(events, ['enable-start', 'enable-end', 'restore']);
});
test('native camera refuses overlapping captures/routes, but restore is allowed after uncertainty', async () => {
  const p = readyPortal();
  syntheticCamera(p);
  p.captureBusy = true;
  await assert.rejects(p.cameraEnable(), /completion/);
  p.captureBusy = false;
  p.sequenceAbort = new AbortController();
  await assert.rejects(p.cameraEnable(), /completion/);
  p.sequenceAbort = null;
  await p.cameraEnable();
  p.captureUncertain = true;
  p.uncertainInputs.add(1);
  await assert.rejects(p.cameraMove({ right: 1 }), /completion/);
  assert.equal((await p.cameraDisable()).enabled, false);
});
test('owned stop waits for camera work and restores before stopping the emulator', async () => {
  const p = await ownedMock();
  p.capabilities.captureGameFrame = true;
  const events = syntheticCamera(p, { slow: 40 });
  const enable = p.cameraEnable(),
    stop = p.stop();
  try {
    await enable;
    await stop;
    assert.deepEqual(events, ['enable-start', 'enable-end', 'restore']);
    assert.equal(p.alive, false);
    assert.equal(p.exit.code, 0);
  } finally {
    await p.stop();
  }
});
test('restore failure cannot prevent termination of the owned child', async () => {
  const p = await ownedMock();
  p.capabilities.captureGameFrame = true;
  syntheticCamera(p, { failRestore: true });
  try {
    await p.cameraEnable();
    await p.stop();
    assert.equal(p.alive, false);
    assert.match(p.failure, /restore failed/);
  } finally {
    await p.stop();
  }
});
test('an unsupported executable fails before camera writes and leaves its child running', async () => {
  const p = await ownedMock();
  p.capabilities.captureGameFrame = true;
  try {
    await assert.rejects(p.cameraEnable(), /Unsupported game executable|process executable changed/);
    assert.equal(p.alive, true);
    assert.equal(p.nativeCamera.status().enabled, false);
    assert.equal(p.nativeCamera.transport.pinned, false);
  } finally {
    await p.stop();
  }
});
