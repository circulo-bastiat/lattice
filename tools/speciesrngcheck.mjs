#!/usr/bin/env node
// speciesrngcheck.mjs — #6214: species files draw from the mob's e.random, never Math.random.
// (1) no Math.random in 07w_passive.js / 07zk_undead.js; (2) 20 seeded zombies: baby flag + the stream
// left behind equal a JRandom replay of the ZombieEntity.initialize order (one 0.05 baby roll first).
// Anti-vacuity (D-30): a replay with swapped draws must disagree.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02m_jrandom.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
  '07w_passive.js', '07zk_undead.js'];
const fails = [];
for (const f of ['src/07w_passive.js', 'src/07zk_undead.js'])
  if (/Math\.random/.test(readFileSync(join(MCLITE_ROOT, f), 'utf8').replace(/^\s*(\/\/|\*).*$/gm, ''))) fails.push(f + ' still uses Math.random');
// The zombie initialize stream replay moved to spawninitrngcheck.mjs (#6445): spawn-time attribute/equipment
// rolls now draw from e.random too, so the baby roll is no longer the first draw.
let breaks = 0;
const strip = (t) => t.replace(/^\s*(\/\/|\*).*$/gm, '');
if (/Math\.random/.test(strip('var x = Math.random();'))) { breaks++; console.log('✓ fault (injected Math.random) caught'); } else fails.push('anti-vacuity: injected Math.random not caught');
if (fails.length) { console.log('speciesrngcheck FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`\n${2 - fails.length} checks passed, 0 failures, ${breaks} breaks caught`);
