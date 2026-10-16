import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIgz } from '../tools/igz.mjs';
import { patchMapIntro } from '../tools/native_fastboot_map.mjs';
const source =
  process.env.SKYLANDERS_FASTBOOT_MAP_INNER || 'research/chapter-catalog-v2/level_314_tutorial_2/level.bld';
test(
  'map preview changes only the intro operand and exact reference counts',
  { skip: !fs.existsSync(source) },
  () => {
    const bytes = fs.readFileSync(source),
      z = parseIgz(bytes),
      { buffer, manifest } = patchMapIntro(bytes),
      out = parseIgz(buffer);
    assert.equal(manifest.runtimeValidated, false);
    assert.equal(buffer.length, bytes.length);
    assert.equal(
      out.pointerReferencesByOffset.get(z.objects[18057].offset + 88).encoded,
      z.objects[18072].encoded,
    );
    const expected = Buffer.from(bytes);
    expected.writeBigUInt64LE(BigInt(z.objects[18072].encoded), z.objects[18057].offset + 88);
    for (const [id, delta] of [
      [18058, -1],
      [18072, 1],
    ])
      expected.writeUInt32LE(z.u32(z.objects[id].offset + 8) + delta, z.objects[id].offset + 8);
    assert.deepEqual(buffer, expected);
    assert.equal(out.unresolvedFixupEntries.length, 0);
  },
);
test('map preview refuses a different source', () =>
  assert.throws(() => patchMapIntro(Buffer.alloc(16)), /Original map/));
