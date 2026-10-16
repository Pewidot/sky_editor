import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import readline from 'node:readline';
import { crc16, createFigure, inspectFigure } from '../tools/sky_figure.mjs';
import { PortalController } from '../tools/portal_controller.mjs';

test('startup milestones are bounded, deduplicated observations, not gameplay readiness', () => {
  const portal = new PortalController();
  portal.spawnStartedAt = 0;
  const opened = (file) =>
    portal.outputLine(
      `[Kernel.Fs] <Info> file_system.cpp:81 open: path = /app0/${file} flags = 0x0 mode = 0777`,
      'stdout',
    );
  opened('level/title.bld');
  opened('level/title.bld');
  opened('movies/atvinewlogo_640.mov');
  opened('save/private-file');
  opened('level/../private');
  assert.deepEqual(
    portal.status().startup.milestones.map((e) => e.file),
    ['level/title.bld', 'movies/atvinewlogo_640.mov'],
  );
  assert.equal(portal.ready, false);
  for (let i = 0; i < 200; i++) opened(`level/test${i}.bld`);
  assert.equal(portal.status().startup.milestones.length, 128);
  assert.ok(portal.status().startup.milestones.every((e) => e.elapsedMs >= 0));
  const copied = portal.status().startup.milestones;
  copied[0].file = 'changed';
  assert.equal(portal.status().startup.milestones[0].file, 'level/title.bld');
});

test('blank figure uses valid serial/header checksums and sector access fields', () => {
  assert.equal(crc16(Buffer.from('123456789')), 0x29b1);
  const data = createFigure(462, 0x3000, Buffer.from([1, 2, 3, 4]));
  assert.equal(data.length, 1024);
  assert.deepEqual(inspectFigure(data), { serial: '01020304', figureId: 462, variant: 0x3000 });
  assert.equal(data.readUInt32LE(0x36), 0x690f0f0f);
  assert.equal(data.readUInt32LE(0x76), 0x69080f7f);
  assert.throws(() => createFigure(-1), /uint16/);
  data[10] ^= 1;
  assert.throws(() => inspectFigure(data), /CRC/);
  assert.throws(() => inspectFigure(Buffer.alloc(2048)), /1024/);
});

function mockPortal() {
  const portal = new PortalController();
  portal.session = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-portal-test-'));
  fs.mkdirSync(path.join(portal.session, 'figures'));
  portal.alive = portal.ready = true;
  portal.child = { stdin: new PassThrough() };
  let wire = '';
  portal.child.stdin.on('data', (data) => {
    wire += data;
  });
  return { portal, wire: () => wire };
}
test('insertion copies originals and rejects unsafe or duplicate slot commands', async () => {
  const { portal, wire } = mockPortal();
  const figure = portal.create({ figureId: 16 });
  const before = fs.readFileSync(figure.path);
  const inserted = portal.insert({ slot: 0, file: figure.path });
  assert.notEqual(inserted.writableCopy, figure.path);
  assert.deepEqual(fs.readFileSync(inserted.writableCopy), before);
  assert.match(wire(), /USB_LOAD_FIGURE\n.*\n0\n0\n/);
  assert.throws(() => portal.insert({ slot: 1, file: figure.path }), /serial/);
  assert.throws(() => portal.insert({ slot: 0, file: figure.path }), /occupied/);
  assert.throws(() => portal.insert({ slot: 16, file: figure.path }), /0\.\.15/);
  assert.throws(() => portal.insert({ slot: 2, file: 'bad\nSTOP' }), /IPC path/);
  await assert.rejects(portal.remove({ slot: 3 }), /empty/);
  await assert.rejects(portal.swap({ slot: 0, file: path.join(portal.session, 'missing') }));
  assert.ok(portal.slots[0], 'Failed swap preserves current figure');
  const second = portal.create({ figureId: 476 });
  await portal.swap({ slot: 0, file: second.path });
  assert.match(wire(), /USB_REMOVE_FIGURE\n0\n0\n1\n/);
  assert.equal(portal.slots[0].figureId, 476);
  assert.deepEqual(fs.readFileSync(figure.path), before);
  portal.ready = false;
  assert.throws(() => portal.insert({ slot: 1, file: figure.path }), /initialized/);
});

test(
  'MCP owns an isolated child, handshakes, gates USB commands and shuts down',
  { timeout: 15000 },
  async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-protocol-'));
    const emulator = path.join(temp, 'mock-shadps4');
    fs.copyFileSync(new URL('./fixtures/mock_shadps4.mjs', import.meta.url), emulator);
    fs.chmodSync(emulator, 0o700);
    const game = path.join(temp, 'synthetic-eboot');
    fs.writeFileSync(game, 'not a game');
    const child = spawn(
      process.execPath,
      [new URL('../tools/portal_controller.mjs', import.meta.url).pathname, '--mcp'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let id = 0;
    const replies = new Map();
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      const message = JSON.parse(line);
      const callback = replies.get(message.id);
      replies.delete(message.id);
      callback?.(message);
    });
    const rpc = (method, params) =>
      new Promise((resolve) => {
        const current = ++id;
        replies.set(current, resolve);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: current, method, params }) + '\n');
      });
    const call = async (name, args = {}) => {
      const response = await rpc('tools/call', { name, arguments: args });
      assert.equal(response.error, undefined, JSON.stringify(response));
      return JSON.parse(response.result.content[0].text);
    };
    try {
      assert.equal((await rpc('initialize', {})).result.serverInfo.name, 'skylanders-portal-controller');
      const listed = (await rpc('tools/list')).result.tools;
      assert.equal(listed.length, 18);
      assert.ok(listed.some((tool) => tool.name === 'portal_camera_enable'));
      assert.ok(
        listed.some(
          (tool) =>
            tool.name === 'portal_camera_move' && tool.inputSchema.properties.forward.type === 'number',
        ),
      );
      await call('portal_start', { emulator, game, session: path.join(temp, 'session') });
      let state;
      for (let attempt = 0; attempt < 100; attempt++) {
        state = await call('portal_status');
        if (state.usbBackendReady) break;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      assert.equal(state.usbBackendReady, true);
      assert.deepEqual(state.capabilities, { inputPulse: false, captureGameFrame: false });
      const unsupported = await rpc('tools/call', {
        name: 'portal_input',
        arguments: { kind: 'button', name: 'cross', durationMs: 100 },
      });
      assert.equal(unsupported.error.data.kind, 'UNSUPPORTED_CAPABILITY');
      const unsupportedCapture = await rpc('tools/call', { name: 'portal_capture', arguments: {} });
      assert.equal(unsupportedCapture.error.data.kind, 'UNSUPPORTED_CAPABILITY');
      const figure = await call('portal_create_figure', { figureId: 16 });
      const inserted = await call('portal_insert', { slot: 0, file: figure.path });
      assert.equal(inserted.acknowledged, false);
      await call('portal_remove', { slot: 0 });
      await call('portal_stop');
      const wire = fs.readFileSync(path.join(temp, 'session/mock-wire.log'), 'utf8');
      assert.ok(wire.startsWith('RUN\nSTART\n'));
      assert.match(wire, /USB_LOAD_FIGURE/);
      assert.match(wire, /USB_REMOVE_FIGURE/);
      assert.match(wire, /STOP/);
      assert.doesNotMatch(wire, /INPUT_PULSE|CAPTURE_GAME_FRAME/);
      const stopped = await call('portal_status');
      assert.equal(stopped.running, false);
      const completion = once(child, 'exit');
      child.stdin.end();
      await completion;
    } finally {
      if (child.exitCode === null) child.kill('SIGTERM');
    }
  },
);

function syntheticLaunch(settings = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-lifecycle-'));
  const emulator = path.join(temp, 'mock-shadps4');
  fs.copyFileSync(new URL('./fixtures/mock_shadps4.mjs', import.meta.url), emulator);
  fs.chmodSync(emulator, 0o700);
  const game = path.join(temp, 'synthetic-eboot');
  fs.writeFileSync(game, JSON.stringify(settings));
  return { temp, emulator, game, session: path.join(temp, 'session') };
}
async function ready(portal) {
  for (let attempt = 0; attempt < 100 && !portal.ready; ++attempt)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(portal.ready, true, JSON.stringify(portal.status()));
}

test(
  'closed IPC still stops the owned child and concurrent stop calls share teardown',
  { timeout: 10000 },
  async () => {
    const setup = syntheticLaunch({ keepAliveAfterStdinEof: true, ignoreStop: true });
    const portal = new PortalController();
    try {
      portal.start(setup);
      await ready(portal);
      portal.child.stdin.end();
      assert.equal(portal.child.stdin.writable, false);
      const first = portal.stop(),
        second = portal.stop();
      assert.equal(first, second);
      const state = await first;
      assert.equal(state.running, false);
      assert.equal(state.exit.signal, 'SIGTERM');
      assert.match(state.failure, /STOP IPC failed/);
      assert.equal(
        fs
          .readFileSync(path.join(setup.session, 'portal-events.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map(JSON.parse)
          .at(-1).operation,
        'exit',
      );
    } finally {
      await portal.stop();
    }
  },
);

test(
  'checkpoint waits for final save/close and restores isolated config plus copied figures',
  { timeout: 10000 },
  async () => {
    const setup = syntheticLaunch({ saveOnStop: true });
    const first = new PortalController(),
      resumed = new PortalController();
    try {
      first.start(setup);
      await ready(first);
      const figure = first.create({ figureId: 462, variant: 0x3000 });
      first.insert({ slot: 2, file: figure.path });
      const checkpoint = await first.checkpoint({ output: path.join(setup.temp, 'checkpoint') });
      assert.equal(first.alive, false);
      assert.equal(first.exit.code, 0);
      assert.equal(
        fs.readFileSync(path.join(checkpoint.path, 'user/home/final-save'), 'utf8'),
        'progress flushed before close',
      );
      const figureBefore = fs.readFileSync(path.join(checkpoint.path, checkpoint.figures[0].path));
      const configPath = path.join(checkpoint.path, 'user/config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config.General = {
        ...config.General,
        console_language: 5,
        home_dir: '/external/home',
        addon_install_dir: '/external/addons',
        sys_modules_dir: '/external/modules',
        font_dir: '/external/fonts',
      };
      config.Log = { enable: false, filter: '*:Critical' };
      fs.writeFileSync(configPath, JSON.stringify(config));
      const manifestPath = path.join(checkpoint.path, 'checkpoint.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const bytes = fs.readFileSync(configPath),
        record = manifest.files.find((entry) => entry.path === 'user/config.json');
      record.sha256 = createHash('sha256').update(bytes).digest('hex');
      record.size = bytes.length;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      const resumedSession = path.join(setup.temp, 'resumed');
      resumed.start({ ...setup, session: resumedSession, resumeFrom: checkpoint.path });
      await ready(resumed);
      const restored = JSON.parse(fs.readFileSync(path.join(resumedSession, 'user/config.json'), 'utf8'));
      assert.equal(restored.General.console_language, 5);
      for (const key of ['home_dir', 'addon_install_dir', 'sys_modules_dir', 'font_dir'])
        assert.equal(restored.General[key], '');
      assert.equal(restored.Log.enable, true);
      assert.equal(restored.Log.filter, '');
      assert.equal(restored.Log.sync, false);
      assert.equal(resumed.slots[2].figureId, 462);
      assert.equal(resumed.slots[2].variant, 0x3000);
      assert.ok(resumed.slots[2].writableCopy.startsWith(resumedSession + path.sep));
      assert.notEqual(resumed.slots[2].writableCopy, resumed.slots[2].source);
      assert.deepEqual(fs.readFileSync(resumed.slots[2].writableCopy), figureBefore);
      fs.writeFileSync(resumed.slots[2].writableCopy, Buffer.alloc(1024));
      assert.deepEqual(fs.readFileSync(path.join(checkpoint.path, checkpoint.figures[0].path)), figureBefore);
    } finally {
      await first.stop();
      await resumed.stop();
    }
  },
);

test(
  'a different emulator version never authorizes USB commands even with the linker marker',
  { timeout: 10000 },
  async () => {
    const setup = syntheticLaunch({ version: '0.20.0' });
    const portal = new PortalController();
    try {
      portal.start(setup);
      for (let attempt = 0; attempt < 100 && !portal.tail.includes('Execute:'); ++attempt)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(portal.handshake, true);
      assert.equal(portal.ready, false);
      const figure = portal.create({ figureId: 16 });
      assert.throws(() => portal.insert({ slot: 0, file: figure.path }), /initialized/);
    } finally {
      await portal.stop();
    }
  },
);

for (const disconnect of ['stdin EOF', 'oversized input', 'stdout disconnect', 'SIGTERM']) {
  test(`controller ${disconnect} leaves no owned synthetic child running`, { timeout: 10000 }, async () => {
    const setup = syntheticLaunch();
    const server = spawn(
      process.execPath,
      [new URL('../tools/portal_controller.mjs', import.meta.url).pathname],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    server.stdin.on('error', () => {});
    const close = once(server, 'close');
    let sequence = 0,
      ownedPid;
    const pending = new Map();
    readline.createInterface({ input: server.stdout }).on('line', (line) => {
      const response = JSON.parse(line);
      const done = pending.get(response.id);
      pending.delete(response.id);
      done?.(response);
    });
    const call = (operation, args = {}) =>
      new Promise((resolve) => {
        const id = ++sequence;
        pending.set(id, resolve);
        server.stdin.write(JSON.stringify({ id, operation, arguments: args }) + '\n');
      });
    try {
      const launched = await call('portal_start', {
        emulator: setup.emulator,
        game: setup.game,
        session: setup.session,
      });
      assert.equal(launched.error, undefined);
      ownedPid = launched.result.pid;
      let state;
      for (let attempt = 0; attempt < 100; ++attempt) {
        state = (await call('portal_status')).result;
        if (state.usbBackendReady) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(state.usbBackendReady, true);
      if (disconnect === 'stdin EOF') server.stdin.end();
      else if (disconnect === 'oversized input') server.stdin.write('x'.repeat(1024 * 1024 + 1));
      else if (disconnect === 'stdout disconnect') {
        server.stdout.destroy();
        server.stdin.write(JSON.stringify({ id: ++sequence, operation: 'portal_status' }) + '\n');
      } else server.kill('SIGTERM');
      const [code] = await close;
      assert.equal(code, 0);
      assert.throws(() => process.kill(ownedPid, 0), { code: 'ESRCH' });
      const events = fs
        .readFileSync(path.join(setup.session, 'portal-events.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse);
      assert.equal(events.at(-1).operation, 'exit');
    } finally {
      if (server.exitCode === null) {
        server.kill('SIGTERM');
        await close;
      }
      // Only a PID returned by this test's synthetic, isolated controller.
      if (ownedPid) {
        try {
          process.kill(ownedPid, 'SIGTERM');
        } catch {
          /* already stopped */
        }
      }
    }
  });
}

test(
  'fork input awaits press and release, IDs increase, capture waits for complete fresh game PNG',
  { timeout: 10000 },
  async () => {
    const setup = syntheticLaunch({ extended: true, inputDelayMs: 60, captureMode: 'partial' });
    const portal = new PortalController();
    try {
      portal.start(setup);
      await ready(portal);
      assert.deepEqual(portal.status().capabilities, { inputPulse: true, captureGameFrame: true });
      assert.equal(JSON.parse(fs.readFileSync(path.join(setup.session, 'user/config.json'))).Log.sync, false);
      const begin = Date.now();
      const input = await portal.input({ kind: 'button', name: 'cross', durationMs: 60 });
      assert.equal(input.requestId, 1);
      assert.equal(input.pressed, true);
      assert.equal(input.released, true);
      assert.equal(input.gameAccepted, false);
      assert.ok(Date.now() - begin >= 40);
      const captureBegin = Date.now();
      const capture = await portal.capture({ timeoutMs: 2000 });
      assert.equal(capture.requestId, 2);
      assert.ok(Date.now() - captureBegin >= 100);
      assert.equal(capture.fresh, true);
      assert.equal(capture.gameOnly, true);
      assert.equal(capture.width, 1);
      assert.equal(capture.height, 1);
      assert.equal(capture.sha256, createHash('sha256').update(fs.readFileSync(capture.path)).digest('hex'));
      assert.ok(capture.path.startsWith(path.join(setup.session, 'user/screenshots') + path.sep));
      assert.equal((await portal.input({ kind: 'axis', name: 'left_y_minus', durationMs: 20 })).requestId, 3);
      const wireBefore = fs.readFileSync(path.join(setup.session, 'mock-wire.log'), 'utf8');
      for (const args of [
        { kind: 'key', name: 'enter\nSTOP', durationMs: 100 },
        { kind: 'button', name: 'bad', durationMs: 100 },
        { kind: 'axis', name: 'bad', durationMs: 100 },
        { kind: 'key', name: 'w', durationMs: 2001 },
      ])
        await assert.rejects(portal.input(args));
      assert.equal(fs.readFileSync(path.join(setup.session, 'mock-wire.log'), 'utf8'), wireBefore);
      assert.equal(portal.replies.size, 0);
    } finally {
      await portal.stop();
    }
  },
);

test('capability and ACK parsing tolerates fragmented stderr, but never accepts stdout ACKs', async () => {
  const { portal, wire } = mockPortal();
  portal.consumeOutput(Buffer.from(';#IPC_ENABLED\n;ENABLE_INPUT_PULSE_V1\n;#IPC_END\n'), 'stdout');
  assert.equal(portal.handshake, false);
  portal.consumeOutput(Buffer.from(';#IPC_EN'));
  portal.consumeOutput(Buffer.from('ABLED\n;ENABLE_INPUT_PULSE_'));
  portal.consumeOutput(Buffer.from('V1\n;#IPC_END\n'));
  assert.equal(portal.capabilities.inputPulse, true);
  assert.ok(wire().startsWith('RUN\nSTART\n'));
  const pending = portal.input({ kind: 'key', name: 'enter', durationMs: 100 });
  portal.consumeOutput(Buffer.from(';INPUT_PULSE 1 pressed\n;INPUT_PULSE 1 released\n'), 'stdout');
  assert.equal(portal.replies.size, 1);
  portal.consumeOutput(Buffer.from(';INPUT_PULSE 999 released\n;INPUT_PULSE 1 pre'));
  portal.consumeOutput(Buffer.from('ssed\n;INPUT_PULSE 1 released\n'));
  assert.equal((await pending).requestId, 1);
  assert.equal(portal.replies.size, 0);
  portal.child.stdin.destroy();
});

for (const [mode, code] of [
  ['reject', 'IPC_REJECTED'],
  ['releaseOnly', 'IPC_PROTOCOL_ERROR'],
  ['exit', 'EMULATOR_STOPPED'],
]) {
  test(`fork input ${mode} rejects without reporting successful delivery`, { timeout: 5000 }, async () => {
    const setup = syntheticLaunch({ extended: true, inputMode: mode });
    const portal = new PortalController();
    try {
      portal.start(setup);
      await ready(portal);
      await assert.rejects(portal.input({ kind: 'key', name: 'enter', durationMs: 10 }), { code });
      assert.equal(portal.replies.size, 0);
    } finally {
      await portal.stop();
    }
  });
}

test(
  'missing release times out, prevents blind retry, and can observe a late release',
  { timeout: 7000 },
  async () => {
    const setup = syntheticLaunch({ extended: true, inputMode: 'pressOnly' });
    const portal = new PortalController();
    try {
      portal.start(setup);
      await ready(portal);
      await assert.rejects(portal.input({ kind: 'key', name: 'w', durationMs: 10 }), { code: 'IPC_TIMEOUT' });
      assert.deepEqual(portal.status().uncertainInputRequestIds, [1]);
      await assert.rejects(portal.input({ kind: 'key', name: 'w', durationMs: 10 }), /unconfirmed/);
      portal.consumeOutput(Buffer.from(';INPUT_PULSE 1 released\n'));
      assert.deepEqual(portal.status().uncertainInputRequestIds, []);
    } finally {
      await portal.stop();
    }
  },
);

test(
  'stop rejects a pending input immediately and still waits for its owned process to close',
  { timeout: 5000 },
  async () => {
    const setup = syntheticLaunch({ extended: true, inputMode: 'pressOnly' });
    const portal = new PortalController();
    try {
      portal.start(setup);
      await ready(portal);
      const rejected = assert.rejects(portal.input({ kind: 'key', name: 'w', durationMs: 2000 }), {
        code: 'EMULATOR_STOPPED',
      });
      await portal.stop();
      await rejected;
      assert.equal(portal.alive, false);
      assert.equal(portal.replies.size, 0);
    } finally {
      await portal.stop();
    }
  },
);

for (const mode of ['stale', 'hud', 'queuedOnly', 'silent', 'symlink']) {
  test(`capture never returns ${mode} output as a fresh game frame`, { timeout: 5000 }, async () => {
    const setup = syntheticLaunch({ extended: true, captureMode: mode });
    const outside = path.join(setup.temp, 'outside.png');
    const outsideBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    );
    fs.writeFileSync(outside, outsideBytes);
    fs.writeFileSync(setup.game, JSON.stringify({ extended: true, captureMode: mode, outside }));
    const portal = new PortalController();
    try {
      portal.start(setup);
      await ready(portal);
      await assert.rejects(portal.capture({ timeoutMs: 250 }), {
        code: mode === 'silent' ? 'IPC_TIMEOUT' : 'CAPTURE_TIMEOUT',
      });
      assert.equal(portal.captureUncertain, true);
      await assert.rejects(portal.capture({ timeoutMs: 250 }), /previous capture timed out/);
      assert.deepEqual(fs.readFileSync(outside), outsideBytes);
      assert.equal(
        (
          fs.readFileSync(path.join(setup.session, 'mock-wire.log'), 'utf8').match(/CAPTURE_GAME_FRAME/g) ??
          []
        ).length,
        1,
      );
    } finally {
      await portal.stop();
    }
  });
}

test(
  'capture forbids a symlinked profile screenshot directory before sending a command',
  { timeout: 5000 },
  async () => {
    const setup = syntheticLaunch({ extended: true });
    const portal = new PortalController();
    try {
      portal.start(setup);
      await ready(portal);
      const outside = path.join(setup.temp, 'outside');
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(setup.session, 'user/screenshots'));
      await assert.rejects(portal.capture({ timeoutMs: 250 }), /symlinks/);
      assert.doesNotMatch(
        fs.readFileSync(path.join(setup.session, 'mock-wire.log'), 'utf8'),
        /CAPTURE_GAME_FRAME/,
      );
    } finally {
      await portal.stop();
    }
  },
);

test(
  'capture rejection is distinct from timeout and does not poison later requests',
  { timeout: 5000 },
  async () => {
    const setup = syntheticLaunch({ extended: true, captureMode: 'reject' });
    const portal = new PortalController();
    try {
      portal.start(setup);
      await ready(portal);
      await assert.rejects(portal.capture({ timeoutMs: 1000 }), { code: 'IPC_REJECTED' });
      assert.equal(portal.captureUncertain, false);
      await assert.rejects(portal.capture({ timeoutMs: 1000 }), { code: 'IPC_REJECTED' });
      assert.equal(portal.nextRequestId, 2);
    } finally {
      await portal.stop();
    }
  },
);

test('stopping during a queued capture cancels file polling promptly', { timeout: 5000 }, async () => {
  const setup = syntheticLaunch({ extended: true, captureMode: 'queuedOnly' });
  const portal = new PortalController();
  try {
    portal.start(setup);
    await ready(portal);
    const rejected = assert.rejects(portal.capture({ timeoutMs: 30000 }), /stopp/);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await portal.stop();
    await rejected;
    assert.equal(portal.captureBusy, false);
    assert.equal(portal.replies.size, 0);
  } finally {
    await portal.stop();
  }
});

test(
  'MCP fork tools return released input and separate fresh screenshots using one monotonic sequence',
  { timeout: 10000 },
  async () => {
    const setup = syntheticLaunch({ extended: true });
    const server = spawn(
      process.execPath,
      [new URL('../tools/portal_controller.mjs', import.meta.url).pathname, '--mcp'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const closed = once(server, 'close');
    let sequence = 0;
    const pending = new Map();
    readline.createInterface({ input: server.stdout }).on('line', (line) => {
      const response = JSON.parse(line),
        done = pending.get(response.id);
      pending.delete(response.id);
      done?.(response);
    });
    const call = (name, args = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, (response) =>
          response.error
            ? reject(new Error(JSON.stringify(response.error)))
            : resolve(JSON.parse(response.result.content[0].text)),
        );
        server.stdin.write(
          JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) +
            '\n',
        );
      });
    try {
      await call('portal_start', { emulator: setup.emulator, game: setup.game, session: setup.session });
      let state;
      for (let attempt = 0; attempt < 100; ++attempt) {
        state = await call('portal_status');
        if (state.usbBackendReady) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(state.usbBackendReady, true);
      assert.equal(
        (await call('portal_input', { kind: 'key', name: 'enter', durationMs: 30 })).released,
        true,
      );
      const first = await call('portal_capture', { timeoutMs: 2000 });
      const second = await call('portal_capture', { timeoutMs: 2000 });
      assert.equal(first.requestId, 2);
      assert.equal(second.requestId, 3);
      assert.notEqual(first.path, second.path);
      assert.equal(second.fresh, true);
      await call('portal_stop');
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
