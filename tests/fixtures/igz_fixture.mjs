// Synthetic IGZ v8/PS4 data for parser and editor tests. Contains no game assets.
// This fixture builder is deliberately not a general-purpose IGZ writer.
const SIZES = new Map([
  ['tfbActorInfo', 0x170],
  ['Placement', 0x138],
  ['AbstractPlacement', 0xf0],
]);
const align = (value, boundary) => Math.ceil(value / boundary) * boundary;

function stringPayload(strings) {
  return Buffer.concat(
    strings.map((text) => {
      const value = Buffer.from(text, 'utf8');
      const padded = Buffer.alloc(align(value.length + 1, 2));
      value.copy(padded);
      return padded;
    }),
  );
}

function words(values) {
  const result = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => result.writeUInt32LE(value, i * 4));
  return result;
}

function offsets(values) {
  const nibbles = [];
  let previous = 0;
  for (const value of values) {
    let delta = (value - previous) / 4 - 1;
    if (!Number.isInteger(delta) || delta < 0)
      throw new Error('Fixture offsets must increase in four-byte steps');
    do {
      let nibble = delta % 8;
      delta = Math.floor(delta / 8);
      if (delta) nibble |= 8;
      nibbles.push(nibble);
    } while (delta);
    previous = value;
  }
  const result = Buffer.alloc(Math.ceil(nibbles.length / 2));
  nibbles.forEach((nibble, i) => {
    result[i >> 1] |= nibble << ((i % 2) * 4);
  });
  return result;
}

function fixup(magic, count, payload) {
  const result = Buffer.alloc(align(16 + payload.length, 4));
  result.write(magic, 0, 4, 'ascii');
  result.writeUInt32LE(count, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(16, 12);
  payload.copy(result, 16);
  return result;
}

/**
 * Return a Buffer containing a valid, small IGZ v8/platform14 object graph.
 *
 * Default objects (RVTB indices 1 and 2) are tfbActorInfo named Alpha and Beta.
 * Configure objects with {type, name, size, position:[x,y,z], rotation:[x,y,z]}.
 * includeUnknown adds an UnknownPlacementFixture (0x40 bytes) for editor
 * rejection tests. Root igObjectList is always index 0. Empty names are valid.
 * sentinelPool adds an empty String pool; unresolvedRofs adds a genuinely
 * unmappable ROFS location even after masking its initializer flag.
 * specialRelocation adds a valid zero-and-initialize slot on object #1.
 * tmhnReference adds one TMHN entry and an RMHN slot on object #1.
 */
export function makeIgz({
  objects,
  includeUnknown = false,
  sentinelPool = false,
  unresolvedRofs = false,
  specialRelocation = false,
  tmhnReference = false,
} = {}) {
  const specs = (
    objects ?? [
      { name: 'Alpha', position: [1.25, 2.5, -3.75], rotation: [0, 90, 0] },
      { name: 'Beta', position: [-10, 20, 30], rotation: [15, -45, 5] },
    ]
  ).map((entry, i) => ({
    type: entry.type ?? 'tfbActorInfo',
    name: entry.name ?? `Actor ${i + 1}`,
    size: entry.size ?? SIZES.get(entry.type ?? 'tfbActorInfo') ?? 0x40,
    position: entry.position ?? [0, 0, 0],
    rotation: entry.rotation ?? [0, 0, 0],
  }));
  if (includeUnknown)
    specs.push({
      type: 'UnknownPlacementFixture',
      name: 'Unverified',
      size: 0x40,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    });
  for (const s of specs) {
    if (!Number.isSafeInteger(s.size) || s.size < 24 || s.size % 8 !== 0)
      throw new Error('Fixture object size must be a multiple of eight, at least 24');
    if (s.name.includes('\0') || s.type.includes('\0'))
      throw new Error('Fixture names/types cannot contain NUL');
    for (const v of [s.position, s.rotation])
      if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite))
        throw new Error('Fixture transforms must be finite three-vectors');
  }
  const types = ['igObjectList'],
    typeSizes = [0x28];
  for (const s of specs) {
    let index = types.indexOf(s.type);
    if (index < 0) {
      index = types.length;
      types.push(s.type);
      typeSizes.push(s.size);
    }
    if (typeSizes[index] !== s.size) throw new Error('Fixture cannot use different sizes for the same type');
    s.typeIndex = index;
  }
  // Root at 8; pointer array immediately after its 40-byte object span.
  const root = 8,
    listData = 48;
  let cursor = align(listData + specs.length * 8, 8);
  specs.forEach((s) => {
    s.offset = cursor;
    cursor += s.size;
  });
  const data = Buffer.alloc(cursor);
  data.writeUInt32LE(specs.length, root + 0xc);
  data.writeUInt32LE(specs.length, root + 0x10);
  data.writeUInt32LE(specs.length * 8, root + 0x18);
  const rofs = specs.length ? [root + 0x20] : [];
  if (specs.length) data.writeBigUInt64LE(BigInt(listData), root + 0x20);
  specs.forEach((s, i) => {
    data.writeBigUInt64LE(BigInt(s.offset), listData + i * 8);
    rofs.push(listData + i * 8);
    data.writeUInt32LE(s.typeIndex, s.offset);
    data.writeUInt32LE(i, s.offset + 0x10);
    if (s.size >= 0x70)
      [...s.position, ...s.rotation].forEach((v, j) => data.writeFloatLE(v, s.offset + 0x40 + j * 4));
  });
  if ((specialRelocation || tmhnReference) && (!specs[0] || specs[0].size < 48))
    throw new Error('Special relocation fixtures require a first object of at least 48 bytes');
  if (specialRelocation) {
    const slot = specs[0].offset + 0x20;
    data.writeUInt32LE(0xffffffff, slot); // must never be decoded as a pointer
    rofs.push(slot | 0x04000000);
  }
  if (unresolvedRofs) rofs.push(0x07fffffc);
  const rvtb = [root, ...specs.map((s) => s.offset)],
    rstt = specs.map((s) => s.offset + 0x10);
  const fixups = [
    fixup('TSTR', specs.length, stringPayload(specs.map((s) => s.name))),
    fixup('TMET', types.length, stringPayload(types)),
    fixup('MTSZ', types.length, words(typeSizes)),
    ...(tmhnReference ? [fixup('TMHN', 1, Buffer.alloc(16))] : []),
    fixup('RVTB', rvtb.length, offsets(rvtb)),
    fixup('RSTT', rstt.length, offsets(rstt)),
    fixup('ROFS', rofs.length, offsets(rofs)),
    ...(tmhnReference ? [fixup('RMHN', 1, offsets([specs[0].offset + 0x28]))] : []),
    fixup('ROOT', 1, words([root])),
  ];
  const fixupBytes = Buffer.concat(fixups),
    dataOffset = 0x800 + fixupBytes.length;
  const result = Buffer.alloc(dataOffset + data.length + (sentinelPool ? 4 : 0));
  result.writeUInt32LE(0x49475a01, 0);
  result.writeUInt32LE(8, 4);
  result.writeUInt32LE(14, 12);
  result.writeUInt32LE(fixups.length, 16);
  for (const [at, identifier, offset, size, alignment] of [
    [0x14, 0, 0x800, fixupBytes.length, 0x800],
    [0x24, 0, dataOffset, data.length, 8],
    ...(sentinelPool ? [[0x34, 8, dataOffset + data.length, 0xffffffff, 0]] : []),
  ]) {
    [identifier, offset, size, alignment].forEach((value, i) => result.writeUInt32LE(value, at + i * 4));
  }
  result.write('Default\0String\0', 0x224, 'ascii');
  fixupBytes.copy(result, 0x800);
  data.copy(result, dataOffset);
  return result;
}
