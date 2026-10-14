import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'extracted/CUSA00697/item/sky_systems_levelswitch.bld');
const output = path.join(root, 'research/archive_roundtrip/sky_systems_levelswitch.roundtrip.bld');
const replacement = path.join(root, 'research/sky_systems_levelswitch/level.bld');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('real PS4 level-switch archive: all 11 members survive no-op replacement byte-for-byte', async (context) => {
  for (const required of [
    source,
    output,
    `${output}.manifest.json`,
    replacement,
    path.join(root, 'tools/iga_extract'),
  ]) {
    try {
      await access(required);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      context.skip(
        'Optional local game/research fixture or built extractor is unavailable in this source checkout',
      );
      return;
    }
  }
  const originalBytes = await readFile(source);
  const changedBytes = await readFile(output);
  const manifest = JSON.parse(await readFile(`${output}.manifest.json`, 'utf8'));
  assert.equal(sha256(originalBytes), manifest.source.sha256);
  assert.equal(sha256(changedBytes), manifest.output.sha256);
  assert.equal(sha256(await readFile(replacement)), manifest.replacement.sha256);
  const ranges = manifest.changes.map((change) => [change.offset, change.offset + 4]);
  let differingBytes = 0;
  for (let offset = 0; offset < originalBytes.length; offset += 1) {
    if (changedBytes[offset] === originalBytes[offset]) continue;
    differingBytes += 1;
    assert.ok(
      ranges.some(([start, end]) => offset >= start && offset < end),
      `Unexpected source prefix change at ${offset}`,
    );
  }
  const temp = await mkdtemp(path.join(os.tmpdir(), 'iga-real-roundtrip-'));
  const { stdout } = await run(process.execPath, [
    path.join(root, 'tools/iga_inspect.mjs'),
    source,
    '--json',
  ]);
  const inventory = JSON.parse(stdout);
  assert.equal(inventory.numberOfFiles, 11);
  const { stdout: outputInventory } = await run(process.execPath, [
    path.join(root, 'tools/iga_inspect.mjs'),
    output,
    '--json',
  ]);
  const rebuilt = JSON.parse(outputInventory);
  assert.equal(rebuilt.numberOfFiles, inventory.numberOfFiles);
  for (const entry of inventory.entries) {
    const originalMember = path.join(temp, `original-${entry.index}`);
    const rebuiltMember = path.join(temp, `rebuilt-${entry.index}`);
    await Promise.all([
      run(path.join(root, 'tools/iga_extract'), [source, String(entry.index), originalMember]),
      run(path.join(root, 'tools/iga_extract'), [output, String(entry.index), rebuiltMember]),
    ]);
    const [original, changed] = await Promise.all([readFile(originalMember), readFile(rebuiltMember)]);
    assert.deepEqual(changed, original, `Member ${entry.index} (${entry.path}) changed`);
    if (entry.index === manifest.member.index) {
      assert.deepEqual(changed, await readFile(replacement));
    } else {
      assert.deepEqual(rebuilt.entries[entry.index], entry, `Descriptor ${entry.index} changed`);
    }
    context.diagnostic(`${entry.index} ${entry.path}: ${changed.length} bytes, SHA-256 ${sha256(changed)}`);
  }
  assert.deepEqual(await readFile(source), originalBytes);
  context.diagnostic(
    `Original prefix changed in ${differingBytes} bytes, all inside declared descriptor fields.`,
  );
  context.diagnostic(`Independent extractor outputs retained at ${temp}`);
});
