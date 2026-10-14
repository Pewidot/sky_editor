# Save definitions and chapter-dependent allocation

`tools/save_layout_catalog.mjs` is a read-only, source-bound declaration
exporter. It recovers **88 call sites with six arguments each** from the 1,209
opcode rows of `Init_Setup_SaveGame.ai` (`tfbScriptInfo #10760`). It also records
the allocator's operands, assignments, conditional predicates and serialized
global inputs. This is not 88 proven executed fields: helper calls, loops,
branches and dynamic arguments remain explicit.

The important result for additional chapters is that save field positions are
computed from preceding field widths and counts. Increasing a chapter-related
count can therefore move later fields. Appending a title/load is **not** enough
to establish save compatibility, even if its chapter ID remains unchanged.
No save or game file was changed during this investigation.

## Sources and native basis

All object indices and zero-based opcode rows below refer to the exact sources:

| Source | SHA-256 |
| --- | --- |
| `research/init_setup/level.bld` | `2d1fabe7de81e6057b676909ecb58c56883bd825ba99b274f45ab38860f989e7` |
| `research/permanent_global/level.bld` | `c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c` |
| `extracted/CUSA00697/eboot.elf` | `423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3` |

The existing `research/init-save-script-graph-2026-10-14-v1.json` supplied the
row inventory. The catalog independently reads the original inner files and
checks every source against its caller-provided hash and the chapter registry.
It does not treat graph names as executable semantics. Relevant native evidence:

The portable native evidence is retained in private bundle
`research/rea-evidence-2026-10-14-chapter-authoring-v5.json` (289 records,
SHA-256 `d3bd3cd428b603e095da676dc052cbf211907c30913c229143a74976d6831b4f`).

- `OpMacroParameter` inherits `OpParameter`; the parent has `_combineOp +0x54`,
  `_RHS +0x58`, `_indexRHS +0x60`. Constructor `0xb838e8`:
  `ev_0bb7c11a6ad0bacab3043ffac6c86beadbb51125e5918642c5fecd83d95eaa51`;
  field initializer `0xb86a84`:
  `ev_ac4bf015e931e156fe32d6c17730e8fe381e68c46f0956c77d426fafde1ade7a`.
  Thus argument pointers at `+0x58` are identified by native metadata, not
  their position near a plausible string.
- `RHSValueStack` has `_properties +0x30`, `_type +0x38`, `_value +0x40`:
  `ev_34ac99bc2e2c6a5f5405d9a54aa90f5536eba1ad9eedb8a5d98abc26be8caacc`.
  Procedure `0x470e70` selects literal getter `0x48e630` for `NO_OP`, an empty
  first-operand stack and `kRHSfuncNone`:
  `ev_2834b716a4acd86c1241f5da4d2f5484442ec8896fe9791f14cb609373dc3b1c`.
  The getter copies the 32-bit word at stack `+0x40` and returns its type at
  `+0x38`:
  `ev_d574b616d9d13a985395c1eb1db06faa21ddb4858a74930528aa23dabe905521`.
  The catalog decodes only empty, zero-properties `IntMeasurement/metaobject`
  literals as signed 32-bit integers. `NO_OP` wrappers are simplified only when
  their native `_conditioner +0x30` and serialized `_resultFunc +0x28` slots are
  null; unknown or present values in those slots remain unresolved. Other typed
  payloads remain raw; for
  example, float bits `1069547520` are not misreported as an integer count.
- `ValueRHSVariant` operands `+0x10/+0x20` and operator `+0x18`:
  `ev_9e95a8f9b79e0a0c554db8bb39fc803291ad4e52aff869e527f1bd2e8098c2cf`.
  `ArithOp` identifies `NO_OP=-1`, addition `0`, subtraction `1`,
  multiplication `2`, division `3`:
  `ev_30d11f5eb05ad1511822c63bb3e5c90dee78300a4afe7f1afe2f14e480a4276d`.
- `SetVariant::count` is a native registered property, including getter
  `0x4814a0` and setter `0x4814c0`:
  `ev_11fdeffa6dbac8c21e58bab96a17dcae08a8da71ca801acc343674010484d77a`.
  The identity chain and getter are documented in
  [CHAPTER_ENTRYPOINTS.md](CHAPTER_ENTRYPOINTS.md).
- `OpSetValue` LHS/RHS metadata:
  `ev_3b2a9d2f97fa13ecacf1a6f8fd941c40cb0aff8f6b02f62d7e6234711b65e944`.
  `OpChangeMembership` fields:
  `ev_24baeee44bb6e94d661b3b8a43ac75197e00024dad09c24f7df1ff04e7ccb227`;
  `Combiner.include=0`:
  `ev_2215e8f691612ac423d1cfa802242d645fe28692854c8662869bfc061a5f1703`.
  Comparisons use native `RelOp`, not branch-name guesses:
  `ev_e1147d40e866f6d375a541e2721133de67ad27cc11122dcba2731f4ecd393d25`.

## The definition and allocation operations

`Save Init - Define Save Param` is local macro `#2578`, row 977. Its six
parameters are `is header param`, `save param`, `signed`, `fields total`,
`field bit size`, and `limit to val`. At rows 986–991 the header flag is tested
against zero, and the parameter is included in either `all save params`
(`#10818`) or `all header save params` (`#10933`). Rows 992–995 copy the four
numeric arguments into parameter members `signed`, `fields total`, `num bits`
and `limit to val` (`#8193/#8198/#8203/#8208`).

`Save Init - Finalize Save Params and Construct SaveGame` is macro `#8088`,
row 1173. Its body contains the following source-bound operations:

| Row / opcode object | Operation established by operands |
| --- | --- |
| 1178 / `#11598` | Loop over `save params.count` |
| 1179 / `#11601` | Select `param` using that loop expression |
| 1180 / `#11606` | `Scratch G1 = param.num bits * param.fields total` |
| 1181 / `#11610` | `param.bit index = bit ct` |
| 1182 / `#11615` | `bit ct = bit ct + Scratch G1` |
| 1184 / `#11618` | `bit ct = bit ct / 32` |
| 1185 / `#11620` | `fill savegame set.count = bit ct + 1` |

Thus each selected field advances a running cursor by `width * count`; its
assigned index is the previous cursor. The final destination sizing uses the
division/addition expression shown, not a recovered fixed spare-capacity table.
The catalog does not execute the VM, prove the initial cursor value, choose a
platform branch, or assert integer division rounding and serialized save length.

The exported `projectSequentialFields()` helper computes the elementary prefix
sum for an **explicit caller-selected sequence** starting at zero. It is useful
for comparing hypotheses, not for deriving a complete runtime layout. The CLI
deliberately leaves every declaration's `finalBitIndex` null.

## Chapter-dependent fields

Row 35 assigns local `level count #10785` from `Level_Loads.count` through RHS
`#683`. Row 502 assigns `Scratch G1` from
`DifficultyTracking_SegmentsPerLevel * level count` through RHS `#11068`.
The following are concrete declaration arguments, not meanings inferred from
the field labels:

| Call row | Field | Count expression | Bits per field |
| --- | --- | --- | --- |
| 274 | `collection - legendary treasure` | `Level_AdventureTitles.count` | 1 |
| 284 | `collection - legendary treasure equipped` | Previous treasure parameter's `fields total` | 1 |
| 294 | `collection - story tablets` | `level count` | 1 |
| 354 | `collection - fairy tokens` | `level count` | 1 |
| 503 | `difficulty tracking` | `Scratch G1`, assigned at row 502 | 8 |
| 513 | `level flags` | `level count` | 20 |
| 523 | `level flags - objectives` | `level count` | 4 |
| 533 | `level flags - areas` | `level count` | 30 |

Let `T` be the title count, `L` the load count and `S` the segments-per-level
value. If these declarations execute with the shown dataflow, their combined
span is `2*T + (56 + 8*S)*L` bits. The original serialized global inputs are
`T=22`, `L=22`, and `DifficultyTracking_SegmentsPerLevel._value=3`.

**Conditional sensitivity:** holding the other inputs and execution fixed,
adding one title and one load increases these eight spans by **82 bits** when
`S=3`; increasing only the load count increases them by 80 bits. This is a
subtotal for these declarations, not a measured total save-file growth, a safe
capacity limit or a successful migration. Other dynamically generated fields,
runtime mutations, helper invocation order and final word sizing still matter.

In particular, every later field in an executed sequential list is sensitive
to changes in preceding spans. Old bytes cannot simply be read with a new
layout without establishing a migration/versioning strategy. This concern
exists even when a new chapter is appended rather than inserted in the middle.

## Header prefix: independent corroboration, not an unlock patch

Row 33 obtains `save slots` from `SaveNames_Slots.count`; the original global
set has four members. The early header declarations are:

| Call row | Field | Count × bits | Conditional zero-based start bit |
| --- | --- | --- | --- |
| 36 | Version | 1 × 8 | 0 |
| 54 | Expansion unlocks | 4 × 1 | 8 |
| 64 | Sound volumes | 4 × 8 | 12 |
| 106 | Options flags | 8 × 1 | 44 |
| 116 | Portal master ID | 2 × 32 | 52 |
| 134 | Slot level IDs | `save slots` × 8 | 116 |
| 144 | Slot minions collected | 1 × 9 | 148 |
| 154 | Slot completion percent | `save slots` × 8 | 157 |

These positions assume a zero starting cursor, four slots and this executed
order. The separately recorded controlled emulator experiment in
[SAVE_CHECKPOINTS.md](SAVE_CHECKPOINTS.md) changed only the first 8-bit window
at bit 157 and observed the displayed story completion changing to 1%.
The static prefix calculation independently matches that observation. It does
not establish that changing the predicted slot-level-ID window skips the
tutorial, nor that the whole header is decoded. No new runtime experiment was
performed for this catalog.

There are additional header declarations and a toy-collection helper. A mobile
header declaration at row 230 is guarded by comparisons at rows 227–228; the
large later mobile block also has guards. Their numeric platform tests are
preserved, not silently selected or assigned a platform name. Reused macro
object `#2576` occurs at several different call rows, so consumers must retain
row identity rather than deduplicate by object index.

## Reproduce from an owned extraction

Create the inner sources and registry as described in
[CHAPTER_REGISTRY.md](CHAPTER_REGISTRY.md). This command creates a new report;
it refuses an existing output, source symlinks, hash mismatches or unsupported
native layouts. Use the hash of your independently generated registry if its
serialization differs from the local historical report.

```sh
node tools/save_layout_catalog.mjs \
  --initializer research/init_setup/level.bld \
  --initializer-sha256 2d1fabe7de81e6057b676909ecb58c56883bd825ba99b274f45ab38860f989e7 \
  --global research/permanent_global/level.bld \
  --global-sha256 c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c \
  --registry research/chapter-registry-v1.json \
  --registry-sha256 4a34c25843d93ac05a64711f0acf444baa02b1312416b432f88c06f769a5c82b \
  --elf extracted/CUSA00697/eboot.elf \
  --output research/save-layout-catalog-new.json
node --test tests/save_layout_catalog.test.mjs
```

The JSON retains source hashes, exact object identities/file offsets, argument
slots, native evidence, symbolic expression trees and unresolved external
references. It explicitly sets `runtimeValidated`, `offsetsFullyResolved` and
`saveMigrationSupported` to false. Reports contain owned game data and must not
be included in the source-only release. Tests cover projection bounds, typed
literals, exact owned-source counts/operands, allocation formulas, inherited
metadata guards, source hashes, no-overwrite behavior and unchanged sources.
Owned-source integration tests skip in a source-only checkout.

## Still required before adding a save-compatible chapter

1. Evaluate or observe the actual ordered header/slot parameter lists, including
   helper-generated counters, toy variants and selected platform branches.
2. Recover save reading/writing and version conversion, signed/sentinel rules,
   range checks, checksums and storage-size limits together. The known checksum
   helper alone cannot establish semantic compatibility.
3. Verify chapter ID readers and per-level bit/area/objective indexing against
   the enlarged registry; preserve or explicitly migrate old progress.
4. Run isolated new-save and existing-save migration tests, including
   completion, restart and reload. None of those tests is replaced by the
   static 82-bit sensitivity calculation.
