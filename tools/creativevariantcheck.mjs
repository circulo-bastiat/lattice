#!/usr/bin/env node
// creativevariantcheck.mjs — #506. The creative tabs and search carry the per-variant stacks vanilla's
// `Item.appendStacks` overrides make (PotionItem, TippedArrowItem, EnchantedBookItem), counted against the
// decompiled 1.18.2 sources (.decomp/), not against MC-Lite's own tables.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NS = {}; globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02g_items.js', '02i_text.js', '07z_potion.js',
                 '07p_trade.js', '14f_inventory.js', '14g_menu.js', '15e_creative.js']) {
  try { new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS); }
  catch (e) { console.log('load ' + f + ': ' + e.message); process.exit(1); }
}
const meta = JSON.parse(readFileSync(join(ROOT, 'assets/items.meta.json'), 'utf8'));
NS.Items.init({ items: readFileSync(join(ROOT, 'assets/items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
const Cr = NS.Creative, IT = NS.Items;

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

// ── the expectation, from the decompiled sources ──────────────────────────────────────────────
const D = join(ROOT, '.decomp/net/minecraft');
const potSrc = readFileSync(join(D, 'potion/Potions.java'), 'utf8');
const potions = [...potSrc.matchAll(/register\(\s*"([a-z_]+)",\s*new Potion\(([^;]*)\)\s*\);/g)]
  .map((m) => ({ id: m[1], effects: /new StatusEffectInstance/.test(m[2]) }));
const enSrc = readFileSync(join(D, 'enchantment/Enchantments.java'), 'utf8');
const ench = [...enSrc.matchAll(/"([a-z_]+)",\s*new (\w+Enchantment)\(/g)].map((m) => {
  let cls; try { cls = readFileSync(join(D, 'enchantment', m[2] + '.java'), 'utf8'); } catch { cls = ''; }
  const mx = cls.match(/getMaxLevel\(\)\s*\{\s*return (\d+);/);
  return { id: m[1], max: mx ? +mx[1] : 1 };
});
const enchBase = readFileSync(join(D, 'enchantment/Enchantment.java'), 'utf8');
ok(/getMaxLevel\(\)\s*\{\s*return 1;/.test(enchBase), 'Enchantment.getMaxLevel defaults to 1');
ok(potions.length >= 40 && ench.length >= 36, `parsed ${potions.length} potions, ${ench.length} enchantments`);

const kinds = ['potion', 'splash_potion', 'lingering_potion', 'tipped_arrow'];
function verify(label) {
  Cr.build(); Cr.query = '';
  const tagOf = (col, i) => Cr.tagPages[col][i];
  const inTab = (n) => { let c = 0; for (const col of Object.keys(Cr.pages)) if (+col !== Cr.SEARCH_COL) {
    Cr.pages[col].forEach((it, i) => { if (IT.names[it] === n) c++; }); } return c; };
  const inSearch = (n) => { let c = 0; Cr.pages[Cr.SEARCH_COL].forEach((it) => { if (IT.names[it] === n) c++; }); return c; };
  const withEff = potions.filter((p) => p.effects).length, allBut = potions.length - 1;
  for (const k of kinds) {
    const want = k === 'tipped_arrow' ? withEff : allBut;
    ok(inTab(k) === want, `${label}: ${k} tab stacks ${inTab(k)} != ${want}`);
    ok(inSearch(k) === want, `${label}: ${k} search stacks ${inSearch(k)} != ${want}`);
  }
  const bookSearch = ench.reduce((a, e) => a + e.max, 0);
  ok(inSearch('enchanted_book') === bookSearch, `${label}: search books ${inSearch('enchanted_book')} != ${bookSearch}`);
  const tabBooks = inTab('enchanted_book');
  ok(tabBooks > 0 && tabBooks <= 2 * ench.length, `${label}: tab books ${tabBooks} plausible`);
  // every book in a tab is the MAX level book
  let maxOnly = true;
  for (const col of Object.keys(Cr.pages)) if (+col !== Cr.SEARCH_COL) Cr.pages[col].forEach((it, i) => {
    if (IT.names[it] !== 'enchanted_book') return;
    const e = tagOf(col, i).StoredEnchantments[0], d = ench.find((x) => 'minecraft:' + x.id === e.id);
    if (!d || d.max !== e.lvl) maxOnly = false;
  });
  ok(maxOnly, `${label}: tab books are max-level books`);
  // hitAt hands back the tag; clickCell puts it on the stack
  Cr.setTab(10);
  const hit = Cr.hitAt(Cr.cellXY(0)[0] + 8, Cr.cellXY(0)[1] + 8);
  ok(hit && hit.kind === 'cell', `${label}: brewing cell 0 is a cell`);
  return { withEff, allBut, bookSearch };
}
verify('real');

// ── deliberate breaks: each must trip a failure ───────────────────────────────────────────────
function breakCase(name, mutate, restore) {
  const before = fails.length; mutate(); verify('break:' + name); restore();
  if (fails.length > before) { breaks++; console.log('   ✓ ' + name + ' is caught'); fails.length = before; }
  else fails.push('break not caught: ' + name);
}
const P = NS.Potion.POTIONS, E = NS.Trade.ENCH;
{ const saved = P.swiftness; breakCase('a potion missing from the registry', () => { delete P.swiftness; }, () => { P.swiftness = saved; }); }
{ const saved = E.sharpness.maxLevel; breakCase('sharpness capped at 1 (one book, not five)', () => { E.sharpness.maxLevel = 1; }, () => { E.sharpness.maxLevel = saved; }); }
{ const saved = Object.assign({}, P); breakCase('the whole potion registry gone (blank potions only)', () => { for (const k of Object.keys(P)) delete P[k]; }, () => { Object.assign(P, saved); }); }
{ const saved = Object.assign({}, E); breakCase('the enchantment roster gone (no books)', () => { for (const k of Object.keys(E)) delete E[k]; }, () => { Object.assign(E, saved); }); }

verify('restored');
console.log(`\n creativevariantcheck: ${pass} assertions, ${fails.length} failed (${breaks} breaks caught)`);
if (fails.length) { for (const f of fails) console.log('   x ' + f); process.exit(1); }
if (breaks < 3) process.exit(1);
