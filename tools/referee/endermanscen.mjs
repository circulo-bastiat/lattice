// endermanscen.mjs — infra I6 (s150+w): the ENDERMAN BEHAVIOUR referee pack's lanes, shared by
// runenderman.mjs (the real 1.18.2 server) and endermanrefcheck.mjs (the engine).
// .decomp/net/minecraft/entity/mob/EndermanEntity.java (read in full already by src/07zg_enderman.js's
// own header) drives every constant below; nothing here is a guess.
//
// FIVE zones, one flat glass world, no player connected (every pen forceloaded, ticks with
// nobody nearby — same trick runitems.mjs already uses). One continuous server timeline:
//   t=0        : mobGriefing FALSE, summon the G-zone (griefing-off control)
//   t=G_CHECK  : read G-zone (expect 0 picks), THEN flip mobGriefing TRUE and summon P/PL/WT/AR
//   t=G_CHECK+*: the other four zones' own checkpoints (all relative offsets below)
//
// Real ticks driving the two RATE zones (P, PL), read off Goal.java (.decomp, toGoalTicks —
// MathHelper.ceilDiv($$0, 2), a PLAIN halving with NO difficulty/getTickCount scale in front of
// it) and EndermanEntity's own PickUpBlockGoal/PlaceBlockGoal .canStart():
//   PickUpBlockGoal.canStart (:449) -- random.nextInt(toGoalTicks(20))  == nextInt(10)==0/tick
//   PlaceBlockGoal.canStart  (:490) -- random.nextInt(toGoalTicks(2000))== nextInt(1000)==0/tick
// 07zg_enderman.js's own Enderman.PICKUP_CHANCE=20 / PLACE_CHANCE=2000 constants (cited to those
// SAME two lines) are the RAW jar arguments to toGoalTicks -- the halving itself never happens
// anywhere in that file (PickUpBlockGoal.canUse/PlaceBlockGoal.canUse below both call
// `rint(Enderman.PICKUP_CHANCE)`/`rint(Enderman.PLACE_CHANCE)` directly). If that is a real
// engine bug, the server's measured mean tick-to-event will read HALF the engine's simulated one.
export const FLOOR_Y = 4;

function grid(n, pitch) {
  const cols = Math.ceil(Math.sqrt(n));
  const out = [];
  for (let i = 0; i < n; i++) out.push({ cx: (i % cols) * pitch, cz: Math.floor(i / cols) * pitch });
  return out;
}

// ── zone G: mobGriefing FALSE control (PickUpBlockGoal must never fire) ─────────────────────
export const G_N = 15;
export const G_PITCH = 6;
export const G_BASE_Z = 0;
export const G_CHECK = 200;    // ticks from world start
export const G_LANES = grid(G_N, G_PITCH).map((p, k) => ({ id: k, x: p.cx, z: G_BASE_Z + p.cz }));

// ── zone P: PICK-UP rate, mobGriefing TRUE, persistent enderman on a sealed dirt-floored pen
// (`enderman_holdable`, BlockTags.field_15460 -- dirt IS in it, .decomp BlockTags.java) ────────
export const P_N = 30;
export const P_PITCH = 6;
export const P_BASE_Z = 40;
export const PU_START = 200;         // absolute tick mobGriefing flips true + these are summoned
export const PU_CHECKS = [5, 10, 20, 40, 80, 160, 320];   // relative to PU_START
export const P_LANES = grid(P_N, P_PITCH).map((p, k) => ({ id: k, x: p.cx, z: P_BASE_Z + p.cz }));

// ── zone PL: PLACE rate, mobGriefing TRUE, summoned ALREADY carrying dirt (CarriedBlockState),
// sealed pen floored with STONE (solid, full-cube, not TNT, NOT enderman_holdable -- so a
// placed-then-re-picked block cannot silently re-arm the goal and corrupt the "still carrying"
// read) ──────────────────────────────────────────────────────────────────────────────────────
export const PL_N = 24;
export const PL_PITCH = 6;
export const PL_BASE_Z = 90;
export const PL_CHECKS = [100, 300, 600, 1200, 2000, 3000];   // relative to PU_START
export const PL_LANES = grid(PL_N, PL_PITCH).map((p, k) => ({ id: k, x: p.cx, z: PL_BASE_Z + p.cz }));

// ── zone WT: water damage + escape-teleport (Enderman.applyWaterDamage, hurtByWater's own
// 1.0F DROWN hit, damage()'s generic "not a LivingEntity attacker: 9/10 chance teleport" escape
// -- applyWaterDamage's own header names this as the ONE damage()-branch this engine DOES model
// outside 14j_combat.js's own generic hook) ─────────────────────────────────────────────────
export const WT_N = 20;
export const WT_PITCH = 6;
export const WT_BASE_Z = 140;
export const WT_CHECKS = [1, 3, 5, 10, 20];   // relative to PU_START
export const WT_LANES = grid(WT_N, WT_PITCH).map((p, k) => ({ id: k, x: p.cx, z: WT_BASE_Z + p.cz }));

// ── zone AR: projectile dodge (EndermanEntity.damage() override, .decomp:351-379 -- ANY
// ProjectileDamageSource: 64 attempts at teleportRandomly, `super.damage` (the real health hit)
// is NEVER even called unless every one of the 64 fails; this engine's damage() override does
// not exist at all -- Enderman.OWED's own first line names the gap) ────────────────────────────
export const AR_N = 20;
export const AR_PITCH = 6;
export const AR_BASE_Z = 180;
export const AR_CHECKS = [3, 8];   // relative to PU_START
export const AR_LANES = grid(AR_N, AR_PITCH).map((p, k) => ({ id: k, x: p.cx, z: AR_BASE_Z + p.cz }));

export const MAX_X = Math.max(
  ...P_LANES.map((l) => l.x), ...G_LANES.map((l) => l.x), ...PL_LANES.map((l) => l.x),
  ...WT_LANES.map((l) => l.x), ...AR_LANES.map((l) => l.x),
) + 20;
export const MAX_Z = Math.max(
  ...P_LANES.map((l) => l.z), ...G_LANES.map((l) => l.z), ...PL_LANES.map((l) => l.z),
  ...WT_LANES.map((l) => l.z), ...AR_LANES.map((l) => l.z),
) + 20;
