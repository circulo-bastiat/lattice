// effectscen.mjs — the STATUS EFFECT referee pack's scenarios (infra I6, s142, 25 Sept 2026), shared by runeffect.mjs (the
// real 1.18.2 server) and effectrefcheck.mjs (the engine). What it measures: StatusEffectInstance.update's cadence
// (StatusEffect.canApplyUpdateEffect: regeneration every 50>>amp ticks, poison 25>>amp, wither 40>>amp), what each tick does
// (poison stops at 1 health, wither does not; heal/damage 1), who refuses what (LivingEntity.canHaveStatusEffect: undead ->
// no regeneration/poison, spiders -> no poison, wither skeleton -> no wither), the instant effects (6<<amp damage / 4<<amp
// heal, swapped for undead), and the damage path those ticks take (magic/wither bypass armour but NOT Protection or
// Resistance). Each scenario: a NoAI mob (summoned WITH NBT: no initialize) at `hp`, optional armour/Resistance NBT, then
// `/effect give <effect> <secs> <amp>` (addStatusEffect -> canHaveStatusEffect, the player-facing path; an ActiveEffects NBT
// tag would bypass that gate), then its Health every tick for T ticks.
export const REPS = 2;
export const PITCH = 6;
export const T = 230;
const DIA_P4 = 'ArmorItems:[{id:"minecraft:diamond_boots",Count:1b,tag:{Enchantments:[{id:"minecraft:protection",lvl:4s}]}},{id:"minecraft:diamond_leggings",Count:1b,tag:{Enchantments:[{id:"minecraft:protection",lvl:4s}]}},{id:"minecraft:diamond_chestplate",Count:1b,tag:{Enchantments:[{id:"minecraft:protection",lvl:4s}]}},{id:"minecraft:diamond_helmet",Count:1b,tag:{Enchantments:[{id:"minecraft:protection",lvl:4s}]}}],ArmorDropChances:[0f,0f,0f,0f]';
export const SCEN = [
  { id: 'pig_poison1', mob: 'pig', hp: 10, eff: 'poison', secs: 10, amp: 0 },
  { id: 'pig_poison2', mob: 'pig', hp: 10, eff: 'poison', secs: 10, amp: 1 },
  { id: 'pig_poison3_floor', mob: 'pig', hp: 4, eff: 'poison', secs: 10, amp: 2 },
  { id: 'zombie_poison', mob: 'zombie', hp: 20, eff: 'poison', secs: 10, amp: 1 },
  { id: 'spider_poison', mob: 'spider', hp: 16, eff: 'poison', secs: 10, amp: 1 },
  { id: 'pig_wither1', mob: 'pig', hp: 10, eff: 'wither', secs: 10, amp: 0 },
  { id: 'pig_wither2', mob: 'pig', hp: 10, eff: 'wither', secs: 10, amp: 1 },
  { id: 'skeleton_wither3', mob: 'skeleton', hp: 20, eff: 'wither', secs: 10, amp: 2 },
  { id: 'witherskel_wither', mob: 'wither_skeleton', hp: 20, eff: 'wither', secs: 10, amp: 1 },
  { id: 'zombie_dia_p4_wither2', mob: 'zombie', hp: 20, eff: 'wither', secs: 10, amp: 1, nbt: DIA_P4 },
  { id: 'skeleton_resist2_wither2', mob: 'skeleton', hp: 20, eff: 'wither', secs: 10, amp: 1, nbt: 'ActiveEffects:[{Id:11b,Amplifier:1b,Duration:100000,ShowParticles:0b}]' },
  { id: 'pig_regen1', mob: 'pig', hp: 3, eff: 'regeneration', secs: 10, amp: 0 },
  { id: 'pig_regen2', mob: 'pig', hp: 3, eff: 'regeneration', secs: 10, amp: 1 },
  { id: 'cow_regen3_cap', mob: 'cow', hp: 6, eff: 'regeneration', secs: 10, amp: 2 },
  { id: 'zombie_regen', mob: 'zombie', hp: 5, eff: 'regeneration', secs: 10, amp: 1 },
  { id: 'pig_instant_damage1', mob: 'pig', hp: 10, eff: 'instant_damage', secs: 1, amp: 0 },
  { id: 'pig_instant_health1', mob: 'pig', hp: 3, eff: 'instant_health', secs: 1, amp: 0 },
  { id: 'zombie_instant_damage2', mob: 'zombie', hp: 5, eff: 'instant_damage', secs: 1, amp: 1 },
  { id: 'zombie_instant_health1', mob: 'zombie', hp: 20, eff: 'instant_health', secs: 1, amp: 0 },
  { id: 'zombie_dia_p4_instant_health1', mob: 'zombie', hp: 20, eff: 'instant_health', secs: 1, amp: 0, nbt: DIA_P4 },
];
// The per-tick health log -> what is judged: the list of distinct health steps (value after each change, in order), the
// final health, and the tick gaps between consecutive changes (the first change's absolute tick depends on where in the
// server tick the /effect command landed, so only the GAPS are exact).
export function summarize(series, hp) {
  if (hp !== undefined) series = [hp].concat(series);   // the summoned health is the baseline on both sides
  const steps = [], at = [];
  for (let i = 1; i < series.length; i++) if (Math.abs(series[i] - series[i - 1]) > 1e-6) { steps.push(series[i]); at.push(i); }
  const gaps = at.slice(1).map((t, i) => t - at[i]);
  return { steps, gaps, final: series.length ? series[series.length - 1] : -1, first: at.length ? at[0] : -1, len: series.length };
}
