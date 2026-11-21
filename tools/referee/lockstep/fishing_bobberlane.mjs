// lockstep/fishing_bobberlane.mjs -- #8291 (G17-L4): the ENGINE side of the fishing_bobber lane. A scripted source (no shooter) spawns one bobber in the zombie
// lane's stone corridor with a salt-dependent launch angle; the far wall is the impact. Rows (t = state after t world ticks): pos, vel,
// impact (tick the ownerless bobber is removed, once: FishingHook.tick discards when getPlayerOwner()==null), effect (always 0).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const BOBBER_FIELDS = ['pos', 'vel', 'impact', 'effect'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineBobberTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const vy = (r() - 0.5) * 0.2, vz = (r() - 0.5) * 0.4;
  const bob = EL.spawn('fishing_bobber', startX(), 1.9, 0.5, { vx: 0.9, vy, vz });
  if (!bob) throw new Error('EL.spawn gives no fishing_bobber');
  if (bob.vx === 0 && bob.vz === 0) { bob.vx = 0.9; bob.vy = vy; bob.vz = vz; }
  const rows = []; let impact = -1;
  for (let t = 0; t < T; t++) {
    const hatched = 0;
    rows.push({ tick: t, pos: [bob.x, bob.y, bob.z], vel: [bob.vx, bob.vy, bob.vz], impact, effect: hatched });
    EL.tick();
    if (bob.removed && impact < 0) impact = t + 1;
  }
  return { rows, impact, hatched: 0 };
}
