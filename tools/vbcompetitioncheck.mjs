#!/usr/bin/env node
// vbcompetitioncheck.mjs — G18f-J3: WorkStationCompetitionTask (VB.workStationCompetition).
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('vbcompetitioncheck — G18f-J3: WorkStationCompetitionTask');
const M = loadEngine({ extra: ['07o_profession.js', '07zv_villagerbrain.js'], dom: false });
const VB = M.VB;
const mk = (id, xp, site) => ({ id, type: 'villager', profession: 'farmer', tradeXp: xp, workstation: site ? { x: 1, y: 2, z: 3 } : null });
function run(xpA, xpB) {
  const a = mk(1, xpA, true), b = mk(2, xpB, true);
  VB.workStationCompetition(a, [b]);
  return { a, b };
}
let r = run(0, 10);
ok(!r.a.workstation && r.b.workstation, '0 vs 10: 0-xp must lose');
r = run(10, 0);
ok(r.a.workstation && !r.b.workstation, '10 vs 0: 0-xp must lose');
r = run(5, 5);
ok(!r.a.workstation && r.b.workstation, 'tie: first (reduce acc) loses, second keeps');
const c = mk(1, 0, true), d = mk(2, 10, true); d.profession = 'none';
VB.workStationCompetition(c, [d]);
ok(c.workstation, 'non-matching profession must not compete');
const e1 = mk(1, 0, true), e2 = mk(2, 10, false);
VB.workStationCompetition(e1, [e2]);
ok(e1.workstation, 'different job site must not compete');
// anti-vacuity: inverted comparison must fail the first case
let breaks = 0;
const orig = VB.keepJobSiteForMoreExperienced;
VB.keepJobSiteForMoreExperienced = (x, y) => { const w = (x.tradeXp | 0) < (y.tradeXp | 0) ? x : y; const l = w === x ? y : x; l.workstation = null; return w; };
r = run(0, 10);
if (r.a.workstation && !r.b.workstation) { breaks++; console.log("   ✓ inverted comparison flips the winner"); }
VB.keepJobSiteForMoreExperienced = orig;
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
console.log(`\n${breaks} breaks caught`);
ok(breaks === 1, 'inverted comparison not caught');
if (fails.length) { console.log('FAIL vbcompetitioncheck', fails.join('; ')); process.exit(1); }
console.log(`PASS vbcompetitioncheck — ${pass} checks green (incl. ${breaks} breaks caught)`);
