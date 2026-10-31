#!/usr/bin/env node
// hungerrowcheck.mjs — #360: the food row (Hunger-effect icons, zero-saturation shake) and the
// ridden mount's heart row that REPLACES it, as blit lists (InGameHud food loop, renderMountHealth).
import { loadEngine } from './loadsrc.mjs';

const MCL = loadEngine({ extra: ['14d_survival.js', '07q_effects.js', '15b_gui.js', '15_hud.js'], dom: false });
const H = MCL.Hud;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };

const us = (row) => row.map((e) => e.r[0]);
const P = { food: 20, saturation: 5, effects: {} };
// normal row: 10 backgrounds (16) + 10 full (52)
let r = H.foodRow(P, 1, () => 0.5);
ok(r.length === 20 && us(r).filter((u) => u === 16).length === 10 && us(r).filter((u) => u === 52).length === 10, 'normal row 16/52');
ok(r.every((e) => e.y === 0), 'no shake with saturation');
// hunger effect: bg 133, full 88, half 97
const Ph = { food: 19, saturation: 5, effects: { hunger: { duration: 100, amplifier: 0 } } };
r = H.foodRow(Ph, 1, () => 0.5);
ok(us(r).filter((u) => u === 133).length === 10 && us(r).filter((u) => u === 88).length === 9 && us(r).filter((u) => u === 97).length === 1, 'hunger icons 133/88/97');
okAv(us(H.foodRow(P, 1, () => 0.5)).indexOf(133) < 0, 'no hunger effect gives no hunger icons');
// shake: saturation 0 on ticks % (food*3+1) == 0 -> y = nextInt(3)-1
const Ps = { food: 20, saturation: 0, effects: {} };
r = H.foodRow(Ps, 61, () => 0);
ok(r.every((e) => e.y === -1), 'shake tick lowest roll y=-1');
r = H.foodRow(Ps, 61, () => 0.99);
ok(r.every((e) => e.y === 1), 'shake tick highest roll y=+1');
ok(H.foodRow(Ps, 60, () => 0).every((e) => e.y === 0), 'off-tick no shake');
okAv(H.foodRow({ food: 20, saturation: 3, effects: {} }, 61, () => 0).every((e) => e.y === 0), 'saturation left => no shake');
// mount: 30-hp horse => 15 hearts, 2 rows
const horse = { maxHealth: 30, health: 30 };
ok(H.mountHeartCount(horse) === 15 && H.mountRows(15) === 2, '30 hp = 15 hearts, 2 rows');
r = H.mountRow(horse);
ok(us(r).filter((u) => u === 52).length === 15 && us(r).filter((u) => u === 88).length === 15, 'mount bg+full x15');
ok(r.filter((e) => e.y === 0).length === 20 && r.filter((e) => e.y === -10).length === 10, 'rows 10px apart');
ok(r[0].x === 82, 'mount hearts start at right edge (width/2+91-9)');
const half = H.mountRow({ maxHealth: 30, health: 29 });
ok(us(half).filter((u) => u === 97).length === 1, 'odd health => half heart');
ok(H.mountHeartCount({ maxHealth: 200 }) === 30, 'capped at 30');
ok(H.mountHeartCount(null) === 0 && H.mountHeartCount({}) === 0, 'no vehicle / not living => 0 (food row shown)');
okAv(H.mountHeartCount(horse) === 15, 'a ridden horse must yield hearts (a check that ignores the vehicle gets 0)');

if (fails.length) { console.log('hungerrowcheck FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`hungerrowcheck ${pass} assertions, ${breaks} breaks caught`);
