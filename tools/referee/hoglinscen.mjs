// hoglinscen.mjs — the HOGLIN REPELLENT scenarios (infra W, 25 Sept 2026), shared by runhoglin.mjs (the real 1.18.2
// server) and hoglinrefcheck.mjs (the engine). Unit: "HOGLIN REPELLENT" — hoglins avoiding `#minecraft:hoglin_repellents`
// (.decomp BlockTags.java `field_22466` = warped_fungus, potted_warped_fungus, nether_portal, respawn_anchor).
// vanilla: HoglinSpecificSensor.findNearestWarpedFungus = `BlockPos.findClosest(pos, 8, 4, ...)` (8 blocks across, 4
// up/down, PER-AXIS — not a Euclidean radius: .decomp HoglinSpecificSensor.java:60). HoglinBrain.addIdleTasks:
// `PacifyTask(NEAREST_REPELLENT, 200)` then `GoToRememberedPositionTask.toBlock(NEAREST_REPELLENT, 1.0F, 8, true)`
// (.decomp HoglinBrain.java:78,80) — flee AWAY from the remembered block at speed 1.0, only while within 8 (this
// task's own OWN range check, independent of the search box). Runs in the IDLE activity only (also listed for FIGHT's
// PacifyTask, but `toBlock` itself is idle-only), so a hoglin mid-FIGHT is not made to flee a repellent by this task.
//
// One PEN per scenario: a stone floor (x,z in -R..R) with 2-high stone walls around it (mirrors panicscen.mjs) so a
// fleeing hoglin cannot wander off the measured area. The hoglin (or baby) is summoned at the pen centre; the
// repellent block (if any) is placed at (dx, dy) from the summon's block position. Both sides log the mob's x/y/z
// every tick for T ticks (entry 0 = the summon tick).
export const T = 200;
export const R = 16;             // pen half-size: room for a distance-9 repellent plus an 8-block flee
export const PITCH = 40;         // pens along z
export const REPS = 2;           // "run the server 2x to see the spread" -- also this pack's variance sample

// dx/dy are offsets from the hoglin's SPAWN BLOCK position (floor(x)/floor(y)/floor(z)); dz is always 0 (the
// distance-3/7/8/9 and vertical-4/5 cases only ever move along one axis, so a per-axis box's edge is unambiguous).
export const SCEN = [
  // The search box is PER-AXIS 8 across: dx=8 is the last block INSIDE it, dx=9 the first block OUTSIDE (comment
  // above HoglinSpecificSensor.findNearestWarpedFungus). dx=3 and dx=7 are two more "clearly inside" points.
  { id: 'dist3', mob: 'hoglin', repellent: 'minecraft:warped_fungus', dx: 3, dy: 0 },
  { id: 'dist7', mob: 'hoglin', repellent: 'minecraft:warped_fungus', dx: 7, dy: 0 },
  { id: 'dist8', mob: 'hoglin', repellent: 'minecraft:warped_fungus', dx: 8, dy: 0 },
  { id: 'dist9', mob: 'hoglin', repellent: 'minecraft:warped_fungus', dx: 9, dy: 0 },
  // The vertical half of the same box: 4 up/down is inside, 5 is outside.
  { id: 'vert4', mob: 'hoglin', repellent: 'minecraft:warped_fungus', dx: 0, dy: 4 },
  { id: 'vert5', mob: 'hoglin', repellent: 'minecraft:warped_fungus', dx: 0, dy: 5 },
  // The other three `hoglin_repellents` members, all well inside the box.
  { id: 'respawn_anchor', mob: 'hoglin', repellent: 'minecraft:respawn_anchor[charges=4]', dx: 5, dy: 0 },
  { id: 'nether_portal', mob: 'hoglin', repellent: 'minecraft:nether_portal[axis=x]', dx: 5, dy: 0 },
  { id: 'potted_fungus', mob: 'hoglin', repellent: 'minecraft:potted_warped_fungus', dx: 5, dy: 0 },
  // A baby: the repellent-flee task is not adult-gated (unlike the piglin-backoff / walk-to-adult tasks).
  { id: 'baby', mob: 'hoglin', nbt: 'IsBaby:1b', repellent: 'minecraft:warped_fungus', dx: 5, dy: 0 },
  // Control: no repellent anywhere in the pen -- a lone hoglin just strolls (WaterAvoidingRandomStrollGoal).
  { id: 'control', mob: 'hoglin', repellent: null, dx: 0, dy: 0 },
];
