// geardropscen.mjs — the MOB GEAR DROP referee pack (infra I6, 25 Sept 2026), shared by rungeardrop.mjs (the real 1.18.2 server,
// a growbot survival player killing NoAI zombies with its own Attack packets) and geardroprefcheck.mjs (the engine's kill join).
// What it measures: MobEntity.dropEquipment (.decomp MobEntity.java:842-860) on a PLAYER kill — per slot: the drop roll
// `max(nextFloat() - looting*0.01, 0) < dropChance`, a chance > 1.0 dropping on any death undamaged, a Curse of Vanishing piece
// never dropping, a damageable piece with chance <= 1.0 dropping at a RANDOM damage (maxDamage - nextInt(1 + nextInt(max(maxDamage-3,1)))),
// and the dropped stack keeping its enchantments. The zombie wears (summoned WITH NBT, so no rolled gear):
export const GEAR = [
  { slot: 'mainhand', item: 'iron_sword', chance: 0.02 },
  { slot: 'offhand', item: 'shield', chance: 0.02 },
  { slot: 'feet', item: 'iron_boots', chance: 2.0, ench: [['feather_falling', 4]] },
  { slot: 'legs', item: 'iron_leggings', chance: 1.0 },
  { slot: 'chest', item: 'iron_chestplate', chance: 1.0, ench: [['vanishing_curse', 1]] },
  { slot: 'head', item: 'iron_helmet', chance: 0.02 },
];
export const LANES = { L0: 0, L3: 3 };   // the killer's netherite sword: plain / Looting III
export const KILLS = 800, BATCH = 20;
// the 0.02 pieces (sword, shield, helmet): 3 x KILLS rolls a lane, so Looting III's +0.03 is ~8 sigma; leggings' damage is read (first 10 batches)
// for every kill, the boots' tag for the first batch only (enchantments kept or not is all-or-nothing).
