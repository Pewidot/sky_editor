import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCheckpoint, restoreCheckpoint } from '../tools/runtime_checkpoint.mjs';
import { createFigure } from '../tools/sky_figure.mjs';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-checkpoint-'));
  const session = path.join(root, 'session');
  fs.mkdirSync(path.join(session, 'user/home'), { recursive: true });
  fs.mkdirSync(path.join(session, 'figures'));
  fs.writeFileSync(path.join(session, 'user/home/save'), 'private save data');
  fs.writeFileSync(path.join(session, 'user/config.json'), '{}');
  fs.writeFileSync(path.join(session, 'figures/test.sky'), createFigure(16));
  const events = [
    { operation: 'launch', emulator: '/fake/emulator', game: '/fake/game', args: [] },
    {
      operation: 'insert-sent',
      slot: 0,
      writableCopy: path.join(session, 'figures/test.sky'),
      figureId: 16,
      variant: 0,
    },
    { operation: 'exit', code: 0 },
  ];
  fs.writeFileSync(
    path.join(session, 'portal-events.jsonl'),
    events.map((item) => JSON.stringify(item)).join('\n') + '\n',
  );
  return { root, session, checkpoint: path.join(root, 'checkpoint'), events };
}
test('stopped profile checkpoint verifies hashes and restores independent copies', () => {
  const f = fixture();
  const result = createCheckpoint(f.session, f.checkpoint);
  assert.equal(result.figures[0].path, 'figures/test.sky');
  const restored = path.join(f.root, 'restored');
  fs.mkdirSync(restored);
  const manifest = restoreCheckpoint(f.checkpoint, restored);
  assert.equal(manifest.figures[0].figureId, 16);
  assert.equal(fs.readFileSync(path.join(restored, 'user/home/save'), 'utf8'), 'private save data');
  fs.writeFileSync(path.join(restored, 'user/home/save'), 'new progress');
  assert.equal(fs.readFileSync(path.join(f.checkpoint, 'user/home/save'), 'utf8'), 'private save data');
  assert.throws(() => createCheckpoint(f.session, f.checkpoint), /must be new/);
  assert.throws(() => createCheckpoint(f.session, path.join(f.session, 'nested')), /outside/);
});
test('live source, symlinks, tampering and nonempty restore destinations reject', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.session, 'portal-events.jsonl'), JSON.stringify(f.events[0]) + '\n');
  assert.throws(() => createCheckpoint(f.session, f.checkpoint), /Stop/);
  fs.writeFileSync(path.join(f.session, 'portal-events.jsonl'), f.events.map(JSON.stringify).join('\n'));
  fs.symlinkSync('/etc/passwd', path.join(f.session, 'user/link'));
  assert.throws(() => createCheckpoint(f.session, f.checkpoint), /symlink/);
  fs.unlinkSync(path.join(f.session, 'user/link'));
  createCheckpoint(f.session, f.checkpoint);
  const destination = path.join(f.root, 'restore');
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(f.checkpoint, 'user/home/save'), 'corruption');
  assert.throws(() => restoreCheckpoint(f.checkpoint, destination), /hash mismatch/);
  assert.deepEqual(fs.readdirSync(destination), []);
});

test('checkpoint aliases cannot write back inside the source and restore refuses symlink destinations', () => {
  const f = fixture();
  const alias = path.join(f.root, 'session-alias');
  fs.symlinkSync(f.session, alias, 'dir');
  assert.throws(() => createCheckpoint(f.session, path.join(alias, 'nested')), /outside/);
  assert.equal(fs.existsSync(path.join(f.session, 'nested')), false);
  createCheckpoint(f.session, f.checkpoint);
  const outside = path.join(f.root, 'outside');
  fs.mkdirSync(outside);
  const destination = path.join(f.root, 'restore-link');
  fs.symlinkSync(outside, destination, 'dir');
  assert.throws(() => restoreCheckpoint(f.checkpoint, destination), /symlink/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('restore rejects figure identity mismatches, duplicate serials and path traversal before writing', () => {
  const f = fixture();
  createCheckpoint(f.session, f.checkpoint);
  const manifestPath = path.join(f.checkpoint, 'checkpoint.json');
  const original = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const destination = path.join(f.root, 'restore');
  fs.mkdirSync(destination);
  for (const mutate of [
    (manifest) => {
      manifest.figures[0].figureId = 476;
    },
    (manifest) => {
      manifest.figures.push({ ...manifest.figures[0], slot: 1 });
    },
    (manifest) => {
      manifest.figures[0].path = 'figures/../../outside';
    },
    (manifest) => {
      manifest.files[0].path = '/external/file';
    },
    (manifest) => {
      manifest.files[0].path = 'user/../external';
    },
  ]) {
    const manifest = structuredClone(original);
    mutate(manifest);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => restoreCheckpoint(f.checkpoint, destination), /checkpoint|Checkpoint/);
    assert.deepEqual(fs.readdirSync(destination), []);
  }
});
