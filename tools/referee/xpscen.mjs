// xpscen.mjs — the MOB XP referee pack's scenarios (infra I6, 24 Sept 2026), shared by runxp.mjs (server) and
// xprefcheck.mjs (engine). One VARIANT = a mob type + the NBT it is summoned with (equipment, baby, size) + the same
// setup expressed for the engine. The server side kills each with a player-owned arrow (so `playerHitTimer` > 0 and
// `attackingPlayer` is set -- LivingEntity.dropXp, .decomp/net/minecraft/entity/LivingEntity.java:1350) and sums every
// orb's Value x Count (ExperienceOrbEntity.java:198-199) in the mob's own cell.
// /summon WITH NBT skips MobEntity.initialize (SummonCommand.java:~90: initialize only when no NBT is given), so the
// equipment is exactly what the NBT says and nothing is rolled -- both sides start from the same mob.
export const N = 100;               // kills per variant on the server
export const ENGINE_N = 400;        // kills per variant in the engine
const H = (hand) => `HandItems:[{id:"minecraft:${hand}",Count:1b},{}]`;
const HEAD = (it) => `ArmorItems:[{},{},{},{id:"minecraft:${it}",Count:1b}]`;
// engine equip: [slotName, itemId]; slot names are Items.<SLOT> constants (HEAD/CHEST/LEGS/FEET/MAINHAND/OFFHAND)
export const VARIANTS = [
  { id: 'zombie', mob: 'zombie', nbt: '' },
  { id: 'zombie_sword_helmet', mob: 'zombie', nbt: `${H('iron_sword')},${HEAD('iron_helmet')}`, equip: [['MAINHAND', 'iron_sword'], ['HEAD', 'iron_helmet']] },
  { id: 'baby_zombie', mob: 'zombie', nbt: 'IsBaby:1b', baby: true },
  { id: 'baby_zombie_sword', mob: 'zombie', nbt: `IsBaby:1b,${H('iron_sword')}`, baby: true, equip: [['MAINHAND', 'iron_sword']] },
  { id: 'husk', mob: 'husk', nbt: '' },
  { id: 'drowned', mob: 'drowned', nbt: '' },
  { id: 'zombie_villager', mob: 'zombie_villager', nbt: '' },
  { id: 'zombified_piglin_sword', mob: 'zombified_piglin', nbt: H('golden_sword'), equip: [['MAINHAND', 'golden_sword']] },
  { id: 'skeleton_bow', mob: 'skeleton', nbt: H('bow'), equip: [['MAINHAND', 'bow']] },
  { id: 'stray', mob: 'stray', nbt: '' },
  { id: 'wither_skeleton_sword', mob: 'wither_skeleton', nbt: H('stone_sword'), equip: [['MAINHAND', 'stone_sword']] },
  { id: 'creeper', mob: 'creeper', nbt: '' },
  { id: 'spider', mob: 'spider', nbt: '' },
  { id: 'cave_spider', mob: 'cave_spider', nbt: '' },
  { id: 'silverfish', mob: 'silverfish', nbt: '' },
  { id: 'endermite', mob: 'endermite', nbt: '' },
  { id: 'phantom', mob: 'phantom', nbt: '' },
  { id: 'witch', mob: 'witch', nbt: '' },
  { id: 'vindicator_axe', mob: 'vindicator', nbt: H('iron_axe'), equip: [['MAINHAND', 'iron_axe']] },
  { id: 'pillager_crossbow', mob: 'pillager', nbt: H('crossbow'), equip: [['MAINHAND', 'crossbow']] },
  { id: 'evoker', mob: 'evoker', nbt: '' },
  { id: 'vex', mob: 'vex', nbt: '' },
  { id: 'ravager', mob: 'ravager', nbt: '' },
  { id: 'piglin_sword', mob: 'piglin', nbt: H('golden_sword'), equip: [['MAINHAND', 'golden_sword']] },
  { id: 'baby_piglin', mob: 'piglin', nbt: 'IsBaby:1b', baby: true },
  { id: 'piglin_brute_axe', mob: 'piglin_brute', nbt: H('golden_axe'), equip: [['MAINHAND', 'golden_axe']] },
  { id: 'hoglin', mob: 'hoglin', nbt: '' },
  { id: 'baby_hoglin', mob: 'hoglin', nbt: 'Age:-24000', baby: true },
  { id: 'zoglin', mob: 'zoglin', nbt: '' },
  { id: 'blaze', mob: 'blaze', nbt: '' },
  { id: 'slime_1', mob: 'slime', nbt: 'Size:0', size: 1 },
  { id: 'slime_2', mob: 'slime', nbt: 'Size:1', size: 2 },
  { id: 'slime_4', mob: 'slime', nbt: 'Size:3', size: 4 },
  { id: 'magma_cube_2', mob: 'magma_cube', nbt: 'Size:1', size: 2 },
  { id: 'cow', mob: 'cow', nbt: '' },
  { id: 'baby_cow', mob: 'cow', nbt: 'Age:-24000', baby: true },
  { id: 'sheep', mob: 'sheep', nbt: '' },
  { id: 'pig', mob: 'pig', nbt: '' },
  { id: 'chicken', mob: 'chicken', nbt: '' },
  { id: 'rabbit', mob: 'rabbit', nbt: '' },
  { id: 'wolf', mob: 'wolf', nbt: '' },
  { id: 'fox', mob: 'fox', nbt: '' },
  { id: 'horse', mob: 'horse', nbt: '' },
  { id: 'goat', mob: 'goat', nbt: '' },
  { id: 'squid', mob: 'squid', nbt: '' },
  { id: 'cod', mob: 'cod', nbt: '' },
  { id: 'villager', mob: 'villager', nbt: '' },
  { id: 'iron_golem', mob: 'iron_golem', nbt: '' },
  { id: 'snow_golem', mob: 'snow_golem', nbt: '' },
  { id: 'bat', mob: 'bat', nbt: '' },
];
