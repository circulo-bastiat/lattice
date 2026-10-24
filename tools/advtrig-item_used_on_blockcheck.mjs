#!/usr/bin/env node
// advtrig-item_used_on_blockcheck.mjs — G17-AT31 (#7997). minecraft:item_used_on_block through the REAL call site
// (Use.rightClick -> Adv.trigger) against ItemUsedOnBlockCriterion. Packed users: play_jukebox_in_meadows,
// make_a_sign_glow, safely_harvest_honey, wax_off, wax_on, charge_respawn_anchor, use_lodestone.
// Breaks its own matcher and call site (anti-vacuity, D-30).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '02l_advancements.js', '14f_inventory.js', '07b_behaviour.js',
  '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
  '14b_physics.js', '14c_raycast.js', '14e_gamemode.js', '14i_hand.js', '14l_use.js', '07zze_oxidize.js', '07zx_particle.js'];
const fails = []; let asserted = 0;

function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  const S = MCL.States, B = MCL.Behave, U = MCL.Use, IT = MCL.Items;
  const cells = new Map();
  const W = MCL.World = { getBlock: (x, y, z) => cells.get(x + ',' + y + ',' + z) || 0,
    setBlock(x, y, z, id) { cells.set(x + ',' + y + ',' + z, id); if (B.ready) B.changed(x, y, z); return true; }, blockLightAt: () => 15 };
  B.init(W); MCL.BlockEntities.init(); B.clearSchedule();
  if (MCL.Redstone && MCL.Redstone.init) MCL.Redstone.init();
  MCL.Entities.init(); MCL.EntityList.init(); U.init(W);
  MCL.Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const done = [];
  const click = (block, held) => {
    done.length = 0; cells.clear(); cells.set('0,0,0', S.stateOf(block));
    const P = { mode: 1, instabuild: false, invulnerableGamemode: false, mayBuild: true, slot: 0, inventory: null, yaw: 0,
      hasTarget: true, tx: 0, ty: 0, tz: 0, tface: 2, x: 0.5, y: 1, z: 0.5, ex: 0.5, ey: 1, ez: 0.5, eyeHeight: 0.5,
      lookVec() { return [0, -1, 0]; }, syncHotbar() {}, placeBlock() { return false; },
      _stack: { i: IT.of(held), n: 2, d: 0 }, heldItem() { return this._stack; } };
    P.advancements = new MCL.Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
    U.rightClick(P);
  };
  const has = (id) => done.includes('minecraft:' + id);
  click('copper_block', 'stick');
  no(!has('husbandry/wax_on'), 'wax_on granted for a stick on copper');
  click('stone', 'honeycomb');
  no(!has('husbandry/wax_on'), 'wax_on granted for honeycomb on stone');
  click('copper_block', 'honeycomb');
  no(has('husbandry/wax_on'), 'wax_on not granted for honeycomb on copper_block');
  click('oxidized_copper', 'iron_axe');
  no(!has('husbandry/wax_on'), 'wax_on granted for an axe (item predicate)');
  no(!has('husbandry/wax_off'), 'wax_off granted for an axe on unwaxed copper (location predicate)');
  click('waxed_copper_block', 'iron_axe');
  no(has('husbandry/wax_off'), 'wax_off not granted for an axe on waxed copper');
  return f;
}
run().forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('14l_use.js', "'minecraft:item_used_on_block', {", "'minecraft:item_used_on_block_x', {")],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:item_used_on_block'] = function", "Adv.matchers['minecraft:x'] = function")],
  ['item ignored', brk('02l_advancements.js', "&& P.item(c.item, lc, ctx.stack);", ";")],
  ['location ignored', brk('02l_advancements.js', "return P.location(c.location, lc, ctx.x + 0.5, ctx.y + 0.5, ctx.z + 0.5) &&", "return")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-item_used_on_blockcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-item_used_on_blockcheck: OK — ${caught} breaks caught`);
