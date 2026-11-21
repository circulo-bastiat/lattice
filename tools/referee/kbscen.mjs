// kbscen.mjs — the KNOCKBACK referee pack's scenarios (infra W, 25 Sept 2026), shared by runkb.mjs
// (the real 1.18.2 server) and kbrefcheck.mjs (the engine). D-685 fixed "nothing takes knockback"
// (Cb.knockback / Cb.baseKnockback, src/14j_combat.js). This pack proves the fix is EXACT, both
// directions:
//   (A) mob hits bot   -- the velocity the server SENDS the bot right after the hit (Set Entity
//       Velocity, protocol 758 play 0x4F, captured by growbot.mjs), vs `Cb.mobAttack(mob, M.Player)`.
//   (B) bot hits mob    -- the mob's own Motion NBT the tick after the hit, vs the engine's
//       `Cb.attack(P, mob)` (src/14j_combat.js:718).
//
// Direction/yaw: the bot always faces the mob (D-327 -- vanilla yaw 0 = south, this engine's yaw
// 0 = north; runkb.mjs sends the REAL server a `tp ... <yaw> 0` in VANILLA yaw, kbrefcheck.mjs sets
// `P.yaw`/`e.yaw` in ENGINE yaw for the SAME facing -- see each file's own header).

export const REPS = 3;
export const T_TICKS = 10;          // ticks to wait after the hit before reading the result (A: poll
                                     // for the velocity packet; B: `data get` on the mob's Motion)
export const OFFSET = 1.5;          // fixed +x offset between bot and mob, so direction is known
// server.mjs's own flat preset: bedrock 1 + dirt 2 + grass 1 from y -64 -> solid top surface at
// y=-61, so a standing entity's FEET are at y=-60 (verified empirically: `execute if block 0 -61 0
// air` fails, `-60` passes -- meleescen.mjs's own Y=-59 is one block ABOVE the ground, harmless for
// a health check but NOT for this pack: this bot must actually rest ON the ground for its own
// `onGround` to go true, or the vertical knockback clamp's on-ground branch never fires).
export const Y = -60;

// ── (A) mob hits bot ────────────────────────────────────────────────────────────────────────────
// Bot armour: 'none' and 'netherite' (knockback_resistance 0.1/piece -- `IT.knockbackOf`,
// src/02g_items.js:175 -- 4 pieces sums to 0.4 in BOTH vanilla, generic.knockback_resistance
// attribute modifiers, and the engine's own `Sv.updateArmor`, src/14d_survival.js:161).
export const BOT_ARMOR_TIERS = ['none', 'netherite'];
export const BOT_ARMOR = { none: [], netherite: ['netherite_boots', 'netherite_leggings', 'netherite_chestplate', 'netherite_helmet'] };

// Each attacker: `mob` (shared vanilla+engine id), `nbt` (summon NBT, empty-handed unless noted),
// `special` names the mob's own non-`ATTACK_KNOCKBACK` push path (iron_golem's own vertical throw,
// hoglin/zoglin's randomised push) -- not a guess, a DECOMP fact named in runkb.mjs/kbrefcheck.mjs's
// own headers. Part C (infra W, 25 Sept 2026): BOTH are now real comparisons in kbrefcheck.mjs --
// golem's own extra vertical add via a decay-agnostic none/netherite RATIO (IronGolemEntity.java:211),
// hoglin/zoglin's randomised push via a two-sample KS test over `repsA` reps (Hoglin.java:31-42),
// not skipped or "known gap"s any more. `repsA` (below) overrides `REPS_OVERRIDE` for that one
// attacker only -- the KS test needs a real sample, the point-comparison mobs don't.
const NOWEP = 'HandItems:[{},{}],ArmorItems:[{},{},{},{}],ArmorDropChances:[0f,0f,0f,0f],HandDropChances:[0f,0f]';
export const REPS_HOGLIN = 30; // Part C: >=30 reps/mob/armor-tier asked for the KS distribution compare
export const ATTACKERS = [
  { id: 'zombie', mob: 'zombie', nbt: NOWEP },
  { id: 'husk', mob: 'husk', nbt: NOWEP },
  { id: 'vindicator', mob: 'vindicator' },                 // VindicatorEntity always equips an iron_axe (.decomp)
  { id: 'spider', mob: 'spider' },
  // repsA 8 (> the default REPS): golem only fights back after `runkb.mjs`'s own provoke tap angers
  // it (UniversalAngerGoal, IronGolemEntity.initGoals:85 -- it has NO player-hostile goal by
  // default), which walks/re-aims a little more than an already-hostile mob's fixed Rotation does --
  // a small-N average of that is noisier than the other point-compared attackers (found empirically:
  // n=3 put @none's horizontal magnitude outside TOL once), so this one gets more reps, not a
  // different TOL.
  { id: 'iron_golem', mob: 'iron_golem', special: 'vertical-throw', repsA: 8 },   // IronGolemEntity.tryAttack: +0.4 vy, no ATTACK_KNOCKBACK path
  { id: 'ravager', mob: 'ravager' },                        // kbRes 0.75, atkKb 1.5 (.decomp RavagerEntity.createRavagerAttributes)
  { id: 'hoglin', mob: 'hoglin', special: 'random-push', nbt: 'IsBaby:0b', repsA: REPS_HOGLIN },  // Hoglin.knockback: randomised angle+magnitude -- KS-compared, kbrefcheck.mjs
  { id: 'zoglin', mob: 'zoglin', special: 'random-push', nbt: 'IsBaby:0b', repsA: REPS_HOGLIN },
];

// ── (B) bot hits mob ────────────────────────────────────────────────────────────────────────────
// Weapon: bare hand, iron sword (no enchant), iron sword + Knockback I/II.
export const WEAPONS = [
  { id: 'hand', item: null, kb: 0 },
  { id: 'iron_sword', item: 'iron_sword', kb: 0 },
  { id: 'iron_sword_kb1', item: 'iron_sword', kb: 1 },
  { id: 'iron_sword_kb2', item: 'iron_sword', kb: 2 },
  // infra I6 s145 (SPRINT KNOCKBACK): PlayerEntity.attack -- `if (this.isSprinting() && bl) { ++i; bl2 = true; }` with bl = the
  // cooldown > 0.9 gate: a sprinting full-strength blow gets +1 knockback level (and ends the sprint). The bot sends Client
  // Command START_SPRINTING (growbot.setSprinting) before each rep's blow.
  { id: 'hand_sprint', item: null, kb: 0, sprint: true },
  { id: 'iron_sword_sprint', item: 'iron_sword', kb: 0, sprint: true },
  { id: 'iron_sword_kb1_sprint', item: 'iron_sword', kb: 1, sprint: true },
];
// Targets: a plain zombie (no resistance) and a zombie given generic.knockback_resistance 0.5
// (`/attribute ... base set 0.5`, vanilla's own attribute command -- no vanilla number guessed,
// the SAME 0.5 the real server is told to use is what the engine sets on `e.knockbackResistance`).
export const TARGETS = [
  { id: 'zombie', mob: 'zombie', kbRes: 0 },
  { id: 'zombie_kbres', mob: 'zombie', kbRes: 0.5 },
  { id: 'ravager', mob: 'ravager', kbRes: 0.75 },   // its OWN vanilla kbRes -- no /attribute override needed
];

export const EFFECT_RAWID = {}; // unused here (kept for shape-parity with meleescen.mjs, no status effect in scope)
