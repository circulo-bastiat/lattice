#!/usr/bin/env node
// livemeshcheck.mjs — #1159 / KW-48c: the LIVE repro harness for see-through / face-culled blocks.
//
//   node tools/livemeshcheck.mjs [dist/mclite.html] [--seconds N]
//
// seamcheck covers the synchronous edit->remesh path in node. Dan still saw holes in the REAL game, so
// this drives the real page (mesh workers ON, streaming while flying, mining and placing at section and
// column edges) and, every few frames, compares what the renderer HOLDS for each settled section
// (Gfx.meshes quads) against a from-scratch synchronous Mesher.mesh of the same World state.
// A section is "settled" when nothing can still legitimately be in flight for it: dirty bit clear, no mesh
// job, empty upload queue, 3x3 column neighbourhood generated. Divergences are named by path:
//   missing  - truth has quads, the renderer holds no mesh  (async result lost / never requested)
//   stale    - both exist, quad counts differ               (out-of-order or pre-edit result landed last)
//   extra    - renderer holds quads, truth has none         (mesh outlived its blocks)
// The end state (movement stopped, queue drained) must have ZERO of each.
// Anti-vacuity: the same audit after a deliberately dropped / corrupted renderer mesh must be caught.
import { open, sleep } from './cdp.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const target = args.find((a) => a.endsWith('.html')) || join(ROOT, 'dist', 'mclite.html');
const si = args.indexOf('--seconds');
const SECONDS = si >= 0 ? +args[si + 1] : 25;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
console.log('livemeshcheck - renderer meshes vs from-scratch truth on the real page (#1159)');

const fn = (body) => ({ toString: () => 'function(){' + body + '}' });   // cdp.evaluate wraps '(' + fn + ')()'
const page = await open(target, { width: 800, height: 600 });
if (!page) { console.log('SKIP -- no Chromium on this machine'); process.exit(0); }
await sleep(1200);
await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
const ready = await page.waitFor(function () {
  return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
}, 90000);
if (!ready) { console.log('FATAL: world never came up'); process.exit(1); }
await sleep(1000);

// In-page audit, installed once. Returns {settled, missing[], stale[], shade[], extra[], pending}.
// A mesh is compared as its GEOMETRY signature (covered area per face direction + model-quad count), which
// is what "see-through" is about; a differing quad count with equal area is only a shading difference
// (greedy merge keys carry light) and is reported as `shade`, informational.
await page.evaluate(function () {
  var Q = MCL.CFG.QUAD_BYTES;
  function sig(buf) {
    if (!buf) return '';
    var h = MCL.Mesher.readHeader(buf), u = new Uint32Array(buf), area = [0, 0, 0, 0, 0, 0], q = 0;
    for (var l = 0; l < 3; l++) for (var i = 0; i < h.quads[l]; i++) {
      var o = (h.off[l] + i * Q) >> 2, d0 = u[o], d1 = u[o + 1];
      area[(d0 >>> 18) & 7] += ((d1 >>> 12) & 255) * ((d1 >>> 20) & 255); q++;
    }
    return area.join(',') + '|m' + (h.modelQuads[0] + h.modelQuads[1] + h.modelQuads[2]) + '|q' + q;
  }
  var G = MCL.Gfx, held = window.__held = new Map(), orig = G.setSectionMesh;
  G.setSectionMesh = function (cx, cz, sy, buf) { held.set(G.sectionKey(cx, cz, sy), sig(buf)); return orig.call(G, cx, cz, sy, buf); };
  window.__audit = function (limit) {
    var W = MCL.World, M = MCL.Mesher, CFG = MCL.CFG, out = { settled: 0, missing: [], stale: [], shade: [], extra: [], vis: [], pending: 0, keys: [] };
    var rd = MCL.Settings.renderDistance, queued = Object.create(null), n = 0;
    for (var qi = 0; qi < G.uploadQueue.length; qi++) queued[G.uploadQueue[qi].key] = 1;
    W.chunks.forEach(function (c) {
      if (c.state < MCL.CH.GENERATED || !W.neighbourhoodReady(c.cx, c.cz)) return;
      // the streamer only meshes inside the render disc; dirty bits further out are queued work, not a fault
      var far = (c.cx - W.camCx) * (c.cx - W.camCx) + (c.cz - W.camCz) * (c.cz - W.camCz) > rd * rd;
      for (var sy = 0; sy < CFG.SECTIONS_Y; sy++) {
        var k = G.sectionKey(c.cx, c.cz, sy);
        if (c.meshDirty[0] & (1 << sy)) { if (!far) out.pending++; continue; }
        if (W.meshJobs.has(W.sectionKey(c.cx, c.cz, sy)) || queued[k]) { out.pending++; continue; }
        var hs = held.get(k);
        if (hs === undefined) { if (G.meshes.has(k)) continue; hs = ''; }   // uploaded before the hook: signature unknown
        if (c.sec[sy].u === 0 && !hs) continue;
        if (limit && n >= limit) return;
        n++;
        var snap = W.snapshotFor(c.cx, c.cz, sy), buf = M.mesh(snap, null);
        W.releaseSnap(snap);
        var ts = sig(buf);
        if ((c.vis[sy] & 0x7FFF) !== (M.lastVis & 0x7FFF)) out.vis.push(c.cx + ',' + c.cz + ',' + sy + ' held=' + c.vis[sy].toString(2) + ' truth=' + (M.lastVis & 0x7FFF).toString(2));
        out.settled++;
        if (out.keys.length < 40 && +ts.split('|q')[1] > 8) out.keys.push(k);
        var tag = c.cx + ',' + c.cz + ',' + sy + ' truth=' + ts + ' held=' + hs;
        if (ts === hs) continue;
        if (ts && !hs) out.missing.push(tag);
        else if (!ts) out.extra.push(tag);
        else if (ts.split('|q')[0] !== hs.split('|q')[0]) out.stale.push(tag);
        else out.shade.push(tag);
      }
    });
    return out;
  };
});

const mode = await page.evaluate(function () { return { jobs: MCL.Jobs.mode, gfx: MCL.Gfx.name, rd: MCL.Settings.renderDistance }; });
console.log('page:', JSON.stringify(mode));
ok(mode.jobs === 'workers', 'mesh workers are ON (mode=' + mode.jobs + ')');

await page.evaluate(function () { MCL.Settings.adaptive = false; MCL.Settings.renderDistance = 5; });
await page.evaluate(function () { var P = MCL.Player; P.flying = true; P.noclip = true; P.vx = P.vy = P.vz = 0; });

// Drive: fly along a path in small hops while editing at section / column edges around the player.
const driveBody = `
  var P = MCL.Player, W = MCL.World, St = MCL.States, st = window.__st = window.__st || { t: 0 };
  st.t++;
  P.x += 6 * Math.cos(st.t * 0.07); P.z += 6; P.y = 100 + 20 * Math.sin(st.t * 0.05);
  if (P.interpolate) P.interpolate(0);
  var kinds = [St.stateOf('stone'), 0, St.stateOf('glass'), 0, St.stateOf('water'), St.stateOf('oak_stairs')];
  for (var i = 0; i < 6; i++) {
    var bx = Math.floor(P.x) + ((st.t * 7 + i * 13) % 5) * 16 - 32, bz = Math.floor(P.z) + ((st.t * 3 + i * 11) % 5) * 16 - 32;
    bx = (bx & ~15) + (i & 1 ? 15 : 0); bz = (bz & ~15) + (i & 2 ? 15 : 0);
    var by = -64 + 16 * (((st.t + i) % 12) + 4) + (i & 4 ? 15 : 0);
    var c = W.get(bx >> 4, bz >> 4);
    if (c && c.state >= MCL.CH.GENERATED) W.setBlock(bx, by, bz, kinds[(st.t + i) % kinds.length]);
  }
  return 1;`;
const drive = fn(driveBody);

const mid = { vis: 0, missing: 0, stale: 0, shade: 0, extra: 0, settled: 0, audits: 0 };
const t0 = Date.now();
while (Date.now() - t0 < SECONDS * 1000) {
  await page.evaluate(drive);
  await sleep(120);
  if (mid.audits < 400 && (mid.audits++ % 5) === 0) {
    const a = await page.evaluate(function () { return window.__audit(60); });
    mid.settled += a.settled; mid.missing += a.missing.length; mid.stale += a.stale.length; mid.shade += a.shade.length; mid.vis += a.vis.length; mid.extra += a.extra.length;
    if (a.missing.length + a.stale.length + a.extra.length) console.log('  mid-flight divergence sample:', JSON.stringify([a.missing[0], a.stale[0], a.extra[0]]));
  }
}
console.log('mid-flight (informational; in-flight races can be transient):', JSON.stringify(mid));

// Stop, drain, audit the end state: nothing is allowed to remain wrong.
let end = null;
for (let i = 0; i < 300; i++) {
  await sleep(1000);
  end = await page.evaluate(function () { return window.__audit(0); });
  if (!end.pending && end.settled) break;
}
console.log('end diag:', JSON.stringify(await page.evaluate(function () { var W = MCL.World; return { uq: MCL.Gfx.uploadQueue.length, mi: W.meshInflight, jobs: W.meshJobs.size, frame: W.frame, load: W.load, rd: MCL.Settings.renderDistance }; })));
console.log('end state:', JSON.stringify({ settled: end.settled, pending: end.pending, missing: end.missing.length, stale: end.stale.length, shade: end.shade.length, vis: end.vis.length, extra: end.extra.length }));
for (const k of ['missing', 'stale', 'extra', 'vis']) if (end[k].length) console.log('  ' + k + ':', end[k].slice(0, 8).join(' | '));
ok(end.settled > 100, 'audit covered ' + end.settled + ' settled sections (>100)');
ok(end.pending === 0, 'streamer drained (pending ' + end.pending + ')');
ok(end.missing.length === 0, 'no settled section is missing its mesh (' + end.missing.length + ')');
ok(end.stale.length === 0, 'no settled section holds a stale mesh (' + end.stale.length + ')');
ok(end.vis.length === 0, 'every settled section\'s visibility mask equals a from-scratch one (' + end.vis.length + ' differ)');
ok(end.extra.length === 0, 'no settled section holds a mesh its blocks no longer justify (' + end.extra.length + ')');

// ---- (e) worker table parity: the mesh worker's occluder test against the main thread's, for EVERY state ----
// Found by this harness: glass placed in a section meshed to a different visibility mask on the worker than on the main
// thread, because Jobs.start never sent the worker canOcclude / outlineFull (visOpaque then read every full-collision-box
// block as a wall). A uniform section short-circuits the mesher's visibility to opaque[state] ? 0 : VIS_ALL, so one
// uniform-section job per state reads the worker's table directly.
await page.evaluate(function () {
  window.__parity = null;
  window.__runParity = function (flipState) {
    var W = MCL.World, SR = MCL.States, n = SR.count, wrong = [], pending = 0, sent = 0, c0 = null;
    W.chunks.forEach(function (c) { if (!c0 && c.state >= MCL.CH.GENERATED && W.neighbourhoodReady(c.cx, c.cz)) c0 = c; });
    var expectOpaque = function (st) { return (st === flipState) ? 1 - SR.visOpaque[st] : SR.visOpaque[st]; };
    window.__parity = null;
    var step = 7;                                                   // every 7th state keeps the job count at ~3000
    var states = []; for (var st = 1; st < n; st += step) states.push(st); if (flipState) states.push(flipState);
    var left = states.length;
    states.forEach(function (st) {
      var snap = W.snapshotFor(c0.cx, c0.cz, 6);
      snap.nb[13] = { u: st, lu: 15, p: undefined, d: undefined, l: undefined, b: undefined, n: undefined };
      MCL.Jobs.requestMesh(c0.cx, c0.cz, 6, snap, W.releaseSnap).then(function (r) {
        var wOpaque = (r.vis & 0x7FFF) === 0 ? 1 : 0;
        if (wOpaque !== expectOpaque(st)) wrong.push(MCL.Reg.names[SR.block[st]] + '#' + st);
        if (--left === 0) window.__parity = { checked: states.length, wrong: wrong };
      });
    });
    return states.length;
  };
});
async function parity(flip) {
  await page.evaluate(fn('return window.__runParity(' + (flip || 0) + ')'));
  await page.waitFor(function () { return window.__parity; }, 240000);
  return page.evaluate(function () { return window.__parity; });
}
const par = await parity(0);
console.log('worker/main occluder parity:', JSON.stringify({ checked: par && par.checked, wrong: par && par.wrong.length }), par && par.wrong.slice(0, 8).join(' '));
ok(par && par.checked > 2000, 'worker occluder table checked for ' + (par && par.checked) + ' states (>2000)');
ok(par && par.wrong.length === 0, 'the mesh worker\'s occluder table equals the main thread\'s (' + (par && par.wrong.length) + ' states differ)');
const glassId = await page.evaluate(function () { return MCL.States.stateOf('glass'); });
const parBad = await parity(glassId);
const parCaught = !!(parBad && parBad.wrong.length >= 1);
ok(parCaught, 'a deliberately flipped expectation for glass is caught by the parity audit');

// ---- (b) the occlusion flood vs an exact voxel flood --------------------------------------------------------
// From a camera cell, walk 6-connected through blocks that do not block the flood (the mesher's own visOpaque), out to
// 56 blocks. Every section holding a reached cell, or a solid cell face-adjacent to one, can be SEEN from there, so
// Gfx.floodHas must say yes for it. (The section flood is allowed to be coarser in the OTHER direction.) A miss is a
// section the draw loop would cull while geometry in it is genuinely reachable by sight-lines: a see-through hole.
await page.evaluate(function () {
  window.__floodAudit = function (px, py, pz, breakVis) {
    var W = MCL.World, G = MCL.Gfx, CFG = MCL.CFG, SR = MCL.States, R = 56, N = 2 * R + 1, MINY = CFG.WORLD_MIN_Y;
    var vo = SR.visOpaque, seen = new Uint8Array(N * N * N), q = new Int32Array(N * N * N), qh = 0, qt = 0;
    var secs = Object.create(null);
    var ccx = px >> 4, ccz = pz >> 4, csy = (py - MINY) >> 4, rd = MCL.Settings.renderDistance;
    function blk(x, y, z) { var c = W.get(x >> 4, z >> 4); if (!c || c.state < MCL.CH.GENERATED) return -1; return W.getBlock(x, y, z); }
    if (blk(px, py, pz) < 0 || vo[blk(px, py, pz)]) return null;
    var DX = [1, -1, 0, 0, 0, 0], DY = [0, 0, 1, -1, 0, 0], DZ = [0, 0, 0, 0, 1, -1];
    function idx(x, y, z) { return ((x - px + R) * N + (y - py + R)) * N + (z - pz + R); }
    seen[idx(px, py, pz)] = 1; q[qt++] = px; q[qt++] = py; q[qt++] = pz;
    function mark(x, y, z) { secs[(x >> 4) + ',' + (z >> 4) + ',' + ((y - MINY) >> 4)] = 1; }
    mark(px, py, pz);
    qt = 3; var qx = [px], qy = [py], qz = [pz]; qh = 0;
    while (qh < qx.length) {
      var x = qx[qh], y = qy[qh], z = qz[qh]; qh++;
      for (var d = 0; d < 6; d++) {
        var nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (Math.abs(nx - px) > R || Math.abs(nz - pz) > R || Math.abs(ny - py) > R || ny < MINY || ny >= CFG.WORLD_MAX_Y) continue;
        var i = idx(nx, ny, nz); if (seen[i]) continue;
        var b = blk(nx, ny, nz); if (b < 0) continue;
        if (vo[b]) { mark(nx, ny, nz); continue; }        // a visible solid face: its section must be reached, not entered
        seen[i] = 1; mark(nx, ny, nz); qx.push(nx); qy.push(ny); qz.push(nz);
      }
    }
    if (breakVis) { var c0 = W.get(ccx, ccz); for (var s0 = 0; s0 < CFG.SECTIONS_Y; s0++) c0.vis[s0] = 0; var cs = W.get(ccx + 1, ccz); if (cs) cs.vis.fill(0); }
    G.floodVisible(ccx, ccz, csy, Math.max(1, rd));
    var miss = [], checked = 0;
    for (var k in secs) {
      var p = k.split(','), cx = +p[0], cz = +p[1], sy = +p[2];
      var dx = (cx * 16 + 8 - px), dz = (cz * 16 + 8 - pz), dy = (MINY + sy * 16 + 8 - py);
      if (dx * dx + dz * dz + dy * dy > 40 * 40) continue;                     // keep clear of the BFS box edge
      if (Math.abs(cx - ccx) >= rd || Math.abs(cz - ccz) >= rd) continue;
      var c = W.get(cx, cz); if (!c || c.state < MCL.CH.GENERATED || c.sec[sy].u === 0) continue;
      checked++;
      if (!G.floodHas(ccx, ccz, cx, cz, sy)) miss.push(k);
    }
    return { reached: Object.keys(secs).length, checked: checked, miss: miss };
  };
});
const floodSpots = await page.evaluate(function () {
  var W = MCL.World, SR = MCL.States, out = [], seed = 7, P = MCL.Player;
  function rnd() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
  for (var t = 0; t < 4000 && out.length < 14; t++) {
    var x = Math.floor(P.x + (rnd() - 0.5) * 80), z = Math.floor(P.z + (rnd() - 0.5) * 80), y = Math.floor(-30 + rnd() * 120);
    var c = W.get(x >> 4, z >> 4); if (!c || c.state < MCL.CH.GENERATED) continue;
    if (!SR.visOpaque[W.getBlock(x, y, z)] && SR.visOpaque[W.getBlock(x, y - 1, z)] && !SR.visOpaque[W.getBlock(x, y + 1, z)]) out.push([x, y, z]);
  }
  return out;
});
let fChecked = 0, fMiss = 0; const fEx = [];
for (const [x, y, z] of floodSpots) {
  const r = await page.evaluate(fn('try{return window.__floodAudit(' + [x, y, z].join(',') + ')}catch(e){return {err:String(e.stack).slice(0,300)}}'));
  if (r && r.err) console.log(r.err);
  if (process.env.LM_DEBUG) console.log('  spot', x, y, z, JSON.stringify(await page.evaluate('(function(){var W=MCL.World,c=W.get('+(x>>4)+','+(z>>4)+');return [c&&c.state,W.getBlock('+[x,y,z]+'),MCL.States.visOpaque[W.getBlock('+[x,y,z]+')],MCL.CH.GENERATED]})()')), JSON.stringify(r && { reached: r.reached, checked: r.checked }));
  if (!r) continue;
  fChecked += r.checked; fMiss += r.miss.length;
  if (r.miss.length) fEx.push('(' + [x, y, z] + ') ' + r.miss.slice(0, 4).join(' '));
}
console.log('flood audit:', JSON.stringify({ spots: floodSpots.length, sectionsChecked: fChecked, floodMissed: fMiss }), fEx.slice(0, 4).join(' || '));
ok(fChecked > 200, 'flood audit covered ' + fChecked + ' voxel-reachable sections (>200)');
// not 0: vanilla's own section graph (face-pair masks + no doubling back) is coarser than true sight-lines, so a
// stray section is expected; a systematic hole (a wrong occluder table, stale masks) is not, and shows up as a bulk miss.
ok(fMiss <= Math.ceil(fChecked * 0.01), 'the occlusion flood reaches the sections a voxel flood can see (' + fMiss + ' of ' + fChecked + ' missed, <=1%)');
let floodBreaks = 0;
for (const [x, y, z] of floodSpots) {
  const r = await page.evaluate(fn('return window.__floodAudit(' + [x, y, z].join(',') + ',true)'));
  if (r && r.miss.length) { floodBreaks = 1; break; }
}
ok(floodBreaks === 1, 'deliberately zeroed vis masks are caught by the flood audit');

// ---- (c) #1262: BREAK a block, then check the flood and the held meshes while the remesh is still in flight ----
// Dan 1 Oct: blocks went see-through right after he broke one. Standing at each spot, dig a 6-block tunnel through the
// solid wall beside it (World.setBlock, the one place a break lands) at section / column edges, and audit the flood
// against the voxel flood (1) the very next frame - dirty sections must read as connected - and (2) once drained.
// A section the voxel flood can see but the draw loop would cull is the see-through hole.
let bkChecked = 0, bkMissMid = 0, bkMissEnd = 0; const bkEx = [];
for (const [x, y, z] of floodSpots.slice(0, 8)) {
  const dig = await page.evaluate(fn('var W=MCL.World,P=MCL.Player,n=0,dx=0;var x=' + x + ',y=' + y + ',z=' + z + ';P.x=x+.5;P.y=y+1.6;P.z=z+.5;' +
    'for(var d=1;d<=24&&n<8;d++){var c=W.get((x+d)>>4,z>>4);if(!c||c.state<MCL.CH.GENERATED)break;' +
    'if(MCL.States.visOpaque[W.getBlock(x+d,y,z)]||MCL.States.visOpaque[W.getBlock(x+d,y+1,z)]){W.setBlock(x+d,y,z,0);W.setBlock(x+d,y+1,z,0);n++}}return n'));
  if (!dig) continue;
  const mid = await page.evaluate(fn('return window.__floodAudit(' + [x, y, z].join(',') + ')'));
  if (mid) { bkChecked += mid.checked; bkMissMid += mid.miss.length; if (mid.miss.length) bkEx.push('mid (' + [x, y, z] + ') ' + mid.miss.slice(0, 3).join(' ')); }
  for (let i = 0; i < 120; i++) { await sleep(500); const a = await page.evaluate(function () { return window.__audit(1); }); if (!a.pending) break; }
  const fin = await page.evaluate(fn('return window.__floodAudit(' + [x, y, z].join(',') + ')'));
  if (fin) { bkMissEnd += fin.miss.length; if (fin.miss.length) bkEx.push('end (' + [x, y, z] + ') ' + fin.miss.slice(0, 3).join(' ')); }
}
console.log('break audit:', JSON.stringify({ checked: bkChecked, missMid: bkMissMid, missEnd: bkMissEnd }), bkEx.slice(0, 4).join(' || '));
ok(bkChecked > 100, 'break audit covered ' + bkChecked + ' voxel-reachable sections (>100)');
ok(bkMissMid <= Math.ceil(bkChecked * 0.01), 'right after breaking, the flood still reaches every section a voxel flood can see (' + bkMissMid + ' missed)');
ok(bkMissEnd <= Math.ceil(bkChecked * 0.01), 'after the remeshes land, the flood reaches every section a voxel flood can see (' + bkMissEnd + ' missed)');

// ---- anti-vacuity: break the renderer's recorded state three ways, the audit must name each ----
// the break audit must fail when a dug-through section's vis mask is stale-zero (what an un-stamped markDirty would leave)
let bkBreak = 0;
for (const [x, y, z] of floodSpots) {
  const r = await page.evaluate(fn('return window.__floodAudit(' + [x, y, z].join(',') + ',true)'));
  if (r && r.miss.length) { bkBreak = 1; break; }
}
ok(bkBreak === 1, 'a stale zero vis mask on a section next to a break is caught by the break audit');
let breaks = floodBreaks + bkBreak + (parCaught ? 1 : 0);
const victims = (await page.evaluate(function () { return window.__audit(0); })).keys.slice(0, 3);
if (victims.length === 3) {
  await page.evaluate(fn('var v=' + JSON.stringify(victims) + ',h=window.__held;h.set(v[0],"");h.set(v[1],"9,9,9,9,9,9|m0|q1");h.set(v[2],"");return 1;'));
  const bad = await page.evaluate(function () { return window.__audit(0); });
  const caught = bad.missing.length >= 2 && bad.stale.length >= 1;
  if (caught) { breaks += 3; console.log('  ' + breaks + ' breaks caught'); }
  ok(caught, 'deliberately broken renderer state is caught (missing ' + bad.missing.length + ', stale ' + bad.stale.length + ')');
} else ok(false, 'anti-vacuity: no victims found (' + victims.length + ')');

console.log(fails.length ? '\nFAIL ' + (pass + fails.length) + ' checks, ' + fails.length + ' failures\n' + fails.join('\n') : '\nPASS ' + pass + ' checks, 0 failures, ' + breaks + ' breaks caught');
try { await page.close(); } catch (e) {}
process.exit(fails.length ? 1 : 0);
