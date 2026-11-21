// spawnerscen.mjs — infra I6 (s150): the MOB SPAWNER pack's rooms, shared by runspawner.mjs (the real
// 1.18.2 server) and spawnerrefcheck.mjs (the engine). The question: MobSpawnerLogic.serverTick
// (.decomp net/minecraft/world/MobSpawnerLogic.java:69-168) — the 20-tick first delay, the 4 tries a
// batch, the position spread, the per-position SpawnRestriction rules for reason SPAWNER, the
// maxNearbyEntities=6 box, and WHEN the delay is re-rolled (updateSpawns, :165-167: only after a batch
// that spawned something, or on the nearby cap — a batch whose every try fails retries NEXT tick).
// Every room: a spawner at (X, Y, Z); a 9x9 interior (X-4..X+4, Z-4..Z+4), 4 high (Y-1..Y+2), floor at
// Y-2, walls at +-5 up to Y+3; `sealed` rooms get a stone ceiling at Y+3 (sky 0, block light 0 unless
// `lamp`), open rooms see the sky (sky light 15). Spawned mobs are counted and removed EVERY tick
// (so the nearby cap never binds) except in `keep` rooms, where they stay and the count is who's alive.
export const Y = 100;
export const T = 6000;                               // ticks per run
export const CHECKPOINTS = [30, 500, 1000, 2000, 4000, 6000];
export const REPS = 6;                               // server rooms per scenario per run (keep: 3)
export const RANGE = 64;                             // RequiredPlayerRange (NBT), so one player reaches every room
// `atcap`: 80 un-persistent zombies in a sealed pen (the monster cap is 70) floating 14 blocks over the player, so
// none of them ever leaves the 32-block no-despawn band (at 65 blocks they were all gone by t6000)
export const PEN = { x: 36, y: Y + 20, z: 30, n: 80 };
export const PLAYER = { x: 36.5, y: Y + 6, z: 30.5 };
export const SCEN = [
  { id: 'zombie_dark', mob: 'zombie', floor: 'stone', sealed: true },
  { id: 'zombie_lamp', mob: 'zombie', floor: 'stone', sealed: true, lamp: 15 },   // light block at (X, Y+2, Z)
  { id: 'zombie_atcap', mob: 'zombie', floor: 'stone', sealed: true, atcap: true },// a spawner ignores the mob cap
  // index 3 = the grid's middle column (X=36), 3 rooms at z 18/30/42: every keep room within 32 of the player, so none
  // of its mobs can despawn (a keep room 32 blocks out lost one)
  { id: 'zombie_keep', mob: 'zombie', floor: 'stone', sealed: true, keep: true },  // the maxNearbyEntities=6 cap
  { id: 'cow_grass', mob: 'cow', floor: 'grass_block', sealed: false },
  { id: 'cow_strip', mob: 'cow', floor: 'stone', strip: 'grass_block', sealed: false }, // grass only on the x = X+2 row
  { id: 'cow_stone', mob: 'cow', floor: 'stone', sealed: false },
];
// SET 2 (one more server run, `--set 2`): the other spawner-able types, one column each, 4 rooms, every spawner in
// reach of the player at RequiredPlayerRange 96. Hostiles in sealed dark rooms; blaze/magma_cube/silverfish ALSO in
// open lit rooms (their rules ignore light: HostileEntity.canSpawnIgnoreLightLevel / MagmaCubeEntity.canMagmaCubeSpawn
// / SilverfishEntity.canSpawn); passives in open grass rooms; slime at y=100 in a plains chunk (SlimeEntity.canSpawn
// has no SPAWNER exemption).
export const SCEN2 = [
  { id: 'spider_dark', mob: 'spider', floor: 'stone', sealed: true },
  { id: 'skeleton_dark', mob: 'skeleton', floor: 'stone', sealed: true },
  { id: 'creeper_dark', mob: 'creeper', floor: 'stone', sealed: true },
  { id: 'cave_spider_dark', mob: 'cave_spider', floor: 'stone', sealed: true },
  { id: 'silverfish_lit', mob: 'silverfish', floor: 'stone', sealed: false },
  { id: 'blaze_lit', mob: 'blaze', floor: 'stone', sealed: false },
  { id: 'magma_cube_lit', mob: 'magma_cube', floor: 'stone', sealed: false },
  { id: 'slime_dark', mob: 'slime', floor: 'stone', sealed: true },
  { id: 'pig_grass', mob: 'pig', floor: 'grass_block', sealed: false },
  { id: 'chicken_grass', mob: 'chicken', floor: 'grass_block', sealed: false },
  { id: 'sheep_grass', mob: 'sheep', floor: 'grass_block', sealed: false },
  { id: 'rabbit_grass', mob: 'rabbit', floor: 'grass_block', sealed: false },
  { id: 'wolf_grass', mob: 'wolf', floor: 'grass_block', sealed: false },
];
// SET 3: blaze in the dark (blaze_lit's 0 alone could not tell 'the light refuses it' from 'nothing spawns it')
SCEN2.push({ id: 'blaze_dark', mob: 'blaze', floor: 'stone', sealed: true, set3: true });
SCEN2.forEach((s) => { s.set = s.set3 ? 3 : 2; s.range = 96; });
export const PLAYER2 = { x: 72.5, y: Y + 6, z: 18.5 };
// room r of scenario s, set 1: a 7 x 6 grid, 12 apart (the 11-wide shells leave a 1-block gap; the spawners' nearby
// boxes, X-4..X+5, never overlap a neighbour's); set 2: 13 x 4
export function roomsOf(set) {
  const out = [];
  if (set === 2 || set === 3) SCEN2.forEach((s, si) => { if (s.set !== set) return; for (let r = 0; r < 4; r++) out.push({ s, id: `${s.id}#${r}`, X: si * 12, Z: r * 12 }); });
  else SCEN.forEach((s, si) => {
    if (s.keep) for (let r = 0; r < 3; r++) out.push({ s, id: `${s.id}#${r}`, X: si * 12, Z: 18 + r * 12 });
    else for (let r = 0; r < REPS; r++) out.push({ s, id: `${s.id}#${r}`, X: si * 12, Z: r * 12 });
  });
  return out;
}
export const ROOMS = roomsOf(1);
export const ALL_SCEN = SCEN.concat(SCEN2);
// the floor block at (x, Y-2, z) of room `room`
export function floorAt(room, x, z) {
  if (room.s.strip && x === room.X + 2) return room.s.strip;
  return room.s.floor;
}
