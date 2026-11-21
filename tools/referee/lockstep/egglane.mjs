// lockstep/egglane.mjs -- #8270 (G17-L4): the ENGINE side of the egg lane. A scripted source (no shooter) spawns one egg in the zombie
// lane's stone corridor with a salt-dependent launch angle; the far wall is the impact. Rows (t = state after t world ticks): pos, vel,
// impact (tick the egg is removed, once), effect (chickens hatched; 1/8 hatch, 1/32 of those four, ThrownEgg.onHit).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const EGG_FIELDS = ['pos', 'vel', 'impact', 'effect'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineEggTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const vy = (r() - 0.5) * 0.2, vz = (r() - 0.5) * 0.4;
  const egg = EL.spawn('egg', startX(), 1.9, 0.5, { vx: 0.9, vy, vz });
  if (!egg) throw new Error('EL.spawn gives no egg');
  if (egg.vx === 0 && egg.vz === 0) { egg.vx = 0.9; egg.vy = vy; egg.vz = vz; }
  const rows = []; let impact = -1;
  for (let t = 0; t < T; t++) {
    const hatched = EL.list.filter((e) => e.type === 'chicken').length;
    rows.push({ tick: t, pos: [egg.x, egg.y, egg.z], vel: [egg.vx, egg.vy, egg.vz], impact, effect: hatched });
    EL.tick();
    if (egg.removed && impact < 0) impact = t + 1;
  }
  return { rows, impact, hatched: EL.list.filter((e) => e.type === 'chicken').length };
}
