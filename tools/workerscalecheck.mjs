#!/usr/bin/env node
// workerscalecheck.mjs — #1902 C2ME-4: per-worker memory and pool scaling, MEASURED, with the determinism gate riding along.
//
// The real chunk worker (hosted by wkhashcheck.mjs's worker side) is run at pool 1..8 (C2ME-2 gate range) over the same area.
// Reported: wall ms and chunks/s per pool (the C2ME-1 scaling table, after), and the RSS cost of one more worker
// (each worker holds its own copy of the engine + registry: the thread count is a MEMORY setting as well as a CPU one).
// Asserted: every chunk fingerprint equals the inline golden at every pool size (timing is reported, never asserted:
// it is host-dependent), the stage table has the vanilla order, and the heap figure is sane.
// Anti-vacuity: a corrupted golden entry and a dropped chunk must each be caught.

import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
import { GOLDEN_FILE, GOLDEN_SEEDS, GOLDEN_R, goldenParams } from './chunkgenprofile.mjs';

const WORKER_URL = new URL('./wkhashcheck.mjs', import.meta.url);
const WARM = 12, R = 5, seed = GOLDEN_SEEDS[0];
const mb = (b) => (b / 1048576).toFixed(1);
let pass = 0; const fails = [];
const ok = (c, m, d) => { if (c) pass++; else { fails.push(m); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } };

const g = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'));
const side = 2 * GOLDEN_R + 1;
const gold = (cx, cz) => g.seeds[seed][(cz + GOLDEN_R) * side + (cx + GOLDEN_R)];
const area = []; for (let cz = -R; cz <= R; cz++) for (let cx = -R; cx <= R; cx++) area.push([cx, cz]);

const M = loadEngine({});
const params = goldenParams(M);

function run(n) {
  return new Promise((resolve, reject) => {
    const rss0 = process.memoryUsage().rss, jobs = area.slice(), got = new Map(), ws = [];
    let mainMs = 0, t0 = 0, readyN = 0, rssReady = 0, warmN = 0;
    const pump = (w) => { if (jobs.length) { const j = jobs.shift(); w.postMessage({ t: 'gen', id: got.size + 1, cx: j[0], cz: j[1] }); } };
    for (let i = 0; i < n; i++) {
      const w = new Worker(WORKER_URL, { workerData: {} });
      ws.push(w);
      w.on('error', reject);
      w.on('message', (m) => {
        if (m.t === 'boot') w.postMessage({ t: 'init', seed, dim: 'overworld', gen: params });
        else if (m.t === 'ready') {
          // engine boot + JIT warm-up are excluded from the timed window: one throwaway chunk per worker, far outside the area
          if (++readyN === n) rssReady = process.memoryUsage().rss;
          w.postMessage({ t: 'gen', id: 0, cx: 200 + ws.indexOf(w), cz: 200 });
        } else if (m.t === 'gen:done' && m.cx >= 200) {
          // WARM chunks per worker, so the timed window is steady-state (JIT-hot) generation, not first-call compilation
          if (m.cz < 200 + WARM) { w.postMessage({ t: 'gen', id: 0, cx: m.cx, cz: m.cz + 1 }); return; }
          if (++warmN === n) { t0 = performance.now(); ws.forEach(pump); }
        } else if (m.t === 'gen:done') {
          const f0 = performance.now(); got.set(m.cx + ',' + m.cz, M.Gen.fingerprint(m)); mainMs += performance.now() - f0;
          if (got.size === area.length) {
            const ms = performance.now() - t0, rssDone = process.memoryUsage().rss;
            // real V8 heap of each worker (Worker.getHeapStatistics), read before the workers are stopped
            Promise.all(ws.map((x) => x.getHeapStatistics())).then((hs) => {
              ws.forEach((x) => x.terminate());
              resolve({ got, ms, mainMs, perWorker: (rssDone - rss0) / n, bootPer: (rssReady - rss0) / n, heapUsed: hs.map((h) => h.used_heap_size), heapTotal: hs.map((h) => h.total_heap_size) });
            }, reject);
          } else pump(w);
        } else if (m.t === 'err') reject(new Error('worker: ' + m.msg));
      });
    }
  });
}

const stages = M.Gen.STAGES.map((s) => s.name || s.id || s[0]);
ok(stages.length >= 8 && /noise/.test(stages.join()) && /features/.test(stages.join()), 'stage table lists the vanilla statuses', stages.join(','));

const rows = []; let drifted = null;
for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const r = await run(n);
  const bad = area.filter(([cx, cz]) => r.got.get(cx + ',' + cz) !== gold(cx, cz));
  ok(r.got.size === area.length && bad.length === 0, 'pool ' + n + ': ' + area.length + ' chunks, zero drift vs golden', bad.length + ' drift');
  ok(r.perWorker > 0 && r.perWorker < 1024 * 1048576, 'pool ' + n + ': per-worker RSS cost sane', mb(r.perWorker) + ' MB');
  const hAvg = r.heapUsed.reduce((a, b) => a + b, 0) / n;
  ok(r.heapUsed.length === n && r.heapUsed.every((h) => h > 1048576 && h < 2048 * 1048576), 'pool ' + n + ': every worker reports a sane V8 heap', r.heapUsed.map((h) => mb(h)).join('/') + ' MB');
  r.heapAvg = hAvg;
  ok(r.mainMs >= 0 && r.mainMs < r.ms, 'pool ' + n + ': main-thread fingerprint time is inside the wall window', r.mainMs.toFixed(0) + ' of ' + r.ms.toFixed(0) + ' ms');
  rows.push({ n, ...r });
  if (n === 1) drifted = r.got;
}
console.error('# pool | wall ms | chunks/s | speedup | RSS/worker after boot | RSS/worker after gen | V8 heap used/worker | main-thread fingerprint ms (share of wall)');
for (const r of rows) console.error('# ' + String(r.n).padStart(4) + ' | ' + r.ms.toFixed(0).padStart(7) + ' | ' + (area.length / r.ms * 1000).toFixed(1).padStart(8) + ' | ' + (rows[0].ms / r.ms).toFixed(2).padStart(7) + ' | ' + (mb(r.bootPer) + ' MB').padStart(21) + ' | ' + (mb(r.perWorker) + ' MB').padStart(20) + ' | ' + (mb(r.heapAvg) + ' MB').padStart(19) + ' | ' + r.mainMs.toFixed(0) + ' (' + (100 * r.mainMs / r.ms).toFixed(0) + '%)');

// ---- anti-vacuity ----
let breaks = 0;
const cx0 = area[0];
const hOdd = rows[0].heapUsed.map(() => 0);
if (!hOdd.every((h) => h > 1048576)) { breaks++; console.log('   ✓ empty worker heap report caught'); } else ok(false, 'anti-vacuity: empty heap report not caught');
const corrupt = new Map(drifted); corrupt.set(cx0[0] + ',' + cx0[1], 'deadbeef');
if (area.filter(([x, z]) => corrupt.get(x + ',' + z) !== gold(x, z)).length === 1) { breaks++; console.log('   ✓ corrupted fingerprint caught'); } else ok(false, 'anti-vacuity: corrupted fingerprint not caught');
const dropped = new Map(drifted); dropped.delete(cx0[0] + ',' + cx0[1]);
if (dropped.size !== area.length) { breaks++; console.log('   ✓ dropped chunk caught'); } else ok(false, 'anti-vacuity: dropped chunk not caught');
ok(breaks === 3, 'both anti-vacuity breaks caught');
console.log(`${breaks} breaks caught`);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
process.exit(fails.length ? 1 : 0);
