// lockstep/tntlane.mjs -- #8282 (G17-L4): the ENGINE side of the tnt lane. One primed TNT (Fuse 60) is kicked down the zombie lane's stone
// corridor at a salt-dependent random angle. Rows (t = state after t world ticks): pos, vel, fuse, impact (tick it is removed = the
// explosion, once), effect (blocks destroyed so far). TntEntity.tick / Explosion.affectWorld (BREAK).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const TNT_FIELDS = ['pos', 'vel', 'fuse', 'impact', 'effect'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineTntTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  for (const n of ['Explosion', 'Tnt']) if (M[n] && M[n].init) M[n].init();
  if (M.wrandReset) M.wrandReset();
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const ang = r() * Math.PI * 2, k = 0.2;
  const vx = 0.9, vy = 0.1, vz = Math.sin(ang) * k;
  const tnt = EL.spawn('tnt', startX(), 1.9, 0.5, { vx, vy, vz, fuse: 60 });
  if (!tnt) throw new Error('EL.spawn gives no tnt');
  tnt.vx = vx; tnt.vy = vy; tnt.vz = vz; tnt.fuse = 60;
  const solid = () => { let n = 0; for (let x = -4; x < 40; x++) for (let y = 0; y < 5; y++) for (let z = -3; z < 4; z++) if (M.World.getBlock(x, y, z)) n++; return n; };
  const base = solid();
  const rows = []; let impact = -1;
  for (let t = 0; t < T; t++) {
    rows.push({ tick: t, pos: [tnt.x, tnt.y, tnt.z], vel: [tnt.vx, tnt.vy, tnt.vz], fuse: tnt.fuse, impact, effect: base - solid() });
    EL.tick();
    if (tnt.removed && impact < 0) impact = t + 1;
  }
  return { rows, impact };
}
