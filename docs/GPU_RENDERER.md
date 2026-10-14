# GPU viewport and repeatable reference screenshots

The desktop editor now uses an **OpenGL 3.3 core mesh pass** by default when a
context is available. Vertex/normal/UV buffers and decoded color-map textures
are uploaded once per loaded scene. Object movement updates translation
uniforms rather than reuploading the whole map.

This is hardware-capable rendering, **not yet game-equivalent rendering**.
The shader uses an adjustable diffuse preview light, initially matching the
previous neutral two-sided rig. CPU and GPU renderers share its controls.
It does not silently apply incompletely understood native light records.

[Material/UV diagnostics](MATERIAL_DIAGNOSTICS.md) now provide GUI and MCP
captures with isolated meshes, exact cameras, unlit/checker/missing modes and
native within-mip linear filtering. The latest arena review has 164/184 textured
mesh instances; the initial 72/184 capture below is historical, not current coverage.

## Start the editor

```sh
./editor/build/skylanders-level-editor research/arena_challenge_303_000/level.bld \
  --geometry-file research/arena_mesh_303/level.bld --renderer gpu
```

`--renderer auto` is the default: use OpenGL on the desktop, with an explicit
CPU fallback when unavailable; the offscreen Qt platform defaults to CPU.
`--renderer cpu` forces the reference renderer. `SKYLANDERS_RENDERER` accepts
the same values. The viewport header identifies the active renderer.
`--geometry-file` avoids Qt/X11 interpreting `--geometry` as window placement;
the legacy argument is preserved before Qt parses it.

The build requires Qt Core, Widgets **and OpenGL** development files. On
Debian/Ubuntu, add `libqt6opengl6-dev` to the dependencies in [SETUP.md](SETUP.md).
No Vulkan renderer, graphics driver installation or system reconfiguration is
performed by these tools.

## Layout, world markers and preview lighting

The dockable object list and tabbed inspector surround the viewport. **Lighting**
controls a manual directional light (azimuth/elevation, color and intensity),
ambient brightness, exposure in stops and two-sided shading. Neutral, warm and
cool presets are provided. **View → Reset panel layout** restores the docks.

The grid stays at world Y=0 with origin-aligned major lines and source-bound
extents/spacing. Navigation no longer recenters or resizes it. Trigger/logic
markers remain 1×1×1 boxes; unsupported visible models may use name-based
character/chest/crate/gate silhouettes. These fixed-world-size placeholders
do not inflate with camera distance. Their forms are editor symbols, not proven
game geometry or collision bounds. Captures expose the reasons in `placeholders`.

For repeatable captures, append this to a `--render-scene` command:

```sh
--lighting-json '{"direction":[-0.4,0.8,0.3],"ambient":[0.22,0.22,0.22],"keyColor":[1,0.82,0.63],"intensity":1.1,"exposure":0,"twoSided":true}'
```

The MCP `render_level_view` tool accepts the same object as `lighting`. All six
fields are required: nonzero finite direction (normalized on use), RGB ambient
and key color components 0..4, intensity 0..8, exposure -8..8 and a boolean
`twoSided`. Reports include `previewLighting` and `nativeLightingApplied:false`.
Invalid requests fail before producing a capture. Unlit/checker/missing modes
bypass lighting. Ordinary mesh shading is `(ambient + keyColor * intensity *
diffuse) * 2^exposure`, with diffuse being the positive or absolute normal/light
dot product. Editor markers retain neutral shape shading for legibility.

This does not apply native mood boxes, shadowing, normal maps or fog. Normals
are per-triangle and the RGB preview is not a verified game color-space pipeline.

## Reference capture and measurement

Interactive viewing and PNG capture use the **same SceneView and GPU pass**:

```sh
QT_QPA_PLATFORM=xcb ./editor/build/skylanders-level-editor \
  research/arena_challenge_303_000/level.bld \
  --geometry-file research/arena_mesh_303/level.bld --renderer gpu \
  --render-scene research/arena-reference-new.png \
  --render-report research/arena-reference-new.json \
  --benchmark-frames 20
```

Choose a fresh PNG/report path. Add `--frame-object RVTB_INDEX` to target a
world-positioned actor. A target can still be occluded; successful capture is
not a claim that it is a useful visual reference. Captures are exactly 1280x800
regardless of desktop scaling. The report records source/geometry/PNG hashes,
camera, framed actor, OpenGL device/vendor/version, active fallback, native-light
status and optional warm-frame timings. A GPU capture fails rather than calling
CPU fallback or a recognized software OpenGL renderer hardware acceleration.

Warm timings include mesh drawing, three framebuffer readbacks, the grid,
proxies and overlays. They exclude file parsing, initial uploads and PNG
encoding, and are not a claim of end-to-end UI FPS. Driver, scene and camera
must accompany performance comparisons.

The three GPU outputs are color, integer mesh owner and float inverse depth.
Keeping owner/depth results preserves depth-tested object selection, movement,
proxies and the CPU collision overlay. Readback and those overlays remain CPU
work; persistent buffers, GPU overlays and on-demand picking are future
performance improvements. Texture previews remain bounded RGB color maps;
normals are presently per-triangle, not the original smoothed vertex normals.

## Tests and local evidence

The 2026-10-14 regression suite additionally checks dock layout/live lighting,
CPU/GPU colored-light agreement, invalid-light rejection, camera-invariant grid
placement, fixed-size proxy perspective and heuristic shape classification.

```sh
cmake -S editor -B editor/build -DCMAKE_BUILD_TYPE=Release -DSKYLANDERS_GPU_TESTS=ON
cmake --build editor/build -j4
ctest --test-dir editor/build --output-on-failure
QT_QPA_PLATFORM=xcb SKYLANDERS_RENDERER=gpu \
  ./editor/build/editor-gui-workflow-test node editor/tests/mock_backend.mjs
```

GPU tests need a working display/driver; leave `SKYLANDERS_GPU_TESTS=OFF` on
headless build machines. The existing CPU tests still run without OpenGL.
On 2026-10-13, the local AMD Radeon RX 7900 XT/Mesa 26.2.2 passed GPU perspective
UV sampling, near-plane clipping, texture toggle, picking and the synthetic GUI
selection/movement workflow. The real arena capture
`research/arena-gpu-preview-02.png` visibly contains 184 supported mesh instances
and 33 cached images (72 textured instances). It uses fixed preview lighting.
The earlier `arena-gpu-preview-01.png` was diagnostic and omitted the companion
because of the now-fixed Qt argument collision; do not use it as a map reference.

## Required next steps toward game-like scenes

The user's requirement is hardware-accelerated, scene-specific references that
look close to the game, including the newly recovered lighting. The native
[lighting catalog](LIGHTING_CATALOG.md) is the evidence input for that work.
Before claiming visual parity, establish light/color conventions, inherited
transforms, active mood-box and script state, real normals/material parameters,
shadowing, transparency, fog and postprocessing. Capture matched game/editor
cameras and document each missing effect. A static light record's existence
does not mean the game currently enables it.

The implementation follows Qt's [OpenGL context/surface lifecycle](https://doc.qt.io/qt-6/qoffscreensurface.html)
and [framebuffer requirements](https://doc.qt.io/qt-6/qopenglframebufferobject.html).
