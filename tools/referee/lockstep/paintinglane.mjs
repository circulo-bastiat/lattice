// lockstep/paintinglane.mjs -- #8290 (G17-L4): the ENGINE side of the painting lane. A painting hung on a wall of salt-dependent size
// (HangingEntity survival check + PaintingEntity motive pick: placePainting keeps the largest fitting motive, rnd picks among ties).
// Rows (t = state after t world ticks): pos, vel, removal (tick the entity is removed, once), effect (index of the motive picked).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const PAINTING_FIELDS = ['pos', 'vel', 'removal', 'effect'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function enginePaintingTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;
  const wall = 1 + (salt % 4);   // wall height in blocks: selects the motive row
  const e = EL.spawn('painting', startX(), 1 + wall / 2, 0.5, { cosmetic: false });
  if (!e) throw new Error('EL.spawn gives no painting');
  const motive = M.Hanging ? M.Hanging.MOTIVES.findIndex((m) => m[0] === e.motive) : -1;
  const rows = []; let removal = -1;
  for (let t = 0; t < T; t++) {
    rows.push({ tick: t, pos: [e.x, e.y, e.z], vel: [e.vx || 0, e.vy || 0, e.vz || 0], removal, effect: motive });
    EL.tick();
    if (e.removed && removal < 0) removal = t + 1;
  }
  return { rows, removal, wall };
}
