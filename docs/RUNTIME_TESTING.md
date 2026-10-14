# Runtime validation

The generated files have passed offline checks. The **unmodified CUSA00697 game
has now booted to a correctly rendered, animated title screen**. With the
default real-USB backend it reached "Can't find the TRAPTANIUM PORTAL"; enabling
the built-in Skylanders backend passed that gate, then reached the autosave
notice and empty save-slot selection. Subsequent tests reached original and
edited arena battle, including the return menu; see [ARENA_TEST_ROUTE.md](ARENA_TEST_ROUTE.md).
This does not establish a complete playable custom map.

The separately normalized Wii slot has now reached Story 100/100, the Academy
without the original tutorial, Portal Master 40, unlocked chapter selection and
playable Chapter 3 with Food Fight. The owned session exited normally and saved
`builds/checkpoint-wii-progress-01` (35 files). Exact steps, screenshot hashes,
limitations and reconstruction are in [WII_SAVE_INSPECTION.md](WII_SAVE_INSPECTION.md#separate-runtime-result-2026-10-13).
No new chapter slot or custom story map has yet been runtime-tested.

Further portal test: the original game reached **playable first-level gameplay**
with a newly generated Snap Shot record (`id=462`, `variant=0x3000`). Sending
remove/insert through shadPS4's existing IPC replaced Snap Shot with generated
Food Fight (`id=476`, `variant=0`); both the rendered character and HUD name changed.
These observations validate that specific live character swap, not every figure,
trap, SWAP Force combination, speaker feature or later level.

Evidence is private under `builds/portal-test-01`: `09-progress.png` shows Snap
Shot, `10-food-fight.png` shows Food Fight, `portal-events.jsonl` records commands,
and `emulator.log` records the owned process. It exited normally with code 0.
`builds/checkpoint-first-level-01` preserves its saved profile and figure state
with SHA-256 inventory. A new session `builds/portal-resume-01` restored that
checkpoint, automatically reinserted Food Fight, and reached **Choose Play /
Story 0/100** instead of new-save/difficulty setup (`04-current.png`). Choosing
Story replayed the opening Eon cinematic (`05-story-continue.png`): this early
save has no completed first level, so profile restore alone does **not** skip it.
This is a saved-game restore, not an emulator RAM state. See
[PORTAL.md](PORTAL.md) for reproducible checkpoint/restore commands.

### Direct input and native capture baseline

`builds/portal-input-baseline-01` used the separate Linux input-IPC build
(`67256a057061d3175f307143a150001cfce468d97879d1c836c203eebd10c345`)
against unchanged `extracted/CUSA00697/eboot.bin`, restoring the original
checkpoint into an isolated profile. Both capabilities and post-HLE readiness
were observed. A 100 ms `button/cross` request received pressed/released ACKs
and changed the title screen to the autosave notice. Native game-only PNGs
`CUSA00697_20261013_202850_808_game_000002.png` (title) and
`CUSA00697_20261013_202926_208_game_000003.png` (notice) are under that profile's
`user/screenshots`. The process stopped normally with exit code 0.

This establishes real menu input and fresh screenshots without desktop focus
or injected desktop keys. It does not yet establish full gameplay compatibility
of the locally built fork. See [INPUT_IPC.md](INPUT_IPC.md) for reconstruction
and [PORTAL.md](PORTAL.md) for the MCP operations.

### Save field and menu-route experiments

In another checkpoint copy, only header bits 157–164 (LSB-first) were changed
from 0 to 1 and the verified FNV-1a checksum repaired. Runtime session
`builds/portal-saveid1-02` accepted the save and displayed **Story Mode Progress:
1%** (`02-slots.png`), but choosing Story still played Eon's opening cinematic
(`04-story.png`) and loaded Chapter 1, Soda Springs (`05-intro-options.png`).
Chapter Select exposed only Soda Springs (`10-chapterselect.png`). This edit is
not an intro-skip or level-unlock solution. The original checkpoint was not edited.

The separate Arena Challenges menu is reachable through Choose Play without
completing Chapter 1, but the early save leaves its tracks locked: Phoenix Nest
and Brock's Rumble Clubhouse are visibly locked in `24-arena-first.png` and
`23-long-key.png`. Merely navigating there does not establish arena playability.

Desktop XTEST key injection became unreliable during these tests. A private,
short-lived Linux uinput keyboard probe delivered input to the verified owned
game window; no system input configuration was changed. An isolated Xvfb attempt
(`builds/portal-saveid1-xvfb-01`) failed during Vulkan/X11 startup before USB
readiness and was stopped, including its owned display server. That attempt is
not a validated headless testing configuration.

### Direct-start experiment (not a working shortcut)

`builds/runtime-direct/CUSA00697` is another independent full/reflink game copy.
Only its `alchemy.xml` was changed from `startLevel="Title"` to
`startLevel="arena_challenge_303_000"`. REA established that the runtime reads
this setting and constructs a `level/` path (`FUN_00b5fe7e`, Evidence
`ev_b171357e668ac927467df4adbf7dcbef33aaed0f54238ffe7be207af6e47438c`;
startup bootstrap path `FUN_004018d0`, Evidence
`ev_60e1a32a3592e55b483b7cc367db4824bdabe601462d80c8530f4d7703568d6f`).
That proves the setting is consumed, not that normal gameplay initialization
survives skipping Title. The actual test remained a dark/unusable view without
the target arena/HUD for several minutes. It exited normally when stopped.
Evidence: `builds/portal-direct-arena-01/01-direct.png` and `emulator.log`.
Do not use this setting as a documented level-testing shortcut yet.

Original and baseline `alchemy.xml` both remain SHA-256
`4a6ef12f93459c0c696df40d369fc6b840ea742a67fb92d8fa34ab82cab0d35a`;
the experimental copy is
`73f2874def4173e565ed64951ab4df2617e3f705d67f7219a68ef7da0e9c034a`.

## Recorded local baseline, 2026-10-13

- Official shadPS4 SDL release `v.0.19.0`, commit
  `c7e065d1b415be16c23e260a21f1dd8bbfc4cb57`.
- Release: <https://github.com/shadps4-emu/shadPS4/releases/tag/v.0.19.0>.
  Linux SDL ZIP SHA-256 (matched GitHub's published asset digest):
  `a6e3b83fd6c9ea7b29c37e77e1aa687802d4ecd98c2ea794ca9e1d97b24a0cf9`.
  `Shadps4-sdl.AppImage` SHA-256:
  `c6979d6b150f0486e48a61911d4241bbf1cfd07a0adf684e93e2c829bfbc5e4e`.
- EndeavourOS, Linux `7.2.6-arch2-1`, Ryzen 9 5950X, approximately 32 GiB RAM;
  Radeon RX 7900 XT, RADV/Mesa `26.2.2`, hardware Vulkan. No Xvfb was needed.
- Game reports `CUSA00697`, application `01.00`. Its original `eboot.bin`
  was used, not the separately extracted analysis ELF.
- `extracted/CUSA00697` was copied with `cp -a --reflink=auto` to
  `builds/runtime-baseline/CUSA00697`. Checked source/copy inodes were distinct,
  with link count 1. The source game was not edited.
- All emulator state is under `builds/runtime-baseline/profile`. Starting with
  a `user/` directory in that working directory selects the emulator's portable
  profile. XDG data/config/cache roots also point there. **`--override-root` is
  the game's mount root, not a user-profile option.**
- A native Wayland run remained alive until a deliberate 180-second timeout.
  Logs show both studio introduction movies and audio initialization. A second
  run used `SDL_VIDEODRIVER=x11` solely for target-window capture and keyboard
  testing, ending at its deliberate 240-second timeout. It reached the title
  and the missing-portal screen. N is the default keyboard mapping for Cross;
  a held key press was needed for reliable automated input.
- Missing system fonts and trophy-key warnings did not prevent these screens.
  Repeated unimplemented `sceVideoRecordingGetStatus` calls appeared in logs;
  their presence alone is not a crash or a gameplay compatibility verdict.
- Local evidence (excluded from source releases):
  `builds/runtime-baseline/profile/baseline-console.log`,
  `baseline-x11-console.log`, `baseline-x11-window-01.png` (title), and
  `baseline-x11-window-04.png` (missing portal). Captures contain only the owned
  game window, not the desktop.

Checks before and after those baseline runs found unchanged source and copied
file hashes:

| Relative game file | SHA-256 |
| --- | --- |
| `eboot.bin` | `bd5c0433860287599824adb3660964ae623c0505c1300e86cd17e65d5315d3bd` |
| `level/arena_challenge_303_000.bld` | `e299b98dda727e610a08b22ba008eee31bde42e1b5cbc473b4cde1c34e0b26e0` |
| `sce_sys/param.sfo` | `fbf940d7695d841eb006cb485df6d5576203f87bf20ec2e6b4e1c2883f05abbc` |

The release contains a built-in Skylanders USB backend. Its private JSON setting
is `Input.usb_device_backend: 1` (`0` is real USB). Do not use `--config-clean`
when testing a selected backend: that flag forces factory defaults, including
real USB. Backend presence in source does not by itself establish Traptanium
audio/trap support or successful in-game figure swapping.

A third run with backend `1` and without `--config-clean` did pass the portal
check, displayed the autosave notice and then **SELECT A SAVE SLOT / EMPTY**.
No save slot was chosen and no figure was loaded. This owned process was stopped
cleanly with SIGTERM after approximately 3 minutes 50 seconds (exit 0). Evidence:
`builds/runtime-baseline/profile/baseline-portal-console.log`,
`baseline-portal-window-02.png` (autosave notice), and
`baseline-portal-window-04.png` (save-slot selection). This establishes initial
portal recognition only, not trap audio or later gameplay behavior.

The corresponding source is pinned to the release commit:
[portable paths](https://github.com/shadps4-emu/shadPS4/blob/c7e065d1b415be16c23e260a21f1dd8bbfc4cb57/src/common/path_util.cpp),
[settings and backend enum](https://github.com/shadps4-emu/shadPS4/blob/c7e065d1b415be16c23e260a21f1dd8bbfc4cb57/src/core/emulator_settings.h),
[Skylanders backend](https://github.com/shadps4-emu/shadPS4/blob/c7e065d1b415be16c23e260a21f1dd8bbfc4cb57/src/core/libraries/usbd/emulated/skylander.cpp).

The [official shadPS4 README](https://github.com/shadps4-emu/shadPS4) documents
running a game ID or executable path and recommends its QtLauncher for a GUI.
Use the installed build's `--help` for its exact flags. A search of the official
compatibility project did not establish a matching CUSA00697/Linux result during
this investigation; that bounded search does not prove incompatibility.

Obtain emulator binaries from the official project. Supply any required system
modules from your own console; none are included here. See the
[official compatibility project](https://github.com/shadps4-compatibility/shadps4-game-compatibility)
for its reporting rules and module requirements. Keep modded-game reports private
or in an appropriate modding project: that tracker requests unmodified dumps.

## Isolate tests

Keep the original PKG and extracted game tree immutable. Make a separate full
copy or filesystem reflink copy for testing; do **not** use hard links, because an
in-place write through a hard link also changes the original. Verify the source
hash before and after each experiment. Back up saves and use a disposable profile.

No script in this repository installs a modified archive into the original game,
changes emulator configuration, supplies firmware, or repacks/signs a PS4 PKG.
Only copy the generated outer `.bld` into its matching relative path in your
disposable test tree, once you have a working baseline and have reviewed its
manifest. Leave the sibling `.arc` and all other dependencies intact.

## Four test stages

| Stage | Input | Pass criterion |
| --- | --- | --- |
| A: original baseline | Unmodified extracted game | Reach and play the target arena; record emulator version, configuration and logs |
| B: no-op outer repack | Original inner IGZ reinserted by `iga_replace.mjs` | Same arena still loads and behaves like A |
| C: one scalar edit | One verified actor/marker moved slightly | The intended effect is visibly observed; no new loader or gameplay failures |
| D: authored layout | Crossfire recipe or another explicitly designed set of edits | Check every spawn, floor contact, collision, camera, navigation, completion and reload |

If A fails, do not attribute it to the editor. If B fails, investigate archive
layout, streaming/disc-map assumptions and dependencies before touching more IGZ
fields. If C loads but nothing changes, inspect whether that actor is a template
or a script overwrites its position. A screenshot of the editor is not evidence
that any of these stages passed.

The current append-only repacker leaves the name table before appended raw data.
Readers accept that structure, but the game's acceptance is untested. An archive
can grow substantially because the original compressed member remains as unused
bytes and the replacement is uncompressed.

## Offline checks you can run now

These require only your local extracted files and built tools:

```bash
SKYLANDERS_TEST_LEVEL=/absolute/path/to/original-inner-level.bld \
SKYLANDERS_TEST_ARCHIVE=/absolute/path/to/level/arena_challenge_303_000.bld \
SKYLANDERS_TEST_EXTRACTOR=/absolute/path/to/iga_extract \
  node --test tests/level_builder.integration.test.mjs

node editor/tests/real_integration.mjs \
  /absolute/path/to/skylanders-level-editor \
  /absolute/path/to/tools/level_builder.mjs \
  /absolute/path/to/original-inner-level.bld
```

The recipe test requires the exact original challenge303 payload hash. The MCP
integration requires a tfbActorInfo with a name containing `LeftSpawn`. Both retain
new temporary outputs for review and never modify their input. Full member
preservation of the smaller no-op archive is covered by the separate archive
roundtrip integration test described in [ARCHIVE_REPACK.md](ARCHIVE_REPACK.md).

## Record template

Record these fields per stage in a local text/JSON note:

```json
{
  "stage": "A/B/C/D",
  "date": "",
  "gameId": "CUSA00697",
  "gameVersion": "",
  "emulatorVersionAndCommit": "",
  "osGpuDriver": "",
  "inputArchiveSha256": "",
  "inputInnerIgzSha256": "",
  "recipeOrManifest": "",
  "targetArenaAndHowReached": "",
  "saveAndPortalConfiguration": "",
  "observedResult": "",
  "logPath": "",
  "screenshotOrVideoPath": "",
  "passed": false
}
```

Review logs for private paths and remove game data before sharing. Do not call
the project a full level builder until new scene geometry/physics, encounter
logic, dependencies and loading have been implemented and verified together.
