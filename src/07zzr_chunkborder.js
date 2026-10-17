// 07zzr_chunkborder.js — F3+G chunk borders: ChunkBorderDebugRenderer's geometry as a PURE function.
// Runs on: MAIN THREAD. Vertex lists are world-space; both gfx backends draw the same list.
(function (NS) {
  'use strict';
  var CB = NS.ChunkBorder = NS.ChunkBorder || {};
  CB.on = false;
  CB.MIN_Y = -64; CB.MAX_Y = 256;
  var TEAL = [0, 155 / 255, 155 / 255, 1], YEL = [1, 1, 0, 1];

  /** Toggle (F3+G); returns the chat line vanilla prints (debug.chunk_boundaries.on/off). */
  CB.toggle = function () {
    CB.on = !CB.on;
    return CB.on ? 'Chunk borders: shown' : 'Chunk borders: hidden';
  };

  /**
   * geometry(px, pz) -> [{width, verts:[[x,y,z,r,g,b,a],...]}]  (vanilla GL_LINE_STRIP batches, in order).
   * px, pz: the focused entity's position; the chunk is floor(p/16).
   */
  CB.geometry = function (px, pz, minY, maxY) {
    if (minY === undefined) minY = CB.MIN_Y;
    if (maxY === undefined) maxY = CB.MAX_Y;
    var x0 = Math.floor(px / 16) * 16, z0 = Math.floor(pz / 16) * 16;
    var thin = [], thick = [], i, j, c, y;
    function v(a, x, y, z, col, al) { a.push([x, y, z, col[0], col[1], col[2], al === undefined ? col[3] : al]); }
    function post(a, x, z, col, a0, a1) {
      v(a, x, minY, z, col, a0); v(a, x, minY, z, col, a1); v(a, x, maxY, z, col, a1); v(a, x, maxY, z, col, a0);
    }
    function ring(a, y, col, a0, a1) {
      v(a, x0, y, z0, col, a0); v(a, x0, y, z0, col, a1); v(a, x0, y, z0 + 16, col, a1);
      v(a, x0 + 16, y, z0 + 16, col, a1); v(a, x0 + 16, y, z0, col, a1); v(a, x0, y, z0, col, a1);
      v(a, x0, y, z0, col, a0);
    }
    for (i = -16; i <= 32; i += 16) for (j = -16; j <= 32; j += 16) post(thin, x0 + i, z0 + j, [1, 0, 0, 0], 0, 0.5);
    // vanilla fades 0 -> 0.5 -> 0.5 -> 0 on the red posts
    for (i = 2; i < 16; i += 2) {
      c = i % 4 === 0 ? TEAL : YEL;
      post(thin, x0 + i, z0, c, 0, 1); post(thin, x0 + i, z0 + 16, c, 0, 1);
    }
    for (j = 2; j < 16; j += 2) {
      c = j % 4 === 0 ? TEAL : YEL;
      post(thin, x0, z0 + j, c, 0, 1); post(thin, x0 + 16, z0 + j, c, 0, 1);
    }
    for (y = minY; y <= maxY; y += 2) ring(thin, y, y % 8 === 0 ? TEAL : YEL, 0, 1);
    var BLUE = [0.25, 0.25, 1, 1];
    for (i = 0; i <= 16; i += 16) for (j = 0; j <= 16; j += 16) post(thick, x0 + i, z0 + j, BLUE, 0, 1);
    for (y = minY; y <= maxY; y += 16) ring(thick, y, BLUE, 0, 1);
    return [{ width: 1, verts: thin }, { width: 2, verts: thick }];
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
