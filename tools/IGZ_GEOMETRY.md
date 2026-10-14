# Read-only geometry export

```js
import { loadGeometry } from './igz_geometry.mjs';
const scene = loadGeometry('research/arena_mesh_303/level.bld');
// Also accepts an IGZ Buffer or the result of parseIgz(), avoiding a second read.
```

Each `scene.meshes` item contains `id` (Drawable RVTB index), `name`, flat numeric `positions` and `indices` arrays, `worldId`, `geometryId`, `bounds`, `sky`, counts, and precise source offsets. `scene.contentBounds` excludes sky worlds so an editor can frame the playable space. `scene.bounds` includes everything exported. `warnings` explicitly records rejected worlds or drawables. No files are written.

`loadGeometry(input, {maxVertices, maxIndices})` defaults to two million vertices and twelve million indices. Counts, pool spans, exact type sizes, position formats, all triangle indices, and finite coordinates are checked before returning a mesh. Per-drawable failures are recorded as warnings; they do not discard other successfully decoded geometry.

## Confirmed resource path

The tested static scene graph is:

`tfbPhysicsWorld +0x50 → tfbWorldEntityInfo +0x28 → DrawableList → Drawable +0x18 → igGeometryAttr`

The list count is at `+0x0c`, capacity at `+0x10`, memory span at `+0x18`, and pointer-array address at `+0x20`. Each pointer-array slot is independently authenticated by its ROFS relocation.

`igGeometryAttr` references a vertex buffer at `+0x18` and index buffer at `+0x20`. Both buffers store counts at `+0x0c`, RMHN data-handle indices at `+0x20`, and primitive type at `+0x30`. Vertex format is the vertex buffer's `+0x28` reference. Vertex format stride is at `+0x0c`; its element descriptor memory span starts at `+0x10`, with the pointer at `+0x18`.

The data handle is resolved through RMHN into a 16-byte TMHN record: byte length at `+0`, flags at `+4`, encoded pool address at `+8`. This exporter accepts the zero-flags geometry records observed in these files. It does not treat the index format's external reference value as an enum.

Vertex elements occupy 12 bytes: type/stream/mapping/count at bytes 0–3, usage/usageIndex/packing information at 4–7, uint16 byte offset at 8, frequency at 10. The shipped executable's enum registrations establish `FLOAT3=2`, `POSITION=0`, and `TRIANGLES=3`. Position data is therefore selected from its descriptor, not assumed to start at byte zero. Actual arena303 strides are 40/44/48 and position offsets are 4/8/12. Index payload lengths equal `align4(indexCount*2)`; every decoded uint16 index is checked against its corresponding vertex count.

## Validation results

`arena_mesh_303` yields all 77 world Drawables, 78,066 vertices and 89,758 triangles, with zero warnings. The arena world owns 72 Drawables; the sky world owns five; the dedicated collision world has none. All 77 geometry resources have draw offset/count `0/0`, which this exporter represents explicitly as the complete underlying index buffer.

Playable-scene bounds excluding sky:

```
min (-478.04846, -84.07365, -113.68716)
max (-375.61295,  53.15471,   -9.01122)
```

These stored coordinates align with the separately decoded arena303 placements. The scene export is about 5.8 MB of JSON with the placement layer included. Synthetic geometry tests verify descriptor-selected positions, counts, bounds, sky exclusion, out-of-range indices, malformed spans, unsupported topology, resource limits, and input-byte preservation: `node --test tests/igz_geometry.test.mjs`.

## Evidence and remaining limits

Exact PS4 field metadata was recovered from the CUSA00697 executable using REA/Ghidra, rather than importing later-game C# offsets:

- Vertex buffer: `ev_0f769de1fd57633784e3c2fea3a41ba98508b87703938e8a18b2695aef525ead`.
- Index buffer: `ev_696baeed23a3d05cf07bd80bfbdc9745a8d03ad874f6cb832d6d3a675264a9bc`.
- Geometry attribute: `ev_e3f0912c6cef1e14279e15ceb528b41d20947e2cb3b92482ec405d9ce1780dbf`.
- Vertex format: `ev_43a6d5dfff8d8c6e8c05915cb412b494f42aba72ffbd94b35ef732c1d09d9d16`.
- Primitive enum (`TRIANGLES=3`): `ev_2ea9ae925eeb4d1e5c10f63557a98f4f2958005405cc6a8e4422e9b9ae6a7833`.
- Vertex type enum (`FLOAT3=2`): `ev_d3eeca417ba4bce623d2e9ad130e1e02450cb8181238e26b64e33532c081b7f3`.
- Vertex usage enum (`POSITION=0`): `ev_5ea7fd96d2bd137366b9253485ab3f5bb3abcfa906877d1c29ce5335d52a4dbd`.

The v10 [Crash NST Level Editor](https://github.com/kishimisu/Crash-NST-Level-Editor) vertex-element structure was a research lead; the PS4 buffer layout and enums were corroborated independently. Field and enum evidence is static, not a runtime rendering observation.

This exports stored static-world coordinates and triangles, not the game's shaders, textures, skeletal animation, actor mesh transform hierarchy, or Havok collision geometry. Files containing only actor templates are not displayed as if those templates were world geometry. Nonzero draw subsets, non-triangle topology, non-float3 positions, multistream positions, and skinned Drawables are explicitly rejected. The `0/0` draw subset is exported as the complete index buffer; exact runtime fallback semantics still require the corresponding draw-call routine. Rendering geometry does not establish that edited geometry or collisions can be saved back into the game.

## Actor models and bounded time-zero hierarchies

```js
import { loadActorGeometry } from './igz_geometry.mjs';
const actorGeometry = loadActorGeometry('research/arena_challenge_303_000/level.bld');
```

This separate API reuses the same bounded buffer decoder, without confusing model-local geometry with static-world coordinates. It returns:

- `meshes`: deduplicated model-local meshes with `modelId`, Drawable `id`, positions, indices, local bounds and source offsets.
- `models`: model `id`, `name`, `bodyId`, `meshIds`, combined local `bounds`, validated read-only `sockets` definitions, and optional `pose` metadata.
- `actors`: actor `id`, `name`, `modelId`, `meshIds`, serialized `position`, `rotationDegrees`, `scale`, `worldMatrix` and `transformStatus`.
- `proxies`: actor IDs and explicit reasons that a model or world-space transform cannot be displayed.
- `counts`, per-model `warnings`, `limitations` and REA `evidence`.

`worldMatrix` is a column-major 4×4 matrix **only** when the actor has a serialized null parent, null attachment/attachment-owner fields (`+0xa0/+0xa8`), zero X/Z rotation, and the observed default `[100,100,100]` scale. Pure Y rotation and translation follow the native routine described below. Otherwise it is `null`; consumers must not render those local vertices as world coordinates. Nondefault scale conversion, combined Euler rotations and parent composition are deliberately not guessed. A decoded model can still appear in `actors` and `proxies` when its world transform or model-coordinate space is unsupported. Root transforms describe the serialized initial layout; template activation, attachment by scripts, runtime visibility and subsequent animation are not established by these fields.

The verified actor resource path is:

`tfbActorInfo +0x158 → tfbPhysicsModel +0x28 → tfbPhysicsBody +0x60 → tfbBodyEntityInfo +0x28 → DrawableList`

The supported case requires no model animation set (`+0x38`) or state data (`+0x40`); a null or conservatively validated socket-definition list (`+0x50`, below); no body combiner (`+0x50`) or viseme poses (`+0x58`); an `igGroup`/`igTransform` scene graph root (`body +0x40`) with a null child list (`+0x38`); an empty or bounded supported entity list (`entityInfo +0x30`); no skinned/articulated flags (`entityInfo +0x38`, bits 0/1); and no blend-matrix-index lists (`+0x48`). Each Drawable must have blend-matrix index `0xffff`; its entity index must be `0xffff` or reference a validated entity. Hierarchical models with sockets are still rejected. Model errors reject the whole model rather than presenting a partially decoded prop as complete. Missing models, characters, unsupported hierarchies and invalid references remain proxies.

Native metadata evidence:

- Model fields: `ev_fd966f0a18d34eb508ecf7985aa1d1016fa99c95550855786960835c24b3c0a8`.
- Body fields: `ev_854d7f98c902cffa822629e88d4ca29df3903819bf155037b5430d854426f6c8`.
- Complete scene graph: `ev_e8dbb7b2956b1d99c69b50e37087df7a5570261b7474b9e89009d628cb09396e`.
- Group child list: `ev_536af69bd46d48c716c974d368a75c3a6647070f05cbc08c7b7594448f4ac7a1`.
- Base entity-info lists: `ev_c55c504f47c6f70ad5ddd47574af12c9266ec51b134685efb5b7af0644a1dd26`.
- Body entity-info flags/bounds/blend indices: `ev_971581f92e870e2d41143b6ceaf6e7a4556e848dde455943f034a11957aa45f4`.
- Placement `_scaleVec +0x114`: `ev_6ba0db4facb80181374263871073835ff56dc1c17a248d2f50dc9b02a8dba9fc`.

Actual challenge303 validation: 203 actor objects, 109 model-linked actors, 78 unique referenced models; 60 accepted models, 76 actor links, 91 local meshes, 33,359 vertices and 39,178 triangles. Seventy-four actors have a supported root matrix: socket-only support added 20 actors beyond the previous 53, and time-zero hierarchy support adds `FlagDefense_FlagTip`. The remaining socket-only actor has unsupported X rotation. The remaining 129 actors require proxies, categorized below. The static arena regression still produces 77 meshes, 78,066 vertices and 89,758 triangles.

Garage panel geometry corroborates the default-scale placement: panels 1–3 have local width approximately 7.247 and height 2.341, while adjacent actor Y positions are separated by approximately 2.35 and 2.34. Adding the initial positions produces a continuous stacked door. Collision dimensions are **not** a reliable render scale calibration: GarageDoor_1 stores `[35,35,3]`, while GarageDoor_2 stores `[3,6,3]`, despite their similar rendered panel sizes. No collision mesh conversion is inferred.

The ramp model has unexpectedly broad stored vertex bounds (one buffer reaches approximately X=-458). All of those vertices are actually indexed, and its stored `igAABox` contains matching map-sized values. Its 18-degree actor still receives no world matrix: the known serialized model path `Level_303/models/303_retracting_ledge.mdl` is an explicit unresolved-coordinate-space exclusion, not a universal size/origin heuristic or proof that its coordinates are world-space. The local geometry remains inspectable. Establishing the Y rotation convention does not establish this model's intended placement.

### Native-confirmed root Y rotation

REA/Ghidra `FUN_00494d10`, evidence `ev_2e9d0250f42ec71f1ecbb95187cf0bb0bc0502c6c6a1bee938741f533398b08f`, builds a matrix from the six-float transform. Its pure-Y branch reads yaw from input `+0x10`, multiplies by positive float32 `0.017453292`, and emits flat storage:

```
[cos(y), 0, -sin(y), 0,
 0,      1,  0,      0,
 sin(y), 0,  cos(y), 0,
 px,     py, pz,     1]
```

Bounded assembly inspection confirms the floating argument that the pseudocode loses at the trigonometric thunk call. This also agrees with inverse conversion in `FUN_004958c0`, evidence `ev_8eb83d599d2f81547d093036cd928717f69f36f55af63f0f6f8c2e726d685504`, which reads yaw using `atan2(matrix[8],matrix[10])` and converts to degrees. The preview preserves float32 angle multiplication but does not claim bit-identical PS4 transcendental-library rounding.

The six newly supported actors are `RocketHatch_Dummy` (98°), `Door_Right_large` (270°), and `RocketHatch_1`–`RocketHatch_4` (78°, 98°, 112°, 126°). These add seven mesh instances. Nonzero X/Z rotations, nondefault scale, and parented actors remain excluded even though the native routine has additional branches; those broader paths and scale consumers have not yet been reproduced and validated.

### Socket definitions are not owning-model transforms

`tfbModelInfo +0x50` references a `BoneAttachInfoList` (size `0x28`) using the
same count/capacity/byte-span/pointer-list structure. Every element must resolve
through an ordinary ROFS pointer to `BoneAttachInfo` size `0x60`. Recovered fields
are `_boneName +0x38`, signed `_boneIndex +0x40`, `_exportsVisuals +0x42`,
the six-float `_transform +0x44`, and `_attachmentType +0x5c`. The transform is
position followed by Euler angles; it does **not** start at `+0x48`.

Native model postload `FUN_0046a570` walks this list and resolves bone names into
indices, defaulting to `-1` without a suitable hierarchy. It does not transform
the model's vertex buffers. `FUN_00469ec0` builds a separate socket matrix and
optionally composes a bone matrix. `FUN_00469f40` additionally combines the socket
with its owner's transform. This establishes that a socket definition alone is
not a reason to reject the otherwise flat owning mesh.

The decoder accepts only bone index `-1`, no exported visuals, ordinary attachment
type `0`, resolved/null bone names and finite bounded transforms. Unsupported
records reject the model. Accepted sockets are returned as `definitionOnly`
metadata; no socket matrix is applied to the owning vertices, and no attached
child or runtime skeletal pose is synthesized. Null serialized actor attachment
and owner fields are separately required for world instancing.

Evidence: field metadata `ev_6e530406e478daacf1058676e6d2615b6a95281fbe9987f640f8222be70197ee`;
postload `ev_1a27559762706cb767bf481d6eed5fcb9675483821b4345710ff83abfa1f5461`;
socket matrix `ev_cc95956b4abcdff6b33d49fbe75661b6515d16863b31314f31b31898d0a14962`;
owner composition `ev_f7f08617f838febb109f13536e7fec557d13a082ad122113097590ffe6dcd37b`.
The latter is evidence of separate socket consumption, not a basis for supporting
new scale formulas; its decompiled normalization expressions are not reliable.

This recovers three weapon actors, ten digit actors, two bombs and five of six
`inviso.mdl` actor links: 20 actors and 25 mesh instances. These are their real
stored triangles, but names such as `inviso` and script templates make it
especially important not to equate decoded geometry with runtime visibility.

### What the remaining proxies represent

The 129 remaining challenge303 actor proxies are not 129 missing visible map props:

| Exclusive observed category | Actors | Next missing support |
| --- | ---: | --- |
| Zero serialized model slot, no model-slot external relocation | 94 | Establish script/runtime role before claiming a visible model is missing |
| Animated/state-driven with skinned body flag | 26 | Skeleton, bind pose, blend matrices and animation/state graph |
| Animated/state-driven without skinned body flag | 7 | State/animation graph; includes UI effects and sheep wool |
| Flat socket-only `Enemy_S4_HealingMage_Warp` | 1 | X=-57° initial transform; general Euler branch not implemented |
| Known retracting ramp coordinate ambiguity | 1 | Determine why its stored vertices include map-sized coordinates |

A slot containing zero but marked by RNEX/REXT/RPID/RHND is treated as unresolved,
not falsely as a null reference. No such model-slot external reference is present
among the 94 model-less actors in this file, although the file has external
references elsewhere.

Names among those 94 suggest 41 spawn/path/position markers, six camera records,
three volumes, 34 controller/script/macro/other records and ten enemy wrappers or
dummies. This is a **name-based inference**, not proof of runtime visibility or
that every such record is intentionally invisible. For example, `LeftSpawn(1)`
has no serialized render model to decode, while an enemy wrapper could spawn
another actor through a script. Markers remain meaningful editor objects.

There are zero parented actors and zero nondefault-scale actors in this remaining
set. Two records also have X/Z rotations but are already excluded above:
`303ArenaChallengeScript` has Z=-1° and `Enemy_S4_HealingMage_Warp` has X=-57°.
The latter is now the sole transform-only omission after yaw and socket support.

Actor tests cover shared-model deduplication, local coordinate preservation, column-major translation/Y rotation and handedness, exact world bounds, byte preservation, socket metadata that does not move owning vertices, hierarchy composition and time-zero endpoint behavior, rejection of unsupported sockets/attached actors/animation/skinning, the known ramp exclusion, missing relocations, malformed positions, resource limits, and unsupported root transforms. Run `node --test tests/igz_geometry.test.mjs`.

### Explicit time-zero entity preview

`FlagDefense_FlagTip` now contributes three real Drawables, 941 vertices and
1,540 triangles. This is an explicitly labelled **t=0 preview**, not a bind pose,
live animation or evidence that the template is currently active in the game.
Its scene object has `representation: "decoded actor model (time-zero hierarchy preview)"`;
model/actor/mesh `pose` metadata gives `timeSeconds: 0`, `runtimeAnimation: false`
and the two source object IDs. Mesh source metadata retains entity/transform IDs
and the composed model-local matrix. Moving the actor still changes only its
position field, not animation, vertices or collision.

The native consumer `FUN_004d05c0` reads the cooked `EntityList`, not a guessed
walk of the complete scene graph. Each `Entity` size `0x20` stores its transform
at `+0x10`, parent uint16 at `+0x1c`, and flags at `+0x1e`. Parent `0xffff` uses
the owner; otherwise the entity inherits the earlier indexed entity. A
Drawable's `+0x28` selects the entity matrix. Flag Drawables use indices 1, 2,
and 0: the two children inherit root index 0. The root translation is therefore
applied once, not once from the scene graph and again from the entity list.

The consumer copies `igTransform._m +0x40`; a nonnull `_transformInput3 +0x90`
then **replaces** that matrix with evaluated source output. It does not multiply
source output by the stored `_m`. `FUN_004c45b0` and `FUN_005b38f0` compose
parent × local in the preview's column-major point convention, with float32
products and paired sums. Hierarchies are limited to 1,024 entities; flags,
missing pointers, cycles, forward/out-of-range parent indices, invalid affine
matrices, legacy transform sources and unresolved Drawable indices are rejected.

`igTransformSource3` size `0x70` fields are stride `+0x0c`, data memory reference
`+0x10`, times memory reference `+0x28`, duration `+0x40`, keyframe time offset
`+0x44`, component-channel bits `+0x48`, three channel offsets `+0x4c`, three
interpolation modes `+0x4f`, play mode `+0x54`, and center of rotation `+0x60`.
The admitted subset is stride 12, channels 11, offsets `[4,0,7]`, interpolation
`[1,3,1]`, offset zero and play mode zero. Counts and memory spans/flags must
match; 2–4,096 times must be strictly increasing from zero and fit the duration.
At t=0, `FUN_005f0de0` selects frames 0/1 and alpha zero. Translation and scale
use the first vector, while quaternion mode 3 requires special care.

`FUN_005bf060` is not exact standard SLERP. Its polynomial branch retains
nonzero constant terms at alpha zero; both flag sources take that branch because
their next quaternion is approximately a 180-degree Y rotation. The endpoint
helper reproduces the alpha-zero reduction with the executable's exact float32
coefficients and arithmetic order. The resulting quaternions are approximately
`[0, ∓0.00136594754, 0, 0.99863404036]`, not identity. Native `FUN_005f1080`
converts them to matrices; `FUN_005f1390` applies center compensation, translation,
then column scaling. No additional quaternion normalization is invented.

Evidence: source metadata `ev_5d3398b340f63a8285e240be3c8a3cfa6a67d5433e17adcc04af765096b0d26b`;
time selector `ev_0890ef432f79747abba5de2dbe05249b2e3568d99f308c94d7373fc35214b9be`;
source evaluator `ev_62f827cc775eeffb31fc6d09a6d260340c64da5be3974457ff801d9fdd4747ce`;
quaternion interpolation `ev_ea627189289b9dbd1468aeda019aca81e53610383cd34ab2f7e4bf02a91f3b5b`;
quaternion matrix `ev_ef129432184d850afe1e097d68e3793fae53b6b055bbbbd13fa8f6bc33320a1a`;
entity consumer `ev_9da2f9ee04bd100e4fca979c53248235fa65ace6e32709b7d0e5641341d6b736`;
parent composition `ev_5310330f39555896aa8273ccc79cf557f7a7ebd21e7eb2787e6298b9a89fd83c`;
matrix multiplication `ev_2174a21c7aa92371b1d3ca311b8baa73f764c26f7ba51964068c56967cd70d2c`.
These are static native-code observations and synthetic/local-asset validation,
not a runtime visual comparison. Other times, channel layouts, animation/state
graphs, skeletal poses and actual runtime template activation remain unsupported.

## Scene/backend integration

`level_builder.mjs`'s `scene` operation decodes models from the placement source, independently of the optional static `geometryPath`. Only actors with a verified world matrix **and** a matching editable root placement receive mesh instances in `scene.meshes`. Their positions and bounds are world-transformed exactly once. Each instance carries `actorId`, `actorBasePosition`, `selectionKey: "actor:<actorId>:mesh:<drawableId>"` and `editable: true`. Editing such an instance changes its associated actor position, not its vertex buffers. The raw Drawable ID is not globally unique; use the selection key.

Supported flat objects receive `representation: "decoded simple actor model"`, `modelId`, and `meshSelectionKeys`; hierarchy previews use the explicit representation above. Other objects remain `representation: "placement marker (proxy)"` with a `proxyReason`. `actorGeometryCounts` separates decoded unique models/meshes from rendered actor instances, while `actorGeometryProxies` preserves the rejection reasons. `geometryCounts`, `bounds`, and `contentBounds` remain the static-world values, preventing distant template props from changing arena framing. `includeGeometry: false` omits all instance position/index arrays while retaining links and world bounds.

The challenge303 plus arena303 scene contains 184 meshes: 77 unchanged static meshes and 107 prop instances for 74 actors (35,671 instanced vertices, 44,413 instanced triangles). Its full JSON payload is approximately 8.44 MB. Unsupported transform/model cases are not exposed as scene mesh instances. The instancer independently reconstructs the supported actor matrix, checks the root placement's angles/position, applies it once to the already model-local/entity-composed vertices and computes bounds from every transformed vertex in both full and metadata-only modes. Rotating just an old bounding box's min/max would be incorrect. Duplicate-model instancing has its own two-million-vertex/twelve-million-index budget, so many actors sharing a model cannot bypass resource limits. Synthetic instancing tests cover per-actor transforms, selection keys, source preservation, metadata-only scenes, rejected roots/matrices, and duplicate-aware budgets. An optional local-asset backend test verifies the complete scene when the extracted arena files exist.

## Reproducible executable metadata

`node tools/elf_metadata.mjs extracted/CUSA00697/eboot.elf` recovers selected Alchemy classes directly from the exact digest-pinned executable. Geometry/model registration table addresses and field counts come from the REA pseudocode evidence above, retained in `research/rea-evidence-2026-10-13.json`. The script resolves PS4 relative RELAs, bounds field-name C strings to their file-backed segment and 256 bytes, and rejects nonprintable/non-ASCII names. Unverified class constructor addresses and inheritance are omitted. The CLI and exported `extractMetadata()` return identical results. `tests/elf_metadata.test.mjs` checks the exact local executable's field names/offsets, including all geometry/model fields currently used by the decoder.

## Collision feasibility: bounded read-only findings

This investigation does **not** implement collision import/export or claim that new collision can be rebuilt yet. The inspected arena IGZ has SHA-256 `7488dc91cbb5e801c2d47f13e84c14df6d0724ecf61a579179fcea386dc97899`.

The dedicated collision `tfbPhysicsWorld` (RVTB index 1317) points from `+0x30` to a Havok packfile at IGZ file offset `0x4cf60e4`, with size `0x4a20` (18,976 bytes) stored at `+0x28`. Its header is packfile version 9, eight-byte pointers, little-endian, content version `hk_2013.1.0-r1`. Three 48-byte section headers describe `__classnames__` at packfile `+208` (320 bytes), empty `__types__`, and `__data__` at `+528` (18,448 bytes including fixups). Local/global/virtual fixups resolve 13/9/10 records respectively; unused table padding is `0xffffffff`.

The object inventory is `hkRootLevelContainer`, `hkMemoryResourceContainer`, `hkpPhysicsData`, `hkpWorldCinfo`, `hkpConstraintCollisionFilter`, `hkpPhysicsSystem`, `hkpRigidBody`, **`tfbTriangleCollisionQuery`**, `hkpMoppCode`, and **`tfbSimpleMeshShape`**. These game-specific shapes, not a generic compressed-mesh class, are the important next native-analysis targets. The ordinary arena and sky worlds each have a separate 1,216-byte Havok container without this mesh inventory.

Within the collision packfile's data section, virtual fixups identify `tfbSimpleMeshShape` at offset 8000. Three local-fixup-backed arrays are structurally consistent with:

| Shape field | Data-section payload offset | Serialized count | Observed interpretation |
| --- | ---: | ---: | --- |
| `+0x60` | 8144 | 1110 | Float32 scalars: 370 xyz vertices |
| `+0x70` | 12592 | 2440 | Uint16 scalars: 610 records of three indices plus an unresolved fourth word |
| `+0x80` | 17472 | 610 | One byte per triangle; observed values 0 and 4 |

Every candidate vertex is finite. Every triangle's first three indices is in range `[0,369]`, and the maximum observed index is 369. Local vertex bounds are approximately `±(36.9002,31.7297,35.9560)`. The fourth uint16 has 122 distinct values and is **not** another vertex index; welding/flags semantics are not yet established. The property bytes must not be discarded or reinterpreted solely from their values.

Executable RELAs resolve a nearby 40-byte-member reflection table at VA `0xf609f0`: `vertexArray` at offset `0x60` (type/subtype 22/11), `indexArray` at `0x70` (22/6), and `tfbProperties` at `0x80` (22/4). This agrees with the observed arrays. Full class-registration association and accessor semantics remain required before promoting the candidate interpretation to a collision exporter. The packfile has no embedded type definitions to supply that missing proof.

`hkpMoppCode` at data-section offset 1712 references 6,219 code bytes at 1776. The rigid body contains repeated translation-like vectors `(-423.2367,32.08146,-63.66283,0)` at offsets `+0x1a0/+0x1b0/+0x1c0`; composing one with local collision vertices appears consistent with arena coordinates, but the authoritative transform field and composition still need native verification. No collision coordinates are exposed as world geometry on this evidence alone.

Public primary-source checks corroborate the container approach but do not supply a validated Trap Team collision rebuilder. Soulstruct's maintained source defines the version-9 header, section tables and fixup records, while its unpacker relies on matching class definitions when types are absent; it is a research lead, not proof of this game's custom-class support. [Packfile structures](https://raw.githubusercontent.com/Grimrukh/soulstruct-havok/main/src/soulstruct/havok/packfile/structs.py), [unpacker](https://raw.githubusercontent.com/Grimrukh/soulstruct-havok/main/src/soulstruct/havok/packfile/unpacker.py). HKXPack documents its target as `hk_2014.1.0-r1` and requires game-derived class metadata, so it is not established as a drop-in 2013/custom-shape converter. [HKXPack README](https://github.com/Dexesttp/hkxpack/blob/main/README.md). Current official Havok documentation describes its SDK and support but does not establish availability or compatibility of a 2013 PS4 collision compiler for these custom shapes. [Havok Physics](https://www.havok.com/havok-physics/).

The bounded next step is to verify the custom class registration/accessors and rigid-body transform, then add a **read-only collision overlay** with index/bounds checks. New topology should remain blocked until there is a proven method to regenerate the MOPP acceleration code, preserve per-face properties/welding data, serialize the exact 2013 object/fixup graph, update the containing IGZ/archive, and validate collision queries in the game. A visible edited render mesh alone is not a newly playable level.
