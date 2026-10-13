// motionscen.mjs — the ENTITY MOTION scenarios (no-will entities: item, falling block, TNT, arrow, XP orb, armor
// stand), shared by runmotion.mjs (the real 1.18.2 server) and motionrefcheck.mjs (the engine). Infra I6, 24 Sept 2026.
//
// Each scenario summons ONE entity at tick 1 at a LOCAL position (x east, y up; a stone floor at y=-1, an optional
// wall) with an initial Motion, then both sides run the same clock as redstonescen.mjs: for k = 1..T: (k == 1:
// summon) -> sample (log[k-1]) -> one world tick. Samples: x/y/z and vx/vy/vz as floor(v * 10000), plus `alive`.
// Positions are logged RELATIVE to the scenario origin, so both sides compare the same numbers.
// Every number the check compares is the SERVER's (D-329); this file only builds scenes.

export const T = 90;   // eye_of_ender lives 81 ticks
export const SCALE = 10000;

export const SCENARIOS = [
  { id: 'item_drop', type: 'item', pos: [0.5, 8, 0.5], motion: [0, 0, 0], nbt: 'Item:{id:"minecraft:stone",Count:1b},PickupDelay:32767,Health:5s' },
  { id: 'item_throw', type: 'item', pos: [0.5, 2, 0.5], motion: [0.3, 0.25, 0.1], nbt: 'Item:{id:"minecraft:stone",Count:1b},PickupDelay:32767,Health:5s' },
  { id: 'item_into_wall', type: 'item', pos: [0.5, 0.5, 0.5], motion: [0.6, 0.1, 0], nbt: 'Item:{id:"minecraft:stone",Count:1b},PickupDelay:32767,Health:5s',
    blocks: [[3, 0, 0, 'stone'], [3, 1, 0, 'stone']] },
  // #6088 ItemEntity in water / lava / fire / cactus: a 3-deep 3x3 pool ringed by stone, an item dropped from 2 above the surface
  ...[['water', 'stone'], ['lava', 'stone'], ['lava', 'netherite_ingot']].map(([fl, it]) => ({
    id: `item_${it === 'stone' ? '' : it + '_'}in_${fl}`, type: 'item', item: it, pos: [0.5, 5, 0.5], motion: [0, 0, 0], nbt: `Item:{id:"minecraft:${it}",Count:1b},PickupDelay:32767,Health:5s`,
    blocks: [-2, -1, 0, 1, 2].flatMap((x) => [-2, -1, 0, 1, 2].flatMap((z) => [0, 1, 2].map((y) => [x, y, z, Math.abs(x - 0) <= 1 && Math.abs(z) <= 1 ? fl : 'stone']))) })),
  { id: 'item_on_fire', type: 'item', item: 'stone', pos: [0.5, 3, 0.5], motion: [0, 0, 0], nbt: 'Item:{id:"minecraft:stone",Count:1b},PickupDelay:32767,Health:5s',
    blocks: [[0, -1, 0, 'netherrack'], [0, 0, 0, 'fire']] },
  { id: 'item_on_cactus', type: 'item', item: 'stone', pos: [0.5, 3, 0.5], motion: [0, 0, 0], nbt: 'Item:{id:"minecraft:stone",Count:1b},PickupDelay:32767,Health:5s',
    blocks: [[0, -2, 0, 'stone'], [0, -1, 0, 'sand'], [0, 0, 0, 'cactus']] },
  { id: 'falling_sand', type: 'falling_block', pos: [0.5, 9, 0.5], motion: [0, 0, 0], nbt: 'BlockState:{Name:"minecraft:sand"},Time:1',
    probeBlock: [0, 0, 0, 'sand'] },
  { id: 'falling_gravel_sideways', type: 'falling_block', pos: [0.5, 6, 0.5], motion: [0.2, 0.3, 0], nbt: 'BlockState:{Name:"minecraft:gravel"},Time:1',
    probeBlock: [1, 0, 0, 'gravel'] },
  // #6087 FallingBlockEntity.tick landing branch: the landing cell's final state (probeBlock) and the item entity it drops.
  // `state` = the falling block ('sand'|'gravel'|'anvil'); `land` = the cell state the engine must hold after (probeBlock).
  ...[
    ['torch', [[0, 0, 0, 'torch']], 'sand', 'sand'],
    ['snow3', [[0, 0, 0, 'snow[layers=3]']], 'sand', 'sand'],
    ['slab', [[0, 0, 0, 'stone_slab[type=bottom]']], 'sand', 'stone_slab[type=bottom]'],
    ['flowing', [[0, 0, 0, 'water[level=3]']], 'gravel', 'gravel'],
    ['hopper', [[0, 0, 0, 'hopper']], 'sand', 'hopper'],
    ['trapdoor', [[0, 1, 0, 'oak_trapdoor[half=bottom,open=false]']], 'sand', 'oak_trapdoor[half=bottom,open=false]'],
  ].map(([n, blocks, st, land]) => ({
    id: 'fall_land_' + n, type: 'falling_block', pos: [0.5, 5, 0.5], motion: [0, 0, 0],
    nbt: `BlockState:{Name:"minecraft:${st}"},Time:1`, blocks, probeBlock: [0, 0, 0, land], probeItem: true })),
  { id: 'tnt_drop', type: 'tnt', pos: [0.5, 7, 0.5], motion: [0, 0, 0], nbt: 'Fuse:200' },
  { id: 'tnt_pushed', type: 'tnt', pos: [0.5, 0, 0.5], motion: [0.4, 0.2, -0.2], nbt: 'Fuse:200' },
  { id: 'arrow_lob', type: 'arrow', pos: [0.5, 1.5, 0.5], motion: [1.2, 0.6, 0], nbt: 'pickup:0b' },
  { id: 'arrow_fall', type: 'arrow', pos: [0.5, 12, 0.5], motion: [0, 0, 0], nbt: 'pickup:0b' },
  // #6078 spectral_arrow: SpectralArrowEntity (duration 200, PersistentProjectileEntity drag) lobbed, stuck in a wall, and into a NoAI pig (Glowing probes)
  { id: 'spectral_arrow_lob', type: 'spectral_arrow', pos: [0.5, 1.5, 0.5], motion: [1.2, 0.6, 0], nbt: 'pickup:0b' },
  { id: 'spectral_arrow_wall', type: 'spectral_arrow', pos: [0.5, 1.5, 0.5], motion: [2.0, 0.1, 0], nbt: 'pickup:0b',
    blocks: [[6, 0, 0, 'stone'], [6, 1, 0, 'stone'], [6, 2, 0, 'stone']] },
  { id: 'spectral_arrow_mob', type: 'spectral_arrow', pos: [0.5, 0.5, 0.5], motion: [1.5, 0, 0], nbt: 'pickup:0b', pig: [6.5, 0, 0.5], glow: true },
  { id: 'xp_orb_drop', type: 'experience_orb', pos: [0.5, 6, 0.5], motion: [0, 0, 0], nbt: 'Value:1s' },
  { id: 'armor_stand_drop', type: 'armor_stand', pos: [0.5, 9, 0.5], motion: [0, 0, 0], nbt: '' },
  // EyeOfEnderEntity: a /summon never calls initTargetPos, so the server's target is the WORLD origin (0,0,0) and
  // dropsItem is false: the flight lerps toward it for 81 ticks, then the eye is discarded with the break event (2003).
  { id: 'eye_flight', type: 'eye_of_ender', pos: [0.5, 2, 0.5], motion: [0, 0, 0], nbt: '', eyeTarget: [0, 0, 0] },
  { id: 'eye_flight_moving', type: 'eye_of_ender', pos: [0.5, 1, 0.5], motion: [0.2, 0.3, -0.1], nbt: '', eyeTarget: [0, 0, 0] },
  { id: 'pearl_ground', type: 'ender_pearl', pos: [0.5, 1.5, 0.5], motion: [0.5, 0.3, 0.1], nbt: '' },
  { id: 'pearl_wall', type: 'ender_pearl', pos: [0.5, 1.5, 0.5], motion: [1.0, 0.2, 0], nbt: '',
    blocks: [[4, 0, 0, 'stone'], [4, 1, 0, 'stone'], [4, 2, 0, 'stone'], [4, 3, 0, 'stone']] },
  { id: 'pearl_ceiling', type: 'ender_pearl', pos: [0.5, 1, 0.5], motion: [0.1, 1.0, 0], nbt: '',
    blocks: [[0, 4, 0, 'stone'], [1, 4, 0, 'stone'], [2, 4, 0, 'stone']] },
  { id: 'armor_stand_thrown', type: 'armor_stand', pos: [0.5, 1, 0.5], motion: [0.5, 0.4, 0], nbt: '' },
  // #6034 thrown trident: at a wall / at a pig (NoAI), Loyalty 0 and 3. `owner` = a NoGravity armor stand the return flies to.
  ...[['wall', 0], ['wall', 3], ['pig', 0], ['pig', 3]].map(([what, loy], n) => ({
    id: `trident_${what}_l${loy}`, type: 'trident', pos: [0.5, 1.5, 0.5], motion: what === 'pig' ? [1.5, -0.05, 0] : [2.5, 0.3, 0], loyalty: loy, until: loy ? (what === 'wall' ? 25 : 18) : undefined, owner: [0.5, 0, -6.5], ownerN: n + 1,
    pig: what === 'pig' ? [6.5, 0, 0.5] : undefined, blocks: what === 'wall' ? [[8, 0, 0, 'stone'], [8, 1, 0, 'stone'], [8, 2, 0, 'stone']] : [],
    nbt: `Trident:{id:"minecraft:trident",Count:1b${loy ? `,tag:{Enchantments:[{id:"minecraft:loyalty",lvl:${loy}s}]}` : ''}},Owner:[I;0,0,0,${n + 1}],pickup:0b,DealtDamage:0b` })),
  // #6029 DragonFireballEntity: `power` is the per-tick acceleration (read from NBT `power`), drag 0.95; at a wall it becomes a dragon-breath cloud.
  { id: 'dfireball_air', type: 'dragon_fireball', pos: [0.5, 3, 0.5], motion: [0.2, 0.1, 0], power: [0.05, -0.02, 0.01], nbt: 'power:[0.05d,-0.02d,0.01d]' },
  { id: 'dfireball_wall', type: 'dragon_fireball', pos: [0.5, 1.5, 0.5], motion: [0.5, 0, 0], power: [0.1, 0, 0], nbt: 'power:[0.1d,0d,0d]', cloud: true,
    blocks: [[6, 0, 0, 'stone'], [6, 1, 0, 'stone'], [6, 2, 0, 'stone']] },
  // #6025 ExperienceBottleEntity (gravity 0.07): at the floor and at a wall; probeOrbs = the orbs spawned at impact (count, sum of Value x Count)
  { id: 'bottle_floor', type: 'experience_bottle', pos: [0.5, 2, 0.5], motion: [0.3, 0.2, 0.05], nbt: '', probeOrbs: true },
  { id: 'bottle_wall', type: 'experience_bottle', pos: [0.5, 1.5, 0.5], motion: [1.2, 0.1, 0], nbt: '', probeOrbs: true,
    blocks: [[5, 0, 0, 'stone'], [5, 1, 0, 'stone'], [5, 2, 0, 'stone']] },
  ...['snowball', 'egg'].flatMap((t) => [
    { id: t + '_air', type: t, pos: [0.5, 2, 0.5], motion: [0.45, 0.4, 0.1], nbt: '' },
    { id: t + '_water', type: t, pos: [0.5, 3, 0.5], motion: [0.7, 0.1, 0], nbt: '',
      blocks: [...Array(13).keys()].flatMap((k) => (k === 12 ? [[3 + k, 0, 0, 'stone'], [3 + k, 1, 0, 'stone']]
      : [[3 + k, 0, 0, 'water'], [3 + k, 1, 0, 'water'], [3 + k, 0, 1, 'stone'], [3 + k, 1, 1, 'stone'], [3 + k, 0, -1, 'stone'], [3 + k, 1, -1, 'stone']])) },
    { id: t + '_wall', type: t, pos: [0.5, 1.5, 0.5], motion: [1.2, 0.2, 0], nbt: '', blocks: [[5, 0, 0, 'stone'], [5, 1, 0, 'stone'], [5, 2, 0, 'stone']] },
  ]),
];

export const FIELDS = [['x', 'Pos[0]'], ['y', 'Pos[1]'], ['z', 'Pos[2]'], ['vx', 'Motion[0]'], ['vy', 'Motion[1]'], ['vz', 'Motion[2]']];

/** World placement of scenario i: 16 apart along x, floor at y=-61 (local y=-1), local y 0 at -60. */
export const origin = (i) => ({ x: 8 + 16 * i, y: -60, z: 104 });

export function serverPlan() {
  const setup = [], step = [], probes = [];
  const maxX = origin(SCENARIOS.length - 1).x + 16;
  setup.push(`forceload add 0 96 ${maxX} 112`);
  for (let x0 = 0; x0 <= maxX; x0 += 16) {
    setup.push(`fill ${x0} -63 96 ${x0 + 15} -40 112 minecraft:air`);
    setup.push(`fill ${x0} -61 96 ${x0 + 15} -61 112 minecraft:stone`);
  }
  setup.push(`kill @e[type=!player,x=0,y=-64,z=96,dx=${maxX},dy=30,dz=16]`);
  SCENARIOS.forEach((sc, i) => setup.push(`kill @e[tag=mrm${i}]`));   // a leftover of an earlier run, wherever it flew
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    for (const [x, y, z, name] of sc.blocks || []) setup.push(`setblock ${o.x + x} ${o.y + y} ${o.z + z} minecraft:${name}`);
    if (sc.owner) setup.push(`summon minecraft:armor_stand ${o.x + sc.owner[0]} ${o.y + sc.owner[1]} ${o.z + sc.owner[2]} {NoGravity:1b,UUID:[I;0,0,0,${sc.ownerN}],Tags:["mro${i}"]}`);
    if (sc.pig) setup.push(`summon minecraft:pig ${o.x + sc.pig[0]} ${o.y + sc.pig[1]} ${o.z + sc.pig[2]} {NoAI:1b,PersistenceRequired:1b,Silent:1b,Tags:["mrp${i}"]}`);
    const [px, py, pz] = sc.pos, [mx, my, mz] = sc.motion;
    const nbt = [sc.nbt, `Motion:[${mx}d,${my}d,${mz}d]`, `Tags:["mrm${i}"]`].filter(Boolean).join(',');
    step.push(`execute if score #t mclr matches 1 run summon minecraft:${sc.type} ${o.x + px} ${o.y + py} ${o.z + pz} {${nbt}}`);
  });
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    const sel = `@e[tag=mrm${i},limit=1]`;
    const base = [o.x, o.y, o.z, 0, 0, 0];
    FIELDS.forEach(([f, path], fi) => {
      probes.push(`${sc.id}.${f}`);
      const j = probes.length - 1;
      step.push(`data modify storage mcliteref:mo p${j} append value 0d`);
      // relative to the origin: store the absolute value * SCALE, subtract the origin in the check
      step.push(`execute store result storage mcliteref:mo p${j}[-1] double 1 run data get entity ${sel} ${path} ${SCALE}`);
      void base[fi];
    });
    probes.push(`${sc.id}.alive`);
    let j = probes.length - 1;
    step.push(`data modify storage mcliteref:mo p${j} append value 0`);
    step.push(`execute if entity ${sel} run data modify storage mcliteref:mo p${j}[-1] set value 1`);
    if (sc.cloud) {   // the breath cloud: Radius x SCALE, Duration, WaitTime, first effect Id*100+Amplifier
      const csel = `@e[type=area_effect_cloud,x=${o.x - 2},y=${o.y - 2},z=${o.z - 4},dx=12,dy=6,dz=8,limit=1]`;
      for (const [lab, path, mul] of [['cr', 'Radius', SCALE], ['cd', 'Duration', 1], ['cw', 'WaitTime', 1], ['ce', 'Effects[0].Id', 1], ['ca', 'Effects[0].Amplifier', 1]]) {
        probes.push(`${sc.id}.${lab}`);
        j = probes.length - 1;
        step.push(`data modify storage mcliteref:mo p${j} append value 0d`);   // a list is typed by its first element
        step.push(`execute store result storage mcliteref:mo p${j}[-1] double 1 run data get entity ${csel} ${path} ${mul}`);
      }
    }
    if (sc.glow) for (const [lab, key] of [['glowd', 'Duration'], ['glowa', 'Amplifier']]) {   // the target's Glowing (id 24): 0 while absent
      probes.push(`${sc.id}.${lab}`);
      j = probes.length - 1;
      step.push(`data modify storage mcliteref:mo p${j} append value 0`);
      step.push(`execute store result storage mcliteref:mo p${j}[-1] int 1 run data get entity @e[tag=mrp${i},limit=1] ActiveEffects[{Id:24b}].${key}`);
    }
    if (sc.probeItem) {
      probes.push(`${sc.id}.items`);
      j = probes.length - 1;
      step.push(`data modify storage mcliteref:mo p${j} append value 0`);
      step.push(`execute store result storage mcliteref:mo p${j}[-1] int 1 if entity @e[type=item,x=${o.x - 3},y=${o.y - 1},z=${o.z - 3},dx=6,dy=8,dz=6]`);
    }
    if (sc.probeOrbs) {
      const box = `x=${o.x - 3},y=${o.y - 1},z=${o.z - 3},dx=12,dy=8,dz=6`;
      probes.push(`${sc.id}.orbs`);
      j = probes.length - 1;
      step.push(`data modify storage mcliteref:mo p${j} append value 0`);
      step.push(`execute store result storage mcliteref:mo p${j}[-1] int 1 if entity @e[type=experience_orb,${box}]`);
      probes.push(`${sc.id}.xp`);
      j = probes.length - 1;
      step.push(`data modify storage mcliteref:mo p${j} append value 0`);
      step.push('scoreboard players set #sum mclr 0');
      step.push(`execute as @e[type=experience_orb,${box}] run function mcliteref:orbsum`);
      step.push(`execute store result storage mcliteref:mo p${j}[-1] int 1 run scoreboard players get #sum mclr`);
    }
    if (sc.probeBlock) {
      const [x, y, z, name] = sc.probeBlock;
      probes.push(`${sc.id}.block`);
      j = probes.length - 1;
      step.push(`data modify storage mcliteref:mo p${j} append value 0`);
      step.push(`execute if block ${o.x + x} ${o.y + y} ${o.z + z} minecraft:${name} run data modify storage mcliteref:mo p${j}[-1] set value 1`);
    }
  });
  return { setup, step, probes };
}
