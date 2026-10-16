# Set up the source tools using your own game files

This project ships source code, synthetic tests, documentation and edit recipes.
It does not supply a game, a PKG, decrypted executables, console modules, or
prebuilt modified levels. The setup helper reads your own local input and writes
all generated files into a new directory that you choose.

The format work was validated against **Skylanders Trap Team PS4 CUSA00697,
application version 01.00**, with IGA `0x0B` archives and IGZ v8/platform 14.
Other regions and updates may differ. Recipes require an exact source hash;
an accepted archive/header alone does not establish equivalent game behavior.

## Linux dependencies

Required for the archive tools:

- Node.js 24 or newer for the complete toolset and tests; no runtime npm modules are required.
- A C++17 compiler available as `c++`, `pkg-config`, and liblzma development files
  (5.2 or newer).

Required for the desktop editor and its MCP server:

- CMake 3.21 or newer, GNU Make, and Qt 6.2 or newer Core/Widgets/OpenGL development files.
- A desktop/display for the GUI. The MCP mode and automated Qt tests work headlessly.
- Optional live game-window hosting: X11/XWayland plus `xcb` and `xcb-shape`
  development libraries. Without them the explicit PNG fallback still works.

For Debian/Ubuntu, the usual build dependencies are:

```bash
sudo apt install build-essential pkg-config liblzma-dev cmake qt6-base-dev libqt6opengl6-dev
```

For the native live preview on Debian/Ubuntu, also install `libxcb1-dev` and
`libxcb-shape0-dev` before configuring the editor. See
[saved preview setup](GAME_PREVIEW.md) for the separate emulator, checkpoint
and private-game requirements.

Install a supported Node.js version separately if your distribution's package
is older than 24. The helper never invokes a package manager or changes system
configuration. Check the dependencies before starting a large extraction:

```bash
node tools/setup_from_pkg.mjs --check-deps
```

The tested Linux x86-64 environment reported Node.js **26.8.2**, GCC **16.2.1**,
CMake **4.4.3**, GNU Make **4.4.1**, Qt **6.11.2**, and liblzma **5.8.4**.
Those exact versions are evidence of the tested build, not minimum requirements.
The GUI is C++/Qt; Node runs the shared file-format backend.

## Obtain an extractor separately

For the PKG path, supply your own trusted extractor executable explicitly.
The helper implements the CLI of
[ShadPs4Plus PKG Extractor 1.1](https://github.com/AzaharPlus/shadPS4Plus/releases/tag/PKG_EXTRACTOR_1_1).
Version 1.1 fixes the upstream 1.0 extraction bug affecting some packages larger
than 2 GB, so do not use 1.0 for this game. The release is available separately
from this source bundle; setup does not download it.

Known files used during this investigation:

| Item | SHA-256 |
| --- | --- |
| `ShadPs4Plus-PkgExtractor-1.1-linux.zip` | `6dc4f867ced673c940c5c7538024a455bb00a3d3ab0f758db6b96184567bb677` |
| `pkg_extractor.AppImage` inside that ZIP | `b360bc691aa3d89071aa707224155f6eade348d314cf7798ac550e31c11a7bcc` |

Check a downloaded file with `sha256sum /path/to/file`. The matching extractor
source is commit
[`771a8d58aff540448c7cbace7c40a66a5daf010d`](https://github.com/AzaharPlus/shadPS4Plus/tree/771a8d58aff540448c7cbace7c40a66a5daf010d).
The Linux file carries an `.AppImage` filename but the tested release is a
directly runnable, statically linked x86-64 ELF; no AppImage extraction is needed
for that exact file. Give it executable permissions if necessary.

The external extractor's contract is `<PKG> <output-parent>`, creating a title-ID
subdirectory. Its `--check-type` mode returns **101** for a base game, **102** for
an update and **103** for DLC. Setup accepts a base-game package only. Its normal
extraction can return zero even after an error message, so setup additionally
checks failure text and required output files. The resulting local hashes are
an inventory of what was extracted, not independent verification against an
official game's checksums.

## Start from your own readable PKG

Run from the unpacked source project's root, replacing these paths:

```bash
node tools/setup_from_pkg.mjs \
  --pkg "/path/to/your-own-trap-team.pkg" \
  --extractor "/path/to/pkg_extractor.AppImage" \
  --work ./local-work/session-01 \
  --level level/arena_challenge_303_000.bld \
  --geometry-level level/arena_mesh_303.bld
```

`--level` is the archive path relative to the extracted game's root. Choose a
file that exists in your particular game dump. For example,
`level/level_300_birdcage.bld` is another known archive in CUSA00697. Spaces in
paths are supported when quoted; input paths are passed to subprocesses without
a shell.

`--geometry-level` is optional and uses the same game-root-relative archive
syntax. Challenge303's visible static map is in the companion
`level/arena_mesh_303.bld`; its inner member is also named `level.bld`. Setup
extracts it to `payload/geometry.bld`, records both hashes and adds `--geometry`
to the printed editor command. Use the matching arena, not an arbitrary mesh
package. Omit the option when no companion is known: the editor can still show
verified actors and any supported geometry in the placement input itself.

The requested `--work` directory **must not exist**, even if it is empty. Setup
checks dependencies, hashes your PKG and extractor, checks package type, extracts
the game, inventories and hashes the extracted files, builds `iga_extract`,
extracts the selected inner `level.bld`, verifies its IGZ version/platform, builds
the Qt editor, and runs the editor's synthetic tests. Whole-package hashing can
take several minutes. Allow roughly 25 GB for this game's extracted data, plus
space for the chosen inner level, builds, and future modified copies.

All extractor state is isolated under `extractor-state/user` in the new work
directory. Its current directory and XDG paths are set there, leaving your
existing shadPS4 user configuration alone. Setup does not launch a game, register
MCP servers, install REA/Ghidra, or edit the original input.

If a step fails, the new partial directory and logs are retained for diagnosis.
Inspect them, then use a new output directory for another attempt. Setup never
deletes a whole workspace to retry.

## Start from an already extracted game

You can avoid extracting another copy:

```bash
node tools/setup_from_pkg.mjs \
  --extracted "/path/to/your/CUSA00697" \
  --work ./local-work/session-02 \
  --level level/arena_challenge_303_000.bld \
  --geometry-level level/arena_mesh_303.bld
```

The input root should contain `eboot.bin`, `sce_sys/param.sfo`, and the selected
archive. It is used read-only; the new workspace must be outside that tree. Setup
rejects symlinks inside game inventories so hashes cannot silently refer to
unrelated files. Existing unpacked inputs are not copied in this mode.

For archive tools only, append `--skip-editor`; this avoids Qt/CMake requirements
but still builds `iga_extract`, hashes the input tree, and extracts the selected
IGZ. `--jobs 1` through `--jobs 32` controls editor build parallelism (default up
to four).

## Open the level

For the first example, the exact launch command is:

```bash
./local-work/session-01/build/editor/skylanders-level-editor \
  ./local-work/session-01/payload/level.bld \
  --geometry ./local-work/session-01/payload/geometry.bld
```

Keep the source checkout in place: the binary's default backend path points to
its `tools/level_builder.mjs`. If you move files, pass `--backend` and `--node`
explicitly as described in [the editor guide](../editor/README.md). That guide
also documents MCP stdio registration; setup never modifies your MCP client.

The files opened by the editor are **inner IGZ payloads**, not outer IGA archives
or PKGs. The 3D viewport displays decoded static map triangles and a verified
subset of simple actor models; other spatial actors use box proxies. Pick an
actor, drag an XYZ arrow or edit its coordinates, then export a new edited copy.
Static map geometry is read-only. The editor cannot construct new mesh buffers,
collision, scripts or level slots. See [LEVEL_FORMAT.md](LEVEL_FORMAT.md) and
[the geometry limits](../tools/IGZ_GEOMETRY.md).

For research toward additional chapters, use the separate read-only
[chapter entrypoint](CHAPTER_ENTRYPOINTS.md), [module dependency](MODULE_DEPENDENCIES.md)
and [script graph](SCRIPT_GRAPH.md) tools. Their commands identify every source
by SHA-256 and explain which inner files to extract from your own game.
Native metadata additionally requires your own matching `eboot.elf`; setup does
not automatically produce that ELF or install REA/Ghidra. These JSON reports are
local game-derived research, not distributable source assets or working chapter
recipes. A later narrow [native demo workflow](NATIVE_DEMO.md) now builds a
playable grid/Gallardo sandbox and documents its additional registration and
save prerequisites. The ordinary setup helper does not install that chapter,
and a general script/chapter compiler remains unfinished.
See [the REA/ELF reproduction notes](FINDINGS.md#reproduce-the-rea-analysis)
for the tested plaintext-SELF reconstruction and exact executable digest.

Useful generated files:

| Path inside the chosen work directory | Purpose |
| --- | --- |
| `setup-manifest.json` | Input/tool hashes, selected archive and payload, build versions, launch arguments |
| `inventory.json` | Relative paths, byte lengths and SHA-256 hashes of every extracted input file |
| `payload/level.bld` | Selected inner IGZ file for the editor |
| `payload/geometry.bld` | Optional companion inner geometry IGZ, when `--geometry-level` was supplied |
| `build/iga_extract` | Locally compiled archive extractor |
| `build/editor/skylanders-level-editor` | Locally compiled GUI/MCP executable |
| `logs/` | Extraction, build and test diagnostics |
| `setup-failed.json` | Failure details, present only if setup failed |

After editing, follow [ARCHIVE_REPACK.md](ARCHIVE_REPACK.md) to place the edited
inner file in a **new copy** of its original archive. Companion `.arc` archives
and other original resources remain necessary. The setup helper does not rebuild
a PKG or deploy changes into an emulator's game directory.

## Readable packages, fake SELF and runtime limits

This workflow requires game data that the supplied extractor can read. It does
not convert an encrypted retail package into a usable dump or recover missing
decryption keys. A readable PKG and a loadable executable are separate questions.

The investigated `eboot.bin` was a PS4 fake SELF wrapper with available ELF
content; that enabled local executable analysis after conversion. These tools
do not include a general encrypted SELF decryptor. Editing the level's IGZ does
not require opening or converting `eboot.bin`. The optional metadata extraction
script expects the separately obtained, exact matching ELF and checks its hash.

REA **6.4.0**, Ghidra **12.1.4**, and Java **21** were used for executable research.
They are not bundled and are not dependencies of the editor/setup path. See the
[REA source](https://github.com/morluto/rea) and
[Ghidra releases](https://github.com/NationalSecurityAgency/ghidra/releases)
if independently reproducing that analysis.

shadPS4 is a separate installation; follow
[the emulator's own documentation](https://github.com/shadps4-emu/shadPS4).
First establish that your unmodified dump runs, then test an unchanged repacked
archive, and only then test edited placements. Offline parsing and byte checks
do not prove game compatibility. See [RUNTIME_TESTING.md](RUNTIME_TESTING.md).

For the tested shadPS4 v0.19.0 release, [PORTAL.md](PORTAL.md) documents the
optional local controller for the emulator's built-in Skylanders portal. It
uses a new private runtime session, supports private writable figure copies,
and exposes MCP or JSON-lines controls. This is separate from package setup and
the editor's MCP server. Use a disposable game-tree copy; neither setup nor a
successful portal command establishes that a modified level works.
For GUI checkpoint/resume instructions and the read-only save checksum inspector,
see [SAVE_CHECKPOINTS.md](SAVE_CHECKPOINTS.md). These checkpoints preserve saved
profiles and writable figures, not emulator RAM or a guaranteed intro skip.

## Share a source-only release

The release tool includes **only literal paths listed in its source allowlist**:
the editor, format/setup tools, selected docs, synthetic tests and named recipes.
It does not recursively package the workspace. Files under `research`,
`extracted`, `builds`, `tools/vendor`, editor build folders, or any PKG are absent
regardless of `.gitignore`. Raw REA evidence/pseudocode is not included. Local
setup inventories, manifests and generated modified archives stay local too.

```bash
node tools/package_source.mjs --list
node tools/package_source.mjs --output ./releases/skylanders-level-editor-source.tar.gz
tar -tzf ./releases/skylanders-level-editor-source.tar.gz
```

The destination archive and its `.manifest.json` sidecar must both be new. The
archive has one `skylanders-level-editor-source/` top directory and contains a
`SOURCE_MANIFEST.json` listing included file hashes; the sidecar also hashes the
archive itself. Symlinks, NUL-containing/binary data, non-UTF-8 files, and unusually
large files at an allowed path are rejected. Missing required source files fail
the release; missing optional docs/tests/recipes are reported. Review the list
before distributing it, including optional omissions.

The release does not bundle Qt, liblzma, the PKG extractor, an emulator or game
assets. Recipients build their own binaries and supply their own game inputs.
If you later distribute binaries or third-party dependencies, their license and
notice requirements must be handled separately.

Run the source-only tests with installed build dependencies:

```bash
node --test tests/*.test.mjs
```

Setup tests use tiny synthetic packages and a mock PKG extractor, but compile
and execute the real local IGA extractor, including optional companion extraction.
Geometry tests use synthetic buffer/object graphs, not copied game assets.
Packaging tests place prohibited dummy
files next to valid sources, verify none enters the release using a tar reader,
and check overwrite/symlink/binary rejection. Game integration tests are separate
and require your matching local inputs.

Release-readiness was checked by copying only the literal allowlisted sources
into a fresh temporary directory: the 3D editor and portal dialog built there,
all four CTests passed, and the complete Node test command reported 77 passes
with three optional local-game checks skipped (80 total). No game assets,
emulator binary, save profile or figure data were available in that copy.
This verifies the source build's dependency closure, not the stability of a later
release snapshot; rerun the checks after subsequent changes.

The complete existing-extraction setup was also run against the local CUSA00697
tree: it hashed 2,030 files (24,049,728,053 bytes, including locally derived
files), built the extractor/editor, passed the editor's synthetic tests, and
reproduced the 356,552-byte level-switch IGZ with SHA-256
`e26e2165c3f7c4db0dab11e29fcff4f8479e5023bd0795b87b2686d9d24230cd`.
The real 1.1 extractor's type check was separately verified to return 101 while
creating its state only in the chosen private portable directory. These checks
do not establish that edited levels load in a running game.
