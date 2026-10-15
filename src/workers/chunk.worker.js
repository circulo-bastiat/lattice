// workers/chunk.worker.js — the worker entry point (docs/archive/ARCH.md §7).
//
// This file is the LAST thing in the worker bundle. build.mjs prepends src/00..05 verbatim, so
// MCL, MCL.U, MCL.Blocks, MCL.Section, MCL.Gen and MCL.Mesher are all already defined here —
// the same code the main thread runs, not a copy (D-38).
//
// The bundle is turned into a Blob URL by 09_jobs.js, because a file:// document cannot create
// a Worker from a path (D-11).

(function (NS) {
  'use strict';

  var inited = false;

  self.onmessage = function (ev) {
    var m = ev.data;
    if (!m) return;

    try {
      switch (m.t) {
        case 'init': {
          NS.Blocks.init();
          // The 1.18.2 registry, decoded HERE rather than copied from the main thread: the
          // packed blobs are 334 KB and the typed arrays they become are 2.3 MB, so cloning
          // the decoded form per worker would cost more than decoding it does. ~70 ms on
          // this thread, in parallel with every other worker, while the main thread gets on
          // with the loading screen.
          var regMs = 0;
          if (m.reg && NS.Reg && !NS.Reg.ready) {
            var t0 = Date.now();
            NS.Reg.init(m.reg);          // also builds NS.States (see Reg.init)
            NS.Mesher.resetRegistryCache();
            regMs = Date.now() - t0;
          }
          if (NS.Dim) NS.Dim.cur = NS.Dim.norm(m.dim);   // G27a: the dimension this worker generates/lights
          NS.Gen.init(m.seed, m.gen);
          if (m.mesh) NS.Mesher.setOptions(m.mesh);
          inited = true;
          self.postMessage({ t: 'ready', ver: NS.VERSION, regMs: regMs,
                             regBlocks: (NS.Reg && NS.Reg.ready) ? NS.Reg.blockCount : 0 });
          break;
        }

        // Mesh detail changed (a quality preset was applied). The main thread follows this with
        // World.remeshAll(), so nothing already on the GPU is left half-old.
        case 'opt':
          NS.Mesher.setOptions(m.mesh);
          break;

        case 'gen': {
          if (!inited) throw new Error('gen before init');
          var col = NS.Gen.genColumn(m.cx, m.cz);
          var xfer = [col.hmap.buffer];
          if (col.biome) xfer.push(col.biome.buffer);
          for (var i = 0; i < col.sec.length; i++) NS.Section.transferList(col.sec[i], xfer);
          self.postMessage({ t: 'gen:done', id: m.id, cx: m.cx, cz: m.cz,
                             sec: col.sec, hmap: col.hmap, biome: col.biome || null, spawners: col.spawners || null, entities: col.entities || null, nests: col.nests || null }, xfer);
          break;
        }

        case 'mesh': {
          if (!inited) throw new Error('mesh before init');
          // World-space origin of this section: the mesher hashes it to choose among a
          // state's random variants, and a local origin would restart the pattern every 16
          // blocks — a visible grid across any large stone face.
          var buf = NS.Mesher.mesh(m.snap, null, m.cx * 16, m.sy * 16 + NS.CFG.WORLD_MIN_Y, m.cz * 16);
          // `vis` rides along even when there is no geometry: a section of plain air draws
          // nothing but is exactly the section the visibility flood has to travel through.
          self.postMessage({ t: 'mesh:done', id: m.id, cx: m.cx, cz: m.cz, sy: m.sy,
                             mesh: buf, vis: NS.Mesher.lastVis },
                           buf ? [buf] : []);
          break;
        }

        case 'cancel':
          // Jobs are short enough that cancellation is advisory: the result is simply dropped
          // by the main thread. Nothing to do here.
          break;
      }
    } catch (e) {
      self.postMessage({ t: 'err', id: m.id, msg: (e && e.message) || String(e) });
    }
  };
})(MCL);
