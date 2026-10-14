// Synthetic private actor/CollisionInfo graph; no proprietary bytes.
import { makeIgz } from './igz_fixture.mjs';
import { parseIgz } from '../../tools/igz.mjs';

function offsetChunk(locations, magic = 'ROFS') {
  const nibbles = [];
  let previous = 0;
  for (const value of [...new Set(locations)].sort((a, b) => a - b)) {
    let delta = (value - previous) / 4 - 1;
    if (!Number.isInteger(delta) || delta < 0) throw Error('Invalid synthetic relocation');
    do {
      const n = delta % 8;
      delta = Math.floor(delta / 8);
      nibbles.push(n | (delta ? 8 : 0));
    } while (delta);
    previous = value;
  }
  const out = Buffer.alloc(Math.ceil((16 + Math.ceil(nibbles.length / 2)) / 4) * 4);
  out.write(magic);
  out.writeUInt32LE(new Set(locations).size, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(16, 12);
  nibbles.forEach((n, i) => {
    out[16 + (i >> 1)] |= n << ((i % 2) * 4);
  });
  return out;
}

export function makeCollisionIgz({
  shared = false,
  interiorReference = false,
  parent = false,
  missingPointer = false,
  scale = [100, 100, 100],
  rotation = [0, 0, 0],
  collisionRotation = [0, 0, 0],
  collisionSize = 0x80,
  actorSize = 0x170,
  properties = 0x69,
  dimensionsFeet = [35, 35, 3],
  offsetWorld = [0, 0, 0],
  unresolvedRofs = false,
  scalarFixup = false,
  placementFlags = 0,
  attachmentField,
  specialNullField,
  externalField,
  externalMagic = 'RNEX',
} = {}) {
  const bytes = makeIgz({
    unresolvedRofs,
    objects: [
      { name: 'PrivateBox', size: actorSize, position: [1, 2, 3], rotation },
      { name: 'OtherActor', size: actorSize },
      { name: 'Collision', type: 'CollisionInfo', size: collisionSize },
    ],
  });
  const igz = parseIgz(bytes),
    base = igz.descriptors[1].offset,
    actor = igz.objects[1],
    other = igz.objects[2],
    collision = igz.objects[3];
  const root = igz.objects[0],
    list = igz.pointerReferencesByOffset.get(root.offset + 0x20).targetOffset;
  // Only actors are list members; the collision is reachable through its owner.
  bytes.writeUInt32LE(2, root.offset + 0xc);
  bytes.writeUInt32LE(2, root.offset + 0x10);
  bytes.writeUInt32LE(16, root.offset + 0x18);
  bytes.writeBigUInt64LE(0n, list + 16);
  const slots = [...igz.offsetTables.get('ROFS').encodedOffsets].filter((at) => at !== list + 16 - base);
  function pointer(slot, destination) {
    bytes.writeBigUInt64LE(BigInt(destination - base), slot);
    slots.push(slot - base);
  }
  if (!missingPointer) pointer(actor.offset + 0x120, collision.offset);
  if (shared || interiorReference)
    pointer(other.offset + 0x120, collision.offset + (interiorReference ? 4 : 0));
  if (parent) pointer(actor.offset + 0x80, other.offset);
  if (attachmentField !== undefined) pointer(actor.offset + attachmentField, other.offset);
  if (specialNullField !== undefined) slots.push((actor.offset + specialNullField - base) | 0x04000000);
  [actor, other].forEach((a) => scale.forEach((n, i) => bytes.writeFloatLE(n, a.offset + 0x114 + i * 4)));
  bytes.writeUInt32LE(placementFlags, actor.offset + 0x38);
  bytes.writeUInt32LE(properties, collision.offset + 0x30);
  offsetWorld.forEach((n, i) => bytes.writeFloatLE(n, collision.offset + 0x34 + i * 4));
  collisionRotation.forEach((n, i) => bytes.writeFloatLE(n, collision.offset + 0x40 + i * 4));
  dimensionsFeet.forEach((n, i) => bytes.writeFloatLE(n, collision.offset + 0x4c + i * 4));
  if (scalarFixup) pointer(collision.offset + 0x34, actor.offset);
  const chunks = igz.fixups.map((f) =>
    f.magic === 'ROFS' ? offsetChunk(slots) : bytes.subarray(f.offset, f.end),
  );
  if (externalField !== undefined)
    chunks.push(offsetChunk([actor.offset + externalField - base], externalMagic));
  const fixups = Buffer.concat(chunks),
    header = Buffer.from(bytes.subarray(0, 0x800));
  header.writeUInt32LE(chunks.length, 0x10);
  header.writeUInt32LE(fixups.length, 0x1c);
  header.writeUInt32LE(0x800 + fixups.length, 0x28);
  return Buffer.concat([header, fixups, bytes.subarray(base)]);
}
