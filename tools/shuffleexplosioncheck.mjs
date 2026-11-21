#!/usr/bin/env node
// shuffleexplosioncheck.mjs -- #5187: Explosion.affectWorld does Collections.shuffle(affected, world.random)
// before breaking; break order and the RNG stream afterwards must match an independent Java reference.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07za_explosion.js'], dom: false });
const Ex = M.Explosion;
// independent java.util.Random (BigInt)
function jr(seed) {
  let s = (BigInt(seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n);
  const next = (b) => { s = (s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(BigInt.asIntN(32, s >> BigInt(48 - b))); };
  return { nextInt(n) {
    if ((n & -n) === n) return Number((BigInt(n) * BigInt(next(31))) >> 31n);
    let bits, v; do { bits = next(31); v = bits % n; } while (((bits - v + (n - 1)) | 0) < 0); return v; } };
}
function refShuffle(list, r) { for (let i = list.length; i > 1; i--) { const j = r.nextInt(i); [list[i-1], list[j]] = [list[j], list[i-1]]; } return list; }
const keys = Array.from({ length: 12 }, (_, i) => 'k' + i);
let fails = 0, breaks = 0;
function run(shuffleFn) {
  const r = jr(12345), want = refShuffle(keys.slice(), jr(12345)), wr = jr(12345); refShuffle(keys.slice(), wr);
  const got = shuffleFn(keys.slice(), r);
  return { ok: JSON.stringify(got) === JSON.stringify(want) && r.nextInt(1000) === wr.nextInt(1000), got };
}
if (!run((l, r) => Ex.shuffleKeys(l, r)).ok) { fails++; console.log('FAIL: shuffle differs from Java reference'); }
if (run((l) => l).ok) fails++; else breaks++;                       // no shuffle must be caught
if (run((l, r) => (r.nextInt(2), Ex.shuffleKeys(l, r))).ok) fails++; else breaks++;  // extra draw must be caught
console.log(fails ? `FAIL ${fails}` : `ok shuffleexplosioncheck: ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
