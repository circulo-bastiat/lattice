#!/usr/bin/env node
// #6432: SeekWaterTask scans in BlockPos.iterateOutwards order; equal-distance ties must pick the vanilla-first cell.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '07m_breed.js', '07zm_axolotl.js'], dom: false });
const Ax = MCL.Axolotl;
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fails++; console.log('FAIL ' + m); } };
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const N = 6, B = [0, 64, 0];
// the full iterateOutwards sequence, collected once
const seq = []; Ax.iterateOutwards(0, 64, 0, N, N, N, (x, y, z) => { seq.push([x, y, z]); return false; });
ok(seq.length === 13 * 13 * 13, 'iterateOutwards visits every cell of the cube once: ' + seq.length);
ok(new Set(seq.map(c => c.join())).size === seq.length, 'no cell visited twice');
const manhattan = (isWater, isAir) => {
  let best = null, bd = 1e9;
  for (let dx = -N; dx <= N; dx++) for (let dy = -N; dy <= N; dy++) for (let dz = -N; dz <= N; dz++) {
    if (!dx && !dz) continue;
    const d = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    if (d < bd && isWater(dx, 64 + dy, dz) && isAir(dx, 65 + dy, dz)) { best = [dx, 64 + dy, dz]; bd = d; }
  }
  return best;
};
let differs = 0;
for (let i = 0; i < 20; i++) {
  const water = new Set();
  const d = 2 + Math.floor(rnd() * 4);
  for (let k = 0; k < 8; k++) {   // several equal-distance candidates, all with air above
    const dx = Math.floor(rnd() * (2 * d + 1)) - d, rem = d - Math.abs(dx), dy = 0;
    const dz = (rnd() < 0.5 ? -1 : 1) * rem;
    if (dx || dz) water.add(dx + ',64,' + dz);
  }
  const isWater = (x, y, z) => water.has(x + ',' + y + ',' + z), isAir = (x, y, z) => !isWater(x, y - 1, z) ? true : !water.has(x + ',' + y + ',' + z);
  const first = seq.find(c => (c[0] || c[2]) && isWater(...c) && isAir(...c));
  const got = Ax.seekWaterScan(0, 64, 0, N, isWater, isAir, 100, 64, 100);
  ok(first && got && got.x === first[0] + 0.5 && got.y === first[1] && got.z === first[2] + 0.5, 'layout ' + i + ' picks the iterateOutwards-first cell');
  const m = manhattan(isWater, isAir);
  if (m && first && (m[0] !== first[0] || m[2] !== first[2])) differs++;
}
breaks++; ok(differs > 0, 'anti-vacuity: Manhattan-sort order differs from vanilla in at least one layout'); if (differs) console.log('   ✓ Manhattan differs in ' + differs + ' layouts');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails}\n ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
