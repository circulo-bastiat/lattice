// equipdropscen.mjs — the SPAWN-TIME EQUIPMENT DROP pack (#7865), shared by runequipdrop.mjs (the real 1.18.2 server) and
// mobdropsproofcheck.mjs (the engine). Per armed mob: a plain `/summon` (NBT-less, so the server runs the mob's own
// `initialize` -> initEquipment / updateEnchantments), then a growbot survival player kills it with an Attack packet:
// MobEntity.dropEquipment (.decomp MobEntity.java:842-860) drops each worn piece with chance 0.085 (1.0 for pickup-lootable,
// > 1.0 on any death), damageable pieces at random wear, per mob and slot. Only EQUIPMENT item ids are counted.
export const MOBS = ['zombie', 'husk', 'drowned', 'skeleton', 'stray', 'piglin', 'piglin_brute', 'zombified_piglin',
  'wither_skeleton', 'pillager', 'vindicator', 'vex', 'evoker'];
export const KILLS = 4000, BATCH = 20;
const GEAR_RE = /_(helmet|chestplate|leggings|boots|sword|axe|shovel|pickaxe|hoe)$|^(bow|crossbow|trident|fishing_rod|shield|nautilus_shell|white_banner|carved_pumpkin|jack_o_lantern|turtle_helmet)$/;
export const isGear = (id) => GEAR_RE.test(id);
