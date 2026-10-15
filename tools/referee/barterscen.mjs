// barterscen.mjs — infra I6 (s138): the PIGLIN BARTER referee pack (runbarter.mjs -> barter.json; barterrefcheck.mjs).
// (a) the table: `loot_tables/gameplay/piglin_bartering` rolled ROLLS times on the real server vs the engine's own
//     hand-copied `Pg.BARTER_TABLE`/`Pg.rollBarter` (07zzf_piglin.js) -- mobreflootcheck lists this table as
//     "unpacked gameplay" and never compares it.
// (b) the live join (QUEUE 0.0 "run its AI for real"): a piglin (NBT form, IsImmuneToZombification so the overworld
//     does not convert it inside the window) and gold ingots summoned as an item entity beside it; per tick the gold
//     left on the ground and the number of OTHER item entities (barter drops). Vanilla loots ONE ingot off a stack
//     (PiglinBrain.getItemFromStack: `split(1)`, PiglinBrain.java:348-358), admires it ADMIRE 120 ticks, then barters.
export const ROLLS = 3000;
export const T = 700;         // ticks logged: 3 ingots x (walk + 120 admire) fit
export const REPS = 3;
export const R = 8;
export const SCEN = [
  { id: 'single', count: 1, dist: 1.5 },
  { id: 'stack3', count: 3, dist: 1.5 },
  // within the piglin's own pickup reach (its box grown 1 block, MobEntity.tickMovement) -- no walk needed, so the
  // admire/one-ingot-at-a-time join is judged even while the engine has no walk-to-wanted-item task
  { id: 'reach1', count: 1, dist: 1.0 },
  { id: 'reach1stack3', count: 3, dist: 1.0 },
  { id: 'walk4', count: 1, dist: 4 },     // it must walk to the ingot (PiglinBrain WalkToNearestVisibleWantedItemTask)
];
