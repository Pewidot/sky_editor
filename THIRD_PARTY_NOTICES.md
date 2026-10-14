# Third-party notices

The independently written editor and analysis tools are licensed under MIT.
That license does not cover game assets, model assets, SDKs, emulator code or
other third-party material.

## shadPS4 patches

`tools/patches/shadps4-input-ipc.patch` and
`tools/patches/shadps4-host-headers.patch` modify
[shadPS4](https://github.com/shadps4-emu/shadPS4), revision
`c7e065d1b415be16c23e260a21f1dd8bbfc4cb57`.
They retain the upstream **GPL-2.0-or-later** terms; the repository's MIT license
does not relicense these patches or the resulting emulator. Upstream copyright
belongs to the shadPS4 Emulator Project and its contributors. Local modifications
add opt-in controller pulses, game-frame capture and host header fixes (2026).
See `LICENSES/GPL-2.0-or-later.txt` and [build instructions](docs/INPUT_IPC.md).
No emulator binaries or vendored emulator source are distributed here.

## Dependencies obtained separately

- Qt: the editor uses Qt Core, Widgets and OpenGL; obtain Qt under its applicable
  upstream license. No Qt source or libraries are bundled.
- liblzma/XZ: used by the archive extractor; no library binaries are bundled.
- Node.js and CMake: required build/runtime tools, obtained separately.
- REA and Ghidra: used during format research, not required to run the editor.
- ImageMagick: optional raster decoder for the private-model importer.
- Prettier: optional development formatter, MIT, installed through npm.

The BeamNG v31 static-shape reader was written against the published
[format documentation](https://documentation.beamng.com/modding/file_formats/cdae/).
No BeamNG executable, vehicle archive or runtime scripts are bundled.

Skylanders, Trap Team and associated names belong to their respective owners.
This project is unofficial and is not affiliated with Activision, Toys for Bob,
Sony, BeamNG or Lamborghini. The source license grants no rights to their assets.
