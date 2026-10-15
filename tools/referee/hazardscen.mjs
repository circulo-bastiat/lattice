// hazardscen.mjs — the BLOCK HAZARDS referee pack (infra I6, s142, 25 Sept 2026), shared by runhazard.mjs (the real 1.18.2
// server) and hazardrefcheck.mjs (the engine): what standing IN or ON a block does to a mob, per tick. Magma
// (MagmaBlock.onSteppedOn: HOT_FLOOR 1, not the fire-immune), campfire / soul campfire (CampfireBlock.onEntityCollision: IN_FIRE
// 1 / 2 when lit), a wither rose (WitherRoseBlock.onEntityCollision: Wither II, 40 ticks), a fire block (AbstractFireBlock:
// IN_FIRE 1 + 8 s alight), lava (Entity.setOnFireFromLava: LAVA 4 + 15 s alight), powder snow (freeze: 140 ticks to frozen,
// then FREEZE 1 every 40 ticks by age), suffocation (IN_WALL 1 inside a stone block). Each scenario: an AI-on mob summoned
// (NBT form: no initialize) in a 1x1 glass pen with the hazard, its Health logged every tick for T ticks.
export const REPS = 2;
export const PITCH = 5;
export const T = 200;
// floor = the block under the mob's feet cell; at = the block IN the mob's feet cell; head = the block in the cell above.
export const SCEN = [
  { id: 'pig_magma', mob: 'pig', floor: 'magma_block' },
  { id: 'zombie_magma', mob: 'zombie', floor: 'magma_block' },
  { id: 'zpiglin_magma', mob: 'zombified_piglin', floor: 'magma_block' },
  { id: 'pig_campfire', mob: 'pig', floor: 'stone', at: 'campfire' },
  { id: 'pig_soul_campfire', mob: 'pig', floor: 'stone', at: 'soul_campfire' },
  { id: 'pig_unlit_campfire', mob: 'pig', floor: 'stone', at: 'campfire[lit=false]' },
  { id: 'pig_wither_rose', mob: 'pig', floor: 'grass_block', at: 'wither_rose' },
  { id: 'pig_fire', mob: 'pig', floor: 'netherrack', at: 'fire' },
  { id: 'zpiglin_fire', mob: 'zombified_piglin', floor: 'netherrack', at: 'fire' },
  { id: 'pig_lava', mob: 'pig', floor: 'stone', at: 'lava' },
  { id: 'zpiglin_lava', mob: 'zombified_piglin', floor: 'stone', at: 'lava' },
  { id: 'pig_powder_snow', mob: 'pig', floor: 'stone', at: 'powder_snow', head: 'powder_snow' },
  { id: 'pig_in_stone', mob: 'pig', floor: 'stone', at: 'stone' },
  { id: 'cow_stone_head', mob: 'cow', floor: 'stone', head: 'stone' },
  { id: 'pig_stone_control', mob: 'pig', floor: 'stone' },
];
