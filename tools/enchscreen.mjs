#!/usr/bin/env node
// enchscreen.mjs — PLAN G22. The enchanting table's SCREEN and MENU: slot origins and the button strip
// read out of the jar-derived decomp (EnchantmentScreenHandler.java / EnchantmentScreen.java) and out
// of enchanting_table.png's own pixels; the roll (a real java.util.Random) and the clue-holds contract;
// the lapis/level economy; the Standard Galactic label; tooltips; the glint predicate.
//
//   node tools/enchscreen.mjs [--verbose]
//
// Every section ends in a deliberate break (data or code corrupted, the assertion shown to catch it).

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const say = (s) => { if (VERBOSE) console.log(s); };

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '02i_text.js', '14f_inventory.js', '14d_survival.js',
               '07ox_enchhelper.js', '07oy_enchtable.js', '14g_menu.js', '07c_blockentity.js', '13_input.js', '15b_gui.js', '14i_hand.js', '15_hud.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
MCL.Text.init({ lang: b64('lang.bin'), langBytes: rdj('lang.meta.json').rawBytes,
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
  MCL.Hand.bindAttrs(table);
}
const Inv = MCL.Inventory, M = MCL.Menu, H = MCL.Hud, G = MCL.Gui, ET = MCL.EnchTable, Sv = MCL.Survival, EH = MCL.EnchHelper;
const st = (n, c) => Inv.stack(n, c === undefined ? 1 : c);
const nameOf = (s) => (Inv.isEmpty(s) ? '' : MCL.Items.nameOf(s.i));

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

console.log('enchscreen — PLAN G22, the enchanting table screen');

// ═══════════ 1. LAYOUT — the decomp's numbers, and the sheet's pixels ═══════════════════════════
say('\n1. layout');
const menuSrc = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/screen/EnchantmentScreenHandler.java'), 'utf8');
const scrSrc = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/client/gui/screen/ingame/EnchantmentScreen.java'), 'utf8');
const blob = inflateRawSync(readFileSync(join(ASSETS, 'gui.bin')));
const hlen = blob.readUInt32LE(0);
const head = JSON.parse(blob.slice(4, 4 + hlen).toString('utf8'));
const sheet = Object.create(null);
for (const s of head.sheets) sheet[s.n] = { w: s.w, h: s.h, off: 4 + hlen + s.o };
const px = (name, x, y) => {
  const s = sheet[name];
  if (!s || x < 0 || y < 0 || x >= s.w || y >= s.h) return [0, 0, 0, 0];
  const i = s.off + (y * s.w + x) * 4;
  return [blob[i], blob[i + 1], blob[i + 2], blob[i + 3]];
};
function layoutFailures() {
  const f = [], V = G.ENCHANT, B = V.button;
  const m = /new Slot\(this\.inventory, 0, (\d+), (\d+)\)/.exec(menuSrc), l = /new Slot\(this\.inventory, 1, (\d+), (\d+)\)/.exec(menuSrc);
  if (!m || V.item[0] !== +m[1] || V.item[1] !== +m[2]) f.push('item slot origin differs from the handler');
  if (!l || V.lapis[0] !== +l[1] || V.lapis[1] !== +l[2]) f.push('lapis slot origin differs from the handler');
  if (!/8 \+ \$\$4 \* 18, 84 \+ \$\$3 \* 18/.test(menuSrc) || V.main[0] !== 8 || V.main[1] !== 84) f.push('backpack origin');
  if (!/8 \+ \$\$5 \* 18, 142/.test(menuSrc) || V.hotbar[1] !== 142) f.push('hotbar origin');
  if (!scrSrc.includes(`$$3 + ${B.x})`) || !scrSrc.includes(`${B.y} + ${B.pitch} * $$5`) ||
      !scrSrc.includes(`< ${B.w}.0`) || !scrSrc.includes(`< ${B.h}.0`)) f.push('button strip geometry differs from the screen');
  const tex = (u, v) => scrSrc.includes(`, ${u}, ${v}, ${B.w}, ${B.h}`);
  if (!tex(B.disabled[0], B.disabled[1]) || !tex(B.enabled[0], B.enabled[1]) || !tex(B.hover[0], B.hover[1])) f.push('button texture rects');
  if (!scrSrc.includes(`16 * $$17, ${V.icon.on[1]}, 16, 16`) || !scrSrc.includes(`16 * $$17, ${V.icon.off[1]}, 16, 16`)) f.push('level icon rects');
  // the pixels: a slot interior is the flat #8B8B8B, each button state is a solid 108x19 sprite, each icon inked
  for (const [x, y] of [V.item, V.lapis]) {
    const p = px('enchanting_table', x + 1, y + 1);   // the lapis slot carries a ghost lapis in its middle
    if (p[0] !== 139 || p[1] !== 139 || p[2] !== 139) f.push(`slot at ${x},${y} does not land on the slot interior`);
  }
  for (const r of [B.disabled, B.enabled, B.hover]) {
    if (px('enchanting_table', r[0], r[1])[3] === 0 || px('enchanting_table', r[0] + B.w - 1, r[1] + B.h - 1)[3] === 0 ||
        px('enchanting_table', r[0] + B.w, r[1])[3] !== 0) f.push(`button sprite at ${r} is not a ${B.w}x${B.h} solid`);
  }
  for (let i = 0; i < 3; i++) for (const r of [V.icon.on, V.icon.off]) {
    let inked = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (px('enchanting_table', r[0] + 16 * i + x, r[1] + y)[3] > 0) inked++;
    if (inked < 30) f.push(`level icon ${i} at ${r} is empty`);
  }
  return f;
}
{
  const f = layoutFailures();
  ok(f.length === 0, 'layout matches the handler, the screen and the sheet: ' + f.join('; '));
  ok(G.enchantSlotAt(15 + 3, 47 + 3) === 0 && G.enchantSlotAt(35 + 3, 47 + 3) === 1, 'slots 0 and 1 hit-test at their origins');
  ok(G.enchantSlotAt(8, 84) === 2 && G.enchantSlotAt(8 + 8 * 18, 142) === 37 && G.enchantSlotAt(200, 200) === -1, 'backpack 2.., hotbar ..37');
  ok(G.enchantButtonAt(60, 14) === 0 && G.enchantButtonAt(167, 14 + 38 + 18) === 2 && G.enchantButtonAt(168, 14) === -1, 'the three buttons hit-test as 108x19 at pitch 19');
  const keep = G.ENCHANT.lapis;
  G.ENCHANT.lapis = [keep[0] + 18, keep[1]];
  okAv(layoutFailures().length > 0, 'moving the lapis slot one cell is caught');
  G.ENCHANT.lapis = keep;
  const kb = G.ENCHANT.button.enabled;
  G.ENCHANT.button.enabled = [0, 167];
  okAv(layoutFailures().length > 0, 'a button texture rect one row off is caught');
  G.ENCHANT.button.enabled = kb;
}

// ═══════════ 2. java.util.Random and the roll ═══════════════════════════════════════════════════
say('\n2. the roll');
{
  ok(new ET.Random(0).nextInt() === -1155484576, 'Random(0).nextInt() is the JDK value');
  ok(new ET.Random(42).nextInt() === -1170105035, 'Random(42).nextInt() is the JDK value');
  const r = new ET.Random(7);
  let inRange = true;
  for (let i = 0; i < 500; i++) { const v = r.nextInt(8); if (v < 0 || v > 7) inRange = false; }
  ok(inRange, 'nextInt(8) stays in 0..7');
  const R = new ET.Random(1234);
  const sw = ET.info('diamond_sword');
  ok(ET.requiredLevel(R, 0, 15, sw) >= 1 && ET.requiredLevel(new ET.Random(1), 2, 15, sw) >= 30, 'button 3 with 15 shelves needs at least level 30');
  ok(ET.requiredLevel(new ET.Random(5), 1, 0, null) === 0, 'an item with no enchantability offers nothing');
  // the clue holds: what the tooltip names is among what the button applies, for every seed tried
  const clueHolds = (seedOffset) => {
    let bad = 0, seen = 0;
    for (let seed = -50; seed < 250; seed++) {
      const o = ET.offers(seed, 15, st('iron_pickaxe'));
      for (let b = 0; b < 3; b++) {
        if (o.power[b] <= 0 || !o.id[b]) continue;
        seen++;
        const list = ET.rollFor(seed + seedOffset, b, ET.info('iron_pickaxe'), o.power[b]);
        if (!list.some((e) => e.id === o.id[b] && e.level === o.level[b])) bad++;
      }
    }
    return { bad, seen };
  };
  const c0 = clueHolds(0);
  ok(c0.seen > 300 && c0.bad === 0, `the clue is always one of the enchantments the click applies (${c0.seen} offers, ${c0.bad} broken)`);
  okAv(clueHolds(1).bad > 0, 'rolling from the wrong seed breaks the clue, so the assertion above can fail');
  // results are legal: conflict-free, target-correct, level-in-range
  let legal = true;
  for (let seed = 0; seed < 200 && legal; seed++) {
    const o = ET.offers(seed, 15, st('diamond_sword'));
    for (let b = 0; b < 3; b++) {
      if (o.power[b] <= 0) continue;
      const list = ET.rollFor(seed, b, ET.info('diamond_sword'), o.power[b]);
      for (let i = 0; i < list.length; i++) {
        const e = EH.ENCH[list[i].id];
        if (!(e.target === 'weapon' || e.target === 'breakable') || list[i].level < 1 || list[i].level > e.maxLevel) legal = false;
        for (let j = i + 1; j < list.length; j++) if (!EH.canCombine(list[i].id, list[j].id)) legal = false;
      }
    }
  }
  ok(legal, 'a sword only ever gets weapon/breakable enchantments, in range, none conflicting');
  ok(!ET.isEnchantable(st('diamond_sword', 2)) && !ET.isEnchantable(st('stick')) && !ET.isEnchantable(st('shears')) && ET.isEnchantable(st('book')),
     'a stack of 2, a stick and shears are not enchantable; a book is');
  const done = st('diamond_sword'); ET.addEnchantment(done, 'sharpness', 1);
  ok(!ET.isEnchantable(done), 'an already enchanted item is not');
  ok(ET.info('golden_helmet').ench === 25 && ET.info('stone_pickaxe').ench === 5 && ET.info('netherite_boots').ench === 15, 'enchantability by material');
}

// ═══════════ 3. bookshelves ═════════════════════════════════════════════════════════════════════
say('\n3. bookshelves');
{
  const cells = new Map();
  const at = (x, y, z) => cells.get(x + ',' + y + ',' + z) || 'air';
  const put = (x, y, z, n) => cells.set(x + ',' + y + ',' + z, n);
  put(2, 0, 0, 'bookshelf'); put(2, 1, 2, 'bookshelf'); put(-2, 0, -1, 'bookshelf');
  ok(ET.countBookshelves(at, 0, 0, 0) === 3, 'three shelves with air between count three (a corner one too)');
  put(1, 0, 0, 'stone');
  ok(ET.countBookshelves(at, 0, 0, 0) === 2, 'a block between a shelf and the table hides it');
  put(1, 1, 1, 'torch');
  ok(ET.countBookshelves(at, 0, 0, 0) === 1, 'the corner shelf is hidden by anything on the diagonal cell (not only solid blocks)');
  put(1, 0, 1, 'bookshelf');
  ok(ET.countBookshelves(at, 0, 0, 0) === 1, 'a shelf at distance 1 is not one of the 32 offsets');
  ok(ET.BOOKSHELF_OFFSETS.length === 32, 'there are 32 offsets (the 5x5 ring, two layers)');
  const ko = ET.BOOKSHELF_OFFSETS.length;
  okAv(ET.countBookshelves(() => 'bookshelf', 0, 0, 0) === 0, 'shelves with no air between them count for nothing');
}

// ═══════════ 4. the menu: slots, quick move, the economy ══════════════════════════════════════
say('\n4. the menu');
const newPlayer = (lvl, creative) => {
  const P = { menu: { inventory: Inv.create() }, xpTotal: 0, instabuild: !!creative, dropped: [], dropStack(s) { this.dropped.push(s); } };
  P.xpTotal = Sv.totalXpFor(lvl); Sv.syncXp(P);
  MCL.Player = P;
  return P;
};
const table = (P) => M.enchantMenu({ x: 0, y: 0, z: 0, shelves: 15 }, P.menu.inventory, P);
{
  const P = newPlayer(30), m = table(P);
  ok(m.slots.length === 38, `38 slots (2 + 27 + 9), got ${m.slots.length}`);
  ok(M.slotMayPlace(m.slots[0], st('diamond_sword')) && M.slotMaxStack(m.slots[0], st('diamond_sword')) === 1, 'slot 0 takes anything, one only');
  ok(M.slotMayPlace(m.slots[1], st('lapis_lazuli')) && !M.slotMayPlace(m.slots[1], st('coal')), 'slot 1 takes lapis only');
  Inv.setItem(P.menu.inventory, 9, st('diamond_sword'));
  Inv.setItem(P.menu.inventory, 10, st('lapis_lazuli', 20));
  Inv.setItem(P.menu.inventory, 11, st('iron_pickaxe', 1));
  M.doClick(m, 2, 0, M.QUICK_MOVE, P);
  ok(nameOf(m.table.get(0)) === 'diamond_sword' && Inv.isEmpty(Inv.getItem(P.menu.inventory, 9)), 'a shift-clicked item lands in the item slot');
  const held = nameOf(m.table.get(0));
  M.doClick(m, 3, 0, M.QUICK_MOVE, P);
  M.doClick(m, 3, 0, M.QUICK_MOVE, P);
  ok(nameOf(m.table.get(0)) === held, 'a second item cannot be shift-clicked into an occupied item slot');
  // put lapis
  for (let i = 2; i < 29; i++) if (nameOf(M.slotGet(m.slots[i])) === 'lapis_lazuli') { M.doClick(m, i, 0, M.QUICK_MOVE, P); break; }
  ok(nameOf(m.table.get(1)) === 'lapis_lazuli' && m.table.get(1).n === 20, 'shift-clicking lapis fills the lapis slot');
  ok(m.offers.power.some((p) => p > 0), 'with a shelved table and an enchantable item the buttons light up');
}
{
  // a full click sequence on a sword
  const P = newPlayer(30), m = table(P);
  m.table.set(0, st('diamond_sword')); m.table.set(1, st('lapis_lazuli', 5));
  Menu_refresh(m);
  const pw = m.offers.power.slice(), seedBefore = m.seed;
  // each button draws its own nextInt pair off the seeded generator (calculateRequiredExperienceLevel), so with 15 shelves
  // v is 8..30 per button independently: button 1 is 6..21, button 2 is 30, button 0 is 2..10 - they can tie or even cross
  const inBands = (p) => p[0] >= 2 && p[0] <= 10 && p[1] >= 6 && p[1] <= 21 && p[2] === 30;
  let bandsOk = inBands(pw);
  for (let seed = -50; seed < 250 && bandsOk; seed++) bandsOk = inBands(ET.offers(seed, 15, st('diamond_sword')).power);
  ok(bandsOk, `offers stay in the vanilla bands per button for every seed (${pw})`);
  okAv(!inBands([1, 5, 31]) && !inBands([11, 9, 30]), 'a power outside its band fails the band test, so the assertion above can fail');
  const lvlBefore = P.xpLevel;
  ok(M.enchantClick(m, P, 1) === true, 'button 2 with enough lapis and levels enchants');
  const sw = m.table.get(0);
  ok(nameOf(sw) === 'diamond_sword' && sw.t && sw.t.Enchantments && sw.t.Enchantments.length >= 1, 'the sword now carries Enchantments');
  ok(m.table.get(1).n === 3, `2 lapis spent (5 -> ${m.table.get(1).n})`);
  ok(P.xpLevel === lvlBefore - 2, `2 levels spent (${lvlBefore} -> ${P.xpLevel})`);
  ok(m.seed !== seedBefore && P.enchantSeed === m.seed, 'a new enchantment seed is drawn');
  ok(m.offers.power.every((p) => p === 0), 'and an enchanted item offers nothing more');
  ok(M.enchantClick(m, P, 0) === false, 'pressing a button on an enchanted item does nothing');
  // insufficient
  const P2 = newPlayer(30), m2 = table(P2);
  m2.table.set(0, st('iron_axe')); m2.table.set(1, st('lapis_lazuli', 1)); Menu_refresh(m2);
  ok(M.enchantClick(m2, P2, 2) === false && !m2.table.get(0).t, 'button 3 with 1 lapis does nothing');
  const P3 = newPlayer(1), m3 = table(P3);
  m3.table.set(0, st('iron_axe')); m3.table.set(1, st('lapis_lazuli', 3)); Menu_refresh(m3);
  ok(M.enchantClick(m3, P3, 2) === false, 'button 3 at level 1 does nothing');
  // creative pays nothing and needs no lapis
  const P4 = newPlayer(0, true), m4 = table(P4);
  m4.table.set(0, st('iron_axe')); Menu_refresh(m4);
  ok(M.enchantClick(m4, P4, 2) === true && m4.table.get(0).t && P4.xpLevel === 0, 'creative enchants with no lapis and no levels');
  // a book becomes an enchanted book
  const P5 = newPlayer(30), m5 = table(P5);
  m5.table.set(0, st('book')); m5.table.set(1, st('lapis_lazuli', 3)); Menu_refresh(m5);
  ok(M.enchantClick(m5, P5, 2) === true, 'a book can be enchanted');
  const eb = m5.table.get(0);
  ok(nameOf(eb) === 'enchanted_book' && eb.t.StoredEnchantments.length >= 1 && !eb.t.Enchantments, 'and comes out as an enchanted_book with StoredEnchantments');
  ok(H.stackHasGlint(eb), 'an enchanted book glints');
  // close returns both slots
  const P6 = newPlayer(30), m6 = table(P6);
  m6.table.set(0, st('iron_axe')); m6.table.set(1, st('lapis_lazuli', 4));
  M.enchantClose(m6, P6);
  let back = 0;
  for (let i = 0; i < 41; i++) { const s = Inv.getItem(P6.menu.inventory, i); if (!Inv.isEmpty(s)) back++; }
  ok(back === 2 && Inv.isEmpty(m6.table.get(0)) && Inv.isEmpty(m6.table.get(1)), 'closing hands both slots back to the player');
  // anti-vacuity: a menu that ignored the lapis price would let button 3 through on one lapis
  const realClick = M.enchantClick;
  const P7 = newPlayer(30), m7 = table(P7);
  m7.table.set(0, st('iron_axe')); m7.table.set(1, st('lapis_lazuli', 1)); Menu_refresh(m7);
  okAv(realClick(m7, P7, 2) === false, 'the lapis check refuses a 1-lapis click on button 3 (what a menu with no price would let through)');
}
function Menu_refresh(m) { M.enchantRefresh(m); }

// ═══════════ 5. THE SCREEN DRAW — buttons, Standard Galactic label, level cost ═════════════════
say('\n5. drawEnchanting');
{
  G.ready = true;
  const calls = [];
  G.dim = () => {};
  G.blit = (c, sheetName, r, x, y, sc) => calls.push({ sheet: sheetName, r: r.slice(), x, y, sc });
  G.text = (c, str, x, y, sc, rgb) => calls.push({ text: str, rgb });
  G.textSga = (c, str, x, y, sc, rgb) => calls.push({ sga: str, rgb });
  H.drawItem = () => {};
  MCL.Input = { mx: -100, my: -100, down() { return false; } };
  H.w = 800; H.h = 600; H.scale = 2;
  const draw = (P, m) => { calls.length = 0; MCL.Player = P; H.enchantMenu = m; H.drawEnchanting({ fillStyle: '', fillRect() {} }); return calls.slice(); };
  const btn = (cs, i) => cs.find((k) => k.r && k.sheet === 'enchanting_table' && k.x === H.enchantOrigin.x + 60 * 2 && k.y === H.enchantOrigin.y + (14 + 19 * i) * 2);
  const P = newPlayer(30), m = table(P);
  let cs = draw(P, m);
  ok(cs.filter((k) => k.r && k.r.join() === '0,0,176,166').length === 1, 'the panel is the whole 176x166 sheet');
  ok([0, 1, 2].every((i) => btn(cs, i) && btn(cs, i).r.slice(0, 2).join() === '0,185'), 'an empty table draws three disabled buttons');
  ok(cs.filter((k) => k.sga !== undefined).length === 0, 'and no clue text');
  m.table.set(0, st('diamond_sword')); m.table.set(1, st('lapis_lazuli', 2)); M.enchantRefresh(m);
  cs = draw(P, m);
  ok(btn(cs, 0).r.slice(0, 2).join() === '0,166' && btn(cs, 1).r.slice(0, 2).join() === '0,166', 'two lapis and level 30: buttons 1 and 2 are enabled');
  ok(btn(cs, 2).r.slice(0, 2).join() === '0,185', 'button 3 needs three lapis: disabled');
  const sga = cs.filter((k) => k.sga !== undefined);
  const WORDS = new Set(H.ENCHANT_PHRASES);
  ok(sga.length === 3 && sga.every((k) => WORDS.has(k.sga.split(' ')[0]) && k.sga.length >= 5), `three Standard Galactic phrases starting with listed words, trimmed to the button (${sga.map((k) => k.sga).join(' | ')})`);
  const phraseSrc = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/client/gui/screen/ingame/EnchantingPhrases.java'), 'utf8');
    const listed = [...phraseSrc.matchAll(/^\s+"([a-z]+)"[,]?$/gm)].map((x) => x[1]);
  ok(listed.length > 60 && listed.join() === H.ENCHANT_PHRASES.join(), `the HUD's ${H.ENCHANT_PHRASES.length} phrase words are the decomp list, in order`);
  okAv(listed.slice().reverse().join() !== H.ENCHANT_PHRASES.join(), 'a reordered list would not match (the seeded draw indexes it)');
  const again = draw(P, m).filter((k) => k.sga !== undefined).map((k) => k.sga).join('|');
  ok(again === sga.map((k) => k.sga).join('|'), 'the same seed prints the same clue text every frame');
  m.seed = 99999; M.enchantRefresh(m);
  const other = draw(P, m).filter((k) => k.sga !== undefined).map((k) => k.sga).join('|');
  ok(other !== again, 'a new seed prints different text');
  const nums = draw(P, m).filter((k) => k.text !== undefined && /^\d+$/.test(k.text)).map((k) => +k.text);
  ok(nums.join() === m.offers.power.join(), `the level cost is printed on each button (${nums})`);
  // no levels: all disabled, with the grey level cost
  const Plow = newPlayer(0), mlow = table(Plow);
  mlow.table.set(0, st('diamond_sword')); mlow.table.set(1, st('lapis_lazuli', 3)); M.enchantRefresh(mlow);
  cs = draw(Plow, mlow);
  ok([0, 1, 2].every((i) => btn(cs, i).r.slice(0, 2).join() === '0,185'), 'at level 0 every button is disabled');
  ok(cs.filter((k) => k.r && k.r[1] === 239).length === 3, 'and the greyed level icons are drawn');
  okAv(btn(draw(P, m), 0).r[1] !== 185 && btn(cs, 0).r[1] === 185, 'the draw depends on the player level: the same table differs between level 30 and level 0');
  // tooltips
  const tip = H.enchantButtonTooltip(m, 1, 30, false);
  ok(tip && /\. \. \. \?$/.test(tip[0].text) && tip[0].text.length > 8, `the clue tooltip reads "X . . . ?" (${tip && tip[0].text})`);
  ok(tip[2].text === '2 Lapis Lazuli' && tip[3].text === '2 Enchantment Levels', `and names the cost (${tip.map((l) => l.text).join(' / ')})`);
  const tipLow = H.enchantButtonTooltip(m, 1, 3, false);
  ok(/^Level Requirement: \d+$/.test(tipLow[2].text) && tipLow[2].rgb === 0xFF5555, 'too few levels: a red Level Requirement line');
  const tipCr = H.enchantButtonTooltip(m, 1, 0, true);
  ok(tipCr.length === 1, 'creative: the clue only, no cost lines');
  const t1 = H.enchantButtonTooltip(m, 0, 30, false);
  ok(t1[2].text === '1 Lapis Lazuli' && t1[3].text === '1 Enchantment Level', 'button 1 says "1 Lapis Lazuli / 1 Enchantment Level" (the .one keys)');
}

// ═══════════ 6. enchant lines in tooltips, and the glint ═════════════════════════════════════════
say('\n6. tooltips and glint');
{
  const s = st('diamond_sword'); ET.addEnchantment(s, 'sharpness', 3); ET.addEnchantment(s, 'mending', 1); ET.addEnchantment(s, 'vanishing_curse', 1);
  const L = H.stackTooltipLines(s);
  ok(L.length === 8 && L[1].text === 'Sharpness III' && L[1].rgb === 0xAAAAAA, `level shown in numerals (${L.map((l) => l.text)})`);
  ok(L[2].text === 'Mending', 'a maxLevel-1 enchantment at level 1 shows no numeral');
  ok(L[3].text === 'Curse of Vanishing' && L[3].rgb === 0xFF5555, 'curses are red');
  const book = st('enchanted_book'); ET.addEnchantment(book, 'sharpness', 5, true);
  ok(H.stackTooltipLines(book)[1].text === 'Sharpness V', 'an enchanted book lists its StoredEnchantments');
  ok(H.stackTooltipLines(st('diamond_sword')).length === 5, 'a plain sword has its name and the four main-hand modifier lines (#365)');
  ok(H.stackHasGlint(s) && !H.stackHasGlint(st('diamond_sword')) && H.stackHasGlint(st('nether_star')) && H.stackHasGlint(st('enchanted_golden_apple')) && !H.stackHasGlint(st('golden_apple')),
     'glint: enchanted, stored, nether star and the god apple yes; plain sword and golden apple no');
  okAv(!H.stackHasGlint(st('iron_axe')) && H.stackHasGlint(s), 'the glint predicate separates an enchanted stack from the same item plain');
    ok(head.widthsSga && head.widthsSga.length === 256 && head.widthsSga[97] > 0 && head.widthsSga[32] === 4, 'the SGA width table is in the payload, letters inked, space 4');
  ok(sheet.enchant_glint && sheet.enchant_glint.w === 64 && sheet.ascii_sga && sheet.enchanting_table, 'the glint texture, SGA font and table sheet ship');
}

console.log('\n================ enchscreen ================');
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' breaks caught ...... ' + breaks);
if (fails.length) { fails.forEach((f) => console.log('   ✗ ' + f)); process.exitCode = 1; }
console.log('============================================');
