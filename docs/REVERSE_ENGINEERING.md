# Reverse-engineering approach

Sky Editor is an independent tool built by examining locally supplied copies of
the PS4 game. It is not based on an official level SDK or leaked game source.
REA and Ghidra were used to trace native consumers; small parsers and controlled
runtime experiments were then used to test the inferred formats.

## From bytes to editable data

The first distinction is between an IGA archive and its inner IGZ object payload.
They may share a `.bld` extension, but require different readers. The archive tools
identify members and compression blocks. The IGZ reader decodes object tables,
type names, strings and relocation records before interpreting individual fields.

Field names alone are not enough. Native type registration and metadata establish
storage offsets; loaders show how fixups and external handles are consumed;
renderer and VM code help explain geometry, materials and opcode behavior.
The supported class layouts are bound to an exact executable profile. A different
build requires verification, not simply disabling a hash check.

The editor implements the recovered subset in C++ and JavaScript. It does not
bundle the executable, decompiled functions or extracted game assets. Unknown
fields, animation paths and unresolved resource dependencies remain visible as
limitations. A textured triangle is not evidence of working collision or scripts.

## Evidence and validation

Each investigation starts with input hashes. Notes distinguish a serialized fact,
a native-code observation, a hypothesis and a runtime result. Evidence identifiers
refer to local REA bundles; private paths identify the original experiments, not
files that a public checkout is expected to contain.

For writes, the usual checks are:

1. Establish the field or relocation's consumer in the exact native build.
2. Preserve unknown bytes and existing object identities where required.
3. Write to a new path, recording input/output hashes and changes.
4. Reparse and check structural invariants; independently extract rebuilt archives.
5. Test a disposable game-tree copy with an isolated emulator profile.

Runtime inspection is restricted to test processes started for this work. Save
layout migration uses measured allocation tables rather than guessed offsets.
Structural acceptance, reaching a menu, loading a hub and completing a new chapter
are separate milestones.

## Where to look

- [Findings](FINDINGS.md): native addresses, observations and open questions.
- [Level format](LEVEL_FORMAT.md) and [IGZ reader](../tools/IGZ_READER.md): file layers and supported structures.
- [Geometry](../tools/IGZ_GEOMETRY.md) and [materials](MATERIAL_DIAGNOSTICS.md): rendering evidence and limits.
- [Script graphs](SCRIPT_GRAPH.md): opcode order and the verified subset of control flow.
- [Chapter entrypoints](CHAPTER_ENTRYPOINTS.md): title/load pairing and registration dependencies.
- [Save migration](SAVE_LAYOUT_MIGRATION.md): measured fields, preservation and checksums.
- [Project status](WORK_STATUS.md): what has actually been tested end-to-end.

To repeat the workflow, begin with [Setup](SETUP.md) and your own game files.
No shared PKG, save, figure dump or evidence bundle is needed for the synthetic tests.
