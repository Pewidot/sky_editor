import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseIgz } from '../tools/igz.mjs';
import { inspectModuleDependencies, inspectModuleFile } from '../tools/module_dependencies.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const align = (n) => Math.ceil(n / 4) * 4;
const inspect = (b, options = {}) =>
  inspectModuleDependencies(b, { expectedSha256: hash(b), objectIds: [1], ...options });

// Small independent synthetic container. The graph deliberately does not claim
// to be a playable actor: only the exact relocation/list/memory contracts matter.
function fixture({
  cycle = false,
  external = false,
  unknownSpan = false,
  initializer = false,
  interior = false,
} = {}) {
  const defs = [
    ['igObjectList', 0x28],
    ['tfbActorInfo', 0x170],
    ['tfbPhysicsModel', 0x70],
    ['DrawableList', 0x28],
    ['Drawable', 0x30],
    ['igVertexBuffer', 0x58],
    ['igVertexFormat', 0x80],
  ];
  let cursor = 8;
  const objects = defs.map(([type, size], index) => {
    const o = { type, size, index, at: cursor };
    cursor += size;
    return o;
  });
  const [root, actor, model, list, draw, vb, format] = objects;
  const data = Buffer.alloc(0x1400),
    rofs = [],
    rstt = [];
  objects.forEach((o) => data.writeUInt32LE(o.index, o.at));
  const ptr = (at, to) => {
    data.writeBigUInt64LE(BigInt(to), at);
    rofs.push(at);
  };
  const named = (o, index) => {
    data.writeUInt32LE(index, o.at + 0x10);
    rstt.push(o.at + 0x10);
  };
  const listData = (o, at, item) => {
    data.writeUInt32LE(1, o.at + 0xc);
    data.writeUInt32LE(1, o.at + 0x10);
    data.writeUInt32LE(8, o.at + 0x18);
    ptr(o.at + 0x20, at);
    ptr(at, item);
  };
  named(actor, 0);
  named(model, 1);
  listData(root, 0x1000, actor.at);
  listData(list, 0x1010, draw.at);
  ptr(actor.at + 0x158, model.at);
  ptr(model.at + 0x28, list.at);
  ptr(draw.at + 0x18, vb.at + (interior ? 4 : 0));
  ptr(vb.at + 0x28, format.at);
  data.writeUInt32LE(12, format.at + 0x10);
  ptr(format.at + 0x18, 0x1200);
  data.writeUInt32LE(0, vb.at + 0x20);
  if (cycle) ptr(model.at + 0x30, actor.at);
  if (external) data.writeBigUInt64LE(0x8000000000000000n, model.at + 0x40);
  if (unknownSpan) ptr(format.at + 0x28, 0x1300);
  if (initializer) {
    rofs.push((actor.at + 0x130) | 0x04000000);
    data.writeUInt32LE(0xffffffff, actor.at + 0x130);
  }
  const words = (values) => {
    const b = Buffer.alloc(values.length * 4);
    values.forEach((n, i) => b.writeUInt32LE(n, i * 4));
    return b;
  };
  const strings = (values) =>
    Buffer.concat(
      values.map((s) => {
        const b = Buffer.alloc(Math.ceil((s.length + 1) / 2) * 2);
        b.write(s);
        return b;
      }),
    );
  const offsets = (values) => {
    const nibbles = [];
    let previous = 0;
    for (const value of [...values].sort((a, b) => a - b)) {
      let delta = (value - previous) / 4 - 1;
      assert.ok(Number.isInteger(delta) && delta >= 0);
      do {
        const chunk = delta % 8;
        delta = Math.floor(delta / 8);
        nibbles.push(chunk | (delta ? 8 : 0));
      } while (delta);
      previous = value;
    }
    const b = Buffer.alloc(Math.ceil(nibbles.length / 2));
    nibbles.forEach((n, i) => {
      b[i >> 1] |= n << ((i % 2) * 4);
    });
    return b;
  };
  const block = (magic, count, bytes) => {
    const b = Buffer.alloc(align(bytes.length + 16));
    b.write(magic);
    b.writeUInt32LE(count, 4);
    b.writeUInt32LE(b.length, 8);
    b.writeUInt32LE(16, 12);
    bytes.copy(b, 16);
    return b;
  };
  const fixups = [
    block('TMET', defs.length, strings(defs.map((d) => d[0]))),
    block('MTSZ', defs.length, words(defs.map((d) => d[1]))),
    block('TSTR', 2, strings(['Synthetic actor', 'Synthetic module'])),
    block('TMHN', 1, words([36, 0, 0x1100, 0])),
    block('RVTB', objects.length, offsets(objects.map((o) => o.at))),
    block('ROFS', rofs.length, offsets(rofs)),
    block('RSTT', rstt.length, offsets(rstt)),
    block('RMHN', 1, offsets([vb.at + 0x20])),
    block('ROOT', 1, words([root.at])),
    ...(external
      ? [block('EXID', 1, words([0x12345678, 0xabcdef01])), block('REXT', 1, offsets([model.at + 0x40]))]
      : []),
  ];
  const fixupData = Buffer.concat(fixups),
    dataOffset = 0x800 + fixupData.length,
    b = Buffer.alloc(dataOffset + data.length);
  b.writeUInt32LE(0x49475a01);
  b.writeUInt32LE(8, 4);
  b.writeUInt32LE(14, 12);
  b.writeUInt32LE(fixups.length, 16);
  for (const [at, offset, size] of [
    [0x14, 0x800, fixupData.length],
    [0x24, dataOffset, data.length],
  ]) {
    b.writeUInt32LE(offset, at + 4);
    b.writeUInt32LE(size, at + 8);
    b.writeUInt32LE(8, at + 12);
  }
  b.write('Default\0', 0x224);
  fixupData.copy(b, 0x800);
  data.copy(b, dataOffset);
  return b;
}

test('bounded module traversal follows explicit list arrays and memory payloads without mutation', () => {
  const b = fixture(),
    original = Buffer.from(b),
    result = inspect(b);
  assert.deepEqual(
    result.objects.map((o) => o.id),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    result.dataSpans.map((s) => s.kind),
    ['object-pointer-list', 'memory-handle-payload', 'vertex-elements'],
  );
  assert.equal(result.counts.declaredDataBytes, 8 + 36 + 12);
  assert.equal(result.coverage.supportedPointerTraversalClosed, true);
  assert.equal(result.portable, false);
  assert.equal(result.runtimeValidated, false);
  assert.equal(result.semanticsComplete, false);
  assert.equal(result.incomingReferences.length, 1); // Original ROOT array is outside the selected module.
  assert.equal(result.incomingReferences[0].source.objectId, null);
  assert.deepEqual(
    result.strings.map((s) => s.value),
    ['Synthetic actor', 'Synthetic module'],
  );
  assert.ok(result.references.some((r) => r.sourceNode.startsWith('data:') && r.target?.objectId === 4));
  assert.ok(result.objects.every((o) => hash(b.subarray(o.fileOffset, o.fileOffset + o.size)) === o.sha256));
  assert.ok(
    result.dataSpans.every((s) => hash(b.subarray(s.fileOffset, s.fileOffset + s.size)) === s.sha256),
  );
  assert.deepEqual(b, original);
  assert.deepEqual(inspect(b), result);
});

test('cycles deduplicate, explicit interiors remain visible and ROOT can be an intentional seed', () => {
  const b = fixture({ cycle: true, interior: true }),
    r = inspect(b);
  assert.equal(r.objects.length, 6);
  assert.equal(r.references.filter((ref) => ref.target?.objectId === 1).length, 1);
  assert.ok(r.references.some((ref) => ref.target?.objectId === 5 && ref.target.interiorOffset === 4));
  const all = inspect(b, { objectIds: [0] });
  assert.equal(all.objects.length, 7);
  assert.equal(all.incomingReferences.length, 0);
});

test('external references retain raw identities and signed ownership flags without resolving them', () => {
  const r = inspect(fixture({ external: true })),
    external = r.references.find((x) => x.magic === 'REXT');
  assert.equal(external.table, 'EXID');
  assert.equal(external.tableIndexDecimal, '0');
  assert.equal(external.retainOnResolve, true);
  assert.deepEqual(r.tableEntries.find((x) => x.table === 'EXID').words, [0x12345678, 0xabcdef01]);
  assert.ok(r.frontier.some((x) => x.reason === 'external-identity-or-handle-not-linked'));
  assert.equal(r.coverage.supportedPointerTraversalClosed, false);
  assert.equal(r.portable, false);
});

test('unknown raw targets and runtime initializers do not become guessed dependencies', () => {
  const r = inspect(fixture({ unknownSpan: true, initializer: true }));
  assert.equal(r.counts.objects, 6);
  assert.deepEqual(r.frontier.map((x) => x.reason).sort(), [
    'runtime-initializer-semantics-unknown',
    'untyped-target-extent-unknown',
  ]);
  assert.equal(r.references.find((x) => x.kind === 'runtime-initializer').rawSlotHex, 'ffffffff00000000');
});

test('known Havok magic is an explicit collision frontier, not a guessed copied packfile', () => {
  const b = fixture({ unknownSpan: true }),
    z = parseIgz(b),
    at = z.descriptors[1].offset + 0x1300;
  b.writeUInt32LE(0x57e0e057, at);
  b.writeUInt32LE(0x10c0c010, at + 4);
  const r = inspect(b);
  assert.ok(r.frontier.some((x) => x.reason === 'havok-packfile-needs-independent-schema-and-transform'));
  assert.equal(r.dataSpans.length, 3);
});

test('span bounds and unsupported memory schemas fail closed; configured traversal limits abort', () => {
  const b = fixture(),
    z = parseIgz(b),
    badList = Buffer.from(b),
    badMemory = Buffer.from(b);
  badList.writeUInt32LE(0x1800, z.objects[3].offset + 0x18);
  const r = inspect(badList);
  assert.ok(r.frontier.some((x) => x.reason === 'data-schema-rejected'));
  assert.ok(r.frontier.some((x) => x.reason === 'untyped-target-extent-unknown'));
  assert.equal(r.coverage.supportedPointerTraversalClosed, false);
  badMemory.writeUInt32LE(0xfedcba98, z.fixupMap.get('TMHN').dataOffset + 4);
  const m = inspect(badMemory);
  assert.ok(m.frontier.some((x) => x.reason === 'memory-payload-schema-unknown'));
  assert.throws(() => inspect(b, { maxObjects: 2 }), /budget/);
  assert.throws(() => inspect(b, { maxReferences: 2 }), /budget/);
  assert.throws(() => inspect(b, { maxDataBytes: 40 }), /budget/);
  assert.throws(() => inspect(b, { maxObjects: 0 }), /Invalid maxObjects/);
});

test('explicit source identity, exact option keys, seed IDs and allocation preflight are mandatory', () => {
  const b = fixture();
  assert.throws(() => inspectModuleDependencies(b, { objectIds: [1] }), /SHA-256/);
  assert.throws(() => inspect(b, { expectedSha256: '0'.repeat(64) }), /SHA-256/);
  for (const objectIds of [[], [1, 1], [-1], [9999], ['1']])
    assert.throws(() => inspect(b, { objectIds }), /objectIds|index/);
  assert.throws(() => inspect(b, { recursiveGuess: true }), /Unknown/);
  const huge = Buffer.from(b);
  huge.writeUInt32LE(2_000_001, 0x804);
  assert.throws(() => inspect(huge), /allocation budget/);
});

test('file/CLI inspector is read-only, rejects symlinks and produces valid provenance', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-dependencies-'));
  try {
    const b = fixture(),
      source = path.join(dir, 'level.bld'),
      link = path.join(dir, 'link.bld');
    fs.writeFileSync(source, b);
    const before = fs.statSync(source),
      result = inspectModuleFile({ source, expectedSha256: hash(b), objectIds: [1] });
    assert.equal(result.source, source);
    assert.equal(result.artifact.sha256, hash(b));
    fs.symlinkSync(source, link);
    assert.throws(
      () => inspectModuleFile({ source: link, expectedSha256: hash(b), objectIds: [1] }),
      /ELOOP/,
    );
    const cli = spawnSync(
      process.execPath,
      ['tools/module_dependencies.mjs', '--source', source, '--expect-sha256', hash(b), '--objects', '1'],
      { encoding: 'utf8' },
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).counts.objects, 6);
    assert.equal(fs.statSync(source).mtimeMs, before.mtimeMs);
    assert.deepEqual(fs.readFileSync(source), b);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['level.bld', 'link.bld']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const arena = 'research/arena_challenge_303_000/level.bld';
test(
  'local-only GarageDoor_4 closure includes model, private actor resources, real mesh/image payloads and external frontiers',
  { skip: !fs.existsSync(arena) },
  () => {
    const expectedSha256 = 'de0ecd5bc5f5f2b3d99ec81592e8fef97a3228e6777e99f1c169e6cd584e7a32';
    const before = fs.statSync(arena),
      r = inspectModuleFile({ source: arena, expectedSha256, objectIds: [26175] });
    assert.equal(r.objects.find((o) => o.id === 26175).name, 'GarageDoor_4');
    for (const id of [26176, 26177, 26222]) assert.ok(r.objects.some((o) => o.id === id));
    assert.equal(r.objects.filter((o) => o.type === 'Drawable').length, 3);
    assert.ok(r.dataSpans.some((s) => s.poolName === 'Image'));
    assert.ok(r.dataSpans.some((s) => s.poolName === 'Vertex'));
    assert.equal(r.coverage.supportedPointerTraversalClosed, false);
    assert.equal(r.portable, false);
    assert.equal(r.incomingReferences.filter((x) => x.targetObjectId === 26175).length, 5);
    assert.equal(fs.statSync(arena).mtimeMs, before.mtimeMs);
    assert.equal(hash(fs.readFileSync(arena)), expectedSha256);
  },
);
