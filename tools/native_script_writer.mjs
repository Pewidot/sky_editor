// Small assembler for the script objects observed in the supported PS4 donors.
// It preserves encoded addresses and refuses implicit foreign object imports.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseIgz } from './igz.mjs';
import { appendIgz, inspectAppendTarget } from './igz_append.mjs';

export const bufferSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export class NativeScriptWriter {
  constructor(source, expectedSha256, capacity = 256 * 1024) {
    assert.equal(bufferSha256(source), expectedSha256);
    this.source = source;
    this.parsed = parseIgz(source);
    this.target = inspectAppendTarget(source, expectedSha256);
    this.bytes = Buffer.alloc(capacity);
    this.cursor = 0;
    this.objects = [];
    this.fixups = new Map();
    this.strings = [];
    this.externals = [];
    this.foreignPointers = new Set();
  }
  reserve(size) {
    const offset = this.cursor;
    this.cursor += Math.ceil(size / 8) * 8;
    assert.ok(this.cursor <= this.bytes.length, 'Script payload budget exceeded');
    return offset;
  }
  slot(kind, offset) {
    if (!this.fixups.has(kind)) this.fixups.set(kind, new Set());
    this.fixups.get(kind).add(offset);
  }
  clear(offset) {
    for (const slots of this.fixups.values()) slots.delete(offset);
    this.foreignPointers.delete(offset);
    this.bytes.writeBigUInt64LE(0n, offset);
  }
  string(value) {
    const existing = this.parsed.strings.indexOf(value);
    if (existing >= 0) return existing;
    let added = this.strings.indexOf(value);
    if (added < 0) {
      added = this.strings.length;
      this.strings.push(value);
    }
    return this.target.stringCount + added;
  }
  externalId(nameId, namespaceHash) {
    const z = this.parsed,
      table = z.fixupMap.get('EXID');
    for (let i = 0; i < table.count; i++) {
      if (z.u32(table.dataOffset + i * 8) === nameId && z.u32(table.dataOffset + i * 8 + 4) === namespaceHash)
        return i;
    }
    let index = this.externals.findIndex((e) => e.nameId === nameId && e.namespaceHash === namespaceHash);
    if (index < 0) {
      index = this.externals.length;
      this.externals.push({ nameId, namespaceHash });
    }
    return this.target.externalIdCount + index;
  }
  external(offset, index) {
    this.clear(offset);
    this.slot('REXT', offset);
    this.bytes.writeBigUInt64LE(0x8000000000000000n | BigInt(index), offset);
  }
  pointer(object, field, local) {
    const offset = object + field;
    this.clear(offset);
    this.slot('ROFS', offset);
    this.bytes.writeBigUInt64LE(BigInt(this.target.appendOffset + local), offset);
  }
  existingPointer(object, field, encoded) {
    const offset = object + field;
    assert.ok(this.parsed.resolvePointer(encoded));
    this.clear(offset);
    this.slot('ROFS', offset);
    this.bytes.writeBigUInt64LE(BigInt(encoded), offset);
  }
  clone(index, donor = this.parsed) {
    const object = donor.objects[index],
      offset = this.reserve(object.size);
    const type = this.parsed.types.indexOf(object.type);
    assert.ok(type >= 0, 'Missing native type ' + object.type);
    assert.equal(this.parsed.typeSizes[type], object.size);
    donor.buffer.copy(this.bytes, offset, object.offset, object.offset + object.size);
    this.bytes.writeUInt32LE(type, offset);
    this.bytes.writeUInt32LE(0, offset + 8);
    this.objects.push({ offset, type: object.type });
    for (const [kind, table] of donor.offsetTables) {
      if (['ROOT', 'RVTB'].includes(kind)) continue;
      for (const at of table.offsets) {
        if (at < object.offset || at >= object.offset + object.size) continue;
        const local = offset + at - object.offset;
        this.slot(kind, local);
        if (kind === 'RSTT')
          this.bytes.writeBigUInt64LE(
            BigInt(this.string(donor.stringReferencesByOffset.get(at).value)),
            local,
          );
        if (donor === this.parsed) continue;
        if (kind === 'ROFS') this.foreignPointers.add(local);
        if (kind === 'REXT') {
          const value = donor.u64(at),
            f = donor.fixupMap.get('EXID'),
            i = Number(value & 0x7fffffffffffffffn);
          this.external(
            local,
            this.externalId(donor.u32(f.dataOffset + i * 8), donor.u32(f.dataOffset + i * 8 + 4)),
          );
        }
        if (kind === 'RNEX') {
          const value = donor.u64(at),
            f = donor.fixupMap.get('EXNM'),
            i = Number(value & 0x7fffffffffffffffn);
          const names = [0, 4].map((n) => donor.strings[donor.u32(f.dataOffset + i * 8 + n)]);
          const own = this.parsed.fixupMap.get('EXNM');
          let found = -1;
          for (let j = 0; j < own.count; j++) {
            if (
              names.every(
                (name, k) => name === this.parsed.strings[this.parsed.u32(own.dataOffset + j * 8 + k * 4)],
              )
            )
              found = j;
          }
          assert.ok(found >= 0, 'Missing external metatype ' + names.join('/'));
          this.bytes.writeBigUInt64LE((value & 0x8000000000000000n) | BigInt(found), local);
        }
        assert.ok(
          !['RHND', 'RMHN', 'RPID'].includes(kind),
          'Foreign resource import requires its own policy',
        );
      }
    }
    return offset;
  }
  list(object, entries) {
    const array = this.reserve(entries.length * 8);
    this.bytes.writeUInt32LE(entries.length, object + 12);
    this.bytes.writeUInt32LE(entries.length, object + 16);
    this.bytes.writeUInt32LE(entries.length * 8, object + 24);
    this.pointer(object, 32, array);
    for (const [i, entry] of entries.entries()) {
      if (entry.external !== undefined) this.external(array + i * 8, entry.external);
      else if (entry.encoded !== undefined) this.existingPointer(array, i * 8, entry.encoded);
      else this.pointer(array, i * 8, entry.local);
    }
  }
  name(object, name) {
    this.bytes.writeUInt32LE(this.string(name), object + 16);
  }
  branch(object, count) {
    assert.ok(Number.isInteger(count) && count >= 0 && count < 65535);
    this.bytes.writeUInt16LE(count, object + 50);
  }
  finish({ roots, actorListEncoded, actors }) {
    assert.equal(
      this.foreignPointers.size,
      0,
      'Unbound foreign object references: ' + [...this.foreignPointers].join(','),
    );
    const result = appendIgz(this.source, {
      expectedSha256: bufferSha256(this.source),
      appendedDefaultPool: this.bytes.subarray(0, this.cursor),
      appendedObjects: this.objects,
      newStrings: this.strings,
      newExternalIds: this.externals,
      fixupSlots: Object.fromEntries(
        [...this.fixups].map(([kind, slots]) => [kind, [...slots].sort((a, b) => a - b)]),
      ),
      rootList: { rootEncoded: this.target.roots[0], appendObjects: roots },
      objectLists: [{ listEncoded: actorListEncoded, expectedType: 'ScriptSetList', appendObjects: actors }],
    });
    return {
      ...result,
      buffer: reconcileReferences(
        result.buffer,
        this.parsed,
        this.objects.map((o) => this.target.appendOffset + o.offset),
      ),
    };
  }
}

export function reconcileReferences(buffer, before, addedEncoded = []) {
  const output = Buffer.from(buffer),
    after = parseIgz(output);
  const counts = (parsed) => {
    const result = new Map();
    for (const ref of parsed.pointerReferences)
      if (ref.targetObjectIndex !== null) {
        const encoded = parsed.objects[ref.targetObjectIndex].encoded;
        result.set(encoded, (result.get(encoded) ?? 0) + 1);
      }
    return result;
  };
  const old = counts(before),
    next = counts(after),
    added = new Set(addedEncoded);
  const previousObjects = new Map(before.objects.map((object) => [object.encoded, object]));
  for (const object of after.objects) {
    if (!added.has(object.encoded) && old.get(object.encoded) === next.get(object.encoded)) continue;
    const previous = previousObjects.get(object.encoded);
    if (previous)
      assert.equal(
        before.u32(previous.offset + 8),
        old.get(object.encoded) ?? 0,
        'Unexpected original reference count',
      );
    output.writeUInt32LE(next.get(object.encoded) ?? 0, object.offset + 8);
  }
  assert.equal(parseIgz(output).unresolvedFixupEntries.length, 0);
  return output;
}
