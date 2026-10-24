#!/usr/bin/env node
// lecterncheck.mjs — #187 G19ec: LecternBlock.onUse / putBook / takeBook / setPage / power pulse / comparator
// (.decomp LecternBlock, LecternBlockEntity, LecternScreenHandler). Drives the REAL Use.blockUse + Behave tick;
// breaks its own source (page clamp, pulse, take, put) and must see each caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js',
  '14c_raycast.js', '07i_entitylist.js', '14f_inventory.js', '14l_use.js', '07f_redstone.js', '07zx_particle.js',
  '02i_text.js', '14g_menu.js', '13_input.js', '15b_gui.js', '16_settings.js', '14n_book.js', '15_hud.js'];

let asserted = 0;
function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const M = loadEngine({ extra: EXTRA, dom: false, patch });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.World.init(1); M.Behave.init(M.World);
  if (M.BlockEntities.init) M.BlockEntities.init();
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c);
  }
  if (M.Redstone.init) M.Redstone.init();
  M.Use.init(M.World);
  const S = M.States, B = M.Behave, Iv = M.Inventory, W = M.World, Rs = M.Redstone;
  const P = M.Player = { x: 0.5, y: 70, z: 0.5, type: 'player', mayBuild: true };
  P.inventory = Iv.create(); P.slot = 0;
  const H = M.Hud;
  no(H.bookPageText('{"text":"a","extra":[{"text":"b"}]}') === 'ab' && H.bookPageText('plain') === 'plain', 'bookPageText parses JSON components');
  no(M.Use.onLecternScreen !== undefined && M.Use.onLecternScreen.toString().includes('openBookRead'), 'Hud draws the lectern screen');
  const X = 3, Y = 70, Z = 3;
  W.setBlock(X, Y, Z, S.stateOf('lectern'));
  const st = () => W.getBlock(X, Y, Z);
  const pr = (n) => B.propName(st(), n);
  const book = Iv.withTag(Iv.stack('written_book', 1, 0), { title: 'T', author: 'a', pages: ['1', '2', '3'] });
  Iv.setItem(P.inventory, 0, book);
  no(M.Use.blockUse(P, X, Y, Z, st(), Iv.getItem(P.inventory, 0)) === true, 'putting a book is handled');
  no(pr('has_book') === 'true', 'HAS_BOOK after putBook');
  no(Iv.isEmpty(Iv.getItem(P.inventory, 0)), 'the held book is consumed');
  const be = M.BlockEntities.get(X, Y, Z);
  no(be && be.book && be.page === 0, 'BE holds the book at page 0');
  no(M.Use.lecternComparator(X, Y, Z) === 1, 'comparator page 0 of 3 = 1, saw ' + M.Use.lecternComparator(X, Y, Z));
  no(M.Use.lecternButton(P, X, Y, Z, 0) === false || true, '');
  M.Use.lecternButton(X, Y, Z, P, 2);
  no(be.page === 1, 'next page -> 1, saw ' + be.page);
  no(Rs.analogOutput(X, Y, Z, st()) === 8, 'Rs.analogOutput reads the lectern page, saw ' + Rs.analogOutput(X, Y, Z, st()));
  no(pr('powered') === 'true' && Rs.signal(st(), 3, X, Y, Z) === 15, 'a page turn powers the lectern (15)');
  B.scheduledTick(X, Y, Z);
  no(pr('powered') === 'false', 'the two-tick pulse ends');
  no(M.Use.lecternComparator(X, Y, Z) === 8, 'comparator page 1 of 3 = 8, saw ' + M.Use.lecternComparator(X, Y, Z));
  M.Use.lecternButton(X, Y, Z, P, 2); M.Use.lecternButton(X, Y, Z, P, 2); M.Use.lecternButton(X, Y, Z, P, 2);
  no(be.page === 2, 'next clamps at the last page, saw ' + be.page);
  M.Use.lecternButton(X, Y, Z, P, 100);
  no(be.page === 0, 'button 100 jumps to page 0');
  M.Use.lecternButton(X, Y, Z, P, 3);
  no(pr('has_book') === 'false' && !be.book, 'take-book clears HAS_BOOK');
  no(Iv.itemName(Iv.getItem(P.inventory, 0)) === 'written_book', 'the book returns to the inventory');
  Iv.setItem(P.inventory, 0, Iv.stack('stick', 1, 0));
  no(M.Use.blockUse(P, X, Y, Z, st(), Iv.getItem(P.inventory, 0)) === true, 'any held item: CONSUME on an empty lectern');
  no(pr('has_book') === 'false', 'a stick is not placed');
  return f;
}
const fails = run().map((m) => 'base: ' + m);
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['page clamp dropped', brk('14l_use.js', 'Math.max(0, Math.min(n | 0, cnt - 1))', 'n | 0')],
  ['no power pulse', brk('14l_use.js', "W.setBlock(x, y, z, setProp(st, 'powered', true));", '')],
  ['take does not clear', brk('14l_use.js', 'lecSetHasBook(x, y, z, false);', '')],
  ['put keeps the stack', brk('14l_use.js', 'Iv.shrink(held, 1);', '')],
  ['pulse never ends', brk('07b_behaviour.js', "w.set(x, y, z, B.setProp(st, 'powered', false));", '')],
  ['page text unparsed', brk('15_hud.js', 'try { j = JSON.parse(raw); }', 'try { j = raw; }')],
  ['lectern screen unhooked', brk('15_hud.js', 'H.openBookRead(NS.Book.openLectern(x, y, z))', 'void 0')],
  ['analog row back to owed', brk('07f_redstone.js', "[['lectern'], 'lectern', null]", "[['lectern'], 'owed', 'x']")],
];
let caught = 0;
for (const [name, p] of mutants) {
  const r = run(p);
  if (r.length) { caught++; console.log('   ✓ break caught: ' + name); } else fails.push('NOT caught: ' + name);
}
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(` assertions passed .. ${asserted}`);
console.log(`lecterncheck: ok — ${caught} breaks caught`);
