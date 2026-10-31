#!/usr/bin/env node
// smithingcheck.mjs — #8060 G19e: SmithingScreenHandler (.decomp) as Menu.smithingMenu. Every smithing
// recipe is run through the menu: result item right, NBT + damage carried over, ONE of each input consumed,
// shift-click routing. Breaks its own behaviour ("<n> breaks caught", D-30).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0, caught = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const brk = (c, m) => { breaks++; if (!c) caught++; else fails.push('break not caught: ' + m); };
console.log('smithingcheck — #8060 smithing table menu');

const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '14g_menu.js'], dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
const R = M.Recipes, Iv = M.Inventory, Mn = M.Menu;
const list = R.byType[R.SMITHING];
ok(list.length === 9, 'vanilla 1.18.2 has 9 smithing recipes, got ' + list.length);

const ench = [{ id: 'minecraft:sharpness', lvl: 4 }, { id: 'minecraft:unbreaking', lvl: 3 }];
// a concrete item that satisfies an ingredient
function pick(ing) {
  for (let i = 1; i < 2000; i++) { const s = { i, n: 1, d: 0 }; try { if (R.ingredientMatches(ing, s)) return i; } catch (e) { break; } }
  return 0;
}
function run(label, mutate) {
  let n = 0;
  for (const rec of list) {
    const bi = pick(rec.in[0]), ai = pick(rec.in[1]);
    if (!bi || !ai) { fails.push(label + ': no item for ' + rec.id); continue; }
    const p = { inventory: Iv.create() };
    const mm = Mn.smithingMenu(p.inventory, { onCraft: () => { n++; } });
    Mn.slotSet(mm.slots[0], { i: bi, n: 2, d: 7, t: { Enchantments: ench, RepairCost: 3 } });
    Mn.slotSet(mm.slots[1], { i: ai, n: 2, d: 0 });
    const out = mm.slots[2].container.get(0);
    if (mutate) mutate(out);
    const good = out && out.i === M.Items.of(rec.r.i) && out.d === 7 && out.t && out.t.Enchantments && out.t.Enchantments.length === 2 && out.t.RepairCost === 3;
    if (label === 'real') {
      ok(good, rec.id + ': result keeps enchants/damage');
      Mn.doClick(mm, 2, 0, Mn.PICKUP, p);
      const c = Mn.getCarried(mm);
      ok(c && c.i === M.Items.of(rec.r.i) && c.t && c.t.Enchantments.length === 2, rec.id + ': taken stack keeps NBT');
      ok(mm.input.get(0).n === 1 && mm.input.get(1).n === 1, rec.id + ': one of each input consumed');
      ok(Mn.slotHas(mm.slots[2]), rec.id + ': second craft available');
    } else brk(good, label + ' / ' + rec.id);
  }
  return n;
}
ok(run('real') === list.length, 'onCraft fired once per recipe');
run('enchantments dropped', (o) => { if (o && o.t) delete o.t.Enchantments; });
run('damage reset', (o) => { if (o) o.d = 0; });
// wrong pairs make no result; quick-move routes an addition into slot 1 and a base into slot 0
{
  const p = { inventory: Iv.create() };
  const q = Mn.smithingMenu(p.inventory, {});
  Mn.slotSet(q.slots[0], { i: pick(list[0].in[0]), n: 1, d: 0 });
  ok(!Mn.slotHas(q.slots[2]), 'base alone: no result');
  Iv.setItem(p.inventory, 0, { i: pick(list[0].in[1]), n: 3, d: 0 });
  const qm = Mn.smithingMenu(p.inventory, {});
  const idx = qm.slots.findIndex((s) => s.container === qm.slots[3].container && s.index === 0);
  Mn.doClick(qm, idx, 0, Mn.QUICK_MOVE, p);
  ok(qm.input.get(1) && qm.input.get(1).n === 3 && !qm.input.get(0), 'shift-click sends an addition to slot 1');
}

console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${caught}/${breaks}`);
for (let i = 0; i < caught; i++) console.log('   ✓ break caught (' + (i + 1) + ')');
console.log(' ' + caught + ' breaks caught');
if (fails.length || caught !== breaks) { fails.forEach((f) => console.log('   x ' + f)); process.exit(1); }
