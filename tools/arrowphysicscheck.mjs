#!/usr/bin/env node
// arrowphysicscheck.mjs — s116, G18 Ai.OWED's own arrow-physics residue (07k_goals.js ~67-120):
// `PersistentProjectileEntity.tick()`'s real segment raycast (tunneling), `inGround`/`shouldFall`/
// `age()` (a stuck arrow that despawns, is drawn, and falls again once its block is gone), and
// `onPlayerCollision`/`tryPickup` (a picked-up arrow really returns to the inventory), all in
// `Cb.tickArrow`/`Cb.tickStuckArrow`/`Cb.tryArrowPickup` (14j_combat.js), against `.decomp/net/
// minecraft/entity/projectile/PersistentProjectileEntity.java` and `ProjectileUtil.java`, both
// read whole.
//
//   node tools/arrowphysicscheck.mjs [--verbose]
//
// Sections:
//   1. tunneling — a fast arrow crossing a thin target within ONE tick still lands the hit,
//      through the real `EntityList.tick()` loop (not a hand-called `Cb.tickArrow`)
//   2. embedding — a sideways shot into a wall, and a straight-up shot into a ceiling, both go
//      `e.stuck`, not just a downward landing (the old `e.onGround`-only gap)
//   3. despawn — `Cb.ARROW_STUCK_TICKS` (1200) after landing, `e.removed`
//   4. shouldFall — breaking the block a stuck arrow sits in makes it fall again
//   5. pickup — ALLOWED (player/survival, a real item back in the inventory), CREATIVE_ONLY
//      (player/creative, no item, just removed), DISALLOWED (mob-fired, never picked up)
//   6. anti-vacuity — break the inflate box, the despawn clock and the pickup permission gate

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('arrowphysicscheck — s116: PersistentProjectileEntity, closed (segment raycast, inGround/shouldFall/age, pickup)');

const M = loadEngine({
  extra: ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Entities.init();
M.EntityList.init();
M.Combat.init();
ok(M.Combat.ready, 'Combat module reports ready');

const EL = M.EntityList, Cb = M.Combat, Iv = M.Inventory, W = M.World, CH = M.CH;
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone');
const PLAT_Y = 8;

function freshWorld() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
}
function plate(radius, y) {
  const yy = y === undefined ? PLAT_Y : y;
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, yy, z, STONE);
}
const mob = (x, y, z) => { const e = EL.spawn('turtle', x, y, z); e.maxHealth = e.health = 1000; return e; };
function player(opts) {
  return Object.assign({
    x: 0, y: PLAT_Y + 1, z: 0, width: 0.6, height: 1.8, instabuild: false,
    inventory: Iv.create(), syncHotbar() {},
  }, opts || {});
}

// ═══════════ 1. tunneling — the whole SEGMENT, not the landing point ═══════════════════════
console.log('\n1. tunneling — a fast arrow crossing a thin target within one tick still lands the hit');
freshWorld();
{
  // a thin (0.6-wide) target ten blocks out; the arrow's own per-tick speed (D-402's own
  // `Cb.ARROW_SHOOT_SPEED`, ~3 blocks/tick at full draw) previously could step clean OVER it —
  // this arrow is given an even faster, hand-set velocity to make the single-tick overshoot
  // unambiguous regardless of that constant's own value.
  const t = mob(10, PLAT_Y + 1, 0);
  const a = EL.spawn('arrow', 0, PLAT_Y + 1, 0, { vx: 40, vy: 0, vz: 0, shooter: null });
  ok(!!a, 'a fast arrow could be spawned');
  EL.tick();
  ok(a.removed === true, 'the arrow landed a hit on the FIRST tick despite crossing the target\'s whole 0.6-block width in one step');
  ok(t.health < t.maxHealth, 'and the target actually took damage, not a false positive on some other field');
  EL.clear();
}
{
  // the same shot, but the target is BEHIND the arrow's spawn point — the segment must not
  // register a hit for something outside [prevPos, pos] (illegal direction refused).
  const t2 = mob(-10, PLAT_Y + 1, 0);
  const a2 = EL.spawn('arrow', 0, PLAT_Y + 1, 0, { vx: 40, vy: 0, vz: 0, shooter: null });
  EL.tick();
  ok(!a2.removed && t2.health === t2.maxHealth, 'a target behind the arrow\'s own direction of travel is not hit');
  EL.clear();
}

// ═══════════ 2. embedding — any direction, not just a downward landing ═════════════════════
console.log('\n2. embedding — a sideways wall shot and a straight-up ceiling shot both go `e.stuck`');
freshWorld();
{
  // a vertical wall at x=5
  for (let y = PLAT_Y - 2; y <= PLAT_Y + 6; y++) for (let z = -3; z <= 3; z++) W.setBlock(5, y, z, STONE);
  const a = EL.spawn('arrow', 0, PLAT_Y + 2, 0, { vx: 3, vy: 0, vz: 0, shooter: null });
  for (let i = 0; i < 10 && !a.stuck; i++) EL.tick();
  ok(a.stuck === true, 'a sideways shot into a wall goes `e.stuck` (the OLD `e.onGround`-only test never caught this at all)');
  ok(a.vx > 0 && a.vx < 3, 'and its velocity is onBlockHit\'s hit offset (hitPos - pos, then drag), not the flight velocity and not zero');
  const rx = a.x, ry = a.y, rz = a.z;
  EL.tick(); EL.tick();
  ok(a.x === rx && a.y === ry && a.z === rz, 'and it FREEZES in place — the generic gravity/move pipeline no longer runs on it once stuck');
  EL.clear();
}
{
  // a ceiling directly overhead
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) W.setBlock(x, PLAT_Y + 5, z, STONE);
  const a = EL.spawn('arrow', 0, PLAT_Y + 1, 0, { vx: 0, vy: 3, vz: 0, shooter: null });
  for (let i = 0; i < 10 && !a.stuck; i++) EL.tick();
  ok(a.stuck === true, 'a straight-up shot into a ceiling also goes `e.stuck`');
  EL.clear();
}
{
  // the anti-vacuity control for §2: a bare open shot must NOT go stuck at all
  const a = EL.spawn('arrow', 0, PLAT_Y + 20, 0, { vx: 3, vy: 0, vz: 0, shooter: null });
  for (let i = 0; i < 5; i++) EL.tick();
  okAv(a.stuck !== true, 'anti-vacuity: an arrow flying through open air must NOT go stuck — proves §2 is testing a real transition, not an always-true flag');
  EL.clear();
}

// ═══════════ 3. despawn — Cb.ARROW_STUCK_TICKS after landing ═══════════════════════════════
console.log('\n3. despawn — a stuck arrow discards itself after Cb.ARROW_STUCK_TICKS (1200)');
freshWorld();
plate(6);
{
  const a = EL.spawn('arrow', 0, PLAT_Y + 3, 0, { vx: 0, vy: -3, vz: 0, shooter: null });
  for (let i = 0; i < 20 && !a.stuck; i++) EL.tick();
  ok(a.stuck === true, 'the arrow landed on the platform');
  a.groundTicks = Cb.ARROW_STUCK_TICKS - 2;
  EL.tick();
  ok(a.removed !== true, `one tick before the threshold (${Cb.ARROW_STUCK_TICKS}) it is still alive`);
  EL.tick();
  ok(a.removed === true, `at exactly ${Cb.ARROW_STUCK_TICKS} ticks embedded, the arrow discards itself (age(): life >= 1200 -> discard())`);
  EL.clear();
}

// ═══════════ 4. shouldFall — the block it sat in gets removed, it falls again ══════════════
console.log('\n4. shouldFall — breaking the block a stuck arrow sits in makes it fall again');
freshWorld();
plate(6);
{
  // spawned CELL-CENTRED (0.5, 0.5) rather than on an integer boundary: at x=0/z=0 the arrow's
  // own 0.5-wide box straddles FOUR neighbouring cell columns, and removing only the one block
  // directly below leaves it still resting on a diagonal neighbour of the SAME dense floor —
  // a fixture artifact, not a physics one, that a cell-centred spawn sidesteps entirely.
  const a = EL.spawn('arrow', 0.5, PLAT_Y + 3, 0.5, { vx: 0, vy: -3, vz: 0, shooter: null });
  for (let i = 0; i < 20 && !a.stuck; i++) EL.tick();
  ok(a.stuck === true, 'the arrow landed');
  const restY = a.y;
  W.setBlock(0, PLAT_Y, 0, 0);   // the block it landed on is gone
  EL.tick();
  ok(a.stuck === false, 'the very next tick, the arrow un-sticks (shouldFall: the block it sat in no longer covers it)');
  for (let i = 0; i < 10; i++) EL.tick();
  ok(a.y < restY, 'and it actually resumes falling — gravity, the SAME generic pipeline every other entity uses, took back over');
  EL.clear();
}
{
  // anti-vacuity: with the block left in place, the SAME arrow must stay put — a fresh floor,
  // since §4's own first block just punched a hole in the shared one above.
  freshWorld();
  plate(6);
  const a = EL.spawn('arrow', 0.5, PLAT_Y + 3, 0.5, { vx: 0, vy: -3, vz: 0, shooter: null });
  for (let i = 0; i < 20 && !a.stuck; i++) EL.tick();
  const restY = a.y;
  for (let i = 0; i < 30; i++) EL.tick();
  okAv(a.y === restY, 'anti-vacuity: with the block left untouched, the same arrow does NOT fall — proves §4 is reacting to the removal, not just aging out on its own');
  EL.clear();
}

// ═══════════ 5. pickup — ALLOWED / CREATIVE_ONLY / DISALLOWED ══════════════════════════════
console.log('\n5. pickup — PersistentProjectileEntity.onPlayerCollision/tryPickup, transcribed');
freshWorld();
plate(10);   // wide enough for every x in {0,2,4,6,8} below, not just plate(6)'s own §3/§4 radius
function stuckArrowAt(x, y, z, opts) {
  const a = EL.spawn('arrow', x, y + 3, z, { vx: 0, vy: -3, vz: 0, shooter: null });
  // `pickupType`/`pickupItem`/`pickupTag` are set on the returned entity directly by
  // `Use.bowRelease` (14l_use.js), not through `EL.spawn`'s own opts whitelist -- matching
  // that exactly, not a copy-through this file invents.
  Object.assign(a, opts || {});
  for (let i = 0; i < 20 && !a.stuck; i++) EL.tick();
  return a;
}
{
  // ALLOWED: a player-fired survival arrow, touched, goes back into the inventory
  const a = stuckArrowAt(0, PLAT_Y, 0, { pickupType: 'allowed', pickupItem: 'arrow' });
  ok(a.stuck === true, 'the survival arrow landed');
  const P = player({ x: a.x, y: a.y, z: a.z });
  M.Player = P;
  a.shake = 0;
  EL.tick();
  ok(a.removed === true, 'ALLOWED: touched by the player, the arrow is removed');
  ok(Iv.countOf(P.inventory, 'arrow') === 1, 'and a real `arrow` item stack landed in the inventory');
  EL.clear();
}
{
  // CREATIVE_ONLY: a creative/Infinity shot — removed on touch, but NOTHING added to the
  // inventory (a creative player's own arrows are free, `PersistentProjectileEntity.tryPickup`'s
  // own CREATIVE_ONLY branch never calls insertStack at all).
  const a = stuckArrowAt(2, PLAT_Y, 0, { pickupType: 'creative_only', pickupItem: 'arrow' });
  const P = player({ x: a.x, y: a.y, z: a.z, instabuild: true });
  M.Player = P;
  a.shake = 0;
  EL.tick();
  ok(a.removed === true, 'CREATIVE_ONLY, creative player: touched, the arrow is removed');
  ok(Iv.countOf(P.inventory, 'arrow') === 0, 'but NOTHING was added to the inventory — a creative pickup is a free vanish, not an item');
  EL.clear();
}
{
  // CREATIVE_ONLY but the TOUCHING player is in SURVIVAL: tryPickup returns false, stays put
  const a = stuckArrowAt(4, PLAT_Y, 0, { pickupType: 'creative_only', pickupItem: 'arrow' });
  const P = player({ x: a.x, y: a.y, z: a.z, instabuild: false });
  M.Player = P;
  a.shake = 0;
  EL.tick();
  ok(a.removed !== true, 'CREATIVE_ONLY, but a SURVIVAL player touches it: the arrow stays — tryPickup\'s own creative-only branch refuses a non-creative player');
  EL.clear();
}
{
  // DISALLOWED (the default): a mob-fired arrow, never picked up
  const a = stuckArrowAt(6, PLAT_Y, 0, { shooter: null });   // Cb.mobShoot never sets pickupType
  ok(a.pickupType === undefined, 'a mob-fired arrow carries no pickupType at all (the default, DISALLOWED)');
  const P = player({ x: a.x, y: a.y, z: a.z });
  M.Player = P;
  a.shake = 0;
  EL.tick();
  ok(a.removed !== true, 'DISALLOWED: touched by the player, the arrow is NOT removed');
  ok(Iv.countOf(P.inventory, 'arrow') === 0, 'and nothing was added to the inventory');
  EL.clear();
}
{
  // the shake gate: right after landing, a touch does NOT pick it up yet
  const a = stuckArrowAt(8, PLAT_Y, 0, { pickupType: 'allowed', pickupItem: 'arrow' });
  ok(a.shake > 0, 'a freshly-landed arrow starts with shake > 0 (onBlockHit\'s own `this.shake = 7`)');
  const P = player({ x: a.x, y: a.y, z: a.z });
  M.Player = P;
  EL.tick();
  ok(a.removed !== true, 'shake still counting down: a touch on the SAME landing tick does not pick it up yet');
  EL.clear();
}
M.Player = null;

// ═══════════ 6. anti-vacuity — mutate the inflate box, the clock, the permission gate ══════
console.log('\n6. anti-vacuity — break the entity-inflate box, the despawn clock, the pickup gate');
freshWorld();
{
  const savedIn = Cb.ARROW_ENTITY_INFLATE;
  Cb.ARROW_ENTITY_INFLATE = -10;   // shrinks every candidate box to nothing -- no ray can ever enter it
  const t = mob(10, PLAT_Y + 1, 0);
  const a = EL.spawn('arrow', 0, PLAT_Y + 1, 0, { vx: 40, vy: 0, vz: 0, shooter: null });
  EL.tick();
  okAv(a.removed !== true, 'anti-vacuity: a hostile-inflate mutation makes the SAME §1 shot miss, proving the segment/box test is load-bearing, not vacuously true');
  Cb.ARROW_ENTITY_INFLATE = savedIn;
  EL.clear();
}
{
  const savedT = Cb.ARROW_STUCK_TICKS;
  Cb.ARROW_STUCK_TICKS = 3;
  plate(6);
  const a = EL.spawn('arrow', 0, PLAT_Y + 3, 0, { vx: 0, vy: -3, vz: 0, shooter: null });
  for (let i = 0; i < 20 && !a.stuck; i++) EL.tick();
  for (let i = 0; i < 3; i++) EL.tick();
  okAv(a.removed === true, `anti-vacuity: Cb.ARROW_STUCK_TICKS mutated to 3 despawns in 3 ticks, proving §3 reads this constant rather than a hard-coded 1200`);
  Cb.ARROW_STUCK_TICKS = savedT;
  EL.clear();
}
{
  const savedFn = Cb.tryArrowPickup;
  Cb.tryArrowPickup = function (e) { if (e.shake > 0) return false; e.removed = true; return true; };   // ignores pickupType entirely
  const a = stuckArrowAt(0, PLAT_Y, 0, { shooter: null });   // DISALLOWED
  const P = player({ x: a.x, y: a.y, z: a.z });
  M.Player = P;
  a.shake = 0;
  EL.tick();
  okAv(a.removed === true, 'anti-vacuity: a Cb.tryArrowPickup that ignores pickupType entirely DOES pick up a DISALLOWED arrow, proving §5\'s own DISALLOWED assertion is load-bearing');
  Cb.tryArrowPickup = savedFn;
  M.Player = null;
  EL.clear();
}

console.log('\n7. gravity ordering — move(old v), THEN drag, THEN gravity (KW-34, 2330Z #7)');
freshWorld();
{
  // PersistentProjectileEntity.tick() (.decomp:214-251): moves with the velocity carried over
  // from the END of last tick, THEN v *= 0.99, THEN v.y -= 0.05F -- so THIS tick's drag/gravity
  // only ever reach NEXT tick's move. A purely-horizontal arrow (vy=0 at spawn) therefore drops
  // NOTHING on tick 1 (it moves with the spawn velocity, untouched) and vy is EXACTLY -0.05 by
  // the end of it; only from tick 2 on does the fall actually start.
  // cloud charming-euler: `EL.tickOne` no longer runs its generic `vy -= e.gravity` on an arrow at all
  // (`Cb.tickArrow` owns the whole flight), so tick 1 is now EXACT too -- no residual offset.
  const a = EL.spawn('arrow', 0, 100, 0, { vx: 1, vy: 0, vz: 0, shooter: null });
  ok(!!a, 'a flat arrow could be spawned');
  EL.tick();
  ok(Math.abs(a.y - 100) < 1e-9, `tick 1 moves with the untouched spawn velocity and drops nothing (vanilla's own tick 1) -- y ${a.y}, expected 100`);
  ok(Math.abs(a.vy - -0.05) < 1e-9, `tick 1 leaves vy at exactly -0.05 (0*0.99 - 0.05, vanilla's own end-of-tick-1) for tick 2's move -- vy ${a.vy}`);
  // from here the velocity recurrence matches vanilla's v_n = v_{n-1}*0.99 - 0.05 EXACTLY, tick
  // for tick (checked to 1e-6: the engine stores float32 velocity well past float noise) -- the earlier ~1-block-short drift this
  // bug caused is a GROWING error; this is what "fixed" actually looks like, not just "closer".
  let vv = -0.05;
  for (let t = 2; t <= 20; t++) {
    EL.tick();
    vv = vv * 0.99 - 0.05;
    ok(Math.abs(a.vy - vv) < 1e-6, `tick ${t}: vy matches vanilla's own recurrence exactly -- engine ${a.vy}, vanilla ${vv}`);
  }
}

// ═══════════ 8. the arrow flies as a POINT (PersistentProjectileEntity.tick's raycast) ════════
console.log('\n8. point flight — an arrow falling down a block corner slides past the neighbour, lands 0.05 short');
freshWorld();
plate(6);
{
  // a block at (0, PLAT_Y+1, -1): the falling arrow at x=0,z=0 shares its corner edge. A 0.5-wide
  // BOX would stop on its top (y = PLAT_Y+2); vanilla's point ray passes it and hits the floor.
  W.setBlock(0, PLAT_Y + 1, -1, STONE);
  const a = EL.spawn('arrow', 0, PLAT_Y + 4, 0, { vx: 0, vy: -1.2, vz: 0, shooter: null });
  for (let i = 0; i < 10 && !a.stuck; i++) EL.tick();
  ok(a.stuck === true, 'the corner-falling arrow landed');
  ok(Math.abs(a.y - (PLAT_Y + 1 + Cb.ARROW_HIT_BACKOFF)) < 1e-9,
     `it rests on the FLOOR, 0.05 short of the hit (onBlockHit's backoff) -- y ${a.y}, expected ${PLAT_Y + 1 + Cb.ARROW_HIT_BACKOFF}`);
  ok(a.groundCY === PLAT_Y && a.groundCX === 0 && a.groundCZ === 0, 'and the cell it embedded in is the floor block it hit');
  EL.clear();
  // the break: the same fall routed through the generic box clip (what the engine did before)
  const Ph = M.Physics;
  const b = EL.spawn('arrow', 0, PLAT_Y + 4, 0, { vx: 0, vy: -1.2, vz: 0, shooter: null });
  for (let i = 0; i < 10; i++) { b.vy -= 0.05; Ph.move(b, b.vx, b.vy, b.vz); b.vy *= 0.99; }
  okAv(b.y > PLAT_Y + 1.5, `anti-vacuity: a BOX-clipped arrow stops on the neighbour's top instead (y ${b.y}) -- §8 separates the two`);
  EL.clear();
}
{
  // a slab-shaped cell: the point test must use the real shape, not the whole cell
  const SLAB = stateOf('stone_slab');
  W.setBlock(3, PLAT_Y + 1, 3, SLAB);
  const a = EL.spawn('arrow', 3.5, PLAT_Y + 1.8, 3.5, { vx: 0, vy: -0.1, vz: 0, shooter: null });
  EL.tick();
  ok(a.stuck !== true, 'an arrow in the empty top half of a bottom-slab cell is NOT embedded (Ray.cast shapeStart)');
  for (let i = 0; i < 20 && !a.stuck; i++) EL.tick();
  ok(a.stuck === true && Math.abs(a.y - (PLAT_Y + 1.5 + Cb.ARROW_HIT_BACKOFF)) < 1e-6,
     `and it lands on the slab's real top -- y ${a.y}, expected ${PLAT_Y + 1.5 + Cb.ARROW_HIT_BACKOFF}`);
  EL.clear();
}

console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity)`);
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
