// lockstep/skeletonlane.mjs -- #5361 (G17-L4): the ENGINE side of chasescen's skeleton lane. Rows come from engineZombieTrace({mob:'skeleton'})
// (pos, yaw, pitch, target, attackTicks = ShootFireballGoal cooldown -- engine-only, the server keeps it private) plus
// engineSkeletonProjectiles: every arrow's spawn tick, Pos (lane-local) and velocity, in spawn order, matching runchase's cases.skeleton.proj.
import { engineZombieTrace } from './zombielane.mjs';

export const SKELETON_FIELDS = ['pos', 'yaw', 'pitch', 'target'];
export function engineSkeletonTrace(salt) {
  const seen = new Map(), proj = { tick: [], pos: [], motion: [] };
  const rows = engineZombieTrace(salt, { mob: 'skeleton', onTick: (t, EL) => {
    for (const f of EL.list) if (f.type === 'arrow' && !seen.has(f)) { seen.set(f, 1); proj.tick.push(t); proj.pos.push([f.x, f.y, f.z]); proj.motion.push([f.vx, f.vy, f.vz]); }
  } });
  return { rows, proj };
}
