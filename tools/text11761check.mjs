#!/usr/bin/env node
// text11761check.mjs — #11761: src/02i_text.js TextColor/OrderedText/StringVisitable/BaseText/MutableText/ParsableText/TranslationException.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(ROOT + 'src/02i_text.js', 'utf8');
function load(code) { const M = {}; new Function('MCL', code)(M); return M.Text; }
function scenario(T) {
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  const C = T.TextColor;
  chk(C.parse('red').rgb === 0xFF5555 && C.parse('red').getName() === 'red' && C.parse('nope') === null, 'parse name');
  chk(C.parse('#00ff7f').rgb === 0x00FF7F && C.parse('#00ff7f').toString() === '#00FF7F', 'parse hex / toString');
  chk(C.parse('#zz') === null && C.parse('#') === null, 'bad hex null');
  chk(C.fromRgb(0xFF5555).equals(C.parse('red')) && C.fromRgb(0xAB).getName() === '#0000AB', 'equals by rgb, hex pad');
  chk(T.colorOf('gold') === 0xFFAA00 && T.colorOf('#123456') === 0x123456 && T.colorOf('x') === -1, 'colorOf routed');
  const OT = T.OrderedText, seen = [];
  const vis = (i, s, c) => { seen.push(i + ':' + String.fromCodePoint(c)); return true; };
  OT.styledForwardsVisitedString('a\u{1F600}b', {})(vis);
  chk(seen.join() === '0:a,1:\u{1F600},3:b', 'forwards indices surrogate: ' + seen);
  seen.length = 0; OT.styledBackwardsVisitedString('a\u{1F600}b', {})(vis);
  chk(seen.join() === '3:b,1:\u{1F600},0:a', 'backwards: ' + seen);
  seen.length = 0; OT.concat(OT.styled(65, {}), OT.EMPTY, OT.styled(66, {}))(vis);
  chk(seen.join() === '0:A,0:B', 'concat');
  seen.length = 0; chk(OT.concat([OT.styledForwardsVisitedString('xy', {}), OT.styledForwardsVisitedString('z', {})])((i, s, c) => { seen.push(c); return c !== 121; }) === false && seen.length === 2, 'concat short circuits');
  seen.length = 0; OT.styledForwardsVisitedString('ab', {}, (c) => c + 1)(vis); chk(seen.join() === '0:b,1:c', 'map');
  chk(OT.concat([]) === OT.EMPTY && OT.styledForwardsVisitedString('', {}) === OT.EMPTY, 'empties');
  const SV = T.StringVisitable;
  chk(SV.getString(SV.concat([SV.plain('ab'), SV.EMPTY, SV.plain('c')])) === 'abc', 'getString');
  const hit = SV.concat([SV.plain('a'), SV.plain('b')]).visit((s) => s === 'a' ? SV.TERMINATE_VISIT : null);
  chk(hit === SV.TERMINATE_VISIT, 'terminate stops');
  let got = null; SV.styled('x', { bold: true }).visitStyled((st, s) => { got = st; return null; }, { color: 'red' });
  chk(got && got.bold === true && got.color === 'red', 'styled merges parent');
  const t = T.BaseText('hi').append('there').append(T.BaseText('!').formatted('bold')).formatted('red');
  chk(t.getSiblings().length === 2 && t.style.color === 'red' && t.getSiblings()[1].style.bold === true, 'append/formatted');
  const cp = t.shallowCopy(); cp.append('z'); chk(t.siblings.length === 2 && cp.siblings.length === 3 && cp.style === t.style, 'shallowCopy');
  seen.length = 0; const styles = []; t.asOrderedText()((i, s, c) => { seen.push(String.fromCodePoint(c)); styles.push(s.color + '/' + !!s.bold); return true; });
  chk(seen.join('') === 'hithere!' && styles[7] === 'red/true' && styles[2] === 'red/false', 'asOrderedText inherits: ' + styles);
  chk(T.BaseText('a').fillStyle({ italic: true }).styled((s) => Object.assign({}, s, { bold: true })).style.bold === true, 'styled/fillStyle');
  chk(T.parseText({ parse: (s, e, d) => 'p' + d }, null, null, 3) === 'p3' && T.parseText('plain', null, null, 0) === 'plain', 'parsable');
  const tr = T.translatable('k.x');
  chk(T.TranslationException(tr, 'bad').message === 'Error parsing: k.x: bad' && T.TranslationException(tr, 2).message === 'Invalid index 2 requested for k.x' && T.TranslationException(tr, new Error('e')).message === 'Error while parsing: k.x', 'exception messages');
  return f;
}
const base = scenario(load(src));
if (base.length) { console.log('FAIL baseline:\n ' + base.join('\n ')); process.exit(1); }
const cuts = [
  (s) => s.replace("return BY_NAME[s] || null;", "return null;"),
  (s) => s.replace("if (!/^[+-]?[0-9a-fA-F]+$/.test(s.slice(1))) return null;", ''),
  (s) => s.replace("while (h.length < 6) h = '0' + h;", ''),
  (s) => s.replace("var c = T.TextColor.parse(name);", "var c = null;"),
  (s) => s.replace("idx += a[k] > 0xFFFF ? 2 : 1; }\n      return true;", "idx += 1; }\n      return true;"),
  (s) => s.replace("for (var k = a.length - 1; k >= 0; k--)", "for (var k = 0; k < a.length; k++)"),
  (s) => s.replace("if (!list[i](v)) return false;", ''),
  (s) => s.replace("if (f) v = OT.map(v, f);\n      var a = cps(str), idx = 0;", "var a = cps(str), idx = 0;"),
  (s) => s.replace("var r = list[i].visit(v); if (r) return r;", "list[i].visit(v);"),
  (s) => s.replace("v(T.mergeStyle(st, own), s)", "v(own, s)"),
  (s) => s.replace("c.siblings = this.siblings.slice();", "c.siblings = [];"),
  (s) => s.replace("ss = T.mergeStyle(self.style, sib.style)", "ss = sib.style"),
  (s) => s.replace("'Invalid index ' + what + ' requested for '", "'Index ' + what + ' for '"),
  (s) => s.replace("text.parse(source, entity, depth) : text", "text : text"),
];
let caught = 0;
for (const c of cuts) { const s2 = c(src); if (s2 === src) { console.log('cut did not apply', c.toString()); process.exit(1); } let r; try { r = scenario(load(s2)).length; } catch (e) { r = 1; } if (r) caught++; else console.log('uncaught cut', c.toString()); }
if (caught !== cuts.length) { console.log('FAIL: only ' + caught + '/' + cuts.length); process.exit(1); }
console.log('PASS text11761check — ' + caught + ' breaks caught');
