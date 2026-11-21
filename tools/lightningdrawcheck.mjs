#!/usr/bin/env node
// lightningdrawcheck.mjs — #5268: the lightning_bolt entity draw (ER.lightningQuads).
// Rebuilds the vertex list for fixed seeds from a separate transcription of
// LightningEntityRenderer.render/drawBranch (.decomp) on an independent java.util.Random
// (two 24-bit limbs, no BigInt) and compares every coordinate; proves it can fail (D-30).
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07h_entities.js', '07i_entitylist.js',
  '07zz_xporb.js', '07j_entityrender.js'], initReg: false });
const ER = M.EntityRender;

// independent java.util.Random: 48-bit state as hi/lo 24-bit limbs
function jrand(seed) {
  let lo = (Number(BigInt(seed) & 0xFFFFFFn) ^ 0xECE66D) >>> 0;
  let hi = (Number((BigInt(seed) >> 24n) & 0xFFFFFFn) ^ 0x5DE) >>> 0;
  const MLO = 0xECE66D, MHI = 0x5DE;
  const next = (bits) => {
    const pl = lo * MLO + 0xB;
    const nlo = pl % 16777216;
    const nhi = (hi * MLO + lo * MHI + Math.floor(pl / 16777216)) % 16777216;
    lo = nlo; hi = nhi;
    return Math.floor((hi * 16777216 + lo) / 2 ** (48 - bits));
  };
  return { next, nextInt(b) { let x, v; do { x = next(31); v = x % b; } while (x - v + (b - 1) > 2147483647); return v; } };
}
const f = Math.fround;
function reference(seed, layers = 4) {
  const q = [], r = jrand(seed), X = [], Z = [];
  let x = 0, z = 0;
  for (let i = 7; i >= 0; i--) { X[i] = x; Z[i] = z; x += r.nextInt(11) - 5; z += r.nextInt(11) - 5; }
  const branch = (a, b, y, c, d, h1, h2, f12, f13, f14, f15) => q.push([
    [a + (f12 ? h2 : -h2), y * 16, b + (f13 ? h2 : -h2)],
    [c + (f12 ? 0 : 0) + (f12 ? h1 : -h1) * 0 + (f12 ? h1 : -h1) * 0, 0, 0]].slice(0, 1).concat([
    [c + (f12 ? h1 : -h1), (y + 1) * 16, d + (f13 ? h1 : -h1)],
    [c + (f14 ? h1 : -h1), (y + 1) * 16, d + (f15 ? h1 : -h1)],
    [a + (f14 ? h2 : -h2), y * 16, b + (f15 ? h2 : -h2)]]));
  for (let L = 0; L < layers; L++) {
    const r2 = jrand(seed);
    for (let s = 0; s < 3; s++) {
      let hiY = 7, lowY = 0;
      if (s > 0) hiY = 7 - s;
      if (s > 0) lowY = hiY - 2;
      let a = X[hiY] - x, b = Z[hiY] - z;
      for (let y = hiY; y >= lowY; y--) {
        const c = a, d = b;
        if (s === 0) { a += r2.nextInt(11) - 5; b += r2.nextInt(11) - 5; }
        else { a += r2.nextInt(31) - 15; b += r2.nextInt(31) - 15; }
        let h1 = f(0.1 + L * 0.2); if (s === 0) h1 = f(h1 * f(y * 0.1 + 1));
        let h2 = f(0.1 + L * 0.2); if (s === 0) h2 = f(h2 * f((y - 1) * 0.1 + 1));
        // vanilla passes ($$10=h1 top... ) exactly as drawBranch's ($$10,$$11)
        branch(a, b, y, c, d, h1, h2, 0, 0, 1, 0);
        branch(a, b, y, c, d, h1, h2, 1, 0, 1, 1);
        branch(a, b, y, c, d, h1, h2, 1, 1, 0, 1);
        branch(a, b, y, c, d, h1, h2, 0, 1, 0, 0);
      }
    }
  }
  return q;
}
function same(A, B) {
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i++) for (let k = 0; k < 4; k++) for (let c = 0; c < 3; c++)
    if (Math.abs(A[i][k][c] - B[i][k][c]) > 1e-4) return false;
  return true;
}

ok((jrand(42).next(32) | 0) === -1170105035, 'reference Random(42).nextInt() is java\'s -1170105035');
ok((new ER.JRandom(42).next(32) | 0) === -1170105035, 'engine Random(42).nextInt() is java\'s -1170105035');
const seeds = [0, 1, 42, 123456789, 4294967295, 3000000000];
for (const s of seeds) ok(same(ER.lightningQuads(s), reference(s)), `seed ${s}: engine quads == vanilla algorithm`);
ok(ER.lightningQuads(5).length === 4 * (8 + 3 + 3) * 4, 'quad count: 4 layers x (8+3+3 segments) x 4 faces');
ok(ER.SHAPE.lightning_bolt && !ER.OWED.some((l) => l.startsWith('lightning_bolt')), 'lightning_bolt is drawn, not owed');

// anti-vacuity: each break must turn the comparison red
const ref = reference(42);
const brk = (name, mut) => { breaks++; const bad = mut(); if (same(bad, ref)) fails.push('anti-vacuity: ' + name + ' not caught'); else { pass++; console.log('  ✓ break caught: ' + name); } };
brk('other seed', () => ER.lightningQuads(43));
brk('dropped layer', () => ER.lightningQuads(42, 3));
brk('shifted vertex', () => { const b = ER.lightningQuads(42); b[3][1][0] += 1; return b; });
brk('dropped quad', () => ER.lightningQuads(42).slice(1));

console.log(`${breaks} breaks caught`);
console.log(`\n${pass} checks passed, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { fails.forEach((m) => console.log('  ✗ ' + m)); process.exit(1); }
