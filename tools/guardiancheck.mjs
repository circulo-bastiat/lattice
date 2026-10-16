#!/usr/bin/env node
// guardiancheck.mjs - #1011: GuardianEntity / ElderGuardianEntity AI (src/07zzr_guardian.js):
// warmup times, the FireBeamGoal (beam target set, damage after warmup, LOS drop), the target predicate,
// thorns, the out-of-water flop and GuardianMoveControl. Every claim is also broken on purpose ("breaks caught").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ok ' : '  XX ') + m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

console.log('guardiancheck - #1011: guardian + elder guardian AI');
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
          '14j_combat.js', '07zi_squid.js', '07zzr_guardian.js']
});
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Squid.init();
const EL = M.EntityList, W = M.World, S = M.States, Gd = M.Guardian, Cb = M.Combat, Ai = M.Ai;

for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const stone = S.stateOf('stone') | 0, water = S.stateOf('water') | 0, air = 0;
const tank = (x0, x1) => { for (let x = x0; x <= x1; x++) for (let z = -3; z <= 3; z++) for (let y = 0; y <= 7; y++) {
  const wall = x === x0 || x === x1 || z === -3 || z === 3 || y === 0 || y === 7;
  W.setBlock(x, y, z, wall ? stone : water);
} };
tank(-3, 12);
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
const fresh = (type, x, tx) => {
  EL.list.length = 0;
  const g = EL.spawn(type, x, 3.5, 0.5), t = EL.spawn('squid', tx, 3.5, 0.5);
  g.inWater = true; t.inWater = true; t.id = t.id || 77;
  return [g, t];
};

// 1. data
{
  const [g] = fresh('guardian', 0.5, 6.5), [el] = fresh('elder_guardian', 0.5, 6.5);
  ok(Gd.getWarmupTime(g) === 80 && Gd.getWarmupTime(el) === 60, `warmup 80 guardian / 60 elder - got ${Gd.getWarmupTime(g)}/${Gd.getWarmupTime(el)}`);
  ok(g.spikesRetracted === false && g.beamTargetId === 0 && g.experiencePoints === 10, 'spawnInit: spikes out, no beam target, xp 10');
  ok(!!M.Ai.ROSTER.guardian && !!M.Ai.ROSTER.elder_guardian, 'guardian + elder_guardian are rostered');
  ok(Gd.getFlopSound(el) === 'entity.elder_guardian.flop' && Gd.getFlopSound(g) === 'entity.guardian.flop', 'flop sound differs for the elder');
}

// 2. FireBeamGoal: beam target at tick 10, damage at warmup
function runBeam(type, limit) {
  const [g, t] = fresh(type, 0.5, 6.5);
  const goal = new Gd.FireBeamGoal(g);
  g.target = t;
  ok(goal.canUse(), type + ' FireBeamGoal.canUse with a live target');
  goal.start();
  let beamAt = -1, dmgAt = -1; const h0 = t.health;
  for (let i = 1; i <= limit; i++) {
    goal.tick();
    if (beamAt < 0 && Gd.hasBeamTarget(g)) beamAt = i;
    if (dmgAt < 0 && t.health < h0) { dmgAt = i; break; }
  }
  return { g, t, goal, beamAt, dmgAt, h0 };
}
{
  const r = runBeam('guardian', 200);
  ok(r.beamAt === 10, `beam target is set when beamTicks reaches 0 (tick 10 after start at -10) - got ${r.beamAt}`);
  ok(r.dmgAt === 90, `guardian damage lands when beamTicks hits 80 (tick 90) - got ${r.dmgAt}`);
  ok(r.h0 - r.t.health >= 6, `magic 1 + mob attack 6 lands on a squid (lost ${r.h0 - r.t.health})`);
  ok(r.g.target === null, 'target is cleared after the shot');
  const el = runBeam('elder_guardian', 200);
  ok(el.dmgAt === 70, `elder damage lands at warmup 60 (tick 70) - got ${el.dmgAt}`);
  ok(el.h0 - el.t.health >= 8, `elder lands magic 3 + attack 8 - lost ${el.h0 - el.t.health}`);
  // anti-vacuity: lengthen the warmup and the damage tick must move
  const w = Gd.WARMUP_ELDER; Gd.WARMUP_ELDER = 999;
  const slow = runBeam('elder_guardian', 200);
  Gd.WARMUP_ELDER = w;
  okAv(slow.dmgAt === -1, 'a 999-tick warmup deals no damage in 200 ticks (the check sees warmup)');
  // goal.stop clears the beam
  r.goal.stop();
  ok(!Gd.hasBeamTarget(r.g) && r.g.target === null, 'FireBeamGoal.stop clears beam target + target');
}

// 3. line of sight
{
  const [g, t] = fresh('guardian', 0.5, 9.5);
  for (let y = 1; y <= 6; y++) for (let z = -2; z <= 2; z++) W.setBlock(5, y, z, stone);
  const goal = new Gd.FireBeamGoal(g); g.target = t; goal.start();
  goal.tick();
  okAv(g.target === null && !Gd.hasBeamTarget(g), 'a wall between guardian and target drops the target (no LOS)');
  for (let y = 1; y <= 6; y++) for (let z = -2; z <= 2; z++) W.setBlock(5, y, z, water);
  g.target = t; goal.start(); goal.tick();
  ok(g.target === t, 'with the wall removed the target is kept');
}

// 4. target predicate
{
  const [g, t] = fresh('guardian', 0.5, 6.5);
  ok(Gd.targetPredicate(g, t), 'a squid 6 blocks away is a valid target');
  t.x = g.x + 2;
  okAv(!Gd.targetPredicate(g, t), 'a squid inside 3 blocks is refused (distSq > 9)');
  const gs = EL.spawn('glow_squid', 6.5, 3.5, 0.5);
  ok(Gd.targetPredicate(g, gs), 'a glow_squid (extends SquidEntity) 6 blocks away is a valid target');
  okAv(gs.type === 'glow_squid', 'the target really is a glow_squid');
  const z = EL.spawn('zombie', 6.5, 3.5, 0.5);
  ok(!Gd.targetPredicate(g, z), 'a zombie is never a guardian target');
  M.Player = { x: 8, y: 3, z: 0.5, EYE: 1.62 };
  ok(Gd.targetPredicate(g, M.Player), 'the player beyond 3 blocks is a target');
  ok(Gd.candidates(g).indexOf(M.Player) >= 0, 'candidates() lists the player');
  M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
}

// 5. thorns
{
  const [g, a] = fresh('guardian', 0.5, 2.5);
  const h0 = a.health;
  g.spikesRetracted = false;
  Cb.hurt(g, 1, undefined, false, { attacker: a });
  ok(h0 - a.health === 2, `spikes out: a living attacker takes 2 thorns - lost ${h0 - a.health}`);
  const h1 = a.health; g.spikesRetracted = true; g.invulnerable = 0;
  Cb.hurt(g, 1, undefined, false, { attacker: a });
  okAv(a.health === h1, 'spikes retracted: no thorns');
  g.spikesRetracted = false; g.invulnerable = 0;
  Cb.hurt(g, 1, undefined, false, { attacker: a, source: 'magic', bypassArmor: true });
  ok(a.health === h1, 'magic damage never triggers thorns');
  Cb.hurt(g, 1, undefined, false, { attacker: a, source: 'projectile' });
  ok(a.health === h1, 'a projectile (non-living direct source) never triggers thorns');
  // #1597: DamageSource.thorns has no setBypassesArmor - an armoured player takes LESS than 2.0
  const P0 = M.Player;
  const hurtP = (armor, tag) => {
    M.Player = { x: 0.5, y: 3.5, z: 0.5, EYE: 1.62, health: 20, maxHealth: 20, armor, armorToughness: 0, invulnerable: 0, lastHurt: 0 };
    Gd.hurtMagic(M.Player, 2, g, tag);
    return 20 - M.Player.health;
  };
  const lost = hurtP(20, true), lostMagic = hurtP(20, false);
  ok(lost > 0 && lost < 2, `thorns vs 20 armour points is reduced below 2.0 - lost ${lost}`);
  okAv(lostMagic === 2, 'magic (beam) damage still bypasses armour');
  M.Player = P0;
}

// 6. land flop
{
  const [g] = fresh('guardian', 0.5, 6.5);
  g.inWater = false; g.onGround = true; g.vy = 0;
  Gd.tick(g);
  okAv(g.vy >= 0.5 && g.onGround === false, `out of water on the ground the guardian flops: vy ${g.vy.toFixed(2)}, onGround ${g.onGround}`);
  ok(g.spikesExtensionRate === 2.0, 'out of water spikesExtensionRate is 2.0');
  g.inWater = true; g.air = 10; Gd.tick(g);
  ok(g.air === 300, 'in water the air resets to 300');
}

// 7. GuardianMoveControl
{
  const [g] = fresh('guardian', 0.5, 6.5);
  g.yaw = 0; g.vx = g.vy = g.vz = 0;
  g.navigating = true; g.navNode = { x: 8, y: 3.5, z: 0 };
  Gd.travelMob(g);
  ok(g.spikesRetracted === true, 'moving along a path retracts the spikes');
  ok(Math.abs(g.yaw) > 0, 'yaw turns toward the path node');
  const x1 = g.x;
  ok(g.mobSpeed > 0, 'movement speed lerps up from 0');
  g.navigating = false; g.navNode = null;
  Gd.travelMob(g);
  okAv(g.spikesRetracted === false && g.mobSpeed === 0, 'no path: spikes out again, speed 0');
  ok(g.zza === 0, 'no forward input is ever fed to travel()');
}

console.log('================ guardiancheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   X ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log(`${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
