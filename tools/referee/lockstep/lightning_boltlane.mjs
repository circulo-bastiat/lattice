// lockstep/lightning_boltlane.mjs -- #8287 (G17-L4): the ENGINE side of the lightning_bolt lane. One bolt struck in the zombie lane's corridor
// (LightningBolt.tick: ambient flashes, life countdown, fire placement, removal). Rows (t = state after t world ticks): pos, vel,
// removal (tick the entity is removed, once), effect (fire blocks set by the bolt).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const LIGHTNING_BOLT_FIELDS = ['pos', 'vel', 'removal', 'effect'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineLightningBoltTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const e = EL.spawn('lightning_bolt', startX(), 1, 0.5, { cosmetic: false });
  if (!e) throw new Error('EL.spawn gives no lightning_bolt');
  const rows = []; let removal = -1;
  for (let t = 0; t < T; t++) {
    rows.push({ tick: t, pos: [e.x, e.y, e.z], vel: [e.vx || 0, e.vy || 0, e.vz || 0], removal, effect: e.blocksSetOnFire | 0 });
    EL.tick();
    if (e.removed && removal < 0) removal = t + 1;
  }
  return { rows, removal };
}
