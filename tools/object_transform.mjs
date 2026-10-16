// Column-major, Y-up transforms. Native Euler order from CUSA00697 0x494d10:
// Ry(y) * Rx(-x) * Rz(z). Scale factors here are ratios, not stored percentages.
import assert from 'node:assert/strict';
export const IDENTITY_TRANSFORM = Object.freeze({ rotationDegrees: [0, 0, 0], scale: [1, 1, 1] });
export function validateTransform({ rotationDegrees = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  assert.ok(
    Array.isArray(rotationDegrees) &&
      rotationDegrees.length === 3 &&
      rotationDegrees.every((v) => Number.isFinite(v) && Math.abs(v) <= 360),
    'Rotation must be three finite degrees in [-360,360]',
  );
  assert.ok(
    Array.isArray(scale) &&
      scale.length === 3 &&
      scale.every((v) => Number.isFinite(v) && v >= 0.01 && v <= 100),
    'Scale must be three positive factors in [0.01,100]',
  );
  return { rotationDegrees, scale };
}
export function rotationMatrix(rotationDegrees = [0, 0, 0]) {
  validateTransform({ rotationDegrees });
  const [x, y, z] = rotationDegrees.map((v, i) => ((v * Math.PI) / 180) * (i === 0 ? -1 : 1));
  const sx = Math.sin(x),
    cx = Math.cos(x),
    sy = Math.sin(y),
    cy = Math.cos(y),
    sz = Math.sin(z),
    cz = Math.cos(z);
  return [
    sy * sx * sz + cy * cz,
    cx * sz,
    cy * sx * sz - sy * cz,
    sy * sx * cz - cy * sz,
    cx * cz,
    sy * sz + cy * sx * cz,
    sy * cx,
    -sx,
    cy * cx,
  ];
}
const multiply = (m, v) => [0, 1, 2].map((i) => m[i] * v[0] + m[3 + i] * v[1] + m[6 + i] * v[2]);
const transpose = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const unit = (v) => {
  const n = Math.hypot(...v);
  assert.ok(n > 1e-12 && Number.isFinite(n), 'Invalid transformed normal');
  return v.map((x) => x / n);
};
export function transformPoint(point, position, transform = {}) {
  const { rotationDegrees, scale } = validateTransform(transform);
  return multiply(
    rotationMatrix(rotationDegrees),
    point.map((v, i) => v * scale[i]),
  ).map((v, i) => v + position[i]);
}
export function createRebase(before, after) {
  const old = validateTransform(before),
    next = validateTransform(after);
  const inverse = transpose(rotationMatrix(old.rotationDegrees)),
    rotation = rotationMatrix(next.rotationDegrees);
  return {
    point(point) {
      const local = multiply(
        inverse,
        point.map((v, i) => v - before.position[i]),
      ).map((v, i) => (v / old.scale[i]) * next.scale[i]);
      return multiply(rotation, local).map((v, i) => v + after.position[i]);
    },
    normal(normal) {
      const local = multiply(inverse, normal).map((v, i) => (v * old.scale[i]) / next.scale[i]);
      return unit(multiply(rotation, local));
    },
  };
}
export function rebasePoint(point, before, after) {
  return createRebase(before, after).point(point);
}
export function rebaseNormal(normal, before, after) {
  return createRebase(before, after).normal(normal);
}
export function transformedBoxCorners(dimensions, offset, position, transform = {}) {
  return Array.from({ length: 8 }, (_, i) =>
    transformPoint(
      [
        ((i & 1 ? 1 : -1) * dimensions[0]) / 2 + offset[0],
        (i & 2 ? dimensions[1] : 0) + offset[1],
        ((i & 4 ? 1 : -1) * dimensions[2]) / 2 + offset[2],
      ],
      position,
      transform,
    ),
  );
}
