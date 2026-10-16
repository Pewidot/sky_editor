# Saved-profile checkpoints and read-only save inspection

Progress can now be preserved without re-creating the emulator profile or blank
figures. This is a **saved-profile checkpoint, not an emulator RAM savestate**:
the game boots normally and loads what it actually saved. The tested restore
reinserted Food Fight and retained save slot 1, but the initial story sequence
still replayed. Exact mid-level position and automatic intro skipping are not
established for that original early checkpoint. A separate experimental Wii-slot
import now reaches the Academy and Chapter 3 without the initial tutorial; see
[WII_SAVE_INSPECTION.md](WII_SAVE_INSPECTION.md#separate-runtime-result-2026-10-13).

For the faster local chapter-testing profile, use
`builds/checkpoint-wii-progress-01` with the input-IPC executable
`tools/vendor/shadps4/input-ipc/shadps4` and a **new** session directory. It contains
35 files after a clean exit from Chapter 3. Restart still boots the game; exact
mid-level restoration is not established. The original baseline below is retained
unchanged for comparison. Never distribute either profile or the supplied save.

## Resume the local tested checkpoint in the GUI

Start the editor as described in [README](../README.md#editor-starten--dieser-bereits-eingerichtete-rechner),
then choose **Virtual portal…**. Use these three existing local paths:

| Dialog field | Local value |
| --- | --- |
| shadPS4 executable | `/mnt/nas/Dokumente/skylanders_reverse_engineer/tools/vendor/shadps4/Shadps4-sdl.AppImage` |
| Prepared game eboot | `/mnt/nas/Dokumente/skylanders_reverse_engineer/builds/runtime-baseline/CUSA00697/eboot.bin` |
| Resume checkpoint | `/mnt/nas/Dokumente/skylanders_reverse_engineer/builds/checkpoint-first-level-01` |

Set **New session directory** to a **new, nonexistent** directory under an
existing parent, for example a fresh name inside this workspace's `builds/`.
Choose **Start session**. The controller checks checkpoint hashes, copies its
profile and managed figures, and reinserts the recorded Food Fight after USB
initialization. Observe the game to confirm recognition; IPC has no figure-load
acknowledgment. The old checkpoint and original game remain unchanged.

To preserve the next run, select a new, persistent checkpoint destination and
choose **Stop & save checkpoint**. It stops only the dialog's emulator before
copying. **New session** then prepares another isolated run without deleting
previous runs. Do not copy a running save directory by hand.

The tested route and controller API are in [PORTAL.md](PORTAL.md#save-a-checkpoint-and-resume-faster);
the runtime limitations are in [RUNTIME_TESTING.md](RUNTIME_TESTING.md).
Local evidence is the [checkpoint manifest](../builds/checkpoint-first-level-01/checkpoint.json),
created on 2026-10-13, and its
[saved-data directory](../builds/checkpoint-first-level-01/user/home/1000/savedata/CUSA00697/SAVEDATA00).
These private paths exist only on the research machine and are **not** source
release contents. Other people must create checkpoints from their own game.

## Verified bytes, not guessed unlocks

The five observed CUSA00697 files use **FNV-1a-32 over every byte except the final
four**, with the result stored as a little-endian unsigned 32-bit integer in
those final four bytes. The implementation starts at `0x811c9dc5`, XORs each byte,
then multiplies by `0x01000193` modulo 2³². All five stored checksums match:

| File in the tested checkpoint | Size | Payload | Stored/computed checksum |
| --- | ---: | ---: | --- |
| `Save_Header` | 380 | 376 | `0xd357f9a8` |
| `Save_Slot_1` | 1004 | 1000 | `0x1681c4a7` |
| `Save_Slot_2`, `Save_Slot_3`, `Save_Slot_4` | 1004 each | 1000 each | `0x0814259d` |

Slots 2–4 are byte-identical. Comparing slot 1 to slot 2, the **only payload
difference** is byte `0x143` (decimal 323): `02` versus `00`, corresponding to
LSB-first bit 2585. Their four checksum bytes also differ. This does **not** prove
the byte is an initialized-slot, difficulty, unlock, or intro flag. Its semantics
remain unknown.

The global script graph contains save definitions named `header - slot level IDs`,
`header - options sound vols`, `enemy intros complete`, and `arena progress`, plus
bit-index/bit-count save operations. This establishes that relevant save concepts
exist, not their serialized offsets. Two raw header observations are candidates:

- Four 8-bit windows starting at LSB-first bit 157 change from
  `[255,255,255,255]` in the earlier empty profile to `[0,255,255,255]` in the
  played checkpoint. A controlled edit of only the first window from 0 to 1,
  followed by checksum repair, changed the save-slot screen to **Story Mode
  Progress: 1%**. It did not unlock chapters or skip Eon's opening cinematic.
  This supports a displayed-completion-percent interpretation, **not** a resume
  level selector; the whole array's semantics are not yet established.
- Four 8-bit windows starting at bit 12 read `[100,100,100,50]` in the played
  header. Their interpretation as sound settings is also unverified.

Knowing a checksum allows a structurally consistent edit; it does not establish
which edit is safe or whether the game accepts it. This helper intentionally has
**no patch/unlock mode**. New field claims require controlled runtime comparisons
on disposable copies. The separate `Tfb.startLevel` arena experiment has not
provided a working level-select shortcut; see the runtime report.

The percentage experiment is isolated in `builds/checkpoint-levelid-01` (the name
records the original, disproved hypothesis) and `builds/portal-saveid1-02`.
Do **not** use that experimental checkpoint as the recommended resume source.
`checkpoint-first-level-01` remains unchanged. Private script
`research/try-save-level.mjs` and its exact changed-byte manifest record the test;
neither is included in the source release.

## Run the read-only inspector

From this workspace:

```bash
node tools/save_inspect.mjs \
  builds/checkpoint-first-level-01/user/home/1000/savedata/CUSA00697/SAVEDATA00/Save_Slot_1 \
  --compare builds/checkpoint-first-level-01/user/home/1000/savedata/CUSA00697/SAVEDATA00/Save_Slot_2
```

For the header, give the same directory's `Save_Header` instead. On another
machine, supply your own stopped session/checkpoint file path. JSON output
includes SHA-256, stored/computed checksum, nonzero payload bytes and, with
`--compare`, exact differing payload bytes and LSB-first bit offsets. Header
windows are marked `verifiedSemantics: false`. A length/checksum match alone
does not authenticate a file or prove a game version.

Only the observed 380-byte and 1004-byte regular files are accepted. Symlinks,
other sizes and files changing during the read are rejected. No file is created
or modified. Exit status is 0 for matching checksums, 2 for a checksum mismatch
(JSON is still printed), and 1 for invalid input or usage. Synthetic tests need
no save data:

```bash
node --test tests/save_inspect.test.mjs
```
