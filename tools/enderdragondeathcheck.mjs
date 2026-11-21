#!/usr/bin/env node
// enderdragondeathcheck.mjs — #1644: EnderDragonEntity.updatePostDeath / ticksSinceDeath.
import { loadEngine } from './loadsrc.mjs';
const NS = loadEngine({ extra: ['07zzl_enderdragon.js'] });
const ED = NS.EnderDragon;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function run(mut) {
  const ev = { xp: [], world: [], part: 0, killed: 0, first: null };
  const fight = new ED.EnderDragonFight({ seed: 1, previouslyKilled: false,
    onDragonKilled: (d, f) => { ev.killed++; ev.first = f; } });
  const d = new ED.EnderDragonEntity({ x: 0, y: 70, z: 0, fight });
  d.health = 0;
  const o = { mobLoot: () => true, spawnXp: (x, y, z, n) => ev.xp.push([d.ticksSinceDeath, n]),
    onWorldEvent: () => ev.world.push(d.ticksSinceDeath), onParticle: () => ev.part++ };
  if (mut) mut(d, o, fight);
  let n = 0;
  while (!d.removed && n < 400) { d.updatePostDeath(o); n++; }
  return { d, ev, n, y: d.y };
}
const r = run();
ok(r.n === 200 && r.d.ticksSinceDeath === 200, 'removed at tick 200, got ' + r.n);
ok(r.ev.world.length === 1 && r.ev.world[0] === 1, 'sound event once at tick 1');
ok(r.ev.part === 21, 'particles 180..200: ' + r.ev.part);
const mid = r.ev.xp.filter(x => x[0] < 200);
ok(mid.length === 9 && mid.every(x => x[0] % 5 === 0 && x[0] > 150 && x[1] === 960), 'drip orbs 155..195 (9) x960: ' + JSON.stringify(mid));
const fin = r.ev.xp.filter(x => x[0] === 200);
ok(fin.length === 2 && fin[0][1] === 960 && fin[1][1] === 2400, 'final burst 2400');
ok(r.ev.killed === 1 && r.ev.first === true && r.d.fight.previouslyKilled, 'fight.onDragonKilled once, first kill');
ok(Math.abs(r.y - 70 - 20) < 1e-3 && r.d.yaw === 4000, 'rises 0.1/tick, spins 20/tick');
const r2 = run((d, o, f) => { f.previouslyKilled = true; });
ok(r2.ev.xp.every(x => x[1] === 40 || x[1] === 100), 'repeat kill uses 500 base');
const r3 = run((d, o) => { o.mobLoot = () => false; });
ok(r3.ev.xp.length === 0 && r3.n === 200, 'doMobLoot off: no orbs');
// #4469: the LIVE path (tickEntity) must reach the sound + particle sinks
function live() {
  const got = { snd: [], part: [] };
  NS.Sound = { play: (ev, o) => got.snd.push([ev, o.volume]) };
  NS.Particle = { spawn: (t) => got.part.push(t) };
  const e = { type: 'ender_dragon', x: 0, y: 70, z: 0, yaw: 0, health: 0 };
  ED.initEntity(e); e.dragon.health = 0;
  for (let i = 0; i < 200 && !e.removed; i++) ED.tickEntity(e);
  return got;
}
const lv = live();
ok(lv.snd.length === 1 && lv.snd[0][0] === 'entity.ender_dragon.death' && lv.snd[0][1] === 5, 'tickEntity plays 1028 roar once: ' + JSON.stringify(lv.snd));
ok(lv.part.length === 21 && lv.part.every(t => t === 'explosion_emitter'), 'tickEntity emits 21 explosion_emitter: ' + lv.part.length);
if (fails.length) { console.log('FAIL', fails); process.exit(1); }
// anti-vacuity: break the data/behaviour and confirm the assertions notice
let caught = 0;
const keep = ED.EnderDragonEntity.prototype.updatePostDeath;
const src = keep.toString();
for (const [from, to] of [['t === 200', 't === 201'], ['t > 150', 't > 100'], ['12000', '500'], ['20.0', '10.0']]) {
  ED.EnderDragonEntity.prototype.updatePostDeath = eval('(' + src.replace(from, to) + ')');
  const q = run();
  const bad = q.n !== 200 || q.ev.xp.filter(x => x[0] < 200).length !== 9 || (q.ev.xp[0] && q.ev.xp[0][1] !== 960) || q.d.yaw !== 4000;
  if (bad) { caught++; console.log("  ✓ mutant caught: " + from + " -> " + to); }
}
ED.EnderDragonEntity.prototype.updatePostDeath = keep;
{ const k = ED.deathOpts; ED.deathOpts = undefined; const g = live(); ED.deathOpts = k;
  if (g.snd.length === 0 && g.part.length === 0) { caught++; console.log('  ✓ mutant caught: tickEntity without opts'); } }
console.log(`OK  ${pass} checks passed, 0 failures; ${caught} breaks caught`);
process.exit(caught === 5 ? 0 : 1);
