#!/usr/bin/env node
// extract-clouds.mjs — G17-CL1: textures/environment/clouds.png (256x256) as one bit per cell (alpha 255; the sheet's only other
// value is 1, which the cloud shader discards: 0.8 * 1/255 < 0.1), bit i = z*256+x at byte i>>3 bit i&7, raw-deflated.
//   node tools/extract-clouds.mjs   -> assets/clouds.bin
import { writeFileSync, existsSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { JARS } from './paths.mjs';

export function cloudBits(jarFile = (existsSync(JARS + '/1.18.2.jar') ? JARS + '/1.18.2.jar' : JARS + '/1.18.2/1.18.2.jar')) {
  const path = 'assets/minecraft/textures/environment/clouds.png';
  const jar = new Jar(jarFile);
  if (!jar.names().includes(path)) throw new Error('extract-clouds: texture not in this jar: ' + path);
  const img = decodePng(jar.read(path));
  if (img.width !== 256 || img.height !== 256) throw new Error(`extract-clouds: clouds.png is ${img.width}x${img.height}, not 256x256`);
  const bits = Buffer.alloc(8192);
  for (let i = 0; i < 65536; i++) {
    const a = img.data[i * 4 + 3];
    // the sheet's clear cells are alpha 1 (not 0) and its clouds 255; the shader discards alpha*0.8 < 0.1, i.e. a < 32
    if (a !== 1 && a !== 255) throw new Error('extract-clouds: a partial-alpha texel; the one-bit grid would lose it');
    if (a === 255) bits[i >> 3] |= 1 << (i & 7);
  }
  return bits;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bits = cloudBits();
  let n = 0; for (const b of bits) for (let k = 0; k < 8; k++) n += (b >> k) & 1;
  if (!n || n === 65536) { console.error('extract-clouds: grid is all clear or all cloud - decode failed'); process.exit(1); }
  writeFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'assets', 'clouds.bin'), deflateRawSync(bits, { level: 9 }));
  console.log(`extract-clouds: ${n} of 65536 cells are cloud`);
}
