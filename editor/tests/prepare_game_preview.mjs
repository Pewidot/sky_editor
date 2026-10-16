// Synthetic GUI fixture only. Never starts an emulator or accesses game assets.
import fs from 'node:fs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
if (process.env.SKYLANDERS_PREVIEW_TEST_REQUESTS)
  fs.appendFileSync(process.env.SKYLANDERS_PREVIEW_TEST_REQUESTS, JSON.stringify(request) + '\n');
if (process.env.SKYLANDERS_PREVIEW_TEST_EVENTS)
  fs.appendFileSync(
    process.env.SKYLANDERS_PREVIEW_TEST_EVENTS,
    JSON.stringify({ operation: 'prepare', pid: process.pid }) + '\n',
  );
process.stderr.write('PREVIEW_STAGE Synthetic build\n');
await new Promise((resolve) => setTimeout(resolve, 80));
if (process.env.SKYLANDERS_PREVIEW_TEST_MODE !== 'success') {
  console.log(JSON.stringify({ error: 'Synthetic preview preparation failed; no emulator launched' }));
  process.exitCode = 1;
} else {
  const profile = JSON.parse(fs.readFileSync(request.profilePath, 'utf8'));
  const map = profile.maps.find((map) => map.sourceSha256 === request.expectedSha256);
  const run = profile.outputRoot + '/synthetic-' + process.pid;
  console.log(
    JSON.stringify({
      schema: 'skylanders-prepared-preview-v1',
      profilePath: request.profilePath,
      levelPath: request.levelPath,
      sourceSha256: request.expectedSha256,
      editCount: request.edits.length,
      map: { sourceSha256: map.sourceSha256, loadString: map.loadString, label: map.label },
      emulator: profile.emulator,
      game: run + '/CUSA00697/eboot.bin',
      session: run + '/session',
      resumeFrom: profile.checkpoint,
      x11: true,
      sourceGameUnchanged: true,
      emulatorStarted: false,
    }),
  );
}
