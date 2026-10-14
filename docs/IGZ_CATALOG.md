# Source-bound level reference catalogs

`tools/igz_catalog.mjs` exports an extracted inner IGZ into gzip-compressed JSON
Lines. It is a **structural reference**, not a complete gameplay schema or an
importable replacement level. Original files are never edited.

```bash
node tools/igz_catalog.mjs --source YOUR_INNER_LEVEL.bld \
  --expect-sha256 YOUR_64_CHARACTER_SHA256 --output-dir NEW_CATALOG_DIRECTORY
```

Obtain the source hash with `sha256sum`. Output must be new, with an existing
parent. IGZ v8/platform 14 and an explicit matching hash are required. Inputs
are limited to 1 GiB; output has a 4 GiB uncompressed budget. Symlink source
files, malformed offsets, oversized allocation counts and existing destinations
are rejected. Failed exports can leave a partial new directory; only a completed
`catalog.json` describes a completed export. No existing directory is cleaned up.

## Contents and joins

`catalog.json` records source/parser/exporter hashes, counts, type sizes, pool
descriptors, fixup layouts, feature rules and each output's compressed and raw
hashes, sizes and row count. Six independently streamable files follow:

| File | Records |
| --- | --- |
| `objects.jsonl.gz` | Original object IDs, types, spans, byte hashes and references |
| `strings.jsonl.gz` | Source-bound TSTR entries |
| `relocations.jsonl.gz` | Every relocation, including unowned and unresolved slots |
| `tables.jsonl.gz` | Raw external/name/handle/root records where layout is known |
| `raw-fixups.jsonl.gz` | Verbatim fixup chunks, including headers and padding |
| `feature-candidates.jsonl.gz` | Search hints for enemies, chests, crates, gates, lighting, etc. |

IDs have the form `igz:SOURCE_SHA256:object:ORIGINAL_RVTB_INDEX`. An index is not
stable across rebuilt artifacts without its source hash. Interior pointers retain
their actual byte displacement; array data is not assigned to the nearest object.
Cross-file external linking is not performed by this exporter. `--raw-object-hex`
optionally includes up to 64 KiB of each object with an explicit completeness flag;
it does not expand entire mesh, image or opaque data pools.

Feature categories use type/string spelling only. Each result explicitly says
`semanticProof: false`. A chest-named script, a chest model, and a placed working
chest are different things. Do not treat these counts as gameplay-object counts.
Script flow, loot behavior, encounter rules, streaming and game lighting still
need semantic decoding and controlled runtime checks.

## Editor screenshots linked to code

The C++ editor can create real viewport screenshots without starting the game:

```bash
./editor/build/skylanders-level-editor YOUR_INNER_LEVEL.bld \
  --render-scene NEW_OVERVIEW.png
./editor/build/skylanders-level-editor YOUR_INNER_LEVEL.bld \
  --render-scene NEW_FEATURE.png --frame-object ORIGINAL_RVTB_INDEX
```

The optional `--geometry` argument supplies a companion inner geometry IGZ. The
JSON on stdout records source/geometry/PNG hashes, actor/mesh counts, camera
position, pivot, orientation and projection. A framed actor includes its original
ID, name, type, source offset and world position when available. Only a loaded,
world-positioned actor can be framed. An unknown ID fails before output creation.
The viewport uses bounded RGB texture previews and fixed editor shading, **not
the game's reconstructed lighting**. Nonvisual and unsupported objects remain
markers. Screenshots and catalogs contain private game-derived data; keep them
out of source releases.

## Batch extraction from your own game

```bash
node tools/chapter_catalog.mjs --game-root extracted/CUSA00697 \
  --output-dir research/NEW_CHAPTER_CATALOG --extractor tools/iga_extract \
  --editor editor/build/skylanders-level-editor --features-per-category 1
```

The output must be new and outside the extracted game tree. The tool selects
top-level `level/level_NNN_name.bld` candidates, records a plan, hashes each
archive, verifies its inventory, extracts only its inner `level.bld`, exports the
structure and optionally renders an overview plus bounded actor-name hints for
enemies, chests, crates and gates. `--only level_313_tutorial.bld` limits a run;
omit `--editor` for structure only. Per-category screenshot count is 0..3.

Each candidate has an `archive.json`, `result.json`, inner source, `structure/`,
and requested PNGs with JSON camera/source/hash sidecars. Final `index.json`
aggregates completed and failed entries. Failure never becomes a success count;
partial new outputs remain for inspection. Interruption can leave no final index.
Inputs and old outputs are not deleted or overwritten. The generated index does
not equate numerical filenames with chapter order. The separate final-battle
archive and expansion archives require registry interpretation.

Screenshots are marked `visuallyReviewed: false` until someone examines them.
A model can be unsupported or occluded even when its actor marker is centered.
Lighting needs a separate semantic decoder; fixed viewport shading is explicitly
recorded in each camera report. The batch does not claim to have captured every
scene or every feature in a chapter.

## Local validation, 2026-10-13

- Arena 303: 32,666 objects and 160,932 relocation records, six gzip files totaling
  about 14.3 MB, from the unchanged inner source `de0ecd5b…`.
- Soda Springs (`level_313_tutorial`): 77,350 objects and 402,613 relocation
  records, about 34.7 MB compressed, source `ffb0550f…`.
- `node --test tests/igz_catalog.test.mjs` verifies synthetic structure, stable
  IDs, interior/unowned/unresolved references, raw fixup preservation, gzip
  hashes/counts, input preservation and failure/no-overwrite behavior.

These are two artifact exports, not yet all chapters or complete feature coverage.
