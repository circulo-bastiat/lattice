// foodscen.mjs — the PLAYER FOOD + STARVATION referee pack (infra W, 25 Sept 2026), a follow-on to
// the PLAYER HUNGER pack (hungerscen.mjs/runhunger.mjs/hungerrefcheck.mjs — same patterns, same
// growbot). Shared by runfood.mjs (the real 1.18.2 server) and foodrefcheck.mjs (the engine's own
// join: 14l_use.js's Use.rightClick, and Survival.eat/tick — src/14d_survival.js).
//
// Every number below is `FoodComponents.java` (.decomp/net/minecraft/item/FoodComponents.java),
// read in full, NOT re-derived or guessed:
//   bread            hunger 5  saturationModifier 0.6
//   cooked_beef      hunger 8  saturationModifier 0.8
//   golden_carrot    hunger 6  saturationModifier 1.2
//   cookie           hunger 2  saturationModifier 0.1
//   beetroot_soup    hunger 6  saturationModifier 0.6  (createStew(6)) — SoupItem returns a bowl
//   honey_bottle     hunger 6  saturationModifier 0.1  — HoneyBottleItem.finishUsing returns a
//                    glass_bottle AND unconditionally `removeStatusEffect(POISON)` (.decomp
//                    HoneyBottleItem.java:29-31) — verified below, the pack's own "cures poison" case
//   chicken (raw)    hunger 2  saturationModifier 0.3  + HUNGER (id 17), 600 ticks, amplifier 0, 30%
//   rotten_flesh     hunger 4  saturationModifier 0.1  + HUNGER (id 17), 600 ticks, amplifier 0, 80%
//   golden_apple     hunger 4  saturationModifier 1.2  + REGENERATION (id 10) 100t/amp1 100% AND
//                    ABSORPTION (id 22) 2400t/amp0 100% — both unconditional (StatusEffectInstance
//                    chance argument is 1.0F for both), so ONE eat is enough to assert them, no z-test
//   spider_eye       hunger 2  saturationModifier 0.8  + POISON (id 19) 100 ticks amplifier 0, 100%
// Status effect ids (numeric `ActiveEffects[].Id`, this jar's own NBT — legacy ids, unrenamed until
// well past 1.18.2): 10=regeneration, 17=hunger, 19=poison, 22=absorption
// (.decomp/net/minecraft/entity/effect/StatusEffects.java: `register(10,"regeneration",...)`,
// `register(17,"hunger",...)`, `register(19,"poison",...)`, `register(22,"absorption",...)`).
//
// `useTicks` — `Item.getMaxUseTime` (.decomp Item.java:251-254): 32 for ordinary food (the class's
// own `field_30888` constant), EXCEPT `HoneyBottleItem.getMaxUseTime` which overrides it to 40
// (.decomp HoneyBottleItem.java, `MAX_USE_TIME = 40`) — a real client holds a honey bottle a quarter
// second longer than a loaf of bread, and a runner that waited only 32 ticks for it would read the
// item BEFORE the server's own `LivingEntity.tickActiveItemStack` finished the use.
//
// STARVATION — `HungerManager.update`'s own starvation branch (.decomp HungerManager.java:62-70,
// quoted in full in docs/archive/REFEREE.md's own PLAYER FOOD section): food<=0, foodTickTimer counts to 80,
// then ONE point of damage IF `health > 10 || hard || (health > 1 && normal)` — so EASY stops
// damaging once health reaches 10 (the `health > 10` clause alone, since EASY matches neither of the
// other two ORs), NORMAL stops once health reaches 1, and HARD never stops (kills). The four
// scenarios below each pin down one edge of that formula with a starting health chosen so the
// EXPECTED post-state is a single number, not a range: 'starve_cadence' just counts damage EVENTS
// (every 80 ticks, from full health, well above every floor) to nail the 80-tick period itself.
export const SCEN = [
  { id: 'eat_bread', kind: 'eat', item: 'bread', nutrition: 5, saturationModifier: 0.6, useTicks: 32 },
  { id: 'eat_cooked_beef', kind: 'eat', item: 'cooked_beef', nutrition: 8, saturationModifier: 0.8, useTicks: 32 },
  { id: 'eat_golden_carrot', kind: 'eat', item: 'golden_carrot', nutrition: 6, saturationModifier: 1.2, useTicks: 32 },
  { id: 'eat_cookie', kind: 'eat', item: 'cookie', nutrition: 2, saturationModifier: 0.1, useTicks: 32 },
  { id: 'eat_beetroot_soup', kind: 'eat_container', item: 'beetroot_soup', nutrition: 6, saturationModifier: 0.6,
    useTicks: 32, container: 'bowl' },
  { id: 'eat_honey_bottle', kind: 'eat_container', item: 'honey_bottle', nutrition: 6, saturationModifier: 0.1,
    useTicks: 40, container: 'glass_bottle', curesPoison: true },
  { id: 'eat_raw_chicken', kind: 'eat_stat', item: 'chicken', nutrition: 2, saturationModifier: 0.3, useTicks: 32,
    effectId: 17, effectDuration: 600, effectAmp: 0, prob: 0.3, reps: 15 },
  { id: 'eat_rotten_flesh', kind: 'eat_stat', item: 'rotten_flesh', nutrition: 4, saturationModifier: 0.1, useTicks: 32,
    effectId: 17, effectDuration: 600, effectAmp: 0, prob: 0.8, reps: 15 },
  { id: 'eat_golden_apple', kind: 'eat_effects', item: 'golden_apple', nutrition: 4, saturationModifier: 1.2, useTicks: 32,
    effects: [{ id: 10, duration: 100, amp: 1 }, { id: 22, duration: 2400, amp: 0 }] },
  { id: 'eat_spider_eye', kind: 'eat_effects', item: 'spider_eye', nutrition: 2, saturationModifier: 0.8, useTicks: 32,
    effects: [{ id: 19, duration: 100, amp: 0 }] },
  // starvation — run LAST, and CHAIN (starvation damage never heals, so each scene starts from
  // whatever health the one before it left the bot at -- reached with real damage, never assumed):
  // 'starve_cadence' drains food to 0 with ONE big sprint burn (the only one -- food stays at 0 for
  // every scene after it, so nothing needs to burn twice) and just watches the 80-tick cadence from
  // near-full health; 'starve_easy_floor' rides that same descent down onto the EASY floor (10) and
  // confirms it holds; 'starve_normal_floor' lands one accelerating hit then rides the NORMAL floor
  // (1) the same way; 'starve_hard_kills' needs no hit at all -- from ~1 hp, HARD's very next
  // 80-tick cycle kills it outright (the difficulty gate never stops on HARD).
  { id: 'starve_cadence', kind: 'starve', difficulty: 'normal', burn: true, hits: 0, waitTicks: 240 },
  { id: 'starve_easy_floor', kind: 'starve', difficulty: 'easy', burn: false, hits: 0, waitTicks: 560 },
  { id: 'starve_normal_floor', kind: 'starve', difficulty: 'normal', burn: false, hits: 1, waitTicks: 320 },
  { id: 'starve_hard_kills', kind: 'starve', difficulty: 'hard', burn: false, hits: 0, waitTicks: 160 },
];
