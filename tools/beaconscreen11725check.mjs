#!/usr/bin/env node
// beaconscreen11725check.mjs — #11725: BeaconScreen / BeaconScreenHandler (H.openBeacon, button layout, beaconClick,
// Menu.beaconMenu payment rules + setEffects, draw dispatch, close-time payment return) proven with source breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const grab = (s, re, what) => { const m = re.exec(s); if (!m) throw new Error('missing ' + what); return m[0]; };
const HUD = readFileSync(join(ROOT, 'src/15_hud.js'), 'utf8');
const MENU = readFileSync(join(ROOT, 'src/14g_menu.js'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'src/17_main.js'), 'utf8');
function trial(hp, mp, np) {
  const h = hp ? hp(HUD) : HUD, mu = mp ? mp(MENU) : MENU, mn = np ? np(MAIN) : MAIN, o = {};
  const calls = []; let opened = null, closed = 0;
  const be = { type: 'beacon', levels: 4, primary: null, secondary: null };
  const names = { 1: 'emerald', 2: 'dirt', 3: 'iron_ingot' };
  const NS = { Player: { menu: { inventory: {} } }, BlockEntities: { get: () => be },
    Items: { nameOf: (i) => names[i] }, Inventory: { isEmpty: (s) => !s || s.n <= 0 },
    Menu: { beaconMenu: (inv, b) => ({ be: b, slots: [], setEffects(p, s) { if (!this.pay) return false; b.primary = p; b.secondary = s; return true; }, pay: true }),
      OUTSIDE: -999, PICKUP: 0, QUICK_MOVE: 1, doClick: (m, s, b, t) => calls.push([s, t]) } };
  const H = { open: (n) => { opened = n; }, close: () => { closed++; } };
  const src = grab(h, /H\.openBeacon = function[\s\S]*?\n  \};/, 'open') + grab(h, /var BEACON_LEVELS[\s\S]*?H\.beaconAt = beaconAt;\n  function beaconButtonAt[\s\S]*?\n  \}\n/, 'layout')
    + grab(h, /H\.beaconClick = function[\s\S]*?\n  \};/, 'click');
  new Function('H', 'NS', src)(H, NS);
  o.open = H.openBeacon(1, 2, 3) === true && opened === 'beacon';
  const bs = H.beaconButtons({ primary: null, secondary: null }, 4);
  const P = bs.filter((b) => b.k === 'p');
  o.layout = P.length === 5 && P[0].x === 76 - 23 && P[1].x === 76 + 1 && P[0].y === 22 && P[2].y === 49 && P[4].y === 76 && P[4].x === 76 - 11
    && bs.filter((b) => b.k === 's').length === 1 && bs.find((b) => b.k === 'ok').x === 164 && bs.find((b) => b.k === 'no').x === 190;
  o.gate = H.beaconButtons({ primary: null, secondary: null }, 1).filter((b) => b.k === 'p').map((b) => b.on).join() === 'true,true,false,false,false'
    && H.beaconButtons({ primary: 1, secondary: null }, 4).filter((b) => b.k === 's').length === 2;
  o.slots = H.beaconAt(136, 110) === 0 && H.beaconAt(151, 125) === 0 && H.beaconAt(36, 137) === 1 && H.beaconAt(36, 195) === 28 && H.beaconAt(51, 210) === 28 && H.beaconAt(0, 0) === -1;
  H.beaconOrigin = { x: 0, y: 0, s: 1 };
  calls.length = 0; H.beaconClick(136, 110, 0, true); o.shift = calls.length === 1 && calls[0][0] === 0 && calls[0][1] === 1;
  calls.length = 0; H.beaconClick(300, 300, 0, false); o.out = calls.length === 1 && calls[0][0] === -999;
  H.beaconClick(76 - 23 + 3, 22 + 3, 0, false); o.pick = H.beaconSel.primary === 1;
  H.beaconClick(167 - 11 + 3, 47 + 3, 0, false); o.sec = H.beaconSel.secondary === 10;
  H.beaconClick(164 + 3, 107 + 3, 0, false); o.ok = be.primary === 1 && be.secondary === 10 && closed === 1;
  H.beaconClick(190 + 3, 107 + 3, 0, false); o.no = closed === 2;
  // the menu rules
  const msrc = grab(mu, /var BEACON_PAY[\s\S]*?Menu\.isBeaconPayment = [\s\S]*?\n  \};/, 'pay');
  const Menu = {}; new Function('Menu', 'NS', 'inv', msrc)(Menu, NS, () => NS.Inventory);
  o.pay = Menu.isBeaconPayment({ i: 1, n: 1 }) && Menu.isBeaconPayment({ i: 3, n: 1 }) && !Menu.isBeaconPayment({ i: 2, n: 1 });
  o.cap = /Menu\.slot\(pay, 0, \{ cap: 1, mayPlace: Menu\.isBeaconPayment/.test(mu);
  o.eff = /pay\.set\(0, null\);\s+be\.primary = /.test(mu) && /if \(I\.isEmpty\(st\)\) return false;/.test(mu);
  o.reach = /H\.screen === 'beacon'\) H\.drawBeacon\(c\)/.test(h) && /H\.screen === 'beacon'\) \{ H\.beaconClick/.test(h);
  o.drop = /H\.screen === 'beacon' && H\.beaconMenu\) \{[\s\S]*?bm\.pay\.set\(0, null\)/.test(h);
  o.esc = /H\.screen === 'beacon'/.test(mn);
  return o;
}
const base = trial(); for (const [k, v] of Object.entries(base)) ok(v, 'baseline ' + k);
const BR = [
  ['p0', 'x: 76 + l * 24 - (k >> 1), y: 22 + i * 27', 'x: 76 + l * 24 - (k >> 1), y: 20 + i * 27', ['layout'], 'h'],
  ['ok', 'k: \'ok\', x: 164', 'k: \'ok\', x: 160', ['layout'], 'h'],
  ['gate', 'on: i < levels', 'on: true', ['gate'], 'h'],
  ['pay', "if (i === 0) return [136, 110];", "if (i === 0) return [136, 100];", ['slots'], 'h'],
  ['hot', 'return [36 + (i - 28) * 18, 195];', 'return [36 + (i - 28) * 18, 190];', ['slots'], 'h'],
  ['open', "H.open('beacon');", "H.open('smithing');", ['open'], 'h'],
  ['shift', 'else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);\n    else M.doClick(m, slot, b, M.PICKUP, P);\n    if (P && P.syncHotbar) P.syncHotbar();\n    return true;\n  };\n\n  // --- the smithing table', 'else M.doClick(m, slot, b, M.PICKUP, P);\n    if (P && P.syncHotbar) P.syncHotbar();\n    return true;\n  };\n\n  // --- the smithing table', ['shift'], 'h'],
  ['sec', "sel.secondary = sel.secondary === bt.e ? null : bt.e;", "sel.secondary = null;", ['sec'], 'h'],
  ['paymentany', 'emerald: 1, ', '', ['pay'], 'm'],
  ['paycap', 'cap: 1, mayPlace: Menu.isBeaconPayment', 'cap: 64, mayPlace: Menu.isBeaconPayment', ['cap'], 'm'],
  ['effnopay', 'if (I.isEmpty(st)) return false;\n      pay.set', 'pay.set', ['eff'], 'm'],
  ['undispatched', "H.screen === 'beacon') H.drawBeacon(c)", "H.screen === 'beacon') 0", ['reach'], 'h'],
  ['nodrop', "bm.pay.set(0, null)", "bm.pay.get(0)", ['drop'], 'h'],
  ['esc', "H.screen === 'beacon' || ", "", ['esc'], 'n'],
];
for (const [key, a, b, expect, w] of BR) {
  breaks++; let hit = false, X;
  const p = (s) => { const j = s.indexOf(a); if (j >= 0) { hit = true; return s.slice(0, j) + b + s.slice(j + a.length); } return s; };
  try { X = trial(w === 'h' ? p : null, w === 'm' ? p : null, w === 'n' ? p : null); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key + ' ' + JSON.stringify(X));
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`beaconscreen11725check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
