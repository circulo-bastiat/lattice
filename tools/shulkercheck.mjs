#!/usr/bin/env node
// shulkercheck.mjs — D-773 cloud unit (confident-lamport-hlerdd): the shulker's AI identity
// (src/07zzk_shulker.js) — wall-attach/teleport stillness and the PeekGoal. NOT the attack goal,
// the bullet, the renderer, or the targeting goals — Shulker.OWED (07zzk_shulker.js) names all of
// those as the next slice.
//
//   node tools/shulkercheck.mjs [--verbose]
//
// Sections:
//   1. direction tables — OPPOSITE/ARCH/DX/DY/DZ self-consistency
//   2. canStay — a solid face support says yes, no support says no, and a non-air OWN cell
//      always says no (isInvalidPosition) regardless of support
//   3. findAttachSide — Direction.values() scan order (down first), and -1 when nothing works
//   4. tryTeleport — a controlled `rand` landing on a real pocket succeeds; the SAME rand with
//      no valid pocket in range, and a rand that walks off the bottom of the world, both fail
//   5. tryAttachOrTeleport — re-attaches IN PLACE when a new face works before ever teleporting
//   6. PeekGoal — canUse's target/chance/canStay gates, start/stop's shulkerPeek, the counter
//   7. end-to-end regression — Ai.ROSTER.shulker registered, EL.spawn + EL.tickMob: a SUPPORTED
//      shulker no longer free-falls (the exact bug confident-lamport-asj6ue's own findings file
//      left open: "it will fall like any other golem until a real AI stage exists")
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log("   ✓ " + m); };
const say = (s) => { if (VERBOSE) console.log(s); };


console.log('shulkercheck -- D-773 cloud unit, the shulker AI identity (wall-attach/teleport + peek)');
const EXTRA = ['07h_entities.js', '07_world.js', '07b_behaviour.js', '14b_physics.js',
               '07i_entitylist.js', '07k_goals.js', '07q_effects.js', '14j_combat.js', '07zzk_shulker.js', '14h_brigadier.js', '14f_inventory.js', '15g_commands.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.EntityList.init();
M.World.init(1);
M.Behave.init(M.World);
M.Ai.init();
M.Combat.init();
M.Shulker.init();

const EL = M.EntityList, Sh = M.Shulker, W = M.World, R = M.Reg;
const def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
// a big flat stone floor at y=4 (mirrors stridercheck's own scaffold) -- everything ABOVE it is
// plain air, which is exactly the shape `canStay`'s DOWN-face check and `tryTeleport`'s random
// pocket search both need.
for (let x = -48; x <= 48; x++) for (let z = -48; z <= 48; z++) W.setBlock(x, 4, z, def('stone'));

ok(Sh.ready === true, 'Sh.ready is true once World/States/Ai are all present');

// ============ 1. direction tables ===========================================================
{
  say('\n§1 direction tables');
  for (let d = 0; d < 6; d++) {
    ok(Sh.OPPOSITE[Sh.OPPOSITE[d]] === d, `OPPOSITE is an involution at index ${d}`);
    ok(Sh.DX[d] + Sh.DX[Sh.OPPOSITE[d]] === 0 && Sh.DY[d] + Sh.DY[Sh.OPPOSITE[d]] === 0 &&
       Sh.DZ[d] + Sh.DZ[Sh.OPPOSITE[d]] === 0, `the offset at ${d} and its opposite cancel out`);
  }
  // ARCH is a permutation of 0..5 (every faceSturdy dir slot hit exactly once)
  const seen = new Set(Sh.ARCH);
  okAv(seen.size === 6, 'ARCH maps the six SUP indices onto all six ARCH indices, no collisions');
  ok(Sh.DOWN === 0, 'Sh.DOWN is index 0 (Direction.values()[0], the data-tracker default face)');
}

// ============ 2. canStay =====================================================================
{
  say('\n§2 canStay -- a sturdy face below says yes, no support says no, a non-air own cell always says no');
  ok(Sh.canStay(0, 5, 0, Sh.DOWN) === true, 'stone directly below (y=4) supports a DOWN attach at (0,5,0)');
  okAv(Sh.canStay(0, 6, 0, Sh.DOWN) === false, 'nothing but air below (y=5) refuses a DOWN attach one cell higher');
  const NORTH = 2;
  okAv(Sh.canStay(0, 5, 0, NORTH) === false, 'the SAME cell refuses a NORTH attach -- there is no support in that direction');
  // isInvalidPosition: block the shulker's OWN cell and re-check the otherwise-good DOWN attach
  W.setBlock(0, 5, 0, def('stone'));
  okAv(Sh.canStay(0, 5, 0, Sh.DOWN) === false, 'a solid block occupying the shulker\'s OWN cell refuses to stay, even with real support below');
  W.setBlock(0, 5, 0, 0);
  ok(Sh.canStay(0, 5, 0, Sh.DOWN) === true, 'and it is fine again once that cell is cleared');
  // moving piston in the shulker's own cell: allowed for that shulker only
  W.setBlock(0, 5, 0, def('moving_piston'));
  okAv(Sh.canStay(0, 5, 0, Sh.DOWN, { x: 0.5, y: 5, z: 0.5 }) === true, 'a MOVING_PISTON in the shulker\'s own cell does not detach it');
  okAv(Sh.canStay(0, 5, 0, Sh.DOWN, { x: 3.5, y: 5, z: 0.5 }) === false, 'a MOVING_PISTON in a different cell is still invalid');
  W.setBlock(0, 5, 0, 0);
}

// ============ 2b. canStay vs isFaceFullSquare(collision shape) (#840) ========================
{
  say('\n§2b canStay table -- the COLLISION shape decides, not the support/sides shape');
  const S = M.States;
  const st = (name, props) => {
    let s0 = def(name);
    if (props) { const [k, v] = props.split('='); s0 = S.withProp(s0, R.PROP[k], R.PVAL[v]); }
    return s0;
  };
  const rows = [['oak_leaves', null, true], ['soul_sand', null, false], ['oak_slab', 'type=bottom', false],
    ['oak_slab', 'type=top', true], ['oak_fence', null, false], ['glass', null, true], ['stone', null, true]];
  for (let l = 1; l <= 8; l++) rows.push(['snow', 'layers=' + l, false]);
  for (const [n, p, want] of rows) {
    W.setBlock(0, 3, 0, def("stone")); W.setBlock(0, 4, 0, 0);
    ok(W.setBlock(0, 4, 0, st(n, p)) !== false, `${n} placed`); W.setBlock(0, 5, 0, 0);
    okAv(Sh.canStay(0, 5, 0, Sh.DOWN) === want, `${n}${p ? '[' + p + ']' : ''} below: canStay ${want}`);
  }
  W.setBlock(0, 4, 0, def('stone'));
}

// ============ 3. findAttachSide ==============================================================
{
  say('\n§3 findAttachSide -- Direction.values() order (down first), -1 when nothing works');
  ok(Sh.findAttachSide(5, 5, 5) === Sh.DOWN, 'a cell with only a floor below picks DOWN, the first direction tried');
  // no floor here, but a wall to the NORTH (index 2) and nothing on the other four candidates
  // findAttachSide tries BEFORE north (down=0, up=1) -- both must genuinely fail first.
  W.setBlock(20, 20, 20, 0);            // the shulker's own cell: air
  W.setBlock(20, 19, 20, 0);            // below: air (no down attach)
  W.setBlock(20, 21, 20, 0);            // above: air (no up attach)
  W.setBlock(20, 20, 19, def('stone')); // north neighbour: solid
  ok(Sh.findAttachSide(20, 20, 20) === 2, 'with no floor/ceiling but a wall to the north, it finds NORTH (index 2), not DOWN or UP');
  W.setBlock(20, 20, 19, 0);
  okAv(Sh.findAttachSide(20, 20, 20) === -1, 'and once that wall is gone too, nothing attaches -- findAttachSide returns -1');
}

// ============ 4. tryTeleport =================================================================
{
  say('\n§4 tryTeleport -- a controlled rand landing on a real pocket succeeds; failure paths are real too');
  // rand() == 0.2 -> nextBetween(-8,8) = -8 + floor(0.2*17) = -8+3 = -5 on EVERY axis, every try.
  const e = { x: 10.5, y: 10, z: 10.5, dead: false };
  const tpPlayed = []; const realPlay = M.Sound && M.Sound.play;
  M.Sound = Object.assign(M.Sound || {}, { play: (ev, o) => { tpPlayed.push([ev, o]); return true; } });
  const ok1 = Sh.tryTeleport(e, () => 0.2);
  M.Sound.play = realPlay;
  ok(tpPlayed.length === 1 && tpPlayed[0][0] === 'entity.shulker.teleport'
    && tpPlayed[0][1].x === 10.5 && tpPlayed[0][1].y === 10 && tpPlayed[0][1].z === 10.5,
    '#848 teleport sound is played at the ORIGIN (vanilla plays it before setPosition)');
  okAv(!(tpPlayed[0] && tpPlayed[0][1].x === e.x), '#848 a destination-position sound would be told apart from the origin');
  ok(ok1 === true, 'a rand landing on (bx-5, by-5, bz-5) = (5,5,5), which sits right on the floor, succeeds');
  ok(e.x === 5.5 && e.y === 5 && e.z === 5.5, 'and the entity is actually moved there, block-centred');
  ok(e.shulkerFace === Sh.DOWN, 'landing on the floor attaches DOWN');
  ok(e.shulkerPeek === 0 && e.target === null, 'peek and target are both reset by a real teleport');

  // the SAME rand, but starting somewhere the -5/-5/-5 offset lands in open sky (no pocket
  // anywhere in the fixed 5 tries, since a constant rand always retries the identical offset).
  const e2 = { x: 500.5, y: 40, z: 500.5, dead: false };
  const px2 = e2.x;
  okAv(Sh.tryTeleport(e2, () => 0.2) === false, 'the identical rand fails when that fixed offset never lands on a real pocket');
  ok(e2.x === px2, 'and a failed teleport leaves the entity exactly where it was');

  // rand() == 0 -> nextBetween(-8,8) = -8 on every axis -- walking off the bottom of the world
  // must be rejected before any block is even read.
  const e3 = { x: 10.5, y: Sh.WORLD_BOTTOM + 3, z: 10.5, dead: false };
  okAv(Sh.tryTeleport(e3, () => 0) === false, 'a candidate at or below the world floor (-64) is rejected outright');

  // world border (shrunk to 4 for the test): the (5,5,5) pocket is refused
  const eb = { x: 10.5, y: 10, z: 10.5, dead: false }, sb = Sh.BORDER;
  Sh.BORDER = 4;
  okAv(Sh.tryTeleport(eb, () => 0.2) === false, 'a teleport target outside the world border is refused');
  Sh.BORDER = sb;
  okAv(Sh.tryTeleport(eb, () => 0.2) === true, 'the same target succeeds inside the border');

  // a dead shulker never teleports at all (isAlive() gate).
  const e4 = { x: 85.5, y: 10, z: 85.5, dead: true };
  okAv(Sh.tryTeleport(e4, () => 0.2) === false, 'a dead shulker does not teleport, even onto a real pocket');
}

// ============ 5. tryAttachOrTeleport =========================================================
{
  say('\n§5 tryAttachOrTeleport -- re-attach in place beats teleporting away');
  const e = { x: 30.5, y: 20, z: 30.5, dead: false, shulkerFace: Sh.DOWN };
  W.setBlock(30, 19, 30, def('stone')); // a real DOWN support directly below, far from the floor
  let teleported = 0;
  const realTeleport = Sh.tryTeleport;
  Sh.tryTeleport = function () { teleported++; return realTeleport.apply(Sh, arguments); };
  Sh.tryAttachOrTeleport(e, () => 0.2);
  ok(e.shulkerFace === Sh.DOWN, 'a still-valid DOWN face at the CURRENT cell is picked without moving');
  okAv(teleported === 0, 'and tryTeleport is never even called when re-attaching in place works');
  W.setBlock(30, 19, 30, 0);
  Sh.tryAttachOrTeleport(e, () => 0.2);
  ok(teleported === 1, 'once no face works at the current cell, it falls through to tryTeleport');
  Sh.tryTeleport = realTeleport;
}

// ============ 6. PeekGoal =====================================================================
{
  say('\n§6 PeekGoal -- target/canStay gates, start/stop, the counter');
  const e = { x: 0.5, y: 5, z: 0.5, target: null, shulkerFace: Sh.DOWN };
  const roster = Sh.roster(e, { players: () => [], random: () => 0.5 });
  const peek = roster.entries.filter((en) => en.priority === 7)[0].goal;
  ok(peek.canUse() === false, 'rand()==0.5 is above the 1/40 peek chance, so canUse refuses most ticks');
  // build a second PeekGoal directly (not through the roster) with a rand that always clears the
  // 1/40 gate, to test start()/stop()/tick() in isolation from the chance roll above.
  const e2 = { x: 0.5, y: 5, z: 0.5, target: null, shulkerFace: Sh.DOWN };
  const roster2 = Sh.roster(e2, { players: () => [], random: () => 0.001 });
  const peek2 = roster2.entries.filter((en) => en.priority === 7)[0].goal;
  ok(peek2.canUse() === true, 'a rand well under 1/40, no target, and a real supporting face together allow it to start');
  peek2.start();
  ok(e2.shulkerPeek === 30, 'start() opens the lid to 30 (PEEK_AMOUNT), matching vanilla');
  ok(peek2.canContinueToUse() === true, 'right after start, the counter is still positive so it continues');
  peek2.stop();
  ok(e2.shulkerPeek === 0, 'stop() closes the lid again while there is still no target');

  // a target present blocks the goal outright, whatever the chance roll says.
  e2.target = { removed: false };
  okAv(peek2.canUse() === false, 'a live target blocks PeekGoal.canUse entirely, whatever the roll says');
  peek2.start(); e2.shulkerPeek = 30;
  peek2.stop();
  okAv(e2.shulkerPeek === 30, 'stop() while a target is set leaves the peek amount alone (only the no-target branch closes it)');
}

// ============ 7. end-to-end regression =======================================================
{
  say('\n§7 end-to-end -- Ai.ROSTER.shulker registered; a SUPPORTED shulker no longer free-falls');
  ok(typeof M.Ai.ROSTER.shulker === 'function', 'Ai.ROSTER.shulker is registered (07zzk_shulker.js\'s own init())');
  const s = EL.spawn('shulker', 6.5, 5, 6.5);
  ok(!!s && s.type === 'shulker', 'EL.spawn(\'shulker\', ...) still works (the D-773 asj6ue motion row)');
  const y0 = s.y;
  for (let i = 0; i < 40; i++) EL.tickMob(s);
  okAv(s.noGravity === true, 'forty ticks in, the shulker has flipped e.noGravity (the Ph.travelMob gate this unit added)');
  ok(Math.abs(s.y - y0) < 1e-6, `forty ticks on solid support and the shulker has NOT fallen (y ${y0} -> ${s.y})`);
  ok(s.vy === 0, 'and it never picked up a downward velocity to carry into the next tick either');
  ok(s.shulkerFace === Sh.DOWN, 'it settled on the DOWN face, the only one that was ever valid here');

  // pull the floor out from under a second one and prove it does NOT just fall through --
  // it either re-attaches to a real neighbour or stays put looking for one, but the constant
  // Math.random() path (no controllable rand reaches EL.tickMob) must never leave it mid-air
  // falling under gravity the way asj6ue's own findings file described the un-fixed bug.
  const s2 = EL.spawn('shulker', 9.5, 5, 9.5);
  for (let i = 0; i < 5; i++) EL.tickMob(s2);   // settle onto the DOWN face first
  W.setBlock(9, 4, 9, 0);                       // remove the only support it had
  const y1 = s2.y;
  for (let i = 0; i < 10; i++) EL.tickMob(s2);
  okAv(s2.vy === 0, 'even mid-relocation (support pulled out), e.noGravity keeps vy pinned at 0 -- no free-fall velocity ever accumulates');
  say(`   (support removed at y=${y1}; shulker now at y=${s2.y}, face=${s2.shulkerFace})`);
}

// ============ 8. #653 tryTeleport/canStay parity ==============================================
{
  say('\n§8 noAI, entity-in-cell, sound, canStay lid-space box');
  const played = [];
  M.Sound = M.Sound || {};
  const realPlay = M.Sound.play;
  M.Sound.play = (n) => played.push(n);
  const e = { x: 10.5, y: 10, z: 10.5, dead: false };
  okAv(Sh.tryTeleport(Object.assign({}, e, { noAI: true }), () => 0.2) === false, 'a noAI shulker never teleports');
  okAv(played.length === 0, 'and plays no sound');
  // an entity (another shulker) occupying the target cell (5,5,5) blocks it
  const other = EL.spawn('shulker', 5.5, 5, 5.5);
  okAv(Sh.tryTeleport(Object.assign({}, e), () => 0.2) === false, 'a living shulker in the target cell blocks the teleport');
  other.dead = true; EL.list.splice(EL.list.indexOf(other), 1);
  const e5 = Object.assign({}, e);
  ok(Sh.tryTeleport(e5, () => 0.2) === true, 'teleport succeeds once the cell is clear');
  okAv(played.length === 1 && played[0] === 'entity.shulker.teleport', 'success plays entity.shulker.teleport');
  M.Sound.play = realPlay;
  // canStay: a block in the lid space (one cell above the DOWN-attached shulker) refuses
  W.setBlock(30, 6, 30, def('stone'));
  okAv(Sh.canStay(30, 5, 30, Sh.DOWN) === false, 'a solid block in the lid space refuses to stay');
  W.setBlock(30, 6, 30, 0);
  ok(Sh.canStay(30, 5, 30, Sh.DOWN) === true, 'and it stays once the lid space is clear');
}

// ============ 9. covered armor + open/close sound/event (#652) ===============================
{
  const played = []; const oldSound = M.Sound;
  M.Sound = { play: (id) => played.push(id) };
  const e = { type: 'shulker', x: 0.5, y: 5, z: 0.5, shulkerPeek: 0 };
  okAv(Sh.armorOf(e) === 0, 'peek 0 written directly (fresh spawn) carries no armor modifier (#847)');
  Sh.setPeek(e, 30); Sh.setPeek(e, 0);
  okAv(Sh.armorOf(e) === 20, 'closed shulker has armor +20');
  Sh.setPeek(e, 30);
  okAv(Sh.armorOf(e) === 0, 'open shulker has no covered armor');
  okAv(played[0] === 'entity.shulker.open' && e.lastGameEvent === 'container_open', 'opening plays shulker.open + container_open');
  Sh.setPeek(e, 0);
  okAv(played[1] === 'entity.shulker.close' && e.lastGameEvent === 'container_close', 'closing plays shulker.close + container_close');
  okAv(Sh.armorOf({ type: 'shulker' }) === 0, 'fresh shulker (peek undefined) has armor 0 until first close (#847)');
  const t = { x: 10.5, y: 10, z: 10.5, dead: false, shulkerPeek: 0 };
  Sh.setPeek(t, 30); Sh.setPeek(t, 0); Sh.setPeek(t, 30);
  okAv(Sh.tryTeleport(t, () => 0.2) === true && Sh.armorOf(t) === 0, 'teleport from open leaves armor 0 (#847)');
  const t2 = { x: 10.5, y: 10, z: 10.5, dead: false };
  Sh.setPeek(t2, 0);
  okAv(Sh.tryTeleport(t2, () => 0.2) === true && Sh.armorOf(t2) === 20, 'teleport from closed keeps the modifier (#847)');
  M.Sound = oldSound;
}

// ============ 10. #850 shulker-bullet duplication ============================================
{
  const mk = (x, z) => { const s = EL.spawn('shulker', x, 5, z); Sh.setPeek(s, 30); return s; };
  const gone = (...a) => a.forEach((s) => { s.dead = true; const i = EL.list.indexOf(s); if (i >= 0) EL.list.splice(i, 1); });
  const count = () => EL.list.filter((s) => s.type === 'shulker' && !s.dead).length;
  const bul = { attacker: null, projectile: true, sourceEntity: { type: 'shulker_bullet' } };
  let a = mk(20.5, 20.5); a.shulkerColor = 5;
  const before = count();
  // dx=+3, dy=0, dz=0 (valid air cell over the floor), then the clone roll
  const seq = (roll) => { const q = [0.66, 0.5, 0.5, roll]; return () => (q.length ? q.shift() : 0.5); };
  M.EntityList.random = seq(0.2);
  const okHit = M.Combat.hurt(a, 1, undefined, false, bul);
  okAv(okHit && a.x === 23.5, 'bullet hit on an open shulker teleports it');
  okAv(count() === before + 1, 'and a clone spawns (n=1 -> probability 1)');
  const clone = EL.list.filter((s) => s.type === 'shulker' && s !== a && Math.abs(s.x - 20.5) < 0.01 && Math.abs(s.z - 20.5) < 0.01 && s.y === 5)[0];
  okAv(!!clone && clone.shulkerColor === 5, 'the clone sits at the OLD position with the same colour');
  // n=2 near -> 0.2 < 0.2 false... use roll 0.1 < 0.2 -> no clone
  const b = mk(21.5, 21.5);
  const c0 = count(); M.EntityList.random = seq(0.1);
  M.Combat.hurt(a, 1, undefined, false, bul);
  okAv(count() === c0, 'with 3+ shulkers nearby a low roll suppresses the clone');
  // no bullet source -> no duplication; closed -> no duplication
  const c1 = count(); M.EntityList.random = () => 0.2;
  M.Combat.hurt(a, 1, undefined, false, { attacker: null });
  okAv(count() === c1, 'a hit without the shulker_bullet source never duplicates');
  const cl = EL.spawn('shulker', 40.5, 5, 40.5);
  M.Combat.hurt(cl, 1, undefined, false, bul);
  okAv(count() === c1 + 1 && cl.x === 40.5, 'a closed shulker neither teleports nor duplicates');
  ok(!/evoker-fang duplication/.test(JSON.stringify(Sh.OWED)), 'Sh.OWED no longer claims the evoker-fang trigger');
  M.EntityList.random = undefined;
}

{ // #2718 LookAtEntityGoal(Player,8,0.02,true): chance gate, 3D range, 40-80 tick look
  const sh = { x: 0, y: 5, z: 0, eyeHeight: 0.5, look: { setLookAt() { this.n++; }, n: 0 } };
  const near = { x: 3, y: 5, z: 0 }, above = { x: 0, y: 55, z: 0 };
  const mkG = (ps, r) => new Sh.LookAtPlayerGoal(sh, () => ps, 8, r);
  let started = 0; const g = mkG([near], Math.random);
  for (let i = 0; i < 20000; i++) if (g.canUse()) started++;
  okAv(started > 200 && started < 600, 'canUse starts ~2% of ticks, not every tick (' + started + '/20000)');
  okAv(!mkG([above], () => 0).canUse(), 'a player 50 blocks above (horizontally in range) is out of 3D range');
  const seq2 = [0.0, 0.5]; const g2 = mkG([near], () => seq2.shift());
  ok(g2.canUse(), 'roll 0 starts'); g2.start();
  let n = 0; while (g2.canContinueToUse()) { g2.tick(); n++; }
  okAv(n === 60, 'look lasts 40+floor(0.5*40)=60 ticks (' + n + ')');
  { // #4551: lookForward Y = mob eye; mob target gets no range exemption / no canUse bypass
    const far = { x: 20, y: 5, z: 0 }; let ly;
    const s2 = { x: 0, y: 5, z: 0, eyeHeight: 0.5, target: far, look: { setLookAt(x, y) { ly = y; } } };
    okAv(!new Sh.LookAtPlayerGoal(s2, () => [], 8, () => 0).canUse(), 'a mob target does not bypass the closest-player search');
    const g3 = new Sh.LookAtPlayerGoal(s2, () => [far], 8, () => 0); g3.start();
    okAv(!g3.canUse() && !g3.canContinueToUse(), 'mob target >8 blocks is not looked at');
    const hi = { x: 2, y: 8, z: 0, eyeHeight: 1.6 }; s2.target = hi;
    const g4 = new Sh.LookAtPlayerGoal(s2, () => [hi], 8, () => 0);
    g4.canUse(); g4.start(); g4.tick();
    okAv(ly === 5.5, 'tick looks at the MOB eye Y, not the target eye (' + ly + ')');
  }
}

// ============ 11. #2406 closed-lid immunity is PersistentProjectileEntity only ==============
{
  const cs = EL.spawn('shulker', 60.5, 5, 60.5);
  const h0 = cs.health;
  const arrowHit = M.Combat.hurt(cs, 1, undefined, false, { attacker: null, source: 'projectile', persistent: true });
  okAv(arrowHit === false && cs.health === h0, 'closed shulker ignores an arrow/trident hit');
  const skullHit = M.Combat.hurt(cs, 1, undefined, false, { attacker: null, source: 'projectile' });
  okAv(skullHit !== false && cs.health < h0, 'closed shulker takes damage from a non-persistent projectile (wither skull)');
}

// ============ 12. #4512 /summon shulker {Color,Peek,AttachFace} ==============
{
  const sh = EL.spawn('shulker', 62.5, 5, 62.5);
  M.Commands.applyNbt(sh, { Color: 3, Peek: 100, AttachFace: 4 });
  okAv(M.Shulker.getColor(sh) === 3 && sh.shulkerPeek === 100 && sh.shulkerFace === 4, 'applyNbt sets Color/Peek/AttachFace');
}

console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) {
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
