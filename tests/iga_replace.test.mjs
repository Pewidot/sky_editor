import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { replaceMember } from '../tools/iga_replace.mjs';

// Independent two-member fixture. The second member is stored raw inside a
// 0x20 chunk stream, exercising preservation of a different compression mode.
function fixture() {
  const names = Buffer.from('first.bin\0second.bin\0');
  const result = Buffer.alloc(0x1800 + 8 + names.length);
  result.writeUInt32LE(0x1a414749, 0);
  result.writeUInt32LE(0x0b, 4);
  result.writeUInt32LE(44, 8);
  result.writeUInt32LE(2, 0x0c);
  result.writeUInt32LE(0x800, 0x10);
  result.writeUInt32LE(0x7fffffff, 0x14);
  result.writeUInt32LE(0x1800, 0x28);
  result.writeUInt32LE(8 + names.length, 0x30);
  result.writeUInt32LE(0x12345678, 0x38);
  result.writeUInt32LE(0xabcdef12, 0x3c);
  result.writeUInt32LE(0x800, 0x40);
  result.writeUInt32LE(0x44332211, 0x44); // Preserve unknown descriptor word.
  result.writeUInt32LE(12, 0x48);
  result.writeUInt32LE(0xffffffff, 0x4c);
  result.writeUInt32LE(0x1000, 0x50);
  result.writeUInt32LE(0x55667788, 0x54);
  result.writeUInt32LE(16, 0x58);
  result.writeUInt32LE(0x20000000, 0x5c);
  result.writeUInt32LE(0xcafebabe, 0x60); // Uninterpreted chunk properties.
  result.write('old payload!', 0x800);
  result.write('raw chunk bytes!', 0x1000);
  result.writeUInt32LE(8, 0x1800);
  result.writeUInt32LE(18, 0x1804);
  names.copy(result, 0x1808);
  return result;
}

async function inputs(sourceBytes = fixture()) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'iga-replace-test-'));
  const paths = {
    source: path.join(dir, 'source.bld'),
    replacement: path.join(dir, 'replacement.bin'),
    output: path.join(dir, 'output.bld'),
  };
  await writeFile(paths.source, sourceBytes);
  await writeFile(paths.replacement, Buffer.from('a much longer replacement payload'));
  return paths;
}

test('append replacement changes only three descriptor fields and appends raw bytes', async () => {
  const paths = await inputs();
  const before = await readFile(paths.source);
  const replacement = await readFile(paths.replacement);
  const result = await replaceMember({ ...paths, selector: 'first.bin' });
  const after = await readFile(paths.output);
  assert.deepEqual(await readFile(paths.source), before);
  assert.deepEqual(await readFile(paths.replacement), replacement);
  assert.equal(after.readUInt32LE(0x40), 0x2000);
  assert.equal(after.readUInt32LE(0x48), replacement.length);
  assert.equal(after.readUInt32LE(0x4c), 0xffffffff);
  assert.deepEqual(after.subarray(0x2000), replacement);
  for (let index = 0; index < before.length; index += 1) {
    if ((index >= 0x40 && index < 0x44) || (index >= 0x48 && index < 0x50)) continue;
    assert.equal(after[index], before[index], `Unexpected change at 0x${index.toString(16)}`);
  }
  assert.ok(after.subarray(before.length, 0x2000).every((byte) => byte === 0));
  assert.deepEqual(JSON.parse(await readFile(`${paths.output}.manifest.json`, 'utf8')), result);
  assert.equal(result.validation.gameRuntimeTested, false);
  assert.equal(result.source.sha256.length, 64);
  assert.equal(result.replacement.sha256.length, 64);
  assert.equal(result.output.sha256.length, 64);
});

test('numeric selector can replace a chunked member with zero-length raw content', async () => {
  const paths = await inputs();
  await writeFile(paths.replacement, Buffer.alloc(0));
  await replaceMember({ ...paths, selector: '1' });
  const result = await readFile(paths.output);
  assert.equal(result.readUInt32LE(0x50), result.length);
  assert.equal(result.readUInt32LE(0x58), 0);
  assert.equal(result.readUInt32LE(0x5c), 0xffffffff);
});

test('existing output and manifest destinations cannot be overwritten', async () => {
  for (const destination of ['output', 'manifest']) {
    const paths = await inputs();
    const existing = destination === 'output' ? paths.output : `${paths.output}.manifest.json`;
    await writeFile(existing, 'retain me');
    await assert.rejects(replaceMember({ ...paths, selector: '0' }), /EEXIST/);
    assert.equal(await readFile(existing, 'utf8'), 'retain me');
    const other = destination === 'output' ? `${paths.output}.manifest.json` : paths.output;
    await assert.rejects(stat(other), /ENOENT/);
  }
});

test('invalid source names, member extents, modes and alignments fail before creating output', async () => {
  const mutations = [
    (bytes) => bytes.writeUInt32LE(0xfffffff0, 0x1800),
    (bytes) => bytes.writeUInt32LE(0xfffffff0, 0x48),
    (bytes) => bytes.writeUInt32LE(0x10000000, 0x4c),
    (bytes) => bytes.writeUInt32LE(3, 0x10),
    (bytes) => bytes.writeUInt32LE(0x1800, 0x40),
    (bytes) => bytes.writeUInt32LE(0x800, 0x50),
  ];
  for (const mutate of mutations) {
    const bytes = fixture();
    mutate(bytes);
    const paths = await inputs(bytes);
    await assert.rejects(replaceMember({ ...paths, selector: '0' }));
    await assert.rejects(stat(paths.output), /ENOENT/);
    await assert.rejects(stat(`${paths.output}.manifest.json`), /ENOENT/);
  }
});

test('missing member and aliased input/output paths cannot alter originals', async () => {
  const paths = await inputs();
  const original = await readFile(paths.source);
  await assert.rejects(replaceMember({ ...paths, selector: 'absent.bin' }), /exactly one/);
  await assert.rejects(replaceMember({ ...paths, output: paths.source, selector: '0' }), /distinct/);
  assert.deepEqual(await readFile(paths.source), original);
});
