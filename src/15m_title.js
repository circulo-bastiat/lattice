// MC-Lite — #11228: the vanilla TITLE SCREEN. Port of net/minecraft/client/gui/screen/TitleScreen (1.18.2, .decomp) and
// RotatingCubeMapRenderer. Layout is pure (GUI pixels, no DOM) so titlescreencheck can compare it with the decomp.
//   y0 = height/4 + 48;  Singleplayer / Multiplayer / Minecraft Realms: 200x20 at width/2-100, y0 + 24*i
//   bottom row at y0+72+12:  language 20x20 @ w/2-124, Options... 98 @ w/2-100, Quit Game 98 @ w/2+2, accessibility 20x20 @ w/2+104
//   logo at (w/2-137, 30) two 155x44 halves, edition (98x14) at +88,67, splash at (w/2+90, 70) rotated -20 deg, version at (2,h-10),
//   copyright right-aligned at (w-tw-2, h-10).
// Singleplayer opens the create-world panel (Hud.drawCreateWorld) until the world list lands (separate unit); Options.../language/
// accessibility open the existing NS.Options screens; Quit Game is a browser ruling (docs/decisions/11228-title-screen.md).
(function (NS) {
  'use strict';
  var T = NS.Title = {};
  T.COPYRIGHT = 'Copyright Mojang AB. Do not distribute!';
  T.VERSION = 'Minecraft 1.18.2';
  T.LABELS = { singleplayer: 'Singleplayer', multiplayer: 'Multiplayer', realms: 'Minecraft Realms', options: 'Options...', quit: 'Quit Game' };
  // The jar's six panorama faces are 1x1 stubs of this one colour (0,98,111,113 = RGB 98,111,113), the overlay is transparent.
  T.PANORAMA_RGB = [98, 111, 113];
  T.time = 0;            // RotatingCubeMapRenderer.time, in ticks
  T.lastMs = 0;
  T.splash = null;
  T.quitting = false;

  T.pitch = function () { return Math.sin(T.time * 0.001) * 5 + 25; };
  T.yaw = function () { return -T.time * 0.1; };

  /** TitleScreen.init(): every widget as {id,label,x,y,w,h,kind,active} in GUI pixels. */
  T.layout = function (gw, gh) {
    var y0 = Math.floor(gh / 4) + 48, cx = Math.floor(gw / 2), L = T.LABELS, by = y0 + 72 + 12;
    var cw = (NS.Gui && NS.Gui.textWidth) ? NS.Gui.textWidth(T.COPYRIGHT) : T.COPYRIGHT.length * 6;
    return [
      { id: 'singleplayer', label: L.singleplayer, x: cx - 100, y: y0, w: 200, h: 20, active: true },
      { id: 'multiplayer', label: L.multiplayer, x: cx - 100, y: y0 + 24, w: 200, h: 20, active: false },
      { id: 'realms', label: L.realms, x: cx - 100, y: y0 + 48, w: 200, h: 20, active: false },
      { id: 'language', label: 'Language', x: cx - 124, y: by, w: 20, h: 20, active: true, icon: true },
      { id: 'options', label: L.options, x: cx - 100, y: by, w: 98, h: 20, active: true },
      { id: 'quit', label: L.quit, x: cx + 2, y: by, w: 98, h: 20, active: true },
      { id: 'accessibility', label: 'Accessibility Settings', x: cx + 104, y: by, w: 20, h: 20, active: true, icon: true },
      { id: 'copyright', label: T.COPYRIGHT, x: gw - cw - 2, y: gh - 10, w: cw, h: 10, active: true, text: true }
    ];
  };

  /** SplashTextLoader.get(): the date specials, else a random line of splashes.txt. */
  T.pickSplash = function (date, rnd) {
    var d = date || new Date(), m = d.getMonth() + 1, day = d.getDate();
    if (m === 12 && day === 24) return 'Merry X-mas!';
    if (m === 1 && day === 1) return 'Happy new year!';
    if (m === 10 && day === 31) return 'OOoooOOOoooo! Spooky!';
    var L = (NS.Gui && NS.Gui.splashes) || [];
    return L.length ? L[Math.floor((rnd ? rnd() : Math.random()) * L.length)] : null;
  };

  T.open = function () {
    var H = NS.Hud;
    H.titleView = 'main';
    T.splash = T.pickSplash();
    T.lastMs = 0; T.fadeStart = 0;
  };

  /** Quit Game. A page cannot close itself unless a script opened it: try, and if the tab survives show the closed screen. */
  T.quit = function () {
    T.quitting = true;
    NS.Hud.titleView = 'quit';
    try { window.close(); } catch (e) { /* the closed screen is the answer */ }
  };

  T.press = function (id) {
    var H = NS.Hud, O = NS.Options;
    if (id === 'singleplayer') { H.titleSeedFocus = false; if (NS.SelectWorld) NS.SelectWorld.open(); else H.titleView = 'create'; }
    else if (id === 'options') { O.open('options'); H.titleView = 'options'; }
    else if (id === 'language') { O.open('language'); H.titleView = 'options'; }
    else if (id === 'accessibility') { O.open('accessibility'); H.titleView = 'options'; }
    else if (id === 'quit') T.quit();
    else if (id === 'copyright') NS.Credits.open();   // multiplayer/realms are inactive (no networking)
  };

  // ---- #11265: RotatingCubeMapRenderer + CubeMapRenderer. Six faces (fov 85, pitch sin(t*0.001)*5+25, yaw -t*0.1, modelview RX(180)*RX(pitch)*RY(yaw)),
  // rasterised per pixel at low resolution (a ray -> face lookup, nearest) and scaled up smoothed, which stands in for the 4 offset blur passes.
  // Faces come from MCL.PanoramaData (tools/gen-panorama.mjs); all 1x1 stubs -> faces null -> the stub fill, state 'stubbed'.
  var QUADS = [[[-1, -1, 1], [2, 0, 0], [0, 2, 0]], [[1, -1, 1], [0, 0, -2], [0, 2, 0]], [[1, -1, -1], [-2, 0, 0], [0, 2, 0]],
    [[-1, -1, -1], [0, 0, 2], [0, 2, 0]], [[-1, -1, -1], [2, 0, 0], [0, 0, 2]], [[-1, 1, 1], [2, 0, 0], [0, 0, -2]]];
  var PLANE = [[2, 1], [0, 1], [2, -1], [0, -1], [1, -1], [1, 1]];   // face -> [axis, sign] of the plane it lies in
  T.faces = null;            // [{w,h,d:Uint8ClampedArray RGBA}] x6
  T.panoramaState = 'loading';   // 'loading' | 'real' | 'test' | 'stubbed'
  T.fadeStart = 0;
  var scratch = null, sctx = null, simg = null, overlayImg = null;

  /** Install six decoded faces ({w,h,d}); anything 1x1 is a stub and counts as none. */
  T.setFaces = function (f, state) {
    if (!f || f.length !== 6) { T.faces = null; T.panoramaState = 'stubbed'; return false; }
    for (var i = 0; i < 6; i++) if (!f[i] || f[i].w < 2 || f[i].h < 2) { T.faces = null; T.panoramaState = 'stubbed'; return false; }
    T.faces = f; T.panoramaState = state || 'real'; return true;
  };
  T.loadPanorama = function () {
    var D = NS.PanoramaData;
    if (!D || !D.faces) { T.panoramaState = 'stubbed'; return; }
    var out = [], left = 6, bad = false;
    D.faces.forEach(function (u, i) {
      var im = new Image();
      im.onload = function () {
        var cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
        var cx = cv.getContext('2d'); cx.drawImage(im, 0, 0);
        out[i] = { w: im.width, h: im.height, d: cx.getImageData(0, 0, im.width, im.height).data };
        if (--left === 0 && !bad) T.setFaces(out, 'real');
      };
      im.onerror = function () { bad = true; T.panoramaState = 'stubbed'; };
      im.src = u;
    });
    if (D.overlay) { overlayImg = new Image(); overlayImg.src = D.overlay; }
  };
  if (typeof Image !== 'undefined' && typeof document !== 'undefined') T.loadPanorama();

  T.tick = function () {
    var now = Date.now();
    if (T.lastMs) T.time += Math.min(0.25, (now - T.lastMs) / 1000) * 20;
    T.lastMs = now;
    return now;
  };

  /** Render the cube map into the low-res scratch image. */
  T.renderCube = function (rw, rh, pitchDeg, yawDeg) {
    var F = T.faces, tf = Math.tan(85 * Math.PI / 360), asp = rw / rh;
    var cp = Math.cos(pitchDeg * Math.PI / 180), sp = Math.sin(pitchDeg * Math.PI / 180), cy = Math.cos(yawDeg * Math.PI / 180), sy = Math.sin(yawDeg * Math.PI / 180);
    // M = RX180 * RX(p) * RY(y); world = M^T * viewDir
    var RX = [1, 0, 0, 0, cp, -sp, 0, sp, cp], RY = [cy, 0, sy, 0, 1, 0, -sy, 0, cy], R180 = [1, 0, 0, 0, -1, 0, 0, 0, -1];
    var mul = function (A, B) { var o = []; for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) o.push(A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]); return o; };
    var M = mul(R180, mul(RX, RY)), data = simg.data;
    for (var y = 0; y < rh; y++) {
      var py = (1 - (y + 0.5) / rh * 2) * tf;
      for (var x = 0; x < rw; x++) {
        var px = ((x + 0.5) / rw * 2 - 1) * tf * asp, dx = px, dy = py, dz = -1;
        var wx = M[0] * dx + M[3] * dy + M[6] * dz, wy = M[1] * dx + M[4] * dy + M[7] * dz, wz = M[2] * dx + M[5] * dy + M[8] * dz;
        var ax = Math.abs(wx), ay = Math.abs(wy), az = Math.abs(wz), f, k;
        if (az >= ax && az >= ay) { f = wz > 0 ? 0 : 2; k = 1 / az; }
        else if (ax >= ay) { f = wx > 0 ? 1 : 3; k = 1 / ax; }
        else { f = wy < 0 ? 4 : 5; k = 1 / ay; }
        var qx = wx * k, qy = wy * k, qz = wz * k, Q = QUADS[f], o = Q[0], U = Q[1], V = Q[2];
        var rx = qx - o[0], ry = qy - o[1], rz = qz - o[2];
        var u = (rx * U[0] + ry * U[1] + rz * U[2]) / 4, v = (rx * V[0] + ry * V[1] + rz * V[2]) / 4;
        var fc = F[f], fx = Math.min(fc.w - 1.001, Math.max(0, u * fc.w - 0.5)), fy = Math.min(fc.h - 1.001, Math.max(0, v * fc.h - 0.5));   // bilinear: soft, never blocky
        var x0 = fx | 0, y0 = fy | 0, ex = fx - x0, ey = fy - y0, fd = fc.d;
        var i00 = (y0 * fc.w + x0) * 4, i10 = i00 + 4, i01 = i00 + fc.w * 4, i11 = i01 + 4;
        var w00 = (1 - ex) * (1 - ey), w10 = ex * (1 - ey), w01 = (1 - ex) * ey, w11 = ex * ey, di = (y * rw + x) * 4;
        data[di] = fd[i00] * w00 + fd[i10] * w10 + fd[i01] * w01 + fd[i11] * w11;
        data[di + 1] = fd[i00 + 1] * w00 + fd[i10 + 1] * w10 + fd[i01 + 1] * w01 + fd[i11 + 1] * w11;
        data[di + 2] = fd[i00 + 2] * w00 + fd[i10 + 2] * w10 + fd[i01 + 2] * w01 + fd[i11 + 2] * w11;
        data[di + 3] = 255;
      }
    }
  };

  T.drawPanorama = function (c, w, h) {
    T.tick();
    if (!T.fadeStart) T.fadeStart = Date.now();
    if (!T.faces) {   // stub fill: every face is a 1x1 of one colour (see PANORAMA_RGB), so the honest picture is that colour
      var rgb = T.PANORAMA_RGB;
      c.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      c.fillRect(0, 0, w, h);
      return;
    }
    var rw = Math.min(640, Math.max(64, Math.round(w / 3))), rh = Math.max(36, Math.round(rw * h / w));
    if (!scratch || scratch.width !== rw || scratch.height !== rh) {
      scratch = document.createElement('canvas'); scratch.width = rw; scratch.height = rh;
      sctx = scratch.getContext('2d'); simg = sctx.createImageData(rw, rh);
    }
    T.renderCube(rw, rh, T.pitch(), T.yaw());
    sctx.putImageData(simg, 0, 0);
    var a = Math.min(1, Math.max(0, (Date.now() - T.fadeStart) / 1000));   // TitleScreen: fade-in over 1000 ms, over black
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    c.save(); c.globalAlpha = a; c.imageSmoothingEnabled = true; c.drawImage(scratch, 0, 0, w, h);
    if (overlayImg && overlayImg.complete && overlayImg.naturalWidth > 1) c.drawImage(overlayImg, 0, 0, w, h);
    c.restore();
  };

  T.draw = function (c, w, h, s) {
    var g = NS.Gui, O = NS.Options, H = NS.Hud;
    var now = Date.now();
    var gw = w / s, gh = h / s;
    T.drawPanorama(c, w, h);
    var lx = Math.floor(gw / 2) - 137;
    g.blit(c, 'title_logo', [0, 0, 155, 44], lx * s, 30 * s, s);
    g.blit(c, 'title_logo', [0, 45, 155, 44], (lx + 155) * s, 30 * s, s);
    g.blit(c, 'title_edition', [0, 0, 98, 14], (lx + 88) * s, 67 * s, s);
    if (T.splash) {
      var sc = 1.8 - Math.abs(Math.sin((now % 1000) / 1000 * Math.PI * 2) * 0.1);
      sc = sc * 100 / (g.textWidth(T.splash) + 32);
      c.save();
      c.translate((Math.floor(gw / 2) + 90) * s, 70 * s);
      c.rotate(-20 * Math.PI / 180);
      c.scale(sc, sc);
      g.text(c, T.splash, -g.textWidth(T.splash) / 2 * s, -8 * s, s, 0xFFFF00, true);
      c.restore();
    }
    g.text(c, T.VERSION, 2 * s, (gh - 10) * s, s, 0xFFFFFF, true);
    var I = NS.Input, mx = I ? I.mx : -1e9, my = I ? I.my : -1e9;
    var L = T.layout(gw, gh);
    for (var i = 0; i < L.length; i++) {
      var e = L[i], x = e.x * s, y = e.y * s, bw = e.w * s, bh = e.h * s;
      var hov = e.active && mx >= x && mx < x + bw && my >= y && my < y + bh;
      if (e.text) {
        g.text(c, e.label, x, y, s, hov ? 0xFFFF55 : 0xFFFFFF, true);   // PressableTextWidget
      } else if (e.icon) {
        if (e.id === 'language') g.blit(c, 'widgets', [0, 106 + (hov ? 20 : 0), 20, 20], x, y, s);
        else g.blit(c, 'accessibility', [0, hov ? 20 : 0, 20, 20], x, y, s);
      } else {
        O.drawButton(c, e.x, e.y, e.w, e.label, !e.active ? 'disabled' : hov ? 'hover' : 'normal', s, 0, 0);
      }
      if (e.active) H.hit.push({ x: x, y: y, w: bw, h: bh, fn: (function (id) { return function () { T.press(id); }; })(e.id), label: e.label, id: e.id });
      else H.hit.push({ x: x, y: y, w: bw, h: bh, fn: function () {}, label: e.label, id: e.id, disabled: true });
    }
  };

  T.drawQuit = function (c, w, h, s) {
    var g = NS.Gui;
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    var m = 'Minecraft has closed. You can close this tab.';
    g.text(c, m, (w - g.textWidth(m) * s) / 2, h / 2 - 4 * s, s, 0xFFFFFF, true);
  };
})(MCL);
