// lockstep/skulllane.mjs -- #5383 (G17-L4): the ENGINE side of the wither_skull lane. A scripted source (no shooter) spawns one
// wither_skull in the zombie lane's stone corridor, aimed down +x with a salt-dependent (dy,dz) power; the corridor's far wall is the
// impact. Rows (t = state after t world ticks): pos, vel, impact (tick the skull is removed, once) and effect (explosion power fired).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const SKULL_FIELDS = ['pos', 'vel', 'impact', 'effect'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineSkullTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const dy = (r() - 0.5) * 0.4, dz = (r() - 0.5) * 0.8;
  const sk = EL.spawn('wither_skull', startX(), 0.9, 0.5, { power: [1, dy, dz], charged: r() < 0.5 });
  if (!sk) throw new Error('EL.spawn gives no wither_skull');
  let explodes = 0; const Ex = M.Explosion, ex0 = Ex && Ex.explode;
  const rd0 = Ex && Ex.ready; if (Ex) { Ex.ready = true; Ex.explode = function (...a) { explodes = a[4]; return undefined; }; }
  const rows = []; let impact = -1;
  try {
    for (let t = 0; t < T; t++) {
      rows.push({ tick: t, pos: [sk.x, sk.y, sk.z], vel: [sk.vx, sk.vy, sk.vz], impact, effect: explodes });
      EL.tick();
      if (sk.removed && impact < 0) impact = t + 1;
    }
  } finally { if (Ex) { Ex.explode = ex0; Ex.ready = rd0; } }
  return { rows, impact, explodes, charged: sk.charged };
}
