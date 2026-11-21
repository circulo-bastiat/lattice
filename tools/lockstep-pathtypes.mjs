#!/usr/bin/env node
// lockstep-pathtypes -- #7027 (G18b-L1): engine-side 'pathtypes' lane. A zombie walks 11 blocks to a still player past one hazard per arena (fence, wall,
// cactus, campfire, lava, water, cobweb, sweet berry bush, powder snow, magma, open/closed oak door, iron door, trapdoor) x 20 salts: per-tick pos + path
// nodes deterministic per salt, no path node stands on a refused (negative-penalty) type, and the node type of the hazard cell matches
// LandPathNodeMaker. Anti-vacuity: damage_cactus penalty -1 -> 0 and trapdoor treated as OPEN change the rows / the classification.
import { engineZombieTrace, harnessM, FEATURES, FEAT_X } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const F = ['pos', 'path'];
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const M = harnessM(), Ai = M.Ai, NT = Ai.NodeType;
const run = (f, s) => engineZombieTrace(s, { feature: f });
const base = {};
for (const f of FEATURES) {
  const tr = SALTS.map((s) => run(f, s));
  base[f] = tr;
  tr.forEach((R, i) => {
    ok(R.length === T, `${f} salt ${i}: ${R.length} rows`);
    ok(R.every((r) => r.pos && r.pos.every(Number.isFinite)), `${f} salt ${i}: pos`);
  });
  // the zombie's own aggro delay is salt dependent: most salts must path and walk
  ok(tr.filter((R) => R.some((r) => r.path && r.path.length > 1) && R[T - 1].pos[0] > 11.5).length >= 14, `${f}: fewer than 14 of 20 salts walked`);
  ok(compareTraces(tr[0], run(f, 0), { fields: F }) === null, `${f}: same salt, same trace`);
}
// no path node goes through a refused (negative penalty) cell, evaluated on the live world of the last run
const z = { type: 'zombie' };
const cls = {};
for (const f of FEATURES) { run(f, 0); const y = (f === 'lava' || f === 'water' || f === 'magma') ? -1 : 0; cls[f] = Ai.pathTypeAt(FEAT_X, y, 0); }
const want = { fence: NT.FENCE, wall: NT.FENCE, cactus: NT.DAMAGE_CACTUS, campfire: NT.DAMAGE_FIRE, lava: NT.LAVA, water: NT.WATER, cobweb: NT.WALKABLE, sweet_berry_bush: NT.DAMAGE_OTHER, powder_snow: NT.POWDER_SNOW, magma: NT.DAMAGE_OTHER, door_open: NT.DOOR_OPEN, door_closed: NT.DOOR_WOOD_CLOSED, iron_door: NT.DOOR_IRON_CLOSED, trapdoor: NT.TRAPDOOR };
for (const f of FEATURES) if (want[f] !== undefined && f !== 'lava' && f !== 'water' && f !== 'magma') ok(cls[f] === want[f], `${f}: node type ${cls[f]} != ${want[f]}`);
ok(Ai.pathPenalty(z, NT.DAMAGE_CACTUS) === -1, 'zombie damage_cactus penalty -1');
ok(Ai.pathPenalty(z, NT.TRAPDOOR) === 0, 'zombie trapdoor penalty 0');
for (const f of ['cactus', 'campfire', 'sweet_berry_bush', 'fence', 'wall'])
  ok(base[f].every((R) => R.every((r) => !r.path || r.path.every((q) => !(q[0] === FEAT_X && q[2] === 0 && q[1] === 0))) ), `${f}: a path node stands on the hazard cell`);
// anti-vacuity: cactus penalty -1 -> 0, trapdoor as OPEN (penalty 0 and node type OPEN)
const saved = Object.assign({}, Ai.DEFAULT_PENALTY);
Ai.pathPenalty = ((orig) => (e, t) => (t === NT.DAMAGE_CACTUS) ? 0 : orig(e, t))(Ai.pathPenalty);
const cact = run('cactus', 0);
const pta = Ai.pathTypeAt; Ai.pathTypeAt = (x, y, zz) => { const t = pta(x, y, zz); return t === NT.TRAPDOOR ? NT.OPEN : t; };
run('trapdoor', 0);
const asOpen = Ai.pathTypeAt(FEAT_X, 0, 0);
Ai.pathTypeAt = pta;
caught(compareTraces(base.cactus[0], cact, { fields: F }) !== null, 'cactus penalty 0 leaves the rows unchanged');
caught(asOpen !== want.trapdoor, 'trapdoor as OPEN leaves the classification unchanged');
caught(compareTraces(base.cactus[0], cact, { fields: F })?.field === 'path', 'cactus penalty 0: first divergence on path');
const mp = base.fence[0].map((r) => (r.path ? { ...r, path: r.path.map((q, i) => (i === 1 ? [q[0] + 1, q[1], q[2]] : q)) } : r));
caught(compareTraces(base.fence[0], mp, { fields: F })?.field === 'path', 'path node shifted');
caught(compareTraces(base.fence[0], base.fence[0].slice(1), { fields: F }) !== null, 'row shift');
console.log(`${n} assertions, ${bad} failures, ${breaks} breaks caught (${FEATURES.length} arenas x ${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
