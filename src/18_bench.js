// 18_bench.js — the in-game benchmark (docs/archive/ARCH.md §17, D-92). Main thread only.
//
// WHY THIS EXISTS
// Every performance change in this project is now judged against this, and only against this.
// "It feels smoother" is not a measurement; a fixed seed, a fixed path and a p99 frame time are.
// The report deliberately leads with p95/p99 rather than average fps, because the thing that
// ruins a 2200G is not the mean — it is the one frame in fifty that takes 90 ms while a ring of
// chunks uploads.
//
// The run is reproducible by construction:
//   * seed is forced to Bench.SEED and the world is rebuilt, so terrain is identical every time
//   * the camera follows a closed analytic path (no player input, no physics, no randomness)
//   * the path is walked at a FIXED simulated speed against real elapsed time, so a slow machine
//     covers the same ground as a fast one and the two reports describe the same scene
//   * a warm-up lap is discarded, so the numbers are steady-state and not "loading the world"
//
// It runs from the pause menu, from F10, and from MCL.Bench.start() in the console — which is
// how tools/bench.mjs drives it headlessly over CDP.

(function (NS) {
  'use strict';

  var B = NS.Bench = {
    SEED: 1337,
    running: false,
    phase: '',            // 'settle' | 'warm' | 'measure' | ''
    t0: 0,
    lapT: 0,              // seconds along the path
    lap: 0,
    report: null,
    onDone: null,
    label: '',

    // Path: a closed circuit centred on the spawn column, flown at a constant speed with the
    // camera looking along the direction of travel and panning up and down. Radius and height
    // are chosen so the run sees sky, terrain, a horizon full of fog and — at the low point —
    // the inside of the terrain, which is where occlusion culling either pays or does not.
    RADIUS: 72,
    HEIGHT: 78,
    BOB: 22,
    SPEED: 24,            // blocks/second along the circle — faster than flying, on purpose:
                          // outrunning the streamer is the case that stutters
    LAPS_WARM: 1,
    LAPS_MEASURE: 2,
    SETTLE_S: 3.0,        // stand still first and let the streamer catch up
    MAX_S: 240,           // hard stop, so a broken run cannot hang the page forever
    phaseT: 0
  };

  var frames = null, n = 0, CAP = 20000;
  var sumTris = 0, sumDraws = 0, sumDrawn = 0, sumCulled = 0, sumOccl = 0, sumVisited = 0, sumBinds = 0;
  var peakChunks = 0, peakMeshes = 0, peakBytes = 0, stalls = 0, longest = 0;
  var savedState = null;

  /**
   * start(opts) -> Promise-ish. opts:
   *   preset  apply this quality preset first (so a headless run can sweep all four)
   *   laps    override LAPS_MEASURE
   *   label   a string carried into the report
   *   keep    true to leave the world alone instead of reseeding it
   *   laps/warm/settle/speed/radius   shorten the run (tools/bench.mjs does, so a headless
   *           sweep of all four presets finishes inside a test timeout)
   *   occlusion  force the visibility graph on or off, for an A/B against the same path
   */
  B.start = function (opts) {
    opts = opts || {};
    if (B.running) return false;
    if (!NS.Main || !NS.Main.ready) return false;

    if (opts.preset && NS.Settings.PRESETS[opts.preset]) {
      NS.Settings.applyPreset(opts.preset, { save: false });
    }
    if (opts.laps)   B.LAPS_MEASURE = opts.laps | 0;
    if (opts.warm !== undefined)   B.LAPS_WARM = opts.warm | 0;
    if (opts.settle !== undefined) B.SETTLE_S = +opts.settle;
    if (opts.speed)  B.SPEED = +opts.speed;
    if (opts.radius) B.RADIUS = +opts.radius;
    if (opts.occlusion !== undefined) { NS.Settings.occlusion = !!opts.occlusion; NS.Settings.push({}); }
    B.label = opts.label || (NS.Settings.preset + '/' + NS.Gfx.name);

    var P = NS.Player;
    savedState = {
      x: P.x, y: P.y, z: P.z, yaw: P.yaw, pitch: P.pitch,
      flying: P.flying, noclip: P.noclip, mode: P.mode,
      adaptive: NS.Settings.adaptive
    };
    // Adaptive render distance would change the workload halfway through the run, which is the
    // one thing a benchmark must not allow (D-46 is a feature; here it is a confound).
    NS.Settings.adaptive = false;

    if (!opts.keep) {
      // Same seed, same world, every time. Dropping the chunks rather than only the meshes is
      // what makes a run measure generation as well as drawing.
      NS.World.init(B.SEED);
      NS.Gen.init(B.SEED, NS.Gen.defaults());
      NS.Gfx.dropAll();
    }

    if (NS.Gamemode) NS.Gamemode.set(P, NS.Gamemode.CREATIVE);
    P.flying = true; P.noclip = true;
    frames = frames || new Float32Array(CAP);
    n = 0;
    sumTris = sumDraws = sumDrawn = sumCulled = sumOccl = sumVisited = sumBinds = 0;
    peakChunks = peakMeshes = peakBytes = stalls = longest = 0;
    B.lapT = 0; B.lap = 0;
    B.report = null;
    B.running = true;
    B.phase = 'settle';
    B.t0 = NS.U.now();
    B.phaseT = 0;
    B.place(0);
    if (NS.Hud) { NS.Hud.benchReport = null; NS.Hud.close(); NS.Hud.say('benchmark: ' + B.label + '  (Esc to abort)'); }
    return true;
  };

  B.abort = function () {
    if (!B.running) return;
    B.running = false;
    B.phase = '';
    B.restore();
    if (NS.Hud) NS.Hud.say('benchmark aborted');
  };

  B.restore = function () {
    if (!savedState) return;
    var P = NS.Player, s = savedState;
    P.x = s.x; P.y = s.y; P.z = s.z; P.yaw = s.yaw; P.pitch = s.pitch;
    P.px = P.x; P.py = P.y; P.pz = P.z;
    P.vx = P.vy = P.vz = 0;
    P.flying = s.flying; P.noclip = s.noclip;
    if (NS.Gamemode) NS.Gamemode.set(P, s.mode);
    P.noclip = s.noclip;
    NS.Settings.adaptive = s.adaptive;
    P.interpolate(0);
    savedState = null;
  };

  /** Put the camera at parameter t (seconds along the path). Pure function of t. */
  B.place = function (t) {
    var P = NS.Player;
    var circumference = 2 * Math.PI * B.RADIUS;
    var a = (t * B.SPEED / circumference) * Math.PI * 2;
    var cx = Math.cos(a) * B.RADIUS, cz = Math.sin(a) * B.RADIUS;
    P.x = cx; P.z = cz;
    P.y = B.HEIGHT + Math.sin(a * 2) * B.BOB;
    P.vx = P.vy = P.vz = 0;
    P.px = P.x; P.py = P.y; P.pz = P.z;
    // Look along the tangent, panning between +12° and -25° so the run spends real time looking
    // down into the terrain (where occlusion culling matters) and out at the fog wall (where
    // render distance and fill rate matter).
    P.yaw = Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI * 0.5;
    P.pitch = -0.11 + Math.sin(a * 3 + 1.0) * 0.22;
    P.interpolate(0);
  };

  B.lapSeconds = function () { return (2 * Math.PI * B.RADIUS) / B.SPEED; };

  /**
   * tick(dtMs) — called once per frame by Main.loop, AFTER the frame has been drawn, so the
   * sample it records is the frame the current camera position produced.
   */
  B.tick = function (dtMs) {
    if (!B.running) return;
    var G = NS.Gfx, W = NS.World;
    var elapsed = (NS.U.now() - B.t0) / 1000;
    if (elapsed > B.MAX_S) { B.finish('timed out'); return; }

    var lapS = B.lapSeconds();

    if (B.phase === 'settle') {
      B.phaseT += dtMs / 1000;
      if (B.phaseT >= B.SETTLE_S) { B.phase = 'warm'; B.lapT = 0; B.lap = 0; }
      B.place(0);
      return;
    }

    // Advance along the path by real elapsed time. A slow machine takes more wall-clock seconds
    // for the lap but sees exactly the same sequence of viewpoints.
    B.lapT += Math.min(0.1, dtMs / 1000);
    if (B.lapT >= lapS) { B.lapT -= lapS; B.lap++; }
    B.place(B.lapT + B.lap * lapS);

    if (B.phase === 'warm') {
      if (B.lap >= B.LAPS_WARM) { B.phase = 'measure'; B.lap = 0; B.lapT = 0; }
      return;
    }

    // --- measuring ----------------------------------------------------------
    if (n < CAP) frames[n++] = dtMs;
    if (dtMs > 33.4) stalls++;
    if (dtMs > longest) longest = dtMs;
    sumTris += G.tris; sumDraws += G.draws; sumDrawn += G.drawn; sumBinds += G.binds;
    sumCulled += G.culled; sumOccl += G.occluded; sumVisited += G.visited;
    if (W.chunks.size > peakChunks) peakChunks = W.chunks.size;
    if (G.meshes.size > peakMeshes) peakMeshes = G.meshes.size;

    if (B.lap >= B.LAPS_MEASURE) B.finish('complete');
  };

  function pct(sorted, p) {
    if (!sorted.length) return 0;
    var i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
    return sorted[i];
  }

  B.finish = function (why) {
    B.running = false;
    B.phase = '';
    var G = NS.Gfx, W = NS.World, S = NS.Settings;
    var ws = W.stats();
    var sorted = Array.prototype.slice.call(frames.subarray(0, n)).sort(function (a, b) { return a - b; });
    var sum = 0;
    for (var i = 0; i < n; i++) sum += frames[i];
    var mean = n ? sum / n : 0;
    var info = (G.backend && G.backend.info) ? G.backend.info() : {};

    var r = {
      label: B.label,
      why: why,
      version: NS.VERSION,
      seed: B.SEED,
      preset: S.preset,
      settings: S.describe(),
      backend: G.name,
      device: (info.renderer || info.vendor || '') + '',
      canvas: G.width + 'x' + G.height,

      frames: n,
      seconds: +(sum / 1000).toFixed(2),
      fps: n ? +(1000 / mean).toFixed(1) : 0,
      meanMs: +mean.toFixed(2),
      medianMs: +pct(sorted, 0.5).toFixed(2),
      p95Ms: +pct(sorted, 0.95).toFixed(2),
      p99Ms: +pct(sorted, 0.99).toFixed(2),
      maxMs: +longest.toFixed(2),
      stalls: stalls,
      stallPct: n ? +((stalls / n) * 100).toFixed(2) : 0,

      trisPerFrame: n ? Math.round(sumTris / n) : 0,
      drawsPerFrame: n ? Math.round(sumDraws / n) : 0,
      sectionsDrawn: n ? Math.round(sumDrawn / n) : 0,
      sectionsCulled: n ? Math.round(sumCulled / n) : 0,
      occludedPerFrame: n ? Math.round(sumOccl / n) : 0,
      floodVisited: n ? Math.round(sumVisited / n) : 0,

      chunks: peakChunks,
      meshes: peakMeshes,
      worldMB: +(ws.bytes / 1048576).toFixed(1),
      arenas: info.arenas || 0,
      arenaMB: info.arenaMB || 0,
      bindsPerFrame: n ? Math.round(sumBinds / n) : 0,
      generated: ws.generated,
      meshed: ws.meshed,
      evicted: ws.evicted,
      cancelled: ws.cancelled,
      snapReuse: ws.snapReuse,
      snapAlloc: ws.snapAlloc,
      jobs: NS.Jobs.mode + ' x' + (NS.Jobs.workers.length || 1)
    };
    try {
      var pm = performance.memory;
      if (pm) r.heapMB = +(pm.usedJSHeapSize / 1048576).toFixed(1);
    } catch (e) {}

    B.report = r;
    B.restore();
    if (typeof console !== 'undefined' && console.log) console.log('MC-Lite bench\n' + B.text(r));
    if (NS.Hud) {
      NS.Hud.benchReport = r;
      // A real modal screen, not a floating panel: the pointer is still locked at this point and
      // a click that did not land on a screen would break a block instead of dismissing this.
      NS.Hud.open('bench');
      NS.Hud.say('benchmark done — ' + r.fps + ' fps, p99 ' + r.p99Ms + ' ms');
    }
    if (B.onDone) { var f = B.onDone; B.onDone = null; f(r); }
    return r;
  };

  /** The report as fixed-width text — what the console, the HUD panel and PERF.md all show. */
  B.text = function (r) {
    r = r || B.report;
    if (!r) return 'no benchmark has been run';
    var L = [];
    var row = function (k, v) { L.push(('  ' + k + '                    ').slice(0, 22) + v); };
    L.push('MC-Lite ' + r.version + ' benchmark — ' + r.label + ' (' + r.why + ')');
    L.push('  ' + r.settings);
    L.push('  backend ' + r.backend + '  ' + r.canvas + '  ' + r.device);
    L.push('');
    row('fps (mean)', r.fps);
    row('frame mean', r.meanMs + ' ms');
    row('frame median', r.medianMs + ' ms');
    row('frame p95', r.p95Ms + ' ms');
    row('frame p99', r.p99Ms + ' ms');
    row('frame max', r.maxMs + ' ms');
    row('stalls >33ms', r.stalls + '  (' + r.stallPct + '% of ' + r.frames + ' frames)');
    L.push('');
    row('triangles/frame', r.trisPerFrame);
    row('draw calls/frame', r.drawsPerFrame);
    row('buffer binds/frame', r.bindsPerFrame);
    row('sections drawn', r.sectionsDrawn);
    row('sections culled', r.sectionsCulled + '  (' + r.occludedPerFrame + ' by occlusion)');
    row('flood visited', r.floodVisited);
    L.push('');
    row('chunks resident', r.chunks);
    row('section meshes', r.meshes);
    row('world data', r.worldMB + ' MB');
    row('vertex arenas', r.arenas + '  (' + r.arenaMB + ' MB)');
    if (r.heapMB) row('js heap', r.heapMB + ' MB');
    row('generated/meshed', r.generated + ' / ' + r.meshed);
    row('evicted/cancelled', r.evicted + ' / ' + r.cancelled);
    row('snapshot reuse', r.snapReuse + ' reused, ' + r.snapAlloc + ' allocated');
    row('workers', r.jobs);
    return L.join('\n');
  };

  /** Progress line for the HUD while a run is in flight. */
  B.status = function () {
    if (!B.running) return '';
    var total = B.LAPS_MEASURE;
    if (B.phase === 'settle') return 'benchmark: settling ' + (B.SETTLE_S - B.phaseT).toFixed(1) + 's';
    if (B.phase === 'warm')   return 'benchmark: warm-up lap';
    return 'benchmark: lap ' + (B.lap + 1) + '/' + total + '   ' + n + ' frames';
  };
})(MCL);
