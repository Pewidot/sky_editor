// Optional local-game integration test. Inputs are supplied by the caller;
// the repository contains no game data. New output is retained in /tmp.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const [binary, backend, source] = process.argv.slice(2);
assert.ok(binary && backend && source, 'Usage: node real_integration.mjs BINARY BACKEND EXTRACTED_LEVEL');
const child = spawn(binary, ['--mcp', '--backend', backend], { stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map();
let sequence = 0,
  diagnostics = '';
child.stderr.on('data', (chunk) => (diagnostics += chunk));
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  const response = JSON.parse(line);
  const settle = pending.get(response.id);
  assert.ok(settle, 'Unexpected response ID');
  pending.delete(response.id);
  settle(response);
});
function request(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
async function tool(name, args, expectedError = false) {
  const response = await request('tools/call', { name, arguments: args });
  assert.equal(response.error, undefined, JSON.stringify(response));
  assert.equal(response.result.isError, expectedError, JSON.stringify(response.result));
  return response.result.structuredContent;
}
try {
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'local-integration', version: '1' },
  });
  const original = await tool('inspect_level', { path: source });
  const objects = await tool('list_level_objects', {
    path: source,
    expectedSha256: original.sha256,
    type: 'tfbActorInfo',
    query: 'LeftSpawn',
    limit: 500,
  });
  const object = objects.objects.find((item) => item.editable);
  assert.ok(object, 'Expected at least one editable LeftSpawn tfbActorInfo in this arena fixture');
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'skylanders-editor-integration-'));
  const output = path.join(outputDirectory, 'level.edited.bld');
  const position = [...object.position];
  position[0] = Math.fround(position[0] + 1);
  const arguments_ = {
    path: source,
    expectedSha256: original.sha256,
    output,
    edits: [{ objectId: object.id, position }],
  };
  const built = await tool('build_level', arguments_);
  assert.equal(built.changedObjects, 1);
  assert.equal(built.runtimeTested, false);
  const manifest = JSON.parse(fs.readFileSync(built.manifest, 'utf8'));
  assert.equal(manifest.source.sha256, original.sha256);
  assert.equal(manifest.verification.unchangedOutsideFields, true);
  assert.equal(manifest.verification.reparsed, true);
  const edited = await tool('list_level_objects', {
    path: output,
    type: 'tfbActorInfo',
    query: 'LeftSpawn',
    limit: 500,
  });
  assert.deepEqual(edited.objects.find((item) => item.id === object.id).position, position);
  const duplicate = await tool('build_level', arguments_, true);
  assert.match(duplicate.error.message, /already exists/);
  const stale = await tool('inspect_level', { path: source, expectedSha256: '0'.repeat(64) }, true);
  assert.match(stale.error.message, /SHA-256/);
  const after = await tool('inspect_level', { path: source });
  assert.equal(after.sha256, original.sha256);
  console.log(
    JSON.stringify(
      {
        test: 'real_mcp_integration',
        passed: true,
        source: path.resolve(source),
        sourceSha256: original.sha256,
        objectId: object.id,
        objectName: object.name,
        before: object.position,
        after: position,
        output,
        manifest: built.manifest,
        changedByteCount: built.changedByteCount,
        runtimeTested: false,
      },
      null,
      2,
    ),
  );
} finally {
  child.stdin.end();
  const exitCode = await new Promise((resolve, reject) => {
    child.on('close', resolve);
    child.on('error', reject);
  });
  assert.equal(exitCode, 0, diagnostics);
}
