#!/usr/bin/env node
// chunkgenprofile.mjs — #1899 C2ME-1: MEASURE chunk generation before anyone speeds it up.
//
//   node tools/chunkgenprofile.mjs --golden            compare every chunk's hash to tools/golden/chunkgen-golden.json
//   node tools/chunkgenprofile.mjs --golden --write    regenerate that file (a deliberate worldgen change only)
//   node tools/chunkgenprofile.mjs --stages [--seed 1337] [--r 10]   per-stage ms, inline on this thread (node)
//   node tools/chunkgenprofile.mjs --browser [--rd 6,12,16] [--pool 3] [--seed 1337]   real chromium + real workers
//   node tools/chunkgenprofile.mjs --scaling [--rd 8] [--pools 1,2,3,4,6,8]           pool scaling table
//   add --json out.json to keep the raw per-chunk rows.
//
// THE RULE (the C2ME family): vanilla 1.18.2 is the spec. A later speed-up may change WHEN and ON WHICH
// THREAD a chunk is built, never WHAT it contains. The GOLDEN is how that is enforced: an FNV-1a hash of
// every chunk's section arrays + biome + heightmap + spawner/entity logs, for N seeds x a 21x21 area
// generated INLINE on one thread, stored in tools/golden/chunkgen-golden.json. chunkgengoldencheck.mjs
// compares against it and proves it can fail (flip one block / biome / height / spawner -> caught).
//
// THE STAGE TIMER DOES NOT TOUCH THE SHIPPED SOURCE. It patches the TEXT of src/04_worldgen.js and
// src/04j_features.js as they load (node) or the worker bundle string (browser), inserting
// `__PF.m('stage')` marks at genColumn's own step comments. Marks are flat (time since the previous mark);
// `of which` rows (ore, each feature kind, structure writes, jigsaw) are nested INSIDE a flat stage.
// There is no separate aquifer stage: this pipeline's aquifer is the column function (climate row).
//
// Headless chromium here is SwiftShader (CPU rasteriser): read its FRAME numbers as relative, never as fps.
// Worker/generation numbers are real CPU time and are what this tool is for.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

export const GOLDEN_FILE = join(MCLITE_ROOT, 'tools', 'golden', 'chunkgen-golden.json');
export const GOLDEN_SEEDS = [1337, 42, -559038737];
export const GOLDEN_R = 10;             // 21 x 21 chunks around (0,0)

// ---------------------------------------------------------------------------------------------
// FNV-1a over one genColumn() result
// ---------------------------------------------------------------------------------------------
export function hashColumn(col) {
  let h = 0x811c9dc5;
  const u32 = (v) => { h = Math.imul(h ^ (v & 255), 16777619); h = Math.imul(h ^ ((v >>> 8) & 255), 16777619); h = Math.imul(h ^ ((v >>> 16) & 255), 16777619); h = Math.imul(h ^ ((v >>> 24) & 255), 16777619); };
  const arr = (a) => { u32(a.length); for (let i = 0; i < a.length; i++) u32(a[i]); };
  u32(col.sec.length);
  for (const s of col.sec) {
    u32(s.u); u32(s.lu);
    if (s.u < 0) { u32(s.b); u32(s.n); arr(s.p); arr(s.d); }
    if (s.lu < 0) arr(s.l);
  }
  arr(col.hmap); arr(col.biome || []);
  // spawner / entity logs: plain numbers (entity yaw is a float -> hash its 32-bit pattern)
  const f32 = new Float32Array(1), i32 = new Int32Array(f32.buffer);
  const log = (L) => { L = L || []; u32(L.length); for (const e of L) { u32(e.length); for (const v of e) { if (Number.isInteger(v)) u32(v); else { f32[0] = v; u32(i32[0]); } } } };
  log(col.spawners); log(col.entities);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function goldenParams(M) { return Object.assign(M.Gen.defaults(), { climate: 'vanilla' }); }

/** hashes for one seed: row-major over z then x in [-r, r], returned as a flat array of hex strings */
export function hashSeed(M, seed, r, mutate) {
  M.Gen.init(seed, goldenParams(M));
  const out = [];
  for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) {
    const col = M.Gen.genColumn(cx, cz);
    if (mutate) mutate(col, cx, cz);
    out.push(hashColumn(col));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// the stage timer: text patches + the runtime that records them
// ---------------------------------------------------------------------------------------------
export const PRELUDE =
  'var __PF={s:null,f:null,t:0,t0:0,last:null,' +
  'start:function(){this.s={};this.f={};this.t0=this.t=performance.now();},' +
  'm:function(n){var t=performance.now();this.s[n]=(this.s[n]||0)+t-this.t;this.t=t;},' +
  'acc:function(k,ms){this.f[k]=(this.f[k]||0)+ms;},' +
  'end:function(){this.m("pack");this.last={total:performance.now()-this.t0,s:this.s,f:this.f};}};\n';

const rep = (src, from, to, what) => { if (!src.includes(from)) throw new Error('chunkgenprofile: patch target moved: ' + what); return src.replace(from, to); };

export function patchSource(file, src) {
  if (file === '00_ns.js') return PRELUDE + src;
  if (file === '04_worldgen.js') {
    src = rep(src, '    G.entityLog = [];', "    G.entityLog = []; __PF.start();", 'entityLog');
    src = rep(src, '    // --- 1b. biomes', "    __PF.m('climate column fn');\n    // --- 1b. biomes", '1b');
    src = rep(src, '    // --- 2. terrain', "    __PF.m('biome volume');\n    // --- 2. terrain", '2');
    src = rep(src, '    // --- 3. the surface rules', "    __PF.m('noise/density fill');\n    // --- 3. the surface rules", '3');
    src = rep(src, '    // --- 4. caves', "    __PF.m('surface rules');\n    // --- 4. caves", '4');
    src = rep(src, 'if (P.carvers && NS.Carvers) NS.Carvers.carveChunk(SB, cx, cz, cH, sea);',
      "__PF.m('noise caves'); if (P.carvers && NS.Carvers) NS.Carvers.carveChunk(SB, cx, cz, cH, sea); __PF.m('carvers');", 'carvers');
    src = rep(src, 'NS.Structures.beginChunk(cx, cz);', "NS.Structures.beginChunk(cx, cz); __PF.m('structure starts');", 'beginChunk');
    src = rep(src, 'NS.Features.applyChunk(SB, cx, cz, cH, sea);', "NS.Features.applyChunk(SB, cx, cz, cH, sea); __PF.m('features (ore+decoration+struct steps)');", 'applyChunk');
    src = rep(src, 'NS.Structures.writeUpTo(SB, cx, cz, 10, cH, sea);', "NS.Structures.writeUpTo(SB, cx, cz, 10, cH, sea); __PF.m('structure flush');", 'writeUpTo10');
    src = rep(src, '    // --- 8. pack', "    __PF.m('light+heightmap');\n    // --- 8. pack", '8');
    src = rep(src, '    return { sec: sec, hmap: hmap, biome: biome, spawners', '    __PF.end();\n    return { sec: sec, hmap: hmap, biome: biome, spawners', 'return');
  }
  if (file === '04j_features.js') {
    src = rep(src, 'structBlocks += STc.writeUpTo(SB, cx, cz, stepSeen, cH, sea); }',
      "var __b = performance.now(); structBlocks += STc.writeUpTo(SB, cx, cz, stepSeen, cH, sea); __PF.acc('structures: step writes', performance.now() - __b); }", 'step writeUpTo');
    src = rep(src, 'n += place(pf.gen, SB, cx, cz, p[4], p[5], p[6], p[7]);',
      "var __a = performance.now(); n += place(pf.gen, SB, cx, cz, p[4], p[5], p[6], p[7]); __PF.acc(pf.gen.kind === 'ore' ? 'ore/vein' : 'feature:' + pf.gen.kind, performance.now() - __a);", 'place');
  }
  return src;
}

/** wrap a few entry points so their time shows up as `of which` rows. Runs in node AND (stringified) in the worker. */
export function wrapAll(NS, PF) {
  const w = (o, n, label) => {
    if (!o || typeof o[n] !== 'function') return;
    const f = o[n];
    o[n] = function () { const a = performance.now(); try { return f.apply(this, arguments); } finally { PF.acc(label, performance.now() - a); } };
  };
  w(NS.Jigsaw, 'assemble', 'jigsaw: assemble');
  w(NS.Jigsaw, 'writePiece', 'jigsaw: writePiece');
  w(NS.Structures, 'beginChunk', 'structures: beginChunk');
}

/** the worker bundle string, instrumented: stage marks + per-message timing riding on every result */
export function instrumentWorker(src) {
  // every module in the bundle is concatenated, so patch by marker text (patchSource asserts each one matches)
  let out = patchSource('04_worldgen.js', patchSource('04j_features.js', src));
  out = PRELUDE + out;
  out += '\n;(' + function (wrapAllSrc) {
    var h = self.onmessage, pm = self.postMessage.bind(self);
    var agg = { gen: 0, mesh: 0, jobs: 0, cloneMs: 0, busy: 0 }, cur = null;
    try { (new Function('NS', 'PF', 'return (' + wrapAllSrc + ')(NS,PF)'))(MCL, __PF); } catch (e) {}
    self.postMessage = function (m, x) {
      if (m && m.id !== undefined && cur) {
        var now = performance.now();
        m.__p = { a0: performance.timeOrigin + cur.t0, a1: performance.timeOrigin + now, ms: now - cur.t0, st: m.t === 'gen:done' ? __PF.last : null };
        agg.jobs++; if (m.t === 'gen:done') agg.gen += now - cur.t0; else agg.mesh += now - cur.t0;
        var c0 = performance.now(); pm(m, x); agg.cloneMs += performance.now() - c0;
      } else pm(m, x);
    };
    self.onmessage = function (ev) {
      var m = ev.data;
      if (m && m.t === 'prof') { pm({ t: 'prof', agg: JSON.parse(JSON.stringify(agg)) }); if (m.reset) { agg.gen = agg.mesh = agg.jobs = agg.cloneMs = agg.busy = 0; } return; }
      cur = { t0: performance.now() };
      h(ev);
      agg.busy += performance.now() - cur.t0;
      cur = null;
    };
  }.toString() + ')(' + JSON.stringify(wrapAll.toString()) + ');\n';
  return out;
}

// ---------------------------------------------------------------------------------------------
// small stats
// ---------------------------------------------------------------------------------------------
const sum = (a) => a.reduce((s, v) => s + v, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const pad = (v, n) => String(v).padStart(n);

function stageTable(rows, label) {
  // rows: [{s:{stage:ms}, f:{kind:ms}, total}]
  const names = [], fnames = [];
  for (const r of rows) { for (const k in r.s) if (!names.includes(k)) names.push(k); for (const k in r.f) if (!fnames.includes(k)) fnames.push(k); }
  const tot = sum(rows.map((r) => r.total));
  console.log('\n' + label + ' — ' + rows.length + ' chunks, ' + f1(tot) + ' ms total, ' + f1(tot / Math.max(1, rows.length)) + ' ms/chunk');
  console.log('  ' + 'stage'.padEnd(46) + pad('total ms', 10) + pad('mean', 8) + pad('p95', 8) + pad('max', 8) + pad('share', 8));
  const line = (k, get, ind) => {
    const v = rows.map(get);
    console.log('  ' + (ind + k).padEnd(46) + pad(f1(sum(v)), 10) + pad(f1(mean(v)), 8) + pad(f1(pct(v, 0.95)), 8) + pad(f1(Math.max(...v)), 8) + pad(f1(100 * sum(v) / tot) + '%', 8));
  };
  for (const k of names) line(k, (r) => r.s[k] || 0, '');
  const nested = fnames.sort((a, b) => sum(rows.map((r) => r.f[b] || 0)) - sum(rows.map((r) => r.f[a] || 0)));
  if (nested.length) console.log('  of which (nested inside the stages above):');
  for (const k of nested.slice(0, 14)) line(k, (r) => r.f[k] || 0, '  ');
  const fk = (r) => sum(Object.keys(r.f).filter((k) => k === 'ore/vein' || k.startsWith('feature:')).map((k) => r.f[k]));
  const fs = names.find((k) => k.startsWith('features'));
  if (fs && fnames.length) line('features: placement lists/sort/rejects (rest)', (r) => (r.s[fs] || 0) - fk(r) - (r.f['structures: step writes'] || 0), '  ');
}

// ---------------------------------------------------------------------------------------------
// modes
// ---------------------------------------------------------------------------------------------
function modeGolden(write) {
  const M = loadEngine({});
  const t0 = Date.now();
  const seeds = {};
  for (const s of GOLDEN_SEEDS) seeds[s] = hashSeed(M, s, GOLDEN_R);
  console.log('hashed ' + GOLDEN_SEEDS.length + ' seeds x ' + (2 * GOLDEN_R + 1) + '^2 chunks in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  if (write) {
    mkdirSync(dirname(GOLDEN_FILE), { recursive: true });
    writeFileSync(GOLDEN_FILE, JSON.stringify({
      note: 'GENERATED by tools/chunkgenprofile.mjs --golden --write (#1899). FNV-1a of every chunk: section arrays + biome + heightmap + spawner/entity logs, inline on one thread, row-major z then x over [-r,r]. A worldgen change that is meant to change chunks regenerates this; a speed-up never may.',
      r: GOLDEN_R, params: goldenParams(M), seeds,
    }, null, 1) + '\n');
    console.log('wrote ' + GOLDEN_FILE);
    return 0;
  }
  const g = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'));
  let bad = 0;
  for (const s of GOLDEN_SEEDS) {
    const want = g.seeds[s] || [];
    let d = 0;
    seeds[s].forEach((h, i) => { if (h !== want[i]) { d++; if (d <= 5) console.log('DIFF seed ' + s + ' chunk #' + i); } });
    bad += d;
    console.log((d ? 'FAIL' : 'ok  ') + '  seed ' + s + ': ' + (seeds[s].length - d) + '/' + seeds[s].length + ' chunks match');
  }
  return bad ? 1 : 0;
}

// the node-side __PF lives inside loadEngine's Function scope, so it is handed out as Gen.__pf (patched in below)
function modeStagesReal(seed, r, json) {
  const M = loadEngine({ patch: (f, s) => { s = patchSource(f, s); return f === '04_worldgen.js' ? s + '\nMCL.Gen.__pf = __PF;' : s; } });
  M.Gen.init(seed, goldenParams(M));
  wrapAll(M, M.Gen.__pf);
  M.Gen.genColumn(0, 0);                       // warm: JIT + lazy caches are not what we are measuring
  const rows = [];
  const t0 = process.hrtime.bigint();
  for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) {
    M.Gen.genColumn(cx, cz);
    const l = M.Gen.__pf.last;
    rows.push({ cx, cz, total: l.total, s: l.s, f: l.f });
  }
  const wall = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('inline on one thread, seed ' + seed + ', ' + (2 * r + 1) + 'x' + (2 * r + 1) + ' chunks, wall ' + f1(wall) + ' ms');
  stageTable(rows, 'GENERATION STAGES (inline)');
  const slow = rows.slice().sort((a, b) => b.total - a.total).slice(0, 5);
  console.log('  slowest chunks: ' + slow.map((c) => '(' + c.cx + ',' + c.cz + ') ' + f1(c.total) + ' ms').join('  '));
  if (json) writeFileSync(json, JSON.stringify({ seed, r, rows }, null, 1));
  return 0;
}

// ---------------------------------------------------------------------------------------------
// the browser: real chromium, real workers
// ---------------------------------------------------------------------------------------------
const PAGE_HOOK = function (cfg) {
  var NS = MCL, J = NS.Jobs, W = NS.World;
  var T = window.__T = { gen: [], mesh: [], inst: [], upload: [], clone: { gen: [], mesh: [] }, frames: [], peak: 0, perWorker: {}, play: 0,
                         tAllGen: 0, tAllMesh: 0, sections: {}, meshJobs: 0 };
  NS.WORKER_SRC.CHUNK = cfg.workerSrc;
  var abs = function () { return performance.timeOrigin + performance.now(); };
  // main-thread structured-clone cost of every postMessage to a worker (the send side; the receive side is invisible)
  var pmOrig = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (m) {
    var a = performance.now();
    pmOrig.apply(this, arguments);
    var d = performance.now() - a;
    if (m && m.t === 'gen') T.clone.gen.push(d); else if (m && m.t === 'mesh') T.clone.mesh.push(d);
  };
  var pickOrig = J._pick, lastW = null;
  J._pick = function () { lastW = pickOrig.apply(this, arguments); return lastW; };
  var postOrig = J._post, meta = {};
  J._post = function (msg, kind, release) {
    var t = abs();
    var p = postOrig.apply(this, arguments);
    if (J.mode === 'workers') {
      meta[msg.id] = { t: t, kind: kind, cx: msg.cx, cz: msg.cz, wi: J.workers.indexOf(lastW), key: kind === 'mesh' ? msg.cx + ',' + msg.cz + ',' + msg.sy : '' };
      if (J.inflight.size > T.peak) T.peak = J.inflight.size;
    }
    return p;
  };
  var onOrig = J._onMessage;
  J._onMessage = function (ev) {
    var m = ev.data, tr = abs();
    if (m && m.__p && meta[m.id]) {
      var x = meta[m.id]; delete meta[m.id];
      var row = { cx: x.cx, cz: x.cz, wait: m.__p.a0 - x.t, ms: m.__p.ms, back: tr - m.__p.a1, wi: x.wi, st: m.__p.st };
      (x.kind === 'gen' ? T.gen : T.mesh).push(row);
      T.perWorker[x.wi] = (T.perWorker[x.wi] || 0) + 1;
      if (x.kind === 'mesh') { T.sections[x.key] = (T.sections[x.key] || 0) + 1; T.meshJobs++; }
    }
    return onOrig.apply(this, arguments);
  };
  var instOrig = W.installChunk;
  W.installChunk = function () { var a = performance.now(); var r = instOrig.apply(this, arguments); T.inst.push(performance.now() - a); return r; };
  var G = NS.Gfx, upOrig = G.setSectionMesh;
  G.setSectionMesh = function () { var a = performance.now(); var r = upOrig.apply(this, arguments); T.upload.push(performance.now() - a); return r; };
  // frames
  var last = 0;
  (function loop(t) { if (last) T.frames.push(t - last); last = t; requestAnimationFrame(loop); })(performance.now());
  // settle detector: every in-radius chunk generated, then every one meshed and nothing in flight
  var rd = cfg.rd;
  setInterval(function () {
    if (!T.play) return;
    var P = NS.Player, cx0 = Math.floor(P.ex) >> 4, cz0 = Math.floor(P.ez) >> 4, gen = 0, dirty = 0, edge = 0, i;
    var gl = W.spiral(rd + 1, 1), ml = W.spiral(rd), need = gl.length >> 1;      // the very lists W.stream works from
    for (i = 0; i < gl.length; i += 2) { var c = W.get(cx0 + gl[i], cz0 + gl[i + 1]); if (c && c.state >= NS.CH.GENERATED) gen++; }
    // "meshed" = every non-empty section of every column W.stream meshes has had a mesh LAND at least once. (Waiting for
    // the dirty masks to be clear forever never ends: sections keep being re-meshed — that churn is reported separately.)
    for (i = 0; i < ml.length; i += 2) {
      var d = W.get(cx0 + ml[i], cz0 + ml[i + 1]);
      if (!d || d.state < NS.CH.GENERATED) { dirty++; continue; }
      if (!W.neighbourhoodReady(d.cx, d.cz)) { if (T.tAllGen) edge++; continue; }   // the rim: its 3x3 is never complete, the game never meshes it
      for (var sy = 0; sy < d.sec.length; sy++) if (d.sec[sy].u !== 0 && !T.sections[d.cx + ',' + d.cz + ',' + sy]) { dirty++; (T.sample = T.sample || []).push([d.cx, d.cz, sy, d.sec[sy].u, d.meshDirty[0], d.state, W.neighbourhoodReady(d.cx, d.cz), W.meshJobs.has(W.sectionKey(d.cx, d.cz, sy))]); break; }
    }
    var now = performance.now() - T.play;
    if (gen === need && !T.tAllGen) T.tAllGen = now;
    T.gotGen = gen; T.need = need; T.unmeshed = dirty; T.edge = edge; if (!dirty) T.sample = null; else if (T.sample && T.sample.length > 8) T.sample = T.sample.slice(-8);
    if (T.tAllGen && !dirty && !T.tAllMesh) T.tAllMesh = now;
  }, 50);
};

async function runBrowser(o) {
  const { open, sleep } = await import('./cdp.mjs');
  if (!process.env.MCLITE_PRESET) process.env.MCLITE_PRESET = 'medium';
  const file = join(MCLITE_ROOT, 'dist', 'mclite.html');
  if (!existsSync(file)) throw new Error('dist/mclite.html missing — run node build.mjs');
  const page = await open(file, { port: o.port || 9451, width: 640, height: 360 });
  if (!page) { console.log('SKIP  chunkgenprofile: no Chromium found'); return null; }
  try {
    await page.waitFor(function () { return !!(window.MCL && MCL.Main && typeof MCL.Main.play === 'function' && MCL.WORKER_SRC); }, 60000);
    const workerSrc = await page.evaluate(function () { return MCL.WORKER_SRC.CHUNK; });
    const cfg = { workerSrc: instrumentWorker(workerSrc), rd: o.rd };
    const err = await page.evaluate(new Function('(' + PAGE_HOOK.toString() + ')(' + JSON.stringify(cfg) + '); return "ok";'));
    if (err !== 'ok') throw new Error('hook failed: ' + page.lastThrow);
    // Boot applies the preset's own render distance/pool, so the measured run starts AFTER boot: set what we want,
    // resize the pool, drop the world, and zero the recorders. Same seed, same spawn, cold chunks.
    const maxChunks = (2 * o.rd + 5) * (2 * o.rd + 5);
    const caps = o.lift ? ('S.maxGenInflight=Math.max(S.maxGenInflight,' + (2 * o.pool) + ');S.maxMeshInflight=Math.max(S.maxMeshInflight,' + (4 * o.pool) + ');S.maxMeshPerFrame=Math.max(S.maxMeshPerFrame,' + (4 * o.pool) + ');') : '';
    await page.evaluate(new Function('MCL.Main.play({seed:' + JSON.stringify(String(o.seed)) + '});return 1;'));
    const up = await page.waitFor(function () { return !!(MCL.Main.ready && MCL.Hud.mode === 'game'); }, 120000);
    if (!up) throw new Error('world never came up: ' + page.lastThrow);
    await sleep(1500);
    await page.evaluate(new Function('var S=MCL.Settings,W=MCL.World,T=window.__T;S.renderDistance=S.rdBase=' + o.rd + ';S.adaptive=false;S.maxChunks=' + maxChunks + ';' + caps +
      'S.push({});window.__ready=0;MCL.Jobs.resize(' + o.pool + ').then(function(){MCL.Jobs.workers.forEach(function(w){w.postMessage({t:"prof",reset:1});});' +
      'W.init(W.seed64);MCL.Gfx.dropAll();' +
      'T.gen.length=T.mesh.length=T.inst.length=T.upload.length=T.clone.gen.length=T.clone.mesh.length=T.frames.length=0;T.peak=0;T.perWorker={};T.sections={};T.meshJobs=0;T.tAllGen=T.tAllMesh=0;' +
      'T.play=performance.now();window.__ready=1;});return 1;'));
    await page.waitFor(function () { return !!window.__ready; }, 20000);
    const done = await page.waitFor(function () { return !!window.__T.tAllMesh; }, o.timeout || 90000);
    if (process.env.CGP_DEBUG) console.log(await page.evaluate(function () { var T = window.__T, W = MCL.World; return JSON.stringify({ gen: T.gen.length, mesh: T.mesh.length, got: T.gotGen, need: T.need, tg: T.tAllGen, tm: T.tAllMesh, gi: W.genInflight, mi: W.meshInflight, s: T.sample, un: T.unmeshed, c: W.chunks.size, rd: MCL.Settings.renderDistance, w: MCL.Jobs.workers.length, play: T.play }); }));
    await page.evaluate(function () {
      window.__prof = null;
      var ws = MCL.Jobs.workers, out = [], n = ws.length;
      ws.forEach(function (w, i) {
        var h = w.onmessage;
        w.onmessage = function (ev) { if (ev.data && ev.data.t === 'prof') { out[i] = ev.data.agg; w.onmessage = h; if (--n === 0) window.__prof = JSON.stringify(out); } else h(ev); };
        w.postMessage({ t: 'prof' });
      });
      return 1;
    });
    await page.waitFor(function () { return !!window.__prof; }, 8000);
    const r = await page.evaluate(function () {
      var T = window.__T, J = MCL.Jobs, W = MCL.World;
      return JSON.stringify({ T: T, pool: J.workers.length, cores: MCL.ENV.cores, backend: MCL.Gfx.name, mode: J.mode, workers: JSON.parse(window.__prof || '[]'),
        caps: { gen: W.maxGenInflight, mesh: W.maxMeshInflight, perFrame: W.maxMeshPerFrame }, rdNow: MCL.Settings.renderDistance,
        chunks: W.chunks.size, got: T.gotGen, need: T.need, heap: (performance.memory && performance.memory.usedJSHeapSize) || 0 });
    });
    if (!r) throw new Error("result probe failed: " + page.lastThrow + " " + page.problems.slice(-3).join(" | "));
    const R = JSON.parse(r);
    R.done = !!done;
    R.problems = page.problems.slice(0, 5);
    return R;
  } finally { await page.close(); }
}

function reportBrowser(R, o) {
  const T = R.T;
  console.log('\n=== chunkgen profile: seed ' + o.seed + '  rd ' + o.rd + '  pool ' + R.pool + '/' + o.pool + ' (cores ' + R.cores + ')  backend ' + R.backend + '  jobs ' + R.mode +
              '  caps gen/mesh/frame ' + R.caps.gen + '/' + R.caps.mesh + '/' + R.caps.perFrame + (o.lift ? ' (LIFTED)' : ' (shipped)') + ' ===');
  if (!R.done) console.log('!! did not settle: generated ' + R.got + '/' + R.need + ' chunks, ' + T.unmeshed + ' columns still unmeshed (timeout)');
  const gen = T.gen, mesh = T.mesh;
  const rows = gen.filter((g) => g.st).map((g) => ({ total: g.st.total, s: g.st.s, f: g.st.f }));
  if (rows.length) stageTable(rows, 'GENERATION STAGES (in workers)');
  const wg = sum(gen.map((g) => g.ms)), wm = sum(mesh.map((g) => g.ms));
  const inst = sum(T.inst), upl = sum(T.upload), cg = sum(T.clone.gen), cm = sum(T.clone.mesh);
  const tot = wg + wm + inst + upl + cg + cm;
  console.log('\nWHERE THE TIME GOES (summed CPU ms; share of the sum — workers run in parallel, the main thread does not)');
  const l = (k, v, n) => console.log('  ' + k.padEnd(44) + pad(f1(v), 10) + ' ms' + pad(f1(100 * v / tot) + '%', 8) + (n ? '   n=' + n + ', mean ' + f1(v / n) + ' ms' : ''));
  l('generation in worker', wg, gen.length);
  l('mesh in worker', wm, mesh.length);
  l('main: installChunk', inst, T.inst.length);
  l('main: mesh upload (Gfx.setSectionMesh)', upl, T.upload.length);
  l('main: structured-clone send (gen+mesh)', cg + cm, T.clone.gen.length + T.clone.mesh.length);
  const slow = gen.slice().sort((a, b) => b.ms - a.ms).slice(0, 5);
  console.log('  slowest chunks (worker ms): ' + slow.map((g) => '(' + g.cx + ',' + g.cz + ') ' + f1(g.ms)).join('  '));
  const waitG = gen.map((g) => g.wait), waitM = mesh.map((g) => g.wait);
  console.log('  queue wait post->worker start (gen):   mean ' + f1(mean(waitG)) + '  p95 ' + f1(pct(waitG, 0.95)) + '  max ' + f1(Math.max(0, ...waitG)) + ' ms');
  console.log('  queue wait post->worker start (mesh):  mean ' + f1(mean(waitM)) + '  p95 ' + f1(pct(waitM, 0.95)) + '  max ' + f1(Math.max(0, ...waitM)) + ' ms');
  console.log('  result transit worker->main (gen):     mean ' + f1(mean(gen.map((g) => g.back))) + '  mesh ' + f1(mean(mesh.map((g) => g.back))) + ' ms');
  const secs = Object.keys(T.sections).length, again = Object.values(T.sections).filter((v) => v > 1).length;
  console.log('  mesh jobs ' + T.meshJobs + ' over ' + secs + ' sections: ' + f1(T.meshJobs / Math.max(1, secs)) + ' per section, ' + again + ' sections meshed more than once');
  console.log('  jobs per worker: ' + Object.keys(T.perWorker).map((k) => 'w' + k + '=' + T.perWorker[k]).join(' ') + '   peak in flight ' + T.peak);
  const busy = R.workers.map((w) => (w ? w.busy : 0));
  const wall = T.tAllMesh || (T.frames.length ? sum(T.frames) : 0);
  console.log('  worker busy ms: ' + busy.map(f1).join(' ') + '   utilisation of the pool over the settle window: ' + f1(100 * sum(busy) / Math.max(1, R.pool * wall)) + '%');
  console.log('  time to all generated ' + f1(T.tAllGen) + ' ms   time to all meshed (every non-empty section of every column with a complete 3x3 meshed once) ' + f1(T.tAllMesh) + ' ms   chunks resident ' + R.chunks + '   heap ' + f1(R.heap / 1048576) + ' MB');
  const fr = T.frames.slice(1);   // the first frame spans the boot
  console.log('  frame ms (main thread, SwiftShader raster — relative only): n=' + fr.length + '  p50 ' + f1(pct(fr, 0.5)) + '  p95 ' + f1(pct(fr, 0.95)) + '  max ' + f1(Math.max(0, ...fr)) + '  frames > 100 ms: ' + fr.filter((v) => v > 100).length);
  if (R.problems.length) console.log('  page problems: ' + R.problems.join(' | '));
}

function summarise(R) {
  const T = R.T, fr = T.frames.slice(1);
  const busy = sum(R.workers.map((w) => (w ? w.busy : 0)));
  const p50 = pct(fr, 0.5);
  return {
    pool: R.pool, caps: R.caps, tGen: T.tAllGen, tMesh: T.tAllMesh, done: R.done,
    util: 100 * busy / Math.max(1, R.pool * (T.tAllMesh || 1)),
    genUtil: 100 * sum(T.gen.map((g) => g.ms)) / Math.max(1, R.pool * (T.tAllGen || 1)),
    peak: T.peak, meshJobs: T.meshJobs, genJobs: T.gen.length,
    meshRate: 1000 * T.meshJobs / Math.max(1, T.tAllMesh), meshCap: R.caps.perFrame * 1000 / Math.max(1, p50),
    genRate: 1000 * T.gen.length / Math.max(1, T.tAllGen), genCap: R.caps.gen * 1000 / Math.max(1, p50),
    mainMs: sum(T.inst) + sum(T.upload) + sum(T.clone.gen) + sum(T.clone.mesh),
    p50, p95: pct(fr, 0.95), max: Math.max(0, ...fr), over100: fr.filter((v) => v > 100).length,
    cores: R.cores,
  };
}

// where does adding workers stop paying, for one phase (gen or mesh)? The smallest pool within 10% of the best time.
function whyStops(rs, key, rate, cap, capName) {
  const best = Math.min(...rs.map((s) => s[key])), at = rs.find((s) => s[key] <= best * 1.1);
  const why = [];
  if (at.pool >= at.cores) why.push('the pool reached the machine\'s ' + at.cores + ' cores');
  if (at[rate] >= 0.7 * at[cap]) why.push('FEED CAP: ' + capName + ' x frame rate allows ' + f1(at[cap]) + ' jobs/s and ' + f1(at[rate]) + ' are issued');
  const u = key === 'tGen' ? at.genUtil : at.util;
  if (u < 60 && !(at[rate] >= 0.7 * at[cap])) why.push('workers only ' + f1(u) + '% busy: the main thread (frame pacing, installChunk ' + 'etc, main work ' + f1(at.mainMs) + ' ms) feeds them too slowly');
  else if (u >= 60 && at.pool < at.cores) why.push('workers ' + f1(u) + '% busy');
  return { at, text: why.length ? why.join('; ') : 'no single limiter measured' };
}

async function modeScaling(o) {
  const pools = o.pools, out = [];
  for (const lift of [false, true]) {
    for (const p of pools) {
      const R = await runBrowser({ ...o, pool: p, lift });
      if (!R) return 0;
      const s = summarise(R); s.lift = lift; s.asked = p; out.push(s);
      console.log('  ran pool ' + p + (lift ? ' lifted' : ' shipped') + ': gen ' + f1(s.tGen) + ' mesh ' + f1(s.tMesh) + ' ms');
    }
  }
  console.log('\nPOOL SCALING — seed ' + o.seed + ', rd ' + o.rd + ', preset ' + process.env.MCLITE_PRESET + ' (feed caps: shipped = the preset\'s own; lifted = gen>=2x pool, mesh>=4x pool, per-frame>=4x pool)');
  console.log('  ' + ['caps', 'pool', 'actual', 'toGenMs', 'toMeshMs', 'gen x', 'mesh x', 'genUt%', 'meshUt%', 'mesh/s', 'cap/s', 'peakFl', 'mainMs', 'fr p50', 'fr p95', 'fr max', '>100'].map((h, i) => pad(h, i ? 9 : 8)).join(''));
  for (const lift of [false, true]) {
    const rs = out.filter((s) => s.lift === lift);
    for (const s of rs) {
      console.log('  ' + [lift ? 'lifted' : 'shipped', s.asked, s.pool, f1(s.tGen), f1(s.tMesh), f1(rs[0].tGen / s.tGen) + 'x', f1(rs[0].tMesh / s.tMesh) + 'x', f1(s.genUtil), f1(s.util), f1(s.meshRate), f1(s.meshCap), s.peak, f1(s.mainMs), f1(s.p50), f1(s.p95), f1(s.max), s.over100].map((v, i) => pad(v, i ? 9 : 8)).join(''));
    }
    const g = whyStops(rs, 'tGen', 'genRate', 'genCap', 'maxGenInflight'), m = whyStops(rs, 'tMesh', 'meshRate', 'meshCap', 'maxMeshPerFrame');
    console.log('  -> ' + (lift ? 'lifted' : 'shipped') + ' caps: GENERATION stops scaling at pool ' + g.at.pool + ' — ' + g.text);
    console.log('  -> ' + (lift ? 'lifted' : 'shipped') + ' caps: MESHING stops scaling at pool ' + m.at.pool + ' — ' + m.text);
  }
  console.log('  (headless SwiftShader paces frames at ~30 fps and World.stream issues work once per frame, so "feed" ceilings here are LOWER than on a real GPU; the worker CPU numbers are real. The browser own main, compositor and raster threads share the host cores with the workers, so ~4 workers is the practical ceiling here.)');
  if (o.json) writeFileSync(o.json, JSON.stringify(out, null, 1));
  return 0;
}

// ---------------------------------------------------------------------------------------------
async function main() {
  process.setMaxListeners(100);
  const argv = process.argv.slice(2);
  const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const has = (n) => argv.includes(n);
  const json = flag('--json', null);
  if (has('--golden')) return modeGolden(has('--write'));
  if (has('--stages')) return modeStagesReal(Number(flag('--seed', 1337)), Number(flag('--r', 10)), json);
  const o = { seed: Number(flag('--seed', 1337)), pool: Number(flag('--pool', 3)), lift: has('--lift'), json,
              pools: flag('--pools', '1,2,3,4,6,8').split(',').map(Number), port: Number(flag('--port', 9451)) };
  if (has('--scaling')) { o.rd = Number(flag('--rd', 8)); return modeScaling(o); }
  if (has('--browser')) {
    const all = [];
    for (const rd of flag('--rd', '6,12,16').split(',').map(Number)) {
      const R = await runBrowser({ ...o, rd });
      if (!R) return 0;
      reportBrowser(R, { ...o, rd });
      all.push(R);
    }
    if (json) writeFileSync(json, JSON.stringify(all, null, 1));
    return 0;
  }
  console.log('usage: --golden [--write] | --stages | --browser [--rd 6,12,16] [--pool n] [--lift] | --scaling [--rd n] [--pools 1,2,3,4,6,8]');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((c) => process.exit(c || 0), (e) => { console.error('FAIL  chunkgenprofile: ' + (e && e.stack || e)); process.exit(1); });
}
