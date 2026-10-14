import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import {
  bundleSource,
  collectSource,
  REQUIRED_SOURCE_FILES,
  OPTIONAL_SOURCE_FILES,
} from '../tools/package_source.mjs';

const run = promisify(execFile);
async function sourceFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-bundle-'));
  for (const relative of REQUIRED_SOURCE_FILES) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), `Synthetic source fixture: ${relative}\n`);
  }
  for (const relative of [
    'private.pkg',
    'extracted/game/eboot.bin',
    'research/decompilation.md',
    'tools/vendor/secret.cpp',
    'editor/build/skylanders-level-editor',
    'docs/not-allowlisted.md',
  ]) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), 'FORBIDDEN_PRIVATE_PAYLOAD');
  }
  return root;
}

test('literal allowlist excludes game data, vendor, binaries, research and unlisted docs', async () => {
  const root = await sourceFixture();
  const first = await bundleSource({ root, output: path.join(root, 'release-one.tar.gz') });
  const second = await bundleSource({ root, output: path.join(root, 'release-two.tar.gz') });
  assert.equal(first.archive.sha256, second.archive.sha256);
  const archive = await readFile(path.join(root, 'release-one.tar.gz'));
  assert.equal(gunzipSync(archive).includes(Buffer.from('FORBIDDEN_PRIVATE_PAYLOAD')), false);
  const { stdout } = await run('tar', ['-tzf', path.join(root, 'release-one.tar.gz')]);
  const names = stdout.trim().split('\n');
  assert.equal(names.length, REQUIRED_SOURCE_FILES.length + 1);
  assert.ok(
    names.every(
      (name) =>
        name === 'skylanders-level-editor-source/SOURCE_MANIFEST.json' ||
        REQUIRED_SOURCE_FILES.some((relative) => name === `skylanders-level-editor-source/${relative}`),
    ),
  );
  assert.equal(first.files.length, REQUIRED_SOURCE_FILES.length);
  assert.ok(first.missingOptional.includes('README.md'));
});

test('existing archive and sidecar are preserved without leaving new partial files', async () => {
  for (const kind of ['archive', 'sidecar']) {
    const root = await sourceFixture();
    const output = path.join(root, 'release.tar.gz');
    const existing = kind === 'archive' ? output : `${output}.manifest.json`;
    await writeFile(existing, 'retain me');
    await assert.rejects(bundleSource({ root, output }), /EEXIST/);
    assert.equal(await readFile(existing, 'utf8'), 'retain me');
    await assert.rejects(stat(kind === 'archive' ? `${output}.manifest.json` : output), /ENOENT/);
  }
});

test('symlink or binary content at an allowed path is rejected', async () => {
  const root = await sourceFixture();
  const source = path.join(root, 'tools/iga_extract.cpp');
  await unlink(source);
  await symlink(path.join(root, 'private.pkg'), source);
  await assert.rejects(collectSource(root), /Symlinks/);
  await unlink(source);
  await writeFile(source, Buffer.from([0, 0x7f, 0x45, 0x4c, 0x46]));
  await assert.rejects(collectSource(root), /Binary/);
});

test('required missing files fail instead of producing an incomplete release', async () => {
  const root = await sourceFixture();
  await unlink(path.join(root, 'tools/level_builder.mjs'));
  await assert.rejects(
    bundleSource({ root, output: path.join(root, 'bad.tar.gz') }),
    /Required source is missing/,
  );
  await assert.rejects(stat(path.join(root, 'bad.tar.gz')), /ENOENT/);
});

test('3D, portal and save-inspection dependencies are required and optional additions are collected', async () => {
  for (const relative of [
    'tools/igz_geometry.mjs',
    'editor/src/sceneview.cpp',
    'editor/src/sceneview.h',
    'editor/tests/gui_workflow.cpp',
    'tests/igz_geometry.test.mjs',
    'editor/src/portaldialog.cpp',
    'editor/src/portaldialog.h',
    'tests/fixtures/collision_fixture.mjs',
    'editor/tests/collision_builder.mjs',
    'tools/igz_material.mjs',
    'tests/igz_material.test.mjs',
    'tools/chapter_entrypoints.mjs',
    'tests/chapter_entrypoints.test.mjs',
    'docs/CHAPTER_ENTRYPOINTS.md',
    'tools/save_layout_catalog.mjs',
    'tests/save_layout_catalog.test.mjs',
    'docs/SAVE_LAYOUT_DISCOVERY.md',
    'tools/chapter_registration_draft.mjs',
    'tests/chapter_registration_draft.test.mjs',
    'docs/CHAPTER_REGISTRATION_DRAFT.md',
    'tools/module_dependencies.mjs',
    'tests/module_dependencies.test.mjs',
    'docs/MODULE_DEPENDENCIES.md',
    'tools/script_graph.mjs',
    'tests/script_graph.test.mjs',
    'docs/SCRIPT_GRAPH.md',
    'editor/tests/portal_workflow.cpp',
    'editor/tests/mock_portal.mjs',
    'tools/portal_controller.mjs',
    'tools/sky_figure.mjs',
    'tools/runtime_checkpoint.mjs',
    'tests/fixtures/mock_shadps4.mjs',
    'tools/save_inspect.mjs',
    'tests/save_inspect.test.mjs',
    'docs/SAVE_CHECKPOINTS.md',
  ]) {
    assert.ok(REQUIRED_SOURCE_FILES.includes(relative), `${relative} must not silently disappear`);
  }
  const all = [...REQUIRED_SOURCE_FILES, ...OPTIONAL_SOURCE_FILES];
  assert.equal(new Set(all).size, all.length, 'allowlist contains no duplicate paths');
  const root = await sourceFixture();
  const additions = [
    'tools/portal_controller.mjs',
    'tools/sky_figure.mjs',
    'tests/portal_controller.test.mjs',
    'docs/PORTAL.md',
    'docs/VALIDATION.md',
    'tests/fixtures/geometry_fixture.mjs',
    'editor/tests/scene_integration.mjs',
  ];
  for (const relative of additions) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), `Synthetic optional source: ${relative}\n`);
  }
  const result = await collectSource(root);
  for (const relative of additions) {
    assert.ok(result.files.some((file) => file.path === relative));
    assert.equal(result.missingOptional.includes(relative), false);
  }
  await unlink(path.join(root, 'editor/src/sceneview.cpp'));
  await assert.rejects(collectSource(root), /Required source is missing: editor\/src\/sceneview.cpp/);
});

test('real source archive includes the relative JavaScript import dependencies of every included module', async () => {
  const { files } = await collectSource();
  const names = new Set(files.map((f) => f.path));
  for (const file of files.filter((f) => f.path.endsWith('.mjs'))) {
    const text = file.bytes.toString('utf8');
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"\n]+\.mjs)['"]/g)) {
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), match[1]));
      assert.ok(names.has(dependency), `${file.path} imports excluded source ${dependency}`);
    }
  }
});
