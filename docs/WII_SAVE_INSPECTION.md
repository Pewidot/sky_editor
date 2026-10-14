# Wii save inspection and an experimental PS4 slot candidate

The user-supplied `skylanders-trap-team.28504.bin` is a structurally valid Wii SD
save container, not a raw PS4 save. Its unused slot provides a useful exact
cross-platform byte comparison. That comparison alone does not prove progress
compatibility. A separate runtime test now confirms the Academy hub, chapter
selection and playable Chapter 3; see the runtime section below.

The inspector does not run an emulator or import anything. The only generated
candidate is a separately requested slot file in a new private research
directory. No PS4 header conversion is implemented.

## Container and payload evidence

The container parser follows the pinned Dolphin revision
`8d2ad1a662472955497e5bb79d7b9ec6999e1f0d`: its
[save structures](https://github.com/dolphin-emu/dolphin/blob/8d2ad1a662472955497e5bb79d7b9ec6999e1f0d/Source/Core/Core/HW/WiiSaveStructs.h),
[save reader](https://github.com/dolphin-emu/dolphin/blob/8d2ad1a662472955497e5bb79d7b9ec6999e1f0d/Source/Core/Core/HW/WiiSave.cpp),
and [public SD encryption constants](https://github.com/dolphin-emu/dolphin/blob/8d2ad1a662472955497e5bb79d7b9ec6999e1f0d/Source/Core/Core/IOS/IOSC.cpp).
The encrypted header and separately encrypted member payloads use AES-CBC;
member data is padded to 64-byte extents. Header MD5, title IDs, declared sizes,
member boundaries and the trailer marker are checked. **ECC signatures and
certificate authenticity are not verified.**

Local observations on 2026-10-13:

| Property | Observed value |
| --- | --- |
| Source size | 68,992 bytes |
| Source SHA-256 | `6cf82c3cb4965d4ef1b4f7c51cbeceaeef7685d89a1d34fcebc8c688a00c6755` |
| Title ID / banner | `00010000534b3845` (`SK8E`) / `Skylanders Trap Team` |
| Header MD5 | `3b13e713d3807924c4cd4f05d30dcbe0`, valid |
| Members | `Save_Header`, `Save_Slot_1`–`Save_Slot_4`, directory `backup`, `backup/Save_Slot_1` |
| Header / slot sizes | 380 / 1004 bytes, matching the observed PS4 sizes |
| Payload checksums | All six files: FNV-1a-32 over all but the last four bytes, stored **big-endian** |

PS4 checksums are instead stored little-endian; see
[SAVE_CHECKPOINTS.md](SAVE_CHECKPOINTS.md). Slots 1–4 in this Wii container have
341, 80, 5 and 2 nonzero payload bytes respectively. This distinguishes their
contents but does not establish which progress flags they encode or independently
verify the user's description of the save as completed.

## Exact empty-slot match, limited inference

Reversing the byte order of **each 32-bit word** in the Wii slot 4's first 1000
bytes reproduces the PS4 unused-slot payload exactly. Its only nonzero bytes
move from Wii offsets 329 (`08`) and 578 (`80`) to PS4 offsets 330 and 577.
After recomputing FNV over that new byte order and storing it little-endian, all
1004 bytes match the untouched checkpoint's PS4 slot 4:

```text
Wii empty slot SHA-256:
aa225279f47e071bd4397d9f4a8633acb2cbcf1eec0a1c4ee72d01f5caeb64b8
PS4 empty slot / reconstructed result SHA-256:
bf8d303783ffc74276bb6b1d453febdb427a7ac305cf9341413cd5a6f3741bd7
Wii checksum: 0x08f8c68d; reconstructed PS4 checksum: 0x0814259d
```

This supports testing word-order normalization for slot payloads. It is **not**
proof that every populated field has the same packing or meaning across these
Wii and PS4 versions. Reversing the old checksum is insufficient: FNV must be
recomputed over the reordered bytes.

The header has additional uncertainty. After an in-memory word swap, four raw
8-bit LSB-first windows beginning at bit 153 read `[100,255,255,255]`, whereas
the PS4-observed bit-157 location reads `[246,255,255,15]` in this Wii header.
These are unverified raw windows, not a decoded schema. Their difference is a
reason not to copy or automatically convert the Wii header. The earlier isolated
PS4 bit-157 experiment changed the displayed completion percentage, not chapter
selection or intro skipping.

## Reproduce safely

Node.js and its built-in crypto module are sufficient. Read-only inspection
creates no files:

```bash
node tools/wii_save_inspect.mjs skylanders-trap-team.28504.bin \
  --ps4-empty builds/checkpoint-first-level-01/user/home/1000/savedata/CUSA00697/SAVEDATA00/Save_Slot_4
```

On another machine, supply your own container and your own verified unused PS4
slot. Omitting `--ps4-empty` skips that comparison. A matching checksum alone
does not prove that a supplied reference is actually unused.

To extract and explicitly create the experimental slot 1 candidate:

```bash
node tools/wii_save_inspect.mjs skylanders-trap-team.28504.bin \
  --expect-sha256 6cf82c3cb4965d4ef1b4f7c51cbeceaeef7685d89a1d34fcebc8c688a00c6755 \
  --ps4-empty builds/checkpoint-first-level-01/user/home/1000/savedata/CUSA00697/SAVEDATA00/Save_Slot_4 \
  --output-dir research/wii-save-28504 \
  --candidate-slot1
```

The output directory must not exist and its parent must exist. That exact local
directory was already created during research; a repeated run must choose a
different new directory. Input is limited to 64 MiB and 4096 members. Unsafe,
duplicate or overlapping member paths, symlink inputs, wrong hashes and existing
output destinations are rejected. New directories are private (`0700`) and files
are created exclusively (`0600`), then hash-checked. On an output error, partial
files may remain in the newly created directory; no existing output is removed
or overwritten. The original input is read-only and its hash is checked again
after extraction.

Outputs are `wii-payloads/`, `inspection.json`, and, only with the explicit flag,
`experimental-ps4-Save_Slot_1.bin`. The JSON records source/member/result hashes,
the comparison and the candidate's unverified status. The local candidate is:

```text
Size: 1004 bytes
SHA-256: 92a8a9741fbcebad5bacd4c9eeb296962751698d87e75cd772261c558d053cdb
Recomputed little-endian FNV-1a-32: 0x98c795d5
```

Its generation preserves the original container, all emulator profiles and all
checkpoints. Any runtime experiment must use a separate disposable checkpoint,
retain the original PS4 header, and report actual game observations separately.
No completed-progress compatibility or tutorial skip is claimed by this tool.
The supplied save and decrypted research outputs are private data, **not source
release contents**.

## Prepare a derived checkpoint without fabricating a session

`tools/derive_slot_checkpoint.mjs` prepares a separate, explicitly experimental
checkpoint for a later runtime test. It never launches an emulator and never
creates fake launch/exit events. It first verifies the original checkpoint and
uses `restoreCheckpoint` to copy it into a new private directory. It replaces
only `user/home/1000/savedata/CUSA00697/SAVEDATA00/Save_Slot_1`, rebuilds the file
inventory, verifies every other file's hash, then restores the result again into
a temporary verification copy. Only that temporary copy is removed afterward.

```bash
node tools/derive_slot_checkpoint.mjs \
  --source-checkpoint builds/checkpoint-first-level-01 \
  --expect-checkpoint-sha256 d5a59bd2dc9f3a6b8f800d931737299b83cfc4b7fa02c5b864aef0aa846836ad \
  --candidate research/wii-save-28504/experimental-ps4-Save_Slot_1.bin \
  --expect-candidate-sha256 92a8a9741fbcebad5bacd4c9eeb296962751698d87e75cd772261c558d053cdb \
  --output-dir builds/checkpoint-wii-slot1-01
```

The new output must not exist. Candidate hash, exact length and little-endian FNV
are mandatory; source-manifest pinning is optional but shown for reproducibility.
The original PS4 header must also have its expected size and a valid checksum.
Source symlinks, malformed inventory paths, unlisted files, altered file hashes,
non-regular files and output inside the source checkpoint are rejected. File
count, depth and byte limits follow the bounded checkpoint workflow. Interrupted
or failed creation may leave an incomplete **new** output directory for
inspection; the helper does not overwrite or remove pre-existing destinations.

The prepared local result contains 19 inventoried files: **one changed slot and
18 byte-identical files**, including the original PS4 header and all figure
files. Its `checkpoint.json` SHA-256 at creation is
`70b8791a601fc351be784de984c818623561062ce10c7cb5f6d78be360e12915`.
The manifest records `derivedFrom`, exact changed-file hashes,
`runtimeValidated: false`, `emulatorLaunched: false` and `sourceSession: null`.
Emulator/game/argument metadata and Food Fight slot state are inherited from the
original checkpoint, not evidence that this derived profile has been run.

For a separately authorized runtime experiment, use this derived directory as
the **Resume checkpoint** and choose a new session directory in the virtual
portal workflow. Do not replace the recommended original checkpoint or copy
files into a running session. Checkpoint restoration verifies integrity, not
whether the game understands the candidate's progress fields. Runtime findings
belong in the runtime report, independently of this creation-time manifest.

## Separate runtime result (2026-10-13)

Session `builds/portal-wii-slot1-01` restored the derived profile into a new
directory using the input-IPC shadPS4 build and the disposable arena-test game
copy. No normal chapter archive was modified. The PS4 header was unchanged on
import; the game subsequently wrote its own header and slot updates normally.

Observed in fresh game-only captures:

- The slot-selection summary initially still showed 0% from the old header.
  After loading slot 1, Choose Play displayed **Story 100/100**.
- Story loaded the Academy hub directly with Food Fight, without the initial
  Eon/tutorial route. The pause menu showed **Portal Master 40**.
- Options → right → Cross opened Chapter Select. Two right pulses selected
  **3. Chompy Mountain**, with completed star/villain indicators visible.
- Cross → left → Cross confirmed Go. After the arrival sequence, Food Fight
  appeared with 260 health; a 650 ms forward-axis pulse visibly moved him.
  Options then paused the game. This is a playable later-chapter entry, not a
  whole-level playthrough or proof that every imported flag is compatible.

The emulator exited normally (code 0) and `portal_checkpoint` preserved 35 files
as `builds/checkpoint-wii-progress-01`. Its manifest SHA-256 is
`822cf45d801c99b2202f642649602f7b88336bbb7eb7d8495ea42ad291861355`.
This profile can be used for subsequent tests; it is **not a RAM savestate** and
does not promise an exact restored position or cutscene skip. Its restart route
has not yet been independently replayed. The source Wii container, original
first-level checkpoint and creation-time derived manifest remain untouched.

Evidence lives in the session's `portal-events.jsonl` and `user/screenshots/`:

| Capture suffix | Observation | SHA-256 |
| --- | --- | --- |
| `game_000003.png` | Story 100/100 | `e5d1cd9c8103bcd556029172a58743a9e6f12a913c85d0b46f9d4d75bdab342c` |
| `game_000005.png` | Academy with Food Fight | `90d4b52563718b5f8b0cdf9e9e3c0cd748d5bdb0792eb9b9ed49464cc3a49817` |
| `game_000009.png` | Chapter 3 selected | `ecc7e487a7419c9471dc8a2428e0b6c4598ed3a30a30a5e029f434597c184e03` |
| `game_000012.png` | Chapter 3 gameplay before movement | `e9bc287c54a064be8707f88f9fcaed780619008d0a07b7af8bff7a40b7b30249` |
| `game_000013.png` | After forward pulse | `e4a58cf1432f6d4ee8d79be461f36634a92b81eae5c7c8a75e08f755cf9a252a` |
| `game_000014.png` | Paused, Portal Master 40 | `e27e1ee478c233ca8ccaadafc333057d6d744b4726a7772450cdc0d15b2f8f8a` |

Menu pulses were 100 ms and deliberately spaced at 1 Hz; chapter loading and
cutscenes still require observing the game. The initial two-Cross sequence did
not skip the autosave notice because its second pulse landed during transition.
Do not replay the whole route blindly at fixed intervals across loading screens.

## Tests

```bash
node --test tests/wii_save_inspect.test.mjs
node --test tests/derive_slot_checkpoint.test.mjs tests/runtime_checkpoint.test.mjs
```

Eight synthetic tests cover exact word reversal, checksum repair, the known empty
comparison, input immutability, malformed containers and paths, private output,
hash gates and no-overwrite/symlink rejection. An optional ninth read-only test
uses `SKYLANDERS_TEST_WII_SAVE` and `SKYLANDERS_TEST_PS4_EMPTY` environment paths.
The local run passed all nine, including the real supplied-container comparison.
Six derived-checkpoint tests plus the four existing checkpoint tests also pass,
covering exact one-file change, independent restoration, provenance, immutable
source/candidate files, hash/checksum gates and unsafe paths/destinations.
