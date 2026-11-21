#!/usr/bin/env node
// creative11621check.mjs — #11621 (AUDIT-MAP). 15e_creative.js: CreativeInventoryScreen (tabs, scroll, search),
// SearchManager (name/id/#tag search), TippedArrowItem (tipped arrows only for potions with effects); entry points.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
const meta = JSON.parse(readFileSync(join(ROOT, 'assets/items.meta.json'), 'utf8'));
function run(patch) {
  const f = []; const ok = (c, m) => { if (!c) f.push(m); };
  try {
    const NS = {}; globalThis.MCL = NS;
    for (const n of ['00_ns.js', '01_util.js', '01b_inflate.js', '02g_items.js', '02i_text.js', '07z_potion.js', '07p_trade.js', '14f_inventory.js', '14g_menu.js', '14g2_invclasses.js', '14p_search.js', '15e_creative.js']) {
      let t = rd(n); if (patch && n === '15e_creative.js') t = patch(t);
      new Function('MCL', t)(NS);
    }
    NS.Items.init({ items: readFileSync(join(ROOT, 'assets/items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
    const C = NS.Creative, IT = NS.Items, Po = NS.Potion.POTIONS;
    C.build(); C.query = '';
    ok(C.ready && C.total > 500, 'built');
    // TippedArrowItem: one arrow per potion with effects, none for empty / effect-less
    const ti = IT.index['tipped_arrow'], col = IT.tabOf(ti);
    const arrows = (C.pages[col] || []).map((x, k) => [x, C.tagPages[col][k]]).filter((p) => p[0] === ti);
    const eff = Object.keys(Po).filter((k) => k !== 'empty' && Po[k].effects.length);
    ok(arrows.length === eff.length && eff.length > 20, 'tipped arrow count ' + arrows.length + '/' + eff.length);
    ok(arrows.every((a) => a[1] && /^minecraft:/.test(a[1].Potion)) && !arrows.some((a) => a[1].Potion === 'minecraft:empty' || a[1].Potion === 'minecraft:water'), 'tipped arrow tags');
    const pots = (C.pages[IT.tabOf(IT.index['potion'])] || []).filter((x) => x === IT.index['potion']).length;
    ok(pots === Object.keys(Po).length - 1, 'potion count');
    // search tab = every placed item with variants
    ok(C.pages[C.SEARCH_COL].length === C.total, 'search total');
    C.setTab(C.SEARCH_COL); ok(C.tab === C.SEARCH_COL && C.searching && C.scroll === 0, 'setTab search');
    C.query = 'tipped'; ok(C.items().length === eff.length && C.items().every((i) => i === ti), 'search id');
    C.query = 'minecraft:diamond_sword'; ok(C.items().length === 1 && IT.names[C.items()[0]] === 'diamond_sword', 'search id prefix');
    C.query = 'DIAMOND_SWORD'; ok(C.items().some((i) => IT.names[i] === 'diamond_sword'), 'search case-insens');
    C.query = 'zzzqq'; ok(C.items().length === 0, 'search none');
    NS.Tags = { ready: true, names: () => ['minecraft:swords'], items: () => ['minecraft:diamond_sword'] };
    C.query = '#swords'; ok(C.items().length === 1 && IT.names[C.items()[0]] === 'diamond_sword', 'tag search');
    C.query = '#nothing'; ok(C.items().length === 0, 'tag search miss'); delete NS.Tags;
    C.query = '';
    // scrolling
    ok(C.maxScroll() === Math.ceil(C.total / C.COLS) - C.ROWS && C.canScroll(), 'maxScroll');
    C.scroll = 9999; C.clampScroll(); ok(C.scroll === C.maxScroll(), 'clampScroll hi');
    C.scroll = -5; C.clampScroll(); ok(C.scroll === 0, 'clampScroll lo');
    C.scroll = 3; ok(C.setTab(col) && C.scroll === 0 && C.tab === col && !C.searching && !C.setTab(9999), 'setTab item / invalid');
    ok(C.MAX_QUERY === 50 && C.COLS === 9 && C.ROWS === 5 && C.W === 195, 'constants');
    ok(C.SEARCH.join() === '82,6,80,9' && C.GRID.join() === '9,18', 'geometry');
  } catch (e) { f.push('threw ' + e.message); }
  return f;
}
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const hud = rd('15_hud.js'), inp = rd('13_input.js');
if (!/NS\.Creative/.test(hud) || !/Cr\.build|Creative\.build/.test(hud + inp + rd('17_main.js') + rd('15b_gui.js'))) { console.log('FAIL entry point not wired'); process.exit(1); }
const muts = [
  ['tipped effects', (t) => t.replace("name === 'tipped_arrow' && !Po[potionIds[k]].effects.length", 'false')],
  ['skip empty', (t) => t.replace("if (potionIds[k] === 'empty') continue;", '')],
  ['search id', (t) => t.replace("String(IT.names[list[i]]).indexOf(idq) >= 0 ||", '')],
  ['search lower', (t) => t.replace('var q = C.query.toLowerCase();', 'var q = C.query;')],
  ['tag branch', (t) => t.replace("q.charAt(0) === '#'", 'false')],
  ['max query', (t) => t.replace('C.MAX_QUERY = 50', 'C.MAX_QUERY = 60')],
  ['maxScroll', (t) => t.replace('Math.ceil(n / C.COLS) - C.ROWS', 'Math.ceil(n / C.COLS)')],
  ['clamp hi', (t) => t.replace('if (C.scroll > m) C.scroll = m;', '')],
  ['clamp lo', (t) => t.replace('if (C.scroll < 0) C.scroll = 0;', '')],
  ['setTab scroll', (t) => t.replace('C.scroll = 0;\n    C.searching', 'C.searching')],
  ['setTab searching', (t) => t.replace('C.searching = (col === C.SEARCH_COL);', 'C.searching = false;')],
  ['search all', (t) => t.replace('C.pages[C.SEARCH_COL] = all;', 'C.pages[C.SEARCH_COL] = [];')],
  ['potion variants', (t) => t.replace("name === 'potion' ||", 'false ||')],
  ['geometry', (t) => t.replace('C.SEARCH = [82, 6, 80, 9]', 'C.SEARCH = [80, 6, 80, 9]')],
];
let caught = 0; const missed = [];
for (const [name, fn] of muts) {
  let changed = true; const f = run((t) => { const o = fn(t); if (o === t) changed = false; return o; });
  if (!changed) { console.log('FAIL mutant did not change source: ' + name); process.exit(1); }
  if (f.length) { caught++; console.log('   ✓ cutting ' + name + ' fails: ' + f[0].slice(0, 70)); } else { missed.push(name); console.log('  FAIL cutting ' + name + ' went unnoticed'); }
}
console.log(` assertions passed .. ${muts.length + 1}`);
console.log(` failures ........... ${missed.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(missed.length ? 1 : 0);
