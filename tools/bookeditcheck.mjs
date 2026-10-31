#!/usr/bin/env node
// bookeditcheck.mjs — #8066: WritableBookItem.use / BookEditScreen limits / onBookUpdate signing (.decomp).
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(MCLITE_ROOT + 'assets/' + f, 'utf8'));
const b64 = (f) => readFileSync(MCLITE_ROOT + 'assets/' + f).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07f_redstone.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '14c_raycast.js', '14e_gamemode.js', '14i_hand.js', '14l_use.js', '07zze_oxidize.js', '07zx_particle.js'];
const BREAK = process.argv.includes('--break');
const mk = (patch) => { const M = loadEngine({ extra: EXTRA, dom: false, patch }); M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes }); return M; };
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
function run(patch) {
  const NS = mk(patch), Iv = NS.Inventory, U = NS.Use, B = U.Book;
  const P = { inventory: { slots: new Array(Iv.SIZE).fill(Iv.EMPTY) }, slot: 0, name: 'Dev' };
  Iv.setItem(P.inventory, 0, Iv.stack('writable_book', 1, 0));
  const res = [];
  const t = (c, m) => res.push(c ? null : m);
  t(U.bookStart(P, Iv.getItem(P.inventory, 0)) && P.bookScreen.slot === 0, 'use opens screen');
  const out = B.update(P, 0, ['hello', 'world'], 'Title');
  t(out && NS.Items.nameOf(out.i) === 'written_book', 'signed is written_book');
  const tg = out && out.t;
  t(tg && tg.title === 'Title' && tg.author === 'Dev' && tg.generation === 0 && JSON.stringify(tg.pages) === JSON.stringify(['"hello"', '"world"']), 'sign NBT fields');
  t(B.update(P, 5, ['x'], 'T') === null, 'empty slot refused');
  Iv.setItem(P.inventory, 1, Iv.stack('writable_book', 1, 0));
  t(B.update(P, 1, ['x'], 'a'.repeat(16)) === null, 'title 16 refused');
  t(B.update(P, 1, ['x'], 'a'.repeat(15)) !== null, 'title 15 ok');
  Iv.setItem(P.inventory, 2, Iv.stack('writable_book', 1, 0));
  const many = new Array(150).fill('p');
  const o2 = B.update(P, 2, many, undefined);
  t(o2 && o2.t.pages.length === 100, 'pages capped at 100');
  let pg = new Array(100).fill('');
  t(B.addPage(pg).length === 100, 'page 101 refused');
  t(B.addPage(new Array(99).fill('')).length === 100, 'page 100 ok');
  t(B.type(['a'.repeat(1022)], 0, 'b')[0].length === 1023, 'char 1023 ok');
  t(B.type(['a'.repeat(1023)], 0, 'b')[0].length === 1023, 'char 1024 refused');
  t(B.isValid({ pages: ['a'.repeat(32767)] }) && !B.isValid({ pages: ['a'.repeat(32768)] }) && !B.isValid({}) && !B.isValid(null), 'isValid');
  // screen flow: type, add page, sign with trimmed title, trailing empty pages dropped, untouched = no packet
  Iv.setItem(P.inventory, 3, Iv.stack('writable_book', 1, 0));
  P.slot = 3; U.bookStart(P, Iv.getItem(P.inventory, 3));
  const sc = P.bookScreen;
  t(B.finish(P, sc, false) === null, 'clean screen sends nothing');
  B.input(sc, 'h'); B.nextPage(sc); B.nextPage(sc);
  t(sc.pages.length === 3 && sc.page === 2, 'next page appends');
  sc.signing = true; for (const ch of '  Ti ') B.input(sc, ch); B.backspace(sc);
  const o3 = B.finish(P, sc, true);
  t(o3 && o3.t.title === 'Ti' && o3.t.pages.length === 1 && o3.t.pages[0] === '"h"', 'finish signs trimmed, drops empty pages');
  const sc2 = { slot: 0, pages: [''], title: '', page: 0, signing: true, dirty: false };
  for (let i = 0; i < 20; i++) B.input(sc2, 'x');
  t(sc2.title.length === 15, 'title field stops at 15');
  return res.filter(Boolean);
}
const base = run();
base.forEach((m) => ok(false, m));
const breaks = [
  ['14l_use.js', 'MAX_PAGES: 100', 'MAX_PAGES: 101'],
  ['14l_use.js', 'text.length < Book.MAX_PAGE_CHARS', 'text.length <= Book.MAX_PAGE_CHARS'],
  ['14l_use.js', 'MAX_TITLE: 15', 'MAX_TITLE: 16'],
  ['14l_use.js', 'tag.generation = 0;', 'tag.generation = 1;'],
];
let caught = 0;
for (const [f, a, b] of breaks) {
  let hit = false;
  const r = run((file, src) => { if (file === f && src.includes(a)) { hit = true; return src.replace(a, b); } return src; });
  ok(hit, 'break matched ' + a);
  if (r.length) caught++; else ok(false, 'break not caught: ' + a);
}
console.log(`${14 + caught} assertions, ${fails} failures; ${caught} breaks caught`);
process.exit(fails ? 1 : 0);
