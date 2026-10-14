#!/usr/bin/env node
// doorbashcheck.mjs — #4119: BreakDoorGoal door-bash effects (events 1019/1021, crack stages 0..9). Proves it can fail.
import { loadEngine, initRegistry } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
  '07m_breed.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
  '07zz_xporb.js', '07zzf_piglin.js', '14e_gamemode.js'], dom: false });
if (initRegistry) initRegistry(M);
const Ai = M.Ai;
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const run = () => {
  const evs = [], stages = [];
  M.Sound = M.Sound || {};
  const S = M.Sound, old = S.play;
  S.play = (ev) => { evs.push(ev); return true; };
  let door = { wood: true, iron: false, closed: true }, broke = 0;
  const e = { type: 'zombie', x: 0.5, y: 64, z: 0.5, target: { x: 3, y: 64, z: 0.5 }, navPath: [{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }, { x: 2, y: 64, z: 0 }], navIdx: 0 };
  const dp = (x, y, z) => (x === 1 && y === 65 && z === 0 ? door : null);
  const g = new Ai.BreakDoorGoal(e, { doorAt: dp, breakDoor: (x, y, z, m) => { broke++; door = null; Ai.doorEvent(m, 'entity.zombie.break_wooden_door', x, y, z); } });
  const st = [];
  if (g.canUse()) { g.start(); for (let i = 0; i < 240 && g.canContinueToUse(); i++) { g.tick(); if (st[st.length - 1] !== e.doorCrack) st.push(e.doorCrack); } }
  g.stop();
  S.play = old;
  return { evs, st, broke, after: e.doorCrack };
};
const r = run();
// golden doorinteract.*: door 2 nodes ahead is found; a door beside the mob but off the path is not
{
  const mk = (path, at) => { const e = { type: 'zombie', x: 0.5, y: 64, z: 0.5, navPath: path, navIdx: 0 };
    return new Ai.BreakDoorGoal(e, { doorAt: (x, y, z) => (x === at[0] && y === at[1] && z === at[2] ? { closed: true, iron: false, wood: true } : null) }); };
  const P = [{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }, { x: 2, y: 64, z: 0 }, { x: 3, y: 64, z: 0 }];
  ok(mk(P, [1, 65, 0]).canUse(), 'doorinteract: door on node 1 (inside min(0+2,len)) starts');
  ok(!mk(P, [3, 65, 0]).canUse(), 'doorinteract: door on node 3 (beyond window) not yet');
  const off = mk(P, [0, 64, 1]).canUse();
  ok(!off, 'doorinteract: door beside the mob but off its path is NOT touched');
  if (off) fails.push('off-path door touched');
  // anti-vacuity: with the path record gone the on-path door must no longer be found
  const g2 = mk(P, [1, 65, 0]); g2.canUse();
  const e3 = { type: 'zombie', x: 0.5, y: 64, z: 0.5 };
  const g3 = new Ai.BreakDoorGoal(e3, { doorAt: (x, y, z) => (x === 1 && y === 65 && z === 0 ? { closed: true, iron: false, wood: true } : null) });
  if (!g3.canUse()) { breaks++; console.log('   ✓ break caught: no live path, on-path door not found'); } else fails.push('anti-vacuity: path');
  // anti-vacuity: an off-path door adjacent to the mob (old neighbour scan) would be found
  const e4 = { type: 'zombie', x: 0.5, y: 64, z: 0.5, navPath: P, navIdx: 0 };
  const g4 = new Ai.BreakDoorGoal(e4, { doorAt: (x, y, z) => (x === 1 && y === 64 && z === 0 ? { closed: true, iron: false, wood: true } : null) });
  if (!g4.canUse()) { breaks++; console.log('   ✓ break caught: old neighbour-scan door (feet level, adjacent) ignored'); } else fails.push('anti-vacuity: neighbour'); }
const bash = r.evs.filter(v => v === 'entity.zombie.attack_wooden_door').length;
ok(bash >= 3 && bash <= 30, '1019 fires ~1/20 ticks over 240 (got ' + bash + ')');
ok(r.st.join() === '0,1,2,3,4,5,6,7,8,9,10', 'crack stages 0..10 in order (10 on the break tick, as vanilla) (got ' + r.st.join() + ')');
ok(r.evs.filter(v => v === 'entity.zombie.break_wooden_door').length === 1 && r.broke === 1, '1021 once on break');
ok(r.after === -1, 'stop() clears crack info');
// anti-vacuity: disable each effect, the check must notice
const saved = Ai.doorEvent;
Ai.doorEvent = () => {};
const r2 = run();
if (!r2.evs.length) { breaks++; console.log('   ✓ break caught: door sounds removed'); } else fails.push('anti-vacuity: sounds');
Ai.doorEvent = saved;
Math.random = () => 0.99;
const r3 = run();
if (!r3.evs.includes('entity.zombie.attack_wooden_door')) { breaks++; console.log('   ✓ break caught: 1019 roll never hits'); } else fails.push('anti-vacuity: roll');
console.log('\n================ doorbashcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
