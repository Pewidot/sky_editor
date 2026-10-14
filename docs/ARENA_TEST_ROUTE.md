# Disposable arena test route

This experiment changes one existing Title-menu comparison to make the arena
debug access path available without first completing the story. The field,
operator values, exact changed byte, and archive round trip are verified
offline. **The Title route reached Exhaust Junction / You're MINE, loaded
arena303 and started its battle.** The four-spawn Crossfire challenge also
reached battle; precise position effects and completion remain pending.
Returning after a loss initially loaded a separate, unpatched menu and locked
the tracks again. Its additional exact-hash patch profile subsequently allowed
re-entry through the challenge menu to character confirmation.
This is a testing shortcut, not a new level, a completed save, or a supported
general-purpose unlocker.

The recipe is [tools/arena_test_gate.mjs](../tools/arena_test_gate.mjs). It accepts
only the exact CUSA00697 Title/return-menu payloads identified below and creates a new file
and manifest. Never apply it to the original extracted game or the recommended
resume checkpoint. Only source code and this recipe are distributable here;
the game payloads, rebuilt archives, saves, and captures are private local data.

## Exact edit and native evidence

All payload offsets below are hexadecimal **file offsets within the decompressed
`level.bld` member**, not offsets in the outer `level/title.bld` archive.

| Item | Verified location/value |
| --- | --- |
| Object | `OpCheckValue #15036`, offset `0x18c29c`, size `0x50` |
| Left operand | `_LHS +0x38`, slot `0x18c2d4` -> `ValueStack #15037` |
| Operator | `_relOperator +0x40`, slot `0x18c2dc`, little-endian u32 |
| Right operand | `_RHS +0x48`, slot `0x18c2e4` -> `ValueRHSVariant #1237` -> integer zero |
| Original operator bytes | `04 00 00 00`, `GT_OP` (`>`) |
| Test operator bytes | `02 00 00 00`, `GE_OP` (`>=`) |

The resulting predicate is `arena select data.DEBUG unlock all >= 0`, originally
`> 0`. Exactly one payload byte changes: offset `0x18c2dc`, `04` -> `02`.
There are no new objects, strings, pointers, fixups, scripts, or geometry.

Native REA evidence from the analysis ELF establishes the field and enum, rather
than relying on the apparent order of comparison strings:

- `OpAbstractCheckValue` field initializer `FUN_00b95068`:
  `_LHS=0x38`, `_relOperator=0x40`, `_RHS=0x48`.
  Evidence `ev_6a3c193c0cc50c18e02c0d6488a63ee33f0085e3b93861f48ad0b0aab22a1868`.
- `RelOp` initializer `FUN_0046c690`: six names at VA `0xf55e50`, with signed
  32-bit values at VA `0xc7f4d0`. The pairs are `LE_OP=0`, `EQ_OP=1`, `GE_OP=2`,
  `LT_OP=3`, `GT_OP=4`, `NE_OP=5`.
  Evidence `ev_e1147d40e866f6d375a541e2721133de67ad27cc11122dcba2731f4ecd393d25`.

[tools/elf_metadata.mjs](../tools/elf_metadata.mjs) reproduces these tables from
the original analysis ELF, applying its PS4 relative relocations. It pins ELF
SHA-256 `423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3`.
These are static shipped-binary observations, not an execution trace.

## Why one field affects both arena gates

Title's `UI_ArenaSelect.ai` is `tfbScriptInfo #13622`, with `OpCodeList #13623`.
Rows below are zero-based positions in that list, not object indices.

| Consumer | Shared check row | Following successful branch |
| --- | ---: | --- |
| `arena ui - get arena unlocked/completed` (`#14293`) | 1358 | `OpSetValue #15033` writes `return unlocked = 1`, then flow-end |
| `arena ui - get track unlocked` (`#13664`) | 1367 | `OpSetValue #15041` writes `return unlocked = 1`, then flow-end |

Those are the check object's only two ordinary incoming pointers in the parsed
Title payload. The challenge function separately calculates its `return
completed` result before the debug branch; the patch does not change that
calculation. The track function normally proceeds to a player-flag or adventure
completion check when its debug condition is false.

The left-hand `ValueStack #15037` is at `0x18c2ec`; its two-entry pointer array at
`0x18c31c` selects `ScriptStructure #13633` (`arena select data`, `0x16ffac`) and
`OpCreateVariable #15038` (`DEBUG unlock all`, `0x18c32c`). The declaration's RNEX
references select a `ValueInfo` container with `IntMeasurement` contents.

An existing `arena ui - debug unlock all` macro (`#15053`, `0x18c844`) has
`OpSetValue #15055` (`0x18c8e4`) assigning integer one to that same variable. Its
only ordinary incoming reference is its definition-list entry; no ordinary
caller was found within this Title payload. This bounded observation does not
exclude runtime name-based calls.

The zero operand is shared: `RHSValueStack #1238` at `0x54e5c` has an
`IntMeasurement` type reference and integer zero at `+0x40`. Its enclosing
expression `#1237` is referenced 1,161 times. **Do not change that shared zero
constant or the shared integer-one constant.** The comparison edit is confined
to the two intended checks instead.

The six defined track prefixes, in order, are `300, 311, 309, 303, 302, 361`;
the existing arena303 editing template is track index 3. The shared check is not
specific to track 3: for a nonnegative debug value, it opens both menu access
gates wherever these functions are used. This does not establish that every
track or dependency is present or playable.

## Reproduce offline

From the workspace root, using your own extracted CUSA00697 files and the built
`tools/iga_extract` executable:

```bash
arena_route_dir=$(mktemp -d "$PWD/builds/arena-test-repro-XXXXXX")

tools/iga_extract extracted/CUSA00697/level/title.bld level.bld \
  "$arena_route_dir/original-level.bld"

node tools/arena_test_gate.mjs "$arena_route_dir/original-level.bld" \
  "$arena_route_dir/level.bld"

node tools/iga_replace.mjs extracted/CUSA00697/level/title.bld level.bld \
  "$arena_route_dir/level.bld" "$arena_route_dir/title.bld"

tools/iga_extract "$arena_route_dir/title.bld" level.bld \
  "$arena_route_dir/reextracted-level.bld"
cmp "$arena_route_dir/level.bld" "$arena_route_dir/reextracted-level.bld"

SKYLANDERS_TEST_TITLE="$arena_route_dir/original-level.bld" \
  node --test tests/arena_test_gate.test.mjs

node tools/elf_metadata.mjs extracted/CUSA00697/eboot.elf
```

`builds/` must already exist. All output filenames are new. The patcher rejects
wrong size/hash, a missing or displaced gate object, and an unexpected original
operator. It reparses the patched IGZ and verifies that the single changed byte
is inside the selected u32 field. It refuses existing output/manifest paths and
does not accept already patched input. The tests also check source preservation
and rejection of unknown inputs. Without `SKYLANDERS_TEST_TITLE`, the private
game-data integration test is skipped.

The append-only archive replacement retains the original stored payloads and
other members, appends the new raw payload, and changes the selected member's
descriptor. See [ARCHIVE_REPACK.md](ARCHIVE_REPACK.md) for its verification limits.
The outer archive necessarily changes more than one byte and grows; the
one-byte claim applies only to the inner IGZ payload.

Recorded local results under `builds/arena-test-route`:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Original `level/title.bld` archive | 19,429,602 | `6185686228683d98679f4effa3c6222142fbce5d8bb08c4003887c2705cac57d` |
| Original inner `level.bld` | 42,528,608 | `ac9de5aec39382d11e3caa8a62afb98240ee3ed273c804a58978ed9bd358710e` |
| Patched inner `level.bld` | 42,528,608 | `d5297f385336502c640c9f1aeeca08c62fef72c2614f11f50b80298f548b8d42` |
| Rebuilt `title.bld` archive | 61,960,032 | `d01f4c4599670698b7215152e845ba1f43dbf23f04cf8ead41ffcbf9f4a7d788` |

The C++ extractor's `independent-level.bld` matches the patched payload
byte-for-byte. Both generated manifests retain `runtimeValidated: false` or
`gameRuntimeTested: false`; passing a structural check does not change that.

## Separately loaded return menu

`misc/ui_arenaselect.bld` contains a second `UI_ArenaSelect.ai` graph. Its exact
inner `level.bld` is 9,734,204 bytes, SHA-256
`1a0825122ceba7fa2000f0630ded2e6111d5905ea0af628c63d0160ebd6931ac`.
The corresponding `OpCheckValue #6130` is at file `0x96570`; its operator
at `0x965b0` is the same `GT_OP=4`. The two ordinary incoming references are
OpCodeList #4554 rows1358 and1367, exactly as in Title. The left ValueStack #6131
selects `arena select data` #4566 and the `DEBUG unlock all` declaration #6132;
the right expression #162 wraps the shared integer-zero stack #163. The profile
changes only the operator byte to2, never the shared constant.

The same patch command accepts this separate original payload. Extract it from
your own `misc/ui_arenaselect.bld`, patch to a new file, and use `iga_replace.mjs`
on that archive. The rebuilt archive belongs only in the disposable game copy.
Original outer SHA-256:
`8cce5c48b59cb6d6a6250dd58cf3429ff91462eb3956457e6eac828369aaf11e`.
Patched inner SHA-256:
`654e63aad4e35645ac7ae0754a8dcc78b92c0226e812a6072f637dfcb4569089`.
Rebuilt outer SHA-256:
`44918735d8e3971619a53e6fdad21084b4cbeb5b940371b00e6a2dcd3d9942e3`.
Independent C++ extraction matched. Test with
`SKYLANDERS_TEST_ARENA_MENU=/path/to/original-inner-level.bld`.
Repeated menu access through this patch reached character confirmation in
`portal-crossfire-01`, as recorded below.

## Runtime status and next record

As documented on 2026-10-13, a separate full/reflink game copy exists at
`builds/runtime-arena/CUSA00697`. The first arena test changed only
`level/title.bld`. Session `builds/portal-input-arena-01` used the input-IPC fork
and baseline checkpoint. The observed route was: title Cross, autosave Cross,
slot1 Cross, Choose Play Right then Cross, three separate Rights to Exhaust
Junction, Cross, first challenge Cross, Food Fight confirmation Cross.
All menu pulses were100ms with fresh game captures between stages. Arena303
loaded, rendered its arena, enemies and Food Fight, then started battle.
Owned process `/proc/2609555/fd/75` pointed to the intended
`level/arena_challenge_303_000.arc`. The run reached a normal loss/return while
analysis was idle, not completion. A600ms right-axis pulse was acknowledged;
isolated before/after movement proof is still desirable. The pause menu worked.
An attempted swap to Snap Shot during this challenge requested the originally
selected Food Fight instead; ordinary story-mode swaps must not be assumed to
apply to this arena's character restriction.

Native screenshots in that session's `user/screenshots` include suffixes
`000005` (unlocked track menu), `000008` (Exhaust Junction), `000009` (unlocked
challenge), `000011` (battle start), `000013` (pause), `000015` (loss), and
`000016` (return menu locked again). `builds/checkpoint-arena-route-01` retains
the stopped profile (41files); it is not a RAM state or a completed challenge.

For the next run, the disposable copy also received the patched
`misc/ui_arenaselect.bld` and Crossfire's four-spawn archive. This later state
must not be confused with the original-arena baseline above. Current challenge
archive SHA-256 is `20a7ed9b21ed067612420c00e9a005b1468f833a26bc8e9726735ddbacd2515a`.
The original game and `builds/checkpoint-first-level-01` remain the baseline;
the earlier percentage-edit checkpoint is not the recommended resume source.

That run is `builds/portal-crossfire-01` (now stopped). It used the same fork and
original checkpoint. Native screenshot suffixes `000009` and `000010` show
arena introduction and active battle, `000011` pause, `000013` the unlocked
challenge menu after the loss/return, and `000015` character confirmation after
selecting the challenge again. During re-entry the owned process's fd32 pointed
to the intended `arena_challenge_303_000.arc`. This proves edited-archive startup
and return-menu access, **not** a measured four-spawn effect or a win.
`builds/checkpoint-crossfire-01` preserves the stopped profile and Food Fight
(36 files); it is neither RAM state nor a completed challenge. Do not replace
the original recommended checkpoint with this experimental profile.

The same run verified the four-input arena-selection segment at 1 Hz. See the
timing records and local `portal_sequence` API in [PORTAL.md](PORTAL.md); normal
loading must still be observed before the next segment.

Use a disposable profile restored from the baseline checkpoint, with the known
working virtual portal/figure setup. Follow [PORTAL.md](PORTAL.md) and
[RUNTIME_TESTING.md](RUNTIME_TESTING.md) for isolation and input. Keep Title as the
normal startup level; direct `startLevel=arena_challenge_303_000` previously
failed to provide a usable shortcut. No installation into an original game tree
is part of the recipe above.

Record the remaining result before marking this route validated:

- Session/profile path and exact emulator build/configuration.
- Baseline checkpoint identity and patched Title archive hash.
- Whether both track and challenge selection are enabled from Choose Play.
- Whether `arena_challenge_303_000` actually loads, renders, accepts player
  movement, and remains stable; screenshots and matching emulator log.
- Any save changes or unexpected side effects in that disposable profile.

This recipe does not alter save files, set completion flags, fix portal or
emulator compatibility, bypass every possible gameplay gate, or supply any new
map assets. Normal play can still save progression in the disposable profile.
Even a successful arena launch validates only this access route and the tested
Title repack, not edited actor positions, authored geometry, collision,
navigation, objectives, or a complete newly created level.
