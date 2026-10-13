#!/usr/bin/env node
// stalactitetridentcheck.mjs — G17-K8. PointedDripstoneBlock.onProjectileHit: only a trident faster than 0.6
// destroys the tip (drop included). Runs the real Cb.onProjectileHit source on a stub world; breaks its own threshold.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/14j_combat.js'), 'utf8');
const m = SRC.match(/Cb\.TRIDENT_DRIPSTONE_SPEED = [^;]+;[\s\S]*?Cb\.onProjectileHit = function[\s\S]*?\n  \};/);
if (!m) { console.log('FAIL onProjectileHit not found'); process.exit(1); }
function run(src, e, speed, block) {
  const broken = [];
  const NS = {
    World: { getBlock: () => 7 }, Reg: { names: { 3: block } }, States: { block: { 7: 3 } },
    Use: { breakForFluid: (x, y, z, st) => broken.push([x, y, z, st]) },
  };
  const Cb = {};
  new Function('NS', 'Cb', src)(NS, Cb);
  const r = Cb.onProjectileHit(e, 1, 2, 3, speed);
  return { r, broken };
}
function verify(src) {
  const f = [];
  const t = (e, s, b, want, msg) => { const o = run(src, e, s, b); if (o.r !== want || (o.broken.length === 1) !== want) f.push(msg); };
  t({ type: 'trident' }, 0.7, 'pointed_dripstone', true, 'trident 0.7 must destroy');
  t({ type: 'trident' }, 0.5, 'pointed_dripstone', false, 'trident 0.5 must not destroy');
  t({ type: 'arrow' }, 3, 'pointed_dripstone', false, 'arrow must not destroy');
  t({ type: 'trident' }, 3, 'stone', false, 'non-dripstone untouched');
  return f;
}
let breaks = 0, bad = verify(m[0]);
if (bad.length) { console.log('FAIL ' + bad.join('; ')); process.exit(1); }
const mut = m[0].replace('SPEED = 0.6', 'SPEED = 0.4');
if (verify(mut).length) breaks++; else { console.log('FAIL mutation not caught'); process.exit(1); }
console.log(`stalactitetridentcheck: ok, ${breaks} breaks caught`);
