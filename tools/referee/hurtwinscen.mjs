// hurtwinscen.mjs — infra I6 (s149): the HURT-WINDOW pack's scenes, shared by runhurtwin.mjs (the
// real 1.18.2 server) and hurtwinrefcheck.mjs (the engine). Each scene is a list of instant_damage
// hits [tickOffset, amplifier] (6 << amp magic damage: 6 / 12), landed on BOTH a survival player
// (Survival.hurt's path) and a NoAI iron golem (Combat.hurt's path) at the same offsets.
// The question (1700Z finding 5): LivingEntity.damage's in-window branch (.decomp LivingEntity.java
// :1059-1069) — `timeUntilRegen > 10` → excess-only, `lastDamageTaken = amount` (the FULL new
// amount), no window reset; otherwise a fresh hit.
export const REPS = 3;
export const SETTLE = 25;   // ticks after the last hit before Health is read
export const SCENES = [
  { id: 'one',       hits: [[0, 0]] },                         // baseline 6
  { id: 'inc2',      hits: [[0, 0], [2, 1]] },                 // 6 then 12 in-window → excess 6
  { id: 'inc2eq',    hits: [[0, 0], [2, 1], [4, 1]] },         // 3rd equal to the 2nd: lastDamageTaken must be 12, not 6
  { id: 'eq5',       hits: [[0, 0], [5, 0]] },                 // equal in-window → refused
  { id: 'inc5',      hits: [[0, 0], [5, 1]] },
  { id: 'inc9',      hits: [[0, 0], [9, 1]] },                 // the window's edge, both sides
  { id: 'inc10',     hits: [[0, 0], [10, 1]] },
  { id: 'inc11',     hits: [[0, 0], [11, 1]] },
  { id: 'inc15',     hits: [[0, 0], [15, 1]] },                // past half the window
  { id: 'dec15',     hits: [[0, 1], [15, 0]] },                // a smaller hit past half the window
  { id: 'dec5',      hits: [[0, 1], [5, 0]] },                 // a smaller hit inside it → refused
  { id: 'eq25',      hits: [[0, 0], [25, 0]] },                // window long closed
];
