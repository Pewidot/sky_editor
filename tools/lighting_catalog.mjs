#!/usr/bin/env node
// Static lighting field extraction; deliberately does not apply game lighting.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseIgz } from './igz.mjs';
import { extractMetadata } from './elf_metadata.mjs';
import { EXECUTABLE_SHA256 } from './level_builder.mjs';
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const hash = (b) => createHash('sha256').update(b).digest('hex');
const TYPES = new Set(['tfbLightInfo', 'DirectionalLightInfo', 'tfbMoodBoxInfo']);
const STORAGE = new Map([
  [
    0x58ee40,
    {
      name: 'igFloatMetaField',
      bytes: 4,
      proof: 'ev_9c88511c5667ffd692e4b039c6a7ed1ef61b86343f766ad8bf4ad9832b5d3d22',
    },
  ],
  [
    0x5cc240,
    {
      name: 'igVec4ucMetaField',
      bytes: 4,
      proof: 'ev_5cce43362e26187cfacc151f79b6c2fac3a96829ec570be2b6b83fb868072375',
    },
  ],
  [
    0x589500,
    {
      name: 'igBoolMetaField',
      bytes: 1,
      proof: 'ev_724fb23fd53c881070b7b1deb78392ea7b4029c7e866431ec3fa7564c2729eb8',
    },
  ],
  [
    0x492000,
    {
      name: 'tfbEulerTransformMetaField',
      bytes: 24,
      proof: 'ev_1c8b4f1c7e21fe1c92099415021dc55f7e30301bdbc80ad7cec50a076897a200',
    },
  ],
]);

export function decodeLighting(buffer, { expectedSha256, metadata } = {}) {
  check(Buffer.isBuffer(buffer) && buffer.length <= 1024 ** 3, 'Expected IGZ Buffer <=1 GiB');
  check(
    typeof expectedSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(expectedSha256) &&
      hash(buffer) === expectedSha256,
    'Source SHA-256 mismatch',
  );
  check(metadata?.executableSha256 === EXECUTABLE_SHA256, 'Matching native executable metadata required');
  const z = parseIgz(buffer),
    classes = new Map(metadata.classes.filter((c) => TYPES.has(c.name)).map((c) => [c.name, c]));
  check(classes.size === TYPES.size, 'All three verified lighting class definitions required');
  const objects = [],
    counts = Object.fromEntries([...TYPES].map((t) => [t, 0]));
  for (const object of z.objects) {
    if (!TYPES.has(object.type)) continue;
    const cls = classes.get(object.type);
    check(object.size === cls.size, 'Lighting MTSZ/native size mismatch');
    counts[object.type]++;
    const fields = [],
      virtualFields = [];
    for (const field of cls.fields) {
      // Metadata offset zero includes virtual/global fields; never read the
      // serialized vtable index as a light property.
      if (field.offset === 0) {
        virtualFields.push({ ...field, status: 'not-a-serialized-instance-field' });
        continue;
      }
      check(field.offset >= 8 && field.offset < object.size, 'Invalid native field offset');
      const storage = STORAGE.get(field.metaConstructor);
      const next = Math.min(
        object.size,
        ...cls.fields.filter((f) => f.offset > field.offset).map((f) => f.offset),
      );
      const length = storage?.bytes ?? Math.min(24, next - field.offset);
      check(
        field.offset + length <= object.size && length <= next - field.offset,
        'Native field exceeds object/next-field span',
      );
      const at = object.offset + field.offset,
        raw = buffer.subarray(at, at + length);
      const entry = {
        name: field.name,
        fieldOffset: field.offset,
        fileOffset: at,
        byteLength: length,
        rawHex: raw.toString('hex'),
        nameAndOffsetEvidence: cls.evidence,
        nativeMetaConstructor: field.metaConstructor,
        storageType: storage?.name ?? 'uninterpreted',
        ...(storage ? { storageEvidence: storage.proof } : {}),
      };
      if (storage?.name === 'igFloatMetaField') {
        const value = raw.readFloatLE();
        entry.value = Number.isFinite(value) ? value : null;
        entry.valueStatus = Number.isFinite(value) ? 'decoded' : 'nonfinite-preserved-raw';
      } else if (storage?.name === 'igVec4ucMetaField') {
        entry.byteComponents = [...raw];
        entry.channelOrder = 'not-established';
        entry.colorSpace = 'not-established';
      } else if (storage?.name === 'igBoolMetaField') {
        entry.value = raw[0] < 2 ? Boolean(raw[0]) : null;
        entry.valueStatus = raw[0] < 2 ? 'decoded' : 'noncanonical-preserved-raw';
      } else if (storage?.name === 'tfbEulerTransformMetaField') {
        const components = Array.from({ length: 6 }, (_, i) => raw.readFloatLE(i * 4));
        entry.float32Components = components.map((x) => (Number.isFinite(x) ? x : null));
        entry.componentOrder =
          'serialized six-float Euler transform; not composed into a runtime light direction';
      }
      const pointer = z.pointerReferencesByOffset.get(at),
        string = z.stringReferencesByOffset.get(at);
      if (pointer)
        entry.pointer = {
          targetFileOffset: pointer.targetOffset,
          objectIndex: pointer.targetObjectIndex,
          objectId:
            pointer.targetObjectIndex === null
              ? null
              : `igz:${expectedSha256}:object:${pointer.targetObjectIndex}`,
        };
      if (string) entry.string = { index: string.stringIndex, value: string.value };
      fields.push(entry);
    }
    const summary = z.summarizeObject(object);
    objects.push({
      id: `igz:${expectedSha256}:object:${object.index}`,
      objectIndex: object.index,
      type: object.type,
      name: z.stringReferencesByOffset.get(object.offset + 0x10)?.value ?? '',
      fileOffset: object.offset,
      size: object.size,
      fields,
      virtualFields,
      referenceSummary: summary,
      ...(object.type === 'tfbLightInfo'
        ? {
            inheritedPlacement: {
              fieldOffset: 0x40,
              initialTransformHex: buffer
                .subarray(object.offset + 0x40, object.offset + 0x58)
                .toString('hex'),
              parentSlotHex: buffer.subarray(object.offset + 0x80, object.offset + 0x88).toString('hex'),
              worldTransformResolved: false,
            },
          }
        : {}),
    });
  }
  return {
    schema: 'skylanders-lighting-catalog-v1',
    source: { sha256: expectedSha256, size: buffer.length },
    executableSha256: metadata.executableSha256,
    counts,
    classes: [...classes.values()],
    objects,
    runtimeObserved: false,
    rendererReconstructionComplete: false,
    limitations: [
      'Native metadata establishes local field names/offsets/types, not the active runtime lighting state.',
      'Light-type enum meanings, color channel order/color space, unit conversions and untyped storage remain unknown.',
      'Mood-box volumes, environment maps, script switching/blending, fog, postprocessing and shadowing are not evaluated.',
      'Inherited placement bytes are retained but parent transforms are not composed; dynamic/virtual fields are not serialized instance data.',
      'The editor uses adjustable preview shading, not native lighting; this exporter does not modify game files or renderer settings.',
    ],
  };
}

export function exportLighting({ source, executable, expectedSha256, output }) {
  check(
    typeof source === 'string' && typeof executable === 'string' && typeof output === 'string',
    'source, executable and new output required',
  );
  const fd = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    check(before.isFile() && before.size <= 1024 ** 3, 'Expected regular source <=1 GiB');
    const buffer = fs.readFileSync(fd),
      metadata = extractMetadata(executable),
      result = decodeLighting(buffer, { expectedSha256, metadata });
    const after = fs.fstatSync(fd),
      current = fs.lstatSync(source);
    check(
      !current.isSymbolicLink() &&
        current.ino === before.ino &&
        current.dev === before.dev &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs,
      'Source changed during lighting export',
    );
    const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
    check(bytes.length <= 64 * 1024 * 1024, 'Lighting JSON exceeds 64 MiB');
    fs.writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
    check(hash(fs.readFileSync(output)) === hash(bytes), 'Output readback mismatch');
    return {
      output: path.resolve(output),
      sha256: hash(bytes),
      size: bytes.length,
      source: result.source,
      counts: result.counts,
    };
  } finally {
    fs.closeSync(fd);
  }
}

export function exportChapterLighting({ chapterIndex, executable, outputDirectory }) {
  check(
    typeof chapterIndex === 'string' && typeof executable === 'string' && typeof outputDirectory === 'string',
    'chapter index, ELF and new output directory required',
  );
  const bytes = fs.readFileSync(chapterIndex);
  check(bytes.length <= 16 * 1024 * 1024, 'Chapter index too large');
  const index = JSON.parse(bytes);
  check(
    index.schema === 'skylanders-chapter-catalog-v1' &&
      Array.isArray(index.results) &&
      index.results.length > 0 &&
      index.results.length <= 64,
    'Unsupported chapter index',
  );
  const candidates = index.results.filter((r) => r.status === 'structural-export-complete');
  check(
    candidates.length && new Set(candidates.map((r) => r.archive)).size === candidates.length,
    'No exports or duplicate archive names',
  );
  check(
    candidates.every(
      (r) =>
        /^level_\d{3}_[a-z0-9_]+\.bld$/.test(r.archive) &&
        r.inner?.path === 'level.bld' &&
        /^[a-f0-9]{64}$/.test(r.inner.sha256),
    ),
    'Invalid chapter input paths/hashes',
  );
  // Validate the exact ELF before creating a partial output directory.
  extractMetadata(executable);
  fs.mkdirSync(outputDirectory, { mode: 0o700 });
  const results = [],
    root = fs.realpathSync(path.dirname(chapterIndex));
  for (const chapter of candidates) {
    const name = path.basename(chapter.archive, '.bld'),
      directory = path.join(root, name);
    check(!fs.lstatSync(directory).isSymbolicLink(), 'Chapter directory cannot be a symlink');
    const output = path.join(outputDirectory, name + '.json');
    // Each large IGZ graph lives in an isolated child; chapter batches do not
    // retain gigabytes of prior object/reference maps in the parent heap.
    const child = spawnSync(
      process.execPath,
      [
        fileURLToPath(import.meta.url),
        '--source',
        path.join(directory, 'level.bld'),
        '--elf',
        executable,
        '--expect-sha256',
        chapter.inner.sha256,
        '--output',
        output,
      ],
      { encoding: 'utf8', timeout: 300000, maxBuffer: 1024 * 1024 },
    );
    check(!child.error && child.status === 0, child.error?.message ?? child.stderr);
    const result = JSON.parse(child.stdout);
    check(result.source.sha256 === chapter.inner.sha256, 'Lighting source provenance mismatch');
    results.push({ archive: chapter.archive, ...result });
    process.stderr.write(JSON.stringify({ archive: chapter.archive, counts: result.counts }) + '\n');
  }
  check(hash(fs.readFileSync(chapterIndex)) === hash(bytes), 'Chapter index changed during export');
  const result = {
    schema: 'skylanders-chapter-lighting-v1',
    chapterIndex: { path: path.resolve(chapterIndex), sha256: hash(bytes) },
    executableSha256: EXECUTABLE_SHA256,
    results,
    runtimeValidated: false,
  };
  fs.writeFileSync(path.join(outputDirectory, 'index.json'), JSON.stringify(result, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  return { index: path.resolve(outputDirectory, 'index.json'), exported: results.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2),
      options = {},
      flags = new Map([
        ['--source', 'source'],
        ['--elf', 'executable'],
        ['--expect-sha256', 'expectedSha256'],
        ['--output', 'output'],
        ['--chapter-index', 'chapterIndex'],
        ['--output-dir', 'outputDirectory'],
      ]);
    while (args.length) {
      const key = flags.get(args.shift());
      check(key && options[key] === undefined && args.length, 'Unknown/duplicate/missing option');
      options[key] = args.shift();
    }
    if (options.chapterIndex)
      check(
        !options.source && !options.output && !options.expectedSha256,
        'Chapter mode cannot combine with single-file options',
      );
    else check(!options.outputDirectory, '--output-dir requires --chapter-index');
    console.log(
      JSON.stringify(options.chapterIndex ? exportChapterLighting(options) : exportLighting(options)),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
