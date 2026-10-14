#!/usr/bin/env node
// Exact-build, disposable-game-only access gate for local arena testing.
// This does not mark challenges completed or manufacture a new level.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseIgz } from './igz.mjs';

export const ARENA_TEST_GATE = Object.freeze({
  profile: 'trap-team-cusa00697-title-arena-debug-gate-v1',
  sourceSha256: 'ac9de5aec39382d11e3caa8a62afb98240ee3ed273c804a58978ed9bd358710e',
  sourceArchiveSha256: '6185686228683d98679f4effa3c6222142fbce5d8bb08c4003887c2705cac57d',
  size: 42528608,
  objectIndex: 15036,
  objectOffset: 0x18c29c,
  fieldOffset: 0x40,
  originalOperator: 4,
  testOperator: 2,
  evidence: [
    'ev_6a3c193c0cc50c18e02c0d6488a63ee33f0085e3b93861f48ad0b0aab22a1868',
    'ev_e1147d40e866f6d375a541e2721133de67ad27cc11122dcba2731f4ecd393d25',
  ],
});
// The return-from-battle route loads this separate copy of UI_ArenaSelect.
// The same check has exactly two consumers, at OpCodeList rows 1358/1367.
export const ARENA_RETURN_GATE = Object.freeze({
  ...ARENA_TEST_GATE,
  profile: 'trap-team-cusa00697-streamed-arena-debug-gate-v1',
  sourceSha256: '1a0825122ceba7fa2000f0630ded2e6111d5905ea0af628c63d0160ebd6931ac',
  sourceArchiveSha256: '8cce5c48b59cb6d6a6250dd58cf3429ff91462eb3956457e6eac828369aaf11e',
  size: 9734204,
  objectIndex: 6130,
  objectOffset: 615792,
});
export const ARENA_GATE_PROFILES = Object.freeze([ARENA_TEST_GATE, ARENA_RETURN_GATE]);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function check(ok, message) {
  if (!ok) throw new Error(message);
}

export function patchArenaTestGate(source) {
  check(Buffer.isBuffer(source), 'Expected arena-menu payload Buffer');
  const p = ARENA_GATE_PROFILES.find((profile) => profile.size === source.length);
  check(p, 'Unsupported arena-menu payload size');
  check(
    sha(source) === p.sourceSha256,
    'Unsupported arena-menu SHA-256; do not remove the exact-build guard',
  );
  const igz = parseIgz(source),
    object = igz.objects[p.objectIndex];
  check(
    object?.type === 'OpCheckValue' && object.offset === p.objectOffset && object.size === 0x50,
    'Expected shared arena debug gate object is absent',
  );
  const at = p.objectOffset + p.fieldOffset;
  check(source.readUInt32LE(at) === p.originalOperator, 'Expected GT_OP comparison is absent');
  const result = Buffer.from(source);
  result.writeUInt32LE(p.testOperator, at); // DEBUG unlock all >= 0, originally > 0.
  const reparsed = parseIgz(result);
  check(
    reparsed.objects.length === igz.objects.length &&
      reparsed.unresolvedFixupEntries.length === igz.unresolvedFixupEntries.length,
    'Patched payload failed structural verification',
  );
  const changedBytes = [];
  for (let i = 0; i < source.length; i++)
    if (source[i] !== result[i]) {
      check(i >= at && i < at + 4, 'Unexpected change outside comparison field');
      changedBytes.push({ offset: i, before: source[i], after: result[i] });
    }
  check(changedBytes.length === 1, 'Expected exactly one changed byte');
  return {
    bytes: result,
    manifest: {
      ...p,
      outputSha256: sha(result),
      changedBytes,
      operation: 'Arena UI access check GT_OP -> GE_OP, existing debug value compared with zero',
      purpose: 'Disposable local arena test route only; no completed-level, save-unlock or new-level claim',
      runtimeValidated: false,
    },
  };
}

export function buildArenaTestGate(input, output) {
  input = path.resolve(input);
  output = path.resolve(output);
  const manifestPath = output + '.manifest.json';
  check(!fs.existsSync(output) && !fs.existsSync(manifestPath), 'Output and manifest must both be new');
  const stat = fs.lstatSync(input);
  check(
    stat.isFile() && !stat.isSymbolicLink() && ARENA_GATE_PROFILES.some((p) => p.size === stat.size),
    'Expected regular supported arena-menu payload of exact size',
  );
  const { bytes, manifest } = patchArenaTestGate(fs.readFileSync(input));
  let wroteOutput = false;
  try {
    fs.writeFileSync(output, bytes, { flag: 'wx' });
    wroteOutput = true;
    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, input, output }, null, 2) + '\n', {
      flag: 'wx',
    });
  } catch (error) {
    if (wroteOutput) fs.unlinkSync(output);
    throw error;
  }
  return {
    output,
    manifest: manifestPath,
    outputSha256: manifest.outputSha256,
    changedBytes: manifest.changedBytes,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4)
      throw new Error(
        'Usage: node tools/arena_test_gate.mjs <original-title-or-ui_arenaselect-inner-level.bld> <NEW-output-level.bld>',
      );
    console.log(JSON.stringify(buildArenaTestGate(process.argv[2], process.argv[3]), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
