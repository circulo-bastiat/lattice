#!/usr/bin/env node
// cartdamagecheck.mjs -- #4241: a minecart is struck by the player (Combat.attack), arrows (arrowStrikeEntity) and
// explosions (Explosion.damageEntities) through NS.Minecart.damage, end to end. Anti-vacuity: break each hook.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

console.log('cartdamagecheck -- #4241, melee/arrow/explosion reach Minecart.damage');
const ASSETS = join(MCLITE_ROOT, 'assets');

function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  const M = loadEngine({
    extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
            '14e_gamemode.js', '07q_effects.js', '07zzr_minecart.js', '07za_explosion.js', '14j_combat.js', '14d_survival.js'],
    initReg: false, patch });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
  M.Entities.init();
  M.EntityList.init(); M.Combat.init();
  const Cb = M.Combat, Mc = M.Minecart, Ex = M.Explosion;
  Ex.ready = true; Ex.getExposure = () => 1;
  const mk = (type) => ({ type, x: 0, y: 64, z: 0, vx: 0, vy: 0, vz: 0, width: 0.98, height: 0.7, cartWobbleSide: 1, cartWobbleTicks: 0,
    cartDamageWobble: 0, cartWobbleStrength: 0, cartFuse: -1, removed: false });
  const P = M.Player = { x: 2, y: 64, z: 0, inventory: null, slot: 0 };

  // melee: Cb.hurt as Combat.attack calls it; canAttack must admit a cart
  let c = mk('minecart');
  ok(Cb.canAttack(c), 'a cart can be attacked');
  ok(Cb.hurt(c, 3, undefined, true) === true && c.cartWobbleStrength === 30, 'a hit wobbles the cart (strength 30)');
  const evs = []; M.GameEvents = { emit: (ev) => evs.push(ev) };
  Cb.hurt(c, 3, undefined, true);
  ok(evs.length === 1 && evs[0] === 'entity_damaged', 'a hit emits entity_damaged');
  ok(c.removed === true, 'a second hit breaks it (strength 60 > 40)');

  // arrow: a flaming arrow primes+explodes a tnt cart; a plain one just wobbles
  c = mk('tnt_minecart'); M.EntityList.list.push(c);
  const arrow = { type: 'arrow', x: 0, y: 70, z: 0, vx: 0, vy: -3, vz: 0, shooter: P, isOnFire: false };
  ok(Cb.arrowStrikeEntity(arrow, 0, 64.8, 0, 0, -1, 0) === true && c.removed, 'an arrow breaks the cart (wobble > 40)');
  c = mk('tnt_minecart'); M.EntityList.list.push(c);
  let boom = 0; const oe = Mc.explode; Mc.explode = (e, s) => { boom++; e.removed = true; };
  const fa = { type: 'arrow', x: 0, y: 70, z: 0, vx: 0, vy: -3, vz: 0, shooter: P, isOnFire: true };
  Cb.arrowStrikeEntity(fa, 0, 64.8, 0, 0, -1, 0);
  ok(boom === 1 && c.removed, 'a flaming arrow explodes a tnt cart');
  Mc.explode = oe;

  // fire/lava/in_fire damage primes a tnt cart (TntMinecartEntity.dropItems: isFire) and drops nothing
  for (const source of ['inFire', 'lava', 'onFire', 'hotFloor']) {
    M.EntityList.list.length = 0;
    c = mk('tnt_minecart'); c.cartWobbleStrength = 50; M.EntityList.list.push(c);
    Cb.hurt(c, 3, undefined, false, { source, fire: true });
    ok(c.cartFuse >= 0 && !M.EntityList.list.some((o) => o.type === 'item'), `${source} primes the tnt cart, no item drops`);
  }

  // explosion: a blast beside a cart wobbles it (strength > 0)
  M.EntityList.list.length = 0;
  c = mk('minecart'); c.x = 1; M.EntityList.list.push(c);
  const hits = Ex.damageEntities({ type: 'tnt', x: 0, y: 64, z: 0 }, 0, 64, 0, 4);
  ok(c.cartWobbleStrength > 0, 'an explosion wobbles a cart');
  return { fails, n };
}

const real = scenarios();
const fails = real.fails.slice(); let breaks = 0;
const breaksList = [
  ['hurt hook removed', 'if (Cb.isCart(e) && NS.Minecart.damage) {', 'if (false) {', '14j_combat.js'],
  ['entity_damaged not emitted', "NS.GameEvents.emit('entity_damaged'", "NS.GameEvents.emit('x'", '07zzr_minecart.js'],
  ['canAttack ignores carts', "e.type === 'end_crystal' || Cb.isCart(e) ||", "e.type === 'end_crystal' ||", '14j_combat.js'],
  ['arrow scan drops carts', "o.type !== 'end_crystal' && !Cb.isCart(o) && o.type !== 'fireball'", "o.type !== 'end_crystal' && o.type !== 'fireball'", '14j_combat.js'],
  ['flaming speed not passed', 'flamingArrowSpeed2: e.isOnFire ?', 'flamingArrowSpeed2: false ?', '14j_combat.js'],
  ['explosion scan drops carts', "e.type !== 'end_crystal' && !Ex.NONLIVING[e.type] && !(Cb && Cb.isCart && Cb.isCart(e))) continue;", "e.type !== 'end_crystal' && !Ex.NONLIVING[e.type]) continue;", '07za_explosion.js'],
  ['inFire/lava not fire', "src.source === 'inFire' || src.source === 'lava' || src.source === 'hotFloor'", "false", '14j_combat.js'],
];
for (const [label, a, b, file] of breaksList) {
  let matched = true;
  const patch = (f, src) => { if (f !== file) return src; if (!src.includes(a)) matched = false; return src.split(a).join(b); };
  let r;
  try { r = scenarios(patch); } catch (err) { r = { fails: ['threw: ' + err.message] }; }
  if (!matched) { fails.push('anti-vacuity: edit for "' + label + '" matched nothing'); continue; }
  if (r.fails.length > 0) { breaks++; console.log('   ✓ break caught: ' + label); }
  else fails.push('anti-vacuity: breaking "' + label + '" went unnoticed');
}
if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log(`cartdamagecheck: ${real.n} assertions, 0 failures, ${breaks} breaks caught`);
