// Source-bound Know-It-All Island preview. Original archives stay intact.
// The native Level Definition already accepts an absent intro stream; use its
// existing typed null StringInfo operand, keeping spawn and player setup intact.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseIgz } from './igz.mjs';
import { bufferSha256, reconcileReferences } from './native_script_writer.mjs';
import { replaceMember } from './iga_replace.mjs';

export const MAP_PROFILE = Object.freeze({
  innerSha256: '89c8ad20fdac917a7e1b3c4587b0cc25a3133e4bee0f43bae47ab9f71277173b',
  outerSha256: 'c17ce18ecc9d49746d770acfb8fb29d7327f2f6dcca78c975c20166e40c3d437',
});
export function patchMapIntro(bytes) {
  assert.equal(bufferSha256(bytes), MAP_PROFILE.innerSha256, 'Original map required');
  const z = parseIgz(bytes),
    parameter = z.objects[18057],
    original = z.objects[18058],
    empty = z.objects[18072];
  assert.equal(parameter.type, 'OpMacroParameter');
  assert.equal(z.stringReferencesByOffset.get(parameter.offset + 56)?.value, 'intro cutscene stream string');
  assert.equal(z.pointerReferencesByOffset.get(parameter.offset + 88)?.encoded, original.encoded);
  assert.equal(original.type, 'RHSReferenceStack');
  assert.equal(empty.type, 'RHSReferenceStack');
  assert.equal(z.u32(empty.offset + 12), 1);
  // Same StringInfo metatype and converter; only the list operand differs.
  assert.deepEqual(
    bytes.subarray(original.offset + 40, original.offset + 80),
    bytes.subarray(empty.offset + 40, empty.offset + 80),
  );
  const at = z.pointerReferencesByOffset.get(empty.offset + 32).targetOffset;
  assert.equal(z.u64(at), 0x8000000000000087n);
  const exid = z.fixupMap.get('EXID');
  assert.equal(z.u32(exid.dataOffset + 135 * 8), 1996966820);
  assert.equal(z.u32(exid.dataOffset + 135 * 8 + 4), 1239109223);
  const changed = Buffer.from(bytes);
  changed.writeBigUInt64LE(BigInt(empty.encoded), parameter.offset + 88);
  const buffer = reconcileReferences(changed, z),
    output = parseIgz(buffer);
  assert.equal(output.unresolvedFixupEntries.length, 0);
  return {
    buffer,
    manifest: {
      schema: 'private-314-no-intro-v1',
      runtimeValidated: false,
      sourceSha256: MAP_PROFILE.innerSha256,
      outputSha256: bufferSha256(buffer),
      change: { scriptId: 18014, row: 15, parameterId: 18057, fieldOffset: 88, from: 18058, to: 18072 },
      evidence: {
        localGraph: 'research/knowitall-mechanics-01-route.json',
        globalGraph: 'research/directboot-01-global.json',
        originalStream: '314_Intro_LoadString',
        nativeGlobalDefinition: { scriptId: 22673, macroId: 22677, rows: [94, 130] },
      },
      preserved: [
        'Spawn actor parameter18055',
        'Intro controller actor parameter18060 (already null)',
        'All other scripts, collision, actors, geometry and resources',
      ],
      limitations: [
        'This output still requires runtime testing; the source-pinned recipe passed the 2026-10-16 native launch/movement check.',
        'Skips only the supplied opening stream; does not disable dialogue or later gameplay cinematics.',
      ],
    },
  };
}
export async function buildMapIntro({ source, archive, outputDir }) {
  assert.ok(!fs.existsSync(outputDir), 'New output directory required');
  assert.equal(bufferSha256(fs.readFileSync(archive)), MAP_PROFILE.outerSha256);
  const { buffer, manifest } = patchMapIntro(fs.readFileSync(source));
  fs.mkdirSync(outputDir, { recursive: true });
  const inner = path.resolve(outputDir, 'level.bld'),
    outer = path.resolve(outputDir, 'level_314_tutorial_2.bld');
  fs.writeFileSync(inner, buffer, { flag: 'wx' });
  const result = await replaceMember({
    source: archive,
    selector: 'level.bld',
    replacement: inner,
    output: outer,
  });
  manifest.archive = { path: outer, sha256: result.output.sha256 };
  fs.writeFileSync(path.join(outputDir, 'intro.manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
  });
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, archive, outputDir, ...rest] = process.argv.slice(2);
  assert.ok(
    source && archive && outputDir && !rest.length,
    'Usage: ORIGINAL-INNER ORIGINAL-ARCHIVE NEW-DIRECTORY',
  );
  console.log(JSON.stringify(await buildMapIntro({ source, archive, outputDir }), null, 2));
}
