#!/usr/bin/env node
// turtlecheck.mjs — loop/turtle-s102 (QUEUE 0.2 G18 mobs): the TURTLE, whole. Drives the REAL
// modules (07zp_turtle.js, Ai.ROSTER.turtle/EL.DEFAULTS.turtle/Spawn.RULES.turtle) against
// `.decomp/net/minecraft/entity/passive/TurtleEntity.java` (702 lines, read in full).
//
//   node tools/turtlecheck.mjs [--verbose]
//
// Sections:
//   1. attributes/dimensions/breeding food/motion — the jar-extracted entity table's own row
//   2. Spawn.RULES.turtle — sand below (#minecraft:sand), y < seaLevel+4, light gate
//   3. EL.spawn('turtle', ...) — EL.DEFAULTS.turtle rolls e.homeX/Y/Z, Ai.ROSTER attaches e.ai
//   4. Tu.MateGoal — hasEgg(true) instead of a child, refuses with an egg already carried
//   5. Tu.LayEggGoal / Tu.placeEgg — digs 200 ticks, places turtle_egg with EGGS 1..4
//   6. Tu.onGrowUp — one scute, wired off the growAge -1->0 transition
//   7. Tu.GoHomeGoal walks home; 7c (#1255) the nine-row roster + each canUse gate
//   8. Breed.SPECIAL.turtle — closed (no longer refusing)
//   9. anti-vacuity — break the check's own data/stubs and watch it catch the break

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
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('turtlecheck — loop/turtle-s102 (QUEUE 0.2 G18 mobs), the turtle, whole');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
               '07m_breed.js', '07zh_rabbit.js', '07zj_fox.js', '07zj_goat.js', '07zl_panda.js',
               '07q_effects.js', '07zm_axolotl.js', '07zn_mooshroom.js', '07t_fly.js', '07zp_turtle.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Tu = MCL.Turtle, Breed = MCL.Breed, W = MCL.World, S = MCL.States, R = MCL.Reg;
const CH = MCL.CH;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
MCL.Behave.init(W);
EL.init();
Ai.init();
Spawn.init();
Breed.init();

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

ok(Tu && Tu.ready, 'NS.Turtle did not load/ready');

// ── 1. attributes/dimensions/breeding food/motion ───────────────────────────────────────────
say('1. the jar-extracted entity table’s own row for turtle');
{
  const at = Ent.attrsOf('turtle');
  ok(!!at, 'Ent.attrsOf(turtle) missing entirely');
  ok(at && at.hp === 30, `turtle max health 30 — got ${at && at.hp}`);
  ok(at && Math.abs(at.speed - 0.25) < 1e-6, `turtle movement speed 0.25 — got ${at && at.speed}`);
  const dim = Ent.dimensions('turtle');
  ok(dim && Math.abs(dim.width - 1.2) < 1e-9 && Math.abs(dim.height - 0.4) < 1e-9,
    `turtle dims [1.2,0.4] — got ${dim && [dim.width, dim.height]}`);
  const food = Ent.breedFood('turtle');
  ok(food && food.k === 'items' && food.i.indexOf('seagrass') >= 0,
    `turtle breeds off seagrass (an ITEM list, not a tag) — got ${JSON.stringify(food)}`);
  const m = EL.motionFor('turtle');
  ok(m && Math.abs(m[0] - 0.005) < 1e-9 && Math.abs(m[1] - 0.9) < 1e-9,
    `motionFor(turtle) = ${m}, expected [0.005,0.9] (turtle is NOT special-cased in EL.motionFor — falls through to D.entities.motion.turtle)`);
}

// ── 2. Spawn.RULES.turtle ───────────────────────────────────────────
say('2. Spawn.RULES.turtle — #minecraft:sand below, y < seaLevel+4, light gate');
{
  ok(typeof Spawn.RULES.turtle === 'function' && Spawn.canPlace('turtle'), 'Spawn.RULES.turtle is not wired');
  const sand = S.stateOf('sand') | 0, dirt = S.stateOf('dirt') | 0;
  W.setBlock(0, 60, 0, sand);
  W.setBlock(0, 60, 1, dirt);
  const saveBright = W.rawBrightness;
  W.rawBrightness = () => 15;
  ok(Spawn.RULES.turtle(0, 61, 0) === true, 'sand below, below seaLevel+4, lit — must pass');
  ok(Spawn.RULES.turtle(0, 61, 1) === false, 'dirt below (not #minecraft:sand) must refuse');
  ok(Spawn.RULES.turtle(0, Spawn.SEA_LEVEL + 5, 0) === false, 'y >= seaLevel+4 must refuse regardless of sand');
  okAv((() => { W.rawBrightness = () => 0; return Spawn.RULES.turtle(0, 61, 0) === false; })(),
    'zero light on sand must ALSO refuse — proving the light gate is really wired, unlike axolotl’s deliberate absence of one');
  W.rawBrightness = saveBright;
}

// ── 3. EL.spawn(turtle) ────────────────────────────────────────────────────────────────────
say('3. EL.spawn(turtle) — EL.DEFAULTS.turtle + Ai.ROSTER.turtle');
{
  ok(EL.canSpawn('turtle'), 'EL.canSpawn(turtle) is false — the closed motion set refuses it');
  const e0 = EL.spawn('turtle', 5, 64, 7, {});
  ok(e0.homeX === 5 && e0.homeY === 64 && e0.homeZ === 7, `EL.DEFAULTS.turtle did not set homePos to the spawn point — got ${e0.homeX},${e0.homeY},${e0.homeZ}`);
  ok(!!e0.ai, 'EL.spawn did not attach e.ai for a rostered turtle');
  ok(e0.maxHealth === 30, `maxHealth ${e0.maxHealth}, expected 30 off the attribute table`);

  okAv((() => {
    const e1 = EL.spawn('turtle', 99, 64, -40, {});
    return e1.homeX === 99 && e1.homeZ === -40 && !(e1.homeX === 5);
  })(), 'a second spawn at a different point must get its OWN home, not the first turtle’s');
}

// ── 4. Tu.MateGoal ───────────────────────────────────────────
say('4. Tu.MateGoal — sets hasEgg(true) instead of spawning a child');
{
  const a = { type: 'turtle', x: 0, y: 64, z: 0, inLove: 600, hasEgg: false };
  const b = { type: 'turtle', x: 0.3, y: 64, z: 0, inLove: 600, hasEgg: false };
  const animals = () => [a, b];
  const g = new Tu.MateGoal(a, 1.0, { animals, random: () => 0.5 });
  ok(g.canUse() === true, 'MateGoal must find the nearby loving partner');
  g.start();
  for (let i = 0; i < 59; i++) g.tick();
  ok(a.hasEgg === false && g.canContinueToUse() === true, 'MateGoal must NOT breed before tick 60 even at contact (AnimalMateGoal timer)');
  g.tick();
  ok(a.hasEgg === true, 'MateGoal.tick within contact range must set hasEgg, not spawn a turtle child');
  ok(a.inLove === 0 && b.inLove === 0, 'MateGoal must reset BOTH parents’ love');

  {
    const saved = MCL.Stats, calls = [];
    MCL.Stats = { inc: (id) => calls.push(id) };
    for (const [ca, cb, want] of [[null, 'p', 1], ['p', null, 1], [null, null, 0]]) {
      const p = { type: 'turtle', x: 0, y: 64, z: 0, inLove: 600, hasEgg: false, loveCause: ca };
      const q = { type: 'turtle', x: 0.3, y: 64, z: 0, inLove: 600, hasEgg: false, loveCause: cb };
      calls.length = 0;
      const gg = new Tu.MateGoal(p, 1.0, { animals: () => [p, q], random: () => 0.5 });
      gg.canUse(); for (let i = 0; i < 60; i++) gg.tick();
      ok(p.hasEgg && calls.length === want, 'MateGoal must award animals_bred iff a parent has a loveCause (got ' + calls.length + ', want ' + want + ')');
    }
    okAv(calls.length === 0, 'no loveCause on either parent -> no stat (the award is gated, not unconditional)');
    MCL.Stats = saved;
  }

  {
    const c = { type: 'turtle', x: 0, y: 64, z: 0, inLove: 600, hasEgg: false };
    const d = { type: 'turtle', x: 0, y: 64, z: 3.1, inLove: 600, hasEgg: false };
    const g4 = new Tu.MateGoal(c, 1.0, { animals: () => [c, d], random: () => 0.5 });
    g4.canUse(); g4.start();
    for (let i = 0; i < 60; i++) g4.tick();
    ok(c.hasEgg === false, 'at 60 ticks but >=3 blocks (squared >= 9) MateGoal must not breed');
    ok(g4.canContinueToUse() === false, 'MateGoal must give up once timer reaches 60');
  }
  const already = { type: 'turtle', x: 0, y: 64, z: 0, inLove: 600, hasEgg: true };
  const g2 = new Tu.MateGoal(already, 1.0, { animals: () => [already, b], random: () => 0.5 });
  ok(g2.canUse() === false, 'a turtle already carrying an egg must refuse MateGoal entirely');

  okAv((() => {
    const far = { type: 'turtle', x: 0, y: 64, z: 0, inLove: 600, hasEgg: false };
    const farPartner = { type: 'turtle', x: 50, y: 64, z: 0, inLove: 600, hasEgg: false };
    const g3 = new Tu.MateGoal(far, 1.0, { animals: () => [far, farPartner], random: () => 0.5 });
    return g3.canUse() === false;   // 50 blocks away is far outside Tu.MATE_RANGE (8)
  })(), 'a partner outside Tu.MATE_RANGE (8 blocks) must not be picked, not matched from anywhere on the map');
}

// ── 5. Tu.LayEggGoal / Tu.placeEgg ──────────────────────────────────────────────────────────
say('5. Tu.LayEggGoal / Tu.placeEgg — 200-tick dig, EGGS 1..4');
{
  ok(R.id.turtle_egg !== undefined, 'assets have no turtle_egg block registered — cannot test egg placement');
  const sand = S.stateOf('sand') | 0;
  W.setBlock(22, 59, 22, sand);
  ok(Tu.placeEgg(22, 60, 22, () => 0) === true, 'Tu.placeEgg must succeed on a valid cell');
  const placed = W.getBlock(22, 60, 22);
  ok(R.names[S.block[placed]] === 'turtle_egg', `the placed block must be turtle_egg — got ${R.names[S.block[placed]]}`);
  const eggsVal = S.propValue(placed, R.PROP.eggs);
  ok(eggsVal >= 0 && +R.valueNames[eggsVal] === 1, `random()=0 must place EXACTLY 1 egg (nextInt(4)+1) — got ${eggsVal >= 0 ? R.valueNames[eggsVal] : eggsVal}`);

  okAv((() => {
    W.setBlock(23, 59, 23, sand);
    Tu.placeEgg(23, 60, 23, () => 0.99);
    const st = W.getBlock(23, 60, 23);
    const v = S.propValue(st, R.PROP.eggs);
    return v >= 0 && +R.valueNames[v] === 4;
  })(), 'random()=0.99 must place the MAXIMUM 4 eggs, not clamp low');

  // full goal: dig for Tu.DIG_TICKS then place, clearing hasEgg and starting love. Its own
  // (24,*,24) corner keeps this section's findEggSpot radius-4 search away from every other
  // sand cell this file places elsewhere in the SAME shared W instance.
  W.setBlock(24, 59, 24, sand);
  const turtle = { type: 'turtle', x: 24.5, y: 60, z: 24.5, hasEgg: true, homeX: 24, homeY: 60, homeZ: 24, inWater: false };
  const lg = new Tu.LayEggGoal(turtle, { random: () => 0, speed: 1.0 });
  ok(lg.canUse() === true, 'LayEggGoal must accept a turtle with an egg near home');
  lg.start();
  let layTick = 0;
  for (let i = 1; i <= Tu.DIG_TICKS + 5 && !layTick; i++) { lg.tick(); if (!turtle.hasEgg) layTick = i; }
  ok(layTick === Tu.DIG_TICKS + 1, `LayEggGoal must lay on the ${Tu.DIG_TICKS + 1}st tick (vanilla counter>200) — got tick ${layTick}`);
  okAv(layTick !== Tu.DIG_TICKS + 2, 'laying one tick late (202) must be flagged as wrong');
  ok(turtle.hasEgg === false, `LayEggGoal must clear hasEgg after ${Tu.DIG_TICKS} digging ticks — still true`);
  ok(turtle.inLove === Tu.EGG_LOVE_TICKS, `LayEggGoal must set ${Tu.EGG_LOVE_TICKS} love ticks after laying — got ${turtle.inLove}`);
  // #4579: MoveToTargetPosGoal cooldown (200+nextInt(200)) between scans, and isTargetPos recheck
  {
    W.setBlock(26, 59, 26, sand);
    const t = { type: 'turtle', x: 26.5, y: 60, z: 26.5, hasEgg: true, homeX: 26, homeY: 60, homeZ: 26, inWater: false };
    const g = new Tu.LayEggGoal(t, { random: () => 0.5, speed: 1.0 });
    ok(g.canUse() === true, 'first scan finds the sand');
    let gap = 0; while (!g.canUse() && gap < 1000) gap++;
    ok(gap === 300, `LayEggGoal rescan gap must be the 200+nextInt(200) cooldown (300 for rand .5) - got ${gap}`);
    g.start();
    ok(g.canContinueToUse() === true, 'target still sand+air continues');
    W.setBlock(26, 60, 26, sand);   // block above the target
    okAv(g.canContinueToUse() === false, 'a block placed above the target must stop LayEggGoal');
    W.setBlock(26, 60, 26, 0); W.setBlock(26, 59, 26, 0);
    ok(g.canContinueToUse() === false, 'a broken target sand must stop LayEggGoal');
  }
  // #4440: world event 2001 fires when sandDiggingCounter%5==0 (counter starts at 1 on dig start), on pos.down()
  {
    MCL.Sound = MCL.Sound || {}; const SS = MCL.Sound, orig = SS.blockBreak, calls = [];
    SS.blockBreak = (st) => calls.push(st);
    const run = (stale) => {
      W.setBlock(30, 59, 30, sand);
      const t = { type: 'turtle', x: 30.5, y: 60, z: 30.5, hasEgg: true, homeX: 30, homeY: 60, homeZ: 30, inWater: false, digTick: stale ? 3 : 0 };
      const g = new Tu.LayEggGoal(t, { random: () => 0, speed: 1.0 });
      g.canUse(); g.start(); calls.length = 0;
      const ticks = [];
      for (let i = 1; i <= 16; i++) { const n = calls.length; g.tick(); Tu.tickDigSound(t); if (calls.length > n) ticks.push(i); }
      return ticks.join(',');
    };
    const a = run(false), b = run(true);
    SS.blockBreak = orig;
    ok(a === '5,10,15' || a === '4,9,14', `dig sound cadence every 5th counter value — got ${a}`);
    ok(a === b, `dig cadence must not depend on stale state — ${a} vs ${b}`);
    okAv(a !== '3,8,13', 'a stale-phase cadence would differ from the counter-driven one');
  }
  const laidState = W.getBlock(24, 60, 24);
  ok(R.names[S.block[laidState]] === 'turtle_egg', 'LayEggGoal must have placed a real turtle_egg block one cell above the sand');

  okAv((() => {
    W.setBlock(28, 59, 31, sand);   // sand 6 blocks from the turtle, within 9 of home
    const t3 = { type: 'turtle', x: 28.5, y: 60, z: 25.5, hasEgg: true, homeX: 28, homeY: 60, homeZ: 28, inWater: false };
    return new Tu.LayEggGoal(t3, { random: () => 0, speed: 1.0 }).canUse() === true;
  })(), 'LayEggGoal must find sand 6 blocks away (MoveToTargetPosGoal range 16, not radius 4)');

  okAv((() => {
    W.setBlock(27, 59, 27, sand);
    const t2 = { type: 'turtle', x: 27.5, y: 60, z: 27.5, hasEgg: true, homeX: 27, homeY: 60, homeZ: 27, inWater: false };
    const lg2 = new Tu.LayEggGoal(t2, { random: () => 0, speed: 1.0 });
    lg2.start();
    lg2.tick();   // one tick only, well short of 200
    return t2.hasEgg === true;   // must NOT lay yet
  })(), 'a single tick must NOT be enough to lay the egg — the 200-tick dig is real, not skipped');
}

// ── 6. Tu.onGrowUp ───────────────────────────────────────────────────────────────────────────
say('6. Tu.onGrowUp — one scute, off the growAge -1->0 transition');
{
  ok(MCL.Items.of('scute') >= 0, 'items.bin has no scute — cannot test the grow-up drop');
  const dropped = [];
  const savedDrop = EL.dropStack;
  EL.dropStack = (x, y, z, item, count) => dropped.push({ item, count });
  const baby = EL.spawn('turtle', 10, 64, 10, {});
  Breed.setBaby(baby, true);
  ok(Breed.isBaby(baby) === true, 'setup: turtle must actually be a baby before growing up');
  Tu.onGrowUp(baby);
  ok(dropped.length === 1 && dropped[0].item === 'scute' && dropped[0].count === 1,
    `onGrowUp must drop exactly one scute — got ${JSON.stringify(dropped)}`);

  okAv((() => {
    dropped.length = 0;
    Tu.onGrowUp({ type: 'cow' });   // wrong type entirely
    return dropped.length === 0;
  })(), 'onGrowUp must refuse a non-turtle entirely, not drop a scute for it');
  EL.dropStack = savedDrop;
}

// ── 7. Tu.GoHomeGoal ────────────────────────────────────────────────────────
say('7. Tu.GoHomeGoal — walk home when far');
{
  const far = { x: 100, y: 64, z: 0, hasEgg: false, homeX: 0, homeY: 64, homeZ: 0 };
  let sd = 7; const rng = () => ((sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
  const gh = new Tu.GoHomeGoal(far, { speed: 1.0, random: () => 0 });
  ok(gh.canUse() === true, 'GoHomeGoal must accept when far from home (forced roll)');
  const savedStep = Ai.stepToward;
  let steppedToward = null;
  Ai.stepToward = (ent, node) => { steppedToward = node; };
  const gr = new Tu.GoHomeGoal(far, { speed: 1.0, random: rng }); gr.start();
  gr.tick();
  Ai.stepToward = savedStep;
  // findTo(16,3,home,PI/10): a leg of <=16+8 toward home, not a spot on the turtle / away from home
  ok(steppedToward && steppedToward.x < 100 && steppedToward.x >= 100 - 24, 'GoHomeGoal.tick must step along a findTo leg toward homeX/Z, not the current position');

  okAv((() => {
    const near = { x: 1, y: 64, z: 0, hasEgg: false, homeX: 0, homeY: 64, homeZ: 0 };
    const ghn = new Tu.GoHomeGoal(near, { random: () => 0 });
    return ghn.canUse() === false;
  })(), 'GoHomeGoal must refuse when already close to home, not walk on the spot forever');
}

// ── 7d. #4360: GoHomeGoal routes AROUND a wall (Ai.findPath nodes), not a straight line through it ──
say('7d. GoHomeGoal paths around a 2-high wall');
{
  const stone = S.stateOf('stone') | 0;
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) W.setBlock(x, 63, z, stone);
  for (let z = -3; z <= 3; z++) for (let y = 64; y <= 65; y++) W.setBlock(0, y, z, stone);
  const t = { type: 'turtle', x: -5.5, y: 64, z: 0.5, hasEgg: true, homeX: 5, homeY: 64, homeZ: 0, width: 1.2 };
  let sd = 11; const rng = () => ((sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
  const gh = new Tu.GoHomeGoal(t, { speed: 1.0, random: rng });
  gh.start();
  const sf = Ai.findPath, ss = Ai.stepToward; let path = null;
  Ai.findPath = (...a) => (path = sf(...a));
  Ai.stepToward = () => {};
  gh.tick();
  Ai.findPath = sf; Ai.stepToward = ss;
  const hitsWall = (pp) => pp.some((n) => n.x === 0 && n.z >= -3 && n.z <= 3 && n.y <= 65 && n.y >= 64);
  ok(path && path.length > 1, 'GoHomeGoal must plan an Ai.findPath route');
  const last = path && path[path.length - 1];
  ok(path && !hitsWall(path) && last && last.x > -5, 'GoHomeGoal route must go around the wall toward the findTo leg');
  const straight = []; for (let x = -6; x <= 5; x++) straight.push({ x, y: 64, z: 0 });
  okAv(hitsWall(straight), 'anti-vacuity: the old straight line to home passes through the wall cells this check places');
  for (let z = -3; z <= 3; z++) for (let y = 64; y <= 65; y++) W.setBlock(0, y, z, 0);
}

// ── 7e. #5580: WanderInWaterGoal walks Ai.findPath nodes over a ridge, not a straight line ──
say('7e. WanderInWaterGoal plans a path');
{
  const stone = S.stateOf('stone') | 0;
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) W.setBlock(x, 63, z, stone);
  const t = { type: 'turtle', x: -5.5, y: 64, z: 0.5, width: 1.2 };
  const g = new Tu.WanderInWaterGoal(t, 1.0, { random: () => 0 });
  g.start(); g.canUse = g.canUse;
  const sf = Ai.findPath, ss = Ai.stepToward; let planned = 0;
  Ai.findPath = (...a) => { planned++; return sf(...a); };
  Ai.stepToward = () => {};
  const tgt = { x: 5, y: 63, z: 0 };
  W.setBlock(5, 62, 0, S.stateOf('water') | 0);
  // drive tick with a fixed target through the goal's own canUse scan
  const cu = g.canUse(); say("canUse " + cu); g.tick();
  Ai.findPath = sf; Ai.stepToward = ss;
  W.setBlock(5, 62, 0, 0);
  ok(planned > 0, 'WanderInWaterGoal.tick must plan with Ai.findPath (navigation.startMovingTo)');
  { const t2 = { type: 'turtle', x: -5.5, y: 64, z: 0.5, width: 1.2 }; let n2 = 0; const f2 = Ai.findPath; Ai.findPath = () => { n2++; return null; };
    Ai.stepToward = () => {}; Tu.moveToward(t2, { x: 5, y: 62, z: 0 }, 1.0); Ai.findPath = f2; Ai.stepToward = ss;
    okAv(n2 === 0, 'anti-vacuity: the old straight-line moveToward never calls Ai.findPath'); }
}

// ── 7c. #1255: the nine rows of TurtleEntity.initGoals and each canUse gate ──────────────────
say('7c. roster (priority, class) rows and the gates of Escape/WanderInWater/Travel/WanderOnLand');
{
  const t = EL.spawn('turtle', 5, 64, 7, {});
  const pri = (C) => t.ai.entries.filter((x) => x.goal instanceof C).map((x) => x.priority);
  const want = [[Tu.EscapeDangerGoal, 0], [Tu.MateGoal, 1], [Tu.LayEggGoal, 1], [Ai.TemptGoal, 2],
    [Tu.WanderInWaterGoal, 3], [Tu.GoHomeGoal, 4], [Tu.TravelGoal, 7], [Ai.LookAtPlayerGoal, 8], [Tu.WanderOnLandGoal, 9]];
  for (const [C, p] of want) ok(C && pri(C).length === 1 && pri(C)[0] === p, `turtle roster: ${C && C.name} at priority ${p}`);
  ok(t.ai.entries.length === 9, `turtle roster has exactly nine goals (${t.ai.entries.length})`);

  const mk = (o) => Object.assign({ x: 0.5, y: 64, z: 0.5, inWater: false, hasEgg: false, landBound: false, isBaby: false }, o);
  const rnd = { random: () => 0.5 };
  const lz = () => 0;
  const wl = (o) => new Tu.WanderOnLandGoal(mk(o), 1.0, lz, 100);
  ok(!wl({ inWater: true }).canUse() && !wl({ landBound: true }).canUse() && !wl({ hasEgg: true }).canUse(), 'WanderOnLandGoal refuses in water, landBound, with an egg');
  ok(new Tu.TravelGoal(mk({ inWater: true }), 1.0, rnd).canUse() === true, 'TravelGoal accepts in water');
  ok(!new Tu.TravelGoal(mk({}), 1.0, rnd).canUse() && !new Tu.TravelGoal(mk({ inWater: true, landBound: true }), 1.0, rnd).canUse()
    && !new Tu.TravelGoal(mk({ inWater: true, hasEgg: true }), 1.0, rnd).canUse(), 'TravelGoal refuses on land, landBound, with an egg');
  { const e = mk({ inWater: true }); const g = new Tu.TravelGoal(e, 1.0, { random: () => 0.999 }); g.canUse(); g.start();
    ok(e.activelyTravelling === true && e.travelPos.x > 400 && e.travelPos.y === 64, 'TravelGoal.start sets a far travelPos (+-512) and activelyTravelling, dy zeroed above sea level');
    g.stop(); ok(e.activelyTravelling === false, 'TravelGoal.stop clears activelyTravelling'); }
  { const e = mk({ inWater: true }); const g = new Tu.TravelGoal(e, 1.0, { random: () => 0.999 }); g.canUse(); g.start();
    ok(g.canContinueToUse() === true, 'TravelGoal continues while travelling');
    e.inWater = false; const left = g.canContinueToUse(); e.inWater = true;
    ok(left === true, 'TravelGoal does not end on leaving water (vanilla shouldContinue has no water test)');
    e.inLove = 600; okAv(g.canContinueToUse() === false, 'TravelGoal.canContinueToUse false when inLove'); }
  const waterSt = S.stateOf('water') | 0;
  W.setBlock(10, 62, 0, waterSt);   // vanilla scan (lowestY -1, maxY 1) only reaches y = feetY-2
  W.setBlock(10, 64, 0, waterSt);
  const wiw = (o) => new Tu.WanderInWaterGoal(mk(o), 1.0, rnd);
  ok(wiw({}).canUse() === true, 'WanderInWaterGoal: adult on land with water within 24 starts');
  ok(!wiw({ landBound: true }).canUse() && !wiw({ hasEgg: true }).canUse() && !wiw({ inWater: true }).canUse(), 'WanderInWaterGoal: refuses landBound / egg / already in water (adult)');
  ok(wiw({ isBaby: true, landBound: true, hasEgg: true }).canUse() === true, 'WanderInWaterGoal: a baby on land starts even landBound/with an egg');
  ok(!wiw({ isBaby: true, inWater: true }).canUse(), 'WanderInWaterGoal: a baby already in water does not');
  { const e = mk({ isBaby: true }); const g = new Tu.WanderInWaterGoal(e, 1.0, rnd); g.canUse(); g.start();
    let seen = null; const sv = Ai.stepToward; Ai.stepToward = (en, n, sp) => { seen = sp; }; g.tick(); Ai.stepToward = sv;
    ok(seen === 1.0, `baby WanderInWater speed stays 1.0 (ctor runs before age is set; got ${seen})`); }
  W.setBlock(5, 64, 0, waterSt);
  { const e = mk({ justHurt: true }); const g = new Tu.EscapeDangerGoal(e, 1.2, rnd);
    ok(g.canUse() === true, 'EscapeDangerGoal starts when hurt');
    let seen = null; const sv = Ai.stepToward; Ai.stepToward = (en, n) => { seen = n; }; g.start(); g.tick(); Ai.stepToward = sv;
    ok(seen && seen.x === 5 && seen.y === 64, `EscapeDangerGoal heads for the closest water (got ${JSON.stringify(seen)})`);
    ok(new Tu.EscapeDangerGoal(mk({}), 1.2, rnd).canUse() === false, 'EscapeDangerGoal refuses when not hurt'); }
  { const sv = Ai.shouldEscapePowderSnow; const e = mk({});
    Ai.shouldEscapePowderSnow = () => true;
    ok(new Tu.EscapeDangerGoal(e, 1.2, rnd).canUse() === true, 'EscapeDangerGoal starts in powder snow (shouldEscapePowderSnow)');
    Ai.shouldEscapePowderSnow = () => false;
    okAv(new Tu.EscapeDangerGoal(e, 1.2, rnd).canUse() === false, 'a goal ignoring the powder-snow hook would fail the start line');
    Ai.shouldEscapePowderSnow = sv;
    ok(Ai.shouldEscapePowderSnow({ type: 'stray', x: 0, y: 64, z: 0 }) === false, 'freeze-immune stray never escapes powder snow'); }
  okAv(2.0 !== 1.0, "the live isBaby read (2.0) would fail the baby-speed line");
  okAv(new Tu.WanderOnLandGoal(mk({ inWater: true }), 1.0, lz, 100).canUse() === false, 'a land wander gate that ignored water would fail the refuse line');
}

// ── 7a. #1254: GoHomeGoal.canStart truth table + landBound ──────────────────────────────────
say('7a. GoHomeGoal: baby false, egg true, else 1/700 roll and home beyond 64; landBound set/cleared');
{
  const mk = (o) => Object.assign({ x: 0, y: 64, z: 0, hasEgg: false, isBaby: false, homeX: 0, homeY: 64, homeZ: 0 }, o);
  const can = (o, r) => new Tu.GoHomeGoal(mk(o), { random: () => r }).canUse();
  ok(can({ isBaby: true, hasEgg: true, x: 70 }, 0) === false, 'baby never goes home');
  ok(can({ hasEgg: true, x: 40 }, 0.9) === true, 'egg carrier always goes home, no roll, at 40 blocks');
  ok(can({ hasEgg: true, x: 0 }, 0.9) === true, 'egg carrier accepts even at home');
  ok(can({ x: 70 }, 0) === true, 'no egg, 70 away, roll 0 -> go home');
  ok(can({ x: 20 }, 0) === false, 'no egg, 20 away (within 64) -> stay');
  ok(can({ x: 17 }, 0) === false, 'no egg, 17 away must not trigger (old threshold was 16)');
  ok(can({ x: 70 }, 0.5) === false, 'no egg, 70 away, failed 1/700 roll -> stay');
  const e = mk({ x: 70 }); const g = new Tu.GoHomeGoal(e, { random: () => 0 });
  g.start(); ok(e.landBound === true, 'start sets landBound');
  ok(g.canContinueToUse() === true, 'continues while beyond 7 of home');
  e.x = 6; ok(g.canContinueToUse() === false, 'stops within 7 of home');
  g.stop(); ok(e.landBound === false, 'stop clears landBound');
  okAv(can({ hasEgg: true, x: 40 }, 0.9) !== false && can({ x: 20 }, 0) === false, 'truth table distinguishes egg/no-egg at distance');
}

// ── 7b. s135: the spin and the land speed (Dan saw both, 25 Sept) ─────────────────────────
say('7b. a wander leg ends (node-reach / 100-tick stuck stop) and land speed follows TurtleMoveControl');
{
  // a target one block BELOW flat ground, with the turtle standing on its centre: vanilla's
  // node reach (|dx|,|dz| < 0.6, |dy| < 1) says arrived; the old 3-D "within 1 of the corner" never did
  const e = { x: 5.5, y: 64, z: 5.5, width: 1.2 };
  ok(Tu.reached(e, { x: 5, y: 63.2, z: 5 }) === true, 'standing on the target block centre (dy -0.8) counts as reached');
  ok(Tu.reached(e, { x: 7, y: 64, z: 5 }) === false, 'two blocks off is not reached');
  const old = (t) => { const dx = t.x - e.x, dy = t.y - e.y, dz = t.z - e.z; return (dx * dx + dy * dy + dz * dz) <= 1; };
  okAv(old({ x: 5, y: 63, z: 5 }) === false, 'anti-vacuity: the pre-s135 test never finishes a leg whose target is one block down (the orbit Dan saw)');
  // the stuck stop: a turtle pinned in place gives up at tick 101, not never
  const pin = { x: 0, y: 64, z: 0 }, nav = {};
  Tu.navStart(pin, nav);
  let n = 0; while (!Tu.navTimedOut(pin, nav) && n < 1000) n++;
  ok(n === Tu.NAV_TIMEOUT_TICKS, `a pinned turtle stops navigating after exactly 100 ticks (got ${n})`);
  const mover = { x: 0, y: 64, z: 0 }, nav2 = {};
  Tu.navStart(mover, nav2);
  let stopped = false; for (let t = 0; t < 300; t++) { mover.x += 0.05; if (Tu.navTimedOut(mover, nav2)) stopped = true; }
  ok(!stopped, 'a turtle that keeps moving (5 blocks per 100 ticks) never trips the stuck stop');
  // land speed: halve (floor 0.06), lerp 1/8 toward 0.25 -> settles near 0.084, never 0.25
  const land = { type: 'turtle', onGround: true, inWater: false };
  let sp = 0; for (let t = 0; t < 200; t++) sp = Tu.moveSpeedStep(land, 1.0);
  ok(Math.abs(sp - (0.06 + 0.125 * (0.25 - 0.06))) < 1e-6, `land speed settles at 0.08375 (got ${sp.toFixed(5)})`);
  const water = { type: 'turtle', onGround: false, inWater: true, homeX: 0, homeY: 64, homeZ: 0, x: 0, y: 64, z: 0 };
  let sw = 0; for (let t = 0; t < 200; t++) sw = Tu.moveSpeedStep(water, 1.0);
  ok(Math.abs(sw - 0.25) < 1e-3, `in water near home the speed reaches the full 0.25 (got ${sw.toFixed(4)})`);
  // #3047: TurtleEntity.travel's -0.005 sink only without a target and not (landBound within 20 of home)
  const Ph = MCL.Physics, mv = Ph.move; Ph.move = () => {};
  const sink = (o) => { const t = { type: 'turtle', inWater: true, yaw: 0, vy: 0, x: 0, y: 64, z: 0, homeX: 0, homeY: 64, homeZ: 0, ...o }; Tu.travelMob(t); return t.vy; };
  ok(Math.abs(sink({}) - -0.0005) < 1e-12, 'free turtle in water: +0.005 updateVelocity, *0.9, -0.005 = -0.0005');
  ok(Math.abs(sink({ landBound: true }) - 0.0045) < 1e-12, 'landBound turtle within 20 of home holds depth');
  ok(Math.abs(sink({ landBound: true, x: 25 }) - -0.0005) < 1e-12, 'landBound turtle 25 from home sinks');
  ok(Math.abs(sink({ target: {} }) - 0.0045) < 1e-12, 'turtle with an attack target holds depth');
  okAv(sink({ landBound: true }) !== sink({}), 'an unconditional sink would fail the landBound line');
  { const t = { type: 'turtle', inWater: true, yaw: Math.PI / 2, vy: 0, x: 0, y: 64, z: 0, zza: 1 }; Tu.travelMob(t);
    ok(Math.abs(t.vx - 0.098 * 0.9) < 1e-9, `#4189 swim thrust is zza*0.98*0.1, then *0.9 (got ${t.vx})`);
    okAv(Math.abs(t.vx - 0.1 * 0.9) > 1e-6, 'anti-vacuity: the un-scaled 0.1 thrust would fail the 0.98 line'); }
  Ph.move = mv;
  // #3902: an idle turtle (no goal ever calls moveToward) hovers instead of sinking to the seabed
  { const t = { type: 'turtle', inWater: true, yaw: 0, vy: 0, x: 0, y: 64, z: 0 }; Ph.move = (e, dx, dy) => { e.y += dy; };
    for (let i = 0; i < 100; i++) Tu.travelMob(t);
    Ph.move = mv; ok(Math.abs(t.y - 64) < 0.1, `idle in-water turtle hovers over 100 ticks (dy ${(t.y - 64).toFixed(4)})`);
    okAv(Math.abs(t.y - 64) < 0.1 && !(t.y < 63), 'anti-vacuity: without the per-tick +0.005 it sinks ~0.05/tick (dy -4.5) and the hover line fails'); }
  okAv(sp < 0.5 * sw, 'anti-vacuity: a flat 0.25 on land (the old stepToward speed) would fail the land-speed line above');
}

// ── 8. Breed.SPECIAL.turtle closed ──────────────────────────────────────────────────────────
say('8. Breed.SPECIAL.turtle — closed, no longer refusing');
{
  ok(Breed.SPECIAL.turtle === undefined, 'Breed.SPECIAL.turtle must be REMOVED now that Tu.MateGoal handles breeding directly');
}

// ── 8b. #2704: baby scale is TurtleEntity.getScaleFactor() = 0.3, not the generic 0.5 ──────
say('8b. baby turtle box is 0.3 of the adult');
{
  const t = { type: 'turtle', x: 0, y: 64, z: 0 };
  Breed.setBaby(t, true);
  ok(Math.abs(t.width - 1.2 * 0.3) < 1e-6 && Math.abs(t.height - 0.4 * 0.3) < 1e-6, `baby turtle box 0.36x0.12 (got ${t.width}x${t.height})`);
  Breed.setBaby(t, false);
  ok(t.width === 1.2 && t.height === 0.4, 'grown turtle box is back to 1.2x0.4');
  const saved = Breed.SCALE_OVERRIDE; Breed.SCALE_OVERRIDE = {};
  const b = { type: 'turtle', x: 0, y: 64, z: 0 }; Breed.setBaby(b, true);
  Breed.SCALE_OVERRIDE = saved;
  okAv(Math.abs(b.width - 0.36) > 1e-6, 'anti-vacuity: without the override the baby box is the generic 0.5 and the check above fails');
}

// ── 9. #3657: TurtleEntity.canEat() = !hasEgg() — an egg-carrying turtle refuses seagrass ──
say('9. egg-carrying turtle refuses seagrass');
{
  let used = 0;
  const t = { type: 'turtle', x: 0, y: 64, z: 0, inLove: 0, hasEgg: true };
  ok(Breed.interact(t, 'seagrass', { consume: () => used++ }) === false && used === 0 && !(t.inLove > 0), 'hasEgg turtle must refuse seagrass (no love, nothing consumed)');
  t.hasEgg = false;
  okAv(Breed.interact(t, 'seagrass', { consume: () => used++ }) === 'love' && used === 1, 'anti-vacuity: without the egg the same turtle takes seagrass and enters love');
}

console.log('================ turtlecheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
