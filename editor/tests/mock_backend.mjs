// Synthetic fixture; contains no game data.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
if (request.path === 'transport-budget') {
  console.log(JSON.stringify({ payload: 'x'.repeat(34 * 1024 * 1024) }));
} else if (request.path === 'failure') {
  console.log(JSON.stringify({ error: { message: 'Synthetic backend failure' } }));
  process.exitCode = 1;
} else if (request.operation === 'inspect') {
  console.error('fixture diagnostic');
  console.log(
    JSON.stringify({
      path: request.path,
      sha256: '0'.repeat(64),
      version: 8,
      platform: 8,
      objectCount: 2,
      types: [{ name: 'SyntheticEntity', count: 2 }],
      editableObjectCount: 1,
    }),
  );
} else if (request.operation === 'objects') {
  console.log(
    JSON.stringify({
      total: 1,
      objects: [
        {
          id: 1,
          type: 'SyntheticEntity',
          offset: 256,
          size: 96,
          name: 'fixture',
          position: [1, 1.7504663467407227, -32.273681640625],
          editable: true,
        },
      ],
      nextOffset: null,
      received: request,
    }),
  );
} else if (request.operation === 'scene') {
  const objects = [
    {
      id: 1,
      type: 'SyntheticEntity',
      name: 'fixture',
      position: [1, 1.7504663467407227, -32.273681640625],
      worldPosition: [1, 1.7504663467407227, -32.273681640625],
      editable: true,
      worldEditable: true,
    },
    {
      id: 900,
      type: 'SyntheticEntity',
      name: 'off-page actor',
      position: [16, 2, -20],
      worldPosition: [16, 2, -20],
      editable: true,
      worldEditable: true,
    },
    {
      id: 901,
      type: 'SyntheticEntity',
      name: 'unresolved parent',
      position: [0, 0, 0],
      editable: true,
      worldEditable: false,
    },
  ];
  const meshes = [
    {
      id: 0,
      name: 'Synthetic floor',
      positions: [-25, -2, -50, 25, -2, -50, 25, -2, 0, -25, -2, 0],
      indices: [0, 1, 2, 0, 2, 3],
    },
    {
      id: 0,
      name: 'Synthetic actor model',
      actorId: 900,
      actorBasePosition: [16, 2, -20],
      positions: [14, 2, -20, 18, 2, -20, 16, 10, -20],
      indices: [0, 1, 2],
    },
  ];
  for (const mesh of meshes) {
    mesh.selectionKey =
      mesh.actorId === undefined ? `geometry:${mesh.id}` : `actor:${mesh.actorId}:mesh:${mesh.id}`;
    mesh.uvs = mesh.positions.flatMap((v, i) => (i % 3 === 0 ? [v / 10, mesh.positions[i + 2] / 10] : []));
    mesh.materialName = 'Synthetic missing material';
    mesh.textureFallbackReason = 'Synthetic diagnostic fallback';
    mesh.textureBindings = [
      { imageId: 10, name: 'Synthetic color' },
      { imageId: 11, name: 'Synthetic layer 2' },
    ];
    mesh.uvInfo = { channel: request.uvChannel ?? 0, channels: [{ channel: 0 }, { channel: 1 }] };
    mesh.textureSourceImageId = request.textureImageId ?? null;
  }
  const selected = request.previewMeshKey
    ? meshes.filter((m) => m.selectionKey === request.previewMeshKey)
    : meshes;
  console.log(
    JSON.stringify({
      objects,
      meshes: request.includeGeometry ? selected : selected.map(({ positions, indices, ...meta }) => meta),
      contentBounds: { min: [-25, -2, -50], max: [25, 5, 0] },
      sha256: '0'.repeat(64),
      warnings: [],
      received: request,
    }),
  );
} else if (request.operation === 'materials') {
  console.log(JSON.stringify({ meshes: [], received: request }));
} else if (request.operation === 'build') {
  console.log(
    JSON.stringify({
      output: request.output,
      manifest: request.output + '.manifest.json',
      changedObjects: request.edits.length,
      received: request,
    }),
  );
} else {
  console.log(JSON.stringify({ error: { message: 'Unknown operation' } }));
  process.exitCode = 1;
}
