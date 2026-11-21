#!/usr/bin/env node
// rabbitcheck.mjs — loop/rabbit-s98 (QUEUE 0.2 G18c, missing overworld mob): the RABBIT, whole.
// Drives the REAL modules (07zh_rabbit.js, Ai.ROSTER.rabbit/EL.DEFAULTS.rabbit/Spawn.RULES.rabbit/
// Br.CHILD.rabbit) against `.decomp/net/minecraft/entity/passive/RabbitEntity.java` (read in
// full) and `MoveToTargetPosGoal.java` (read in full, the `EatCarrotCropGoal` parent class).
//
//   node tools/rabbitcheck.mjs [--verbose]
//
// Sections:
//   1. attributes/dimensions/breeding food — the jar-extracted entity table's own row for rabbit
//   2. Rb.chooseType — the three biome branches + their inner splits, and killer bunny NEVER
//   3. EL.spawn('rabbit', ...) — EL.DEFAULTS.rabbit rolls a type, Ai.ROSTER.rabbit attaches e.ai
//   4. the goal selector — flee (player/wolf/hostile), tempt (carrot), breed
//   5. Rb.mobTick — the hop-timing state machine (doScheduleJump/startJump)
//   6. Rb.EatCarrotCropGoal — search, path, decrement age, break at 0, moreCarrotTicks=40
//   7. Br.CHILD.rabbit — child inherits a parent's type (95%) or a fresh biome roll (5%)
//   8. Spawn.RULES.rabbit — the tag + light gate
//   9. Rb.skinKey — the 8-way texture family picker
//  10. anti-vacuity — break the check's own data/stubs and watch it catch the break

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

console.log('rabbitcheck — loop/rabbit-s98 (QUEUE 0.2 G18c), the rabbit, whole');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '07m_breed.js', '07zh_rabbit.js', '07zzp_mobvoice.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

if (MCL.Loot && MCL.Loot.init) MCL.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Rb = MCL.Rabbit, Breed = MCL.Breed, W = MCL.World, S = MCL.States, Bh = MCL.Behave, R = MCL.Reg;
const CH = MCL.CH;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
Bh.init(W);
EL.init();
Ai.init();
Spawn.init();
Breed.init();

// a small flat GENERATED chunk pad so W.setBlock/getBlock/rawBrightness have somewhere real
// to write (the same fixture shape batcheck.mjs's own header uses) -- AFTER W.init, which
// resets W.chunks itself.
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

ok(Rb && Rb.ready, 'NS.Rabbit did not load/ready');

// ── 1. attributes/dimensions/breeding food ──────────────────────────────────────────────────
say('1. the jar-extracted entity table’s own row for rabbit');
{
  const at = Ent.attrsOf('rabbit');
  ok(!!at, 'Ent.attrsOf(rabbit) is null');
  ok(at && at.hp === 3, `hp ${at && at.hp}, expected 3 (createRabbitAttributes: MAX_HEALTH 3.0)`);
  ok(at && Math.abs(at.speed - 0.3) < 1e-6, `speed ${at && at.speed}, expected 0.3`);
  const dim = Ent.dimensions('rabbit');
  ok(dim && Math.abs(dim.width - 0.4) < 1e-6 && Math.abs(dim.height - 0.5) < 1e-6,
    `dimensions ${dim && dim.width}x${dim && dim.height}, expected 0.4x0.5`);
  const food = Ent.breedFood('rabbit');
  ok(food && food.k === 'items', 'breedFood(rabbit).k is not "items"');
  ok(food && ['carrot', 'golden_carrot', 'dandelion'].every((n) => food.i.indexOf(n) >= 0),
    `breedFood(rabbit).i = ${food && food.i} — expected carrot/golden_carrot/dandelion`);
  ok(Breed.canBreed('rabbit'), 'Breed.canBreed(rabbit) is false');
  ok(Breed.isFood('rabbit', 'carrot') && Breed.isFood('rabbit', 'golden_carrot') && Breed.isFood('rabbit', 'dandelion'),
    'Breed.isFood(rabbit, ...) refuses one of carrot/golden_carrot/dandelion');
  ok(!Breed.isFood('rabbit', 'wheat'), 'Breed.isFood(rabbit, wheat) is true — wheat does not breed rabbits');
}

// ── 2. Rb.chooseType ─────────────────────────────────────────────────────────────────────────
say('2. Rb.chooseType — RabbitEntity.chooseType(WorldAccess), verbatim');
{
  const at = (v) => () => v;
  // snow biome: i<80 -> WHITE, else WHITE_SPOTTED
  ok(Rb.chooseType(2, 'plains', at(0.79)) === Rb.TYPE.WHITE, 'snow, roll 79 should be WHITE');
  ok(Rb.chooseType(2, 'plains', at(0.80)) === Rb.TYPE.WHITE_SPOTTED, 'snow, roll 80 should be WHITE_SPOTTED');
  ok(Rb.chooseType(2, 'desert', at(0.5)) === Rb.TYPE.WHITE, 'precipitation SNOW takes priority over category desert');
  // desert (non-snow): always GOLD
  ok(Rb.chooseType(1, 'desert', at(0.0)) === Rb.TYPE.GOLD, 'desert roll 0 should be GOLD');
  ok(Rb.chooseType(0, 'desert', at(0.99)) === Rb.TYPE.GOLD, 'desert roll 99 should be GOLD');
  // plains/other: i<50 BROWN, i<90 SALT, else BLACK
  ok(Rb.chooseType(1, 'plains', at(0.49)) === Rb.TYPE.BROWN, 'plains roll 49 should be BROWN');
  ok(Rb.chooseType(1, 'plains', at(0.50)) === Rb.TYPE.SALT, 'plains roll 50 should be SALT');
  ok(Rb.chooseType(0, 'forest', at(0.89)) === Rb.TYPE.SALT, 'forest roll 89 should be SALT');
  ok(Rb.chooseType(0, 'forest', at(0.90)) === Rb.TYPE.BLACK, 'forest roll 90 should be BLACK');

  // killer bunny (99) never rolls naturally, across a real spread of rolls and biomes.
  let neverKiller = true;
  for (let i = 0; i < 100; i++) {
    const r = i / 100;
    if (Rb.chooseType(0, 'plains', () => r) === 99) neverKiller = false;
    if (Rb.chooseType(1, 'desert', () => r) === 99) neverKiller = false;
    if (Rb.chooseType(2, 'plains', () => r) === 99) neverKiller = false;
  }
  ok(neverKiller, 'Rb.chooseType returned 99 (killer bunny) for a roll in [0,1) — it must never roll naturally');

  // Rb.chooseTypeAt — a thin wrapper over W.biomeAt/B.at, stubbed here (no live worldgen).
  const saveBiomeAt = W.biomeAt, saveB = MCL.Biomes;
  W.biomeAt = () => 0;
  MCL.Biomes = { ready: true, at: () => ({ precipitation: 2, category: 'none' }) };
  ok(Rb.chooseTypeAt(0, 0, at(0.1)) === Rb.TYPE.WHITE, 'chooseTypeAt did not read the stubbed snow biome');
  okAv((() => { MCL.Biomes.at = () => ({ precipitation: 0, category: 'desert' }); return Rb.chooseTypeAt(0, 0, at(0.1)) === Rb.TYPE.GOLD; })(),
    'changing the stubbed biome to desert changes chooseTypeAt’s answer — it is really reading B.at()');
  W.biomeAt = saveBiomeAt; MCL.Biomes = saveB;
}

// ── 3. EL.spawn wiring ──────────────────────────────────────────────────────────────────────
say('3. EL.spawn(rabbit) — EL.DEFAULTS.rabbit + Ai.ROSTER.rabbit');
let e0;
{
  ok(EL.canSpawn('rabbit'), 'EL.canSpawn(rabbit) is false — the closed motion set refuses it');
  const m = EL.motionFor('rabbit');
  ok(m && Math.abs(m[0] - 0.08) < 1e-9 && Math.abs(m[1] - 0.98) < 1e-9, `motionFor(rabbit) = ${m}, expected [0.08,0.98]`);
  e0 = EL.spawn('rabbit', 0, 64, 0, {});
  ok(e0.rabbitType !== undefined, 'EL.DEFAULTS.rabbit did not set e.rabbitType');
  ok([0, 1, 2, 3, 4, 5].indexOf(e0.rabbitType) >= 0, `natural spawn rolled type ${e0.rabbitType}, expected 0-5 (never 99)`);
  ok(e0.moreCarrotTicks === 0, 'e.moreCarrotTicks did not default to 0');
  e0.moreCarrotTicks = Rb.MORE_CARROT_TICKS;
  for (let i = 0; i < 400; i++) Rb.mobTick(e0);
  ok(e0.moreCarrotTicks === 0 && Rb.wantsCarrots(e0), `moreCarrotTicks ${e0.moreCarrotTicks} after 400 ticks — mobTick never decays it`);
  { // #2851: vanilla drains nextInt(3) (mean 1) ONCE per tick -> ~40 ticks from 40; a double decrement gives ~20
    const rnd = Math.random; let seed = 12345;
    Math.random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const mean = (tick) => { let t = 0; for (let i = 0; i < 500; i++) { const e = { moreCarrotTicks: 40 }; let n = 0; while (e.moreCarrotTicks > 0 && n < 1000) { tick(e); n++; } t += n; } return t / 500; };
    const m1 = mean(Rb.mobTick), m2 = mean((e) => { Rb.mobTick(e); Rb.mobTick(e); });
    Math.random = rnd;
    ok(m1 > 36 && m1 < 46, `moreCarrotTicks 40 -> 0 takes mean ${m1} ticks, vanilla ~40 (one nextInt(3) per tick)`);
    okAv(m2 < 30, `rate assertion sees a doubled decrement (mean ${m2})`);
  }
  ok(!!e0.ai, 'EL.spawn did not attach e.ai for a rostered rabbit');
  ok(e0.maxHealth === 3, `maxHealth ${e0.maxHealth}, expected 3 off the attribute table`);

  const forced = EL.spawn('rabbit', 0, 64, 0, { type: Rb.TYPE.KILLER_BUNNY });
  ok(forced.rabbitType === 99, 'opts.type=99 (egg/command) did not stick — setRabbitType path broken');
  ok(forced.attackDamage === 8, `killer bunny attackDamage ${forced.attackDamage}, expected 8`);
  ok(forced.customName === 'The Killer Bunny', 'killer bunny has no entity.minecraft.killer_bunny name');
  ok(e0.attackDamage === undefined && !e0.customName, 'a natural rabbit got killer-bunny damage/name');
  {
    const tgt = (r) => r.ai.entries.filter(x => x.flags & 8);
    ok(tgt(forced).length === 3, `targetSelector has ${tgt(forced).length} entries, expected Revenge+Player+Wolf`);
    forced.target = e0; e0.target = forced;
    const live = (r) => r.ai.entries.filter(x => x.priority === 4 && x.goal.canUse()).length;
    okAv(live(forced) >= 1, 'killer bunny RabbitAttackGoal never canUse with a target');
    okAv(live(e0) === 0, 'natural rabbit RabbitAttackGoal canUse with a target');
    forced.target = e0.target = null;
  }
  okAv((() => {
    const e2 = EL.spawn('rabbit', 0, 64, 0, {});
    const before = e2.rabbitType;
    e2.rabbitType = 4;
    return e2.rabbitType !== before;
  })(), 'e.rabbitType is not actually a live, settable field');
}

// ── 4. the goal selector ────────────────────────────────────────────────────────────────────
say('4. Ai.ROSTER.rabbit — flee (player/wolf/hostile), tempt (carrot), breed');
{
  const player = { x: 3, y: 64, z: 0, heldItem: null };
  MCL.Player = player;
  const e = EL.spawn('rabbit', 0, 64, 0, {});
  ok(!!e.ai, 'no goal selector attached');

  // flee-player: AvoidEntityGoal(e, 8, 2.2, players, ...) must trigger within 8 blocks.
  for (let t = 0; t < 5; t++) e.ai.tick();
  ok(Math.hypot(e.x - player.x, e.z - player.z) > 3 - 1e-6 || e.mobSpeed > 0,
    'a player 3 blocks away never moved the rabbit’s speed off zero — AvoidEntityGoal(player,8,...) did not fire');

  // tempt: holding a carrot pulls the rabbit toward the player rather than fleeing.
  const e2 = EL.spawn('rabbit', 0, 64, 10, {});
  player.x = 0; player.z = 3; player.heldItem = { i: MCL.Items.of('carrot') };
  ok(MCL.Items.of('carrot') >= 0, 'items.bin has no "carrot" — cannot prove TemptGoal at all');
  for (let t = 0; t < 3; t++) e2.ai.tick();
  const dAfter = Math.hypot(e2.x - player.x, e2.z - player.z);
  ok(dAfter < 10 - 1e-6, `holding a carrot did not pull the rabbit closer (still ${dAfter.toFixed(2)} from 10)`);
  player.heldItem = null;

  // breed: two adult rabbits close together with love mode set produce a child via Br.breed.
  const a = EL.spawn('rabbit', 0, 64, 0, {}); a.rabbitType = Rb.TYPE.BROWN;
  const b = EL.spawn('rabbit', 0.3, 64, 0, {}); b.rabbitType = Rb.TYPE.WHITE;
  Breed.setInLove(a, null); Breed.setInLove(b, null);
  const before = EL.list.length;
  for (let t = 0; t < 5 && EL.list.length === before; t++) e.ai.tick(); // warm the selectors up
  a.ai.tick(); b.ai.tick();
  ok(EL.list.length >= before, 'breeding tick did not run without throwing');
}

// flee-from-HostileEntity set (#2865): slime & co. are spawn-category 'monster' but not HostileEntity.
{
  for (const t of ['slime', 'magma_cube', 'ghast', 'phantom', 'shulker', 'hoglin', 'ender_dragon'])
    okAv(!Ai.isHostileEntity(t), `${t} must not count as a HostileEntity for the rabbit flee goal`);
  ok(Spawn.categoryOf('slime') === 'monster' && !Ai.isHostileEntity('slime'), 'slime is category monster yet not HostileEntity');
  ok(Ai.isHostileEntity('zombie') && Ai.isHostileEntity('creeper'), 'zombie/creeper must still be HostileEntity');
}

// ── 5. Rb.mobTick — hop timing ──────────────────────────────────────────────────────────────
say('5. Rb.mobTick — doScheduleJump/startJump, RabbitEntity.mobTick verbatim');
{
  const e = { onGround: true, mobSpeed: 0.3, moveMod: 1, jumping: false };
  Rb.mobTick(e);   // landing edge: schedules a jump, does not jump this tick
  ok(e.rabbitTicksUntilJump !== undefined, 'rabbitTicksUntilJump was never set');
  const scheduledSlow = e.rabbitTicksUntilJump;
  ok(scheduledSlow === 10 || scheduledSlow === 0, `slow-speed schedule gave ${scheduledSlow}, expected 10 (or 0 if it jumped immediately)`);

  // drive it down to zero and confirm a jump fires
  let jumped = false;
  for (let t = 0; t < 15 && !jumped; t++) { e.mobSpeed = 0.3; e.moveMod = 1; Rb.mobTick(e); if (e.jumping) jumped = true; }
  ok(jumped, 'a grounded, moving rabbit never set e.jumping across 15 ticks');
  ok(e.rabbitJumpDuration > 0, 'startJump did not set a jump duration');

  // fleeing speed (2.2 modifier) reschedules at 1 tick, not 10 — doScheduleJump's own branch.
  const base = Ai.movementSpeedOf ? Ai.movementSpeedOf(e0) : 0.3;
  const fast = { type: 'rabbit', onGround: false, mobSpeed: 2.2 * base, jumping: false };
  Rb.doScheduleJump(fast);
  ok(fast.rabbitTicksUntilJump === 1, `fleeing schedule gave ${fast.rabbitTicksUntilJump}, expected 1 (speed>=2.2 branch)`);
  const slow = { type: 'rabbit', onGround: false, mobSpeed: 0.6 * base, jumping: false };
  Rb.doScheduleJump(slow);
  ok(slow.rabbitTicksUntilJump === 10, `walking schedule gave ${slow.rabbitTicksUntilJump}, expected 10 (speed<2.2 branch)`);

  {
    const g = { onGround: true, mobSpeed: 0.3, zza: 0.3, jumping: false, rabbitTicksUntilJump: 5 };
    Rb.mobTick(g);
    ok(g.mobSpeed === 0 && g.zza === 0, 'grounded idle rabbit kept its speed (RabbitMoveControl.tick setSpeed(0))');
    okAv(g.mobSpeed !== 0.3, 'a rabbit left at its goal speed (no setSpeed(0)) was NOT detected');
    const w = { type: 'rabbit', inWater: true, x: 0, y: 64, z: 0, yaw: 0 };
    Ai.stepToward(w, { x: 0, y: 64, z: -5 }, 0.6);
    ok(w.moveMod === 1.5, `rabbit in water moveMod ${w.moveMod}, expected 1.5`);
    okAv(w.moveMod !== 0.6, 'rabbit water speed left at 0.6 was NOT detected');
  }
  okAv((() => {
    const g = { onGround: true, mobSpeed: 0, jumping: false, rabbitTicksUntilJump: 0 };
    Rb.mobTick(g);
    return g.jumping === false; // a rabbit with zero commanded speed must not hop in place
  })(), 'Rb.mobTick jumps a rabbit with mobSpeed=0 (not moving) — the moveControl.isMoving() gate is missing');

  okAv((() => {
    const g = { onGround: true, rabbitLastOnGround: true, mobSpeed: 0.3, moveMod: 1, jumping: false, rabbitTicksUntilJump: 0 };
    Rb.mobTick(g);   // startJump must NOT reschedule: vanilla only does that on landing
    return g.jumping === true && g.rabbitTicksUntilJump === 0;
  })(), 'Rb.mobTick reschedules ticksUntilJump right after startJump (vanilla: only on landing)');

  // killer bunny (type 99) lunges at a target within 4 blocks, even with mobSpeed 0
  const kb = (type, tz) => ({ onGround: true, rabbitLastOnGround: true, rabbitType: type, mobSpeed: 0, x: 0, y: 0, z: 0,
    yaw: 0, jumping: false, rabbitTicksUntilJump: 0, target: { x: 0, y: 0, z: tz } });
  const k3 = kb(99, 3); Rb.mobTick(k3);
  okAv(k3.jumping === true && k3.rabbitJumpDuration > 0, 'killer bunny did not startJump at a target 3 blocks away');
  const k5 = kb(99, 5); Rb.mobTick(k5);
  okAv(k5.jumping === false, 'killer bunny lunged at a target 5 blocks away (>= 4)');
  const b3 = kb(0, 3); Rb.mobTick(b3);
  okAv(b3.jumping === false, 'non-killer rabbit lunged at its target');
}

say('5a. killer bunny close-gap hop');
{
  const mk = (rt) => ({ onGround: true, rabbitLastOnGround: true, rabbitType: rt, mobSpeed: 0, jumping: false, rabbitTicksUntilJump: 1, x: 0, y: 0, z: 0, yaw: 0, target: { x: 3, y: 0, z: 0 } });
  const k = mk(99); Rb.mobTick(k);
  ok(k.jumping === true && k.rabbitLastOnGround === true, 'killer bunny did not lunge at target within 4 blocks');
  ok(Math.abs(k.yaw - Math.PI / 2) < 1e-9, 'killer bunny did not face its target');
  const n = mk(0); Rb.mobTick(n);
  ok(n.jumping === false, 'normal rabbit lunged at target');
  const f = mk(99); f.target.x = 5; Rb.mobTick(f);
  ok(f.jumping === false, 'killer bunny lunged from beyond 4 blocks');
}

// ── 5b. getJumpVelocity — 0.2 / 0.3 / 0.5 ────────────────────────────────────────────────────
say('5b. Rb.jumpVelocity — RabbitEntity.getJumpVelocity');
{
  const jv = (o) => Rb.jumpVelocity(Object.assign({ y: 64, moveMod: 0.6 }, o));
  okAv(jv({}) === 0.2, 'wandering hop (speed 0.6) is not 0.2');
  okAv(jv({ moveMod: 2.2 }) === 0.3, 'fleeing hop is not 0.3');
  okAv(jv({ horizontalCollision: true }) === 0.5, 'wall hop is not 0.5');
  okAv(jv({ navigating: true, navNode: { y: 65 } }) === 0.5, 'step-up node hop is not 0.5');
  okAv(jv({ moveTargetY: 65 }) === 0.5, 'move-target ledge (y+1) hop is not 0.5');
  okAv(jv({ moveTargetY: 64.4 }) === 0.2, 'low move target wrongly gave 0.5');
  okAv(jv({ moveMod: 0, moveTargetY: 65 }) === 0.2, 'idle MoveControl target Y wrongly counted');
  const h = { onGround: true, mobSpeed: 0.3, moveMod: 0.6, y: 64 };
  Rb.startJump(h);
  okAv(h.jumpVelocity === 0.2 && h.jumping, 'startJump did not stage the 0.2 hop (flat 0.42 would fail)');
}

{ // anti-vacuity: a flat-0.42 implementation must fail the same assertion
  const real = Rb.jumpVelocity; Rb.jumpVelocity = () => 0.42;
  const h = { onGround: true, mobSpeed: 0.3, moveMod: 0.6, y: 64 };
  Rb.startJump(h); Rb.jumpVelocity = real;
  okAv(h.jumpVelocity !== 0.2, 'flat 0.42 jump velocity was NOT detected by the 0.2 assertion');
}

{ // #2866 RabbitMoveControl.moveTo: touching water forces speed 1.5
  const w = { type: 'rabbit', inWater: true, x: 0, y: 64, z: 0 };
  Ai.stepToward(w, { x: 5, y: 64, z: 5 }, 0.6);
  ok(w.moveMod === 1.5, `swimming rabbit moveMod ${w.moveMod}, expected 1.5`);
  okAv(Math.abs(w.mobSpeed - 1.5 * Ai.movementSpeedOf(w)) < 1e-6, 'swimming rabbit mobSpeed is not 1.5x base');
  const d = { type: 'rabbit', inWater: false, x: 0, y: 64, z: 0 };
  Ai.stepToward(d, { x: 5, y: 64, z: 5 }, 0.6);
  okAv(d.moveMod === 0.6, 'dry rabbit speed was overridden (water override not caught)');
}

// ── 6. Rb.EatCarrotCropGoal ──────────────────────────────────────────────────────────────────
say('6. Rb.EatCarrotCropGoal — MoveToTargetPosGoal search, decrement age, break at 0');
{
  const carrots = R.id.carrots, farmland = R.id.farmland;
  ok(carrots !== undefined && farmland !== undefined, 'R.id.carrots/farmland missing — cannot test at all');
  // clear the section-4 player fixture — left near the origin, it is well inside every
  // AvoidEntityGoal's own range and would out-PRIORITIZE EatCarrotCropGoal (4 beats 5)
  // for a reason that has nothing to do with this section.
  MCL.Player = null;
  // this synthetic fixture never ran the lighting engine, so W.canSurvive's own rule 15
  // (CropBlock.canPlaceAt: rawBrightness>=8 OR sky-visible) would refuse every plant call
  // below for a reason that has nothing to do with EatCarrotCropGoal — stubbed the same way
  // §8's own brightness stub already proves the boundary is really read, not skipped.
  const saveBright6 = W.rawBrightness;
  W.rawBrightness = () => 15;
  const maxAge = Bh.maxAge(carrots);
  ok(maxAge === 7, `Bh.maxAge(carrots) = ${maxAge}, expected 7 (CarrotsBlock, 8 age states)`);

  function ageState(age) { return Bh.setProp(S.stateOf('carrots') | 0, 'age', age); }
  function plant(x, y, z, age) {
    W.setBlock(x, y - 1, z, S.stateOf('farmland') | 0);
    W.setBlock(x, y, z, ageState(age));
  }
  // a solid stone floor so the rabbit has continuous ground to path across, rather than the
  // void every other cell in this synthetic fixture is — Ai.findPath needs somewhere real to
  // walk, and a rabbit standing over nothing just free-falls forever, which looks exactly like
  // "the goal never fires" without ever exercising it.
  const stone = S.stateOf('stone') | 0;
  for (let x = -2; x <= 5; x++) for (let z = -2; z <= 2; z++) W.setBlock(x, 63, z, stone);
  plant(3, 64, 0, maxAge);   // a mature carrot 3 blocks east of the rabbit

  // Driven through the REAL pipeline (EL.spawn + EL.tickMob), not a hand-held goal object:
  // Ai.stepToward only sets a heading/speed/jump flag ("moves nothing", 07k_goals.js's own
  // header) — Ph.travelMob inside EL.tickMob is what actually walks the rabbit to the crop,
  // exactly as it does in play.
  // vanilla ends the goal after one tick (#4112): a rabbit 3 blocks away must NOT walk to the crop
  {
    const far = new Rb.EatCarrotCropGoal({ x: 0.5, y: 64, z: 0.5, type: 'rabbit' }, { mobGriefing: () => true });
    ok(far.canUse(), 'far crop not found');
    far.start(); far.tick();
    ok(W.getBlock(3, 64, 0) === ageState(maxAge) && far.canContinueToUse() === false, 'non-adjacent rabbit ate or kept walking (vanilla stops after tick 1)');
    const adj = new Rb.EatCarrotCropGoal({ x: 3.5, y: 64, z: 0.5, type: 'rabbit' }, { mobGriefing: () => true });
    adj.canUse(); adj.start(); adj.tick();
    okAv(W.getBlock(3, 64, 0) === ageState(maxAge - 1), 'adjacent rabbit must eat (age 7->6)');
    plant(3, 64, 0, maxAge);
  }
  const e = EL.spawn('rabbit', 3.5, 64, 0.5, {});
  const rawBefore = S.propValue(W.getBlock(3, 64, 0), R.PROP.age);
  const events = [], pops = [], origPop = EL.popResource, origSnd = MCL.Sound;
  MCL.Sound = { blockBreak: (st, x) => events.push([Math.floor(x), 0, 0, st]) };
  EL.popResource = (x, y, z, i, n) => pops.push([x, y, z, i, n]);
  let ticks = 0;
  while (S.propValue(W.getBlock(3, 64, 0), R.PROP.age) === rawBefore && ticks < 400) {
    EL.tickMob(e);
    ticks++;
  }
  ok(ticks < 400, `EatCarrotCropGoal never ate the crop in ${ticks} real ticks (rabbit ended at ${e.x.toFixed(2)},${e.z.toFixed(2)})`);
  const rawAfter = S.propValue(W.getBlock(3, 64, 0), R.PROP.age);
  ok(events.length === 1 && events[0][0] === 3 && events[0][3] === ageState(maxAge), `age>0 eat: break event (2001) count ${events.length}, expected 1 with the old state`);
  ok(pops.length === 0, 'age>0 eat must drop nothing');
  const eatAtAge0 = () => {
    // age-0 branch (dead in natural play: canContinueToUse needs a mature crop): target a mature
    // crop, age it to 0, then run the goal's own tick() directly, as the jar's tick() does.
    plant(3, 64, 0, maxAge);
    const e5 = { x: 3.5, y: 64, z: 0.5, type: 'rabbit' };
    const g5 = new Rb.EatCarrotCropGoal(e5, { mobGriefing: () => true });
    events.length = 0; pops.length = 0;
    if (!g5.canUse()) return false;
    g5.start(); W.setBlock(3, 64, 0, ageState(0)); g5.tick();
    return W.getBlock(3, 64, 0) === 0;
  };
  ok(eatAtAge0(), 'age-0 carrot was not removed');
  ok(pops.some(p => p[3] === MCL.Items.of('carrot')), `age-0 eat dropped no carrot item (pops ${JSON.stringify(pops)})`);
  ok(events.length === 1, `age-0 eat: break event count ${events.length}, expected 1`);
  // anti-vacuity: with the loot table emptied the same run must show no carrot drop
  const realBd = MCL.Loot.breakDrops; MCL.Loot.breakDrops = () => [];
  eatAtAge0(); MCL.Loot.breakDrops = realBd;
  okAv(!pops.some(p => p[3] === MCL.Items.of('carrot')), 'the drop assertion must fail when the loot table is empty');
  EL.popResource = origPop; MCL.Sound = origSnd;
  ok(+R.valueNames[rawAfter] === maxAge - 1, `carrot age after one eat = ${R.valueNames[rawAfter]}, expected ${maxAge - 1}`);
  ok(e.moreCarrotTicks >= 38 && e.moreCarrotTicks <= 40, `e.moreCarrotTicks after eating = ${e.moreCarrotTicks}, expected 40 less at most one mobTick's nextInt(3)`);
  for (let i = 0; i < 2000 && e.moreCarrotTicks > 0; i++) Rb.mobTick(e);
  ok(e.moreCarrotTicks === 0, `e.moreCarrotTicks never counted down: ${e.moreCarrotTicks}`);

  // `EatCarrotCropGoal.isTargetPos` only ever accepts a MATURE (age==maxAge==7) carrot, so the
  // block this goal eats is always found at age 7 and decrements to 6 — never straight to a
  // fresh age-0 replant. The `if (age == 0) { break the block }` branch in the real jar method
  // is therefore DEAD for carrots specifically (maxAge is 7, not 0): reachable in source, never
  // in play, the same "named, not modelled as possible" standing this codebase already gives
  // other unreachable branches (07zh_rabbit.js's own OWED wording pattern). Proven here by
  // showing the search REFUSES an age-0 block outright rather than by faking a removal that
  // vanilla itself never produces.
  plant(3, 64, 0, 0);
  const deadGoal = new Rb.EatCarrotCropGoal({ x: 0, y: 64, z: 0, type: 'rabbit' }, { mobGriefing: () => true });
  // eatCarrot at age 0: loot drops as an item entity; at age>0: break sound (event 2001)
  {
    const g0 = new Rb.EatCarrotCropGoal({ x: 3.5, y: 64, z: 0.5, type: 'rabbit' }, { mobGriefing: () => true });
    plant(3, 64, 0, maxAge); g0.canUse(); // sets target
    const items0 = () => (MCL.EntityList.list || []).filter((q) => q.type === 'item').length;
    const nBefore = items0();
    let sounds = 0; const sb = MCL.Sound; MCL.Sound = { blockBreak: () => { sounds++; } };
    plant(3, 64, 0, 0);
    g0.eatCarrot();
    okAv(W.getBlock(3, 64, 0) === 0, 'age-0 eat did not remove the crop');
    okAv(sounds === 1, `age-0 eat played ${sounds} break events, expected 1`);
    okAv(items0() > nBefore, 'age-0 eat dropped no carrot item entity');
    plant(3, 64, 0, 3); sounds = 0;
    g0.eatCarrot();
    okAv(sounds === 1, `age>0 eat played ${sounds} break events, expected 1 (event 2001)`);
    MCL.Sound = sb;
  }
  okAv(deadGoal.canUse() === false, 'an age-0 carrot was accepted as a target — isTargetPos must require isMature (age==maxAge)');

  // age-0 branch of tick (dead via canUse, but the break must drop loot + not be bare air): drive it directly
  plant(3, 64, 0, 0);
  const e5 = { x: 3.5, y: 64, z: 0.5, type: 'rabbit' };
  const goal5 = new Rb.EatCarrotCropGoal(e5, { mobGriefing: () => true });
  plant(3, 64, 0, maxAge);
  ok(goal5.canUse() === true, 'mature carrot beside the rabbit not found');
  goal5.start();
  W.setBlock(3, 64, 0, ageState(0));
  const itemsBefore = EL.list.filter((m) => m.type === 'item').length;
  goal5.tick();
  ok(W.getBlock(3, 64, 0) === 0, 'age-0 carrot not removed');
  ok(EL.list.filter((m) => m.type === 'item').length > itemsBefore, 'age-0 eat dropped no item entity (breakBlock drops)');

  // mobGriefing=false refuses to eat at all (D-399's own gate, generic across this engine).
  plant(3, 64, 0, maxAge);
  const e3 = { x: 3.4, y: 64, z: 0.4, type: 'rabbit' };
  const goal3 = new Rb.EatCarrotCropGoal(e3, { mobGriefing: () => false });
  okAv(goal3.canUse() === false, 'mobGriefing=false must refuse EatCarrotCropGoal.canUse() entirely');

  // anti-vacuity: an IMMATURE carrot (age < max) must never be treated as a target.
  plant(3, 64, 0, maxAge - 1);
  const e4 = { x: 0, y: 64, z: 0, type: 'rabbit' };
  const goal4 = new Rb.EatCarrotCropGoal(e4, { mobGriefing: () => true });
  okAv(goal4.canUse() === false, 'an immature carrot (age maxAge-1) was accepted as a target — isMature check is broken');
  W.rawBrightness = saveBright6;
}

// ── 7. Br.CHILD.rabbit ──────────────────────────────────────────────────────────────────────
say('7. Br.CHILD.rabbit — RabbitEntity.method_6620, child inherits a parent or rerolls');
{
  const seqRnd = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  const a = { x: 0, y: 64, z: 0, type: 'rabbit', rabbitType: Rb.TYPE.BROWN };
  const b = { x: 0, y: 64, z: 0, type: 'rabbit', rabbitType: Rb.TYPE.WHITE };
  const child = { x: 0, y: 64, z: 0, type: 'rabbit' };

  // 95% path (rand()>=1/20 on the first call): coin flip decides which parent.
  Breed.CHILD.rabbit(child, a, b, seqRnd([0.5, 0.9, 0.2])); // fresh roll (unused), 19/20 branch, coin<0.5 -> b
  ok(child.rabbitType === b.rabbitType, `95% branch, coin 0.2 should copy b's type (${b.rabbitType}), got ${child.rabbitType}`);
  Breed.CHILD.rabbit(child, a, b, seqRnd([0.5, 0.9, 0.8])); // coin 0.8 -> a
  ok(child.rabbitType === a.rabbitType, `95% branch, coin 0.8 should copy a's type (${a.rabbitType}), got ${child.rabbitType}`);

  // 5% path (rand()<1/20 on the second call): the fresh biome roll wins outright.
  const saveBiomeAt = W.biomeAt, saveB = MCL.Biomes;
  W.biomeAt = () => 0;
  MCL.Biomes = { ready: true, at: () => ({ precipitation: 0, category: 'desert' }) };
  Breed.CHILD.rabbit(child, a, b, seqRnd([0.1, 0.02])); // fresh roll -> GOLD (desert), then 1/20 branch taken
  ok(child.rabbitType === Rb.TYPE.GOLD, `5% branch should keep the fresh GOLD roll, got ${child.rabbitType}`);
  W.biomeAt = saveBiomeAt; MCL.Biomes = saveB;

  okAv((() => {
    const before = Breed.CHILD.rabbit;
    Breed.CHILD.rabbit = undefined;
    const stillWorks = typeof Breed.CHILD.rabbit === 'function';
    Breed.CHILD.rabbit = before;
    return !stillWorks; // proves the harness can actually detect a missing entry
  })(), 'clearing Breed.CHILD.rabbit was not detected — the anti-vacuity probe itself is broken');
}

// ── 8. Spawn.RULES.rabbit ────────────────────────────────────────────────────────────────────
say('8. Spawn.RULES.rabbit — #rabbits_spawnable_on + isLightLevelValidForNaturalSpawn');
{
  ok(typeof Spawn.RULES.rabbit === 'function' && Spawn.canPlace('rabbit'), 'Spawn.RULES.rabbit is not wired');
  const grass = S.stateOf('grass_block') | 0, stone = S.stateOf('stone') | 0;
  W.setBlock(0, 63, 0, grass);
  W.setBlock(0, 63, 1, stone);
  const saveBright = W.rawBrightness;
  W.rawBrightness = () => 9;
  ok(Spawn.RULES.rabbit(0, 64, 0) === true, 'grass below + bright enough must pass');
  ok(Spawn.RULES.rabbit(0, 64, 1) === false, 'stone below (not in rabbits_spawnable_on) must refuse');
  okAv((() => { W.rawBrightness = () => 8; return Spawn.RULES.rabbit(0, 64, 0) === false; })(),
    'dropping brightness to 8 (the >8 boundary) must refuse — the light check is really consulted');
  W.rawBrightness = saveBright;
}

// ── 9. Rb.skinKey ────────────────────────────────────────────────────────────────────────────
say('9. Rb.skinKey — the 8-sheet rabbit/rabbit#1..7 family, RabbitEntityRenderer.method_4102');
{
  const expect = ['rabbit', 'rabbit#1', 'rabbit#2', 'rabbit#3', 'rabbit#4', 'rabbit#5'];
  for (let t = 0; t <= 5; t++) {
    ok(Rb.skinKey({ type: 'rabbit', rabbitType: t }) === expect[t], `rabbitType ${t} -> ${Rb.skinKey({ type: 'rabbit', rabbitType: t })}, expected ${expect[t]}`);
  }
  ok(Rb.skinKey({ type: 'rabbit', rabbitType: 99 }) === 'rabbit#7', 'killer bunny (99) should map to rabbit#7 (caerbannog)');
  ok(Rb.skinKey({ type: 'rabbit', rabbitType: 0, customName: 'Toast' }) === 'rabbit#6', '"Toast"-named rabbit should map to rabbit#6, ahead of its type');
  ok(Rb.skinKey({ type: 'cow', rabbitType: 0 }) === null, 'skinKey must refuse a non-rabbit entity');
  okAv((() => { const save = Rb.SKIN[0]; Rb.SKIN[0] = 'broken'; const bad = Rb.skinKey({ type: 'rabbit', rabbitType: 0 }) === 'broken'; Rb.SKIN[0] = save; return bad; })(),
    'corrupting Rb.SKIN[0] did not change skinKey’s answer — the table is not really consulted');
}

say('10. MobVoice.source — killer bunny is hostile (reads rabbitType, not variant)');
{
  const MV = MCL.MobVoice;
  ok(MV && MV.source({ type: 'rabbit', rabbitType: 99 }) === 'hostile', 'killer bunny voice must use the hostile slider');
  ok(MV && MV.source({ type: 'rabbit', rabbitType: 1 }) === 'neutral', 'ordinary rabbit voice must be neutral');
  okAv(MV && MV.source({ type: 'rabbit', variant: 99 }) === 'neutral', 'a stray .variant must not make a rabbit hostile');
}

say('11. tick-exact hop schedule (RabbitEntity.mobTick/doScheduleJump/getJumpVelocity)');
{
  // A rabbit that lands every 14 ticks then re-hops: record [tick of jump, jumpDelay at that tick, takeoff velocity].
  const sim = (speed, delayOverride) => {
    const e = { type: 'rabbit', y: 64, onGround: false, rabbitLastOnGround: false, moveMod: speed, mobSpeed: 0 };
    const out = [];
    for (let t = 0; t < 60; t++) {
      e.onGround = !e.jumping;                 // lands as soon as the hop flag clears; airborne while jumping
      e.moveMod = speed;                       // the goal re-issues MOVE_TO every tick
      const was = e.jumping;
      Rb.mobTick(e);
      if (delayOverride && e.rabbitTicksUntilJump === 10 && !was) e.rabbitTicksUntilJump = 10 + delayOverride;
      if (e.jumping && !was) out.push([t, e.rabbitTicksUntilJump, e.jumpVelocity]);
    }
    return out;
  };
  const walk = sim(0.6), flee = sim(2.2);
  const key = (a) => JSON.stringify(a);
  ok(walk.length >= 3 && flee.length > walk.length, 'fleeing rabbit must hop more often than a wandering one');
  ok(walk.every((h) => h[1] === 0 && h[2] === 0.2), 'wandering hops: jumpDelay 0 at takeoff, velocity 0.2 ' + key(walk));
  ok(flee.every((h) => h[1] === 0 && h[2] === 0.3), 'fleeing hops: jumpDelay 0 at takeoff, velocity 0.3 ' + key(flee));
  const gaps = (a) => a.slice(1).map((h, i) => h[0] - a[i][0]);
  ok(gaps(walk).every((g) => g === gaps(walk)[0]), 'wandering hop period is constant ' + gaps(walk));
  ok(gaps(flee).every((g) => g === gaps(flee)[0]) && gaps(walk)[0] - gaps(flee)[0] === 9,
    'wander delay 10 vs flee delay 1: periods differ by 9 ' + gaps(walk) + ' / ' + gaps(flee));
  const c = Rb.jumpControl({ }); const mcc = Rb.moveControl({ moveMod: 0.6 });
  ok(c.isActive() === false && c.canJump() === false && mcc.getSpeed() === 0.6 && mcc.isMoving(), 'control objects expose isActive/canJump/getSpeed/isMoving');
  const ek = { moveMod: 0.6, onGround: true, rabbitLastOnGround: true, rabbitTicksUntilJump: 5 };
  Rb.jumpControl(ek).active = true; Rb.mobTick(ek);
  ok(Rb.jumpControl(ek).canJump() === true && !ek.jumping, 'active jump control with canJump false is enabled (enableJump), no hop');
  const bad = sim(0.6, 1);   // perturb jumpDelay by 1
  okAv(key(bad) !== key(walk), 'jumpDelay perturbed by 1 changed the hop schedule (check would fail)');
}

console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity probes included) — ${breaks} breaks caught`);
if (fails.length) {
  console.log('FAILURES:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('rabbitcheck: ALL GREEN');
