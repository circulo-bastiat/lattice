#!/usr/bin/env node
// jrandomcheck.mjs — #6211: NS.JRandom is bit-identical to the JDK's java.util.Random.
// Golden = tools/referee/lockstep/jrandom.golden.txt (JRandomGolden.java, real JVM): 5 seeds x 300
// draws of nextInt/nextInt(bound)/nextLong/nextFloat/nextDouble/nextBoolean/nextGaussian.
// Proves it can fail (D-30): dropped rejection loop, dropped gaussian spare, wrong scramble.
import fs from 'fs';
import { loadEngine } from './loadsrc.mjs';

const M = loadEngine({ extra: ['02m_jrandom.js'], initReg: false });
const bounds = [1, 2, 3, 10, 16, 100, 1000, 65536, 1 << 30, 1431655765, 2147483647];
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const f64 = new Float64Array(1), u64 = new BigUint64Array(f64.buffer);
const fbits = (x) => { f32[0] = x; return String(u32[0] | 0); };
const dbits = (x) => { f64[0] = x; return String(BigInt.asIntN(64, u64[0])); };
const draw = {
  nextInt: (r) => String(r.nextInt()), nextIntB: (r, i) => String(r.nextInt(bounds[i % bounds.length])),
  nextLong: (r) => String(r.nextLong()), nextFloat: (r) => fbits(r.nextFloat()),
  nextDouble: (r) => dbits(r.nextDouble()), nextBoolean: (r) => (r.nextBoolean() ? '1' : '0'),
  nextGaussian: (r) => dbits(r.nextGaussian()),
};
const lines = fs.readFileSync(new URL('./referee/lockstep/jrandom.golden.txt', import.meta.url), 'utf8').trim().split('\n');
function run(R) {
  let bad = 0, n = 0;
  for (const ln of lines) {
    const [name, seed, ...exp] = ln.split(' ');
    const r = new R(BigInt(seed));
    exp.forEach((e, i) => { n++; let g; try { g = draw[name](r, i); } catch (x) { g = 'ERR'; } if (g !== e) bad++; });
  }
  return { bad, n };
}
const base = run(M.JRandom);
let fails = base.bad ? 1 : 0;
if (base.n < 5 * 7 * 300) { console.log('golden too small'); fails++; }

// faults: each must be reported
const P = M.JRandom.prototype;
const faults = {
  'no rejection loop': () => { const o = P.nextInt; P.nextInt = function (b) { if (b === undefined || (b & -b) === b) return o.call(this, b); return this.next(31) % b; }; return () => (P.nextInt = o); },
  'no gaussian spare': () => { const o = P.nextGaussian; P.nextGaussian = function () { this.haveG = false; return o.call(this); }; return () => (P.nextGaussian = o); },
  'wrong scramble': () => { const o = P.setSeed; P.setSeed = function (s) { o.call(this, BigInt(s) + 1n); }; return () => (P.setSeed = o); },
};
let caught = 0;
for (const [k, inject] of Object.entries(faults)) {
  const undo = inject(); const r = run(M.JRandom); undo();
  if (r.bad > 0) { caught++; console.log(`  ✓ fault caught: ${k}`); } else { console.log(`FAULT NOT CAUGHT: ${k}`); fails++; }
}
console.log(`${caught} breaks caught`);
console.log(`\n${base.n - base.bad} checks passed, ${fails} failures, ${caught} breaks caught`);
process.exit(fails ? 1 : 0);
