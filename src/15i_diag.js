// 15i_diag.js — THE F4 DIAGNOSTICS OVERLAY (D-431), ported from MineHTML.
//
// Dan, session 55: *"move what is currently linked to f4 to f7, and add in f4 what we have in
// f4 in claudeisthegoat."* This is MineHTML's `#diagOverlay`: the three-column panel, the
// frame-time graph, the frame-budget bar, the bottleneck verdict, the jitter-source line, the
// live console tail, the Observable entity profiler with its tabs, and the stutter tracker —
// with MineHTML's own CSS, its keys (F4 toggle, PgUp/PgDn scroll, Tab cycles the entity tab,
// Del clears the log) and its colour thresholds.
//
// ⚠⚠ **WHAT IS PORTED IS THE PANEL, NOT THE ROWS.** MineHTML's rows name MineHTML's internals —
// `Weather / Hunger / Combat CD / Shield / Farming / Fluids / Scheduled / Furnaces` in a 20 Hz
// bundle, a per-status worldgen ladder, a decoration breakdown. Transcribing those names into
// MC-Lite would give a panel of `--`s that looks like a diagnostic and diagnoses nothing. The
// rows here are the phases MC-Lite actually has and already measures (`Main.prof`, `Gfx`,
// `World.stats()`, `Jobs.stats()`), which is the same panel doing the same job on this engine.
//
// ⚠ IT IS DOM, AND EVERYTHING ELSE IN THIS PROJECT'S UI IS CANVAS. On purpose, and it is why
// this file is `15i` and not part of `15_hud.js`: the HUD is drawn INTO the frame and costs
// frame time to draw, and a panel whose whole job is to measure frame time must not be in it.
// A DOM overlay is composited by the browser, outside `Gfx.render`, and updates at whatever
// rate it likes. It also means the panel's own cost shows up in `loop lag` rather than hiding
// inside `hud` — which is honest, and was worth the split on its own.
//
// ⚠ THE OVERLAY IS `pointer-events:none` AND CANNOT BE SCROLLED WITH THE MOUSE. That is
// MineHTML's own note, and it is deliberate twice over: a click must never be eaten by a panel
// that covers the whole screen, and the pointer is LOCKED while you play, so a scrollbar here
// would be decoration. The keyboard is the only input that works, hence PgUp/PgDn.
//
// ⚠ NO EXTERNAL ANYTHING (D-12 constraint 1): the stylesheet is a `<style>` this file writes,
// the graph is a `<canvas>` it creates, and every element is built by `document.createElement`.
// Nothing is fetched and nothing is in the HTML shell, so the module can be deleted in one
// piece and the shipped file is unchanged apart from its own bytes.
//
// OWED, NAMED:
//   * MineHTML's "3D overlay (green→red)" checkbox tints entities IN THE WORLD by cost.
//     MC-Lite's renderer has no per-entity tint channel to hang that on, so the checkbox is not
//     drawn rather than drawn dead (D-426's own rule, one file over).
//   * MineHTML's RECORD/EXPORT buttons write a perf trace to a downloaded JSON. Downloading
//     from a `file://` page is a different problem from the panel, and is not in this port.

(function (NS) {
  'use strict';

  var D = NS.Diag = {
    ready: false,
    open: false,
    scroll: 0,
    tab: 'agg',            // 'agg' | 'ind' | 'chunk'
    logs: [],
    openedAt: 0,
    framesSinceOpen: 0,
    worstSinceOpen: 0,
    dropsSinceOpen: 0,
    spikes: 0,
    worstSpike: 0,
    lastSpikeAt: 0,
    lastSpikeWhat: ''
  };

  D.LOG_CAP = 120;
  D.SPIKE_MS = 50;         // a frame this long is a spike worth naming
  D.HZ = 6;                // the panel repaints AT MOST this many times a second, never every frame
  D.BUDGET = 0.03;         // ...and never more than this share of wall time, whatever it costs
  D.MAX_INTERVAL = 1000;   // ...but never slower than once a second, whatever it costs
  D.interval = 1000 / 6;   // derived from the three above and the measured repaint cost
  D.paintMs = undefined;   // the MEDIAN measured cost of one repaint (see D.update)
  D._costs = [];           // the last sixteen repaint costs, for that median

  /**
   * ⚠ MineHTML's own stylesheet, adapted only where an id changed. The numbers are deliberately
   * ITS numbers — 10px at 1.4 line height, `rgba(8,8,12,0.92)` on `#2a2a32`, the
   * `#5dd35d / #f1b24a / #ef5f5f` good/warn/bad ramp — because the point of the port is that
   * the two projects' F4 looks and reads the same. MC-Lite ships no pixel font, so the family
   * falls back to the monospace stack the rest of this engine's debug text uses.
   */
  var CSS = [
    '#mclDiag{position:fixed;top:8px;left:50%;transform:translateX(-50%);',
    '  width:min(1440px,97vw);z-index:61;pointer-events:none;',
    '  max-height:calc(100vh - 16px);overflow:hidden;',
    '  font-family:ui-monospace,Consolas,"DejaVu Sans Mono",monospace;font-size:10px;line-height:1.4;',
    '  background:rgba(8,8,12,0.92);border:1px solid #2a2a32;border-radius:3px;',
    '  display:none;color:#cfd2da;box-shadow:0 2px 18px rgba(0,0,0,.7);contain:layout paint style;will-change:transform;}',
    '#mclDiag.active{display:block;}',
    '.dov-head{display:flex;align-items:center;gap:12px;padding:8px 16px;',
    '  border-bottom:1px solid #2a2a32;background:rgba(255,255,255,.03);}',
    '.dov-title{color:#fff;font-size:13px;letter-spacing:1px;flex:1;}',
    '.dov-key{color:#6a6f7a;font-size:9px;border:1px solid #3a3f48;padding:3px 6px;border-radius:2px;}',
    '.dov-badge{font-size:9px;padding:3px 7px;border-radius:2px;border:1px solid #2f6e3f;background:rgba(0,80,0,.35);color:#6f6;}',
    '.dov-cols{display:flex;align-items:flex-start;gap:0;}',
    '.dov-col{flex:1;min-width:0;padding:10px 14px;max-height:calc(100vh - 70px);',
    '  overflow:hidden;position:relative;contain:layout paint;}',
    '.dov-col>*{position:relative;top:calc(var(--dovScroll, 0) * -1px);}',
    '.dov-col+.dov-col{border-left:1px solid #20242c;}',
    '.dov-sec{color:#7d8492;font-size:9px;letter-spacing:1px;margin:12px 0 4px;border-bottom:1px solid #20242c;padding-bottom:3px;}',
    '.dov-col>.dov-sec:first-child{margin-top:0;}',
    '.dov-row{display:flex;justify-content:space-between;padding:2px 0;gap:12px;contain:layout paint style;}',
    '.dov-row span:first-child{color:#9098a4;}',
    '.dov-val{color:#cfd2da;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}',
    '.dov-val.good{color:#5dd35d;}.dov-val.warn{color:#f1b24a;}.dov-val.bad{color:#ef5f5f;}',
    '.dov-row.dov-sub span:first-child{padding-left:8px;color:#7d8492;}',
    '.dov-fpsrow{display:flex;align-items:center;gap:14px;margin-bottom:8px;}',
    '.dov-fpsbig{font-size:30px;line-height:1;color:#5dd35d;min-width:72px;}',
    '.dov-fpsbig.warn{color:#f1b24a;}.dov-fpsbig.bad{color:#ef5f5f;}',
    '#mclDiagGraph{border:1px solid #20242c;background:rgba(0,0,0,.35);display:block;image-rendering:pixelated;}',
    '.dov-mmrow{display:flex;justify-content:space-between;font-size:9px;color:#8089a4;margin-top:4px;}',
    '.dov-mmrow b{color:#aeb6c4;}',
    '.dov-membar{height:8px;background:rgba(255,255,255,.06);border:1px solid #20242c;margin-top:6px;overflow:hidden;}',
    '#mclDiagMem{height:100%;width:0%;background:linear-gradient(90deg,#3a82d6,#5dd3c8);}',
    '.dov-budgetbar{display:flex;height:10px;border:1px solid #20242c;overflow:hidden;background:rgba(0,0,0,.35);}',
    '.dov-budgetbar i{display:block;height:100%;}',
    '.dov-budgetleg{display:flex;flex-wrap:wrap;gap:8px;font-size:8px;color:#8089a4;margin-top:4px;}',
    '.dov-budgetleg b{display:inline-block;width:7px;height:7px;margin-right:3px;}',
    '#mclDiagBN{margin:10px 0 0;padding:7px 8px;font-size:9px;text-align:center;border:1px solid;border-radius:2px;}',
    '#mclDiagBN.none{background:rgba(0,60,0,.4);border-color:#0a0;color:#5dd35d;}',
    '#mclDiagBN.cpu{background:rgba(100,60,0,.4);border-color:#f1b24a;color:#f1b24a;}',
    '#mclDiagBN.gpu{background:rgba(80,0,80,.4);border-color:#c87ff0;color:#c87ff0;}',
    '#mclDiagBN.mem{background:rgba(0,40,100,.4);border-color:#5a9ff0;color:#5a9ff0;}',
    '#mclDiagBN.draw{background:rgba(100,0,0,.4);border-color:#f05a5a;color:#f05a5a;}',
    '#mclDiagJitter{margin:8px 0 0;padding:7px 8px;font-size:9px;line-height:1.7;text-align:left;',
    '  border:1px solid #3a3f48;border-radius:2px;background:rgba(255,255,255,.03);color:#f1b24a;}',
    '#mclDiagLog{margin:0;max-height:150px;overflow:hidden;font-size:9px;line-height:1.6;',
    '  border-top:1px solid #20242c;padding-top:6px;}',
    '.clog-error{color:#ef5f5f;}.clog-warn{color:#f1b24a;}.clog-info{color:#7d8492;}',
    '.dov-obshead{display:flex;align-items:center;}',
    '.dov-obstabs{margin-left:auto;display:flex;gap:6px;}',
    '.dov-obstab{font-size:9px;font-family:inherit;color:#7d8492;background:rgba(255,255,255,.04);',
    '  border:1px solid #2a2f38;padding:3px 8px;border-radius:2px;letter-spacing:1px;}',
    '.dov-obstab.on{color:#cfe7ff;border-color:#3a6e8f;background:rgba(40,90,120,.32);}',
    '.dov-obsbody{margin-top:4px;}',
    '.dov-obsempty{color:#6a6f7a;font-size:9px;padding:3px 0;}',
    '.dov-obsrow{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:9px;border-top:1px solid #181b21;}',
    '.dov-obstrack{flex:0 0 52px;height:8px;background:rgba(255,255,255,.05);border-radius:1px;overflow:hidden;}',
    '.dov-obsbar{height:100%;border-radius:1px;}',
    '.dov-obsname{color:#cfd2da;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.dov-obsnum{color:#8089a4;font-variant-numeric:tabular-nums;}'
  ].join('\n');

  // ── the rows, declared once ───────────────────────────────────────────────────────────────
  // ⚠ A TABLE, NOT A HUNDRED LINES OF `createElement`. Every row is `[id, label, sub?]` and the
  // builder walks it, so adding a row is one line and the layout cannot drift between the
  // builder and the updater — the two read the same list.
  var COL1 = [
    ['sec', 'TIMING'],
    ['frame', 'Frame'], ['js', 'JS / sim'], ['render', 'Render'], ['hud', 'HUD'],
    ['lag', 'Loop lag'], ['drops', 'Frame drops (>33ms)'],
    ['sec', 'FRAME BUDGET (of 16.7ms)'],
    ['budget', ''],
    ['sec', 'PHASE BREAKDOWN (avg / max ms)'],
    ['pfTick', 'World tick (20Hz)', 1], ['pfStream', 'Stream + light', 1],
    ['pfRender', 'Render', 1], ['pfHud', 'HUD / UI', 1], ['pfLag', 'Unaccounted', 1]
  ];
  var COL2 = [
    ['sec', 'GPU'],
    ['draws', 'Draw calls'], ['tris', 'Triangles'], ['mtris', 'Model triangles'],
    ['sections', 'Sections'], ['culled', 'Culled'], ['binds', 'Binds'],
    ['uploads', 'Upload queue'], ['arenas', 'Arenas'], ['gpuName', 'GPU'],
    ['sec', 'WORLD'],
    ['xyz', 'XYZ'], ['block', 'Block'], ['chunkPos', 'Chunk'], ['facing', 'Facing'],
    ['speed', 'Speed'], ['pstate', 'State'], ['biome', 'Biome'], ['light', 'Light'],
    ['time', 'Time / day'], ['chunks', 'Chunks'], ['ent', 'Entities'],
    ['rd', 'Render dist'], ['seed', 'Seed'], ['worldMem', 'World bytes'],
    ['sec', 'STREAMING'],
    ['gen', 'Gen in flight', 1], ['mesh', 'Mesh in flight', 1], ['evicted', 'Evicted', 1],
    ['cancelled', 'Cancelled', 1], ['load', 'Budget load', 1], ['snap', 'Snapshots r/a', 1],
    ['sec', 'WORKERS'],
    ['wkMode', 'Pool'], ['wkFlight', 'In flight / queued'], ['wkRetire', 'Retiring'],
    ['sec', 'SPIKES'],
    ['spkN', 'Count'], ['spkWorst', 'Worst'], ['spkSince', 'Since last'], ['spkWhat', 'Looked like'],
    ['sec', 'STUTTER — SINCE F4 OPENED'],
    ['stFrames', 'Frames', 1], ['stWorst', 'Worst frame', 1], ['stDrops', 'Drops', 1],
    ['sec', 'MEMORY'],
    ['mem', 'JS heap'], ['membar', '']
  ];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function buildRows(col, rows, into) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r[0] === 'sec') { col.appendChild(el('div', 'dov-sec', r[1])); continue; }
      if (r[0] === 'budget') {
        var bb = el('div', 'dov-budgetbar'); bb.id = 'mclDiagBudget';
        var bl = el('div', 'dov-budgetleg'); bl.id = 'mclDiagBudgetLeg';
        col.appendChild(bb); col.appendChild(bl);
        continue;
      }
      if (r[0] === 'membar') {
        var mb = el('div', 'dov-membar'), fill = el('div');
        fill.id = 'mclDiagMem';
        mb.appendChild(fill); col.appendChild(mb);
        continue;
      }
      var row = el('div', 'dov-row' + (r[2] ? ' dov-sub' : ''));
      row.appendChild(el('span', null, r[1]));
      var v = el('span', 'dov-val', '--');
      row.appendChild(v);
      col.appendChild(row);
      into[r[0]] = v;
    }
  }

  D.init = function () {
    if (D.ready || !NS.ENV.hasWindow || typeof document === 'undefined') return D;

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var root = el('div');
    root.id = 'mclDiag';
    var head = el('div', 'dov-head');
    head.appendChild(el('span', 'dov-title', 'MC-Lite'));
    D.backendBadge = el('span', 'dov-badge', '—');
    head.appendChild(D.backendBadge);
    head.appendChild(el('span', 'dov-key', 'F4 toggle · PgUp/PgDn scroll'));
    head.appendChild(el('span', 'dov-key', 'Tab cycle tab'));
    head.appendChild(el('span', 'dov-key', 'Del clear log'));
    // ⚠ THE PANEL REPORTS ITS OWN COST, because it is the one number in here that this panel
    // is responsible for and the one a reader would otherwise never think to doubt.
    D.selfCost = el('span', 'dov-key', 'panel —');
    head.appendChild(D.selfCost);
    root.appendChild(head);

    var cols = el('div', 'dov-cols');
    D.v = {};

    // column 1 — FPS, the graph, the budget
    var c1 = el('div', 'dov-col');
    var fpsrow = el('div', 'dov-fpsrow');
    D.fpsBig = el('span', 'dov-fpsbig', '--');
    fpsrow.appendChild(D.fpsBig);
    D.graph = document.createElement('canvas');
    D.graph.id = 'mclDiagGraph';
    D.graph.width = 200; D.graph.height = 50;
    fpsrow.appendChild(D.graph);
    c1.appendChild(fpsrow);
    var mm1 = el('div', 'dov-mmrow'), mm2 = el('div', 'dov-mmrow');
    D.mm = {};
    ['min', 'avg', 'max'].forEach(function (k) {
      var s = el('span');
      s.appendChild(document.createTextNode(k + ' '));
      D.mm[k] = el('b', null, '--');
      s.appendChild(D.mm[k]); mm1.appendChild(s);
    });
    ['P95', 'P99', 'σ'].forEach(function (k) {
      var s = el('span');
      s.appendChild(document.createTextNode(k + ' '));
      D.mm[k] = el('b', null, '--');
      s.appendChild(D.mm[k]); mm2.appendChild(s);
    });
    c1.appendChild(mm1); c1.appendChild(mm2);
    buildRows(c1, COL1, D.v);
    cols.appendChild(c1);

    // column 2 — GPU, world, streaming, workers, memory, and the two verdicts
    var c2 = el('div', 'dov-col');
    buildRows(c2, COL2, D.v);
    D.jitter = el('div', null, 'JITTER SOURCE: collecting…');
    D.jitter.id = 'mclDiagJitter';
    D.bn = el('div', 'none', 'BOTTLENECK: NONE');
    D.bn.id = 'mclDiagBN';
    c2.appendChild(D.jitter); c2.appendChild(D.bn);
    cols.appendChild(c2);

    // column 3 — the Observable entity profiler and the console tail
    var c3 = el('div', 'dov-col');
    var oh = el('div', 'dov-sec dov-obshead');
    oh.appendChild(document.createTextNode('ENTITIES · OBSERVABLE'));
    var tabs = el('span', 'dov-obstabs');
    D.tabs = {};
    [['agg', 'Aggregate'], ['ind', 'Individual'], ['chunk', 'Chunks']].forEach(function (t) {
      var b = el('button', 'dov-obstab' + (t[0] === D.tab ? ' on' : ''), t[1]);
      b.style.pointerEvents = 'auto';
      b.addEventListener('click', function () { D.setTab(t[0]); });
      D.tabs[t[0]] = b;
      tabs.appendChild(b);
    });
    oh.appendChild(tabs);
    c3.appendChild(oh);
    var tot = el('div', 'dov-row');
    tot.appendChild(el('span', null, 'Total'));
    D.v.obsTotal = el('span', 'dov-val', '--');
    tot.appendChild(D.v.obsTotal);
    c3.appendChild(tot);
    D.obsBody = el('div', 'dov-obsbody');
    D.obsBody.appendChild(el('div', 'dov-obsempty', 'No entities.'));
    c3.appendChild(D.obsBody);
    c3.appendChild(el('div', 'dov-sec', 'CONSOLE'));
    D.log = el('div');
    D.log.id = 'mclDiagLog';
    c3.appendChild(D.log);
    cols.appendChild(c3);

    root.appendChild(cols);
    document.body.appendChild(root);
    D.root = root;

    D.hookConsole();
    D.attachKeys();
    D.ready = true;
    return D;
  };

  /**
   * ⚠ THE CONSOLE TAIL IS A WRAPPER, AND IT CALLS THROUGH. A panel that swallowed the real
   * `console.error` would make every other debugging tool in the project worse to make this one
   * work, so the original is kept and called first. `window.onerror` is hooked as well, because
   * the errors that matter most — the ones that kill the frame loop — never reach
   * `console.error` at all: they are thrown.
   */
  D.hookConsole = function () {
    if (typeof console === 'undefined' || D._hooked) return;
    D._hooked = true;
    ['error', 'warn', 'log'].forEach(function (kind) {
      var real = console[kind];
      if (typeof real !== 'function') return;
      console[kind] = function () {
        try { real.apply(console, arguments); } catch (e) {}
        D.push(kind === 'log' ? 'info' : kind, Array.prototype.join.call(arguments, ' '));
      };
    });
    if (NS.ENV.hasWindow) {
      window.addEventListener('error', function (e) {
        D.push('error', (e && e.message) || 'uncaught error');
      });
    }
  };

  /** ⚠ CAPPED AND DE-DUPED. A loop that logs the same line every frame would otherwise be the
   *  only thing in the panel, and the one error you wanted would be off the end of it. */
  D.push = function (kind, msg) {
    var m = String(msg);
    var last = D.logs[D.logs.length - 1];
    if (last && last.t === kind && last.m === m) { last.n = (last.n || 1) + 1; return; }
    D.logs.push({ t: kind, m: m, ts: Date.now(), n: 1 });
    if (D.logs.length > D.LOG_CAP) D.logs.shift();
  };

  D.setTab = function (t) {
    D.tab = t;
    for (var k in D.tabs) if (D.tabs[k]) D.tabs[k].className = 'dov-obstab' + (k === t ? ' on' : '');
  };

  /**
   * ⚠ F4 AND THE THREE KEYS THAT ONLY MEAN ANYTHING WHILE IT IS OPEN. They are attached here
   * rather than in `13_input.js` for the same reason `Gfx.attachDebugKeys` is: the input layer
   * does not have to know which modules exist. F-keys are safe because `13_input.js`
   * deliberately does not `preventDefault` on them.
   * ⚠ Tab and Delete are swallowed ONLY while the panel is open, so neither is taken away from
   * the game or from a text field the rest of the time.
   */
  D.attachKeys = function () {
    if (!NS.ENV.hasWindow) return;
    window.addEventListener('keydown', function (e) {
      if (e.code === 'F4') { D.toggle(); e.preventDefault(); return; }
      if (!D.open) return;
      if (e.code === 'PageUp') { D.scrollBy(-120); e.preventDefault(); }
      else if (e.code === 'PageDown') { D.scrollBy(120); e.preventDefault(); }
      else if (e.code === 'Tab') {
        var order = ['agg', 'ind', 'chunk'];
        D.setTab(order[(order.indexOf(D.tab) + 1) % order.length]);
        e.preventDefault();
      } else if (e.code === 'Delete') { D.logs.length = 0; e.preventDefault(); }
    }, { passive: false });
  };

  D.scrollBy = function (d) {
    D.scroll = Math.max(0, D.scroll + d);
    if (D.root) D.root.style.setProperty('--dovScroll', String(D.scroll));
  };

  D.toggle = function (on) {
    if (!D.ready) return false;
    D.open = (on === undefined) ? !D.open : !!on;
    D.root.classList.toggle('active', D.open);
    if (D.open) {
      // ⚠ THE STUTTER COUNTERS RESET ON OPEN, which is what "SINCE F4 OPENED" means. Dan opens
      // the panel when something felt wrong; a worst-frame number carried over from the loading
      // screen would answer a question he did not ask.
      D.openedAt = NS.U.now();
      D.framesSinceOpen = 0; D.worstSinceOpen = 0; D.dropsSinceOpen = 0;
      lastDraw = 0;                       // repaint on the very next frame, not up to a second later
      D._costs.length = 0; D.paintMs = undefined; D.firstPaintMs = undefined; D.interval = 1000 / D.HZ;
      D.scroll = 0;
      D.root.style.setProperty('--dovScroll', '0');
    }
    return D.open;
  };

  // ── the update ────────────────────────────────────────────────────────────────────────────
  var lastDraw = 0;

  function cls(v, good, warn) { return v <= good ? 'good' : (v <= warn ? 'warn' : 'bad'); }
  /**
   * ⚠⚠ **WRITE ONLY WHAT CHANGED — D-434.** The first version assigned `textContent` and
   * `className` on every one of the ~90 cells at every repaint. An assignment to an unchanged
   * value still dirties the node, and ninety dirty nodes inside a three-column flex panel is a
   * full layout of the panel — measured on Dan's real GPU by `diagcheck` §6 at **35.6% of a
   * frame**, which is the exact failure that section exists to catch. Comparing first costs a
   * string compare and skips the layout entirely.
   */
  function set(id, text, good, warn, num) {
    var e = D.v[id];
    if (!e) return;
    if (e.textContent !== text) e.textContent = text;
    var c = 'dov-val' +
      (good === undefined ? '' : ' ' + cls(num === undefined ? parseFloat(text) : num, good, warn));
    if (e.className !== c) e.className = c;
  }
  function setText(e, text) { if (e && e.textContent !== text) e.textContent = text; }
  function ms(p) { return p ? p.avg().toFixed(1) + ' / ' + p.max().toFixed(1) : '--'; }
  function fmtK(n) {
    return n >= 1000000 ? (n / 1000000).toFixed(2) + 'M' : (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n | 0));
  }

  /**
   * update(frameMs) — called every frame from `Main.loop`.
   *
   * ⚠⚠ **THE COUNTERS RUN EVERY FRAME AND THE DOM DOES NOT.** MineHTML's own version rolls its
   * history "even while closed, so the graph is full on open", and that half must be every
   * frame or the graph lies. Writing sixty DOM nodes sixty times a second, on the other hand,
   * is a measurable cost inside the thing being measured — so the panel repaints at `D.HZ`.
   * A diagnostic that changes what it is diagnosing is the one bug this file cannot have.
   */
  D.update = function (frameMs) {
    if (!D.ready) return;

    // the spike tracker runs whether or not the panel is open
    if (frameMs > D.SPIKE_MS) {
      D.spikes++;
      if (frameMs > D.worstSpike) D.worstSpike = frameMs;
      D.lastSpikeAt = NS.U.now();
      D.lastSpikeWhat = D.blame();
    }
    if (D.open) {
      D.framesSinceOpen++;
      if (frameMs > D.worstSinceOpen) D.worstSinceOpen = frameMs;
      if (frameMs > 33.3) D.dropsSinceOpen++;
    }
    if (!D.open) return;
    var now = NS.U.now();
    if (now - lastDraw < D.interval) return;
    lastDraw = now;
    // ⚠ A BROKEN PANEL MUST NEVER TAKE THE GAME DOWN. This runs inside the frame loop; an
    // exception here would stop `requestAnimationFrame` and look exactly like a crash in the
    // renderer. The throw goes into the panel's own console tail instead.
    var t0 = NS.U.now();
    try { D.paint(); } catch (e) { D.push('error', 'diag: ' + (e && e.message)); }
    var cost = NS.U.now() - t0;
    // ⚠⚠ **A MEDIAN, NOT A MOVING AVERAGE — D-434.** The panel is built once and then sits at
    // `display:none`, so the first repaint after the first F4 pays for the first LAYOUT of
    // ninety rows in three flex columns. Measured, with the layout forced between each:
    //     170.7, 0.9, 1.1, 0.9, 0.7, 0.8, 0.7, 0.8, 0.9 ms
    // One number three orders of magnitude off, and then the truth. An exponential average
    // seeded on that first sample read 89 ms for a panel costing one, and the back-off below
    // then slowed the panel to one repaint every nine seconds — a self-inflicted freeze, out of
    // a measurement that was true exactly once. A median over the last sixteen ignores it the
    // moment the ring fills, and still RISES if the panel ever genuinely gets slow, which an
    // average trimmed at the top would not.
    if (D.firstPaintMs === undefined) D.firstPaintMs = cost;
    D._costs.push(cost);
    if (D._costs.length > 16) D._costs.shift();
    var sorted = D._costs.slice().sort(function (a, b) { return a - b; });
    D.paintMs = sorted[sorted.length >> 1];
    // ⚠⚠ **THE PANEL PAYS FOR ITSELF OUT OF ITS OWN REFRESH RATE — D-434.** A fixed 6 Hz is a
    // fixed number of repaints a second and therefore a VARIABLE share of the frame: the same
    // repaint is a tenth of a frame at 60 fps and most of one at 9. Worse, the repaint itself
    // costs more on a machine that is doing well, because a machine that is doing well has a
    // bigger resident world to summarise — which is how this panel came to cost 35.6% of a frame
    // on Dan's desktop while measuring 5.7% in a headless container. So the interval is derived
    // from the measured cost: never more often than `HZ`, and never more than `BUDGET` of wall
    // time. A diagnostic that changes what it is diagnosing is the one bug this file cannot have,
    // and a fixed rate cannot promise that on hardware nobody has measured yet.
    // ⚠ AND IT IS CLAMPED AT BOTH ENDS. A panel that answers once every nine seconds is not a
    // diagnostic, however honest its arithmetic — so one spike can slow it down, never stop it.
    D.interval = Math.max(1000 / D.HZ, Math.min(D.MAX_INTERVAL, (D.paintMs || 0) / D.BUDGET));
  };

  /** Which phase owned the frame — the one-word answer the spike line gives. */
  D.blame = function () {
    var p = NS.Main && NS.Main.prof;
    if (!p) return '—';
    var best = 'loop lag', v = p.lag.last || 0;
    if ((p.tick.last || 0) > v) { best = 'world tick'; v = p.tick.last; }
    if ((p.stream.last || 0) > v) { best = 'chunk streaming'; v = p.stream.last; }
    if ((p.render.last || 0) > v) { best = 'render'; v = p.render.last; }
    if ((p.hud.last || 0) > v) { best = 'HUD'; v = p.hud.last; }
    return best + ' (' + v.toFixed(1) + ' ms)';
  };

  D.paint = function () {
    var M = NS.Main, p = M && M.prof, G = NS.Gfx, W = NS.World, S = NS.Settings, P = NS.Player;
    var H = NS.Hud;
    if (!p) return;

    // ── header / FPS ────────────────────────────────────────────────────────
    var fps = H ? H.fps : 0;
    setText(D.fpsBig, fps.toFixed(0));
    var fcls = 'dov-fpsbig ' + (fps >= 55 ? '' : (fps >= 30 ? 'warn' : 'bad'));
    if (D.fpsBig.className !== fcls) D.fpsBig.className = fcls;
    setText(D.backendBadge, (G && G.name) || '—');
    setText(D.selfCost, 'panel ' + (D.paintMs === undefined ? '—' : D.paintMs.toFixed(1) + ' ms') +
                        ' @ ' + (1000 / D.interval).toFixed(1) + ' Hz');

    setText(D.mm.min, p.frame.min().toFixed(1));
    setText(D.mm.avg, p.frame.avg().toFixed(1));
    setText(D.mm.max, p.frame.max().toFixed(1));
    setText(D.mm.P95, p.frame.p95().toFixed(1));
    setText(D.mm.P99, p.frame.percentile(0.99).toFixed(1));
    setText(D.mm['σ'], p.frame.stdDev().toFixed(1));

    // ── timing ──────────────────────────────────────────────────────────────
    var js = p.tick.avg() + p.stream.avg() + p.hud.avg();
    set('frame', p.frame.avg().toFixed(1) + ' ms', 16.7, 33.3);
    set('js', js.toFixed(1) + ' ms', 8, 14, js);
    set('render', p.render.avg().toFixed(1) + ' ms', 8, 14);
    set('hud', p.hud.avg().toFixed(1) + ' ms', 2, 5);
    set('lag', p.lag.avg().toFixed(1) + ' ms', 4, 10);
    set('drops', String(p.drops), 0, 10, p.drops);
    set('pfTick', ms(p.tick)); set('pfStream', ms(p.stream));
    set('pfRender', ms(p.render)); set('pfHud', ms(p.hud)); set('pfLag', ms(p.lag));

    // ── the frame budget bar ────────────────────────────────────────────────
    // ⚠ OF 16.7 ms, NOT OF THE FRAME. A bar normalised to the frame is always full and says
    // nothing; against the 60 fps budget, overflow is the point and it is allowed to run over.
    var parts = [['world tick', p.tick.avg(), '#5a9ff0'], ['stream', p.stream.avg(), '#5dd3c8'],
                 ['render', p.render.avg(), '#c87ff0'], ['HUD', p.hud.avg(), '#f1b24a'],
                 ['lag', p.lag.avg(), '#6a6f7a']];
    // ⚠ D-434: BUILT ONCE, then only the widths and the legend numbers move. Rebuilding five
    // segments and five legend entries from scratch six times a second was a layout of the whole
    // column for a number that changes in its first decimal.
    var bar = document.getElementById('mclDiagBudget'), leg = document.getElementById('mclDiagBudgetLeg');
    if (bar && leg) {
      if (!D._budget) {
        D._budget = [];
        for (var bi = 0; bi < parts.length; bi++) {
          var seg = document.createElement('i');
          seg.style.background = parts[bi][2];
          bar.appendChild(seg);
          var lx = document.createElement('span');
          var sw = document.createElement('b');
          sw.style.background = parts[bi][2];
          lx.appendChild(sw);
          var lt = document.createTextNode('');
          lx.appendChild(lt);
          leg.appendChild(lx);
          D._budget.push([seg, lt]);
        }
      }
      for (var bj = 0; bj < parts.length; bj++) {
        var w = Math.max(0, Math.min(100, parts[bj][1] / 16.7 * 100)).toFixed(1) + '%';
        if (D._budget[bj][0].style.width !== w) D._budget[bj][0].style.width = w;
        var txt = parts[bj][0] + ' ' + parts[bj][1].toFixed(1);
        if (D._budget[bj][1].nodeValue !== txt) D._budget[bj][1].nodeValue = txt;
      }
    }

    // ── GPU ─────────────────────────────────────────────────────────────────
    var info = (G && G.backend && G.backend.info) ? G.backend.info() : null;
    set('draws', String(G.draws | 0), 60, 150, G.draws | 0);
    set('tris', fmtK(G.tris | 0));
    set('mtris', fmtK(G.modelTris | 0));
    set('sections', String(G.meshes ? G.meshes.size : 0));
    set('culled', (G.culled | 0) + ' (' + (G.occluded | 0) + ' occl)');
    set('binds', String((info && info.binds) | 0));
    set('uploads', String(G.uploadQueue ? G.uploadQueue.length : 0));
    set('arenas', ((info && info.arenas) | 0) + ' / ' + ((info && info.arenaMB) || 0) + ' MB');
    var gn = (info && info.renderer) ? String(info.renderer) : '—';
    set('gpuName', gn.length > 38 ? gn.slice(0, 38) + '…' : gn);

    // ── world ───────────────────────────────────────────────────────────────
    if (P && W && W.stats) {
      // D-434: `statsFast`, whose byte total is refreshed once a second — it is O(resident
      // sections) and this runs six times a second. (It was NOT what made this panel expensive;
      // `Gfx.backend.info()` was, at 119.5 ms a call. See `12_gfx_webgl2.js`'s `L.info`.)
      var ws = W.statsFast ? W.statsFast() : W.stats();
      var bx = Math.floor(P.x), by = Math.floor(P.y), bz = Math.floor(P.z);
      set('xyz', P.x.toFixed(2) + ' ' + P.y.toFixed(2) + ' ' + P.z.toFixed(2));
      set('block', bx + ' ' + by + ' ' + bz);
      set('chunkPos', (bx >> 4) + ' ' + (bz >> 4) + '  sy ' + ((by - NS.CFG.WORLD_MIN_Y) >> 4));
      var lx2 = -Math.sin(P.yaw), lz2 = Math.cos(P.yaw);
      var card = Math.abs(lx2) > Math.abs(lz2) ? (lx2 > 0 ? 'east (+X)' : 'west (-X)')
                                               : (lz2 > 0 ? 'south (+Z)' : 'north (-Z)');
      set('facing', card + '  y' + ((P.yaw * 180 / Math.PI) % 360).toFixed(0) +
                    ' p' + (P.pitch * 180 / Math.PI).toFixed(0));
      set('speed', (Math.sqrt(P.vx * P.vx + P.vz * P.vz) * 20).toFixed(2) + ' b/s');
      set('pstate', (NS.Gamemode ? NS.Gamemode.name(P.mode) : 'survival') +
                    (P.flying ? ' fly' : '') + (P.onGround ? ' ground' : ' air') +
                    (P.inWater ? ' water' : ''));
      var bid = W.biomeAt(bx, bz);
      set('biome', (NS.Biomes && NS.Biomes.ready && bid < NS.Biomes.count)
                   ? NS.Biomes.name(bid).replace('minecraft:', '') : ('#' + bid));
      var lt = W.getLight(bx, Math.floor(P.y + P.EYE), bz);
      set('light', 'sky ' + (lt >> 4) + ' block ' + (lt & 15));
      set('time', (NS.Sky && NS.Sky.time !== undefined)
                  ? Math.floor(NS.Sky.time) + ' / d' + (Math.floor(NS.Sky.time / 24000) + 1) : '—');
      set('chunks', String(ws.chunks));
      set('ent', String(NS.EntityList && NS.EntityList.ready ? NS.EntityList.count() : 0));
      set('rd', S.renderDistance + ' chunks');
      set('sim', S.effectiveSimDistance() + ' chunks');
      set('seed', String((NS.Save && NS.Save.seed64 !== undefined) ? NS.Save.seed64 : (W.seed || '—')));
      set('worldMem', (ws.bytes / 1048576).toFixed(1) + ' MB');
      set('gen', ws.genInflight + ' / ' + W.genCap);
      set('mesh', ws.meshInflight + ' / ' + W.meshCap);
      set('evicted', String(ws.evicted));
      set('cancelled', String(ws.cancelled));
      set('load', W.load.toFixed(2));
      set('snap', ws.snapReuse + 'r ' + ws.snapAlloc + 'a');
    }

    // ── workers ─────────────────────────────────────────────────────────────
    if (NS.Jobs && NS.Jobs.stats) {
      var st = NS.Jobs.stats();
      set('wkMode', st.mode + ' ×' + st.workers + ' of ' + (NS.ENV.workersMax || '?'));
      set('wkFlight', st.inflight + ' / ' + st.queued);
      set('wkRetire', String(st.retiring | 0));
    }

    // ── spikes and the since-open block ─────────────────────────────────────
    set('spkN', String(D.spikes), 0, 5, D.spikes);
    set('spkWorst', D.worstSpike ? D.worstSpike.toFixed(1) + ' ms' : '—');
    set('spkSince', D.lastSpikeAt ? ((NS.U.now() - D.lastSpikeAt) / 1000).toFixed(1) + ' s' : '—');
    set('spkWhat', D.lastSpikeWhat || '—');
    set('stFrames', String(D.framesSinceOpen));
    set('stWorst', D.worstSinceOpen.toFixed(1) + ' ms', 16.7, 33.3);
    set('stDrops', String(D.dropsSinceOpen), 0, 5, D.dropsSinceOpen);

    // ── memory ──────────────────────────────────────────────────────────────
    var heapFrac = 0;
    try {
      var pm = performance.memory;
      if (pm) {
        var u = pm.usedJSHeapSize / 1048576, lim = pm.jsHeapSizeLimit / 1048576;
        heapFrac = u / lim;
        set('mem', u.toFixed(0) + ' / ' + lim.toFixed(0) + ' MB', 200, 400, u);
        var mf = document.getElementById('mclDiagMem');
        if (mf) {
          mf.style.width = Math.min(100, heapFrac * 100).toFixed(1) + '%';
          mf.style.background = heapFrac > 0.75 ? 'linear-gradient(90deg,#d65a5a,#f0a04a)'
                                                : 'linear-gradient(90deg,#3a82d6,#5dd3c8)';
        }
      } else set('mem', 'N/A');
    } catch (e) { set('mem', 'N/A'); }

    D.paintGraph(p);
    D.paintVerdicts(p, fps, heapFrac, G.draws | 0);
    D.paintEntities();
    D.paintLog();
  };

  /**
   * The frame-time graph. MineHTML's own scale: 0..50 ms over the full height, with reference
   * lines at 16.7 and 33.3, and each sample coloured by which band it is in.
   * ⚠ IT IS NOT AN FPS GRAPH. FPS is a reciprocal, so a graph of it compresses exactly the
   * region that matters — the difference between a 20 ms frame and a 40 ms one is enormous and
   * looks like almost nothing between 50 and 25 on an fps axis.
   */
  D.paintGraph = function (p) {
    var g = D.graph;
    if (!g) return;
    var gx = g.getContext('2d'), Wd = g.width, Ht = g.height;
    gx.clearRect(0, 0, Wd, Ht);
    gx.fillStyle = 'rgba(0,0,0,0.25)';
    gx.fillRect(0, 0, Wd, Ht);
    var ms2y = function (v) { return Ht - Math.min(Ht, (v / 50) * Ht); };
    gx.strokeStyle = 'rgba(93,211,93,0.35)';
    gx.beginPath(); gx.moveTo(0, ms2y(16.7)); gx.lineTo(Wd, ms2y(16.7)); gx.stroke();
    gx.strokeStyle = 'rgba(241,178,74,0.30)';
    gx.beginPath(); gx.moveTo(0, ms2y(33.3)); gx.lineTo(Wd, ms2y(33.3)); gx.stroke();
    var series = p.frame.series(), n = series.length, x0 = Math.max(0, Wd - n);
    for (var i = 0; i < n; i++) {
      var v = series[i], h = Math.min(Ht, (v / 50) * Ht);
      gx.fillStyle = v <= 16.7 ? '#5dd35d' : (v <= 33.3 ? '#f1b24a' : '#ef5f5f');
      gx.fillRect(x0 + i, Ht - h, 1, h);
    }
  };

  /**
   * The two verdicts. MineHTML's bottleneck ladder, in its own order, with MC-Lite's phases
   * substituted for its `jsTime`/`renderTime`; and the jitter line, which answers a different
   * question — not "what is slow" but "what is UNEVEN", which is the one Dan is usually asking.
   */
  D.paintVerdicts = function (p, fps, heapFrac, draws) {
    var type = 'none', label = 'NONE';
    var js = p.tick.avg() + p.stream.avg() + p.hud.avg();
    if (heapFrac > 0.75) { type = 'mem'; label = 'MEMORY >75%'; }
    else if (draws > 150) { type = 'draw'; label = 'DRAW CALLS (' + draws + ')'; }
    else if (p.render.avg() > js * 1.5 && p.render.avg() > 10) {
      type = 'gpu'; label = 'GPU (' + p.render.avg().toFixed(1) + 'ms render)';
    } else if (js > 12) { type = 'cpu'; label = 'CPU (' + js.toFixed(1) + 'ms sim)'; }
    else if (fps < 30) { type = 'cpu'; label = 'LOW FPS — check render distance'; }
    D.bn.className = type;
    D.bn.textContent = 'BOTTLENECK: ' + label;

    // ⚠ THE JITTER SOURCE IS THE PHASE WITH THE BIGGEST SPREAD, not the biggest average. A
    // renderer that takes a steady 12 ms is a frame-RATE problem; a streamer that takes 1 ms
    // and occasionally 40 is a STUTTER problem, and the two want opposite fixes.
    var phases = [['world tick', p.tick], ['chunk streaming', p.stream],
                  ['render', p.render], ['HUD', p.hud], ['loop lag', p.lag]];
    var worst = null, worstSpread = 0;
    for (var i = 0; i < phases.length; i++) {
      var spread = phases[i][1].max() - phases[i][1].avg();
      if (spread > worstSpread) { worstSpread = spread; worst = phases[i]; }
    }
    if (p.frame.filled < 30) D.jitter.textContent = 'JITTER SOURCE: collecting…';
    else if (!worst || worstSpread < 4) {
      D.jitter.textContent = 'JITTER SOURCE: none significant — frame times look flat (σ ' +
                             p.frame.stdDev().toFixed(1) + ' ms)';
    } else {
      D.jitter.textContent = 'JITTER SOURCE: ' + worst[0] + ' — ' + worst[1].avg().toFixed(1) +
                             ' ms typical, ' + worst[1].max().toFixed(1) + ' ms worst';
    }
  };

  /**
   * The Observable entity profiler. Three views over the same list, which is MineHTML's own
   * shape: what KINDS are here (aggregate), which individuals and how far away (individual),
   * and where they are (chunks). The bar is share-of-the-largest in every view, so the three
   * read the same way.
   */
  D.paintEntities = function () {
    var EL = NS.EntityList;
    if (!EL || !EL.ready) { D.v.obsTotal.textContent = '--'; return; }
    var list = EL.list || [];
    var live = 0, rows = [], i, e, k;
    for (i = 0; i < list.length; i++) if (!list[i].removed) live++;
    D.v.obsTotal.textContent = String(live);
    if (D.tab === 'agg') {
      var byType = {};
      for (i = 0; i < list.length; i++) {
        e = list[i]; if (e.removed) continue;
        byType[e.type] = (byType[e.type] || 0) + 1;
      }
      for (k in byType) rows.push([k, byType[k]]);
      rows.sort(function (a, b) { return b[1] - a[1]; });
    } else if (D.tab === 'chunk') {
      var byChunk = {};
      for (i = 0; i < list.length; i++) {
        e = list[i]; if (e.removed) continue;
        k = (Math.floor(e.x) >> 4) + ', ' + (Math.floor(e.z) >> 4);
        byChunk[k] = (byChunk[k] || 0) + 1;
      }
      for (k in byChunk) rows.push([k, byChunk[k]]);
      rows.sort(function (a, b) { return b[1] - a[1]; });
    } else {
      var P = NS.Player;
      for (i = 0; i < list.length; i++) {
        e = list[i]; if (e.removed) continue;
        var dx = P ? e.x - P.x : 0, dz = P ? e.z - P.z : 0;
        rows.push([e.type + ' #' + e.id + (e.count > 1 ? ' x' + e.count : ''),
                   Math.round(Math.sqrt(dx * dx + dz * dz))]);
      }
      // nearest first — the entity you are looking at is the one you are asking about
      rows.sort(function (a, b) { return a[1] - b[1]; });
    }
    // ⚠ D-434: REBUILT ONLY WHEN THE ROWS CHANGE. In a quiet world this list is identical from
    // one repaint to the next, and tearing down two dozen rows to build the same two dozen back
    // was the single most expensive thing in the panel.
    var sig = D.tab + '|' + rows.map(function (r) { return r[0] + ':' + r[1]; }).join(',');
    if (sig === D._obsSig) return;
    D._obsSig = sig;
    // ⚠ D-488 (KW-28): the rows are a POOL, built once and edited in place. With natural spawning
    // live, the 'ind' tab's distances move every repaint, so the D-434 signature never matched and
    // the whole list was torn down and rebuilt six times a second — the panel's 3x overage.
    // Now a repaint writes only the text/width/colour that actually changed.
    var body = D.obsBody, pool = D._obsPool;
    if (!pool) {
      pool = D._obsPool = { rows: [], empty: el('div', 'dov-obsempty', 'No entities.'),
                            more: el('div', 'dov-obsempty', '') };
      body.innerHTML = '';
      for (i = 0; i < 24; i++) {
        var r = el('div', 'dov-obsrow'), track = el('div', 'dov-obstrack'), fill = el('div', 'dov-obsbar');
        var nm = el('span', 'dov-obsname', ''), num = el('span', 'dov-obsnum', '');
        track.appendChild(fill); r.appendChild(track); r.appendChild(nm); r.appendChild(num);
        r.style.display = 'none';
        body.appendChild(r);
        pool.rows.push({ r: r, fill: fill, nm: nm, num: num, shown: false });
      }
      pool.empty.style.display = 'none'; pool.more.style.display = 'none';
      body.appendChild(pool.empty); body.appendChild(pool.more);
    }
    var setTxt = function (node, t) { if (node.textContent !== t) node.textContent = t; };
    var show = function (node, on) { var d = on ? '' : 'none'; if (node.style.display !== d) node.style.display = d; };
    show(pool.empty, !rows.length);
    var top = 0;
    for (i = 0; i < rows.length; i++) if (rows[i][1] > top) top = rows[i][1];
    for (i = 0; i < 24; i++) {
      var pr = pool.rows[i];
      if (i >= rows.length) { show(pr.r, false); continue; }
      show(pr.r, true);
      // ⚠ INVERTED FOR DISTANCE. In the individual view a BIG number is a far-away entity,
      // which is the least interesting one; the bar would otherwise say the opposite of
      // what the colour ramp means everywhere else in this panel.
      var frac = top > 0 ? (D.tab === 'ind' ? 1 - rows[i][1] / top : rows[i][1] / top) : 0;
      var w = Math.max(2, frac * 100).toFixed(0) + '%';
      if (pr.fill.style.width !== w) pr.fill.style.width = w;
      var bg = frac > 0.66 ? '#ef5f5f' : (frac > 0.33 ? '#f1b24a' : '#5dd35d');
      if (pr.fill._bg !== bg) { pr.fill._bg = bg; pr.fill.style.background = bg; }
      setTxt(pr.nm, rows[i][0]);
      setTxt(pr.num, D.tab === 'ind' ? rows[i][1] + ' b' : String(rows[i][1]));
    }
    show(pool.more, rows.length > 24);
    if (rows.length > 24) setTxt(pool.more, '…and ' + (rows.length - 24) + ' more');
  };

  D.paintLog = function () {
    var out = D.logs.slice(-15);
    // D-434: same rule as the entity list — a log that has not changed is not rebuilt.
    var sig = out.map(function (l) { return l.ts + ':' + l.n; }).join(',');
    if (sig === D._logSig) return;
    D._logSig = sig;
    D.log.innerHTML = '';
    if (!out.length) { D.log.appendChild(el('div', 'clog-info', 'No errors logged.')); return; }
    for (var i = 0; i < out.length; i++) {
      var l = out[i];
      var stamp = new Date(l.ts).toTimeString().slice(3, 8);
      D.log.appendChild(el('div', 'clog-' + l.t,
        '[' + stamp + '] ' + l.m.slice(0, 96) + (l.n > 1 ? '  ×' + l.n : '')));
    }
  };
})(MCL);
