#!/usr/bin/env node
// vbjobacquirecheck.mjs — G18f-J1: job-site acquisition by the Brain (VB.jobAcquireTick):
// FindPointOfInterestTask(workstation -> POTENTIAL_JOB_SITE) + WalkTowardJobSiteTask + GoToWorkTask
// (VillagerTaskListProvider.createCoreTasks:36-45) replace the 8-neighbour Prof.tryClaim.
//   node tools/vbjobacquirecheck.mjs [--verbose]
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
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('vbjobacquirecheck — G18f-J1: job-site acquisition by the Brain');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv2_vbplay.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Entities.attrs = M.DATA.entities.attrs;
M.Effects.ready = true;

const W = M.World, CH = M.CH, R = M.Reg, SR = M.States;
const Poi = M.Poi, Ai = M.Ai, VB = M.VB, EL = M.EntityList, Prof = M.Profession;

ok(VB, 'NS.VB did not load');
ok(Prof, 'NS.Profession did not load');
if (!VB || !Prof) { console.log('\nFAIL vbactivitycheck — module missing'); process.exit(1); }

W.init(1);
M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init();
Ai.init();
Prof.init();
ok(Ai.ready, 'Ai module reports ready');
ok(Prof.ready, 'Profession module reports ready');

for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const STONE = SR.stateOf('stone');
const PLAT_Y = 63;
function plate(radius, y) { for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, y, z, STONE); }
plate(24, PLAT_Y);

const SMITHING = SR.stateOf('smithing_table');   // Prof.WORKSTATIONS.toolsmith
function placeWorkstation(x, z) { W.setBlock(x, PLAT_Y + 1, z, SMITHING); }

function spawnStillVillager(x, y, z) {
  const v = EL.spawn('villager', x, y, z);
  v.ai = new Ai.GoalSelector();   // deterministic tick budget, see sleepcheck's own precedent
  return v;
}
function tickN(v, n = 60) { for (let i = 0; i < n; i++) VB.tick(v); }

const LECTERN = SR.stateOf('lectern');
function run2(vx, lx, ticks, adjacency, other) {
  EL.clear();
  for (let x = -24; x <= 24; x++) W.setBlock(x, PLAT_Y + 1, 0, 0);
  W.setBlock(lx, PLAT_Y + 1, 0, LECTERN);
  Poi.rescanNow(); Prof.init();
  if (other) Poi.reserveTicket({ x: lx, y: PLAT_Y + 1, z: 0 });
  M.Sky = { dayTime: 6000 };
  const v = spawnStillVillager(vx + 0.5, PLAT_Y + 1, 0.5);
  v.profession = 'none';
  const orig = VB.jobAcquireTick;
  if (adjacency) VB.jobAcquireTick = (e) => { Prof.tryClaim(e); };
  for (let t = 0; t < ticks; t++) { VB.tick(v); EL.tick(); }
  VB.jobAcquireTick = orig;
  return v;
}
function case20(adj) { return run2(-10, 10, 3000, adj, false); }
const v1 = case20(false);
ok(v1.profession === 'librarian', `a none-villager 20 blocks from a free lectern becomes a librarian, got ${v1.profession}`);
ok(v1.workstation && v1.workstation.x === 10, 'its workstation is the lectern');
const v2 = run2(-10, 10, 3000, false, true);
ok(v2.profession === 'none', `a lectern already ticketed to another villager is not taken, got ${v2.profession}`);
// 80 blocks away: outside CLAIM_RADIUS (48); plate only spans 24, so place the lectern in the world off-plate
EL.clear();
W.setBlock(80 - 0, PLAT_Y + 1, 0, 0);
{
  for (let x = 25; x <= 90; x++) W.setBlock(x, PLAT_Y, 0, STONE);
  for (let x = -24; x <= 24; x++) W.setBlock(x, PLAT_Y + 1, 0, 0);
  W.setBlock(70, PLAT_Y + 1, 0, LECTERN);
  Poi.rescanNow(); Prof.init();
  M.Sky = { dayTime: 6000 };
  const v = spawnStillVillager(-10 + 0.5, PLAT_Y + 1, 0.5); v.profession = 'none';
  for (let t = 0; t < 3000; t++) { VB.tick(v); EL.tick(); }
  ok(v.profession === 'none', `a workstation 80 blocks away is not found, got ${v.profession}`);
}
breaks++;
{
  const v = case20(true);
  ok(v.profession === 'none', 'anti-vacuity: the adjacency-only rule does NOT acquire the 20-block lectern');
  console.log('   ✓ anti-vacuity: the adjacency-only rule fails the 20-block case');
}

if (fails.length) { console.log('\nFAIL vbjobacquirecheck'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log(`\nvbjobacquirecheck: ${pass} assertions, 0 failures, ${breaks} deliberate breaks caught`);
