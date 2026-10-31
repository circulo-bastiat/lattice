#!/usr/bin/env node
// creepercheck.mjs — loop/creeper-s95 (QUEUE 0.2 G18c): the CREEPER, whole, and the EXPLOSION
// substrate it is the first live caller of.
//
//   node tools/creepercheck.mjs [--verbose]
//
// Sections:
//   1. motion/attributes — the closed set now includes creeper, at the jar's own numbers
//   2. spawn — Spawn.canPlace/categoryOf, its own Monster-shaped rule (distinct from cow's)
//   3. the goal selector — Ai.ROSTER.creeper's own priorities, and CreeperIgniteGoal's math
//   4. the fuse — EL.DEFAULTS.creeper, Cr.tick counting a primed fuse to a real explode()
//   5. blast-resistance maths — R.resist anchored against vanilla's own 1.18.2 numbers
//   6. Ex.collectBlocks / Ex.explode against a real world — obsidian survives, dirt breaks
//   7. mobGriefing off — entities still take damage, no block breaks
//   8. anti-vacuity — break the check's own data and watch it catch the break, both directions

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

console.log('creepercheck — loop/creeper-s95 (QUEUE 0.2 G18c), the creeper + the explosion substrate');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '07zb_creeper.js', '14f_inventory.js', '14l_use.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const W = MCL.World, B = MCL.Behave, CH = MCL.CH, S = MCL.States, R = MCL.Reg;
const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Ex = MCL.Explosion, Cr = MCL.Creeper, Cb = MCL.Combat, Loot = MCL.Loot, It = MCL.Items;

B.init(W);
Ent.init();
EL.init();
Ai.init();
Spawn.init();
Cb.init();
Ex.init();
Cr.init();
MCL.Use.init(W);

ok(Ex.ready, 'Explosion module reports ready');
ok(Cr.ready, 'Creeper module reports ready');

function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  EL.init();
}
function put(x, y, z, name) { W.setBlock(x, y, z, S.stateOf(name) | 0); }

// ═════════════════════ 1. motion / attributes — the closed set now includes creeper ═════════
{
  say('\n§1 motion + attributes');
  const mot = EL.motionFor('creeper');
  ok(!!mot, 'EL.motionFor(creeper) resolves — the closed motion set includes it now');
  ok(mot && mot[0] === 0.08, `creeper gravity is 0.08, the same generic axy.h() value zombie/cow share (got ${mot && mot[0]})`);
  ok(mot && Math.abs(mot[1] - 0.98) < 1e-6, `creeper drag is 0.98 (got ${mot && mot[1]})`);
  ok(EL.canSpawn('creeper'), 'EL.canSpawn(creeper) is true');
  const at = Ent.attrsOf('creeper');
  // ⚠ ANCHORED ON CASES THAT CANNOT BE IN DOUBT (extract-entityattrs.mjs's own standard): a
  // creeper has 20 health, 2 attack damage, a 16-block follow range and 0.25 movement speed —
  // 1.18.2's own createCreeperAttributes()/createHostileAttributes(), unmistakable numbers.
  ok(at && at.hp === 20, `creeper max health is 20 (got ${at && at.hp})`);
  ok(at && at.dmg === 2, `creeper attack damage is 2 (got ${at && at.dmg})`);
  ok(at && at.follow === 16, `creeper follow range is 16 (got ${at && at.follow})`);
  ok(at && Math.abs(at.speed - 0.25) < 1e-6, `creeper movement speed is 0.25 (got ${at && at.speed})`);
}

// ═════════════════════ 2. spawn — its own Monster rule, distinct from cow's Animal one ══════
{
  say('\n§2 Spawn.RULES.creeper');
  ok(Spawn.canPlace('creeper'), 'Spawn.canPlace(creeper) is true');
  ok(Spawn.RULES.creeper !== Spawn.RULES.cow, "creeper's rule is its OWN function, not cow's Animal rule");
  ok(Spawn.RULES.creeper !== Spawn.RULES.zombie, "creeper's rule is its OWN function, not a shared reference to zombie's");
  okAv(!Spawn.canPlace('bogus_type_xyz'), 'a made-up type is still refused by Spawn.canPlace (the closed set is real)');
  const cat = Spawn.categoryOf('creeper');
  ok(cat === 'monster', `creeper's own spawner-list category is 'monster' (got ${cat})`);
}

// ═════════════════════ 3. the goal selector — Ai.ROSTER.creeper ═════════════════════════════
{
  say('\n§3 Ai.ROSTER.creeper + CreeperIgniteGoal');
  ok(typeof Ai.ROSTER.creeper === 'function', 'Ai.ROSTER.creeper exists');
  freshWorld();
  const e = EL.spawn('creeper', 2, 5, 2);
  ok(!!e, 'EL.spawn(creeper) succeeds now that motion resolves');
  ok(!!e.ai, 'the spawned creeper carries a real e.ai (Ai.ROSTER wired it, D-391 shape)');
  const byPrio = (flags) => e.ai.entries.filter((x) => x.flags === flags).map((x) => x.priority).sort((a, b) => a - b);
  const MOVE = Ai.MOVE, JUMP = Ai.JUMP, LOOK = Ai.LOOK, TARGET = Ai.TARGET;
  ok(byPrio(JUMP).indexOf(1) >= 0, 'priority 1 is the float/swim goal (JUMP only: SwimGoal.setControls(JUMP), #1279)');
  ok(e.ai.entries.some((x) => x.goal instanceof Ai.CreeperIgniteGoal && x.priority === 2),
    'priority 2 is a real Ai.CreeperIgniteGoal instance, the jar\'s own number');
  ok(e.ai.entries.some((x) => x.priority === 4 && (x.flags & MOVE) && (x.flags & LOOK)),
    'priority 4 is the melee attack (MOVE|LOOK)');
  ok(byPrio(TARGET).indexOf(1) >= 0 && byPrio(TARGET).indexOf(2) >= 0,
    'targetSelector has priority 1 (ActiveTargetGoal->player) and 2 (RevengeGoal->HurtByTargetGoal)');

  // #2610 CreeperEntity.setTarget refuses a GoatEntity: HurtByTargetGoal must not target a ramming goat
  {
    const hb = e.ai.entries.find((x) => x.goal instanceof Ai.HurtByTargetGoal).goal;
    const goat = { type: 'goat', x: 3, y: 5, z: 2 }, cow = { type: 'cow', x: 3, y: 5, z: 2 };
    e.target = null; e.lastHurtByEntity = goat; hb.start();
    okAv(e.target === null, 'a goat attacker is NOT targeted (CreeperEntity.setTarget instanceof GoatEntity)');
    e.lastHurtByEntity = cow; hb.start();
    ok(e.target === cow, 'control: a non-goat attacker IS targeted');
    e.target = null; e.lastHurtByEntity = null;
  }

  // CreeperIgniteGoal's own math, both directions (D-30 rule 6): close primes, far does not.
  const ctx = EL.aiCtx(e);
  const goal = new Ai.CreeperIgniteGoal(e);
  e.target = null; e.fuseSpeed = -1;
  ok(!goal.canUse(), 'no target, no running fuse -> canStart is false');
  const near = EL.spawn('creeper', 4, 5, 2);   // a live entity 2 blocks away (distSq=4 < 9)
  e.target = near;
  ok(goal.canUse(), 'a target within 3 blocks (distSq<9) -> canStart is true');
  const far = { x: 20, y: 5, z: 2 };            // distSq = 18^2 = 324, nowhere near 9
  e.target = far;
  ok(!goal.canUse(), 'a target at distance 18 with no fuse already running -> canStart is false');
  e.fuseSpeed = 1;   // fuse already running: canStart is true regardless of target distance
  ok(goal.canUse(), 'a fuse already running (fuseSpeed>0) -> canStart is true even far away');
  goal.start();
  goal.tick();
  ok(e.fuseSpeed === -1, 'tick(): target beyond 7 blocks (distSq>49) counts the fuse back down');
  e.target = near; e.fuseSpeed = -1;
  goal.start();
  goal.tick();
  ok(e.fuseSpeed === 1, 'tick(): target within 7 blocks -> fuseSpeed is set to 1');
  // #1794: a solid wall between creeper and target (inside 7 blocks) defuses; open air primes.
  e.target = near; e.fuseSpeed = 1;
  const wallSeen = [];
  for (const wy of [5, 6, 7]) { wallSeen.push([3, wy]); }
  const stone = S.stateOf('stone');
  let walled = false;
  if (stone) {
    for (const [wx, wy] of wallSeen) for (let wz = 0; wz <= 4; wz++) W.setBlock(wx, wy, wz, stone);
    walled = true;
  }
  goal.start(); goal.tick();
  okAv(walled && e.fuseSpeed === -1, 'a solid wall between creeper and target (<7 blocks) -> fuseSpeed -1 (#1794)');
  goal.stop();
}

// ═════════════════════ 4. the fuse — EL.DEFAULTS.creeper + Cr.tick -> a real explode() ══════
{
  say('\n§4 the fuse');
  freshWorld();
  const e = EL.spawn('creeper', 5, 5, 5);
  ok(e.fuseTime === 30, `EL.DEFAULTS.creeper sets fuseTime=30 (got ${e.fuseTime})`);
  ok(e.explosionRadius === 3, `EL.DEFAULTS.creeper sets explosionRadius=3 (got ${e.explosionRadius})`);
  ok(e.fuseSpeed === -1, `a fresh creeper's own fuseSpeed defaults to -1 (got ${e.fuseSpeed})`);
  ok(e.charged === false, 'a fresh creeper is not charged');
  Cr.ignite(e);
  ok(e.ignited === true, 'Cr.ignite(e) sets the latch');
  let exploded = 0;
  const hiss = [];
  const hadSound = !!MCL.Sound; if (!hadSound) MCL.Sound = {};
  const realPlay = MCL.Sound.play;
  MCL.Sound.play = (ev, o) => { if (ev === 'entity.creeper.primed') hiss.push(o); return null; };
  const realExplode = Ex.explode;
  Ex.explode = (...a) => { exploded++; return realExplode.apply(Ex, a); };
  for (let i = 0; i < 40 && !e.removed; i++) Cr.tick(e);
  Ex.explode = realExplode;
  MCL.Sound.play = realPlay;
  ok(hiss.length === 1 && hiss[0].pitch === 0.5 && hiss[0].volume === 1, `the fuse-start hiss entity.creeper.primed plays once at pitch 0.5 on the 0->1 tick, not while the fuse continues (got ${hiss.length})`);
  okAv((function () { const e3 = EL.spawn('creeper', 5, 5, 5); let n = 0; MCL.Sound.play = () => { n++; }; for (let i = 0; i < 10; i++) Cr.tick(e3); MCL.Sound.play = realPlay; return n === 0; })(),
    'an unignited creeper (fuseSpeed -1) never hisses');
  ok(exploded === 1, `a 30-tick fuse (ignited) explodes exactly once inside 40 ticks (got ${exploded})`);
  ok(e.dead === true && e.removed === true, 'the exploded creeper is dead and removed');
  okAv(!(function () { const e2 = EL.spawn('creeper', 5, 5, 5); for (let i = 0; i < 40; i++) Cr.tick(e2); return e2.removed; })(),
    "an UNIGNITED creeper (fuseSpeed=-1 for ever) never explodes in 40 ticks — Cr.tick is not a bare timer");
  // #4382: vanilla runs the fuse BEFORE the goals, so a fuseSpeed the goal writes in tick N is first consumed in N+1: goal write -> boom is exactly fuseTime ticks.
  const ticksToBoom = function () {
    const c = EL.spawn('creeper', 5, 5, 5); let n = 0, wrote = false, gone = false;
    c.ai = { tick() { if (!wrote) { wrote = true; c.fuseSpeed = 1; } } };
    const rx = Ex.explode; Ex.explode = (...a) => { gone = true; return rx.apply(Ex, a); };
    for (let i = 0; i < 60 && !gone; i++) { EL.tickMob(c); n++; }
    Ex.explode = rx; return n - 1;   // tick 1 = the goal's write
  }();
  okAv(ticksToBoom === 30, `goal's first fuseSpeed=1 write to explode is exactly fuseTime=30 ticks (got ${ticksToBoom})`);
}

// ═════════════════════ 5. blast-resistance maths — anchored on vanilla's own 1.18.2 numbers ═
{
  say('\n§5 blast resistance anchors');
  // ⚠ THESE CANNOT BE IN DOUBT (the same standard extract-entityattrs.mjs already holds itself
  // to): dirt's blast resistance is 0.5, obsidian's is 1200, stone's is 6 — 1.18.2's own
  // `Blocks.<clinit>` registrations, unmistakable numbers repeated in every technical breakdown
  // of TNT/creeper blast radius ever written about this version.
  const dirtR = R.resist[R.id.dirt];
  const obsR = R.resist[R.id.obsidian];
  const stoneR = R.resist[R.id.stone];
  ok(Math.abs(dirtR - 0.5) < 1e-6, `dirt's own blast resistance is 0.5 (got ${dirtR})`);
  ok(Math.abs(obsR - 1200) < 1e-6, `obsidian's own blast resistance is 1200 (got ${obsR})`);
  ok(Math.abs(stoneR - 6) < 1e-6, `stone's own blast resistance is 6 (got ${stoneR})`);
  ok(obsR > dirtR * 2000, 'obsidian resists a blast roughly 2400x harder than dirt — not a rounding artefact');
}

// ═════════════════════ 6. Ex.collectBlocks/Ex.explode — obsidian survives, dirt breaks ══════
{
  say('\n§6 a real explosion — obsidian survives, dirt breaks');
  freshWorld();
  const cx = 0, cy = 8, cz = 0;
  // A slab of dirt one block from the blast centre (guaranteed inside a power-3 blast: the
  // open-air range alone is ~3/0.225*0.3 ≈ 4 blocks, and a ray THROUGH this cell loses only
  // (0.5+0.3)*0.3=0.24 to it — nowhere near enough to survive at range 1).
  put(cx + 1, cy, cz, 'dirt');
  put(cx - 1, cy, cz, 'dirt');
  put(cx, cy + 1, cz, 'dirt');
  // Obsidian at the SAME distance (1 block) — resistance 1200 costs a ray (1200+0.3)*0.3=360.09
  // in ONE step, which is vastly more than a power-3 ray's own starting budget (~3*1.3=3.9 max),
  // so it cannot possibly break, however the direction/jitter falls.
  put(cx, cy - 1, cz, 'obsidian');
  put(cx, cy, cz + 1, 'obsidian');
  const before = {
    dirt1: W.getBlock(cx + 1, cy, cz), dirt2: W.getBlock(cx - 1, cy, cz), dirt3: W.getBlock(cx, cy + 1, cz),
    obs1: W.getBlock(cx, cy - 1, cz), obs2: W.getBlock(cx, cy, cz + 1)
  };
  ok(before.dirt1 !== 0 && before.obs1 !== 0, 'both test blocks are really placed before the blast');
  const rng = (() => { let n = 12345; return () => { n = (n * 1103515245 + 12345) & 0x7fffffff; return n / 0x7fffffff; }; })();
  const result = Ex.explode(null, cx + 0.5, cy + 0.5, cz + 0.5, 3, true, rng);
  ok(result.blocks > 0, `the blast actually broke something (broke ${result.blocks})`);
  ok(W.getBlock(cx + 1, cy, cz) === 0 && W.getBlock(cx - 1, cy, cz) === 0 && W.getBlock(cx, cy + 1, cz) === 0,
    'every dirt block one step from the centre broke');
  ok(W.getBlock(cx, cy - 1, cz) === before.obs1 && W.getBlock(cx, cy, cz + 1) === before.obs2,
    'both obsidian blocks, at the SAME distance, survived — resistance is load-bearing, not cosmetic');
}

// ═════════════════════ 7. mobGriefing off — entities still hurt, nothing breaks ═════════════
{
  say('\n§7 mobGriefing off');
  freshWorld();
  const cx = 0, cy = 20, cz = 0;   // high up, well clear of any generated terrain below
  put(cx - 4, cy, cz, 'dirt');     // off to one side — nowhere near the cow's own line of sight
  const cow = EL.spawn('cow', cx + 0.5, cy, cz + 0.5);   // directly beside the blast centre, open air
  ok(!!cow, 'a cow exists to be hurt by the blast');
  const before = W.getBlock(cx - 4, cy, cz);
  const healthBefore = cow.health;
  const res = Ex.explode(null, cx, cy, cz, 3, false);
  ok(res.blocks === 0, `griefing off -> zero blocks broken (got ${res.blocks})`);
  ok(W.getBlock(cx - 4, cy, cz) === before, 'the dirt block is untouched with mobGriefing off');
  ok(cow.health < healthBefore, `the cow still took damage with mobGriefing off (before ${healthBefore}, after ${cow.health}) — collectBlocksAndDamageEntities runs unconditionally`);
}

// ═════════════════════ 4b. #1792 handleFallDamage winds the fuse ══════════════════════════
{
  say('\n§4b fall winds the fuse');
  freshWorld();
  const Ph = MCL.Physics;
  const land = (d) => { const c = EL.spawn('creeper', 5, 5, 5); Ph.landed(c, d, -1); return c.currentFuseTime; };
  ok(land(6) === 9, 'fallDistance 6 from fuse 0 -> currentFuseTime 9');
  ok(land(40) === 25, 'fallDistance 40 clamps to fuseTime-5 = 25');
  okAv(land(0.5) === 0, 'a tiny fall ((int)0.75 = 0) leaves the fuse at 0 — not a flat bump');
  okAv((function () { const c = EL.spawn('creeper', 5, 5, 5); c.type = 'zombie'; Ph.landed(c, 6, -1); return c.currentFuseTime || 0; })() === 0,
    'a non-creeper falling gets no fuse — the hook is creeper-only');
}

// ═════════════════════ 7c. spawnEffectsCloud ═════════════════════════════════════════════════
{
  say('\n§7c effects cloud');
  const clouds = () => EL.list.filter((x) => x.type === 'area_effect_cloud' && !x.removed);
  freshWorld();
  const plain = EL.spawn('creeper', 5, 20, 5);
  Cr.explode(plain);
  ok(clouds().length === 0, 'a creeper without effects leaves no cloud');
  freshWorld();
  const c = EL.spawn('creeper', 5, 20, 5);
  c.effects = { poison: { effect: 'poison', duration: 200, amplifier: 1 } };
  Cr.explode(c);
  const cl = clouds();
  ok(cl.length === 1, `an effect creeper leaves exactly one cloud (got ${cl.length})`);
  const k = cl[0];
  if (k) {
    ok(k.radius === 2.5 && k.radiusOnUse === -0.5 && k.waitTime === 10 && k.duration === 300, 'cloud radius/radiusOnUse/waitTime/duration are 2.5/-0.5/10/300');
    ok(Math.abs(k.radiusGrowth + 2.5 / 300) < 1e-9, 'radiusGrowth = -radius/duration');
    ok(k.custom && k.custom.length === 1 && k.custom[0].effect === 'poison' && k.custom[0].amplifier === 1 && k.custom[0].duration === 200, 'the cloud copies the effect');
  }
  {
    const cr = { type: 'creeper' }, goat = { type: 'goat' }, cow = { type: 'cow' };
    ok(!Ai.canTargetLiving(goat, cr) && Ai.canTargetLiving(cow, cr), 'CreeperEntity.setTarget refuses a goat, still takes other mobs');
    breaks++; ok(Ai.canTargetLiving(goat, { type: 'zombie' }), 'anti-vacuity: a zombie may target a goat');
  }
  breaks++; ok(clouds().length === 1 && cl.length !== 0, 'anti-vacuity: the no-effect run really differs from the effect run');
  console.log('   ✓ anti-vacuity: effect vs no-effect creeper');
}

// ═════════════════════ 7b. #1791 — flint and steel on a creeper plays its sound ═════════════
{
  say('\n§7b flint-and-steel ignite sound');
  freshWorld();
  const cr = EL.spawn('creeper', 0.5, 20, 0.5);
  const fs = { i: It.of('flint_and_steel'), n: 1, d: 0 };
  const P = { instabuild: true, x: 0, y: 20, z: 3 };
  const plays = [];
  const realPlay = MCL.Sound && MCL.Sound.play;
  MCL.Sound = Object.assign(MCL.Sound || {}, { play: (ev, o) => { plays.push([ev, o]); } });
  const used = MCL.Use.entityUse(P, cr, fs);
  const hits = plays.filter((p) => p[0] === 'item.flintandsteel.use');
  ok(used === true && !!cr.ignited, 'right-clicking a creeper with flint and steel ignites it');
  ok(hits.length === 1, `exactly one item.flintandsteel.use played (got ${hits.length})`);
  const o = hits[0] && hits[0][1];
  ok(o && o.x === cr.x && o.y === cr.y && o.z === cr.z && o.source === 'hostile', 'at the creeper, hostile category');
  ok(o && o.pitch >= 0.8 && o.pitch < 1.2, 'pitch random*0.4+0.8');
  // anti-vacuity: with the sound call silenced the same assertion must fail
  plays.length = 0;
  MCL.Sound.play = () => {};
  const cr2 = EL.spawn('creeper', 0.5, 20, 4.5);
  MCL.Use.entityUse(P, cr2, fs);
  okAv(plays.filter((p) => p[0] === 'item.flintandsteel.use').length === 0, 'with Sound.play stubbed away, no click is recorded -- the check sees the call');
  MCL.Sound.play = realPlay;
}

// ═════════════════════ 7b. getSafeFallDistance — a targeted creeper paths down a 5-block ledge ═════
{
  freshWorld();
  for (let x = 0; x <= 2; x++) for (let z = -2; z <= 2; z++) put(x, 19, z, 'stone');
  for (let x = 3; x <= 8; x++) for (let z = -2; z <= 2; z++) put(x, 14, z, 'stone');
  const go = (mob) => Ai.findPath(1.5, 20, 0.5, 6.5, 15, 0.5, { maxDrop: 1, mob });
  const tgt = go({ type: 'creeper', health: 20, target: {} });
  const none = go({ type: 'creeper', health: 20, target: null });
  ok(!!tgt, 'a creeper WITH a target (safe fall 3+19) paths down a 5-block ledge');
  okAv(!none, 'the same creeper with no target (safe fall 3) refuses the 5-block drop -- the target gate is real');
  okAv(!go({ type: 'zombie', health: 20, target: {} }), 'a zombie with a target still refuses it -- the override is creeper-only');
}

// ═════════════════════ 8. anti-vacuity — break the data, watch the check catch it ═══════════
{
  say('\n§8 anti-vacuity');
  freshWorld();
  const cx = 0, cy = 8, cz = 0;
  put(cx + 1, cy, cz, 'obsidian');
  const obsId = R.id.obsidian;
  const real = R.resist[obsId];
  R.resist[obsId] = 0;   // break the resistance table itself
  const r2 = Ex.explode(null, cx + 0.5, cy + 0.5, cz + 0.5, 3, true);
  okAv(W.getBlock(cx + 1, cy, cz) === 0,
    'with obsidian\'s OWN resistance zeroed out, the SAME explosion breaks it -- proving §6\'s ' +
    '"obsidian survives" result is the resistance table talking, not a coordinate/geometry fluke');
  R.resist[obsId] = real;

  freshWorld();
  put(cx, cy, cz, 'dirt');
  okAv(!Ex.affectWorld(null, {}, true, 3) && W.getBlock(cx, cy, cz) !== 0,
    'Ex.affectWorld given an EMPTY affected-set breaks nothing at all — the destroy pass only ' +
    'ever touches what collectBlocks actually handed it, not "everything nearby"');

  // CreeperEntity.tryAttack() { return true; } -- the melee swing never damages (#3097)
  {
    const tgt = { health: 20 }, realSv = MCL.Survival, realP = MCL.Player;
    let hurts = 0;
    MCL.Survival = { hurt: () => { hurts++; return true; } }; MCL.Player = tgt;
    const cr = EL.spawn('creeper', 0.5, 20, 0.5);
    ok(MCL.Combat.mobAttack(cr, tgt) === null && hurts === 0, 'Combat.mobAttack(creeper, player) returns null and deals no damage');
    cr.type = 'zombie'; MCL.Combat.mobAttack(cr, tgt);
    okAv(hurts === 1, 'the same call as a zombie DOES hurt the stub player -- the creeper guard is what stops it');
    MCL.Survival = realSv; MCL.Player = realP;
  }

  ok(Ex.OWED.length > 0, 'Ex.OWED names what this substrate does not model (D-30: named, not silent)');
  ok(Cr.OWED.length > 0, 'Cr.OWED names what the creeper unit does not model (D-30: named, not silent)');
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
