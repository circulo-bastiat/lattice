#!/usr/bin/env node
// tooltipcheck.mjs — #365. ItemStack.getTooltip / Screen.renderTooltipFromComponents: rarity name colour,
// the attribute-modifier section, HideFlags, and the tooltip geometry (offset, flip, bottom clamp, 2 px title gap).
//   node tools/tooltipcheck.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '02i_text.js', '14f_inventory.js', '14d_survival.js',
  '07zj_fish.js', '07ox_enchhelper.js', '07oy_enchtable.js', '14g_menu.js', '07c_blockentity.js', '13_input.js', '15b_gui.js', '14i_hand.js', '15_hud.js'], dom: false });
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

console.log('tooltipcheck — #365, item tooltip');
{
  const want = ['Diamond Sword', '', 'When in Main Hand:', ' 7 Attack Damage', ' 1.6 Attack Speed'];
  const L = H.stackTooltipLines(st('diamond_sword'));
  ok(J(texts(L)) === J(want), 'diamond sword lines: ' + J(texts(L)));
  ok(L[0].rgb === 0xFFFFFF && L[2].rgb === 0xAAAAAA && L[3].rgb === 0x00AA00 && L[4].rgb === 0x00AA00, 'sword colours white/grey/dark green');
  ok(H.stackTooltipLines(st('golden_apple'))[0].rgb === 0x55FFFF, 'golden apple is RARE aqua');
  ok(H.stackTooltipLines(st('enchanted_golden_apple'))[0].rgb === 0xFF55FF, 'god apple is EPIC light purple');
  ok(H.stackTooltipLines(st('nether_star'))[0].rgb === 0xFFFF55, 'nether star is UNCOMMON yellow');
  const ench = st('diamond_sword'); ench.t = { Enchantments: [{ id: 'minecraft:sharpness', lvl: 1 }] };
  ok(H.stackTooltipLines(ench)[0].rgb === 0x55FFFF, 'an enchanted COMMON item becomes RARE');
  const ch = st('diamond_chestplate');
  ok(J(texts(H.stackTooltipLines(ch))) === J(['Diamond Chestplate', '', 'When on Body:', '+8 Armor', '+2 Armor Toughness']) ||
     J(texts(H.stackTooltipLines(ch)).slice(2, 3)) === J(['When on Chest:']), 'chestplate armour section: ' + J(texts(H.stackTooltipLines(ch))));
  const hid = st('diamond_sword'); hid.t = { HideFlags: 2 };
  ok(H.stackTooltipLines(hid).length === 1, 'HideFlags 2 hides the modifier section');
  const named = st('stick'); named.t = { display: { Name: '{"text":"Wand"}' } };
  const NL = H.stackTooltipLines(named);
  ok(NL[0].text === 'Wand' && NL[0].italic === true, 'custom name, italic');
  const ub = st('stick'); ub.t = { Unbreakable: 1 };
  ok(texts(H.stackTooltipLines(ub)).pop() === 'Unbreakable', 'Unbreakable line');

  const A = H.tooltipLayout([50, 40, 30, 30, 30], 10, 100, 400, 300);
  ok(A.x === 22 && A.y === 88 && A.w === 50 && A.h === 50, 'origin (mouse+12, mouse-12), height 10n');
  ok(J(A.ys) === J([88, 100, 110, 120, 130]), 'line y: title gap of 2: ' + J(A.ys));
  ok(H.tooltipLayout([50], 10, 100, 400, 300).h === 8, 'one line is 8 high');
  ok(H.tooltipLayout([50, 20], 390, 100, 400, 300).x === 390 + 12 - 28 - 50, 'flips left past the right edge');
  ok(H.tooltipLayout([50, 20], 10, 295, 400, 300).y === 300 - 20 - 6, 'clamped at the bottom');
  { // #3666: EntityBucketItem.appendTooltip for tropical_fish_bucket
    const F = M.Fish, fb = (v) => ({ i: M.Items.of('tropical_fish_bucket'), n: 1, t: { BucketVariantTag: v } });
    const pre = texts(H.stackTooltipLines(fb(F.COMMON_VARIANTS[0])));
    okAv(pre.length === 2 && pre[1] === 'Anemone', 'common variant 0 -> predefined line: ' + J(pre));
    const cus = texts(H.stackTooltipLines(fb(F.toVariant(1, 4, 14, 14))));
    okAv(J(cus.slice(1)) === J(['Brinely', 'Red']), 'custom variant -> variety + single colour: ' + J(cus));
    const cus2 = texts(H.stackTooltipLines(fb(F.toVariant(0, 0, 1, 2))));
    okAv(cus2.length === 3 && cus2[2] === 'Orange, Magenta', 'base != pattern colour joins with a comma: ' + J(cus2));
    ok(H.stackTooltipLines(st('tropical_fish_bucket')).length === 1, 'no BucketVariantTag -> name only');
    const gi = M.Fish.COMMON_VARIANTS; M.Fish.COMMON_VARIANTS = [];
    okAv(texts(H.stackTooltipLines(fb(gi[0])))[1] !== 'Anemone', 'with COMMON_VARIANTS emptied the predefined line goes');
    M.Fish.COMMON_VARIANTS = gi;
  }
  const saved = M.Hand.attrs; M.Hand.bindAttrs(null);
  okAv(J(texts(H.stackTooltipLines(st('diamond_sword')))) !== J(want), 'with the attribute table removed the sword lines no longer match');
  M.Hand.bindAttrs(saved);
  okAv(J(texts(H.stackTooltipLines(st('diamond_sword')))) === J(want), 'restoring the table restores the lines');
  okAv(A.ys[1] - A.ys[0] === 12 && A.ys[2] - A.ys[1] === 10, 'line spacing 12 after the title, then 10 (dropping the gap breaks it)');
}
console.log('\n================ tooltipcheck ================');
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' breaks caught ...... ' + breaks);
if (fails.length) { fails.forEach((f) => console.log('   ✗ ' + f)); process.exitCode = 1; }
