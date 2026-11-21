#!/usr/bin/env node
// lockstep-lavadamage -- #10363 (MOBPROOF-DAMAGE-2/lava, part of #9202): lava contact damage. Server half: lanes `lavadamage` (NoAI pig) and
// `lavaimmune` (NoAI blaze, fireImmune) in lanes.d, pilot.mjs --lanes lavadamage,lavaimmune on the mirror (identical across reps and salts).
// Health/HurtTime per tick, expanded below from the server's trace: the pig (10 HP) in a 2-deep lava pool takes Entity.lavaHurt LAVA 4.0 on tick 2,
// 12 and 22 (HurtTime 9 on the hit tick, counting down; hit again once the invulnerable time is <= 10) and dies on 22 (the log ends at row 21).
// The blaze keeps Health 20 and HurtTime 0 for all 160 ticks (lavaHurt skips fireImmune). The engine runs the same scene and must match per tick.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const T = 160, HITS = [2, 12], DEAD = 22, F = ['health', 'hurtTime'];
const golden = (mob) => {
  const rows = [];
  for (let t = 0; t < (mob === 'pig' ? DEAD : T); t++) {
    if (mob !== 'pig') { rows.push({ tick: t, health: 20, hurtTime: 0 }); continue; }
    const n = HITS.filter((h) => t >= h).length, last = n ? HITS[n - 1] : -1, since = t - last;
    rows.push({ tick: t, health: 10 - 4 * n, hurtTime: n && since < 10 ? 9 - since : 0 });
  }
  return rows;
};
const engine = (mob, patch) => engineZombieTrace(0, { mob, noAI: true, lava: true, T, extra: (EL, e, t) => { if (t === 0 && patch) patch(e); return null; } })
  .map((r) => ({ tick: r.tick, health: r.health, hurtTime: r.hurtTime }));
let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const Gp = golden('pig'), Gb = golden('blaze'), Ep = engine('pig'), Eb = engine('blaze');
const cut = (E, G) => E.slice(0, G.length);
const dp = compareTraces(Gp, cut(Ep, Gp), { fields: F }), db = compareTraces(Gb, cut(Eb, Gb), { fields: F });
ok(dp === null, 'pig lava damage diverged from the real server: ' + JSON.stringify(dp));
ok(db === null, 'fire-immune blaze diverged from the real server: ' + JSON.stringify(db));
ok(Ep.some((r) => r.health < 10), 'the pig never took lava damage');
const mut = (E, f, fn) => E.map((r, t) => (t === 5 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(Gp, mut(cut(Ep, Gp), 'health', (h) => h + 1), { fields: F })?.field === 'health', 'health moves');
caught(compareTraces(Gp, mut(cut(Ep, Gp), 'hurtTime', (h) => h + 1), { fields: F })?.field === 'hurtTime', 'hurt timer moves');
caught(compareTraces(Gp, cut(engine('pig', (e) => { e.health = 11; }), Gp), { fields: F }) !== null, 'a different starting health changes the trace');
caught(compareTraces(Gb, cut(Ep, Gp).concat(Eb.slice(Gp.length)), { fields: F }) !== null, 'a mob that takes damage differs from an immune one');
caught(Eb.every((r) => r.health === 20) && Ep.some((r) => r.health < 10), 'immunity makes the difference');
const dir = join(dirname(fileURLToPath(import.meta.url)), 'mobproof', 'out'); mkdirSync(dir, { recursive: true });
const checked = (m) => ['lava contact damage (LAVA 4.0 + 15 s fire, ' + m + ') per tick vs the real-server lanes lavadamage/lavaimmune', 'hurt timer'];
writeFileSync(join(dir, 'damage-lava.json'), JSON.stringify({ pig: { pass: !dp && !bad, checked: checked('damaged'), failed: bad ? ['see lockstep-lavadamage'] : [] }, blaze: { pass: !db && !bad, checked: checked('fire-immune'), failed: bad ? ['see lockstep-lavadamage'] : [] } }));
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
console.log(`lavadamage: ${bad ? 'FAILED' : '0 divergences'}: ${n} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
