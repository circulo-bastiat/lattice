#!/usr/bin/env node
// emitcheck.mjs — the model-quad emitter, against the geometry it is supposed to emit.
//
//   node tools/emitcheck.mjs
//
// `M.emitModelBlock` is the bridge between the baked roster and the GPU: it takes a visual
// state and writes its quads into the mesh buffer, translated to a block position. If it
// drops a quad, mis-signs a coordinate or loses the tint index, the world is wrong and no
// test that reads the build data would notice — every other suite stops at the JSON.
//
// So this loads the real modules the way a browser does, emits every one of the 8,933
// visual states at several positions, decodes the bytes back through the format's own
// unpacker, and compares against the baked geometry.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator


const ASSETS = MCLITE_ROOT + 'assets';
const SRC = MCLITE_ROOT + 'src';
const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));

const NS = {};
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js', '03_section.js', '05_mesher.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const gm = rd('block-geometry.meta.json');
const rm = rd('block-runtime.meta.json');
NS.Reg.init({
  runtime: readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64'), runtimeBytes: rm.rawBytes,
  geometry: readFileSync(join(ASSETS, 'block-geometry.bin')).toString('base64'), geometryBytes: gm.rawBytes,
});
const R = NS.Reg, M = NS.Mesher, CFG = NS.CFG;

let pass = 0; const fails = [];
// ⚠ `emitModelBlock` takes SEVEN packed light bytes since D-132 — this cell's own in the low
// byte, then the six neighbours in mesher face order — because a model quad is lit by the cell
// its cullface looks into. These two helpers build those words; `uniformLight` is the old
// one-light-everywhere behaviour, which is what most of the cases below want.
// Vanilla's `Direction` order, which is what a baked quad's `d` field holds: down, up, north,
// south, west, east. Used to check which way an emitted quad actually faces.
const DIR_NORMAL = [[0,-1,0],[0,1,0],[0,0,-1],[0,0,1],[-1,0,0],[1,0,0]];
let windBad = 0, totalWound = 0, srcInverted = 0;
const packLight = (sky, blk) => ((sky & 15) << 4) | (blk & 15);
const uniformLight = (sky, blk) => {
  const b = packLight(sky, blk);
  return [b | (b << 8) | (b << 16) | (b << 24), b | (b << 8) | (b << 16)];
};

const ok = (c, m) => { if (c) pass++; else if (fails.length < 200) fails.push(m); };

// ─────────────────────────────────────────────── 1. the header
console.log('1. the buffer header');
{
  const buf = M.allocBuffer(3, 1, 0, [5, 2, 1]);
  const h = M.readHeader(buf);
  ok(!!h, 'a buffer with both streams must have a readable header');
  ok(h.quads.join() === '3,1,0', 'cube counts survive the header');
  ok(h.modelQuads.join() === '5,2,1,0', 'model counts survive the header');
  ok(h.off[0] === CFG.MESH_HEADER_BYTES, 'the cube stream starts after the header');
  ok(h.modelOff[0] === CFG.MESH_HEADER_BYTES + 4 * CFG.QUAD_BYTES,
     'the model stream starts after the cube stream');
  ok(buf.byteLength === CFG.MESH_HEADER_BYTES + 4 * CFG.QUAD_BYTES + 8 * CFG.MODEL_QUAD_BYTES,
     `buffer is ${buf.byteLength} bytes, expected header + 4 cube quads + 8 model quads`);
  // a model-only buffer, which is what a chunk of fences and flowers produces
  const mOnly = M.allocBuffer(0, 0, 0, [2, 0, 0]);
  ok(!!mOnly, 'a section with only model geometry must still allocate');
  ok(M.readHeader(mOnly).modelOff[0] === CFG.MESH_HEADER_BYTES, 'model-only stream starts at the header end');
  // and nothing at all still returns null, as it always did
  ok(M.allocBuffer(0, 0, 0, [0, 0, 0]) === null, 'an empty section returns null');
  ok(M.allocBuffer(0, 0, 0) === null, 'the old three-argument call still works and still returns null');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 2. one block, by hand
console.log('2. a single block, checked by hand');
{
  const v = R.visFirst[R.id.oak_slab] + 0;
  const n = M.modelQuadCount(v, 0, 0, 0);
  const buf = M.allocBuffer(0, 0, 0, [n, 0, 0]);
  const out = new Uint32Array(buf, CFG.MESH_HEADER_BYTES);
  const end = M.emitModelBlock(out, 0, v, 0, 0, 0, ...uniformLight(15, 0), 3);
  ok(end === n * 4 * 4, `emitted ${end} words for ${n} quads, expected ${n * 4 * 4}`);
  // the slab's geometry must land inside its own cell: 0..256, because the unit is 1/256
  // of a block (CFG.MODEL_UNITS_PER_BLOCK). The first run of this test expected 0..16 and
  // failed, which is how the x<<4 bug in emitModelBlock was found.
  const U = CFG.MODEL_UNITS_PER_BLOCK;
  let minY = 1e9, maxY = -1e9;
  for (let q = 0; q < n; q++) for (let c = 0; c < 4; c++) {
    const o = (q * 4 + c) * 4;
    const vtx = M.unpackModelVertex(out[o], out[o + 1], out[o + 2], out[o + 3]);
    ok(vtx.px >= 0 && vtx.px <= U, `slab x ${vtx.px} outside 0..${U}`);
    ok(vtx.pz >= 0 && vtx.pz <= U, `slab z ${vtx.pz} outside 0..${U}`);
    minY = Math.min(minY, vtx.py); maxY = Math.max(maxY, vtx.py);
  }
  const type = R.names[R.id.oak_slab] && 'oak_slab';
  void type;
  ok(minY === 0, `slab min y is ${minY}, expected 0`);
  ok(maxY === U / 2 || maxY === U, `slab max y is ${maxY}, expected ${U / 2} (half) or ${U} (double)`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 3. translation
console.log('3. a block moves by exactly its position, in sixteenths');
{
  const v = R.visFirst[R.id.oak_fence] + 5;
  const n = M.modelQuadCount(v, 0, 0, 0);
  const at = (x, y, z) => {
    const buf = M.allocBuffer(0, 0, 0, [n, 0, 0]);
    const out = new Uint32Array(buf, CFG.MESH_HEADER_BYTES);
    M.emitModelBlock(out, 0, v, x, y, z, ...uniformLight(15, 0), 3);
    return out;
  };
  const a = at(0, 0, 0), b = at(3, 5, 11);
  let bad = 0;
  for (let i = 0; i < n * 4; i++) {
    const va = M.unpackModelVertex(a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]);
    const vb = M.unpackModelVertex(b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]);
    const U2 = CFG.MODEL_UNITS_PER_BLOCK;
    if (vb.px - va.px !== 3 * U2 || vb.py - va.py !== 5 * U2 || vb.pz - va.pz !== 11 * U2) bad++;
    if (vb.tile !== va.tile || vb.u !== va.u || vb.v !== va.v) bad++;
  }
  ok(bad === 0, `${bad} vertices did not translate by exactly (3, 5, 11) blocks`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 4. EVERY visual state
console.log('4. all 8,933 visual states, emitted and decoded back');
{
  const G = rd('block-geometry.json');
  const names = Object.keys(G.states);
  let quadBad = 0, posBad = 0, uvBad = 0, tileBad = 0, faceBad = 0, tintBad = 0, shadeBad = 0, countBad = 0;
  let totalQuads = 0;
  const X = 2, Y = 7, Z = 13;                    // one fixed position, so partFor is stable
  for (let bi = 0; bi < names.length; bi++) {
    const name = names[bi], states = G.states[name];
    for (let s = 0; s < states.length; s++) {
      const v = R.visFirst[bi] + s;
      const n = M.modelQuadCount(v, X, Y, Z);
      // what the source says this state draws at this position
      const want = [];
      for (const g of states[s]) {
        const part = typeof g === 'number' ? g : (function () {
          // mirror Reg.partFor's choice by asking Reg itself — the point of this test is the
          // EMITTER, not the chooser, and regcheck already proves the chooser
          return null;
        })();
        if (part !== null) want.push(...G.parts[part]);
      }
      // for multi-alternative groups, ask Reg which part it chose and use that
      if (want.length === 0 || states[s].some((g) => typeof g !== 'number')) {
        want.length = 0;
        for (let g = 0; g < states[s].length; g++) want.push(...G.parts[R.partFor(v, g, X, Y, Z)]);
      }
      if (want.length !== n) { countBad++; continue; }
      totalQuads += n;
      if (n === 0) continue;
      const buf = M.allocBuffer(0, 0, 0, [n, 0, 0]);
      const out = new Uint32Array(buf, CFG.MESH_HEADER_BYTES);
      M.emitModelBlock(out, 0, v, X, Y, Z, ...uniformLight(11, 4), 2);
      for (let q = 0; q < n; q++) {
        const src = want[q];
        const P = [];
        for (let c = 0; c < 4; c++) {
          const o = (q * 4 + c) * 4;
          const vt = M.unpackModelVertex(out[o], out[o + 1], out[o + 2], out[o + 3]);
          const U3 = CFG.MODEL_UNITS_PER_BLOCK;
          // ⚠ THE CORNERS COME OUT REVERSED (D-133). The shared index buffer is a linear ramp
          // and the pipeline culls back faces, so a quad's winding decides whether it is drawn
          // at all; Mojang's element order is the opposite of what that ramp needs, and
          // `emitModelBlock` reverses it. Source corner `c` is therefore output corner `3 - c`.
          const sc = 3 - c;
          if (vt.px !== X * U3 + Math.round(src.p[sc * 3] * 16)) posBad++;
          if (vt.py !== Y * U3 + Math.round(src.p[sc * 3 + 1] * 16)) posBad++;
          if (vt.pz !== Z * U3 + Math.round(src.p[sc * 3 + 2] * 16)) posBad++;
          if (vt.u !== Math.round(src.uv[sc * 2] * 16)) uvBad++;
          if (vt.v !== Math.round(src.uv[sc * 2 + 1] * 16)) uvBad++;
          if (vt.tile !== src.t) tileBad++;
          // ⚠ D-314 — THE EMITTED FACE IS `MESH_OF_DIR[src.d]`, NOT `src.d`. This assertion used
          // to demand the raw baked number and got it, which is exactly why nobody noticed that
          // the number MEANT something different from the same field on the greedy path: the
          // baked `dir` is vanilla's Direction order and every consumer of a packed vertex reads
          // ARCH §3 order. Asserting "the mesher copied the source faithfully" is not the same
          // question as "the mesher emitted the face the shader will colour by".
          if (vt.face !== NS.Mesher.MESH_OF_DIR[src.d]) faceBad++;
          if (vt.tint !== (src.tint < 0 ? 0 : Math.min(3, src.tint + 1))) tintBad++;
          if (vt.shade !== src.shade) shadeBad++;
          if (vt.sky !== 11 || vt.blk !== 4 || vt.ao !== 2) quadBad++;
          P.push([vt.px, vt.py, vt.pz]);
        }
        // ⚠ AND THE WINDING ITSELF, which is the assertion this file did not have and the
        // reason D-133 shipped. Comparing emitted corners against the baked source proves the
        // geometry is faithful and says NOTHING about which way the triangle faces: a quad that
        // is inside out has exactly the same four corners. So derive the normal from the
        // winding the GPU will see — cross(v1-v0, v2-v0) — and require it to point the way the
        // quad's own `face` says. A degenerate quad (zero-area, which some baked parts have at
        // a seam) is skipped rather than counted either way.
        const ux = P[1][0]-P[0][0], uy = P[1][1]-P[0][1], uz = P[1][2]-P[0][2];
        const vx = P[2][0]-P[0][0], vy = P[2][1]-P[0][1], vz = P[2][2]-P[0][2];
        const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
        const len = Math.hypot(nx, ny, nz);
        if (len > 0) {
          const want3 = DIR_NORMAL[src.d];
          const dot = (nx*want3[0] + ny*want3[1] + nz*want3[2]) / len;
          totalWound++;
          // A face need not be axis-aligned — a bakery part can be tilted — so the test is that
          // the normal has a POSITIVE component along its declared direction, not that it is
          // exactly that direction. An inside-out quad gives a negative one, every time.
          if (!(dot > 0.05)) windBad++;
          // ⚠ and the same normal computed from the SOURCE corner order, which must come out
          // the OTHER way. This is the anti-vacuity half of the assertion above and it lives
          // here rather than in section 5 because it needs the same quad: if the bakery's order
          // already wound correctly, the reversal in `emitModelBlock` would be silently undoing
          // something that was right, and this counter would drop to zero.
          const sux = src.p[3]-src.p[0], suy = src.p[4]-src.p[1], suz = src.p[5]-src.p[2];
          const svx = src.p[6]-src.p[0], svy = src.p[7]-src.p[1], svz = src.p[8]-src.p[2];
          const snx = suy*svz - suz*svy, sny = suz*svx - sux*svz, snz = sux*svy - suy*svx;
          const slen = Math.hypot(snx, sny, snz);
          if (slen > 0 && (snx*want3[0] + sny*want3[1] + snz*want3[2]) / slen < -0.05) srcInverted++;
        }
      }
    }
  }
  ok(countBad === 0, `${countBad} states emitted a different quad count than the source`);
  ok(posBad === 0, `${posBad} vertex positions wrong`);
  ok(uvBad === 0, `${uvBad} uvs wrong`);
  ok(tileBad === 0, `${tileBad} tiles wrong`);
  ok(faceBad === 0, `${faceBad} face directions wrong`);
  ok(tintBad === 0, `${tintBad} tint indices wrong`);
  ok(shadeBad === 0, `${shadeBad} shade flags wrong`);
  ok(quadBad === 0, `${quadBad} light or AO values wrong`);
  ok(windBad === 0, `${windBad} of ${totalWound} quads are wound INSIDE OUT — they would be backface-culled and invisible`);
  ok(totalWound > 10000, `only ${totalWound} quads had a testable winding`);
  ok(srcInverted > totalWound * 0.9,
     `only ${srcInverted} of ${totalWound} quads are inverted in the bakery's own order — ` +
     'the reversal in emitModelBlock may be undoing something that was already right');
  pass += totalWound;
  console.log(`   ${totalQuads.toLocaleString()} quads emitted and verified`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 5. anti-vacuity
console.log('5. anti-vacuity: break it, and it must be caught');
{
  const av = [];
  const brk = (label, inv, mk) => av.push([label, inv(mk(false)) === true && inv(mk(true)) === false]);
  const v = R.visFirst[R.id.oak_stairs];
  const n = M.modelQuadCount(v, 0, 0, 0);
  const emit = (x) => {
    const buf = M.allocBuffer(0, 0, 0, [n, 0, 0]);
    const out = new Uint32Array(buf, CFG.MESH_HEADER_BYTES);
    M.emitModelBlock(out, 0, v, x, 0, 0, ...uniformLight(15, 0), 3);
    return M.unpackModelVertex(out[0], out[1], out[2], out[3]);
  };
  brk('a block that does not move with its position',
      (d) => d === CFG.MODEL_UNITS_PER_BLOCK, (b) => (b ? 0 : emit(1).px - emit(0).px));
  brk('positions written in 1/16 of a block instead of 1/256 — the whole world in one corner',
      (d) => d === 256, (b) => (b ? (1 << 4) : emit(1).px - emit(0).px));
  brk('a signed coordinate read as unsigned', (v2) => v2 === -8,
      (b) => (b ? 0xFFF8 : M.unpackModelVertex(0xFFF8, 0, 0, 0).px));
  brk('a lost tint index', (t) => t === 1,
      (b) => (b ? 0 : M.unpackModelVertex(0, 0, 0, (1 << 13)).tint));
  brk('a header claiming a vertex size this build does not know', (h2) => h2 !== null,
      (b) => {
        const buf = M.allocBuffer(1, 0, 0, [1, 0, 0]);
        if (b) new Int32Array(buf, 0, 16)[14] = 999;
        return M.readHeader(buf);
      });
  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" is not distinguished from correct behaviour`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ emitcheck ================');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 15)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
