// lockstep/blazelane.mjs -- #5361 (G17-L4): the ENGINE side of chasescen's blaze lane. Rows come from engineZombieTrace({mob:'blaze'})
// (pos, yaw, pitch, target, attackTicks = ShootFireballGoal cooldown -- engine-only, the server keeps it private) plus
// engineBlazeProjectiles: every small_fireball's spawn tick, Pos (lane-local) and velocity, in spawn order, matching runchase's cases.blaze.proj.
import { engineZombieTrace } from './zombielane.mjs';

export const BLAZE_FIELDS = ['pos', 'yaw', 'pitch', 'target'];
export function engineBlazeTrace(salt, mob = 'blaze', type = 'small_fireball') {
  const seen = new Map(), proj = { tick: [], pos: [], motion: [] };
  const rows = engineZombieTrace(salt, { mob, onTick: (t, EL) => {
    for (const f of EL.list) if (f.type === type && !seen.has(f)) { seen.set(f, 1); proj.tick.push(t); proj.pos.push([f.x, f.y, f.z]); proj.motion.push([f.vx, f.vy, f.vz]); }
  } });
  return { rows, proj };
}
