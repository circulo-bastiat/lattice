// lockstep/soak.mjs -- #6270 (G17-L38): the SOAK harness pieces: 12 mixed mobs, one scripted /summon list, per-mob first divergence.
// The real-server multi-entity capture + engine run is owed (see docs/decisions/6270-lockstep-soak.md); this is the tested half.
import { compareTraces } from './trace.mjs';
export const SOAK_TICKS = 3000;
// id, x, z (y = surface), spawn tick. Pairs are chosen so each mob has an interaction partner within 16 blocks.
export const SOAK_MOBS = [
  ['zombie', 0, 0, 0], ['villager', 4, 0, 0], ['skeleton', 12, 0, 0], ['wolf', 16, 0, 0],
  ['creeper', 0, 12, 0], ['cat', 4, 12, 0], ['cow', 12, 12, 0], ['cow', 14, 12, 0],
  ['sheep', 0, 24, 0], ['sheep', 2, 24, 0], ['pig', 12, 24, 0], ['chicken', 14, 24, 0],
].map(([id, x, z, spawn], i) => ({ n: i, id, x, z, spawn }));
export const summonCommands = (y = 64) => SOAK_MOBS.map((m) => ({ tick: m.spawn,
  cmd: `summon minecraft:${m.id} ${m.x + 0.5} ${y} ${m.z + 0.5} {Tags:["soak${m.n}"],PersistenceRequired:1b}` }));
export const neighbours = (n, r = 16) => SOAK_MOBS.filter((m) => m.n !== n && Math.hypot(m.x - SOAK_MOBS[n].x, m.z - SOAK_MOBS[n].z) <= r).map((m) => m.n);
// server/engine: arrays (one per mob) of trace rows. -> [{ n, id, div }] with div = first divergence or null
export function perMobReport(server, engine, opts = {}) {
  return SOAK_MOBS.map((m) => ({ n: m.n, id: m.id, div: compareTraces(server[m.n], engine[m.n], opts) }));
}
export const fmtTable = (rep) => ['mob  id        first-div-tick  field', ...rep.map((r) =>
  `${String(r.n).padEnd(4)} ${r.id.padEnd(9)} ${r.div ? String(r.div.tick).padEnd(15) + ' ' + r.div.field : 'identical'}`)].join('\n');
// anti-vacuity helper: engine traces with mob n's spawn one tick later (rows shift right, first row repeated)
export const shiftSpawn = (traces, n) => traces.map((t, i) => i !== n ? t : t.map((_, k) => ({ ...t[Math.max(0, k - 1)], tick: t[k].tick })));
