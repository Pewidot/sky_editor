# Collision authoring: primitive-surface route

Status: native/static investigation plus a guarded scalar-editing tool,
2026-10-13. Only synthetic fixtures have been built by this investigation;
real game assets were inspected without changes. Player grounding on an
authored platform and a complete new playable map remain unproved.

The best current route is **game-created actor box surfaces**, not manufacturing
an `hkpBoxShape` packfile. The executable constructs Havok boxes, and existing
actors describe solid box surfaces through `CollisionInfo`. The serialized
settings-to-physics-builder connection is now proven; player grounding and
actor-script behavior still require runtime tests. Merely replacing a visible
mesh is insufficient.

## Search boundary and packfile observations

Nine decompressed IGZ files were scanned for Havok magic and structurally parsed:

| IGZ source | Valid embedded packfiles | Physics-containing packfiles |
| --- | ---: | ---: |
| `research/arena_mesh_303/level.bld` | 3 | 3 |
| `research/arena_mesh_309/level.bld` | 2 | 2 |
| `research/arena_challenge_303_000/level.bld` | 331 | 0 |
| `research/sky_systems_levelswitch/level.bld` | 0 | 0 |
| `research/ui_levelselect/level.bld` | 19 | 0 |
| `extracted/CUSA00697/research/level_300_birdcage/level.bld` | 816 | 4 |
| `research/permanent_global/level.bld` | 0 | 0 |
| Original Title's inner `level.bld` | 28 | 1 |
| `rop_globalincludes.bld`'s inner `level.bld` | 541 | 0 |

Total: 1,740 packfiles, 10 with physics classes, no structural parse errors.
No virtual-fixup object in this sample is `hkpBoxShape`, `hkpListShape`, or a
convex shape. This is a bounded negative result, not an inventory of every game
archive. The nonphysics packs are animation/skeleton resources.

All observed physics containers use version 9, layout bytes `08 01 01 01`, and
`hk_2013.1.0-r1`. The `__types__` section is empty: class names and signatures
do not supply full object schemas. Nonempty collision worlds use this graph:

```text
hkRootLevelContainer
  hkpPhysicsData -> hkpWorldCinfo -> hkpConstraintCollisionFilter
                -> hkpPhysicsSystem -> hkpRigidBody
                    -> tfbTriangleCollisionQuery
                        -> hkpMoppCode
                        -> tfbSimpleMeshShape
```

Exact sample locations, all offsets relative to the decompressed IGZ file:

| Source | Havok start | Bytes | Owner |
| --- | --- | ---: | --- |
| arena303 | `0x4cf60e4` | 18,976 | `tfbPhysicsWorld #1317`, pointer slot `0x245c8` (`+0x30`) |
| arena309 | `0x77ea98` | 17,616 | `tfbPhysicsWorld #1`, pointer slot `0x6778` (`+0x30`) |
| Birdcage | `0xf93f924` | 315,744 | Dedicated collision pack; not the adjacent empty worlds |
| Original Title | `0x288e410` | 2,896 | `tfbPhysicsWorld #1`, pointer slot `0x31cec` (`+0x30`) |

Arena303's pack SHA-256 is
`8c11933eb4e6a5f3ea0eeb3d2ef0253be52cb4c7ec05e297f0104e1988d7398c`.
Its containing IGZ SHA-256 is
`7488dc91cbb5e801c2d47f13e84c14df6d0724ecf61a579179fcea386dc97899`.

Title is the smallest graph sample, **not a useful floor template**: its custom
mesh contains three vertices `(0,-300,0.1)`, `(0,-300,0)`, `(0.1,-300,0)` and one
triangle `[1,2,0]`, with a fourth unresolved uint16 word of zero. Its MOPP-backed
shape should not be enlarged while retaining the old acceleration code.

## Exact arena303 fixup graph

The 64-byte header is followed by three 48-byte section headers. Class names
start at pack `+0xd0`, length `0x140`; data starts at pack `+0x210`.
The following offsets are **data-section-relative**, not IGZ or pack offsets.

| Table | Start | End | Nonpadding records |
| --- | --- | --- | ---: |
| Local fixups, `(source, destination)` u32 pairs | `0x46b0` | `0x4720` | 13 |
| Global fixups, `(source, section, destination)` u32 triples | `0x4720` | `0x4790` | 9 |
| Virtual fixups, `(object, class-name section, name offset)` triples | `0x4790` | `0x4810` | 10 |

Table padding is `0xffffffff`. Exports/imports are empty. Recorded local and
global targets remain inside the declared section data; these are structural
checks, not validation of a rebuilt physics world. The record formats agree
with the maintained [Soulstruct packfile structures](https://raw.githubusercontent.com/Grimrukh/soulstruct-havok/main/src/soulstruct/havok/packfile/structs.py).
Its [unpacker](https://raw.githubusercontent.com/Grimrukh/soulstruct-havok/main/src/soulstruct/havok/packfile/unpacker.py)
also distinguishes class definitions from class-name records; it does not
establish support for Trap Team's custom shapes.

Key global relocations are:

| Source slot | Target | Interpretation |
| --- | --- | --- |
| `0xf0` | `0x120` | PhysicsData -> WorldCinfo |
| `0x110` | `0x290` | Systems array element -> PhysicsSystem |
| `0x300` | `0x330` | Rigid-bodies array element -> RigidBody |
| `0x350` | `0x600` | RigidBody `+0x20` -> TriangleCollisionQuery |
| `0x620` | `0x6b0` | Query `+0x20` -> MoppCode |
| `0x658` | `0x1f40` | Query `+0x58` -> SimpleMeshShape |

All six target section indices are 2. The rigid-body object's next virtual
object begins `0x2d0` bytes later, matching the allocation size independently
observed in native constructor `0x4af210`. At rigid-body `+0x170/+0x180/+0x190` are identity basis
vectors. `+0x1a0/+0x1b0/+0x1c0` contain
`(-423.236694,32.081463,-63.662834,0)`; `+0x1d0/+0x1e0` contain `(0,0,0,1)`.
Native owner/member association and all swept-transform update requirements
must be proven before writing these fields. A nearby native reflection member
at VA `0x102a450` names `motion`, class pointer `0x1980790`, offset `0x150`;
this alone does not close the full transform schema.

The container mechanics are understood well enough for a future bounded
serializer experiment. They do **not** establish that arbitrary standard
Havok types are registered in this game's packfile loader, nor that the game
accepts a replacement shape where it expects its custom triangle-query class.

## Proven Alchemy primitive definitions

All native addresses refer to CUSA00697 analysis ELF SHA-256
`423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3`.

`CollisionInfo` is size `0x80`. Registration `0xb81610` and field initializer
`0xb816ea` establish these serialized fields:

| Field | Offset | Representation |
| --- | --- | --- |
| `_properties` | `0x30` | u32 containing shape and flags |
| `_transform` | `0x34` | Six float32 values, translation then Euler degrees |
| `_width`, `_height`, `_length` | `0x4c`, `0x50`, `0x54` | float32 |
| `_shapeType` | bits 0–2 of `_properties` | `NONE=0, BOX=1, CAPSULE=2, SPHERE=3, CYLINDER=4, MESH=5` |
| `_isSolid` | bit 3 | Flag |
| `_interactsWithWorld` | bit 4 | Flag |
| `_isActorSurface` | bit 5 | Flag |
| `_isActorPhysicsObject` | bit 6 | Flag |

Evidence:

- Class registration: `ev_f940724cd95a7b0cf45821952581e11c3050768d580281d79d7954ed275592b2`.
- Field/bit-range initializer: `ev_67886c33d7ae7e4031a12a83856a342d1be15cbbe656073e844138e447b7b3f8`.
- Shape enum getter `0x46b300`, names at `0xf54ef0`, signed values at `0xc7efa0`, six entries:
  `ev_32d7fcf50c20733ab721df586c13180abcb43faebc6b52490fe94d4dcc805607`.
- Post-load method `0x472420` forces bit 6 on when bit 5 is set:
  `ev_70ee990f4dcd0660cd59bb91e4d418f458f8b1932741684dc8687d212211e87c`.

[elf_metadata.mjs](../tools/elf_metadata.mjs) exports the enum under the scoped
label `CollisionInfo._shapeType` (not a claimed original enum type name).
Reproduce its names/values and field offsets with:

```bash
node tools/elf_metadata.mjs extracted/CUSA00697/eboot.elf
node --test tests/elf_metadata.test.mjs
```

All three metadata tests passed, including the exact local ELF and CLI output.
No proprietary executable bytes are included in the tests.

### Native consumers: serialized actor to Havok box

`FUN_00472b60` performs a segment-intersection query, not shape construction.
It obtains CollisionInfo through a virtual getter, converts dimensions to
half-extents using `dimension * 0.3048 * 0.5`, applies placement scale percentages
(`*0.01`), obtains the collision-local transform, and masks shape with `&7`.
For a box, it offsets the query's local Y by half-height, consistent with a
base-relative box extending upward. The builder's returned half-height offset
and wrapper corroborate the box-origin convention. The sphere branch
has a decompiler limitation and is not used as an authoring specification.
Evidence: `ev_0ccfa5fa44452f5bf4081965c674bcf9b1feaa9e6094fbe73a6c81113e10f844`.

Bounded original-ELF assembly reads and retained REA results establish:

- RTTI `11hkpBoxShape` at VA `0xcdfbf0` resolves through RELAs to type-info
  `0x10283f0` and vtable `0x1028350`. This proves a compiled C++ type, not a
  packfile class registration.
- Constructor `0x930fa0` installs that vtable, writes radius at `+0x18`, and
  writes a vec4 of half-extents at `+0x20`.
- `FUN_004b8970` dispatches on an input field `+0xd8`. Its box branch at
  `0x4b89e5` allocates `0x30` bytes and calls the constructor at `0x4b8ab0`.
  For input dimensions at `+0xe0/+0xdc/+0xe4`, it uses
  `max((dimension - 0.1) * 0.5, 0.001)` with radius `0.05`. It returns a
  height-related offset of input `+0xdc * 0.5` through its second argument.
- Direct call sites of `0x4b8970` in the bounded code scan were
  `0x4af328`, `0x4af781`, `0x4b08e3`, `0x4b1cb3`, `0x4b6e27`, `0x4b7033`,
  `0x4b75d6`, and `0x4b8d76`. These are instruction addresses, not inferred
  containing-function entry points.

Retained factory evidence is
`ev_edd62a352d475ada6d619701d0967bc7b1a8afb9651f487b996f4a9cd87a05fc`;
box constructor evidence is
`ev_87aaf07255f683a53578f8cad7305b0bcab8094e93e3af6ea9e7f02be51a86ac`.
`FUN_004af210` obtains the shape, creates a rigid body of size `0x2d0` through
`0x95e150`, and registers it with the world through `0x945170`:
`ev_fa5bd7ee93f12560c8c387dbb67e65b9f99277b0842d95c1dcd0a21d8aec9260`.
The shape/center-height wrapper `0x4b8d50` is retained as
`ev_9153d10c4df7f2563aa60f2a8d469a9193ddc57514f6e96b538aa5b6a834df2e`.

The missing producer is **`FUN_0040f280`**, evidence
`ev_8ebd053ee9b062fa91cf80c4df5c1d9cf04020932ca7c4290f10f0ce447d075f`.
It obtains Placement from runtime actor `+0xa8`, then CollisionInfo from
Placement `+0x120`. Its second argument is the temporary physics configuration.
Unlike serialized CollisionInfo offsets, the following are configuration offsets:

| Configuration field | Native source/conversion |
| --- | --- |
| shape `+0xd8` | `CollisionInfo.properties & 7`; MESH (5) maps to 0 on this path |
| width `+0xe0` | CollisionInfo `+0x4c` × `0.3048` × Placement scale X `+0x114` × `0.01` |
| height `+0xdc` | CollisionInfo `+0x50` × `0.3048` × Placement scale Y `+0x118` × `0.01` |
| length `+0xe4` | CollisionInfo `+0x54` × `0.3048` × Placement scale Z `+0x11c` × `0.01` |
| local translation `+0xa0/+0xa4/+0xa8` | CollisionInfo translation `+0x34/+0x38/+0x3c` × corresponding scale × `0.01`; **no feet conversion** |
| local matrix `+0x70` | CollisionInfo transform through virtual `+0xf0` and matrix helper `0x494d10` |
| placement matrix `+0x10` | Placement current transform `+0x58` through `0x494d10` |

The actual constants read at ELF VA `0xce5500` and `0xce5504` are float32
`0.009999999776482582` and `0.30480000376701355`. At required scale `[100,100,100]`,
dimensions are stored in feet while local offsets are already world meters.
The builder maps solid bit `0x08` to configuration `0x1000`, world-interaction
bit `0x10` to `0x2000`, surface bit `0x20` to `0x800`, and physics bit `0x40` to
`0x20000`. Placement flag `+0x38 & 1` suppresses the first two mappings;
authoring must not assume a disabled actor is a live solid surface.

`FUN_0040f490` calls this producer and sends the
configuration to `0x4612d0` for initial creation or `0x4612a0` for updates.
An explicit nonzero CollisionInfo shape takes precedence over the tested model
fallback on this path. Retained evidence for these functions is
`ev_d3f66719efda60ba9822383564f5b90e7d33b6c2434c2e937d6719036e642328`
and `ev_8c800a2e9c47439ebfeaeb149fe55438f984920c4cb6844fc102b8022334b355`.
Bounded assembly of `FUN_0040ef30` also invokes a virtual actor-parameter
method from Placement `+0x160` before this setup: script/parameter effects still
need runtime validation. The latter observation is assembly-derived; none of
these generated function labels are original source names.

Reproduce bounded assembly with, for example:

```bash
llvm-objdump -d --start-address=0x40f280 --stop-address=0x40f488 extracted/CUSA00697/eboot.elf
llvm-objdump -d --start-address=0x4b8970 --stop-address=0x4b8ab5 extracted/CUSA00697/eboot.elf
```

## Concrete existing actor candidates

Challenge303 IGZ SHA-256:
`de0ecd5bc5f5f2b3d99ec81592e8fef97a3228e6777e99f1c169e6cd584e7a32`.
All offsets below are inside `research/arena_challenge_303_000/level.bld`.

| Actor | Actor offset | CollisionInfo | Collision offset | Stored width/height/length |
| --- | --- | --- | --- | --- |
| `GarageDoor_4 #26175` | `0x2d62e4` | `#26176` | `0x2d6454` | `35,35,3` |
| `LaunchPad_Ramp #26357` | `0x2da2bc` | `#26417` | `0x2db71c` | `34,6,46` |

Both collision records have properties `0x69`: BOX, solid, actor-surface,
actor-physics; interacts-with-world is clear. Each CollisionInfo has exactly
one ordinary incoming pointer, its actor's `+0x120` slot. Their models separately
reference model-level collision records. Native `0x40f490` distinguishes these
from the explicit nonzero actor primitive; runtime scripts can still alter it.

GarageDoor has zero collision-local translation/rotation, initial actor position
`(-416.158112,1.749666,-38.765000)` and zero actor rotation. It has a decodable
static render model, but door scripts may animate or disable it. The ramp has
collision-local translation `(0,-1.524,0)` and actor yaw 18 degrees; its render
model has mixed/baked coordinates and is already excluded from world preview.
It is not the preferred visual-calibration sample.

`_BattleMaster` also has a box surface but is a controller-critical actor and
must not be repurposed. Birdcage has 84 actor instances with BOX+solid set,
including push blocks, gates, transports, and debris; these are supporting
examples, not 84 proven static walkable surfaces.

## Smallest viable prototype and remaining questions

Recommended sequence, **not an implemented or runtime-validated recipe**:

1. The serialized actor `+0x120` to Havok factory trace, dimension conversion and
   height-origin convention are now established. Before a runtime experiment,
   confirm the selected actor's scripts, rigid-body motion type, filter masks,
   and surface registration. Keep default scale and zero angles initially.
2. In a disposable arena/profile, use one existing, independently owned solid
   box record. First prove that changing its position/dimensions changes actual
   player collision and standing height. Inspect scripts before selecting the
   actor; do not sacrifice controllers, spawning logic, or a shared template.
3. Add a visually matching simple cuboid only after its vertex-buffer edit has
   independent bounds/index checks. Verify top-face standing, side blocking,
   jumping off, and reloading. Place the test above untouched baseline terrain
   so a failed collision does not trap the player or masquerade as success.
4. Only after that test, author one floor plus four walls using five independent
   actors/CollisionInfo records. New actor insertion must update and verify the
   IGZ object/fixup/placement graph; copying raw object bytes is not sufficient.
   The intended route lets the game build primitives and does not edit MOPP.
5. Validate spawning, camera, enemy navigation, objectives, restart, and exit
   separately. A walkable cuboid is a collision milestone, not an entire level.

An alternative serializer that replaces the static collision pack with boxes
is not justified yet: there is no observed serialized primitive sample or
confirmed primitive finish-load registration, and custom triangle-query
assumptions remain unknown. Preserve original assets and baseline saves.

## Guarded scalar editor

[collision_builder.mjs](../tools/collision_builder.mjs) accepts one JSON request
on stdin, or exports `runRequest(request)`. It edits only existing CollisionInfo
dimensions and local translation into a **new** IGZ file. It never patches
archives, deploys files, changes saved games, or starts the emulator.

Read-only example:

```json
{
  "operation": "inspect",
  "path": "research/arena_challenge_303_000/level.bld",
  "actorId": 26175
}
```

Omit `actorId` to inspect all `tfbActorInfo` objects. The result includes the
source `sha256`, each actor's `editable`/`reasons`, stored dimensions in feet,
effective dimensions in world meters, local offsets, flags and ownership count.
Here “editable” means structurally eligible, **not** gameplay-safe.

Build request schema (placeholder values, not a selected gameplay experiment):

```text
{
  operation: "build",
  path: <source inner IGZ>,
  expectedSourceHash: <exact lowercase SHA-256 from inspection>,
  output: <new output file>,
  edits: [{
    actorId: <verified root actor>,
    dimensionsWorld: [width, height, length],
    offsetWorld: [localX, localY, localZ]
  }]
}
```

At least one of `dimensionsWorld` or `offsetWorld` is required. Dimensions must
be within `[0.1,1000]` world meters, offsets within `[-1000,1000]`; there are at
most 32 distinct actor edits per request. This is a safety bound, not a claim
that every dimension inside it is suitable for gameplay. The factory's convex
radius and minimum half-extent slightly affect extremely small nominal boxes.

Required guards:

- Exact `tfbActorInfo` size `0x170`, exact referenced `CollisionInfo` size `0x80`.
- Exactly one incoming ordinary pointer to the collision object, from this
  actor's `+0x120`; extra pointers to its interior also reject. Unresolved
  relocations reject the build because private ownership cannot be established.
- Serialized null actor parent and both attachment slots (`+0xa0/+0xa8`), with
  no `RNEX/REXT/RPID/RHND`, ordinary pointer or special-initializer relocation
  at those slots. A zero stored word alone does not establish null. The collision
  pointer slot must also have no conflicting external/initializer relocation.
- Scale exactly `[100,100,100]`; no actor pitch or
  roll, yaw within ±360 degrees; zero collision-local rotation. Placement flag
  bit 0 must be clear because the native builder otherwise suppresses solidity.
- Existing BOX, solid, actor-surface and actor-physics flags. The tool does not
  enable flags. Relocations overlapping either writable scalar span reject.
- Exact input hash, new output and manifest paths, exclusive creation. The
  tool reparses its output, checks every changed byte is inside a requested
  scalar field, and verifies that the source still has the original hash.

The manifest records requested world units, rounded float32 storage values,
effective world units, exact changed spans, hashes, native evidence IDs and
`gameRuntimeTested: false`. Actor position and angles are not part of this API;
moving the actor requires the independently guarded placement tool and a new
source hash for the resulting file. Model vertices do not change, so an edited
collision box can visibly disagree with the original prop until separately
authored render geometry is supplied.

Verification:

```bash
node --test tests/collision_builder.test.mjs
node --test tests/elf_metadata.test.mjs
```

The collision suite passes nine tests, including synthetic builds, unrelated
byte preservation, float32 conversion, rejection of unsupported inputs and
write destinations, CLI errors, and an **inspection-only** exact-hash local
GarageDoor_4 check. No game bytes are embedded in fixtures. Local inspection
finds three structurally eligible arena303 actors: `_BattleMaster`,
`GarageDoor_4`, and `LaunchPad_Ramp`. The first remains explicitly unsuitable
for repurposing; the ramp's visual-coordinate ambiguity remains unresolved.
