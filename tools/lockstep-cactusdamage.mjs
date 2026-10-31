#!/usr/bin/env node
// lockstep-cactusdamage -- #9248 (MOBPROOF-DAMAGE-2/cactus, part of #9202): cactus contact damage. Server half: lanes `cactusdamage` (pig) and
// `cactusimmunedamage` (fire-immune zombified piglin, armour 2) in lanes.d, pilot.mjs --lanes ... on the mirror (identical across reps; the pilot
// returns the per-tick Health/HurtTime trace, stored in golden/cactusdamage-1.18.2.json). The mob is dropped 1 block into a 1x1 stone shaft onto a
// cactus on sand: CACTUS 1.0 on landing (tick 2) and again each time invulnerableTime allows (every 10 ticks); the pig dies, the piglin's armour
// scales each hit (20 -> 19.06 -> 18.12), fire immunity does not stop it. The engine runs the same scene and must match per tick.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)), GOLD = JSON.parse(readFileSync(join(HERE, 'golden', 'cactusdamage-1.18.2.json'), 'utf8'));
const X = 11, F = ['health', 'hurtTime'], fr = (h) => Math.round(h * 1000) / 1000;   // the server accumulates Health in float32
const golden = (lane) => GOLD[lane].hp.map((h, t) => ({ tick: t, health: fr(h), hurtTime: GOLD[lane].ht[t] }));
const scene = (block) => ({ w, M }) => {
  const S = M.States, st = (n) => S.stateOf(n), stone = st('stone');
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) for (let y = 1; y <= 3; y++) w.set(X + dx, y, dz, stone);
  w.set(X, -1, 0, st('sand')); w.set(X, 0, 0, st(block));
};
const engine = (mob, T, block = 'cactus') => engineZombieTrace(0, { mob, up: 1, T, build: scene(block) }).map((r) => ({ tick: r.tick, health: fr(r.health), hurtTime: r.hurtTime }));
let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const Gp = golden('cactusdamage'), Gz = golden('cactusimmunedamage');
const Ep = engine('pig', Gp.length), Ez = engine('zombified_piglin', Gz.length);
const dp = compareTraces(Gp, Ep, { fields: F }), dz = compareTraces(Gz, Ez, { fields: F });
ok(dp === null, 'pig on a cactus diverged from the real server: ' + JSON.stringify(dp));
ok(dz === null, 'fire-immune zombified piglin on a cactus diverged from the real server: ' + JSON.stringify(dz));
ok(Ep.some((r) => r.health < 10) && Ez.some((r) => r.health < 20), 'a mob on a cactus took no damage');
const mut = (E, f, fn) => E.map((r, t) => (t === 15 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(Gp, mut(Ep, 'health', (h) => h + 1), { fields: F })?.field === 'health', 'health moves');
caught(compareTraces(Gp, mut(Ep, 'hurtTime', (h) => h + 1), { fields: F })?.field === 'hurtTime', 'hurt timer moves');
caught(compareTraces(Gp, engine('pig', Gp.length, 'stone'), { fields: F }) !== null, 'no cactus, no damage');
caught(compareTraces(Gz, Ez.map((r) => ({ ...r, health: Math.floor(r.health) })), { fields: F }) !== null, 'armour scaling lost');
caught(compareTraces(Gz, Ez.map((r, t) => Ez[Math.max(0, t - 1)] && { ...Ez[Math.max(0, t - 1)], tick: t }), { fields: F }) !== null, 'the first hit one tick late');
const dir = join(HERE, 'mobproof', 'out'); mkdirSync(dir, { recursive: true });
const checked = (m) => ['cactus contact damage (CACTUS 1.0 per invulnerableTime window, ' + m + ') per tick vs the real-server lanes cactusdamage/cactusimmunedamage', 'hurt timer'];
const failed = bad ? ['see lockstep-cactusdamage'] : [];
writeFileSync(join(dir, 'damage-cactus.json'), JSON.stringify({ pig: { pass: !dp && !bad, checked: checked('damaged, dies'), failed }, zombified_piglin: { pass: !dz && !bad, checked: checked('fire-immune, armour 2'), failed } }));
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
console.log(`cactusdamage: ${bad ? 'FAILED' : '0 divergences'}: ${n} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
