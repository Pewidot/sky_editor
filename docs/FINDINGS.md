# Investigation ledger — 2026-10-13

## 2026-10-14 continuation: save allocation and concrete script effects

The exact-ELF metadata extractor now covers 72 classes, including
`OpParameter`, `RHSValueStack`, `OpCheckMembership` and `OpRemove`, plus native
membership and RHS-function enums. See [SAVE_LAYOUT_DISCOVERY.md](SAVE_LAYOUT_DISCOVERY.md)
for the 88 save-definition call sites and sequential `width * count` allocator.
The conditional eight-span sensitivity of one additional title/load is 82 bits
with the original three difficulty segments. This is not a whole-save size,
capacity limit or migration result.

The 15-row `Gate_remover_Post_Fight.ai` example now has source-bound native
membership/assignment/removal effects and exact external identities. It updates
chapter-specific cameras and triggers, not a directly referenced physical gate.
`ActorInfo::removed` must not be confused with `SpriteInfo::removed`, which has
a different namespace hash. `OpTopLevelBehavior::my` is registered as a
`ScriptReference`; identity alone does not prove its runtime receiver. Shared
opcode objects require per-row-aware cloning, not in-place branch edits.
Full provenance and limitations are in [SCRIPT_GRAPH.md](SCRIPT_GRAPH.md).

[IGZ_APPEND.md](IGZ_APPEND.md) documents coordinated existing `ScriptSetList`
growth. Both original global title/load lists passed memory-only 22-to-23 tests;
global ROOT end-appending preserves existing handle positions, while bootstrap
ROOT growth would change their base. No chapter was installed or run by these
tests.

The current private native bundle is
`research/rea-evidence-2026-10-14-chapter-authoring-v5.json`: 289 records,
1,281,650 bytes, SHA-256
`d3bd3cd428b603e095da676dc052cbf211907c30913c229143a74976d6831b4f`.
It retains the literal-result selector `0x470e70` and raw getter `0x48e630`,
property registrations and opcode execution procedures. It also contains:

- `ScriptSetList` / `igObjectList` registrations `0xb8d2bc` / `0xbd8900`,
  vtables `0xf51a90` / `0xf798b0`:
  `ev_1af4b13090a5a0bdef740ac29b530f5dfdbe96f0ece28b337dda8ca3cac29d52`.
- Their `+0x38` callbacks `0x48af60` / `0x524ae0`; the former calls the latter.
  With callback argument 1, it releases each nonnull array member through
  `0x51c280` and clears the slots/count:
  `ev_faca8c4b6942c014242c19968236ba435acc9661f37f4f02660e24170a9182fc`.
  This corroborates owning list references statically, not runtime acceptance
  or teardown correctness of a newly authored chapter.

Older loader/refcount evidence remains in the 2026-10-13 bundle. All native
analysis used the unchanged original executable and the same Ghidra profile
shown below. Original game files and checkpoints remain unchanged.

Follow-up native binding evidence is retained in
`research/rea-evidence-2026-10-14-chapter-authoring-v6.json`: 292 records,
1,301,961 bytes, SHA-256
`6da57e594c9261dd2dab870e5c419698905ee7a9e6bfeefe9d8359e681df3bb3`.
The `tfbScriptInfo` callback `0x48a8d0` calls `0x478820` with the opcode list
and script object. Under explicit first-opcode/definition flag guards, that
routine walks macro definitions using their branch extents and writes each
definition's actual row into `_thisPC +0x40` and script into `+0x48`.
The original adventure script satisfies these guards and serializes those
fields as zero/null. A prospective insertion must preserve this binding walk;
it must not blindly increment every serialized zero PC.
Constructor evidence:
`ev_33ca444fd77cbe0a554898b4c558a4b9fac993069bab675937c0dcaf780eaf5a`;
callback:
`ev_852bed13b0f7b503617aeb64b22a46e5008da01ad0ca81a72065c76daf1fcade`;
binder:
`ev_d58a4911372b4f0f950adcbaf73894382bbfe8848a8d2bf75f77b54db85dace6`.
This is a native-code binding observation, not proof that an edited script
has loaded successfully.

## 2026-10-14 continuation: chapters and script runtime

The current source-bound findings and reproduction commands are in
[CHAPTER_ENTRYPOINTS.md](CHAPTER_ENTRYPOINTS.md),
[MODULE_DEPENDENCIES.md](MODULE_DEPENDENCIES.md) and
[SCRIPT_GRAPH.md](SCRIPT_GRAPH.md). The older scope table below is historical;
[WORK_STATUS.md](WORK_STATUS.md) is the current progress/remaining-work index.

REA used the same exact original ELF, Ghidra 12.1.4, profile digest
`a04af771c3a78edf03c11c3b8652d4812dfce76da00d380345526a333361b5c9`.
The private bundle `research/rea-evidence-2026-10-14-scripts-chapters-v4.json`
contains 220 retained records (907,167 bytes); older VM/loader/copy evidence is
also retained in the 2026-10-13 bundle. These are static observations, not
execution of an authored chapter. Neither the ELF nor original IGZ/save files
were edited. The session remains open for follow-up native work.

Important native continuation seeds not yet modeled as a complete graph:

| Exact opcode | Verified dispatch binding / seed | Remaining boundary |
| --- | --- | --- |
| `OpPreScript`, `OpUserBehavior` | Vtables `0xf52300`, `0xf52400`, slot `+0xd0` → `0xa5f300`, tail jump to frame push `0xa5e440` | Frame push alone does not prove behavior selection/reachability. |
| `OpDefineMacro` | Vtable `0xf53bd0`, slot `+0xd0` → `0x473f70` | Exact-ELF disassembly shows script/PC/macro-variable context changes; full callback/call-return semantics are not modeled. |
| `OpUseMacro` | Vtable `0xf53ed0`, slot `+0xd0` → `0x4753c0` | Initial resolution uses `_NP +0x38` and `_indexRHS +0x40`; partial bytes are not a recovered macro-call graph. |
| `OpLoopValue` | Vtable `0xf54c20`, slot `+0xd0` → `0x48d0e0` | Evaluates count, enters/pushes or skips; iteration/return callbacks still need tracing. |
| `OpFlowLoop` | Vtable `0xf58860`, slot `+0xd0` → `0xa60410` wrapper → `0xa60420` | Restores a frame PC and calls saved opcode `+0xe0`; dynamic continuation, not a guessed static loop-back. |
| `OpFlowMacro` | Vtable `0xf59470`, slot `+0xd0` → `0xa607a0` | Tail-dispatches the selected macro object at `DAT_01085e40`; target is runtime state. |
| `OpFlowBehavior` | Vtable `0xf58b60`, slot `+0xd0` → `0xa60500` | Shares immediate branch/unwind implementation; complete behavior state still unresolved. |

Ghidra did not supply function pseudocode for some short entries/wrappers.
Their exact analyzed bytes were retained with `read_bytes`; focused
`llvm-objdump` disassembly started at verified entries in the same ELF. Do not
substitute invented pseudocode or start disassembly at an arbitrary nearby byte.
REA byte evidence: `0xa5f300`
`ev_f4de0ea41670d0e5864b770ee9c76fbb35ebd88d4aca8aa8c5465abf44511055`;
`0x473f70` (first 64 bytes only)
`ev_ef9d49fc3a5ad4766262ca3d7a480e5c346730d40ff12de672ee23adc313fe58`;
`0x4753c0` (first 128 bytes only)
`ev_d2278c29694a7dc4a4f8ea7a186a57b81dc928a6420692bcf3b394a351df4cea`;
`0xa60410` `ev_8087bae30fc956a83f711b3f22dd81404911a287e74d4840594cbede9beb13ef`;
`0xa607a0` `ev_fd4d2d9b10138002b0c821176fc77f1b310e37772ad897a2f6e9ca289ee1598e`.
`OpLoopValue` procedure evidence is
`ev_a37174f303adc2e1fbeda1aafc712a2dd607829ee9e5dd1bb61ec68535991bd4`.

The runtime VM's known globals include current script `DAT_01086f78`, PC
`DAT_01086f70`, receiver `DAT_01086f50`, and execution-frame count/data
`DAT_01086f90` / `DAT_01086fa0`. A frame is 24 bytes; selected callbacks can
change context and PC after a nominal branch. These are native investigation
seeds, not stable external APIs or a supported RAM-patching interface.

## Scope and status

| Question | Status | Evidence boundary |
| --- | --- | --- |
| Is REA/MCP installed and usable? | Answered | `rea-agents@6.4.0`, Ghidra 12.1.4, Java 21; real decompiler calls succeeded after restart |
| Can this local PKG be extracted? | Answered for this input | 2,027 original regular files, 2,087 extractor entries, no reported extraction errors |
| How are level resources packaged? | Partially answered | IGA members, IGZ object graphs, rendering and physics resources inspected |
| Can existing placements be edited without corrupting unrelated bytes? | Answered offline | Verified class layouts; synthetic and real editor/MCP tests; copied outputs reparse |
| Can an edited payload be put back into an archive? | Answered offline | Independent extractor reproduces replacement; unrelated members preserved |
| Is there a C++ 3D UI and MCP editor? | Answered | Decoded map triangles, supported actor models/proxies, camera/picking/XYZ gizmos; GUI and real MCP tests |
| Can visible map and actor geometry be decoded? | Answered for bounded cases | All 77 mesh303 static Drawables; 74 supported actor transforms produce 107 mesh instances, including an explicit time-zero flag preview; unsupported models remain proxies |
| Can someone reproduce this using their own PKG? | Answered for supported inputs | Setup helper, source-only release helper, explicit prerequisites, synthetic setup tests |
| Has a wholly new playable level been created? | **No** | Four-spawn layout experiment only; no new geometry, collision, scripts or registration |
| Does shadPS4 run this original or modified level? | **Partially answered** | Original boots; built-in portal backend passes initial portal gate to save selection. Target arena and modified-level compatibility still require runtime validation; see the live runtime ledger |

This ledger deliberately separates implemented tools from a complete authoring
pipeline. It is not a claim that the larger “entirely new level” goal is finished.
Runtime progress is recorded separately in [RUNTIME_TESTING.md](RUNTIME_TESTING.md);
that document is authoritative for subsequent emulator/portal experiments.

## Target identity

Local package filename is private and not needed by the tools. Observed metadata:

- Package size: 22,299,803,648 bytes; PS4 PKG magic `7f 43 4e 54`.
- Content ID: `EP0002-CUSA00697_00-SKYLANDERSTRAPTE`.
- Title: Skylanders Trap Team, EUR PS4 `CUSA00697`, app 1.00/content 1.01.
- Extracted `eboot.bin` is a plaintext/fake-signed SELF wrapper, not a directly
  analyzable standard ELF in REA's native loader.
- Reconstructed `eboot.elf` SHA-256:
  `423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3`.
- Normal ELF LOAD mappings in this executable: virtual address = file offset +
  `0x3fc000`. The original embedded ELF header was at SELF offset `0x120`.

Original PKG and extracted game assets were not patched in place. Research
payloads, reconstructed ELF and rebuilt archives are separate local outputs.

## Reproduce the REA analysis

The [REA project](https://github.com/morluto/rea) supplies the MCP interface;
Ghidra provides native analysis. The installed skill is an instruction package,
not by itself an MCP server or decompiler installation. This session used:

```text
npx -y rea-agents@6.4.0 mcp
GHIDRA_INSTALL_DIR=/absolute/path/to/ghidra_12.1.4_PUBLIC
JAVA_HOME=/absolute/path/to/jdk-21
```

For the tested plaintext SELF only, the public
[ps4_unfself tool](https://github.com/SocraticBliss/ps4_unfself) reconstructed an ELF.
It is not a general encrypted retail SELF decryption solution. Keep the original
`eboot.bin`; output a new `eboot.elf`. That reconstructed file is for analysis,
not an instruction to replace the game's executable.

Use REA `open_binary` on the ELF, then `search_strings`,
`resolve_containing_procedure`, and focused `procedure_pseudo_code` queries.
Search class names such as `AbstractPlacement` and `tfbActorInfo`, follow the
registration constructors, and inspect their field initialization routines.
Export the evidence before closing the ephemeral native session. This local
session's raw bundle is `research/rea-evidence-2026-10-13.json`; it is excluded
from the source release because it contains decompiled game code and local paths.

Ghidra's generic ELF loader does not fully understand PS4 dynamic tags. Metadata
pointer arrays need the PS4 RELA map, not merely reading their zero-filled file
slots. `tools/elf_metadata.mjs` reproduces this narrowly for the exact ELF digest.

Observed PS4 metadata relocation details:

```text
PT_SCE_DYNLIBDATA: file 0xc3d900
DT_SCE_RELA:      relative offset 0xa500 -> file 0xc47e00
DT_SCE_RELASZ:    0x2a6858
DT_SCE_RELAENT:   24
R_X86_64_RELATIVE (info 8): 114,973 entries
```

The PS4 tag definitions are corroborated by the public shadPS4-derived loader
source used by the [PKG extractor project](https://github.com/AzaharPlus/shadPS4Plus).
No title keys, firmware or proprietary SDK was downloaded or redistributed here.

## Native evidence ledger

All Evidence IDs below bind to the ELF SHA-256 above and Ghidra 12.1.4.
They identify **static observations**, not runtime traces or recovered original
source. Decompiler warnings and analysis boundaries remain in the private bundle.

| Observation | Addresses | REA Evidence ID |
| --- | --- | --- |
| Meta-class registration helper receives size and field-init callback | `0x51b090` | `ev_9cf74ca9ee4ae46e30f88e8087732f1609f5130ca86720751768504863d5f407` |
| Field creation helper and count | `0x519f60` | `ev_b7d84b304a1a17b2d1d4f27e53dc2274a709ff4de35c2db170a9e6986a5047c6` |
| Field names and uint16 byte offsets assigned from tables | `0x51a110` | `ev_843e503ae948954925a539b0dcf61217ae7e523946916155aa2399358781cd01` |
| AbstractPlacement size `0xf0`, parent AbstractAttachNode | `0xb80098` | `ev_73149e2c670fd8caad841b69d5a7857cac6dc56b121fb64a3a21fcaca9d13bb5` |
| AbstractPlacement transform/parent metadata | `0xb801c8` | `ev_6e8c2a28061c58fccd410ee7b6a4a37052162defb4f70f2f0c7b9a3fbce58139` |
| Placement size `0x138`, inherits AbstractPlacement | `0xb86e76` | `ev_baa41290db60f2f48e00fd53062d3c4b38e5e39f32c3b0423cb8a984987f8813` |
| Placement scale/script/collision metadata | `0xb86fd4` | `ev_6ba0db4facb80181374263871073835ff56dc1c17a248d2f50dc9b02a8dba9fc` |
| tfbActorInfo size `0x170`, inherits Placement | `0xb5db48` | `ev_d03688bf1dfdf668c17648da1550b0971d0d1ec6d6fb8d7037bd7c301b3dbb01` |
| Actor model/controller/parameters/waypoint fields | `0xb5dcd4` | `ev_6c6ec3fe8d4c0e54f46e86ca809d1726b31591362deeffbfb898a3aa694f98ab` |
| CollisionInfo size `0x80` | `0xb81610` | `ev_f940724cd95a7b0cf45821952581e11c3050768d580281d79d7954ed275592b2` |
| Collision transform/dimension/owner fields | `0xb816ea` | `ev_67886c33d7ae7e4031a12a83856a342d1be15cbbe656073e844138e447b7b3f8` |
| Transform meta constructor identifies tfbEulerTransformMetaField | `0x492000` | `ev_6b7c8df5d1a17e56bb5bf66951ecd19914cd056d58a69731ca565fb75470f476` |
| Transform zero initialization is two three-float groups | `0x494b80` | `ev_698352913acf41c09f3cfeaf99f7615fe2cb29e960f108b00364dfd99a5dc09d` |
| Matrix conversion: translation first, angles last, degrees | `0x4958c0` | `ev_8eb83d599d2f81547d093036cd928717f69f36f55af63f0f6f8c2e726d685504` |
| Forward transform: verified pure-Y rotation and translation | `0x494d10` | `ev_2e9d0250f42ec71f1ecbb95187cf0bb0bc0502c6c6a1bee938741f533398b08f` |
| IGZ fixup loader, including v8 ROFS flag handling | `0x568430` | `ev_ec2b575e84cb4f06b1aba8c75f1ce0d82f7db4a2852eab4ef8b43300b51f0e8b` |
| IGZ v8 writer emits named fixups and pool descriptors | `0x56f6e0` | `ev_8f1e689ccb70dca6b4dee9abc703e8f62259cc6343ce8643a7e9ed3e376cd5ca` |

Field-table virtual addresses for reproducibility:

| Class | Name pointer array | uint16 offsets | Count |
| --- | --- | --- | --- |
| AbstractPlacement | `0xf54d20` | `0xc7ef00` | 20 |
| Placement | `0xf55150` | `0xc7f070` | 22 |
| tfbActorInfo | `0xf35f90` | `0xc76fd0` | 7 |
| CollisionInfo | `0xf54e60` | `0xc7ef70` | 17 |

## Shipped-resource observations

These are local binary-parser/byte-comparison observations, independent of REA
native evidence. Reproduce with `iga_inspect.mjs`, `iga_extract`, `igz_inspect.mjs`
and the integration tests.

| Inner payload | Bytes | Objects | Types | Strings |
| --- | --- | --- | --- | --- |
| level_300_birdcage | 413,648,388 | 101,527 | 204 | 13,673 |
| ui_levelselect | 18,287,892 | 4,689 | 122 | 1,009 |
| sky_systems_levelswitch | 356,552 | 3,743 | 58 | 1,016 |
| arena_mesh_309 | 7,877,672 | 1,247 | 78 | 611 |
| arena_mesh_303 | 80,719,812 | 2,080 | 80 | 405 |
| arena_challenge_303_000 | 91,745,564 | 32,666 | 191 | 5,553 |

Birdcage TSTR has a genuine empty string at index 4528. Skipping all zero bytes
between strings incorrectly shifts later indices; two-byte alignment fixes this.
MTSZ agrees with the recovered actor and collision sizes. ROOT is a raw uint32
list in this v8 release, not the later-game encoding.

The ROFS loader gives bit `0x04000000` special meaning for v8: the pool still
comes from `encoded >> 27`, but the slot offset is masked with `0x03ffffff`.
Flagged slots are zeroed and initialized via two helper calls, rather than simply
relocating their stored word. Observed flagged slots belong to VFX classes;
118 occur in Birdcage and 172 in challenge303. Treating them as ordinary pointers
would invent runtime references. The corrected parser records them separately,
leaving no unresolved fixup locations in those two tested files. RMHN locations
use the ordinary 27-bit address offset and hold uint32 TMHN indices; 4,152 are
validated in Birdcage and 612 in challenge303. This is a decoded loader rule, not
a heuristic pool-mask change. See [IGZ_READER.md](../tools/IGZ_READER.md).

Challenge303 contains 203 named tfbActorInfo objects, each with a distinct
CollisionInfo reference at `+0x120`. Their current transforms are zero; 179
collision transforms are zero. The chosen LeftSpawn markers have zero local
collision transforms and dimensions `[3,6,3]`. LaunchPad_Ramp has a local collision
translation near `[0,-1.524,0]` and dimensions `[34,6,46]`.

Many other actors are templates, UI or script markers. Their coordinates cannot
all be treated as world positions. A plausible arena cluster spans approximately
x `[-505.33,-362.65]`, y `[-21.63,28.69]`, z `[-92.65,-5.71]`; this is an
analyst inference from names/positions, not proof of navigable space.

Mesh303 contains 77 rendering geometry/vertex/index-buffer sets and three
tfbPhysicsWorld objects. Collision-pool payloads have Havok packfile magic
`57 e0 e0 57 10 c0 c0 10` and version text `hk_2013.1.0-r1`. Thus new static
geometry requires both rendering data and compatible Havok collision data;
moving gameplay markers cannot create that geometry.

The read-only geometry exporter now decodes **all 77 mesh303 Drawables** with
78,066 vertices and 89,758 triangles, zero warnings. The arena world has 72
Drawables and the sky world five; the dedicated collision world has none. Vertex
positions use their descriptors, not byte zero: observed strides are 40/44/48
bytes with position offsets 4/8/12. RMHN resolves the data-handle slots to TMHN
buffer records, then bounded vertex/index payloads. Static non-sky bounds are
approximately `(-478.04846,-84.07365,-113.68716)` to
`(-375.61295,53.15471,-9.01122)`.

Actor models are a separate resource path and coordinate space. Challenge303
contains 109 model-linked actors referencing 78 unique models. Conservative
model validation accepts 60 models and decodes 91 unique local meshes (33,359
vertices, 39,178 triangles). Seventy-four actors have a supported root transform,
producing 107 rendered mesh instances. Native-confirmed socket semantics allow
20 more actors: their socket transforms do not move the owning mesh. Socket
definitions are metadata only; attached children and animation remain unsupported.
The flag adds a native-evaluated time-zero entity preview: three real meshes,
not an assumed identity/bind pose. Its source interpolation has a small nonzero
endpoint rotation, which is preserved. Live animation is not implemented.
The remaining 129 actors retain explicit proxy reasons; these
include script/position records with no serialized model, not just hidden visual
props. The known retracting ramp remains excluded because of uncertain model
coordinates. Nondefault scales, general Euler rotations, parent chains,
animations, skinned meshes and unsupported hierarchies are not silently approximated.

The Qt viewport and scene MCP path now consume the combined 184-mesh scene:
77 static Drawables plus 107 actor instances. It uses actual decoded triangles
with perspective and depth buffering; this is no longer the early X/Z-only
placement view. Static map geometry remains read-only, while verified linked
actor instances move together with their placement. Detailed field paths,
source offsets and geometry Evidence IDs are in
[IGZ_GEOMETRY.md](../tools/IGZ_GEOMETRY.md). The offscreen tests cover camera,
selection beyond table pagination, XYZ snapping, linked-part movement and
untouched-coordinate preservation. These are editor rendering observations,
not in-game rendering or gameplay observations.

UI level-select strings reference various level resources. They are not enough
to prove how to register a new slot. Gameplay logic includes serialized ScriptSet
and operation objects, not a set of loose Lua/JavaScript files ready to edit.

## Concrete built experiment

`recipes/crossfire_layout.json` contains four newly chosen coordinates and named
selectors, not game assets. Built locally into `builds/crossfire-layout/`:

| Artifact | SHA-256 |
| --- | --- |
| Original challenge inner IGZ | `de0ecd5bc5f5f2b3d99ec81592e8fef97a3228e6777e99f1c169e6cd584e7a32` |
| Edited inner IGZ | `3522603054c886f0beca68cf80da28e7cf3ac9483abdf05b8bea7df24ee3da2f` |
| Original outer archive | `e299b98dda727e610a08b22ba008eee31bde42e1b5cbc473b4cde1c34e0b26e0` |
| Repacked archive | `20a7ed9b21ed067612420c00e9a005b1468f833a26bc8e9726735ddbacd2515a` |

Only 24 bytes differ in the inner IGZ, all within the four requested initial
position fields. Independent C++ extraction of the repacked member reproduces
the edited IGZ exactly. A separate real MCP integration changed one X component,
observed exactly two changed bytes, and rejected overwrites and stale hashes.
Neither experiment was run in the game.

## Required next gates for full level creation

1. Establish a working unmodified game/arena baseline with the user's runtime,
   required local modules, controller/portal arrangement and a disposable save.
2. Confirm no-op archive replacement loads, then verify one position edit is
   observed in actual gameplay. Log the exact emulator/build/hash combination.
3. Extend the supported read-only geometry decoder to verified mesh serialization;
   resolve collision authoring, object allocation, fixup regeneration,
   identities, dependency graph, script graph and slot selection with similarly
   specific evidence. Do not silently assume later Alchemy games share layouts.
4. Author a complete layout and encounter, then test traversal, camera, collision,
   spawning, completion and reload behavior. Only then label it a playable new level.

Existing static evidence does not establish those runtime outcomes. The full
new-level request remains open; the completed deliverable here is the documented
3D inspection/placement-editing foundation.
