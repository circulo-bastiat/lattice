#!/usr/bin/env node
// lockstep-effectdamage -- #9249 (part of #9202): poison / wither effect-tick damage on a mob. Server half: lanes `poisondamage` (poison III, 10 s) and
// `witherdamage` (wither III, 3 s) (lanes.d, pilot.mjs --lanes poisondamage,witherdamage, run on the mirror): a NoAI cow given the effect at the
// summon, Health/HurtTime per tick, twice per salt on the real 1.18.2 server under the SeedAgent. Golden = that trace (salt 0, identical on both reps):
// poison hits (1.0 magic) at ticks 3,15,27 ... 99 and STOPS at 1 HP; wither hits at 1,11,21 ... 51 (every other effect tick lands past the hurt window)
// and does not stop. HurtTime 10 on a hit counting down. The engine (ES.addStatusEffect + ES.tick) must match per tick: health, hurt timer, position.
import { engineZombieTrace, harnessM } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { startX } from './referee/chasescen.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const T = 160, F = ['health', 'hurtTime', 'pos'];
const LANES = { poison: { hits: [3, 15, 27, 39, 51, 63, 75, 87, 99], dur: 200 }, wither: { hits: [1, 11, 21, 31, 41, 51], dur: 60 } };
function vanilla(hits) {
  const rows = []; let hp = 10, ht = 0;
  for (let t = 0; t < T; t++) {
    if (hits.includes(t)) { hp -= 1; ht = 10; } else if (t > 0 && ht > 0) ht--;
    rows.push({ tick: t, health: hp, hurtTime: ht, pos: [startX(), 0, 0.5] });
  }
  return rows;
}
function engine(effect, o = {}) {
  const M = harnessM();
  const rows = engineZombieTrace(0, { mob: 'cow', noAI: true, T, onStart: (EL) => M.Effects.addStatusEffect(EL.list.find((e) => e.type === 'cow'), effect, o.dur ?? LANES[effect].dur, o.amp ?? 2, false, true) });
  return rows.map((r) => ({ tick: r.tick, health: r.health, hurtTime: r.hurtTime, pos: r.pos }));
}
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const out = {};
for (const k of Object.keys(LANES)) {
  const V = vanilla(LANES[k].hits), E = engine(k);
  const d = compareTraces(V, E, { fields: F });
  ok(d === null, k + ' damage diverged from the real server: ' + JSON.stringify(d));
  out[k] = d === null;
  if (k === 'poison') caught(compareTraces(V, engine('poison', { amp: 1 }), { fields: F }) !== null, 'poison amplifier I instead of III');
  if (k === 'wither') caught(compareTraces(V, engine('wither', { dur: 20 }), { fields: F }) !== null, 'wither cut short');
}
caught(compareTraces(vanilla(LANES.poison.hits), engine('wither', { dur: 200 }), { fields: F }) !== null, 'wither where poison belongs (poison stops at 1 HP, wither does not)');
const dir = join(dirname(fileURLToPath(import.meta.url)), 'mobproof', 'out'); mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'damage-effectserver.json'), JSON.stringify({ cow: { pass: !bad, checked: ['poison III per tick vs the real-server lane poisondamage (stops at 1 HP)', 'wither III per tick vs lane witherdamage', 'hurt timer', 'position under NoAI'], failed: bad ? ['see lockstep-effectdamage'] : [], knownDivergences: ['starvation (player hunger) and per-class immunities on the real server: still owed'] } }));
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
console.log(`effectdamage: ${bad ? 'FAILED' : '0 divergences'}: ${Object.keys(LANES).length + 3} assertions, ${bad} failures, ${breaks} breaks caught`);
