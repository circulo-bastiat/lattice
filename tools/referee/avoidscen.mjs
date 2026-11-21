// avoidscen.mjs — the MOB AVOID/FLEE scenarios (infra W, 25 Sept 2026), shared by runavoid.mjs (the real 1.18.2
// server) and avoidrefcheck.mjs (the engine). Unit: QUEUE 0.0 mob testing, "run its AI for real ... flee": every
// goal that makes one mob move AWAY from another mob or a hostile environment (not the burning-mob PANIC pack,
// panicscen.mjs, and not the hoglin-repellent-block pack, hoglinscen.mjs -- this is the third leg, mob-vs-mob and
// mob-vs-sunlight).
//
// TWO KINDS of pen, both mirroring panicscen.mjs's "one open stone pen, 2-high walls, no water":
//
// kind 'ent' — a FLEER and a THREAT mob, both summoned at a fixed pen (AI on, persistent, no gear -- NBT form).
// The fleer at the pen centre, the threat `dx` blocks along +x from it (dz always 0, R covers the biggest flee
// range in play). Both sides log BOTH mobs' x/y/z every tick for T ticks (entry 0 = the summon tick) -- the
// threat is a real mob with its own AI (it may itself wander), so "distance" is always fleer-to-threat's LIVE
// position, never a fixed point (unlike the hoglin pack's block repellent).
//   vanilla sources (.decomp, each read in full this pass):
//     CreeperEntity.java:71-73 initGoals — `FleeEntityGoal<>(this,OcelotEntity,6F,1.0,1.2)` and the same for
//       CatEntity, both priority 3. Engine: `Ai.ROSTER.creeper` (07k_goals.js:3828) folds both into one
//       `Ai.AvoidEntityGoal(e,6,1.0,fleeThreats,...)` — a real, working goal (not Brain/tickEntity-gated, so it
//       is NOT hit by the `EL.tickOne` early-return dead branch docs/archive/REFEREE.md's HOGLIN REPELLENT section
//       found — creeper's own goal selector runs every tick via `e.ai.tick()`, 07i_entitylist.js:1426).
//     AbstractSkeletonEntity.java:69-72 initGoals — `AvoidSunlightGoal(this)` (2), `EscapeSunlightGoal(this,1.0)`
//       (3) AND `FleeEntityGoal<>(this,WolfEntity,6F,1.0,1.2)` (3). Engine: `Ai.ROSTER.skeleton`
//       (07k_goals.js:3746-3757) has NONE of the three — confirmed by reading the whole function body, no
//       `Ai.AvoidEntityGoal`/sunlight call anywhere in it (`stray` reuses the same roster entry, 07k_goals.js:3905
//       "AbstractSkeletonEntity's three live subclasses"). A finding, not fixed here (fence).
//     WanderingTraderEntity.java:71-77 initGoals — seven `FleeEntityGoal` rows (zombie 8F, evoker 12F,
//       vindicator 8F, vex 8F, pillager 15F, illusioner 12F, zoglin 10F), all (0.5,0.5). Engine:
//       `WT.fleeGoals` (07zt_wtrader.js) builds all seven as `Ai.AvoidEntityGoal` rows off `WT.FLEE_TYPES`,
//       wired into `WT.rosterGoals` as normal goal-selector rows, so they run — a REAL, working flee, unlike hoglin/piglin/blaze/strider's
//       own `tickEntity` dispatch (dead for a rostered mob, same root cause).
//     Villager has no .decomp source in this checkout at all (no VillagerEntity.java under .decomp/); the
//       vanilla fact for the villager_zombie scenes comes from the REFEREE SERVER itself (D-263's own rule:
//       ask the game, don't guess) rather than a decompiled class. Engine: `Ai.ROSTER.villager`
//       (07k_goals.js:4117-4133) adds FloatGoal/stroll/look goals only — its own header comment already names
//       "fleeing danger" as `Ai.OWED` (unwritten), so no flee goal exists for villager at all; a finding.
//     RabbitEntity (rabbit's own registerGoals, not separately decompiled here but read off the engine's own
//       header comment at 07k_goals.js:4577 citing it) — `Ai.ROSTER.rabbit` already calls
//       `Ai.AvoidEntityGoal(e,10,2.2,wolf,...)` (07k_goals.js:4628), a real working goal.
//     FoxEntity.java (.decomp, read in full) initGoals — `FleeEntityGoal<Wolf>(8,1.6,1.4)` among others. Engine:
//       `Ai.ROSTER.fox` (07k_goals.js:4660-4712) calls `Ai.AvoidEntityGoal(e,8,1.6,untamedWolves,avoidAll)` — a
//       real working goal.
export const T = 160;
export const R = 18;             // pen half-size: room for a 16-block fox flee plus its own leash-back slack
export const PITCH = 44;         // pens along z
export const REPS = 3;

// -- kind 'ent' -------------------------------------------------------------------------------
export const ENT = [
  { id: 'creeper_cat_3', mob: 'creeper', threat: 'cat', dx: 3 },
  { id: 'creeper_cat_6', mob: 'creeper', threat: 'cat', dx: 6 },
  { id: 'creeper_cat_9', mob: 'creeper', threat: 'cat', dx: 9 },      // outside the 6-block trigger range
  { id: 'creeper_ocelot_3', mob: 'creeper', threat: 'ocelot', dx: 3 },
  { id: 'creeper_ocelot_6', mob: 'creeper', threat: 'ocelot', dx: 6 },
  { id: 'creeper_ocelot_9', mob: 'creeper', threat: 'ocelot', dx: 9 },
  { id: 'creeper_control', mob: 'creeper', threat: null, dx: 0 },     // no threat: just WaterAvoidingRandomStrollGoal
  { id: 'skeleton_wolf_3', mob: 'skeleton', threat: 'wolf', dx: 3 },
  { id: 'skeleton_wolf_6', mob: 'skeleton', threat: 'wolf', dx: 6 },
  { id: 'stray_wolf_3', mob: 'stray', threat: 'wolf', dx: 3 },
  { id: 'stray_wolf_6', mob: 'stray', threat: 'wolf', dx: 6 },
  { id: 'villager_zombie_4', mob: 'villager', threat: 'zombie', dx: 4 },
  { id: 'villager_zombie_8', mob: 'villager', threat: 'zombie', dx: 8 },
  { id: 'trader_zombie_4', mob: 'wandering_trader', threat: 'zombie', dx: 4 },
  { id: 'trader_zombie_9', mob: 'wandering_trader', threat: 'zombie', dx: 9 },  // outside WT.FLEE_TYPES.zombie's 8
  { id: 'rabbit_wolf_6', mob: 'rabbit', threat: 'wolf', dx: 6 },
  { id: 'fox_wolf_6', mob: 'fox', threat: 'wolf', dx: 6 },
];

// -- kind 'shade' -------------------------------------------------------------------------------
// One pen (own row, own z): a stone floor+walls like every other pen, PLUS a stone roof at y = FLOOR+2 (the
// wall-top height) covering the RIGHT half of the pen (local x in [SHADE_X0, R]) -- a `world.isSkyVisible`-false
// region within EscapeSunlightGoal's own 10-horizontal/6-vertical `locateShadedPos` search box of a mob summoned
// in the OPEN left half (local x = SHADE_SPAWN_X, sky-visible). `Fire:<n>s` at the summon (the same owner-free
// trigger panicscen.mjs's own header already documents from EscapeDangerGoal.isInDanger's sibling check,
// EscapeSunlightGoal.canStart's `isOnFire()` half) plus `time set 6000` (noon, `world.isDay()==true`) for the
// "should flee" case; `time set 18000` (midnight, `isDay()==false`) is the SAME fire, SAME geometry control that
// proves the flee is day-gated, not just "on fire" (the already-covered PANIC pack tests general on-fire flight;
// this pack isolates the sun-specific goal).
export const SHADE_R = 12;
export const SHADE_X0 = 2;          // roofed from here to +SHADE_R (right half)
export const SHADE_SPAWN_X = -8;    // fleer spawns here: open sky, well inside the search box of the roof edge
export const SHADE_FIRE = 200;      // ticks of forced fire (10s, outlives the T-tick window)
// EscapeSunlightGoal.canStart's OWN last clause (.decomp EscapeSunlightGoal.java:36, read above with the rest of
// the class): `!this.mob.getEquippedStack(EquipmentSlot.MAINHAND).isEmpty() ? false : ...` — a skeleton HOLDING
// ITS NATURAL BOW (the default a bare `/summon minecraft:skeleton` gets) never starts this goal at all. Proved
// live this pass: a first golden run with no `HandItems` NBT left the server's own skeleton barely moving (the
// generic stroll goal's own drift, not a real flee) -- `HandItems:[{},{}]` (empty main+offhand) is what a
// disarmed skeleton is, and only a disarmed one ever seeks shade.
export const SHADE = [
  { id: 'skeleton_shade_noon', mob: 'skeleton', time: 6000, nbt: 'HandItems:[{},{}]' },
  { id: 'skeleton_shade_night', mob: 'skeleton', time: 18000, nbt: 'HandItems:[{},{}]' },   // control: same fire, no daylight -> no flee
  { id: 'zombie_shade_noon', mob: 'zombie', time: 6000 },         // control: a species with NO EscapeSunlightGoal at all
];
