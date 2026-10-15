#!/usr/bin/env node
// lockstep-golemwander -- #7099 (G18b-L8): iron golem wander lane, ENGINE side. A village arena (bell, 6 beds, 3 job sites, POI tickets held so
// Poi.occupiedPositions sees them) on an open stone floor, a natural golem 3 sections from it, 3000 ticks, 20 salts (0..19). Per tick: pos,
// yaw, running goals, target. Checked: deterministic per salt, the 240-interval WanderAroundPointOfInterestGoal and the 0.6 speed are in the
// roster, the golem moves toward the village, and a changed interval / speed / bell-less village changes the trace (breaks caught).
// The real-server rep0 comparison is the pilot job (needs a runner lane in run.mjs; owed, see the PR).
import { harness, harnessM } from './referee/lockstep/zombielane.mjs';
import { engineRow, compareTraces } from './referee/lockstep/trace.mjs';
const T = 3000, SALTS = Array.from({ length: 20 }, (_, i) => i);
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
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
function trace(salt, o = {}) {
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
const GN = Object.keys(M.Ai).filter((k) => typeof M.Ai[k] === 'function' && /Goal$/.test(k));
const gname = (g) => GN.find((k) => g instanceof M.Ai[k]) || '?';
const F = ['pos', 'yaw'];
trace(0); trace(0);   // warm-up x2: lazy engine state settles by the second run (a first-run trace drifts at tick 358)
const traces = SALTS.map((s) => trace(s));
traces.forEach((R, i) => ok(R.length === T && R.every((r, t) => r.tick === t && r.pos), `salt ${i}: rows`));
ok(compareTraces(traces[0], trace(0), { fields: F }) === null, 'same salt, same trace');
const dist = (R) => Math.max(...R.map((r) => Math.hypot(r.pos[0] - 0.5, r.pos[2] - 0.5)));
ok(traces.filter((R) => dist(R) > 4).length >= 15, `golems barely wander (${traces.filter((R) => dist(R) > 4).length}/20 moved > 4)`);
const towards = traces.filter((R) => R[T - 1].pos[0] > R[0].pos[0] + 8).length;
ok(towards >= 10, `only ${towards}/20 golems drift toward the village`);
const goalsSeen = new Set(); traces.forEach((R) => R.forEach((r) => goalsSeen.add(r.goals)));
ok([...goalsSeen].join('|').includes('WanderAroundPointOfInterestGoal'), 'WanderAroundPointOfInterestGoal never ran');
caught(compareTraces(traces[1], trace(1, { village: false }), { fields: F }) !== null, 'village removed');
caught(compareTraces(traces[1], trace(1, { tweak: (e) => { for (const en of e.ai.entries) if (en.goal && en.goal instanceof M.Ai.WanderAroundPointOfInterestGoal) en.goal.canUse = () => false; } }), { fields: F }) !== null, 'POI wander goal disabled');
const swap = (cls, mk) => (e) => { for (const en of e.ai.entries) if (en.goal instanceof M.Ai[cls]) en.goal = mk(e); };
caught(compareTraces(traces[1], trace(1, { tweak: swap('WanderAroundPointOfInterestGoal', (e) => new M.Ai.WanderAroundPointOfInterestGoal(e, 0.7, EL.random)) }), { fields: F }) !== null, 'POI wander speed 0.6 -> 0.7');
caught(compareTraces(traces[1], trace(1, { tweak: swap('IronGolemWanderAroundGoal', (e) => new M.Ai.IronGolemWanderAroundGoal(e, 0.7, { random: EL.random })) }), { fields: F }) !== null, 'IronGolemWanderAround speed 0.6 -> 0.7');
const mut = (f, fn) => traces[0].map((r, t) => (t === 1234 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0], mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]]), { fields: F })?.tick === 1234, 'pos 1e-9');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
console.log(`${SALTS.length * 2 + 8} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
