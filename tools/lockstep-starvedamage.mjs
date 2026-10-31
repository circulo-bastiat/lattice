#!/usr/bin/env node
// lockstep-starvedamage -- #10364 (MOBPROOF-DAMAGE-2/starvation, part of #9202): FoodData.tick starvation by difficulty. Server half: lanes `starveeasy`,
// `starvenormal`, `starvehard` in lanes.d (pilot.mjs --lanes starveeasy,starvenormal,starvehard, identical across reps): the freshly joined player gets Hunger 255
// (exhaustion 1.28/tick drains saturation 5 then food 20 to 0) and instant_damage (6 << amp) at tick 0; Health per tick for 800 ticks. Server trace (run-length
// [tick, Health]): food hits 0 at tick ~78 and the first starve hit lands at tick 158, then one HP every 80 ticks: Easy stops at 10, Normal at 1, Hard kills (0 at 718).
// The engine (Survival.tick on the real Player) must match per tick.
import { harness } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const T = 800;
const RUNS = {
  easy:   { amp: 0, gold: [[0, 20], [1, 14], [158, 13], [238, 12], [318, 11], [398, 10]] },
  normal: { amp: 1, gold: [[0, 20], [1, 8], [158, 7], [238, 6], [318, 5], [398, 4], [478, 3], [558, 2], [638, 1]] },
  hard:   { amp: 1, gold: [[0, 20], [1, 8], [158, 7], [238, 6], [318, 5], [398, 4], [478, 3], [558, 2], [638, 1], [718, 0]] },
};
const F = ['health'];
const expand = (gold) => Array.from({ length: T }, (_, t) => ({ tick: t, health: gold.filter(([k]) => k <= t).pop()[1] }));
function engine(diff, amp, patch) {
  const { M } = harness(), Sv = M.Survival;
  M.Diff.set(diff); M.EntityList.clear();
  const P = M.Player; Sv.respawnReset && Sv.respawnReset(P);
  Object.assign(P, { x: 0, y: 64, z: 0, vx: 0, vy: 0, vz: 0, health: 20, invulnerable: 0, lastHurt: 0, onGround: true, dead: false, food: 20, saturation: 5, exhaustion: 0, foodTimer: 0, naturalRegen: false });   // runchase sets gamerule naturalRegeneration false
  if (M.Effects.clearStatusEffects) M.Effects.clearStatusEffects(P);
  const rows = [];
  for (let t = 0; t < T; t++) {
    rows.push({ tick: t, health: P.dead ? 0 : Math.fround(P.health) });
    if (t === 0) { M.Effects.addStatusEffect(P, 'hunger', 1000000, 255); Sv.hurt(P, 'magic', 6 << amp); }
    if (patch) patch(t, P, Sv);
    if (!P.dead) { P.vx = P.vy = P.vz = 0; Sv.tick(P); }
  }
  return rows;
}
let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const out = {};
for (const [diff, { amp, gold }] of Object.entries(RUNS)) {
  const G = expand(gold), E = engine(diff, amp), d = compareTraces(G, E, { fields: F });
  ok(d === null, `${diff}: starvation diverged from the real server: ${JSON.stringify(d)}`);
  out[diff] = { pass: !d, checked: ['starvation damage every 80 ticks at food 0 (FoodData.tick) vs the real-server lane starve' + diff, 'difficulty floor (Easy 10 / Normal 1 / Hard death)'], failed: d ? [JSON.stringify(d)] : [] };
  if (diff === 'easy') {
    caught(compareTraces(G, E.map((r, t) => t === 300 ? { ...r, health: r.health + 1 } : r), { fields: F }) !== null, 'one HP off at tick 300');
    caught(compareTraces(expand(RUNS.normal.gold), E, { fields: F }) !== null, 'Easy differs from Normal (floor at 10 vs 1)');
  }
  if (diff === 'hard') caught(compareTraces(G, engine('normal', amp), { fields: F }) !== null, 'Normal must not kill where Hard does');
  if (diff === 'normal') caught(compareTraces(G, engine('hard', amp), { fields: F }) !== null, 'Hard must not stop at 1 where Normal does');
}
const dir = join(dirname(fileURLToPath(import.meta.url)), 'mobproof', 'out'); mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'damage-starve.json'), JSON.stringify(out));
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
console.log(`starvedamage: ${bad ? 'FAILED' : '0 divergences'}: ${n} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
