#!/usr/bin/env node
// creativecheck.mjs — PLAN G11b. The creative inventory: its tabs, its table and its geometry.
//
//   node tools/creativecheck.mjs [--verbose]
//
// ⚠ WHAT THIS EXISTS TO CATCH. The first draft of `15e_creative.js` classified 1,100 items into
// tabs with eight ordered regular expressions typed from memory, and every single thing about it
// was plausible: the tab names were real, the order looked like the game's, the regexes matched.
// It had eleven tabs instead of twelve, in the wrong order, with `hotbar` missing and `search`
// first instead of sixth — and NOTHING in the engine could have noticed, because a hand-written
// classification is its own authority. D-313 replaced it with the 1.18.2 bytecode's own table;
// this check is what stops that table from drifting back out of the shipped file.
//
// ⚠ THREE THINGS ARE HELD CLOSED HERE, each against a source this check did not write:
//   1. the SHIPPED `items.bin` against `tools/golden/creative-tabs-1.18.2.tsv`, both directions;
//   2. the RUNTIME's page model against the shipped table — every placed item in exactly one
//      page, and the search page exactly the union;
//   3. the measured GEOMETRY against `creative_items.png`'s and `creative_tabs.png`'s own pixels,
//      which is D-277's rule: a blit coordinate nobody asserts draws a plausible wrong screen.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src', ASSETS = MCLITE_ROOT + 'assets';
const VERBOSE = process.argv.includes('--verbose');

const NS = {};
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02f_tags.js', '02g_items.js', '02i_text.js',
                 '14f_inventory.js', '14g_menu.js', '15e_creative.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
NS.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
NS.Tags.init({ tags: readFileSync(join(ASSETS, 'tags.bin')).toString('base64'), tagsBytes: rdj('tags.meta.json').blobBytes });
NS.Text.init({ lang: readFileSync(join(ASSETS, 'lang.bin')).toString('base64'), langBytes: rdj('lang.meta.json').rawBytes,
               langOverrides: readFileSync(join(ASSETS, 'lang-overrides.json'), 'utf8') });
const IT = NS.Items, Cr = NS.Creative, Inv = NS.Inventory;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
let breaks = 0;
const okAv = (c, m) => { ok(c, m); if (c) breaks++; if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

console.log('creativecheck — PLAN G11b, the creative inventory (D-313)');

// ═══════════════ 1. the shipped table against the golden TSV ═══════════════════════════════
const GOLD = new Map();           // item -> column
const GOLD_TAB = new Map();       // column -> { lang, icon }
{
  const f = join(MCLITE_ROOT, 'tools', 'golden', 'creative-tabs-1.18.2.tsv');
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('# tabs: ')) {
      for (const t of line.slice(8).trim().split(' ')) {
        const m = t.match(/^(\d+)=([A-Za-z]+)\/([a-z0-9_]+)$/);
        if (m) GOLD_TAB.set(+m[1], { lang: m[2], icon: m[3] });
      }
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length >= 3) GOLD.set(c[0], +c[2]);
  }
}
console.log('\n 1. the shipped item table against tools/golden/creative-tabs-1.18.2.tsv');
ok(GOLD.size > 1000, `the golden table has ${GOLD.size} rows`);
ok(GOLD_TAB.size === 12, `the golden table names ${GOLD_TAB.size} tabs, vanilla has 12`);
ok(IT.ready && IT.count > 1000, `the item table must be loaded, count ${IT.count}`);
ok(!!IT.tabs && IT.tabs.length === 12, `items.bin carries ${IT.tabs ? IT.tabs.length : 0} tabs, not 12`);

// ⚠ BOTH DIRECTIONS. Every shipped item's byte must equal the golden column, and every golden
// row that names a shipped item must be accounted for — a table that shipped all-255 would
// otherwise pass a one-directional "no wrong answers" test perfectly.
{
  let checked = 0, placed = 0;
  for (let i = 0; i < IT.count; i++) {
    const name = IT.names[i];
    if (!GOLD.has(name)) { ok(false, `shipped item "${name}" is not in the golden table`); continue; }
    const want = GOLD.get(name);
    const got = IT.tabOf(i);
    ok(got === (want < 0 ? -1 : want),
       `${name} ships in column ${got} and the bytecode says ${want < 0 ? -1 : want}`);
    checked++;
    if (got >= 0) placed++;
  }
  for (const [name, col] of GOLD) {
    if (col < 0) continue;
    const i = IT.of(name);
    if (i < 0) continue;                       // `air` is not a real item; it has no row
    ok(IT.tabOf(i) === col, `golden row ${name}=${col} is not in the shipped table`);
  }
  console.log(`    ${checked} items compared, ${placed} placed in a tab`);
  ok(placed > 1000, `only ${placed} shipped items have a creative tab`);
  ok(checked - placed >= 10 && checked - placed <= 40,
     `${checked - placed} shipped items are in no tab — vanilla's list is seventeen long`);
}
// the strip itself: the columns, the lang keys and the icons
{
  const cols = IT.tabs.map((t) => t.col).sort((a, b) => a - b);
  ok(cols.join(',') === '0,1,2,3,4,5,6,7,8,9,10,11', `the shipped columns are ${cols.join(',')}`);
  for (const t of IT.tabs) {
    const g = GOLD_TAB.get(t.col);
    ok(!!g && t.lang === 'itemGroup.' + g.lang, `column ${t.col} ships lang "${t.lang}"`);
    ok(!!g && t.icon === g.icon, `column ${t.col} ships icon "${t.icon}", the bytecode says "${g ? g.icon : '?'}"`);
    ok(t.item >= 0 && IT.names[t.item] === t.icon, `column ${t.col}'s icon resolved to an item`);
  }
  ok(new Set(IT.tabs.map((t) => t.icon)).size === 12, 'two tabs ship the same icon');
}

// ═══════════════ 2. the runtime's page model ═══════════════════════════════════════════════
console.log('\n 2. the page model NS.Creative builds from it');
Cr.build();
ok(Cr.ready, 'NS.Creative.build() readies the model');
{
  const seen = new Map();
  let sum = 0;
  for (const t of Cr.tabs) {
    if (t.col === Cr.SEARCH_COL) continue;
    const page = Cr.pages[t.col];
    ok(Array.isArray(page), `column ${t.col} has a page`);
    for (const i of page) {
      ok(!seen.has(i), `${IT.names[i]} is on two pages (${seen.get(i)} and ${t.col})`);
      seen.set(i, t.col);
      ok(IT.tabOf(i) === t.col, `${IT.names[i]} is on page ${t.col} and its byte says ${IT.tabOf(i)}`);
    }
    sum += page.length;
  }
  // ⚠ the three VIEW tabs must hold nothing of their own — `search` is the union, and `hotbar`
  // and `inventory` are other screens. An item on one of them is a table that drifted.
  ok((Cr.pages[Cr.HOTBAR_COL] || []).length === 0, 'the hotbar tab is a view and holds no item of its own');
  ok((Cr.pages[Cr.INVENTORY_COL] || []).length === 0, 'the inventory tab is a view and holds no item of its own');
  const search = Cr.pages[Cr.SEARCH_COL];
  ok(search.length === sum, `the search page holds ${search.length} and the eleven homes hold ${sum}`);
  ok(new Set(search).size === search.length, 'the search page repeats an item');
  for (const i of search) ok(IT.tabOf(i) >= 0, `${IT.names[i]} is in the search page and in no tab`);
  console.log(`    ${sum} items over ${Cr.tabs.length - 3} home tabs; search holds ${search.length}`);
  // the anchors, at the level a player would notice
  const wantIn = [['stone', 'buildingBlocks'], ['torch', 'decorations'], ['repeater', 'redstone'],
    ['minecart', 'transportation'], ['apple', 'food'], ['diamond_pickaxe', 'tools'],
    ['diamond_sword', 'combat'], ['potion', 'brewing'], ['stick', 'misc']];
  for (const [n, lang] of wantIn) {
    const i = IT.of(n);
    const col = IT.tabOf(i);
    const t = Cr.tabs.filter((x) => x.col === col)[0];
    ok(!!t && t.lang === 'itemGroup.' + lang, `${n} is in ${t ? t.lang : '(none)'}, not itemGroup.${lang}`);
  }
}
// the search box
{
  Cr.setTab(Cr.SEARCH_COL);
  const all = Cr.items().length;
  Cr.query = 'diamond';
  const some = Cr.items();
  ok(some.length > 0 && some.length < all, `"diamond" narrows ${all} items to ${some.length}`);
  for (const i of some) ok(IT.names[i].indexOf('diamond') >= 0, `"${IT.names[i]}" matched "diamond"`);
  // vanilla: localized names, case-folded, and '#tag' searches (issue #505)
  Cr.query = 'diamond pickaxe';
  ok(Cr.items().some((i) => IT.names[i] === 'diamond_pickaxe'), '"diamond pickaxe" finds diamond_pickaxe');
  Cr.query = 'oak planks';
  ok(Cr.items().some((i) => IT.names[i] === 'oak_planks'), '"oak planks" finds oak_planks');
  Cr.query = '#logs';
  const logs = Cr.items().map((i) => IT.names[i]);
  ok(logs.includes('oak_log'), '"#logs" finds oak_log');
  ok(logs.length > 0 && !logs.includes('diamond_pickaxe'), '"#logs" holds only tag members');
  Cr.query = '';
  Cr.key('KeyA', 'a'); Cr.query = 'x'.repeat(50); Cr.key('KeyA', 'a');
  ok(Cr.query.length === 50, 'the search box caps at 50 characters');
  Cr.query = 'zzzznotathing';
  ok(Cr.items().length === 0, 'a query that matches nothing shows nothing');
  Cr.query = '';
  ok(Cr.items().length === all, 'clearing the query restores every item');
  // ⚠ the query only filters on the SEARCH tab; typing then switching tabs must not hide blocks.
  Cr.query = 'diamond';
  Cr.setTab(0);
  ok(Cr.items().length === Cr.pages[0].length, 'a stale query does not filter the building blocks tab');
  Cr.query = '';
}

// ═══════════════ 2b. the sixty items nothing can draw ══════════════════════════════════════
// ⚠ THIS IS THE ONLY PLACE IN THE ENGINE THAT KNOWS THE CREATIVE INVENTORY HAS BLANK SLOTS IN
// IT. Sixty items are `builtin/entity` in vanilla — chests, shulker boxes, beds, banners, heads,
// the conduit and the shield — with no item sprite and no block model, drawn by a block-entity
// renderer that is G17c. The set is held closed in BOTH directions: a sixty-first blank slot is
// a failing check, and an entry that starts drawing is one too, because the list would then be
// lying about a gap that had closed.
console.log('\n 2b. the items with no sprite and no model (OWED to G17c)');
{
  const blank = [];
  for (let i = 0; i < IT.count; i++) {
    const layers = IT.layerOff[i + 1] - IT.layerOff[i];
    if (layers === 0 && !IT.isBlock(i)) blank.push(IT.names[i]);
  }
  const named = new Set(Cr.NO_ICON);
  console.log(`    ${blank.length} items have neither an item sprite nor a block model`);
  ok(blank.length === Cr.NO_ICON.length,
     `${blank.length} items draw nothing and Creative.NO_ICON names ${Cr.NO_ICON.length}`);
  for (const n of blank) ok(named.has(n), `"${n}" draws nothing and is not in Creative.NO_ICON`);
  for (const n of Cr.NO_ICON) {
    ok(blank.indexOf(n) >= 0, `Creative.NO_ICON names "${n}", which draws something now`);
    ok(IT.of(n) >= 0, `Creative.NO_ICON names "${n}", which is not an item`);
  }
  // ⚠ and the shape of the set, so a wholesale change is caught even if the list is edited to
  // match it: they are the block entities, and nothing that is merely a normal block.
  for (const n of ['stone', 'oak_planks', 'furnace', 'crafting_table', 'torch', 'oak_sign'])
    ok(blank.indexOf(n) < 0, `${n} draws something and must not be on the blank list`);
  // ⚠ THE SURVIVAL INVENTORY TAB'S OWN ICON IS ONE OF THEM, which is why that tab looks empty.
  const invTab = Cr.tabs.filter((t) => t.col === Cr.INVENTORY_COL)[0];
  ok(!!invTab && invTab.icon === 'chest', `the inventory tab's icon is ${invTab && invTab.icon}`);
  ok(named.has('chest'), "...and it is on the owed list, which is why that tab draws no icon");
  // the OWED note must SAY so, in words, rather than the number living only here
  ok(Cr.OWED.join(' ').indexOf('60') >= 0 || Cr.OWED.join(' ').indexOf('sixty') >= 0,
     'Creative.OWED does not mention the sixty blank items');
}

// ═══════════════ 3. the geometry, against the textures' own pixels ═════════════════════════
console.log('\n 3. the geometry, measured off the sheets rather than remembered');
const SHEETS = (() => {
  const guiMeta = JSON.parse(readFileSync(join(ASSETS, 'gui.meta.json'), 'utf8'));
  const bytes = inflateRawSync(readFileSync(join(ASSETS, 'gui.bin')));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hlen = dv.getUint32(0, true);
  const head = JSON.parse(bytes.subarray(4, 4 + hlen).toString('latin1'));
  const base = 4 + hlen;
  const out = {};
  for (const sh of head.sheets) out[sh.n] = { w: sh.w, h: sh.h, off: base + sh.o };
  return { out, bytes, guiMeta };
})();
const texel = (name, x, y) => {
  const sh = SHEETS.out[name];
  if (!sh || x < 0 || y < 0 || x >= sh.w || y >= sh.h) return [0, 0, 0, 0];
  const o = sh.off + (y * sh.w + x) * 4;
  return [SHEETS.bytes[o], SHEETS.bytes[o + 1], SHEETS.bytes[o + 2], SHEETS.bytes[o + 3]];
};
const isSlot = (name, x, y) => {
  const p = texel(name, x, y);
  return p[3] === 255 && p[0] === 139 && p[1] === 139 && p[2] === 139;
};
ok(!!SHEETS.out.creative_items, 'creative_items ships in gui.bin');
ok(!!SHEETS.out.creative_tabs, 'creative_tabs ships in gui.bin');
ok(!!SHEETS.out.creative_search, 'creative_search ships in gui.bin');
ok(!!SHEETS.out.creative_inv, 'creative_inv ships in gui.bin');
{
  // every one of the 45 picker cells and the 9 hotbar slots must land on the texture's own
  // 0x8B8B8B slot interior, at all four corners of the 16x16 icon area
  let cells = 0;
  for (let k = 0; k < Cr.PER_PAGE; k++) {
    const [x, y] = Cr.cellXY(k);
    const good = isSlot('creative_items', x, y) && isSlot('creative_items', x + 15, y)
              && isSlot('creative_items', x, y + 15) && isSlot('creative_items', x + 15, y + 15);
    ok(good, `picker cell ${k} at ${x},${y} is not on a slot in creative_items`);
    if (good) cells++;
  }
  for (let k = 0; k < 9; k++) {
    const [x, y] = Cr.hotXY(k);
    ok(isSlot('creative_items', x, y) && isSlot('creative_items', x + 15, y + 15),
       `hotbar slot ${k} at ${x},${y} is not on a slot in creative_items`);
  }
  console.log(`    ${cells}/45 picker cells and 9 hotbar slots sit on the texture's own slots`);
  // ⚠ AND THE OTHER DIRECTION: one pixel outside the grid must NOT be slot grey, or "is it a
  // slot" would be true everywhere and the test above would prove nothing.
  ok(!isSlot('creative_items', Cr.GRID[0] - 2, Cr.GRID[1] - 2), 'above-left of the grid is not slot grey');
  ok(!isSlot('creative_items', Cr.GRID[0] + Cr.COLS * Cr.SLOT + 1, Cr.GRID[1]),
     'right of the last column is not slot grey');
  // ⚠ THE SCROLLBAR TRACK IS DRAWN IN THE SAME 0x8B8B8B AS A SLOT INTERIOR — it is a recessed
  // well, not a different colour — so "is it slot grey" cannot tell the two apart and the track
  // has to be located by its POSITION instead: the grey run that starts right of the ninth
  // column, with a gap between them. Asserting it was "not a slot" was a guess about the art,
  // and it was wrong.
  const runAt = (y) => {
    const runs = []; let start = -1;
    for (let x = 0; x <= Cr.W; x++) {
      const g = x < Cr.W && isSlot('creative_items', x, y);
      if (g && start < 0) start = x;
      else if (!g && start >= 0) { runs.push([start, x - start]); start = -1; }
    }
    return runs;
  };
  const row = runAt(Cr.GRID[1] + 2);
  ok(row.length === Cr.COLS + 1,
     `row ${Cr.GRID[1] + 2} has ${row.length} grey runs — nine slots and one scrollbar track`);
  for (let k = 0; k < Cr.COLS; k++) {
    ok(row[k] && row[k][0] === Cr.cellXY(k)[0], `grey run ${k} starts at ${row[k] && row[k][0]}, not ${Cr.cellXY(k)[0]}`);
  }
  const track = row[Cr.COLS];
  ok(!!track && track[0] === Cr.SCROLL[0], `the scrollbar track starts at ${track && track[0]}, not ${Cr.SCROLL[0]}`);
  ok(!!track && track[1] === Cr.SCROLL[2], `the scrollbar track is ${track && track[1]} wide, not ${Cr.SCROLL[2]}`);
  ok(!!track && track[0] > Cr.cellXY(Cr.COLS - 1)[0] + 16, 'the track abuts the last column');
  // ⚠ THE PANEL IS 195x136 WITH ITS FOUR CORNERS CUT. `(194,135)` is one of the cut pixels and
  // asserting it opaque was a guess about the art; what is true of every panel is that the edge
  // is opaque AWAY from the corners and that nothing at all is drawn outside 195x136.
  ok(texel('creative_items', Cr.W - 2, Cr.H - 2)[3] === 255, 'the panel is opaque just inside its corner');
  ok(texel('creative_items', Cr.W - 1, Cr.H >> 1)[3] === 255, 'the panel is opaque along its right edge');
  ok(texel('creative_items', Cr.W >> 1, Cr.H - 1)[3] === 255, 'the panel is opaque along its bottom edge');
  for (let y = 0; y < 256; y++) ok(texel('creative_items', Cr.W, y)[3] === 0, `column ${Cr.W} is not empty at y=${y}`);
  for (let x = 0; x < 256; x++) ok(texel('creative_items', x, Cr.H)[3] === 0, `row ${Cr.H} is not empty at x=${x}`);
}
{
  // the scroller handle, both states, in creative_tabs
  const S = Cr.SCROLLER, O = Cr.SCROLLER_OFF;
  let on = 0, off = 0;
  for (let y = 0; y < S[3]; y++) for (let x = 0; x < S[2]; x++) {
    if (texel('creative_tabs', S[0] + x, S[1] + y)[3] === 255) on++;
    if (texel('creative_tabs', O[0] + x, O[1] + y)[3] === 255) off++;
  }
  ok(on === S[2] * S[3], `the enabled scroller is ${on} of ${S[2] * S[3]} opaque pixels`);
  ok(off === O[2] * O[3], `the disabled scroller is ${off} of ${O[2] * O[3]} opaque pixels`);
  // ⚠ ...AND THEY MUST DIFFER. Two rects that happen to name the same sprite would pass the two
  // counts above and give a game whose scrollbar never looks greyed.
  let diff = 0;
  for (let y = 0; y < S[3]; y++) for (let x = 0; x < S[2]; x++) {
    const a = texel('creative_tabs', S[0] + x, S[1] + y), b = texel('creative_tabs', O[0] + x, O[1] + y);
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) diff++;
  }
  ok(diff > 20, `the two scroller sprites differ in only ${diff} pixels`);
}
{
  // the four tab states must be four different pictures
  const states = [[0, 0], [0, 32], [0, 64], [0, 96]];
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
    let diff = 0;
    for (let y = 0; y < Cr.TAB_H; y++) for (let x = 0; x < Cr.TAB_W; x++) {
      const p = texel('creative_tabs', states[a][0] + x, states[a][1] + y);
      const q = texel('creative_tabs', states[b][0] + x, states[b][1] + y);
      if (p[0] !== q[0] || p[1] !== q[1] || p[2] !== q[2] || p[3] !== q[3]) diff++;
    }
    ok(diff > 8, `tab states ${a} and ${b} differ in only ${diff} pixels`);
  }
}
{
  // tabRect: twelve buttons, none overlapping its row neighbours, the last pinned right
  for (const sel of [0, 5, 6, 11]) {
    Cr.tab = sel;
    const seen = [];
    for (let col = 0; col < 12; col++) {
      const r = Cr.tabRect(col);
      const top = col < 6;
      ok(r[1] === (top ? -Cr.TAB_W : Cr.H - 4), `column ${col} is on the ${top ? 'top' : 'bottom'} row`);
      ok(r[3] === (top ? 0 : 64) + (col === sel ? 32 : 0),
         `column ${col} draws texture row ${r[3]} with ${sel} selected`);
      ok(r[2] === (col % 6) * Cr.TAB_W, `column ${col} draws texture column ${r[2] / Cr.TAB_W}`);
      ok(r[0] >= 0 && r[0] + Cr.TAB_W <= Cr.W, `column ${col} at x=${r[0]} hangs off the panel`);
      seen.push([col, r[0]]);
    }
    for (let col = 0; col < 12; col++) {
      if (col % 6 === 5) ok(seen[col][1] === Cr.W - Cr.TAB_W, `column ${col} is not pinned to the right edge`);
      if (col % 6 > 0) ok(seen[col][1] >= seen[col - 1][1] + Cr.TAB_W, `columns ${col - 1} and ${col} overlap`);
    }
  }
  Cr.tab = 0;
  // tabAt is tabRect's inverse, on every button's centre and on a point between the rows
  for (let col = 0; col < 12; col++) {
    const r = Cr.tabRect(col);
    ok(Cr.tabAt(r[0] + 14, r[1] + 16) === col, `tabAt misses the centre of column ${col}`);
  }
  ok(Cr.tabAt(Cr.W * 0.5, Cr.H * 0.5) === -1, 'tabAt claims the middle of the panel');
}

// ═══════════════ 4. what a click does ══════════════════════════════════════════════════════
console.log('\n 4. the clicks');
{
  const P = { instabuild: true, inventory: Inv.create(), syncHotbar() {} };
  P.menu = NS.Menu.playerMenu(P.inventory, P);
  Cr.setTab(0);
  const stoneIx = IT.of('stone');
  const cur = () => NS.Menu.getCarried(P.menu);
  const stoneN = () => { const c = cur(); return c && c.i === stoneIx ? c.n : 0; };
  ok(Cr.clickCell(stoneIx, false, P, 0), 'clicking a cell with an empty hand does something');
  ok(stoneN() === 1, `empty cursor + click carries ONE (${stoneN()})`);
  Cr.clickCell(stoneIx, false, P, 0);
  ok(stoneN() === 2, `same item: left click +1 (${stoneN()})`);
  Cr.clickCell(stoneIx, false, P, 2);
  ok(stoneN() === 1, `same item: right click -1 (${stoneN()})`);
  Cr.clickCell(stoneIx, true, P, 0);
  ok(stoneN() === IT.maxStack(stoneIx), `same item: shift fills the cursor (${stoneN()})`);
  Cr.clickCell(stoneIx, false, P, 0);
  ok(stoneN() === IT.maxStack(stoneIx), 'left click never exceeds the max stack');
  Cr.clickCell(IT.of('dirt'), false, P, 2);
  ok(cur() && cur().i === stoneIx && cur().n === IT.maxStack(stoneIx) - 1, 'different item: right click takes 1 off');
  // ⚠ THE PICKER IS ALSO THE BIN — vanilla's rule, and the reason creative has no trash slot.
  Cr.clickCell(IT.of('dirt'), false, P, 0);
  ok(cur() === null, 'different item: left click destroys the cursor stack');
  Cr.clickCell(IT.of('cobblestone'), true, P, 0);
  ok(cur() && cur().n === 64 && Inv.countOf(P.inventory, 'cobblestone') === 0,
     'shift on an empty cursor: full stack on the CURSOR, inventory untouched');
  NS.Menu.setCarried(P.menu, null);
  Cr.clickCell(stoneIx, false, P, 1);
  ok(stoneN() === IT.maxStack(stoneIx), 'middle click (CLONE) puts a full stack on an empty cursor');
  Cr.clickCell(IT.of('dirt'), false, P, 1);
  ok(stoneN() === IT.maxStack(stoneIx), 'CLONE does nothing while carrying');
  NS.Menu.setCarried(P.menu, null);
  Cr.swapCell(IT.of('cobblestone'), 3, P);
  const sl = Inv.getItem ? Inv.getItem(P.inventory, 3) : null;
  ok(!sl || sl.n === 64, 'SWAP sets the hotbar slot to a full stack');
  Cr.clickCell(IT.of('cobblestone'), false, P, 2);
  ok(cur() && cur().n === 1, 'right click on an EMPTY cursor still picks up one (vanilla checks empty-cursor first)');
  NS.Menu.setCarried(P.menu, null);
  // a one-item stack stays a one-item stack
  Cr.clickCell(IT.of('diamond_sword'), false, P);
  const sw = NS.Menu.getCarried(P.menu);
  ok(sw && sw.n === 1, 'a sword comes off the list one at a time, because its stack size is 1');
  NS.Menu.setCarried(P.menu, null);
  // #500: the survival tab's delete slot exists on that tab only; click clears cursor, shift-click clears all
  Cr.setTab(0);
  ok(!Cr.hitAt(Cr.DELETE[0] + 2, Cr.DELETE[1] + 2) || Cr.hitAt(Cr.DELETE[0] + 2, Cr.DELETE[1] + 2).kind !== 'delete', 'no delete slot off the survival tab');
  // #553: the survival tab re-seats the player menu (CreativeInventoryScreen ctor) and stays on this screen
  Cr.setTab(Cr.INVENTORY_COL);
  const at = (i) => { const q = Cr.menuSlotXY(i); return Cr.hitAt(q[0] + 2, q[1] + 2); };
  ok(Cr.menuSlotXY(5).join() === '54,6' && Cr.menuSlotXY(6).join() === '54,33' && Cr.menuSlotXY(7).join() === '108,6' &&
     Cr.menuSlotXY(8).join() === '108,33' && Cr.menuSlotXY(45).join() === '35,20', 'armour/offhand seats are vanilla\'s');
  ok(Cr.menuSlotXY(9).join() === '9,54' && Cr.menuSlotXY(35).join() === '153,90', 'main inventory seats 9,54..');
  ok(at(20).kind === 'slot' && at(20).slot === 20 && at(6).slot === 6 && at(45).slot === 45, 'hitAt finds menu slots on the survival tab');
  Cr.setTab(0);
  ok(!Cr.menuSlotXY(0) && at(5) === null || at(5).kind !== 'slot', 'no menu slots off the survival tab');
  Inv.setItem(P.inventory, 2, Inv.stack('gravel', 3));
  NS.Menu.setCarried(P.menu, null);
  const hb = Cr.hitAt(Cr.hotXY(2)[0] + 2, Cr.hotXY(2)[1] + 2);
  ok(Cr.hotbarKey(0, hb, P) && Inv.countOf(P.inventory, 'gravel') === 3 && !Inv.getItem(P.inventory, 2),
     'digit over a hotbar slot swaps it with that hotbar slot (search-tab key path)');
  ok(!Cr.hotbarKey(0, null, P), 'digit with no slot focused does nothing');
  Inv.setItem(P.inventory, 0, null);
  Cr.setTab(Cr.INVENTORY_COL);
  Cr.setTab(Cr.INVENTORY_COL);
  const dh = Cr.hitAt(Cr.DELETE[0] + 2, Cr.DELETE[1] + 2);
  ok(dh && dh.kind === 'delete', 'the survival tab has a delete slot at 173,112');
  Inv.setItem(P.inventory, 3, Inv.stack('gravel', 5));
  NS.Menu.setCarried(P.menu, Inv.stack('dirt', 2));
  Cr.clickDelete(false, P);
  ok(NS.Menu.getCarried(P.menu) === null && Inv.countOf(P.inventory, 'gravel') === 5, 'delete slot click clears only the cursor');
  Cr.clickDelete(true, P);
  ok(Inv.countOf(P.inventory, 'gravel') === 0, 'shift-click on the delete slot wipes the inventory');
  Cr.setTab(0);
  // the hotbar band: slot 0 of the panel is playerMenu slot 36, not slot 0
  Inv.setItem(P.inventory, 0, Inv.stack('gravel', 7));
  Cr.clickHotbar(0, 0, false, P);
  const got = NS.Menu.getCarried(P.menu);
  ok(got && IT.names[got.i] === 'gravel' && got.n === 7,
     'clicking panel hotbar slot 0 picks up what inventory slot 0 holds');
  NS.Menu.setCarried(P.menu, null);
}
{
  // hitAt: a cell past the end of the list is nothing, not an item
  Cr.setTab(Cr.BREWING_COL === undefined ? 10 : Cr.BREWING_COL);
  Cr.scroll = 0;
  const n = Cr.items().length;
  const first = Cr.cellXY(0), last = Cr.cellXY(Cr.PER_PAGE - 1);
  ok(Cr.hitAt(first[0] + 8, first[1] + 8).kind === 'cell', 'the first cell of a short tab is a cell');
  if (n < Cr.PER_PAGE) ok(Cr.hitAt(last[0] + 8, last[1] + 8) === null,
    `cell 44 of a ${n}-item tab is empty and must not be clickable`);
  // scrolling is clamped to whole pages
  Cr.setTab(0);
  Cr.scroll = 99999; Cr.clampScroll();
  ok(Cr.scroll === Cr.maxScroll(), 'scroll clamps to the last row');
  Cr.scroll = -5; Cr.clampScroll();
  ok(Cr.scroll === 0, 'scroll clamps to the first row');
  ok(Cr.maxScroll() > 0, 'the building blocks tab has more than one page');
  Cr.setTab(Cr.HOTBAR_COL);
  ok(Cr.maxScroll() === 0 && !Cr.canScroll(), 'an empty tab has nothing to scroll');
  Cr.setTab(0);
}
{
  // the search box's keys
  Cr.setTab(Cr.SEARCH_COL);
  Cr.query = '';
  ok(Cr.searching, 'opening the search tab focuses the box');
  ok(Cr.key('KeyD', 'd') && Cr.query === 'd', 'a letter goes into the box');
  Cr.key('KeyI', 'I');
  ok(Cr.query === 'di', 'a capital is folded to lower case, because the item names are');
  ok(Cr.key('Backspace') && Cr.query === 'd', 'backspace takes one off');
  ok(!Cr.key('F3'), 'a function key is not text and is not consumed');
  Cr.query = '';
  Cr.setTab(0);
  ok(!Cr.searching && !Cr.key('KeyD', 'd'), 'the box only takes keys on its own tab');
}

// ═══════════════ 5. anti-vacuity (D-30) ════════════════════════════════════════════════════
// ⚠ EVERY SECTION ABOVE BREAKS ITS OWN DATA HERE AND THE BREAK MUST BE CAUGHT. A check that
// cannot fail is a check that has measured nothing, and this file's whole job is to notice a
// table that quietly went wrong — which is exactly what a break proves it can do.
console.log('\n 5. anti-vacuity — each section is broken and the break must be caught');
{
  // §1: move one item to the wrong tab
  const i = IT.of('stone');
  const was = IT.tab[i];
  IT.tab[i] = (was + 1) % 12;
  okAv(IT.tabOf(i) !== GOLD.get('stone'), 'anti-vacuity: a single item moved to the wrong tab is caught');
  IT.tab[i] = was;
  ok(IT.tabOf(i) === GOLD.get('stone'), 'the break is undone');
}
{
  // §1: the whole table blanked — the failure a one-directional check would sail through
  const saved = IT.tab.slice();
  IT.tab.fill(255);
  let placed = 0;
  for (let k = 0; k < IT.count; k++) if (IT.tabOf(k) >= 0) placed++;
  okAv(placed === 0, 'anti-vacuity: an items.bin whose every tab byte is "none" is caught');
  IT.tab.set(saved);
}
{
  // §2: two pages claiming the same item
  Cr.build();
  const page = Cr.pages[0];
  const stolen = Cr.pages[1][0];
  page.push(stolen);
  const seen = new Set(); let dup = false;
  for (const t of Cr.tabs) {
    if (t.col === Cr.SEARCH_COL) continue;
    for (const q of (Cr.pages[t.col] || [])) { if (seen.has(q)) dup = true; seen.add(q); }
  }
  okAv(dup, 'anti-vacuity: an item on two pages is caught');
  Cr.build();
}
{
  // §2b: an item added to the blank list that is not blank
  const named = new Set(Cr.NO_ICON.concat(['stone']));
  const i = IT.of('stone');
  okAv((IT.layerOff[i + 1] - IT.layerOff[i]) > 0 || IT.isBlock(i),
       'anti-vacuity: stone DOES draw, so adding it to the blank list would be caught');
}
{
  // §3: a slot origin off by one pixel — the drift this section exists to notice
  const wasX = Cr.GRID[0];
  Cr.GRID[0] = wasX + 1;
  const [x, y] = Cr.cellXY(0);
  okAv(!isSlot('creative_items', x + 15, y), 'anti-vacuity: a grid origin one pixel right is caught');
  Cr.GRID[0] = wasX;
  ok(isSlot('creative_items', Cr.cellXY(0)[0] + 15, Cr.cellXY(0)[1]), 'the break is undone');
}
{
  // §3: the right-edge pin removed — the case an even `col * 28` would produce
  const wasW = Cr.W;
  Cr.W = 168;
  const r = Cr.tabRect(5);
  okAv(r[0] !== wasW - Cr.TAB_W, 'anti-vacuity: a strip whose last tab is not right-pinned is caught');
  Cr.W = wasW;
}
{
  // §4: the hotbar band moved back to 0..8, which is the crafting grid
  const P = { instabuild: true, inventory: Inv.create(), syncHotbar() {} };
  P.menu = NS.Menu.playerMenu(P.inventory, P);
  Inv.setItem(P.inventory, 0, Inv.stack('gravel', 7));
  NS.Menu.doClick(P.menu, 0 + 0, 0, NS.Menu.PICKUP, P);      // the WRONG band
  okAv(NS.Menu.getCarried(P.menu) === null,
       'anti-vacuity: clicking menu slot 0 finds the crafting result, not the hotbar');
  NS.Menu.doClick(P.menu, 36 + 0, 0, NS.Menu.PICKUP, P);     // the right one
  ok(NS.Menu.getCarried(P.menu) !== null, 'and menu slot 36 does find it');
}
{
  // #500: a plain delete click must not wipe the inventory
  const P = { instabuild: true, inventory: Inv.create(), syncHotbar() {} };
  P.menu = NS.Menu.playerMenu(P.inventory, P);
  Inv.setItem(P.inventory, 3, Inv.stack('gravel', 5));
  NS.Menu.setCarried(P.menu, Inv.stack('dirt', 2));
  Cr.clickDelete(false, P);
  okAv(Inv.countOf(P.inventory, 'gravel') === 5, 'anti-vacuity: a plain delete click that wiped the inventory would be caught');
}
{
  // §4: a cell past the end of the list handing back an item anyway
  Cr.setTab(0); Cr.scroll = Cr.maxScroll();
  const n = Cr.items().length;
  const lastCell = n - Cr.scroll * Cr.COLS;
  if (lastCell < Cr.PER_PAGE) {
    const p = Cr.cellXY(lastCell);
    okAv(Cr.hitAt(p[0] + 8, p[1] + 8) === null,
         'anti-vacuity: the first empty cell past the end of the last page is not clickable');
  } else {
    ok(true, 'the last page is exactly full; nothing to assert');
  }
  Cr.scroll = 0;
}

{
  // §5: scrollbar mapping is vanilla's (y - 7.5) / 97, and a drag follows the pointer
  Cr.setTab(0);
  const m = Cr.maxScroll();
  ok(m > 0, 'tab 0 has more than one page');
  const top = Cr.SCROLL[1];
  const at = (y) => { Cr.scrollTo(Cr.trackFrac(y)); return Cr.scroll; };
  ok(at(top + 7.5) === 0 && at(top) === 0, 'press above the handle centre: row 0');
  ok(at(top + 7.5 + 97) === m && at(top + 112) === m, 'press at the bottom of the track: max row');
  const y = top + 7.5 + 97 * 0.5;
  ok(at(y) === Math.floor(0.5 * m + 0.5), 'the middle maps to (int)(0.5*(rows-5)+0.5)');
  // the old one-shot formula must be distinguishable from vanilla's, or this proves nothing
  const oldRow = (yy) => Math.max(0, Math.min(m, Math.round(((yy - top) / 112) * m)));
  let differs = 0;
  for (let yy = top; yy <= top + 112; yy += 1) if (oldRow(yy) !== at(yy)) differs++;
  okAv(differs > 0, 'anti-vacuity: the old (y-top)/112 formula lands on a different row than vanilla');
  // a drag sequence: the handle centre follows the pointer, and rows only grow going down
  let prev = -1, mono = true;
  for (let yy = top; yy <= top + 112; yy += 2) { const r = at(yy); if (r < prev) mono = false; prev = r; }
  ok(mono && prev === m, 'a drag from the top to the bottom of the track is monotonic and ends on the max row');
  Cr.dragging = false; Cr.scroll = 0;
}

// ═══════════════ report ════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(78));
console.log(` breaks caught ...... ${breaks}`);
console.log(` creativecheck: ${pass} assertions, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('   x ' + f);
  process.exit(1);
}
console.log(' the creative inventory matches the 1.18.2 bytecode and the sheets it is drawn on.');
