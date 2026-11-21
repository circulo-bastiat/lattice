#!/usr/bin/env node
// advtrig-enter_blockcheck.mjs — G17-AT6 (#7746). Drives the REAL call site (Cb.hurt's killing blow ->
// Adv.trigger 'minecraft:enter_block') against OnKilledCriterion; breaks its own matcher and call site.
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
  '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js', '07zu_poi.js', '07zzm_wither.js', '07zzc_lightning.js'];
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
  MCL.EntityList.init(); MCL.Ai.init(); if (MCL.Spawn && MCL.Spawn.init) MCL.Spawn.init();
  MCL.Breed.init(); MCL.Combat.init && MCL.Combat.init();
  for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) {
    const c = MCL.World.makeChunk(cx, cz); c.state = MCL.CH.GENERATED; MCL.World.chunks.set(MCL.World.key(cx, cz), c);
  }
  MCL.Use.init(MCL.World);
  const Adv = MCL.Adv;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const done = [];
  const P = MCL.Player = { x: 0.5, y: 70, z: 0.5, type: 'player' };
  P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  const has = (id) => done.includes('minecraft:' + id);
  const R = MCL.Reg, S = MCL.States;
  const at = (nm) => S.stateOf(nm);
  const put = (nm, x, y, z) => MCL.World.setBlock(x, y, z, at(nm));
  const stand = (x, y, z) => { P.x = x + 0.5; P.y = y; P.z = z + 0.5; P.width = 0.6; P.height = 1.8; MCL.Use.entityCollide(P); };
  no(!has('end/enter_end_gateway') && !has('recipes/transportation/oak_boat'), 'done before entering');
  put('stone', 5, 70, 5); stand(5, 70, 5);
  no(!has('recipes/transportation/oak_boat'), 'stone completed in_water');
  put('water', 9, 70, 9); stand(9, 70, 9);
  no(has('recipes/transportation/oak_boat'), 'entering water did not complete oak_boat in_water');
  return f;
}
const base = run();
base.forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('14l_use.js', "'minecraft:enter_block', {", "'minecraft:enter_block_x', {")],
  ['block ignored', brk('02l_advancements.js', "if (has(cond.block) && stripNs(cond.block) !== stripNs(ctx.block)) return false;", "")],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:enter_block'] = function", "Adv.matchers['minecraft:x'] = function")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-enter_blockcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-enter_blockcheck: OK — ${caught} breaks caught`);
