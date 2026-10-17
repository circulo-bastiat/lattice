// lockstep/experience_bottlelane.mjs -- #8280 (G17-L4): the ENGINE side of the experience_bottle lane. A scripted source (no shooter) spawns one experience_bottle in the zombie
// lane's stone corridor with a salt-dependent launch angle; the far wall is the impact. Rows (t = state after t world ticks): pos, vel,
// impact (tick the experience_bottle is removed, once), effect (total value of experience orbs, 3+rand(5)+rand(5), ThrownExperienceBottle.onHit).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const EXPERIENCE_BOTTLE_FIELDS = ['pos', 'vel', 'impact', 'effect'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineExperienceBottleTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const vy = (r() - 0.5) * 0.2, vz = (r() - 0.5) * 0.4;
  const experience_bottle = EL.spawn('experience_bottle', startX(), 1.9, 0.5, { vx: 0.9, vy, vz });
  if (!experience_bottle) throw new Error('EL.spawn gives no experience_bottle');
  if (experience_bottle.vx === 0 && experience_bottle.vz === 0) { experience_bottle.vx = 0.9; experience_bottle.vy = vy; experience_bottle.vz = vz; }
  const orbs = () => EL.list.filter((e) => e.type === 'experience_orb' && !e.removed).reduce((a, e) => a + (e.value | 0), 0);
  const rows = []; let impact = -1;
  for (let t = 0; t < T; t++) {
    const hatched = orbs();
    rows.push({ tick: t, pos: [experience_bottle.x, experience_bottle.y, experience_bottle.z], vel: [experience_bottle.vx, experience_bottle.vy, experience_bottle.vz], impact, effect: hatched });
    EL.tick();
    if (experience_bottle.removed && impact < 0) impact = t + 1;
  }
  return { rows, impact, hatched: orbs() };
}
