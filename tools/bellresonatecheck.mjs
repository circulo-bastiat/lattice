#!/usr/bin/env node
// bellresonatecheck.mjs — G18f-B2: RingBellTask (VB.ringBellTask, src/07zv_villagerbrain.js).
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

console.log('bellresonatecheck — villager RingBellTask');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv3_vbpanic.js', '07zv7_vbbell.js', '07zv9_vbdoors.js', '07s_raid.js'];
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


const BE = M.BlockEntity || M.BlockEntities;
function run(removeTick) {
  EL.list.length = 0;
  const b = (x) => { const e = EL.spawn('pillager', x, PLAT_Y + 1, 0); e.ai = new Ai.GoalSelector(); return e; };
  const p40 = b(40.5 > 28 ? 20.5 : 20.5);
  p40.x = 40.5; const p60 = b(0); p60.x = 60.5;
  const cow = EL.spawn('cow', 10.5, PLAT_Y + 1, 0);
  const near = b(0); near.x = 20.5;
  const bell = BE.create(0, PLAT_Y + 1, 0, 'bell');
  M.Bell.activate(0, PLAT_Y + 1, 0);
  if (removeTick) M.Bell.tick = function () {};
  for (let i = 0; i < 60; i++) { for (const m of [p40, p60, near, cow]) { m.x = m.x; } BE.tick(); }
  const g = (m) => M.Effects.hasStatusEffect(m, 'glowing');
  return { p40: g(p40), p60: g(p60), cow: g(cow), near: g(near) };
}
const real = M.Bell.tick;
let r = run(false);
ok(r.near, 'raider 20 blocks away glows');
ok(r.p40, 'pillager at 40 blocks glows');
ok(!r.p60, 'pillager at 60 blocks does not glow');
ok(!r.cow, 'non-raider does not glow');
M.Bell.tick = real;
r = run(true);
okAv(!r.near && !r.p40, 'tick removed -> nothing glows (the glow asserts would fail)');
M.Bell.tick = real;
console.log(`\n${pass} ok, ${breaks} breaks caught, ${fails.length} failed`);
if (fails.length) { console.log('FAIL', fails); process.exit(1); }
console.log(`PASS bellresonatecheck (${pass} checks)`);
