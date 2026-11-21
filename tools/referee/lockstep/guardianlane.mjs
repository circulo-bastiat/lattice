// lockstep/guardianlane.mjs -- #5376 (G17-L4): the ENGINE side of chasescen's elder_guardian lane (a water pool, no ground navigation).
// engineZombieTrace rows already carry pos, vel, yaw, pitch, air per tick; pool:true floods the corridor like runchase's `fill ... water`.
import { engineZombieTrace } from './zombielane.mjs';

export const GUARDIAN_FIELDS = ['pos', 'vel', 'yaw', 'pitch', 'air'];
// The first lane run in a process differs from every later one for the same salt (lazily-built engine state, not yet traced to its cause),
// so one throw-away run precedes the first real one: every salt, in any order, then reproduces.
let warm = false;
export function engineGuardianTrace(salt) {
  if (!warm) { warm = true; engineZombieTrace(0, { mob: 'elder_guardian', pool: true }); }
  return engineZombieTrace(salt, { mob: 'elder_guardian', pool: true });
}
