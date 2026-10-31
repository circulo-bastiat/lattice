#!/usr/bin/env node
// runchase.mjs — infra I6 (25 Sept 2026): golden for chaserefcheck.mjs — MOB CHASE SPEED on the real 1.18.2 server.
// Scenarios: chasescen.mjs. One lane per mob (stone corridor), one growbot survival player per lane standing still
// (resistance 255, so nothing dies), the mob summoned START blocks from it (AI on, persistent, NBT form -> no gear).
// A datapack TICK function appends the mob's Pos to storage every tick (tick-exact: the function runs before the
// worlds tick, so entry i = the position after i world ticks, entry 0 = the summon position). Own port 25671.
//   node tools/referee/runchase.mjs        (~REPS x 10 s of game time + ~40 s of setup)
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee, resolveBusyPort } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { LIVE as CHASE_LANES, LOCKSTEP_ONLY, STEP_LANES, LEDGE_X, START, T as CHASE_T, PITCH, REPS, DIST, startX, playerX } from './chasescen.mjs';
// LANE:golemwander #9260
import { REPS as REPS0 } from './chasescen.mjs';
// END LANE

// MCLITE_CHASE_ONLY=zombie,... keeps just those lanes; MCLITE_CHASE_OUT redirects the golden (lockstep spike, #4986)
const ALL_LANES = process.env.MCLITE_CHASE_ONLY ? [...CHASE_LANES, ...LOCKSTEP_ONLY, ...STEP_LANES] : CHASE_LANES;
const LIVE = process.env.MCLITE_CHASE_ONLY ? ALL_LANES.filter((s) => process.env.MCLITE_CHASE_ONLY.split(',').includes(s.id)) : ALL_LANES;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;                 // the flat world's grass top is y -61: the lane's stone floor replaces it
const PATHLOG = process.env.MCLITE_LOCKSTEP_PATHLOG || '';   // #6952
const botName = (k) => 'chase' + k;

export function parsePosList(reply) {
  const nums = (reply.match(/-?\d+(?:\.\d+)?(?:E-?\d+)?d/g) || []).map((q) => parseFloat(q));
  const out = [];
  for (let i = 0; i + 2 < nums.length; i += 3) out.push([nums[i], nums[i + 1], nums[i + 2]]);
  return out;
}

// #9198 (MOBPROOF-STEP-1): the step course along the lane, floor top FLOOR: a full-block ledge (x 14), a bottom slab (x 16-17, +0.5), a bottom
// east-facing stair (x 20), then a floor one block higher still (x >= 21, where the player stands); side walls raised to match.
export const STEP = { ledgeX: 14, slabX: [16, 17], stairX: 20, topX: 21 };
export function stepCourse(z) {
  const e = DIST + 3, S = STEP, y = FLOOR;
  return [`fill ${S.ledgeX} ${y} ${z - 1} ${e} ${y} ${z + 1} minecraft:stone`,
    `fill ${S.slabX[0]} ${y + 1} ${z - 1} ${S.slabX[1]} ${y + 1} ${z + 1} minecraft:oak_slab[type=bottom]`,
    `fill ${S.stairX} ${y + 1} ${z - 1} ${S.stairX} ${y + 1} ${z + 1} minecraft:oak_stairs[facing=east,half=bottom]`,
    `fill ${S.topX} ${y + 1} ${z - 1} ${e} ${y + 1} ${z + 1} minecraft:stone`,
    `fill ${S.ledgeX} ${y + 2} ${z - 2} ${e} ${y + 3} ${z - 2} minecraft:stone`, `fill ${S.ledgeX} ${y + 2} ${z + 2} ${e} ${y + 3} ${z + 2} minecraft:stone`];
}
// #9200 (MOBPROOF-STEP-3): the other step scenarios, lane key course: 'carpet' (a carpet strip, 1/16 high, at x 14-17 then a full block at x 18+),
// 'edge' (the floor ends at x 14 in a water pool x 14-17, floor again from x 18: the mob wades the water edge), 'ladder' (a 2-high stone tower
// x >= 14 with an ladder on its west face at x 13, so the way up is the ladder).
export function courseFills(z, kind) {
  const e = DIST + 3, y = FLOOR, wall = (x0, x1, h) => [`fill ${x0} ${y + 2} ${z - 2} ${x1} ${y + h} ${z - 2} minecraft:stone`, `fill ${x0} ${y + 2} ${z + 2} ${x1} ${y + h} ${z + 2} minecraft:stone`];
  if (kind === 'carpet') return [`fill 14 ${y + 1} ${z - 1} 17 ${y + 1} ${z + 1} minecraft:white_carpet`, `fill 18 ${y} ${z - 1} ${e} ${y} ${z + 1} minecraft:stone`, `fill 18 ${y + 1} ${z - 1} ${e} ${y + 1} ${z + 1} minecraft:white_carpet`];
  if (kind === 'edge') return [`fill 14 ${y - 1} ${z - 1} 17 ${y} ${z + 1} minecraft:water`, `fill 18 ${y - 1} ${z - 1} ${e} ${y - 1} ${z + 1} minecraft:stone`];
  if (kind === 'ladder') return [`fill 14 ${y} ${z - 1} ${e} ${y + 1} ${z + 1} minecraft:stone`, `fill 13 ${y} ${z} 13 ${y + 1} ${z} minecraft:ladder[facing=west]`, ...wall(13, e, 3)];
  throw new Error('unknown step course ' + kind);
}
async function main() {
  // LANE:waterentities #9264: a lane may need more than T ticks (zombie -> drowned takes ~900): `ticks` lengthens the run (shadows the imported T)
  // LANE:golemwander #9260: a lane's own rep count (1 rep); shadows the imported REPS
  const T = Math.max(CHASE_T, ...LIVE.map((s) => s.ticks || 0)), REPS = LIVE.some((s) => s.reps) ? 1 : REPS0;
  // END LANE
  // a busy port moves the server to <workDir>-p<port> (#6426): resolve it first so the datapack is written where the server runs
  const want = await resolveBusyPort({ port: +process.env.MCLITE_CHASE_PORT || 25671, rconPort: +process.env.MCLITE_CHASE_RCON || 26671, workDir: process.env.MCLITE_CHASE_WORKDIR || join(homedir(), '.mclite-referee-chase') });
  const workDir = want.workDir;
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitechase');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitechase', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee chase' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclitechase:tick'] }));
  const Z = (k) => k * PITCH;
  const arena = [], spawn = [], log = [], itemFns = [], projFns = [];
  LIVE.forEach((s, k) => {
    const z = Z(k);
    if (s.open) arena.push(`fill -4 ${FLOOR - 1} ${z - 3} ${DIST + 4} ${FLOOR + 20} ${z + 3} minecraft:air`, `fill -4 ${FLOOR - 1} ${z - 3} ${DIST + 4} ${FLOOR - 1} ${z + 3} minecraft:stone`);   // #5362: ghast lane, open air over a floor
    else arena.push(`fill -4 ${FLOOR - 1} ${z - 3} ${DIST + 4} ${FLOOR + 3} ${z + 3} minecraft:air`,
      `fill -4 ${FLOOR - 1} ${z - 1} ${DIST + 4} ${FLOOR - 1} ${z + 1} minecraft:stone`,
      `fill -4 ${FLOOR} ${z - 2} ${DIST + 4} ${FLOOR + 1} ${z - 2} minecraft:stone`,
      `fill -4 ${FLOOR} ${z + 2} ${DIST + 4} ${FLOOR + 1} ${z + 2} minecraft:stone`,
      `fill -4 ${FLOOR} ${z - 1} -4 ${FLOOR + 1} ${z + 1} minecraft:stone`,
      `fill ${DIST + 4} ${FLOOR} ${z - 1} ${DIST + 4} ${FLOOR + 1} ${z + 1} minecraft:stone`);
    if (s.ledge) arena.push(`fill -4 ${FLOOR} ${z - 1} ${LEDGE_X - 1} ${FLOOR + s.ledge - 1} ${z + 1} minecraft:stone`,   // #9199: the raised shelf the mob walks off
      `fill -4 ${FLOOR + 2} ${z - 2} ${LEDGE_X - 1} ${FLOOR + s.ledge + 1} ${z - 2} minecraft:stone`, `fill -4 ${FLOOR + 2} ${z + 2} ${LEDGE_X - 1} ${FLOOR + s.ledge + 1} ${z + 2} minecraft:stone`,
      `fill -4 ${FLOOR + s.ledge} ${z - 1} -4 ${FLOOR + s.ledge + 1} ${z + 1} minecraft:stone`);
    // LANE:golemwander #9260: the village arena (lockstep-golemwander.mjs): open stone floor x -30..90 z -30..30 (golem at 0.5,0.5), bell, 6 beds, 3 job sites at x 52
    if (s.village) {
      const y = FLOOR, V = 52;
      arena.push(`fill -30 ${y - 1} ${z - 30} 90 ${y - 1} ${z + 30} minecraft:stone`, `fill -30 ${y} ${z - 30} 90 ${y + 8} ${z + 30} minecraft:air`, `setblock ${V} ${y} ${z} minecraft:bell`);
      for (let i = 0; i < 6; i++) arena.push(`setblock ${V + i} ${y} ${z + 4} minecraft:red_bed`);
      ['composter', 'lectern', 'blast_furnace'].forEach((n, i) => arena.push(`setblock ${V + i * 2} ${y} ${z - 4} minecraft:${n}`));
    }
    // END LANE
    if (s.wall) arena.push(`fill ${START + 5} ${FLOOR} ${z - 1} ${START + 5} ${FLOOR} ${z} minecraft:stone`);
    if (s.step) arena.push(...stepCourse(z));   // #9198
    if (s.course) arena.push(...courseFills(z, s.course));   // #9200
    // LANE:boatfall #9443: lowpool -- water on the LOW floor only (x >= LEDGE_X), so a ledge lane's boat re-enters it after the drop
    if (s.lowpool) arena.push(`fill ${LEDGE_X} ${FLOOR} ${z - 1} ${DIST + 3} ${FLOOR + 1} ${z + 1} minecraft:water`);
    // END LANE
    // LANE:boatfloor #9442: `floor` swaps the corridor floor block (packed_ice / blue_ice): a boat's ground friction reads the block under it
    if (s.floor) arena.push(`fill -3 ${FLOOR - 1} ${z - 1} ${DIST + 3} ${FLOOR - 1} ${z + 1} minecraft:${s.floor}`);
    // END LANE
    // LANE:dolphinpath #8760: `layout` = a seeded swim layout (env MCLITE_CHASE_LAYOUT = n): the pool is 4 deep (FLOOR-2..FLOOR+1) and ~25% of the cells x 4..20 are stone (ocean floor / ruin / shore)
    if (s.layout) {
      arena.push(`fill -4 ${FLOOR - 3} ${z - 2} ${DIST + 4} ${FLOOR + 1} ${z + 2} minecraft:stone`, `fill -3 ${FLOOR - 2} ${z - 1} ${DIST + 3} ${FLOOR + 1} ${z + 1} minecraft:water`);   // stone shell first: the deeper pool must not leak below the corridor walls
      let r = (1 + (+process.env.MCLITE_CHASE_LAYOUT || 0)) * 2654435761 >>> 0;
      const rnd = () => (r = Math.imul(r ^ (r >>> 15), 2246822519) + 0x9e3779b9 >>> 0, (r >>> 8) / 16777216);
      for (let x = 4; x <= 20; x++) for (let dz = -1; dz <= 1; dz++) for (let y = FLOOR - 2; y <= FLOOR + 1; y++) if (rnd() < (y <= FLOOR - 1 ? 0.35 : 0.15)) arena.push(`setblock ${x} ${y} ${z + dz} minecraft:stone`);
    }
    // END LANE
    if (s.pool) arena.push(`fill -3 ${FLOOR} ${z - 1} ${DIST + 3} ${FLOOR + 1} ${z + 1} minecraft:water`);
    if (s.lava) arena.push(`fill -3 ${FLOOR} ${z - 1} ${DIST + 3} ${FLOOR + 1} ${z + 1} minecraft:lava`);   // #10363: lava contact damage (LAVA 4 + 15 s fire) on a NoAI mob
    // LANE:firedamage #9362: fire -- the subject's cell holds fire on netherrack (infiniburn: no random burn-out), penned in by stone
    if (s.fire) arena.push(`setblock ${startX() - 0.5} ${FLOOR - 1} ${z} minecraft:netherrack`, `setblock ${startX() - 0.5} ${FLOOR} ${z} minecraft:fire`,
      ...[[-1, 0], [1, 0], [0, -1], [0, 1]].flatMap(([dx, dz]) => [FLOOR, FLOOR + 1].map((y) => `setblock ${startX() - 0.5 + dx} ${y} ${z + dz} minecraft:stone`)), `setblock ${startX() - 0.5} ${FLOOR + 2} ${z} minecraft:stone`);   // a 1x1 stone pen: the AI mob keeps moving (a NoAI mob never runs checkInsideBlocks, so fire does nothing to it) but cannot leave the fire
    // LANE:cactusdamage #9248: `block` = {name, below, age?}: a 1x1 shaft at the mob's cell (stone ring FLOOR+1..FLOOR+3), the contact block on `below` at FLOOR; the mob is dropped in and cannot leave
    if (s.block) {
      const bx = START, b = s.block, f = FLOOR;
      arena.push(`fill ${bx - 1} ${f + 1} ${z - 1} ${bx + 1} ${f + 3} ${z + 1} minecraft:stone`, `fill ${bx} ${f + 1} ${z} ${bx} ${f + 3} ${z} minecraft:air`,
        `setblock ${bx} ${f - 1} ${z} minecraft:${b.below}`, `setblock ${bx} ${f} ${z} minecraft:${b.name}${b.state || ''}`);
    }
    // LANE:bushdamage #9248: `bush` = {dx, age}: a sweet_berry_bush (on dirt) in the corridor dx blocks past the mob's start; the AI mob walks through it toward the player
    if (s.bush) arena.push(`setblock ${START + s.bush.dx} ${FLOOR - 1} ${z} minecraft:dirt`, `setblock ${START + s.bush.dx} ${FLOOR} ${z} minecraft:sweet_berry_bush[age=${s.bush.age}]`);
    // END LANE
    if (s.motion) spawn.push(`data modify storage mclite:chase m${k} set value {vel:[],rot:[],air:[]}`);
    spawn.push(`data modify storage mclite:chase l${k} set value []`,
      `summon minecraft:${s.mob} ${s.sx || startX()} ${FLOOR + (s.up || s.ledge || 0)} ${z + 0.5} {PersistenceRequired:1b,Tags:["ch${k}","chase"]${s.nbt ? ',' + s.nbt : ''}}`);
    log.push(`data modify storage mclite:chase l${k} append from entity @e[tag=ch${k},limit=1] Pos`);
    if (s.tnt) spawn.push(`summon minecraft:tnt ${startX() + s.tnt.dx} ${FLOOR + (s.tnt.dy || 0)} ${z + 0.5 + (s.tnt.dz || 0)} {Fuse:${s.tnt.fuse}s}`);   // #9214: explosion-damage lane: primed TNT next to the subject
    if (s.magic) spawn.push(`effect give @e[tag=ch${k},limit=1] minecraft:instant_damage 1 0`);   // #9215: magic damage (6) on the subject
    if (s.effect) spawn.push(`effect give @e[tag=ch${k},limit=1] minecraft:${s.effect}`);   // #9249: poison/wither on the subject, e.g. "poison 10 2" (seconds, amplifier)
    if (s.hurt && (s.tnt || s.magic || s.mobhp || s.effect)) {   // #9247 mobhp: no tnt, the mob itself drowns. #9214: Health / HurtTime per tick -> cases[id].hurt[rep] = { hp:[], ht:[] }
      spawn.push(`data modify storage mclite:chase h${k} set value {hp:[],ht:[]}`);
      log.push(`data modify storage mclite:chase h${k}.hp append from entity @e[tag=ch${k},limit=1] Health`, `data modify storage mclite:chase h${k}.ht append from entity @e[tag=ch${k},limit=1] HurtTime`);
    }
    else if (s.hurt) {   // #9216: the player takes damage (no Resistance 255): Health + AbsorptionAmount per tick
      spawn.push(`data modify storage mclite:chase h${k} set value {hp:[],ab:[]}`);
      log.push(`data modify storage mclite:chase h${k}.hp append from entity ${botName(k)} Health`, `data modify storage mclite:chase h${k}.ab append from entity ${botName(k)} AbsorptionAmount`);
    }
    // LANE:starvedamage #10364: starve:<instant_damage amp or -1> -- at the arm the player gets Hunger 255 (exhaustion 1.28/tick drains saturation then food to 0 from the fresh-join 20/5/0) and, when amp >= 0, instant_damage of that amplifier (6 << amp HP)
    if (s.starve != null) { spawn.push(`effect give ${botName(k)} minecraft:hunger 1000000 255 true`); if (s.starve >= 0) spawn.push(`effect give ${botName(k)} minecraft:instant_damage 1 ${s.starve} true`); }
    // END LANE
    // LANE:arrowdamage #9213: hp:true logs the target's Health each tick; shoot:{type,x,motion,nbt} summons a projectile at the same arm
    // LANE:boatfall #9443: paxhp:true -- the Health logged is the passenger's (tag chpax), the subject (tag ch<k>) being a boat
    if (s.hp) { spawn.push(`data modify storage mclite:chase h${k} set value []`); log.push(`data modify storage mclite:chase h${k} append from entity @e[tag=${s.paxhp ? 'chpax' : 'ch' + k},limit=1] Health`); }
    // END LANE
    // LANE:arrowdamage #9213: (continued) the boatfall fence above closes the first block, so the shoot line is fenced again
    if (s.shoot) spawn.push(`summon minecraft:${s.shoot.type} ${s.shoot.x} ${FLOOR + 1.2} ${z + 0.5} {Motion:[${s.shoot.motion.join('d,')}d],pickup:0b${s.shoot.nbt ? ',' + s.shoot.nbt : ''}}`);
    // END LANE
    // LANE:waterentities #9264: conv:true -- the subject is a zombie that becomes a (tag-less) drowned: Pos follows whichever exists, kind[] = 0 zombie / 1 drowned per tick
    if (s.conv) {
      log.pop();
      log.push(`execute if entity @e[tag=ch${k}] run data modify storage mclite:chase l${k} append from entity @e[tag=ch${k},limit=1] Pos`,
        `execute unless entity @e[tag=ch${k}] run data modify storage mclite:chase l${k} append from entity @e[type=minecraft:drowned,limit=1] Pos`,
        `execute if entity @e[tag=ch${k}] run data modify storage mclite:chase v${k} append value 0`, `execute unless entity @e[tag=ch${k}] run data modify storage mclite:chase v${k} append value 1`);
      spawn.push(`data modify storage mclite:chase v${k} set value []`);
    }
    // END LANE
    // LANE:villagerkill #9263: vk:true -- a NoAI villager 4 blocks in front of the zombie (hard difficulty, player far); per tick v<k> gets the victim's kind: 0 none / 1 villager / 2 zombie_villager
    if (s.vk) {
      spawn.splice(Math.max(0, spawn.length - 1), 0, `summon minecraft:villager ${startX() + 4} ${FLOOR} ${z + 0.5} {NoAI:1b,PersistenceRequired:1b,Tags:["vkv${k}"]}`);
      spawn.push(`data modify storage mclite:chase v${k} set value []`);
      log.push(`execute if entity @e[type=minecraft:zombie_villager] run data modify storage mclite:chase v${k} append value 2`,
        `execute unless entity @e[type=minecraft:zombie_villager] if entity @e[tag=vkv${k}] run data modify storage mclite:chase v${k} append value 1`,
        `execute unless entity @e[type=minecraft:zombie_villager] unless entity @e[tag=vkv${k}] run data modify storage mclite:chase v${k} append value 0`);
    }
    // END LANE
    // LANE:goldenapple #9265: gold:true -- per tick {c: ConversionTime, e: ActiveEffects} of the subject (the agent feeds the golden apple: -Dmclite.lockstep.feed=<tick>)
    if (s.gold) {
      spawn.push(`data modify storage mclite:chase g${k} set value []`);
      log.push(`data modify storage mclite:chase g${k} append value {}`, `data modify storage mclite:chase g${k}[-1].c set from entity @e[tag=ch${k},limit=1] ConversionTime`,
        `data modify storage mclite:chase g${k}[-1].e set from entity @e[tag=ch${k},limit=1] ActiveEffects`);
    }
    // END LANE
    if (s.motion) log.push(`data modify storage mclite:chase m${k}.vel append from entity @e[tag=ch${k},limit=1] Motion`,
      `data modify storage mclite:chase m${k}.rot append from entity @e[tag=ch${k},limit=1] Rotation`,
      `data modify storage mclite:chase m${k}.air append from entity @e[tag=ch${k},limit=1] Air`);
    if (s.fire) {   // #5362: ghast -- Rotation per tick; each new fireball (Age-independent: tagged once seen) logs {tick, Pos, Motion}
      spawn.push(`data modify storage mclite:chase f${k} set value {rot:[],ftick:[],fpos:[],fmot:[]}`);
      log.push(`data modify storage mclite:chase f${k}.rot append from entity @e[tag=ch${k},limit=1] Rotation`,
        `execute store result storage mclite:chase tk int 1 run scoreboard players get #t mc`,
        `execute as @e[type=fireball,tag=!seen${k}] run function mclitechase:fire${k}`);
      itemFns.push(`data modify storage mclite:chase f${k}.ftick append from storage mclite:chase tk`,
        `data modify storage mclite:chase f${k}.fpos append from entity @s Pos`, `data modify storage mclite:chase f${k}.fmot append from entity @s Motion`, `tag @s add seen${k}`);
    }
    if (s.ent) {   // #6356: ENT walk -- chicken EggLayTime/Age per tick; each new item entity (Age:0s) logs {tick, Pos}
      spawn.push(`data modify storage mclite:chase e${k} set value {egg:[],age:[],itick:[],ipos:[]}`);
      log.push(`data modify storage mclite:chase e${k}.egg append from entity @e[tag=ch${k},limit=1] EggLayTime`,
        `data modify storage mclite:chase e${k}.age append from entity @e[tag=ch${k},limit=1] Age`,
        `execute store result storage mclite:chase tk int 1 run scoreboard players get #t mc`,
        `execute as @e[type=item,nbt={Age:0s},tag=!seen${k}] run function mclitechase:item${k}`);
      itemFns.push(`data modify storage mclite:chase e${k}.itick append from storage mclite:chase tk`,
        `data modify storage mclite:chase e${k}.ipos append from entity @s Pos`, `tag @s add seen${k}`);
    }
    if (s.rot) {   // #9236: blaze lane -- Rotation (yaw,pitch) per tick -> cases[id].rot[rep]
      spawn.push(`data modify storage mclite:chase r${k} set value {rot:[]}`);
      log.push(`data modify storage mclite:chase r${k}.rot append from entity @e[tag=ch${k},limit=1] Rotation`);
      // LANE:blaze #6964: the target's exact Pos per tick (pitch is ~1e5 x sensitive to it), in its own storage so the rot lines above stay byte-identical
      spawn.push(`data modify storage mclite:chase pp${k} set value {ppos:[]}`);
      log.push(`data modify storage mclite:chase pp${k}.ppos append from entity @p Pos`);
      // END LANE
    }
    if (s.proj) {   // #5361: PROJ walk -- each new fireball (tag-less, !seen) logs {tick, Pos, Motion}
      spawn.push(`data modify storage mclite:chase p${k} set value {tick:[],pos:[],mot:[]}`);
      log.push(`execute store result storage mclite:chase tk int 1 run scoreboard players get #t mc`,
        `execute as @e[type=minecraft:${s.projType || (s.proj === true ? 'small_fireball' : s.proj)},tag=!seen${k}] run function mclitechase:proj${k}`);
      projFns.push(`data modify storage mclite:chase p${k}.tick append from storage mclite:chase tk`,
        `data modify storage mclite:chase p${k}.pos append from entity @s Pos`, `data modify storage mclite:chase p${k}.mot append from entity @s Motion`, `tag @s add seen${k}`);
    }
  });
  spawn.push('scoreboard players set #t mc 0', 'scoreboard players set #run mc 1');
  // #6623: lockstep arms the spawn for a tick whose gametime % 20 == 0. MeleeAttackGoal/ActiveTarget cooldowns are gametime-phased
  // (lastUpdateTime), so a summon at a wall-clock-random phase moved the zombie's first step by a tick between two fresh runs.
  const tick = ['scoreboard players set #20 mc 20', 'execute store result score #g mc run time query gametime', 'scoreboard players operation #g mc %= #20 mc',
    'execute if score #arm mc matches 1 if score #g mc matches 0 run function mclitechase:spawn', 'execute if score #arm mc matches 1 if score #g mc matches 0 run scoreboard players set #arm mc 0',
    'execute if score #run mc matches 1 if score #t mc matches ..' + (T - 1) + ' run function mclitechase:log',
    'execute if score #run mc matches 1 run scoreboard players add #t mc 1'];
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');
  writeFileSync(join(fdir, 'spawn.mcfunction'), spawn.join('\n') + '\n');
  LIVE.forEach((s, k) => {
    if (s.fire) writeFileSync(join(fdir, `fire${k}.mcfunction`), itemFns.splice(0, 4).join('\n') + '\n');
    if (s.ent) writeFileSync(join(fdir, `item${k}.mcfunction`), itemFns.splice(0, 3).join('\n') + '\n');
  });
  LIVE.forEach((s, k) => { if (s.proj) writeFileSync(join(fdir, `proj${k}.mcfunction`), projFns.splice(0, 4).join('\n') + '\n'); });
  writeFileSync(join(fdir, 'log.mcfunction'), log.join('\n') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), tick.join('\n') + '\n');
  const server = await startServer({ workDir, port: want.port, rconPort: want.rconPort, xmx: '1536M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of LIVE) cases[s.id] = { mob: s.mob, nbt: s.nbt || '', creative: !!s.creative, logs: [] };
  let rcon; const bots = [];
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule randomTickSpeed 0', 'gamerule naturalRegeneration false',
      ...(LIVE.some((l) => l.hard || l.diff) ? [`difficulty ${LIVE.find((l) => l.diff)?.diff || 'hard'}`] : []),   // #6330: lane.diff names the difficulty   // LANE:villagerkill #9263: a zombie only converts a villager at hard
      'scoreboard objectives add mc dummy', 'scoreboard players set #run mc 0',
      ]) await C(c);
    // LANE:squid #9537: a squid's ink-sac drop (ItemEntity Random draws on the shared level.random) made salts 2,15,16,19 differ run to run
    if (LIVE.some((l) => l.id === 'squid')) await C('gamerule doMobLoot false');
    // END LANE
    // forceload refuses more than 256 chunks per command: add the lanes in slices of 20 (5 x ~31 chunks each)
    for (let k0 = 0; k0 < LIVE.length; k0 += 20) {
      const r = await C(`forceload add -16 ${Z(k0) - 16} 48 ${Z(Math.min(k0 + 20, LIVE.length)) + 16}`);
      if (/too many|No chunks|Unable/i.test(r)) throw new Error('forceload: ' + r);
    }
    // LANE:golemwander #9260
    for (let k = 0; k < LIVE.length; k++) if (LIVE[k].village) await C(`forceload add -48 ${Z(k) - 48} 112 ${Z(k) + 48}`);
    // END LANE
    const a = await C('function mclitechase:arena');
    if (/Unknown function/i.test(a)) throw new Error('datapack not loaded: ' + a);
    for (let k = 0; k < LIVE.length; k++) {
      bots.push(await connectFakePlayer({ port: server.port, name: botName(k) }));
      if (LIVE[k].hold) await C(`item replace entity ${botName(k)} weapon.mainhand with minecraft:${LIVE[k].hold}`);   // #9198: tempts the passive step mobs up the course
      await C(`gamemode ${LIVE[k].creative ? 'creative' : 'survival'} ${botName(k)}`);
      if (LIVE[k].hurt) for (const g of LIVE[k].gear || []) { const [slot, item] = g.split(' '); await C(`item replace entity ${botName(k)} armor.${slot} with minecraft:${item}`); }
      else await C(`effect give ${botName(k)} minecraft:resistance 1000000 255 true`);
      await C(`tp ${botName(k)} ${playerX()} ${FLOOR + (LIVE[k].step ? 2 : 0)} ${Z(k) + 0.5} 90 0`);
      // LANE:golemwander #9260: the engine keeps the player out of every range
      if (LIVE[k].far) await C(`tp ${botName(k)} -200 ${FLOOR} ${Z(k) + 0.5} 90 0`);
      // END LANE
    }
    await sleep(1000);
    for (let rep = 0; rep < REPS; rep++) {
      if (process.env.MCLITE_LOCKSTEP_RESET) writeFileSync(process.env.MCLITE_LOCKSTEP_RESET, 'rep' + rep);   // #6225: SeedAgent restarts its per-class counters
      if (PATHLOG) writeFileSync(PATHLOG, '');
      await C('scoreboard players set #run mc 0');
      await C('kill @e[type=!player]');
      for (let k = 0; k < LIVE.length; k++) {
        await C(`tp ${botName(k)} ${playerX()} ${FLOOR + (LIVE[k].step ? 2 : 0)} ${Z(k) + 0.5} 90 0`);
        // LANE:golemwander #9260
        if (LIVE[k].far) await C(`tp ${botName(k)} -200 ${FLOOR} ${Z(k) + 0.5} 90 0`);
        // END LANE
        if (LIVE[k].hurt) {   // #9216: full health, fresh effects each rep
          await C(`effect clear ${botName(k)}`); await C(`effect give ${botName(k)} minecraft:instant_health 1 10 true`);
          for (const e of LIVE[k].effects || []) { const [id, amp] = e.split(' '); await C(`effect give ${botName(k)} minecraft:${id} 1000000 ${amp} true`); }
        }
      }
      await sleep(process.env.MCLITE_LOCKSTEP_RESET ? 4000 : 300);   // lockstep: let the post-kill/tp entity + Brain construction burst finish before the arm (tropical_fish salts 15/18 raced it)
      if (process.env.MCLITE_LOCKSTEP_RESET) { writeFileSync(process.env.MCLITE_LOCKSTEP_RESET, 'rep' + rep + 'arm'); await sleep(200); await C('scoreboard players set #arm mc 1'); await sleep(1500); } else await C('function mclitechase:spawn');
      await sleep(T * 50 + 1000);
      let tNow = 0;
      for (let i = 0, slow = 0; i < 40; i++) {           // bounded: our own server catching up (D-436 allows this)
        try { tNow = +(/has (-?\d+)/.exec(await C('scoreboard players get #t mc')) || [0, 0])[1]; }
        catch (e) { if (!/timed out/.test(e.message) || ++slow > 2) throw e; continue; }   // #7179: a loaded host stalls one reply; the second stall in a row is a dead server
        if (tNow >= T) break; await sleep(500);
      }
      await C('scoreboard players set #run mc 0');
      if (tNow < T) notes.push(`rep ${rep}: only ${tNow}/${T} ticks ran`);
      for (let k = 0; k < LIVE.length; k++) {
        const L = parsePosList(await C(`data get storage mclite:chase l${k}`));
        const z0 = Z(k);
        let HP = null;
        if (LIVE[k].hurt) { const hv = await C(`data get storage mclite:chase h${k}`), fl = (key) => ((new RegExp(key + ': \\[([^\\]]*)\\]').exec(hv) || [0, ''])[1].match(/-?\d+(?:\.\d+)?(?:E-?\d+)?/g) || []).map(parseFloat); HP = [fl('hp'), fl('ab')]; }
        (cases[LIVE[k].id].raw = cases[LIVE[k].id].raw || []).push(L.map(([x, y, z]) => [x, y - FLOOR, z - z0]));   // #6964: unrounded Pos (the lockstep blaze lane compares pitch, which is ~1e5 x more sensitive to y than the 1e-4 logs)
        cases[LIVE[k].id].logs.push(L.map(([x, y, z], i) => [Math.round(x * 1e4) / 1e4, Math.round((y - FLOOR) * 1e4) / 1e4, Math.round((z - z0) * 1e4) / 1e4, ...(HP ? [HP[0][i], HP[1][i]] : [])]));
        // LANE:arrowdamage
        if (LIVE[k].hp) (cases[LIVE[k].id].hp = cases[LIVE[k].id].hp || []).push(((await C(`data get storage mclite:chase h${k}`)).match(/-?\d+(?:\.\d+)?(?=f)/g) || []).map(Number));
        // END LANE
        if (LIVE[k].ledge) {   // #9199: the fall damage is the point: the mob's final Health rides as a last pseudo-row [-1, health, 0] of the hashed log
          const hp = /(-?[\d.]+)f/.exec(await C(`data get entity @e[tag=ch${k},limit=1] Health`));
          cases[LIVE[k].id].logs[cases[LIVE[k].id].logs.length - 1].push([-1, hp ? +hp[1] : -1, 0]);
        }
        // LANE:goldenapple
        if (LIVE[k].gold) (cases[LIVE[k].id].gold = cases[LIVE[k].id].gold || []).push((await C(`data get storage mclite:chase g${k}`)).split(/(?=\{c: )/).filter((x) => x.startsWith('{c: ')).map((x) => [+(/^\{c: (-?\d+)/.exec(x)[1]), [...x.matchAll(/\{[^{}]*\}/g)].map((m) => ['Id', 'Amplifier', 'Duration'].map((f) => +(new RegExp(f + ': (-?\\d+)').exec(m[0]) || [0, -1])[1])).sort((p, q) => p[0] - q[0])]));
        // END LANE
        // LANE:villagerkill
        if (LIVE[k].vk) (cases[LIVE[k].id].vk = cases[LIVE[k].id].vk || []).push(((await C(`data get storage mclite:chase v${k}`)).match(/\b[012](?=[,\]])/g) || []).map(Number));
        // END LANE
        // LANE:waterentities
        if (LIVE[k].conv) (cases[LIVE[k].id].conv = cases[LIVE[k].id].conv || []).push(((await C(`data get storage mclite:chase v${k}`)).match(/\b[01](?=[,\]])/g) || []).map(Number));
        // END LANE
        if (LIVE[k].motion) {
          const mv = await C(`data get storage mclite:chase m${k}`), grp = (key) => ((new RegExp(key + ': \\[(.*?)\\](?=, [a-z]+:|\\}|$)', 's').exec(mv) || [0, ''])[1]);
          const nums = (t) => (t.match(/-?\d+(?:\.\d+)?(?:[eE]-?\d+)?[dDfFsS]?/g) || []).map(parseFloat);
          (cases[LIVE[k].id].extra = cases[LIVE[k].id].extra || []).push({ vel: nums(grp('vel')), rot: nums(grp('rot')), air: nums(grp('air')) });
        }
        if (LIVE[k].hurt) {
          const hv = await C(`data get storage mclite:chase h${k}`), sect = (key) => ((new RegExp(key + ': \\[([^\\]]*)\\]').exec(hv) || [0, ''])[1].match(/-?\d+(?:\.\d+)?(?:[eE]-?\d+)?/g) || []).map(Number);
          (cases[LIVE[k].id].hurt = cases[LIVE[k].id].hurt || []).push({ hp: sect('hp'), ht: sect('ht') });
        }
        if (LIVE[k].fire) {
          const ev = await C(`data get storage mclite:chase f${k}`);
          if (process.env.MCLITE_FIRE_DEBUG) console.log("FIREDATA", ev.slice(-600));
          const sect = (key) => ((new RegExp(key + ': \\[(.*?)\\](?:, [a-z]+:|\\}|$)').exec(ev) || [0, ''])[1]);
          (cases[LIVE[k].id].fire = cases[LIVE[k].id].fire || []).push({ rot: (sect('rot').match(/-?\d+(?:\.\d+)?(?:E-?\d+)?f/g) || []).map(parseFloat), fireTick: (sect('ftick').match(/-?\d+/g) || []).map(Number), firePos: parsePosList(sect('fpos')), fireMotion: parsePosList(sect('fmot')) });
        }
        if (LIVE[k].ent) {
          const ev = await C(`data get storage mclite:chase e${k}`);
          const ints = (key) => ((new RegExp(key + ': \\[([^\\]]*)\\]').exec(ev) || [0, ''])[1].match(/-?\d+/g) || []).map(Number);
          (cases[LIVE[k].id].ent = cases[LIVE[k].id].ent || []).push({ eggLayTime: ints('egg'), age: ints('age'), itemTick: ints('itick'), itemPos: parsePosList(((/ipos: (\[.*\]\]?)/.exec(ev) || [0, ''])[1])) });
        }
        if (LIVE[k].rot) {   // #9236
          const rv = await C(`data get storage mclite:chase r${k}`);
          (cases[LIVE[k].id].rot = cases[LIVE[k].id].rot || []).push((rv.match(/-?\d+(?:\.\d+)?(?:E-?\d+)?f/g) || []).map(parseFloat));
          // LANE:blaze #6964: read the target Pos list from its own storage
          { const pv = await C(`data get storage mclite:chase pp${k}`); (cases[LIVE[k].id].ppos = cases[LIVE[k].id].ppos || []).push(parsePosList(pv.slice(pv.indexOf('ppos:') + 5))); }
          // END LANE
        }
        if (LIVE[k].proj) {   // #5361
          const ev = await C(`data get storage mclite:chase p${k}`);
          const all = parsePosList(((/pos: (\[\[.*?\]\]|\[\])(?:, \w+:|\})/.exec(ev) || [0, ''])[1]));
          (cases[LIVE[k].id].proj = cases[LIVE[k].id].proj || []).push({ tick: ((/tick: \[([^\]]*)\]/.exec(ev) || [0, ''])[1].match(/-?\d+/g) || []).map(Number),
            pos: all.map(([x, y, z]) => [x, y - FLOOR, z - z0]), motion: parsePosList(((/mot: (\[\[.*?\]\]|\[\])(?:, \w+:|\})/.exec(ev) || [0, ''])[1])) });
        }
        if (PATHLOG) {   // #6952: SeedAgent's 'PATH <gen> <tick> <nodes>' lines -> cases[id].paths[rep][tick] = [[x,y,z],..] (lane-local) | null
          const P = Array.from({ length: T }, () => null);
          for (const ln of (existsSync(PATHLOG) ? readFileSync(PATHLOG, 'utf8') : '').split('\n')) {
            const m = /^PATH (\S*) (\d+) (\S+)$/.exec(ln);
            if (!m || +m[2] >= T) continue;
            P[+m[2]] = m[3] === '-' ? null : m[3].split(';').map((q) => { const [x, y, z] = q.split(',').map(Number); return [x, y - FLOOR, z - z0]; });
          }
          (cases[LIVE[k].id].paths = cases[LIVE[k].id].paths || []).push(P);
          // LANE:blaze #9256: 'TGT <gen> <tick> <id>' -> cases[id].tgt[rep][tick] = target entity id | -1 | null (no line that tick)
          const G = Array.from({ length: T }, () => null);
          for (const ln of (existsSync(PATHLOG) ? readFileSync(PATHLOG, 'utf8') : '').split('\n')) { const m = /^TGT (\S*) (\d+) (-?\d+)$/.exec(ln); if (m && +m[2] < T) G[+m[2]] = +m[3]; }
          (cases[LIVE[k].id].tgt = cases[LIVE[k].id].tgt || []).push(G);
          // END LANE
        }
        if (L.length !== T) notes.push(`rep ${rep} ${LIVE[k].id}: ${L.length}/${T} samples (mob gone?)`);
      }
    }
  } finally {
    for (const b of bots) { try { b.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'chase', version: '1.18.2', T, REPS, clock: 'summon (AI on, persistent, NBT form) -> tick function logs Pos before each world tick; entry i = after i world ticks; positions local (x along the lane, y above the floor, z across)',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(process.env.MCLITE_CHASE_OUT || join(dir, 'chase.json'), JSON.stringify(golden) + '\n');
  for (const s of LIVE) { const L = cases[s.id].logs[0] || []; console.log(`  ${s.id.padEnd(16)} x@40 ${(L[40] || [])[0]}  x@80 ${(L[80] || [])[0]}  x@159 ${(L[159] || [])[0]}`); }
  console.log(`referee/runchase: ${golden.seconds} s -> ${join(dir, 'chase.json')}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
