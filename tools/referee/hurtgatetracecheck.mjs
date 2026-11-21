// #6261: lockstep compares damage-gate timing (hurtTime, invulnerableTime, lastDamage), not just health.
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
let bad = 0, n = 0; const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
// Cow hit for 4 at tick 0 and again (damage 5) at tick `gap`; the gate: invulnerableTime > 10 docks to the excess.
function sim(gap, INV) {
  const e = { health: 10, hurtTime: 0, invulnerableTime: 0, lastHurt: 0 }, rows = [];
  for (let t = 0; t <= 12; t++) {
    if (t > 0) { if (e.invulnerableTime > 0) e.invulnerableTime--; if (e.hurtTime > 0) e.hurtTime--; }
    for (const [ht, amt] of [[0, 4], [gap, 5]]) if (t === ht) {
      let dealt = amt;
      if (e.invulnerableTime > 10) { if (amt <= e.lastHurt) continue; dealt = amt - e.lastHurt; e.lastHurt = amt; }
      else { e.lastHurt = amt; e.invulnerableTime = INV; e.hurtTime = 10; }
      e.health -= dealt;
    }
    rows.push({ ...e });
  }
  return rows;
}
const server = (gap) => sim(gap, 20).map((r, t) => serverRow(t, { Health: r.health, HurtTime: r.hurtTime }, { invulnerableTime: r.invulnerableTime, lastDamage: r.lastHurt }));
const engine = (gap, INV) => sim(gap, INV).map((r, t) => engineRow(t, r));
const F = { fields: ['hurtTime', 'invulnerableTime', 'lastDamage'] };
for (const gap of [6, 11]) ok(compareTraces(server(gap), engine(gap, 20), F) === null, `gap ${gap} matches`);
let caught = 0;
const a = JSON.stringify(server(6).map(r => [r.hurtTime, r.invulnerableTime, r.lastDamage])), b = JSON.stringify(server(11).map(r => [r.hurtTime, r.invulnerableTime, r.lastDamage]));
ok(a !== b, 'gap 6 vs 11 change expected trace');
for (const [gap, INV] of [[6, 10], [11, 10], [6, 25]]) {
  const d = compareTraces(server(gap), engine(gap, INV), F);
  if (d) caught++; else ok(false, `INVULNERABLE_TICKS=${INV} gap ${gap} not caught`);
}
console.log(`${n} assertions, ${bad} failures, ${caught} breaks caught`);
if (bad) process.exit(1);
