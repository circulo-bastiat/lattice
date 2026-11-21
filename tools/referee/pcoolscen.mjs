// pcoolscen.mjs — the PLAYER ATTACK COOLDOWN referee pack (infra I6, 25 Sept 2026), shared by runpcool.mjs (the real 1.18.2
// server: a growbot survival PLAYER's own packets) and pcoolrefcheck.mjs (the engine's Combat.attack + Hand cooldown).
// What it measures: the health a SECOND NoAI target (B) loses when the blow lands on a PARTLY charged attack —
// PlayerEntity.attack: progress p = clamp((lastAttackedTicks + 0.5) / (20 / attack_speed)), damage *= 0.2 + 0.8 p^2,
// the enchantment bonus *= p, and crit / sweep only when p > 0.9. The cooldown is emptied by (a) a blow on target A,
// (b) a hand swing at the air (ServerPlayerEntity.swingHand -> resetLastAttackedTicks), (c) a held-item change (reset on the
// NEXT player tick, PlayerEntity.tick). `gap` = ms between the emptying packet(s) and the blow on B: 0 = the same write
// (the server handles both packets in the same task batch -> lastAttackedTicks 0, or 1 if a tick boundary fell between).
// Targets: NBT-form zombies (no gear), NoAI, max health 100, A at x-2, B at x+1 (outside A's sweep box), N (sweep scene)
// at x+2 next to B; all 2 blocks +z of the bot.
export const REPS = 3;
const E = (item, ench) => ({ item, ench });
export const SCEN = [
  { id: 'hand_after_hit', empty: 'hit', weapon: null, gap: 0 },
  { id: 'iron_sword_after_hit', empty: 'hit', weapon: E('iron_sword'), gap: 0 },
  { id: 'sharp5_after_hit', empty: 'hit', weapon: E('diamond_sword', [['sharpness', 5]]), gap: 0 },
  { id: 'iron_axe_after_hit', empty: 'hit', weapon: E('iron_axe'), gap: 0 },
  { id: 'crit_after_hit', empty: 'hit', weapon: E('iron_sword'), gap: 0, crit: true },
  { id: 'sweep_after_hit', empty: 'hit', weapon: E('diamond_sword'), gap: 0, sweep: true },
  { id: 'iron_sword_250ms', empty: 'hit', weapon: E('iron_sword'), gap: 250 },
  { id: 'iron_axe_500ms', empty: 'hit', weapon: E('iron_axe'), gap: 500 },
  { id: 'iron_sword_after_air_swing', empty: 'swing', weapon: E('iron_sword'), gap: 0 },
  { id: 'switch_same_tick', empty: 'switch', weapon: E('iron_sword'), weapon2: E('diamond_sword'), gap: 0 },
  { id: 'switch_then_150ms', empty: 'switch', weapon: E('iron_sword'), weapon2: E('diamond_sword'), gap: 150 },
];
export const DZ = 2, AX = -2, BX = 1, NX = 2;
export const TICK_MS = 50;
// The window of lastAttackedTicks a `gap` can have produced: gap/50 +- 3 ticks (thread hand-off + a tick boundary either side
// of each packet), never below 0. Same-write scenes: {0, 1}. The check wants every server rep to equal the engine at SOME t in
// the window AND (for a partial scene) to be below the full-charge loss, so a window never hides "no cooldown at all".
export const window = (s) => {
  if (!s.gap) return s.empty === 'switch' ? [0, 1, 2, 1000] : [0, 1];
  const n = Math.round(s.gap / TICK_MS), out = [];
  for (let t = Math.max(0, n - 3); t <= n + 3; t++) out.push(t);
  return out;
};
