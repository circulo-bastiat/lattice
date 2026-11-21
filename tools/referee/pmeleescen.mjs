// pmeleescen.mjs — the PLAYER MELEE referee pack (infra I6, s143, 25 Sept 2026), shared by runpmelee.mjs (the real 1.18.2
// server: a growbot survival PLAYER's own Interact-Entity attack packet) and pmeleerefcheck.mjs (the engine's Combat.attack).
// What it measures: the health a NoAI target loses from ONE full-cooldown player blow — PlayerEntity.attack: the weapon's
// generic.attack_damage (hand 1), Strength/Weakness, EnchantmentHelper.getAttackDamage (Sharpness 0.5*lvl+0.5, Smite/Bane
// 2.5*lvl vs undead/arthropods), the crit x1.5 (falling, not on ground), the sweep (standing full-strength sword blow:
// 1 + Sweeping Edge ratio * damage to a neighbour), then the TARGET's armour (LivingEntity.applyArmorToDamage).
// Each target is summoned WITH NBT (no initialize: no random gear), NoAI, max health 100 so nothing dies, 2 blocks +z of the bot.
export const REPS = 3;
export const PITCH = 6;
const E = (item, ench) => ({ item, ench });
export const SCEN = [
  { id: 'zombie_hand', target: 'zombie', weapon: null },
  { id: 'zombie_wood_sword', target: 'zombie', weapon: E('wooden_sword') },
  { id: 'zombie_iron_sword', target: 'zombie', weapon: E('iron_sword') },
  { id: 'zombie_diamond_sword', target: 'zombie', weapon: E('diamond_sword') },
  { id: 'zombie_netherite_sword', target: 'zombie', weapon: E('netherite_sword') },
  { id: 'zombie_iron_axe', target: 'zombie', weapon: E('iron_axe') },
  { id: 'zombie_diamond_axe', target: 'zombie', weapon: E('diamond_axe') },
  { id: 'zombie_trident', target: 'zombie', weapon: E('trident') },
  { id: 'zombie_iron_pickaxe', target: 'zombie', weapon: E('iron_pickaxe') },
  { id: 'zombie_sharp5', target: 'zombie', weapon: E('diamond_sword', [['sharpness', 5]]) },
  { id: 'zombie_smite5', target: 'zombie', weapon: E('diamond_sword', [['smite', 5]]) },
  { id: 'pig_smite5', target: 'pig', weapon: E('diamond_sword', [['smite', 5]]) },
  { id: 'spider_bane5', target: 'spider', weapon: E('iron_sword', [['bane_of_arthropods', 5]]) },
  { id: 'zombie_bane5', target: 'zombie', weapon: E('iron_sword', [['bane_of_arthropods', 5]]) },
  { id: 'zombie_iron_armored', target: 'zombie', weapon: E('diamond_sword'), targetArmor: 'iron' },
  { id: 'zombie_strength2', target: 'zombie', weapon: E('iron_sword'), effect: ['strength', 1] },
  { id: 'zombie_weakness1', target: 'zombie', weapon: E('iron_sword'), effect: ['weakness', 0] },
  { id: 'zombie_crit_iron', target: 'zombie', weapon: E('iron_sword'), crit: true },
  { id: 'zombie_crit_sharp5', target: 'zombie', weapon: E('diamond_sword', [['sharpness', 5]]), crit: true },
  { id: 'pig_sweep_plain', target: 'pig', weapon: E('diamond_sword'), sweep: true },
  { id: 'pig_sweep_edge3', target: 'pig', weapon: E('diamond_sword', [['sweeping', 3]]), sweep: true },
  { id: 'pig_sweep_axe', target: 'pig', weapon: E('diamond_axe'), sweep: true },
];
export const DZ = 2;          // target 2 blocks +z of the bot's feet
export const SWEEP_DX = 1;    // the neighbour sits 1 block +x of the primary target (inside the 1.0/0.25/1.0 sweep box)
