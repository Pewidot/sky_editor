#!/usr/bin/env node
// Synthetic IPC process, never loads a game. Used only by controller tests.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--game') + 1], 'utf8'));
} catch {
  /* original minimal fixture */
}
if (settings.keepAliveAfterStdinEof) setInterval(() => {}, 1000);
process.stderr.write(
  ';#IPC_ENABLED\n;ENABLE_EMU_CONTROL\n' +
    (settings.extended ? ';ENABLE_INPUT_PULSE_V1\n;ENABLE_CAPTURE_GAME_FRAME_V1\n' : '') +
    ';#IPC_END\n',
);
let run = false;
let command = null,
  fields = [];
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
function writePng(name, data = png) {
  fs.mkdirSync('user/screenshots', { recursive: true });
  fs.writeFileSync(path.join('user/screenshots', name), data);
}
if (settings.captureMode === 'stale') writePng('SYNTHETIC_game_000000.png');
for await (const line of readline.createInterface({ input: process.stdin })) {
  fs.appendFileSync('mock-wire.log', line + '\n');
  if (command) {
    fields.push(line);
    if (fields.length < (command === 'INPUT_PULSE' ? 4 : 1)) continue;
    const id = Number(fields[0]);
    if (command === 'INPUT_PULSE') {
      if (settings.inputMode === 'reject')
        process.stderr.write(`;INPUT_PULSE ${id} error_input_already_held\n`);
      else if (settings.inputMode === 'releaseOnly') process.stderr.write(`;INPUT_PULSE ${id} released\n`);
      else if (settings.inputMode !== 'silent') {
        process.stderr.write(`;INPUT_PULSE ${id} pressed\n`);
        if (settings.inputMode === 'exit') process.exit(0);
        if (settings.inputMode !== 'pressOnly')
          setTimeout(
            () => process.stderr.write(`;INPUT_PULSE ${id} released\n`),
            settings.inputDelayMs ?? Number(fields[3]),
          );
      }
    } else if (settings.captureMode === 'reject')
      process.stderr.write(`;CAPTURE_GAME_FRAME ${id} error invalid_id_not_ready_or_rate_limit\n`);
    else if (settings.captureMode !== 'silent') {
      process.stderr.write(`;CAPTURE_GAME_FRAME ${id} queued\n`);
      if (!['queuedOnly', 'stale'].includes(settings.captureMode))
        setTimeout(() => {
          const name = `SYNTHETIC_${settings.captureMode === 'hud' ? 'hud' : 'game'}_${String(id).padStart(6, '0')}.png`;
          if (settings.captureMode === 'symlink') {
            fs.mkdirSync('user/screenshots', { recursive: true });
            fs.symlinkSync(settings.outside, path.join('user/screenshots', name));
          } else {
            writePng(name, settings.captureMode === 'partial' ? png.subarray(0, 24) : png);
            if (settings.captureMode === 'partial') setTimeout(() => writePng(name), 100);
          }
          process.stdout.write(
            `[Render.Vulkan] Saved screenshot: ${settings.outside ?? path.resolve('user/screenshots', name)}\n`,
          );
        }, settings.captureDelayMs ?? 20);
    }
    command = null;
    fields = [];
    continue;
  }
  if (line === 'INPUT_PULSE' || line === 'CAPTURE_GAME_FRAME') {
    command = line;
    continue;
  }
  if (line === 'RUN') run = true;
  if (line === 'START' && run)
    process.stderr.write(
      `Starting shadps4 emulator v${settings.version ?? '0.19.0'}\n[Core.Linker] Execute: Can't Load libSceLibcInternal.sprx switching to HLE\n`,
    );
  if (line === 'STOP' && !settings.ignoreStop) {
    if (settings.saveOnStop) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      fs.mkdirSync('user/home', { recursive: true });
      fs.writeFileSync('user/home/final-save', 'progress flushed before close');
    }
    process.exit(0);
  }
}
