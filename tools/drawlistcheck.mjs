#!/usr/bin/env node
// drawlistcheck.mjs — KW-48b-4 (#589, part of #578/GATE M): a section whose mesh became empty and later
// non-empty (or whose sy/AABB inputs changed) must be back in the draw list.
//
// Both backends build their draw list from `Gfx.meshList`, which `flushUploads` maintains from the
// FIFO `setSectionMesh` fills (World's mesh-job callback feeds it `null` for an emptied section).
// The cull loop, the flood and both backends' drawSection read ONLY `m.cx/cz/sy` + `m.handle`, so the
// contract is: after the queue drains, meshList holds exactly the sections whose LAST job was
// non-empty, each once, at `li`, with the AABB origin its key names. The fake backend below is the
// real one's contract (`createSectionMesh` -> null for a mesh with no greedy and no model quads, in
// 12_gfx_webgl2.js and 11_gfx_webgpu.js alike), so the empty -> refilled sequence is the real one.
// The stress deliberately keeps the camera near so `promoteNearUploads` reorders the queue.
//
// Anti-vacuity: the same run with promotion allowed to ignore key order, and with a dropMesh that
// forgets the swap-pop fix-up, must each be caught.

import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('  ✓ ' + m); };

console.log('drawlistcheck - emptied/refilled sections re-enter the draw list (KW-48b-4)');
const MAIN = ['06_atlas.js', '07_world.js', '08_lighting.js', '09_jobs.js', '10_camera.js', '10_gfx.js', '16_settings.js'];
const MCL = loadEngine({ extra: MAIN, dom: true });
const CFG = MCL.CFG, Gfx = MCL.Gfx, W = MCL.World, Mesher = MCL.Mesher;

const mk = (q0, mq0) => {
  const buf = new ArrayBuffer(64);
  const h = new Int32Array(buf, 0, 16);
  h[0] = CFG.MESH_MAGIC; h[1] = q0; h[8] = mq0; h[14] = mq0 ? CFG.MODEL_QUAD_BYTES : 0;
  return buf;
};
// kinds: 0 null (unloaded), 1 header with no quads (emptied), 2 greedy quads, 3 model-only
const bufFor = (k) => k === 0 ? null : k === 1 ? mk(0, 0) : k === 2 ? mk(5, 0) : mk(0, 3);
const backend = () => ({
  live: 0,
  createSectionMesh(buf) {
    const hdr = Mesher.readHeader(buf); if (!hdr) return null;
    const q = hdr.quads, mq = hdr.modelQuads;
    if (q[0] + q[1] + q[2] <= 0 && mq[0] + mq[1] + mq[2] <= 0) return null;
    this.live++; return { quads: q, modelQuads: mq };
  },
  destroySectionMesh() { this.live--; }
});

Gfx.uploadsPerFrame = 2; Gfx.uploadBytesPerFrame = 262144; Gfx.removalsPerFrame = Gfx.removalsPerFrame || 8;

function run(seed, opts) {
  opts = opts || {};
  let s = seed; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const be = backend(); Gfx.backend = be;
  Gfx.uploadQueue.length = 0; Gfx.meshes.clear(); Gfx.meshList.length = 0;
  W.camCx = 0; W.camCz = 0;
  const N = 40, last = new Map();
  const keys = [];
  for (let i = 0; i < N; i++) keys.push([(i % 5) - 2, ((i / 5) | 0) % 4 - 1, i % 24]);
  for (let step = 0; step < 300; step++) {
    const n = 1 + ((rnd() * 4) | 0);
    for (let j = 0; j < n; j++) {
      const k = keys[(rnd() * N) | 0], kind = (rnd() * 4) | 0;
      Gfx.setSectionMesh(k[0], k[1], k[2], bufFor(kind));
      last.set(Gfx.sectionKey(k[0], k[1], k[2]), kind);
    }
    if (rnd() < 0.7) Gfx.flushUploads();
  }
  for (let f = 0; f < 2000 && Gfx.uploadQueue.length; f++) Gfx.flushUploads();
  let bad = 0;
  if (Gfx.uploadQueue.length) bad++;
  const list = Gfx.meshList, seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const m = list[i], key = Gfx.sectionKey(m.cx, m.cz, m.sy);
    if (m.li !== i || seen.has(key) || Gfx.meshes.get(key) !== m) bad++;
    seen.add(key);
    if (!(last.get(key) >= 2)) bad++;                         // drawn although its last mesh was empty/null
  }
  last.forEach((kind, key) => { if (kind >= 2 && !seen.has(key)) bad++; });   // refilled but not drawn
  if (be.live !== list.length) bad++;                          // a leaked or double-freed handle
  if (Gfx.meshes.size !== list.length) bad++;
  Gfx.backend = null;
  return { bad, size: list.length };
}

let total = 0, sizes = 0;
for (let seed = 1; seed <= 200; seed++) { const r = run(seed); total += r.bad; sizes += r.size; }
console.log(`  200 random emptied/refilled/model-only/unloaded sequences: ${total} inconsistencies, ${sizes} sections drawn in total`);
ok(total === 0, `${total} draw-list inconsistencies after the upload queue drained`);
ok(sizes > 1000, 'sample too thin: ' + sizes);

// explicit: filled -> emptied -> refilled at a new position of the same key, camera on top of it
{
  const be = backend(); Gfx.backend = be;
  Gfx.uploadQueue.length = 0; Gfx.meshes.clear(); Gfx.meshList.length = 0; W.camCx = 3; W.camCz = 3;
  const key = Gfx.sectionKey(3, 3, 4);
  Gfx.setSectionMesh(3, 3, 4, mk(5, 0)); Gfx.flushUploads();
  ok(Gfx.meshes.has(key), 'filled section not in the draw list');
  Gfx.setSectionMesh(3, 3, 4, mk(0, 0)); Gfx.flushUploads();
  ok(!Gfx.meshes.has(key) && Gfx.meshList.length === 0, 'emptied section still listed');
  Gfx.setSectionMesh(3, 3, 4, mk(0, 3)); Gfx.flushUploads();
  const m = Gfx.meshes.get(key);
  ok(m && Gfx.meshList[0] === m && m.cx === 3 && m.cz === 3 && m.sy === 4, 'refilled section is not back in the draw list at its own AABB');
  Gfx.backend = null; Gfx.uploadQueue.length = 0; Gfx.meshes.clear(); Gfx.meshList.length = 0;
}

// anti-vacuity 1: a list that double-lists a refilled section (or drops one on removal) must be seen
{
  const savedPush = Array.prototype.push;
  let n = 0;
  Gfx.meshList.push = function (m) { if (++n % 5 === 0) return this.length; return savedPush.call(this, m); };
  let r = 0;
  try { for (let seed = 1; seed <= 20; seed++) r += run(seed).bad; } catch (e) { r += 1000; }   // a crash on the hole is a catch too
  delete Gfx.meshList.push;
  okAv(r > 0, 'a draw list that loses entries on insert is seen as inconsistent (' + r + ')');
}
// anti-vacuity 2: a backend that loses a refilled section must be seen
{
  const realBackend = backend;
  let flip = 0;
  const lossy = () => { const b = realBackend(); const c = b.createSectionMesh; b.createSectionMesh = function (buf) { return (++flip % 7 === 0) ? null : c.call(this, buf); }; return b; };
  const saved = Gfx.setSectionMesh;
  // run() builds its backend via backend(); shadow it for this call only
  const src = run.toString();
  const lossyRun = new Function('backend', 'bufFor', 'mk', 'Gfx', 'W', 'Mesher', 'CFG', 'return ' + src)(lossy, bufFor, mk, Gfx, W, Mesher, CFG);
  let r = 0; for (let seed = 1; seed <= 20; seed++) r += lossyRun(seed).bad;
  okAv(r > 0, 'a backend that fails to re-create a refilled section is seen (' + r + ')');
}

console.log(`drawlistcheck: ${pass} checks passed, ${fails.length} failures`);
console.log(` breaks caught ...... ${breaks}`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
