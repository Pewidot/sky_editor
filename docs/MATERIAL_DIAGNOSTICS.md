# Material and UV diagnosis in the actual C++ editor

These tools inspect your own extracted assets. They do not edit textures, UVs,
material assignments or game files. A diagnostic image override is **not** proof
of the game's shader mapping. Native lighting, material layers, alpha rules and
animation are still incomplete. Do not distribute the input assets, pixel data
or captured game imagery with this source project.

## Start and inspect

Build using [SETUP.md](SETUP.md), then from the repository root:

```sh
./editor/build/skylanders-level-editor research/arena_challenge_303_000/level.bld \
  --geometry-file research/arena_mesh_303/level.bld --renderer gpu
```

For another person's installation use the inner IGZ paths printed by their
own-PKG setup, not the outer compressed .bld archives. The shader metadata below
is specific to CUSA00697 and the executable hash in TEXTURE_PREVIEW.md.

The **Shading** selector above the viewport contains:

- `material`: diffuse RGB preview with adjustable editor light.
- `unlit`: the decoded RGB texture without preview lighting or selection tint.
- `checker`: eight checker cells per raw UV unit, perspective-correct, including
  meshes whose materials failed. Magenta means no supported UV channel.
- `missing`: green = decoded texture; magenta = fallback. This says nothing
  about shader parity or whether the object is actually visible in gameplay.
- `flat`: geometry without texture sampling.

In **Inspector → Display**, disable **World grid and editor overlays** to remove
grid, proxies, labels, gizmos and selection tint.
**Isolate selection** hides other meshes; with no selection it hides all meshes.
**Material inspector…** opens a searchable table with selection keys, material
names, actual coverage and fallback reasons. Select a row for JSON details and
use **Frame selected mesh in viewport**. The inspector is a snapshot of the
currently loaded scene; reopen after changing the scene. Closing it does not
change geometry or pending actor edits.
The **Lighting** tab adjusts the manual preview rig. For repeatable captures,
use `--lighting-json` or MCP `lighting` as described in [GPU_RENDERER.md](GPU_RENDERER.md).
These controls do not reconstruct the game's active lights or shaders.
Framing an actor-linked mesh includes its staged translation. It clears the
previous actor's numeric edit controls, but preserves all pending edits. Select
the actor again to continue moving it.

**Inspect bound images / UV channels…** opens an independent read-only viewport.
Choose an image already bound to the material and a stored UV channel, then
press **Load preview**. The preview requests up to 1024px and retains the camera
between loads, so two channels can be compared without moving the viewpoint.
The mode selector switches immediately between unlit, checker and other views.
This window reads the saved source; it does not include pending position edits
and cannot stage changes. Closing it cancels only its own preview process.

Records retain image IDs/names, source dimensions, cached sampler units,
serialized unit IDs, sampler filters/wrap, repeated material-pass bindings,
UV channel descriptors/ranges and the exact vertex-buffer location. UVs are
decoded independently of texture success. `materialTransformApplied:false`
and `shaderChannelSelectionVerified:false` are deliberate limitations.

`shaderParameters` contains source-typed scalar floats, four-float vectors and
32-bit integer booleans, with object/data offsets, raw enabled/handle fields and
occurrences in cached parameter lists. Separate constant objects stay separate,
even when their names match: different passes can contain different values.
`materialAnimations` exposes target fields, units, transform IDs and UV-track
IDs. These are not direct UV matrices and are not evaluated. Every record says
`appliedToPreview:false` and `activeAtRuntime:"unknown"`. Unsupported or corrupt
diagnostic data is reported explicitly without concealing a valid RGB texture.

## Repeatable captures via CLI

```sh
QT_QPA_PLATFORM=xcb ./editor/build/skylanders-level-editor \
  research/arena_challenge_303_000/level.bld \
  --geometry-file research/arena_mesh_303/level.bld --renderer gpu \
  --mesh-key actor:26538:mesh:25763 --texture-size 1024 \
  --view-mode unlit --no-overlays \
  --render-scene research/new-hatch.png --render-report research/new-hatch.json
```

`--mesh-key` decodes textures only for that one scene mesh and frames its bounds.
Keys are `geometry:DRAWABLE_ID` or `actor:ACTOR_ID:mesh:DRAWABLE_ID`. Their identity
is meaningful together with the report's source and companion SHA-256 values.
For an entire actor use `--frame-object ID --isolate-selection` instead.

`--camera-json` accepts a JSON object with `pivot:[x,y,z]`, `yawRadians`,
`pitchRadians`, and `distance`. Copy these four fields from the previous report
to hold the camera fixed when comparing modes. Distances must be .25..1e6,
pitch -1.55..1.55 radians, bounded yaw and finite coordinates are required.

`--uv-channel 0..7` selects a stored HALF2 TEXCOORD channel for diagnosis. It
does not infer which channel the native shader uses. `--texture-image ID`
requires `--mesh-key` and only accepts an image already bound to that material.
It bypasses the conservative diffuse selector, not format/sampler/UV checks;
the result is labeled `textureDiagnosticOverride:true`. Absent/unsupported
images or channels leave an explicit fallback in the report. No guessed UV
scale/flip is applied and no source bytes are changed.

PNG and optional report paths must be new files with existing parents.
`--expected-sha256` rejects a changed primary source. A companion hash is
recorded but is not currently an input guard. Check it against your reference.

## MCP

Restart an existing editor MCP process after rebuilding so its tool inventory
includes the additions. The stdio command remains:

```sh
./editor/build/skylanders-level-editor --mcp
```

`inspect_level_materials` returns paginated diagnostics, **without vertex, UV
or pixel arrays**. It still parses geometry and decodes bounded texture previews
internally to report actual coverage. It has no persistent scene cache.

```json
{
  "path": "/absolute/path/to/inner-level.bld",
  "geometryPath": "/absolute/path/to/inner-geometry.bld",
  "offset": 0,
  "limit": 50
}
```

Optional `previewMeshKey`, `textureImageId`, `uvChannel`, `texturePreviewSize`
and `expectedSha256` support targeted inspection. The page limit is 1..200.

`render_level_view` runs the same C++ viewport in a separate process and returns
PNG/report paths, content hashes, camera state, material diagnostics and the
active renderer/device. It does not attach to a running GUI or start shadPS4.

```json
{
  "path": "/absolute/path/to/inner-level.bld",
  "geometryPath": "/absolute/path/to/inner-geometry.bld",
  "output": "/absolute/private/new-checker.png",
  "reportPath": "/absolute/private/new-checker.json",
  "renderer": "gpu",
  "meshKey": "actor:26538:mesh:25763",
  "texturePreviewSize": 1024,
  "viewMode": "checker",
  "hideOverlays": true
}
```

`camera` takes the four fields described above. `frameObject` and `meshKey`
are mutually exclusive. `isolateSelection` needs one of them. CPU captures work
offscreen; GPU captures need a working desktop platform/display and fail if
OpenGL is unavailable or a recognized software rasterizer. The MCP server
inherits that environment. Read/write annotations describe creating new
screenshots, not permission to modify game files.

## Findings and corrections (2026-10-13)

The original claim of correctly mapped textures was too broad. Its first arena
capture had 72 textured and 112 flat mesh instances; it was never a validated
game-material reconstruction. Three issues were separated:

1. **False multiple-color rejection.** `ColorMap#default_e` is bound at cached
   unit 5, distinct from primary diffuse at unit 0 in the supported Outdoor and
   Character shaders. Counting image names alone incorrectly rejected simple
   materials. The decoder now excludes that reflected emission slot only for
   these recognized effect handles. Real second-diffuse layers remain unsupported.
2. **Wrong preview filtering.** These inspected samplers use linear
   magnification (1) and linear-mipmap-linear minification (5), not nearest.
   CPU and GPU now use bilinear filtering within the selected stored mip.
   Full mip-chain LOD, anisotropy, parallax and native shader sampling remain out
   of scope; this is not evidence of a globally fixed UV-scale problem.
3. **Budget starvation.** Static textures were decoded first and could consume
   the 8 MiB budget before later actors. If needed, the backend retries with a
   lower scene-wide stored-mip limit rather than arbitrarily leaving late doors
   untextured. `budgetAdjustedMaxDimension` exposes this reduction. Isolating a
   mesh allows high-resolution inspection within the same memory/transport cap.

Native metadata evidence, all in
`research/rea-evidence-2026-10-13-material-diagnostics.json` (353 records):

- `igAttr._cachedUnitID +0x0c`, signed 16-bit metadata; `_cachedAttrIndex +0x0e`.
  Initializer `0xc43cfe`, evidence
  `ev_a7403a20d499fa733910c32faf04d4788784bad252a677c6af5121efd3fc0d17`.
  `_unitID +0x20` in the binding can be -1 and must not replace this cached slot.
- `igTextureSamplerSource._textureUnit +0x18`, `_samplerNumber +0x1c`;
  `0xc37e0a`, evidence
  `ev_bff299531d1940f8c1c618308d378a134aac2d1a4c5f9f826313f6072bf73c14`.
- `igTechniqueSampler._unitID +0x18`; `0xc10736`, evidence
  `ev_0bfba58542200ddb6800f5d2e032d4a7fbd169c0e8c22e694a3684f00ce30a39`.
- Filter enum `0x6b4a80`: table `0xfd7780`, values `0xcc0660`, 12 aliases.
  Evidence `ev_d94f006e171cbef5408d1eb4d8cd794f2397c52fb222c8af56d36ee3e8288d87`.

The local inner `permanent/bootstrap.bld` SHA-256 is
`a56888faa11114d848daf16e74e1d41560a03ff15adbde55249355a23c1534e9`.
Its named sampler records consistently give `UberShaderOutdoor_diffuse` unit 0
(example object 1770), emissive unit 5 (1774), diffuse2 unit 4 (2046); corresponding
Character records are 18359, 18363, 18570. The decoder requires RHND relocation
on the material effect handle and the original EXID name hash `ebea2dbb`, with
namespace hashes `889d65c8`/`af60fb5c` matching those shader-family names.
The existing native loader `0x568430` proves RHND indexes the EXID-derived
handle table, not EXNM. These are static asset/reflection facts, not execution
of a particular material pass or recovery of the full shader program.

Current arena pair (2026-10-14): **164/184** textured instances, 70 images,
3,835,328 RGBA bytes. The global requested 256px target adapts to 128px; one
image retains its smallest stored mip of 256×32 within the original 256px cap
and total memory budget. The isolated 1024px hatch uses one 4 MiB image with no
override. All remaining 20 instances have unresolved multi-layer compositions.

Two further corrections explain the increase from 145 to 164 instances:

- Image names are not reliable material roles. Original materials can bind
  `HeightMap#default_h` as diffuse, or a `ColorMap#` image at non-diffuse unit 2.
  The exact recognized Outdoor/Character profiles now select units 0/4 instead
  of checking the filename. Other shader families retain the conservative name
  heuristic; no universal unit mapping is assumed.
- A smaller scene-wide mip target must not reject an image whose minimum
  original mip is larger than that target but still fits the user's original
  limit and shared byte budget. Actor mesh 13799 uses image 13805's 256×32 mip;
  `minimumMipFallbackImages: 1` reports this case. No synthetic mip or UV rescale
  is created.

Private real-GPU captures made through the new MCP render tool:

- `research/arena-material-review-01.png`: whole map, overlays off, fixed light.
- `research/arena-hatch-material-review-01.png`: isolated original hatch,
  1024px, unlit, automatic selection (no image/UV override).
- `research/arena-hatch-uv-review-01.png`: same hatch/camera with raw-UV checker.
- `research/arena-material-review-03.png`: latest 164-instance whole-map view,
  fixed preview light, overlays off. The earlier -01/-02 captures show the
  previous 145-instance state and are retained as historical comparisons.

Each has a same-basename JSON sidecar. These views were visually inspected;
they do not prove that every model pose, UV channel/scale, layer or lighting
matches gameplay. The first diagnostic sidecars retain the older generic
`camera.lighting` description; their explicit `displayMode:unlit/checker`
identifies the actual unlit mode. New reports also expose `effectiveLighting`.

## Typed material parameters (2026-10-14)

REA was restarted with an empty ledger. The previous 353-record bundle remains
the authority for the earlier work; it was not replaced. New static metadata
evidence is retained separately in
`research/rea-evidence-2026-10-14-shader-parameters.json` (30 records).
The later `research/rea-evidence-2026-10-14-shader-parameters-v2.json` contains
32 records, including the shader platform/type enum initializers.
`tools/elf_metadata.mjs` reproduces the tables from the exact original ELF;
`tools/igz_material.mjs` reads the corresponding local IGZ fields.

| Class / field | Offset | Native initializer | Evidence |
| --- | --- | --- | --- |
| igShaderParametersAttr._dataList | 0x18 | 0xc4b490 | ev_ba72a013f55bef0f3fabd72278ea72e2b7471096a5dd380595e21da93f0f93f3 |
| igShaderConstantData._enabled / _handle | 0x18 / 0x1c | 0xc4a556 | ev_7ed3016613841860453ae4a3c46852c012bb489b7d9f175ad773e5f87161e2f6 |
| igShaderConstantVector._data | 0x20 | 0xc4a7c6 | ev_853eab4c0c5787247598f1da7dee0e5b1ed0aed39a6a2aac4d15d98084b8114b |
| igShaderConstantFloat._data | 0x20 | 0xc4b14a | ev_c8541dad2a8a2c5e29b50061953d26a70fc348b2e67353baf2eb98fa7180255c |
| igShaderConstantBool._data | 0x20 (int32, not float) | 0xc4a9b2 | ev_d3280b53bd8baed769ac9dcca41fb55f104899bd3a3f550637ccc4f75e311abb |
| igCustomMaterialAnimation._transform / _fieldName / _unitID | 0x10 / 0x18 / 0x24 | 0xc0e4dc | ev_5cbf2b3aa351a87ca26bc5d417a137cb44f8373d8097f4398f1da3a9b86a6345 |
| tfbFxMaterialUvAnimationTransform._track | 0x70 | 0xb76e84 | ev_e85eac603c9e6f50dad93fad5d24b34ff8a02da704e5aeda8903b23bf8e20fa3 |

The first three rows above are in the earlier 353-record bundle; the remaining
rows and integer/float/vector meta-type constructors are in the new bundle.
The latter also preserves the signed-short proof for cached sampler units
(`0x58e470` → `0xbf1a20`, igShortMetaField).

Observed arena examples, not recovered shader equations:

- `geometry:133`, material 134: two color images (139 and 148), threshold blend
  inverse about 6.060606, bias about -0.494, and explicit alpha/blend parameters.
  Displaying either image alone does **not** reproduce their native mixture.
- `geometry:351`, material 352: stored parallaxMapping = true and parallaxParams
  `[4, 40, 0.03, 0]`. The fixed RGB preview does not execute parallax mapping.
- UV-animation transform 1354 references track 1355 through +0x70; its containing
  material animation targets `_textureTransform`. No time-dependent UV matrix
  has been inferred from these pointers.

New private captures with explicit effective-lighting reports:

- `research/arena-material-review-02.png`: whole map, fixed preview light.
- `research/arena-hatch-material-review-02.png`: isolated hatch, unlit, 1024px.
- `research/arena-corrugated-primary-01.png` and
  `research/arena-corrugated-secondary-01.png`: identical geometry/camera, raw
  TEXCOORD0, diagnostic bound-image overrides 139 and 148 respectively. These
  are layer-isolation views, **not** a finished combined material.

All have JSON sidecars. These images predate the typed-parameter report addition
but use the corrected rendering and effective-lighting reporting.

## Original shader investigation: second UV channel

The private bootstrap contains 1,635 `igShaderBuffer` objects. REA initializer
`0xc38a40` identifies `_shaderData` at +0x28; its RMHN points to an original shader
payload, not source HLSL. Local LLVM rejected GCN gfx600/gfx700 disassembly;
that failed route was not treated as valid decoding.

A private wrapper (`research/gcn_probe.cpp`, `builds/gcn-probe-01`) instead uses
the existing shadPS4 GCN decoder and format table, without launching the game or
executing shaders. `research/shader_probe.mjs` resolves the native memory handle,
cross-checks the initial `s_mov_b32 vcc_hi` marker against its OrbShdr trailer,
and records input/payload/code hashes. It currently reports only a linear prefix
through the first S_ENDPGM, not a control-flow-complete decompilation. Its source
and output remain experimental/private and are not in the editor source bundle.

Rebuild the existing local probe, with your own shadPS4 source checkout:

```sh
c++ -std=c++23 -O1 -include optional -include fmt/format.h \
  research/gcn_probe.cpp \
  tools/vendor/shadps4/source-input-ipc/src/shader_recompiler/frontend/decode.cpp \
  tools/vendor/shadps4/source-input-ipc/src/shader_recompiler/frontend/format.cpp \
  -Itools/vendor/shadps4/source-input-ipc/src \
  -Itools/vendor/shadps4/source-input-ipc/externals/magic_enum/include \
  $(pkg-config --cflags --libs Qt6Core fmt) -o builds/gcn-probe-01
node research/shader_probe.mjs research/permanent_bootstrap/level.bld 11950 \
  research/new-shader-11950.json
```

The shader decoder source SHA-256 used here is
`2100a0f2211c60cd2c7703ae92455789a85a74bfbb24e42f3acd68ba6fde0e42`.
This is independent static decoding evidence, not a REA GCN execution trace.

Observed Blended Default-technique graph: effect 11506 → technique 11508;
vertex variant list 11514 has entry 1 = attribute 11533 / shader buffer 11545;
pixel list 11911 has entry 1 = attribute 11922 / shader buffer 11950. Other
techniques/variants still need separate analysis and runtime selection proof.

| Buffer / instruction offset | Observation |
| --- | --- |
| VS 11545, 0x18c..0x38c | Two separate texture matrices feed v38/v39 and v40/v41 |
| VS 11545, 0x3b8 | Export parameter 1 contains v38, v39, v40, v41 |
| PS 11950, 0x020..0x03c | Interpolate parameter 1 xy into v5/v6 and zw into v7/v8 |
| PS 11950, 0x014 / 0x018 | Load texture descriptors from word offsets 0 and 32, corresponding to units 0 and 4 |
| PS 11950, 0x054 / 0x05c | Sample primary diffuse using v5/v6 and secondary diffuse using v7/v8 |

Private reports `shader-bootstrap-11545-v1.json` and
`shader-bootstrap-11950-v1.json` decode 1,020 / 2,220 bytes through S_ENDPGM,
respectively (221 / 441 instructions). Full fetch-shader semantic assignment,
runtime texture matrices, pass selection and layered rendering remain open.

For arena mesh `geometry:133`, decoded TEXCOORD0 ranges from
`[-1.2216796875, -4.45703125]` to `[3.9609375, 3.736328125]`. TEXCOORD1 instead
has constant U = 0.625 and V = 0.75..1. A generic tiled UV0 preview of the
second color image therefore differs substantially from its UV1 preview.
`research/arena-corrugated-secondary-uv1-01.png` and its sidecar show that
controlled comparison; they still do not reproduce the final blend. No global
UV rescaling or automatic second-layer shader was enabled based on this sample.

## Color and shader-variant state (2026-10-14)

The inspector's `materialStateAttrs` now reports native `igColorAttr._color`
(float32×4 at +0x20) and vertex/pixel variant-mask attributes (`_baseMask` uint32
at +0x14, `_ignoreMask` uint32 at +0x18). Each record includes original offsets,
per-cached-list occurrences and attribute order. Values remain read-only and
`appliedToPreview:false`, `activeAtRuntime:unknown`; no pass is silently chosen.
Malformed diagnostic data does not discard otherwise valid RGB previews.

The exact-ELF metadata extractor now covers 51 classes. The new native evidence
is in `research/rea-evidence-2026-10-14-material-state-v3.json` (76 records):

| Class | Field initializer | Evidence |
| --- | --- | --- |
| igColorAttr | 0xc4c774 | ev_3c322b1b3f8822dd81e93059c93d766f92371de01e93a33b5f72c6c806fff269 |
| igVertexShaderVariantMaskAttr | 0xc4c2f4 | ev_3b25aa4e4a203034e921a8ecfb0a286ad1154f5be1f1fee219fe9d4924a4611b |
| igPixelShaderVariantMaskAttr | 0xc4a082 | ev_90016cb7f827d2c4b730c9f72287907dda354307aebebdb337993dfa7c6b95c0 |
| igShaderVariant | 0xc39168 | ev_e5d24d42a1b130157f790864d6733aae482c65d130c3dcce032c47c53c252762 |
| igVertexShaderVariantAttr | 0xc4baa2 | ev_cfb4475433772b491b18f7b07c0ab78e20ac746d2a679e6340772a82738f8e85 |
| igPixelShaderVariantAttr | 0xc4bc2e | ev_192e04aa2484943fb1834a648b6c76ca52bac6d5361a5380a118d9e5bef71c4d |

Meta constructors `0x5cbed0 → 0xc09ac4` and `0x58b650 → 0xbf3288` confirm
Vec4f and unsigned-int fields respectively. The private exact-hash-guarded
`research/elf_pointer_probe.mjs` applies the PS4 dynamic RELAs to selected table
addresses. It connects the registered color vtable `0xfeed90` to `0x6d0390`,
which copies the four color values into render-context state. Mask vtables
`0xfeea90` and `0xfedce0` point at wrappers `0x6d0220` and `0x6ce470`; their
retained byte evidence tails into setters `0x659280` and `0x659290` (context
offsets +0xab8/+0xabc and +0xac0/+0xac4). Some wrappers are not defined functions
in the Ghidra database. Ordinary GNU objdump rejects this PS4 ELF; neither
failure was treated as valid pseudocode. Raw REA bytes and resolved targets are
retained instead.

Native variant loaders `0x6cf750` / `0x6cf9c0` resolve named constants and build
shader-handle lists; bind methods `0x6cf980` / `0x6cfbf0` place the resulting
variant object into context +0xa98/+0xaa0. **The consuming selector and the
actual runtime branch remain unresolved.** For example, corrugated material
134 has color attribute 153 with nonwhite RGB and alpha about 0.62, a vertex
mask pair 0/14 and a pixel pair 8/10. Applying one sampled shader's blend formula
without accounting for these states would still be an unverified approximation.

Latest checks: 197 Node tests passed, eight optional private tests skipped;
seven CTests passed including actual OpenGL rendering. Real-arena MCP texture
integration passed with 164 textured instances, 70 images, 3,835,328 RGBA bytes
and a 36,785,799-byte response under the 48 MiB transport budget. These checks
validate the editor/decoders, not in-game material parity or a new custom level.
