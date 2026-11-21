#!/usr/bin/env node
// #11689: ElytraItem (phantom-membrane repair) and AnvilScreenHandler (menu output/take) in 07zzp_anvil.js,
// driven through the real Menu.anvilMenu entry point; each cut and caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const SRC = readFileSync(join(MCLITE_ROOT, 'src', '07zzp_anvil.js'), 'utf8');
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '14g_menu.js', '14g2_invclasses.js', '07ox_enchhelper.js', '07zzp_anvil.js'], dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const Iv = MCL.Inventory, M = MCL.Menu;
const st = (n, c, d) => Iv.stack(n, c, d || 0);
console.log('anvilclassescheck — #11689: ElytraItem + AnvilScreenHandler (07zzp_anvil.js)');

let n = 0; const fails = [];
function run() {
  const f = []; const ok = (c, m) => { n++; if (!c) f.push(m); };
  const p = { instabuild: false, xpLevel: 5, inventory: Iv.create() };
  const mm = M.anvilMenu(p.inventory, p, { blockName: () => 'anvil', onBlock: () => {} });
  // ElytraItem: damaged elytra + phantom membranes in the real anvil menu
  M.slotSet(mm.slots[0], st('elytra', 1, 100)); M.slotSet(mm.slots[1], st('phantom_membrane', 4));
  ok(M.slotHas(mm.slots[2]) && mm.r.output && mm.r.output.d < 100, 'elytra + membrane yields repaired output');
  M.doClick(mm, 2, 0, M.PICKUP, p);
  const c = M.getCarried(mm);
  ok(c && c.d < 100 && !M.slotHas(mm.slots[0]), 'taking the repaired elytra consumes the damaged input');
  // other material must not repair an elytra
  const mm2 = M.anvilMenu(p.inventory, p, { blockName: () => 'anvil', onBlock: () => {} });
  M.slotSet(mm2.slots[0], st('elytra', 1, 100)); M.slotSet(mm2.slots[1], st('leather', 4));
  ok(!M.slotHas(mm2.slots[2]), 'leather does not repair an elytra');
  // AnvilScreenHandler: output gated on levels
  p.xpLevel = 0;
  const mm3 = M.anvilMenu(p.inventory, p, { blockName: () => 'anvil', onBlock: () => {} });
  M.slotSet(mm3.slots[0], st('iron_sword', 1, 100)); M.slotSet(mm3.slots[1], st('iron_ingot', 4));
  M.doClick(mm3, 2, 0, M.PICKUP, p);
  ok(M.getCarried(mm3) === null, 'no levels: output cannot be taken');
  return f;
}
fails.push(...run());
const saved = MCL.Anvil; let breaks = 0;
for (const [name, from, to] of [
  ['elytra membrane rule cut', "if (name === 'elytra') return mat === 'phantom_membrane';", ''],
  ['canTake level gate cut', 'An.canTake = function', 'An.canTake = function () { return true; }; An.canTakeX = function'],
]) {
  if (!SRC.includes(from)) { fails.push('anchor missing: ' + name); continue; }
  new Function('MCL', SRC.replace(from, to))(MCL);
  const f = run(); MCL.Anvil = saved;
  if (f.length) { breaks++; console.log('  ✓ cut caught: ' + name); } else fails.push('anti-vacuity: survived ' + name);
}
if (fails.length) { fails.forEach((x) => console.log('  ✗ ' + x)); process.exit(1); }
console.log(`OK  ${n} checks passed; ${breaks} breaks caught`);
