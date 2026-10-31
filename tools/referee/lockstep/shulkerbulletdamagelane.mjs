// lockstep/shulkerbulletdamagelane.mjs -- #9445 (G17-L4 shulker_bullet part 2): the ENGINE side of the shulkerbulletdamage lane. A NoAI zombie
// stands at START; a shulker bullet with a fixed +x heading (no replan: the real server's Steps:0, TXD:0.15) is spawned at x 3.5 and homes on it.
// Rows: pos, hp and the first effect [id, amplifier, duration] (-1s when none) of the zombie after t world ticks.
import { harness, buildLane } from './zombielane.mjs';
import { T, startX } from '../chasescen.mjs';

export const SHULKERBULLETDAMAGE_FIELDS = ['pos', 'hp', 'fx'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
export function engineShulkerBulletDamageTrace(salt, { damage = 4.0, ticks = 200 } = {}) {
  const h = harness(), { M } = h, EL = M.EntityList, r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0;
  M.Player.x = 1e3; M.Player.y = 0; M.Player.z = 1e3;
  M.Shulker.BULLET_HIT_DAMAGE = damage; M.Shulker.BULLET_LEVITATION_TICKS = ticks;   // the module is shared between calls: always set (the check breaks them on purpose)
  const z = EL.spawn('zombie', startX(), 0, 0.5, { noAI: true });
  if (z) z.aiDisabled = true;   // the engine's NoAI field (15g_commands: nbt.NoAI -> e.aiDisabled)
  const b = EL.spawn('shulker_bullet', 3.5, 1.2, 0.5, { target: z });
  if (!z || !b) throw new Error('EL.spawn gives no zombie/bullet');
  b.bulletDir = null; b.bulletSteps = 0; b.bulletStepX = 0.15; b.bulletStepY = 0; b.bulletStepZ = 0; b.vx = b.vy = b.vz = 0;
  const rows = [];
  for (let t = 0; t < T; t++) {
    const f = z.effects && Object.values(z.effects)[0];
    rows.push({ tick: t, pos: [z.x, z.y, z.z], hp: z.health, fx: f ? { i: [M.Effects.IDS[f.effect]], a: [f.amplifier], d: [f.duration] } : { i: [-1], a: [-1], d: [-1] } });
    EL.tick();
  }
  return rows;
}
