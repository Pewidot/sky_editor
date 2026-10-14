import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { PortalController } from '../tools/portal_controller.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pulse = { kind: 'button', name: 'pad_right', durationMs: 20 };
function setup(settings = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-sequence-test-'));
  const emulator = path.join(temp, 'synthetic-emulator');
  fs.copyFileSync(new URL('./fixtures/mock_shadps4.mjs', import.meta.url), emulator);
  fs.chmodSync(emulator, 0o700);
  const game = path.join(temp, 'synthetic-game');
  fs.writeFileSync(game, JSON.stringify({ extended: true, ...settings }));
  return { emulator, game, session: path.join(temp, 'session') };
}
async function ready(portal) {
  for (let i = 0; i < 100 && !portal.ready; ++i) await sleep(20);
  assert.equal(portal.ready, true);
}
function requests(portal) {
  return fs
    .readFileSync(path.join(portal.session, 'portal-events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse)
    .filter((x) => x.operation === 'ipc-request');
}

test('sequence schedules locally without captures, then returns measured release times', async () => {
  const portal = new PortalController();
  try {
    portal.start(setup());
    await ready(portal);
    const result = await portal.sequence({ steps: [pulse, pulse, pulse], intervalMs: 200 });
    assert.equal(result.complete, true);
    assert.equal(result.completed, 3);
    assert.equal(result.cancelled, false);
    assert.equal(result.gameAccepted, false);
    assert.deepEqual(
      result.steps.map((x) => x.requestId),
      [1, 2, 3],
    );
    for (const [i, step] of result.steps.entries()) {
      assert.equal(step.released, true);
      assert.ok(step.releasedMs - step.startedMs >= 15);
      if (i) assert.ok(step.startedMs - result.steps[i - 1].startedMs >= 195);
    }
    assert.equal(requests(portal).length, 3);
    assert.ok(requests(portal).every((x) => x.command === 'INPUT_PULSE'));
    assert.equal(portal.status().sequenceRunning, false);
  } finally {
    await portal.stop();
  }
});

test('whole sequence validation rejects bad later steps before sending anything', async () => {
  const portal = new PortalController();
  try {
    portal.start(setup());
    await ready(portal);
    for (const args of [
      { steps: [] },
      { steps: Array(31).fill(pulse) },
      { steps: [pulse], intervalMs: 99 },
      { steps: [pulse, { ...pulse, name: 'invalid' }] },
      { steps: [pulse, { ...pulse, unexpected: 1 }] },
      { steps: [pulse, null] },
      { steps: [{ ...pulse, durationMs: 100 }], intervalMs: 100 },
      { steps: Array(30).fill(pulse), intervalMs: 2000 },
    ])
      await assert.rejects(portal.sequence(args));
    assert.equal(requests(portal).length, 0);
  } finally {
    await portal.stop();
  }
});

test('sequence copies its plan and cancellation interrupts spacing without sending another input', async () => {
  const portal = new PortalController();
  try {
    portal.start(setup());
    await ready(portal);
    const steps = [{ ...pulse }, { ...pulse }];
    const pending = portal.sequence({ steps, intervalMs: 1000 });
    steps[1].name = 'invalid';
    assert.equal(portal.status().sequenceRunning, true);
    await assert.rejects(portal.input(pulse), /sequence is running/);
    await assert.rejects(portal.sequence({ steps: [pulse] }), /one input sequence/);
    await sleep(80);
    assert.equal(portal.cancelSequence().cancellationRequested, true);
    const result = await pending;
    assert.equal(result.cancelled, true);
    assert.equal(result.complete, false);
    assert.equal(result.completed, 1);
    assert.equal(requests(portal).length, 1);
    assert.ok(result.elapsedMs < 800);
    assert.equal(portal.cancelSequence().active, false);
    assert.equal((await portal.input(pulse)).released, true);
  } finally {
    await portal.stop();
  }
});

test('cancel during press waits for release, failures expose progress and never replay', async () => {
  const portal = new PortalController();
  try {
    portal.start(setup({ inputDelayMs: 150 }));
    await ready(portal);
    const pending = portal.sequence({ steps: [pulse, pulse], intervalMs: 200 });
    await sleep(30);
    portal.cancelSequence();
    const result = await pending;
    assert.equal(result.completed, 1);
    assert.equal(result.steps[0].released, true);
    assert.ok(result.elapsedMs >= 140);
  } finally {
    await portal.stop();
  }
  const rejected = new PortalController();
  try {
    rejected.start(setup({ inputMode: 'reject' }));
    await ready(rejected);
    await assert.rejects(rejected.sequence({ steps: [pulse, pulse] }), (error) => {
      assert.equal(error.code, 'IPC_REJECTED');
      assert.deepEqual(error.sequenceProgress, { requested: 2, completed: 0, steps: [], retrySafe: false });
      return true;
    });
    assert.equal(requests(rejected).length, 1);
    assert.equal(rejected.status().sequenceRunning, false);
  } finally {
    await rejected.stop();
  }
});

test('late replies cannot cause a catch-up burst', async () => {
  const portal = new PortalController();
  try {
    portal.start(setup({ inputDelayMs: 180 }));
    await ready(portal);
    const result = await portal.sequence({ steps: [pulse, pulse, pulse], intervalMs: 100 });
    for (let i = 1; i < result.steps.length; ++i)
      assert.ok(result.steps[i].startedMs - result.steps[i - 1].releasedMs >= 8);
  } finally {
    await portal.stop();
  }
});

test('audit stalls do not compress actual native send spacing', async () => {
  const portal = new PortalController();
  try {
    portal.start(setup());
    await ready(portal);
    const originalRecord = portal.record.bind(portal);
    let delayed = false;
    portal.record = (operation, details) => {
      if (operation === 'ipc-request' && !delayed) {
        delayed = true;
        // Simulate synchronous audit-storage latency before the actual send.
        const until = performance.now() + 100;
        while (performance.now() < until) {
          /* bounded synthetic stall */
        }
      }
      return originalRecord(operation, details);
    };
    const result = await portal.sequence({ steps: [pulse, pulse], intervalMs: 200 });
    const [first, second] = result.steps;
    assert.ok(first.startedMs >= 95);
    assert.ok(second.timing.sentAtMonotonicMs - first.timing.sentAtMonotonicMs >= 200);
    assert.ok(second.startedMs - first.startedMs >= 200);
  } finally {
    await portal.stop();
  }
});

test(
  'MCP cancellation and status bypass a running sequence; invalid nested input is rejected',
  { timeout: 10000 },
  async () => {
    const launch = setup();
    const server = spawn(
      process.execPath,
      [new URL('../tools/portal_controller.mjs', import.meta.url).pathname, '--mcp'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const closed = once(server, 'close');
    const pending = new Map();
    let id = 0;
    readline.createInterface({ input: server.stdout }).on('line', (line) => {
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    });
    const rpc = (name, args = {}) =>
      new Promise((resolve) => {
        const requestId = ++id;
        pending.set(requestId, resolve);
        server.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: requestId,
            method: 'tools/call',
            params: { name, arguments: args },
          }) + '\n',
        );
      });
    const result = (response) => {
      assert.equal(response.error, undefined, JSON.stringify(response));
      return JSON.parse(response.result.content[0].text);
    };
    try {
      result(await rpc('portal_start', launch));
      let state;
      for (let i = 0; i < 100; ++i) {
        state = result(await rpc('portal_status'));
        if (state.usbBackendReady) break;
        await sleep(20);
      }
      assert.equal(state.usbBackendReady, true);
      assert.ok((await rpc('portal_sequence', { steps: [pulse, { ...pulse, name: 'bad' }] })).error);
      const sequence = rpc('portal_sequence', { steps: [pulse, pulse, pulse], intervalMs: 1000 });
      await sleep(100);
      assert.equal(result(await rpc('portal_status')).sequenceRunning, true);
      assert.equal(result(await rpc('portal_cancel_sequence')).active, true);
      assert.equal(result(await sequence).completed, 1);
      const nextSequence = rpc('portal_sequence', { steps: [pulse, pulse, pulse], intervalMs: 1000 });
      await sleep(100);
      const stopped = rpc('portal_stop');
      const cancelled = result(await nextSequence);
      assert.equal(cancelled.completed, 1);
      assert.equal(cancelled.cancelled, true);
      result(await stopped);
      server.stdin.end();
      assert.equal((await closed)[0], 0);
    } finally {
      if (server.exitCode === null) {
        server.kill('SIGTERM');
        await closed;
      }
    }
  },
);
