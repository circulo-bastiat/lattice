#!/usr/bin/env node
// carvers11601check.mjs — #11601: proves 04i_carvers.js NetherCaveCarver (Carvers.initNether/carveNether), FloatProvider
// (constant/uniform/trapezoid via floatProvider) and the tunnel thickness, with SOURCE breaks.
import { loadEngine } from './loadsrc.mjs';
const F = '04i_carvers.js';
const fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine(patch ? { patch } : {});
  const CV = M.Carvers, NR = M.States.stateOf('netherrack'), LAVA = M.States.stateOf('lava');
  const G = M.Gen; try { G.seed = 1234; } catch (e) {}
  CV.init(G); CV.initNether(G);
  const o = { carved: 0, lavaBad: 0, lava: 0, air: 0, airBad: 0, sig: '' };
  for (let cx = 0; cx < 6; cx++) for (let cz = 0; cz < 6; cz++) {
    const S = new Uint16Array(128 * 256).fill(NR);
    const n = CV.carveNether(S, cx, cz, 4242, 0); o.carved += n;
    for (let y = 0; y < 128; y++) for (let i = 0; i < 256; i++) {
      const v = S[(y << 8) | i];
      if (v === LAVA) { o.lava++; if (y > 31) o.lavaBad++; }
      else if (v === 0) { o.air++; if (y <= 31 || y === 0 || y === 127) o.airBad++; }
    }
    o.sig += n + ',';
  }
  let h = 0, tot = 0; for (let cx = 0; cx < 40; cx++) for (let cz = 0; cz < 40; cz++) { const a = CV.nodesFor(cx, cz); tot += a.length; for (let i = 0; i < a.length; i += 7) h = (h * 31 + Math.round(a[i] * 8)) | 0; }
  o.ow = tot + ':' + h; o.sig += o.ow;
  o.nodes = CV.netherNodesFor(2, 3, 4242).length;
  return o;
}
const A = trial(null);
ok(A.carved > 2000, 'carving removes volume ' + A.carved);
ok(A.lava > 0 && A.air > 0, 'lava and air both appear');
ok(A.lavaBad === 0 && A.airBad === 0, 'lava only <=y31, air above');
ok(A.ow.split(':')[0] > 0, 'overworld carvers produce nodes ' + A.ow);
ok(A.nodes % 6 === 0, 'sextuples');
const BR = [
  ['lavaband', 'wy <= NETHER_LAVA ? LAVA', 'wy <= NETHER_LAVA + 40 ? LAVA', null],
  ['uniform', 'return lo + r.nextFloat() * (hi - lo);', 'return lo;', null],
  ['trapezoid', 'return min + r.nextFloat() * mid + r.nextFloat() * half;', 'return min + r.nextFloat() * mid;', null],
  ['thickness', 'if (r.nextInt(10) === 0) f *= r.nextFloat() * r.nextFloat() * 3 + 1;', '', null],
  ['netherwidth', '(r.nextFloat() * 2 + r.nextFloat()) * 2 : tunnelThickness(r)', 'tunnelThickness(r) : tunnelThickness(r)', null],
  ['maxcaves', 'maxCaves: 10', 'maxCaves: 1', null],
];
for (const [key, a, b] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch (e) { X = null; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  if (X && X.sig === A.sig && X.lavaBad === A.lavaBad) fails.push('break not caught: ' + key);
}
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('carvers11601check: ' + pass + ' ok, ' + breaks + ' breaks caught');
