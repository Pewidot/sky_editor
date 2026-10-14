import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeIgz } from './fixtures/igz_fixture.mjs';
import { parseIgz } from '../tools/igz.mjs';
import { EXECUTABLE_SHA256 } from '../tools/level_builder.mjs';
import { decodeLighting, exportLighting } from '../tools/lighting_catalog.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const field = (name, offset, metaConstructor) => ({ name, offset, metaConstructor });
// Synthetic metadata exercises storage rules, not a substitute for the native
// metadata regression in elf_metadata.test.mjs. No proprietary bytes here.
const metadata = {
  executableSha256: EXECUTABLE_SHA256,
  classes: [
    {
      name: 'tfbLightInfo',
      size: 0x1c0,
      evidence: 'synthetic-test',
      fields: [
        field('_interface', 0, 0),
        field('_nameFixture', 0x10, 0),
        field('_diffuseColor', 0x13c, 0x5cc240),
        field('_intensity', 0x158, 0x58ee40),
        field('_visible', 0x180, 0x589500),
        field('_unknown', 0x188, 123),
      ],
    },
    {
      name: 'DirectionalLightInfo',
      size: 0x60,
      evidence: 'synthetic-test',
      fields: [field('_multiplier', 0x3c, 0x58ee40), field('_initMatrix', 0x48, 0x492000)],
    },
    {
      name: 'tfbMoodBoxInfo',
      size: 0x70,
      evidence: 'synthetic-test',
      fields: [field('_enabled', 0x54, 0x589500), field('_influence', 0x68, 0x58ee40)],
    },
  ],
};
function fixture() {
  const b = makeIgz({ objects: metadata.classes.map((c) => ({ type: c.name, size: c.size, name: c.name })) });
  const z = parseIgz(b),
    [light, direction, mood] = z.objects.slice(1);
  Buffer.from([10, 20, 30, 255]).copy(b, light.offset + 0x13c);
  b.writeFloatLE(12.5, light.offset + 0x158);
  b[light.offset + 0x180] = 1;
  b.writeFloatLE(1.25, direction.offset + 0x3c);
  [1, 2, 3, -45, 0, 90].forEach((v, i) => b.writeFloatLE(v, direction.offset + 0x48 + i * 4));
  b[mood.offset + 0x54] = 0;
  b.writeFloatLE(0.75, mood.offset + 0x68);
  return { b, z };
}
const decode = (b, m = metadata) => decodeLighting(b, { expectedSha256: hash(b), metadata: m });
const get = (o, name) => o.fields.find((f) => f.name === name);

test('lighting fields retain source identity, raw bytes and bounded claims', () => {
  const { b } = fixture(),
    before = Buffer.from(b),
    d = decode(b);
  assert.deepEqual(d.counts, { tfbLightInfo: 1, DirectionalLightInfo: 1, tfbMoodBoxInfo: 1 });
  const [l, r, m] = d.objects;
  assert.equal(l.id, `igz:${hash(b)}:object:1`);
  assert.equal(get(l, '_intensity').value, 12.5);
  assert.deepEqual(get(l, '_diffuseColor').byteComponents, [10, 20, 30, 255]);
  assert.equal(get(l, '_diffuseColor').channelOrder, 'not-established');
  assert.equal(get(l, '_visible').value, true);
  assert.equal(get(l, '_unknown').storageType, 'uninterpreted');
  assert.equal(get(l, '_unknown').byteLength, 24);
  assert.equal(get(l, '_nameFixture').string.value, 'tfbLightInfo');
  assert.equal(l.virtualFields[0].status, 'not-a-serialized-instance-field');
  assert.equal(get(l, '_interface'), undefined);
  assert.deepEqual(get(r, '_initMatrix').float32Components, [1, 2, 3, -45, 0, 90]);
  assert.equal(get(m, '_enabled').value, false);
  assert.equal(get(m, '_influence').value, 0.75);
  assert.equal(d.runtimeObserved, false);
  assert.equal(d.rendererReconstructionComplete, false);
  assert.equal(l.inheritedPlacement.worldTransformResolved, false);
  assert.deepEqual(b, before);
});

test('nonfinite floats and noncanonical booleans are not silently normalized', () => {
  const { b, z } = fixture();
  b.writeFloatLE(Infinity, z.objects[1].offset + 0x158);
  b[z.objects[1].offset + 0x180] = 2;
  const l = decode(b).objects[0];
  assert.equal(get(l, '_intensity').value, null);
  assert.equal(get(l, '_intensity').rawHex, '0000807f');
  assert.equal(get(l, '_intensity').valueStatus, 'nonfinite-preserved-raw');
  assert.equal(get(l, '_visible').value, null);
  assert.equal(get(l, '_visible').valueStatus, 'noncanonical-preserved-raw');
});

test('source identity, metadata completeness and native spans fail closed', () => {
  const { b } = fixture();
  assert.throws(() => decodeLighting(b, { metadata }), /SHA-256/);
  assert.throws(() => decodeLighting(b, { metadata, expectedSha256: '0'.repeat(64) }), /SHA-256/);
  assert.throws(() => decode(b, { ...metadata, executableSha256: '0'.repeat(64) }), /executable/);
  assert.throws(() => decode(b, { ...metadata, classes: metadata.classes.slice(1) }), /three/);
  let bad = structuredClone(metadata);
  bad.classes[0].size = 0x1b8;
  assert.throws(() => decode(b, bad), /size mismatch/);
  bad = structuredClone(metadata);
  bad.classes[0].fields.push(field('_bad', 0x1bf, 0x58ee40));
  assert.throws(() => decode(b, bad), /exceeds/);
  bad = structuredClone(metadata);
  bad.classes[0].fields.push(field('_bad', 4, 0));
  assert.throws(() => decode(b, bad), /offset/);
});

const executable = 'extracted/CUSA00697/eboot.elf';
test(
  'native export is exclusive, rejects source symlinks and preserves its input',
  { skip: !fs.existsSync(executable) },
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-lighting-test-'));
    try {
      const { b } = fixture(),
        source = path.join(dir, 'source.bld'),
        output = path.join(dir, 'lighting.json');
      fs.writeFileSync(source, b);
      const options = { source, executable, output, expectedSha256: hash(b) };
      const r = exportLighting(options),
        bytes = fs.readFileSync(output);
      assert.equal(r.sha256, hash(bytes));
      assert.equal(r.size, bytes.length);
      assert.deepEqual(r.counts, { tfbLightInfo: 1, DirectionalLightInfo: 1, tfbMoodBoxInfo: 1 });
      assert.throws(() => exportLighting(options), /EEXIST/);
      const link = path.join(dir, 'link.bld');
      fs.symlinkSync(source, link);
      assert.throws(() => exportLighting({ ...options, source: link }), /ELOOP/);
      assert.deepEqual(fs.readFileSync(source), b);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
