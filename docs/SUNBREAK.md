# Sunbreak Causeway development

Private source-bound continuation for the user's extracted CUSA00697 copy.
This record is not an assertion that the final mission is complete. Do not
distribute rebuilt archives, extracted assets, profiles or evidence containing
proprietary payloads.

The newest fix is [Return without the campaign cutscene](#return-without-the-campaign-cutscene).
Older probes below retain their original limitations and failed outcomes.

## Isolation and registration

Existing sandbox: chapter19, adventure18, `Level_900_AIWorkshop`; unchanged in
`builds/runtime-chapter-01/CUSA00697`. New mission: chapter20, adventure19,
`Level_901_Sunbreak`, in a separate full game copy
`builds/runtime-sunbreak-01/CUSA00697`. The new copy retains the sandbox archive
byte-for-byte. Source game files and existing checkpoints are untouched.

`research/register-sunbreak-01.mjs` accepts a fresh output directory and exact
previous23-entry archive revisions. It extends global title/load/backdrop lists
to24, adds global names3050/3051 (ROOT3026), adds a story initializer include,
and clones a private24th UI button/collision/parameters. It preserves the old
shared literal18: changing that globally would break Gallardo's access/star
rules. New difficulty slots69..71 do not overlap Gallardo66..68. Original
expansion difficulty slots remain54/57/60/63 even though adventure IDs move.
All ten dictionaries are rebuilt from original allocations; all final archive
members are independently extracted and compared.

Successful build: `builds/chapter-sunbreak-registration-02`. First trial01 failed
on the language object's ID field (+36, not+32); it was not installed.

| Initial registration target (historical, superseded below) | SHA-256 |
| --- | --- |
| permanent/global.bld | e50533d41d49b13e07f19f6e09a3f4d4cedd0c896ed18ab53b4ad3a741031ca5 |
| character/init_setup.bld | f0c29d18e7f2b73a9affbf110921d541c9091e4af5ebaf678554f9ceb89cc67b |
| misc/ui_levelselect.bld | 9a5d608b94e18999b8bc4bfce2a75444c80cb6f17cf54c4f817e8751b3d2176f |
| level/level_900_aiworkshop.bld (unchanged) | c53b7cb08a326ad15b0e840448f48ddb8730310d4068bd97c80ec23b8924b518 |

`research/install-sunbreak-registration-01.mjs` is a one-shot, exact-input
installer, not an idempotent updater. Backups are retained beside all targets.

## Save migration

Read-only engine measurement: `runtime-sunbreak-fresh-01/save-layout-24.json`,
SHAa1eef52df5009252863f2789ea131b8331bab1fafe81635d3072fe2cd8ddde48.
Slot:8163 assigned bits,1024 payload bytes,1028 including checksum.
Header:2995bits,376+4bytes, unchanged.1065 source-bound read proofs.

`research/derive-sunbreak-checkpoint-01.mjs` copies
`checkpoint-native-gallardo-menu-01` to `checkpoint-sunbreak-identity-01`.
Seven adventure-indexed arrays move indices19..22 to20..23, retain0..18,
and zero-initialize new19. Difficulty data keeps its existing prefix and adds
three zero slots. Header last-chapter fields were all0, so no identity shift
was necessary. The migrated profile booted to the Academy with Food Fight,
100%/180stars/rank40. These global old-profile totals do not prove the new
mission is complete. Chapter-menu screenshots000005/000006 in
`runtime-sunbreak-menu-01` show distinct19/20 titles.

## Initial native completion experiment (historical)

`research/build-sunbreak-goal-probe-01.mjs` builds a fresh output directory.
Successful output: `builds/sunbreak-goal-probe-02`.
Inner: d12cb0de7445e0f7196fb30c386fbebca14256d834cde18f16da9fe6bc0915b8.
Outer: 8335ab9a0607e063eed7a58b5058dc837ce9bf816de6aaed9822034fdc592f3c.
This still contains the original Arena303 geometry. It is not the new map.
Its goal actor is at[-390,1.293,-67.826], trigger radius5feet. A conditioned
ValueStack measures Player1 distance from `my`; LT leads to the game's
LevelEnd macro with Village as destination, then removes the controller.
Actual execution/save completion is not yet established.

The new `tools/igz_types.mjs` appends TMET/MTSZ declarations without changing
old type indices. Three synthetic tests pass; declaring a type does not prove
native runtime support. PositionStack is40bytes in the original global file.

Native evidence (ELF423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3):

- Distance getter0x476440 multiplies meters by3.28084: ev_1273ed1d7ced94fc5e75a2d89cb44ee37d5398ecb0c3519c97dd85e4375d477f.
- ValueStack conditioner+40 evaluates PositionStack before the measurement:
  ev_783b1fb2b81bcf3d42a30df10c6c40ac1e03615ebceb21bb28783ae1df3f1990.
- RelOp enum LE0/EQ1/GE2/LT3/GT4/NE5:
  ev_e1147d40e866f6d375a541e2721133de67ad27cc11122dcba2731f4ecd393d25.
- Global script22673, LevelEnd macro23245, load parameter25130; use the original
  parameter binding, not an invented opcode. Completion flags and the end
  screen require runtime verification, not just a static macro reference.

Bundle: `research/rea-evidence-2026-10-14-sunbreak-v1.json` (354records).
The first goal build failed the archive packer's source-stability check on
the network filesystem. Explicit fsync of the new inner file fixed trial02.

Only the never-loaded901 archive was replaced while the owned session was in
Chapter Select from the Academy. The exact process/game, source/target hashes,
target inode and no-open-file preconditions were checked. Registration archives
were never replaced while running. Absence of an open file alone does not
prove a previously loaded level is safe to replace.

## Current runnable build

The latest native acceptance is mission09 with progress UI01 and objectives
UI01. It is a short traversal mission: visit west and east rocket relays, then
the large beacon. The chapter has newly composed native geometry, real donor
materials/sky, matching walkable BOX collision, three native objectives, a
gated finish and real saved progress. There are no combat encounters or
collectible rewards in this recipe, and no general-purpose AI chapter compiler.

On the prepared workstation, from the project directory:

```bash
node tools/play_demo.mjs --sunbreak
```

This starts a NEW profile copy with Sunbreak unplayed and the older campaign
already progressed. Accept the title/save-slot/Story screens, wait for the
Academy, then terminal `chapters`. Wait until Chapter Select displays chapter1,
enter `sunbreak`, inspect chapter20, then `enter-chapter`. `quit` stops the
owned emulator and saves a profile checkpoint. Inputs are acknowledged but
menus are not automatically recognized. Do not issue navigation during loads.

Open the GPU editor directly on the matching overall view:

```bash
editor/build/skylanders-level-editor --renderer gpu \
  --camera-json '{"pivot":[-423,100,-73],"yawRadians":-0.4,"pitchRadians":-0.85,"distance":64}' \
  builds/sunbreak-mission-09/level.bld
```

This is the inner IGZ, not the outer `level_901_sunbreak.bld` archive. The
viewport uses original textures and an adjustable editor light rig; it does
not reproduce all native shaders/lighting. The corresponding private capture
is `research/sunbreak-mission-preview-08.png`:73 actors,77 mesh buffers,
61 textured meshes,30 textures, hardware OpenGL on the AMD7900XT. Its report
explicitly states `nativeLightingApplied:false`.

### Rebuild from your own extraction

Follow [setup from your own PKG](SETUP.md), using the same supported CUSA00697
01.00 revision. The source tree and generated local content are separate; do
not distribute the PKG, extracted assets or generated `.bld` files. The new
build command does not need any files from this machine's `research/` directory:

```bash
node tools/sunbreak_build.mjs \
  --game /path/to/your/original/extracted/CUSA00697 \
  --output /path/to/private/new-sunbreak-build
```

Use `--extractor /path/to/iga_extract` if the archive tool built during setup is
not at `tools/iga_extract`. This is the project's IGA extractor, not the PKG
extractor. The command hashes four ORIGINAL archives, extracts their inner
members, composes the world and scripts, rebuilds the mission/result archives,
then independently extracts the outputs and compares their hashes. It refuses
unknown revisions, occupied outputs and outputs inside the source game tree.
Allow at least1GB temporary/output space; Soda's inner file alone is389631288
bytes. Source assets remain private inside the new build directory.

Verified output `builds/sunbreak-repro-03` reproduces mission09 and objective
UI01 byte-for-byte. Repro02 retains the previous mission08. Repro01 stopped at an overly small256MiB input bound when
reading Soda; the bound is now512MiB and the failed output is retained.

**Building the two archives does not register the chapter.** The matching
24-entry setup additionally needs global04 (including3052..3054), initializer02,
progress UI01, the unchanged Gallardo900 archive and a matching24-entry save.
The source-bound registration/migration sequence is documented below. Do not
drop these files into an unmodified22-entry installation or reuse a22/23-entry
save as if its bit layout matched. The complete install remains a guarded
research workflow, not a portable one-command PKG-to-new-chapter installer.

## Acceptance checks

- Native new geometry/layout, materials and main-route collision: verified in world02 and probe06.
- Local objectives, native completion/save/reload and relay reset: verified in runtime11/12.
- Old sandbox and original Soda Springs load in the24-entry copy: verified in runtime08.
- Reproducible mission/UI build, launch/editor commands and captures: provided above.
- Native chapter-menu completion display: verified in runtime08. Independent
  portal-master star accounting remains open; the original gold icons were
  caused by overlapping original collection indices, not empty objective lists.

## Return without the campaign cutscene

Mission09 changes only the independent Sunbreak archive. The normal native
result screen remains; Continue returns to controllable Academy gameplay
without the campaign-ending party. No global cutscene disable, save-byte
patch, original chapter edit, or hub archive replacement is used.

### Cause and narrow fix

The source-pinned hub script `_Level_Def_Hub2014.ai` (object28090) counts
completed `story adventures` at rows2–3, clamps the count to18 at rows4–5,
and checks the last completed adventure's transient `complete == 2` at row6.
The selector's external name ID1675745305 matches the native naming hash of
`last`; the graph retains the raw pair rather than claiming full set semantics.
That means a newly completed appended story chapter can be mistaken for a
new original campaign milestone. Rows7–13 consume the notification (2 to1)
and set `First_Time_Here`. The first-visit block at row71 selects the
`Hub18_Intro_Director` at rows185–186 for the clamped count18. This is the
party shown after the previous Sunbreak completion, not Sunbreak's own movie.

The native global `LevelEnd` macro sets `adventure.complete` to2 for a first
finish and1 for an already-completed adventure (global script22673,
rows429–481 and592–644), while updating the normal saved flags. Mission09
adds a guarded native assignment **after that call returns**:
`if this adventure.complete == 2: this adventure.complete = 1`.
It uses global name1730 (`level control data`), the native `level adventure
data` member and `complete` member. It does not manufacture completion:0
remains0, and the change is reached only after the gated beacon's LevelEnd.
The real objective completion calls, result UI, save process and chapter-menu
completion icon are unchanged. Original mission scripts are untouched.

Static authority: original hub inner SHA
`fe70e1440a3832f6d6d4c261d64aa27a5c538a06ee76ffce9a87c3dcb6c82855`;
private graph `research/sunbreak-hub-return-01/graph.json`, SHA
`f7caa531a428ce5c9863f14bdf67b12b5e52bd31716a00f5686fb595a7549d6d`.
The graph is partial, not original script source or an execution trace.
Query with `node research/read-save-index-graph.mjs '' --hub --script=28090 --rows=0:18`.
The existing global graph and native REA evidence are reused: OpSetValue
`ev_2d7c1a4b06d36f40044636e1d16e51deed715f02af941539853749d71b9980ee`,
OpCheckValue `ev_2c88a29517b630dab0677b08161c134fe0f6a55f0304e67ed02f8a6a7446f26e`
in `research/rea-evidence-2026-10-14-sunbreak-v5.json`.

### First-play runtime verification

`builds/runtime-sunbreak-nocutscene-01`, controlled by `runtime-control-07`,
starts from the unchanged unplayed `checkpoint-sunbreak-identity-01`.
The11-pulse route took17.260s. Result PNG000005 shows all three goals newly
completed. Read-only, doubled memory samples at that screen show adventure
ID19 and `complete=1`. The profile on disk is not yet updated at that point:
wait for Continue and the native save, rather than interpreting an early
zero as failure or editing it manually.

After a single Continue, PNG000006 shows ordinary Academy gameplay, not the
party. A500ms stick pulse moved the player from
`[2.057358,-1.017829,38.702229]` to `[2.049049,-1.223184,35.309052]`,
confirming control. Slot1 then has a valid checksum, flags229377 and
objectives7 for adventure19. The1309-field comparison against the baseline
changes only these two Sunbreak fields and village variables29/30/34/36/39/40;
all original chapter arrays and global collection fields match. The chapter
menu also shows Sunbreak's completion icon (PNG000008).

| Mission09 evidence | SHA-256 |
| --- | --- |
| Inner level | `f84806dfc61170c09c59729ed6e7b86c1d163d6ca0cb13607932ea0ccc69324b` |
| Installed/reproduced archive | `cac1da3a2ac461d51203129f7e15b954518c0cfbc8cb392427215058503ca891` |
| First-play results PNG000005 | `7e16229ecea9b49bd5372a6dc6b8df96f7eb27fe82efacb5d71347c9c9b6566d` |
| Academy without cutscene PNG000006 | `36eb7f114dc04599bf8a9f2673a4fddedd4027a8cba3cc2afdd4595a24e6d2a1` |
| First-play saved slot1 | `8234c526e410a85ded12213ef1b241442ac400d9fdc677925ce8d672e899110d` |

Build09 and portable repro03 independently extract to the same inner bytes.
Eight selected mission/UI/build tests pass, including the guarded2-to1
assignment, exact member names, post-LevelEnd placement, branch targets and
reference ownership. The previous installed mission08 is recoverable as
`level_901_sunbreak.bld.before-mission-09`. The extracted hub is research-only.
Other campaign progress states and a general separation of custom chapters
from every hub progression calculation remain outside this tested correction.

### Replay and checkpoint

The same session re-entered chapter20 through Chapter Select and completed
the reset relay route again (11 pulses,17.283s). PNG000009 shows all three
replayed goals in green. After Continue, PNG000010 again shows normal Academy
gameplay, with no party; another500ms stick pulse moved the player from
`[2.057382,-1.017858,38.701664]` to `[2.049038,-1.224099,35.293869]`.
The owned emulator was then stopped cleanly (exit0) before creating
`builds/checkpoint-sunbreak-nocutscene-09`. This is a saved-profile checkpoint,
not an emulator RAM snapshot. The controller daemon was also shut down.

Final slot1 SHA:
`efb30c1bcd34de303d1f11234e78f7aae364699753c96c93947976b452e0ede7`.
Its valid-checksum1309-field comparison against the unplayed baseline changes
only Sunbreak flags0→229377/objectives0→7 and village variables34/37.
Old campaign progress, Gallardo and global collections remain unchanged.
The previous23-entry tree's global/initializer/UI/Gallardo hashes also still
match their pre-task values. Audit: `builds/runtime-control-07/requests.jsonl`.

Replay result PNG000009 SHA:
`7033985da250ad7b0d422eb51afaa347bc8ccd2cdf919b5252725e812be67adc`.
Replay Academy PNG000010 SHA:
`a520659311f5566d0778fb722a4db5b2c638922ce9b857ed5672c06ee3ce1c2c`.
All captures are in `builds/runtime-sunbreak-nocutscene-01/user/screenshots/`.
Full Node suite:319 tests,297passed,22optional skips,0failures. The eight
selected mission/UI/build tests also pass with private-source checks enabled.
No C++ code changed in this correction.

## Acceptance, 2026-10-15

The scope is a short original traversal mission. This is still in progress,
not a claim that all original chapter systems have been recreated.

Runtime08 tested mission06 and the separate progress-UI01 archive. The native
chapter menu showed Sunbreak20 with neutral stars before playing (PNG000003).
Ordinary controller input visited west/east/beacon and reached results in1:43
(PNG000007). Continue saved flags229377, but objective bits remained0 and the
story-goal card said **No Story Goals configured**. Thus clearing default
argument bit15 was necessary but not sufficient.

The additional source mismatch is now explicit: Arena303's My reference stack
and lighting ScriptSetList use the `tfbActorInfo` metatype. A list of objective
strings must use `StringInfo`. Mission07 clones Soda51856 and51858 with
translated RNEX identities. ObjectiveCompleted/LevelEnd caller stacks now
use StringInfo too. It also introduced a separate mistake: parameter+64 was
treated as a numeric mode and changed15→18. **That field is RNEX, not an enum.**
Arena15 and Soda18 both name ScriptSetReference in their respective EXNM
tables; Arena18 names ScriptStructure. Runtime10 finished but still had no
goals; a read-only native sample found `objective names` unbound. Mission08
restores the target's ScriptSetReference identity. Tests now resolve and check
its name, rather than asserting a raw number. Runtime11 now verifies this
fix: the live `objective names` reference points at `Sunbreak_Objectives`
with the three expected StringInfos, and the engine constructs three story
objectives. The result card shows all three checked. Continue writes objective
bits7 with a valid checksum. Native motion was11 controller pulses over17.314s;
the displayed5:39 includes earlier idle inspection, not a17-second game timer.
Checkpoint `builds/checkpoint-sunbreak-objectives-08` contains that genuine
finish and the emulator stopped normally (exit0).
REA parameter evaluator475130 is retained in
`research/rea-evidence-2026-10-15-sunbreak-v7.json`, Evidence
`ev_c529f6b27756c7f916782e6894f6c9abc8f7456c8214b41bb5f10e1e67625ff0`.
That decompilation distinguishes parameter evaluation paths; it does not by
itself prove the new chapter executes correctly.
The analysis was closed with a reusable snapshot at
`research/rea-session-sunbreak-2026-10-15.json` (673011bytes, one primitive query,
one evidence record; SHA08aa4a6ce689ed34b824fa9eb2b4dfc39d6c1b17727941611301f2cfe3e1b6be).
It supplements, not replaces, the earlier bundles. Reopen the exact ELF with
that `snapshot_path` when continuing the parameter-evaluation investigation.

Progress UI01 is runtime-verified independently of that goal bug. It guards
adventure19 and maps the first chapter-menu icon to `adventure.complete`;
the other icons remain neutral. PNG000012 shows the one real completion icon.
There are no save-writing opcodes in this UI patch. The180 portal-master bits
are **not** extended or remapped by it, so independent category/reward
accounting remains unresolved.

Afterward, chapter19 loaded its Gallardo and floor (PNG000014), accepted a
movement input, and original Soda Springs loaded (PNG000016). Runtime08
stopped normally, exit0. Its profile-only checkpoint is
`builds/checkpoint-sunbreak-complete-06`; this has genuine completion but does
not have the three story objectives. It must not be the baseline for proving
new objective awards. Use `checkpoint-sunbreak-identity-01` for that.

A full field-by-field comparison of slot1 against the identity checkpoint
found only Sunbreak's level flags and six village-generic variables changed.
Every old chapter's stored values, including the expansion arrays and the
180-star collection, stayed unchanged in this run. This is a preservation
check on the supplied profile, not proof of correct reward allocation for
an arbitrary partially completed profile.

Private runtime evidence is under `builds/runtime-sunbreak-mission-08`; the
request/response ledger is `builds/runtime-control-01/requests.jsonl`.

| Item | SHA-256 |
| --- | --- |
| Mission07 inner | `ed11142097d8761ba2195e66c482e956acf3c757a6bbef21b36f4a96b20bee54` |
| Mission07 archive | `310353bdbe25db05b79fabe7cab762835bde27a2e55d0630a8a26938dfde0d73` |
| Progress UI01 archive | `444bad10f2ce1c9d572e60c4ab7a7e1cadf9eff46b1778b6ea87e59149c36370` |
| Runtime08 saved slot after finish | `6463947af4523b14c9ef0d9b7fa35610c19c617dfcdb0cff2def1b3667db1920` |
| Runtime08 results PNG000007 | `6f57ed058fd9c118dc461ea84de870cf69ce121d6f28551738392741f9218b5a` |
| Runtime08 completed menu PNG000012 | `58c63b980955b84bfdbffd5cd3a0c48f35476ba8ac717ffc8ebf46c262fc3ef7` |

### Mission08 objective acceptance

Runtime11 uses mission08, global objective strings04 and progress UI01.
Its ledger is `builds/runtime-control-04/requests.jsonl`. The read-only
`research/probe-sunbreak-objectives.mjs` resolves the live global ROOT and
`level control data` afresh; it does not reuse earlier process addresses.
All reads are doubled and compared, but are not a single atomic snapshot.

| Item | SHA-256 |
| --- | --- |
| Mission08 inner | `02a53acd53c1d7c0487c445bdcfc5a8232c3cdc3f37e8333367f52ee53593e03` |
| Mission08 archive | `d1f6b841a375764c3b308f6c3f4232880ab5a3f60646837eb690273a0aef5fb3` |
| Runtime11 story goals PNG000006 | `3ef4ea5181cf207da555d29370d57a2c75564c71fc05ccd5b0df42a219dbb365` |
| Runtime11 saved slot | `936f8ebcb00ce0c8a6738a183ca211fd8f715a65783445756035d838956896ea` |

The inherited results UI still constructed2000-enemy and nonexistent collectible
goals. `tools/sunbreak_objectives_ui.mjs` preserves the original story-objective
loop and uses an exact adventure19 guard to skip that common-category section.
It sets one tab using the existing UI setter and skips the old portal-master
star-write block for this ID. It does not invent collectibles, edit completion
bits, or allocate new global rewards. Every old opcode remains in order, and
six enclosing branch spans are adjusted. All other IDs take the original path.
Private structural tests verify those paths and targets. Runtime12 confirms
the one-tab native result and preservation of original Soda's four-tab view.
Rebuild with:

```bash
node research/build-sunbreak-objectives-ui.mjs builds/sunbreak-objectives-ui-NEW
SKY_SUNBREAK_UI=1 node --test tests/sunbreak_objectives_ui.test.mjs
```

Output01 inner `e0a093bcaa202923cf68128736d970edb221782615d02931e569663de60d1700`,
archive `5eaf739fe95bd81fe2ab0a639aa631cf1f1c51423e0f8fe0113c91e592a939de`.
The stopped-game installer retains `.before-sunbreak-objectives-01` and never
changes the original23-entry tree. Installation helpers are one-shot and must
not be rerun blindly. Use `research/compare-sunbreak-saves.mjs BEFORE AFTER`
to compare every declared slot1 field against the pinned24-entry schema.

### Restart, negative case and replay

Runtime12 starts from the genuine runtime11 checkpoint. Chapter20 displays one
completion icon after a process restart. On re-entry, the two local relay
values reset: the `beacon-first` route reached[-420,100.010002,-51.96685]
without ending the level (PNG000005). A read-only inspection found0 current-run
completed objectives. Only after visiting both relays did the native result
appear, with the three story goals and one category (PNG000006). Saved bits7
persist; the faster run adds the native time flag,196609→229377.

Then original Soda Springs loaded (PNG000009); Pause → right twice → Objectives
showed its original two story goals, four tabs and30/30 enemy goal (PNG000014).
The Sunbreak filter did not apply to it. Checkpoint:
`builds/checkpoint-sunbreak-replay-08`; audit: `builds/runtime-control-05/requests.jsonl`.

| Runtime12 evidence | SHA-256 |
| --- | --- |
| Reloaded chapter20 menu PNG000003 | `9a9e9324f0fa456bb25f29a59ab02ff7e251eb3e072c380aa5c7a35b4730a0f9` |
| Beacon-first negative PNG000005 | `2099e302e021313fef6211b065e9868b86184215a93af70f10fb275dd182e83e` |
| Clean native result PNG000006 | `ce966df76d9cc540fd37663580b0d967773e75b9157ba8ccf375472fb13955f7` |
| Original Soda objectives PNG000014 | `7eff4b56fcd2f5beec5fd06ada2fa8b7801ba1b228833116a8bf94af00624013` |
| Saved slot after replay | `525dd66a9e771835fbb14712efd2d203b41495ff6bf6b1884623d2c9cd09270a` |

Field comparison of1309 declared entries found only Sunbreak's level flag
and six village variables changed during the replay; objective bits7 remained.
All old chapter arrays and the original180-bit star collection stayed unchanged
in this supplied profile. An independent new portal-master reward is not awarded
by this recipe; its visible completion star is chapter-local feedback.

### Final first-play acceptance

Runtime13 starts again from `checkpoint-sunbreak-identity-01`, not the completed
checkpoint. Chapter20 has neutral menu icons (PNG000002). The full controller
route uses11 pulses and17.193s, reaches the native one-tab result, and shows all
three goals as newly completed (yellow, PNG000004). Continue returns to the
Academy (PNG000005). The valid-checksum slot stores flags229377/objectives7.
Compared with the unplayed baseline, all1309 declared entries differ only in
those two Sunbreak entries and village variables37/39. No old chapter or global
star entry changed. Final profile checkpoint:
`builds/checkpoint-sunbreak-accepted-08`; audit:
`builds/runtime-control-06/requests.jsonl`. No gameplay memory writes were used.

| Runtime13 evidence | SHA-256 |
| --- | --- |
| Unplayed chapter20 PNG000002 | `2cc872b2f6677bbe00f482e07c9c85ffaa9116c9df8028af6090be2fe700f48c` |
| Three newly completed goals PNG000004 | `4eb5362f99be284a7a075b28b9e71a38671abdaf8845962cc6dc7ed6983d7daf` |
| Return to Academy PNG000005 | `b743527c9701289598861757df5de9a950a73ef99fc20a96cb14aa5bdbc496e3` |
| Completed slot1 | `d2fbcdf8121661f82cb94a5f64b75a40f98a197f113510ba7c80346c25a6d93d` |

Validation after these changes:319 Node tests (297pass,22optional skips), eight
selected mission/UI/build cases with private checks enabled, and7/7 CTests
including hardware GPU rendering and asynchronous initial-camera preservation.
The earlier runtime09 died during emulator startup with a host allocator error
before level loading; retry runtime10 reached gameplay. Its log is retained,
and that startup failure is not evidence of an IGZ loading regression.

### Faster local testing

`research/runtime_probe_daemon.mjs launch builds/runtime-control-NEW` starts
a detached local controller, without launching a game. Its Unix socket is
0600 inside a0700 temporary directory; there is no TCP listener. Use its
`call` subcommand with `{"operation":"start","arguments":{...}}` and the
same explicit options as PortalController. Every request and result is
recorded privately. `checkpoint` stops the emulator and captures a profile;
`shutdown` closes the controller. A timeout is not permission to repeat an
input: inspect the audit and status first.

From an observed untouched Sunbreak spawn, this bounded route reads the
owned player's coordinates and delivers controller pulses, with no RAM writes:

```bash
node research/walk-sunbreak.mjs builds/runtime-control-NEW full
```

The `beacon-first` variant tests the negative branch without activating the
relays. After inspecting that endpoint, `relays-after-beacon` visits both relays
and returns to it. None of these routes detects UI success: inspect a fresh native frame
and the actual saved objective bits. Menus/load transitions are not inferred
from input acknowledgment. Wait for Chapter Select at1 before navigating19
steps to20; premature inputs previously selected17 instead.

## Acceptance, evening 2026-10-14 (historical)

Mission04 completed through ordinary controller input in
`runtime-sunbreak-mission-05`: west relay, east relay, then the beacon. Native
results screenshot000004 has SHA
910e112b07b904ecbc8daecbdf5afdd0e3171b4536492fff71fef67c69397459.
Continue returned to the Academy; the completed slot1 SHA is
f9b1280bf105d83a8b4189cf5ca7a9a3bdcf2123353efe4e2d9c104b699680e7.
Sunbreak level flags changed0→196609, with objective bits still0. The original
Soda/Gallardo values in the read-only report are unchanged. Mission04's earlier
negative test reached the beacon before visiting the relays without finishing
(`runtime-sunbreak-mission-04`, screenshot000003 SHA
31c3bd4c1d8ce749823225067c43b105746a914def8fbf90f15b550e965ec533).
This establishes the three-station finish condition, not correct objective UI.

The objective issue is now source-explained: native474ef0 replaces caller
OpMacroParameter rows carrying flag0x8000 with the macro's default parameter.
Changing only their RHS is ineffective. Both the level-definition objective
argument and the three ObjectiveCompleted call arguments must clear this bit.
REA evidence ev_714a7a055a77159520cf4ff114fac6740e2d7d97fe11a4b7d8aac9882166ec42
and dispatcher ev_5a6a79934f05fbf8c3b934d651cd3c9e6cb958e7256c7d52313d0c83083356c6
are in `rea-evidence-2026-10-14-sunbreak-v6.json` (2 records from a new session,
not a replacement for the389-record v5 bundle).

Mission06 clears all four explicit argument flags. Inner SHA
75f8256d5a3d92634bb0425cf24a5ebb0ca551b47d4843807c2ab2c112ad4d97;
outer085731d28238a16c7e1be1b746801bbfdb574e49b170dae45bf6e7d9333c9a7b.
It is installed in the isolated901 archive with a recoverable `.before-mission06`
backup. Mission05 was built but never installed. Private tests pass2/2.
Runtime06 loaded mission06, but was interrupted before traversing it; it does
not prove the objective fix yet. The world03 camera180 is native-tested and
looks forward along the causeway.

The earlier neutral-star claim is superseded: settled new-chapter menu frames
do show gold stars on the unplayed migrated profile. The profile retains all180
original portal-master stars. Static Get Adventure Stars computes adventure
ID×4 (global101341); the migration currently remaps adventure arrays, **not**
the separate180-bit star collection. Additional chapters therefore require an
identity-aware star policy; merely hiding the icon is not a save-layout fix.
Do not claim fully independent star accounting yet. Native results also retain
common collection goals (four chests etc.) absent from this traversal mission.

## Probe06: loading regression resolved, completion still open

The corrected big-endian type-layout hash was accepted by the native game.
`runtime-sunbreak-probe-06`, owned emulator PID1693770, loaded chapter20 with
the PositionStack declaration and goal experiment. Screenshot000002:
`CUSA00697_20261014_152238_388_game_000002.png`, SHA
51b6b436910764e949537d861050089bfa9ed52852fe4854887ab3a1121d0ed3.
Read-only Player1 was bound at[-420.60968,100.010002,-67.901237].
This is the script-containing build, not the earlier script-free control.

Input-driven traversal reached the test marker at[-416.802277,100.010002,-96.327202],
inside its5foot radius around[-417,100.05,-96]. No completion UI appeared;
screenshot000005 SHA75bec7dbb14fcd8385047f7469f99e130d5d14d7b8c48285eefedca684fa3361.
A fall below the course did respawn the player on Arrival. Climbing the step
from the reverse direction needed a jump. These observations establish load,
movement and a recovery case, not mission completion.

Probe07 separates a goal actor with an explicit OpUserBehavior from the Init
script. Native startup470940 selects the first user behavior at
`preScript.branchPC+1`; binding478820 fills its PC/script fields. The prior
probe had no user behavior. Whether this change alone fixes the goal still
requires a native test. Keep the distinction between this hypothesis and the
confirmed type-signature load fix.

The type-layout eligibility constructor default is source-backed:566870 sets
loader+10b=0 and+10c=1 (REA ev_efd9ee88b638af1d76bf267532c0944ef070ce62a98589393b19dbe13a92fc31).
However56acd0 overwrites them from load options+3b/+3c, so the constructor alone
does not establish the active profile (REA ev_aa332b2ebc5bb37f7251eb83adf331679459d1e2c5a5980f5e60f565a22ce684).
Zero-size property fields participate only when the resulting+10b is0;
static fields do not. The probe distinguishes these candidates explicitly.
OpUserBehavior metadata was sampled read-only from anchor1485b98 in probe06.
The runtime probe supports a complete metadata export for this type on future
sessions, alongside PositionStack, ValueInfo and OpSetValue.

Probe07 (property included, headera0417299) stayed in a rendered blank transition:
screenshots000003/000004 in runtime-sunbreak-probe-07 have identical
SHAd836dcbede7a62d30bd4f83b6de2139fdf42ff0e16ea4b8b8a45b413c4d3d536;
Player1 was unbound. Probe08 removes only that property from the signature
(headerfab058ac); only inner offsets8..11 differ. It instead stopped delivering
fresh game frames during load; capture timed out and Game:Main remained busy.
This distinction is not yet proof of successful loading or gameplay.

The probe's terminal OpFlowBehavior/branch65535 was not the original user
behavior's normal terminator. Soda script17919 row190 actually uses
OpFlowBuiltInBehavior, not OpFlowBehavior. Probe09 corrects that while retaining
the explicit skip-properties candidate. Runtime acceptance remains pending.
`threads` in the private runtime probe briefly stops/resumes only its owned
child, records Linux's thread PC/syscall data, and never writes guest memory.

`tools/native_sunbreak_mission.mjs` constructs two relay state values, three
independent native behavior owners, objective-completed calls and a beacon
LevelEnd call gated by both relay values. This is an experimental construction,
not a verified complete mission. Its private graph tests check behavior entry,
false-branch targets, ownership, zero initial state and objective identities.
`research/build-sunbreak-mission.mjs` uses world03's private180degree camera
heading. The camera's shared donor zero remains unchanged (new private test).

`register-sunbreak-01.mjs --mission-strings` additionally appends global strings
3052/3053/3054. Successful output04 global archive:
b2cb86c28b31454480a33eb7cc6ddb9afaee7fac8f8df5368e3a892bd9e5058b.
Its initializer and UI are byte-identical to registration02; it is not installed
yet. Registration03 failed before mutation because the name validator accepts
exactly two names. The caller now preserves that contract while validating
each additional objective against the preceding names.

Settled chapter20 menu frames in probes07/08 show neutral stars without any
additional UI changes. Earlier gold-star frames may have captured the carousel
animation; do not patch saves or declare a persistent star bug on that basis.
Latest native evidence export:v4,386records.

### Probe10: the new behavior loads after ROOT registration

Probe09 entered a CPU loop before binding Player1. Read-only samples identified
the current script as `AI/Sunbreak/Goal.ai`, with its user behavior still at
`_thisPC=0`, `_scriptInfo=null`. Main-thread PCs mapped to native477fd0 and
a605d0 (image bias400000). See `research/sunbreak-probe09-stuck-script.json`
and the runtime09 thread snapshots. This proves the new type was accepted;
it is distinct from the earlier header-signature rejection.

All3 Arena and all194 Soda tfbScriptInfo objects occur in ROOT. The appended
script did not. Probe10 changes only ROOT membership and the corresponding
ownership count/list relocation, retaining probe09's script rows and signature.
Inner8857b0a834386c56b4975f90eb1156d7c774a25bd1836a12c8e552b0298cb198;
outerab969256f834de9c932790b4799ed7af01b8184fed34e7e5a4c01b92ebdf8ee2.
Native runtime10 now binds Player1 at[-420,100.010002,-96] and captures fresh
gameplay: screenshot000003 SHAaeee82310625b6f776a35a9303c97d5d7c4f9cf08740970c0b2643fa8e4ddb2c.
This verifies the loading fix, not yet completion. The full mission builder
now roots all3 new scripts; private tests enforce this membership/refcount.
Mission03 and the objective strings still require the native finish/save test.
Evidence exportv5 contains389records. Loader finalization56a5a0 evidence:
ev_2b59eb495e46b1c34c4fd6406d2ea6f6ac217cc645a5ee803af3ee2ad62c7e79.

The probe10 goal then executed successfully. One400ms rightward input reached
[-418.294617,100.010002,-96], within5feet of[-417,100.05,-96]. The native
results screen appeared (screenshot000004, SHA3acc794de592b89397af8813fb08b85fe2330338e0fd7103d2bc149d643b6889).
After Continue, the game returned to the Academy. The checksum-valid save
SHA4bc6bf8f018b1c97d369b3ca4d4b36ed61642cff8212094379b97163478c81f8
contains Sunbreak adventure19 level-flags229377 (previously0); original
Soda/Gallardo fields are unchanged. No save bits were manually set. This is
completion of the small probe, not yet of the complete three-objective mission.

Objective global04 is now installed with a recoverable `.before-objectives-01`
backup. Mission04 also roots the two ValueInfo state objects, matching all55
original Soda ValueInfo objects' ROOT membership. Mission03 was built/installed
but never launched;04 supersedes it before runtime testing.

## World and isolation trials (continuation)

The chapter-20 registration/load route was verified independently by temporarily
installing the known-working Gallardo archive as901 in the disposable new tree.
`runtime-sunbreak-control-01`, screenshot000006, renders Food Fight, car, floor
and sky. This proves the new registration route, not the new mission. The
`/app0/misc/.bld` and `/app0/item/.bld` log errors also occur in this successful
control and are not by themselves evidence of a failed chapter load.

`tools/native_sunbreak_world.mjs` composes a new five-platform causeway from
Arena303's native stone rims, cliffs, machinery and original materials. New
deck and bridge meshes have metric UVs and explicit BOX collision. Source
sky, lights and all image payloads remain unchanged. Version02 uses narrow
rectangular strips to fill the circular platforms without protruding corners;
66 collision actors have both ROOT and active ScriptSetList membership.
Spawn is[-420,101,-96], main platforms atZ-94/-72/-50, side relays atX-436/-404.

Build: `node research/build-sunbreak-world-01.mjs builds/sunbreak-world-N` with
a fresh destination. Current tested build output is `sunbreak-world-02`:

- Inner:404ec208cb7fcd11d55ebc8cacc49af82bcde5ff1e641b9bee97258fe22b2332.
- Outer:1d4f69f3290380995fb35729b6695c604eefb95e14889c3da39ccfb8935382a3.
- GPU preview:`research/sunbreak-world-preview-02.png`; this is an editor
  preview, not proof of native playability or final visual quality.
- Private builder tests pass2/2, including byte-exact native textures and sky,
  preserved source UVs, active collision membership and source preservation.
- Full suite:310 tests,291pass,19optional skips,0failures.

Goal probe02 did not reach gameplay: the transition remained blank and the
read-only Player1 binding was null. Probe03 (new world01, proximity plus
RemoveMy only, no executed LevelEnd call) had the same outcome. Neither result
proves that LevelEnd is the cause. World02 is being tested without new mission
logic as the next control. Probe04, not yet tested, inserts the goal condition
into the existing Init script instead of instancing a new tfbScriptInfo.

`research/install-sunbreak-level.mjs SOURCE BEFORE_SHA AFTER_SHA LABEL` pins
the exact isolated901 target, requires no running emulator using that game,
verifies source/target hashes and regular-file single-link ownership, retains
the previous target as `.before-LABEL`, and rechecks old Gallardo bytes.
Do not replace a loaded archive in a running game.

`research/runtime_probe_server.mjs` now supports `player`: read-only samples
resolve the current global Player1 reference every time and validate the
actor vtable. Samples are non-atomic and recorded with hashes; no RAM writes.

### Native world acceptance and type-signature correction

World02 successfully loaded as chapter20 in `runtime-sunbreak-world-02`.
Screenshot000004 shows the character on Arrival, current position
[-420,100.010002,-96]. After input-driven traversal the position was
[-420,100.010002,-50.379002]; screenshot000006 shows the final rocket and
connected platforms. Thus the main route and collision run natively. Camera
heading still looks backwards along the route and needs a private correction.
Side routes, falling recovery and mission completion remain unverified.

Probe04 (existing Init script) also stayed in transition, screenshot000005
SHA2f0b01cc10e2f84aeaa548eca3cc153e16567607737d36cc512ccec940cf35cf.
The important missed requirement is the IGZ header+8 type-layout signature.
Loader568430 hashes every TMET class with51b8d0 and rejects a mismatch.
Each eligible flattened metadata field contributes its **big-endian** uint16
storage size, name bytes, metadata class name bytes (no string terminators),
using FNV-1a continued from the previous accumulator. Type names are not hashed.
Evidence:ev_8b8a6695e1b0f4496e00420d2522f4fdc87c32c45fd63aaa0df0b204cbb12cf3,
ev_bc662290839172084ac93f1f5a88bbcfcd6633b4b52320a56daf2e7ed427215c,
ev_d1ccd51581e44f8d4bf8dc71d8f0e8176bcbbb4f68316d34c44e921ac4952706.

PositionStack inherits ScriptObjectList/igObjectList and has three flattened
fields:4/_count/igIntMetaField,4/_capacity/igIntMetaField,
16/_data/igMemoryRefMetaField. Read-only native metadata observations in probe04
confirm the list and names; native vtables f7ee20/f7f0a0 supply storage sizes
(546aa0 returns4,547770 returns twice platform pointer size, PS4=8).
Do not use object offsets in place of these storage sizes. Runtime address
bias is+0x400000; an initial read without the bias was rejected as unrelated
data, not interpreted as a pointer.

`appendTypeDeclarations` now requires explicit flattened eligible fields and
updates the signature. Probe05 is otherwise byte-identical to04: only the four
inner header bytes8..11 change, from7a279809 to244afd8c. InnerSHA
2c75b352d20737d9c270ade32203b4fb2f150e95131aadca0b77e39d0854af74,
outerSHAa7f7b13010ca9704f24be8b19f1314b8e9f1e505d5e50b2ba42ded36991c4be9.
Probe05 still failed: it incorrectly hashed field sizes little-endian. Native
505580 returns14 and5055c0(14)=1, causing unsigned-short swapping through
517d30 before hashing. Probe06 uses canonical big-endian sizes, signature
a81c32cc. Its innerSHA is063fb77f74d56e19e20631738f9492e987b28f78ccebcb6ac38842260d4da597;
outerSHA isccfeeec12c03d04f5003138074b02fd1431d5ee5b608d28111023e76f72ecd68.
This again changes only four header bytes relative to04. Runtime acceptance is
being tested, not claimed. Type-declaration tests pass4/4. REA bundlev2 retains
372records in `research/rea-evidence-2026-10-14-sunbreak-v2.json`.
