#!/usr/bin/env node
// Read-only declarations and symbolic allocation inputs; not a save decoder/writer.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseIgz } from './igz.mjs';
import { extractMetadata } from './elf_metadata.mjs';
import { EXECUTABLE_SHA256 } from './level_builder.mjs';
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const hash = (b) => createHash('sha256').update(b).digest('hex');
const MAX_FILE = 256 * 1024 * 1024;
const COUNT_EVIDENCE = 'ev_11fdeffa6dbac8c21e58bab96a17dcae08a8da71ca801acc343674010484d77a';
const LITERAL_EVIDENCE = {
  selection: 'ev_2834b716a4acd86c1241f5da4d2f5484442ec8896fe9791f14cb609373dc3b1c',
  getter: 'ev_d574b616d9d13a985395c1eb1db06faa21ddb4858a74930528aa23dabe905521',
  condition:
    'ValueRHSVariant NO_OP, empty operand-one stack, and kRHSfuncNone select the raw-value/type getter.',
};

/** Explicit caller-selected sequence only. Does not determine runtime call order. */
export function projectSequentialFields(fields) {
  check(Array.isArray(fields) && fields.length <= 10000, 'Expected bounded field sequence');
  let cursor = 0;
  const spans = fields.map((f) => {
    check(
      f &&
        typeof f.name === 'string' &&
        [f.count, f.bits].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 10000000),
      'Projection requires explicit bounded nonnegative integer count/width',
    );
    const bitLength = f.count * f.bits;
    check(
      Number.isSafeInteger(bitLength) && Number.isSafeInteger(cursor + bitLength),
      'Projection integer overflow',
    );
    const out = { name: f.name, count: f.count, bits: f.bits, bitIndex: cursor, bitLength };
    cursor += bitLength;
    return out;
  });
  return {
    spans,
    totalBits: cursor,
    runtimeValidated: false,
    assumption:
      'Caller supplies the actual executed order/counts; no branches, save migration or payload bytes are evaluated.',
  };
}

export function createSaveLayoutCatalog({ initializer, global, registry, expectedHashes, metadata }) {
  check(
    metadata?.executableSha256 === EXECUTABLE_SHA256 && Array.isArray(metadata.classes),
    'Matching native metadata required',
  );
  check(
    registry?.schema === 'skylanders-chapter-registry-v1' && registry.executableSha256 === EXECUTABLE_SHA256,
    'Matching chapter registry required',
  );
  const fields = (type, names) => {
    const c = metadata.classes.find((c) => c.name === type);
    check(
      c?.evidence &&
        names.every(([name, offset]) => c.fields.some((f) => f.name === name && f.offset === offset)),
      'Native field guard failed: ' + type,
    );
    return c;
  };
  fields('tfbScriptInfo', [['_opList', 0x28]]);
  fields('OpUseMacro', [['_NP', 0x38]]);
  const parameterClass = fields('OpMacroParameter', [['_macroDef', 0x68]]);
  const parameterBase = fields('OpParameter', [
    ['_RHS', 0x58],
    ['_indexRHS', 0x60],
    ['_combineOp', 0x54],
  ]);
  check(parameterClass.parent === 'OpParameter', 'Native macro parameter inheritance guard failed');
  const rhsClass = fields('RHSValueStack', [
    ['_value', 0x40],
    ['_type', 0x38],
    ['_properties', 0x30],
  ]);
  const arithmeticClass = fields('ValueRHSVariant', [
    ['_varOp1', 0x10],
    ['_arithOperator', 0x18],
    ['_varOp2', 0x20],
    ['_resultFunc', 0x28],
    ['_conditioner', 0x30],
  ]);
  const arith = metadata.enums?.find((e) => e.name === 'ArithOp');
  check(
    arith?.values.some((v) => v.name === 'NO_OP' && v.value === -1) &&
      arith.values.some((v) => v.name === 'MULT_OP' && v.value === 2),
    'Native arithmetic enum required',
  );
  fields('OpSetValue', [
    ['_LHS', 0x38],
    ['_RHS', 0x40],
  ]);
  fields('OpCode', [['_branchPC', 0x32]]);
  const checkClass = fields('OpAbstractCheckValue', [
    ['_LHS', 0x38],
    ['_RHS', 0x48],
    ['_relOperator', 0x40],
  ]);
  fields('OpChangeMembership', [
    ['_LHS', 0x38],
    ['_RHS', 0x48],
    ['_combineOp', 0x40],
  ]);
  const relOp = metadata.enums?.find((e) => e.name === 'RelOp');
  check(
    relOp?.evidence && relOp.values.some((v) => v.name === 'EQ_OP' && v.value === 1),
    'Native comparison enum required',
  );
  const contexts = {};
  for (const [key, bytes] of Object.entries({ initializer, global })) {
    check(Buffer.isBuffer(bytes) && bytes.length <= MAX_FILE, 'Expected bounded source: ' + key);
    const sha256 = hash(bytes);
    check(
      /^[a-f0-9]{64}$/.test(expectedHashes?.[key] ?? '') &&
        sha256 === expectedHashes[key] &&
        registry.sources?.[key]?.sha256 === sha256,
      'Source/registry SHA-256 mismatch: ' + key,
    );
    contexts[key] = { key, bytes, sha256, z: parseIgz(bytes) };
  }
  const c = contexts.initializer,
    g = contexts.global,
    z = c.z;
  const label = (context, o) =>
    context.z.stringReferencesByOffset.get(
      o.offset + (/^(OpCreateVariable|OpMacroParameter)$/.test(o.type) ? 0x38 : 0x10),
    )?.value ?? '';
  const object = (context, o) => ({
    source: context.key,
    id: `igz:${context.sha256}:object:${o.index}`,
    objectIndex: o.index,
    type: o.type,
    name: label(context, o),
    fileOffset: o.offset,
    size: o.size,
  });
  const ptr = (o, offset) => z.objects[z.pointerReferencesByOffset.get(o.offset + offset)?.targetObjectIndex];
  const relocation = new Map();
  for (const type of ['REXT', 'RNEX'])
    for (const at of z.offsetTables.get(type)?.offsets ?? []) relocation.set(at, type);
  function slot(at) {
    const p = z.pointerReferencesByOffset.get(at),
      o = z.objects[p?.targetObjectIndex];
    if (o) return { kind: 'object', ...object(c, o) };
    const type = relocation.get(at),
      raw = z.u64(at),
      index = Number(raw & 0x7fffffffffffffffn);
    if (!type)
      return {
        kind: raw === 0n ? 'null' : 'unresolved',
        rawHex: c.bytes.subarray(at, at + 8).toString('hex'),
      };
    const table = z.fixupMap.get(type === 'REXT' ? 'EXID' : 'EXNM');
    check(
      Number.isSafeInteger(index) && index < table.count && table.dataOffset + (index + 1) * 8 <= table.end,
      'External table bounds',
    );
    const a = z.u32(table.dataOffset + index * 8),
      b = z.u32(table.dataOffset + index * 8 + 4);
    if (type === 'RNEX') {
      check(a < z.strings.length && b < z.strings.length, 'EXNM string index bounds');
      return {
        kind: 'named-external',
        index,
        name: z.strings[a],
        namespace: z.strings[b],
        basis: 'serialized EXNM name/namespace string pair',
      };
    }
    if (a === 967958004 && b === 1549491124)
      return { kind: 'builtin', name: 'SetVariant::count', evidence: COUNT_EVIDENCE };
    const r = registry.externalReferences[index];
    check(r?.nameId === a && r.namespaceHash === b, 'Registry EXID mismatch');
    const target = r.resolution?.target;
    if (target?.source === 'global' && target.kind === 'local-object') {
      const original = g.z.objects[target.objectIndex];
      check(
        original && object(g, original).id === target.id && original.type === target.type,
        'Registry global target mismatch',
      );
      return { kind: 'object', ...object(g, original) };
    }
    return { kind: 'unresolved-external', index, nameId: a, namespaceHash: b };
  }
  function list(o) {
    check(o && /(?:List|Stack)$/.test(o.type) && o.size >= 0x28, 'Expected reference-list header');
    const count = z.u32(o.offset + 0xc),
      p = z.pointerReferencesByOffset.get(o.offset + 0x20);
    check(count <= 10000, 'List count exceeds save-catalog budget');
    if (!count) return [];
    check(
      p && z.u32(o.offset + 0x10) >= count && z.u32(o.offset + 0x18) >= count * 8,
      'Invalid reference-list span',
    );
    z.resolvePointer(p.encoded, count * 8);
    return Array.from({ length: count }, (_, i) => ({
      slotFileOffset: p.targetOffset + i * 8,
      ...slot(p.targetOffset + i * 8),
    }));
  }
  const cache = new Map();
  function expression(o, depth = 0) {
    if (!o) return { kind: 'null' };
    if (cache.has(o.index)) return cache.get(o.index);
    check(depth <= 8, 'Expression depth exceeds budget');
    let out = { object: object(c, o) };
    if (o.type === 'ValueRHSVariant') {
      check(o.size === arithmeticClass.size, 'ValueRHSVariant size mismatch');
      const op = c.bytes.readInt32LE(o.offset + 0x18),
        known = arith.values.find((v) => v.value === op);
      out = {
        ...out,
        kind: 'arithmetic',
        operation: known?.name ?? null,
        operationValue: op,
        fieldEvidence: arithmeticClass.evidence,
        enumEvidence: arith.evidence,
        conditioner: slot(o.offset + 0x30),
        serializedResultFunction: slot(o.offset + 0x28),
        left: expression(ptr(o, 0x10), depth + 1),
        ...(op === -1 ? {} : { right: expression(ptr(o, 0x20), depth + 1) }),
      };
    } else if (/Stack$/.test(o.type)) {
      const components = list(o);
      if (o.type === 'RHSValueStack' && components.length === 0) {
        check(o.size === rhsClass.size, 'RHSValueStack size mismatch');
        const type = slot(o.offset + 0x38),
          properties = z.u32(o.offset + 0x30);
        const integer =
          type.kind === 'named-external' &&
          type.name === 'IntMeasurement' &&
          type.namespace === 'metaobject' &&
          properties === 0;
        out = {
          ...out,
          kind: integer ? 'integer-literal' : 'uninterpreted-literal',
          valueType: type,
          properties,
          fieldEvidence: rhsClass.evidence,
          valueFileOffset: o.offset + 0x40,
          interpretation:
            'Serialized typed literal only; no VM evaluation or caller reachability is asserted.',
          literalGetterEvidence: LITERAL_EVIDENCE,
          rawWord: z.u32(o.offset + 0x40),
          ...(integer ? { value: c.bytes.readInt32LE(o.offset + 0x40) } : {}),
        };
      } else
        out = {
          ...out,
          kind: 'reference-path',
          components,
          evaluation: 'symbolic only; dynamic variables, indices and functions are not executed',
        };
    } else out = { ...out, kind: 'symbol', name: label(c, o) };
    cache.set(o.index, out);
    return out;
  }
  const scripts = z.objects.filter(
    (o) => o.type === 'tfbScriptInfo' && label(c, o).endsWith('/Init_Setup_SaveGame.ai'),
  );
  check(scripts.length === 1, 'Expected one Init_Setup_SaveGame script');
  const script = scripts[0],
    rowSlots = list(ptr(script, 0x28));
  const rows = rowSlots.map((s) => {
    check(s.kind === 'object' && s.source === 'initializer', 'Expected local opcode row');
    return z.objects[s.objectIndex];
  });
  const macros = rows.filter(
    (o) => o.type === 'OpDefineMacro' && label(c, o) === 'Save Init - Define Save Param',
  );
  check(macros.length === 1, 'Expected unique Define Save Param definition');
  const macro = macros[0],
    declarations = [],
    assignments = [],
    operations = [],
    conditionals = [];
  let owner = null;
  for (let row = 0; row < rows.length; row++) {
    const o = rows[row];
    if (o.type === 'OpDefineMacro') owner = object(c, o);
    if (o.type === 'OpUseMacro') {
      const targets = list(ptr(o, 0x38));
      if (
        targets.length !== 1 ||
        targets[0].objectIndex !== macro.index ||
        targets[0].source !== 'initializer'
      )
        continue;
      check(rows[row + 1]?.type === 'OpMacroInterface', 'Save definition call lacks interface');
      const args = [];
      let endRow = row + 2;
      while (rows[endRow]?.type === 'OpMacroParameter') {
        const p = rows[endRow];
        check(
          ptr(p, 0x68)?.index === macro.index && p.size === parameterClass.size,
          'Parameter owner/size mismatch',
        );
        args.push({
          row: endRow,
          parameter: object(c, p),
          name: label(c, p),
          expression: expression(ptr(p, 0x58)),
          valueReferenceFileOffset: p.offset + 0x58,
          valueReferenceBasis: 'native OpMacroParameter inherits OpParameter._RHS +0x58',
          valueFieldEvidence: parameterBase.evidence,
          indexExpression: expression(ptr(p, 0x60)),
          combineOperationValue: c.bytes.readInt32LE(p.offset + 0x54),
          ownerFieldEvidence: parameterClass.evidence,
        });
        endRow++;
      }
      check(
        rows[endRow]?.type === 'OpFlowMacro' &&
          args.length === 6 &&
          new Set(args.map((a) => a.name)).size === 6,
        'Unsupported save definition argument block',
      );
      const byName = Object.fromEntries(args.map((a) => [a.name, a]));
      check(
        ['is header param', 'save param', 'signed', 'fields total', 'field bit size', 'limit to val'].every(
          (n) => byName[n],
        ),
        'Unexpected save definition parameter names',
      );
      const n = byName['save param'].expression;
      const saveName = n.kind === 'reference-path' ? (n.components.at(-1)?.name ?? null) : null;
      declarations.push({
        row,
        endRow,
        opcode: object(c, o),
        ownerMacro: owner,
        saveName,
        arguments: args,
        constantFieldCount: integerExpression(byName['fields total'].expression),
        constantBitWidth: integerExpression(byName['field bit size'].expression),
        headerFlag: integerExpression(byName['is header param'].expression),
        runtimeExecuted: 'unknown',
        finalBitIndex: null,
      });
    }
    if (o.type === 'OpSetValue')
      assignments.push({
        row,
        opcode: object(c, o),
        ownerMacro: owner,
        lhs: expression(ptr(o, 0x38)),
        rhs: expression(ptr(o, 0x40)),
      });
    if (
      owner?.name === 'Save Init - Define Save Param' ||
      owner?.name === 'Save Init - Finalize Save Params and Construct SaveGame'
    ) {
      operations.push({
        row,
        opcode: object(c, o),
        ownerMacro: owner,
        branchPC: c.bytes.readUInt16LE(o.offset + 0x32),
        pointerOperands: z
          .summarizeObject(o)
          .pointerReferences.filter((p) => p.fieldOffset >= 0x38 && p.targetObjectIndex != null)
          .map((p) => ({
            fieldOffset: p.fieldOffset,
            expression: expression(z.objects[p.targetObjectIndex]),
          })),
        ...(o.type === 'OpChangeMembership' ? { operationValue: z.u32(o.offset + 0x40) } : {}),
      });
    }
    if (o.type === 'OpCheckValue')
      conditionals.push({
        row,
        opcode: object(c, o),
        ownerMacro: owner,
        branchPC: c.bytes.readUInt16LE(o.offset + 0x32),
        comparisonValue: z.u32(o.offset + 0x40),
        comparison: relOp.values.find((v) => v.value === z.u32(o.offset + 0x40))?.name ?? null,
        fieldEvidence: checkClass.evidence,
        enumEvidence: relOp.evidence,
        lhs: expression(ptr(o, 0x38)),
        rhs: expression(ptr(o, 0x48)),
        note: 'Predicate preserved; call reachability and dynamic continuations are not evaluated.',
      });
  }
  const snapshots = [];
  for (const name of [
    'Level_Loads',
    'Level_AdventureTitles',
    'SaveNames_Slots',
    'DifficultyTracking_SegmentsPerLevel',
  ]) {
    const found = g.z.objects.filter((o) => label(g, o) === name);
    check(found.length === 1, 'Expected global allocation input: ' + name);
    const o = found[0],
      entry = { object: object(g, o), runtimeValue: 'not observed' };
    if (o.type === 'ScriptSet') {
      const members = g.z.objects[g.z.pointerReferencesByOffset.get(o.offset + 0x30)?.targetObjectIndex];
      check(members?.type === 'ScriptSetList', 'Global set members missing');
      entry.serializedMemberCount = g.z.u32(members.offset + 0xc);
    } else if (o.type === 'ValueInfo') {
      const valueClass = fields('ValueInfo', [['_value', 0x40]]);
      entry.serializedValueWord = g.z.u32(o.offset + 0x40);
      entry.fieldEvidence = valueClass.evidence;
    }
    snapshots.push(entry);
  }
  return {
    schema: 'skylanders-save-layout-catalog-v1',
    executableSha256: EXECUTABLE_SHA256,
    sources: Object.fromEntries(
      Object.entries(contexts).map(([k, v]) => [k, { sha256: v.sha256, size: v.bytes.length }]),
    ),
    script: object(c, script),
    opcodeRows: rows.length,
    definitionMacro: object(c, macro),
    declarations,
    assignments,
    allocationOperations: operations,
    conditionals,
    inputSnapshots: snapshots,
    runtimeValidated: false,
    offsetsFullyResolved: false,
    saveMigrationSupported: false,
    limitations: [
      'Call sites are in serialized source order, not a simulated execution trace; helper calls, loops and platform branches remain explicit.',
      'Only empty IntMeasurement/metaobject RHSValueStack with zero properties is interpreted as an integer literal; all other values remain symbolic or raw.',
      'Global snapshots are serialized inputs, not proof that runtime scripts leave them unchanged.',
      'No serialized save bytes, checksums, capacity, existing progress migration or chapter insertion are changed or validated.',
    ],
  };
}

export function integerExpression(node, depth = 0) {
  if (depth > 8) return null;
  if (node?.kind === 'integer-literal')
    return Number.isInteger(node.value) && node.value >= -0x80000000 && node.value <= 0x7fffffff
      ? node.value
      : null;
  if (
    node?.kind === 'arithmetic' &&
    node.operation === 'NO_OP' &&
    node.conditioner?.kind === 'null' &&
    node.serializedResultFunction?.kind === 'null'
  )
    return integerExpression(node.left, depth + 1);
  return null; // Deliberately no general VM arithmetic or state propagation.
}

export function exportSaveLayoutCatalog({
  initializer,
  global,
  registry,
  expectedHashes,
  executable,
  output,
}) {
  check(
    [initializer, global, registry, executable, output].every((v) => typeof v === 'string'),
    'Source files, hashes, ELF and new output required',
  );
  const fds = [],
    sources = {};
  try {
    for (const [key, filename] of Object.entries({ initializer, global, registry })) {
      const fd = fs.openSync(
        filename,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
      );
      fds.push(fd);
      const stat = fs.fstatSync(fd);
      check(stat.isFile() && stat.size <= MAX_FILE, 'Expected bounded regular source');
      const bytes = fs.readFileSync(fd);
      check(hash(bytes) === expectedHashes?.[key], 'Source SHA-256 mismatch: ' + key);
      sources[key] = { filename, fd, stat, bytes };
    }
    const result = createSaveLayoutCatalog({
      initializer: sources.initializer.bytes,
      global: sources.global.bytes,
      registry: JSON.parse(sources.registry.bytes),
      expectedHashes,
      metadata: extractMetadata(executable),
    });
    result.registrySource = { sha256: expectedHashes.registry, size: sources.registry.bytes.length };
    for (const s of Object.values(sources)) {
      const now = fs.fstatSync(s.fd),
        current = fs.lstatSync(s.filename);
      check(
        !current.isSymbolicLink() &&
          current.ino === s.stat.ino &&
          current.dev === s.stat.dev &&
          now.size === s.stat.size &&
          now.mtimeMs === s.stat.mtimeMs &&
          now.ctimeMs === s.stat.ctimeMs,
        'Source changed during save catalog export',
      );
    }
    const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
    check(bytes.length <= 32 * 1024 * 1024, 'Save catalog output budget exceeded');
    fs.writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
    check(hash(fs.readFileSync(output)) === hash(bytes), 'Output readback mismatch');
    return {
      output: path.resolve(output),
      sha256: hash(bytes),
      size: bytes.length,
      declarations: result.declarations.length,
      opcodeRows: result.opcodeRows,
    };
  } finally {
    fds.forEach((fd) => fs.closeSync(fd));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2),
      options = { expectedHashes: {} },
      allowed = new Set(['initializer', 'global', 'registry', 'output']);
    while (args.length) {
      const flag = args.shift();
      check(args.length, 'Missing option value');
      const h = /^--(initializer|global|registry)-sha256$/.exec(flag)?.[1],
        key = flag === '--elf' ? 'executable' : flag.replace(/^--/, '');
      if (h) {
        check(!options.expectedHashes[h], 'Duplicate source hash');
        options.expectedHashes[h] = args.shift();
      } else {
        check(
          (allowed.has(key) || flag === '--elf') && options[key] === undefined,
          'Unknown/duplicate option',
        );
        options[key] = args.shift();
      }
    }
    console.log(JSON.stringify(exportSaveLayoutCatalog(options)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
