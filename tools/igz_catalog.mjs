#!/usr/bin/env node
// Source-bound structural catalog, not a gameplay-schema decoder or renderer.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseIgz } from './igz.mjs';

const MAX_SOURCE = 1024 ** 3,
  MAX_OUTPUT = 4 * 1024 ** 3,
  MAX_RAW_OBJECT = 65536;
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex64 = (value) => '0x' + value.toString(16).padStart(16, '0');
const TABLE_WIDTHS = new Map([
  ['EXID', 8],
  ['EXNM', 8],
  ['TMHN', 16],
  ['ROOT', 4],
]);
const RULES = Object.freeze([
  ['enemy', /\b(enemy|enemies|villain|boss|chompy|chompies|troll|goblin)\b/i],
  ['chest', /\b(chest|treasure)\b/i],
  ['crate', /\b(crate|barrel|box)\b/i],
  ['gate', /\b(gate|door|bridge|barrier|ramp)\b/i],
  ['lighting', /\b(light|lighting|shadow|ambient|fog|sky|sun|bloom)\b/i],
  ['scripts', /\b(script|scriptset|opcode|trigger|logic|op)\b/i],
  ['spawn', /\b(spawn|spawner|spawnpoint|checkpoint)\b/i],
  ['geometry', /\b(mesh|geometry|drawable|model|collision|physics)\b/i],
  ['pickup', /\b(pickup|collectible|coin|gem|food)\b/i],
  ['audio', /\b(audio|sound|music|voice)\b/i],
  ['camera', /\bcamera\b/i],
]);
const normalized = (text) => text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\/.-]+/g, ' ');

export function classifyFeatureCandidates(object) {
  const hints = [
    { source: 'type-name', value: object.type },
    ...object.stringReferences.map((r) => ({
      source: 'referenced-string',
      value: r.value,
      stringIndex: r.stringIndex,
      slotFileOffset: r.offset,
      fieldOffset: r.fieldOffset,
    })),
  ];
  const result = [];
  for (const [category, expression] of RULES) {
    const basis = [];
    for (const hint of hints) {
      const match = normalized(hint.value).match(expression);
      if (match) {
        const { value, ...location } = hint;
        basis.push({
          ...location,
          ...(hint.source === 'type-name' ? { value } : {}),
          matchedText: match[0],
          rule: expression.source,
        });
      }
    }
    if (basis.length)
      result.push({
        category,
        semanticProof: false,
        status: 'name-or-type-hint-only',
        classificationBasis: basis,
      });
  }
  return result;
}

function preflight(buffer, expectedSha256) {
  check(
    Buffer.isBuffer(buffer) && buffer.length <= MAX_SOURCE && buffer.length >= 0x34,
    'IGZ input must be a bounded Buffer <=1 GiB',
  );
  check(
    typeof expectedSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(expectedSha256) &&
      hash(buffer) === expectedSha256,
    'Explicit source SHA-256 mismatch',
  );
  const first = buffer.readUInt32LE(0x18),
    end = first + buffer.readUInt32LE(0x1c);
  check(first >= 0x224 && end >= first && end <= buffer.length, 'Invalid IGZ fixup region');
  let blocks = 0,
    entries = 0;
  for (let at = first; at < end; ) {
    check(at + 16 <= end, 'Truncated fixup header');
    const length = buffer.readUInt32LE(at + 8);
    check(length >= 16 && at + length <= end, 'Invalid fixup extent');
    entries += buffer.readUInt32LE(at + 4);
    blocks++;
    check(blocks <= 256 && entries <= 2_000_000, 'IGZ exceeds catalog fixup allocation budget');
    at += length;
  }
}

/** Pure view with iterable records. IDs are stable for this exact artifact only.
 * Object summaries use the parser's lower-bound reference range lookups, not an
 * objects-times-all-references scan. No inheritance or field names are guessed.
 */
export function createCatalogView(buffer, { expectedSha256, includeRawObjectHex = false } = {}) {
  check(typeof includeRawObjectHex === 'boolean', 'includeRawObjectHex must be boolean');
  preflight(buffer, expectedSha256);
  const z = parseIgz(buffer),
    artifactSha256 = expectedSha256;
  check(
    [...z.stringEntries, ...z.typeEntries].every((e) => e.byteLength <= 1024 * 1024),
    'Catalog string exceeds 1 MiB',
  );
  const id = (kind, index) => `igz:${artifactSha256}:${kind}:${index}`;
  const base = (kind, index) => ({ id: id(kind, index), artifactSha256 });
  const objectId = (index) => (index === null || index === undefined ? null : id('object', index));
  const fixupId = (magic, index) => id('relocation', `${magic}:${index}`);
  const tableId = (magic, index) => id('table', `${magic}:${index}`);
  const location = (offset, encoded) => {
    const owner = offset === null ? null : z.objectContaining(offset);
    return {
      fileOffset: offset,
      encodedOffset: encoded,
      ownerObjectId: objectId(owner?.index),
      ownerObjectIndex: owner?.index ?? null,
      fieldOffset: owner ? offset - owner.offset : null,
    };
  };
  const target = (offset, encoded) => {
    const owner = z.objectContaining(offset),
      exact = owner?.offset === offset;
    return {
      fileOffset: offset,
      encodedOffset: encoded,
      kind: owner ? (exact ? 'object-start' : 'object-interior') : 'untyped-data',
      objectId: objectId(owner?.index),
      objectIndex: owner?.index ?? null,
      interiorOffset: owner ? offset - owner.offset : null,
    };
  };
  const encodedAt = (offset) => {
    const pool = z.descriptors.find(
      (d) => d.index > 0 && !d.sentinel && offset >= d.offset && offset < d.offset + d.dataSize,
    );
    return pool ? (pool.index - 1) * 0x08000000 + offset - pool.offset : null;
  };
  const stringRef = (r) => ({
    ...r,
    source: location(r.offset, encodedAt(r.offset)),
    stringId: id('string', r.stringIndex),
    fieldSemantics: 'unknown',
  });
  const pointerRef = (r) => ({
    ...r,
    source: location(r.offset, encodedAt(r.offset)),
    target: target(r.targetOffset, r.encoded),
    fieldSemantics: 'unknown',
  });
  const specialRef = (r) => ({
    ...r,
    source: location(r.offset, r.encoded & ~0x04000000),
    fieldSemantics: 'unknown',
  });
  const tmhnRef = (r) => ({
    ...r,
    source: location(r.offset, encodedAt(r.offset)),
    tableEntryId: tableId('TMHN', r.tableIndex),
    fieldSemantics: 'unknown',
  });
  const tmhnByOffset = new Map(z.tmhnReferences.map((r) => [r.offset, r]));
  const otherByObject = new Map(),
    ownerless = {},
    unresolved = new Map(z.unresolvedFixupEntries.map((r) => [`${r.magic}:${r.index}`, r]));
  let relocationCount = 0;
  for (const [magic, table] of z.offsetTables) {
    ownerless[magic] = 0;
    relocationCount += table.offsets.length;
    for (let i = 0; i < table.offsets.length; i++) {
      const owner = table.offsets[i] ? z.objectContaining(table.offsets[i]) : null;
      if (!owner) ownerless[magic]++;
      if (owner && ['RPID', 'REXT', 'RHND', 'RNEX'].includes(magic)) {
        if (!otherByObject.has(owner.index)) otherByObject.set(owner.index, []);
        otherByObject.get(owner.index).push({
          id: fixupId(magic, i),
          magic,
          index: i,
          source: location(table.offsets[i], table.encodedOffsets[i]),
          fieldSemantics: 'unknown',
        });
      }
    }
  }
  const countsByType = Array(z.types.length).fill(0),
    featureCounts = Object.fromEntries(RULES.map(([name]) => [name, 0]));
  let featureObjectCount = 0;
  for (const object of z.objects) {
    countsByType[object.typeIndex]++;
    const hints = classifyFeatureCandidates(z.summarizeObject(object));
    if (hints.length) featureObjectCount++;
    for (const hint of hints) featureCounts[hint.category]++;
  }
  const tableLayouts = [...TABLE_WIDTHS].flatMap(([magic, width]) => {
    const f = z.fixupMap.get(magic);
    return f
      ? [
          {
            magic,
            count: f.count,
            recordBytes: width,
            layoutMatches: f.end - f.dataOffset === f.count * width,
            payloadBytes: f.end - f.dataOffset,
          },
        ]
      : [];
  });
  const limitations = [
    'Structural observations for one IGZ v8/platform14 artifact only; not a whole chapter/game catalog or a runtime observation.',
    'Object field semantics and class inheritance are unknown here; byte offsets and relocation kinds are not field names.',
    'Feature categories are name/type/string hints only, with false positives and false negatives; they do not prove enemies, interactable objects, scripts executing, or lighting settings.',
    'External identity/name table records are preserved raw; cross-artifact resolution, semantic identifiers and gameplay behavior are not established.',
    'Object-interior targets and unowned relocation slots are retained. Untyped data is not assigned to the nearest object.',
    'No mesh vertices, image pools, textures, scripts-as-source, or entire data pools are expanded; raw object bytes are optional and capped per object.',
  ];
  const manifest = {
    schema: 'skylanders-igz-catalog-v1',
    artifact: { sha256: artifactSha256, size: buffer.length, version: z.version, platform: z.platform },
    evidenceKind: 'read-only-serialized-structure',
    runtimeValidated: false,
    semanticsComplete: false,
    ids: {
      scope:
        'Exact artifact SHA-256 plus original RVTB/fixup/string index; indices may change in a rebuilt artifact.',
      example: objectId(0),
    },
    counts: {
      objects: z.objects.length,
      types: z.types.length,
      usedTypes: countsByType.filter(Boolean).length,
      strings: z.strings.length,
      dependencies: z.dependencies.length,
      ordinaryStringReferences: z.stringReferences.length,
      ordinaryPointerReferences: z.pointerReferences.length,
      specialRelocations: z.specialRelocations.length,
      tmhnReferences: z.tmhnReferences.length,
      unresolvedFixupEntries: z.unresolvedFixupEntries.length,
      encodedRelocationRecords: relocationCount,
      ownerlessLocationsByFixup: ownerless,
      featureCandidateObjects: featureObjectCount,
      featureCandidateCounts: featureCounts,
    },
    descriptors: z.descriptors,
    fixups: z.fixups,
    tableLayouts,
    types: z.typeEntries.map((entry) => ({
      ...entry,
      id: id('type', entry.index),
      size: z.typeSizes[entry.index],
      objectCount: countsByType[entry.index],
      fieldSchemaStatus: 'unknown',
    })),
    dependencies: z.dependencies.map((entry, index) => ({ index, ...entry, resolution: 'not-attempted' })),
    featureRules: RULES.map(([category, regex]) => ({
      category,
      expression: regex.source,
      flags: regex.flags,
      semanticProof: false,
    })),
    rawObjectHex: { enabled: includeRawObjectHex, maximumBytesPerObject: MAX_RAW_OBJECT },
    limitations,
  };
  function* objects() {
    for (const object of z.objects) {
      const summary = z.summarizeObject(object),
        raw = buffer.subarray(object.offset, object.offset + object.size);
      yield {
        ...base('object', object.index),
        objectIndex: object.index,
        type: object.type,
        typeIndex: object.typeIndex,
        size: object.size,
        source: {
          fileOffset: object.offset,
          encodedOffset: object.encoded,
          poolIndex: object.section,
          poolName: z.descriptors[object.section].name,
          poolRelativeOffset: object.relative,
        },
        sourceBytesSha256: hash(raw),
        fieldSchemaStatus: 'unknown',
        inheritanceStatus: 'not-inferred',
        stringReferences: summary.stringReferences.map(stringRef),
        pointerReferences: summary.pointerReferences.map(pointerRef),
        specialRelocations: summary.specialRelocations.map(specialRef),
        tmhnReferences: summary.tmhnReferences.map(tmhnRef),
        otherRelocations: otherByObject.get(object.index) ?? [],
        featureCandidates: classifyFeatureCandidates(summary),
        ...(includeRawObjectHex
          ? {
              rawObjectHex: raw.subarray(0, MAX_RAW_OBJECT).toString('hex'),
              rawObjectBytesIncluded: Math.min(raw.length, MAX_RAW_OBJECT),
              rawObjectComplete: raw.length <= MAX_RAW_OBJECT,
            }
          : {}),
      };
    }
  }
  function* strings() {
    for (const entry of z.stringEntries)
      yield {
        ...base('string', entry.index),
        ...entry,
        table: 'TSTR',
        source: { fileOffset: entry.offset, byteLength: entry.byteLength },
        meaning: 'uninterpreted-string',
      };
  }
  function* relocations() {
    for (const [magic, table] of z.offsetTables) {
      const f = z.fixupMap.get(magic);
      for (let index = 0; index < table.offsets.length; index++) {
        const offset = table.offsets[index] || null,
          encoded = table.encodedOffsets[index],
          missing = unresolved.get(`${magic}:${index}`);
        const slotEncoded = magic === 'ROFS' ? (encoded & ~0x04000000) >>> 0 : encoded;
        const pool = offset === null ? null : z.descriptors[Math.floor(slotEncoded / 0x08000000) + 1];
        const span =
          offset === null
            ? 0
            : Math.min(
                ['RSTT', 'RMHN', 'RPID', 'RVTB', 'ROOT'].includes(magic) ? 4 : 8,
                pool.offset + pool.dataSize - offset,
              );
        const raw = offset === null ? null : buffer.subarray(offset, offset + span);
        const record = {
          ...base('relocation', `${magic}:${index}`),
          magic,
          index,
          declaredEncoded: encoded,
          declaration: {
            fixupFileOffset: f.offset,
            index,
            encoding: magic === 'ROOT' ? 'raw-u32-le' : 'v8-nibble-delta',
          },
          source: location(offset, slotEncoded),
          rawSlotHex: raw?.toString('hex') ?? null,
          rawSlotBytes: span,
          fieldSemantics: 'unknown',
          status: missing ? 'unresolved-source-location' : 'source-location-resolved',
        };
        if (missing) record.unresolvedReason = missing.reason;
        if (magic === 'RVTB' || magic === 'ROOT') {
          record.kind = magic === 'RVTB' ? 'object-declaration' : 'root-object';
          record.target = target(offset, encoded);
        } else if (magic === 'RSTT')
          Object.assign(record, {
            kind: 'string-reference',
            reference: stringRef(z.stringReferencesByOffset.get(offset)),
          });
        else if (magic === 'ROFS' && offset !== null) {
          const special = z.specialRelocationsByOffset.get(offset);
          Object.assign(
            record,
            special
              ? { kind: 'runtime-initializer', reference: specialRef(special) }
              : { kind: 'ordinary-pointer', reference: pointerRef(z.pointerReferencesByOffset.get(offset)) },
          );
        } else if (magic === 'RMHN')
          Object.assign(record, { kind: 'tmhn-reference', reference: tmhnRef(tmhnByOffset.get(offset)) });
        else record.kind = 'uninterpreted-relocation';
        // Keep external records source-bound without pretending the raw words
        // have been linked to another artifact or a verified object field.
        if (['REXT', 'RNEX'].includes(magic) && raw?.length === 8) {
          const rawValue = raw.readBigUInt64LE(),
            tableName = magic === 'REXT' ? 'EXID' : 'EXNM',
            tableIndex = rawValue & 0x7fffffffffffffffn;
          record.externalTableReference = {
            table: tableName,
            rawValue: hex64(rawValue),
            signBitSet: rawValue >> 63n !== 0n,
            indexDecimal: tableIndex.toString(),
            inBounds: tableIndex < BigInt(z.fixupMap.get(tableName)?.count ?? 0),
            tableEntryId:
              tableIndex < BigInt(z.fixupMap.get(tableName)?.count ?? 0)
                ? tableId(tableName, tableIndex.toString())
                : null,
            crossArtifactResolution: 'not-attempted',
          };
        }
        yield record;
      }
    }
  }
  function* tables() {
    for (const layout of tableLayouts) {
      if (!layout.layoutMatches) {
        yield {
          ...base('table-layout', layout.magic),
          table: layout.magic,
          status: 'unknown-record-layout',
          ...layout,
          preservedBy: 'raw-fixups.jsonl.gz',
        };
        continue;
      }
      const f = z.fixupMap.get(layout.magic);
      for (let index = 0; index < f.count; index++) {
        const offset = f.dataOffset + index * layout.recordBytes,
          raw = buffer.subarray(offset, offset + layout.recordBytes);
        yield {
          ...base('table', `${layout.magic}:${index}`),
          table: layout.magic,
          index,
          source: { fileOffset: offset, byteLength: raw.length },
          rawHex: raw.toString('hex'),
          uint32LE: Array.from({ length: raw.length / 4 }, (_, i) => raw.readUInt32LE(i * 4)),
          fieldSemantics: 'unknown',
          ...(layout.magic === 'ROOT'
            ? { target: target(z.offsetTables.get('ROOT').offsets[index], raw.readUInt32LE()) }
            : {}),
        };
      }
    }
  }
  function* rawFixups() {
    for (const f of z.fixups)
      for (let at = f.offset, chunk = 0; at < f.end; at += 65536, chunk++) {
        const raw = buffer.subarray(at, Math.min(at + 65536, f.end));
        yield {
          ...base('fixup-chunk', `${f.magic}:${chunk}`),
          magic: f.magic,
          chunk,
          declaredCount: f.count,
          source: { fileOffset: at, byteLength: raw.length },
          fixupRelativeOffset: at - f.offset,
          rawHex: raw.toString('hex'),
          sha256: hash(raw),
          meaning: 'verbatim-fixup-bytes-including-header-and-padding',
        };
      }
  }
  function* features() {
    for (const object of z.objects)
      for (const candidate of classifyFeatureCandidates(z.summarizeObject(object)))
        yield {
          ...base('feature-candidate', `${object.index}:${candidate.category}`),
          objectId: objectId(object.index),
          objectIndex: object.index,
          type: object.type,
          fileOffset: object.offset,
          encodedOffset: object.encoded,
          ...candidate,
        };
  }
  return { manifest, objects, strings, relocations, tables, rawFixups, features };
}

function readSource(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    check(before.isFile() && before.size <= MAX_SOURCE, 'Source must be a regular non-symlink file <=1 GiB');
    const data = Buffer.alloc(before.size);
    let at = 0;
    while (at < data.length) {
      const n = fs.readSync(fd, data, at, Math.min(data.length - at, 1024 * 1024), at);
      check(n > 0, 'Source ended early');
      at += n;
    }
    const after = fs.fstatSync(fd),
      current = fs.lstatSync(filename);
    check(
      before.dev === current.dev &&
        before.ino === current.ino &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs,
      'Source changed while reading',
    );
    return { data, stat: after };
  } finally {
    fs.closeSync(fd);
  }
}
async function fileHash(filename) {
  const digest = createHash('sha256');
  let size = 0;
  const stream = fs.createReadStream(filename, { flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW });
  for await (const chunk of stream) {
    digest.update(chunk);
    size += chunk.length;
    check(size <= MAX_OUTPUT, 'File hash size limit exceeded');
  }
  return { sha256: digest.digest('hex'), size };
}
async function writeJsonLines(directory, name, records, budget) {
  const rawHash = createHash('sha256'),
    compressedHash = createHash('sha256');
  let rows = 0,
    rawBytes = 0,
    bytes = 0;
  function* lines() {
    for (const record of records) {
      const line = Buffer.from(JSON.stringify(record) + '\n');
      rows++;
      rawBytes += line.length;
      budget.bytes += line.length;
      check(budget.bytes <= MAX_OUTPUT, 'Catalog exceeds 4 GiB uncompressed output budget');
      rawHash.update(line);
      yield line;
    }
  }
  const digest = new Transform({
    transform(chunk, encoding, callback) {
      compressedHash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  const filename = path.join(directory, name);
  await pipeline(
    Readable.from(lines()),
    createGzip({ level: 6 }),
    digest,
    fs.createWriteStream(filename, { flags: 'wx', mode: 0o600 }),
  );
  const compressedSha256 = compressedHash.digest('hex'),
    verify = await fileHash(filename);
  check(
    verify.sha256 === compressedSha256 && verify.size === bytes,
    'Catalog output SHA-256 readback mismatch',
  );
  return {
    path: name,
    format: 'jsonl',
    compression: 'gzip',
    records: rows,
    size: bytes,
    sha256: compressedSha256,
    uncompressedSize: rawBytes,
    uncompressedSha256: rawHash.digest('hex'),
  };
}

export async function exportIgzCatalog({
  source,
  expectedSha256,
  outputDirectory,
  includeRawObjectHex = false,
}) {
  check(
    typeof source === 'string' && typeof outputDirectory === 'string',
    'Explicit source and new outputDirectory required',
  );
  source = path.resolve(source);
  const input = readSource(source);
  const view = createCatalogView(input.data, { expectedSha256, includeRawObjectHex });
  outputDirectory = path.resolve(outputDirectory);
  fs.mkdirSync(outputDirectory, { mode: 0o700 });
  outputDirectory = fs.realpathSync(outputDirectory);
  const files = [],
    budget = { bytes: 0 };
  for (const [name, records] of [
    ['objects', view.objects],
    ['strings', view.strings],
    ['relocations', view.relocations],
    ['tables', view.tables],
    ['raw-fixups', view.rawFixups],
    ['feature-candidates', view.features],
  ]) {
    files.push(await writeJsonLines(outputDirectory, `${name}.jsonl.gz`, records(), budget));
  }
  const after = fs.lstatSync(source),
    verifySource = await fileHash(source);
  check(
    !after.isSymbolicLink() &&
      after.dev === input.stat.dev &&
      after.ino === input.stat.ino &&
      after.size === input.stat.size &&
      after.mtimeMs === input.stat.mtimeMs &&
      after.ctimeMs === input.stat.ctimeMs &&
      verifySource.sha256 === expectedSha256,
    'Source changed during catalog export',
  );
  const manifest = {
    ...view.manifest,
    createdAt: new Date().toISOString(),
    sourcePath: source,
    outputDirectory,
    exporter: {
      tool: 'tools/igz_catalog.mjs',
      node: process.version,
      parser: 'tools/igz.mjs',
      sourceCodeSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
      parserSourceSha256: hash(fs.readFileSync(new URL('./igz.mjs', import.meta.url))),
    },
    files,
  };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  check(bytes.length <= 32 * 1024 * 1024, 'Catalog manifest exceeds 32 MiB');
  const manifestPath = path.join(outputDirectory, 'catalog.json');
  fs.writeFileSync(manifestPath, bytes, { flag: 'wx', mode: 0o600 });
  check((await fileHash(manifestPath)).sha256 === hash(bytes), 'Catalog manifest SHA-256 readback mismatch');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2),
      options = {},
      flags = new Map([
        ['--source', 'source'],
        ['--expect-sha256', 'expectedSha256'],
        ['--output-dir', 'outputDirectory'],
      ]);
    while (args.length) {
      const arg = args.shift();
      if (arg === '--raw-object-hex') {
        check(options.includeRawObjectHex === undefined, 'Duplicate raw-object option');
        options.includeRawObjectHex = true;
        continue;
      }
      const key = flags.get(arg);
      check(key && options[key] === undefined && args.length, 'Unknown, duplicate or missing CLI argument');
      options[key] = args.shift();
    }
    const result = await exportIgzCatalog(options);
    console.log(
      JSON.stringify(
        {
          catalog: path.join(result.outputDirectory, 'catalog.json'),
          artifact: result.artifact,
          counts: result.counts,
          files: result.files,
          limitations: result.limitations,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}
