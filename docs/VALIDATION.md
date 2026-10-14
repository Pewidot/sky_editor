# File-handling review and regression checks

The archive extractor and position-edit backend were reviewed for malformed
inputs, output-file safety, partial writes, and excessive resource use. These
checks concern local tooling; they do not establish runtime game compatibility.

## Extractor findings and fixes

The original C++ extractor checked `filesystem::exists` before opening a normal
truncating stream. That was not atomic and followed dangling output symlinks.
It also left partial outputs after decode failure, requested a seven-byte header
even for shorter final raw chunks, and did not reject all malformed name-table
lengths or overlaps between payloads and metadata.

The updated Linux implementation:

- Creates output with `O_CREAT|O_EXCL|O_NOFOLLOW`, rejecting existing files,
  hard links, and dangling or live symlinks.
- Validates the complete archive's table/name/member/chunk ranges before creating
  an output or its parent directory. Member ranges cannot cross another member's
  start or the name table.
- Retains the created output inode's identity. On decode/write failure, cleanup
  removes the path only if it still refers to that same regular-file inode.
- Accepts final raw chunks shorter than seven bytes and empty members at EOF.
- Requires exact decoded chunk lengths, rejects explicit LZMA errors, and detects
  a decoder making no progress. Valid length-bounded streams may omit an end marker.
- Caps archives at 32-bit physical sizes, selected decoded output at 1 GiB, names
  at 64 MiB total/4,096 bytes each, and entries/chunks at one million each.

The source archive is opened only for reading. Linux/POSIX output creation is an
intentional implementation constraint; the setup helper already targets Linux.
The chunk-compression discriminator still follows the observed Alchemy format
heuristic (properties byte `0x5d` and a bounded dictionary size); the complete
chunk-property-table semantics have not been independently reconstructed.

## Backend review

The backend already used exclusive `wx` creation and cleaned its own newly
created output/manifest after an error. Edits are restricted to validated scalar
fields, followed by reparse and an unchanged-other-bytes comparison. It never
opens the source for writing.

The review also found that its original 4 MiB stdin limit was checked only after
reading all input, and file bytes were allocated before an input-size cap. The
backend owner added a streaming request cap and a 1 GiB regular-file cap before
loading. Those limits bound input allocation; large valid files and their parsed
object graphs can still require substantial RAM. Files changed concurrently by
another application are not protected by a cross-process locking protocol.

## Reproduction

```bash
node --test tests/iga_extract.test.mjs tests/setup_from_pkg.test.mjs
node --test tests/iga_roundtrip.integration.test.mjs
```

The extractor tests compile the current C++ source in a fresh temporary directory.
Eight synthetic cases cover short/empty chunks, overwrite/symlink/hard-link
refusal, a bad second compressed chunk after a valid first chunk, malformed
metadata, name-table crossing, declared output limits, and invalid selectors.
The corrupt-second-chunk case verifies that previously written partial bytes
are removed. Every invocation verifies its source input remains byte-identical.

The eight extractor cases, six setup cases, and real eleven-member level-switch
archive roundtrip all passed after rebuilding `tools/iga_extract` with warnings
enabled. The actual roundtrip uses both original compressed members and a
replacement raw member; all eleven decoded members match their inputs exactly.

No game data belongs in a source release. These tests generate their own small
synthetic archives; the separately named integration tests use a user's local
game files and retain their generated copies outside the source bundle.

## Save inspection and source-only build

`tools/save_inspect.mjs` only reads bounded regular files of the two observed
save lengths (380 and 1004 bytes). It rejects symlink inputs, checks file identity
and size around the read, and reports checksum failures without rewriting bytes.
Six synthetic tests cover standard FNV-1a vectors, checksum byte order/tampering,
exact byte/bit differences, bounded raw windows, input rejection, and CLI exit
codes. Five real checkpoint files independently matched the FNV-1a-32 checksum;
their hashes remained unchanged. See [SAVE_CHECKPOINTS.md](SAVE_CHECKPOINTS.md)
for findings and deliberately unverified field interpretations.

A fresh 62-file literal-allowlist source copy built the complete Qt editor and
portal dialog with all four CTests passing. Running `node --test tests/*.test.mjs`
in that copy produced **77 passes, 0 failures, 3 optional local-game skips**.
The first clean run exposed an unconditional private-fixture dependency in the
old archive integration test; it now explicitly skips when its local game,
research output or built extractor is absent. The same test was rerun in the
research workspace and all eleven real archive members still matched.

This clean-build check does not require or include an emulator, game assets,
save files, firmware or figure dumps. Synthetic controller tests launch only a
small mock process. It verifies the tested source snapshot, not modified-level
gameplay or an exact future release; rerun it when source files change.
