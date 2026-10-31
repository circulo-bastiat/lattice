#!/usr/bin/env node
// lockstep-voiddamage -- #9250 (MOBPROOF-DAMAGE-2/void, part of #9202): void damage below bottomY-64. Server half: lanes `voiddamage` (pig, 10 HP) and
// `voidimmune` (fire-immune blaze, 20 HP) in lanes.d, pilot.mjs --lanes voiddamage,voidimmune on the mirror (identical across reps and salts 0-2).
// Server trace (Health/HurtTime per tick): OUT_OF_WORLD 4.0 lands on tick 1 and again every 11 ticks once the hurt timer (10) has run out -- ticks 1, 11, 21
// (pig dies on the third: 10 -> 6 -> 2 -> dead), blaze 20 -> 16 -> 12 -> 8 -> 4 at ticks 1, 11, 21, 31. Fire immunity changes nothing.
// The engine runs the same scene from y -130 and must match per tick: health, hurt timer.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const F = ['health', 'hurtTime'];
const SERVER = {   // lanes voiddamage / voidimmune, salt 0 (hp and ht arrays straight from the server trace, rows 0..T-1)
  pig: { hp: [10, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2], ht: [0, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0] },
  blaze: { hp: [20, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], ht: [0, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0] },
};
const golden = (m) => SERVER[m].hp.map((h, t) => ({ tick: t, health: h, hurtTime: SERVER[m].ht[t] }));
const engine = (mob, patch) => engineZombieTrace(0, { mob, up: -130, T: SERVER[mob].hp.length, onTick: (t, EL) => { if (t === 1 && patch) patch(EL.list.find((e) => e.type === mob)); } })
  .map((r) => ({ tick: r.tick, health: r.health, hurtTime: r.hurtTime }));
let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const Gp = golden('pig'), Gb = golden('blaze'), Ep = engine('pig'), Eb = engine('blaze');
const dp = compareTraces(Gp, Ep, { fields: F }), db = compareTraces(Gb, Eb, { fields: F });
ok(dp === null, 'pig void damage diverged from the real server: ' + JSON.stringify(dp));
ok(db === null, 'fire-immune blaze void damage diverged from the real server: ' + JSON.stringify(db));
const mut = (E, f, fn) => E.map((r, t) => (t === 12 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(Gp, mut(Ep, 'health', (h) => h + 1), { fields: F })?.field === 'health', 'health moves');
caught(compareTraces(Gp, mut(Ep, 'hurtTime', (h) => h + 1), { fields: F })?.field === 'hurtTime', 'hurt timer moves');
caught(compareTraces(Gb, engine('blaze', (e) => { e.y += 70; }), { fields: F }) !== null, 'a mob above the void line takes nothing');
caught(compareTraces(Gb, Eb.map((r) => ({ ...r, health: r.health + (r.tick > 0 ? 4 : 0) })), { fields: F }) !== null, 'damage amount 4 vs 0');
const dir = join(dirname(fileURLToPath(import.meta.url)), 'mobproof', 'out'); mkdirSync(dir, { recursive: true });
const checked = (m) => ['void damage (OUT_OF_WORLD 4.0 below y -128, ' + m + ') per tick vs the real-server lanes voiddamage/voidimmune', 'hurt timer'];
writeFileSync(join(dir, 'damage-void.json'), JSON.stringify({ pig: { pass: !dp && !bad, checked: checked('damaged'), failed: bad ? ['see lockstep-voiddamage'] : [] }, blaze: { pass: !db && !bad, checked: checked('fire-immune'), failed: bad ? ['see lockstep-voiddamage'] : [] } }));
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
console.log(`voiddamage: ${bad ? 'FAILED' : '0 divergences'}: ${n} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
