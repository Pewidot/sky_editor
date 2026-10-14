# Reusable chapter modules: dependency boundaries

Status, 2026-10-14: read-only source-bound inspection, not a module importer or
a new playable chapter. The new `tools/module_dependencies.mjs` reports the
resource graph behind explicitly selected objects in one owned IGZ. It neither
edits the source nor loads the emulator. Synthetic tests require no game assets.

## What should count as a module?

A useful future authoring unit is **a placement/resource bundle with an explicit
collision and behavior contract**, not one triangle mesh. This is a design
recommendation based on the observed boundaries below, not an existing game
"prefab" format.

For an actor-based prop, that bundle needs the actor, private owner-dependent
resources, its model hierarchy, drawables, vertex/index/format allocations,
material passes and images, all required string/external/memory tables, and a
verified placement/activation policy. An encounter additionally needs its
script variables, object sets, triggers, spawns, gates and completion behavior.
The graphic alone cannot provide those behaviors.

A static world is a different boundary: render vertices use stored world
coordinates, while collision can live in a **different `tfbPhysicsWorld`** with
an embedded Havok packfile. Selecting a room-shaped drawable does not isolate
the corresponding collision, MOPP acceleration structure, navigation, script
ownership, camera, or lighting state. Moving visible vertices alone therefore
does not create a movable, playable room.

The existing conservative actor clone is a useful first policy, not a generic
transplant algorithm. Its native evidence requires private `CollisionInfo` and
`ActorParameters` copies; the model is shared with a specifically verified
reference-count adjustment. See [ACTOR_CLONE.md](ACTOR_CLONE.md).

## Read-only dependency inspector

```bash
node tools/module_dependencies.mjs \
  --source research/arena_challenge_303_000/level.bld \
  --expect-sha256 de0ecd5bc5f5f2b3d99ec81592e8fef97a3228e6777e99f1c169e6cd584e7a32 \
  --objects 26175
```

The command prints JSON on stdout and writes no files. `--objects` accepts
comma-separated **original RVTB indices from that exact input hash**. Do not
reuse an example index in another chapter or rebuilt artifact. The equivalent
JavaScript interfaces are:

```js
inspectModuleDependencies(buffer, {expectedSha256, objectIds: [26175]});
inspectModuleFile({source, expectedSha256, objectIds: [26175]});
```

The result records:

- Typed objects with original pool, encoded/file offsets, source-byte SHA-256,
  type and an RSTT-backed name when present.
- Ordinary ROFS targets, including object-interior offsets. Cycles and shared
  typed resources are deduplicated, not recursively copied.
- Backing arrays for an explicit allowlist of already supported object-list
  layouts. Relocations in these arrays have their real allocation as source;
  they are not assigned to the nearest preceding object.
- Vertex-element tables and the supported vertex/index/image RMHN → TMHN data
  allocations, with exact extents and SHA-256. These are original full payload
  spans, not the editor's reduced-resolution texture previews.
- RSTT strings, raw EXID/EXNM/TMHN entries, signed external retain flags and
  unresolved handles. File-level TDEP entries are reported without pretending
  to know which selected object uses them.
- Incoming ordinary ROFS references to selected typed objects and explicit
  unresolved traversal frontiers. Inbound aliases into raw allocations and
  cross-file references are **not** enumerated.

`portable`, `runtimeValidated`, and `semanticsComplete` are always false.
`supportedPointerTraversalClosed` only means this finite supported traversal
found no unresolved edge; it is **not** permission to copy objects or a proof
that the graph can be activated in-game. Serialized reference-count fields are
not recomputed from incoming pointer totals: not every field has the same
ownership semantics.

No heuristics infer raw allocation lengths, executable scripts, a collision
schema, or a generic list from a type-name suffix. Unknown targets remain
frontiers. Havok's two-word magic identifies a collision/animation packfile
candidate; it does not establish its complete span, classes or transform rules.

Bounds: 1 GiB source, two million preflight fixup entries, 128 seeds, 4,096
selected objects, 32,768 references/incoming records, 128 MiB declared raw
payloads, 8 MiB reported string content. `--max-objects`, `--max-references`,
and `--max-data-bytes` can lower the traversal limits, not raise the hard caps.
Traversal-budget failures abort instead of emitting a silently truncated
success. Unsupported raw schemas are retained as explicit frontiers. Final
file components must be regular, non-symlink files; sources are opened read-only
and their identity/size/timestamps checked after reading.

## Local sample results

All samples were read without modifying their source files. These counts belong
to the inspector's current, deliberately incomplete schema coverage, not a
universal minimum transplant size.

| Seed | Typed objects | Supported raw spans | Declared raw bytes | Unresolved/remap frontiers |
| --- | ---: | ---: | ---: | ---: |
| Arena303 actor `GarageDoor_4`, #26175 | 92 | 45 | 4,389,252 | 57 |
| Arena303 render world, #1 | 1,532 | 771 | 77,003,080 | 1,028 |
| Arena303 dedicated collision world, #1317 | 6 | 1 | 8 | 2 |
| Tutorial313 `Balloon_Cluster_At_Chest`, #34340 | 59 | 20 | 184,608 | 25 |

### GarageDoor_4

Source SHA-256 is the arena challenge hash used by the command above. The
closure contains three Drawables, seven `igImage2` objects, three sets of
vertex/index/format objects, and records in Default, VertexObject, Vertex and
Image pools. It includes actor-owned collision #26176 and parameters #26222,
plus the model's own collision/parameter records. The 57 frontiers consist of
16 external identity/handle uses, eight pool-ID relocations and 33 untyped
allocations without a supported extent schema.

Those untyped allocations include cached-attribute backing data at `+0x38`,
vertex/index buffer data at `+0x18`, and vertex-format data at `+0x28`.
Existing native metadata names the latter buffer fields `_vertexCountArray` /
`_indexCountArray` and `_platformData`; the dependency inspector intentionally
does not extrapolate a serializer from the names.

There are 2,645 incoming references to this whole typed-resource closure because
many material objects are shared with other parts of the source. **Five** target
the actor itself, agreeing with the separately investigated root/list/script
references in ACTOR_CLONE.md. Neither figure by itself is an ownership count.

### Static render versus collision

Both seeds use `research/arena_mesh_303/level.bld`, SHA-256
`7488dc91cbb5e801c2d47f13e84c14df6d0724ecf61a579179fcea386dc97899`.
Render world #1 is `Levels/Level_303/Level_303_Arena.ma`; it exposes 72
Drawables in its supported closure. Collision world #1317 is
`Levels/Level_303/Level_303_Arena_Collision.ma`; it has a ROFS at object `+0x30`
targeting file `0x4cf60e4`, the previously parsed physics Havok packfile.
That packfile is **not included in the eight counted raw bytes**: it remains an
explicit independent-schema frontier. See [COLLISION_AUTHORING.md](COLLISION_AUTHORING.md)
for its 18,976-byte parsed graph and MOPP/shape limitations.

### A keyword is not gameplay semantics

Tutorial313's source is
`research/chapter-catalog-v2/level_313_tutorial/level.bld`, SHA-256
`ffb0550f8f11d53e0db9aaa32bc977c887a5f5c0b8f1a139555859a4034b6cd3`.
The earlier catalog's first `chest` name candidate, #34340, is actually named
`Balloon_Cluster_At_Chest`. It must not be advertised to an AI as a working
treasure chest merely because its name contains that word.

Its closure does contain `tfbScriptInfo`, `OpCodeList`, and
`OpCreateVariableList`. The latter backing-array layouts are outside this
inspector's allowlist, so their unresolved contents are not mislabeled as a
complete behavior graph. Behavior decoding and validated reusable encounters
must be established separately.

## Transform and ownership boundaries

The supported actor preview applies the native-derived initial transform only
to null-parent, unattached actors with scale `[100,100,100]` and pure Y rotation.
Time-zero entity/source animation previews do not prove that runtime animation
will remain in that pose. General parent/attachment spaces, arbitrary scale and
Euler rotation still need independent policies. The ordinary position builder
only changes the three initial-position floats; it is not a model-baking or
collision-rebuilding tool.

Native actor post-load `0x40cdd0` writes owner pointers into collision and
parameters; native copy `0x40ce10` privately copies them. The ordinary ROFS
loader resolves serialized pointers without the retain used for signed external
references. Consequently a cross-chapter linker must explicitly distinguish
private ownership, sharing, weak/unowned pointers, header counts and external
retain flags rather than treating every outgoing edge identically.

Relevant existing native evidence, for exact CUSA00697 ELF SHA-256
`423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3`:

- IGZ loader: `ev_ec2b575e84cb4f06b1aba8c75f1ce0d82f7db4a2852eab4ef8b43300b51f0e8b`.
- Actor post-load: `ev_a579e926669fa754f26fbe8260703633dae3997f99a4b247e8108a7800dab6a4`.
- Actor copy: `ev_97266d31f260fd9d0bb2547e89b01f2b79df1114c9d86c6ddca256863fbb120b`.
- Vertex buffer metadata: `ev_0f769de1fd57633784e3c2fea3a41ba98508b87703938e8a18b2695aef525ead`.
- Index buffer metadata: `ev_696baeed23a3d05cf07bd80bfbdc9745a8d03ad874f6cb832d6d3a675264a9bc`.
- Vertex format metadata: `ev_43a6d5dfff8d8c6e8c05915cb412b494f42aba72ffbd94b35ef732c1d09d9d16`.
- Placement transform: `ev_2e9d0250f42ec71f1ecbb95187cf0bb0bc0502c6c6a1bee938741f533398b08f`.

These are retained earlier static-code observations. This investigation reuses
them and the format-aware local parsers; it does not claim a new runtime trace.

## Remaining implementation gates for AI chapter composition

1. **Resource linker.** Resolve external identities across selected source
   artifacts, and remap typed objects, strings, pool IDs, raw allocations,
   RMHN/TMHN, EXID/EXNM/RHND, ROFS/interiors and registration roots. Preserve
   metadata identity/checksum semantics if merging types. The current append
   writer cannot add new types, pools, table records or TDEP entries, so it
   cannot yet transplant these cross-chapter modules.
2. **Playable geometry policy.** Associate visible modules with collision and
   a verified common transform. Retain or rebuild compatible Havok/MOPP and
   navigation, or validate a deliberately limited primitive-surface route.
   Existing BOX scalar/clone tools are not arbitrary floor-mesh authoring.
3. **Behavior contract.** Decode and bind actual script variables, object sets,
   activation, trigger events, encounters and completion. A reusable chest or
   gate needs its behavior/resource contract, not a keyword category.
4. **Chapter registration.** Add and load an independent chapter identity,
   package/stream dependencies, chapter-selection entry, progress/checkpoint
   behavior and return path. Replacing an old slot is not the same operation.
5. **Runtime acceptance.** In an isolated game copy, demonstrate selection,
   spawning, ground contact, traversal, enemy interaction, checkpoint reload,
   completion and return. A structurally valid IGZ or an editor screenshot
   cannot substitute for those checks.

A future AI-facing recipe should reference source hashes and approved module
IDs, specify constrained transforms and explicit behavior connections, and
declare its completion conditions. The compiler should reject unsupported
modules and unresolved dependencies. Distribute those recipes and source code;
reconstruct proprietary resources locally from each person's own PKG.

## Tests

```bash
node --test tests/module_dependencies.test.mjs
```

Eight synthetic tests cover closure/list/raw payload provenance, cycles and
interiors, signed external references, initializers, unknown/Havok frontiers,
schema rejection, source hashes, resource bounds, read-only CLI behavior and
symlink refusal. One optional arena test verifies the real three-drawable model
closure, private resources and five external actor references without writes.
