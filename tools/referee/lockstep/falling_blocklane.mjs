// lockstep/falling_blocklane.mjs -- #8283 (G17-L4): the ENGINE side of the falling_block lane. One sand block spawned in the zombie lane's corridor
// falls to the floor (FallingBlockEntity.tick: gravity, move, 0.98 drag, land -> place or drop). Rows (t = state after t world ticks): pos, vel,
// impact (tick the entity is removed, once), effect (sand placed in the world + sand items on the ground).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const FALLING_BLOCK_FIELDS = ['pos', 'vel', 'impact', 'effect'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineFallingBlockTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const sand = M.States.stateOf('sand') | 0;
  const e = EL.spawn('falling_block', startX(), 1.9, 0.5, { state: sand });
  if (!e) throw new Error('EL.spawn gives no falling_block');
  e.time = 1;   // server: Time:1
  const left = () => EL.list.filter((x) => x.type === 'item' && !x.removed).length;
  const rows = []; let impact = -1;
  for (let t = 0; t < T; t++) {
    rows.push({ tick: t, pos: [e.x, e.y, e.z], vel: [e.vx, e.vy, e.vz], impact, effect: left() });
    EL.tick();
    if (e.removed && impact < 0) impact = t + 1;
  }
  return { rows, impact, hatched: left() };
}
