# Runtime save-parameter layout: native evidence

This note corroborates the **object layout used to read save-parameter definitions**, not a general save-file codec or permission to write arbitrary runtime memory. All addresses below are static ELF virtual addresses for the exact executable; they are not live-process addresses.

## Reproduction and provenance

The owned source is `extracted/CUSA00697/eboot.elf`, SHA-256 `423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3`. [The metadata extractor](../tools/elf_metadata.mjs) rejects other executable hashes before dereferencing fixed tables and applies PS4 dynamic RELA fixups to table pointers.

```sh
node tools/elf_metadata.mjs extracted/CUSA00697/eboot.elf
node --test tests/elf_metadata.test.mjs
```

The relevant current REA export is local/private `research/rea-evidence-2026-10-14-chapter-authoring-v8.json`, SHA-256 `6896745c5ec33e6ab6bd2cd81bc2da2e5f6e2764732cf55fadaf2ec39314b143` (308 records). Earlier ValueInfo metadata evidence is retained in `research/rea-evidence-2026-10-13.json`. Neither the executable nor these game-derived private artifacts belong in a redistributable editor package.

## Exact native fields

Offsets are hexadecimal and local to each object. Field names are shipped metadata strings, not descriptive guesses.

| Class / object size | Field | Offset | Corroboration |
| --- | --- | --- | --- |
| `ScriptStructure` / `0x40` | `_fieldList` | `0x30` | Field initializer `0xb9197c`, table pair `0xf55b00` / `0xc7f3aa` |
| `ScriptStructure` / `0x40` | `_varContentsType` | `0x38` | Same initializer; object-reference metadata constructor `0x589570` |
| `ScriptSet` / `0x38` | `_list` | `0x30` | Field initializer `0xb8d1d0`, table pair `0xf556b8` / `0xc7f254` |
| `ValueInfo` / `0x48` | `_resetValue` | `0x30` | Field initializer `0xb8dd08`, table pair `0xf557e0` / `0xc7f2be` |
| `ValueInfo` / `0x48` | `_type` | `0x38` | Same initializer; object-reference metadata constructor `0x589570` |
| `ValueInfo` / `0x48` | `_value` | `0x40` | Same initializer; integer metadata constructor `0x589680` |
| Object-reference list layout | element count | `0x0c` | Native `0x524af0` reads a 32-bit count |
| Object-reference list layout | backing array pointer | `0x20` | Native `0x524b00` reads a pointer; `0x524b04` indexes 8-byte entries |

`_members` and `_set` were provisional labels; they are **not** the native names of these two `+0x30` fields. `ScriptStructure._interface` and `_unTyped` have metadata offset zero and constructor `0xa55720`: these are virtual/interface properties, not data at the object's vtable address.

The Structure/Set registrations are `0xb918c8` / `0xb8d122`, retained together with both field initializers as `ev_db1e2bbbc43e4784933f727e2ce2518c570fd37abc5bf7b0b27613d5b579e9fc`. Their metadata-constructor tables are `0xf4f0c0` (four fields) and `0xf4e4e8` (one field). ValueInfo registration/field evidence is `ev_e02e9712e749ae3f518171b646ff3dcd232c9df99cba5e0f40a118caa821dea8`; its constructor table is `0xf4e710` (four fields).

The integer constructor identity was also checked directly in the executable: `0x589680` references registration `0xbef5e6`, which uses the literal `igIntMetaField` at `0xd09957`. This supports raw integer storage at `_value`; `_type` must still be considered when interpreting a script measurement. It does not prove save-file bit order, conversion units, or the meaning of every integer.

## Native traversal and exact list type

The read-only pointer relationship is:

```text
console-save-params ScriptStructure
  +0x30 _fieldList -> list (+0x0c count, +0x20 array)
    array[i] -> parameter ScriptStructure
      +0x30 _fieldList -> list (+0x0c count, +0x20 array)
        array[j] -> ValueInfo (+0x38 type, +0x40 integer value)
```

This is a relationship diagram, not a claim that every entry in the outer list is a parameter structure. The observed outer list also contains script sets; readers must identify object types and names before dereferencing the parameter path.

The Structure getter `0x487f00` directly corroborates the middle of this traversal: instructions `0x487f9f`, `0x487fa3`, and `0x487fa7` load structure `+0x30`, list `+0x20`, and the selected 8-byte element. Its builder `0x4882a0` can populate `_fieldList` lazily. At `0x488368`–`0x488389`, that builder resolves class global `0x10860b0` through registration `0xb86ca0`, allocates its object, and stores it at structure `+0x30`.

Crucially, `0xb86ca0` registers **ScriptVariantList**, size `0x30`, vtable `0xf516c0`. A matching count/data layout alone does **not** prove a live list is exactly `igObjectList` (size `0x28`, vtable `0xf798b0`). Check the live type/vtable separately. `ScriptSetList` is another distinct class (size `0x38`, vtable `0xf51a90`). The latter two registrations are retained as `ev_1af4b13090a5a0bdef740ac29b530f5dfdbe96f0ece28b337dda8ca3cac29d52`.

Native list callback `0x524ae0` supplies independent count/array/stride evidence: when called with its relevant event, it traverses nonnull entries, releases references, clears cells, and then clears the count. The list walker and callbacks are retained as `ev_faca8c4b6942c014242c19968236ba435acc9661f37f4f02660e24170a9182fc`. This confirms ownership-sensitive object-reference storage; it is **not** a routine an external reader should call. The callback alone does not establish capacity or allocation bounds from other header words.

For `ScriptSet`, post-load procedure `0x481bb0` installs getter `0xa5e790`. That getter loads the source object's `+0x30` pointer into the output and returns the `SetVariant` type at global `0x10865a8`. This is further direct-instruction corroboration of `_list` access, not a complete description of set mutation semantics.

The getter/builder and integer-constructor observations above were checked offline with `llvm-objdump`, not by taking over the active REA target. For example:

```sh
llvm-objdump -d --start-address=0x487f00 --stop-address=0x488125 extracted/CUSA00697/eboot.elf
llvm-objdump -d --start-address=0x4882a0 --stop-address=0x4883b0 extracted/CUSA00697/eboot.elf
llvm-objdump -d --start-address=0x524ae0 --stop-address=0x524b36 extracted/CUSA00697/eboot.elf
llvm-objdump -d --start-address=0xa5e790 --stop-address=0xa5e7a5 extracted/CUSA00697/eboot.elf
```

LLVM may warn that no section overlaps the requested range, but still disassembles the file-backed `PT_LOAD` segment of this PS4 ELF. Do not substitute a differently hashed executable.

## Serialized objects are not runtime containers

In local `research/permanent_global/level.bld` (SHA-256 `c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c`), source object **5871**, `ScriptStructure` named `console save params`, has encoded default-section address `729792` and file offset `1714412`. Its `_fieldList` cell at `+0x30` is zero, with no ROFS relocation. Its `_varContentsType` cell at `+0x38` instead references object **5872**, `OpDefineStructure` named `System - Save - Console Save Params`.

The null serialized field and the populated runtime field are therefore compatible with the native lazy builder. A live heap pointer cannot be converted into an IGZ file offset, and this source object's null `_fieldList` is not evidence of missing save definitions.

## Runtime observations and remaining limits

The separate main-agent capture `research/runtime-save-layout-baseline-01.json` records an owned-child, read-only traversal with repeated reads (not an atomic snapshot). It reports the six parameter member labels `limit to val`, `fields total`, `num bits`, `bit index`, `signed`, and `header param`, and 39 slot / 18 header parameters. These labels are script-level object names, **not six extra native C++ fields on ScriptStructure**. This note independently corroborates the native offsets, not the live capture's synchronization or every parameter's value.

The baseline's reported 7999 used slot bits and 2995 used header bits are observations to reconcile with the existing 1000-byte / 376-byte payloads. They are not a general payload-size formula: alignment, reserved capacity, schema versioning, encryption, checksums, and container framing require separate evidence. A chapter-count change must be validated against its newly captured schema before a save migration is attempted.

Still unproven here: general structure-initialization timing, all list capacity invariants, arbitrary script-value evaluation, save encoding/decoding, and a safe old-to-new save migration. No process memory, save file, or installed game file was changed by this corroboration work.
