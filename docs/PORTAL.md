# Virtual Traptanium Portal and figure swaps

The installed official shadPS4 **v0.19.0** already emulates the Skylanders USB
portal. We do not need to implement a second USB device or use a physical portal.
With `Input.usb_device_backend = 1`, the original CUSA00697 game passed its
missing-Traptanium-Portal screen and reached save-slot selection. This is runtime
evidence of portal recognition; it is not yet evidence of every trap or audio
feature. See [runtime results](RUNTIME_TESTING.md).

`tools/portal_controller.mjs` controls an owned emulator process through its
existing stdin IPC. It supports insertion, removal, replacement, and blank
synthetic figure creation. It can run as an MCP server or as a JSON-lines service.
It does not download figure dumps, game files, keys, or firmware.

## Safety and scope

- Use a disposable **copy/reflink** of your extracted game, never hard links.
- Every launch requires a **new** session directory. All saves, emulator settings,
  logs and writable virtual figures are placed there. Parent directory must exist.
- Original figure files are never handed to the emulator directly. Each insertion
  makes a private writable copy: the game can write figure XP and progress.
- To preserve that progress across a later insertion, select the returned
  `writableCopy`, not the original blank record. Keep the entire session directory.
- Up to 16 RFID records are tracked. SWAP Force top and bottom halves are separate
  records in separate slots, not a single merged figure file.
- Slots are controller-side state: upstream IPC has **no load/remove acknowledgment**.
  Observe the game's screen to establish recognition. A successful command response
  alone does not prove the character appeared.
- Unknown/empty slots cannot be removed, occupied slots cannot be inserted into
  directly, duplicate serials are rejected, and paths with protocol delimiters are
  rejected. These guards avoid unsafe edge cases in upstream's raw IPC handler.
- Swaps send removal, wait 750 ms, then insert. This is a practical status-report
  allowance, not a guaranteed game acknowledgment.
- The controller does not patch game memory, bypass encrypted PKG protection, or
  implement portal-speaker playback. Upstream's OUT endpoint currently just logs
  receipt; firmware/version responses are not proof of working speaker audio.

## Start the MCP server

```bash
node /absolute/path/to/skylanders_reverse_engineer/tools/portal_controller.mjs --mcp
```

Configure this command in your MCP client's server settings if desired; it is
separate from the level editor's C++ MCP server. No automatic global configuration
change is made. Tools are `portal_start`, `portal_status`, `portal_create_figure`,
`portal_insert`, `portal_remove`, `portal_swap`, `portal_checkpoint`, `portal_stop`,
`portal_input`, `portal_capture`, `portal_sequence`, and `portal_cancel_sequence`.
Input/capture/sequence require the documented local input-IPC fork; all original
tools still work with the official v0.19 binary.

Example `portal_start` arguments:

```json
{
  "emulator": "/absolute/path/to/Shadps4-sdl.AppImage",
  "game": "/absolute/path/to/disposable/CUSA00697/eboot.bin",
  "session": "/absolute/path/to/existing-parent/new-portal-session",
  "x11": true
}
```

`x11` optionally selects SDL's X11 backend on Linux. The fork's input and game
capture tools do not depend on desktop focus, X11 key injection, or desktop capture.
Do not use `--config-clean`: it resets the portal backend to real USB.
The launcher supplies `--ignore-game-patch`, windowed mode, and an isolated profile.
Do not put a real `libSceUsbd.sprx` in the disposable game's `sce_module` directory;
that would bypass the HLE emulated backend and is rejected by the controller.

Call `portal_status` until `usbBackendReady` is true. This gate uses the pinned
version's post-HLE linker log to prevent an early null-backend IPC call. It is not
the game's portal-recognition acknowledgment. If the expected log never appears,
inspect `emulator.log`; do not force commands into an unknown emulator version.

The controller keeps logging enabled and the readiness marker visible, but sets
`Log.sync=false` to avoid making emulation threads perform synchronous NAS log
writes. In the pinned source, `common/logging/log.cpp::UpdateSinks` routes the same
console/file sinks through `spdlog::sinks::async_sink`; that sink's default overflow
policy blocks instead of dropping messages. The readiness gate waits for actual
receipt of the post-HLE log, so delayed asynchronous delivery is safe. Raw IPC
acknowledgments are written separately to stderr. This is source-backed reasoning
and synthetic protocol coverage, not a measured frame-rate improvement; slow
storage can still cause backpressure when the logging queue fills.

Create a blank figure with `portal_create_figure`, for example:

```json
{"figureId":462,"variant":12288}
```

This creates Snap Shot's ID/variant (`462`, `0x3000`) with a fresh random serial,
valid header CRC and blank progress. Use the returned path with:

```json
{"slot":0,"file":"/absolute/path/returned-by-create.sky"}
```

Pass that to `portal_insert`. For another character, create a second record and
call `portal_swap` with its path and the same slot. `portal_remove` takes only
`{"slot":0}`. `portal_stop` closes only the emulator launched by this controller.
Closing the controller's stdin also stops its owned child.

Useful upstream-listed IDs (identification data, not prebuilt dumps):

| Figure | ID | Variant |
| --- | ---: | ---: |
| Spyro | 16 | 0 |
| Food Fight | 476 | 0 |
| Snap Shot | 462 | 12288 (`0x3000`) |
| Blast Zone bottom / top | 1004 / 2004 | 0 |
| Wash Buckler bottom / top | 1015 / 2015 | 0 |

The same service also accepts one JSON object per line directly:

```json
{"id":1,"operation":"portal_status","arguments":{}}
```

This is useful for scripts; keep stdin open for the life of the session. Logs go
to the session directory, not the JSON response stream. `portal-events.jsonl`
records commands and managed file paths for repeatable testing.

## Fast owned-game input and screenshots

Build or use the separate executable described in [INPUT_IPC.md](INPUT_IPC.md),
then pass its path to `portal_start`. `portal_status.capabilities` must report
`inputPulse: true` and `captureGameFrame: true`. Capability detection uses the
emulator's stderr handshake, not its filename. The official binary returns
`UNSUPPORTED_CAPABILITY` for these tools without receiving unsupported commands.

Example MCP `portal_input` arguments:

```json
{"kind":"button","name":"cross","durationMs":100}
```

Kinds are `key`, `button`, and `axis`; named inputs are listed in
[the fork protocol](INPUT_IPC.md#timed-input-protocol). For example, `key`/`enter`
presses the profile's Enter binding, and `axis`/`left_y_minus` moves the left stick
forward. Durations are 10–2000 ms. The controller uses monotonically increasing
request IDs and waits for **both pressed and released acknowledgments**, with a
deadline of duration + 3000 ms. It reports `gameAccepted: false` because input
delivery does not prove a menu or action was accepted. A missing release blocks
further inputs until its late release is observed or the session is stopped.

Follow one action with MCP `portal_capture`:

```json
{"timeoutMs":10000}
```

Timeout is optional, defaults to 10000 ms, and accepts 250–30000 ms. Requests are
spaced to respect the fork's 250 ms capture limit. A successful result includes
`path`, `sha256`, `width`, `height`, `bytes`, `fresh: true`, and `gameOnly: true`.
The controller first waits for the queue acknowledgment, then finds a **new**
`_game_*.png` inside this session's `user/screenshots`. It rejects old filenames,
overlay-only images, symlinks/external paths, incomplete PNG chunk sequences, and
files larger than 64 MiB. It does not trust a path merely printed in a log.

Native PNG filenames do not contain request IDs: use only one capture source at
a time. If a sent capture times out, a late image could be ambiguous, so further
captures are refused until a new owned session is started. The controller never
substitutes an older screenshot. A `queued` acknowledgment alone is not success.
Input/capture events and their acknowledgments are recorded in
`portal-events.jsonl`. `portal_stop`, process exit, and controller disconnection
cancel pending work and preserve owned-process shutdown behavior.

These tools neither focus desktop windows nor send desktop keys. The image is
the game's own rendered frame (including its HUD), without emulator overlays.
Synthetic test coverage validates the protocol and file checks; actual game
response must still be observed in an owned runtime test.

### One interaction per second, without agent round trips

`portal_sequence` executes a short plan **inside the controller**, so it does
not wait for another model response, RPC, or screenshot between inputs:

```json
{"steps":[{"kind":"button","name":"pad_right","durationMs":100},{"kind":"button","name":"pad_right","durationMs":100},{"kind":"button","name":"pad_right","durationMs":100}],"intervalMs":1000}
```

Call it only from a known screen; the example moves three menu items right.
The default `intervalMs` is 1000 (one start per second), adjustable to 100–2000.
There are 1–30 steps and at most 30 seconds of planned input. Each hold must be
at least 10 ms shorter than the interval, allowing a released frame. Actual
game frame rate determines the minimum reliably recognized pulse/gap; the
minimum API values are not a promise that a low-FPS game sees every input.
The entire plan is validated before sending, and each press/release is still
acknowledged. Late replies stretch the schedule; they never cause a catch-up
burst. Results include `startedMs` and `releasedMs` for every completed step.

There is **no automatic screenshot per step**. Call `portal_capture` at the end
of a known segment and at loading/state boundaries. Use the small segments in
[arena_route_inputs.json](../recipes/arena_route_inputs.json); they deliberately
stop at loading screens. The controller does not detect the game's UI or know
whether a pulse was ignored. A long blind macro is not a reliable level loader.

`portal_cancel_sequence({})` and `portal_status({})` work while a sequence RPC
is running. Cancellation stops later steps, interrupts inter-step waiting, and
still awaits a bounded release for a pulse already pressed. A failed sequence
returns `sequenceProgress` with completed steps and `retrySafe:false`; never
replay the whole plan blindly. Use cancellation before another queued command
when a route goes off track. Controller disconnection cancels an active plan;
the existing owned-child teardown remains in force.

Measured in the actual game on 2026-10-13 (`builds/portal-crossfire-01`): native
requests 11–14 started 991/1000/1000 ms apart. Each 100 ms pulse was released
after 100–101 ms; presses were acknowledged in the same logged millisecond.
Fresh 1920×1080 PNG capture took about 245 ms. Tool-wrapper round trips were
about 353 ms per pulse. The final frame showed Exhaust Junction selected,
confirming those menu inputs were accepted. This is a small measured sample,
not a hard-real-time guarantee or an emulator frame-rate benchmark. Disk stalls,
game loading, animations, and model reasoning still have real latency.

The new `portal_sequence` itself was then exercised in the real emulator in
`builds/portal-fast-route-01`. Five steps (Right, Cross, Right, Right, Right)
from the settled Choose Play / Story screen reached Exhaust Junction. Local
JSONL request27 completed all five in4106ms; native send offsets were
1/1002/2003/3004/4006ms, with press ACKs0.18–0.71ms after send and releases
100.3–100.9ms after send. Fresh screenshot suffix000013 confirmed the final
menu. A separate four-Right sequence also visibly advanced the pause carousel.

Transition-frame pitfall observed in the same test: an immediate screenshot
after a two-Cross sequence still showed the outgoing save-slot screen although
the selection had already advanced. Sending another Cross based on that frame
started Story. Recovery via pause → Main Menu → Yes worked without restarting
the emulator. Therefore **fresh is not the same as settled**: at animated state
boundaries allow the transition to finish and inspect a new frame before
deciding on the next action. Do not infer ignored input from one outgoing frame.

## Save a checkpoint and resume faster

Call `portal_checkpoint` with `{"output":"/absolute/path/to/new-checkpoint"}`.
It first stops the owned emulator, then copies its saved-game profile and virtual
figures into a new directory with a SHA-256 inventory. This avoids copying saves
while the game is writing. It does **not** capture emulator RAM or an exact frame.

For an already stopped controller session, the equivalent command is:

```bash
node tools/runtime_checkpoint.mjs /path/to/stopped-session /path/to/new-checkpoint
```

On the next controller launch, add `"resumeFrom":"/path/to/checkpoint"` to
`portal_start`. Keep `session` a different, new directory. The tool verifies all
file hashes, restores the profile, and reinserts the recorded figures after USB
initialization. Changes then affect only the new session; the checkpoint stays
unchanged. The game still boots normally and resumes according to its own save
semantics. A profile copy does not by itself bypass every logo, intro or level.

Local checkpoint `builds/checkpoint-first-level-01` preserves the first playable
level reached with Snap Shot and the successful swap to Food Fight, plus save
slot 1 and Food Fight's writable figure state. The exact route was: launch with
portal backend 1; Cross at title; accept autosave notice; create save slot 1;
accept Medium difficulty; allow initial story cinematic; virtual Snap Shot
appears; swap slot 0 to Food Fight. Default keyboard Cross is **N**. All local
checkpoints and figure records are excluded from source releases.

## Evidence and protocol references

Pinned core source is commit `c7e065d1b415be16c23e260a21f1dd8bbfc4cb57`:

- [IPC framing and USB commands](https://github.com/shadps4-emu/shadPS4/blob/c7e065d1b415be16c23e260a21f1dd8bbfc4cb57/src/core/ipc/ipc.cpp).
- [Portal protocol, RFID slots, read/write handling and Trap Team version response](https://github.com/shadps4-emu/shadPS4/blob/c7e065d1b415be16c23e260a21f1dd8bbfc4cb57/src/core/libraries/usbd/emulated/skylander.cpp).
- [USB backend selection](https://github.com/shadps4-emu/shadPS4/blob/c7e065d1b415be16c23e260a21f1dd8bbfc4cb57/src/core/libraries/usbd/usbd.cpp).
- [Upstream launcher figure creation and ID list](https://github.com/shadLaunchers/shadLauncher4/blob/9619778a28cfa15efea234207127f2bfcb986106/src/qt_ui/skylander_dialog.cpp).

The local generator independently implements the documented record layout and
standard CRC-16/CCITT-FALSE. It does not contain figure-save payloads from a toy.
Game acceptance of any newly generated ID/variant still requires runtime testing.
