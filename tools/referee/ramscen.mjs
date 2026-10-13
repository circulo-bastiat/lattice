// ramscen.mjs — infra I6 (s138): the GOAT RAM referee pack's scenarios (runram.mjs -> ram.json; ramrefcheck.mjs).
// Why: hurtrefcheck's goat "moves 13.5 b/s, ~1 block from the bot" (infra 0600Z finding 5) is the RAM, not the hurt:
// `/summon` WITH NBT skips `GoatEntity.initialize` (SummonCommand.java:89-90), the only place a fresh goat gets its
// `ram_cooldown_ticks` memory (GoatBrain.resetLongJumpCooldown, GoatBrain.java:58-61; GoatEntity.java:203), so a
// summoned-with-NBT goat is ram-ready at once. This pack uses that ON PURPOSE to referee the ram itself: prepare
// (PrepareRamTask), charge (RamImpactTask speed 3.0), impact knockback on a real player (the bot's own velocity packet).
// The engine side mirrors it by zeroing `e.ramCooldown` (07zj_goat.js `Gt.RamGoal`). Every lane: goat EAST of the bot.
export const R = 10;          // pen half-width (the lane search of PrepareRamTask needs room on every side)
export const T = 200;         // ticks logged from the logger start (RamImpactTask RUN_TIME is 200)
export const REPS = 3;
export const SCEN = [
  { id: 'adult_d5', mob: 'goat', dist: 5, nbt: '' },
  { id: 'adult_d7', mob: 'goat', dist: 7, nbt: '' },
  // beyond 7: vanilla takes ANY visible attackable target (VISIBLE_MOBS, PrepareRamTask.java:64-69) and walks to a
  // lane start 4..7 blocks from IT (findRamStart, :117-146); the [4,7] is the lane length, not a target-distance gate
  { id: 'adult_d9', mob: 'goat', dist: 9, nbt: '' },
  { id: 'baby_d5', mob: 'goat', dist: 5, nbt: 'Age:-24000', baby: true },
  { id: 'screaming_d5', mob: 'goat', dist: 5, nbt: 'IsScreaming:1b', screaming: true },
  // both directions (rule 6): RAM_TARGET_PREDICATE is TargetPredicate.createAttackable() -- a creative player is NOT a target
  { id: 'creative_d5', mob: 'goat', dist: 5, nbt: '', creative: true },
];
export const CHARGE = 0.4;    // blocks/tick: above any walk (1.25 x 0.2 attr) -- the charge (3.0 x 0.2 attr) only
export const KNOCK = 0.3;     // blocks/tick: a bot velocity packet this big horizontally = the ram landed
