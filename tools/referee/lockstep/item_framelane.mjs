// lockstep/item_framelane.mjs -- #8286 (G17-L4): the ENGINE side of the item_frame lane. One orb with a salt-dependent value and
// start position/height falls in the zombie lane's stone corridor (player far away, so no pull). Rows (t = state after t world ticks):
// pos, vel, gone (tick the orb is removed, once; -1 while alive).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const ITEM_FRAME_FIELDS = ['pos', 'vel', 'gone'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineItemFrameTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const facing = Math.floor(r() * 4), rot = Math.floor(r() * 8);
  const H = M.Hanging, e = { type: 'item_frame', attachmentPos: { x: Math.floor(startX() + 2), y: 2, z: 0 }, obstructionCheckCounter: 0, item: { i: 'stone', n: 1 }, rotation: rot };
  H.attach(e, e.attachmentPos.x, 2, 0, facing, 12, 12);
  const orb = EL.spawn('item_frame', e.x, e.y, e.z);
  if (!orb) throw new Error('EL.spawn gives no item_frame');
  for (const k in e) if (k !== 'type') orb[k] = e[k];
  const value = rot;
  const rows = []; let gone = -1;
  for (let t = 0; t < T; t++) {
    rows.push({ tick: t, pos: [orb.x, orb.y, orb.z], vel: [orb.vx, orb.vy, orb.vz], gone });
    EL.tick();
    if (orb.removed && gone < 0) gone = t + 1;
  }
  return { rows, gone, value };
}
