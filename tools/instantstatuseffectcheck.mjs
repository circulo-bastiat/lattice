#!/usr/bin/env node
// instantstatuseffectcheck.mjs — #11680. InstantStatusEffect (07z_potion.js entry: Po.applySplashPotion
// -> ES.applyInstantEffect): healing/harming applied instantly, scaled by proximity, undead reversed.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07q_effects.js', '07z_potion.js'], dom: false });
const Po = M.Potion, ES = M.Effects;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const mob = (extra) => Object.assign({ x: 0, y: 0, z: 0, health: 10, maxHealth: 20, effects: {}, w: 0.6, h: 1.8 }, extra);
const run = () => {
  ok(Po.hasInstantEffect('healing') && Po.hasInstantEffect('strong_harming'), 'healing/harming are instant');
  ok(!Po.hasInstantEffect('swiftness') && !Po.hasInstantEffect('water'), 'swiftness/water are not instant');
  let a = mob(); Po.applySplashPotion('healing', 0, 0, 0, [a], a, null);
  ok(a.health === 14, 'direct-hit healing heals 4, got ' + a.health);
  a = mob(); Po.applySplashPotion('strong_healing', 0, 0, 0, [a], a, null);
  ok(a.health === 18, 'strong healing heals 8, got ' + a.health);
  a = mob(); Po.applySplashPotion('harming', 0, 0, 0, [a], a, null);
  ok(a.health === 4, 'direct-hit harming deals 6, got ' + a.health);
  a = mob({ x: 2 }); Po.applySplashPotion('healing', 0, 0, 0, [a], null, null);
  ok(a.health === 12, 'half-proximity heals 2, got ' + a.health);
  a = mob(); ES.applyInstantEffect(a, 'instant_health', 0, 0.5, null);
  ok(a.health === 12, 'cloud factor 0.5 heals 2, got ' + a.health);
  a = mob(); ok(!ES.healsOn(a, 'instant_health') === false, 'living mob healed by instant_health');
  a = mob(); ES.applyInstantEffect(a, 'instant_damage', 1, 1, null);
  ok(a.health === 0 || a.dead, 'strong harming (12) kills a 10hp mob');
  a = mob(); Po.applySplashPotion('swiftness', 0, 0, 0, [a], a, null);
  ok(a.health === 10 && a.effects.speed, 'non-instant is stored, not applied as damage/heal');
};
run();
const baseFails = fails.slice(); let breaks = 0;
const caught = (label, brk, undo) => { const before = fails.length; brk(); run(); undo(); if (fails.length > before) breaks++; else baseFails.push('NOT CAUGHT: ' + label); fails.length = before; };
const ai = ES.applyInstantEffect, hi = Po.hasInstantEffect, hl = ES.healsOn;
caught('no instant effect', () => { ES.applyInstantEffect = () => {}; }, () => { ES.applyInstantEffect = ai; });
caught('hasInstantEffect false', () => { Po.hasInstantEffect = () => false; }, () => { Po.hasInstantEffect = hi; });
caught('ignores proximity', () => { ES.applyInstantEffect = (e, f, am, p, at) => ai(e, f, am, 1, at); }, () => { ES.applyInstantEffect = ai; });
caught('heals always reversed', () => { ES.healsOn = (e, f) => f !== 'instant_health'; }, () => { ES.healsOn = hl; });
console.log(`instantstatuseffectcheck: ${pass} ok, ${breaks} breaks caught`);
for (const f of baseFails.slice(0, 20)) console.log('  FAIL ' + f);
console.log(`${breaks} breaks caught`);
process.exit(baseFails.length === 0 && breaks === 4 ? 0 : 1);
