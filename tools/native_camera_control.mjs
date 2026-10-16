// Experimental, exact-build native game camera. No arbitrary process attach,
// executable patch, game archive write, save write, or projection replacement.
// REA: ev_504a8a05f1e38f7d0bd86a4ea73fb3e2a1f51b6291bd1c6e5f1f5a5e5abc131d
// and ev_bc907641fef0cf505fe77698b14425fb91ac77592a9720bbd61bc983d6091e7a.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { PortalController } from './portal_controller.mjs';
import { readNativeCamera, moveNativeCamera, nativePosePatches } from './native_camera_pose.mjs';

export const NATIVE_CAMERA_PROFILE = Object.freeze({
  elfSha256: '423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3',
  gameSha256: 'bd5c0433860287599824adb3660964ae623c0505c1300e86cd17e65d5315d3bd',
  emulatorSha256: '67256a057061d3175f307143a150001cfce468d97879d1c836c203eebd10c345',
  mainVtable: 0x13765e0,
  heldVtable: 0x136c600,
  maximumLeaseMs: 30000,
});
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex = (n) => '0x' + n.toString(16);
const pointer = (bytes) => {
  const p = Number(bytes.readBigUInt64LE());
  assert.ok(Number.isSafeInteger(p));
  return p;
};
const pointerBytes = (p) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(p));
  return b;
};

export function resolveNativeMainCamera(read) {
  const render = pointer(read(0x148cf60, 8)),
    rb = read(render, 32);
  assert.equal(pointer(rb), 0x1377f30, 'Unexpected CRender');
  const context = pointer(rb.subarray(16)),
    cb = read(context, 152);
  assert.equal(pointer(cb), 0x13f7150, 'Unexpected igRenderContext');
  const table = pointer(cb.subarray(144)),
    tb = read(table, 64);
  assert.equal(pointer(tb), 0x139a070, 'Unexpected camera table');
  const extent = (o) => Number(tb.readBigUInt64LE(o) & 0x7ffffffffffffffn);
  const size = extent(16);
  assert.ok(
    size > 0 && size <= 8192 && size % 8 === 0 && size === extent(32),
    'Unexpected camera table extent',
  );
  const values = read(pointer(tb.subarray(24)), size),
    keys = read(pointer(tb.subarray(40)), size),
    found = [];
  for (let i = 0; i < size; i += 8) {
    const address = pointer(values.subarray(i)),
      key = pointer(keys.subarray(i));
    if (!address || !key || key === 0xffffffffffff) continue;
    const name = read(key, 5);
    if (name.equals(Buffer.from('main\0'))) found.push(address);
  }
  assert.equal(found.length, 1, 'Expected exactly one bound main camera');
  return { render, context, table, address: found[0] };
}

export function validateNativeCameraCode(read) {
  const p = NATIVE_CAMERA_PROFILE;
  const parent = read(p.heldVtable, 128),
    main = read(p.mainVtable, 128);
  const expected = [
    0xa68b00, 0x51c4f0, 0x51c500, 0x5170a0, 0x5170e0, 0x51c510, 0x516c40, 0x516bc0, 0x51c520, 0x51c590,
    0x51c5a0, 0x51c5b0, 0x51c5d0, 0x51c5c0, 0x51c5e0, 0xa64960,
  ];
  for (let i = 0; i < 16; i++) {
    assert.equal(pointer(parent.subarray(i * 8)), expected[i] + 0x400000, 'Base camera vtable mismatch');
    assert.equal(
      pointer(main.subarray(i * 8)),
      (i === 0 ? 0xa6ab20 : i === 15 ? 0x4f2410 : expected[i]) + 0x400000,
      'Main camera vtable mismatch',
    );
  }
  assert.equal(read(0xe64960, 1).toString('hex'), 'c3', 'Base camera updater must return without writes');
  assert.equal(
    read(0x8f2410, 16).toString('hex'),
    '554889e54157415641554154534883ec',
    'Main camera code mismatch',
  );
}

// REA field metadata + render copy: ev_c5d4a27485987d1c5a1e0c3d00df6a000b9598f5a990953e7f3106fd18949b5d,
// ev_001a0cf63d604064ea5011734fab7eae1fcd2ff6f3557a57374598e21603bcf2.
export function resolveNativeViewer(read) {
  const manager = pointer(read(0x14a0a30, 8)),
    mb = read(manager, 0x70);
  assert.equal(pointer(mb), 0x13a7340, 'Unexpected viewer system manager');
  const metadata = pointer(read(0x143b6f0, 8)),
    meta = read(metadata, 0x82);
  assert.equal(
    read(pointer(meta.subarray(16)), 20)
      .toString('ascii')
      .split('\0')[0],
    'tfbViewerParameters',
    'Unexpected viewer metadata',
  );
  const index = meta.readInt16LE(0x80);
  assert.ok(index >= 0 && index < 4096, 'Invalid viewer system index');
  const list = pointer(mb.subarray(0x68)),
    lb = read(list, 40),
    count = lb.readUInt32LE(12);
  assert.ok(index < count && count <= 4096, 'Invalid viewer system list');
  const address = pointer(read(pointer(lb.subarray(32)) + index * 8, 8)),
    bytes = read(address, 0x58);
  assert.equal(pointer(bytes), 0x1335370, 'Unexpected viewer parameters');
  assert.ok(bytes[0x50] <= 1, 'Sprite visibility must be Boolean');
  return { manager, metadata, index, list, address, drawSpriteScene: bytes[0x50] };
}

// This state machine is transport-independent so rollback and lifetime rules
// can be tested with synthetic memory. It does not accept a PID or open files.
export class NativeCameraLease {
  constructor({
    withStopped,
    record = () => {},
    now = () => performance.now(),
    onRestoreFault = async () => {},
  }) {
    assert.equal(typeof withStopped, 'function');
    this.withStopped = withStopped;
    this.record = record;
    this.now = now;
    this.lease = null;
    this.queue = Promise.resolve();
    this.timer = null;
    this.lastFault = null;
    this.validated = false;
    this.onRestoreFault = onRestoreFault;
  }
  serialized(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  status() {
    return {
      enabled: !!this.lease,
      remainingMs: this.lease ? Math.max(0, Math.round(this.lease.expires - this.now())) : 0,
      camera: this.lease ? hex(this.lease.address) : null,
      position: this.lease ? [...this.lease.pose.position] : null,
      lastFault: this.lastFault,
      uiHidden: this.lease?.viewer?.expected === 0,
      experimental: true,
      limitation:
        'Native camera only. No simulation pause, distant streaming guarantee, collision, or FOV override.',
    };
  }
  armExpiry() {
    clearTimeout(this.timer);
    const lease = this.lease;
    if (!lease) {
      this.timer = null;
      return;
    }
    this.timer = setTimeout(
      () => {
        // A heartbeat can complete while an old timer waits behind an operation.
        // Recheck the current deadline inside the same serialized queue.
        void this.serialized(async () => {
          if (this.lease !== lease) return;
          if (this.now() < lease.expires) {
            this.armExpiry();
            return;
          }
          await this.restoreLease('lease-expired');
        }).catch((error) => {
          this.lastFault = error.message;
          this.record('native-camera-fault', { message: error.message });
        });
      },
      Math.max(1, Math.ceil(lease.expires - this.now())),
    );
    this.timer.unref?.();
  }
  inspect() {
    return this.serialized(() =>
      this.withStopped((memory) => {
        validateNativeCameraCode(memory.read);
        const binding = resolveNativeMainCamera(memory.read),
          bytes = memory.read(binding.address, 0x190);
        const vtable = pointer(bytes);
        assert.ok([NATIVE_CAMERA_PROFILE.mainVtable, NATIVE_CAMERA_PROFILE.heldVtable].includes(vtable));
        return { ...binding, vtable: hex(vtable), ...readNativeCamera(bytes) };
      }),
    );
  }
  enable({ durationMs = 15000, hideUi = false } = {}) {
    return this.serialized(async () => {
      assert.ok(!this.lease, 'Camera is already held');
      assert.ok(
        Number.isInteger(durationMs) &&
          durationMs >= 1000 &&
          durationMs <= NATIVE_CAMERA_PROFILE.maximumLeaseMs,
        'Camera lease must be 1..30 seconds',
      );
      assert.equal(typeof hideUi, 'boolean', 'hideUi must be Boolean');
      await this.withStopped((memory) => {
        validateNativeCameraCode(memory.read);
        const binding = resolveNativeMainCamera(memory.read),
          bytes = memory.read(binding.address, 0x190);
        assert.equal(
          pointer(bytes),
          NATIVE_CAMERA_PROFILE.mainVtable,
          'Main camera is not in its original native state',
        );
        const pose = readNativeCamera(bytes),
          originals = [
            { offset: 0, bytes: bytes.subarray(0, 8) },
            ...nativePosePatches(pose).map((p) => ({
              offset: p.offset,
              bytes: bytes.subarray(p.offset, p.offset + p.bytes.length),
            })),
          ];
        const viewer = hideUi ? resolveNativeViewer(memory.read) : null;
        const patches = [{ address: binding.address, bytes: pointerBytes(NATIVE_CAMERA_PROFILE.heldVtable) }];
        if (viewer) patches.push({ address: viewer.address + 0x50, bytes: Buffer.from([0]) });
        memory.transaction(patches);
        this.lease = {
          ...binding,
          pose,
          origin: [...pose.position],
          originals,
          projection: bytes.subarray(0xc0, 0x100),
          skyProjection: bytes.subarray(0x150, 0x190),
          expires: this.now() + durationMs,
          identity: memory.identity,
          viewer: viewer ? { ...viewer, original: viewer.drawSpriteScene, expected: 0 } : null,
        };
      });
      this.validated = true;
      this.lastFault = null;
      this.armExpiry();
      this.record('native-camera-enabled', this.status());
      return this.status();
    });
  }
  renew({ durationMs = 8000 } = {}) {
    return this.serialized(async () => {
      assert.ok(
        Number.isInteger(durationMs) &&
          durationMs >= 1000 &&
          durationMs <= NATIVE_CAMERA_PROFILE.maximumLeaseMs,
        'Camera lease must be 1..30 seconds',
      );
      const lease = this.lease;
      assert.ok(lease, 'Enable the native camera first');
      assert.ok(this.now() < lease.expires, 'Native camera lease has expired');
      await this.withStopped((memory) => this.validateBinding(memory, lease));
      assert.ok(this.now() < lease.expires, 'Native camera lease expired during renewal');
      // Renew only the watchdog. Keep the original restoration bytes, origin,
      // current pose and UI state for the entire user-controlled hold.
      lease.expires = this.now() + durationMs;
      this.armExpiry();
      this.record('native-camera-renewed', this.status());
      return this.status();
    });
  }
  step(delta = {}) {
    return this.serialized(async () => {
      const lease = this.lease;
      assert.ok(lease, 'Enable the native camera first');
      assert.ok(this.now() < lease.expires, 'Native camera lease has expired');
      assert.ok(
        delta &&
          typeof delta === 'object' &&
          !Array.isArray(delta) &&
          Object.keys(delta).every((k) => ['right', 'up', 'forward', 'yaw', 'pitch'].includes(k)),
        'Unknown movement field',
      );
      const pose = moveNativeCamera(lease.pose, delta);
      await this.withStopped((memory) => {
        this.validateBinding(memory, lease);
        memory.transaction(
          nativePosePatches(pose).map((p) => ({ address: lease.address + p.offset, bytes: p.bytes })),
        );
        readNativeCamera(memory.read(lease.address, 0x190));
      });
      lease.pose = pose;
      this.record('native-camera-moved', { ...delta, ...this.status() });
      return this.status();
    });
  }
  validateBinding(memory, lease) {
    assert.equal(memory.identity, lease.identity, 'Owned process lifetime changed');
    const current = resolveNativeMainCamera(memory.read);
    for (const key of ['render', 'context', 'table', 'address'])
      assert.equal(
        current[key],
        lease[key],
        'Main camera binding changed; stale address will not be written',
      );
    const bytes = memory.read(lease.address, 0x190);
    assert.equal(pointer(bytes), NATIVE_CAMERA_PROFILE.heldVtable, 'Camera vtable changed externally');
    assert.ok(
      bytes.subarray(0xc0, 0x100).equals(lease.projection) &&
        bytes.subarray(0x150, 0x190).equals(lease.skyProjection),
      'Native projection changed during hold',
    );
    if (lease.viewer) {
      const viewer = resolveNativeViewer(memory.read);
      for (const key of ['manager', 'metadata', 'index', 'list', 'address'])
        assert.equal(
          viewer[key],
          lease.viewer[key],
          'Viewer binding changed; stale address will not be written',
        );
      assert.equal(viewer.drawSpriteScene, lease.viewer.expected, 'Sprite visibility changed externally');
    }
  }
  setUiHidden({ hidden } = {}) {
    return this.serialized(async () => {
      assert.equal(typeof hidden, 'boolean', 'hidden must be Boolean');
      const lease = this.lease;
      assert.ok(lease && this.now() < lease.expires, 'Enable an unexpired native camera lease first');
      await this.withStopped((memory) => {
        this.validateBinding(memory, lease);
        const current = resolveNativeViewer(memory.read),
          viewer = lease.viewer ?? {
            ...current,
            original: current.drawSpriteScene,
            expected: current.drawSpriteScene,
          };
        const value = hidden ? 0 : viewer.original;
        memory.transaction([{ address: viewer.address + 0x50, bytes: Buffer.from([value]) }]);
        lease.viewer = { ...viewer, expected: value };
      });
      this.record('native-camera-ui', { hidden: this.status().uiHidden });
      return this.status();
    });
  }
  disable(reason = 'requested') {
    return this.serialized(() => this.restoreLease(reason));
  }
  async restoreLease(reason) {
    clearTimeout(this.timer);
    this.timer = null;
    const lease = this.lease;
    if (!lease) return this.status();
    try {
      await this.withStopped((memory) => {
        this.validateBinding(memory, lease);
        const patches = lease.originals.map((p) => ({ address: lease.address + p.offset, bytes: p.bytes }));
        if (lease.viewer)
          patches.push({ address: lease.viewer.address + 0x50, bytes: Buffer.from([lease.viewer.original]) });
        memory.transaction(patches);
      });
      this.lease = null;
      this.record('native-camera-restored', { reason, camera: hex(lease.address) });
      return this.status();
    } catch (error) {
      this.lastFault = error.message;
      this.record('native-camera-restore-refused', {
        reason,
        message: error.message,
        camera: hex(lease.address),
      });
      // The production owner stops its own child if restoration cannot safely
      // reach the original camera. Never leave a failed lease held indefinitely.
      await this.onRestoreFault(error);
      throw error;
    }
  }
  processEnded() {
    clearTimeout(this.timer);
    this.timer = null;
    this.lease = null;
  }
}

// The sole production transport accepts the live PortalController, never a PID.
export class OwnedNativeCamera extends NativeCameraLease {
  constructor(portal, { game, emulator }) {
    assert.ok(portal instanceof PortalController, 'A real owned portal controller is required');
    const transport = new OwnedCameraMemory(portal, { game, emulator });
    super({
      withStopped: (operation) => transport.withStopped(operation),
      record: (kind, value) => portal.record(kind, value),
      onRestoreFault: async () => {
        void portal.stop().catch((error) => {
          portal.failure = error.message;
        });
      },
    });
    this.transport = transport;
    assert.ok(portal.child instanceof ChildProcess, 'Start the owned emulator before creating its camera');
    portal.child.once('close', () => this.processEnded());
  }
}

class OwnedCameraMemory {
  constructor(portal, { game, emulator }) {
    this.portal = portal;
    this.child = portal.child;
    this.game = fs.realpathSync(game);
    this.emulator = fs.realpathSync(emulator);
    this.pinned = false;
    this.identity = null;
  }
  checkIdentity() {
    assert.ok(
      this.portal.alive &&
        this.portal.ready &&
        !this.portal.stopRequested &&
        this.portal.child === this.child &&
        this.child instanceof ChildProcess &&
        this.child.pid,
      'Owned emulator is not ready',
    );
    const root = '/proc/' + this.child.pid,
      stat = fs.readFileSync(root + '/stat', 'utf8'),
      fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    assert.equal(Number(fields[1]), process.pid, 'Emulator is not our direct child');
    const identity = this.child.pid + ':' + fields[19];
    if (this.identity) assert.equal(identity, this.identity, 'Owned process lifetime changed');
    else this.identity = identity;
    assert.equal(fs.realpathSync(root + '/exe'), this.emulator, 'Owned process executable changed');
    return { root, state: fields[0], identity };
  }
  pin() {
    const { root } = this.checkIdentity();
    if (this.pinned) return;
    assert.equal(
      hash(fs.readFileSync(this.game)),
      NATIVE_CAMERA_PROFILE.gameSha256,
      'Unsupported game executable',
    );
    assert.equal(
      hash(fs.readFileSync(this.emulator)),
      NATIVE_CAMERA_PROFILE.emulatorSha256,
      'Unsupported emulator executable',
    );
    const command = fs.readFileSync(root + '/cmdline', 'utf8').split('\0'),
      at = command.indexOf('--game');
    assert.ok(
      at >= 0 && fs.realpathSync(command[at + 1]) === this.game,
      'Owned process game does not match selected executable',
    );
    this.pinned = true;
  }
  async withStopped(operation) {
    this.pin();
    const before = this.checkIdentity();
    assert.ok(!['T', 't'].includes(before.state), 'Emulator was already stopped externally');
    const started = performance.now();
    let stopped = false,
      fd;
    try {
      assert.ok(this.child.kill('SIGSTOP'), 'Could not pause owned emulator');
      stopped = true;
      let settled = false;
      const deadline = performance.now() + 250;
      do {
        this.checkIdentity();
        const tids = fs.readdirSync(before.root + '/task');
        assert.ok(tids.length > 0 && tids.length <= 1024, 'Unexpected thread count');
        if (
          tids.every((tid) =>
            /^State:\s+[Tt]/m.test(fs.readFileSync(before.root + '/task/' + tid + '/status', 'utf8')),
          )
        ) {
          settled = true;
          break;
        }
        if (performance.now() >= deadline) break;
        await delay(1);
      } while (performance.now() < deadline);
      assert.ok(settled, 'Owned emulator threads did not stop within 250 ms');
      const mappings = fs
        .readFileSync(before.root + '/maps', 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const m = /^([0-9a-f]+)-([0-9a-f]+) (\S+)/.exec(line);
          assert.ok(m);
          return { start: parseInt(m[1], 16), end: parseInt(m[2], 16), permissions: m[3] };
        });
      const fits = (address, length, write = false) => {
        assert.ok(
          Number.isSafeInteger(address) &&
            address >= 0x400000 &&
            Number.isInteger(length) &&
            length > 0 &&
            length <= 8192 &&
            address + length <= 0x550000000000,
          'Outside camera memory bounds',
        );
        assert.ok(
          mappings.some(
            (m) =>
              m.start <= address &&
              m.end >= address + length &&
              m.permissions[0] === 'r' &&
              (!write || m.permissions[1] === 'w'),
          ),
          'Camera access must fit a readable/writable mapping',
        );
      };
      fd = fs.openSync(before.root + '/mem', 'r+');
      const read = (address, length) => {
        fits(address, length);
        const b = Buffer.alloc(length);
        assert.equal(fs.readSync(fd, b, 0, length, address), length);
        return b;
      };
      const write = (address, bytes) => {
        fits(address, bytes.length, true);
        assert.equal(fs.writeSync(fd, bytes, 0, bytes.length, address), bytes.length);
        assert.ok(read(address, bytes.length).equals(bytes), 'Camera write readback mismatch');
      };
      const transaction = (patches) => {
        assert.ok(patches.length >= 1 && patches.length <= 5);
        // Re-resolve immediately before every transaction, including rollback.
        const { address: camera } = resolveNativeMainCamera(read);
        const cameraField = (p) =>
          [
            [0, 8],
            [0x18, 36],
            [0x80, 64],
            [0x110, 64],
          ].some(([offset, length]) => p.address === camera + offset && p.bytes.length === length);
        const viewer = patches.some((p) => !cameraField(p)) ? resolveNativeViewer(read) : null;
        for (const p of patches) {
          assert.ok(
            cameraField(p) ||
              (viewer && p.address === viewer.address + 0x50 && p.bytes.length === 1 && p.bytes[0] <= 1),
            'Write is not an allowlisted camera/viewer field',
          );
          fits(p.address, p.bytes.length, true);
        }
        const originals = patches.map((p) => ({ ...p, bytes: read(p.address, p.bytes.length) }));
        try {
          for (const p of patches) write(p.address, p.bytes);
        } catch (error) {
          for (const p of originals) write(p.address, p.bytes);
          throw error;
        }
      };
      const result = operation({ read, transaction, identity: before.identity });
      assert.ok(!result?.then, 'Stopped camera operation must be synchronous');
      return result;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (stopped) {
        this.checkIdentity();
        assert.ok(this.child.kill('SIGCONT'), 'Could not resume owned emulator');
      }
      this.portal.record('native-camera-pause', {
        pausedMs: Math.round(performance.now() - started),
        processIdentity: before.identity,
      });
    }
  }
}
