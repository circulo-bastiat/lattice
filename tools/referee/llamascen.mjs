// llamascen.mjs — the LLAMA referee pack's scenarios (infra W-llama, 25 Sept 2026): llama spit vs wolves, and
// wolves avoiding llamas. Shared by runllama.mjs (the real 1.18.2 server) and llamarefcheck.mjs (the engine).
//
// Vanilla facts (.decomp, each class read in full this pass):
//   LlamaEntity.java initGoals — goalSelector 3: `ProjectileAttackGoal(this, 1.25, 40, 20.0F)` fires a
//   `llama_spit` at whatever `e.target` the TARGET selector set. targetSelector 1: `SpitRevengeGoal` (a
//   `RevengeGoal` whose own `shouldContinue()` override drops the target the instant `LlamaEntity.setSpit(true)`
//   actually fires — one retaliation cycle per hit, then it re-arms on the next hit). targetSelector 2:
//   `ChaseWolvesGoal` — `ActiveTargetGoal<WolfEntity>(this, WolfEntity.class, 16, false, true,
//   wolf -> !wolf.isTamed())`, `getFollowRange()` overridden to the mob's own `generic.follow_range` attribute
//   (40, assets/entities.json attrs.llama.follow) times a flat 0.25 -> a 10-block target-acquire range; the `16`
//   is `ActiveTargetGoal`'s own `reciprocalChance` (`toGoalTicks(16)`), a `random.nextInt(16) != 0` gate on every
//   `canStart()` attempt the jar's `TrackTargetGoal` retries every tick while idle -- so on the SERVER a llama
//   only rolls to notice a nearby wolf on ~1/16 of ticks, not every tick.
//   WolfEntity.java initGoals — priority 3: `AvoidLlamaGoal<LlamaEntity>` extends `FleeEntityGoal`(24F, 1.5, 1.5).
//   `canStart()`: only while `!wolf.isTamed()` AND `isScaredOf(llama)`, where `isScaredOf` is
//   `llama.getStrength() >= wolf.random.nextInt(5)` (0..4) -- Strength 5 always wins (5>=4 every roll), Strength 1
//   only wins on a 0 or 1 roll (2/5). This is a SEPARATE goal/range from ChaseWolvesGoal: `FleeEntityGoal`'s own
//   `canStart()` scans a flat 24-block box regardless of whether the llama's `ChaseWolvesGoal` ever targets the
//   wolf back -- a wolf standing OUTSIDE the llama's 10-block chase range can still flee it.
//   `TameableEntity.readCustomDataFromNbt`: `containsUuid("Owner")` alone sets `setTamed(true)` -- taming a wolf
//   for scene 2 needs only an `Owner` NBT tag, no separate `Tame` byte.
export const T = 300;
export const REPS = 3;
export const R = 16;            // pen half-size (stone floor + 2-high walls): covers AvoidLlamaGoal's 24-block
                                 // scan box with slack for the wolf's own flee-path wobble
export const PITCH = 40;        // pens along z
export const FOLLOW_MULT = 0.25;      // ChaseWolvesGoal.getFollowRange()'s own multiplier
export const LLAMA_FOLLOW = 40;       // assets/entities.json attrs.llama.follow -- so 10-block chase range
export const WOLF_HP = 40;      // both sides: generic.max_health raised so a real 1.0-dmg spit can't kill the
                                 // wolf mid-run and cut the position log short (task cares whether it's HIT, not
                                 // whether it survives 8 real HP of pecking)

// -- kind 'ent': a wild llama (fixed Strength) + a wild wolf a few blocks away --------------------------------
export const WILD = [
  { id: 'wild_s1_dx4', strength: 1, dx: 4 },      // inside ChaseWolves' 10b range; low Strength -> flee is a coin flip
  { id: 'wild_s3_dx4', strength: 3, dx: 4 },
  { id: 'wild_s5_dx4', strength: 5, dx: 4 },      // max Strength -> AvoidLlamaGoal should ~always win its roll
  { id: 'wild_s5_dx12', strength: 5, dx: 12 },    // OUTSIDE the 10-block chase range: llama shouldn't target/spit,
                                                   // but AvoidLlamaGoal's own 24-block box still covers this dx
];
// -- kind 'tamed': same numbers as wild_s5_dx4, Owner set -- neither goal should ever fire on a tamed wolf -----
export const TAMED = [
  { id: 'tamed_s5_dx4', strength: 5, dx: 4, tamed: true },
];
export const ENT = WILD.concat(TAMED);

// -- kind 'retaliate': a llama hit once by the player -- SpitRevengeGoal should send a spit back ----------------
export const RETALIATE = [
  { id: 'retaliate', dist: 2 },       // player 2 blocks away (pmeleescen.mjs's own DZ: inside attack reach)
];

const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
/** shots: sorted list of ticks each llama_spit was first seen -> count/first/median inter-spit gap. */
export function spitSummary(shots) {
  const ticks = shots.slice().sort((a, b) => a - b);
  const gaps = []; for (let i = 1; i < ticks.length; i++) gaps.push(ticks[i] - ticks[i - 1]);
  return { n: ticks.length, first: ticks.length ? ticks[0] : null, medCycle: med(gaps) };
}
export { med };
