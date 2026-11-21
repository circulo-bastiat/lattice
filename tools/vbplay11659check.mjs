#!/usr/bin/env node
// vbplay11659check.mjs — #11659: proves 07zv2_vbplay.js's LivingTargetCache (nearestOfKind via VB.tickFreeFollow),
// MemoryModuleState (VISIBLE_VILLAGER_BABIES gate in VB.playFallbackTick) and WaitTask(20,40) (playWaitStart).
// Real entry points: VB.tickFreeFollow / VB.playFallbackTick on really spawned villagers. Source breaks must fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv2_vbplay.js', '14_player.js'];
let asserted = 0;
function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const M = loadEngine({ extra: EXTRA, dom: false, patch });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; M.Effects.ready = true;
  M.World.init(1); M.Behave.init(M.World);
  if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
  M.EntityList.init();
  const EL = M.EntityList, VB = M.VB;
  const v = EL.spawn('villager', 0, 64, 0);
  // LivingTargetCache: nearest cat within range wins over a farther one; out-of-range is ignored
  const near = EL.spawn('cat', 2, 64, 0), far = EL.spawn('cat', 6, 64, 0), out = EL.spawn('cat', 20, 64, 0);
  if (!v || !far || !near || !out) { f.push('spawn failed'); return f; }
  VB.FREE_FOLLOW_CANDIDATES = [['cat', 1]];
  v.vbFollowTarget = null; VB.tickFreeFollow(v);
  no(v.vbFollowTarget === near, 'free-follow did not pick the nearest cat');
  near.dead = true; far.dead = true; v.vbFollowTarget = null; VB.tickFreeFollow(v);
  no(!v.vbFollowTarget, 'free-follow picked a dead/out-of-range cat');
  // MemoryModuleState: without visible babies the play RandomTask refuses; with one it runs
  VB.PLAY_FALLBACK = [['wait', 1]];
  v.vbIdleWait = null;
  no(VB.playFallbackTick(v) === null && !v.vbIdleWait, 'play task ran with no visible baby');
  const b = EL.spawn('villager', 3, 64, 0); b.isBaby = true;
  // WaitTask(20,40): window bounds
  for (const [r, lo] of [[0, 20], [0.999999, 40]]) {
    VB.rand = () => r; v.vbIdleWait = null;
    no(VB.playFallbackTick(v) === 'wait', 'wait not chosen with a visible baby');
    no(v.vbIdleWait && v.vbIdleWait.ticksLeft === lo, 'wait window ' + (v.vbIdleWait && v.vbIdleWait.ticksLeft) + ' != ' + lo);
  }
  return f;
}
const fails = run();
const brk = (a, b) => (fl, s) => { if (fl !== '07zv2_vbplay.js') return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['nearest', brk('dsq < bestDsq) { best = o; bestDsq = dsq; }\n      }\n    }\n    if (kind', 'true) { best = o; bestDsq = dsq; }\n      }\n    }\n    if (kind')],
  ['range', brk('if (dsq <= rangeSq && dsq < bestDsq)', 'if (dsq < bestDsq)')],
  ['baby gate', brk('if (!visibleBabies(e).length) return null;', '')],
  ['wait min', brk('PLAY_WAIT_MIN_TICKS = 20', 'PLAY_WAIT_MIN_TICKS = 10')],
  ['wait max', brk('PLAY_WAIT_MAX_TICKS = 40', 'PLAY_WAIT_MAX_TICKS = 60')],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('vbplay11659check: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log('assertions passed ..... ' + asserted);
console.log(caught + ' breaks caught');
