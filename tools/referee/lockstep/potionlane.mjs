// lockstep/potionlane.mjs -- #8276 (G17-L4): the ENGINE side of the potion lane. A scripted source (no shooter) spawns one potion in the zombie
// lane's stone corridor with a salt-dependent launch angle; the far wall is the impact. Rows (t = state after t world ticks): pos, vel,
// impact (tick the potion is removed, once), effect (area_effect_clouds left by the splash, PotionEntity.onCollision).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const POTION_FIELDS = ['pos', 'vel', 'impact', 'effect'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function enginePotionTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const vy = (r() - 0.5) * 0.2, vz = (r() - 0.5) * 0.4;
  const potion = EL.spawn('potion', startX(), 1.9, 0.5, { vx: 0.9, vy, vz, potionId: ['harming', 'poison', 'slowness', 'weakness'][Math.floor(r() * 4)] });
  if (!potion) throw new Error('EL.spawn gives no potion');
  if (potion.vx === 0 && potion.vz === 0) { potion.vx = 0.9; potion.vy = vy; potion.vz = vz; }
  const rows = []; let impact = -1;
  for (let t = 0; t < T; t++) {
    const hatched = EL.list.filter((e) => e.type === 'area_effect_cloud').length;
    rows.push({ tick: t, pos: [potion.x, potion.y, potion.z], vel: [potion.vx, potion.vy, potion.vz], impact, effect: hatched });
    EL.tick();
    if (potion.removed && impact < 0) impact = t + 1;
  }
  return { rows, impact, hatched: EL.list.filter((e) => e.type === 'area_effect_cloud').length };
}
