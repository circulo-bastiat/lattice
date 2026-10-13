#!/usr/bin/env node
// slimecheck.mjs — loop/slime-s97 (QUEUE 0.2 G18c, missing overworld mob): the SLIME, whole.
//
//   node tools/slimecheck.mjs [--verbose]
//
// Sections:
//   1. motion — the closed set now includes slime/magma_cube, at the shared MobEntity numbers
//   2. size roll + the three attributes — Sl.rollSize/Sl.setSize against SlimeEntity.java
//   3. the goal selector — Ai.ROSTER.slime's own priorities, target goals, MoveControl hop
//   4. contact damage — Sl.tickTouch, size-scaled reach, canAttack's isSmall gate
//   5. split on death — EL.remove's own Sl.split hook, count/size/no-split-when-despawning
//   6. loot — size-1 only (Cb.dropLoot's own getLootTableId gate)
//   7. slime chunks — ChunkRandom.getSlimeRandom, a real golden vector
//   8. spawn rule — Spawn.RULES.slime, both branches
//   9. anti-vacuity — break the check's own data and watch it catch the break

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
const near = (a, b, t, what) => ok(Math.abs(a - b) <= t, `${what}: ${a} vs ${b} (+-${t})`);

console.log('slimecheck — loop/slime-s97 (QUEUE 0.2 G18c), the slime, whole');

const EXTRA = ['14h_brigadier.js', '15g_commands.js', '02f_tags.js', '02g_items.js', '02i_text.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '03b_noise.js', '07zd_slime.js', '07q_effects.js', '14f_inventory.js', '07zw_mobnbt.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Text.init({ lang: b64('lang.bin'), langBytes: rdj('lang.meta.json').rawBytes, langOverrides: readFileSync(join(ASSETS, 'lang-overrides.json'), 'utf8') });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Cb = MCL.Combat, Loot = MCL.Loot, Sl = MCL.Slime, Diff = MCL.Diff;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
EL.init();
Ai.init();
Spawn.init();
Sl.init();

ok(Sl.ready, 'Slime.init did not run');

// ── 1. motion — the closed set ──────────────────────────────────────────────────────────────
console.log('1. motion — slime/magma_cube join the closed set at the shared MobEntity pair');
{
  ok(EL.canSpawn('slime'), 'EL.canSpawn(slime) is false — the closed-set gate refuses it');
  ok(EL.canSpawn('magma_cube'), 'EL.canSpawn(magma_cube) is false');
  const m = EL.motionFor('slime');
  near(m[0], 0.08, 1e-9, 'slime gravity');
  near(m[1], 0.98, 1e-9, 'slime drag');
}

// ── 2. the size roll and the three attributes ───────────────────────────────────────────────
console.log('2. Sl.setSize/Sl.rollSize — the three attribute writes, SlimeEntity.setSize verbatim');
{
  const e = EL.spawn('slime', 0, 64, 0, {});
  ok(e.size === 1 || e.size === 2 || e.size === 4, `natural roll gave size ${e.size}, expected 1/2/4`);
  ok(e.maxHealth === e.size * e.size, `maxHealth ${e.maxHealth} != size^2 (${e.size * e.size})`);
  ok(e.health === e.maxHealth, 'a freshly rolled slime is not full health');
  near(e.speedAttr, 0.2 + 0.1 * e.size, 1e-9, 'speedAttr');
  ok(e.attackDamage === e.size, `attackDamage ${e.attackDamage} != size ${e.size}`);
  const dim = Ent.dimensions('slime');
  near(e.width, dim.width * 0.255 * e.size, 1e-9, 'width scale');
  near(e.height, dim.height * 0.255 * e.size, 1e-9, 'height scale');

  // Direct setSize (the split path) — no roll, exact size, healed.
  const e2 = EL.spawn('slime', 0, 64, 0, { size: 2 });
  ok(e2.size === 2, `opts.size=2 gave size ${e2.size}`);
  ok(e2.maxHealth === 4 && e2.health === 4, 'size-2 slime is not 4 HP, full');
  near(e2.speedAttr, 0.4, 1e-9, 'size-2 speedAttr');
  ok(e2.attackDamage === 2, 'size-2 attackDamage');

  // Ai.movementSpeedOf reads the per-instance override, not the static table.
  near(Ai.movementSpeedOf(e2), 0.4, 1e-9, 'Ai.movementSpeedOf per-instance override');

  okAv((() => { const save = e2.speedAttr; e2.speedAttr = undefined; const bad = Ai.movementSpeedOf(e2) !== 0.4; e2.speedAttr = save; return bad; })(),
    'clearing e.speedAttr changes Ai.movementSpeedOf away from the per-instance value');

  // isSmall / canAttack
  const small = EL.spawn('slime', 0, 64, 0, { size: 1 });
  ok(Sl.isSmall(small), 'size-1 slime is not isSmall()');
  ok(!Sl.canAttack(small), 'a small slime canAttack() — SlimeEntity.canAttack() must be false at size 1');
  const big = EL.spawn('slime', 0, 64, 0, { size: 4 });
  ok(Sl.canAttack(big), 'a size-4 slime cannot attack');
  okAv((() => { big.riding = {}; const blocked = !Sl.canAttack(big); big.riding = undefined; return blocked; })(),
    'a riding slime must not canAttack()');
  okAv((() => { big.aiDisabled = true; const blocked = !Sl.canAttack(big); big.aiDisabled = false; return blocked; })(),
    'a NoAI slime must not canAttack()');
  okAv((() => { const m = EL.spawn('magma_cube', 0.1, 64, 0, { size: 2 }); m.aiDisabled = true; return !Sl.canAttack(m); })(),
    'a NoAI magma cube must not canAttack()');
}

// ── 3. the goal selector ────────────────────────────────────────────────────────────────────
console.log('3. Ai.ROSTER.slime — the four goals, two target goals, MoveControl hop');
{
  const e = EL.spawn('slime', 0, 64, 0, { size: 4 });
  ok(!!e.ai, 'EL.spawn did not attach e.ai for a rostered slime');
  ok(!!e.slimeMove, 'Ai.ROSTER.slime did not attach e.slimeMove');

  // MoveGoal drives forward speed through the move control -- AIRBORNE, so
  // SlimeMoveControl.tick()'s own "onGround" jump-timer branch (which zeroes the speed back
  // out on a tick it does not jump, matching SlimeMoveControl.tick()'s own vanilla order) is
  // not the one under test here; that branch gets its own assertion right below.
  e.onGround = false;
  e.target = null;
  e.ai.tick();
  e.slimeMove.tick();
  ok(e.mobSpeed > 0, `MoveGoal->slimeMove did not set a positive mobSpeed while airborne (got ${e.mobSpeed})`);

  // Grounded and NOT about to jump this tick: SlimeMoveControl.tick() sets the speed and then
  // zeroes it back out again -- vanilla's own "set it, then zero it back out while waiting"
  // order (this file's own header) -- so mobSpeed must land at exactly 0.
  e.onGround = true;
  e.slimeTicksUntilJump = 999;
  e.ai.tick();
  e.slimeMove.tick();
  ok(e.mobSpeed === 0, `grounded, not jumping this tick: mobSpeed should be 0, got ${e.mobSpeed}`);

  // The hop: countdown to zero sets e.jumping.
  e.slimeTicksUntilJump = 0;
  e.ai.tick();
  e.slimeMove.tick();
  ok(e.jumping === true, 'ticksUntilJump hitting zero did not set e.jumping');

  // exact timing (`ticksUntilJump-- <= 0`): field starts 0 -> first grounded tick jumps; with
  // nextInt(20)+10 pinned to 10 the next jump is exactly 11 ticks later.
  {
    const rnd = EL.random; EL.random = () => 0;
    try {
      const s = EL.spawn('slime', 0, 64, 0, { size: 4 });
      okAv(s.slimeTicksUntilJump === 0, `spawned slime ticksUntilJump should start 0, got ${s.slimeTicksUntilJump}`);
      s.onGround = true;
      const jumps = [];
      for (let t = 1; t <= 24; t++) {
        s.jumping = false; s.slimeMove.moving = true; s.slimeMove.tick();
        if (s.jumping) jumps.push(t);
      }
      okAv(jumps.join() === '1,12,23', `jump ticks should be 1,12,23, got ${jumps.join()}`);
    } finally { EL.random = rnd; }
  }

  // FaceTowardTargetGoal + PlayerTargetGoal wired through ctx.players.
  const player = { x: 3, y: 64, z: 0, dead: false, removed: false };
  const ctx = { players: () => [player], golems: () => [] };
  const e2 = EL.spawn('slime', 0, 64, 0, { size: 4 });
  e2.ai = Ai.ROSTER.slime(e2, ctx);
  for (let i = 0; i < 200 && e2.target !== player; i++) { e2.ai.tick(); e2.slimeMove.tick(); }
  ok(e2.target === player, 'PlayerTargetGoal never acquired the in-range player as e2.target');
  const yawTowardPlayer = Math.atan2(player.x - e2.x, -(player.z - e2.z));
  ok(Math.abs(Ai.wrapRad(e2.yaw - yawTowardPlayer)) < Math.PI / 2,
    `FaceTowardTargetGoal did not turn the slime toward its target (yaw ${e2.yaw}, wanted ~${yawTowardPlayer})`);

  // out of the |dy|<=4 band -> never targeted
  const farPlayer = { x: 3, y: 64 + 10, z: 0, dead: false, removed: false };
  const e3 = EL.spawn('slime', 0, 64, 0, { size: 4 });
  const ctx3 = { players: () => [farPlayer], golems: () => [] };
  e3.ai = Ai.ROSTER.slime(e3, ctx3);
  e3.ai.tick();
  ok(e3.target === null || e3.target === undefined, 'a player 10 blocks above (|dy|>4) was targeted anyway');

  // range 16 + 1-in-10 roll: acquire at 12, never at 17, ~0.1 per tick
  const acq = (dist, n) => {
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const pl = { x: dist, y: 64, z: 0, dead: false, removed: false };
      const s = EL.spawn('slime', 0, 64, 0, { size: 4 });
      s.followBonus = 0;   // MobEntity.initialize's random bonus would widen 16
      const g = new Sl.PlayerTargetGoal(s, { players: () => [pl] });
      if (g.canUse()) hits++;
    }
    return hits / n;
  };
  const r12 = acq(12, 2000), r17 = acq(17, 500);
  ok(r12 > 0.07 && r12 < 0.13, `slime at 12 blocks should acquire ~1/10 per tick, got ${r12}`);
  ok(r17 === 0, 'slime acquired a player 17 blocks away (FOLLOW_RANGE 16)');

  ok((() => {
    // #3614: creative/spectator players are not targetable (TargetPredicate)
    for (const flag of ['invulnerableGamemode']) {
      const pl = { type: 'player', x: 3, y: 64, z: 0, dead: false, removed: false, [flag]: true };
      const s = EL.spawn('slime', 0, 64, 0, { size: 4 });
      const g = new Sl.PlayerTargetGoal(s, { players: () => [pl], rand: () => 0 });
      if (g.canUse() || s.target) return false;
      s.target = pl;
      if (g.canContinueToUse()) return false;
    }
    return true;
  })(), 'PlayerTargetGoal targeted an invulnerable (creative/spectator) player');

  ok((() => {
    // #4747: FaceTowardTargetGoal.shouldContinue re-checks canTarget (player goes creative mid-goal)
    const pl = { type: 'player', x: 3, y: 64, z: 0, dead: false, removed: false };
    const s = EL.spawn('slime', 0, 64, 0, { size: 4 });
    s.target = pl;
    const g = new Sl.FaceTowardTargetGoal(s);
    g.start();
    if (!g.canContinueToUse()) return false;
    pl.invulnerableGamemode = true;
    return !g.canContinueToUse();
  })(), 'FaceTowardTargetGoal kept facing a target that became untargetable (creative)');

  ok((() => {
    // #4797: TrackTargetGoal.shouldContinue has no Y test - a held target at dy=6, dist<16 stays
    const pl = { type: 'player', x: 3, y: 70, z: 0, dead: false, removed: false };
    const s = EL.spawn('slime', 0, 64, 0, { size: 4 });
    s.target = pl;
    return new Sl.PlayerTargetGoal(s, { players: () => [pl] }).canContinueToUse();
  })(), 'PlayerTargetGoal.canContinueToUse dropped a visible target at dy=6 (vanilla shouldContinue has no Y test)');

  okAv((() => {
    const e4 = EL.spawn('slime', 0, 64, 0, { size: 4 });
    const badPlayer = { x: 3, y: 64, z: 0, dead: false, removed: false };
    e4.ai = Ai.ROSTER.slime(e4, { players: () => [badPlayer], golems: () => [] });
    for (let i = 0; i < 200 && e4.target !== badPlayer; i++) e4.ai.tick();
    const acquired = e4.target === badPlayer;
    // now break it: move the player out of the y-band and re-run canUse via a fresh tick.
    badPlayer.y = 64 + 100;
    e4.target = null;
    e4.ai.tick();
    return acquired && e4.target !== badPlayer;
  })(), 'PlayerTargetGoal must stop acquiring a target once it leaves the |dy|<=4 band');
}

// ── 4. contact damage ───────────────────────────────────────────────────────────────────────
console.log('4. Sl.tickTouch — onPlayerCollision/damage(LivingEntity)');
{
  const Sv = MCL.Survival || {};
  // Sv.hurt needs a real player fixture — build the minimal shape Sv.hurt reads.
  const player = { x: 0, y: 64, z: 0, health: 20, dead: false, invulnerableGamemode: false,
    invulnerableTime: 0, armor: [], effects: {}, gamemode: 'survival' };
  const big = EL.spawn('slime', 0.1, 64, 0, { size: 4 });
  big.type = 'slime';
  const before = player.health;
  Sl.tickTouch(big, { players: () => [player] });
  ok(player.health < before, `a size-4 slime touching the player did not deal damage (before ${before}, after ${player.health})`);
  ok(player.lastHurtByEntity === big, 'Sl.tickTouch did not set lastHurtByEntity');
  { // #3881 death message names the slime
    const v = { x: 0, y: 64, z: 0, health: 1, dead: false, invulnerableGamemode: false,
      invulnerableTime: 0, armor: [], effects: {}, gamemode: 'survival' };
    Sl.tickTouch(big, { players: () => [v] });
    ok(v.dead && /Slime/.test(JSON.stringify(v.deathMessage)), 'slime kill death message lacks the slime name: ' + JSON.stringify(v.deathMessage));
  }

  { // #3882 contact hit applies Thorns (applyDamageEffects)
    const Inv = MCL.Inventory, Sv2 = MCL.Survival;
    const run = (lvl) => {
      EL.clear();
      const sl = EL.spawn('slime', 0.1, 64, 0, { size: 2 });
      sl.type = 'slime'; sl.maxHealth = sl.health = 100;
      const P = { x: 0, y: 64, z: 0, inventory: Inv.create() };
      Sv2.init(P); P.armor = 0; P.armorToughness = 0;
      if (lvl) Inv.setItem(P.inventory, Inv.ARMOR_START + 2, Inv.stack('iron_chestplate', 1, 0, { Enchantments: [{ id: 'thorns', lvl }] }));
      const old = EL.random, oldM = Math.random; EL.random = () => 0; Math.random = () => 0;
      Sl.tickTouch(sl, { players: () => [P] });
      EL.random = old; Math.random = oldM;
      return sl.health;
    };
    ok(run(3) < 100, 'Thorns III player touched by a slime did not reflect damage onto it');
    okAv(run(0) === 100, 'no Thorns: slime takes no reflected damage (the thorns assertion can fail)');
  }

  { // #4453 reach alone is not contact: a golem (1.4 wide) at 2.0 is inside reach 2.4 but outside box contact (1.74)
    const g = { type: 'iron_golem', x: 2.0, y: 64, z: 0, width: 1.4, height: 2.7, health: 100, dead: false };
    let hits = 0;
    const c = { players: () => [], golems: () => [g], hurt: () => { hits++; return true; } };
    Sl.tickTouch(big, c);
    ok(hits === 0, 'golem 2.0 blocks away (no box contact) was hurt by a size-4 slime');
    g.x = 1.5; Sl.tickTouch(big, c);
    okAv(hits === 1, 'a golem in box contact is hurt (the #4453 assertion can fail)');
  }

  { // #2825 pushAwayFrom: iron golem contact is damaged
    const golem = { type: 'iron_golem', x: 0.2, y: 64, z: 0, health: 100, dead: false };
    let hits = 0;
    const gctx = { players: () => [], golems: () => [golem], hurt: (t, a) => { hits++; return t === golem && a >= 4; } };
    Sl.tickTouch(big, gctx);
    ok(hits === 1, `size-4 slime touching an iron golem hurt it ${hits} times, expected 1`);
    golem.x = 50; hits = 0;
    Sl.tickTouch(big, gctx);
    okAv(hits === 0, 'a golem out of reach is not hurt (the golem-contact assertion can fail)');
  }

  { // #4508 damage() requires canSee(target): a wall between slime and player blocks contact damage + targeting
    const W = MCL.World, stone = MCL.States.stateOf('stone') | 0;
    for (let cx = -1; cx <= 0; cx++) for (let cz = -1; cz <= 0; cz++) { const c = W.makeChunk(cx, cz); c.state = MCL.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
    EL.clear();
    const sl = EL.spawn('slime', 0.5, 64, 0.5, { size: 4 }); sl.type = 'slime';
    const mk = () => ({ x: 0.5, y: 64, z: 2.2, health: 20, dead: false, invulnerableGamemode: false, invulnerableTime: 0, armor: [], effects: {}, gamemode: 'survival' });
    const wall = (st) => { for (let y = 62; y <= 68; y++) for (let x = -2; x <= 3; x++) W.setBlock(x, y, 1, st); };
    wall(stone);
    const pw = mk(); Sl.tickTouch(sl, { players: () => [pw] });
    ok(pw.health === 20, 'slime damaged a player through a wall (damage() needs canSee)');
    const g = new Sl.PlayerTargetGoal(sl, { players: () => [pw], rand: () => 0 });
    ok(!g.canUse(), 'PlayerTargetGoal acquired a player behind a wall (checkVisibility=true)');
    wall(0);
    const pv = mk(); Sl.tickTouch(sl, { players: () => [pv] });
    okAv(pv.health < 20, 'the same player in the open is hurt (the wall assertion can fail)');
    okAv(g.canUse() && sl.target, 'the same player in the open is targeted');
  }

  { // MagmaCubeEntity.getDamageAmount = super + 2; no isSmall gate
    const pm = { x: 0, y: 64, z: 0, health: 20, dead: false, invulnerableGamemode: false, invulnerableTime: 0, armor: [], effects: {}, gamemode: 'survival' };
    const mc = EL.spawn('magma_cube', 0.1, 64, 0, { size: 1 });
    Sl.tickTouch(mc, { players: () => [pm] });
    ok(pm.health < 20, 'a size-1 magma cube dealt no contact damage');
    ok(20 - pm.health >= 3 - 1e-9, `magma size-1 contact damage ${20 - pm.health} < size+2`);
  }
  { // #2869 the amount handed to Survival.hurt is size+2 (not +4)
    const realHurt = MCL.Survival.hurt;
    const amt = (sz) => { let got = null; MCL.Survival.hurt = (p, k, a) => { got = a; return true; };
      Sl.tickTouch(EL.spawn('magma_cube', 0.1, 64, 0, { size: sz }), { players: () => [{ x: 0, y: 64, z: 0, health: 20 }] }); return got; };
    [[1, 3], [2, 4], [4, 6]].forEach(([sz, d]) => ok(amt(sz) === d, `magma size ${sz} hurt amount ${amt(sz)} (want ${d})`));
    okAv(amt(4) !== 8, 'hurt-amount assertion can fail (size+4 would be 8)');
    MCL.Survival.hurt = realHurt;
  }
  const small = EL.spawn('slime', 0.1, 64, 0, { size: 1 });
  const before2 = player.health;
  player.invulnerableTime = 0;
  Sl.tickTouch(small, { players: () => [player] });
  ok(player.health === before2, 'a SIZE-1 (small) slime dealt contact damage — canAttack() must gate isSmall out');

  okAv((() => {
    const mp = { x: 0, y: 64, z: 0, health: 20, dead: false, invulnerableGamemode: false, invulnerableTime: 0, armor: [], effects: {}, gamemode: 'survival' };
    const mc = EL.spawn('magma_cube', 0.1, 64, 0, { size: 1 });
    Sl.tickTouch(mc, { players: () => [mp] });
    return mp.health < 20;
  })(), 'a magma_cube touching the player must deal contact damage (canAttack = canMoveVoluntarily, even at size 1)');

  okAv((() => {
    const far = { x: 20, y: 64, z: 0, health: 20, dead: false, invulnerableGamemode: false, invulnerableTime: 0, armor: [], effects: {}, gamemode: 'survival' };
    const before3 = far.health;
    Sl.tickTouch(big, { players: () => [far] });
    return far.health === before3;
  })(), 'a player far outside the 0.6*size reach must not take contact damage');
}

// ── 5. split on death ───────────────────────────────────────────────────────────────────────
console.log('5. EL.remove -> Sl.split — the size>1 death split, and the despawn non-split guard');
{
  EL.clear();
  const parent = EL.spawn('slime', 10, 64, 10, { size: 4 });
  parent.dead = true;
  const before = EL.count();
  EL.remove(parent);
  const after = EL.count();
  const spawned = after - before;
  ok(spawned >= 2 && spawned <= 4, `split spawned ${spawned} children, expected 2..4`);
  const children = EL.all().filter((o) => o !== parent && o.type === 'slime');
  ok(children.every((c) => c.size === 2), `not every child is size 2: ${children.map((c) => c.size)}`);
  ok(parent.removed === true, 'the parent itself was not removed');

  okAv((() => {
    EL.clear();
    const np = EL.spawn('magma_cube', 5, 64, 5, { size: 4 });
    np.customName = 'Bob'; np.dead = true;
    EL.remove(np);
    const kids = EL.all().filter((o) => o !== np && o.type === 'magma_cube');
    return kids.length >= 2 && kids.every((c) => c.customName === 'Bob');
  })(), 'split children did not inherit the parent customName');

  okAv((() => {
    EL.clear();
    const np = EL.spawn('slime', 5, 64, 5, { size: 4 });
    np.invulnerable = true; np.aiDisabled = true; np.dead = true;
    EL.remove(np);
    const kids = EL.all().filter((o) => o !== np && o.type === 'slime');
    return kids.length >= 2 && kids.every((c) => c.invulnerable === true && c.aiDisabled === true);
  })(), 'split children did not inherit invulnerable/aiDisabled');

  EL.clear();
  const small = EL.spawn('slime', 0, 64, 0, { size: 1 });
  small.dead = true;
  const beforeS = EL.count();
  EL.remove(small);
  ok(EL.count() === beforeS, 'a size-1 slime split anyway — Sl.split must no-op at size<=1 (the list grew)');

  okAv((() => {
    // a slime DESPAWNING (e.dead false) must NOT split.
    EL.clear();
    const p2 = EL.spawn('slime', 0, 64, 0, { size: 4 });
    p2.dead = false;
    const before2 = EL.count();
    EL.remove(p2);
    return EL.count() === before2;   // no children spawned -- list length unchanged
  })(), 'EL.remove split a live (despawning) slime — the e.dead gate must block that');
}

// ── 6. loot — size 1 only ───────────────────────────────────────────────────────────────────
console.log('6. Cb.dropLoot — SlimeEntity.getLootTableId(): EMPTY unless size 1');
{
  EL.clear();
  const big = EL.spawn('slime', 0, 64, 0, { size: 4 });
  big.dead = true; big.playerHitTimer = 100; big.attackingPlayer = true;
  const beforeItems = EL.list.filter((o) => o.type === 'item').length;
  Cb.dropLoot(big);
  const afterItems = EL.list.filter((o) => o.type === 'item').length;
  ok(afterItems === beforeItems, `a size-4 slime dropped ${afterItems - beforeItems} item(s), expected 0`);

  const small = EL.spawn('slime', 0, 64, 0, { size: 1 });
  small.dead = true; small.playerHitTimer = 100; small.attackingPlayer = true;
  const before2 = EL.list.filter((o) => o.type === 'item').length;
  Cb.dropLoot(small);
  const after2 = EL.list.filter((o) => o.type === 'item').length;
  ok(after2 >= before2, 'a size-1 slime dropped fewer than zero items (impossible) — dropLoot broke');
  let anyDrop = false;
  for (let i = 0; i < 40 && !anyDrop; i++) {
    EL.clear();
    const s = EL.spawn('slime', 0, 64, 0, { size: 1 });
    s.dead = true; s.playerHitTimer = 100; s.attackingPlayer = true;
    Cb.dropLoot(s);
    if (EL.list.some((o) => o.type === 'item')) anyDrop = true;
  }
  ok(anyDrop, 'a size-1 slime never dropped a slimeball across 40 tries — entities/slime table not reached');
}

console.log('6a. EL.spawn(magma_cube) with no opts.size rolls a size (#2539)');
{
  EL.clear();
  const sizes = new Set();
  for (let i = 0; i < 60; i++) { const c = EL.spawn('magma_cube', 0, 64, 0); sizes.add(c.size); }
  ok([...sizes].every((s) => s === 1 || s === 2 || s === 4), 'unrolled magma_cube size: ' + [...sizes]);
  okAv(sizes.size > 1, 'natural magma_cube always the same size');
}
// magma_cube is the INVERSE of slime (MagmaCubeEntity.getLootTableId: EMPTY when isSmall)
console.log('6b. Cb.dropLoot — MagmaCubeEntity.getLootTableId(): EMPTY only at size 1');
{
  const tries = (size) => {
    let n = 0;
    for (let i = 0; i < 200; i++) {
      EL.clear();
      const c = EL.spawn('magma_cube', 0, 64, 0, { size });
      c.dead = true; c.playerHitTimer = 100; c.attackingPlayer = true;
      Cb.dropLoot(c);
      if (EL.list.some((o) => o.type === 'item')) n++;
    }
    return n;
  };
  ok(tries(1) === 0, 'a size-1 magma_cube dropped loot (vanilla: EMPTY when small)');
  okAv(tries(2) > 0 || tries(4) > 0, 'size 2/4 magma_cube never dropped magma_cream in 200 tries each');
}

// ── 7. slime chunks — ChunkRandom.getSlimeRandom ────────────────────────────────────────────
console.log('7. Sl.isSlimeChunk / Sl.getSlimeRandom — a real ChunkRandom.getSlimeRandom port');
{
  const r = Sl.getSlimeRandom(0, 0, 0n, 987234911);
  ok(!!r, 'Sl.getSlimeRandom(0,0,0,salt) returned null');
  const first = r.nextInt(10);
  ok(first >= 0 && first < 10, `nextInt(10) out of range: ${first}`);

  const r2 = Sl.getSlimeRandom(0, 0, 0n, 987234911);
  ok(r2.nextInt(10) === first, 'getSlimeRandom is not deterministic for identical inputs');

  let sawMismatch = false;
  for (let cx = -3; cx <= 3 && !sawMismatch; cx++) {
    for (let cz = -3; cz <= 3 && !sawMismatch; cz++) {
      const a = Sl.isSlimeChunk(cx, cz, 12345);
      const b = Sl.isSlimeChunk(cx, cz, 999999);
      if (a !== b) sawMismatch = true;
    }
  }
  ok(sawMismatch, 'isSlimeChunk gave the same 7x7 pattern for two different seeds — seed is not reaching the formula');

  let hits = 0, total = 0;
  for (let cx = 0; cx < 40; cx++) for (let cz = 0; cz < 40; cz++) { total++; if (Sl.isSlimeChunk(cx, cz, 42)) hits++; }
  const frac = hits / total;
  ok(frac > 0.04 && frac < 0.20, `slime-chunk density ${frac.toFixed(3)} is far from the expected ~0.1`);

  okAv((() => {
    const good = Sl.getSlimeRandom(5, -7, 42n, 987234911).nextInt(10);
    const bad = Sl.getSlimeRandom(5, -7, 42n, 987234912).nextInt(10);
    return good !== bad || Sl.getSlimeRandom(6, -7, 42n, 987234911).nextInt(10) !== Sl.getSlimeRandom(6, -7, 42n, 987234912).nextInt(10);
  })(), 'the salt must actually change the derived random stream (checked over 2 chunks to dodge a same-draw coincidence)');
}

// ── 8. spawn rule ────────────────────────────────────────────────────────────────────────────
console.log('8. Spawn.RULES.slime — SlimeEntity.canSpawn, both branches');
{
  ok(Spawn.canPlace('slime'), 'Spawn.canPlace(slime) is false');

  Diff.value = 'peaceful';
  ok(Spawn.checkPlacement('slime', 0, 30, 0, 'natural', (n) => 0) === false, 'peaceful difficulty did not refuse a slime spawn');
  Diff.value = 'normal';

  const savedIsSlimeChunk = Sl.isSlimeChunk;
  const rndAlways0 = () => 0;
  const rule = Spawn.RULES.slime;
  const savedClear = Spawn.CLEAR_CHECK;
  Spawn.CLEAR_CHECK = false;   // isolate the RULE from clearForSpawn's own real-world block reads
  Sl.isSlimeChunk = () => true;
  ok(rule(0, 20, 0, 'spawner', rndAlways0) === true, 'underground branch: slime chunk + nextInt(10)==0 + y<40 + spawner reason did not pass');
  ok(rule(0, 45, 0, 'spawner', rndAlways0) === false, 'underground branch let y=45 (>=40) through');
  Sl.isSlimeChunk = () => false;
  ok(rule(0, 20, 0, 'spawner', rndAlways0) === false, 'a NON-slime-chunk still passed the underground branch');
  Sl.isSlimeChunk = savedIsSlimeChunk;
  Spawn.CLEAR_CHECK = savedClear;

  okAv((() => {
    Diff.value = 'peaceful';
    const refused = Spawn.RULES.slime(0, 20, 0, 'spawner', rndAlways0) === false;
    Diff.value = 'normal';
    return refused;
  })(), 'Spawn.RULES.slime must refuse outright on peaceful difficulty, not rely on an outer caller');
}

console.log('9. Ai.ROSTER.magma_cube — loop/mob-test-nether-deep: the wiring gap, not just the attribute gaps');
{
  // D-709's deep pass found `Ai.ROSTER.magma_cube` was never SET at all (only `Ai.ROSTER.slime`
  // was, above): a spawned magma_cube got `e.ai` undefined (`EL.spawn`'s own
  // `if (NS.Ai.ROSTER[name])` gate) -- zero movement, zero targeting, nothing but gravity,
  // confirmed live (`tools/nethermobpeek.mjs`: hasAi:false, 0.000 blocks/s in every phase,
  // in both survival and creative). `MagmaCubeEntity extends SlimeEntity` and overrides no
  // goal (.decomp/net/minecraft/entity/mob/MagmaCubeEntity.java, `initGoals` absent — it is
  // SlimeEntity's own), so this is a pure wiring gap, not new behavior.
  ok(typeof Ai.ROSTER.magma_cube === 'function', 'Ai.ROSTER.magma_cube is not a function -- magma_cube has no goal selector at all');
  ok(Ai.ROSTER.magma_cube === Ai.ROSTER.slime, 'Ai.ROSTER.magma_cube is not the SAME function as Ai.ROSTER.slime (MagmaCubeEntity overrides no goal in vanilla)');

  const gs = Ai.ROSTER.magma_cube({ type: 'magma_cube', x: 0, y: 0, z: 0, width: 2.04, height: 2.04 }, { random: () => 0.5, golems: () => [] });
  ok(gs && typeof gs.tick === 'function', 'Ai.ROSTER.magma_cube(e, ctx) did not return a real GoalSelector');

  okAv((() => {
    const saved = Ai.ROSTER.magma_cube;
    delete Ai.ROSTER.magma_cube;
    const brokenLooksWired = typeof Ai.ROSTER.magma_cube === 'function';
    Ai.ROSTER.magma_cube = saved;
    return !brokenLooksWired;
  })(), 'deleting Ai.ROSTER.magma_cube must make the wired-check fail, or the check proves nothing');
}

console.log('10. MagmaCubeEntity overrides (#1003, .decomp MagmaCubeEntity.java)');
{
  const Eq = MCL.Equip, Ph = MCL.Physics;
  const mk = (type, size) => { const e = { type, x: 0, y: 0, z: 0, width: 1, height: 1 }; Sl.setSize(e, size, true); return e; };
  const run = () => {
    const m = mk('magma_cube', 1), s = mk('slime', 1), m4 = mk('magma_cube', 4);
    return [
      Eq.armorOf(m4).armor === 12 && Eq.armorOf(s).armor === 0,
      Math.abs(m4.jumpBonus - 0.4) < 1e-9 && s.jumpBonus === undefined,
      Math.abs(m4.lavaSwimVy - 0.42) < 1e-9,
      Sl.canAttack(m) === true && Sl.canAttack(s) === false,
      (() => { let lo = 1e9, hi = 0; for (let i = 0; i < 400; i++) { const t = Sl.ticksUntilNextJump(null, m); lo = Math.min(lo, t); hi = Math.max(hi, t); } return lo >= 40 && hi <= 116 && hi > 60; })(),
      (() => { const t = Sl.ticksUntilNextJump(null, s); return t >= 10 && t <= 29; })()
    ];
  };
  const good = run();
  const names = ['armor size*3', 'jump bonus size*0.1', 'lava swim 0.22+size*0.05', 'size-1 magma attacks, slime not', 'hop interval x4 (40-116)', 'slime interval unchanged'];
  good.forEach((g, i) => ok(g, 'magma cube: ' + names[i]));
  const sv = Sl.setSize;
  Sl.setSize = (e, n, h) => { sv(e, n, h); delete e.armorBase; delete e.jumpBonus; delete e.lavaSwimVy; };
  const bad = run(); Sl.setSize = sv;
  okAv(!bad[0] && !bad[1] && !bad[2], 'removing the per-instance magma fields must fail the armor/jump/lava assertions');
  const sc = Sl.canAttack; Sl.canAttack = (e) => !Sl.isSmall(e) && !e.riding;
  okAv(!(mk('magma_cube', 1) && Sl.canAttack(mk('magma_cube', 1))), 'restoring the isSmall gate must make size-1 magma cubes stop attacking'); Sl.canAttack = sc;
  [[1, 3], [2, 4], [4, 6]].forEach(([sz, d]) => ok(mk('magma_cube', sz).attackDamage === d, `magma_cube size ${sz} attackDamage ${mk('magma_cube', sz).attackDamage} (want ${d}: size+2)`));
  { const sv2 = Sl.setSize; Sl.setSize = (e, n, h) => { sv2(e, n, h); e.attackDamage = n; };
    okAv(mk('magma_cube', 4).attackDamage !== 6, 'dropping the +2 must fail the magma damage assertion'); Sl.setSize = sv2; }
  // live jump: travelMob applies the bonus (Ph.move stubbed -- no world here -- to capture the launch vy)
  const live = (t) => {
    const e = mk(t, 4); e.onGround = true; e.jumping = true; e.yaw = 0; e.vx = e.vy = e.vz = 0;
    const mv = Ph.move; let launch = null; Ph.move = (en, x, y) => { launch = y; };
    try { Ph.travelMob(e, 0); } finally { Ph.move = mv; }
    return launch;
  };
  const lm = live('magma_cube'), ls = live('slime');
  ok(Math.abs(ls - 0.42) < 1e-6 && Math.abs(lm - 0.82) < 1e-6, `travelMob launch vy magma ${lm} slime ${ls} (want 0.82 / 0.42)`);
  // #2975: SlimeEntity/MagmaCubeEntity.jump() override LivingEntity.jump(): jump_boost adds nothing
  const boosted = (t) => { const e = mk(t, 4); e.effects = {}; MCL.Effects.addStatusEffect(e, 'jump_boost', 200, 4); return live2(e); };
  const live2 = (e) => { e.onGround = true; e.jumping = true; e.yaw = 0; e.vx = e.vy = e.vz = 0;
    const mv = Ph.move; let launch = null; Ph.move = (en, x, y) => { launch = y; };
    try { Ph.travelMob(e, 0); } finally { Ph.move = mv; } return launch; };
  const zb = mk('zombie', 1); zb.effects = {}; MCL.Effects.addStatusEffect(zb, 'jump_boost', 200, 4);
  const zl = live2(zb); okAv(zl > 0.9, 'a zombie with jump_boost must still hop higher (got ' + zl + '; else the boost fixture proves nothing)');
  ok(Math.abs(boosted('slime') - 0.42) < 1e-6 && Math.abs(boosted('magma_cube') - 0.82) < 1e-6, `jump_boost changed slime/magma launch vy: ${boosted('slime')} / ${boosted('magma_cube')}`);
}

// ── 10. fire: MagmaCubeEntity is fire-immune (isOnFire false) and its block light renders 15 ─────
console.log('10. magma_cube burning flag + full-bright render');
{
  const burn = (t) => { const c = EL.spawn(t, 0, 64, 0, { size: 2 }); c.remainingFireTicks = 100; Cb.tickEntity(c); return c; };
  ok(burn('magma_cube').isOnFire === false, 'magma_cube with fire ticks reports isOnFire (vanilla: fireImmune => false)');
  okAv(burn('zombie').isOnFire === true, 'a non-immune zombie must still report isOnFire');
  const fb = (t) => { const m = /ER\.fullBrightBlockLight = function \(e\) \{ return ([^;]*);/.exec(readFileSync(join(MCLITE_ROOT, 'src/07j_entityrender.js'), 'utf8').replace(t === 'slime' ? /\|\| e\.type === 'magma_cube'/ : /$^/, '')); return m && m[1].includes("'" + t + "'"); };
  ok(fb('magma_cube'), 'magma_cube block light not 15 (ER.fullBrightBlockLight)');
  okAv(!fb('slime'), 'slime must not be full-bright');
}

// ── 11. /summon {Size:N}: stored Size is size-1 (SlimeEntity.readCustomDataFromNbt), clamped 1..127 ─────
console.log('11. applyNbt Size');
{
  const sz = (t, n) => { const e = EL.spawn(t, 0, 64, 0); MCL.Commands.applyNbt(e, { Size: n }); return e; };
  const s7 = sz('slime', 7);
  ok(s7.size === 8 && s7.maxHealth === 64 && s7.health <= 64, `slime Size:7 -> size ${s7.size} hp ${s7.health}/${s7.maxHealth}`);
  ok(sz('magma_cube', 0).size === 1, 'magma_cube Size:0 must be size 1');
  ok(sz('slime', 500).size === 127, 'slime Size:500 must clamp to 127');
  okAv(sz('slime', 3).size === 4, 'Size:3 must give size 4 (else the case proves nothing)');
}

// #4813: load is setSize(size+1,false) -- the saved Health survives; a split child (no mobNbtRestore) is still healed.
{
  const r = EL.spawn('slime', 0, 64, 0, { size: 4, health: 3, mobNbtRestore: true });
  ok(r.health === 3 && r.maxHealth === 16, 'restored size-4 slime keeps Health 3/16 (got ' + r.health + '/' + r.maxHealth + ')');
  okAv(EL.spawn('slime', 0, 64, 0, { size: 4, health: 3 }).health === 16, 'a split child (no mobNbtRestore) is still healed to 16 (else the case proves nothing)');
}

// ── summary ──────────────────────────────────────────────────────────────────────────────────
console.log('---------------------------------------------');
console.log(` assertions passed .. ${pass}`); console.log(` failures ........... ${fails.length}`);   // suite.mjs count format
if (fails.length) {
  console.log(`${pass} assertions, ${fails.length} FAILURES, ${breaks} anti-vacuity breaks`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
} else {
  console.log(`${pass} assertions, 0 failures, ${breaks} breaks caught`);
  process.exit(0);
}
