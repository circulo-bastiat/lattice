#!/usr/bin/env node
// text11596check.mjs — #11596 (AUDIT-MAP). 02i_text.js's component classes, driven through the real
// entry points (T.fromJson / T.runs / T.resolve / T.resolveScores / T.parseHover / T.hoverLines /
// T.blockName), then re-run against mutants of the source that cut each one: every cut must be noticed.
//   WallBannerBlock  (getDescriptionId = the standing banner's)   HoverEvent   KeybindText   NbtText
//   ScoreText        SelectorText        Texts (parse/join/resolve)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/02i_text.js'), 'utf8');
const A = (f) => readFileSync(join(ROOT, 'assets', f));
const meta = JSON.parse(A('lang.meta.json'));

function load(src) {
  const NS = {}; globalThis.MCL = NS;
  for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js']) new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS);
  new Function('MCL', src)(NS);
  NS.Text.init({ lang: A('lang.bin').toString('base64'), langBytes: meta.rawBytes, langOverrides: A('lang-overrides.json').toString('utf8') });
  return NS;
}
const plain = (T, c) => T.runs(c).map((r) => r.text).join('');
const throws = (f) => { try { f(); return false; } catch (e) { return !!e.json; } };

// returns the list of failed assertion names
let N = 0;
function run(src) {
  const NS = load(src), T = NS.Text, f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    // WallBannerBlock
    ok(T.blockName('red_wall_banner') === 'Red Banner', 'WallBannerBlock named by standing banner');
    // KeybindText
    NS.Input = { BINDINGS: { 'key.jump': 'key.keyboard.space', 'key.inventory': 'key.keyboard.e', 'key.attack': 'key.mouse.0' } };
    const kb = T.fromJson({ keybind: 'key.inventory' });
    ok(plain(T, kb) === 'E', 'KeybindText renders bound key glyph');
    ok(plain(T, T.fromJson({ keybind: 'key.attack' })) === T.translate('key.mouse', ['1']), 'KeybindText mouse button');
    ok(plain(T, T.fromJson({ keybind: 'key.nobody' })) === 'key.nobody', 'KeybindText unknown id renders as itself');
    NS.Input.BINDINGS['key.inventory'] = 'key.keyboard.r';
    ok(plain(T, kb) === 'R', 'KeybindText follows rebinding (not cached)');
    // NbtText
    const nb = T.fromJson({ nbt: 'a', storage: 'x:y', interpret: true, separator: '|' });
    ok(nb.source === 'storage' && nb.target === 'x:y' && nb.interpret === true, 'NbtText source parsed');
    ok(throws(() => T.fromJson({ nbt: 'a' })), 'NbtText needs a source');
    T.nbtResolve = () => [{ snbt: '"hi"', str: '{"text":"A"}' }, { snbt: '5b' }];
    ok(plain(T, nb) === 'A|', 'NbtText interpret + separator: ' + plain(T, nb));
    T.nbtResolve = () => [{ snbt: '1' }, { snbt: '2' }];
    ok(plain(T, T.fromJson({ nbt: 'a', block: '0 0 0' })) === '1, 2', 'NbtText default separator');
    T.nbtResolve = null;
    ok(plain(T, T.fromJson({ nbt: 'a', block: '0 0 0' })) === '', 'NbtText unresolved is empty');
    // ScoreText
    ok(throws(() => T.fromJson({ score: { name: 'a' } })), 'ScoreText needs objective');
    const st = T.fromJson([{ text: 'S=' }, { score: { name: 'Dan', objective: 'pts' } }]);
    const rs = T.resolveScores(st, (n, o) => (n === 'Dan' && o === 'pts' ? 7 : null));
    ok(plain(T, rs) === 'S=7', 'ScoreText resolves value: ' + plain(T, rs));
    ok(plain(T, T.resolveScores(st, () => null)) === 'S=', 'ScoreText missing score is empty');
    ok(st.extra[0].score && !rs.extra[0].score, 'ScoreText resolve returns a copy');
    // SelectorText + Texts.join
    const sl = T.fromJson({ selector: '@e', separator: '/' });
    ok(sl.selector === '@e' && plain(T, sl.separator) === '/', 'SelectorText parsed');
    NS.Brig = { Reader: function (s) { this.s = s; } };
    NS.Commands = { arg: { entity: () => ({ parse: (r) => { if (r.s === 'bad') throw new Error('bad selector'); return r.s; } }) },
      resolve: () => [{ kind: 'player', name: 'Ann' }, { kind: 'entity', e: { type: 'cow', customName: null } }, { kind: 'entity', e: { type: 'pig', customName: 'Bob' } }] };
    ok(throws(() => T.fromJson({ selector: 'bad' })), 'SelectorText bad selector is an argument error');
    const res = T.resolve(T.fromJson({ selector: '@e' }), {});
    ok(plain(T, res) === 'Ann, Cow, Bob', 'Texts.join default ", ": ' + plain(T, res));
    ok(plain(T, T.resolve(sl, {})) === 'Ann/Cow/Bob', 'Texts.join custom separator');
    ok(T.runs(res)[1].style && T.runs(res)[1].style.color === 'gray', 'Texts.join separator is gray');
    // HoverEvent
    const bad = (w) => { throw Object.assign(new Error(w), { json: true }); };
    const one = (n) => T.fromJson(n);
    const ht = T.parseHover({ action: 'show_text', contents: 'a\nb' }, bad, one);
    const hl = T.hoverLines(ht);
    ok(hl.length === 2 && hl[0].text === 'a' && hl[1].text === 'b', 'HoverEvent show_text lines');
    const hi = T.parseHover({ action: 'show_item', value: { id: 'stone', Count: 3 } }, bad, one);
    ok(hi.value.id === 'stone' && hi.value.Count === 3, 'HoverEvent show_item legacy value');
    ok(T.hoverLines(hi, (v) => [{ text: v.id, rgb: 1 }])[0].text === 'stone', 'HoverEvent show_item tooltip');
    const he = T.parseHover({ action: 'show_entity', contents: { type: 'minecraft:cow', id: 'u-1', name: 'Bessie' } }, bad, one);
    const el = T.hoverLines(he);
    ok(el.length === 3 && el[0].text === 'Bessie' && el[2].text === 'u-1' && el[1].text === T.translate('gui.entity_tooltip.type', ['Cow']), 'HoverEvent show_entity: ' + JSON.stringify(el));
    ok(throws(() => T.parseHover({ action: 'zap', contents: 1 }, bad, one)), 'HoverEvent unknown action');
    ok(throws(() => T.parseHover({ action: 'show_entity', contents: { type: 'x' } }, bad, one)), 'HoverEvent show_entity needs id');
    const via = T.fromJson({ text: 'h', hoverEvent: { action: 'show_text', contents: 'tip' } });
    ok(JSON.stringify(via).indexOf('tip') >= 0, 'HoverEvent reachable through fromJson');
  } catch (e) { f.push('threw: ' + (e && e.stack || e)); }
  return f;
}

console.log('text11596check — 02i_text.js: WallBannerBlock HoverEvent KeybindText NbtText ScoreText SelectorText Texts');
const base = run(SRC);
base.forEach((m) => console.log('  FAIL ' + m));
let breaks = 0, missed = [];
const cuts = {
  WallBannerBlock: ["var over = T.overrides && T.overrides[bare];", "var over = null;"],
  KeybindText: ["else if (typeof c.keybind === 'string') out.push({ text: T.keybindName(c.keybind), style: style });", ""],
  NbtText: ["else if (typeof c.nbt === 'string') visitNbt(c, style, out);", ""],
  ScoreText: ["if (node.score) { var v", "if (false) { var v"],
  SelectorText: ["if (typeof c.selector === 'string') {\n      var sel", "if (false) {\n      var sel"],
  Texts: ["T.literal(', ', { color: 'gray' })", "T.literal(',')"],
  HoverEvent: ["if (act === 'show_entity') {", "if (act === 'show_entity_off') {"],
};
for (const [k, [a, b]] of Object.entries(cuts)) {
  if (!SRC.includes(a)) { console.log('  FAIL cut text for ' + k + ' not found'); missed.push(k); continue; }
  const r = run(SRC.replace(a, b));
  breaks++;
  if (r.length) console.log('   ✓ cutting ' + k + ' fails: ' + r[0].slice(0, 70)); else { console.log('  FAIL cutting ' + k + ' went unnoticed'); missed.push(k); }
}
console.log(` assertions passed .. ${N}`);
console.log(` failures ........... ${base.length + missed.length}`);
console.log(` breaks caught ...... ${breaks - missed.filter((m) => cuts[m]).length}`);
process.exit(base.length + missed.length ? 1 : 0);
