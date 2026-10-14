# Level format and editing contract

This describes the **observed CUSA00697 PS4 release**, not every Skylanders game,
platform or update. Original game bytes never ship with these tools. See
[FINDINGS.md](FINDINGS.md) for evidence and unknowns.

## The layers

```text
Your local readable PS4 PKG
  -> extracted game directory (eboot.bin, permanent/, level/, item/, ...)
    -> level/<name>.bld: IGA v0x0b archive
      -> level.bld: IGZ v8 / platform 14 serialized object graph
         - type and string tables
         - typed objects: actors, scripts, rendering resources, physics
         - relocation/fixup tables tying the objects together
    -> level/<name>.arc and other packages: additional dependencies/audio/assets
```

The inner and outer files can both be named `level.bld`, but are different formats.
The editor opens the **inner IGZ**. Renaming an arbitrary IGZ to an outer archive
name does not make it loadable. Source filenames such as `.lvl`, `.ma` and `.ai`
inside TSTR are often provenance/reference strings, not loose editable files.

The arena challenge and arena mesh are separate resources. For example,
`arena_challenge_303_000` has gameplay placements and script graphs; an arena
mesh package holds static scene/physics resources. This does not establish the
complete runtime load graph. Do not mix challenge303 with mesh309 merely because
both parse successfully.

## IGA outer archive

See [ARCHIVE_REPACK.md](ARCHIVE_REPACK.md) for exact header offsets, compression,
no-overwrite member replacement, all-member roundtrip checks and runtime caveats.
`iga_extract.cpp` supports the observed raw and chunked LZMA layouts. The
replacement tool appends a raw member and preserves the original lookup tables.
It does not build a signed PKG or modify the executable.

## IGZ structure

See [IGZ_READER.md](../tools/IGZ_READER.md) for the read-only parser API.

| Item | Observed representation |
| --- | --- |
| Header | Magic `01 5a 47 49`; version at +4, platform at +12, fixup count at +16 |
| Descriptors | Start `0x14`; 16-byte entries: pool-name identifier, file offset, size, alignment |
| Pool names | NUL strings at `0x224 + identifier` |
| TMET / TSTR | Counted NUL strings, next entry aligned to two bytes; empty entries are meaningful |
| MTSZ | uint32 size per TMET type |
| RVTB | Packed object locations; first uint32 at each object is its TMET index |
| RSTT | Locations of fields containing TSTR indices |
| ROFS | Relocation slot locations; bit `0x04000000` denotes a runtime initializer, not a pointer |
| RMHN / TMHN | RMHN locates uint32 TMHN indices; geometry uses validated 16-byte TMHN buffer records |
| ROOT | Version 8 uses raw uint32 root address entries, **not** the packed offset codec |
| Packed offsets | Low nibble first, 3 payload bits/nibble, bit 3 continues; cumulative `value * 4 + 4` |
| Packed addresses | Validated normal addresses: upper five bits choose data descriptor, lower 27 bits are pool-relative |

The pool descriptor index used by a normal packed address is `(value >>> 27) + 1`:
descriptor zero is the fixup area. `0xffffffff` size pools in this release are
specific four-byte zero placeholders with alignment zero, not huge valid pools.

The v8 loader establishes a special ROFS rule: its source-slot pool still comes
from `encoded >>> 27`, but the slot offset uses `encoded & 0x03ffffff`. The removed
bit `0x04000000` identifies a slot zeroed and initialized at runtime. Those slots
are reported in `specialRelocations` and never exposed as normal pointers. For
ordinary ROFS pointers, the stored low uint32 contains the target address with
the normal 27-bit offset. Do not apply the 26-bit ROFS-slot mask to all addresses.

This resolves the previously unexplained locations: Birdcage has 118 special
ROFS slots and 4,152 RMHN references; challenge303 has 172 and 612, respectively,
with no unresolved fixup locations in either tested file. The parser bounds-checks
each RMHN index against TMHN. The geometry decoder additionally interprets the
observed zero-flags TMHN records as byte length at `+0`, flags at `+4`, and encoded
pool address at `+8`. Other payload semantics and the special initializer callees
remain incomplete. Truly invalid ROFS locations are still reported, not invented
as references. Arbitrary object-graph rebuilding is not implemented.

## Read-only geometry and editable actor instances

`tools/igz_geometry.mjs` decodes the verified static resource chain from
`tfbPhysicsWorld` through world entity info, DrawableList and `igGeometryAttr`
to vertex/index buffers. It uses the vertex element descriptor's position offset
and stride, RMHN/TMHN buffer spans, `FLOAT3` positions, triangle topology and
uint16 indices. Every span, count, index and finite coordinate is checked. The
tested mesh303 has 77 static meshes, 78,066 vertices and 89,758 triangles, with
zero rejected Drawables. Five sky meshes are excluded from the default framing.

Simple actor models follow `tfbActorInfo → tfbPhysicsModel → tfbPhysicsBody →
tfbBodyEntityInfo → DrawableList`. Their vertices remain model-local until a
verified actor transform is available. World rendering currently requires a
serialized null parent and attachment fields, Y-only initial rotation and default `[100,100,100]` scale.
The actor matrix follows the native routine's pure-Y branch; skinned,
state-driven and otherwise unsupported models retain explicit proxy reasons.
Combined Euler rotation order, parent composition and nondefault scale
conversion are not guessed. The known retracting-ramp model remains a proxy
because its indexed geometry has an unresolved coordinate-space relationship.
Flat models may have validated type-0, non-visual socket definitions. Native
consumers establish that those transforms belong to attachment sockets, not the
owning vertices; they are exported as metadata only, without attached children.
The flag's cooked entity hierarchy is now sampled explicitly at t=0 using the
native Source3 endpoint polynomial and parent composition. Its three real parts
are labelled as a time-zero preview, not a bind pose or live animation.

For challenge303 with mesh303, the backend exports 77 static meshes plus 107
model-part instances for 74 actors: 184 total. A model may be shared by multiple
actors, so scene selection keys include the actor and Drawable IDs. Moving a
supported model instance changes its linked actor's position field; it does not
rewrite the vertex buffer. All linked parts move together in the viewport.
Other verified world-positioned actors remain selectable box proxies. Actors
with unresolved parent transforms are list-only and editable numerically in
their stored local coordinates, not through a guessed world-space gizmo.

The viewport uses perspective, depth buffering, fixed preview lighting, picking,
camera flight/orbit and XYZ translation handles. Map triangles are read-only.
Bounded original BC1/BC3 RGB textures and supported primitive collision-box
overlays are now implemented. Full materials, game lighting, runtime deformation
and static Havok collision authoring remain unsupported. See
[TEXTURE_PREVIEW.md](TEXTURE_PREVIEW.md) and [IGZ_GEOMETRY.md](../tools/IGZ_GEOMETRY.md) for exact offsets,
native evidence IDs, supported model conditions and decode limits.

## Proven placement fields

REA recovered runtime metadata registration and the field offset tables from the
executable. The IGZ MTSZ values independently agree with these exact class sizes.

| Class | Size | Parent / useful fields |
| --- | --- | --- |
| AbstractPlacement | `0xf0` | AbstractAttachNode; `_initMatrix +0x40`, `_currentMatrix +0x58`, `_parent +0x80` |
| Placement | `0x138` | AbstractPlacement; `_script +0xf8`, `_scaleVec +0x114`, `_collision +0x120` |
| tfbActorInfo | `0x170` | Placement; `_controller +0x150`, `_model +0x158`, `_actorParameters +0x160`, `_wayPoints +0x168` |
| CollisionInfo | `0x80` | MatrixMeasurement; `_transform +0x34`, width/height/length at `0x4c/0x50/0x54`, `_objectOwner +0x60` |

Each transform occupies 24 bytes: three float32 position components followed by
three float32 Euler angles in degrees. The conversion at executable address
`0x4958c0` copies matrix translation into the first three components and converts
the last three from angular calculations to degrees. This supports the order,
not any untested assumptions about parent space, axis conventions or gameplay.

Object names shown in the UI are resolved only when an RSTT entry exists at
object `+0x10`; the tool does not interpret arbitrary bytes as name pointers.
Metadata can include virtual fields at offset zero and bitfields sharing offsets;
do not blindly treat every metadata entry as a writable scalar.

Recover the selected field tables again from your matching ELF:

```bash
node tools/elf_metadata.mjs /absolute/path/to/eboot.elf
```

That script validates the exact executable SHA-256 before using recorded table
addresses. It reads PS4 `DT_SCE_RELA` entries relative to `PT_SCE_DYNLIBDATA` and
applies the relative relocation map for metadata pointers. No ELF modification
or running game is needed.

## Backend interface

`node tools/level_builder.mjs` reads one JSON request from stdin and writes one
JSON result to stdout. Errors are `{ "error": { "message": "..." } }`, exit 1.
No diagnostic chatter is written on stdout.
Requests are capped at 4 MiB while streaming stdin; each source file must be a
regular file no larger than 1 GiB before allocation. Large parsed scenes still
need substantially more RAM than their input bytes.

```json
{"operation":"inspect","path":"/my/inner/level.bld"}
```

```json
{"operation":"objects","path":"/my/inner/level.bld","type":"tfbActorInfo","query":"LeftSpawn","offset":0,"limit":100}
```

```json
{"operation":"scene","path":"/my/inner/level.bld","geometryPath":"/my/inner/geometry.bld","includeGeometry":false}
```

Scene results contain all exported spatial records independent of object-list
pagination. `includeGeometry: false` omits large position/index arrays while
retaining mesh metadata, links, counts, bounds and rejection reasons. The GUI
requests complete arrays; the `inspect_level_scene` MCP tool defaults to metadata.
Scene meshes are a read-only export, not an alternative build-edit format.

```json
{"operation":"build","path":"/my/inner/level.bld","output":"/my/mod/level.bld","expectedSha256":"<hash from inspect>","edits":[{"objectId":14012,"position":[-420,1.75,-33]}]}
```

IDs are zero-based RVTB indices, **not** persistent IDs across other input files.
Use the hash from inspect when building. Never copy example IDs to an unrelated
level. A source-only recipe uses exact type/name selection plus an input hash.

The backend accepts only exact whitelisted class names and MTSZ sizes. It writes
12 bytes at `_initMatrix`, leaving angles, current transform, all references,
collision records and unknown data unchanged. It rejects duplicate IDs, unknown
edit keys, nonfinite/out-of-range coordinates, stale expected hashes, unsupported
formats, existing outputs and malformed structures. Values are stored as float32;
the manifest records both requested and actually encoded values.

Before writing it reparses the result, checks that all bytes outside the requested
fields remain identical, and verifies that the source file did not change during
the build. Outputs and manifests use exclusive creation. The original is never
opened for writing. A successful result means **offline structure/preservation
checks passed**, not that the game accepted or used the new positions.

## What a full new level still requires

A complete authoring pipeline still needs mesh creation/serialization beyond
the supported read-only decoder, static collision creation, object allocation
and identity rules, fixup regeneration,
script/encounter graph editing, dependency resolution, and level selection or
slot replacement. The current editor provides none of those arbitrary-creation
operations. Changing a few transforms does not make a wholly new level.

Some actors are templates, UI objects or script markers rather than live world
objects. Even a structurally correct position change may be overridden by scripts,
place an actor inside walls, or invalidate navigation. Use the staged runtime
checks in [RUNTIME_TESTING.md](RUNTIME_TESTING.md).
