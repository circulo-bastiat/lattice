#!/usr/bin/env node
// #2852 -- natural rabbit pack: members after the first are kits (RabbitEntity.initialize RabbitData super(1.0F)).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
          '07n_tame.js', '07r_mount.js', '07w_passive.js', '14i_hand.js', '07zx_particle.js', '07z_potion.js', '14f_inventory.js', '14g_menu.js',
          '14l_use.js', '14j_combat.js', '14d_survival.js', '14_player.js', '15b_gui.js']
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Breed.init && M.Breed.init();
M.Mount && M.Mount.init();
M.Ai.init();
M.Combat && M.Combat.init();
const EL = M.EntityList;
M.World.init(1);
const pd = {};
const pack = [0, 1, 2].map(i => EL.spawn('rabbit', i, 70, 0, { spawnIdx: i, packData: pd }));
ok(!(pack[0].growAge < 0), 'first rabbit is an adult');
ok(pack[1].growAge < 0 && pack[2].growAge < 0, 'rabbits after the first are kits');
okAv(!(EL.spawn('rabbit', 5, 70, 0, { spawnIdx: 0, packData: {} }).growAge < 0), 'spawnIdx 0 stays adult');
okAv(!(EL.spawn('rabbit', 6, 70, 0).growAge < 0), 'no opts (egg/command) stays adult');
console.log(`checks: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
console.log('rabbitpackcheck: PASS');
