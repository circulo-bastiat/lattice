#!/usr/bin/env node
// guardianthornscheck.mjs — #3829: GuardianEntity.damage reflects thorns only for !source.isMagic() sources;
// DamageSource.thorns / indirectMagic / magic are all isMagic (DamageSource.java:31,98,101-102).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const MODS = []; for (const m of readFileSync(join(MCLITE_ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
const G = M.Guardian;
let hits = 0;
M.Combat = { hurt() { hits++; return true; } };
const guard = () => ({ type: 'guardian', spikesRetracted: false, health: 30, maxHealth: 30 });
const mob = { type: 'zombie', x: 0, y: 0, z: 0, health: 20, maxHealth: 20 };
const fails = []; let breaks = 0;
for (const tag of ['thorns', 'indirect_magic', 'magic']) {
  hits = 0;
  if (G.onDamage(guard(), mob, { source: tag }) !== false || hits) fails.push(tag + ' must not reflect thorns');
}
hits = 0;
hits = 0;
for (const s of [{ projectile: true }, { projectile: true, sourceEntity: {} }]) { hits = 0; if (G.onDamage(guard(), mob, s) !== false || hits) fails.push('src.projectile must not reflect thorns'); }
if (G.onDamage(guard(), mob, { attacker: mob, explosive: true }) !== false || hits) fails.push('explosive source (creeper/TNT) must not reflect thorns');
hits = 0;
if (G.onDamage(guard(), mob, { source: 'melee' }) !== true || hits !== 1) fails.push('melee control must reflect thorns');
// anti-vacuity: a guardian that reflected everything would be caught by the loop above
{ const real = G.onDamage; G.onDamage = (e, a) => { G.hurtMagic(a, 2, e, true); return true; };
  hits = 0; const r = G.onDamage(guard(), mob, { source: 'thorns' }); breaks++;
  if (r !== true) fails.push('anti-vacuity: broken onDamage not noticed'); else console.log('   ✓ a reflect-everything guardian is caught by the thorns loop'); G.onDamage = real; }
console.log('guardianthornscheck: 6 assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
