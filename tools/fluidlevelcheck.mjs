#!/usr/bin/env node
// fluidlevelcheck.mjs — #1263: water and lava show their LEVEL. "A full block looks the same as a thin layer."
//
//   node tools/fluidlevelcheck.mjs
//
// Meshes a real section holding fluid cells of several levels and asserts the emitted geometry against
// the arithmetic of vanilla's FluidRenderer (.decomp/net/minecraft/client/render/block/FluidRenderer.java):
//   height = amount/9 (a source 8/9, falling 8/9, flowing 8-level over 9), a cell with the same fluid above is
//   a full cube, and each top corner is `method_40077`'s blend of the cell, its two edge neighbours and the
//   diagonal (a height >= 0.8 weighs 10, a solid neighbour is ignored, a neighbour height >= 1 forces 1).
// The expected numbers are worked by hand in the comments, not computed by the code under test.
// ANTI-VACUITY: eight edits to the real mesher source, each of which must fail this check.

import { loadEngine } from './loadsrc.mjs';

const breakers = [
  ['flat heights (amount/9 -> 1)', 'Math.fround(SR.fluidAmt[st] / 9)', '1'],
  ['no 10x weight for >= 0.8', 'if (h >= 0.8) { acc[0] += h * 10; acc[1] += 10; }', 'if (h >= 9) { acc[0] += h * 10; acc[1] += 10; }'],
  ['neighbour >= 1 no longer forces 1', 'if (hB >= 1 || hA >= 1) return 1;', 'if (false) return 1;'],
  ['diagonal ignored', 'if (hA > 0 || hB > 0) {\n      var d =', 'if (false) {\n      var d ='],
  ['top quad claims the wrong face', 'fluidQuad(L, 2, tile, tint, sky, blk);\n      // the underside', 'fluidQuad(L, 3, tile, tint, sky, blk);\n      // the underside'],
  ['side against the same fluid kept', 'if (fKind[nb] === k || ((culls[nb] >> face) & 1)) continue;', 'if (((culls[nb] >> face) & 1)) continue;'],
  ['fluid scroll bit dropped', 'out[n + c * 4 + 3] |= 1 << 26;', ''],
  ['surface cell also drawn as a cube', 'if (fKind[blocks[pi + PSY]] !== fKind[id]) { mKey[mrow + a2] = 0; continue; }', ''],
];

function scene(patch) {
  const fails = []; let pass = 0;
  const ok = (c, m) => { if (c) pass++; else fails.push(m); };
  const MCL = loadEngine({ extra: ['07_world.js', '08_lighting.js'], dom: false, patch });
  const W = MCL.World, CH = MCL.CH, S = MCL.Section, M = MCL.Mesher, SR = MCL.States;
  M.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true, smooth: true });
  const lvl = (name, l) => SR.withLocal(name, l);
  W.init(1);
  MCL.Light.init(); MCL.Light.setAdapter(MCL.Light.worldAdapter());
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.getOrCreate(cx, cz); c.state = CH.GENERATED; }
  const sec = W.getOrCreate(0, 0).sec[4];
  const put = (x, y, z, id) => S.set(sec, (y << 8) | (z << 4) | x, id);
  const STONE = SR.stateOf('stone');
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) put(x, 0, z, STONE);
  put(2, 1, 2, lvl('water', 0));                                  // A  lone source
  put(6, 1, 2, lvl('water', 8));                                  // A2 falling water (amount 8)
  for (let x = 2; x <= 4; x++) put(x, 1, 6, lvl('water', 0));     // B  three sources in a row
  put(2, 1, 10, lvl('water', 1)); put(3, 1, 10, lvl('water', 7)); // C  amount 7 beside amount 1
  put(2, 1, 13, lvl('water', 0)); put(2, 2, 13, lvl('water', 0)); // D  a source under a source
  put(10, 1, 10, lvl('water', 0)); put(11, 1, 10, lvl('water', 0)); put(11, 2, 10, lvl('water', 0)); // F neighbour with water above
  put(8, 1, 2, lvl('lava', 0));                                   // L  lone lava source

  const buf = M.mesh(W.snapshotFor(0, 0, 4), null, 0, 0, 0);
  ok(!!buf, 'section meshed');
  if (!buf) return { pass, fails, solid: false };
  const h = M.readHeader(buf), u32 = new Uint32Array(buf);
  const quads = [];
  for (let L = 0; L < 3; L++) {
    const base = (h.modelOff[L] >> 2);
    for (let q = 0; q < h.modelQuads[L]; q++) {
      const v = []; for (let c = 0; c < 4; c++) { const o = base + q * 16 + c * 4; v.push(M.unpackModelVertex(u32[o], u32[o + 1], u32[o + 2], u32[o + 3])); }
      v.layer = L; v.face = v[0].face; quads.push(v);
    }
  }
  const NORMAL = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // the cell a quad belongs to: its centre nudged one unit INTO the cell, so a quad on the east wall is not the next cell's
  const cellOf = (q) => { const n = NORMAL[q.face]; const c = [0, 1, 2].map((a) => { const k = ['px', 'py', 'pz'][a];
    return Math.floor((q.reduce((t, v) => t + v[k], 0) / 4 - n[a]) / 256); }); return c; };
  const inCell = (q, x, y, z) => { const c = cellOf(q); return c[0] === x && c[2] === z && (y === undefined || c[1] === y); };
  const top = (x, y, z) => quads.filter((q) => q.face === 2 && inCell(q, x, undefined, z) && q.every((v) => v.py >= y * 256))[0];
  const at = (q, px, pz) => q.find((v) => v.px === px * 256 && v.pz === pz * 256);
  const ys = (q) => q.map((v) => v.py);

  // A: lone source, air round it. Corner = (0.8889*10 + 0 + 0)/12 = 0.7407 -> 189.6 -> 190 sixteenths-of-sixteenths above y=1.
  const A = top(2, 1, 2);
  ok(!!A, 'A has a top quad');
  if (A) ok(ys(A).every((y) => y === 256 + 190), 'A: lone source corners are all 0.7407 high (256+190), got ' + ys(A));
  // A2: falling water has amount 8 -> the same corners
  const A2 = top(6, 1, 2);
  ok(!!A2 && ys(A2).every((y) => y === 256 + 190), 'A2: falling water is a source-height surface, got ' + (A2 && ys(A2)));
  // A's four sides: each has its two top corners at 190 and its two bottom at the cell floor; floor face culled by stone.
  const sides = quads.filter((q) => inCell(q, 2, 1, 2) && q.face !== 2);
  ok(sides.filter((q) => [0, 1, 4, 5].includes(q.face)).length === 4, 'A has four side quads, has ' + sides.map((q) => q.face));
  ok(!sides.some((q) => q.face === 3), 'A: no bottom face against stone');
  for (const q of sides) {
    const t = q.filter((v) => v.py > 256).length;
    ok(t === 2 && q.filter((v) => v.py === 256 + 190).length === 2, 'A side quad: two corners at 190, got ' + ys(q));
  }
  // B: middle of a row. NE corner: hE = 0.8889 > 0 -> diagonal (air, 0) counts. (8.889 + 8.889 + 0 + 0)/(10+10+1+1) = 0.8081 -> 207.
  const B = top(3, 1, 6);
  ok(!!B && ys(B).every((y) => y === 256 + 207), 'B: row-middle corners are 0.8081 (256+207), got ' + (B && ys(B)));
  ok(!quads.some((q) => inCell(q, 3, 1, 6) && (q.face === 0 || q.face === 1)), 'B: no side face against the same fluid');
  // C: amount 7 (0.7778) beside amount 1 (0.1111). Cell 1 NE: diag 0 (w1), h .7778 (w1), hE .1111 (w1), hN 0 (w1) = .8889/4 = .2222 -> 57.
  //    Cell 1 NW: .7778/3 = .2593 -> 66. Cell 2's NW corner is the SAME point as cell 1's NE and must agree.
  const C1 = top(2, 1, 10), C2 = top(3, 1, 10);
  if (C1 && C2) {
    ok(at(C1, 3, 10).py === 256 + 57, 'C1 NE corner is 57 high, got ' + at(C1, 3, 10).py);
    ok(at(C1, 2, 10).py === 256 + 66, 'C1 NW corner is 66 high, got ' + at(C1, 2, 10).py);
    ok(at(C2, 3, 10).py === at(C1, 3, 10).py, 'C: the shared corner agrees between the two cells');
  } else ok(false, 'C cells have top quads');
  // D: a source under a source is a plain cube (greedy), so no model quad sits in the lower cell; the upper one has a surface.
  ok(!quads.some((q) => inCell(q, 2, 1, 13)), 'D: the covered lower cell emits no fluid quads');
  ok(!!top(2, 2, 13), 'D: the upper cell has a surface');
  // F: neighbour has water above (height 1) -> shared corners are forced to 1.
  const F = top(10, 1, 10);
  ok(!!F && at(F, 11, 10).py === 512 && at(F, 11, 11).py === 512, 'F: corners beside a full neighbour are 1.0 (512), got ' + (F && ys(F)));
  // lava
  const Lv = top(8, 1, 2);
  ok(!!Lv && ys(Lv).every((y) => y === 256 + 190), 'lava: lone source is 0.7407 high too, got ' + (Lv && ys(Lv)));
  // every quad is wound to face where it claims, and carries the scroll flag
  let wound = 0, bad = 0, scroll = 0, under = 0;
  for (const q of quads) {
    const a = [q[1].px - q[0].px, q[1].py - q[0].py, q[1].pz - q[0].pz], b = [q[2].px - q[0].px, q[2].py - q[0].py, q[2].pz - q[0].pz];
    const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const f = NORMAL[q.face]; const d = n[0] * f[0] + n[1] * f[1] + n[2] * f[2];
    // the underside of a surface is vanilla's second quad, shaded as the top (face 2) but wound downward
    if (q.face === 2 && d < 0) { under++; continue; }
    wound++; if (d <= 0) bad++;
  }
  ok(wound > 0 && bad === 0, `all ${wound} fluid quads wound outward (${bad} inside out)`);
  // every surface cell here has air in the 3x3 above it, so each top has its underside (FluidState.method_15756)
  ok(under === quads.filter((q) => q.face === 2).length - under, `each of the ${quads.filter((q) => q.face === 2).length - under} surfaces has an underside, found ${under}`);
  for (let L = 0; L < 3; L++) {
    const base = (h.modelOff[L] >> 2);
    for (let q = 0; q < h.modelQuads[L]; q++) for (let c = 0; c < 4; c++) if ((u32[base + q * 16 + c * 4 + 3] >>> 26) & 1) scroll++;
  }
  ok(scroll === quads.length * 4, `every fluid vertex carries the scroll flag (${scroll}/${quads.length * 4})`);
  // greedy stream: only the two covered cells are cubes of water: D's lower (4 sides) and F's neighbour (3, its west is the same fluid)
  const wl = SR.layer[lvl('water', 0)];
  ok(h.quads[wl] === 7, `water layer holds only the covered cells' seven cube quads, has ${h.quads[wl]}`);
  return { pass, fails };
}

const base = scene(null);
let fail = base.fails.slice();

let breaks = 0;
for (const [name, from, to] of breakers) {
  let hit = false;
  const r = scene((f, src) => { if (f === '05_mesher.js') { if (!src.includes(from)) throw new Error('break "' + name + '" no longer matches the source'); hit = true; return src.replace(from, to); } return src; });
  if (r.fails.length) breaks++;
  else fail.push('anti-vacuity: break "' + name + '" was NOT caught');
}

if (fail.length) { console.log('FAIL ' + fail.length); for (const f of fail) console.log('  ✗ ' + f); process.exit(1); }
console.log(`OK  ${base.pass} assertions, 0 failures, ${breaks} breaks caught (fluid heights, slopes and winding match FluidRenderer)`);
