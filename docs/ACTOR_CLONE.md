# One-actor structural clone prototype

`tools/actor_clone.mjs` adds one GarageDoor_4-derived actor to the original
arena303 challenge IGZ. It copies the actor, its private collision description
and its private parameters; it shares the existing visual model with an
explicit reference-count adjustment. This is a source-only, exact-input policy
on top of [the structural append writer](IGZ_APPEND.md), not a general actor
serializer or a complete new-level authoring system.

The tests described here are structural and memory-only. They do not establish
that the new actor is visible, active, walkable, or safely destroyed at runtime.
The tool never repacks archives, installs files, modifies saved games or starts
an emulator. Runtime experiments must be recorded separately.

## Exact input and selected template

Supported input: `research/arena_challenge_303_000/level.bld`, 91,745,564 bytes,
SHA-256:

```text
de0ecd5bc5f5f2b3d99ec81592e8fef97a3228e6777e99f1c169e6cd584e7a32
```

Native evidence refers to the locally supplied CUSA00697 `eboot.elf`, SHA-256:

```text
423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3
```

| Resource | RVTB index | Encoded address | Size | Clone policy |
| --- | ---: | ---: | ---: | --- |
| GarageDoor_4 `tfbActorInfo` | 26175 | `0x287090` | `0x170` | Copy; new name/position; one root owner |
| `CollisionInfo` | 26176 | `0x287200` | `0x80` | Private copy; optional dimensions only |
| `ActorParameters` | 26222 | `0x288618` | `0x58` | Private unchanged copy |
| `tfbPhysicsModel` | 26177 | `0x287280` | `0x70` | Shared; serialized count `1 → 2` |

The original actor has zero angles, scale `[100,100,100]`, serialized activity
`4` (`PLACEMENT_UNMANAGED`), a genuinely null script at `+0xf8`, and genuinely
null parent/attachment fields. Its only ordinary outgoing pointers are
`+0x120` collision, `+0x158` model and `+0x160` parameters. It has one string
fixup at `+0x10`. All relocations inside the three copied objects are checked,
including null-looking external/initializer slots; zero bytes alone are not
accepted as proof that a field is null.

Its collision flags are preserved as `0x69`: BOX, solid, actor surface and actor
physics. The collision transform is zero; dimensions are `[35,35,3]` feet,
approximately `[10.668,10.668,0.9144]` world meters. The owner/contact slots are
serialized null. The parameters likewise have a null serialized owner and no
outgoing fixups. Both resources have exactly one incoming actor pointer and
no interior aliases.

The model is `303_garage_door4.mdl`, with three decoded unskinned drawables.
It is a door, **not a floor mesh**. Changing collision dimensions does not
resize or replace the visual mesh. A larger collision box may therefore be
invisible outside the original door surface; this tool must not label that a
finished authored platform.

The other conservative BOX candidates were `_BattleMaster` (a scripted arena
controller, unsuitable for repurposing) and `LaunchPad_Ramp` (scripted, with
unresolved visual-coordinate ambiguity). GarageDoor_4 was selected because its
existing script is null and its render/ownership graph is bounded, not because
all game actors have the same safe cloning policy.

## Why three objects are copied

Native actor post-load `0x40cdd0` sets `ActorParameters+0x10` and
`CollisionInfo+0x60` to their owning actor. Native copy routine `0x40ce10`
allocates private copies of both resources and rewrites those owners. Sharing
either would allow the second actor's initialization to replace the first
actor's owner pointer. The copied serialized owner fields remain null; the
engine initializes them after loading.

- Post-load evidence:
  `ev_a579e926669fa754f26fbe8260703633dae3997f99a4b247e8108a7800dab6a4`.
- Copy evidence:
  `ev_97266d31f260fd9d0bb2547e89b01f2b79df1114c9d86c6ddca256863fbb120b`.
- Script tick `0x477fd0` checks the null script before execution:
  `ev_2addc8e3584f70ff48a61616569d25775fe47acc2a2822f5e5909f0c1403c529`.

This policy preserves an already-null script. It does not clear arbitrary
scripts or infer that their removal is safe.

## Root registration versus scripted door groups

The original actor has five incoming references, matching its serialized
reference count `5`:

| Source | Entry/role | Original reference file offset |
| --- | --- | ---: |
| ROOT `igObjectList` #0 | Entry 1030 | `0x512b4` |
| `ScriptSetList` #25650 | Main arena typed set, entry 31 | `0x2c6f14` |
| `ScriptSetList` #26059 | GarageDoor_Segments, entry 3 | `0x2d2ed4` |
| `ValueStack` #26276 | Door script operations, entry 0 | `0x2d8b5c` |
| `ScriptSetList` #27079 | GarageDoor, entry 4 | `0x2e9a8c` |

The new actor receives only one new ROOT entry. No original door group,
script stack or typed set receives the clone. The original five references
remain unchanged in meaning. Its new serialized count is therefore `1`.

The ROOT list has 1,459 entries, including a final signed REXT external
reference `0x800000000000014d`. The append writer relocates the array, moves
its relocation entries rather than duplicating them, preserves that external
reference, and appends the clone as entry 1,459. The count becomes 1,460.

Static native evidence connects this root to actual placement registration:

1. `igObjectDirectory` metadata field table `0xbf852c`, names `0xf8a5e0`,
   offsets `0xc823c0`, identifies `_objectList` at `+0x28`. Native writer
   `0x56f6e0` writes ROOT from that directory field
   (`ev_8f1e689ccb70dca6b4dee9abc703e8f62259cc6343ce8643a7e9ed3e376cd5ca`).
2. `0x400b80` walks loaded stream directories through `node+0x128`, reads
   `directory+0x28`, and dispatches `AppendObjectMessage` for each member
   (`ev_ef25bbb58bb2ef767ca62ab22dd793c6415cd77324e0297db037e1ed2559aea1`).
3. Listener `0x4116a0` recognizes Placement and calls state transition
   `0x478240(placement,2)`
   (`ev_82048b225158bb4d240a562f3852b756113fcd44dbcadaa4249e5c092c6d1dcd`).
   Serialized state `4` is preserved in the clone; it is not forcibly changed
   to active state `1`. Bounded assembly at scheduler `0x411ca0` shows later
   activity updates. Registration is not proof of immediate activation.
4. State-change listener `0x40ec20` creates an actor when crossing from a
   state at least `2` to one at most `1`
   (`ev_8eea412f3d507951336fed4b6f787219f3780bd8ca19777b5519e83fafefe6c1`).
5. `0x40edd0` allocates and links the runtime actor, clones the model runtime
   representation via `0x461530`, and reaches actor physics initialization
   through `0x40ef30`
   (`ev_f7fdd2a975abf3dc02f199b4f668d88c8de604d3755a54879da9a6c6f1fd5bc7`).

This supports a root-only prototype. It does not prove every scheduler
condition or imply that arbitrary objects become live merely by appearing in
an inventory. In particular, `ScriptSetList+0x28` is an external type reference,
not an activation enum.

## Explicit shared-model reference count

The shared model has one original incoming owner, the original actor's
`+0x158`, and exact header word `1` at model `+0x08`. The clone introduces a
second owning model field. Retain wrappers at `0x51ca90/0x51cac0` pass object
`+0x08` to atomic increment `0x57e780`
(`ev_0d2008a3fb5e310915be2a7cbbfc3d569ba781c68e2a77f60c1468b31e06da49`).
Release `0x51c280` masks the old count with `0x7ffff` and destroys at count `1`
(`ev_34f9859d2eb1f122807395902ce58ca151e8493495a366c9378bfeda1aeee56f`).

Loader `0x568430` preserves those low count bits when it patches an RVTB
object header. Its ordinary ROFS path resolves pointers without performing a
retain (`ev_ec2b575e84cb4f06b1aba8c75f1ce0d82f7db4a2852eab4ef8b43300b51f0e8b`).
Consequently the newly rebuilt file explicitly changes this model's exact
four-byte word `1 → 2`. The generic append writer itself remains unchanged:
the actor policy makes this additional bounded edit in a fresh output buffer,
then reparses and verifies ownership. It does not modify the input buffer.

No arbitrary count, flag mask, count carry, decrement, or other original
object header is supported. The final manifest separately records the model
edit, the intermediate append hash and the final output hash. The nested
append manifest describes the intermediate output, not the final count-patched
file. This bounded observation is not a claim that every game pointer has
identical ownership semantics.

## API and reproduction

The in-memory interfaces are:

```js
inspectCloneTarget(sourceBuffer, expectedSourceHash)
cloneActor(sourceBuffer, {
  expectedSourceHash,
  name,                 // unique 1–80 printable ASCII characters
  position,             // explicit [x,y,z] world meters
  dimensionsWorld       // optional [width,height,length] world meters
}) // -> {buffer, manifest}; no file writes
```

Names must not have surrounding whitespace and must be absent from TSTR even
under case-insensitive comparison. This does not prove the absence of every
possible engine-side hashed-name collision. Position components must be finite
and within ±10,000; optional dimensions must be within `[0.1,1000]`. These
are safety bounds, not guarantees that a location or dimension is suitable
for gameplay. Dimensions are converted to float32 feet using the native
`0.3048` world conversion; actor position is stored as float32 world meters.
The engine initializes the current transform from the initial transform.

The existing BOX origin convention and dimension bridge are documented in
[COLLISION_AUTHORING.md](COLLISION_AUTHORING.md). Native bridge `0x40f280`
is retained as
`ev_8ebd053ee9b062fa91cf80c4df5c1d9cf04020932ca7c4290f10f0ce447d075f`.
This clone interface does not change angles, scales, local collision offsets,
collision flags, parameter values or model vertices.

For read-only CLI inspection, put this JSON in a request file:

```json
{
  "operation": "inspect",
  "path": "research/arena_challenge_303_000/level.bld",
  "expectedSourceHash": "de0ecd5bc5f5f2b3d99ec81592e8fef97a3228e6777e99f1c169e6cd584e7a32"
}
```

```bash
node tools/actor_clone.mjs /absolute/path/to/request.json
```

`runRequest` also accepts `operation: "build"` with the same `path` and
`expectedSourceHash`, a new `output` path, and the explicit `name`, `position`
and optional `dimensionsWorld`. It creates the output and
`output + '.manifest.json'` exclusively. Parent directories must already
exist. Unknown fields, modified inputs and already-generated clones reject;
there is deliberately no force option or arbitrary template selection.

The file wrapper uses bounded regular-file reads, read-only source access,
exclusive output creation, fsync, output SHA-256 readback and source digest
rechecks. Existing outputs, manifests and symlinks are not overwritten. On a
caught failure, it removes only output/manifest inodes created by that call.
There is no two-file atomic transaction or cross-process locking; abrupt
termination can leave incomplete new outputs.

Run the source-only request/guard tests:

```bash
node --test tests/actor_clone.test.mjs
```

Opt into real-file, memory-only reconstruction tests:

```bash
SKYLANDERS_TEST_LEVEL=research/arena_challenge_303_000/level.bld \
  node --test tests/actor_clone.test.mjs
```

The real tests append objects #32129/#32130/#32131, changing total object
count 32,666 → 32,669 and root count 1,459 → 1,460. The 537 original objects
in later pools change RVTB indices, not encoded addresses. Tests verify all
original Default bytes outside the declared root header/model-count spans,
all later pool bytes, the copied-object spans, pointer and string fixups,
private ownership, the signed external root entry, optional float32 dimensions,
manifest hashes and unchanged source content/modification time. Occupied
output/manifest/symlink tests reject without producing a game payload.

No new map, runtime actor, safe teardown or walkable authored floor is claimed
by these structural results. The next controlled runtime experiment must
choose a visible reachable location, install only a disposable rebuilt copy,
and separately test activation, rendering, collision, re-entry and teardown.
