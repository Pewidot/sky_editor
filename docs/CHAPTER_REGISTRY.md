# Chapter registry: verified handle mapping, unfinished chapter insertion

The read-only `tools/chapter_registry.mjs` links the startup adventure script to
global title/load objects and exports its opcode rows with source-bound IDs.
It does **not** insert a chapter, evaluate the whole script VM, allocate save
bits, or prove that a new map is playable.

## Native proof of cross-file references

In the exact supported CUSA00697 ELF, REA/Ghidra procedure `0x4018d0` registers
the bootstrap roots in namespace `global.bld` with numeric IDs `index + 1`.
It then registers global roots in that same namespace with IDs
`global index + bootstrap root count + 1`.

The original bootstrap inner `level.bld` has **25 roots**, so global ID 1945
maps to global root index 1919, the `Level_AdventureTitles` ScriptSet. The offset
26 is derived from this file and native code, not a guessed correction.
Namespace `global.bld` hashes to `0x2694be8e`; `0x51bed0` calls the native
string-hash routine `0x5816c0` with FNV offset basis `0x811c9dc5`.

The IGZ loader `0x568430` reads EXID pairs as numeric name/namespace IDs, resolves
handles, and applies the REXT slots. Unresolved namespaces remain explicitly
unresolved; the exporter never coerces them into local object indices.

`OpChangeMembership` field initializer `0xb8d88e` establishes LHS at `+0x38`,
operation at `+0x40`, and RHS at `+0x48`. Enum initializer `0x46c280` gives:

| Value | Native operation name |
| --- | --- |
| 0 | include |
| 1 | exclude |
| 2 | intersect_with |
| 3 | be_replaced_by |
| 4 | add |
| 5 | exclude_all |

Evidence identifiers are embedded in the exporter and its JSON. The local
evidence bundle is private, not a source-release input.

## Reproduce

After [setup from your own PKG](SETUP.md), extract these three inner members into
new private paths. Parent directories must already exist:

```sh
tools/iga_extract extracted/CUSA00697/permanent/bootstrap.bld level.bld research/permanent_bootstrap/level.bld
tools/iga_extract extracted/CUSA00697/permanent/global.bld level.bld research/permanent_global/level.bld
tools/iga_extract extracted/CUSA00697/character/init_setup.bld level.bld research/init_setup/level.bld
```

The known original inner SHA-256 values are:

| Source | SHA-256 |
| --- | --- |
| Bootstrap | `a56888faa11114d848daf16e74e1d41560a03ff15adbde55249355a23c1534e9` |
| Global | `c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c` |
| Initializer | `2d1fabe7de81e6057b676909ecb58c56883bd825ba99b274f45ab38860f989e7` |

```sh
node tools/chapter_registry.mjs \
  --bootstrap research/permanent_bootstrap/level.bld \
  --bootstrap-sha256 a56888faa11114d848daf16e74e1d41560a03ff15adbde55249355a23c1534e9 \
  --global research/permanent_global/level.bld \
  --global-sha256 c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c \
  --initializer research/init_setup/level.bld \
  --initializer-sha256 2d1fabe7de81e6057b676909ecb58c56883bd825ba99b274f45ab38860f989e7 \
  --elf extracted/CUSA00697/eboot.elf \
  --output research/chapter-registry-new.json
node --test tests/chapter_registry.test.mjs tests/elf_metadata.test.mjs
```

Output is exclusive and hash-verified. On the original inputs there are 3,047
bootstrap/global handle registrations, 580 initializer EXID records (521
resolved by this namespace rule), 624 opcode rows, and 18 `include` statements
whose LHS is `adv order`. The first three reference Tutorial, Tutorial2, and
PirateFortress. Runtime Chapter 3 gameplay was separately observed using the
converted save; that does not validate the whole exported registry.

The title/load sets, hub-lighting order, hub-unlock order, expansion/debug
classification and final story order are distinct data. The JSON keeps their
identities and operations separate. Numeric archive filenames and global title
array order must not be mistaken for displayed chapter numbers. The next
authoring steps still require localized strings, concrete load paths, dependent
assets, unlock/completion logic, safe save-bit allocation, and isolated emulator
tests of chapter insertion and the entire map.
