#!/usr/bin/env node
// lockstep-drowndamage -- #9247 (MOBPROOF-DAMAGE-2, part of #9202): drowning damage. Server half: lanes `drowndamage` (NoAI pig, pool, Air 25s) and
// `drownimmune` (same for a zombie) in lanes.d, pilot.mjs --lanes drowndamage,drownimmune on the mirror (identical across reps and salts). Health and
// HurtTime per tick, expanded below from the server's trace: pig 10 HP, Air 25 -> -20 on tick 45, DROWN 2.0 (air reset to 0) then every 20 ticks
// (45, 65, 85, 105, dead at 125: the server's log ends at row 124), HurtTime 9 on the hit tick (baseTick drowns before aiStep counts it down).
// The undead zombie breathes water: Health 20, HurtTime 0 for all 160 ticks. The engine runs the same scene and must match per tick.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const T = 160, FIRST = 45, EVERY = 20, DEAD = 125, F = ['health', 'hurtTime'];
const golden = (mob) => {   // server rows (the pig's log stops when it dies)
  const rows = [];
  for (let t = 0; t < (mob === 'pig' ? DEAD : T); t++) {
    const hits = mob === 'pig' && t >= FIRST ? Math.floor((t - FIRST) / EVERY) + 1 : 0, since = (t - FIRST) % EVERY;
    rows.push({ tick: t, health: mob === 'pig' ? 10 - 2 * hits : 20, hurtTime: hits && since < 10 ? 9 - since : 0 });
  }
  return rows;
};
const engine = (mob, patch) => engineZombieTrace(0, { mob, noAI: true, pool: true, T, extra: (EL, e, t) => { if (t === 0) { e.air = 25; if (patch) patch(e); } return null; } })
  .map((r) => ({ tick: r.tick, health: r.health, hurtTime: r.hurtTime }));
let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const Gp = golden('pig'), Gz = golden('zombie'), Ep = engine('pig'), Ez = engine('zombie');
const cut = (E, G) => E.slice(0, G.length);
const dp = compareTraces(Gp, cut(Ep, Gp), { fields: F }), dz = compareTraces(Gz, cut(Ez, Gz), { fields: F });
ok(dp === null, 'pig drowning diverged from the real server: ' + JSON.stringify(dp));
ok(dz === null, 'drown-immune zombie diverged from the real server: ' + JSON.stringify(dz));
ok(Ep[DEAD].health <= 0, 'the pig must be dead at tick ' + DEAD + ' like the server (log ends at ' + (DEAD - 1) + ')');
ok(Ep.some((r) => r.health < 10), 'the pig never drowned');
const mut = (E, f, fn) => E.map((r, t) => (t === FIRST + 3 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(Gp, cut(mut(Ep, 'health', (h) => h + 1), Gp), { fields: F })?.field === 'health', 'health moves');
caught(compareTraces(Gp, cut(mut(Ep, 'hurtTime', (h) => h + 1), Gp), { fields: F })?.field === 'hurtTime', 'hurt timer moves');
caught(compareTraces(Gp, cut(engine('pig', (e) => { e.air = 26; }), Gp), { fields: F })?.tick === FIRST, 'air supply +1 shifts the first hit');
caught(compareTraces(Gz, cut(engine('zombie', (e) => { e.type = 'pig'; }), Gz), { fields: F }) !== null || engine('pig').some((r) => r.health < 10), 'a non-immune mob drowns where an immune one does not');
caught(Ez.every((r) => r.health === 20) && Ep.some((r) => r.health < 10), 'immunity makes the difference');
const dir = join(dirname(fileURLToPath(import.meta.url)), 'mobproof', 'out'); mkdirSync(dir, { recursive: true });
const checked = (m) => ['drowning damage (air 1/tick, -20 -> DROWN 2.0 then every 20 ticks, ' + m + ') per tick vs the real-server lanes drowndamage/drownimmune', 'hurt timer'];
writeFileSync(join(dir, 'damage-drown.json'), JSON.stringify({ pig: { pass: !dp && !(bad), checked: checked('breathing mob'), failed: bad ? ['see lockstep-drowndamage'] : [] }, zombie: { pass: !dz && !bad, checked: checked('undead: water breathing, no damage'), failed: bad ? ['see lockstep-drowndamage'] : [] } }));
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
console.log(`drowndamage: ${bad ? 'FAILED' : '0 divergences'}: ${n} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
