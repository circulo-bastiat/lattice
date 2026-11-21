#!/usr/bin/env node
// lockstep-pathstuck -- #7936 (G18b-L23): engine-side 'pathstuck' lane: zombie, cow, villager, spider each ordered along the lane across a 1-block gap, a fence
// corner and a closed trapdoor (+ a pinned mob that can never reach its node), 20 salts. Rows: path node index, EntityNavigation tick / node ticks
// (checkTimeouts: 100-tick 1.5 window, 3x node timeout), the cleared path, and the 20-tick recompute after a drop. Deterministic per salt; the
// pinned mob's path must drop at tick 101. Anti-vacuity: a 60-tick window, a tampered node index and a row shift are caught. Server rows: pending a golden.
import { engineZombieTrace, harnessM, STUCK_FEATURES, FEAT_X } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T, startX } from './referee/chasescen.mjs';

let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const MOBS = ['zombie', 'cow', 'villager', 'spider'];
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const F = ['pos', 'path', 'idx', 'navTick', 'nodeTicks', 'dropped'];
const M = harnessM(), Ai = M.Ai;
const GOAL = FEAT_X + 5;

function run(mob, feature, salt, pin) {
  const st = { path: null, idx: 1, since: -99, dropped: 0, t: 0, pin: null };
  return engineZombieTrace(salt, {
    mob, feature, noAI: true, T,
    extra: (EL, e) => ({ idx: st.path ? st.idx : -1, navTick: e.nav ? e.nav.tick : -1, nodeTicks: e.nav ? e.nav.nodeTicks : -1, dropped: st.dropped }),
    onTick: (t, EL) => {
      const e = EL.list.find((x) => x.type === mob);
      st.t = t;
      if (pin) { if (!st.pin) st.pin = { x: e.x, y: e.y, z: e.z }; e.x = st.pin.x; e.y = st.pin.y; e.z = st.pin.z; e.vx = e.vz = 0; }
      if (!st.path && t - st.since >= 20) {   // recalcPath: a new path only 20 ticks after the last
        st.since = t; st.path = Ai.findPath(e.x, e.y, e.z, GOAL + 0.5, 0, 0.5, { mob: e }); st.idx = 1;
        if (st.path && st.path.length < 2) st.path = null;
      }
      if (st.path) {
        if (st.idx < st.path.length) { Ai.stepToward(e, st.path[st.idx], 1.0); st.idx = Ai.advancePathNode(e, st.path, st.idx); }
        if (st.idx >= st.path.length) { if (!e.navPath) st.dropped++; st.path = null; }
      }
    },
  });
}

const base = {};
for (const mob of MOBS) for (const f of STUCK_FEATURES) base[mob + '/' + f] = SALTS.map((s) => run(mob, f, s, false));
const pinned = MOBS.map((mob) => SALTS.map((s) => run(mob, mob === 'spider' ? 'trapdoor' : 'fence_corner', s, true)));
for (const [k, rs] of Object.entries(base)) rs.forEach((R, i) => {
  ok(R.length === T, `${k} salt ${i}: ${R.length} rows`);
  ok(R.every((r) => r.pos.every(Number.isFinite)), `${k} salt ${i}: pos`);
  if (!k.endsWith('/gap') && k !== 'spider/fence_corner') ok(R.some((r) => r.path), `${k} salt ${i}: never pathed`);
});
ok(compareTraces(base['zombie/gap'][0], run('zombie', 'gap', 0, false), { fields: F }) === null, 'same salt, same trace');
// the pinned mob never moves: its path must be dropped by the 100-tick window, then recomputed 20 ticks later
pinned.forEach((rs, mi) => rs.forEach((R, i) => {
  const d = R.findIndex((r) => r.dropped > 0);
  ok(d >= 100 && d <= 103, `${MOBS[mi]} salt ${i}: pinned path dropped at row ${d}`);
  ok(R.slice(d + 1).some((r) => r.path), `${MOBS[mi]} salt ${i}: no recompute after the drop`);
}));
// anti-vacuity: window 100 -> 60
const orig = Ai.checkTimeouts;
Ai.checkTimeouts = function (e, nv, path, idx) { if (nv.tick === 1 && nv.startT === 0) nv.tick = 41; return orig.call(this, e, nv, path, idx); };
const early = run('zombie', 'fence_corner', 0, true);
Ai.checkTimeouts = orig;
caught(compareTraces(pinned[0][0], early, { fields: F }) !== null, '60-tick timeout leaves the rows unchanged');
caught(early.findIndex((r) => r.dropped > 0) < 70, '60-tick timeout drops at row < 70');
const mp = base['zombie/gap'][0].map((r, t) => (t === 40 ? { ...r, idx: r.idx + 1 } : r));
caught(compareTraces(base['zombie/gap'][0], mp, { fields: F })?.field === 'idx', 'node index shifted');
caught(compareTraces(base['zombie/gap'][0], base['zombie/gap'][0].slice(1), { fields: F }) !== null, 'row shift');
console.log(`${n} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
