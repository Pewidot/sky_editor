#!/usr/bin/env node
// A managed client of shadPS4 v0.19's stdin IPC, not another USB implementation.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { performance } from 'node:perf_hooks';
import { setTimeout as cancellableDelay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createFigure, inspectFigure } from './sky_figure.mjs';
import { createCheckpoint, restoreCheckpoint } from './runtime_checkpoint.mjs';

function check(ok, message) {
  if (!ok) throw new Error(message);
}
function ipcPath(value) {
  check(
    typeof value === 'string' && value.length && !/[\r\n\0]/.test(value) && !value.endsWith('\\'),
    'Invalid IPC path',
  );
  return path.resolve(value);
}
function slotNumber(slot) {
  check(Number.isInteger(slot) && slot >= 0 && slot < 16, 'slot must be 0..15');
  return slot;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const buttons = new Set([
  'cross',
  'circle',
  'square',
  'triangle',
  'options',
  'share',
  'l1',
  'r1',
  'l3',
  'r3',
  'pad_up',
  'pad_down',
  'pad_left',
  'pad_right',
]);
const axes = new Set([
  'left_x_minus',
  'left_x_plus',
  'left_y_minus',
  'left_y_plus',
  'right_x_minus',
  'right_x_plus',
  'right_y_minus',
  'right_y_plus',
  'l2',
  'r2',
]);
function failure(message, code = 'PORTAL_OPERATION_FAILED') {
  return Object.assign(new Error(message), { code });
}
function validateInput(args) {
  check(args && typeof args === 'object' && !Array.isArray(args), 'Expected input object');
  check(
    Object.keys(args).every((key) => ['kind', 'name', 'durationMs'].includes(key)),
    'Unknown input field',
  );
  const { kind, name, durationMs } = args;
  check(['key', 'button', 'axis'].includes(kind), 'kind must be key, button or axis');
  check(typeof name === 'string' && /^[A-Za-z0-9 _+.-]{1,32}$/.test(name), 'Invalid input name');
  check(kind !== 'button' || buttons.has(name), 'Unknown button name');
  check(kind !== 'axis' || axes.has(name), 'Unknown axis name');
  check(
    Number.isInteger(durationMs) && durationMs >= 10 && durationMs <= 2000,
    'durationMs must be 10..2000',
  );
}

export class PortalController {
  constructor() {
    this.child = null;
    this.slots = Array(16).fill(null);
    this.ready = false;
    this.handshake = false;
    this.tail = '';
    this.stopping = null;
    this.stopRequested = false;
    this.capabilities = { inputPulse: false, captureGameFrame: false };
    this.nextRequestId = 0;
    this.replies = new Map();
    this.uncertainInputs = new Set();
    this.captureBusy = false;
    this.captureUncertain = false;
    this.outputStreams = Object.fromEntries(
      ['stdout', 'stderr'].map((stream) => [stream, { decoder: new StringDecoder('utf8'), pending: '' }]),
    );
    this.startupMilestones = [];
    this.startupKeys = new Set();
    this.nativeCamera = null;
    this.cameraBusy = false;
    this.cameraOperation = null;
    this.cameraStopping = false;
  }
  start({ emulator, game, session, x11 = false, resumeFrom }) {
    check(!this.child, 'This controller has already launched a session');
    emulator = ipcPath(emulator);
    game = ipcPath(game);
    session = ipcPath(session);
    check(
      fs.statSync(emulator).isFile() && fs.statSync(game).isFile(),
      'Emulator and game must be regular files',
    );
    check(!fs.existsSync(session), 'Session directory must be new; existing profiles are never overwritten');
    check(
      !fs.existsSync(path.join(path.dirname(game), 'sce_module/libSceUsbd.sprx')),
      'LLE USB module would bypass the emulated portal; use a disposable game tree without that module',
    );
    fs.mkdirSync(session, { recursive: false, mode: 0o700 });
    const checkpoint = resumeFrom === undefined ? null : restoreCheckpoint(ipcPath(resumeFrom), session);
    for (const dir of ['user', 'figures', 'xdg-data', 'xdg-config', 'xdg-cache'])
      fs.mkdirSync(path.join(session, dir), { recursive: true, mode: 0o700 });
    const configPath = path.join(session, 'user/config.json');
    const config = checkpoint ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    // SDL's render window is embedded below a Qt input surface. Physical pads
    // must continue reaching the owned emulator while the editor has focus.
    config.Input = { ...config.Input, usb_device_backend: 1, background_controller_input: true };
    config.General = {
      ...config.General,
      connected_to_network: false,
      shad_net_enabled: false,
      home_dir: '',
      addon_install_dir: '',
      sys_modules_dir: '',
      font_dir: '',
    };
    // Readiness is deliberately tied to the pinned build's post-HLE log.
    // Restored user preferences must not suppress that evidence.
    // The pinned async sink preserves these messages (blocking overflow policy).
    // Readiness waits for receipt, not synchronous disk writes on game threads.
    config.Log = { ...config.Log, enable: true, filter: '', sync: false };
    const overrides = path.join(session, 'user/custom_configs');
    check(
      !fs.existsSync(overrides) || fs.readdirSync(overrides).length === 0,
      'Per-game config overrides are not supported in portal checkpoints',
    );
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), {
      flag: checkpoint ? 'w' : 'wx',
      mode: 0o600,
    });
    this.session = session;
    this.launchIdentity = { emulator, game };
    this.sessionRoot = fs.realpathSync(session);
    this.checkpointFigures = checkpoint?.figures ?? [];
    this.logFd = fs.openSync(path.join(session, 'emulator.log'), 'wx', 0o600);
    this.auditFd = fs.openSync(path.join(session, 'portal-events.jsonl'), 'wx', 0o600);
    const args = ['--ignore-game-patch', '--fullscreen', 'false', '--game', game];
    this.spawnStartedAt = performance.now();
    this.child = spawn(emulator, args, {
      cwd: session,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SHADPS4_ENABLE_IPC: 'true',
        XDG_DATA_HOME: path.join(session, 'xdg-data'),
        XDG_CONFIG_HOME: path.join(session, 'xdg-config'),
        XDG_CACHE_HOME: path.join(session, 'xdg-cache'),
        ...(x11 ? { SDL_VIDEODRIVER: 'x11' } : {}),
      },
    });
    this.alive = true;
    this.child.stdin.on('error', (error) => {
      this.failure = error.message;
      this.rejectReplies('Emulator input pipe failed');
    });
    const capture = (bytes, stream) => {
      try {
        fs.writeSync(this.logFd, bytes);
      } catch (error) {
        this.failure = 'Emulator log write failed: ' + error.message;
        // Avoid an uncaught callback exception detaching the owned emulator.
        void this.stop().catch((stopError) => {
          this.failure = stopError.message;
        });
        return;
      }
      this.tail = (this.tail + bytes.toString('utf8')).slice(-65536);
      this.consumeOutput(bytes, stream);
    };
    this.child.stdout.on('data', (bytes) => capture(bytes, 'stdout'));
    this.child.stderr.on('data', (bytes) => capture(bytes, 'stderr'));
    // 'error' can also mean a failed kill, not process exit. Only 'close'
    // establishes that the owned process and its output streams have ended.
    this.child.on('error', (error) => {
      this.failure = error.message;
    });
    this.child.on('close', (code, signal) => {
      this.alive = false;
      this.ready = false;
      this.exit = { code, signal };
      this.rejectReplies('Owned emulator exited before acknowledgment');
      this.record('exit', this.exit);
      fs.closeSync(this.logFd);
      fs.closeSync(this.auditFd);
      this.logFd = this.auditFd = null;
    });
    this.record('launch', { emulator, game, args, pid: this.child.pid, backend: 1, resumeFrom });
    return this.status();
  }
  consumeOutput(bytes, stream = 'stderr') {
    const state = this.outputStreams[stream];
    state.pending += state.decoder.write(bytes);
    let end;
    while ((end = state.pending.indexOf('\n')) >= 0) {
      const line = state.pending
        .slice(0, end)
        .replace(/\x1b\[[0-9;]*m/g, '')
        .replace(/\r$/, '');
      state.pending = state.pending.slice(end + 1);
      this.outputLine(line, stream);
    }
    if (state.pending.length > 65536) state.pending = ''; // Do not retain unbounded malformed log lines.
  }
  outputLine(line, stream) {
    // Times are log-receipt observations, not frame-ready acknowledgments.
    // Retain only bounded, relevant file-open milestones, never every log line.
    const opened =
      /\[Kernel\.Fs\].*open: path = \/app0\/((?:permanent|level|movies|renderer)\/[A-Za-z0-9_.-]+) flags = /.exec(
        line,
      );
    if (opened) this.noteStartup('game-file-open', opened[1]);
    if (stream === 'stderr' && !this.handshake) {
      if (line === ';#IPC_ENABLED') this.advertised = new Set();
      else if (this.advertised && [';ENABLE_INPUT_PULSE_V1', ';ENABLE_CAPTURE_GAME_FRAME_V1'].includes(line))
        this.advertised.add(line);
      else if (line === ';#IPC_END' && this.advertised && !this.stopRequested) {
        this.capabilities.inputPulse = this.advertised.has(';ENABLE_INPUT_PULSE_V1');
        this.capabilities.captureGameFrame = this.advertised.has(';ENABLE_CAPTURE_GAME_FRAME_V1');
        this.handshake = true;
        this.noteStartup('ipc-handshake');
        try {
          this.send('RUN\nSTART\n');
        } catch (error) {
          this.failure = error.message;
        }
      }
    }
    if (/Starting shadps4 emulator v0\.19\.0\b/.test(line)) this.supportedVersion = true;
    if (/\[Core\.Linker\].*Execute: Can't Load libSceLibcInternal/.test(line)) this.postHleSeen = true;
    if (!this.stopRequested && !this.ready && this.handshake && this.supportedVersion && this.postHleSeen) {
      this.ready = true;
      this.noteStartup('hle-ready');
      for (const figure of this.checkpointFigures ?? []) {
        try {
          this.insert({ slot: figure.slot, file: path.join(this.session, figure.path) });
        } catch (error) {
          this.failure = 'Figure restoration failed: ' + error.message;
        }
      }
    }
    if (stream !== 'stderr') return;
    const ack = /^;(INPUT_PULSE|CAPTURE_GAME_FRAME) ([1-9][0-9]*) ([a-z_]+)(?: (.*))?$/.exec(line);
    if (!ack) return;
    const id = Number(ack[2]),
      state = ack[3],
      reply = this.replies.get(id);
    if (reply && ack[1] === 'INPUT_PULSE' && state === 'pressed') reply.pressedAt = performance.now();
    if (
      ack[1] === 'INPUT_PULSE' &&
      (state === 'released' || state === 'cancelled_released' || state.startsWith('error'))
    ) {
      if (this.uncertainInputs.delete(id))
        this.record('ipc-late-ack', { requestId: id, command: ack[1], state });
    }
    if (!reply || reply.command !== ack[1]) return;
    this.record('ipc-ack', { requestId: id, command: ack[1], state });
    if (state.startsWith('error') || state === 'cancelled_released')
      reply.finish(failure(`${ack[1]} ${id}: ${state}${ack[4] ? ': ' + ack[4] : ''}`, 'IPC_REJECTED'));
    else if (ack[1] === 'INPUT_PULSE' && state === 'pressed') reply.pressed = true;
    else if (ack[1] === 'INPUT_PULSE' && state === 'released')
      reply.finish(
        reply.pressed
          ? null
          : failure('Input released without a preceding pressed acknowledgment', 'IPC_PROTOCOL_ERROR'),
      );
    else if (ack[1] === 'CAPTURE_GAME_FRAME' && state === 'queued') reply.finish();
  }
  rejectReplies(message) {
    for (const reply of [...this.replies.values()]) reply.finish(failure(message, 'EMULATOR_STOPPED'));
  }
  requireCapability(name) {
    check(
      this.alive && this.handshake && !this.stopRequested,
      'Wait until the owned emulator IPC handshake is ready',
    );
    if (!this.capabilities[name])
      throw failure(
        `Capability unsupported: ${name}; use the documented input-IPC fork, not the official binary`,
        'UNSUPPORTED_CAPABILITY',
      );
    check(this.ready, 'Wait until the pinned emulator has finished HLE initialization');
  }
  request(command, fields, timeoutMs) {
    check(this.nextRequestId < 2147483647, 'IPC request ID space exhausted; start a new session');
    const requestId = ++this.nextRequestId;
    return new Promise((resolve, reject) => {
      const reply = {
        command,
        pressed: false,
        finish: (error) => {
          clearTimeout(reply.timer);
          this.replies.delete(requestId);
          if (error) reject(error);
          else
            resolve({
              requestId,
              acknowledged: true,
              timing: {
                sentAtMonotonicMs: reply.sentAt,
                pressedAfterMs: reply.pressedAt === undefined ? undefined : reply.pressedAt - reply.sentAt,
                acknowledgmentAfterMs: performance.now() - reply.sentAt,
              },
            });
        },
      };
      reply.timer = setTimeout(() => {
        if (command === 'INPUT_PULSE') this.uncertainInputs.add(requestId);
        else this.captureUncertain = true;
        this.record('ipc-timeout', { requestId, command, pressed: reply.pressed });
        reply.finish(
          failure(
            `${command} ${requestId} acknowledgment timed out; delivery is unconfirmed, do not blindly retry`,
            'IPC_TIMEOUT',
          ),
        );
      }, timeoutMs);
      this.replies.set(requestId, reply);
      this.record('ipc-request', { requestId, command, fields });
      try {
        const wire = [command, requestId, ...fields].join('\n') + '\n';
        reply.sentAt = performance.now();
        this.send(wire);
      } catch (error) {
        reply.finish(error);
      }
    });
  }
  async input(args) {
    check(!this.sequenceAbort, 'An input sequence is running; cancel it before sending individual inputs');
    return this.performInput(args);
  }
  async performInput(args) {
    check(!this.cameraBusy && !this.cameraStopping, 'Wait for the native camera request');
    this.requireCapability('inputPulse');
    validateInput(args);
    const { kind, name, durationMs } = args;
    check(
      this.uncertainInputs.size === 0,
      'A previous input release is unconfirmed; wait for its late release or stop the session',
    );
    check(this.replies.size < 16, 'Too many outstanding IPC requests');
    const ack = await this.request('INPUT_PULSE', [kind, name, durationMs], durationMs + 3000);
    return {
      ...ack,
      kind,
      name,
      durationMs,
      pressed: true,
      released: true,
      gameAccepted: false,
      limitation:
        'Acknowledgments confirm emulator input delivery and release, not the game response. Inspect a fresh game frame.',
    };
  }
  async sequence({ steps, intervalMs = 1000 }) {
    check(!this.cameraBusy && !this.cameraStopping, 'Wait for the native camera request');
    this.requireCapability('inputPulse');
    check(!this.sequenceAbort, 'Only one input sequence may run');
    check(Array.isArray(steps) && steps.length >= 1 && steps.length <= 30, 'steps must contain 1..30 inputs');
    check(
      Number.isInteger(intervalMs) && intervalMs >= 100 && intervalMs <= 2000,
      'intervalMs must be 100..2000',
    );
    // Validate the WHOLE plan before sending its first command. Copy it so a
    // direct caller cannot mutate a later step after validation.
    steps = steps.map((step) => {
      validateInput(step);
      check(
        step.durationMs + 10 <= intervalMs,
        'Each pulse needs at least 10 ms released before the next step',
      );
      return { ...step };
    });
    check(
      (steps.length - 1) * intervalMs + steps.at(-1).durationMs <= 30000,
      'Sequence schedule must fit within 30 seconds',
    );
    check(
      this.replies.size === 0 && !this.captureBusy,
      'Wait for pending input/capture before starting a sequence',
    );
    const abort = new AbortController(),
      results = [],
      started = performance.now();
    this.sequenceAbort = abort;
    this.record('sequence-start', { steps, intervalMs });
    let previousStart = null;
    try {
      for (const [index, step] of steps.entries()) {
        // Actual-start spacing: late replies never cause a catch-up burst.
        const due = previousStart === null ? started : previousStart + intervalMs;
        while (performance.now() < due && !abort.signal.aborted) {
          try {
            await cancellableDelay(Math.ceil(due - performance.now()), undefined, { signal: abort.signal });
          } catch (error) {
            if (error.name !== 'AbortError') throw error;
          }
        }
        if (abort.signal.aborted) break;
        if (performance.now() - started >= 30000)
          throw failure('Sequence wall-clock budget exceeded; no further inputs sent', 'SEQUENCE_DEADLINE');
        const result = await this.performInput(step);
        previousStart = result.timing.sentAtMonotonicMs;
        results.push({
          index,
          ...result,
          startedMs: Math.round(previousStart - started),
          releasedMs: Math.round(performance.now() - started),
        });
        // Always leave a release gap, even if an ACK was abnormally slow.
        if (index + 1 < steps.length && !abort.signal.aborted) {
          try {
            await cancellableDelay(10, undefined, { signal: abort.signal });
          } catch (error) {
            if (error.name !== 'AbortError') throw error;
          }
        }
      }
      const result = {
        complete: results.length === steps.length,
        cancelled: abort.signal.aborted,
        requested: steps.length,
        completed: results.length,
        intervalMs,
        elapsedMs: Math.round(performance.now() - started),
        steps: results,
        gameAccepted: false,
        limitation:
          'Timed input delivery only, not game-state detection. Use short known routes and inspect a fresh frame at state boundaries; loading screens can ignore inputs.',
      };
      this.record('sequence-complete', result);
      return result;
    } catch (error) {
      error.sequenceProgress = {
        requested: steps.length,
        completed: results.length,
        steps: results,
        retrySafe: false,
      };
      this.record('sequence-failed', { ...error.sequenceProgress, message: error.message });
      throw error;
    } finally {
      this.sequenceAbort = null;
    }
  }
  cancelSequence() {
    const active = !!this.sequenceAbort;
    this.sequenceAbort?.abort();
    return {
      active,
      cancellationRequested: active,
      limitation:
        'Stops subsequent steps; an already pressed pulse still waits for its bounded release acknowledgment.',
    };
  }
  screenshotDirectory() {
    const root = this.sessionRoot ?? fs.realpathSync(this.session);
    for (const child of ['user', 'user/screenshots']) {
      const target = path.join(root, child);
      if (child === 'user/screenshots' && !fs.existsSync(target)) fs.mkdirSync(target, { mode: 0o700 });
      check(
        fs.lstatSync(target).isDirectory() && fs.realpathSync(target) === target,
        'Owned screenshot directory must not contain symlinks',
      );
    }
    return path.join(root, 'user/screenshots');
  }
  readGamePng(directory, name) {
    if (!/_game_[0-9]{6,}\.png$/.test(name) || path.basename(name) !== name) return null;
    let fd;
    try {
      const target = path.join(directory, name);
      const entry = fs.lstatSync(target);
      if (!entry.isFile()) return null;
      fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      if (fs.realpathSync(target) !== target) return null;
      const before = fs.fstatSync(fd);
      if (
        !before.isFile() ||
        before.ino !== entry.ino ||
        before.dev !== entry.dev ||
        before.size < 45 ||
        before.size > 64 * 1024 * 1024
      )
        return null;
      const header = Buffer.alloc(24),
        end = Buffer.alloc(12);
      if (fs.readSync(fd, header, 0, 24, 0) !== 24 || fs.readSync(fd, end, 0, 12, before.size - 12) !== 12)
        return null;
      if (
        !header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
        header.toString('ascii', 12, 16) !== 'IHDR' ||
        !end.equals(Buffer.from('0000000049454e44ae426082', 'hex'))
      )
        return null;
      const width = header.readUInt32BE(16),
        height = header.readUInt32BE(20);
      if (!width || !height || width > 32768 || height > 32768) return null;
      const data = fs.readFileSync(fd),
        after = fs.fstatSync(fd);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || data.length !== before.size)
        return null;
      let position = 8,
        hasImageData = false;
      while (position < data.length) {
        if (position + 12 > data.length) return null;
        const length = data.readUInt32BE(position),
          type = data.toString('ascii', position + 4, position + 8);
        if (position + length + 12 > data.length || (position === 8 && (type !== 'IHDR' || length !== 13)))
          return null;
        if (type === 'IDAT') hasImageData = true;
        if (type === 'IEND' && (length !== 0 || position + 12 !== data.length)) return null;
        position += length + 12;
      }
      if (!hasImageData) return null;
      return {
        path: target,
        bytes: data.length,
        width,
        height,
        sha256: createHash('sha256').update(data).digest('hex'),
      };
    } catch (error) {
      if (['ENOENT', 'ELOOP'].includes(error.code)) return null;
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  async capture({ timeoutMs = 10000 } = {}) {
    check(!this.cameraBusy && !this.cameraStopping, 'Wait for the native camera request');
    this.requireCapability('captureGameFrame');
    check(
      Number.isInteger(timeoutMs) && timeoutMs >= 250 && timeoutMs <= 30000,
      'timeoutMs must be 250..30000',
    );
    check(!this.captureBusy, 'Only one game capture may be outstanding');
    check(
      !this.captureUncertain,
      'A previous capture timed out; restart the owned session to avoid misidentifying a late image',
    );
    this.captureBusy = true;
    let queued = false;
    try {
      const deadline = performance.now() + timeoutMs;
      const throttle =
        this.lastCaptureSentAt === undefined
          ? 0
          : Math.max(0, this.lastCaptureSentAt + 275 - performance.now());
      if (throttle >= timeoutMs)
        throw failure('Capture rate limit would exceed timeout; no command sent', 'CAPTURE_RATE_LIMIT');
      if (throttle) await delay(throttle);
      check(this.alive && !this.stopRequested, 'Owned emulator stopped before capture request');
      const directory = this.screenshotDirectory(),
        before = new Set(fs.readdirSync(directory));
      if (performance.now() >= deadline)
        throw failure('Capture preparation exceeded timeout; no command sent', 'CAPTURE_TIMEOUT');
      this.lastCaptureSentAt = performance.now();
      const ack = await this.request('CAPTURE_GAME_FRAME', [], Math.max(1, deadline - performance.now()));
      queued = true;
      while (performance.now() < deadline) {
        check(this.alive && !this.stopRequested, 'Owned emulator stopped before screenshot completion');
        check(this.screenshotDirectory() === directory, 'Owned screenshot directory changed');
        for (const name of fs.readdirSync(directory).sort()) {
          if (performance.now() >= deadline) break;
          if (before.has(name)) continue;
          const image = this.readGamePng(directory, name);
          if (image && performance.now() < deadline) {
            this.record('capture-complete', { ...ack, ...image });
            return {
              ...ack,
              ...image,
              gameOnly: true,
              fresh: true,
              limitation:
                'Fresh complete native game PNG after queued acknowledgment; native filenames do not embed IPC request IDs. Do not request captures from another input source concurrently.',
            };
          }
        }
        await delay(Math.min(75, Math.max(1, deadline - performance.now())));
      }
      this.captureUncertain = true;
      this.record('capture-timeout', { requestId: ack.requestId });
      throw failure(
        'Game screenshot timed out; no fresh complete PNG was returned. Restart the session before another capture',
        'CAPTURE_TIMEOUT',
      );
    } catch (error) {
      if (queued && this.alive && !this.stopRequested) this.captureUncertain = true;
      throw error;
    } finally {
      this.captureBusy = false;
    }
  }
  record(operation, details) {
    if (this.auditFd == null) return;
    try {
      fs.writeSync(
        this.auditFd,
        JSON.stringify({ at: new Date().toISOString(), operation, ...details }) + '\n',
      );
    } catch (error) {
      this.failure = 'Portal audit write failed: ' + error.message;
    }
  }
  noteStartup(stage, file) {
    if (this.spawnStartedAt === undefined || this.startupMilestones.length >= 128) return;
    const key = stage + ':' + (file ?? '');
    if (this.startupKeys.has(key)) return;
    this.startupKeys.add(key);
    const milestone = {
      stage,
      ...(file === undefined ? {} : { file }),
      elapsedMs: performance.now() - this.spawnStartedAt,
    };
    this.startupMilestones.push(milestone);
    this.record('startup-milestone', milestone);
  }
  send(text) {
    check(this.alive && this.child?.stdin.writable, 'Emulator is not running');
    this.child.stdin.write(text);
  }
  status() {
    return {
      pid: this.child?.pid,
      session: this.session,
      running: !!this.alive,
      ipcHandshake: this.handshake,
      usbBackendReady: this.ready,
      capabilities: { ...this.capabilities },
      uncertainInputRequestIds: [...this.uncertainInputs],
      captureUncertain: this.captureUncertain,
      sequenceRunning: !!this.sequenceAbort,
      startup: {
        milestones: this.startupMilestones.map((entry) => ({ ...entry })),
        limitation:
          'Monotonic time since process spawn to log receipt; file open and HLE readiness do not prove playable gameplay.',
      },
      readinessEvidence: this.ready
        ? 'v0.19 post-HLE linker log; not a game recognition acknowledgment'
        : null,
      slots: this.slots,
      exit: this.exit,
      failure: this.failure,
      nativeCamera: this.cameraStatus(),
      limitation:
        'Slot state tracks commands sent, not acknowledgments. Confirm recognition and swaps in the game. Portal speaker audio is not implemented by this controller.',
    };
  }
  create({ figureId, variant = 0 }) {
    check(this.session, 'Start a session first');
    const data = createFigure(figureId, variant);
    const target = path.join(this.session, 'figures', `blank-${figureId}-${variant}-${randomUUID()}.sky`);
    fs.writeFileSync(target, data, { flag: 'wx', mode: 0o600 });
    const result = { path: target, ...inspectFigure(data), synthetic: true };
    this.record('create', result);
    return result;
  }
  insert({ slot, file }) {
    slotNumber(slot);
    check(this.ready && this.alive, 'Wait until the USB backend is initialized');
    check(!this.slots[slot], 'Slot is occupied; remove it or use swap');
    file = ipcPath(file);
    const stat = fs.statSync(file);
    check(stat.isFile() && stat.size === 1024, 'Figure must be a regular 1024-byte file');
    const data = fs.readFileSync(file),
      identity = inspectFigure(data);
    check(
      !this.slots.some((entry) => entry?.serial === identity.serial),
      'This figure serial is already on the portal',
    );
    // shadPS4 writes XP/progress to loaded files. Always hand it a private copy.
    const copy = path.join(this.session, 'figures', `slot-${slot}-${randomUUID()}.sky`);
    fs.writeFileSync(copy, data, { flag: 'wx', mode: 0o600 });
    this.send(`USB_LOAD_FIGURE\n${copy}\n0\n${slot}\n`);
    this.slots[slot] = { ...identity, source: file, writableCopy: copy };
    this.record('insert-sent', { slot, ...this.slots[slot] });
    return { slot, ...this.slots[slot], acknowledged: false };
  }
  async remove({ slot }) {
    slotNumber(slot);
    check(this.ready && this.alive, 'Wait until the USB backend is initialized');
    check(this.slots[slot], 'Slot is already empty; refusing unsafe upstream removal');
    this.send(`USB_REMOVE_FIGURE\n0\n${slot}\n1\n`);
    const previous = this.slots[slot];
    this.slots[slot] = null;
    this.record('remove-sent', { slot, previous });
    // Allow removing/removed status reports to be consumed before reinsertion.
    await delay(750);
    return { slot, previous, acknowledged: false };
  }
  async swap({ slot, file }) {
    // Validate replacement before removing an existing character.
    slotNumber(slot);
    file = ipcPath(file);
    check(fs.statSync(file).size === 1024, 'Figure must be 1024 bytes');
    const identity = inspectFigure(fs.readFileSync(file));
    check(
      !this.slots.some((entry, index) => index !== slot && entry?.serial === identity.serial),
      'Replacement serial is already on another slot',
    );
    if (this.slots[slot]) await this.remove({ slot });
    return this.insert({ slot, file });
  }
  cameraStatus() {
    return {
      available: !!(
        this.alive &&
        this.ready &&
        this.capabilities.captureGameFrame &&
        !this.stopRequested &&
        !this.cameraStopping
      ),
      validated: this.nativeCamera?.validated === true,
      busy: this.cameraBusy,
      ...(this.nativeCamera?.status() ?? { enabled: false, remainingMs: 0, experimental: true }),
      maximumLeaseMs: 30000,
      maximumTravel: null,
      maximumStep: 5,
      limitation:
        'Experimental exact-build native camera; validation occurs on first use. Snapshot display is not live video. No collision, distant-streaming, or FOV guarantee.',
    };
  }
  async cameraAction(method, args) {
    this.requireCapability('captureGameFrame');
    check(
      !this.cameraBusy && !this.cameraStopping,
      'A native camera operation is already running or stopping',
    );
    check(
      !this.sequenceAbort &&
        !this.captureBusy &&
        this.replies.size === 0 &&
        (method === 'disable' || (this.uncertainInputs.size === 0 && !this.captureUncertain)),
      'Wait for input/capture completion before changing the native camera',
    );
    this.cameraBusy = true;
    this.cameraOperation = (async () => {
      if (!this.nativeCamera) {
        const { OwnedNativeCamera } = await import('./native_camera_control.mjs');
        this.nativeCamera = new OwnedNativeCamera(this, this.launchIdentity);
      }
      return await this.nativeCamera[method](args);
    })();
    try {
      await this.cameraOperation;
    } finally {
      this.cameraBusy = false;
      this.cameraOperation = null;
    }
    return this.cameraStatus();
  }
  cameraEnable(args = {}) {
    return this.cameraAction('enable', args);
  }
  cameraMove(args = {}) {
    return this.cameraAction('step', args);
  }
  cameraRenew(args = {}) {
    return this.cameraAction('renew', args);
  }
  cameraUi(args = {}) {
    return this.cameraAction('setUiHidden', args);
  }
  cameraDisable() {
    return this.cameraAction('disable', 'requested');
  }
  stop() {
    if (this.stopping) return this.stopping;
    this.stopping = this.stopOwned().finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }
  async stopOwned() {
    this.cancelSequence();
    if (!this.alive) return this.status();
    // Restoration must run while ready/ownership checks still describe the
    // live child. No new input/camera work can begin during this phase.
    this.cameraStopping = true;
    try {
      await this.cameraOperation;
    } catch {
      /* teardown still owns the child */
    }
    if (this.nativeCamera?.status().enabled && !this.nativeCamera.lastFault) {
      try {
        await this.nativeCamera.disable('controller-stop');
      } catch (error) {
        this.failure = 'Native camera restore failed; stopping owned emulator: ' + error.message;
      }
    }
    this.stopRequested = true;
    this.ready = false;
    this.rejectReplies('Owned emulator is stopping');
    // A closed IPC pipe must not prevent terminating our own child.
    try {
      this.send('STOP\n');
    } catch (error) {
      this.failure = 'STOP IPC failed: ' + error.message;
    }
    for (let i = 0; i < 30 && this.alive; i++) await delay(100);
    if (this.alive) {
      try {
        this.child.kill('SIGTERM');
      } catch (error) {
        this.failure = error.message;
      }
    }
    for (let i = 0; i < 20 && this.alive; i++) await delay(100);
    if (this.alive) {
      try {
        this.child.kill('SIGKILL');
      } catch (error) {
        this.failure = error.message;
      }
    }
    for (let i = 0; i < 20 && this.alive; i++) await delay(100);
    check(!this.alive, 'Owned emulator did not close; refusing to detach or checkpoint a live process');
    return this.status();
  }
  async checkpoint({ output }) {
    check(this.session, 'Start a session first');
    output = ipcPath(output);
    await this.stop();
    check(!this.alive, 'Emulator must have fully stopped before checkpointing');
    const result = createCheckpoint(this.session, output, this.slots);
    return {
      path: result.path,
      files: result.files.length,
      figures: result.figures,
      limitation: result.limitation,
    };
  }
}

const schemas = {
  portal_start: {
    emulator: { type: 'string' },
    game: { type: 'string' },
    session: { type: 'string' },
    x11: { type: 'boolean' },
    resumeFrom: { type: 'string' },
  },
  portal_status: {},
  portal_create_figure: {
    figureId: { type: 'integer', minimum: 0, maximum: 65535 },
    variant: { type: 'integer', minimum: 0, maximum: 65535 },
  },
  portal_insert: { slot: { type: 'integer', minimum: 0, maximum: 15 }, file: { type: 'string' } },
  portal_remove: { slot: { type: 'integer', minimum: 0, maximum: 15 } },
  portal_swap: { slot: { type: 'integer', minimum: 0, maximum: 15 }, file: { type: 'string' } },
  portal_stop: {},
  portal_checkpoint: { output: { type: 'string' } },
  portal_input: {
    kind: { type: 'string', enum: ['key', 'button', 'axis'] },
    name: { type: 'string', maxLength: 32 },
    durationMs: { type: 'integer', minimum: 10, maximum: 2000 },
  },
  portal_capture: { timeoutMs: { type: 'integer', minimum: 250, maximum: 30000 } },
  portal_sequence: {
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'name', 'durationMs'],
        properties: {
          kind: { type: 'string', enum: ['key', 'button', 'axis'] },
          name: { type: 'string', maxLength: 32 },
          durationMs: { type: 'integer', minimum: 10, maximum: 2000 },
        },
      },
    },
    intervalMs: { type: 'integer', minimum: 100, maximum: 2000 },
  },
  portal_cancel_sequence: {},
  portal_camera_enable: {
    durationMs: { type: 'integer', minimum: 1000, maximum: 30000 },
    hideUi: { type: 'boolean' },
  },
  portal_camera_renew: { durationMs: { type: 'integer', minimum: 1000, maximum: 30000 } },
  portal_camera_move: Object.fromEntries(
    ['right', 'up', 'forward', 'yaw', 'pitch'].map((name) => {
      const limit = ['yaw', 'pitch'].includes(name) ? 45 : 5;
      return [name, { type: 'number', minimum: -limit, maximum: limit }];
    }),
  ),
  portal_camera_disable: {},
  portal_camera_status: {},
  portal_camera_ui: { hidden: { type: 'boolean' } },
};
const required = {
  portal_start: ['emulator', 'game', 'session'],
  portal_create_figure: ['figureId'],
  portal_insert: ['slot', 'file'],
  portal_remove: ['slot'],
  portal_swap: ['slot', 'file'],
  portal_checkpoint: ['output'],
  portal_input: ['kind', 'name', 'durationMs'],
  portal_sequence: ['steps'],
  portal_camera_ui: ['hidden'],
};
const methods = {
  portal_start: 'start',
  portal_status: 'status',
  portal_create_figure: 'create',
  portal_insert: 'insert',
  portal_remove: 'remove',
  portal_swap: 'swap',
  portal_stop: 'stop',
  portal_checkpoint: 'checkpoint',
  portal_input: 'input',
  portal_capture: 'capture',
  portal_sequence: 'sequence',
  portal_cancel_sequence: 'cancelSequence',
  portal_camera_enable: 'cameraEnable',
  portal_camera_move: 'cameraMove',
  portal_camera_renew: 'cameraRenew',
  portal_camera_disable: 'cameraDisable',
  portal_camera_status: 'cameraStatus',
  portal_camera_ui: 'cameraUi',
};
const descriptions = {
  portal_start:
    'Launch an owned shadPS4 v0.19 process with a NEW isolated profile and virtual portal. Executes the provided emulator/game.',
  portal_input:
    'Fork only: send bounded named input to the owned emulator and await pressed + released acknowledgments. No desktop injection.',
  portal_capture:
    'Fork only: request a game-only PNG and return a fresh complete file inside the owned profile; never return an old screenshot.',
  portal_sequence:
    'Fork only: up to 30 bounded inputs, scheduled locally (default one per second), without screenshots or client round trips between steps. No loading-screen detection. Inspect a frame at route boundaries.',
  portal_cancel_sequence:
    'Cancel remaining steps immediately, including while a sequence RPC is running. A pressed pulse still receives its bounded release.',
  portal_camera_enable:
    'Experimental exact-build native camera: hold the currently bound game camera for 1..30 seconds (default 15). Owned child only, source/identity validation, automatic restore. No game-file patches.',
  portal_camera_renew:
    'Renew an active native camera watchdog for 1..30 seconds (default 8). Revalidates the owned binding without moving the camera or changing restoration state. No heartbeat means automatic restoration.',
  portal_camera_move:
    'Move the held native camera in local right/up/forward game units (combined maximum 5 per request, 50 from start) and yaw/pitch degrees (maximum 45). Native projection retained. Capture a fresh frame after completion.',
  portal_camera_disable:
    'Restore the original native camera pose and updater. Stop also restores before terminating the owned emulator.',
  portal_camera_status:
    'Read camera lease status/bounds without accessing process memory. Availability is not exact-build validation.',
  portal_camera_ui:
    'Experimental: hide or restore the original sprite UI during an active camera lease. May hide all HUD/prompts. One validated viewer byte; restored with camera on disable/expiry/stop.',
};
export async function serve() {
  const portal = new PortalController();
  let accepting = true,
    cancelQueued = false;
  const emit = (value) => {
    if (!process.stdout.destroyed) process.stdout.write(JSON.stringify(value) + '\n');
  };
  async function dispatch(input) {
    if (cancelQueued) return;
    let request;
    try {
      request = JSON.parse(input);
      check(request && typeof request === 'object', 'Expected an object');
      let result;
      if (request.method === 'initialize')
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'skylanders-portal-controller', version: '0.1.0' },
        };
      else if (request.method === 'notifications/initialized') return;
      else if (request.method === 'ping') result = {};
      else if (request.method === 'tools/list')
        result = {
          tools: Object.entries(schemas).map(([name, properties]) => ({
            name,
            description:
              descriptions[name] ??
              `${name}: manage local virtual figures; loaded figure files are copied before game writes.`,
            inputSchema: {
              type: 'object',
              properties,
              required: required[name] ?? [],
              additionalProperties: false,
            },
          })),
        };
      else {
        const name = request.method === 'tools/call' ? request.params?.name : request.operation;
        check(Object.hasOwn(methods, name), 'Unknown portal operation');
        check(name !== 'portal_sequence' || accepting, 'Controller disconnected before sequence started');
        const args =
          request.method === 'tools/call' ? (request.params.arguments ?? {}) : (request.arguments ?? {});
        check(args && typeof args === 'object' && !Array.isArray(args), 'Expected arguments object');
        check(
          Object.keys(args).every((key) => Object.hasOwn(schemas[name], key)),
          'Unknown argument',
        );
        for (const key of required[name] ?? []) check(Object.hasOwn(args, key), `Missing argument: ${key}`);
        for (const [key, value] of Object.entries(args)) {
          const schema = schemas[name][key];
          check(
            schema.type === 'integer'
              ? Number.isInteger(value) && value >= schema.minimum && value <= schema.maximum
              : schema.type === 'number'
                ? Number.isFinite(value) && value >= schema.minimum && value <= schema.maximum
                : schema.type === 'array'
                  ? Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems
                  : typeof value === schema.type,
            `Invalid argument type or range: ${key}`,
          );
          check(!schema.enum || schema.enum.includes(value), `Invalid argument value: ${key}`);
          check(!schema.maxLength || value.length <= schema.maxLength, `Argument too long: ${key}`);
        }
        result = await portal[methods[name]](args);
        if (request.method === 'tools/call')
          result = { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      emit(request.jsonrpc ? { jsonrpc: '2.0', id: request.id, result } : { id: request.id, result });
    } catch (error) {
      emit(
        request?.jsonrpc
          ? {
              jsonrpc: '2.0',
              id: request.id ?? null,
              error: {
                code: -32602,
                message: error.message,
                data: {
                  kind: error.code ?? 'PORTAL_OPERATION_FAILED',
                  sequenceProgress: error.sequenceProgress,
                },
              },
            }
          : {
              id: request?.id,
              error: error.message,
              code: error.code ?? 'PORTAL_OPERATION_FAILED',
              sequenceProgress: error.sequenceProgress,
            },
      );
    }
  }
  let pending = '',
    queue = Promise.resolve();
  const shutdown = ({ cancel = false, exit = false } = {}) => {
    accepting = false;
    cancelQueued ||= cancel;
    portal.cancelSequence();
    if (cancel) {
      portal.cameraStopping = true;
      portal.rejectReplies('Controller disconnected or is shutting down');
    }
    // Serialize teardown after the in-flight operation. Otherwise a queued
    // start can run after stop(), leaving an orphan when the input disconnects.
    queue = queue.then(() => portal.stop());
    if (exit) queue = queue.then(() => process.exit());
    queue = queue.catch((error) => {
      process.stderr.write(`Portal shutdown: ${error.message}\n`);
    });
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    if (!accepting) return;
    pending += chunk;
    if (Buffer.byteLength(pending) > 1024 * 1024) {
      emit({ error: 'Input exceeds 1 MiB' });
      process.stdin.destroy();
      shutdown({ cancel: true });
      return;
    }
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (!line.trim()) continue;
      // Only cancellation and read-only status bypass serialization; no new
      // starts, inputs, captures or figure writes can interleave a route.
      let immediate = false;
      try {
        const r = JSON.parse(line);
        const name = r?.method === 'tools/call' ? r.params?.name : r?.operation;
        immediate = ['portal_cancel_sequence', 'portal_status', 'portal_camera_status'].includes(name);
        const args = r?.method === 'tools/call' ? (r.params?.arguments ?? {}) : (r?.arguments ?? {});
        // Teardown remains serialized, but a valid stop must prevent later
        // route steps now, not after the entire sequence has finished.
        if (
          name === 'portal_stop' &&
          args &&
          typeof args === 'object' &&
          !Array.isArray(args) &&
          Object.keys(args).length === 0
        )
          portal.cancelSequence();
      } catch {
        /* dispatch reports malformed JSON */
      }
      if (immediate) void dispatch(line);
      else queue = queue.then(() => dispatch(line));
    }
  });
  process.stdin.on('end', () => shutdown());
  process.stdin.on('error', () => shutdown({ cancel: true }));
  process.stdout.on('error', () => {
    process.stdin.destroy();
    shutdown({ cancel: true });
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      process.stdin.destroy();
      shutdown({ cancel: true, exit: true });
    });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help'))
    console.log(
      'node tools/portal_controller.mjs --mcp\nJSON-RPC MCP or JSONL {id,operation:"portal_start"|...,arguments:{...}} on stdin. See docs/PORTAL.md.',
    );
  else await serve();
}
