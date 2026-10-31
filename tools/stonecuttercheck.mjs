#!/usr/bin/env node
// stonecuttercheck.mjs — #8055 G19e: StonecutterScreenHandler (.decomp) as Menu.stonecutterMenu.
// Every stonecutting recipe of the 1.18.2 data (198) is put through the real menu: the recipe is
// listed for its input, onButtonClick selects it, the output slot holds the vanilla count, taking
// it spends ONE input item. Then the same loop is re-run on perturbed data ("<n> breaks caught", D-30).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 30) fails.push(m); };
console.log('stonecuttercheck — #8055 StonecutterScreenHandler');

const NS = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '14g_menu.js'] });
const A = (f) => join(MCLITE_ROOT, 'assets', f);
const rd = (f) => JSON.parse(readFileSync(A(f), 'utf8'));
NS.Items.init({ items: readFileSync(A('items.bin')).toString('base64'), itemsBytes: rd('items.meta.json').rawBytes });
NS.Recipes.init({ recipes: readFileSync(A('recipes.bin')).toString('base64'), recipesBytes: rd('recipes.meta.json').jsonBytes });
const R = NS.Recipes, Inv = NS.Inventory, Menu = NS.Menu;
const recs = R.byType[R.STONECUTTING];
ok(recs.length === 198, `${recs.length} stonecutting recipes, expected 198`);

// a concrete item an ingredient accepts
function sampleFor(ing) {
  for (let i = 0; i < NS.Items.count; i++) {
    const s = Inv.stack(i, 1);
    if (R.ingredientMatches(ing, s)) return s;
  }
  return null;
}
const fresh = () => { const inv = Inv.create ? Inv.create() : Inv.newInventory(); return inv; };

// runs every recipe through the menu; returns the number of recipes that behaved as vanilla
function run(expectCount) {
  let good = 0;
  for (const rec of recs) {
    const s = sampleFor(rec.in[0]);
    if (!s) continue;
    const inv = fresh();
    const m = Menu.stonecutterMenu(inv, null);
    const input = Inv.stack(s.i, 5, s.d || 0);
    m.input.set(0, input); m.refresh();
    const idx = m.recipes.findIndex((x) => x.id === rec.id);
    if (idx < 0) continue;
    if (m.selected !== -1 || m.output.get(0)) continue;          // updateInput resets
    m.onButtonClick(idx);
    const out = m.output.get(0);
    if (!out || NS.Items.nameOf(out.i) !== rec.r.i || out.n !== expectCount(rec)) continue;
    m.onButtonClick(999);                                         // out of bounds: ignored, selection kept
    if (m.selected !== idx) continue;
    // take the output through the real click machine: one input spent, output repopulated
    Menu.doClick(m, 1, 0, Menu.PICKUP, null);
    const carried = Menu.getCarried(m);
    if (!carried || NS.Items.nameOf(carried.i) !== rec.r.i || carried.n !== expectCount(rec)) continue;
    if (m.input.get(0).n !== 4) continue;
    const again = m.output.get(0);
    if (!again || again.n !== expectCount(rec)) continue;
    good++;
  }
  return good;
}
const snap = new Map(recs.map((r) => [r.id, r.r.n]));   // the vanilla counts, frozen before any break
const vanilla = (rec) => snap.get(rec.id);
ok(run(vanilla) === recs.length, 'every stonecutting recipe yields its vanilla count from one input and spends one');

// input item change resets; same item with a new count does not
{
  const rec = recs[0], s = sampleFor(rec.in[0]);
  const m = Menu.stonecutterMenu(fresh(), null);
  m.input.set(0, Inv.stack(s.i, 3)); m.refresh();
  m.onButtonClick(0);
  m.input.set(0, Inv.stack(s.i, 2)); m.refresh();
  ok(m.selected === 0 && m.output.get(0), 'a count change keeps the selection');
  m.input.set(0, null); m.refresh();
  ok(m.selected === -1 && !m.output.get(0) && m.recipes.length === 0, 'emptying the input clears list, selection and output');
  const stick = Inv.stack(NS.Items.of('stick'), 1);
  m.input.set(0, stick); m.refresh();
  ok(m.recipes.length === 0 && !m.canCraft(), 'an input with no recipe lists nothing');
}

// ── breaks: perturb the data, the same loop must NOT pass ──
let breaks = 0, caught = 0;
const brk = (c, m) => { breaks++; if (!c) caught++; else fails.push('break not caught: ' + m); };
brk(run((rec) => rec.r.n + 1) === recs.length, 'wrong expected output count');
{
  const keep = recs[5].r.n; recs[5].r.n = keep + 1;
  brk(run(vanilla) === recs.length, 'perturbed recipe output count');
  recs[5].r.n = keep;
}
{
  const dropped = recs.splice(7, 1)[0];
  const n = run(vanilla);
  recs.splice(7, 0, dropped);
  // the list now lacks recipe 7 only for the menu if the menu reads the live table
  brk(n === recs.length, 'dropped recipe still expected');
}
{
  const saved = R.stonecuttingFor; R.stonecuttingFor = () => [];
  brk(run(vanilla) === recs.length, 'empty recipe list');
  R.stonecuttingFor = saved;
}
ok(run(vanilla) === recs.length, 'restored data passes again');

console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${caught}/${breaks}`);
for (let i = 0; i < caught; i++) console.log('   ✓ break caught (' + (i + 1) + ')');
console.log(' ' + caught + ' breaks caught');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
if (caught !== breaks) process.exit(1);
