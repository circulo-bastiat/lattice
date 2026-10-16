#!/usr/bin/env node
// seamcheck.mjs — KW-48b-1 (#586, part of #578/GATE M): the REPRO HARNESS for "see-through blocks".
//
//   node tools/seamcheck.mjs [--verbose]
//
// Dan's report (KW-48): blocks that are solid, breakable and shed particles, but are not drawn - at
// section edges and inside sealed pockets. This is the MEASUREMENT, not the fix. For each edit it
//   1. meshes a small world section by section (the "live" cache, as the game holds it),
//   2. applies ONE edit through the real `World.setBlock` (so the real dirty-marking runs),
//   3. remeshes exactly the sections `World.meshDirty` says are dirty - what `World.stream` does -
//   4. rebuilds EVERY section from scratch and counts the sections whose live mesh differs.
// "Differs" = the whole mesh buffer (so per-direction face counts, positions, AO, light) or the
// visibility mask (the flood's input, KW-48/D-800). A count above 0 is a section that would show a
// stale picture until something else happened to remesh it.
//
// Edits: break and place (stone, glass, water, stairs, leaves) at every section-edge position
// (x/y/z = 0 and 15: all 8 corners, 12 edges, 6 faces, in several sections), plus a sealed 1-block
// pocket in solid stone that is opened (break its wall), re-sealed (place) and swapped.
//
// Anti-vacuity: the same run with ONE neighbour remesh skipped on purpose must be caught.

import { loadEngine } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('  ✓ ' + m); };

console.log('seamcheck - per-section mesh after an edit vs a from-scratch remesh (KW-48b-1)');

const MCL = loadEngine({ extra: ['07_world.js', '08_lighting.js'], dom: false });
const W = MCL.World, CH = MCL.CH, S = MCL.Section, Mesher = MCL.Mesher, R = MCL.Reg, CFG = MCL.CFG;
const stateOf = (n) => MCL.States.stateOf(n);
const STONE = stateOf('stone'), GLASS = stateOf('glass'), WATER = stateOf('water'),
  STAIRS = stateOf('oak_stairs'), LEAVES = stateOf('oak_leaves'), GLOW = stateOf('glowstone');
Mesher.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true, smooth: true });

// ---- deterministic world -------------------------------------------------------------------
let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const RAD = 2, EDIT_RAD = 0;                 // chunks -2..2 exist; edits only in chunk (0,0)
const SY_LO = 3, SY_HI = 6;                  // sections that carry terrain; the rest is air
const SOLID_SY = 4;                          // this section of chunk (0,0) is solid stone (pockets)

function build() {
  seed = 12345;
  W.init(1);
  MCL.Light.init(); MCL.Light.setAdapter(MCL.Light.worldAdapter());
  for (let cx = -RAD; cx <= RAD; cx++) for (let cz = -RAD; cz <= RAD; cz++) {
    const c = W.getOrCreate(cx, cz);
    c.state = CH.GENERATED;
    for (let sy = SY_LO; sy <= SY_HI; sy++) {
      const sec = c.sec[sy];
      const solidHere = sy === SOLID_SY && cx === 0 && cz === 0;
      for (let i = 0; i < 4096; i++) {
        const r = rnd();
        let id;
        if (solidHere) id = STONE;
        else id = r < 0.55 ? STONE : r < 0.75 ? 0 : r < 0.82 ? GLASS : r < 0.88 ? WATER : r < 0.94 ? LEAVES : STAIRS;
        if (id) S.set(sec, i, id);
      }
    }
    c.meshDirty[0] = 0;
  }
}

const bufKey = (buf, vis) => {
  if (!buf) return 'null|' + vis;
  const b = new Uint8Array(buf);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619) >>> 0;
  const q = Mesher.readHeader(buf);
  return h + '|' + b.length + '|' + q.quads + '|' + q.modelQuads + '|' + vis;
};
const meshSection = (cx, cz, sy) => {
  const snap = W.snapshotFor(cx, cz, sy);
  const buf = Mesher.mesh(snap, null);
  const vis = Mesher.lastVis;
  const k = bufKey(buf, vis);
  W.releaseSnap(snap);
  return k;
};
const eachSection = (fn) => {
  for (let cx = -RAD + 1; cx <= RAD - 1; cx++) for (let cz = -RAD + 1; cz <= RAD - 1; cz++)
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) fn(cx, cz, sy);
};

let live;                                    // key -> mesh key, as the "game" holds it
const key = (cx, cz, sy) => cx + ',' + cz + ',' + sy;
function meshAll() {
  live = new Map();
  eachSection((cx, cz, sy) => live.set(key(cx, cz, sy), meshSection(cx, cz, sy)));
  W.chunks.forEach((c) => { c.meshDirty[0] = 0; });
}
/** What World.stream does with the dirty bits; skipNeighbour drops ONE non-origin section (the break). */
function remeshDirty(origin, skipNeighbour) {
  let skipped = false;
  W.chunks.forEach((c) => {
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      if (!(c.meshDirty[0] & (1 << sy))) continue;
      c.meshDirty[0] &= ~(1 << sy);
      const k = key(c.cx, c.cz, sy);
      if (!live.has(k)) continue;                          // outside the measured area
      if (skipNeighbour && k !== origin && !skipped) { skipped = true; continue; }
      live.set(k, meshSection(c.cx, c.cz, sy));
    }
  });
}
// Only the sections whose 18^3 mesh neighbourhood holds the voxel are re-measured (the rest cannot
// change, and re-meshing all of them per edit took minutes): the edit's section plus, for each
// coordinate on a section face, the neighbour across it (corners give up to 8).
function countDiffering(x, y, z, resync) {
  let n = 0; const bad = [];
  const ly = y - CFG.WORLD_MIN_Y, lo = (v) => (v & 15) === 0 ? -1 : 0, hi = (v) => (v & 15) === 15 ? 1 : 0;
  for (let dy = lo(ly); dy <= hi(ly); dy++) for (let dz = lo(z); dz <= hi(z); dz++) for (let dx = lo(x); dx <= hi(x); dx++) {
    const cx = (x >> 4) + dx, cz = (z >> 4) + dz, sy = (ly >> 4) + dy;
    if (sy < 0 || sy >= CFG.SECTIONS_Y) continue;
    const fresh = meshSection(cx, cz, sy);
    if (live.get(key(cx, cz, sy)) !== fresh) { n++; bad.push(key(cx, cz, sy)); }
    if (resync) live.set(key(cx, cz, sy), fresh);
  }
  return { n, bad };
}

// ---- the edit list -------------------------------------------------------------------------
const EDGE = [0, 15];
function editPositions(secs) {
  const positions = [];
  for (const sy of secs) {
  const y0 = CFG.WORLD_MIN_Y + sy * 16;
  for (const lx of EDGE) for (const ly of EDGE) for (const lz of EDGE) positions.push([lx, y0 + ly, lz]);   // corners
  for (const a of EDGE) for (const b of EDGE) {                                                              // edges
    positions.push([a, y0 + b, 7], [7, y0 + a, b], [a, y0 + 7, b]);
  }
  for (const a of EDGE) positions.push([a, y0 + 7, 8], [8, y0 + a, 8], [8, y0 + 7, a]);                    // faces
  }
  return positions;
}
const PLACE = [STONE, GLASS, WATER, STAIRS, LEAVES, GLOW];   // glowstone: light crosses the seam

function runEdits(skipNeighbour, secs, pockets) {
  const positions = editPositions(secs);
  build(); meshAll();
  let edits = 0, badEdits = 0, badSections = 0; const worst = [];
  const one = (x, y, z, id, label) => {
    const before = W.getBlock(x, y, z);
    if (before === id) return;
    const esy = (y - CFG.WORLD_MIN_Y) >> 4, k = key(x >> 4, z >> 4, esy);
    W.setBlock(x, y, z, id); MCL.Light.settle(1e6);
    remeshDirty(k, skipNeighbour);
    edits++;
    const r = countDiffering(x, y, z, false);
    if (r.n) { badEdits++; badSections += r.n; if (worst.length < 5) worst.push(`${label} at ${x},${y},${z} -> ${r.bad.join(' ')}`); }
    // put the world back and re-sync the live meshes, so each edit is measured on its own
    W.setBlock(x, y, z, before); MCL.Light.settle(1e6); remeshDirty(k, false);
    countDiffering(x, y, z, true);
  };
  for (const [x, y, z] of positions) {
    one(x, y, z, 0, 'break');
    for (const id of PLACE) one(x, y, z, id, 'place ' + id);
  }
  // sealed pockets: carve a 1-block cavity in the solid section, then open / reseal / swap a wall
  for (const [px, py, pz] of pockets) {
    const y = CFG.WORLD_MIN_Y + SOLID_SY * 16 + py;
    W.setBlock(px, y, pz, 0); MCL.Light.settle(1e6); remeshDirty(key(0, 0, SOLID_SY), false); countDiffering(px, y, pz, true);
    const wall = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
      .map(([a, b, c]) => [px + a, y + b, pz + c]).filter(([a, b, c]) => W.getBlock(a, b, c) === STONE);
    for (const [wx, wy, wz] of wall) { one(wx, wy, wz, 0, 'open pocket'); one(wx, wy, wz, GLASS, 'glass wall'); }
    one(px, y, pz, STONE, 'fill pocket');
    one(px, y, pz, GLASS, 'glass pocket');
    W.setBlock(px, y, pz, STONE); MCL.Light.settle(1e6); remeshDirty(key(0, 0, SOLID_SY), false); countDiffering(px, y, pz, true);
  }
  return { edits, badEdits, badSections, worst };
}


// ---- the in-flight race (real World.stream + requestMesh, Jobs stubbed) ----------------------
// A mesh job snapshots the section when it is ISSUED and lands later. If a block changes in that
// window, `markDirty` stamps the permissive vis 0x7FFF - and then the stale job lands and writes
// its OLD vis mask over it (requestMesh's `.then`), so the flood reads "sealed" for a section that
// is now open until the re-queued job lands: the KW-48 "solid, breakable, not drawn" window.
// Measured here by the number of sections whose live `vis` hides a connection the truth has.
const AXES = [['x', 1, 0, 0], ['y', 0, 1, 0], ['z', 0, 0, 1]];
function runRace(openAfterLand) {
  let pending = [], nextId = 1000, windows = 0, cases = 0;
  const jobs = {
    mode: 'stub', lastId: 0,
    requestGen() { jobs.lastId = ++nextId; return new Promise(() => {}); },
    requestMesh(cx, cz, sy, snap, release) {
      const buf = Mesher.mesh(snap, null), vis = Mesher.lastVis;
      const copy = buf ? buf.slice(0) : null;
      release(snap);
      jobs.lastId = ++nextId;
      let go; const p = new Promise((res) => { go = () => res({ buf: copy, vis }); });
      pending.push(go);
      return p;
    },
  };
  MCL.Jobs = jobs;
  const land = async () => { const g = pending; pending = []; g.forEach((f) => f()); await Promise.resolve(); await Promise.resolve(); };
  const trueVis = (cx, cz, sy) => { const sn = W.snapshotFor(cx, cz, sy); Mesher.mesh(sn, null); const v = Mesher.lastVis & 0x7FFF; W.releaseSnap(sn); return v; };
  return (async () => {
    for (const [name, ax, ay, az] of AXES) for (const sec of [SOLID_SY]) {
      build();
      const y0 = CFG.WORLD_MIN_Y + sec * 16;
      const cell = (t) => [ax ? t : 7, ay ? t : 7, az ? t : 7];
      for (let t = 0; t < 16; t++) { const [a, b, c] = cell(t); W.setBlock(a, y0 + b, c, t === 8 ? STONE : 0); }
      // settle everything through the real streamer: all clean, vis measured
      W.meshInflight = 0; W.meshJobs.clear();
      W.chunks.forEach((c) => { for (let q = SY_LO; q <= SY_HI; q++) c.meshDirty[0] |= (1 << q); });
      for (let f = 0; f < 200 && (W.meshInflight || W.chunks.get(0, 0) && [...W.chunks.values()].some((c) => c.meshDirty[0])); f++) {
        W.stream(0, 0, 1); await land();
      }
      const before = W.get(0, 0).vis[sec] & 0x7FFF;
      W.markDirty(0, 0, sec); W.stream(0, 0, 1);             // issue a job on the sealed layout
      const inflight = W.meshInflight;
      const [px, py, pz] = cell(8);
      if (!openAfterLand) W.setBlock(px, y0 + py, pz, 0);    // open the plug while the job is out
      await land();                                          // the stale job lands
      if (openAfterLand) W.setBlock(px, y0 + py, pz, 0);     // control: the same edit AFTER it landed
      const c = W.get(0, 0);
      const truth = trueVis(0, 0, sec);
      cases++;
      const hides = (truth & ~c.vis[sec]) !== 0 && (c.meshDirty[0] & (1 << sec)) !== 0;
      if (hides) windows++;
      if (VERBOSE) console.log(`   ${name}-tunnel: before=${before.toString(16)} inflight=${inflight} live=${c.vis[sec].toString(16)} truth=${truth.toString(16)} dirty=${!!(c.meshDirty[0] & (1 << sec))}`);
      // let it converge: the re-queued job must end with the true mask
      for (let f = 0; f < 10; f++) { W.stream(0, 0, 1); await land(); }
      ok((W.get(0, 0).vis[sec] & 0x7FFF) === truth, `${name}-tunnel: vis never converged to the truth`);
      ok(before !== truth && inflight >= 1, `${name}-tunnel: scenario did not set up (before ${before}, truth ${truth}, inflight ${inflight})`);
    }
    return { cases, windows };
  })();
}

const real = runEdits(false, [SY_LO, SOLID_SY, SY_HI], [[5, 5, 5], [0, 0, 0], [15, 15, 15], [0, 8, 15], [8, 15, 0]]);
console.log(`  ${real.edits} edits at section edges/corners/pockets: ${real.badEdits} left a stale mesh, ${real.badSections} sections differ from a full rebuild`);
for (const w of real.worst) console.log('    ' + w);
ok(real.edits > 400, `too few edits measured (${real.edits})`);
ok(real.badSections === 0, `${real.badSections} sections (in ${real.badEdits} edits) differ from a from-scratch remesh`);


const race = await runRace(false);
const control = await runRace(true);
console.log(`  in-flight race: ${race.windows} of ${race.cases} openings left the section's live vis hiding a real connection (flood culls it) after the stale job landed`);
ok(race.windows === 0, `${race.windows}/${race.cases} sections showed a stale "sealed" vis mask while dirty (a stale mesh job landed over markDirty's permissive mask)`);

// anti-vacuity: the detector is silent when the edit lands after the job (no window), so it is not
// simply always firing; the two below show it sees a missed neighbour and a missed markDirty.
okAv(control.windows === 0 && control.cases === race.cases, 'the same openings AFTER the job landed show no stale window (' + control.windows + ' of ' + control.cases + ')');
// anti-vacuity: skip one neighbour remesh per edit -> the count must be non-zero
const broken = runEdits(true, [SOLID_SY], [[5, 5, 5]]);
console.log(`  [break] one neighbour remesh skipped: ${broken.badEdits} edits / ${broken.badSections} sections differ`);
okAv(broken.badSections > 0, 'skipping one neighbour remesh is seen as differing sections (' + broken.badSections + ')');
// a second break: a world edit that is NOT marked dirty at all
{
  build(); meshAll();
  const y = CFG.WORLD_MIN_Y + SOLID_SY * 16 + 15;
  const sec = W.get(0, 0).sec[SOLID_SY];
  S.set(sec, (15 << 8) | (7 << 4) | 15, 0);          // bypasses setBlock: nothing dirty
  remeshDirty(key(0, 0, SOLID_SY), false);
  okAv(countDiffering(15, CFG.WORLD_MIN_Y + SOLID_SY * 16 + 15, 7, false).n > 0, 'an edit that bypasses markDirty is seen');
}

console.log(`seamcheck: ${pass} checks passed, ${fails.length} failures (${breaks} anti-vacuity)`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
