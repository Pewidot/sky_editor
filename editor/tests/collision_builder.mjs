// Synthetic sibling collision backend; no game data or file writes.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
if (
  request.operation !== 'inspect' ||
  Object.keys(request).some((k) => !['operation', 'path', 'actorId', 'expectedSourceHash'].includes(k))
) {
  throw new Error('Collision fixture only supports read-only inspect');
}
const actors = [
  {
    actorId: 1,
    name: 'fixture',
    collisionId: 4,
    editable: true,
    reasons: [],
    position: [1, 1.7504663467407227, -32.273681640625],
    dimensionsWorld: [4, 6, 8],
    offsetWorld: [2, 3, 4],
    rotationDegrees: [0, 90, 0],
  },
  {
    actorId: 900,
    name: 'off-page actor',
    collisionId: 5,
    editable: true,
    reasons: [],
    position: [16, 2, -20],
    dimensionsWorld: [2, 4, 6],
    offsetWorld: [0, 0, 0],
    rotationDegrees: [0, 0, 0],
  },
  {
    actorId: 901,
    name: 'unresolved parent',
    editable: false,
    reasons: ['Actor must have a serialized null parent'],
    position: [0, 0, 0],
    dimensionsWorld: [100, 100, 100],
    offsetWorld: [0, 0, 0],
    rotationDegrees: [0, 0, 0],
  },
];
console.log(
  JSON.stringify({
    sha256: '0'.repeat(64),
    actors: request.actorId === undefined ? actors : actors.filter((a) => a.actorId === request.actorId),
    editableCount: 2,
    runtimeTested: false,
    received: request,
  }),
);
