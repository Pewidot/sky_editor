# IGA member replacement: verified offline, runtime still untested

`tools/iga_replace.mjs` can replace an existing member of a little-endian IGA
version `0x0B` archive while retaining every other member's compressed bytes,
offsets, name hash, name, and order. This is infrastructure for editing the IGZ
`level.bld` payload; it does not itself create a new game level.

## Usage

Run from the workspace root. Both output paths must be new:

```bash
node tools/iga_replace.mjs \
  extracted/CUSA00697/item/sky_systems_levelswitch.bld \
  level.bld \
  research/sky_systems_levelswitch/level.bld \
  research/archive_roundtrip/sky_systems_levelswitch.roundtrip.bld
```

The command above has already been run. It deliberately refuses to overwrite
that existing result. Choose a new output filename for another experiment.
The selector accepts an exact member path or its decimal index (`6` here).
A JSON manifest is written beside the result as `<output>.manifest.json`;
`--manifest <new-path>` chooses a different location. It records source,
replacement, and result SHA-256 hashes, sizes, every patched field, and limits
on the verification performed.

## Format observations and design choice

For this archive version, the file table starts with 32-bit name hashes at
`0x38`, followed by 16-byte member descriptors. A descriptor stores the data
offset at `+0`, an uninterpreted word at `+4`, the uncompressed size at `+8`,
and the compression mode at `+12`. The name table's absolute offset is at
header `0x28`, with length at `0x30`.

The public [igArchiveExtractor implementation](https://github.com/NefariousTechSupport/igArchiveExtractor/blob/77240dfb9ceca6aae75f273ae2076ce6f6b66742/IGA/IGA_File.cs)
reads data using those absolute offsets. Its builder uses FNV-1a of member
names for the hash table (lines 428–436) and writes `0xFFFFFFFF` for raw,
uncompressed member data (line 443). These are lookup hashes, not checksums
of payload bytes. The
[Trap Team layout definition](https://github.com/NefariousTechSupport/igArchiveExtractor/blob/77240dfb9ceca6aae75f273ae2076ce6f6b66742/IGA/IGA_Structure.cs)
matches the offsets observed in the shipped files.

The replacement strategy is deliberately narrow:

1. Copy the complete original archive to a new file.
2. Pad its end to the existing alignment (`0x800` for the tested archive).
3. Append the replacement uncompressed.
4. Change only the selected descriptor's offset, size, and mode.

The original selected payload remains as unreachable bytes, and the original
name table stays at its original location, before the appended data. Unknown
header fields, the descriptor's `+4` word, chunk properties, and all other
payloads remain intact. No content hash needs recalculation because names
and their lookup order are unchanged.

The tool bounds-checks tables, names, member extents, and chunk extents; rejects
overlapping members and metadata; limits output to 32-bit sizes; and rejects
source compression modes other than `0x20` and `0xFF`. It checks compressed
stream extents without decoding them. It refuses existing output or manifest
paths, re-parses the result, checks inputs for concurrent changes, and removes
only its newly created partial outputs if an operation fails.

## Local evidence

These are shell-based format and byte-comparison results, not REA Evidence IDs
or observations from a running game. They were obtained on 2026-10-13.

**AR-1: source identity.**
`extracted/CUSA00697/item/sky_systems_levelswitch.bld` has 11 members and is
82,146 bytes. Its SHA-256 is
`8344917676090de901f0b4b308a4d482f0a008d9accdc38c31d7a249b69cc319`.

**AR-2: no-op member replacement.** The existing `level.bld` member (index 6)
was replaced with its own extracted 356,552 bytes. Its data offset changed
from 22,528 to 83,968, and its mode changed from `0x20000000` to `0xFFFFFFFF`.
The rebuilt archive is 440,520 bytes with SHA-256
`69fa951b545cd0d9dea32196bf5f58d69c35ee3121992fa0f99d1b16f58c07b2`.
The manifest is
`research/archive_roundtrip/sky_systems_levelswitch.roundtrip.bld.manifest.json`.

**AR-3: complete member comparison.** All 11 members were extracted from both
the original and replacement archive using the separately implemented local
`tools/iga_extract` C++ program. Every decoded member matched byte-for-byte.
The replacement matched its input and the original IGZ payload, with SHA-256
`e26e2165c3f7c4db0dab11e29fcff4f8479e5023bd0795b87b2686d9d24230cd`.
The other ten descriptors were identical. Across the entire 82,146-byte
original prefix, only six bytes differed, all within the selected descriptor's
allowed fields. The original source archive remained unchanged.

**AR-4: rejection and preservation tests.** Five synthetic test cases pass,
covering preservation of unrelated bytes and unknown fields, length changes,
zero-length replacement, index and name selection, existing output and manifest
refusal, invalid names/ranges/alignment/compression, overlapping data, missing
members, and input/output alias rejection. A sixth integration test verifies
AR-3 against the real game files.

```bash
node --test tests/iga_replace.test.mjs
node --test tests/iga_roundtrip.integration.test.mjs
```

The integration test requires the already generated round-trip archive and
the local `tools/iga_extract` executable. Test extraction directories are
created under `/tmp/iga-real-roundtrip-*` for review.

## Remaining runtime questions

Absolute-offset parsing and successful local extraction support this layout,
but neither proves the game's loader accepts data after the original name
table. The game may have additional assumptions not shared by these readers.
The selected descriptor's uninterpreted word is preserved; its complete meaning
has not been established. This layout also increases archive size and makes
the selected member uncompressed, which could affect streaming behavior.

No outer PKG, `sce_discmap.plt`, signatures, level registration, IGZ references,
or asset sizes stored elsewhere are updated. First test this no-op archive
against a working, unmodified baseline in shadPS4. Only after that succeeds
should a gameplay or object edit be used to assess the IGZ editing path. A
successful no-op load would validate the archive path, not the correctness of
an arbitrary newly authored level.
