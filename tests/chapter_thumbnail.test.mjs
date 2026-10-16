import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { replaceWorkshopThumbnail } from '../tools/chapter_thumbnail.mjs';
import { parseIgz } from '../tools/igz.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
test('thumbnail rejects unknown UI before attempting a structural write', () => {
  const input = Buffer.from('synthetic');
  assert.throws(() => replaceWorkshopThumbnail(input, Buffer.alloc(0), '0'.repeat(64)), /UI source changed/);
  assert.throws(
    () => replaceWorkshopThumbnail(input, Buffer.alloc(0), sha(input)),
    /Unsupported registered UI/,
  );
  assert.equal(input.toString(), 'synthetic');
});

test(
  'private thumbnail isolates workshop art and preserves every original payload',
  {
    skip: !process.env.SKY_UI_INNER,
  },
  () => {
    const source = fs.readFileSync(process.env.SKY_UI_INNER),
      before = sha(source),
      z = parseIgz(source);
    const rgba = Buffer.alloc(1024 * 1024 * 4, 255);
    const result = replaceWorkshopThumbnail(source, rgba, before),
      a = parseIgz(result.buffer);
    const object = (tree, encoded) => tree.objectsByOffset.get(tree.resolvePointer(encoded).offset);
    const model = (tree, actor) =>
      tree.pointerReferencesByOffset.get(object(tree, actor).offset + 344).encoded;
    assert.equal(sha(source), before);
    assert.equal(model(a, 431120), model(z, 431120), 'Sunbreak must retain its original model');
    assert.notEqual(model(a, 292272), model(z, 292272), 'Gallardo needs a private model');
    const oldTable = z.fixupMap.get('TMHN'),
      newTable = a.fixupMap.get('TMHN');
    assert.equal(newTable.count, oldTable.count + 1);
    for (let i = 0; i < oldTable.count; i++) {
      const old = oldTable.dataOffset + i * 16,
        next = newTable.dataOffset + i * 16;
      assert.deepEqual(result.buffer.subarray(next, next + 16), source.subarray(old, old + 16));
      const size = z.u32(old);
      if (!size) continue;
      const p = z.resolvePointer(z.u32(old + 8), size),
        q = a.resolvePointer(a.u32(next + 8), size);
      assert.deepEqual(
        result.buffer.subarray(q.offset, q.offset + size),
        source.subarray(p.offset, p.offset + size),
      );
    }
    assert.equal(a.unresolvedFixupEntries.length, 0);
    assert.equal(result.manifest.verticalFlip, true);
    assert.equal(result.manifest.runtimeValidated, false);
  },
);
