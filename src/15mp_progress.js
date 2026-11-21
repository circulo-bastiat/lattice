// Also cites WorldGenerationProgressTracker (loading screen, 15mp_progress.js), OptimizeWorldScreen (not ported).
// MC-Lite — #11328: the vanilla loading screens. LevelLoadingScreen (chunk-status map + percentage), ProgressScreen (title,
// "task N%") and DownloadingTerrainScreen (centred text), over the dirt background (Screen.renderBackgroundTexture).
// Numbers from .decomp gui/screen/{LevelLoadingScreen,ProgressScreen,DownloadingTerrainScreen}.java.
// Rulings: the warm-up grid is (2*WARM_RADIUS+1)^2 columns, not vanilla's 11-radius grid (the engine pre-generates a smaller area);
// MC-Lite has no per-stage ChunkStatus, so a column's state maps EMPTY->empty, GENERATING->noise, GENERATED->features, LIT->light, MESHED->full.
// Strings are en_us: menu.savingLevel, menu.savingChunks, multiplayer.downloadingTerrain, progress.working.
(function (NS) {
  'use strict';
  var P = NS.Progress = { grid: null, title: null, task: null, pct: 0 };
  // ChunkStatus.java registration order -> LevelLoadingScreen.STATUS_TO_COLOR (RGB ints)
  P.STATUS_COLORS = {
    empty: 5526612, structure_starts: 10066329, structure_references: 6250897, biomes: 8434258, noise: 13750737,
    surface: 7497737, carvers: 7169628, liquid_carvers: 3159410, features: 2213376, light: 13421772,
    spawn: 15884384, heightmaps: 15658734, full: 16777215
  };
  P.TEXT = { loadingTerrain: 'Loading terrain...', savingLevel: 'Saving level', savingChunks: 'Saving chunks', working: 'Working...' };
  P.colorOf = function (status) { return status && P.STATUS_COLORS[status] !== undefined ? P.STATUS_COLORS[status] : 0; };
  P.statusOf = function (chState) {
    var CH = NS.CH;
    if (chState === undefined || chState === null || chState < 0) return null;
    if (chState >= CH.READY) return 'full';
    if (chState >= CH.LIT) return 'light';
    if (chState >= CH.GENERATED) return 'features';
    if (chState >= CH.GENERATING) return 'noise';
    return 'empty';
  };
  /** grid = { size, at(x,z) -> status name|null }; percentage = columns at 'full' (vanilla getProgressPercentage). */
  P.percent = function (g) {
    if (!g) return 0;
    var n = 0, t = g.size * g.size;
    for (var x = 0; x < g.size; x++) for (var z = 0; z < g.size; z++) if (g.at(x, z) === 'full') n++;
    return Math.max(0, Math.min(100, Math.floor(n * 100 / t)));
  };
  P.setGrid = function (g) { P.grid = g; };
  P.set = function (title, task, pct) { P.title = title; P.task = task; P.pct = pct | 0; };

  var dirtCanvas = null;
  function dirt() {
    if (dirtCanvas || typeof document === 'undefined') return dirtCanvas;
    var A = NS.Atlas, S = NS.States;
    if (!A || !A.mips || !S || !S.stateOf) return null;
    var tile = S.iconTile(S.stateOf('dirt')), cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    var g = cv.getContext('2d'), im = g.createImageData(16, 16);
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var t = A.tileTexel(tile, x, y), i = (y * 16 + x) * 4;
      im.data[i] = ((t >> 16) & 255) >> 2; im.data[i + 1] = ((t >> 8) & 255) >> 2; im.data[i + 2] = (t & 255) >> 2; im.data[i + 3] = 255;   // colour 64,64,64
    }
    g.putImageData(im, 0, 0);
    return (dirtCanvas = cv);
  }
  /** Screen.renderBackgroundTexture: the dirt tile at 32 gui px per tile. */
  P.drawBackground = function (c, w, h, s) {
    var d = dirt();
    if (!d) { c.fillStyle = '#101010'; c.fillRect(0, 0, w, h); return; }
    // #11402: tile edges snap to whole device pixels (a fractional GUI scale left hairline seams between tiles)
    var ts = 32 * s, nx = Math.ceil(w / ts), ny = Math.ceil(h / ts);
    c.imageSmoothingEnabled = false;
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var x0 = Math.round(i * ts), y0 = Math.round(j * ts);
      c.drawImage(d, x0, y0, Math.round((i + 1) * ts) - x0, Math.round((j + 1) * ts) - y0);
    }
  };
  function ctext(c, str, cx, y, s, col) { var g = NS.Gui; g.text(c, str, cx - g.textWidth(str) * s / 2, y * s, s, col, true); }

  /** LevelLoadingScreen.drawChunkMap(.., cx, cy, 2, 0): returns the cell rects for the check. */
  P.drawChunkMap = function (c, g, cx, cy, s) {
    var cell = 2, size = g.size, tot = size * cell, x0 = cx - Math.floor(tot / 2), y0 = cy - Math.floor(tot / 2), cells = [];
    for (var i = 0; i < size; i++) for (var j = 0; j < size; j++) {
      var col = P.colorOf(g.at(i, j));
      c.fillStyle = 'rgb(' + ((col >> 16) & 255) + ',' + ((col >> 8) & 255) + ',' + (col & 255) + ')';
      // #11402: whole device pixels, edges from the same rounding so neighbours abut with no seam at fractional scales
      var ax = Math.round((x0 + i * cell) * s), ay = Math.round((y0 + j * cell) * s);
      c.fillRect(ax, ay, Math.round((x0 + i * cell + cell) * s) - ax, Math.round((y0 + j * cell + cell) * s) - ay);
      cells.push({ x: x0 + i * cell, y: y0 + j * cell, color: col });
    }
    return cells;
  };
  P.drawLevelLoading = function (c, w, h, s) {
    var gw = w / s, gh = h / s, cx = Math.floor(gw / 2), cy = Math.floor(gh / 2);
    P.drawBackground(c, w, h, s);
    var cells = P.grid ? P.drawChunkMap(c, P.grid, cx, cy + 30, s) : [];
    ctext(c, P.percent(P.grid) + '%', cx, cy - 4 - 30, s, 0xFFFFFF);   // height/2 - 9/2 - 30
    return cells;
  };
  P.drawProgress = function (c, w, h, s) {
    var cx = Math.floor(w / s / 2);
    P.drawBackground(c, w, h, s);
    if (P.title) ctext(c, P.title, cx, 70, s, 0xFFFFFF);
    if (P.task && P.pct) ctext(c, P.task + ' ' + P.pct + '%', cx, 90, s, 0xFFFFFF);
  };
  P.drawDownloading = function (c, w, h, s) {
    P.drawBackground(c, w, h, s);
    ctext(c, P.TEXT.loadingTerrain, Math.floor(w / s / 2), Math.floor(h / s / 2) - 50, s, 0xFFFFFF);
  };
  /** Pause > Save and Quit to Title: ProgressScreen "Saving level" (the reload that follows is the honest teardown). */
  P.startSaving = function () {
    P.set(P.TEXT.savingLevel, P.TEXT.working, 0);
    if (NS.Hud) { NS.Hud.mode = 'saving'; if (NS.Hud.draw) NS.Hud.draw(); }
  };
})(MCL);
