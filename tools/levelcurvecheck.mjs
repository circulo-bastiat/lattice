#!/usr/bin/env node
// levelcurvecheck.mjs — G21: the xp level curve against the DECOMP, not against a PLAN formula.
// Parses the three expressions of PlayerEntity.getNextLevelExperience and checks Sv.addXp from a
// total gives the level/bar the decomp curve gives, at totals for levels 5, 20, 40 and +-1 point.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const NS = {};
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '14d_survival.js'])
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
const Sv = NS.Survival;

const java = readFileSync(join(ROOT, '.decomp/net/minecraft/entity/player/PlayerEntity.java'), 'utf8');
const m = java.match(/public int getNextLevelExperience\(\) \{([\s\S]*?)\n    \}/);
if (!m) { console.log('levelcurvecheck FAIL: getNextLevelExperience not found in decomp'); process.exit(1); }
const body = m[1];
const t30 = body.match(/experienceLevel >= 30\) \{\s*return ([^;]+);/);
const t15 = body.match(/return this\.experienceLevel >= 15 \? ([^:]+?) : ([^;]+);/);
if (!t30 || !t15) { console.log('levelcurvecheck FAIL: cannot parse the three expressions'); process.exit(1); }
const mk = s => new Function('L', 'return ' + s.replace(/this\.experienceLevel/g, 'L') + ';');
const hi = mk(t30[1]), mid = mk(t15[1]), lo = mk(t15[2]);
console.log('levelcurvecheck — G21: ' + [t30[1], t15[1], t15[2]].join('  |  '));

const decompNeed = (L, f) => f ? f(L) : (L >= 30 ? hi(L) : L >= 15 ? mid(L) : lo(L));
// decomp level/bar from a total (the loop giveExperiencePoints converges to)
function ref(total, f) {
  let L = 0, left = total;
  while (left >= decompNeed(L, f)) { left -= decompNeed(L, f); L++; }
  return { L, left };
}
const refTotal = (lvl, f) => { let t = 0; for (let i = 0; i < lvl; i++) t += decompNeed(i, f); return t; };

let pass = 0; const fails = [];
function cases(f) {
  let bad = 0, n = 0;
  for (const lvl of [5, 20, 40]) {
    const base = refTotal(lvl, f);
    for (const d of [-1, 0, 1]) {
      const total = base + d, r = ref(total, f);
      const e = {}; Sv.addXp(e, total);
      n++;
      const good = e.xpLevel === r.L && Math.abs(e.xpProgress - r.left / decompNeed(r.L, f)) < 1e-9 && e.xpTotal === total;
      if (!good) { bad++; if (!f) fails.push(`level ${lvl}${d >= 0 ? '+' : ''}${d}: total ${total} engine L${e.xpLevel} decomp L${r.L}`); }
    }
  }
  return { bad, n };
}
const real = cases(null);
pass += real.n - real.bad;
// per-level cost agreement as well
for (let L = 0; L < 60; L++) if (Sv.xpNeeded(L) === decompNeed(L)) pass++; else fails.push('xpNeeded(' + L + ')');
// known anchors of the curve: level 5 = 55, 20 = 550, 40 = 2920 total points (decomp sums)
for (const [l, t] of [[5, 55], [20, 550], [40, 2920]]) {
  if (refTotal(l) === t && Sv.totalXpFor(l) === t) pass++; else fails.push('anchor ' + l);
}

// anti-vacuity: the level 1-15 expression everywhere must be caught at level 40 (and 20)
let breaks = 0;
const flat = L => lo(L);
const b1 = cases(flat);
if (b1.bad > 0) { breaks++; console.log('   ✓ flat 7+2L curve caught (' + b1.bad + ' cases)'); } else fails.push('anti-vacuity: flat curve not caught');
const sw = L => (L >= 30 ? mid(L) : lo(L)); // tier 15-29 dropped
if (cases(sw).bad > 0) { breaks++; console.log('   ✓ missing 15-29 tier caught'); } else fails.push('anti-vacuity: tier drop not caught');
const off = L => decompNeed(L) + (L === 39 ? 1 : 0);
if (cases(off).bad > 0) { breaks++; console.log('   ✓ off-by-one at level 39 caught'); } else fails.push('anti-vacuity: off-by-one not caught');

if (fails.length) { console.log('levelcurvecheck FAIL'); fails.slice(0, 20).forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log(`levelcurvecheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
