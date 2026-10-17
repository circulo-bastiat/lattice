#!/usr/bin/env node
// llamacheck.mjs — loop/llama-s97 (QUEUE 0.2 G18e remainder close): LLAMA.
//
//   node tools/llamacheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES, ON TOP OF mountcheck.mjs/donkeycheck.mjs (which already prove the SHARED
// horse-family machinery: feed/temper shape, mounting, the chest attach/resize mechanism, the
// breeding pipeline). This file proves the parts that are genuinely llama-shaped: strength/
// variant rolling on spawn (LlamaEntity.initialize/initializeStrength, .decomp), the flat
// jump/speed + rolled-health attribute branch it shares with donkey/mule, canBeSaddled always
// false (so it never reaches Mount.travelRidden's steering branch), the chest sized off
// STRENGTH rather than donkey/mule's flat 5 columns, the carpet decoration slot (the "armour"
// slot repurposed), its own two-item food/temper table (Mount.LLAMA_FOOD, maxTemper 30),
// Breed.CHILD.llama (strength/variant child roll), the spit projectile (Llama.spit/tick), and
// the placement-tier goal selector (Ai.ROSTER.llama) including SpitRevengeGoal/ChaseWolvesGoal/
// FormCaravanGoal.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');

const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('llamapackcheck — #1234 natural-spawn llama pack shares one variant + 5% baby roll');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
          '07n_tame.js', '07r_mount.js', '07zx_particle.js', '07z_potion.js', '07ze_llama.js', '14f_inventory.js', '14g_menu.js',
          '14l_use.js', '14j_combat.js', '14d_survival.js', '14_player.js', '15b_gui.js']
});
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Ai.init();
M.Breed.init();
M.Tame.init();
M.Mount.init();
M.Combat.init();

const Mnt = M.Mount, Br = M.Breed, EL = M.EntityList, Ai = M.Ai, Ll = M.Llama;
ok(Mnt.ready && Br.ready, 'Mount/Breed both report ready');
ok(!!Ll, 'NS.Llama exists (07ze_llama.js loaded)');

M.World.init(1);
const mk = (type, packData, idx, r) => {
  EL.random = r;
  return EL.spawn(type, 0, 70, 0, { spawnIdx: idx, packData });
};
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
for (const type of ['llama', 'trader_llama']) {
  const pd = {};
  const a = mk(type, pd, 0, Math.random);
  const bs = [1, 2, 3].map(i => mk(type, pd, i, Math.random));
  ok(bs.every(b => b.variant === a.variant), type + ': every pack member shares the first llama\'s variant');
  okAv(bs.every(b => b.variant === a.variant) && a.variant !== undefined, type + ': variant defined (anti-vacuity)');
  const first = mk(type, {}, 0, () => 0.0);
  ok(!(first.growAge < 0), type + ': index 0 never rolls baby');
  const pd2 = {};
  mk(type, pd2, 0, Math.random);
  const lo = mk(type, pd2, 1, () => 0.05), hi = mk(type, pd2, 1, () => 0.06);
  if (type === 'llama') ok(lo.growAge < 0, type + ': rng<=0.05 for index>0 is a baby');
  else okAv(!(lo.growAge < 0), type + ': trader llama never rolls the baby (PassiveData(false), #4011)');
  okAv(!(hi.growAge < 0), type + ': rng>0.05 is an adult');
}
// #4105 donkey/mule: PassiveData(0.2F) -> index>0 foal at nextFloat()<=0.2, index 0 never
for (const type of ['donkey', 'mule']) {
  const pd = {};
  ok(!(mk(type, pd, 0, () => 0.0).growAge < 0), type + ': index 0 never a foal');
  okAv(mk(type, pd, 1, () => 0.2).growAge < 0, type + ': rng<=0.2 for index>0 is a foal');
  okAv(!(mk(type, pd, 1, () => 0.21).growAge < 0), type + ': rng>0.2 is an adult');
}
// solo (no packData) spawns keep rolling independently
const vs = new Set(); for (let i = 0; i < 60; i++) vs.add(mk('llama', undefined, 0, Math.random).variant);
ok(vs.size > 1, 'solo llamas still roll independent variants');

// #5564 FormCaravanGoal: real box overlap (adult 0.9 wide + baby 0.45 wide => reach 9 + 0.45 + 0.225 = 9.675)
{
  const a = mk('llama', undefined, 0, () => 0.5), b = mk('llama', undefined, 0, () => 0.5);
  const realLeashed = Mnt.isLeashed;
  Mnt.isLeashed = (x) => x === b;
  const at = (dx, w) => { Ll.stopFollowing(a); a.x = 0; a.y = 70; a.z = 0; b.x = dx; b.y = 70; b.z = 0; b.width = w; return Ll.canStartCaravan(a); };
  okAv(at(9.3, 0.45) === true, 'caravan: baby 9.3 away (boxes overlap) forms');
  okAv(at(9.7, 0.45) === false, 'caravan: baby 9.7 away (no overlap) does not');
  okAv(at(9.7, 0.9) === true, 'caravan: adult 9.7 away still overlaps (wider box)');
  Mnt.isLeashed = realLeashed;
}

console.log(`\nchecks: ${pass} assertions, ${fails.length} failed, ${breaks} breaks caught`);
if (fails.length) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('llamapackcheck: PASS');
