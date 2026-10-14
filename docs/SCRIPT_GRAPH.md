# Script graph: native-backed structure, not a complete script compiler

`tools/script_graph.mjs` exports a read-only JSON view of the script objects
inside an extracted PS4 `level.bld`. It preserves opcode order, operands,
source locations, selected native control-flow facts, and direct placement
owners. This is a foundation for reusable gameplay modules and later AI
generation; it does **not** yet produce arbitrary playable scripts or register
a new chapter.

The supported executable is the project's own CUSA00697 ELF with SHA-256
`423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3`.
Native field tables are extracted from that exact ELF by `elf_metadata.mjs`;
an unrelated game build is rejected. Input level bytes also require an explicit
SHA-256. No copyrighted game assets are included with this tool or its synthetic
tests. Obtain the inputs using the documented own-PKG setup, not by distributing
the research output.

## Export a selected script

From the repository root, using the already-extracted arena fixture:

```bash
node tools/script_graph.mjs \
  --source research/arena_challenge_303_000/level.bld \
  --expect-sha256 de0ecd5bc5f5f2b3d99ec81592e8fef97a3228e6777e99f1c169e6cd584e7a32 \
  --elf extracted/CUSA00697/eboot.elf \
  --script-name ArenaScript_303_000.ai \
  --output research/arena-script-graph-new.json
```

Use a **new** output filename on every run. The exporter refuses overwrite,
opens the source read-only, rejects source symlinks, checks source stability,
and verifies its output hash. It does not launch the game or change the editor.
For another input, obtain its expected digest with `sha256sum path/to/level.bld`
and retain that digest alongside the extraction manifest.

`--script-name` is a case-insensitive substring of the serialized script name,
not a regular expression or path to a source-code file. Repeat `--script-id N`
to select exact RVTB object indices from **this exact hashed artifact**. If both
filters are supplied, both must match. Without filters the tool selects all
`tfbScriptInfo` objects, subject to budgets. Indices are not portable across a
rebuilt archive; every exported object also has a SHA-bound ID.

An example selection for the inspected Soda Springs chapter:

```bash
node tools/script_graph.mjs \
  --source research/chapter-catalog-v2/level_313_tutorial/level.bld \
  --expect-sha256 ffb0550f8f11d53e0db9aaa32bc977c887a5f5c0b8f1a139555859a4034b6cd3 \
  --elf extracted/CUSA00697/eboot.elf \
  --script-id 17780 --script-id 26794 --script-id 27139 \
  --script-id 45815 --script-id 48006 --script-id 66176 \
  --output research/soda-script-graph-new.json
```

These are examples for local extractions, not universal object indices for
other regions/builds. Existing structural catalogs expose `tfbScriptInfo`
objects and their names for selecting other scripts.

## What the JSON contains

The schema is `skylanders-script-graph-v1`; output is compact JSON for bounded
machine consumption. `source.sha256` identifies the input, while the CLI's
summary includes the generated JSON's size and SHA-256.

- `scripts[]`: `tfbScriptInfo`, its `OpCodeList`, master-variable reference,
  directly attached owners, and ordered zero-based `rows[]`.
- Each row: exact object identity/type/name/byte range/hash, its list-slot
  location, native-backed scalar attributes, serialized references, declared
  pointer fields including nulls, and deliberately partial `controlFlow`.
- `operandObjects[]`: a deduplicated, bounded graph of referenced objects.
  Selected reference-array layouts expose ordered `listEntries`; other untyped
  data remains a source-bound unresolved target.
- External references retain the relocation kind, EXID/EXNM entry index,
  original slot/entry bytes, and in-range status. EXID name/namespace words are
  preserved, **not automatically linked or evaluated**. For the separately
  recovered global namespace, see [CHAPTER_REGISTRY.md](CHAPTER_REGISTRY.md).
  A strictly matched native builtin pair may receive a `nativeBuiltinIdentity`
  annotation, but remains an external reference, not a resolved local object.
  EXNM's two uint32 words are native-backed TSTR indices (name first, namespace
  second); `stringIdentity` includes their strings, indices and byte locations.
  Out-of-range string indices remain explicit unknowns and are not masked.
- Owners are proven direct local `Placement._script` references through known
  native class inheritance. They are not a list of all spawned runtime actors,
  activation states, or guessed owners of unknown placement subclasses.

Native metadata fields at offset zero, including virtual `OpCode._internalFlags`
and `_toolTip`, are **not** read from object byte zero. Actual stored flags use
`_internalFlagsStorage` at `+0x30`; the branch delta is unsigned 16-bit
`_branchPC` at `+0x32`. Flag meanings are not guessed from the numeric value.

`tfbScriptInfo._opList` is `+0x28`; `_masterVarList` is `+0x30`.
`OpUserBehavior._thisPC`/`_scriptInfo` are `+0x34`/`+0x38`.
`OpDefineMacro` inherits `_thisPC`/`_scriptInfo` at `+0x40`/`+0x48`, then adds
`_macroVarList`/`_returnMacro` at `+0x50`/`+0x58`.
Serialized null bindings stay null in the export; the tool does not fill in
runtime links by assuming that a nearby script owns a behavior.

`ValueRHSVariant` exposes `_arithOperator` at `+0x18` as **signed** int32 and
uses the recovered `ArithOp` names: `NO_OP=-1`, `ADD_OP=0`, `SUB_OP=1`,
`MULT_OP=2`, `DIV_OP=3`. Its `_varOp1` (`+0x10`), `_varOp2` (`+0x20`) and
`_conditioner` (`+0x30`) are reported as reference slots. `_resultFunc` at
`+0x28` is **not** guessed to be an object reference or invoked. Recognizing
these fields does not evaluate expressions, conditions, coercions or runtime
values; unknown enum values stay numeric with a null name.

`RHSValueStack._type` at `+0x38` retains its reference, often an EXNM metadata
type such as `IntMeasurement` in the `metaobject` namespace. `_value` at `+0x40`
is retained as its raw uint32 payload, and `_properties` at `+0x30` as stored
int32. Sharing that offset does not establish bit masks for `_funcRHS` or
`_typeIsNumber`; virtual `_isRandom` at offset zero is not read. A stored payload
and its metadata type still do not prove the eventual converted runtime value.

A conservative `directLiteral` annotation is available for one native-backed
case only: `ValueRHSVariant` with `NO_OP`, null serialized conditioner/result
function, and an empty `RHSValueStack` whose entire properties word is zero.
Native selector `0x470e70` chooses getter `0x48e630` for this case; the getter
copies the raw 32-bit payload and returns the referenced type. The exporter
does not invoke the function, infer unverified property-bit masks, apply
destination conversion, or act as a general expression evaluator.

The exact EXID pair `(nameId=967958004, namespaceHash=1549491124)` is identified
as the native property `SetVariant::count`. Native registration installs getter
`0x4814a0` and setter `0x4814c0`; the inspected getter reads a uint32 at `+0xc`
from the wrapped container. The annotation preserves the four supporting REA
records and `valueEvaluated:false`. It does not resolve an external archive,
execute the accessor, infer a current set size, or apply to similar hash pairs.
Exact Placement property pairs are likewise annotated for `activation range`
and `deactivation buffer`. Their native setters write floats at placement
`+0x130` and `+0x134`, respectively. The preceding property conversion and units
are not simulated, so an `IntMeasurement` payload is not blindly treated as
the float's serialized bits.
The exact pair `1073217499/1483773250` is `ActorInfo::removed` (native class
`tfbActorInfo`): its registered getter returns a static `SetVariant` reference,
not the runtime set contents. `SpriteInfo` has a different namespace hash and
is not silently treated as the same class. Pair `1278082707/2288385111` is the
registered `OpTopLevelBehavior::my` property, type `ScriptReference`. That
identity alone does not establish its runtime context/getter or prove that
it refers to the script owner's placement.

## Verified control flow and important limits

The native VM at `0x477fd0` increments PC **before** invoking the opcode's
vtable entry at `+0xd0`. Therefore, where an opcode actually uses `_branchPC`
as a skip, the immediate target is:

```text
target row = current row + 1 + unsigned branchPC
```

That formula is **not** enough to assign an edge to every opcode. Every row
retains a `serializedSkipCandidate`, but unknown opcode types receive no
invented executable edge. Likewise, an out-of-list target is retained as
`outside-list`, not silently clamped or interpreted as an ordinary return.

| Exact native opcode | Exported fact | What remains unresolved |
| --- | --- | --- |
| `OpCheckValue` | Successful comparison falls through; false comparison or unresolved operand skips by the unsigned delta. | Runtime operand values and actual reachability. |
| `OpStartUp` | Mask `0x8` in the placement field at `+0x38` guards entering or skipping the startup block. | Placement lifetime/reset behavior and actual execution in a new level. |
| `OpAbstractFlow` | Applies the skip immediately, then unwinds 24-byte execution frames and calls saved opcode callbacks at `+0xe0`. | Those callbacks may change PC; the immediate update is **not** an unconditional final successor. |
| `OpStartSequence` | Operand/sequence-start failure can skip; success creates a sequence and pushes a frame. | Dynamic execution state and a complete sequence graph. |
| `OpCheckMembership` | Predicate success falls through; false or unresolved operands skip. Native enum names are `includes`, `excludes`, `intersects_with`, `includes_all`. | Runtime set contents, conversions and full set-predicate evaluation. |
| `OpShutDown` | Placement flag mask `0x2` at `+0x38`: absent skips, present pushes an execution frame and enters the block. | Later frame callbacks and lifecycle transitions. |

Additional `nativeEffect` annotations do not pretend to be complete CFG edges:

- `OpControl`: resolves a receiver/index, handles receiver activity, pushes a
  frame and changes execution receiver/context. The full receiver/frame state
  is not simulated.
- `OpSpawn`: for placement templates, native code clones the template, applies
  position/facing, registers and activates the clone. Non-placement templates
  take a separate generic factory/copy branch; those semantics are not simulated.
  A template mesh alone is not proof that all resources,
  scripts, collision and runtime dependencies needed for an authored spawn exist.
- `OpSetBehavior`: the selected behavior's script must match the placement's
  script before the placement's execution-behavior field is changed. This is
  an important binding constraint for any later script builder.
- `OpFlowLoop`: restores PC from the top execution frame, invokes its saved
  callback and can unwind outer frames. There is no fabricated static loop edge.
- `OpRemove`: resolves its operand and requests native activity transition 3
  for placements below state 3; sets are copied before iteration. This is not
  a file deletion or proof that every physics/render resource disappears.
- `OpSetValue`: evaluates the RHS function, applies the selected property's
  conversion callback and calls its setter on success. It is not a generic
  raw-field write.

The graph does not execute stacks, reconstruct original `.ai` text, decode
every opcode's semantics, resolve every external module, or recover dynamic
macro/behavior/sequence state. Similar type names and script filenames are not
semantic proof. The output always has `runtimeValidated:false`,
`semanticsComplete:false`, and `executableScriptSourceRecovered:false`.

## Concrete read-only observations, 2026-10-14

The arena input above contains 63 `tfbScriptInfo` objects, 20,693 opcode-list
rows, and 84 direct owners recognized through the currently recovered placement
classes. Its `ArenaScript_303_000.ai` is script object 4273, attached to actor
4272 (`303ArenaChallengeScript`), with 1,233 rows.

- Row 1 is `OpStartUp`, delta 9: enter at row 2, skip at row 11.
- Row 43 is `OpCheckValue`, relation `GT_OP`, delta 6: success row 44,
  failure row 50.
- That selected script contains 149 `OpCheckValue` rows and 42 exact
  `OpAbstractFlow` rows. This count does not mean all surrounding calls and
  gameplay effects have been decoded.

Soda Springs' inspected source contains 194 script objects. The six selected
scripts in the second command contain 2,944 rows and six direct owners:

| Script object | Serialized name | Rows | Direct owner |
| --- | --- | ---: | --- |
| 17780 | `Level_Def_313.ai` | 1246 | `_Level_Def_313` (52899) |
| 26794 | `Gate_remover_Post_Fight.ai` | 15 | `Gate_Remover_Post_Fight` (26793) |
| 27139 | `Gulper_End_Boss.ai` | 1471 | `GulperGiant(1)` (27138) |
| 45815 | `Gulper_Capture_Sequence.ai` | 129 | `Gulper_Subdued(1)` (45812) |
| 48006 | `TEMP_LevelEnd.ai` | 34 | `Vat_Puzzle_Complete` (48001) |
| 66176 | `313_EnemySetupOP_01.ai` | 49 | `Setup_001_OptionalController` (66175) |

For example, `TEMP_LevelEnd.ai` row 6 has verified comparison successors 7/14;
the optional-controller script's row 20 has successors 21/38. The names identify
useful investigation seeds, **not proof that those objects alone finish a
chapter, open every gate, or implement a complete enemy encounter**.

Earlier broad local snapshots (private research outputs, not source-package
assets; filename revision 3, still the additive `skylanders-script-graph-v1`
JSON schema):

- `research/arena-script-graph-2026-10-14-v3.json`: 3,378,658 bytes, SHA-256
  `3a385a4bbdf183b150eb1e786095e8adb22821237159a9765e3d1462cee0075c`.
  It includes 35 RHS variants (19 `NO_OP`, 15 `ADD_OP`, one `SUB_OP`) and two
  distinct serialized `SetVariant::count` slots within the bounded graph.
- `research/soda-script-graph-2026-10-14-v3.json`: 9,393,994 bytes, SHA-256
  `e35d28b35b30c624b4638b7d206dd57c4a443f9d946b30915c8e7b7f647a582c`.
  It includes 184 RHS variants (138 `NO_OP`, 32 `ADD_OP`, 14 `MULT_OP`) and
  three distinct count-property slots, without evaluating any expression/set.

The earlier `*-v2.json` snapshots are preserved (before the reviewed OpSpawn
placement-vs-generic clarification). These broad v3 snapshots predate the
gate-specific EXNM, membership, property and literal annotations below. Original v1
snapshots are also retained:

- `research/arena-script-graph-2026-10-14-v1.json`: 3,322,634 bytes, SHA-256
  `1895bdba4bde8e3d12a341db0a290633b8b08f44c05a2c8b36ded1795f4ddbd2`.
  The selected script has 227 expanded operand objects and 73 references at
  the configured depth/placement boundary.
- `research/soda-script-graph-2026-10-14-v1.json`: 9,115,220 bytes, SHA-256
  `c58ac983a34ea1866dc241c42d042deee499c53568ea53e8ab58e59ebddc1fa1`.
  The six scripts have 1,237 expanded operand objects, 518 depth/placement-boundary
  references and 67 unexpanded untyped references. Neither snapshot claims
  complete operand expansion or complete runtime semantics.

## A concrete post-encounter script, not a generic door recipe

The latest **gate-only** private graph is
`research/soda-gate-script-graph-2026-10-14-v1.json`: 110,000 bytes, SHA-256
`b45c5af3bfc879e2e894a900f6780226c558404c19b74bab7242fd6800064307`.
It contains one script, 15 rows, one direct owner and 29 expanded operand
objects; 21 references stop at the explicit depth/placement boundary, with no
omitted operand objects or unexpanded untyped references. Generate your own
equivalent by using the Soda Springs command above with only
`--script-id 26794` and a fresh output filename. This snapshot includes the
EXNM, property, membership and direct-literal annotations; the broad v3
snapshots above are preserved unchanged.

`Gate_remover_Post_Fight.ai` (26794) is only 15 opcode rows, but its dependencies
show why an AI must not copy a script based on its filename. Its direct owner
is actor 26793; the script has no master-variable list. Row 4 uses membership
operator `includes`, with failure skipping to row 14 and success entering row 5.
Its operands are `ActorInfo::removed` (EXID 191, pair
`1073217499/1483773250`) and actor 22188 `Setup_Mushroom_Controller`.
Thus the static contract is an `includes` membership predicate against the
native removed-set property and that exact controller reference; the tool
does not claim to have evaluated the set conversion or observed the encounter.

The remaining serialized operand chains are:

| Row | Operation and target | RHS payload/type or operand detail |
| --- | --- | --- |
| 5 | Set activation range of actor 26801 `Pop_To_Camera_4_Post_Fight` | `200`, `IntMeasurement` |
| 6 | Set deactivation buffer of the same actor | `0`, `IntMeasurement` |
| 7 | Set activation range of actor 26875 `Transition_4-3_post_Fight` | `80`, `IntMeasurement` |
| 8 | Remove actor 26879 `Pop_To_Camera_97` | Group-stack type `AbstractPlacement` |
| 9 | Set activation range of actor 26887 `Trigger_Barrel_Lobbed` | `0`, `IntMeasurement` |
| 10 | Set activation range of actor 31087 `Trigger_NPC_Set_4` | `150`, `IntMeasurement` |
| 11 | Set deactivation buffer of actor 27138 `GulperGiant(1)` | `0`, `IntMeasurement` |
| 12 | Set ValueInfo 27125 `Full V.O` | `1`, `IntMeasurement` |
| 13 | Remove externally resolved `OpTopLevelBehavior::my` | EXID 148, pair `1278082707/2288385111`, group type `AbstractPlacement`; runtime identity not evaluated |

These are structural targets and stored RHS payloads, not a captured successful
execution. EXNM explicitly identifies the guard's group-stack type as
`tfbActorInfo`/`metaobject`, removal group types as
`AbstractPlacement`/`metaobject`, and the literals as
`IntMeasurement`/`metaobject`. These RHS variants also meet the conservative
native direct-literal criterion above; that does not convert `200`, for example,
into a proven world-space range. The builtin names in this report have exact
native registration evidence, not only matching string hashes. `my` remains
an external reference, not an automatically resolved local owner.

No direct physical door-model reference occurs in this script's immediate
effect operands. Its dependency graph instead includes chapter-specific camera
scripts, trigger scripts and the Gulper boss script. A portable first encounter
recipe should therefore explicitly bind an encounter controller, a barrier and
the controller's own lifecycle, deliberately excluding those unrelated side
effects. That is a proposed test design, not an already supported compiler.

Important writer prerequisites: source opcodes are shared. Row 1 references
object 19883, row 2 object 17844, and both rows 3 and 14 reference object 17843;
these objects also appear elsewhere. Never patch shared branch/PC objects in
place. Clone and remap authored rows, rebuild list/fixup references, recompute
branch deltas, bind the script owner, and verify external type/property handles.
The built-in continuation/evaluation cadence and activity-3 collision/render
effects still require proof and emulator validation. A valid JSON graph alone
does not satisfy any of those runtime checks.

## Bounds and verification

Default limits: 1 GiB input, 1,024 selected scripts, 100,000 selected opcode
rows, 4,096 expanded operand objects, traversal depth 3, 64 MiB output.
Use `--max-scripts`, `--max-rows`, `--max-operand-objects`, and `--operand-depth`
within the hard caps implemented in the tool. Large whole-chapter results can
exceed the output limit: export named scripts or a small set of IDs instead.

Script/row limits reject an oversized selection; they do not silently omit
rows. Operand limits report omitted objects, depth/placement-boundary references,
and unexpanded untyped references. Even a completed bounded operand traversal
is not proof of full expression semantics or runtime dependency closure.

```bash
node --test tests/script_graph.test.mjs
```

Tests include synthetic source-bound graphs, unsigned deltas and PC ordering,
unknown subclasses, dynamic unwind distinctions, EXID preservation, null
bindings, virtual-field exclusion, source hash/metadata validation, malformed
list bounds, selection, explicit operand truncation, signed arithmetic enum
values, and exact-pair-only native property identity. Optional local tests
also cover exclusive output/source preservation and the concrete arena/Soda
examples. Those local tests skip in a distributable source-only checkout when
the user's game files are absent.

## Native evidence ledger

All entries refer to the exact executable SHA-256 above, recovered statically
with REA; none records an authored level executing.
Current-session records are preserved privately in
`research/rea-evidence-2026-10-14-chapter-authoring-v5.json` (289 records,
1,281,650 bytes, SHA-256
`d3bd3cd428b603e095da676dc052cbf211907c30913c229143a74976d6831b4f`).
The older EXNM loader record is in
`research/rea-evidence-2026-10-13-registry-combiner.json`.

| Finding | Native procedure/registration | REA evidence |
| --- | --- | --- |
| VM pre-increment and `+0xd0` dispatch | `0x477fd0` | `ev_2addc8e3584f70ff48a61616569d25775fe47acc2a2822f5e5909f0c1403c529` |
| Check-value conditional skip | `0x48cf10` | `ev_2c88a29517b630dab0677b08161c134fe0f6a55f0304e67ed02f8a6a7446f26e` |
| Startup guard | `0x470940` | `ev_e872ece293219684d14c773af553584cc117330241f9969a5e9cb70f6ae5ede4` |
| Flow update and unwind | `0xa60500` | `ev_21610eacc7ea28b5fbd6fad87a7df29a802e72b57db84575e5baeb0ac2771d50` |
| Sequence start | `0x4857a0` | `ev_3423bad0fc27338437f047cecb30b5585c22515ed740526e13ec4bd1118cd6a9` |
| Execution frame push | `0xa5e440` | `ev_535653798383380c2ea43ec2c380043a5388979a63091e22cc19a22f1e194e80` |
| Control receiver selection | `0x47cda0`, `0x47ccb0` | `ev_87388b0731d96e652030148cc3f15b8fa8185e232ad7b30f601b9deccac5552c`, `ev_b9f267d2c2ece311bb1c75ec202101a9a8c48cd7abd10c6ad46926b778c63d9c` |
| Spawn and clone setup | `0x47ce10`, `0x47af60` | `ev_8d420bd6c140794e9905b9313ccc0c50eeb673920714c880490be24306b93ac0`, `ev_20f44c4cb45309e629d2f10c921ea1a64aed23061cfbf5f89269a49998968518` |
| Behavior/script binding condition | `0x471540` | `ev_e270fd3ad33e84d2d1d36613f7ca9ed4c0b9410293c012e56ae592fb8ca75ae7` |
| Dynamic loop frame continuation | `0xa60420` | `ev_90c4cb64abbec35e68570778036cde84b441111991221dd2135b92f31bcfeca0` |
| Script list/variable fields | `0xb93a92` | `ev_b50020d9ac6af6440cd9919ccfb99e1db11d89d3fac21f77e914c1715100cffc` |
| Opcode stored/virtual fields | `0xb85588` | `ev_248acff0da27a20054087a99e7677f99713903fa052b0086f9803aeadb265c9e` |
| RHS arithmetic/operand fields | `0xb95a42` | `ev_9e95a8f9b79e0a0c554db8bb39fc803291ad4e52aff869e527f1bd2e8098c2cf` |
| Signed arithmetic enum | `0x46ec40` | `ev_30d11f5eb05ad1511822c63bb3e5c90dee78300a4afe7f1afe2f14e480a4276d` |
| SetVariant type and count property registration | `0xb8ccba`, `0xb8cdfc` | `ev_66062c938ad3ea1141fbd0aaa3244f0bd27a747a56c9871557b1a4d3a1d601b3`, `ev_11fdeffa6dbac8c21e58bab96a17dcae08a8da71ca801acc343674010484d77a` |
| Native class/property name-pair registration | `0x46ff80` | `ev_fe8028a89ebb7d05dbae502b7fa5b4aede3a10c45c170196c2e42c82af6043c6` |
| Count getter raw native instructions | `0x4814a0` | `ev_9f8ccd6874c8a1fcd07054d9ef18fa78cec79d6e6073469251e8efa953188b05` |
| EXNM TSTR indexing and RNEX resolution | `0x568430` | `ev_ec2b575e84cb4f06b1aba8c75f1ce0d82f7db4a2852eab4ef8b43300b51f0e8b` |
| Membership guard | `0x482400` | `ev_00236125db2bf634bc338de9fbfdbd1f10b4528b763de96d2c4110823cacb10e` |
| Remove/activity request | `0x47b2a0` | `ev_438bbebfce277e4b5e8329436a6b172e6536d54202fdf04ce1a5190bde840ab8` |
| Shutdown guard | `0x470c20` | `ev_05695876e7f43d96c5ce21d4f4cf63d5f943f33ce05c9ce3d3467e73ef193216` |
| RHS conversion and property setter | `0x48b680` | `ev_2d7c1a4b06d36f40044636e1d16e51deed715f02af941539853749d71b9980ee` |
| Placement property registration | `0xb874b8` | `ev_e8d2900f6f4b86d87a40917197817a8af55dfdd2462bd4ee7822608e7769c3a2` |
| Activation/deactivation setters | `0x47b9d0`, `0x47ba50` | `ev_6f68b112a19a09ac7bdba65933531b43f86787970787ef94217f0fe1996b4e47`, `ev_76f0a9f6aa2c732f1c1d318268eadb0643ee32c3a5287691e5c3cb52f126a7c4` |
| ActorInfo removed-set registration/getter | `0xb5df60`, `0x40cd30` | `ev_8106957a62ac8ed7cd3e2fa0ee5073c00777d48f5292117ab75394ffc2f1bb1d`, `ev_1aebdac05b6820eae8348572204ed2efca9cd6af2dac4743a8206ab360777166` |
| OpTopLevelBehavior my registration/type | `0xb80a90`, `0xb80942` | `ev_3c2a8d6d1b133ff67a3e36e2299003ec10a36813dbdfad5a9614ad752d5d0275`, `ev_1ccf46bf73a4a6e4bfc96a74ef78539b25ae37426b71079b3c6acf39ea9a833b` |
| Restricted direct-literal selection/getter | `0x470e70`, `0x48e630` | `ev_2834b716a4acd86c1241f5da4d2f5484442ec8896fe9791f14cb609373dc3b1c`, `ev_d574b616d9d13a985395c1eb1db06faa21ddb4858a74930528aa23dabe905521` |

## Remaining work before AI-generated chapters

This graph makes existing logic inspectable and gives an AI stable, verifiable
references instead of relying on object names. It is not itself the authoring
format. A safe subsequent workflow still needs recovered operand evaluation
and macro/behavior bindings; dependency-closed gameplay recipes; cross-chapter
mesh/material/collision import and remapping; a verified writer/compiler with
branch and binding validation; and chapter registration/save/unlock/resource
loading rules. Each generated candidate then needs actual emulator checks for
spawn, traversal, collision, encounter/gate progression, restart and completion.

Prefer a small verified recipe (for example, one encounter and its gate) as the
first authored end-to-end test. Neither an isolated mesh arrangement nor a
successfully parsed graph proves a whole generated chapter playable.
