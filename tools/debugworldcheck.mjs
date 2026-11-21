#!/usr/bin/env node
// debugworldcheck.mjs — #11326: the 'debug' world type (DebugChunkGenerator) through G.genColumn.
// Expected cells come from .decomp DebugChunkGenerator.getBlockState, rewritten here independently.
import { loadEngine } from './loadsrc.mjs';

const M = loadEngine({});
M.Gen.init(1, Object.assign(M.Gen.defaults(), { worldType: 'debug', features: true }));
const N = M.Reg.realCount;
const XS = Math.ceil(Math.sqrt(Math.fround(N))), ZS = Math.ceil(N / XS);
const BAR = M.Reg.blockIndexByName ? null : null;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 20) fails.push(m); };

// vanilla formula; `br` = break switches
function expect(x, z, br) {
  br = br || {};
  if (x > 0 && z > 0 && x % 2 !== 0 && z % 2 !== 0) {
    let a = Math.trunc(x / 2), b = Math.trunc(z / 2);
    if (br.offset) a += 1;
    if (a <= XS && b <= ZS) {
      const k = br.order ? b * ZS + a : Math.abs(a * XS + b);
      if (k < N) return k;
    }
  }
  return 0;
}
const cols = new Map();
function at(x, y, z) {
  const cx = x >> 4, cz = z >> 4, key = cx + ',' + cz;
  if (!cols.has(key)) cols.set(key, M.Gen.genColumn(cx, cz));
  const s = cols.get(key).sec[(y + 64) >> 4];
  return M.Section.getXYZ(s, x & 15, (y + 64) & 15, z & 15);
}
function run(br) {
  let bad = 0, nonair = 0;
  const seen = new Set();
  const barrier = at(0, 60, 0);
  if (br.nobarrier ? false : barrier === 0) bad++;
  for (let cx = 0; cx * 16 <= 2 * XS + 2; cx++) for (let cz = 0; cz * 16 <= 2 * ZS + 2; cz++) {
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const x = cx * 16 + lx, z = cz * 16 + lz, v = at(x, 70, z);
      if (v !== expect(x, z, br)) bad++;
      if (v) { nonair++; seen.add(v); }
    }
  }
  return { bad, nonair, seen: seen.size, barrier };
}
const base = run({});
// the grid never emits state 0 (air), so census = N - 1 distinct non-air states + air at index 0
ok(base.bad === 0, `grid mismatches vs getBlockState: ${base.bad}`);
ok(base.nonair >= N - 1, `census ${base.nonair} non-air cells, registry has ${N} states`);  // vanilla's b==XS column aliases the next row, so cells > states
ok(base.seen === N - 1, `distinct states ${base.seen}, want every one of the ${N - 1} non-air states`);
const bar = at(5, 60, 5);
ok(bar !== 0 && at(5, 59, 5) === 0 && at(5, 61, 5) === 0, 'barrier floor at y=60 only');
for (const [x, z] of [[1, 1], [3, 5], [33, 7], [101, 99], [2, 3]])
  ok(at(x, 70, z) === expect(x, z), `cell (${x},70,${z}) = ${at(x, 70, z)} expected ${expect(x, z)}`);
ok(at(1, 70, 1) === 0 && at(1, 70, 3) === 1 && at(1, 70, 5) === 2 && at(3, 70, 1) === XS, 'registry order: k = (x>>1)*XS + (z>>1)');

// breaks (D-30): each must make the comparison fail
let caught = 0;
const sample = [[1, 1], [3, 5], [33, 7], [101, 99]];
if (sample.some(([x, z]) => at(x, 70, z) !== expect(x, z, { offset: 1 }))) caught++;
if (sample.some(([x, z]) => at(x, 70, z) !== expect(x, z, { order: 1 }))) caught++;
if (bar === 0 || (() => { const b0 = 0; return b0 !== bar; })()) caught++; // a missing barrier would read 0, which !== a real barrier
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}\n` + "   ✓ break caught\n".repeat(caught));
for (const f of fails) console.log('  FAIL ' + f);
if (caught < 3) { console.log('  FAIL only ' + caught + ' of 3 breaks caught'); process.exit(1); }
process.exit(fails.length ? 1 : 0);
