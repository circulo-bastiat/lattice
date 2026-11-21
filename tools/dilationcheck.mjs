#!/usr/bin/env node
// dilationcheck.mjs — D-694 (session 137): THE ZOMBIE'S HOLE-IN-THE-HEAD, A MISSING DILATION.
//
//   node tools/dilationcheck.mjs [--verbose]
//
// ⚠⚠ **WHAT THIS EXISTS TO CATCH.** `tools/extract-models.mjs` reads `CubeListBuilder.addBox`'s
// seven-argument overload — `addBox(x,y,z,w,h,d, cubeDeformation.extend(0.5F))`, the exact shape
// every humanoid's hat/overlay layer is built with — but the walk's `cdInit`/`cdExt` handlers
// only ever TRUNCATED `nums` by the deformation's own float count to stop it corrupting the six
// box floats beside it (D-415); the grow amount itself was thrown away, never applied to the
// box. So the zombie's `hat` layer came out of extraction as the EXACT SAME six numbers as its
// `head` layer — two perfectly coincident cubes, a z-fighting hole where the hat should stand
// visibly proud of the head. This check reads the real `assets/models.bin` (produced by
// `tools/extract-models.mjs` + `tools/pack-models.mjs` from the golden TSV — nothing mocked)
// and asserts the zombie's hat box is NOT coincident with its head box, and specifically that it
// is the head box grown outward by a uniform positive margin on every axis (position pulled in,
// size let out by twice the margin — `CubeDeformation`'s own math), the same way vanilla's own
// 0.5F hat inflate reads.
//
// ANTI-VACUITY (D-30/D-305): the core assertion function is re-run against a synthetic layer
// pair built to reproduce the pre-fix bug EXACTLY (hat box == head box) and this check asserts
// that broken input is caught, not silently passed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
const okAv = (c, m) => { const p0 = pass; ok(c, 'anti-vacuity: ' + m); if (pass > p0 && !VERBOSE) console.log('   ✓ ' + m); };

console.log('dilationcheck — hat/head layers are grown apart, not coincident (D-694)');

const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
  '10_gfx.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(ASSETS, 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(ASSETS, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const BE = M.BEModel;
ok(BE.ready, 'the model payload decodes');

// The box tuple pack-models.mjs stores per part: position (x,y,z) and size (w,h,d).
const boxOf = (p) => [p.x, p.y, p.z, p.w, p.h, p.d];

// ── the core assertion, shared by the real data below and the anti-vacuity break ──
// A correctly-dilated `outer` box must (a) differ from `inner` on every axis and (b) be `inner`
// grown by a UNIFORM POSITIVE margin: outer.pos = inner.pos - g, outer.size = inner.size + 2g,
// g > 0, the same g on x/y/z (CubeDeformation's own single-float `extend`/constructor shape).
function assertDilated(localOk, inner, outer, label) {
  const [ix, iy, iz, iw, ih, id] = inner;
  const [ox, oy, oz, ow, oh, od] = outer;
  localOk(!(ox === ix && oy === iy && oz === iz && ow === iw && oh === ih && od === id),
    label + ': outer box is not exactly coincident with the inner box');
  const gx = ix - ox, gy = iy - oy, gz = iz - oz;
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  localOk(gx > 1e-6 && near(gx, gy) && near(gy, gz), label + ': grow margin is positive and equal on x/y/z (' + gx.toFixed(4) + ')');
  localOk(near(ow, iw + 2 * gx) && near(oh, ih + 2 * gy) && near(od, id + 2 * gz),
    label + ': size grew by exactly twice the margin on every axis');
}

// ── 1. the real data: zombie's `hat` must be its `head` grown outward, not the same box. ──
{
  const L = BE.layer('zombie');
  ok(!!L, 'zombie layer is present in models.bin');
  const head = L.parts.find((p) => p.n === 'head');
  const hat = L.parts.find((p) => p.n === 'hat');
  ok(!!head && !!hat, 'zombie has both a head and a hat part');
  if (head && hat) assertDilated(ok, boxOf(head), boxOf(hat), 'zombie hat/head');
}

// ── 2. the same shape holds for the other stock biped skins sharing the zombie hat layer ──
for (const name of ['zombie#b', 'zombie#c', 'husk', 'drowned', 'giant']) {
  const L = BE.layer(name);
  if (!L) { if (VERBOSE) console.log('   (skip ' + name + ', no layer)'); continue; }
  const head = L.parts.find((p) => p.n === 'head');
  const hat = L.parts.find((p) => p.n === 'hat');
  if (!head || !hat) continue;
  assertDilated(ok, boxOf(head), boxOf(hat), name + ' hat/head');
}

// ── 3. anti-vacuity: feed the assertion the EXACT pre-fix shape (hat box == head box) and
//    prove it is caught, not silently passed (D-30). ──
{
  const localFails = [];
  const localOk = (c, m) => { if (!c) localFails.push(m); return c; };
  const headBox = [-4, -8, -4, 8, 8, 8];
  const coincidentHatBox = [-4, -8, -4, 8, 8, 8]; // the exact bug: hat === head, no Dilation applied
  assertDilated(localOk, headBox, coincidentHatBox, 'synthetic pre-fix zombie hat/head');
  okAv(localFails.length > 0, 'a coincident (undilated) hat/head pair fails the dilation assertions (' + localFails.length + ' would fail)');
}

if (fails.length) {
  console.log(`${pass} assertions, ${fails.length} failures`);
  for (const f of fails) console.log('  ✗ ' + f);
  console.log('FAIL dilationcheck');
  process.exit(1);
}
console.log(`PASS dilationcheck: ${pass} assertions, 0 failures, 1 break caught`);
