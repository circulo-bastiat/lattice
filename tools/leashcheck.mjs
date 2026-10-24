#!/usr/bin/env node
// leashcheck.mjs — QUEUE 0.2 (Tame.OWED "leashing"): the lead item, MobEntity's own attach/
// detach, PathAwareEntity.updateLeash's distance physics, LeashKnotEntity's fence-attach/
// detach/break-drop.
//
//   node tools/leashcheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. Every number here is transcribed out of `.decomp` in 07n_tame.js's own
// header (MobEntity/PathAwareEntity/LeadItem/LeashKnotEntity, Yarn-named, `names.tsv` rows
// cited there) — so the interesting question is never "is 10/6/0.4/7/100 right", it is whether
// `Tm.updateLeash`/`Tm.attachHeldMobsToBlock`/`Tm.interactKnot`/`Tm.tickLeash` actually LAND on
// those numbers, in BOTH directions (rule 6): break past 10, no break at or under it; pull
// between 6 and 10, no pull at or under 6; a knot inside the 7-block BOX (not sphere) reattaches,
// one outside does not; a knot on a block that stops being a fence is dropped within its own
// 100-tick poll, not before and not never.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) pass++; else fails.push('anti-vacuity: ' + m); return c; };
const VERBOSE = process.argv.includes('--verbose');
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('leashcheck — QUEUE 0.2, leashing (lead, MobEntity/PathAwareEntity/LeadItem/LeashKnotEntity)');

const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07h_entities.js',
               '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
               '07m_breed.js', '07n_tame.js', '14j_combat.js', '14l_use.js', '07u_leash.js', '07ze_llama.js'];
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');

const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

// ── a flat-array world, `usecheck.mjs`'s own adapter, wide enough for a fence + a mob pen ──
const N = 32, MID = 16;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
const B = MCL.Behave;
const W = {
  getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
  setBlock(x, y, z, id) { if (!inside(x, y, z)) return false; cells[idx(x, y, z)] = id; if (B.ready) B.changed(x, y, z); return true; },
  poke(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; },
  blockLightAt: () => 15,
  clear() { cells.fill(0); },
};
MCL.World = W;
B.init(W);
MCL.BlockEntities.init();
B.clearSchedule();
MCL.Entities.init();
MCL.EntityList.init();
MCL.Ai.init();
MCL.Breed.init();
MCL.Tame.init();
MCL.Use.init(W);

const Tm = MCL.Tame, EL = MCL.EntityList, S = MCL.States, IT = MCL.Items;
ok(Tm.ready, 'Tame module reports ready');
ok(Tm._fencesCol >= 0, 'Tm.init resolved the `fences` block tag (Tags.blockTag(\'fences\') >= 0)');
if (!Tm.ready || Tm._fencesCol < 0) { console.log('\nFAIL — cannot continue'); process.exit(1); }

const leadStack = () => { const i = IT.of('lead'); return i < 0 ? null : { i, n: 1, d: 0 }; };
ok(leadStack() !== null, 'the `lead` item exists in the packed item table (assets/item-registry.json: id 977)');

// a fake single live player — `Tm.updateLeash`'s own `NS.Player` holder
MCL.Player = { x: 0, y: 0, z: 0, EYE: 1.62 };

function mkCow(x, y, z) {
  const e = EL.spawn('cow', x, y, z);
  ok(!!e, 'a cow spawns (EntityList.canSpawn has a motion row for it)');
  return e;
}

// ── §1. Tm.MONSTER / canLeash — the roster split, both directions ─────────────────────────
say('\n§1 — canLeash: leashable roster vs Monster');
{
  const cow = mkCow(0, 0, 0);
  ok(Tm.canLeash(cow) === true, 'an untamed, unleashed cow CAN be leashed');
  const zombie = EL.spawn('zombie', 1, 0, 0);
  ok(!!zombie, 'a zombie spawns');
  ok(Tm.canLeash(zombie) === false, 'a zombie (HostileEntity implements Monster) CANNOT be leashed');
  const wolf = EL.spawn('wolf', 2, 0, 0);
  ok(Tm.canLeash(wolf) === true, 'a wolf (PathAwareEntity, not Monster) CAN be leashed');
  wolf.angerTime = 100;
  ok(Tm.canLeash(wolf) === false, 'an angry wolf CANNOT be leashed (WolfEntity.canBeLeashedBy: !hasAngerTime())');
  okAv((() => { wolf.angerTime = 0; return Tm.canLeash(wolf) === true; })(), 'with the anger cleared the wolf leashes again — the refusal rests on angerTime');
  ok(Tm.canLeash(EL.spawn('panda', 3, 0, 0)) === false, 'a panda CANNOT be leashed (PandaEntity.canBeLeashedBy false)');
  for (const t of ['cod', 'salmon', 'tropical_fish', 'pufferfish', 'turtle']) { const f = EL.spawn(t, 3, 0, 0); ok(!!f && Tm.canLeash(f) === false, t + ' CANNOT be leashed (WaterCreatureEntity/Turtle canBeLeashedBy false)'); }
  // .decomp: HostileEntity/Slime/Ghast/Phantom/Shulker/EnderDragon implement Monster; Ambient/Merchant refuse; Zoglin/Hoglin override back
  for (const t of ['creeper', 'enderman', 'blaze', 'witch', 'ghast', 'slime', 'magma_cube', 'vex', 'vindicator', 'pillager', 'ravager', 'evoker', 'guardian', 'phantom', 'piglin', 'piglin_brute', 'silverfish', 'wither', 'husk', 'drowned', 'stray', 'zombified_piglin', 'zombie_villager', 'bat', 'villager', 'wandering_trader']) { const f = { type: t }; ok(Tm.canLeash(f) === false, t + ' CANNOT be leashed (Monster / AmbientEntity / MerchantEntity)'); }
  for (const t of ['zoglin', 'hoglin']) { const f = { type: t }; ok(Tm.canLeash(f) === true, t + ' CAN be leashed (canBeLeashedBy overridden to !isLeashed())'); }
  { const sq = EL.spawn('squid', 3, 0, 0); ok(!!sq && Tm.canLeash(sq) === true, 'a squid CAN be leashed (SquidEntity.canBeLeashedBy = !isLeashed())'); }
  okAv((() => { const real = Tm.NO_LEASH; Tm.NO_LEASH = {}; const r = Tm.canLeash(EL.spawn('cod', 3, 0, 0)); Tm.NO_LEASH = real; return r === true; })(),
       'with NO_LEASH emptied a cod leashes again');
  okAv((() => { const real = Tm.NO_LEASH; Tm.NO_LEASH = {}; const r = Tm.canLeash(EL.spawn('panda', 3, 0, 0)); Tm.NO_LEASH = real; return r === true; })(),
       'with the panda override table emptied a panda leashes again — the refusal rests on NO_LEASH');
  okAv((() => { const real = Tm.isMonster; Tm.isMonster = () => false; const r = Tm.canLeash(EL.spawn('zombie', 3, 0, 0)); Tm.isMonster = real; return r === true; })(),
       'with Tm.MONSTER emptied, a zombie CAN be leashed — proves the Monster gate above is load-bearing, not a vacuous refusal');
}

// ── §2. attach / the FIRST-branch detach, and the item is spent exactly once ──────────────
say('\n§2 — leashToPlayer / holderIsPlayer / unleash (MobEntity.interact\'s own two branches)');
{
  const cow = mkCow(5, 0, 5);
  ok(Tm.leashToPlayer(cow) === true, 'leashToPlayer attaches');
  ok(Tm.isLeashed(cow) === true && Tm.holderIsPlayer(cow) === true, 'the cow now reports leashed, held by the player');
  ok(Tm.leashToPlayer(cow) === false, 'attaching AGAIN refuses (canBeLeashedBy: !isLeashed())');
  const before = IT.of('lead');
  const dropCountBefore = EL.list.filter((e) => e.type === 'item' && e.itemIdx === before).length;
  ok(Tm.unleash(cow, true) === true, 'unleash(e, true) detaches');
  ok(Tm.isLeashed(cow) === false, '...and the cow reports unleashed');
  const dropped = EL.list.some((e) => !e.removed && e.type === 'item');
  ok(dropped, 'a lead item entity was dropped at the cow\'s own position (dropItem=true)');
  okAv((() => { const c2 = mkCow(6, 0, 5); Tm.leashToPlayer(c2); const n0 = EL.list.filter((e) => e.type === 'item' && !e.removed).length; Tm.unleash(c2, false); const n1 = EL.list.filter((e) => e.type === 'item' && !e.removed).length; return n1 === n0; })(),
       'unleash(e, false) drops NOTHING — proves the drop above is the `dropItem` argument\'s own effect, not always-on');
}

// ── §3. the use-hook end to end: 14l_use.js's Use.entityUse, holder-first then lead-attach ──
say('\n§3 — Use.entityUse: the FIRST-branch unleash runs before anything item-specific');
{
  const cow = mkCow(-5, 0, 0);
  Tm.leashToPlayer(cow);
  const stack = { i: IT.of('stick'), n: 1 };   // ANY item, not a lead — MobEntity.interact's
                                                 // own first branch does not look at the hand
  ok(MCL.Use.entityUse({ instabuild: false }, cow, stack) === true, 'a right-click with an unrelated item still unleashes a mob the player holds');
  ok(Tm.isLeashed(cow) === false, '...and it is unleashed');

  const cow2 = mkCow(-6, 0, 0);
  const P = { instabuild: false };
  ok(MCL.Use.entityUse(P, cow2, leadStack()) === true, 'a lead in hand on a leashable mob attaches (Use.entityUse)');
  ok(Tm.holderIsPlayer(cow2) === true, '...to the player');
  const zombie = EL.spawn('zombie', -7, 0, 0);
  ok(MCL.Use.entityUse(P, zombie, leadStack()) === false, 'the SAME lead on a zombie refuses (Monster)');
  okAv((() => { const real = Tm.canLeash; Tm.canLeash = () => true; const r = MCL.Use.entityUse(P, zombie, leadStack()); Tm.canLeash = real; Tm.unleash(zombie, false); return r === true; })(),
       'with Tm.canLeash stubbed to always allow, the SAME zombie DOES attach — proves the refusal above rests on canLeash, not a hidden Monster check inside Use.entityUse');
}

// ── §4. PathAwareEntity.updateLeash — break / pull / approach, both directions each ───────
say('\n§4 — Tm.updateLeash distance physics (10 / 6 / 2 — transcribed off .decomp)');
{
  MCL.Player.x = 0; MCL.Player.y = 0; MCL.Player.z = 0;
  // exactly at the break threshold does NOT break (`> 10`, not `>=`)
  const c1 = mkCow(10, 0, 0); Tm.leashToPlayer(c1);
  Tm.updateLeash(c1);
  ok(Tm.isLeashed(c1) === true, 'a cow exactly 10 blocks from its holder is NOT broken (dist > 10, not >=)');
  const c2 = mkCow(10.5, 0, 0); Tm.leashToPlayer(c2);
  Tm.updateLeash(c2);
  ok(Tm.isLeashed(c2) === false, '...but 10.5 blocks away breaks and drops');
  okAv((() => { const real = Tm.LEASH_BREAK_DIST; Tm.LEASH_BREAK_DIST = 100; const c = mkCow(10.5, 0, 1); Tm.leashToPlayer(c); Tm.updateLeash(c); const stillLeashed = Tm.isLeashed(c); Tm.LEASH_BREAK_DIST = real; return stillLeashed === true; })(),
       'with the break distance raised to 100, the SAME 10.5-block cow does NOT break — proves the 10.5 break above is the threshold, not some other refusal');

  // 6 < dist <= 10: a velocity PULL, not a break — and none at all at/under 6
  const c3 = mkCow(8, 0, 0); c3.vx = c3.vy = c3.vz = 0; Tm.leashToPlayer(c3);
  Tm.updateLeash(c3);
  ok(Tm.isLeashed(c3) === true, 'a cow 8 blocks away is still leashed (6 < 8 <= 10)');
  ok(c3.vx < 0 && Math.abs(c3.vx) > 1e-6, `...and was pulled toward the holder (vx=${c3.vx.toFixed(4)}, holder is at x=0, cow at x=8)`);
  const c4 = mkCow(6, 0, 0); c4.vx = c4.vy = c4.vz = 0; Tm.leashToPlayer(c4);
  Tm.updateLeash(c4);
  // exactly 6 IS in the approach branch (dist > 6 is false at 6), which also nudges toward the
  // holder -- so this is not "no velocity", it is "not the PULL formula's own magnitude"
  // (copySign(1*1*0.4, ...) = 0.4) but the approach step's smaller one (min(short, speed)).
  ok(Math.abs(c4.vx) > 1e-9 && Math.abs(c4.vx) < 0.4 - 1e-6,
     `a cow exactly 6 blocks away gets the APPROACH nudge, not the pull formula's 0.4 magnitude (dist > 6, not >=) (vx=${c4.vx.toFixed(4)})`);
  okAv((() => { const c = mkCow(8, 0, 1); c.vx = 0; Tm.leashToPlayer(c); const real = Tm.LEASH_PULL_ACCEL; Tm.LEASH_PULL_ACCEL = 0; Tm.updateLeash(c); Tm.LEASH_PULL_ACCEL = real; const noPull = Math.abs(c.vx) < 1e-9; Tm.unleash(c, false); return noPull; })(),
       'with the pull accel zeroed, the SAME 8-block cow gets NO velocity — proves the vx above IS `Tm.LEASH_PULL_ACCEL`\'s own effect, not noise from something else');
  // the exact copySign(dx*dx*Tm.LEASH_PULL_ACCEL, dx) formula, numerically
  const c5 = mkCow(8, 0, 0); c5.vx = c5.vy = c5.vz = 0; Tm.leashToPlayer(c5);
  Tm.updateLeash(c5);
  const ux = -8 / 8; // (holderX - mobX)/dist = (0-8)/8 = -1 exactly on this axis (dy=dz=0)
  const expected = Math.sign(ux) * ux * ux * Tm.LEASH_PULL_ACCEL;
  ok(Math.abs(c5.vx - expected) < 1e-9, `the pull's own magnitude matches copySign(dx^2*0.4, dx) exactly (got ${c5.vx}, expected ${expected})`);

  // LlamaEntity.getRunFromLeashSpeed() = 2.0: llama / trader_llama approach at twice the cow's rate
  for (const [t, base] of [['llama', 'llama'], ['trader_llama', 'trader_llama']]) {
    const l = EL.spawn(t, 5, 0, 0); l.vx = l.vz = 0; Tm.leashToPlayer(l); Tm.updateLeash(l);
    const sp = MCL.Entities.attrsOf(l.type).speed;
    ok(Math.abs(Math.abs(l.vx) - Math.min(3, sp * 2)) < 1e-9, base + ' approach nudge is min(short, 2.0 * attr speed) (got ' + l.vx + ')');
    okAv((() => { const real = Tm.RUN_FROM_LEASH; Tm.RUN_FROM_LEASH = {}; const m = EL.spawn(t, 5, 0, 0); m.vx = 0; Tm.leashToPlayer(m); Tm.updateLeash(m); Tm.RUN_FROM_LEASH = real; return Math.abs(Math.abs(m.vx) - sp * 2) > 1e-9; })(), 'with RUN_FROM_LEASH emptied the ' + t + ' nudge is 1.0x again');
  }

  // dist <= 2: no approach nudge at all (Math.max(dist-2, 0) === 0)
  const c6 = mkCow(2, 0, 0); c6.vx = c6.vy = c6.vz = 0; Tm.leashToPlayer(c6);
  Tm.updateLeash(c6);
  ok(Math.abs(c6.vx) < 1e-9 && Math.abs(c6.vz) < 1e-9, 'a cow exactly 2 blocks from its holder gets no approach nudge either (short = max(dist-2,0) = 0)');
  // 2 < dist <= 6: an approach nudge, toward the holder
  const c7 = mkCow(4, 0, 0); c7.vx = c7.vy = c7.vz = 0; Tm.leashToPlayer(c7);
  Tm.updateLeash(c7);
  ok(c7.vx < 0 && Math.abs(c7.vx) > 1e-6, `a cow 4 blocks away (2 < 4 <= 6) gets an approach nudge toward the holder (vx=${c7.vx.toFixed(4)})`);
  okAv((() => { const c = mkCow(4, 0, 1); c.vx = 0; Tm.leashToPlayer(c); const real = Tm.LEASH_APPROACH_STOP; Tm.LEASH_APPROACH_STOP = 100; Tm.updateLeash(c); Tm.LEASH_APPROACH_STOP = real; const noNudge = Math.abs(c.vx) < 1e-9; Tm.unleash(c, false); return noNudge; })(),
       'with the approach-stop distance raised past the cow\'s own distance, the SAME 4-block cow gets NO nudge — proves the vx above rests on `short = dist - LEASH_APPROACH_STOP`, not always-on movement');

  // holder death / removal drops with WITH a drop, same as the break path
  const c8 = mkCow(1, 0, 0); Tm.leashToPlayer(c8);
  const savedPlayer = MCL.Player; MCL.Player = null;
  Tm.updateLeash(c8);
  MCL.Player = savedPlayer;
  ok(Tm.isLeashed(c8) === false, 'a dead/missing holder (NS.Player === null) detaches the mob too (MobEntity.updateLeash\'s own super() check)');

  // a SITTING tamed mob only gets the break check, no pull/approach at all
  const w = EL.spawn('wolf', 8, 0, 2); w.sitting = true; w.vx = 0; Tm.leashToPlayer(w);
  MCL.Player.x = 0; MCL.Player.y = 0; MCL.Player.z = 2;
  Tm.updateLeash(w);
  ok(Tm.isLeashed(w) === true && Math.abs(w.vx) < 1e-9, 'a SITTING leashed wolf 8 blocks away is neither broken nor pulled (isInSittingPose()\'s own early return)');
  const w2 = EL.spawn('wolf', 11, 0, 2); w2.sitting = true; Tm.leashToPlayer(w2);
  Tm.updateLeash(w2);
  ok(Tm.isLeashed(w2) === false, '...but a sitting wolf past 10 blocks STILL breaks (the one check sitting does not skip)');
}

// ── §5. LeadItem.attachHeldMobsToBlock — the 7-block BOX, not a sphere, both directions ───
say('\n§5 — Tm.attachHeldMobsToBlock (the fence-attach, 7-block box)');
{
  const cIn = mkCow(7, 0, 0); Tm.leashToPlayer(cIn);         // |7-0|=7, on the box's own edge
  const cOut = mkCow(7.5, 0, 0); Tm.leashToPlayer(cOut);      // just outside on one axis
  const cCorner = mkCow(6, 0, 6); Tm.leashToPlayer(cCorner);  // inside a BOX (would be outside a sphere: sqrt(72)=8.49 > 7)
  ok(Tm.attachHeldMobsToBlock(0, 0, 0) === true, 'attachHeldMobsToBlock at the origin returns true (something moved)');
  ok(cIn.leashHolder && cIn.leashHolder.kind === 'knot', 'the cow exactly at the 7-block edge is reattached to the new knot');
  ok(cOut.leashHolder && cOut.leashHolder.kind === 'player', 'the cow just past the box edge is left on the player (not the box\'s own radius)');
  ok(cCorner.leashHolder && cCorner.leashHolder.kind === 'knot',
     'a cow at (6,0,6) — inside the BOX but OUTSIDE a 7-block SPHERE (dist=8.49) — is still reassigned, proving this is Box math, not distance math');
  const knot = cIn.leashHolder.knot;
  ok(Tm.knots.indexOf(knot) >= 0 && !knot.removed, 'the knot is tracked in Tm.knots');
  ok(cIn.leashHolder.knot === cCorner.leashHolder.knot, 'both reassigned cows share the SAME knot (one knot per block, not one each)');
  okAv((() => { const before = Tm.knots.length; const c = mkCow(20, 0, 20); Tm.leashToPlayer(c); const r = Tm.attachHeldMobsToBlock(0, 0, 0); Tm.unleash(c, false); return r === false && Tm.knots.length === before; })(),
       'attachHeldMobsToBlock with NOTHING in range returns false and creates no knot — proves the true/knot above came from something being in range, not an unconditional create');
}

// ── §6. LeashKnotEntity.interact — reassign, or discard-and-cascade ────────────────────────
say('\n§6 — Tm.interactKnot (right-click ON the knot)');
{
  const knot = Tm.getOrCreateKnot(20, 0, 20);
  const c = mkCow(21, 0, 20); Tm.leashToPlayer(c);
  ok(Tm.interactKnot(knot, false) === true, 'interactKnot with a player-held mob in range reassigns it and returns true');
  ok(c.leashHolder && c.leashHolder.knot === knot, '...the cow is now leashed to THIS knot');
  ok(!knot.removed, 'the knot survives a successful reassignment');

  ok(Tm.interactKnot(knot, false) === true, 'interacting again (nothing left leashed to the PLAYER) still returns true (ActionResult.CONSUME)');
  ok(knot.removed === true, '...but this time the knot IS discarded (nothing was reassigned)');
  ok(Tm.isLeashed(c) === true, 'outside creative, the cow leashed to the now-removed knot is NOT detached immediately');
  Tm.updateLeash(c);
  ok(Tm.isLeashed(c) === false, '...it detaches (and drops) on its own very next Tm.updateLeash, seeing its holder dead');

  const knot2 = Tm.getOrCreateKnot(25, 0, 25);
  const c2 = EL.spawn('cow', 26, 0, 25);
  c2.leashHolder = { kind: 'knot', knot: knot2 };
  ok(Tm.interactKnot(knot2, true) === true, 'creative interactKnot with nothing player-held reassigned');
  ok(knot2.removed === true, '...also discards the empty knot');
  ok(Tm.isLeashed(c2) === false, 'CREATIVE detaches the mob still on it RIGHT AWAY, not next tick');
}

// ── §7. LeashKnotEntity.canStayAttached — the 100-tick poll, both directions ──────────────
say('\n§7 — Tm.tickLeash: the fence-tag poll (100 ticks, not sooner, not never)');
{
  W.clear();
  const fence = MCL.States.stateOf('oak_fence');
  ok(fence > 0, 'oak_fence resolves to a real block state');
  W.poke(0, -1, 0, fence);
  const knot = Tm.getOrCreateKnot(0, -1, 0);
  const c = mkCow(1, -1, 0); c.leashHolder = { kind: 'knot', knot };
  for (let i = 0; i < 100; i++) Tm.tickLeash();
  ok(!knot.removed, 'after 100 ticks the knot on a REAL fence has not even been checked yet (obstructionCheckCounter++ == 100 polls on the 101st)');
  Tm.tickLeash();
  ok(!knot.removed, '...and on the 101st tick, still standing on a fence, it is CHECKED and SURVIVES');

  W.poke(0, -1, 0, 0);   // the fence is broken out from under it
  for (let i = 0; i < 100; i++) Tm.tickLeash();
  ok(!knot.removed, 'even with the fence now gone, the knot is untouched until its OWN counter reaches 100 again, 101 ticks per cycle (not an instant block-break hook)');
  Tm.tickLeash();
  ok(knot.removed === true, '...and on that 101st tick it IS discarded, now that the block under it is not a fence');
  ok(Tm.isLeashed(c) === true, 'the mob is not detached in this SAME tickLeash pass (it ran before the knot list in this call)');
  Tm.tickLeash();
  ok(Tm.isLeashed(c) === false, '...but IS detached (and drops) on the very next pass, seeing its dead holder — "breaking the fence drops a lead"');

  okAv((() => {
    W.poke(5, -1, 5, fence);
    const k = Tm.getOrCreateKnot(5, -1, 5);
    W.poke(5, -1, 5, 0);
    const real = Tm.KNOT_CHECK_INTERVAL; Tm.KNOT_CHECK_INTERVAL = 1000000;
    Tm.tickLeash();
    Tm.KNOT_CHECK_INTERVAL = real;
    return !k.removed;
  })(), 'with the check interval raised far past one tick, a knot on NO fence at all survives one tickLeash — proves the removal above is the 100-tick poll landing, not some other always-on check');
}

// ── §8. Tm.pickKnot — the ray test knots need since they carry no EntityList row ──────────
say('\n§8 — Tm.pickKnot (right-click targeting, since a knot is not in EntityList)');
{
  Tm.knots.length = 0;
  const k = Tm.getOrCreateKnot(0, 0, 0);
  const hit = Tm.pickKnot(-5, 0.375, 0.5, 1, 0, 0, 10);
  ok(hit !== null && hit.knot === k, 'a ray straight at the knot from 5 blocks away hits it');
  const miss = Tm.pickKnot(-5, 6, 0.5, 1, 0, 0, 10);
  ok(miss === null, '...but the same ray 5.6 blocks higher (well clear of the knot\'s own 0.5-tall box) misses');
  const tooFar = Tm.pickKnot(-50, 0.375, 0.5, 1, 0, 0, 10);
  ok(tooFar === null, 'a ray that WOULD hit, but past `reach`, also misses');
}

// ── the rope's geometry (07u_leash.js — MobEntityRenderer.renderLeash, 24 segments) ──────────
{
  const Ls = MCL.Leash;
  ok(!!Ls && Ls.SEGMENTS === 24, 'rope: 24 segments (renderLeash: i < 24), got ' + (Ls && Ls.SEGMENTS));
  const pts = Ls.ropePoints(4, 2, -3);
  ok(pts.length === 25, 'rope: 25 points (i <= 24), got ' + pts.length);
  ok(pts[0].every((v) => v === 0) && pts[24][0] === 4 && pts[24][1] === 2 && pts[24][2] === -3, 'rope: runs exactly from the mob anchor to the holder');
  ok(Math.abs(pts[12][1] - 2 * 0.25) < 1e-9, 'rope: dy>0 sags as dy*t*t (mid point 0.5), got ' + pts[12][1]);
  ok(Math.abs(Ls.sagY(-2, 0.5) - (-2 + 2 * 0.25)) < 1e-9, 'rope: dy<0 sags as dy - dy*(1-t)^2, got ' + Ls.sagY(-2, 0.5));
  okAv(Math.abs(pts[12][1] - 1) > 1e-6, 'a straight (unsagged) rope would put the mid point at dy/2 = 1');
}

// ── §9. D-508's OWED, CLOSED (session 93): the knot LEFT this file, and WebGPU arrived ───────────
say('\n\u00a79 — the knot no longer draws here (it joined 07j_entityrender.js\'s shared mob buffer), and the WebGPU rope pass exists');
{
  const Ls = MCL.Leash;
  // ⚠ EL.list is shared across this WHOLE file — earlier sections' cows are still in it, some
  // still leashed. Isolate: nothing this section did not leash itself may put rope vertices
  // in `Ls.buildVertices`'s output.
  for (const e of EL.list) e.leashHolder = null;
  Tm.knots.length = 0;
  const k = Tm.getOrCreateKnot(3, 64, 3);
  ok(!!k && Tm.knots.indexOf(k) >= 0, 'a knot exists, with nothing leashed to it');
  const verts = Ls.buildVertices(0, 64, 0);
  ok(verts.length === 0,
     `Ls.buildVertices drew ${verts.length / 6} vertices for a knot with no rope — expected 0: the wire-cube knot D-508 used to draw here is gone (it is ER.leashKnotVisible's job now, 07j_entityrender.js)`);

  // anti-vacuity, BOTH directions: the SAME knot, once a mob is actually leashed to it, DOES
  // put rope vertices in this buffer — so the zero above is "no rope drawn", not "buildVertices
  // is broken and returns nothing for anyone".
  const cow = mkCow(3.5, 0, 3);
  Tm.leashToHolder(cow, { kind: 'knot', knot: k });
  const verts2 = Ls.buildVertices(0, 64, 0);
  okAv(verts2.length === Ls.SEGMENTS * 6 * 6,
       `anti-vacuity: the SAME knot, WITH a mob leashed to it, draws exactly SEGMENTS*6 ribbon vertices (${Ls.SEGMENTS * 6}) — got ${verts2.length / 6}, proving buildVertices still draws real rope geometry, it only stopped drawing the knot`);
  {
    // ribbon, not a line: a triangle's vertices span > 0 width perpendicular to the rope
    let wmax = 0;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      const a = verts2.slice(i * 6, i * 6 + 3), b = verts2.slice(j * 6, j * 6 + 3);
      wmax = Math.max(wmax, Math.hypot(a[0] - b[0], a[2] - b[2]));
    }
    okAv(Ls.lightFactor(MCL.World, 0, 64, 0) <= 1 && Ls.lightFactor({ getLight: () => 0 }, 0, 0, 0) < 0.1 && Ls.lightFactor({ getLight: () => 0xff }, 0, 0, 0) === 1,
         'rope light factor: darkness dims the rope, full light does not');
    ok(wmax > 0.04, `rope is a ribbon with width (0.025 half width): got ${wmax}`);
  }
  Tm.unleash(cow, false);

  ok(typeof Ls.renderGPU === 'function', 'Ls.renderGPU exists (D-508\'s WebGPU rope pass, closed session 93)');
  // `Ls.render` dispatches to it for the webgpu backend, and does NOT touch WebGL2 state when
  // it does — proven with a fake `G`/`backend` rather than a real GPUDevice, since this harness
  // has no GPU. `ensureProgram` (the WebGL2 path) must never run for a webgpu G.
  let glTouched = false, gpuCalled = false;
  const realRenderGPU = Ls.renderGPU;
  Ls.renderGPU = function () { gpuCalled = true; };
  const fakeCam = { x: 0, y: 64, z: 0, viewProj: new Float32Array(16) };
  Ls.render({ name: 'webgpu', backend: { device: {}, pass: {}, get gl() { glTouched = true; return null; } } }, fakeCam);
  ok(gpuCalled === true, 'Ls.render(G) with G.name === \'webgpu\' calls Ls.renderGPU');
  ok(glTouched === false, '...and never reads `G.backend.gl` on the way — the webgl2 program path is not touched for a webgpu backend');
  okAv((() => { let called = false; Ls.renderGPU = function () { called = true; }; Ls.render({ name: 'webgl2', backend: { gl: null } }, fakeCam); return called === false; })(),
       'anti-vacuity: the SAME dispatcher, given G.name === \'webgl2\' instead, does NOT call renderGPU — the branch is a real backend check, not "always call both"');
  Ls.renderGPU = realRenderGPU;
}

// ── §ocelot. OcelotEntity.getLeashOffset = (0, 0.5*eyeHeight, width*0.4) rotated by body yaw ──
say('\n§ocelot — leash anchor');
{
  const oc = EL.spawn('ocelot', 3, 0, 3);
  ok(!!oc, 'an ocelot spawns');
  oc.yaw = oc.yBodyRot = 0.7;
  const eye = MCL.Combat.eyeHeightOf(oc), vy = oc.yaw + Math.PI + Math.PI / 2, zz = oc.width * 0.4;
  const a = MCL.Leash.mobAnchor(oc);
  ok(Math.abs(a[1] - (oc.y + 0.5 * eye)) < 1e-5, 'ocelot anchor y = 0.5*eyeHeight');
  ok(Math.abs(a[0] - (oc.x + Math.cos(vy) * zz)) < 1e-5 && Math.abs(a[2] - (oc.z + Math.sin(vy) * zz)) < 1e-5, 'ocelot anchor is width*0.4 forward, rotated by body yaw');
  okAv(Math.abs(a[0] - oc.x) > 1e-3 && Math.abs(a[1] - (oc.y + oc.height * 0.5)) > 1e-3, 'anti-vacuity: the old [x, y+height/2, z] anchor differs');
}

// ── §strider. StriderEntity.getLeashOffset = (0, 0.6*eyeHeight, width*0.4) rotated by body yaw ──
say('\n§strider — leash anchor');
{
  const st = EL.spawn('strider', 3, 0, 3);
  ok(!!st, 'a strider spawns');
  st.yaw = st.yBodyRot = 0.7;
  const eye = MCL.Combat.eyeHeightOf(st), vy = st.yaw + Math.PI + Math.PI / 2, zz = st.width * 0.4;
  const a = MCL.Leash.mobAnchor(st);
  ok(Math.abs(a[1] - (st.y + 0.6 * eye)) < 1e-5, 'strider anchor y = 0.6*eyeHeight');
  ok(Math.abs(a[0] - (st.x + Math.cos(vy) * zz)) < 1e-5 && Math.abs(a[2] - (st.z + Math.sin(vy) * zz)) < 1e-5, 'strider anchor is width*0.4 forward, rotated by body yaw');
  okAv(Math.abs(a[0] - st.x) > 1e-3 && Math.abs(a[1] - (st.y + st.height * 0.5)) > 1e-3, 'anti-vacuity: the old [x, y+height/2, z] anchor differs');
}

// ── §overrides. every vanilla getLeashOffset override (.decomp) vs Ls.mobAnchor ──
say('\n§overrides — leash anchor per mob');
{
  const fs = await import('node:fs'), dir = '.decomp/net/minecraft/entity/passive/';
  let n = 0, bad = 0;
  for (const f of fs.readdirSync(dir)) {
    const m = /getLeashOffset\(\) \{\s*return new Vec3d\(0\.0, \(double\)\(([\d.]+)F \* this\.getStandingEyeHeight\(\)\), \(double\)\(this\.getWidth\(\) \* ([\d.]+)F\)\)/.exec(fs.readFileSync(dir + f, 'utf8'));
    if (!m) continue;
    const type = f.replace('Entity.java', '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    let e; try { e = EL.spawn(type, 3, 0, 3); } catch (_) { /* goal module not loaded in this harness */ }
    if (!e) continue;
    n++;
    e.yaw = e.yBodyRot = 0.7;
    const vy = e.yaw + Math.PI + Math.PI / 2, zz = e.width * +m[2], a = MCL.Leash.mobAnchor(e);
    const good = Math.abs(a[1] - (e.y + +m[1] * MCL.Combat.eyeHeightOf(e))) < 1e-5 && Math.abs(a[0] - (e.x + Math.cos(vy) * zz)) < 1e-5 && Math.abs(a[2] - (e.z + Math.sin(vy) * zz)) < 1e-5;
    if (!good) { bad++; say('  mismatch: ' + type); }
  }
  ok(n >= 5 && bad === 0, n + ' vanilla getLeashOffset overrides match Ls.mobAnchor');
}

// ── §llama. LlamaEntity.getLeashOffset = (0, 0.75*eyeHeight, width*0.5) ──────────────────
say('\n§llama — leash anchor');
{
  const ll = EL.spawn('llama', 3, 0, 3), cow = mkCow(3, 0, 6);
  ok(!!ll, 'a llama spawns');
  const lo = MCL.Llama.leashOffset(ll);
  ok(Math.abs(lo.y - 0.75 * MCL.Combat.eyeHeightOf(ll)) < 1e-5 && Math.abs(lo.z - ll.width * 0.5) < 1e-5, 'llama leashOffset = (0, 0.75*eyeHeight, width*0.5)');
  ok(Math.abs(MCL.Leash.mobAnchor(ll)[1] - (ll.y + lo.y)) < 1e-9, 'a leashed llama anchors the rope at y + 0.75*eyeHeight');
  ok(Math.abs(MCL.Leash.mobAnchor(cow)[1] - (cow.y + MCL.Combat.eyeHeightOf(cow))) < 1e-5, 'a cow uses Entity.getLeashOffset: y = eyeHeight');
  okAv((() => { const r = MCL.Llama.leashOffset; MCL.Llama.leashOffset = () => ({ y: ll.height * 0.5 }); const v = Math.abs(MCL.Leash.mobAnchor(ll)[1] - (ll.y + lo.y)) < 1e-9; MCL.Llama.leashOffset = r; return v === false; })(),
       'a wrong llama offset moves the anchor (the check rests on leashOffset)');
}

{
  // leash-knot sounds: onPlace on creation, onBreak when the 100-tick poll drops the knot
  const Tm = MCL.Tame, heard = [], real = MCL.Sound;
  MCL.Sound = { play: (id, o) => heard.push([id, o.volume, o.pitch]) };
  const run = () => { heard.length = 0; const k = Tm.getOrCreateKnot(3, 0, 3); const a = heard.slice(); Tm.getOrCreateKnot(3, 0, 3); return [k, a]; };
  const [k, a] = run();
  ok(a.length === 1 && a[0][0] === 'entity.leash_knot.place' && a[0][1] === 1 && a[0][2] === 1, 'new knot plays entity.leash_knot.place 1/1 once');
  ok(heard.length === 1, 'reusing an existing knot is silent');
  heard.length = 0;
  W.poke(3, 0, 3, 0);
  for (let t = 0; t < Tm.KNOT_CHECK_INTERVAL + 1; t++) Tm.tickLeash ? Tm.tickLeash() : 0;
  ok(heard.some((h) => h[0] === 'entity.leash_knot.break' && h[1] === 1 && h[2] === 1), 'knot dropped by the poll plays entity.leash_knot.break');
  okAv((() => { const r = Tm.knotSound; Tm.knotSound = () => {}; heard.length = 0; Tm.getOrCreateKnot(5, 0, 5); Tm.knotSound = r; return heard.length === 0; })(), 'removing the sound call silences placement');
  MCL.Sound = real;
}

console.log('\n' + (fails.length ? 'FAIL' : 'PASS') + '  leashcheck — ' + pass + ' assertions, ' +
  fails.length + ' failures' + (breaks ? ', ' + breaks + " breaks caught" : ''));
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
