#!/usr/bin/env node
// lockstep-firedamage -- #10362 (MOBPROOF-DAMAGE-2/fire, part of #9202): in-fire and on-fire burning damage. Server half: lanes `firedamage` (pig) and
// `fireimmune` (blaze) in lanes.d, pilot.mjs --lanes firedamage,fireimmune on the mirror. Each mob is summoned in a 1x1 stone pen holding a fire block on
// netherrack (a NoAI mob never runs checkInsideBlocks, so the AI mob is penned instead). Health/HurtTime per tick. Server trace: the pig (10 HP) takes
// IN_FIRE/ON_FIRE 1.0 on tick 1 and then whenever the hurt timer allows (every 10 ticks: 1, 11, 21 ... 81), HurtTime 10 on the hit tick counting down
// to 1, and is dead on tick 91 (the server's log ends at row 90, Health 1). The fire-immune blaze keeps Health 20 and HurtTime 0 for all 160 ticks.
// The engine runs the same scene and must match per tick: health, hurt timer.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const T = 160, DEAD = 91, EVERY = 10, F = ['health', 'hurtTime'];
const golden = (mob) => Array.from({ length: mob === 'pig' ? DEAD : T }, (_, t) => mob === 'pig'
  ? { tick: t, health: 10 - (t ? Math.floor((t - 1) / EVERY) + 1 : 0), hurtTime: t ? (t - 1) % EVERY === 0 ? 10 : 10 - ((t - 1) % EVERY) : 0 }
  : { tick: t, health: 20, hurtTime: 0 });
const pen = (fire) => ({ w, M }) => {   // fire cell (x 11, z 0) on netherrack, four stone walls and a roof around it
  const st = (n) => M.States.stateOf(n);
  w.set(11, -1, 0, st('netherrack')); if (fire) w.set(11, 0, 0, st('fire'));
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) for (const y of [0, 1]) w.set(11 + dx, y, dz, st('stone'));
  w.set(11, 2, 0, st('stone'));
};
const engine = (mob, fire = true) => engineZombieTrace(0, { mob, T, build: pen(fire) }).map((r) => ({ tick: r.tick, health: r.health, hurtTime: r.hurtTime }));
let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const Gp = golden('pig'), Gb = golden('blaze'), Ep = engine('pig'), Eb = engine('blaze');
const cut = (E, G) => E.slice(0, G.length);
const dp = compareTraces(Gp, cut(Ep, Gp), { fields: F }), db = compareTraces(Gb, cut(Eb, Gb), { fields: F });
ok(dp === null, 'pig burning diverged from the real server: ' + JSON.stringify(dp));
ok(db === null, 'fire-immune blaze diverged from the real server: ' + JSON.stringify(db));
ok(Ep[DEAD].health <= 0, 'the pig must be dead at tick ' + DEAD + ' like the server (log ends at ' + (DEAD - 1) + ')');
ok(Ep.some((r) => r.health < 10), 'the pig never burned');
const mut = (E, f, fn) => E.map((r, t) => (t === 14 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(Gp, cut(mut(Ep, 'health', (h) => h + 1), Gp), { fields: F })?.field === 'health', 'health moves');
caught(compareTraces(Gp, cut(mut(Ep, 'hurtTime', (h) => h + 1), Gp), { fields: F })?.field === 'hurtTime', 'hurt timer moves');
caught(compareTraces(Gp, cut(engine('pig', false), Gp), { fields: F }) !== null, 'no fire block, no damage');
caught(compareTraces(Gb, cut(engine('pig'), Gb), { fields: F }) !== null, 'a non-immune mob burns where the blaze does not');
caught(Eb.every((r) => r.health === 20) && Ep.some((r) => r.health < 10), 'fire immunity makes the difference');
const dir = join(dirname(fileURLToPath(import.meta.url)), 'mobproof', 'out'); mkdirSync(dir, { recursive: true });
const checked = (m) => ['fire damage (IN_FIRE / ON_FIRE 1.0, hurt timer gated, ' + m + ') per tick vs the real-server lanes firedamage/fireimmune', 'hurt timer'];
writeFileSync(join(dir, 'damage-fire.json'), JSON.stringify({ pig: { pass: !dp && !bad, checked: checked('burning mob'), failed: bad ? ['see lockstep-firedamage'] : [] }, blaze: { pass: !db && !bad, checked: checked('fire-immune'), failed: bad ? ['see lockstep-firedamage'] : [] } }));
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
console.log(`firedamage: ${bad ? 'FAILED' : '0 divergences'}: ${n} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
