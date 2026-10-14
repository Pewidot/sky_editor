# Chapter titles, load strings and the startup pairing

`tools/chapter_entrypoints.mjs` extends the read-only
[chapter registry](CHAPTER_REGISTRY.md). It joins the original global title/load
sets through the initializer's **shared index expression**, and decodes the
corresponding language pack through the native string-assignment order. It
exports 22 title/load pairs, 18 story-order include statements, and the separate
final-battle load string. It does **not** insert or run a new chapter.

## What the original files establish

`Global - Set Up Adventure Data` in `Init_Setup_Adventure.ai` contains these
serialized operations (zero-based opcode rows, not addresses or line numbers):

| Row | Observed operands |
| --- | --- |
| 16–19 | Count-dependent adventure-data setup and an `OpLoopValue` |
| 20 | Select an adventure-data record through the loop expression |
| 21 | Set `adventure data scratch.title` from `Level_AdventureTitles` |
| 22 | Set `String Scratch G1` from `Level_Loads` |
| 23 | Include `String Scratch G1` in `adventure data scratch.level loads` |
| 24–25 | Store `savegame difficulty bit offset` and update `difficulty bit count` |
| 26–29 | Call `Global - Set Adventure Difficulty Segments` with that title |
| 33–38 | Get adventure data for `Level_301_TheMachine(1)`, then include `FinalBattleLoadString` through its returned parameter |
| 50–84 | The 18 story-order `adv order` include statements, interleaved with hub-lighting operations |

Rows 21 and 22 both refer to the **same** `ValueRHSVariant #700`; its
`RHSValueStack` contains `OpLoopValue #694`. Thus the pairing is supported by
serialized script operands and native indexed-assignment semantics, not by
stripping `(1)` from names or assuming title names equal archive names. The
exporter retains exact object IDs, offsets, operand slots and evidence IDs.
The full VM, macro return values and branch conditions are not evaluated here.

### Native evidence, exact supported ELF only

The ELF SHA-256 remains
`423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3`.

- `OpSetReference` field initializer proves `_LHS +0x38`, `_RHS +0x40`,
  `_indexRHS +0x48`: `ev_e62faa34f3514f51e6b67274930dfea7b32a18f75cbc6174547e750d47d494f5`.
- Execute procedure `0x484890` resolves RHS plus index, resolves LHS and calls
  its setter: `ev_c3fe69571e63c15f7493e9fa271e59e889854fd6ac6c11cf582cdb47845c547c`.
- `LanguagePackInfo._stringDict +0x28` is a memory field; the serialized byte
  length is at `+0x28` and its data pointer at `+0x30`:
  `ev_59dc599ed20f44f8411e0e19ec5fc0303e8ff7a445f362ce3b00004c71ab0d92`.
- `LanguagePackInfo` callback `0x485bf0` sets the shared UTF-16 cursor:
  `ev_6ac0f127420b57fa405f8529bf180541024cfd1e07c3d6964f0c95c656619c8f`.
- `StringInfo` post-load callback `0x485c40` assigns `_unicodeText +0x30`
  from that cursor and advances past the next UTF-16 NUL. Names starting with
  `^` do not consume a dictionary entry:
  `ev_d5331c43aeaadcbbff8d89bf8123a0efba6c744e246a14eb01239bc8db9b4edd`.
- Loader `0x56a5a0` invokes callbacks in two complete ascending **RVTB** passes
  (vtable slots `+0x60`, then `+0x68`):
  `ev_e4efcca476e72dea97ca79ba07af045ce80540d37ac391aae79acaf3757f3109`.
- `SetVariant` registration `0xb8ccba` identifies the class
  (`ev_66062c938ad3ea1141fbd0aaa3244f0bd27a747a56c9871557b1a4d3a1d601b3`).
  Registration `0xb8cdfc` binds its `count` getter `0x4814a0` and setter
  `0x4814c0` (`ev_11fdeffa6dbac8c21e58bab96a17dcae08a8da71ca801acc343674010484d77a`).
  Helper `0x46ff80` registers the class-name/property-name pair
  (`ev_fe8028a89ebb7d05dbae502b7fa5b4aede3a10c45c170196c2e42c82af6043c6`);
  the getter reads the referenced object's count at `+0x0c`
  (`ev_9f8ccd6874c8a1fcd07054d9ef18fa78cec79d6e6073469251e8efa953188b05`).
- `ArithOp` initializer `0x46ec40` gives `NO_OP=-1`, `ADD_OP=0`,
  `SUB_OP=1`, `MULT_OP=2`, `DIV_OP=3`:
  `ev_30d11f5eb05ad1511822c63bb3e5c90dee78300a4afe7f1afe2f14e480a4276d`.
  `ValueRHSVariant` operand/arithmetic offsets are native field metadata:
  `ev_9e95a8f9b79e0a0c554db8bb39fc803291ad4e52aff869e527f1bd2e8098c2cf`.

The order is **not ROOT/global-handle order**. This distinction matters: the
original global file has 802 `StringInfo` objects in both orders, but those
orders differ. The supplied corresponding English pack contains exactly 802
UTF-16 strings. The tool rejects mismatched counts rather than returning a
plausible partial mapping. It assumes the caller selected the pack belonging
to that archive; it does not reconstruct the game's language-selection loader.

## Concrete mappings

The first three story include statements decode to Soda Springs /
`Level_313_Tutorial`, Know-It-All Island / `Level_314_Tutorial_2`, and Chompy
Mountain / `Level_316_PirateFortress`. Original source labels are sometimes
**different** from their load text:

| Global `StringInfo` label | Actual English dictionary load text |
| --- | --- |
| `Level_301_TheMachine` | `Level_301_The_Machine` |
| `Level_304_WaterWave` | `Level_304_Water_Wave` |
| `Level_305_ToyFactory` | `Level_305_WilikinFactory` |
| `Level_309_Sewer` | `Level_309_Sewers` |
| `Level_310_EvilTwins` | `Level_310_DreamLand` |
| `Level_312_AirPirates` | `Level_312_Starlands` |
| `Level_314_Tutorial2` | `Level_314_Tutorial_2` |
| `Level_320_Light_Exp` | `Level_320_ElementOfLight` |
| `Level_327_Kaos_Exp` | `Level_327_Kaos_XP` |
| `FinalBattleLoadString` | `level_317_finalbattle` |

All 22 main load strings have matching lowercase `level/<name>.bld` and `.arc`
files in the owned extraction. Those paths are exported as **candidates**:
existence is not a captured file-open or proof that every dependency is loaded.
The additional final battle is not a 23rd member of the title/load sets. Rows
33–38 attach a second load to a chapter's adventure-data structure; a future
authoring format must support multiple loads per chapter. Four pairs have no
include in this 18-entry story sequence; other expansion setup remains separate.

## Save/allocation inputs: three different identities

Do not conflate the include ordinal, the adventure-data `id`, and the numeric
component of a load filename. Additional inspected operands establish:

- Adventure initializer rows 382/384/385 call `UI - Text - Get Numbers From
  String` on an adventure's `level loads`; row 387 writes the returned number
  into `level file number` (variable object `#1147`). The exact text-parser
  behavior is not decoded, but filenames' numbers are script-consumed data.
- `Global - Order Adventure Data` rows 419–422 rearrange `adventure data` /
  `story adventures` sets. Row 425 (`OpSetValue #1197`) assigns
  `level progression data.adventure scr.id` (variable `#1199`) from the loop
  expression `ValueRHSVariant #1195 → RHSValueStack #1196 → OpLoopValue #1191`.
  It is therefore unsafe to assume insertion into the middle preserves all
  previously assigned adventure IDs. Save migration needs the actual readers.
- In the same inner source, `tfbScriptInfo #10760`,
  `Init_Setup_SaveGame.ai`, has 1,209 opcode rows. Its row 35
  (`OpSetValue #10802`) assigns `level count` (`#10785`) from the exact
  `ValueRHSVariant #683` also used at adventure-initializer row 16. That
  expression references `Level_Loads` plus EXID `#41`, now resolved as
  **`SetVariant::count`**. The native class/member registration and getter
  corroborate the exact lowercase FNV-1a identities
  (`nameId=967958004` / `0x39b1ddf4` for `count`,
  `namespaceHash=1549491124` / `0x5c5b5bb4` for `setvariant`). Its
  `ValueRHSVariant` arithmetic field is `NO_OP=-1`; this is a direct
  count expression, not an identification guessed from operand position.
  The exporter still does not evaluate the whole stack or capture its runtime
  value.

These save-definition call arguments depend on that `level count` variable:

| Save script row | Save parameter | `fields total` operand |
| --- | --- | --- |
| 518 (`OpMacroParameter #11077`) | `level flags` | `#10968 → #10969 → level count #10785` |
| 528 (`OpMacroParameter #11082`) | `level flags - objectives` | Same expression |
| 538 (`OpMacroParameter #11087`) | `level flags - areas` | Same expression |

Rows 506–509 define `difficulty tracking`; its `fields total` parameter reads
`Scratch G1`, assigned at row 502 (`#11067`). The RHS `#11068` has operands
`DifficultyTracking_SegmentsPerLevel` (`RHSValueStack #693`) and `level count`
(`#10969`). Native `ValueRHSVariant` metadata places the operands at `+0x10`
and `+0x20`, and the arithmetic field at `+0x18`; its serialized value `2`
is `MULT_OP`. Thus the allocation input is the product of those two operands,
not an unknown arithmetic operation. The operands' full runtime values and
the save allocator are not evaluated here. Header `slot level IDs` rows 137–140 instead
use `save slots` (`#10787`) for `fields total`. None of these observations
establish spare save space, final bit offsets, safe maximum chapter counts, or
backward compatibility after changing allocation. The save-construction macro,
every consuming reader and the existing converted save must be checked together.

## Bounded plan for a 19th story include

The following source-bound graph-edit plan is now implemented as a **non-deployable
initializer draft** by `tools/story_registration_draft.mjs`; see
[STORY_REGISTRATION_DRAFT.md](STORY_REGISTRATION_DRAFT.md) for reproduction and
tests. It is not proof of a playable extra chapter. It applies only to the exact
initializer source above and requires a paired title/load append in global data
and corresponding language dictionaries.

### Insertion point and existing consumers

The adventure script's `OpCodeList #648` has 624 rows. Its 18 `adv order`
include statements occupy rows 50, 52, …, 84. The original last statement is
`OpChangeMembership #799`, selecting `Level_301_TheMachine(1)` through
`ScriptGroupStack #800`. Row 85 is a separate `hub lighting order` include;
row 86 begins the call to `Global - Set Level Unlocks` (`#801`).

One candidate minimal insertion is therefore **one new `adv order` include at
old row 86**, before the unlock call. Original rows 86–623 move forward by one.
The existing unlock call passes the whole `adv order` set. Its definition at
rows 372–381 loops over that parameter's count, selects the next item by
`loop index + 1`, and includes it in the current adventure's
`unlocks adventures`. This supplies a concrete dataflow for connecting an
appended final chapter; whether the original finale/completion flow permits
that transition still needs runtime testing.

There are already **19 lighting include statements for 18 story includes**:
rows 49, 51, …, 85. The last uses `lighting_00`. In `Global - Order Adventure
Data`, row 427 loops over `story adventures.count`; row 429 selects from the
passed lighting order with the same loop index, and row 430 assigns
`^hub lighting on complete`. Thus the existing 19th lighting entry is a
candidate for the appended chapter without adding another lighting opcode or
shifting existing lighting indices. This is an operand-based plan: runtime
list contents, duplicate-inclusion behavior and the actual resulting lighting
have not been captured. Interleaved source statements alone are not proof of
those results.

### Required objects, references and external handle

The isolated new include would clone the **shape**, not the identity, of:

- `OpChangeMembership #799` (80 bytes), keeping native `Combiner.include=0`,
  zero branch delta and the existing opcode-name string. Its `_LHS +0x38`
  can continue to reference `SetStack #757`, which already serves all 18
  story includes and selects local variable `adv order #664`. Its
  `_RHS +0x48` must point to the new group stack.
- `ScriptGroupStack #800` (48 bytes), with one new 8-byte data cell. Its
  count/capacity remain 1/1 and data length remains 8; the data pointer at `+0x20`
  points to the new cell. The original type slot at `+0x28` is an **RNEX**
  reference `0x8000000000000009`, whose EXNM entry is
  `StringInfo / metaobject`; it is not an ordinary object pointer.

The clone needs new RVTB entries, the opcode's RSTT slot, its two ROFS fields,
the group-stack data ROFS field, its RNEX type slot, and the data cell's REXT
slot. Original opcode and group-stack objects remain unchanged. Sharing
`SetStack #757` reproduces existing sharing; it is not a general proof that
arbitrary script objects or mutable stacks can safely be shared.

Original global ROOT has 3,022 entries and bootstrap ROOT has 25. If the new
title is the **first** appended global ROOT entry, its root index is 3022 and
native handle is `3022 + 25 + 1 = 3048` (`0xBE8`), namespace `0x2694BE8E`
(`global.bld`). The initializer has 580 EXID entries, so an appended entry at
index 580 would contain `(nameId=3048, namespaceHash=0x2694BE8E)`. The new
RHS cell would preserve the original title-reference form:
`0x8000000000000244`, little-endian bytes `4402000000000080`. This is **EXID
index 580**, not handle 3048 stored directly. If another object precedes the
new title in appended ROOT entries, derive its handle from that actual root
index instead. Existing handles and EXID indices must not shift.

The opcode-list payload must be rebuilt as 625 references with the new opcode
at row 86, preserving every original row reference in order. Its original
count/capacity are 624/624, byte length 4,992, and the payload ends exactly at
the next typed object: there is **no in-place spare slot**. A relocated payload
would require count/capacity 625/625, byte length 5,000, an updated list data
pointer and moved ROFS entry relocations. The original payload has only its
own header's inbound pointer and no observed TMHN alias. `tfbScriptInfo #647`
is the sole ordinary pointer owner of list `#648`.

### Three crossing deltas and the native binding pass

For a one-row insertion before old row 86, exactly these nonzero serialized skip spans
cross the insertion. The VM preincrements PC; the numeric target convention
is `row + 1 + unsigned branchPC`:

| Original row / object | Type | Old delta → candidate delta | Old numeric target → new target |
| --- | --- | --- | --- |
| 0 / `#649` | `OpPreScript` | 623 → 624 | 624 → 625, one past list |
| 4 / `#651` | `OpMacroSection` | 618 → 619 | 623 → 624 |
| 5 / `#652` | `OpDefineMacro` | 292 → 293 | 298 → 299 |

These three objects occur in no other opcode-list rows in the initializer.
The setup macro object `#652` is also referenced by a caller, so preserving its
identity while changing its scalar delta in the authored copy is important;
blindly cloning it would require rebinding that caller too. Deltas wholly
before or wholly after the insertion retain their numeric value. This table
does not assert that every opcode uses a generic branch operation; its spans
must remain consistent with the opcode-specific binding/dispatch procedures.

All ten original adventure macro definitions serialize `_thisPC +0x40 = 0`
and `_scriptInfo +0x48 = null`. These zeros must **not** simply be incremented.
Native binder `0x478820` walks the opcode list and, under its flag conditions,
writes the encountered macro row and owning script into those fields. Original
first-opcode flags are `0x11` (mask `0x80` clear), and all ten macro-definition
flags are 0 or 1 (mask `0x4` clear). Therefore the original serialized values
meet the recovered binding conditions; the new list and crossing deltas must
preserve the walk so later macro rows can be bound at their shifted positions.

Binding evidence is
`ev_d58a4911372b4f0f950adcbaf73894382bbfe8848a8d2bf75f77b54db85dace6`.
Caller `0x48a8d0`, the script vtable's `+0x20` entry, passes the opcode list
and script to that binder:
`ev_852bed13b0f7b503617aeb64b22a46e5008da01ad0ca81a72065c76daf1fcade`.
Macro execution `0x473f70` **reads** the bound fields; it does not initialize
them (`ev_ef9d49fc3a5ad4766262ca3d7a480e5c346730d40ff12de672ee23adc313fe58`).
The private portable bundle is
`research/rea-evidence-2026-10-14-chapter-authoring-v6.json` (292 records,
SHA-256 `6da57e594c9261dd2dab870e5c419698905ee7a9e6bfeefe9d8359e681df3bb3`).

### Why a bounded script policy is required

The generic append writer has been extended with bounded `OpCodeList` insertion,
EXID append and tagged authored RNEX/REXT slots. It preserves original opcode
bytes and does **not** infer branch changes or reference ownership. The separate
source-pinned story draft applies and verifies the three exact delta changes
plus the shared LHS reference-count change. Its tests independently resolve
19 includes, preserve original row/handle identities and check the static binder
walk. These structural checks still do not prove execution or ownership at
runtime; no original source is overwritten.

Even a structurally valid insertion still lacks proof of new chapter resource
closure, title/localization consistency, unique load-number behavior,
thumbnails/backdrops, gameplay scripts, complete level traversal, finale
continuation and compatible save migration. See
[SAVE_LAYOUT_DISCOVERY.md](SAVE_LAYOUT_DISCOVERY.md) for why increasing title
and load counts can move existing save fields. Do not apply this plan to the
original files or treat successful parsing as a playable-chapter test.

## Reproduce from your own PKG

First generate a registry using [CHAPTER_REGISTRY.md](CHAPTER_REGISTRY.md).
Extract the language member into a new path; do not overwrite an existing file:

```sh
tools/iga_extract extracted/CUSA00697/permanent/global.bld ENGLISH.pak research/permanent_global/ENGLISH.pak
sha256sum research/chapter-registry-v1.json research/permanent_global/ENGLISH.pak
```

The original English member is 157,668 bytes, SHA-256
`826712f658a803b1f03419ef571cd3b48c157e440d4eef43ac5f2613a6265e22`.
A fresh extraction from original archive member 8 was compared with the
existing copy on 2026-10-14 and matched. The registry hash below identifies
the original `chapter-registry-v1.json`; use the hash of your newly generated
registry if its serialization differs, not an unverified replacement hash.

```sh
node tools/chapter_entrypoints.mjs \
  --registry research/chapter-registry-v1.json \
  --registry-sha256 4a34c25843d93ac05a64711f0acf444baa02b1312416b432f88c06f769a5c82b \
  --global research/permanent_global/level.bld \
  --global-sha256 c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c \
  --initializer research/init_setup/level.bld \
  --initializer-sha256 2d1fabe7de81e6057b676909ecb58c56883bd825ba99b274f45ab38860f989e7 \
  --language research/permanent_global/ENGLISH.pak \
  --language-sha256 826712f658a803b1f03419ef571cd3b48c157e440d4eef43ac5f2613a6265e22 \
  --elf extracted/CUSA00697/eboot.elf \
  --output research/chapter-entrypoints-new.json
node --test tests/chapter_entrypoints.test.mjs
```

Output is exclusive, hash-verified and source-bound. Tests cover malformed
UTF-16, empty strings, surrogate pairs, source offsets, hash mismatches,
native-layout guards, exact owned-file mappings, the second final-battle load,
no-overwrite behavior and unchanged source hashes. Asset-dependent tests skip
in a source-only checkout; the pure decoder tests do not require the game.

## What still blocks safe extra-chapter insertion

1. Rebuild the coordinated global sets and StringInfo/language dictionaries
   without shifting existing external global handle IDs unintentionally.
2. Add startup story/expansion classification, thumbnails/backdrops, hub
   lighting/unlock relationships and completion/objective data consistently.
3. Recover save allocation and bounds. Rows 24–25 already show that difficulty
   tracking uses assigned offsets; increasing a list count is not evidence
   that the existing save has spare bits or that its consumers are unbounded.
4. Confirm the final loader, `.bld`/`.arc` dependencies and script entrypoints
   for a new archive name. Mesh composition alone supplies none of these.
5. Test a new selectable chapter in an isolated emulator profile, then test
   its entire route, interactions, enemies, completion and save/reload.

No original archive, inner file, language pack or game save is changed by this
tool. Local generated reports contain owned game data and are not part of the
source-only distribution.
