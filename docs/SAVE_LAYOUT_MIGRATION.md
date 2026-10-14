# Explicit-schema save-layout migration

`tools/save_layout_migrate.mjs` copies raw save fields between two **explicit,
caller-supplied observed schemas**. It does not discover the runtime layout,
evaluate initializer scripts, select a platform branch, infer payload sizing,
unlock anything, install saves, or claim runtime compatibility.

The pure `migrateSaveLayout()` API takes a Buffer and returns a separate Buffer
plus a detailed manifest. Neither the source Buffer nor either schema is
modified. No real save file is required by the synthetic tests.

Read [save-layout discovery](SAVE_LAYOUT_DISCOVERY.md) before using this tool:
declaration rows and the conditional 82-bit chapter-growth calculation are
**not** complete executed schemas. Obtain both actual old and actual new
ordered layouts independently before attempting an owned-save migration.
The migrator cannot authenticate that observation and always reports
`schemaProvenanceVerified: false` and `runtimeValidated: false`.

## Input contract

```js
import {migrateSaveLayout} from './tools/save_layout_migrate.mjs';

const result = migrateSaveLayout({
  source: originalSaveBuffer,
  expectedSha256: expectedFullSourceSha256,
  oldSchema: {
    payloadBytes: 8,
    fields: [
      {key: 'example.flags', bitIndex: 0, width: 3, count: 2},
      {key: 'example.raw', bitIndex: 6, width: 32, count: 1}
    ]
  },
  newSchema: {
    payloadBytes: 8,
    fields: [
      {key: 'example.flags', bitIndex: 0, width: 3, count: 3},
      {key: 'example.raw', bitIndex: 9, width: 32, count: 1}
    ]
  }
});
// result.buffer is a candidate, not an installed or runtime-validated save.
```

This is a toy layout, not a game schema. Schema objects accept exactly
`payloadBytes` and `fields`. Each field accepts `key`, optional `name`,
`bitIndex`, `width` and `count`. Diagnostic information from runtime observation
reports must be explicitly projected to those fields; do not silently treat
a declaration catalog as an executed schema.

- `key` is a unique, case-sensitive stable identity, not an array index.
  Optional `name` is a display/observation label. Keys, optional names and
  field array order must match exactly between schemas.
- `bitIndex` is an absolute payload bit offset. Bit order is least-significant
  bit first within each byte. Elements are contiguous with stride `width`.
- Width is positive and cannot change. Counts are nonnegative and may only
  increase. An already declared zero-count field may grow. New/removed field
  keys, reordering, renamed fields and reduced counts are rejected.
- Integer metadata must be unsigned safe integers within bounds. Each schema
  supports at most 4,096 fields and 1–1,048,576 payload bytes. Field ranges must
  fit the payload and may not overlap. Zero-count fields consume no bits.
- The source length must equal **old `payloadBytes` + 4** exactly. The complete
  source SHA-256 must match. The trailing four bytes must contain the valid
  FNV-1a-32 checksum of the payload, stored little-endian.
- The new payload size is entirely explicit. There is no automatic byte/word
  rounding, fixed spare-capacity assumption or version-field update.

## Raw fields and unknown bits

Every old element is copied bit-for-bit to the matching field's explicit new
offset. This preserves signed values, all-ones sentinels and raw encodings
wider than JavaScript's exact Number range without interpreting them.
Additional elements are initialized to zero. Zero is a structural policy,
not a proven valid gameplay default for an unknown field.

Unknown/padding bits use the following conservative policy:

| Source bit | Destination at the same absolute position | Action |
| --- | --- | --- |
| Unknown | Still inside payload and unassigned | Preserve exact bit |
| Unknown, zero | Now assigned to a field | Allow consumption |
| Unknown, nonzero | Now assigned to a field | Reject |
| Unknown, zero | Beyond explicit new payload | Allow truncation |
| Unknown, nonzero | Beyond explicit new payload | Reject |
| Previously assigned, now unassigned | Vacated field location | Zero; do not duplicate old field data |

Unknown data is never moved to an invented new position. If a real migration
fails on a nonzero unknown bit, recover its actual field definition or resolve
its semantics before extending the schema; do not clear it to suppress the
guard. New unassigned payload space starts at zero.

After copying, every original field bit, added zero element and preserved
unknown bit is read back. The output checksum is recomputed and verified.
The manifest records old/new normalized schemas and their hashes, source and
output hashes, per-field source/destination ranges, element counts/strides,
added ranges, exact unknown-bit ranges and bit-growth totals. Schema hashes
are hashes of normalized compact JSON, not hashes of arbitrary caller files.

## Optional exclusive file output

`writeSaveLayoutMigration()` accepts the same request with `source` as a file
path and an additional `outputDirectory`. The CLI reads that object from JSON:

```sh
node tools/save_layout_migrate.mjs research/explicit-save-migration-request.json
```

The request must contain the full explicit schemas and expected source hash;
there are no default schemas or configurable overwrite/install switches.
The output directory's parent must exist, but the directory itself must not.
The wrapper creates only `save-layout-migration.candidate.bin` and
`manifest.json`. The original save is descriptor-opened read-only/no-follow,
and its identity, size, timestamps and hash are checked throughout. Outputs
are exclusively created, flushed and read back through their descriptors.
On partial failure, cleanup removes only files owned by that invocation and
preserves unrelated files. This is not a transactional live-save installer.

Never point a runtime at the output merely because its checksum is correct.
Validate schema provenance, save-version readers, storage-size limits and
new-element defaults first, then test a copied save in an isolated runtime.
The manifest always retains `deployable: false`. Existing fixed-size
checkpoint tools may correctly reject a new-size candidate; do not bypass
their guards without independently establishing the changed storage contract.

## Tests and scope

```sh
node --test tests/save_layout_migrate.test.mjs tests/save_inspect.test.mjs
```

Synthetic tests cover byte boundaries, 64-bit raw values, signed/sentinel
patterns, zero-count growth, source/schema immutability, duplicated keys,
overlapping ranges, unsupported metadata, truncation, checksums, SHA binding,
unknown-bit collisions, exclusive output, symlink refusal, partial-failure
cleanup and CLI rejection of overwrite attempts.

The 82-bit growth test explicitly supplies schemas whose added field spans
total 82 bits and whose caller-selected word-rounded payload grows by 96
bits. Later fields shift by 82 bits, not 80 or 88; original element encodings
remain exact and new elements are zero. This tests bit transport, not an
assertion that a real game's save has that complete layout or growth.
