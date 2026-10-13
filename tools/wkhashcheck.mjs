#!/usr/bin/env node
// wkhashcheck.mjs — #1900 C2ME-2 DETERMINISM GATE: a threaded world is byte-identical to the single-thread golden.
//
// The REAL worker (src/workers/chunk.worker.js, the same code the Blob URL runs) is hosted in node worker_threads.
// Chunks are generated at pool 1/2/4/8, dispatched in a shuffled order, DELIVERED in another shuffled order
// (forced out-of-order), and once with a worker killed mid-region and its jobs restarted on a fresh one.
// Each chunk is fingerprinted ON ARRIVAL (the ?wkhash=1 install hook's moment, before anything can tick) with the
// ENGINE'S OWN NS.Gen.fingerprint, and compared to tools/golden/chunkgen-golden.json (made inline by C2ME-1).
// Zero drift allowed; any drift names the exact chunk.
//
// Which stage reaches into neighbours today (the safe delivery radius follows from it):
//   carvers      CV.RANGE = 8   source chunks within 8 are re-walked for the target (04i_carvers.js)
//   features     F.RANGE  = 1   the 3x3 of source chunks is re-run for the target (04j_features.js)
//   structures   starts/references up to 8 (set.reach, 04r_structures.js), recomputed, never read from a neighbour
// None of that READS a generated neighbour: genColumn(cx,cz) is a pure function of (seed,cx,cz) (D-61), so the
// safe delivery radius is 0 -- a chunk is complete the moment its own job ends. This check is what keeps that true:
// the day a stage starts depending on a neighbour's output, a chunk delivered early drifts here.
//
// Anti-vacuity: a worker patched to ship ONE chunk one stage early (features skipped) must report drift on
// exactly that chunk; the engine fingerprint must equal the tools hashColumn; corrupted/shuffled data is caught.
//
// WKHASH_FULL=1 -> the whole 21x21 of every golden seed (full suite); default -> a 7x7 core area of seed 1337.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, WORKER_FILES, SRC } from './loadsrc.mjs';
import { GOLDEN_FILE, GOLDEN_SEEDS, GOLDEN_R, hashColumn, goldenParams } from './chunkgenprofile.mjs';

const text = (f) => readFileSync(join(SRC, f), 'utf8');
const FEATURES_CALL = 'NS.Features.applyChunk(SB, cx, cz, cH, sea);';

if (!isMainThread) {
  // ---- worker side: the real chunk.worker.js with a `self` bridge ----
  const skip = workerData.skipFeaturesAt;     // anti-vacuity only: [cx, cz] shipped without its features
  const files = WORKER_FILES.map((f) => {
    let s = text(f);
    if (skip && f === '04_worldgen.js') {
      if (!s.includes(FEATURES_CALL)) throw new Error('wkhashcheck: patch target moved');
      s = s.replace(FEATURES_CALL, 'if (!(cx === ' + skip[0] + ' && cz === ' + skip[1] + ')) ' + FEATURES_CALL);
    }
    return s;
  });
  const self = { onmessage: null, postMessage: (m, x) => parentPort.postMessage(m, x) };
  const MCL = new Function('self', "'use strict';\n" + files.join('\n') + '\n' + text('workers/chunk.worker.js') + '\nreturn MCL;')(self);
  initRegistry(MCL);   // the pool decodes the registry from a blob; here it is read from assets/ (same data)
  parentPort.on('message', (m) => self.onmessage({ data: m }));
  parentPort.postMessage({ t: 'boot' });
} else {
  await main();
}

// ---- main side ----
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function shuffle(a, r) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/** gen `list` ([cx,cz]...) on `n` real workers; returns Map "cx,cz" -> fingerprint, in DELIVERY order. */
function runPool(M, seed, n, list, o) {
  o = o || {};
  const r = rng(o.rng || 1);
  const jobs = shuffle(list, r);                       // dispatch order is not the golden's row-major order
  const out = new Map(), arrived = [];
  const params = goldenParams(M);
  return new Promise((resolve, reject) => {
    let nextId = 1, killed = false;
    const workers = [], busy = new Map();              // worker -> job
    const spawn = () => {
      const w = new Worker(new URL(import.meta.url), { workerData: { skipFeaturesAt: o.skipFeaturesAt } });
      w.ready = false;
      w.on('error', reject);
      w.on('message', (m) => {
        if (m.t === 'boot') { w.postMessage({ t: 'init', seed, dim: 'overworld', gen: params }); return; }
        if (m.t === 'ready') { w.ready = true; pump(); return; }
        if (m.t === 'err') { reject(new Error('worker: ' + m.msg)); return; }
        if (m.t !== 'gen:done') return;
        busy.delete(w);
        arrived.push(m);
        if (o.killAfter && !killed && arrived.length >= o.killAfter) {
          killed = true;                               // kill a worker mid-job; its job goes back on the queue for a new one
          const victim = workers.find((x) => busy.has(x));
          if (victim) { const job = busy.get(victim); busy.delete(victim); jobs.unshift(job); victim.terminate(); workers.splice(workers.indexOf(victim), 1); workers.push(spawn()); }
        }
        if (arrived.length + 0 >= list.length + 0 && !busy.size && !jobs.length) finish(); else pump();
      });
      return w;
    };
    const pump = () => {
      for (const w of workers) if (w.ready && !busy.has(w) && jobs.length) { const j = jobs.shift(); busy.set(w, j); w.postMessage({ t: 'gen', id: nextId++, cx: j[0], cz: j[1] }); }
    };
    const finish = () => {
      // forced out-of-order DELIVERY: process the arrivals in a different random order than they landed
      const seen = new Set();
      for (const m of shuffle(arrived, r)) {
        const k = m.cx + ',' + m.cz;
        if (seen.has(k)) continue;                     // a killed worker's job may have finished twice: first copy wins, both are checked below
        seen.add(k);
        out.set(k, M.Gen.fingerprint(m));              // the install-time fingerprint (what ?wkhash=1 records)
      }
      for (const w of workers) w.terminate();
      resolve(out);
    };
    for (let i = 0; i < n; i++) workers.push(spawn());
  });
}

async function main() {
  let pass = 0; const fails = [];
  const ok = (c, m, d) => { if (c) pass++; else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } };
  const okAv = (c, m, d) => { if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m + (d !== undefined ? ' (' + d + ')' : '')); console.log('   x ' + m + (d !== undefined ? '   ' + d : '')); } };

  const g = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'));
  const M = loadEngine({});
  const full = process.env.WKHASH_FULL === '1';
  const R = full ? GOLDEN_R : 3;
  const seeds = full ? GOLDEN_SEEDS : [GOLDEN_SEEDS[0]];
  const pools = full ? [1, 2, 4, 8] : [1, 2, 4, 8];
  const side = 2 * GOLDEN_R + 1;
  const gold = (s, cx, cz) => g.seeds[s][(cz + GOLDEN_R) * side + (cx + GOLDEN_R)];
  const area = []; for (let cz = -R; cz <= R; cz++) for (let cx = -R; cx <= R; cx++) area.push([cx, cz]);
  const drift = (got, s) => { const d = []; for (const [cx, cz] of area) if (got.get(cx + ',' + cz) !== gold(s, cx, cz)) d.push(cx + ',' + cz + ' got ' + got.get(cx + ',' + cz) + ' want ' + gold(s, cx, cz)); return d; };

  // the engine fingerprint (what ?wkhash=1 records) IS the tools hash the golden was written with
  M.Gen.init(GOLDEN_SEEDS[0], goldenParams(M));
  const probe = M.Gen.genColumn(2, -3);
  ok(M.Gen.fingerprint(probe) === hashColumn(probe) && M.Gen.fingerprint(probe) === gold(GOLDEN_SEEDS[0], 2, -3), 'engine NS.Gen.fingerprint == tools hashColumn == golden entry');

  for (const s of seeds) {
    for (const n of pools) {
      const t0 = Date.now();
      const got = await runPool(M, s, n, area, { rng: n * 7 + 1 });
      const d = drift(got, s);
      d.slice(0, 3).forEach((x) => console.log('DRIFT seed ' + s + ' pool ' + n + ' chunk ' + x));
      ok(got.size === area.length && d.length === 0, 'seed ' + s + ' pool ' + n + ': ' + area.length + ' chunks, shuffled dispatch + shuffled delivery, zero drift vs inline golden', d.length + ' drift, ' + got.size + ' chunks');
      console.log('   seed ' + s + ' pool ' + n + ' ' + (Date.now() - t0) + ' ms');
    }
    const t0 = Date.now();
    const got = await runPool(M, s, 4, area, { rng: 99, killAfter: Math.min(10, area.length >> 1) });
    const d = drift(got, s);
    ok(got.size === area.length && d.length === 0, 'seed ' + s + ': a worker killed and restarted mid-region still yields zero drift', d.length + ' drift, ' + got.size + ' chunks');
    console.log('   kill/restart ' + (Date.now() - t0) + ' ms');
  }

  // --- anti-vacuity: a worker that ships (3,-2) one stage (features) too early must show drift on exactly that chunk ---
  const s0 = GOLDEN_SEEDS[0], bad = [3, -2];
  const early = await runPool(M, s0, 2, area, { rng: 5, skipFeaturesAt: bad });
  const dd = drift(early, s0);
  okAv(dd.length === 1 && dd[0].startsWith(bad[0] + ',' + bad[1] + ' '), 'a worker shipping chunk (3,-2) one stage too early is reported, as exactly that chunk', dd.length + ' drifted: ' + dd.map((x) => x.split(' ')[0]).join(' '));
  // a delivery that DROPS a chunk and one that duplicates another's data are drift too
  const lost = new Map(early); lost.delete('0,0');
  okAv(drift(lost, s0).some((x) => x.startsWith('0,0 ')), 'a missing chunk is reported');
  const swapped = new Map(early); swapped.set('1,1', early.get('1,2'));
  okAv(drift(swapped, s0).some((x) => x.startsWith('1,1 ')), 'two chunks\' data swapped on delivery is reported');
  const col = M.Gen.genColumn(1, 1); col.sec.find((x) => x.u < 0).d[0] ^= 1;
  okAv(M.Gen.fingerprint(col) !== gold(s0, 1, 1), 'one flipped block in a delivered chunk changes the install fingerprint');

  console.log(` assertions passed .. ${pass}`);
  console.log(` failures ........... ${fails.length}`);
  for (const f of fails) console.log('   ✗ ' + f);
  process.exit(fails.length ? 1 : 0);
}
