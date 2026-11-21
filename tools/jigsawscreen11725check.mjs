#!/usr/bin/env node
// jigsawscreen11725check.mjs — #11725: JigsawBlockScreen model (NS.JigsawScreen), Hud open/draw/key, use hook, input routing, BE persistence; source breaks caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const rd = (f) => readFileSync(join(ROOT, f), 'utf8');
const grab = (s, re, what) => { const m = re.exec(s); if (!m) throw new Error('missing ' + what); return m[0]; };
const SRC = { m: rd('src/07zzu_jigsawscreen.js'), h: rd('src/15_hud.js'), u: rd('src/14l_use.js'), i: rd('src/13_input.js'), b: rd('src/07c_blockentity.js') };
function trial(which, fn) {
  const t = { ...SRC }; if (which) t[which] = fn(t[which]);
  const o = {}, NS = {}; new Function('MCL', t.m)(NS);
  const J = NS.JigsawScreen;
  o.valid = J.validId('minecraft:empty') && J.validId('a/b') && J.validId(':x') && !J.validId('Bad') && !J.validId('a:B') && !J.validId('a b') && !J.validId('A:b');
  const be = { type: 'jigsaw' };
  const s = J.open(be, 'up_north');
  o.defaults = s.pool === 'minecraft:empty' && s.name === 'minecraft:empty' && s.finalState === 'minecraft:air' && s.joint === 'rollable' && s.vertical === true;
  o.aligned = J.open(be, 'north_up').joint === 'aligned' && J.open(be, 'north_up').vertical === false;
  o.notjig = J.open({ type: 'chest' }, 'up_north') === null;
  o.perm = J.canOpen({ instabuild: true }) && !J.canOpen({ instabuild: false }) && !J.canOpen({ instabuild: true, permLevel: 1 });
  s.focus = 1; s.name = ''; J.type(s, 'a'); J.type(s, 'B'); o.type = s.name === 'aB' && J.doneActive(s) === false;
  J.backspace(s); o.back = s.name === 'a' && J.doneActive(s) === true;
  o.max = (() => { s.focus = 3; s.finalState = 'x'.repeat(255); const a = J.type(s, 'y'), b = J.type(s, 'y'); s.finalState = 'minecraft:air'; return a && !b; })();
  o.tab = (() => { s.focus = 3; J.tab(s); const a = s.focus === 0; J.tab(s, true); return a && s.focus === 3; })();
  o.joint = J.cycleJoint(s) && s.joint === 'aligned' && !J.cycleJoint({ vertical: false, joint: 'aligned' });
  o.levels = J.setLevels(s, 1) === 7 && J.setLevels(s, 0.5) === 3 && J.setLevels(s, 0) === 0;
  s.name = 'a:b'; s.pool = 'p'; s.target = 't'; s.finalState = 'minecraft:stone'; s.joint = 'aligned';
  o.commit = J.commit(s) === true && be.name === 'a:b' && be.pool === 'p' && be.target === 't' && be.finalState === 'minecraft:stone' && be.joint === 'aligned';
  s.name = 'BAD'; be.name = 'keep'; o.refuse = J.commit(s) === false && be.name === 'keep';
  // hud
  const mk = grab(t.h, /H\.openJigsaw = function[\s\S]*?\n  H\.jigsawDone = [^\n]*\n/, 'open') + grab(t.h, /H\.jigsawKey = function[\s\S]*?\n  \};/, 'key');
  const H = { open: (n) => { H.screen = n; }, close: () => { H.screen = null; closed++; } }; let closed = 0;
  const be2 = { type: 'jigsaw' };
  const N2 = { JigsawScreen: J, Player: { instabuild: true }, BlockEntities: { get: () => be2 }, Behave: { propName: () => 'up_east' }, World: { getBlock: () => 1 } };
  new Function('H', 'NS', mk)(H, N2);
  o.open = H.openJigsaw(1, 2, 3) === true && H.screen === 'jigsaw' && H.jigScr.joint === 'rollable';
  N2.Player.instabuild = false; o.gate = H.openJigsaw(1, 2, 3) === false; N2.Player.instabuild = true;
  H.jigScr.focus = 0; H.jigsawKey('KeyQ', 'q'); o.key = H.jigScr.pool === 'minecraft:emptyq' && H.jigsawKey('Tab', undefined, false) && H.jigScr.focus === 1;
  H.jigScr.focus = 1; H.jigScr.name = 'n'; H.jigScr.pool = 'p'; H.jigScr.target = 't';
  o.enter = H.jigsawKey('Enter', undefined) === true && be2.name === 'n' && closed === 1;
  H.screen = 'jigsaw'; H.jigScr.name = 'BAD'; o.enterBad = H.jigsawKey('Enter', undefined) === false && closed === 1;
  H.screen = 'inv'; o.screenGate = H.jigsawKey('KeyQ', 'q') === false;
  o.reach = /H\.screen === 'jigsaw'\) H\.drawJigsaw\(c\)/.test(t.h);
  o.draw = /'Done', function \(\) \{ H\.jigsawDone\(\); \}/.test(t.h) && /'Cancel', function \(\) \{ H\.close\(\); \}/.test(t.h) && /Joint Type:/.test(t.h) && /Target Pool:/.test(t.m) && /Turns into:/.test(t.m);
  o.input = /Hd\.screen === 'jigsaw' && Hd\.jigsawKey/.test(t.i);
  o.use = /beTypeHere === 'jigsaw'[\s\S]{0,120}openJigsaw\(x, y, z\)/.test(t.u);
  o.persist = /jigsaw: \['name', 'target', 'pool', 'finalState', 'joint'\]/.test(t.b);
  return o;
}
const base = trial(); for (const [k, v] of Object.entries(base)) ok(v, 'baseline ' + k);
const BR = [
  ['validns', "/^[a-z0-9_.-]*$/.test(ns)", "true", ['valid'], 'm'],
  ['validpath', "/^[a-z0-9_.\\/-]*$/.test(p)", "true", ['valid'], 'm'],
  ['joint', "(vert ? 'rollable' : 'aligned')", "'rollable'", ['aligned'], 'm'],
  ['perm', "player.instabuild &&", "", ['perm'], 'm'],
  ['max', " || s[f].length >= JS.MAX[f]", "", ['max'], 'm'],
  ['tab', "(s.focus + (back ? 3 : 1)) & 3", "(s.focus + 1) & 3", ['tab'], 'm'],
  ['vertical', "if (!s.vertical) return false; ", "", ['joint'], 'm'],
  ['levels', "Math.floor(Math.max(0, Math.min(1, frac)) * 7)", "Math.round(Math.max(0, Math.min(1, frac)) * 7)", ['levels'], 'm'],
  ['refuse', "if (!JS.doneActive(s)) return false;\n    var be", "var be", ['refuse'], 'm'],
  ['commit', "be.pool = s.pool;", "", ['commit'], 'm'],
  ['hgate', "!J.canOpen(NS.Player)", "false", ['gate'], 'h'],
  ['henter', "if (!J.doneActive(s)) return false; H.jigsawDone();", "H.jigsawDone();", ['enterBad'], 'h'],
  ['hscreen', "if (H.screen !== 'jigsaw' || !s) return false;", "if (!s) return false;", ['screenGate'], 'h'],
  ['reach', "else if (H.screen === 'jigsaw') H.drawJigsaw(c);", "", ['reach'], 'h'],
  ['input', "Hd.screen === 'jigsaw' && Hd.jigsawKey", "Hd.screen === 'jigsawx' && Hd.jigsawKey", ['input'], 'i'],
  ['use', "beTypeHere === 'jigsaw'", "beTypeHere === 'jigsawx'", ['use'], 'u'],
  ['persist', "jigsaw: ['name', 'target', 'pool', 'finalState', 'joint']", "", ['persist'], 'b'],
];
for (const [n, a, b, keys, w] of BR) {
  if (!SRC[w].includes(a)) { fails.push('break ' + n + ': target missing'); continue; }
  let o; try { o = trial(w, (t) => t.replace(a, b)); } catch (e) { breaks++; continue; }
  if (keys.some((k) => !o[k])) breaks++; else fails.push('break ' + n + ' NOT caught');
}
for (const f of fails) console.log('FAIL ' + f);
console.log(`jigsawscreen11725check: ${pass} assertions · ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
