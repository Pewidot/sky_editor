import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { makeIgz } from './fixtures/igz_fixture.mjs';
import { parseIgz } from '../tools/igz.mjs';
import { createCatalogView, exportIgzCatalog } from '../tools/igz_catalog.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const view = (b, options = {}) => createCatalogView(b, { expectedSha256: hash(b), ...options });

test('catalog keeps stable source identities, raw bytes and unknown semantics', () => {
  const b = makeIgz({ objects: [{ name: 'Enemy_CrateGate_AmbientLight' }] }),
    original = Buffer.from(b);
  const v = view(b, { includeRawObjectHex: true }),
    objects = [...v.objects()];
  assert.equal(objects.length, 2);
  const o = objects[1];
  assert.equal(o.id, `igz:${hash(b)}:object:1`);
  assert.equal(o.sourceBytesSha256, hash(Buffer.from(o.rawObjectHex, 'hex')));
  assert.equal(o.rawObjectComplete, true);
  assert.equal(o.fieldSchemaStatus, 'unknown');
  assert.deepEqual(
    o.featureCandidates.map((x) => x.category),
    ['enemy', 'crate', 'gate', 'lighting'],
  );
  assert.ok(o.featureCandidates.every((x) => x.semanticProof === false));
  assert.equal(v.manifest.runtimeValidated, false);
  assert.equal(v.manifest.semanticsComplete, false);
  assert.deepEqual(b, original);
  assert.deepEqual(
    [...view(b).objects()].map((x) => x.id),
    objects.map((x) => x.id),
  );
});

test('unowned arrays, interior targets, initializers and unresolved slots survive', () => {
  const b = makeIgz({
    sentinelPool: true,
    unresolvedRofs: true,
    specialRelocation: true,
    tmhnReference: true,
  });
  const z = parseIgz(b),
    pointer = z.pointerReferences.find((r) => r.objectIndex === null);
  b.writeBigUInt64LE(BigInt(z.objects[1].encoded + 8), pointer.offset);
  const v = view(b),
    rs = [...v.relocations()];
  const interior = rs.find((r) => r.source.fileOffset === pointer.offset);
  assert.equal(interior.source.ownerObjectId, null);
  assert.equal(interior.reference.target.kind, 'object-interior');
  assert.equal(interior.reference.target.interiorOffset, 8);
  assert.equal(interior.reference.target.objectIndex, 1);
  assert.ok(rs.some((r) => r.kind === 'ordinary-pointer' && r.reference.target.kind === 'untyped-data'));
  assert.equal(rs.filter((r) => r.kind === 'runtime-initializer').length, 1);
  const unresolved = rs.find((r) => r.status === 'unresolved-source-location');
  assert.equal(unresolved.source.fileOffset, null);
  assert.ok(unresolved.unresolvedReason);
  assert.equal(rs.filter((r) => r.kind === 'tmhn-reference').length, 1);
  assert.equal([...v.tables()].filter((r) => r.table === 'TMHN').length, 1);
});

test('all raw fixup bytes including padding are recoverable', () => {
  const b = makeIgz(),
    z = parseIgz(b),
    v = view(b);
  for (const f of z.fixups) {
    const chunks = [...v.rawFixups()].filter((c) => c.magic === f.magic);
    assert.deepEqual(
      Buffer.concat(chunks.map((c) => Buffer.from(c.rawHex, 'hex'))),
      b.subarray(f.offset, f.end),
    );
    assert.ok(chunks.every((c) => hash(Buffer.from(c.rawHex, 'hex')) === c.sha256));
  }
});

test('explicit hashes and fixup allocation budget fail closed', () => {
  const b = makeIgz();
  assert.throws(() => createCatalogView(b), /SHA-256/);
  assert.throws(() => createCatalogView(b, { expectedSha256: '0'.repeat(64) }), /SHA-256/);
  assert.throws(() => view(b, { includeRawObjectHex: 'yes' }), /boolean/);
  const bad = Buffer.from(b);
  bad.writeUInt32LE(2_000_001, 0x804);
  assert.throws(() => view(bad), /allocation budget/);
});

test('gzip export verifies row counts, hashes, source preservation and no overwrite', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-catalog-test-'));
  try {
    const source = path.join(dir, 'source.bld'),
      outputDirectory = path.join(dir, 'catalog');
    const b = makeIgz();
    fs.writeFileSync(source, b);
    const options = { source, outputDirectory, expectedSha256: hash(b) };
    const manifest = await exportIgzCatalog(options);
    assert.equal(manifest.files.length, 6);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputDirectory, 'catalog.json'))), manifest);
    for (const f of manifest.files) {
      const bytes = fs.readFileSync(path.join(outputDirectory, f.path)),
        raw = gunzipSync(bytes);
      assert.equal(hash(bytes), f.sha256);
      assert.equal(hash(raw), f.uncompressedSha256);
      assert.equal(bytes.length, f.size);
      assert.equal(raw.length, f.uncompressedSize);
      const rows = raw.toString().trim().split('\n').filter(Boolean).map(JSON.parse);
      assert.equal(rows.length, f.records);
    }
    await assert.rejects(exportIgzCatalog(options), /EEXIST/);
    const link = path.join(dir, 'link.bld');
    fs.symlinkSync(source, link);
    await assert.rejects(
      exportIgzCatalog({ ...options, source: link, outputDirectory: path.join(dir, 'second') }),
      /ELOOP/,
    );
    assert.deepEqual(fs.readFileSync(source), b);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
