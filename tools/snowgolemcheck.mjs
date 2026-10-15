#!/usr/bin/env node
// snowgolemcheck.mjs — loop/snowgolem: the SNOW GOLEM, whole (src/07zq_snowgolem.js plus the
// small additive lines this unit put in 07i_entitylist.js/14j_combat.js/07k_goals.js/
// 07zw_mobnbt.js/14l_use.js — see 07zq_snowgolem.js's own header for exactly what is here vs
// what is SG.OWED).
//
//   node tools/snowgolemcheck.mjs [--verbose]
//
// ANTI-VACUITY (D-30/D-305): every section that asserts a positive also breaks its own input
// and asserts the break is caught — a check that cannot fail is not evidence.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, m); if (VERBOSE && c) console.log('   ✓ anti-vacuity: ' + m); };

console.log('snowgolemcheck — SNOW GOLEM (mob, snowball, shear, construction pattern)');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14j_combat.js', '07zw_mobnbt.js',
          '07zq_snowgolem.js', '07zzr_minecart.js'],
  dom: false
});
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')),
  // the generated DATA.monsterTypes, read back out of src/19_data.gen.js (gen-data.mjs inlines it)
  monsterTypes: JSON.parse(/monsterTypes:\s*(\[[^\]]*\])/.exec(readFileSync(join(MCLITE_ROOT, 'src', '19_data.gen.js'), 'utf8'))[1])
});
M.Entities.init();
M.EntityList.init();
M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();

const R = M.Reg, SR = M.States, Ph = M.Physics, Ent = M.Entities, EL = M.EntityList, Ai = M.Ai,
      Cb = M.Combat, SG = M.SnowGolem, Spawn = M.Spawn;
ok(R.ready, 'block registry decoded');
ok(SR.ready, 'block states decoded');
ok(!!SG && SG.ready, 'NS.SnowGolem module loaded and ready');
ok(Ent.ready && EL.ready && Ai.ready && Cb.ready, 'Entities/EntityList/Ai/Combat all report ready');

// a fake world: a Map from "x,y,z" to a real state id (silverfishcheck's own stub, reused).
const CELLS = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
let BIOME_TEMP = 0.5, RAINING = false;
M.World = {
  getBlock: (x, y, z) => CELLS.get(key(x, y, z)) || 0,
  setBlock: (x, y, z, st) => { CELLS.set(key(x, y, z), st); return true; },
  biomeAt: () => 0,
  heightAt: () => 0,
  get: () => null
};
M.Biomes = { temperatureAt: () => BIOME_TEMP };
M.Sky = { isRainingAt: () => RAINING, isEntityRainedOn: () => RAINING, weather: {} };
M.Commands = { rules: {}, ruleGet(name) { return this.rules[name]; } };

// ════════════════════════════════ 1. the real jar data: dims/attrs, and the golem's own
//    manually-resolved motion (07i_entitylist.js's own EL.motionFor branches) ══════════════
console.log('\n1. dimensions/attributes off the real jar-extracted table, motion off the manual branch');
{
  ok(EL.canSpawn('snow_golem') === true, 'EL.canSpawn(snow_golem) — the motionFor branch this unit added');
  ok(EL.canSpawn('snowball') === true, 'EL.canSpawn(snowball) — ditto, off ThrownEntity.getGravity()');
  okAv(EL.canSpawn('this_type_does_not_exist') === false,
    'anti-vacuity: a made-up type is correctly refused — canSpawn is not vacuously true for everything');

  const g = EL.spawn('snow_golem', 0.5, 64, 0.5);
  ok(!!g, 'EL.spawn(snow_golem) returns a live entity');
  ok(g.maxHealth === 4, `createSnowGolemAttributes: MAX_HEALTH 4.0 — got ${g.maxHealth}`);
  // the per-spawn "Random spawn bonus" spread (MobEntity.initialize) is mobrefattrcheck's; the table base is this line's
  ok(Math.abs(Ai.followRangeOf(g) - 16 * (1 + (g.followBonus || 0))) < 1e-9 && Ai.followRangeOf({ type: 'snow_golem' }) === 16,
    `createSnowGolemAttributes: FOLLOW_RANGE 16 (x the spawn bonus) — got ${Ai.followRangeOf(g)}`);
  ok(g.width === 0.7 && g.height === 1.9, `EntityType dims [0.7,1.9] — got [${g.width},${g.height}]`);
  ok(g.gravity === 0.08 && g.drag === 0.98, `EL.motionFor(snow_golem) === [0.08,0.98] — got [${g.gravity},${g.drag}]`);
  ok(g.hasPumpkin === true, 'EL.DEFAULTS.snow_golem: hasPumpkin defaults true (SNOW_GOLEM_FLAGS starts (byte)16)');

  const sb = EL.spawn('snowball', 0.5, 64, 0.5, { shooter: g });
  ok(!!sb, 'EL.spawn(snowball) returns a live entity');
  ok(sb.width === 0.25 && sb.height === 0.25, `EntityType dims [0.25,0.25] — got [${sb.width},${sb.height}]`);
  ok(sb.gravity === 0.03 && sb.drag === 0.99, `EL.motionFor(snowball) === [0.03,0.99] (ThrownEntity's own literals) — got [${sb.gravity},${sb.drag}]`);
}
console.log(`   ${pass} ok`);

// ════════════════════════════════ 2. Cb.eyeHeightOf: the golem's own fixed 1.7 override ══════
console.log('\n2. Cb.eyeHeightOf(snow_golem) — the FIXED 1.7 override, not height*0.85');
{
  const g = EL.spawn('snow_golem', 0, 64, 0);
  ok(Cb.eyeHeightOf(g) === 1.7, `getActiveEyeHeight override — got ${Cb.eyeHeightOf(g)}`);
  okAv(Math.abs(g.height * 0.85 - 1.7) > 0.05,
    'anti-vacuity: the generic height*0.85 formula (1.615) is NOT 1.7 — the override actually changes the answer');
}
console.log(`   ${pass} ok`);

// ════════════════════════════════ 3. Cb.mobShootSnowball — a real snowball, aimed ═══════════
console.log('\n3. Cb.mobShootSnowball — spawns a real snowball entity, velocity toward the target');
{
  EL.list.length = 0;
  const g = EL.spawn('snow_golem', 0, 64, 0);
  const target = EL.spawn('zombie', 8, 64, 0);
  const before = EL.list.length;
  const sb = Cb.mobShootSnowball(g, target, () => 0.5);   // gauss(0.5) center -> no noise this call
  ok(!!sb && EL.list.length === before + 1, 'a real snowball entity was spawned and added to EL.list');
  ok(sb.shooter === g, 'the snowball carries its shooter (golem)');
  okAv(sb.vx > 0, `anti-vacuity: the target is at +X — vx must be positive, got ${sb.vx} (proves direction math isn't a placeholder)`);

  EL.list.length = 0;
  const g2 = EL.spawn('snow_golem', 0, 64, 0);
  const target2 = EL.spawn('zombie', -8, 64, 0);
  const sb2 = Cb.mobShootSnowball(g2, target2, () => 0.5);
  okAv(sb2.vx < 0, `anti-vacuity, mirrored: the target is at -X — vx must be negative, got ${sb2.vx}`);
}
console.log(`   ${pass} ok`);

// ════════════════════════════════ 4. Cb.tickSnowball — blaze 3, everything else 0-but-hurt ═══
console.log('\n4. Cb.tickSnowball — 3 real damage to a blaze, 0 damage + knockback/flash to anything else');
{
  // `blaze` has no measured motion row in this engine at all yet (EL.motionFor('blaze') is
  // null, `entity-motion-1.18.2.tsv`'s own '# owed' line) -- EL.spawn refuses it outright, so
  // this is a plain object standing in for a LivingEntity, the same shape Cb.hurtZero's own
  // "attacker" argument two sections up already uses.
  EL.list.length = 0;
  const g = EL.spawn('snow_golem', 0, 64, 0);
  const blaze = { type: 'blaze', x: 1, y: 64, z: 0, width: 0.6, height: 1.8,
                   vx: 0, vy: 0, vz: 0, health: 20, maxHealth: 20 };
  EL.list.push(g, blaze);
  const sb = EL.spawn('snowball', 1, 64, 0, { shooter: g });
  EL.list.push(sb);
  const hp0 = blaze.health;
  Cb.tickSnowball(sb);
  ok(blaze.health === hp0 - 3, `a blaze takes exactly 3 damage — got ${blaze.health} from ${hp0}`);
  ok(sb.removed === true, 'the snowball is discarded on the hit');

  EL.list.length = 0;
  const g2 = EL.spawn('snow_golem', 0, 64, 0);
  const zombie = EL.spawn('zombie', 1, 64, 0);
  EL.list.push(g2, zombie);
  const sb2 = EL.spawn('snowball', 1, 64, 0, { shooter: g2 });
  EL.list.push(sb2);
  const hp1 = zombie.health, vz0 = zombie.vx || 0;
  Cb.tickSnowball(sb2);
  ok(zombie.health === hp1, `a non-blaze takes 0 damage — got ${zombie.health} from ${hp1}`);
  ok(zombie.hurtTime === Cb.HURT_DURATION, 'a non-blaze STILL gets the hurt-flash timer (Cb.hurtZero)');
  okAv(zombie.vx !== vz0, `anti-vacuity: a non-blaze is STILL knocked back (vx changed from ${vz0} to ${zombie.vx}) — 0 damage is not "nothing happens"`);
  ok(sb2.removed === true, 'the snowball is discarded on this hit too');

  // anti-vacuity: a target OUTSIDE the hit box is not hit at all.
  EL.list.length = 0;
  const g3 = EL.spawn('snow_golem', 0, 64, 0);
  const far = EL.spawn('zombie', 50, 64, 0);
  EL.list.push(g3, far);
  const sb3 = EL.spawn('snowball', 0, 64, 0, { shooter: g3 });
  EL.list.push(sb3);
  const hp2 = far.health;
  Cb.tickSnowball(sb3);
  okAv(far.health === hp2 && sb3.removed !== true,
    'anti-vacuity: a target far outside the AABB is untouched and the snowball keeps flying — the hit test is not vacuously true');

  // #4786: boats and minecarts collide() -> the snowball bursts on them
  for (const ty of ['boat', 'minecart']) {
    EL.list.length = 0;
    const gb = EL.spawn('snow_golem', 0, 64, 0);
    const veh = EL.spawn(ty, 3, 64, 0);
    EL.list.push(gb, veh);
    const sbb = EL.spawn('snowball', 3, 64.2, 0, { shooter: gb });
    EL.list.push(sbb);
    Cb.tickSnowball(sbb);
    ok(sbb.removed === true, `snowball overlapping a ${ty} is removed`);
    const sbf = EL.spawn('snowball', 30, 64.2, 0, { shooter: gb });
    EL.list.push(sbf);
    Cb.tickSnowball(sbf);
    okAv(sbf.removed !== true, `anti-vacuity: a snowball far from the ${ty} keeps flying`);
  }

  // #1190: the PLAYER's hitbox discards the snowball; PlayerEntity.damage(0) is false -> no flash/knockback.
  {
    const P = M.Player = { x: 0, y: 64, z: 0, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, hurtTime: 0 };   // stand-in (14_player.js not loaded)
    EL.list.length = 0;
    const g5 = EL.spawn('snow_golem', 0, 64, 0);
    EL.list.push(g5);
    P.x = 5; P.y = 64; P.z = 0; P.vx = 0; P.vz = 0;
    const sb5 = EL.spawn('snowball', 5, 64.5, 0, { shooter: g5 });
    EL.list.push(sb5);
    Cb.tickSnowball(sb5);
    ok(sb5.removed === true, 'a snowball crossing the player hitbox is discarded');
    ok(!P.hurtTime && P.vx === 0, 'and (PlayerEntity.damage(0)=false) no hurt flash / knockback on the player');
    const sb6 = EL.spawn('snowball', 25, 64.5, 0, { shooter: g5 });
    EL.list.push(sb6);
    Cb.tickSnowball(sb6);
    okAv(sb6.removed !== true, 'anti-vacuity: a snowball far from the player survives');
    delete M.Player;
  }

  // onGround discards with no target at all.
  const sb4 = EL.spawn('snowball', 0, 64, 0);
  sb4.onGround = true;
  Cb.tickSnowball(sb4);
  ok(sb4.removed === true, 'onGround discards the snowball (the stand-in for a landed/wall hit)');
}
console.log(`   ${pass} ok`);

// ════════════════════════════════ 5. Cb.hurtZero — the grace window really gates it ══════════
console.log('\n5. Cb.hurtZero — hurt-flash + 0.4 knockback, but respects the SAME invulnerability grace Cb.hurt uses');
{
  EL.list.length = 0;
  const t = EL.spawn('zombie', 0, 64, 0);
  const attacker = { x: -1, y: 64, z: 0 };
  ok(Cb.hurtZero(t, attacker) === true, 'first call fires (no grace running yet)');
  const vxAfterFirst = t.vx;
  okAv(vxAfterFirst > 0, `anti-vacuity: knocked AWAY from the attacker at -X, so vx must be positive — got ${vxAfterFirst}`);
  const fired2 = Cb.hurtZero(t, attacker);
  okAv(fired2 === false, 'anti-vacuity: a SECOND call inside the 20-tick grace does nothing (returns false) — proves the gate is real, not a no-op stub');
  ok(t.vx === vxAfterFirst, 'and the second (refused) call left velocity untouched');
}
console.log(`   ${pass} ok`);

// ════════════════════════════════ 6. targeting — Monster only, piglin the named exception ════
console.log('\n6. SG.hostileTargets / SG.isMonster — Monster-only, the piglin fix-up named in this file\'s own header');
{
  EL.list.length = 0;
  const g = EL.spawn('snow_golem', 0, 64, 0);
  const zombie = EL.spawn('zombie', 1, 64, 0);
  const cow = EL.spawn('cow', 2, 64, 0);
  // `piglin` has no measured motion row either (EL.canSpawn('piglin') is false) -- a plain
  // object stand-in, the same shape the blaze test two sections up already uses.
  const piglin = { type: 'piglin', x: 3, y: 64, z: 0, health: 16, maxHealth: 16 };
  const bat = EL.spawn('bat', 4, 64, 0);
  EL.list.push(g, zombie, cow, piglin, bat);
  const targets = SG.hostileTargets(g);
  ok(targets.includes(zombie), 'a real HostileEntity (zombie) is a valid target');
  ok(targets.includes(piglin), 'piglin IS included — Spawn.PEACEFUL_DISALLOWED alone would wrongly exclude it (this file\'s own fix-up)');
  okAv(!targets.includes(cow), 'anti-vacuity: a cow (not a Monster at all) is correctly excluded');
  okAv(!targets.includes(bat), 'anti-vacuity: a bat (not a Monster) is correctly excluded');
  okAv(!targets.includes(g), 'anti-vacuity: the golem itself is excluded (self is passed and skipped)');
}
console.log(`   ${pass} ok`);

// ════════════════════════════════ 7. mobTick — heat, water/rain, snow trail ═══════════════════
console.log('\n7. SG.mobTick — hot-biome fire damage, hurtByWater DROWN, and the snow-layer trail');
{
  const dirt = SR.stateOf('dirt');
  ok(dirt > 0, 'a real solid full-cube state (dirt) exists in the registry');

  // heat: strictly > 1.0, the boundary is real.
  EL.list.length = 0;
  const g = EL.spawn('snow_golem', 0, 64, 0);
  BIOME_TEMP = 1.0;
  let hp0 = g.health;
  SG.applyHeatDamage(g);
  ok(g.health === hp0, `temperature EXACTLY 1.0 is NOT hot (Biome.isHot is strictly '>') — got ${g.health} from ${hp0}`);
  BIOME_TEMP = 1.5;
  hp0 = g.health;
  SG.applyHeatDamage(g);
  ok(g.health === hp0 - 1, `temperature 1.5 (>1.0) burns for 1 — got ${g.health} from ${hp0}`);
  BIOME_TEMP = 0.5;

  // water/rain: either one triggers the SAME 1-damage DROWN.
  const g2 = EL.spawn('snow_golem', 0, 64, 0);
  g2.inWater = true;
  let hp1 = g2.health;
  SG.applyWaterDamage(g2);
  ok(g2.health === hp1 - 1, `standing in water takes 1 (hurtByWater) — got ${g2.health} from ${hp1}`);
  const g3 = EL.spawn('snow_golem', 0, 64, 0);
  RAINING = true;
  hp1 = g3.health;
  SG.applyWaterDamage(g3);
  ok(g3.health === hp1 - 1, `standing in rain ALSO takes 1 — got ${g3.health} from ${hp1}`);
  RAINING = false;
  const g4 = EL.spawn('snow_golem', 0, 64, 0);
  hp1 = g4.health;
  SG.applyWaterDamage(g4);
  okAv(g4.health === hp1, 'anti-vacuity: dry and not raining takes 0 — hurtByWater is not unconditional');

  // bubble column (above air, not inWater) is isWet too
  const gB = EL.spawn('snow_golem', 0, 64, 0);
  CELLS.set(key(0, 64, 0), SR.withLocal('bubble_column', 0));
  hp1 = gB.health;
  SG.applyWaterDamage(gB);
  ok(gB.health === hp1 - 1, `standing in a bubble column takes 1 (isWet) — got ${gB.health} from ${hp1}`);
  CELLS.delete(key(0, 64, 0));

  // snow trail: doMobGriefing gates it, and it needs air + a real full-cube support block.
  CELLS.clear();
  const g5 = { x: 10.5, y: 64, z: 10.5, dead: false };
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    CELLS.set(key(Math.floor(10.5 + dx * 0.25), 63, Math.floor(10.5 + dz * 0.25)), dirt);
  }
  SG.tickSnowTrail(g5, { mobGriefing: () => false });
  let placed = 0;
  for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
    if (CELLS.get(key(Math.floor(10.5 + dx), 64, Math.floor(10.5 + dz))) > 0) placed++;
  }
  okAv(placed === 0, 'anti-vacuity: !mobGriefing places NO snow at all');
  SG.tickSnowTrail(g5, { mobGriefing: () => true });
  placed = 0;
  for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
    if (CELLS.get(key(Math.floor(10.5 + dx), 64, Math.floor(10.5 + dz))) === SG.snowLayerState()) placed++;
  }
  ok(placed === 4, `mobGriefing=true over four supported air cells places all 4 snow layers — got ${placed}`);

  // anti-vacuity: an already-occupied cell is skipped, not overwritten.
  CELLS.clear();
  const g6 = { x: 20.5, y: 64, z: 20.5, dead: false };
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    CELLS.set(key(Math.floor(20.5 + dx * 0.25), 63, Math.floor(20.5 + dz * 0.25)), dirt);
  }
  CELLS.set(key(Math.floor(20.5 - 0.25), 64, Math.floor(20.5 - 0.25)), dirt);  // occupied, not air
  SG.tickSnowTrail(g6, { mobGriefing: () => true });
  okAv(CELLS.get(key(Math.floor(20.5 - 0.25), 64, Math.floor(20.5 - 0.25))) === dirt,
    'anti-vacuity: an occupied (non-air) cell keeps its own block, not overwritten with snow');
}
console.log(`   ${pass} ok`);

// ════════════════════════════════ 8. shear — carved_pumpkin, once, then refused ═══════════════
console.log('\n8. SG.canShear / SG.shear — carved_pumpkin, and only while hasPumpkin');
{
  const g = EL.spawn('snow_golem', 0, 64, 0);
  ok(SG.canShear(g) === true, 'a fresh golem (hasPumpkin default true) is shearable');
  const drop = SG.shear(g);
  ok(!!drop && drop.item === 'carved_pumpkin' && drop.count === 1, `shear drops exactly 1 carved_pumpkin — got ${JSON.stringify(drop)}`);
  ok(g.hasPumpkin === false, 'hasPumpkin is now false');
  okAv(SG.shear(g) === null, 'anti-vacuity: shearing an already-sheared golem drops nothing');
  // a plain object, not EL.spawn('sheep', ...) -- spawning a REAL sheep builds its full goal
  // roster (Ai.selectorFor), which needs NS.Passive (not in this check's own module list,
  // out of scope for a snow-golem check) -- SG.canShear only reads e.type/e.dead/e.hasPumpkin,
  // so a bare stand-in object is the real, sufficient input for THIS assertion.
  const sheep = { type: 'sheep', dead: false };
  okAv(SG.canShear(sheep) === false, 'anti-vacuity: SG.canShear refuses a non-golem entity outright');
}
{
  // shearAt: drop at y+1.7 and the shear sound (SnowGolemEntity.sheared)
  const calls = [], sounds = [];
  const od = EL.dropStack, os = M.Sound;
  EL.dropStack = (x, y, z, it, n) => calls.push({ x, y, z, it, n });
  M.Sound = { play: (n) => sounds.push(n) };
  const g = EL.spawn('snow_golem', 0, 64, 0);
  SG.shearAt(g);
  ok(calls.length === 1 && Math.abs(calls[0].y - (g.y + 1.7)) < 1e-9, `shearAt drops at y+1.7 — got ${JSON.stringify(calls)}`);
  ok(sounds.length === 1 && sounds[0] === 'entity.snow_golem.shear', `shearAt plays entity.snow_golem.shear — got ${sounds}`);
  calls.length = 0; sounds.length = 0;
  okAv(SG.shearAt(g) === null && !calls.length && !sounds.length, 'anti-vacuity: a second shearAt drops and plays nothing');
  EL.dropStack = od; M.Sound = os;
}
console.log(`   ${pass} ok`);

// ════════════════════════════════ 9. construction — the pumpkin-on-two-snow-blocks pattern ════
console.log('\n9. SG.searchGolemPattern / SG.tryConstruct — the CarvedPumpkinBlock pattern, and its refusal');
{
  const isHead = (b) => b === 'carved_pumpkin' || b === 'jack_o_lantern';
  const blocks = new Map();
  const bkey = (x, y, z) => x + ',' + y + ',' + z;
  const getBlock = (x, y, z) => blocks.get(bkey(x, y, z)) || 'air';
  const setBlock = (x, y, z, v) => blocks.set(bkey(x, y, z), v);
  blocks.set(bkey(0, 10, 0), 'snow_block');
  blocks.set(bkey(0, 11, 0), 'snow_block');
  blocks.set(bkey(0, 12, 0), 'carved_pumpkin');

  const match = SG.searchGolemPattern(getBlock, isHead, 0, 12, 0);
  ok(!!match && match.headY === 12, `the pattern matches with the head at y=12 — got ${JSON.stringify(match)}`);

  const spawned = [];
  const world = { getBlock, setBlock, isGolemHead: isHead, spawn: (t, x, y, z) => { spawned.push({ t, x, y, z }); return { type: t, x, y, z }; } };
  const golem = SG.tryConstruct(world, 0, 12, 0);
  ok(!!golem && golem.type === 'snow_golem', 'tryConstruct spawns a real snow_golem');
  ok(spawned.length === 1 && spawned[0].x === 0.5 && spawned[0].z === 0.5, `spawned centred at +0.5/+0.5 — got ${JSON.stringify(spawned[0])}`);
  ok(getBlock(0, 10, 0) === 'air' && getBlock(0, 11, 0) === 'air' && getBlock(0, 12, 0) === 'air',
    'all THREE blocks (both snow blocks and the pumpkin) are consumed to air');

  // anti-vacuity: jack_o_lantern also counts as a head (IS_GOLEM_HEAD_PREDICATE covers both).
  const blocks2 = new Map();
  const getBlock2 = (x, y, z) => blocks2.get(bkey(x, y, z)) || 'air';
  const setBlock2 = (x, y, z, v) => blocks2.set(bkey(x, y, z), v);
  blocks2.set(bkey(0, 10, 0), 'snow_block'); blocks2.set(bkey(0, 11, 0), 'snow_block');
  blocks2.set(bkey(0, 12, 0), 'jack_o_lantern');
  const world2 = { getBlock: getBlock2, setBlock: setBlock2, isGolemHead: isHead, spawn: (t, x, y, z) => ({ type: t, x, y, z }) };
  ok(!!SG.tryConstruct(world2, 0, 12, 0), 'jack_o_lantern on the same two snow blocks ALSO constructs a golem');

  // anti-vacuity: missing the SECOND snow block refuses the whole thing.
  const blocks3 = new Map();
  const getBlock3 = (x, y, z) => blocks3.get(bkey(x, y, z)) || 'air';
  blocks3.set(bkey(0, 11, 0), 'snow_block');   // only ONE snow block, not two
  blocks3.set(bkey(0, 12, 0), 'carved_pumpkin');
  okAv(SG.searchGolemPattern(getBlock3, isHead, 0, 12, 0) === null,
    'anti-vacuity: only one snow block under the pumpkin — no match, no construction');
  okAv(SG.tryConstruct({ getBlock: getBlock3, setBlock: () => {}, isGolemHead: isHead, spawn: () => ({}) }, 0, 12, 0) === null,
    'anti-vacuity: tryConstruct itself refuses too (does not fall through to spawning anyway)');
}
console.log(`   ${pass} ok`);

// ════════════════════════════════ 10. the goal roster — real end-to-end integration ═══════════
console.log('\n10. Ai.ROSTER.snow_golem — targets a real Monster and actually throws a snowball');
{
  EL.list.length = 0;
  const g = EL.spawn('snow_golem', 0, 64, 0);
  const zombie = EL.spawn('zombie', 5, 64, 0);
  EL.list.push(g, zombie);
  g.random = Object.create(g.random); g.random.nextInt = () => 0;   // #7410: the reciprocal roll reads e.random.nextInt, not ctx.random
  let shots = 0, lastTarget = null;
  const ctx = {
    players: () => [], random: () => 0,
    onSnowballThrow: (mob, target) => { shots++; lastTarget = target; return null; }
  };
  const gs = Ai.ROSTER.snow_golem(g, ctx);
  for (let i = 0; i < 25; i++) gs.tick();
  ok(g.target === zombie, 'the TARGET goal (Ai.NearestAttackableTargetGoal over SG.hostileTargets) picked the real zombie');
  ok(shots >= 1, `ctx.onSnowballThrow actually fired within 25 ticks (min interval 20) — got ${shots} shots`);
  ok(lastTarget === zombie, 'the shot was aimed at the real target');

  // anti-vacuity: with no monster anywhere nearby, the golem never fires.
  EL.list.length = 0;
  const g2 = EL.spawn('snow_golem', 0, 64, 0);
  const cow = EL.spawn('cow', 5, 64, 0);
  EL.list.push(g2, cow);
  let shots2 = 0;
  const ctx2 = { players: () => [], random: () => 0.5, onSnowballThrow: () => { shots2++; return null; } };
  const gs2 = Ai.ROSTER.snow_golem(g2, ctx2);
  for (let i = 0; i < 25; i++) gs2.tick();
  okAv(!g2.target && shots2 === 0,
    'anti-vacuity: a cow is not a Monster — no target is ever picked and the golem never throws');
}
// 10b: reciprocalChance 10 = a 1-in-10 start roll (fixed RNG), mustSee wired
{
  const mk = (rs) => {
    EL.list.length = 0;
    const g = EL.spawn('snow_golem', 0, 64, 0), z = EL.spawn('zombie', 5, 64, 0);
    EL.list.push(g, z);
    let i = 0;
    g.random = Object.create(g.random); g.random.nextInt = (n) => Math.floor(rs[Math.min(i++, rs.length - 1)] * n);   // #7410
    const gs = Ai.ROSTER.snow_golem(g, { players: () => [], random: () => rs[Math.min(i++, rs.length - 1)], onSnowballThrow: () => null });
    return { g, z, gs };
  };
  let r = mk([0.5]); for (let i = 0; i < 10; i++) r.gs.tick();
  ok(!r.g.target, 'roll never < 1/10: golem never acquires');
  r = mk([0.05]); r.gs.tick(); r.gs.tick();
  ok(r.g.target === r.z, 'roll < 1/10: golem acquires on the roll tick');
  const tg = new Ai.NearestAttackableTargetGoal(r.g, () => [r.z], { sight: true, mustSee: true, reciprocalChance: 0, rand: () => 0.5 });
  okAv(tg.canUse() === true && tg.mustSee === true, 'anti-vacuity: reciprocalChance 0 starts on a 0.5 roll that the real golem refuses');
}
console.log(`   ${pass} ok`);

// ════════════════════════════════ 11. NBT round-trip field list ═══════════════════════════════
console.log('\n11. MobNbt.fieldsFor(snow_golem) — hasPumpkin is a persisted field');
{
  const fields = M.MobNbt.fieldsFor('snow_golem');
  ok(fields.includes('hasPumpkin'), `snow_golem's own field list includes hasPumpkin — got ${JSON.stringify(fields)}`);
  okAv(!M.MobNbt.fieldsFor('cow').includes('hasPumpkin'),
    'anti-vacuity: an unrelated species (cow) does NOT carry hasPumpkin in its own field list');
}
console.log(`   ${pass} ok`);

// ═══════ s115: SnowBlock.canPlaceAt + the LIVE construction path (SG.onBlockAdded) ═══════
console.log('\ns115. SG.snowCanPlaceAt (SnowBlock.java:81-90) and SG.onBlockAdded (CarvedPumpkinBlock.onBlockAdded)');
{
  const st = (n) => SR.stateOf(n);
  CELLS.clear();
  CELLS.set(key(0, 63, 0), st('stone'));
  ok(SG.snowCanPlaceAt(0, 64, 0), 'snow may sit on stone (full up face)');
  CELLS.set(key(0, 63, 0), st('ice'));
  okAv(!SG.snowCanPlaceAt(0, 64, 0), 'snow may NOT sit on ice (the jar\'s explicit refusal, though ice is a full cube)');
  CELLS.set(key(0, 63, 0), st('packed_ice'));
  ok(!SG.snowCanPlaceAt(0, 64, 0), 'nor on packed_ice');
  CELLS.set(key(0, 63, 0), st('soul_sand'));
  ok(SG.snowCanPlaceAt(0, 64, 0), 'but it may on soul_sand (explicit allow, not a full face)');
  CELLS.set(key(0, 63, 0), SR.withLocal('oak_slab', 1));
  okAv(SG.snowCanPlaceAt(0, 64, 0), 'snow may sit on a TOP slab (full UP face, not a full cube)');
  CELLS.set(key(0, 63, 0), SR.withLocal('oak_slab', 3));
  okAv(!SG.snowCanPlaceAt(0, 64, 0), 'but not on a bottom slab (no full UP face)');
  CELLS.delete(key(0, 63, 0));
  ok(!SG.snowCanPlaceAt(0, 64, 0), 'nothing below -> no snow');

  EL.clear(); CELLS.clear();
  CELLS.set(key(5, 64, 5), st('snow_block'));
  CELLS.set(key(5, 65, 5), st('snow_block'));
  CELLS.set(key(5, 66, 5), st('carved_pumpkin'));
  const g = SG.onBlockAdded(5, 66, 5);
  ok(!!g && g.type === 'snow_golem', `placing a carved_pumpkin on two snow blocks builds a snow golem — got ${g && g.type}`);
  ok(!CELLS.get(key(5, 64, 5)) && !CELLS.get(key(5, 65, 5)) && !CELLS.get(key(5, 66, 5)), 'all three pattern blocks are consumed');
  ok(!!g && Math.abs(g.y - 64.05) < 1e-9 && g.x === 5.5 && g.z === 5.5, `golem stands at the bottom cell +0.5/+0.05/+0.5 — got ${g && [g.x, g.y, g.z]}`);
  ok(EL.all().some((e) => e.type === 'snow_golem'), 'the golem is a live EL entity');
  // break: the same column topped by a plain pumpkin (not a golem head) builds nothing.
  EL.clear(); CELLS.clear();
  CELLS.set(key(5, 64, 5), st('snow_block'));
  CELLS.set(key(5, 65, 5), st('snow_block'));
  CELLS.set(key(5, 66, 5), st('pumpkin'));
  okAv(SG.onBlockAdded(5, 66, 5) === null && !!CELLS.get(key(5, 64, 5)), 'an uncarved pumpkin is not a golem head — nothing built, nothing consumed');
  const psrc = readFileSync(join(MCLITE_ROOT, 'src', '14_player.js'), 'utf8');
  ok(psrc.indexOf('NS.SnowGolem.onBlockAdded(bx, by, bz)') >= 0, 'P.placeBlock calls SG.onBlockAdded (the live caller)');
}
console.log(`   ${pass} ok`);

// ═══════════ 6b. the Monster set is the extracted .decomp walk, exactly ═══════════
console.log('\n6b. SG.monsterTypes == tools/golden/monster-types-1.18.2.tsv (extract-monsters.mjs)');
{
  const want = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'monster-types-1.18.2.tsv'), 'utf8')
    .split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')[0]);
  const got = Object.keys(SG.monsterTypes());
  ok(got.length === want.length && want.every((n) => SG.monsterTypes()[n] === 1), 'table equals the extracted set exactly (' + want.length + ')');
  for (const n of ['hoglin', 'zoglin', 'phantom', 'ghast', 'slime', 'shulker', 'piglin', 'piglin_brute']) ok(SG.monsterTypes()[n] === 1, n + ' is targeted');
  okAv(!SG.monsterTypes().cow && !SG.monsterTypes().bat, 'cow and bat are not Monsters');
  // anti-vacuity: drop one entry from the table and the equality must fail
  const saved = SG.MONSTER_TYPES; const cut = Object.assign({}, saved); delete cut.hoglin; SG.MONSTER_TYPES = cut;
  okAv(!(Object.keys(SG.monsterTypes()).length === want.length), 'dropping hoglin from the table breaks the equality');
  SG.MONSTER_TYPES = saved;
}
console.log(`   ${pass} ok`);

// ═══════════════════════════════ done ═════════════════════════════════════════════════════
console.log(`\n${fails.length ? 'FAIL' : 'PASS'}  ${pass} ok, ${fails.length} failed, ${breaks} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
