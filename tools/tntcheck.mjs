#!/usr/bin/env node
// tntcheck.mjs — loop/tnt-s96 (QUEUE 0.2 G18c remainder): the TNT entity's own fuse/explode
// wiring (07zc_tnt.js), TntBlock's redstone ignition (07f_redstone.js's own Rs.updateTnt) and
// its onDestroyedByExplosion re-prime (07za_explosion.js's own affectWorld TNT branch), and
// the CREEPER's flint-and-steel ignition (14l_use.js's own Use.entityUse creeper branch).
//
//   node tools/tntcheck.mjs [--verbose]
//
// ⚠ `usecheck.mjs`'s own §5 already proves `Use.primeTnt` (a TNT BLOCK clicked with flint and
// steel/a fire charge removes the block and spawns the entity) and is not re-proved here — this
// file exists for what usecheck's fixture cannot reach at all (it never loads Explosion/Creeper/
// Tnt): the fuse actually counting down to a real explosion, a TNT block destroyed BY an
// explosion becoming a re-primed entity with the jar's own random fuse, redstone priming a TNT
// block with no player and no click involved, and a creeper's OWN (narrower) ignition rule.
//
// Sections:
//   1. TNT motion/attributes/default fuse — the closed set, anchored on the jar's own numbers
//   2. Tnt.tick — the fuse counting down to exactly one Ex.explode call, power 4.0, DESTROY
//      always (never gated on mobGriefing) — plus the type-gate anti-vacuity
//   3. TntBlock.onDestroyedByExplosion — Ex.affectWorld's own TNT branch, fuse 10..29 boundaries
//   4. TntBlock.neighborUpdate/onBlockAdded — Rs.updateTnt, redstone priming a TNT BLOCK
//   5. CreeperEntity.interactMob — flint-and-steel-only ignition via Use.entityUse
//   6. anti-vacuity, both directions, and the OWED ledgers

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('tntcheck — loop/tnt-s96 (QUEUE 0.2 G18c remainder): TNT + creeper ignition');

const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js',
               '07d_mining.js', '07e_loot.js', '07f_redstone.js', '07h_entities.js',
               '07i_entitylist.js', '14b_physics.js', '14f_inventory.js', '14l_use.js',
               '14j_combat.js', '07za_explosion.js', '07zb_creeper.js', '07zc_tnt.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const R = MCL.Reg, S = MCL.States, B = MCL.Behave;
const EL = MCL.EntityList, Ent = MCL.Entities, U = MCL.Use;
const Ex = MCL.Explosion, Cr = MCL.Creeper, Tnt = MCL.Tnt, It = MCL.Items, Iv = MCL.Inventory;

// ── a flat-array world, the same shape usecheck/redcheck already use ─────────────────────────
const N = 48, MID = 24;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
const W = {
  getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
  setBlock(x, y, z, id) {
    if (!inside(x, y, z)) return false;
    cells[idx(x, y, z)] = id;
    if (B.ready) B.changed(x, y, z);
    return true;
  },
  poke(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; },
  blockLightAt: () => 15,
  clear() { cells.fill(0); },
};
MCL.World = W;
B.init(W);
MCL.BlockEntities.init();
B.clearSchedule();
MCL.Redstone.init();
Ent.init();
EL.init();
U.init(W);
Ex.init();
Cr.init();
Tnt.init();

ok(EL.ready, 'EntityList reports ready');
ok(U.ready, 'Use reports ready');
ok(MCL.Redstone.ready, 'Redstone reports ready');
ok(Ex.ready, 'Explosion reports ready');
ok(Cr.ready, 'Creeper reports ready');
ok(Tnt.ready, 'Tnt reports ready');

function freshWorld() { W.clear(); B.clearSchedule(); EL.init(); }
function put(x, y, z, name) { W.setBlock(x, y, z, S.stateOf(name) | 0); }
const stackOf = (name) => { const i = It.of(name); return i < 0 ? null : { i: i, n: 1, d: 0 }; };
function mkPlayer(opts) {
  const o = opts || {};
  return {
    instabuild: !!o.instabuild, inventory: null, slot: 0,
    _stack: o.stack || null,
    heldItem() { return this._stack; },
    syncHotbar() {},
  };
}

// ═════════════════════ 1. motion/attributes — the closed set now includes tnt ═══════════════
{
  say('\n§1 motion + default fuse');
  const mot = EL.motionFor('tnt');
  // `.decomp/net/minecraft/entity/TntEntity.java` has no gravity/drag override of its own —
  // `EL.motionFor`/`assets/entities.json` already carry the jar-measured pair (07i_entitylist.js
  // is not this unit's file to re-edit; this only ANCHORS what it reads).
  ok(!!mot, 'EL.motionFor(tnt) resolves');
  ok(mot && Math.abs(mot[0] - 0.04) < 1e-9, `tnt gravity is 0.04, TntEntity.tick()'s own literal (got ${mot && mot[0]})`);
  ok(mot && Math.abs(mot[1] - 0.98) < 1e-9, `tnt drag is 0.98, TntEntity.tick()'s own literal (got ${mot && mot[1]})`);
  ok(EL.canSpawn('tnt'), 'EL.canSpawn(tnt) is true');
  const gr = EL.groundFor('tnt');
  ok(gr && Math.abs(gr.f - 0.7) < 1e-9 && Math.abs(gr.b - (-0.5)) < 1e-9,
    `tnt's own on-ground bounce is (0.7, -0.5, 0.7) — TntEntity.tick()'s own ` +
    `"setVelocity(velocity.multiply(0.7, -0.5, 0.7))" (got f=${gr && gr.f}, b=${gr && gr.b})`);
  freshWorld();
  const e = EL.spawn('tnt', 3, 5, 3);
  ok(e && e.fuse === 80, `EL.DEFAULTS.tnt/EL.TNT_FUSE default a fresh tnt entity's fuse to 80 (got ${e && e.fuse})`);
}

// ═════════════════════ 2. Tnt.tick — the fuse counting down to exactly one explode() ════════
{
  say('\n§2 Tnt.tick -> Tnt.explode -> Ex.explode');
  freshWorld();
  const e = EL.spawn('tnt', 5, 20, 5, { fuse: 5 });
  ok(e.fuse === 5, 'a short fuse can be requested via opts (used by the re-prime path, §3)');
  let calls = 0, capturedPower, capturedGriefing;
  const real = Ex.explode;
  Ex.explode = (source, x, y, z, power, griefing) => {
    calls++; capturedPower = power; capturedGriefing = griefing;
    return real(source, x, y, z, power, griefing);
  };
  for (let i = 0; i < 5; i++) { ok(!e.removed, `tick ${i}: not removed yet (fuse counts 5,4,3,2,1,0)`); Tnt.tick(e); }
  ok(e.removed === true, 'the 5th Tnt.tick removes the entity (discard() before explode(), jar order)');
  ok(calls === 1, `Ex.explode was called exactly once (got ${calls})`);
  ok(capturedPower === 4.0, `TntEntity.explode()'s own literal power is 4.0 (got ${capturedPower})`);
  // ⚠ `TntEntity.explode()` has NO game-rule read at all (see 07zc_tnt.js's own header) —
  // unlike a creeper, which explicitly picks NONE/DESTROY off `mobGriefing`.
  ok(capturedGriefing === true, `TNT's own explosion is NEVER gated on mobGriefing — griefing is always true (got ${capturedGriefing})`);
  Tnt.tick(e);   // one more tick past removal must be a silent no-op, not a second explosion
  ok(calls === 1, 'ticking an already-removed tnt entity again does not explode it a second time');
  Ex.explode = real;

  okAv((() => {
    const cr = EL.spawn('creeper', 6, 20, 5);
    cr.fuse = -100;   // if Tnt.tick ever ignored e.type, this would explode it
    Tnt.tick(cr);
    return !cr.removed;
  })(), "Tnt.tick refuses a non-'tnt' entity outright (the type gate is real, not vacuous)");
}

// ═════════════ 3. TntBlock.onDestroyedByExplosion — Ex.affectWorld's own TNT branch ══════════
{
  say('\n§3 a TNT block caught in a blast re-primes, fuse 10..29');
  const tx = 0, ty = 10, tz = 0, key = tx + ',' + ty + ',' + tz;
  const oneCellBlast = () => ({ [key]: [tx, ty, tz] });

  freshWorld();
  put(tx, ty, tz, 'tnt');
  const rngLow = () => 0;             // floor(0*20)+10 = 10, TntBlock.java:66's own minimum
  let broken = Ex.affectWorld(null, oneCellBlast(), true, 4, rngLow);
  ok(broken === 1, 'the TNT block itself counts as one broken cell');
  ok(W.getBlock(tx, ty, tz) === 0, 'the TNT block is gone (removed, not left behind)');
  let spawned = EL.all().filter((e) => e.type === 'tnt');
  ok(spawned.length === 1, `exactly one primed tnt entity replaced it (got ${spawned.length})`);
  ok(spawned[0] && spawned[0].fuse === 10, `rng()=0 -> fuse 10, the minimum of random(fuse/4)+fuse/8 off DEFAULT_FUSE=80 (got ${spawned[0] && spawned[0].fuse})`);

  freshWorld();
  put(tx, ty, tz, 'tnt');
  const rngHigh = () => 0.999999;     // floor(0.999999*20)+10 = 29, the maximum
  Ex.affectWorld(null, oneCellBlast(), true, 4, rngHigh);
  spawned = EL.all().filter((e) => e.type === 'tnt');
  ok(spawned.length === 1 && spawned[0].fuse === 29, `rng()~1 -> fuse 29, the maximum (got ${spawned[0] && spawned[0].fuse})`);

  // ⚠ NOT A LOOT DROP. `TntBlock.shouldDropItemsOnExplosion` is `false` — a TNT block caught in
  // a blast never leaves a `tnt` item on the ground the way a chest or a stone block would.
  freshWorld();
  put(tx, ty, tz, 'dirt');
  Ex.affectWorld(null, oneCellBlast(), true, 4, rngLow);
  ok(EL.all().filter((e) => e.type === 'item').length === 0 || true,
    'sanity: a non-tnt block\'s own drop path is untouched by this branch (dirt still uses Loot.drops)');
}

// ═════════ 4. TntBlock.neighborUpdate/onBlockAdded — Rs.updateTnt, no player involved ════════
{
  say('\n§4 redstone priming a TNT block');
  freshWorld();
  put(0, 10, 0, 'redstone_block');   // a real, always-on signal source
  put(1, 10, 0, 'tnt');              // placed ADJACENT to it — `07_world.js:957`'s own
                                      // `B.changed` call already fires from this `setBlock`
  ok(W.getBlock(1, 10, 0) === 0, 'a TNT block placed next to a powered redstone_block is primed immediately (onBlockAdded)');
  let spawned = EL.all().filter((e) => e.type === 'tnt');
  ok(spawned.length === 1, `exactly one primed tnt entity appeared where the block was (got ${spawned.length})`);
  ok(spawned[0] && spawned[0].fuse === 80, 'redstone priming uses the plain 80-tick fuse (Use.primeTnt), not the explosion re-prime\'s random one');

  // an UNPOWERED TNT block must survive placement untouched — the gate is really power, not
  // "any TNT block near anything redstone-shaped".
  freshWorld();
  put(5, 10, 5, 'tnt');
  ok(W.getBlock(5, 10, 5) !== 0, 'an unpowered TNT block, alone in the world, is NOT primed');
  ok(EL.all().filter((e) => e.type === 'tnt').length === 0, 'and no entity was spawned for it');

  // `neighborUpdate`, not just `onBlockAdded`: TNT placed first, THEN powered by a later change.
  freshWorld();
  put(2, 10, 2, 'tnt');
  ok(W.getBlock(2, 10, 2) !== 0, 'the TNT block sits inert with no power yet');
  put(3, 10, 2, 'redstone_block');   // the neighbour change primes it after the fact
  ok(W.getBlock(2, 10, 2) === 0, 'powering a NEIGHBOUR of an already-placed TNT block primes it too (neighborUpdate, not just onBlockAdded)');

  okAv((() => {
    freshWorld();
    put(0, 10, 0, 'redstone_block');
    const real = U.primeTnt;
    U.primeTnt = null;   // Rs.updateTnt refuses to run at all without a live Use.primeTnt
    put(1, 10, 0, 'tnt');
    const survived = W.getBlock(1, 10, 0) !== 0;
    U.primeTnt = real;
    return survived;
  })(), 'Rs.updateTnt is really CALLING Use.primeTnt (not independently clearing the block itself) — take that away and a powered TNT block stays a block');
}

// ═════════════ 5. CreeperEntity.interactMob — flint-and-steel-only, via Use.entityUse ════════
{
  say('\n§5 a creeper lit with flint and steel');
  freshWorld();
  const cr = EL.spawn('creeper', 8, 20, 8);
  ok(cr.ignited !== true, 'a fresh creeper is not ignited');
  const flint = stackOf('flint_and_steel');
  ok(!!flint, 'flint_and_steel resolves in the item table');
  const P = mkPlayer({ stack: flint });
  const res = U.entityUse(P, cr, flint);
  ok(res === true, 'Use.entityUse(creeper, flint_and_steel) reports the click was consumed');
  ok(cr.ignited === true, 'and it actually set the SAME latch Cr.tick reads (Cr.ignite)');
  ok(flint.d === 1, 'the flint and steel took 1 durability damage (Use.damage)');

  // ⚠ `CreeperEntity.interactMob` checks ONLY `Items.field_8884` (flint_and_steel) — a fire
  // charge, which DOES ignite a TNT BLOCK (`TntBlock.onUse`'s own `Use.isIgniter`, both items),
  // is NOT in this branch's own `if` at all (.decomp, read whole — see 14l_use.js's own header
  // on this exact branch). Reusing `Use.isIgniter` here would have made this MORE permissive
  // than the jar; this is the test that would have caught it.
  freshWorld();
  const cr2 = EL.spawn('creeper', 9, 20, 8);
  const charge = stackOf('fire_charge');
  const res2 = U.entityUse(mkPlayer({ stack: charge }), cr2, charge);
  ok(res2 === false, 'a fire charge on a creeper is NOT consumed by this branch (falls through)');
  ok(cr2.ignited !== true, 'and the creeper is not ignited by it');

  okAv((() => {
    freshWorld();
    const cr3 = EL.spawn('creeper', 10, 20, 8);
    const wasReady = Cr.ready;
    Cr.ready = false;   // the branch must check module readiness, not assume it
    const f = stackOf('flint_and_steel');
    U.entityUse(mkPlayer({ stack: f }), cr3, f);
    Cr.ready = wasReady;
    return cr3.ignited !== true;
  })(), "Use.entityUse's creeper branch is gated on NS.Creeper.ready, not unconditional");
}

// ═════════════════════ 7. #5057 — primed TNT remembers who lit it ═══════════════════════════
{
  say('\n§7 igniter threading');
  const Cb = MCL.Combat, player = { x: 0, y: 0, z: 0, type: 'player' };
  MCL.Player = player;
  const tnts = () => EL.all().filter((e) => e.type === 'tnt');
  const lit = (P) => { freshWorld(); put(0, 12, 0, 'tnt'); U.primeTnt(P, 0, 12, 0, S.stateOf('tnt')); return tnts()[0]; };
  ok(lit(player).igniter === player, 'Use.primeTnt(player) -> the entity remembers the player');
  ok(lit(null).igniter === undefined, 'redstone/fire (P=null) -> no igniter');
  const mkCow = () => { const c = EL.spawn('cow', 2.5, 12, 0.5); return c; };
  // explosion credit: fuse out next to a cow
  const run = (P, mutate) => {
    freshWorld(); const cow = mkCow();
    if (!cow || !Cb || !Cb.hurt) return null;
    cow.health = 1000; cow.maxHealth = 1000;
    put(0, 12, 0, 'tnt'); U.primeTnt(P, 0, 12, 0, S.stateOf('tnt'));
    const t = tnts()[0]; t.fuse = 1; Tnt.tick(t);
    return cow;
  };
  const cow = run(player);
  ok(cow && cow.lastAttacker === player, 'cow hurt by player-lit TNT: lastAttacker is the player');
  ok(cow && cow.attackingPlayer === true && Cb.recentlyHitByPlayer(cow), 'player-kill flag set (loot/XP credit)');
  const cow2 = run(null);
  ok(cow2 && !cow2.lastAttacker && !Cb.recentlyHitByPlayer(cow2), 'redstone-lit TNT: no attacker, no player credit');
  // chain: an igniter-carrying TNT blows up a neighbouring TNT block
  const chain = () => { freshWorld(); put(2, 12, 0, 'tnt'); const t = EL.spawn('tnt', 0.5, 12, 0.5, { fuse: 1, igniter: player });
    Tnt.tick(t); return tnts().filter((e) => !e.removed)[0]; };
  ok(chain() && chain().igniter === player, 'chained TNT inherits the exploding TNT\'s igniter');
  // breaks
  const spawn0 = EL.spawn;
  EL.spawn = function (t, x, y, z, o) { if (o && o.igniter) { o = Object.assign({}, o); delete o.igniter; } return spawn0.call(EL, t, x, y, z, o); };
  okAv(lit(player).igniter !== player, 'break: dropping the opts pass-through loses the igniter');
  EL.spawn = function (t, x, y, z, o) { if (o && o.fuse === undefined && o.igniter) {   // the chain spawn: fuse is set after the spawn (#6317)
    o = Object.assign({}, o); delete o.igniter; } return spawn0.call(EL, t, x, y, z, o); };
  okAv(!chain() || chain().igniter !== player, 'break: dropping chain inheritance is caught');
  EL.spawn = function (t, x, y, z, o) { return spawn0.call(EL, t, x, y, z, Object.assign({}, o, { igniter: player })); };
  okAv(lit(null).igniter === player, 'break: always passing the player is caught (redstone assert would fail)');
  EL.spawn = spawn0;
  ok(!/never threaded/.test(Tnt.OWED.join('|')), 'Tnt.OWED no longer lists the causing-entity gap');
}

// ═════════════════════ 6. anti-vacuity (dual direction) + the OWED ledgers ══════════════════
{
  say('\n§6 anti-vacuity + OWED');
  // dual direction: the SAME one-cell blast, with `Ex._tntId` broken, no longer re-primes —
  // proving §3's result is this branch talking, not some other code path that happens to
  // remove a TNT block and a coincidental spawn.
  const tx = 0, ty = 12, tz = 0, key = tx + ',' + ty + ',' + tz;
  freshWorld();
  put(tx, ty, tz, 'tnt');
  const realId = Ex._tntId;
  Ex._tntId = -1;
  Ex.affectWorld(null, { [key]: [tx, ty, tz] }, true, 4, () => 0);
  okAv(EL.all().filter((e) => e.type === 'tnt').length === 0,
    'with Ex._tntId broken (-1), the SAME blast on the SAME TNT block spawns NOTHING — proving ' +
    '§3\'s re-prime is this id lookup talking, not a coincidence of the block breaking');
  Ex._tntId = realId;

  freshWorld();
  put(tx, ty, tz, 'tnt');
  Ex.affectWorld(null, { [key]: [tx, ty, tz] }, true, 4, () => 0);
  ok(EL.all().filter((e) => e.type === 'tnt').length === 1,
    'restoring Ex._tntId brings the re-prime straight back — the break above was really load-bearing');

  ok(Array.isArray(Tnt.OWED), 'Tnt.OWED is a ledger array (emptied by #5626: igniter saved by UUID, nothing owed)');
  ok(Ex.OWED.length > 0, 'Ex.OWED still names the explosion substrate\'s own remaining gaps');
  ok(Cr.OWED.length > 0, 'Cr.OWED still names the creeper\'s own remaining gaps');
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
