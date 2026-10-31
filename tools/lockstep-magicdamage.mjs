#!/usr/bin/env node
// lockstep-magicdamage -- #9215 (MOBPROOF-DAMAGE-3, part of #9203): magic damage on a mob. Server half: lane `magicdamage` (lanes.d,
// pilot.mjs --lanes magicdamage): a NoAI cow given instant_damage I (magic 6, bypasses armour) at the summon, Pos/Health/HurtTime per tick, run
// twice per salt on the real 1.18.2 server under the SeedAgent. Golden = that trace (salt 0, identical on both reps): Health 10 -> 4 on row 1,
// HurtTime 0, 10, 9, 8 ... 0, Pos fixed. The engine applies ES.magicDamage and must match per tick.
import { engineZombieTrace, harnessM } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { startX } from './referee/chasescen.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIT = 1, T = 30, F = ['health', 'hurtTime', 'pos'];
function vanilla() {
  const rows = []; let hp = 10, ht = 0;
  for (let t = 0; t < T; t++) {
    if (t === HIT) { hp = 4; ht = 10; } else if (t > HIT && ht > 0) ht--;
    rows.push({ tick: t, health: hp, hurtTime: ht, pos: [startX(), 0, 0.5] });
  }
  return rows;
}
function engine(amt) {
  const M = harnessM();
  const rows = engineZombieTrace(0, { mob: 'cow', noAI: true, T, onTick: (t, EL) => { if (t === HIT) M.Effects.magicDamage(EL.list.find((e) => e.type === 'cow'), amt, null); } });
  return rows.map((r) => ({ tick: r.tick, health: r.health, hurtTime: r.hurtTime, pos: r.pos }));
}
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const V = vanilla(), E = engine(6);
const d = compareTraces(V, E, { fields: F });
ok(d === null, 'magic damage diverged from the real server: ' + JSON.stringify(d));
const mut = (f, fn) => E.map((r, t) => (t === HIT + 3 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(V, mut('health', (h) => h + 0.5), { fields: F })?.field === 'health', 'health moves');
caught(compareTraces(V, mut('hurtTime', (h) => h + 1), { fields: F })?.field === 'hurtTime', 'hurt timer');
caught(compareTraces(V, engine(5), { fields: F }) !== null, 'damage 5 instead of 6');
const dir = join(dirname(fileURLToPath(import.meta.url)), 'mobproof', 'out'); mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'damage-magicserver.json'), JSON.stringify({ cow: { pass: !bad, checked: ['magic damage (6, bypasses armour) per tick vs the real-server lane magicdamage', 'hurt timer', 'position under NoAI'], failed: bad ? ['see lockstep-magicdamage'] : [], knownDivergences: ['thorns on the real server: still owed'] } }));
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
console.log(`magicdamage: ${bad ? 'FAILED' : '0 divergences'}: 4 assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
