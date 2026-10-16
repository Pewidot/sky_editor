import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const [binary, backend] = process.argv.slice(2);
const requests = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'inspect_level', arguments: { path: 'fixture' } },
  },
  {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'list_level_objects',
      arguments: { path: 'fixture', type: 'SyntheticEntity', query: 'fixture', offset: 0, limit: 5 },
    },
  },
  {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'build_level',
      arguments: {
        path: 'fixture',
        expectedSha256: 'a'.repeat(64),
        output: 'out.bld',
        edits: [{ objectId: 1, position: [2, 3, 4] }],
      },
    },
  },
  {
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'inspect_level', arguments: { path: 'failure' } },
  },
  {
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: {
      name: 'build_level',
      arguments: { path: 'fixture', output: 'out.bld', edits: [{ objectId: 1, position: [2, 3] }] },
    },
  },
  {
    jsonrpc: '2.0',
    id: 8,
    method: 'tools/call',
    params: { name: 'list_level_objects', arguments: { path: 'fixture', limit: 501 } },
  },
  { jsonrpc: '2.0', id: 9, method: 'not_a_method' },
  { jsonrpc: '2.0', id: 'ping', method: 'ping' },
  {
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: { name: 'inspect_level', arguments: { path: 'fixture', expectedSha256: 'not-a-hash' } },
  },
  {
    jsonrpc: '2.0',
    id: 11,
    method: 'tools/call',
    params: { name: 'inspect_level_scene', arguments: { path: 'fixture', geometryPath: 'geometry' } },
  },
  {
    jsonrpc: '2.0',
    id: 12,
    method: 'tools/call',
    params: { name: 'inspect_level_scene', arguments: { path: 'fixture', includeGeometry: true } },
  },
  {
    jsonrpc: '2.0',
    id: 13,
    method: 'tools/call',
    params: { name: 'inspect_level_scene', arguments: { path: 'fixture', includeGeometry: 'yes' } },
  },
  {
    jsonrpc: '2.0',
    id: 14,
    method: 'tools/call',
    params: {
      name: 'inspect_level_collision',
      arguments: { path: 'fixture', actorId: 1, expectedSha256: 'a'.repeat(64) },
    },
  },
  {
    jsonrpc: '2.0',
    id: 15,
    method: 'tools/call',
    params: { name: 'inspect_level_collision', arguments: { path: 'fixture', actorId: -1 } },
  },
  {
    jsonrpc: '2.0',
    id: 16,
    method: 'tools/call',
    params: { name: 'inspect_level_collision', arguments: { path: 'fixture', output: 'forbidden.bld' } },
  },
  {
    jsonrpc: '2.0',
    id: 17,
    method: 'tools/call',
    params: {
      name: 'inspect_level_scene',
      arguments: { path: 'fixture', includeGeometry: true, includeTextures: true, texturePreviewSize: 256 },
    },
  },
  {
    jsonrpc: '2.0',
    id: 18,
    method: 'tools/call',
    params: { name: 'inspect_level_scene', arguments: { path: 'fixture', includeTextures: true } },
  },
  {
    jsonrpc: '2.0',
    id: 19,
    method: 'tools/call',
    params: { name: 'inspect_level_scene', arguments: { path: 'fixture', texturePreviewSize: 2048 } },
  },
  {
    jsonrpc: '2.0',
    id: 20,
    method: 'tools/call',
    params: { name: 'inspect_level', arguments: { path: 'transport-budget' } },
  },
];
const child = spawn(binary, ['--mcp', '--backend', backend], { stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '',
  stderr = '';
child.stdout.on('data', (chunk) => (stdout += chunk));
child.stderr.on('data', (chunk) => (stderr += chunk));
child.stdin.end(
  requests.map((request) => JSON.stringify(request)).join('\n') +
    '\n{invalid\n' +
    'x'.repeat(4 * 1024 * 1024 + 1) +
    '\n',
);
const code = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});
assert.equal(code, 0, stderr);
const responses = stdout
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
assert.equal(responses.length, requests.length + 1);
const byId = new Map(responses.map((response) => [response.id, response]));
assert.equal(byId.get(1).result.protocolVersion, '2025-03-26');
assert.deepEqual(
  byId.get(2).result.tools.map((tool) => tool.name),
  [
    'import_glb',
    'inspect_level',
    'list_level_objects',
    'inspect_level_scene',
    'build_level',
    'inspect_level_collision',
    'inspect_level_materials',
    'render_level_view',
  ],
);
assert.equal(byId.get(3).result.structuredContent.objectCount, 2);
assert.equal(byId.get(3).result.isError, false);
assert.equal(byId.get(4).result.structuredContent.received.limit, 5);
assert.equal(byId.get(4).result.structuredContent.received.type, 'SyntheticEntity');
assert.deepEqual(byId.get(5).result.structuredContent.received.edits, [{ objectId: 1, position: [2, 3, 4] }]);
assert.equal(byId.get(5).result.structuredContent.received.expectedSha256, 'a'.repeat(64));
assert.equal(byId.get(6).result.isError, true);
assert.match(byId.get(6).result.content[0].text, /Synthetic backend failure/);
assert.equal(byId.get(7).result.isError, true);
assert.equal(byId.get(8).result.isError, true);
assert.equal(byId.get(9).error.code, -32601);
assert.equal(byId.get(10).result.isError, true);
assert.equal(byId.get(11).result.structuredContent.received.includeGeometry, false);
assert.equal(byId.get(11).result.structuredContent.meshes[0].positions, undefined);
assert.equal(byId.get(12).result.structuredContent.meshes[0].positions.length, 12);
assert.equal(byId.get(13).result.isError, true);
assert.equal(byId.get(14).result.isError, false);
assert.equal(byId.get(14).result.structuredContent.actors[0].actorId, 1);
assert.equal(byId.get(14).result.structuredContent.received.expectedSourceHash, 'a'.repeat(64));
assert.equal(byId.get(14).result.structuredContent.received.expectedSha256, undefined);
assert.equal(byId.get(15).result.isError, true);
assert.equal(byId.get(16).result.isError, true);
assert.equal(byId.get(17).result.structuredContent.received.includeTextures, true);
assert.equal(byId.get(17).result.structuredContent.received.texturePreviewSize, 256);
assert.equal(byId.get(18).result.isError, true);
assert.equal(byId.get(19).result.isError, true);
assert.equal(byId.get(20).error.code, -32001);
assert.match(byId.get(20).error.message, /64 MiB/);
assert.deepEqual(byId.get('ping').result, {});
assert.equal(byId.get(null).error.code, -32600);
assert.ok(responses.some((response) => response.error?.code === -32700));
assert.match(stderr, /fixture diagnostic/);
console.log('MCP protocol, forwarding, validation, and error isolation passed.');
