#!/usr/bin/env node
// advtrig-item_durability_changedcheck.mjs — G17-AT43 (#8059). minecraft:item_durability_changed: Adv.matchers + the
// Use.damage call site (ItemStack.damage(int, Random, ServerPlayerEntity)). Advancement: nether/ride_strider
// (warped_fungus_on_a_stick while riding a strider). Breaks its own matcher and call site.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '02l_advancements.js', '14f_inventory.js', '14l_use.js'];

function run(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, patch });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const f = [], no = (c, m) => { if (!c) f.push(m); };
  const A_ = M.Adv, ID = 'minecraft:nether/ride_strider';
  const done = (p) => p.advancements.getProgress(A_.manager.get(ID)).isDone();
  const mk = (veh, item) => {
    const inv = M.Inventory.create(), p = { x: 0, y: 8, z: 0, instabuild: false, inventory: inv, slot: 0, vehicle: veh, advancements: new A_.Tracker({}) };
    const st = M.Inventory.stack(item, 1); M.Inventory.setItem(inv, 0, st);
    return [p, st];
  };
  let [p, st] = mk({ type: 'strider' }, 'warped_fungus_on_a_stick');
  no(!done(p), 'done before use');
  no(M.Use.damage(p, st, 1) === true, 'damage returned false');
  no(st.d === 1, 'durability not spent');
  no(done(p), 'nether/ride_strider not completed');
  [p, st] = mk({ type: 'horse' }, 'warped_fungus_on_a_stick'); M.Use.damage(p, st, 1);
  no(!done(p), 'non-strider vehicle completed it');
  [p, st] = mk(null, 'warped_fungus_on_a_stick'); M.Use.damage(p, st, 1);
  no(!done(p), 'no vehicle completed it');
  [p, st] = mk({ type: 'strider' }, 'diamond_pickaxe'); M.Use.damage(p, st, 1);
  no(!done(p), 'wrong item completed it');
  const mt = A_.matchers['minecraft:item_durability_changed'];
  const ctx = { item: { id: 'minecraft:diamond_pickaxe', count: 1, damage: 10, maxDamage: 1561 }, newDamage: 11 };
  no(mt && mt({}, ctx) === true, 'empty conditions should match');
  no(mt && mt({ durability: { min: 1600 } }, ctx) === false, 'durability below min matched');
  no(mt && mt({ durability: { min: 1550, max: 1550 } }, ctx) === true, 'durability 1550 not matched');
  no(mt && mt({ delta: { max: -2 } }, ctx) === false, 'delta -1 matched max -2');
  no(mt && mt({ delta: { min: -1, max: -1 } }, ctx) === true, 'delta -1 not matched');
  return f;
}

const fails = run();
const breaks = [
  ['matcher removed', (f, s) => f === '02l_advancements.js' ? s.replace("Adv.matchers['minecraft:item_durability_changed'] = function", "var unused = function") : s],
  ['item ignored', (f, s) => f === '02l_advancements.js' ? s.replace("P.item(c.item, ctx, st) &&", "") : s],
  ['delta ignored', (f, s) => f === '02l_advancements.js' ? s.replace("P.range(c.delta,", "P.range(undefined,") : s],
  ['call site removed', (f, s) => f === '14l_use.js' ? s.replace("NS.Adv.trigger(P, 'minecraft:item_durability_changed'", "(function(){})(P, 'x'") : s],
];
let caught = 0;
for (const [name, patch] of breaks) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('  ✓ break caught: ' + name); } else fails.push('break NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-item_durability_changedcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log('assertions passed ..... 12');
console.log(`${caught} breaks caught (advtrig-item_durability_changedcheck OK)`);
