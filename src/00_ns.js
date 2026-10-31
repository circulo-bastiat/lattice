// 00_ns.js — the one global. Must be first in FILE_ORDER and first in every worker bundle.
// Runs on: main thread AND workers. No DOM.

var MCL = (typeof MCL !== 'undefined' && MCL) ? MCL : {};

(function (NS) {
  'use strict';

  NS.VERSION = '0.2.0-playable';

  // --- constants (docs/archive/ARCH.md §2) -----------------------------------------
  NS.CFG = {
    SECTION:     16,
    SECTION_VOL: 4096,
    WORLD_MIN_Y: -64,
    WORLD_MAX_Y: 256,        // exclusive
    SECTIONS_Y:  20,
    CHUNK_H:     320,
    MAX_QUADS:   16383,      // 4 verts each -> 65532 <= 65535 (D-25)
    LIGHT_MAX:   15,

    // faces: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z
    FACE_DX: new Int8Array([ 1, -1,  0,  0,  0,  0]),
    FACE_DY: new Int8Array([ 0,  0,  1, -1,  0,  0]),
    FACE_DZ: new Int8Array([ 0,  0,  0,  0,  1, -1]),

    LAYER_OPAQUE: 0, LAYER_CUTOUT: 1, LAYER_TRANSLUCENT: 2, LAYER_COUNT: 3,
    // #2627: the 4th MODEL-stream bucket (entities only): vanilla's energy swirl (wither armor), additive + scrolling UV.
    // Not a cube layer, so LAYER_COUNT stays 3. Mesh header word 15 holds its quad count.
    LAYER_ADDITIVE: 3,
    // RenderLayer.getEnergySwirl's OffsetTexturing for the wither armor (WitherArmorFeatureRenderer.getEnergySwirlX =
    // cos(f*0.02)*3, y = f*0.01, both `% 1.0F` as Java's sign-keeping remainder); f = age + partialTicks. The shaders
    // compute the same thing from uCamTime.w*20 -- a golden (tools/swirlcheck.mjs) pins this one.
    swirlOffset: function (f, creeper) {   // #4402: CreeperChargeFeatureRenderer.getEnergySwirlX = f*0.01
      var x = creeper ? f * 0.01 : Math.cos(f * 0.02) * 3, y = f * 0.01;
      return [x % 1, y % 1];
    },

    // ── the mesh buffer (docs/archive/ARCH.md §8) ────────────────────────────────────────
    // 'MSH2' because the header grew from 8 words to 16 when the MODEL quad stream was
    // added. Bumping the magic rather than reusing 'MSH1' means a stale buffer from a
    // half-updated worker is rejected loudly instead of read with the wrong offsets.
    MESH_MAGIC: 0x4D534832,  // 'MSH2'
    MESH_HEADER_BYTES: 64,
    VERTEX_BYTES: 8,
    QUAD_BYTES: 32,

    // ── model quads ─────────────────────────────────────────────────────────────
    // The cube stream packs a vertex into 2 uint32 and has no room left: x/y/z take 6 bits
    // each and the other 14 are spoken for. Sub-block geometry needs 1/16-block positions,
    // which is 4 more bits per axis, so it gets its OWN stream and its own vertex layout
    // rather than widening the format every stone block in the world pays for.
    //
    //   word 0   px : i16      py : i16        1/256 of a block, relative to the section
    //   word 1   pz : i16      tile : u16      atlas layer
    //   word 2   u  : i16      v  : i16        1/16 of a texel, 0..256
    //
    // ⚠ 1/256 of a BLOCK, not 1/16. Minecraft's model space is 16 units to a block and the
    // baked geometry keeps 1/16 of one of those, so the stored unit is 16 x 16 = 256 to the
    // block. Writing x << 4 instead of x * 256 puts every block at a sixteenth of its real
    // position, which stacks the whole world into one corner — caught by tools/emitcheck.mjs
    // as "slab x 256 outside 0..16" the first time it ran.
    // A section is 16 blocks, so positions run 0..4096 plus whatever a model hangs outside
    // its own cell (measured -118..374), which is why they are i16 and not u16.
    MODEL_UNITS_PER_BLOCK: 256,
    //   word 3   face(3) | ao(2) | sky(4) | blk(4) | tint(2) | shade(1) | flag(1)
    //
    // 16 bytes a vertex against the cube stream's 8. That is the right trade: measured on
    // the 1.18.2 roster, 805 of 20,622 placements are full cubes but those cubes are what
    // a real world is MADE of — stone, deepslate, dirt — and they keep the tight format
    // and the greedy merge. Model geometry is the minority per chunk and pays for itself.
    MODEL_VERTEX_BYTES: 16,
    MODEL_QUAD_BYTES: 64,

    WORKER_HANDSHAKE_MS: 2000,   // D-12
    UPLOADS_PER_FRAME: 4         // D-43
  };

  // chunk state machine (docs/archive/ARCH.md §5)
  NS.CH = { EMPTY: 0, GENERATING: 1, GENERATED: 2, LIT: 3, MESHING: 4, READY: 5 };

  // --- environment detection ------------------------------------------------
  // Deliberately does NOT touch document/localStorage so the worker can run this file.
  var g = (typeof self !== 'undefined') ? self : this;

  NS.ENV = {
    isWorker:  (typeof WorkerGlobalScope !== 'undefined' && g instanceof WorkerGlobalScope) ||
               (typeof importScripts === 'function' && typeof window === 'undefined'),
    hasWindow: (typeof window !== 'undefined'),
    hasWebGPU: (typeof navigator !== 'undefined' && !!navigator.gpu),
    hasWorker: (typeof Worker === 'function'),
    hasBlobURL:(typeof Blob === 'function' && typeof URL !== 'undefined' && !!URL.createObjectURL),
    cores:     (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) | 0,
    fileProto: (typeof location !== 'undefined' && location.protocol === 'file:')
  };

  // D-36: the RECOMMENDED pool size — one fewer than the machine's threads, never more than 4,
  // so the main thread still gets a core and a 32-thread desktop does not open 32 workers.
  NS.ENV.workers = Math.max(1, Math.min(4, (NS.ENV.cores || 2) - 1));
  // ⚠⚠ **THE RECOMMENDATION IS NOT THE CEILING — D-428.** Dan, session 55: *"add a proper
  // option in settings to toggle amount of web workers; its set to 4 now with no tinkering."*
  // That 4 was `ENV.workers`, used as BOTH the default and the hard clamp, so on a 12-thread
  // machine the setting could not be raised past 4 and there was no control to raise it with.
  // The ceiling is now what the machine reports; the recommendation above is unchanged and is
  // still what an untouched install gets.
  NS.ENV.workersMax = Math.max(1, NS.ENV.cores || 2);

  // WebGL2 probe is lazy: creating a context is not free and boot order matters.
  NS.probeWebGL2 = function () {
    if (!NS.ENV.hasWindow) return false;
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl2', { antialias: false, depth: true });
      return !!gl;
    } catch (e) { return false; }
  };
})(MCL);
