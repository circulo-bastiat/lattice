#!/usr/bin/env node
// lockstep-swimnav -- #8876 (G18b-L42): engine-side 'swimnav' lane: drowned, turtle (home on the shore), axolotl, dolphin and guardian each given the same walk
// target past three arenas (a flooded 1x2 tunnel with a land exit, a surface pond with a lily pad and a one-block air gap, a shore step), 20 salts.
// The mobs start in an open flooded pool (x 8..14). Rows: pos + the first 20 path nodes (SwimNavigation / AmphibiousNavigation / TurtleSwimNavigation node choice per mob). Deterministic per salt; the
// swimmers' paths must stay in water, the land walkers must reach the exit. Anti-vacuity: WATER_BORDER treated as walkable for the drowned, a turtle
// without its nodeOk, the axolotl WATER_BORDER malus 4 -> 0, a path node shift and a row shift are caught. Server rows: pending a golden.
import { engineZombieTrace, harnessM } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';

let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const MOBS = ['drowned', 'turtle', 'axolotl', 'dolphin', 'guardian'];
const ARENAS = ['tunnel', 'pond', 'shore'];
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const TT = 80, F = ['pos', 'path', 'types'];
const M = harnessM(), Ai = M.Ai, NT = Ai.NodeType;
const GX = 24;
const SIZE = { drowned: { w: 0.6, h: 1.95 }, turtle: { w: 1.2, h: 0.4 }, axolotl: { w: 0.75, h: 0.42 }, dolphin: { w: 0.9, h: 0.6 }, guardian: { w: 0.85, h: 0.85 } };

// open pool x 8..14 (y 0..1), then per arena x 15..21: tunnel = walled flooded 1x2 (y 0..1, roof y 2); pond = 1-deep surface water, ceiling at y 1 except the
// lily-pad cell x 18 (the one-block air gap); shore = 3-wide 2-deep water then a one-block step up (floor y 0) from x 22. Land exit: floor y -1 (y 0 on shore).
function build({ w, M: m }, arena) {
  const S = m.States, stone = S.stateOf('stone'), water = S.stateOf('water');
  for (let x = 8; x <= 25; x++) for (let z = -1; z <= 1; z++) for (let y = 0; y <= 2; y++) w.set(x, y, z, 0);
  for (let x = 8; x <= 14; x++) for (let z = -1; z <= 1; z++) for (let y = 0; y <= 1; y++) w.set(x, y, z, water);
  for (let x = 15; x <= 21; x++) {
    if (arena === 'tunnel') {
      for (let z = -1; z <= 1; z++) for (let y = 0; y <= 2; y++) if (z !== 0 || y === 2) w.set(x, y, z, stone);
      w.set(x, 0, 0, water); w.set(x, 1, 0, water);
    } else if (arena === 'pond') {
      for (let z = -1; z <= 1; z++) { w.set(x, 0, z, water); if (x !== 18) w.set(x, 1, z, stone); }
      w.set(18, 1, 0, S.stateOf('lily_pad'));
    } else for (let z = -1; z <= 1; z++) { w.set(x, 0, z, water); w.set(x, 1, z, water); }
  }
  if (arena === 'shore') for (let x = 22; x <= 25; x++) for (let z = -1; z <= 1; z++) w.set(x, 0, z, stone);
}

// the drowned's MobNavigation node types on the bank cells beside the water (where it leaves the pool): WATER_BORDER for LandPathNodeMaker
const shoreTypes = () => [22, 23, 24].map((x) => Ai.pathTypeAt(x, 0, 0)).concat([22].map((x) => Ai.pathTypeAt(x, 1, 0)));
function run(mob, arena, salt) {
  let nav = null;
  return engineZombieTrace(salt, {
    mob, noAI: true, T: TT, build: (h) => build(h, arena),
    extra: () => ({ path: nav ? nav.slice(0, 20).map((q) => [q.x, q.y, q.z]) : null, types: mob === 'drowned' && nav ? nav.slice(0, 20).map((q) => Ai.pathTypeAt(q.x, q.y, q.z)).concat(shoreTypes()) : null }),
    onTick: (t, EL) => {
      const e = EL.list.find((x) => x.type === mob), ty = arena === 'shore' ? 1 : 0;
      if (mob === 'turtle' && t === 1) { M.Turtle.setHomePos(e, GX, ty, 0); e.activelyTravelling = true; }
      if (t % 10 === 1) {
        if (mob === 'turtle') nav = Ai.findPath(e.x, e.y, e.z, GX + 0.5, ty, 0.5, { mob: e, partial: true, nodeOk: M.Turtle.nodeOk(e) });
        else if (mob === 'axolotl') nav = M.Axolotl.amphibiousPath(e.x, e.y, e.z, GX + 0.5, ty, 0.5);
        else if (mob === 'drowned') nav = e.inWater ? Ai.findSwimPath(e.x, e.y, e.z, GX + 0.5, ty, 0.5, { partial: true }) : Ai.findPath(e.x, e.y, e.z, GX + 0.5, ty, 0.5, { mob: e, partial: true });
        else nav = Ai.findSwimPath(e.x, e.y, e.z, GX + 0.5, ty, 0.5, { partial: true, breach: mob === 'dolphin', box: SIZE[mob] });
      }
      if (nav && nav.length > 1) Ai.stepToward(e, nav[1], 1.0);
    },
  });
}

const base = {};
for (const mob of MOBS) for (const a of ARENAS) base[mob + '/' + a] = SALTS.map((s) => run(mob, a, s));
for (const [k, rs] of Object.entries(base)) rs.forEach((R, i) => {
  ok(R.length === TT, `${k} salt ${i}: ${R.length} rows`);
  ok(R.every((r) => r.pos.every(Number.isFinite)), `${k} salt ${i}: pos`);
  ok(R.some((r) => r.path && r.path.length > 1), `${k} salt ${i}: never pathed`);
});
ok(compareTraces(base['dolphin/tunnel'][0], run('dolphin', 'tunnel', 0), { fields: F }) === null, 'same salt, same trace');
// swimmers: every node of a SwimNavigation path is a water cell (or the breach cell above it for the dolphin)
const wat = (x, y, z) => M.States.waterIn[M.World.getBlock(x, y, z)];
for (const mob of ['guardian']) for (const a of ARENAS) { run(mob, a, 0); ok(base[mob + '/' + a][0].every((r) => !r.path || r.path.every((q) => wat(q[0], q[1], q[2]) || a === 'shore' && q[1] === 1)), `${mob}/${a}: a swim path node outside water`); }
// anti-vacuity 1: WATER_BORDER walkable for the drowned (as WALKABLE, penalty 0)
const pta = Ai.pathTypeAt;
const walkRows = (mob) => ARENAS.map((a) => SALTS.map((s) => run(mob, a, s)));
Ai.pathTypeAt = (x, y, z) => { const t = pta(x, y, z); return t === NT.WATER_BORDER ? NT.WALKABLE : t; };
const dr = walkRows('drowned');
Ai.pathTypeAt = pta;
const same = (a, b) => a.every((r, ai) => r.every((R, si) => compareTraces(base['drowned/' + ARENAS[ai]][si], R, { fields: F }) === null));
caught(!same(dr, dr) || !same(ARENAS.map((a) => base['drowned/' + a]), dr), 'drowned WATER_BORDER as walkable leaves the rows unchanged');
// anti-vacuity 2: the axolotl WATER_BORDER malus 4 -> 0
const ax = M.Axolotl.NODE_PENALTY, saved = ax.WATER_BORDER;
ax.WATER_BORDER = 0;
const axb = ARENAS.map((a) => SALTS.map((s) => run('axolotl', a, s)));
ax.WATER_BORDER = saved;
caught(axb.some((rs, ai) => rs.some((R, si) => compareTraces(base['axolotl/' + ARENAS[ai]][si], R, { fields: F }) !== null)), 'axolotl WATER_BORDER malus 0 leaves the rows unchanged');
// anti-vacuity 3: TurtleSwimNavigation.isValidPosition dropped
const no = M.Turtle.nodeOk; M.Turtle.nodeOk = () => () => true;
const tb = ARENAS.map((a) => SALTS.map((s) => run('turtle', a, s)));
M.Turtle.nodeOk = no;
caught(tb.some((rs, ai) => rs.some((R, si) => compareTraces(base['turtle/' + ARENAS[ai]][si], R, { fields: F }) !== null)), 'turtle without nodeOk leaves the rows unchanged');
const b0 = base['guardian/tunnel'][0];
const mp = b0.map((r, t) => (t === 40 && r.path ? { ...r, path: r.path.map((q, i) => (i === 1 ? [q[0] + 1, q[1], q[2]] : q)) } : r));
caught(compareTraces(b0, mp, { fields: F })?.field === 'path', 'path node shifted');
caught(compareTraces(b0, b0.slice(1), { fields: F }) !== null, 'row shift');
console.log(`${n} assertions, ${bad} failures, ${breaks} breaks caught (${MOBS.length} mobs x ${ARENAS.length} arenas x ${SALTS.length} salts x ${TT} ticks)`);
process.exit(bad ? 1 : 0);
