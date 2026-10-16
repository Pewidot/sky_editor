import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const [binary, backend] = process.argv.slice(2);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skylanders-render-test-'));
const output = path.join(directory, 'synthetic-scene.png');
const args = ['--backend', backend, 'fixture', '--render-scene', output];
const run = () =>
  spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' },
  });
try {
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const report = JSON.parse(first.stdout);
  assert.equal(report.output, output);
  assert.equal(report.meshes, 2);
  assert.equal(report.gameFilesWritten, false);
  const png = fs.readFileSync(output);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1280);
  assert.equal(png.readUInt32BE(20), 800);
  assert.equal(report.pngSha256, createHash('sha256').update(png).digest('hex'));
  assert.equal(report.camera.verticalFovDegrees, 60);
  assert.match(report.camera.lighting, /not reconstructed/);
  assert.equal(report.camera.editorGrid.followsCamera, false);
  assert.equal(report.renderer.active, 'cpu');
  const second = run();
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /new file/);
  assert.deepEqual(fs.readFileSync(output), png);
  const focusedOutput = path.join(directory, 'focused.png');
  const focused = spawnSync(
    binary,
    ['--backend', backend, 'fixture', '--render-scene', focusedOutput, '--frame-object', '900'],
    { encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(focused.status, 0, focused.stderr);
  const focusReport = JSON.parse(focused.stdout);
  assert.equal(focusReport.framedObject.id, 900);
  assert.deepEqual(focusReport.camera.pivot, [16, 2, -20]);
  assert.deepEqual(focusReport.camera.editorGrid, report.camera.editorGrid);
  assert.notEqual(focusReport.pngSha256, report.pngSha256);
  fs.unlinkSync(focusedOutput);
  for (const id of ['no', '-1', '12345', '901']) {
    const bad = spawnSync(
      binary,
      ['--backend', backend, 'fixture', '--render-scene', focusedOutput, '--frame-object', id],
      { encoding: 'utf8', timeout: 10000 },
    );
    assert.notEqual(bad.status, 0);
    assert.equal(fs.existsSync(focusedOutput), false);
  }
  const dpiOutput = path.join(directory, 'hidpi.png');
  const sidecar = path.join(directory, 'hidpi.json');
  const dpi = spawnSync(
    binary,
    [
      '--backend',
      backend,
      'fixture',
      '--render-scene',
      dpiOutput,
      '--render-report',
      sidecar,
      '--renderer',
      'cpu',
      '--benchmark-frames',
      '3',
    ],
    {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, QT_QPA_PLATFORM: 'offscreen', QT_SCALE_FACTOR: '2' },
    },
  );
  assert.equal(dpi.status, 0, dpi.stderr);
  const dpiReport = JSON.parse(dpi.stdout),
    dpiPng = fs.readFileSync(dpiOutput);
  assert.equal(dpiPng.readUInt32BE(16), dpiReport.width);
  assert.equal(dpiPng.readUInt32BE(20), dpiReport.height);
  assert.equal(dpiReport.renderMeasurements.warmFrames, 3);
  fs.unlinkSync(dpiOutput);
  assert.deepEqual(JSON.parse(fs.readFileSync(sidecar)), dpiReport);
  const collision = spawnSync(
    binary,
    ['--backend', backend, 'fixture', '--render-scene', dpiOutput, '--render-report', sidecar],
    { encoding: 'utf8', timeout: 10000 },
  );
  assert.notEqual(collision.status, 0);
  assert.equal(fs.existsSync(dpiOutput), false);
  fs.unlinkSync(sidecar);
  for (const options of [
    ['--renderer', 'unknown'],
    ['--benchmark-frames', '0'],
    ['--benchmark-frames', '121'],
  ]) {
    const bad = spawnSync(
      binary,
      ['--backend', backend, 'fixture', '--render-scene', dpiOutput, ...options],
      { encoding: 'utf8', timeout: 10000 },
    );
    assert.notEqual(bad.status, 0);
    assert.equal(fs.existsSync(dpiOutput), false);
  }
  const diagnostic = (name, extra) => {
    const destination = path.join(directory, name + '.png');
    const process = spawnSync(
      binary,
      ['--backend', backend, 'fixture', '--render-scene', destination, ...extra],
      { encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(process.status, 0, process.stderr);
    const result = JSON.parse(process.stdout);
    fs.unlinkSync(destination);
    return result;
  };
  const camera = { pivot: [0, 0, -25], yawRadians: 0, pitchRadians: -0.7, distance: 60 };
  for (const extra of [
    ['fixture', '--camera-json', '{}'],
    ['--camera-json', JSON.stringify(camera)],
    ['--mcp', 'fixture', '--camera-json', JSON.stringify(camera)],
  ]) {
    const bad = spawnSync(binary, ['--backend', backend, ...extra, '--smoke-test'], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' },
    });
    assert.equal(bad.status, 2, bad.stderr);
  }
  const check = diagnostic('checker', [
    '--mesh-key',
    'geometry:0',
    '--view-mode',
    'checker',
    '--camera-json',
    JSON.stringify(camera),
    '--no-overlays',
  ]);
  assert.equal(check.meshes, 1);
  assert.equal(check.camera.displayMode, 'checker');
  assert.equal(check.camera.overlaysVisible, false);
  assert.deepEqual(check.camera.pivot, camera.pivot);
  assert.equal(check.materialDiagnostics[0].viewportHasUvs, true);
  const missing = diagnostic('missing', [
    '--mesh-key',
    'geometry:0',
    '--view-mode',
    'missing',
    '--camera-json',
    JSON.stringify(camera),
    '--no-overlays',
  ]);
  assert.notEqual(missing.pngSha256, check.pngSha256);
  const lighting = {
    direction: [0, 1, 0],
    ambient: [0.05, 0.1, 0.25],
    keyColor: [1, 0.55, 0.2],
    intensity: 1.4,
    exposure: -0.25,
    twoSided: true,
  };
  const lit = diagnostic('lighting', [
    '--mesh-key',
    'geometry:0',
    '--camera-json',
    JSON.stringify(camera),
    '--lighting-json',
    JSON.stringify(lighting),
    '--no-overlays',
  ]);
  assert.equal(lit.renderer.previewLighting.nativeLightingApplied, false);
  assert.equal(lit.renderer.previewLighting.exposure, -0.25);
  assert.notEqual(lit.pngSha256, check.pngSha256);
  for (const extra of [
    ['--camera-json', '{}'],
    ['--lighting-json', '{}'],
    ['--lighting-json', JSON.stringify({ ...lighting, direction: [0, 0, 0] })],
    ['--mesh-key', 'geometry:999'],
    ['--view-mode', 'bad'],
    ['--uv-channel', '8'],
    ['--texture-size', '31'],
    ['--texture-image', '1'],
    ['--isolate-selection'],
  ]) {
    const bad = spawnSync(binary, ['--backend', backend, 'fixture', '--render-scene', dpiOutput, ...extra], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.notEqual(bad.status, 0);
    assert.equal(fs.existsSync(dpiOutput), false);
  }
  const mcpPng = path.join(directory, 'mcp.png');
  const calls = [
    {
      name: 'render_level_view',
      arguments: {
        path: 'fixture',
        output: mcpPng,
        renderer: 'cpu',
        viewMode: 'checker',
        meshKey: 'geometry:0',
        camera,
        hideOverlays: true,
      },
    },
    { name: 'render_level_view', arguments: { path: 'fixture', output: mcpPng, renderer: 'cpu' } },
    {
      name: 'inspect_level_materials',
      arguments: { path: 'fixture', limit: 2, previewMeshKey: 'geometry:0', uvChannel: 1 },
    },
    {
      name: 'render_level_view',
      arguments: { path: 'fixture', output: dpiOutput, camera: { ...camera, distance: 0 } },
    },
    { name: 'inspect_level_materials', arguments: { path: 'fixture', textureImageId: 1 } },
    { name: 'inspect_level_materials', arguments: { path: 'fixture', limit: 201 } },
    { name: 'render_level_view', arguments: { path: 'fixture', output: dpiOutput, hideOverlays: 'yes' } },
    {
      name: 'render_level_view',
      arguments: {
        path: 'fixture',
        output: dpiOutput,
        renderer: 'cpu',
        meshKey: 'geometry:0',
        camera,
        hideOverlays: true,
        lighting,
      },
    },
    {
      name: 'render_level_view',
      arguments: { path: 'fixture', output: dpiOutput, lighting: { ...lighting, direction: [0, 0, 0] } },
    },
  ];
  const mcp = spawnSync(binary, ['--mcp', '--backend', backend], {
    encoding: 'utf8',
    timeout: 10000,
    input:
      calls
        .map((params, id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params }))
        .join('\n') + '\n',
  });
  assert.equal(mcp.status, 0, mcp.stderr);
  const replies = mcp.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line).result);
  assert.equal(replies[0].isError, false, JSON.stringify(replies[0]));
  assert.equal(replies[0].structuredContent.pngSha256, check.pngSha256);
  assert.equal(replies[1].isError, true);
  assert.equal(replies[2].structuredContent.received.operation, 'materials');
  assert.equal(replies[2].structuredContent.received.uvChannel, 1);
  for (const r of replies.slice(3, 7)) assert.equal(r.isError, true);
  assert.equal(replies[7].isError, false, JSON.stringify(replies[7]));
  assert.equal(replies[7].structuredContent.pngSha256, lit.pngSha256);
  assert.equal(replies[8].isError, true);
  fs.unlinkSync(dpiOutput);
  fs.unlinkSync(mcpPng);
  console.log('Headless scene PNG, provenance and no-overwrite checks passed.');
} finally {
  fs.rmSync(output, { force: true });
  fs.rmdirSync(directory);
}
