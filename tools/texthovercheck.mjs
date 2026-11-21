// tools/texthovercheck.mjs - #8238: JSON text hoverEvent (show_text / show_item / show_entity) on the open chat screen.
// Parse into Style, inheritance into children, the hit test on a WRAPPED chat line, no tooltip with chat closed. Anti-vacuity below.
import { readFileSync } from 'node:fs';
const SRC = (f) => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
const load = (patchChat, patchText) => {
  const NS = {}; globalThis.MCL = NS;
  new Function('MCL', SRC('00_ns.js'))(NS); new Function('MCL', SRC('01_util.js'))(NS);
  new Function('MCL', patchText(SRC('02i_text.js')))(NS);
  new Function('MCL', patchChat(SRC('15c_chat.js')))(NS);
  return NS;
};
const verdict = (patchChat, patchText) => {
  const bad = [], NS = load(patchChat, patchText), T = NS.Text, C = NS.Chat;
  const J = (o) => T.fromJson(o);
  const t = J({ text: 'hi', hoverEvent: { action: 'show_text', contents: { text: 'tip\nline2', color: 'red' } } });
  const h = t.style && t.style.hoverEvent;
  if (!h || h.action !== 'show_text' || T.plain(h.value) !== 'tip\nline2') bad.push('show_text not parsed into Style');
  const ls = h && T.hoverLines(h);
  if (!ls || ls.length !== 2 || ls[1].text !== 'line2') bad.push('show_text must split into tooltip lines');
  const it = J({ text: 'x', hoverEvent: { action: 'show_item', contents: { id: 'minecraft:stone', count: 3 } } }).style.hoverEvent;
  if (it.action !== 'show_item' || it.value.id !== 'minecraft:stone' || it.value.Count !== 3) bad.push('show_item not parsed');
  if (T.hoverLines(it, (v) => [{ text: v.id, rgb: 1 }])[0].text !== 'minecraft:stone') bad.push('show_item must use the item tooltip lines');
  const en = J({ text: 'x', hoverEvent: { action: 'show_entity', contents: { type: 'minecraft:pig', id: 'uuid-1', name: { text: 'Bob' } } } }).style.hoverEvent;
  const el = T.hoverLines(en);
  if (en.action !== 'show_entity' || el.length !== 3 || el[0].text !== 'Bob' || el[2].text !== 'uuid-1') bad.push('show_entity needs name, type, uuid lines');
  let threw = false; try { J({ text: 'x', hoverEvent: { action: 'nope', contents: 'a' } }); } catch (e) { threw = !!e.json; }
  if (!threw) bad.push('unknown action must be rejected');
  if (T.JSON_OWED.includes('hoverEvent')) bad.push('hoverEvent still in JSON_OWED');
  // inheritance
  const par = J({ text: 'A', hoverEvent: { action: 'show_text', contents: 'T' }, extra: [{ text: 'B' }, { text: 'C', hoverEvent: { action: 'show_text', contents: 'Own' } }] });
  const runs = T.runs(par);
  if (!runs[1].style || !runs[1].style.hoverEvent || T.plain(runs[1].style.hoverEvent.value) !== 'T') bad.push('child must inherit the parent hoverEvent');
  if (T.plain(runs[2].style.hoverEvent.value) !== 'Own') bad.push('child hoverEvent must override');
  // hit test on a wrapped line (width 6 px per char without the font): 60 chars of A, then hovered B wraps
  C.WIDTH = 100;
  C.add(J([{ text: 'aaaa aaaa aaaa aaaa aaaa ' }, { text: 'bbbb', hoverEvent: { action: 'show_text', contents: 'B tip' } }]));
  const L = C.lines.length, H = 200, rowY = (row) => H + C.BOTTOM - (row + 1) * C.LINE + 2;
  if (L < 2) bad.push('fixture did not wrap');
  C.open = true;
  const hit = (row, gx) => { const s = C.styleAt(gx, rowY(row), H); return !!(s && s.hoverEvent); };
  if (!hit(0, C.LEFT + 70)) bad.push('the wrapped last line (bbbb) must be hit');
  if (hit(0, C.LEFT + 90)) bad.push('right of the text must not be hit');
  if (hit(1, C.LEFT + 3)) bad.push('the first wrapped line has no event');
  C.open = false;
  if (C.styleAt(C.LEFT + 70, rowY(0), H)) bad.push('no tooltip with chat closed');
  return bad;
};
const same = (s) => s;
const BREAKS = [
  ['unwrapped hit test', (c) => c.replace('var vis = C.visible();', 'var vis = [{ runs: C.messages[C.messages.length - 1] ? NS.Text.runs(C.messages[C.messages.length - 1].component) : [] }];'), same],
  ['style not inherited', same, (s) => s.replace("'obfuscated', 'hoverEvent', 'clickEvent']", "'obfuscated']")],
  ['hit test ignores closed chat', (c) => c.replace('if (!C.open) return null;\n    var row', 'var row'), same],
];
const real = verdict(same, same); let caught = 0;
for (const [n, pc, pt] of BREAKS) { let r; try { r = verdict(pc, pt); } catch (e) { r = [String(e)]; } if (r.length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`texthovercheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
