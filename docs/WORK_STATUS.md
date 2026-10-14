# Project status

Last reviewed: 2026-10-14. These are separate tool, file-format and runtime results;
a successful parser test is not a successful playable chapter.

## Editor and source tools

The Qt editor displays decoded map triangles, supported actor models and textures
through OpenGL. Picking, placement edits, fixed-world-size proxies, material
diagnostics, a configurable preview light rig and reproducible captures work.
Copy exports preserve the source and record its hash. The same backend serves MCP.

The authored-scene backend supports a flat grid, a sky/sun preview and an imported
Gallardo display model from a user-supplied archive. Smooth normals, textures,
selection and movement were checked in the hardware renderer. This is an editor
scene, **not a native game chapter**. The model and generated scene are not shipped.

The native tools cover IGA extraction/repacking, IGZ objects and fixups, supported
geometry/material records, script graphs, dependency traversal and chapter data.
Exact-build metadata currently covers 74 classes. Unknown fields and unresolved
references remain explicit rather than being guessed into an editable schema.

## Experimental chapter registration

The registration draft adds a title/load pair and rebuilds all ten language packs.
A separate story draft adds the nineteenth include. Rebuilt global and initializer
archives booted in an isolated runtime game copy.

The UI draft extends the selection loop and description list to 23 while preserving
shared constants used elsewhere. It reuses the existing 23rd button and explicitly
reuses an arena loading backdrop. Independent extraction verified the rebuilt
archive members. **Selecting this new entry in-game has not yet been validated.**

## Measured save migration

Read-only measurements of an owned emulator process found 7,999 assigned slot bits
before registration and 8,081 afterward: payload sizes of 1,000 and 1,012 bytes.
The 376-byte header payload was unchanged. The migration tool preserves existing
fields, initializes new elements and recalculates the checksum in new files.

An isolated run with modified registration and migrated saves displayed 100%
progress, 180 stars and rank 40, loaded the Academy without the opening tutorial,
recognized Food Fight and accepted movement. It exited cleanly. All four
1,016-byte slots and the 380-byte header had valid checksums afterward.

That demonstrates loading the existing hub with this measured layout. It does
**not** establish new-chapter completion, saving or reload compatibility.

## Remaining work

- Select and load a new independent chapter archive through the normal UI.
- Author native floor/render geometry with matching collision and initialized
  player, camera and scripts.
- Verify entry, traversal, exit, completion and save/reload in the emulator.
- Extend material, light and animation reconstruction where it is still partial.

The [demo chapter plan](DEMO_CHAPTER_PLAN.md) records these integration gates.
No fully playable new native chapter is claimed by this release.

## Source-release checks

The source-only checkout built successfully on Linux. Its JavaScript suite passed
254 tests, with 37 asset-dependent tests skipped and no failures. All seven CTests
passed, including the optional OpenGL renderer test. These checks used synthetic
fixtures, not a bundled game installation.
