// lockstep/area_effect_cloudlane.mjs -- #8288 (G17-L4): the ENGINE side of the area_effect_cloud lane. One cloud is spawned in the zombie lane's corridor with a salt-dependent
// initial radius and potion. Rows (t = state after t world ticks): pos, vel, air (tick of removal, once; the trace schema has no removal field), health (current radius; shrinks by radiusGrowth per tick, AreaEffectCloud.tick).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const CLOUD_FIELDS = ['pos', 'vel', 'air', 'health'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const POTIONS = ['poison', 'slowness', 'weakness', 'regeneration'];
export function engineCloudTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const radius = 1 + Math.floor(r() * 4), duration = 100 + Math.floor(r() * 60), potionId = POTIONS[Math.floor(r() * POTIONS.length)];
  const c = EL.spawn('area_effect_cloud', startX(), 1.9, 0.5, { radius, duration, waitTime: 10, radiusOnUse: -0.5, radiusGrowth: -radius / duration, potionId });
  if (!c) throw new Error('EL.spawn gives no area_effect_cloud');
  const rows = []; let tick = -1;
  for (let t = 0; t < T; t++) {
    rows.push({ tick: t, pos: [c.x, c.y, c.z], vel: [c.vx, c.vy, c.vz], air: tick, health: c.radius });
    EL.tick();
    if (c.removed && tick < 0) tick = t + 1;
  }
  return { rows, removedAt: tick, radius, duration, potionId };
}
