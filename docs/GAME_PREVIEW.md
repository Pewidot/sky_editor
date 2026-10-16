# Play the current map

The editor's **Play current map** action uses a saved preview profile. It packs
the current document's pending position edits, prepares a fresh private game
copy, restores a copied save/figure checkpoint and starts that map. A profile
is configuration, not a game asset or an emulator RAM savestate.

The local profile supports **Know-It-All Island**, **Gallardo**, and imported
static GLB workshops. On-demand routes match source-pinned chapter catalogs or
reproducible build manifests, then verify the installed chapter load string.
Unknown documents fail without starting a different map. This is not a
general-purpose arbitrary-level compiler; see [model import](MODEL_IMPORT.md).

## This workstation

The configured profile is:

```text
/home/peridot/.config/skylanders-level-editor/preview-profile.json
```

Open the supported original inner map from the project root:

```bash
editor/build/skylanders-level-editor --renderer gpu \
  --camera-json '{"pivot":[-69.89,16.99,-98.67],"yawRadians":0,"pitchRadians":-0.524,"distance":40}' \
  research/chapter-catalog-v2/level_314_tutorial_2/level.bld
```

Then click **Play**. No emulator/game/checkpoint selection is
required each time. The profile is discovered from the standard user config
directory. An explicitly chosen profile path is remembered in Qt's user
settings under `SkylandersReverseEngineering/LevelWorkshop`, key
`preview/profilePath`. Select another profile under **Game → Preview
settings**. An already running old editor must be restarted to load new code;
the build does not replace code inside an existing process.

Gallardo with automatic Play after loading:

```bash
editor/build/skylanders-level-editor --renderer gpu --play \
  builds/gallardo-grid-demo-02.scene.json
```

Play immediately selects Live and displays the actual preparation stage
(source checks, registration, native build, archive packing, private copy,
verification). The bar is indeterminate: it does not invent a percentage.
**Stop** in Live or the bottom status bar shuts down only this editor's owned
emulator. During preparation it cancels the pending launch, allowing the
current file operation to finish; it never starts that cancelled result.
Physical gamepads are handled directly by the owned emulator with SDL
background-controller input enabled, because Qt owns the embedded viewport's
focus. They do not use delayed screenshot/IPC pulses. Freecam keyboard/mouse
controls remain separate from gameplay controls.

Editor and Live are tabs in one central workspace. **View → Side by side**
splits them; **View → Tabbed views** joins them again. Drag the dock headers
to rearrange or their separators to resize. Views stay inside the main window;
the object list and inspector cannot replace the central workspace. **View →
Reset layout** restores the default arrangement. Layout is saved separately
from the selected preview profile. Portal controls and preview configuration
are hidden side panels under **Game**, not extra startup dialogs.

In Live, toggle **Free camera** and focus the view: WASD moves, Q/E moves
vertically, and holding the right mouse button captures mouse look. Releasing
RMB releases the pointer; toggle Free camera off or press Esc to restore the
game camera. A heartbeat maintains the hold until disabled; an eight-second
watchdog restores it if the editor stops responding. **Speed** sets movement
from 0.1 to 100 game units per second and is remembered between sessions.
The former 50-unit distance tether has been removed. Distant areas may still
be absent if the game has not loaded them; camera movement does not teleport
the player or force streaming. Native movement updates target 33 ms;
emulator frame rate is separate.

Linux desktop launches default to Qt's `xcb` platform when `DISPLAY` exists,
so the emulator's X11/Vulkan window can be hosted under X11 or XWayland.
An explicitly set `QT_QPA_PLATFORM` is respected. For explicit selection:

```bash
QT_QPA_PLATFORM=xcb editor/build/skylanders-level-editor \
  research/chapter-catalog-v2/level_314_tutorial_2/level.bld
```

Live hosting needs `xcb` and `xcb-shape` development libraries at build time.
The PNG fallback remains available, but is snapshots, not the live renderer.
See [native camera controls and evidence](FAST_PREVIEW.md).

## What Play writes

Each run gets a unique directory under the profile's `outputRoot`, currently:

```text
/home/peridot/.local/share/skylanders-editor/map-previews/preview-XXXXXX/
  level.bld            patched inner map, including pending positions
  map.bld              repacked chapter archive
  CUSA00697/           private game tree
  preview.json         exact inputs, output hashes and launch paths
  session/             created by the controller at launch
```

The prepared game uses independent reflink copies for regular files, not
hardlinks. Unmodified linked assets are accepted only under explicitly listed
source-game roots. Keep those roots mounted; this is not necessarily a fully
local game copy. Preparation fails on a filesystem without compatible reflink
support rather than silently copying gigabytes or sharing writable inodes.

Play includes pending XYZ edits and, for authored workshop objects, rotation,
scale, imported static meshes and generated box collisions. It does not
serialize arbitrary script edits or native Havok terrain from the GUI.
The original document and source game remain unchanged. A failed preparation
is retained with `preparation-error.json`. Repeated Play prepares and validates
first, then stops only the session owned by that editor before launching. It
does not kill unrelated emulator processes. Invalid maps are rejected before
stopping the current owned preview.

The source-bound chapter314 preview suppresses its opening stream. Existing
slot0 is loaded automatically. A missing/corrupt profile follows the game's
error handling; no replacement save is fabricated. Normal figure swaps and
later chapter cinematics remain enabled. The latest accepted start reached
playable gameplay by12.31s after emulator spawn; preparation measured another
8.50s in one run. These are observations, not a ten-second end-to-end guarantee.
On-demand Gallardo preparation measured about 22 seconds in one run; there is
not yet a reusable artifact cache. Original chapter cutscenes are not all
automatically removed by a general on-demand route.

## Reproduce with your own game

No game archives, images, saves or private profile are distributed. Start with
[SETUP.md](SETUP.md) and your own readable CUSA00697 version01.00. Obtain/build
the input-IPC emulator described in [INPUT_IPC.md](INPUT_IPC.md), and create a
matching stopped-session [save/figure checkpoint](SAVE_CHECKPOINTS.md).
Use a prepared private game tree; never install preview archives into your
only extracted original. A checkpoint and game with different chapter/save
registrations are not interchangeable.

Extract the `level.bld` member from these three original outer archives using
the archive tools documented in [ARCHIVE_REPACK.md](ARCHIVE_REPACK.md):

| Outer archive | Purpose |
| --- | --- |
| `level/title.bld` | Bootstrap, existing save and direct-map selection |
| `item/legal.bld` | Initial copyright-screen timing |
| `level/level_314_tutorial_2.bld` | Know-It-All Island intro-stream argument |

The portable builders require exact supported source hashes and NEW output
directories. Replace the illustrative absolute paths below:

```bash
node tools/native_fastboot_title.mjs \
  /work/original-title/level.bld /games/original/CUSA00697/level/title.bld \
  /work/title-preview Level_314_Tutorial_2 auto-slot

node tools/native_fastboot_legal.mjs \
  /work/original-legal/level.bld /games/original/CUSA00697/item/legal.bld \
  /work/legal-preview

node tools/native_fastboot_map.mjs \
  /work/original-map/level.bld /games/original/CUSA00697/level/level_314_tutorial_2.bld \
  /work/map-preview
```

Each builder preserves originals and records output hashes. Install the legal
archive only in the stopped private base, preserving its old file. The launch
preparer substitutes the selected title and map in each new run. Independently
validate your base/profile first; the native acceptance in this workspace used
an existing registered private game, not a newly extracted clean setup.

Create a JSON profile of this form. All paths must be absolute. Replace hash
placeholders with `sha256sum` results, not arbitrary strings; the launcher
verifies them. The fixed original chapter hash below identifies this build.

```json
{
  "schema": "skylanders-game-preview-v1",
  "emulator": "/work/preview/shadps4",
  "emulatorSha256": "<64 lowercase hex characters>",
  "gameRoot": "/work/preview/CUSA00697",
  "gameExecutableSha256": "<eboot.bin SHA-256>",
  "checkpoint": "/work/preview/checkpoint",
  "outputRoot": "/work/map-previews",
  "gamePins": {
    "permanent/global.bld": "<private base global SHA-256>",
    "character/init_setup.bld": "<private base setup SHA-256>",
    "item/legal.bld": "<generated legal archive SHA-256>"
  },
  "assetRoots": ["/games/original/CUSA00697"],
  "maps": [{
    "sourceSha256": "89c8ad20fdac917a7e1b3c4587b0cc25a3133e4bee0f43bae47ab9f71277173b",
    "loadString": "Level_314_Tutorial_2",
    "label": "Know-It-All Island",
    "archivePath": "level/level_314_tutorial_2.bld",
    "archiveSource": "/games/original/CUSA00697/level/level_314_tutorial_2.bld",
    "archiveSourceSha256": "c17ce18ecc9d49746d770acfb8fb29d7327f2f6dcca78c975c20166e40c3d437",
    "previewInner": "/work/map-preview/level.bld",
    "previewInnerSha256": "53377a242c43029fdcc7dac35857ce2a106cb0ff9458a0adf163cc336c1cb3a6",
    "titleArchive": "/work/title-preview/title.bld",
    "titleArchiveSha256": "98cbc704b29b0a419260406e8a693797e36ca7380c6619273339e342f1c11d2d"
  }]
}
```

Create `outputRoot` before use, on the same reflink-capable filesystem as the
regular base files. `assetRoots` lists only allowed read-only game directories,
not broad home/workspace roots. Store the profile at
`$XDG_CONFIG_HOME/skylanders-level-editor/preview-profile.json` (normally
`~/.config/...`) or choose it once in Preview settings. Other map bindings need
their own source/preview hashes, original archive and matching title target;
do not rename a314 binding to another chapter.

## Non-launching API and tests

`tools/prepare_game_preview.mjs` accepts one JSON object on stdin and returns
one JSON result. It prepares but **never launches** the emulator:

```json
{
  "profilePath": "/absolute/preview-profile.json",
  "levelPath": "/absolute/original-map/level.bld",
  "expectedSha256": "89c8ad20fdac917a7e1b3c4587b0cc25a3133e4bee0f43bae47ab9f71277173b",
  "edits": [{"id": 123, "position": [1, 2, 3]}]
}
```

The example object ID is illustrative; use a verified movable actor from your
actual document. Empty `edits` is valid. Success returns schema
`skylanders-prepared-preview-v1`, exact source/output hashes, edit count,
selected load string, private game/session/checkpoint paths and
`emulatorStarted:false`. Errors return `error` and a nonzero exit code.

Synthetic tests do not need game data:

```bash
node --test tests/prepare_game_preview.test.mjs
ctest --test-dir editor/build -R 'previewlaunch|nativecamera|nativegameview|portal_ui' --output-on-failure
```

The reflink test can use `SKYLANDERS_PREVIEW_TEST_TMP` pointing at an existing
private directory on a capable filesystem. Exact-build builder tests use your
local optional fixtures; absent private files are reported as skipped, not
silently treated as native success. See [FAST_PREVIEW.md](FAST_PREVIEW.md) for
the measured evidence and still-open runtime checks.
