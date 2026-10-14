// Synthetic, blank virtual RFID records; no downloaded character dumps or game assets.
// Layout reference: shadLaunchers/shadLauncher4 src/qt_ui/skylander_dialog.cpp
// (create dialog). CRC-16/CCITT-FALSE is implemented independently below.
import { randomBytes } from 'node:crypto';

export function crc16(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}
export function createFigure(id, variant = 0, serial = randomBytes(4)) {
  for (const value of [id, variant])
    if (!Number.isInteger(value) || value < 0 || value > 65535)
      throw new Error('ID and variant must be uint16');
  if (!Buffer.isBuffer(serial) || serial.length !== 4) throw new Error('Serial must contain four bytes');
  const data = Buffer.alloc(1024);
  serial.copy(data);
  data[4] = serial.reduce((a, b) => a ^ b, 0);
  data.set([0x81, 0x01, 0x0f], 5);
  data.writeUInt16LE(id, 0x10);
  data.writeUInt16LE(variant, 0x1c);
  data.writeUInt16LE(crc16(data.subarray(0, 0x1e)), 0x1e);
  for (let sector = 0; sector < 16; sector++)
    data.writeUInt32LE(sector ? 0x69080f7f : 0x690f0f0f, sector * 64 + 0x36);
  return data;
}
export function inspectFigure(data) {
  if (!Buffer.isBuffer(data) || data.length !== 1024)
    throw new Error('Virtual figure must be exactly 1024 bytes');
  if (data[4] !== (data[0] ^ data[1] ^ data[2] ^ data[3]))
    throw new Error('Figure serial checksum is invalid');
  if (data.readUInt16LE(0x1e) !== crc16(data.subarray(0, 0x1e)))
    throw new Error('Figure header CRC is invalid');
  return {
    serial: data.subarray(0, 4).toString('hex'),
    figureId: data.readUInt16LE(0x10),
    variant: data.readUInt16LE(0x1c),
  };
}
