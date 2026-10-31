// 15j_ss.js — `/ss` and F2: ONE file with the screenshot AND the evidence (#1890; Dan, 3 Oct).
//
// Dan: "the ocean animals glitch is still there, and so is the culling glitch ... /ss is an ongoing
// issue, it will make it so much easier". Four audits and two live-browser probes could not
// reproduce either bug headless, so the game itself has to say what Dan's screen shows. Pressing F2
// (vanilla's screenshot key) or typing `/ss` saves ONE `.png`: the frame as drawn (3D + HUD) with the
// debug dump embedded in it as a PNG `tEXt` chunk named `mclite-dump`. One file to send; `node
// tools/ssread.mjs <file.png>` prints the dump.
//
// ⚠ THE SCREENSHOT IS TAKEN INSIDE THE FRAME. A WebGL canvas without preserveDrawingBuffer is
// cleared once the frame is composited, so `toBlob` anywhere else returns a blank image. The request
// only sets a flag; `Main.loop` calls `SS.afterFrame()` right after `Gfx.render` + `Hud.draw`, in the
// same task, and the pixels are copied into a 2D canvas there.
//
// ⚠ `/ss` IS NOT A BRIGADIER COMMAND. It is handled in `Chat.send` before `Commands.run`, because
// `commandcheck` holds the command table to vanilla's 74 and a debug command is not one of them.
//
// WHAT THE DUMP CARRIES (the fields workers kept guessing at):
//   * world: seed, climate mode and scale, player pose, game tick, fps, backend, render distance;
//   * every entity within 32 blocks: position, previous position, velocity, onGround, inWater, age,
//     the blocks at its feet / above / below, AND the y the renderer draws it at this frame
//     (`EntityRender.posAt` at `Main.partial()`) next to e.y — so "spawns midair" splits into a spawn
//     bug and a render bug;
//   * a ring of the first-tick records of the last 60 spawned mobs (spawn pos, blocks around it, the
//     y on its first three frames);
//   * the crosshair block AND the first non-air cell on the look ray (water surfaces are not
//     targetable): the 3x3x3 around it, and for each of its 6 faces the neighbour, the mesher's own
//     cull decision from its own tables (`States.cull`, `selfCull`, `waterIn`, fluid kinds — the rule at
//     05_mesher.js), the sky/block light on the neighbour, and the facts needed to compare with
//     vanilla's shouldDrawSide offline;
//   * the section/chunk state under that cell and the four neighbour chunks: meshed bit, dirty bit,
//     mesh generation, vis mask, loaded state.
(function (NS) {
  'use strict';

  var SS = NS.SS = {
    RING_CAP: 60,
    NEAR: 32,
    ring: [],            // first-tick records of recently spawned entities
    pending: null,       // { why, at } — set by request(), taken by afterFrame()
    last: null,          // { name, dump, bytes } of the most recent capture
    saved: 0,
    errors: []
  };

  var FACE_NAMES = ['+x', '-x', '+y', '-y', '+z', '-z'];        // 05_mesher.js FACE_AXIS order
  var FACE_VEC = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  function r2(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v * 1000) / 1000 : v; }
  function num(v) { return typeof v === 'number' ? r2(v) : null; }
  function flo(v) { return Math.floor(v); }

  function names(st) {
    var S = NS.States, R = NS.Reg;
    if (!st) return 'air';
    try { return (R && R.names && S && S.block ? R.names[S.block[st]] : null) || ('state#' + st); }
    catch (e) { return 'state#' + st; }
  }
  function blockAt(x, y, z) {
    try { return NS.World.getBlock(x, y, z); } catch (e) { return 0; }
  }
  function lightAt(x, y, z) {
    try { var l = NS.World.getLight(x, y, z); return { sky: (l >> 4) & 15, block: l & 15 }; }
    catch (e) { return null; }
  }
  function around(e) {
    var x = flo(e.x), y = flo(e.y), z = flo(e.z);
    return { feet: names(blockAt(x, y, z)), above: names(blockAt(x, y + 1, z)), below: names(blockAt(x, y - 1, z)) };
  }

  // ── first-tick ring ────────────────────────────────────────────────────────────────────────
  // Wrapped at load: every spawn path (natural, chunk-gen, spawner, egg, command, structure) ends in
  // EntityList.spawn, which is how the live probes saw them all.
  function hookSpawn() {
    var EL = NS.EntityList;
    if (!EL || typeof EL.spawn !== 'function' || EL.spawn.__ss) return;
    var orig = EL.spawn;
    var wrapped = function () {
      var e = orig.apply(this, arguments);
      try {
        if (e && typeof e.x === 'number') {
          var rec = { tick: EL.ticks, type: e.type, id: e.id, x: r2(e.x), y: r2(e.y), z: r2(e.z),
                      inWater: !!e.inWater, ys: [r2(e.y)], lastTick: EL.ticks };
          var a = around(e); rec.feet = a.feet; rec.above = a.above; rec.below = a.below;
          SS.ring.push(rec);
          if (SS.ring.length > SS.RING_CAP) SS.ring.shift();
        }
      } catch (err) { SS.errors.push('ring: ' + String(err && err.message || err)); }
      return e;
    };
    wrapped.__ss = true;
    EL.spawn = wrapped;
  }
  hookSpawn();

  // y on the first three TICKS after spawn, sampled from the frame loop (afterFrame runs per frame)
  function sampleRing() {
    var EL = NS.EntityList;
    if (!EL || !SS.ring.length) return;
    for (var i = SS.ring.length - 1; i >= 0; i--) {
      var rec = SS.ring[i];
      if (rec.ys.length >= 4) break;
      if (EL.ticks === rec.lastTick) continue;
      var e = EL.byId ? EL.byId(rec.id) : null;
      if (!e) { rec.ys.push('removed'); rec.lastTick = EL.ticks; continue; }
      rec.ys.push(r2(e.y)); rec.lastTick = EL.ticks;
    }
  }

  // ── the mesher's own cull decision for one face of one cell ───────────────────────────────────
  // The rule is read from the same tables the mesher uses (05_mesher.js ~lines 452-509). It is
  // EVALUATED here, not copied into the mesher, so a worker can diff it against vanilla's
  // shouldDrawSide offline; the raw facts (opaque, layer, geom) are in each record for that.
  function faceDecision(id, nid, face, aboveId) {
    var SR = NS.States;
    if (!SR || !SR.cull) return { verdict: 'unknown', why: 'States tables missing' };
    var rec = { cullsBit: (SR.cull[nid] >> face) & 1, nbOpaque: SR.opaque ? SR.opaque[nid] : null,
                geom: SR.geom ? SR.geom[id] : null, selfCull: SR.selfCull ? SR.selfCull[id] : null,
                waterInBoth: !!(SR.waterIn && SR.waterIn[id] && SR.waterIn[nid]) };
    if (!id) { rec.verdict = 'air'; return rec; }
    if (SR.geom && SR.geom[id] !== 1) { rec.verdict = 'model path'; rec.why = 'baked model, not a cube: faces come from emitModelBlock (cullface), not the cube rule'; return rec; }
    var fCell = SR.fluidCell, fKind = SR.fluidKind;
    if (fCell && fCell[id]) {
      rec.fluidKind = fKind[id]; rec.nbFluidKind = fKind[nid];
      if (fKind[aboveId] !== fKind[id]) { rec.verdict = 'fluid pass'; rec.why = 'no same fluid above: drawn by meshFluidCell (sloped top, per-face rules there)'; return rec; }
      if (fKind[nid] === fKind[id]) { rec.verdict = 'culled'; rec.why = 'same fluid kind on the neighbour'; return rec; }
    }
    if (rec.cullsBit) { rec.verdict = 'culled'; rec.why = 'neighbour covers this face (SR.cull bit)'; return rec; }
    if (nid === id && SR.selfCull && SR.selfCull[id]) { rec.verdict = 'culled'; rec.why = 'selfCull: identical neighbour'; return rec; }
    if (rec.waterInBoth) { rec.verdict = 'culled'; rec.why = 'water against another water-holding cell'; return rec; }
    rec.verdict = 'drawn';
    return rec;
  }

  function cellInfo(x, y, z) {
    var st = blockAt(x, y, z), SR = NS.States;
    return { pos: [x, y, z], state: st, name: names(st), light: lightAt(x, y, z),
             opaque: SR && SR.opaque ? SR.opaque[st] : null, layer: SR && SR.layer ? SR.layer[st] : null };
  }

  function chunkAt(cx, cz) {
    var W = NS.World, c = null;
    try {
      if (W.chunks && W.chunks.get) c = W.chunks.get(W.key ? W.key(cx, cz) : (cx + ',' + cz));
      if (!c && W.getChunk) c = W.getChunk(cx, cz);
    } catch (e) { c = null; }
    return c || null;
  }

  function sectionInfo(x, y, z) {
    var W = NS.World, CFGv = NS.CFG, out = { cell: [x, y, z] };
    try {
      var cx = x >> 4, cz = z >> 4, sy = (y - CFGv.WORLD_MIN_Y) >> 4;
      var c = chunkAt(cx, cz);
      out.chunk = [cx, cz]; out.section = sy;
      if (!c) { out.loaded = false; return out; }
      out.loaded = true; out.state = c.state;
      out.meshed = !!(c.meshed && (c.meshed[0] & (1 << sy)));
      out.dirty = !!(c.meshDirty && (c.meshDirty[0] & (1 << sy)));
      out.meshGen = c.meshGen ? c.meshGen[sy] : null;
      out.vis = c.vis ? (c.vis[sy] !== undefined ? c.vis[sy] : null) : null;
      out.neighbours = {};
      var nbs = [[1, 0, '+x'], [-1, 0, '-x'], [0, 1, '+z'], [0, -1, '-z']];
      for (var i = 0; i < nbs.length; i++) {
        var n = chunkAt(cx + nbs[i][0], cz + nbs[i][1]);
        out.neighbours[nbs[i][2]] = n ? { state: n.state, meshed: !!(n.meshed && (n.meshed[0] & (1 << sy))) } : null;
      }
    } catch (err) { out.error = String(err && err.message || err); }
    return out;
  }

  function focusReport(x, y, z) {
    var rep = { cell: cellInfo(x, y, z), section: sectionInfo(x, y, z), faces: {}, neighbourhood: [] };
    var id = rep.cell.state, aboveId = blockAt(x, y + 1, z);
    for (var f = 0; f < 6; f++) {
      var v = FACE_VEC[f], nx = x + v[0], ny = y + v[1], nz = z + v[2], nid = blockAt(nx, ny, nz);
      var d = faceDecision(id, nid, f, aboveId);
      d.neighbour = cellInfo(nx, ny, nz);
      d.neighbourSection = sectionInfo(nx, ny, nz);
      rep.faces[FACE_NAMES[f]] = d;
    }
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) for (var dz = -1; dz <= 1; dz++) {
      var c = cellInfo(x + dx, y + dy, z + dz);
      rep.neighbourhood.push([dx, dy, dz, c.name, c.state, c.light ? c.light.sky : null, c.light ? c.light.block : null]);
    }
    return rep;
  }

  // ── was each section DRAWN this frame, and if not, which rule hid it? ──────────────────────────────
  // Dan's "black rectangle" (3 Oct): a block-aligned void in the ocean whose sections ARE meshed, lit and
  // clean in the dump. Three things can hide a meshed section: the visibility flood (Gfx.floodHas — cave
  // culling over the `vis` masks), the frustum (Gfx.sectionVisible), or no buffer yet. This map says which,
  // for a (2R+1)^2 block of chunks around the camera on the camera's own section row and the two below it
  // (the sea floor). Legend per cell: D drawn · F hidden by the visibility FLOOD · X outside the frustum
  // · N loaded but NOT meshed (no buffer) · . chunk not loaded.
  SS.GRID_R = 10;
  function sectionDrawReport() {
    var G = NS.Gfx, W = NS.World, CFGv = NS.CFG, cam = G.cam, out = { occlusion: G.occlusion !== false,
      counters: { drawn: G.drawn, culled: G.culled, occluded: G.occluded, visited: G.visited, drawnListed: G.drawnListed },
      legend: 'D drawn, F hidden by visibility flood, X outside frustum, N loaded but not meshed, . not loaded; row = z, col = x',
      grids: [] };
    var camCx = flo(cam.x) >> 4, camCz = flo(cam.z) >> 4, camSy = (flo(cam.y) - CFGv.WORLD_MIN_Y) >> 4;
    out.camera = { cx: camCx, cz: camCz, sy: camSy };
    var R = SS.GRID_R;
    for (var sy = camSy; sy >= Math.max(0, camSy - 2); sy--) {
      var rows = [];
      for (var cz = camCz - R; cz <= camCz + R; cz++) {
        var row = '';
        for (var cx = camCx - R; cx <= camCx + R; cx++) {
          var c = chunkAt(cx, cz), ch = '.';
          if (c) {
            if (!(c.meshed && (c.meshed[0] & (1 << sy)))) ch = 'N';
            else if (G.floodHas && G.occlusion !== false && !G.floodHas(camCx, camCz, cx, cz, sy)) ch = 'F';
            else if (G.sectionVisible && !G.sectionVisible(cx, cz, sy)) ch = 'X';
            else ch = 'D';
          }
          row += ch;
        }
        rows.push(row);
      }
      out.grids.push({ sy: sy, yMin: CFGv.WORLD_MIN_Y + sy * 16, x0: (camCx - R) * 16, z0: (camCz - R) * 16, rows: rows });
    }
    return out;
  }

  // ── the dump ─────────────────────────────────────────────────────────────────────────────────
  SS.collect = function (why) {
    var P = NS.Player, W = NS.World, G = NS.Gfx, H = NS.Hud, EL = NS.EntityList, ER = NS.EntityRender;
    var d = { tool: 'mclite /ss', version: 1, why: why || 'manual', takenAt: new Date().toISOString() };
    var sect = function (name, fn) { try { d[name] = fn(); } catch (err) { d[name] = { error: String(err && err.message || err) }; } };

    sect('world', function () {
      var gp = NS.Gen && NS.Gen.params || {};
      return { seed: W.seed, seed64: W.seed64 !== undefined ? String(W.seed64) : null,
               climate: gp.climate || null, worldScale: gp.worldScale || null,
               version: NS.VERSION || null, chunks: W.chunks && W.chunks.size, stats: W.stats ? W.stats() : null };
    });
    sect('player', function () {
      return { x: num(P.x), y: num(P.y), z: num(P.z), eyeX: num(P.ex), eyeY: num(P.ey), eyeZ: num(P.ez),
               yaw: num(P.yaw), pitch: num(P.pitch), flying: !!P.flying, onGround: !!P.onGround,
               inWater: !!P.inWater, gamemode: NS.Gamemode && NS.Gamemode.current ? String(NS.Gamemode.current) : null };
    });
    sect('timing', function () {
      return { mainTicks: NS.Main ? NS.Main.ticks : null, entityTicks: EL ? EL.ticks : null,
               fps: H ? num(H.fps) : null, partial: NS.Main && NS.Main.partial ? num(NS.Main.partial()) : null,
               gameTime: W.time !== undefined ? W.time : null };
    });
    sect('gfx', function () {
      var o = { backend: G.name || null, renderDistance: NS.Settings ? NS.Settings.renderDistance : null,
                width: G.width, height: G.height, dpr: typeof window !== 'undefined' ? window.devicePixelRatio : null,
                cam: G.cam ? { x: num(G.cam.x), y: num(G.cam.y), z: num(G.cam.z) } : null };
      try {
        var gl = G.canvas && G.name === 'webgl2' ? G.canvas.getContext('webgl2') : null;
        var ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) { o.gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)); o.gpuVendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)); }
      } catch (e) { o.gpu = 'unavailable'; }
      return o;
    });
    sect('entitiesNear', function () {
      var out = [], list = EL && EL.all ? EL.all() : [], partial = NS.Main && NS.Main.partial ? NS.Main.partial() : 1;
      var buf = [0, 0, 0];
      for (var i = 0; i < list.length; i++) {
        var e = list[i], dx = e.x - P.x, dz = e.z - P.z, dy = e.y - P.y;
        if (dx * dx + dy * dy + dz * dz > SS.NEAR * SS.NEAR) continue;
        var a = around(e), rr = ER && ER.posAt ? ER.posAt(e, partial, buf) : [null, null, null];
        out.push({ type: e.type, id: e.id, x: num(e.x), y: num(e.y), z: num(e.z), px: num(e.px), py: num(e.py), pz: num(e.pz),
                   vx: num(e.vx), vy: num(e.vy), vz: num(e.vz), onGround: !!e.onGround, inWater: !!e.inWater,
                   age: e.age !== undefined ? e.age : (e.tickCount !== undefined ? e.tickCount : null),
                   feet: a.feet, above: a.above, below: a.below,
                   renderedY: num(rr[1]), renderedMinusY: num(rr[1] - e.y), dist: num(Math.sqrt(dx * dx + dy * dy + dz * dz)) });
      }
      out.sort(function (p, q) { return p.dist - q.dist; });
      return { count: out.length, list: out };
    });
    sect('firstTickRing', function () { return { cap: SS.RING_CAP, records: SS.ring.slice() }; });
    sect('focus', function () {
      var f = { crosshairTarget: null, firstNonAir: null }, R = NS.Ray, look = P.lookVec ? P.lookVec() : null;
      if (P.hasTarget) f.crosshairTarget = Object.assign({ face: FACE_NAMES[P.tface] || P.tface }, focusReport(P.tx, P.ty, P.tz));
      if (R && R.cast && look) {
        var hit = R.cast(P.ex, P.ey + (P.eyeHeight || P.EYE || 1.62), P.ez, look[0], look[1], look[2], 24,
                         function (id) { return id !== 0; });
        if (hit) f.firstNonAir = Object.assign({ face: FACE_NAMES[hit.face] || hit.face, dist: num(hit.dist) },
                                               focusReport(hit.x, hit.y, hit.z));
      }
      return f;
    });
    sect('sectionDraw', sectionDrawReport);
    d.errors = SS.errors.slice(-10);
    return d;
  };

  // ── PNG with the dump embedded ───────────────────────────────────────────────────────────────
  var CRC_T = null;
  function crc32(u8, start, end) {
    if (!CRC_T) { CRC_T = new Int32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); CRC_T[n] = c; } }
    var crc = -1;
    for (var i = start; i < end; i++) crc = CRC_T[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
  }
  function latin1(str) {                                       // JSON.stringify output with every non-ASCII char escaped
    return str.replace(/[\u007f-￿]/g, function (ch) { return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4); });
  }
  /** Insert a tEXt chunk (keyword\0text) straight after IHDR. `png` is a Uint8Array. */
  SS.embed = function (png, keyword, text) {
    var body = latin1(text), kw = keyword, len = kw.length + 1 + body.length;
    var chunk = new Uint8Array(12 + len), dv = new DataView(chunk.buffer), i, p = 8;
    dv.setUint32(0, len);
    chunk[4] = 116; chunk[5] = 69; chunk[6] = 88; chunk[7] = 116;               // 'tEXt'
    for (i = 0; i < kw.length; i++) chunk[p++] = kw.charCodeAt(i);
    chunk[p++] = 0;
    for (i = 0; i < body.length; i++) chunk[p++] = body.charCodeAt(i) & 255;
    dv.setUint32(8 + len, crc32(chunk, 4, 8 + len));
    var at = 33;                                                                // 8 signature + 25 IHDR chunk
    var out = new Uint8Array(png.length + chunk.length);
    out.set(png.subarray(0, at), 0); out.set(chunk, at); out.set(png.subarray(at), at + chunk.length);
    return out;
  };
  /** Read the dump back out of a PNG (used by tools/ssread.mjs and sscheck). */
  SS.extract = function (png, keyword) {
    var dv = new DataView(png.buffer, png.byteOffset, png.byteLength), pos = 8;
    while (pos + 8 <= png.length) {
      var len = dv.getUint32(pos), type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
      if (type === 'tEXt') {
        var s = '', i = pos + 8, end = pos + 8 + len;
        while (i < end && png[i] !== 0) s += String.fromCharCode(png[i++]);
        if (s === keyword) { var t = ''; for (i++; i < end; i++) t += String.fromCharCode(png[i]); return t; }
      }
      if (type === 'IEND') break;
      pos += 12 + len;
    }
    return null;
  };

  // ── request / capture / download ─────────────────────────────────────────────────────────────
  SS.request = function (why) { SS.pending = { why: why || 'manual', at: Date.now() }; return true; };

  // ScreenshotRecorder.getScreenshotFilename: SimpleDateFormat("yyyy-MM-dd_HH.mm.ss") local time, then "_2", "_3"... while taken.
  // A page cannot pick a folder (vanilla: <run>/screenshots); the browser's download folder stands in for it.
  SS.used = {};
  SS.fileName = function (d) {
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var base = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '_' + p2(d.getHours()) + '.' + p2(d.getMinutes()) + '.' + p2(d.getSeconds());
    var n = 1, name;
    while (SS.used[name = base + (n === 1 ? '' : '_' + n) + '.png']) n++;
    SS.used[name] = true; return name;
  };
  /** lang screenshot.success = "Saved screenshot as %s" (the file name is the underlined clickable part in vanilla). */
  SS.successText = function (name) { return 'Saved screenshot as ' + name; };
  SS.failureText = function (msg) { return "Couldn't save screenshot: " + msg; };

  function say(msg) {
    try { var C = NS.Chat, T = NS.Text; if (C && C.add) C.add(T ? T.literal(msg) : { text: msg }); } catch (e) { /* chat is optional */ }
  }

  function download(name, bytes) {
    var blob = new Blob([bytes], { type: 'image/png' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) { /* gone */ } }, 4000);
  }

  function finish(why, dump, blob) {
    blob.arrayBuffer().then(function (ab) {
      var json = JSON.stringify(dump);
      var bytes = SS.embed(new Uint8Array(ab), 'mclite-dump', json);
      var name = SS.fileName(new Date());
      SS.last = { name: name, dump: dump, bytes: bytes };
      SS.saved++;
      if (typeof document !== 'undefined' && !SS.noDownload) download(name, bytes);
      try { console.log('[/ss] saved ' + name + ' (' + bytes.length + ' bytes, dump ' + json.length + ' chars)'); } catch (e) { /* no console */ }
      say(SS.successText(name));
      if (why !== 'F2') try {
        var f = dump.focus && (dump.focus.crosshairTarget || dump.focus.firstNonAir), en = dump.entitiesNear;
        var lines = ['[/ss] dump inside the picture: ' + (dump.gfx && dump.gfx.backend) + ', seed ' + (dump.world && dump.world.seed)
          + ', ' + (en ? en.count : 0) + ' entities within ' + SS.NEAR + ', ' + dump.firstTickRing.records.length + ' first-tick records'];
        if (f) {
          var fv = []; for (var k in f.faces) fv.push(k + ' ' + f.faces[k].verdict);
          lines.push('[/ss] looking at ' + f.cell.name + ' ' + f.cell.pos.join(',') + ': ' + fv.join(', ')
            + '; section ' + (f.section.meshed ? 'meshed' : 'NOT meshed') + (f.section.dirty ? ', dirty' : ''));
        }
        for (var li = 0; li < lines.length; li++) say(lines[li]);
      } catch (e) { /* the summary is a courtesy */ }
    }, function (err) { SS.errors.push('png: ' + String(err && err.message || err)); say('[/ss] could not read the screenshot back'); });
  }

  /** Called by Main.loop right after Gfx.render + Hud.draw, same task: the GL buffer is still intact. */
  SS.afterFrame = function () {
    try { sampleRing(); } catch (e) { SS.errors.push('sample: ' + String(e && e.message || e)); }
    var req = SS.pending;
    if (!req) return;
    SS.pending = null;
    try {
      var G = NS.Gfx, H = NS.Hud, src = G.canvas;
      var cv = document.createElement('canvas');
      cv.width = src.width; cv.height = src.height;
      var g = cv.getContext('2d');
      g.drawImage(src, 0, 0);
      if (H && H.canvas && H.canvas.width) g.drawImage(H.canvas, 0, 0, cv.width, cv.height);
      var dump = SS.collect(req.why);
      dump.image = { width: cv.width, height: cv.height, backendCanvas: G.name };
      cv.toBlob(function (blob) {
        if (!blob) { SS.errors.push('toBlob returned null'); say('[/ss] screenshot failed (blank canvas)'); return; }
        finish(req.why, dump, blob);
      }, 'image/png');
    } catch (err) { SS.errors.push('capture: ' + String(err && err.message || err)); say('[/ss] failed: ' + String(err && err.message || err)); }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', function (e) {
      if (e.code === 'F2') { SS.request('F2'); e.preventDefault(); }
    });
  }
})(MCL);
