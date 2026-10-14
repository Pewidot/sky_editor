# Sky Editor

A C++/Qt level inspection and placement editor for **Skylanders Trap Team on PS4**,
with an OpenGL viewport, command-line tools and an MCP interface.

This project grew out of reverse engineering the game's IGA archives, IGZ object
graphs, native loaders and script metadata. REA and Ghidra were used to investigate
locally supplied game files; the editor and parsers are independent implementations,
not an official SDK or a source-code port. The research process and evidence
boundaries are described in [Reverse engineering](docs/REVERSE_ENGINEERING.md).

The tested build is EUR **CUSA00697 v01.00**. Other platforms and updates are not
validated. No game package, executable, extracted asset, save, figure dump or
third-party vehicle model is included. You must supply your own local files.

## What works

- Browse decoded map geometry and supported static actor models with textures.
  Pick actors and move their supported placement roots using XYZ handles or the inspector.
- Inspect materials, UV bindings, collision boxes and script/resource relationships.
  Adjust the preview light rig and capture reproducible views.
- Export edits to new files with source hashes and manifests, then rebuild an archive.
  The tools preserve originals and reject incompatible inputs.
- Use the same inspection and editing backend through MCP.
- Preview authored scenes, including the optional private-model
  [Gallardo grid demo](docs/GALLARDO_DEMO.md).

This is still an experimental editor. Native static-map authoring, a complete
script compiler, animation, exact game shading and fully playable new chapters
are **not finished**. Unsupported actors are labelled proxies; the lighting rig
is a preview, not a reconstruction of every in-game light. Chapter-registration
and save-migration tools are research utilities, not a one-click chapter installer.
See [current status](docs/WORK_STATUS.md) for the tested boundaries.

## Build and open a map

Requirements: C++17, CMake 3.21+, Qt 6.2+ (Core, Widgets, OpenGL), liblzma development
headers and Node.js 24+ for the complete toolset and tests. Linux is the tested
host. The runtime JavaScript tools have no npm dependencies.

```bash
cmake -S editor -B editor/build -DCMAKE_BUILD_TYPE=Release
cmake --build editor/build --parallel 4
./editor/build/skylanders-level-editor --renderer gpu /path/to/inner/level.bld
```

For a placement file whose geometry lives in a companion archive:

```bash
./editor/build/skylanders-level-editor --renderer gpu \
  /path/to/placement/level.bld --geometry-file /path/to/geometry/level.bld
```

The editor reads the **inner IGZ payload**, not the outer IGA archive. Both can
have a `.bld` extension. The setup helper extracts the right layer and prints
the full launch command:

```bash
node tools/setup_from_pkg.mjs --check-deps
node tools/setup_from_pkg.mjs \
  --extracted /path/to/CUSA00697 \
  --work ./local-work/session-01 \
  --level level/arena_challenge_303_000.bld \
  --geometry-level level/arena_mesh_303.bld
```

The work directory must not exist. To start from a PKG instead, follow
[Setup](docs/SETUP.md); that route requires a separately obtained extractor.
The helper does not download games or install system packages.

Hold the right mouse button and use **WASD** to fly; **Q/E** moves vertically.
Click an actor to select it, drag an axis to move it, or edit its coordinates in
the inspector. **F** focuses the selection and **Home** frames the map.
Use **Build edited copy** to export to a new filename. Static map geometry is
read-only; triggers remain fixed-world-size boxes. `--renderer cpu` selects the
software fallback.

## MCP

```bash
./editor/build/skylanders-level-editor --mcp \
  --backend /absolute/path/to/sky_editor/tools/level_builder.mjs
```

The server communicates over stdio and shares the desktop editor's file backend,
not its live pending edits. It supports inspection, object listing, material
diagnostics, captures and copy builds. See [editor documentation](editor/README.md#mcp-integration)
for client configuration and arguments. REA is a separate investigation tool;
it is not required to use the editor. The optional
[portal controller](docs/PORTAL.md) runs isolated shadPS4 test sessions.

## Documentation

| Topic | Guide |
| --- | --- |
| Local game setup and dependencies | [Setup](docs/SETUP.md) |
| Viewport, controls and MCP | [Editor](editor/README.md) |
| Research method and evidence | [Reverse engineering](docs/REVERSE_ENGINEERING.md) |
| Archives and object layout | [Level format](docs/LEVEL_FORMAT.md), [IGZ reader](tools/IGZ_READER.md), [archive repacking](docs/ARCHIVE_REPACK.md) |
| Rendering | [GPU renderer](docs/GPU_RENDERER.md), [material diagnostics](docs/MATERIAL_DIAGNOSTICS.md), [lighting catalog](docs/LIGHTING_CATALOG.md) |
| Chapter and script research | [Entrypoints](docs/CHAPTER_ENTRYPOINTS.md), [script graphs](docs/SCRIPT_GRAPH.md), [module dependencies](docs/MODULE_DEPENDENCIES.md) |
| Experimental chapter extension | [Registration](docs/CHAPTER_REGISTRATION_DRAFT.md), [story registration](docs/STORY_REGISTRATION_DRAFT.md), [UI draft](docs/CHAPTER_UI_DRAFT.md) |
| Saves and testing | [Runtime testing](docs/RUNTIME_TESTING.md), [checkpoints](docs/SAVE_CHECKPOINTS.md), [measured save migration](docs/SAVE_LAYOUT_MIGRATION.md) |
| Authored preview scenes | [Scene format](docs/AUTHORED_SCENE.md), [Gallardo demo](docs/GALLARDO_DEMO.md) |

Research notes refer to hashes and private evidence paths so observations can be
traced to their inputs. Those game-derived files are intentionally not bundled.

## Tests and development

```bash
node --test tests/*.test.mjs
ctest --test-dir editor/build --output-on-failure
```

Synthetic tests need no game files. Asset-dependent integration tests are opt-in;
their variables are documented with the relevant tools. These tests validate
tool behavior and file structure, not gameplay compatibility. Formatting and
contribution instructions are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License and distribution

The independent editor and tools are [MIT licensed](LICENSE). The shadPS4 patches
retain **GPL-2.0-or-later**; see [third-party notices](THIRD_PARTY_NOTICES.md).
Neither license grants rights to game or model assets.

Use the source-allowlist packager described in [Setup](docs/SETUP.md) when sharing
a working checkout. Never archive a workspace containing private game data.
This is an unofficial project, not affiliated with Activision, Toys for Bob or Sony.
