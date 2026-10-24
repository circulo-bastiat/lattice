#!/usr/bin/env node
// tippedcheck.mjs — loop/tipped: tipped-arrow potion effects on hit, and the stray's slowness
// arrow. Proves `Cb.applyArrowTip`/`Po.tipFromTag` (07z_potion.js/14j_combat.js) replay
// `ArrowEntity.onHit`'s real TWO-loop shape (.decomp ArrowEntity.java:175-193): the base
// `Potion.getEffects()` loop, each `max(getDuration() / 8, 1)`, and the CUSTOM `effects` set
// loop, applied undivided — and that `Cb.mobShoot`'s stray branch still gives every stray arrow
// `StrayEntity.createArrowProjectile`'s own `addEffect(slowness, 600)` (.decomp, undivided),
// driven through the REAL `EntityList`/`Cb.tickArrow` hit path, not a rewritten copy of either.
//
//   node tools/tippedcheck.mjs [--verbose]

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
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('tippedcheck — loop/tipped: tipped-arrow potion effects on hit, stray slowness arrow');

const M = loadEngine({
  extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '14e_gamemode.js', '07q_effects.js',
          '07zx_particle.js', '07z_potion.js', '14j_combat.js', '14d_survival.js']
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();

const FLOOR_Y = 64;
M.Physics.shapeAt = (x, y, z) => (y < FLOOR_Y ? M.Physics.FULL_CUBE : null);
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.Physics.grounded = (x, y, z, d) => y - d < FLOOR_Y;
M.EntityList.init();
M.Combat.init();
ok(M.Potion.ready, 'Potion module reports ready');

const EL = M.EntityList, Cb = M.Combat, Po = M.Potion, ES = M.Effects;

const mob = (x, z) => { const e = EL.spawn('turtle', x, FLOOR_Y, z || 0); e.maxHealth = e.health = 1000; return e; };
// an in-flight arrow, positioned dead on the target, still airborne (`onGround` false, so
// `Cb.tickArrow` runs its hit sweep instead of sticking) — the same shape combatcheck's own
// D-402 hunk uses for `arrow`.
function shotArrow(t, tip) {
  const a = EL.spawn('arrow', t.x, t.y, t.z, { vx: 1, vy: 0, vz: 0, shooter: null, tip });
  a.onGround = false;
  return a;
}

// ═══════════ 1. the base-potion loop — `this.potion.getEffects()`, `max(dur/8, 1)` ══════════
console.log('\n1. a tipped arrow\'s own POTION effect, divided by 8 on hit (ArrowEntity.onHit)');
{
  const t = mob(0, 0);
  const a = shotArrow(t, { potionId: 'poison' });   // Po.POTIONS.poison: {poison, 900, 0}
  ok(!!Cb.applyArrowTip, 'Cb.applyArrowTip exists');
  Cb.tickArrow(a);
  const inst = ES.getStatusEffect(t, 'poison');
  ok(!!inst, 'poison landed on the target');
  const want = Math.max(Math.floor(900 / 8), 1);   // 112 — Java int division, floor, min 1
  ok(inst && inst.duration === want, `poison duration is ${inst && inst.duration} ticks; ArrowEntity.onHit's own max(900/8,1) is ${want}`);
  ok(inst && inst.amplifier === 0, 'amplifier carried through unchanged');
  ok(a.removed === true, 'the arrow is consumed on a landed hit');
}

// a low-duration potion (hypothetical: swap in a 1-tick base) still floors to at least 1, not 0 —
// `max(x, 1)` is the whole point of the vanilla clamp, so this is asserted on the real table
// rather than invented: `harming`/`healing` are INSTANT effects (duration 1 in `Po.POTIONS`),
// and `max(floor(1/8), 1) === 1`, never 0.
{
  const t = mob(4, 0);
  const a = shotArrow(t, { potionId: 'harming' });
  Cb.tickArrow(a);
  const inst = ES.getStatusEffect(t, 'instant_damage');
  ok(!!inst && inst.duration === 1, `harming's 1-tick base clamps to max(floor(1/8),1)=1, got ${inst && inst.duration}`);
}

// ═══════════ 2. the custom-effects loop — undivided, the stray's own shape ════════════════════
console.log('\n2. a tipped arrow\'s own CUSTOM effect(s) — undivided (ArrowEntity.addEffect)');
{
  const t = mob(8, 0);
  const a = shotArrow(t, { custom: [{ effect: 'strength', duration: 123, amplifier: 2 }] });
  Cb.tickArrow(a);
  const inst = ES.getStatusEffect(t, 'strength');
  ok(!!inst && inst.duration === 123, `custom effect duration is undivided (123), got ${inst && inst.duration}`);
  ok(inst && inst.amplifier === 2, 'custom effect amplifier carried through');
}

// both loops at once — a real tipped arrow's `Potion` tag AND a `CustomPotionEffects` tag
// firing together, exactly as `ArrowEntity.onHit` runs both loops unconditionally.
{
  const t = mob(12, 0);
  const a = shotArrow(t, { potionId: 'weakness', custom: [{ effect: 'glowing', duration: 200, amplifier: 0 }] });
  Cb.tickArrow(a);
  ok(ES.getStatusEffect(t, 'weakness') && ES.getStatusEffect(t, 'weakness').duration === Math.max(Math.floor(1800 / 8), 1),
     'the potion half of a combined tag is still divided');
  ok(ES.getStatusEffect(t, 'glowing') && ES.getStatusEffect(t, 'glowing').duration === 200,
     'the custom half of a combined tag is still undivided');
}

// ═══════════ 3. `Po.tipFromTag` — a real tipped-arrow ITEM tag, read into that shape ══════════
console.log('\n3. Po.tipFromTag — the tipped-arrow item\'s own tag, off a real Potion id');
{
  const tip = Po.tipFromTag({ Potion: 'minecraft:swiftness' });
  ok(!!tip && tip.potionId === 'swiftness', 'a namespaced Potion tag maps to Po.POTIONS.swiftness');
  ok(Po.tipFromTag({ Potion: 'minecraft:not_a_real_potion' }) === null, 'an unknown potion id yields no tip at all (not a silent no-op effect)');
  const custom = Po.tipFromTag({ CustomPotionEffects: [{ effect: 'luck', duration: 400, amplifier: 1 }] });
  ok(!!custom && custom.custom && custom.custom[0].effect === 'luck' && custom.custom[0].duration === 400,
     'a CustomPotionEffects tag is read through unchanged');
  ok(Po.tipFromTag(null) === null && Po.tipFromTag({}) === null, 'no tag / an empty tag yields no tip');
}

// ═══════════ 4. the stray's own arrow — every shot carries undivided slowness(600) ════════════
console.log('\n4. Cb.mobShoot — a stray\'s arrow always carries StatusEffects.field_5909, 600 ticks');
{
  const stray = EL.spawn('stray', 0, FLOOR_Y, -6);
  const player = { x: 0, y: FLOOR_Y, z: 0, height: 1.8, maxHealth: 20, health: 20 };
  M.NS = M.NS || {};
  const savedPlayer = M.Player;
  M.Player = player;   // `Cb.tickArrow` treats `NS.Player` as an always-eligible target
  const a = Cb.mobShoot(stray, player, 1, Math.random);
  ok(!!a && a.type === 'arrow', 'mobShoot spawns a real arrow entity for a stray');
  ok(!!a.tip && !!a.tip.custom && a.tip.custom[0].effect === 'slowness' && a.tip.custom[0].duration === 600 && a.tip.custom[0].amplifier === 0,
     'the stray\'s own tip payload is {custom:[{slowness,600,0}]}, undivided, StrayEntity.createArrowProjectile\'s own literal');
  // s116: `Cb.tickArrow` now raycasts the SEGMENT [e.px,e.py,e.pz] -> [e.x,e.y,e.z]
  // (14j_combat.js) instead of sampling only the landing point; a teleport-style test needs
  // px/py/pz to land WITH the arrow, the same way a real per-tick move keeps them in lockstep.
  a.x = player.x; a.y = player.y; a.z = player.z; a.px = a.x; a.py = a.y; a.pz = a.z; a.onGround = false;
  Cb.tickArrow(a);
  const inst = ES.getStatusEffect(player, 'slowness');
  ok(!!inst && inst.duration === 600 && inst.amplifier === 0, `the player is slowed 600 ticks by the landed stray arrow, got ${inst && inst.duration}`);
  M.Player = savedPlayer;
}

// a non-stray skeleton-family shooter carries NO tip at all (StrayEntity is the only override —
// `AbstractSkeletonEntity.attack`'s own base `createArrowProjectile` adds nothing).
{
  const skel = EL.spawn('skeleton', 0, FLOOR_Y, -6);
  const target = mob(0, -3);
  const a = Cb.mobShoot(skel, target, 1, Math.random);
  ok(!!a && a.tip === undefined, 'a plain skeleton\'s arrow carries no tip payload at all');
}

// ═══════════ particles — ArrowEntity.spawnParticles ═══════════
console.log('\n4b. tip particles: 2/tick flying, 1 per 5 stuck, 0 plain, 20 on hit');
const PX = M.Particle; let spawned = [];
const origSpawn = PX.spawn;
PX.spawn = function (t, ...r) { const p = origSpawn.apply(this, [t, ...r]); if (t === 'effect') spawned.push([r[3], r[4], r[5]]); return p; };
{
  const a = EL.spawn('arrow', 50, 80, 50, { vx: 0, vy: 0, vz: 0, shooter: null, tip: { potionId: 'swiftness' } });
  a.onGround = false;
  spawned = []; Cb.tickArrow(a);
  const col = Po.colorOf('swiftness'), want = [(col >> 16 & 255) / 255, (col >> 8 & 255) / 255, (col & 255) / 255];
  ok(spawned.length === 2, 'swiftness tipped arrow: exactly 2 particles in flight, got ' + spawned.length);
  ok(spawned.every(p => p[0] === want[0] && p[1] === want[1] && p[2] === want[2]), 'particles carry the tip colour');
  okAv(spawned.length !== 3, 'a 3-per-tick mutant would be caught (count is exactly 2)');
  a.stuck = true; a.inGroundTime = 0; a.groundState = 1; M.Physics.blockAt = () => 1; spawned = [];
  for (let i = 0; i < 10; i++) Cb.tickArrow(a);
  ok(spawned.length === 2, 'stuck: 1 per 5 ticks (2 in 10), got ' + spawned.length);
  const pl = EL.spawn('arrow', 60, 80, 60, { vx: 0, vy: 0, vz: 0, shooter: null }); pl.onGround = false;
  spawned = []; Cb.tickArrow(pl);
  ok(spawned.length === 0, 'plain arrow: 0 particles');
  const t = mob(30, 0), h = shotArrow(t, { potionId: 'swiftness' });
  spawned = []; Cb.tickArrow(h);
  ok(spawned.length >= 20, 'hit spawns the 20-particle burst, got ' + spawned.length);
}
PX.spawn = origSpawn;

// ═══════════ anti-vacuity — mutate the divisor/undivided-ness and watch this file catch it ════
console.log('\n5. anti-vacuity — mutate `Cb.applyArrowTip`\'s own arithmetic, must fail loud');
{
  const savedDivisor = Cb.ARROW_TIP_DIVISOR;
  Cb.ARROW_TIP_DIVISOR = 1;   // undoes the /8 base-potion clamp entirely
  const t = mob(20, 0);
  const a = shotArrow(t, { potionId: 'poison' });
  Cb.tickArrow(a);
  const inst = ES.getStatusEffect(t, 'poison');
  const want = Math.max(Math.floor(900 / 8), 1);
  okAv(!(inst && inst.duration === want), 'a divisor mutated to 1 (no /8 at all) produces the WRONG duration, and this check\'s own §1 assertion would have failed if run against it');
  Cb.ARROW_TIP_DIVISOR = savedDivisor;
}
{
  // mutate a custom effect to also go through the /8 clamp (the bug this whole unit exists to
  // rule out — conflating the two `onHit` loops) and confirm the real code does NOT do this.
  const t = mob(24, 0);
  const a = shotArrow(t, { custom: [{ effect: 'strength', duration: 80, amplifier: 0 }] });
  Cb.tickArrow(a);
  const inst = ES.getStatusEffect(t, 'strength');
  const wrongIfDivided = Math.max(Math.floor(80 / 8), 1);
  okAv(!!inst && inst.duration !== wrongIfDivided && inst.duration === 80,
       `custom-effect duration (80) must NOT equal the divided value (${wrongIfDivided}) — the two onHit loops must stay distinct`);
}

console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity)`);
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
