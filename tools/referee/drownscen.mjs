// drownscen.mjs — the MOB DROWNING / AIR SUPPLY referee pack (infra W, drown unit, 25 Sept 2026), shared by
// rundrown.mjs (the real 1.18.2 server) and drownrefcheck.mjs (the engine). Vanilla facts, .decomp read whole:
// `Entity.baseTick`'s own generic air/drowning step lives in `LivingEntity.baseTick` (.decomp/net/minecraft/entity/
// LivingEntity.java:328-390) and applies to EVERY LivingEntity, not just the player — `if (isSubmergedIn(WATER) &&
// !canBreatheInWater() && !hasWaterBreathing) { setAir(getNextAirUnderwater(air)); if (air==-20) { setAir(0);
// damage(DROWN, 2.0F); } } else if (air < getMaxAir()) setAir(getNextAirOnLand(air))`. `getNextAirUnderwater`
// (:584-587) is `air - 1` (Respiration gives a `random.nextInt(level+1) > 0` free tick instead). `Entity.getMaxAir`
// (Entity.java:2067) defaults 300 (15 s); `Entity.getAir`/`setAir` (:2071-2077) is the NBT short `Air`
// (Entity.java:1450/1538). `DolphinEntity` (.decomp/passive/DolphinEntity.java:90/192) overrides
// `canBreatheInWater()` false and `getMaxAir()` 4800 — a dolphin drowns exactly like a land mob, just with 4x the
// air (240 s) and its `getNextAirOnLand` snaps straight back to the max rather than +4/tick (:196-198).
// `TurtleEntity.canBreatheInWater()` (.decomp/passive/TurtleEntity.java:204) is true — the generic step never
// drains its air at all, so a submerged turtle should show a flat Air series (breathes long). `WaterCreatureEntity`
// (squid, cod/fish family) overrides `canBreatheInWater()` true too but keeps its OWN separate `tickWaterBreathingAir`
// counter (300/-20/2.0, the SAME numbers, .decomp/mob/WaterCreatureEntity.java + FishEntity.java) that drains OUT of
// water instead — the scenario here is the OOW (out-of-water) mirror image of the land-mob test: a fish-family mob
// or squid placed on dry stone. `AxolotlEntity` (.decomp/passive/AxolotlEntity.java:180-209) is the same shape again
// but with its own 6000-tick (300 s) air and a DRYOUT damage source, not DROWN.
// Harness fact (found reading .decomp, not guessed): `LivingEntity.readCustomDataFromNbt` (:702-703) loads
// `ActiveEffects` straight into the effect list with no `canHaveStatusEffect` gate — that gate (:924/941) only fires
// on the RUNTIME `addStatusEffect` call, so a `/summon ... {ActiveEffects:[...]}` bypasses it; this pack instead uses
// a real `/effect give` for the Water Breathing scenario so the golden reflects the normal runtime path, not the
// NBT bypass.
// Each scenario: an AI-on mob (NBT summon, PersistenceRequired) in a 1x1 glass pen — floor under the feet, `at`
// in the feet cell, `head` in the cell above, and (when `lid` is set) a sealing block over the head so a submerged
// mob cannot climb out and break the water column. Both Health and the NBT short `Air` are logged every tick.
export const REPS = 2;
export const PITCH = 5;
export const T = 500;          // 25 s -- land-mob air (300, 15 s) empties and the first DROWN hit lands well inside it
export const SCEN = [
  // ── land mobs, fully submerged (water at feet AND head, glass lid so they cannot surface) ──
  { id: 'pig_submerged', mob: 'pig', floor: 'stone', at: 'water', head: 'water', lid: 'glass' },
  { id: 'cow_submerged', mob: 'cow', floor: 'stone', at: 'water', head: 'water', lid: 'glass' },
  // zombie: run long enough to watch the pre-conversion window (in-water ~30 s then a further
  // ~15 s countdown, Undead.CONVERT_TARGET/tickWaterConversion) -- conversion itself is out of
  // scope here (covered elsewhere); this scenario only logs Health/Air through that window.
  { id: 'zombie_submerged', mob: 'zombie', floor: 'stone', at: 'water', head: 'water', lid: 'glass', t: 1000 },
  { id: 'skeleton_submerged', mob: 'skeleton', floor: 'stone', at: 'water', head: 'water', lid: 'glass' },
  // ── water mobs, OUT of water on dry stone (the OOW mirror: WaterCreatureEntity/fish air) ──
  { id: 'squid_dry', mob: 'squid', floor: 'stone' },
  { id: 'cod_dry', mob: 'cod', floor: 'stone' },
  { id: 'axolotl_dry', mob: 'axolotl', floor: 'stone' },
  // ── amphibious / aquatic controls ──
  { id: 'turtle_submerged', mob: 'turtle', floor: 'stone', at: 'water', head: 'water', lid: 'glass' },
  { id: 'dolphin_submerged', mob: 'dolphin', floor: 'stone', at: 'water', head: 'water', lid: 'glass' },
  // ── pig controls: no head water (shallow, should not drown), and Respiration-free (the base
  // pig_submerged case above already has no enchant, so it doubles as that control), and Water
  // Breathing (a real /effect give, not NBT ActiveEffects -- see header) ──
  { id: 'pig_feet_only', mob: 'pig', floor: 'stone', at: 'water' },
  { id: 'pig_water_breathing', mob: 'pig', floor: 'stone', at: 'water', head: 'water', lid: 'glass', effect: 'water_breathing' },
];
