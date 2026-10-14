import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { globalHandleLocation, createRegistryView } from '../tools/chapter_registry.mjs';
import { extractMetadata } from '../tools/elf_metadata.mjs';
const namespace = 0x2694be8e;
test('global handle mapping derives the bootstrap offset, never guesses a fixed 26', () => {
  assert.deepEqual(globalHandleLocation(1, namespace, 25, 3022), {
    status: 'located',
    source: 'bootstrap',
    rootIndex: 0,
  });
  assert.deepEqual(globalHandleLocation(25, namespace, 25, 3022), {
    status: 'located',
    source: 'bootstrap',
    rootIndex: 24,
  });
  assert.deepEqual(globalHandleLocation(26, namespace, 25, 3022), {
    status: 'located',
    source: 'global',
    rootIndex: 0,
  });
  assert.deepEqual(globalHandleLocation(1945, namespace, 25, 3022), {
    status: 'located',
    source: 'global',
    rootIndex: 1919,
  });
  assert.deepEqual(globalHandleLocation(1945, namespace, 50, 3022), {
    status: 'located',
    source: 'global',
    rootIndex: 1894,
  });
  assert.deepEqual(globalHandleLocation(1, namespace, 0, 1), {
    status: 'located',
    source: 'global',
    rootIndex: 0,
  });
  assert.equal(globalHandleLocation(3048, namespace, 25, 3022).status, 'unresolved-root-index');
  assert.equal(globalHandleLocation(0, namespace, 25, 3022).status, 'unresolved-null-or-cycle');
  assert.equal(globalHandleLocation(1945, 1, 25, 3022).status, 'unresolved-other-namespace');
});
test('invalid numbers and missing native metadata fail closed', () => {
  for (const n of [-1, NaN, Infinity, 2 ** 32, 1.1, '1'])
    assert.throws(() => globalHandleLocation(n, namespace, 25, 3022), /unsigned/);
  assert.throws(() => createRegistryView({}), /executable/);
});
const files = {
  bootstrap: 'research/permanent_bootstrap/level.bld',
  global: 'research/permanent_global/level.bld',
  initializer: 'research/init_setup/level.bld',
};
const executable = 'extracted/CUSA00697/eboot.elf';
test(
  'local source-bound registry resolves chapter handles, operations and order statements',
  {
    skip: ![...Object.values(files), executable].every((f) => fs.existsSync(f)),
  },
  () => {
    const inputs = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.readFileSync(f)]));
    const expectedHashes = Object.fromEntries(
      Object.entries(inputs).map(([k, b]) => [k, createHash('sha256').update(b).digest('hex')]),
    );
    const metadata = extractMetadata(executable),
      options = { ...inputs, expectedHashes, metadata };
    const r = createRegistryView(options);
    assert.equal(r.registration.bootstrapRootCount, 25);
    assert.equal(r.registration.globalFirstNameId, 26);
    assert.equal(r.globalHandles.length, 3047);
    assert.equal(r.statements.length, 624);
    assert.equal(
      r.externalReferences.filter((x) => x.resolution.status === 'resolved-static-native-registration')
        .length,
      521,
    );
    assert.equal(r.externalReferences[36].resolution.target.name, 'Level_AdventureTitles');
    assert.equal(r.adventureOrder.length, 18);
    assert.ok(r.adventureOrder.every((x) => x.operation.name === 'include'));
    const first = r.adventureOrder[0];
    assert.equal(first.row, 50);
    assert.equal(first.references[0].resolution.target.name, 'Level_313_Tutorial(1)');
    assert.equal(r.adventureOrder[2].references[0].resolution.target.name, 'Level_316_PirateFortress(1)');
    assert.equal(r.titleSets.length, 2);
    assert.equal(r.runtimeValidated, false);
    assert.equal(r.chapterInsertionSupported, false);
    assert.throws(
      () =>
        createRegistryView({
          ...options,
          expectedHashes: { ...expectedHashes, initializer: '0'.repeat(64) },
        }),
      /SHA-256/,
    );
    assert.throws(
      () => createRegistryView({ ...options, metadata: { ...metadata, enums: [] } }),
      /membership/,
    );
  },
);
