#!/usr/bin/env node
// enchtable.mjs — PLAN G22b (#194). The enchanting TABLE as a block in a world: the bookshelf count
// `Hud.openEnchanting` reads off `World.getBlock` (EnchantingTableBlock.BOOKSHELF_OFFSETS +
// `canAccessBookshelf`: a bookshelf at the offset AND `isAir` on the cell half way), and the player's
// `enchantmentTableSeed` (EnchantmentScreenHandler: offers are a function of the seed, which only
// `applyEnchantmentCosts` re-rolls, and which crosses a save as `XpSeed`).
//
//   node tools/enchtable.mjs [--verbose]
//
// enchscreen.mjs owns the screen, the roll and the economy; this file drives the same modules through
// the real `Hud.openEnchanting` over a fake world. Every section breaks the code it tests and shows the
// assertion catch it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const say = (s) => { if (VERBOSE) console.log(s); };

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '02i_text.js', '14f_inventory.js', '14d_survival.js',
               '07ox_enchhelper.js', '07oy_enchtable.js', '14g_menu.js', '07c_blockentity.js', '13_input.js', '15b_gui.js', '15_hud.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
MCL.Text.init({ lang: b64('lang.bin'), langBytes: rdj('lang.meta.json').rawBytes,
                langOverrides: readFileSync(join(ASSETS, 'lang-overrides.json'), 'utf8') });

const Inv = MCL.Inventory, M = MCL.Menu, H = MCL.Hud, ET = MCL.EnchTable, Sv = MCL.Survival, S = MCL.States;
const st = (n, c) => Inv.stack(n, c === undefined ? 1 : c);

// A deterministic Math.random, so "the offers changed after an enchant" is a fixed fact, not a 1-in-n flake.
let rs = 12345;
Math.random = () => { rs = (Math.imul(rs, 1103515245) + 12345) >>> 0; return rs / 4294967296; };

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

console.log('enchtable — PLAN G22b, the enchanting table block: bookshelf line of sight and the table seed');

// ── a world: a table at the origin, a bookshelf on each of the 16 table-height offsets ──────────────
const cells = new Map();
const put = (x, y, z, n) => cells.set(x + ',' + y + ',' + z, S.stateOf(n));
MCL.World = { getBlock: (x, y, z) => cells.get(x + ',' + y + ',' + z) || 0 };
put(0, 0, 0, 'enchanting_table');
for (const o of ET.BOOKSHELF_OFFSETS) if (o[1] === 0) put(o[0], 0, o[2], 'bookshelf');

const newPlayer = (lvl) => {
  const P = { menu: { inventory: Inv.create() }, xpTotal: 0, instabuild: false, dropped: [], dropStack(s) { this.dropped.push(s); } };
  Sv.fromJSON(P, null);
  P.xpTotal = Sv.totalXpFor(lvl); Sv.syncXp(P);
  MCL.Player = P;
  return P;
};
/** Open the table the way `EnchantingTableBlock.use` does, put `item` + 3 lapis in, read the menu. */
const look = (item) => {
  H.openEnchanting(0, 0, 0);
  const m = H.enchantMenu;
  m.table.set(0, item || st('diamond_sword')); m.table.set(1, st('lapis_lazuli', 3));
  M.enchantRefresh(m);
  return m;
};
const shut = () => { H.enchantMenu.table.set(0, null); H.enchantMenu.table.set(1, null); H.close(); };
const offersOf = (m) => JSON.stringify(m.offers);

// ═══════════ 1. bookshelf power, through Hud.openEnchanting and World.getBlock ════════════════════
say('\n1. bookshelves in a world');
/** The table's shelf count and top-button level with the cell (1,0,0) holding `between`. */
function withBetween(between) {
  put(1, 0, 0, between);
  const m = look(); const r = { shelves: m.shelves, top: m.offers.power[2] }; shut();
  cells.delete('1,0,0');
  return r;
}
{
  newPlayer(30);
  const open = withBetween('air'), torch = withBetween('torch'), cave = withBetween('cave_air');
  ok(H.screen === null, 'the screen closed between looks');
  ok(open.shelves === 16, `16 shelves seen across air (got ${open.shelves})`);
  ok(open.top >= 30, `16 shelves cap at 15 -> the top button asks >= 30 levels (got ${open.top})`);
  ok(torch.shelves === 13, `a torch on (1,0,0) hides the three shelves behind it: (2,0,-1) (2,0,0) (2,0,1) (got ${torch.shelves})`);
  ok(torch.top < open.top && torch.top <= 27, `and the power falls: 13 shelves top out at 8+6+13 = 27 (got ${torch.top} from ${open.top})`);
  ok(cave.shelves === 16, `cave_air is air (\`isAir\`), so it hides nothing (got ${cave.shelves})`);
  put(2, 1, 0, 'bookshelf');
  const upper = withBetween('torch');
  cells.delete('2,1,0');
  ok(upper.shelves === 14, `a torch at table height does not hide the shelf one up (y=1 has its own midpoint; got ${upper.shelves})`);

  // break 1: `canAccessBookshelf` without its air term
  const src = readFileSync(join(MCLITE_ROOT, 'src/07oy_enchtable.js'), 'utf8');
  const fn = /ET\.countBookshelves = (function \(blockAt, x, y, z\) \{[\s\S]*?\n  \});/.exec(src)[1];
  const noLos = fn.replace(/ &&\s*ET\.isAirName\([^\n]*\)\)\) n\+\+/, ') n++');
  ok(noLos !== fn, 'the LOS term was found in the source to strip');
  const real = ET.countBookshelves;
  ET.countBookshelves = new Function('ET', 'OFFSETS', 'return ' + noLos)(ET, ET.BOOKSHELF_OFFSETS);
  const t2 = withBetween('torch');
  ET.countBookshelves = real;
  okAv(t2.shelves === 16 && t2.shelves !== torch.shelves, 'with the LOS term removed the torch hides nothing, so "the power falls" above fails');

  // break 2: `isAir` read as the air block only
  const realAir = ET.isAirName;
  ET.isAirName = (n) => n === 'air';
  const c2 = withBetween('cave_air');
  ET.isAirName = realAir;
  okAv(c2.shelves === 13, 'reading isAir as "the air block" hides shelves behind cave_air, so the cave_air assertion fails');
}

// ═══════════ 2. the seed: stable across reopens and a save, re-rolled by an enchant ════════════════
say('\n2. enchantmentTableSeed');
/** true when the sword's offers are the same on a second look and different after one enchant. */
function seedContract(P) {
  const a = offersOf(look()); shut();
  const b = offersOf(look()); shut();
  const m = look(); const before = offersOf(m), seed0 = P.enchantSeed;
  if (!M.enchantClick(m, P, 0)) return { stable: a === b, clicked: false };
  shut();
  const after = offersOf(look()); shut();
  return { stable: a === b && b === before, clicked: true, changed: after !== before, seedMoved: P.enchantSeed !== seed0 };
}
{
  const P = newPlayer(30);
  ok(typeof P.enchantSeed === 'number', 'a new player has a seed (`random.nextInt()` at construction)');
  const r = seedContract(P);
  ok(r.stable, 'the same item shows the same three offers across a close and reopen');
  ok(r.clicked, 'button 1 enchants');
  ok(r.seedMoved, 'the enchant drew a new player seed');
  ok(r.changed, 'and the next sword is offered something else');

  // the seed crosses a save (`XpSeed`)
  const m = look(); const before = offersOf(m); shut();
  const saved = JSON.parse(JSON.stringify(Sv.toJSON(P)));
  ok(saved.enchantSeed === P.enchantSeed, 'Survival.toJSON writes the seed');
  const P2 = newPlayer(30);
  Sv.fromJSON(P2, saved);
  ok(P2.enchantSeed === P.enchantSeed, 'Survival.fromJSON reads it back');
  const after = offersOf(look()); shut();
  ok(after === before, 'so a reloaded player sees the table offer exactly what it offered before the save');
  const P3 = newPlayer(30), P4 = newPlayer(30);
  ok(P3.enchantSeed !== P4.enchantSeed, 'two fresh players do not share one default seed');
  Sv.fromJSON(P3, { enchantSeed: 'x' });
  ok(typeof P3.enchantSeed === 'number' && isFinite(P3.enchantSeed), 'a hostile seed loads as a number');

  // break 3: a seed that an enchant does not move
  const realNew = ET.newSeed;
  const P5 = newPlayer(30);
  ET.newSeed = () => P5.enchantSeed;
  const r5 = seedContract(P5);
  ET.newSeed = realNew;
  okAv(r5.clicked && !r5.changed, 'with the seed fixed after an enchant the offers repeat, so "offered something else" fails');

  // break 4: a seed that is not saved
  const realTo = Sv.toJSON;
  Sv.toJSON = (e) => { const o = realTo(e); delete o.enchantSeed; return o; };
  const P6 = newPlayer(30), s6 = P6.enchantSeed;
  const P7 = newPlayer(30); Sv.fromJSON(P7, Sv.toJSON(P6));
  Sv.toJSON = realTo;
  okAv(P7.enchantSeed !== s6, 'dropping the seed from the save re-rolls it on load, so "reads it back" fails');
}

console.log('\n================ enchtable ================');
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' breaks caught ...... ' + breaks);
if (fails.length) { fails.forEach((f) => console.log('   ✗ ' + f)); process.exitCode = 1; }
console.log('===========================================');
