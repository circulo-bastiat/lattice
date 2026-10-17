#!/usr/bin/env node
// cullruleaudit.mjs — KW-48d (#1160): the mesher's STATIC cull rule, audited over every state.
//
//   node tools/cullruleaudit.mjs [--verbose]
//
// seamcheck cannot see a wrong cull RULE (a full rebuild that is wrong the same way passes), so this
// enumerates every (real state, face) the mesher would cull AGAINST (`SR.cull`, which both the greedy
// path and the model path read) and compares it with vanilla's `Block.shouldRenderFace`:
//     neighbour.canOcclude()  AND  the neighbour's face shape covers ours
// Two independent references, neither derived from SR.cull:
//   - `canOcclude` per block from the bytecode (tools/golden/canocclude-1.18.2.tsv, via SR.canOcclude)
//   - the collision-shape boxes (Reg.shapeBox, 1/1024): a face may only be culled against if the
//     neighbour's shape covers that whole 1x1 face
// (Panes/iron bars: vanilla's skipRendering is per-side-connection, not modelled here.)
// Any bit set where vanilla would draw is a see-through hole. Also the self-cull set (skipRendering).
// Anti-vacuity: each rule is run on deliberately broken data and must notice ("<n> breaks caught").

import { loadEngine } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
const M = loadEngine({ extra: [], dom: false });
const R = M.Reg, SR = M.States;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

// mesher face index -> [axis, side of the NEIGHBOUR's own cell that touches us] ; 0 +X 1 -X 2 +Y 3 -Y 4 +Z 5 -Z
const FACE = [[0, 0], [0, 1024], [1, 0], [1, 1024], [2, 0], [2, 1024]];

/** does the collision shape of `state` cover the whole face plane `plane` of axis `ax`? */
function covers(state, ax, plane) {
  const sh = R.shapeOf[state], a = R.shapeOff[sh], b = R.shapeOff[sh + 1];
  const u = (ax + 1) % 3, v = (ax + 2) % 3;
  // coverage on a 64x64 grid (1/16-block boxes are multiples of 64 units of 1/1024... use 16x16 cells of 64)
  const cell = new Uint8Array(256);
  for (let i = a; i < b; i++) {
    const o = i * 6, lo = [R.shapeBox[o], R.shapeBox[o + 1], R.shapeBox[o + 2]], hi = [R.shapeBox[o + 3], R.shapeBox[o + 4], R.shapeBox[o + 5]];
    if (lo[ax] > plane || hi[ax] < plane) continue;
    if (lo[ax] === hi[ax] && lo[ax] !== plane) continue;
    if (plane === 0 ? lo[ax] !== 0 : hi[ax] !== 1024) continue;
    for (let x = Math.floor(lo[u] / 64); x < Math.ceil(hi[u] / 64); x++)
      for (let y = Math.floor(lo[v] / 64); y < Math.ceil(hi[v] / 64); y++) cell[x * 16 + y] = 1;
  }
  for (let i = 0; i < 256; i++) if (!cell[i]) return false;
  return true;
}

/** mismatches of a `cull` table against the two references; returns list of strings */
function audit(cull, canOcclude) {
  const out = [];
  for (let b = 0; b < R.blockCount; b++) {
    for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) {
      const m = cull[s];
      if (!m) continue;
      if (!canOcclude[b]) { out.push(`${R.names[b]}#${s - R.realFirst[b]}: culls neighbours but canOcclude=false`); continue; }
      for (let f = 0; f < 6; f++) {
        if (!((m >> f) & 1)) continue;
        // the neighbour of the face `f` sits at +dir, so it is THIS state's opposite face that touches the face:
        const [ax, plane] = FACE[f];
        if (!covers(s, ax, plane)) out.push(`${R.names[b]}#${s - R.realFirst[b]}: culls face ${f} but its shape does not cover that side`);
      }
    }
  }
  return out;
}

let breaks = 0;
const bad = audit(SR.cull, SR.canOcclude);
ok(bad.length === 0, `${bad.length} static cull mismatch(es) vs vanilla shouldRenderFace:\n     ` + bad.slice(0, +process.env.N || 40).join('\n     '));
let culling = 0; for (let s = 1; s < SR.count; s++) if (SR.cull[s]) culling++;
ok(culling > 1000, `the cull table is non-trivial (${culling} culling states)`);

// self-cull (skipRendering): vanilla HalfTransparentBlock (ice, slime, honey, stained glass, glass) + fluids
const SELF = ['water', 'lava', 'ice', 'frosted_ice', 'glass', 'tinted_glass', 'slime_block', 'honey_block', 'white_stained_glass'];
for (const n of SELF) {
  const b = R.id[n]; ok(b !== undefined && SR.selfCull[R.realFirst[b]] === 1, `${n} self-culls (vanilla skipRendering / fluid isSame)`);
}
for (const n of ['oak_leaves', 'packed_ice', 'stone', 'glowstone']) {
  const b = R.id[n]; ok(SR.selfCull[R.realFirst[b]] === 0, `${n} must NOT self-cull`);
}

// --- anti-vacuity: break the data, the audit must notice ---------------------------------------
function brk(label, fn) {
  breaks++;
  const cull = SR.cull.slice(), occ = SR.canOcclude.slice();
  fn(cull, occ);
  ok(audit(cull, occ).length > 0, `anti-vacuity: ${label} was not caught`);
}
brk('leaves (canOcclude=false) given a full cull mask', (c) => { const s = R.realFirst[R.id.oak_leaves]; c[s] = 63; });
brk('a bottom slab given a full cull mask', (c) => { for (let s = R.realFirst[R.id.stone_slab]; s < R.realFirst[R.id.stone_slab + 1]; s++) c[s] = 63; });
brk('glass (canOcclude=false) given a full cull mask', (c) => { c[R.realFirst[R.id.glass]] = 63; });
brk('soul sand culling its top', (c) => { c[R.realFirst[R.id.soul_sand]] = 63; });
brk('farmland culling its sides', (c) => { for (let s = R.realFirst[R.id.farmland]; s < R.realFirst[R.id.farmland + 1]; s++) c[s] = 63; });

if (VERBOSE) console.log(`   ${culling} culling states audited`);
if (fails.length) { console.log(fails.map((f) => '  x ' + f).join('\n')); console.log(`\nFAIL cullruleaudit — ${fails.length} failure(s)`); process.exit(1); }
console.log(`OK    cullruleaudit — ${pass} assertions, ${breaks} breaks caught`);
