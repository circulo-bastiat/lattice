// lockstep/skulllane.mjs -- #8275 (G17-L4): the ENGINE side of the dragon_fireball lane. A scripted source (no shooter) spawns one
// dragon_fireball in the zombie lane's stone corridor, aimed down +x with a salt-dependent (dy,dz) power; the corridor's far wall is the
// impact. Rows (t = state after t world ticks): pos, vel, impact (tick the skull is removed, once) and effect (explosion power fired).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const DFB_FIELDS = ['pos', 'vel', 'impact', 'effect'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineDfbTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const dy = (r() - 0.5) * 0.4, dz = (r() - 0.5) * 0.8;
  const fb = EL.spawn('dragon_fireball', startX(), 0.9, 0.5, { power: [0.1, dy * 0.1, dz * 0.1] });
  if (!fb) throw new Error('EL.spawn gives no dragon_fireball');
  const rows = []; let impact = -1;
  for (let t = 0; t < T; t++) {
    const clouds = EL.list.filter((e) => e.type === 'area_effect_cloud').length;
    rows.push({ tick: t, pos: [fb.x, fb.y, fb.z], vel: [fb.vx, fb.vy, fb.vz], impact, effect: clouds });
    EL.tick();
    if (fb.removed && impact < 0) impact = t + 1;
  }
  return { rows, impact, clouds: EL.list.filter((e) => e.type === 'area_effect_cloud').length };
}
