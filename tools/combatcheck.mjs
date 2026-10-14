#!/usr/bin/env node
// combatcheck.mjs — PLAN G17d, melee combat (D-336, D-338).
//
//   node tools/combatcheck.mjs [--verbose]
//
// ⚠⚠ WHY THIS EXISTS. Dan, session 11: *"there is no combat"*. There was not, and the reason was
// three separate absences that each looked like somebody else's job: no entity had health
// (D-336), no item had an attack damage (D-271, paid in D-335), and nothing could pick an entity
// with the crosshair. This file holds all three, and it holds the damage FORMULA, which is the
// part that will be quietly wrong for ever if nobody writes it down.
//
// ⚠ AND IT IS DELIBERATELY A NUMBERS CHECK. `combatcheck` cannot see a mob, because nothing draws
// one yet — G18 owes that. What it CAN do is drive the real functions with the real tables and
// assert the arithmetic against vanilla's, so that when G18 arrives the only new thing is the
// picture. ⚠ PLAN §23's lesson applies in reverse here: a stage whose output is a moving picture
// must not be declared done on numbers alone, which is exactly why this stage is NOT declared
// done — `Cb.OWED` and G18 both say so, on every run.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };
const near = (a, b, t) => Math.abs(a - b) <= (t === undefined ? 1e-9 : t);

console.log('combatcheck — PLAN G17d, melee combat (D-336, D-338)');

const M = loadEngine({
  extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '14e_gamemode.js', '07q_effects.js',
          '07y_equip.js', '14j_combat.js', '14d_survival.js', '07zx_particle.js'],
  initReg: false
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.Items.init({
  items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'),
  itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes
});
// the attribute table, read from the golden file rather than from a copy typed here (D-305)
{
  const table = {};
  for (const line of readFileSync(join(ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r(c[6]), r(c[7]), +c[8]];
  }
  M.Hand.bindAttrs(table);
}
// a world of nothing but a floor, so motion is arithmetic and not terrain (the entlistcheck idiom)
const FLOOR_Y = 64;
M.Physics.shapeAt = (x, y, z) => (y < FLOOR_Y ? M.Physics.FULL_CUBE : null);
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.Physics.grounded = (x, y, z, d) => y - d < FLOOR_Y;
M.EntityList.init();
M.Combat.init();
const EL = M.EntityList, Cb = M.Combat, Ent = M.Entities, H = M.Hand, Inv = M.Inventory;

// ═══════════ 1. what is living, and what its health is ═══════════════════════════════════════
console.log('\n1. the living set, and where its numbers come from');
{
  ok(Ent.ready, 'the entity table did not load');
  const living = Ent.living();
  console.log(`   living .......... ${living.length} of ${Ent.count} types have a max health`);
  ok(living.length === 74, `${living.length} types resolve a max health; the jar's answer is 74`);
  // ⚠ THE ANCHORS ARE CASES THAT CANNOT BE IN DOUBT and they are asserted HERE too, not only in
  // the extractor: the extractor proves the READ, this proves what the engine actually shipped.
  for (const [n, hp] of [['zombie', 20], ['creeper', 20], ['bat', 6], ['cow', 10],
                         ['turtle', 30], ['guardian', 30], ['dolphin', 10],
                         ['ender_dragon', 200], ['wither', 300], ['iron_golem', 100]]) {
    ok(Ent.maxHealth(n) === hp, `${n} has ${Ent.maxHealth(n)} health; vanilla's is ${hp}`);
  }
  // ⚠ AND THE OTHER DIRECTION: the things that are NOT living must not be attackable.
  for (const n of ['item', 'falling_block', 'tnt', 'arrow', 'boat', 'experience_orb', 'minecart']) {
    ok(!Ent.isLiving(n), `${n} is not a living entity and must have no health`);
  }
  // `Entities.isLiving` and the spawned entity's `living` flag are DIFFERENT QUESTIONS (D-336)
  const turtle = EL.spawn('turtle', 0, FLOOR_Y, 0);
  ok(!!turtle, 'a turtle could not be spawned');
  ok(turtle.maxHealth === 30 && turtle.health === 30, 'a spawned turtle starts at full health');
  ok(turtle.living === false,
     '`e.living` is the PHYSICS fall-damage flag and must not have been repurposed for health');
  const block = EL.spawn('falling_block', 0, FLOOR_Y, 0);
  ok(block.maxHealth === undefined, 'a falling block is given no health at all');
  ok(Cb.canAttack(turtle) && !Cb.canAttack(block), 'only the living can be attacked');
  EL.clear();
}

// ═══════════ 2. the item attributes reach the formula ════════════════════════════════════════
console.log('\n2. what the held item is worth');
{
  const s = (n) => Inv.stack(n, 1);
  ok(H.attrCount === 30, `${H.attrCount} items carry an attribute modifier; the jar's roster is 30`);
  ok(near(H.attackDamageFor(s('diamond_sword')), 7), 'a diamond sword is 7 damage');
  ok(near(H.attackSpeedFor(s('diamond_sword')), 1.6), '...at 1.6 attacks a second');
  ok(near(H.attackDamageFor(Inv.EMPTY), 1), 'an empty hand is 1 damage');
  ok(H.isSword(s('diamond_sword')) && !H.isSword(s('diamond_axe')) && !H.isSword(s('stone')),
     'only swords are swords — an axe is not, and neither is a block');
  ok([...'wooden stone iron golden diamond netherite'.split(' ')]
       .every((t) => H.isSword(s(t + '_sword'))), 'all six swords are swords');
}

// ═══════════ 3. the damage formula ═══════════════════════════════════════════════════════════
// ⚠ EVERY MULTIPLIER IS ASSERTED SEPARATELY, because they compose: a bug in the ramp and a bug in
// the crit can cancel at one charge level and be wrong everywhere else. The engine is driven
// through `Cb.attack` with the real player fields, not through a re-implementation here.
console.log('\n3. the damage formula');
{
  const mkPlayer = (over) => Object.assign({
    x: 0, y: FLOOR_Y, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0,
    inventory: Inv.create ? Inv.create() : null,
    sprinting: false, onGround: true, fallDistance: 0, onClimbable: false, inWater: false,
    walkDist: 0, walkDistO: 0, speed: 0.1
  }, over || {});
  const arm = (P, item) => {
    if (!P.inventory) return;
    Inv.setItem(P.inventory, P.slot, item ? Inv.stack(item, 1) : Inv.EMPTY);
  };
  const target = (hp) => {
    const e = EL.spawn('turtle', 2, FLOOR_Y, 0);
    if (hp !== undefined) { e.maxHealth = hp; e.health = hp; }
    return e;
  };

  // ── the cooldown ramp: 0.2 + h*h*0.8 ────────────────────────────────────────────────────
  EL.clear();
  {
    const P = mkPlayer();
    ok(!!P.inventory, 'the check could not build an inventory');
    arm(P, 'diamond_sword');
    const e = target(1000);
    H.reset();
    // ⚠ A SWING RIGHT AFTER A SWING IS NOT AT ZERO CHARGE. `Player.attack` asks for
    // `getAttackStrengthScale(0.5)` — half a tick of interpolation — so even a freshly reset
    // ticker gives `0.5 / delay`, and with a sword's 12.5-tick delay that is 0.04. The first
    // version of this assertion expected a clean 0.2 x 7 and the engine was right.
    const ramp = (hh) => 7 * (Cb.RAMP_BASE + hh * hh * Cb.RAMP_SCALE);
    const h0 = 0.5 / 12.5;
    const r0 = Cb.attack(P, e);
    ok(near(r0.damage, ramp(h0), 1e-6),
       `an uncharged swing is ${r0.damage}; the ramp at h=${h0} gives ${ramp(h0)}`);
    // fully charged: h = 1, so the hit is worth all of it
    for (let i = 0; i < 40; i++) H.tickAttackStrength();
    const before = e.health;
    e.invulnerableTime = 0; e.lastHurt = 0;
    const r1 = Cb.attack(P, e);
    ok(near(r1.damage, 7, 1e-6), `a fully charged swing is ${r1.damage}; vanilla's is 7`);
    ok(near(before - e.health, 7, 1e-6), 'and that is what the target actually lost');
    ok(r1.full === true && r0.full === false, 'only the charged swing counts as full strength');
    // ⚠ THE RAMP IS QUADRATIC, NOT LINEAR. Half charge must be well under half damage.
    H.reset();
    for (let i = 0; i < 6; i++) H.tickAttackStrength();
    e.invulnerableTime = 0; e.lastHurt = 0;
    const half = Cb.attack(P, e);
    const h = 6.5 / 12.5;                                     // the half-tick again
    ok(near(half.damage, ramp(h), 1e-6), `a ${(h * 100) | 0}% charge is ${half.damage}`);
    ok(half.damage < 7 * h, 'the ramp is quadratic — half charge is less than half damage');
    console.log(`   ramp ............ h=${h0.toFixed(2)} ${r0.damage.toFixed(3)} · h=${h.toFixed(2)} ${half.damage.toFixed(3)} · h=1 ${r1.damage.toFixed(3)}`);
  }

  // ── the critical hit ────────────────────────────────────────────────────────────────────
  EL.clear();
  {
    const mk = (over) => { const P = mkPlayer(over); arm(P, 'diamond_sword'); return P; };
    const charged = (P, e) => { H.reset(); for (let i = 0; i < 40; i++) H.tickAttackStrength();
                                e.invulnerableTime = 0; e.lastHurt = 0; return Cb.attack(P, e); };
    const e = target(1000);
    const flat = charged(mk({}), e);
    const crit = charged(mk({ onGround: false, fallDistance: 1.5 }), e);
    ok(flat.crit === false, 'a blow struck standing on the ground is not a crit');
    ok(crit.crit === true, 'a blow struck while falling is');
    ok(near(crit.damage, flat.damage * Cb.CRIT_MULTIPLIER, 1e-6),
       `a crit is ${crit.damage} against ${flat.damage} — ${Cb.CRIT_MULTIPLIER}x`);
    // ⚠ AND SPRINTING CANCELS IT, which is the rule every player knows as a habit
    const sprintCrit = charged(mk({ onGround: false, fallDistance: 1.5, sprinting: true }), e);
    ok(sprintCrit.crit === false, 'sprinting cancels the crit');
    // as does rising rather than falling
    const rising = charged(mk({ onGround: false, fallDistance: 0 }), e);
    ok(rising.crit === false, 'and so does jumping UP — the fall distance must be positive');
    const swimming = charged(mk({ onGround: false, fallDistance: 1.5, inWater: true }), e);
    ok(swimming.crit === false, 'and so does being in water');
    const climbing = charged(mk({ onGround: false, fallDistance: 1.5, onClimbable: true }), e);
    ok(climbing.crit === false, 'and so does being on a ladder');
  }

  // ── the invulnerability gate, which is the subtle one ───────────────────────────────────
  EL.clear();
  {
    const P = mkPlayer(); arm(P, 'diamond_sword');
    const e = target(1000);
    H.reset(); for (let i = 0; i < 40; i++) H.tickAttackStrength();
    ok(Cb.hurt(e, 5) === true, 'the first hit lands');
    ok(e.health === 995 && e.invulnerableTime === Cb.INVULNERABLE_TICKS,
       'and buys 20 ticks of grace');
    ok(Cb.hurt(e, 3) === false && e.health === 995,
       'a SMALLER hit inside the grace does nothing at all');
    ok(Cb.hurt(e, 8) === true && e.health === 992,
       'a BIGGER one lands only the difference — 8 after 5 is 3 more, not 8');
    // and the grace really does expire
    for (let i = 0; i < Cb.INVULNERABLE_TICKS; i++) Cb.tickEntity(e);
    ok(e.invulnerableTime === 0, 'the grace runs out');
    ok(Cb.hurt(e, 1) === true && e.health === 991, 'and then even a small hit lands in full');
    ok(e.hurtTime === Cb.HURT_DURATION, 'the red flash is set to its full ten ticks');
  }

  // ── death ───────────────────────────────────────────────────────────────────────────────
  EL.clear();
  {
    const e = target(4);
    ok(Cb.hurt(e, 10) === true, 'an overkill hit lands');
    ok(e.health === 0 && e.dead === true, 'health floors at zero and the entity is dead');
    ok(Cb.canAttack(e) === false, 'a dead entity cannot be attacked again');
    ok(e.removed === false, 'but it is not removed on the same tick — the death animation runs');
    for (let i = 0; i < Cb.DEATH_TICKS; i++) Cb.tickEntity(e);
    ok(e.removed === true, `and it is gone after ${Cb.DEATH_TICKS} ticks`);
  }
}

// ═══════════ 4. knockback ════════════════════════════════════════════════════════════════════
console.log('\n4. knockback');
{
  EL.clear();
  const e = EL.spawn('turtle', 0, FLOOR_Y, 0);
  e.onGround = true; e.vx = 0; e.vy = 0; e.vz = 0;
  // pushed due north (yaw 0 in this engine), the impulse is entirely -Z
  Cb.knockback(e, 0.5, 0, -1);
  ok(near(e.vz, 0.5), `pushed north, vz becomes ${e.vz}; it should be +0.5 (the impulse is SUBTRACTED)`);
  ok(near(e.vx, 0), 'and nothing sideways');
  ok(near(e.vy, 0.4), `it is lifted to ${e.vy}, clamped at ${Cb.KNOCKBACK_UP_CLAMP}`);
  // ⚠ IT HALVES WHAT IS ALREADY THERE. A second hit does not double the flight.
  e.vx = 2; e.vz = 2; e.vy = 0; e.onGround = true;
  Cb.knockback(e, 0.5, 1, 0);
  ok(near(e.vx, 2 / 2 - 0.5) && near(e.vz, 1),
     `existing motion is halved before the impulse: vx ${e.vx}, vz ${e.vz}`);
  // in the air there is no lift at all
  e.vy = -0.5; e.onGround = false;
  Cb.knockback(e, 0.5, 1, 0);
  ok(near(e.vy, -0.5), 'a target hit in mid-air keeps its fall — the lift is an onGround rule');
  // knockback resistance scales it away
  e.knockbackResistance = 1; e.vx = 0; e.vz = 0; e.onGround = true;
  ok(Cb.knockback(e, 0.5, 1, 0) === false && e.vx === 0,
     'full knockback resistance refuses the push entirely');
  EL.clear();
}

// ═══════════ 4b. s135: every fresh hit with an attacker knocks back 0.4 ══════════════════════
console.log('\n4b. base knockback (LivingEntity.damage takeKnockback(0.4F)) — Dan: "nothing takes knockback"');
{
  EL.clear();
  const hadP = M.Player; const P = hadP || (M.Player = { type: 'player', x: 0, y: 0, z: 0, health: 20, armor: 0, armorToughness: 0, exhaustion: 0, absorption: 0, lastHurt: 0 });
  const px = P.x, py = P.y, pz = P.z;
  const e = EL.spawn('zombie', 0, FLOOR_Y, 0);
  P.x = 3; P.y = FLOOR_Y; P.z = 0;
  e.onGround = true; e.vx = 0; e.vy = 0; e.vz = 0; e.invulnerableTime = 0;
  ok(Cb.hurt(e, 1, undefined, true) === true, 'a player blow lands');
  ok(near(e.vx, -0.4) && near(e.vz, 0) && near(e.vy, 0.4), `pushed AWAY from the player at +X: vx ${e.vx}, vy ${e.vy}`);
  e.vx = 0; e.vy = 0; e.onGround = true;
  ok(Cb.hurt(e, 5, undefined, true) === true && near(e.vx, 0), `a docked (bigger-than-last) hit inside the window deals damage but does not push (vx ${e.vx})`);
  e.invulnerableTime = 0; e.vx = 0;
  Cb.hurt(e, 1, undefined, false, { bypassArmor: true, source: 'onFire' });
  ok(near(e.vx, 0), 'fire (no attacker) does not push');
  const arrowFrom = { x: 0, y: FLOOR_Y, z: -5, type: 'skeleton' };
  e.invulnerableTime = 0; e.vx = 0; e.vz = 0; e.onGround = true;
  Cb.hurt(e, 1, undefined, false, { attacker: arrowFrom });
  ok(near(e.vz, 0.4), `a shot pushes away from the SHOOTER (vz ${e.vz})`);
  const saved = Cb.baseKnockback; Cb.baseKnockback = () => false;
  e.invulnerableTime = 0; e.vx = 0; e.onGround = true;
  Cb.hurt(e, 1, undefined, true);
  Cb.baseKnockback = saved;
  okAv(near(e.vx, 0), 'anti-vacuity: without the base knockback (the pre-s135 engine) the same blow leaves the zombie standing');
  // the player, hit by a mob
  if (M.Survival && M.Survival.hurt) {
    const Sv = M.Survival;
    P.dead = false; P.invulnerableGamemode = false; P.invulnerable = 0; P.health = 20;
    P.x = 0; P.z = 0; P.vx = 0; P.vy = 0; P.vz = 0; P.onGround = true;
    const z2 = { x: 0, y: FLOOR_Y, z: 2, type: 'zombie' };
    ok(Sv.hurt(P, 'mob', 2, z2) === true && near(P.vz, -0.4), `a zombie's blow pushes the player away from it (vz ${P.vz})`);
    P.invulnerable = 0; P.vz = 0; P.onGround = true;
    Sv.hurt(P, 'fall', 2);
    ok(near(P.vz, 0), 'fall damage (no attacker) does not push the player');
    P.health = 20;
  }
  P.x = px; P.y = py; P.z = pz;
  if (!hadP) delete M.Player;
  EL.clear();
}

// ═══════════ 5. picking an entity with the crosshair ═════════════════════════════════════════
console.log('\n5. picking');
{
  EL.clear();
  // ⚠⚠ THE RAY MUST POINT AT THE TARGET, AND THE FIRST VERSION OF THIS SECTION DID NOT. A turtle
  // is 0.4 TALL and the eye is 1.62 up, so a perfectly horizontal ray sails over every turtle in
  // the world — the engine was right and the test was standing up straight. The direction is
  // built from the eye to the target's middle, which is what looking at something means.
  const eye = [0, FLOOR_Y + 1.62, 0];
  const nearT = EL.spawn('turtle', 0, FLOOR_Y, -3);     // three blocks due north
  const farT = EL.spawn('turtle', 0, FLOOR_Y, -4.5);
  const aimAt = (e) => {
    const dx = e.x - eye[0], dy = (e.y + e.height * 0.5) - eye[1], dz = e.z - eye[2];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return [dx / L, dy / L, dz / L];
  };
  const dir = aimAt(nearT);
  const hit = Cb.pick(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], 5);
  ok(!!hit, 'a turtle three blocks ahead was not picked at all');
  ok(hit && hit.entity === nearT, 'the NEARER of two turtles in a line must win');
  ok(!!farT, 'the second turtle was not spawned');
  // behind the player: nothing
  ok(Cb.pick(eye[0], eye[1], eye[2], -dir[0], -dir[1], -dir[2], 5) === null,
     'nothing is picked behind the player');
  // out of reach
  ok(Cb.pick(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], 2) === null, 'nor beyond the reach');
  // #4613: margin 0 for ordinary entities (a ray just outside the box misses), 1.0 for fireballs
  EL.clear();
  const t = EL.spawn('turtle', 0, FLOOR_Y, -3);
  const halfW = t.width / 2;
  ok(Cb.pick(halfW - 0.05, FLOOR_Y + 0.2, 0, 0, 0, -1, 5) !== null, 'a ray inside the box hits');
  ok(Cb.pick(halfW + 0.1, FLOOR_Y + 0.2, 0, 0, 0, -1, 5) === null, 'a ray 0.1 outside an ordinary box misses (margin 0)');
  ok(Cb.targetingMargin({ type: 'fireball' }) === 1 && Cb.targetingMargin({ type: 'turtle' }) === 0, 'fireball margin 1.0, others 0');
  // a dead entity is not pickable
  t.health = 0; t.dead = true;
  ok(Cb.pick(0, FLOOR_Y + 0.2, 0, 0, 0, -1, 5) === null, 'a dead entity cannot be picked');
  EL.clear();
}

// ═══════════ 5b. who may attack ══════════════════════════════════════════════════════════════
// ⚠⚠ THIS SECTION EXISTS BECAUSE `dupcheck` FOUND THE FLAG UNASSIGNED. The first version of
// `P.act` gated the attack on `P.mayAttack !== false` and **nothing in `src/` ever set it** —
// D-289's exact shape, a hook nothing fills, caught by the check this project wrote the last time
// it happened. ⚠ AND IT IS NOT `mayBuild`: vanilla restricts block PLACING in adventure and
// spectator, but `Player.attack` is gated on `isSpectator()` alone, so an adventure-mode player
// can still hit a mob. Reusing `mayBuild` would have been one word shorter and would have made
// adventure maps unplayable.
console.log('\n5b. who may attack');
{
  const Gm = M.Gamemode;
  ok(!!Gm, 'the gamemode table did not load');
  if (Gm) {
    ok(Gm.mayAttack(Gm.SURVIVAL) === true, 'survival may attack');
    ok(Gm.mayAttack(Gm.CREATIVE) === true, 'creative may attack');
    ok(Gm.mayAttack(Gm.ADVENTURE) === true,
       'ADVENTURE may attack — it is `mayBuild` that adventure loses, not this');
    ok(Gm.mayAttack(Gm.SPECTATOR) === false, 'spectator may not');
    // ⚠ AND THE TWO FLAGS MUST DISAGREE SOMEWHERE, or one of them is redundant
    const differ = [Gm.SURVIVAL, Gm.CREATIVE, Gm.ADVENTURE, Gm.SPECTATOR]
      .filter((m) => Gm.mayAttack(m) === Gm.blockPlacingRestricted(m));
    ok(differ.length !== 4, '`mayAttack` and `mayBuild` agree in every mode — one is redundant');
    // the flag is actually WRITTEN by Gm.set, which is what dupcheck could not see
    const e = { mode: Gm.SURVIVAL };
    Gm.set(e, Gm.SPECTATOR);
    ok(e.mayAttack === false, 'Gamemode.set writes mayAttack — it is not a hook nothing fills');
    Gm.set(e, Gm.ADVENTURE);
    ok(e.mayAttack === true && e.mayBuild === false,
       'and adventure comes out able to attack and unable to build');
  }
}

// ═══════════ 6. the owed list is named and closed ════════════════════════════════════════════
// ═══════════ 3b. weapon enchantments and the sweep, off the jar (D-461) ═══════════════════════
console.log('\n3b. weapon enchantments and the sweep (D-461, golden: combat-enchant-1.18.2.tsv)');
const ENCH_G = (() => {
  const g = { c: {}, undead: [], arthropod: [] };
  for (const line of readFileSync(join(ROOT, 'tools', 'golden', 'combat-enchant-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const [k, a, b] = line.split('\t');
    if (k === 'const') g.c[a] = b; else if (k === 'mobtype') g[a].push(b);
  }
  return g;
})();
const enchSection = () => {
  const r = { fails: [] };
  const t = (c, m) => { if (!c) r.fails.push(m); };
  const mkP = (over) => Object.assign({
    x: 0, y: FLOOR_Y, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0,
    inventory: Inv.create ? Inv.create() : null, sprinting: false, onGround: true, fallDistance: 0,
    onClimbable: false, inWater: false, walkDist: 0, walkDistO: 0, speed: 0.1 }, over || {});
  const armE = (P, item, ench) => Inv.setItem(P.inventory, P.slot,
    Inv.stack(item, 1, 0, ench ? { Enchantments: ench } : null));
  const charge = (n) => { H.reset(); for (let i = 0; i < n; i++) H.tickAttackStrength(); };
  const mob = (type, x, z) => { const e = EL.spawn(type, x, FLOOR_Y, z || 0); e.maxHealth = e.health = 1000; return e; };
  const hitWith = (type, ench, over, ticks) => {
    EL.clear(); const P = mkP(over); armE(P, 'diamond_sword', ench); charge(ticks === undefined ? 40 : ticks);
    return Cb.attack(P, mob(type, 2, 0));
  };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  // the code's numbers against the jar's
  t(Cb.SHARPNESS_BASE === +ENCH_G.c.sharpness_base && Cb.SHARPNESS_PER_LEVEL === +ENCH_G.c.sharpness_per_level_above_1,
    'sharpness constants differ from the jar');
  t(Cb.SMITE_PER_LEVEL === +ENCH_G.c.smite_per_level && Cb.BANE_PER_LEVEL === +ENCH_G.c.bane_per_level,
    'smite/bane constants differ from the jar');
  t(Cb.SWEEP_KNOCKBACK === +ENCH_G.c.sweep_knockback, `sweep knockback ${Cb.SWEEP_KNOCKBACK} is not the jar's ${ENCH_G.c.sweep_knockback}`);
  t(Cb.SWEEP_RANGE_SQ === +ENCH_G.c.sweep_range_sq, 'sweep range differs from the jar');
  t(Cb.ENCHANT_LEVEL_MAX === +ENCH_G.c.level_clamp_max, 'level clamp differs from the jar');
  for (const k of ['undead', 'arthropod']) {                     // both directions (rule 6)
    const a = [...Cb.MOB_TYPE[k]].sort().join(','), b = [...ENCH_G[k]].sort().join(',');
    t(a === b, `${k} mobs: code [${a}] vs jar [${b}]`);
    for (const n of ENCH_G[k]) t(Cb.mobTypeOf({ type: n }) === k, `${n} is not ${k}`);
  }
  t(Cb.mobTypeOf({ type: 'cow' }) === 'undefined', 'a cow has a mob type');
  // the damage bonus, driven through the real attack
  const base = hitWith('turtle', null).damage;
  t(near(base, 7), `a full diamond sword is ${base}, not 7`);
  t(near(hitWith('turtle', [{ id: 'minecraft:sharpness', lvl: 5 }]).damage, 10), 'sharpness V is not +3 (1 + 4*0.5)');
  t(near(hitWith('turtle', [{ id: 'sharpness', lvl: 1 }]).damage, 8), 'a bare id is not read as minecraft:');
  t(near(hitWith('turtle', [{ id: 'minecraft:sharpness', lvl: 0 }]).damage, 8), 'sharpness 0 is still +1 in the jar');
  t(near(hitWith('turtle', [{ id: 'minecraft:sharpness', lvl: 300 }]).damage, 7 + 1 + 254 * 0.5), 'lvl is not clamped to 255');
  t(near(hitWith('zombie', [{ id: 'minecraft:smite', lvl: 5 }]).damage, 19.5), 'smite V on a zombie is not +12.5');
  t(near(hitWith('turtle', [{ id: 'minecraft:smite', lvl: 5 }]).damage, 7), 'smite adds to a turtle');
  t(near(hitWith('turtle', [{ id: 'minecraft:impaling', lvl: 5 }]).damage, 19.5), 'impaling V on an aquatic mob is not +12.5');
  t(near(hitWith('zombie', [{ id: 'minecraft:impaling', lvl: 5 }]).damage, 7), 'impaling adds to a zombie');
  t(near(hitWith('axolotl', [{ id: 'minecraft:impaling', lvl: 2 }]).damage, 12), 'impaling II on an axolotl is not +5');
  t(near(hitWith('spider', [{ id: 'minecraft:bane_of_arthropods', lvl: 2 }]).damage, 12), 'bane II on a spider is not +5');
  t(near(hitWith('zombie', [{ id: 'minecraft:bane_of_arthropods', lvl: 2 }]).damage, 7), 'bane adds to a zombie');
  t(near(hitWith('zombie', [{ id: 'minecraft:sharpness', lvl: 2 }, { id: 'minecraft:smite', lvl: 1 }]).damage, 7 + 1.5 + 2.5),
    'two damage enchantments are not summed');
  // f1 is scaled by h, f by the ramp; the crit multiplies f only
  {
    EL.clear(); const P = mkP(); armE(P, 'diamond_sword', [{ id: 'minecraft:sharpness', lvl: 5 }]); charge(6);
    const h = H.attackStrengthScale(null, 0.5) && H.attackStrengthScale(Inv.getItem(P.inventory, 0), 0.5);
    const want = 7 * (0.2 + h * h * 0.8) + 3 * h;
    const got = Cb.attack(P, mob('turtle', 2, 0)).damage;
    t(h < 0.9 && near(got, want), `half-charged sharpness: ${got} vs ${want} (bonus scales by h, not h²)`);
  }
  {
    const c = hitWith('turtle', [{ id: 'minecraft:sharpness', lvl: 5 }], { onGround: false, fallDistance: 1 });
    t(c.crit && near(c.damage, 7 * 1.5 + 3), `a sharp crit is ${c.damage}, not 7*1.5+3 (the bonus is added after the crit)`);
  }
  // knockback: the enchantment level, plus one for a sprint
  t(hitWith('turtle', [{ id: 'minecraft:knockback', lvl: 2 }]).knockback === 2, 'knockback II is not level 2');
  t(hitWith('turtle', [{ id: 'minecraft:knockback', lvl: 2 }], { sprinting: true }).knockback === 3, 'knockback II + sprint is not 3');
  t(hitWith('turtle', null).knockback === 0, 'a standing plain blow knocks back');
  // the sweep: ratio, its own 0.4 knockback, and the feet-to-feet < 9 range
  const sweepRun = (ench) => {
    EL.clear(); const P = mkP(); armE(P, 'diamond_sword', ench); charge(40);
    const main = mob('turtle', 2, 0), inR = mob('turtle', 2.9, 0.0001), edge = mob('turtle', 3.0, 0);
    const res = Cb.attack(P, main);
    const ref = mob('turtle', 2.9, 0.0001); ref.vx = ref.vz = 0; ref.vy = 0;
    Cb.knockback(ref, +ENCH_G.c.sweep_knockback, Math.sin(0), -Math.cos(0));
    Cb.baseKnockback(ref, P);   // the swept mob's own damage() knockback from the swinger (#670: attacker now passed)
    return { res, inR, edge, ref };
  };
  // #670: a swept mob's ZombieEntity.damage hook gets the swinging player as attacker
  {
    const keepU = M.Undead, seen = [];
    M.Undead = { ZOMBIE_FAMILY: { turtle: true }, onZombieDamaged: (e, at) => { seen.push([e, at]); } };
    EL.clear(); const P = mkP(); armE(P, 'diamond_sword', null); charge(40);
    const main = mob('turtle', 2, 0), side = mob('turtle', 2.9, 0.0001);
    Cb.attack(P, main);
    M.Undead = keepU;
    const sw = seen.find((x) => x[0] === side);
    t(sw && sw[1] === P, 'a sweep-damaged mob\'s zombie hook got no attacker (#670)');
  }
  {
    const s = sweepRun(null);
    t(s.res.sweep && near(s.res.sweepDamage, 1), 'a plain sword sweep is not 1.0');
    t(s.res.swept.includes(s.inR), 'a mob 2.9 blocks away (feet to feet) is not swept');
    t(!s.res.swept.includes(s.edge), 'a mob exactly 3 blocks away is swept — the test is strictly < 9');
    t(near(s.inR.vz, s.ref.vz) && near(s.inR.vx, s.ref.vx), `swept knockback ${s.inR.vz} is not the jar's 0.4F (${s.ref.vz})`);
    const s3 = sweepRun([{ id: 'minecraft:sweeping', lvl: 3 }]);
    t(near(s3.res.sweepDamage, 1 + 0.75 * 7), `sweeping III is ${s3.res.sweepDamage}, not 1 + 0.75*7`);
    t(s3.inR.health === 1000 - (1 + 0.75 * 7), 'the swept mob did not take the sweep damage');
  }
  return r;
};
{
  const r = enchSection();
  for (const f of r.fails) ok(false, 'enchant: ' + f);
  if (!r.fails.length) { pass++; console.log('   enchant ......... sharpness/smite/bane, knockback, sweeping edge, sweep kb 0.4F and feet-to-feet range — as the jar'); }
  // anti-vacuity: each break must turn the section red
  const brk = (name, set, undo) => { set(); const n = enchSection().fails.length; undo(); okAv(n > 0, 'anti-vacuity: ' + name); };
  const kb0 = Cb.SWEEP_KNOCKBACK;
  brk('the old 0.5 sweep knockback is caught', () => { Cb.SWEEP_KNOCKBACK = 0.5; }, () => { Cb.SWEEP_KNOCKBACK = kb0; });
  const und = Cb.MOB_TYPE.undead;
  brk('a zombie dropped from UNDEAD is caught', () => { Cb.MOB_TYPE.undead = und.filter((n) => n !== 'zombie'); }, () => { Cb.MOB_TYPE.undead = und; });
  const hu = Cb.hurt;
  brk('a sweep hit that drops the attacker is caught', () => { Cb.hurt = (e, n, w, b, src) => hu(e, n, w, b, src && src.attacker === undefined ? src : (b && src ? null : src)); }, () => { Cb.hurt = hu; });
  const db = Cb.damageBonus;
  brk('a bonus that ignores the mob type is caught', () => { Cb.damageBonus = (s) => db(s, 'undead') + db(s, 'arthropod') - db(s, 'undefined'); }, () => { Cb.damageBonus = db; });
  brk('the old nine-block (9*9) sweep reach is caught', () => { Cb.SWEEP_RANGE_SQ = 81; }, () => { Cb.SWEEP_RANGE_SQ = 9; });
  const lv = Cb.enchantLevel;
  brk('a Knockback level that is never read is caught', () => { Cb.enchantLevel = (s, id) => (id === 'knockback' ? 0 : lv(s, id)); }, () => { Cb.enchantLevel = lv; });
}

console.log('\n3b2. D-658 — a landed blow\'s particles (PlayerEntity.java:1163-1239): sweep, CRIT/ENCHANTED_HIT emitters, DAMAGE_INDICATOR');
// Driven through the REAL `Cb.attack`, so the check sees the join (rule 7), and asserted both ways
// (rule 6): each particle appears on the blow that earns it and on no other. The counts are the
// jar's own RULES (an emitter per crit, (int)(lost*0.5) indicators above 2 lost), not constants
// the code exports; the per-particle numbers are particlecheck §12's.
const hitParticleSection = () => {
  const fails = [];
  const t = (c, m) => { if (!c) fails.push(m); };
  const Px = M.Particle;
  const mkP = (over) => Object.assign({
    x: 0, y: FLOOR_Y, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0, height: 1.8,
    inventory: Inv.create ? Inv.create() : null, sprinting: false, onGround: true, fallDistance: 0,
    onClimbable: false, inWater: false, walkDist: 0, walkDistO: 0, speed: 0.1 }, over || {});
  const hit = (item, ench, over, ticks, hp) => {
    EL.clear(); Px.clear();
    const P = mkP(over);
    Inv.setItem(P.inventory, P.slot, Inv.stack(item, 1, 0, ench ? { Enchantments: ench } : null));
    H.reset(); for (let i = 0; i < (ticks === undefined ? 40 : ticks); i++) H.tickAttackStrength();
    const e = EL.spawn('turtle', 2, FLOOR_Y, 0); e.maxHealth = e.health = hp || 1000;
    const res = Cb.attack(P, e);
    return { res, P, e, kinds: Px.list.map((p) => p.type), emitters: Px.emitters.length };
  };
  const count = (h, k) => h.kinds.filter((x) => x === k).length;
  // a standing, full, plain sword blow: the sweep, no crit, no enchanted hit; 7 lost -> 3 indicators
  const a = hit('diamond_sword', null);
  t(a.res && a.res.sweep && count(a, 'sweep_attack') === 1, `a standing sword sweep drew ${count(a, 'sweep_attack')} sweep_attack, not 1`);
  const sw = Px.list.find((p) => p.type === 'sweep_attack');
  t(sw && Math.abs(sw.x - (a.P.x + Math.sin(0))) < 1e-9 && Math.abs(sw.z - (a.P.z - Math.cos(0))) < 1e-9 &&
    Math.abs(sw.y - (a.P.y + 0.9)) < 1e-9, 'the sweep is not one block in front of the player at body height');
  t(count(a, 'crit') === 0 && count(a, 'enchanted_hit') === 0, 'a plain non-crit blow drew crit/enchanted_hit particles');
  t(count(a, 'damage_indicator') === 3, `7 health lost drew ${count(a, 'damage_indicator')} damage indicators, not (int)(7*0.5) = 3`);
  // a falling crit with an axe (no sweep): a CRIT emitter on the target, 10.5 lost -> 5 indicators
  const c = hit('diamond_axe', null, { onGround: false, fallDistance: 1 });
  t(c.res && c.res.crit && count(c, 'crit') > 0 && c.emitters === 1, `a crit made ${count(c, 'crit')} crit particles / ${c.emitters} emitters`);
  t(count(c, 'crit') <= 16, 'one emitter tick added more than its 16 tries');
  t(count(c, 'sweep_attack') === 0, 'a crit swept');
  const lostC = 1000 - c.e.health;
  t(count(c, 'damage_indicator') === Math.floor(lostC * 0.5), `${lostC} lost drew ${count(c, 'damage_indicator')} indicators`);
  // the emitter runs its 3 ticks and stops: the constructor's, then two more
  let crits = count(c, 'crit');
  Px.tick(); const n2 = Px.list.filter((p) => p.type === 'crit').length;
  t(Px.emitters.length === 1 && n2 >= crits, 'the crit emitter did not survive to its second tick');
  Px.tick(); t(Px.emitters.length === 0, 'the crit emitter outlived its 3 ticks');
  // sharpness: an ENCHANTED_HIT emitter; a crit and an enchanted hit are independent
  const e1 = hit('diamond_sword', [{ id: 'minecraft:sharpness', lvl: 1 }]);
  t(count(e1, 'enchanted_hit') > 0 && count(e1, 'crit') === 0, 'a sharpness blow drew no enchanted_hit (or a crit)');
  // a weak, uncharged blow loses <= 2: no indicators (both directions of the > 2 rule)
  const w = hit('diamond_sword', null, null, 0);
  t(w.res && (1000 - w.e.health) <= 2 && count(w, 'damage_indicator') === 0, 'a blow losing <= 2 health drew damage indicators');
  // the edge itself: exactly 2 lost is NOT above 2 (vanilla `$$22 > 2.0F`), a hair more is (int)(2.01*0.5) = 1
  Px.clear();
  { const tgt = { x: 0, y: FLOOR_Y, z: 0, height: 0.4 };
    t(Px.spawnDamageIndicators(tgt, 2.0) === 0, 'exactly 2 health lost drew a damage indicator — the test is strictly > 2');
    t(Px.spawnDamageIndicators(tgt, 2.01) === 1, '2.01 health lost did not draw (int)(2.01*0.5) = 1 indicator'); }
  // a blow that does not land (an invulnerable target) draws nothing
  EL.clear(); Px.clear();
  { const P = mkP(); Inv.setItem(P.inventory, 0, Inv.stack('diamond_sword', 1, 0, null)); H.reset();
    for (let i = 0; i < 40; i++) H.tickAttackStrength();
    const e = EL.spawn('turtle', 2, FLOOR_Y, 0); e.maxHealth = e.health = 1000; e.invulnerableTime = 20; e.lastHurt = 1000;
    const r0 = Cb.attack(P, e);
    t(!r0 || r0.hit || Px.list.length === 0, 'a blow that did not land drew particles'); }
  Px.clear(); EL.clear();
  return fails;
};
{
  const f = hitParticleSection();
  for (const m of f) ok(false, 'hit particles: ' + m);
  if (!f.length) { pass++; console.log('   hit particles ... sweep in front, crit/enchanted_hit emitters (3 ticks), (int)(lost*0.5) indicators above 2 — both ways'); }
  const brk = (name, set, undo) => { set(); const n = hitParticleSection().length; undo(); okAv(n > 0, 'anti-vacuity: ' + name); };
  const ap = Cb.attackParticles;
  brk('particles that are never asked for are caught', () => { Cb.attackParticles = () => ({}); }, () => { Cb.attackParticles = ap; });
  const ae = M.Particle.addEmitter;
  brk('a crit with no emitter is caught', () => { M.Particle.addEmitter = () => null; }, () => { M.Particle.addEmitter = ae; });
  const di = M.Particle.DAMAGE_INDICATOR_MIN;
  brk('indicators at any loss (no > 2 gate) are caught', () => { M.Particle.DAMAGE_INDICATOR_MIN = -1; }, () => { M.Particle.DAMAGE_INDICATOR_MIN = di; });
}

console.log('\n3c. a mob\'s own strike: ATTACK_KNOCKBACK and the attacker slow-down (D-462)');
// ⚠ THE NUMBERS ARE READ FROM THE GOLDEN TABLE BY COLUMN NAME, not typed here (rule 3): the check
// owns only vanilla's SHAPE — `Mob.doHurtTarget`'s `knockback(f1*0.5, sin yRot, -cos yRot)` inside
// `if (f1 > 0)`, and the attacker's own `multiply(0.6, 1, 0.6)` in that same branch.
const goldKb = (() => {
  const out = {}; let cols = null;
  for (const line of readFileSync(join(ROOT, 'tools', 'golden', 'entity-attributes-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'type') { cols = c; continue; }
    const i = cols ? cols.indexOf('attackKnockback') : -1;
    if (i >= 0) out[c[0]] = c[i] === '' ? null : +c[i];
  }
  return out;
})();
const strikeSection = () => {
  const r = { fails: [] };
  const t = (c, m) => { if (!c) r.fails.push(m); };
  const nonzero = Object.keys(goldKb).filter((k) => goldKb[k] > 0).sort();
  t(nonzero.length >= 1 && nonzero.length < 10,
    `the golden table gives ${nonzero.length} mobs a nonzero attack knockback (${nonzero.join(' ')}) — ` +
    'vanilla gives a handful, and every other mob 0 through Mob.createMobAttributes');
  for (const k of Object.keys(goldKb)) {
    const a = Ent.attrsOf(k);
    t(a && (a.atkKb || 0) === (goldKb[k] || 0), `${k}: packed atkKb ${a && a.atkKb} != golden ${goldKb[k]}`);
  }
  // a strike, facing yaw 0 (this engine's forward is (sin y, -cos y) = -z), and facing east
  const strike = (type, yaw) => {
    EL.clear();
    const tgt = EL.spawn('turtle', 0, FLOOR_Y, -1);
    tgt.maxHealth = tgt.health = 1000; tgt.vx = tgt.vy = tgt.vz = 0; tgt.onGround = true;
    tgt.knockbackResistance = 0; tgt.invulnerableTime = 0; tgt.hurtTime = 0;
    const att = { type, x: 0, y: FLOOR_Y, z: 0, yaw, vx: 0.2, vy: 0, vz: 0.3 };
    const hit = Cb.mobAttack(att, tgt);
    return { hit, tgt, att };
  };
  // s134: hoglin/zoglin REPLACE Mob.tryAttack with Hoglin.tryAttack (their own push, hoglincheck §2);
  // when 07zzg_hoglin.js is loaded they leave this Mob.doHurtTarget formula.
  for (const type of nonzero.filter((k) => !(M.Hoglin && M.Hoglin.TYPES && M.Hoglin.TYPES[k]))) {
    const kb = goldKb[type] * 0.5;
    const n = strike(type, 0);
    t(!!n.hit, `${type}'s strike lands`);
    // s135: LivingEntity.damage's own 0.4 push away from the attacker lands FIRST (the target sits
    // at -z, so -0.4), then tryAttack's knockback halves it and adds its own: v = v/2 - kb
    const B = Cb.KNOCKBACK_BASE;
    t(near(n.tgt.vz, -B / 2 - kb, 1e-6) && near(n.tgt.vx, 0, 1e-6),
      `${type} (yaw 0) pushes the target along its own facing, -z by ${kb} on top of the base push: got (${n.tgt.vx}, ${n.tgt.vz})`);
    t(n.tgt.vy > 0, `${type}'s knockback lifts an on-ground target (vy ${n.tgt.vy})`);
    t(near(n.att.vx, 0.2 * 0.6, 1e-9) && near(n.att.vz, 0.3 * 0.6, 1e-9) && n.att.vy === 0,
      `${type} keeps 0.6 of its own horizontal motion after knocking back: (${n.att.vx}, ${n.att.vy}, ${n.att.vz})`);
    const e = strike(type, Math.PI / 2);
    t(near(e.tgt.vx, kb, 1e-6) && near(e.tgt.vz, -B / 2, 1e-6),
      `${type} facing east (yaw π/2) pushes +x by ${kb}: got (${e.tgt.vx}, ${e.tgt.vz})`);
  }
  // BOTH DIRECTIONS (rule 6): a zero-knockback mob pushes nothing and is not slowed
  const z = strike('zombie', 0);
  t(!!z.hit, 'a zombie\'s strike lands');
  t(z.tgt.vx === 0 && near(z.tgt.vz, -Cb.KNOCKBACK_BASE, 1e-9), `a zombie (atkKb 0) adds nothing to the base 0.4 push: (${z.tgt.vx}, ${z.tgt.vz})`);
  t(z.att.vx === 0.2 && z.att.vz === 0.3, `a zombie keeps its whole speed: (${z.att.vx}, ${z.att.vz})`);
  EL.clear();
  return r;
};
{
  const r = strikeSection();
  for (const f of r.fails) ok(false, f);
  if (!r.fails.length) { pass++; console.log('   ✓ ravager/hoglin/zoglin knock back along their facing; zombie does not; attacker slowed 0.6'); }
  const brk = (name, set, undo) => { set(); let n; try { n = strikeSection().fails.length; } finally { undo(); } okAv(n > 0, 'anti-vacuity: ' + name); };
  const rav = Ent.attrsOf('ravager'), rk = rav.atkKb;
  brk('ATTACK_KNOCKBACK hardcoded 0 again (the pre-D-462 state) is caught', () => { rav.atkKb = 0; }, () => { rav.atkKb = rk; });
  const zo = Ent.attrsOf('zombie'), zk = zo.atkKb;
  brk('a zombie given knockback is caught', () => { zo.atkKb = 1; }, () => { zo.atkKb = zk; });
  const sl = Cb.MOB_STRIKE_SLOW;
  brk('an attacker that is not slowed is caught', () => { Cb.MOB_STRIKE_SLOW = 1; }, () => { Cb.MOB_STRIKE_SLOW = sl; });
  const kf = Cb.knockback;
  brk('a knockback along a constant vector (ignoring yaw) is caught',
      () => { Cb.knockback = (e, s) => kf(e, s, 0, 1); }, () => { Cb.knockback = kf; });
}

console.log('\n3d. Fire Aspect: the jar\'s own ignite duration, and the fire tick itself (D-470)');
const faSection = () => {
  const r = { fails: [] };
  const t = (c, m) => { if (!c) r.fails.push(m); };
  const mkP = (over) => Object.assign({
    x: 0, y: FLOOR_Y, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0,
    inventory: Inv.create ? Inv.create() : null, sprinting: false, onGround: true, fallDistance: 0,
    onClimbable: false, inWater: false, walkDist: 0, walkDistO: 0, speed: 0.1 }, over || {});
  const armE = (P, item, ench) => Inv.setItem(P.inventory, P.slot,
    Inv.stack(item, 1, 0, ench ? { Enchantments: ench } : null));
  const charge = (n) => { H.reset(); for (let i = 0; i < n; i++) H.tickAttackStrength(); };
  const mob = (type, x, z) => { const e = EL.spawn(type, x, FLOOR_Y, z || 0); e.maxHealth = e.health = 1000; return e; };
  // `EL.spawn` only knows the handful of types this harness simulates (turtle among them) —
  // `blaze` is not one, so a fire-immune subject is a plain entity-shaped object instead, the
  // same idiom §3c's own `strike()` already uses for its attacker.
  const fireImmuneMob = (x, z) => ({ type: 'blaze', x: x, y: FLOOR_Y, z: z || 0, width: 0.6, height: 1.8,
    maxHealth: 1000, health: 1000, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 });

  t(Cb.FIRE_ASPECT_SECONDS_PER_LEVEL === +ENCH_G.c.fire_aspect_seconds_per_level &&
    Cb.FIRE_ASPECT_PRE_IGNITE_SECONDS === +ENCH_G.c.fire_aspect_pre_ignite_seconds,
    'Fire Aspect constants differ from the jar');

  // a level II hit that lands ignites for level*4 = 8 seconds = 160 ticks
  EL.clear(); let P = mkP(); armE(P, 'diamond_sword', [{ id: 'minecraft:fire_aspect', lvl: 2 }]); charge(40);
  let m = mob('turtle', 2, 0);
  const res = Cb.attack(P, m);
  t(!!res.hit, 'the fire aspect hit lands');
  t(m.remainingFireTicks === 8 * Cb.FIRE_TICKS_PER_SECOND, `fire aspect II ignites for ${m.remainingFireTicks} ticks, not 160`);
  t(!!m.isOnFire, 'an ignited mob is not marked isOnFire');

  // a plain hit sets no fire at all
  EL.clear(); P = mkP(); armE(P, 'diamond_sword', null); charge(40);
  m = mob('turtle', 2, 0);
  Cb.attack(P, m);
  t(!(m.remainingFireTicks > 0), 'a plain blow set the target alight');

  // the pre-ignite poke fires even when the hit itself is blocked by invulnerability frames
  EL.clear(); P = mkP(); armE(P, 'diamond_sword', [{ id: 'minecraft:fire_aspect', lvl: 1 }]); charge(40);
  m = mob('turtle', 2, 0); m.invulnerableTime = 25; m.lastHurt = 1000;
  const res2 = Cb.attack(P, m);
  t(!res2.hit, 'the invulnerability grace did not actually block this test\'s hit');
  t(m.remainingFireTicks === Cb.FIRE_ASPECT_PRE_IGNITE_SECONDS * Cb.FIRE_TICKS_PER_SECOND,
    `a blocked hit's pre-ignite poke is ${m.remainingFireTicks} ticks, not ${Cb.FIRE_ASPECT_PRE_IGNITE_SECONDS * Cb.FIRE_TICKS_PER_SECOND} (vanilla's own bytecode, D-470)`);

  // fire immunity gates the PRE-ignite poke (a blocked hit never so much as pokes a blaze)...
  EL.clear(); P = mkP(); armE(P, 'diamond_sword', [{ id: 'minecraft:fire_aspect', lvl: 2 }]); charge(40);
  const bl = fireImmuneMob(2, 0); bl.invulnerableTime = 25; bl.lastHurt = 1000;
  const blMiss = Cb.attack(P, bl);
  t(!blMiss.hit, 'the fire-immune mob\'s grace did not actually block this test\'s hit');
  t(!(bl.remainingFireTicks > 0), 'a blocked hit poked a fire-immune mob with fire anyway');
  // ...but NOT the post-hit level*4 call, which vanilla's own bytecode applies unconditionally —
  // `Entity.baseTick`'s fire-immune decay (4 ticks/tick, no damage) is what neutralises it, not a
  // second immunity check at the ignite site. So a hit that LANDS does set the counter...
  EL.clear(); P = mkP(); armE(P, 'diamond_sword', [{ id: 'minecraft:fire_aspect', lvl: 2 }]); charge(40);
  const bl2 = fireImmuneMob(2, 0);
  Cb.attack(P, bl2);
  t(bl2.remainingFireTicks === 8 * Cb.FIRE_TICKS_PER_SECOND, `a landed hit should still set a fire-immune mob's counter (vanilla's own bytecode), got ${bl2.remainingFireTicks}`);
  // ...but it decays 4 ticks/tick and NEVER deals damage, all the way down to 0.
  const blH0 = bl2.health;
  for (let i = 0; i < 40 && bl2.remainingFireTicks > 0; i++) Cb.tickEntity(bl2);
  t(bl2.remainingFireTicks === 0, `a fire-immune mob's fire should fully decay, ${bl2.remainingFireTicks} ticks left`);
  t(bl2.health === blH0, 'a fire-immune mob took fire damage while its counter ran down');

  // the tick itself: 1 damage every 20 ticks while burning, and the counter runs out
  EL.clear(); const burning = mob('turtle', 0, 0); burning.remainingFireTicks = 21;
  const h0 = burning.health;
  for (let i = 0; i < 20; i++) Cb.tickEntity(burning);
  t(burning.health === h0 - 1, `20 ticks of fire dealt ${h0 - burning.health} damage, not 1 (once every 20)`);
  t(burning.remainingFireTicks === 1, `20 ticks should leave 1 remaining, has ${burning.remainingFireTicks}`);
  Cb.tickEntity(burning);
  t(burning.remainingFireTicks === 0 && !burning.isOnFire, 'fire did not fully burn out at 0');

  // a fire-immune mob is extinguished outright (LivingEntity.baseTick: isFireImmune() -> extinguish(); mobhazardrefcheck golden: 100 -> 0) and never damaged by its own fire
  EL.clear(); const im = fireImmuneMob(0, 0); im.remainingFireTicks = 20;
  const ih0 = im.health;
  Cb.tickEntity(im);
  t(im.remainingFireTicks === 0, `a fire-immune living mob should be extinguished, has ${im.remainingFireTicks}`);
  t(im.health === ih0, 'a fire-immune mob took fire damage');

  EL.clear();
  return r;
};
{
  const r = faSection();
  for (const f of r.fails) ok(false, 'fire aspect: ' + f);
  if (!r.fails.length) { pass++; console.log('   ✓ fire aspect ignites level*4s on a landed hit, pokes 1s on a blocked one (unless fire-immune), decays harmlessly on a blaze, and burns 1 dmg/20 ticks'); }
  const brk = (name, set, undo) => { set(); let n; try { n = faSection().fails.length; } finally { undo(); } okAv(n > 0, 'anti-vacuity: ' + name); };
  const spl = Cb.FIRE_ASPECT_SECONDS_PER_LEVEL;
  brk('fire aspect duration hardcoded flat (not *level) is caught', () => { Cb.FIRE_ASPECT_SECONDS_PER_LEVEL = 0; }, () => { Cb.FIRE_ASPECT_SECONDS_PER_LEVEL = spl; });
  const dmg = Cb.FIRE_DAMAGE_PER_TICK;
  brk('fire dealing no damage at all is caught', () => { Cb.FIRE_DAMAGE_PER_TICK = 0; }, () => { Cb.FIRE_DAMAGE_PER_TICK = dmg; });
  const fio = Cb.fireImmuneOf;
  brk('fire immunity ignored (a blaze can be ignited) is caught', () => { Cb.fireImmuneOf = () => false; }, () => { Cb.fireImmuneOf = fio; });
}

console.log('\n3e. D-477: the OWNER-side fields Ai.OwnerHurtByTargetGoal/OwnerHurtTargetGoal ' +
  'read (target.lastHurtByEntity/P.lastHurtMob) — the JOIN this file owes those goals');
{
  // ⚠ NS.Survival (14d_survival.js) IS LOADED ONLY FOR THIS SECTION: `Cb.mobAttack`'s own
  // `target === NS.Player` branch calls `Sv.hurt`, dead code everywhere else in this file since
  // nothing here ever sets `NS.Player` (§3c/§3d always hit a plain entity, never the player).
  const mkP = (over) => Object.assign({
    x: 0, y: FLOOR_Y, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0,
    inventory: Inv.create ? Inv.create() : null, sprinting: false, onGround: true, fallDistance: 0,
    onClimbable: false, inWater: false, walkDist: 0, walkDistO: 0, speed: 0.1 }, over || {});
  const armE = (P, item, ench) => Inv.setItem(P.inventory, P.slot,
    Inv.stack(item, 1, 0, ench ? { Enchantments: ench } : null));
  const charge = () => { H.reset(); for (let i = 0; i < 40; i++) H.tickAttackStrength(); };
  const mob = (type, x, z) => { const e = EL.spawn(type, x, FLOOR_Y, z || 0); e.maxHealth = e.health = 1000; return e; };

  EL.clear();
  M.Player = mkP();
  if (M.Survival && M.Survival.init) M.Survival.init(M.Player);

  // a mob's own strike, landed on the PLAYER: `target.lastHurtByEntity` (`Ai.
  // OwnerHurtByTargetGoal`'s own read) is written the same way `Cb.notifyHurt` already writes
  // a mob's — `Cb.mobAttack`, this pass.
  const attacker = mob('zombie', 0, 0);
  ok(M.Player.lastHurtByEntity === undefined, 'sanity: the field starts unset');
  const hitP = Cb.mobAttack(attacker, M.Player);
  ok(!!hitP, "a zombie strike on the player lands (Sv.hurt succeeds)");
  ok(M.Player.lastHurtByEntity === attacker, "Cb.mobAttack sets target.lastHurtByEntity on the PLAYER, D-477");

  // #5303: a zombie wielding Fire Aspect II sets the player alight for 8 s (MobEntity.tryAttack)
  {
    const fireStrike = (lvl) => {
      const z = mob('zombie', 0, 0);
      M.Equip.setEquipped(z, M.Items.MAINHAND, Inv.stack('diamond_sword', 1, 0, lvl ? { Enchantments: [{ id: 'minecraft:fire_aspect', lvl }] } : null));
      M.Player.remainingFireTicks = 0; M.Player.invulnerableTime = 0; M.Player.hurtTime = 0;
      Cb.mobAttack(z, M.Player);
      return M.Player.remainingFireTicks | 0;
    };
    ok(fireStrike(2) === 8 * Cb.FIRE_TICKS_PER_SECOND, '#5303: a zombie with Fire Aspect II ignites the player for 8 s');
    okAv(fireStrike(0) === 0, 'anti-vacuity: the same sword without Fire Aspect leaves the player unburnt');
  }

  // the player's own blow, landed on a mob: `P.lastHurtMob` (`Ai.OwnerHurtTargetGoal`'s own
  // read) — `Cb.attack`, this pass.
  EL.clear();
  const P2 = mkP(); armE(P2, 'diamond_sword', null); charge();
  const m1 = mob('turtle', 2, 0);
  const res1 = Cb.attack(P2, m1);
  ok(!!res1.hit, "sanity: the player's own blow lands");
  ok(P2.lastHurtMob === m1, 'Cb.attack sets P.lastHurtMob on a landed hit, D-477');

  // a SWEPT target counts too, and the LAST one processed wins — the same "last" shape
  // `Ai.OwnerHurtTargetGoal`'s own header names as this engine's reference-identity stand-in
  // for vanilla's timestamp diff.
  EL.clear();
  const P3 = mkP(); armE(P3, 'diamond_sword', null); charge();
  const main = mob('turtle', 2, 0);
  mob('turtle', 2, 1);
  const res2 = Cb.attack(P3, main);
  ok(!!res2.hit, "sanity: the sweep fixture's main hit lands");
  if (res2.swept.length) {
    ok(P3.lastHurtMob === res2.swept[res2.swept.length - 1],
       'a swept target becomes P.lastHurtMob too — the LAST one processed, D-477');
  } else {
    ok(P3.lastHurtMob === main, 'no sweep this run — the main hit is still the last-hurt mob');
  }

  // anti-vacuity (D-30, D-305), both directions: a Cb.mobAttack/Cb.attack that FORGOT to write
  // the field would still pass every OTHER assertion in this file — prove that specific miss
  // is catchable.
  okAv(M.Player.lastHurtByEntity !== null, 'anti-vacuity: target.lastHurtByEntity is not left null on a landed hit');
  okAv(P2.lastHurtMob !== null, "anti-vacuity: P.lastHurtMob is not left null on a landed hit");
  EL.clear();
  M.Player = null;
}

console.log('\n6. what combat still owes');
{
  ok(Array.isArray(Cb.OWED) && Cb.OWED.length === 0,
     `Cb.OWED names ${Cb.OWED && Cb.OWED.length} unbuilt parts; it named four (D-470 closed Fire Aspect and the fire tick itself — §3d; ` +
     `D-462 closed ATTACK_KNOCKBACK on a mob strike — §3c; D-461 the ` +
     `damage-bonus, Sweeping Edge and Knockback rows — §3b holds them; nine before that, D-394; ` +
     `QUEUE 0.2 closed Blindness-suppresses-crit and thorns-damages-the-attacker — §8; ` +
     `G21 closed 'experience on death' — Xp.dropMobXp, 07zz_xporb.js)`);
  ok(Cb.OWED.every((t) => typeof t === 'string' && t.length > 15),
     'an entry on Cb.OWED is not a sentence a human can act on');
  for (const t of Cb.OWED) console.log('   owed ............ ' + t);
  // ⚠ AND THE STAGE ITSELF IS NOT DONE, because nothing draws a mob. This assertion exists to
  // FAIL the day G18 lands, so that the "substrate only" note in 14j_combat.js cannot outlive
  // the limitation it describes (the D-324 rule: a documented limitation carries an assertion
  // that fires when the limitation ends).
  const ER = readFileSync(join(ROOT, 'src', '07j_entityrender.js'), 'utf8');
  const drawn = (ER.match(/ER\.SHAPE = \{([^}]*)\}/) || [, ''])[1];
  const shapes = (drawn.match(/\w+\s*:/g) || []).length;
  console.log(`   drawable ........ ${shapes} entity shapes are rendered`);
  // D-449 (session 60): bumped 3 -> 4 — `arrow` got its own `ER.SHAPE` entry (`arrow: 'arrow'`,
  // QUEUE row 0 item 4's bow half) so a flying arrow gets its own orientation matrix instead of
  // the ground-pile item transform. A MOB has been visible since well before this session (G18c,
  // D-407/D-430/D-445) through `ER.mobLayerFor`, a path this assertion's own text never counted
  // because it only ever read `ER.SHAPE` — so "no MOB can be seen" was already stale before this
  // change touched it; corrected here rather than left to describe a limitation that ended
  // sessions ago (D-324's own rule, applied a second time).
  // loop s111 (xp orb DRAW, G21): 4 -> 5 — `experience_orb: 'orb'`, the billboard pass in
  // 07j_entityrender.js (ER.renderOrbsGL2/GPU), so ER.SHAPE grew by exactly that one entry.
  // loop/bow: 5 -> 6 — `spectral_arrow: 'arrow'` (closing `ER.OWED`'s own 'spectral_arrow —
  // G18b' line), sharing `arrow`'s exact draw path off its own real `item/spectral_arrow` tile
  // (`ER.arrowTile(type)`, 07j_entityrender.js) rather than a second shape.
  // loop/throwables-s116: 6 -> 10 — `snowball`/`egg`/`ender_pearl`/`potion` all get the SAME
  // `item` shape a dropped item already has (07zzd_throw.js/07z_potion.js's own thrown
  // projectiles), four new entries rather than a new draw path.
  // #3806: 10 -> 12 — `fireball`/`small_fireball: 'fireball'` (FlyingItemEntityRenderer billboard).
  // #5080: 12 -> 13 — `experience_bottle: 'item'` (same item shape as the other throwables).
  // #5268: 13 -> 14 — `lightning_bolt` (ER.lightningQuads, drawn through the crystal-beam pass).
  // #5707: 14 -> 15 — `painting` (ER.paintingQuads, per-tile quads).
  // #6403: 15 -> 16 — `fishing_bobber: 'bobber'` (ER.bobberGeometry).
  ok(shapes === 16,
     `${shapes} entity shapes are drawn (block, block, item, arrow, spectral_arrow, orb, ` +
     'snowball, egg, ender_pearl, potion, fireball, small_fireball); a MOB ' +
     'draws through ER.mobLayerFor, a separate path this count has never included. When that ' +
     'path is removed from ER.build without a replacement, or ER.SHAPE gains/loses an entry, ' +
     'this count should move with it — that is what this assertion is for.');
}

// ═══════════ 7. anti-vacuity ═════════════════════════════════════════════════════════════════
console.log('\n7. anti-vacuity: break it, and it must be caught');
{
  EL.clear();
  // the ramp must REJECT a linear one — at 48% charge the two differ by a third
  // ⚠ THE COMPARISON IS RELATIVE, not a pinned gap: the largest divergence between the ramp and
  // a straight line is at h = 0.5, and it is a fifth of the whole scale. A pinned 0.1 was WRONG
  // BY 0.004 at h = 0.48 and would have read as a broken ramp.
  let worst = 0;
  for (let i = 0; i <= 100; i++) {
    const hh = i / 100;
    worst = Math.max(worst, Math.abs((Cb.RAMP_BASE + hh * hh * Cb.RAMP_SCALE) - hh));
  }
  okAv(worst > 0.15,
       `anti-vacuity: the quadratic ramp and a linear one differ by up to ${worst.toFixed(3)} — ` +
       'the two are not the same curve');
  // the crit multiplier must not be 1
  okAv(Cb.CRIT_MULTIPLIER !== 1, 'anti-vacuity: a crit multiplies by something other than one');
  // the invulnerability gate must reject a plain "ignore inside the grace" reading
  const e = EL.spawn('turtle', 0, FLOOR_Y, 0);
  e.maxHealth = 1000; e.health = 1000;
  Cb.hurt(e, 5);
  const afterSmall = (Cb.hurt(e, 3), e.health);
  const afterBig = (Cb.hurt(e, 8), e.health);
  okAv(afterSmall === 995 && afterBig === 992,
       'anti-vacuity: the grace docks a bigger hit rather than ignoring it — a plain ignore ' +
       'would have left 995');
  // knockback must subtract, not add: pushing north must give POSITIVE vz
  e.vx = 0; e.vy = 0; e.vz = 0; e.onGround = true; e.knockbackResistance = 0;
  Cb.knockback(e, 0.5, 0, -1);
  okAv(e.vz > 0, 'anti-vacuity: the impulse is subtracted — adding it would send the target ' +
                 'toward the attacker');
  // picking must reject a ray that points away
  // ⚠ THE LIST IS CLEARED FIRST, and the reason is worth keeping: the turtle §7 had been hurting
  // is standing AT THE ORIGIN, so a ray cast from the origin starts INSIDE it and hits at t=0 in
  // both directions. The "nothing behind the player" break failed on a turtle the break was not
  // about — a check measuring something it had left lying around, which is D-321's lesson in a
  // third costume.
  EL.clear();
  const t = EL.spawn('turtle', 0, FLOOR_Y, -3);
  okAv(Cb.pick(0, FLOOR_Y + 0.2, 0, 0, 0, -1, 5) !== null &&
       Cb.pick(0, FLOOR_Y + 0.2, 0, 0, 0, 1, 5) === null,
       'anti-vacuity: picking finds a turtle ahead and not the same turtle behind');
  okAv(!!t, 'anti-vacuity: ...and that turtle exists');
  // and the living set must not simply be "everything"
  okAv(Ent.living().length < Ent.count,
       `anti-vacuity: ${Ent.living().length} of ${Ent.count} types are living — not all of them`);
  // ...nor "nothing"
  okAv(Ent.living().length > 50,
       'anti-vacuity: ...and not almost none of them either');
  EL.clear();
}


console.log('\n8. QUEUE 0.2 — the status-effect store, and the combat residue it closes on Cb.OWED');
{
  const ES = M.Effects;
  ok(!!ES && ES.ready, 'NS.Effects did not load');

  // ── 8a. the store itself: add/has/get/remove, and the simplified upgrade rule ──────────────
  console.log('\n8a. the store: addStatusEffect/hasStatusEffect/getStatusEffect/removeStatusEffect');
  {
    const e = {};
    ok(ES.addStatusEffect(e, 'strength', 100, 0) === true, 'a fresh effect is added (returns true, StatusEffectInstance.upgrade\'s own shape)');
    ok(ES.hasStatusEffect(e, 'strength'), 'hasStatusEffect sees it');
    ok(ES.amplifierOf(e, 'strength') === 0, 'amplifier 0 (level I) round-trips');
    ok(ES.addStatusEffect(e, 'strength', 40, 0) === false, 'a shorter, equal-amplifier dose does not shorten the current one (upgrade keeps the longer)');
    ok(ES.getStatusEffect(e, 'strength').duration === 100, '...the duration stayed at 100');
    ok(ES.addStatusEffect(e, 'strength', 20, 2) === true, 'a HIGHER amplifier always wins outright, even with less time left');
    ok(ES.amplifierOf(e, 'strength') === 2, 'amplifier bumped to 2 (level III)');
    ok(ES.getStatusEffect(e, 'strength').duration === 20, '...and took its own duration (the longer weaker one is parked as its hiddenEffect -- effectinstcheck, #293)');
    const removed = ES.removeStatusEffectInternal(e, 'strength');
    ok(!!removed && removed.amplifier === 2, 'removeStatusEffectInternal hands back the removed instance (removeStatusEffect: a boolean, #293)');
    ok(!ES.hasStatusEffect(e, 'strength'), '...and it is gone');
    okAv(ES.hasStatusEffect({}, 'strength') === false, 'anti-vacuity: an entity with no effect table at all reports no effect, not a crash');
    okAv(ES.amplifierOf({}, 'strength') === -1, 'anti-vacuity: amplifierOf answers -1 (not 0) when the effect is absent — 0 would be indistinguishable from level I');
  }

  // ── 8b. Blindness suppresses the critical hit (Player.attack's own condition) ──────────────
  console.log('\n8b. Blindness suppresses the critical hit — Player.attack\'s own crit condition');
  {
    const mkP = (over) => Object.assign({
      x: 0, y: FLOOR_Y, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0,
      inventory: Inv.create ? Inv.create() : null, sprinting: false, onGround: false, fallDistance: 1,
      onClimbable: false, inWater: false, walkDist: 0, walkDistO: 0, speed: 0.1 }, over || {});
    const armE = (P) => Inv.setItem(P.inventory, P.slot, Inv.stack('diamond_sword', 1, 0, null));
    const charge = () => { H.reset(); for (let i = 0; i < 40; i++) H.tickAttackStrength(); };
    const mob = () => { const e = EL.spawn('turtle', 2, FLOOR_Y, 0); e.maxHealth = e.health = 1000; return e; };

    EL.clear();
    const P1 = mkP(); armE(P1); charge();
    const r1 = Cb.attack(P1, mob());
    ok(r1.crit === true, 'sanity: airborne, full-strength, not sprinting/onGround/inWater — this is a crit');

    EL.clear();
    const P2 = mkP(); armE(P2); charge();
    ES.addStatusEffect(P2, 'blindness', 100, 0);
    const r2 = Cb.attack(P2, mob());
    ok(r2.crit === false, 'the SAME swing with Blindness on the attacker is not a crit (`!hasStatusEffect(BLINDNESS)`)');
    ok(r2.damage < r1.damage, '...and so it deals less damage (no ×1.5)');

    okAv((() => {
      const suppress = ES.suppressesCrit;
      ES.suppressesCrit = () => false;
      EL.clear();
      const P3 = mkP(); armE(P3); charge();
      ES.addStatusEffect(P3, 'blindness', 100, 0);
      const bad = Cb.attack(P3, mob()).crit === true;
      ES.suppressesCrit = suppress;
      return bad;
    })(), 'anti-vacuity: a crit condition that forgot Blindness entirely is caught');
  }

  // ── 8c. Strength/Weakness modify the attack-damage attribute BEFORE the cooldown ramp ──────
  console.log('\n8c. Strength/Weakness — DamageModifierStatusEffect.adjustModifierAmount, folded into the attribute before the ramp');
  {
    const mkP = (over) => Object.assign({
      x: 0, y: FLOOR_Y, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0,
      inventory: Inv.create ? Inv.create() : null, sprinting: false, onGround: true, fallDistance: 0,
      onClimbable: false, inWater: false, walkDist: 0, walkDistO: 0, speed: 0.1 }, over || {});
    const armE = (P) => Inv.setItem(P.inventory, P.slot, Inv.stack('diamond_sword', 1, 0, null));
    const charge = () => { H.reset(); for (let i = 0; i < 40; i++) H.tickAttackStrength(); };
    const mob = () => { const e = EL.spawn('turtle', 2, FLOOR_Y, 0); e.maxHealth = e.health = 1000; return e; };

    EL.clear();
    const P0 = mkP(); armE(P0); charge();
    const base = Cb.attack(P0, mob()).damage;
    ok(near(base, 7), `sanity: a full diamond sword swing is ${base}, not 7`);

    EL.clear();
    const P1 = mkP(); armE(P1); charge();
    ES.addStatusEffect(P1, 'strength', 100, 0);           // level I: +3.0 * (0+1)
    const withStr = Cb.attack(P1, mob()).damage;
    ok(near(withStr, base + 3), `Strength I adds +3 (StatusEffects.field_5910's own 3.0/level): ${withStr}, not ${base + 3}`);

    EL.clear();
    const P2 = mkP(); armE(P2); charge();
    ES.addStatusEffect(P2, 'strength', 100, 1);           // level II: +3.0 * (1+1) = +6
    const withStr2 = Cb.attack(P2, mob()).damage;
    ok(near(withStr2, base + 6), `Strength II adds +6 (amplifier scales the SAME 3.0/level): ${withStr2}, not ${base + 6}`);

    EL.clear();
    const P3 = mkP(); armE(P3); charge();
    ES.addStatusEffect(P3, 'weakness', 100, 0);            // level I: -4.0 * (0+1)
    const withWeak = Cb.attack(P3, mob()).damage;
    ok(near(withWeak, base - 4), `Weakness I subtracts 4 (StatusEffects.field_5911's own -4.0/level): ${withWeak}, not ${base - 4}`);

    okAv((() => {
      const per = ES.STRENGTH_PER_LEVEL;
      ES.STRENGTH_PER_LEVEL = 0;
      EL.clear();
      const P4 = mkP(); armE(P4); charge();
      ES.addStatusEffect(P4, 'strength', 100, 0);
      const flat = near(Cb.attack(P4, mob()).damage, base);
      ES.STRENGTH_PER_LEVEL = per;
      return flat;
    })(), 'anti-vacuity: Strength constant zeroed out (no bonus at all) is caught');
  }

  // ── 8d. Resistance: 20%/level, after the invulnerability docking, before health is spent ───
  console.log('\n8d. Resistance — LivingEntity.applyEnchantmentsToDamage\'s own 20%-per-level reduction');
  {
    EL.clear();
    const e1 = EL.spawn('turtle', 0, FLOOR_Y, 0);
    e1.maxHealth = e1.health = 1000;
    ES.addStatusEffect(e1, 'resistance', 100, 0);          // level I: 20% off
    Cb.hurt(e1, 25);
    ok(near(e1.health, 980), `Resistance I: 25 damage lands as 20 (25 * (25-5)/25) — health is ${e1.health}, not 980`);

    EL.clear();
    const e2 = EL.spawn('turtle', 0, FLOOR_Y, 0);
    e2.maxHealth = e2.health = 1000;
    ES.addStatusEffect(e2, 'resistance', 100, 4);          // level V: 100% off, clamped at 0 not negative
    Cb.hurt(e2, 25);
    ok(e2.health === 1000, `Resistance V zeroes ANY positive damage (25 - 25*100/25 clamped at 0): health is ${e2.health}, not 1000`);

    EL.clear();
    const e3 = EL.spawn('turtle', 0, FLOOR_Y, 0);
    e3.maxHealth = e3.health = 1000;
    Cb.hurt(e3, 25);
    ok(e3.health === 975, 'sanity: no Resistance, the full 25 lands');

    okAv((() => {
      EL.clear();
      const e = EL.spawn('turtle', 0, FLOOR_Y, 0);
      e.maxHealth = e.health = 1000;
      ES.addStatusEffect(e, 'resistance', 100, 0);
      const pct = ES.RESISTANCE_PCT_PER_LEVEL;
      ES.RESISTANCE_PCT_PER_LEVEL = 0;
      Cb.hurt(e, 25);
      const flat = e.health === 975;   // no reduction at all — the pre-fix state
      ES.RESISTANCE_PCT_PER_LEVEL = pct;
      return flat;
    })(), 'anti-vacuity: Resistance\'s own per-level percentage zeroed (no reduction at all) is caught');

    // and the PLAYER side: `Sv.hurt`, the only other place this engine deals damage.
    if (M.Survival && M.Survival.init) {
      const Sv = M.Survival;
      const mkP2 = () => Object.assign({ inventory: Inv.create ? Inv.create() : null }, {});
      const P = mkP2();
      Sv.init(P);
      P.armor = 0; P.armorToughness = 0;
      ES.addStatusEffect(P, 'resistance', 100, 0);
      Sv.hurt(P, 'generic', 10);
      ok(near(P.health, 20 - 8), `Resistance I on the PLAYER: 10 damage lands as 8 — health is ${P.health}, not 12`);
    }
  }

  // ── 8e. Poison / Wither / Regeneration — StatusEffect.canApplyUpdateEffect's own intervals ─
  console.log('\n8e. Poison/Wither/Regeneration tick intervals — `50/25/40 >> amplifier`, and what each does to health');
  {
    // the interval FORMULA itself, both directions (rule 6): amplifier 0 and amplifier 2.
    ok(ES.dueThisTick('poison', 25, 0) === true && ES.dueThisTick('poison', 24, 0) === false,
       'poison amplifier 0: due at duration 25 (25>>0), not at 24');
    ok(ES.dueThisTick('poison', 6, 2) === true && ES.dueThisTick('poison', 5, 2) === false,
       'poison amplifier 2: due at duration 6 (25>>2 = 6), not at 5');
    ok(ES.dueThisTick('regeneration', 50, 0) === true && ES.dueThisTick('wither', 40, 0) === true,
       'regeneration/wither amplifier 0: due at 50/40 respectively');

    // poison: never kills (health > 1 guard), ticks exactly twice over a 50-tick dose at amp 0.
    EL.clear();
    const eP = EL.spawn('turtle', 0, FLOOR_Y, 0);
    eP.maxHealth = eP.health = 1000;
    ES.addStatusEffect(eP, 'poison', 50, 0);
    // through Cb.tickEntity (not bare ES.tick): poison now lands via Cb.hurt's real invulnerability
    // window, which only the mob tick loop counts down.
    for (let i = 0; i < 50; i++) Cb.tickEntity(eP);
    ok(eP.health === 998, `poison I over 50 ticks: two 1-damage ticks (at duration 50 and 25) — health is ${eP.health}, not 998`);

    EL.clear();
    const eP2 = EL.spawn('turtle', 0, FLOOR_Y, 0);
    eP2.maxHealth = eP2.health = 1;
    ES.addStatusEffect(eP2, 'poison', 50, 0);
    for (let i = 0; i < 50; i++) ES.tick(eP2);
    ok(eP2.health === 1, 'poison NEVER drops health below 1 (StatusEffect.applyUpdateEffect\'s own `health > 1.0F` guard)');

    // wither: no such guard, and CAN kill.
    EL.clear();
    const eW = EL.spawn('turtle', 0, FLOOR_Y, 0);
    eW.maxHealth = eW.health = 1;
    ES.addStatusEffect(eW, 'wither', 40, 0);
    for (let i = 0; i < 40 && !eW.dead; i++) ES.tick(eW);
    ok(eW.dead === true && eW.health === 0, 'wither has no health-floor guard and kills a 1-health entity on its first tick');

    // regeneration: heals, capped at maxHealth.
    EL.clear();
    const eR = EL.spawn('turtle', 0, FLOOR_Y, 0);
    eR.maxHealth = 1000; eR.health = 990;
    ES.addStatusEffect(eR, 'regeneration', 100, 0);
    for (let i = 0; i < 100; i++) ES.tick(eR);
    ok(eR.health === 992, `regeneration heals 1 every 50 ticks (two ticks over 100, at duration 100 and 50): health is ${eR.health}, not 992`);

    // expiry: the instance is dropped the same tick its duration reaches 0.
    EL.clear();
    const eX = EL.spawn('turtle', 0, FLOOR_Y, 0);
    eX.maxHealth = eX.health = 1000;
    ES.addStatusEffect(eX, 'regeneration', 3, 0);
    for (let i = 0; i < 3; i++) ES.tick(eX);
    ok(!ES.hasStatusEffect(eX, 'regeneration'), 'a duration-3 dose is gone after 3 ticks, not left lingering at duration 0');

    okAv((() => {
      const base = ES.TICK_INTERVAL_BASE.poison;
      ES.TICK_INTERVAL_BASE.poison = 999;   // an interval longer than the whole dose: never fires
      EL.clear();
      const e = EL.spawn('turtle', 0, FLOOR_Y, 0);
      e.maxHealth = e.health = 1000;
      ES.addStatusEffect(e, 'poison', 50, 0);
      for (let i = 0; i < 50; i++) ES.tick(e);
      const neverFired = e.health === 1000;
      ES.TICK_INTERVAL_BASE.poison = base;
      return neverFired;
    })(), 'anti-vacuity: poison\'s own interval broken (widened past the dose length) is caught — it would silently never tick');

    // and Cb.tickEntity (14j_combat.js, the mob loop) actually calls ES.tick — not just this file's own harness.
    EL.clear();
    const eT = EL.spawn('turtle', 0, FLOOR_Y, 0);
    eT.maxHealth = eT.health = 1000;
    ES.addStatusEffect(eT, 'poison', 25, 0);
    for (let i = 0; i < 25; i++) Cb.tickEntity(eT);
    ok(eT.health === 999, `Cb.tickEntity wires ES.tick into the real per-mob tick loop: health is ${eT.health}, not 999`);

    // loop s111 — ES.OWED closed: poison/wither through the real damage path, hunger/saturation.
    const Sv = M.Survival, NS = M;
    console.log('\n8e2. poison/wither through LivingEntity.damage (invulnerability + bypassesArmor), hunger/saturation');
    const poisonRun = () => {
      EL.clear();
      const e = EL.spawn('turtle', 0, FLOOR_Y, 0);
      e.maxHealth = e.health = 1000;
      ES.addStatusEffect(e, 'poison', 40, 4);          // 25>>4 = 1: due EVERY tick
      for (let i = 0; i < 40; i++) Cb.tickEntity(e);
      return 1000 - e.health;
    };
    const lost = poisonRun();
    ok(lost > 0 && lost < 40, `poison V ticks every tick but the invulnerability window docks it: lost ${lost} of 40 (vanilla: >0 and <40)`);
    okAv((() => { const c = NS.Combat; NS.Combat = undefined; const l = poisonRun(); NS.Combat = c; return l === 40; })(),
       'anti-vacuity: poison routed around Cb.hurt (bare arithmetic) loses all 40 — the gate assertion above sees it');
    const armoured = (src) => { EL.clear(); const e = EL.spawn('turtle', 0, FLOOR_Y, 0);
      e.maxHealth = e.health = 100; e.armorBonus = 20; Cb.hurt(e, 4, undefined, false, src); return 100 - e.health; };
    ok(armoured({ bypassArmor: true }) === 4 && armoured(undefined) < 4,
       `a setBypassesArmor() hit (magic/wither/onFire) ignores 20 armour (4 lands), a melee blow does not (${armoured(undefined)} lands)`);
    EL.clear();
    const eA = EL.spawn('turtle', 0, FLOOR_Y, 0);
    eA.maxHealth = eA.health = 100; eA.armorBonus = 20;
    ES.addStatusEffect(eA, 'wither', 40, 0);
    ES.tick(eA);
    ok(eA.health === 99, `wither I on a 20-armour mob takes exactly 1 (WITHER bypasses armour) — health ${eA.health}`);
    okAv((() => { const f = ES.applyTickEffect; ES.applyTickEffect = function (e, ef, a) {   // break: forget the flag
      if (ef === 'wither') return NS.Combat.hurt(e, 1, undefined, false); return f(e, ef, a); };
      EL.clear(); const e = EL.spawn('turtle', 0, FLOOR_Y, 0); e.maxHealth = e.health = 100; e.armorBonus = 20;
      ES.addStatusEffect(e, 'wither', 40, 0); ES.tick(e); ES.applyTickEffect = f; return e.health !== 99; })(),
       'anti-vacuity: wither sent through Cb.hurt WITHOUT bypassArmor is reduced by armour — caught');
    {
      const P = Object.assign({ inventory: null }, {}); Sv.init(P);
      const ex0 = P.exhaustion;
      ES.addStatusEffect(P, 'hunger', 10, 1);
      for (let i = 0; i < 10; i++) ES.tick(P);
      ok(Math.abs(P.exhaustion - ex0 - 10 * 0.005 * 2) < 1e-9, `hunger II: 0.005*(1+1) exhaustion EVERY tick — +${(P.exhaustion - ex0).toFixed(4)} over 10, want 0.1000`);
      const P2 = {}; Sv.init(P2); P2.food = 10; P2.saturation = 0;
      ES.addStatusEffect(P2, 'saturation', 1, 0);
      ES.tick(P2);
      ok(P2.food === 11 && P2.saturation === 2, `saturation I, one tick: HungerManager.add(1, 1.0) → food 11, saturation 2 (got ${P2.food}/${P2.saturation})`);
      const P3 = {}; Sv.init(P3); P3.armor = 20; const ex3 = P3.exhaustion;
      ES.addStatusEffect(P3, 'poison', 25, 0);
      ES.tick(P3);
      ok(P3.health === 19 && P3.exhaustion === ex3, `poison on a 20-armour PLAYER: exactly 1 lands and no damage exhaustion (MAGIC is setBypassesArmor, exhaustion 0) — ${P3.health}/${P3.exhaustion}`);
      const P4 = {}; Sv.init(P4); P4.armor = 20; Sv.hurt(P4, 'fall', 5);
      ok(P4.health === 15, `fall damage ignores armour (DamageSource.FALL is setBypassesArmor) — 20 armour, 5 fall → ${P4.health}, want 15`);
      const P5 = {}; Sv.init(P5); P5.armor = 20; Sv.hurt(P5, 'mob', 5);
      ok(P5.health > 15, `and a mob's blow IS reduced by the same 20 armour (${P5.health})`);
      okAv((() => { const f = ES.isPlayerLike; ES.isPlayerLike = () => false;
        const Q = {}; Sv.init(Q); const q0 = Q.exhaustion; ES.addStatusEffect(Q, 'hunger', 10, 0);
        for (let i = 0; i < 10; i++) ES.tick(Q); ES.isPlayerLike = f; return Q.exhaustion === q0; })(),
        'anti-vacuity: hunger with the player test broken spends nothing — the hunger assertion catches it');
    }
  }

  // ── 8f. Thorns — the equipped-armor-item substrate ThornsEnchantment.onUserDamaged needs ──
  console.log('\n8f. Thorns — ThornsEnchantment.shouldDamageAttacker/getDamageAmount, and the armor-durability hit');
  {
    const Iv = M.Inventory;
    const mkDefender = (level) => {
      const d = { inventory: Inv.create() };
      Inv.setItem(d.inventory, Iv.ARMOR_START + 2, Inv.stack('iron_chestplate', 1, 0,
        level ? { Enchantments: [{ id: 'thorns', lvl: level }] } : null));
      return d;
    };
    const seq = (vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };

    EL.clear();
    const atk1 = EL.spawn('turtle', 0, FLOOR_Y, 0);
    atk1.maxHealth = atk1.health = 1000;
    const d1 = mkDefender(3);   // level 3: chance 0.45, roll 0.4 -> triggers
    const before1 = Inv.getItem(d1.inventory, Iv.ARMOR_START + 2).d;
    ok(ES.thornsOnUserDamaged(d1, atk1, seq([0.4, 0.0])) === true,
       'level 3 (45% chance): a 0.40 roll triggers (Thorns.shouldDamageAttacker: 0.40 < 0.15*3)');
    ok(atk1.health === 999, `getDamageAmount(3, rng=0.0) -> 1 + floor(0*4) = 1: attacker health is ${atk1.health}, not 999`);
    ok(Inv.getItem(d1.inventory, Iv.ARMOR_START + 2).d === before1 + 2,
       'ItemStack.damage(2, ...): the piece takes 2 durability for the retaliation');

    EL.clear();
    const atk2 = EL.spawn('turtle', 0, FLOOR_Y, 0);
    atk2.maxHealth = atk2.health = 1000;
    const d2 = mkDefender(3);
    ok(ES.thornsOnUserDamaged(d2, atk2, seq([0.5])) === false,
       'the SAME level 3 armor: a 0.50 roll does NOT trigger (0.50 is not < 0.45)');
    ok(atk2.health === 1000, '...and the attacker takes no damage');

    EL.clear();
    const atk3 = EL.spawn('turtle', 0, FLOOR_Y, 0);
    atk3.maxHealth = atk3.health = 1000;
    const d3 = mkDefender(0);   // no thorns at all
    ok(ES.thornsOnUserDamaged(d3, atk3, seq([0.0])) === false,
       'unenchanted armor never triggers, even at a roll of 0.0 (level <= 0 short-circuits)');

    EL.clear();
    const atk4 = EL.spawn('turtle', 0, FLOOR_Y, 0);
    atk4.maxHealth = atk4.health = 1000;
    const d4 = mkDefender(12);  // level > 10: damage is level-10, not the dice
    ok(ES.thornsOnUserDamaged(d4, atk4, seq([0.0, 0.99])) === true, 'level 12 triggers on a 0.0 roll (chance is uncapped, 1.8 > 1)');
    ok(atk4.health === 998, `level > 10: getDamageAmount returns level-10 = 2 directly, ignoring the roll — attacker health is ${atk4.health}, not 998`);

    // end-to-end through the REAL combat call, not just this file's direct call: a mob's own
    // strike on the player triggers the defender's Thorns (Cb.mobAttack, D-477's own §3e rig).
    if (M.Survival && M.Survival.init) {
      const Sv = M.Survival;
      EL.clear();
      const attacker = EL.spawn('zombie', 0, FLOOR_Y, 0);
      const P = { inventory: Inv.create() };
      Sv.init(P);
      P.armor = 0; P.armorToughness = 0;
      Inv.setItem(P.inventory, Iv.ARMOR_START + 2, Inv.stack('iron_chestplate', 1, 0,
        { Enchantments: [{ id: 'thorns', lvl: 3 }] }));
      const oldRandom = Math.random;
      Math.random = seq([0.0, 0.0]);   // guaranteed trigger, minimum damage
      const atkHealthBefore = attacker.health;
      const prevPlayer = M.Player;
      M.Player = P;    // Cb.mobAttack's Thorns call only runs on its `target === NS.Player` branch
      Cb.mobAttack(attacker, P);
      M.Player = prevPlayer;
      Math.random = oldRandom;
      ok(attacker.health < atkHealthBefore,
         `Cb.mobAttack's own player-hit branch calls ES.thornsOnUserDamaged: the zombie took ${atkHealthBefore - attacker.health} thorns damage`);
    }

    okAv((() => {
      const perLvl = ES.THORNS_CHANCE_PER_LEVEL;
      ES.THORNS_CHANCE_PER_LEVEL = 0;
      EL.clear();
      const atk = EL.spawn('turtle', 0, FLOOR_Y, 0);
      atk.maxHealth = atk.health = 1000;
      const d = mkDefender(3);
      const neverTriggers = ES.thornsOnUserDamaged(d, atk, seq([0.0])) === false;
      ES.THORNS_CHANCE_PER_LEVEL = perLvl;
      return neverTriggers;
    })(), 'anti-vacuity: Thorns\' own chance-per-level zeroed (can never trigger) is caught');
  }

  // ── 8g. save/load — StatusEffectInstance.writeNbt/fromNbt's own shape, round-tripped ───────
  console.log('\n8g. save/load — the NBT shape a future entity-save inherits');
  {
    const e = {};
    ES.addStatusEffect(e, 'poison', 120, 1, true, false);
    ES.addStatusEffect(e, 'regeneration', 40, 0);
    const nbt = ES.save(e);
    ok(nbt.length === 2, `save() emits one tag per LIVE effect: ${nbt.length}, not 2`);
    const poisonTag = nbt.find((t) => t.Id === ES.IDS.poison);
    ok(!!poisonTag && poisonTag.Amplifier === 1 && poisonTag.Duration === 120 &&
       poisonTag.Ambient === true && poisonTag.ShowParticles === false,
       'the poison tag carries every one of the five requested fields, exactly');

    const e2 = {};
    ES.load(e2, nbt);
    ok(ES.hasStatusEffect(e2, 'poison') && ES.amplifierOf(e2, 'poison') === 1,
       'load() reconstructs the same effect on a fresh entity');
    ok(ES.getStatusEffect(e2, 'poison').ambient === true && ES.getStatusEffect(e2, 'poison').showParticles === false,
       '...ambient/showParticles round-trip too');
    ok(ES.hasStatusEffect(e2, 'regeneration') && ES.amplifierOf(e2, 'regeneration') === 0,
       'the second effect round-trips alongside the first');

    // `fromNbt`: an unrecognized Id is silently dropped, not a crash.
    const e3 = {};
    ES.load(e3, [{ Id: 200, Amplifier: 0, Duration: 10, Ambient: false, ShowParticles: true }]);
    ok(Object.keys(e3.effects).length === 0, 'an unknown effect Id loads to nothing, matching StatusEffectInstance.fromNbt');

    okAv((() => {
      const e4 = {};
      ES.addStatusEffect(e4, 'poison', 120, 1, true, false);
      const bad = ES.save(e4);
      bad[0].Duration = 999;              // corrupt the saved tag
      const e5 = {};
      ES.load(e5, bad);
      return ES.getStatusEffect(e5, 'poison').duration !== 120;   // proves the round-trip is REAL, not a no-op stub
    })(), 'anti-vacuity: corrupting a saved tag changes what load() reconstructs — save/load actually carries the data');
  }

  EL.clear();
}

{
  console.log('\n#942. WitherEntity.damage() gates');
  const mk = () => { const w = EL.spawn('wither', 0, FLOOR_Y, 0); w.invulTimer = 0; w.invulnerableTime = 0; return w; };
  const hit = (w, src, att) => { w.invulnerableTime = 0; const h = w.health; Cb.hurt(w, 6, undefined, false, Object.assign({ attacker: att }, src)); return w.health < h; };
  const zombie = EL.spawn('zombie', 5, FLOOR_Y, 0);
  const cow = EL.spawn('cow', 6, FLOOR_Y, 0);
  let w = mk();
  ok(!hit(w, { source: 'drown' }), 'wither takes no drowning damage');
  ok(!hit(w, { source: 'fall', bypassArmor: true }), 'wither takes no fall damage');
  ok(!hit(w, {}, zombie), 'an undead attacker cannot hurt the wither');
  ok(hit(w, {}, cow), 'a non-undead mob attacker still hurts the wither');
  ok(hit(w, { source: 'projectile', persistent: true }), 'an arrow hurts a wither above half health');
  w.health = 150;
  ok(!hit(w, { source: 'projectile', persistent: true }), 'an arrow does nothing at half health');
  ok(hit(w, { source: 'projectile' }), '#3650: a non-persistent projectile (llama spit/skull) still hurts at half health');
  ok(hit(w, {}, cow), 'melee still hurts at half health');
  okAv((() => { const x = mk(); return hit(x, { source: 'projectile', persistent: true }); })(), 'anti-vacuity: the same arrow on a healthy wither is not gated (gate is real)');
  okAv(hit((() => { const x = mk(); x.type = 'cow'; x.maxHealth = 300; return x; })(), { source: 'drown' }), 'anti-vacuity: drowning a non-wither still damages');
  EL.clear();
}

// #1228 -- ParrotEntity.damage: a hit stands a sitting parrot up (setSitting(false)).
{
  EL.clear();
  const sit = () => { const x = EL.spawn('parrot', 0, 70, 0); x.tamed = true; x.sitting = true; return x; };
  const p = sit(); const hr = Cb.hurt(p, 1);
  ok(p.sitting === false, 'a hit stands a sitting parrot up');
  const c = sit(); c.type = 'cow'; Cb.hurt(c, 1);
  okAv(c.sitting === true, 'anti-vacuity: the same hit leaves a non-parrot\'s sitting flag alone (the reset is parrot-specific)');
  EL.clear();
}

// #5798 -- LivingEntity stuck arrows / stingers: +1 per landed non-piercing arrow, decay 1 per 20*(30-count) ticks.
{
  EL.clear();
  const mkZ = () => EL.spawn('zombie', 0, 70, 0);
  const shoot = (z, extra) => { const a = EL.spawn('arrow', z.x - 2, z.y + 1, z.z); a.shooter = null; a.vx = 1; a.vy = 0; a.vz = 0; Object.assign(a, extra || {}); for (let i = 0; i < 6 && !a.removed; i++) { z.invulnerableTime = 0; Cb.tickArrow(a); } return a; };
  const z = mkZ(); shoot(z);
  ok(z.stuckArrows === 1, 'an arrow that hits a zombie sets stuckArrows 1 (got ' + z.stuckArrows + ')');
  shoot(z); shoot(z);
  ok(z.stuckArrows === 3, 'three hits: 3 (got ' + z.stuckArrows + ')');
  z.stuckArrowTimer = 0;
  for (let i = 0; i < 539; i++) Cb.tickStuckObjects(z);
  ok(z.stuckArrows === 3, 'still 3 after 539 ticks');
  Cb.tickStuckObjects(z);
  ok(z.stuckArrows === 2, 'after 20*(30-3)=540 ticks it is 2 (got ' + z.stuckArrows + ')');
  const w = mkZ(); w.stingerCount = 3;
  for (let i = 0; i < 540; i++) Cb.tickStuckObjects(w);
  ok(w.stingerCount === 2, 'a stinger count decays on the same timer');
  const p = mkZ(); shoot(p, { pierceLevel: 1 });
  ok(!p.stuckArrows, 'a piercing arrow leaves the count unchanged');
  const en = EL.spawn('enderman', 0, 70, 0); shoot(en);
  ok(!en.stuckArrows, 'an enderman gets no stuck arrow');
  const n = mkZ(); n.stuckArrows = 3; const saved = Cb.tickStuckObjects; Cb.tickStuckObjects = () => {};
  for (let i = 0; i < 540; i++) Cb.tickStuckObjects(n);
  Cb.tickStuckObjects = saved;
  okAv(n.stuckArrows !== 2, 'anti-vacuity: with no decay the 540-tick assert (count 2) fails');
  EL.clear();
}

console.log('');
console.log('================ combatcheck ===============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log(` living types ....... ${Ent.living().length} of ${Ent.count}`);
console.log(` armed items ........ ${H.attrCount}`);
console.log('===========================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
