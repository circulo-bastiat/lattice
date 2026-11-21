#!/usr/bin/env node
// endercrystalhealcheck.mjs -- #1803: EnderDragonEntity.tickWithEndCrystals (connect nearest crystal
// within 32, heal +1 per 10 ticks, drop a removed crystal) and the connectedCrystal head-damage branch.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, caught = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function mk(connect = true) {
  const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '07zzl_enderdragon.js'] });
  const ED = M.EnderDragon;
  const rng = { nextInt: () => 0, nextFloat: () => 0.5 };
  const d = new ED.EnderDragonEntity({ x: 0, y: 100, z: 0, random: rng });
  const cr = { type: 'end_crystal', x: 20, y: 100, z: 0, removed: false };
  d.crystalsFn = () => [cr];
  if (!connect) d.tickWithEndCrystals = function () {};
  return { ED, d, cr };
}
function run(connect) {
  const m = mk(connect);
  m.d.health = 100;
  for (let i = 1; i <= 100; i++) { m.d.age = i; m.d.tickWithEndCrystals(); }
  return m;
}
{
  const { d, cr, ED } = run(true);
  ok(d.connectedCrystal === cr, 'nearest crystal connected');
  ok(d.health >= 109 && d.health <= 110, 'healed ~+10 over 100 ticks, got ' + d.health);
  const h0 = d.health; d.phaseManager.setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
  d.crystalDestroyed(cr, cr, {});
  ok(d.health < h0, 'connected crystal destroyed damages head');
  cr.removed = true; d.age = 1; d.random = { nextInt: () => 1 };
  d.tickWithEndCrystals();
  ok(d.connectedCrystal === null, 'removed crystal dropped');
}
{ const { d } = run(false);
  if (d.health < 109) { caught++; console.log('  ✓ heal breaks without connect'); } else fails.push('anti-vacuity: heal passed with connect removed'); }
{ const m = mk(true); m.cr.x = 200; m.d.health = 100;
  for (let i = 1; i <= 20; i++) { m.d.age = i; m.d.tickWithEndCrystals(); }
  if (m.d.connectedCrystal === null && m.d.health === 100) { caught++; console.log('  ✓ out-of-range never connects'); } else fails.push('anti-vacuity: out-of-range crystal connected'); }
if (fails.length) { console.log('FAIL ' + fails.join('; ')); process.exit(1); }
console.log(`OK  ${pass} checks passed, 0 failures; ${caught} breaks caught`);
