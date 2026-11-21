#!/usr/bin/env node
// writtenbookcheck.mjs - #8067: WrittenBookItem tooltip per generation 0..3, getName, isValid, BookScreen 114px wrap, page turns.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const M = loadEngine({ extra: ['02i_text.js', '14n_book.js'], dom: false });
M.Text.init({ lang: readFileSync(join(A, 'lang.bin')).toString('base64'), langBytes: JSON.parse(readFileSync(join(A, 'lang.meta.json'), 'utf8')).rawBytes,
              langOverrides: readFileSync(join(A, 'lang-overrides.json'), 'utf8') });
const GEN = ['Original', 'Copy of original', 'Copy of a copy', 'Tattered'];   // en_us book.generation.0..3
const measure = (s) => s.length * 6;   // fixed 6px glyphs: 114px = 19 chars per line
const stack = (g, extra) => ({ t: Object.assign({ title: 'T', author: 'Bob', pages: ['x'], generation: g }, extra) });
const verdict = (B, gens) => {
  const bad = [];
  for (let g = 0; g < 4; g++) {
    const tip = B.tooltip(stack(g)).map((l) => l.text);
    if (tip.join('|') !== 'by Bob|' + gens[g]) bad.push('tooltip gen ' + g + ': ' + tip.join('|'));
  }
  if (B.tooltip({}).length) bad.push('no NBT must give no tooltip');
  if (B.tooltip(stack(0, { author: '  ' })).length !== 1) bad.push('blank author line must be skipped');
  if (B.name(stack(0, { title: 'Hello' })) !== 'Hello' || B.name(stack(0, { title: ' ' })) !== null) bad.push('getName');
  if (!B.isValid(stack(0).t) || B.isValid({ pages: [], author: 'a' }) || B.isValid({ pages: [], title: 'x'.repeat(33), author: 'a' }) ||
      B.isValid({ pages: ['y'.repeat(32768)], title: 't', author: 'a' }) || B.isValid({ pages: [], title: 't' })) bad.push('isValid');
  const w = B.wrap('aaaa bbbb cccc dddd eeee ffff\nzz', 114, measure).join('|');
  if (w !== 'aaaa bbbb cccc dddd |eeee ffff|zz') bad.push('wrap: ' + w);
  const w2 = B.wrap('x'.repeat(40), 114, measure).join('|');
  if (w2 !== 'x'.repeat(19) + '|' + 'x'.repeat(19) + '|xx') bad.push('long word wrap: ' + w2);
  const r = B.open({ t: { title: 't', author: 'a', pages: ['1', '2'] } });
  if (!r || B.backVisible(r) || !B.nextVisible(r) || B.indicator(r) !== 'Page 1 of 2') bad.push('open/indicator: ' + (r && B.indicator(r)));
  else {
    const a = B.turn(r, 1), b = B.turn(r, 1);
    if (!a || b || r.page !== 1 || r.sounds.length !== 1 || r.sounds[0] !== 'item.book.page_turn') bad.push('page turn / clamp / sound');
  }
  if (B.open({ t: { pages: ['x'] } })) bad.push('an invalid book must not open');
  return bad;
};
const B = M.Book, bad = verdict(B, GEN);
const BREAKS = [
  ['generation string changed', verdict(B, ['Original', 'Copy of original', 'Copy of a copy', 'Torn'])],
  ['gen 1 string changed', verdict(B, ['Original', 'Copy', 'Copy of a copy', 'Tattered'])],
  ['wrap width 108', (() => { const o = B.wrap; B.wrap = (t, w, m) => o(t, 108, m); try { return verdict(B, GEN); } finally { B.wrap = o; } })()],
  ['no page sound', (() => { const o = B.PAGE_TURN_SOUND; B.PAGE_TURN_SOUND = 'x'; try { return verdict(B, GEN); } finally { B.PAGE_TURN_SOUND = o; } })()],
  ['title limit 40', (() => { const o = B.MAX_TITLE_LENGTH; B.MAX_TITLE_LENGTH = 40; try { return verdict(B, GEN); } finally { B.MAX_TITLE_LENGTH = o; } })()],
];
let caught = 0;
for (const [n, b] of BREAKS) { if (b.length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of bad) console.log(' FAIL:', x);
console.log(`writtenbookcheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(bad.length || caught < BREAKS.length ? 1 : 0);
