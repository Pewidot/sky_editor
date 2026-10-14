# Owned-emulator input IPC fork

This local shadPS4 extension sends timed inputs directly to the **owned emulator's SDL event loop**. It does not inject desktop events, create a system-wide input device, or require a focused host window. The official executable and the pinned `tools/vendor/shadps4/source` tree remain unchanged.

Base: shadPS4 v0.19.0 commit `c7e065d1b415be16c23e260a21f1dd8bbfc4cb57`. The separate worktree is `tools/vendor/shadps4/source-input-ipc`. The reproducible changes are in `tools/patches/shadps4-input-ipc.patch`; they are GPL-2.0-or-later, like the modified upstream files. No game assets are included.

The extension is available only through shadPS4's existing opt-in stdin IPC (`SHADPS4_ENABLE_IPC=true`). Keep using an isolated session/profile and the owned-process portal controller; do not send these commands to unrelated desktop processes. The unmodified release does not implement these commands. Check advertised capabilities before sending them.

The managed MCP interface is now implemented in `tools/portal_controller.mjs`:
`portal_input({kind,name,durationMs})` awaits press and release, and
`portal_capture({timeoutMs?})` returns a fresh complete game PNG from the owned
profile. See [portal setup and timeout behavior](PORTAL.md#fast-owned-game-input-and-screenshots).
Prefer these bounded operations over manually writing raw IPC commands.

## Build independently of the pinned checkout

Use a new worktree path if this one already exists. Run from the toolkit root:

```sh
git -C tools/vendor/shadps4/source worktree add --detach ../source-input-ipc \
  c7e065d1b415be16c23e260a21f1dd8bbfc4cb57
git -C tools/vendor/shadps4/source-input-ipc apply --check \
  /absolute/path/to/tools/patches/shadps4-input-ipc.patch
git -C tools/vendor/shadps4/source-input-ipc apply \
  /absolute/path/to/tools/patches/shadps4-input-ipc.patch
git -C tools/vendor/shadps4/source-input-ipc apply \
  /absolute/path/to/tools/patches/shadps4-host-headers.patch
```

The tested host has Clang 22.1.8, CMake/Ninja, GCC 16's standard-library headers, and system SDL3 3.4.16, FFmpeg 9.0.1, fmt 12.2.0, FreeType, Vulkan headers, PNG, OpenAL, zlib, and other development libraries. The separate `shadps4-host-headers.patch` changes one upstream include from `fmt/core.h` to `fmt/format.h` and adds two missing `<cstring>` includes. These modern-toolchain header fixes do not change input or rendering behavior. A full emulator build also needs upstream's pinned submodules, even though the input extension itself uses only SDL and the C++ standard library. The upstream Linux build instructions are in `documents/building-linux.md` inside the source tree.

These are the additional submodules used by this host's system-library configuration:

```sh
git -C tools/vendor/shadps4/source-input-ipc submodule update --init --recursive --depth 1 --jobs 8 -- \
  externals/spdlog externals/LibAtrac9 externals/imgui externals/sirit \
  externals/tracy externals/hwinfo externals/minimp3 externals/ImGuiFileDialog \
  externals/aacdec/fdk-aac externals/cpp-httplib externals/vma externals/glslang \
  externals/xbyak externals/magic_enum externals/toml11 externals/zydis \
  externals/libusb externals/miniz externals/CLI11 externals/miniupnp \
  externals/libressl externals/abseil-cpp externals/protobuf externals/zstd \
  externals/zarchive externals/half
```

On another system, initialize any additional dependencies reported missing by CMake. The upstream general alternative is `git submodule update --init --recursive` in the **fork**, but it downloads substantially more data, including dependencies not used on Linux.

```sh
input_build=$(mktemp -d /tmp/skylanders-shadps4-input-build.XXXXXX)
cmake -S tools/vendor/shadps4/source-input-ipc -B "$input_build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
  -DENABLE_SYSTEM_LIBRARIES=ON -DENABLE_DISCORD_RPC=OFF -DENABLE_UPDATER=OFF
cmake --build "$input_build" -j 4
```

The resulting executable is `$input_build/shadps4`. Four jobs limit contention with a running game; a full build still takes time and several GiB. The initial build used four jobs, then eight with sufficient memory available. For future builds, put both the source worktree and build directory on local storage: metadata reads from this workspace's NAS dominated compilation time even with a local build directory. A `/tmp` build directory is temporary: preserve the executable/build path explicitly if needed. Building is not a claim of runtime compatibility; test the fork against an unchanged disposable game tree before testing modified levels.

The locally completed build is installed separately at `tools/vendor/shadps4/input-ipc/shadps4`, SHA-256 `67256a057061d3175f307143a150001cfce468d97879d1c836c203eebd10c345`. Its sibling `INSTALLATION.json` records the source and patch hashes. Full compilation/link and a second no-work rebuild passed. ELF inspection found system shared-library dependencies but no temporary build-directory RPATH or shared-library dependency. This is a host-specific Linux binary, not a portable AppImage; rebuild on other systems. The build task did not launch a game.

## Timed input protocol

The initial IPC capability block adds `;ENABLE_INPUT_PULSE_V1` and `;ENABLE_CAPTURE_GAME_FRAME_V1`. Capabilities and acknowledgment lines are on **stderr**, alongside the emulator's existing IPC/log output; commands are on stdin. Existing `RUN`, `START`, portal and `STOP` commands remain unchanged.

Each pulse is five newline-terminated lines:

```text
INPUT_PULSE
1
button
cross
100
```

Fields are a positive request ID, kind, name, and duration in decimal milliseconds. Use monotonically increasing IDs within one emulator process; accepted IDs cannot be reused. Duration is limited to **10–2000 ms**, with at most **16 active pulses**. A second pulse on an already-held synthetic input is rejected instead of prematurely releasing the first one.

| Kind | Names |
| --- | --- |
| `key` | SDL named keys, for example `enter`, `space`, `escape`, `w`, `a`, `s`, `d`, `f12` |
| `button` | `cross`, `circle`, `square`, `triangle`, `options`, `share`, `l1`, `r1`, `l3`, `r3`, `pad_up`, `pad_down`, `pad_left`, `pad_right` |
| `axis` | `left_x_minus`, `left_x_plus`, `left_y_minus`, `left_y_plus`, corresponding `right_*` names, `l2`, `r2` |

Gamepad inputs target the first existing emulated controller through its normal bindings; the patch does not create users or connect host hardware. Keyboard pulses also follow the emulator's configured input bindings, so `w` means whatever that profile binds to W. Axis directions use ±127 and return to zero. Do not mix physical and synthetic holds of the same input while automating.

The main event loop emits:

```text
;INPUT_PULSE 1 pressed
;INPUT_PULSE 1 released
```

The timer starts when the main thread applies the press. This avoids collapsing a queued press/release pair while a game is loading. Input state is mutated only on that main thread. Timers enqueue releases; a temporarily full queue retries key-up rather than dropping it. Duration bounds apply to the requested timer: a stalled main thread can delay actual release, so this is not a real-time timing guarantee. Normal `STOP`, stdin EOF and window teardown release held synthetic inputs. Cancellation reports `cancelled_released`; validation/duplicate/busy errors report an `error...` state. These messages confirm input delivery, **not** that a game menu accepted the action.

Inputs bypass host focus and ImGui's event consumption and intentionally go to the emulated controller/binding path. They do not navigate native host dialogs or arbitrary desktop windows. Prefer one action followed by a fresh in-emulator screenshot over blind long button sequences.

## Fresh game screenshots

For a game-only image independent of input bindings and RenderDoc:

```text
CAPTURE_GAME_FRAME
2
```

The ID must be positive and commands are limited to one per 250 ms. A valid request produces `;CAPTURE_GAME_FRAME 2 queued`. That is a queue acknowledgment, not image completion. The existing Vulkan presenter later logs **`Saved screenshot: <path>`** after writing its PNG. Wait for a new saved-file log/path, not an old screenshot already present in the directory. Send at most one outstanding capture when correlating IDs to filenames; the existing filename format does not contain the IPC request ID.

Files are generated by the emulator in its profile's `user/screenshots` directory with a timestamp and sequence number. No arbitrary output path is accepted by this IPC command. With the owned portal session, that directory is private to the session. If the game stops presenting frames, a request may remain pending; do not report an older file as a new capture.

Alternatively `INPUT_PULSE` / `key` / `f12` invokes the default `hotkey_capture_frame` binding. With normal settings it requests the same game-only PNG; if RenderDoc is injected, that binding instead triggers a RenderDoc capture. The dedicated command avoids this ambiguity.

## Synthetic validation

This test runs SDL event/timer code without a window, emulator or game:

```sh
clang++ -std=c++23 -O2 -Wall -Wextra -Wpedantic tests/input_ipc_pulse.cpp \
  -I tools/vendor/shadps4/source-input-ipc/src \
  $(pkg-config --cflags --libs sdl3) -o /tmp/skylanders-input-ipc-test
/tmp/skylanders-input-ipc-test
```

It checks parser bounds, F12/Enter/axis names, correct event namespace separation, timed release, duplicate and replay rejection, cancellation, stale timers, and the active-pulse limit. The same test passed with Clang AddressSanitizer and UndefinedBehaviorSanitizer (`-O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer`). Actual in-game menu response and PNG capture require a separate owned runtime test. The standalone test cannot establish those outcomes.
