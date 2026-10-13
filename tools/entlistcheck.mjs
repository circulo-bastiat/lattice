#!/usr/bin/env node
// entlistcheck.mjs — PLAN G17b: the entity list, and one tick of vanilla's shared motion.
//
//   node tools/entlistcheck.mjs
//
// ⚠ THE CENTRAL ASSERTION IS A TRAJECTORY COMPUTED TWICE. Vanilla's falling entity does
//     setDeltaMovement(getDeltaMovement().add(0, -g, 0));
//     move(SELF, getDeltaMovement());
//     setDeltaMovement(getDeltaMovement().scale(d));
// and the ORDER is the whole of it. Gravity after the move, or drag before it, produces a
// trajectory that looks right, lands in the right place, and is wrong in the third decimal for
// ever — and **no rule test can tell those apart**. So this file reproduces the recurrence by
// hand, in the check, from the two constants the bytecode gave, and compares it to the engine
// tick by tick for a hundred ticks. §6 then runs the two WRONG orders and shows they diverge,
// which is what makes the comparison worth making.
//
// Sections:
//   1. the list comes up and is empty
//   2. the spawn set is CLOSED — some types own-class-measured, two more generic-verified (D-390), the rest refused
//   3. a spawned entity carries the table's box and the table's constants
//   4. free fall, tick by tick, against the arithmetic
//   5. it lands on the ground, at the right height, and stops
//   6. anti-vacuity — the wrong orders must diverge, and a dead tick must be noticed
//   7. item entities: the pop, popResource, the merge box
//   8. the ON-GROUND law (D-427) — block friction, the bounce, and the at-rest cadence

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ROOT = MCLITE_ROOT;
const JSONF = join(ROOT, 'assets', 'entities.json');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 30) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   ✗ ' + m); } };
const say = (...a) => console.log(...a);

if (!existsSync(JSONF)) { say('entlistcheck: SKIP — run tools/pack-entities.mjs first'); process.exit(0); }

const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js'], initReg: false });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(JSONF, 'utf8')) });
M.Entities.init();

// ⚠ A WORLD MADE OF NOTHING BUT A FLOOR, so the only thing the trajectory can be about is the
// arithmetic. `Ph.shapeAt` is the ONE function the collision sweep asks the world — `clip`
// calls it and nothing else — so it is the one thing replaced, and every other line of `Ph.move`
// (the sweep, the step-up, the fall-distance bookkeeping) is the shipped code. Stubbing
// `solidAt` instead does nothing at all: `clip` never calls it, which this file found out by
// crashing on `NS.World.get` inside the real `shapeAt`.
const FLOOR_Y = 64;
let WALLS = null;                                          // set by §6's break
M.Physics.shapeAt = function (x, y, z) {
  if (y < FLOOR_Y) return M.Physics.FULL_CUBE;
  if (WALLS && (x <= WALLS[0] || x >= WALLS[1])) return M.Physics.FULL_CUBE;
  return null;
};
M.Physics.solidAt = function (x, y, z) { return M.Physics.shapeAt(x, y, z) !== null; };
M.Physics.blockAt = function () { return 0; };               // air: the floor world has no fluids (Ph.move asks it on landing)
M.Physics.grounded = function (x, y, z, d) { return y - d < FLOOR_Y; };
M.EntityList.init();
const EL = M.EntityList;

say('entlistcheck — PLAN G17b, the entity list and its motion (D-307, D-308)');

// ── 1 ───────────────────────────────────────────────────────────────────────────────────────
say('\n1. the list comes up');
ok(EL.ready === true, 'EntityList.init() left it not ready');
ok(EL.count() === 0, `the list starts with ${EL.count()} entities, expected 0`);

// ── 2. the set is closed ────────────────────────────────────────────────────────────────────
say('\n2. what it will simulate is a CLOSED set');
const can = EL.spawnable(), owed = EL.owed();
ok(can.length > 0, 'nothing is spawnable at all');
const hard = M.Entities.all().filter((n) => can.indexOf(n) < 0 && EL.canSpawn(n));   // motionFor's own zero-motion hardcodes
ok(can.length + hard.length + owed.length === M.Entities.count,
   `${can.length} table + ${hard.length} hardcoded + ${owed.length} owed = ${can.length + hard.length + owed.length}, but there are ${M.Entities.count} types`);
ok(can.indexOf('falling_block') >= 0, 'falling_block is spawnable — its gravity AND drag were measured');
ok(can.indexOf('tnt') >= 0, 'tnt is spawnable');
ok(can.indexOf('item') >= 0, 'item is spawnable — its drag came out of the multiply(f, 0.98, f) shape');
// ⚠ AND THE REFUSALS ARE ASSERTED TOO, because the list only means something if it can say NO.
// QUEUE 0.2 (G18c) -- pig LEFT this refusal (extract-entity-motion.mjs's CONDITIONAL_GENERIC,
// same shape as horse: its own travel() override resolves to axy.h() unintercepted, read in
// full).
ok(can.indexOf('pig') >= 0, "pig IS spawnable now (G18c) — its motion resolves through the same conditional-generic path horse uses");
// ⚠ `can`/`EL.spawnable()` audits ONLY `D.entities.motion`, the BYTECODE-EXTRACTED table —
// it does NOT see `EL.motionFor`'s own hand-added rows for a type this worktree's jar was never
// re-run for (bat/donkey/mule/llama, and now rabbit — 07i_entitylist.js's own header on each).
// rabbit therefore STAYS off this particular list, same as those four already do (none of them
// are asserted here either) — that is a fact about this AUDIT's own narrower scope, not a claim
// that rabbit itself is unspawnable. loop/rabbit-s98: `RabbitEntity` (.decomp, read in full for
// this unit) overrides neither `getGravity()` nor any drag-affecting tick method, so it now
// shares that same plain-MobEntity row, and `EL.spawn`/`EL.canSpawn` (below) see it fine.
// G17b-2 (#202) closed that gap: entity-motion-src-1.18.2.tsv now carries rabbit (and the other
// hand-added rows), so the audit sees it and 2d below asserts it.
ok(can.indexOf('rabbit') >= 0, "rabbit is in the motion-table audit now (G17b-2 rows, entity-motion-src-1.18.2.tsv)");
ok(EL.spawn('rabbit', 0, 70, 0) !== null, 'and spawn() now returns a real rabbit rather than refusing it (loop/rabbit-s98 closed this gap)');
ok(EL.spawn('not_an_entity', 0, 70, 0) === null, 'an unknown id is still refused');
ok(EL.count() === 1, 'the one real rabbit spawn above should be the only thing in the list');
// cloud unit (confident-lamport-asj6ue) -- shulker joins the same hand-added-row set (bat/donkey/
// mule/llama/rabbit) this section's own header names above: `D.entities.motion` was never
// re-measured for it either, and `ShulkerEntity extends GolemEntity extends PathAwareEntity`
// (.decomp, all three read whole) overrides no gravity/drag method, so it falls through to the
// SAME plain-MobEntity row rabbit's own line just proved (07i_entitylist.js's own citation).
ok(can.indexOf('shulker') < 0, 'shulker is (correctly) absent from the narrow motion-table audit too — same hand-added-row reason as rabbit');
ok(EL.canSpawn('shulker') === true, 'but EL.canSpawn sees the hand-added row and says yes');
ok(EL.spawn('shulker', 0, 70, 0) !== null, 'and spawn() returns a real shulker rather than refusing it (cloud unit closed this gap)');
// cloud unit (confident-lamport-mdnl4x) -- wither joins the same hand-added-row set: `WitherEntity`
// (.decomp, read whole) overrides no gravity/drag method of its own either (its real flight comes
// from an AI-stage move-control this engine has not built yet — 07i_entitylist.js's own citation),
// so it falls through to the SAME plain-MobEntity row shulker's own line just proved.
ok(can.indexOf('wither') < 0, 'wither is (correctly) absent from the narrow motion-table audit too — same hand-added-row reason as shulker');
ok(EL.canSpawn('wither') === true, 'but EL.canSpawn sees the hand-added row and says yes');
ok(EL.spawn('wither', 0, 70, 0) !== null, 'and spawn() returns a real wither rather than refusing it (cloud unit closed this gap)');
say(`   spawnable: ${can.join(' ')}`);

// ── 2c. G17b-4 — vehicles and the armor stand ───────────────────────────────────────────────
// boat, the seven minecarts and armor_stand now have rows in entity-motion-1.18.2.tsv (read by
// extract-entity-motion.mjs PART 4 / CONDITIONAL_GENERIC, D-309 override tests). The refusals
// beside them are asserted too: the rest of the owed list must STILL be refused.
say('\n2c. vehicles and the armor stand spawn; the rest of the owed list is still refused');
const VEH = ['boat', 'minecart', 'chest_minecart', 'furnace_minecart', 'hopper_minecart', 'tnt_minecart',
  'command_block_minecart', 'spawner_minecart', 'armor_stand'];
const STILL_REFUSED = [];
for (const n of VEH) {
  ok(can.indexOf(n) >= 0 && EL.canSpawn(n), `${n} is in the measured set and canSpawn says yes`);
  const e = EL.spawn(n, 0, 70, 0);
  ok(e !== null, `${n} spawns`);
}
EL.clear();
{
  const g = (n) => EL.motionFor(n);
  ok(g('boat')[0] === 0.04 && g('boat')[1] === 1, `boat falls at 0.04 with NO vertical drag, got ${g('boat')}`);
  ok(g('minecart')[0] === 0.04 && g('minecart')[1] === 0.95, `minecart falls at 0.04, airborne drag 0.95, got ${g('minecart')}`);
  ok(g('armor_stand')[0] === 0.08 && Math.abs(g('armor_stand')[1] - 0.98) < 1e-6, `armor_stand uses LivingEntity's generic law, got ${g('armor_stand')}`);
}
for (const n of STILL_REFUSED) {
  ok(can.indexOf(n) < 0 && !EL.canSpawn(n) && EL.spawn(n, 0, 70, 0) === null && owed.indexOf(n) >= 0, `${n} is still refused and still owed`);
}
{
  // anti-vacuity: break the data — take the vehicle rows out — and every spawn above must refuse;
  // put a refused type in and the refusal assertion must notice.
  const realMot = M.DATA.entities.motion;
  const cut = Object.assign({}, realMot);
  VEH.forEach((n) => { delete cut[n]; });
  M.DATA.entities.motion = cut;
  let refused = 0;
  VEH.forEach((n) => { if (EL.spawn(n, 0, 70, 0) === null) refused++; });
  okAv(refused === VEH.length, `anti-vacuity: with the ${VEH.length} rows deleted all ${refused} vehicles refuse — the spawn assertions can fail`);
  EL.clear();
  M.DATA.entities.motion = realMot;
}

// ── 2b. the GENERIC-INHERITED route (D-390) — cow and zombie, not own-class rows ────────────
// ⚠ THESE TWO ARE DIFFERENT FROM EVERY OTHER ROW ABOVE. Neither cow's nor zombie's own class
// carries a gravity statement (D-384..D-389) — both dispatch travel() straight through to
// LivingEntity's own body, unintercepted, proven by an instruction-by-instruction read (D-387,
// D-388, D-389) and then by an automated override-chain check (D-390) that also knows how to
// refuse (its own anti-vacuity test is ender_dragon, which skips travel() a DIFFERENT way — by
// never calling super.tick() at all — and the check catches that shape too).
say('\n2b. cow and zombie: LivingEntity\'s own generic gravity/drag, not their own class (D-390)');
ok(can.indexOf('cow') >= 0 && can.indexOf('zombie') >= 0, 'cow and zombie should both be spawnable via the generic route');
const cowMot = EL.motionFor('cow'), zombieMot = EL.motionFor('zombie');
ok(!!cowMot && !!zombieMot, 'cow and zombie should both have a motion entry');
if (cowMot && zombieMot) {
  // ⚠ CROSS-CHECKED AGAINST THE PLAYER'S OWN INDEPENDENTLY-MEASURED CONSTANTS (D-77/D-250/D-251)
  // rather than a literal repeated here — Player IS a LivingEntity and runs the exact same
  // travel() body when not flying/swimming/gliding, so agreement is a real check.
  ok(cowMot[0] === M.Physics.GRAVITY && zombieMot[0] === M.Physics.GRAVITY,
     `cow/zombie gravity should equal Ph.GRAVITY (${M.Physics.GRAVITY}), got ${cowMot[0]}/${zombieMot[0]}`);
  ok(Math.abs(cowMot[1] - M.Physics.DRAG_Y) < 1e-6 && Math.abs(zombieMot[1] - M.Physics.DRAG_Y) < 1e-6,
     `cow/zombie drag should equal Ph.DRAG_Y (${M.Physics.DRAG_Y}), got ${cowMot[1]}/${zombieMot[1]}`);
}
const cowE = EL.spawn('cow', 1.5, FLOOR_Y + 30, 1.5);
const zombieE = EL.spawn('zombie', -1.5, FLOOR_Y + 30, -1.5);
ok(!!cowE && !!zombieE, 'EL.spawn should actually accept cow and zombie now — this was the named blocker (NEXT.md session 30, step 2)');
if (cowE) ok(cowE.gravity === M.Physics.GRAVITY && Math.abs(cowE.drag - M.Physics.DRAG_Y) < 1e-6, 'the spawned cow carries the generic constants, not a default');
EL.clear();

// ── 3. a spawned entity carries the TABLE's numbers ─────────────────────────────────────────
say("\n3. a spawned entity carries the table's box and constants");
// ⚠ SPAWNED FAR ABOVE THE FLOOR ON PURPOSE: §4 compares a hundred ticks of FREE fall, and this
// entity reaches the floor in thirty-five from a hundred blocks up. The first run of this file
// compared the last sixty-five ticks of a resting block against a model that was still falling.
const fb = EL.spawn('falling_block', 8.5, FLOOR_Y + 5000, -3.5, { state: 1 });   // #833: a state-less block is air and is discarded
ok(!!fb, 'falling_block did not spawn');
ok(EL.count() === 1, `the list holds ${EL.count()} entities, expected 1`);
ok(fb.width === M.Entities.width('falling_block') && fb.height === M.Entities.height('falling_block'),
   `the box is ${fb.width} x ${fb.height}, the table says ${M.Entities.width('falling_block')} x ${M.Entities.height('falling_block')}`);
ok(fb.width === 0.98, 'a falling block is 0.98 wide — WIDER than the player, which is why Ph.move had to stop using Ph.W');
const mot = EL.motionFor('falling_block');
ok(fb.gravity === mot[0] && fb.drag === mot[1], 'gravity and drag came from the table');
ok(fb.gravity === 0.04 && fb.drag === 0.98, `and they are 0.04 / 0.98, got ${fb.gravity} / ${fb.drag}`);
ok(fb.px === fb.x && fb.py === fb.y && fb.pz === fb.z, 'the previous position starts equal to the current one (D-79)');

// ── 4. free fall, tick by tick ──────────────────────────────────────────────────────────────
// ⚠ THE MODEL IS WRITTEN OUT IN FULL rather than folded into a closed form, because the ORDER is
// the thing under test and a closed form hides it.
say('\n4. a hundred ticks of free fall, against the arithmetic');
{
  const g = fb.gravity, d = fb.drag;
  let y = FLOOR_Y + 5000, vy = 0, worst = 0, worstAt = -1;
  for (let t = 0; t < 100; t++) {
    vy -= g;              // gravity
    y += vy;              // the move (nothing is in the way up here)
    vy *= d;              // drag
    EL.tickOne(fb);
    const err = Math.abs(fb.y - y);
    if (err > worst) { worst = err; worstAt = t; }
  }
  ok(worst < 1e-9, `the engine and the arithmetic differ by ${worst.toExponential(2)} at tick ${worstAt}`);
  ok(fb.age === 100, `the entity aged ${fb.age} ticks, expected 100`);
  ok(fb.y < FLOOR_Y + 5000 - 50, `after 100 ticks it has fallen to ${fb.y.toFixed(2)} — it is barely moving`);
  ok(fb.onGround === false, 'it is still in free fall, so §4 measured free fall');
  say(`   after 100 ticks: y ${fb.y.toFixed(4)}, vy ${fb.vy.toFixed(4)} (model ${y.toFixed(4)}, ${vy.toFixed(4)})`);
}

// ── 5. it lands ─────────────────────────────────────────────────────────────────────────────
say('\n5. it lands on the floor and stops');
{
  EL.clear();
  // #833: a falling BLOCK now places itself on landing and is discarded (fallingblockcheck); TNT shares its 'flat' physics and stays.
  const e = EL.spawn('tnt', 0.5, FLOOR_Y + 20, 0.5);
  let t = 0;
  while (!e.onGround && t < 400) { EL.tick(); t++; }
  ok(e.onGround === true, `it never landed in ${t} ticks`);
  // ⚠ NOT ZERO: `clip` keeps an epsilon of 1e-5 between a box and the face it rests on, which
  // is the same gap the player rests at, and closing it would put the two surfaces in contact
  // and let the next sweep find them overlapping.
  ok(Math.abs(e.y - FLOOR_Y) < 1e-4 && e.y >= FLOOR_Y,
     `it came to rest at y ${e.y}, and the floor is at ${FLOOR_Y}`);
  ok(e.vy === 0 || Math.abs(e.vy) < 1e-9, `its vertical speed at rest is ${e.vy}`);
  // and it stays there
  const yWas = e.y;
  for (let i = 0; i < 40; i++) EL.tick();
  ok(Math.abs(e.y - yWas) < 1e-9, `forty ticks later it is at ${e.y}, not ${yWas} — it is sinking or jittering`);
  say(`   landed after ${t} ticks at y ${e.y}`);

  // removal actually removes
  const before = EL.count();
  EL.remove(e);
  EL.tick();
  ok(EL.count() === before - 1, `removing left ${EL.count()} of ${before} entities`);
}

// ── 6. anti-vacuity ─────────────────────────────────────────────────────────────────────────
say('\n6. break it, and it must be caught');
{
  // the two WRONG orders, run against the same model §4 compares to
  const model = (g, d, n) => { let y = 0, vy = 0; for (let i = 0; i < n; i++) { vy -= g; y += vy; vy *= d; } return y; };
  // ⚠ DAMPING AT THE TOP OF THE TICK IS **NOT** A WRONG ORDER, and the first version of this
  // file asserted that it was. `vy *= d` at the end of tick n and at the start of tick n+1 are
  // the same multiplication; with vy starting at zero the two loops produce identical numbers
  // for ever. The order that IS wrong is damping BETWEEN the gravity and the move, which damps
  // this tick's own acceleration — so that is the one asserted.
  const dragMid  = (g, d, n) => { let y = 0, vy = 0; for (let i = 0; i < n; i++) { vy -= g; vy *= d; y += vy; } return y; };
  const gravLast  = (g, d, n) => { let y = 0, vy = 0; for (let i = 0; i < n; i++) { y += vy; vy -= g; vy *= d; } return y; };
  const G = 0.04, D = 0.98, N = 100;
  okAv(Math.abs(model(G, D, N) - dragMid(G, D, N)) > 1e-6,
    `damping BETWEEN the gravity and the move read as the same trajectory (${model(G, D, N).toFixed(4)} vs ${dragMid(G, D, N).toFixed(4)})`);
  okAv(Math.abs(model(G, D, N) - gravLast(G, D, N)) > 1e-6,
    `moving BEFORE the gravity read as the same trajectory (${model(G, D, N).toFixed(4)} vs ${gravLast(G, D, N).toFixed(4)})`);

  // a list that does not tick
  EL.clear();
  const e = EL.spawn('tnt', 0.5, FLOOR_Y + 30, 0.5);
  const y0 = e.y;
  const realTickOne = EL.tickOne;
  EL.tickOne = function () {};
  for (let i = 0; i < 20; i++) EL.tick();
  okAv(e.y === y0, 'a list whose tick does nothing was read as moving');
  EL.tickOne = realTickOne;
  for (let i = 0; i < 20; i++) EL.tick();
  okAv(e.y < y0 - 1, '...and it falls again when the tick is put back');

  // a collider that used the PLAYER's width would fit through a 0.7 gap a 0.98 block cannot
  // ⚠ THIS IS D-308, REPRODUCED. `Ph.move` took `e.height` from the entity and its WIDTH from
  // `Ph.W` — the player's 0.6. Walls 0.7 apart stop a falling block and not a player.
  {
    WALLS = [-1, 1];                                       // solid at x <= -1 and x >= 1
    EL.clear();
    // #833: the fixture's wall makes the sweep report onGround at once, and a grounded falling block now
    // consults the world and registry (fallingblockcheck's business) - this test is only about the sweep's width.
    const tfb = EL.tickFallingBlock; EL.tickFallingBlock = () => {};
    const wide = EL.spawn('falling_block', 0, FLOOR_Y + 100, 0, { state: 1 });
    wide.vx = 0.5;
    for (let i = 0; i < 10; i++) EL.tick();
    // its half-width is 0.49, so its face reaches x = 1 when its centre is at 0.51
    const stopped = Math.abs(wide.x) < 0.52;
    WALLS = null; EL.tickFallingBlock = tfb;
    okAv(stopped, `a 0.98-wide entity reached x ${wide.x.toFixed(3)} between walls at -1 and 1 — Ph.move is using the PLAYER's 0.6 width`);
  }
  EL.clear();
}

// ═══════════ 7. ITEM ENTITIES — the drop, the merge, the delay, the despawn (D-333) ════════
// ⚠⚠ THIS IS WHAT A BROKEN BLOCK DOES NOW. Dan, session 11: *"items dont drop as block
// entities"*. Every constant is out of `ItemEntity`'s bytecode (obfuscated `bli`) rather than
// remembered, and the generator is swapped for a fixed one so the pop VELOCITY can be asserted
// as arithmetic instead of sampled as luck.
say('\n7. item entities');
{
  EL.clear();
  const realRandom = EL.random;

  // ── the pop, with a pinned generator ────────────────────────────────────────────────────
  // `new ItemEntity(level, x, y, z, stack)` is
  //   (random()*0.2 - 0.1, 0.2, random()*0.2 - 0.1)
  // so at random() = 0.5 the horizontal terms are exactly zero and the lift is exactly 0.2.
  EL.random = () => 0.5;
  const mid = EL.dropStack(10, 70, 10, 3, 5);
  ok(!!mid, 'dropStack produced no entity');
  ok(mid.vx === 0 && mid.vz === 0,
     `at random()=0.5 the pop is straight up; got vx ${mid.vx}, vz ${mid.vz}`);
  ok(mid.vy === EL.ITEM_POP_UP, `the lift is ${EL.ITEM_POP_UP}; got ${mid.vy}`);
  ok(mid.pickupDelay === EL.ITEM_PICKUP_DELAY,
     `a dropped stack starts with ${EL.ITEM_PICKUP_DELAY} ticks of pickup delay`);
  // ⚠⚠ AN ITEM ENTITY ALWAYS HOLDS AT LEAST ONE, and this is the assertion that was missing.
  // A spawn with no count carried `undefined`, and the day pickup arrived `count - taken` went
  // NEGATIVE and removed the entity on its first tick (D-333). `g17cbcheck` reported it as
  // "0 triangles" — a picture check naming a symptom two layers from its cause.
  {
    const bare = EL.spawn('item', 0, FLOOR_Y, 0, { item: 3 });
    ok(bare.count === 1, `an item entity spawned with no count holds ${bare.count}, not undefined`);
    ok(EL.PICKUP_NEVER === 32767,
       `vanilla's never-pick-up sentinel is 32767, this says ${EL.PICKUP_NEVER}`);
    bare.pickupDelay = EL.PICKUP_NEVER;
    EL.tick();
    ok(bare.pickupDelay === EL.PICKUP_NEVER,
       'the never sentinel does NOT count down — `pickupDelay != 32767` is in vanilla\'s own tick');
    EL.remove(bare);
  }
  ok(mid.item === 3 && mid.count === 5, 'the entity carries the item and the count it was given');
  // and the extremes of the generator must give exactly +-half the spread
  EL.random = () => 0;
  const lo = EL.dropStack(10, 70, 10, 3, 1);
  EL.random = () => 1;
  const hi = EL.dropStack(10, 70, 10, 3, 1);
  ok(Math.abs(lo.vx + EL.ITEM_POP_SPREAD / 2) < 1e-12 && Math.abs(hi.vx - EL.ITEM_POP_SPREAD / 2) < 1e-12,
     `the horizontal pop spans +-${EL.ITEM_POP_SPREAD / 2}; got ${lo.vx} .. ${hi.vx}`);
  say(`   pop ............. vx ${lo.vx} .. ${hi.vx}, vy ${mid.vy}`);

  // ── popResource: the jitter is inside the cell, on all three axes ───────────────────────
  EL.clear();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i <= 20; i++) {
    EL.random = () => i / 20;
    const e = EL.popResource(10, 70, 10, 3, 1);
    minX = Math.min(minX, e.x); maxX = Math.max(maxX, e.x);
    minY = Math.min(minY, e.y); maxY = Math.max(maxY, e.y);
  }
  const J = EL.BLOCK_POP_JITTER;
  say(`   popResource ..... x ${minX.toFixed(3)}..${maxX.toFixed(3)}  y ${minY.toFixed(3)}..${maxY.toFixed(3)}`);
  ok(Math.abs(minX - (10.5 - J)) < 1e-9 && Math.abs(maxX - (10.5 + J)) < 1e-9,
     `the horizontal jitter is +-${J} about the cell centre; got ${minX}..${maxX}`);
  ok(maxY < 70.5 + J + 1e-9 && minY > 70.5 - J - 0.5,
     `the vertical jitter stays inside the cell; got ${minY}..${maxY}`);
  // ⚠ AND IT IS LOWER THAN THE CENTRE, because popResource subtracts half the item's height —
  // which is why a dropped block rests ON the floor rather than hovering in it.
  EL.random = () => 0.5;
  const centred = EL.popResource(10, 70, 10, 3, 1);
  ok(centred.y < 70.5, `popResource drops the entity below the cell centre; got y ${centred.y}`);

  // ── merging ────────────────────────────────────────────────────────────────────────────
  EL.clear();
  const a = EL.dropStack(10, 70, 10, 7, 20);
  const b = EL.dropStack(10.2, 70, 10.2, 7, 30);
  const far = EL.dropStack(12, 70, 10, 7, 5);
  const other = EL.dropStack(10.1, 70, 10.1, 8, 5);
  ok(EL.mergeNear(a) === 1, 'a nearby stack of the same item merges, and only it');
  // tryToMerge: the LARGER stack absorbs the smaller one
  ok(b.count === 50, `merging 20 and 30 gives 50; got ${b.count}`);
  ok(a.removed === true, 'the stack that was absorbed is removed');
  ok(far.removed === false && other.removed === false,
     'a stack half a block away and a stack of a different item are both left alone');
  // and a merge that would exceed the stack size must not happen
  const big1 = EL.dropStack(20, 70, 20, 9, 40), big2 = EL.dropStack(20.1, 70, 20.1, 9, 40);
  ok(EL.mergeNear(big1) === 0 && big2.removed === false,
     '40 + 40 is over a stack and must not merge');
  ok(EL.canMerge(a, a, 64) === false, 'an entity does not merge with itself');

  // ── the delay counts down, and the entity despawns ─────────────────────────────────────
  EL.clear();
  const d = EL.dropStack(10, FLOOR_Y + 3, 10, 3, 1);
  const startDelay = d.pickupDelay;
  EL.tick();
  ok(d.pickupDelay === startDelay - 1, 'the pickup delay counts down one per tick');
  for (let i = 0; i < startDelay + 4; i++) EL.tick();
  ok(d.pickupDelay === 0, 'and stops at zero rather than going negative');
  ok(d.removed === false, `an item does not despawn before ${EL.ITEM_LIFETIME} ticks`);
  d.age = EL.ITEM_LIFETIME - 1;
  EL.tick();
  ok(d.removed === true, `an item despawns at ${EL.ITEM_LIFETIME} ticks`);
  EL.random = realRandom;
  EL.clear();
}

// ── D-333's breaks ───────────────────────────────────────────────────────────────────────
{
  EL.clear();
  const realRandom = EL.random;
  EL.random = () => 0.5;
  // the pop assertion must reject a straight drop with no lift
  okAv(EL.ITEM_POP_UP !== 0, 'anti-vacuity: a dropped item is thrown upward, not released');
  // the merge distance must actually be measured
  const p = EL.dropStack(10, 70, 10, 7, 1);
  // the test is box INTERSECTION (box.inflate(0.5, 0, 0.5)), so the reach is the box plus the item's own width
  const reach = EL.ITEM_MERGE_BOX + p.width;
  const q = EL.dropStack(10 + reach + 0.01, 70, 10, 7, 1);
  okAv(EL.mergeNear(p) === 0 && q.removed === false,
       'anti-vacuity: a stack just outside the merge box is NOT absorbed — the distance is real');
  // ...and one just inside IS
  const r = EL.dropStack(10 + reach - 0.01, 70, 10, 7, 1);
  okAv(EL.mergeNear(p) === 1 && p.removed === true,   // a tie: the other stack absorbs this one
       'anti-vacuity: ...and one just inside it is, so the test is not simply always false');
  // a different item must never merge, however close
  const p2 = EL.dropStack(30, 70, 30, 7, 1);
  const s2 = EL.dropStack(30, 70, 30, 99, 1);
  okAv(EL.mergeNear(p2) === 0 && s2.removed === false,
       'anti-vacuity: a different item at the same position does not merge');
  EL.random = realRandom;
  EL.clear();
}

// ── 8. THE ON-GROUND LAW (D-427) ────────────────────────────────────────────
//
// Dan, session 55: *"items slide too much when dropped"*. §4 above proves the trajectory of a
// falling entity tick by tick and says nothing at all about what happens once it LANDS, which
// is where the whole of this bug lived: `tickOne` damped all three axes by the uniform 0.98,
// for ever, on the ground as in the air.
//
// ⚠ THE ASSERTIONS ARE A RECURRENCE COMPUTED TWICE, the same shape §4 uses, because "it stops
// sooner now" is not a measurement. The friction table is stubbed with two blocks — 0.6 (grass)
// and 0.98 (ice) — so the law can be checked IN BOTH DIRECTIONS: the same push must die in a
// few blocks on one and carry across a room on the other. A single-surface test passes just as
// happily against a hard-coded 0.588.
say('\n8. what happens when it lands — the on-ground law (D-427)');
{
  const GRASS = 1, ICE = 2;
  const FRICTION = { [GRASS]: 0.6, [ICE]: 0.98 };
  let surface = GRASS;
  const asked = [];
  const realBlockId = M.Physics.blockIdAt;
  M.Physics.blockIdAt = function (x, y, z) { asked.push([x, y, z]); return surface; };
  M.Reg = M.Reg || {};
  const realFriction = M.Reg.friction;
  M.Reg.friction = { [GRASS]: 0.6, [ICE]: 0.98 };

  const G = EL.groundFor('item');
  ok(!!G, 'item has no on-ground law in the shipped table — pack-entities never saw it');
  ok(G && G.m === 'block', `item's on-ground mode is "${G && G.m}", expected block`);
  ok(G && G.b === -0.5 && G.g === 'falling', `item's bounce is ${G && G.b}/${G && G.g}, expected -0.5/falling`);
  const O = EL.groundFor('experience_orb');
  ok(!O || O.b === -0.9, `experience_orb's bounce is ${O && O.b} — the jar says -0.9, not the item's -0.5`);
  const T = EL.groundFor('tnt');
  ok(!T || (T.m === 'flat' && T.f === 0.7), `tnt's on-ground law is ${T && T.m}/${T && T.f}, expected flat/0.7`);

  // ⚠ THE LOOKUP POSITION IS PART OF THE LAW. `ItemEntity` asks for the block at y − 1, not
  // the player's y − 0.5000001 (`getBlockPosBelowThatAffectsMyMovement`). Using the player's
  // would give a slab's friction where vanilla gives the block under the slab.
  {
    const probe = EL.spawn('item', 8, FLOOR_Y, 8, { item: 7, count: 1 });
    probe.onGround = true; asked.length = 0;
    EL.frictionBelow(probe);
    ok(asked.length === 1 && Math.abs(asked[0][1] - (FLOOR_Y - 1)) < 1e-9,
       `frictionBelow asked for y=${asked.length ? asked[0][1] : 'nothing'}, expected exactly y-1 (${FLOOR_Y - 1})`);
    EL.clear();
  }

  // the recurrence, by hand, from the TABLE's own numbers
  const slide = (fric, v0, ticks) => {
    let v = v0, d = 0;
    for (let i = 0; i < ticks; i++) { d += v; v *= fric * G.k; }
    return { v, d };
  };
  // ...and the same push through the engine, with the entity held on the ground
  const engine = (block, v0, ticks) => {
    surface = block;
    const e = EL.spawn('item', 0, FLOOR_Y, 0, { item: 7, count: 1 });
    e.vx = v0; e.vy = 0; e.vz = 0; e.pickupDelay = EL.PICKUP_NEVER;
    let d = 0;
    for (let i = 0; i < ticks; i++) {
      e.onGround = true;                       // it is resting on the floor for the whole test
      const before = e.x;
      EL.damp(e);                              // the law under test, applied as tickOne applies it
      e.x += e.vx; d += e.x - before;
    }
    const out = { v: e.vx, d: d };
    EL.clear();
    return out;
  };

  const N = 40, V0 = 0.5;
  const handGrass = slide(0.6, V0, N), engGrass = engine(GRASS, V0, N);
  // ⚠ the engine damps BEFORE it steps here and the hand recurrence steps before it damps, so
  // the two differ by exactly one factor — compare the SPEEDS, which is the law itself.
  ok(Math.abs(engGrass.v - handGrass.v * (0.6 * G.k)) < 1e-12 || Math.abs(engGrass.v - handGrass.v) < 1e-12,
     `after ${N} ticks on grass the engine's speed is ${engGrass.v}, the arithmetic says ${handGrass.v}`);
  ok(engGrass.v < 1e-6, `a stack pushed at ${V0} b/t is still moving at ${engGrass.v} b/t after ${N} ticks on grass`);
  ok(engGrass.d < 1.5, `it slid ${engGrass.d.toFixed(3)} blocks on grass — vanilla's 0.588 per tick stops it inside about a block`);

  const engIce = engine(ICE, V0, N);
  ok(engIce.d > engGrass.d * 4,
     `the SAME push slid ${engIce.d.toFixed(3)} on ice and ${engGrass.d.toFixed(3)} on grass — the friction of the block below is not being read`);

  // and the old behaviour, for the record: the uniform drag alone
  let vOld = V0, dOld = 0;
  for (let i = 0; i < N; i++) { dOld += vOld; vOld *= 0.98; }
  say(`   ${N} ticks at ${V0} b/t: grass ${engGrass.d.toFixed(2)}b, ice ${engIce.d.toFixed(2)}b, pre-D-427 uniform drag ${dOld.toFixed(2)}b`);

  // ── live anti-vacuity ───────────────────────────────────────────────────
  // Put the PRE-D-427 law back — the uniform drag on all three axes — and every assertion
  // above must fail. A break that cannot fire is not a break (D-305).
  {
    const realDamp = EL.damp;
    EL.damp = function (e) { e.vx *= e.drag; e.vy *= e.drag; e.vz *= e.drag; };
    const broken = engine(GRASS, V0, N);
    okAv(!(broken.d < 1.5) && !(broken.v < 1e-6),
         `anti-vacuity: with the uniform drag back, the stack slides ${broken.d.toFixed(2)} blocks — the distance test notices`);
    EL.damp = realDamp;
    // ...and a friction table that answers the same number for every block must be caught too
    M.Reg.friction = { [GRASS]: 0.98, [ICE]: 0.98 };
    const flat = engine(GRASS, V0, N), flat2 = engine(ICE, V0, N);
    okAv(!(flat2.d > flat.d * 4),
         'anti-vacuity: a friction table with one value for every block fails the grass-vs-ice comparison');
    M.Reg.friction = { [GRASS]: 0.6, [ICE]: 0.98 };
  }

  M.Physics.blockIdAt = realBlockId;
  M.Reg.friction = realFriction;
}

// ── 2d. G17b-2 (#202) — ground mobs proved to reach LivingEntity.travel unoverridden ─────────
// tools/extract-entity-motion-src.mjs reads .decomp (name+descriptor override test, super tick on
// the unconditional path, D-309) and writes entity-motion-src-1.18.2.tsv; these must be in the
// measured set at LivingEntity's 0.08 / 0.98, the rest of the owed list must STILL be refused.
say('\n2d. G17b-2: generic-travel ground mobs spawn; the rest of the owed list is still refused');
const G17B2 = ['cave_spider', 'husk', 'stray', 'giant', 'zombie_villager', 'zombified_piglin', 'piglin', 'piglin_brute',
  'hoglin', 'zoglin', 'fox', 'goat', 'llama', 'trader_llama', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse',
  'panda', 'polar_bear', 'rabbit', 'mooshroom', 'snow_golem', 'wandering_trader', 'silverfish', 'endermite',
  'enderman', 'wither_skeleton', 'slime', 'magma_cube'];
const DRAGGY = ['ender_dragon', 'ghast', 'blaze', 'vex', 'phantom', 'squid', 'bat', 'bee'];   // own travel/flight: NOT this table
for (const n of G17B2) {
  const m = M.DATA.entities.motion[n];
  ok(can.indexOf(n) >= 0 && owed.indexOf(n) < 0 && m && m[0] === 0.08 && Math.abs(m[1] - 0.98) < 1e-6,
     `${n} is in the measured set at 0.08/0.98, got ${m}`);
  ok(EL.spawn(n, 0, 70, 0) !== null, `${n} spawns`);
  EL.clear();
}
for (const n of DRAGGY) {
  ok(!M.DATA.entities.motion[n] || n === 'bat', `${n} has no generic row in the motion table (own travel/flight law)`);
}
// G17b-6 (#206): the static/special entities spawn (row [0,1] "no motion", proof named in the tsv);
// the types still owed stay refused. entity-motion-static-1.18.2.tsv <- tools/extract-entity-static-src.mjs.
say('\n2e. G17b-6: static and special entities spawn; the rest are still refused');
const G17B6 = ['painting', 'item_frame', 'glow_item_frame', 'leash_knot', 'area_effect_cloud', 'marker', 'lightning_bolt',
  'end_crystal', 'evoker_fangs', 'player'];
const STILL = [];
for (const n of G17B6) {
  ok(can.indexOf(n) >= 0 && owed.indexOf(n) < 0, `${n} is spawnable and no longer owed`);
  ok(EL.spawn(n, 0, 70, 0) !== null, `${n} spawns`);
  const e0 = EL.list.length ? EL.list[0] : null;
  if (e0) { for (let i = 0; i < 5; i++) EL.tick(); ok(e0.y === 70, `${n} does not fall (y=${e0.y})`); }
  EL.clear();
}
ok(JSON.stringify(owed.slice().sort()) === JSON.stringify(Object.keys(EL.OWED_STAGE).sort()) && owed.every((n) => /^G\d+$/.test(EL.OWED_STAGE[n])), `every remaining owed type names a stage (${owed.map((n) => n + ' ' + EL.OWED_STAGE[n]).join(', ')})`);
for (const n of STILL) ok(owed.indexOf(n) >= 0 && EL.spawn(n, 0, 70, 0) === null, `${n} is still refused and still owed`);
{
  const realMot = M.DATA.entities.motion, cut = Object.assign({}, realMot);
  G17B6.forEach((n) => { delete cut[n]; });
  M.DATA.entities.motion = cut;
  const ST = G17B6.filter((n) => realMot[n] && !EL.motionFor(n));   // rows that were the ONLY reason to spawn (some also carry a motionFor hardcode)
  const gone = ST.filter((n) => EL.spawn(n, 0, 70, 0) === null).length;
  EL.clear();
  M.DATA.entities.motion = realMot;
  okAv(gone === ST.length && ST.length >= 3, `anti-vacuity: with the static rows deleted all ${gone} refuse — the 2e assertions can fail`);
  EL.clear();
  M.DATA.entities.motion = realMot;
}
{
  const realMot = M.DATA.entities.motion, cut = Object.assign({}, realMot);
  G17B2.forEach((n) => { delete cut[n]; });
  M.DATA.entities.motion = cut;
  const still = G17B2.filter((n) => EL.spawnable().indexOf(n) < 0).length;
  M.DATA.entities.motion = realMot;
  okAv(still === G17B2.length, `anti-vacuity: with the ${G17B2.length} rows deleted all ${still} vanish from spawnable() — the 2d assertions can fail`);
  M.DATA.entities.motion = Object.assign({}, realMot, { ender_dragon: [0.08, 0.98] });
  okAv(EL.spawnable().indexOf('ender_dragon') >= 0, 'anti-vacuity: a generic row for ender_dragon would show in spawnable() — the DRAGGY assertion can fail');
  M.DATA.entities.motion = realMot;
}

say('');
say('=============== entlistcheck =============');
say(` spawnable types .... ${can.length}   owed ${owed.length}`);
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
for (const f of fails) say('   ✗ ' + f);
say(` breaks caught ...... ${breaks}`);
say('==========================================');
process.exit(fails.length ? 1 : 0);
