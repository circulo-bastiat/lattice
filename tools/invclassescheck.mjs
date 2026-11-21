#!/usr/bin/env node
// invclassescheck.mjs - #11736: net.minecraft.inventory.{ContainerLock,CraftingInventory,CraftingResultInventory,DoubleInventory,
// InventoryChangedListener,SidedInventory} (src/14g2_invclasses.js). Behaviour vs .decomp, entry points wired in shipped sources, mutants.
import { readFileSync } from 'node:fs';
const src = (f) => readFileSync(`src/${f}`, 'utf8');
const dec = (c) => readFileSync(`.decomp/net/minecraft/inventory/${c}.java`, 'utf8');
let fails = [], breaks = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function load(mut) {
  const T0 = src('14g2_invclasses.js'); const code = mut ? mut(T0) : T0;
  if (mut && code === T0) throw new Error('mutant did not change source');
  const items = (i, n = 1) => ({ i, n });
  const NS = { Inventory: { isEmpty: (s) => !s || !(s.n > 0), split: (s, n) => { const k = Math.min(n, s.n); s.n -= k; return { i: s.i, n: k }; } },
    Menu: { container: (get, set, removeAt, size) => ({ get, set, removeAt, size }) } };
  new Function('MCL', code)(NS);
  return { C: NS.InvClasses, items };
}
function checks({ C, items }) {
  const o = [];
  const L = new C.ContainerLock('key');
  o.push(['empty lock opens for none', C.ContainerLock.EMPTY.canOpen(null)]);
  o.push(['lock refuses empty hand', !L.canOpen(null)]);
  o.push(['lock refuses unnamed', !L.canOpen(items('stick'))]);
  o.push(['lock refuses wrong name', !L.canOpen({ i: 'stick', n: 1, nbt: { name: 'other' } })]);
  o.push(['lock accepts the key name', L.canOpen({ i: 'stick', n: 1, nbt: { name: 'key' } })]);
  const t = {}; L.writeNbt(t); const t2 = {}; C.ContainerLock.EMPTY.writeNbt(t2);
  o.push(['nbt round trip', t.Lock === 'key' && C.ContainerLock.fromNbt(t).key === 'key' && Object.keys(t2).length === 0 && C.ContainerLock.fromNbt({}) === C.ContainerLock.EMPTY]);
  const ha = [null, null, null], hb = [null, null];
  const D = new C.DoubleInventory(C.bank(ha, 3), C.bank(hb, 2));
  o.push(['double size is the sum', D.size() === 5]);
  D.setStack(1, items('a', 5)); D.setStack(3, items('b', 4));
  o.push(['indexes split at first.size()', ha[1].i === 'a' && hb[1] === null && hb[0].i === 'b' && D.getStack(3).i === 'b']);
  o.push(['removeStack on second half', D.removeStack(3, 3).n === 3 && hb[0].n === 1]);
  o.push(['isPart', D.isPart(D.first) && !D.isPart({})]);
  o.push(['isEmpty false then clear', !D.isEmpty() && (D.clear(), D.isEmpty())]);
  let changed = 0; const h = { onContentChanged: () => { changed++; } };
  const G = new C.CraftingInventory(h, 3, 3);
  o.push(['grid size w*h', G.size() === 9 && G.getWidth() === 3 && G.getHeight() === 3]);
  G.setStack(4, items('x', 8)); o.push(['setStack notifies', changed === 1]);
  G.removeStack(4, 3); o.push(['non-empty split notifies', changed === 2 && G.getStack(4).n === 5]);
  G.removeStack(0, 3); o.push(['empty split does not notify', changed === 2]);
  o.push(['getStack past end is empty', G.getStack(99) === null]);
  const R = new C.CraftingResultInventory();
  R.setStack(7, items('r', 2));
  o.push(['result has one slot, any index', R.size() === 1 && R.getStack(5).i === 'r']);
  o.push(['result removeStack takes it all', R.removeStack(0, 1).n === 2 && R.isEmpty()]);
  R.setLastRecipe('rec'); o.push(['lastRecipe kept', R.getLastRecipe() === 'rec']);
  const l = C.listeners(); let seen = 0; const f = () => { seen++; }; l.add(f); l.fire(1); l.remove(f); l.fire(1);
  o.push(['listener fires once then removed', seen === 1]);
  const S = C.sided({}, () => [0, 1], (s) => s === 0); o.push(['sided methods', S.getAvailableSlots(0).length === 2 && S.canInsert(0) && !S.canInsert(1) && S.canExtract(0)]);
  return o;
}
const base = checks(load());
for (const [m, v] of base) ok(v, m);
// the decomp facts the code mirrors
ok(/first\.size\(\)\s*\+\s*this\.second\.size\(\)/.test(dec('DoubleInventory')), 'decomp DoubleInventory.size');
ok(/this\.key\.isEmpty\(\) \|\| !\$\$0\.isEmpty\(\) && \$\$0\.hasCustomName\(\)/.test(dec('ContainerLock')), 'decomp canOpen');
ok(/return 1;/.test(dec('CraftingResultInventory')), 'decomp result size 1');
// entry points: the shipped sources use the classes
const wired = [['14g_menu.js', 'InvClasses.DoubleInventory'], ['14g_menu.js', 'InvClasses.CraftingInventory(null, 3, 3)'], ['14g_menu.js', 'InvClasses.CraftingInventory(null, 2, 2)'],
  ['14g_menu.js', 'InvClasses.CraftingResultInventory'], ['15_hud.js', 'InvClasses.ContainerLock']];
for (const [f, s] of wired) ok(src(f).includes(s), `${f} does not use ${s}`);
ok(readFileSync('build.mjs', 'utf8').includes("'14g2_invclasses.js'"), 'build.mjs lacks 14g2_invclasses.js');
const MUT = [
  (s) => s.replace('i >= n ? this.second.get', 'i > n ? this.second.get'),
  (s) => s.replace("return this.first.size + this.second.size;", "return this.first.size;"),
  (s) => s.replace("this.key === '' ||", "false ||"),
  (s) => s.replace("this.key === String(stack.nbt.name)", "true"),
  (s) => s.replace("CI.setStack = function (k, s) { this.stacks[k] = empty(s) ? null : s; if", "CI.setStack = function (k, s) { this.stacks[k] = empty(s) ? null : s; if (0 &&"),
  (s) => s.replace("RI.size = function () { return 1; }", "RI.size = function () { return 2; }"),
  (s) => s.replace("var s = this.stacks[0]; this.stacks[0] = null; return s; };\n  RI.setStack", "var s = this.stacks[0]; return s; };\n  RI.setStack"),
  (s) => s.replace("if (!empty(out) && this.handler", "if (this.handler"),
  (s) => s.replace("if (this.key !== '') tag.Lock", "if (true) tag.Lock"),
  (s) => s.replace("l.splice(k, 1)", "0"),
];
for (const m of MUT) { let r; try { r = checks(load(m)); } catch (e) { breaks++; continue; } if (r.some(([, v]) => !v)) { breaks++; console.log("✓ mutant caught"); } else fails.push('mutant survived: ' + m.toString().slice(0, 70)); }
for (const f of fails) console.log('FAIL', f);
console.log(`invclassescheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length || breaks < MUT.length ? 1 : 0);
