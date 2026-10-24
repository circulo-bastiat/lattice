// lockstep/blazelane.mjs -- #5361 (G17-L4): the ENGINE side of chasescen's blaze lane. Rows come from engineZombieTrace({mob:'blaze'})
// (pos, yaw, pitch, target, attackTicks = ShootFireballGoal cooldown -- engine-only, the server keeps it private) plus
// engineBlazeProjectiles: every small_fireball's spawn tick, Pos (lane-local) and velocity, in spawn order, matching runchase's cases.blaze.proj.
import { engineZombieTrace } from './zombielane.mjs';

export const BLAZE_FIELDS = ['pos', 'yaw', 'pitch', 'target'];
// #7216 ruling: the server's java.util.Random (SeedAgent) and the engine's LCG stream cannot agree on ActiveTargetGoal's nextInt(10) roll, so
// the engine's acquisition tick is a different draw. With opts.acquireAt = k (the tick the SERVER first showed a target) the engine blaze is
// held (NoAI) until tick k-1 and then aggroed (target = player), so what is compared against the server is everything AFTER acquisition.
export function engineBlazeTrace(salt, mob = 'blaze', type = 'small_fireball', opts = {}) {
  const k = opts.acquireAt, held = k != null && k > 1;
  const seen = new Map(), proj = { tick: [], pos: [], motion: [] };
  const rows = engineZombieTrace(salt, { mob, serverSeed: mob === 'blaze' ? 'bln' : undefined, aggro: k != null, noAI: held, aggroLate: held, onTick: (t, EL, P) => {
    if (held && t === k - 1) { const b = EL.list.find((f) => f.type === mob); if (b) { b.aiDisabled = false; b.target = P; b.vy = -0.08 * Math.fround(0.98); b.onGround = true; } }   // the server's NoAI blaze rested on the ground under gravity ((0-0.08)*0.98F each tick); the engine's held mob skips physics, so rest it there
    for (const f of EL.list) if (f.type === type && !seen.has(f)) { seen.set(f, 1); proj.tick.push(t); proj.pos.push([f.x, f.y, f.z]); proj.motion.push([f.vx, f.vy, f.vz]); }
  }, extra: (EL, e) => ({ xh: e.xHeadRot || 0 }) });
  // the server logs Mob.xRot in degrees (up negative); the engine LookControl keeps e.xHeadRot in radians (also up negative), so convert
  for (const r of rows) { r.pitch = Math.fround((r.xh || 0) * 180 / Math.PI); delete r.xh; }
  return { rows, proj };
}
