import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  createStoryRegistrationDraft,
  writeStoryRegistrationDraft,
  STORY_DRAFT_PROFILE as PROFILE,
} from '../tools/story_registration_draft.mjs';
import { createRegistryView } from '../tools/chapter_registry.mjs';
import { parseIgz } from '../tools/igz.mjs';
import { extractMetadata } from '../tools/elf_metadata.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');

test('story draft refuses unpinned, missing and unsupported requests before mutation', () => {
  assert.throws(() => createStoryRegistrationDraft({}), /Pinned initializer/);
  assert.throws(
    () =>
      createStoryRegistrationDraft({
        initializer: Buffer.alloc(10),
        expectedHashes: { initializer: PROFILE.initializer },
      }),
    /Pinned initializer/,
  );
  for (const key of ['deployable', 'overwrite', 'insertAt', 'titleHandle', 'sourcePatch'])
    assert.throws(() => createStoryRegistrationDraft({ [key]: true }), /Invalid story draft fields/);
  assert.throws(() => writeStoryRegistrationDraft({ deployable: true }), /Invalid story draft request/);
  assert.throws(() => writeStoryRegistrationDraft({ outputDirectory: 'unused' }), /ELF/);
});

test('profile pins inputs, not a caller-selected insertion or assumed title handle', () => {
  assert.equal(PROFILE.insertAt, 86);
  assert.equal(PROFILE.originalRows, 624);
  assert.equal(PROFILE.listEncoded, 61736);
  assert.equal(Object.hasOwn(PROFILE, 'titleHandle'), false);
  assert.ok(Object.isFrozen(PROFILE));
});

const files = {
  initializer: process.env.SKYLANDERS_TEST_INIT_SETUP,
  pairedGlobal: process.env.SKYLANDERS_TEST_PAIRED_GLOBAL,
  global: process.env.SKYLANDERS_TEST_GLOBAL ?? 'research/permanent_global/level.bld',
  bootstrap: process.env.SKYLANDERS_TEST_BOOTSTRAP ?? 'research/permanent_bootstrap/level.bld',
};
const executable = process.env.SKYLANDERS_TEST_ELF ?? 'extracted/CUSA00697/eboot.elf';
const real = Object.values(files).every((p) => p && fs.existsSync(p)) && fs.existsSync(executable);
function inputs() {
  const bytes = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, fs.readFileSync(p)]));
  return {
    ...bytes,
    expectedHashes: Object.fromEntries(Object.entries(bytes).map(([k, b]) => [k, hash(b)])),
    metadata: extractMetadata(executable),
  };
}
const objectAt = (z, encoded) => z.objectsByOffset.get(z.resolvePointer(encoded).offset);
function listSlots(z, o) {
  const p = z.pointerReferencesByOffset.get(o.offset + 32);
  return Array.from({ length: z.u32(o.offset + 12) }, (_, i) => p.targetOffset + i * 8);
}

test(
  'optional private draft independently resolves 19 includes and preserves binder rows/ownership',
  { skip: !real },
  () => {
    const options = inputs(),
      beforeHashes = Object.fromEntries(Object.keys(files).map((k) => [k, hash(options[k])])),
      r = createStoryRegistrationDraft(options);
    const before = parseIgz(options.initializer),
      next = parseIgz(r.buffer);
    const registry = createRegistryView({
      initializer: r.buffer,
      bootstrap: options.bootstrap,
      global: options.pairedGlobal,
      expectedHashes: {
        initializer: hash(r.buffer),
        bootstrap: options.expectedHashes.bootstrap,
        global: options.expectedHashes.pairedGlobal,
      },
      metadata: options.metadata,
    });
    assert.equal(registry.adventureOrder.length, 19);
    assert.equal(registry.adventureOrder.at(-1).row, 86);
    assert.equal(
      registry.adventureOrder.at(-1).references[0].resolution.target.name,
      r.manifest.pair.title.name,
    );
    assert.equal(registry.adventureOrder.at(-1).references[0].nameId, 3048);
    assert.equal(r.manifest.deployable, false);
    assert.equal(r.manifest.runtimeValidated, false);
    assert.equal(r.manifest.saveMigrationSupported, false);
    assert.equal(r.manifest.ownershipVerifiedAtRuntime, false);
    assert.equal(r.manifest.ownershipFieldsStaticallyCorroborated, true);
    assert.equal(r.manifest.pair.originalGlobalHandlesPreserved, 3022);
    const originalRows = listSlots(before, before.objects[648]).map((at) => before.u64(at));
    const rebuiltRows = listSlots(next, objectAt(next, PROFILE.listEncoded)).map((at) => next.u64(at));
    assert.equal(rebuiltRows.length, 625);
    assert.equal(rebuiltRows.splice(86, 1)[0], BigInt(r.manifest.insertion.opcodeEncoded));
    assert.deepEqual(rebuiltRows, originalRows);
    assert.deepEqual(
      r.manifest.scalarEdits.slice(-4).map((e) => [e.originalObjectIndex, e.before, e.after]),
      [
        [649, 623, 624],
        [651, 618, 619],
        [652, 292, 293],
        [757, 18, 19],
      ],
    );
    assert.deepEqual(
      r.manifest.expansionVillainIndices.map((e) => [e.before, e.after]),
      [
        [18, 19],
        [19, 20],
        [20, 21],
        [21, 22],
      ],
    );
    for (const [parameterId, rhsId, stackId, value] of [
      [1010, 1011, 1012, 18],
      [1016, 1017, 1018, 19],
      [1022, 1023, 1024, 20],
      [1031, 1032, 1033, 21],
    ]) {
      const parameter = objectAt(next, before.objects[parameterId].encoded);
      const newRhs =
        next.objects[next.pointerReferencesByOffset.get(parameter.offset + 96).targetObjectIndex];
      const newStack = next.objects[next.pointerReferencesByOffset.get(newRhs.offset + 16).targetObjectIndex];
      assert.equal(next.u32(newStack.offset + 64), value + 1);
      assert.equal(next.u32(objectAt(next, before.objects[stackId].encoded).offset + 64), value);
      for (const o of [newRhs, newStack]) {
        assert.equal(next.u32(o.offset + 8), 1);
        assert.equal(next.pointerReferences.filter((p) => p.targetObjectIndex === o.index).length, 1);
      }
      const oldRhs = objectAt(next, before.objects[rhsId].encoded);
      assert.equal(
        next.u32(oldRhs.offset + 8),
        next.pointerReferences.filter((p) => p.targetObjectIndex === oldRhs.index).length,
      );
    }
    assert.deepEqual(
      r.manifest.binding.rebuilt.map((d) => d.row),
      [5, 299, 310, 326, 349, 362, 393, 438, 495, 597],
    );
    for (const definition of r.manifest.binding.rebuilt) {
      const o = objectAt(next, definition.encoded);
      assert.equal(next.u32(o.offset + 64), 0);
      assert.equal(next.u64(o.offset + 72), 0n);
    }
    for (const encoded of [r.manifest.insertion.opcodeEncoded, r.manifest.insertion.groupStackEncoded]) {
      const o = objectAt(next, encoded);
      assert.equal(next.u32(o.offset + 8), 1);
      assert.equal(next.pointerReferences.filter((p) => p.targetObjectIndex === o.index).length, 1);
    }
    const lhs = objectAt(next, before.objects[757].encoded);
    assert.equal(next.u32(lhs.offset + 8), 19);
    assert.equal(next.pointerReferences.filter((p) => p.targetObjectIndex === lhs.index).length, 19);
    const group = objectAt(next, r.manifest.insertion.groupStackEncoded),
      entry = listSlots(next, group)[0];
    assert.equal(next.u64(group.offset + 40), 0x8000000000000009n);
    assert.equal(next.u64(entry), 0x8000000000000244n);
    for (const key of Object.keys(files)) assert.equal(hash(options[key]), beforeHashes[key]);
  },
);

test(
  'optional paired identity checks reject changed old handles and derive swapped appended title index',
  { skip: !real },
  () => {
    const options = inputs(),
      z = parseIgz(options.pairedGlobal),
      slots = listSlots(z, objectAt(z, z.offsetTables.get('ROOT').encodedOffsets[0]));
    const bad = Buffer.from(options.pairedGlobal);
    bad.writeBigUInt64LE(z.u64(slots[1]), slots[0]);
    assert.throws(
      () =>
        createStoryRegistrationDraft({
          ...options,
          pairedGlobal: bad,
          expectedHashes: { ...options.expectedHashes, pairedGlobal: hash(bad) },
        }),
      /ROOT handle changed/,
    );
    const swapped = Buffer.from(options.pairedGlobal);
    swapped.writeBigUInt64LE(z.u64(slots[3023]), slots[3022]);
    swapped.writeBigUInt64LE(z.u64(slots[3022]), slots[3023]);
    const r = createStoryRegistrationDraft({
      ...options,
      pairedGlobal: swapped,
      expectedHashes: { ...options.expectedHashes, pairedGlobal: hash(swapped) },
    });
    assert.equal(r.manifest.pair.title.nameId, 3049);
    assert.equal(r.manifest.insertion.externalHandle.nameId, 3049);
    assert.equal(r.manifest.independentRegistry.newTitle.name, r.manifest.pair.title.name);
    const changed = Buffer.from(options.initializer);
    changed.writeUInt32LE(17, parseIgz(changed).objects[757].offset + 8);
    assert.throws(
      () =>
        createStoryRegistrationDraft({
          ...options,
          initializer: changed,
          expectedHashes: { ...options.expectedHashes, initializer: hash(changed) },
        }),
      /Pinned initializer/,
    );
  },
);

test(
  'optional writer creates exclusive readback-verified outputs and cleans only its partial files',
  { skip: !real },
  (t) => {
    const options = inputs(),
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-registration-draft-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const request = {
      ...files,
      executable,
      expectedHashes: options.expectedHashes,
      outputDirectory: path.join(dir, 'complete'),
    };
    const r = writeStoryRegistrationDraft(request);
    assert.equal(r.storyIncludes, 19);
    for (const o of r.outputs) assert.equal(hash(fs.readFileSync(o.path)), o.sha256);
    assert.throws(() => writeStoryRegistrationDraft(request), /EEXIST/);
    const link = path.join(dir, 'linked-source');
    fs.symlinkSync(path.resolve(files.initializer), link);
    assert.throws(
      () =>
        writeStoryRegistrationDraft({
          ...request,
          initializer: link,
          outputDirectory: path.join(dir, 'symlink'),
        }),
      /ELOOP/,
    );
    const originalWrite = fs.writeFileSync,
      partial = path.join(dir, 'partial');
    let calls = 0;
    try {
      fs.writeFileSync = (...args) => {
        if (++calls === 2) {
          originalWrite(path.join(partial, 'foreign.txt'), 'keep', { flag: 'wx' });
          throw new Error('Injected manifest failure');
        }
        return originalWrite(...args);
      };
      assert.throws(
        () => writeStoryRegistrationDraft({ ...request, outputDirectory: partial }),
        /Injected manifest failure/,
      );
    } finally {
      fs.writeFileSync = originalWrite;
    }
    assert.deepEqual(fs.readdirSync(partial), ['foreign.txt']);
    assert.equal(fs.readFileSync(path.join(partial, 'foreign.txt'), 'utf8'), 'keep');
    for (const [key, filename] of Object.entries(files))
      assert.equal(hash(fs.readFileSync(filename)), options.expectedHashes[key]);
  },
);
