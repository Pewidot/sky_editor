# Sky Editor

A C++/Qt level editor for **Skylanders Trap Team, PS4 CUSA00697 v01.00**.
Built by reverse engineering the game's archives, object layouts and loaders
with REA and Ghidra. Not an official SDK.

| Editor | In-game freecam (shadPS4) |
| :---: | :---: |
| ![Know-It-All Island, editor](docs/screenshots/know-it-all-bridge.png) | ![Know-It-All Island, native renderer](docs/screenshots/know-it-all-freecam.png) |
| ![Gallardo workshop, editor](docs/screenshots/gallardo-workshop.png) | ![Gallardo workshop, native renderer](docs/screenshots/gallardo-ingame.png) |

Actual captures, with overlays and HUD hidden. The editor uses its own light
rig; the game supplies the native materials, sky and shadows. Similar angles,
not pixel-matched views. [More screenshots](docs/SCREENSHOTS.md).

## Build

Linux, C++17, CMake 3.21+, Qt 6.2+ and Node.js 24+. Archive extraction needs
liblzma; GLB texture import uses ImageMagick. Native live preview also needs
`xcb`, `xcb-shape` and X11/XWayland.

```sh
cmake -S editor -B editor/build -DCMAKE_BUILD_TYPE=Release
cmake --build editor/build --parallel 4
./editor/build/skylanders-level-editor --renderer gpu /path/to/inner/level.bld
```

Open the **inner IGZ**, not the outer archive. Both can end in `.bld`.
[Setup from your own game files](docs/SETUP.md).

## Using it

- Right mouse + WASD to fly, Q/E for height. F frames the selection.
- Click an object and drag its axes, or edit it in the inspector.
- **Import GLB…** creates an authored workshop with rotation, scale and box
  collision. [Supported formats](docs/MODEL_IMPORT.md).
- **Play** builds a private game copy and opens it in the docked Live view.
  It needs a [configured emulator/game/checkpoint profile](docs/GAME_PREVIEW.md).
  Stop ends that session; freecam speed and HUD visibility are adjustable.
- `--mcp` exposes inspection, import, captures and copy builds over stdio.
  [MCP setup](editor/README.md#mcp-integration).

Still a work in progess: imports don't insert arbitrary models into original
chapters, collision is a solid box rather than a mesh, and transparent GLB
materials currently use a reported opaque fallback. Some original models,
materials and scripts aren't supported. Exports preserve the input files.

## Scripts and enemies

Sunbreak's two relays unlock its finish beacon. In pseudocode:

```text
visit west relay -> remember west, complete its objective
visit east relay -> remember east, complete its objective
visit beacon with both active -> native LevelEnd -> save and results
```

[Code and enemy walkthrough](docs/SCRIPT_EXAMPLE.md): the actual mission
builder, an original enemy controller's queue/living-enemy checks, and a small
script to inspect them. This isn't a drag-and-drop encounter builder yet.

## Notes

[Controls](editor/README.md) · [Reverse engineering](docs/REVERSE_ENGINEERING.md) ·
[Current status](docs/WORK_STATUS.md) · [Contributing and tests](CONTRIBUTING.md)

MIT for the editor and tools; shadPS4 patches remain GPL-2.0-or-later.
[Third-party notices](THIRD_PARTY_NOTICES.md). Screenshots show third-party
assets, not MIT-licensed content. No game packages, extracted models, saves or
vehicle archives are included. Supply your own files.
