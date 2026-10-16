# Native Gallardo grid chapter

The example now runs **inside Trap Team**, not just in the editor: a new chapter
entry loads `level_900_aiworkshop.bld`, with a 12×12 m grid platform, the imported
Gallardo, native sky/outdoor lights, player/camera initialization and solid floor
and car proxies. This is a small walkable sandbox, not a campaign mission.

The exact supported input is CUSA00697 01.00. All game bytes, model data, saves,
screenshots and generated archives stay local. The tools were developed through
archive inspection, REA-backed native analysis and isolated shadPS4 tests; they
do not contain the game's source code. MIT covers our code, not supplied assets.

## Play on the already prepared workstation

From the project directory:

```bash
node tools/play_demo.mjs --local
```

This opens the patched emulator in a **new** session directory and restores a
copy of the identity-aware completed profile and virtual Food Fight figure.
It does not modify the checkpoint, install archives, or use your normal emulator
profile. Wait for each screen, then use Cross (default keyboard **N**) through
the title, autosave notice, save slot 1 and Story menu. The saved game starts at
the Academy without the opening tutorial.

Once ordinary Academy gameplay is visible, these terminal commands provide the
short route:

```text
chapters
```

Wait until Chapter Select shows **1. Soda Springs**, then:

```text
demo
```

Check that **19. Modular Test Island** is selected, then:

```text
enter-demo
```

The route uses acknowledged native IPC, with 500 ms between chapter selections.
It is not image/state detection: do not run it from the wrong menu or while a
level is loading. Individual commands such as `cross`, `options`, `pad_right`
and `left_x_plus 500` are also available. `capture` prints the fresh game PNG
path. `quit` stops the owned emulator and writes a new sibling `-checkpoint`.
Closing the game window also ends the launcher. A checkpoint is saved profile
data, **not a RAM savestate**; a subsequent run still passes through title menus.

To resume a particular newly saved checkpoint, specify all paths:

```bash
node tools/play_demo.mjs \
  --emulator tools/vendor/shadps4/input-ipc/shadps4 \
  --game builds/runtime-chapter-01/CUSA00697/eboot.bin \
  --checkpoint /path/to/the-new-checkpoint \
  --session builds/my-new-demo-session --x11
```

Exit the chapter using Pause → Chapter Select and choose another chapter.
There is no scripted finish line, earned objective/reward, enemy encounter or
drivable car. Do not interpret the demo as completion of the general AI chapter
generator.

## Open its editable scene

```bash
editor/build/skylanders-level-editor --renderer gpu builds/gallardo-grid-demo-02.scene.json
```

The editor scene and native game build are distinct artifacts. The narrow native
builder below accepts the unmodified imported demo profile, not arbitrary editor
edits. Editor lighting is not an exact reconstruction of the retained game rig.

## Rebuild the native level using your own assets

1. Follow [SETUP.md](SETUP.md) to extract your own PKG and build `iga_extract`.
   Select `level/arena_mesh_303.bld` as the geometry archive. Its inner member
   `level.bld` is the setup output `payload/geometry.bld`.
2. Import your own matching model with [GALLARDO_DEMO.md](GALLARDO_DEMO.md).
   The ZIP requires its newer Node/Zstd and ImageMagick dependencies; the native
   builder itself uses the generated embedded scene and no external converter.
3. Hash that scene, then build into a **new** directory:

```bash
sha256sum builds/my-gallardo.scene.json
node tools/native_demo.mjs \
  --inner local-work/session-01/payload/geometry.bld \
  --archive local-work/session-01/extracted/CUSA00697/level/arena_mesh_303.bld \
  --scene builds/my-gallardo.scene.json \
  --expect-scene-sha256 REPLACE_WITH_THE_SCENE_DIGEST \
  --output builds/my-native-demo
```

Use the actual extracted game path from your setup manifest for `--archive`;
the example path is not assumed by the builder. Exact source guards:

| Input | SHA-256 |
| --- | --- |
| Original inner Arena303 | `7488dc91cbb5e801c2d47f13e84c14df6d0724ecf61a579179fcea386dc97899` |
| Original outer Arena303 | `27d374305a08087abfcde0d91f6db147b6591440a088949643aa2bcfe4551145` |
| Private model ZIP | `71d28f33448400829784265b5b4fc24aced3bfacd712f49a351a3ee1c6b83b8b` |

Output includes the inner `level.bld`, outer `level_900_aiworkshop.bld`, stage
manifest and archive-replacement manifest. It does not install anything or
register the chapter. An independent extraction of member 0 must match the
inner hash. Do not put editor JSON in a game archive.

### Registration and save prerequisites

The native model builder is portable; the complete chapter/save installation is
still an exact-source research workflow, not a one-command public installer.
Do not copy a resized save into an unmodified game or use an old 22-entry save
with the 23-entry registration. The private installed set is:

| Game-relative file | Local build supplying it |
| --- | --- |
| `permanent/global.bld` | `builds/chapter-ui-runtime-01/global/global.bld` |
| `character/init_setup.bld` | `builds/chapter-identity-02/character/init_setup.bld` |
| `misc/ui_levelselect.bld` | `builds/chapter-demo-stars-01/ui_levelselect.bld` |
| `level/level_900_aiworkshop.bld` | `builds/native-gallardo-repro-01/level_900_aiworkshop.bld` |

Reconstruction order and the code implementing each contract:

1. Extract global/bootstrap/initializer/UI inner members and all ten language
   packs from your own archives. Reconstruct your own matching ELF as described
   in [FINDINGS.md](FINDINGS.md#reproduce-the-rea-analysis).
2. Use `chapter_registration_draft.mjs` and its multilingual workflow to append
   the paired title/load and rebuild native-order dictionaries. Add the explicit
   Arena303 loading backdrop with `chapter_ui_draft.mjs`.
3. `story_registration_draft.mjs` inserts the nineteenth story include and
   corrects expansion identity consumers. `chapter_ui_draft.mjs` extends the
   selection loop and inserts the description at adventure ID18. See
   [CHAPTER_ENTRYPOINTS.md](CHAPTER_ENTRYPOINTS.md) and
   [CHAPTER_UI_DRAFT.md](CHAPTER_UI_DRAFT.md).
4. Private assembly recipes are `research/assemble-chapter-registration.mjs`,
   `assemble-chapter-ui-runtime.mjs`, and `assemble-chapter-identity-02.mjs`.
   These pin historical input paths/manifests; inspect them before adapting paths.
   They are not blind installation commands. Later demo policies are
   `enable-demo-chapter-ui-01.mjs` and `clear-demo-ui-stars-01.mjs`.
5. Measure old/new runtime save schemas. `save_layout_migrate.mjs` preserves
   existing fields and zero-initializes new elements. The explicit identity map
   is in `research/derive-chapter-layout-checkpoint.mjs --identity-aware`:
   seven adventure arrays shift old18..21→19..22; new18 remains zero.
   Difficulty uses separate slots and **must not be shifted**.
6. Install only into an independent, stopped game copy. Verify old/new digests,
   reject links/shared inodes, and retain uniquely named backups. Independently
   extract all changed members. Launch with a matching copied checkpoint.

Private manifests and generated game data are not redistribution inputs. Another
person must generate them from their own assets and save. Never bypass a digest
failure merely to make a different game revision accept these hardcoded indices.

## What fixed the failed trials

- ROOT membership loads a placement but did not activate our floor. Both new
  actors also need membership in the retained lighting `ScriptSetList` at
  encoded189400. Their owning reference count is two.
- Geometry buffers have **two counts**: scalar at+12 and the single-stream
  count array reached through+24. Updating only the scalar produced stretched
  triangles. Both counts are now written and checked by `igz_geometry.mjs`.
- Removing visible donor triangles did not remove old collision. It caught the
  falling player at Y≈1.755 and prevented useful recovery. The final build
  replaces that world's 18976-byte pack with the identical 1216-byte empty pack
  already used twice in the same source level. Each pack keeps its own storage;
  this is not an arbitrary Havok serializer.
- Runtime player references can change. Tests resolve the player binding again
  rather than reading a cached actor address indefinitely.

## Observed acceptance, 2026-10-14

The rebuilt payload is byte-identical to the tested `native-gallardo-04`:
inner `1b2f88812a04305a7f4dd79c1fcbff0e352e41bfc387b116db7ee1fed60a5721`,
outer `c53b7cb08a326ad15b0e840448f48ddb8730310d4068bd97c80ec23b8924b518`.
Private `runtime-native-gallardo-03` evidence records clean car rendering,
grounding atY100.010002, car blocking, walking off the edge and returning to the
platform, and leaving for Soda Springs. `research/runtime-native-gallardo-probe-03.json`
records the read-only measurements and their limitations. Screenshots000013 and
000014 in that session show the walk-off and return;000017 shows Soda Springs.

The car has35 uint16 draw chunks,342761 triangles and33 opaque BC1 textures.
Six missing source texture references remain explicit fallback swatches. Glass,
paint/PBR/reflections are simplified. No vehicle behavior or exact body collision
is implemented. The sky and lighting are the game's retained early-morning rig.
No full quest-completion/save-reload contract is claimed for this sandbox.

REA evidence bundle v12 contains335 records. Builder manifests deliberately
retain `runtimeValidated:false`: generating a new file does not run the game;
the separate hash-bound runtime record is the acceptance evidence.

The final UI/re-entry session is `runtime-native-gallardo-04`: screenshot000004
shows chapter19 with neutral stars;000005 shows the newly loaded native scene.
All four1016-byte slots and the380-byte header in its stopped checkpoint have
valid trailing FNV-1a checksums. This checks file integrity, not every gameplay
field. `research/native-demo-acceptance-01.json` collects the exact artifacts,
captures, checks and remaining limitations.

The user-facing launcher was also exercised directly: it restored an isolated
profile and virtual figure, captured the title, delivered a Cross input, stopped
normally on `quit`, and produced a restorable sibling checkpoint. Its session
is `play-demo-375f47da-a426-42f2-a587-c2a6c88b9c6e`.
