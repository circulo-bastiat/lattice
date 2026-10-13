#!/usr/bin/env node
// vbstartraidcheck.mjs — StartRaidTask (.decomp StartRaidTask.java) in VB.tick: nextInt(20)==0 roll;
// getRaidAt -> hasSpawned && !isPreRaid => 'raid', else 'pre_raid'; no raid keeps the schedule.

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

console.log('vbstartraidcheck — loop/vbpanic: villager Activity.PANIC (NS.VBPanic, NS.VB.tick hook)');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv3_vbpanic.js', '07s_raid.js'];
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
if (!VB || !VBP || !Cb || !Vg) { console.log('\nFAIL vbstartraidcheck — module missing'); process.exit(1); }

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


const RM = M.RaidManager;
ok(RM && M.Raid, 'NS.RaidManager/NS.Raid loaded');
const mkRaid = (wavesSpawned, preRaidTicks) => ({ center: { x: 0, y: PLAT_Y + 1, z: 0 }, status: M.Raid.Status.ONGOING, wavesSpawned, preRaidTicks });
const setRaid = (r) => { RM.world = { raids: r ? { 1: r } : {}, nextId: 2 }; };
const rolls = (v, n) => { let hits = 0; for (let i = 0; i < n; i++) { v.vbRaidActivity = null; VB.tick(v); if (v.vbRaidActivity) hits++; } return hits; };
const saved = VB.rand;

console.log('\n 1. outcomes (roll forced to 0)');
VB.rand = () => 0;
let v = spawnStillVillager(0, PLAT_Y + 1, 0);
setRaid(null); VB.tick(v);
ok(v.vbActivity === 'idle', 'outside any raid the schedule (idle) stands');
setRaid(mkRaid(1, 0)); VB.tick(v);
ok(v.vbActivity === 'raid', 'spawned raid, not pre-raid -> raid');
setRaid(mkRaid(1, 300)); VB.tick(v);
ok(v.vbActivity === 'pre_raid', 'spawned raid still in preRaidTicks -> pre_raid');
setRaid(mkRaid(0, 0)); VB.tick(v);
ok(v.vbActivity === 'pre_raid', 'raid not yet spawned -> pre_raid');
setRaid(null); VB.tick(v);
ok(v.vbActivity === 'idle', 'raid gone, next roll clears it -> schedule again');
EL.clear();

console.log('\n 2. cadence 1/20 (seeded)');
VB.rand = mulberry32(7);
v = spawnStillVillager(0, PLAT_Y + 1, 0); setRaid(mkRaid(1, 0));
const h = rolls(v, 2000);
okAv(h > 60 && h < 140, 'about 1 in 20 ticks roll the task (' + h + '/2000)');
VB.rand = () => 0.5; v.vbRaidActivity = null; VB.tick(v);
okAv(!v.vbRaidActivity && v.vbActivity === 'idle', 'a failed roll (0.5) does not switch activity');
EL.clear();
VB.rand = saved;

console.log(` ${breaks} breaks caught`); console.log(` assertions passed .. ${pass}`); console.log(` failures ........... ${fails.length}`);
console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) { fails.forEach((m) => console.log('  - ' + m)); console.log('\nFAIL vbstartraidcheck'); process.exit(1); }
console.log(`\nPASS vbstartraidcheck — ${pass} checks green (incl. ${breaks} anti-vacuity)`);
