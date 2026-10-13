// itemscen.mjs — the ITEMS referee pack's scenarios (infra I6, 25 Sept 2026): ITEM ENTITIES +
// EXPERIENCE ORBS, shared by runitems.mjs (the real 1.18.2 server) and itemrefcheck.mjs (the
// engine). Every lane is a 3x3 stone pad at (X, FLOOR_Y, 0), X = k * PITCH (>=4 blocks apart, no
// lane can see another's merge/pickup box), forceloaded so it ticks with no player connected.
// All items are /summon'ed with Motion:[0.0d,0.0d,0.0d] on the pad (y = FLOOR_Y+1, resting on the
// block below) unless a lane says otherwise. Nothing here owns a merge/despawn/gravity NUMBER —
// those are read off the real server (golden) and off the engine's own constants
// (EL.ITEM_MERGE_BOX / EL.ITEM_LIFETIME / EL.ITEM_MERGE_MOVED/RESTING, src/07i_entitylist.js; Xp.DESPAWN_AGE
// / Xp.MERGE_BOX, src/07zz_xporb.js) — never a literal copied out of this file.
//
// Vanilla facts driving the lane shapes (.decomp/net/minecraft/entity/ItemEntity.java):
//  - tryMerge fires every tick where `age % (floorCellChanged ? 2 : 40) == 0` (lines ~127-133) —
//    a STATIONARY item (our default) only gets checked on the 40-tick cycle, not every 2 ticks.
//  - canMerge() requires stack.getCount() < stack.getMaxCount() (a full stack never merges) and
//    itemAge < 6000 (a despawning-this-tick item does not merge).
//  - canMerge(stackA, stackB) requires the SAME item AND `hasNbt() XOR hasNbt()` false and equal
//    NBT when both have it — a custom-named stack and a plain stack of the same item have
//    different NBT and do NOT merge.
//  - tryMerge gates on the STATIC `ItemStack.canMerge(a, b)`, which refuses the merge outright
//    when `a.count + b.count > a.getMaxCount()` — confirmed on the real server: two 40-stacks of
//    cobblestone (max 64) 0.3 apart, given 80 ticks, stay {40, 40}, and 10+10 ender_pearl (max
//    16) stays {10, 10}. There is no partial top-off in this code path — the `merge()` helper's
//    min() formula only ever runs once `canMerge` has already guaranteed the sum fits.
//  - `Age` NBT round-trips to `itemAge` (writeCustomDataToNbt/readCustomDataFromNbt); itemAge
//    increments every tick except when it is exactly -32768 (NEVER_DESPAWN_AGE, permanently
//    skipped); the entity discards the tick itemAge reaches 6000.
// (.decomp/net/minecraft/entity/ExperienceOrbEntity.java): DESPAWN_AGE = 6000 same rule on
// `orbAge`/`Age`; /summon does NOT call the survival spawn-time merge (`wasMergedIntoExistingOrb`
// only runs from `ExperienceOrbEntity.spawn`, never from `/summon`), so same-tick /summon'ed orbs
// only fold together later, through the ticking `mergeNear` (checked every 20 ticks off
// `expensiveUpdate`, MERGE_BOX 0.5) — never instantly.
export const FLOOR_Y = 4;
// ⚠ KEEP THE WHOLE LAYOUT UNDER ~280 BLOCKS FROM SPAWN. Empirically (this pack's own boundary
// probe, not a documented vanilla limit): `/forceload query` reports a chunk as marked past
// that, but entities placed there do not actually get ticked -- `execute if entity` on a tag
// summoned at x=320 (chunk 20) reads "not found" one tick after summon, while the identical
// setup at x=300 (chunk 18) ticks correctly. 17 lanes * 12 = a 192-block span, comfortably
// inside the chunk-18 boundary that tested reliable.
export const PITCH = 12;

// ---------------------------------------------------------------------------------------------
// A. MERGE BY DISTANCE — pairs of identical 8-cobblestone stacks at a horizontal or vertical gap.
// Checkpoints at +5 and +40 ticks deliberately straddle the 40-tick "stationary" merge cycle
// above: a lane that merges by +5 disagrees with a stationary-item reading of the decompile.
export const MERGE_DIST_TICKS = [5, 40];
export const MERGE_DIST = [
  { id: 'distH_0.3', axis: 'x', gap: 0.3 },
  { id: 'distH_0.6', axis: 'x', gap: 0.6 },
  { id: 'distH_0.9', axis: 'x', gap: 0.9 },
  { id: 'distH_1.2', axis: 'x', gap: 1.2 },
  { id: 'distV_0.4', axis: 'y', gap: 0.4 },
].map((l, k) => ({ ...l, x: k * PITCH, item: 'cobblestone', count: 8 }));

// ---------------------------------------------------------------------------------------------
// B. MERGE LIMITS — read at +80 ticks (two full 40-tick stationary cycles: any lane that CAN
// merge has had the chance to by then).
export const MERGE_LIMIT_TICKS = 80;
export const MERGE_LIMIT = [
  { id: 'cap_cobblestone', item: 'cobblestone', a: 40, b: 40, sameNbt: true },
  { id: 'cap_ender_pearl', item: 'ender_pearl', a: 10, b: 10, sameNbt: true },
  { id: 'diff_items', item: 'cobblestone', item2: 'stone', a: 8, b: 8, sameNbt: true },
  { id: 'named_vs_plain', item: 'cobblestone', a: 8, b: 8, nameB: 'Bob' },
].map((l, k) => ({ ...l, x: (MERGE_DIST.length + k) * PITCH }));

// ---------------------------------------------------------------------------------------------
// C. ITEM DESPAWN — one item per lane, no merge partner. Age:5990/5900 despawn 10/100 ticks after
// summon (itemAge reaches 6000 that tick); Age:-32768 (NEVER_DESPAWN_AGE) never increments.
export const DESPAWN_TICKS = [5, 15, 120];
export const ITEM_DESPAWN = [
  { id: 'age_5990', age: 5990 },
  { id: 'age_5900', age: 5900 },
  { id: 'age_never', age: -32768 },
].map((l, k) => ({ ...l, x: (MERGE_DIST.length + MERGE_LIMIT.length + k) * PITCH, item: 'cobblestone', count: 1 }));

// ---------------------------------------------------------------------------------------------
// D. ITEM FALL — one item, 10 blocks above the pad, zero motion; y traced every tick 1..40.
export const FALL_X = (MERGE_DIST.length + MERGE_LIMIT.length + ITEM_DESPAWN.length) * PITCH;
export const FALL_HEIGHT = 10;
export const FALL_TICKS = 40;

// ---------------------------------------------------------------------------------------------
// E. XP ORBS — /summon'ed (not survival-spawned, so no spawn-time merge; see header).
export const XP_TICKS = [20, 60];
export const XP_DESPAWN_TICKS = [5, 15];
const XP_BASE_X = FALL_X + PITCH;
export const XP_SAME = { id: 'orbs_same', x: XP_BASE_X, values: [3, 3, 3, 3, 3] };
export const XP_MIXED = { id: 'orbs_mixed', x: XP_BASE_X + PITCH, values: [3, 3, 7, 7, 7] };
export const XP_DESPAWN = [
  { id: 'orb_age_5990', age: 5990 },
  { id: 'orb_age_5900', age: 5900 },
].map((l, k) => ({ ...l, x: XP_BASE_X + PITCH * (2 + k), value: 5 }));

export const ALL_X = [...MERGE_DIST, ...MERGE_LIMIT, ...ITEM_DESPAWN, { x: FALL_X }, XP_SAME, XP_MIXED, ...XP_DESPAWN].map((l) => l.x);
export const MAX_X = Math.max(...ALL_X);
