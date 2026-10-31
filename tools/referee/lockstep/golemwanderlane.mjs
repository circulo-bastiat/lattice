// lockstep/golemwanderlane.mjs -- #9260 (G17-L8b): the ENGINE side of the golemwander lane (village arena, natural golem, 3000 ticks), shared by
// tools/lockstep-golemwander.mjs and the real-server comparison (runchase's `village` lane in lanes.d/golemwander.json builds the same arena).
import { harness } from './zombielane.mjs';
import { engineRow } from './trace.mjs';
export const T = 3000, SALTS = Array.from({ length: 20 }, (_, i) => i);
const h = harness(), { M, w, cells } = h, EL = M.EntityList;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const VX = 52;   // village centre x: 3 sections from the golem
function build(withVillage) {
  cells.clear();
  const stone = M.States.stateOf('stone');
  for (let x = -30; x <= 90; x++) for (let z = -30; z <= 30; z++) w.set(x, -1, z, stone);
  M.Poi.init();
  if (!withVillage) return;
  const bed = M.States.stateOf('red_bed'), bell = M.States.stateOf('bell');
  const jobs = ['composter', 'lectern', 'blast_furnace'].map((n) => M.States.stateOf(n));
  w.set(VX, 0, 0, bell); M.Poi.onChange(VX, 0, 0, bell);
  for (let i = 0; i < 6; i++) { w.set(VX + i, 0, 4, bed); M.Poi.onChange(VX + i, 0, 4, bed); M.Poi.reserveTicket({ x: VX + i, y: 0, z: 4 }); }
  jobs.forEach((s, i) => { w.set(VX + i * 2, 0, -4, s); M.Poi.onChange(VX + i * 2, 0, -4, s); M.Poi.reserveTicket({ x: VX + i * 2, y: 0, z: -4 }); });
}
export function trace(salt, o = {}) {
  const r = stream(salt);
  EL.random = r; Math.random = r; if (M.VB) M.VB.rand = r; if (M.wrandReset) M.wrandReset();
  build(o.village !== false);
  EL.list.length = 0; EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0;
  M.Player.x = 9999; M.Player.y = 0; M.Player.z = 9999;   // out of every range
  const e = EL.spawn('iron_golem', 0.5, 0, 0.5); e.persistent = true;
  if (o.tweak) o.tweak(e);
  const rows = [];
  for (let t = 0; t < T; t++) {
    rows.push(Object.assign(engineRow(t, e), { goals: ((e.ai && e.ai.entries) || []).filter((x) => x.running).map((x) => gname(x.goal)).join(',') }));
    EL.tick();
  }
  return rows;
}
export const GN = Object.keys(M.Ai).filter((k) => typeof M.Ai[k] === 'function' && /Goal$/.test(k));
export const gname = (g) => GN.find((k) => g instanceof M.Ai[k]) || '?';
export { M, EL };
