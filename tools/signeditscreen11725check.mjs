#!/usr/bin/env node
// signeditscreen11725check.mjs — #11725: SignEditScreen (BE.signEdit* model, H.openSignEdit/draw/key/close-commit,
// placement hook, input routing) proven with source breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const grab = (s, re, what) => { const m = re.exec(s); if (!m) throw new Error('missing ' + what); return m[0]; };
const rd = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
const BEs = rd('07c_blockentity.js'), HUD = rd('15_hud.js'), INP = rd('13_input.js'), PL = rd('14_player.js');
function trial(bp, hp, ip, pp) {
  const be = bp ? bp(BEs) : BEs, h = hp ? hp(HUD) : HUD, inp = ip ? ip(INP) : INP, pl = pp ? pp(PL) : PL, o = {};
  const BE = { SIGN_MAX_WIDTH: 90 };
  new Function('BE', grab(be, /BE\.signEditNew = [\s\S]*?BE\.signEditFinish = [^\n]*\n/, 'model'))(BE);
  const w = (t) => t.length * 6;
  const sign = { type: 'sign', lines: ['a', '', '', 'd'] };
  const s = BE.signEditNew(sign);
  o.copy = s.lines.join('|') === 'a|||d' && s.row === 0 && s.lines !== sign.lines;
  o.type = BE.signEditType(s, 'b', w) === true && s.lines[0] === 'ab';
  s.lines[0] = 'x'.repeat(15); o.width = BE.signEditType(s, 'y', w) === false && s.lines[0].length === 15 && BE.signEditType(s, 'y', { }.x || ((t) => 0)) === true;
  s.lines[0] = 'ab'; o.ctl = BE.signEditType(s, '\n', w) === false && BE.signEditType(s, 'ab', w) === false;
  o.back = BE.signEditKey(s, 'Backspace') && s.lines[0] === 'a';
  o.up = BE.signEditKey(s, 'ArrowUp') && s.row === 3;
  o.down = BE.signEditKey(s, 'ArrowDown') && s.row === 0;
  o.enter = BE.signEditKey(s, 'Enter') && s.row === 1 && BE.signEditKey(s, 'NumpadEnter') && s.row === 2;
  o.other = BE.signEditKey(s, 'KeyA') === false;
  s.lines[2] = 'zz'; BE.signEditFinish(s); o.fin = sign.lines.join('|') === 'a||zz|d' && sign.lines !== s.lines;
  // hud
  const NS = { BlockEntities: BE, Gui: { widths: 1, textWidth: w } };
  const mk = grab(h, /H\.openSignEdit = function[\s\S]*?\n  \};\n  H\.signCommit = function[\s\S]*?\n  \};/, 'open') + grab(h, /H\.signKey = function[\s\S]*?\n  \};/, 'key');
  const H = { open: (n) => { H.screen = n; } };
  const cr = []; BE.get = () => null; BE.create = (x, y, z, t) => (cr.push(t), { type: t, lines: [] });
  new Function('H', 'NS', mk)(H, NS);
  o.open = H.openSignEdit(1, 2, 3) === true && H.screen === 'sign' && cr[0] === 'sign' && H.signScr.row === 0;
  o.keyt = H.signKey('KeyQ', 'q') === true && H.signScr.lines[0] === 'q' && H.signKey('ArrowDown', undefined) && H.signScr.row === 1;
  const be0 = H.signScr.be; H.screen = 'sign'; H.signCommit(); o.commit = be0.lines[0] === 'q' && H.signScr === null;
  H.signScr = BE.signEditNew({ lines: [] }); H.screen = 'inventory'; o.gate = H.signKey('KeyQ', 'q') === false;
  o.reach = /H\.screen === 'sign'\) H\.drawSignEdit\(c\)/.test(h) && /if \(H\.screen === 'sign'\) H\.signCommit\(\)/.test(h);
  o.input = /Hd\.screen === 'sign' && Hd\.signKey && Hd\.signKey\(e\.code, e\.key\)/.test(inp);
  o.place = /_sign\$\/\.test\(NS\.Reg\.names\[NS\.States\.block\[st\]\]\)\) NS\.Hud\.openSignEdit\(bx, by, bz\)/.test(pl);
  o.done = /'Done', function \(\) \{ H\.close\(\); \}/.test(grab(h, /H\.drawSignEdit = [\s\S]*?\n  \};/, 'draw')) && /'Edit sign message'/.test(h);
  return o;
}
const base = trial(); for (const [k, v] of Object.entries(base)) ok(v, 'baseline ' + k);
const R = (a, b) => (t) => { if (!t.includes(a)) throw new Error('break target missing: ' + a); return t.replace(a, b); };
const BR = [
  ['copy', 'lines: [l[0] || \'\', l[1] || \'\', l[2] || \'\', l[3] || \'\'], row: 0', 'lines: l, row: 0', ['copy'], 'b'],
  ['width', 'if (width(t) > BE.SIGN_MAX_WIDTH) return false;', '', ['width'], 'b'],
  ['ctl', 'ch.charCodeAt(0) < 32 ||', '', ['ctl'], 'b'],
  ['up', "s.row = (s.row - 1) & 3", "s.row = (s.row + 1) & 3", ['up'], 'b'],
  ['enter', "code === 'Enter' || code === 'NumpadEnter'", "code === 'NumpadEnter'", ['enter'], 'b'],
  ['back', "slice(0, -1); return true; }\n    if (code === 'ArrowUp')", "slice(0, -2); return true; }\n    if (code === 'ArrowUp')", ['back'], 'b'],
  ['fin', 's.be.lines = s.lines.slice()', 's.be.lines = s.be.lines', ['fin'], 'b'],
  ['commit', "NS.BlockEntities.signEditFinish(s);", "", ['commit'], 'h'],
  ['open', "H.open('sign');", "H.open('book');", ['open'], 'h'],
  ['gate', "if (H.screen !== 'sign' || !s) return false;", "if (!s) return false;", ['gate'], 'h'],
  ['reach', "else if (H.screen === 'sign') H.drawSignEdit(c);", "", ['reach'], 'h'],
  ['closehook', "if (H.screen === 'sign') H.signCommit();", "", ['reach'], 'h'],
  ['input', "Hd.screen === 'sign' && Hd.signKey", "Hd.screen === 'signx' && Hd.signKey", ['input'], 'i'],
  ['place', "NS.Hud.openSignEdit(bx, by, bz);", "0;", ['place'], 'p'],
  ['done', "(H.h >> 2) + 120, 200, 20, 'Done', function () { H.close(); }", "(H.h >> 2) + 120, 200, 20, 'Done', function () { }", ['done'], 'h'],
];
for (const [n, a, b, keys, w] of BR) {
  const f = R(a, b); let o;
  try { o = trial(w === 'b' ? f : null, w === 'h' ? f : null, w === 'i' ? f : null, w === 'p' ? f : null); }
  catch (e) { if (/break target missing/.test(e.message)) { fails.push('break ' + n + ': ' + e.message); continue; } breaks++; continue; }
  if (keys.some((k) => !o[k])) breaks++; else fails.push('break ' + n + ' NOT caught');
}
for (const f of fails) console.log('FAIL ' + f);
console.log(`signeditscreen11725check: ${pass} assertions · ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
