// convscen.mjs — infra I6 (25 Sept 2026): MOB CONVERSION scenarios shared by runconv.mjs (the real 1.18.2 server) and
// convrefcheck.mjs (the engine). Each scenario: one mob summoned (AI on, persistent) in its own glass cell whose inside is
// `fill` (air / water / powder_snow, `depth` blocks from the floor), then T ticks. Recorded: the tick the mob's converted form
// first appears in the cell (-1 = never within T), and the converted mob's type, baby flag, health, held/worn item ids and its
// nausea duration left at the end. `nbt` is summon NBT on the server; the engine side sets the same state through `eng`
// (a field name -> value map the check applies with the engine's OWN setters -- see convrefcheck.mjs's applyState).
export const T = 1000;          // ticks watched (zombie -> drowned needs 600 + 300 + 1)
export const PITCH = 4;         // cell spacing: 1x1 inside + glass walls
export const H = 4;             // cell inside height
export const SCEN = [
  // AbstractPiglinEntity.mobTick: timeInOverworld > 300 -> zombifiedPiglin (convertTo keepEquipment) + nausea 200
  { id: 'piglin', mob: 'piglin', fill: 'air', to: 'zombified_piglin', nbt: 'IsBaby:0b', eng: { adult: true } },
  { id: 'piglin_baby', mob: 'piglin', fill: 'air', to: 'zombified_piglin', nbt: 'IsBaby:1b', eng: { baby: true } },
  { id: 'piglin_t250', mob: 'piglin', fill: 'air', to: 'zombified_piglin', nbt: 'IsBaby:0b,TimeInOverworld:250', eng: { adult: true, timeInOverworld: 250 } },
  { id: 'piglin_immune', mob: 'piglin', fill: 'air', to: 'zombified_piglin', nbt: 'IsBaby:0b,IsImmuneToZombification:1b', eng: { adult: true, immuneToZombification: true } },
  { id: 'piglin_gear_hp7', mob: 'piglin', fill: 'air', to: 'zombified_piglin',
    nbt: 'IsBaby:0b,Health:7f,HandItems:[{id:"minecraft:crossbow",Count:1b},{}],ArmorItems:[{},{},{},{id:"minecraft:golden_helmet",Count:1b}]',
    eng: { adult: true, health: 7, main: 'crossbow', head: 'golden_helmet' } },
  { id: 'brute', mob: 'piglin_brute', fill: 'air', to: 'zombified_piglin', nbt: '' },
  // HoglinEntity.mobTick: timeInOverworld > 300 -> zoglin + nausea 200
  { id: 'hoglin', mob: 'hoglin', fill: 'air', to: 'zoglin', nbt: '' },
  { id: 'hoglin_baby', mob: 'hoglin', fill: 'air', to: 'zoglin', nbt: 'Age:-24000', eng: { baby: true } },
  { id: 'hoglin_immune', mob: 'hoglin', fill: 'air', to: 'zoglin', nbt: 'IsImmuneToZombification:1b', eng: { immuneToZombification: true } },
  { id: 'hoglin_hp9', mob: 'hoglin', fill: 'air', to: 'zoglin', nbt: 'Health:9f', eng: { health: 9 } },
  // ZombieEntity.tick: submerged (eyes in water) inWaterTime >= 600 -> 300-tick countdown -> convertInWater
  { id: 'zombie_water', mob: 'zombie', fill: 'water', depth: 4, to: 'drowned', nbt: 'IsBaby:0b', eng: { adult: true } },
  { id: 'zombie_water_hp10_sword', mob: 'zombie', fill: 'water', depth: 4, to: 'drowned',
    nbt: 'IsBaby:0b,Health:10f,HandItems:[{id:"minecraft:iron_sword",Count:1b},{}]', eng: { adult: true, health: 10, main: 'iron_sword' } },
  { id: 'zombie_baby_water', mob: 'zombie', fill: 'water', depth: 4, to: 'drowned', nbt: 'IsBaby:1b', eng: { baby: true } },
  { id: 'zombie_shallow', mob: 'zombie', fill: 'water', depth: 1, to: 'drowned', nbt: 'IsBaby:0b', eng: { adult: true } },
  { id: 'husk_water', mob: 'husk', fill: 'water', depth: 4, to: 'zombie', nbt: 'IsBaby:0b', eng: { adult: true } },
  { id: 'zombie_inwater590', mob: 'zombie', fill: 'water', depth: 4, to: 'drowned', nbt: 'IsBaby:0b,InWaterTime:590', eng: { adult: true, waterConvertTime: 590 } },
  // SkeletonEntity.tick: inPowderSnow 140 ticks -> 300-tick countdown -> stray
  { id: 'skeleton_snow', mob: 'skeleton', fill: 'powder_snow', depth: 3, to: 'stray', nbt: '' },
];
