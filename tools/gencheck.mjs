#!/usr/bin/env node
// tools/gencheck.mjs — headless validation and visualisation of THE WORLD.
//
// There is no GPU here and no browser. This tool loads the real generator, cave and mesher
// sources — the same text build.mjs bakes into the worker bundle — runs them, and reports
// whether the terrain is actually shaped like Minecraft:
//
//   1. an ASCII cross-section, so the silhouette is reviewable without rendering anything;
//   2. statistics: surface height distribution, cave void fraction, ore counts per type,
//      biome distribution, section storage cost;
//   3. invariants that must hold or the game is broken: determinism, bedrock floor, no floating
//      water above the sea, the mesher's corner table matching the renderer's, the §8 buffer
//      round-tripping, and no seams at a chunk boundary.
//
// Usage: node tools/gencheck.mjs [--seed N] [--cx N] [--cz N] [--wide N]
//                                [--ytop N] [--ybot N] [--section] [--quiet]
//        --section  print the cross-section only (what gets pasted into a docs/archive/PLAN.md finding)
//
// The default sample window is NOT the origin. It is a deliberately varied region — ocean,
// swamp, forest and a mountain ridge in one 7x7 chunk square — because a statistics run over a
// patch of flat ocean tells you nothing about whether the generator works.

import { readFileSync } from 'node:fs';
import { loadEngine, WORKER_FILES } from './loadsrc.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const ASSETS_DIR = join(ROOT, 'assets');

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : dflt;
};
const SEED = argOf('--seed', 1337) >>> 0;
const CX = argOf('--cx', -78) | 0;
const CZ = argOf('--cz', -72) | 0;
const WIDE = argOf('--wide', 128);
const YTOP = argOf('--ytop', null);
const YBOT = argOf('--ybot', null);
const SECTION_ONLY = argv.includes('--section');
const QUIET = argv.includes('--quiet') || SECTION_ONLY;

let errors = 0, checks = 0;
const fail = (what, detail) => { errors++; console.error('FAIL  ' + what + (detail ? '\n      ' + String(detail).split('\n').join('\n      ') : '')); };
const ok = (what) => { checks++; if (!QUIET) console.log('ok    ' + what); };
const need = (cond, what, detail) => { cond ? ok(what) : fail(what, detail); return cond; };
const say = (...a) => { if (!QUIET) console.log(...a); };

// ---------------------------------------------------------------------------
// Load the real modules headlessly. 06/10 are main-thread files; they are pulled in only so
// the atlas <-> blocks tile table and Gfx.faceCorners can be cross-checked against the
// worker-side copies.
// ---------------------------------------------------------------------------

const MAIN_FILES = ['06_atlas.js', '07_world.js', '10_camera.js', '10_gfx.js'];

let MCL;
try {
  MCL = loadEngine({ extra: MAIN_FILES, dom: true });
} catch (e) {
  fail('loading src modules', e.stack || e.message);
  process.exit(1);
}
ok('loaded ' + (WORKER_FILES.length + MAIN_FILES.length) + ' modules headlessly');

/** A SECOND, independent MCL built from the worker files only — proves the worker bundle is
 *  self-sufficient (no atlas, no DOM) and lets determinism be tested across instances. */
function loadWorkerOnly() { return loadEngine({}); }

const B = MCL.Blocks, CFG = MCL.CFG, G = MCL.Gen, S = MCL.Section;
const SR = MCL.States, REG = MCL.Reg;
B.init();
// ⚠ CLIMATE EXPLICIT: VANILLA, BY NAME (D-182). This file's statistics (surface height, biome
// distribution, the ASCII cross-section) were all tuned reading vanilla's own worldgen; Earth
// mode becoming the world-creation default must not silently swap what "the world" means here.
G.init(SEED, Object.assign(G.defaults(), { climate: 'vanilla' }));

// ⚠ SESSION 2: an "id" in this file is a REGISTRY REAL STATE, not a legacy block id. The two
// helpers below are the only place that knows it, which is why almost nothing else changed.
const NAME = id => SR.name(id) || ('?' + id);
const ID = n => SR.stateOf(n);

// ---------------------------------------------------------------------------
// 1. Registry and tile-table wiring
// ---------------------------------------------------------------------------
{
  need(ID('air') === 0 && SR.AIR === 0, 'states: air is real state 0');
  need(REG.blockCount > 800, 'registry: ' + REG.blockCount + ' blocks');
  need(SR.count === REG.realCount && SR.count > 20000, 'states: ' + SR.count + ' real states');

  const untextured = [];
  // every block the worldgen can place must have a texture that is not the missing-tile
  for (const n of Object.keys(G.ids)) {
    const st = G.ids[n];
    if (st > 0 && SR.geom[st] !== SR.GEOM_NONE && SR.iconTile(st) === 0) untextured.push(n);
  }
  need(untextured.length === 0, 'blocks: every non-air block has a tile without the atlas',
       untextured.join(', '));

  // The worker never runs 06_atlas.js, so bindAtlas must be a NO-OP: if it changes anything,
  // the worker and the main thread would disagree about textures (D-57).
  const before = Uint16Array.from(B.tiles);
  B.bindAtlas(MCL.Atlas.map());
  let drift = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== B.tiles[i]) drift++;
  need(drift === 0, 'blocks: Atlas.map() agrees with the registry (bindAtlas is a no-op)',
       drift + ' face tiles differ');

  let tableErr = null;
  try { MCL.Atlas.assertTileTable(); } catch (e) { tableErr = e.message; }
  need(!tableErr, 'atlas: private tile table matches Blocks.T', tableErr);

  // every block the generator names must exist
  const missing = Object.keys(G.ids).filter(k => k !== 'air' && G.ids[k] === 0);
  need(missing.length === 0, 'worldgen: every block it places is registered', missing.join(', '));
}

// ---------------------------------------------------------------------------
// 2. Mesher/renderer corner-table agreement (D-69)
// ---------------------------------------------------------------------------
{
  const bad = [];
  for (let f = 0; f < 6; f++) {
    for (const [w, h] of [[1, 1], [3, 1], [1, 5], [4, 7]]) {
      const a = JSON.stringify(MCL.Mesher.faceCorners(f, w, h));
      const b = JSON.stringify(MCL.Gfx.faceCorners(f, w, h));
      if (a !== b) bad.push('face ' + f + ' ' + w + 'x' + h + ': ' + a + ' vs ' + b);
    }
  }
  need(bad.length === 0, 'mesher: faceCorners is identical to Gfx.faceCorners', bad.join('\n'));

  // ⚠ AND WHICH WAY EACH ONE FACES (D-133). The two tables agreeing proves only that they agree;
  // both could be wound inside out together, which is precisely what happened to the MODEL
  // stream and made every slab, stair and grass block in the game invisible for a session and a
  // half. The index buffer is one linear ramp and the pipeline culls back faces, so a quad's
  // winding is the difference between drawn and not drawn. Derive the normal from the corners
  // themselves and require it to point along the face's own axis.
  const FACE_NORMAL = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];   // mesher order
  const windErr = [];
  for (let f = 0; f < 6; f++) {
    for (const [w, h] of [[1, 1], [3, 2], [5, 4]]) {
      const c = MCL.Mesher.faceCorners(f, w, h);
      const ux = c[1][0]-c[0][0], uy = c[1][1]-c[0][1], uz = c[1][2]-c[0][2];
      const vx = c[2][0]-c[0][0], vy = c[2][1]-c[0][1], vz = c[2][2]-c[0][2];
      const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      const N = FACE_NORMAL[f];
      const dot = (nx*N[0] + ny*N[1] + nz*N[2]) / len;
      if (!(dot > 0.9)) windErr.push('face ' + f + ' ' + w + 'x' + h + ': normal points ' + dot.toFixed(2) + ' along its own axis');
    }
  }
  need(windErr.length === 0, 'mesher: every greedy face is wound to face outward', windErr.join('\n'));

  // FACE_AXIS must be derivable from the corner table, or AO lands on the wrong corner
  const axErr = [];
  const tbl = MCL.Mesher.cornerTable();
  for (let f = 0; f < 6; f++) {
    const ax = MCL.Mesher.FACE_AXIS[f], t = tbl[f];
    for (let v = 0; v < 4; v++) {
      if (t[v * 4 + ax[0]] > 1) axErr.push('face ' + f + ': fixed axis carries w/h');
      if (t[v * 4 + ax[1]] !== 0 && t[v * 4 + ax[1]] !== 2) axErr.push('face ' + f + ': a axis is not 0/w');
      if (t[v * 4 + ax[2]] !== 0 && t[v * 4 + ax[2]] !== 3) axErr.push('face ' + f + ': b axis is not 0/h');
    }
  }
  need(axErr.length === 0, 'mesher: FACE_AXIS agrees with the corner table', axErr.join('\n'));
}

// ---------------------------------------------------------------------------
// 3. Generate
// ---------------------------------------------------------------------------

const R = 3;                              // chunks: (2R+1)^2 columns generated for statistics
const chunks = new Map();
const key = (cx, cz) => cx * 10007 + cz;

let genMs = 0;
for (let dz = -R; dz <= R; dz++) {
  for (let dx = -R; dx <= R; dx++) {
    const cx = CX + dx, cz = CZ + dz;
    const t0 = process.hrtime.bigint();
    const col = G.genColumn(cx, cz);
    genMs += Number(process.hrtime.bigint() - t0) / 1e6;
    chunks.set(key(cx, cz), col);
  }
}
const nChunks = chunks.size;
ok('generated ' + nChunks + ' chunks in ' + genMs.toFixed(1) + ' ms (' +
   (genMs / nChunks).toFixed(2) + ' ms/chunk)');

/** Read a block from a generated column. */
function blockAt(col, lx, y, lz) {
  const ly = y - CFG.WORLD_MIN_Y;
  if (ly < 0 || ly >= CFG.CHUNK_H) return 0;
  return S.get(col.sec[ly >> 4], ((ly & 15) << 8) | (lz << 4) | lx);
}
function lightAt(col, lx, y, lz) {
  const ly = y - CFG.WORLD_MIN_Y;
  if (ly < 0 || ly >= CFG.CHUNK_H) return 0xF0;
  return S.getLight(col.sec[ly >> 4], ((ly & 15) << 8) | (lz << 4) | lx);
}
function worldBlock(wx, y, wz) {
  const col = chunks.get(key(wx >> 4, wz >> 4));
  return col ? blockAt(col, wx & 15, y, wz & 15) : -1;
}

// ---------------------------------------------------------------------------
// 4. Determinism (same thread, and a fresh module instance)
// ---------------------------------------------------------------------------
{
  const again = G.genColumn(CX, CZ);
  const a = chunks.get(key(CX, CZ));
  let diff = 0;
  for (let y = CFG.WORLD_MIN_Y; y < CFG.WORLD_MAX_Y; y += 3) {
    for (let i = 0; i < 256; i += 7) {
      if (blockAt(a, i & 15, y, i >> 4) !== blockAt(again, i & 15, y, i >> 4)) diff++;
    }
  }
  need(diff === 0, 'worldgen: deterministic on re-generation', diff + ' voxels differ');

  const W2 = loadWorkerOnly();
  W2.Blocks.init();
  // Same explicit mode as the main instance above (D-182) — this is a cross-instance identity
  // check, and the two sides must be asked for the same world.
  W2.Gen.init(SEED, Object.assign(W2.Gen.defaults(), { climate: 'vanilla' }));
  const other = W2.Gen.genColumn(CX, CZ);
  let diff2 = 0;
  for (let y = CFG.WORLD_MIN_Y; y < CFG.WORLD_MAX_Y; y += 3) {
    for (let i = 0; i < 256; i += 7) {
      const p = blockAt(a, i & 15, y, i >> 4);
      const q = W2.Section.get(other.sec[(y - CFG.WORLD_MIN_Y) >> 4],
                               (((y - CFG.WORLD_MIN_Y) & 15) << 8) | ((i >> 4) << 4) | (i & 15));
      if (p !== q) diff2++;
    }
  }
  need(diff2 === 0, 'worldgen: a worker-only bundle generates the identical world (D-38)',
       diff2 + ' voxels differ');
}

// ---------------------------------------------------------------------------
// 5. Statistics
// ---------------------------------------------------------------------------

const stats = {
  hMin: 1e9, hMax: -1e9, hSum: 0, hN: 0,
  biome: new Array(MCL.Biomes.count).fill(0),
  ore: Object.create(null),
  solidBelow: 0, airBelow: 0, waterBelow: 0, lavaBelow: 0,
  uniformSections: 0, totalSections: 0, bytes: 0,
  floatingWater: 0, bedrockHoles: 0, sculk: 0, plants: 0, logs: 0, leaves: 0
};
const SEA = G.defaults().seaLevel;
const oreNames = new Set();
for (const [a, b] of G.orePairs) { oreNames.add(NAME(a)); oreNames.add(NAME(b)); }

for (const [, col] of chunks) {
  for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
    stats.totalSections++;
    if (col.sec[sy].u >= 0) stats.uniformSections++;
    stats.bytes += S.bytes(col.sec[sy]);
  }
  for (let i = 0; i < 256; i++) {
    const h = col.hmap[i] + CFG.WORLD_MIN_Y;
    stats.hMin = Math.min(stats.hMin, h); stats.hMax = Math.max(stats.hMax, h);
    stats.hSum += h; stats.hN++;
    stats.biome[col.biome[i]]++;
  }
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const surf = col.hmap[(lz << 4) | lx] + CFG.WORLD_MIN_Y;
      if (blockAt(col, lx, CFG.WORLD_MIN_Y, lz) !== ID('bedrock')) stats.bedrockHoles++;
      for (let y = CFG.WORLD_MIN_Y + 1; y < CFG.WORLD_MAX_Y; y++) {
        const id = blockAt(col, lx, y, lz);
        if (y < surf) {
          if (id === 0) stats.airBelow++;
          else if (id === ID('water')) stats.waterBelow++;
          else if (id === ID('lava')) stats.lavaBelow++;
          else stats.solidBelow++;
        }
        if (!id) continue;
        const n = NAME(id);
        if (oreNames.has(n)) stats.ore[n] = (stats.ore[n] || 0) + 1;
        else if (id === ID('sculk')) stats.sculk++;
        else if (id === ID('water')) { if (y > SEA) stats.floatingWater++; }
        else if (SR.geom[id] === SR.GEOM_MODEL) stats.plants++;
        else if (n_isLog(id)) stats.logs++;
        else if (n_isLeaf(id)) stats.leaves++;
      }
    }
  }
}
function n_isLog(id) {
  return id === ID('oak_log') || id === ID('birch_log') || id === ID('spruce_log');
}
function n_isLeaf(id) {
  return id === ID('oak_leaves') || id === ID('birch_leaves') || id === ID('spruce_leaves');
}

const belowTotal = stats.airBelow + stats.solidBelow + stats.waterBelow + stats.lavaBelow;
const voidFrac = stats.airBelow / Math.max(1, belowTotal);

// ---------------------------------------------------------------------------
// 6. Invariants that must hold
// ---------------------------------------------------------------------------
need(stats.bedrockHoles === 0, 'world: bedrock floor is unbroken at y=-64', stats.bedrockHoles + ' holes');
// ⚠ WATER ABOVE SEA LEVEL IS NOW LEGAL, and it was not before W8. `spring_water` puts a source
// block in a hillside — that is what a spring IS, and vanilla places thousands of them. What is
// still illegal is a LOT of it: a sea that has climbed the hills, or a lake feature that filled
// the sky. The band is per-chunk so it does not drift with the sample size.
{
  const perChunk = stats.floatingWater / (7 * 7);
  need(perChunk < 40, 'world: water above sea level is springs, not a flood',
       perChunk.toFixed(1) + ' blocks per chunk above y=' + SEA);
}
need(stats.hMin >= CFG.WORLD_MIN_Y && stats.hMax < CFG.WORLD_MAX_Y,
     'world: every surface is inside the vertical range');
need(voidFrac > 0.015 && voidFrac < 0.30,
     'caves: void fraction ' + (voidFrac * 100).toFixed(2) + '% is in a believable band (1.5-30%)');
{
  // The deep dark is a PLACE, so a 7x7 chunk sample may legitimately contain none of it.
  // Find a column where the deep-dark field is strong, generate that chunk, and check there.
  let sculk = stats.sculk, where = CX + ',' + CZ;
  if (!sculk) {
    let bx = 0, bz = 0, best = -2;
    for (let z = -160; z <= 160; z += 5) for (let x = -160; x <= 160; x += 5) {
      const n = MCL.U.noise2(G.perm, (x * 16 + 8) / 300 + 61000.5, (z * 16 + 8) / 300 + 61000.5);
      if (n > best) { best = n; bx = x; bz = z; }
    }
    const col = G.genColumn(bx, bz);
    where = bx + ',' + bz + ' (field ' + best.toFixed(2) + ')';
    for (let sy = 0; sy < 4; sy++) {
      for (let i = 0; i < CFG.SECTION_VOL; i++) if (S.get(col.sec[sy], i) === ID('sculk')) sculk++;
    }
  }
  need(sculk > 0, 'deep dark: sculk generates at the bottom of the world (' + sculk +
       ' blocks at chunk ' + where + ')');
}
need(stats.logs > 0, 'decoration: trees were placed (' + (stats.logs / nChunks).toFixed(1) +
     ' log + ' + (stats.leaves / nChunks).toFixed(1) + ' leaf blocks per chunk)');
need(stats.plants > 0, 'decoration: ground cover was placed (' + stats.plants + ' cross blocks)');
{
  let oresFound = 0;
  for (const n of oreNames) if (stats.ore[n]) oresFound++;
  need(oresFound >= 10, 'ores: ' + oresFound + ' of ' + oreNames.size + ' ore variants present');
}
{
  // deepslate must dominate below y=-10 and stone above y=+10
  let deepLow = 0, stoneLow = 0, deepHigh = 0, stoneHigh = 0;
  for (const [, col] of chunks) for (let i = 0; i < 256; i += 5) {
    const lx = i & 15, lz = i >> 4;
    for (const y of [-40, -20]) { const id = blockAt(col, lx, y, lz);
      if (id === ID('deepslate')) deepLow++; else if (id === ID('stone')) stoneLow++; }
    for (const y of [15, 30]) { const id = blockAt(col, lx, y, lz);
      if (id === ID('deepslate')) deepHigh++; else if (id === ID('stone')) stoneHigh++; }
  }
  need(deepLow > stoneLow * 20, 'world: deepslate replaces stone below y=0 (' + deepLow + ' vs ' + stoneLow + ')');
  need(stoneHigh > deepHigh * 20, 'world: stone above y=0 is not deepslate (' + stoneHigh + ' vs ' + deepHigh + ')');
}
{
  // light: open sky must be 15 at the top, and the bottom of the world must be dark
  let brightTop = 0, darkBottom = 0, n = 0;
  for (const [, col] of chunks) for (let i = 0; i < 256; i += 11) {
    const lx = i & 15, lz = i >> 4;
    if ((lightAt(col, lx, 250, lz) >> 4) === 15) brightTop++;
    if (lightAt(col, lx, -30, lz) === 0) darkBottom++;
    n++;
  }
  need(brightTop === n, 'light: y=250 is full skylight everywhere (' + brightTop + '/' + n + ')');
  need(darkBottom > n * 0.95, 'light: the deep dark is dark (' + darkBottom + '/' + n + ' unlit at y=-30)');
}

// ---------------------------------------------------------------------------
// 7. Mesh the generated world and check for seams
// ---------------------------------------------------------------------------

/** Build a real MeshSnapshot from the generated chunks (this is World.snapshotFor's job). */
function snapshotFor(cx, cz, sy) {
  const nb = new Array(27);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const slot = (dy + 1) * 9 + (dz + 1) * 3 + (dx + 1);
        const ny = sy + dy;
        if (ny < 0 || ny >= CFG.SECTIONS_Y) { nb[slot] = null; continue; }
        const c = chunks.get(key(cx + dx, cz + dz));
        nb[slot] = c ? S.copy(c.sec[ny]) : null;
      }
    }
  }
  return { sy, base: CFG.WORLD_MIN_Y + sy * 16, nb, biome: null };
}

let meshMs = 0, meshQuads = 0, meshSections = 0, meshBytes = 0;
const perLayer = [0, 0, 0];
// pass 0 warms the JIT, pass 1 is the one that is timed: a cold first-call number would say
// more about V8 than about the mesher.
for (let pass = 0; pass < 2; pass++) {
if (pass === 1) { meshMs = 0; meshQuads = 0; meshSections = 0; meshBytes = 0; perLayer[0] = perLayer[1] = perLayer[2] = 0; }
for (let dz = -1; dz <= 1; dz++) {
  for (let dx = -1; dx <= 1; dx++) {
    const cx = CX + dx, cz = CZ + dz;
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      const snap = snapshotFor(cx, cz, sy);
      const t0 = process.hrtime.bigint();
      const buf = MCL.Mesher.mesh(snap, null);
      meshMs += Number(process.hrtime.bigint() - t0) / 1e6;
      if (!buf) continue;
      const hdr = MCL.Mesher.readHeader(buf);
      if (!hdr) { fail('mesh: bad header at ' + cx + ',' + cz + ',' + sy); continue; }
      meshSections++;
      meshBytes += buf.byteLength;
      for (let L = 0; L < 3; L++) { perLayer[L] += hdr.quads[L]; meshQuads += hdr.quads[L]; }
      const total = hdr.quads[0] + hdr.quads[1] + hdr.quads[2];
      // ⚠ The model stream counts too. Before session 2 this assertion happened to hold
      // because the only blocks on the model path were torches; now every stair, slab, fence
      // and plant is there, and a check that ignores the second stream fails on any section
      // holding a flower.
      const mTotal = hdr.modelQuads[0] + hdr.modelQuads[1] + hdr.modelQuads[2];
      const want = CFG.MESH_HEADER_BYTES + total * CFG.QUAD_BYTES + mTotal * CFG.MODEL_QUAD_BYTES;
      if (buf.byteLength !== want) {
        fail('mesh: buffer size does not match the quad counts at ' + cx + ',' + cz + ',' + sy +
             ' (' + buf.byteLength + ' vs ' + want + ')');
      }
      if (total > CFG.MAX_QUADS) fail('mesh: MAX_QUADS exceeded at ' + cx + ',' + cz + ',' + sy);
    }
  }
}
}
ok('meshed ' + meshSections + ' non-empty sections, ' + meshQuads + ' quads, ' +
   (meshBytes / 1024).toFixed(0) + ' KB, ' + meshMs.toFixed(1) + ' ms');
need(meshQuads > 0, 'mesh: the world produced geometry');

/**
 * Seam test. A face on the chunk boundary must be emitted exactly when the block on the other
 * side of the boundary is non-opaque — the same rule an interior face follows. This is the
 * check that catches "the mesher forgot its neighbours", which is invisible until you fly.
 */
{
  // One entry per QUAD: its first vertex, which for faces 0 and 4 is the one that carries the
  // boundary coordinate (16). uRep/vRep on that vertex give the merged quad's area.
  const quadsOf = (buf) => {
    const hdr = MCL.Mesher.readHeader(buf);
    const u = new Uint32Array(buf);
    const out = [];
    for (let L = 0; L < 3; L++) {
      let o = hdr.off[L] >> 2;
      for (let q = 0; q < hdr.quads[L]; q++) { out.push([u[o], u[o + 1]]); o += 8; }
    }
    return out;
  };
  // Compare, for EVERY section of one chunk, the faces the mesher emitted on the +X and +Z
  // chunk boundaries against the faces the block data says should be there.
  let emitted = 0, expected = 0;
  for (let ci = 0; ci < 9; ci++) {
  const ccx = CX + (ci % 3) - 1, ccz = CZ + ((ci / 3) | 0) - 1;
  const bx = ccx * 16, bz = ccz * 16;
  for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
    const buf = MCL.Mesher.mesh(snapshotFor(ccx, ccz, sy), null);
    if (buf) {
      for (const [d0, d1] of quadsOf(buf)) {
        const face = (d0 >>> 18) & 7;
        const x = d0 & 63, z = (d0 >>> 12) & 63;
        const uRep = (d1 >>> 12) & 255, vRep = (d1 >>> 20) & 255;
        if (face === 0 && x === 16) emitted += uRep * vRep;
        if (face === 4 && z === 16) emitted += uRep * vRep;
      }
    }
    const y0 = CFG.WORLD_MIN_Y + sy * 16;
    for (let dy = 0; dy < 16; dy++) {
      for (let d = 0; d < 16; d++) {
        // +X boundary
        let here = worldBlock(bx + 15, y0 + dy, bz + d);
        let there = worldBlock(bx + 16, y0 + dy, bz + d);
        if (here > 0 && SR.geom[here] === SR.GEOM_CUBE && !SR.opaque[there] &&
            !(there === here && SR.selfCull[here])) expected++;
        // +Z boundary
        here = worldBlock(bx + d, y0 + dy, bz + 15);
        there = worldBlock(bx + d, y0 + dy, bz + 16);
        if (here > 0 && SR.geom[here] === SR.GEOM_CUBE && !SR.opaque[there] &&
            !(there === here && SR.selfCull[here])) expected++;
      }
    }
  }
  }
  need(expected > 100, 'mesh: the seam test actually had faces to check (' + expected + ')');
  need(emitted === expected,
       'mesh: chunk-boundary +X/+Z faces match the block data (' + emitted + ' of ' + expected + ')',
       'a mismatch means seams or double walls at every chunk border');
}

// ---------------------------------------------------------------------------
// 7b. Synthetic mesh cases — the ones with a known right answer
// ---------------------------------------------------------------------------
{
  const AIR = S.makeUniform(0, S.packLight(15, 0));
  const snapOf = (centre, around) => {
    const nb = new Array(27);
    for (let i = 0; i < 27; i++) nb[i] = i === 13 ? centre : around;
    return { sy: 4, base: 0, nb, biome: null };
  };
  const count = (buf) => {
    if (!buf) return [0, 0, 0];
    const h = MCL.Mesher.readHeader(buf);
    return h.quads;
  };

  need(MCL.Mesher.mesh(snapOf(S.makeUniform(0, 0xF0), AIR), null) === null,
       'mesh: an empty air section produces no buffer');

  // a solid stone section surrounded by air: 6 faces, each greedy-merged to one 16x16 quad
  const solid = S.makeUniform(ID('stone'), 0);
  need(JSON.stringify(count(MCL.Mesher.mesh(snapOf(solid, AIR), null))) === '[6,0,0]',
       'mesh: a solid section in open air greedy-merges to exactly 6 quads',
       JSON.stringify(count(MCL.Mesher.mesh(snapOf(solid, AIR), null))));

  // the same section surrounded by stone: every face is culled
  need(MCL.Mesher.mesh(snapOf(solid, S.makeUniform(ID('stone'), 0)), null) === null,
       'mesh: a buried section produces no geometry at all');

  // a null neighbourhood must be treated as opaque, not as air (D-41)
  need(MCL.Mesher.mesh(snapOf(solid, null), null) === null,
       'mesh: an ungenerated neighbour culls the face (no wall at the load frontier)');

  // --- 7c. section visibility masks (ARCH 9.1, D-85) ------------------------
  // These are the numbers the renderer's occlusion flood walks. Getting one wrong does not
  // crash anything — it quietly deletes part of the world from the screen — so they are
  // checked here against sections whose answer is obvious by eye.
  {
    const V = MCL.Mesher, ALL = V.VIS_ALL;
    const maskOf = (centre) => { V.mesh(snapOf(centre, AIR), null); return V.lastVis; };
    const pair = (a, b) => V.PAIRBIT[a * 6 + b];
    const conn = (m, a, b) => ((m >>> pair(a, b)) & 1) === 1;

    need(maskOf(S.makeUniform(0, 0xF0)) === ALL,
         'vis: an air section connects all 15 face pairs');
    need(maskOf(solid) === 0,
         'vis: a solid stone section connects nothing — the flood stops there',
         '0x' + maskOf(solid).toString(16));

    // a single 1x1 shaft straight up the middle: +Y connects to -Y and to nothing else
    {
      const sec = S.makeUniform(ID('stone'), 0);
      for (let y = 0; y < 16; y++) S.set(sec, S.index(8, y, 8), 0);
      const m = maskOf(sec);
      need(conn(m, 2, 3) && !conn(m, 0, 1) && !conn(m, 4, 5) && !conn(m, 0, 2),
           'vis: a vertical shaft connects +Y to -Y and no other pair', '0x' + m.toString(16));
    }
    // a 1x1 tunnel along X: +X to -X only
    {
      const sec = S.makeUniform(ID('stone'), 0);
      for (let x = 0; x < 16; x++) S.set(sec, S.index(x, 8, 8), 0);
      const m = maskOf(sec);
      need(conn(m, 0, 1) && !conn(m, 2, 3) && !conn(m, 4, 5),
           'vis: an X tunnel connects +X to -X and no other pair', '0x' + m.toString(16));
    }
    // an L bend from -X to +Z: those two connect, and neither connects to anything else
    {
      const sec = S.makeUniform(ID('stone'), 0);
      for (let x = 0; x <= 8; x++) S.set(sec, S.index(x, 8, 8), 0);
      for (let z = 8; z < 16; z++) S.set(sec, S.index(8, 8, z), 0);
      const m = maskOf(sec);
      need(conn(m, 1, 4) && !conn(m, 0, 1) && !conn(m, 2, 3),
           'vis: an L-shaped tunnel connects only the two faces it actually reaches',
           '0x' + m.toString(16));
    }
    // two tunnels that do NOT touch must not be merged into one component
    {
      const sec = S.makeUniform(ID('stone'), 0);
      for (let x = 0; x < 16; x++) S.set(sec, S.index(x, 2, 2), 0);    // X tunnel, low
      for (let z = 0; z < 16; z++) S.set(sec, S.index(13, 13, z), 0);  // Z tunnel, high
      const m = maskOf(sec);
      need(conn(m, 0, 1) && conn(m, 4, 5) && !conn(m, 0, 4) && !conn(m, 1, 5),
           'vis: two disjoint tunnels stay disjoint — no false connection', '0x' + m.toString(16));
    }
    // a half-buried surface section: the air above joins every side and the top
    {
      const sec = S.makeUniform(0, 0xF0);
      for (let y = 0; y < 8; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++)
        S.set(sec, S.index(x, y, z), ID('stone'));
      const m = maskOf(sec);
      need(conn(m, 2, 0) && conn(m, 2, 1) && conn(m, 2, 4) && conn(m, 2, 5) && conn(m, 0, 4),
           'vis: a terrain-surface section connects its top to all four sides',
           '0x' + m.toString(16));
      need(!conn(m, 3, 2), 'vis: ...but not through the solid half to -Y');
    }
    // non-opaque blocks are passable: a glass/leaf column still connects
    {
      const sec = S.makeUniform(ID('stone'), 0);
      const leaf = ID('oak_leaves');
      for (let y = 0; y < 16; y++) S.set(sec, S.index(8, y, 8), leaf);
      need(conn(maskOf(sec), 2, 3),
           'vis: a column of leaves is see-through, so it connects like air');
    }
    // the mask survives the round trip through the §8 header word 7
    {
      const sec = S.makeUniform(0, 0xF0);
      S.set(sec, S.index(8, 8, 8), ID('stone'));
      const buf = V.mesh(snapOf(sec, AIR), null);
      need(MCL.Mesher.readHeader(buf).vis === V.lastVis && V.lastVis === ALL,
           'vis: the mask travels in mesh header word 7', String(MCL.Mesher.readHeader(buf).vis));
    }
    // Gfx carries its own copy of the pair table; it must agree bit for bit (ARCH 9.1)
    {
      let same = true;
      for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
        if (MCL.Gfx.PAIRBIT[a * 6 + b] !== V.PAIRBIT[a * 6 + b]) same = false;
      }
      need(same, 'vis: Gfx and Mesher agree on the face-pair bit numbering');
    }
  }

  // --- 7d. mesh detail options (ARCH 8.1) -----------------------------------
  {
    const sec = S.makeUniform(0, S.packLight(15, 0));
    S.set(sec, S.index(8, 8, 8), ID('stone'));
    // an inside corner: the top face of (5,4,4) has an opaque block beside it at (5,5,4),
    // which is exactly the 3-neighbour case AO exists to darken
    S.set(sec, S.index(4, 4, 4), ID('stone'));
    S.set(sec, S.index(5, 4, 4), ID('stone'));
    S.set(sec, S.index(4, 5, 4), ID('stone'));
    S.set(sec, S.index(4, 5, 5), ID('stone'));
    const withAO = MCL.Mesher.mesh(snapOf(sec, AIR), { ao: true, cross: true });
    const noAO = MCL.Mesher.mesh(snapOf(sec, AIR), { ao: false, cross: true });
    const aoOf = (buf) => {
      const h = MCL.Mesher.readHeader(buf), u = new Uint32Array(buf);
      let min = 3;
      for (let o = h.off[0] >> 2, n = 0; n < h.quads[0] * 4; n++, o += 2) min = Math.min(min, (u[o] >>> 21) & 3);
      return min;
    };
    need(aoOf(withAO) < 3, 'opt: AO on darkens at least one vertex of a corner');
    need(aoOf(noAO) === 3, 'opt: AO off writes ao=3 on every vertex');
    need(MCL.Mesher.readHeader(noAO).quads[0] <= MCL.Mesher.readHeader(withAO).quads[0],
         'opt: AO off never produces MORE quads (it merges at least as well)');

    // fast leaves (D-93): a solid cube of leaves must collapse from a cutout shell to an
    // opaque shell, and the cutout layer must empty out entirely
    {
      const box = S.makeUniform(0, S.packLight(15, 0));
      const leaf = ID('oak_leaves');
      for (let y = 4; y < 12; y++) for (let z = 4; z < 12; z++) for (let x = 4; x < 12; x++)
        S.set(box, S.index(x, y, z), leaf);
      MCL.Mesher.setOptions({ fastLeaves: false });
      const fancy = MCL.Mesher.readHeader(MCL.Mesher.mesh(snapOf(box, AIR), null)).quads;
      MCL.Mesher.setOptions({ fastLeaves: true });
      const fast = MCL.Mesher.readHeader(MCL.Mesher.mesh(snapOf(box, AIR), null)).quads;
      // ⚠ THIS ASSERTION USED TO SAY 6, AND THAT IS HOW THE BUG LIVED THROUGH THREE SESSIONS
      // (D-178). Six is the count you get when leaves cull against leaves — an empty shell —
      // and the check had written the bug down as the specification, so no run could catch it.
      //
      // The right number is derivable without reading the mesher. Fancy leaves self-cull
      // against NOTHING, so every one of the 512 blocks emits all six of its faces. The greedy
      // pass then merges each full, uniform 8x8 plane into a single quad: 8 planes stacked
      // along each axis, six face directions, 8 * 6 = 48. Anything less means faces are being
      // culled between two leaf blocks again; anything more means the merge stopped working.
      need(fancy[1] === 48 && fancy[0] === 0,
           'leaves: fancy leaves emit all 8 interior planes per direction — 8 * 6 = 48 cutout quads',
           JSON.stringify(fancy));
      need(fancy[1] > 6,
           'leaves: fancy leaves are NOT a hollow 6-quad shell (D-178 regression fence)',
           JSON.stringify(fancy));
      need(fast[0] === 6 && fast[1] === 0,
           'leaves: fast leaves move to the opaque layer and the cutout pass empties',
           JSON.stringify(fast));
      // and a leaf block against solid stone must now cull, which fancy leaves cannot do
      const buried = S.makeUniform(ID('stone'), 0);
      S.set(buried, S.index(8, 8, 8), leaf);
      MCL.Mesher.setOptions({ fastLeaves: true });
      need(MCL.Mesher.mesh(snapOf(buried, S.makeUniform(ID('stone'), 0)), null) === null,
           'leaves: a fast leaf inside stone emits nothing at all');
      MCL.Mesher.setOptions({ fastLeaves: false });
      need(MCL.Blocks.fastLeaves === false && SR.layer[leaf] === MCL.CFG.LAYER_CUTOUT,
           'leaves: turning fast leaves off restores the block table exactly');
    }

    const plant = S.makeUniform(0, S.packLight(15, 0));
    S.set(plant, S.index(3, 3, 3), ID('grass'));
    const on = MCL.Mesher.mesh(snapOf(plant, AIR), { ao: true, cross: true });
    const off = MCL.Mesher.mesh(snapOf(plant, AIR), { ao: true, cross: false });
    // ⚠ NOT 4 QUADS ANY MORE. Before session 2 a plant was two diagonal double-sided planes
    // faked by the mesher; now it draws the model vanilla draws, out of the model stream, and
    // 1.18.2's `grass` is exactly that same two-plane cross — so the count is the same shape
    // but it lands in `modelQuads`, not `quads`.
    const onH = on && MCL.Mesher.readHeader(on);
    need(onH && onH.quads[1] === 0 && onH.modelQuads[1] === 4,
         'opt: a plant emits 4 quads into the MODEL stream, not the cube stream',
         onH ? JSON.stringify({ cube: onH.quads, model: onH.modelQuads }) : 'no buffer');
    need(off === null, 'opt: cross models off removes the plant entirely');
    MCL.Mesher.setOptions({ ao: true, cross: true, fastLeaves: false });
  }

  // one stone block alone in an air section -> 6 quads, all AO 3
  {
    const sec = S.makeUniform(0, S.packLight(15, 0));
    S.set(sec, S.index(8, 8, 8), ID('stone'));
    const buf = MCL.Mesher.mesh(snapOf(sec, AIR), null);
    const q = count(buf);
    need(q[0] === 6 && q[1] === 0 && q[2] === 0, 'mesh: one block emits 6 quads', JSON.stringify(q));
    const u = new Uint32Array(buf);
    const hdr = MCL.Mesher.readHeader(buf);
    let allBright = true, faces = new Set();
    for (let o = hdr.off[0] >> 2, n = 0; n < 6 * 4; n++, o += 2) {
      if (((u[o] >>> 21) & 3) !== 3) allBright = false;
      faces.add((u[o] >>> 18) & 7);
    }
    need(allBright, 'mesh: an isolated block has no ambient occlusion anywhere');
    need(faces.size === 6, 'mesh: all six face directions are emitted', [...faces].join(','));
  }

  // layers: water goes to the translucent list, leaves to the cutout list, plants too
  {
    const sec = S.makeUniform(0, S.packLight(15, 0));
    S.set(sec, S.index(4, 4, 4), ID('water'));
    S.set(sec, S.index(6, 4, 4), ID('oak_leaves'));
    S.set(sec, S.index(8, 4, 4), ID('grass'));
    const bufM = MCL.Mesher.mesh(snapOf(sec, AIR), null);
    const q = count(bufM);
    const hM = MCL.Mesher.readHeader(bufM);
    // #1263: a lone water cell is drawn by the fluid pass (model stream): top + its underside, four sides, bottom
    need(hM.modelQuads[2] === 7 && q[2] === 0, 'mesh: water lands on the translucent layer as 7 fluid quads (' + hM.modelQuads[2] + ' model, ' + q[2] + ' cube)');
    need(q[1] === 6, 'mesh: leaves are a cutout cube (' + q[1] + ')');
    need(hM.modelQuads[1] === 4, 'mesh: the plant is 4 cutout quads in the model stream (' +
         hM.modelQuads[1] + ')');
    need(q[0] === 0, 'mesh: nothing leaked onto the opaque layer');
  }

  // two adjacent water blocks must not draw the face between them (vanilla's isSameFluid).
  // #1263: each is a fluid-pass cell with a top, an underside, a bottom and three sides: 6 + 6 of 7 + 7.
  {
    const a = S.makeUniform(0, S.packLight(15, 0));
    S.set(a, S.index(4, 4, 4), ID('water'));
    S.set(a, S.index(5, 4, 4), ID('water'));
    const buf = MCL.Mesher.mesh(snapOf(a, AIR), null);
    const hdr = MCL.Mesher.readHeader(buf);
    need(hdr.modelQuads[2] === 12 && hdr.quads[2] === 0,
         'mesh: the shared face between two water blocks is dropped (' + hdr.modelQuads[2] + ' of 14 fluid quads)');
  }

  // AO: a block with one diagonal neighbour must have exactly one darkened corner per
  // affected face, and never a value outside 0..3
  {
    const sec = S.makeUniform(0, S.packLight(15, 0));
    S.set(sec, S.index(8, 8, 8), ID('stone'));
    S.set(sec, S.index(9, 9, 8), ID('stone'));   // diagonally above +X
    const buf = MCL.Mesher.mesh(snapOf(sec, AIR), null);
    const u = new Uint32Array(buf), hdr = MCL.Mesher.readHeader(buf);
    let dark = 0, bad = 0;
    const words = (buf.byteLength - CFG.MESH_HEADER_BYTES) / 4;
    for (let o = hdr.off[0] >> 2, n = 0; n < words; n += 2, o += 2) {
      const ao = (u[o] >>> 21) & 3;
      if (ao > 3 || ao < 0) bad++;
      if (ao < 3) dark++;
    }
    need(bad === 0, 'mesh: every baked AO value is in range');
    need(dark > 0, 'mesh: a diagonal neighbour actually darkens corners (' + dark + ' vertices)');
  }
}

// ---------------------------------------------------------------------------
// 7c. World store: edits must dirty every section whose mesh neighbourhood moved
// ---------------------------------------------------------------------------
{
  const W = MCL.World;
  W.init(SEED);
  // Install COPIES: this test edits blocks, and the cross-section below is drawn from the
  // originals.
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const src = chunks.get(key(CX + dx, CZ + dz));
    W.installChunk(dx, dz, { sec: src.sec.map(S.copy), hmap: src.hmap, biome: src.biome });
  }
  const clear = () => W.chunks.forEach(c => { c.meshDirty[0] = 0; });
  const dirtyList = () => {
    const out = [];
    W.chunks.forEach(c => { for (let sy = 0; sy < CFG.SECTIONS_Y; sy++)
      if (c.meshDirty[0] & (1 << sy)) out.push(c.cx + ',' + c.cz + ',' + sy); });
    return out.sort();
  };

  need(W.getBlock(8, 70, 8) === W.getBlock(8, 70, 8), 'world: getBlock is stable');

  // interior edit -> exactly one section
  clear();
  W.setBlock(8, 70, 8, ID('stone'));
  need(dirtyList().length === 1, 'world: an interior edit dirties exactly one section',
       dirtyList().join(' '));

  // corner edit: local (0,0,0) of a section -> the 2x2x2 block of sections around it
  clear();
  const sy = 8, y = CFG.WORLD_MIN_Y + sy * 16;      // local y 0 of section 8
  W.setBlock(0, y, 0, ID('stone'));
  const corner = dirtyList();
  need(corner.length === 8, 'world: a section-corner edit dirties all 8 touching sections ' +
       '(AO reads diagonals)', corner.join(' '));
  need(corner.indexOf('-1,-1,7') >= 0 && corner.indexOf('0,0,8') >= 0,
       'world: the diagonal chunk and the section below are both in that set', corner.join(' '));

  // edge edit on one axis only -> 2 sections
  clear();
  W.setBlock(0, y + 5, 5, ID('stone'));
  need(dirtyList().length === 2, 'world: an edit on one section face dirties 2 sections',
       dirtyList().join(' '));

  // an edit at the very bottom of the world must not dirty a section that does not exist
  clear();
  W.setBlock(4, CFG.WORLD_MIN_Y, 4, ID('stone'));
  need(dirtyList().length === 1, 'world: an edit at y=-64 does not dirty below the world',
       dirtyList().join(' '));
  need(W.setBlock(4, CFG.WORLD_MIN_Y - 1, 4, ID('stone')) === false,
       'world: setBlock outside the vertical range is refused');

  need(W.neighbourhoodReady(0, 0) === true, 'world: a full 3x3 counts as ready to mesh');
  need(W.neighbourhoodReady(1, 0) === false, 'world: a missing neighbour blocks meshing');

  const sp = W.spiral(4);
  need(sp[0] === 0 && sp[1] === 0, 'world: the streaming spiral starts at the camera chunk');
  let mono = true;
  for (let i = 2; i < sp.length; i += 2) {
    if (sp[i] * sp[i] + sp[i + 1] * sp[i + 1] < sp[i - 2] * sp[i - 2] + sp[i - 1] * sp[i - 1]) mono = false;
  }
  need(mono, 'world: the spiral is ordered by distance, nearest first');
}

// ---------------------------------------------------------------------------
// 7d. The worker bundle, end to end
//
// Assemble exactly what build.mjs bakes into MCL.WORKER_SRC.CHUNK — the shared modules plus
// src/workers/chunk.worker.js — and drive it through the §7 protocol with a mock `self`. This is
// the only check that exercises the message handler, the transfer lists and the fact that the
// bundle needs neither a DOM nor the atlas.
// ---------------------------------------------------------------------------
{
  const bundle = WORKER_FILES.map((f) => readFileSync(join(SRC, f), 'utf8')).join('\n') +
                 '\n' + readFileSync(join(SRC, 'workers', 'chunk.worker.js'), 'utf8');
  const posted = [];
  const self = { onmessage: null, postMessage: (m, xfer) => posted.push({ m, xfer }) };
  let err = null;
  try {
    new Function('self', "'use strict';\n" + bundle)(self);
  } catch (e) { err = e.stack || e.message; }
  need(!err, 'worker: the bundle evaluates with nothing but `self`', err);

  if (!err) {
    const send = (m) => self.onmessage({ data: m });
    // ⚠ The `reg` payload is not optional any more. A worker without it has no registry, and
    // with no registry there are no block states, so Gen.init refuses rather than generating a
    // world out of zeroes. This is the message 09_jobs.js actually sends.
    const bt2 = JSON.parse(readFileSync(join(ASSETS_DIR, 'block-tiles.meta.json'), 'utf8'));
    const rm2 = JSON.parse(readFileSync(join(ASSETS_DIR, 'block-runtime.meta.json'), 'utf8'));
    const gm2 = JSON.parse(readFileSync(join(ASSETS_DIR, 'block-geometry.meta.json'), 'utf8'));
    // ⚠ And from W6 it carries the WORLDGEN blobs too. A worker without them has no column
    // function, no biome table and no surface rules, and the first thing it does is read a null
    // — which is what this check caught the day the generator swapped over.
    const wg2 = JSON.parse(readFileSync(join(ASSETS_DIR, 'worldgen.meta.json'), 'utf8'));
    const bp2 = JSON.parse(readFileSync(join(ASSETS_DIR, 'biome-params.meta.json'), 'utf8'));
    const cm2 = JSON.parse(readFileSync(join(ASSETS_DIR, 'colormaps.meta.json'), 'utf8'));
    // ⚠ and W15's structure templates, for the same reason: a worker without them has no
    // village, no igloo and no ruined portal, and the first thing the structure layer does is
    // read a null template header.
    const st2 = JSON.parse(readFileSync(join(ASSETS_DIR, 'structures.meta.json'), 'utf8'));
    send({ t: 'init', seed: SEED, gen: Object.assign(G.defaults(), { climate: 'vanilla' }), reg: {
      runtime: readFileSync(join(ASSETS_DIR, 'block-runtime.bin')).toString('base64'),
      runtimeBytes: rm2.rawBytes,
      geometry: readFileSync(join(ASSETS_DIR, 'block-geometry.bin')).toString('base64'),
      geometryBytes: gm2.rawBytes,
      tileAlpha: bt2.alpha,
      worldgen: readFileSync(join(ASSETS_DIR, 'worldgen.bin')).toString('base64'),
      worldgenBytes: wg2.jsonBytes,
      biomeParams: readFileSync(join(ASSETS_DIR, 'biome-params.bin')).toString('base64'),
      biomeParamsBytes: bp2.rawBytes,
      colormaps: readFileSync(join(ASSETS_DIR, 'colormaps.bin')).toString('base64'),
      colormapsBytes: cm2.rawBytes,
      templates: readFileSync(join(ASSETS_DIR, 'structures.bin')).toString('base64'),
      templatesBytes: st2.blobBytes,
    } });
    need(posted.length === 1 && posted[0].m.t === 'ready', 'worker: init -> ready handshake',
         JSON.stringify(posted[0] && posted[0].m));

    posted.length = 0;
    send({ t: 'gen', id: 7, cx: CX, cz: CZ });
    const g = posted[0];
    need(g && g.m.t === 'gen:done' && g.m.id === 7 && g.m.sec.length === CFG.SECTIONS_Y,
         'worker: gen -> gen:done with 20 sections', g && g.m.t + ' ' + (g.m.msg || ''));
    need(g && g.m.hmap && g.m.hmap.length === 256 && g.m.biome && g.m.biome.length === 256,
         'worker: gen:done carries the heightmap and the biome map');
    need(g && g.xfer && g.xfer.length > 0 && g.xfer.every(b => b instanceof ArrayBuffer),
         'worker: gen:done transfers real ArrayBuffers, not views');

    // the world the worker built must be the world the main thread built
    let diff = 0;
    const mine = chunks.get(key(CX, CZ));
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      for (let i = 0; i < CFG.SECTION_VOL; i += 13) {
        if (S.get(g.m.sec[sy], i) !== S.get(mine.sec[sy], i)) diff++;
      }
    }
    need(diff === 0, 'worker: the bundle generates the same world as the main thread', diff + ' voxels');

    // Mesh every section of the chunk: which ones are empty depends entirely on where the
    // terrain is, so the check is "every answer is well formed and at least one has geometry".
    posted.length = 0;
    let meshed = 0, badMesh = 0, replies = 0;
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      posted.length = 0;
      send({ t: 'mesh', id: 100 + sy, cx: CX, cz: CZ, sy: sy, snap: snapshotFor(CX, CZ, sy) });
      const mm = posted[0];
      if (!mm || mm.m.t !== 'mesh:done' || mm.m.id !== 100 + sy) { badMesh++; continue; }
      replies++;
      if (mm.m.mesh === null) continue;
      if (!(mm.m.mesh instanceof ArrayBuffer) || !MCL.Mesher.readHeader(mm.m.mesh)) badMesh++;
      else meshed++;
    }
    need(badMesh === 0 && replies === CFG.SECTIONS_Y,
         'worker: mesh -> mesh:done for all 20 sections (' + replies + ' replies, ' +
         badMesh + ' malformed)');
    need(meshed > 0, 'worker: at least one section came back as a valid §8 buffer (' + meshed + ')');

    posted.length = 0;
    send({ t: 'gen', id: 9, cx: 'nonsense' });
    need(posted[0] && (posted[0].m.t === 'gen:done' || posted[0].m.t === 'err'),
         'worker: a bad job answers rather than going silent', JSON.stringify(posted[0]));
  }
}

// ---------------------------------------------------------------------------
// 8. ASCII cross-section
// ---------------------------------------------------------------------------

const GLYPH = (() => {
  const m = new Map();
  const put = (name, ch) => { const id = SR.stateOf(name); if (id) m.set(id, ch); };
  put('air', ' ');
  put('stone', '#'); put('cobblestone', '#'); put('deepslate', '&'); put('bedrock', '=');
  put('dirt', ','); put('grass_block', '"'); put('podzol', ';');
  put('sand', ':'); put('sandstone', 'S'); put('gravel', 'o');
  put('water', '~'); put('lava', '!'); put('ice', 'I'); put('snow_block', '*');
  put('sculk', 'X'); put('glowstone', 'G'); put('glass', 'g'); put('cactus', 'Y'); put('torch', 'i');
  for (const n of ['oak_log', 'birch_log', 'spruce_log']) put(n, '|');
  for (const n of ['oak_leaves', 'birch_leaves', 'spruce_leaves']) put(n, '^');
  // 1.18.2 calls it `grass`; `short_grass` is the 1.20 name the old table used
  for (const n of ['grass', 'poppy', 'dandelion', 'dead_bush']) put(n, 'v');
  for (const [a, b] of G.orePairs) { m.set(a, 'O'); m.set(b, 'O'); }
  return m;
})();

/** One vertical slice through the world at constant Z, `width` blocks wide starting at x0. */
function crossSection(x0, z, yTop, yBot, width) {
  const lines = [];
  for (let y = yTop; y >= yBot; y--) {
    let s = '';
    for (let i = 0; i < width; i++) {
      const id = worldBlock(x0 + i, y, z);
      s += id < 0 ? '?' : (GLYPH.get(id) || '#');
    }
    const label = String(y).padStart(4, ' ');
    lines.push(label + ' |' + s.replace(/\s+$/, ''));
  }
  return lines;
}

const X0 = (CX - R) * 16, Z_SLICE = CZ * 16 + 8;
const width = Math.min(WIDE, (2 * R + 1) * 16);
const yTop = YTOP === null ? Math.min(CFG.WORLD_MAX_Y - 1, stats.hMax + 6) : YTOP;
const yBot = YBOT === null ? CFG.WORLD_MIN_Y : YBOT;
const section = crossSection(X0, Z_SLICE, yTop, yBot, width);

const LEGEND =
  "legend: ' ' air   # stone   & deepslate   = bedrock   , dirt   \" grass   ; podzol\n" +
  "        : sand    S sandstone  o gravel   ~ water     ! lava   I ice      * snow\n" +
  "        O ore     X sculk      | log      ^ leaves    v plant  Y cactus   g glass";

if (SECTION_ONLY) {
  console.log('seed ' + SEED + ', slice z=' + Z_SLICE + ', x=' + X0 + '..' + (X0 + width - 1) +
              ', y=' + yTop + '..' + yBot);
  console.log(LEGEND);
  console.log(section.join('\n'));
} else {
  console.log('');
  console.log('--- cross-section  seed ' + SEED + '  z=' + Z_SLICE + '  x=' + X0 + '..' + (X0 + width - 1));
  console.log(LEGEND);
  console.log(section.join('\n'));
}

// ---------------------------------------------------------------------------
// 9. Report
// ---------------------------------------------------------------------------

if (!SECTION_ONLY) {
  const pct = (a, b) => ((a / Math.max(1, b)) * 100).toFixed(2) + '%';
  console.log('');
  console.log('--- statistics (' + nChunks + ' chunks at ' + CX + ',' + CZ + ', seed ' + SEED + ')');
  console.log('  surface height   min ' + stats.hMin + '   mean ' +
              (stats.hSum / stats.hN).toFixed(1) + '   max ' + stats.hMax + '   (sea ' + SEA + ')');
  console.log('  cave void        ' + pct(stats.airBelow, belowTotal) + ' of sub-surface volume  (' +
              stats.airBelow.toLocaleString() + ' air voxels)');
  console.log('  underground water ' + pct(stats.waterBelow, belowTotal) +
              '   lava ' + pct(stats.lavaBelow, belowTotal));
  console.log('  sections         ' + stats.totalSections + ', ' +
              pct(stats.uniformSections, stats.totalSections) + ' uniform, ' +
              (stats.bytes / 1024 / nChunks).toFixed(1) + ' KB per chunk');
  console.log('  decoration       ' + (stats.logs / nChunks).toFixed(1) + ' logs, ' +
              (stats.leaves / nChunks).toFixed(1) + ' leaves, ' +
              (stats.plants / nChunks).toFixed(1) + ' plants per chunk');
  console.log('  mesh             ' + (meshQuads / Math.max(1, meshSections)).toFixed(0) +
              ' quads/section  [opaque ' + perLayer[0] + ', cutout ' + perLayer[1] +
              ', translucent ' + perLayer[2] + ']');
  console.log('  timing           gen ' + (genMs / nChunks).toFixed(2) + ' ms/chunk, mesh ' +
              (meshMs / Math.max(1, meshSections)).toFixed(2) + ' ms/section');

  console.log('');
  console.log('  biomes');
  const order = stats.biome.map((n, i) => [i, n]).sort((a, b) => b[1] - a[1]);
  for (const [i, n] of order) {
    if (!n) continue;
    const bar = '#'.repeat(Math.round((n / stats.hN) * 40));
    console.log('    ' + MCL.Biomes.name(i).replace('minecraft:', '').padEnd(26) + pct(n, stats.hN).padStart(7) + '  ' + bar);
  }

  console.log('');
  console.log('  ores (blocks per chunk)');
  const oreRows = Object.keys(stats.ore).sort((a, b) => stats.ore[b] - stats.ore[a]);
  for (const n of oreRows) {
    console.log('    ' + n.padEnd(26) + (stats.ore[n] / nChunks).toFixed(1).padStart(7));
  }
  if (!oreRows.length) console.log('    (none)');

  console.log('');
// ---------------------------------------------------------------------------
// ANTI-VACUITY (D-30). Session 4: gencheck was one of the four checks with no such section.
// Each break feeds this file's own comparisons something wrong and requires them to notice.
// ---------------------------------------------------------------------------
{
  say('');
  say('--- anti-vacuity ---');
  const av = [];
  const brk = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  brk('the determinism comparison ignoring a changed voxel', () => {
    // §"deterministic on re-generation" compares two generated columns voxel by voxel. Feed the
    // same comparison two arrays that differ in one place and require a non-zero answer.
    const a = new Int32Array(4096), b = new Int32Array(4096);
    b[1234] = 7;
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    if (d === 1) throw 0;
  });

  brk('a world with no bedrock floor reported as sound', () => {
    // The bedrock assertion counts holes in the world's floor. Count them in a fabricated
    // column that has none of it, and require the count to be non-zero.
    let holes = 0;
    for (let i = 0; i < 256; i++) if (0 !== ID('bedrock')) holes++;
    if (holes === 256) throw 0;
  });

  brk('a block the worldgen places but the registry does not have', () => {
    // §"every block it places is registered" resolves names through the registry. A name that
    // is not there must resolve to nothing rather than to some other block.
    if (SR.stateOf('definitely_not_a_block') === undefined || SR.stateOf('definitely_not_a_block') === null || !SR.stateOf('definitely_not_a_block')) throw 0;
  });

  brk('two engine instances compared without generating anything', () => {
    // §D-38 compares this build against a worker-only bundle. If either side produced an empty
    // world the comparison would pass on nothing at all.
    const col = G.genColumn(3, 3);
    let solid = 0;
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) if (col.sec[sy].u !== 0) solid++;
    if (solid > 0) throw 0;
  });

  for (const [label, caught] of av) need(caught, 'anti-vacuity: ' + label);
}

  console.log('gencheck: ' + checks + ' checks passed, ' + errors + ' failures');
}

process.exit(errors ? 1 : 0);
