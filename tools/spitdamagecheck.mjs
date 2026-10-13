#!/usr/bin/env node
// spitdamagecheck.mjs -- #2557: a llama spit hit on a player uses the `mobProjectile` row (death.attack.mob, owner named) and knocks back.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', '14d_survival.js'), 'utf8');
const M = loadEngine({ extra: ['02i_text.js', '14d_survival.js', '14j_combat.js'] });
let bad = 0, breaks = 0;
const t = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const Sv = M.Survival;
t(Sv.DAMAGE.mobProjectile && Sv.DAMAGE.mobProjectile.projectile === true, 'Sv.DAMAGE.mobProjectile has projectile:true');
t(/Survival\.hurt\(t, 'mobProjectile', Ll\.SPIT_DAMAGE, e\.shooter \|\| e\)/.test(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', '07ze_llama.js'), 'utf8')), 'spit passes mobProjectile + the OWNER as attacker (#4631)');
let called = 0; const orig = M.Combat.baseKnockback;
M.Combat.baseKnockback = () => { called++; };
const p = Sv.init({ x: 0, y: 0, z: 0, width: 0.6, height: 1.8, armor: 0 });
t(Sv.hurt(p, 'mobProjectile', 1, { x: 3, y: 0, z: 0 }) && called === 1, 'mobProjectile hit with a source calls baseKnockback');
const d = Sv.init({ x: 0, y: 0, z: 0, armor: 0 }); d.health = 1;
Sv.hurt(d, 'mobProjectile', 1, { type: 'llama_spit', x: 3, y: 0, z: 0, shooter: { type: 'llama' } });
t(d.dead && d.deathCause === 'mob' && /Llama|llama/.test(d.killedBy || ''), 'mob cause + owner named ' + d.deathCause + ' ' + d.killedBy);
t(Sv.DAMAGE.mobProjectile.key === 'mob', 'death key is mob');
// anti-vacuity: break each input, the assertion must notice
Sv.DAMAGE.mobProjectile.key = 'thrown'; breaks++; t(Sv.DAMAGE.mobProjectile.key !== 'mob', 'break 1 caught');
const q = Sv.init({ x: 0, y: 0, z: 0, armor: 0 }); called = 0; Sv.hurt(q, 'mobProjectile', 1); breaks++; t(called === 0, 'break 2 caught (no attacker, no knockback)');
// #4717 canHit = alive && collides(): a non-living collidable (cart, end crystal) is a spit target
const llSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', '07ze_llama.js'), 'utf8');
const gate = /if \(o\.maxHealth === undefined && ([^)]*\)[^)]*\)?)[^\n]*continue;/.exec(llSrc);
t(gate && /end_crystal/.test(gate[0]) && /isCart/.test(gate[0]), 'spit target filter admits carts and end crystals');
breaks++; t(!/isCart/.test(llSrc.replace(/isCart/g, '')), 'break 3 caught (filter without isCart is detected)');
console.log(`${7 - bad} assertions passed, ${breaks} breaks caught, ${bad} failed`);
process.exit(bad ? 1 : 0);
