// lockstep/witchlane.mjs -- #5377 (G17-L4): the ENGINE side of chasescen's witch lane (RangedAttackGoal, WitchEntity.attack): rows from
// engineZombieTrace({mob:'witch'}) plus every thrown `potion` entity's spawn tick, Pos (lane-local) and velocity, in spawn order,
// matching runchase's cases.witch.proj.
import { engineZombieTrace } from './zombielane.mjs';

export const WITCH_FIELDS = ['pos', 'yaw', 'pitch', 'target'];
export function engineWitchTrace(salt) {
  const seen = new Map(), proj = { tick: [], pos: [], motion: [] };
  const rows = engineZombieTrace(salt, { mob: 'witch', onTick: (t, EL) => {
    for (const f of EL.list) if (f.type === 'potion' && !seen.has(f)) { seen.set(f, 1); proj.tick.push(t); proj.pos.push([f.x, f.y, f.z]); proj.motion.push([f.vx, f.vy, f.vz]); }
  } });
  return { rows, proj };
}
