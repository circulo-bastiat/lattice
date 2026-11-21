#!/usr/bin/env node
// entityrngcheck.mjs — #6212: each spawned entity owns an NS.JRandom seeded from (world seed, spawn counter).
// Spawns 3 cows with the same world seed twice: streams must match, and differ between cows.
// Anti-vacuity (D-30): a Math.random-seeded spawn must be caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02m_jrandom.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js'];
function streams(seed, fault) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
  M.World.init(seed); M.Behave.init(M.World); M.EntityList.init();
  if (fault) M.World.seed64 = BigInt(Math.floor(Math.random() * 1e9));
  const out = [];
  for (let i = 0; i < 3; i++) {
    const e = M.EntityList.spawn('cow', i, 70, 0);
    out.push(e && e.random ? [e.random.nextInt(), e.random.nextInt(), e.random.nextLong().toString()].join(',') : 'none');
  }
  return out;
}
const a = streams(12345), b = streams(12345);
const fails = [];
if (a.join('|') !== b.join('|')) fails.push('same seed gave different streams');
if (new Set(a).size !== 3 || a.includes('none')) fails.push('cows share a stream or have none');
let breaks = 0;
if (streams(12345, true).join('|') !== a.join('|')) { breaks++; console.log("✓ fault (Math.random seed) caught"); } else fails.push('anti-vacuity: Math.random seed not caught');
if (fails.length) { console.log('entityrngcheck FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`\n${6 - fails.length} checks passed, 0 failures, ${breaks} breaks caught`);
