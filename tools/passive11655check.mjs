#!/usr/bin/env node
// passive11655check.mjs — #11655: proves 07w_passive.js's Saddleable (pig saddle), SaddledComponent (boost roll/hump),
// Shearable (sheep shear) and RecipeType.CRAFTING (dye mixing via Recipes.craft) are REACHED from real entry points
// (14l_use.js entityUse/carrot-on-a-stick, 07zzj_strider.js, 17_main/Breed) and that cutting each breaks a scenario.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07w_passive.js'], dom: false, patch: patch ? (f, s) => (f === '07w_passive.js' ? patch(s) : s) : undefined });
  const P = M.Passive, o = {};
  const seq = (v) => () => v;
  // Saddleable
  const pig = { type: 'pig', growAge: 0 }, baby = { type: 'pig', growAge: -100 }, cow = { type: 'cow', growAge: 0 };
  o.canSaddle = P.pigCanBeSaddled(pig) && !P.pigCanBeSaddled(baby) && !P.pigCanBeSaddled(cow);
  o.saddle = P.pigSaddle(pig) === true && pig.saddled === true && P.pigSaddle(pig) === false && P.pigSaddle(baby) === false;
  o.drop = JSON.stringify(P.dropInventory(pig)) === '[{"item":"saddle","count":1}]' && pig.saddled === false;
  // SaddledComponent
  const b = { type: 'pig' };
  o.boostRoll = P.pigBoost(b, seq(0)) === true && b.currentBoostTime === 140 && P.pigBoost(b, seq(0)) === false;
  const b2 = { type: 'pig' }; P.pigBoost(b2, seq(0.9999999));
  o.boostMax = b2.currentBoostTime === 980;
  const hump = { boosted: true, boostedTime: 50, currentBoostTime: 100 };
  const sp = P.pigTravelSpeed(0.25, hump);
  o.hump = Math.abs(sp - 0.25 * 0.225 * 2.15) < 1e-9 && Math.abs(P.pigTravelSpeed(0.25, { boosted: true, boostedTime: 0, currentBoostTime: 100 }) - 0.25 * 0.225) < 1e-9 &&
    Math.abs(P.pigTravelSpeed(0.25, {}) - 0.05625) < 1e-9;
  // Shearable
  const sh = { type: 'sheep', woolColor: 'red', growAge: 0, x: 0, y: 0, z: 0 };
  const d = P.shear(sh, seq(0.99));
  o.shear = d && d.item === 'red_wool' && d.count === 3 && sh.sheared === true && P.shear(sh) === null && P.shear({ type: 'sheep', growAge: -5 }) === null && P.shear({ type: 'cow' }) === null;
  // RecipeType.CRAFTING dye mixing: with Recipes absent falls to coin flip between parents
  o.childFallback = P.childWoolColor('red', 'blue', seq(0.1)) === 'red' && P.childWoolColor('red', 'blue', seq(0.9)) === 'blue';
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
const us = rd('14l_use.js'), st = rd('07zzj_strider.js'), pw = rd('07w_passive.js');
ok(/NS\.Passive\.pigSaddle\(e\)/.test(us), 'reach: Use.entityUse -> Passive.pigSaddle');
ok(/NS\.Passive\.shear\(e, pRand\)/.test(us), 'reach: Use.entityUse -> Passive.shear');
ok(/NS\.Passive\.pigBoost\(P\.vehicle, pRand\)/.test(us), 'reach: carrot-on-a-stick -> Passive.pigBoost');
ok(/NS\.Passive\.pigBoost/.test(st), 'reach: strider shares Passive.pigBoost');
ok(/Passive\.childWoolColor/.test(rd('17_main.js')) && /R\.craft\(\[a, b\], 2, 1, null\)/.test(pw), 'reach: Breed sheep -> childWoolColor -> Recipes.craft (RecipeType.CRAFTING)');
const BR = [
  ['canSaddle', "(e.growAge | 0) >= 0);\n  };\n  Passive.pigIsSaddled", "true);\n  };\n  Passive.pigIsSaddled", ['canSaddle', 'saddle']],
  ['saddleflag', "e.saddled = true;\n    // PigEntity.saddle", "// PigEntity.saddle", ['saddle']],
  ['drop', "return [{ item: 'saddle', count: 1 }];", "return [];", ['drop']],
  ['boostmin', "Passive.PIG_BOOST_MIN = 140;", "Passive.PIG_BOOST_MIN = 0;", ['boostRoll']],
  ['boostlatch', "if (!e || e.boosted) return false;", "if (!e) return false;", ['boostRoll']],
  ['hump', "base * 1.15 * Math.sin", "base * 0 * Math.sin", ['hump']],
  ['shearbaby', "if ((e.growAge | 0) < 0) return null;   // isShearable", "// isShearable", ['shear']],
  ['shearcolor', "(e.woolColor || 'white') + '_wool'", "'white_wool'", ['shear']],
  ['childflip', "return r() < 0.5 ? colorA : colorB;", "return colorA;", ['childFallback']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
for (const f of fails) console.log('FAIL', f);
console.log(`passive11655check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
