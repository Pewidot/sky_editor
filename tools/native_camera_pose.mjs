// Column-major camera math for the exact native camera layout. The game's
// look-at field is not authoritative: the script replaces its view matrix.
import assert from 'node:assert/strict';

const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(...a);
const unit = (a) => {
  const n = length(a);
  assert.ok(n > 1e-6);
  return a.map((x) => x / n);
};
const finite = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const rotate = (v, axis, angle) => {
  const c = Math.cos(angle),
    s = Math.sin(angle),
    k = cross(axis, v),
    d = dot(axis, v);
  return v.map((x, i) => x * c + k[i] * s + axis[i] * d * (1 - c));
};

export function readNativeCamera(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length === 0x190, 'Expected complete tfbRenderCamera');
  const floats = (offset, count) =>
    Array.from({ length: count }, (_, i) => bytes.readFloatLE(offset + i * 4));
  const camera = {
    position: floats(0x30, 3),
    up: floats(0x18, 3),
    lookAt: floats(0x24, 3),
    view: floats(0x80, 16),
    projection: floats(0xc0, 16),
    skyView: floats(0x110, 16),
    skyProjection: floats(0x150, 16),
    fov: bytes.readFloatLE(0x3c),
    aspect: bytes.readFloatLE(0x40),
    near: bytes.readFloatLE(0x64),
    far: bytes.readFloatLE(0x68),
  };
  for (const key of ['position', 'up', 'lookAt', 'view', 'projection', 'skyView', 'skyProjection'])
    assert.ok(camera[key].every(Number.isFinite), `Non-finite native ${key}`);
  assert.ok(
    camera.fov > 1 &&
      camera.fov < 179 &&
      camera.aspect > 0.1 &&
      camera.aspect < 10 &&
      camera.near > 0 &&
      camera.far > camera.near,
    'Unexpected native perspective',
  );
  const m = camera.view,
    right = [m[0], m[4], m[8]],
    up = [m[1], m[5], m[9]],
    backward = [m[2], m[6], m[10]];
  for (const axis of [right, up, backward])
    assert.ok(Math.abs(length(axis) - 1) < 0.005, 'View basis is not unit length');
  for (const [a, b] of [
    [right, up],
    [up, backward],
    [backward, right],
  ])
    assert.ok(Math.abs(dot(a, b)) < 0.005, 'View basis is not orthogonal');
  assert.ok(dot(cross(right, up), backward) > 0.995, 'Unexpected view handedness');
  assert.ok(
    [m[3], m[7], m[11]].every((x) => Math.abs(x) < 1e-5) && Math.abs(m[15] - 1) < 1e-5,
    'View is not affine',
  );
  // Position and matrix are sampled under one owned-process pause.
  for (const [i, axis] of [right, up, backward].entries())
    assert.ok(Math.abs(m[12 + i] + dot(axis, camera.position)) < 0.1, 'Camera position and view disagree');
  return { ...camera, right, up: unit(up), backward };
}

export function moveNativeCamera(pose, { right = 0, up = 0, forward = 0, yaw = 0, pitch = 0 } = {}) {
  assert.ok([right, up, forward, yaw, pitch].every(Number.isFinite), 'Movement must be finite numbers');
  assert.ok(Math.hypot(right, up, forward) <= 5, 'Movement is limited to 5 game units per request');
  assert.ok(Math.abs(yaw) <= 45 && Math.abs(pitch) <= 45, 'Rotation is limited to 45 degrees per request');
  assert.ok(
    finite(pose.position, 3) && finite(pose.right, 3) && finite(pose.up, 3) && finite(pose.backward, 3),
  );
  const position = pose.position.map(
    (x, i) => x + right * pose.right[i] + up * pose.up[i] - forward * pose.backward[i],
  );
  const radians = Math.PI / 180;
  let axes = [pose.right, pose.up, pose.backward].map((v) => rotate(v, [0, 1, 0], yaw * radians));
  const pitchAxis = unit(axes[0]),
    limit = Math.sin(85 * radians);
  let angle = pitch * radians;
  // Stop looking up/down at the pole without treating mouse input as a
  // camera fault. Preserve the yaw and translation, and allow looking back.
  // Check the swept angle too: a request could cross the pole and end below
  // the limit again on its other side.
  for (let sample = 1; sample <= 16; sample++)
    if (Math.abs(rotate(axes[2], pitchAxis, (angle * sample) / 16)[1]) > limit) {
      let low = (sample - 1) / 16,
        high = sample / 16;
      for (let i = 0; i < 32; i++) {
        const middle = (low + high) / 2;
        if (Math.abs(rotate(axes[2], pitchAxis, angle * middle)[1]) <= limit) low = middle;
        else high = middle;
      }
      angle *= low;
      break;
    }
  axes = axes.map((v) => rotate(v, pitchAxis, angle));
  const r = unit(axes[0]),
    b = unit(cross(r, axes[1])),
    u = unit(cross(b, r));
  assert.ok(Math.abs(b[1]) <= limit + 1e-6, 'Unexpected native camera pitch');
  return { ...pose, position, right: r, up: u, backward: b };
}

export function nativePosePatches(pose) {
  const { position: p, right: r, up: u, backward: b } = pose;
  const view = [
    r[0],
    u[0],
    b[0],
    0,
    r[1],
    u[1],
    b[1],
    0,
    r[2],
    u[2],
    b[2],
    0,
    -dot(r, p),
    -dot(u, p),
    -dot(b, p),
    1,
  ];
  const floats = (values) => {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => {
      assert.ok(Number.isFinite(v));
      bytes.writeFloatLE(v, i * 4);
    });
    return bytes;
  };
  const sky = [...view];
  // Native sky translation is independent of the world camera translation.
  // Keep the values observed at enable; do not assume they are zero.
  for (const i of [12, 13, 14, 15]) sky[i] = pose.skyView[i];
  return [
    { offset: 0x18, bytes: floats([...u, ...p.map((x, i) => x - b[i]), ...p]) },
    { offset: 0x80, bytes: floats(view) },
    { offset: 0x110, bytes: floats(sky) },
  ];
}
