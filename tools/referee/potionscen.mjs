// potionscen.mjs — the PLAYER POTIONS referee pack (infra W, 25 Sept 2026), a follow-on to the
// PLAYER FOOD pack (foodscen.mjs/runfood.mjs/foodrefcheck.mjs — same growbot, same one-lane
// pattern, same real Use Item packet). Shared by runpotion.mjs (the real 1.18.2 server) and
// potionrefcheck.mjs (the engine's own join: 14l_use.js's Use.rightClick).
//
// Every number below is read off the DECOMPILED jar (.decomp/), never re-derived or guessed:
//
//   PotionItem.java:25,75-77   getMaxUseTime() = 32 (hardcoded, not the unused private
//                              MAX_USE_TIME field) -- UseAction.field_8946 = DRINK (:80-82).
//   MilkBucketItem.java:39-41  getMaxUseTime() = 32, same DRINK UseAction (:44-46).
//   PotionItem.java:36-72      finishUsing(): every StatusEffectInstance on the potion is either
//                              applied instantly (isInstant() -- healing/harming) or added as a
//                              live StatusEffectInstance (:44-50); NOT creative -> decrement 1 and
//                              insert a fresh glass_bottle (Items.field_8469, Items.java:1074)
//                              into the inventory (:53-68); creative -> the stack is returned
//                              UNCHANGED (still the potion, `if ($$3==null || !creativeMode)`
//                              gates the whole bottle-swap block).
//   MilkBucketItem.java:20-36  finishUsing(): decrement 1 (not creative), then unconditionally
//                              `$$2.clearStatusEffects()` (:31-33 -- ALL effects, not just
//                              poison, no `curesPoison`-style single-effect gate the way
//                              HoneyBottleItem only removes POISON) -- returns a fresh
//                              `bucket` (Items.field_8550, Items.java:962) once the stack empties.
//
//   StatusEffects.java (numeric ids, this jar's own registration order, legacy/unrenamed through
//   1.18.2): 1=speed(swiftness) :12-16, 6=instant_health(healing) :44, 7=instant_damage(harming)
//   :45, 10=regeneration :48, 16=night_vision :54, 19=poison :62.
//
//   Potions.java (potion id -> [effect id, duration ticks, amplifier], base StatusEffectInstance
//   ctor args are (type, duration[, amplifier=0])):
//     water            :9   -- Potion() with NO effect instances at all (empty list)
//     night_vision     :13  duration 3600  effect 16 amp 0
//     healing          :46  duration 1     effect 6  amp 0   (INSTANT -- isInstant()==true)
//     harming          :48  duration 1     effect 7  amp 0   (INSTANT)
//     poison           :50  duration 900   effect 19 amp 0
//     strong_poison    :52  duration 432   effect 19 amp 1   ("strong_poison" = poison+amplifier)
//     long_swiftness   :25  duration 9600  effect 1  amp 0   ("long_swiftness" = swiftness+duration)
//
//   StatusEffect.java:68-81 applyInstantEffect(source, attacker, target, amplifier, strength):
//   for id 6 (instant_health) on a non-undead target: heal = (int)(strength*(4<<amplifier)+0.5)
//   -- strength 1.0, amp 0 -> heal 4. For id 7 (instant_damage) on a non-undead target:
//   damage = (int)(strength*(6<<amplifier)+0.5) -- strength 1.0, amp 0 -> 6 damage (DamageSource
//   MAGIC). Neither the growbot nor the real server target is undead, so both potions land on
//   the "normal" branch, not the undead-reversed one (:59-61).
//
//   StatusEffect.java:84-96 canApplyUpdateEffect (poison's own damage cadence, referenced only
//   for context -- this pack does not run poison to its own tick, only checks the applied
//   StatusEffectInstance's id/amplifier/duration right after drinking): poison interval =
//   25>>amplifier, so amp0 ticks every 25 ticks, amp1 (strong_poison) every 12 ticks (25>>1=12).
//
// growbot.mjs's own useItem() note (added for the FOOD pack, additive, dark unless called)
// already anticipated potions/milk needing the DRINK UseAction's 32-tick hold -- reused verbatim
// here, no growbot change needed.
export const SCEN = [
  // ── instant effects (healing/harming) -- StatusEffect.java:68-81 ──────────────────────────
  // healing is measured from a REDUCED starting health (one instant_damage amp0 hit, 6 damage,
  // 20 -> 14) so the +4 heal is a visible, non-capped delta, never a number this file invented --
  // the same real-damage-first technique foodscen.mjs's own starvation scenes use.
  { id: 'drink_healing', kind: 'drink_instant', potion: 'healing', useTicks: 32, preHits: 1,
    instantType: 'heal', amount: 4, reps: 3 },
  { id: 'drink_harming', kind: 'drink_instant', potion: 'harming', useTicks: 32, preHits: 0,
    instantType: 'damage', amount: 6, reps: 3 },
  // ── live status effects -- Potions.java, id/duration/amplifier straight off the registration ──
  { id: 'drink_regeneration', kind: 'drink_effect', potion: 'regeneration', useTicks: 32,
    effect: { id: 10, duration: 900, amp: 0 }, reps: 3 },
  { id: 'drink_poison', kind: 'drink_effect', potion: 'poison', useTicks: 32,
    effect: { id: 19, duration: 900, amp: 0 }, reps: 3 },
  { id: 'drink_strong_poison', kind: 'drink_effect', potion: 'strong_poison', useTicks: 32,
    effect: { id: 19, duration: 432, amp: 1 }, reps: 3 },
  { id: 'drink_long_swiftness', kind: 'drink_effect', potion: 'long_swiftness', useTicks: 32,
    effect: { id: 1, duration: 9600, amp: 0 }, reps: 3 },
  { id: 'drink_night_vision', kind: 'drink_effect', potion: 'night_vision', useTicks: 32,
    effect: { id: 16, duration: 3600, amp: 0 }, reps: 3 },
  // ── water bottle -- Potions.java:9, Potion() with an EMPTY effect list: still runs the whole
  // finishUsing bottle-swap (nothing in that method is gated on the effect list being non-empty),
  // so this is the pack's own "no effect, but still drunk" control.
  { id: 'drink_water', kind: 'drink_empty', potion: 'water', useTicks: 32, reps: 3 },
  // ── creative keeps the potion -- PotionItem.java:53-68's own `!creativeMode` gate ────────────
  { id: 'drink_water_creative', kind: 'drink_creative', potion: 'water', useTicks: 32, reps: 3 },
  // ── milk cures (ALL effects, not just poison) -- MilkBucketItem.java:31-33 ───────────────────
  { id: 'drink_milk_while_poisoned', kind: 'drink_milk', useTicks: 32, reps: 3 },
];
