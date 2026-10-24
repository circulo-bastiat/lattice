// lockstep/experience_orblane.mjs -- #8286 (G17-L4): the ENGINE side of the experience_orb lane. One orb with a salt-dependent value and
// start position/height falls in the zombie lane's stone corridor (player far away, so no pull). Rows (t = state after t world ticks):
// pos, vel, gone (tick the orb is removed, once; -1 while alive).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const EXPERIENCE_ORB_FIELDS = ['pos', 'vel', 'gone'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineExperienceOrbTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const value = 1 + Math.floor(r() * 40), dy = r() * 0.8, dz = (r() - 0.5) * 0.4;
  const orb = EL.spawn('experience_orb', startX() + 2, 1.9 + dy, 0.5 + dz, { value, vx: 0, vy: 0, vz: 0 });
  if (!orb) throw new Error('EL.spawn gives no experience_orb');
  const rows = []; let gone = -1;
  for (let t = 0; t < T; t++) {
    rows.push({ tick: t, pos: [orb.x, orb.y, orb.z], vel: [orb.vx, orb.vy, orb.vz], gone });
    EL.tick();
    if (orb.removed && gone < 0) gone = t + 1;
  }
  return { rows, gone, value };
}
