#!/usr/bin/env node
// advtrig-construct_beaconcheck.mjs — G17-AT38 (#8041). Drives the REAL call site (BlockEntities.tickBeacon activation ->
// Adv.trigger 'minecraft:construct_beacon') against ConstructBeaconCriterion (nether/create_beacon, create_full_beacon); breaks its own matcher and call site.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '02l_advancements.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js',
  '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
  '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js', '07zu_poi.js', '07zzm_wither.js'];
const fails = []; let asserted = 0;
const ok = (c, m) => { asserted++; if (!c) fails.push(m); };

function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs;
  MCL.World.init(1); MCL.Behave.init(MCL.World);
  if (MCL.BlockEntities && MCL.BlockEntities.init) MCL.BlockEntities.init();
  for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) {
    const c = MCL.World.makeChunk(cx, cz); c.state = MCL.CH.GENERATED; MCL.World.chunks.set(MCL.World.key(cx, cz), c);
  }
  const Adv = MCL.Adv, BE = MCL.BlockEntities;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const done = [];
  const P = MCL.Player = { x: 0.5, y: 70, z: 0.5, type: 'player' };
  P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  const has = (id) => done.includes('minecraft:nether/' + id);
  const R = MCL.Reg, def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
  const pyramid = (n) => {
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) for (let y = 60; y < 72; y++) MCL.World.setBlock(x, y, z, 0);
    for (let k = 1; k <= n; k++) for (let x = -k; x <= k; x++) for (let z = -k; z <= k; z++) MCL.World.setBlock(x, 70 - k, z, def('iron_block'));
    MCL.World.setBlock(0, 70, 0, def('beacon'));
    return BE.create(0, 70, 0, 'beacon');
  };
  const light = (n, px) => {
    done.length = 0;
    for (const k of ['create_beacon', 'create_full_beacon']) { const a = Adv.manager.get('minecraft:nether/' + k); const pr = P.advancements.getProgress(a); pr.done = false; pr.criteria.forEach((c) => { c.date = null; }); }
    P.x = px; P.y = 70; P.z = 0.5;
    const e = pyramid(n);
    for (let t = 0; t < 400; t++) { MCL.Behave.gameTime = t; BE.tickBeacon(e); }
    return e;
  };
  let e = light(1, 0.5);
  no(e.levels === 1, 'level-1 pyramid reached level ' + e.levels);
  no(has('create_beacon'), 'level-1 beacon did not complete nether/create_beacon');
  no(!has('create_full_beacon'), 'level-1 beacon completed create_full_beacon');
  e = light(4, 0.5);
  no(e.levels === 4, 'level-4 pyramid reached level ' + e.levels);
  no(has('create_full_beacon'), 'level-4 beacon did not complete nether/create_full_beacon');
  light(1, 40.5);
  no(!has('create_beacon'), 'player 40 blocks away completed create_beacon');
  // matcher alone
  const direct = (lv) => { Adv.trigger(P, 'minecraft:construct_beacon', { level: lv }); return has('create_full_beacon'); };
  no(!direct(3), 'level 3 completed create_full_beacon');
  no(direct(4), 'matcher rejected level 4');
  return f;
}
const base = run();
base.forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('07c_blockentity.js', "'minecraft:construct_beacon', {", "'minecraft:construct_beacon_x', {")],
  ['range ignored', brk('02l_advancements.js', 'return P.range(c.level, ctx.level);', 'return true;')],
  ['effect box ignored', brk('07c_blockentity.js', 'cp.x - 0.3 <= x + 10 &&', 'true &&')],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:construct_beacon'] = function", "Adv.matchers['minecraft:x'] = function")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-construct_beaconcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-construct_beaconcheck: OK — ${caught} breaks caught`);
