import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { appendIgz, inspectAppendTarget } from '../tools/igz_append.mjs';
import { parseIgz } from '../tools/igz.mjs';

const source = process.env.SKYLANDERS_TEST_LEVEL;
const globalSource = process.env.SKYLANDERS_TEST_GLOBAL;
const initializerSource = process.env.SKYLANDERS_TEST_INITIALIZER;
const hash = (b) => createHash('sha256').update(b).digest('hex');

// Explicit opt-in only. No game assets or generated outputs belong in source
// releases. The new empty list is a structural probe, NOT a gameplay actor.
test(
  'real IGZ structural append reparses and preserves every original pool-relative identity',
  { skip: !source },
  () => {
    const beforeStat = fs.statSync(source),
      input = fs.readFileSync(source),
      expectedSha256 = hash(input);
    if (process.env.SKYLANDERS_TEST_LEVEL_SHA256)
      assert.equal(expectedSha256, process.env.SKYLANDERS_TEST_LEVEL_SHA256);
    const target = inspectAppendTarget(input, expectedSha256),
      type = target.types.find((t) => t.type === 'igObjectList');
    assert.equal(type.size, 0x28);
    const appendedDefaultPool = Buffer.alloc(type.size);
    appendedDefaultPool.writeUInt32LE(type.typeIndex);
    const { buffer, manifest } = appendIgz(input, {
      expectedSha256,
      appendedDefaultPool,
      appendedObjects: [{ offset: 0, type: type.type }],
      newStrings: ['StructuralAppend_TestOnly_NotAGameplayActor'],
      rootList: { rootEncoded: target.roots[0], appendObjects: [0] },
    });
    const original = parseIgz(input),
      result = parseIgz(buffer);
    assert.equal(result.objects.length, original.objects.length + 1);
    assert.equal(manifest.rootList.count, manifest.rootList.previousCount + 1);
    assert.equal(
      manifest.originalObjectIndicesShifted,
      original.objects.filter((o) => o.section !== 1).length,
    );
    assert.equal(result.strings.length, original.strings.length + 1);
    assert.equal(hash(input), expectedSha256);
    assert.equal(hash(fs.readFileSync(source)), expectedSha256);
    assert.equal(fs.statSync(source).mtimeMs, beforeStat.mtimeMs);
    console.log(
      JSON.stringify({
        sourceSha256: expectedSha256,
        outputSha256: manifest.output.sha256,
        sourceBytes: input.length,
        outputBytes: buffer.length,
        beforeObjects: original.objects.length,
        afterObjects: result.objects.length,
        defaultAppendOffset: target.appendOffset,
        originalIndicesShifted: manifest.originalObjectIndicesShifted,
        beforeRoots: manifest.rootList.previousCount,
        afterRoots: manifest.rootList.count,
        changedFixups: manifest.fixups,
        runtimeValidated: false,
        outputWritten: false,
      }),
    );
  },
);

test(
  'real global chapter-list growth is memory-only and preserves every original ROOT handle position',
  { skip: !globalSource },
  () => {
    const stat = fs.statSync(globalSource),
      input = fs.readFileSync(globalSource),
      expectedSha256 = hash(input);
    assert.equal(expectedSha256, 'c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c');
    const z = parseIgz(input),
      target = inspectAppendTarget(input, expectedSha256),
      type = target.types.find((t) => t.type === 'StringInfo');
    assert.equal(type.size, 0x48);
    const lists = ['Level_AdventureTitles', 'Level_Loads'].map((name) => {
      const sets = z.objects.filter(
        (o) => o.type === 'ScriptSet' && z.stringReferencesByOffset.get(o.offset + 16)?.value === name,
      );
      assert.equal(sets.length, 1);
      const list = z.objects[z.pointerReferencesByOffset.get(sets[0].offset + 0x30).targetObjectIndex];
      assert.equal(list.type, 'ScriptSetList');
      assert.equal(list.size, 0x38);
      assert.equal(z.u32(list.offset + 0xc), 22);
      return list;
    });
    for (const growRoot of [false, true]) {
      // These deliberately empty StringInfo records are structural probes only;
      // they have no asserted localization, resource-load or gameplay meaning.
      const payload = Buffer.alloc(type.size * 2);
      for (let i = 0; i < 2; i++) {
        payload.writeUInt32LE(type.typeIndex, i * type.size);
        payload.writeUInt32LE(target.stringCount + i, i * type.size + 16);
      }
      const result = appendIgz(input, {
        expectedSha256,
        appendedDefaultPool: payload,
        appendedObjects: [0, type.size].map((offset) => ({ offset, type: 'StringInfo' })),
        fixupSlots: { RSTT: [16, type.size + 16] },
        newStrings: [
          'StructuralChapterTitle_NotAPlayableChapter',
          'StructuralChapterLoad_NotAPlayableChapter',
        ],
        objectLists: lists.map((l, i) => ({
          listEncoded: l.encoded,
          expectedType: 'ScriptSetList',
          appendObjects: [i * type.size],
        })),
        ...(growRoot ? { rootList: { rootEncoded: target.roots[0], appendObjects: [0, type.size] } } : {}),
      });
      const rebuilt = parseIgz(result.buffer),
        oldRoot = z.objects[0],
        newRoot = rebuilt.objects[0];
      const oldCount = z.u32(oldRoot.offset + 0xc),
        newCount = rebuilt.u32(newRoot.offset + 0xc);
      assert.equal(oldCount, 3022);
      assert.equal(newCount, oldCount + (growRoot ? 2 : 0));
      const oldData = z.pointerReferencesByOffset.get(oldRoot.offset + 0x20),
        newData = rebuilt.pointerReferencesByOffset.get(newRoot.offset + 0x20);
      for (let i = 0; i < oldCount; i++)
        assert.equal(rebuilt.u64(newData.targetOffset + i * 8), z.u64(oldData.targetOffset + i * 8));
      for (const old of lists) {
        const next = rebuilt.objectsByOffset.get(rebuilt.resolvePointer(old.encoded).offset);
        assert.equal(rebuilt.u32(next.offset + 0xc), 23);
        assert.equal(rebuilt.u32(next.offset + 0x10), 23);
        assert.equal(rebuilt.u32(next.offset + 0x18), 23 * 8);
        assert.equal(rebuilt.u64(next.offset + 0x28), z.u64(old.offset + 0x28));
        const oldArray = z.pointerReferencesByOffset.get(old.offset + 0x20),
          nextArray = rebuilt.pointerReferencesByOffset.get(next.offset + 0x20);
        assert.deepEqual(
          rebuilt.buffer.subarray(nextArray.targetOffset, nextArray.targetOffset + 22 * 8),
          input.subarray(oldArray.targetOffset, oldArray.targetOffset + 22 * 8),
        );
      }
      assert.deepEqual(rebuilt.strings.slice(0, z.strings.length), z.strings);
      assert.deepEqual(
        [...rebuilt.offsetTables.get('RNEX').encodedOffsets],
        [...z.offsetTables.get('RNEX').encodedOffsets],
      );
      console.log(
        JSON.stringify({
          probe: 'two-global-ScriptSetLists',
          rootGrowthRequested: growRoot,
          sourceSha256: expectedSha256,
          outputSha256: result.manifest.output.sha256,
          previousGlobalRootCount: oldCount,
          globalRootCount: newCount,
          originalRootPositionsPreserved: true,
          listCounts: result.manifest.objectLists.map((l) => [l.previousCount, l.count]),
          runtimeValidated: false,
          outputWritten: false,
        }),
      );
    }
    assert.equal(hash(input), expectedSha256);
    assert.equal(hash(fs.readFileSync(globalSource)), expectedSha256);
    assert.equal(fs.statSync(globalSource).mtimeMs, stat.mtimeMs);
  },
);

test(
  'real initializer opcode insertion is memory-only and preserves old code, EXID indices and relocation ownership',
  { skip: !initializerSource },
  () => {
    const stat = fs.statSync(initializerSource),
      input = fs.readFileSync(initializerSource),
      expectedSha256 = hash(input);
    assert.equal(expectedSha256, '2d1fabe7de81e6057b676909ecb58c56883bd825ba99b274f45ab38860f989e7');
    const z = parseIgz(input),
      target = inspectAppendTarget(input, expectedSha256),
      list = z.objects[648],
      opcode = z.objects[799],
      group = z.objects[800];
    assert.equal(list.type, 'OpCodeList');
    assert.equal(list.encoded, 61736);
    assert.equal(z.u32(list.offset + 0xc), 624);
    assert.equal(opcode.type, 'OpChangeMembership');
    assert.equal(opcode.size, 80);
    assert.equal(group.type, 'ScriptGroupStack');
    assert.equal(group.size, 48);
    assert.equal(target.externalIdCount, 580);
    const payload = Buffer.alloc(136);
    input.copy(payload, 0, opcode.offset, opcode.offset + opcode.size);
    input.copy(payload, 80, group.offset, group.offset + group.size);
    payload.writeBigUInt64LE(75096n, 56);
    payload.writeBigUInt64LE(BigInt(target.appendOffset + 80), 72);
    payload.writeBigUInt64LE(BigInt(target.appendOffset + 128), 112);
    payload.writeBigUInt64LE(0x8000000000000009n, 120);
    payload.writeBigUInt64LE(0x8000000000000244n, 128);
    // This deliberately omits branch/refcount policy edits: it is a structural
    // probe, not executable chapter registration, and is never written to disk.
    const result = appendIgz(input, {
      expectedSha256,
      appendedDefaultPool: payload,
      appendedObjects: [
        { offset: 0, type: opcode.type },
        { offset: 80, type: group.type },
      ],
      fixupSlots: { ROFS: [56, 72, 112], RSTT: [16], RNEX: [120], REXT: [128] },
      newExternalIds: [{ nameId: 3048, namespaceHash: 647282318 }],
      objectLists: [
        { listEncoded: list.encoded, expectedType: 'OpCodeList', insertAt: 86, appendObjects: [0] },
      ],
    });
    const out = parseIgz(result.buffer),
      nextList = out.objectsByOffset.get(out.resolvePointer(list.encoded).offset);
    const oldArray = z.pointerReferencesByOffset.get(list.offset + 0x20),
      nextArray = out.pointerReferencesByOffset.get(nextList.offset + 0x20);
    assert.equal(out.u32(nextList.offset + 0xc), 625);
    for (let i = 0; i < 624; i++) {
      assert.equal(
        out.u64(nextArray.targetOffset + (i < 86 ? i : i + 1) * 8),
        z.u64(oldArray.targetOffset + i * 8),
      );
      assert.equal(
        out.pointerReferencesByOffset.has(out.resolvePointer(oldArray.encoded).offset + i * 8),
        false,
      );
    }
    assert.equal(out.u64(nextArray.targetOffset + 86 * 8), BigInt(target.appendOffset));
    for (const object of z.objects) {
      if (object.encoded === list.encoded) continue;
      const next = out.objectsByOffset.get(out.resolvePointer(object.encoded).offset);
      assert.deepEqual(
        result.buffer.subarray(next.offset, next.offset + next.size),
        input.subarray(object.offset, object.offset + object.size),
      );
    }
    const beforeExid = z.fixupMap.get('EXID'),
      afterExid = out.fixupMap.get('EXID');
    assert.equal(afterExid.count, 581);
    assert.deepEqual(
      result.buffer.subarray(afterExid.dataOffset, afterExid.dataOffset + beforeExid.count * 8),
      input.subarray(beforeExid.dataOffset, beforeExid.end),
    );
    const authoredStart = out.resolvePointer(target.appendOffset).offset;
    assert.equal(out.u64(authoredStart + 120), 0x8000000000000009n);
    assert.equal(out.u64(authoredStart + 128), 0x8000000000000244n);
    assert.equal(out.fixupMap.get('RNEX').count, z.fixupMap.get('RNEX').count + 1);
    assert.equal(out.fixupMap.get('REXT').count, z.fixupMap.get('REXT').count + 1);
    assert.equal(result.manifest.objectLists[0].originalEntryIndicesPreserved, false);
    assert.equal(hash(input), expectedSha256);
    assert.equal(hash(fs.readFileSync(initializerSource)), expectedSha256);
    assert.equal(fs.statSync(initializerSource).mtimeMs, stat.mtimeMs);
    console.log(
      JSON.stringify({
        probe: 'initializer-opcode-insertion',
        sourceSha256: expectedSha256,
        outputSha256: result.manifest.output.sha256,
        rows: [624, 625],
        insertAt: 86,
        externalIds: [580, 581],
        originalOpcodeBytesPreserved: true,
        branchOrReferenceCountPatched: false,
        runtimeValidated: false,
        deployable: false,
        outputWritten: false,
      }),
    );
  },
);
