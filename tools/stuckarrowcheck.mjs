#!/usr/bin/env node
// stuckarrowcheck.mjs - #5800 (G18a-R1): StuckObjectsFeatureRenderer's placement loop.
//   node tools/stuckarrowcheck.mjs
// ER.stuckObjectPlacements(entityId, count, parts) is compared against a golden from a straight BigInt
// transcription of java.util.Random and of the .decomp loop (nextInt part, nextInt cuboid, 3x nextFloat).
// Anti-vacuity: a different draw order, a different seed and a wrong nextInt must each fail the compare.
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const src = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/feature/StuckObjectsFeatureRenderer.java', 'utf8');
const fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
ok(/getRandomPart\(\$\$11\);\s*ModelPart\.Cuboid \$\$14 = \$\$13\.getRandomCuboid\(\$\$11\)/.test(src) && /new Random\(\(long\)\$\$3\.getId\(\)\)/.test(src), 'the jar loop no longer has the shape transcribed here');

const M = loadEngine({ extra: ['07j_entityrender.js'], dom: false });
const ER = M.EntityRender;

const MASK = (1n << 48n) - 1n;
class Jv {
  constructor(seed) { this.s = (BigInt(seed) ^ 0x5DEECE66Dn) & MASK; }
  next(b) { this.s = (this.s * 0x5DEECE66Dn + 0xBn) & MASK; return Number(BigInt.asIntN(32, this.s >> BigInt(48 - b))); }
  nextInt(n) {
    if ((n & -n) === n) return Number((BigInt(n) * BigInt(this.next(31))) >> 31n);
    let b, v; do { b = this.next(31); v = b % n; } while (b - v + (n - 1) | 0 < 0 && (b - v + (n - 1)) > 0x7fffffff);
    return v;
  }
  nextFloat() { return this.next(24) / 16777216; }
}
// player-like part list: 6 parts, uneven cuboid counts (non-power-of-two bounds exercise the rejection loop)
const box = (a, b, c, d, e, f) => ({ minX: a, maxX: b, minY: c, maxY: d, minZ: e, maxZ: f });
const PARTS = [
  { cuboids: [box(-4, 4, -8, 0, -4, 4), box(-4.25, 4.25, -8.25, 0.25, -4.25, 4.25)] },
  { cuboids: [box(-4, 4, 0, 12, -2, 2), box(-4.25, 4.25, -0.25, 12.25, -2.25, 2.25)] },
  { cuboids: [box(-3, 1, -2, 10, -2, 2)] }, { cuboids: [box(-1, 3, -2, 10, -2, 2)] },
  { cuboids: [box(-2, 2, 0, 12, -2, 2)] }, { cuboids: [box(-2, 2, 0, 12, -2, 2), box(-2.25, 2.25, -0.25, 12.25, -2.25, 2.25)] }
];
const golden = (id, n, order = 0) => {
  const r = new Jv(id), out = [];
  for (let i = 0; i < n; i++) {
    let pi, ci;
    if (order === 1) { ci = r.nextInt(2); pi = r.nextInt(PARTS.length); const k = PARTS[pi].cuboids; ci = Math.min(ci, k.length - 1); }
    else { pi = r.nextInt(PARTS.length); ci = r.nextInt(PARTS[pi].cuboids.length); }
    const c = PARTS[pi].cuboids[ci], f = [r.nextFloat(), r.nextFloat(), r.nextFloat()];
    const lerp = (t, a, b) => a + t * (b - a);
    out.push({ part: pi, cuboid: ci, t: [lerp(f[0], c.minX, c.maxX) / 16, lerp(f[1], c.minY, c.maxY) / 16, lerp(f[2], c.minZ, c.maxZ) / 16], f: f.map((x) => -1 * (x * 2 - 1)) });
  }
  return out;
};
const same = (a, b) => a.length === b.length && a.every((p, i) => p.part === b[i].part && p.cuboid === b[i].cuboid
  && [...p.t, ...p.f].every((x, j) => Math.abs(x - [...b[i].t, ...b[i].f][j]) < 1e-6));

for (const id of [7, 0, 1, 12345, 2147483647]) ok(same(ER.stuckObjectPlacements(id, 3, PARTS), golden(id, 3)), `entity ${id}: placements differ from the Java-Random golden`);
ok(same(ER.stuckObjectPlacements(7, 40, PARTS), golden(7, 40)), 'entity 7 x40 differs');
ok(new Set(ER.stuckObjectPlacements(7, 40, PARTS).map((p) => p.part)).size > 2, 'placements do not spread over parts');

const brk = (c, m) => { breaks++; if (!c) fails.push('anti-vacuity: ' + m); };
brk(!same(ER.stuckObjectPlacements(7, 3, PARTS), golden(7, 3, 1)) || !same(ER.stuckObjectPlacements(7, 40, PARTS), golden(7, 40, 1)), 'a different draw order still matches');
brk(!same(ER.stuckObjectPlacements(8, 40, PARTS), golden(7, 40)), 'a different seed still matches');
brk(!same(ER.stuckObjectPlacements(7, 40, PARTS), golden(7, 40).map((p) => ({ ...p, t: [p.t[0] + 0.01, p.t[1], p.t[2]] }))), 'a shifted point still matches');

if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`stuckarrowcheck: ${pass} checks ok, ${breaks} breaks caught`);
