#!/usr/bin/env node
// packscreencheck.mjs — #11247. PackScreen / PackListWidget / ResourcePackOrganizer (.decomp gui/screen/pack) in the BUILT dist/mclite.html:
// Options > Resource Packs opens it, two columns (Available / Selected), enable/disable/move rules, Done applies (and Esc too: PackScreen.close()),
// Open Pack Folder is a ruled disabled button. Evaluates the shipped Options + PackScreen modules (no browser needed) and DRAWS to a recording canvas.
// Then breaks its own data: each break must make the verdict fail ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const D = ROOT + '.decomp/net/minecraft/client/gui/screen/pack/';
const html0 = readFileSync(ROOT + 'dist/mclite.html', 'utf8');
const dec = readFileSync(D + 'PackScreen.java', 'utf8') + readFileSync(D + 'PackListWidget.java', 'utf8') + readFileSync(D + 'ResourcePackOrganizer.java', 'utf8');

function iife(html, mark) {
  const a = html.indexOf(mark); if (a < 0) return null;
  const st = html.lastIndexOf('(function (NS) {', a);
  const en = html.indexOf("})(typeof MCL !== 'undefined'", a);
  return html.slice(st, html.indexOf('\n', en + 1));
}
function verdict(html) { try { return verdict0(html); } catch (e) { return ['threw: ' + e.message]; } }
function verdict0(html) {
  const fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
  const NS = {}; globalThis.MCL = NS;
  const o = iife(html, 'var O = NS.Options = {'), p = iife(html, 'var P = NS.PackScreen = {};');
  if (!o) return ['Options module absent'];
  if (!p) return ['PackScreen module absent from dist'];
  const saved = []; NS.Settings = { resourcePacks: ['vanilla'], dataPacks: ['vanilla'], fov: 70, save() { saved.push(JSON.stringify([this.resourcePacks, this.dataPacks])); } };
  NS.Settings = new Proxy(NS.Settings, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? 0 : undefined)) });
  NS.Hud = { closed: 0, close() { this.closed++; } }; NS.Input = { mx: -1, my: -1 };
  const texts = [], rects = [];
  NS.Gui = { ready: true, textWidth: (s) => String(s).length * 6, text: (c, s) => texts.push(String(s)), dim() {}, blit() {} };
  try { new Function('MCL', o)(NS); new Function('MCL', p)(NS); } catch (e) { return ['modules failed to evaluate: ' + e.message]; }
  const O = NS.Options, P = NS.PackScreen;
  const ctx = { fillRect: (...a) => rects.push(a), save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, createLinearGradient: () => ({ addColorStop() {} }), set fillStyle(v) {} };
  const draw = () => { texts.length = 0; return O.draw(ctx, 854, 480, 1); };
  // reachable from Options
  const hub = O.ROWS.options(); const row = hub.find((r) => r.label === 'Resource Packs...');
  ok(row && row.t === 'btn', 'Options > Resource Packs... must be a live button');
  ok(!O.OWED['Resource Packs...'], 'Resource Packs... must not stay in OWED');
  O.open('options'); row && row.fn();
  ok(O.screen === 'packs', 'screen is packs after the button: ' + O.screen);
  ok(draw() === true, 'draw returns true');
  ['Resource Packs', 'Available', 'Selected', 'Default', 'Done', 'Open Pack Folder', 'Drag and drop files into this window to add packs'].forEach((t) => ok(texts.includes(t), 'text missing: ' + t));
  ok(/pack\.available\.title/.test(dec) && /pack\.selected\.title/.test(dec) && /pack\.dropInfo/.test(dec) && /pack\.openFolder/.test(dec), 'decomp parse');
  ok(O.OWED['Open Pack Folder'], 'Open Pack Folder ruling missing');
  // layout facts from the decomp: lists 200 wide at width/2-4-200 and width/2+4; Done at width/2+4, height-48, 150x20
  ok(/width \/ 2 - 4 - 200/.test(dec) && /width \/ 2 \+ 4\)/.test(dec), 'decomp list left');
  ok(P.listLeft(854, false) === 427 - 4 - 200 && P.listLeft(854, true) === 427 + 4, 'list columns wrong');
  const dn = O.hit.find((h) => h.row.t === 'done'); ok(dn && dn.x === 431 && dn.y === 432 && dn.w === 150 && dn.h === 20, 'Done rect ' + JSON.stringify(dn));
  ok(P.org.enabled.length === 1 && P.org.enabled[0].name === 'vanilla' && P.org.disabled.length === 0, 'default organizer state');
  // Default is pinned+always: no zones
  ok(P.entryAt(P.listLeft(854, true) + 4, P.rowY(0) + 4, 854, 480).zone === null, 'default pack must show no arrows');
  // organizer with extra packs
  P.org = P.makeOrganizer('resource', [{ name: 'a', title: 'A', desc: '', pos: 'top' }, { name: 'b', title: 'B', desc: '', pos: 'top' }]);
  const [dflt] = P.org.enabled, A = P.org.disabled[0], B = P.org.disabled[1];
  ok(P.canBeEnabled(A) && !P.canBeDisabled(A), 'available pack can be enabled only');
  ok(P.entryAt(P.listLeft(854, false) + 10, P.rowY(0) + 4, 854, 480).zone === 'enable', 'enable zone');
  ok(P.clickGui(P.listLeft(854, false) + 10, P.rowY(0) + 4, 854, 480) && P.org.enabled[0] === A && P.org.enabled[1] === dflt, 'enable puts it above the pinned default');
  P.enable(B);
  ok(P.org.enabled.map((x) => x.name).join() === 'b,a,vanilla', 'insert order ' + P.org.enabled.map((x) => x.name));
  ok(P.canMoveEnd(B) && !P.canMoveStart(B) && P.canMoveStart(A) && !P.canMoveEnd(A), 'move rules (pinned neighbour blocks)');
  ok(P.move(B, 1) && P.org.enabled.map((x) => x.name).join() === 'a,b,vanilla', 'move down');
  ok(!P.move(B, 1), 'cannot move below pinned default');
  ok(P.canBeDisabled(A) && P.disable(A) && P.org.disabled.indexOf(A) >= 0, 'disable');
  ok(!P.disable(dflt), 'default is always enabled');
  P.enable(A); P.move(A, 0 + 1);
  { const o2 = P.org; P.org = P.makeOrganizer('resource', [{ name: 'pin', title: 'Pin', desc: '', pinned: true, always: true, pos: 'top' }, { name: 'q', title: 'Q', desc: '', pos: 'top' }]);
    const q = P.org.disabled[0]; P.enable(q); ok(P.org.enabled.map((x) => x.name).join() === 'pin,q,vanilla', 'pinned top stays on top ' + P.org.enabled.map((x) => x.name)); ok(!P.canMoveStart(q), 'cannot move above a pinned pack'); P.org = o2; }
  // Done applies: reverse order, persisted
  draw(); saved.length = 0;
  const c = O.click(dn.x + 5, dn.y + 5, 0);
  ok(c && O.screen === 'options', 'Done returns to Options: ' + O.screen);
  ok(JSON.stringify(NS.Settings.resourcePacks) === '["vanilla","a","b"]'.replace('"a","b"', P.org.enabled.slice(0, 2).reverse().map((x) => '"' + x.name + '"').join(',')), 'applied names ' + JSON.stringify(NS.Settings.resourcePacks));
  ok(saved.length >= 1, 'Settings.save not called by apply');
  // Esc path = O.back also applies (PackScreen.close)
  O.open('options'); P.open('resource'); NS.Settings.resourcePacks = ['x']; O.back();
  ok(JSON.stringify(NS.Settings.resourcePacks) === '["vanilla"]', 'Esc (back) must apply, got ' + JSON.stringify(NS.Settings.resourcePacks));
  // Data Packs screen
  O.open('options'); P.open('data'); ok(O.screen === 'datapacks', 'datapacks screen'); draw();
  ['Select Data Packs', 'Available', 'Selected', 'Default'].forEach((t) => ok(texts.includes(t), 'data text missing: ' + t));
  ok(P.org.kind === 'data', 'data organizer');
  // Done inactive when nothing selected
  P.org.enabled.length = 0; draw(); ok(!O.hit.some((h) => h.row.t === 'done') && !P.doneActive(), 'Done must be inactive with an empty Selected list');
  return fails;
}
const base = verdict(html0); const notes = [];
const BREAKS = [
  ['remove the hub dispatch', (h) => h.replace("fn: function () { P.open('resource'); }", 'fn: function () {}')],
  ['remove the screen draw', (h) => h.replace("return P.draw(c, w, h, s); }", 'return false; }')],
  ['Done does not apply', (h) => h.replace('P.apply(); }\n    return back0', ' }\n    return back0')],
  ['writer call dropped', (h) => h.replace('= names; if (S.save) S.save(); }', '= names; }')],
  ['column swapped', (h) => h.replace('selected ? gw / 2 + 4 : gw / 2 - 4 - 200', 'selected ? gw / 2 - 4 - 200 : gw / 2 + 4')],
  ['pinned can be disabled', (h) => h.replace('P.isEnabled(p) && !p.always', 'P.isEnabled(p)')],
  ['move ignores pinned', (h) => h.replace('i > 0 && !l[i - 1].pinned', 'i > 0')],
  ['Selected title wrong', (h) => h.replace("selected: 'Selected'", "selected: 'Active'")],
  ['Open Pack Folder ruling dropped', (h) => h.replace("O.OWED['Open Pack Folder'] =", "O.OWED['x'] =")],
  ['empty Selected keeps Done live', (h) => h.replace('return !!P.org && P.org.enabled.length > 0;', 'return true;')],
];
let caught = 0;
for (const [n, f] of BREAKS) { const h = f(html0); if (h === html0) { notes.push('  BREAK DID NOT APPLY: ' + n); continue; } const r = verdict(h); if (r.length) caught++; else notes.push('  NOT CAUGHT: ' + n); }
console.log(`packscreencheck #11247: ${base.length ? 'FAILED' : 'ok'}, ${caught} breaks caught (of ${BREAKS.length})`);
base.forEach((f) => console.log('  FAIL ' + f)); notes.forEach((n) => console.log(n));
process.exit(base.length || caught < BREAKS.length ? 1 : 0);
