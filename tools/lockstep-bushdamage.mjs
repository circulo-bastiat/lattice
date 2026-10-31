#!/usr/bin/env node
// lockstep-bushdamage -- #9248 (MOBPROOF-DAMAGE-2, part of #9202): sweet-berry-bush contact damage. Server half: lane `bushdamage` in lanes.d
// (pilot.mjs --lanes bushdamage on the mirror; golden/bushdamage-1.18.2.json is the per-tick trace). A mob's pathfinder never walks into a bush
// (DAMAGE_OTHER malus -1), so the zombie is summoned standing in a ripe bush (age 3) with Motion x 0.3: SweetBerryBushBlock.entityInside hurts it
// (SWEET_BERRY_BUSH 1.0, zombie armour scales it to 19.06) while it moves >= 0.003, once per invulnerableTime window. The engine runs the same scene.
import { engineZombieTrace, harnessM, agentSeed, ZOMBIE_KEY } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)), G = JSON.parse(readFileSync(join(HERE, 'golden', 'bushdamage-1.18.2.json'), 'utf8')).bushdamage;
const SALT = 22, X = 11,   // the golden is the mirror's salt-22 run: the zombie's own java.util.Random is seeded per salt
   F = ['health', 'hurtTime'], fr = (h) => Math.round(h * 1000) / 1000;   // the server accumulates Health in float32
const N = 21;   // rows 0..20: the slide, the hit and the full invulnerableTime countdown. From row 22 the server zombie aggros and walks (a second hit; the engine's aggro roll differs by salt): its aggro timing is the zombie lane's business, not this source's
const gold = G.hp.slice(0, N).map((h, t) => ({ tick: t, health: fr(h), hurtTime: G.ht[t] }));
const engine = (block, age) => engineZombieTrace(SALT, {
  mob: 'zombie', T: gold.length, javaSeed: false,
  build: ({ w, M }) => { M.Use.init(M.World); const st = (n) => M.States.stateOf(n); w.set(X, -1, 0, st('dirt')); w.set(X, 0, 0, block === 'bush' ? M.States.withLocal('sweet_berry_bush', age) : 0); },
  onStart: (EL) => { const e = EL.list[EL.list.length - 1]; EL.random = null; e.random = new (harnessM().JRandom)(agentSeed(SALT, ZOMBIE_KEY, 1)); e.vx = 0.3; },
}).map((r) => ({ tick: r.tick, health: fr(r.health), hurtTime: r.hurtTime }));
let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const E = engine('bush', 3), d = compareTraces(gold, E, { fields: F });
ok(d === null, 'zombie in a sweet berry bush diverged from the real server: ' + JSON.stringify(d));
ok(E.some((r) => r.health < 20), 'a mob in a berry bush took no damage');
const mut = (f, fn) => E.map((r, t) => (t === 12 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(gold, mut('health', (h) => h + 1), { fields: F })?.field === 'health', 'health moves');
caught(compareTraces(gold, mut('hurtTime', (h) => h + 1), { fields: F })?.field === 'hurtTime', 'hurt timer moves');
caught(compareTraces(gold, engine('none', 3), { fields: F }) !== null, 'no bush, no damage');
caught(compareTraces(gold, engine('bush', 0), { fields: F }) !== null, 'age 0 bush hurts nobody');
caught(compareTraces(gold, E.map((r) => ({ ...r, health: Math.floor(r.health) })), { fields: F }) !== null, 'armour scaling lost');
const dir = join(HERE, 'mobproof', 'out'); mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'damage-bush.json'), JSON.stringify({ zombie: { pass: !d && !bad, checked: ['sweet berry bush contact damage (SWEET_BERRY_BUSH 1.0 per invulnerableTime window while moving, armour scaled) per tick vs the real-server lane bushdamage', 'hurt timer'], failed: bad ? ['see lockstep-bushdamage'] : [] } }));
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
console.log(`bushdamage: ${bad ? 'FAILED' : '0 divergences'}: ${n} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
