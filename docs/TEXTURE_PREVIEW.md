# Read only texture previews in the level editor

The C++ editor can show decoded color maps on supported static map and actor
meshes. This is a reduced-resolution **RGB preview**, not the game's material
renderer. It does not edit or replace textures, modify an IGZ, or start shadPS4.
Layered/unsupported materials retain flat shading and an explicit reason.

The updated [material/UV diagnosis workflow](MATERIAL_DIAGNOSTICS.md) adds
searchable GUI diagnostics, unlit/checker/missing views, mesh isolation,
repeatable camera captures and two MCP tools. Current arena coverage is 164/184,
not the historical 72/184 below. For the verified Outdoor/Character families,
diffuse selection uses reflected sampler units rather than image names; linear
filtering and stored-mip budget handling are corrected. Full UV/material parity
remains unverified; 20 multi-layer instances are still flat.

## Reproduce from your own game files

Follow [SETUP.md](SETUP.md) to extract your own readable package and build the
tools. The reference profile is Trap Team PS4 CUSA00697 version 01.00, IGZ v8,
platform 14. Keep all extracted assets and screenshots private; none are
required in the distributable source package.

For the reference arena, request both archives during setup:

```sh
node tools/setup_from_pkg.mjs \
  --pkg /absolute/path/to/your-game.pkg \
  --extractor /absolute/path/to/pkg_extractor.AppImage \
  --work /absolute/path/to/new-setup-directory \
  --level level/arena_challenge_303_000.bld \
  --geometry-level level/arena_mesh_303.bld
```

Use the exact paths printed by setup. The editor takes the **inner IGZ
payloads**, not the PKG or the outer IGA archives:

```sh
editor/build/skylanders-level-editor /absolute/path/to/inner-level.bld \
  --geometry /absolute/path/to/inner-geometry.bld
```

**RGB textures · preview** is on by default. Toggle it to compare the same
geometry with flat shading. Actor selection, movement, snapping, and undo still
operate on the original mesh/depth buffers; textures do not change edit scope.

To generate a reusable editor-viewport image without a desktop:

```sh
QT_QPA_PLATFORM=offscreen editor/build/skylanders-level-editor \
  /absolute/path/to/inner-level.bld \
  --geometry /absolute/path/to/inner-geometry.bld \
  --render-scene /absolute/path/to/private/new-view.png
```

The PNG is 1280×800. Its parent must exist and the destination must not exist.
The command prints JSON with source hashes and actor/mesh counts, then exits.
It does not create a game level or alter either input. Omit `--geometry` if
the opened IGZ already contains the relevant map geometry.

## Supported preview subset

- A material must resolve to one distinct diffuse `ColorMap#…` image. Verified
  Outdoor/Character emission-slot5 images are excluded from diffuse candidates. Different
  samplers for the same image are also ambiguous and rejected.
- Images must be single 2D images in the Image pool, with the observed
  `0x30000000` memory-handle flags and supported PS4 format namespace.
  `dxt1_tile_ps4` and `dxt5_tile_ps4` provide BC1 and BC3 colors.
- The source vertex format must expose one unpacked HALF2 TEXCOORD0 in stream
  zero. Native wrap values 0 and 1 mean clamp and repeat, respectively.
- The GUI selects an existing stored mip at or below 256 pixels per dimension,
  reducing the scene-wide limit if required to avoid memory-budget starvation.
  It does not change source pixels or generate replacement mipmaps.
- Decoded textures are deduplicated and share an 8 MiB RGBA budget per scene.
  Bounds, hashes, mip sizes, handle flags, and UV values are checked before use.
  A failed resource leaves its mesh available as flat geometry.

The rasterizer uses perspective-correct UV interpolation and carries UVs
through near-plane clipping. Native within-mip nearest/linear sampling and basic directional shading
make it a practical placement preview, not a lighting match. Alpha bytes are
decoded but the viewport deliberately displays RGB only; game alpha blend/test
rules are not inferred. Normal/composite maps, material layers, cubemaps,
animated UV transforms, shader parameters, and light reconstruction are outside
this subset. BC interpolation follows the
[Microsoft BC1 and BC3 specification](https://learn.microsoft.com/en-us/windows/win32/direct3d10/d3d10-graphics-programming-guide-resources-block-compression).

## Resource and native evidence

The resource chain is:

```text
Drawable → tfbRuntimeMaterial → cached attribute lists
         → igTextureBindAttr2 → igTextureAttr2 → igImage2 → Image pool
```

Field metadata is read from the original executable's relocation-backed native
tables, not inferred from a similarly named object in another game:

| Native class | Relevant verified offsets |
| --- | --- |
| `Drawable` | Material reference `+0x10` |
| `tfbRuntimeMaterial` | `_instanceAttrs +0x40` |
| `igTextureBindAttr2` | `_texture +0x18`, `_unitID +0x20` |
| `igTextureAttr2` | `_wrapS +0x24`, `_wrapT +0x28`, `_image +0x38` |
| `igImage2` | Width/height/depth/levels `+0x40/+0x42/+0x44/+0x46`, image count `+0x48`, format `+0x50`, data handle `+0x60` |

`_unitID` is -1 in the inspected bindings; it is not treated as shader unit
zero. Cached list-of-lists can contain serialized null entries; only an
unrelocated all-zero pointer is skipped. Repeated references across material
passes are deduplicated, while distinct color maps remain ambiguous.

The executable SHA-256 is
`423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3`.
The native format literals hash to the observed EXID names:
`dxt1_tile_ps4 → f8313483`, `dxt5_tile_ps4 → f0b976cf`; namespace hash
`843cd0c2` is required. The name match alone is not a general tiling detector.

Native `0x677410/0x677420` jump to texture conversion callbacks
`0x6c6ab0/0x6c6c70`. The detile route reaches `0xa35e10`; its block-compressed
dimensions are rounded in 4×4 texels. `0xa30a30` checks 8×8 block-tile padding,
`0xa30f20` supplies the Morton interleave for microtile modes 1/2, and
`0xa31a60` supplies row-major tile addressing. The implementation is restricted
to that thin-microtile layout; other native macrotiling and cubemap paths must
not be accepted merely because an image name ends in `_tile_ps4`.

The format-to-mode link is also established in this exact executable.
Initialization at `0xc43010` creates both named PS4 formats, resolves their
base `dxt1`/`dxt5` formats through RELA-backed pairs at `0xfe9e20/0xfe9e60`,
and sets the tiled flag at object `+0x18` bit 0 (`0xc43ad3..0xc43ae2`).
For depth=1, imageCount=1 and these non-depth compressed formats,
`0x6c6810 → 0xa2cb20` selects surface type 7, array mode 2, microtile mode 1,
and tile mode 13. Native table `0xf31070[13] = 0x00400308` corroborates those
mode bits. This closes the single-2D-format mapping to the Morton decoder;
it is not an inference based only on image appearance or matching byte counts.

The initialization function was not modeled by the active decompiler, so its
claim rests on bounded original-ELF disassembly, not an invented REA record:

```sh
llvm-objdump -d --start-address=0xc43010 --stop-address=0xc43330 /path/to/eboot.elf
llvm-objdump -d --start-address=0xc43a5e --stop-address=0xc43b38 /path/to/eboot.elf
```

The complete general mip allocator is not reimplemented. The decoder still
requires the exact sum of padded mip spans, which rejects the observed cubemap
and unexpected payload layouts rather than guessing.

Exact retained evidence identifiers are exported as `TEXTURE_EVIDENCE` in
`tools/igz_texture.mjs`. `tools/elf_metadata.mjs` also exposes the native image,
texture, binding, and material field tables and wrap enum. The local
`research/texture_review.mjs` probe independently checks field tables, format
hashes, resource links, and UV ranges without writing any files.

## MCP scene contract

The C++ MCP tool `inspect_level_scene` accepts these additional arguments:

```json
{
  "path": "/absolute/path/to/inner-level.bld",
  "geometryPath": "/absolute/path/to/inner-geometry.bld",
  "includeGeometry": true,
  "includeTextures": true,
  "texturePreviewSize": 256
}
```

Textures are off by default in MCP; `includeTextures:true` requires
`includeGeometry:true`. `texturePreviewSize` may be 32–1024 and does not increase
the shared 8 MiB limit. A complete outgoing MCP frame is limited to 64 MiB;
oversized responses return `-32001` rather than emitting a partial frame.

`textures[]` contains content IDs, width/height, raw RGBA `rgbaBase64`,
`rgbaSha256`, source dimensions, selected stored mip, and source payload hash.
Eligible meshes have `textureId`, `uvs` with two values per vertex,
`textureWrapS`, and `textureWrapT`. Ineligible meshes have `textureStatus` and
`textureFallbackReason`. `textureCounts` reports decoded bytes and coverage.
There is no texture mutation tool.

## Verification and local reference coverage

```sh
node --test tests/igz_texture.test.mjs
ctest --test-dir editor/build --output-on-failure
node editor/tests/scene_integration.mjs \
  editor/build/skylanders-level-editor tools/level_builder.mjs \
  /absolute/path/to/arena-challenge-inner.bld \
  /absolute/path/to/arena-mesh-inner.bld
```

The six decoder tests cover BC1 interpolation/transparency, both BC3 alpha
branches, HALF2 values, microtile indices, mip selection/partial blocks,
invalid spans, budget enforcement, and resource fallback. Optional local
checks run only if the reference assets are present. Six synthetic CTests
cover the editor/portal workflow, perspective and near-plane UVs, texture
picking/toggling, malformed texture input, PNG creation, no-overwrite behavior,
and MCP limits. No test starts an emulator.

The **historical initial** local arena pair produced 33 preview images, 72 textured mesh instances,
112 flat instances, and 6,899,008 RGBA bytes. The texture-enabled MCP response
was 38,602,912 bytes including its text and structured representations. The
native-window review selected real model triangles, staged all XYZ coordinates,
dragged each gizmo axis, undid changes exactly, and confirmed unchanged input
hashes. Same-camera texture-on/off screenshots differed as expected. These
checks verify file decoding and editor behavior, not gameplay or shader parity.

Reference input SHA-256 values:

| Input | SHA-256 |
| --- | --- |
| Arena challenge 303 inner IGZ | `de0ecd5bc5f5f2b3d99ec81592e8fef97a3228e6777e99f1c169e6cd584e7a32` |
| Arena mesh 303 inner IGZ | `7488dc91cbb5e801c2d47f13e84c14df6d0724ecf61a579179fcea386dc97899` |

Only source code, synthetic tests, documentation, and permitted edit recipes
should be shared. Do not bundle these original inputs, decoded pixel payloads,
screenshots, or the PKG in the source distribution.
