#!/usr/bin/env node
// lockstep-spawnbat -- #8649 (G18c-L13): BatEntity.canSpawn light/sea-level/halloween rule (engine Bat.lightRule + Bat.isHalloween)
// against a verbatim port of .decomp BatEntity.canSpawn (:220-241): y 40..90 x light 0..10 x 20 calendar dates (30 Oct, 31 Oct, 1 Nov, 2 Nov
// included) x 20 salts, the SAME random stream into both sides (nextBoolean then nextInt(bound)). Halloween window shifted one day must be caught.
import { harness } from './referee/lockstep/zombielane.mjs';

const { M } = harness();
const Bt = M.Bat;
let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { if (!c) { bad++; if (bad < 20) console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const stream = (s) => { let a = (s + 1) * 2654435761 >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const mkRnd = (s) => { const r = stream(s); return (b) => Math.floor(r() * b); };
const SEA = 63;
const halloweenRef = (mon, day) => (mon === 10 && day >= 20) || (mon === 11 && day <= 3);
function canSpawnRef(y, light, mon, day, rnd) {
  if (y >= SEA) return false;
  let bound = 4;
  if (halloweenRef(mon, day)) bound = 7;
  else if (rnd(2) === 1) return false;
  return light > rnd(bound) ? false : true;
}
const DATES = [[1, 15], [3, 1], [5, 20], [7, 4], [9, 30], [10, 1], [10, 19], [10, 20], [10, 21], [10, 30], [10, 31], [11, 1], [11, 2], [11, 3], [11, 4], [11, 5], [12, 25], [12, 31], [2, 28], [6, 15]];
function sweep(isHal, quiet) {
  let div = 0;
  for (let s = 0; s < 20; s++) for (const [mon, day] of DATES) {
    const date = new Date(2026, mon - 1, day);
    const halloween = isHal(date);
    const a = mkRnd(s * 31 + mon * 7 + day), b = mkRnd(s * 31 + mon * 7 + day);
    for (let y = 40; y <= 90; y++) for (let light = 0; light <= 10; light++) {
      n++;
      const e = Bt.lightRule(y, light, SEA, a, halloween), r = canSpawnRef(y, light, mon, day, b);
      if (e !== r) { div++; if (!quiet && div < 5) ok(false, `salt ${s} ${mon}/${day} y${y} light${light}: engine ${e} vanilla ${r}`); }
    }
  }
  return div;
}
for (const [mon, day] of DATES) ok(Bt.isHalloween(new Date(2026, mon - 1, day)) === halloweenRef(mon, day), `isHalloween ${mon}/${day}`);
const real = (d) => Bt.isHalloween(d);
const d0 = sweep(real, false);
ok(d0 === 0, `${d0} divergences`);
caught(sweep((d) => Bt.isHalloween(new Date(d.getTime() + 86400000 * 1.0)), true) > 0, 'halloween window shifted +1 day');
caught(sweep((d) => Bt.isHalloween(new Date(d.getTime() - 86400000 * 1.0)), true) > 0, 'halloween window shifted -1 day');
caught(sweep((d) => { const m = d.getMonth() + 1, dd = d.getDate(); return (m === 10 && dd >= 21) || (m === 11 && dd <= 3); }, true) > 0, 'window start 21 Oct');
console.log(`${n} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
