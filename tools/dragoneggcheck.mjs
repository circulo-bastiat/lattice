#!/usr/bin/env node
// dragoneggcheck.mjs — #9243: DragonEggBlock.teleport stays inside the world border, RNG order per decomp.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
function mutate(s, a, b) { if (!s.includes(a)) return s; return s.replace(a, b); } // no-op guard: includes() checked
function load(mut) {
  const NS = {}; globalThis.MCL = NS; NS.Survive = {};
  for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js', '02c_states.js', '03_section.js', '05_mesher.js', '07_world.js'])
    new Function('MCL', mut ? mut(read(f)) : read(f))(NS);
  return NS.World;
}
function lcg(seed) { let s = seed >>> 0; const n = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0); return { nextInt: (k) => Math.floor(n() / 4294967296 * k), log: [] }; }
function run(W) {
  const fails = [];
  W.border.setSize(20); W.border.centerX = 0; W.border.centerZ = 0;
  W.getBlock = () => 0; let set = [];
  W.setBlock = (x, y, z, id) => set.push([x, y, z, id]);
  for (let seed = 1; seed <= 300; seed++) {
    const r = lcg(seed); set = [];
    const t = W.dragonEggTeleport(8, 64, 0, r);
    if (t && !W.border.contains(t[0], t[2])) fails.push('outside border seed ' + seed);
  }
  // order: first draw sequence matches x1,x2,y1,y2,z1,z2
  const seq = [], r = { nextInt: (k) => { seq.push(k); return 0; } };
  W.dragonEggTeleport(0, 64, 0, r);
  if (seq.slice(0, 6).join() !== '16,16,8,8,16,16') fails.push('rng order ' + seq.slice(0, 6));
  return fails;
}
const f = run(load()); if (f.length) { console.log('FAIL\n' + f.join('\n')); process.exit(1); }
let caught = 0;
const bad = run(load((s) => s.replace('&& WB.contains(tx, tz)', ''))); if (bad.length) { caught++; console.log('✓ break caught'); }
const bad2 = run(load((s) => s.replace('r.nextInt(8) - r.nextInt(8)', 'r.nextInt(16) - r.nextInt(16)'))); if (bad2.length) { caught++; console.log('✓ break caught'); }
console.log(` assertions passed .. 301
 failures ........... 0\n${caught} breaks caught`);
if (caught < 2) process.exit(1);
