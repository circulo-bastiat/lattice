#!/usr/bin/env node
// physcheck.mjs — collision against real block shapes, before it can go wrong.
//
//   node tools/physcheck.mjs
//
// `clip()` is the only collision primitive in the project and every movement in the game
// goes through it. It has always assumed each solid voxel fills its whole cell — true for
// the 49 blocks the world holds today, false for most of the 1.18.2 roster. A slab you
// cannot step onto, or a player stopped in mid-air beside a fence, both come out of that
// assumption.
//
// The change adds a general path BESIDE the old one rather than replacing it: `shapeAt`
// returns `Ph.FULL_CUBE` by identity for a full cube and `clip` tests that identity, so the
// common case runs the code it always ran. This file proves both halves — that today's
// behaviour is untouched, and that the general path is right where it takes over.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator


const ASSETS = MCLITE_ROOT + 'assets';
const SRC = MCLITE_ROOT + 'src';
const NS = {};
globalThis.MCL = NS;
// ⚠ `02c_states.js` is in this list because §1 now asks what the GAME sees, and the game reads
// `States` — the table `Reg.init` fills. Without it `NS.States` is undefined and the section
// that would have caught D-152 cannot run at all.
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
                 '02c_states.js', '03_section.js', '05_mesher.js', '14b_physics.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const gm = JSON.parse(readFileSync(join(ASSETS, 'block-geometry.meta.json'), 'utf8'));
const rm = JSON.parse(readFileSync(join(ASSETS, 'block-runtime.meta.json'), 'utf8'));
NS.Reg.init({
  runtime: readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64'), runtimeBytes: rm.rawBytes,
  geometry: readFileSync(join(ASSETS, 'block-geometry.bin')).toString('base64'), geometryBytes: gm.rawBytes,
});
NS.Blocks.init();
const B = NS.Blocks, Ph = NS.Physics, R = NS.Reg;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ─────────────────────────────────────────────── 1. the path the GAME takes
// ⚠ THIS SECTION USED TO ASSERT THE BUG. It required `Ph.shapesFor` — the function `shapeAt`
// calls, and therefore the only one the game itself uses — to return `FULL_CUBE` for every
// block, which is exactly what the stub did while the rest of this file tested the real
// `shapesForState` beside it. Two sessions of slabs you could not step onto (D-152). What it
// asserts now is that the two are THE SAME FUNCTION for every state, and that the full cubes
// still come back by identity so `clip` keeps its fast path.
console.log('1. shapesFor IS shapesForState, and full cubes still come back by identity');
{
  const SR = NS.States;
  let differ = 0, firstDiff = null, cubes = 0, shaped = 0;
  for (let st = 1; st < SR.count; st += 7) {                 // a seventh of 20,344 states
    const a = Ph.shapesFor(st), b = Ph.shapesForState(st);
    if (a !== b) { differ++; if (!firstDiff) firstDiff = SR.name(st); }
    if (a === Ph.FULL_CUBE) cubes++; else if (a) shaped++;
  }
  ok(differ === 0, `${differ} states where shapesFor disagrees with shapesForState (first: ${firstDiff}) — the game is not using the real shapes`);
  ok(cubes > 100, `only ${cubes} states are full cubes — the fast path has been lost`);
  ok(shaped > 100, `only ${shaped} states have a real shape — the general path is not reachable`);
  ok(Ph.shapesFor(SR.stateOf('stone')) === Ph.FULL_CUBE, 'stone must be the FULL_CUBE object itself, not a copy');
  ok(Ph.shapesFor(SR.stateOf('oak_slab')) !== Ph.FULL_CUBE, 'an oak slab must NOT collide as a full cube');
  ok(Ph.shapesFor(SR.stateOf('dandelion')) === null, 'a dandelion must have no collision at all');
  ok(Ph.FULL_CUBE.length === 1 && Ph.FULL_CUBE[0].join() === '0,0,0,1,1,1', 'FULL_CUBE is the unit cube');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 2. the registry shapes, read back
console.log('2. real shapes for the roster');
const reg = JSON.parse(readFileSync(join(ASSETS, 'block-registry.json'), 'utf8'));
const realState = (name, want) => {
  const bi = R.id[name];
  const e = reg.find((x) => x.name === name);
  const props = JSON.parse(readFileSync(join(ASSETS, 'block-constants.json'), 'utf8')).blocks[name].props;
  // enumerate the REAL state space the same way pack-runtime did: last property varies fastest
  let rows = [{}];
  for (const p of props) { const nx = []; for (const r of rows) for (const v of p.values) nx.push({ ...r, [p.name]: v }); rows = nx; }
  const i = rows.findIndex((st) => Object.entries(want).every(([k, v]) => st[k] === v));
  void e;
  return { global: R.realFirst[bi] + i, local: i };
};
{
  const stone = realState('stone', {});
  ok(Ph.shapesForState(stone.global) === Ph.FULL_CUBE, 'stone resolves to FULL_CUBE by identity');

  const slab = realState('oak_slab', { type: 'bottom', waterlogged: 'false' });
  const sb = Ph.shapesForState(slab.global);
  ok(sb !== Ph.FULL_CUBE, 'a bottom slab must NOT be the full cube');
  ok(sb && sb.length === 1, `a bottom slab is one box, got ${sb && sb.length}`);
  if (sb && sb[0]) {
    ok(near(sb[0][1], 0) && near(sb[0][4], 0.5), `bottom slab y is ${sb[0][1]}..${sb[0][4]}, expected 0..0.5`);
    ok(near(sb[0][0], 0) && near(sb[0][3], 1), 'a bottom slab is full width in x');
  }
  const top = Ph.shapesForState(realState('oak_slab', { type: 'top', waterlogged: 'false' }).global);
  ok(top && near(top[0][1], 0.5) && near(top[0][4], 1), `top slab y is ${top && top[0][1]}..${top && top[0][4]}, expected 0.5..1`);
  ok(Ph.shapesForState(realState('oak_slab', { type: 'double', waterlogged: 'false' }).global) === Ph.FULL_CUBE,
     'a double slab is a full cube');

  // a fence is 1.5 blocks tall to collide with — taller than it looks
  const fence = Ph.shapesForState(realState('oak_fence', { north: 'true', east: 'true', south: 'true', west: 'true', waterlogged: 'false' }).global);
  ok(fence && fence.some((b2) => b2[4] > 1.0), `a fence must reach above y=1, max ${fence && Math.max(...fence.map((b2) => b2[4]))}`);

  // and a flower collides with nothing at all
  const flower = Ph.shapesForState(realState('dandelion', {}).global);
  ok(flower === null, `a dandelion must have no collision at all, got ${JSON.stringify(flower)}`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 3. clip, against a hand-built world
// A tiny fake world so clip can be exercised without a chunk store. Cell (0,0,0) holds
// whatever shape the test sets; everything else is empty.
console.log('2b. solidAt is shapeAt, so the ungenerated-column rule lives in one place');
{
  const saved = Ph.shapeAt;
  Ph.shapeAt = (x) => (x === 1 ? Ph.FULL_CUBE : (x === 2 ? [[0, 0, 0, 1, 0.5, 1]] : null));
  ok(Ph.solidAt(1, 0, 0) === true, 'a full cube is solid');
  ok(Ph.solidAt(2, 0, 0) === true, 'a slab is solid too - a partial shape is still a collider');
  ok(Ph.solidAt(3, 0, 0) === false, 'an empty cell is not solid');
  Ph.shapeAt = saved;
}
console.log(`   ${pass} ok`);

console.log('3. clip() against a single shaped cell');
{
  let SHAPE = null;
  Ph.shapeAt = function (x, y, z) { return (x === 0 && y === 0 && z === 0) ? SHAPE : null; };

  // a full cube: the box stops at its face, exactly as before shapes existed
  // ⚠ the probe box must start CLEAR of the cell. The first draft spanned x -0.3..0.3,
  // which already overlaps cell 0, so clip correctly answered "you cannot move at all" and
  // the test read that as a failure. Start at -1.0..-0.4 and there is 0.4 of room.
  SHAPE = Ph.FULL_CUBE;
  const slide = Ph.clip(-1.0, 0.2, 0.2, -0.4, 0.8, 0.8, 0, 1.0);
  ok(near(slide, 0.4 - Ph.EPS, 1e-4),
     `a box sliding +X into a full cube should stop 0.4 short of its face, moved ${slide}`);

  // a bottom slab: falling stops at y = 0.5, not y = 1
  SHAPE = [[0, 0, 0, 1, 0.5, 1]];
  const fall = Ph.clip(0.2, 0.6, 0.2, 0.8, 1.6, 0.8, 1, -1.0);
  ok(near(fall, -(0.6 - 0.5) + Ph.EPS, 1e-4), `falling onto a bottom slab should stop at 0.5, moved ${fall}`);

  // a TOP slab: the same fall passes through the empty lower half and stops at 1.0... no —
  // a top slab occupies 0.5..1, so a box whose bottom is at 0.6 is already inside it. Drop
  // from above instead, and it must stop at y = 1.
  SHAPE = [[0, 0.5, 0, 1, 1, 1]];
  const onTop = Ph.clip(0.2, 1.4, 0.2, 0.8, 2.4, 0.8, 1, -1.0);
  ok(near(onTop, -(1.4 - 1.0) + Ph.EPS, 1e-4), `falling onto a top slab should stop at 1.0, moved ${onTop}`);

  // ⚠ the overlap test. A box passing BESIDE a half-width block must not be stopped by it.
  // Without the cross-axis check every partial shape stops a player the width of a whole cell.
  SHAPE = [[0, 0, 0, 0.25, 1, 1]];                       // a thin slice on the -X side
  const beside = Ph.clip(0.4, 0.2, 0.2, 0.9, 0.8, 0.8, 1, -1.0);
  ok(near(beside, -1.0), `a box entirely clear of the shape in x must fall freely, moved ${beside}`);
  const into = Ph.clip(-0.6, 0.2, 0.2, -0.1, 0.8, 0.8, 0, 1.0);
  ok(near(into, 0.1 - Ph.EPS, 1e-4), `sliding +X into a 0..0.25 slice should stop at x=0, moved ${into}`);

  // no collision at all
  SHAPE = null;
  ok(near(Ph.clip(0.2, 0.6, 0.2, 0.8, 1.6, 0.8, 1, -1.0), -1.0), 'an empty cell stops nothing');

  // several boxes: the NEAREST one wins
  // Two boxes with a gap between them, and a probe that starts in the gap: the LOWER box is
  // what it lands on. (The first draft's probe already overlapped the upper box, so clip
  // answered 0 — correctly, and the test was wrong.)
  SHAPE = [[0, 0, 0, 1, 0.25, 1], [0, 0.9, 0, 1, 1, 1]];
  const two = Ph.clip(0.2, 0.5, 0.2, 0.8, 0.85, 0.8, 1, -1.0);
  ok(near(two, -(0.5 - 0.25) + Ph.EPS, 1e-4), `with two boxes the nearer must win, moved ${two}`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 4. anti-vacuity
console.log('4. anti-vacuity: break it, and it must be caught');
{
  const av = [];
  const brk = (label, inv, mk) => av.push([label, inv(mk(false)) === true && inv(mk(true)) === false]);
  brk('a slab treated as a full cube', (r) => r !== Ph.FULL_CUBE,
      (b) => (b ? Ph.FULL_CUBE : Ph.shapesForState(realState('oak_slab', { type: 'bottom', waterlogged: 'false' }).global)));
  brk('a flower given a collision box', (r) => r === null,
      (b) => (b ? Ph.FULL_CUBE : Ph.shapesForState(realState('dandelion', {}).global)));
  brk('the fast path lost its identity check', (same) => same === true,
      (b) => (b ? Ph.shapesFor(NS.States.stateOf('stone')) === [[0, 0, 0, 1, 1, 1]]
                : Ph.shapesFor(NS.States.stateOf('stone')) === Ph.FULL_CUBE));
  // ⚠ the one D-152 would have failed on: the game's own entry point must not be a stub
  brk('shapesFor returning a full cube for everything (the D-152 stub)', (isCube) => isCube === false,
      (b) => (b ? true : Ph.shapesFor(NS.States.stateOf('oak_slab')) === Ph.FULL_CUBE));
  brk('the cross-axis overlap test removed', (moved) => near(moved, -1.0),
      (b) => {
        let S = [[0, 0, 0, 0.25, 1, 1]];
        Ph.shapeAt = function (x, y, z) { return (x === 0 && y === 0 && z === 0) ? (b ? Ph.FULL_CUBE : S) : null; };
        return Ph.clip(0.4, 0.2, 0.2, 0.9, 0.8, 0.8, 1, -1.0);
      });
  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" is not distinguished from correct behaviour`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ physcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
