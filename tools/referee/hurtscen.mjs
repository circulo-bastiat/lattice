// hurtscen.mjs — the HURT-PANIC scenarios (infra I6, s137, 25 Sept 2026), shared by runhurt.mjs (the real 1.18.2 server)
// and hurtrefcheck.mjs (the engine). QUEUE 0.0 (Dan: "run its AI for real ... flee, speed in blocks/s"). The sibling
// panic pack (panicscen.mjs) triggers EscapeDangerGoal with FIRE; this one with a REAL PLAYER HIT: the growbot stands at
// the pen's centre facing +x and punches (bare hand, the exact Interact-attack packet a client sends) the mob summoned
// OFFSET blocks east of it. vanilla: `EscapeDangerGoal.isInDanger` = `getAttacker() != null || ...`
// (.decomp EscapeDangerGoal.java:47-48); `getAttacker()` holds the player for 100 ticks after the hit
// (LivingEntity.tickMovement/`lastAttackedTime`), and each time the mob's path ends it re-picks
// `NoPenaltyTargeting.find(mob, 5, 4)` — a random spot, not "away from the hurter".
// Both sides log x/y/z every tick for T ticks from the hit tick (entry 0 = the tick the hit landed).
export const T = 140;
export const R = 11;           // the pen's half-size (stone floor, 2-high stone wall, no water)
export const OFFSET = 1.5;     // the mob's summon x, east of the bot (bot at the pen centre, 0.5/0.5)
export const REPS = 3;
export const SKIP = 12;        // the first ticks after the hit are knockback, not panic: stats start here
export const WINDOW = 100;     // ... and end at the 100-tick attacker memory
export const SCEN = [
  { id: 'cow', mob: 'cow' },
  { id: 'mooshroom', mob: 'mooshroom' },
  { id: 'pig', mob: 'pig' },
  { id: 'sheep', mob: 'sheep' },
  { id: 'chicken', mob: 'chicken' },
  { id: 'rabbit', mob: 'rabbit' },
  { id: 'horse', mob: 'horse' },
  { id: 'donkey', mob: 'donkey' },
  { id: 'turtle', mob: 'turtle' },
  { id: 'goat', mob: 'goat' },
];
