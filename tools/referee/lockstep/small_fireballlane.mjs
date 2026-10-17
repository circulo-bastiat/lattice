// lockstep/small_fireballlane.mjs -- #8274 (G17-L4): the ENGINE side of the small_fireball lane. A scripted source (no shooter) spawns one small_fireball in the zombie
// lane's stone corridor with a salt-dependent launch angle; the far wall is the impact. Rows (t = state after t world ticks): pos, vel,
// impact (tick the small_fireball is removed, once), effect (fire blocks placed at impact, SmallFireball.onBlockHit).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const SMALL_FIREBALL_FIELDS = ['pos', 'vel', 'impact', 'effect'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineSmallFireballTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const vy = (r() - 0.5) * 0.2, vz = (r() - 0.5) * 0.4;
  const small_fireball = EL.spawn('small_fireball', startX(), 1.9, 0.5, { power: [0.1, vy * 0.1, vz * 0.1] });
  if (!small_fireball) throw new Error('EL.spawn gives no small_fireball');
    const w = M.World, fires = () => { let n = 0; for (let x = 0; x < 30; x++) for (let z = -2; z <= 2; z++) for (let y = 0; y < 8; y++) { const b = w.getBlock(x, y, z); if (b && M.Reg && M.Reg.name && /fire/.test(M.Reg.name(b))) n++; } return n; };
  const rows = []; let impact = -1;
  for (let t = 0; t < T; t++) {
    const hatched = fires();
    rows.push({ tick: t, pos: [small_fireball.x, small_fireball.y, small_fireball.z], vel: [small_fireball.vx, small_fireball.vy, small_fireball.vz], impact, effect: hatched });
    EL.tick();
    if (small_fireball.removed && impact < 0) impact = t + 1;
  }
  return { rows, impact, hatched: fires() };
}
