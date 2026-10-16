import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  NativeCameraLease,
  OwnedNativeCamera,
  NATIVE_CAMERA_PROFILE,
  resolveNativeMainCamera,
  validateNativeCameraCode,
} from '../tools/native_camera_control.mjs';
import { readNativeCamera, moveNativeCamera, nativePosePatches } from '../tools/native_camera_pose.mjs';

const pointer = (b, o, v) => b.writeBigUInt64LE(BigInt(v), o);
function cameraBytes() {
  const b = Buffer.alloc(0x190);
  pointer(b, 0, NATIVE_CAMERA_PROFILE.mainVtable);
  const arrays = {
    0x18: [0, 1, 0],
    0x24: [2, 6, 54],
    0x30: [2, 6, 53],
    0x80: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -2, -6, -53, 1],
    0xc0: [1.1049, 0, 0, 0, 0, 1.9643, 0, 0, 0, 0, -1.00077, -1, 0, 0, -0.20015, 0],
    0x110: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 8, 9, 1],
    0x150: [1.1049, 0, 0, 0, 0, 1.9643, 0, 0, 0, 0, -1.00077, -1, 0, 0, -0.20015, 0],
  };
  for (const [offset, values] of Object.entries(arrays))
    values.forEach((v, i) => b.writeFloatLE(v, Number(offset) + 4 * i));
  for (const [offset, value] of [
    [0x3c, 84.29],
    [0x40, 16 / 9],
    [0x64, 0.2],
    [0x68, 259],
  ])
    b.writeFloatLE(value, offset);
  return b;
}
function fixture() {
  const regions = new Map(),
    add = (address, size) => {
      const b = Buffer.alloc(size);
      regions.set(address, b);
      return b;
    };
  pointer(add(0x148cf60, 8), 0, 0x200000000);
  const render = add(0x200000000, 32);
  pointer(render, 0, 0x1377f30);
  pointer(render, 16, 0x200001000);
  const context = add(0x200001000, 152);
  pointer(context, 0, 0x13f7150);
  pointer(context, 144, 0x200002000);
  const table = add(0x200002000, 64);
  pointer(table, 0, 0x139a070);
  pointer(table, 16, 16);
  pointer(table, 24, 0x200003000);
  pointer(table, 32, 16);
  pointer(table, 40, 0x200004000);
  const values = add(0x200003000, 16),
    keys = add(0x200004000, 16);
  pointer(values, 0, 0x200006000);
  pointer(keys, 0, 0x200005000);
  Buffer.from('main\0').copy(add(0x200005000, 5));
  const original = cameraBytes();
  regions.set(0x200006000, Buffer.from(original));
  const expected = [
    0xa68b00, 0x51c4f0, 0x51c500, 0x5170a0, 0x5170e0, 0x51c510, 0x516c40, 0x516bc0, 0x51c520, 0x51c590,
    0x51c5a0, 0x51c5b0, 0x51c5d0, 0x51c5c0, 0x51c5e0, 0xa64960,
  ];
  const base = add(NATIVE_CAMERA_PROFILE.heldVtable, 128),
    main = add(NATIVE_CAMERA_PROFILE.mainVtable, 128);
  expected.forEach((p, i) => {
    pointer(base, i * 8, p + 0x400000);
    pointer(main, i * 8, (i === 0 ? 0xa6ab20 : i === 15 ? 0x4f2410 : p) + 0x400000);
  });
  add(0xe64960, 1)[0] = 0xc3;
  Buffer.from('554889e54157415641554154534883ec', 'hex').copy(add(0x8f2410, 16));
  pointer(add(0x14a0a30, 8), 0, 0x200010000);
  const manager = add(0x200010000, 0x70);
  pointer(manager, 0, 0x13a7340);
  pointer(manager, 0x68, 0x200011000);
  pointer(add(0x143b6f0, 8), 0, 0x200012000);
  const meta = add(0x200012000, 0x82);
  pointer(meta, 16, 0x200013000);
  meta.writeInt16LE(4, 0x80);
  Buffer.from('tfbViewerParameters\0').copy(add(0x200013000, 20));
  const systemList = add(0x200011000, 40);
  systemList.writeUInt32LE(5, 12);
  pointer(systemList, 32, 0x200014000);
  pointer(add(0x200014000, 40), 32, 0x200015000);
  const viewer = add(0x200015000, 0x58);
  pointer(viewer, 0, 0x1335370);
  viewer[0x50] = 1;
  const locate = (address, length) => {
    for (const [base, bytes] of regions)
      if (address >= base && address + length <= base + bytes.length)
        return bytes.subarray(address - base, address - base + length);
    throw Error('Unmapped synthetic address');
  };
  const writes = [],
    audit = [];
  let running = 0,
    maxRunning = 0,
    time = 0,
    identity = '123:456',
    fault = null;
  const controller = new NativeCameraLease({
    now: () => time,
    record: (kind, data) => audit.push({ kind, data }),
    withStopped: async (operation) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await delay(1);
      try {
        return operation({
          identity,
          read: (a, n) => Buffer.from(locate(a, n)),
          transaction: (patches) => {
            if (fault) throw Error(fault);
            for (const p of patches) {
              p.bytes.copy(locate(p.address, p.bytes.length));
              writes.push({ address: p.address, bytes: Buffer.from(p.bytes) });
            }
          },
        });
      } finally {
        running--;
      }
    },
  });
  return {
    controller,
    original,
    regions,
    values,
    keys,
    table,
    writes,
    audit,
    locate,
    maxRunning: () => maxRunning,
    time: (v) => {
      time = v;
    },
    identity: (v) => {
      identity = v;
    },
    fault: (v) => {
      fault = v;
    },
    camera: () => Buffer.from(regions.get(0x200006000)),
  };
}

test('native basis follows actual view, not misleading lookAt metadata', () => {
  const b = cameraBytes(),
    pose = readNativeCamera(b),
    moved = moveNativeCamera(pose, { forward: 3, right: 1, up: 2 });
  assert.deepEqual(moved.position, [3, 8, 50]);
  assert.deepEqual(pose.lookAt, [2, 6, 54]);
  for (const p of nativePosePatches(moved)) p.bytes.copy(b, p.offset);
  const readback = readNativeCamera(b);
  assert.deepEqual(readback.position, [3, 8, 50]);
  assert.deepEqual(readback.skyView.slice(12), [7, 8, 9, 1]);
  assert.deepEqual(b.subarray(0xc0, 0x100), cameraBytes().subarray(0xc0, 0x100));
});
test('rotation stays orthonormal and retains native sky translation/projection', () => {
  let pose = readNativeCamera(cameraBytes());
  for (let i = 0; i < 8; i++) pose = moveNativeCamera(pose, { yaw: 45 });
  const bytes = cameraBytes();
  for (const p of nativePosePatches(pose)) p.bytes.copy(bytes, p.offset);
  assert.ok(Math.abs(readNativeCamera(bytes).right[0] - 1) < 1e-6);
  pose = moveNativeCamera(pose, { pitch: 45 });
  assert.ok(pose.backward[1] < -0.7);
  pose = moveNativeCamera(pose, { pitch: 45 });
  assert.ok(Math.abs(pose.backward[1] + Math.sin((85 * Math.PI) / 180)) < 1e-6);
  pose = moveNativeCamera(pose, { pitch: 30 });
  assert.ok(Math.abs(pose.backward[1] + Math.sin((85 * Math.PI) / 180)) < 1e-6);
  pose = moveNativeCamera(pose, { pitch: -45 });
  assert.ok(Math.abs(pose.backward[1] + Math.sin((40 * Math.PI) / 180)) < 1e-6);
});
test('invalid matrix, huge movement, non-finite values and unknown fields are rejected', async () => {
  const f = fixture();
  const b = cameraBytes();
  b.writeFloatLE(2, 0x80);
  assert.throws(() => readNativeCamera(b), /unit length/);
  assert.throws(() => moveNativeCamera(readNativeCamera(cameraBytes()), { forward: 5.001 }), /5 game units/);
  assert.throws(() => moveNativeCamera(readNativeCamera(cameraBytes()), { yaw: 46 }), /45 degrees/);
  assert.throws(() => moveNativeCamera(readNativeCamera(cameraBytes()), { up: NaN }), /finite/);
  await assert.rejects(f.controller.enable({ durationMs: 30001 }), /1..30/);
  assert.equal(f.writes.length, 0);
  await f.controller.enable();
  await assert.rejects(f.controller.step({ fov: 90 }), /Unknown movement/);
  await f.controller.disable();
});
test('hold, movement and restore touch only allowlisted pose fields, never projection', async () => {
  const f = fixture();
  assert.equal((await f.controller.inspect()).vtable, '0x13765e0');
  await f.controller.enable();
  assert.equal(f.camera().readBigUInt64LE(), BigInt(NATIVE_CAMERA_PROFILE.heldVtable));
  assert.equal(f.writes.length, 1);
  await f.controller.step({ right: 4, yaw: 30, pitch: 10 });
  assert.deepEqual(f.camera().subarray(0xc0, 0x100), f.original.subarray(0xc0, 0x100));
  assert.deepEqual(f.camera().subarray(0x150, 0x190), f.original.subarray(0x150, 0x190));
  assert.equal((await f.controller.disable()).enabled, false);
  assert.deepEqual(f.camera(), f.original);
});
test('all operations serialize and a second enable is refused', async () => {
  const f = fixture();
  await f.controller.enable();
  await assert.rejects(f.controller.enable(), /already held/);
  await Promise.all([
    f.controller.step({ right: 1 }),
    f.controller.step({ right: 1 }),
    f.controller.step({ right: 1 }),
  ]);
  assert.equal(f.maxRunning(), 1);
  assert.equal(f.controller.status().position[0], 5);
  await f.controller.disable();
});
test('no cached camera write after binding or process lifetime changes', async () => {
  const f = fixture();
  await f.controller.enable();
  const count = f.writes.length;
  pointer(f.values, 0, 0x200007000);
  f.regions.set(0x200007000, cameraBytes());
  await assert.rejects(f.controller.step({ right: 1 }), /binding changed/);
  await assert.rejects(f.controller.disable(), /binding changed/);
  assert.equal(f.writes.length, count);
  f.controller.processEnded();
  const g = fixture();
  await g.controller.enable();
  g.identity('123:457');
  await assert.rejects(g.controller.step({ right: 1 }), /lifetime changed/);
  assert.equal(g.writes.length, 1);
  g.controller.processEnded();
});
test('unexpected code, vtable, duplicate main and projection changes fail closed', async () => {
  const f = fixture();
  f.regions.get(0xe64960)[0] = 0x90;
  await assert.rejects(f.controller.enable(), /return without writes/);
  assert.equal(f.writes.length, 0);
  f.regions.get(0xe64960)[0] = 0xc3;
  pointer(f.values, 8, 0x200006000);
  pointer(f.keys, 8, 0x200005000);
  assert.throws(() => resolveNativeMainCamera((a, n) => Buffer.from(f.locate(a, n))), /exactly one/);
  const g = fixture();
  await g.controller.enable();
  g.regions.get(0x200006000).writeFloatLE(9, 0xc0);
  await assert.rejects(g.controller.step({ right: 1 }), /projection changed/);
  g.controller.processEnded();
});
test('camera travels beyond the former tether; movement cannot extend watchdog expiry', async () => {
  const f = fixture();
  await f.controller.enable({ durationMs: 1000 });
  for (let i = 0; i < 200; i++) await f.controller.step({ right: 5 });
  assert.deepEqual(f.controller.status().position, [1002, 6, 53]);
  assert.deepEqual(readNativeCamera(f.camera()).position, [1002, 6, 53]);
  assert.equal(f.controller.status().enabled, true);
  await f.controller.step({ right: -1 });
  assert.deepEqual(f.controller.status().position, [1001, 6, 53]);
  f.time(1001);
  await assert.rejects(f.controller.step({ right: 0 }), /expired/);
  await delay(1100);
  assert.equal(f.controller.status().enabled, false);
  assert.deepEqual(f.camera(), f.original);
});
test('failed transaction leaves pose state unchanged; process end clears the lease', async () => {
  const f = fixture();
  await f.controller.enable();
  f.fault('synthetic failure');
  await assert.rejects(f.controller.step({ right: 1 }), /synthetic failure/);
  assert.deepEqual(f.controller.status().position, [2, 6, 53]);
  assert.equal(f.writes.length, 1);
  f.controller.processEnded();
  assert.equal(f.controller.status().enabled, false);
});
test('heartbeats keep one hold beyond 15 seconds without changing its restoration or travel origin', async () => {
  const f = fixture();
  await f.controller.enable({ durationMs: 8000, hideUi: true });
  const origin = [...f.controller.lease.origin],
    originals = f.controller.lease.originals,
    lease = f.controller.lease;
  await f.controller.step({ right: 3 });
  const moved = f.camera(),
    writes = f.writes.length;
  for (const time of [6000, 12000, 18000, 24000]) {
    f.time(time);
    const status = await f.controller.renew();
    assert.equal(status.enabled, true);
    assert.equal(status.remainingMs, 8000);
    assert.equal(status.uiHidden, true);
    assert.deepEqual(status.position, [5, 6, 53]);
    assert.equal(f.controller.lease, lease);
  }
  assert.deepEqual(f.camera(), moved);
  assert.equal(f.writes.length, writes);
  assert.deepEqual(f.controller.lease.origin, origin);
  assert.equal(f.controller.lease.originals, originals);
  await f.controller.disable();
  assert.deepEqual(f.camera(), f.original);
  assert.equal(f.regions.get(0x200015000)[0x50], 1);
});
test('renewals reject invalid durations, expired holds, stale bindings and changed process lifetime', async () => {
  const f = fixture();
  await assert.rejects(f.controller.renew(), /Enable/);
  await f.controller.enable({ durationMs: 1000 });
  const expires = f.controller.lease.expires;
  for (const durationMs of [0, 999, 30001, Infinity, 1.5])
    await assert.rejects(f.controller.renew({ durationMs }), /1..30/);
  f.identity('123:999');
  await assert.rejects(f.controller.renew(), /lifetime changed/);
  assert.equal(f.controller.lease.expires, expires);
  f.identity('123:456');
  pointer(f.values, 0, 0x200007000);
  await assert.rejects(f.controller.renew(), /binding changed/);
  assert.equal(f.controller.lease.expires, expires);
  pointer(f.values, 0, 0x200006000);
  f.time(1001);
  await assert.rejects(f.controller.renew(), /expired/);
  assert.equal(f.writes.length, 1);
  await f.controller.disable();
  assert.deepEqual(f.camera(), f.original);
});
test('a renewal does not disable watchdog restoration when heartbeats cease', async () => {
  const f = fixture();
  await f.controller.enable({ hideUi: true });
  await f.controller.renew({ durationMs: 1000 });
  f.time(1001);
  await delay(1100);
  assert.equal(f.controller.status().enabled, false);
  assert.deepEqual(f.camera(), f.original);
  assert.equal(f.regions.get(0x200015000)[0x50], 1);
  assert.ok(f.audit.some((e) => e.kind === 'native-camera-restored' && e.data.reason === 'lease-expired'));
});
test('production entry point never accepts a supplied PID or fake owner', () => {
  assert.throws(() => new OwnedNativeCamera({ child: { pid: 123 } }, {}), /real owned/);
  assert.equal(NATIVE_CAMERA_PROFILE.maximumLeaseMs, 30000);
  const f = fixture();
  assert.doesNotThrow(() => validateNativeCameraCode((a, n) => Buffer.from(f.locate(a, n))));
});
test('sprite UI uses one bound Boolean and restores original visibility with the lease', async () => {
  const f = fixture(),
    viewer = f.regions.get(0x200015000),
    original = Buffer.from(viewer);
  await f.controller.enable({ hideUi: true });
  assert.equal(viewer[0x50], 0);
  assert.equal(f.controller.status().uiHidden, true);
  await f.controller.setUiHidden({ hidden: false });
  assert.deepEqual(viewer, original);
  await f.controller.setUiHidden({ hidden: true });
  await f.controller.step({ right: 1 });
  await f.controller.disable();
  assert.deepEqual(viewer, original);
  assert.deepEqual(f.camera(), f.original);
  assert.ok(f.writes.filter((p) => p.address === 0x200015050).every((p) => p.bytes.length === 1));
});
test('late UI hide still restores the originally observed byte; stale viewer and malformed flags fail closed', async () => {
  const f = fixture();
  await f.controller.enable();
  await f.controller.setUiHidden({ hidden: true });
  f.regions.get(0x200012000).writeInt16LE(3, 0x80);
  const before = f.writes.length;
  await assert.rejects(f.controller.disable());
  assert.equal(f.writes.length, before);
  f.controller.processEnded();
  const g = fixture();
  g.regions.get(0x200015000)[0x50] = 2;
  await assert.rejects(g.controller.enable({ hideUi: true }), /Boolean/);
  assert.equal(g.writes.length, 0);
  const h = fixture();
  h.regions.get(0x200015000)[0x50] = 0;
  await h.controller.enable({ hideUi: true });
  await h.controller.setUiHidden({ hidden: false });
  await h.controller.disable();
  assert.equal(h.regions.get(0x200015000)[0x50], 0);
});
