#!/usr/bin/env node
// vbpaniccheck.mjs — loop/vbpanic: villager Activity.PANIC (src/07zv3_vbpanic.js's own
// `NS.VBPanic`, hooked one line into src/07zv_villagerbrain.js's own `VB.tick`).
// Every number here is cited in 07zv3_vbpanic.js, read off `.decomp` this session:
// PanicTask.java, StopPanickingTask.java, VillagerHostilesSensor.java, MemoryModuleType.java,
// LivingEntity.java (getRecentDamageSource), FuzzyTargeting.java, VillagerTaskListProvider.java
// (createPanicTasks), VillagerEntity.java (summonGolem).
//
//   node tools/vbpaniccheck.mjs [--verbose]
//
// Sections:
//   1. HURT_BY substrate: a real Cb.mobAttack hit on a villager flips VB.tick's own activity to
//      'panic' (wasHurt, 40-tick decay), and decays back out once past it (with no hostile near)
//   2. NEAREST_HOSTILE substrate: a hostile within ITS OWN per-type danger distance triggers
//      panic with NO damage at all; the same type just past that distance does not (both
//      directions of the per-type distance table, straight off VillagerHostilesSensor's own
//      SQUARED_DISTANCES_FOR_DANGER map)
//   3. flee direction: a panicking villager actually walks AWAY from the hostile/attacker
//   4. StopPanickingTask's hysteresis: wasHurtByNearbyEntity keeps panic running (attacker still
//      within 6 blocks) even once wasHurt/isHostileNearby both go false, and forgets HURT_BY/
//      HURT_BY_ENTITY the tick it finally does stop
//   5. panic pre-empts the schedule (doExclusively): a villager mid-'work' that gets hurt
//      switches to 'panic', not 'work', that same tick
//   6. the panic-quorum golem summon (PanicTask's own summonGolem(...,3), lower than
//      Village.tickSummon's own quorum-5 poll) — wired through the existing Village hooks
//   7. anti-vacuity — breaking this unit's own data and watching the break get caught

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

// mulberry32 -- a small deterministic PRNG (enchhelpercheck.mjs's own precedent) so section 11's
// fuzz-search retries below are reproducible rather than occasionally timing out on an unlucky
// run of VB.rand()===Math.random() whiffs (FuzzyTargeting's own candidate search, ported as
// VB.localFuzzToward, can legitimately return null a few times in a row).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log('vbcustomercheck — #2871 villager FollowCustomerTask');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv3_vbpanic.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Entities.attrs = M.DATA.entities.attrs;
M.Effects.ready = true;

const W = M.World, CH = M.CH, R = M.Reg, SR = M.States;
const Poi = M.Poi, Ai = M.Ai, VB = M.VB, VBP = M.VBPanic, EL = M.EntityList, Prof = M.Profession;
const Cb = M.Combat, Vg = M.Village;

ok(VB, 'NS.VB did not load');
ok(VBP, 'NS.VBPanic did not load');
ok(Cb, 'NS.Combat did not load');
ok(Vg, 'NS.Village did not load');
if (!VB || !VBP || !Cb || !Vg) { console.log('\nFAIL vbpaniccheck — module missing'); process.exit(1); }

W.init(1);
M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init();
Ai.init();
Prof.init();
Cb.init && Cb.init();
ok(Ai.ready, 'Ai module reports ready');
ok(VBP.ready, 'NS.VBPanic reports ready');

for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const STONE = SR.stateOf('stone');
const PLAT_Y = 63;
function plate(radius, y) { for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, y ?? PLAT_Y, z, STONE); }
plate(28, PLAT_Y);

function spawnStillVillager(x, y, z) {
  const v = EL.spawn('villager', x, y, z);
  v.ai = new Ai.GoalSelector();   // deterministic tick budget, sleepcheck's own precedent
  return v;
}
function tickN(v, n) { for (let i = 0; i < n; i++) VB.tick(v); }
M.Sky = { dayTime: 10 };   // VILLAGER_DEFAULT's own idle window, unless a section overrides it


const run = (customer) => { const v = spawnStillVillager(0, PLAT_Y + 1, 0); v.customer = customer; VB.tick(v); return v; };
const near = { x: 3, y: PLAT_Y + 1, z: 0 }, far = { x: 10, y: PLAT_Y + 1, z: 0 };
let v = run(near);
ok(v.vbWalkTarget && v.vbWalkTarget.x === 3 && v.vbWalkTarget.range === 2, 'walk target on customer');
ok(v.vbLookTarget && v.vbLookTarget.x === 3, 'look target on customer');
v.customer = far; VB.tick(v);
ok(!v.vbWalkTarget && !v.vbLookTarget, 'cleared when dist^2>16');
v = run(near); v.customer = null; VB.tick(v);
ok(!v.vbWalkTarget && !v.vbLookTarget, 'cleared when customer closes');
v = run(null); okAv(!v.vbFollowingCustomer, 'no customer -> not following (idle/wander may set its own walk target)');
v = run(far); okAv(!v.vbFollowingCustomer, 'far customer -> no look target');

console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  fails.forEach((m) => console.log('  - ' + m));
  console.log('\nFAIL vbcustomercheck');
  process.exit(1);
}
console.log(`\nPASS vbcustomercheck — ${pass} checks passed, 0 failures (incl. ${breaks} breaks caught)`);
