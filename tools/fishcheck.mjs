#!/usr/bin/env node
// fishcheck.mjs — loop/fish-s99 (QUEUE 0.2 G18c): cod + salmon + pufferfish + tropical fish. Drives
// the REAL modules (07zj_fish.js through EL.spawn/EL.tickMob, Spawn.RULES.cod/.salmon/
// .pufferfish/.tropical_fish, Cb.hurt) against .decomp/net/minecraft/entity/passive/
// {FishEntity,SchoolingFishEntity,CodEntity,SalmonEntity,PufferfishEntity,TropicalFishEntity}.java
// (all six read in full).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

console.log('fishcheck — loop/fish-s99 (QUEUE 0.2 G18c): cod + salmon + pufferfish + tropical fish');
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js',
          '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07t_fly.js',
          '07l_spawn.js', '14j_combat.js', '07q_effects.js', '07zf_bat.js', '07zi_squid.js', '07zj_fish.js']
});
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Fish.init();
const EL = M.EntityList, W = M.World, S = M.States, Fh = M.Fish, Spawn = M.Spawn, Cb = M.Combat;

for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const stone = S.stateOf('stone') | 0;
const water = S.stateOf('water') | 0;
const sand = S.stateOf('sand') | 0;
const box = (fill) => { for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 0; y <= 7; y++) {
  const wall = x === -3 || x === 3 || z === -3 || z === 3 || y === 0 || y === 7;
  W.setBlock(x, y, z, wall ? stone : fill);
} };
box(water);
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };

// §1 the closed set, attributes, spawn-time init
{
  const m1 = EL.motionFor('cod'), m2 = EL.motionFor('salmon'), m3 = EL.motionFor('pufferfish'), m4 = EL.motionFor('tropical_fish');
  for (const [name, m] of [['cod', m1], ['salmon', m2], ['pufferfish', m3], ['tropical_fish', m4]]) {
    ok(m && m[0] === 0 && m[1] === 1, `${name} motion is the inert [0,1] pair (like squid) — got ${JSON.stringify(m)}`);
  }
  { // D-567: the unbuilt witness is picked, not hard-coded — bee got built (D-559) and turned this red
    const VANILLA = ['ender_dragon','wither','giant','ghast','blaze','strider','hoglin','piglin','piglin_brute','zoglin','magma_cube','wither_skeleton','shulker','endermite','guardian','elder_guardian','phantom','warden'];
    const witness = VANILLA.find((t) => !EL.canSpawn(t));
    okAv(witness ? !EL.canSpawn(witness) : !EL.canSpawn('not_a_mob'), `a type nobody built (${witness || 'not_a_mob'}) is still refused — the closed set is real`);
  }

  const c = EL.spawn('cod', 0.5, 3.5, 0.5);
  ok(!!c, 'EL.spawn(cod) returns a mob');
  ok(c && c.maxHealth === 3, `cod max health 3 (createFishAttributes) — got ${c && c.maxHealth}`);
  ok(c && c.fromBucket === false, 'a naturally-spawned cod is not from a bucket');
  ok(c && c.fishGroupSize === 1 && c.fishLeader === null, 'a fresh schooling fish starts alone');

  const p = EL.spawn('pufferfish', 0.5, 3.5, 0.5);
  ok(p && p.puffState === 0 && p.inflateTicks === 0 && p.deflateTicks === 0, 'a fresh pufferfish starts fully deflated');
  ok(Math.abs(p.width - p.baseWidth * 0.5) < 1e-9 && p.baseWidth > 0, `fresh pufferfish hitbox is scaled 0.5 — got ${p.width}/${p.baseWidth}`);
  okAv(p.fishGroupSize === undefined, 'pufferfish (not a SchoolingFishEntity) never grows schooling fields');

  const t = EL.spawn('tropical_fish', 0.5, 3.5, 0.5);
  ok(t && typeof t.fishVariant === 'number', 'a fresh tropical fish rolls a variant');
}

// §2 tropical variant packing — toVariant/getShape/getPattern/dye-colour-index, and the 22
// COMMON_VARIANTS round-trip
{
  ok(Fh.COMMON_VARIANTS.length === 22, `exactly 22 predefined variants — got ${Fh.COMMON_VARIANTS.length}`);
  const packed = Fh.toVariant(1, 3, 10, 4);   // shape=1 pattern=3 base=purple(10) pattern=yellow(4)
  ok(Fh.getShape(packed) === 1, `getShape unpacks byte 0 — got ${Fh.getShape(packed)}`);
  ok(Fh.getPattern(packed) === 3, `getPattern unpacks byte 1 — got ${Fh.getPattern(packed)}`);
  ok(Fh.getBaseDyeColorIndex(packed) === 10, `getBaseDyeColorIndex unpacks byte 2 — got ${Fh.getBaseDyeColorIndex(packed)}`);
  ok(Fh.getPatternDyeColorIndex(packed) === 4, `getPatternDyeColorIndex unpacks byte 3 — got ${Fh.getPatternDyeColorIndex(packed)}`);
  okAv(Fh.getShape(Fh.toVariant(9, 0, 0, 0)) === 1, 'getShape clamps to 1 (Math.min(x,1)) — the clamp is really consulted');
  okAv(Fh.getPattern(Fh.toVariant(0, 9, 0, 0)) === 5, 'getPattern clamps to 5 (Math.min(x,5)) — the clamp is really consulted');

  // every COMMON_VARIANTS entry unpacks to a shape in {0,1}, pattern in 0..5, colours in 0..15
  let allValid = true;
  for (const cv of Fh.COMMON_VARIANTS) {
    const sh = Fh.getShape(cv), pt = Fh.getPattern(cv), bc = Fh.getBaseDyeColorIndex(cv), pc = Fh.getPatternDyeColorIndex(cv);
    if (sh < 0 || sh > 1 || pt < 0 || pt > 5 || bc < 0 || bc > 15 || pc < 0 || pc > 15) allValid = false;
  }
  ok(allValid, 'every COMMON_VARIANTS entry unpacks to valid shape/pattern/colour ranges');

  // the 22 packed ints against a table decoded straight from .decomp (Variety shape/pattern + DyeColor ids)
  {
    const dc = p => readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/' + p), 'utf8');
    const j = dc('entity/passive/TropicalFishEntity.java'), d = dc('util/DyeColor.java');
    const V = {}, D = {};
    for (const m of j.matchAll(/(field_\d+)\((\d), (\d)\)/g)) V[m[1]] = [+m[2], +m[3]];
    for (const m of d.matchAll(/(field_\d+)\((\d+), "/g)) D[m[1]] = +m[2];
    const body = j.match(/COMMON_VARIANTS = new int\[\]\{([\s\S]*?)\};/)[1];
    const want = [...body.matchAll(/Variety\.(\w+), DyeColor\.(\w+), DyeColor\.(\w+)/g)]
      .map(m => Fh.toVariant(V[m[1]][0], V[m[1]][1], D[m[2]], D[m[3]]));
    ok(want.length === 22, `decomp table has 22 entries — got ${want.length}`);
    const bad = Fh.COMMON_VARIANTS.map((x, i) => x === want[i] ? -1 : i).filter(i => i >= 0);
    ok(bad.length === 0, `COMMON_VARIANTS matches .decomp — wrong indices: ${bad}`);
    okAv(want.some(x => x !== Fh.toVariant(1, 1, 1, 7)) && want[0] !== want[1], 'decomp table is not uniform — a swapped entry would show as a wrong index');
  }

  // bucket NBT variant wins outright over a fresh roll
  const e = { type: 'tropical_fish', x: 0, y: 0, z: 0 };
  Fh.spawnInit(e, { variant: 12345 });
  ok(e.fishVariant === 12345, `an incoming opts.variant (bucket NBT) wins outright — got ${e.fishVariant}`);

  // 90%/10% common-vs-random split — forced both ways through Fh.random
  Fh.random = () => 0.0;   // < 0.9 -> common pick, index 0
  const e2 = { type: 'tropical_fish', x: 0, y: 0, z: 0 };
  Fh.spawnInit(e2, {});
  ok(e2.fishVariant === Fh.COMMON_VARIANTS[0] && e2.fishCommonSpawn === true, 'forcing the roll below 0.9 picks a COMMON_VARIANTS entry');
  Fh.random = () => 0.999999;   // >= 0.9 -> fully random, commonSpawn=false
  const e3 = { type: 'tropical_fish', x: 0, y: 0, z: 0 };
  Fh.spawnInit(e3, {});
  okAv(e3.fishCommonSpawn === false, 'forcing the roll at/above 0.9 really takes the uncommon branch — the split is consulted');
  Fh.random = null;
  // the pack-break in Spawn.attempt must read the field Fish really writes (#3049)
  okAv(/type === 'tropical_fish' && e\.fishCommonSpawn === false\) break/.test(readFileSync(join(MCLITE_ROOT, 'src/07l_spawn.js'), 'utf8')), 'Spawn.attempt ends the pack on fishCommonSpawn === false (spawnsTooManyForEachTry)');
}

// §3 pufferfish: inflate/deflate state machine, and the sting (damage + poison) on anything
// non-aquatic within touching range while puffed
{
  EL.list.length = 0;
  const e = EL.spawn('pufferfish', 0.5, 3.5, 0.5);
  e.inWater = true;
  const zombie = EL.spawn('pig', 0.5, 3.5, 0.5) || { type: 'pig', x: 0.5, y: 3.5, z: 0.5, removed: false, dead: false };   // D-647: a real zombie is undead and refuses the poison half
  zombie.x = e.x + 0.1; zombie.y = e.y; zombie.z = e.z;   // well within the 2-block inflate trigger AND the 0.3 sting range

  Fh.puffTick(e);
  ok(e.puffState === 1, `a threat within range inflates to SEMI_PUFFED on the very first tick — got ${e.puffState}`);
  for (let i = 0; i < 41; i++) Fh.puffTick(e);
  ok(e.puffState === 2, `41 more ticks of continued threat reaches FULLY_PUFFED (>40) — got ${e.puffState}`);

  const hpBefore = zombie.health;
  Fh.stingNearby(e);
  ok(zombie.health < hpBefore, `stingNearby damages a touching non-aquatic mob — hp ${hpBefore} -> ${zombie.health}`);
  ok(zombie.effects && zombie.effects.poison, 'stingNearby also applies POISON');
  {   // #3079: vanilla stings MobEntity only; an armor_stand is LivingEntity but not a Mob
    const st = EL.spawn('armor_stand', e.x, e.y, e.z);
    if (st) { const h = st.health; Fh.stingNearby(e); okAv(st.health === h && !(st.effects && st.effects.poison), 'a puffed pufferfish does not sting an armor_stand (not a MobEntity)'); }
  }
  ok(zombie.effects.poison.duration === 120, `POISON duration is 60*puffState (60*2) — got ${zombie.effects.poison.duration}`);

  okAv((() => {   // #1274: a sting that damage refuses (i-frames) neither poisons nor sounds
    const played = []; const S = globalThis.NS && globalThis.NS.Sound; const oldPlay = S && S.play;
    if (S) S.play = (ev) => played.push(ev);
    delete zombie.effects.poison;
    const hp1 = zombie.health;
    Fh.stingNearby(e);
    if (S) S.play = oldPlay;
    return zombie.health === hp1 && !zombie.effects.poison && played.length === 0;
  })(), 'a refused sting (hurt cooldown) applies no poison and plays no sting sound');

  okAv((() => {   // #2656: the PLAYER is stung via its own box.expand(1.0,0.5,1.0), not the fish's expand(0.3)
    const oldP = M.Player, P = M.Player = { x: 0, y: 0, z: 0, width: 0.6, height: 1.8, health: 20, maxHealth: 20, EYE: 1.62 }, old = [0, 0, 0, 20];
    P.x = e.x + 0.9; P.z = e.z; P.y = e.y;   // box gap ~0.4 > 0.3, inside 1.0
    P.hurtTime = 0; P.invulnerableTime = 0;
    const hp0 = P.health; Fh.stingNearby(e);
    const near = P.health < hp0;
    P.x = e.x + 3; P.health = old[3]; P.hurtTime = 0; P.invulnerableTime = 0;
    const hp1 = P.health; Fh.stingNearby(e);
    M.Player = oldP;
    return near && P.health === hp1;
  })(), 'a survival player ~0.9 away is stung (player box expand 1.0), 3 away is not');

  okAv((() => {
    EL.list.length = 0;
    const s2 =EL.spawn('squid', 5.5, 3.5, 5.5);   // aquatic — must NEVER be a sting target
    s2.x = e.x + 0.1; s2.y = e.y; s2.z = e.z;
    const hp0 = s2.health;
    Fh.stingNearby(e);
    return s2.health === hp0;
  })(), 'an aquatic mob (squid) touching a puffed pufferfish is never stung — the aquatic exclusion is consulted');

  // deflate: threat removed, 60/100-tick backoff FULLY -> SEMI -> NOT_PUFFED
  zombie.removed = true;   // the threat must actually be GONE, or puffTick keeps re-triggering inflate
  e.inflateTicks = 0;
  ok(Math.abs(e.width - e.baseWidth) < 1e-9 && Math.abs(e.height - e.baseHeight) < 1e-9, `FULLY_PUFFED hitbox scale 1.0 — got ${e.width}x${e.height}`);
  for (let i = 0; i < 62; i++) Fh.puffTick(e);
  ok(Math.abs(e.width - e.baseWidth * 0.7) < 1e-9, `SEMI_PUFFED hitbox scale 0.7 — got ${e.width}`);
  ok(e.puffState === 1, `62 ticks with no threat deflates FULLY -> SEMI (deflateTicks>60) — got ${e.puffState}`);
  for (let i = 0; i < 101; i++) Fh.puffTick(e);
  ok(e.puffState === 0, `then SEMI -> NOT_PUFFED (deflateTicks>100 more) — got ${e.puffState}`);
}

// §4 flop on land, air/drowning (WaterCreatureEntity, same numbers squid already proves)
{
  EL.list.length = 0;
  const e = EL.spawn('cod', 0.5, 3.5, 0.5);
  e.inWater = false; e.onGround = true; e.verticalCollision = true; e.vy = 0;
  Fh.random = () => 0.5;
  Fh.tickMovementFlop(e);
  ok(e.vy > 0.39 && e.onGround === false, `flopping on land adds a +0.4 vy impulse and clears onGround — vy=${e.vy}`);
  Fh.random = null;

  EL.list.length = 0;
  const f = EL.spawn('salmon', 0.5, 3.5, 0.5);
  f.inWater = false;
  for (let i = 0; i < 320; i++) Fh.tickAir(f);
  ok(f.fishAir === 0 && f.health < f.maxHealth, `air hits -20 -> 2.0 drown damage — air=${f.fishAir} health=${f.health}`);
  const dmg = f.maxHealth - f.health;
  ok(Math.abs(dmg - 2.0) < 1e-9, `exactly 2.0 drown damage — got ${dmg}`);
  f.inWater = true;
  Fh.tickAir(f);
  ok(f.fishAir === 300, 'back in water, air resets to 300 immediately');
}

// §5 schooling (FollowGroupLeaderGoal via the real GoalSelector): the search delay is 200-219 ticks
const runUntil = (f, n, pred) => { for (let i = 0; i < n && !pred(); i++) Fh.tick(f); return pred(); };
{
  EL.list.length = 0;
  const leader = EL.spawn('cod', 0.5, 3.5, 0.5);
  leader.fishGroupSize = 2;   // pretend it already has one follower, so it can recruit more
  const joiner = EL.spawn('cod', 1.5, 3.5, 0.5);
  ok(runUntil(joiner, 400, () => joiner.fishLeader === leader), 'a lone schooling fish near an existing leader joins its group');
  ok(leader.fishGroupSize === 3, `joining bumps the leader's own group size — got ${leader.fishGroupSize}`);

  okAv((() => {
    EL.list.length = 0;
    const far = EL.spawn('cod', 50.5, 3.5, 0.5);
    const farLeader = EL.spawn('cod', 0.5, 3.5, 0.5);
    farLeader.fishGroupSize = 2;
    runUntil(far, 400, () => !!far.fishLeader);
    return !far.fishLeader;
  })(), 'a fish far outside the 8-block join range does NOT join — the distance gate is consulted');

  // salmon caps at 5, cod/tropical at 8 (SalmonEntity.getMaxGroupSize override)
  EL.list.length = 0;
  const sl = EL.spawn('salmon', 0.5, 3.5, 0.5);
  sl.fishGroupSize = 5;   // already at salmon's own cap
  const sj = EL.spawn('salmon', 1.5, 3.5, 0.5);
  okAv((() => { runUntil(sj, 400, () => !!sj.fishLeader); return !sj.fishLeader; })(),
    'a salmon leader already at its own 5-fish cap refuses a new joiner — the per-species cap is consulted');
}

// §6 flee/danger: the goals start a navigation target AWAY from the threat
{
  EL.list.length = 0;
  const e = EL.spawn('cod', 0.5, 3.5, 0.5);
  e.inWater = true;
  M.Player.x = e.x + 2; M.Player.y = e.y; M.Player.z = e.z;
  {
    // fuzzFind is unseeded and legitimately null for many samples in this tiny pool: retry, drive the flee goal directly
    const g = new M.Fish.FleeEntityGoal(e);
    let started = false;
    for (let i = 0; i < 300 && !started; i++) started = g.canUse();
    if (started) { g.start(); g.tick(); }
    ok(started && !!e.fishNav, 'a player 2 blocks away makes the fish start swimming (FleeEntityGoal)');
    ok(e.fishNav && e.fishNav.speed >= 1.4, `flee speed is the fast 1.4/1.6 — got ${e.fishNav && e.fishNav.speed}`);
  }
  {
    // FleeEntityGoal range: 3D squaredDistance <= 64 (TargetPredicate.baseMaxDistance), not flat 8 + dy<=4
    const g = new M.Fish.FleeEntityGoal(e), tries = (dx, dy) => {
      M.Player.x = e.x + dx; M.Player.y = e.y + dy; M.Player.z = e.z;
      for (let i = 0; i < 300; i++) if (g.canUse()) return true;
      return false;
    };
    ok(tries(2, 0), 'flee range: player 2 blocks away wakes the goal');
    okAv(!tries(7.9, 3.9), 'flee range: dx 7.9 dy 3.9 (3D 8.8 > 8) does NOT wake the goal');
    okAv(!tries(0, 5), 'flee range: 5 blocks above is outside the expand(8,3,8) box');
  }
  M.Player.x = 100; M.Player.y = 100; M.Player.z = 100;

  // #3078: TargetPredicate — 3D distance scaled by sneaking (x0.8 -> 6.4), not a cylinder
  const flees = (px, py, pz, crouch, wallX) => {
    for (let x = 3; x <= 12; x++) for (let z = -3; z <= 3; z++) for (let y = 0; y <= 7; y++)
      W.setBlock(x, y, z, (x === 12 || z === -3 || z === 3 || y === 0 || y === 7 || x === wallX) ? stone : water);   // pool long enough for 7+ blocks
    EL.list.length = 0;
    const g = EL.spawn('cod', 0.5, 3.5, 0.5); g.inWater = true;
    M.Player.x = g.x + px; M.Player.y = g.y + py; M.Player.z = g.z + pz; M.Player.crouching = !!crouch;
    let r = false; const goal = new M.Fish.FleeEntityGoal(g);
    for (let i = 0; i < 300 && !r; i++) r = goal.canUse();   // fuzzFind is random — a few tries
    M.Player.crouching = false; M.Player.x = 100; M.Player.y = 100; M.Player.z = 100;
    for (let x = 3; x <= 12; x++) for (let z = -3; z <= 3; z++) for (let y = 0; y <= 7; y++) W.setBlock(x, y, z, x === 3 ? stone : 0);
    return r;
  };
  okAv(!flees(7, 0, 0, true), 'a SNEAKING player 7 blocks away (range 6.4) does not make the fish flee');
  okAv(flees(7, 0, 0, false), 'a standing player 7 blocks away does make the fish flee');
  okAv(!flees(7.9, 3, 0, false), 'a player at dx 7.9, dy 3 (3D 8.45 > 8) does not make the fish flee — 3D, not a cylinder');
  okAv(!flees(5, 0, 0, false, 4), 'a player behind a stone wall does not make the fish flee — the VisibilityCache is consulted');

  EL.list.length = 0;
  const f = EL.spawn('cod', 0.5, 3.5, 0.5);
  f.inWater = true;
  f.lastHurtByEntity = { x: f.x + 2, y: f.y, z: f.z, dead: false, removed: false };
  okAv(runUntil(f, 5, () => !!f.fishNav && f.fishNav.speed === 1.25), 'EscapeDangerGoal(1.25) starts a target once hurt — the danger gate is consulted');
}

// #4069: a BURNING fish on land goes to the closest water (EscapeDangerGoal.canStart), not a fuzz block
{
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) { W.setBlock(x, 0, z, stone); for (let y = 1; y <= 3; y++) W.setBlock(x, y, z, 0); }
  W.setBlock(3, 1, 0, water);
  EL.list.length = 0;
  const b = EL.spawn('cod', 0.5, 1.0, 0.5); b.isOnFire = true;
  const g = new M.Fish.EscapeDangerGoal(b);
  okAv(g.canUse(), 'burning fish on land with water 3 blocks away has a target');
  g.start();
  okAv(b.fishNav && b.fishNav.x === 3.5 && b.fishNav.y === 1 && b.fishNav.z === 0.5, 'burning fish targets the closest water block (3,1,0)');
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) for (let y = 0; y <= 3; y++) W.setBlock(x, y, z, 0);
}

// §7 travel: water branch decays vx/vz by 0.9 and moves; land branch delegates to Ph.travelMob
{
  EL.list.length = 0;
  const e = EL.spawn('cod', 0.5, 3.5, 0.5);
  e.inWater = true; e.vx = 0.2; e.vy = 0; e.vz = 0.2;
  const x0 = e.x;
  Fh.travelMob(e);
  ok(e.x !== x0, 'Fish.travelMob (water) actually moves the entity');
  ok(Math.abs(e.vx - 0.18) < 1e-9, `water travel decays vx by *0.9 — got ${e.vx}`);

  // #4182: updateVelocity(0.01F) takes zza*0.98 (LivingEntity.tickMovement), then the 0.9 drag
  EL.list.length = 0;
  const z = EL.spawn('cod', 0.5, 3.5, 0.5);
  z.inWater = true; z.vx = 0; z.vy = 0; z.vz = 0; z.yaw = 0; z.zza = 1;
  Fh.travelMob(z);
  ok(Math.abs(z.vz + 0.0098 * 0.9) < 1e-9, `water impulse is zza*0.98*0.01 — got vz ${z.vz}`);

  // #3077: the -0.005 sink is gated only on getTarget()==null, not on a recent attacker
  EL.list.length = 0;
  const h = EL.spawn('cod', 0.5, 3.5, 0.5);
  h.inWater = true; h.vx = 0; h.vy = 0; h.vz = 0;
  h.lastHurtByEntity = { x: h.x + 2, y: h.y, z: h.z, dead: false, removed: false };
  Fh.travelMob(h);
  ok(Math.abs(h.vy + 0.005) < 1e-9, `hurt fish still sinks -0.005 in water — got ${h.vy}`);

  EL.list.length = 0;
  const g = EL.spawn('cod', 0.5, 5.5, 0.5);
  g.inWater = false; g.onGround = false; g.vy = 0;
  Fh.travelMob(g);
  okAv(g.vy < 0, 'Fish.travelMob (land) really delegates to Ph.travelMob — gravity was applied');
}

// §8 spawn rules — WaterCreatureEntity.canSpawn (shared with squid) / canTropicalFishSpawn
{
  const SL = 63;
  for (let y = 30; y <= 70; y++) W.setBlock(10, y, 10, water);
  W.setBlock(10, 29, 10, stone);
  ok(Fh.canSpawn(10, 50, 10, SL), 'mid-column water, within 13 of sea level: a fish may spawn');
  ok(!Fh.canSpawn(10, SL - 14, 10, SL), 'one below the -13 band: refused');
  ok(!Fh.canSpawn(10, SL + 1, 10, SL), 'above sea level: refused');
  W.setBlock(10, 49, 10, S.stateOf('seagrass') | 0);
  ok(Fh.canSpawn(10, 50, 10, SL), 'seagrass below (water FLUID, not the water block): a fish may spawn (#3050)');
  W.setBlock(10, 49, 10, S.stateOf('kelp') | 0);
  ok(Fh.canSpawn(10, 50, 10, SL), 'kelp below: a fish may spawn (#3050)');
  W.setBlock(10, 49, 10, stone);
  okAv(!Fh.canSpawn(10, 50, 10, SL), 'stone below still refuses — the fluid test is consulted');
  W.setBlock(10, 49, 10, water);

  ok(typeof Spawn.RULES.cod === 'function' && Spawn.canPlace('cod'), 'Spawn.RULES.cod is wired');
  ok(typeof Spawn.RULES.salmon === 'function' && Spawn.canPlace('salmon'), 'Spawn.RULES.salmon is wired');
  ok(typeof Spawn.RULES.pufferfish === 'function' && Spawn.canPlace('pufferfish'), 'Spawn.RULES.pufferfish is wired');
  ok(typeof Spawn.RULES.tropical_fish === 'function' && Spawn.canPlace('tropical_fish'), 'Spawn.RULES.tropical_fish is wired');
  okAv(!Spawn.canPlace('bee'), 'bee still has no placement rule — named on Spawn.OWED, not guessed');   // loop/panda-axolotl-s101: panda/axolotl left this closed set

  // tropical: fluid below water + water above + (lush_caves biome || WaterCreature.canSpawn)
  W.setBlock(20, 49, 20, water);
  W.setBlock(20, 51, 20, water);
  M.Biomes = { ready: true, names: ['minecraft:plains', 'minecraft:lush_caves'] };
  M.World.biomeAt = () => 1;
  ok(Fh.tropicalCanSpawn(20, 50, 20, SL + 40), 'water below + water above + lush_caves: spawns even outside the sea-level band');
  M.World.biomeAt = () => 0;
  okAv(!Fh.tropicalCanSpawn(20, 50, 20, SL + 40), 'same spot, non-lush biome, outside band: refuses — the biome test is consulted');
  ok(Fh.tropicalCanSpawn(20, 50, 20, SL), 'ordinary biome inside the band falls back to WaterCreature.canSpawn');
  W.setBlock(20, 51, 20, sand);
  M.World.biomeAt = () => 1;
  okAv(!Fh.tropicalCanSpawn(20, 50, 20, SL), 'non-water above refuses even in lush_caves');
}

// loop/mob-wiring-bat-fish (session 141) -- §9: the LIVE wiring. D-710 (session 140) flagged
// that cod/salmon/tropical_fish/pufferfish might share the exact glow_squid shape it fixed:
// `Fish.tick`/`Fish.travelMob` are dispatched from INSIDE `EL.tickMob` by `e.type` (see the
// `NS.Fish.tick`/`NS.Fish.travelMob` calls in 07i_entitylist.js), never through a real
// `Ai.ROSTER` entry (there is no `Ai.ROSTER.cod`/`.salmon`/`.tropical_fish`/`.pufferfish`
// anywhere in 07k_goals.js), so `e.ai` is never set for a live-spawned fish -- and
// `EL.tickOne`'s own `mob = !!e.ai || EL.WATER_TICK_ONLY[e.type]` gate is the ONLY other door
// into `EL.tickMob`. Confirmed true this pass: before the fix, all four types sat at 0.0000
// blocks moved after 60 real `EL.tickOne()` calls through the PRODUCTION dispatch (the same
// `EL.spawn` + repeated `EL.tickOne` shape squidcheck's own §10 already proves for
// glow_squid), despite `Fish.tick`/`Fish.travelMob` being fully implemented and well tested by
// every section above. Fixed by adding the four fish types to `EL.WATER_TICK_ONLY`
// (07i_entitylist.js), the exact mechanism D-710 already used for glow_squid.
{
  const seaBox = (fill) => { for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 0; y <= 7; y++) {
    const wall = x === -3 || x === 3 || z === -3 || z === 3 || y === 0 || y === 7;
    W.setBlock(x, y, z, wall ? stone : fill);
  } };
  seaBox(water);
  for (const type of ['cod', 'salmon', 'tropical_fish', 'pufferfish']) {
    EL.list.length = 0;
    const e = EL.spawn(type, 0.5, 3.5, 0.5);
    ok(!e.ai, `a live ${type} still gets no e.ai (no Ai.ROSTER entry -- unchanged, by design, same as squid/glow_squid)`);
    ok(EL.WATER_TICK_ONLY && EL.WATER_TICK_ONLY[type] === 1,
       `but EL.WATER_TICK_ONLY marks ${type} so EL.tickOne routes it into EL.tickMob anyway`);
    const x0 = e.x, y0 = e.y, z0 = e.z;
    for (let t = 0; t < 400; t++) EL.tickOne(e);
    const moved = Math.hypot(e.x - x0, e.y - y0, e.z - z0);
    // anti-vacuity: with EL.WATER_TICK_ONLY reverted to squid/glow_squid only (git stash of
    // 07i_entitylist.js), e.ai stays falsy, EL.tickOne never reaches EL.tickMob, and every one
    // of these four reads exactly 0.0000 -- reproduced this pass before the fix.
    okAv(moved > 0.01, `400 real EL.tickOne() calls through the PRODUCTION dispatch move a live ${type} (moved ${moved.toFixed(3)} blocks) -- it used to sit dead still (0.000)`);
  }
}

{
  // anti-vacuity: each row prints a check mark only when the filter answers as vanilla does, so a
  // broken isAquaticType (the pre-#1272 set) fails these rows instead of passing silently.
  const T = (type) => M.Fish.isBlowUpTarget({ type });
  const row = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
  for (const type of ['dolphin', 'guardian', 'elder_guardian', 'turtle', 'squid', 'cod'])
    row(!T(type), `BLOW_UP_FILTER ignores aquatic ${type}`);
  for (const type of ['axolotl', 'villager', 'zombie'])
    row(T(type), `BLOW_UP_FILTER matches ${type}`);
  const Gm = M.Gamemode;
  if (Gm) row(!M.Fish.isBlowUpTarget(Object.assign(M.Player, { mode: Gm.CREATIVE })), 'creative player is not a target');
  if (Gm) row(!M.Fish.isBlowUpTarget(Object.assign(M.Player, { mode: Gm.SPECTATOR })), 'spectator player is not a target');
  row(!M.Fish.isBlowUpTarget({ type: 'zombie', health: 0, dead: true }), 'dead mob is not a target');
}

{
  // #4114: inWater is "any water FLUID state in the cell" (isTouchingWater), not the level-0 source only.
  const Ph = M.Physics, wet = (st) => { const ba = Ph.blockAt; Ph.blockAt = () => st; const e = { x: 0.5, y: 3, z: 0.5 }; Ph.updateFluids(e); Ph.blockAt = ba; return e.inWater; };
  for (const nm of ['seagrass', 'kelp', 'tall_seagrass', 'bubble_column', 'water'])
    ok(wet(S.stateOf(nm)) === true, `${nm} cell counts as in water`);
  breaks++; if (wet(S.stateOf('stone')) === false) pass++; else fails.push('anti-vacuity: stone cell is not water');
  breaks++; if (wet(0) === false) pass++; else fails.push('anti-vacuity: air cell is not water');
}

{ // #5567: FishData leader threads through one pack batch
  const mk = (pd) => { const e = { type: 'cod', x: 0, y: 3, z: 0 }; Fh.spawnInit(e, { packData: pd }); return e; };
  const pd = {}, a = mk(pd), b = mk(pd), c = mk(pd);
  ok(a.fishLeader === null && pd.fishLeader === a, 'first pack fish is the FishData leader');
  ok(b.fishLeader === a && c.fishLeader === a && a.fishGroupSize === 3, 'followers have leaderId at tick 0');
  breaks++; const lone = mk({}), lone2 = mk({}); if (lone2.fishLeader === null && lone.fishLeader === null) pass++; else fails.push('anti-vacuity: separate batches share a leader');
}

console.log('================ fishcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('=============================================');
process.exit(fails.length ? 1 : 0);
