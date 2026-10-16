# Native preview and direct startup

Status: 2026-10-16. Know-It-All Island reaches controllable gameplay without
menu input at the **12.31-second sample**, measured from emulator spawn. The
ten-second goal has not been met. Fresh edited-copy preparation is separate
(8.50 seconds in one local measurement). A file-open event alone is not proof
that a map is playable. See [one-click setup](GAME_PREVIEW.md).

## Isolation and supported build

All native startup tests use the private base
`/home/peridot/.local/share/skylanders-editor/fastboot-01`.
Its `preparation.json` records source files and hashes. Observed hot files were
materialized locally; unobserved assets may still link to the user's NAS.
This is not a fully local game installation.

Original extracted archives, earlier working installations and saves remain
unchanged. Modified archives and screenshots are private game-derived assets.
Never distribute them with the source release. Installers preserve earlier
candidates as named backups and require the isolated emulator to be stopped.

Supported executable ELF SHA-256:
`423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3`.
The source-bound script graphs retain object identities and native opcode
evidence; they are not recovered original source code or a complete interpreter.

## Measured runs

`research/benchmark-fastboot.mjs` launches an owned emulator, sends no menu
input, captures at5/10/15/20/30seconds, then stops it. Logs, capture hashes and
`boot-observation.json` are retained. Milestones use monotonic time from
process spawn; preparation/restoration is separate. A cold pipeline cache is
not a cold OS file cache. Sparse screenshots cannot exclude a transient frame.

| Run under `fastboot-01/runs` | Observed result |
| --- | --- |
| `baseline-cold-01` | Original title: Activision movie at9.33s, TFB17.04s, Beenox27.20s. |
| `stage1-cold-01` | Studio movies skipped, but legal/title prompt remain; no map load. |
| `stage2-cold-01` | Reads header/slot automatically, then crashes at runtime PC0x882b1c. |
| `stage1-manual-01` | Manual selection reproduces that crash: not caused by auto-selection. |
| `stage2-fixed-cold-01` | Owner-qualified variable access prevents crash; unbacked load-string localization causes black output and item/.bld lookup. |
| `resident-legalzero-cold-01` | Correct resident load string and zero legal durations; incomplete title initialization still leaves black output. |
| `postslot-comparison-01` | Original title lifecycle loads the correct map/cinematic after manual confirmation at52.995s; not zero-input or playable-time acceptance. |
| `native-title04-cold-01` | Real controller binding retained, title presentation hidden: map opens at4.235s with no menu input. Original map cinematic still runs. |
| `native-title04-no-intro-01` | Map opens at4.047s. At10.231s figure-entry MagicMoment remains. At12.310s player exists at spawn; normal500ms stick pulse moves it3.52game units. Later pulses also work. Clean stop. |

Acceptance report:
`fastboot-01/runs/native-title04-no-intro-01/playable-acceptance.json`.
The12-second native frame inside that run is
`user/screenshots/CUSA00697_20261016_093918_013_game_000004.png`.
The sample establishes playable **by**12.31s, not the exact first playable frame.

## Native startup path and corrections

The original Title variable `title force load to level` is frame-local, not a
global ScriptReference. Direct access from a menu callback used the wrong
context and caused the first crash. The corrected patch follows the original
`OpFindVariable` pattern qualified by `Title_Main`.

`tools/native_fastboot_title.mjs`, stage `auto-slot`, preserves bootstrap
readiness, asynchronous save-header/slot loading, error handling and controller
binding. It requests existing slot0, never new-save creation. The original
successful-load callback runs before the target is assigned.

A StringInfo object's name is not its localized runtime value. The patch
reuses the original registered global string `Level_314_Tutorial_2`, not an
unbacked newly named object. Title04 preserves the original title actor
startup, native primary-controller binding and portal readiness. Its existing
opaque backdrop covers initialization until ordinary title shutdown.
Title graphics, autosave explanation and save-slot menu are bypassed, not
clicked through. Original menus remain intact outside the private preview.

Studio movies and earlier `item/legal` are different paths.
`tools/native_fastboot_legal.mjs` sets the three original fade/hold durations
to zero while retaining readiness, creation, cleanup and bootstrap completion.
A transient legal frame is still possible; the patch does not remove the
sprite lifecycle.

`tools/native_fastboot_map.mjs` changes only chapter314's intro-stream
argument to its existing typed-null operand and reconciles two reference
counts. Spawn, player initialization, resources, later dialogue and gameplay
scripts remain. It passed the native launch/movement check above.

| Accepted derived asset | SHA-256 |
| --- | --- |
| title archive | `98cbc704b29b0a419260406e8a693797e36ca7380c6619273339e342f1c11d2d` |
| legal archive | `4842d75c8e297e13a55f5c0815159a360c78f954676cd8af80782182382374a3` |
| chapter314 inner | `53377a242c43029fdcc7dac35857ce2a106cb0ff9458a0adf163cc336c1cb3a6` |
| chapter314 outer | `e6507ce7f1eb97b6c1e96886045934c0a5a533fccd2bc80214e7d4ed555bc7e3` |

Builders emit `runtimeValidated:false` because generation does not itself
launch an emulator or establish success on another machine/save. Research
entry points remain compatibility wrappers around the portable tools.

## Camera, HUD and live display

The PNG fallback works but is a snapshot, not video. The experimental X11 host
attaches only the exact controller-owned SDL window, keeping its Vulkan
renderer. Reparent success alone is not visual acceptance. A grey-pane fault
was reproduced: SDL applied desktop coordinates relative to the Qt host,
placing the child outside its pane. Enforcing local0,0 fixed the tested run.
`builds/runtime-camera-livehost-02/native-host-owned-01.png` shows the actual
textured chapter314 in Qt; a PID-checked XComposite pixmap capture of only the
owned window provided the evidence. That session issued zero native PNG
capture calls. Held-button capture and the integrated workspace are being
tested separately.

Native camera evidence:
`research/rea-native-camera-2026-10-16-final.json` and reopenable
`research/rea-native-camera-session-2026-10-16.json`.
The live resolver follows CRender → igRenderContext → the exact main-camera
table entry; it does not use a guessed heap pointer.
`research/native-camera-proof-02.json` establishes translation/rotation,
unchanged projection, stability while the player moves, and manual/timed/stop
restoration. A separate Qt keyboard/mouse/HUD test passed with PNG feedback
in `builds/runtime-camera-ui-01`; this is not proof of live hosting.

Controls are WASD, Q/E vertically, right-mouse look, Esc to restore.
Movement uses elapsed-time33ms stepping and a renewable watchdog, not a
15-second GUI timeout. Two-second heartbeats renew an eight-second lease and
retain the original restoration bytes and current pose. Process/binding
identity is revalidated; renewal does not restart the hold. The old50-unit
tether is removed. Speed is saved and adjustable from0.1 to100 game units/s.
Synthetic tests cover continued holds beyond24seconds, travel beyond1000units
and restoration when heartbeats stop. Native chapter314 hold lasted149seconds.
Free-camera travel does not force distant map sectors to stream in.
Close, expiry and owned-controller shutdown restore the original camera.
PNG batches are separately bounded; live hosting must not consume PNG requests.

The HUD field is `tfbViewerParameters._drawSpriteScene` at+0x50. REA
metadata and native render preparation establish its identity and copy into
the sprite pass. Subsequent native Qt tests hid the HUD while preserving the
world. Restoration is read back; visual checks must wait for a later rendered
frame rather than capture immediately after the acknowledgment.
Evidence: `research/rea-native-hud-2026-10-16.json` and reopenable
`research/rea-native-hud-session-2026-10-16.json`.

## Remaining acceptance checks

- Zero-input playable314, legal cleanup and map-intro bypass: passed for the
  exact isolated combination above.
- Reduce figure-entry delay without breaking later swaps or portal errors.
  No untested global portal-UI suppression belongs in the accepted base.
- Measure more cold/warm runs without competing emulators.
- Finish actual live-host output, held-button mouse capture, focus and restore
  checks; PNG success does not substitute for these.
- Verify the complete Play current map → prepared copy → native view path.
  Profile/backend and synthetic GUI start/restart checks pass separately.
- Other chapters require explicit exact-hash bindings. Arbitrary custom
  chapter launch and distant camera-driven streaming are not established.
