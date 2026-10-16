// Small deterministic opaque BC1 encoder using the already corroborated PS4
// thin-microtile layout. No alpha, normal-map, cubemap or PBR encoding.
import { bcMipLayout, thinMicrotileBlockIndex } from './igz_texture.mjs';
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const pack = (p) =>
  (Math.round((p[0] * 31) / 255) << 11) |
  (Math.round((p[1] * 63) / 255) << 5) |
  Math.round((p[2] * 31) / 255);
const unpack = (n) => [
  Math.round(((n >>> 11) * 255) / 31),
  Math.round((((n >>> 5) & 63) * 255) / 63),
  Math.round(((n & 31) * 255) / 31),
];
export function encodeBc1OpaqueBlock(rgba) {
  check(Buffer.isBuffer(rgba) && rgba.length === 64, 'Expected sixteen RGBA pixels');
  const pixels = Array.from({ length: 16 }, (_, i) => [...rgba.subarray(i * 4, i * 4 + 3)]);
  let distance = -1,
    a = pixels[0],
    b = pixels[0];
  for (let i = 0; i < 16; i++)
    for (let j = i + 1; j < 16; j++) {
      const d = pixels[i].reduce((n, v, k) => n + (v - pixels[j][k]) ** 2, 0);
      if (d > distance) {
        distance = d;
        a = pixels[i];
        b = pixels[j];
      }
    }
  let c0 = Math.max(pack(a), pack(b)),
    c1 = Math.min(pack(a), pack(b));
  if (c0 === c1) {
    if (c0 < 65535) c0++;
    else c1--;
  }
  const p0 = unpack(c0),
    p1 = unpack(c1),
    palette = [
      p0,
      p1,
      p0.map((v, i) => Math.round((2 * v + p1[i]) / 3)),
      p0.map((v, i) => Math.round((v + 2 * p1[i]) / 3)),
    ];
  let bits = 0;
  for (let i = 0; i < 16; i++) {
    let best = 0,
      error = Infinity;
    for (let j = 0; j < 4; j++) {
      const e = pixels[i].reduce((n, v, k) => n + (v - palette[j][k]) ** 2, 0);
      if (e < error) {
        best = j;
        error = e;
      }
    }
    bits = (bits | (best << (i * 2))) >>> 0;
  }
  const out = Buffer.alloc(8);
  out.writeUInt16LE(c0);
  out.writeUInt16LE(c1, 2);
  out.writeUInt32LE(bits, 4);
  return out;
}
export function encodePs4Bc1Mips(rgba, width, height) {
  check(
    Number.isSafeInteger(width) &&
      Number.isSafeInteger(height) &&
      width >= 1 &&
      height >= 1 &&
      width <= 1024 &&
      height <= 1024 &&
      (width & (width - 1)) === 0 &&
      (height & (height - 1)) === 0,
    'Expected power-of-two dimensions up to 1024',
  );
  check(Buffer.isBuffer(rgba) && rgba.length === width * height * 4, 'RGBA extent mismatch');
  const levels = Math.floor(Math.log2(Math.max(width, height))) + 1,
    layouts = bcMipLayout(width, height, levels, 8);
  const out = Buffer.alloc(layouts.at(-1).offset + layouts.at(-1).size);
  let pixels = rgba;
  for (const mip of layouts) {
    const block = Buffer.alloc(64);
    for (let by = 0; by < mip.rows; by++)
      for (let bx = 0; bx < mip.pitch; bx++) {
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) {
            const at =
              (Math.min(mip.height - 1, by * 4 + y) * mip.width + Math.min(mip.width - 1, bx * 4 + x)) * 4;
            pixels.copy(block, (y * 4 + x) * 4, at, at + 4);
          }
        encodeBc1OpaqueBlock(block).copy(out, mip.offset + thinMicrotileBlockIndex(bx, by, mip.pitch) * 8);
      }
    if (mip.level === levels - 1) break;
    const w = Math.max(1, mip.width >> 1),
      h = Math.max(1, mip.height >> 1),
      next = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++)
              sum +=
                pixels[
                  (Math.min(mip.height - 1, y * 2 + dy) * mip.width + Math.min(mip.width - 1, x * 2 + dx)) *
                    4 +
                    c
                ];
          next[(y * w + x) * 4 + c] = Math.round(sum / 4);
        }
    pixels = next;
  }
  return {
    buffer: out,
    width,
    height,
    levels,
    format: 'dxt1_tile_ps4',
    alphaPolicy: 'opaque; source alpha intentionally not encoded',
  };
}
