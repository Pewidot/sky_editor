// Persistent synthetic fixture; no emulator/game. Only private synthetic PNGs are copied.
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
let running = false,
  session = '',
  lastFigureId = 0,
  extended = false,
  requestId = 0,
  captures = 0,
  inputs = 0,
  captureUncertain = false,
  inputUncertain = false;
const slots = Array(16).fill(null);
const status = () => ({
  running,
  session,
  ipcHandshake: running,
  usbBackendReady: running,
  slots,
  capabilities: { inputPulse: extended, captureGameFrame: extended },
  uncertainInputRequestIds: inputUncertain ? [requestId] : [],
  captureUncertain,
});
for await (const line of readline.createInterface({ input: process.stdin })) {
  const request = JSON.parse(line),
    args = request.arguments ?? {};
  let result, error, code;
  switch (request.operation) {
    case 'portal_start':
      if (!['/synthetic/prior-checkpoint', '/synthetic/new-checkpoint'].includes(args.resumeFrom))
        throw new Error('Resume checkpoint was not forwarded');
      if (args.resumeFrom === '/synthetic/new-checkpoint')
        slots[0] = { figureId: 456, variant: 0, serial: '1234abcd' };
      running = true;
      session = args.session;
      extended = args.emulator.includes('input-ipc');
      fs.mkdirSync(path.join(session, 'user/screenshots'), { recursive: true });
      result = status();
      break;
    case 'portal_status':
      result = status();
      break;
    case 'portal_create_figure':
      lastFigureId = args.figureId;
      result = {
        path: '/tmp/synthetic-figure.sky',
        figureId: lastFigureId,
        variant: args.variant,
        synthetic: true,
      };
      break;
    case 'portal_insert':
    case 'portal_swap':
      slots[args.slot] = {
        figureId: lastFigureId,
        variant: 0,
        serial: '1234abcd',
        writableCopy: '/tmp/private-synthetic-copy.sky',
      };
      result = { slot: args.slot, acknowledged: false };
      break;
    case 'portal_remove':
      slots[args.slot] = null;
      result = { slot: args.slot, acknowledged: false };
      break;
    case 'portal_stop':
      running = false;
      result = status();
      break;
    case 'portal_checkpoint':
      if (args.output !== '/synthetic/new-checkpoint' || slots[0]?.figureId !== 456)
        throw new Error('Wrong checkpoint request/state');
      running = false;
      result = {
        path: args.output,
        files: 2,
        figures: [{ slot: 0, figureId: 456 }],
        limitation: 'Saved profile, not RAM state.',
      };
      break;
    case 'portal_input':
      if (!extended) throw new Error('GUI sent input to an unsupported official binary');
      if (
        !(
          (args.kind === 'button' && args.name === 'cross') ||
          (args.kind === 'axis' && args.name === 'left_y_minus')
        ) ||
        args.durationMs !== 80
      )
        throw new Error('Incorrect gamepad mapping/duration');
      inputs++;
      if (inputs === 3) {
        requestId++;
        inputUncertain = true;
        setTimeout(() => {
          inputUncertain = false;
        }, 150);
        error = 'Input release unconfirmed; wait for a late release or stop';
        code = 'IPC_TIMEOUT';
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
      result = {
        requestId: ++requestId,
        acknowledged: true,
        pressed: true,
        released: true,
        gameAccepted: false,
      };
      break;
    case 'portal_capture': {
      if (!extended) throw new Error('GUI sent capture to an unsupported official binary');
      if (args.timeoutMs !== 10000) throw new Error('Capture timeout was not forwarded');
      captures++;
      requestId++;
      if (captures === 2) {
        captureUncertain = true;
        error = 'No fresh complete PNG; restart the session before another capture';
        code = 'CAPTURE_TIMEOUT';
        break;
      }
      const target = path.join(
        session,
        'user/screenshots',
        `synthetic_game_${String(requestId).padStart(6, '0')}.png`,
      );
      const bytes = fs.readFileSync(process.env.SKYLANDERS_PORTAL_TEST_PNG);
      fs.writeFileSync(target, bytes, { flag: 'wx' });
      result = {
        requestId,
        acknowledged: true,
        path: target,
        bytes: bytes.length,
        width: 2,
        height: 2,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        fresh: true,
        gameOnly: true,
      };
      break;
    }
    default:
      throw new Error(`Unknown operation ${request.operation}`);
  }
  process.stdout.write(JSON.stringify({ id: request.id, result, error, code }) + '\n');
}
if (running) throw new Error('Client closed the controller before sending portal_stop');
