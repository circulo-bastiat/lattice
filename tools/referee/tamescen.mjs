// tamescen.mjs — the TAMING referee pack (infra I6, s143, 25 Sept 2026), shared by runtame.mjs (the real 1.18.2 server: a
// growbot survival player's own right-click, Interact Entity type 0) and tamerefcheck.mjs (the engine's Use.entityUse, the join
// a right-click on a mob takes). Per scene: N fresh wild mobs (NBT-form summon, NoAI), ONE right-click each with the item held,
// then: how many are now owned (the `Owner` UUID tag), how many items were used, how many mobs are still alive.
// WolfEntity.interactMob (bone, 1/3), CatEntity.interactMob (cod/salmon, 1/3), ParrotEntity.interactMob (a taming seed, 1/10;
// a cookie poisons and kills it, tamed or not). The item is consumed on every attempt outside creative.
export const BATCH = 20;
export const BATCHES = 15;          // 300 attempts per scene
export const SCEN = [
  { id: 'wolf_bone', mob: 'wolf', item: 'bone' },
  { id: 'wolf_rotten_flesh', mob: 'wolf', item: 'rotten_flesh' },
  { id: 'cat_cod', mob: 'cat', item: 'cod' },
  { id: 'cat_salmon', mob: 'cat', item: 'salmon' },
  { id: 'parrot_wheat_seeds', mob: 'parrot', item: 'wheat_seeds' },
  { id: 'parrot_beetroot_seeds', mob: 'parrot', item: 'beetroot_seeds' },
  { id: 'parrot_cookie', mob: 'parrot', item: 'cookie' },
];
