import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const build = fs.mkdtempSync(path.join(os.tmpdir(), 'iga-extract-build-'));
const binary = path.join(build, 'iga_extract');
execFileSync('c++', [
  '-std=c++17',
  '-O2',
  '-Wall',
  '-Wextra',
  '-Wpedantic',
  path.join(root, 'tools/iga_extract.cpp'),
  '-llzma',
  '-o',
  binary,
]);

function archive({ data = Buffer.from('payload'), mode = 0xffffffff, size = data.length } = {}) {
  const bytes = Buffer.alloc(0x800 + data.length);
  bytes.writeUInt32LE(0x1a414749, 0);
  bytes.writeUInt32LE(11, 4);
  bytes.writeUInt32LE(20, 8);
  bytes.writeUInt32LE(1, 0x0c);
  bytes.writeUInt32LE(0x800, 0x10);
  bytes.writeUInt32LE(0x100, 0x28);
  bytes.writeUInt32LE(14, 0x30);
  bytes.writeUInt32LE(0xba91d879, 0x38);
  bytes.writeUInt32LE(0x800, 0x3c);
  bytes.writeUInt32LE(size, 0x44);
  bytes.writeUInt32LE(mode, 0x48);
  bytes.writeUInt32LE(4, 0x100);
  bytes.write('level.bld\0', 0x104);
  data.copy(bytes, 0x800);
  return bytes;
}

function fixture(bytes = archive()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iga-extract-test-'));
  const source = path.join(directory, 'source.bld'),
    output = path.join(directory, 'output.bld');
  fs.writeFileSync(source, bytes);
  return { directory, source, output, bytes };
}
function extract(f, selector = 'level.bld', output = f.output) {
  const result = spawnSync(binary, [f.source, selector, output], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.deepEqual(fs.readFileSync(f.source), f.bytes, 'Source content must remain unchanged');
  return result;
}

test('raw payload and final raw chunks of 1 through 6 bytes extract exactly', () => {
  const raw = fixture();
  assert.equal(extract(raw).status, 0);
  assert.equal(fs.readFileSync(raw.output, 'utf8'), 'payload');
  for (let size = 1; size <= 6; size += 1) {
    const data = Buffer.alloc(size, 0x42);
    const f = fixture(archive({ mode: 0x20000000, data }));
    assert.equal(extract(f, '0').status, 0);
    assert.deepEqual(fs.readFileSync(f.output), data);
  }
});

test('empty raw and chunked members may start exactly at EOF', () => {
  for (const mode of [0xffffffff, 0x20000000]) {
    const f = fixture(archive({ mode, data: Buffer.alloc(0) }));
    assert.equal(extract(f).status, 0);
    assert.equal(fs.statSync(f.output).size, 0);
  }
});

test('existing files, source aliases and dangling/live output symlinks are never overwritten or followed', () => {
  for (const kind of ['existing', 'source', 'hardlink', 'live-symlink', 'dangling-symlink']) {
    const f = fixture();
    const destination = path.join(f.directory, 'other');
    let output = f.output;
    if (kind === 'existing') fs.writeFileSync(output, 'retain me');
    if (kind === 'source') output = f.source;
    if (kind === 'hardlink') fs.linkSync(f.source, output);
    if (kind === 'live-symlink') fs.symlinkSync(f.source, output);
    if (kind === 'dangling-symlink') fs.symlinkSync(destination, output);
    assert.notEqual(extract(f, '0', output).status, 0);
    if (kind === 'existing') assert.equal(fs.readFileSync(output, 'utf8'), 'retain me');
    if (kind.includes('symlink')) assert.ok(fs.lstatSync(output).isSymbolicLink());
    assert.equal(fs.existsSync(destination), false);
  }
});

test('corrupt LZMA after a valid raw chunk removes the newly created partial output', () => {
  const validFirstChunk = Buffer.alloc(0x8000, 0x42);
  const corruptSecondChunk = Buffer.from([1, 0, 0x5d, 0, 0x80, 0, 0, 0xff]);
  const f = fixture(
    archive({
      data: Buffer.concat([validFirstChunk, corruptSecondChunk]),
      mode: 0x20000000,
      size: 0x8000 + 16,
    }),
  );
  const result = extract(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LZMA decode failed/);
  assert.equal(fs.existsSync(f.output), false);
});

test('invalid metadata, names, extents, alignment and modes fail before creating output directories', () => {
  const cases = [
    (bytes) => bytes.writeUInt32LE(0, 0x10),
    (bytes) => bytes.writeUInt32LE(3, 0x10),
    (bytes) => bytes.writeUInt32LE(1, 0x30),
    (bytes) => bytes.writeUInt32LE(0, 0x100),
    (bytes) => bytes.writeUInt32LE(1000, 0x100),
    (bytes) => bytes.fill(0x41, 0x104, 0x10e),
    (bytes) => bytes.writeUInt32LE(0, 0x3c),
    (bytes) => bytes.writeUInt32LE(1000, 0x44),
    (bytes) => bytes.writeUInt32LE(0x10000000, 0x48),
    (bytes) => bytes.writeUInt32LE(19, 8),
    (bytes) => bytes.writeUInt32LE(1000001, 0x0c),
  ];
  for (const mutate of cases) {
    const bytes = archive();
    mutate(bytes);
    const f = fixture(bytes);
    const output = path.join(f.directory, 'not-created/output');
    assert.notEqual(extract(f, '0', output).status, 0);
    assert.equal(fs.existsSync(path.dirname(output)), false);
  }
});

test('compressed and raw chunks cannot extend into the name table', () => {
  for (const compressed of [false, true]) {
    const data = compressed ? Buffer.from([0xff, 0xff, 0x5d, 0, 0x80, 0, 0]) : Buffer.alloc(7, 0x42);
    const base = archive({ data, mode: 0x20000000, size: 32 });
    const bytes = Buffer.alloc(0x807 + 14);
    base.copy(bytes);
    bytes.writeUInt32LE(0x807, 0x28);
    bytes.writeUInt32LE(4, 0x807);
    bytes.write('level.bld\0', 0x80b);
    const f = fixture(bytes);
    assert.notEqual(extract(f).status, 0);
    assert.equal(fs.existsSync(f.output), false);
  }
});

test('declared output above one GiB fails before allocation/decompression', () => {
  const f = fixture(archive({ size: 0x40000001 }));
  const result = extract(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /one-GiB safety limit/);
  assert.equal(fs.existsSync(f.output), false);
});

test('invalid and ambiguous-looking index syntax does not select an unintended member', () => {
  for (const selector of ['1', '-0', ' 0', '0x0', '999999999999999999999999999999999']) {
    const f = fixture();
    assert.notEqual(extract(f, selector).status, 0);
    assert.equal(fs.existsSync(f.output), false);
  }
});
