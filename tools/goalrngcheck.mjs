#!/usr/bin/env node
// goalrngcheck.mjs — #6213: AI goals draw from the owning mob's e.random (a JRandom), never Math.random.
// (1) zero Math.random in src/07k_goals.js after comment strip; (2) a stroll scenario, same world seed -> same trace after 400 ticks.
// Anti-vacuity (D-30): reintroducing Math.random in the goal's source / a Math.random-seeded mob must be caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02m_jrandom.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js'];
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const count = (src) => (strip(src).match(/Math\.random/g) || []).length;
function trace(seed, fault) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
  M.World.init(seed); M.Behave.init(M.World); M.EntityList.init();
  if (fault) M.World.seed64 = BigInt(Math.floor(Math.random() * 1e9));
  const e = M.EntityList.spawn('cow', 0, 70, 0);
  const g = new M.Ai.WaterAvoidingRandomStrollGoal(e, 1.0);
  const out = [];
  for (let t = 0; t < 400; t++) {
    if (g.canUse()) { g.start(); out.push(t); }
    else if (g.canContinueToUse()) g.tick();
    else g.stop();
  }
  return out.join(',') + '|' + e.random.nextInt() + '|' + e.x.toFixed(4) + ',' + e.z.toFixed(4);
}
const fails = [];
const src = readFileSync(join(MCLITE_ROOT, 'src/07k_goals.js'), 'utf8');
if (count(src) !== 0) fails.push(`${count(src)} Math.random left in 07k_goals.js`);
const a = trace(777), b = trace(777);
if (a !== b) fails.push('same seed, different stroll trace');
let breaks = 0;
if (count(src + '\nvar x = Math.random();') !== 0) { breaks++; console.log('✓ fault (reintroduced Math.random) caught'); } else fails.push('anti-vacuity: textual fault missed');
if (trace(777, true) !== a) { breaks++; console.log('✓ fault (Math.random-seeded mob) caught'); } else fails.push('anti-vacuity: seeded fault missed');
if (fails.length) { console.log('goalrngcheck FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`\n3 checks passed, 0 failures, ${breaks} breaks caught`);
