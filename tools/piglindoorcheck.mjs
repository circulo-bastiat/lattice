#!/usr/bin/env node
// piglindoorcheck.mjs — #2555: piglin/piglin_brute open wooden doors (canOpenDoors + OpenDoorsTask stand-in). Proves it can fail.
import { loadEngine, initRegistry } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
  '07m_breed.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
  '07zz_xporb.js', '07zzf_piglin.js', '14e_gamemode.js'], dom: false });
if (initRegistry) initRegistry(M);
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const run = (type, wire = true) => {
  const calls = [];
  const e = { type, x: 0.5, y: 64, z: 0.5, horizontalCollision: true, random: Math.random };
  const ctx = { random: Math.random, players: [], doorAt: (x, y, z) => (x === 1 ? { wood: true, iron: false } : null),
    setDoorOpen: (x, y, z, o) => calls.push(o) };
  const gs = M.Piglin.roster(e, ctx);
  if (!wire) { e.canOpenDoors = false; gs.entries = gs.entries.filter(en => en.priority !== 0); }
  const en = gs.entries.find(x => x.priority === 0);
  if (en && en.goal.canUse()) en.goal.start();
  return e.canOpenDoors === true && calls[0] === true;
};
for (const t of ['piglin', 'piglin_brute']) ok(run(t), t + ' opens a closed wooden door');
if (!run('piglin_brute', false)) { breaks++; console.log('   ✓ break caught: goal removed'); } else fails.push('anti-vacuity: removed goal unnoticed');
console.log('\n================ piglindoorcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
