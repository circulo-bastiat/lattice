// 15_hud.js — the 2D overlay canvas: loading screen, crosshair, selection box, hotbar,
// break particles, the F3 readout and the menus. Main thread only.
//
// This is the FIRST thing to paint at boot: a double-clicked file must never show a blank white
// page while WebGPU is negotiating (docs/archive/ARCH.md §10 step 2).
//
// THE SELECTION BOX AND THE PARTICLES ARE DRAWN HERE, IN 2D (D-75).
// Both backends would otherwise need a new pipeline, a new vertex format and a new entry in the
// pass table, and ARCH §9's rule that the two backends must render identically would then have
// to be re-proved for geometry that is twelve lines long. Projecting eight corners with the
// camera's own viewProj is a dozen multiplies, is backend-agnostic BY CONSTRUCTION, and cannot
// drift between WebGPU and WebGL2 because there is only one implementation.

(function (NS) {
  'use strict';

  var H = NS.Hud = {
    canvas: null, ctx: null,
    w: 1, h: 1, dpr: 1,
    status: [],
    mode: 'loading',            // 'loading' | 'title' | 'game' | 'fatal'

    // --- title screen (blocker B2, D-16) ---
    titleSeed: '',              // the seed field's text, edited by typing
    titleSeedFocus: false,
    titleHasSave: false,
    titleNote: '',            // D-426: why the last press on a locked title row did nothing
    titleNoteT: 0,
    titleCaret: 0,
    screen: null,               // null | 'pause' | 'inventory'
    showDebug: false,
    fps: 0,
    frameProf: null,            // U.Profiler, owned by Main
    progress: 0, progressLabel: '',
    toast: '', toastT: 0,

    icons: null, iconCols: 32, iconSize: 16,   // one icon per BLOCK, not per state
    hit: [],                    // menu hit rectangles for the current frame
    hoverBlock: -1,
    invScroll: 0,
    scale: 1,
    // Chromium refuses requestPointerLock for ~1.25 s after the user pressed Esc to leave it.
    // Closing a menu therefore cannot always re-lock, so the HUD says so rather than leaving the
    // player wondering why the mouse does nothing.
    needClick: false
  };

  H.init = function (canvas) {
    H.canvas = canvas;
    H.ctx = canvas.getContext('2d', { alpha: true });
    return H;
  };

  H.resize = function (w, h, dpr) {
    H.w = w; H.h = h; H.dpr = dpr || 1;
    H.canvas.width  = Math.max(1, (w * H.dpr) | 0);
    H.canvas.height = Math.max(1, (h * H.dpr) | 0);
    if (H.ctx) { H.ctx.setTransform(H.dpr, 0, 0, H.dpr, 0, 0); H.ctx.imageSmoothingEnabled = false; }
    // one HUD "pixel" is 2 screen px at 1080p, 3 at 4K — the same rule vanilla uses
    H.scale = NS.Settings.calculateScaleFactor(NS.Settings.guiScale | 0, w, h);
    H.draw();
  };

  H.setStatus = function (lines) { H.status = lines.slice(); H.draw(); };
  H.pushStatus = function (line) { H.status.push(line); H.draw(); };
  H.setProgress = function (frac, label) {
    H.progress = frac < 0 ? 0 : (frac > 1 ? 1 : frac);
    if (label !== undefined) H.progressLabel = label;
  };
  H.say = function (msg) { H.toast = msg; H.toastT = NS.U.now(); };

  /**
   * The FIRST fatal wins. Gfx.fail() reports exactly what the machine is missing; a later,
   * vaguer "no GPU backend" from the boot chain must not overwrite that report.
   */
  H.fatal = function (msg) {
    var first = H.mode !== 'fatal';
    H.mode = 'fatal';
    var el = (typeof document !== 'undefined') && document.getElementById('fatal');
    if (el && first) { el.style.display = 'block'; el.textContent = 'MC-Lite failed to start\n\n' + msg; }
  };

  // ---------------------------------------------------------------------------
  // Block icons
  //
  // Built once from Atlas.mips[0] — NOT from Atlas.canvas, which throws the alpha channel away
  // when it paints its opaque debug preview. The alpha channel is the tint mask (ARCH §9), and
  // without it grass is grey in the hotbar and green in the world. The compositing rule below is
  // the same one both shaders use, so an icon and the block it stands for match.
  // ---------------------------------------------------------------------------

  H.buildIcons = function () {
    // ⚠ ONE ICON PER BLOCK, not per state. There are 20,344 real states and 900 blocks, and a
    // player picking something out of the inventory wants "oak stairs", not each of its 80
    // orientations. drawIcon() takes a state and looks up its block, so every caller can keep
    // passing the number the world actually stores.
    var A = NS.Atlas, R = NS.Reg, SR = NS.States, S = NS.Gfx.SHADE;
    if (!A.mips) return null;
    var n = R.blockCount, T = A.TILE, cols = H.iconCols;
    var rows = Math.ceil(n / cols);
    var c = document.createElement('canvas');
    c.width = cols * T; c.height = rows * T;
    var g = c.getContext('2d', { alpha: true });
    g.imageSmoothingEnabled = false;
    var img = g.createImageData(T, T);
    var src = A.mips[0].data;

    for (var id = 1; id < n; id++) {
      var st = R.realFirst[id] + R.defaultState[id];
      var tile = SR.iconTile(st);              // the +X side; what a block "looks like" edge on
      var tintIdx = SR.iconTint(st);
      var layer = SR.layer[st], tint = S.TINT[tintIdx & 3] || S.TINT[0];
      var base = tile * T * T * 4;
      for (var p = 0; p < T * T; p++) {
        var r = src[base + p * 4], gg = src[base + p * 4 + 1], b = src[base + p * 4 + 2];
        var a = src[base + p * 4 + 3] / 255;
        var o = p * 4, oa = 255;
        if (layer === 1) {                      // cutout: alpha is coverage
          if (a < S.CUTOUT) { img.data[o] = img.data[o+1] = img.data[o+2] = img.data[o+3] = 0; continue; }
          r *= tint[0]; gg *= tint[1]; b *= tint[2];
        } else if (layer === 2) {               // translucent: alpha is opacity
          r *= tint[0]; gg *= tint[1]; b *= tint[2];
          oa = (a * 255) | 0;
        } else {                                // opaque: alpha is the tint MASK
          r *= 1 + (tint[0] - 1) * a;
          gg *= 1 + (tint[1] - 1) * a;
          b *= 1 + (tint[2] - 1) * a;
        }
        img.data[o] = r | 0; img.data[o+1] = gg | 0; img.data[o+2] = b | 0; img.data[o+3] = oa;
      }
      g.putImageData(img, (id % cols) * T, ((id / cols) | 0) * T);
    }
    H.flatIcons = c;

    // ⚠⚠ THE FLAT SHEET ABOVE IS NOW THE FALLBACK, NOT THE ANSWER (D-311). A block in the
    // inventory is its MODEL rendered in three dimensions — that is what vanilla draws and it is
    // why `grass_block` showed as `block/dirt` here for nine sessions: `iconTile` returns "the
    // first quad of the first part", which for anything that is not a plain cube is an arbitrary
    // internal face. `BlockIcon.build()` renders the real geometry; blocks it cannot render —
    // chests, signs, banners, whose shape lives in code rather than in a model — keep the flat
    // tile, which is a worse picture than vanilla's and a much better one than nothing.
    var solid = NS.BlockIcon ? NS.BlockIcon.build() : null;
    if (solid) {
      var out = document.createElement('canvas');
      out.width = c.width; out.height = c.height;
      var og = out.getContext('2d', { alpha: true });
      og.imageSmoothingEnabled = false;
      og.drawImage(c, 0, 0);                       // the flat sheet underneath...
      var flat = {};
      if (NS.BlockIcon.flat) for (var fi = 0; fi < NS.BlockIcon.flat.length; fi++) flat[NS.BlockIcon.flat[fi]] = 1;
      // ...and every block that DID render, painted over it
      for (var bid = 1; bid < n; bid++) {
        if (flat[bid]) continue;
        var sx = (bid % cols) * T, sy = ((bid / cols) | 0) * T;
        og.clearRect(sx, sy, T, T);
        og.drawImage(solid, sx, sy, T, T, sx, sy, T, T);
      }
      H.icons = out;
      H.iconsAre3D = true;
      H.iconFlatCount = NS.BlockIcon.flat ? NS.BlockIcon.flat.length : 0;
      return out;
    }
    H.icons = c;
    H.iconsAre3D = false;
    return c;
  };

  /**
   * `H.iconPx(size)` — how many DEVICE pixels a `size`-unit icon actually occupies.
   *
   * ⚠⚠ **THERE ARE TWO MAGNIFICATIONS AND ONLY ONE OF THEM WAS EVER CONSIDERED.** The HUD canvas
   * is backed at `w * dpr` and its context carries a `dpr` transform, so an icon asked for at
   * `16 * scale` units lands on `16 * scale * dpr` real pixels. A 16-pixel tile drawn into that
   * with `imageSmoothingEnabled = false` is magnified by the SCALE and then again by the DEVICE
   * RATIO — up to twelve times on a 4K display at scale 4. Every cached icon canvas in this file
   * is sized through here so the final `drawImage` is one device pixel to one device pixel.
   */
  H.iconPx = function (size) { return Math.max(1, Math.round(size * (H.dpr || 1))); };

  // ⚠ The cache is keyed by block AND size, and dropped whole when the device ratio changes or it
  // grows past its cap. A resize storm would otherwise keep one canvas per size it passed through.
  var iconCache = Object.create(null);
  var iconCacheDpr = -1, iconCacheN = 0;
  H.ICON_CACHE_MAX = 512;
  H.iconCacheStats = function () { return { n: iconCacheN, dpr: iconCacheDpr }; };

  /**
   * That block's icon, rendered at the size it is about to be drawn, or null to use the sheet.
   *
   * ⚠ **IT RENDERS THE BLOCK'S DEFAULT STATE, NOT THE STATE PASSED IN** — exactly as
   * `BlockIcon.build` does for the sheet. The two paths draw the same picture at two resolutions;
   * if this one picked the state it was handed, a lit furnace in the hotbar would change picture
   * the moment the icon happened to be sharp enough to take this path (D-314's rule).
   */
  H.iconCanvas = function (state, size) {
    var BI = NS.BlockIcon, R = NS.Reg;
    if (!BI || !BI.stateCanvas || !R || !R.ready || typeof document === 'undefined') return null;
    var px = H.iconPx(size);
    if (px <= H.iconSize) return null;        // the sheet is already at least this sharp
    if (iconCacheDpr !== (H.dpr || 1) || iconCacheN > H.ICON_CACHE_MAX) {
      iconCache = Object.create(null); iconCacheN = 0; iconCacheDpr = H.dpr || 1;
    }
    var id = NS.States.block[state];
    var key = id + '@' + px;
    var hit = iconCache[key];
    if (hit !== undefined) return hit;
    var def = R.realFirst[id] + R.defaultState[id];
    var cv = BI.stateCanvas(def, px);
    iconCache[key] = cv || null; iconCacheN++;
    return cv || null;
  };

  /**
   * #4982 -- a block ITEM's own model, rendered at `size`, or null when it has none. Vanilla draws
   * the ITEM's model in a slot (`item/small_dripleaf` is `block/small_dripleaf_top`, `item/
   * chorus_plant` is `block/chorus_plant`, a stair is gui [30,135,0], leaves carry ItemColors'
   * tint), not the placed block's default state, which for a multipart or two-half block is a
   * different picture. Same cache and same supersample as `iconCanvas`.
   */
  H.itemModelCanvas = function (itemIdx, size) {
    var BI = NS.BlockIcon, IT = NS.Items;
    if (!BI || !BI.renderItem || !IT || !IT.ready || IT.modelPartOf(itemIdx) < 0 || typeof document === 'undefined') return null;
    var px = Math.max(1, H.iconPx(size));
    if (iconCacheDpr !== (H.dpr || 1) || iconCacheN > H.ICON_CACHE_MAX) {
      iconCache = Object.create(null); iconCacheN = 0; iconCacheDpr = H.dpr || 1;
    }
    var key = 'i' + itemIdx + '@' + px;
    var hit = iconCache[key];
    if (hit !== undefined) return hit;
    var big = BI.superFor(px);
    var buf = BI.renderItem(itemIdx, big), cv = null;
    if (buf) {
      var any = false;
      for (var p = 3; p < buf.length; p += 4) if (buf[p]) { any = true; break; }
      if (any) {
        var tmp = document.createElement('canvas');
        tmp.width = big; tmp.height = big;
        var tg = tmp.getContext('2d', { alpha: true });
        var img = tg.createImageData(big, big);
        img.data.set(buf);
        tg.putImageData(img, 0, 0);
        if (big === px) cv = tmp;
        else {
          cv = document.createElement('canvas');
          cv.width = px; cv.height = px;
          var og = cv.getContext('2d', { alpha: true });
          og.imageSmoothingEnabled = true;
          og.drawImage(tmp, 0, 0, big, big, 0, 0, px, px);
        }
      }
    }
    iconCache[key] = cv; iconCacheN++;
    return cv;
  };

  /** `state` is a registry real state, as stored in the world; the icon is its BLOCK's. */
  H.drawIcon = function (c, state, x, y, size) {
    if (!H.icons || state <= 0 || !NS.States.ready) return;
    var id = NS.States.block[state];
    if (id <= 0) return;
    var sharp = H.iconCanvas(state, size);
    if (sharp) { c.drawImage(sharp, 0, 0, sharp.width, sharp.height, x, y, size, size); return; }
    var T = H.iconSize, cols = H.iconCols;
    c.drawImage(H.icons, (id % cols) * T, ((id / cols) | 0) * T, T, T, x, y, size, size);
  };

  // ── G11: ITEM icons, as opposed to BLOCK icons ────────────────────────────────────────────
  // ⚠ `H.drawIcon` above is one icon per BLOCK, built from the block atlas — it is what the
  // hotbar has always used and it cannot draw a stick, an apple or a diamond, because those are
  // items with no block. The item atlas ships as a PNG (`DATA.itemAtlas`) and is decoded here
  // into one canvas, once, on a data URL so nothing is fetched (D-274 / hard constraint 1).
  /**
   * ⚠⚠ **BUILT FROM THE ATLAS'S OWN LAYERS, NOT FROM A SECOND PNG** (D-341). The item sprites
   * ship once, as texture-array layers, because a dropped item has to be drawn in the WORLD and
   * the world samples that array. The HUD needs the same pixels as a 2D canvas, so it lays those
   * layers out in the grid `DATA.itemTile`/`itemCols` describe — **one source, two shapes**,
   * which is D-139 and also D-314's rule: two copies of the same sprites is two things that can
   * disagree.
   * ⚠ AND IT IS SYNCHRONOUS NOW. The old path decoded a data-URL PNG through an `Image`, so
   * `itemSheetReady` was false for the first frames and every caller had to know it.
   */
  H.itemSheet = null;
  H.itemSheetReady = false;
  H.buildItemIcons = function () {
    if (H.itemSheet || typeof document === 'undefined') return;
    var A = NS.Atlas, D = NS.DATA;
    if (!A || !A.mips || !A.itemTiles || !D) return;
    var T = D.itemTile | 0, cols = D.itemCols | 0, rows = D.itemRows | 0;
    if (!(T > 0 && cols > 0 && rows > 0)) return;
    var cv = document.createElement('canvas');
    cv.width = cols * T; cv.height = rows * T;
    var g = cv.getContext('2d', { alpha: true });
    var lvl0 = A.mips[0].data, per = T * T * 4;
    var img = g.createImageData(T, T);
    for (var i = 0; i < A.itemTiles; i++) {
      var off = (A.itemTile0 + i) * per;
      img.data.set(lvl0.subarray(off, off + per));
      g.putImageData(img, (i % cols) * T, ((i / cols) | 0) * T);
    }
    H.itemSheet = cv;
    H.itemSheetReady = true;
  };

  /**
   * drawItem(c, stack, x, y, size) — an item STACK: its icon, its count and its damage bar.
   *
   * ⚠ An item model is up to two LAYERS, and the second one is usually tinted — that is how one
   * grey `leather_helmet` sprite becomes sixteen dyed ones and how a potion gets its colour. The
   * layers are drawn in order and a tinted layer is composited through `source-in`, which is
   * exactly what the real renderer does with its tint index.
   */
  /** #10807: tile `t` of the item sheet MULTIPLIED by `col` (RGB, alpha untouched), cached per (tile, colour). */
  H.tintedTile = function (t, col) {
    var key = t + '@' + col, cache = H._tintCache || (H._tintCache = {});
    if (cache[key]) return cache[key];
    var T = NS.DATA.itemTile, cols = NS.DATA.itemCols;
    var cv = document.createElement('canvas'); cv.width = T; cv.height = T;
    var g = cv.getContext('2d');
    g.drawImage(H.itemSheet, (t % cols) * T, ((t / cols) | 0) * T, T, T, 0, 0, T, T);
    var img = g.getImageData(0, 0, T, T), d = img.data, r = col >> 16 & 255, gg = col >> 8 & 255, b = col & 255;
    for (var o = 0; o < d.length; o += 4) { d[o] = (d[o] * r + 127) / 255 | 0; d[o + 1] = (d[o + 1] * gg + 127) / 255 | 0; d[o + 2] = (d[o + 2] * b + 127) / 255 | 0; }
    g.putImageData(img, 0, 0);
    return cache[key] = cv;
  };
  H.drawItem = function (c, stack, x, y, size) {
    var I = NS.Inventory, IT = NS.Items;
    if (!I || I.isEmpty(stack)) return;
    var drew = false;
    if (H.itemSheetReady && IT && IT.layersOf) {
      var layers = IT.layersOf(stack.i);
      var cmpT = NS.Use && NS.Use.compassTile ? NS.Use.compassTile(stack) : -1;   // #5804: the needle frame
      if (cmpT >= 0) layers = [cmpT];
      var T = NS.DATA.itemTile, cols = NS.DATA.itemCols;
      // ⚠⚠ **NO TINT COMPOSITING HERE ANY MORE, AND THE OLD PATH IS DELETED** (D-344, D-139).
      // A tinted layer's tile is ALREADY the tinted pixels: `extract-items.mjs` bakes one atlas
      // layer per distinct (sprite, colour) pair, so the HUD and the world draw the same bytes
      // and cannot disagree about what a zombie egg looks like.
      // ⚠ AND THE OLD PATH WAS WRONG, not merely duplicated. It composited with `source-in` and
      // a `fillRect`, which REPLACES every pixel's RGB with one flat colour; vanilla MULTIPLIES
      // the sprite by the colour. So a spawn egg in the inventory was a solid green silhouette
      // with its spots and shading erased, and every dyed leather piece was a flat blob. Two
      // bugs, one cause: a rule written twice and right neither time.
      // #10807: a potion / tipped arrow multiplies its UNTINTED tile by PotionUtil.getColor(stack) per stack
      var stT = IT.stackTintOf ? IT.stackTintOf(stack.i) : null;
      for (var L = 0; L < layers.length; L++) {
        var t = layers[L];
        if (stT && stT[0] === L && cmpT < 0) t = stT[1];
        var sx = (t % cols) * T, sy = ((t / cols) | 0) * T;
        if (stT && stT[0] === L && cmpT < 0) {
          var tc = H.tintedTile(t, IT.stackColor(stack));
          c.drawImage(tc, 0, 0, T, T, x, y, size, size);
        } else c.drawImage(H.itemSheet, sx, sy, T, T, x, y, size, size);
        drew = true;
      }
    }
    // a block item with no sprite falls back to the BLOCK icon sheet, which is what the hotbar
    // drew before items existed at all.
    // ⚠ A `builtin/entity` ITEM (a chest, a bed, a banner, a skull, …) MUST SKIP THIS PATH
    // (loop/skull-item-icon). Every BlockItem now resolves a real placeable state (D-331), so
    // `IT.stateOf` is >= 0 for these too, and `H.drawIcon` "succeeds" by drawing the block's
    // MISSING-TEXTURE placeholder (magenta/black) — these blocks have no baked model, only a
    // block-entity renderer, so the block-icon rasteriser has no real picture to give back. That
    // placeholder set `drew = true` and the correct picture two lines down, `H.beCanvas`, never
    // ran. Vanilla draws these the same way: a `builtin/entity` item's `BlockEntityWithoutLevel
    // Renderer` is asked FIRST and a block model is never consulted at all.
    var BE = NS.BEModel;
    var entityItem = !!(BE && BE.isEntityItem && BE.isEntityItem(IT.names[stack.i]));
    // #4982: a block item draws ITS OWN model first (see `H.itemModelCanvas`)
    if (!drew && !entityItem && IT && IT.modelPartOf) {
      var im = H.itemModelCanvas(stack.i, size);
      if (im) { c.drawImage(im, 0, 0, im.width, im.height, x, y, size, size); drew = true; }
    }
    if (!drew && !entityItem && IT && IT.stateOf) {
      var st = IT.stateOf(stack.i);
      if (st >= 0) { H.drawIcon(c, st, x, y, size); drew = true; }
    }
    // ⚠ PLAN G10c — AND A `builtin/entity` ITEM FALLS BACK TO ITS BLOCK-ENTITY MODEL, which is
    // the last of the three paths and the one sixty items were falling off the end of. A chest
    // has no sprite AND no block model; before this it drew nothing at all.
    if (!drew) {
      var be = H.beCanvas(IT.names[stack.i], size, stack.t);
      if (be) { c.drawImage(be, x, y, size, size); drew = true; }
    }

    var g = NS.Gui;
    if (drew && H.stackHasGlint(stack)) H.drawGlint(c, stack, x, y, size);
    if (stack.n > 1 && g && g.ready) {
      var label = String(stack.n);
      var k = Math.max(1, Math.round(size / 16));
      // vanilla: (x + 19 - 2 - width, y + 6 + 3) in GUI pixels (ItemRenderer.renderGuiItemOverlay)
      g.text(c, label, x + 17 * k - g.textWidth(label) * k, y + 9 * k, k, 0xFFFFFF, true);
    }
    // the durability bar, drawn only once something is damaged — vanilla hides a full one
    var dur = IT && IT.durability ? IT.durability[stack.i] : 0;
    if (dur && stack.d > 0) {
      var frac = Math.max(0, 1 - stack.d / dur);
      // vanilla GUI-pixel geometry: black 13x2 at (x+2, y+13), colour step = round(13 - d*13/max) x 1
      var k2 = Math.max(1, Math.round(size / 16));
      var step = Math.round(13 - Math.min(stack.d, dur) * 13 / dur);
      var bx = x + 2 * k2, by = y + 13 * k2;
      c.fillStyle = '#000000';
      c.fillRect(bx, by, 13 * k2, 2 * k2);
      // vanilla's own hue ramp: green at full, red at empty
      var hue = Math.round(frac * 120);
      c.fillStyle = 'hsl(' + hue + ',100%,50%)';
      c.fillRect(bx, by, step * k2, k2);
    }
  };

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  // GameRenderer.showFloatingItem / tick / renderFloatingItem (GameRenderer.java:689-695, 1183-1220)
  H.floatingItem = null; H.floatingItemTimeLeft = 0; H.floatingItemWidth = 0; H.floatingItemHeight = 0;
  H.showFloatingItem = function (stack) {
    H.floatingItem = stack; H.floatingItemTimeLeft = 40;
    H.floatingItemWidth = Math.random() * 2 - 1; H.floatingItemHeight = Math.random() * 2 - 1;
  };
  H.tickFloatingItem = function () {
    if (H.floatingItemTimeLeft > 0 && --H.floatingItemTimeLeft === 0) H.floatingItem = null;
  };
  H.drawFloatingItem = function (c) {
    if (!H.floatingItem || H.floatingItemTimeLeft <= 0) return;
    var t = (40 - H.floatingItemTimeLeft) / 40, t2 = t * t, t3 = t * t2;
    var a = (10.25 * t3 * t2 - 24.95 * t2 * t2 + 25.5 * t3 - 13.8 * t2 + 4 * t) * Math.PI;
    var s = Math.abs(Math.sin(a * 2)), size = Math.max(1, 50 + 175 * Math.sin(a));
    var x = H.w / 2 + H.floatingItemWidth * (H.w / 4) * s, y = H.h / 2 + H.floatingItemHeight * (H.h / 4) * s;
    H.drawItem(c, H.floatingItem, x - size / 2, y - size / 2, size);
  };
  H.draw = function () {
    var c = H.ctx;
    if (!c) return;
    c.clearRect(0, 0, H.w, H.h);
    c.imageSmoothingEnabled = false;
    if (H.mode === 'loading') return H.drawLoading(c);
    if (H.mode === 'title') { H.hit.length = 0; return H.drawTitle(c); }
    if (H.mode !== 'game') return;
    if (NS.Main && NS.Main.tickErrorBanner) {   // #7650: a tick threw; the loop kept going
      c.font = '12px monospace'; c.fillStyle = '#ef5f5f'; c.textAlign = 'left';
      c.fillText(NS.Main.tickErrorBanner, 6, 14);
    }

    H.drawFluidOverlay(c);
    H.drawFreezeOverlay(c);
    H.drawCrumbling(c);          // G10: under the outline, as vanilla has it
    H.drawSelection(c);
    H.drawInWall(c);             // G17-O2b: the block the eye is inside, at 0.1 colour
    H.drawSpyglass(c);           // #8065: InGameHud.renderSpyglassOverlay (else branch = pumpkin)
    H.drawPumpkinBlur(c);        // G17-O3: before the crosshair, vignette-order and hotbar, so the HUD stays on top
    H.drawNameplates(c);   // loop/nameplate: over particles, same always-on-top overlay
    // ⚠ THE HAND IS NOT DRAWN HERE ANY MORE (D-359). It is geometry in the renderer's own pass,
    // after the world and after a depth clear, exactly as vanilla draws it.
    H.drawVignette(c);
    if (!H.screen) H.drawCrosshair(c);
    H.drawSurvival(c);
    H.drawHotbar(c);
    H.drawAttackHotbar(c);
    H.drawSelectedItemName(c);
    if (NS.ScoreboardHud) NS.ScoreboardHud.draw(c, H);   // G26f: sidebar objective
    if (NS.PlayerList) NS.PlayerList.draw(c, H);   // G17-O9: Tab list
    H.drawEffectOverlay(c);      // #297: InGameHud.renderStatusEffectOverlay
    H.drawBossBars(c);           // #1584: BossBarHud, top of the screen
    H.drawFloatingItem(c);       // GameRenderer.renderFloatingItem: over the hotbar
    H.drawTitles(c);             // G12d: over the hotbar, under the chat, as vanilla has it
    var slp = NS.Player && NS.Gui.sleepOverlay(NS.Player.sleepTimer);   // G17-O8: InGameHud sleep fade
    if (slp) {
      c.fillStyle = 'rgba(16,16,32,' + (((slp.argb >>> 24) & 255) / 255).toFixed(4) + ')';
      c.fillRect(0, 0, H.w, H.h);
    }
    H.drawSubtitles(c);          // #8340: SubtitlesHud, bottom right
    H.drawChat(c);               // G12: under the debug overlay, over the hotbar (D-283)
    if (H.showDebug) H.drawDebug(c);
    if (H.needClick && !H.screen) H.drawClickPrompt(c);
    H.drawToast(c);

    H.hit.length = 0;
    if (H.screen === 'pause') H.drawPause(c);      // G11c: vanilla's Options tree
    else if (H.screen === 'creative') H.drawCreative(c);
    else if (H.screen === 'inventory') { H.drawInventory(c); H.drawInventoryEffects(c); }
    else if (H.screen === 'bench') H.drawBenchReport(c);
    else if (H.screen === 'chest') H.drawChest(c);
    else if (H.screen === 'crafting') H.drawCrafting(c);
    else if (H.screen === 'furnace') H.drawFurnace(c);
    else if (H.screen === 'enchanting') H.drawEnchanting(c);
    else if (H.screen === 'hopper') H.drawHopper(c);
    else if (H.screen === 'anvil') H.drawAnvil(c);
    else if (H.screen === 'command') H.drawCommandBlock(c);
    else if (H.screen === 'book') H.drawBook(c);
    else if (H.screen === 'bookread') H.drawBookRead(c);
    else if (H.screen === 'dispenser') H.drawDispenser(c);
    else if (H.screen === 'brewing') H.drawBrewing(c);
    else if (H.screen === 'grindstone') H.drawGrindstone(c);
    else if (H.screen === 'stonecutter') H.drawStonecutter(c);
    else if (H.screen === 'cartography') H.drawCartography(c);
    else if (H.screen === 'loom') H.drawLoom(c);
    else if (H.screen === 'book') H.drawBook(c);
    else if (H.screen === 'trading') H.drawTrading(c);
    else if (H.screen === 'horse') H.drawHorse(c);
    if (NS.Bench && NS.Bench.running) H.drawBench(c);
  };

  // --- title (blocker B2, D-16) -----------------------------------------------
  //
  // Dan: "have there be an ultra crude menu so it just doesnt instantly laUNCH ME IN."
  //
  // Deliberately crude, and deliberately BEFORE world generation. Five settings live here
  // and nowhere else, because they are read once when the world starts and cannot be changed
  // afterwards without regenerating it: the seed, the renderer backend, the quality preset,
  // and — PLAN W4, D-111 — the CLIMATE MODE and the WORLD SCALE. Everything else stays in the
  // pause menu where it can be changed live.
  //
  // ⚠ The climate rows are DISABLED once a saved world exists, because they cannot apply to
  // it: changing the climate of a world that has been built in would move every biome out
  // from under everything in it. 'New world — erase saved changes' is what re-enables them,
  // and that is the honest place for the choice to reappear.

  // #329: `generator.<type>` in 1.18.2's en_us.json.
  H.WORLD_TYPE_NAMES = { 'default': 'Default', large_biomes: 'Large Biomes', amplified: 'AMPLIFIED' };

  H.drawTitle = function (c) {
    var S = NS.Settings, M = NS.Main;
    var w = Math.min(460, H.w - 40);
    var rh = 30, gap = 8, HEAD = 56, FOOT = 44;
    // 4 rows always (seed, renderer, quality, play) plus the erase row only when there is
    // something to erase — the panel shrinks rather than leaving a hole where a button is not.
    var rows = 6 + (H.titleHasSave ? 1 : 0) + (NS.Save.climate === 'earth' ? 1 : 0);
    var h = Math.min(H.h - 30, HEAD + rows * (rh + gap) + FOOT + 10);
    var x = (H.w - w) * 0.5, y = (H.h - h) * 0.5;

    // background: a flat sky-to-ground gradient rather than a black rectangle, so the very
    // first frame after a double-click already looks like something rather than a failure.
    var g = c.createLinearGradient(0, 0, 0, H.h);
    g.addColorStop(0, '#5b86c4'); g.addColorStop(0.55, '#8fb4dd'); g.addColorStop(0.551, '#3c3428');
    g.addColorStop(1, '#241f19');
    c.fillStyle = g; c.fillRect(0, 0, H.w, H.h);

    c.fillStyle = 'rgba(0,0,0,0.30)'; c.fillRect(0, 0, H.w, H.h);
    c.fillStyle = 'rgba(24,28,34,0.96)'; c.fillRect(x, y, w, h);
    c.strokeStyle = '#454c57'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    c.textAlign = 'center';
    c.fillStyle = '#e8e8e8';
    c.font = '600 30px ' + UIFONT;
    c.fillText('MC-Lite', x + w * 0.5, y + 36);
    c.font = '11px ' + UIFONT;
    c.fillStyle = '#8d95a1';
    c.fillText('a small voxel world that fits in one file', x + w * 0.5, y + 51);
    c.textAlign = 'left';

    var i = 0;
    var rowY = function () { return y + HEAD + (i++) * (rh + gap); };
    var pad = 20, iw = w - pad * 2;

    // ── seed ────────────────────────────────────────────────────────────────
    var sy = rowY();
    c.font = '12px ' + UIFONT;
    c.fillStyle = '#c8cdd4';
    c.fillText('Seed', x + pad, sy + rh * 0.5 + 4);
    var fx = x + pad + 46, fw = iw - 46;
    c.fillStyle = H.titleSeedFocus ? '#20252c' : '#191d23';
    c.fillRect(fx, sy, fw, rh);
    c.strokeStyle = H.titleSeedFocus ? '#7fa4d8' : '#3a414b';
    c.strokeRect(fx + 0.5, sy + 0.5, fw - 1, rh - 1);
    c.fillStyle = H.titleSeed.length ? '#e8e8e8' : '#5c646f';
    c.font = '13px ' + UIFONT;
    var shown = H.titleSeed.length ? H.titleSeed : 'random';
    c.fillText(shown, fx + 8, sy + rh * 0.5 + 5);
    if (H.titleSeedFocus && ((Date.now() / 500) | 0) % 2 === 0) {
      var tw = c.measureText(shown).width;
      c.fillStyle = '#e8e8e8';
      c.fillRect(fx + 9 + (H.titleSeed.length ? tw : 0), sy + 6, 1, rh - 12);
    }
    push(fx, sy, fw, rh, function () { if (!H.titleHasSave) H.titleSeedFocus = true; });

    // ── renderer ────────────────────────────────────────────────────────────
    // ⚠ WebGL2 is first and is the default. WebGPU renders a black world with a working GUI
    // on Dan's RX 6800XT without reporting a failure (D-15), so it is offered, labelled, and
    // never chosen for him.
    var ry = rowY();
    c.fillStyle = '#c8cdd4'; c.font = '12px ' + UIFONT;
    c.fillText('Renderer', x + pad, ry + rh * 0.5 + 4);
    var bw = (iw - 76) * 0.5;
    var cur = S.backend === 'webgpu' ? 'webgpu' : 'webgl2';
    button(c, x + pad + 76, ry, bw, rh, 'WebGL2', function () { S.backend = 'auto'; S.save(); },
           cur === 'webgl2', 12);
    button(c, x + pad + 76 + bw + 4, ry, bw - 4, rh, 'WebGPU *', function () { S.backend = 'webgpu'; S.save(); },
           cur === 'webgpu', 12);

    // ── quality ─────────────────────────────────────────────────────────────
    var qy = rowY();
    c.fillStyle = '#c8cdd4'; c.font = '12px ' + UIFONT;
    c.fillText('Quality', x + pad, qy + rh * 0.5 + 4);
    var presets = (S.ORDER || ['low', 'medium', 'high']);
    var pw = (iw - 76) / presets.length;
    for (var pi = 0; pi < presets.length; pi++) {
      (function (name, px) {
        button(c, px, qy, pw - 3, rh, name, function () { S.applyPreset(name); }, S.preset === name, 11);
      })(presets[pi], x + pad + 76 + pi * pw);
    }

    var locked = H.titleHasSave;

    // ── world type (#329) ───────────────────────────────────────────────────
    // Vanilla's `MoreOptionsDialog` map-type CyclingButtonWidget: "World Type: <name>", a click
    // steps forward through `GeneratorType.VALUES`, a shift-click steps back. Only the three
    // types that are the noise generator with other settings are offered (Column.WORLD_TYPES);
    // superflat, single biome and debug are separate generators. Fixed for the life of a world,
    // like the climate, and locked the same way.
    var ty = rowY();
    c.fillStyle = locked ? '#767c86' : '#c8cdd4'; c.font = '12px ' + UIFONT;
    c.fillText(locked ? 'World \u26bf' : 'World', x + pad, ty + rh * 0.5 + 4);
    var types = (NS.Column && NS.Column.WORLD_TYPES) || ['default', 'large_biomes', 'amplified'];
    var ti = Math.max(0, types.indexOf(NS.Save.worldType || 'default'));
    button(c, x + pad + 76, ty, iw - 76, rh, 'World Type: ' + H.WORLD_TYPE_NAMES[types[ti]],
           function () {
             var step = (NS.Input && NS.Input.shift) ? types.length - 1 : 1;
             NS.Save.worldType = types[(ti + step) % types.length];
           }, false, 12,
           locked ? 'World type is fixed once a world exists \u2014 press "New world" to change it.' : null);

    // ── climate (PLAN W4) ───────────────────────────────────────────────────
    var cy = rowY();
    c.fillStyle = locked ? '#767c86' : '#c8cdd4'; c.font = '12px ' + UIFONT;
    c.fillText(locked ? 'Climate \u26bf' : 'Climate', x + pad, cy + rh * 0.5 + 4);
    var cbw = (iw - 76) * 0.5;
    // D-426: `locked` is passed to the button as the REASON it is dead, not checked inside the
    // handler, so the button draws dead, refuses to hover, and answers when it is pressed.
    var lockWhy = locked ? 'Climate is fixed once a world exists \u2014 press "New world" to change it.' : null;
    button(c, x + pad + 76, cy, cbw, rh, 'Vanilla',
           function () { NS.Save.climate = 'vanilla'; },
           NS.Save.climate !== 'earth', 12, lockWhy);
    button(c, x + pad + 76 + cbw + 4, cy, cbw - 4, rh, 'Earth',
           function () { NS.Save.climate = 'earth'; },
           NS.Save.climate === 'earth', 12, lockWhy);

    // ── world scale, only when it means anything ────────────────────────────
    if (NS.Save.climate === 'earth') {
      var wy = rowY();
      c.fillStyle = locked ? '#767c86' : '#c8cdd4'; c.font = '12px ' + UIFONT;
      c.fillText(locked ? 'Pole at \u26bf' : 'Pole at', x + pad, wy + rh * 0.5 + 4);
      var scales = [3000, 6000, 12000, 24000, 60000];
      var sw = (iw - 76) / scales.length;
      for (var si = 0; si < scales.length; si++) {
        (function (v, sx) {
          button(c, sx, wy, sw - 3, rh, v >= 1000 ? (v / 1000) + 'k' : String(v),
                 function () { NS.Save.worldScale = v; },
                 NS.Save.worldScale === v, 11, lockWhy);
        })(scales[si], x + pad + 76 + si * sw);
      }
    }

    // ── play ────────────────────────────────────────────────────────────────
    var py = rowY() + 4;
    button(c, x + pad, py, iw, rh + 8,
           H.titleHasSave ? 'Continue world' : 'Create world',
           function () { if (M && M.play) M.play(H.titleHasSave ? {} : { seed: H.titleSeed }); }, true, 15);

    var ny = rowY() + 2;
    if (H.titleHasSave) {
      button(c, x + pad, ny, iw, rh, 'New world — erase saved changes', function () {
        // ⚠⚠ **IT CLEARS AND COMES BACK HERE; IT DOES NOT PLAY (D-415).** Clearing the save and
        // immediately re-entering `boot()` was the bug: the seed box is still showing the OLD
        // world's seed, so "new world" built the same terrain, and `Save.playerState` was still
        // in memory from the first boot, so it put the player back where he was. Both of those
        // are fixed — `Save.reset()` forgets the player and the sky as well as the blocks — but
        // the right behaviour is still to return to THIS screen with a new seed showing and the
        // climate rows unlocked, so the choice a new world is actually made of is visible and
        // editable before anything is generated. That is also what vanilla does: erasing a world
        // does not start one.
        NS.Save.reset();
        H.titleHasSave = false;
        H.titleSeed = String((Math.random() * 0x7FFFFFFF) | 0);
        H.titleSeedFocus = true;
      }, false, 12);
    }

    // ── footer ──────────────────────────────────────────────────────────────
    c.textAlign = 'center';
    c.font = '10px ' + UIFONT;
    c.fillStyle = '#7d858f';
    c.fillText('* WebGPU renders a black world on some cards — F9 swaps at any time.',
               x + w * 0.5, y + h - 28);
    // D-426: pressing a locked row sets `titleNote`; for three seconds the footer says THAT,
    // in amber, instead of the standing line. A press that changes nothing must still answer.
    var noteFresh = H.titleNote && (NS.U.now() - (H.titleNoteT || 0)) < 3;
    c.fillStyle = noteFresh ? '#e0b45a' : '#666d77';
    // #329: vanilla draws `generator.amplified.info` under the button while AMPLIFIED is chosen.
    if (!noteFresh && !H.titleHasSave && NS.Save.worldType === 'amplified') c.fillStyle = '#a0a0a0';
    c.fillText(noteFresh ? H.titleNote : (!H.titleHasSave && NS.Save.worldType === 'amplified')
      ? 'Notice: Just for fun! Requires a beefy computer.' : (H.titleHasSave
      ? 'Enter to play  ·  climate is fixed for the life of a world'
      : 'Enter to play  ·  type to change the seed  ·  Earth puts the poles ' +
        (NS.Save.worldScale / 1000) + 'k blocks north and south'),
      x + w * 0.5, y + h - 13);
    c.textAlign = 'left';
  };

  /** Typing on the title screen. Returns true when the key was consumed. */
  H.titleKey = function (key) {
    if (H.mode !== 'title') return false;
    // an existing world's seed is fixed (vanilla: level.dat) - no typing, and Play passes no seed
    if (key === 'Enter') { if (NS.Main && NS.Main.play) NS.Main.play(H.titleHasSave ? {} : { seed: H.titleSeed }); return true; }
    if (H.titleHasSave && (key === 'Backspace' || key.length === 1)) return true;
    if (key === 'Backspace') { H.titleSeed = H.titleSeed.slice(0, -1); H.titleSeedFocus = true; return true; }
    if (key.length === 1 && H.titleSeed.length < 32) { H.titleSeed += key; H.titleSeedFocus = true; return true; }
    return false;
  };

  // --- loading ---------------------------------------------------------------

  H.drawLoading = function (c) {
    var cx = H.w * 0.5, cy = H.h * 0.5;
    c.fillStyle = '#0b0d10';
    c.fillRect(0, 0, H.w, H.h);
    c.textAlign = 'center';
    c.fillStyle = '#e8e8e8';
    c.font = '600 26px "Segoe UI",Tahoma,DejaVu Sans,sans-serif';
    c.fillText('MC-Lite', cx, cy - 78);

    // real progress, not a spinner
    var bw = Math.min(420, H.w - 64), bh = 8, bx = cx - bw * 0.5, by = cy - 56;
    c.fillStyle = '#1b1f26'; c.fillRect(bx, by, bw, bh);
    c.fillStyle = '#7fc26a'; c.fillRect(bx, by, bw * H.progress, bh);
    c.strokeStyle = '#333a44'; c.lineWidth = 1;
    c.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    c.font = '13px "Segoe UI",Tahoma,DejaVu Sans,sans-serif';
    c.fillStyle = '#9aa0a6';
    c.fillText(H.progressLabel || 'loading…', cx, by + 28);

    c.font = '12px ui-monospace,Consolas,"DejaVu Sans Mono",monospace';
    c.textAlign = 'left';
    var x = Math.max(16, cx - 210), y = by + 54;
    for (var i = 0; i < H.status.length; i++) {
      var line = H.status[i];
      c.fillStyle = line.charAt(0) === '!' ? '#ff8a7a' : '#7f868c';
      c.fillText(line, x, y + i * 17);
    }
  };

  // --- screen vignette: `InGameHud.renderVignetteOverlay` (G17-O6, #7880) -----------------
  // Only on Fancy graphics (MC-Lite's Fancy = Settings.fancyLeaves). Each tick
  //   f = clamp(1 - entity.getBrightness(), 0, 1);  vignetteDarkness += (f - vignetteDarkness) * 0.01
  // and the draw multiplies the frame by (1 - darkness) toward the edges. NOT built: the world-border
  // red tint (src/ has no WorldBorder); that half is a separate unit. The vignette.png texture is
  // approximated by a radial gradient on the overlay canvas (rendering deviation only).
  H.vignetteDarkness = 0;
  H.VIGNETTE_RATE = 0.01;
  H.vignetteStep = function (dark, brightness, rate) {
    var f = 1 - brightness; f = f < 0 ? 0 : f > 1 ? 1 : f;
    return dark + (f - dark) * rate;
  };
  /** Entity.getBrightness at the eyes: computeBrightnessByLightLevel(max(block, sky - darken)). */
  H.eyeBrightness = function () {
    var W = NS.World, P = NS.Player, S = NS.Sky;
    if (!W || !W.getLight || !P) return 0;
    var L = W.getLight(Math.floor(P.x), Math.floor(P.y + (P.eyeHeight || 1.62)), Math.floor(P.z));
    var dk = (S && S.darknessNow) ? S.darknessNow() : 0;
    var l = Math.max(L & 15, ((L >> 4) & 15) - dk), f = l / 15;
    return f / (4 - 3 * f);
  };
  H.tickVignette = function () {
    if (!NS.Settings || !NS.Settings.fancyLeaves) return;
    H.vignetteDarkness = H.vignetteStep(H.vignetteDarkness, H.eyeBrightness(), H.VIGNETTE_RATE);
  };
  H.drawVignette = function (c) {
    var S = NS.Settings, d = H.vignetteDarkness;
    if (!S || !S.fancyLeaves || !(d > 0.003)) return;
    var w = c.canvas.width, h = c.canvas.height;
    var g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + Math.min(1, d) + ')');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  };

  // --- crosshair, fluids, toast ---------------------------------------------

  /**
   * `InGameHud.renderCrosshair` (.decomp 379-426): icons.png (0,0,15,15) at ((w-15)/2, (h-15)/2),
   * then the ATTACK INDICATOR (Options.attackIndicator: 0 Off, 1 Crosshair (default), 2 Hotbar).
   * The blit is a plain drawImage on the overlay canvas: vanilla's ONE_MINUS_DST_COLOR inversion
   * cannot be done against the world from a separate canvas, so the sprite's own white shows —
   * a rendering deviation only (the shape, size and place are vanilla's). There is no break-progress
   * ring: in vanilla break progress is only the destroy_stage overlay on the block (drawCrumbling).
   * Everything is in GUI pixels (`H.scale` per GUI pixel), integer-divided like vanilla.
   * Rects are [sheetRect, guiX, guiY] so `crosshairBlits` can be asserted without a canvas.
   */
  H.ATTACK_ICONS = {
    crossFull: [68, 94, 16, 16], barBg: [36, 94, 16, 4], barFg: [52, 94, 16, 4],
    hotbarBg: [0, 94, 18, 18], hotbarFg: [18, 94, 18, 18]
  };
  H.CROSS = [0, 0, 15, 15];

  /** Vanilla's spectator rule, simplified: only a targeted block entity (a container) keeps it. */
  H.spectatorCrosshair = function () {
    var P = NS.Player, BE = NS.BlockEntities;
    if (!P || !P.hasTarget || !BE) return false;
    return !!BE.get(P.tx, P.ty, P.tz);
  };

  /**
   * The list of blits for one frame: [{ r, x, y, w }] in GUI px (w = clipped width for the fill).
   * `st` = { w, h (GUI px), mode (0/1/2), p (cooldown 0..1), perTick, living }.
   */
  H.crosshairBlits = function (st) {
    var out = [{ r: H.CROSS, x: ((st.w - 15) / 2) | 0, y: ((st.h - 15) / 2) | 0, w: 15 }];
    var I = H.ATTACK_ICONS;
    if (st.mode === 1) {
      var full = st.p >= 1 && st.living && st.perTick > 5;
      var y = ((st.h / 2) | 0) - 7 + 16, x = ((st.w / 2) | 0) - 8;
      if (full) out.push({ r: I.crossFull, x: x, y: y, w: 16 });
      else if (st.p < 1) {
        out.push({ r: I.barBg, x: x, y: y, w: 16 });
        out.push({ r: I.barFg, x: x, y: y, w: (st.p * 17) | 0 });
      }
    }
    return out;
  };

  /** The HOTBAR variant: (0,94,18,18) at (w/2+91+6, h-20), fill (18,112-n,18,n) rising, n=(int)(p*19). */
  H.hotbarIndicatorBlits = function (st) {
    var out = [];
    if (st.mode !== 2 || !(st.p < 1)) return out;
    var x = ((st.w / 2) | 0) + 91 + 6, y = st.h - 20, n = (st.p * 19) | 0;
    if (st.mainHand === 'left') x = ((st.w / 2) | 0) - 91 - 22;   // InGameHud: opposite arm RIGHT -> right side, else left
    out.push({ r: H.ATTACK_ICONS.hotbarBg, x: x, y: y, w: 18 });
    if (n > 0) out.push({ r: [18, 112 - n, 18, n], x: x, y: y + 18 - n, w: 18 });
    return out;
  };

  H.attackState = function () {
    var P = NS.Player, S = NS.Settings, Hd = NS.Hand, s = H.scale;
    var held = P && P.heldItem ? P.heldItem() : null;
    var tgt = P && P.targetEntity;
    return {
      w: (H.w / s) | 0, h: (H.h / s) | 0,
      mainHand: S && S.mainHand,
      mode: S && S.attackIndicator !== undefined ? S.attackIndicator : 1,
      p: Hd ? Hd.attackStrengthScale(held, 0) : 1,
      perTick: Hd ? Hd.attackStrengthDelay(held) : 5,
      living: !!(tgt && tgt.health !== undefined && tgt.health > 0)
    };
  };

  /** InGameHud.render: a spectator gets the spectator menu, not the hotbar, attack indicator or item name. */
  H.spectatorHud = function () {
    var P = NS.Player, Gm = NS.Gamemode;
    return !!(P && Gm && Gm.isSpectator && Gm.isSpectator(P));
  };

  H.drawAttackHotbar = function (c) {
    var g = NS.Gui, s = H.scale;
    if (!g || !g.ready || H.spectatorHud()) return;
    var b = H.hotbarIndicatorBlits(H.attackState());
    for (var i = 0; i < b.length; i++) g.blitPart(c, 'icons', b[i].r, b[i].x * s, b[i].y * s, s, 1);
  };

  H.drawCrosshair = function (c) {
    var P = NS.Player, g = NS.Gui, S = NS.Settings;
    if (P && P.mode === 3 && !H.spectatorCrosshair()) return;
    var s = H.scale, st = H.attackState();
    if (!g || !g.ready) return;
    var b = H.crosshairBlits(st);
    for (var i = 0; i < b.length; i++) {
      var q = b[i], r = q.r;
      g.blitPart(c, 'icons', r, q.x * s, q.y * s, s, q.w / r[2]);
    }
  };

  H.drawClickPrompt = function (c) {
    c.textAlign = 'center';
    c.font = '600 15px "Segoe UI",Tahoma,DejaVu Sans,sans-serif';
    var t = 'Click to resume';
    var w = c.measureText(t).width + 28;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(H.w * 0.5 - w * 0.5, H.h * 0.5 + 44, w, 30);
    c.fillStyle = '#e8e8e8';
    c.fillText(t, H.w * 0.5, H.h * 0.5 + 64);
    c.textAlign = 'left';
  };

  /** InGameOverlayRenderer.renderUnderwaterOverlay (#7875): the quad's colour (brightness at the eye, alpha 0.1)
   *  and its four UVs, shifted by -yaw/64 and pitch/64 (degrees) so the texture slides as you look around.
   *  `level` is the 0..15 light at the eye; brightness is DimensionType.computeBrightnessByLightLevel at ambient 0. */
  H.underwaterOverlayQuad = function (yawDeg, pitchDeg, level) {
    var fr = Math.fround, f = fr(level / 15), b = fr(f / fr(4 - fr(3 * f)));
    var du = fr(-yawDeg / 64), dv = fr(pitchDeg / 64);
    return {
      rgba: [b, b, b, fr(0.1)],
      uv: [[fr(4 + du), fr(4 + dv)], [fr(0 + du), fr(4 + dv)], [fr(0 + du), fr(0 + dv)], [fr(4 + du), fr(0 + dv)]]
    };
  };

  /** #9241: misc/underwater.png tiled 4x4 over the screen with underwaterOverlayQuad's colour/alpha/UV slide.
   *  Returns false when the sheet is missing (caller falls back to the flat tint); a spectator draws nothing. */
  H.drawUnderwaterOverlay = function (c) {
    var P = NS.Player, sh = NS.Gui && NS.Gui.sheets && NS.Gui.sheets.underwater;
    if (H.spectatorHud()) return true;
    if (!sh) return false;
    var L = NS.World && NS.World.getLight ? NS.World.getLight(Math.floor(P.x), Math.floor(P.y + 1.62), Math.floor(P.z)) : 255;
    var q = H.underwaterOverlayQuad(P.yaw * 180 / Math.PI, P.pitch * 180 / Math.PI, Math.max(L >> 4, L & 15));
    var b = Math.round(q.rgba[0] * 255), tw = H.w / 4, th = H.h / 4;
    var ox = (((q.uv[1][0] % 1) + 1) % 1) * tw, oy = (((q.uv[1][1] % 1) + 1) % 1) * th;
    var t = H.underwaterTint || (H.underwaterTint = document.createElement('canvas'));
    t.width = sh.canvas.width; t.height = sh.canvas.height;
    var tc = t.getContext('2d');
    tc.drawImage(sh.canvas, 0, 0);
    tc.globalCompositeOperation = 'multiply'; tc.fillStyle = 'rgb(' + b + ',' + b + ',' + b + ')'; tc.fillRect(0, 0, t.width, t.height);
    tc.globalCompositeOperation = 'destination-in'; tc.drawImage(sh.canvas, 0, 0);
    c.save(); c.globalAlpha = q.rgba[3];
    for (var i = -1; i < 4; i++) for (var j = -1; j < 4; j++) c.drawImage(t, 0, 0, t.width, t.height, ox + i * tw, oy + j * th, tw + 1, th + 1);
    c.restore();
    return true;
  };

  H.drawFluidOverlay = function (c) {
    var P = NS.Player;
    if (!P) return;
    if (!P.inLava && P.eyeInWater && H.drawUnderwaterOverlay(c)) return;
    if (P.inLava)          c.fillStyle = 'rgba(200,80,10,0.72)';
    else if (P.eyeInWater) c.fillStyle = 'rgba(28,84,170,0.34)';
    else return;
    c.fillRect(0, 0, H.w, H.h);
  };

  // InGameHud: if getFreezingScale() > 0, renderOverlay(powder_snow_outline, scale). The texture is not
  // embedded, so the outline is a radial icy-blue vignette at the same alpha.
  H.drawFreezeOverlay = function (c) {
    var f = NS.Survival && NS.Survival.freezeScale(NS.Player);
    if (!(f > 0)) return;
    var r = Math.hypot(H.w, H.h) * 0.5, g = c.createRadialGradient(H.w / 2, H.h / 2, r * 0.45, H.w / 2, H.h / 2, r);
    g.addColorStop(0, 'rgba(150,200,255,0)'); g.addColorStop(1, 'rgba(190,225,255,0.85)');
    c.globalAlpha = f; c.fillStyle = g; c.fillRect(0, 0, H.w, H.h); c.globalAlpha = 1;
  };

  // AdvancementToast: 160x32, header coloured per frame, 5 s.
  H.drawAdvToasts = function (c) {
    var q = NS.Adv && NS.Adv.toasts; if (!q || !q.length) return;
    var t = q[0];
    if (NS.U.now() - t.t > 5000) { q.shift(); return; }
    var x = H.w - 160 * (H.scale / 2), sc = H.scale / 2, tx = NS.Text, tr = function (v) { return typeof v === 'string' ? v : (tx && tx.plain ? tx.plain(v) : (v && v.text) || ''); };
    c.fillStyle = 'rgba(30,30,30,0.9)'; c.fillRect(x, 0, 160 * sc, 32 * sc);
    c.font = Math.round(8 * sc) + 'px sans-serif'; c.textAlign = 'left';
    c.fillStyle = t.frame === 'challenge' ? '#ff88ff' : '#ffff00';
    c.fillText(tx && tx.translate ? tr(tx.translate(t.header, [])) : t.header, x + 30 * sc, 12 * sc);
    c.fillStyle = '#fff'; c.fillText(tr(t.title), x + 30 * sc, 24 * sc);
  };

  H.drawToast = function (c) {
    H.drawAdvToasts(c);
    if (!H.toast) return;
    var age = (NS.U.now() - H.toastT) / 1000;
    if (age > 3) { H.toast = ''; return; }
    var a = age > 2.5 ? (3 - age) * 2 : 1;
    c.globalAlpha = a;
    c.textAlign = 'center';
    c.font = '13px "Segoe UI",Tahoma,DejaVu Sans,sans-serif';
    var y = H.h - 78 * (H.scale / 2) - 20;
    var wpx = c.measureText(H.toast).width + 20;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(H.w * 0.5 - wpx * 0.5, y - 15, wpx, 22);
    c.fillStyle = '#e8e8e8';
    c.fillText(H.toast, H.w * 0.5, y);
    c.globalAlpha = 1;
    c.textAlign = 'left';
  };

  // --- projection helpers (D-75) --------------------------------------------

  var pa = [0, 0, 0, 0], pb = [0, 0, 0, 0];

  // ⚠ CAMERA-RELATIVE (D-179). `G.cam.viewProj` is built with the eye at the ORIGIN, so a world
  // point has to be moved into that space before it is multiplied by the matrix — and the
  // subtraction has to happen in JS doubles, which is the only place either number is still
  // exact. These are the two HUD projections D-149 named: the selection outline and the
  // particles. Without this the block outline drifts off the block it is outlining, gently near
  // spawn and by whole blocks in the millions. `eye()` is called once per HUD pass, not per
  // vertex; the three fields it caches are read by every toClip below it.
  var eyeX = 0, eyeY = 0, eyeZ = 0;
  function eye(cam) { eyeX = cam.x; eyeY = cam.y; eyeZ = cam.z; }

  /** World point -> clip coords (x, y, w) in the active camera. */
  function toClip(m, x, y, z, out) {
    var rx = x - eyeX, ry = y - eyeY, rz = z - eyeZ;
    out[0] = m[0] * rx + m[4] * ry + m[8]  * rz + m[12];
    out[1] = m[1] * rx + m[5] * ry + m[9]  * rz + m[13];
    out[3] = m[3] * rx + m[7] * ry + m[11] * rz + m[15];
    return out;
  }

  function screenX(cx, w) { return (cx / w * 0.5 + 0.5) * H.w; }
  function screenY(cy, w) { return (0.5 - cy / w * 0.5) * H.h; }

  /**
   * A world-space line segment, clipped against the near plane in clip space so a corner behind
   * the camera does not fling the line across the screen. Returns false if fully behind.
   */
  function seg(c, m, x0, y0, z0, x1, y1, z1) {
    toClip(m, x0, y0, z0, pa);
    toClip(m, x1, y1, z1, pb);
    var EPS = 1e-4;
    var wa = pa[3], wb = pb[3];
    if (wa <= EPS && wb <= EPS) return false;
    var ax = pa[0], ay = pa[1], bx = pb[0], by = pb[1];
    if (wa <= EPS) { var t = (EPS - wa) / (wb - wa); ax += (bx - ax) * t; ay += (by - ay) * t; wa = EPS; }
    else if (wb <= EPS) { var u = (EPS - wb) / (wa - wb); bx += (ax - bx) * u; by += (ay - by) * u; wb = EPS; }
    c.moveTo(screenX(ax, wa), screenY(ay, wa));
    c.lineTo(screenX(bx, wb), screenY(by, wb));
    return true;
  }

  /**
   * The selection box. Only the faces turned toward the camera are outlined, which is what makes
   * a flat 2D overlay read as a box sitting in the world rather than as a wireframe cube.
   */
  H.drawSelection = function (c) {
    var P = NS.Player, G = NS.Gfx;
    if (!P || !P.hasTarget || !G.cam || H.screen) return;
    var m = G.cam.viewProj;
    eye(G.cam);                                      // D-179: viewProj is eye-relative
    var x = P.tx, y = P.ty, z = P.tz;
    var e = 0.002;                                   // lift off the surface so it never z-fights
    var cx = G.cam.x, cy = G.cam.y, cz = G.cam.z;

    c.lineWidth = Math.max(1.5, H.scale);
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.beginPath();
    // The outline must be drawn from the SAME boxes the crosshair selects on, or it teaches
    // the player the wrong aim point — a slab you can only break by aiming at its bottom half,
    // outlined as though it filled its cell. `Ray.selectionBoxes` answers `Ray.UNIT_BOX` by
    // identity for a full cube, so the common case is the single box this always drew.
    var boxes = NS.Ray && NS.Ray.selectionBoxes ? NS.Ray.selectionBoxes(P.tid, P.tx, P.ty, P.tz) : UNIT;
    for (var bi = 0; bi < boxes.length; bi++) {
      var b = boxes[bi];
      outlineBox(c, m, x + b[0] - e, y + b[1] - e, z + b[2] - e,
                       x + b[3] + e, y + b[4] + e, z + b[5] + e, cx, cy, cz);
    }
    c.stroke();
  };

  var UNIT = [[0, 0, 0, 1, 1, 1]];

  // ── G10: the breaking overlay, and the hand ───────────────────────────────────────────────
  //
  // ⚠ DECLARED RENDERING DEVIATION (D-273). Vanilla draws the crumbling texture as a THIRD
  // geometry pass over the block's own shape, with a multiply blend and a depth offset — two
  // backends, a shader variant and a dynamic mesh. MC-Lite draws it on the HUD canvas that
  // already projects the selection box, as one affine `drawImage` per camera-facing face.
  // The charter permits rendering to be clever instead of faithful; what it does not permit is a
  // deviation without a number, so: the deviation is that a face is drawn as a PARALLELOGRAM
  // rather than with perspective, because a 2D canvas transform is affine. Over one block at
  // arm's length the error is sub-pixel at the centre and under a pixel at the corners; it grows
  // with the block's angular size and a block is never larger than the reach distance allows.
  // ⚠ The alternative — three tiny fills of increasing darkness — was rejected: a block that
  // darkens instead of cracking is exactly the kind of thing Dan's "cannot easily tell it is not
  // Minecraft" bar is about.
  var stageCanvas = null;

  /** The ten crack tiles as 16x16 canvases, built once out of the atlas's own texels. */
  function crackTile(stage) {
    var A = NS.Atlas;
    if (!A || !A.mips) return null;
    if (!stageCanvas) stageCanvas = new Array(NS.Hand.STAGES);
    if (stageCanvas[stage] !== undefined && stageCanvas[stage] !== null) return stageCanvas[stage];
    // ⚠ The name->tile map is `NS.DATA.tiles()`, the one the build ships, and the ten crack tiles
    // are in it under the SAME bare `block/x` spelling as every other tile (D-280). This used to
    // try two spellings because `extract-blocks.mjs` forced them in prefixed; a fallback that
    // silently rescues a naming mistake is how the mistake survives, so there is one lookup.
    var map = (NS.DATA && NS.DATA.tiles) ? NS.DATA.tiles() : null;
    var name = NS.Hand.stageTile(stage);
    var tile = (map && map[name] !== undefined) ? map[name] : -1;
    if (tile < 0) { stageCanvas[stage] = null; return null; }
    var cv = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(16, 16)
      : document.createElement('canvas');
    cv.width = 16; cv.height = 16;
    var cc = cv.getContext('2d');
    var img = cc.createImageData(16, 16);
    var d = A.mips[0].data, base = tile * 16 * 16 * 4;
    for (var i = 0; i < 16 * 16 * 4; i++) img.data[i] = d[base + i];
    cc.putImageData(img, 0, 0);
    stageCanvas[stage] = cv;
    return cv;
  }
  /** Dropped when the atlas is rebuilt, or the overlay keeps the old texture for ever. */
  H.resetCrackTiles = function () { stageCanvas = null; if (H.resetInWallTiles) H.resetInWallTiles(); };

  /** Project one world point to screen, or null when it is behind the near plane. */
  function pt(m, x, y, z, out) {
    toClip(m, x, y, z, pa);
    if (pa[3] <= 1e-4) return null;
    out[0] = screenX(pa[0], pa[3]);
    out[1] = screenY(pa[1], pa[3]);
    return out;
  }

  var q0 = [0, 0], q1 = [0, 0], q2 = [0, 0], q3 = [0, 0];
  /**
   * One TRIANGLE of the overlay: the tile's (t0,t1,t2) mapped onto the screen points (p0,p1,p2),
   * clipped to that triangle.
   *
   * ⚠ TWO TRIANGLES PER FACE, NOT ONE PARALLELOGRAM — and `g10check` is why. The first version
   * drew each face with a single affine transform built from three of its corners, which makes
   * the fourth corner wherever the parallelogram puts it rather than where perspective does.
   * Looking straight down at a block the true far corner projects INWARD, so the parallelogram
   * overshot: the check measured **125 pixels of crack above the block's own rectangle** where a
   * clean frame had 4. A triangle's affine map is EXACT for its three points, so two of them
   * cover the real quad with no overshoot and no gap along the shared diagonal.
   * The residual deviation is that the texture is affine WITHIN each triangle rather than
   * perspective-correct — sub-pixel over one block, and D-273's declared cost.
   */
  function crackTri(c, img, t0x, t0y, t1x, t1y, t2x, t2y, p0, p1, p2) {
    // M maps texture space to screen: solve P = M * T for the 2x2 linear part, then translate.
    var ax = t1x - t0x, ay = t1y - t0y, bx = t2x - t0x, by = t2y - t0y;
    var det = ax * by - ay * bx;
    if (Math.abs(det) < 1e-9) return;
    var ix = by / det, iy = -ay / det, jx = -bx / det, jy = ax / det;   // T inverse
    var ux = p1[0] - p0[0], uy = p1[1] - p0[1];
    var vx = p2[0] - p0[0], vy = p2[1] - p0[1];
    var a = ux * ix + vx * iy, b = uy * ix + vy * iy;
    var cc = ux * jx + vx * jy, d = uy * jx + vy * jy;
    if (Math.abs(a * d - b * cc) < 1e-6) return;         // edge-on: it would smear
    var e = p0[0] - (a * t0x + cc * t0y), f = p0[1] - (b * t0x + d * t0y);
    c.save();
    c.beginPath();
    c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); c.closePath();
    c.clip();
    c.setTransform(a, b, cc, d, e, f);
    c.drawImage(img, 0, 0, 16, 16);
    c.restore();
  }

  /**
   * One face of the crumbling overlay, as its two triangles. The corners are given in texture
   * order: `a` is (0,0), `b` is (16,0), `d` is (0,16) and the fourth is b + d - a.
   */
  function crackFace(c, m, img, ax, ay, az, bx, by, bz, dx, dy, dz) {
    var cx = bx + dx - ax, cy = by + dy - ay, cz = bz + dz - az;
    if (!pt(m, ax, ay, az, q0) || !pt(m, bx, by, bz, q1)) return;
    if (!pt(m, dx, dy, dz, q2) || !pt(m, cx, cy, cz, q3)) return;
    crackTri(c, img, 0, 0, 16, 0, 0, 16, q0, q1, q2);
    crackTri(c, img, 16, 0, 16, 16, 0, 16, q1, q3, q2);
  }

  /**
   * The crumbling overlay over the block being broken. Drawn BEFORE the selection outline so the
   * outline stays on top, which is what vanilla looks like.
   */
  H.drawCrumbling = function (c) {
    var P = NS.Player, G = NS.Gfx, Hd = NS.Hand;
    if (!P || !P.hasTarget || !G.cam || H.screen) return;
    if (!Hd || Hd.crackStage < 0) return;
    var img = crackTile(Hd.crackStage);
    if (!img) return;
    var m = G.cam.viewProj;
    eye(G.cam);
    var x = P.tx, y = P.ty, z = P.tz;
    var cx = G.cam.x, cy = G.cam.y, cz = G.cam.z;
    var e = 0.003;                                  // the same lift the outline uses
    var boxes = NS.Ray && NS.Ray.selectionBoxes ? NS.Ray.selectionBoxes(P.tid, P.tx, P.ty, P.tz) : UNIT;
    var old = c.globalCompositeOperation;
    // `multiply` is what vanilla's crumbling blend does: the crack darkens the block rather than
    // painting over it, so a white block still shows dark cracks.
    c.globalCompositeOperation = 'multiply';
    for (var bi = 0; bi < boxes.length; bi++) {
      var b = boxes[bi];
      var x0 = x + b[0] - e, y0 = y + b[1] - e, z0 = z + b[2] - e;
      var x1 = x + b[3] + e, y1 = y + b[4] + e, z1 = z + b[5] + e;
      if (cx > x1) crackFace(c, m, img, x1, y1, z0, x1, y1, z1, x1, y0, z0);
      if (cx < x0) crackFace(c, m, img, x0, y1, z1, x0, y1, z0, x0, y0, z1);
      if (cy > y1) crackFace(c, m, img, x0, y1, z0, x1, y1, z0, x0, y1, z1);
      if (cy < y0) crackFace(c, m, img, x0, y0, z1, x1, y0, z1, x0, y0, z0);
      if (cz > z1) crackFace(c, m, img, x0, y1, z1, x1, y1, z1, x0, y0, z1);
      if (cz < z0) crackFace(c, m, img, x1, y1, z0, x0, y1, z0, x1, y0, z0);
    }
    c.globalCompositeOperation = old;
    c.setTransform(1, 0, 0, 1, 0, 0);
  };

  // ⚠⚠ **THE 2D HAND WAS HERE AND IT IS DELETED, NOT DISABLED (D-359, D-139).**
  //
  // `H.drawHand`, `H.heldCanvas`, `H.armCanvas`, `H.warmArm`, `H.armCacheStats` and the 24 MB
  // arm-sprite cache drew the first-person hand by **software-rasterising a model into a canvas
  // and blitting it into the corner of the screen**. Four decisions were spent on it — D-273
  // declared the deviation, D-311 made the item a model instead of a tile, D-320 fixed an arm
  // that had been upside down for a session, D-328 cached 32 frames of the swing because one
  // sprite cost 7.7 ms at 1080p — and Dan's verdict after all four was *"items in your hand are
  // still not even close to vanilla … theres no sway."*
  //
  // He was right, and the reason is that a blit has three degrees of freedom and vanilla's hand
  // needs twelve. The hand is now REAL GEOMETRY drawn by the renderer in its own pass
  // (`14k_hand3d.js` + `Gfx.drawHand`), which is both the parity answer and the fast one: the
  // per-frame software rasterisation is gone entirely.
  //
  // ⚠ `BlockIcon.armSprite` and its rasteriser are kept — the INVENTORY still rasterises icons
  // on the CPU and shares that code. What is gone is the hand's use of it.


  /** The camera-facing faces of one box, appended to the open path. */
  function outlineBox(c, m, x0, y0, z0, x1, y1, z1, cx, cy, cz) {
    // +X / -X
    if (cx > x1) { seg(c,m,x1,y0,z0,x1,y1,z0); seg(c,m,x1,y1,z0,x1,y1,z1); seg(c,m,x1,y1,z1,x1,y0,z1); seg(c,m,x1,y0,z1,x1,y0,z0); }
    if (cx < x0) { seg(c,m,x0,y0,z0,x0,y1,z0); seg(c,m,x0,y1,z0,x0,y1,z1); seg(c,m,x0,y1,z1,x0,y0,z1); seg(c,m,x0,y0,z1,x0,y0,z0); }
    // +Y / -Y
    if (cy > y1) { seg(c,m,x0,y1,z0,x1,y1,z0); seg(c,m,x1,y1,z0,x1,y1,z1); seg(c,m,x1,y1,z1,x0,y1,z1); seg(c,m,x0,y1,z1,x0,y1,z0); }
    if (cy < y0) { seg(c,m,x0,y0,z0,x1,y0,z0); seg(c,m,x1,y0,z0,x1,y0,z1); seg(c,m,x1,y0,z1,x0,y0,z1); seg(c,m,x0,y0,z1,x0,y0,z0); }
    // +Z / -Z
    if (cz > z1) { seg(c,m,x0,y0,z1,x1,y0,z1); seg(c,m,x1,y0,z1,x1,y1,z1); seg(c,m,x1,y1,z1,x0,y1,z1); seg(c,m,x0,y1,z1,x0,y0,z1); }
    if (cz < z0) { seg(c,m,x0,y0,z0,x1,y0,z0); seg(c,m,x1,y0,z0,x1,y1,z0); seg(c,m,x1,y1,z0,x0,y1,z0); seg(c,m,x0,y1,z0,x0,y0,z0); }
  }


  /**
   * The mob nameplate billboard -- `EntityRenderer.render`/`renderLabelIfPresent`
   * (.decomp/net/minecraft/client/render/entity/EntityRenderer.java:61-97). The GATE (who
   * shows a label at all: named, in range, sneak-halved, not ridden/invisible/hud-hidden, and
   * -- since this engine can never set the `CustomNameVisible` NBT tag -- only ever the
   * crosshair's own current target) is `ER.hasLabel` (07j_entityrender.js), read in full there;
   * this function only turns a `true` into pixels. Position: `e.height + 0.5` above the
   * (interpolated) entity origin (EntityRenderer.java:82), projected through the SAME
   * eye-relative `viewProj`/`toClip`/`screenX`/`screenY` pipeline the old break-particle dots used (gone, D-659)
   * (D-179) -- a billboard is a billboard whether it is a spark or a name. Size: vanilla's
   * `0.025` world-unit-per-glyph-texel scale (`ER.LABEL_SCALE`, EntityRenderer.java:19/87)
   * turned into screen pixels the same way a `kh` scale (px per world unit) turns any other world size
   * into one, then handed straight to `Gu.text`'s own `scale` parameter (`px per texel`, the
   * SAME unit `Gu.text` already takes everywhere else in this file, 15b_gui.js).
   *
   * ⚠ DECLARED SIMPLIFICATION -- NOT DEPTH-TESTED. This overlay (like the particle/selection
   * passes right above it) draws unconditionally on top of the 3D frame, with no depth buffer
   * to test against. Vanilla's own label is drawn TWICE when not sneaking (a low-alpha
   * "553648127" ARGB pass with `seeThrough=true`, plus a second full-white `seeThrough=false`
   * depth-tested pass on top) and only ONCE when sneaking (the same low-alpha pass, but
   * depth-tested, so a sneaking mob's label all but disappears behind anything in front of it).
   * Lacking a depth test at all, this draws the bright pass when not sneaking (matching what
   * vanilla's opaque pass shows when nothing occludes it -- the overwhelmingly common case) and
   * the SAME low alpha vanilla's own faint pass carries (0x21/255 = 0.129, decoded from that
   * literal ARGB, not invented) when sneaking -- "dimmer", the RULE this unit was asked to
   * keep, at the cost of the occlusion vanilla layers on top of it. Named here, not silently
   * dropped; `namecheck.mjs` asserts the GATE (`ER.hasLabel`) and the geometry math, not pixels
   * this environment cannot screenshot.
   */
  H.drawNameplates = function (c) {
    var P = NS.Player, G = NS.Gfx, EL = NS.EntityList, S = NS.Settings, Gu = NS.Gui;
    var ER = NS.EntityRender;
    if (!P || !G || !G.cam || !EL || !EL.ready || !EL.list || !Gu || !Gu.ready) return;
    if (!ER || !ER.ready || !ER.hasLabel) return;
    var m = G.cam.viewProj;
    eye(G.cam);                                      // D-179: viewProj is eye-relative
    var kh = H.h * 0.5 / Math.tan(G.cam.fov * Math.PI / 360);    // px per world unit at 1 unit
    var partial = NS.Main && NS.Main.partial ? NS.Main.partial() : 1;
    var hideGui = !!(S && S.hideGui);
    var target = P.targetEntity;
    for (var i = 0; i < EL.list.length; i++) {
      var e = EL.list[i];
      if (!ER.hasLabel(e, G.cam.x, G.cam.y, G.cam.z, target, hideGui)) continue;
      var px = e.px + (e.x - e.px) * partial;
      var py = e.py + (e.y - e.py) * partial;
      var pz = e.pz + (e.z - e.pz) * partial;
      var wy = py + (e.height || 0) + 0.5;            // EntityRenderer.java:82
      toClip(m, px, wy, pz, pa);
      var w = pa[3];
      if (w <= 0.05) continue;
      var s = (ER.LABEL_SCALE * kh) / w;              // world-unit scale -> screen px/texel
      if (s <= 0.05) continue;
      var sx = screenX(pa[0], w), sy = screenY(pa[1], w);
      var label = e.customName;
      var tw = Gu.textWidth(label) * s;
      var sneaky = !!e.sneaking;
      c.fillStyle = 'rgba(0,0,0,0.25)';               // options.getTextBackgroundOpacity(0.25F)
      c.fillRect(Math.round(sx - tw * 0.5 - s), Math.round(sy - s), Math.round(tw + s * 2), Math.round(9 * s));
      c.globalAlpha = sneaky ? 0.129 : 1;              // see this function's own header
      Gu.text(c, label, Math.round(sx - tw * 0.5), Math.round(sy), s, 0xFFFFFF, !sneaky);
      c.globalAlpha = 1;
    }
  };

  // --- hotbar ----------------------------------------------------------------

  /**
   * ⚠ VANILLA'S OWN GEOMETRY (D-274). The hotbar sheet is 182x22 and the game draws it at
   * `x = width/2 - 91`, `y = height - 22`, with the first slot's icon at +3,+3 and a pitch of 20.
   * These are not round numbers and they are not negotiable: every icon, the selector, the hearts
   * and the XP bar are positioned relative to that same `left`, so a hotbar an even 20 px wide
   * puts everything else one pixel out for the rest of the game.
   */
  H.hotbarRect = function () {
    var s = H.scale;
    return {
      x: Math.round((H.w - 182 * s) * 0.5), y: Math.round(H.h - 22 * s),
      w: 182 * s, h: 22 * s, cell: 20 * s, pad: 3 * s, s: s
    };
  };

  /**
   * The survival HUD, out of vanilla's own `icons.png` (D-274).
   *
   * ⚠ THIS REPLACES A PLACEHOLDER, AND D-139 SAID IT MUST. The old one drew hearts and hunger as
   * coloured rectangles — close enough to read at a glance and obviously wrong beside a
   * screenshot. D-139's rule is that a stage which REPLACES something is not done until the
   * something is deleted, in the same commit, so the rectangles are gone rather than kept as a
   * fallback: a fallback nobody sees is a second implementation nobody tests.
   *
   * ⚠ THE LAYOUT IS VANILLA'S, relative to one anchor. `left = width/2 - 91` — the hotbar's own
   * left edge — and then: the XP bar at `height - 32 + 3`, the hearts at `height - 39`, armour
   * ten pixels above them, hunger mirrored from `left + 91` inward. Nine-pixel icons on an
   * eight-pixel pitch, which is why they overlap slightly and why a ten-pixel pitch looks wrong.
   */
  // ── the food row and the mount-health row, as blit lists (#360) ───────────────────────────
  // `InGameHud.renderStatusBars` food loop, `renderMountHealth`, `getHeartCount`. Pure, so a check can
  // read them without a canvas. Entries are {r: sheet rect, x, y} in GUI pixels from `left` / `top`.
  H.ticks = 0;
  /** `getHeartCount`: (int)(maxHealth + 0.5) / 2, capped at 30; 0 for anything not living. */
  H.mountHeartCount = function (v) {
    if (!v || !(v.maxHealth > 0)) return 0;
    return Math.min(30, ((v.maxHealth + 0.5) | 0) >> 1);
  };
  H.mountRows = function (n) { return Math.ceil(n / 10); };
  H.foodRow = function (P, ticks, rnd) {
    var out = [], food = P.food, hunger = !!(NS.Effects && NS.Effects.hasStatusEffect(P, 'hunger'));
    var fu = hunger ? 88 : 52, hu = hunger ? 97 : 61, bu = hunger ? 133 : 16;
    var shake = P.saturation <= 0 && ticks % (food * 3 + 1) === 0;
    for (var i = 0; i < 10; i++) {
      var y = shake ? (rnd() * 3 | 0) - 1 : 0, x = 91 - 9 - i * 8;
      out.push({ r: [bu, 27, 9, 9], x: x, y: y });
      if (i * 2 + 1 < food) out.push({ r: [fu, 27, 9, 9], x: x, y: y });
      else if (i * 2 + 1 === food) out.push({ r: [hu, 27, 9, 9], x: x, y: y });
    }
    return out;
  };
  H.mountRow = function (v) {
    var out = [], n = H.mountHeartCount(v), hp = Math.ceil(v.health), base = 0, dy = 0;
    while (n > 0) {
      var k = Math.min(n, 10);
      n -= k;
      for (var i = 0; i < k; i++) {
        var x = 91 - i * 8 - 9;
        out.push({ r: [52, 9, 9, 9], x: x, y: dy });
        if (i * 2 + 1 + base < hp) out.push({ r: [88, 9, 9, 9], x: x, y: dy });
        else if (i * 2 + 1 + base === hp) out.push({ r: [97, 9, 9, 9], x: x, y: dy });
      }
      dy -= 10; base += 20;
    }
    return out;
  };
  /** java.util.Random(seed).nextInt(bound) for a power-of-two bound (the shaking hearts' jitter). */
  H.heartRandom = function (seed) {
    var st = (BigInt(seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n);
    return function (bound) {
      st = (st * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n);
      return Number((BigInt(bound) * (st >> 17n)) >> 31n);
    };
  };

  H.drawSurvival = function (c) {
    var P = NS.Player, Sv = NS.Survival, g = NS.Gui;
    if (!P || !Sv || P.health === undefined || P.invulnerableGamemode || H.spectatorHud()) return;
    if (!g || !g.ready) return;
    var s = H.scale;
    var L = g.HUD;
    var left = Math.round((H.w - L.barW * s) * 0.5);
    var top = Math.round(H.h + L.rowY * s);
    var IC = g.ICON;
    var i, x;

    // ── experience, OR the jump-charge bar while riding a jumping mount ─────────────────
    // QUEUE 0.2 (G18e remainder) -- `InGameHud.render`: `renderMountJumpBar` draws in this
    // EXACT slot instead of `renderExperienceBar` whenever `player.showsVehicleHealth()`-style
    // gating applies (a saddled mount under the player, `ClientPlayerEntity.hasJumpingMount()`
    // — `canJump()` is `isSaddled()`), never both at once.
    var xpY = Math.round(H.h + L.xpY * s);
    var Mnt = NS.Mount;
    var ridingJumper = !!(P.vehicle && Mnt && Mnt.ready && Mnt.isSaddled(P.vehicle));
    if (ridingJumper) {
      g.blit(c, 'icons', IC.jumpBarBg, left, xpY, s);
      var jStrength = Math.max(0, Math.min(1, P.mountJumpStrength || 0));
      if (jStrength > 0) g.blitPart(c, 'icons', IC.jumpBarFg, left, xpY, s, jStrength);
    } else {
    g.blit(c, 'icons', IC.xpBarBg, left, xpY, s);
    var prog = Math.max(0, Math.min(1, P.xpProgress || 0));
    if (prog > 0) g.blitPart(c, 'icons', IC.xpBarFg, left, xpY, s, prog);
    }
    if (!ridingJumper && P.xpLevel) {
      var lvl = String(P.xpLevel);
      var lw = g.textWidth(lvl) * s;
      var lx = Math.round((H.w - lw) * 0.5), ly = Math.round(H.h + L.xpLevelY * s);
      // vanilla draws the level with a black outline in four directions, not a shadow
      for (var oi = 0; oi < g.XP_OUTLINE.length; oi++) {
        g.text(c, lvl, lx + g.XP_OUTLINE[oi][0] * s, ly + g.XP_OUTLINE[oi][1] * s, s, 0x000000, false);
      }
      g.text(c, lvl, lx, ly, s, 0x80FF20, false);
    }

    // ── hearts: `InGameHud.renderStatusBars` + `renderHealthBar` (#359) ─────────────────
    var hp = H.hearts || (H.hearts = { last: 0, render: 0, jumpEnd: 0, checkTime: 0 });
    var ticks = P.age | 0;
    var Ef = NS.Effects;
    var hasFx = function (n) { return !!(Ef && Ef.hasStatusEffect(P, n)); };
    var health = Math.ceil(P.health);
    var blink = hp.jumpEnd > ticks && Math.floor((hp.jumpEnd - ticks) / 3) % 2 === 1;
    var now = H.heartNow ? H.heartNow() : Date.now();
    if (health < hp.last && P.invulnerableTime > 0) { hp.checkTime = now; hp.jumpEnd = ticks + 20; }
    else if (health > hp.last && P.invulnerableTime > 0) { hp.checkTime = now; hp.jumpEnd = ticks + 10; }
    if (now - hp.checkTime > 1000) { hp.last = health; hp.render = health; hp.checkTime = now; }
    hp.last = health;
    var shown = hp.render;
    var maxH = Math.max(P.maxHealth || Sv.MAX_HEALTH, shown, health);
    var absorb = Math.ceil(P.absorption || 0);
    var rows = Math.ceil((maxH + absorb) / 2 / 10);
    var pitch = Math.max(10 - (rows - 2), 3);
    var regenHeart = hasFx('regeneration') ? ticks % Math.ceil(maxH + 5) : -1;
    // HeartType.fromPlayerState: poison, wither, then isFrozen (frozenTicks >= 140), else normal
    var type = hasFx('poison') ? 2 : hasFx('wither') ? 3 : (P.frozenTicks | 0) >= 140 ? 4 : 1;
    var typeIdx = [0, 2, 4, 6, 9][type];   // frozen (9) has no blinking texture
    var heartRect = function (idx, hasBlink, half, blinking) {
      var k = idx === 0 ? (blinking ? 1 : 0) : (half ? 1 : 0) + (hasBlink && blinking ? 2 : 0);
      return [16 + (idx * 2 + k) * 9, 0, 9, 9];
    };

    // ── armour, ten pixels above the top heart row and only when there is any ───────────
    // ⚠ `P.armor`, NOT `P.armour` (D-290). `14d_survival.js` writes the US spelling, because
    // that is vanilla's own field name and this project takes vanilla's identifiers as they are.
    var armour = P.armor | 0;
    if (armour > 0) {
      for (i = 0; i < 10; i++) {
        x = left + L.heartX(i) * s;
        var ay = top - ((rows - 1) * pitch + 10) * s;
        if (i * 2 + 1 < armour) g.blit(c, 'icons', IC.armourFull, x, ay, s);
        else if (i * 2 + 1 === armour) g.blit(c, 'icons', IC.armourHalf, x, ay, s);
        else g.blit(c, 'icons', IC.armourEmpty, x, ay, s);
      }
    }

    var rnd = H.heartRandom(Math.imul(ticks, 312871));
    var maxC = Math.ceil(maxH / 2), absC = Math.ceil(absorb / 2), totalC = maxC + absC;
    var shake = health + absorb <= 4;
    for (i = totalC - 1; i >= 0; i--) {
      x = left + L.heartX(i % 10) * s;
      var hy = top - Math.floor(i / 10) * pitch * s;
      if (shake) hy += rnd(2) * s;
      if (i < maxC && i === regenHeart) hy -= 2 * s;
      g.blit(c, 'icons', heartRect(0, false, false, blink), x, hy, s);
      var i2 = i * 2;
      if (i >= maxC) {
        var ab = i2 - maxC * 2;
        if (ab < absorb) g.blit(c, 'icons', heartRect(type === 3 ? 6 : 8, false, ab + 1 === absorb, false), x, hy, s);
      }
      if (blink && i2 < shown) g.blit(c, 'icons', heartRect(typeIdx, typeIdx !== 9, i2 + 1 === shown, true), x, hy, s);
      if (i2 < health) g.blit(c, 'icons', heartRect(typeIdx, typeIdx !== 9, i2 + 1 === health, false), x, hy, s);
    }

    // ── hunger, or the mount's hearts while riding one (#360) ───────────────────────────
    // `InGameHud.renderStatusBars`: a ridden LivingEntity with getHeartCount > 0 REPLACES the food row.
    var mountN = H.mountHeartCount(P.vehicle);
    var row = mountN ? H.mountRow(P.vehicle) : H.foodRow(P, H.ticks, Math.random);
    for (i = 0; i < row.length; i++) {
      g.blit(c, 'icons', row[i].r, left + row[i].x * s, top + row[i].y * s, s);
    }

    // ── air, above hunger: while submerged OR air < max (vanilla InGameHud, #361) ──────────────────────────────────────
    // ⚠ `P.eyeInWater` again (D-290) — line 509 above spells it correctly for the screen tint,
    // and this line, in the same file, did not.
    if (P.air !== undefined && (P.eyeInWater || P.air < 300)) {
      var bubbles = Math.ceil((Math.min(P.air, 300) - 2) * 10 / 300);
      var popping = Math.ceil(Math.min(P.air, 300) * 10 / 300) - bubbles;
      for (i = 0; i < bubbles + popping; i++) {
        x = left + L.hungerX(i) * s;
        g.blit(c, 'icons', i < bubbles ? IC.bubbleFull : IC.bubblePop, x, top + (L.armourDY - (mountN ? (H.mountRows(mountN) - 1) * 10 : 0)) * s, s);
      }
    }

    if (P.dead) {
      c.fillStyle = 'rgba(80,0,0,0.55)';
      c.fillRect(0, 0, H.w, H.h);
      var t1 = 'You died!', t2 = 'press R to respawn';
      var k1 = s * 2;
      g.text(c, t1, Math.round((H.w - g.textWidth(t1) * k1) * 0.5), Math.round(H.h * 0.45), k1, 0xFFE8E8, true);
      // ⚠ AND THE CAUSE, which is the line vanilla puts under the title (D-282). "You died"
      // alone is the one thing every clone shows and the real game never does on its own.
      var T = NS.Text;
      if (P.deathMessage && T) {
        var dm = T.plain(P.deathMessage);
        g.text(c, dm, Math.round((H.w - g.textWidth(dm) * s) * 0.5), Math.round(H.h * 0.45 + 22 * s), s, 0xFFFFFF, true);
      }
      g.text(c, t2, Math.round((H.w - g.textWidth(t2) * s) * 0.5), Math.round(H.h * 0.45 + 40 * s), s, 0xFFFFFF, true);
    }
  };

  /**
   * The chat, at `ChatComponent`'s own geometry (D-283).
   *
   * ⚠ EVERY NUMBER HERE IS VANILLA'S and `chatcheck` asserts the arithmetic separately: the box's
   * bottom edge is `height - 40`, its left edge is 4, a line is 9 pixels, the background is drawn
   * at HALF the text's alpha, and a message fades on the curve `clamp((1 - t/200) * 10, 0, 1)²`.
   * The one thing that is NOT vanilla is the input field's cursor, which blinks on a wall clock
   * here rather than on the render tick — a difference of a few milliseconds in a blink.
   */
  // ── the TITLE overlay (G12d, D-326) ────────────────────────────────────────────────────────
  //
  // ⚠ VANILLA'S OWN NUMBERS: `Gui.titleFadeInTime = 10`, `titleStayTime = 70`,
  // `titleFadeOutTime = 20`, and the action bar's own clock runs 60 ticks and fades over the
  // last 20 of them. `titleTime` counts DOWN.
  H.TITLE_TIMES = { fadeIn: 10, stay: 70, fadeOut: 20 };
  H.ACTION_BAR_TIME = 60;
  H.ACTION_BAR_FADE = 20;
  H.titles = { title: null, subtitle: null, time: 0, bar: null, barTime: 0,
               fadeIn: 10, stay: 70, fadeOut: 20 };

  /**
   * ⚠⚠ **A SUBTITLE ALONE SHOWS NOTHING, AND THAT IS VANILLA.** `Gui.render` opens with
   * `if (this.title != null && this.titleTime > 0)` and draws the subtitle INSIDE it, so
   * `/title @s subtitle {...}` with no title is invisible — the commonest confusion there is
   * about this command, and reproducing it is the point.
   */
  H.setTitle = function (comp) {
    H.titles.title = comp;
    H.titles.time = H.titles.fadeIn + H.titles.stay + H.titles.fadeOut;
  };
  H.setSubtitle = function (comp) { H.titles.subtitle = comp; };
  H.setActionBar = function (comp) { H.titles.bar = comp; H.titles.barTime = H.ACTION_BAR_TIME; };
  H.clearTitles = function () { H.titles.title = null; H.titles.subtitle = null; H.titles.time = 0; };
  H.resetTitleTimes = function () {
    H.titles.fadeIn = H.TITLE_TIMES.fadeIn;
    H.titles.stay = H.TITLE_TIMES.stay;
    H.titles.fadeOut = H.TITLE_TIMES.fadeOut;
  };
  /** ⚠ A NEGATIVE MEANS "LEAVE IT ALONE", which is what vanilla's `setTimes` does. */
  H.setTitleTimes = function (fadeIn, stay, fadeOut) {
    if (fadeIn >= 0) H.titles.fadeIn = fadeIn | 0;
    if (stay >= 0) H.titles.stay = stay | 0;
    if (fadeOut >= 0) H.titles.fadeOut = fadeOut | 0;
    // ⚠ AND A TITLE ALREADY ON SCREEN IS RE-TIMED, not left running on the old clock.
    if (H.titles.time > 0) H.titles.time = H.titles.fadeIn + H.titles.stay + H.titles.fadeOut;
  };
  H.tickTitles = function () {
    H.ticks++;
    var oc = H.screen === 'chest' ? H.chestMenu && H.chestMenu.be && H.chestMenu.be.cart : H.screen === 'hopper' && H.hopperCartBe && H.hopperCartBe.cart;
    if (oc && NS.Player && NS.Minecart && NS.Minecart.canPlayerUse && !NS.Minecart.canPlayerUse(oc, NS.Player)) H.close();
    if (H.titles.time > 0) H.titles.time--;
    if (H.titles.barTime > 0) H.titles.barTime--;
  };

  /** The width a run list will draw at, so it can be centred before it is drawn. */
  function runsWidth(runs, s) {
    var g = NS.Gui, w = 0;
    for (var i = 0; i < runs.length; i++) {
      if (!runs[i].text) continue;
      w += g.textWidth(runs[i].text) * s + (runs[i].style && runs[i].style.bold ? s : 0);
    }
    return w;
  }
  H.runsWidth = runsWidth;

  /**
   * The title's alpha, 0..255.
   *
   * ⚠⚠ **THE RAMP IS VANILLA'S, THREE CASES AND IN THIS ORDER.** `time` counts DOWN, so a title
   * is FADING IN while `time > fadeOut + stay` and FADING OUT while `time <= fadeOut`, and the
   * second test must be allowed to overwrite the first — with `stay` at zero both are true at
   * once and only the fade-out is right. Writing it as an if/else-if gives a title that snaps
   * off instead of fading whenever somebody sets `stay 0`.
   *
   * ⚠ IT IS A PURE FUNCTION so it can be checked without a canvas: the ramp is the part of this
   * that can be wrong in a way nobody sees until they are looking for it.
   */
  H.titleAlpha = function (t) {
    if (!t || t.time <= 0) return 0;
    var a = 255;
    if (t.time > t.fadeOut + t.stay) {
      var into = (t.fadeIn + t.stay + t.fadeOut) - t.time;
      a = t.fadeIn > 0 ? into * 255 / t.fadeIn : 255;
    }
    if (t.time <= t.fadeOut) a = t.fadeOut > 0 ? t.time * 255 / t.fadeOut : 255;
    return a < 0 ? 0 : (a > 255 ? 255 : a);
  };

  /** The action bar's alpha: solid for forty ticks, then a twenty-tick fade. Vanilla's clamp. */
  H.actionBarAlpha = function (t) {
    if (!t || t.barTime <= 0) return 0;
    return Math.min(255, t.barTime * 255 / H.ACTION_BAR_FADE);
  };

  // #1584 -- BossBarHud.render (.decomp): bar x = W/2 - 91, first y = 12, name above at y - 9,
  // each further bar 19 lower, stop once y >= H/3. The wither's ServerBossBar is added to every
  // player tracking it (EntityType.WITHER trackingRange 10 chunks = 160 blocks).
  H.BOSS_TRACK_RANGE = 160;
  H.BOSS_COLORS = { pink: 0, blue: 1, red: 2, green: 3, yellow: 4, purple: 5, white: 6 };
  H.bossBars = function () {
    var P = NS.Player, EL = NS.EntityList, out = [];
    if (!P || !EL || !EL.list) return out;
    for (var i = 0; i < EL.list.length; i++) {
      var e = EL.list[i];
      if (!e.bossBar || e.removed || e.dead) continue;
      var dx = e.x - P.x, dy = e.y - P.y, dz = e.z - P.z;
      if (dx * dx + dy * dy + dz * dz > H.BOSS_TRACK_RANGE * H.BOSS_TRACK_RANGE) continue;
      // setCustomName -> bossBar.setName(getDisplayName())
      out.push({ name: e.customName || e.bossBar.name, percent: e.bossBar.percent,
        color: e.bossBar.color || 'purple', darkenSky: e.bossBar.darkenSky !== false, e: e });
    }
    // /bossbar custom bars (Commands.bossBars): shown while visible and the player is in the set
    var CB = NS.Commands && NS.Commands.bossBars;
    if (CB) for (var bid in CB) {
      var cb = CB[bid];
      if (!cb.visible || !cb.players.some(function (t) { return t.e === P; })) continue;
      out.push({ name: NS.Text.plain(cb.name), percent: cb.max ? cb.value / cb.max : 0, color: cb.color,
        style: cb.style, darkenSky: false, custom: cb });
    }
    // Raid.bar (a ServerBossBar): players within 96 blocks of the raid centre; red, NOTCHED_10.
    var RM = NS.RaidManager, rd = NS.Raid;
    if (RM && RM.world && rd && rd.Status) {
      for (var id in RM.world.raids) {
        var r = RM.world.raids[id], c = r.center, st = rd.Status;
        var fin = r.status === st.VICTORY || r.status === st.LOSS;
        if (r.status !== st.ONGOING && !fin) continue;
        if (r.status === st.ONGOING && !r.bar.visible) continue;
        var rx = c.x - P.x, ry = c.y - P.y, rz = c.z - P.z;
        if (rx * rx + ry * ry + rz * rz >= 96 * 96) continue;
        var nm = 'Raid';
        if (r.status === st.VICTORY) nm = 'Raid - Victory';
        else if (r.status === st.LOSS) nm = 'Raid - Defeat';
        else if (r.bar.name === 'raiders_remaining') nm = 'Raid - Raiders remaining: ' + r.bar.raidersRemaining;
        out.push({ name: nm, percent: r.status === st.VICTORY ? 0 : r.bar.percent, color: 'red',
          style: 'notched_10', darkenSky: false, raid: r });
      }
    }
    return out;
  };
  /** Screen-space layout of the bars: [{x, y, w, fill, row, name, nameX, nameY}] (unscaled GUI px). */
  H.bossBarLayout = function (bars, guiW, guiH) {
    var out = [], y = 12;
    for (var i = 0; i < bars.length; i++) {
      var b = bars[i], row = (H.BOSS_COLORS[b.color] || 0) * 10;
      out.push({ x: (guiW >> 1) - 91, y: y, row: row, fill: Math.floor(b.percent * 183), bar: b, nameY: y - 9 });
      y += 19;
      if (y >= Math.floor(guiH / 3)) break;
    }
    return out;
  };
  H.drawBossBars = function (c) {
    var g = NS.Gui;
    if (!g || !g.ready) return;
    var bars = H.bossBars();
    if (!bars.length) return;
    var s = H.scale, lay = H.bossBarLayout(bars, Math.floor(H.w / s), Math.floor(H.h / s));
    for (var i = 0; i < lay.length; i++) {
      var L = lay[i], x = Math.round(L.x * s), y = Math.round(L.y * s);
      g.blit(c, 'bars', [0, L.row, 182, 5], x, y, s);
      if (L.bar.style === 'notched_10') g.blit(c, 'bars', [0, 90, 182, 5], x, y, s);
      if (L.fill > 0) {
        g.blitPart(c, 'bars', [0, L.row + 5, 182, 5], x, y, s, L.bar.percent);
        if (L.bar.style === 'notched_10') g.blitPart(c, 'bars', [0, 95, 182, 5], x, y, s, L.bar.percent);
      }
      var tw = g.textWidth(L.bar.name) * s;
      g.text(c, L.bar.name, Math.round(H.w / 2 - tw / 2), Math.round(L.nameY * s), s, 0xFFFFFF, true);
    }
  };

  H.drawTitles = function (c) {
    var g = NS.Gui, T = NS.Text, t = H.titles;
    if (!g || !g.ready || !T) return;
    var s = H.scale;

    // ── the action bar, above the hotbar ──────────────────────────────────────────────────
    // ⚠ `k = time * 255 / 20` CLAMPED AT 255 — so it is solid for forty ticks and fades over the
    // last twenty, rather than fading in at all. An action bar that faded in would read as a
    // different message from vanilla's.
    if (t.bar && t.barTime > 0) {
      var ka = H.actionBarAlpha(t);
      if (ka > 8) {
        var brun = T.runs(t.bar);
        var bw = runsWidth(brun, s);
        c.globalAlpha = ka / 255;
        drawRuns(c, brun, Math.round((H.w - bw) * 0.5), Math.round(H.h - 72 * s), s);
        c.globalAlpha = 1;
      }
    }

    if (!t.title || t.time <= 0) return;
    var a = H.titleAlpha(t);
    if (a <= 8) return;
    c.globalAlpha = a / 255;
    // ⚠ SCALE 4 AND 2, AND THE OFFSETS ARE IN THE SCALED SPACE: vanilla translates to the middle
    // of the screen, scales, then draws at y = -10 and y = +5. Multiplying the offsets by the
    // scale is the same thing and needs no matrix.
    var ks = 4 * s;
    var trun = T.runs(t.title);
    var tw = runsWidth(trun, ks);
    drawRuns(c, trun, Math.round((H.w - tw) * 0.5), Math.round(H.h * 0.5 - 10 * ks), ks);
    if (t.subtitle) {
      var ss = 2 * s;
      var srun = T.runs(t.subtitle);
      var sw = runsWidth(srun, ss);
      drawRuns(c, srun, Math.round((H.w - sw) * 0.5), Math.round(H.h * 0.5 + 5 * ss), ss);
    }
    c.globalAlpha = 1;
  };

  /** #8340 vanilla SubtitlesHud.render: rows bottom-right, newest lowest, 0.5-alpha black box, arrows either side. */
  H.drawSubtitles = function (c) {
    var SH = NS.SubtitlesHud, g = NS.Gui, P = NS.Player;
    if (!SH || !g || !g.ready || !P || !NS.Settings || NS.Settings.showSubtitles !== true) return;
    var L = NS.Sound && NS.Sound.listenerNow && NS.Sound.listenerNow();
    if (!L) return;
    var rows = SH.rows(Date.now(), { x: L.x, y: L.y, z: L.z, yaw: (L.yaw || 0) * 180 / Math.PI + 180 });
    var s = H.scale, Tx = NS.Text, w = Math.floor(H.w / s), h = Math.floor(H.h / s);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], name = Tx && Tx.ready && Tx.has && Tx.has(r.key) ? Tx.translate(r.key, []) : r.key;
      var tw = g.textWidth(name), half = Math.floor(tw / 2);
      var bw = tw + 4 + 14 + 2 * 2 /* arrow slots: '<' + gap and '>' */;
      var x0 = w - Math.floor(bw / 2) - 2 - Math.floor(bw / 2) + Math.floor(bw / 2), y0 = h - 35 - (rows.length - 1 - i) * 10;
      x0 = w - bw - 2;
      c.globalAlpha = r.alpha * 0.5; c.fillStyle = '#000000';
      c.fillRect(Math.round(x0 * s), Math.round((y0 - 1) * s), Math.round(bw * s), Math.round(10 * s));
      c.globalAlpha = r.alpha;
      var col = (r.color << 16) | (r.color << 8) | r.color, mid = x0 + bw / 2;
      if (r.arrow === '<') g.text(c, '<', Math.round((x0 + 2) * s), Math.round(y0 * s), s, col, false);
      if (r.arrow === '>') g.text(c, '>', Math.round((x0 + bw - 2 - g.textWidth('>')) * s), Math.round(y0 * s), s, col, false);
      g.text(c, name, Math.round((mid - half) * s), Math.round(y0 * s), s, col, false);
      c.globalAlpha = 1;
    }
  };

  H.drawChat = function (c) {
    var Ch = NS.Chat, g = NS.Gui;
    if (!Ch || !g || !g.ready) return;
    if (H.screen && !Ch.open) return;           // a container screen hides the passive chat
    var s = H.scale;
    var left = Math.round(Ch.LEFT * s);
    var bottom = Math.round(H.h + Ch.BOTTOM * s);
    var vis = Ch.visible();
    var hoverSt = Ch.open && NS.Input ? Ch.styleAt(NS.Input.mx / s, NS.Input.my / s, H.h / s) : null;
    for (var i = 0; i < vis.length; i++) {
      var y = bottom - (i + 1) * Ch.LINE * s;
      var St = NS.Settings || {};
      var alpha = vis[i].alpha * ((St.chatOpacity === undefined ? 1 : St.chatOpacity) * 0.9 + 0.1);
      if (alpha <= 0) continue;
      // the background bar: timeFactor * textBackgroundOpacity (0.5 by default — vanilla's `l1 / 2 << 24`)
      c.globalAlpha = vis[i].alpha * (St.textBackgroundOpacity === undefined ? 0.5 : St.textBackgroundOpacity);
      c.fillStyle = '#000000';
      c.fillRect(left - 2 * s, y, (Ch.WIDTH + 4) * s, Ch.LINE * s);
      c.globalAlpha = alpha;
      drawRuns(c, vis[i].runs, left, y + 1 * s, s, Ch.open ? hoverSt : null);
      c.globalAlpha = 1;
    }
    if (Ch.open && Ch.lines.length > vis.length) {
      // vanilla ChatHud.render scrollbar: 4px left of the box, 2px wide; 0xCC3333 when unread else
      // 0x3333AA, alpha 170 if scrolled else 96, over a 1px light strip 0xCCCCCC
      var total = Ch.lines.length, shown = Ch.LINES_OPEN;
      var trackH = shown * Ch.LINE * s;
      var barH = Math.max(1, Math.round(trackH * shown / total));
      var top = bottom - trackH;
      var barY = Math.round(bottom - Ch.scroll * trackH / total - barH);
      if (barY < top) barY = top;
      var bx = left - 4 * s;
      c.globalAlpha = Ch.scroll > 0 ? 170 / 255 : 96 / 255;
      c.fillStyle = Ch.unread ? '#CC3333' : '#3333AA';
      c.fillRect(bx, barY, 2 * s, barH);
      c.fillStyle = '#CCCCCC';
      c.fillRect(bx + 2 * s, barY, s, barH);
      c.globalAlpha = 1;
    }
    if (!Ch.open) return;
    // Screen.renderTextHoverEffect: the tooltip of the hoverEvent under the pointer
    var In = NS.Input, T = NS.Text;
    if (In && T && T.hoverLines) {
      var hs = Ch.styleAt(In.mx / s, In.my / s, H.h / s);
      if (hs && hs.hoverEvent) H.drawLinesTooltip(c, T.hoverLines(hs.hoverEvent, function (v) {
        var id = NS.Items && NS.Items.of ? NS.Items.of(String(v.id).replace(/^minecraft:/, '')) : -1;
        return id >= 0 ? H.stackTooltipLines({ i: id, n: v.Count, t: v.tag || null }) : [];
      }), s);
    }
    // ── the input field, a band right across the bottom (D-283) ────────────────────────────
    var ix = Math.round(Ch.INPUT_INSET * s);
    var iy = Math.round(H.h + Ch.INPUT_TOP * s);
    var ih = Math.round((Ch.INPUT_BOTTOM - Ch.INPUT_TOP) * s);
    c.globalAlpha = 0.5;
    c.fillStyle = '#000000';
    c.fillRect(ix, iy, H.w - 2 * ix, ih);
    c.globalAlpha = 1;
    var tx = Math.round(Ch.INPUT_TEXT_X * s), ty = Math.round(H.h + Ch.INPUT_TEXT_Y * s);
    g.text(c, Ch.input, tx, ty, s, 0xFFFFFF, true);
    // the caret: a vertical bar between glyphs, blinking at 2 Hz.
    // ⚠ THE ONE THING HERE THAT IS NOT VANILLA'S: the real one blinks on the render tick
    // (`frame / 6 % 2`), this one on the wall clock. A few milliseconds of phase, declared.
    if (((NS.U.now() / 500) | 0) % 2 === 0) {
      var cx = tx + g.textWidth(Ch.input.slice(0, Ch.caret)) * s;
      c.fillStyle = '#FFFFFF';
      c.fillRect(cx, ty - s, s, 10 * s);
    }
  };

  /** A run list, drawn left to right with each run's own colour and decorations. */
  function drawRuns(c, runs, x, y, s, hoverSt) {
    var g = NS.Gui, T = NS.Text;
    var dx = x;
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      if (!r.text) continue;
      var st = r.style || null;
      var rgb = 0xFFFFFF;
      if (st && st.color !== undefined) { var v = T ? T.colorOf(st.color) : -1; if (v >= 0) rgb = v; }
      var w = g.text(c, r.text, dx, y, s, rgb, true);
      // ⚠ BOLD IS A SECOND DRAW ONE PIXEL RIGHT, which is what vanilla's legacy font does — it
      // has no bold face, so the glyph is stamped twice. Italic is a shear the 2D context can do.
      if (st && st.bold) g.text(c, r.text, dx + s, y, s, rgb, false);
      if (st && st.strikethrough) { c.fillStyle = colorHex(rgb); c.fillRect(dx, y + 3 * s, w, s); }
      if (st && (st.underlined || (hoverSt && st.clickEvent && st.clickEvent === hoverSt.clickEvent))) { c.fillStyle = colorHex(rgb); c.fillRect(dx, y + 8 * s, w, s); }
      dx += w + (st && st.bold ? s : 0);
    }
    return dx - x;
  }
  H.drawRuns = drawRuns;
  function colorHex(rgb) { return '#' + ('000000' + (rgb >>> 0).toString(16)).slice(-6); }

  /**
   * A registry id as the player sees it (D-282). ⚠ THE FALLBACK IS THE OLD BEHAVIOUR, not the
   * key: if the language table has not loaded, "diamond sword" is a worse name than "Diamond
   * Sword" but it is still a name, whereas `item.minecraft.diamond_sword` on the screen is a bug
   * report. `textcheck` asserts the table resolves all 2,000 of them, so the fallback is for the
   * two frames before `Text.init` runs and for nothing else.
   */
  /** D-650 — a container screen's title/label off its own lang key (`container.chest`, …), the
   *  way `HandledScreen.drawForeground` reads `this.title`; the fallback only if the table is absent. */
  H.containerTitle = function (key, fallback) {
    var Tx = NS.Text;
    if (Tx && Tx.ready && Tx.has && Tx.has(key)) return Tx.translate(key, []);
    return fallback;
  };
  H.CONTAINER_TITLES = {
    chest: ['container.chest', 'Chest'], trapped_chest: ['container.chest', 'Chest'],
    double: ['container.chestDouble', 'Large Chest'], barrel: ['container.barrel', 'Barrel'],
    ender_chest: ['container.enderchest', 'Ender Chest'], shulker_box: ['container.shulkerBox', 'Shulker Box'],
    crafting: ['container.crafting', 'Crafting'], inventory: ['container.inventory', 'Inventory']
  };
  H.titleOf = function (kind) { var t = H.CONTAINER_TITLES[kind]; return H.containerTitle(t[0], t[1]); };

  H.displayName = function (id, isItem) {
    var Tx = NS.Text;
    if (Tx && Tx.ready) {
      var n = isItem ? Tx.itemName(id) : Tx.blockName(id);
      if (n && n.indexOf('minecraft.') < 0) return n;
    }
    return String(id || '').replace(/^minecraft:/, '').replace(/_/g, ' ');
  };

  /** Spectator hotbar menu (SpectatorMenu): slot keys select/confirm a command; close returns the plain hotbar. */
  H.spectatorMenu = null;
  H.spectatorMenuKey = function (i) {
    var P = NS.Player, SM = NS.SpectatorMenu;
    if (!SM || !H.spectatorHud()) return false;
    if (!H.spectatorMenu) {
      var players = [];
      var L = (NS.Entities && NS.Entities.list) || [];
      for (var k = 0; k < L.length; k++) { var e = L[k]; if (e && e.isPlayer && e !== P) players.push({ id: String(e.id), name: e.name || 'Player', mode: e.mode | 0, x: e.x, y: e.y, z: e.z, e: e }); }
      H.spectatorMenu = SM.make(players, function () { H.spectatorMenu = null; }, function (p) { if (p.e) P.spectate(p.e); else { P.x = p.x; P.y = p.y; P.z = p.z; } });
    }
    H.spectatorMenu.use(i);
    return true;
  };
  H.drawSpectatorMenu = function (c) {
    var m = H.spectatorMenu, P = NS.Player, g = NS.Gui;
    if (!m) return;
    var r = H.hotbarRect(), s = r.s, cm = m.commands();
    if (g && g.ready) g.blit(c, 'widgets', g.WIDGET.hotbar, r.x, r.y, s);
    else { c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(r.x, r.y, r.w, r.h); }
    c.font = (6 * s) + 'px monospace'; c.textAlign = 'center'; c.fillStyle = '#fff';
    for (var i = 0; i < 9; i++) {
      c.globalAlpha = cm[i].enabled ? 1 : 0.25;
      c.fillText((cm[i].name || '').slice(0, 3), r.x + (11 + i * 20) * s, r.y + 14 * s);
    }
    c.globalAlpha = 1; c.textAlign = 'left';
  };

  H.drawHotbar = function (c) {
    var P = NS.Player, g = NS.Gui, I = NS.Inventory;
    if (!P) return;
    if (H.spectatorHud()) { H.drawSpectatorMenu(c); return; }
    H.spectatorMenu = null;
    var r = H.hotbarRect(), s = r.s;
    if (g && g.ready) {
      g.blit(c, 'widgets', g.WIDGET.hotbar, r.x, r.y, s);
    } else {
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(r.x, r.y, r.w, r.h);
    }
    // ⚠⚠ **THE SELECTOR IS DRAWN BEFORE THE ITEMS, AND THAT IS NOT A DETAIL.** Dan, session 11:
    // *"blocks in selected slot of hotbar do not look cortrect at all"*. This drew it LAST, so
    // the frame — which is one pixel proud of the slot on every side and whose texture is not
    // fully transparent inside that margin — was painted OVER the selected item's icon, and only
    // over that one. Vanilla's `Gui.renderHotbar` blits the widget, then the selector, and only
    // then loops the nine slots; the bytecode has the selector blit at offset 100 and the slot
    // loop at 226. **A draw order is part of what a picture IS, and nothing here had ever
    // asserted one.**
    if (g && g.ready) {
      g.blit(c, 'widgets', g.WIDGET.selector, r.x + (P.slot * 20 - 1) * s, r.y - 1 * s, s);
    } else {
      c.strokeStyle = '#ffffff'; c.lineWidth = Math.max(2, s);
      c.strokeRect(r.x + (P.slot * 20 - 1) * s, r.y - s, 24 * s, 22 * s);
    }
    for (var i = 0; i < 9; i++) {
      var ix = r.x + (3 + i * 20) * s, iy = r.y + 3 * s;
      var stack = (I && P.inventory) ? I.getItem(P.inventory, i) : null;
      if (stack) H.drawItem(c, stack, ix, iy, 16 * s);
      else H.drawIcon(c, P.hotbar[i], ix, iy, 16 * s);
    }
    // vanilla renderHotbar: a non-empty offhand gets a 29x24 frame beside the bar (main arm right -> left side)
    var off = (I && P.inventory) ? I.getItem(P.inventory, I.OFFHAND) : null;
    if (off) {
      // opposite arm of Options.mainArm: main RIGHT -> frame at w/2-91-29, item w/2-91-26; main LEFT -> frame w/2+91, item w/2+91+10
      var offRight = !!(NS.Settings && NS.Settings.mainHand === 'left');
      var ox = offRight ? r.x + 182 * s : r.x - 29 * s, oy = r.y - 1 * s;
      if (g && g.ready) g.blit(c, 'widgets', offRight ? g.WIDGET.offhandRight : g.WIDGET.offhandLeft, ox, oy, s);
      else { c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(ox, oy, 29 * s, 24 * s); }
      H.drawItem(c, off, offRight ? r.x + 192 * s : r.x - 26 * s, r.y + 3 * s, 16 * s);
    }
  };

  /**
   * The held item's name, above the XP bar, fading out — vanilla's `renderSelectedItemName`
   * (D-277).
   *
   * ⚠ THE ANCHOR IS `height - 59`, NOT "just above the hotbar". It was `hotbarRect().y - 12`
   * here, which put it at `height - 34` — straight through the hearts, because the hearts are at
   * `height - 39` and are nine pixels tall. Vanilla measures from the bottom of the screen and
   * leaves the whole survival stack below it; in a gamemode that cannot be hurt there is no
   * heart row, so it moves DOWN by 14 to sit where the hearts would have been.
   *
   * ⚠ AND IT FADES. `toolHighlightTimer` is set to 40 ticks when the held stack changes and
   * counts down; the alpha is `timer * 256 / 10` clamped to 255, so the name is solid for the
   * first thirty ticks and fades over the last ten. A name that simply stays on screen is the
   * single most common way a clone's hotbar reads as not-Minecraft.
   */
  H.toolHighlightTimer = 0;
  H.lastToolHighlight = null;

  /** One tick of the name's timer. Called from the game tick, because 40 ticks means 40 ticks. */
  /** `Item.Settings.rarity` for every non-COMMON item of 1.18.2's Items.java (U uncommon, R rare, E epic). */
  var RARITY_LISTS = {
    U: 'elytra experience_bottle skeleton_skull wither_skeleton_skull player_head zombie_head creeper_head dragon_head nether_star enchanted_book dragon_breath totem_of_undying heart_of_the_sea creeper_banner_pattern skull_banner_pattern',
    R: 'beacon conduit golden_apple end_crystal music_disc_13 music_disc_cat music_disc_blocks music_disc_chirp music_disc_far music_disc_mall music_disc_mellohi music_disc_stal music_disc_strad music_disc_ward music_disc_11 music_disc_wait music_disc_otherside music_disc_pigstep',
    E: 'spawner dragon_egg command_block barrier light repeating_command_block chain_command_block structure_void structure_block jigsaw enchanted_golden_apple command_block_minecart knowledge_book debug_stick mojang_banner_pattern'
  };
  var RARITY_OF = Object.create(null);
  ['U', 'R', 'E'].forEach(function (k, n) {
    RARITY_LISTS[k].split(' ').forEach(function (id) { RARITY_OF[id] = n + 1; });
  });
  var RARITY_RGB = [0xFFFFFF, 0xFFFF55, 0x55FFFF, 0xFF55FF];   // Rarity.COMMON/UNCOMMON/RARE/EPIC formatting

  /** `Item.getRarity(stack)`: 0 COMMON .. 3 EPIC; an enchanted stack moves COMMON/UNCOMMON to RARE and RARE to EPIC. */
  H.stackRarity = function (st) {
    var r = RARITY_OF[NS.Items.nameOf(st.i)] | 0;
    var t = st.t;
    var ench = t && t.Enchantments && t.Enchantments.length;   // hasEnchantments: not StoredEnchantments
    if (ench) r = r <= 1 ? 2 : (r === 2 ? 3 : r);
    return r;
  };

  /** `ItemStack.getName()` as text plus whether it is a custom name (`display.Name`, a JSON text component). */
  H.stackName = function (st) {
    var d = st.t && st.t.display, raw = d && d.Name;
    if (typeof raw === 'string') {
      var txt = raw;
      try {
        var j = JSON.parse(raw);
        txt = typeof j === 'string' ? j : (j.text !== undefined ? String(j.text)
          : (j.translate ? H.displayName(String(j.translate).replace(/^(block|item)\.minecraft\./, ''), true) : ''));
      } catch (e) { /* a plain string */ }
      return { text: txt, custom: true, key: raw };
    }
    var id = NS.Items.nameOf(st.i);
    return { text: H.displayName(id, true), custom: false, key: id };
  };

  /** One tick of the name's timer. Called from the game tick, because 40 ticks means 40 ticks. */
  H.tickToolHighlight = function (stack) {   // D-277
    // InGameHud.tick: reset only when the item or its NAME changed. Durability and other tags do not count.
    var I = NS.Inventory;
    var cur = stack && I && !I.isEmpty(stack) ? stack : null, last = H.lastToolHighlight;
    if (!cur) {
      H.lastToolHighlight = null;
      H.toolHighlightTimer = 0;
    } else if (!last || last.i !== cur.i || H.stackName(last).key !== H.stackName(cur).key) {
      H.lastToolHighlight = I.copy(cur);
      H.toolHighlightTimer = 40;
    } else {
      H.lastToolHighlight = I.copy(cur);
      if (H.toolHighlightTimer > 0) H.toolHighlightTimer--;
    }
    return H.toolHighlightTimer;
  };

  H.drawSelectedItemName = function (c) {
    if (H.spectatorHud()) return;
    var P = NS.Player, g = NS.Gui, I = NS.Inventory;
    if (!P || !g || !g.ready) return;
    if (H.toolHighlightTimer <= 0) return;
    var held = (I && P.inventory) ? I.getItem(P.inventory, P.slot) : null;
    // ⚠ THE DISPLAY NAME, not the registry id with its underscores swapped for spaces (D-282).
    // "Diamond Sword", which is what the game has said since 2011, rather than "diamond sword".
    var has = held && I && !I.isEmpty(held), sn = has ? H.stackName(held) : null;
    var name = has ? sn.text
      : (P.hotbar[P.slot] ? H.displayName(NS.States.name(P.hotbar[P.slot]), false) : '');
    var rgb = has ? RARITY_RGB[H.stackRarity(held)] : 0xFFFFFF;
    if (!name) return;
    var alpha = Math.min(255, (H.toolHighlightTimer * 256 / 10) | 0);
    if (alpha <= 0) return;
    var s = H.scale;
    var L = g.HUD;
    var y = Math.round(H.h + L.nameY * s);
    if (P.invulnerableGamemode) y += L.nameNoHurtDY * s;   // no heart row to clear
    var tw = g.textWidth(name) * s;
    var old = c.globalAlpha;
    c.globalAlpha = old * (alpha / 255);
    var nx = Math.round((H.w - tw) * 0.5);
    if (has && sn.custom) {   // hasCustomName: italic, a shear about the baseline
      c.save();
      c.translate(nx, y + 8 * s);
      c.transform(1, 0, -0.125, 1, 0, 0);
      g.text(c, name, 0, -8 * s, s, rgb, true);
      c.restore();
    } else g.text(c, name, nx, y, s, rgb, true);
    c.globalAlpha = old;
  };

  /**
   * The W4 line of the F3 readout: the 1.18.2 biome this position dispatches to, and in Earth
   * mode the physical numbers behind it. Returns '' — which the renderer skips — when the
   * climate machinery is not up, so an old save or a failed decode does not put an exception
   * on the debug screen.
   */
  H.climateLine = function (bx, by, bz) {
    var CL = NS.Climate;
    if (!CL || !CL.ready || !NS.Column || !NS.Column.ready) return '';
    try {
      var name = CL.biomeNameAt(bx, by, bz).replace('minecraft:', '');
      var line = '1.18.2 climate  ' + CL.MODE_NAMES[CL.mode] + '  ' + name;
      if (CL.mode === CL.MODE_EARTH) {
        var r = NS.Earth.report(bx, bz);
        line += '   lat ' + r.latitude.toFixed(1) + '\u00b0   ' + r.tempC.toFixed(1) + '\u00b0C   ' +
                Math.round(r.precipMm) + ' mm   aridity ' + r.aridity.toFixed(2);
      }
      return line;
    } catch (e) { return '1.18.2 climate  ' + ((e && e.message) || e); }
  };

  // --- F3 ---------------------------------------------------------------------

  // yaw 0 looks -Z and +yaw turns toward +X (ARCH §9), so the octant is yaw/(pi/2), not
  // (yaw+pi)/(2pi)*4 — that off-by-two is why an early build reported "south" for yaw 0.
  var DIRS = ['north (-Z)', 'east (+X)', 'south (+Z)', 'west (-X)'];

  /** A one-line progress banner while the benchmark is flying its circuit (ARCH 17). */
  H.drawBench = function (c) {
    var t = NS.Bench.status();
    if (!t) return;
    c.font = '14px ' + UIFONT;
    c.textAlign = 'center';
    var w = c.measureText(t).width + 28;
    c.fillStyle = 'rgba(0,0,0,0.62)';
    c.fillRect((H.w - w) * 0.5, H.h - 74, w, 26);
    c.fillStyle = '#ffd479';
    c.fillText(t, H.w * 0.5, H.h - 56);
    c.textAlign = 'left';
  };

  /**
   * The finished report, drawn as a real modal screen ('bench') so Esc closes it, clicks route
   * through H.click, and the player is not walking around behind it. Shown in the game rather
   * than only in the console because the console is not where somebody testing this on their own
   * 2200G is looking.
   */
  H.benchReport = null;
  H.drawBenchReport = function (c) {
    var lines = NS.Bench.text(H.benchReport).split('\n');
    c.font = '12px ui-monospace,Consolas,"DejaVu Sans Mono",monospace';
    var wide = 0;
    for (var i = 0; i < lines.length; i++) wide = Math.max(wide, c.measureText(lines[i]).width);
    var w = Math.min(H.w - 20, wide + 36), h = Math.min(H.h - 20, lines.length * 15 + 54);
    var x = (H.w - w) * 0.5, y = (H.h - h) * 0.5;
    panel(c, x, y, w, h, 'Benchmark');
    c.fillStyle = '#d6dce2';
    c.textAlign = 'left';
    for (i = 0; i < lines.length; i++) c.fillText(lines[i], x + 16, y + 46 + i * 15);
    c.fillStyle = '#7f868c';
    c.textAlign = 'center';
    c.fillText('click or Esc to dismiss', x + w * 0.5, y + h - 10);
    c.textAlign = 'left';
    push(x, y, w, h, function () { H.benchReport = null; H.close(); });
  };

  // GameRules.REDUCED_DEBUG_INFO (status 22/23): F3 drops the position, block/chunk, facing, biome, light
  // and climate lines (DebugHud.getLeftText) and the targeted-block line (getRightText). Read every frame.
  H.reducedDebugInfo = function () {
    var C = NS.Commands;
    return !!(C && typeof C.ruleGet === 'function' && C.ruleGet('reducedDebugInfo') === 'true');
  };
  H.debugAssemble = function (lines, posLines, target) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] === H.DEBUG_POS) { if (!H.reducedDebugInfo()) for (var j = 0; j < posLines.length; j++) out.push(posLines[j]); }
      else out.push(lines[i]);
    }
    if (target && !H.reducedDebugInfo()) out.push(target);
    return out;
  };
  H.DEBUG_POS = { pos: true };
  H.drawDebug = function (c) {
    var P = NS.Player, G = NS.Gfx, W = NS.World, S = NS.Settings;
    var prof = H.frameProf;
    // D-434: `statsFast`, not `stats` — the exact byte total walks every section of every chunk
    // and this runs once a frame. See `World.statsFast`'s header for what that was costing.
    var ws = W.statsFast();
    var mem = '';
    try {
      var pm = performance.memory;
      if (pm) mem = (pm.usedJSHeapSize / 1048576).toFixed(0) + ' / ' +
                    (pm.jsHeapSizeLimit / 1048576).toFixed(0) + ' MB js';
    } catch (e) {}

    var oct = Math.round(P.yaw / (Math.PI * 0.5)) & 3;
    var bx = Math.floor(P.x), by = Math.floor(P.y), bz = Math.floor(P.z);
    var lightByte = W.getLight(bx, Math.floor(P.y + P.EYE), bz);
    var biomeId = W.biomeAt(bx, bz);
    // From W6 this is one of the 61 registry biomes, not one of session 1's twelve.
    var biome = (NS.Biomes && NS.Biomes.ready && biomeId < NS.Biomes.count)
      ? NS.Biomes.name(biomeId).replace('minecraft:', '') : ('#' + biomeId);
    var info = G.backend && G.backend.info ? G.backend.info() : null;

    var posLines = [
      'xyz ' + P.x.toFixed(3) + ' / ' + P.y.toFixed(3) + ' / ' + P.z.toFixed(3),
      'block ' + bx + ' ' + by + ' ' + bz + '   chunk ' + (bx >> 4) + ' ' + (bz >> 4) +
        '   section sy ' + ((by - NS.CFG.WORLD_MIN_Y) >> 4),
      'facing ' + DIRS[oct] + '   yaw ' + (P.yaw * 180 / Math.PI).toFixed(1) +
        '   pitch ' + (P.pitch * 180 / Math.PI).toFixed(1),
      'biome ' + biome + '   light sky ' + (lightByte >> 4) + ' block ' + (lightByte & 15),
      // PLAN W4. The 1.18.2 climate dispatch runs beside the old generator until W6 hands the
      // world over to it, so this line is how you see whether it agrees with the ground you
      // are standing on — and, in Earth mode, what the model thinks the weather is here.
      H.climateLine(bx, by, bz)
    ];
    var lines = [
      'MC-Lite ' + NS.VERSION + '   ' + H.fps.toFixed(0) + ' fps   ' +
        (prof ? prof.avg().toFixed(1) + ' ms avg / ' + prof.p95().toFixed(1) + ' ms p95 / ' +
                prof.percentile(0.99).toFixed(1) + ' ms p99' : ''),
      'renderer ' + G.name + (G.fallbackReason ? '  [' + G.fallbackReason + ']' : '') +
        (info && info.renderer ? '  ' + String(info.renderer).slice(0, 48) : ''),
      'draws ' + G.draws + '   tris ' + fmtK(G.tris) +
        (G.modelTris ? ' + ' + fmtK(G.modelTris) + ' model' : '') +
        '   sections ' + G.meshes.size +
        '   culled ' + G.culled + ' (' + G.occluded + ' occl)' +
        '   binds ' + ((info && info.binds) | 0) + '   queued ' + G.uploadQueue.length,
      // The 1.18.2 roster. It is decoded whether or not the world uses it yet, so showing it
      // here is how you tell at a glance that the payload arrived and the mesher can see it —
      // the difference between "the model stream is empty" and "the registry never loaded".
      'roster ' + (NS.Reg && NS.Reg.ready
        ? NS.Reg.blockCount + ' blocks   ' + NS.Reg.visualCount + ' states   ' +
          fmtK(NS.Reg.quadCount) + ' baked quads   ' + Math.round(NS.Reg.decodeMs) + ' ms   ' +
          'atlas ' + NS.Atlas.tiles + ' layers (' + (NS.Atlas.source || '?') + ')'
        : 'NOT LOADED'),
      'quality ' + S.describe(),
      'flood ' + (G.occlusion ? G.visited + ' sections' : 'off') +
        '   arenas ' + ((info && info.arenas) | 0) + ' / ' + ((info && info.arenaMB) || 0) + ' MB' +
        '   snap ' + ws.snapReuse + 'r ' + ws.snapAlloc + 'a',
      H.DEBUG_POS,
      'chunks ' + ws.chunks + '   gen ' + ws.genInflight + '/' + W.genCap +
        '   mesh ' + ws.meshInflight + '/' + W.meshCap +
        '   evicted ' + ws.evicted,
      'world ' + (ws.bytes / 1048576).toFixed(1) + ' MB   ' + mem,
      'jobs ' + NS.Jobs.mode + ' x' + (NS.Jobs.workers.length || 1) +
        '   cancelled ' + ws.cancelled + '   load ' + W.load.toFixed(2) +
        '   dpr ' + H.dpr.toFixed(2),
      'save ' + (NS.Save ? NS.Save.describe() : 'n/a'),
      'mode ' + (NS.Gamemode ? NS.Gamemode.name(P.mode) : 'survival') +
        (P.flying ? ' + flying' : '') + (P.noclip ? ' + noclip' : '') +
        (P.onGround ? ' + ground' : '') + (P.inWater ? ' + water' : '')
    ];
    var target = null;
    if (P.hasTarget) {
      var hard = NS.States.hard[P.tid];
      target = 'looking at ' + NS.States.name(P.tid) + '[' + P.tid + '] @ ' + P.tx + ' ' + P.ty + ' ' + P.tz +
                 '  face ' + P.tface +
                 '  break ' + (isFinite(hard) ? hard.toFixed(2) + 's' : 'unbreakable');
    }
    lines = H.debugAssemble(lines, posLines, target);

    c.font = '12px ui-monospace,Consolas,"DejaVu Sans Mono",monospace';
    c.textAlign = 'left';
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i];
      if (!t) continue;                 // a line that had nothing to say draws nothing
      var wpx = c.measureText(t).width;
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(4, 6 + i * 15, wpx + 8, 15);
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.fillText(t, 8, 18 + i * 15);
    }
  };

  function fmtK(n) { return n >= 1000000 ? (n / 1000000).toFixed(2) + 'M' : (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)); }

  // ---------------------------------------------------------------------------
  // Menus — immediate mode. Every screen rebuilds H.hit each frame and click() walks it.
  // ---------------------------------------------------------------------------

  // `label` is carried on the hit region purely so that a headless check can press a named
  // button instead of guessing at pixel coordinates — `tools/titlecheck.mjs` clicks 'Earth'
  // that way. It costs one string per region per frame and it is the difference between a test
  // that presses the button and a test that calls the function the button would have called.
  function push(x, y, w, h, fn, label) { H.hit.push({ x: x, y: y, w: w, h: h, fn: fn, label: label || '' }); }

  function hovered(x, y, w, h) {
    var I = NS.Input;
    return I.mx >= x && I.mx <= x + w && I.my >= y && I.my <= y + h;
  }

  var UIFONT = '"Segoe UI",Tahoma,DejaVu Sans,sans-serif';

  /**
   * One crude-menu button. `dis` is the REASON this button is dead, or falsy when it is live.
   *
   * ⚠⚠ D-426 — A DEAD BUTTON THAT LOOKS ALIVE IS THE BUG, NOT THE DEAD BUTTON.
   * Dan, session 55: "you cant click earth on world load screen." The climate rows have been
   * locked once a save exists since D-111, deliberately and for a good reason, but the lock
   * lived entirely inside the CLICK HANDLER (`if (!locked) ...`): the button drew in the exact
   * same colours as a live one, lit up on hover like a live one, and then swallowed the click
   * in silence. Every possible reading of that is "the button is broken".
   * ▶ A disabled control must (a) be drawn differently, (b) not react to hover, and (c) say why
   *   when it is pressed. All three, or a user learns to distrust the whole screen.
   * `options.mjs`'s vanilla buttons have had a 'disabled' sprite since G13 — this crude menu is
   * the one screen that never got the idea.
   */
  function button(c, x, y, w, h, label, fn, on, fs, dis) {
    var hov = !dis && hovered(x, y, w, h);
    if (dis) c.fillStyle = on ? '#2f3a2c' : '#23272e';
    else c.fillStyle = on ? (hov ? '#4f7f43' : '#3f6636') : (hov ? '#4a5260' : '#31373f');
    c.fillRect(x, y, w, h);
    c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    c.fillStyle = dis ? '#767c86' : '#e8e8e8';
    c.textAlign = 'center';
    c.font = (fs || 13) + 'px ' + UIFONT;
    c.fillText(label, x + w * 0.5, y + h * 0.5 + (fs || 13) * 0.35);
    c.textAlign = 'left';
    // The hit region is pushed either way: a disabled button that is not clickable at all cannot
    // tell anyone why it is disabled, and the click would fall through to whatever is behind it.
    if (dis) push(x, y, w, h, function () { H.titleNote = String(dis); H.titleNoteT = NS.U.now(); }, label);
    else if (fn) push(x, y, w, h, fn, label);
  }

  function panel(c, x, y, w, h, title) {
    c.fillStyle = 'rgba(8,10,13,0.82)';
    c.fillRect(0, 0, H.w, H.h);
    c.fillStyle = 'rgba(24,28,34,0.96)';
    c.fillRect(x, y, w, h);
    c.strokeStyle = '#454c57'; c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (title) {
      c.fillStyle = '#e8e8e8';
      c.font = '600 18px "Segoe UI",Tahoma,DejaVu Sans,sans-serif';
      c.textAlign = 'center';
      c.fillText(title, x + w * 0.5, y + 28);
      c.textAlign = 'left';
    }
  }


  /**
   * The pause screen. Nothing here is a fixed size: there are twenty rows plus a two-line footer,
   * and at 400 px tall a fixed 30 px row paints the hints straight across the buttons. So the row
   * height is derived from the window, and when even the legible floor does not fit the whole
   * thing goes to TWO COLUMNS rather than overflowing. A 2200G is often driving a 1366x768 panel
   * and the settings menu is the one screen a player on a slow machine actually needs to reach.
   */
  /**
   * The pause screen, and every screen under it. ⚠ G11c — THIS IS NOW ONE LINE, and the fifty
   * that used to be here (a reflowing two-column grid of filled rectangles in the browser's own
   * font) are DELETED rather than kept behind a flag: D-139's rule is that the stage which
   * replaces something deletes the something, in the same commit. `NS.Options` draws vanilla's
   * own `widgets.png` buttons at vanilla's own coordinates, and `optionscheck` asserts both
   * against the texture.
   */
  H.drawPause = function (c) {
    if (!NS.Options || !NS.Gui || !NS.Gui.ready) { H.drawPauseFallback(c); return; }
    if (!NS.Options.screen) NS.Options.open('pause');
    NS.Options.draw(c, H.w, H.h, Math.max(2, H.scale));
  };

  /** The ONE browser-font draw every texture-backed screen falls back to before `NS.Gui`'s payload decodes
   * (pause, inventory, trading) — a world still loading must still draw something (D-488). */
  function screenFallback(c, label) {
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(0, 0, H.w, H.h);
    c.fillStyle = '#c8cdd4';
    c.font = '14px "Segoe UI",Tahoma,DejaVu Sans,sans-serif';
    c.textAlign = 'center';
    c.fillText(label, H.w * 0.5, H.h * 0.5);
    c.textAlign = 'left';
  }

  /** Held-button move on the creative screen: the scrollbar follows the pointer (vanilla mouseDragged). */
  H.creativeDrag = function (my) {
    var Cr = NS.Creative, o = H.creOrigin;
    if (!Cr || !Cr.dragging || !o || !Cr.canScroll()) return;
    Cr.scrollTo(Cr.trackFrac((my - o.y) / o.s));
  };

  /** A digit over a slot of the creative screen: vanilla swaps it with that hotbar slot. */
  H.creativeHotbarKey = function (n) {
    var Cr = NS.Creative, P = NS.Player, o = H.creOrigin, I = NS.Input;
    if (!Cr || !P || !o || !I) return false;
    // CreativeInventoryScreen.onHotbarKeyPress (Saved Toolbars tab): ctrl+n loads, C+n saves
    if (Cr.tab === Cr.HOTBAR_COL) {
      var ld = !!(I.down('ControlLeft') || I.down('ControlRight')), sv = !ld && I.down('KeyC');
      if ((ld || sv) && Cr.hotbarKeyPress(n, ld, sv, P)) { P.syncHotbar(); return true; }
    }
    var ok = Cr.hotbarKey(n, Cr.hitAt((I.mx - o.x) / o.s, (I.my - o.y) / o.s), P);
    if (ok) P.syncHotbar();
    return ok;
  };

  /** Before the GUI payload decodes. The same fallback the inventory screen has, for the same reason. */
  H.drawPauseFallback = function (c) {
    screenFallback(c, 'paused');
  };

  // --- creative inventory -----------------------------------------------------

  /**
   * G11: THE PLAYER'S OWN SCREEN, on vanilla's own background, driven by G8's click machine.
   *
   * ⚠ WHAT THIS REPLACES. Until now `H.screen === 'inventory'` drew a CREATIVE BLOCK PICKER — a
   * grid of every block, and clicking one wrote a block state straight into `P.hotbar`. It was a
   * placeholder for an inventory that did not exist, and D-139's rule applies: the stage that
   * replaces it deletes it. Everything here goes through `Menu.doClick`, which means the drag,
   * the half-stack right-click, shift-click's two bands and the armour slots all behave here
   * exactly as `invcheck`'s 164 assertions say they do, because it is the same code.
   *
   * ⚠ The screen is drawn in GUI PIXELS and scaled once, so every slot lands on the texture's own
   * 18-pixel grid. Computing positions in screen pixels is how a clone ends up with icons that
   * drift a pixel per slot across the row.
   */
  H.invOrigin = null;
  H.drawInventory = function (c) {
    var P = NS.Player, g = NS.Gui, I = NS.Inventory, M = NS.Menu;
    if (!g || !g.ready || !I || !M || !P.menu) { H.drawInventoryFallback(c); return; }
    var s = Math.max(2, H.scale);
    var V = g.INV;
    var ox = Math.round((H.w - V.w * s) * 0.5);
    var oy = Math.round((H.h - V.h * s) * 0.5);
    H.invOrigin = { x: ox, y: oy, s: s };

    g.dim(c, H.w, H.h);
    g.blit(c, 'inventory', [0, 0, V.w, V.h], ox, oy, s);
    // ⚠ AND THE PLAYER INTO IT. The black window is `inventory.png`'s own pixels; vanilla draws
    // the player there and so does this, front-on (D-278).
    H.drawPlayerPreview(c, ox, oy, s, { cx: 51, feet: 75, size: 30, dy: 50 });

    var m = P.menu, U = H.uiInv;
    var carried0 = M.getCarried(m);
    var hover = H.invSlotAt(NS.Input ? NS.Input.mx : -1, NS.Input ? NS.Input.my : -1);
    for (var i = 0; i < m.slots.length; i++) {
      var p = g.slotXY(i);
      var sx = ox + p[0] * s, sy = oy + p[1] * s;
      var st = M.slotGet(m.slots[i]);
      var ph = H.emptySlotSheet(i);
      if (!st && ph) g.blit(c, ph, [0, 0, 16, 16], sx, sy, s);
      var dragged = U.drag && U.slots.indexOf(i) >= 0 && carried0;
      if (dragged) {
        var pv = NS.Inventory.copy(carried0);
        M.quickCraftSlotCount(U.slots.length, U.type, pv, st ? st.n : 0);
        var cap = Math.min(NS.Inventory.maxStackSize(pv), M.slotMaxStack(m.slots[i], pv));
        var capped = pv.n > cap;
        if (capped) pv.n = cap;
        H.drawItem(c, pv, sx, sy, 16 * s);
        if (capped) g.text(c, String(cap), sx + (17 - g.textWidth(String(cap))) * s, sy + 9 * s, s, 0xFFFF55, true);
      } else if (st) H.drawItem(c, st, sx, sy, 16 * s);
      // vanilla draws the highlight OVER the item (0x80FFFFFF), so the item is washed
      if (i === hover || dragged) { c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(sx, sy, 16 * s, 16 * s); }
    }

    // the crafting result, recomputed from the grid every frame — G9's matcher is cheap enough
    // that caching it would be an optimisation with a staleness bug in it
    H.refreshCraftResult();
    // D-650 — `InventoryScreen.drawForeground` draws ONLY its title, "Crafting", at (97, 6).
    g.text(c, H.titleOf('crafting'), ox + V.title.x * s, oy + V.title.y * s, s, 0x404040, false);

    // ⚠ THE CARRIED STACK IS DRAWN LAST AND FOLLOWS THE CURSOR, which is the only way a drag
    // reads as a drag. It is drawn centred on the pointer, as vanilla does.
    var carried = M.getCarried(m);
    if (carried && NS.Input) {
      H.drawItem(c, carried, NS.Input.mx - 8 * s, NS.Input.my - 8 * s, 16 * s);
    }

    // the hovered item's name, above the pointer
    if (hover >= 0 && !carried) {
      var hs = M.slotGet(m.slots[hover]);
      if (hs && !I.isEmpty(hs)) {
        H.drawStackTooltip(c, hs, s);
      }
    }
  };

  /**
   * A grid's result, kept in step with its contents. G9 does the matching; shared by the
   * player's own 2x2 (`H.refreshCraftResult`) and the crafting table's 3x3
   * (`H.refreshCraftingResult`, PASS 17 JOB 1 session 44) — one matcher call, two callers, so
   * they cannot drift the way two hand-written copies would.
   */
  H.refreshGridResult = function (m, n, w, h) {
    var R = NS.Recipes, I = NS.Inventory;
    if (!m || !R || !R.ready) return;
    var grid = [];
    for (var i = 0; i < n; i++) grid.push(m.grid.get(i));
    var out = R.craft(grid, w, h, NS.Player || null);
    m.result.set(0, I.isEmpty(out) ? null : out);
  };

  /** The 2x2 grid's result, kept in step with the grid. G9 does the matching. */
  H.refreshCraftResult = function () {
    var P = NS.Player;
    if (P && P.menu) H.refreshGridResult(P.menu, 4, 2, 2);
  };

  /** The crafting table's own 3x3 grid's result — PASS 17 JOB 1, session 44. */
  H.refreshCraftingResult = function () {
    if (H.craftingMenu) H.refreshGridResult(H.craftingMenu, 9, 3, 3);
  };

  /** InGameHud.render: first person AND the HEAD stack is the carved_pumpkin item (not jack_o_lantern, not the hand). */
  H.pumpkinBlurWanted = function (P) {
    var I = NS.Inventory, IT = NS.Items;
    if (!P || !P.inventory || !I || !IT || (P.thirdPerson | 0) !== 0) return false;
    var st = P.inventory.slots[I.ARMOR_START + (5 - IT.FEET)];
    return !!st && !I.isEmpty(st) && IT.nameOf(st.i | 0) === 'carved_pumpkin';
  };
  var inWallCv = {};
  /** InGameOverlayRenderer.renderInWallOverlay: the particle sprite of Physics.inWallState, stretched over the view at colour 0.1. */
  H.drawInWall = function (c) {
    var P = NS.Player, Ph = NS.Physics, S = NS.States, A = NS.Atlas;
    if (!P || !Ph || !Ph.inWallState || !S || !S.particleTile || !A || !A.mips) return;
    var hit = Ph.inWallState(P);
    if (!hit) return;
    var tile = S.particleTile(hit.state);
    if (tile < 0) return;
    var cv = inWallCv[tile];
    if (!cv) {
      cv = inWallCv[tile] = document.createElement('canvas');
      cv.width = 16; cv.height = 16;
      var cc = cv.getContext('2d'), img = cc.createImageData(16, 16), d = A.mips[0].data, base = tile * 1024;
      for (var i = 0; i < 1024; i += 4) { img.data[i] = d[base + i] * 0.1; img.data[i + 1] = d[base + i + 1] * 0.1; img.data[i + 2] = d[base + i + 2] * 0.1; img.data[i + 3] = 255; }
      cc.putImageData(img, 0, 0);
    }
    var sm = c.imageSmoothingEnabled;
    c.imageSmoothingEnabled = false;
    c.drawImage(cv, 0, 0, 16, 16, 0, 0, c.canvas.width, c.canvas.height);
    c.imageSmoothingEnabled = sm;
  };
  H.resetInWallTiles = function () { inWallCv = {}; };
  /** InGameHud.renderSpyglassOverlay geometry: the scope square [x0,y0,x1,y1] at `scale`; black fills the rest. */
  H.spyglassRect = function (w, h, scale) {
    var m = Math.min(w, h), s = Math.min(w / m, h / m) * scale, sz = m * s;
    var x0 = (w - sz) / 2, y0 = (h - sz) / 2;
    return [x0, y0, x0 + sz, y0 + sz];
  };
  /** InGameHud.render: spyglassScale = lerp(0.5 * frameTicks, scale, 1.125) while scoped; 0.5 once not. */
  H.spyglassScale = 0.5;
  H.spyglassStep = function (scale, frameTicks) { return scale + (1.125 - scale) * Math.min(1, 0.5 * frameTicks); };
  var spyLast = 0;
  H.drawSpyglass = function (c) {
    var P = NS.Player, U = NS.Use, now = (typeof performance !== 'undefined') ? performance.now() : 0;
    var dt = spyLast ? (now - spyLast) / 50 : 0; spyLast = now;
    H.spyglassScale = H.spyglassStep(H.spyglassScale, dt);
    if (!P || (P.thirdPerson | 0) !== 0) return;
    if (!U || !U.isUsingSpyglass || !U.isUsingSpyglass(P)) { H.spyglassScale = 0.5; return; }
    var w = c.canvas.width, h = c.canvas.height, r = H.spyglassRect(w, h, H.spyglassScale);
    var sh = NS.Gui && NS.Gui.sheets && NS.Gui.sheets.spyglass_scope;
    if (sh) c.drawImage(sh.canvas, 0, 0, sh.canvas.width, sh.canvas.height, r[0], r[1], r[2] - r[0], r[3] - r[1]);
    c.fillStyle = '#000';
    c.fillRect(0, r[3], w, h - r[3]); c.fillRect(0, 0, w, r[1]);
    c.fillRect(0, r[1], r[0], r[3] - r[1]); c.fillRect(r[2], r[1], w - r[2], r[3] - r[1]);
  };
  H.drawPumpkinBlur = function (c) {
    if (NS.Use && NS.Use.isUsingSpyglass && NS.Use.isUsingSpyglass(NS.Player)) return;
    if (!H.pumpkinBlurWanted(NS.Player)) return;
    var sh = NS.Gui && NS.Gui.sheets && NS.Gui.sheets.pumpkinblur;
    if (sh) c.drawImage(sh.canvas, 0, 0, sh.canvas.width, sh.canvas.height, 0, 0, c.canvas.width, c.canvas.height);
  };

  /** `Slot.getBackgroundSprite` of the player menu: the empty armour / shield outlines. */
  H.emptySlotSheet = function (i) {
    return i >= 5 && i <= 8 ? ['empty_helmet', 'empty_chestplate', 'empty_leggings', 'empty_boots'][i - 5]
         : i === 45 ? 'empty_shield' : null;
  };

  /** Which menu slot the pointer is over, or -1. */
  H.invSlotAt = function (mx, my) {
    var g = NS.Gui, o = H.invOrigin;
    if (!g || !o || mx < 0) return -1;
    return g.slotAt((mx - o.x) / o.s, (my - o.y) / o.s);
  };

  /**
   * G11 (#366) - `HandledScreen.mouseClicked/mouseDragged/mouseReleased`, ported. ⚠ A PRESS IS NOT
   * ALWAYS A CLICK: with a stack in hand it only STARTS a drag (`cursorDragging`), and what it
   * turns into is decided on release - one slot is the plain PICKUP it always was, several is
   * QUICK_CRAFT begin/add.../end (type 0 left = split evenly, 1 right = one each). With the hand
   * empty it clicks at once and cancels the release, as vanilla does.
   * `button` is the DOM's (0 left, 1 middle, 2 right); vanilla's is 0/1, hence `b`. Middle is
   * dropped in `H.click` - vanilla only clones it in creative, and this is not creative.
   */
  H.uiInv = { drag: false, btn: 0, type: 0, slots: [], cancel: false, dbl: false,
              lastSlot: -2, lastTime: 0, lastBtn: -1, qm: null };

  H.inventoryClick = function (mx, my, button, shift, now) {
    var P = NS.Player, M = NS.Menu, U = H.uiInv;
    if (!M || !P || !P.menu) return false;
    var m = P.menu;
    var slot = H.invSlotAt(mx, my);
    var b = button === 2 ? 1 : 0;
    var t = now === undefined ? Date.now() : now;
    U.dbl = U.lastSlot === slot && t - U.lastTime < 250 && U.lastBtn === b;
    U.cancel = false;
    var target = slot < 0 ? M.OUTSIDE : slot;
    if (!U.drag) {
      if (!M.getCarried(m)) {
        if (shift && slot >= 0) {
          var qs = M.slotGet(m.slots[slot]);
          U.qm = qs ? NS.Inventory.copy(qs) : null;
          M.doClick(m, slot, b, M.QUICK_MOVE, P);
        } else if (slot < 0) {
          M.doClick(m, M.OUTSIDE, b, M.THROW, P);
        } else {
          M.doClick(m, slot, b, M.PICKUP, P);
        }
        U.cancel = true;
      } else {
        U.drag = true; U.btn = b; U.type = b; U.slots.length = 0;
        if (slot >= 0) H.inventoryDragAdd(slot);
      }
    }
    U.lastSlot = slot; U.lastTime = t; U.lastBtn = b;
    H.refreshCraftResult();
    P.syncHotbar();
    return true;
  };

  /** `canInsertItemIntoSlot(slot, carried, true)` + `slot.canInsert` + `canInsertIntoSlot`. */
  H.inventoryDragAdd = function (slot) {
    var P = NS.Player, M = NS.Menu, U = H.uiInv, m = P.menu;
    var sl = m.slots[slot], held = M.getCarried(m);
    if (!sl || !held || U.slots.indexOf(slot) >= 0) return;
    if ((held.n > U.slots.length || U.type === 2) && M.canItemQuickReplace(sl, held, true) &&
        M.slotMayPlace(sl, held) && M.canDragTo(m, sl)) U.slots.push(slot);
  };

  /** mouseDragged: the pointer moved with a button down. */
  H.inventoryDrag = function (mx, my) {
    if (!H.uiInv.drag) return false;
    var slot = H.invSlotAt(mx, my);
    if (slot >= 0) H.inventoryDragAdd(slot);
    return true;
  };

  H.inventoryRelease = function (mx, my, button, shift) {
    var P = NS.Player, M = NS.Menu, U = H.uiInv;
    if (!M || !P || !P.menu || button === 1) return false;
    var m = P.menu;
    var slot = H.invSlotAt(mx, my);
    var b = button === 2 ? 1 : 0;
    var target = slot < 0 ? M.OUTSIDE : slot;
    var done = false;
    if (U.dbl && slot >= 0 && b === 0) {
      if (shift) {
        if (U.qm) {
          var here = m.slots[slot].container || null;
          for (var i = 0; i < m.slots.length; i++) {
            var sl = m.slots[i], st = M.slotGet(sl);
            if (sl && st && M.slotMayPickup(sl, P) && (sl.container || null) === here &&
                NS.Inventory.isSameItemSameTags(st, U.qm)) M.doClick(m, i, 0, M.QUICK_MOVE, P);
          }
        }
      } else {
        M.doClick(m, slot, 0, M.PICKUP_ALL, P);
      }
      U.dbl = false; U.lastTime = 0;
      done = true;
    } else {
      if (U.drag && U.btn !== b) { U.drag = false; U.slots.length = 0; U.cancel = true; return true; }
      if (U.cancel) { U.cancel = false; return true; }
      if (U.drag && U.slots.length) {
        var hdr = function (stage) { return M.quickCraftMask ? M.quickCraftMask(stage, U.type) : ((stage & 3) | ((U.type & 3) << 2)); };
        M.doClick(m, M.OUTSIDE, hdr(0), M.QUICK_CRAFT, P);
        for (var k = 0; k < U.slots.length; k++) M.doClick(m, U.slots[k], hdr(1), M.QUICK_CRAFT, P);
        M.doClick(m, M.OUTSIDE, hdr(2), M.QUICK_CRAFT, P);
      } else if (M.getCarried(m)) {
        if (shift && slot >= 0) {
          var qs = M.slotGet(m.slots[slot]);
          U.qm = qs ? NS.Inventory.copy(qs) : null;
          M.doClick(m, slot, b, M.QUICK_MOVE, P);
        } else {
          M.doClick(m, target, b, M.PICKUP, P);
        }
      }
    }
    if (!M.getCarried(m)) U.lastTime = 0;
    U.drag = false; U.slots.length = 0;
    H.refreshCraftResult();
    P.syncHotbar();
    return true;
  };

  /** Hover + a number key -> SWAP with that hotbar slot; hover + Q -> THROW (ctrl = the stack). */
  H.inventoryKey = function (kind, arg) {
    var P = NS.Player, M = NS.Menu;
    if (!M || !P || !P.menu || !NS.Input) return false;
    var slot = H.invSlotAt(NS.Input.mx, NS.Input.my);
    if (slot < 0) return false;
    var m = P.menu;
    if (kind === 'swap') {
      if (M.getCarried(m)) return false;
      M.doClick(m, slot, arg, M.SWAP, P);
    } else if (kind === 'throw') {
      if (!M.slotGet(m.slots[slot])) return false;
      M.doClick(m, slot, arg ? 1 : 0, M.THROW, P);
    }
    H.refreshCraftResult();
    P.syncHotbar();
    return true;
  };

  // --- the chest screen (PASS 17 JOB 1, G19b) -----------------------------------

  /**
   * Open the chest (or trapped chest, barrel — D-403, or ender chest — D-404) at (x,y,z) as the
   * current screen. Returns false (and opens nothing) when there is no chest-shaped block entity
   * there — `Use.blockUse` is the only caller and it already checked the block, but a stale
   * target between the check and the click is exactly the kind of one-tick race this guards
   * against rather than trusts away.
   * ⚠ A barrel is a plain 27-slot generic container drawn from the SAME `generic_54.png` a
   * chest uses (vanilla's own `BarrelScreen.CONTAINER_BACKGROUND` — there is no
   * `gui/container/barrel.png` in the jar at all), so it opens through this same function
   * rather than a second one; `Hud.drawChest`'s own two-blit layout is unchanged either way.
   * ⚠ D-404 — AN ENDER CHEST IS THE SAME SCREEN OVER DIFFERENT STORAGE, NOT A DIFFERENT SCREEN.
   * `EnderChestScreen` is also `generic_54.png`; the one real difference vanilla has is that
   * `EnderChestMenu` is built over `player.getEnderChestInventory()` — a single 27-slot inventory
   * the player carries — rather than the clicked block's own container. So THIS is where that
   * gets decided: for an `ender_chest`-typed block entity only, its `.items` is rebound to
   * `P.enderItems` (by reference, not copied) before `Menu.chestMenu` ever sees it, so every
   * ender chest the player opens — any position — reads and writes the SAME 27 stacks. The block
   * entity itself is still real and still per-position: its own `.open` counter is untouched, so
   * the lid at THIS position animates independently, exactly like vanilla's own block entity
   * does alongside the shared inventory.
   */
  function BE0() { return NS.BlockEntities || {}; }
  H.openChest = function (x, y, z) {
    var BE = NS.BlockEntities, M = NS.Menu, P = NS.Player;
    if (!BE || !M || !P || !P.menu) return false;
    var be = BE.get(x, y, z);
    if (!be || (be.type !== 'chest' && be.type !== 'trapped_chest' && be.type !== 'barrel' &&
        be.type !== 'ender_chest' && be.type !== 'shulker_box')) return false;
    // s119 — `ChestBlock.isChestBlocked` (.decomp ChestBlock.java:323-345): a chest (and a
    // trapped chest, a ChestBlock subclass) will not open under a SOLID block (`isSolidBlock` =
    // Mojang's isRedstoneConductor, `Rs.isConductor`) or with a SITTING cat in the cell above;
    // a double is blocked if EITHER half is (the combiner's BiPredicate runs on both). The
    // ender chest asks only the solid block (EnderChestBlock.onUse:77-79). The click is still
    // CONSUMED (onUse returns CONSUME), so a blocked chest is not built against.
    var pairB = (be.type === 'chest' || be.type === 'trapped_chest') ? H.chestPair(x, y, z, be) : null;
    if (be.type === 'chest' || be.type === 'trapped_chest') {
      if (H.chestBlockedAt(x, y, z, true)) return 'blocked';
      if (pairB) {
        var other = pairB.first === be ? pairB.second : pairB.first;
        if (H.chestBlockedAt(other.x, other.y, other.z, true)) return 'blocked';
      }
    } else if (be.type === 'ender_chest' && H.chestBlockedAt(x, y, z, false)) {
      return 'blocked';
    }
    // s135 (KW-32 follow-up) -- every container type reachable here is in `guarded_by_piglins`
    // (ChestBlock/BarrelBlock/EnderChestBlock/ShulkerBoxBlock all call
    // `PiglinBrain.onGuardedBlockInteracted(player, true)` from their own onUse, .decomp reads
    // cited in src/07zzf_piglin.js) -- opening any of the five needs LINE OF SIGHT.
    if (NS.Piglin && NS.Piglin.ready) NS.Piglin.onGuardedBlockInteracted(P, true);
    if (be.lootTable && BE.generateLoot) BE.generateLoot(be, P);
    if (be.type === 'ender_chest') {
      if (!P.enderItems) P.enderItems = new Array(27);
      be.items = P.enderItems;
    }
    // D-406: `noNest` (Menu.chestMenu's 4th arg) is the shulker box's one behavioural
    // difference — "no shulker in a shulker" — and `chestTexture` is its one visual one:
    // vanilla ships its own `shulker_box.png` (unlike the barrel, which reuses generic_54's own
    // artwork, D-403), so `Hud.drawChest` below picks the sheet from this rather than
    // hard-coding `generic_54` the way it did before this block type existed.
    // D-413 — a DOUBLE chest: one 54-slot menu over this block entity and its partner's.
    var pair = pairB;
    if (pair) {
      H.chestMenu = M.chestMenu(pair.first, P.menu.inventory, 6, false, pair.second);
      pair.first.open = (pair.first.open || 0) + 1;
      pair.second.open = (pair.second.open || 0) + 1;
    } else {
      H.chestMenu = M.chestMenu(be, P.menu.inventory, 3, be.type === 'shulker_box');
      be.open = (be.open || 0) + 1;
      if (be.type === 'barrel' && BE0().barrelSync) BE0().barrelSync(be);
    }
    H.chestTexture = (be.type === 'shulker_box') ? 'shulker_box' : 'generic_54';
    // D-650 — ChestBlock's double factory names it "container.chestDouble"; every single one
    // takes its block entity's `getContainerName` (a trapped chest does not override chest's).
    H.chestTitleKind = pair ? 'double' : be.type;
    H.chestTitleText = null;
    H.chestPos = { x: x, y: y, z: z };
    H.open('chest');
    return true;
  };

  /** ChestMinecartEntity.getScreenHandler: 9x3 over the cart's 27 slots. The cart keeps {item,count,tag}; the menu
   *  wants Inventory stacks, so the menu runs on a converted copy that H.close writes back (`be.cart`). */
  H.openCartChest = function (e) {
    var M = NS.Menu, P = NS.Player, I = NS.Inventory, IT = NS.Items;
    if (!M || !P || !P.menu || !I || !IT) return false;
    var src = e.inventory || (e.inventory = []), items = [];
    for (var i = 0; i < 27; i++) {
      var s = src[i];
      items.push(s && s.count > 0 ? I.stack(s.item, s.count, 0, s.tag) : null);
    }
    var be = { type: 'chest', items: items, cart: e, open: 0 };
    H.chestMenu = M.chestMenu(be, P.menu.inventory, 3, false);
    H.chestTexture = 'generic_54';
    H.chestTitleKind = 'chest';
    H.chestTitleText = NS.Minecart.cartTitle(e);
    H.chestPos = null;
    H.open('chest');
    return true;
  };

  /** HopperMinecartEntity.getScreenHandler: HopperScreenHandler over the cart's 5 slots (converted copy, written back like the chest cart's). */
  H.openCartHopper = function (e) {
    var M = NS.Menu, P = NS.Player, I = NS.Inventory;
    if (!M || !P || !P.menu || !I) return false;
    var src = e.inventory || (e.inventory = []), items = [];
    for (var i = 0; i < 5; i++) {
      var s = src[i];
      items.push(s && s.count > 0 ? I.stack(s.item, s.count, 0, s.tag) : null);
    }
    H.hopperCartBe = { type: 'hopper', items: items, cart: e };
    H.hopperMenu = M.hopperMenu(H.hopperCartBe, P.menu.inventory);
    H.hopperPos = null;
    H.hopperTitleText = NS.Minecart.cartTitle(e);
    H.open('hopper');
    return true;
  };

  /** s119 — `hasBlockOnTop || (cats && hasOcelotOnTop)`: solid above, or a sitting cat whose box
   *  touches Box(x, y+1, z, x+1, y+2, z+1) (`getNonSpectatingEntities` = box intersection). */
  H.chestBlockedAt = function (x, y, z, cats) {
    var W = NS.World, Rs = NS.Redstone;
    if (W && Rs && Rs.isConductor && Rs.isConductor(W.getBlock(x, y + 1, z))) return true;
    if (!cats) return false;
    var EL = NS.EntityList, list = EL && EL.list;
    if (!list) return false;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || e.removed || e.type !== 'cat' || !e.sitting) continue;
      var hw = (e.width !== undefined ? e.width : 0.6) / 2, h = e.height !== undefined ? e.height : 0.7;
      if (e.x + hw > x && e.x - hw < x + 1 && e.z + hw > z && e.z - hw < z + 1 &&
          e.y + h > y + 1 && e.y < y + 2) return true;
    }
    return false;
  };

  /**
   * chestPair(x, y, z, be) -> { first, second } block entities of the double chest this cell is
   * half of, or null when it is (or must be treated as) a single chest.
   * ⚠ `first` is the `type=right` half: `ChestBlock.getBlockType` maps RIGHT to FIRST and LEFT to
   * SECOND, and `CompoundContainer(first, second)` puts `first` in slots 0..26 — the TOP three
   * rows. That mapping is transcribed from the public 1.18.2 source, not read out of this jar
   * (there is no javap on the machines this runs on) — D-413 names it as the one unreferee'd fact.
   * `DoubleBlockCombiner.combine` only pairs when the partner cell holds the same block, is itself
   * a non-single half of the OTHER type, and faces the same way; anything else opens as a single.
   */
  H.chestPair = function (x, y, z, be) {
    var SR = NS.States, R = NS.Reg, W = NS.World, BE = NS.BlockEntities, Pl = NS.Player;
    if (!SR || !R || !R.PROP || !W || !BE || (be.type !== 'chest' && be.type !== 'trapped_chest')) return null;
    var P_ = R.PROP, V = R.PVAL;
    var st = W.getBlock(x, y, z), type = SR.propValue(st, P_.type);
    if (type !== V.left && type !== V.right) return null;
    var f = SR.propValue(st, P_.facing);
    var s = Pl.dirStep(V, type === V.left ? Pl.turnCW(V, f) : Pl.turnCCW(V, f));
    if (!s) return null;
    var px = x + s[0], pz = z + s[1];
    var ps = W.getBlock(px, y, pz);
    if (SR.block[ps] !== SR.block[st] || SR.propValue(ps, P_.facing) !== f) return null;
    var pt = SR.propValue(ps, P_.type);
    if ((pt !== V.left && pt !== V.right) || pt === type) return null;
    var pbe = BE.get(px, y, pz);
    if (!pbe || pbe.type !== be.type) return null;
    return type === V.right ? { first: be, second: pbe } : { first: pbe, second: be };
  };

  H.drawChest = function (c) {
    var g = NS.Gui, M = NS.Menu, m = H.chestMenu;
    if (!g || !g.ready || !M || !m) { H.drawInventoryFallback(c); return; }
    var V = g.CHEST, rows = m.rows, s = Math.max(2, H.scale);
    var tex = H.chestTexture || 'generic_54';
    var isShulker = (tex === 'shulker_box');
    var w = V.w, h = isShulker ? g.SHULKER.h : V.h(rows);
    var ox = Math.round((H.w - w * s) * 0.5);
    var oy = Math.round((H.h - h * s) * 0.5);
    H.chestOrigin = { x: ox, y: oy, s: s, rows: rows };

    g.dim(c, H.w, H.h);
    var topH = rows * 18 + 17;
    if (isShulker) {
      // D-406: `shulker_box.png` is its own whole, self-contained 176x166 image (not a crop of
      // a bigger multi-size sheet like `generic_54.png`), so its bottom band is drawn 1:1 off
      // its OWN remaining rows rather than the generic_54-style fixed source-y=125 trick —
      // `g.SHULKER`'s own header names the pixel comparison that proves this is the right split.
      g.blit(c, tex, [0, 0, w, topH], ox, oy, s);
      g.blit(c, tex, [0, topH, w, g.SHULKER.h - topH], ox, oy + topH * s, s);
    } else {
      // ⚠ TWO BLITS, not one. Vanilla draws a `rows`-tall top part and then the SAME fixed
      // 96-GUI-pixel player-inventory band every generic container uses, read from a fixed
      // source offset further down `generic_54.png` — not a second image. See `Menu.chestMenu`'s
      // own caveat: this split is transcribed from public decompiles, not yet bytecode-verified.
      g.blit(c, tex, [0, 0, w, topH], ox, oy, s);
      // D-652 — `GenericContainerScreen.drawBackground` (.decomp:40): source (0, 126), 96 tall.
      g.blit(c, tex, [0, 126, w, 96], ox, oy + topH * s, s);
    }

    var hover = NS.Input ? g.chestSlotAt((NS.Input.mx - ox) / s, (NS.Input.my - oy) / s, rows, isShulker) : -1;
    var total = rows * 9 + 36;
    for (var i = 0; i < total; i++) {
      var p = g.chestSlotXY(i, rows, isShulker);
      var sx = ox + p[0] * s, sy = oy + p[1] * s;
      if (i === hover) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(sx, sy, 16 * s, 16 * s); }
      var st = M.slotGet(m.slots[i]);
      if (st) H.drawItem(c, st, sx, sy, 16 * s);
    }
    // D-650 — `HandledScreen.drawForeground`: the title and "Inventory", 0x404040, no shadow.
    var CT = isShulker ? g.SHULKER.title : V.title;
    var CLy = isShulker ? g.SHULKER.inventoryLabel.y : V.invLabelY(rows);
    g.text(c, H.chestTitleText || H.titleOf(H.chestTitleKind || 'chest'), ox + CT.x * s, oy + CT.y * s, s, 0x404040, false);
    g.text(c, H.titleOf('inventory'), ox + 8 * s, oy + CLy * s, s, 0x404040, false);

    var carried = M.getCarried(m);
    if (carried && NS.Input) H.drawItem(c, carried, NS.Input.mx - 8 * s, NS.Input.my - 8 * s, 16 * s);
    if (hover >= 0 && !carried) {
      var hs = M.slotGet(m.slots[hover]);
      if (hs && !NS.Inventory.isEmpty(hs)) {
        H.drawStackTooltip(c, hs, s);
      }
    }
  };

  /** A click inside the chest screen. Same `ClickType` shape as `H.inventoryClick`. */
  H.chestClick = function (mx, my, button, shift) {
    var M = NS.Menu, m = H.chestMenu, P = NS.Player;
    if (!M || !m) return false;
    var o = H.chestOrigin;
    var slot = (o && mx >= 0) ? NS.Gui.chestSlotAt((mx - o.x) / o.s, (my - o.y) / o.s, m.rows, H.chestTexture === 'shulker_box') : -1;
    var b = button === 2 ? 1 : 0;
    if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);
    else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);
    else M.doClick(m, slot, b, M.PICKUP, P);
    if (P && P.syncHotbar) P.syncHotbar();
    return true;
  };

  // --- the crafting table screen (PASS 17 JOB 1, G19b, session 44) -----------------------

  /**
   * Open the crafting table's own screen. ⚠ UNLIKE A CHEST, a crafting table has no block entity
   * and no per-position state — vanilla's own `CraftingTableBlock.use` just builds a fresh
   * `CraftingMenu` over the player's inventory every time, so this does the same rather than
   * looking anything up at (x,y,z) beyond confirming a crafting table is genuinely still there
   * (`Use.blockUse` already checked once; a stale target between that check and the click is the
   * same one-tick race `Hud.openChest` guards against rather than trusts away).
   */
  H.openCraftingTable = function (x, y, z) {
    var M = NS.Menu, P = NS.Player, S = NS.States, W = NS.World;
    if (!M || !P || !P.menu || !W || !S || !S.ready) return false;
    var state = W.getBlock(x, y, z);
    if (!(state > 0) || S.name(state) !== 'crafting_table') return false;
    H.craftingMenu = M.craftingMenu(P.menu.inventory, P);
    H.open('crafting');
    return true;
  };

  H.drawCrafting = function (c) {
    var g = NS.Gui, M = NS.Menu, m = H.craftingMenu;
    if (!g || !g.ready || !M || !m) { H.drawInventoryFallback(c); return; }
    var V = g.CRAFTING, s = Math.max(2, H.scale);
    var ox = Math.round((H.w - V.w * s) * 0.5);
    var oy = Math.round((H.h - V.h * s) * 0.5);
    H.craftingOrigin = { x: ox, y: oy, s: s };

    g.dim(c, H.w, H.h);
    g.blit(c, 'crafting_table', [0, 0, V.w, V.h], ox, oy, s);

    H.refreshCraftingResult();
    var hover = NS.Input ? g.craftSlotAt((NS.Input.mx - ox) / s, (NS.Input.my - oy) / s) : -1;
    for (var i = 0; i < 46; i++) {
      var p = g.craftSlotXY(i);
      var sx = ox + p[0] * s, sy = oy + p[1] * s;
      if (i === hover) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(sx, sy, 16 * s, 16 * s); }
      var st = M.slotGet(m.slots[i]);
      if (st) H.drawItem(c, st, sx, sy, 16 * s);
    }
    // D-650 — "Crafting" at (29, 6) and "Inventory" at (8, 72), `HandledScreen.drawForeground`.
    g.text(c, H.titleOf('crafting'), ox + V.title.x * s, oy + V.title.y * s, s, 0x404040, false);
    g.text(c, H.titleOf('inventory'), ox + V.inventoryLabel.x * s, oy + V.inventoryLabel.y * s, s, 0x404040, false);

    var carried = M.getCarried(m);
    if (carried && NS.Input) H.drawItem(c, carried, NS.Input.mx - 8 * s, NS.Input.my - 8 * s, 16 * s);
    if (hover >= 0 && !carried) {
      var hs = M.slotGet(m.slots[hover]);
      if (hs && !NS.Inventory.isEmpty(hs)) {
        H.drawStackTooltip(c, hs, s);
      }
    }
  };

  /** A click inside the crafting-table screen. Same `ClickType` shape as `H.chestClick`. */
  H.craftingClick = function (mx, my, button, shift) {
    var M = NS.Menu, m = H.craftingMenu, P = NS.Player;
    if (!M || !m) return false;
    var o = H.craftingOrigin;
    var slot = (o && mx >= 0) ? NS.Gui.craftSlotAt((mx - o.x) / o.s, (my - o.y) / o.s) : -1;
    var b = button === 2 ? 1 : 0;
    if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);
    else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);
    else M.doClick(m, slot, b, M.PICKUP, P);
    H.refreshCraftingResult();
    if (P && P.syncHotbar) P.syncHotbar();
    return true;
  };

  // --- the furnace, blast furnace and smoker (PASS 17 JOB 1, G19b, D-414) -----------------

  /**
   * Open the screen of the furnace-family block entity at (x, y, z). ⚠ THE SCREEN IS A WINDOW ON
   * THE BLOCK ENTITY, NOT A COPY: `Menu.furnaceMenu` reads its three slots and its four counters
   * straight off `be`, so the furnace keeps smelting under an open screen and the arrow moves.
   * Vanilla ships a sheet each for the three, and they are pixel-identical, so all draw `furnace`.
   */
  H.openFurnace = function (x, y, z) {
    var BE = NS.BlockEntities, M = NS.Menu, P = NS.Player;
    if (!BE || !M || !P || !P.menu) return false;
    var be = BE.get(x, y, z);
    if (!be || (be.type !== 'furnace' && be.type !== 'blast_furnace' && be.type !== 'smoker')) return false;
    H.furnaceMenu = M.furnaceMenu(be, P.menu.inventory);
    H.furnacePos = { x: x, y: y, z: z };
    H.open('furnace');
    return true;
  };

  H.drawFurnace = function (c) {
    var g = NS.Gui, M = NS.Menu, m = H.furnaceMenu;
    if (!g || !g.ready || !M || !m) { H.drawInventoryFallback(c); return; }
    var V = g.FURNACE, s = Math.max(2, H.scale), be = m.be;
    var ox = Math.round((H.w - V.w * s) * 0.5);
    var oy = Math.round((H.h - V.h * s) * 0.5);
    H.furnaceOrigin = { x: ox, y: oy, s: s };

    g.dim(c, H.w, H.h);
    g.blit(c, 'furnace', [0, 0, V.w, V.h], ox, oy, s);

    // `AbstractFurnaceScreen.renderBg`, in its own order: the flame (only while lit) rises from the
    // bottom, `l + 1` rows of it, then the arrow, `l + 1` columns of it — both off the counters.
    if (M.furnaceIsLit(be)) {
      var l = M.furnaceLitProgress(be), F = V.flame;
      g.blit(c, 'furnace', [F.sx, F.sy + 12 - l, F.w, l + 1],
             ox + F.x * s, oy + (F.y + 12 - l) * s, s);
    }
    var A = V.arrow, b = M.furnaceBurnProgress(be);
    g.blit(c, 'furnace', [A.sx, A.sy, b + 1, A.h], ox + A.x * s, oy + A.y * s, s);

    // the two labels, in vanilla's dark grey and without a shadow: the block's name centred, and
    // "Inventory" over the backpack (`titleLabelX = (imageWidth - font.width(title)) / 2`)
    var title = H.displayName(be.type, false);
    g.text(c, title, ox + Math.round((V.w - g.textWidth(title)) / 2) * s, oy + V.title.y * s, s, 0x404040, false);
    g.text(c, 'Inventory', ox + V.inventoryLabel.x * s, oy + V.inventoryLabel.y * s, s, 0x404040, false);

    var hover = NS.Input ? g.furnaceSlotAt((NS.Input.mx - ox) / s, (NS.Input.my - oy) / s) : -1;
    for (var i = 0; i < 39; i++) {
      var p = g.furnaceSlotXY(i);
      var sx = ox + p[0] * s, sy = oy + p[1] * s;
      if (i === hover) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(sx, sy, 16 * s, 16 * s); }
      var st = M.slotGet(m.slots[i]);
      if (st) H.drawItem(c, st, sx, sy, 16 * s);
    }

    var carried = M.getCarried(m);
    if (carried && NS.Input) H.drawItem(c, carried, NS.Input.mx - 8 * s, NS.Input.my - 8 * s, 16 * s);
    if (hover >= 0 && !carried) {
      var hs = M.slotGet(m.slots[hover]);
      if (hs && !NS.Inventory.isEmpty(hs)) {
        H.drawStackTooltip(c, hs, s);
      }
    }
  };

  /** A click inside a furnace-family screen. Same `ClickType` shape as `H.chestClick`. */
  H.furnaceClick = function (mx, my, button, shift) {
    var M = NS.Menu, m = H.furnaceMenu, P = NS.Player;
    if (!M || !m) return false;
    var o = H.furnaceOrigin;
    var slot = (o && mx >= 0) ? NS.Gui.furnaceSlotAt((mx - o.x) / o.s, (my - o.y) / o.s) : -1;
    var b = button === 2 ? 1 : 0;
    if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);
    else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);
    else M.doClick(m, slot, b, M.PICKUP, P);
    if (P && P.syncHotbar) P.syncHotbar();
    return true;
  };

  // --- enchant glint and tooltips (PLAN G22) ------------------------------------------------

  var GLINT_ALWAYS = { enchanted_book: 1, enchanted_golden_apple: 1, nether_star: 1, experience_bottle: 1, end_crystal: 1 };
  /** `ItemStack.hasGlint`: `Item.hasGlint` is `hasEnchantments`; a book's `StoredEnchantments` and the
   *  handful of items that override it (`EnchantedBookItem`, `EnchantedGoldenAppleItem`, `NetherStarItem`,
   *  `ExperienceBottleItem`, `EndCrystalItem`) always glow. */
  H.stackHasGlint = function (st) {
    if (!st || !NS.Items) return false;
    var t = st.t;
    if (t && ((t.Enchantments && t.Enchantments.length) || (t.StoredEnchantments && t.StoredEnchantments.length))) return true;
    return GLINT_ALWAYS[NS.Items.nameOf(st.i)] === 1;
  };

  var glintCv = null;
  /**
   * The glint: the jar's `enchanted_item_glint.png` scrolled diagonally with time, clipped to the item's
   * own silhouette (`source-in` over a copy of what was just drawn) and added over it. Vanilla's shader
   * tints it (0.5, 0.25, 0.8) and blends additively at half strength — the same three numbers here.
   * Drawn on a scratch canvas the size of the icon, only for a stack that has one.
   */
  H.drawGlint = function (c, stack, x, y, size) {
    var g = NS.Gui, sh = g && g.ready && g.sheets && g.sheets.enchant_glint;
    if (!sh || size < 1 || typeof document === 'undefined') return;
    size = Math.round(size);
    if (!glintCv) glintCv = document.createElement('canvas');
    if (glintCv.width !== size) { glintCv.width = size; glintCv.height = size; }
    var t = glintCv.getContext('2d');
    t.imageSmoothingEnabled = false;
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, size, size);
    // copy the item out of the frame it was just drawn into, then keep only the glint inside it
    t.drawImage(c.canvas, x, y, size, size, 0, 0, size, size);
    t.globalCompositeOperation = 'source-in';
    var now = (typeof performance !== 'undefined' ? performance.now() : 0);
    var ox = ((now / 3000) % 1) * size * 2, oy = ((now / 4873) % 1) * size * 2;
    var tile = size * 2;
    for (var ty = -tile + oy; ty < size; ty += tile) {
      for (var tx = -tile + ox; tx < size; tx += tile) t.drawImage(sh.canvas, tx, ty, tile, tile);
    }
    t.globalCompositeOperation = 'multiply';
    t.fillStyle = 'rgb(128,64,204)';
    t.fillRect(0, 0, size, size);
    var prev = c.globalCompositeOperation, pa = c.globalAlpha;
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.5;
    c.drawImage(glintCv, x, y);
    c.globalCompositeOperation = prev;
    c.globalAlpha = pa;
  };

  // ── STATUS EFFECT HUD (#297, G23e) ───────────────────────────────────────────────────────
  // `InGameHud.renderStatusEffectOverlay` (top right) and `AbstractInventoryScreen.drawStatusEffects`
  // (beside the inventory), both read whole from .decomp. Sprites are the `mob_effects` sheet (8x4 cells
  // of 18x18, cell = raw id - 1, built by tools/build-gui.mjs); the frames are `inventory.png`'s.
  // Everything the check asserts is a pure function of (effects, screen size); the draw just paints it.
  // StatusEffectCategory != BENEFICIAL: these 13 are the harmful (12) and neutral (glowing, bad_omen) ones.
  H.NOT_BENEFICIAL = { slowness: 1, mining_fatigue: 1, instant_damage: 1, nausea: 1, blindness: 1, hunger: 1,
    weakness: 1, poison: 1, wither: 1, glowing: 1, levitation: 1, unluck: 1, bad_omen: 1 };
  H.effectIsPermanent = function (inst) { return !!inst.permanent || inst.duration > 32767; };
  /** StringHelper.formatTicks / StatusEffectUtil.durationToString(inst, 1.0F). */
  H.effectDuration = function (inst) {
    if (H.effectIsPermanent(inst)) return '**:**';
    var t = Math.floor(inst.duration / 20), m = Math.floor(t / 60); t %= 60;
    return t < 10 ? m + ':0' + t : m + ':' + t;
  };
  /** `StatusEffectInstance.compareTo`: ambient, then duration (unless both are long), then colour. */
  H.effectCompare = function (a, b) {
    var col = function (i) { return (NS.Potion && NS.Potion.EFFECT_COLOR || {})[i.effect] || 0; };
    var cmp = function (x, y) { return x < y ? -1 : x > y ? 1 : 0; };
    var skipDur = (a.duration > 32147 && b.duration > 32147) || (a.ambient && b.ambient);
    var r = cmp(a.ambient ? 1 : 0, b.ambient ? 1 : 0);
    if (r) return r;
    if (!skipDur) { r = cmp(a.duration, b.duration); if (r) return r; }
    return cmp(col(a), col(b));
  };
  H.effectList = function (P, reverse) {
    var out = [], e = P && P.effects;
    for (var k in e) if (e.hasOwnProperty(k) && e[k]) { e[k].effect = e[k].effect || k; out.push(e[k]); }
    out.sort(H.effectCompare);
    return reverse ? out.reverse() : out;
  };
  /** The blink alpha for an effect with <= 200 ticks left (not ambient). */
  H.effectAlpha = function (inst) {
    var d = inst.duration;
    if (inst.ambient || d > 200) return 1;
    var cl = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
    var f = 10 - Math.floor(d / 20);   // int division, d >= 0
    return cl(d / 10 / 5 * 0.5, 0, 0.5) + Math.cos(d * Math.PI / 5) * cl(f / 10 * 0.25, 0, 0.25);
  };
  /** Top-right icons: [{inst, x, y, frame:[u,v], alpha}] in scaled-GUI pixels, drawing order. */
  H.effectOverlayLayout = function (list, guiW, demo) {
    var out = [], good = 0, bad = 0;
    for (var i = 0; i < list.length; i++) {
      var inst = list[i];
      if (inst.showIcon === false) continue;
      var x = guiW, y = demo ? 16 : 1;
      if (!H.NOT_BENEFICIAL[inst.effect]) { good++; x -= 25 * good; }
      else { bad++; x -= 25 * bad; y += 26; }
      out.push({ inst: inst, x: x, y: y, frame: inst.ambient ? [165, 166] : [141, 166], alpha: H.effectAlpha(inst) });
    }
    return out;
  };
  H.effectName = function (inst) {
    var Tx = NS.Text, tr = function (k) { return (Tx && Tx.ready) ? Tx.translate(k) : k; };
    var n = tr('effect.minecraft.' + inst.effect);
    if (n.indexOf('effect.') === 0) n = inst.effect.replace(/_/g, ' ');
    if (inst.amplifier >= 1 && inst.amplifier <= 9) {
      var lv = tr('enchantment.level.' + (inst.amplifier + 1));
      n += ' ' + (lv.indexOf('enchantment.') === 0 ? String(inst.amplifier + 1) : lv);
    }
    return n;
  };
  /** The inventory column: null when there is < 32 px right of the panel, else rows and layout. */
  H.effectInventoryLayout = function (list, guiW, panelX, panelW, panelY) {
    var x = panelX + panelW + 2, room = guiW - x;
    if (!list.length || room < 32) return null;
    var wide = room >= 120, step = list.length > 5 ? Math.floor(132 / (list.length - 1)) : 33;
    var rows = [];
    for (var i = 0; i < list.length; i++) {
      var y = panelY + i * step;
      rows.push({ inst: list[i], x: x, y: y, spriteX: x + (wide ? 6 : 7), spriteY: y + 7,
        frame: wide ? [0, 166, 120, 32] : [0, 198, 32, 32], textX: x + 28, nameY: y + 6, timeY: y + 16 });
    }
    return { wide: wide, step: step, rows: rows, x: x };
  };
  H.hideEffectOverlay = function () {
    if (H.screen !== 'inventory' || !H.invOrigin) return false;
    var s = H.invOrigin.s, g = NS.Gui;
    return H.w / s - (H.invOrigin.x / s + g.INV.w + 2) >= 32;
  };
  var effSprite = function (c, g, inst, x, y, alpha) {
    var id = NS.Effects && NS.Effects.IDS[inst.effect];
    if (!id) return;
    var sh = g.sheets && g.sheets.mob_effects;
    if (!sh) return;
    var i = id - 1, k = x.k;
    c.globalAlpha = alpha;
    c.drawImage(sh.canvas, (i % 8) * 18, ((i / 8) | 0) * 18, 18, 18, x.x * k, y * k, 18 * k, 18 * k);
    c.globalAlpha = 1;
  };
  H.drawEffectOverlay = function (c) {
    var P = NS.Player, g = NS.Gui;
    if (!P || !g || !g.ready || H.hideEffectOverlay()) return;
    var k = H.scale || 1, lay = H.effectOverlayLayout(H.effectList(P, true), H.w / k, false);
    for (var i = 0; i < lay.length; i++) g.blit(c, 'inventory', [lay[i].frame[0], lay[i].frame[1], 24, 24], lay[i].x * k, lay[i].y * k, k);
    for (i = 0; i < lay.length; i++) effSprite(c, g, lay[i].inst, { x: lay[i].x + 3, k: k }, lay[i].y + 3, lay[i].alpha);
  };
  H.drawInventoryEffects = function (c) {
    var P = NS.Player, g = NS.Gui, o = H.invOrigin;
    if (!P || !g || !g.ready || !o) return;
    var s = o.s, lay = H.effectInventoryLayout(H.effectList(P, false), H.w / s, o.x / s, g.INV.w, o.y / s);
    if (!lay) return;
    var i, r;
    for (i = 0; i < lay.rows.length; i++) { r = lay.rows[i]; g.blit(c, 'inventory', r.frame, r.x * s, r.y * s, s); }
    for (i = 0; i < lay.rows.length; i++) { r = lay.rows[i]; effSprite(c, g, r.inst, { x: r.spriteX, k: s }, r.spriteY, 1); }
    if (!lay.wide) return;
    for (i = 0; i < lay.rows.length; i++) {
      r = lay.rows[i];
      g.text(c, H.effectName(r.inst), r.textX * s, r.nameY * s, s, 0xFFFFFF, true);
      g.text(c, H.effectDuration(r.inst), r.textX * s, r.timeY * s, s, 0x7F7F7F, true);
    }
  };

  var ROMAN_LEVEL_KEY = 'enchantment.level.';
  /** `Enchantment.getName(level)`: the translated name, then the level's numeral unless it is a lone
   *  level-1 enchantment (`maxLevel == 1`). Curses are red, the rest grey. */
  H.enchantmentLine = function (id, level) {
    var Tx = NS.Text, EH = NS.EnchHelper, tr = function (k) { return (Tx && Tx.ready) ? Tx.translate(k) : k; };
    var bare = String(id).replace(/^minecraft:/, '');
    var name = tr('enchantment.minecraft.' + bare);
    if (name.indexOf('enchantment.') === 0) name = bare.replace(/_/g, ' ');
    var max = EH && EH.ENCH && EH.ENCH[bare] ? EH.ENCH[bare].maxLevel : 0;
    if (level !== 1 || max !== 1) {
      var lv = tr(ROMAN_LEVEL_KEY + level);
      name += ' ' + (lv.indexOf('enchantment.') === 0 ? String(level) : lv);
    }
    return { text: name, rgb: (bare === 'binding_curse' || bare === 'vanishing_curse') ? 0xFF5555 : 0xAAAAAA };
  };

  // --- ItemStack.getTooltip / Screen.renderTooltipFromComponents (#365) --------------------------
  // Item.rarity out of Items.<clinit> (`Settings.rarity`); everything else is COMMON. 1 UNCOMMON, 2 RARE, 3 EPIC.
  var RARITY_ITEMS = {
    1: 'elytra experience_bottle skeleton_skull wither_skeleton_skull player_head zombie_head creeper_head dragon_head nether_star enchanted_book dragon_breath totem_of_undying heart_of_the_sea creeper_banner_pattern skull_banner_pattern',
    2: 'beacon conduit golden_apple end_crystal music_disc_13 music_disc_cat music_disc_blocks music_disc_chirp music_disc_far music_disc_mall music_disc_mellohi music_disc_stal music_disc_strad music_disc_ward music_disc_11 music_disc_wait music_disc_otherside music_disc_pigstep',
    3: 'spawner dragon_egg command_block barrier light repeating_command_block chain_command_block structure_void structure_block jigsaw enchanted_golden_apple command_block_minecart knowledge_book debug_stick mojang_banner_pattern'
  };
  var RARITY_OF = {};
  (function () {
    for (var r in RARITY_ITEMS) RARITY_ITEMS[r].split(' ').forEach(function (n) { RARITY_OF[n] = +r; });
  })();
  var RARITY_RGB = [0xFFFFFF, 0xFFFF55, 0x55FFFF, 0xFF55FF];   // Rarity.formatting: WHITE, YELLOW, AQUA, LIGHT_PURPLE
  var SLOT_KEYS = ['mainhand', 'offhand', 'feet', 'legs', 'chest', 'head'];
  /** `Item.getRarity(stack)`: enchanted stacks bump COMMON/UNCOMMON to RARE and RARE to EPIC. */
  H.rarityOf = function (st) {
    var r = RARITY_OF[NS.Items.nameOf(st.i)] | 0;
    var t = st.t;
    var ench = t && ((t.Enchantments && t.Enchantments.length) || (t.StoredEnchantments && t.StoredEnchantments.length));
    if (ench && t.Enchantments && t.Enchantments.length) r = r <= 1 ? 2 : (r === 2 ? 3 : r);
    return r;
  };
  function tt(key, args) { var Tx = NS.Text; return (Tx && Tx.ready) ? Tx.translate(key, args) : key; }
  /** `MODIFIER_FORMAT`: a DecimalFormat("#.##"). */
  function fmt(v) { return String(Math.round(v * 100) / 100); }
  function customName(st) {
    var n = st.t && st.t.display && st.t.display.Name;
    if (typeof n !== 'string') return null;
    try { var j = JSON.parse(n); return typeof j === 'string' ? j : (j && typeof j.text === 'string' ? j.text : n); }
    catch (e) { return n; }
  }
  function attrLines(st) {
    var name = NS.Items.nameOf(st.i), IT = NS.Items, Hd = NS.Hand, out = [], a = Hd && Hd.attrsFor ? Hd.attrsFor(st) : null;
    var slot = IT.equipSlot(st.i), first = function (s) { out.push({ text: '', rgb: 0xFFFFFF }); out.push({ text: tt('item.modifiers.' + SLOT_KEYS[s]), rgb: 0xAAAAAA }); };
    var plus = function (v, key) { out.push({ text: tt('attribute.modifier.plus.0', [fmt(v), tt('attribute.name.generic.' + key)]), rgb: 0x5555FF }); };
    if (a) {   // ATTACK_DAMAGE / ATTACK_SPEED modifiers, merged with the player's own base value ("equals")
      first(0);
      out.push({ text: ' ' + tt('attribute.modifier.equals.0', [fmt(a[0]), tt('attribute.name.generic.attack_damage')]), rgb: 0x00AA00 });
      out.push({ text: ' ' + tt('attribute.modifier.equals.0', [fmt(a[1]), tt('attribute.name.generic.attack_speed')]), rgb: 0x00AA00 });
    } else if (IT.isWearable(st.i) && IT.defenseOf(st.i) > 0) {
      first(slot);
      plus(IT.defenseOf(st.i), 'armor');
      if (IT.toughnessOf(st.i) > 0) plus(IT.toughnessOf(st.i), 'armor_toughness');
      if (name.indexOf('netherite_') === 0) plus(1, 'knockback_resistance');   // 0.1 x 10
    }
    return out;
  }

  var FISH_DYES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  var FISH_VARIETY = ['flopper', 'stripey', 'glitter', 'blockfish', 'betty', 'clayfish', 'kob', 'sunstreak', 'snooper', 'dasher', 'brinely', 'spotty'];
  /** `EntityBucketItem.appendTooltip` for a tropical fish bucket: predefined line, else variety + dye colours (ITALIC GRAY). */
  function fishBucketLines(v) {
    var F = NS.Fish, line = function (text) { return { text: text, rgb: 0xAAAAAA, italic: true }; };
    var i = F.COMMON_VARIANTS.indexOf(v);
    if (i >= 0) return [line(tt('entity.minecraft.tropical_fish.predefined.' + i))];
    var b = FISH_DYES[F.getBaseDyeColorIndex(v) & 15], p = FISH_DYES[F.getPatternDyeColorIndex(v) & 15];
    return [line(tt('entity.minecraft.tropical_fish.type.' + FISH_VARIETY[F.getPattern(v) + 6 * F.getShape(v)])),
            line(tt('color.minecraft.' + b) + (b !== p ? ', ' + tt('color.minecraft.' + p) : ''))];
  }

  // `StatusEffects.<clinit>`: the HARMFUL category (StatusEffectCategory.field_18272, Formatting.RED); the rest are BENEFICIAL/NEUTRAL (BLUE).
  var HARMFUL_EFFECTS = { slowness: 1, mining_fatigue: 1, instant_damage: 1, nausea: 1, blindness: 1, hunger: 1, weakness: 1, poison: 1, wither: 1, levitation: 1, unluck: 1 };
  var POTION_TIP_SCALE = { potion: 1, splash_potion: 1, lingering_potion: 0.25, tipped_arrow: 0.125 };
  /** `StringHelper.formatTicks`. */
  function formatTicks(t) { var s = Math.floor(t / 20), m = Math.floor(s / 60); s %= 60; return s < 10 ? m + ':0' + s : m + ':' + s; }
  /** `PotionUtil.buildTooltip(stack, list, durationMultiplier)`: effect lines, "No Effects", then "When Applied:" modifier lines. */
  H.potionTooltipLines = function (st, scale) {
    var Po = NS.Potion, ES = NS.Effects, t = st.t, pid = t && typeof t.Potion === 'string' ? t.Potion.replace(/^minecraft:/, '') : null;
    var effs = Po.effectsOf(pid, t && t.CustomPotionEffects), out = [], mods = [];
    if (!effs.length) return [{ text: tt('effect.none'), rgb: 0xAAAAAA }];
    for (var i = 0; i < effs.length; i++) {
      var e = effs[i], amp = e.amplifier | 0, txt = tt('effect.minecraft.' + e.effect), ms = ES.ATTR_MODIFIERS[e.effect] || [];
      for (var j = 0; j < ms.length; j++) mods.push({ attr: ms[j].attr, op: ms[j].op, v: ES.adjustModifierAmount(ms[j], amp) });
      if (amp > 0) txt = tt('potion.withAmplifier', [txt, tt('potion.potency.' + amp)]);
      if (e.duration > 20) txt = tt('potion.withDuration', [txt, formatTicks(Math.floor(e.duration * scale))]);
      out.push({ text: txt, rgb: HARMFUL_EFFECTS[e.effect] ? 0xFF5555 : 0x5555FF });
    }
    if (mods.length) {
      out.push({ text: '', rgb: 0xFFFFFF });
      out.push({ text: tt('potion.whenDrank'), rgb: 0xAA00AA });
      for (var k = 0; k < mods.length; k++) {
        var m = mods[k], v = m.op === 0 ? m.v : m.v * 100, name = tt('attribute.name.' + m.attr);
        if (m.v > 0) out.push({ text: tt('attribute.modifier.plus.' + m.op, [fmt(v), name]), rgb: 0x5555FF });
        else if (m.v < 0) out.push({ text: tt('attribute.modifier.take.' + m.op, [fmt(-v), name]), rgb: 0xFF5555 });
      }
    }
    return out;
  };

  /** `ItemStack.getTooltip` (non-advanced): [{text, rgb, italic?}] — the rarity-coloured name (custom name in italics),
   *  enchantments, dye, the attribute-modifier section, Unbreakable; `HideFlags` bits 1,2,4,8,16 hide sections. */
  H.stackTooltipLines = function (st) {
    var cn = customName(st), t = st.t, flags = t && (t.HideFlags | 0) || 0;
    var head = { text: cn !== null ? cn : H.displayName(NS.Items.nameOf(st.i), true), rgb: RARITY_RGB[H.rarityOf(st)] };
    if (cn !== null) head.italic = true;
    var lines = [head], keys = ['StoredEnchantments', 'Enchantments'];
    if (t && !(flags & 1)) {
      for (var k = 0; k < keys.length; k++) {
        var L = t[keys[k]];
        if (!L) continue;
        for (var i = 0; i < L.length; i++) lines.push(H.enchantmentLine(L[i].id, L[i].lvl | 0));
      }
    }
    if (t && t.display && t.display.color !== undefined && !(flags & 64))
      lines.push(NS.Settings && NS.Settings.advancedTooltips
        ? { text: tt('item.color', ['#' + ('000000' + (t.display.color >>> 0).toString(16).toUpperCase()).slice(-6)]), rgb: 0xAAAAAA }
        : { text: tt('item.dyed'), rgb: 0xAAAAAA, italic: true });
    if (t && t.BucketVariantTag !== undefined && NS.Items.nameOf(st.i) === 'tropical_fish_bucket') lines.push.apply(lines, fishBucketLines(t.BucketVariantTag | 0));
    var pn = NS.Items.nameOf(st.i);
    if (POTION_TIP_SCALE[pn] && NS.Potion && NS.Effects) lines.push.apply(lines, H.potionTooltipLines(st, POTION_TIP_SCALE[pn]));
    if (!(flags & 2)) lines.push.apply(lines, attrLines(st));
    if (t && t.Unbreakable && !(flags & 4)) lines.push({ text: tt('item.unbreakable'), rgb: 0x5555FF });
    if (NS.Settings && NS.Settings.advancedTooltips) lines.push.apply(lines, H.advancedTooltipLines(st));
    return lines;
  };

  /** `ItemStack.getTooltip` with `TooltipContext.Default.ADVANCED`: map id, durability, the id, the NBT count. */
  H.advancedTooltipLines = function (st) {
    var out = [], t = st.t, nm = NS.Items.nameOf(st.i), IT = NS.Items;
    if (nm === 'filled_map' && t && t.map !== undefined) out.push({ text: tt('filled_map.id', [String(t.map | 0)]), rgb: 0xAAAAAA });
    var dur = IT.durability ? IT.durability[st.i] : 0;
    if (dur && !(t && t.Unbreakable)) out.push({ text: tt('item.durability', [String(dur - (st.d | 0)), String(dur)]), rgb: 0xFFFFFF });
    out.push({ text: 'minecraft:' + nm, rgb: 0x555555 });
    if (t) out.push({ text: tt('item.nbt_tags', [String(Object.keys(t).length)]), rgb: 0x555555 });
    return out;
  };

  /** `Screen.renderTooltipFromComponents` geometry in GUI px: text origin, content size, per-line y. */
  H.tooltipLayout = function (widths, mx, my, sw, sh) {
    var n = widths.length, w = 0, h = n === 1 ? -2 : 0, i;
    for (i = 0; i < n; i++) { if (widths[i] > w) w = widths[i]; h += 10; }
    var x = mx + 12, y = my - 12;
    if (x + w > sw) x -= 28 + w;
    if (y + h + 6 > sh) y = sh - h - 6;
    var ys = [], yy = y;
    for (i = 0; i < n; i++) { ys.push(yy); yy += 10 + (i === 0 ? 2 : 0); }
    return { x: x, y: y, w: w, h: h, ys: ys };
  };

  /** A boxed tooltip of `lines` ([{text, rgb}]) beside the pointer, at GUI scale `s`. */
  H.drawLinesTooltip = function (c, lines, s) {
    var g = NS.Gui, In = NS.Input;
    if (!g || !In || !lines.length) return;
    var ws = [], i;
    for (i = 0; i < lines.length; i++) ws.push(g.textWidth(lines[i].text));
    var L = H.tooltipLayout(ws, In.mx / s, In.my / s, H.w / s, H.h / s);
    var x = L.x, y = L.y, w = L.w, h = L.h;
    var R = function (rx, ry, rw, rh) { c.fillRect(rx * s, ry * s, rw * s, rh * s); };
    c.fillStyle = 'rgba(16,0,16,0.94)';           // 0xF0100010
    R(x - 3, y - 4, w + 6, 1); R(x - 3, y + h + 3, w + 6, 1); R(x - 3, y - 3, w + 6, h + 6);
    R(x - 4, y - 3, 1, h + 6); R(x + w + 3, y - 3, 1, h + 6);
    var grad = c.createLinearGradient(0, (y - 2) * s, 0, (y + h + 2) * s);   // 0x505000FF -> 0x5028007F
    grad.addColorStop(0, 'rgba(80,0,255,0.314)'); grad.addColorStop(1, 'rgba(40,0,127,0.314)');
    c.fillStyle = grad;
    R(x - 3, y - 2, 1, h + 4); R(x + w + 2, y - 2, 1, h + 4);
    c.fillStyle = 'rgba(80,0,255,0.314)'; R(x - 3, y - 3, w + 6, 1);
    c.fillStyle = 'rgba(40,0,127,0.314)'; R(x - 3, y + h + 2, w + 6, 1);
    for (i = 0; i < lines.length; i++) g.text(c, lines[i].text, x * s, L.ys[i] * s, s, lines[i].rgb, true);
  };
  H.drawStackTooltip = function (c, st, s) { H.drawLinesTooltip(c, H.stackTooltipLines(st), s); };

  // --- the enchanting table (PLAN G22) -----------------------------------------------------

  /** `EnchantingTableBlock.use`: open the screen over the table at (x, y, z) with a fresh menu. */
  H.openEnchanting = function (x, y, z) {
    var M = NS.Menu, P = NS.Player, W = NS.World;
    if (!M || !P || !P.menu || !NS.EnchTable) return false;
    var S = NS.States;
    var ctx = { x: x, y: y, z: z, blockAt: function (bx, by, bz) {
      var st = W.getBlock(bx, by, bz);
      return st > 0 ? S.name(st) : 'air';
    } };
    H.enchantMenu = M.enchantMenu(ctx, P.menu.inventory, P);
    H.enchantPos = { x: x, y: y, z: z };
    H.enchantBook = { ticks: 0, nextPageAngle: 0, pageAngle: 0, approxAngle: 0, rotSpeed: 0, nextTurn: 0, turn: 0, stack: null,
      rnd: new NS.EnchTable.Random(Date.now() | 0) };
    H.open('enchanting');
    return true;
  };

  /** `EnchantmentScreen.doTick` — the book's page-turning state, one step per game tick. */
  H.enchantTick = function () {
    var b = H.enchantBook, m = H.enchantMenu;
    if (!b || !m) return;
    var st = m.table.get(0);
    if (st !== b.stack && !(st && b.stack && st.i === b.stack.i && st.n === b.stack.n)) {
      b.stack = st;
      do { b.approxAngle += b.rnd.nextInt(4) - b.rnd.nextInt(4); }
      while (b.nextPageAngle <= b.approxAngle + 1 && b.nextPageAngle >= b.approxAngle - 1);
    }
    b.ticks++;
    b.pageAngle = b.nextPageAngle;
    b.turn = b.nextTurn;
    var any = m.offers.power[0] || m.offers.power[1] || m.offers.power[2];
    b.nextTurn = Math.max(0, Math.min(1, b.nextTurn + (any ? 0.2 : -0.2)));
    var d = Math.max(-0.2, Math.min(0.2, (b.approxAngle - b.nextPageAngle) * 0.4));
    b.rotSpeed += (d - b.rotSpeed) * 0.9;
    b.nextPageAngle += b.rotSpeed;
  };

  /** `EnchantingPhrases.phrases`, in the decomp's order (the seeded draw indexes it). */
  H.ENCHANT_PHRASES = ['the', 'elder', 'scrolls', 'klaatu', 'berata', 'niktu', 'xyzzy', 'bless', 'curse', 'light',
      'darkness', 'fire', 'air', 'earth', 'water', 'hot', 'dry', 'cold', 'wet', 'ignite', 'snuff', 'embiggen', 'twist',
      'shorten', 'stretch', 'fiddle', 'destroy', 'imbue', 'galvanize', 'enchant', 'free', 'limited', 'range', 'of',
      'towards', 'inside', 'sphere', 'cube', 'self', 'other', 'ball', 'mental', 'physical', 'grow', 'shrink', 'demon',
      'elemental', 'spirit', 'animal', 'creature', 'beast', 'humanoid', 'undead', 'fresh', 'stale', 'phnglui',
      'mglwnafh', 'cthulhu', 'rlyeh', 'wgahnagl', 'fhtagn', 'baguette'];

  H.drawEnchanting = function (c) {
    var g = NS.Gui, M = NS.Menu, m = H.enchantMenu, ET = NS.EnchTable;
    if (!g || !g.ready || !M || !m) { H.drawInventoryFallback(c); return; }
    var V = g.ENCHANT, s = Math.max(2, H.scale), P = NS.Player;
    var ox = Math.round((H.w - V.w * s) * 0.5);
    var oy = Math.round((H.h - V.h * s) * 0.5);
    H.enchantOrigin = { x: ox, y: oy, s: s };

    g.dim(c, H.w, H.h);
    g.blit(c, 'enchanting_table', [0, 0, V.w, V.h], ox, oy, s);
    H.enchantTick();

    // the book: `EnchantmentScreen.drawBackground` renders a 3D BookModel; the page-turn state above is
    // vanilla's but the picture is a flat open book from the sheet's own margin — see `Ench.OWED`.
    var In = NS.Input, mxg = In ? (In.mx - ox) / s : -1, myg = In ? (In.my - oy) / s : -1;
    var B = V.button, creative = !!(P && P.instabuild), lvl = P ? (P.xpLevel | 0) : 0;
    var lapis = M.enchantLapis(m), rnd = new ET.Random(m.seed | 0);
    var phrases = H.ENCHANT_PHRASES;
    for (var i = 0; i < 3; i++) {
      var bx = ox + B.x * s, by = oy + (B.y + B.pitch * i) * s;
      var pow = m.offers.power[i];
      if (pow === 0) { g.blit(c, 'enchanting_table', [B.disabled[0], B.disabled[1], B.w, B.h], bx, by, s); continue; }
      var num = String(pow), avail = 86 - g.textWidth(num);
      // `EnchantingPhrases.generatePhrase`: 3-4 words off the SEEDED generator, trimmed to `avail` texels
      var words = [], nw = rnd.nextInt(2) + 3, w;
      for (w = 0; w < nw; w++) words.push(phrases[rnd.nextInt(phrases.length)]);
      var phrase = words.join(' '), cut = phrase.length;
      while (cut > 0 && g.textWidthSga(phrase.slice(0, cut)) > avail) cut--;
      phrase = phrase.slice(0, cut);
      var ic = V.icon, tcol = 6839882, numCol;
      if ((lapis < i + 1 || lvl < pow) && !creative) {
        g.blit(c, 'enchanting_table', [B.disabled[0], B.disabled[1], B.w, B.h], bx, by, s);
        g.blit(c, 'enchanting_table', [ic.off[0] + 16 * i, ic.off[1], 16, 16], bx + s, by + s, s);
        g.textSga(c, phrase, bx + 20 * s, oy + (16 + 19 * i) * s, s, (tcol & 16711422) >> 1);
        numCol = 4226832;
      } else {
        var over = mxg - B.x >= 0 && myg - (B.y + B.pitch * i) >= 0 && mxg - B.x < B.w && myg - (B.y + B.pitch * i) < B.h;
        g.blit(c, 'enchanting_table', [(over ? B.hover : B.enabled)[0], (over ? B.hover : B.enabled)[1], B.w, B.h], bx, by, s);
        g.blit(c, 'enchanting_table', [ic.on[0] + 16 * i, ic.on[1], 16, 16], bx + s, by + s, s);
        g.textSga(c, phrase, bx + 20 * s, oy + (16 + 19 * i) * s, s, over ? 16777088 : tcol);
        numCol = 8453920;
      }
      g.text(c, num, bx + (20 + 86 - g.textWidth(num)) * s, oy + (16 + 19 * i + 7) * s, s, numCol, true);
    }

    g.text(c, (NS.Text && NS.Text.ready) ? NS.Text.translate('container.enchant') : 'Enchant', ox + V.title.x * s, oy + V.title.y * s, s, 0x404040, false);
    g.text(c, 'Inventory', ox + V.inventoryLabel.x * s, oy + V.inventoryLabel.y * s, s, 0x404040, false);

    var hover = In ? g.enchantSlotAt(mxg, myg) : -1;
    for (var k = 0; k < 38; k++) {
      var p = g.enchantSlotXY(k);
      var sx = ox + p[0] * s, sy = oy + p[1] * s;
      if (k === hover) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(sx, sy, 16 * s, 16 * s); }
      var st = M.slotGet(m.slots[k]);
      if (st) H.drawItem(c, st, sx, sy, 16 * s);
    }

    var carried = M.getCarried(m);
    if (carried && In) H.drawItem(c, carried, In.mx - 8 * s, In.my - 8 * s, 16 * s);
    if (hover >= 0 && !carried) {
      var hs = M.slotGet(m.slots[hover]);
      if (hs && !NS.Inventory.isEmpty(hs)) H.drawStackTooltip(c, hs, s);
    } else if (!carried) {
      var lines = H.enchantButtonTooltip(m, g.enchantButtonAt(mxg, myg), lvl, creative);
      if (lines) H.drawLinesTooltip(c, lines, s);
    }
  };

  /** `EnchantmentScreen.render`'s tooltip: the clue, and (outside creative) what the click costs. */
  H.enchantButtonTooltip = function (m, i, lvl, creative) {
    if (i < 0) return null;
    var pow = m.offers.power[i], id = m.offers.id[i], el = m.offers.level[i];
    if (!(pow > 0 && el >= 0 && id)) return null;
    var Tx = NS.Text, tr = function (k, a) { return (Tx && Tx.ready) ? Tx.translate(k, a) : k; };
    var ln = H.enchantmentLine(id, el).text, need = i + 1, lapis = NS.Menu.enchantLapis(m);
    var lines = [{ text: tr('container.enchant.clue', [ln]), rgb: 0xFFFFFF }];
    if (!creative) {
      lines.push({ text: '', rgb: 0xFFFFFF });
      if (lvl < pow) lines.push({ text: tr('container.enchant.level.requirement', [pow]), rgb: 0xFF5555 });
      else {
        lines.push({ text: need === 1 ? tr('container.enchant.lapis.one') : tr('container.enchant.lapis.many', [need]),
          rgb: lapis >= need ? 0xAAAAAA : 0xFF5555 });
        lines.push({ text: need === 1 ? tr('container.enchant.level.one') : tr('container.enchant.level.many', [need]), rgb: 0xAAAAAA });
      }
    }
    return lines;
  };

  /** A click inside the enchanting screen: a button first (`EnchantmentScreen.mouseClicked`), else a slot. */
  H.enchantClick = function (mx, my, button, shift) {
    var M = NS.Menu, m = H.enchantMenu, P = NS.Player;
    if (!M || !m) return false;
    var o = H.enchantOrigin, g = NS.Gui;
    var px = o ? (mx - o.x) / o.s : -1, py = o ? (my - o.y) / o.s : -1;
    var bi = (o && mx >= 0) ? g.enchantButtonAt(px, py) : -1;
    if (bi >= 0 && M.enchantClick(m, P, bi)) { if (P && P.syncHotbar) P.syncHotbar(); return true; }
    var slot = (o && mx >= 0) ? g.enchantSlotAt(px, py) : -1;
    var b = button === 2 ? 1 : 0;
    if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);
    else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);
    else M.doClick(m, slot, b, M.PICKUP, P);
    if (P && P.syncHotbar) P.syncHotbar();
    return true;
  };

  // --- the hopper (PASS 17 JOB 1, G19b, D-419) --------------------------------

  /**
   * Open the hopper at (x, y, z). ⚠ THE SCREEN IS A WINDOW ON THE BLOCK ENTITY, NOT A COPY, the
   * same as the furnace's: `Menu.hopperMenu` reads `be.items` straight off the entity, so a
   * hopper that keeps pulling and pushing under an open screen moves items in front of you.
   */
  H.openHopper = function (x, y, z) {
    var BE = NS.BlockEntities, M = NS.Menu, P = NS.Player;
    if (!BE || !M || !P || !P.menu) return false;
    var be = BE.get(x, y, z);
    if (!be || be.type !== 'hopper') return false;
    H.hopperMenu = M.hopperMenu(be, P.menu.inventory);
    H.hopperPos = { x: x, y: y, z: z }; H.hopperTitleText = null;
    H.open('hopper');
    return true;
  };

  H.drawHopper = function (c) {
    var g = NS.Gui, M = NS.Menu, m = H.hopperMenu;
    if (!g || !g.ready || !M || !m) { H.drawInventoryFallback(c); return; }
    var V = g.HOPPER, s = Math.max(2, H.scale);
    var ox = Math.round((H.w - V.w * s) * 0.5);
    var oy = Math.round((H.h - V.h * s) * 0.5);
    H.hopperOrigin = { x: ox, y: oy, s: s };

    g.dim(c, H.w, H.h);
    g.blit(c, 'hopper', [0, 0, V.w, V.h], ox, oy, s);

    // ⚠ LEFT-ALIGNED, not centred — see `G.HOPPER`'s own note. `HopperScreen` overrides nothing,
    // so both labels sit at `AbstractContainerScreen`'s own defaults.
    var title = H.hopperTitleText || H.displayName('hopper', false);
    g.text(c, title, ox + V.title.x * s, oy + V.title.y * s, s, 0x404040, false);
    g.text(c, 'Inventory', ox + V.inventoryLabel.x * s, oy + V.inventoryLabel.y * s, s, 0x404040, false);

    var hover = NS.Input ? g.hopperSlotAt((NS.Input.mx - ox) / s, (NS.Input.my - oy) / s) : -1;
    for (var i = 0; i < g.HOPPER_SLOTS; i++) {
      var p = g.hopperSlotXY(i);
      var sx = ox + p[0] * s, sy = oy + p[1] * s;
      if (i === hover) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(sx, sy, 16 * s, 16 * s); }
      var st = M.slotGet(m.slots[i]);
      if (st) H.drawItem(c, st, sx, sy, 16 * s);
    }

    var carried = M.getCarried(m);
    if (carried && NS.Input) H.drawItem(c, carried, NS.Input.mx - 8 * s, NS.Input.my - 8 * s, 16 * s);
    if (hover >= 0 && !carried) {
      var hs = M.slotGet(m.slots[hover]);
      if (hs && !NS.Inventory.isEmpty(hs)) {
        H.drawStackTooltip(c, hs, s);
      }
    }
  };

  /** A click inside the hopper screen. Same `ClickType` shape as `H.chestClick`. */
  H.hopperClick = function (mx, my, button, shift) {
    var M = NS.Menu, m = H.hopperMenu, P = NS.Player;
    if (!M || !m) return false;
    var o = H.hopperOrigin;
    var slot = (o && mx >= 0) ? NS.Gui.hopperSlotAt((mx - o.x) / o.s, (my - o.y) / o.s) : -1;
    var b = button === 2 ? 1 : 0;
    if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);
    else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);
    else M.doClick(m, slot, b, M.PICKUP, P);
    if (P && P.syncHotbar) P.syncHotbar();
    return true;
  };

  // --- the anvil (G22d) ---------------------------------------------------------

  /**
   * Open the anvil (any of the three damage states) at (x, y, z) over a fresh `Menu.anvilMenu`.
   * The two inputs live only in the menu, so `H.close` hands them back like the crafting grid.
   * `ctx.onBlock` applies `AnvilScreenHandler.onTakeOutput`'s 12% chip: anvil -> chipped ->
   * damaged -> gone, keeping `facing` (all three share one state layout), with its sound.
   */
  H.openAnvil = function (x, y, z) {
    var M = NS.Menu, P = NS.Player, S = NS.States, W = NS.World, R = NS.Reg;
    if (!M || !P || !P.menu || !W || !S || !S.ready) return false;
    var state = W.getBlock(x, y, z);
    if (!(state > 0) || !/^(chipped_|damaged_)?anvil$/.test(S.name(state))) return false;
    H.anvilPos = { x: x, y: y, z: z };
    H.anvilMenu = M.anvilMenu(P.menu.inventory, P, {
      blockName: function () { var st = W.getBlock(x, y, z); return st > 0 ? S.name(st) : ''; },
      onBlock: function (b) {
        var snd = b.sound === 1029 ? 'block.anvil.destroy' : 'block.anvil.use';
        if (b.to !== undefined) {
          var cur = W.getBlock(x, y, z), ns = 0;
          if (b.to !== null) {
            var local = cur - R.realFirst[S.block[cur]];
            ns = R.real(R.names.indexOf(b.to), local);
          }
          W.setBlock(x, y, z, ns);
        }
        if (NS.Sound && NS.Sound.play) NS.Sound.play(snd, { x: x + 0.5, y: y + 0.5, z: z + 0.5, source: 'block' });
        if (b.to === null) H.close();
      }
    });
    H.anvilMenu.update();
    H.open('anvil');
    return true;
  };

  H.drawAnvil = function (c) {
    var g = NS.Gui, M = NS.Menu, m = H.anvilMenu, P = NS.Player;
    if (!g || !g.ready || !M || !m) { H.drawInventoryFallback(c); return; }
    var V = g.ANVIL, s = Math.max(2, H.scale);
    var ox = Math.round((H.w - V.w * s) * 0.5);
    var oy = Math.round((H.h - V.h * s) * 0.5);
    H.anvilOrigin = { x: ox, y: oy, s: s };

    g.dim(c, H.w, H.h);
    g.blit(c, 'anvil', [0, 0, V.w, V.h], ox, oy, s);
    var F = V.field, empty0 = !M.slotHas(m.slots[0]);
    // `AnvilScreen.drawBackground`: the field plate (bright when editable, dark when not), and
    // the red cross while there are inputs but no output.
    g.blit(c, 'anvil', [0, V.h + (empty0 ? 16 : 0), 110, 16], ox + 59 * s, oy + 20 * s, s);
    if ((M.slotHas(m.slots[0]) || M.slotHas(m.slots[1])) && !M.slotHas(m.slots[2])) {
      g.blit(c, 'anvil', [176, 0, 28, 21], ox + 99 * s, oy + 45 * s, s);
    }
    g.text(c, 'Repair & Name', ox + V.title.x * s, oy + V.title.y * s, s, 0x404040, false);
    g.text(c, 'Inventory', ox + V.inventoryLabel.x * s, oy + V.inventoryLabel.y * s, s, 0x404040, false);
    if (!empty0) {
      var caret = ((Date.now() / 500) | 0) % 2 === 0 ? '_' : '';
      g.text(c, m.name + caret, ox + (F[0] + 2) * s, oy + (F[1] + 2) * s, s, 0xFFFFFF, true);
    }

    var hover = NS.Input ? g.anvilSlotAt((NS.Input.mx - ox) / s, (NS.Input.my - oy) / s) : -1;
    for (var i = 0; i < g.ANVIL_SLOTS; i++) {
      var p = g.anvilSlotXY(i);
      var sx = ox + p[0] * s, sy = oy + p[1] * s;
      if (i === hover) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(sx, sy, 16 * s, 16 * s); }
      var st = M.slotGet(m.slots[i]);
      if (st) H.drawItem(c, st, sx, sy, 16 * s);
    }

    // `AnvilScreen.drawForeground`: "Enchantment Cost: N" (green, red if unaffordable) or "Too Expensive!".
    var r = m.r, cost = r ? r.cost : 0, creative = !!(P && P.instabuild);
    if (cost > 0) {
      var text = null, col = 0x80FF20;
      if (cost >= 40 && !creative) { text = 'Too Expensive!'; col = 0xFF6060; }
      else if (M.slotHas(m.slots[2])) {
        text = 'Enchantment Cost: ' + cost;
        if (!M.slotMayPickup(m.slots[2], P)) col = 0xFF6060;
      }
      if (text) {
        var tw = g.textWidth(text);
        var tx = V.w - 8 - tw - 2;
        c.fillStyle = 'rgba(0,0,0,0.31)';
        c.fillRect(ox + (tx - 2) * s, oy + 67 * s, (V.w - 8 - tx + 2) * s, 12 * s);
        g.text(c, text, ox + tx * s, oy + 69 * s, s, col, true);
      }
    }

    var carried = M.getCarried(m);
    if (carried && NS.Input) H.drawItem(c, carried, NS.Input.mx - 8 * s, NS.Input.my - 8 * s, 16 * s);
    if (hover >= 0 && !carried) {
      var hs = M.slotGet(m.slots[hover]);
      if (hs && !NS.Inventory.isEmpty(hs)) {
        var label = (NS.Anvil && NS.Anvil.nameOf(hs)) || H.displayName(NS.Items.nameOf(hs.i), true);
        var lw = g.textWidth(label) * s;
        var lx = Math.min(H.w - lw - 4, NS.Input.mx + 10), ly = NS.Input.my - 12 * s;
        c.fillStyle = 'rgba(16,0,16,0.94)';
        c.fillRect(lx - 3 * s, ly - 3 * s, lw + 6 * s, 14 * s);
        g.text(c, label, lx, ly, s, 0xFFFFFF, true);
      }
    }
  };

  /** A click inside the anvil screen. Same `ClickType` shape as `H.chestClick`. */
  H.anvilClick = function (mx, my, button, shift) {
    var M = NS.Menu, m = H.anvilMenu, P = NS.Player;
    if (!M || !m) return false;
    var o = H.anvilOrigin;
    var slot = (o && mx >= 0) ? NS.Gui.anvilSlotAt((mx - o.x) / o.s, (my - o.y) / o.s) : -1;
    var b = button === 2 ? 1 : 0;
    if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);
    else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);
    else M.doClick(m, slot, b, M.PICKUP, P);
    if (m === H.anvilMenu) m.update();
    if (P && P.syncHotbar) P.syncHotbar();
    return true;
  };

  /** Typing in the anvil's name field (`AnvilScreen.nameField`, 50 chars). True when consumed. */
  H.anvilKey = function (code, key) {
    var m = H.anvilMenu;
    if (H.screen !== 'anvil' || !m || !NS.Menu.slotHas(m.slots[0])) return false;
    if (code === 'Backspace') m.name = m.name.slice(0, -1);
    else if (key && key.length === 1 && m.name.length < 50) m.name += key;
    else return false;
    m.update();
    return true;
  };

  /** Open the command block screen over a block cell {x,y,z} or a cart {cart: entity}; false if not allowed / not a command block. */
  H.openCommandBlock = function (t) {
    var C = NS.CmdScreen;
    if (!C || !C.canOpen(NS.Player)) return false;
    var s = C.open(t);
    if (!s) return false;
    H.cmdScreen = s;
    H.open('command');
    return true;
  };

  /** `AbstractCommandBlockScreen.render` / `CommandBlockScreen`: field, previous output, O/X toggle, the three mode buttons, Done/Cancel. */
  H.drawCommandBlock = function (c) {
    var s = H.cmdScreen, C = NS.CmdScreen;
    if (!s) return;
    var cx = H.w >> 1, f = 14, y0 = Math.max(10, (H.h - 230) >> 1);
    var cart = s.cart, ty = y0 + (cart ? 150 : 135);
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, 0, H.w, H.h);
    c.textAlign = 'center'; c.fillStyle = '#fff'; c.font = f + 'px ' + UIFONT;
    c.fillText('Set Console Command for Block', cx, y0 + 20);
    c.textAlign = 'left'; c.fillStyle = '#a0a0a0';
    c.fillText('Console Command', cx - 150, y0 + 40);
    c.fillStyle = '#000'; c.fillRect(cx - 150, y0 + 50, 300, 20);
    c.strokeStyle = '#fff'; c.strokeRect(cx - 149.5, y0 + 50.5, 299, 19);
    c.fillStyle = '#e0e0e0';
    var shown = s.cmd, caret = ((Date.now() / 500) | 0) % 2 === 0 ? '_' : '';
    while (shown.length > 1 && c.measureText(shown + caret).width > 290) shown = shown.slice(1);
    c.fillText(shown + caret, cx - 145, y0 + 65);
    var gh = C.ghost(s);
    if (gh) { c.fillStyle = '#808080'; c.fillText(gh, cx - 145 + c.measureText(shown).width, y0 + 65); }
    var rows = C.suggestRows(s);
    if (rows.length) {                                   // CommandSuggestor.SuggestionWindow, under the field
      var sw = 0, ry = y0 + 71, i;
      for (i = 0; i < rows.length; i++) sw = Math.max(sw, c.measureText(rows[i]).width);
      sw += 4;
      c.fillStyle = 'rgba(0,0,0,0.82)'; c.fillRect(cx - 150, ry, sw, rows.length * 12);
      for (i = 0; i < rows.length; i++) {
        var sel = s.sug.scroll + i === s.sug.sel;
        c.fillStyle = sel ? '#ffff00' : '#aaaaaa';
        c.fillText(rows[i], cx - 148, ry + 10 + i * 12);
      }
    }
    var prev = C.previousOutput(s);
    if (prev) {
      c.fillStyle = '#a0a0a0'; c.fillText('Previous Output', cx - 150, ty - 10 + 4);
      c.fillStyle = '#000'; c.fillRect(cx - 150, ty, 276, 20);
      c.fillStyle = '#e0e0e0'; c.fillText(prev.slice(0, 40), cx - 145, ty + 15);
    }
    button(c, cx + 130, ty, 20, 20, s.track ? 'O' : 'X', function () { s.track = !s.track; }, s.track, 12);
    if (!cart) {
      button(c, cx - 154, y0 + 165, 100, 20, C.MODE_TEXT[s.mode], function () { C.cycleMode(s); }, false, 12);
      button(c, cx - 50, y0 + 165, 100, 20, s.cond ? 'Conditional' : 'Unconditional', function () { s.cond = !s.cond; }, false, 12);
      button(c, cx + 54, y0 + 165, 100, 20, s.auto ? 'Always Active' : 'Needs Redstone', function () { s.auto = !s.auto; }, false, 12);
    }
    button(c, cx - 154, y0 + 132, 150, 20, 'Done', function () { H.commandDone(); }, false, 12);
    button(c, cx + 4, y0 + 132, 150, 20, 'Cancel', function () { H.close(); }, false, 12);
  };

  /** commitAndClose */
  H.commandDone = function () { if (H.cmdScreen) NS.CmdScreen.commit(H.cmdScreen); H.close(); };

  /** Typing in the console field; Enter commits (`keyPressed` 257/335). True when consumed. */
  H.commandKey = function (code, key) {
    var s = H.cmdScreen, C = NS.CmdScreen;
    if (H.screen !== 'command' || !s) return false;
    if (code === 'Tab') C.suggestAccept(s);
    else if (code === 'ArrowUp' || code === 'ArrowDown') { if (!C.suggestMove(s, code === 'ArrowUp' ? -1 : 1)) return false; }
    else if ((code === 'Enter' || code === 'NumpadEnter') && s.sug && C.suggestAccept(s)) return true;
    else if (code === 'Enter' || code === 'NumpadEnter') H.commandDone();
    else if (code === 'Backspace') C.backspace(s);
    else if (key && key.length === 1) C.type(s, key);
    else return false;
    return true;
  };

  // --- BookEditScreen (#8066) ---------------------------------------------------

  H.openBook = function (scr, P) { H.bookScr = scr; H.bookPlayer = P; H.open('book'); return true; };

  /** BookEditScreen.render: the page, "Edit Book Title"/"Enter Book Title:" when signing, page counter, buttons at y 196. */
  H.drawBook = function (c) {
    var s = H.bookScr, B = NS.Use.Book;
    if (!s) return;
    var cx = H.w >> 1, f = 14, x0 = cx - 96, y0 = Math.max(2, (H.h - 230) >> 1);
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, 0, H.w, H.h);
    c.fillStyle = '#f4ecd0'; c.fillRect(x0, y0, 192, 192);
    c.strokeStyle = '#6b4b2a'; c.strokeRect(x0 + 0.5, y0 + 0.5, 191, 191);
    c.font = f + 'px ' + UIFONT; c.textAlign = 'left'; c.fillStyle = '#000';
    var caret = ((Date.now() / 500) | 0) % 2 === 0 ? '_' : '';
    if (s.signing) {
      c.fillStyle = '#000'; c.fillText('Enter Book Title:', x0 + 36, y0 + 50);
      c.fillText(s.title + caret, x0 + 36, y0 + 70);
      c.fillStyle = '#808080'; c.fillText('Note: Once signed, the book can no longer be edited.', x0 + 36, y0 + 110, 120);
    } else {
      c.fillText('Page ' + (s.page + 1) + ' of ' + s.pages.length, x0 + 40, y0 + 20);
      var lines = (s.pages[s.page] || '').split('\n'), ly = y0 + 40, i;
      for (i = 0; i < lines.length; i++) {
        var t = lines[i], w = 114;
        while (t.length) {                               // wrap at 114px like TextHandler.wrapLines
          var n = t.length; while (n > 1 && c.measureText(t.slice(0, n)).width > w) n--;
          c.fillText(t.slice(0, n), x0 + 36, ly); ly += 9; t = t.slice(n);
        }
        if (!lines[i].length) ly += 9;
      }
      c.fillText(caret, x0 + 36, ly);
    }
    var by = y0 + 196;
    if (s.signing) {
      var ok = String(s.title).trim().length > 0;
      button(c, cx - 100, by, 98, 20, 'Sign and Close', function () { if (ok) H.bookFinish(true); }, false, 12);
      button(c, cx + 2, by, 98, 20, 'Cancel', function () { s.signing = false; }, false, 12);
    } else {
      button(c, cx - 100, by, 98, 20, 'Sign', function () { s.signing = true; }, false, 12);
      button(c, cx + 2, by, 98, 20, 'Done', function () { H.bookFinish(false); }, false, 12);
      if (s.page > 0) button(c, x0 + 43, y0 + 159, 20, 20, '<', function () { s.page--; }, false, 12);
      button(c, x0 + 116, y0 + 159, 20, 20, '>', function () { B.nextPage(s); }, false, 12);
    }
  };

  // --- BookScreen / LecternScreen (#187): reading a signed book, or the book on a lectern ---------------

  /** A written page is a JSON text component; plain strings (writable books) pass through. */
  H.bookPageText = function (raw) {
    if (typeof raw !== 'string') return '';
    var j; try { j = JSON.parse(raw); } catch (e) { return raw; }
    var out = function (n) {
      if (typeof n === 'string') return n;
      if (Array.isArray(n)) return n.map(out).join('');
      if (n && typeof n === 'object') return (n.text || '') + (n.extra ? out(n.extra) : '');
      return n == null ? '' : String(n);
    };
    return out(j);
  };
  /** `r` is a Book.open / Book.openLectern state; a lectern one also has x/y/z and `button`. */
  H.openBookRead = function (r) { if (!r) return false; H.bookRead = r; H.open('bookread'); return true; };
  H.drawBookRead = function (c) {
    var r = H.bookRead, B = NS.Book;
    if (!r) return;
    var cx = H.w >> 1, f = 14, x0 = cx - 96, y0 = Math.max(2, (H.h - 230) >> 1);
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, 0, H.w, H.h);
    c.fillStyle = '#f4ecd0'; c.fillRect(x0, y0, 192, 192);
    c.strokeStyle = '#6b4b2a'; c.strokeRect(x0 + 0.5, y0 + 0.5, 191, 191);
    c.font = f + 'px ' + UIFONT; c.textAlign = 'left'; c.fillStyle = '#000';
    c.fillText(B.indicator(r), x0 + 40, y0 + 20);
    var lines = B.wrap(H.bookPageText(r.stack.t.pages[r.page]), B.TEXT_WIDTH, function (t) { return c.measureText(t).width; });
    for (var i = 0; i < lines.length && i < B.MAX_LINES; i++) c.fillText(lines[i], x0 + 36, y0 + 40 + i * 9);
    var turn = function (d) { if (r.button) { var p = r.page; r.button(d > 0 ? 2 : 1); if (r.page !== p) r.sounds.push(B.PAGE_TURN_SOUND); } else B.turn(r, d); };
    if (B.backVisible(r)) button(c, x0 + 43, y0 + 159, 20, 20, '<', function () { turn(-1); }, false, 12);
    if (B.nextVisible(r)) button(c, x0 + 116, y0 + 159, 20, 20, '>', function () { turn(1); }, false, 12);
    var by = y0 + 196;
    if (r.button) {
      button(c, cx - 100, by, 98, 20, 'Done', function () { H.close(); }, false, 12);
      button(c, cx + 2, by, 98, 20, 'Take Book', function () { NS.Use.lecternButton(r.x, r.y, r.z, H.bookPlayer || NS.Player, 3); H.close(); }, false, 12);
    } else button(c, cx - 100, by, 200, 20, 'Done', function () { H.close(); }, false, 12);
  };
  if (NS.Use) {
    NS.Use.onBookScreen = function (r) { H.openBookRead(r); };
    NS.Use.onLecternScreen = function (x, y, z, P) { H.bookPlayer = P; H.openBookRead(NS.Book.openLectern(x, y, z)); };
  }

  H.bookFinish = function (sign) {
    var s = H.bookScr;
    if (s) NS.Use.Book.finish(H.bookPlayer || NS.Player, s, sign);
    H.close();
  };

  /** Typing into the page/title; Enter in sign mode signs (`keyPressedSignMode`). True when consumed. */
  H.bookKey = function (code, key) {
    var s = H.bookScr, B = NS.Use.Book;
    if (H.screen !== 'book' || !s) return false;
    if (s.signing && (code === 'Enter' || code === 'NumpadEnter')) { if (s.title.length) H.bookFinish(true); }
    else if (code === 'Backspace') B.backspace(s);
    else if (!s.signing && (code === 'Enter' || code === 'NumpadEnter')) B.input(s, '\n');
    else if (key && key.length === 1) B.input(s, key);
    else return false;
    return true;
  };

  // --- the brewing stand (PASS 17 JOB 1, G19b) -------------------------------

  /**
   * Open the brewing stand at (x, y, z). ⚠ A WINDOW ON THE BLOCK ENTITY, NOT A COPY: the five slots
   * are `be.items` and the gauge and arrow are read off `be.brewTime` / `be.fuel`.
   */
  H.openBrewing = function (x, y, z) {
    var BE = NS.BlockEntities, M = NS.Menu, P = NS.Player;
    if (!BE || !M || !P || !P.menu) return false;
    var be = BE.get(x, y, z);
    if (!be || be.type !== 'brewing_stand') return false;
    H.brewingMenu = M.brewingMenu(be, P.menu.inventory);
    H.brewingPos = { x: x, y: y, z: z };
    H.open('brewing');
    return true;
  };

  H.drawBrewing = function (c) {
    var g = NS.Gui, M = NS.Menu, m = H.brewingMenu;
    if (!g || !g.ready || !M || !m) { H.drawInventoryFallback(c); return; }
    var V = g.BREWING, s = Math.max(2, H.scale), be = m.be;
    var ox = Math.round((H.w - V.w * s) * 0.5);
    var oy = Math.round((H.h - V.h * s) * 0.5);
    H.brewingOrigin = { x: ox, y: oy, s: s };

    g.dim(c, H.w, H.h);
    g.blit(c, 'brewing_stand', [0, 0, V.w, V.h], ox, oy, s);

    // `BrewingStandScreen.drawBackground`: the fuel gauge, then (only while brewing) the arrow
    // growing downward and the bubbles rising.
    var fw = M.brewingFuelWidth(be), F = V.fuelBar;
    if (fw > 0) g.blit(c, 'brewing_stand', [F.sx, F.sy, fw, F.h], ox + F.x * s, oy + F.y * s, s);
    var ah = M.brewingArrowHeight(be), A = V.arrow;
    if (ah > 0) g.blit(c, 'brewing_stand', [A.sx, A.sy, A.w, ah], ox + A.x * s, oy + A.y * s, s);
    var bh = M.brewingBubbleHeight(be), Bb = V.bubbles;
    if (bh > 0) g.blit(c, 'brewing_stand', [Bb.sx, Bb.max - bh, Bb.w, bh],
                       ox + Bb.x * s, oy + (Bb.y + Bb.max - bh) * s, s);

    var title = H.displayName('brewing_stand', false);
    g.text(c, title, ox + Math.round((V.w - g.textWidth(title)) / 2) * s, oy + V.title.y * s, s, 0x404040, false);
    g.text(c, 'Inventory', ox + V.inventoryLabel.x * s, oy + V.inventoryLabel.y * s, s, 0x404040, false);

    var hover = NS.Input ? g.brewingSlotAt((NS.Input.mx - ox) / s, (NS.Input.my - oy) / s) : -1;
    for (var i = 0; i < g.BREWING_SLOTS; i++) {
      var p = g.brewingSlotXY(i);
      var sx = ox + p[0] * s, sy = oy + p[1] * s;
      if (i === hover) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(sx, sy, 16 * s, 16 * s); }
      var st = M.slotGet(m.slots[i]);
      if (st) H.drawItem(c, st, sx, sy, 16 * s);
    }

    var carried = M.getCarried(m);
    if (carried && NS.Input) H.drawItem(c, carried, NS.Input.mx - 8 * s, NS.Input.my - 8 * s, 16 * s);
    if (hover >= 0 && !carried) {
      var hs = M.slotGet(m.slots[hover]);
      if (hs && !NS.Inventory.isEmpty(hs)) {
        H.drawStackTooltip(c, hs, s);
      }
    }
  };

  /** A click inside the brewing-stand screen. Same `ClickType` shape as `H.chestClick`. */
  H.brewingClick = function (mx, my, button, shift) {
    var M = NS.Menu, m = H.brewingMenu, P = NS.Player;
    if (!M || !m) return false;
    var o = H.brewingOrigin;
    var slot = (o && mx >= 0) ? NS.Gui.brewingSlotAt((mx - o.x) / o.s, (my - o.y) / o.s) : -1;
    var b = button === 2 ? 1 : 0;
    if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);
    else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);
    else M.doClick(m, slot, b, M.PICKUP, P);
    if (P && P.syncHotbar) P.syncHotbar();
    return true;
  };

  // --- the grindstone (G22e, #197) ---------------------------------------------------------

  /** Open the grindstone at (x, y, z); a FRESH menu each time, as vanilla's `GrindstoneBlock.createScreenHandlerFactory`. */
  H.openGrindstone = function (x, y, z) {
    var M = NS.Menu, P = NS.Player;
    if (!M || !M.grindMenu || !P || !P.menu) return false;
    H.grindMenu = M.grindMenu(P.menu.inventory, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    H.open('grindstone');
    return true;
  };

  H.drawGrindstone = function (c) {
    var g = NS.Gui, M = NS.Menu, m = H.grindMenu;
    if (!g || !g.ready || !M || !m) { H.drawInventoryFallback(c); return; }
    m.refresh();
    var V = g.GRINDSTONE, s = Math.max(2, H.scale);
    var ox = Math.round((H.w - V.w * s) * 0.5);
    var oy = Math.round((H.h - V.h * s) * 0.5);
    H.grindOrigin = { x: ox, y: oy, s: s };

    g.dim(c, H.w, H.h);
    g.blit(c, 'grindstone', [0, 0, V.w, V.h], ox, oy, s);
    // `GrindstoneScreen.drawBackground`: the red X while an input is set and there is no result.
    if ((M.slotHas(m.slots[0]) || M.slotHas(m.slots[1])) && !M.slotHas(m.slots[2])) {
      g.blit(c, 'grindstone', [V.w, 0, 28, 21], ox + 92 * s, oy + 31 * s, s);
    }
    g.text(c, 'Repair & Disenchant', ox + 8 * s, oy + 6 * s, s, 0x404040, false);
    g.text(c, 'Inventory', ox + 8 * s, oy + 72 * s, s, 0x404040, false);

    var hover = NS.Input ? g.grindstoneSlotAt((NS.Input.mx - ox) / s, (NS.Input.my - oy) / s) : -1;
    for (var i = 0; i < g.GRINDSTONE_SLOTS; i++) {
      var p = g.grindstoneSlotXY(i);
      var sx = ox + p[0] * s, sy = oy + p[1] * s;
      if (i === hover) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(sx, sy, 16 * s, 16 * s); }
      var st = M.slotGet(m.slots[i]);
      if (st) H.drawItem(c, st, sx, sy, 16 * s);
    }
    var carried = M.getCarried(m);
    if (carried && NS.Input) H.drawItem(c, carried, NS.Input.mx - 8 * s, NS.Input.my - 8 * s, 16 * s);
    if (hover >= 0 && !carried) {
      var hs = M.slotGet(m.slots[hover]);
      if (hs && !NS.Inventory.isEmpty(hs)) {
        var label = H.displayName(NS.Items.nameOf(hs.i), true);
        var tw = g.textWidth(label) * s;
        var tx = Math.min(H.w - tw - 4, NS.Input.mx + 10), ty = NS.Input.my - 12 * s;
        c.fillStyle = 'rgba(16,0,16,0.94)';
        c.fillRect(tx - 3 * s, ty - 3 * s, tw + 6 * s, 14 * s);
        g.text(c, label, tx, ty, s, 0xFFFFFF, true);
      }
    }
  };

  /** A click inside the grindstone screen. Same `ClickType` shape as `H.brewingClick`. */
  H.grindstoneClick = function (mx, my, button, shift) {
    var M = NS.Menu, m = H.grindMenu, P = NS.Player;
    if (!M || !m) return false;
    m.refresh();
    var o = H.grindOrigin;
    var slot = (o && mx >= 0) ? NS.Gui.grindstoneSlotAt((mx - o.x) / o.s, (my - o.y) / o.s) : -1;
    var b = button === 2 ? 1 : 0;
    if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);
    else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);
    else M.doClick(m, slot, b, M.PICKUP, P);
    m.refresh();
    if (P && P.syncHotbar) P.syncHotbar();
    return true;
  };

  // --- the loom (G19e-loom, #8056) ---------------------------------------------------------

  H.openLoom = function () {
    var M = NS.Menu, P = NS.Player;
    if (!M || !M.loomMenu || !P || !P.menu) return false;
    H.loomMenu = M.loomMenu(P.menu.inventory);
    H.loomScroll = 0;
    H.open('loom');
    return true;
  };

  /** Slot position in GUI pixels (`LoomScreenHandler` ctor). */
  function loomXY(i) {
    if (i === 0) return [13, 26];
    if (i === 1) return [33, 26];
    if (i === 2) return [23, 45];
    if (i === 3) return [143, 58];
    if (i < 31) { var q = i - 4; return [8 + (q % 9) * 18, 84 + ((q / 9) | 0) * 18]; }
    return [8 + (i - 31) * 18, 142];
  }
  function loomAt(px, py) {
    for (var i = 0; i < 40; i++) {
      var p = loomXY(i);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return i;
    }
    return -1;
  }
  /** The pattern buttons on offer, as [ordinal, gui x, gui y] (4 columns x 4 visible rows). */
  function loomButtons() {
    var m = H.loomMenu, L = NS.Loom, out = [];
    var list = L.selectable(m.input.get(0), m.input.get(2));
    var pat = m.input.get(2);
    if (list.length === 0 && pat && L.isPatternItem(pat) && m.selected > 0) list = [m.selected];
    var maxRow = Math.max(0, Math.ceil(list.length / 4) - 4);
    H.loomScroll = Math.max(0, Math.min(maxRow, H.loomScroll | 0));
    for (var k = H.loomScroll * 4; k < Math.min(list.length, (H.loomScroll + 4) * 4); k++) {
      var q = k - H.loomScroll * 4;
      out.push([list[k], 60 + (q % 4) * 14, 13 + ((q / 4) | 0) * 14]);
    }
    return out;
  }

  H.drawLoom = function (c) {
    var g = NS.Gui, M = NS.Menu, m = H.loomMenu;
    if (!g || !g.ready || !M || !m) { H.drawInventoryFallback(c); return; }
    var s = Math.max(2, H.scale);
    var ox = Math.round((H.w - 176 * s) * 0.5), oy = Math.round((H.h - 166 * s) * 0.5);
    H.loomOrigin = { x: ox, y: oy, s: s };
    g.dim(c, H.w, H.h);
    c.fillStyle = '#c6c6c6'; c.fillRect(ox, oy, 176 * s, 166 * s);
    g.text(c, 'Loom', ox + 8 * s, oy + 4 * s, s, 0x404040, false);
    g.text(c, 'Inventory', ox + 8 * s, oy + 72 * s, s, 0x404040, false);
    var mx = NS.Input ? (NS.Input.mx - ox) / s : -1, my = NS.Input ? (NS.Input.my - oy) / s : -1;
    var bs = loomButtons(), b;
    for (var k = 0; k < bs.length; k++) {
      b = bs[k];
      var on = b[0] === m.selected, hv = mx >= b[1] && mx < b[1] + 14 && my >= b[2] && my < b[2] + 14;
      c.fillStyle = on ? '#6a6a9a' : hv ? '#a0a0a0' : '#8b8b8b';
      c.fillRect(ox + b[1] * s, oy + b[2] * s, 14 * s, 14 * s);
      g.text(c, String(b[0]), ox + (b[1] + 2) * s, oy + (b[2] + 3) * s, s, 0xFFFFFF, false);
    }
    var hover = loomAt(mx, my);
    for (var i = 0; i < 40; i++) {
      var p = loomXY(i), sx = ox + p[0] * s, sy = oy + p[1] * s;
      c.fillStyle = '#8b8b8b'; c.fillRect(sx, sy, 16 * s, 16 * s);
      if (i === hover) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(sx, sy, 16 * s, 16 * s); }
      var st = M.slotGet(m.slots[i]);
      if (st) H.drawItem(c, st, sx, sy, 16 * s);
    }
    var carried = M.getCarried(m);
    if (carried && NS.Input) H.drawItem(c, carried, NS.Input.mx - 8 * s, NS.Input.my - 8 * s, 16 * s);
  };


  // --- the stonecutter (#8055) -------------------------------------------------------------

  H.openStonecutter = function (x, y, z) {
    var M = NS.Menu, P = NS.Player;
    if (!M || !M.stonecutterMenu || !P || !P.menu) return false;
    H.stonecutterMenu = M.stonecutterMenu(P.menu.inventory, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    H.stonecutterScroll = 0;
    H.open('stonecutter');
    return true;
  };

  /** Menu slot `i` inside the stonecutter screen (`StonecutterScreenHandler` ctor). */
  H.stonecutterSlotXY = function (i) {
    if (i === 0) return [20, 33];
    if (i === 1) return [143, 33];
    if (i < 29) { var k = i - 2; return [8 + (k % 9) * 18, 84 + ((k / 9) | 0) * 18]; }
    return [8 + (i - 29) * 18, 142];
  };
  H.stonecutterSlotAt = function (px, py) {
    for (var i = 0; i < 38; i++) {
      var p = H.stonecutterSlotXY(i);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return i;
    }
    return -1;
  };
  /** The recipe-grid cell under (px, py) in GUI pixels, or -1: 4 columns x 3 rows from (52, 14), 16x18 each. */
  H.stonecutterRecipeAt = function (px, py) {
    var m = H.stonecutterMenu;
    if (!m || !m.canCraft()) return -1;
    var off = (H.stonecutterScroll | 0) * 4;
    for (var i = off; i < off + 12 && i < m.recipes.length; i++) {
      var k = i - off, dx = px - (52 + (k % 4) * 16), dy = py - (14 + ((k / 4) | 0) * 18);
      if (dx >= 0 && dy >= 0 && dx < 16 && dy < 18) return i;
    }
    return -1;
  };

  H.drawStonecutter = function (c) {
    var g = NS.Gui, M = NS.Menu, m = H.stonecutterMenu;
    if (!g || !g.ready || !M || !m) { H.drawInventoryFallback(c); return; }
    m.refresh();
    var s = Math.max(2, H.scale), W = 176, Ht = 166;
    var ox = Math.round((H.w - W * s) * 0.5), oy = Math.round((H.h - Ht * s) * 0.5);
    H.stonecutterOrigin = { x: ox, y: oy, s: s };
    g.dim(c, H.w, H.h);
    g.blit(c, 'stonecutter', [0, 0, W, Ht], ox, oy, s);
    var maxScroll = Math.max(0, ((m.recipes.length + 3) >> 2) - 3);
    if (!m.canCraft() || H.stonecutterScroll > maxScroll) H.stonecutterScroll = 0;
    var scrollable = m.canCraft() && m.recipes.length > 12;
    var bar = maxScroll ? Math.floor(41 * H.stonecutterScroll / maxScroll) : 0;
    g.blit(c, 'stonecutter', [176 + (scrollable ? 0 : 12), 0, 12, 15], ox + 119 * s, oy + (15 + bar) * s, s);
    g.text(c, 'Stonecutter', ox + 8 * s, oy + 5 * s, s, 0x404040, false);
    g.text(c, 'Inventory', ox + 8 * s, oy + 72 * s, s, 0x404040, false);
    var mx = NS.Input ? (NS.Input.mx - ox) / s : -1, my = NS.Input ? (NS.Input.my - oy) / s : -1;
    if (m.canCraft()) {
      var off = H.stonecutterScroll * 4, hr = H.stonecutterRecipeAt(mx, my);
      for (var i = off; i < off + 12 && i < m.recipes.length; i++) {
        var k = i - off, rx = 52 + (k % 4) * 16, ry = 14 + ((k / 4) | 0) * 18 + 2;
        var vy = i === m.selected ? Ht + 18 : (i === hr ? Ht + 36 : Ht);
        g.blit(c, 'stonecutter', [0, vy, 16, 18], ox + rx * s, oy + (ry - 1) * s, s);
        H.drawItem(c, m.recipes[i].result, ox + rx * s, oy + ry * s, 16 * s);
      }
    }
    var hover = H.stonecutterSlotAt(mx, my);
    for (var j = 0; j < 38; j++) {
      var p = H.stonecutterSlotXY(j), sx = ox + p[0] * s, sy = oy + p[1] * s;
      if (j === hover) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(sx, sy, 16 * s, 16 * s); }
      var st = M.slotGet(m.slots[j]);
      if (st) H.drawItem(c, st, sx, sy, 16 * s);
    }
    var carried = M.getCarried(m);
    if (carried && NS.Input) H.drawItem(c, carried, NS.Input.mx - 8 * s, NS.Input.my - 8 * s, 16 * s);
  };

  H.loomClick = function (mx, my, button, shift) {
    var M = NS.Menu, m = H.loomMenu, P = NS.Player;
    if (!M || !m) return false;
    var o = H.loomOrigin;
    if (o && mx >= 0) {
      var px = (mx - o.x) / o.s, py = (my - o.y) / o.s, bs = loomButtons();
      for (var k = 0; k < bs.length; k++) {
        if (px >= bs[k][1] && px < bs[k][1] + 14 && py >= bs[k][2] && py < bs[k][2] + 14) {
          m.button(bs[k][0]);
          return true;
        }
      }
    }
    var slot = (o && mx >= 0) ? loomAt((mx - o.x) / o.s, (my - o.y) / o.s) : -1;
    var b = button === 2 ? 1 : 0;
    if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);
    else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);
    else M.doClick(m, slot, b, M.PICKUP, P);
    if (P && P.syncHotbar) P.syncHotbar();
    return true;
  };

  // --- the cartography table (G19e, #8058) -------------------------------------------------

  H.openCartography = function () {
    var M = NS.Menu, P = NS.Player;
    if (!M || !M.cartographyMenu || !P || !P.menu) return false;
    H.cartMenu = M.cartographyMenu(P.menu.inventory);
    H.open('cartography');
    return true;
  };

  /** Slot position in GUI pixels (`CartographyTableScreenHandler` ctor). */
  function cartXY(i) {
    if (i === 0) return [15, 15];
    if (i === 1) return [15, 52];
    if (i === 2) return [145, 39];
    if (i < 30) { var q = i - 3; return [8 + (q % 9) * 18, 84 + ((q / 9) | 0) * 18]; }
    return [8 + (i - 30) * 18, 142];
  }
  function cartAt(px, py) {
    for (var i = 0; i < 39; i++) {
      var p = cartXY(i);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return i;
    }
    return -1;
  }

  H.drawCartography = function (c) {
    var g = NS.Gui, M = NS.Menu, m = H.cartMenu;
    if (!g || !g.ready || !M || !m) { H.drawInventoryFallback(c); return; }
    m.refresh();
    var s = Math.max(2, H.scale);
    var ox = Math.round((H.w - 176 * s) * 0.5), oy = Math.round((H.h - 166 * s) * 0.5);
    H.cartOrigin = { x: ox, y: oy, s: s };
    g.dim(c, H.w, H.h);
    c.fillStyle = '#c6c6c6'; c.fillRect(ox, oy, 176 * s, 166 * s);
    g.text(c, 'Cartography Table', ox + 8 * s, oy + 4 * s, s, 0x404040, false);
    g.text(c, 'Inventory', ox + 8 * s, oy + 72 * s, s, 0x404040, false);
    var hover = NS.Input ? cartAt((NS.Input.mx - ox) / s, (NS.Input.my - oy) / s) : -1;
    for (var i = 0; i < 39; i++) {
      var p = cartXY(i), sx = ox + p[0] * s, sy = oy + p[1] * s;
      c.fillStyle = '#8b8b8b'; c.fillRect(sx, sy, 16 * s, 16 * s);
      if (i === hover) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(sx, sy, 16 * s, 16 * s); }
      var st = M.slotGet(m.slots[i]);
      if (st) H.drawItem(c, st, sx, sy, 16 * s);
    }
    var carried = M.getCarried(m);
    if (carried && NS.Input) H.drawItem(c, carried, NS.Input.mx - 8 * s, NS.Input.my - 8 * s, 16 * s);
  };

  H.stonecutterClick = function (mx, my, button, shift) {
    var M = NS.Menu, m = H.stonecutterMenu, P = NS.Player;
    if (!M || !m) return false;
    m.refresh();
    var o = H.stonecutterOrigin;
    var px = o ? (mx - o.x) / o.s : -1, py = o ? (my - o.y) / o.s : -1;
    var ri = o ? H.stonecutterRecipeAt(px, py) : -1;
    if (ri >= 0) { m.onButtonClick(ri); return true; }       // `clickButton`
    var slot = (o && mx >= 0) ? H.stonecutterSlotAt(px, py) : -1;
    var b = button === 2 ? 1 : 0;
    if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);
    else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);
    else M.doClick(m, slot, b, M.PICKUP, P);
    m.refresh();
    if (P && P.syncHotbar) P.syncHotbar();
    return true;
  };

  H.cartographyClick = function (mx, my, button, shift) {
    var M = NS.Menu, m = H.cartMenu, P = NS.Player;
    if (!M || !m) return false;
    m.refresh();
    var o = H.cartOrigin;
    var slot = (o && mx >= 0) ? cartAt((mx - o.x) / o.s, (my - o.y) / o.s) : -1;
    var b = button === 2 ? 1 : 0;
    if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);
    else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);
    else M.doClick(m, slot, b, M.PICKUP, P);
    m.refresh();
    if (P && P.syncHotbar) P.syncHotbar();
    return true;
  };

  // --- the dispenser and the dropper (PASS 17 JOB 1, G19b, D-420) -------------

  /**
   * Open the dispenser or dropper at (x, y, z). ⚠ ONE SCREEN, TWO BLOCKS: the only difference is
   * the title, which is read off the block entity's own type.
   */
  H.openDispenser = function (x, y, z) {
    var BE = NS.BlockEntities, M = NS.Menu, P = NS.Player;
    if (!BE || !M || !P || !P.menu) return false;
    var be = BE.get(x, y, z);
    if (!be || (be.type !== 'dispenser' && be.type !== 'dropper')) return false;
    H.dispenserMenu = M.dispenserMenu(be, P.menu.inventory);
    H.dispenserPos = { x: x, y: y, z: z };
    H.open('dispenser');
    return true;
  };

  H.drawDispenser = function (c) {
    var g = NS.Gui, M = NS.Menu, m = H.dispenserMenu;
    if (!g || !g.ready || !M || !m) { H.drawInventoryFallback(c); return; }
    var V = g.DISPENSER, s = Math.max(2, H.scale);
    var ox = Math.round((H.w - V.w * s) * 0.5);
    var oy = Math.round((H.h - V.h * s) * 0.5);
    H.dispenserOrigin = { x: ox, y: oy, s: s };

    g.dim(c, H.w, H.h);
    g.blit(c, 'dispenser', [0, 0, V.w, V.h], ox, oy, s);

    var title = H.displayName(m.be ? m.be.type : 'dispenser', false);
    g.text(c, title, ox + V.title.x * s, oy + V.title.y * s, s, 0x404040, false);
    g.text(c, 'Inventory', ox + V.inventoryLabel.x * s, oy + V.inventoryLabel.y * s, s, 0x404040, false);

    var hover = NS.Input ? g.dispenserSlotAt((NS.Input.mx - ox) / s, (NS.Input.my - oy) / s) : -1;
    for (var i = 0; i < g.DISPENSER_SLOTS; i++) {
      var p = g.dispenserSlotXY(i);
      var sx = ox + p[0] * s, sy = oy + p[1] * s;
      if (i === hover) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(sx, sy, 16 * s, 16 * s); }
      var st = M.slotGet(m.slots[i]);
      if (st) H.drawItem(c, st, sx, sy, 16 * s);
    }

    var carried = M.getCarried(m);
    if (carried && NS.Input) H.drawItem(c, carried, NS.Input.mx - 8 * s, NS.Input.my - 8 * s, 16 * s);
    if (hover >= 0 && !carried) {
      var hs = M.slotGet(m.slots[hover]);
      if (hs && !NS.Inventory.isEmpty(hs)) {
        H.drawStackTooltip(c, hs, s);
      }
    }
  };

  /** A click inside the dispenser/dropper screen. Same `ClickType` shape as `H.chestClick`. */
  H.dispenserClick = function (mx, my, button, shift) {
    var M = NS.Menu, m = H.dispenserMenu, P = NS.Player;
    if (!M || !m) return false;
    var o = H.dispenserOrigin;
    var slot = (o && mx >= 0) ? NS.Gui.dispenserSlotAt((mx - o.x) / o.s, (my - o.y) / o.s) : -1;
    var b = button === 2 ? 1 : 0;
    if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);
    else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);
    else M.doClick(m, slot, b, M.PICKUP, P);
    if (P && P.syncHotbar) P.syncHotbar();
    return true;
  };

  // --- the creative inventory (PLAN G11b) -------------------------------------

  /**
   * ⚠ THE SCREEN THE STARTER KIT WAS STANDING IN FOR. D-312 deleted the nine pre-filled hotbar
   * slots; this is the only way a creative player gets a block, so it is not a nicety and the two
   * changes belong in one commit (D-139).
   *
   * ⚠ DRAWN IN GUI PIXELS AND SCALED ONCE, like every other screen here, so every slot lands on
   * the texture's own 18-pixel grid. `NS.Creative` owns the geometry and the contents; this owns
   * the drawing and nothing else, which is why the tab strip cannot disagree with the hit test.
   */
  H.creOrigin = null;
  H.drawCreative = function (c) {
    var P = NS.Player, g = NS.Gui, I = NS.Inventory, M = NS.Menu, Cr = NS.Creative, IT = NS.Items;
    if (!g || !g.ready || !I || !M || !Cr || !P || !P.menu) { H.drawInventoryFallback(c); return; }
    if (!Cr.ready) Cr.build();
    if (!Cr.ready) { H.drawInventoryFallback(c); return; }

    var s = Math.max(2, H.scale);
    var ox = Math.round((H.w - Cr.W * s) * 0.5);
    var oy = Math.round((H.h - Cr.H * s) * 0.5);
    H.creOrigin = { x: ox, y: oy, s: s };
    var px = (NS.Input ? (NS.Input.mx - ox) / s : -1e9);
    var py = (NS.Input ? (NS.Input.my - oy) / s : -1e9);

    g.dim(c, H.w, H.h);

    // ⚠ THE UNSELECTED TABS GO UNDER THE PANEL AND THE SELECTED ONE OVER IT. That is what makes
    // the open tab look joined to the window; drawing them all first, or all last, gives a strip
    // of buttons floating beside a box.
    var t, col, r;
    for (t = 0; t < Cr.tabs.length; t++) {
      col = Cr.tabs[t].col;
      if (col === Cr.tab) continue;
      r = Cr.tabRect(col);
      g.blit(c, 'creative_tabs', [r[2], r[3], Cr.TAB_W, Cr.TAB_H], ox + r[0] * s, oy + r[1] * s, s);
      H.drawTabIcon(c, col, ox + r[0] * s, oy + r[1] * s, s);
    }
    g.blit(c, Cr.sheetFor(Cr.tab), [0, 0, Cr.W, Cr.H], ox, oy, s);
    if (Cr.tab === Cr.INVENTORY_COL) H.drawPlayerPreview(c, ox, oy, s, { cx: 88, feet: 45, size: 20, dy: 30, box: Cr.PREVIEW.box }, Cr.PREVIEW);
    r = Cr.tabRect(Cr.tab);
    g.blit(c, 'creative_tabs', [r[2], r[3], Cr.TAB_W, Cr.TAB_H], ox + r[0] * s, oy + r[1] * s, s);
    H.drawTabIcon(c, Cr.tab, ox + r[0] * s, oy + r[1] * s, s);

    // the tab's name, in vanilla's dark grey and WITHOUT a shadow — this text is on a light panel
    if (Cr.tab !== Cr.SEARCH_COL) {
      g.text(c, Cr.label(Cr.tab), ox + Cr.TITLE[0] * s, oy + Cr.TITLE[1] * s, s, 0x404040, false);
    } else {
      var q = Cr.query;
      // the caret blinks on vanilla's own half-second, off the wall clock rather than a
      // frame counter, so it does not speed up with the frame rate.
      var caret = (Cr.searching && ((Date.now() / 500) | 0) % 2 === 0) ? '_' : '';
      g.text(c, q + caret, ox + (Cr.SEARCH[0] + 1) * s, oy + (Cr.SEARCH[1] + 1) * s, s, 0xFFFFFF, false);
    }

    // ── the 9x5 picker ──────────────────────────────────────────────────────────────────────
    var surv = Cr.tab === Cr.INVENTORY_COL;
    var list = Cr.stacks();
    Cr.clampScroll();
    var base = Cr.scroll * Cr.COLS;
    var hover = Cr.hitAt(px, py);
    if (surv) {
      var sm = P.menu, ml = [5, 6, 7, 8, 45], mi, mp, mst;
      for (mi = 9; mi < 36; mi++) ml.push(mi);
      for (mi = 0; mi < ml.length; mi++) {
        mp = Cr.menuSlotXY(ml[mi]);
        var mx0 = ox + mp[0] * s, my0 = oy + mp[1] * s;
        mst = M.slotGet(sm.slots[ml[mi]]);
        var eph = H.emptySlotSheet(ml[mi]);
        if (!mst && eph) g.blit(c, eph, [0, 0, 16, 16], mx0, my0, s);
        if (mst) H.drawItem(c, mst, mx0, my0, 16 * s);
        if (hover && hover.kind === 'slot' && hover.slot === ml[mi]) {
          c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(mx0, my0, 16 * s, 16 * s);
        }
      }
      if (hover && hover.kind === 'delete') {
        c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(ox + Cr.DELETE[0] * s, oy + Cr.DELETE[1] * s, 16 * s, 16 * s);
      }
    }
    if (Cr.tab === Cr.HOTBAR_COL) {
      // Saved Toolbars: one saved entry (nine stacks) per row
      for (var hr = 0; hr < Cr.ROWS; hr++) {
        for (var hc = 0; hc < Cr.COLS; hc++) {
          var hst = Cr.savedCell(Cr.scroll + hr, hc);
          if (I.isEmpty(hst)) continue;
          var hp = Cr.cellXY(hr * Cr.COLS + hc);
          H.drawItem(c, hst, ox + hp[0] * s, oy + hp[1] * s, 16 * s);
        }
      }
    }
    for (var k = 0; k < Cr.PER_PAGE; k++) {
      var idx = base + k;
      if (surv || Cr.tab === Cr.HOTBAR_COL || idx >= list.length) break;
      var p = Cr.cellXY(k);
      var sx = ox + p[0] * s, sy = oy + p[1] * s;
      if (hover && hover.kind === 'cell' && hover.cell === k) {
        c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(sx, sy, 16 * s, 16 * s);
      }
      H.drawItem(c, I.stack(list[idx].i, 1, 0, list[idx].t || undefined), sx, sy, 16 * s);
    }

    // ── the scrollbar ───────────────────────────────────────────────────────────────────────
    var S = Cr.SCROLL, sc = Cr.canScroll() ? Cr.SCROLLER : Cr.SCROLLER_OFF;
    var m = Cr.maxScroll();
    var frac = m > 0 ? Cr.scroll / m : 0;
    var hy = S[1] + Math.round(frac * (S[3] - sc[3]));
    g.blit(c, 'creative_tabs', sc, ox + S[0] * s, oy + hy * s, s);

    // ── the player's hotbar, which is the only inventory row an item tab shows ───────────────
    var menu = P.menu;
    for (var q2 = 0; q2 < 9; q2++) {
      var hp = Cr.hotXY(q2);
      var hx = ox + hp[0] * s, hyy = oy + hp[1] * s;
      if (hover && hover.kind === 'hotbar' && hover.slot === q2) {
        c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(hx, hyy, 16 * s, 16 * s);
      }
      var hs = M.slotGet(menu.slots[36 + q2]);
      if (hs) H.drawItem(c, hs, hx, hyy, 16 * s);
    }

    // ⚠ THE CARRIED STACK LAST AND ON THE POINTER, or a drag does not read as a drag.
    var carried = M.getCarried(menu);
    if (carried && NS.Input) H.drawItem(c, carried, NS.Input.mx - 8 * s, NS.Input.my - 8 * s, 16 * s);

    // the hovered item's name
    if (hover && !carried && NS.Input) {
      var name = null;
      if (hover.kind === 'cell') name = IT.nameOf(hover.item);
      else if (hover.kind === 'slot') {
        var st3 = M.slotGet(menu.slots[hover.slot]);
        if (st3 && !I.isEmpty(st3)) name = IT.nameOf(st3.i);
      } else if (hover.kind === 'hotbar') {
        var st2 = M.slotGet(menu.slots[36 + hover.slot]);
        if (st2 && !I.isEmpty(st2)) name = IT.nameOf(st2.i);
      }
      if (name) {
        var label = H.displayName(name, true);
        var tw = g.textWidth(label) * s;
        var tx = Math.min(H.w - tw - 4, NS.Input.mx + 10), ty = NS.Input.my - 12 * s;
        c.fillStyle = 'rgba(16,0,16,0.94)';
        c.fillRect(tx - 3 * s, ty - 3 * s, tw + 6 * s, 14 * s);
        g.text(c, label, tx, ty, s, 0xFFFFFF, true);
      }
    }
  };

  /**
   * The block-entity model for an item, as a canvas, cached. ⚠ CACHED BY NAME AND SIZE, because
   * the rasteriser is software: the creative inventory can ask for forty of these in one frame
   * and re-rendering a chest per frame is the difference between a screen and a slideshow.
   */
  var beCache = Object.create(null);
  H.beCanvas = function (name, size, tag) {
    var BE = NS.BEModel;
    if (!BE || !BE.ready || !name || typeof document === 'undefined') return null;
    // #891: a banner's `BlockEntityTag.Patterns` are part of what is drawn, so part of the key.
    var layers = tag && /_banner$/.test(name) ? BE.patternLayers(tag) : null;
    if (layers && !layers.length) layers = null;
    // #892: a shield with a `BlockEntityTag` is `shield_base` x Base + `entity/shield/*` layers.
    var sh = tag && name === 'shield' ? BE.shieldLook(tag) : null;
    if (sh) layers = sh.layers;
    var key = name + '@' + H.iconPx(size);
    if (sh) key += '|base:' + (sh.tint ? sh.tint.join(',') : '');
    if (layers) for (var li = 0; li < layers.length; li++) key += '|' + layers[li].tex + ':' + layers[li].rgb;
    if (beCache[key] !== undefined) return beCache[key];
    var spec = BE.forItem(name);
    if (!spec) { beCache[key] = null; return null; }
    var L = BE.layer(spec.layer);
    if (!L) { beCache[key] = null; return null; }
    // ⚠ A BED IS TWO LAYERS. Vanilla's item icon draws the head and the foot together, offset by
    // sixteen units along z, because a bed is two block entities and the item is the whole bed.
    var parts = L.parts;
    if (spec.second && BE.layer(spec.second)) {
      parts = L.parts.slice();
      var foot = BE.layer(spec.second).parts;
      for (var i = 0; i < foot.length; i++) {
        var p = {}; for (var k in foot[i]) p[k] = foot[i][k];
        p.py = (p.py || 0) + 16;
        parts.push(p);
      }
    }
    // ⚠ DEVICE pixels, for the same reason as `H.iconCanvas` — this path was already
    // resolution-aware in the GUI scale (which is why Dan's campfires were the sharp ones) and
    // still lost the device ratio on a display with one.
    var px = Math.max(16, H.iconPx(size));
    // ⚠ THE ITEM'S OWN `gui` ROTATION, out of the jar. A chest is [30, 45], a bed [30, 160], a
    // banner [30, 20]; drawing all three at one angle is what made the banner a line.
    var g = (BE.gui && BE.gui[name]) || null;
    var tint = spec.tintName ? H.dyeTint(spec.tintName) : null;
    var baseTex = spec.tex;
    if (sh) { baseTex = sh.tex; tint = sh.tint; }
    var comp = layers || sh ? BE.composite(baseTex, tint, layers || []) : null;
    var buf = BE.render(spec.layer, spec.tex, px, {
      texData: comp,
      parts: parts,
      rotX: g ? g.rot[0] : 30,
      rotY: g ? g.rot[1] : 45,
      rotZ: g ? g.rot[2] : 0,
      flip: !!BE.FLIP[spec.layer],
      bed: !!(BE.BED && BE.BED[spec.layer]),
      turn: !!(BE.TURN && BE.TURN[spec.layer]),
      tint: comp ? null : tint
    });
    var any = false;
    for (var q = 3; q < buf.length; q += 4) if (buf[q]) { any = true; break; }
    if (!any) { beCache[key] = null; return null; }
    var cv = document.createElement('canvas');
    cv.width = px; cv.height = px;
    var cx2 = cv.getContext('2d');
    var img = cx2.createImageData(px, px);
    img.data.set(buf);
    cx2.putImageData(img, 0, 0);
    beCache[key] = cv;
    return cv;
  };

  /**
   * A dye colour as an RGB multiplier.
   *
   * ⚠ IT IS `DyeColor.textureDiffuseColors`, THE BYTECODE'S OWN, and it is the column vanilla's
   * `BannerRenderer` uses — not `fireworkColor`, which is a different set of sixteen numbers for
   * the same sixteen names. The first version of this asked the ITEM table for `<colour>_dye`'s
   * tint and got nothing, because a dye's icon is a coloured sprite rather than a tinted one, so
   * every banner came out white.
   */
  H.dyeTint = function (colour) {
    var BE = NS.BEModel;
    if (!BE || !BE.dye) return null;
    var rgb = BE.dye[colour];
    if (rgb === undefined) return null;
    return [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255];
  };

  /**
   * A tab's icon, at vanilla's own offset inside the 28x32 button.
   * ⚠ THE ONE-PIXEL NUDGE IS NOT DECORATION: the top row's button hangs down into the panel and
   * the bottom row's hangs up out of it, so their icons sit a pixel apart in opposite directions.
   * Drawing both at the same place leaves the bottom strip looking a pixel low, which is visible
   * because the two rows are twelve identical buttons apart.
   */
  H.drawTabIcon = function (c, col, x, y, s) {
    var Cr = NS.Creative, I = NS.Inventory;
    if (!Cr || !I) return;
    var item = Cr.iconOf(col);
    if (item < 0) return;
    var dy = (col < Cr.TAB_PER_ROW) ? 1 : -1;
    H.drawItem(c, I.stack(item, 1), x + 6 * s, y + (8 + dy) * s, 16 * s);
  };

  /**
   * A click inside the creative screen.
   *
   * ⚠ THE PICKER IS ALSO THE BIN — clicking the item list while carrying a stack destroys it,
   * which is vanilla's rule and the reason creative has no visible trash slot. `NS.Creative` owns
   * that decision (left/right/middle per vanilla); this routes the geometry to it and the hotbar to G8's click machine.
   */
  H.creativeClick = function (mx, my, button, shift) {
    var Cr = NS.Creative, P = NS.Player, M = NS.Menu, o = H.creOrigin;
    if (!Cr || !P || !M || !o) return false;
    var px = (mx - o.x) / o.s, py = (my - o.y) / o.s;
    var tab = Cr.tabAt(px, py);
    if (tab >= 0) {
      // the survival tab is a tab of this screen (vanilla: creative_inv.png, no crafting grid)
      Cr.setTab(tab);
      return true;
    }
    var hit = Cr.hitAt(px, py);
    if (!hit) {
      // outside the panel: drop what is carried, exactly as the player's own screen does
      M.doClick(P.menu, M.OUTSIDE, button === 2 ? 1 : 0, M.PICKUP, P);
      P.syncHotbar();
      return true;
    }
    if (hit.kind === 'cell') { Cr.clickCell(hit.item, shift, P, button, hit.tag); P.syncHotbar(); return true; }
    if (hit.kind === 'hotbar') { Cr.clickHotbar(hit.slot, button, shift, P); P.syncHotbar(); return true; }
    if (hit.kind === 'slot') {
      M.doClick(P.menu, hit.slot, button === 2 ? 1 : 0, shift ? M.QUICK_MOVE : M.PICKUP, P);
      P.syncHotbar();
      return true;
    }
    if (hit.kind === 'delete') { Cr.clickDelete(shift, P); P.syncHotbar(); return true; }
    if (hit.kind === 'scroll') { if (Cr.canScroll()) { Cr.dragging = true; Cr.scrollTo(hit.frac); } return true; }
    return true;
  };

  /** Before the GUI payload decodes — a world that is still loading must still draw something. */
  H.drawInventoryFallback = function (c) {
    screenFallback(c, 'inventory');
  };

  // --- villager trading (PLAN G18f, D-48x) ------------------------------------

  /**
   * Open villager `e`'s trades. IMMEDIATE MODE — the same shape the bench report and options
   * screens use (`H.hit` rebuilt every frame by `H.drawTrading`, walked by the generic click
   * loop at the bottom of `H.click`), not G8's slot-click machine: the three item slots
   * (D-483) are drawn, not clickable-and-dragged — `Trade.attempt` still spends straight out of
   * the whole inventory (Trade.OWED names the real slot-placement economy, still unbuilt).
   */
  H.tradingEntity = null;
  H.tradeMsg = null;
  H.tradeIndex = 0;
  H.tradeMenu = null;
  H.openTrading = function (e) {
    if (!NS.Trade || !e) return false;
    NS.Trade.ensure(e);
    if (e.type === 'villager' && NS.Trade.prepareOffersFor) NS.Trade.prepareOffersFor(e, NS.Player);   // D-505
    H.tradingEntity = e;
    if (NS.WT && NS.WT.setCustomer) NS.WT.setCustomer(e, NS.Player);   // MerchantEntity.setCustomer
    H.tradeMsg = null;
    H.tradeIndex = 0;
    H.tradeMenu = NS.Trade.menuOpen(e, NS.Player);
    if (H.tradeMenu) NS.Player.currentScreenHandler = H.tradeMenu;   // MerchantScreenHandler
    H.open('trading');
    return true;
  };

  /** One offer, as one readable line — no icons yet (Trade.OWED: vanilla's own GUI sheet for
   * this screen is not extracted this unit; guicheck's later job, same as chest/furnace's own). */
  H.tradeLabel = function (o) {
    switch (o.kind) {
      case 'sell_item_for_emerald':
        return o.itemQty + ' ' + o.item + '  ->  ' + (o.priceEmerald || 1) + ' emerald';
      case 'buy_item_for_emerald':
        return o.priceEmerald + ' emerald  ->  ' + o.itemQty + ' ' + o.item;
      case 'buy_item_for_emerald_and_item':
        return o.priceEmerald + ' emerald + ' + o.itemQty + ' ' + o.item + '  ->  ' + o.item2Qty + ' ' + o.item2;
      case 'sell_suspicious_stew_for_emerald':
        return (o.priceEmerald || 1) + ' emerald  ->  suspicious stew (' + o.effect + ')';
      default:
        return o.kind;
    }
  };

  /**
   * D-483 — THE REAL SLOTS AND WIDGETS, over vanilla's own `villager.png` background (D-48x).
   * `Gui.MERCHANT_SLOT`/`MERCHANT_ARROW` are javap'd off `aqo` (the real Container) and `clq$a`
   * (the arrow-button base) — see 15b_gui.js's own comment for the class-by-class citation. One
   * offer is shown at a time (`H.tradeIndex`), paged by the two arrows exactly as `clq$1`
   * (next)/`clq$2` (previous) page `clq`'s own `B` field, clamped to `[0, offers.length-1]`.
   * The three slots are DISPLAY ONLY (`Trade.previewFor`) — clicking the result slot attempts
   * the trade the same way the old text row did; Trade.OWED names the real slot-placement
   * economy (drag payment INTO the input slots) this does not build.
   */
  H.drawTrading = function (c) {
    var Tr = NS.Trade, e = H.tradingEntity, G = NS.Gui;
    if (!Tr || !e || !e.tradeOffers) { H.close(); return; }
    if (!G || !G.ready || !G.MERCHANT) { H.drawTradingFallback(c); return; }
    var offers = e.tradeOffers, s = Math.max(2, H.scale), m = H.tradeMenu;
    var M = G.MERCHANT, w = M.w * s, h = M.h * s, LW = 100 * s;
    // MerchantScreen is 276 wide: the 100px offer list (89 rows + 6 scrollbar) then the 176 panel
    // (villager.png here is the 1.13 sheet — no list art in it — so the list is drawn plain).
    var lx = Math.round((H.w - (LW + w)) * 0.5), x = lx + LW, y = Math.round((H.h - h) * 0.5);
    if (m && m.sel >= offers.length) m.sel = offers.length - 1;
    if (m && Tr.menuCanScroll(offers.length)) m.scroll = Math.max(0, Math.min(offers.length - 7, m.scroll));
    G.dim(c, H.w, H.h);
    c.fillStyle = '#c6c6c6'; c.fillRect(lx, y, LW, h);
    c.fillStyle = '#373737'; c.fillRect(lx, y, LW, s); c.fillRect(lx, y, s, h); c.fillRect(lx, y + h - s, LW, s);
    G.blit(c, 'merchant', [0, 0, M.w, M.h], x, y, s);
    c.font = Math.max(11, Math.round(11 * s / 2)) + 'px ' + UIFONT;
    c.textAlign = 'center';
    c.fillStyle = '#3f3f3f';
    c.fillText(e.type === 'wandering_trader' ? H.displayName('wandering_trader', false) : H.displayName(e.profession, false), x + w * 0.5, y + Math.round(12 * s / 2));
    c.fillText('Trades', lx + LW * 0.5, y + Math.round(12 * s / 2));
    c.textAlign = 'left';

    // D-484 — level name/badge + xp progress, over the same threshold Trade.canLevelUp reads.
    var lvl = e.villagerLevel || 1, name = Tr.LEVEL_NAMES[lvl] || ('Level ' + lvl);
    c.font = Math.max(9, Math.round(9 * s / 2)) + 'px ' + UIFONT;
    c.textAlign = 'center';
    c.fillStyle = '#706c6c';
    var lvlLine = name + (lvl < Tr.MAX_LEVEL
      ? '  (' + (e.tradeXp || 0) + '/' + Tr.xpForNextLevel(lvl) + ' xp)'
      : '  (max)');
    if (e.type === 'wandering_trader') lvlLine = '';   // isLeveledMerchant() == false: no level row
    c.fillText(lvlLine, x + w * 0.5, y + Math.round(21 * s / 2));
    c.textAlign = 'left';

    if (!offers.length || !m) {
      c.fillStyle = '#3f3f3f';
      c.textAlign = 'center';
      c.fillText('Nothing to trade.', x + w * 0.5, y + Math.round(60 * s / 2));
      c.textAlign = 'left';
    } else {
      // ── the offer list: 7 rows at (5, 18+20r), `MerchantScreen.render` / `WidgetButtonPage`
      var vis = Tr.menuVisible(m), rowH = 20 * s;
      for (var r = 0; r < vis.length; r++) {
        (function (oi, ry) {
          var ro = offers[oi], pv = Tr.previewFor(ro, e, oi), dis = Tr.disabled(e, oi);
          var rx = lx + 5 * s;
          c.fillStyle = oi === m.sel ? '#8b8b8b' : '#a9a9a9';
          c.fillRect(rx, ry, 89 * s, rowH - s);
          H.drawItem(c, pv.in1, rx + 5 * s, ry + 2 * s, 16 * s);
          if (pv.in2) H.drawItem(c, pv.in2, rx + 35 * s, ry + 2 * s, 16 * s);
          c.fillStyle = dis ? '#8b2020' : '#373737';
          c.fillRect(rx + 55 * s, ry + 7 * s, 10 * s, 3 * s);
          H.drawItem(c, pv.out, rx + 68 * s, ry + 2 * s, 16 * s);
          push(rx, ry, 89 * s, rowH - s, function () {
            if (Tr.menuSelect(m, oi)) H.tradeMsg = null; else H.tradeMsg = 'no room to return payment';
            H.tradeIndex = oi;
          });
        })(vis[r], y + (18 + 20 * r) * s);
      }
      // scrollbar (`renderScrollbar`): a thumb only when the list scrolls; a click on the track sets
      // the offset the way `mouseDragged` maps it.
      var scrollable = Tr.menuCanScroll(offers.length), bx = lx + 94 * s;
      c.fillStyle = scrollable ? '#f0f0f0' : '#8b8b8b';
      c.fillRect(bx, y + (18 + (scrollable ? Tr.scrollThumbY(offers.length, m.scroll) : 0)) * s, 6 * s, 27 * s);
      if (scrollable) push(bx, y + 18 * s, 6 * s, 140 * s, function () {
        var my = NS.Input ? NS.Input.my : 0;
        m.scroll = Tr.scrollFromDrag(offers.length, (my - (y + 18 * s)) / s);
      });

      var idx = m.sel, o = idx >= 0 ? offers[idx] : null, sold = o ? Tr.disabled(e, idx) : false;
      var SL = G.MERCHANT_SLOT;
      var slotXY = function (p) { return [x + p[0] * s, y + p[1] * s]; };
      var draw1 = function (stack, p) {
        if (!stack) return;
        var xy = slotXY(p);
        H.drawItem(c, stack, xy[0], xy[1], 16 * s);
      };
      draw1(m.slots[0], SL.in1);
      draw1(m.slots[1], SL.in2);
      // clicking a payment slot hands its stack back to the inventory
      [[SL.in1, 0], [SL.in2, 1]].forEach(function (q) {
        var xy = slotXY(q[0]);
        push(xy[0], xy[1], 16 * s, 16 * s, function () {
          var st = m.slots[q[1]];
          if (st && NS.Inventory.add(NS.Player.inventory, st) === 0) m.slots[q[1]] = null;
        });
      });
      var matched = o && !sold && Tr.menuMatch(m);
      if (matched) {
        var pvo = Tr.previewFor(o, e, idx);
        draw1(pvo.out, SL.out);
      }
      // the result slot — `TradeOutputSlot.onTakeItem`: the payment leaves the INPUT slots
      var oxy = slotXY(SL.out);
      push(oxy[0], oxy[1], 16 * s, 16 * s, function () {
        if (!o) return;
        var r = Tr.attempt(e, idx, NS.Player, m);
        H.tradeMsg = r.ok ? null : r.reason;
      });
      if (sold) {
        c.fillStyle = '#8b7f7f';
        c.textAlign = 'center';
        c.fillText('SOLD OUT', x + w * 0.5, y + Math.round(96 * s / 2));
        c.textAlign = 'left';
      }
      if (o) {
        c.fillStyle = '#3f3f3f';
        c.textAlign = 'center';
        c.fillText(H.tradeLabel(o) + '  (' + (idx + 1) + '/' + offers.length + ')',
                   x + w * 0.5, y + Math.round(140 * s / 2));
        c.textAlign = 'left';
      }
    }

    if (H.tradeMsg) {
      c.fillStyle = '#a03030';
      c.textAlign = 'center';
      c.fillText(H.tradeMsg, x + w * 0.5, y + h - Math.round(20 * s / 2));
      c.textAlign = 'left';
    }
    c.fillStyle = '#707070';
    c.textAlign = 'center';
    c.fillText('Esc to close', x + w * 0.5, y + h - Math.round(6 * s / 2));
    c.textAlign = 'left';
  };

  /** Before `NS.Gui`'s payload decodes, or if it never does — the same shape every other
   * texture-backed screen's fallback takes (`H.drawPauseFallback`, `H.drawInventoryFallback`). */
  H.drawTradingFallback = function (c) {
    screenFallback(c, 'trading');
  };

  // --- the horse inventory screen (QUEUE 0.2 G18e remainder) --------------------------------

  /**
   * Open horse `e`'s own screen: `Mount.menu` is the real, already-tested container (saddle
   * slot 0, armour slot 1, the player's own 27+9) -- this only seats it and switches `H.screen`,
   * the SAME two-step every other real-container screen here takes (`H.openCraftingTable`,
   * `H.openFurnace`). `HorseScreenHandler.canUse` (.decomp) -- alive and within 8 blocks -- is
   * the live caller's job (`Use.entityUse`'s own distance/removed checks), not re-asserted here.
   */
  H.openHorse = function (e) {
    var M = NS.Menu, Mnt = NS.Mount, P = NS.Player;
    if (!M || !Mnt || !Mnt.ready || !P || !P.menu || !Mnt.isMountable(e)) return false;
    H.horseMenu = Mnt.menu(e, P.menu.inventory);
    if (!H.horseMenu) return false;
    H.horseEntity = e;
    H.open('horse');
    return true;
  };

  /**
   * `InventoryScreen.drawEntity(x, y, size, mouseX, mouseY, entity)` (.decomp), software-rasterised: `ER.previewQuads`
   * gives the posed quads of every layer (body, marking, armour, saddle, chest, carpet), turned by
   * `f = atan(mouseX/40)`, `g = atan(mouseY/40)` exactly as vanilla (body 180+f*20, head 180+f*40, pitch -g*20, the
   * whole figure tipped g*20 about X). `x`,`y` are the feet in device pixels, `size` device pixels per block.
   * Orthographic, z-buffered, alpha-tested, face-shaded. Returns the pixels painted.
   */
  H.drawEntityPreview = function (c, e, x, y, size, mouseX, mouseY, s) {
    var ER = NS.EntityRender, A = NS.Atlas;
    if (!ER || !ER.previewQuads || !A || !A.mips) return 0;
    var f = Math.atan(mouseX / 40), g = Math.atan(mouseY / 40);
    H.lastPreview = { bodyYaw: 180 + f * 20, headYaw: 180 + f * 40, pitch: -g * 20 };
    var quads = ER.previewQuads(e, 180 + f * 20, 180 + f * 40 - (180 + f * 20), -g * 20);
    if (!quads || !quads.length) return 0;
    var R = Math.ceil(size * 2.4), W = R * 2, N = W * W;
    var img = H.previewImg && H.previewImg.width === W ? H.previewImg : (H.previewImg = c.createImageData ? c.createImageData(W, W) : null);
    if (!img) return 0;
    var px = img.data, zb = new Float32Array(N).fill(-1e9), tex = A.mips[0].data, T2 = A.TILE * A.TILE;
    px.fill(0);
    var cg = Math.cos(g * 20 * Math.PI / 180), sg = Math.sin(g * 20 * Math.PI / 180), SH = [0.8, 0.8, 1, 0.5, 0.6, 0.6];
    var painted = 0;
    for (var qi = 0; qi < quads.length; qi++) {
      var q = quads[qi], X = [0, 0, 0, 0], Y = [0, 0, 0, 0], Z = [0, 0, 0, 0];
      for (var k = 0; k < 4; k++) {
        var wy = q.y[k], wz = q.z[k];
        X[k] = R + q.x[k] * ER.PREVIEW_SIDE * size;
        Y[k] = R - (wy * cg - wz * sg) * size;
        Z[k] = wy * sg + wz * cg;
      }
      var sh = SH[q.face] || 1;
      for (var t = 0; t < 2; t++) {
        var a = 0, b = t ? 2 : 1, d = t ? 3 : 2;
        var x0 = X[a], y0 = Y[a], x1 = X[b], y1 = Y[b], x2 = X[d], y2 = Y[d];
        var den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(den) < 1e-6) continue;
        var minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
        var minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(W - 1, Math.ceil(Math.max(y0, y1, y2)));
        for (var yy = minY; yy <= maxY; yy++) for (var xx = minX; xx <= maxX; xx++) {
          var pxm = xx + 0.5, pym = yy + 0.5;
          var l0 = ((y1 - y2) * (pxm - x2) + (x2 - x1) * (pym - y2)) / den;
          var l1 = ((y2 - y0) * (pxm - x2) + (x0 - x2) * (pym - y2)) / den;
          var l2 = 1 - l0 - l1;
          if (l0 < -1e-4 || l1 < -1e-4 || l2 < -1e-4) continue;
          var vi = [a, b, d], w = [l0, l1, l2], z = 0, u = 0, v = 0;
          for (var m = 0; m < 3; m++) { z += w[m] * Z[vi[m]]; u += w[m] * q.u[vi[m]]; v += w[m] * q.v[vi[m]]; }
          var pi = yy * W + xx;
          if (z < zb[pi] - 1e-4) continue;   // a later layer (armour, saddle) wins a tie with the body it dresses
          var tx = Math.min(15, Math.max(0, Math.floor(u))), ty = Math.min(15, Math.max(0, Math.floor(v)));
          var ti = (q.tile * T2 + ty * A.TILE + tx) * 4;
          if (tex[ti + 3] < 128) continue;
          zb[pi] = z;
          var o = pi * 4;
          px[o] = tex[ti] * sh; px[o + 1] = tex[ti + 1] * sh; px[o + 2] = tex[ti + 2] * sh; px[o + 3] = 255;
          painted++;
        }
      }
    }
    if (!H.previewCv) H.previewCv = document.createElement('canvas');
    H.previewCv.width = W; H.previewCv.height = W;
    H.previewCv.getContext('2d').putImageData(img, 0, 0);
    c.drawImage(H.previewCv, Math.round(x - R), Math.round(y - R));
    return painted;
  };

  /**
   * #5785 -- `InventoryScreen.drawEntity(x+51, y+75, 30, x+51-mouseX, y+75-50-mouseY, player)` (survival inventory) and
   * `drawEntity(x+88, y+45, 20, x+88-mouseX, y+45-30-mouseY, player)` (creative Survival tab, scissored to its box):
   * the live player model through `H.drawEntityPreview`. `view` = {cx, feet, size, dy, box?} in GUI units. Falls back
   * to the flat skin (`Gui.drawPlayer`) only while the entity renderer is unbuilt.
   */
  H.drawPlayerPreview = function (c, ox, oy, s, view, fallbackView) {
    var ER = NS.EntityRender, g = NS.Gui, mx = NS.Input ? NS.Input.mx : 0, my = NS.Input ? NS.Input.my : 0;
    var e = ER && ER.ready && ER.playerPreviewEntity ? ER.playerPreviewEntity() : null;
    if (e) {
      c.save();
      if (view.box) { c.beginPath(); c.rect(ox + view.box[0] * s, oy + view.box[1] * s, view.box[2] * s, view.box[3] * s); c.clip(); }
      var fx = ox + view.cx * s, fy = oy + view.feet * s;
      var n = H.drawEntityPreview(c, e, fx, fy, view.size * s, (fx - mx) / s, (fy - view.dy * s - my) / s, s);
      c.restore();
      if (n) return true;
    }
    return g.drawPlayer(c, ox, oy, s, fallbackView);
  };

  H.drawHorseFallback = function (c) {
    screenFallback(c, 'horse');
  };

  /**
   * `HorseScreen.drawBackground`/`render` (.decomp), branch for branch: the panel, the saddle
   * icon (`canBeSaddled()`-gated), the armour icon (`hasArmorSlot()` -- always true for
   * `HorseEntity`, the only type this session builds, see `Gui.HORSE`'s own header), the two
   * equip + 36 player slots off the REAL `Mount.menu`, and the title. `InventoryScreen.
   * drawEntity` preview is `H.drawEntityPreview` (#5908), the animal's real posed quads rasterised in 2D.
   */
  H.drawHorse = function (c) {
    var g = NS.Gui, M = NS.Menu, Mnt = NS.Mount, m = H.horseMenu, e = H.horseEntity;
    if (!m || !e || e.dead || e.removed) { H.close(); return; }
    if (!g || !g.ready || !g.HORSE) { H.drawHorseFallback(c); return; }
    var V = g.HORSE, s = Math.max(2, H.scale);
    var ox = Math.round((H.w - V.w * s) * 0.5);
    var oy = Math.round((H.h - V.h * s) * 0.5);
    H.horseOrigin = { x: ox, y: oy, s: s };

    // D-550: the chest's COLUMN count (llama: its strength 1..5; donkey/mule 5), 0 for none.
    var chest = (Mnt.isChestable(e) && !!e.hasChest) ? Mnt.inventoryColumns(e) : 0;
    var total = (chest ? 2 + 3 * chest : 2) + 27 + 9;

    g.dim(c, H.w, H.h);
    g.blit(c, 'horse', [0, 0, V.w, V.h], ox, oy, s);
    if (Mnt.canBeSaddled(e) || Mnt.isSaddled(e)) {
      var si = V.saddleIcon;
      g.blit(c, 'horse', [si.u, si.v, si.w, si.h], ox + (V.saddle[0] - 1) * s, oy + (V.saddle[1] - 1) * s, s);
    }
    // `hasArmorSlot()` -- true only for `HorseEntity` (donkey/mule never override it, .decomp).
    // D-550: a llama's slot 1 is the carpet slot, drawn with `HorseScreen`'s llama icon (u=36).
    if (Mnt.hasArmorSlot(e) || Mnt.hasDecorSlot(e)) {
      var ai = Mnt.hasDecorSlot(e) ? V.llamaDecorIcon : V.armourIcon;
      g.blit(c, 'horse', [ai.u, ai.v, ai.w, ai.h], ox + (V.armour[0] - 1) * s, oy + (V.armour[1] - 1) * s, s);
    }
    // loop/donkey-s96 -- `HorseScreen.drawBackground`'s own chest-grid blit
    // (`drawTexture($$4+79,$$5+17,0,166,cols*18,rows*18)`, .decomp), gated the same way the
    // jar's own `hasChest($$3)` gates it: only when THIS mount actually has one attached.
    if (chest) {
      var ci = V.chest;
      // D-550: `getInventoryColumns() * 18` wide, at (79,17) exactly (the blit origin, not a slot).
      g.blit(c, 'horse', [ci.u, ci.v, chest * 18, ci.rows * 18], ox + ci.x * s, oy + ci.y * s, s);
    }

    // `HorseScreen.drawBackground`: InventoryScreen.drawEntity(x + 51, y + 60, 17, x + 51 - mouseX, y + 75 - 50 - mouseY, horse)
    if (NS.Input) H.drawEntityPreview(c, e, ox + 51 * s, oy + 60 * s, 17 * s, ox + 51 * s - NS.Input.mx, oy + 25 * s - NS.Input.my, s);
    c.font = Math.max(9, Math.round(9 * s / 2)) + 'px ' + UIFONT;
    g.text(c, H.displayName(e.type, false), ox + V.title.x * s, oy + V.title.y * s, s, 0x3F3F3F, false);

    var hover = NS.Input ? g.horseSlotAt((NS.Input.mx - ox) / s, (NS.Input.my - oy) / s, chest) : -1;
    for (var i = 0; i < total; i++) {
      var p = g.horseSlotXY(i, chest);
      var sx = ox + p[0] * s, sy = oy + p[1] * s;
      if (i === hover) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(sx, sy, 16 * s, 16 * s); }
      var st = M.slotGet(m.slots[i]);
      if (st) H.drawItem(c, st, sx, sy, 16 * s);
    }

    var carried = M.getCarried(m);
    if (carried && NS.Input) H.drawItem(c, carried, NS.Input.mx - 8 * s, NS.Input.my - 8 * s, 16 * s);
    if (hover >= 0 && !carried) {
      var hs = M.slotGet(m.slots[hover]);
      if (hs && !NS.Inventory.isEmpty(hs)) {
        H.drawStackTooltip(c, hs, s);
      }
    }
  };

  /** A click inside the horse screen. Same `ClickType` shape as `H.chestClick`. */
  H.horseClick = function (mx, my, button, shift) {
    var M = NS.Menu, m = H.horseMenu, P = NS.Player, Mnt = NS.Mount;
    if (!M || !m) return false;
    var o = H.horseOrigin;
    var chest = (m.horse && Mnt && Mnt.isChestable(m.horse) && m.horse.hasChest) ? Mnt.inventoryColumns(m.horse) : 0;   // D-550
    var slot = (o && mx >= 0) ? NS.Gui.horseSlotAt((mx - o.x) / o.s, (my - o.y) / o.s, chest) : -1;
    var b = button === 2 ? 1 : 0;
    if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);
    else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);
    else M.doClick(m, slot, b, M.PICKUP, P);
    if (P && P.syncHotbar) P.syncHotbar();
    return true;
  };

  H.open = function (name) {
    H.screen = name;
    H.needClick = false;
    NS.Input.uiOpen = true;
    NS.Input.clearToggles();
    NS.Input.releaseLock();
  };

  /** Write the open cart screen's converted copy back to the cart (vanilla's screen edits the live list). */
  H.syncCart = function () {
    var cb = H.screen === 'chest' ? H.chestMenu && H.chestMenu.be : H.screen === 'hopper' ? H.hopperCartBe : null;
    if (!cb || !cb.cart) return null;
    var cI = NS.Inventory;
    cb.cart.inventory = cb.items.map(function (st) {
      return cI.isEmpty(st) ? null : { item: NS.Items.nameOf(st.i), count: st.n, tag: st.t || undefined };
    });
    return cb.cart;
  };
  /** Called before the cart scatters/dies: flush the screen into it, then close (canPlayerUse turns false). */
  H.cartGone = function (e) {
    var c = H.syncCart();
    if (c && c === e) { e.removed = true; H.close(); e.removed = false; }
  };

  H.close = function () {
    // PASS 17 JOB 1 — leaving the chest screen does not touch its 27 stacks (the container IS
    // `be.items`, not a copy of it, so `chestcheck`'s close/reopen test can catch a regression
    // that starts editing a copy); it only drops the "somebody has this open" count vanilla's
    // own block entity keeps (`be.open`, defined in `07c_blockentity.js`, unused until now).
    H.syncCart();
    if (H.screen === 'chest' && H.chestMenu && H.chestMenu.be) {
      H.chestMenu.be.open = Math.max(0, (H.chestMenu.be.open || 0) - 1);
      if (H.chestMenu.be.type === 'barrel' && BE0().barrelSync) BE0().barrelSync(H.chestMenu.be);
      var be2 = H.chestMenu.be2;                    // D-413: a double chest counted BOTH halves open
      if (be2) be2.open = Math.max(0, (be2.open || 0) - 1);
    }
    // ⚠ `CraftingMenu.removed`/`clearContainer` — UNLIKE a chest's own storage, the crafting
    // table's 3x3 grid lives only in this menu (D-355's `Hud.openCraftingTable` builds a fresh
    // one every open), so whatever is still sitting in it when the screen closes has to go back
    // to the player rather than vanish. Each occupied cell is cleared and pushed through the
    // SAME container-return path a slot-outside-the-window drop already uses (`Menu.drop`,
    // exported alongside `craftingTaken` for exactly this caller).
    if (H.screen === 'stonecutter' && H.stonecutterMenu) {   // `ScreenHandler.close`: output removed, input dropped
      var sm = H.stonecutterMenu, SI = NS.Inventory, SP = NS.Player;
      var sin = sm.input.get(0);
      sm.output.set(0, null);
      if (sin && SI && !SI.isEmpty(sin)) {
        sm.input.set(0, null);
        if (SI.add(sm.inventory, sin) > 0 && NS.Menu.drop) NS.Menu.drop(sm, sin, SP);
      }
    }
    if (H.screen === 'grindstone' && H.grindMenu) {       // `ScreenHandler.close` -> dropInventory
      var gm = H.grindMenu, GI = NS.Inventory, GP = NS.Player;
      for (var ggi = 0; ggi < 2; ggi++) {
        var ggs = gm.input.get(ggi);
        if (ggs && GI && !GI.isEmpty(ggs)) {
          gm.input.set(ggi, null);
          if (GI.add(gm.inventory, ggs) > 0 && NS.Menu.drop) NS.Menu.drop(gm, ggs, GP);
        }
      }
    }
    if (H.screen === 'loom' && H.loomMenu) {            // `ScreenHandler.close` -> dropInventory
      var lm = H.loomMenu, LI = NS.Inventory, LP = NS.Player;
      for (var lgi = 0; lgi < 3; lgi++) {
        var lgs = lm.input.get(lgi);
        if (lgs && LI && !LI.isEmpty(lgs)) {
          lm.input.set(lgi, null);
          if (LI.add(lm.inventory, lgs) > 0 && NS.Menu.drop) NS.Menu.drop(lm, lgs, LP);
        }
      }
    }
    if (H.screen === 'cartography' && H.cartMenu) {      // `ScreenHandler.close` -> dropInventory
      var km = H.cartMenu, KI = NS.Inventory, KP = NS.Player;
      for (var kgi = 0; kgi < 2; kgi++) {
        var kgs = km.input.get(kgi);
        if (kgs && KI && !KI.isEmpty(kgs)) {
          km.input.set(kgi, null);
          if (KI.add(km.inventory, kgs) > 0 && NS.Menu.drop) NS.Menu.drop(km, kgs, KP);
        }
      }
    }
    if (H.screen === 'crafting' && H.craftingMenu) {
      var cm = H.craftingMenu, CI = NS.Inventory, CM = NS.Menu, CP = NS.Player;
      for (var cgi = 0; cgi < 9; cgi++) {
        var cgs = cm.grid.get(cgi);
        if (cgs && CI && !CI.isEmpty(cgs)) {
          cm.grid.set(cgi, null);
          if (CI.add(cm.inventory, cgs) > 0 && CM && CM.drop) CM.drop(cm, cgs, CP);
        }
      }
    }
    H.craftingMenu = null;
    H.craftingOrigin = null;
    // G22d: `AnvilScreenHandler.close` -> `dropInventory`: the two inputs go back to the player.
    if (H.screen === 'anvil' && H.anvilMenu) {
      var am = H.anvilMenu, AI = NS.Inventory, AM = NS.Menu, AP = NS.Player;
      for (var agi = 0; agi < 2; agi++) {
        var ags = am.inC.get(agi);
        if (ags && !AI.isEmpty(ags)) {
          am.inC.set(agi, null);
          if (AI.add(am.inventory, ags) > 0 && AM.drop) AM.drop(am, ags, AP);
        }
      }
      var acar = AM.getCarried(am);
      if (acar && !AI.isEmpty(acar)) { AM.setCarried(am, null); if (AI.add(am.inventory, acar) > 0 && AM.drop) AM.drop(am, acar, AP); }
    }
    H.anvilMenu = null;
    H.anvilOrigin = null;
    H.anvilPos = null;
    // D-414: nothing to hand back — a furnace's three slots are the block entity's own, so leaving
    // the screen only lets go of the window onto them.
    // PLAN G22: the table's two slots are the MENU's own (`SimpleInventory(2)`), so they go back to the player
    if (H.screen === 'enchanting' && H.enchantMenu && NS.Menu) NS.Menu.enchantClose(H.enchantMenu, NS.Player);
    H.enchantMenu = null;
    H.enchantOrigin = null;
    H.enchantPos = null;
    H.enchantBook = null;
    H.furnaceMenu = null;
    H.furnaceOrigin = null;
    H.furnacePos = null;
    H.brewingMenu = null;
    H.brewingOrigin = null;
    H.brewingPos = null;
    H.grindMenu = null;
    H.grindOrigin = null;
    H.chestMenu = null;
    H.chestPos = null;
    H.hopperCartBe = null;
    H.horseMenu = null;
    H.horseEntity = null;
    H.horseOrigin = null;
    if (H.tradingEntity && NS.Trade && NS.Trade.clearSpecialPrices) NS.Trade.clearSpecialPrices(H.tradingEntity);
    if (H.tradeMenu && NS.Trade) NS.Trade.menuClose(H.tradeMenu);   // MerchantScreenHandler.close -> offerOrDrop
    H.tradeMenu = null;
    NS.Player.currentScreenHandler = null;
    if (H.tradingEntity && NS.WT && NS.WT.setCustomer) NS.WT.setCustomer(H.tradingEntity, null);   // trade screen closed
    H.tradingEntity = null;
    H.tradeMsg = null;
    H.screen = null;
    NS.Input.uiOpen = false;
    H.needClick = !NS.Input.locked;
    NS.Input.requestLock();
  };

  H.toggle = function (name) {
    if (H.screen === name) H.close();
    else H.open(name);
  };

  /** Route a click into the current screen. Returns true when something consumed it. */
  H.click = function (mx, my, button, now) {
    // Screen.handleTextClick: a left click on a clickEvent span of the open chat
    if (button === 0 && NS.Chat && NS.Chat.open && NS.Chat.handleClick(mx / H.scale, my / H.scale, H.h / H.scale, NS.Main && NS.Main.playerName)) return true;
    // vanilla sends CLONE for a middle click only in creative and otherwise nothing at all
    if (button === 1 && H.screen && H.screen !== 'creative') return true;
    // G11: the inventory screen is not a list of buttons — every click is a `ClickType` for
    // G8's machine, so it is routed before the generic hit-rect walk below.
    if (H.screen === 'inventory') {
      var I = NS.Input;
      var shift = !!(I && (I.down('ShiftLeft') || I.down('ShiftRight')));
      H.inventoryClick(mx, my, button | 0, shift, now);
      return true;
    }

    if (H.screen === 'pause' && NS.Options && NS.Options.screen) {
      NS.Options.click(mx, my, button | 0);
      return true;
    }
    if (H.screen === 'creative') {
      var I2 = NS.Input;
      var sh2 = !!(I2 && (I2.down('ShiftLeft') || I2.down('ShiftRight')));
      H.creativeClick(mx, my, button | 0, sh2);
      return true;
    }
    if (H.screen === 'chest') {
      var I3 = NS.Input;
      var sh3 = !!(I3 && (I3.down('ShiftLeft') || I3.down('ShiftRight')));
      H.chestClick(mx, my, button | 0, sh3);
      return true;
    }
    if (H.screen === 'crafting') {
      var I4 = NS.Input;
      var sh4 = !!(I4 && (I4.down('ShiftLeft') || I4.down('ShiftRight')));
      H.craftingClick(mx, my, button | 0, sh4);
      return true;
    }
    if (H.screen === 'furnace') {
      var I5 = NS.Input;
      var sh5 = !!(I5 && (I5.down('ShiftLeft') || I5.down('ShiftRight')));
      H.furnaceClick(mx, my, button | 0, sh5);
      return true;
    }
    if (H.screen === 'anvil') {
      var I8 = NS.Input;
      var sh8 = !!(I8 && (I8.down('ShiftLeft') || I8.down('ShiftRight')));
      H.anvilClick(mx, my, button | 0, sh8);
      return true;
    }
    if (H.screen === 'enchanting') {
      var I5e = NS.Input;
      H.enchantClick(mx, my, button | 0, !!(I5e && (I5e.down('ShiftLeft') || I5e.down('ShiftRight'))));
      return true;
    }
    if (H.screen === 'hopper') {
      var I6 = NS.Input;
      var sh6 = !!(I6 && (I6.down('ShiftLeft') || I6.down('ShiftRight')));
      H.hopperClick(mx, my, button | 0, sh6);
      return true;
    }
    if (H.screen === 'dispenser') {
      var I7 = NS.Input;
      var sh7 = !!(I7 && (I7.down('ShiftLeft') || I7.down('ShiftRight')));
      H.dispenserClick(mx, my, button | 0, sh7);
      return true;
    }
    if (H.screen === 'brewing') {
      var I9 = NS.Input;
      var sh9 = !!(I9 && (I9.down('ShiftLeft') || I9.down('ShiftRight')));
      H.brewingClick(mx, my, button | 0, sh9);
      return true;
    }
    if (H.screen === 'loom') {
      var I12 = NS.Input;
      H.loomClick(mx, my, button | 0, !!(I12 && (I12.down('ShiftLeft') || I12.down('ShiftRight'))));
      return true;
    }
    if (H.screen === 'stonecutter') { H.stonecutterClick(mx, my, button | 0, !!(NS.Input && (NS.Input.down('ShiftLeft') || NS.Input.down('ShiftRight')))); return true; }
    if (H.screen === 'cartography') {
      var I11 = NS.Input;
      H.cartographyClick(mx, my, button | 0, !!(I11 && (I11.down('ShiftLeft') || I11.down('ShiftRight'))));
      return true;
    }
    if (H.screen === 'grindstone') {
      var I10 = NS.Input;
      H.grindstoneClick(mx, my, button | 0, !!(I10 && (I10.down('ShiftLeft') || I10.down('ShiftRight'))));
      return true;
    }
    if (H.screen === 'horse') {
      var I8 = NS.Input;
      var sh8 = !!(I8 && (I8.down('ShiftLeft') || I8.down('ShiftRight')));
      H.horseClick(mx, my, button | 0, sh8);
      return true;
    }
    // The title screen is a mode, not a `screen` - there is no world behind it to fall
    // through to - so it routes clicks the same way but on its own condition.
    if (H.mode === 'title') {
      H.titleSeedFocus = false;
      for (var t = H.hit.length - 1; t >= 0; t--) {
        var q = H.hit[t];
        if (mx >= q.x && mx <= q.x + q.w && my >= q.y && my <= q.y + q.h) { q.fn(); return true; }
      }
      return true;
    }
    if (!H.screen) return false;
    for (var i = H.hit.length - 1; i >= 0; i--) {
      var r = H.hit[i];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) { r.fn(); return true; }
    }
    return true;    // clicks inside a modal screen never fall through to the world
  };

  H.scroll = function (dy) {
    if (H.screen === 'loom') H.loomScroll = (H.loomScroll | 0) + (dy > 0 ? 1 : -1);
    else if (H.screen === 'trading' && H.tradeMenu) NS.Trade.menuScroll(H.tradeMenu, dy > 0 ? -1 : 1);
    else if (H.screen === 'inventory') H.invScroll += dy > 0 ? 1 : -1;
    else if (H.screen === 'stonecutter' && H.stonecutterMenu && H.stonecutterMenu.recipes.length > 12) {   // `mouseScrolled`
      var smax = ((H.stonecutterMenu.recipes.length + 3) >> 2) - 3;
      H.stonecutterScroll = Math.max(0, Math.min(smax, (H.stonecutterScroll | 0) + (dy > 0 ? 1 : -1)));
    }
    else if (H.screen === 'creative' && NS.Creative && NS.Creative.canScroll()) {
      NS.Creative.scroll += dy > 0 ? 1 : -1;
      NS.Creative.clampScroll();
    }
  };
})(MCL);
