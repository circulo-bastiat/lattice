#!/usr/bin/env node
// advtooltipcheck.mjs — #7930. F3+H advanced tooltips: id, durability, colour, NBT count lines.
//   node tools/advtooltipcheck.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '02i_text.js', '14f_inventory.js', '14d_survival.js',
  '07zj_fish.js', '07ox_enchhelper.js', '07oy_enchtable.js', '14g_menu.js', '07c_blockentity.js', '13_input.js', '15b_gui.js', '14i_hand.js', '16_settings.js', '15_hud.js'], dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
M.Text.init({ lang: b64('lang.bin'), langBytes: rdj('lang.meta.json').rawBytes,
              langOverrides: readFileSync(join(ASSETS, 'lang-overrides.json'), 'utf8') });
{
  const tsv = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8');
  const table = {};
  for (const line of tsv.split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r16 = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r16(c[6]), r16(c[7]), +c[8]];
  }
  M.Hand.bindAttrs(table);
}
const H = M.Hud, Inv = M.Inventory;
const st = (n) => Inv.stack(n, 1);

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const texts = (L) => L.map((l) => l.text);
const J = (x) => JSON.stringify(x);
const S = M.Settings;
const adv = (s) => { S.advancedTooltips = true; const r = texts(H.stackTooltipLines(s)); return r; };
const stick = st('stick');
S.advancedTooltips = false;
ok(J(texts(H.stackTooltipLines(stick))) === J(['Stick']), 'off: stick has only its name');
ok(J(adv(stick)) === J(['Stick', 'minecraft:stick']), 'stick: ' + J(adv(stick)));
S.advancedTooltips = true;
ok(H.stackTooltipLines(stick)[1].rgb === 0x555555, 'id line dark gray');
const pick = st('diamond_pickaxe'); pick.d = 780;
const pl = adv(pick);
ok(pl.includes('Durability: 781 / 1561') && pl[pl.length - 1] === 'minecraft:diamond_pickaxe', 'pickaxe: ' + J(pl));
const cap = st('leather_helmet'); cap.t = { display: { color: 0xA06540 } };
const cl = adv(cap);
ok(cl.includes('Color: #A06540') && !cl.includes('Dyed') && cl.includes('NBT: 1 tag(s)'), 'cap: ' + J(cl));
const tg = st('stick'); tg.t = { foo: 1, bar: 2 };
ok(J(adv(tg)) === J(['Stick', 'minecraft:stick', 'NBT: 2 tag(s)']), 'tagged: ' + J(adv(tg)));
okAv(!adv(pick).includes('Durability: 781 / 1561') === false, 'durability line present');
const dsave = M.Items.durability; M.Items.durability = new Uint16Array(dsave.length);
okAv(!adv(pick).some((x) => x.startsWith('Durability')), 'with durability table zeroed the line goes');
M.Items.durability = dsave;
S.advancedTooltips = false;
okAv(texts(H.stackTooltipLines(tg)).length === 1, 'toggled off: no extra lines');
console.log('\n================ advtooltipcheck ================');
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' breaks caught ...... ' + breaks);
if (fails.length) { fails.forEach((f) => console.log('   ✗ ' + f)); process.exitCode = 1; }
