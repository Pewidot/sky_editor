#!/usr/bin/env node
// Construct a clearly labelled, never-run derived checkpoint. No emulator calls,
// event fabrication, configurable save paths, or writes to the source checkpoint.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { restoreCheckpoint } from './runtime_checkpoint.mjs';
import { inspectSaveBuffer } from './save_inspect.mjs';

export const SLOT_PATH = 'user/home/1000/savedata/CUSA00697/SAVEDATA00/Save_Slot_1';
export const HEADER_PATH = 'user/home/1000/savedata/CUSA00697/SAVEDATA00/Save_Header';
const fail = (ok, message) => {
  if (!ok) throw new Error(message);
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function readBounded(filename, maximum) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    fail(before.isFile() && before.size <= maximum, 'Expected bounded regular non-symlink file');
    const bytes = Buffer.alloc(before.size);
    let at = 0;
    while (at < bytes.length) {
      const n = fs.readSync(fd, bytes, at, Math.min(bytes.length - at, 1024 * 1024), at);
      fail(n > 0, 'Input ended early');
      at += n;
    }
    const after = fs.fstatSync(fd),
      current = fs.lstatSync(filename);
    fail(
      before.dev === current.dev &&
        before.ino === current.ino &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs,
      'Input changed while reading',
    );
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
function relativePath(value) {
  fail(
    typeof value === 'string' &&
      !/[\\\r\n\0:]/.test(value) &&
      ['user', 'figures'].includes(value.split('/')[0]) &&
      value.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Invalid checkpoint inventory path',
  );
}
function verifySource(root, manifestBytes, manifest) {
  fail(
    sha(readBounded(path.join(root, 'checkpoint.json'), 8 * 1024 * 1024)) === sha(manifestBytes),
    'Source checkpoint manifest changed',
  );
  fail(
    manifest.format === 'skylanders-runtime-checkpoint-v1' &&
      Array.isArray(manifest.files) &&
      manifest.files.length <= 20000 &&
      Array.isArray(manifest.figures),
    'Invalid checkpoint manifest',
  );
  const expected = new Map();
  let total = 0,
    count = 0,
    filesSeen = 0;
  for (const file of manifest.files) {
    relativePath(file.path);
    fail(!expected.has(file.path), 'Duplicate checkpoint inventory path');
    fail(
      validHash(file.sha256) &&
        Number.isSafeInteger(file.size) &&
        file.size >= 0 &&
        file.size <= 128 * 1024 * 1024,
      'Invalid checkpoint file record',
    );
    total += file.size;
    fail(total <= 512 * 1024 * 1024, 'Checkpoint exceeds 512 MiB');
    expected.set(file.path, file);
  }
  function visit(relative, depth = 0) {
    fail(++count <= 20000 && depth <= 64, 'Checkpoint exceeds entry/depth limit');
    const full = path.join(root, relative),
      stat = fs.lstatSync(full);
    fail(!stat.isSymbolicLink(), `Checkpoint refuses symlink: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full)) visit(relative ? relative + '/' + name : name, depth + 1);
    } else {
      fail(stat.isFile(), 'Checkpoint refuses non-regular members');
      if (relative === 'checkpoint.json') return;
      relativePath(relative);
      const record = expected.get(relative);
      fail(
        record && stat.size === record.size && sha(readBounded(full, 128 * 1024 * 1024)) === record.sha256,
        `Source checkpoint inventory/hash mismatch: ${relative}`,
      );
      filesSeen++;
    }
  }
  visit('');
  fail(filesSeen === expected.size, 'Source checkpoint file inventory changed');
  return expected;
}

export function deriveSlotCheckpoint({
  sourceCheckpoint,
  candidate,
  expectedCandidateSha256,
  outputDirectory,
  expectedCheckpointSha256,
}) {
  fail(
    typeof sourceCheckpoint === 'string' &&
      typeof candidate === 'string' &&
      typeof outputDirectory === 'string',
    'Explicit source checkpoint, candidate and new output directory required',
  );
  fail(validHash(expectedCandidateSha256), 'Explicit expectedCandidateSha256 is required');
  const sourceStat = fs.lstatSync(sourceCheckpoint);
  fail(
    sourceStat.isDirectory() && !sourceStat.isSymbolicLink(),
    'Source checkpoint must be a real directory, not a symlink',
  );
  sourceCheckpoint = fs.realpathSync(sourceCheckpoint);
  candidate = path.resolve(candidate);
  const candidateBytes = readBounded(candidate, 1004),
    candidateHash = sha(candidateBytes);
  fail(candidateHash === expectedCandidateSha256, 'Candidate SHA-256 mismatch');
  fail(
    candidateBytes.length === 1004 && inspectSaveBuffer(candidateBytes).checksum.valid,
    'Candidate requires exactly 1004 bytes with valid little-endian FNV-1a',
  );
  const manifestBytes = readBounded(path.join(sourceCheckpoint, 'checkpoint.json'), 8 * 1024 * 1024);
  const sourceManifestHash = sha(manifestBytes),
    original = JSON.parse(manifestBytes.toString('utf8'));
  if (expectedCheckpointSha256 !== undefined)
    fail(
      validHash(expectedCheckpointSha256) && sourceManifestHash === expectedCheckpointSha256,
      'Source checkpoint manifest SHA-256 mismatch',
    );
  const sourceFiles = verifySource(sourceCheckpoint, manifestBytes, original);
  fail(
    sourceFiles.get(SLOT_PATH)?.size === 1004 && sourceFiles.get(HEADER_PATH)?.size === 380,
    'Source must contain exact CUSA00697 slot 1 and PS4 header',
  );
  fail(
    inspectSaveBuffer(readBounded(path.join(sourceCheckpoint, SLOT_PATH), 1004)).checksum.valid &&
      inspectSaveBuffer(readBounded(path.join(sourceCheckpoint, HEADER_PATH), 380)).checksum.valid,
    'Source slot/header must have valid PS4 checksums',
  );
  fail(sourceFiles.get(SLOT_PATH).sha256 !== candidateHash, 'Candidate would not change slot 1');
  outputDirectory = path.resolve(outputDirectory);
  const outputParent = fs.realpathSync(path.dirname(outputDirectory));
  outputDirectory = path.join(outputParent, path.basename(outputDirectory));
  fail(
    outputDirectory !== sourceCheckpoint && !outputDirectory.startsWith(sourceCheckpoint + path.sep),
    'Derived checkpoint must be outside the source checkpoint',
  );
  // mkdir is exclusive even for dangling symlinks. Nothing from an existing tree
  // is overwritten; any incomplete directory on failure is left for inspection.
  fs.mkdirSync(outputDirectory, { mode: 0o700 });
  const restoredOriginal = restoreCheckpoint(sourceCheckpoint, outputDirectory);
  fail(
    sha(readBounded(path.join(sourceCheckpoint, 'checkpoint.json'), 8 * 1024 * 1024)) === sourceManifestHash,
    'Source manifest changed during restore',
  );
  for (const file of original.files) {
    const copy = path.join(outputDirectory, file.path),
      origin = path.join(sourceCheckpoint, file.path);
    const a = fs.lstatSync(copy),
      b = fs.lstatSync(origin);
    fail(
      a.isFile() && !a.isSymbolicLink() && !(a.dev === b.dev && a.ino === b.ino),
      'Restored files must be independent regular copies',
    );
    fail(
      a.size === file.size && sha(readBounded(copy, 128 * 1024 * 1024)) === file.sha256,
      'Restored source file hash mismatch',
    );
  }
  // Replace only the independently restored destination inode we just verified.
  // Truncation cannot escape through a final-component symlink; hardlinks were
  // rejected above. Original checkpoint files are never opened for writing.
  const target = path.join(outputDirectory, SLOT_PATH),
    beforeTarget = fs.lstatSync(target);
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    fail(
      opened.isFile() &&
        opened.nlink === 1 &&
        opened.dev === beforeTarget.dev &&
        opened.ino === beforeTarget.ino,
      'Destination slot changed before replacement',
    );
    let at = 0;
    while (at < candidateBytes.length) {
      const n = fs.writeSync(fd, candidateBytes, at, candidateBytes.length - at, at);
      fail(n > 0, 'Candidate write made no progress');
      at += n;
    }
    fs.ftruncateSync(fd, candidateBytes.length);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const records = original.files.map((file) => {
    const bytes = readBounded(path.join(outputDirectory, file.path), 128 * 1024 * 1024);
    const record = { path: file.path, size: bytes.length, sha256: sha(bytes) };
    fail(
      record.size === file.size && record.sha256 === (file.path === SLOT_PATH ? candidateHash : file.sha256),
      'Unexpected derived checkpoint byte change',
    );
    return record;
  });
  verifySource(sourceCheckpoint, manifestBytes, original);
  fail(sha(readBounded(candidate, 1004)) === candidateHash, 'Candidate changed during derivation');
  const manifest = {
    format: 'skylanders-runtime-checkpoint-v1',
    createdAt: new Date().toISOString(),
    sourceSession: null,
    emulator: original.emulator,
    game: original.game,
    launchArguments: original.launchArguments,
    figures: restoredOriginal.figures,
    files: records,
    runtimeValidated: false,
    derivedFrom: {
      path: sourceCheckpoint,
      manifestSha256: sourceManifestHash,
      createdAt: original.createdAt,
      sourceSession: original.sourceSession ?? null,
    },
    experiment: {
      kind: 'explicit-CUSA00697-slot1-candidate',
      runtimeValidated: false,
      emulatorLaunched: false,
      headerConverted: false,
      candidatePath: candidate,
      candidateSha256: candidateHash,
      candidateChecksum: inspectSaveBuffer(candidateBytes).checksum,
      changedFiles: [
        {
          path: SLOT_PATH,
          size: 1004,
          previousSha256: sourceFiles.get(SLOT_PATH).sha256,
          sha256: candidateHash,
        },
      ],
      unchangedFileCount: records.length - 1,
      preservedHeaderSha256: sourceFiles.get(HEADER_PATH).sha256,
      inheritedMetadata:
        'Emulator/game/arguments and figure state are copied from the source checkpoint; this derived profile has never been launched.',
    },
    limitation:
      'Experimental derived saved-profile checkpoint, NOT an emulator memory state. Exactly slot 1 was replaced; compatibility, chapter availability and tutorial skipping are unproven.',
  };
  fs.writeFileSync(path.join(outputDirectory, 'checkpoint.json'), JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  const validation = fs.mkdtempSync(path.join(outputParent, '.checkpoint-validation-'));
  try {
    const verified = restoreCheckpoint(outputDirectory, validation);
    fail(
      JSON.stringify(verified.files) === JSON.stringify(records),
      'Derived checkpoint restore inventory mismatch',
    );
    verifySource(sourceCheckpoint, manifestBytes, original);
  } finally {
    // Only our exclusively created verification copy is removed, never either
    // checkpoint, the candidate, or any pre-existing destination.
    fs.rmSync(validation, { recursive: true, force: true });
  }
  return {
    path: outputDirectory,
    manifestSha256: sha(readBounded(path.join(outputDirectory, 'checkpoint.json'), 8 * 1024 * 1024)),
    ...manifest,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2),
      options = {},
      flags = new Map([
        ['--source-checkpoint', 'sourceCheckpoint'],
        ['--candidate', 'candidate'],
        ['--expect-candidate-sha256', 'expectedCandidateSha256'],
        ['--output-dir', 'outputDirectory'],
        ['--expect-checkpoint-sha256', 'expectedCheckpointSha256'],
      ]);
    while (args.length) {
      const field = flags.get(args.shift());
      fail(field && options[field] === undefined && args.length, 'Unknown, duplicate or missing argument');
      options[field] = args.shift();
    }
    console.log(JSON.stringify(deriveSlotCheckpoint(options), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}
