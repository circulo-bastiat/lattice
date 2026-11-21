// sheepgrassscen.mjs — the SHEEP EAT GRASS referee pack (infra W, 25 Sept 2026), shared by runsheepgrass.mjs (the
// real 1.18.2 server) and sheepgrassrefcheck.mjs (the engine's own `Passive.EatGrassGoal`/`Passive.onEatingGrass`,
// src/07w_passive.js).
//
// `EatGrassGoal` (.decomp/net/minecraft/entity/ai/goal/EatGrassGoal.java, read in full): `canStart` rolls
// `nextInt(isBaby() ? 50 : 1000) == 0` once per tick while the goal is not already running, and needs grass (the
// short plant, `minecraft:grass`) AT THE MOB'S FEET or `minecraft:grass_block` one cell below; `start()` sets a
// 40-tick countdown (`MAX_TIMER`); `tick()` counts it down and, on the SAME tick the countdown reaches 4, either
// removes the grass plant (`world.breakBlock`, no drop) or turns the grass_block below into dirt
// (`Blocks.field_10566`) — but ONLY when `gamerule mobGriefing` is true — and calls `mob.onEatingGrass()`
// UNCONDITIONALLY either way (the gamerule gates the block edit, never the callback: .decomp read in full, no
// separate branch). `SheepEntity.onEatingGrass` (.decomp): `setSheared(false)` (wool regrows) and, if the sheep
// is a baby, `growUp(60)` — `PassiveEntity.growUp(60, false)` (.decomp) is `breedingAge += 60*20` (1200 ticks),
// capped at 0, with NO `forcedAge` change (the single-arg overload passes `overGrow=false`).
//
// Because `canStart`'s roll is a per-tick Bernoulli draw (p=1/1000 adult, 1/50 baby), a single sheep's own
// time-to-first-eat is not directly comparable tick-for-tick between the two engines (mobrefattrcheck.mjs's own
// reason for comparing spawn-time ATTRIBUTES as distributions, not a scripted tick series) — so this pack runs a
// large flock per scenario, sealed in one stone corridor so it can neither wander off nor reach another
// scenario's grass, and compares, AT FIXED CHECKPOINTS, the FRACTION that have already eaten (a pooled
// two-proportion z-test, sheepgrassrefcheck.mjs's own comment explains why not a one-sample binomial against the
// golden's own rate, P < 1e-5 fails — the same threshold mobrefattrcheck.mjs and hurtrefcheck.mjs use for a
// per-trial rate). The grass_block -> dirt conversion count and the "never eats on dirt" scenario are exact
// facts (no statistics needed) — 0 tolerance.
//
// Geometry: one ROW per scenario (a distinct Z), a single OPEN 1-wide-by-N-long corridor (x = 1..N, densely
// packed — no per-sheep partition walls), enclosed on all 4 sides by a 3-tall stone box. Both of this pack's own
// readouts are AGGREGATE counts (how many TAGGED sheep have Sheared:0b; how many of the corridor's OWN floor
// cells are dirt) so a sheep wandering a few blocks inside its own sealed corridor changes nothing being
// measured — it can neither reach another scenario's row nor leave the world's ticking area (each scenario gets
// its own small `/forceload add`, well under vanilla's 256-chunk cap per call — see runsheepgrass.mjs's own
// comment for the first run that silently blew a single combined region past that cap). The natural flat world
// already has bedrock/dirt/grass_block at GY=-61 (server.mjs's own `generator-settings`, the SAME layer
// growthscen.mjs's GY names); FEET = GY+1 is where every entity stands. `ground: 'grass_block'` leaves GY as the
// natural grass_block and the feet cell (FEET) empty; `ground: 'dirt'` overwrites GY with dirt (never eats — no
// grass anywhere); `ground: 'grass_plant'` leaves GY as grass_block and places a short `minecraft:grass` plant AT
// the feet cell (the plant is eaten, the grass_block below is untouched — the goal's OTHER branch never runs
// when the plant branch did).
//
// AI ON, no player needed: `runbreed.mjs`'s own MATE pens already proved a real `AnimalMateGoal` runs to
// completion under nothing but `/forceload` (docs/archive/REFEREE.md's FEEDING+BREEDING section) — entity AI ticks with
// a forceloaded chunk the same way redstone/hoppers do; only RANDOM ticks (crops, growthscen.mjs's own doc
// comment) additionally need a player watching the chunk. Sheep AI is ordinary entity tick, not a random tick.
export const GY = -61;          // the flat world's own grass_block layer (server.mjs's generator-settings)
export const FEET = GY + 1;     // every entity's own feet cell — the first open-sky air layer
export const WALL_H = 3;        // FEET..FEET+2, three tall: contains a jumping sheep
export const ROW_SPACING = 6;   // z distance between scenario rows, comfortably clear of each other

// checkpoints (real ticks since the pens were populated) shared by every scenario in a phase, so one
// sleep schedule drives every scenario's reads at once. Baby's own p=1/50 needs the pack of the list; adult's
// p=1/1000 needs the tail.
export const CHECKPOINTS = [50, 100, 150, 200, 300, 400, 500, 600, 700];
export const T = CHECKPOINTS[CHECKPOINTS.length - 1];

// PHASE 1 — mobGriefing true (the default): adult grass_block, adult grass-plant, baby grass_block (+ its
// dirt-floor control, to cancel ordinary tick-driven Age drift from the +1200 growUp boost — the SAME
// fed-minus-control trick breedscen.mjs's own FEED scenes use), and the "never eats on dirt" exact-zero case.
export const PHASE1 = [
  { id: 'adult_grass_block', mob: 'sheep', age: 0, ground: 'grass_block', n: 300, row: 0 },
  { id: 'adult_grass_plant', mob: 'sheep', age: 0, ground: 'grass_plant', n: 200, row: 1 },
  { id: 'baby_grass_block', mob: 'sheep', age: -24000, ground: 'grass_block', n: 150, row: 2 },
  { id: 'baby_control', mob: 'sheep', age: -24000, ground: 'dirt', n: 150, row: 3 },
  { id: 'adult_no_grass', mob: 'sheep', age: 0, ground: 'dirt', n: 100, row: 4 },
];
// PHASE 2 — mobGriefing false: the block edit must NOT happen, but onEatingGrass (wool regrow) still must.
// row:5, never a PHASE1 row number — PHASE1's own sheep are still alive (never killed) when PHASE2 builds its
// row, so reusing a row would rebuild walls/floor around a still-populated PHASE1 corridor.
export const PHASE2 = [
  { id: 'adult_griefing_off', mob: 'sheep', age: 0, ground: 'grass_block', n: 250, row: 5 },
];
export const SCENARIOS = PHASE1.concat(PHASE2);

// scenarios whose ground can be converted grass_block -> dirt (only these get the dirt-count swap-read;
// grass_plant's own block is the plant, not the grass_block below, and dirt-ground scenarios have no grass at all)
export const CONVERTIBLE = new Set(['adult_grass_block', 'baby_grass_block', 'adult_griefing_off']);

export function rowGeometry(s) {
  const z0 = s.row * ROW_SPACING;
  const xMax = s.n; // dense packing (1 cell/x): keeps the whole layout's forceload area well under
  const cellX = (k) => k + 1; // vanilla's own 256-chunk /forceload cap (checked empirically: the 2x-spaced
  return { z0, xMin: 0, xMax, cellX }; // layout this pack shipped with first blew that cap and silently never loaded)
}
