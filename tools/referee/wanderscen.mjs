// wanderscen.mjs — the IDLE-WANDER referee pack (infra I6, s147, 25 Sept 2026), shared by runwander.mjs (the real 1.18.2 server) and
// wanderrefcheck.mjs (the engine). The question (s146 finding 6, the sheep-grass pack): vanilla's MobEntity.tickNewAi
// (.decomp MobEntity.java:688-693) runs the FULL goalSelector.tick() — the one that evaluates canStart — only on EVEN ticks
// (`age % 2 == 0`; odd ticks tickGoals(false) only tick the running goals), so every random-start goal rolls at HALF the per-tick
// rate its `chance` suggests. WanderAroundGoal (chance 120, WanderAroundFarGoal for most animals) is the cleanest place to see it:
// an animal alone in a pen, persistent (despawnCounter stays 0), no player, no food, no grass (a stone floor) has nothing to do but
// look around and wander. Measured per mob: how many separate walks it starts in T ticks and the tick of the first one.
// The villager is the control: its idle strolls are Brain tasks (VillagerTaskListProvider), not goal-selector goals.
// One stone pen per sample (floor x,z in -R..R, 2-high walls); P pens per mob per rep, all ticking at once; positions logged every
// STEP ticks by a datapack tick function (entry i = after i*STEP world ticks).
export const T = 1200;
export const STEP = 2;
export const R = 6;
export const PITCH = 16;
export const PENS = 6;
export const REPS = 3;
export const MOVE = 0.02;       // blocks per STEP ticks, horizontal: a sample "moving"
export const REST = 3;          // a walk START = moving after >= REST still samples
export const SCEN = [
  { id: 'cow', mob: 'cow' },
  { id: 'pig', mob: 'pig' },
  { id: 'chicken', mob: 'chicken' },
  { id: 'sheep', mob: 'sheep' },
  { id: 'iron_golem', mob: 'iron_golem' },
  { id: 'villager', mob: 'villager', nbt: 'VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}' },
];
/** walks started + first-walk sample index from a [x,y,z] log. */
export function walks(log) {
  let still = REST, n = 0, first = -1;
  for (let i = 1; i < log.length; i++) {
    const d = Math.hypot(log[i][0] - log[i - 1][0], log[i][2] - log[i - 1][2]);
    if (d > MOVE) { if (still >= REST) { n++; if (first < 0) first = i; } still = 0; } else still++;
  }
  return { n, first: first < 0 ? log.length : first };
}
