import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inventoryTree, parseOptions, setup, validateLevelPath } from '../tools/setup_from_pkg.mjs';

function syntheticArchive() {
  const bytes = Buffer.alloc(0x1000 + 14);
  bytes.writeUInt32LE(0x1a414749, 0);
  bytes.writeUInt32LE(11, 4);
  bytes.writeUInt32LE(20, 8);
  bytes.writeUInt32LE(1, 0x0c);
  bytes.writeUInt32LE(0x800, 0x10);
  bytes.writeUInt32LE(0x1000, 0x28);
  bytes.writeUInt32LE(14, 0x30);
  bytes.writeUInt32LE(0xba91d879, 0x38);
  bytes.writeUInt32LE(0x800, 0x3c);
  bytes.writeUInt32LE(16, 0x44);
  bytes.writeUInt32LE(0xffffffff, 0x48);
  bytes.writeUInt32LE(0x49475a01, 0x800);
  bytes.writeUInt32LE(8, 0x804);
  bytes.writeUInt32LE(14, 0x80c);
  bytes.writeUInt32LE(4, 0x1000);
  bytes.write('level.bld\0', 0x1004);
  return bytes;
}

async function fakeGame(root) {
  await mkdir(path.join(root, 'level'), { recursive: true });
  await mkdir(path.join(root, 'sce_sys'));
  await writeFile(path.join(root, 'eboot.bin'), 'synthetic executable placeholder');
  await writeFile(path.join(root, 'sce_sys/param.sfo'), 'synthetic metadata placeholder');
  await writeFile(path.join(root, 'level/synthetic.bld'), syntheticArchive());
}

test('setup options require explicit inputs and reject ambiguous or unsafe paths', () => {
  const valid = parseOptions([
    '--pkg',
    'own.pkg',
    '--extractor',
    '/tool',
    '--work',
    '/new',
    '--level',
    'level/one.bld',
  ]);
  assert.equal(valid.pkg, 'own.pkg');
  const geometry = parseOptions([
    '--extracted',
    '/game',
    '--work',
    '/new',
    '--level',
    'level/one.bld',
    '--geometry-level',
    'level/mesh.bld',
  ]);
  assert.equal(geometry.geometryLevel, 'level/mesh.bld');
  assert.throws(
    () =>
      parseOptions([
        '--extracted',
        '/game',
        '--work',
        '/new',
        '--level',
        'level/one.bld',
        '--geometry-level',
        '../mesh.bld',
      ]),
    /relative/,
  );
  assert.throws(
    () => parseOptions(['--pkg', 'own.pkg', '--work', '/new', '--level', 'level/one.bld']),
    /extractor/,
  );
  assert.throws(() => parseOptions(['--pkg', 'a', '--extracted', 'b']), /exactly one/);
  assert.throws(() => parseOptions(['--check-deps', '--pkg', 'a']), /cannot be combined/);
  assert.throws(() => parseOptions(['--check-deps', '--jobs', '0']), /1 to 32/);
  for (const name of ['../a.bld', '/a.bld', 'level/../a.bld', 'level\\a.bld', 'level//a.bld', 'a.arc']) {
    assert.throws(() => validateLevelPath(name), /relative/);
  }
});

test('inventory records deterministic names, sizes and content hashes; rejects symlinks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-inventory-'));
  await mkdir(path.join(root, 'nested'));
  await writeFile(path.join(root, 'b.txt'), 'bee');
  await writeFile(path.join(root, 'nested/a.txt'), 'aye');
  const first = await inventoryTree(root);
  assert.deepEqual(first, await inventoryTree(root));
  assert.equal(first.fileCount, 2);
  assert.equal(first.totalBytes, 6);
  assert.equal(first.files[0].sha256, createHash('sha256').update('bee').digest('hex'));
  await symlink(path.join(root, 'b.txt'), path.join(root, 'linked'));
  await assert.rejects(inventoryTree(root), /Symlinks/);
});

test('setup refuses existing outputs and outputs inside the input tree before building', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-refusal-'));
  const input = path.join(root, 'input');
  await mkdir(input);
  const existing = path.join(root, 'existing');
  await mkdir(existing);
  await writeFile(path.join(existing, 'retain'), 'retain');
  const base = { extracted: input, level: 'level/synthetic.bld', skipEditor: true, jobs: 1 };
  await assert.rejects(setup({ ...base, work: existing }), /existing --work/);
  await assert.rejects(setup({ ...base, work: path.join(input, 'new') }), /outside/);
  await symlink(input, path.join(root, 'alias'));
  await assert.rejects(setup({ ...base, work: path.join(root, 'alias/new') }), /outside/);
  assert.equal(await readFile(path.join(existing, 'retain'), 'utf8'), 'retain');
});

test('existing-extraction setup builds the real archive extractor and preserves synthetic inputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-extracted-'));
  const input = path.join(root, 'input');
  await fakeGame(input);
  const before = await inventoryTree(input);
  const result = await setup({
    extracted: input,
    work: path.join(root, 'new-work'),
    level: 'level/synthetic.bld',
    geometryLevel: 'level/synthetic.bld',
    skipEditor: true,
    jobs: 1,
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.inventory.fileCount, 3);
  assert.equal(result.level.payload.size, 16);
  assert.equal(result.geometry.payload.size, 16);
  assert.deepEqual(await readFile(result.geometry.payload.path), await readFile(result.level.payload.path));
  assert.deepEqual(await inventoryTree(input), before);
  assert.deepEqual(await readFile(result.level.payload.path), syntheticArchive().subarray(0x800, 0x810));
  assert.equal(
    JSON.parse(await readFile(path.join(result.work, 'setup-manifest.json'), 'utf8')).status,
    'complete',
  );
});

test('explicit PKG extractor receives a private portable cwd and destination', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-pkg-'));
  const pkg = path.join(root, 'own.pkg');
  const header = Buffer.alloc(0x80);
  Buffer.from('7f434e54', 'hex').copy(header);
  header.write('EP0002-CUSA00000_00-SYNTHETICTEST0000', 0x40);
  await writeFile(pkg, header);
  const extractor = path.join(root, 'mock-extractor.mjs');
  await writeFile(
    extractor,
    `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
if (!fs.statSync('user').isDirectory() || process.env.XDG_DATA_HOME !== process.cwd()) process.exit(44);
if (process.argv[3] === '--check-type') process.exit(101);
const game = path.join(process.argv[3], 'CUSA00000');
fs.mkdirSync(path.join(game, 'level'), { recursive: true });
fs.mkdirSync(path.join(game, 'sce_sys'));
fs.writeFileSync(path.join(game, 'eboot.bin'), 'synthetic');
fs.writeFileSync(path.join(game, 'sce_sys/param.sfo'), 'synthetic');
fs.writeFileSync(path.join(game, 'level/synthetic.bld'), Buffer.from('${syntheticArchive().toString('base64')}', 'base64'));
console.log('Extracting file 3 of 3');
`,
    { mode: 0o755 },
  );
  const result = await setup({
    pkg,
    extractor,
    work: path.join(root, 'new-work'),
    level: 'level/synthetic.bld',
    skipEditor: true,
    jobs: 1,
  });
  assert.equal(result.pkg.titleId, 'CUSA00000');
  assert.equal(result.extractor.matchesTested11, false);
  assert.deepEqual(await readFile(pkg), header);
  assert.ok((await stat(path.join(result.work, 'extractor-state/user'))).isDirectory());
  assert.equal(result.inventory.fileCount, 3);
});

test('extractor exit zero with an error message is a failure; partial diagnostics stay local', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-error-extractor-'));
  const pkg = path.join(root, 'own.pkg');
  const header = Buffer.alloc(0x80);
  Buffer.from('7f434e54', 'hex').copy(header);
  header.write('EP0002-CUSA00000_00-SYNTHETICTEST0000', 0x40);
  await writeFile(pkg, header);
  const extractor = path.join(root, 'error-extractor.mjs');
  await writeFile(
    extractor,
    `#!/usr/bin/env node
if (process.argv[3] === '--check-type') process.exit(101);
console.log('Cannot extract PKG file : synthetic failure');
`,
    { mode: 0o755 },
  );
  const work = path.join(root, 'failed-work');
  await assert.rejects(
    setup({ pkg, extractor, work, level: 'level/synthetic.bld', skipEditor: true, jobs: 1 }),
    /Extractor reported a failure/,
  );
  const report = JSON.parse(await readFile(path.join(work, 'setup-failed.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  await assert.rejects(stat(path.join(work, 'setup-manifest.json')), /ENOENT/);
  assert.deepEqual(await readFile(pkg), header);
});
