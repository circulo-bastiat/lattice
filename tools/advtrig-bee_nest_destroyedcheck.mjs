#!/usr/bin/env node
// advtrig-bee_nest_destroyedcheck.mjs — G17-AT20 (#7982). Drives the REAL call site (P.breakBlock -> BeehiveBlock.afterBreak ->
// Adv.trigger 'minecraft:bee_nest_destroyed') against LightningStrikeCriterion; breaks its own matcher and call site.
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
  '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js', '07zu_poi.js', '07zzm_wither.js', '07zzc_lightning.js', '07zo_bee.js', '14_player.js'];
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
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = MCL.World.makeChunk(cx, cz); c.state = MCL.CH.GENERATED; MCL.World.chunks.set(MCL.World.key(cx, cz), c);
  }
  const Adv = MCL.Adv, W = MCL.World, S = MCL.States, BE = MCL.BlockEntities, Iv = MCL.Inventory;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const users = Object.keys(Adv.data).filter((k) => JSON.stringify(Adv.data[k]).includes('bee_nest_destroyed'));
  const done = [];
  const P = MCL.Player;
  P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  P.inventory = Iv.create(); P.slot = 0; P.instabuild = false; P.mayBuild = true; P.x = 0.5; P.y = 64; P.z = 0.5;
  const brk = (block, nbees, held) => {
    const x = 3, y = 64, z = 3;
    W.setBlock(x, y, z, S.stateOf(block));
    const be = BE.create(x, y, z, 'beehive');
    for (let i = 0; i < nbees; i++) be.bees.push({ id: null, hasNectar: false, ticksLeft: 600 });
    Iv.setItem(P.inventory, 0, held);
    P.hasTarget = true; P.tx = x; P.ty = y; P.tz = z;
    done.length = 0;
    P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });   // fresh: a granted advancement never re-fires
    P.breakBlock();
  };
  no(users.length > 0, 'no packed advancement uses bee_nest_destroyed');
  const SILK = 'minecraft:husbandry/silk_touch_nest';
  const pick = (ench) => { const st = Iv.stack('diamond_pickaxe', 1, 0); if (ench) st.t = { Enchantments: [{ id: 'minecraft:silk_touch', lvl: 1 }] }; return st; };
  no(users.includes(SILK), 'silk_touch_nest does not use the trigger');
  brk('bee_nest', 3, pick(true));
  no(done.includes(SILK), 'silk-touch nest with 3 bees did not complete silk_touch_nest');
  brk('bee_nest', 3, pick(false));
  no(!done.includes(SILK), 'nest without silk touch completed it');
  brk('bee_nest', 2, pick(true));
  no(!done.includes(SILK), 'nest with 2 bees completed it');
  brk('beehive', 3, pick(true));
  no(!done.includes(SILK), 'beehive (wrong block) completed it');
  // the item condition alone: the real path empties the nest without silk touch, so ask the matcher with 3 bees
  const cond = Adv.data[SILK].c.silk_touch_nest[1], m = Adv.matchers['minecraft:bee_nest_destroyed'];
  const mk = (st) => ({ player: P, block: 'minecraft:bee_nest', stack: st, bees: 3 });
  no(m(cond, mk({ id: 'minecraft:diamond_pickaxe', count: 1, enchants: { 'minecraft:silk_touch': 1 } })), 'matcher: silk stack refused');
  no(!m(cond, mk({ id: 'minecraft:diamond_pickaxe', count: 1, enchants: {} })), 'matcher: plain pickaxe accepted');
  return f;
}
const base = run();
base.forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('14_player.js', "NS.Adv.trigger(P, 'minecraft:bee_nest_destroyed'", "NS.Adv.trigger(P, 'minecraft:bee_nest_destroyed_x'")],
  ['bee count ignored', brk('02l_advancements.js', "&& P.range(c.num_bees_inside, ctx.bees | 0)", "")],
  ['block ignored', brk('02l_advancements.js', "if (has(c.block) && stripNs(c.block) !== stripNs(ctx.block)) return false;", "")],
  ['item ignored', brk('02l_advancements.js', "return P.item(c.item, lc, ctx.stack) && P.range(c.num_bees", "return P.range(c.num_bees")],
  ['never matches', brk('02l_advancements.js', "return P.item(c.item, lc, ctx.stack) && P.range(c.num_bees", "return false && P.item(c.item, lc, ctx.stack) && P.range(c.num_bees")],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:bee_nest_destroyed'] = function", "Adv.matchers['minecraft:x'] = function")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-bee_nest_destroyedcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-bee_nest_destroyedcheck: OK — ${caught} breaks caught`);
