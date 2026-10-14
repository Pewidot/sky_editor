import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  validateAuthoredScene,
  parseAuthoredScene,
  buildAuthoredScene,
  runAuthoredSceneRequest,
} from '../tools/authored_scene.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const fixture = () => ({
  schema: 'skylanders-authored-scene-v1',
  environment: { authored: true, sunDirection: [0, -1, 0] },
  provenance: { source: 'synthetic' },
  objects: [
    {
      id: 1,
      name: 'Car',
      type: 'AuthoredStaticModel',
      position: [0, 0, 0],
      worldPosition: [0, 0, 0],
      editable: true,
      worldEditable: true,
    },
  ],
  meshes: [
    {
      id: 1,
      name: 'Car triangle',
      selectionKey: 'car:1',
      actorId: 1,
      actorBasePosition: [0, 0, 0],
      positions: [0, 0, 0, 1, 0, 0, 0, 0, 1],
      normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
      uvs: [0, 0, 1, 0, 0, 1],
      indices: [0, 1, 2],
    },
    {
      id: 2,
      name: 'Floor',
      selectionKey: 'floor',
      positions: [-5, -1, -5, 5, -1, -5, 0, -1, 5],
      indices: [0, 1, 2],
    },
  ],
});
test('authored translation moves matching meshes only and preserves metadata', () => {
  const original = fixture(),
    bytes = Buffer.from(JSON.stringify(original)),
    result = buildAuthoredScene(bytes, {
      expectedSha256: sha(bytes),
      edits: [{ objectId: 1, position: [2, 3, 4] }],
    }),
    out = JSON.parse(result.buffer);
  assert.deepEqual(out.meshes[0].positions, [2, 3, 4, 3, 3, 4, 2, 3, 5]);
  assert.deepEqual(out.meshes[0].actorBasePosition, [2, 3, 4]);
  assert.deepEqual(out.meshes[0].normals, original.meshes[0].normals);
  assert.deepEqual(out.meshes[0].uvs, original.meshes[0].uvs);
  assert.deepEqual(out.meshes[1], original.meshes[1]);
  assert.deepEqual(out.provenance, original.provenance);
  assert.deepEqual(out.environment, original.environment);
  assert.equal(result.manifest.playable, false);
  assert.equal(result.manifest.verification.gameRuntimeTested, false);
  assert.deepEqual(JSON.parse(bytes), original);
});
test('no-op authored build is byte-identical and hash guard is mandatory', () => {
  const bytes = Buffer.from(JSON.stringify(fixture(), null, 2));
  assert.ok(buildAuthoredScene(bytes, { expectedSha256: sha(bytes), edits: [] }).buffer.equals(bytes));
  assert.throws(() => buildAuthoredScene(bytes, { edits: [] }), /matching expectedSha256/);
  assert.throws(
    () => buildAuthoredScene(bytes, { expectedSha256: '0'.repeat(64), edits: [] }),
    /matching expectedSha256/,
  );
});
test('authored validation rejects ambiguous references and malformed buffers', () => {
  for (const alter of [
    (d) => d.objects.push({ ...d.objects[0] }),
    (d) => (d.meshes[1].selectionKey = 'car:1'),
    (d) => (d.meshes[0].actorId = 99),
    (d) => (d.meshes[0].indices[1] = 3),
    (d) => (d.meshes[0].positions[0] = NaN),
    (d) => (d.meshes[0].normals = [0, 0, 0]),
    (d) => (d.meshes[0].actorBasePosition = [1, 0, 0]),
    (d) => (d.objects[0].parentObjectId = 2),
    (d) => (d.meshes[0].textureId = '0'.repeat(64)),
  ]) {
    const d = fixture();
    alter(d);
    assert.throws(() => validateAuthoredScene(d));
  }
  assert.throws(() => parseAuthoredScene(Buffer.from([255])));
});
test('authored edits reject unsupported changes, duplicate IDs and locked actors', () => {
  const d = fixture(),
    bytes = Buffer.from(JSON.stringify(d)),
    run = (edits) => buildAuthoredScene(bytes, { expectedSha256: sha(bytes), edits });
  for (const edits of [
    [{ objectId: 1, rotation: [0, 0, 0] }],
    [{ objectId: 2, position: [0, 0, 0] }],
    [{ objectId: 1, position: [Infinity, 0, 0] }],
    [
      { objectId: 1, position: [1, 0, 0] },
      { objectId: 1, position: [2, 0, 0] },
    ],
  ])
    assert.throws(() => run(edits));
  d.objects[0].editable = d.objects[0].worldEditable = false;
  const locked = Buffer.from(JSON.stringify(d));
  assert.throws(
    () =>
      buildAuthoredScene(locked, {
        expectedSha256: sha(locked),
        edits: [{ objectId: 1, position: [1, 0, 0] }],
      }),
    /editable/,
  );
});
test('authored file workflow is exclusive, source-preserving, and cannot emit IGZ', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'authored-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.scene.json'),
    output = path.join(root, 'copy.scene.json'),
    bytes = Buffer.from(JSON.stringify(fixture()));
  fs.writeFileSync(source, bytes);
  const request = { path: source, expectedSha256: sha(bytes) };
  assert.equal(runAuthoredSceneRequest({ ...request, operation: 'inspect' }).profile, 'authored-preview-v1');
  assert.equal(runAuthoredSceneRequest({ ...request, operation: 'objects', query: 'Car' }).objects.length, 1);
  assert.equal(
    runAuthoredSceneRequest({ ...request, operation: 'scene', includeGeometry: true }).meshes.length,
    2,
  );
  assert.throws(
    () =>
      runAuthoredSceneRequest({
        ...request,
        operation: 'build',
        output: path.join(root, 'bad.bld'),
        edits: [],
      }),
    /scene.json/,
  );
  runAuthoredSceneRequest({
    ...request,
    operation: 'build',
    output,
    edits: [{ objectId: 1, position: [2, 0, 0] }],
  });
  assert.throws(
    () => runAuthoredSceneRequest({ ...request, operation: 'build', output, edits: [] }),
    /EEXIST/,
  );
  assert.ok(fs.readFileSync(source).equals(bytes));
  assert.ok(fs.existsSync(output + '.manifest.json'));
});
