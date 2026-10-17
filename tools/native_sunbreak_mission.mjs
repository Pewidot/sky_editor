// Native, source-bound three-objective mission. Donor bytes are supplied by
// the owner of the game; no extracted scripts or assets ship with this module.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseIgz } from './igz.mjs';
import { appendIgz, inspectAppendTarget } from './igz_append.mjs';
import {
  appendTypeDeclarations,
  POSITION_STACK_FIELDS,
  OP_USER_BEHAVIOR_FIELDS,
  VALUE_INFO_FIELDS,
  OP_SET_VALUE_FIELDS,
} from './igz_types.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const pins = {
  world: 'e64c8dc6c4b5f0f188c0afc2c0045bf0e0db5a2472c409f1f8b729ea82ebadd9',
  global: 'c25db4953907fdf05c470d5ae69f2c6b17734754f52daa995e11f46fdb908e8c',
  soda: 'ffb0550f8f11d53e0db9aaa32bc977c887a5f5c0b8f1a139555859a4034b6cd3',
};

export function buildSunbreakMission({ world, global, soda, skipPropertyFields }) {
  for (const [key, b] of Object.entries({ world, global, soda }))
    assert.equal(sha(b), pins[key], 'Unsupported mission donor ' + key);
  assert.equal(typeof skipPropertyFields, 'boolean', 'Explicit experimental loader profile required');
  const types = [
    ['PositionStack', 40, POSITION_STACK_FIELDS],
    ['OpUserBehavior', 64, OP_USER_BEHAVIOR_FIELDS],
    ['ValueInfo', 72, VALUE_INFO_FIELDS],
    ['OpSetValue', 72, OP_SET_VALUE_FIELDS],
  ];
  const declaration = appendTypeDeclarations(world, {
    expectedSha256: sha(world),
    types: types.map(([type, size, fields]) => ({
      type,
      size,
      fields: fields.filter((f) => !skipPropertyFields || f.metaType !== 'igPropertyFieldMetaField'),
    })),
  });
  const source = declaration.buffer,
    z = parseIgz(source),
    g = parseIgz(global),
    s = parseIgz(soda),
    target = inspectAppendTarget(source, sha(source));
  const payload = Buffer.alloc(32768),
    objects = [],
    fixups = {},
    strings = [],
    externals = [],
    foreignPointers = new Set();
  let cursor = 0;
  const slot = (kind, at) => {
    (fixups[kind] ??= new Set()).add(at);
  };
  const string = (text) => {
    let index = z.strings.indexOf(text);
    if (index >= 0) return index;
    index = strings.indexOf(text);
    if (index < 0) {
      index = strings.length;
      strings.push(text);
    }
    return target.stringCount + index;
  };
  const ext = (nameId, namespaceHash) => {
    const f = z.fixupMap.get('EXID');
    for (let i = 0; i < f.count; i++)
      if (z.u32(f.dataOffset + i * 8) === nameId && z.u32(f.dataOffset + i * 8 + 4) === namespaceHash)
        return i;
    let i = externals.findIndex((e) => e.nameId === nameId && e.namespaceHash === namespaceHash);
    if (i < 0) {
      i = externals.length;
      externals.push({ nameId, namespaceHash });
    }
    return target.externalIdCount + i;
  };
  function clone(id, parsed = z) {
    const o = parsed.objects[id],
      offset = cursor;
    cursor += Math.ceil(o.size / 8) * 8;
    assert.ok(cursor <= payload.length);
    assert.ok(z.types.includes(o.type));
    assert.equal(z.typeSizes[z.types.indexOf(o.type)], o.size);
    parsed.buffer.copy(payload, offset, o.offset, o.offset + o.size);
    payload.writeUInt32LE(z.types.indexOf(o.type), offset);
    payload.writeUInt32LE(0, offset + 8);
    objects.push({ offset, type: o.type });
    for (const [kind, t] of parsed.offsetTables) {
      if (['RVTB', 'ROOT'].includes(kind)) continue;
      for (const at of t.offsets)
        if (at >= o.offset && at < o.offset + o.size) {
          const local = offset + at - o.offset;
          slot(kind, local);
          if (kind === 'RSTT')
            payload.writeBigUInt64LE(BigInt(string(parsed.stringReferencesByOffset.get(at).value)), local);
          if (parsed !== z && kind === 'ROFS') foreignPointers.add(local);
          if (parsed !== z && kind === 'REXT') throw Error('Foreign external requires explicit translation');
          if (parsed !== z && kind === 'RNEX') {
            const value = parsed.u64(at),
              f = parsed.fixupMap.get('EXNM'),
              idx = Number(value & 0x7fffffffffffffffn);
            const names = [0, 4].map((n) => parsed.strings[parsed.u32(f.dataOffset + idx * 8 + n)]),
              own = z.fixupMap.get('EXNM');
            let found = -1;
            for (let i = 0; i < own.count; i++)
              if (names.every((n, j) => n === z.strings[z.u32(own.dataOffset + i * 8 + j * 4)])) found = i;
            assert.ok(found >= 0, 'Missing external metatype ' + names[0]);
            payload.writeBigUInt64LE((value & 0x8000000000000000n) | BigInt(found), local);
          }
        }
    }
    return offset;
  }
  const pointer = (object, field, to) => {
    const at = object + field;
    slot('ROFS', at);
    foreignPointers.delete(at);
    payload.writeBigUInt64LE(BigInt(target.appendOffset + to), at);
  };
  const external = (at, index) => {
    slot('REXT', at);
    payload.writeBigUInt64LE(0x8000000000000000n | BigInt(index), at);
  };
  const list = (object, entries) => {
    const array = cursor;
    cursor += entries.length * 8;
    assert.ok(cursor <= payload.length);
    payload.writeUInt32LE(entries.length, object + 12);
    payload.writeUInt32LE(entries.length, object + 16);
    payload.writeUInt32LE(entries.length * 8, object + 24);
    pointer(object, 32, array);
    entries.forEach((e, i) =>
      e.external === undefined ? pointer(array, i * 8, e.local) : external(array + i * 8, e.external),
    );
  };
  const named = (object, name) => payload.writeUInt32LE(string(name), object + 16);
  const branch = (object, count) => {
    assert.ok(count >= 0 && count < 65535);
    payload.writeUInt16LE(count, object + 50);
  };
  const stack = (entries) => {
    const o = clone(1720);
    payload.writeBigUInt64LE(0n, o + 40);
    fixups.ROFS?.delete(o + 40);
    list(o, entries);
    return o;
  };
  const literal = (n) => {
    const variant = clone(1721),
      value = clone(1722);
    pointer(variant, 16, value);
    payload.writeInt32LE(n, value + 64);
    return variant;
  };
  const one = literal(1),
    zero = literal(0),
    radius = literal(8),
    newlyComplete = literal(2);
  const states = ['West', 'East'].map((name) => {
    const o = clone(32984, s);
    named(o, 'Sunbreak_' + name + '_Active');
    payload.writeInt32LE(0, o + 48);
    payload.writeInt32LE(0, o + 64);
    return o;
  });
  const stateStacks = states.map((local) => stack([{ local }]));
  // A ScriptSetList is typed. The lighting list and My reference from Arena303
  // carry tfbActorInfo, which is not a valid objective-string operand. Reuse
  // Soda's populated StringInfo list/stack and translate their RNEX identities.
  const objectiveSet = clone(1712),
    objectiveList = clone(51858, s),
    objectiveRhs = clone(51856, s);
  named(objectiveSet, 'Sunbreak_Objectives');
  pointer(objectiveSet, 48, objectiveList);
  list(
    objectiveList,
    [3052, 3053, 3054].map((n) => ({ external: ext(n, 0x2694be8e) })),
  );
  list(objectiveRhs, [{ local: objectiveSet }]);
  const goalMacro = clone(23245, g),
    objectiveMacro = clone(25819, g),
    actors = [],
    scripts = [],
    controllers = [];
  // LevelEnd saves completion, then leaves adventure.complete=2 on a first
  // finish. Hub2014 treats the last story adventure's 2 as a new campaign
  // milestone and clamps its chapter count to 18, replaying Hub18_Intro for
  // appended chapters. Consume only Sunbreak's transient notification after
  // LevelEnd returns, just as the hub normally changes 2 to 1. Saved flags,
  // objectives and the native results sequence are not replaced or bypassed.
  const adventureType = clone(5799, g),
    adventureMember = clone(22783, g),
    completeMember = clone(23809, g);
  pointer(adventureMember, 72, adventureType);
  const completionStack = stack([
    { external: ext(1730, 0x2694be8e) },
    { local: adventureMember },
    { local: completeMember },
  ]);
  const call = (macro, parameterId, referenceEntries) => {
    const use = clone(1645),
      group = clone(1646),
      iface = clone(1648),
      parameter = clone(parameterId, g),
      rhs = clone(51856, s),
      flowMacro = clone(1598),
      flow = clone(1599);
    pointer(use, 56, group);
    list(group, [{ local: macro }]);
    pointer(group, 40, macro);
    branch(use, 4);
    branch(iface, 2);
    // These are caller-supplied arguments, even when cloned from a definition.
    // Native474ef0 otherwise replaces bit15-marked rows with the default RHS.
    payload.writeUInt16LE(payload.readUInt16LE(parameter + 48) & 0x7fff, parameter + 48);
    pointer(parameter, 88, rhs);
    pointer(parameter, 104, macro);
    list(rhs, referenceEntries);
    return [use, iface, parameter, flowMacro, flow];
  };
  const locations = [
    [-436, 100.05, -73],
    [-404, 100.05, -73],
    [-420, 100.05, -52],
  ];
  for (let i = 0; i < 3; i++) {
    const actor = clone(1708),
      collision = clone(1709),
      script = clone(1641),
      code = clone(1642),
      pre = clone(1643),
      startup = clone(1644),
      shutdown = clone(1638);
    // Soda17919's user behavior ends in the ordinary built-in continuation,
    // not the donor's explicit return (OpFlowBehavior with branch65535).
    const flow = clone(1599),
      behavior = clone(18155, s),
      loop = clone(1599),
      remove = clone(1723);
    named(actor, 'Sunbreak_' + ['West_Relay', 'East_Relay', 'Beacon'][i]);
    named(script, 'AI/Sunbreak/' + i + '.ai');
    named(behavior, 'Wait_For_Activation');
    locations[i].forEach((v, j) => payload.writeFloatLE(v, actor + 64 + j * 4));
    pointer(actor, 248, script);
    pointer(actor, 288, collision);
    pointer(script, 40, code);
    branch(pre, 5);
    branch(startup, 1);
    const checks = [],
      body = [];
    for (const k of i < 2 ? [i] : [0, 1]) {
      const check = clone(1719);
      payload.writeUInt32LE(1, check + 64);
      pointer(check, 56, stateStacks[k]);
      pointer(check, 72, i < 2 ? zero : one);
      checks.push(check);
      body.push(check);
    }
    const distance = clone(1719),
      position = clone(18822, g);
    const value = stack([{ external: ext(1377, 0x2694be8e) }, { external: ext(0x2eb31462, 0x7843eea6) }]);
    pointer(value, 40, position);
    list(position, [{ external: ext(1278082707, 2288385111) }]);
    pointer(distance, 56, value);
    pointer(distance, 72, radius);
    payload.writeUInt32LE(3, distance + 64);
    checks.push(distance);
    body.push(distance);
    if (i < 2) {
      const set = clone(25848, g);
      pointer(set, 56, stateStacks[i]);
      pointer(set, 64, one);
      body.push(set);
    }
    body.push(...call(objectiveMacro, 25823, [{ external: ext(3052 + i, 0x2694be8e) }]));
    if (i === 2) {
      body.push(...call(goalMacro, 25130, [{ external: ext(1843, 0x2694be8e) }]));
      const consumeNew = clone(1719),
        settled = clone(25054, g);
      pointer(consumeNew, 56, completionStack);
      pointer(consumeNew, 72, newlyComplete);
      payload.writeUInt32LE(1, consumeNew + 64);
      branch(consumeNew, 1);
      pointer(settled, 56, completionStack);
      pointer(settled, 64, one);
      body.push(consumeNew, settled);
    }
    body.push(remove, loop);
    for (const check of checks) branch(check, body.length - body.indexOf(check) - 2); // false -> terminal flow, never another goal
    branch(behavior, body.length);
    const rows = [pre, startup, flow, shutdown, flow, flow, behavior, ...body];
    list(
      code,
      rows.map((local) => ({ local })),
    );
    actors.push(actor);
    scripts.push(script);
    controllers.push({
      name: ['west', 'east', 'beacon'][i],
      position: locations[i],
      radiusFeet: 8,
      actorEncoded: target.appendOffset + actor,
      scriptEncoded: target.appendOffset + script,
      rows: rows.map((offset, row) => ({
        row,
        encoded: target.appendOffset + offset,
        type: objects.find((o) => o.offset === offset).type,
      })),
    });
  }
  assert.equal(foreignPointers.size, 0, 'Every foreign owning pointer must be explicitly rebound');
  const appended = appendIgz(source, {
    expectedSha256: sha(source),
    appendedDefaultPool: payload.subarray(0, cursor),
    appendedObjects: objects,
    fixupSlots: Object.fromEntries(Object.entries(fixups).map(([k, v]) => [k, [...v].sort((a, b) => a - b)])),
    newStrings: strings,
    newExternalIds: externals,
    // Native script registration needs ROOT membership as well as an actor
    // reference. All 3 Arena and all 194 Soda scripts are ROOT members. Without
    // it probe09 loops with an unbound behavior; probe10 reaches gameplay.
    rootList: {
      rootEncoded: target.roots[0],
      appendObjects: [...actors, ...scripts, ...states, objectiveSet],
    },
    objectLists: [{ listEncoded: 189400, expectedType: 'ScriptSetList', appendObjects: actors }],
  });
  const buffer = Buffer.from(appended.buffer);
  let out = parseIgz(buffer);
  const find = (e) => out.objectsByOffset.get(out.resolvePointer(e).offset);
  const objectiveParameter = find(z.objects[1662].encoded);
  buffer.writeBigUInt64LE(BigInt(target.appendOffset + objectiveRhs), objectiveParameter.offset + 88);
  // The donor's null argument has bit15 set: native474ef0 replaces that
  // opcode-list entry with the macro's default parameter. An explicit RHS
  // must clear this bit, matching Soda's level-objective-strings argument.
  assert.equal(buffer.readUInt16LE(objectiveParameter.offset + 48), 0x8000);
  buffer.writeUInt16LE(0, objectiveParameter.offset + 48);
  // +64 is an RNEX metatype reference, NOT an enum. Arena index15 and Soda
  // index18 both name ScriptSetReference. Keep the target file's index15.
  assert.ok(out.offsetTables.get('RNEX').offsets.includes(objectiveParameter.offset + 64));
  assert.equal(buffer.readUInt32LE(objectiveParameter.offset + 64), 15);
  out = parseIgz(buffer);
  const counts = (p) => {
    const m = new Map();
    for (const r of p.pointerReferences)
      if (r.targetObjectIndex !== null) {
        const e = p.objects[r.targetObjectIndex].encoded;
        m.set(e, (m.get(e) ?? 0) + 1);
      }
    return m;
  };
  const before = counts(z),
    after = counts(out);
  for (const o of z.objects)
    if ((before.get(o.encoded) ?? 0) !== (after.get(o.encoded) ?? 0)) {
      assert.equal(z.u32(o.offset + 8), before.get(o.encoded) ?? 0);
      buffer.writeUInt32LE(after.get(o.encoded) ?? 0, find(o.encoded).offset + 8);
    }
  for (const o of objects) {
    const e = target.appendOffset + o.offset;
    buffer.writeUInt32LE(after.get(e) ?? 0, find(e).offset + 8);
  }
  assert.equal(parseIgz(buffer).unresolvedFixupEntries.length, 0);
  return {
    buffer,
    manifest: {
      schema: 'skylanders-sunbreak-mission-v1',
      sourceSha256: pins,
      outputSha256: sha(buffer),
      objectiveGlobalNameIds: [3052, 3053, 3054],
      stateVariables: states.map((offset) => target.appendOffset + offset),
      controllers,
      skipPropertyFields,
      declarations: declaration.manifest,
      append: appended.manifest,
      hubReturnPolicy:
        "After native LevelEnd, consume only this mission's transient adventure.complete notification (2 -> 1); preserve native saves and results.",
      runtimeValidated: false,
      completionVerified: false,
      limitation:
        'Native script construction only; requires the matching global objective strings and a genuine gameplay/save test.',
    },
  };
}
