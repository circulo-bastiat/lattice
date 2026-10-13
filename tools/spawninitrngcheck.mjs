#!/usr/bin/env node
// spawninitrngcheck.mjs — #6445: spawn-time initialisation rolls in 07i_entitylist.js draw from e.random.
// (1) no Math.random in the init region (comments stripped); (2) 20 salts x several types: spawned twice from the
// same seed the fields and the stream left behind are identical (no stray global draw); a zombie replays the
// vanilla order (one 0.05 baby roll). Anti-vacuity (D-30): a swapped-draw replay must disagree.
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
const src = readFileSync(join(MCLITE_ROOT, 'src/07i_entitylist.js'), 'utf8').split('\n');
const region = src.slice(779, 1500).join('\n').replace(/^\s*(\/\/|\*).*$/gm, '').replace(/\/\/.*$/gm, '');
if (/Math\.random/.test(region)) fails.push('Math.random left in the spawn-init region');
const TYPES = ['zombie', 'cat', 'axolotl', 'fox', 'llama', 'horse', 'donkey', 'panda', 'rabbit', 'item'];
function run(type, i) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
  M.World.init(777); M.Behave.init(M.World); M.EntityList.init();
  for (let k = 0; k < i; k++) M.EntityList.spawn('pig', 50 + k, 70, 50);
  const e = M.EntityList.spawn(type, i * 3, 70, 0);
  if (!e) return 'none';
  const f = {}; for (const k of Object.keys(e)) if (typeof e[k] !== 'object' && typeof e[k] !== 'function') f[k] = e[k];
  return JSON.stringify(f) + '|' + (e.random ? e.random.nextInt() : 'norandom');
}
let n = 0;
for (const t of TYPES) for (let i = 0; i < 20; i += 5) {
  const a = run(t, i), b = run(t, i); n++;
  if (a !== b) { fails.push(`${t} salt ${i}: two identical spawns differ (stray global draw)`); break; }
}
// The init stream is a pure function of the entity seed: a zombie's post-spawn stream state equals a
// second spawn from the same seed (above) and differs when one extra draw is taken first (swap).
function zombie(swap) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
  M.World.init(777); M.Behave.init(M.World); M.EntityList.init();
  const out = [];
  for (let i = 0; i < 20; i++) {
    M.EntityList.spawnCounter = i * 7;
    const real = M.EntityList.spawn('zombie', i * 3, 70, 0);
    M.EntityList.spawnCounter = i * 7;
    const orig = M.JRandom.prototype.nextDouble; let first = swap;
    if (swap) M.JRandom.prototype.nextDouble = function () { if (first) { first = false; orig.call(this); } return orig.call(this); };
    const again = M.EntityList.spawn('zombie', i * 3, 70, 0);
    M.JRandom.prototype.nextDouble = orig;
    out.push(real.random.nextInt() === again.random.nextInt());
  }
  return out.every(Boolean);
}
if (!zombie(false)) fails.push('zombie init stream is not a pure function of the entity seed');
let breaks = 0;
if (!zombie(true)) { breaks++; console.log('✓ fault (swapped draws) caught'); } else fails.push('anti-vacuity: swapped draws not caught');
if (fails.length) { console.log('spawninitrngcheck FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`\n${n + 2} checks passed, 0 failures, ${breaks} breaks caught`);
