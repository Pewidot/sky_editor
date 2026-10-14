# Paired chapter registration draft — not deployable

`tools/chapter_registration_draft.mjs` creates **new, private structural
drafts**: global title/load objects and corresponding text dictionaries.
The original paired API covers English only; the explicit `all-languages`
mode covers every language member in the exact original global archive.
Neither mode installs files, creates a playable level, adds a chapter
selection entry, modifies saves, or claims runtime acceptance.

The supported inputs are the exact original CUSA00697 global inner `level.bld`
and its language IGZ members. Other revisions fail their pinned SHA-256
checks. See [setup from your own PKG](SETUP.md),
[chapter entrypoints](CHAPTER_ENTRYPOINTS.md), and
[the append primitive](IGZ_APPEND.md). Do not distribute the inputs or generated
drafts; the source tool and synthetic tests contain no game assets.

## What this closes

The writer authors two native-sized `StringInfo` objects (`0x48` bytes), with
two new TSTR object names and independent UTF-16LE text values. It appends one
object to `Level_AdventureTitles`, one to `Level_Loads`, and both to the end of
the global ROOT list. Counts become **23, 23, and 3,024**. All existing entries
retain their order, encoded identities and numeric global handles. The two
new global name IDs are **3,048 and 3,049**, conditional on the unchanged
25-entry bootstrap ROOT. The tool does not inspect an installed game's
bootstrap and explicitly records that requirement in the manifest.

Both new names are ASCII-only and checked for case-insensitive **FNV-1a hash
collisions**, including unequal strings with equal hashes. The check is
conservatively against every original global TSTR entry, not only StringInfo
names. The native ASCII lowercase namespace maps `global.bld` to `0x2694be8e`.
This does not validate the chapter number or the candidate level filename.

The English dictionary grows from **802 to 804 entries**. Its assignment order
is **RVTB StringInfo order**, excluding names beginning with `^`; it is not
ROOT order. This distinction matters when a new Default-pool object is
inserted before an existing StringInfo in a later pool. The writer reconstructs
the complete dictionary using stable encoded object identities, preserving
every original UTF-16 byte sequence, including empty strings, BOMs and
surrogate pairs. A synthetic multi-pool regression exercises precisely that
ordinal shift. The real supported global file's 802 StringInfos are all in
Default, so their ordinals happen to remain unchanged.

Language dictionary storage has a deliberately narrow policy: append a complete
replacement allocation to the existing final `Text` pool. Preserve the entire
original allocation, all relocation tables and all other bytes. Only these
three original spans change:

| Span | Change |
| --- | --- |
| Final Text descriptor `size` | Extended to include alignment and replacement dictionary |
| `LanguagePackInfo +0x28` | Replacement dictionary byte length |
| `LanguagePackInfo +0x30` | Encoded pointer to replacement dictionary |

The original Text pool must have a zero word followed by exactly one bounded
dictionary, no typed objects or fixup slots, and no other ordinary pointer or
TMHN data alias. The memory flags must be the observed `0x80000000`. Unknown
fixups, unresolved pointers and unsupported high-word TMHN pointers fail
closed. This is not a generic memory-pool serializer.

## Ownership evidence and remaining runtime gate

Each new object has exactly two serialized incoming ordinary ROFS slots:
global ROOT and its one ScriptSetList. The initial reference count is fixed to
2; there is no caller-supplied arbitrary count option.

This policy is statically corroborated, not runtime-tested:

- `ScriptSetList` constructor `0xb8d2bc`, size `0x38`, installs vtable
  `0xf51a90`. `igObjectList` constructor `0xbd8900`, size `0x28`, installs
  vtable `0xf798b0`.
- Their vtable `+0x38` callbacks are `0x48af60` and `0x524ae0`.
  `0x48af60` first calls `0x524ae0`. When its second argument is 1, that
  routine traverses count at `+0xc`, data at `+0x20`, calls release
  `0x51c280` for each nonnull entry, then clears entries and count.
- The IGZ loader preserves the serialized low reference-count bits and does
  not retain ordinary ROFS pointers. See [actor ownership](ACTOR_CLONE.md).
- Original title StringInfo `#23507` has count 4 and four incoming ROFS;
  original load StringInfo `#25074` has count 3 and three incoming ROFS.
  Neither has object-field relocations beyond its name RSTT slot.

REA evidence IDs for vtables and release paths are
`ev_1af4b13090a5a0bdef740ac29b530f5dfdbe96f0ece28b337dda8ca3cac29d52`
and `ev_faca8c4b6942c014242c19968236ba435acc9661f37f4f02660e24170a9182fc`.
Dictionary/postload/loader evidence identifiers are embedded in the manifest.
The new objects' runtime construction, registration, postload, teardown and
gameplay remain untested. `ownershipVerifiedAtRuntime` remains false.

## Reproduce privately

Extract from your own legally obtained supported PKG, into new private paths:

```sh
tools/iga_extract extracted/CUSA00697/permanent/global.bld level.bld research/permanent_global/level.bld
tools/iga_extract extracted/CUSA00697/permanent/global.bld ENGLISH.pak research/permanent_global/ENGLISH.pak
```

Create a request JSON file, for example `research/chapter-registration-request.json`:

```json
{
  "global": "research/permanent_global/level.bld",
  "language": "research/permanent_global/ENGLISH.pak",
  "outputDirectory": "builds/chapter-registration-draft-01",
  "expectedHashes": {
    "global": "c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c",
    "language": "826712f658a803b1f03419ef571cd3b48c157e440d4eef43ac5f2613a6265e22"
  },
  "titleName": "AI_Workshop_Title",
  "loadName": "AI_Workshop_Load",
  "titleText": "Modular Test Island",
  "loadText": "Level_900_AIWorkshop"
}
```

```sh
node tools/chapter_registration_draft.mjs research/chapter-registration-request.json
```

The output directory must **not exist**; its parent must exist. The writer
creates only `global.registration-draft.igz`, `ENGLISH.registration-draft.igz`
and `manifest.json`. Inputs are descriptor-opened read-only with no-follow,
SHA-bound and checked for identity/size/timestamp changes. Outputs are
exclusively created, fsynced and hash-read back through their open descriptors.
If creation fails, only this invocation's own output inodes are removed. An
unrelated file appearing in the new directory is preserved. This protects
normal partial-output failures; it is not a transactional installation or
power-loss-recovery mechanism. There is no overwrite, packaging or install
mode.

The tool exposes pure `rebuildStringDictionary` and
`rebuildEnglishDictionary` helpers for synthetic structural regressions.
The full `createChapterRegistrationDraft` and file-writing API always enforce
the pinned original input profile. The generic dictionary helper's caller
supplies the expected hash; passing its structural checks is not permission
to bypass the full draft's profile/runtime gates.

## Explicit blockers

The manifest always sets `deployable` and `runtimeValidated` to false. The
paired English-only API also sets `languageCoverageComplete` to false;
no assumptions are made about missing language packs. Its two outputs must
be kept paired. The all-language mode below can close the finite language
coverage gate, but none of the other deployment gates.

Story-order membership and initializer scripts are not modified. The proposed
`Level_900_AIWorkshop` is just a bounded string, not a proven free or valid
chapter ID, archive path, loading route or save identity. No geometry,
resources, collision, scripts, actors, encounter/completion flow or level
archive is created here.

Most importantly, existing save scripts derive level-dependent allocations
from `Level_Loads.count`. Growing 22 to 23 can change save layout; preserving
old global handles does **not** establish compatibility with existing saves.
Do not install these drafts, even together, before the script/registration,
all-language, save migration and runtime checks have been completed.

## Tests

The private generated sample is `builds/chapter-registration-draft-01/`.
Its global output SHA-256 is
`b50e058af937b75db5611c3679946c8c3e71c883f82af37a2cf5e6413560c6f1`;
the English output is
`731e754e41339a394baa5990b92d61ae5c773e9002a1c5ab719fb01f6ab47c40`.
An independent follow-up through the existing chapter registry/entrypoint
readers confirms 23 title/load pairs, 804 strings and the original 22 pairs'
texts unchanged. It also confirms **18 story statements and no story include
for the new pair**, not a new selectable chapter. The private
`independent-validation.json` records the exact inputs and this distinction.

```sh
node --test tests/chapter_registration_draft.test.mjs
SKYLANDERS_TEST_GLOBAL=research/permanent_global/level.bld \
SKYLANDERS_TEST_ENGLISH=research/permanent_global/ENGLISH.pak \
node --test tests/chapter_registration_draft.test.mjs
```

The default suite uses only synthetic data. The optional private-source test
checks original ROOT order, new incoming reference counts, paired text
assignments, deterministic output, exclusive creation, source symlink
rejection and injected partial-failure cleanup without deleting unrelated
files. It never installs drafts into the game.

The example request above was run privately after all **33** combined
append/entrypoint/draft tests passed (including the opt-in original inputs).
Original source hashes stayed unchanged. Its two output identities were:

| Private output | Bytes | SHA-256 |
| --- | ---: | --- |
| `global.registration-draft.igz` | 41,057,052 | `b50e058af937b75db5611c3679946c8c3e71c883f82af37a2cf5e6413560c6f1` |
| `ENGLISH.registration-draft.igz` | 185,426 | `731e754e41339a394baa5990b92d61ae5c773e9002a1c5ab719fb01f6ab47c40` |

These hashes describe structural artifacts, not a successful game test.

## All-language structural draft

The original archive `extracted/CUSA00697/permanent/global.bld` is 13,283,554
bytes with SHA-256
`f1358f785eb6fb2826adbf028aa30ebdbd1b02b32b3dc3d8f3c70dbd634bcb4f`.
Its complete inventory is **11 members: inner `level.bld` at index 6 and
the ten languages below**. These were freshly extracted with the existing
exclusive-output `iga_extract`, not copied from an assumed locale list.

| Member | Archive index | Language ID | Original bytes | Original SHA-256 |
| --- | ---: | ---: | ---: | --- |
| `FRENCH.pak` | 0 | 8 | 161,266 | `0b108adc1b854fb8c42ef4e9e685f09a5fa65ce7047802e9a5e1ee5e2d22e7f0` |
| `SPANISH.pak` | 1 | 21 | 162,312 | `1d4724c04d5cac4caa59da4ad46bfd0420cb0ba2bdbad1a60ff3d17720a9baee` |
| `SWEDISH.pak` | 2 | 23 | 157,640 | `46fe8842c7e2f1d70145a48356c842b0a55d4195024726273b9ac2ca4b956f78` |
| `FINNISH.pak` | 3 | 7 | 159,070 | `f16c25a821f12fc5b4153bb95f40d2aaf348c6c7046e08d2fd5d3a2bcfe94265` |
| `DUTCH.pak` | 4 | 5 | 159,448 | `cd2c5678400a5dfebfe2e8e8fd5a800bbda797d35809ca39cb8641effcb3a5e9` |
| `NORWEGIAN.pak` | 5 | 17 | 157,358 | `d5505473162722c78930287af654d0987308b20cb4efd78a1e7a8591dbf74905` |
| `DANISH.pak` | 7 | 4 | 157,766 | `b1c0ae8ca87f054695fc36b73869c6eec08d526d821a350834162e5ae8713bac` |
| `ENGLISH.pak` | 8 | 6 | 157,668 | `826712f658a803b1f03419ef571cd3b48c157e440d4eef43ac5f2613a6265e22` |
| `GERMAN.pak` | 9 | 9 | 159,842 | `987aa27d2806007be0397b2603a752f3f3eb9f9e80572e45c2e076487e8f2144` |
| `ITALIAN.pak` | 10 | 14 | 162,430 | `14c84e620d7dab809875a573d64a14b8826d714c6b3fa3a6aeaa8e48073d9370` |

Each pack has one `LanguagePackInfo`, 250 objects, and 802 original UTF-16
entries. All have the verified final Text-pool layout and `0x80000000`
dictionary flags. Norwegian's physical object/Text offsets differ by four
bytes; the implementation derives positions from descriptors and relocations.
It does not reuse English file offsets.

The all-language API requires the original archive itself, every listed
payload and all expected hashes. It verifies the exact-hash archive's complete
member inventory and the independently pinned extracted-member hashes. A
missing, additional, mislabeled, changed or unsupported member fails before
output creation. This is a finite profile, not automatic language discovery
for arbitrary revisions. No new language ID can be supplied to bypass the
profiles. The original English-only API and synthetic English helper remain
available unchanged.

For each language, all **802 original assignments remain byte-exact** and two
new entries are inserted in the rebuilt RVTB order. The new title uses the
explicit English fallback policy for nine non-English packs; it is **not a
translation**. The load identity is identical in all ten packs. The global
payload and English payload are byte-identical to the English-only API for
the same request.

Extract the complete language inventory into a new private directory:

```sh
mkdir research/permanent-global-languages-01
for language in FRENCH SPANISH SWEDISH FINNISH DUTCH NORWEGIAN DANISH ENGLISH GERMAN ITALIAN; do
  tools/iga_extract extracted/CUSA00697/permanent/global.bld "$language.pak" "research/permanent-global-languages-01/$language.pak" || exit 1
done
```

Create a request such as `research/chapter-registration-all-languages-request.json`:

```json
{
  "mode": "all-languages",
  "archive": "extracted/CUSA00697/permanent/global.bld",
  "global": "research/permanent_global/level.bld",
  "languages": {
    "FRENCH.pak": "research/permanent-global-languages-01/FRENCH.pak",
    "SPANISH.pak": "research/permanent-global-languages-01/SPANISH.pak",
    "SWEDISH.pak": "research/permanent-global-languages-01/SWEDISH.pak",
    "FINNISH.pak": "research/permanent-global-languages-01/FINNISH.pak",
    "DUTCH.pak": "research/permanent-global-languages-01/DUTCH.pak",
    "NORWEGIAN.pak": "research/permanent-global-languages-01/NORWEGIAN.pak",
    "DANISH.pak": "research/permanent-global-languages-01/DANISH.pak",
    "ENGLISH.pak": "research/permanent-global-languages-01/ENGLISH.pak",
    "GERMAN.pak": "research/permanent-global-languages-01/GERMAN.pak",
    "ITALIAN.pak": "research/permanent-global-languages-01/ITALIAN.pak"
  },
  "outputDirectory": "builds/chapter-registration-all-languages-01",
  "expectedHashes": {
    "archive": "f1358f785eb6fb2826adbf028aa30ebdbd1b02b32b3dc3d8f3c70dbd634bcb4f",
    "global": "c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c",
    "languages": {
      "FRENCH.pak": "0b108adc1b854fb8c42ef4e9e685f09a5fa65ce7047802e9a5e1ee5e2d22e7f0",
      "SPANISH.pak": "1d4724c04d5cac4caa59da4ad46bfd0420cb0ba2bdbad1a60ff3d17720a9baee",
      "SWEDISH.pak": "46fe8842c7e2f1d70145a48356c842b0a55d4195024726273b9ac2ca4b956f78",
      "FINNISH.pak": "f16c25a821f12fc5b4153bb95f40d2aaf348c6c7046e08d2fd5d3a2bcfe94265",
      "DUTCH.pak": "cd2c5678400a5dfebfe2e8e8fd5a800bbda797d35809ca39cb8641effcb3a5e9",
      "NORWEGIAN.pak": "d5505473162722c78930287af654d0987308b20cb4efd78a1e7a8591dbf74905",
      "DANISH.pak": "b1c0ae8ca87f054695fc36b73869c6eec08d526d821a350834162e5ae8713bac",
      "ENGLISH.pak": "826712f658a803b1f03419ef571cd3b48c157e440d4eef43ac5f2613a6265e22",
      "GERMAN.pak": "987aa27d2806007be0397b2603a752f3f3eb9f9e80572e45c2e076487e8f2144",
      "ITALIAN.pak": "14c84e620d7dab809875a573d64a14b8826d714c6b3fa3a6aeaa8e48073d9370"
    }
  },
  "titleName": "AI_Workshop_Title",
  "loadName": "AI_Workshop_Load",
  "titleText": "Modular Test Island",
  "loadText": "Level_900_AIWorkshop",
  "titleFallback": "english"
}
```

```sh
node tools/chapter_registration_draft.mjs research/chapter-registration-all-languages-request.json
```

Outputs are `global.registration-draft.igz`, ten
`LANGUAGE.registration-draft.igz` files and one manifest in a **new** directory.
The manifest maps each output to its original archive member, includes a
separate dictionary assignment ledger and rebuild record for every language,
and sets `languageCoverageComplete: true` only after all checks. Its scope is
**all language members of this exact original global archive**, not every
language or archive in the game. `authoredTitleTranslationsComplete`,
`deployable` and `runtimeValidated` remain false. Keep all eleven payloads
together; there is no archive replacement or installation in this tool.

All-source tests additionally verify missing/mislabeled members, changed
archive inventory, per-language old-text preservation, Norwegian offsets,
identical global bytes and group failure cleanup. The failure test aborts
during the seventh output, removes only this invocation's own partial files
and preserves an injected unrelated file.

```sh
SKYLANDERS_TEST_GLOBAL=research/permanent_global/level.bld \
SKYLANDERS_TEST_ENGLISH=research/permanent_global/ENGLISH.pak \
SKYLANDERS_TEST_GLOBAL_ARCHIVE=extracted/CUSA00697/permanent/global.bld \
SKYLANDERS_TEST_LANGUAGE_DIRECTORY=research/permanent-global-languages-01 \
node --test tests/chapter_registration_draft.test.mjs
```

The all-language example was generated privately in
`builds/chapter-registration-all-languages-01/` after all nine draft tests
passed with the original inputs. Its manifest SHA-256 is
`d468ab925d5b6240e85ed0ae2437677b61005183bf9f718856b68b231ce31753`.
The manifest contains every output SHA-256 and archive-member mapping.
All ten extracted source hashes and the original archive hash remained
unchanged. The global and English outputs were also compared byte-for-byte
against the earlier paired draft and matched. No output was installed.
The subsequent combined append/entrypoint/draft run passed all 40 tests.
