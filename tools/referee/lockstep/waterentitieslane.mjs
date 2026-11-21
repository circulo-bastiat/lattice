// lockstep/waterentitieslane.mjs -- #9264 (G17-L69a-2): the ENGINE side of chasescen's waterentities lane (a zombie in a 2-deep pool:
// submerged 600 ticks + 300 countdown -> drowned). Rows: pos + the whole entity list (type/pos/vel, spawn order, the `entities` field) per tick.
import { engineZombieTrace } from './zombielane.mjs';

export const WATER_FIELDS = ['pos', 'entities'];
export const WATER_TICKS = 1100;
let warm = false;
export function engineWaterTrace(salt) {
  if (!warm) { warm = true; engineZombieTrace(0, { mob: 'zombie', pool: true, T: 5 }); }
  return engineZombieTrace(salt, { mob: 'zombie', pool: true, T: WATER_TICKS, extra: (EL) => ({ entities: EL.list.filter((x) => x.type !== 'player').map((x) => [x.type, x.x, x.y, x.z, x.vx || 0, x.vy || 0, x.vz || 0]) }) });
}
// the tick at which a drowned first exists (-1: never)
export const convTick = (rows) => rows.findIndex((r) => r.entities.some((x) => x[0] === 'drowned'));
