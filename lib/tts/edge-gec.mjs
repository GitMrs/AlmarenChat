// Edge ReadAloud Sec-MS-GEC v2 (CS64 + SHA256).
// Protocol references: https://github.com/rany2/edge-tts/pull/492
// https://github.com/SchneeHertz/node-edge-tts/blob/master/src/drm.ts (MIT).
import { createHash } from 'node:crypto';

export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
export const CHROMIUM_FULL_VERSION = '143.0.3650.75';
export const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const coefficients = [
  [0xE82E91B1, 0xB32700D0], [0x44DE24C6, 0x88DFF51D],
  [0x3BEB65BC, 0x29514038], [0xC89C5933, 0xB328CBDF],
  [0x8D1EC211, 0xD405B4D5], [0x314EF5D5, 0x26E55F3C],
  [0xE92491B1, 0x607801C6], [0xF0A5B9D5, 0x82B2C1FB],
  [0x06064CF3, 0xFA51A3DA], [0xDA79FA60, 0x207CC464],
  [0xBED20560, 0x3C3C74F3], [0x89F9C9F8, 0xD2D14B61],
  [0x35FA38C6, 0xBB04A2C1], [0xCB49E3C6, 0xC5626167],
];
const rotate = value => ((value << 16) | (value >>> 16)) >>> 0;
const multiply = Math.imul;

export function generateSecMsGec(unixSeconds = Date.now() / 1000) {
  if (!Number.isFinite(unixSeconds)) throw new TypeError('Invalid GEC timestamp');
  const seconds = BigInt(Math.floor(unixSeconds)) + 11644473600n;
  const ticks = (seconds - seconds % 300n) * 10000000n;
  const data = Buffer.from(`${ticks}${TRUSTED_CLIENT_TOKEN}`, 'ascii');
  const digest = createHash('sha256')
    .update('Copyright (C) Microsoft Corporation. All rights reserved.', 'ascii')
    .update(data).digest();
  const keys = [(digest.readUInt32LE(0) | 1) >>> 0, (digest.readUInt32LE(4) | 1) >>> 0];
  const factors = keys.map(key => multiply(key, 0x82893933) >>> 0);
  const terms = coefficients.map(([coefficient], i) => multiply(coefficient, factors[i % 2]) >>> 0);
  const offsets = coefficients.map(([, offset]) => offset);
  const padded = Buffer.alloc(Math.ceil((data.length + 1) / 8) * 8);
  data.copy(padded, 1);
  for (let i = 0; i < padded.length / 4; i++) {
    const word = padded.readUInt32LE(i * 4);
    terms.push((multiply(word, keys[i % 2]) + (i === 0 ? multiply(0xF2F90B1A, factors[0]) : 0)) >>> 0);
    offsets.push((multiply(rotate(word), i % 2 === 0 ? 0xEF0569FB : 0xC31713DB) + (i === 0 ? 0x0B1A0000 : 0)) >>> 0);
  }
  let swapped = 0, last = 0, state = 0, total = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i], y = terms[i + 1];
    let q = multiply(rotate((offsets[i] + x) >>> 0), 0x76F50F34);
    swapped += (multiply(rotate(q), 0xC3EFEA97) + q) >>> 0;
    q = multiply(rotate((offsets[i + 1] + y) >>> 0), 0x1881CE3C);
    last = (multiply(rotate(q), 0x35BD1EC9) + q) >>> 0;
    swapped = (swapped + last) >>> 0;
    state = (multiply(state, keys[0]) + x) >>> 0;
    for (const factor of [0xCF98B111, 0x87085B9F, 0x12CEB96D, 0x257E1D83]) {
      state = multiply(rotate(state), factor) >>> 0;
    }
    total += state;
    let t = (multiply(state, keys[1]) + y) >>> 0;
    for (const factor of [0xA27416F5, 0xD38396FF, 0x7C932B89, 0xBFA49F69]) {
      t = multiply(rotate(t), factor) >>> 0;
    }
    state = t;
    total = (total + state) >>> 0;
  }
  const checksum = Buffer.alloc(8);
  checksum.writeUInt32LE((last ^ state) >>> 0, 0);
  checksum.writeUInt32LE((swapped ^ total) >>> 0, 4);
  return `${checksum.toString('hex')}-${digest.toString('hex')}`.toUpperCase();
}
