// panicscen.mjs — the BURNING-MOB PANIC scenarios (infra I6, 25 Sept 2026), shared by runpanic.mjs (the real 1.18.2
// server) and panicrefcheck.mjs (the engine). QUEUE 0.0 (Dan, 25 Sept): "run its AI for real ... flee, speed in
// blocks/s". vanilla's EscapeDangerGoal.isInDanger (.decomp EscapeDangerGoal.java:47-48) is
// `getAttacker() != null || shouldEscapePowderSnow() || isOnFire()`: a burning animal panics with NO attacker at all,
// so /summon ... {Fire:<n>s} is a clean, owner-free trigger. One open PEN per mob: a stone floor (x,z in -R..R) with
// 2-high stone walls around it, no water anywhere; the mob is summoned at the centre burning for FIRE ticks. Both sides
// log the mob's x/y/z every tick for T ticks from the summon (entry i = after i world ticks, entry 0 = the summon).
export const T = 160;
export const FIRE = 160;       // ticks of fire at the summon (8 s; a cow's 10 health outlives it)
export const R = 11;           // the pen's half-size
export const PITCH = 32;       // pens along z
export const REPS = 4;
export const SCEN = [
  { id: 'cow', mob: 'cow' },
  { id: 'mooshroom', mob: 'mooshroom' },
  { id: 'pig', mob: 'pig' },
  { id: 'sheep', mob: 'sheep' },
  { id: 'chicken', mob: 'chicken' },
  { id: 'horse', mob: 'horse' },
  { id: 'donkey', mob: 'donkey' },
  { id: 'llama', mob: 'llama' },
  { id: 'turtle', mob: 'turtle' },
  { id: 'rabbit', mob: 'rabbit' },
  { id: 'panda', mob: 'panda' },
  { id: 'wolf', mob: 'wolf' },
];
