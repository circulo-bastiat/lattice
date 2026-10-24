// lockstep/arrowlane.mjs -- #8268 (G17-L4): the ENGINE side of the spectral_arrow lane. A scripted source (no shooter) spawns one
// spectral_arrow in the zombie lane's stone corridor, flying down +x with a salt-dependent velocity; the far wall stops it.
// Rows (t = state after t world ticks): pos, vel, gone (tick the arrow is removed, once) and stuck (tick it first sat in the wall, once).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const ARROW_FIELDS = ['pos', 'vel', 'gone', 'stuck'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineArrowTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const vx = 0.8 + r() * 1.2, vy = (r() - 0.5) * 0.2, vz = (r() - 0.5) * 0.4;
  const a = EL.spawn('spectral_arrow', startX(), 0.9, 0.5, { vx, vy, vz });
  if (!a) throw new Error('EL.spawn gives no spectral_arrow');
  const rows = []; let gone = -1, stuck = -1;
  for (let t = 0; t < T; t++) {
    rows.push({ tick: t, pos: [a.x, a.y, a.z], vel: [a.vx, a.vy, a.vz], gone, stuck });
    EL.tick();
    if (a.stuck && stuck < 0) stuck = t + 1;
    if (a.removed && gone < 0) gone = t + 1;
  }
  return { rows, gone, stuck };
}
