// lockstep/arrowdamagelane.mjs -- #9213 (MOBPROOF-DAMAGE-3): the ENGINE side of the arrowdamage lane. A NoAI zombie stands at START in the
// corridor; a crit arrow (motion 2.5) is spawned 8 blocks behind it at the same tick. Rows: pos + hp of the zombie after t world ticks.
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const ARROWDAMAGE_FIELDS = ['pos', 'hp'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineArrowDamageTrace(salt, { mob = 'zombie', speed = 2.5 } = {}) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;
  const z = EL.spawn(mob, startX(), 0, 0.5, { noAI: true });
  if (!z) throw new Error('EL.spawn gives no ' + mob);
  const a = EL.spawn('arrow', 3.5, 1.2, 0.5, { vx: speed, vy: 0, vz: 0, crit: true });
  if (!a) throw new Error('EL.spawn gives no arrow');
  const rows = [];
  for (let t = 0; t < T; t++) { rows.push({ tick: t, pos: [z.x, z.y, z.z], hp: z.health }); EL.tick(); }
  return rows;
}
