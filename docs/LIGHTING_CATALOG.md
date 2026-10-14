# Static chapter lighting catalog

`tools/lighting_catalog.mjs` exports source-bound JSON for `tfbLightInfo`,
`DirectionalLightInfo`, and `tfbMoodBoxInfo`. It does not change the game or the
editor renderer. This is a partial, evidence-backed field schema, not a faithful
reconstruction of active game lighting.

## Reproduce from your own game

Use an extracted **inner** `level.bld`, not its enclosing IGA archive. Set up the
tools and your own PKG as described in [SETUP.md](SETUP.md). The executable must
be the supported CUSA00697 ELF with SHA-256
`423a45131ebed98d1ed74edfe94d4946ee6a71f8bcc21631f2aba745ee95f1c3`.

```sh
sha256sum research/chapter_313_tutorial/level.bld
node tools/lighting_catalog.mjs \
  --source research/chapter_313_tutorial/level.bld \
  --elf extracted/CUSA00697/eboot.elf \
  --expect-sha256 YOUR_INNER_FILE_SHA256 \
  --output research/chapter_313_tutorial/lighting-new.json
node --test tests/lighting_catalog.test.mjs tests/elf_metadata.test.mjs
```

Output must not exist. The tool rejects source symlinks, checks source identity
and size, writes exclusively, and hashes the read-back output. Game files and
exported catalogs remain private; only the source tool belongs in a release.
Object IDs match the [structural catalog](IGZ_CATALOG.md):
`igz:SOURCE_SHA256:object:RVTB_INDEX`.

To enrich an existing completed chapter export without re-extracting or changing
its index, use a new sibling directory:

```sh
node tools/lighting_catalog.mjs \
  --chapter-index research/chapter-catalog-v2/index.json \
  --elf extracted/CUSA00697/eboot.elf \
  --output-dir research/chapter-lighting-new
```

Each source is checked against the structural index's inner-file hash and runs
in an isolated child to bound memory. A new lighting index links each result;
the original chapter index is not modified. The local `chapter-lighting-v1`
export completed all 23 archives on 2026-10-13.

## Evidence and interpretation

The exact native ELF supplies field names, offsets, and meta-field constructors
through its dynamic relocation tables. `tools/elf_metadata.mjs` pins these
addresses; REA evidence identifiers are included in each class/field record.

| Class | Registration / field initializer | Verified local information |
| --- | --- | --- |
| `tfbLightInfo` | `0xbb6f0e` / `0xbb7096` | Type field, colors, intensity, attenuation, visibility, cookie/animation references |
| `DirectionalLightInfo` | `0xbb86e0` / `0xbb879a` | Initial Euler transform, diffuse/ambient/specular colors and multipliers |
| `tfbMoodBoxInfo` | `0xbb8d72` / `0xbb8e4a` | Initial transform, box/environment/cloud references, enabled flag and influence |

Storage types confirmed through native constructor registrations are float32,
four unsigned bytes, Boolean, and the six-float Euler transform. Other fields
retain bounded raw spans and pointer/string fixups without guessed meanings.
Colors intentionally do not assert channel order or color space. Nonfinite
floats and Boolean bytes other than 0/1 are preserved raw and decoded as null.
Fields with metadata offset zero are virtual/global metadata, not bytes to read
from the serialized vtable slot.

The mood-box offset table is `0xc80bb0`: bounded native disassembly at
`0xbb915e` confirms this despite an incorrect wide-string rendering in the
decompiler. Native field storage evidence is retained in local REA bundles;
these bundles contain game-derived material and are not release inputs.

## Observed local result (2026-10-13)

Soda Springs inner SHA-256
`ffb0550f8f11d53e0db9aaa32bc977c887a5f5c0b8f1a139555859a4034b6cd3`
contains **77 light-info, 4 directional-light-info, and 20 mood-box-info records**.
These are serialized records, not a claim that all are active simultaneously.
`research/chapter_313_tutorial/lighting.json` is 1,325,899 bytes, SHA-256
`00a985ed451794de7a735f81a5396ae5efbc87befff92570fd61c784e087c166`.

Still unknown: enum meanings, full inherited transforms, active script-driven
mood selection/blending, environment-map contents, shadowing, fog, postprocessing,
and final shader math. The editor offers an adjustable manual preview light;
it does not apply this catalog as native game lighting. An AI
consumer must not treat this catalog as a complete level-authoring schema.
