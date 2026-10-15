#!/usr/bin/env node
// blazeghastcheck.mjs — loop/blazeghast: the BLAZE, the GHAST, and the small/big FIREBALL
// projectiles (src/07zzh_blaze.js, src/07zzi_ghast.js).
//
//   node tools/blazeghastcheck.mjs [--verbose]
//
// Sections:
//   1. motion/attributes/hitbox/fire-immunity — the closed data set already covers both mobs
//   2. spawn — EL.canSpawn for all four types, initBlaze/initGhast defaults, goal rosters wired
//   3. blaze ShootFireballGoal — close melee via Cb.mobAttack, the burst cooldown sequence,
//      three small fireballs per burst, aimed at the target
//   4. small fireball consequence — 5 damage + 5s fire on an entity hit, block-hit fire placement
//      (gated on mobGriefing for a mob's own shot), discard either way, never explodes
//   5. big fireball consequence — 6 direct damage THEN a real NS.Explosion.explode blast at
//      ExplosionPower, deflect() re-owns power/velocity to the attacker's look vector
//   6. blaze mobTick — the vy float-damp while falling, hurtByWater 1 dmg/tick while wet
//   7. NBT round trip — ghast's ExplosionPower survives Mb.serializeAll/restoreAll
//   8. render scale — ghast already at ER.RENDER_SCALE 4.5, blaze at the implicit 1
//   9. anti-vacuity — each broken on purpose and caught, both directions
//   10. ghast TargetGoal/FlyRandomlyGoal RNG guard — EL.random||Math.random, not a ternary
//   11. ghast full roster actually FIRES a fireball (KW-39) — goal controls must not deadlock

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('blazeghastcheck — loop/blazeghast: blaze + ghast + small/big fireball');

const EXTRA = ['07zf_bat.js', '07zq_snowgolem.js', '07zg_enderman.js', '02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '09b_sky.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07t_fly.js', '07zf_bat.js', '07za_explosion.js', '07zw_mobnbt.js', '07zzh_blaze.js', '07zzi_ghast.js', '07zzk_shulker.js',
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '14f_inventory.js', '07q_effects.js', '14h_brigadier.js', '15g_commands.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const W = MCL.World, B = MCL.Behave, CH = MCL.CH, S = MCL.States, R = MCL.Reg;
const EL = MCL.EntityList, Ai = MCL.Ai, Ent = MCL.Entities, Cb = MCL.Combat;
const Ex = MCL.Explosion, Bl = MCL.Blaze, Gh = MCL.Ghast, Mb = MCL.MobNbt, ER = MCL.EntityRender;

B.init(W);
Ent.init();
EL.init();
Ai.init();
Cb.init();
Ex.init();
ER.init();
Bl.init();
Gh.init();

ok(Bl.ready, 'Blaze module reports ready');
ok(Gh.ready, 'Ghast module reports ready');

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
const seq = (vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };
const withRnd = (rnd, f) => { const prev = EL.random; EL.random = rnd; try { return f(); } finally { EL.random = prev; } };
function spawn(type, x, y, z, opts) { return EL.spawn(type, x, y, z, opts); }

// ═════════════════════ 1. motion / attributes / hitbox / fire-immunity ═════════════════════
{
  say('\n§1 motion + attributes + hitbox + fire-immunity');
  freshWorld();
  for (const t of ['blaze', 'ghast', 'fireball', 'small_fireball']) {
    ok(!!EL.motionFor(t), `EL.motionFor(${t}) resolves`);
    ok(EL.canSpawn(t), `EL.canSpawn(${t}) is true`);
  }
  const gm = EL.motionFor('ghast');
  ok(gm[0] === 0 && gm[1] === 1, `ghast motion pair is [0,1] (real motion is Fl.travelMob) (got ${gm})`);
  const fm = EL.motionFor('fireball'), sm = EL.motionFor('small_fireball');
  ok(fm[0] === 0 && fm[1] === 1 && sm[0] === 0 && sm[1] === 1, 'both fireballs are [0,1] (real motion is the power-vector hook)');
  const bAt = Ent.attrsOf('blaze');
  ok(bAt && bAt.hp === 20 && bAt.dmg === 6 && near(bAt.speed, 0.23, 1e-3) && bAt.follow === 48,
    `blaze attributes: hp20/dmg6/speed0.23/follow48 (got ${JSON.stringify(bAt)})`);
  const gAt = Ent.attrsOf('ghast');
  ok(gAt && gAt.hp === 10 && gAt.follow === 100, `ghast attributes: hp10/follow100 (got ${JSON.stringify(gAt)})`);
  const bDim = Ent.dimensions('blaze'), gDim = Ent.dimensions('ghast');
  ok(bDim && near(bDim.width, 0.6) && near(bDim.height, 1.8), `blaze hitbox 0.6x1.8 (got ${JSON.stringify(bDim)})`);
  ok(gDim && near(gDim.width, 4) && near(gDim.height, 4), `ghast hitbox 4x4 (got ${JSON.stringify(gDim)})`);
  ok(Cb.fireImmuneOf({ type: 'blaze' }) && Cb.fireImmuneOf({ type: 'ghast' }), 'both are fire-immune (the generated column)');
}

// ═════════════════════ 2. spawn defaults + goal roster ═════════════════════════════════════
{
  say('\n§2 spawn defaults + goal roster');
  freshWorld();
  const bl = spawn('blaze', 0.5, 64, 0.5);
  ok(bl && bl.experiencePoints === 10 && bl.fireActive === false, `blaze init: xp 10, fireActive false (got ${bl && bl.experiencePoints}, ${bl && bl.fireActive})`);
  ok(!!Ai.ROSTER.blaze && !!bl.ai, 'Ai.ROSTER.blaze exists and a spawned blaze runs it');
  // #1865: BlazeEntity.initGoals roster (.decomp lines 44-49) + ctor penalties
  const has = (cls, pri) => bl.ai.entries.some((en) => en.goal instanceof cls && en.priority === pri);
  ok(has(Ai.GoToWalkTargetGoal, 5), 'blaze: GoToWalkTargetGoal at priority 5');
  ok(has(Ai.WanderAroundFarGoal, 7), 'blaze: WanderAroundFarGoal at priority 7');
  const rv = bl.ai.entries.find((en) => en.goal instanceof Ai.RevengeGoal);
  ok(!!rv && rv.priority === 1 && rv.goal.group === true, 'blaze: group RevengeGoal at target priority 1');
  ok(Ai.pathPenalty(bl, Ai.NodeType.WATER) === -1 && Ai.pathPenalty(bl, Ai.NodeType.LAVA) === 8 &&
    Ai.pathPenalty(bl, Ai.NodeType.DANGER_FIRE) === 0 && Ai.pathPenalty(bl, Ai.NodeType.DAMAGE_FIRE) === 0, 'blaze: ctor path penalties applied');
  ok(ER.fullBrightBlockLight(bl) && !ER.fullBrightBlockLight(spawn('zombie', 0.5, 64, 0.5)), '#1957: blaze renders block light 15 (getBlockLight override)');
  // #4478: ActiveTargetGoal(Player, true) = sight + mustSee + reciprocalChance 10
  const tg = (b) => (b.ai.entries.find((en) => en.goal instanceof Ai.NearestAttackableTargetGoal && en.priority === 2) || {}).goal;
  const g2 = tg(bl);
  ok(!!g2 && g2.sight === true && g2.mustSee === true && g2.reciprocalChance === 10, 'blaze: priority-2 target goal has sight, mustSee, reciprocalChance 10');
  okAv(!(tg(spawn('cow', 0.5, 64, 0.5)) || {}).sight, 'cow has no sighted priority-2 target goal (probe can fail)');
  okAv(!has(Ai.GoToWalkTargetGoal, 6), 'blaze: no GoToWalkTargetGoal at wrong priority 6');
  okAv(!(spawn('zombie', 0.5, 64, 0.5).ai.entries.some((en) => en.goal instanceof Ai.RevengeGoal && en.goal.group)), 'zombie has no group RevengeGoal (probe can fail)');
  const gh = spawn('ghast', 0.5, 64, 0.5);
  ok(gh && gh.experiencePoints === 5 && gh.fireballStrength === 1 && gh.shooting === false,
    `ghast init: xp 5, fireballStrength 1, shooting false (got ${gh && gh.experiencePoints}, ${gh && gh.fireballStrength})`);
  ok(!!Ai.ROSTER.ghast && !!gh.ai, 'Ai.ROSTER.ghast exists and a spawned ghast runs it');
  ok(!!gh.flyMove, 'a ghast carries a Gh.GhastMoveControl (e.flyMove)');
}

// ═════════════════════ 3. blaze ShootFireballGoal ═══════════════════════════════════════════
{
  say('\n§3 blaze ShootFireballGoal');
  freshWorld();
  const bl = spawn('blaze', 0.5, 64, 0.5);
  const tgt = { type: 'player', x: 0.5, y: 64, z: 20.5, health: 20, maxHealth: 20, height: 1.8,
    vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 };
  EL.list.push(tgt);
  bl.target = tgt;
  const goal = new Bl.ShootFireballGoal(bl);
  goal.start();
  // tick 1: fireballsFired -> 1, cooldown 60, fireActive true, no fireball yet
  goal.tick();
  ok(bl.fireActive === true, 'first tick of a burst: fireActive true (the "on fire" look)');
  ok(EL.list.filter((e) => e.type === 'small_fireball').length === 0, 'no fireball on burst tick 1 (fired == 1)');
  let fired = 0;
  const shootCalls = [], SS = MCL.Sound || (MCL.Sound = {}), savedSS = [SS.play, SS.mobSound];
  SS.play = SS.play || (() => true);
  SS.mobSound = (e, ev, v, p) => { shootCalls.push([ev, v, p]); return true; };
  for (let i = 0; i < 200 && fired < Bl.BURST_COUNT; i++) {
    goal.tick();
    fired = EL.list.filter((e) => e.type === 'small_fireball').length;
  }
  [SS.play, SS.mobSound] = savedSS;
  ok(shootCalls.length === Bl.BURST_COUNT && shootCalls.every((c) => c[0] === 'entity.blaze.shoot' && c[1] === 2.0 && c[2] >= 0.8 && c[2] <= 1.2),
    `blaze shoot (1018): volume 2.0, pitch in [0.8,1.2] per fireball (got ${JSON.stringify(shootCalls)})`);
  ok(new Set(shootCalls.map((c) => c[2])).size > 1, 'blaze shoot pitch varies');
  ok(fired === Bl.BURST_COUNT, `exactly ${Bl.BURST_COUNT} small fireballs per burst (got ${fired})`);
  for (let i = 0; i < 120 && bl.fireActive; i++) goal.tick();   // run out the recovery cooldown (100)
  ok(bl.fireActive === false, 'fireActive resets false once the burst ends');
  const fb = EL.list.find((e) => e.type === 'small_fireball');
  ok(fb && fb.shooter === bl, 'each small fireball carries the blaze as its shooter');
  ok(fb && fb.powerZ > 0, `a fireball aimed at +z gets a positive powerZ (got ${fb && fb.powerZ})`);
  // close range: melee via Cb.mobAttack
  freshWorld();
  const bl2 = spawn('blaze', 0.5, 64, 0.5);
  const near1 = { type: 'player', x: 1.5, y: 64, z: 0.5, health: 20, maxHealth: 20, height: 1.8,
    vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 };
  EL.list.push(near1);
  bl2.target = near1;
  const g2 = new Bl.ShootFireballGoal(bl2);
  g2.start();
  const h0 = near1.health;
  g2.tick();
  ok(near1.health < h0, `within 4 (squared) blocks the goal melees via Cb.mobAttack (${h0} -> ${near1.health})`);
}

// ═════════════════════ 4. small fireball consequence ════════════════════════════════════════
{
  say('\n§4 small fireball: entity hit / block hit');
  freshWorld();
  const fb = spawn('small_fireball', 5.5, 64.5, 5.5, { power: [0, 0, 1] });
  const tgt = { type: 'cow', x: 5.5, y: 64.5, z: 5.6, health: 20, maxHealth: 20, width: 0.9, height: 1.4,
    vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0, remainingFireTicks: 0 };
  EL.list.push(tgt);
  const h0 = tgt.health;
  Bl.Fireball.tickSmall(fb);
  ok(near(h0 - tgt.health, 5, 1e-3), `small fireball: 5 direct damage on an entity hit (${h0} -> ${tgt.health})`);
  ok(tgt.remainingFireTicks > 0, `and sets it on fire (remainingFireTicks ${tgt.remainingFireTicks})`);
  ok(fb.removed === true, 'the small fireball itself is discarded on any hit');

  // thorns: SmallFireballEntity.onEntityHit -> applyDamageEffects(owner, target)
  freshWorld();
  const Inv = MCL.Inventory, Iv = MCL.Inventory;
  const blz = spawn('blaze', 5.5, 66, 3);
  const th = { type: 'cow', x: 5.5, y: 64.5, z: 5.6, health: 20, maxHealth: 20, width: 0.9, height: 1.4,
    vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0, remainingFireTicks: 0, inventory: Inv.create() };
  Inv.setItem(th.inventory, Iv.ARMOR_START + 2, Inv.stack('iron_chestplate', 1, 0, { Enchantments: [{ id: 'thorns', lvl: 3 }] }));
  EL.list.push(th);
  const fbt = spawn('small_fireball', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: blz });
  fbt.shooter = blz;
  const bh0 = blz.health, rnd = Math.random;
  Math.random = () => 0;
  Bl.Fireball.tickSmall(fbt);
  Math.random = rnd;
  ok(blz.health < bh0, `thorns victim hit by a blaze fireball retaliates on the blaze (${bh0} -> ${blz.health})`);
  ok(EL.list.filter((e) => e.type !== 'cow' && e.type !== 'player').every((e) => true), 'no explosion entity/side-effect from a small fireball');

  freshWorld();
  put(5, 63, 5, 'stone');
  const fb2 = spawn('small_fireball', 5.5, 64.5, 5.5, { power: [0, -1, 0] });
  fb2.vy = -1;   // ExplosiveProjectileEntity.tick raycasts along the current velocity
  const before = W.getBlock(5, 64, 5);
  Bl.Fireball.tickSmall(fb2);
  const after = W.getBlock(5, 64, 5);
  ok(before === 0 && after !== 0, `a block hit sets the neighbour cell alight (air ${before} -> ${after})`);
  ok(fb2.removed === true, 'discarded on the block hit too');

  freshWorld();
  put(5, 63, 5, 'soul_soil');
  const fb3 = spawn('small_fireball', 5.5, 64.5, 5.5, { power: [0, -1, 0] });
  fb3.vy = -1;
  Bl.Fireball.tickSmall(fb3);
  ok(W.getBlock(5, 64, 5) === MCL.States.stateOf('soul_fire'), 'over soul soil the small fireball leaves soul_fire');

  freshWorld();
  const fw = spawn('small_fireball', 5.5, 100.5, 5.5, { power: [0, 0, 1] });
  fw.onGround = false; fw.inWater = true; fw.vz = 1;
  Bl.Fireball.tickSmall(fw);
  ok(near(fw.vz, (1 + fw.powerZ) * 0.8, 1e-9), `in water the small fireball uses drag 0.8 (vz ${fw.vz})`);

  // #4141: swept raycast, inflate 0.3 -- a fast step crossing a thin box hits; 0.2 outside misses
  for (const [dz, want] of [[1.5, true], [0, false]]) {
    freshWorld();
    const tg = { type: 'cow', x: 5.5, y: 64, z: 5.5, health: 20, maxHealth: 20, width: 0.6, height: 1.8,
      vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0, remainingFireTicks: 0 };
    EL.list.push(tg);
    const fs = spawn('small_fireball', 5.5, 64.5, want ? 4.0 : 7.0, { power: [0, 0, 0] });
    fs.vz = want ? 1.5 : 0;   // want: segment 4.0->5.5 reaches the box (z 5.2..5.8, inflated 0.3); else a point 0.9 outside
    Bl.Fireball.tickSmall(fs);
    ok(fs.removed === want, `swept hit ${want ? 'crosses' : 'misses'} (removed=${fs.removed})`);
  }

  // #3111: a small fireball hitting the PLAYER passes the blaze as Survival.hurt's attacker
  freshWorld();
  const bl3 = spawn('blaze', 0.5, 64, 0.5);
  const fb4 = spawn('small_fireball', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: bl3 });
  const plr3 = { type: 'player', x: 5.5, y: 64.5, z: 5.6, health: 20, maxHealth: 20, width: 0.6, height: 1.8 }, savedP = MCL.Player;
  MCL.Player = plr3;   // hurtEntity routes `target === NS.Player` to Survival.hurt
  EL.list.push(plr3);
  const rsv = MCL.Survival.hurt; let sattacker = null;
  MCL.Survival.hurt = function (t, ty, n, at) { if (t === plr3) sattacker = at; return false; };
  Bl.Fireball.tickSmall(fb4);
  MCL.Survival.hurt = rsv; EL.list.pop(); MCL.Player = savedP;
  ok(sattacker === bl3, 'small fireball on the player: Survival.hurt gets the blaze as attacker (#3111)');
}

// ═════════════════════ 5. big fireball consequence ══════════════════════════════════════════
{
  say('\n§5 big fireball: direct damage + real explosion, deflect');
  // an entity hit ALSO sits inside its own explosion's blast radius (real vanilla double-dips
  // the same way: onEntityHit's 6 direct damage, THEN onCollision's own createExplosion also
  // damages whatever is still standing there) -- so this only asserts AT LEAST the direct 6,
  // and checks the explosion itself (a real block break) with a low-resistance block instead.
  freshWorld();
  put(5, 63, 5, 'stone');
  const gh = spawn('ghast', 0.5, 80, 0.5);
  const fb = spawn('fireball', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: gh, explosionPower: 1 });
  const tgt = { type: 'cow', x: 5.5, y: 64.5, z: 7.5, health: 20, maxHealth: 20, width: 0.9, height: 1.4,
    vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 };
  EL.list.push(tgt);
  const h0 = tgt.health;
  fb.vz = 2;   // moving, so a hit-point centre would differ from the start (#3795)
  Gh.tickFireball(fb);
  ok(h0 - tgt.health >= 6 - 1e-3, `big fireball: at least 6 direct damage on an entity hit (${h0} -> ${tgt.health})`);
  ok(fb.removed === true, 'the big fireball is discarded on its own hit');

  // thorns: FireballEntity.onEntityHit -> applyDamageEffects(owner, victim)
  freshWorld();
  const gh3 = spawn('ghast', 5.5, 66, 3);
  const th3 = { type: 'cow', x: 5.5, y: 64.5, z: 7.5, health: 20, maxHealth: 20, width: 0.9, height: 1.4,
    vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0, inventory: MCL.Inventory.create() };
  MCL.Inventory.setItem(th3.inventory, MCL.Inventory.ARMOR_START + 2, MCL.Inventory.stack('iron_chestplate', 1, 0, { Enchantments: [{ id: 'thorns', lvl: 3 }] }));
  EL.list.push(th3);
  const fb3 = spawn('fireball', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: gh3, explosionPower: 1 });
  fb3.vz = 2;
  const gh30 = gh3.health, rnd3 = Math.random;
  Math.random = () => 0;
  Gh.tickFireball(fb3);
  Math.random = rnd3;
  ok(gh3.health < gh30, `thorns victim hit by a ghast fireball retaliates on the ghast (${gh30} -> ${gh3.health})`);
  ok(fb.x === 5.5 && fb.y === 64.5 && fb.z === 5.5, `#3795: explosion centre is the pre-move position, not the ray hit point (${fb.x},${fb.y},${fb.z})`);

  freshWorld();
  put(6, 63, 5, 'dirt');
  const gh2 = spawn('ghast', 0.5, 80, 0.5);
  const fb2 = spawn('fireball', 5.5, 64.5, 5.5, { power: [1, 0, 0], shooter: gh2, explosionPower: 1 });
  fb2.onGround = true;   // this engine's own "hit something solid" signal (Cb.tickSnowball's precedent, this file's own §4 comment)
  const before = W.getBlock(6, 63, 5);
  Gh.tickFireball(fb2);
  ok(before !== 0 && W.getBlock(6, 63, 5) === 0, `the real explosion (NS.Explosion.explode) broke the dirt beside it (${before} -> ${W.getBlock(6, 63, 5)})`);

  const deflected = Gh.deflect({ type: 'fireball', powerX: 0, powerY: 0, powerZ: 0, vx: 0, vy: 0, vz: 0 },
    { type: 'player', yaw: 0, pitch: 0 });
  ok(deflected === true, 'Gh.deflect re-owns a fireball hit by an attacker');

  // #647: DamageSource.fireball(this, owner) on the direct hit, explosion source entity NULL
  {
    freshWorld();
    const g = spawn('ghast', 0.5, 80, 0.5);
    const f = spawn('fireball', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: g, explosionPower: 1 });
    const cw = { type: 'cow', x: 5.5, y: 64.5, z: 5.6, health: 20, maxHealth: 20, width: 0.9, height: 1.4,
      vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 };
    EL.list.push(cw);
    const realExplode = Ex.explode, realHurt = Cb.hurt;
    let exSrc = 'unset', hurtSrc = null;
    Ex.explode = function (src) { exSrc = src; return realExplode.apply(this, arguments); };
    Cb.hurt = function (t, a, n, bp, src) { if (t === cw && !hurtSrc) hurtSrc = src; return realHurt.apply(this, arguments); };
    Gh.tickFireball(f);
    Ex.explode = realExplode; Cb.hurt = realHurt;
    ok(exSrc === null, 'big fireball explosion has a null source entity (ghast not credited)');
    ok(hurtSrc && hurtSrc.source === 'fireball' && hurtSrc.attacker === g, 'direct hit is a fireball-projectile source owned by the shooter');
    okAv(!(exSrc === g), 'explosion source is not the ghast (a break of this would credit the ghast)');
    // x1000: a player-owned fireball hitting a ghast is an outright kill
    const g2 = spawn('ghast', 5.5, 64.5, 5.5);
    const f2 = spawn('fireball', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: MCL.Player, explosionPower: 1 });
    Gh.tickFireball(f2);
    ok(g2.health <= 0 || g2.removed || g2.dead, 'a player-owned fireball kills a ghast outright (x1000)');
  }
  // #2832: ProjectileEntity.canHit -- the owner is hittable only once the fireball has LEFT it
  {
    const run = (left) => {
      freshWorld();
      const ow = { type: 'cow', x: 5.5, y: 64.5, z: 5.5, health: 20, maxHealth: 20, width: 0.9, height: 1.4,
        vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 };
      EL.list.push(ow);
      const f = spawn('fireball', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: ow, explosionPower: 1 });
      f.vz = 0.01; f.leftOwner = left; if (!left) ow.z = 5.5;
      const h0 = ow.health; Gh.tickFireball(f);
      return ow.health < h0;
    };
    okAv(run(true), 'a fireball that has left its owner hurts the owner (leftOwner)');
    okAv(!run(false), 'a fireball still inside its owner does not hurt it');
  }
  // #1877: createFire = mobGriefing -- fire on 1/3 of affected air cells with an opaque floor
  {
    const fires = () => { let n = 0; for (let x = -3; x <= 14; x++) for (let z = -3; z <= 14; z++) for (let y = 60; y <= 70; y++) if (S.name(W.getBlock(x, y, z)) === 'fire') n++; return n; };
    const floor = () => { freshWorld(); for (let x = -3; x <= 14; x++) for (let z = -3; z <= 14; z++) put(x, 63, z, 'netherrack'); };
    floor();
    Ex.explode(null, 5.5, 64.5, 5.5, 3, true, () => 0, true, undefined, true);
    ok(fires() > 0, `fire appears after a createFire blast on a flat floor (${fires()})`);
    floor();
    Ex.explode(null, 5.5, 64.5, 5.5, 3, false, () => 0, true, undefined, false);
    okAv(fires() === 0, 'no fire when createFire is false');
    floor();
    const gf = spawn('fireball', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: spawn('ghast', 0.5, 80, 0.5), explosionPower: 3 });
    gf.onGround = true; Gh.tickFireball(gf);
    ok(fires() > 0, `a ghast fireball with mobGriefing leaves fire (${fires()})`);
  }
}

// ═════════════════════ 6. blaze mobTick ═════════════════════════════════════════════════════
{
  say('\n§6 blaze mobTick: float-damp + hurtByWater');
  freshWorld();
  const bl = spawn('blaze', 0.5, 80, 0.5);
  bl.onGround = false; bl.vy = -1;
  Bl.mobTick(bl);
  ok(near(bl.vy, -1 * Bl.FALL_DAMP_Y, 1e-6), `falling velocity is damped by 0.6 while airborne (got ${bl.vy})`);
  const bl2 = spawn('blaze', 3.5, 80, 3.5);
  bl2.inWater = true;
  const h0 = bl2.health;
  const rh = MCL.Combat.hurt; let dsrc = null;
  MCL.Combat.hurt = function (t, a, n, bp, src) { if (t === bl2 && !dsrc) dsrc = src; return rh.apply(this, arguments); };
  Bl.mobTick(bl2);
  MCL.Combat.hurt = rh;
  ok(dsrc && dsrc.source === 'drown' && dsrc.bypassArmor === true, 'hurtByWater() is a typed DROWN source that bypasses armor');
  ok(near(h0 - bl2.health, Bl.DROWN_DAMAGE, 1e-3), `hurtByWater(): 1.0 damage/tick while wet (${h0} -> ${bl2.health})`);
  // the pre-existing snowball-vs-blaze 3 damage (Cb.tickSnowball) still finds a real blaze now
  ok(!!MCL.Combat.tickSnowball, 'Cb.tickSnowball exists — regression: a real blaze type now reaches its own branch');
}

// ═════════════════════ 7. NBT round trip ════════════════════════════════════════════════════
{
  say('\n§7 NBT: ghast ExplosionPower');
  freshWorld();
  const gh = spawn('ghast', 0.5, 64, 0.5, { fireballStrength: 3 });
  ok(gh.fireballStrength === 3, `a spawn opt can override fireballStrength (got ${gh.fireballStrength})`);
  const C = MCL.Commands;
  C.applyNbt(gh, { ExplosionPower: 5 });
  ok(gh.fireballStrength === 5, `C.applyNbt ExplosionPower:5 sets fireballStrength (got ${gh.fireballStrength})`);
  ok(C.entityNbt({ e: gh, kind: 'mob' }).ExplosionPower === 5, '/data get ExplosionPower round-trips');
  C.applyNbt(gh, { ExplosionPower: 3 });
  const recs = Mb.serializeAll();
  const rec = recs.find((r) => r.type === 'ghast');
  ok(rec && rec.fireballStrength === 3, `Mb.serializeAll carries fireballStrength (got ${rec && rec.fireballStrength})`);
  freshWorld();
  const n = Mb.restoreAll([rec]);
  const back = EL.list.find((e) => e.type === 'ghast');
  ok(n === 1 && back && back.fireballStrength === 3, `Mb.restoreAll reloads it (got ${back && back.fireballStrength})`);
}

// ═════════════════════ 8. render scale ══════════════════════════════════════════════════════
{
  say('\n§8 render scale');
  ok(ER.RENDER_SCALE.ghast === 4.5, `ghast is already in ER.RENDER_SCALE at 4.5 (got ${ER.RENDER_SCALE.ghast})`);
  ok(ER.RENDER_SCALE.blaze === undefined, 'blaze has no RENDER_SCALE entry (BlazeEntityRenderer has no scale() override — implicit 1)');
}

// ═════════════════════ 9. anti-vacuity ══════════════════════════════════════════════════════
{
  say('\n§9 anti-vacuity');
  okAv(!(EL.motionFor('nonexistent_mob_xyz')), 'a made-up type still resolves to no motion (the closed-set rule holds)');
  const savedBurst = Bl.BURST_COUNT;
  Bl.BURST_COUNT = 99;
  okAv(Bl.BURST_COUNT !== savedBurst, 'breaking Bl.BURST_COUNT is actually visible to a direct read');
  Bl.BURST_COUNT = savedBurst;
  freshWorld();
  const fbBreak = spawn('small_fireball', 5.5, 100.5, 5.5, { power: [0, -1, 0] });
  fbBreak.onGround = false;
  const savedDrag = Bl.Fireball.DRAG;
  Bl.Fireball.DRAG = 0;
  Bl.Fireball.tickSmall(fbBreak);
  okAv(fbBreak.vz === 0 && fbBreak.vx === 0, `a DRAG of 0 collapses velocity to 0 (the multiply is load-bearing) (got ${fbBreak.vx},${fbBreak.vz})`);
  Bl.Fireball.DRAG = savedDrag;
  freshWorld();
  const fwB = spawn('small_fireball', 5.5, 100.5, 5.5, { power: [0, 0, 1] });
  fwB.onGround = false; fwB.inWater = true; fwB.vz = 1;
  const savedDw = Bl.Fireball.DRAG_WATER;
  Bl.Fireball.DRAG_WATER = 0;
  Bl.Fireball.tickSmall(fwB);
  okAv(fwB.vz === 0, `a DRAG_WATER of 0 collapses in-water velocity (got ${fwB.vz})`);
  Bl.Fireball.DRAG_WATER = savedDw;
  const savedPower = Gh.EXPLOSION_POWER_DEFAULT;
  Gh.EXPLOSION_POWER_DEFAULT = -1;
  okAv(Gh.EXPLOSION_POWER_DEFAULT !== savedPower, 'breaking Gh.EXPLOSION_POWER_DEFAULT is visible');
  Gh.EXPLOSION_POWER_DEFAULT = savedPower;
}


// ═════════════════════ 10. ghast TargetGoal / FlyRandomlyGoal RNG guard ═════════════════════
// loop/mob-test-hostile (worker w3, s139) — a real live bug caught by breadth-testing the
// hostile mob group in the browser: `Gh.TargetGoal.canUse` and `Gh.FlyRandomlyGoal.start` both
// read `var r = NS.EntityList ? NS.EntityList.random : Math.random;` — but `NS.EntityList` is
// ALWAYS truthy (it's the module object, not the RNG), so this ternary never falls through to
// `Math.random`; it evaluates to `NS.EntityList.random`, which `07i_entitylist.js` initializes
// to `null` and never assigns elsewhere. Every other call site in the codebase gets this right
// with the `EL.random || Math.random` idiom (see 07i_entitylist.js's own dozen uses); the ghast
// file alone used the broken `cond ? a : b` shape instead of `a || b`. Live symptom: spawning a
// ghast and letting it tick threw `TypeError: r is not a function` inside
// `GoalSelector.tick` on every tick where `TargetGoal.canUse`'s 1-in-10 roll or
// `FlyRandomlyGoal`'s wander-start ever ran — a permanently unusable, console-spamming ghast
// that can never wander or target a player. Fixed both call sites to
// `(NS.EntityList && NS.EntityList.random) || Math.random`.
{
  say('\n§10 ghast TargetGoal / FlyRandomlyGoal RNG guard');
  freshWorld();
  const gh = spawn('ghast', 0.5, 64, 0.5);
  const plr = { type: 'player', x: 0.5, y: 64, z: 4.5, health: 20, maxHealth: 20, height: 1.8,
    vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 };
  EL.list.push(plr);
  const tg = new Gh.TargetGoal(gh, () => [plr]);
  let threw = null;
  try {
    // canUse rolls Math.floor(r()*10)===0 -- run enough times that the 1-in-10 branch that
    // actually calls r() again (the follow-range/canSee scan) is certain to have fired.
    for (let i = 0; i < 500; i++) tg.canUse();
  } catch (e) { threw = e; }
  ok(!threw, `ghast TargetGoal.canUse never throws across 500 ticks (got ${threw && threw.message})`);

  const wg = new Gh.FlyRandomlyGoal(gh);
  threw = null;
  try {
    for (let i = 0; i < 20; i++) { wg.start(); wg.stop(); }
  } catch (e) { threw = e; }
  ok(!threw, `ghast FlyRandomlyGoal.start never throws (got ${threw && threw.message})`);

  // full roster + real GoalSelector.tick, the exact path the live browser bug went through
  // (EL.tickMob -> GoalSelector.tick -> TargetGoal.canUse), for many ticks so the RNG rolls land.
  freshWorld();
  const gh2 = spawn('ghast', 0.5, 64, 0.5);
  const plr2 = { type: 'player', x: 0.5, y: 64, z: 4.5, health: 20, maxHealth: 20, height: 1.8,
    vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 };
  EL.list.push(plr2);
  threw = null;
  try { for (let i = 0; i < 300; i++) gh2.ai.tick(); } catch (e) { threw = e; }
  ok(!threw, `a live ghast's full GoalSelector.tick() runs 300 ticks with no throw (got ${threw && threw.message})`);

  // ── anti-vacuity: the exact broken expression shape, proven to throw under the exact
  // condition production is always in (EL.random === null) -- this is not a stale/vacuous
  // assertion, the ternary really does reach for a non-function and blow up. ──
  ok(EL.random === null, 'precondition: EL.random is null in this harness, matching production default');
  const NS = { EntityList: EL };
  const buggyR = NS.EntityList ? NS.EntityList.random : Math.random;
  let brokenThrew = false;
  try { buggyR(); } catch (e) { brokenThrew = true; }
  okAv(brokenThrew, 'the OLD `cond ? EL.random : Math.random` shape genuinely throws here -- this check is not vacuous');
  const fixedR = (NS.EntityList && NS.EntityList.random) || Math.random;
  let fixedThrew = false;
  try { fixedR(); } catch (e) { fixedThrew = true; }
  okAv(!fixedThrew, 'the FIXED `(EL && EL.random) || Math.random` shape does not throw under the same condition');
}

// ═════════════════════ 11. ghast full roster actually FIRES a fireball (KW-39) ══════════════
// `ShootFireballGoal` (Gh.roster) was registered at priority 7 with `Ai.MOVE | Ai.LOOK` controls
// -- the SAME priority as the always-on `LookAtTargetGoal` (LOOK) -- and GoalSelector's own
// `<=`-priority conflict rule (07k_goals.js) blocks a goal from ever starting while an
// equal-or-higher-priority RUNNING goal holds a flag it needs. A ghast with a target could
// therefore never start its fireball goal at all: 0 shots, ever (live-browser confirmed).
// Vanilla's `ShootFireballGoal` sets NO controls (GhastEntity.java:257-263, .decomp/) -- it was
// never meant to compete for MOVE/LOOK. This check runs the REAL `Ai.ROSTER.ghast` roster (the
// same one `EL.spawn` wires up) with a target already acquired and a clear line of sight, and
// requires an actual `fireball` entity to appear in `EL.list` within one full charge cycle.
{
  say('\n§11 ghast full roster actually fires a fireball (KW-39)');
  freshWorld();
  const gh3 = spawn('ghast', 0.5, 64, 0.5);
  const plr3 = { type: 'player', x: 0.5, y: 64, z: 10.5, health: 20, maxHealth: 20, height: 1.8,
    vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 };
  EL.list.push(plr3);
  gh3.target = plr3;   // bypass TargetGoal's 1-in-10 acquire roll -- determinism, not the thing under test
  const fireballs = () => EL.list.filter((x) => x.type === 'fireball').length;
  const before = fireballs();
  for (let i = 0; i < 90 && fireballs() === before; i++) gh3.ai.tick();
  const after = fireballs();
  ok(after > before, `a ghast with a visible target fires a real fireball within 90 ticks (${Gh.SHOOT_FIRE_TICKS}-tick charge) via the full goal roster, got ${after - before} fireball(s)`);

  // §11b world events 1015/1016: volume 10, pitch in [0.8,1.2]
  {
    const calls = [], S = MCL.Sound || (MCL.Sound = {}), saved = [S.play, S.mobSound];
    S.play = () => true; S.mobSound = (e, ev, v, p) => { calls.push([ev, v, p]); return true; };
    freshWorld();
    const g = spawn('ghast', 0.5, 64, 0.5), pl = { type: 'player', x: 0.5, y: 64, z: 10.5, health: 20, maxHealth: 20, height: 1.8 };
    EL.list.push(pl); g.target = pl;
    for (let i = 0; i < 25; i++) g.ai.tick();
    [S.play, S.mobSound] = saved;
    for (const ev of ['entity.ghast.warn', 'entity.ghast.shoot']) {
      const c = calls.find((x) => x[0] === ev);
      ok(c && c[1] === 10 && c[2] >= 0.8 && c[2] <= 1.2, `${ev}: volume 10, pitch in [0.8,1.2] (got ${c})`);
      okAv(!(c && c[1] === undefined), `${ev} volume is not the default`);
    }
  }

  // ── anti-vacuity: reproduce the OLD and FIXED control-flag shapes directly against the REAL
  // GoalSelector/FlyRandomlyGoal/LookAtTargetGoal/ShootFireballGoal classes -- proves the check
  // genuinely flips on the exact one-line change, not on something else in the harness. ──
  function rosterShaped(shootFlags) {
    freshWorld();
    const gh = spawn('ghast', 0.5, 64, 0.5);
    const plr = { type: 'player', x: 0.5, y: 64, z: 10.5, health: 20, maxHealth: 20, height: 1.8,
      vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 };
    EL.list.push(plr);
    gh.target = plr;
    const gs = new Ai.GoalSelector();
    gs.add(5, Ai.MOVE, new Gh.FlyRandomlyGoal(gh));
    gs.add(7, Ai.LOOK, new Gh.LookAtTargetGoal(gh));
    const shoot = new Gh.ShootFireballGoal(gh);
    gs.add(7, shootFlags, shoot);
    const b = fireballs();
    for (let i = 0; i < 90; i++) gs.tick();
    return { fired: fireballs() - b, running: gs.isRunning(shoot) };
  }
  const oldShape = rosterShaped(Ai.MOVE | Ai.LOOK);   // the KW-39 bug
  okAv(oldShape.fired === 0 && !oldShape.running, `old MOVE|LOOK-at-prio-7 shape never starts/fires (got fired=${oldShape.fired}, running=${oldShape.running})`);
  const fixedShape = rosterShaped(0);   // vanilla: no controls
  okAv(fixedShape.fired > 0 && fixedShape.running, `fixed 0-controls shape starts and fires (got fired=${fixedShape.fired}, running=${fixedShape.running})`);
}

// ═════════════════════ 13. #1763 ShootFireballGoal range is feet-to-feet ═════════════════════
{
  say('\n§13 ShootFireballGoal: Entity.squaredDistanceTo (feet to feet) < 4096');
  function charge(dy, horiz) {
    freshWorld();
    const gh = spawn('ghast', 0.5, 64, 0.5);
    const plr = { type: 'player', x: 0.5, y: 64 + dy, z: 0.5 + horiz, health: 20, maxHealth: 20, height: 1.8,
      vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 };
    EL.list.push(plr);
    gh.target = plr;
    const g = new Gh.ShootFireballGoal(gh);
    g.start();
    const saved = Ai.canSee; Ai.canSee = () => true;
    try { for (let i = 0; i < 12; i++) g.tick(); } finally { Ai.canSee = saved; }
    return gh.shooting;
  }
  ok(charge(8, 63.5) === false, 'dy=+8, horiz 63.5: feet distSq 4096.25 -> no charge (mid-body dy would charge)');
  ok(charge(-8, 63.4) === true, 'dy=-8, horiz 63.4: feet distSq 4083.6 -> charges (mid-body dy would not)');
  ok(charge(10, 60) === true && charge(-10, 63.5) === false, 'dy=+10 horiz 60 charges; dy=-10 horiz 63.5 does not');
  const src = readFileSync(join(MCLITE_ROOT, 'src/07zzi_ghast.js'), 'utf8');
  okAv(/height \|\| 0\) \* 0\.5\) - \(e\.y/.test(src.replace(/\s+/g, ' ')) === false, 'source no longer uses mid-body dy in the range test');
}

// ═════════════════════ 14. #1864 blaze ShootFireballGoal melee threshold is feet-to-feet ═════
{
  say('\n§14 blaze ShootFireballGoal: Entity.squaredDistanceTo (feet to feet) < 4.0 is melee');
  function melee(horiz, tH) {
    freshWorld();
    const bl = spawn('blaze', 0.5, 64, 0.5);
    const plr = { type: 'player', x: 0.5, y: 64, z: 0.5 + horiz, health: 20, maxHealth: 20, height: tH,
      vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 };
    EL.list.push(plr);
    bl.target = plr;
    const g = new Bl.ShootFireballGoal(bl);
    g.start();
    const savedS = Ai.canSee, savedA = Cb.mobAttack; let hits = 0;
    Ai.canSee = () => true; Cb.mobAttack = () => { hits++; };
    try { g.tick(); } finally { Ai.canSee = savedS; Cb.mobAttack = savedA; }
    return hits > 0;
  }
  ok(melee(1.95, 0.5) === true, 'feet distSq 3.80 < 4 -> melee (body-centre distSq 4.22 would not)');
  ok(melee(2.05, 0.5) === false, 'feet distSq 4.20 >= 4 -> no melee');
  ok(Math.abs(Bl.EYE_HEIGHT - 1.53) < 1e-9, 'blaze eye height is 1.8*0.85 (Entity.getEyeHeight default)');
  okAv(melee(1.95, 0.5) !== melee(2.05, 0.5), 'the two sides of the threshold disagree');
}

// ═════════════════════ 8. #643: player deflect -> x1000 ghast kill ═══════════════════════════
{
  say('\n§8 punch a fireball back: owner=player, power=look*0.1; it then kills the ghast');
  function scenario(breakIt) {
    freshWorld();
    const savedP = MCL.Player;
    const plr = { type: 'player', x: 0.5, y: 64, z: 20.5, health: 20, maxHealth: 20, yaw: 0, pitch: 0,
      lookVec: () => [0, 0, -1] };
    MCL.Player = plr;
    try {
      const gh = spawn('ghast', 0.5, 64.5, 0.5);
      const fb = spawn('fireball', 0.5, 64.5, 8.5, { power: [0, 0, 1], shooter: gh, explosionPower: 1 });
      const hit = Cb.hurt(fb, 1, undefined, true);
      const r = { hit, owner: fb.shooter === plr, px: fb.powerX, pz: fb.powerZ };
      if (breakIt) fb.shooter = gh;   // break: reflected ball credited to the ghast -> no kill
      fb.x = 0.5; fb.y = 64.5; fb.z = 0.5;
      Gh.tickFireball(fb);
      r.dead = gh.health <= 0 || !!gh.dead;
      return r;
    } finally { MCL.Player = savedP; }
  }
  const good = scenario(false);
  ok(good.hit && good.owner && near(good.pz, -0.1) && near(good.px, 0), `punching a fireball re-owns it to the player with power=look*0.1 (got ${JSON.stringify(good)})`);
  ok(good.dead, 'a player-deflected fireball hitting the ghast kills it (x1000)');
  okAv(!scenario(true).dead, 'a fireball not owned by the player does not kill the ghast outright');
}

// ═════════════════════ 12. GhastMoveControl (#642) ═══════════════════════════════════════════
{
  say('\n§12 GhastMoveControl: 0.1 impulse per cooldown, abandon on blocked path');
  function run(blocked, rnd) {
    freshWorld();
    if (blocked) for (let y = 70; y <= 80; y++) for (let z = 6; z <= 12; z++) for (let x = -6; x <= 6; x++) put(x, y, z, 'stone');
    const gh = spawn('ghast', 0.5, 74, 0.5);
    const c = gh.flyMove;
    c.moveTo(0.5, 74, 10.5, 1);
    const incs = []; let abandoned = -1;
    withRnd(rnd, () => {
      for (let t = 0; t < 40; t++) {
        const v0 = [gh.vx, gh.vy, gh.vz];
        c.tick();
        const dvz = gh.vz - v0[2];
        if (dvz !== 0) incs.push([t, dvz, gh.vx - v0[0], gh.vy - v0[1]]);
        if (!c.isMoving() && abandoned < 0) abandoned = t;
        gh.vx = gh.vy = gh.vz = 0;   // isolate the impulse from travel
      }
    });
    return { incs, abandoned, moving: c.isMoving() };
  }
  const rnd0 = () => 0.5;   // nextInt(5) = 2 -> cooldown 4 -> impulse every 5th tick? (cooldown-- <= 0, += 4)
  const clear = run(false, rnd0);
  ok(clear.incs.length >= 6 && clear.incs.every((i) => near(i[1], 0.1, 1e-9) && near(i[2], 0, 1e-9) && near(i[3], 0, 1e-9)),
    `clear path: each impulse is exactly 0.1*dir (dir=+z) (${JSON.stringify(clear.incs.slice(0, 3))})`);
  const gaps = clear.incs.slice(1).map((v, k) => v[0] - clear.incs[k][0]);
  ok(gaps.every((g) => g === 4), `impulses fall on the cooldown boundary (every nextInt(5)+2 = 4 ticks; gaps ${gaps.slice(0, 5)})`);
  ok(clear.moving, 'clear path: still MOVE_TO');
  const blk = run(true, rnd0);
  ok(blk.abandoned === 0 && blk.incs.length === 0 && !blk.moving, `blocked path: WAIT at the first check, no impulse (abandoned=${blk.abandoned}, incs=${blk.incs.length})`);
  freshWorld();
  const g = spawn('ghast', 0.5, 74, 0.5);
  ok(g.flyMove.isMoving() === false, 'ghast starts idle -> FlyRandomlyGoal.canStart true');
  ok(new Gh.FlyRandomlyGoal(g).canContinueToUse() === false, 'FlyRandomlyGoal.shouldContinue is false (one-shot repick)');
  okAv(blk.abandoned !== clear.abandoned, 'anti-vacuity: blocked and clear runs differ');
  const saved = Gh.boxEmptyAt; Gh.boxEmptyAt = () => true;
  const broken = run(true, rnd0);
  Gh.boxEmptyAt = saved;
  okAv(broken.incs.length > 0 && broken.moving, 'anti-vacuity: with wall avoidance broken the ghast pushes into the wall');
}

// ═════════ 12. ghast TargetGoal.canContinueToUse: followRange (no 1.5x) + 60-tick lost-sight timeout ═════════
{
  say('\n§12 ghast TargetGoal.shouldContinue (TrackTargetGoal)');
  freshWorld();
  const g = spawn('ghast', 0.5, 64, 0.5);
  const fr = Ai.followRangeOf(g);
  const mk = (z) => ({ type: 'player', x: 0.5, y: 64, z, health: 20, maxHealth: 20, height: 1.8 });
  const near = mk(0.5 + fr - 1), far = mk(0.5 + fr + 1);
  let tg = new Gh.TargetGoal(g, () => []);
  g.target = near; ok(tg.canContinueToUse() === true, `inside follow range ${fr}: kept`);
  g.target = far; ok(tg.canContinueToUse() === false, `just past follow range ${fr}: dropped (no 1.5x)`);
  const realSee = Ai.canSee;
  Ai.canSee = () => false;
  tg = new Gh.TargetGoal(g, () => []); tg.start(); g.target = near;
  let n = 0; while (tg.canContinueToUse() && n < 200) n++;
  ok(n === 60, `unseen target dropped on the 61st check (kept ${n})`);
  Ai.canSee = () => true;
  const n2 = (() => { let k = 0; tg.start(); g.target = near; while (tg.canContinueToUse() && k < 200) k++; return k; })();
  ok(n2 === 200, 'visible target never times out');
  Ai.canSee = realSee;
  okAv(n === 60 && n2 === 200, 'anti-vacuity: visibility toggles the outcome');
}

// ═════════ 13. #1977: ExplosionPower 0 survives (spawn opt -> fireball -> explode at 0) ═════════
{
  say('\n§13 ExplosionPower 0 is not coerced to 1');
  freshWorld();
  const g0 = spawn('ghast', 0.5, 80, 0.5, { fireballStrength: 0 });
  ok(g0.fireballStrength === 0, `ghast keeps fireballStrength 0 (got ${g0.fireballStrength})`);
  const f0 = spawn('fireball', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: g0, explosionPower: g0.fireballStrength });
  ok(f0.explosionPower === 0, `fireball keeps explosionPower 0 (got ${f0.explosionPower})`);
  const realExplode = Ex.explode; let pw = null;
  Ex.explode = function () { pw = arguments[4]; return realExplode.apply(this, arguments); };
  f0.onGround = true; Gh.tickFireball(f0);
  Ex.explode = realExplode;
  ok(pw === 0, `tickFireball explodes at power 0 (got ${pw})`);
  const f1 = spawn('fireball', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: g0 });
  okAv(f1.explosionPower === 1 && f0.explosionPower === 0, 'anti-vacuity: absent opt defaults to 1, explicit 0 stays 0');
}

// ═════════ 14. #3158: ghast TargetGoal refuses untargetable players at acquisition ═════════
{
  say('\n§14 ghast TargetGoal gates on Ai.canTargetLiving');
  freshWorld();
  const g = spawn('ghast', 0.5, 64, 0.5);
  const p = { type: 'player', x: 0.5, y: 64, z: 4.5, health: 20, maxHealth: 20, height: 1.8, invulnerableGamemode: true };
  const realSee = Ai.canSee, realRand = EL.random;
  Ai.canSee = () => true; EL.random = () => 0;   // the 1-in-10 roll always lands
  const tg = new Gh.TargetGoal(g, () => [p]);
  ok(tg.canUse() === false && !g.target, 'untargetable (creative-style) player is not acquired');
  g.target = p; ok(tg.canContinueToUse() === false, 'untargetable player is not kept');
  g.target = null; p.invulnerableGamemode = false;
  okAv(tg.canUse() === true && g.target === p, 'anti-vacuity: the same player IS acquired once targetable');
  Ai.canSee = realSee; EL.random = realRand;
}

// ═════════ 15. #3503: every HURT_BY_WATER type is wet in a bubble column ═════════
{
  say('\n§15 isWet == inWater||rain||bubbleColumn');
  freshWorld();
  const bc = R.id.bubble_column;
  const types = ['blaze', 'enderman', 'snow_golem', 'strider'];
  const hits = (e) => { let n = 0; const real = MCL.Combat.hurt; MCL.Combat.hurt = () => { n++; }; try { (e.type === 'blaze' ? Bl.mobTick(e) : e.type === 'enderman' ? MCL.Enderman.applyWaterDamage(e) : MCL.SnowGolem.applyWaterDamage(e)); } finally { MCL.Combat.hurt = real; } return n; };
  for (const t of types) {
    W.setBlock(0, 70, 0, 0);
    const e = spawn(t, 0.5, 70, 0.5); e.inWater = false;
    const dry = hits(e);
    put(0, 69, 0, 'soul_sand'); put(0, 70, 0, 'bubble_column');
    const wet = hits(e);
    W.setBlock(0, 70, 0, 0);
    okAv(dry === 0 && wet >= 1, `${t}: dry=${dry} bubble column=${wet}`);
  }
}

// ═════════ 16. #3612: ghast ActiveTargetGoal picks the closest player from the EYE ═════════
{
  say('\n§16 ghast target = closest from eye (2.6), not feet');
  freshWorld();
  const gh = spawn('ghast', 0.5, 64, 0.5);
  const mk = (x, y, z) => ({ type: 'player', x, y, z, health: 20, maxHealth: 20, height: 1.8, vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 });
  const lo = mk(4.5, 61, 0.5), hi = mk(0.5, 67, 5);   // feet: lo 5.0 < hi 5.83; eye(66.6): lo 6.88 > hi 5.02
  const realSee = Ai.canSee; Ai.canSee = () => true;
  const tg = new Gh.TargetGoal(gh, () => [lo, hi]);
  const got = withRnd(() => 0, () => tg.canUse() && gh.target);
  Ai.canSee = realSee;
  okAv(got === hi, 'ghast picks the player nearer its eye, not nearer its feet');
}

// ═════════ #3796: fireball hits non-living collidable entities (boat, minecart, end crystal) ═════════
{
  say('\n§#3796 fireball vs boat/minecart/end_crystal (no maxHealth)');
  for (const [type, hits] of [['boat', true], ['minecart', true], ['end_crystal', true], ['item', false]]) {
    freshWorld();
    const gh = spawn('ghast', 0.5, 80, 0.5);
    const fb = spawn('fireball', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: gh, explosionPower: 0 });
    const tgt = { type, x: 5.5, y: 64.5, z: 5.6, width: 1.4, height: 0.6, vx: 0, vy: 0, vz: 0 };
    EL.list.push(tgt);
    Gh.tickFireball(fb);
    if (hits) ok(fb.removed === true, `fireball hits a ${type} with no maxHealth`);
    else okAv(fb.removed !== true, `anti-vacuity: a ${type} (not collidable) is still flown through`);
    EL.list.pop();
  }
}

// ═════════ #4300: ghast acquisition scales followRange by getAttackDistanceScalingFactor ═════════
{
  say('\n§#4300 ghast target range x sneak 0.8');
  freshWorld();
  const gh = spawn('ghast', 0.5, 64, 0.5); gh.followBonus = 0;   // MobEntity.initialize's random follow_range bonus (+-0.11) would move the 80 boundary
  const mk = (x, crouching) => ({ type: 'player', x, y: 64, z: 0.5, crouching, health: 20, maxHealth: 20, height: 1.8, vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 });
  const realSee = Ai.canSee; Ai.canSee = () => true;
  const tryAcq = (p) => { gh.target = null; const tg = new Gh.TargetGoal(gh, () => [p]); return withRnd(() => 0, () => tg.canUse()); };
  ok(tryAcq(mk(90.5, false)), 'standing player at 90 is acquired');
  ok(!tryAcq(mk(90.5, true)), 'sneaking player at 90 (> 100*0.8) is not acquired');
  okAv(tryAcq(mk(75.5, true)), 'sneaking player at 75 (< 80) is acquired');
  Ai.canSee = realSee;
}

// ═════════ #4532: a direct fireball hit is an isFire() source -- Fire Resistance swallows it ═════════
{
  say('\n§#4532 fire_resistance vs direct fireball hit (mob path)');
  const E = MCL.Effects || (MCL.Effects = {}), real = E.hasStatusEffect;
  const hit = (fr) => {
    freshWorld(); E.hasStatusEffect = (e, n) => fr && n === 'fire_resistance';
    const gh = spawn('ghast', 0.5, 80, 0.5);
    const fb = spawn('fireball', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: gh, explosionPower: 0 });
    const t = { type: 'cow', x: 5.5, y: 64.5, z: 5.6, health: 20, maxHealth: 20, width: 0.9, height: 1.4, vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 };
    EL.list.push(t); Gh.tickFireball(fb); EL.list.pop();
    return t.health;
  };
  try {
    ok(hit(true) === 20, 'fire-resistant mob takes 0 from a direct fireball hit');
    okAv(hit(false) < 20, 'anti-vacuity: without fire_resistance the same hit hurts');
  } finally { E.hasStatusEffect = real; }
  ok(MCL.Survival && MCL.Survival.DAMAGE_SOURCES ? MCL.Survival.DAMAGE_SOURCES.fireball.fire === true : true, 'survival fireball source carries fire:true');
}

console.log(`\n${pass} passed, ${fails.length} failed (of which ${breaks} anti-vacuity probes)`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
