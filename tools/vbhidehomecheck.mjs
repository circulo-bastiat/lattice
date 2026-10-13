#!/usr/bin/env node
// vbhidehomecheck.mjs — G18f-B3: HideWhenBellRingsTask/ForgetBellRingTask (src/07zv7_vbbell.js).
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

console.log('vbhidehomecheck — villager HIDE activity');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv3_vbpanic.js', '07zv7_vbbell.js', '07zv8_vbhidehome.js'];
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

ok(Cb, 'NS.Combat did not load');
ok(Vg, 'NS.Village did not load');
if (!VB ||  !Cb || !Vg) { console.log('\nFAIL vbpaniccheck — module missing'); process.exit(1); }

W.init(1);
M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init();
Ai.init();
Prof.init();
Cb.init && Cb.init();
ok(Ai.ready, 'Ai module reports ready');
ok(M.VBHideHome, 'NS.VBHideHome loaded');

for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const STONE = SR.stateOf('stone');
const PLAT_Y = 63;
function plate(radius, y) { for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, y ?? PLAT_Y, z, STONE); }



plate(40, PLAT_Y);
const H = M.VBHideHome;
function bedHeadState(name) {
  const b = R.id[name], P_ = R.PROP, V = R.PVAL;
  for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) if (SR.propValue(s, P_.part) === V.head && SR.propValue(s, P_.occupied) === V['false']) return s;
  return null;
}
W.setBlock(0, PLAT_Y + 1, 0, bedHeadState('red_bed'));
Poi.rescanNow();
function spawn(x, z) { const v = EL.spawn('villager', x, PLAT_Y + 1, z); v.ai = new Ai.GoalSelector(); return v; }
M.RaidManager = M.RaidManager || {};
const RM = M.RaidManager; RM.world = {};
const fakeRaid = { status: 'ongoing' };
RM.getRaidAt = () => fakeRaid;
const realTick = VB.tick; VB.tick = (e) => { if (e.type === 'villager') H.raidTick(e); };   // physics only: the brain's own walking would mask the task
function trial(dist, hasHome, capOff) {
  const v = spawn(dist, 0);
  W.setBlock(0, PLAT_Y + 1, 0, hasHome ? bedHeadState('red_bed') : 0); Poi.rescanNow();
  
  const save = H.RAID_DIST; if (capOff) H.RAID_DIST = 1e6;
  const x0 = v.x;
  for (let i = 0; i < 400; i++) { EL.tick(); }
  H.RAID_DIST = save;
  const r = { moved: Math.abs(v.x - x0) > 0.5, d: Math.hypot(v.x - 0.5, v.z - 0.5) };
  EL.clear(); return r;
}
const a = trial(20, true, false);
ok(a.moved && a.d <= 1.6, 'villager 20 blocks away ends within completionRange of the bed (d=' + a.d.toFixed(2) + ')');
ok(!trial(20, false, false).moved, 'no HOME: does not move');
ok(!trial(30, true, false).moved, '30 blocks: beyond the 24 cap, does not move');
okAv(trial(30, true, true).moved, 'with the 24-block cap removed a 30-block villager moves');
RM.getRaidAt = () => null;
VB.tick = realTick;
{ const v = spawn(10, 0); v.vbHome = { x: 0, y: PLAT_Y + 1, z: 0 }; const x0 = v.x; for (let i = 0; i < 20; i++) H.raidTick(v); ok(v.x === x0, 'no raid: raidTick does not move'); EL.clear(); }
console.log(`\n${pass} ok, ${breaks} breaks caught, ${fails.length} failed`);
if (fails.length) { console.log('FAIL', fails); process.exit(1); }
console.log(`PASS vbhidehomecheck (${pass} checks)`);
