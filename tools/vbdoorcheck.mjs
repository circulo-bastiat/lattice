#!/usr/bin/env node
// vbdoorcheck.mjs — G18f-B3: HideWhenBellRingsTask/ForgetBellRingTask (src/07zv7_vbbell.js).
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

console.log('vbdoorcheck — villager OpenDoorsTask');

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
ok(M.VBDoors, 'NS.VBDoors loaded');

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


const D = M.VBDoors;
const doorState = (name, open) => SR.stateOf(name, { facing: 'east', half: 'lower', hinge: 'left', open: String(open), powered: 'false' });
function setDoor(x, z, name) {
  const lo = SR.stateOf(name, { facing: 'east', half: 'lower', hinge: 'left', open: 'false', powered: 'false' });
  const up = SR.stateOf(name, { facing: 'east', half: 'upper', hinge: 'left', open: 'false', powered: 'false' });
  W.setBlock(x, PLAT_Y + 1, z, lo); W.setBlock(x, PLAT_Y + 2, z, up);
}
const isOpen = (x, z) => { const d = Ai.doorAt(x, PLAT_Y + 1, z); return d && !d.closed; };
function run(name, o) {
  o = o || {};
  for (let x = 0; x <= 8; x++) { W.setBlock(x, PLAT_Y + 1, 0, 0); W.setBlock(x, PLAT_Y + 2, 0, 0); }
  setDoor(4, 0, name);
  if (o.playerOpen) Ai.setDoorOpen(4, PLAT_Y + 1, 0, true);
  const v = spawnStillVillager(0.5, PLAT_Y + 1, 0.5);
  const path = []; for (let x = 0; x <= 8; x++) path.push({ x, y: PLAT_Y + 1, z: 0 });
  v.vbWander = { countdown: 0, running: true, path, idx: 1, until: 1e9, look: null };
  let wasOpen = false;
  for (let i = 0; i < 400 && v.vbWander.idx < path.length; i++) {
    v.x = path[v.vbWander.idx].x + 0.5; v.vbWander.idx++;
    if (v.vbWander.idx >= path.length) break;
    for (let k = 0; k < 21; k++) { if (o.noClose) { const f = D.closeBehind; D.closeBehind = () => {}; D.tick(v, 0); D.closeBehind = f; } else D.tick(v, 0); }
    if (isOpen(4, 0)) wasOpen = true;
  }
  v.x = 8.5; v.vbWander.idx = path.length; D.tick(v, 0); D.closeBehind(o.noClose ? { vbDoorsToClose: [] } : v, null, null);
  const r = { wasOpen, finalOpen: isOpen(4, 0) };
  EL.clear();
  return r;
}
const a = run('oak_door');
ok(a.wasOpen, 'oak door opened as the villager approached'); ok(!a.finalOpen, 'oak door closed again after passing');
const b = run('iron_door');
ok(!b.wasOpen && !b.finalOpen, 'iron door never opened');
const c = run('oak_door', { playerOpen: true });
ok(c.finalOpen, 'a door the player held open is not closed');
const bad = run('oak_door', { noClose: true });
okAv(bad.finalOpen, 'close step disabled -> door stays open (the closed-behind assert would fail)');
console.log(`\n${pass} ok, ${breaks} breaks caught, ${fails.length} failed`);
if (fails.length) { console.log('FAIL', fails); process.exit(1); }
console.log(`PASS vbdoorcheck (${pass} checks)`);
