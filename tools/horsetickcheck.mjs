#!/usr/bin/env node
// horsetickcheck.mjs -- #1353: HorseBaseEntity.tickMovement/tick (eat grass, 1/900 regen, tail wag, eating flag).
import { loadEngine, initRegistry } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07h_entities.js', '07i_entitylist.js', '07m_breed.js', '07r_mount.js'], dom: false });
initRegistry(M);
M.Mount.init();
const Mn = M.Mount;
let breaks = 0; const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };

function run(N, grass, seed) {
  let s = seed >>> 0;
  const rand = (n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 8) % n; };
  const e = { type: 'horse', health: 1, maxHealth: 30, eatingGrass: false, eatingGrassTicks: 0 };
  let starts = 0, prev = false, wags = 0, maxRun = 0, cur = 0;
  for (let i = 0; i < N; i++) {
    const w0 = e.tailWagTicks | 0;
    Mn.tickMovement(e, rand, grass);
    if (!w0 && e.tailWagTicks === 1) wags++;
    Mn.tick(e);
    if (e.eatingGrass && !prev) starts++;
    cur = e.eatingGrass ? cur + 1 : 0; if (cur > maxRun) maxRun = cur;
    prev = e.eatingGrass;
    if (e.health >= e.maxHealth) e.health = 1;   // keep damaged so every heal counts
  }
  return { e, starts, wags, maxRun };
}
const N = 100000;
const g = run(N, true, 1), ng = run(N, false, 1);
ok(Math.abs(g.starts - N / 300) < N / 300 * 0.35, `eatingGrass starts ${g.starts}, want ~${N / 300 * 0.96}`);
ok(g.maxRun === 50, `eat-grass observed 50 ticks (set on tick 1, cleared when ++ticks>50 on tick 51), got ${g.maxRun}`);
ok(Math.abs(g.e.healCount - N / 900) < N / 900 * 0.3, `heal count ${g.e.healCount}, want ~${N / 900}`);
ok(Math.abs(g.wags - N / 200) < N / 200 * 0.2, `tail wags ${g.wags}, want ~${N / 200}`);
okAv(ng.starts === 0, 'no grass block below -> never eats grass');
okAv(run(N, true, 1).starts === g.starts, 'deterministic');
const dead = { type: 'horse', health: 0, dead: true, maxHealth: 30 };
for (let i = 0; i < 5000; i++) Mn.tickMovement(dead, () => 0, true);
okAv(!dead.eatingGrass && !dead.healCount, 'a dead horse neither heals nor eats');
const ridden = { type: 'horse', health: 5, maxHealth: 30, rider: {} };
for (let i = 0; i < 5000; i++) Mn.tickMovement(ridden, (n) => n === 300 ? 0 : 1, true);
okAv(!ridden.eatingGrass, 'a ridden horse never starts eating grass');
const ll = { type: 'llama', health: 5, maxHealth: 30 };
for (let i = 0; i < 5000; i++) Mn.tickMovement(ll, (n) => n === 300 ? 0 : 1, true);
okAv(!ll.eatingGrass, 'llama eatsGrass() is false');
// eating flag (64): set by feeding, clears when ++eatingTicks > 30
const f = { type: 'horse' }; Mn.setEating(f); let t = 0; while (f.eatingFlag && t < 100) { Mn.tick(f); t++; }
ok(t === 30, `eating flag lasts 30 ticks, got ${t}`);
okAv(f.eatingAnim >= 0 && Mn.isImmobile({ eatingGrass: true }) && !Mn.isImmobile({}), 'isImmobile follows eatingGrass');
// #4001 -- the gate EL.tickMob uses to zero move input while grazing must cover the whole horse family
for (const t of ['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse']) okAv(Mn.isMountable({ type: t }) && Mn.isImmobile({ type: t, eatingGrass: true }), t + ' is mountable and immobile while grazing');
if (fails.length) { console.log(fails.join('\n')); console.log('FAIL'); process.exit(1); }
console.log(`ok - ${breaks} assertions, 0 failures, ${breaks} breaks caught`);
