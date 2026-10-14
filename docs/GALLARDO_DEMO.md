# Gallardo grid demonstration

This is an **editable, hardware-rendered scene preview**, not yet a playable
PS4 chapter. The separate registration/UI/runtime work is recorded in
[WORK_STATUS.md](WORK_STATUS.md). Do not put `.scene.json` into the game archive.

## Reproduce from your own model

Use Node with `node:zlib` Zstd decompression and CRC32 support (tested Node
26.8.2), ImageMagick `magick`, and the built Qt/OpenGL editor. The importer
only reads archive data; it never executes the included Lua/JS/HTML or JBeam
expressions. It supports this ZIP's BeamNG v31 shape and LP_560_4 configuration,
not arbitrary Torque DTS versions or a general vehicle simulation.

From the project directory, choose a new output filename:

```bash
node tools/gallardo_demo.mjs gallardo.zip builds/my-gallardo.scene.json
editor/build/skylanders-level-editor --renderer gpu builds/my-gallardo.scene.json
```

Current local generated example:

```bash
editor/build/skylanders-level-editor --renderer gpu builds/gallardo-grid-demo-02.scene.json
```

Select the car and use the translation handles or position inspector. All its
246 material primitives move together as actor `1`. “Build Copy” writes a new
`.scene.json` plus manifest. Original ZIP, game files and scene are untouched.
The floor is authored static geometry; the ordinary editor grid remains only
a world-anchored overlay. Disable overlays for clean pictures.

The demo has a 12×12 metre flat grid, geometric gradient sky, unlit sun disc,
directional sunlight, ambient fill and the source smooth vertex normals. Source
coordinate conversion is BeamNG `(x,y,z)` → editor `(x,z,-y)`.

## Exact source and limitations

The private ZIP SHA-256 is
`71d28f33448400829784265b5b4fc24aced3bfacd712f49a351a3ee1c6b83b8b`;
the shape is `vehicles/LXRGall/LXRGall.dts`, SHA-256
`18a67907117904a604280021e193ec41544830e5d2f032bb1bb17d9a1b9bb204`.
The format route follows the official
[BeamNG cached-shape specification](https://documentation.beamng.com/modding/file_formats/cdae/).
Archive CRC, member budgets, MessagePack bounds, shape counts and mesh indices
are checked. PNG/JPEG/DDS decoding has explicit format, time, size and memory
limits; other archive code is never loaded.

There are 144 source shape objects. The selected configuration yields 99
available instances, 246 car primitives and 342,761 triangles. It reports three
absent part definitions and 57 referenced mesh instances absent from this
shape (including common mechanical resources and optional/damage elements).
The second generated preview reports six unresolved texture references; those
materials have labelled swatches, not invented source textures.

Ten source nodes carry translations that separate glass/trunk/badges from the
rest assembly. This exact-source demo explicitly removes those node translations
as an **authored assembly correction**, retaining the original matrix and
correction per instance. This is not proof of BeamNG's generic flexbody placement
semantics. No vehicle scripts, deformation, suspension or driving are simulated.

Paint is the selected configuration's color swatch. PBR layering, reflections,
transparent glass blending, shadow casting and native Skylanders light activation
are not reproduced. Missing source assets remain listed in `provenance`.
The car is a decorative model, not a drivable gameplay vehicle.

## Render verification

`builds/gallardo-grid-demo-02.png` and its `.render.json` sidecar record a real
1280×800 OpenGL capture on Radeon RX 7900 XT, not an AI illustration. Thirty
warm redraws measured 6.61–16.19 ms (median 10.20 ms), including readback; scene
loading is excluded. This is a local measurement, not a universal frame-rate
guarantee. The original first capture and all subsequent files use fresh names.

Neither the ZIP nor generated JSON/textures/screenshots belong in the source
release. Others supply their own model and legally obtained game assets.
