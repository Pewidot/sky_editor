import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fnv1a32 } from '../tools/save_inspect.mjs';
import { migrateSaveLayout, writeSaveLayoutMigration } from '../tools/save_layout_migrate.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const field = (key, bitIndex, width, count = 1) => ({ key, name: key, bitIndex, width, count });
const schema = (payloadBytes, fields) => ({ payloadBytes, fields });
// Test oracle deliberately uses division/modulo and BigInt, not the production
// bit-mask helpers. It supports raw values wider than JS's exact Number range.
const readBit = (b, at) => Math.floor(b[Math.floor(at / 8)] / 2 ** (at % 8)) % 2;
function readRaw(b, at, width) {
  let v = 0n;
  for (let j = 0; j < width; j++) v += BigInt(readBit(b, at + j)) << BigInt(j);
  return v;
}
function writeRaw(b, at, width, value) {
  for (let j = 0; j < width; j++) {
    const p = at + j,
      byte = Math.floor(p / 8),
      power = 2 ** (p % 8),
      previous = readBit(b, p),
      next = Number((BigInt(value) >> BigInt(j)) & 1n);
    b[byte] += (next - previous) * power;
  }
}
function seal(buffer) {
  buffer.writeUInt32LE(fnv1a32(buffer.subarray(0, -4)), buffer.length - 4);
  return buffer;
}
const save = (bytes) => seal(Buffer.alloc(bytes + 4));
function migrate(source, oldSchema, newSchema) {
  return migrateSaveLayout({ source, expectedSha256: sha(source), oldSchema, newSchema });
}
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'save-layout-migrate-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('identity layout preserves complete bytes, unknown bits and checksum without mutating source/schema', () => {
  const source = save(12);
  source[0] = 0x91;
  source[8] = 0xa5;
  seal(source);
  const s = schema(12, [field('version', 3, 7), field('wide', 25, 40)]),
    original = Buffer.from(source),
    json = JSON.stringify(s);
  const result = migrate(source, s, s);
  assert.deepEqual(result.buffer, original);
  assert.notEqual(result.buffer, source);
  assert.deepEqual(source, original);
  assert.equal(JSON.stringify(s), json);
  assert.equal(result.manifest.sourceSha256, sha(source));
  assert.equal(result.manifest.outputSha256, sha(result.buffer));
  assert.equal(result.manifest.runtimeValidated, false);
  assert.equal(result.manifest.schemaProvenanceVerified, false);
  assert.equal(result.manifest.totals.assignedBitGrowth, 0);
  assert.equal(result.manifest.validation.outputChecksumValid, true);
});

test('unaligned element copies preserve signed raw encodings while added slots are zero', () => {
  const source = save(11),
    old = schema(11, [field('small', 3, 5, 2), field('signed-raw', 15, 32, 2)]);
  const next = schema(12, [field('small', 3, 5, 3), field('signed-raw', 20, 32, 2)]);
  writeRaw(source, 3, 5, 0b10101);
  writeRaw(source, 8, 5, 0b11011);
  writeRaw(source, 15, 32, 0xffffffffn);
  writeRaw(source, 47, 32, 0x80000000n);
  writeRaw(source, 85, 1, 1);
  seal(source);
  const result = migrate(source, old, next);
  assert.equal(readRaw(result.buffer, 3, 5), 21n);
  assert.equal(readRaw(result.buffer, 8, 5), 27n);
  assert.equal(readRaw(result.buffer, 13, 5), 0n);
  assert.equal(readRaw(result.buffer, 20, 32), 0xffffffffn);
  assert.equal(readRaw(result.buffer, 52, 32), 0x80000000n);
  assert.equal(readBit(result.buffer, 85), 1);
  assert.equal(result.manifest.totals.preservedUnknownOneBits, 1);
  assert.equal(result.manifest.fields[1].copied.bitDelta, 5);
});

test('explicit 82-bit schema growth moves later raw fields across byte boundaries without guessed sizing', () => {
  function layout(chapters) {
    const fields = [field('prefix', 0, 16)];
    let bitIndex = 16;
    for (const [key, width, count] of [
      ['treasures', 1, chapters],
      ['equipped', 1, chapters],
      ['tablets', 1, chapters],
      ['fairies', 1, chapters],
      ['difficulty', 8, chapters * 3],
      ['level-flags', 20, chapters],
      ['objectives', 4, chapters],
      ['areas', 30, chapters],
      ['later-signed-raw', 32, 2],
    ]) {
      fields.push(field(key, bitIndex, width, count));
      bitIndex += width * count;
    }
    return schema(Math.ceil(bitIndex / 32) * 4, fields); // Fixture choice, not a writer default.
  }
  const old = layout(22),
    next = layout(23),
    source = save(old.payloadBytes);
  for (const f of old.fields)
    for (let i = 0; i < f.count; i++) writeRaw(source, f.bitIndex + i * f.width, f.width, BigInt(i * 19 + 7));
  const oldTail = old.fields.at(-1);
  writeRaw(source, oldTail.bitIndex, 32, 0xffffffffn);
  writeRaw(source, oldTail.bitIndex + 32, 32, 0x80000001n);
  seal(source);
  const snapshot = Buffer.from(source),
    result = migrate(source, old, next);
  assert.deepEqual(source, snapshot);
  assert.equal(result.manifest.totals.assignedBitGrowth, 82);
  assert.equal(result.manifest.totals.payloadBitGrowth, 96);
  assert.equal(result.buffer.length - source.length, 12);
  assert.equal(result.manifest.fields.at(-1).copied.bitDelta, 82);
  for (const [j, before] of old.fields.entries()) {
    const after = next.fields[j];
    for (let i = 0; i < before.count; i++)
      assert.equal(
        readRaw(result.buffer, after.bitIndex + i * after.width, after.width),
        readRaw(source, before.bitIndex + i * before.width, before.width),
        `${before.key}[${i}]`,
      );
    for (let i = before.count; i < after.count; i++)
      assert.equal(readRaw(result.buffer, after.bitIndex + i * after.width, after.width), 0n);
  }
  assert.equal(result.buffer.readUInt32LE(next.payloadBytes), fnv1a32(result.buffer.subarray(0, -4)));
});

test('wide raw values and zero-count fields need no signed or Number conversion', () => {
  const old = schema(10, [field('initially-empty', 0, 3, 0), field('wide', 0, 64)]),
    next = schema(10, [field('initially-empty', 0, 3, 2), field('wide', 6, 64)]);
  const source = save(10);
  writeRaw(source, 0, 64, 0xfedcba9876543210n);
  seal(source);
  const { buffer, manifest } = migrate(source, old, next);
  assert.equal(readRaw(buffer, 6, 64), 0xfedcba9876543210n);
  assert.equal(readRaw(buffer, 0, 6), 0n);
  assert.equal(manifest.fields[0].zeroInitialized.elements, 2);
});

test('unknown bits stay at identical unassigned positions; consumed nonzero bits reject', () => {
  const old = schema(2, [field('value', 0, 2)]),
    next = schema(2, [field('value', 0, 2, 2)]),
    source = save(2);
  writeRaw(source, 7, 1, 1);
  seal(source);
  const result = migrate(source, old, next);
  assert.equal(readBit(result.buffer, 7), 1);
  assert.equal(result.manifest.totals.consumedZeroUnknownBits, 2);
  writeRaw(source, 3, 1, 1);
  seal(source);
  assert.throws(() => migrate(source, old, next), /Nonzero unknown source bit.*consumed.*3/);
});

test('zero unknown tail may be explicitly truncated; nonzero tail rejects and vacated field bits become zero', () => {
  const old = schema(2, [field('value', 0, 2)]),
    smaller = schema(1, [field('value', 0, 2)]),
    source = save(2);
  writeRaw(source, 0, 2, 3);
  seal(source);
  const shrink = migrate(source, old, smaller);
  assert.equal(shrink.manifest.totals.truncatedZeroUnknownBits, 8);
  assert.equal(shrink.buffer.length, 5);
  writeRaw(source, 12, 1, 1);
  seal(source);
  assert.throws(() => migrate(source, old, smaller), /Nonzero unknown source bit.*truncated.*12/);
  writeRaw(source, 12, 1, 0);
  writeRaw(source, 4, 1, 1);
  seal(source);
  const moved = migrate(source, old, schema(2, [field('value', 8, 2)]));
  assert.equal(readRaw(moved.buffer, 8, 2), 3n);
  assert.equal(readRaw(moved.buffer, 0, 2), 0n);
  assert.equal(readBit(moved.buffer, 4), 1);
});

test('schema identity/order/width/count, duplicates and overlapping ranges fail closed', () => {
  const source = save(8),
    valid = schema(8, [field('A', 0, 5, 2), field('B', 16, 8)]);
  for (const [bad, pattern] of [
    [schema(8, [field('A', 0, 5, 2), field('A', 16, 8)]), /Duplicate/],
    [schema(8, [field('A', 0, 5, 2), field('B', 9, 8)]), /Overlapping/],
    [schema(8, [field('A', 0, 5, 2)]), /additions\/removals/],
    [schema(8, [field('B', 16, 8), field('A', 0, 5, 2)]), /order changed/],
    [schema(8, [field('A', 0, 4, 2), field('B', 16, 8)]), /width changed/],
    [schema(8, [field('A', 0, 5, 1), field('B', 16, 8)]), /count decreased/],
    [schema(8, [{ ...valid.fields[0], name: 'renamed' }, valid.fields[1]]), /key\/name\/order/],
  ])
    assert.throws(() => migrate(source, valid, bad), pattern);
  assert.throws(() => migrate(source, schema(8, [field('A', 0, 9), field('B', 8, 8)]), valid), /Overlapping/);
});

test('schema integers, bounded ranges, unknown keys and malformed requests are rejected', () => {
  const source = save(8),
    valid = schema(8, [field('A', 0, 8)]);
  for (const property of ['bitIndex', 'width', 'count'])
    for (const invalid of [-1, 0.25, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => migrate(source, valid, schema(8, [{ ...valid.fields[0], [property]: invalid }])),
        /unsigned safe integer/,
      );
    }
  for (const f of [field('A', 63, 2), field('A', 0, 32, 3)])
    assert.throws(() => migrate(source, valid, schema(8, [f])), /range exceeds/);
  assert.throws(() => migrate(source, valid, schema(8, [field('A', 0, 0)])), /unsigned safe integer/);
  assert.throws(() => migrate(source, valid, schema(0, [])), /unsigned safe integer/);
  assert.throws(() => migrate(source, valid, schema(1048577, [])), /unsigned safe integer/);
  assert.throws(
    () =>
      migrate(
        source,
        valid,
        schema(
          8,
          Array.from({ length: 4097 }, (_, i) => field(String(i), 0, 1, 0)),
        ),
      ),
    /at most 4096/,
  );
  assert.throws(
    () => migrate(source, valid, { payloadBytes: 8, fields: [], autoDetect: true }),
    /Invalid newSchema fields/,
  );
  assert.throws(
    () => migrate(source, valid, schema(8, [{ ...valid.fields[0], signed: true }])),
    /Invalid newSchema.field/,
  );
  assert.throws(
    () => migrate(source, valid, schema(8, [{ ...valid.fields[0], key: '' }])),
    /stable field key/,
  );
  assert.throws(
    () =>
      migrateSaveLayout({
        source,
        expectedSha256: sha(source),
        oldSchema: valid,
        newSchema: valid,
        unlock: true,
      }),
    /Invalid migration/,
  );
});

test('exact source SHA, payload length and little-endian trailing FNV are mandatory', () => {
  const source = save(8),
    s = schema(8, [field('A', 0, 8)]);
  assert.throws(
    () => migrateSaveLayout({ source, expectedSha256: '0'.repeat(64), oldSchema: s, newSchema: s }),
    /SHA-256/,
  );
  assert.throws(() => migrate(source.subarray(0, -1), s, s), /Source length/);
  const bad = Buffer.from(source);
  bad[0] ^= 1;
  assert.throws(() => migrate(bad, s, s), /FNV/);
  const endian = Buffer.from(source);
  endian.writeUInt32BE(fnv1a32(source.subarray(0, -4)), 8);
  assert.throws(() => migrate(endian, s, s), /FNV/);
  assert.throws(() => migrate(Buffer.alloc(4), s, s), /bounded save Buffer/);
  assert.throws(() => migrateSaveLayout({ source: new Uint8Array(source) }), /bounded save Buffer/);
});

test('exclusive file wrapper creates a synthetic candidate and manifest, preserving source identity', (t) => {
  const dir = temporary(t),
    source = path.join(dir, 'synthetic-source'),
    bytes = save(8),
    s = schema(8, [field('A', 0, 8)]);
  fs.writeFileSync(source, bytes);
  const before = fs.statSync(source),
    outputDirectory = path.join(dir, 'draft');
  const request = { source, expectedSha256: sha(bytes), oldSchema: s, newSchema: s, outputDirectory };
  const result = writeSaveLayoutMigration(request);
  assert.equal(result.deployable, false);
  assert.deepEqual(fs.readFileSync(result.outputs[0].path), bytes);
  const manifest = JSON.parse(fs.readFileSync(result.outputs[1].path));
  assert.equal(manifest.sourcePath, source);
  assert.equal(manifest.sourceSha256, sha(bytes));
  assert.equal(sha(fs.readFileSync(result.outputs[1].path)), result.outputs[1].sha256);
  assert.throws(() => writeSaveLayoutMigration(request), /EEXIST/);
  assert.equal(fs.statSync(source).ino, before.ino);
  assert.equal(fs.statSync(source).mtimeMs, before.mtimeMs);
  assert.deepEqual(fs.readFileSync(source), bytes);
  const linkedSource = path.join(dir, 'linked-source');
  fs.symlinkSync(source, linkedSource);
  assert.throws(
    () =>
      writeSaveLayoutMigration({
        ...request,
        source: linkedSource,
        outputDirectory: path.join(dir, 'symlink-source-output'),
      }),
    /ELOOP/,
  );
  const linkedOutput = path.join(dir, 'linked-output');
  fs.symlinkSync(source, linkedOutput);
  assert.throws(() => writeSaveLayoutMigration({ ...request, outputDirectory: linkedOutput }), /EEXIST/);
  assert.deepEqual(fs.readFileSync(source), bytes);
  assert.throws(
    () =>
      writeSaveLayoutMigration({
        ...request,
        expectedSha256: '0'.repeat(64),
        outputDirectory: path.join(dir, 'bad-hash'),
      }),
    /Source SHA-256/,
  );
  assert.equal(fs.existsSync(path.join(dir, 'bad-hash')), false);
});

test('partial manifest failure removes only owned files, preserving unrelated data', (t) => {
  const dir = temporary(t),
    source = path.join(dir, 'synthetic-source'),
    bytes = save(4),
    s = schema(4, [field('A', 0, 8)]),
    outputDirectory = path.join(dir, 'partial');
  fs.writeFileSync(source, bytes);
  const originalWrite = fs.writeFileSync;
  let writes = 0;
  try {
    fs.writeFileSync = (...args) => {
      if (++writes === 2) {
        originalWrite(path.join(outputDirectory, 'foreign'), 'keep', { flag: 'wx' });
        throw new Error('Injected manifest failure');
      }
      return originalWrite(...args);
    };
    assert.throws(
      () =>
        writeSaveLayoutMigration({
          source,
          expectedSha256: sha(bytes),
          oldSchema: s,
          newSchema: s,
          outputDirectory,
        }),
      /Injected manifest/,
    );
  } finally {
    fs.writeFileSync = originalWrite;
  }
  assert.deepEqual(fs.readdirSync(outputDirectory), ['foreign']);
  assert.equal(fs.readFileSync(path.join(outputDirectory, 'foreign'), 'utf8'), 'keep');
  assert.deepEqual(fs.readFileSync(source), bytes);
});

test('source inode replacement during output is detected and never overwritten or deleted', (t) => {
  const dir = temporary(t),
    source = path.join(dir, 'synthetic-source'),
    originalPath = path.join(dir, 'original-preserved');
  const bytes = save(4),
    newer = save(4),
    s = schema(4, [field('A', 0, 8)]),
    outputDirectory = path.join(dir, 'race');
  newer[0] = 17;
  seal(newer);
  fs.writeFileSync(source, bytes);
  const originalWrite = fs.writeFileSync;
  let writes = 0;
  try {
    fs.writeFileSync = (...args) => {
      const result = originalWrite(...args);
      if (++writes === 1) {
        fs.renameSync(source, originalPath);
        originalWrite(source, newer, { flag: 'wx' });
      }
      return result;
    };
    assert.throws(
      () =>
        writeSaveLayoutMigration({
          source,
          expectedSha256: sha(bytes),
          oldSchema: s,
          newSchema: s,
          outputDirectory,
        }),
      /Source identity\/content changed/,
    );
  } finally {
    fs.writeFileSync = originalWrite;
  }
  assert.deepEqual(fs.readFileSync(source), newer);
  assert.deepEqual(fs.readFileSync(originalPath), bytes);
  assert.equal(fs.existsSync(outputDirectory), false);
});

test('CLI accepts only explicit request JSON and refuses repeat or unsupported writes', (t) => {
  const dir = temporary(t),
    source = path.join(dir, 'synthetic-source'),
    requestPath = path.join(dir, 'request.json'),
    bytes = save(8),
    s = schema(8, [field('A', 0, 8)]);
  fs.writeFileSync(source, bytes);
  fs.writeFileSync(
    requestPath,
    JSON.stringify({
      source,
      expectedSha256: sha(bytes),
      oldSchema: s,
      newSchema: s,
      outputDirectory: path.join(dir, 'output'),
    }),
  );
  const cli = fileURLToPath(new URL('../tools/save_layout_migrate.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const result = run(requestPath);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).runtimeValidated, false);
  assert.equal(run(requestPath).status, 1);
  assert.equal(run().status, 1);
  assert.equal(run(requestPath, '--overwrite').status, 1);
  assert.deepEqual(fs.readFileSync(source), bytes);
});
