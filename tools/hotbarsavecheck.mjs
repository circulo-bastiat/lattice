#!/usr/bin/env node
// hotbarsavecheck.mjs — #8145. Creative saved toolbars: save slot 3, change hotbar, load slot 3, JSON round trip.
//   node tools/hotbarsavecheck.mjs   (also breaks its own module: "<n> breaks caught")
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), SRC = join(ROOT, 'src'), AS = join(ROOT, 'assets');
const CR = readFileSync(join(SRC, '15e_creative.js'), 'utf8');
function run(crSrc) {
  const NS = {}; globalThis.MCL = NS;
  for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02f_tags.js', '02g_items.js', '02i_text.js', '14f_inventory.js', '14g_menu.js'])
    new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
  new Function('MCL', crSrc)(NS);
  const meta = JSON.parse(readFileSync(join(AS, 'items.meta.json'), 'utf8'));
  NS.Items.init({ items: readFileSync(join(AS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
  const Iv = NS.Inventory, C = NS.Creative, f = [];
  const no = (c, m) => { if (!c) f.push(m); };
  const mk = () => ({ slots: Array.from({ length: Iv.SIZE }, () => Iv.EMPTY), selected: 0 });
  const inv = mk(), P = { inventory: inv };
  Iv.setItem(inv, 0, Iv.stack('diamond_sword', 1, 5, { display: { Name: 'x' } }));
  Iv.setItem(inv, 1, Iv.stack('stone', 37, 0));
  C.hotbarKeyPress(2, false, true, P);
  inv.slots[0].t.display.Name = 'mutated'; Iv.setItem(inv, 1, Iv.stack('dirt', 3, 0));
  C.hotbarKeyPress(2, true, false, P);
  const chk = (P2, m) => {
    const a = P2.inventory.slots[0];
    no(a.n === 1 && a.d === 5 && a.t && a.t.display.Name === 'x', m + ' tag/damage');
    no(P2.inventory.slots[1].n === 37, m + ' count');
  };
  chk(P, 'reload');
  inv.slots[0].t.display.Name = 'edited'; inv.slots[1].n = 1;   // editing the hotbar must not edit the saved entry
  C.hotbarKeyPress(2, true, false, P); chk(P, 'reload2');
  C.hotbarsFromJSON(JSON.parse(JSON.stringify(C.hotbarsToJSON())));
  const P2 = { inventory: mk() };
  C.hotbarKeyPress(2, true, false, P2); chk(P2, 'roundtrip');
  no(Iv.isEmpty(P2.inventory.slots[2]), 'empty slot stays empty');
  return f;
}
const base = run(CR);
if (base.length) { console.log('FAIL', base); process.exit(1); }
const breaks = [['alias', "e[i] = copyStack(player.inventory.slots[i])", "e[i] = player.inventory.slots[i]"],
  ['aliasload', "Iv.setItem(player.inventory, i, copyStack(e[i]))", "Iv.setItem(player.inventory, i, e[i])"],
  ['nosave', "e.map(NS.Inventory.stackToJSON)", "e.map(function () { return null; })"]];
let caught = 0;
for (const [n, a, b] of breaks) {
  if (!CR.includes(a)) { console.log('FAIL break pattern missing', n); process.exit(1); }
  let r; try { r = run(CR.replace(a, b)); } catch (e) { r = ['threw']; }
  if (r.length) caught++; else console.log('NOT caught', n);
}
console.log(`hotbarsavecheck: ok, ${caught} breaks caught`);
process.exit(caught === breaks.length ? 0 : 1);
