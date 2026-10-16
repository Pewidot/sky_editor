/**
 * Source-pinned legal-screen timing builder, recovered from the shipped script.
 * All bootstrap gates, sprite creation and cleanup remain in their native order.
 * Requires the caller's extracted original assets; never installs or runs them.
 * A generated artifact needs separate runtime acceptance, even when byte-identical
 * to the private accepted fastboot candidate.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIgz } from './igz.mjs';
import { bufferSha256, reconcileReferences } from './native_script_writer.mjs';
import { replaceMember } from './iga_replace.mjs';
export const LEGAL_PROFILE = {
  sourceSha256: 'ade502dc677e3ff821412356b17c60557d01eafb1ffd006ca97061d368c966bd',
  archiveSha256: '8182ceb4f89291e53cca3785d9bd2055e5ee0b27906474d65bac59ef3cd817b7',
  graph: 'research/directboot-01-legal.json',
  graphSha256: '6aa73e919a03c410df28dbb890270dfbeb9ddb4196bd74e80b425ad24819e4e1',
};
export function patchLegalDurations(source) {
  assert.equal(bufferSha256(source), LEGAL_PROFILE.sourceSha256, 'Original legal payload required');
  const z = parseIgz(source),
    zero = z.objects[31];
  assert.equal(zero.type, 'ValueRHSVariant');
  const buffer = Buffer.from(source),
    changes = [];
  for (const [id, row, rhsId, name, duration] of [
    [124, 40, 127, 'TIME_LEGAL_FADE_UP', 0.5],
    [146, 49, 149, 'TIME_LEGAL_VISIBLE', 5],
    [160, 57, 127, 'TIME_LEGAL_FADE_DOWN', 0.5],
  ]) {
    const o = z.objects[id];
    assert.equal(o.type, 'OpSetValue');
    const at = o.offset + 64,
      r = z.pointerReferencesByOffset.get(at);
    assert.equal(r.targetObjectIndex, rhsId);
    buffer.writeBigUInt64LE(BigInt(zero.encoded), at);
    changes.push({
      objectId: id,
      row,
      name,
      fieldOffset: 64,
      beforeRhsId: rhsId,
      afterRhsId: 31,
      beforeDuration: duration,
      afterDuration: 0,
    });
  }
  const output = reconcileReferences(buffer, z),
    after = parseIgz(output);
  assert.equal(after.unresolvedFixupEntries.length, 0);
  assert.equal(output.length, source.length);
  return {
    buffer: output,
    manifest: {
      schema: 'private-legal-duration-experiment-v1',
      ...LEGAL_PROFILE,
      outputSha256: bufferSha256(output),
      changes,
      runtimeValidated: false,
      preserved: {
        script: 21,
        bootstrapGuardRow: 38,
        nativeFlagRow: 56,
        cleanupRows: [66, 67, 68, 69],
        bootstrapFinishedRow: 70,
        selfRemovalRow: 71,
        opCodeListUnchanged: true,
      },
      limitations: [
        'Only presentation durations change; this does not force readiness or bypass loading.',
        'Legal sprites still execute original creation and cleanup; a transient frame is possible.',
        'Native performance and acceptance require independent isolated-copy verification.',
      ],
    },
  };
}
export async function buildLegalDurations({ source, archive, outputDir }) {
  const dir = path.resolve(outputDir);
  assert.ok(!fs.existsSync(dir), 'Output directory must be new');
  assert.equal(
    bufferSha256(fs.readFileSync(archive)),
    LEGAL_PROFILE.archiveSha256,
    'Original legal archive required',
  );
  const { buffer, manifest } = patchLegalDurations(fs.readFileSync(source));
  fs.mkdirSync(dir, { recursive: true });
  const inner = path.join(dir, 'level.bld'),
    outer = path.join(dir, 'legal.bld'),
    report = path.join(dir, 'legal.manifest.json');
  fs.writeFileSync(inner, buffer, { flag: 'wx' });
  const r = await replaceMember({
    source: archive,
    selector: 'level.bld',
    replacement: inner,
    output: outer,
  });
  manifest.archive = { source: path.resolve(archive), output: outer, sha256: r.output.sha256 };
  fs.writeFileSync(report, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return { inner, outer, report, innerSha256: manifest.outputSha256, outerSha256: r.output.sha256 };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, archive, outputDir, ...extra] = process.argv.slice(2);
  assert.ok(
    source && archive && outputDir && !extra.length,
    'Usage: node tools/native_fastboot_legal.mjs ORIGINAL-INNER ORIGINAL-LEGAL-ARCHIVE NEW-DIR',
  );
  console.log(JSON.stringify(await buildLegalDurations({ source, archive, outputDir }), null, 2));
}
