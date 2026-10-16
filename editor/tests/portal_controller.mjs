// Synthetic current-map GUI fixture. No child process, game or figure is used.
import fs from 'node:fs';
import readline from 'node:readline';
let running = false,
  session = '';
const record = (operation) => {
  if (process.env.SKYLANDERS_PREVIEW_TEST_EVENTS)
    fs.appendFileSync(
      process.env.SKYLANDERS_PREVIEW_TEST_EVENTS,
      JSON.stringify({ operation, pid: process.pid, session }) + '\n',
    );
};
const status = () => ({
  running,
  session,
  ipcHandshake: running,
  usbBackendReady: running,
  slots: [],
  capabilities: { inputPulse: false, captureGameFrame: false },
});
for await (const line of readline.createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.operation === 'portal_start') {
    if (running || request.arguments.emulator !== '/synthetic/shadps4')
      throw new Error('Fixture refuses real or duplicate launch');
    session = request.arguments.session;
    running = true;
    record('portal_start');
  } else if (request.operation === 'portal_stop') {
    running = false;
    record('portal_stop');
  } else if (request.operation !== 'portal_status')
    throw new Error('Unexpected synthetic portal operation: ' + request.operation);
  process.stdout.write(JSON.stringify({ id: request.id, result: status() }) + '\n');
}
record('controller_eof');
if (running) throw new Error('Editor did not stop its owned synthetic preview before closing the controller');
