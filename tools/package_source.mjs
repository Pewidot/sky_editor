#!/usr/bin/env node

// A literal allowlist, not a recursive workspace archive. Game data and reverse-
// engineering outputs must never become release inputs just by existing nearby.
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const DEFAULT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PREFIX = 'skylanders-level-editor-source';
export const REQUIRED_SOURCE_FILES = Object.freeze([
  'tools/iga_extract.cpp',
  'tools/iga_inspect.mjs',
  'tools/iga_replace.mjs',
  'tools/authored_scene.mjs',
  'tests/authored_scene.test.mjs',
  'docs/AUTHORED_SCENE.md',
  'tools/beamng_shape.mjs',
  'tools/gallardo_demo.mjs',
  'tests/beamng_shape.test.mjs',
  'docs/GALLARDO_DEMO.md',
  'tools/story_registration_draft.mjs',
  'tests/story_registration_draft.test.mjs',
  'docs/STORY_REGISTRATION_DRAFT.md',
  'tools/chapter_ui_draft.mjs',
  'tests/chapter_ui_draft.test.mjs',
  'docs/CHAPTER_UI_DRAFT.md',
  'tools/save_layout_migrate.mjs',
  'tests/save_layout_migrate.test.mjs',
  'docs/SAVE_LAYOUT_MIGRATION.md',
  'docs/RUNTIME_SAVE_LAYOUT.md',
  'docs/DEMO_CHAPTER_PLAN.md',
  'tools/igz.mjs',
  'tools/igz_inspect.mjs',
  'tools/igz_geometry.mjs',
  'tools/level_builder.mjs',
  'tools/igz_texture.mjs',
  'tests/igz_texture.test.mjs',
  'docs/TEXTURE_PREVIEW.md',
  'tools/igz_material.mjs',
  'tests/igz_material.test.mjs',
  'docs/MATERIAL_DIAGNOSTICS.md',
  'tools/igz_catalog.mjs',
  'tests/igz_catalog.test.mjs',
  'docs/IGZ_CATALOG.md',
  'tools/chapter_catalog.mjs',
  'tests/chapter_catalog.test.mjs',
  'tools/lighting_catalog.mjs',
  'tests/lighting_catalog.test.mjs',
  'docs/LIGHTING_CATALOG.md',
  'tools/elf_metadata.mjs',
  'tests/elf_metadata.test.mjs',
  'tools/chapter_registry.mjs',
  'tests/chapter_registry.test.mjs',
  'docs/CHAPTER_REGISTRY.md',
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
  'tools/setup_from_pkg.mjs',
  'tools/package_source.mjs',
  'tools/runtime_checkpoint.mjs',
  'tools/portal_controller.mjs',
  'tools/sky_figure.mjs',
  'tools/native_camera_control.mjs',
  'tools/native_camera_pose.mjs',
  'tests/native_camera_control.test.mjs',
  'tests/portal_camera.test.mjs',
  'tools/native_fastboot_title.mjs',
  'tools/native_script_writer.mjs',
  'tests/native_fastboot_title.test.mjs',
  'tools/native_fastboot_map.mjs',
  'tests/native_fastboot_map.test.mjs',
  'tools/native_fastboot_legal.mjs',
  'tests/native_fastboot_legal.test.mjs',
  'tools/prepare_game_preview.mjs',
  'tests/prepare_game_preview.test.mjs',
  'docs/FAST_PREVIEW.md',
  'docs/GAME_PREVIEW.md',
  'tools/preview_routes.mjs',
  'tools/object_transform.mjs',
  'tools/igz_memory_replace.mjs',
  'tools/chapter_thumbnail.mjs',
  'tests/chapter_thumbnail.test.mjs',
  'docs/CHAPTER_THUMBNAIL.md',
  'docs/NATIVE_DEMO.md',
  'docs/SUNBREAK.md',
  'docs/MODEL_IMPORT.md',
  'tools/glb_import.mjs',
  'tests/glb_import.test.mjs',
  'tests/fixtures/glb.mjs',
  'tools/native_demo.mjs',
  'tools/native_demo_builder.mjs',
  'tools/ps4_bc1_encode.mjs',
  'tests/native_demo.test.mjs',
  'tools/save_inspect.mjs',
  'tests/save_inspect.test.mjs',
  'docs/SAVE_CHECKPOINTS.md',
  'tools/wii_save_inspect.mjs',
  'tests/wii_save_inspect.test.mjs',
  'docs/WII_SAVE_INSPECTION.md',
  'tools/derive_slot_checkpoint.mjs',
  'tests/derive_slot_checkpoint.test.mjs',
  'tools/arena_test_gate.mjs',
  'tests/arena_test_gate.test.mjs',
  'docs/ARENA_TEST_ROUTE.md',
  'tools/collision_builder.mjs',
  'tests/collision_builder.test.mjs',
  'docs/COLLISION_AUTHORING.md',
  'tests/fixtures/collision_fixture.mjs',
  'editor/tests/collision_builder.mjs',
  'tools/igz_append.mjs',
  'tests/igz_append.test.mjs',
  'tests/igz_append.integration.test.mjs',
  'docs/IGZ_APPEND.md',
  'tools/actor_clone.mjs',
  'tests/actor_clone.test.mjs',
  'docs/ACTOR_CLONE.md',
  'tests/portal_sequence.test.mjs',
  'recipes/arena_route_inputs.json',
  'docs/WORK_STATUS.md',
  'docs/INPUT_IPC.md',
  'tests/input_ipc_pulse.cpp',
  'tools/patches/shadps4-input-ipc.patch',
  'tools/patches/shadps4-host-headers.patch',
  'editor/CMakeLists.txt',
  'editor/README.md',
  'editor/src/main.cpp',
  'editor/src/backend.cpp',
  'editor/src/backend.h',
  'editor/src/window.cpp',
  'editor/src/window.h',
  'editor/src/mcp.cpp',
  'editor/src/mcp.h',
  'editor/src/sceneview.cpp',
  'editor/src/sceneview.h',
  'editor/src/gpurenderer.cpp',
  'editor/src/gpurenderer.h',
  'docs/GPU_RENDERER.md',
  'editor/src/portaldialog.cpp',
  'editor/src/portaldialog.h',
  'editor/src/nativegameview.cpp',
  'editor/src/nativegameview.h',
  'editor/src/nativewindowhost.cpp',
  'editor/src/nativewindowhost.h',
  'editor/src/previewlaunch.cpp',
  'editor/src/previewlaunch.h',
  'editor/tests/previewlaunch_workflow.cpp',
  'editor/tests/prepare_game_preview.mjs',
  'editor/tests/previewlaunch_live.cpp',
  'editor/tests/portal_controller.mjs',
  'editor/tests/nativewindow_workflow.cpp',
  'editor/tests/nativegameview_workflow.cpp',
  'editor/tests/nativecamera_workflow.cpp',
  'editor/tests/nativecamera_live.cpp',
  'editor/tests/protocol.mjs',
  'editor/tests/mock_backend.mjs',
  'editor/tests/gui_workflow.cpp',
  'editor/tests/portal_workflow.cpp',
  'editor/tests/mock_portal.mjs',
  'editor/tests/texture_render.cpp',
  'editor/tests/render_cli.mjs',
  'tests/igz_geometry.test.mjs',
  'tools/IGZ_GEOMETRY.md',
  'tests/fixtures/mock_shadps4.mjs',
  'docs/SETUP.md',
  'docs/ARCHIVE_REPACK.md',
  '.gitignore',
]);
export const OPTIONAL_SOURCE_FILES = Object.freeze([
  'CONTRIBUTING.md',
  '.editorconfig',
  '.clang-format',
  '.prettierrc.json',
  'package.json',
  'package-lock.json',
  'docs/REVERSE_ENGINEERING.md',
  'README.md',
  'LICENSE',
  'LICENSE.md',
  'THIRD_PARTY_NOTICES.md',
  'LICENSES/GPL-2.0-or-later.txt',
  'tools/build_recipe.mjs',
  'tools/IGZ_READER.md',
  'tests/portal_controller.test.mjs',
  'docs/PORTAL.md',
  'tests/runtime_checkpoint.test.mjs',
  'recipes/crossfire_layout.json',
  'docs/LEVEL_FORMAT.md',
  'docs/FINDINGS.md',
  'docs/RUNTIME_TESTING.md',
  'docs/VALIDATION.md',
  'tests/iga_extract.test.mjs',
  'tests/iga_replace.test.mjs',
  'tests/iga_roundtrip.integration.test.mjs',
  'tests/setup_from_pkg.test.mjs',
  'tests/package_source.test.mjs',
  'tests/level_builder.test.mjs',
  'tests/level_builder.integration.test.mjs',
  'tests/igz.test.mjs',
  'tests/fixtures/igz_fixture.mjs',
  'editor/tests/real_integration.mjs',
  'tests/fixtures/geometry_fixture.mjs',
  'editor/tests/scene_integration.mjs',
]);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function regularSource(root, relative) {
  let current = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Symlinks cannot enter a source release: ${relative}`);
    if (index < parts.length - 1 && !info.isDirectory())
      throw new Error(`Invalid source parent: ${relative}`);
    if (index === parts.length - 1 && !info.isFile())
      throw new Error(`Not a regular source file: ${relative}`);
  }
  const info = await lstat(current);
  if (info.size > 2 * 1024 * 1024) throw new Error(`Source file exceeds 2 MiB safety limit: ${relative}`);
  const bytes = await readFile(current);
  if (bytes.includes(0)) throw new Error(`Binary/NUL bytes in an allowlisted source path: ${relative}`);
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Non-UTF-8 content in an allowlisted source path: ${relative}`);
  }
  return bytes;
}

export async function collectSource(root = DEFAULT_ROOT) {
  root = await realpath(root);
  const files = [];
  const missingOptional = [];
  for (const relative of [...REQUIRED_SOURCE_FILES, ...OPTIONAL_SOURCE_FILES].sort()) {
    let bytes;
    try {
      bytes = await regularSource(root, relative);
    } catch (error) {
      if (error.code === 'ENOENT' && OPTIONAL_SOURCE_FILES.includes(relative)) {
        missingOptional.push(relative);
        continue;
      }
      if (error.code === 'ENOENT') throw new Error(`Required source is missing: ${relative}`);
      throw error;
    }
    files.push({ path: relative, bytes, size: bytes.length, sha256: sha256(bytes) });
  }
  if (files.reduce((total, file) => total + file.size, 0) > 16 * 1024 * 1024) {
    throw new Error('Source release exceeds 16 MiB safety limit');
  }
  return { files, missingOptional };
}

function tarEntry(name, bytes) {
  if (Buffer.byteLength(name) >= 100)
    throw new Error(`Release path exceeds conservative USTAR limit: ${name}`);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  const octal = (offset, length, value) =>
    header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii');
  octal(100, 8, 0o644);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, bytes.length);
  octal(136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, value) => sum + value, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return [header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)];
}

export async function bundleSource({ root = DEFAULT_ROOT, output }) {
  output = path.resolve(output);
  if (!output.endsWith('.tar.gz')) throw new Error('Output filename must end with .tar.gz');
  const { files, missingOptional } = await collectSource(root);
  const manifest = {
    schema: 'skylanders-source-release-v1',
    archivePrefix: PREFIX,
    contentPolicy: 'literal-source-allowlist; no game files, binaries, vendor tools or raw REA dumps',
    files: files.map(({ path: relative, size, sha256: hash }) => ({ path: relative, size, sha256: hash })),
    missingOptional,
  };
  const records = [];
  for (const file of files) records.push(...tarEntry(`${PREFIX}/${file.path}`, file.bytes));
  records.push(
    ...tarEntry(`${PREFIX}/SOURCE_MANIFEST.json`, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)),
  );
  records.push(Buffer.alloc(1024));
  const archive = gzipSync(Buffer.concat(records), { level: 9 });
  const release = {
    ...manifest,
    archive: { filename: path.basename(output), size: archive.length, sha256: sha256(archive) },
  };
  await mkdir(path.dirname(output), { recursive: true });
  let archiveHandle;
  let manifestHandle;
  let complete = false;
  try {
    archiveHandle = await open(output, 'wx', 0o644);
    manifestHandle = await open(`${output}.manifest.json`, 'wx', 0o644);
    await archiveHandle.writeFile(archive);
    await manifestHandle.writeFile(`${JSON.stringify(release, null, 2)}\n`);
    await archiveHandle.sync();
    await manifestHandle.sync();
    complete = true;
    return release;
  } finally {
    await Promise.allSettled([archiveHandle?.close(), manifestHandle?.close()]);
    if (!complete) {
      if (archiveHandle) await unlink(output);
      if (manifestHandle) await unlink(`${output}.manifest.json`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--list') {
    const { files, missingOptional } = await collectSource();
    console.log(
      JSON.stringify(
        {
          files: files.map(({ path: name, size, sha256: hash }) => ({ path: name, size, sha256: hash })),
          missingOptional,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (args.length !== 2 || args[0] !== '--output') {
    throw new Error('Usage: node tools/package_source.mjs --list | --output <new-release.tar.gz>');
  }
  console.log(JSON.stringify(await bundleSource({ output: args[1] }), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`package_source: ${error.message}`);
    process.exitCode = 1;
  });
}
