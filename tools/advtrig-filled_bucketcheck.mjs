#!/usr/bin/env node
// advtrig-filled_bucketcheck — Adv.matchers['minecraft:filled_bucket'] + the Bucketable.tryBucket / BucketItem call site (Use.filledBucketTrigger).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, ASSETS } from './loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const M = loadEngine({ extra: ['02l_advancements.js', '07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '07b_behaviour.js', '09c_weather.js'] });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
const A = M.Adv, Use = M.Use;
const ids = ['minecraft:husbandry/tactical_fishing', 'minecraft:husbandry/axolotl_in_a_bucket'];
let asserted = 0; const fails = [];
const no = (c, m) => { asserted++; if (!c) fails.push(m); };
function fill(item) {
  const P = { advancements: new A.Tracker({}) };
  Use.filledBucketTrigger(P, item);
  return ids.map((i) => P.advancements.getProgress(A.manager.get(i)).isDone());
}
function run() {
  fails.length = 0;
  ids.forEach((i) => no(A.manager.get(i), i + ' missing'));
  const ax = fill('axolotl_bucket'), pu = fill('pufferfish_bucket'), wa = fill('water_bucket');
  no(ax[1] === true && ax[0] === false, 'axolotl_bucket should complete only axolotl_in_a_bucket');
  no(pu[0] === true && pu[1] === false, 'pufferfish_bucket should complete only tactical_fishing');
  no(!wa[0] && !wa[1], 'water_bucket completed a fish/axolotl advancement');
  return fails.slice();
}
const bad0 = run();
const real = A.matchers['minecraft:filled_bucket'];
let caught = 0;
for (const [n, f] of [['always false', () => false], ['always true', () => true]]) {
  A.matchers['minecraft:filled_bucket'] = f;
  if (run().length) { caught++; console.log('   ✓ broken (' + n + ')'); } else bad0.push('mutant not caught: ' + n);
}
A.matchers['minecraft:filled_bucket'] = real;
if (bad0.length) { console.log('advtrig-filled_bucketcheck: FAIL'); bad0.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-filled_bucketcheck: OK — ${caught} breaks caught`);
