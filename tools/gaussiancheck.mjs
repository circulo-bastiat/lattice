#!/usr/bin/env node
// gaussiancheck.mjs — #5466: java.util.Random.nextGaussian (polar method, cached second value).
// Pins seed 42's first value to the java literal and the first 10 to an independent two-limb
// reference; the sites (potion throw, spawn follow bonus) must draw the same cached pair.
// Anti-vacuity (D-30): Box-Muller over the same source must fail the pin.
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07h_entities.js', '07i_entitylist.js',
  '07zz_xporb.js', '07zx_particle.js', '07j_entityrender.js', '14b_physics.js', '14e_gamemode.js', '07q_effects.js', '07y_equip.js', '14f_inventory.js', '14i_hand.js', '14j_combat.js', '07zzh_blaze.js'], initReg: false });
import { readFileSync } from 'node:fs';
const require_blaze = () => readFileSync(new URL('../src/07zzh_blaze.js', import.meta.url), 'utf8');
const ER = M.EntityRender;

function jrand(seed) {
  let lo = (Number(BigInt(seed) & 0xFFFFFFn) ^ 0xECE66D) >>> 0;
  let hi = (Number((BigInt(seed) >> 24n) & 0xFFFFFFn) ^ 0x5DE) >>> 0;
  const next = (bits) => {
    const pl = lo * 0xECE66D + 0xB, nlo = pl % 16777216;
    const nhi = (hi * 0xECE66D + lo * 0x5DE + Math.floor(pl / 16777216)) % 16777216;
    lo = nlo; hi = nhi;
    return Math.floor((hi * 16777216 + lo) / 2 ** (48 - bits));
  };
  return () => (next(26) * 134217728 + next(27)) / 2 ** 53;
}
function refGauss(seed, n) {
  const d = jrand(seed), out = []; let spare = null;
  while (out.length < n) {
    if (spare !== null) { out.push(spare); spare = null; continue; }
    let a, b, s;
    do { a = 2 * d() - 1; b = 2 * d() - 1; s = a * a + b * b; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s); spare = b * m; out.push(a * m);
  }
  return out;
}
// #6139: Cb.gauss routes through the polar method with the cached spare
{
  const Cb = M.Combat || M.Cb;
  const run = (gauss, sd) => { const d = jrand(sd); let n = 0; const f = () => { n++; return d(); };
    const o = [], draws = []; for (let i = 0; i < 10; i++) { const b = n; o.push(gauss(f)); draws.push(n - b); } return { o, draws }; };
  const pinOk = (g) => { const r = run(g, 42), ref = refGauss(42, 10);
    return r.o.every((v, i) => v === ref[i]) && r.draws.every((c, i) => c === (i % 2 ? 0 : 2)); };
  ok(Cb && pinOk(Cb.gauss), 'Cb.gauss differs from polar reference / draw count');
  const bmG = (f) => { let u = f(); const v = f(); if (!(u > 0)) u = 1e-12; return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  if (!pinOk(bmG)) { breaks++; console.log('✓ break caught: Cb.gauss Box-Muller body'); }
}
const seeds = [42, 0, 12345, -7];
function check(gen) {
  const bad = [];
  for (const sd of seeds) {
    const ref = refGauss(sd, 10), g = gen(sd);
    for (let i = 0; i < 10; i++) if (g[i] !== ref[i]) bad.push(sd + '#' + i);
  }
  const g42 = gen(42)[0];
  if (g42 !== 1.1419053154730547) bad.push('seed42 literal ' + g42);
  return bad;
}
const real = (sd) => { const r = new ER.JRandom(sd), o = []; for (let i = 0; i < 10; i++) o.push(r.nextGaussian()); return o; };
const bm = (sd) => { const r = new ER.JRandom(sd), o = []; for (let i = 0; i < 10; i++) { const u = r.nextDouble() || 1e-9; o.push(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r.nextDouble())); } return o; };
const bad = check(real);
ok(bad.length === 0, 'JRandom.nextGaussian mismatches: ' + bad.join(' '));
// bare-function source (potion / follow bonus / fire charge) shares the algorithm and caches the spare
{ const d = jrand(42); const o = []; for (let i = 0; i < 10; i++) o.push(M.U.polarGaussian(d)); 
  ok(o.every((v, i) => v === refGauss(42, 10)[i]), 'polarGaussian(fn) differs from reference'); }
// blaze: eyeOffset = 0.5 + nextGaussian()*3.0 with a seed-42 java replica as the entity random
{ const src = require_blaze();
  const ref = refGauss(42, 5).map((g) => 0.5 + g * 3.0);
  const d = jrand(42); const got = [];
  for (let i = 0; i < 5; i++) got.push(0.5 + M.U.polarGaussian(d) * 3.0);
  ok(got.every((v, i) => v === ref[i]), 'blaze eyeOffset draws differ from java');
  ok(!/Math\.cos\(2 \* Math\.PI/.test(src) && /polarGaussian\(r\)/.test(src), 'blaze gaussian is not polarGaussian');
  ok(Math.abs(ref[0] - (0.5 + 1.1419053154730547 * 3.0)) < 1e-12, 'blaze seed-42 first eyeOffset literal');
  const bmSrc = src.replace('NS.U.polarGaussian(r)', 'Math.cos(2 * Math.PI * r())');
  if (/Math\.cos\(2 \* Math\.PI/.test(bmSrc)) { breaks++; console.log('✓ break caught: blaze Box-Muller'); } }
for (const sd of [42, 7]) {   // #6143: Px._gauss on a fn source and on a JRandom pins to the java replica
  const ref = refGauss(sd, 20), d = jrand(sd), r = new ER.JRandom(sd);
  ok(ref.every((v, i) => M.Particle._gauss(d) === v), 'Px._gauss(fn) seed ' + sd);
  ok(ref.every((v, i) => M.Particle._gauss(r) === v), 'Px._gauss(JRandom) seed ' + sd);
}
for (const sd of seeds) if (check((x) => x === sd ? bm(x) : real(x)).length > 0) { breaks++; console.log("✓ break caught: Box-Muller, seed " + sd); }
ok(breaks === seeds.length + 2, 'Box-Muller was not caught');
// #6141: standBreakParticles draws 60 gaussians (x,y,z,vx,vy,vz per particle) from EntityList.random
{
  const run = (patch) => {
    const M2 = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07h_entities.js', '07i_entitylist.js', '14j_combat.js'], initReg: false });
    const calls = [];
    M2.Particle = { spawnBlockDust: (...a) => calls.push(a) };
    M2.States = { stateOf: () => 1 };
    M2.EntityList.random = jrand(42);
    if (patch) patch(M2);
    M2.Combat.standBreakParticles({ x: 10, y: 64, z: 20, width: 0.5, height: 1.975 });
    return calls;
  };
  const verify = (calls) => {
    const ref = refGauss(42, 60), w = 0.125, h = 1.975 / 4, y = 64 + 1.975 * (2 / 3);
    if (calls.length !== 10) return false;
    return calls.every((c, i) => { const r = ref.slice(i * 6, i * 6 + 6);
      return c[0] === 10 + r[0] * w && c[1] === y + r[1] * h && c[2] === 20 + r[2] * w && c[3] === r[3] * 0.05 && c[4] === r[4] * 0.05 && c[5] === r[5] * 0.05; });
  };
  ok(verify(run()), 'standBreakParticles does not consume the 60 polar gaussians in order');
  const old = (M2) => { const orig = M2.Particle.spawnBlockDust, rnd = M2.EntityList.random; M2.EntityList.random = () => rnd(); M2.U.polarGaussian = () => { const a = 1 - rnd(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * rnd()); }; };
  if (!verify(run(old))) { breaks++; console.log('✓ break caught: inline Box-Muller in standBreakParticles'); } else ok(false, 'inline Box-Muller not caught');
}
if (fails.length) console.log(fails.join("\n"));
console.log(`\n${pass} checks passed, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
