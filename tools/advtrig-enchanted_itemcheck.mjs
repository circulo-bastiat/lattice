#!/usr/bin/env node
// advtrig-enchanted_itemcheck.mjs — G17-AT35. minecraft:enchanted_item: Adv.matchers + the Menu.enchantClick call site
// (EnchantmentScreenHandler.onButtonClick -> Criteria.ENCHANTED_ITEM.trigger(player, stack, levels)). Advancement: story/enchant_item.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

function run(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02l_advancements.js', '14f_inventory.js', '14d_survival.js',
    '07ox_enchhelper.js', '07oy_enchtable.js', '14g_menu.js'], patch, dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const f = [], no = (c, m) => { if (!c) f.push(m); };
  const A = M.Adv, I = M.Inventory;
  const done = (p, id) => p.advancements.getProgress(A.manager.get(id)).isDone();
  const player = () => ({ x: 0, y: 8, z: 0, xpLevel: 30, instabuild: false, advancements: new A.Tracker({}) });
  const click = (p, btn) => {
    const m = M.Menu.enchantMenu({ x: 0, y: 0, z: 0 }, I.create(), p);
    m.table.set(0, I.stack('diamond_sword', 1)); m.table.set(1, I.stack('lapis_lazuli', 3));
    m.offers.power = [10, 20, 30];
    return M.Menu.enchantClick(m, p, btn);
  };
  const p = player();
  no(!done(p, 'minecraft:story/enchant_item'), 'done before enchanting');
  no(click(p, 0) === true, 'enchant did not happen');
  no(done(p, 'minecraft:story/enchant_item'), 'story/enchant_item not completed');
  const mt = A.matchers['minecraft:enchanted_item'];
  const ctx = { levels: 2, item: { id: 'minecraft:diamond_sword', count: 1 } };
  no(mt && mt({}, ctx) === true, 'empty conditions should match');
  no(mt && mt({ levels: { min: 3 } }, ctx) === false, 'levels below min matched');
  no(mt && mt({ item: { items: ['minecraft:stick'] } }, ctx) === false, 'wrong item matched');
  const q = player(); q.xpLevel = 0;
  no(click(q, 0) === false && !done(q, 'minecraft:story/enchant_item'), 'failed enchant granted advancement');
  return f;
}

const fails = run();
const breaks = [
  ['matcher removed', (f, s) => f === '02l_advancements.js' ? s.replace("Adv.matchers['minecraft:enchanted_item'] = function", "var unused = function") : s],
  ['levels ignored', (f, s) => f === '02l_advancements.js' ? s.replace("P.range(c.levels, ctx.levels)", "true") : s],
  ['call site removed', (f, s) => f === '14g_menu.js' ? s.replace("NS.Adv.trigger(player, 'minecraft:enchanted_item'", "(function(){})(player, 'x'") : s],
];
let caught = 0;
for (const [name, patch] of breaks) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('  ✓ break caught: ' + name); } else fails.push('break NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-enchanted_itemcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log('assertions passed ..... 8');
console.log(`${caught} breaks caught (advtrig-enchanted_itemcheck OK)`);
