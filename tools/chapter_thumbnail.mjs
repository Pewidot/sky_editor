// Replace only the workshop card's private image allocation. All chapter
// models, language dictionaries, other images and source files are preserved.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseIgz } from './igz.mjs';
import { replaceMemoryPayloads } from './igz_memory_replace.mjs';
import { encodePs4Bc1Mips } from './ps4_bc1_encode.mjs';
import { bcMipLayout } from './igz_texture.mjs';
import { replaceMember } from './iga_replace.mjs';
import { appendIgz, inspectAppendTarget } from './igz_append.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
// Both authored chapters originally shared Level_024.mdl. Give Gallardo a
// private model/material/image graph before touching any pixel allocation.
function privateWorkshopModel(source) {
  const z = parseIgz(source),
    start = 292768,
    end = 295592,
    from = z.resolvePointer(start).offset;
  const actor = z.objects.find((o) => o.encoded === 292272),
    model = z.objects.find((o) => o.encoded === start);
  assert.equal(z.pointerReferencesByOffset.get(actor.offset + 344)?.targetObjectIndex, model.index);
  const incoming = z.pointerReferences.filter((r) => r.targetObjectIndex === model.index);
  assert.deepEqual(
    incoming.map((r) => z.objects[r.objectIndex]?.encoded).sort((a, b) => a - b),
    [292272, 431120],
  );
  assert.equal(z.u32(model.offset + 8), 2);
  const t = inspectAppendTarget(source, sha(source)),
    payload = Buffer.from(source.subarray(from, from + end - start));
  const objects = z.objects.filter((o) => o.section === 1 && o.encoded >= start && o.encoded < end);
  assert.equal(objects.length, 33);
  const fixups = {},
    increments = new Map();
  for (const [kind, table] of z.offsetTables) {
    if (['RVTB', 'ROOT'].includes(kind)) continue;
    for (const at of table.offsets)
      if (at >= from && at < from + payload.length) {
        const local = at - from;
        (fixups[kind] ??= []).push(local);
        if (kind === 'ROFS') {
          const ref = z.pointerReferencesByOffset.get(at);
          assert.ok(ref);
          if (ref.encoded >= start && ref.encoded < end)
            payload.writeBigUInt64LE(BigInt(t.appendOffset + ref.encoded - start), local);
          else {
            assert.ok(Number.isInteger(ref.targetObjectIndex));
            increments.set(ref.targetObjectIndex, (increments.get(ref.targetObjectIndex) ?? 0) + 1);
          }
        }
      }
  }
  for (const o of objects)
    payload.writeUInt32LE(
      o === model
        ? 1
        : z.pointerReferences.filter(
            (r) => r.targetObjectIndex === o.index && r.offset >= from && r.offset < from + payload.length,
          ).length,
      o.encoded - start + 8,
    );
  const strings = [
    'Workshop_Gallardo_Card.mdl',
    'Workshop_Gallardo_Card_Body',
    'Workshop_Gallardo_Card_Image',
  ];
  for (const [i, encoded] of [start, 292880, 293712].entries())
    payload.writeUInt32LE(t.stringCount + i, encoded - start + 16);
  const appended = appendIgz(source, {
    expectedSha256: sha(source),
    appendedDefaultPool: payload,
    appendedObjects: objects.map((o) => ({ offset: o.encoded - start, type: o.type })),
    fixupSlots: fixups,
    newStrings: strings,
  });
  const bytes = Buffer.from(appended.buffer),
    a = parseIgz(bytes),
    find = (e) => a.objectsByOffset.get(a.resolvePointer(e).offset);
  bytes.writeBigUInt64LE(BigInt(t.appendOffset), find(actor.encoded).offset + 344);
  bytes.writeUInt32LE(1, find(model.encoded).offset + 8);
  for (const [id, count] of increments) {
    const o = find(z.objects[id].encoded);
    bytes.writeUInt32LE(a.u32(o.offset + 8) + count, o.offset + 8);
  }
  // Duplicate only the selected image's TMHN descriptor. Existing indices
  // and pool-relative addresses stay unchanged; all following pools shift16.
  const imageEncoded = t.appendOffset + 293712 - start,
    image = find(imageEncoded);
  const table = a.fixupMap.get('TMHN'),
    oldHandle = a.tmhnReferences.find((r) => r.offset === image.offset + 96);
  assert.equal(oldHandle.tableIndex, 116);
  const descriptor = bytes.subarray(table.dataOffset + 116 * 16, table.dataOffset + 117 * 16);
  const split = Buffer.concat([bytes.subarray(0, table.end), descriptor, bytes.subarray(table.end)]);
  split.writeUInt32LE(table.count + 1, table.offset + 4);
  split.writeUInt32LE(table.length + 16, table.offset + 8);
  split.writeUInt32LE(a.descriptors[0].dataSize + 16, 0x1c);
  for (const d of a.descriptors.slice(1)) split.writeUInt32LE(d.offset + 16, 0x18 + d.index * 16);
  split.writeBigUInt64LE(BigInt(table.count), image.offset + 16 + 96);
  const out = parseIgz(split);
  assert.equal(out.unresolvedFixupEntries.length, 0);
  assert.equal(out.tmhnReferences.filter((r) => r.tableIndex === 116).length, 1);
  assert.equal(out.tmhnReferences.filter((r) => r.tableIndex === table.count).length, 1);
  return { buffer: split, imageEncoded, modelEncoded: t.appendOffset, append: appended.manifest };
}
export function replaceWorkshopThumbnail(source, rgba, expectedSha256) {
  assert.equal(sha(source), expectedSha256, 'UI source changed');
  assert.equal(
    expectedSha256,
    '18a0f846bdb0cdfee2e9ebd6da3044418ed9640fd5fb3a2a1bda6333d735d041',
    'Unsupported registered UI revision',
  );
  assert.equal(rgba.length, 1024 * 1024 * 4, 'Expected 1024 square RGBA image');
  const z = parseIgz(source),
    o = z.objects.find((o) => o.encoded === 293712);
  assert.equal(o?.type, 'igImage2');
  assert.equal(z.stringReferencesByOffset.get(o.offset + 16)?.value, 'ColorMap#level_000#11');
  const owner = z.objects.find((o) => o.encoded === 292272);
  assert.equal(owner?.type, 'tfbActorInfo');
  assert.equal(z.stringReferencesByOffset.get(owner.offset + 16)?.value, 'Level Select Button 023');
  const tex = z.objects.find((o) => o.encoded === 293608);
  assert.equal(tex?.type, 'igTextureAttr2');
  assert.equal(z.pointerReferencesByOffset.get(tex.offset + 0x38)?.targetObjectIndex, o.index);
  assert.equal(
    z.pointerReferences.filter((r) => r.targetObjectIndex === o.index).length,
    1,
    'Thumbnail must not be shared',
  );
  assert.equal(source.readUInt16LE(o.offset + 64), 1024);
  assert.equal(source.readUInt16LE(o.offset + 66), 1024);
  assert.equal(source.readUInt16LE(o.offset + 70), 6);
  const ex = z.fixupMap.get('EXID').dataOffset + z.u32(o.offset + 80) * 8;
  assert.equal(source.subarray(ex, ex + 8).toString('hex'), '833431f8c2d03c84');
  const handle = z.tmhnReferences.find((r) => r.offset === o.offset + 96);
  assert.ok(handle);
  assert.equal(z.tmhnReferences.filter((r) => r.tableIndex === handle.tableIndex).length, 1);
  const table = z.fixupMap.get('TMHN').dataOffset + handle.tableIndex * 16,
    size = z.u32(table),
    at = z.resolvePointer(z.u32(table + 8), size).offset;
  const layout = bcMipLayout(1024, 1024, 6, 8),
    length = layout.at(-1).offset + layout.at(-1).size;
  assert.equal(size, length);
  // The native card's UVs run bottom-to-top (confirmed by the first runtime
  // capture); keep input PNGs conventional and flip only for this material.
  const flipped = Buffer.alloc(rgba.length);
  for (let y = 0; y < 1024; y++) rgba.copy(flipped, (1023 - y) * 4096, y * 4096, (y + 1) * 4096);
  const encoded = encodePs4Bc1Mips(flipped, 1024, 1024).buffer.subarray(0, length);
  const isolated = privateWorkshopModel(source),
    a = parseIgz(isolated.buffer);
  const image = a.objects.find((o) => o.encoded === isolated.imageEncoded),
    privateHandle = a.tmhnReferences.find((r) => r.offset === image.offset + 96);
  const result = replaceMemoryPayloads(isolated.buffer, {
    expectedSha256: sha(isolated.buffer),
    replacements: [
      {
        tableIndex: privateHandle.tableIndex,
        expectedPayloadSha256: sha(source.subarray(at, at + size)),
        ownerSlots: [image.encoded + 96],
        pool: 'Image',
        flags: 0x30000000,
        bytes: encoded,
      },
    ],
  });
  return {
    ...result,
    manifest: {
      ...result.manifest,
      sourceSha256: expectedSha256,
      card: 'Level Select Button 023',
      imageEncoded: image.encoded,
      privateModelEncoded: isolated.modelEncoded,
      isolatedModel: isolated.append,
      verticalFlip: true,
      rgbaSha256: sha(rgba),
      runtimeValidated: false,
    },
  };
}
export async function buildThumbnailFiles({ inner, archive, png, expectedSha256, output }) {
  assert.ok(!fs.existsSync(output), 'Output directory must be new');
  const bytes = fs.readFileSync(png);
  assert.ok(
    bytes.length < 16 * 1024 * 1024 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
    'Expected bounded PNG',
  );
  const decoded = spawnSync(
    'magick',
    [
      '-limit',
      'width',
      '8192',
      '-limit',
      'height',
      '8192',
      '-limit',
      'memory',
      '128MiB',
      '-limit',
      'disk',
      '0',
      'png:-',
      '-resize',
      '1024x1024',
      '-background',
      '#7e9fbb',
      '-gravity',
      'center',
      '-extent',
      '1024x1024',
      '-alpha',
      'on',
      '-depth',
      '8',
      'rgba:-',
    ],
    { input: bytes, maxBuffer: 5 * 1024 * 1024, timeout: 20000 },
  );
  assert.ok(!decoded.error && decoded.status === 0, 'PNG decoder failed');
  const result = replaceWorkshopThumbnail(fs.readFileSync(inner), decoded.stdout, expectedSha256);
  fs.mkdirSync(output, { mode: 0o700 });
  const replacement = path.join(output, 'level.bld');
  fs.writeFileSync(replacement, result.buffer, { flag: 'wx', mode: 0o600 });
  const packed = await replaceMember({
    source: archive,
    selector: 'level.bld',
    replacement,
    output: path.join(output, 'ui_levelselect.bld'),
  });
  const manifest = {
    ...result.manifest,
    art: { path: path.resolve(png), sha256: sha(bytes) },
    archive: packed.output,
  };
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [inner, archive, png, expectedSha256, output] = process.argv.slice(2);
    assert.ok(
      output && process.argv.length === 7,
      'Usage: chapter_thumbnail.mjs inner-ui.bld archive.bld art.png EXPECTED_SHA256 NEW_DIRECTORY',
    );
    console.log(JSON.stringify(await buildThumbnailFiles({ inner, archive, png, expectedSha256, output })));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
