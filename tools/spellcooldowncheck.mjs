#!/usr/bin/env node
// spellcooldowncheck.mjs — #6342. SP.CastSpellGoal casts on the same server tick as vanilla's CastSpellGoal.
// Vanilla (SpellcastingIllagerEntity.java:98-138): start() sets spellCooldown = getTickCount(20) = 10 goal ticks
// (goals tick every 2nd real tick, start tick included) -> cast at start+18; startTime = age+delay (fangs 100).
// Spell lasts spellTicks (fangs 40) so the next start is at age 100 -> casts at 18, 118, 218, ...
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
console.log('spellcooldowncheck — #6342 evoker fangs cast ticks equal the .decomp-derived list');
const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.Ai.init();
const SP = M.Spell, EL = M.EntityList;
function casts(initialCooldown) {
  const e = EL.spawn('evoker', 0, 9, 0);
  e.target = { dead: false, health: 20 }; e.age = 0;
  const out = [];
  const g = new SP.CastSpellGoal(e, {}, { spellId: SP.FANGS, spellTicks: 40, startTimeDelay: 100, initialCooldown, castSpell: () => out.push(e.age) });
  let running = false;
  for (let t = 0; t < 600; t++) {
    e.age = t;
    if (!running && g.canUse()) { g.start(); running = true; }
    if (running) { if (!g.canContinueToUse()) { g.stop(); running = false; } else g.tick(); }
    if (e.spellTicks > 0 && --e.spellTicks <= 0) e.spell = 0;
  }
  return out;
}
const want = [18, 118, 218, 318, 418, 518].join();
let fails = 0, breaks = 0;
if (casts(20).join() !== want) { fails++; console.log(' x got ' + casts(20).join() + ' want ' + want); }
if (casts(10).join() !== want) { breaks++; console.log(' ✓ break noticed'); }
console.log('\nspellcooldowncheck: 1 assertions, ' + fails + ' failures, ' + breaks + ' breaks caught');
process.exit(fails || breaks < 1 ? 1 : 0);
