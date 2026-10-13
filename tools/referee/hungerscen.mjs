// hungerscen.mjs — the PLAYER HUNGER / EXHAUSTION referee pack (infra W, 25 Sept 2026), shared by
// runhunger.mjs (the real 1.18.2 server: ONE growbot survival player) and hungerrefcheck.mjs (the
// engine's own join: 14d_survival.js's Survival.jumped/movement/hurt/tick/eat, driven the same way
// 14_player.js drives them — see src/14_player.js:515-526,874).
//
// What it measures, straight out of HungerManager.java / PlayerEntity.java (.decomp):
//   'jump'   — PlayerEntity.jump(): 0.05 still, 0.2 sprinting (:1400-1407, hand-sourced nowhere —
//              read off the override itself).
//   'move'   — PlayerEntity.increaseTravelMotionStats (:1462-1500): centimetres, rate*cm*0.01 per
//              block. Sprinting on the ground is 0.1/block; DRY walking (not sprinting, not
//              sneaking) is a LITERAL `0.0F` — vanilla charges nothing for it. Swimming/touching
//              water/submerged are all the same `0.01F * cm * 0.01F` = 0.01/block.
//   'attack' — PlayerEntity.attackEntity: this.addExhaustion(0.1F), but only once the hit landed
//              (:1421, after the `if ($$0 instanceof LivingEntity)` branch — the `else` branch,
//              a miss, never reaches it).
//   'regen'  — HungerManager.update (:34-74): FAST regen (food==20, saturation>0, hurt) heals
//              min(saturation,6)/6 every 10 ticks and charges that much exhaustion back; SLOW
//              regen (food>=18, hurt) heals 1 every 80 ticks for 6.0 exhaustion. Driven here by
//              denting the bot with `effect give ... instant_damage` (DamageSource.magic — no
//              armour, no knockback) so food/saturation are untouched by the hit itself.
//   'add'    — HungerManager.eat->add (:21-30): food=min(n+food,20), saturation=min(sat+n*m*2,food).
//              ⚠ NOT fed via a real Use Item packet: this protocol's serverbound Play packet ids past
//              Interact Entity/Keep Alive/Player Position (the three growbot already had verified) are
//              NOT in .decomp (Mojang's mappings don't cover network registration IDs) and 0x2E, the
//              one candidate tried, does not decode as Use Item on this jar (an empirical disconnect,
//              logged) — so it is NOT shipped in growbot.mjs. `add()` is driven instead through
//              `minecraft:saturation`, a REAL status effect confirmed empirically against this same
//              jar (see runhunger.mjs's smoke check) to call `HungerManager.add(amplifier+1, 1.0F)` —
//              the exact function every food's `eat()` delegates to, just with saturationModifier
//              fixed at 1.0 rather than a specific food's (bread 0.6, cooked beef 0.8). `nutrition`
//              below is still bread's/cooked beef's own hunger-point count (5 and 8), so the two
//              scenes still exercise `add()`'s TWO different clamps: unclamped-by-20 vs the
//              saturation ceiling being the FOOD level, not 20 (the ⚠ two comments up already flags).
//              A real per-item saturationModifier remains untested — see docs/archive/REFEREE.md's own note.
//
// Every 'jump'/'move'/'attack' scene stays well under HungerManager's own 4.0-exhaustion spend
// threshold (EX_SPRINT*dist, EX_JUMP, ATTACK_EXHAUSTION are all <1.0 here), so the server's own
// per-tick "spend 4.0, lose a saturation/food point" pass never fires mid-scene and a plain
// before/after exhaustion DELTA is exact — no partial-spend accounting needed for those three.
// 'regen' and 'eat' instead replay the server's own recorded PRE-state through the engine (the
// golden records it), because their whole point is what a multi-tick spend/regen pass does.

export const REPS = 2;
export const FLOOR = -60;                 // world Y of the walkable stone floor's top
export const DRY_DIST = 5;                // 'move' scenes: blocks covered (well under the spend line)

export const SCEN = [
  { id: 'jump_still', kind: 'jump', sprint: false },
  { id: 'jump_sprint', kind: 'jump', sprint: true },
  { id: 'walk_dry', kind: 'move', mode: 'walk', dist: DRY_DIST },
  { id: 'sprint_dry', kind: 'move', mode: 'sprint', dist: DRY_DIST },
  { id: 'swim_water', kind: 'move', mode: 'swim', dist: DRY_DIST },
  { id: 'attack_zombie', kind: 'attack', target: 'zombie' },
  { id: 'regen_fast', kind: 'regen', damage: 6, ticks: 10 },
  { id: 'add_bread_nutrition', kind: 'add', nutrition: 5, burnBlocks: 400 },       // bread's own hunger points
  { id: 'add_beef_nutrition', kind: 'add', nutrition: 8, burnBlocks: 400 },        // cooked beef's own hunger points
];
