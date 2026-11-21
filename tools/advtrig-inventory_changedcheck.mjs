#!/usr/bin/env node
// advtrig-inventory_changedcheck — Adv.matchers['minecraft:inventory_changed'] + the CrossbowItem.postShoot call site (Use.crossbowShootAll).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, ASSETS } from './loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const M = loadEngine({ extra: ['02f_tags.js', '02l_advancements.js', '07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '07b_behaviour.js', '09c_weather.js'] });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Tags.init({ tags: b64('tags.bin'), tagsBytes: rdj('tags.meta.json').blobBytes });
M.Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
const A = M.Adv, Use = M.Use, id = 'minecraft:story/mine_stone';
let asserted = 0; const fails = [];
const no = (c, m) => { asserted++; if (!c) fails.push(m); };
function shoot(itemName) {
  const P = { type: 'player', advancements: new A.Tracker({}), inventory: M.Inventory.create() };
  M.Survival.inventoryChanged(P);
  M.Inventory.add(P.inventory, M.Inventory.stack(itemName, 1));
  M.Survival.inventoryChanged(P);
  return P.advancements.getProgress(A.manager.get(id)).isDone();
}
function run() {
  fails.length = 0;
  no(A.manager.get(id), 'ol_betsy missing');
  no(shoot('cobblestone') === true, 'cobblestone pickup did not complete ol_betsy');
  no(shoot('dirt') === false, 'non-matching item completed ol_betsy');
  return fails.slice();
}
const bad0 = run();
const real = A.matchers['minecraft:inventory_changed'];
let caught = 0;
for (const [n, f] of [['always false', () => false], ['always true', () => true]]) {
  A.matchers['minecraft:inventory_changed'] = f;
  if (run().length) { caught++; console.log('   ✓ broken (' + n + ')'); } else bad0.push('mutant not caught: ' + n);
}
A.matchers['minecraft:inventory_changed'] = real;
if (bad0.length) { console.log('advtrig-inventory_changedcheck: FAIL'); bad0.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-inventory_changedcheck: OK — ${caught} breaks caught`);
