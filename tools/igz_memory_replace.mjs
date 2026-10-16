// Replace explicitly selected TMHN payloads by appending to their existing
// Vertex/Image pools. Old bytes and pool-relative object addresses stay intact.
// This does not change vertex counts, image dimensions, materials or ownership.
import { createHash } from 'node:crypto';
import { parseIgz } from './igz.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const align = (n, a) => Math.ceil(n / a) * a;
const LIMIT = 0x08000000;
const KINDS = new Set([
  'TSTR',
  'TMET',
  'MTSZ',
  'EXID',
  'EXNM',
  'TMHN',
  'ROOT',
  'TDEP',
  'RVTB',
  'RSTT',
  'ROFS',
  'RPID',
  'REXT',
  'RHND',
  'RNEX',
  'RMHN',
]);

/** Each replacement names a tableIndex, expected payload SHA-256, exact
 * ownerSlots (encoded RMHN locations), pool, flags and a nonempty Buffer.
 * Aliases must be acknowledged explicitly; no existing allocation is erased.
 */
export function replaceMemoryPayloads(input, { expectedSha256, replacements } = {}) {
  check(Buffer.isBuffer(input) && input.length <= 512 * 1024 * 1024, 'Expected a Buffer of at most 512 MiB');
  check(
    /^[a-f0-9]{64}$/.test(expectedSha256 ?? '') && sha(input) === expectedSha256,
    'Source SHA-256 mismatch',
  );
  check(
    Array.isArray(replacements) && replacements.length > 0 && replacements.length <= 1024,
    'Expected 1–1024 replacements',
  );
  const z = parseIgz(input),
    table = z.fixupMap.get('TMHN');
  check(table && table.end - table.dataOffset === table.count * 16, 'Unsupported TMHN table');
  check(
    z.unresolvedFixupEntries.length === 0 && z.fixups.every((f) => KINDS.has(f.magic)),
    'Unresolved/unknown fixups prohibit writing',
  );
  const plans = [],
    pools = new Map(),
    seen = new Set();
  let addedBytes = 0;
  for (const request of replacements) {
    check(
      request &&
        Object.keys(request).every((k) =>
          ['tableIndex', 'expectedPayloadSha256', 'ownerSlots', 'pool', 'flags', 'bytes'].includes(k),
        ),
      'Unsupported replacement field',
    );
    const { tableIndex, expectedPayloadSha256, ownerSlots, pool, flags, bytes } = request;
    check(
      Number.isInteger(tableIndex) && tableIndex >= 0 && tableIndex < table.count && !seen.has(tableIndex),
      'Invalid or duplicate TMHN index',
    );
    seen.add(tableIndex);
    check(
      Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 64 * 1024 * 1024,
      'Payload must contain 1 byte–64 MiB',
    );
    const at = table.dataOffset + tableIndex * 16,
      size = z.u32(at),
      oldFlags = z.u32(at + 4),
      encoded = z.u32(at + 8);
    check(z.u32(at + 12) === 0 && size > 0, 'Unsupported empty or wide TMHN pointer');
    const original = z.resolvePointer(encoded, size),
      d = z.descriptors[original.section];
    check(
      ['Vertex', 'Image'].includes(pool) && d.name === pool && !d.sentinel,
      'Replacement must stay in its Vertex/Image pool',
    );
    check(
      flags === oldFlags && flags === (pool === 'Image' ? 0x30000000 : 0),
      'Unsupported or unexpected memory flags',
    );
    const sourceBytes = input.subarray(original.offset, original.offset + size);
    check(
      /^[a-f0-9]{64}$/.test(expectedPayloadSha256 ?? '') && sha(sourceBytes) === expectedPayloadSha256,
      'Payload SHA-256 mismatch',
    );
    const actualOwners = z.tmhnReferences
      .filter((r) => r.tableIndex === tableIndex)
      .map((r) => {
        const d = z.descriptors.find((d) => r.offset >= d.offset && r.offset + 8 <= d.offset + d.dataSize);
        check(d && d.index > 0, 'Unmapped RMHN owner');
        return (d.index - 1) * LIMIT + r.offset - d.offset;
      })
      .sort((a, b) => a - b);
    check(
      Array.isArray(ownerSlots) &&
        ownerSlots.length > 0 &&
        ownerSlots.every(Number.isSafeInteger) &&
        new Set(ownerSlots).size === ownerSlots.length &&
        JSON.stringify([...ownerSlots].sort((a, b) => a - b)) === JSON.stringify(actualOwners),
      'Exact RMHN ownerSlots are required, including all shared users',
    );
    let p = pools.get(d.index);
    if (!p) {
      p = { descriptor: d, end: d.dataSize, additions: [] };
      pools.set(d.index, p);
    }
    const relative = align(p.end, pool === 'Image' ? 256 : 16),
      end = relative + bytes.length;
    check(end < LIMIT, 'Enlarged pool exceeds encoded pointer boundary');
    addedBytes += end - p.end;
    check(addedBytes <= 128 * 1024 * 1024, 'Total append exceeds 128 MiB');
    const nextEncoded = (d.index - 1) * LIMIT + relative;
    const plan = {
      tableIndex,
      at,
      size,
      oldFlags,
      encoded,
      nextEncoded,
      relative,
      bytes,
      original,
      ownerSlots: actualOwners,
    };
    p.additions.push(plan);
    p.end = end;
    plans.push(plan);
  }
  const insertions = [...pools.values()].sort((a, b) => a.descriptor.offset - b.descriptor.offset);
  const chunks = [];
  let cursor = 0;
  for (const p of insertions) {
    const end = p.descriptor.offset + p.descriptor.dataSize;
    chunks.push(input.subarray(cursor, end));
    const extra = Buffer.alloc(p.end - p.descriptor.dataSize);
    for (const plan of p.additions) plan.bytes.copy(extra, plan.relative - p.descriptor.dataSize);
    chunks.push(extra);
    cursor = end;
  }
  chunks.push(input.subarray(cursor));
  const output = Buffer.concat(chunks);
  for (const d of z.descriptors) {
    const shift = insertions
      .filter((p) => p.descriptor.index < d.index)
      .reduce((n, p) => n + p.end - p.descriptor.dataSize, 0);
    output.writeUInt32LE(d.offset + shift, 0x18 + d.index * 16);
    if (pools.has(d.index)) output.writeUInt32LE(pools.get(d.index).end, 0x1c + d.index * 16);
  }
  for (const plan of plans) {
    output.writeUInt32LE(plan.bytes.length, plan.at);
    output.writeUInt32LE(plan.nextEncoded, plan.at + 8);
  }
  const result = parseIgz(output);
  check(
    result.objects.length === z.objects.length && result.unresolvedFixupEntries.length === 0,
    'Object inventory changed',
  );
  for (const [kind, offsets] of z.offsetTables)
    check(
      JSON.stringify([...offsets.encodedOffsets]) ===
        JSON.stringify([...result.offsetTables.get(kind).encodedOffsets]),
      'Encoded fixup locations changed',
    );
  for (const d of z.descriptors.slice(1)) {
    const next = result.descriptors[d.index];
    check(
      input
        .subarray(d.offset, d.offset + d.storageSize)
        .equals(output.subarray(next.offset, next.offset + d.storageSize)),
      'Existing pool bytes changed',
    );
  }
  for (const plan of plans) {
    const at = result.resolvePointer(plan.nextEncoded, plan.bytes.length).offset;
    check(output.subarray(at, at + plan.bytes.length).equals(plan.bytes), 'Replacement readback differs');
    check(result.u32(plan.at + 4) === plan.oldFlags && result.u32(plan.at + 12) === 0, 'TMHN flags changed');
  }
  check(sha(input) === expectedSha256, 'Input buffer was mutated');
  return {
    buffer: output,
    manifest: {
      sourceSha256: expectedSha256,
      outputSha256: sha(output),
      appendedBytes: addedBytes,
      replacements: plans.map((p) => ({
        tableIndex: p.tableIndex,
        ownerSlots: p.ownerSlots,
        oldEncoded: p.encoded,
        newEncoded: p.nextEncoded,
        oldSize: p.size,
        newSize: p.bytes.length,
        flags: p.oldFlags,
        payloadSha256: sha(p.bytes),
        pool: z.descriptors[p.original.section].name,
      })),
      limitation:
        'Payload storage only; caller must validate the format-specific metadata and runtime behavior.',
    },
  };
}
