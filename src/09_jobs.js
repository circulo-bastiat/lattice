// 09_jobs.js — worker pool and the message protocol (docs/archive/ARCH.md §7, D-11..D-13, D-36..D-42).
// Main thread only.

(function (NS) {
  'use strict';

  var J = NS.Jobs = {
    mode: 'none',        // 'workers' | 'inline' | 'none'
    workers: [],
    urls: [],
    nextId: 1,
    inflight: new Map(), // id -> {resolve, kind}
    queue: [],
    failReason: '',
    meshOpts: null,
    cancelled: 0
  };

  /**
   * start(seed, genParams) -> Promise<'workers'|'inline'>
   * Creates workers from a Blob URL (D-11) and requires a `ready` handshake within
   * CFG.WORKER_HANDSHAKE_MS. Any failure downgrades to inline mode — the game must still run (D-12).
   */
  J.start = function (seed, genParams, meshOpts) {
    // The pool size is the SETTING's, clamped by what the machine actually has (D-36, D-84,
    // D-428). ⚠ The clamp is `ENV.workersMax` (the machine's thread count) and NOT `ENV.workers`
    // (the recommendation, capped at 4) — using the recommendation as the ceiling is what made
    // the setting unraisable past 4 on every machine.
    var n = J.clampSize((NS.Settings && NS.Settings.workers) || NS.ENV.workers);
    J.target = n;
    J.meshOpts = meshOpts || null;
    J.seed = seed; J.genParams = genParams;
    if (!NS.ENV.hasWorker || !NS.ENV.hasBlobURL || !NS.WORKER_SRC || !NS.WORKER_SRC.CHUNK) {
      J.failReason = 'Worker or Blob URL unavailable';
      return J._inline(seed, genParams);
    }
    var blob, url;
    try {
      blob = new Blob([NS.WORKER_SRC.CHUNK], { type: 'text/javascript' });
      url = URL.createObjectURL(blob);
    } catch (e) {
      J.failReason = 'Blob URL creation failed: ' + e.message;
      return J._inline(seed, genParams);
    }

    var pending = [];
    for (var i = 0; i < n; i++) pending.push(J._spawn(url, seed, genParams, meshOpts));

    return Promise.all(pending).then(function (ok) {
      for (var k = 0; k < ok.length; k++) {
        if (!ok[k]) {
          J.failReason = 'worker handshake timeout';
          J.stop();
          return J._inline(seed, genParams);
        }
      }
      J.urls.push(url);
      J.mode = 'workers';
      J._reconcile();
      return 'workers';
    });
  };

  /** 1 .. the machine's thread count. The one place the pool size is bounded (D-428). */
  J.clampSize = function (n) {
    var max = (NS.ENV && NS.ENV.workersMax) || 4;
    n = n | 0;
    if (!(n > 0)) n = (NS.ENV && NS.ENV.workers) || 1;
    return Math.max(1, Math.min(max, n));
  };

  /**
   * resize(n) -> Promise<int> — grow or shrink the LIVE pool, D-428.
   *
   * ⚠⚠ **SHRINKING DOES NOT TERMINATE A WORKER THAT IS BUSY.** `09_jobs.js` said, for forty
   * sessions, that the pool was fixed at start-up because "respawning workers mid-game would
   * drop every job in flight" — and it would have: `J.inflight` maps a job id to the promise
   * waiting for it, and terminating its worker leaves that promise pending FOR EVER, which is a
   * chunk that never generates and never says why. So a worker being dropped is RETIRED instead:
   * `_pick` stops handing it work, and `_onMessage` terminates it the moment its last result
   * comes back. Nothing in flight is lost and nothing has to be re-requested.
   * ⚠ Growing is the easy direction, but it still needs the handshake: a worker that never
   * answers `ready` is not added to the pool, exactly as at start-up.
   */
  // ⚠ ONE target. `J.target` is the pool size the caller asked for; `J.pending` counts spawns
  // still waiting for their handshake. Grow and shrink both work toward `target` against
  // `workers.length + pending`, so two drags in quick succession cannot each spawn the full
  // difference from a count that does not yet include the other's spawns (that overshot the cap).
  J.retiring = [];
  J.target = 0;
  J.pending = 0;
  J._fails = 0;
  J._settle = [];
  J.resize = function (n) {
    J.target = J.clampSize(n);
    J._fails = 0;
    if (J.mode !== 'workers') return Promise.resolve(J.workers.length);
    J._reconcile();
    return new Promise(function (resolve) { J._settle.push(resolve); J._flushSettle(); });
  };

  J._reconcile = function () {
    while (J.workers.length > J.target) {
      var by = J.workers.slice().sort(function (a, b) { return (a.load || 0) - (b.load || 0); });
      J._retire(by[0]);
    }
    var url = J.urls[0];
    if (!url) return;
    while (J.workers.length + J.pending < J.target) {
      J.pending++;
      J._spawn(url, J.seed, J.genParams, J.meshOpts, 5).then(function (ok) {
        J.pending--;
        // ⚠ A handshake that timed out on a loaded machine (many workers inflating the registry at once)
        // must not leave the pool short of its target for good: retry, but a bounded number of times.
        if (ok) { J._fails = 0; J._reconcile(); }
        else if (++J._fails <= 3) J._reconcile();
        J._flushSettle();
      });
    }
  };

  J._retire = function (w) {
    var at = J.workers.indexOf(w);
    if (at >= 0) J.workers.splice(at, 1);
    if (w.load > 0) J.retiring.push(w);
    else { try { w.terminate(); } catch (e) {} }
  };

  J._release = function (w) {
    w.load--;
    if (w.load > 0) return;
    var r = J.retiring.indexOf(w);
    if (r >= 0) { J.retiring.splice(r, 1); try { w.terminate(); } catch (e) {} }
  };

  J._flushSettle = function () {
    if (J.pending || J.workers.length !== J.target || !J._settle.length) return;
    var q = J._settle; J._settle = [];
    for (var i = 0; i < q.length; i++) q[i](J.workers.length);
  };

  // `slack` multiplies the handshake time: a live resize spawns next to retiring workers that are
  // still finishing jobs, so a fresh worker's init competes for cores and 2 s is too tight.
  J._spawn = function (url, seed, genParams, meshOpts, slack) {
    return new Promise(function (resolve) {
      var w, done = false;
      try { w = new Worker(url); }
      catch (e) { J.failReason = 'new Worker failed: ' + e.message; resolve(false); return; }

      var timer = setTimeout(function () {
        if (!done) { done = true; try { w.terminate(); } catch (e) {} resolve(false); }
      }, NS.CFG.WORKER_HANDSHAKE_MS * (slack || 1));

      w.onmessage = function (ev) {
        var m = ev.data;
        if (m && m.t === 'ready' && !done) {
          done = true; clearTimeout(timer);
          w.onmessage = J._onMessage;
          J.workers.push(w);
          resolve(true);
          return;
        }
        J._onMessage(ev);
      };
      w.onerror = function (e) {
        if (!done) { done = true; clearTimeout(timer); J.failReason = 'worker error: ' + e.message; resolve(false); }
      };
      // ⚠ The registry travels here, as the two PACKED blobs rather than as decoded typed
      // arrays. 334 KB of bytes structured-clone in microseconds; the twelve typed arrays
      // they decode into are 2.3 MB and would be copied per worker. Each worker inflates
      // and decodes on its OWN thread, in parallel, at ~70 ms — off the main thread, which
      // is the entire point of having workers.
      w.postMessage({
        t: 'init', seed: seed, dim: NS.World ? NS.World.dimension : 'overworld', gen: genParams, mesh: meshOpts || null,
        reg: (NS.DATA && !NS.Reg.ready) ? null : (NS.DATA ? {
          runtime: NS.DATA.runtime, runtimeBytes: NS.DATA.runtimeBytes,
          geometry: NS.DATA.geometry, geometryBytes: NS.DATA.geometryBytes,
          // The per-atlas-layer alpha class. The worker needs it because the MESHER decides
          // which of the three passes a quad lands in, and that decision is now derived from
          // the texture rather than hand-written per block. 768 bytes.
          tileAlpha: NS.DATA.tileAlpha,
          // G4's per-block friction/speed/jump exception table (D-250). 200 bytes, and a worker
          // without it runs a world where ice is not slippery and says nothing.
          physics: NS.DATA.physics,
          // #1159 (KW-48c): the per-block tables `Reg.init` hands to `States.build`. A worker given none of
          // them ran with canOcclude = 1 and outlineFull = 255 for EVERY block, so `visOpaque` (the
          // section-visibility flood's occluder test) read glass, leaves, ice... as full walls: the worker's
          // vis masks cut the flood at every see-through block and whole sections behind them were never
          // drawn. Same tables as the main thread, or the same section meshes differently on each.
          supportRule: NS.DATA.supportRule, solidMaterial: NS.DATA.solidMaterial,
          groundRule: NS.DATA.groundRule, iceMaterial: NS.DATA.iceMaterial,
          canOcclude: NS.DATA.canOcclude, outlineFull: NS.DATA.outlineFull,
          igniteOdds: NS.DATA.igniteOdds, burnOdds: NS.DATA.burnOdds,
          sidedLight: NS.DATA.sidedLight, luminance: NS.DATA.luminance,
          // the vanilla worldgen registries (PLAN W1) — 39 KB, decoded per worker
          worldgen: NS.DATA.worldgen, worldgenBytes: NS.DATA.worldgenBytes,
          // the 866 structure templates (PLAN W15) — 139 KB, decoded per worker. A worker
          // without them generates a world with the villages missing and does not say so.
          templates: NS.DATA.templates, templatesBytes: NS.DATA.templatesBytes,
          // W4's climate parameter table and W5's two colour ramps. Both are needed IN THE
          // WORKER, not just on the main thread: the chunk generator asks which biome a column
          // is (W4) and the surface rules ask what that biome's rules are (W5/W6). A worker
          // without them generates a world made of stone and does not say so.
          biomeParams: NS.DATA.biomeParams, biomeParamsBytes: NS.DATA.biomeParamsBytes,
          colormaps: NS.DATA.colormaps, colormapsBytes: NS.DATA.colormapsBytes
        } : null)
      });
    });
  };

  /** Same job functions, run on the main thread in time-sliced batches (D-12, D-38). */
  J._inline = function (seed, genParams) {
    NS.Gen.init(seed, genParams);
    if (J.meshOpts) NS.Mesher.setOptions(J.meshOpts);
    J.mode = 'inline';
    return Promise.resolve('inline');
  };

  /**
   * Push new mesh detail options to every worker (and to this thread, for inline mode). The
   * caller must follow with World.remeshAll(): sections already on the GPU were built with the
   * old settings and nothing else invalidates them. Cheap enough to call from a menu click.
   */
  J.setMeshOptions = function (o) {
    J.meshOpts = o;
    NS.Mesher.setOptions(o);
    for (var i = 0; i < J.workers.length; i++) {
      try { J.workers[i].postMessage({ t: 'opt', mesh: o }); } catch (e) {}
    }
  };

  /**
   * Route a worker result to the promise that is waiting for it. Results for cancelled or
   * evicted jobs are dropped here rather than at the call site, so the caller never has to
   * think about a chunk that stopped existing while it was in flight.
   */
  J._onMessage = function (ev) {
    var m = ev.data;
    if (!m) return;
    var e = J.inflight.get(m.id);
    if (m.t === 'ready') return;
    if (!e) return;
    J.inflight.delete(m.id);
    // D-428: a RETIRED worker is terminated by its own last result, not by the resize call.
    if (e.w) J._release(e.w);
    switch (m.t) {
      case 'gen:done':  e.resolve({ sec: m.sec, hmap: m.hmap, biome: m.biome || null, spawners: m.spawners || null, entities: m.entities || null }); break;
      case 'mesh:done': e.resolve({ buf: m.mesh || null, vis: (m.vis === undefined ? 0x7FFF : m.vis) | 0 }); break;
      case 'err':       e.reject(new Error(m.msg || 'worker error')); break;
      default:          e.resolve(null);
    }
  };

  /** Least-loaded worker. With a pool of 1-4 this beats round-robin whenever jobs differ in cost. */
  J._pick = function () {
    var best = null;
    for (var i = 0; i < J.workers.length; i++) {
      var w = J.workers[i];
      if (w.load === undefined) w.load = 0;
      if (!best || w.load < best.load) best = w;
    }
    return best;
  };

  J._post = function (msg, kind, release) {
    msg.id = J.lastId = J.nextId++;
    return new Promise(function (resolve, reject) {
      if (J.mode === 'workers') {
        var w = J._pick();
        if (!w) { if (release) release(msg.snap); resolve(null); return; }
        w.load = (w.load || 0) + 1;
        J.inflight.set(msg.id, { resolve: resolve, reject: reject, kind: kind, w: w });
        w.postMessage(msg);
        // postMessage structured-clones synchronously, so the snapshot is free again right here.
        if (release) release(msg.snap);
      } else if (J.mode === 'inline') {
        J.queue.push({ msg: msg, resolve: resolve, reject: reject, kind: kind, release: release });
      } else {
        if (release) release(msg.snap);
        resolve(null);
      }
    });
  };

  /** requestGen(cx,cz) -> Promise<{sec,hmap,biome}> */
  J.requestGen = function (cx, cz) {
    return J._post({ t: 'gen', cx: cx, cz: cz }, 'gen');
  };

  /**
   * requestMesh(cx,cz,sy,snap,release) -> Promise<{buf:ArrayBuffer|null, vis:int}>
   *
   * `release` (optional) is called the moment the snapshot's 27 section copies are no longer
   * needed, so World can put them back in its pool (D-88). In worker mode that is immediately
   * after postMessage — structured clone is synchronous — and in inline mode it is after the
   * job body has run.
   */
  J.requestMesh = function (cx, cz, sy, snap, release) {
    return J._post({ t: 'mesh', cx: cx, cz: cz, sy: sy, snap: snap }, 'mesh', release);
  };

  /** The id most recently handed out by _post. World records it so it can cancel the job. */
  J.lastId = 0;

  /**
   * Inline mode (D-12): the same job bodies the worker runs, executed on the main thread in a
   * time-sliced batch. Called once per frame by World.stream with a microsecond budget, so a
   * machine with no workers gets a slow world instead of no world.
   */
  J.pump = function (budgetMicros) {
    if (J.mode !== 'inline' || !J.queue.length) return false;
    var t0 = NS.U.now(), budget = (budgetMicros || 1000) / 1000;
    while (J.queue.length && (NS.U.now() - t0) < budget) {
      var job = J.queue.shift();
      try {
        if (job.msg.t === 'gen') {
          var col = NS.Gen.genColumn(job.msg.cx, job.msg.cz);
          job.resolve({ sec: col.sec, hmap: col.hmap, biome: col.biome || null, spawners: col.spawners || null, entities: col.entities || null, nests: col.nests || null });
        } else if (job.msg.t === 'mesh') {
          // same world-space origin the worker path passes — see chunk.worker.js
          var mb = NS.Mesher.mesh(job.msg.snap, null, job.msg.cx * 16,
                                  job.msg.sy * 16 + NS.CFG.WORLD_MIN_Y, job.msg.cz * 16);
          if (job.release) job.release(job.msg.snap);
          job.resolve({ buf: mb, vis: NS.Mesher.lastVis });
        } else {
          job.resolve(null);
        }
      } catch (err) {
        if (job.release) { try { job.release(job.msg.snap); } catch (e2) {} }
        job.reject(err);
      }
    }
    return J.queue.length > 0;
  };

  /** Advisory: the result is simply dropped when it arrives (docs/archive/ARCH.md §7). */
  J.cancel = function (id) {
    J.cancelled++;
    var e = J.inflight.get(id);
    if (e) { J.inflight.delete(id); if (e.w) J._release(e.w); e.resolve(null); }
    for (var i = 0; i < J.queue.length; i++) {
      if (J.queue[i].msg.id === id) {
        var j = J.queue.splice(i, 1)[0];
        if (j.release) j.release(j.msg.snap);
        j.resolve(null);
        break;
      }
    }
  };

  J.stats = function () {
    return { mode: J.mode, workers: J.workers.length, target: J.target, pending: J.pending, retiring: J.retiring.length,
             inflight: J.inflight.size, queued: J.queue.length };
  };

  J.stop = function () {
    for (var r = 0; r < J.retiring.length; r++) { try { J.retiring[r].terminate(); } catch (e) {} }
    J.retiring.length = 0;
    for (var i = 0; i < J.workers.length; i++) { try { J.workers[i].terminate(); } catch (e) {} }
    for (var k = 0; k < J.urls.length; k++) { try { URL.revokeObjectURL(J.urls[k]); } catch (e) {} }
    J.workers.length = 0;
    J.urls.length = 0;
  };
})(MCL);
