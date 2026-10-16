# Current work and continuation checklist

This is an in-progress engineering record, **not a completion announcement**.

## Model import and current-map preview, 2026-10-16

Static GLB import now creates an editable authored workshop with one bounding
box collider per imported root. Position, Euler rotation and nonuniform scale
are exported into native model geometry and collision placements. This route
does not yet insert models into arbitrary original chapters. See
[supported formats, collision limits and controls](MODEL_IMPORT.md).

A new GLB cube was imported, built through Play and rendered by the actual PS4
game in private preview `preview-JDq4Z9`. Native screenshot
`CUSA00697_20261016_111039_952_game_000000.png` shows the cube with the player on
the grid. This verifies rendering, not a full collision-contact acceptance test.
The two-object native serialization test covers separate scaled/rotated boxes;
the unchanged Gallardo build still matches its previous native payload hash.

Play displays actual preparation stages inside Live. Stop cancels a pending
launch or shuts down only the editor-owned emulator. Controller background
input is enabled in each private session, without editing the user's config.
Physical controller button delivery still needs an interactive check.

The workshop chapter image has been rebuilt from the real Gallardo editor
render. Runtime01 exposed inverted UVs and a model shared with Sunbreak;
runtime02 verifies the upright Gallardo on chapter19 and unchanged neighboring
Sunbreak art. The builder clones a private model/material/image graph first.
The archive was independently unpacked; the original archive remains unchanged.
See [thumbnail construction and evidence](CHAPTER_THUMBNAIL.md).

GLB alpha correction: BLEND/MASK materials no longer fail solely because of
their declared mode. Fully opaque effective alpha needs no conversion; real
transparency imports with a recorded opaque approximation and a warning.
MCP/backend `alphaPolicy: "reject"` retains strict loss detection. Actual
native alpha blending/testing remains unimplemented.

## Native preview / fast startup, 2026-10-16

Know-It-All Island now starts with no menu input and is playable at the
12.31-second sample from emulator spawn. Title04 retains real controller/portal
initialization beneath the startup backdrop, omitting title, autosave and
save-menu presentation. Separate legal-duration and chapter-intro patches retain
native cleanup/spawn behavior. Figure-entry MagicMoment remains; ten seconds
has not been achieved. Fresh edited-copy preparation measured another8.50s.

**Play current map** uses a saved exact-hash profile and packs staged position
edits into a fresh private game. Unknown maps fail instead of launching the old
map. Native one-click launches reached Gallardo gameplay and the imported-cube
workshop. Preparation remains additional startup time. See [setup](GAME_PREVIEW.md).

Native free-camera movement, unchanged projection, timed/manual/shutdown
restoration and Qt keyboard/mouse/HUD hiding have separate runtime proofs.
The new X11 SDL/Vulkan host now has a verified actual textured chapter314 image,
captured from the exact owned X11 window without PNG capture requests.
A grey-pane bug was caused by desktop coordinates applied relative to the Qt
parent; enforcing local0,0 fixed the tested run. Continuous camera hold uses
renewable leases, with 33ms elapsed-time movement, right-button mouse capture
and configurable speed. A held chapter314 camera remained active for149seconds.
PNG fallback remains snapshots, not video. All tests use isolated game/profile
copies, preserving originals.
See [current evidence, failures, and acceptance checklist](FAST_PREVIEW.md).

## Separate Sunbreak chapter, 2026-10-15

Latest correction: **mission09 returns without the campaign-ending party**.
The hub treats an appended adventure's transient `complete=2` as a new story
milestone and clamps the stage to18. Sunbreak now consumes only its own2→1
notification after native LevelEnd, preserving results and real saved flags.
First finish and replay in `runtime-sunbreak-nocutscene-01` both return to
controllable Academy gameplay without the cutscene. All three goals and
completion persist; old chapter/collection fields are unchanged. Clean saved
profile: `builds/checkpoint-sunbreak-nocutscene-09`; installed inner/editor file:
`builds/sunbreak-mission-09/level.bld`. Portable build `sunbreak-repro-03` matches
byte-for-byte.319 Node tests:297pass/22optional skips/0fail; eight selected
private mission/UI/build checks pass. No global cutscene patch, original hub
edit or gameplay-memory write. See [cause and evidence](SUNBREAK.md#return-without-the-campaign-cutscene).
The older mission08 acceptance below is retained as history.

The new short mission is **20. Sunbreak Causeway**, not a replacement for
**19. Modular Test Island**. Its native mission logic and newly composed map
now load, complete, save and replay natively. This is a short traversal mission,
not a combat chapter or a general-purpose AI chapter compiler. See
[Sunbreak development and runnable commands](SUNBREAK.md#current-runnable-build).

The original 23-entry installation `builds/runtime-chapter-01/CUSA00697` and
the existing `tools/play_demo.mjs --local` route remain unchanged. All new
registration work uses the independent copy `builds/runtime-sunbreak-01/CUSA00697`.
The chapter menu in `runtime-sunbreak-menu-01` displayed both titles separately
(screenshots000005/000006). The new native five-platform world loads and is
traversable. Probe06 also loads with the added script type: the prior loading
failure was a stale IGZ type-layout signature, whose uint16 field sizes must be
hashed big-endian even on PS4. Probes08/09 exposed a
second loading bug: the appended per-frame script lacked ROOT registration.
Probe10 adds that membership and now loads the new world with the behavior
enabled. Mission04 and mission06 have now reached the native results screen
through normal controller movement (both relays, then beacon) and saved a
genuine completion. Mission06's runtime08 finished in1:43 and saved
Sunbreak flags229377; Soda/Gallardo's inspected progression stayed unchanged.
However, the result screen still said **No Story Goals configured**, with
objective bits0. This is not accepted as correct mission objective accounting.
Mission07 corrected the objective list/stack's inherited actor metatypes, but
also incorrectly treated parameter+64 as a numeric mode. It is an RNEX index:
Arena15 and Soda18 both mean ScriptSetReference. Copying18 into Arena selected
ScriptStructure instead. Runtime10 still had no story goals. Mission08 keeps
the translated StringInfo stacks and restores the correct RNEX identity;
runtime11 now verifies all three native story goals, genuine completion and
saved objective bits7 (valid checksum). Its clean profile-only checkpoint is
`builds/checkpoint-sunbreak-objectives-08`. The17.314-second automated route
used11 normal controller pulses, not player-memory edits. The displayed5:39
also includes idle inspection time before that route.
The new objective-screen01 policy retains just the three actual story goals
for adventure19 and skips its aliased portal-master star-write path. Its
static tests pass; runtime12 verifies it, checkpoint reload, and the
beacon-before-relays negative case. A replay still requires both relays.
The result has only the three actual goals; original Soda's objectives still
show all four original categories. Clean replay checkpoint:
`builds/checkpoint-sunbreak-replay-08`. Runtime13 also passes the first-play
check with the new UI and the original unplayed Sunbreak baseline: native
three-goal results, return to Academy, flags229377/objectives7 saved with a
valid checksum. Its final checkpoint is `builds/checkpoint-sunbreak-accepted-08`.
Old chapter19 remains byte-identical and was loaded again in runtime08.

`tools/sunbreak_build.mjs --game ORIGINAL-GAME --output NEW-DIRECTORY`
reproduced mission08 and objectives UI01 byte-for-byte in
`builds/sunbreak-repro-02`, with independent IGA extraction/readback. It needs
no private research inputs, but does not replace the separate source-bound
registration/install/save-migration workflow. Do not install these archives
into an unmodified22-entry game/profile. All original game files remain intact.
The GUI now accepts the same `--camera-json` as viewport captures; asynchronous
loading preserves the initial view. Tests:319 Node cases,297passed/22optional
skips/0failures; eight selected mission/UI/build cases passed (private cases
enabled); CTest7/7passed.

Known remaining scope: no enemies/chests in this traversal recipe, no independent
portal-master reward allocation, no arbitrary cross-chapter script compiler,
and no full native game-lighting reconstruction in the editor. The private
native recipe is not editable as a new-brush Hammer map in the GUI.

The separate progress-UI policy is now native-tested: chapter20 starts with
neutral icons and gains one completion icon after the real finish. It does
not allocate portal-master stars or fix the original180-bit collection.
Chapter19 stays neutral and original chapter1 retains its existing icons.
The new Unix-socket runtime daemon survived the interrupted tool session;
it does not expose TCP, attach arbitrary PIDs, or write guest RAM. See
`research/runtime_probe_daemon.mjs` and the private runtime-control01 audit.

The engine measured 24 save records, 8163 assigned bits, 1024 payload bytes
(1028 with checksum). `checkpoint-sunbreak-identity-01` migrates copies of the
four previous slots; Gallardo's identity18 stays, expansions19..22 move20..23,
and Sunbreak19 starts unplayed. No original profile is overwritten.

REA bundle `research/rea-evidence-2026-10-14-sunbreak-v5.json` retains389records.
Native distance is measured in feet; its ValueStack conditioner supplies the
reference PositionStack. RelOp LT is3, not2. The isolated proximity/LevelEnd
experiment `sunbreak-goal-probe-02` is not the finished mission.

## Playable native sandbox, 2026-10-14

The current [native Gallardo demo](NATIVE_DEMO.md) is a playable sandbox, not a
finished mission/AI chapter generator. It is selectable as **19. Modular Test
Island** and loads an independent `level_900_aiworkshop.bld`.

Verified in shadPS4:

- Clean native car rendering:35 uint16 chunks,342761 triangles,33 opaque BC1
  textures. The stretched-triangle bug was stale single-stream count arrays;
  both those arrays and scalar buffer counts are now written/validated.
- New12×12m BOX floor is active and holds the player atY100.010002. The car has
  a simple2×1.15×4.4m solid box proxy. Both actors need ROOT **and** active
  lighting ScriptSetList membership; ROOT alone did not activate them.
- Old invisible Arena303 collision is gone in the disposable demo copy.
  Its pack is replaced with the identical empty pack already in this level,
  in separate storage. Walk-off and recovery to the platform were observed.
- Exit through Pause → Chapter Select loads original Soda Springs. Restarting
  from the matching saved-profile checkpoint and re-entering the demo works.
- The new chapter's local star display is zeroed, not its save progress.
  Screenshot000004 of `runtime-native-gallardo-04` shows neutral stars and the
  correct title/description; original Soda Springs retains gold stars.
- The consolidated builder reproduced the runtime-tested inner AND outer hashes,
  and independent `iga_extract` readback matched. Full suite:305 tests,
  287passed,18optional skips,0failures. The separate private builder test passed.

Commands on this prepared workstation:

```bash
node tools/play_demo.mjs --local
editor/build/skylanders-level-editor --renderer gpu builds/gallardo-grid-demo-02.scene.json
```

The launcher uses a new profile/figure copy. Follow the title/save-slot/Story
screens, then terminal `chapters`; from Chapter Select at1 use `demo`, inspect
the selected title, then `enter-demo`. Routes are bounded input delivery, not
automatic state detection. `quit` stops the owned process and checkpoints.

Current private installed artifacts:

| Game-relative target | SHA-256 |
| --- | --- |
| `permanent/global.bld` | `06c004fb09f1d92f7750ae0efc0819cb31add29afe33070b607fe13aa78abb69` |
| `character/init_setup.bld` | `9ed1ab5b22d562e25384d27b3187a9b739820f5ae08ca626b78025ee7303031a` |
| `misc/ui_levelselect.bld` | `07d5fadb2e21f65b07f0db86301a28235832fb20643cba4e4f41521fbdb3746e` |
| `level/level_900_aiworkshop.bld` | `c53b7cb08a326ad15b0e840448f48ddb8730310d4068bd97c80ec23b8924b518` |

Inner native level:
`1b2f88812a04305a7f4dd79c1fcbff0e352e41bfc387b116db7ee1fed60a5721`.
Consolidated output: `builds/native-gallardo-repro-01`, equivalent to
`native-gallardo-04`. Portable level build:
`tools/native_demo.mjs --help`. Never rerun historical install helpers blindly.

Latest stopped research checkpoint: `builds/checkpoint-native-gallardo-menu-01`.
Launcher default: `checkpoint-native-gallardo-play-01`. These contain profile
data, not RAM. Evidence: `research/runtime-native-gallardo-probe-03.json`,
the session PNGs/logs and REA bundlev12 (335records). Player bindings can change;
the probe resolves PlacementReference+56 again before reading current position.
Earlier fixed-address samples became stale and are not current-state evidence.

Limits remain explicit: no driving, full body/suspension collision, transparent
glass/PBR, custom mission completion/rewards, arbitrary script compiler or general
cross-chapter module importer. Six source texture references remain missing.
The native builder takes the pinned unmodified imported demo scene, not arbitrary
editor edits. The full registration/save installation is still a source-bound
research workflow; only the native model/floor builder and launcher are portable.
The public GitHub checkout has not been updated by this continuation.

### Failed trials retained for diagnosis

`native-grid-01` was root-only and fell through its inactive floor.
`native-gallardo-02` activated the floor but retained old collision and stale
buffer stream counts. `native-gallardo-03` fixed rendering; old collision still
caught the player atY≈1.755. `native-gallardo-04` clears that discarded collision.
The first unused UI access draft used the wrong EQ enum and was never installed.
The first save migration used wrong expansion identities; current checkpoints
use the explicit seven-array18..21→19..22 map, with separate difficulty slots.

The older sections below are chronological records, superseded where they still
describe these steps as pending.

## Latest continuation: Gallardo demo and measured save migration

The notes below this section describe earlier checkpoints and are superseded
where this section states a later result. **No new playable native chapter is
finished yet.** All three parallel workers hit the service usage limit; their
work was retained and the primary agent continued locally.

- [Gallardo demo](GALLARDO_DEMO.md): real imported model, selectable/movable actor,
  authored flat grid, sky/sun, smooth normals and GPU light rig. Current file:
  `builds/gallardo-grid-demo-02.scene.json`; screenshot/report of the same stem.
  Launch: `editor/build/skylanders-level-editor --renderer gpu builds/gallardo-grid-demo-02.scene.json`.
  Editor preview only; missing material resources and assembly corrections are
  documented. [Authored documents](AUTHORED_SCENE.md) now work through the shared
  GUI/MCP backend, including hash-guarded copy export.
- Global title/load registration now covers all ten language packs. The story
  initializer now has a nineteenth include. Exact metadata covers 74 classes.
  Both rebuilt archives booted in the independent runtime game copy.
- Read-only owned-process measurements confirm slot layout7999→8081 assigned
  bits, payload1000→1012 bytes. Header2995bits/376bytes is unchanged. The
  completed save was migrated field-by-field into a fresh checkpoint, preserving
  raw original values and zero-initializing new elements; no old save overwritten.
- Runtime `builds/runtime-chapter-registration-migrated-01` displayed100%,
  180/180stars, rank40, loaded the Academy without intro, recognized Food Fight
  and accepted movement. It stopped normally (exit0). All four1016-byte slots
  and380-byte header have valid FNV-1a checksums afterward. Clean checkpoint:
  `builds/checkpoint-chapter23-academy-01`. Full new-chapter save/complete/reload
  compatibility is not established by that successful old-hub load.
- [UI extension](CHAPTER_UI_DRAFT.md): loop23 without changing shared literal22,
  description in all ten languages, existing23rd button and explicit Arena303
  loading-backdrop reuse. Fresh archive outputs independently re-extracted.
  The new UI runtime test is in `builds/runtime-chapter-ui-01` (acceptance pending).
- Portable native evidence now at
  `research/rea-evidence-2026-10-14-chapter-authoring-v9.json` (310 records).
  Private helpers preserve exact input hashes, isolated profiles and backups.

Remaining: demonstrate selectable entry, successful independent new archive
load, native floor/render model and matching collision, initialized camera/player,
exit/completion/save/reload. The editor JSON is not a substitute for those steps.

## Earlier checkpoint

2026-10-14 chapter/AI-authoring continuation (current priority): source-bound
tools now separate chapter registration, resource dependencies, script behavior
and save allocation. The exact-ELF metadata extractor covers 72
classes plus native arithmetic, membership and RHS-function enums; zero-offset virtual fields are not
treated as serialized object storage. No original game assets or saves were
edited during this investigation, and no additional chapter was run.

- [Chapter entrypoints](CHAPTER_ENTRYPOINTS.md): 22 localized title/load pairs,
  18 story include statements, 802 UTF-16 strings and a separate final-battle
  load. Native RVTB callback order, not ROOT order, determines string mapping.
  Adventure IDs, load-file numbers and save allocation are distinct; inserting
  a list entry can affect existing progress. `SetVariant::count` and arithmetic
  metadata now identify the count/product inputs, not spare save capacity.
- [Module dependencies](MODULE_DEPENDENCIES.md): an explicit object/resource
  traversal with unresolved frontiers. GarageDoor_4 reaches 92 typed objects,
  45 known allocations (4,389,252 bytes) and 57 unresolved/remap boundaries.
  Static rendering and Havok collision are separate worlds. A mesh, a name
  keyword, or a closed pointer graph is not a reusable gameplay module.
- [Script graphs](SCRIPT_GRAPH.md): arena inventory has 63 scripts and 20,693
  opcode rows. The selected arena controller has 1,233 rows; six selected Soda
  Springs scripts have 2,944. VM pre-increment, selected comparison/startup
  edges, frame/sequence effects, spawning and behavior-owner constraints have
  native evidence. Unknown opcodes, stack evaluation and runtime reachability
  remain explicit. No general-purpose script compiler is implemented.
- [Save layout](SAVE_LAYOUT_DISCOVERY.md): 88 six-argument declaration call
  sites from 1,209 rows, including sequential bit allocation. The conditional
  eight-field subtotal grows by 82 bits per added title/load with the original
  three difficulty segments; complete runtime layout and save migration remain
  unresolved. The predicted header completion window at bit 157 matches an
  independent earlier runtime experiment.
- [IGZ append](IGZ_APPEND.md): coordinated growth of up to 32 exact-layout
  `ScriptSetList` objects now works with optional ROOT end-appending. Both real
  global title/load lists pass memory-only 22-to-23 checks without changing
  existing global ROOT positions; bootstrap ROOT must remain unchanged.
- The 15-row `Gate_remover_Post_Fight.ai` has exact `ActorInfo::removed`,
  `OpTopLevelBehavior::my` and Placement property identities, plus bounded
  membership/assignment/remove effects. It updates cameras/triggers and must
  not be advertised as a generic physical-gate script. Shared opcode objects
  cannot safely be edited in place when copying a script.
- [Paired registration draft](CHAPTER_REGISTRATION_DRAFT.md):
  `builds/chapter-registration-draft-01/` now contains newly authored title/load
  objects for **Modular Test Island / Level_900_AIWorkshop**, two appended
  global handles and a paired English dictionary. Independent registry and
  entrypoint readers confirm 23 pairs, 804 strings and the original 22 pairs'
  texts unchanged. There are still only 18 story includes and zero for the new
  pair: **no new chapter-select entry or playable archive has been created**.
  The draft remains deliberately non-deployable. Original assets and saves are
  untouched. Synthetic tests also cover later-pool string ordinal shifts.
- The exact next story-list insertion is documented in
  [Chapter entrypoints](CHAPTER_ENTRYPOINTS.md): new row before old 86,
  three crossing branch extents, a new EXID handle and native macro-PC binding.
  Current generic append support cannot safely express that opcode insertion;
  do not substitute simple end-appending or patch shared opcodes indiscriminately.

The final integrated run passed 241 Node tests (ten optional skips, 251 total)
and all seven local CTests, including hardware OpenGL. A separate opt-in run
passed all 15 real append/clone/paired-draft checks. These are tool/editor and
file-structure regression results, not runtime acceptance of generated content.

2026-10-14 viewport/UI follow-up: dark movable docks, Object/Display/Lighting
inspector tabs, resettable layout and a manual preview-light rig (also CLI/MCP).
The ground reference grid is now frozen to source bounds and the world origin,
not the moving camera pivot or zoom. Proxy geometry no longer inflates to a
minimum screen size: logic/trigger records remain fixed-world-size boxes;
recognized unsupported visible objects use explicitly heuristic silhouettes.
Original model decoding is unchanged (arena: 74 modeled actors; 129 fallback
records, including 94 without serialized models and 33 unsupported animated
models). No new native animation, active light state, shadow or material-layer
reconstruction is claimed. Source game files remain unchanged.
All seven local CTests, including the enabled GPU suite, pass with grid,
placeholder perspective, colored lighting, CLI/MCP validation and dock tests.
The Node suite has 205 tests: 197 pass, eight optional tests skip, zero fail.
Real native-window review `research/editor-modern-layout-02.png` and its
`.lighting.png`, `.selection.png`, `.collision.png`, `.textures-off.png`
companions passed model picking, XYZ numeric/gizmo edits, exact undo and source
hash preservation (203 actors, 184 meshes, 164 textured). These private captures
are not source-release assets or in-game validation.
Restart an older running editor after exporting any pending edits to load the
new executable. Startup command and controls are in README.md/editor/README.md.

Latest material-diagnosis update: GUI inspector + unlit/checker/missing/flat
modes, selected-mesh isolation, repeatable camera captures and new MCP tools
`inspect_level_materials` / `render_level_view`. Native cached sampler slots
and bootstrap reflection identify a false emission/diffuse ambiguity; linear
filtering now matches the native within-mip mode. Arena coverage improved from
72/184 to 164/184 instances (20 multi-layer instances still unsupported), with
reflected diffuse-slot selection, fair stored-mip budget reduction and 1024px
isolated detail captures. No global UV-scale correctness or
game-lighting equivalence is claimed. See MATERIAL_DIAGNOSTICS.md for evidence,
captures, limitations, exact commands and provenance. Original assets unchanged.

2026-10-14 continuation: material inspection now includes typed float/vector/
int32-boolean shader constants, per-pass occurrences and UV-animation target/
track references. These are static values, not evaluated game shaders. The
native metadata extractor covers 51 classes, including native color and vertex/
pixel variant-mask attributes exposed per cached pass. Mesh framing follows pending actor
translation and clears stale actor edit controls; GUI regression tests cover
the material inspector, filtering, view mode and isolation.
The inspector also has a separate bound-image/UV comparison window. Original
Blended shaders were partially decoded offline; their primary/secondary samples
use separate interpolator components. UV1 on the tested corrugated wall is a
small palette range, unlike tiled UV0. No unverified global scale or blend fix
was applied. See the shader-investigation section of MATERIAL_DIAGNOSTICS.md.

A fresh source-only build exposed two omitted synthetic test dependencies
(`tests/fixtures/collision_fixture.mjs`, `editor/tests/collision_builder.mjs`).
Both are now required release inputs, and a new test checks relative JavaScript
imports across the source allowlist. The earlier material-v1 archive lacks
these test fixtures; use a subsequently validated snapshot instead.

## Required finish criteria

- A C++ 3D editor showing the real map and supported real object meshes, with
  selection and movement. Nonvisual logic objects should remain identifiable
  markers; undecoded visible models must not be described as finished.
- Hardware-accelerated editing and scene-specific reference captures through
  the same renderer, eventually close to the game including recovered lighting.
  GPU mesh rendering is implemented; game-equivalent materials, active lights,
  shadows, fog and postprocessing are not yet reconstructed.
- A complete, playable custom map tested in the game, not merely a successful
  file export or four changed spawn markers.
- A custom level selectable as a chapter: investigate registration, chapter
  ordering, loading dependencies and saved progress together. Replacing an
  existing chapter is an isolated intermediate experiment, not proof of a new
  chapter slot.
- A locally generated, machine-readable reference catalog of the normal
  chapters, with scene/feature screenshots linked to object IDs and source
  offsets. Cover enemies, loot/chests, destructibles, gates, scripts, streaming
  and lighting. Distinguish verified fields, inferred roles and unresolved data;
  do not call a raw object dump a complete behavioral schema.
- Repeatable, fast game input and game-only screenshots through MCP.
- Preserved checkpoints and documented reconstruction from somebody else's own
  local PKG, without distributing game assets or saves.

## Verified so far

- Exact CUSA00697 extraction, IGZ reader, archive replacement and independent
  roundtrip verification. Original files are preserved.
- C++/Qt 3D map editor, picking, XYZ movement, safe export and MCP backend.
- 77 static meshes plus 107 real actor-mesh instances for 74 actors. Rotated
  props and ordinary attachment-socket models use native-confirmed conventions. These counts
  are a snapshot; see the geometry report for current coverage.
- Original game boots and reaches first-level gameplay in shadPS4 v0.19.0.
  Synthetic Snap Shot and Food Fight both work, including a live swap.
- `builds/checkpoint-first-level-01` restores save slot 1 and Food Fight. This is
  a saved-profile checkpoint, not RAM state; it does not skip the story intro.
- Header FNV-1a checksum verified. Changing the candidate field at bit157 to1
  changes displayed completion to1% but does not unlock levels. That experiment
  is separate and must not replace the recommended checkpoint.
- A one-byte, exact-hash-guarded Title arena-debug check opened Exhaust Junction
  and started arena303 battle with Food Fight. The return menu is a second
  payload; its equivalent patch passes offline/independent extraction checks.
  In portal-crossfire-01 the edited challenge reached battle, returned to an
  unlocked challenge menu after losing, and accepted re-entry to character
  confirmation. See ARENA_TEST_ROUTE.md. Individual spawn positions still need
  a controlled visual/runtime comparison; this is not a complete custom level.
- A separate shadPS4 input/capture fork built successfully. Native SDL synthetic
  tests pass. In `builds/portal-input-baseline-01`, a 100 ms Cross pulse changed
  the actual title screen to the autosave notice, with press/release ACKs and
  fresh native game PNGs. Original and edited arena battle starts also passed;
  this is not a claim of whole-game compatibility.
- Real menu pulses at 1 Hz reached Exhaust Junction, with native 100–101 ms
  press/release cycles and about 245 ms fresh captures. New portal_sequence
  locally schedules bounded routes without per-step model/RPC/screenshot
  waits; cancellation and timing-stall tests pass. See PORTAL.md.
- Full Node run after typed material/state diagnostics and packaging checks: 197 passed,
  eight optional private tests skipped (205 total). Seven CTests including explicit hardware
  OpenGL pass. The real arena MCP integration passes with 164 textured meshes
  and a 36,785,799-byte textured-scene response. The emission-slot negative
  regression and image/UV comparison GUI workflow are included in these passes.
- Read-only collision overlay/inspector and MCP collision inspection passed
  real GarageDoor_4 checks (three eligible actor boxes; no static Havok floor).
- Structural IGZ append/root growth passes synthetic and real in-memory tests;
  safe actor-cloning policy/runtime proof is still separate work.
- A guarded one-actor clone prototype now passes its offline tests, including
  private collision/parameter ownership and shared-model reference accounting.
  No clone has yet been installed or observed in-game. See ACTOR_CLONE.md.
- Texture preview is integrated and visually tested: original material/image
  links and HALF2 UVs, bounded native-confirmed BC1/BC3 tiling, now 70 images on
  164/184 arena mesh instances. The original 33-image / 72-instance capture is
  historical. This is RGB preview, not full game shaders or lighting.
  See MATERIAL_DIAGNOSTICS.md and TEXTURE_PREVIEW.md.
- The supplied Wii SD save decrypts and its slot payload sizes match the PS4.
  Word-swapping and rechecksumming its empty slot exactly matches the PS4 empty
  slot. A separately imported completed-slot candidate now reaches Story
  100/100, Academy without the initial tutorial, Portal Master 40, chapter
  selection and playable Chapter 3. The PS4 header was retained on import;
  header conversion is not implemented. See WII_SAVE_INSPECTION.md.
- Cleanly stopped `portal-wii-slot1-01` and saved 35 files in
  `builds/checkpoint-wii-progress-01`. This is a profile, not RAM state.
- Structural JSONL.gz catalogs now cover arena 303 and Soda Springs, with
  source-bound object IDs and complete relocation inventories. Feature hints
  are not behavioral schemas. The editor supports `--frame-object` screenshots
  with camera/source/PNG provenance. See IGZ_CATALOG.md.
- `research/chapter-catalog-v2/index.json`: all 23 numbered level archive
  candidates exported, with 115 PNG/JSON pairs and no export errors. Screenshot
  entries remain visually unreviewed; some tested views are occluded or dominated
  by large geometry. This is not a complete behavioral/visual reference set.
- `research/chapter-lighting-v1/index.json`: all 23 matching inner files have
  source-bound native-field light, directional-light and mood-box catalogs.
- `research/chapter-registry-v1.json`: native startup `0x4018d0` plus 25 bootstrap
  roots proves the global handle offset 26. Resolves 521/580 initializer EXID
  records, exports 624 opcode rows and 18 adventure-order include statements.
  This is static evidence, not a new chapter insertion. See CHAPTER_REGISTRY.md.
- OpenGL 3.3 mesh rendering with cached buffers/textures, integer picking and
  inverse-depth output is integrated. Real arena GPU preview and synthetic
  perspective/near-plane texture, picking and GUI movement checks passed on
  AMD Radeon RX 7900 XT. CPU overlays/readback and explicit CPU fallback remain.
  Adjustable manual preview light only; nativeLightingApplied=false. See GPU_RENDERER.md.
- The 1 Hz route test session was cleanly stopped and saved as
  `builds/checkpoint-fast-route-01` (34 files). Its final screen was Exhaust
  Junction selection; the checkpoint preserves the profile, not that menu state.

## Immediate continuation order

The latest request accepts the editor presentation and prioritizes genuinely
new selectable AI-generated chapters assembled from other chapters' modules,
including their scripts. Continue from the three linked reports above; do not
repeat the already resolved title/load pairing or infer gameplay from catalog
names. The editor's material/lighting limitations remain, but are not the next
chapter-registration milestone.

| Required result | Evidence now available | Next proof/implementation |
| --- | --- | --- |
| Independent selectable chapter | Global handles, same-index title/load assignments, localized strings, story includes | Coordinated append-only registration/language writer; final file loads and dependency validation |
| Preserve completed progress | Separate adventure IDs/file numbers; count-dependent save declarations | Decode actual bit allocation/readers, capacity and compatibility or explicit private-save migration |
| Recombine playable rooms/props | Typed/resource closure and separate collision world | Cross-file linker for pools/types/tables/ownership plus common render/collision transform policy |
| Generate encounters/gates/endings | Ordered opcode/operand graphs and selected native effects | Complete one small encounter's binding/variables/events; constrained writer and branch validation |
| Playable entire chapter | Existing isolated emulator/checkpoint/input workflow | New selection → spawn → traversal → encounter → finish → save/reload/return, with actual captures |

Prefer a small end-to-end encounter and gate as the first verified behavior
recipe. A test in an existing arena is a lower-risk intermediate experiment,
not a replacement for the independent chapter requirement. The following
runtime/authoring notes remain applicable:

1. Controller integration and unchanged-game title/menu input checks passed.
2. Crossfire test session `builds/portal-crossfire-01` uses the disposable game
   copy with patched Title, patched return menu, and the four-spawn challenge
   archive. Original arena battle already started in portal-input-arena-01;
   edited challenge battle and return-menu re-entry passed. Precise spawn
   effect and whole new-level construction remain pending.
3. Preserve separate logs, screenshots, manifests and checkpoints. Use the
   completed Wii-progress checkpoint only for chapter tests retaining the
   original save layout. Enlarged title/load lists require separate fresh-save
   and migration validation. Keep the original first-level checkpoint as an
   independent baseline.
4. Continue real-model decoding for animation and hierarchical models.
5. Resolve new geometry/collision and object/script authoring. These are still
   required for the complete new-level goal and must not be silently dropped.
   Native code now proves primitive BOX generation from CollisionInfo. The
   guarded collision_builder edits private box dimensions/offsets into new
   files; grounding of changed boxes is not yet runtime-verified. The structural
   IGZ append writer is complete within its bounded contract, not yet a valid
   new-actor claim. The three-object actor/collision/parameter prototype policy
   passes offline tests; activation, collision, teardown and re-entry still
   require isolated runtime checks.
6. Re-run full tests and a source-only clean build; create a source-only release
   only after its documentation and allowlist are current.

## Durable paths

- Latest validated source-only snapshot:
  `builds/skylanders-editor-source-2026-10-14-chapter-draft-v2.tar.gz`
  (127 source files, 488,218 bytes, SHA-256
  `a6de70c5ee2636002567075db8bb29f4a0c099468465e5429ada809622cab6ee`).
  Adjacent `.validation.json` records the clean source-only build: 220 Node
  passes, 31 asset-dependent skips, all seven CTests including hardware OpenGL.
  This post-build release pointer was added after the archive was frozen;
  the archive contains the work record immediately preceding this pointer.
- Native evidence: `research/rea-evidence-2026-10-13.json`; preserve/export it
  before closing the REA session. Raw evidence is private, not release content.
- Current REA chapter/script evidence:
  `research/rea-evidence-2026-10-14-chapter-authoring-v6.json` (292 records);
  use this plus the older bundle for the VM dispatch
  and previously recovered loader/copy evidence. Keep the current exact-ELF
  session warm while native investigation continues; do not reopen it per query.
- Current chapter mapping: `research/chapter-entrypoints-v2.json`; module sample
  ledger: `research/module-dependencies-v1.json`. Latest selected script exports
  are `research/arena-script-graph-2026-10-14-v3.json` and
  `research/soda-script-graph-2026-10-14-v3.json`. These contain private
  game-derived data and are excluded from source releases.
- Focused gate report: `research/soda-gate-script-graph-2026-10-14-v1.json`
  (15 rows, 29 operand objects). Save declarations:
  `research/save-layout-catalog-v3.json` (88 six-argument call sites).
- Paired private draft: `builds/chapter-registration-draft-01/manifest.json`;
  independent reader check: adjacent `independent-validation.json`. These are
  local game-derived outputs, never source-release inputs.
- Original checkpoint and GUI resume instructions: [SAVE_CHECKPOINTS.md](SAVE_CHECKPOINTS.md).
- Arena test recipe and evidence: [ARENA_TEST_ROUTE.md](ARENA_TEST_ROUTE.md).
- Direct-input fork and protocol: [INPUT_IPC.md](INPUT_IPC.md).
- Editor startup and controls: [README](../README.md).
- Verified runtime history: [RUNTIME_TESTING.md](RUNTIME_TESTING.md).

Always rediscover an owned process/window after restart; old PIDs and X11 IDs
are not durable handles. Do not blindly repeat desktop keystrokes. Prefer the
new acknowledged input protocol once its real runtime test passes.
