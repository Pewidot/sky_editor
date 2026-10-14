// Read-only integration against user-supplied local actor/geometry IGZ files.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const [binary, backend, source, geometryPath] = process.argv.slice(2);
assert.ok(
  binary && backend && source && geometryPath,
  'Usage: node scene_integration.mjs BINARY BACKEND ACTOR_IGZ GEOMETRY_IGZ',
);
const requests = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'scene-integration', version: '1' },
    },
  },
  ...[false, true].map((includeGeometry, index) => ({
    jsonrpc: '2.0',
    id: index + 2,
    method: 'tools/call',
    params: { name: 'inspect_level_scene', arguments: { path: source, geometryPath, includeGeometry } },
  })),
  {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'inspect_level_scene',
      arguments: {
        path: source,
        geometryPath,
        includeGeometry: true,
        includeTextures: true,
        texturePreviewSize: 256,
      },
    },
  },
];
const child = spawnSync(binary, ['--mcp', '--backend', backend], {
  input: requests.map((request) => JSON.stringify(request)).join('\n') + '\n',
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  timeout: 120000,
});
assert.equal(child.status, 0, child.stderr || child.error?.message);
const responses = child.stdout
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
assert.equal(responses.length, 4);
for (const response of responses.slice(1)) {
  assert.equal(response.error, undefined);
  assert.equal(response.result.isError, false, JSON.stringify(response.result));
}
const metadata = responses[1].result.structuredContent;
const scene = responses[2].result.structuredContent;
const textured = responses[3].result.structuredContent;
assert.equal(textured.sha256, scene.sha256);
assert.equal(textured.meshes.length, scene.meshes.length);
assert.ok(
  Buffer.byteLength(JSON.stringify(responses[3])) < 48 * 1024 * 1024,
  'Texture MCP response exceeds its transport budget',
);
assert.ok(textured.textureCounts.rgbaBytes <= 8 * 1024 * 1024);
assert.ok(textured.textures.length > 0);
const textureIds = new Set();
let rgbaBytes = 0;
for (const texture of textured.textures) {
  assert.equal(textureIds.has(texture.id), false);
  textureIds.add(texture.id);
  assert.ok(texture.width > 0 && texture.width <= 256 && texture.height > 0 && texture.height <= 256);
  const rgba = Buffer.from(texture.rgbaBase64, 'base64');
  rgbaBytes += rgba.length;
  assert.equal(rgba.length, texture.width * texture.height * 4);
  assert.equal(createHash('sha256').update(rgba).digest('hex'), texture.rgbaSha256);
}
assert.equal(rgbaBytes, textured.textureCounts.rgbaBytes);
for (const mesh of textured.meshes)
  if (mesh.textureId) {
    assert.ok(textureIds.has(mesh.textureId));
    assert.equal(mesh.uvs.length, mesh.vertexCount * 2);
    assert.ok(mesh.uvs.every(Number.isFinite));
    assert.ok(['clamp', 'repeat'].includes(mesh.textureWrapS));
    assert.ok(['clamp', 'repeat'].includes(mesh.textureWrapT));
  }
assert.equal(textured.meshes.filter((m) => m.textureId).length, textured.textureCounts.texturedMeshes);
// Exact local arena pair: the emission-slot correction and fair mip budget
// must not regress into missing late actors. Other own-PKG inputs stay generic.
if (
  textured.sha256 === 'de0ecd5bc5f5f2b3d99ec81592e8fef97a3228e6777e99f1c169e6cd584e7a32' &&
  textured.geometrySha256 === '7488dc91cbb5e801c2d47f13e84c14df6d0724ecf61a579179fcea386dc97899'
) {
  assert.equal(textured.textureCounts.texturedMeshes, 164);
  assert.equal(textured.textureCounts.flatMeshes, 20);
  assert.equal(textured.textureCounts.budgetAdjustedMaxDimension, 128);
  assert.equal(textured.textureCounts.images, 70);
  assert.equal(textured.textureCounts.rgbaBytes, 3835328);
  assert.equal(textured.textureCounts.minimumMipFallbackImages, 1);
  const hatch = textured.meshes.find((m) => m.selectionKey === 'actor:26538:mesh:25763');
  assert.equal(hatch.textureSourceImageId, 25769);
  assert.equal(hatch.textureDiagnosticOverride, false);
  assert.ok(hatch.textureBindings.some((b) => b.cachedUnitId === 5 && b.reflectedSamplerRole === 'emissive'));
  assert.ok(textured.meshes.filter((m) => !m.textureId).every((m) => m.uvs?.length > 0));
  assert.ok(textured.warnings.every((w) => !w.includes('total memory budget exhausted')));
}
assert.equal(metadata.sha256, scene.sha256);
assert.equal(metadata.meshes.length, scene.meshes.length);
assert.ok(scene.objects.length > 0 && scene.meshes.length > 0);
assert.ok(metadata.meshes.every((mesh) => mesh.positions === undefined && mesh.indices === undefined));
let vertices = 0,
  triangles = 0,
  actorMeshes = 0;
const actors = new Map(scene.objects.map((object) => [object.id, object]));
for (const mesh of scene.meshes) {
  assert.ok(Array.isArray(mesh.positions) && Array.isArray(mesh.indices));
  assert.equal(mesh.positions.length % 3, 0);
  assert.equal(mesh.indices.length % 3, 0);
  assert.ok(mesh.positions.every(Number.isFinite));
  assert.ok(
    mesh.indices.every((index) => Number.isInteger(index) && index >= 0 && index < mesh.positions.length / 3),
  );
  if (mesh.actorId !== undefined) {
    assert.ok(
      actors.get(mesh.actorId)?.worldEditable,
      'Linked actor mesh must have a verified editable root placement',
    );
    assert.equal(mesh.actorBasePosition.length, 3);
    actorMeshes++;
  }
  vertices += mesh.positions.length / 3;
  triangles += mesh.indices.length / 3;
}
console.log(
  JSON.stringify(
    {
      test: 'real_scene_mcp',
      passed: true,
      sourceSha256: scene.sha256,
      actors: scene.objects.length,
      worldEditable: scene.objects.filter((object) => object.worldEditable).length,
      meshes: scene.meshes.length,
      actorMeshes,
      vertices,
      triangles,
      geometryIncluded: true,
      outputBytes: Buffer.byteLength(child.stdout),
      runtimeTested: false,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    test: 'real_texture_scene_mcp',
    passed: true,
    ...textured.textureCounts,
    responseBytes: Buffer.byteLength(JSON.stringify(responses[3])),
    gameFilesWritten: false,
  }),
);
