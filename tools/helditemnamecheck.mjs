#!/usr/bin/env node
// helditemnamecheck.mjs — #363: the held-item name tooltip (InGameHud.tick / renderHeldItemTooltip).
//   node tools/helditemnamecheck.mjs
// Vanilla resets the 40-tick timer only when the item or its NAME changes (not damage, not other tags),
// and draws the name in the stack's rarity colour (enchanted: one step up), italic for a custom name.
import { loadEngine } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '13_input.js', '15b_gui.js', '15_hud.js'], dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const H = MCL.Hud, Inv = MCL.Inventory;

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

const id = (n) => MCL.Items.of(n);
const stk = (n, t, d) => ({ i: id(n), n: 1, d: d | 0, t: t || null });

// draw once, return {rgb, italic}
function drawn(st) {
  const calls = [];
  const saveGui = MCL.Gui, saveP = MCL.Player;
  MCL.Gui = Object.assign(Object.create(saveGui || {}), {
    ready: true, HUD: { nameY: -59, nameNoHurtDY: 14 }, textWidth: (s) => s.length * 6,
    text: (c, s, x, y, k, rgb) => { calls.push(rgb); return 0; }
  });
  MCL.Player = { inventory: { slots: [st] }, slot: 0, hotbar: [0], invulnerableGamemode: false };
  const saveGet = Inv.getItem; Inv.getItem = () => st;
  let italic = false;
  const c = { globalAlpha: 1, save() {}, restore() {}, translate() { italic = italic; }, transform() { italic = true; } };
  H.w = 800; H.h = 600; H.scale = 2; H.toolHighlightTimer = 40;
  H.drawSelectedItemName(c);
  Inv.getItem = saveGet; MCL.Gui = saveGui; MCL.Player = saveP;
  return { rgb: calls[calls.length - 1], italic };
}

const ENCH = [{ id: 'minecraft:sharpness', lvl: 1 }];
function run(tickFn) {
  H.lastToolHighlight = null; H.toolHighlightTimer = 0;
  const hoe = stk('diamond_hoe');
  tickFn(hoe);
  for (let i = 0; i < 41; i++) tickFn(hoe);
  const idle = H.toolHighlightTimer;
  hoe.d += 1; tickFn(hoe);
  const afterDmg = H.toolHighlightTimer;
  hoe.t = { RepairCost: 1 }; tickFn(hoe);
  const afterTag = H.toolHighlightTimer;
  return { idle, afterDmg, afterTag };
}

const r = run((s) => H.tickToolHighlight(s));
ok(r.idle === 0, `the name has faded after 41 ticks (${r.idle})`);
ok(r.afterDmg === 0, `durability change does not bring the name back (${r.afterDmg})`);
ok(r.afterTag === 0, `a tag change does not bring the name back (${r.afterTag})`);
H.lastToolHighlight = null; H.toolHighlightTimer = 0;
H.tickToolHighlight(stk('diamond_hoe'));
ok(H.toolHighlightTimer === 40, 'a new item sets the timer to 40');
H.tickToolHighlight(stk('diamond_pickaxe'));
ok(H.toolHighlightTimer === 40, 'a different item resets it');
H.toolHighlightTimer = 5;
H.tickToolHighlight(stk('diamond_pickaxe', { display: { Name: '"Bob"' } }));
ok(H.toolHighlightTimer === 40, 'a renamed stack resets it');

ok(drawn(stk('golden_apple')).rgb === 0x55FFFF, 'golden apple is aqua (RARE)');
ok(drawn(stk('enchanted_golden_apple')).rgb === 0xFF55FF, 'enchanted golden apple is light purple (EPIC)');
ok(drawn(stk('diamond_sword', { Enchantments: ENCH })).rgb === 0x55FFFF, 'enchanted diamond sword is aqua');
ok(drawn(stk('diamond_sword')).rgb === 0xFFFFFF, 'plain diamond sword is white');
ok(drawn(stk('nether_star')).rgb === 0xFFFF55, 'nether star is yellow');
ok(drawn(stk('enchanted_book', { StoredEnchantments: ENCH })).rgb === 0xFFFF55, 'enchanted book (stored only) stays UNCOMMON yellow');
ok(drawn(stk('enchanted_book', { Enchantments: ENCH })).rgb === 0x55FFFF, 'book with Enchantments goes RARE');
ok(drawn(stk('diamond_sword', { display: { Name: '"Bob"' } })).italic === true, 'a custom name is italic');
ok(drawn(stk('diamond_sword')).italic === false, 'a plain name is not');

// anti-vacuity: break each rule and the check must notice
{
  const same = run((s) => {
    const l = H.lastToolHighlight;
    if (!l || !Inv.isSameItemSameTags(l, s)) { H.lastToolHighlight = Inv.copy(s); H.toolHighlightTimer = 40; }
    else if (H.toolHighlightTimer > 0) { H.toolHighlightTimer--; H.lastToolHighlight = Inv.copy(s); }
  });
  okAv(!(same.afterDmg === 0 && same.afterTag === 0), 'isSameItemSameTags as the reset rule is caught');
  const sr = H.stackRarity; H.stackRarity = () => 0;
  okAv(drawn(stk('golden_apple')).rgb !== 0x55FFFF, 'a white name is caught');
  H.stackRarity = sr;
}

console.log('\n================ helditemnamecheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
