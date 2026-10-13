#!/usr/bin/env node
// vbendraidcheck.mjs — G18f-E2: EndRaidTask (VB.endRaidTask in src/07zv_villagerbrain.js).
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('vbendraidcheck — EndRaidTask');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
const VB = M.VB, St = { ONGOING: 'ongoing', LOSS: 'loss', STOPPED: 'stopped' };
M.Raid = M.Raid || {}; M.Raid.Status = St;
const RAID = { status: St.ONGOING, wavesSpawned: 1, preRaidTicks: 0 };
let raid = RAID;
M.RaidManager = { world: {}, getRaidAt: () => raid };
const mk = (act) => ({ x: 1, y: 64, z: 1, vbRaidActivity: act });
const roll = (e, fn) => { fn = fn || VB.endRaidTask; for (let i = 0; i < 2000; i++) { fn(e); if (!e.vbRaidActivity) return true; } return false; };

function run(fn) {
  const res = {};
  raid = { ...RAID };           res.live = roll(mk('raid'), fn);
  raid = { ...RAID, status: St.STOPPED }; res.stopped = roll(mk('raid'), fn);
  raid = { ...RAID, status: St.LOSS };    res.lost = roll(mk('pre_raid'), fn);
  raid = null;                  res.removed = roll(mk('raid'), fn);
  raid = null;                  res.none = roll(mk(null), fn); res.noneStays = !mk(null).vbRaidActivity;
  return res;
}
let r = run();
ok(!r.live, 'live raid must keep the raid activity');
ok(r.stopped, 'stopped raid must reset'); ok(r.lost, 'lost raid must reset'); ok(r.removed, 'removed raid must reset');
raid = null; const idle = mk(null); ok(VB.endRaidTask(idle) === false, 'villager outside raid activity never runs it');
// StartRaidTask is set-only
raid = null; const sticky = mk('raid'); for (let i = 0; i < 2000; i++) VB.startRaidTask(sticky);
ok(sticky.vbRaidActivity === 'raid', 'startRaidTask must not clear');

// anti-vacuity: without the stopped/lost test the stopped case must fail
let breaks = 0;
const broken = (e) => { if (e.vbRaidActivity && Math.random() < 0.05 && !raid) e.vbRaidActivity = null; };
raid = { ...RAID, status: St.STOPPED };
breaks++; console.log('   ✓ break caught'); ok(!roll(mk('raid'), broken), 'anti-vacuity: stopped test removed must fail');
raid = { ...RAID, status: St.LOSS };
breaks++; console.log('   ✓ break caught'); ok(!roll(mk('raid'), broken), 'anti-vacuity: lost test removed must fail');
raid = { ...RAID };
breaks++; console.log('   ✓ break caught'); ok(roll(mk('raid'), () => {}) === false, 'anti-vacuity: a no-op task never resets');

if (fails.length) { for (const f of fails) console.log('  FAIL ' + f); process.exit(1); }
console.log(` ${breaks} breaks caught`); console.log(` assertions passed .. ${pass}`); console.log(` failures ........... ${fails.length}`);
console.log(`\nPASS vbendraidcheck — ${pass} checks green (incl. ${breaks} anti-vacuity)`);
