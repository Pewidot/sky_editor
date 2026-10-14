# Initializer draft: a 19th story entry

`tools/story_registration_draft.mjs` implements the bounded insertion described
in [CHAPTER_ENTRYPOINTS.md](CHAPTER_ENTRYPOINTS.md). It creates a **new initializer
inner-file draft**, paired with an existing global-registration draft. It does
not install files, rewrite archives, manipulate saves, create a level, or mark
the result deployable.

The exact owned-source test produces 625 adventure opcode rows instead of 624.
An independent registry reconstruction resolves 19 story include statements;
the new last include selects `AI_Workshop_Title` from the paired global draft.
This verifies serialized structure and identity, not runtime chapter selection
or playability.

## Inputs and identity checks

Three original inputs are pinned to the supported PS4 build:

| Input | SHA-256 |
| --- | --- |
| Initializer inner `level.bld` | `2d1fabe7de81e6057b676909ecb58c56883bd825ba99b274f45ab38860f989e7` |
| Global inner `level.bld` | `c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c` |
| Bootstrap inner `level.bld` | `a56888faa11114d848daf16e74e1d41560a03ff15adbde55249355a23c1534e9` |

The fourth input is the actual paired global draft, with its explicit SHA-256.
The writer checks its original 3,022 ROOT entries and 22 title/load entries
remain in place, that exactly one new title and one new load are appended to
their sets, and that both are new `StringInfo` objects in appended ROOT slots.
Existing global string identities, type metadata and external tables are
checked, as are original Default-pool bytes outside the three relocated list
headers. Bootstrap's original 25 entries establish the native handle base.

The new title's handle is **derived from its actual ROOT index**, not supplied
as a magic number. In the current paired draft the title occupies root index
3022, giving `3022 + 25 + 1 = 3048`. A test swaps the two appended ROOT entries
and independently verifies that the tool instead uses handle 3049. The old
ROOT prefix remains unchanged in either case.

The CLI obtains native field metadata from the exact supported ELF. A caller
cannot select a different opcode insertion point, template, branch delta,
source hash profile or deployment flag through the request.

## Exact edits in the new copy

The writer clones the original 80-byte `OpChangeMembership #799` and 48-byte
`ScriptGroupStack #800`, with its own 8-byte reference cell. The opcode shares
the existing LHS `SetStack #757`, but owns a separate RHS stack. All original
opcodes and their order are preserved, with the new opcode inserted before old
row 86. The opcode array is relocated; no adjacent original object is
overwritten.

Initializer EXID entry 580 is appended with the derived title handle and
namespace `0x2694BE8E`. The new reference cell is tagged REXT
`0x8000000000000244`; the cloned group's `StringInfo/metaobject` type remains
tagged RNEX `0x8000000000000009`. Existing EXID indices are not renumbered.
These retain tags are preserved because the native loader gives them ownership
behavior; they are not interchangeable with untagged numeric pointers.

After the generic append/rebuild, the narrow policy changes exactly four
scalar spans in the fresh buffer:

| Original object | Field | Before → after |
| --- | --- | --- |
| `#649`, `OpPreScript` | Unsigned branch delta `+0x32` | 623 → 624 |
| `#651`, `OpMacroSection` | Unsigned branch delta `+0x32` | 618 → 619 |
| `#652`, setup macro | Unsigned branch delta `+0x32` | 292 → 293 |
| `#757`, shared LHS stack | Reference count `+0x08` | 18 → 19 |

The LHS count is checked against exactly 18 original ordinary pointer slots,
each an `OpChangeMembership._LHS` field; the new graph has exactly 19. The new
opcode and RHS stack retain template counts of one and each has one ordinary
incoming slot. Tagged external type/title references are handled by the
loader's retain path, not by changing the paired global file's static counts.
These are source-bound static ownership constraints; object lifetime and
teardown remain untested at runtime.

### Native ownership corroboration

The count adjustment is also supported by native field declarations and
release callbacks, not just by counting similar-looking pointers:

- Pointer-field factory `0x589570` calls `0x54b5f0` in its native-constructor
  branch (`*DAT_108d548 == 0`). That constructor sets
  metadata byte `+0x43=1` and selects vtable `0xf7f330`
  (`ev_56512d45baf33ce010361ccd2711a9b6890fe6bbdf28aad75c257e887d7ccf12`,
  `ev_8bea158d0d6cb779251b55654c3ccf26aded557020b4978a7b2aaa32633e0852`).
- `OpChangeMembership` field initializer `0xb8d88e` configures its LHS/RHS
  pointer metadata with bytes `+0x40=1` and `+0x42=1`, leaving `+0x43` at its
  owning default. Its type-binding helper `0x54b700` writes only the type
  reference at `+0x48`, not that default flag
  (`ev_78d0c0d3ae32a759d284034d056afe149190e42814200d416ae5e482e7daee02`,
  `ev_3e0c598567b0d2949cd4ebb672500f31b79d41ff4e76bc2fd7fe6e0d2a790805`).
  The final field-layout helper `0x51a110` invokes the pointer-metadata
  vtable's `+0x210` callback. ELF relocation inspection resolves it to
  `0x517e60`; local disassembly shows only a word copy from the declaring
  class's `+0x58` to metadata `+0x0c`, followed by return. It does not clear
  byte `+0x43`. This last link is local artifact evidence, not a runtime trace.
- The pointer-field vtable's `+0x120` callback, `0x54af30`, checks metadata
  bytes `+0x41/+0x43`. When either is set it loads the referenced object using
  the field offset at metadata `+0x14`, then tail-calls `0x5186f0`. REA exact
  bytes, corroborated by local ELF disassembly:
  `ev_e5fac96d0aaa54b788e49c6e6f582aa204a3af84f4497a63328ac5fbd8b9bdac`.
  The nullable helper calls release `0x51c280` for a nonnull reference
  (`ev_eb76cacb52c339edfd89458aea1d394c333d9fabd7ee0bd5f50a0ebecb85ed99`).
- `OpCodeList` constructor `0xb85632` selects vtable `0xf58d60`; its `+0x38`
  slot is `0x524ae0`, the owning list callback. With release-contents enabled,
  it traverses the list, releases each nonnull entry and clears the slots
  (`ev_76fc2124c4a4c4944b884838ef22cc0a207b47db510328d7e7d2aadd00051774`,
  `ev_faca8c4b6942c014242c19968236ba435acc9661f37f4f02660e24170a9182fc`).

Generic destruction `0x51c360` invokes metadata callbacks in its reflective
branch. The active runtime mode and complete destruction route were not
observed. Accordingly the new manifest field
`ownershipFieldsStaticallyCorroborated=true` is deliberately narrower than
`ownershipVerifiedAtRuntime`, which remains **false**. Static metadata evidence
does not establish leak-free runtime construction, shutdown or repeated reloads.

The native binder walk is checked before and after insertion. Macro rows become
`5, 299, 310, 326, 349, 362, 393, 438, 495, 597`. Their serialized `_thisPC=0`
and `_scriptInfo=null` remain unchanged, and native binding flag conditions
remain satisfied. The binder can fill those runtime fields from the rebuilt
list; this checker does not execute it. Exact native evidence and original
rows are recorded in [CHAPTER_ENTRYPOINTS.md](CHAPTER_ENTRYPOINTS.md).

The original 19 lighting include statements are untouched. The extra story
entry can address the pre-existing final lighting entry through the recovered
consumer's index expression, but actual lighting and sequence execution still
require a runtime test.

## Reproduce with your own package

First extract your matching owned sources and create the global/dictionary
draft as described in [CHAPTER_REGISTRATION_DRAFT.md](CHAPTER_REGISTRATION_DRAFT.md).
Create a request JSON file with the following structure, supplying the actual
paired global hash:

```json
{
  "initializer": "research/init_setup/level.bld",
  "global": "research/permanent_global/level.bld",
  "bootstrap": "research/permanent_bootstrap/level.bld",
  "pairedGlobal": "builds/chapter-registration-draft-01/global.registration-draft.igz",
  "expectedHashes": {
    "initializer": "2d1fabe7de81e6057b676909ecb58c56883bd825ba99b274f45ab38860f989e7",
    "global": "c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c",
    "bootstrap": "a56888faa11114d848daf16e74e1d41560a03ff15adbde55249355a23c1534e9",
    "pairedGlobal": "b50e058af937b75db5611c3679946c8c3e71c883f82af37a2cf5e6413560c6f1"
  },
  "executable": "extracted/CUSA00697/eboot.elf",
  "outputDirectory": "builds/story-registration-draft-01"
}
```

```sh
node tools/story_registration_draft.mjs research/story-registration-request.json
node --test tests/story_registration_draft.test.mjs
SKYLANDERS_TEST_INIT_SETUP=research/init_setup/level.bld \
SKYLANDERS_TEST_PAIRED_GLOBAL=builds/chapter-registration-draft-01/global.registration-draft.igz \
node --test tests/story_registration_draft.test.mjs
```

The owned-file tests are opt-in. `SKYLANDERS_TEST_GLOBAL`,
`SKYLANDERS_TEST_BOOTSTRAP` and `SKYLANDERS_TEST_ELF` optionally override the
other source paths. Pure policy tests run without game files.

Outputs are `init_setup.story-registration-draft.igz` and `manifest.json` in a
new private directory. Existing output directories are refused. Sources are
opened read-only with symlink rejection, checked for concurrent changes, and
all outputs receive hash-verified readback. On failure, only files created by
that operation are removed; unrelated files in the new directory are preserved.
Never distribute these outputs: they contain data from your owned game.

## What this does not establish

The manifest intentionally keeps `deployable=false`, `runtimeValidated=false`,
`ownershipVerifiedAtRuntime=false` and `saveMigrationSupported=false`.
Corresponding language dictionaries must accompany the global draft; this
tool does not verify their contents. There is no authored chapter archive,
resource closure, collision route, encounter sequence or completion path here.
Finale-to-new-chapter unlocking, UI thumbnails, chapter numbering, lighting,
save allocation/migration and full gameplay remain separate validation tasks.
In particular, see [SAVE_LAYOUT_DISCOVERY.md](SAVE_LAYOUT_DISCOVERY.md) before
loading existing progress with increased title/load counts.
