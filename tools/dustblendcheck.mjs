#!/usr/bin/env node
// #5772: block-dust biome tint = BiomeColors' 5x5 blend of PER-COLUMN biome colours (not NS.Tint's 4-block texels,
// not a single column). A plains|swamp boundary column must come out as the average of the 25 column colours.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NS = { CFG: {} }; globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02d_wgdata.js', '03b_noise.js', '04g_biomes.js', '10_gfx.js', '06b_tintmap.js', '07zx_particle.js'])
  new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS);
const meta = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
NS.WG.init({ worldgen: readFileSync(join(ROOT, 'assets/worldgen.bin')).toString('base64'), worldgenBytes: meta('worldgen.meta.json').jsonBytes });
NS.Biomes.initColormaps({ colormaps: readFileSync(join(ROOT, 'assets/colormaps.bin')).toString('base64'), colormapsBytes: meta('colormaps.meta.json').rawBytes });
NS.Biomes.init();
const B = NS.Biomes, Px = NS.Particle;
const PL = B.indexOf.plains, SW = B.indexOf.swamp;
// one chunk (0,0): columns x<8 plains, x>=8 swamp, so the boundary is at x=8 (not on a 4-block texel edge shift)
const biome = new Uint8Array(256);
for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) biome[(z << 4) | x] = x < 9 ? PL : SW;
NS.World = { get: (cx, cz) => (cx === 0 && cz === 0 ? { biome } : null) };
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const avg = (ch, x, z, fn) => {
  let r = 0, g = 0, b = 0, n = 0;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const c = fn(ch, x + dx, z + dz); r += (c >> 16) & 255; g += (c >> 8) & 255; b += c & 255; n++;
  }
  return ((r / n | 0) << 16) | ((g / n | 0) << 8) | (b / n | 0);
};
const col = (ch, x, z) => B.tintColor(ch, biome[((z & 15) << 4) | (x & 15)], x, z);
const check = (sample, label) => {
  const f = [];
  for (const ch of [1, 2, 3]) {
    const x = 8, z = 8, got = sample(ch, x + 0.5, z + 0.5, 0x123456);
    const want = avg(ch, x, z, col);
    const a = col(ch, x, z), b = col(ch, x + 3, z);
    if (got !== want) f.push(`ch${ch}: got ${got.toString(16)} want ${want.toString(16)}`);
    if (ch !== 3 && (got === a || got === b)) f.push(`ch${ch}: equals a neighbour column`);
    if (ch === 3 && PL !== SW && B.waterColor(PL) === B.waterColor(SW)) f.push('water identical in both biomes: test degenerate');
  }
  return f;
};
const f0 = check(Px.biomeSample); f0.forEach((m) => fails.push(m)); ok(f0.length === 0, 'blend');
const single = (ch, x, z) => col(ch, Math.floor(x), Math.floor(z));
if (check(single).length) { breaks++; console.log('   ✓ anti-vacuity: single-column sample caught'); }
const tex = (ch, x, z) => NS.Tint.sample ? col(ch, (Math.floor(x) >> 2 << 2) + 2, Math.floor(z)) : 0;
if (check(tex).length) { breaks++; console.log('   ✓ anti-vacuity: 4-block texel sample caught'); }
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` ${breaks} breaks caught`);
process.exit(fails.length || breaks < 2 ? 1 : 0);
