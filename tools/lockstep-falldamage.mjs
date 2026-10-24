#!/usr/bin/env node
// lockstep-falldamage -- #9246 (MOBPROOF-DAMAGE-2/fall, part of #9202): fall damage. Server half: lanes `falldamage` (pig) and `fallimmune` (chicken)
// in lanes.d, pilot.mjs --lanes falldamage,fallimmune on the mirror (identical across reps and salts 0-2). Each mob is summoned 10 blocks above
// the stone corridor floor; Health/HurtTime per tick. Server trace: the pig (10 HP) lands on tick 18 and takes ceil(10 - 3) = 7 -> Health 3,
// HurtTime 10 counting down to 0 on tick 28 (Health stays 3). The chicken (causeFallDamage false) keeps Health 4 and HurtTime 0 for all 160 ticks.
// The engine runs the same scene and must match per tick: health, hurt timer.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const T = 160, LAND = 18, F = ['health', 'hurtTime'];
const golden = (mob) => Array.from({ length: T }, (_, t) => mob === 'pig'
  ? { tick: t, health: t >= LAND ? 3 : 10, hurtTime: t >= LAND && t < LAND + 10 ? 10 - (t - LAND) : 0 }
  : { tick: t, health: 4, hurtTime: 0 });
const engine = (mob, patch) => engineZombieTrace(0, { mob, up: 10, T, onTick: (t, EL) => { if (t === 1 && patch) patch(EL.list.find((e) => e.type === mob)); } })
  .map((r) => ({ tick: r.tick, health: r.health, hurtTime: r.hurtTime }));
let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const Gp = golden('pig'), Gc = golden('chicken'), Ep = engine('pig'), Ec = engine('chicken');
const dp = compareTraces(Gp, Ep, { fields: F }), dc = compareTraces(Gc, Ec, { fields: F });
ok(dp === null, 'pig fall damage diverged from the real server: ' + JSON.stringify(dp));
ok(dc === null, 'fall-immune chicken diverged from the real server: ' + JSON.stringify(dc));
ok(Ep.some((r) => r.health < 10), 'the pig never took fall damage');
const mut = (E, f, fn) => E.map((r, t) => (t === LAND + 3 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(Gp, mut(Ep, 'health', (h) => h + 1), { fields: F })?.field === 'health', 'health moves');
caught(compareTraces(Gp, mut(Ep, 'hurtTime', (h) => h + 1), { fields: F })?.field === 'hurtTime', 'hurt timer moves');
caught(compareTraces(Gp, engine('pig', (e) => { e.y += 1; }), { fields: F }) !== null, 'one more block of fall changes the damage / landing tick');
caught(compareTraces(Gc, Ep.map((r, t) => ({ ...r, health: r.health + 1 })), { fields: F }) !== null, 'a mob that takes damage differs from an immune one');
caught(Ec.every((r) => r.health === 4) && Ep.some((r) => r.health < 10), 'immunity makes the difference');
const dir = join(dirname(fileURLToPath(import.meta.url)), 'mobproof', 'out'); mkdirSync(dir, { recursive: true });
const checked = (m) => ['fall damage (ceil(fallDistance - 3), 10-block drop, ' + m + ') per tick vs the real-server lanes falldamage/fallimmune', 'hurt timer'];
writeFileSync(join(dir, 'damage-fall.json'), JSON.stringify({ pig: { pass: !dp && !bad, checked: checked('damaged'), failed: bad ? ['see lockstep-falldamage'] : [] }, chicken: { pass: !dc && !bad, checked: checked('fall-immune'), failed: bad ? ['see lockstep-falldamage'] : [] } }));
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
console.log(`falldamage: ${bad ? 'FAILED' : '0 divergences'}: ${n} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
