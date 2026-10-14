# Authored editor documents

`*.scene.json`, schema `skylanders-authored-scene-v1`, is a distinct editor
preview format. It cannot be repacked as IGZ. The shared `level_builder.mjs`
backend dispatches these documents to `authored_scene.mjs`, so GUI and MCP use
the same `inspect`, `objects`, `scene`, `materials` and `build` contracts.

Objects have unique nonnegative IDs, name/type, equal explicit root `position`
and `worldPosition`, and matching `editable`/`worldEditable` booleans. Meshes have
unique selection keys, world-baked positions, triangle indices, optional smooth
normals/UVs, and an optional actor ID plus matching `actorBasePosition`. Embedded
RGBA texture content is hashed and bounded. Scenes are at most 128 MiB, two
million vertices, twelve million indices and 32 MiB decoded textures.

An authored environment uses `authored:true`, `sunDirection` (incoming rays),
`sunColor`, `sunIntensity`, `ambientColor` and `skyColor`. The viewport converts
incoming sun direction to surface-to-light direction. `unlit:true` meshes bypass
the lighting rig; source normals are interpolated in OpenGL (triangle-averaged
in the CPU reference). This is not native game lighting or shadow reconstruction.

Build requires the expected source SHA-256 and a new `.scene.json` output.
Only root translations are supported: actor positions and corresponding baked
vertices move by the same delta; normals, UVs, static geometry, materials and
provenance remain unchanged. There is no game installation, collision/navmesh,
script compiler, chapter creation or runtime validation implied by a successful
JSON export. A no-op export is byte-identical.

Tests use synthetic data and verify guards, geometry translation, exclusive
output, preservation, invalid references and CPU/GPU material contracts.
