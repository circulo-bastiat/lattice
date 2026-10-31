#!/usr/bin/env node
// streamcheck.mjs — PLAN W10's acceptance test: meshing and streaming AT SCALE.
//
//   node tools/streamcheck.mjs [--print]
//
// PLAN W10 asks for a chunk visibility graph, vertex arenas, palette + bit-packed sections, and
// cancellation for chunks the player walked away from, with `bench.mjs` on the 2200G profile as
// the acceptance. ⚠ **`bench.mjs` cannot be the whole acceptance and this file says why.** The
// bench needs a GPU and a machine; it is the right tool for "does it hit 60 on Dan's box" and it
// is useless in CI, on a build server, or in a container whose GL is SwiftShader — where it
// reports 15 fps for reasons that have nothing to do with this code. Everything W10 actually
// BUILT is CPU-side and machine-independent, and that is what is asserted here:
//
//   1. the spiral — the chunk you stand in is requested first and the far ring last
//   2. eviction — distance first, then the resident CAP, which is what stops a long flight
//      filling memory on a 4 GB machine (D-89)
//   3. cancellation — a column the player left behind must release its worker slot (D-87), or
//      the chunk in front of the player waits behind work nobody will ever see
//   4. the snapshot pool — meshing 500 sections must not allocate 500 snapshots
//   5. the visibility graph — a solid section connects nothing, an empty one connects everything,
//      and the flood is what turns that into sections not drawn (ARCH 9.1, D-85)
//   6. throughput — mesh time and mesh BYTES per section, measured, with the budget stated
//   7. anti-vacuity
//
// The split between what CI can prove and what only hardware can answer is D-143.
// The one thing only Dan's hardware can answer stays Dan's: `docs/archive/PROFILE.md` §the ladder, and
// the "what a human should look at" list in NEXT.md.

import { loadEngine } from './loadsrc.mjs';
import { getCachedColumn } from './chunkcache.mjs'; // D-463: shared worldgen chunk cache

const PRINT = process.argv.includes('--print');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

const MAIN = ['06_atlas.js', '07_world.js', '08_lighting.js', '09_jobs.js', '10_camera.js', '10_gfx.js', '16_settings.js'];
const MCL = loadEngine({ extra: MAIN, dom: true });
const NS = MCL;
const CFG = MCL.CFG, G = MCL.Gen, S = MCL.Section, SR = MCL.States, W = MCL.World, M = MCL.Mesher;
const SEED = 4242;
MCL.Blocks.init();
G.init(SEED, G.defaults());

// ─────────────────────────────────────────────── 1. the spiral
console.log('1. the spiral — nearest chunk first, far ring last');
{
  const list = W.spiral(8);
  ok(list.length >= 2, 'the spiral is empty');
  ok(list[0] === 0 && list[1] === 0, `the spiral does not start at the camera: (${list[0]},${list[1]})`);
  let worst = -1, monotone = true, count = 0;
  for (let i = 0; i < list.length; i += 2) {
    const d2 = list[i] * list[i] + list[i + 1] * list[i + 1];
    if (d2 < worst) monotone = false;
    worst = Math.max(worst, d2);
    ok0(d2 <= 64, `a chunk at d²=${d2} is outside render distance 8`);
    count++;
  }
  ok(monotone, 'the spiral is not sorted by distance — the ring behind the player is requested first');
  ok(count > 190 && count < 220, `${count} chunks inside r=8, expected about 208`);
  // the cache returns the same array rather than rebuilding it every frame
  ok(W.spiral(8) === list, 'the spiral is rebuilt every call — that is 200 sorts a second');
  ok(W.spiral(4) !== list, 'the spiral cache ignores the render distance');
  if (PRINT) console.log(`   r=8 -> ${count} columns, first (${list[0]},${list[1]}), last (${list[list.length - 2]},${list[list.length - 1]})`);
}
function ok0(c, m) { if (!c) fails.push(m); }

// ─────────────────────────────────────────────── 2 & 3. streaming, eviction, cancellation
console.log('2. streaming — 400 columns generated, evicted by distance and by cap');
{
  W.init && W.init();
  W.maxChunks = 120;
  W.evictMargin = 2;
  // Generate a block of columns synchronously, exactly as the gen job's completion does.
  const put = (cx, cz) => {
    const c = W.getOrCreate(cx, cz);
    const col = getCachedColumn(MCL, cx, cz) /* D-463 */;
    c.sec = col.sec; c.hmap = col.hmap; c.biome = col.biome || null;
    c.state = MCL.CH.GENERATED; c.lastUse = W.frame;
    return c;
  };
  for (let cx = -6; cx <= 6; cx++) for (let cz = -6; cz <= 6; cz++) put(cx, cz);
  const resident = W.chunks.size;
  ok(resident === 169, `${resident} columns resident, expected 169`);

  // the player flies 200 blocks east; everything behind must go
  W.evict(12, 0, 4);
  let far = 0;
  W.chunks.forEach((c) => { const dx = c.cx - 12, dz = c.cz - 0; if (dx * dx + dz * dz > 36) far++; });
  ok(far === 0, `${far} columns survived eviction more than rd+margin from the camera`);
  ok(W.chunks.size < resident, 'eviction dropped nothing at all');

  // and the CAP: refill past it and assert the furthest go, not the nearest
  for (let cx = -6; cx <= 6; cx++) for (let cz = -6; cz <= 6; cz++) if (!W.get(cx, cz)) put(cx, cz);
  W.maxChunks = 40;
  W.evict(0, 0, 12);                       // distance keeps everything; only the cap can bite
  ok(W.chunks.size <= 40, `the resident cap held ${W.chunks.size} columns, expected at most 40`);
  ok(!!W.get(0, 0), 'the cap evicted the column the player is standing in');
  let maxD2 = 0;
  W.chunks.forEach((c) => { maxD2 = Math.max(maxD2, c.cx * c.cx + c.cz * c.cz); });
  ok(maxD2 <= 25, `the furthest surviving column is at d²=${maxD2} — the cap dropped the wrong ones`);
  if (PRINT) console.log(`   after the cap: ${W.chunks.size} columns, furthest d²=${maxD2}`);
}

console.log('2c. the generation radius is one ring wider than the mesh radius (D-147)');
{
  // ⚠ A SECTION IS ONLY MESHED WHEN ALL EIGHT NEIGHBOURING COLUMNS EXIST, so generating exactly
  // `rd` columns leaves the outermost ring permanently un-meshed — the world is a disc of
  // radius rd−1 with a ring of invisible geometry round it, and 256 sections stuck dirty for
  // ever. Session 4 photographed that frontier underground. This drives the real `W.stream`
  // against a recording stub and asserts the two radii.
  const realJobs = NS.Jobs;
  const asked = { gen: [], mesh: [] };
  const never = new Promise(() => {});
  NS.Jobs = {
    mode: 'workers', workers: [],
    requestGen: (cx, cz) => { asked.gen.push([cx, cz]); return never; },
    requestMesh: (cx, cz, sy) => { asked.mesh.push([cx, cz, sy]); return never; },
    lastId: () => 1,
    cancel: () => {},
    pump: () => {},
  };
  W.chunks.clear();
  W.maxGenInflight = 100000; W.maxMeshInflight = 100000; W.maxMeshPerFrame = 100000;
  W.stream(0, 0, 4);
  const far = asked.gen.filter(([cx, cz]) => cx * cx + cz * cz > 16).length;
  const inside = asked.gen.filter(([cx, cz]) => cx * cx + cz * cz <= 16).length;
  ok(inside > 40, `only ${inside} columns requested inside rd=4`);
  ok(far > 0, 'generation asked for nothing beyond the render distance — the outermost ring can never be meshed (D-147)');
  const worst = asked.gen.reduce((m, [cx, cz]) => Math.max(m, cx * cx + cz * cz), 0);
  ok(worst <= 26, `generation reached d²=${worst}, further than the one-ring margin`);
  // ⚠ AND THE DIAGONALS. A rim column at (4,0) needs its neighbour at (5,1) — d² = 26, one unit
  // outside the disc of radius 5 — or it can never be meshed. That is the second half of D-147,
  // and it left 29 sections dirty for ever until `soakcheck` flew far enough to notice.
  const need = [[5, 1], [5, -1], [1, 5], [-1, 5], [-5, 1], [1, -5]];
  const has = new Set(asked.gen.map(([cx, cz]) => cx + ',' + cz));
  const missing = need.filter(([cx, cz]) => !has.has(cx + ',' + cz));
  ok(missing.length === 0, `the diagonal neighbours of the rim are not generated: ${missing.map((p) => p.join(',')).join(' ')} (D-147)`);
  if (PRINT) console.log(`   rd 4: ${inside} columns inside, ${far} in the margin ring, furthest d²=${worst}`);
  NS.Jobs = realJobs;
}

console.log('3. cancellation — a column left behind releases its slot (D-87)');
{
  const before = W.stats2.cancelled;
  const c = W.getOrCreate(50, 50);
  c.state = MCL.CH.GENERATING;
  W.genJobs.set(W.key(50, 50), 987654);
  W.genInflight = 1;
  W.unload(c);
  ok(W.stats2.cancelled > before, 'unloading a column with a job in flight cancelled nothing');
  ok(W.genInflight === 0, `genInflight is ${W.genInflight} after the cancel, expected 0`);
  ok(!W.genJobs.has(W.key(50, 50)), 'the cancelled job is still in the in-flight map');
  // ⚠ the accounting is the point: a leaked slot is invisible in play and halves throughput
  const c2 = W.getOrCreate(51, 51);
  c2.state = MCL.CH.GENERATED;
  W.meshJobs.set(W.sectionKey(51, 51, 7), 5551);
  W.meshInflight = 1;
  W.cancelJobsFor(c2);
  ok(W.meshInflight === 0, `meshInflight is ${W.meshInflight} after cancelling a mesh job, expected 0`);
}

console.log('3c. a section re-dirtied while its mesh is in flight leaks no slot (D-517)');
// Drives the real `W.stream` + `requestMesh` against a stub whose jobs resolve only when told.
// Returns { leaked, reissued }: `leaked` = meshInflight left after every job has answered,
// `reissued` = the re-dirtied section was meshed again once its first job landed (the other
// direction — a guard that simply DROPPED the re-dirty would pass the leak test and lose the edit).
async function redirtyInFlight(broken) {
  const realJobs = NS.Jobs, realHas = W.meshJobs.has;
  const pending = []; let asked = 0;
  NS.Jobs = { mode: 'workers', workers: [], lastId: 0, cancel: () => {}, pump: () => {},
    requestGen: () => new Promise(() => {}),
    requestMesh(cx, cz, sy, snap, rel) { asked++; this.lastId++;
      return new Promise((res) => pending.push(() => { if (rel) rel(snap); res({ buf: null, vis: 0 }); })); } };
  if (broken) W.meshJobs.has = () => false;            // the pre-D-517 streamer: no in-flight guard
  try {
    W.chunks.clear(); W.meshJobs.clear(); W.meshInflight = 0; W.genInflight = 0;
    W.maxMeshInflight = 64; W.maxMeshPerFrame = 64; W.maxGenInflight = 0;
    for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
      const c = W.getOrCreate(cx, cz); c.state = MCL.CH.GENERATED; c.meshDirty[0] = 0; }
    const c0 = W.get(0, 0);
    c0.meshDirty[0] = 1 << 5;
    W.stream(0, 0, 1);                                 // job #1 for (0,0,5) goes out
    c0.meshDirty[0] |= 1 << 5;                         // a block changes before it lands
    W.stream(0, 0, 1);                                 // must NOT issue a second job
    const beforeLand = asked;
    while (pending.length) { pending.shift()(); await Promise.resolve(); await Promise.resolve(); }
    W.stream(0, 0, 1);                                 // the kept dirty bit is meshed now
    const reissued = asked > beforeLand;
    while (pending.length) { pending.shift()(); await Promise.resolve(); await Promise.resolve(); }
    return { leaked: W.meshInflight, reissued };
  } finally { NS.Jobs = realJobs; W.meshJobs.has = realHas; W.meshJobs.clear(); W.meshInflight = 0; W.chunks.clear(); }
}
{
  const good = await redirtyInFlight(false);
  ok(good.leaked === 0, `meshInflight is ${good.leaked} after every job answered — a re-dirtied in-flight section leaked its slot (D-517)`);
  ok(good.reissued, 'the section changed while its mesh was in flight was never meshed again — the edit was lost (D-517, other direction)');
  const bad = await redirtyInFlight(true);
  ok(bad.leaked > 0, `ANTI-VACUITY FAILURE: with the in-flight guard removed nothing leaked (${bad.leaked}) — 3c proves nothing`);
  if (PRINT) console.log(`   guarded: leaked ${good.leaked}, reissued ${good.reissued} · unguarded: leaked ${bad.leaked}`);
}

// ─────────────────────────────────────────────── 3b. how far from spawn the renderer is honest
console.log('3b. the renderer still draws at 29,000,000 blocks — camera-relative (D-179)');
{
  // ⚠ WHAT THIS ASSERTS, AND WHAT IT USED TO ASSERT. Until D-179 this section fenced a LIMIT:
  // "correct to ±2,000,000 blocks, wrong past four million", with the failure written down so
  // it could not quietly get worse. The failure was that a frustum plane's constant was a
  // distance from the WORLD ORIGIN and cam.viewProj is Float32Array, so at three million blocks
  // a float32 step is a quarter of a block, at twenty-nine million it is two blocks, and the
  // plane equations became noise: session 4 flew to x = 29,000,000 and measured **402 section
  // meshes resident and 0 triangles drawn**. Sampled across sixty camera positions out there,
  // twenty-nine of them culled the ENTIRE world and the rest drew half of what they should.
  //
  // D-179 made the whole render camera-relative: the view matrix is built with the eye at the
  // origin, the planes come out in that space, and Gfx.drawList hands the backends
  // `sectionOrigin − camera` computed in doubles. So the assertion is now the OPPOSITE one, and
  // it is not a fence with a number in it — it is that the distance from spawn does not appear
  // in the answer at all. The reference it is measured against is the same maths in Float64.
  const C = MCL.Cam, U = MCL.U;

  const cam = C.create();
  cam.aspect = 16 / 9; cam.fov = 70; cam.far = 256; cam.near = 0.05;

  // The double-precision twin: identical code path, Float64 matrices instead of Float32. This
  // is the answer the real camera has to reproduce — not "close to", exactly.
  const ref = C.create();
  ref.view = new Float64Array(16); ref.proj = new Float64Array(16); ref.viewProj = new Float64Array(16);
  ref.aspect = cam.aspect; ref.fov = cam.fov; ref.far = cam.far; ref.near = cam.near;

  const place = (c, X, yaw) => { c.x = X; c.y = 70; c.z = -X / 3; c.yaw = yaw; c.pitch = 0; C.update(c); };

  // the section the camera stands in, and the one it is looking straight at
  const pair = (c) => {
    const dx = Math.sin(c.yaw), dz = -Math.cos(c.yaw);
    const ox = Math.floor((c.x + dx * 32) / 16) * 16, oz = Math.floor((c.z + dz * 32) / 16) * 16;
    const sx = Math.floor(c.x / 16) * 16, sz = Math.floor(c.z / 16) * 16;
    return C.aabbVisible(c, ox, 64, oz, ox + 16, 80, oz + 16)
        && C.aabbVisible(c, sx, 64, sz, sx + 16, 80, sz + 16);
  };

  // A resident shell the size of a real render distance 8 — about the 402 meshes session 4 had
  // in memory when it drew nothing — counted against the Float64 twin, section by section.
  const shell = (c, r) => {
    let vis = 0, tot = 0;
    const scx = Math.floor(c.x / 16) * 16, scz = Math.floor(c.z / 16) * 16;
    for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) {
      if (i * i + j * j > 64) continue;
      const ox = scx + i * 16, oz = scz + j * 16;
      for (const oy of [64, 80]) { tot++; if (C.aabbVisible(c, ox, oy, oz, ox + 16, oy + 16, oz + 16)) vis++; }
    }
    void r; return { vis, tot };
  };

  const FAR = [0, 1e5, 1e6, 4e6, 1e7, 2.9e7, 1e8];
  let worstDrawn = 1e9, disagree = 0, blank = 0, sampled = 0;
  for (const X of FAR) {
    // several headings per distance: the old failure was CHAOTIC, not monotone — one lucky yaw
    // out there drew a normal frame and the next one drew nothing, which is precisely why a
    // single sample point is not evidence (D-148's lesson, one floor down).
    for (let k = 0; k < 12; k++) {
      const yaw = 0.6 + k * 0.5233;
      place(cam, X + k * 137.3, yaw);
      place(ref, X + k * 137.3, yaw);
      sampled++;
      ok0(pair(cam), `at x=${X.toExponential(0)} yaw=${yaw.toFixed(2)} the section in front of the camera tests as outside the frustum`);
      const a = shell(cam), b = shell(ref);
      if (a.vis === 0) blank++;
      if (a.vis !== b.vis) disagree++;
      if (a.vis < worstDrawn) worstDrawn = a.vis;
    }
  }
  ok(blank === 0, `${blank} of ${sampled} camera positions out to 1e8 blocks drew NOTHING — D-179 has regressed`);
  ok(disagree === 0, `${disagree} of ${sampled} camera positions disagree with the Float64 reference — the float32 matrices are losing the frustum again`);
  ok(worstDrawn > 60, `the emptiest sampled frame passed only ${worstDrawn} of ~394 sections — at 1e8 blocks it should be the same ~130 it is at spawn`);

  // ⚠ WHY it holds, asserted structurally rather than statistically: in eye-relative space the
  // four side planes pass through the ORIGIN, so their constants are zero and there is no large
  // number left to quantise. This is the property that makes the result independent of X, and
  // it is checked at 29,000,000 where the old code had 3e7 sitting in every one of them.
  place(cam, 2.9e7, 0.6);
  const pl = cam.planes;
  for (let i = 0; i < 4; i++) {
    ok(Math.abs(pl[i * 4 + 3]) < 1e-4,
       `side plane ${i} has constant ${pl[i * 4 + 3]} at x=2.9e7 — the planes are not camera-relative`);
  }
  ok(Math.abs(pl[19] + cam.near) < 1e-3, `the near plane constant is ${pl[19]}, expected ${-cam.near}`);
  ok(Math.abs(pl[23] - cam.far) < 0.5, `the far plane constant is ${pl[23]}, expected ${cam.far}`);
  ok(Math.abs(cam.px - 2.9e7) < 1e-6 && Math.abs(cam.view[12]) + Math.abs(cam.view[13]) + Math.abs(cam.view[14]) === 0,
     'the view matrix still carries a world-space translation — cam.view[12..14] must be zero (D-179)');

  // ⚠ THE VERTEX PATH, which is the other half of D-149 and gets fixed by the same change. The
  // shader computes `uOrigin.xyz + lp` in float32. `uOrigin` used to be a world position.
  const f32 = new Float32Array(1);
  const thru = (v) => { f32[0] = v; return f32[0]; };
  // ⚠ modelled the way the SHADER computes it: uOrigin is a float32 uniform, lp is a float32
  // built from the packed vertex, and their SUM is rounded to float32 again. At 2.9e7 a float32
  // step is two blocks, so the last rounding is where a world-space origin loses the vertex.
  const CAMX = 29000000.5, OX = 28999936, LP = 13;        // section origin, and a vertex inside it
  const oldWorld = thru(thru(OX) + LP);                    // what the GPU saw before D-179
  const newRel   = CAMX + thru(thru(OX - CAMX) + LP);      // and after: only the small part is float
  ok(Math.abs(oldWorld - (OX + LP)) > 0.5,
     `the world-space vertex path was accurate to ${Math.abs(oldWorld - (OX + LP))} blocks at 2.9e7 — this sample cannot show the bug`);
  ok(Math.abs(newRel - (OX + LP)) < 1 / 512,
     `the camera-relative vertex path is off by ${Math.abs(newRel - (OX + LP))} blocks at 2.9e7`);

  if (PRINT) {
    console.log(`   ${sampled} camera positions from spawn to 1e8 · ${blank} blank frames · ${disagree} disagreeing with Float64 · worst ${worstDrawn}/~394 sections`);
    console.log(`   vertex at 2.9e7: world-space float32 off by ${(oldWorld - (OX + LP)).toFixed(3)} blocks, camera-relative off by ${(newRel - (OX + LP)).toFixed(6)}`);
  }

  // ── anti-vacuity for 3b: break the fix and watch every assertion above fail ────────────────
  // Same shape as section 6. `legacy` is the pre-D-179 camera reproduced exactly: a float32
  // view matrix built at the camera's WORLD position, and planes measured from the world origin
  // (px/py/pz left at zero, which is what aabbVisible subtracting nothing amounts to).
  {
    const av = [];
    const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };
    const legacy = (X, yaw) => {
      const c = C.create();
      c.aspect = 16 / 9; c.fov = 70; c.far = 256; c.near = 0.05;
      c.x = X; c.y = 70; c.z = -X / 3; c.yaw = yaw; c.pitch = 0;
      U.mat4.perspective(c.proj, c.fov * Math.PI / 180, c.aspect, c.near, c.far, false);
      U.mat4.fpsView(c.view, c.x, c.y, c.z, c.yaw, c.pitch);      // the world-space matrix, D-149
      U.mat4.multiply(c.viewProj, c.proj, c.view);
      C.extractPlanes(c);
      c.px = 0; c.py = 0; c.pz = 0;                                // ... measured from the origin
      return c;
    };

    check('a view matrix rebuilt at the camera’s world position', () => {
      // the headline: out at 29,000,000 the old camera goes blind on many headings
      let blind = 0;
      for (let k = 0; k < 12; k++) {
        const c = legacy(2.9e7 + k * 137.3, 0.6 + k * 0.5233);
        if (shell(c).vis === 0) blind++;
      }
      if (blind > 0) throw 0;                    // it does go blind, so `blank === 0` above bites
    });

    check('world-space planes disagreeing with the Float64 reference', () => {
      let bad = 0;
      for (let k = 0; k < 12; k++) {
        const yaw = 0.6 + k * 0.5233, X = 2.9e7 + k * 137.3;
        const c = legacy(X, yaw);
        place(ref, X, yaw);
        if (shell(c).vis !== shell(ref).vis) bad++;
      }
      if (bad > 0) throw 0;                      // it does disagree, so `disagree === 0` bites
    });

    check('a plane constant that is a distance from the world origin', () => {
      const c = legacy(2.9e7, 0.6);
      // the four side planes must NOT pass through the origin any more — they carry 3e7
      let big = 0;
      for (let i = 0; i < 4; i++) if (Math.abs(c.planes[i * 4 + 3]) > 1e6) big++;
      if (big === 4) throw 0;
    });

    check('a world-space section origin in a float32 uniform', () => {
      // the vertex assertion, with the pre-D-179 value substituted: it must miss by half a block
      if (Math.abs(oldWorld - (OX + LP)) >= 1 / 512) throw 0;
    });

    for (const [label, caught] of av) {
      ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — section 3b proves nothing`);
      console.log(`   ${caught ? '✓' : '✗'} ${label}`);
    }
  }
}

// ─────────────────────────────────────────────── 4 & 5. the snapshot pool and the vis graph
console.log('4. the snapshot pool and the visibility graph');
let meshMs = [], meshBytes = [], visSolid = -1, visAir = -1;
{
  W.chunks.clear();
  const put = (cx, cz) => {
    const c = W.getOrCreate(cx, cz);
    const col = getCachedColumn(MCL, cx, cz) /* D-463 */;
    c.sec = col.sec; c.hmap = col.hmap; c.biome = col.biome || null;
    c.state = MCL.CH.GENERATED;
  };
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) put(cx, cz);

  const allocBefore = W.stats2.snapAlloc;
  let meshed = 0;
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      const snap = W.snapshotFor(cx, cz, sy);
      const t0 = process.hrtime.bigint();
      const buf = M.mesh(snap, null, cx * 16, sy * 16 + CFG.WORLD_MIN_Y, cz * 16);
      const t1 = process.hrtime.bigint();
      meshMs.push(Number(t1 - t0) / 1e6);
      // ⚠ the pool only works if the caller gives the snapshot back — `Jobs` does it through
      // the `release` callback the instant postMessage returns, and a caller that forgets is
      // 27 typed-array copies a mesh on the one thread this project is protecting (D-88).
      W.releaseSnap(snap);
      meshBytes.push(buf ? buf.byteLength : 0);
      meshed++;
      // a section of nothing but air connects every face to every other: 15 bits set
      const sec = W.get(cx, cz).sec[sy];
      if (sec.u === 0 && visAir < 0) visAir = M.lastVis;
      if (sec.u > 0 && SR.opaque[sec.u] === 1 && visSolid < 0) visSolid = M.lastVis;
    }
  }
  ok(meshed === 9 * CFG.SECTIONS_Y, `meshed ${meshed} sections, expected ${9 * CFG.SECTIONS_Y}`);
  const alloc = W.stats2.snapAlloc - allocBefore;
  ok(alloc <= 1, `${alloc} snapshots allocated for ${meshed} sections — the pool is not being reused`);
  ok(W.stats2.snapReuse >= meshed - 1, `the pool reported ${W.stats2.snapReuse} reuses for ${meshed} meshes`);

  // the visibility graph, which is what turns 500 sections into 86 drawn (D-85, ARCH 9.1)
  if (visAir >= 0) ok(visAir === 0x7FFF, `an all-air section reports vis 0x${visAir.toString(16)}, expected 0x7fff — nothing behind it would be drawn`);
  if (visSolid >= 0) ok(visSolid === 0, `a solid section reports vis 0x${visSolid.toString(16)}, expected 0 — the flood would pour straight through bedrock`);
  ok(visAir >= 0 || visSolid >= 0, 'neither a uniform-air nor a uniform-solid section was meshed — section 4 proves nothing');
}

// ─────────────────────────────────────────────── 6. throughput
console.log('5. throughput — mesh time and mesh bytes per section');
{
  meshMs.sort((a, b) => a - b);
  const p50 = meshMs[meshMs.length >> 1];
  const p95 = meshMs[Math.floor(meshMs.length * 0.95)];
  const total = meshBytes.reduce((a, b) => a + b, 0);
  const nonEmpty = meshBytes.filter((b) => b > 0).length;
  const avgKB = total / Math.max(1, nonEmpty) / 1024;

  // ⚠ THE BUDGET, AND WHAT IT IS NOT. These are CPU milliseconds on whatever ran the suite,
  // which is not the 2200G and not Dan's 6800XT — so the numbers are a REGRESSION FENCE, wide
  // enough that a slow CI box passes and narrow enough that a mesher that got three times
  // slower fails. The hardware question is `bench.mjs`, on the hardware.
  ok(p50 < 12, `median mesh ${p50.toFixed(2)} ms a section — the fence is 12 ms`);
  ok(p95 < 40, `p95 mesh ${p95.toFixed(2)} ms a section — the fence is 40 ms`);
  ok(avgKB < 120, `${avgKB.toFixed(1)} KB per non-empty section — the fence is 120 KB`);
  ok(nonEmpty > 20, `only ${nonEmpty} sections produced geometry — the sample is too thin to fence`);
  if (PRINT) {
    console.log(`   ${meshMs.length} sections · p50 ${p50.toFixed(2)} ms · p95 ${p95.toFixed(2)} ms · ${nonEmpty} with geometry · ${avgKB.toFixed(1)} KB each`);
  }
}

// ─────────────────────────────────────────────── 5b. upload-queue near-disc priority (D-711)
console.log('5b. upload-queue near-disc priority — the player\'s own column is not FIFO-starved (D-711)');
{
  // D-711 (session 140) reproduced "see through the ground" live: rapid multi-chunk
  // teleporting queues hundreds of GPU uploads for columns the camera has already left before
  // the section under the player's NEW position is even requested. `uploadQueue` is FIFO in
  // COMPLETION order and drains a couple of entries a frame (D-43/D-194), so the player's own
  // standing section — already meshed, sitting in the queue — can wait behind that backlog for
  // seconds while the renderer shows fog where solid ground already exists in world data. This
  // is downstream of the D-198 job-issuing budget (`meshPerFrame`/`maxMeshInflight`, tested
  // above): D-198 guarantees the WORK gets ISSUED near the player; it says nothing about the
  // GPU upload FIFO once the worker replies, which is the gap this section fences.
  const Gfx = MCL.Gfx;
  // A minimal backend stub: flushUploads only needs a truthy handle back, no GL context.
  Gfx.backend = { createSectionMesh: () => ({}), destroySectionMesh: () => {} };
  Gfx.uploadsPerFrame = 2;              // the medium preset's own number (16_settings.js)
  Gfx.uploadBytesPerFrame = 262144;
  const fakeBuf = () => {
    const buf = new ArrayBuffer(64);
    new Int32Array(buf, 0, 16)[0] = CFG.MESH_MAGIC;
    return buf;
  };

  // Runs the D-711 scenario: ~700 far uploads queued first (a rapid-teleport backlog), then the
  // player's OWN standing column queued last, and counts frames until it is actually uploaded.
  // `radius`, when passed, overrides `Gfx.NEAR_UPLOAD_R2` for the run (a way to prove the fence
  // is sensitive to the fix without needing a second process).
  function runScenario(radius) {
    Gfx.uploadQueue.length = 0;
    Gfx.meshes.clear();
    Gfx.meshList.length = 0;
    W.camCx = 100; W.camCz = 100;
    const savedR2 = Gfx.NEAR_UPLOAD_R2;
    if (radius !== undefined) Gfx.NEAR_UPLOAD_R2 = radius;
    for (let i = 0; i < 700; i++) {
      Gfx.setSectionMesh(500 + (i % 30), 500 + ((i * 7) % 30), i % 20, fakeBuf());
    }
    Gfx.setSectionMesh(100, 100, 4, fakeBuf());   // the player's own column, queued LAST
    const ownKey = Gfx.sectionKey(100, 100, 4);
    let frames = 0;
    while (!Gfx.meshes.has(ownKey) && frames < 400) { Gfx.flushUploads(); frames++; }
    if (radius !== undefined) Gfx.NEAR_UPLOAD_R2 = savedR2;
    return frames;
  }

  const framesFixed = runScenario();
  // uploadsPerFrame=2, so 5 frames is ~80ms at 60 fps — nowhere near D-711's measured 1.5-3 s.
  ok(framesFixed <= 5,
    `own-column upload took ${framesFixed} frames behind a 700-deep far backlog — the fence is 5`);

  // radius -1: no squared distance is ever <= -1, so promotion never fires — reproduces the bare
  // FIFO stall this section exists to catch, proving the fence above is not vacuous (D-30).
  const framesDisabled = runScenario(-1);
  ok(framesDisabled > 300,
    `disabling near-disc promotion did not reproduce the FIFO stall (${framesDisabled} frames) — this check is not sensitive to the fix it guards`);

  if (PRINT) console.log(`   with priority: ${framesFixed} frames · FIFO only: ${framesDisabled} frames`);
  Gfx.backend = null;
  Gfx.uploadQueue.length = 0; Gfx.meshes.clear(); Gfx.meshList.length = 0;
}

// ─────────────────────────────────────────────── 7. anti-vacuity
console.log('6. anti-vacuity — break each of the five and watch it fail');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('a spiral sorted the wrong way round', () => {
    const list = W.spiral(6);
    if (list[0] === 0 && list[1] === 0) throw 0;         // nearest first, as it must be
  });

  check('an eviction that keeps the furthest column', () => {
    W.chunks.clear();
    for (let cx = 0; cx <= 8; cx++) W.getOrCreate(cx, 0).state = MCL.CH.GENERATED;
    W.maxChunks = 3; W.evictMargin = 99;
    W.evict(0, 0, 99);
    if (W.chunks.size === 3 && W.get(0, 0) && !W.get(8, 0)) throw 0;
  });

  check('a cancel that forgets to release the slot', () => {
    W.genInflight = 1;
    const c = W.getOrCreate(70, 70);
    W.genJobs.set(W.key(70, 70), 4242);
    W.cancelJobsFor(c);
    if (W.genInflight === 0) throw 0;
  });

  check('a snapshot allocated per mesh', () => {
    // With the pool working, 180 meshes cost a handful of allocations. If it broke, this is
    // where the fence in section 4 would have to notice.
    if (W.stats2.snapAlloc <= 13) throw 0;
  });

  check('the throughput fence set so wide nothing fails it', () => {
    const p50 = meshMs[meshMs.length >> 1];
    if (p50 < 12 && 12 < 1000) throw 0;                  // the fence is real and the sample is under it
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('=============== streamcheck ==============');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
