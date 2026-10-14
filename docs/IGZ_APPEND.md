# Structural IGZ append/rebuild primitive

`tools/igz_append.mjs` can extend the Default pool of the observed IGZ v8 / PS4
format and rebuild the affected fixups into a **new file**. It does not select
cloneable actors, infer ownership, create collision meshes, or establish that a
new object is safe in-game. No modified game installation is produced by these
tests.

## Evidence and supported changes

The implementation uses the native loader `FUN_00568430`
(`ev_ec2b575e84cb4f06b1aba8c75f1ce0d82f7db4a2852eab4ef8b43300b51f0e8b`)
and writer `FUN_0056f6e0`
(`ev_8f1e689ccb70dca6b4dee9abc703e8f62259cc6343ce8643a7e9ed3e376cd5ca`),
exported from the locally supplied CUSA00697 executable. These are static-code
observations, not a successful runtime test of this writer.

- Append explicit bytes to the existing Default pool, starting at the next
  16-byte boundary, and register explicit typed objects in RVTB. Types and sizes
  must already exist in TMET/MTSZ.
- Add ordinary ROFS, RSTT, RPID, REXT, RHND, RNEX and RMHN slots to existing
  fixup blocks. Caller-supplied REXT/RNEX slots permit the optional sign-retain
  bit `0x8000000000000000`; their other high-word bits must be zero. All other
  slot kinds require a zero high word. Indices must fit the appropriate table;
  authored REXT indices may address explicitly appended EXID records.
  New initializer-flag ROFS entries remain unsupported.
- Append explicit uint32 name/namespace pairs to an existing EXID block,
  preserving every old pair's bytes and index. Duplicate new pairs, including
  pairs already present, are rejected. This does not prove the new identity
  resolves in the game, register its target or create a missing EXID block.
- Append unique printable-ASCII TSTR strings without changing any previous
  string's bytes or index. This checks string equality, not every possible
  engine-side hashed-name collision.
- Optionally relocate a declared Default `igObjectList` root's data array,
  retaining its existing entries and adding explicitly selected new objects.
  Count, capacity, data size and data pointer are updated. Other old Default
  bytes, including the old array and memory flags, remain unchanged.
- Optionally grow up to 32 explicitly selected Default `ScriptSetList` objects
  (exact size `0x38`) or `OpCodeList` objects (exact size `0x28`) in the same
  rebuild. New objects append by default, or insert at explicit `insertAt`.
  Relative order of all old entries is preserved; insertion shifts their
  indices. The `ScriptSetList` type reference at `+0x28` and every other
  unlisted field remain unchanged. ROOT additions are still append-only.
  Branch deltas, program counters and ownership counts are **not** patched.

The v8 codec stores positive four-byte deltas, subtracting one before encoding
three bits per nibble, continuation bit `8`, low nibble first. Changed offset tables
are sorted and canonically re-encoded; existing header extensions survive.
Other fixup blocks are copied byte-for-byte. Fixup and Default size changes
shift later **file** offsets, not their encoded pool-relative addresses. Pool
names, alignments, order and bytes are preserved. The observed descriptor
alignment is not a requirement to pad physical pool offsets.

Header `+0x08` is left unchanged: the native writer computes this value over
type metadata and the loader checks it while processing TMET. The writer does
not change that metadata. It is not treated as a checksum of object/string
payload bytes.

RVTB indices are not persistent serialized identities. Appending an object to
Default inserts it before objects in later pools, changing those objects'
indices. The manifest records this count and each new object's output index.
Existing encoded object addresses remain stable.

## Root relocation and external ownership

The real arena has 1,459 root entries: 1,458 ordinary ROFS pointers and one
REXT external reference at index 1,458. Its serialized value is
`0x800000000000014d`, referring to EXID index 333. It must not become ROFS.

The loader's REXT/RNEX paths retain a resolved external object when the
serialized value has its sign bit set. Therefore the writer **moves** an old
array's relocation entries to the new array instead of leaving both sets
active. Otherwise the old, unused array could cause an additional retain.
The old array's raw bytes are preserved but its moved fixups are removed.

Allowed existing list entries are typed-object ROFS pointers, bounded
REXT/RNEX indices with their original sign flag, and unrelocated zero entries.
Other kinds, overlapping fixups, initializer-flag ROFS entries, typed objects
overlapping the old array, and references aliasing the old array are rejected.
The alias check includes newly authored ROFS pointers and overlapping TMHN
payload extents with the supported zero high-pointer word. It does not infer an
unknown 64-bit TMHN pointer schema. Conflicting relocations in the four changed
header fields are rejected. Arrays currently
require `count == capacity` and `dataSize == count * 8`, with an existing ordinary
ROFS data pointer. Empty roots lacking that pointer are deliberately unsupported.

This preserves the observed serialized reference behavior; object activation,
gameplay ownership and teardown still need independent runtime testing.
For newly authored REXT/RNEX slots, the caller explicitly chooses whether to
set the retain bit. Supporting this stored bit is not an ownership policy:
the primitive does not infer reference counts, execution lifetime or teardown.

## API and explicit input contract

Import `inspectAppendTarget`, `appendIgz`, or `writeIgzAppend` from
`tools/igz_append.mjs`. `inspectAppendTarget(buffer, expectedSha256)` returns the
append address, existing type indices/sizes, `stringCount`, `externalIdCount`
and declared roots. A count of zero does not imply a missing block can be added.
The mandatory expected SHA-256 must be supplied as 64 lowercase hex characters.

`appendIgz(sourceBuffer, options)` returns `{buffer, manifest}` without writing.
`writeIgzAppend({source, output, ...options})` writes the result and
`output + '.manifest.json'` exclusively. Parent directories must already exist.

| Option | Meaning |
| --- | --- |
| `expectedSha256` | Required exact source digest |
| `appendedDefaultPool` | Explicit Buffer of appended data; never an inferred actor template |
| `appendedObjects` | `[{offset, type}]`; offsets are relative to that Buffer, types must already exist |
| `fixupSlots` | Optional `{ROFS: [offsets], RSTT: [offsets], ...}`; offsets relative to that Buffer |
| `newStrings` | Optional unique ASCII strings, indexed from the previous TSTR count |
| `newExternalIds` | Optional `[{nameId, namespaceHash}]` uint32 pairs, indexed from the previous EXID count; old pairs/indices preserved |
| `rootList` | Optional `{rootEncoded, appendObjects: [relativeObjectOffsets]}` in the desired new root-entry order |
| `objectLists` | Optional `[{listEncoded, expectedType: "ScriptSetList" or "OpCodeList", appendObjects: [relativeObjectOffsets], insertAt?}]`; at most 32 distinct exact-layout lists |

For example, an appended object's RSTT slot referring to the first new string
must contain `inspectAppendTarget(...).stringCount`, not a string pointer.
An ordinary ROFS slot referring to another appended object must contain
`appendOffset + otherObject.offset`. The caller is responsible for the correct
field schema, all required fixups, and object ownership.

For `objectLists` only, `insertAt` is an integer from zero through the old count,
inclusive; omission means append. New entries are inserted in the supplied
`appendObjects` order without replacing old entries. `rootList` rejects
`insertAt` and stays append-only, preserving existing global-handle positions.
Multiple selected lists are rebuilt together, with replacement arrays after
the explicitly supplied appended bytes. The
original arrays retain their bytes but lose their moved active relocations.
Each manifest entry records its own moved-fixup counts, changed header spans,
`insertAt`, `originalEntryOrderPreserved: true`, and
`originalEntryIndicesPreserved` (false when inserted before an old entry).
`manifest.appended.externalIds` records the exact assigned indices and pairs.
When `rootList` is omitted, the ROOT header, entry order and count remain unchanged.

An existing registered object cannot be added by passing its original RVTB
index; each addition must identify an explicitly authored object within
`appendedDefaultPool`. The same newly authored object may be requested by
different lists, but the writer neither computes ownership nor updates its
reference count automatically. The caller must establish that policy separately.
Unknown list subclasses, list-name suffix guesses, new list schemas, changes to
`ScriptSetList+0x28`, and arbitrary edits of old object fields are unsupported.

The CLI accepts one explicit JSON request:

```bash
node tools/igz_append.mjs /absolute/path/to/append-request.json
```

Its fields are `source`, `output`, `expectedSha256`, `appendFile`,
`appendedObjects`, and the optional `fixupSlots`, `newStrings`, `newExternalIds`,
`rootList`, `objectLists`.
`appendFile` supplies the bytes corresponding to the API's
`appendedDefaultPool`. Paths resolve from the process working directory.
Unknown request fields are rejected. This is a low-level developer interface,
not an end-user command to clone a gameplay actor safely.

## Validation and file safety

The writer rejects unknown fixup kinds and unresolved fixups. It does not add
pool descriptors, types, dependencies, EXNM/TMHN entries, or new fixup-block
kinds. EXID additions require explicit unique pairs. Object spans, vtable words
and new relocation slots are bounds checked;
overlap is rejected. Declared source fixup counts are capped before parser
allocation. Limits include:

- Source and output: 1 GiB; Default: below 64 MiB.
- Source and rebuilt fixup entries: two million total.
- Explicit appended bytes: 16 MiB; with list relocation, all Default growth is
  also capped at 16 MiB.
- Appended objects: 10,000; explicit new fixup slots: 100,000.
- New strings: 10,000, each 1–255 printable ASCII characters, 1 MiB combined.
- New EXID pairs: 10,000, each two integer values in `0..0xffffffff`; old and
  newly supplied pairs must not duplicate a new pair.
- Non-ROOT list extensions: 32; each must use the exact Default
  `ScriptSetList`/`0x38` or `OpCodeList`/`0x28` profile. Each addition list
  contains 1–10,000 distinct appended-object offsets, the enlarged list count
  stays at most one million, and relocated arrays share the 16 MiB growth cap.
- While extending a list, all existing exact `igObjectList`, `ScriptSetList`
  and `OpCodeList` backing spans are checked, including unselected lists that begin before but
  overlap the moved array. Supported headers require `count <= capacity <=
  1,000,000`, a serialized span of `capacity * 8`, and a bounded ordinary ROFS
  data pointer for nonempty spans. Unknown list subclasses are not inferred.
- CLI JSON request: 4 MiB.

The rebuilt file is reparsed before any output is created. Additional checks
compare preserved Default bytes, later pools/gaps, unchanged fixup blocks,
existing object identities, appended bytes, string identities and relocated
list entries. Source, explicit appended bytes and output each have SHA-256
digests in the manifest.

The file wrapper uses bounded regular-file reads, read-only source handles,
exclusive output creation, source identity checks, fsync and SHA-256 readback.
Existing output files, hard links and live/dangling symlinks are not overwritten.
On a caught failure, cleanup only removes the output/manifest inodes created
by that invocation. Files are visible during writing; this is not a two-file
atomic transaction. Process termination can leave partial outputs, and there
is no cross-process locking protocol.

## Reproduction and observed result

Synthetic tests need no game assets:

```bash
node --test tests/igz_append.test.mjs
```

The optional real-file check is memory-only and does not create or install a
modified level:

```bash
SKYLANDERS_TEST_LEVEL=/absolute/path/to/level.bld \
  node --test tests/igz_append.integration.test.mjs
```

Twenty synthetic tests cover independent codec vectors, later-pool identity
preservation, root/list bounds, source SHA and allocation caps, unique string
append, external fixup moves, adversarial aliases, unknown fixups, exclusive
creation and injected partial-write cleanup. The four added list tests cover
simultaneous title/load-style list growth with and without ROOT growth,
preserved signed type/element relocations, list-array aliases/interiors and
typed-object overlaps, conflicting header relocations, TMHN aliases and
exclusive output behavior.

The local arena source SHA-256
`de0ecd5bc5f5f2b3d99ec81592e8fef97a3228e6777e99f1c169e6cd584e7a32`
passed a structural append of one **empty igObjectList**, plus one unused test
string. Object count changed 32,666 → 32,667 and root count 1,459 → 1,460. Its
537 later-pool RVTB indices shifted; encoded identities and unrelated bytes
did not. Size changed 91,745,564 → 91,757,336 bytes. The deterministic in-memory
output SHA-256 was
`87b51bd0b38409eccac5c63554ae443385002937636478938452be16247fe9a6`.
The source hash and modification time remained unchanged.

That empty list is only a structural probe, **not a new actor or playable map**.
Runtime acceptance, correct actor activation, unique collision/parameter
ownership, collision behavior and a complete new level remain outside this
primitive's validation.

## Memory-only global title/load list probe

The real global file is `research/permanent_global/level.bld`, 41,032,288 bytes,
SHA-256:

```text
c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c
```

Its `Level_AdventureTitles` and `Level_Loads` sets point to ScriptSetLists
#23506 / #25073, encoded addresses `0x230100` / `0x2506a8`. Both contain
22 entries and retain a signed RNEX type reference at `+0x28`. The input ROOT
contains 3,022 entries. These indices describe this exact source, not a general
chapter-registry schema.

```bash
SKYLANDERS_TEST_GLOBAL=research/permanent_global/level.bld \
  node --test tests/igz_append.integration.test.mjs
```

The optional test constructs two intentionally empty `StringInfo` structural
records and two diagnostic TSTR names **in memory**, and extends both lists
22 → 23. It does not provide meaningful chapter titles, load paths or gameplay
registration. There are two variants:

| Variant | Global ROOT count | In-memory output SHA-256 |
| --- | ---: | --- |
| Only the two ScriptSetLists grow | 3,022 → 3,022 | `af6afc9d3fae3bee66eada6d319fed3c54daef6713c9855eb904cd5c7be21784` |
| Also explicitly append both objects to global ROOT | 3,022 → 3,024 | `882fa439907751fae9e9d2c0de4ad9f697baf48e93ce4a23e9f707f24cc7fad3` |

Both preserve every old ROOT entry at its original index, both old typed-list
prefixes, all prior strings and the original RNEX relocation locations. Source
SHA-256 and modification time remain unchanged. No output IGZ is written, no
archive is repacked, and no game installation is touched. The prior arena probe
still produces its identical recorded output hash after this extension.

The static native global-registration rule is described in
[CHAPTER_REGISTRY.md](CHAPTER_REGISTRY.md): with the bootstrap count unchanged,
appending at the **end of global ROOT** does not renumber existing global handles.

## Memory-only initializer insertion probe

The independent integration test also supports the exact initializer
`research/init_setup/level.bld`, SHA-256
`2d1fabe7de81e6057b676909ecb58c56883bd825ba99b274f45ab38860f989e7`:

```bash
SKYLANDERS_TEST_INITIALIZER=research/init_setup/level.bld \
  node --test tests/igz_append.integration.test.mjs
```

This structural probe inserts one authored object at row 86 of `OpCodeList`
648 (encoded address 61736), increasing 624 rows to 625. It appends EXID 580
with pair `3048/647282318`, and checks new signed RNEX 9 / REXT 580 slots.
All previous EXID bytes/indices and all old opcode bytes remain unchanged;
the old array's relocations move rather than remaining active twice.
The in-memory output SHA-256 is
`fe30d0a5e48a0685fc67fc904e23d5ec27c952be8b930835526dce74e11c517a`.

**This test output is intentionally not executable registration.** It does not
apply the separate, source-pinned branch/program-counter/reference-count
policy, pair a changed global file or validate runtime behavior. Nothing is
written or installed. See [CHAPTER_ENTRYPOINTS.md](CHAPTER_ENTRYPOINTS.md) for
the required policy evidence; parsing this low-level output is not proof of
successful chapter selection or gameplay.
Appending to **bootstrap ROOT would change the base of global handles**; this
generic writer does not authorize or make that operation safe. The current
probe leaves bootstrap entirely untouched.

This closes only a structural primitive needed for a later chapter writer.
Correct StringInfo values/ownership, coordinated chapter/loader/script entries,
unlock/progress/save IDs, resource import and runtime chapter selection remain
separate validation gates. A 23-entry list is not evidence of a 23rd playable
chapter.
