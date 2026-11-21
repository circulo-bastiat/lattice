// lockstep/soakengine.mjs -- #9447 (G17-L38b): the ENGINE side of the 12-mob soak. Same SOAK_MOBS at the same x/z on a stone plain, daytime, persistent,
// one ENTX-shaped row per mob per tick ([[type, mobIndex, conv, effects]], as soakcapture.splitEntx gives the server); a removed mob stops emitting rows (the server's ENTX does too).
import { harness } from './zombielane.mjs';
import { SOAK_MOBS, SOAK_TICKS } from './soak.mjs';
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const EFFECT_RAW = { speed: 1, slowness: 2, strength: 5, weakness: 18 };
export function engineSoak(salt = 0, o = {}) {
  const { M, w, cells } = harness(), EL = M.EntityList, ticks = o.ticks || SOAK_TICKS;
  const r = stream(salt); EL.random = r; Math.random = r; if (M.VB) M.VB.rand = r; if (M.wrandReset) M.wrandReset();
  cells.clear(); const stone = M.States.stateOf('stone');
  for (let x = -40; x <= 60; x++) for (let z = -40; z <= 70; z++) w.set(x, -1, z, stone);
  EL.list.length = 0; EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0;
  M.Player.x = 9999; M.Player.y = 0; M.Player.z = 9999;
  const mobs = SOAK_MOBS.map((m) => ({ m, e: null })), out = SOAK_MOBS.map(() => []);
  for (let t = 0; t < ticks + 1; t++) {
    for (const s of mobs) if (!s.e && t === s.m.spawn + (o.shift === s.m.n ? 1 : 0)) { s.e = EL.spawn(s.m.id, s.m.x + 0.5, 0, s.m.z + 0.5); if (s.e) s.e.persistent = true; }
    mobs.forEach((s, i) => { const e = s.e; if (!e || e.removed || !EL.list.includes(e)) return;
      const fx = Object.keys(e.effects || {}).filter((n) => n in EFFECT_RAW).map((n) => [EFFECT_RAW[n], e.effects[n].amplifier, e.effects[n].duration]).sort((p, q) => p[0] - q[0]);
      out[i].push({ tick: t + 2, entities: [[String(e.type), i, e.converting && e.conversionTimer > 0 ? e.conversionTimer : -1, fx]] }); });
    EL.tick();
  }
  return out;
}
