#!/usr/bin/env node
// Portable saved-profile checkpoint, NOT an emulator RAM/save-state snapshot.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspectFigure } from './sky_figure.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (ok, text) => {
  if (!ok) throw new Error(text);
};
function collect(root, names = ['user', 'figures']) {
  const files = [];
  let total = 0,
    entries = 0;
  function visit(relative, depth = 0) {
    fail(++entries <= 20000 && depth <= 64, 'Checkpoint exceeds entry/depth limit');
    safeRelative(relative.split(path.sep).join('/'));
    const full = path.join(root, relative),
      stat = fs.lstatSync(full);
    fail(!stat.isSymbolicLink(), `Checkpoint refuses symlink: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) {
        if (relative === 'user' && name === 'log') continue;
        visit(path.join(relative, name), depth + 1);
      }
    } else {
      fail(
        stat.isFile() && stat.size <= 128 * 1024 * 1024,
        'Checkpoint member must be a regular file <=128 MiB',
      );
      total += stat.size;
      fail(total <= 512 * 1024 * 1024, 'Checkpoint exceeds 512 MiB');
      const data = fs.readFileSync(full);
      files.push({ path: relative.split(path.sep).join('/'), sha256: hash(data), size: data.length, data });
    }
  }
  for (const name of names) if (fs.existsSync(path.join(root, name))) visit(name);
  return files;
}
function safeRelative(relative) {
  fail(
    typeof relative === 'string' &&
      !/[\\\r\n\0]/.test(relative) &&
      !path.posix.isAbsolute(relative) &&
      !path.win32.isAbsolute(relative) &&
      ['user', 'figures'].includes(relative.split('/')[0]) &&
      relative.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Invalid checkpoint relative path',
  );
}
function figureIdentity(file, recorded) {
  fail(file && file.size === 1024, 'Invalid checkpoint figure file');
  const identity = inspectFigure(file.data);
  for (const key of ['figureId', 'variant', 'serial']) {
    if (recorded[key] !== undefined)
      fail(recorded[key] === identity[key], `Checkpoint figure ${key} does not match its file`);
  }
  return identity;
}
function writeFiles(output, files) {
  for (const file of files) {
    const target = path.join(output, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, file.data, { flag: 'wx', mode: 0o600 });
  }
}
export function createCheckpoint(source, output, slotState) {
  source = fs.realpathSync(source);
  output = path.resolve(output);
  // Resolve an existing parent as well as the source so a symlink alias cannot
  // accidentally put a checkpoint back inside the original session.
  output = path.join(fs.realpathSync(path.dirname(output)), path.basename(output));
  fail(
    !output.startsWith(source + path.sep) && output !== source,
    'Checkpoint must be outside the running session tree',
  );
  fail(!fs.existsSync(output), 'Checkpoint destination must be new');
  const events = fs
    .readFileSync(path.join(source, 'portal-events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  fail(
    events.at(-1)?.operation === 'exit',
    'Stop the owned emulator before checkpointing; live saves may be inconsistent',
  );
  const launch = events.find((event) => event.operation === 'launch');
  fail(launch, 'Missing recorded launch');
  const slots = slotState ?? Array(16).fill(null);
  fail(Array.isArray(slots) && slots.length <= 16, 'Invalid checkpoint slot state');
  if (!slotState)
    for (const event of events) {
      if (['insert-sent', 'remove-sent'].includes(event.operation)) {
        fail(
          Number.isInteger(event.slot) && event.slot >= 0 && event.slot < 16,
          'Invalid checkpoint event slot',
        );
        slots[event.slot] = event.operation === 'insert-sent' ? event : null;
      }
    }
  const files = collect(source);
  const records = files.map(({ data, ...file }) => file);
  const serials = new Set();
  const figures = slots.flatMap((entry, slot) => {
    if (!entry) return [];
    const relative = path.relative(source, entry.writableCopy).split(path.sep).join('/');
    fail(
      relative.startsWith('figures/') &&
        !relative.includes('..') &&
        records.some((file) => file.path === relative),
      'Slot file is outside the managed checkpoint',
    );
    const identity = figureIdentity(
      files.find((file) => file.path === relative),
      entry,
    );
    fail(!serials.has(identity.serial), 'Duplicate checkpoint figure serial');
    serials.add(identity.serial);
    return [{ slot, path: relative, ...identity }];
  });
  const manifest = {
    format: 'skylanders-runtime-checkpoint-v1',
    createdAt: new Date().toISOString(),
    sourceSession: source,
    emulator: launch.emulator,
    game: launch.game,
    launchArguments: launch.args,
    figures,
    files: records,
    limitation:
      'Saved-game/profile checkpoint only, not an emulator memory state. Resume starts the game and uses its stored progress; exact mid-frame state is not preserved.',
  };
  fs.mkdirSync(output, { mode: 0o700 });
  writeFiles(output, files);
  fs.writeFileSync(path.join(output, 'checkpoint.json'), JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  return { path: output, ...manifest };
}
export function restoreCheckpoint(checkpoint, destination) {
  checkpoint = fs.realpathSync(checkpoint);
  const destinationStat = fs.lstatSync(destination);
  fail(
    destinationStat.isDirectory() && !destinationStat.isSymbolicLink(),
    'Restore destination must be a real directory, not a symlink',
  );
  destination = fs.realpathSync(destination);
  fail(
    destination !== checkpoint && !destination.startsWith(checkpoint + path.sep),
    'Restore destination must be outside the checkpoint',
  );
  const manifestPath = path.join(checkpoint, 'checkpoint.json');
  const manifestStat = fs.lstatSync(manifestPath);
  fail(
    manifestStat.isFile() && !manifestStat.isSymbolicLink() && manifestStat.size <= 8 * 1024 * 1024,
    'Checkpoint manifest must be a regular file <=8 MiB',
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fail(
    manifest.format === 'skylanders-runtime-checkpoint-v1' &&
      Array.isArray(manifest.files) &&
      Array.isArray(manifest.figures),
    'Invalid checkpoint',
  );
  const files = collect(checkpoint);
  fail(files.length === manifest.files.length, 'Checkpoint file inventory changed');
  const expectedFiles = new Map();
  for (const entry of manifest.files) {
    safeRelative(entry.path);
    fail(!expectedFiles.has(entry.path), 'Duplicate checkpoint inventory path');
    expectedFiles.set(entry.path, entry);
  }
  for (const file of files) {
    const expected = expectedFiles.get(file.path);
    fail(
      expected?.sha256 === file.sha256 && expected.size === file.size,
      `Checkpoint hash mismatch: ${file.path}`,
    );
  }
  fail(manifest.figures.length <= 16, 'Too many checkpoint figures');
  const seen = new Set(),
    serials = new Set();
  for (const figure of manifest.figures) {
    fail(
      Number.isInteger(figure.slot) && figure.slot >= 0 && figure.slot < 16 && !seen.has(figure.slot),
      'Invalid checkpoint slot',
    );
    seen.add(figure.slot);
    fail(
      typeof figure.path === 'string' &&
        figure.path.startsWith('figures/') &&
        files.some((file) => file.path === figure.path && file.size === 1024),
      'Invalid checkpoint figure file',
    );
    const identity = figureIdentity(
      files.find((file) => file.path === figure.path),
      figure,
    );
    fail(!serials.has(identity.serial), 'Duplicate checkpoint figure serial');
    serials.add(identity.serial);
    Object.assign(figure, identity);
  }
  fail(fs.readdirSync(destination).length === 0, 'Restore destination must be empty');
  writeFiles(destination, files);
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    fail(
      process.argv.length === 4,
      'Usage: node tools/runtime_checkpoint.mjs <stopped-session> <new-checkpoint-directory>',
    );
    const result = createCheckpoint(process.argv[2], process.argv[3]);
    console.log(
      JSON.stringify(
        {
          path: result.path,
          files: result.files.length,
          figures: result.figures,
          limitation: result.limitation,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
