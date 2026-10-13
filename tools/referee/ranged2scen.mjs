// ranged2scen.mjs — the MOB RANGED II referee pack's scenarios (infra I6, s151, 25 Sept 2026): the ranged/spell mobs the
// first ranged pack (rangedscen.mjs: skeleton/stray/pillager) left out. Shared by runranged2.mjs (the real 1.18.2 server)
// and ranged2refcheck.mjs (the engine).
// One mob DIST blocks from a still survival player (Resistance IV + Fire Resistance, re-healed) in a 3-wide walled stone
// lane, AI on, night, normal, for T ticks. Recorded: the tick and kind of every projectile/spell entity the mob makes
// (tagged on sight), plus whether the player ever carries Blindness (illusioner's spell).
// Vanilla (.decomp): WitchEntity ProjectileAttackGoal(1.0, 60, 10.0F) + the potion choice in WitchEntity.attack;
// BlazeEntity.ShootFireballGoal (3 fireballs 6 ticks apart, then 100); DrownedEntity.TridentAttackGoal = ProjectileAttackGoal
// (1.0, 40, 10.0F) while holding a trident; EvokerEntity's ConjureFangs (cooldown 100) / SummonVex (cooldown 340, 3 vexes);
// IllusionerEntity BowAttackGoal(0.5, 20, 15.0F) + GiveInvisibility / Blindness spells.
export const T = 600;
export const REPS = 3;
export const DIST = 10;
export const PITCH = 8;
export const Y = -59;            // server.mjs flat preset's grass top
export const VOLLEY_GAP = 12;    // shots closer than this belong to one volley (blaze 6-tick trio, one fang cast)
export const SCENES = [
  { id: 'witch', mob: 'witch', kinds: ['potion'], nbt: '' },
  { id: 'blaze', mob: 'blaze', kinds: ['small_fireball'], nbt: '' },
  { id: 'drowned_trident', mob: 'drowned', kinds: ['trident'], nbt: '{HandItems:[{id:"minecraft:trident",Count:1b},{}],HandDropChances:[0f,0f]}', hand: 'trident' },
  { id: 'evoker', mob: 'evoker', kinds: ['evoker_fangs', 'vex'], nbt: '' },
  { id: 'illusioner', mob: 'illusioner', kinds: ['arrow'], nbt: '', blind: true },
  // an OPEN arena (no lane walls, mobGriefing off): the ghast 16 out and 2 up (its target filter wants |dy| <= 4, GhastEntity.initGoals) (GhastEntity.ShootFireballGoal: charge to
  // 20, fire, cooldown -40); the snow golem pelting a NoAI zombie pinned 2 in front of the bot
  // (SnowGolemEntity ProjectileAttackGoal(1.25, 20, 10.0F), targets any Monster)
  { id: 'ghast', mob: 'ghast', kinds: ['fireball'], nbt: '', open: true, dist: 16, up: 2 },
  { id: 'snow_golem', mob: 'snow_golem', kinds: ['snowball'], nbt: '', target: { mob: 'zombie', at: 2, nbt: '{NoAI:1b,PersistenceRequired:1b,Silent:1b}' } },
];
/** shots: [[tick, kind, sub]] -> volleys of the MAIN kind (kinds[0]) + per-kind counts. */
export function summarize(sc, shots) {
  const main = shots.filter((s) => s[1] === sc.kinds[0]).map((s) => s[0]).sort((a, b) => a - b);
  const vol = [];
  for (const t of main) { const v = vol[vol.length - 1]; if (v && t - v.last < VOLLEY_GAP) { v.n++; v.last = t; } else vol.push({ t, n: 1, last: t }); }
  const starts = vol.map((v) => v.t), gaps = [];
  for (let i = 1; i < starts.length; i++) gaps.push(starts[i] - starts[i - 1]);
  const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  const counts = {}; for (const s of shots) counts[s[1]] = (counts[s[1]] || 0) + 1;
  const subs = shots.filter((s) => s[2]).map((s) => s[2]);
  return { nVolleys: vol.length, first: starts.length ? starts[0] : null, medCycle: med(gaps), gaps, medSize: med(vol.map((v) => v.n)), counts, subs };
}
