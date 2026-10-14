# Trap Team PS4 IGZ structural reader

`igz.mjs` reads little-endian IGZ version 8/platform 14. It does not write game data or infer field names. `igz_inspect.mjs` uses it for bounded CLI inspection:

```sh
node tools/igz_inspect.mjs research/arena_challenge_303_000/level.bld --objects '^tfbActorInfo$' --limit 10
node tools/igz_inspect.mjs extracted/CUSA00697/research/level_300_birdcage/level.bld --strings 'HatBox' --json
```

`--types` filters the type-count summary; `--objects` filters object type names and includes direct RSTT string references and ROFS pointers in each object's MTSZ span. `--strings` shows TSTR indices and file offsets. These string references are confirmed relocation sites, not guessed printable text. Object offsets and string offsets in output are absolute file offsets; `encoded` fields retain serialized pool-relative values.

```js
import { parseIgz } from './igz.mjs';
const z = parseIgz('path/to/level.bld'); // also accepts a Buffer
const actor = z.objects.find(o => o.type === 'tfbActorInfo');
console.log(z.summarizeObject(actor));
const nameRef = z.stringReferencesByOffset.get(actor.offset + 0x10);
const pointerRef = z.pointerReferencesByOffset.get(actor.offset + 0x120);
const target = pointerRef && z.objectsByOffset.get(pointerRef.targetOffset);
```

The result exposes `buffer`, bounded `u32`/`u64`, `types`, `typeSizes`, `typeEntries`, `strings`, `stringEntries`, `descriptors`, `fixups`, `fixupMap`, `offsetTables`, `objects`, `objectsByOffset`, `stringReferences`, `stringReferencesByOffset`, `pointerReferences`, `pointerReferencesByOffset`, `specialRelocations`, `specialRelocationsByOffset`, `tmhnReferences`, and `unresolvedFixupEntries`. `resolvePointer(encoded, length)` resolves a serialized address with pool bounds checks. `objectContaining(fileOffset)` only matches an object's actual MTSZ span, not arbitrary trailing list data. `summarizeObject(objectOrIndex)` returns direct string/pointer/TMHN references and runtime initialization slots in that span.

Confirmed format details:

- Descriptors start at `0x14`: identifier/name offset, file offset, size, alignment. Pool names begin at `0x224`.
- TSTR and TMET strings include empty strings and are aligned to two bytes. Skipping all zero bytes corrupts indices: Birdcage has an empty TSTR entry at index 4528/file offset `0x25274`.
- Relocation tables use low nibble first, three data bits plus continuation bit, cumulative `delta * 4 + 4` for version 8. Objects contain a uint32 TMET index. MTSZ supplies exact object spans.
- ROOT is an exception: these version 8 payloads contain raw uint32 encoded offsets, not nibble deltas. Every tested ROOT value is 8 and resolves to the RVTB `igObjectList`.
- ROFS slot locations use `encoded >> 27` for the pool and `encoded & 0x03ffffff` for the pool-relative offset. Bit `0x04000000` selects a runtime initializer. Ordinary ROFS reads the slot's low uint32 as a target encoded with a 27-bit relative offset.
- Flagged ROFS slots are cleared by the runtime, then passed to `FUN_0051e460(slot)` and `FUN_005088a0(slot, 1)`. Their existing disk words must **not** be exposed as live pointers. `specialRelocations` records their raw encoding, resolved slot, object/field offset, `runtimeAction: 'zero-and-initialize'`, calls, evidence ID, and the remaining callee-semantic limitation. The reader never performs those writes.
- RMHN uses the same v8 nibble delta codec and 27-bit location encoding; each resolved slot contains a uint32 index into TMHN. `tmhnReferences` validates these indices. TMHN entry payloads remain opaque.
- Some shipped descriptors declare size `0xffffffff`, alignment zero, and occupy a four-byte zero placeholder. These are recorded as sentinel pools with no addressable data.

Validation on original extracted files: Birdcage 101,527 objects/204 types/13,673 strings; UI level select 4,689/122/1,009; level switch 3,743/58/1,016; card texture 4/4/0. Birdcage has 118 special ROFS slots and 4,152 RMHN references; arena challenge 303 has 172 and 612 respectively, with no unresolved fixup locations in either file. Object types, MTSZ spans, resolved pointers, RSTT string indices, and RMHN table indices are bounds-checked. `node --test tests/igz.test.mjs` exercises synthetic graphs, aligned empty strings, flags, RMHN bounds, sentinel pools, and malformed inputs without game assets.

Evidence: ROFS and RMHN behavior above comes from REA/Ghidra decompilation of CUSA00697 `FUN_00568430`, evidence `ev_ec2b575e84cb4f06b1aba8c75f1ce0d82f7db4a2852eab4ef8b43300b51f0e8b` (eboot SHA-256 `423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3`). The earlier suspected out-of-bounds ROFS locations are explained by this flag; changing pool addressing to 26 bits is incorrect and fails thousands of RVTB locations.

Limitations: the two special-initializer callees and TMHN entry payload semantics have not been decoded. General object field schemas and rebuild semantics remain outside this reader. Truly invalid ROFS locations are preserved in `unresolvedFixupEntries`; their `offsetTables.get('ROFS').offsets` slots contain zero and are excluded from references. Never use those zero slots as file offsets. ROOT identifies an object-list root, not necessarily a gameplay level object.

Format references: [igArchiveExtractor](https://github.com/NefariousTechSupport/igArchiveExtractor) for the version 8 offset codec; [Crash NST Level Editor](https://github.com/kishimisu/Crash-NST-Level-Editor) for chunk fields and typed fixup semantics. Later-game field schemas were not imported as Trap Team schemas.
