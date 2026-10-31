#!/usr/bin/env node
// steplanecheck -- #9199 (MOBPROOF-STEP-2): the ledge lanes in tools/referee/steplanes.d ({ id, mob, ledge: h }, h = 1..5), engine side.
// A chaser summoned on a shelf h blocks above the low floor walks off it toward the still survival player. Vanilla: a walking mob's path
// only steps down to its max safe fall distance (3), and fall damage is ceil(fallDistance - 3), so a drop of 1..3 never costs health.
// The real-server side is runchase's `ledge` lane (the hashed log ends in a pseudo-row [-1, health, 0]); the pilot records it x20 salts.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineZombieTrace, harnessM } from './referee/lockstep/zombielane.mjs';
import { lanesProblems } from './referee/chasescen.mjs';
const HERE = dirname(fileURLToPath(import.meta.url)), DIR = join(HERE, 'referee', 'steplanes.d');
const lanes = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));
let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const M = harnessM();
ok(lanesProblems(DIR).length === 0, 'steplanes.d: ' + lanesProblems(DIR).join('; '));
const mobs = [...new Set(lanes.filter((l) => l.ledge).map((l) => l.mob))];   // #9200: the step-course / carpet / edge / ladder lanes of #9198 and #9200 are not ledge lanes
for (const mob of mobs) ok([1, 2, 3, 4, 5].every((h) => lanes.some((l) => l.mob === mob && l.ledge === h && l.id === mob + '_ledge' + h)), `${mob}: a lane for each ledge 1..5`);
const SAFE = 3;
function run(mob, h, salt) {
  let hp0 = null, hpEnd = null, minY = 1e9;
  engineZombieTrace(salt, { mob, up: h, aggro: true, T: 160, onTick: (t, EL) => { const e = EL.list.find((x) => x.type === mob); if (!e) return; if (hp0 === null) hp0 = e.maxHealth || e.health; hpEnd = e.health; minY = Math.min(minY, e.y); } });
  return { hp0, hpEnd, minY };
}
const res = {};
for (const mob of mobs) {
  for (const h of [2, 3]) {
    const r = run(mob, h, 0);
    if (h === 2) res[mob] = r;
    ok(r.minY <= 0.01, `${mob}: ledge ${h} -- the mob came down to the low floor (minY ${r.minY})`);
    ok(r.hpEnd >= r.hp0 - 0.001, `${mob}: ledge ${h} -- no fall damage up to the safe distance ${SAFE} (${r.hp0} -> ${r.hpEnd})`);
  }
}
// anti-vacuity (D-30): a lane file without its mob, a wrong id and an unsafe 5-block drop (which must cost health through Entity.fall) are caught
const tmpl = (o) => lanes.filter((l) => l.mob === mobs[0]).map((l) => ({ ...l, ...o }));
caught(tmpl({ ledge: 9 }).some((l) => l.id !== l.mob + '_ledge' + l.ledge), 'a lane whose ledge disagrees with its id');
caught(tmpl({ mob: '' }).some((l) => !l.mob), 'a lane with no mob');
caught(lanes.filter((l) => l.mob !== mobs[0]).every((l) => l.mob !== mobs[0]), 'a roster with a mob dropped');
{ const r = res[mobs[0]]; caught(!(r.hpEnd >= r.hp0 - 0.001 && r.hpEnd < r.hp0 - 0.001), 'a tampered health that the no-damage assertion must see'); }
console.log(`steplane: ${breaks} breaks caught; ${n} checks, ${lanes.length} lanes${bad ? ", " + bad + " FAILED" : ""}`);
process.exit(bad || breaks < 4 ? 1 : 0);
