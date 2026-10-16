# Independent demo chapter: load path and remaining contracts

Update2026-10-14: [NATIVE_DEMO.md](NATIVE_DEMO.md) records the now-playable
Gallardo grid sandbox and its build/start procedure. The plans below explain the
reverse-engineered contracts; earlier shell-only observations are historical.
Arbitrary mission scripting and a completion/reward flow remain unfinished.

This is a source-bound plan for `Level_900_AIWorkshop`, not a claim that a
renamed archive or editor scene is playable. Static findings below use the
supported CUSA00697 ELF and owned files. No original archive or save was changed
by this investigation. The separate initializer/global drafts add the title,
load string and nineteenth story include; they do not supply these other parts.

## Actual load route

The chapter-select script has an explicit load operand chain:

1. `misc/ui_levelselect.bld` inner script `#2174`, row 358 calls
   `Level - Load - Load to Level`. Row 360 supplies
   `item data.level data.level loads` followed by EXID member
   `(1216469057,1549491124)`. The member's identity is not inferred from its
   position in that expression.
2. The actual global macro is `#23058`, script `#22673`
   (`Spyro_AdventureData.ai`), row 233. Its row 250 writes the requested
   `StringInfo` reference to global `ScriptReference #23081`, `Change Level`;
   row 252 writes `level progression data.current level load request`.
3. Native `0x400190` accepts a path string, splits `+`-separated segments,
   constructs `.arc` and `.bld` names, and mounts/loads them through the archive
   subsystem. For the `.bld` route it constructs mounted paths using **`:/`**,
   loads the selected language's `.pak` before `level.bld`, and registers the
   language roots in the `level.bld` namespace with IDs `index+1`.

The native function is established by REA evidence
`ev_8b36fd674aa40683b056c7e0d41a8be174dac9949572b8b41460e5ed979f0513`,
with `.arc` and `.bld` cross-references
`ev_1af4dbe737cc12a6c3193d660d383d4acbf2aa48ef648dcf79b27c6b6d04ed5f`
and `ev_b4359ed1f0841a303482c71d1837a3883f6674b530ccbaf0958f1f2e05657768`.
The original file bytes at virtual `0xce2530` are `:/\0`; this is an archive
mount path, not a loose filesystem subdirectory.

Native `0x401540` supplies `level/` when the requested string has no slash;
`0x402310` polls the pending native request and dispatches through `0x401770`.
Evidence `ev_a3faf4b578ad97dde2249e53cdd161ad6163bd7cf92d4e4ab63638ac7982369c`
and `ev_d1757a4e49f110c6c271f10bfb1373aaa23f7dd0eca1b712bb6b5560c0e58ad4`
is retained in bundle v10. The exact script-reference-to-native-pending-request
assignment remains untraced; the overall route now has operational evidence:
`builds/runtime-chapter-ui-02/emulator.log` line2093 opens
`/app0/level/level_900_aiworkshop.bld`. The chapter-select entry loaded an intact
Arena303 shell at that independent name, spawned Food Fight, allowed movement,
and returned through chapter select into Soda Springs. This establishes loading
and unloading of this shell, not a completed Gallardo chapter.

`.arc` is not universally mandatory: the existing `arena_mesh_303.bld` has no
sibling `.arc` in this owned extraction. Its archive has only one member,
`level.bld`. The inspected `arena_challenge_303_000.arc` has 18 audio members;
its `.bld` has inner `level.bld` plus ten language packs. Keep the actual donor
resource graph intact until a verified smaller closure exists; do not assume
the `.arc` contains collision or that a missing sibling is always an error.

## Chapter-selection data beyond the title/load pair

All indices below refer to the **original** inner files, not relocated RVTB
indices in drafts.

| Consumer/source | Exact original data | Consequence for appended title index 22 |
| --- | --- | --- |
| UI script `#2174`, row 63 | `OpLoopValue #3142` uses direct integer 22 via RHS `#3143`/stack `#3144` | The available-level loop must include a 23rd entry. |
| UI row 55 | Description selected from `ScriptSet #2250` → list `#2251`, 22 strings, using adventure `id` | Add the authored description at the needed slot; verify final ordering/ID semantics. |
| UI row 56 | Button selected from `ScriptSet #2280` → list `#2281`, **23** actors, using the title-search loop index | Slot 22 already exists; no blind actor clone is needed. |
| Global loadscreen macro `#25067`, rows 870–878 | Title/load, thumbnail and backdrop sets are assigned to progression data | Separate loadscreen dependencies exist. |
| Global `LevelBackdrops_S #2022` → list `#2023` | 22 sprites in title/load order | Supply an explicit 23rd backdrop or prove a fallback. |
| Global `LevelThumbs_S #2030` → list `#2031` | Empty in the original | Do not invent a 22-entry thumbnail array. Trace the consumer's existing empty-set handling. |

RHS `#3143` is shared by three operands: the available-level loop and two
`OpCheckValue` objects, `#4263` at row 456 and `#4353` at row 508. The latter
test `adventure.id < 22` for title-number/villain display branches. A narrow
loop extension must clone its literal wrapper/stack and redirect only the
loop, preserving those checks unless a separate policy intentionally changes
them. The original wrapper's serialized reference count is three and exactly
three ordinary incoming slots were found.

The existing 23rd button is actor `#3098`, `Level Select Button 023`.
Its model references `UI_SKY4/Screens/LevelSelect/Level_024.mdl`, mesh
`level_024.ma`, and `ColorMap#level_000#11`. These identify an existing generic
art candidate, not newly authored Gallardo art. Its dependency inspection has
external shader/resource handles and unsupported raw spans; retaining this
already-contained actor avoids inventing a cross-file transplant.

## Minimal sky/sun/start/camera donors

The arena mesh package is the smallest already-inspected coherent world shell,
not a ready-made flat chapter. Its inner hash is
`7488dc91cbb5e801c2d47f13e84c14df6d0724ecf61a579179fcea386dc97899`.

| Role | Exact source objects | What is established |
| --- | --- | --- |
| Visible world | `tfbPhysicsWorld #1`, `Levels/Level_303/Level_303_Arena.ma` | Existing static render chain; geometry and collision are separate. |
| Collision | `tfbPhysicsWorld #1317`, `Level_303_Arena_Collision.ma` | Contains the separately parsed Havok/MOPP graph; not an arbitrary floor builder. |
| Sky | `tfbPhysicsWorld #1323`, `Levels/_SKY/SKY_earlyMorning/SKY_earlyMorning_303.ma` | Root-owned sky world with its own rendering resources. |
| Environment | `tfbMoodBoxInfo #1437`, `_default_` | Enabled, box `#1438`, environment map `#1440`; blend/activation is not simulated. |
| Directional lights | `#1845`–`#1848`, `_worldLight1/2/3` and `_causticLight` | Native-backed light fields exist; preserve their resource/activation context. |
| Initial location script | Actor `#1708`, `_init`, owns script `#1641` | Startup calls `Level - _Level Defintion`; the global macro invokes the player-interface initialization route. |
| Camera | Actor `#1639`, `_camera`, owns script `#1550` | Startup defines camera ID 900 and transitions to it on gameplay layer 0. This 900 is a camera argument, not proof of a chapter ID. |

The initial actor's native-backed position fields are approximately
`[-396.673, 1.293, -67.826]`. The challenge's separate
`DEBUG_Arena_Warp #25728` is approximately `[-395.968, 1.750, -68.658]`.
Challenge script `#25711` row 11 calls `Portal - Warp Player to Location` and
row 15 supplies that exact actor; this is stronger evidence than the marker
name, but the branch is not a verified unconditional spawn route.

Global macro `Level - _Level Defintion #22677` makes the required initialization
contract concrete: rows 83–84 add init points, rows 94–107 choose an init
location, and rows 125–130 invoke `Portal - Player Interface - Init Level at
Location`. Rows 177–178 assign objective and area-name references; rows
180–182 assign fall-recovery plane, enemy count and target time. Row 187 calls
`System - Set Up Level Objectives`. These parameters must be deliberately
configured for an empty demo, not inherited unexamined from an enemy arena.

No separate navigation-mesh class appears in the type tables of these two
arena inner files. This bounded observation does **not** establish that the
game needs no navigation: the challenge also contains actor waypoint fields
and named ramp smart-path actors. Enemy pathing remains a separate contract.

## Construction order and acceptance

Runtime identity finding: the new story is adventure ID18, while its appended
title/load pair remains index22. Existing expansion IDs18..21 become19..22.
Descriptions must therefore insert at18, not append. Four initializer villain
index operands and UI expansion/display thresholds must change in coordination.
Seven save arrays use adventure order and require explicit element remapping;
difficulty tracking retains its original pre-order segment offsets, with the
new chapter at66..68. The first layout-only migration did not preserve this
semantic identity and must not be used as a compatibility example. The corrected
candidate is `builds/checkpoint-chapter23-identity-01`; see WORK_STATUS.

1. Finish the UI extension and explicit backdrop policy, without changing
   existing chapter identities or silently shifting localized strings.
2. Establish a new archive name using the coherent existing shell before
   reducing it. Preserve loader/mount/language behavior and inspect all
   external references. Replacing a donor chapter is not the acceptance test.
3. Author render floor **and matching collision**, explicit sky/light state,
   player initialization and camera. A decorative Gallardo model is not a
   drivable vehicle unless its control/physics contract is separately built.
4. Add an explicit exit action using the known global load-to-level macro.
   Merely returning to the hub must not be mislabeled as chapter completion;
   completion flags, objective processing and progression require their own
   script contract.
5. Test select → spawn → ground contact → traverse → exit → reload in the
   isolated runtime, then completion/save compatibility separately.

The original hub-lighting array has 19 includes for 18 story-order includes;
the appended story can address the remaining slot under the recovered index
expression. This is **hub presentation data**, not a substitute for the new
level's actual sun, ambient, fog and mood-box resources.

## Reproducible private evidence

`research/demo-chapter-probe.mjs` emits a new source-bound JSON report;
`research/demo-chapter-read.mjs` prints selected row ranges. The current report
is `research/demo-chapter-source-plan-v3.json`, SHA-256
`e3c1c56520a31ff16c65a66376a3f4dfa8ca6833e3a08565d8e0fbd74aca3c14`.
It records source hashes, object IDs, field evidence and symbolic operands.
Bounded expansion frontiers remain explicit; it is not an executable script
or a resource-closed module recipe. Do not distribute this private report or
the extracted game resources.

The relevant original UI inner hash is
`bf0879a08c951f5b2e44bdd81c0b5cebbfe9b79bdd8bbe3d3bde666d64b65f6a`;
global is `c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c`;
initializer is `2d1fabe7de81e6057b676909ecb58c56883bd825ba99b274f45ab38860f989e7`;
challenge303 is `de0ecd5bc5f5f2b3d99ec81592e8fef97a3228e6777e99f1c169e6cd584e7a32`.
