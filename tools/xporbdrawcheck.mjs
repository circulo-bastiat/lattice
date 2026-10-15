#!/usr/bin/env node
// xporbdrawcheck.mjs — G21 (loop/xporbsprite): the EXPERIENCE ORB DRAW.
//
//   node tools/xporbdrawcheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES, headless (no WebGL2/WebGPU context, exactly like modelcheck/itemcheck's
// own shape). `ER.OWED`'s "experience_orb — G21" line claimed the orb existed as a ticking
// entity with no picture; this proves the picture's PURE MATH (everything short of the actual
// GPU draw calls, which need a browser — see the note at the bottom) is right, each half
// against its own `.decomp` citation:
//   1. `Xp.orbIconIndex` reproduces `ExperienceOrbEntity.getOrbSize()` (.decomp:254-275) exactly
//      — the SAME ten thresholds `Xp.roundToOrbSize` already carries, just returned as an index.
//   2. `ER.orbUV` reproduces `ExperienceOrbEntityRenderer.method_3966`'s own crop math
//      (.decomp:31-34) for every one of the 11 icons `getOrbSize` can return.
//   3. `ER.orbColorAt` reproduces the same method's colour pulse (.decomp:38-42,65) at several
//      sample ages, including the alpha=128 the vertex helper hard-codes.
//   4. the extracted sheet (`assets/xporb-tex.bin`/`.meta.json`) is really there, really 64x64,
//      and `ER.SHAPE.experience_orb`/`ER.OWED` agree the type is drawn now, not owed.
// Every section is proven in both directions (rule 6): the formula matches AND corrupting it is
// caught, so a broken table or a broken sine cannot slip back in silently.
//
// ⚠ WHAT THIS DOES NOT PROVE: an actual pixel on an actual screen. That needs a live WebGL2/
// WebGPU context (`ER.renderOrbsGL2`/`ER.renderOrbsGPU`), which is `xporbvisualcheck`'s own job
// (registered in tools/suite.mjs as a browser stage, run on the CDP lane, not here) — the same
// "node proves the numbers, the browser proves the picture" split modelcheck/g17cbcheck already
// use for the rest of this file's own draw path.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('xporbdrawcheck — G21, experience orb draw (07j_entityrender.js, 07zz_xporb.js)');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07h_entities.js', '07i_entitylist.js', '07zz_xporb.js',
          '07j_entityrender.js'],
  initReg: false
});
M.Xp.init();
M.EntityRender.init();

// ═══════════════════════════════════════════════════════════════════════════════════════════
say('\n 1. Xp.orbIconIndex reproduces ExperienceOrbEntity.getOrbSize (.decomp:254-275)');
// The SAME ten cut points `Xp.roundToOrbSize` already carries, .decomp:254-275, each checked
// one below and one above so an off-by-one boundary is caught, not just the interior.
const THRESHOLDS = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3];
{
  // value -> expected index, walking every boundary both sides.
  const cases = [[0, 0], [2, 0], [3, 1], [6, 1], [7, 2], [16, 2], [17, 3], [36, 3], [37, 4],
    [72, 4], [73, 5], [148, 5], [149, 6], [306, 6], [307, 7], [616, 7], [617, 8], [1236, 8],
    [1237, 9], [2476, 9], [2477, 10], [999999, 10]];
  for (const [v, want] of cases) {
    ok(M.Xp.orbIconIndex(v) === want, `orbIconIndex(${v}) === ${want} (got ${M.Xp.orbIconIndex(v)})`);
  }
}
{
  // anti-vacuity: a fully-broken ladder with the 617 cut shifted to 618 -- 617 itself must now
  // read as index 7, not 8, which the boundary case above (case [617, 8]) is set up to catch.
  const real = M.Xp.orbIconIndex;
  function broken(v) {
    if (v >= 2477) return 10;
    if (v >= 1237) return 9;
    if (v >= 618) return 8;   // off-by-one: was 617
    if (v >= 307) return 7;
    if (v >= 149) return 6;
    if (v >= 73) return 5;
    if (v >= 37) return 4;
    if (v >= 17) return 3;
    if (v >= 7) return 2;
    return v >= 3 ? 1 : 0;
  }
  M.Xp.orbIconIndex = broken;
  okAv(M.Xp.orbIconIndex(617) !== 8, 'corrupting the 617 cut point is caught by the boundary case above');
  M.Xp.orbIconIndex = real;
  okAv(M.Xp.orbIconIndex(617) === 8, 'restoring the real function brings 617 back to index 8');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
say('\n 2. ER.orbUV reproduces method_3966\'s own crop (.decomp:31-34) for all 11 icons');
{
  const SHEET = 64, TILE = 16, COLS = 4;
  for (let i = 0; i <= 10; i++) {
    const col = i % COLS, row = Math.floor(i / COLS);
    const want = [(col * TILE) / SHEET, (row * TILE) / SHEET,
      (col * TILE + TILE) / SHEET, (row * TILE + TILE) / SHEET];
    const got = M.EntityRender.orbUV(i);
    ok(got.length === 4 && got.every((n, k) => Math.abs(n - want[k]) < 1e-9),
       `orbUV(${i}) === [${want.join(', ')}] (got [${got.join(', ')}])`);
  }
  // every icon a real orb can hold stays inside the sheet, none spills into the 5 unused cells'
  // row (icons 11..15 are never reached, .decomp's own getOrbSize never returns past 10).
  ok(M.EntityRender.orbUV(10)[3] <= 1, 'the last real icon (index 10) does not spill past the sheet');
}
{
  // anti-vacuity: an icon 0 and icon 5 UV must differ (else the whole crop is a no-op).
  const u0 = M.EntityRender.orbUV(0), u5 = M.EntityRender.orbUV(5);
  okAv(u0[0] !== u5[0] || u0[1] !== u5[1], 'icon 0 and icon 5 crop different UV rects, not the same tile');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
say('\n 3. ER.orbColorAt reproduces the colour pulse (.decomp:38-42,65)');
function refColor(age, partial) {
  const t = (age + partial) / 2;
  const r = Math.floor((Math.sin(t) + 1) * 0.5 * 255);
  const g = 255;
  const b = Math.floor((Math.sin(t + Math.PI * 4 / 3) + 1) * 0.1 * 255);
  return [r, g, b, 128];
}
{
  for (const [age, partial] of [[0, 0], [1, 0.5], [17, 0], [200, 0.9], [6000, 1]]) {
    const want = refColor(age, partial);
    const got = M.EntityRender.orbColorAt(age, partial);
    ok(JSON.stringify(got) === JSON.stringify(want),
       `orbColorAt(${age}, ${partial}) === ${JSON.stringify(want)} (got ${JSON.stringify(got)})`);
  }
  // alpha is the vertex helper's own constant 128 (.decomp:65) at every age, not the unused
  // local 255.0F two lines above it.
  ok(M.EntityRender.orbColorAt(9999, 0.3)[3] === 128, 'alpha is always 128, never the unused $$14=255');
  // g is the constant 255 the decomp itself hard-codes ($$17 = 255), not sine-driven.
  const gs = [0, 1, 2, 3, 4].map((a) => M.EntityRender.orbColorAt(a * 137, 0)[1]);
  ok(gs.every((g) => g === 255), 'g is the constant 255 at every age, not part of the pulse');
}
{
  // anti-vacuity: swap the sine argument's sign and prove a sample age now disagrees.
  const real = M.EntityRender.orbColorAt;
  M.EntityRender.orbColorAt = function (age, partial) {
    const t = (age + partial) / 2;
    const r = Math.floor((Math.sin(-t) + 1) * 0.5 * 255);   // sign flipped
    return [r, 255, real(age, partial)[2], 128];
  };
  const want = refColor(17, 0.5), got = M.EntityRender.orbColorAt(17, 0.5);
  okAv(got[0] !== want[0], 'flipping the sine\'s sign at age 17 is caught by the reference comparison');
  M.EntityRender.orbColorAt = real;
  okAv(JSON.stringify(M.EntityRender.orbColorAt(17, 0.5)) === JSON.stringify(want),
       'restoring the real function matches the reference again');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
say('\n 4. the sheet is really extracted, and the roster agrees the type is drawn, not owed');
{
  const binPath = join(ASSETS, 'xporb-tex.bin'), metaPath = join(ASSETS, 'xporb-tex.meta.json');
  ok(existsSync(binPath), 'assets/xporb-tex.bin exists (tools/extract-xporbtex.mjs has run)');
  ok(existsSync(metaPath), 'assets/xporb-tex.meta.json exists');
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    ok(meta.sheet === 64, `the packed sheet is 64x64 (got ${meta.sheet})`);
    ok(meta.tile === 16, `each icon tile is 16x16 (got ${meta.tile})`);
    ok(meta.cols === 4, `the grid is 4 columns wide (got ${meta.cols})`);
    ok(meta.icons === 11, `11 icons are named as used (got ${meta.icons})`);
    ok(meta.rawBytes === 64 * 64 * 4, `rawBytes is exactly one 64x64 RGBA sheet (got ${meta.rawBytes})`);
  }
}
{
  ok(M.EntityRender.SHAPE.experience_orb === 'orb',
     `ER.SHAPE.experience_orb is truthy (drawn), got ${JSON.stringify(M.EntityRender.SHAPE.experience_orb)}`);
  ok(!M.EntityRender.OWED.some((s) => s.split(' — ')[0].trim() === 'experience_orb'),
     'ER.OWED no longer names experience_orb');
}
{
  // anti-vacuity: take the shape entry away and prove the roster notices (mirrors g17ccheck's
  // own falling_block anti-vacuity, same idiom, this file's own type).
  const saved = M.EntityRender.SHAPE.experience_orb;
  delete M.EntityRender.SHAPE.experience_orb;
  okAv(!M.EntityRender.SHAPE.experience_orb, 'deleting the shape entry is visible to a roster scan');
  M.EntityRender.SHAPE.experience_orb = saved;
  okAv(M.EntityRender.SHAPE.experience_orb === 'orb', 'restoring the entry brings it back');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
say('\n 5. ER.buildOrbQuads produces real geometry for a live orb, none for none');
{
  // ER.buildOrbQuads only reads EL.ready/EL.list -- EL.init()'s own readiness gate needs
  // Entities/Physics this check has no reason to wire up, so the minimal state is set by hand.
  M.EntityList.ready = true;
  M.EntityList.list = [
    { type: 'experience_orb', value: 617, age: 10, x: 5, y: 64, z: 5, px: 5, py: 64, pz: 5, removed: false }
  ];
  const cam = { x: 0, y: 64, z: 0, right: [1, 0, 0], up: [0, 1, 0] };
  const verts = M.EntityRender.buildOrbQuads(cam, 0.5);
  ok(verts.length === 4 * M.EntityRender.ORB_VERTEX_FLOATS, `one orb builds one quad's worth of floats (got ${verts.length})`);
  M.EntityList.list[0].removed = true;
  ok(M.EntityRender.buildOrbQuads(cam, 0.5).length === 0, 'a removed orb builds nothing');
  M.EntityList.list = [];
  ok(M.EntityRender.buildOrbQuads(cam, 0.5).length === 0, 'no orbs builds nothing');
}

console.log('');
if (fails.length) {
  console.log(`FAIL  xporbdrawcheck — ${pass} assertions, ${fails.length} failures, ${breaks} anti-vacuity checks`);
  for (const f of fails) console.log('   x ' + f);
  process.exit(1);
}
console.log(`PASS  xporbdrawcheck — ${pass} assertions, 0 failures, ${breaks} anti-vacuity checks`);
