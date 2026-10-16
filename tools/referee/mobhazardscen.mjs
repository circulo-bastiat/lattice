// mobhazardscen.mjs -- Entity.baseTick fire / drowning / void on mobs (#6091), shared by runmobhazard.mjs (real 1.18.2
// server) and mobhazardrefcheck.mjs (engine). Vanilla: Entity.baseTick fire half (.decomp Entity.java:~420-456, 20-tick
// fire damage, water extinguishes, fire-immune decays 4/tick), LivingEntity.baseTick breath (:328-390; air 300, -20 -> 2.0
// DROWN; canBreatheInWater() is true for the UNDEAD group, so zombie/skeleton/husk never drown), Entity.attemptTickInVoid
// (y < bottomY - 64 = -128) -> LivingEntity.tickInVoid damage(OUT_OF_WORLD, 4). Per scenario: Health, NBT Fire and Air per tick.
export const REPS = 2;
export const PITCH = 5;
export const T = 450;
export const SCEN = [
  { id: 'cow_fire', mob: 'cow', floor: 'stone', fire: 5, t: 140 },
  { id: 'cow_fire_water', mob: 'cow', floor: 'stone', at: 'water', fire: 5, t: 140 },
  { id: 'zombie_fire', mob: 'zombie', floor: 'stone', fire: 5, t: 140 },
  { id: 'skeleton_fire', mob: 'skeleton', floor: 'stone', fire: 5, t: 140 },
  { id: 'husk_fire', mob: 'husk', floor: 'stone', fire: 5, t: 140 },
  { id: 'blaze_fire', mob: 'blaze', floor: 'stone', fire: 5, t: 140 },
  { id: 'cow_submerged', mob: 'cow', floor: 'stone', at: 'water', head: 'water', lid: 'glass', t: 450 },
  { id: 'zombie_submerged', mob: 'zombie', floor: 'stone', at: 'water', head: 'water', lid: 'glass', t: 450 },
  { id: 'cow_void', mob: 'cow', y: -127, ty: -130, t: 60 },
  { id: 'cow_above_void', mob: 'cow', y: -127, t: 60 },
];
