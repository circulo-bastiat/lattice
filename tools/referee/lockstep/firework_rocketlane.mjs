// lockstep/firework_rocketlane.mjs -- #8281 (G17-L4): the ENGINE side of the firework_rocket lane. A scripted source (no shooter) spawns one firework_rocket in the zombie
// lane's stone corridor with a salt-dependent launch angle; the far wall is the impact. Rows (t = state after t world ticks): pos, vel,
// impact (tick the firework_rocket is removed, once), effect (total value of experience orbs, 3+rand(5)+rand(5), ThrownExperienceBottle.onHit).
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const FIREWORK_ROCKET_FIELDS = ['pos', 'vel', 'impact', 'effect'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineFireworkRocketTrace(salt) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;   // out of the way
  const firework_rocket = EL.spawn('firework_rocket', startX(), 1.9, 0.5, { tag: { Fireworks: { Flight: 1, Explosions: [] } } });
  if (!firework_rocket) throw new Error('EL.spawn gives no firework_rocket');
  firework_rocket.lifeTime = 25; firework_rocket.life = 0;   // server: NBT LifeTime:25 (summon uses the no-roll ctor)
  firework_rocket.vx = 0; firework_rocket.vy = 0.05; firework_rocket.vz = 0;   // server: Motion:[0,0.05,0]
  const orbs = () => 0;
  const rows = []; let impact = -1;
  for (let t = 0; t < T; t++) {
    const hatched = orbs();
    rows.push({ tick: t, pos: [firework_rocket.x, firework_rocket.y, firework_rocket.z], vel: [firework_rocket.vx, firework_rocket.vy, firework_rocket.vz], impact, effect: hatched });
    EL.tick();
    if (firework_rocket.removed && impact < 0) impact = t + 1;
  }
  return { rows, impact, hatched: orbs() };
}
