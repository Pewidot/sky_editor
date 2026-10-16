# Workshop chapter image

The chapter card uses the actual Gallardo model rendered by the editor, not a
generated illustration. The change is restricted to the workshop card's own
BC1 image allocation in `misc/ui_levelselect.bld`. Original chapter art and
the original extracted game are preserved.

## Rebuild from privately owned assets

Render the model, with overlays hidden:

```bash
QT_QPA_PLATFORM=xcb editor/build/skylanders-level-editor --renderer gpu \
  --render-scene builds/gallardo-chapter-art-02.png \
  --render-report builds/gallardo-chapter-art-02.json \
  --no-overlays --frame-object 1 \
  --camera-json '{"pivot":[0,0.6,0],"distance":4.4,"pitchRadians":-0.22,"yawRadians":0.65}' \
  builds/gallardo-grid-demo-02.scene.json
```

Unpack your registered chapter UI archive with the existing `iga_extract`
workflow. Then provide its inner payload, outer archive, image, exact inner
SHA-256 and a new output directory:

```bash
node tools/chapter_thumbnail.mjs INNER_UI.bld UI_ARCHIVE.bld IMAGE.png \
  EXPECTED_INNER_SHA256 NEW_OUTPUT_DIRECTORY
```

The tool checks the specific registered workshop layout; it is not a general
arbitrary-chapter thumbnail editor. It requires ImageMagick (`magick`). It
creates a new inner payload, archive and manifest, and does not install them.
Independently unpack the new archive and compare its inner hash before using
it in a disposable game copy. Update that copy's preview-profile UI hash pin.
Never write through a symlink to an original game archive.

## Verified structure and private installation

`Level Select Button 023` is actor292272. Its model292768 references
`Level_024.mdl`; material293232 and sampler293608 lead to image293712,
`ColorMap#level_000#11`. The image is1024×1024, six BC1 mips, TMHN116.
Runtime probe01 exposed sharing at the model level: Sunbreak's button024 also
references model292768. Version02 clones the complete33-object model graph
for Gallardo, redirects only button023, updates owning reference counts, and
adds a private image handle. Original TMHN entries and pixels remain intact.
The card's native UVs invert the vertical axis, so the encoder flips input rows;
the source PNG remains upright. Probe01 was rejected for these two issues.

The 2026-10-16 private build is
`builds/gallardo-chapter-thumbnail-02`. Original inner hash:
`18a0f846bdb0cdfee2e9ebd6da3044418ed9640fd5fb3a2a1bda6333d735d041`.
New inner, independently re-extracted:
`cf40f96dadbeb0472b000e816112bead810d6c29033bc9a31a6cf6ac5eef1965`.
New outer:
`a54a0dc47888cd09ad339e74ee30c6c2e3e893e6faa1b519914d367c491ec3c6`.

Only the prepared `fastboot-01/CUSA00697` base was updated. Its previous UI
symlink is preserved beside it as
`ui_levelselect.bld.before-fastboot-gallardo-thumbnail-01`; the new UI is a
regular independent file. The source target of the old symlink is unchanged.
The rejected first image is also backed up as
`ui_levelselect.bld.before-gallardo-thumbnail-02`.
Restoring requires restoring both this entry and its previous preview-profile
hash pin. Existing preview copies are unaffected. Build manifests deliberately
do not claim runtime validation merely because repacking succeeded.

Runtime02 displayed chapter19 with the upright Gallardo, while adjacent
Sunbreak retained its original generic art. Private evidence:
`preview-MXLOqA/session/user/screenshots/CUSA00697_20261016_113848_033_game_000000.png`.
This is a real native chapter-menu capture, not an editor mockup.

Private structural test (no assets are bundled):
`SKY_UI_INNER=/path/to/original-registered-ui.bld node --test tests/chapter_thumbnail.test.mjs`.
