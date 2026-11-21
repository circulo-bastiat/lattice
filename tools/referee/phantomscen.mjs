// phantomscen.mjs — infra W (25 Sept 2026): PHANTOM referee pack shared scenarios (runphantom.mjs
// -> phantom.json; phantomrefcheck.mjs). Two lanes, ONE growbot each, no walls (a phantom flies —
// only a floor for the bot's feet and forceload matter): the survival bot alone (BARE, "vanilla
// dives and hits it"), and the same bot with a cat standing beside it (CAT, the swoop-abort read
// straight from the decomp: PhantomEntity.java's SwoopMovementGoal.canContinueToUse re-checks
// every 20 ticks (`this.ticksSinceLastCatCheck`, :469-471) whether ANY CatEntity is within the
// mob's own box expanded 16 blocks (:490-493, `getEntitiesByClass(CatEntity.class, ...expand(16.0)`);
// if one is, `catsNearby` latches true and the goal's `canContinueToUse` returns false (:501) —
// the phantom snaps back to CircleMovementGoal (`stop()`, :455-460) instead of ever touching the
// bot. This engine's own port lives in 07zz1_phantom.js's SwoopMovementGoal, same 16-block/20-tick
// numbers, cited in that file's own header.
//
// FLOOR_Y sits well above sea level (63) on purpose: StartAttackGoal.startSwoop's own circling
// height is `target.y + 20 + rand(20)`, clamped up to `seaLevel + 1` only when that lands BELOW
// sea level (.decomp PhantomEntity.java's own StartAttackGoal, mirrored in 07zz1_phantom.js's
// `startSwoop`) — spawning near y=100 keeps every rep clear of that clamp so the circling-height
// numbers below are read straight off the `target.y+20..40` formula, not the sea-level floor.
export const FLOOR_Y = 100;
export const T = 500;      // ticks logged per rep (25 s) -- long enough to see >=1 full swoop cycle
                            // (StartAttackGoal's own cooldown is (8+rand(4))*20 = 160..240 ticks)
export const REPS = 3;
export const R = 6;         // forceload/arena half-size (generous headroom for the swoop dive + circle climb)
export const CAT_DX = 2.5;  // cat stands this far from the bot (well inside the goal's 16-block check)

export const SCEN = [
  { id: 'bare', cat: false },
  { id: 'with_cat', cat: true },
];
