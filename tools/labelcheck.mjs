#!/usr/bin/env node
// labelcheck.mjs — QUEUE row 1 (G19b), D-650: the container screens' TITLE and "Inventory" LABEL.
//
//   node tools/labelcheck.mjs [--quiet]
//
// The furnace/hopper/dispenser screens drew both labels; the chest, barrel, ender chest, shulker,
// double chest, crafting table and the player's own screen drew NEITHER. This file:
//   1. REFEREES the positions off `.decomp/` (HandledScreen's defaults, each subclass's override —
//      rule 3/4: the numbers are read from the source, not typed here) and the strings off the
//      jar's own `en_us.json`, through the keys each block/block entity names in `.decomp/`;
//   2. DRAWS each screen through the real `Hud.draw*` with a recording `Gui.text`, and asserts the
//      text lands where the referee says — in BOTH directions: the player's own screen must draw
//      "Crafting" and must NOT draw "Inventory" (`InventoryScreen.drawForeground` draws one string);
//   3. breaks the data and asserts the scorer catches each break (D-30).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { JARS } from './paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const QUIET = process.argv.includes('--quiet');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; if (!QUIET) console.log('   ✓ ' + m); } else fails.push(m); return c; };
// a caught break always prints its ✓ — the suite counts breaks by that mark, even under --quiet
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ anti-vacuity: ' + m); } else fails.push('anti-vacuity: ' + m); };

// ── 1. the referee ─────────────────────────────────────────────────────────────────────────────
const D = join(ROOT, '.decomp', 'net', 'minecraft');
const src = (p) => { const f = join(D, p); if (!existsSync(f)) { fails.push('.decomp missing ' + p); return ''; } return readFileSync(f, 'utf8'); };
const num = (s, re) => { const m = s.match(re); return m ? +m[1] : NaN; };
const scr = 'client/gui/screen/ingame/';
const HS = src(scr + 'HandledScreen.java');
const base = {
  bgW: num(HS, /int backgroundWidth = (\d+)/), bgH: num(HS, /int backgroundHeight = (\d+)/),
  titleX: num(HS, /this\.titleX = (\d+)/), titleY: num(HS, /this\.titleY = (\d+)/),
  invX: num(HS, /this\.playerInventoryTitleX = (\d+)/),
  invSub: num(HS, /this\.playerInventoryTitleY = this\.backgroundHeight - (\d+)/)
};
const INV = src(scr + 'InventoryScreen.java');
const invFg = (INV.match(/void drawForeground\([^)]*\) \{([\s\S]*?)\n    \}/) || [])[1] || '';
const CR = src(scr + 'CraftingScreen.java');
const GC = src(scr + 'GenericContainerScreen.java');
const SB = src(scr + 'ShulkerBoxScreen.java');
const gcAdd = num(GC, /backgroundHeight = (\d+) \+ this\.rows \* 18/);
const gcSub = num(GC, /playerInventoryTitleY = this\.backgroundHeight - (\d+)/);
// ShulkerBoxScreen bumps backgroundHeight AFTER super() and never re-derives the label's y.
const sbLate = /super\([^)]*\);\s*this\.backgroundHeight\+\+;/.test(SB) && !/playerInventoryTitleY/.test(SB);
const REF = {
  inventory: { title: [num(INV, /this\.titleX = (\d+)/), base.titleY], label: /playerInventoryTitle/.test(invFg) ? [base.invX, base.bgH - base.invSub] : null,
               draws: (invFg.match(/textRenderer\.draw\(/g) || []).length },
  crafting: { title: [num(CR, /this\.titleX = (\d+)/), base.titleY], label: [base.invX, base.bgH - base.invSub] },
  chest3: { title: [base.titleX, base.titleY], label: [base.invX, gcAdd + 3 * 18 - gcSub] },
  chest6: { title: [base.titleX, base.titleY], label: [base.invX, gcAdd + 6 * 18 - gcSub] },
  shulker: { title: [base.titleX, base.titleY], label: [base.invX, sbLate ? base.bgH - base.invSub : base.bgH + 1 - base.invSub] }
};
if (!QUIET) console.log('1. referee (.decomp):', JSON.stringify(REF));
ok(REF.inventory.draws === 1 && REF.inventory.label === null, `InventoryScreen.drawForeground draws ONE string, the title (${REF.inventory.draws})`);
ok(Object.values(REF).every((r) => r.title.every(Number.isFinite) && (!r.label || r.label.every(Number.isFinite))), 'every referee number was read from .decomp');

// the lang keys, named where vanilla names them, and their strings off the jar's en_us.json
const key = (p, re) => (src(p).match(re) || [])[1];
const KEYS = {
  chest: key('block/entity/ChestBlockEntity.java', /TranslatableText\("(container\.[a-zA-Z]+)"\)/),
  double: key('block/ChestBlock.java', /TranslatableText\("(container\.chestDouble)"\)/),
  barrel: key('block/entity/BarrelBlockEntity.java', /TranslatableText\("(container\.[a-zA-Z]+)"\)/),
  ender_chest: key('block/EnderChestBlock.java', /TranslatableText\("(container\.[a-zA-Z]+)"\)/),
  shulker_box: key('block/entity/ShulkerBoxBlockEntity.java', /TranslatableText\("(container\.shulkerBox)"\)/),
  crafting: key(scr + 'InventoryScreen.java', /TranslatableText\("(container\.[a-zA-Z]+)"\)/),
  inventory: key('entity/player/PlayerInventory.java', /TranslatableText\("(container\.inventory)"\)/)
};
ok(!/getContainerName/.test(src('block/entity/TrappedChestBlockEntity.java')), 'a trapped chest keeps the chest\'s own name (no override)');
KEYS.trapped_chest = KEYS.chest;
const jf = [join(JARS, '1.18.2.jar'), join(JARS, '1.18.2', '1.18.2.jar')].find(existsSync);
const lang = jf ? JSON.parse(new Jar(jf).read('assets/minecraft/lang/en_us.json').toString('utf8')) : {};
ok(!!jf, 'the 1.18.2 jar is present for en_us.json');

// ── 2. draw the real screens ───────────────────────────────────────────────────────────────────
const NS = {}; globalThis.MCL = NS;
for (const f of ['15b_gui.js', '15_hud.js']) new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS);
const G = NS.Gui, H = NS.Hud;
let calls = [];
Object.assign(G, { ready: true, blit() {}, dim() {}, drawPlayer() {}, textWidth: (t) => String(t).length * 6,
  text: (c, t, x, y, s, col, sh) => calls.push({ t, x, y, s, col, sh }) });
NS.Menu = { slotGet: () => null, getCarried: () => null };
NS.Player = { menu: { slots: [] } };
NS.Inventory = { isEmpty: () => true };
NS.Text = { ready: true, has: (k) => typeof lang[k] === 'string', translate: (k) => lang[k] };
Object.assign(H, { w: 1000, h: 800, scale: 2 });
const gui = (w, h) => ({ s: 2, ox: Math.round((1000 - w * 2) * 0.5), oy: Math.round((800 - h * 2) * 0.5) });
function draw(kind) {
  calls = [];
  let w = 176, h = 166;
  if (kind === 'inventory') H.drawInventory({});
  else if (kind === 'crafting') { H.craftingMenu = { slots: [] }; H.drawCrafting({}); }
  else {
    const [type, rows] = kind.split(':');
    H.chestMenu = { rows: +rows, slots: [] };
    H.chestTexture = type === 'shulker_box' ? 'shulker_box' : 'generic_54';
    H.chestTitleKind = +rows === 6 ? 'double' : type;
    if (type !== 'shulker_box') h = +rows * 18 + 114;
    H.drawChest({});
  }
  const o = gui(w, h);
  return calls.map((k) => ({ t: k.t, x: (k.x - o.ox) / o.s, y: (k.y - o.oy) / o.s, col: k.col, sh: k.sh }));
}
// the scorer: exactly the strings the referee expects, at its positions, in 0x404040 and no shadow
function score(got, ref, titleKey) {
  const bad = [];
  const want = [{ t: lang[titleKey], at: ref.title }];
  if (ref.label) want.push({ t: lang[KEYS.inventory], at: ref.label });
  if (got.length !== want.length) bad.push(`${got.length} strings drawn, vanilla draws ${want.length} (${got.map((g) => g.t).join(' | ')})`);
  for (const w of want) {
    const g = got.find((q) => q.t === w.t);
    if (!g) { bad.push(`"${w.t}" not drawn`); continue; }
    if (g.x !== w.at[0] || g.y !== w.at[1]) bad.push(`"${w.t}" at (${g.x}, ${g.y}), vanilla (${w.at})`);
    if (g.col !== 0x404040 || g.sh) bad.push(`"${w.t}" colour ${g.col.toString(16)}/shadow ${g.sh}`);
  }
  return bad;
}
const CASES = [
  ['inventory', REF.inventory, KEYS.crafting], ['crafting', REF.crafting, KEYS.crafting],
  ['chest:3', REF.chest3, KEYS.chest], ['trapped_chest:3', REF.chest3, KEYS.trapped_chest],
  ['barrel:3', REF.chest3, KEYS.barrel], ['ender_chest:3', REF.chest3, KEYS.ender_chest],
  ['chest:6', REF.chest6, KEYS.double], ['shulker_box:3', REF.shulker, KEYS.shulker_box]
];
if (!QUIET) console.log('2. the screens, drawn');
const drawn = {};
for (const [kind, ref, tk] of CASES) {
  drawn[kind] = draw(kind);
  const bad = score(drawn[kind], ref, tk);
  ok(bad.length === 0, `${kind}: ${bad.length ? bad.join('; ') : `"${lang[tk]}" at (${ref.title})` + (ref.label ? `, "${lang[KEYS.inventory]}" at (${ref.label})` : ', no Inventory label')}`);
}

// ── 3. anti-vacuity ────────────────────────────────────────────────────────────────────────────
if (!QUIET) console.log('3. anti-vacuity');
okAv(score(drawn['chest:3'].filter((g) => g.t !== lang[KEYS.inventory]), REF.chest3, KEYS.chest).length > 0, 'a chest with its "Inventory" label dropped is caught');
okAv(score(drawn.inventory.concat([{ t: lang[KEYS.inventory], x: 8, y: 72, col: 0x404040, sh: false }]), REF.inventory, KEYS.crafting).length > 0,
     'the player\'s own screen WITH an "Inventory" label is caught (both directions)');
okAv(score(drawn.crafting, { ...REF.crafting, title: [8, 6] }, KEYS.crafting).length > 0, 'a crafting title at the default x=8 (not 29) is caught');
okAv(score(drawn['chest:6'], REF.chest6, KEYS.chest).length > 0, 'a double chest titled "Chest" (not "Large Chest") is caught');
okAv(score(drawn['shulker_box:3'], { ...REF.shulker, label: [8, 73] }, KEYS.shulker_box).length > 0, 'a shulker label at 73 (the late ++ re-derived) is caught');

console.log('\n================= labelcheck ==================');
if (fails.length) { for (const f of fails) console.log('FAIL  ' + f); console.log(`${pass} passed, ${fails.length} failed`); process.exit(1); }
console.log(`labelcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
