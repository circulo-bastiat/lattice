#!/usr/bin/env node
// structurescreen11725check.mjs — #11725: StructureBlockScreen model (NS.StructureScreen), Hud open/draw/key, use hook, input routing, BE persistence; source breaks caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const rd = (f) => readFileSync(join(ROOT, f), 'utf8');
const grab = (s, re, what) => { const m = re.exec(s); if (!m) throw new Error('missing ' + what); return m[0]; };
const SRC = { m: rd('src/07zzu_structurescreen.js'), h: rd('src/15_hud.js'), u: rd('src/14l_use.js'), i: rd('src/13_input.js'), b: rd('src/07c_blockentity.js'), l: rd('build.mjs') };
function trial(which, fn) {
  const t = { ...SRC }; if (which) t[which] = fn(t[which]);
  const o = {}, NS = {}; new Function('MCL', t.m)(NS);
  const S = NS.StructureScreen;
  o.name = S.validNameChar('', 'a', 0) && S.validNameChar('a', ':', 1) && !S.validNameChar('a:b', ':', 3) && !S.validNameChar('A', 'A', 0) && S.validNameChar('a:b', '/', 3) && !S.validNameChar('a:b', '/', 1) && !S.validNameChar('', ' ', 0);
  o.parse = S.parseInt('12') === 12 && S.parseInt('x') === 0 && S.parseInt('99999999999') === 0 && S.parseFloat('x') === 1 && S.parseFloat('0.5') === 0.5 && S.parseLong('x') === '0' && S.parseLong('-7') === '-7';
  o.fmt = S.formatIntegrity(1) === '1.0' && S.formatIntegrity(0.25) === '0.25' && S.formatIntegrity(0.123456) === '0.1235';
  const be = { type: 'structure_block' };
  const s = S.open(be);
  o.defaults = s.mode === 'data' && s.mirror === 'none' && s.rotation === 'none' && s.integrity === '1.0' && s.seed === '0' && s.sizeX === '0' && s.focus === 'metadata';
  o.notbe = S.open({ type: 'jigsaw' }) === null;
  o.perm = S.canOpen({ instabuild: true }) && !S.canOpen({ instabuild: false }) && !S.canOpen({ instabuild: true, permLevel: 1 });
  o.cycle = S.cycleMode(s) && s.mode === 'save' && be.mode === 'save' && s.focus === 'name' && S.cycleMode(s) && s.mode === 'load' && S.cycleMode(s) && s.mode === 'corner' && S.cycleMode(s) && s.mode === 'save';
  s.mode = 'save'; s.focus = 'name';
  o.type = S.type(s, 'a') && !S.type(s, 'B') && s.name === 'a' && S.type(s, ':') && !S.type(s, ':');
  s.focus = 'seed'; o.hidden = S.type(s, '1') === false;           // seed is not visible in save mode
  s.focus = 'posX'; s.posX = '1'.repeat(15); o.max = !S.type(s, '2');
  s.focus = 'name'; o.tab = S.tab(s) && s.focus === 'posX' && S.tab(s, true) && s.focus === 'name' && S.tab(s, true) && s.focus === 'sizeZ';
  const bt = S.buttons('save'), bl = S.buttons('load'), bc = S.buttons('corner');
  o.buttons = bt.save && bt.detect && bt.showAir && !bt.load && bl.load && bl.rotate && bl.mirror && bl.showBoundingBox && !bl.detect && !bc.save && !bc.load && !bc.entities;
  S.setRotation(s, 'clockwise_90'); S.cycleMirror(s); S.toggle(s, 'showAir'); S.toggle(s, 'ignoreEntities');
  o.live = be.rotation === 'clockwise_90' && be.mirror === 'left_right' && be.showAir === true && be.ignoreEntities === true;
  S.cancel(s); o.cancel = be.rotation === 'none' && be.mirror === 'none' && be.showAir === false && be.ignoreEntities === false && be.mode === 'data';
  s.mode = 'load'; o.actgate = S.action(s, 'save') === false && S.action(s, 'detect') === false && be.lastAction === undefined;
  s.mode = 'save'; s.name = 'a:b'; s.posX = '-3'; s.sizeY = '5'; s.integrity = 'zz'; s.seed = '77';
  o.commit = S.action(s, 'detect') === true && be.name === 'a:b' && be.posX === -3 && be.sizeY === 5 && be.integrity === 1 && be.seed === '77' && be.lastAction === 'detect' && be.mode === 'save';
  // hud
  const mk = grab(t.h, /H\.openStructure = function[\s\S]*?\n  \/\*\* `StructureBlockScreen\.render`/, 'open').replace(/\n  \/\*\*[^\n]*$/, '') + grab(t.h, /H\.structureKey = function[\s\S]*?\n  \};/, 'key');
  let closed = 0;
  const H = { open: (n) => { H.screen = n; }, close: () => { H.screen = null; closed++; } };
  const be2 = { type: 'structure_block' };
  const N2 = { StructureScreen: S, Player: { instabuild: true }, BlockEntities: { get: () => be2 } };
  new Function('H', 'NS', mk)(H, N2);
  o.open = H.openStructure(1, 2, 3) === true && H.screen === 'structure' && H.strScr.mode === 'data';
  N2.Player.instabuild = false; o.gate = H.openStructure(1, 2, 3) === false; N2.Player.instabuild = true;
  H.strScr.focus = 'metadata'; H.structureKey('KeyQ', 'q'); o.key = H.strScr.metadata === 'q' && H.structureKey('Tab', undefined, false);
  o.enter = H.structureKey('Enter', undefined) === true && be2.metadata === 'q' && closed === 1;
  H.screen = 'structure'; H.strScr.mode = 'save'; be2.mode = 'save'; H.strScr.mirror = 'front_back'; be2.mirror = 'front_back';
  o.esc = H.structureKey('Escape', undefined) === true && closed === 2 && be2.mirror === 'none';
  H.screen = 'inv'; H.strScr.focus = 'name'; o.screenGate = H.structureKey('KeyQ', 'q') === false;
  o.reach = /H\.screen === 'structure'\) H\.drawStructure\(c\)/.test(t.h);
  o.draw = /'Done', function \(\) \{ H\.structureDone\(\); \}/.test(t.h) && /H\.structureAction\('save'\)/.test(t.h) && /H\.structureAction\('load'\)/.test(t.h) && /H\.structureAction\('detect'\)/.test(t.h) && /Relative Position/.test(t.m) && /Include entities:/.test(t.m);
  o.input = /Hd\.screen === 'structure' && Hd\.structureKey/.test(t.i);
  o.use = /beTypeHere === 'structure_block'[\s\S]{0,120}openStructure\(x, y, z\)/.test(t.u);
  o.persist = /structure_block: \['name', 'metadata', 'posX'[^\]]*'seed'\]/.test(t.b);
  o.built = t.l.includes("'07zzu_structurescreen.js'");
  return o;
}
const base = trial(); for (const [k, v] of Object.entries(base)) ok(v, 'baseline ' + k);
const BR = [
  ['colon', "(slash === -1 || cursor <= slash) && colon === -1", "true", ['name'], 'm'],
  ['slash', "return cursor > colon;", "return true;", ['name'], 'm'],
  ['upper', "(ch >= 'a' && ch <= 'z')", "(ch >= 'A' && ch <= 'z')", ['name'], 'm'],
  ['parsefloat', ": NaN; return isNaN(v) ? 1 :", ": NaN; return isNaN(v) ? 0 :", ['parse'], 'm'],
  ['fmt', "s + '.0'", "s", ['fmt'], 'm'],
  ['perm', "player.instabuild &&", "", ['perm'], 'm'],
  ['nodata', "SS.MODES_EXCEPT_DATA = ['save', 'load', 'corner']", "SS.MODES_EXCEPT_DATA = ['save', 'load', 'corner', 'data']", ['cycle'], 'm'],
  ['hidden', "SS.visible(s).indexOf(f) < 0 || ", "", ['hidden'], 'm'],
  ['max', " || s[f].length >= SS.MAX[f]", "", ['max'], 'm'],
  ['namechar', "if (f === 'name' && !SS.validNameChar(s.name, ch, s.name.length)) return false;", "", ['type'], 'm'],
  ['tab', "(i + (back ? v.length - 1 : 1)) % v.length", "(i + 1) % v.length", ['tab'], 'm'],
  ['detect', "detect: mode === 'save'", "detect: mode === 'load'", ['buttons'], 'm'],
  ['live', "s.be.rotation = r;", "", ['live'], 'm'],
  ['cancel', "be.mirror = o.mirror;", "", ['cancel'], 'm'],
  ['actgate', "if (s.mode !== need) return false;", "", ['actgate'], 'm'],
  ['commit', "be.seed = SS.parseLong(s.seed);", "", ['commit'], 'm'],
  ['hgate', "!S.canOpen(NS.Player)", "false", ['gate'], 'h'],
  ['hesc', "if (code === 'Escape') { H.structureCancel(); return true; }", "", ['esc'], 'h'],
  ['hcancel', "if (s) NS.StructureScreen.cancel(s); H.close();", "H.close();", ['esc'], 'h'],
  ['hscreen', "if (H.screen !== 'structure' || !s) return false;", "if (!s) return false;", ['screenGate'], 'h'],
  ['reach', "else if (H.screen === 'structure') H.drawStructure(c);", "", ['reach'], 'h'],
  ['input', "Hd.screen === 'structure' && Hd.structureKey", "Hd.screen === 'structurex' && Hd.structureKey", ['input'], 'i'],
  ['use', "beTypeHere === 'structure_block'", "beTypeHere === 'structure_blockx'", ['use'], 'u'],
  ['persist', "structure_block: ['name', 'metadata',", "structure_blockx: ['name', 'metadata',", ['persist'], 'b'],
  ['built', "'07zzu_structurescreen.js'", "'07zzu_structurescreenx.js'", ['built'], 'l'],
];
for (const [n, a, b, keys, w] of BR) {
  if (!SRC[w].includes(a)) { fails.push('break ' + n + ': target missing'); continue; }
  let o; try { o = trial(w, (t) => t.replace(a, b)); } catch (e) { breaks++; continue; }
  if (keys.some((k) => !o[k])) breaks++; else fails.push('break ' + n + ' NOT caught');
}
for (const f of fails) console.log('FAIL ' + f);
console.log(`structurescreen11725check: ${pass} assertions · ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
