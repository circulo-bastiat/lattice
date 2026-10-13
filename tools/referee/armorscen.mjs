// armorscen.mjs — the ARMOR referee pack's scenarios (infra I6, 25 Sept 2026), shared by runarmor.mjs (the real 1.18.2
// server) and armorrefcheck.mjs (the engine). What it measures: the damage a mob keeps from ONE arrow hit, through
// LivingEntity.applyArmorToDamage (armour points + toughness, DamageUtil.getDamageLeft), the Resistance effect, and
// applyEnchantmentsToDamage (EnchantmentHelper.getProtectionAmount -> DamageUtil.getInflictedDamage: every worn piece's
// ProtectionEnchantment.getProtectionAmount FOR THIS SOURCE — protection = lvl, projectile_protection = 2*lvl on a
// projectile, fire/blast = 0 on an arrow). Plus the arrow's own damage int: PersistentProjectileEntity.onEntityHit =
// ceil(|velocity| * damage) at the moment of the hit (v = 2.01 is chosen so a velocity already damped by drag reads 4 not 5).
// Each scenario: a NoAI target (summoned WITH NBT, so no MobEntity.initialize: no random gear, no leader bonus) standing on
// stone; an owner-less arrow summoned 2 blocks in front of it, flying +z at `v` with NBT damage `d`; Health before/after.
export const REPS = 2;
export const PITCH = 8;
const P = (item, ench) => `{id:"minecraft:${item}",Count:1b${ench ? `,tag:{Enchantments:[${ench.map(([id, l]) => `{id:"minecraft:${id}",lvl:${l}s}`).join(',')}]}` : ''}}`;
// ArmorItems order is feet, legs, chest, head.
const SET = (mat, ench) => [`${mat}_boots`, `${mat}_leggings`, `${mat}_chestplate`, `${mat}_helmet`].map((it) => ({ item: it, ench }));
export const SCEN = [
  { id: 'skel_bare_v3', mob: 'skeleton', v: 3, d: 2, armor: [] },
  { id: 'skel_bare_v201', mob: 'skeleton', v: 2.01, d: 2, armor: [] },
  { id: 'skel_leather', mob: 'skeleton', v: 3, d: 2, armor: SET('leather') },
  { id: 'skel_iron', mob: 'skeleton', v: 3, d: 2, armor: SET('iron') },
  { id: 'skel_diamond_d2', mob: 'skeleton', v: 3, d: 2, armor: SET('diamond') },
  { id: 'skel_diamond_d6', mob: 'skeleton', v: 3, d: 6, armor: SET('diamond') },
  { id: 'skel_netherite_d6', mob: 'skeleton', v: 3, d: 6, armor: SET('netherite') },
  { id: 'skel_chest_prot4', mob: 'skeleton', v: 3, d: 2, armor: [{ slot: 2, item: 'diamond_chestplate', ench: [['protection', 4]] }] },
  { id: 'skel_iron_projprot4', mob: 'skeleton', v: 3, d: 2, armor: SET('iron', [['projectile_protection', 4]]) },
  { id: 'skel_boots_projprot2', mob: 'skeleton', v: 3, d: 2, armor: [{ slot: 0, item: 'iron_boots', ench: [['projectile_protection', 2]] }] },
  { id: 'skel_iron_fireprot4', mob: 'skeleton', v: 3, d: 2, armor: SET('iron', [['fire_protection', 4]]) },
  { id: 'skel_chest_blast4', mob: 'skeleton', v: 3, d: 2, armor: [{ slot: 2, item: 'iron_chestplate', ench: [['blast_protection', 4]] }] },
  { id: 'skel_resist1', mob: 'skeleton', v: 3, d: 2, armor: [], resist: 0 },
  { id: 'skel_resist3', mob: 'skeleton', v: 3, d: 2, armor: [], resist: 2 },
  { id: 'skel_diamond_prot4_resist2', mob: 'skeleton', v: 3, d: 4, armor: SET('diamond', [['protection', 4]]), resist: 1 },
  { id: 'skel_gold_mixed', mob: 'skeleton', v: 3, d: 3, armor: [{ slot: 0, item: 'golden_boots', ench: [['projectile_protection', 4]] }, { slot: 3, item: 'golden_helmet', ench: [['protection', 3]] }] },
  { id: 'zombie_bare_v3', mob: 'zombie', v: 3, d: 2, armor: [] },
  { id: 'zombie_iron_d5', mob: 'zombie', v: 3, d: 5, armor: SET('iron') },
  { id: 'zombie_bare_d3', mob: 'zombie', v: 3, d: 3, armor: [] },
];
// fill slots for SET() entries (index order = feet, legs, chest, head)
for (const s of SCEN) s.armor = s.armor.map((a, i) => ({ slot: a.slot !== undefined ? a.slot : i, item: a.item, ench: a.ench || null }));
export function armorNbt(s) {
  const slots = ['{}', '{}', '{}', '{}'];
  for (const a of s.armor) slots[a.slot] = P(a.item, a.ench);
  return `ArmorItems:[${slots.join(',')}],ArmorDropChances:[0f,0f,0f,0f]`;
}
export const HIT_Y = 1.0;    // the arrow flies this far above the target's feet
export const START_DZ = -2;  // and starts this far in front (z) of the target's centre
export const T = 20;         // ticks between the arrow and the second Health read
