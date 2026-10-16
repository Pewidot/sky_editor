# Static model import

Use **Import GLB…**, choose a static `.glb`, then choose a **new**
`.scene.json` destination. Import adds to an open authored workshop. With an
original/native chapter open it offers a separate workshop instead: insertion
into arbitrary original chapters is not implemented.

Select a model in Objects or the viewport. The Inspector has position,
rotation in degrees and separate X/Y/Z scale factors (`1` = original size).
**Apply transform** stages the change; **Undo transform** restores the object.
Play includes typed fields even before Apply. Build copy saves a new document.
Native chapter actors remain position-only until their transform/model linkage
has been verified; these controls are disabled, not approximated.

Each imported GLB becomes one editable root with a bounding-box collider.
The bottom-center is placed at the origin. A second import becomes a second
root. Enable **Collision boxes** to inspect the box; rotate/scale affects both
the preview and the collision exported by Play. Box collision fills holes and
concavities. It is not triangle collision, convex decomposition, a drivable
vehicle, or an automatic walkable interior. Split architectural pieces into
separate GLBs when a single solid box would block a doorway.

The native workshop builder writes real PS4 geometry, opaque BC1 textures and
`tfbActorInfo` / `CollisionInfo` records into a private Arena303-derived sandbox.
It preserves its 12×12 m floor, sky and lighting and uses the registered
`Level_900_AIWorkshop` slot. An existing prepared game/checkpoint with that
registration is required; importing alone does not install a new chapter.
Click **Play** with the configured on-demand profile. Original game files are
not overwritten. This is the same native route as the Gallardo demonstration.

## Supported GLB subset

glTF 2.0, embedded BIN, static triangle primitives, node hierarchies and matrix
or TRS transforms, float positions, normals (generated if absent), UV0,
embedded PNG/JPEG base-color textures and base-color factors. Units are meters,
Y up. Textures decode through `magick` (ImageMagick), resize to at most 512 px,
and convert to opaque native BC1. Required extensions, Draco/meshopt, sparse
accessors, animations, skins, morphs and external URIs are rejected.
`BLEND` and `MASK` materials are accepted. If their effective alpha is fully
opaque, no transparency approximation is needed. Otherwise the default
`alphaPolicy: "opaque"` preserves geometry and base-color RGB but drops alpha,
records each affected material in `imports[].materialConversions`, and warns
in the editor's Output panel. Glass becomes solid; cutout foliage loses its
transparent edges. This is not native alpha blending or alpha testing.
For strict conversion use `alphaPolicy: "reject"` through MCP/the backend.
No network resources or model scripts are executed.
PBR/normal/emissive maps are not reproduced; import reports that limitation.
Native drawable/material capacity is bounded by the exact donor and checked
before launch. Import does not promise that every GLB fits that capacity.

Specification: [Khronos glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html).

## MCP / command-line backend

The editor MCP tool `import_glb` accepts absolute `path`, new `output`, and
optionally an authored `basePath` plus `expectedSha256`. `build_level` accepts
`rotationDegrees` and `scale` for authored scenes in addition to position.
Native position-only builders reject those unsupported fields.
`import_glb` also accepts the optional `alphaPolicy` described above.

The equivalent backend reads one JSON request on stdin:

```json
{"path":"/work/model.glb","output":"/work/new-workshop.scene.json"}
```

Run it through `node tools/glb_import.mjs`. All paths above are examples.
Sources, imported models and generated native files remain private and are
not included in the source distribution.

## Reverse-engineering basis

CUSA00697 ELF SHA-256 `423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3`:
REA `0x494d10`, evidence
`ev_ebc001ab0d52dbb76785066b186afdead73a22095b49abaceff133c2b786c742`,
supplies the native Euler convention `Ry(y) * Rx(-x) * Rz(z)`.
REA `0x40f280`, evidence
`ev_b7d5d9f423dab55d1556dd65a301a1797a3a0b9595bbac7e5df8427f99bf7e78`,
shows placement percentages applied once to collision dimensions (stored feet)
and local offsets (meters). The builder does not also multiply stored BOX sizes.
Decompilation is static evidence, not gameplay validation. Local retained
snapshot: `research/rea-transform-session-2026-10-16.json`.

Tests: `node --test tests/glb_import.test.mjs tests/authored_scene.test.mjs`.
The opt-in native test uses `SKY_DEMO_INNER` pointing at one's own exact original
Arena303 inner payload. A private imported-cube smoke test reached gameplay
on 2026-10-16; complete arbitrary-model collision behavior is not established
by that single test.
