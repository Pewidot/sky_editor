# C++ level editor and MCP server

This Qt 6 desktop application opens an **extracted inner `level.bld` IGZ payload** in an interactive 3D placement editor and exposes its file operations through an MCP stdio server. The viewport draws decoded map triangles with perspective, depth buffering, camera navigation, actor picking, and XYZ move gizmos. Verified static actor models are shown when available; unsupported world-positioned actors use selectable, fixed-world-size editor symbols. Triggers and other logic markers remain boxes; name-classified visible objects can use character, chest, crate or gate placeholders. These are not original model dimensions or collision bounds. Position edits export through `tools/level_builder.mjs` into a new file plus a provenance manifest.

Original chapters support verified actor placement and collision inspection;
their static meshes remain read-only. Authored workshops additionally support
static GLB import, XYZ rotation/scale and automatically generated box collision.
Play compiles supported workshops into a private native game copy. This does
not add arbitrary models to original chapters or generate general mission logic.
See [model import](../docs/MODEL_IMPORT.md) for format and collision limitations.

Editor and Live share a docked workspace, either tabbed or side by side.
[Play configuration](../docs/GAME_PREVIEW.md) describes the saved profile,
on-demand preparation, Stop, embedded native view and persistent freecam.
`--play /path/to/map.scene.json` starts Play after the document loads; it still
requires a locally prepared emulator/game/checkpoint profile.

## Build

For material debugging, repeatable cameras and MCP viewport screenshots see
[Material / UV diagnostics](../docs/MATERIAL_DIAGNOSTICS.md). The Shading selector
includes unlit, UV checker and missing-texture views; the inspector's Display
tab includes isolated selection and a searchable material inspector. `inspect_level_materials` and
`render_level_view` are available after rebuilding/restarting the MCP process.

Requirements: C++17 compiler, CMake 3.21+, Qt 6.2+ Core, Widgets and OpenGL development files, and Node.js supported by the repository backend. Ninja is optional. On Debian/Ubuntu the usual build packages are `build-essential cmake ninja-build qt6-base-dev libqt6opengl6-dev`; install Node.js separately if needed.

From the repository root:

```sh
cmake -S editor -B editor/build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build editor/build
ctest --test-dir editor/build --output-on-failure
```

Tests use synthetic data: the MCP test checks transport, argument validation, scene/texture forwarding, read-only collision/hash forwarding, the 4 MiB input and 64 MiB response limits, errors, and stdout isolation. Offscreen GUI tests check actual triangle rendering, actor/model picking, actors outside the table page, linked-model movement, snapped XYZ dragging, camera shortcuts/flying, collision eligibility/base/offset/yaw math, and exact preservation of untouched coordinate fields. Texture tests check perspective interpolation, near-plane clipping, picking, toggle behavior, and malformed-data fallback. The headless-render test verifies PNG output and no-overwrite behavior. A separate portal GUI test checks figure operations, checkpoint/resume, official-binary capability disabling, bounded gamepad requests, PNG preview verification, capture timeout/stale-image rejection, late input-release recovery, and shutdown during a pending pulse. It uses a fake controller and a generated 2×2 test PNG, never an emulator or game. These tests do not substitute for in-game validation.

An optional integration check runs the complete MCP flow against your locally extracted `arena_challenge_303_000/level.bld`, moves one `LeftSpawn` actor by one unit, reparses the result, checks source preservation, and checks stale-source/no-overwrite errors:

```sh
node editor/tests/real_integration.mjs \
  editor/build/skylanders-level-editor tools/level_builder.mjs \
  /absolute/path/to/arena_challenge_303_000/level.bld
```

The output file and manifest are retained in a new temporary directory printed by the test. They contain your local game data and should not be distributed. Default CTests require no game files or emulator. Optional GPU and X11-host tests need a working display/driver.

Open directly at a repeatable desktop camera (applied after asynchronous scene
loading, without changing the level):

```bash
editor/build/skylanders-level-editor --renderer gpu \
  --camera-json '{"pivot":[-423,100,-73],"yawRadians":-0.4,"pitchRadians":-0.85,"distance":64}' \
  /absolute/path/to/sunbreak-build/level.bld
```

These coordinates frame the Sunbreak recipe. Other levels need their own
camera. The same `--camera-json` works with `--render-scene`; it is not an MCP
server startup option. The GUI workflow test verifies the camera survives the
asynchronous load. `--smoke-test` is a brief empty-window startup test, not a
wait-until-loaded test for an input file.

Read-only verification of the real 3D scene through MCP, including vertex/index and texture-enabled responses, RGBA hashes, deduplication, and transport budgets:

```sh
node editor/tests/scene_integration.mjs \
  editor/build/skylanders-level-editor tools/level_builder.mjs \
  /absolute/path/to/arena_challenge_303_000/level.bld \
  /absolute/path/to/arena_mesh_303/level.bld
```

Optional native-window review of that arena (no emulator, no game-file export):

```sh
editor/build/editor-gui-workflow-test /usr/bin/node \
  "$PWD/tools/level_builder.mjs" \
  /absolute/path/to/arena_challenge_303_000/level.bld \
  /absolute/path/to/private/editor-review.png \
  /absolute/path/to/arena_mesh_303/level.bld
```

This opens the real editor window, clicks visible `GarageDoor_1` model triangles,
stages numeric XYZ changes and each gizmo axis in memory, and checks exact undo.
It verifies both original file hashes remain unchanged and writes only the
requested overview PNG plus `editor-review.png.selection.png` and
`editor-review.png.collision.png`, a warm-preview-light panel capture
`editor-review.png.lighting.png`, and a same-camera
`editor-review.png.textures-off.png` comparison. The collision check verifies the known
GarageDoor_4 dimensions, base height, pending translation, and exact undo.
The destination
parent directory must exist. Screenshots contain local game imagery; do not
include them in a distributable source package. Set `QT_QPA_PLATFORM=offscreen`
to run the same check without a native window. This fixture-specific review is
not one of the six synthetic default tests.

For a reusable **read-only scene image**, without fixture-specific actor checks:

```sh
QT_QPA_PLATFORM=offscreen editor/build/skylanders-level-editor \
  /absolute/path/to/inner-level.bld \
  --geometry /absolute/path/to/inner-geometry.bld \
  --render-scene /absolute/path/to/private/new-scene.png
```

This renders the actual 1280×800 editor viewport, including eligible RGB texture
previews, then prints JSON with source/PNG hashes, camera parameters and object/mesh counts and exits.
Add `--frame-object 37482` (use an ID from your own source) for a selected actor
view. Unknown or non-world-positioned IDs fail before creating the PNG. The
report includes the actor ID, source offset and world position. Framing an actor
does not guarantee that surrounding geometry will not obscure it; review the
image before treating it as a visual reference. See [IGZ_CATALOG.md](../docs/IGZ_CATALOG.md).
`--geometry` is optional when the opened IGZ already contains geometry. The PNG
must not exist and its parent directory must exist; nothing is overwritten.
This does not start an emulator, create a level, or alter game data. The PNG
contains locally extracted game imagery and belongs with private outputs.

## Desktop workflow

The dark dock layout has **SCENE OBJECTS** on the left, the viewport in the
center, and **INSPECTOR** on the right. Its **Object** tab holds position edits,
**Display** holds visibility/material diagnostics, and **Lighting** adjusts the
preview light. Panels can be moved, floated or hidden; **View → Reset panel
layout** restores their positions. **View → OUTPUT / SOURCE DETAILS** shows the
initially hidden log. Preview controls never alter game data or pending edits.
Save/export any pending edits before restarting an older running editor to use
a newly built executable.

```sh
./editor/build/skylanders-level-editor /absolute/path/to/arena_challenge_303_000/level.bld \
  --geometry /absolute/path/to/arena_mesh_303/level.bld
```

1. Open the **inner** IGZ file extracted from the game's outer `.bld` archive. A raw PS4 PKG or an outer IGA `.bld` archive is not a GUI input.
2. Supply the companion inner geometry IGZ with `--geometry` or **Load map geometry**. Some challenge packages contain actor placements while the corresponding `arena_mesh_*` package contains the visible map. Without a companion, the editor tries geometry in the opened file and still shows verified world-positioned actors.
3. Click an actor/model in the 3D viewport or select it in the object table. Drag the red X, green Y, or blue Z arrow to stage a move. Alternatively edit X/Y/Z and choose **Stage position change**. Bold table rows and orange proxies show pending changes. **Undo selected change** restores that object's original position; **Clear all pending changes** restores all objects.
4. Choose **Build edited copy** and a filename that does not exist. The source is not overwritten. Pending edits remain staged so you can export additional copies; opening another level or closing asks before discarding them.
5. Follow the repository's packing and testing instructions to put the edited IGZ back into a copy of the original archive. Test with the original resource dependencies available.

The viewport loads **all exported world-positioned actors**, independently of object-list filtering and pagination. Selecting an actor outside the current table page still enables its properties and gizmo. Nonspatial objects remain available in the list, but the editor does not invent locations for scripts or resources. Actors with unresolved parent transforms remain list-only: their verified local coordinates can be edited numerically, while world-space placement is withheld until the transform is understood.

Camera and editing controls:

| Control | Action |
| --- | --- |
| Left-click | Select an actor/model or inspect a read-only static mesh |
| Drag XYZ arrow | Translate the selected verified root actor |
| Middle-drag or Alt + left-drag | Orbit the camera pivot |
| Shift + middle-drag | Pan |
| Hold right mouse + WASD | Look and fly forward/back/left/right |
| Q / E while holding right mouse | Fly down/up; Shift accelerates |
| Mouse wheel | Dolly; while holding right mouse, change fly speed |
| F / Home | Frame the selected actor or static mesh / frame map content |
| Escape during a gizmo drag | Restore the position from before that drag |
| Snap + Snap step | Snap dragged coordinates; default step is one unit |
| Triangle edges / Sky geometry | Toggle triangle edges / background sky meshes |
| RGB textures · preview | Toggle decoded color maps; unsupported materials retain flat shading |

Keyboard camera controls apply to the focused viewport, not coordinate or text fields. Fly input clears on focus loss. The visual grid is anchored at the world origin on Y=0. Its extent and power-of-two spacing are derived from the loaded source bounds and snap step, never camera distance or pivot; panning, zooming and actor edits cannot move it. It is an editor reference, not the game's ground/collision. Sky meshes are hidden by default because their exterior surfaces can obscure the useful map view. **Frame map** uses non-sky geometry bounds when available; some stored actor records may lie outside those bounds, and **F** frames them individually.

Logic boxes are 1×1×1 world units; other placeholders are likewise fixed-size
symbols. They become naturally smaller on screen with distance, without a
minimum-pixel-size inflation. The Object tab and capture `placeholders` report
state the fallback reason and heuristic classification. Existing original
models are not replaced. The local arena has 74 modeled actors and 129 fallback
records: 94 without a serialized model, 33 unsupported animated/state-driven
models, and two unresolved transforms. Not all serialized records are visible
gameplay objects. New animated-model decoding is still required.

**Lighting** offers neutral, warm and cool presets plus direction, key color,
intensity, ambient level, exposure and two-sided shading. This is a manual
editor light, not automatically applied native level lighting. Unlit, checker
and missing-texture diagnostics bypass it. See [GPU_RENDERER.md](../docs/GPU_RENDERER.md)
for repeatable CLI/MCP lighting and remaining rendering limits.

Desktop rendering uses cached OpenGL mesh/texture buffers, GPU depth and picking attachments, basic lighting, and a Y-up perspective camera. CPU proxies/overlays remain, and an explicit CPU fallback works offscreen. See [GPU renderer and captures](../docs/GPU_RENDERER.md) for `--renderer gpu`, device provenance and benchmark controls. Eligible color-map textures are a read-only RGB preview, not a reconstruction of the game's full shader or lighting. Runtime animation and streaming are not reproduced. An actor model is movable only when the backend provides a verified actor linkage; all linked mesh parts move with that actor's staged translation. Model availability is deliberately narrower than the ability to display an actor proxy.

## Read-only texture preview

The editor follows the native resource chain from `Drawable` to
`tfbRuntimeMaterial._instanceAttrs`, cached attribute lists,
`igTextureBindAttr2._texture`, `igTextureAttr2._image`, and `igImage2._data`.
For verified Outdoor/Character shader families, reflected diffuse sampler units
select the image; other families conservatively require a single named color
map. Multiple unresolved diffuse candidates remain flat: choosing the first
would hide an unresolved layer/blend decision. Normals, composite
maps, cubemaps, alpha blending/testing, animated UV transforms, and shader
parameters are not reconstructed. The decoded alpha bytes are preserved in
the preview payload but the viewport displays RGB only.

The bounded decoder handles PS4-tiled `dxt1_tile_ps4` (BC1) and
`dxt5_tile_ps4` (BC3) 2D images, native HALF2 UV0 coordinates, and proven
clamp/repeat wrap values. BC block decoding follows the
[Microsoft block-compression specification](https://learn.microsoft.com/en-us/windows/win32/direct3d10/d3d10-graphics-programming-guide-resources-block-compression).
Native layout/evidence identifiers are retained in `tools/igz_texture.mjs`;
`research/texture_review.mjs` independently reports the ELF field tables,
format hashes, resource links, and UV ranges without exporting pixels.

The GUI uses a stored mip no larger than **256 pixels** in either dimension.
This is an explicitly reduced-resolution preview, not a game-file conversion.
Textures are deduplicated, carry source dimensions/mip and RGBA hashes, and
share an **8 MiB decoded-pixel budget** per scene. The decoder retries smaller
target mips to improve coverage; an image whose smallest stored mip is larger
may retain it within the requested size cap and remaining byte budget. Missing/unsupported resources
or exhausted budgets retain the existing mesh with a stated fallback reason.
UV interpolation is perspective-correct, including near-plane clipping; model
picking and pending actor translations use the same geometry/depth buffer.

For the local reference arena, the current eligible subset comprises 70 images
and 164 of 184 displayed mesh instances, using 3,835,328 decoded RGBA bytes.
The other 20 instances have unresolved diffuse-layer composition. These are
file-preview counts, not a claim that the game itself has only 70 textures or
184 visible meshes. See [TEXTURE_PREVIEW.md](../docs/TEXTURE_PREVIEW.md) for provenance.

Run decoder tests without distributing game files:

```sh
node --test tests/igz_texture.test.mjs
```

Synthetic tests always run. Optional source-hash/linkage checks run only when
the locally extracted reference assets are available.

The GUI pins the source SHA-256 when opening a file and sends it with subsequent reads and builds. If the source changes externally, reopen it before editing. This prevents object IDs and edits from silently applying to a different file revision.

The interface remains responsive while the backend works. An operation has a ten-minute timeout. Errors and backend diagnostics appear in the log pane. Opening a large level can require substantial RAM because the backend reads its IGZ object graph.

The default backend location is compiled from the source checkout. If you move the application or install its binary elsewhere, pass explicit paths:

```sh
skylanders-level-editor --node /usr/bin/node --backend /absolute/path/to/tools/level_builder.mjs
```

## Read-only actor collision preview

The editor also runs the sibling `tools/collision_builder.mjs` **inspect**
operation, pinned to the opened level's SHA-256. No collision build operation is
invoked by this GUI or its MCP server. A missing or failed collision backend
is reported in the log without preventing ordinary placement inspection.

Enable **Collision boxes · x-ray preview (read-only)** for nominal wire boxes.
Magenta marks eligible actors; the selected actor's box is yellow. The overlay
draws through visible geometry deliberately and does not change model picking.
It follows pending actor-position edits and undo, without changing dimensions
or offsets. Select an actor in the table/viewport to see width, height, length,
local offset, actor position, yaw, and structural eligibility/rejection reasons
in **Actor collision · read-only**. Hover to see the full rejection list.

Dimensions are already converted from stored feet to **world meters**. Offsets
are already world units. The nominal box is centered on local X/Z and extends
upward from Y=0, not equally above/below the actor. Its local offset is added
before the native-verified Y rotation and actor translation. The factory's
rounded bevel/minimum core shape is not drawn.

Coverage is deliberately partial: only the backend's eligible, privately owned,
default-scale, root actor BOX records with supported rotations are shown.
Static terrain Havok, other shapes, unsupported transforms, and runtime script
changes are **not** represented. A hidden/rejected box does not mean no collision;
a visible box does not prove gameplay safety or player grounding. The reference
arena currently has three eligible records, including a controller actor that
should not be repurposed. Read [the collision evidence and limitations](../docs/COLLISION_AUTHORING.md)
before interpreting or authoring collisions separately.

## Virtual portal and saved-profile checkpoints

Choose **Virtual portal…** to control an emulator session separately from the map editor. Read [the portal prerequisites](../docs/PORTAL.md) first: use the supported shadPS4 build and a prepared disposable game tree, not your original package. The dialog finds `tools/portal_controller.mjs` beside the configured `level_builder.mjs` and uses the same Node executable.

1. Select the shadPS4 executable, prepared game's `eboot.bin`/`eboot.elf`, and a **new** session directory whose parent already exists. The controller creates an isolated emulator profile. Optional **Resume checkpoint** selects a previous saved-profile checkpoint directory; leave it empty for a fresh profile.
2. Choose **Start session** and wait for the USB backend to initialize. This is controller readiness, not game recognition. Existing emulator processes are not attached to or modified.
3. Select one of the 16 slots. Create a synthetic blank figure with a numeric ID/variant, or choose your own local 1024-byte figure file. **Insert**, **Swap**, and **Remove** send portal commands. Inputs are copied into session-private files before the game can write them. Slot labels intentionally say “not acknowledged”; confirm the character model/HUD in the running game.
4. To preserve saved progress and managed figure data, choose a persistent parent directory for a **new** checkpoint and press **Stop & save checkpoint**. This stops the dialog's emulator before copying and records a hash-checked inventory. The resulting directory is placed in **Resume checkpoint** automatically. Choose **New session**, review a fresh session path, then **Start session** to restore the profile and reinsert recorded figures after backend initialization.
5. **Stop owned emulator**, closing the portal dialog, or closing the editor stops only that dialog's owned emulator/controller. **New session** restarts the controller after the previous emulator has stopped; it does not delete previous sessions or checkpoints.

The **Owned game controls** panel is enabled only when the running emulator
advertises the capabilities from [the input-IPC fork](../docs/INPUT_IPC.md).
The official binary still supports figure and checkpoint operations, but its
gamepad and capture controls stay disabled. The dialog does not inject desktop
keys, focus a host window, or attach to another process.

- Each gamepad click sends **one bounded pulse**, default 100 ms, adjustable from
  10 to 2000 ms. Face buttons, D-pad, left-stick movement, shoulders/triggers,
  Options, and Share are available. Holding the mouse does not repeat pulses.
- The dialog waits for both press and release acknowledgments, then explicitly
  labels the game response as unconfirmed. **Capture after input** is on by
  default and requests one fresh frame after a successful pulse; it is not a
  continuous video feed or an automatic play loop.
- **Capture fresh frame** requests the game's native PNG. Capture timeout is
  1–30 seconds, default 10. The preview verifies the owned-session path, size,
  dimensions, and SHA-256 before decoding. The original PNG is not modified;
  its path remains selectable for copying. The preview is labeled **not live**.
- Any new input/capture, capture failure, or stopped session clears the previous
  image. A timed-out capture disables further capture for that session, avoiding
  confusion with a late image. Start a new session to recover. A missing input
  release disables further pulses; periodic status checks display a late release
  explicitly and re-enable controls when the controller confirms it.
- A malformed acknowledgment or failed preview verification locks the relevant
  controls until a new session. Backend error codes and details appear in the
  feedback/log. A controller watchdog timeout stops that owned controller so it
  can shut down its emulator; it never presents an older screenshot as success.

Do not request native captures concurrently from another input source: upstream
PNG filenames do not embed IPC request IDs. For fast testing, use a short pulse,
inspect the resulting frame, and choose the next action from what is visible.

A checkpoint is **not an emulator RAM savestate**: resume boots the game and uses whatever progress the game actually saved. Exact mid-frame positions, uncommitted progress, and automatic intro skipping are not promised by this GUI. Choose a non-temporary checkpoint destination if you want to keep it across system cleanup. Session logs and private writable figures remain in the session directory; nothing is overwritten or deleted by the dialog.

The portal runs through its own persistent controller and separate MCP interface described in [PORTAL.md](../docs/PORTAL.md). The C++ `--mcp` server below exposes level-file operations only; it does not drive an open portal dialog or share its emulator session.

### Detached native camera window

**Play** launches the current supported map into the main window's **Live**
viewport using a saved profile. Editor/Live can be tabbed or side by side;
portal controls and settings are side panels, not automatic popups. The live
pane hosts the owned SDL/Vulkan X11 window directly. Its explicit PNG fallback
is still snapshots, with at least one second after each completed capture.
See [one-click setup and workspace controls](../docs/GAME_PREVIEW.md).

After a map loads, **Free camera** enables the experimental exact-build
camera until disabled. Click the viewport, then use **WASD**, **Q/E** down/up, and **right-mouse drag**
to look. The focused view coalesces mouse changes and held keys into one bounded
request at a time; it does not inject keys into the desktop or emulator window.
**Esc** or toggling Free camera off restores normal control. Closing the
view, heartbeat expiry and stopping the owned emulator also restore it. The game
continues simulating while the camera is held.

**Hide HUD** temporarily controls the native sprite pass, including HUD
and potentially menus/prompts. It restores the original flag with the camera.
The camera retains native projection and has no distance tether or collision
avoidance. **Speed** sets 0.1–100 game units per second and is remembered between
sessions. Native coordinate units are not calibrated as metres. Moving the
camera does not force distant regions to load. Only the exact
source-pinned game/emulator pair is accepted. See the [supported local launch
configuration and safety details](../docs/PORTAL.md#native-game-view-and-experimental-free-camera).

Automatic snapshots have a 30-image batch budget. Once the camera is restored
and requests are idle, **New capture batch** explicitly authorizes another batch
without restarting the emulator or deleting earlier PNGs. Reopening the window
alone never resets the budget. Manual captures remain explicit one-shot actions.

The separate portal MCP server provides `portal_camera_enable`,
`portal_camera_move`, `portal_camera_ui`, `portal_camera_disable`, and
`portal_camera_status`. These operate on that server's own child, not an emulator
owned by another editor or process. For repeatable checks, the normal test suite
uses synthetic fixtures; `editor-nativecamera-live` is a separately opt-in test
target and is never launched by CTest.

## MCP integration

The binary can run without a desktop or display server:

```sh
./editor/build/skylanders-level-editor --mcp --backend /absolute/path/to/tools/level_builder.mjs
```

It implements newline-delimited JSON-RPC 2.0 over stdin/stdout, `initialize`, `ping`, `tools/list`, and `tools/call`. Incoming frames are limited to 4 MiB and complete outgoing frames to 64 MiB; an oversized response returns error `-32001`. Diagnostics go to stderr. Requests run sequentially. The GUI and MCP modes are separate processes; MCP tools operate on level files and do not drive an already-open GUI's camera or pending edits.

Register a stdio server in your MCP client's configuration (replace the absolute paths):

```json
{
  "mcpServers": {
    "skylanders-level-editor": {
      "command": "/absolute/path/to/editor/build/skylanders-level-editor",
      "args": ["--mcp", "--backend", "/absolute/path/to/tools/level_builder.mjs"]
    }
  }
}
```

Exposed tools:

| Tool | Arguments | Result |
| --- | --- | --- |
| `inspect_level` | `path` | Hash, version/platform, type counts, editable object count |
| `list_level_objects` | `path`, optional `type`, `query`, `offset`, `limit` (1–500) | Object page, positions where verified, next offset |
| `inspect_level_scene` | `path`, optional `geometryPath`, `includeGeometry`, `includeTextures`, `texturePreviewSize` (32–1024) | Spatial records, mesh metadata/counts, bounds, warnings; geometry and texture arrays only when requested |
| `build_level` | `path`, new `output`, `edits` | New file, manifest, changed-object count |
| `inspect_level_collision` | `path`, optional `actorId` | Read-only actor collision fields, partial eligibility/reasons, source hash, and warnings |
| `inspect_level_materials` | `path`, optional `geometryPath`, filters/pagination | Read-only material bindings, typed shader parameters, UV channels and fallback reasons |
| `render_level_view` | `path`, new `output`, optional `geometryPath`, camera, display/selection options and `lighting` | Actual editor viewport PNG and source-bound renderer/camera/lighting/placeholder report |

All tools additionally accept `expectedSha256` (64 lowercase hexadecimal characters) to reject a source that changed since inspection. Set this when building from a previously inspected object list.

`inspect_level_collision` forwards the hash as the collision backend's
`expectedSourceHash`. Its `editable` field means structurally eligible for the
separate experimental scalar tool, not gameplay-safe and not writable through
this MCP endpoint. No collision mutation tool is exposed.

`inspect_level_scene` defaults `includeGeometry` to `false` so ordinary MCP inspection does not return megabytes of triangle arrays. Pass `true` when a consumer needs the full decoded geometry. Objects expose `worldPosition` and `worldEditable` only as justified by their parent-transform evidence; `position` remains the field used by edit requests. Scene rendering and successful parsing are not runtime validation.

`includeTextures:true` requires `includeGeometry:true`. It adds deduplicated
`textures[]` records (`id`, width/height, `rgbaBase64`, `rgbaSha256`, original
dimensions, stored mip index) and per-mesh `textureId`, `uvs`, `textureWrapS`,
and `textureWrapT`. `texturePreviewSize` defaults to 256; requesting a higher
value does not increase the shared 8 MiB budget. `textureStatus` and
`textureFallbackReason` explain unsupported meshes. The GUI consumes this same
read-only scene contract. No texture mutation endpoint is exposed.

Example build arguments; obtain the real object ID from `list_level_objects`:

```json
{
  "path": "/my-local-game/level.bld",
  "output": "/my-local-mod/level.edited.bld",
  "edits": [{"objectId": 123, "position": [10.0, 20.0, 30.0]}]
}
```

Build requests edit existing verified position fields only. Both MCP and desktop operations invoke the same backend, so format checks, source provenance, and output no-overwrite rules are shared. Run the application with access to your local files only; it has no authentication or network listener and does not download game assets.

## Distribution

The C++ sources and synthetic tests do not contain game assets. Do not bundle your PKG, extracted level files, original game resources, or built modified game files when sharing this editor. Another person should extract their own local game package, build these tools, and follow the setup guide using their own paths. Share source and edit recipes/manifests subject to their contents, not the copyrighted inputs.
