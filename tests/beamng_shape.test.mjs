import test from 'node:test';
import assert from 'node:assert/strict';
import { MessagePackReader, parseBeamngShape } from '../tools/beamng_shape.mjs';
import {
  parseJbeam,
  numericSetting,
  instancePoint,
  instanceNormal,
  authoredSky,
} from '../tools/gallardo_demo.mjs';
test('MessagePack accepts bounded data and rejects truncation, extensions and duplicate keys', () => {
  assert.deepEqual(new MessagePackReader(Buffer.from('9301ffc3', 'hex')).read(), [1, -1, true]);
  for (const b of ['c70100', 'd901', '82a17801a17802', 'ddffffffff'])
    assert.throws(() => new MessagePackReader(Buffer.from(b, 'hex')).read());
  assert.throws(() => parseBeamngShape(Buffer.alloc(8)), /v31/);
});
test('JBeam parser is data-only and wheel expressions use a narrow numeric grammar', () => {
  const d = parseJbeam('{/*data*/"x":[1 2,],"s":"$=do_not_execute()"}');
  assert.deepEqual(d.x, [1, 2]);
  assert.equal(d.s, '$=do_not_execute()');
  for (const text of ['{"x":function(){}}', '{"__proto__":{}}', '[NaN]', '"unterminated', '/*'])
    assert.throws(() => parseJbeam(text));
  assert.equal(
    numericSetting('$=case($trackwidth_F == nil, $trackoffset_F+0.20, $trackwidth_F)', {
      $trackoffset_F: 0.1,
    }),
    0.1 + 0.2,
  );
  assert.throws(() => numericSetting('$=os.execute("x")', {}), /not executed/);
});
test('point and normal axes differ correctly; translation never changes normals', () => {
  const m = [1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30, 0, 0, 0, 1];
  assert.deepEqual(instancePoint([1, 2, 3], m, {}, [0, 0, 0], {}), [11, 33, -22]);
  assert.deepEqual(instanceNormal([0, 0, 1], m, {}, {}), [0, 1, -0]);
  assert.throws(() => instanceNormal([1, 0, 0], m, { scale: { x: 0 } }, {}), /Singular/);
});
test('authored sky and sun are finite non-game unlit meshes', () => {
  const textures = [],
    meshes = authoredSky((t) => {
      textures.push(t);
      return '0'.repeat(64);
    });
  assert.equal(meshes.length, 2);
  for (const mesh of meshes) {
    assert.equal(mesh.sky, true);
    assert.equal(mesh.unlit, true);
    assert.ok(mesh.positions.every(Number.isFinite));
    assert.ok(mesh.indices.every((i) => i >= 0 && i < mesh.positions.length / 3));
  }
  assert.equal(textures[0].rgba.length, 256 * 128 * 4);
});
