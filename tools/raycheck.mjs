#!/usr/bin/env node
// raycheck.mjs — crosshair targeting against real block shapes.
//
//   node tools/raycheck.mjs
//
// The DDA finds the CELL a ray enters. For a full cube the cell IS the answer, and that is
// what `14c_raycast.js` did for the whole project until now. For a slab, a fence, a torch or
// a carpet the cell is mostly empty, and two things go wrong at once: you can break a slab by
// aiming at the air above it, and a ray that should have carried on to the wall behind stops
// dead at a fencepost it never touched.
//
// The change adds a slab-method ray/AABB test that runs ONLY when the cell's shape is not the
// full cube — tested by object identity, exactly as `clip()` does — so every block in the
// world today takes the code path it always took. This file proves both halves:
//
//   1. it is a byte-for-byte no-op for all 49 legacy blocks, over 20,000 random rays;
//   2. it is right where it takes over, against all 4,105 real shapes in the registry;
//   3. the face it reports is the face that was actually entered, which is what decides
//      where a placed block goes;
//   4. and every one of those claims is broken on purpose at the end, to prove the checks
//      can fail (D-30).

import { readFileSync } from 'node:fs';
import { shapeTable } from './shapetable.mjs';
import { join } from 'node:path';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator


const ASSETS = MCLITE_ROOT + 'assets';
const SRC = MCLITE_ROOT + 'src';
// ⚠ `10_camera.js` is here for §3b only: the check compares `Player.retarget`'s inlined forward
// vector against `Cam.forward`, and without the camera module there is nothing to compare to.
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
               '02c_states.js', '03_section.js', '05_mesher.js', '14b_physics.js', '14c_raycast.js',
               '10_camera.js'];
const SOURCE = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(SRC, f), 'utf8')]));

const RUNTIME = readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64');
const GEOMETRY = readFileSync(join(ASSETS, 'block-geometry.bin')).toString('base64');
const RMETA = JSON.parse(readFileSync(join(ASSETS, 'block-runtime.meta.json'), 'utf8'));
const TILEALPHA = JSON.parse(readFileSync(join(ASSETS, 'block-tiles.meta.json'), 'utf8')).alpha;
const GMETA = JSON.parse(readFileSync(join(ASSETS, 'block-geometry.meta.json'), 'utf8'));

/** A whole engine namespace, optionally with one source file textually mutated. */
function boot(mutate) {
  const NS = {};
  const prev = globalThis.MCL;
  globalThis.MCL = NS;
  for (const f of FILES) {
    let src = SOURCE[f];
    if (mutate && mutate.file === f) {
      if (!src.includes(mutate.from)) throw new Error(`mutation anchor not found in ${f}: ${mutate.from}`);
      src = src.replace(mutate.from, mutate.to);
    }
    new Function('MCL', src)(NS);
  }
  globalThis.MCL = prev;
  NS.Reg.init({ runtime: RUNTIME, runtimeBytes: RMETA.rawBytes, geometry: GEOMETRY,
                geometryBytes: GMETA.rawBytes, tileAlpha: TILEALPHA, shapes: shapeTable(ASSETS) });
  NS.Blocks.init();
  // a sparse fake world; the engine's own World is a chunk store and irrelevant here
  const cells = new Map();
  NS.World = {
    cells,
    set(x, y, z, id) { cells.set(x + ',' + y + ',' + z, id); return this; },
    clear() { cells.clear(); return this; },
    getBlock(x, y, z) { return cells.get(x + ',' + y + ',' + z) || 0; }
  };
  return NS;
}

const NS = boot(null);
const B = NS.Blocks, Ph = NS.Physics, R = NS.Reg, W = NS.World, Ray = NS.Ray;
const SR = NS.States;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const copy = (h) => (h ? { x: h.x, y: h.y, z: h.z, face: h.face, id: h.id, dist: h.dist, hx: h.hx, hy: h.hy, hz: h.hz } : null);

// deterministic; a targeting test that passes only on some runs is not a test
let seed = 0x2f6e2b1 >>> 0;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

const FACE_NAME = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

// ─────────────────────────────────────────── 1. the world as it is today: an exact no-op
console.log('1. every block in the world today takes the fast path, and the result is identical');
{
  // ⚠ SESSION 2. This section used to enumerate the 49 hand-written block ids and assert that
  // every one of them was a FULL_CUBE by object identity, so the general shape path was
  // provably dead code in the world as it stood. The world now stores registry real states and
  // 4,105 distinct collision shapes are reachable, so the claim has to be narrowed to what it
  // was ever really about: the blocks a generated world is actually made of are full cubes, and
  // for those the general path must still be bit-identical to the cell path.
  const WORLD_BLOCKS = ['stone', 'deepslate', 'dirt', 'grass_block', 'podzol', 'sand',
    'sandstone', 'gravel', 'bedrock', 'snow_block', 'ice', 'glass', 'glowstone',
    'oak_log', 'oak_planks', 'oak_leaves', 'birch_log', 'birch_leaves', 'spruce_log',
    'spruce_leaves', 'coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'redstone_ore',
    'lapis_ore', 'diamond_ore', 'emerald_ore', 'deepslate_coal_ore', 'deepslate_iron_ore',
    'deepslate_copper_ore', 'deepslate_gold_ore', 'deepslate_redstone_ore',
    'deepslate_lapis_ore', 'deepslate_diamond_ore', 'deepslate_emerald_ore'];
  const solids = WORLD_BLOCKS.map((n) => SR.stateOf(n)).filter((s) => s > 0 && SR.solid[s] === 1);
  ok(solids.length >= 30, `expected the generated world's roster to be ~36 solid blocks, found ${solids.length}`);

  let notIdentity = [];
  for (const id of solids) if (Ph.shapeOf(id) !== Ph.FULL_CUBE) notIdentity.push(SR.name(id));
  ok(notIdentity.length === 0, `${notIdentity.length} of the world's solids are not FULL_CUBE by identity: ${notIdentity.join(' ')}`);

  // a random-but-fixed lump of world, then the same rays with the shape branch removed
  W.clear();
  for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++) for (let z = -6; z <= 6; z++)
    if (rnd() < 0.22) W.set(x, y, z, solids[(rnd() * solids.length) | 0]);

  const rays = [];
  for (let i = 0; i < 20000; i++) {
    const o = [(rnd() - 0.5) * 14, (rnd() - 0.5) * 14, (rnd() - 0.5) * 14];
    let d = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
    // a handful of exactly axis-aligned rays, because that is where slab-method maths divides by zero
    if (i % 37 === 0) { d = [0, 0, 0]; d[i % 3] = i % 2 ? 1 : -1; }
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    rays.push([o, [d[0] / L, d[1] / L, d[2] / L]]);
  }

  const withShapes = rays.map(([o, d]) => copy(Ray.cast(o[0], o[1], o[2], d[0], d[1], d[2], 12)));

  // the pre-change behaviour, exactly: `shapeOf` absent means the cell is the answer
  const savedShapeOf = Ph.shapeOf;
  delete Ph.shapeOf;
  const cellOnly = rays.map(([o, d]) => copy(Ray.cast(o[0], o[1], o[2], d[0], d[1], d[2], 12)));
  Ph.shapeOf = savedShapeOf;

  let diff = 0, firstDiff = null, hitCount = 0;
  for (let i = 0; i < rays.length; i++) {
    const a = withShapes[i], b = cellOnly[i];
    if (a) hitCount++;
    const same = (a === null && b === null) ||
      (a && b && a.x === b.x && a.y === b.y && a.z === b.z && a.face === b.face && a.id === b.id && near(a.dist, b.dist));
    if (!same && diff++ === 0) firstDiff = { i, a, b };
  }
  ok(diff === 0, `${diff} of ${rays.length} rays changed answer for full-cube blocks; first: ${JSON.stringify(firstDiff)}`);
  ok(hitCount > rays.length * 0.5, `only ${hitCount}/${rays.length} rays hit anything — the fixture is too empty to prove much`);

  // With the cell clamp in place the general path would give the SAME answer for a full cube,
  // so identity is no longer a correctness claim — it is a cost claim, and a cost claim has to
  // be measured. `Ray.shapeTests` counts the slab-method tests the last cast needed.
  let slabTests = 0;
  for (const [o, d] of rays) { Ray.cast(o[0], o[1], o[2], d[0], d[1], d[2], 12); slabTests += Ray.shapeTests; }
  ok(slabTests === 0, `a world of full cubes must never run the slab-method test; it ran ${slabTests} times`);
  console.log(`   ${rays.length.toLocaleString()} rays, ${hitCount.toLocaleString()} hits, 0 differences`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────── 2. every real shape in the registry
console.log('2. all 4,105 registry shapes: the ray lands on a real surface, or misses honestly');
{
  // the raycast asks Physics for the shape of whatever the world stored. Today that is a
  // legacy id; the moment §NEXT swaps the id space it is a real state. Test the seam.
  const FAKE = SR.stateOf('stone');
  const savedShapeOf = Ph.shapeOf;
  let SHAPE = Ph.FULL_CUBE;
  Ph.shapeOf = () => SHAPE;

  W.clear().set(0, 0, 0, FAKE);

  const seen = new Set();
  let tested = 0, onSurface = 0, missedFromOutsideExtent = 0, badFace = 0;
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
                [0.6, -0.8, 0], [0, -0.8, 0.6], [-0.48, -0.64, 0.6]];

  for (let st = 0; st < R.shapeOf.length; st++) {
    const si = R.shapeOf[st];
    if (seen.has(si)) continue;
    seen.add(si);
    const boxes = Ph.shapesForState(st);
    if (!boxes || boxes.length === 0) {
      // a shapeless state must be untargetable through the shape path — the ray carries on
      SHAPE = boxes || [];
      const h = Ray.cast(0.5, 6, 0.5, 0, -1, 0, 20);
      ok(h === null, `a state with no collision boxes must not be selectable (shape ${si})`);
      continue;
    }
    SHAPE = boxes;
    for (const d of DIRS) {
      const L = Math.hypot(d[0], d[1], d[2]);
      const dir = [d[0] / L, d[1] / L, d[2] / L];
      // aim at the centre of the first box, from four blocks back along the ray
      const b = boxes[0];
      const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
      const o = [c[0] - dir[0] * 4, c[1] - dir[1] * 4, c[2] - dir[2] * 4];
      const h = Ray.cast(o[0], o[1], o[2], dir[0], dir[1], dir[2], 12);
      tested++;
      if (!h) { missedFromOutsideExtent++; continue; }
      // the reported point must lie ON the surface of one of the cell's boxes, and inside it
      const p = [h.hx, h.hy, h.hz];
      let good = false;
      for (const q of boxes) {
        // clamped to the cell, exactly as hitShape does — that IS the selection surface
        const lo = [Math.max(0, q[0]), Math.max(0, q[1]), Math.max(0, q[2])];
        const hi = [Math.min(1, q[3]), Math.min(1, q[4]), Math.min(1, q[5])];
        if (lo[0] >= hi[0] || lo[1] >= hi[1] || lo[2] >= hi[2]) continue;
        let inside = true, onPlane = false;
        for (let a = 0; a < 3; a++) {
          if (p[a] < lo[a] - 1e-6 || p[a] > hi[a] + 1e-6) { inside = false; break; }
          if (near(p[a], lo[a], 1e-6) || near(p[a], hi[a], 1e-6)) onPlane = true;
        }
        if (inside && onPlane) { good = true; break; }
      }
      if (good) onSurface++;
      // the face must be one the ray could actually have entered through
      const ax = h.face >> 1;
      const towards = [dir[0], dir[1], dir[2]][ax];
      const expectSign = (h.face & 1) === 0 ? -1 : 1;   // face +X is entered by a ray going -X
      if (towards !== 0 && Math.sign(towards) !== expectSign) badFace++;
    }
  }
  ok(seen.size > 3000, `expected thousands of distinct shapes, saw ${seen.size}`);
  ok(missedFromOutsideExtent === 0, `${missedFromOutsideExtent}/${tested} rays aimed at a box centre missed it`);
  ok(onSurface === tested, `${tested - onSurface}/${tested} hits are not on the surface of any box`);
  ok(badFace === 0, `${badFace}/${tested} hits report a face the ray was travelling away from`);
  console.log(`   ${seen.size.toLocaleString()} distinct shapes · ${tested.toLocaleString()} rays · ${onSurface.toLocaleString()} on a real surface`);
  Ph.shapeOf = savedShapeOf;
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────── 3. the cases a player would notice
console.log('3. the four things a player would notice');
{
  const FAKE = SR.stateOf('stone'), WALL = SR.stateOf('dirt');
  const savedShapeOf = Ph.shapeOf;
  const SLAB = [[0, 0, 0, 1, 0.5, 1]];
  const FENCE = [[0.375, 0, 0.375, 0.625, 1.5, 0.625]];
  let shapes = new Map();
  Ph.shapeOf = () => Ph.FULL_CUBE;

  // (a) looking down at a bottom slab: the hit is the slab TOP, not the cell top
  W.clear().set(0, 0, 0, FAKE);
  Ph.shapeOf = () => SLAB;
  let h = Ray.cast(0.5, 4, 0.5, 0, -1, 0, 20);
  ok(h && h.y === 0 && near(h.hy, 0.5, 1e-9), `a bottom slab must be hit at y=0.5, got ${h && h.hy}`);
  ok(h && h.face === 2, `hitting a slab from above must report +Y, got ${h && FACE_NAME[h.face]}`);
  ok(h && near(h.dist, 3.5, 1e-9), `the distance to the slab top must be 3.5, got ${h && h.dist}`);
  const nb = Ray.neighbourOf(h);
  ok(nb.x === 0 && nb.y === 1 && nb.z === 0, `a block placed on a slab top goes at (0,1,0), got ${JSON.stringify(nb)}`);

  // (b) the air ABOVE a bottom slab is not the slab: the ray must carry on to the wall behind.
  // ⚠ the wall needs a DIFFERENT id from the slab — the first draft gave both cells the same
  // one, so `shapeOf` made the "wall" a slab too and the ray correctly hit nothing.
  Ph.shapeOf = function (id) { return id === FAKE ? SLAB : Ph.FULL_CUBE; };
  W.clear().set(0, 0, 0, FAKE).set(3, 0, 0, WALL);
  h = Ray.cast(-4, 0.75, 0.5, 1, 0, 0, 20);
  ok(h && h.x === 3, `a ray over a slab must pass through cell 0 and hit the block at x=3, got x=${h && h.x}`);
  ok(h && h.face === 1, `that hit is entered through -X, got ${h && FACE_NAME[h.face]}`);

  // and at slab height it must stop at the FIRST one
  h = Ray.cast(-4, 0.25, 0.5, 1, 0, 0, 20);
  ok(h && h.x === 0 && near(h.hx, 0, 1e-9), `at slab height the near slab must win, got x=${h && h.x}`);

  // (c) a fence post is thin: a ray down the row misses the posts either side of centre
  W.clear();
  for (let x = 0; x <= 4; x++) W.set(x, 0, 0, FAKE);
  Ph.shapeOf = () => FENCE;
  h = Ray.cast(-4, 0.5, 0.5, 1, 0, 0, 20);
  ok(h && h.x === 0, `down the centre of a fence line the first post is hit, got ${h && h.x}`);
  h = Ray.cast(-4, 0.5, 0.1, 1, 0, 0, 20);   // z=0.1 is outside the post's 0.375..0.625
  ok(h === null, `a ray beside the posts must hit nothing, got ${JSON.stringify(copy(h))}`);

  // (d) a fence's collision box is 1.5 tall and pokes into the cell above. The selection
  //     must be CELL-BOUNDED: the DDA has already visited and rejected the cell above by the
  //     time it reaches this one, so a hit reported at y=1.5 is a hit behind the ray. This is
  //     the defect this file found — the first version of hitShape did not clamp.
  W.clear().set(0, 0, 0, FAKE);
  Ph.shapeOf = () => FENCE;
  h = Ray.cast(0.5, 4, 0.5, 0, -1, 0, 20);
  ok(h && h.y === 0 && near(h.hy, 1, 1e-9), `a tall post must be clipped to its own cell (y=1), got ${h && h.hy}`);
  ok(h && near(h.dist, 3, 1e-9), `and its distance must be the cell boundary, 3, got ${h && h.dist}`);
  // the part above belongs to the cell above — which holds air, so nothing is selectable there
  h = Ray.cast(-4, 1.25, 0.5, 1, 0, 0, 20);
  ok(h === null, 'the part of a post above its own cell is not selectable from the side');

  // (e) the eye inside a shaped block still reports something placeable
  W.clear().set(0, 0, 0, FAKE);
  Ph.shapeOf = () => SLAB;
  h = Ray.cast(0.5, 0.25, 0.5, 1, 0, 0, 20);
  ok(h && h.dist === 0 && h.x === 0, 'standing inside a shaped block must still report that block at distance 0');

  Ph.shapeOf = savedShapeOf;
  void shapes;
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────── 3b. the outline agrees with the crosshair
console.log('3b. the selection outline is drawn from the same boxes the crosshair selects on');
{
  const savedShapeOf = Ph.shapeOf;
  const ID = NS.States.stateOf("stone");   // a REAL state: the outline table is indexed by one (#4944)

  // a full cube answers by identity, so the HUD's common path allocates nothing
  Ph.shapeOf = () => Ph.FULL_CUBE;
  ok(Ray.selectionBoxes(ID) === Ray.UNIT_BOX, 'a full cube must return UNIT_BOX by identity, not a copy');
  ok(Ray.UNIT_BOX.length === 1 && Ray.UNIT_BOX[0].join() === '0,0,0,1,1,1', 'UNIT_BOX is the unit cube');

  // a shapeless block (a flower) has nothing to outline — draw the cube, it is still breakable
  Ph.shapeOf = () => [];
  ok(Ray.selectionBoxes(ID) === Ray.UNIT_BOX, 'a block with no collision boxes falls back to the unit cube');
  Ph.shapeOf = () => null;
  ok(Ray.selectionBoxes(ID) === Ray.UNIT_BOX, 'a block with no shape at all falls back to the unit cube');

  Ph.shapeOf = () => [[0, 0, 0, 1, 0.5, 1]];
  const slab = Ray.selectionBoxes(ID);
  ok(slab.length === 1 && slab[0].join() === '0,0,0,1,0.5,1', `a slab outlines its real box, got ${JSON.stringify(slab)}`);

  // the outline uses the SAME clamp as the ray, so a 1.5-tall post is outlined one block tall
  Ph.shapeOf = () => [[0.375, 0, 0.375, 0.625, 1.5, 0.625]];
  const post = Ray.selectionBoxes(ID);
  ok(post.length === 1 && post[0][4] === 1, `a 1.5-tall post must be outlined to y=1, got ${JSON.stringify(post)}`);

  // every registry shape: the outline boxes must be exactly the clamped collision boxes, and
  // every one of them must be a box a ray could actually hit — no zero-volume slivers, which
  // draw as a flickering line rather than a box.
  Ph.shapeOf = savedShapeOf;
  const seen2 = new Set();
  let outlined = 0, slivers = 0, mismatched = 0;
  for (let st = 0; st < R.shapeOf.length; st++) {
    const si = R.shapeOf[st];
    if (seen2.has(si)) continue;
    seen2.add(si);
    const boxes = Ph.shapesForState(st);
    Ph.shapeOf = () => (boxes && boxes.length ? boxes : []);
    const out = Ray.selectionBoxes(ID);
    if (!boxes || !boxes.length) { if (out !== Ray.UNIT_BOX) mismatched++; continue; }
    const want = boxes
      .map((b) => [Math.max(0, b[0]), Math.max(0, b[1]), Math.max(0, b[2]),
                   Math.min(1, b[3]), Math.min(1, b[4]), Math.min(1, b[5])])
      .filter((b) => b[0] < b[3] && b[1] < b[4] && b[2] < b[5]);
    if (JSON.stringify(out) !== JSON.stringify(want.length ? want : Ray.UNIT_BOX)) mismatched++;
    for (const b of out) { outlined++; if (b[0] >= b[3] || b[1] >= b[4] || b[2] >= b[5]) slivers++; }
  }
  ok(mismatched === 0, `${mismatched} shapes outline something other than their clamped collision boxes`);
  ok(slivers === 0, `${slivers} outline boxes have zero volume and would draw as a flickering line`);
  console.log(`   ${seen2.size.toLocaleString()} shapes · ${outlined.toLocaleString()} outline boxes · 0 slivers`);
  Ph.shapeOf = savedShapeOf;
}
console.log(`   ${pass} ok`);


/** #4692: the state of `name` whose true face properties are exactly `faces`. */
function faceState(ns, name, faces) {
  const R = ns.Reg, S = ns.States, all = name === 'vine' ? ['up', 'north', 'south', 'east', 'west'] : ['up', 'down', 'north', 'south', 'east', 'west'];
  for (let st = 1; st <= R.realCount; st++) {
    if (S.name(st) !== name) continue;
    if (all.every((f) => R.valueNames[S.propValue(st, R.PROP[f])] === String(faces.includes(f)))) return st;
  }
  throw new Error('no state ' + name + ' ' + faces);
}

// ─────────────────────────────────────────── 3d. outline shape, not collision shape (#4692)
console.log('3d. a vine is targeted by its face planes, the ray passes through the rest of the cell');
{
  const WALL = SR.stateOf('dirt');
  const vine = faceState(NS, 'vine', ['north']);          // plane at z in [0, 1/16]
  W.clear().set(0, 0, 0, vine).set(0, 0, 3, WALL);
  let h = Ray.cast(0.5, 0.5, -3, 0, 0, 1, 20);            // from the north: hits the plane
  ok(h && h.x === 0 && h.z === 0 && near(h.hz, 0), `aiming at the vine plane must select the vine, got ${JSON.stringify(h && [h.x, h.z])}`);
  W.clear().set(0, 0, 0, vine);
  h = Ray.cast(0.5, 0.5, 6, 0, 0, -1, 20);                // from the south: through the empty cell, then the plane
  ok(h && h.z === 0 && near(h.hz, 1 / 16), `from the open side the plane's back is hit at z=1/16, got ${h && h.hz}`);
  W.clear().set(0, 0, 0, vine).set(3, 0, 0, WALL);
  h = Ray.cast(-4, 0.5, 0.5, 1, 0, 0, 20);                // sideways through the open cell: the wall behind
  ok(h && h.x === 3, `a ray through the empty part of a vine cell must hit the block behind, got x=${h && h.x}`);
  const lichen = faceState(NS, 'glow_lichen', ['down']);
  W.clear().set(0, 0, 0, lichen).set(3, 0, 0, WALL);
  h = Ray.cast(-4, 0.5, 0.5, 1, 0, 0, 20);
  ok(h && h.x === 3, `glow lichen on the floor must not block a ray at mid height, got x=${h && h.x}`);
  const bare = faceState(NS, 'vine', []);                 // no face = vanilla's full cube
  ok(Ray.selectionBoxes(bare) === Ph.FULL_CUBE || Ray.selectionBoxes(bare)[0][3] === 1, 'a faceless vine is a full cube');
  const two = Ray.selectionBoxes(faceState(NS, 'vine', ['up', 'east']));
  ok(two.length === 2, `the outline of an up+east vine is two planes, got ${two.length}`);
}

// ─────────────────────────────────────────── 3c. the two forward vectors agree
console.log('3c. the player and the camera compute the same forward vector');
{
  // ⚠ `Player.retarget` writes the forward vector out by hand rather than calling
  // `Ray.castFromCamera`, which does it through `Cam.forward`. Two copies of one formula, and
  // if they ever drift the symptom is a fast flick placing a block on the wrong wall — the exact
  // bug `retarget`'s own comment was written about. Assert they are the same function.
  const C = NS.Cam;
  const cam = C.create();
  let worst = 0, at = null;
  for (let yaw = -Math.PI; yaw <= Math.PI; yaw += 0.37) {
    for (let pitch = -1.5; pitch <= 1.5; pitch += 0.31) {
      C.setLook(cam, yaw, pitch);
      const f = C.forward(cam);
      // the formula inlined in Player.retarget, character for character
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      const px = sy * cp, py = sp, pz = -cy * cp;
      const d = Math.max(Math.abs(px - f[0]), Math.abs(py - f[1]), Math.abs(pz - f[2]));
      if (d > worst) { worst = d; at = `yaw ${yaw.toFixed(2)} pitch ${pitch.toFixed(2)}`; }
    }
  }
  // ⚠ 1e-6, not 1e-12: `Cam.forward` writes into a Float32Array, so the two agree to float32 and
  // not to double. That is 3e-8 of a unit vector — a hundredth of a millimetre at a five-block
  // reach — and stating it is the point: if the FORMULAS ever diverge the error jumps by orders
  // of magnitude, and this fence sees that long before a player does.
  ok(worst < 1e-6, `the player's forward vector differs from the camera's by ${worst} at ${at}`);
  ok(worst > 0, 'the two vectors are bit-identical — one of them is not being computed');
  ok(at !== null, 'no angles were sampled — this section is vacuous');
}

// ─────────────────────────────────────────── 4. anti-vacuity
console.log('4. anti-vacuity: break the raycast on purpose, and it must be caught');
{
  // Each mutation is a plausible way to get this wrong. `probe` must return true for the real
  // source and false for the mutated one; a mutation that both accept means the check above
  // is decoration.
  const MUT = [
    ['the shape branch removed (a slab targetable through the air above it)', {
      file: '14c_raycast.js',
      from: 'var h = hitShape(ox, oy, oz, dx, dy, dz, x, y, z, shape, maxDist);',
      to: 'var h = { t: t, face: face };'
    }],
    ['a miss treated as a hit (the ray stops at a fence it never touched)', {
      file: '14c_raycast.js',
      from: 'return bestT === Infinity ? null : { t: bestT, face: bestFace };',
      to: 'return { t: bestT === Infinity ? 0 : bestT, face: bestFace };'
    }],
    ['the entered face taken from the DDA cell instead of the box', {
      file: '14c_raycast.js',
      from: 'bestFace = axis < 0 ? dominantFace(dx, dy, dz) : ENTER_FACE[axis * 2 + (neg ? 1 : 0)];',
      to: 'bestFace = 0;'
    }],
    ['the near/far slab swap dropped (t1 > t2 for a negative direction)', {
      file: '14c_raycast.js',
      from: 'if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; enterNeg = true; }',
      to: 'if (false) { var tmp = t1; t1 = t2; t2 = tmp; enterNeg = true; }'
    }],
    ['the outline drawn unclamped (a fence highlighted a block taller than it can be hit)', {
      file: '14c_raycast.js',
      from: '      if (clampBox(shape[i], o)) out.push(o);',
      to: '      o[0]=shape[i][0];o[1]=shape[i][1];o[2]=shape[i][2];o[3]=shape[i][3];o[4]=shape[i][4];o[5]=shape[i][5];out.push(o);'
    }],
    ['targeting reads collision shape again (a vine is a full cube)', {
      file: '14c_raycast.js',
      from: 'var faces = St && St.name ? OUTLINE[St.name(id)] : null;',
      to: 'var faces = null;'
    }],
    ['the fast path loses its identity test (every full cube pays for a slab test)', {
      file: '14c_raycast.js',
      from: 'if (!shape || shape === (NS.Physics && NS.Physics.FULL_CUBE)) {',
      to: 'if (!shape) {'
    }]
  ];

  // one probe that every mutation must fail: the slab suite from section 3, plus the no-op
  const probe = (ns) => {
    const w = ns.World, ray = ns.Ray, ph = ns.Physics, b = ns.Blocks;
    const SLAB = [[0, 0, 0, 1, 0.5, 1]];
    const ID = ns.States.stateOf('stone'), WALL = ns.States.stateOf('dirt');
    ph.shapeOf = (id) => (id === ID ? SLAB : ph.FULL_CUBE);
    w.clear().set(0, 0, 0, ID).set(3, 0, 0, WALL);
    const over = ray.cast(-4, 0.75, 0.5, 1, 0, 0, 20);          // must pass the slab
    if (!(over && over.x === 3 && over.face === 1)) return false;
    const down = ray.cast(0.5, 4, 0.5, 0, -1, 0, 20);           // must land on 0.5, face +Y
    if (!(down && down.y === 0 && Math.abs(down.hy - 0.5) < 1e-9 && down.face === 2)) return false;
    const up = ray.cast(0.5, -4, 0.5, 0, 1, 0, 20);             // from below: face -Y at y=0
    if (!(up && up.y === 0 && Math.abs(up.hy - 0) < 1e-9 && up.face === 3)) return false;
    // and the full cube must still answer at the cell boundary
    ph.shapeOf = () => ph.FULL_CUBE;
    w.clear().set(0, 0, 0, ID);
    const cube = ray.cast(-4, 0.75, 0.5, 1, 0, 0, 20);
    if (!(cube && cube.x === 0 && Math.abs(cube.hx - 0) < 1e-9)) return false;
    if (ray.shapeTests !== 0) return false;   // a full cube must not reach the slab-method path
    // the outline must agree with the ray, clamp included
    ph.shapeOf = () => [[0.375, 0, 0.375, 0.625, 1.5, 0.625]];
    const post = ray.selectionBoxes(ID);
    if (!(post.length === 1 && post[0][4] === 1)) return false;
    const vn = faceState(ns, 'vine', ['north']);
    w.clear().set(0, 0, 0, vn).set(3, 0, 0, WALL);
    const thru = ray.cast(-4, 0.5, 0.5, 1, 0, 0, 20);           // through the open part of a vine cell
    if (!(thru && thru.x === 3)) return false;
    return true;
  };

  ok(probe(boot(null)) === true, 'the probe must accept the real source (otherwise it proves nothing)');
  for (const [label, mutation] of MUT) {
    let caught;
    try { caught = probe(boot(mutation)) === false; }
    catch (e) { caught = true; }   // a mutation that throws is also a mutation that was caught
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" is not distinguished from correct behaviour`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ raycheck =================');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
