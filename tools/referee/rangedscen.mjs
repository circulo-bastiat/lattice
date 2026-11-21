// rangedscen.mjs — the MOB RANGED (mob-shoots-player) referee pack's scenarios (infra I6, s148, 25 Sept 2026),
// shared by runranged.mjs (the real 1.18.2 server) and rangedrefcheck.mjs (the engine).
// One ranged mob, summoned BARE (so MobEntity.initialize gives it its bow/crossbow, SummonCommand.java:90), DIST blocks
// from a still survival player in a 3-wide walled stone lane, AI on, night, for T ticks. Recorded: the tick of every
// projectile the mob looses (a fresh arrow entity), and every health drop on the player (Resistance IV keeps it alive).
// Vanilla (.decomp): BowAttackGoal(attackInterval = hard 20 / else 40, AbstractSkeletonEntity.updateAttackType) draws
// the bow 20 ticks then waits the interval; CrossbowAttackGoal charges (CrossbowItem.getPullTime 25) then waits
// 20 + nextInt(20) ticks CHARGED before it fires (CrossbowAttackGoal.java:111-119); stray arrows carry Slowness 600 ticks (StrayEntity.createArrowProjectile).
export const T = 400;
export const REPS = 3;
export const DIST = 10;          // blocks between the player and the mob along the lane
export const PITCH = 8;          // lane spacing
export const Y = -59;            // server.mjs flat preset's grass top (same as meleescen)
export const SCENES = [
  { id: 'skeleton@normal', mob: 'skeleton', diff: 'normal', effect: null },
  { id: 'skeleton@hard', mob: 'skeleton', diff: 'hard', effect: null },
  { id: 'skeleton@easy', mob: 'skeleton', diff: 'easy', effect: null },
  { id: 'stray@normal', mob: 'stray', diff: 'normal', effect: 'slowness' },
  { id: 'stray@hard', mob: 'stray', diff: 'hard', effect: 'slowness' },
  { id: 'pillager@normal', mob: 'pillager', diff: 'normal', effect: null },
  { id: 'pillager@hard', mob: 'pillager', diff: 'hard', effect: null },
];
export const DIFFS = ['easy', 'normal', 'hard'];
export const EFFECT_RAWID = { slowness: 2 };
/** Summary of one log: shots = projectile spawn ticks, hits = [tick, lost]. */
export function summarize(shots, hits) {
  const iv = []; for (let i = 1; i < shots.length; i++) iv.push(shots[i] - shots[i - 1]);
  const s = iv.slice().sort((a, b) => a - b);
  return { nShots: shots.length, first: shots.length ? shots[0] : null, medInterval: s.length ? s[s.length >> 1] : null, nHits: hits.length };
}
