#!/usr/bin/env node
// lockstep-obstacle -- #6267 (G17-L35): engine-side 'obstacle' lane (3-wide wall, 1-block ledge, fence with a gap) x 20 salts: per-tick pos + path nodes
// (navPath), deterministic per salt, the zombie hops the wall, climbs the ledge and takes the fence gap. Anti-vacuity: the fence node cost
// forced to 0 (pathPenalty FENCE) changes the path rows, and tampered pos/path rows are caught. Server rows: SeedAgent pathlog (#6952) once a
// golden exists; engine determinism is what this check owns.
import { engineZombieTrace, harnessM, OBST } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const F = ['pos', 'path'];
const O = { obstacle: true };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => engineZombieTrace(s, O));
traces.forEach((R, i) => {
  const s = SALTS[i];
  ok(R.length === T, `salt ${s}: ${R.length} rows`);
  ok(R.some((r) => r.path && r.path.length > 2), `salt ${s}: never pathed`);
  ok(R.every((r) => r.pos && r.pos.every(Number.isFinite)), `salt ${s}: pos`);
  const nodes = R.filter((r) => r.path).flatMap((r) => r.path);
  ok(nodes.some((q) => q[1] >= 1), `salt ${s}: path never steps up the ledge`);
  ok(R.some((r) => r.pos[0] >= OBST.fenceX - 0.5 && r.pos[0] <= OBST.fenceX + 1.5 && r.pos[2] > 2), `salt ${s}: zombie never crossed the fence line by the gap`);
  ok(R[T - 1].pos[0] > OBST.fenceX, `salt ${s}: zombie still at the wall, x=${R[T - 1].pos[0]}`);
});
ok(compareTraces(traces[0], engineZombieTrace(SALTS[0], O), { fields: F }) === null, 'same salt, same trace');
// fence cost 0: the engine refuses a fence node by its 1.5 top (Ai.feetY, LandPathNodeMaker.getFeetY: a 1.125 step); its FENCE malus (-1) never
// fires because the headroom test refuses the fence cell first. Zeroing the fence height (__testNoFeet) lets the search path straight over the fence line.
const M = harnessM();
M.Ai.__testNoFeet = true;
const free = SALTS.slice(0, 3).map((s) => engineZombieTrace(s, O));
M.Ai.__testNoFeet = false;
caught(compareTraces(traces[0], free[0], { fields: F }) !== null, 'fence height 0 leaves the rows unchanged');
const first = compareTraces(traces[0], free[0], { fields: ['path'] });
caught(first && first.field === 'path', 'fence height 0: first divergence is on path');
const mut = (f, fn) => traces[0].map((r, t) => (t === 90 && r[f] ? { ...r, [f]: fn(r[f]) } : r));
const pt = traces[0].findIndex((r) => r.path && r.path.length > 2);
const mp = traces[0].map((r, t) => (t === pt ? { ...r, path: r.path.map((q, i) => (i === 1 ? [q[0] + 1, q[1], q[2]] : q)) } : r));
caught(compareTraces(traces[0], mp, { fields: F })?.field === 'path', 'path node shifted');
caught(compareTraces(traces[0], mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]]), { fields: F })?.field === 'pos', 'pos 1e-9');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
console.log(`${n} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
