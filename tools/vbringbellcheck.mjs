#!/usr/bin/env node
// vbringbellcheck.mjs — G18f-B2: RingBellTask (VB.ringBellTask, src/07zv_villagerbrain.js).
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

console.log('vbringbellcheck — villager RingBellTask');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv3_vbpanic.js', '07zv7_vbbell.js', '07zv9_vbdoors.js'];
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



const BELL = SR.stateOf('bell', { attachment: 'floor', facing: 'north', powered: 'false' });
W.setBlock(0, PLAT_Y + 1, 0, BELL);
function trial(dx, n, gate) {
  EL.clear();
  const v = spawnStillVillager(dx + 0.5, PLAT_Y + 1, 0.5);
  v.vbMeeting = { x: 0, y: PLAT_Y + 1, z: 0 };
  v.vbRaidActivity = 'pre_raid';
  VB.bellRings = 0;
  const real = VB.RING_BELL_DISTANCE;
  if (gate === 'off') VB.RING_BELL_DISTANCE = 1e9;
  let seed = 7; VB.rand = mulberry32(seed);
  for (let i = 0; i < n; i++) VB.ringBellTask(v);
  VB.RING_BELL_DISTANCE = real;
  return VB.bellRings;
}
const N = 4000;
const near = trial(2, N), far = trial(4, N);
ok(near > N * 0.03 && near < N * 0.07, 'villager 2 blocks from the bell rings ~5%/tick (' + near + '/' + N + ')');
ok(far === 0, 'villager 4 blocks away never rings (' + far + ')');
W.setBlock(0, PLAT_Y + 1, 0, 0);
ok(trial(2, N) === 0, 'no bell block -> no ring');
W.setBlock(0, PLAT_Y + 1, 0, BELL);
okAv(trial(4, N, 'off') > 0, 'distance gate dropped -> 4-block villager rings (the far===0 assert would fail)');
console.log(`\n${pass} ok, ${breaks} breaks caught, ${fails.length} failed`);
if (fails.length) { console.log('FAIL', fails); process.exit(1); }
console.log(`PASS vbringbellcheck (${pass} checks)`);
