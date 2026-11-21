// lockstep/itemlane.mjs -- #8285 (G17-L4): the ENGINE side of the item lane. A scripted source (no shooter) spawns one item in the zombie
// lane's stone corridor with a salt-dependent launch angle; the far wall is the impact. Rows (t = state after t world ticks): pos, vel,
// impact (tick the item is removed, once), effect (total value of experience orbs, 3+rand(5)+rand(5), ItemEntity stack count).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const ITEM_FIELDS = ['pos', 'vel', 'impact', 'effect'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineItemTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const item = EL.spawn('item', startX(), 1.9, 0.5, { item: 'stone', count: 1, pickupDelay: 32767 });
  if (!item) throw new Error('EL.spawn gives no item');
  item.vx = 0.3; item.vy = 0.2; item.vz = 0;   // server: Motion:[0.3,0.2,0.0]
  const orbs = () => (item.removed ? 0 : item.count | 0);
  const rows = []; let impact = -1;
  for (let t = 0; t < T; t++) {
    const hatched = orbs();
    rows.push({ tick: t, pos: [item.x, item.y, item.z], vel: [item.vx, item.vy, item.vz], impact, effect: hatched });
    EL.tick();
    if (item.removed && impact < 0) impact = t + 1;
  }
  return { rows, impact, hatched: orbs() };
}
