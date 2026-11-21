// NS.UtilClasses: net/minecraft/util ports (#11762), from .decomp. Arm CsvWriter FileNameUtil(pure parts) JsonHelper(subset)
//  MetricsData ModStatus Nameable ProgressListener StringIdentifiable ThrowableDeliverer TickDurationMonitor TopologicalSorts
//  TypeFilter TypedActionResult WorldSavePath BooleanBiFunction MaterialPredicate ToFloatFunction.
// Not ported (JVM-only, no JS meaning): annotations/*, FixedBufferInputStream, JsonSerializer/Serializing/SerializableType,
//  LowercaseEnumTypeAdapterFactory (Gson), SystemDetails, UserCache, WinNativeModuleUtil, ZipCompressor, InvalidIdentifierException (Error subclass).
(function (NS) {
  'use strict';
  var U = NS.UtilClasses = {};
  // Arm: LEFT/RIGHT with getOpposite and the translation key of getOptionName.
  U.Arm = { LEFT: { name: 'LEFT', optionKey: 'options.mainHand.left' }, RIGHT: { name: 'RIGHT', optionKey: 'options.mainHand.right' } };
  U.Arm.LEFT.getOpposite = function () { return U.Arm.RIGHT; };
  U.Arm.RIGHT.getOpposite = function () { return U.Arm.LEFT; };
  U.Arm.fromMainHand = function (s) { return s === 'left' ? U.Arm.LEFT : U.Arm.RIGHT; };
  // BooleanBiFunction constants, in the decomp's order.
  U.BooleanBiFunction = {
    FALSE: function (a, b) { return false; }, NOT_OR: function (a, b) { return !a && !b; }, ONLY_SECOND: function (a, b) { return b && !a; },
    NOT_FIRST: function (a, b) { return !a; }, ONLY_FIRST: function (a, b) { return a && !b; }, NOT_SECOND: function (a, b) { return !b; },
    NOT_SAME: function (a, b) { return a !== b; }, NOT_AND: function (a, b) { return !a || !b; }, AND: function (a, b) { return a && b; },
    SAME: function (a, b) { return a === b; }, SECOND: function (a, b) { return b; }, CAUSES: function (a, b) { return !a || b; },
    FIRST: function (a, b) { return a; }, CAUSED_BY: function (a, b) { return a || !b; }, OR: function (a, b) { return a || b; },
    TRUE: function (a, b) { return true; }
  };
  // TopologicalSorts.sort: DFS; returns true on a cycle. graph is a Map<T,Set<T>>, visited/visiting Sets.
  U.TopologicalSorts = {
    sort: function (graph, visited, visiting, out, node) {
      if (visited.has(node)) return false;
      if (visiting.has(node)) return true;
      visiting.add(node);
      var deps = graph.get(node);
      if (deps) for (var d of deps) if (U.TopologicalSorts.sort(graph, visited, visiting, out, d)) return true;
      visiting.delete(node); visited.add(node); out(node);
      return false;
    }
  };
  // TypedActionResult {result, value}; results are the ActionResult names.
  function tar(r, v) { return { result: r, value: v, getResult: function () { return r; }, getValue: function () { return v; } }; }
  U.TypedActionResult = { create: tar,
    success: function (v, swing) { return swing === false ? tar('CONSUME', v) : tar('SUCCESS', v); },
    consume: function (v) { return tar('CONSUME', v); }, pass: function (v) { return tar('PASS', v); }, fail: function (v) { return tar('FAIL', v); } };
  // WorldSavePath: relative path, toString is "/" + path.
  U.WorldSavePath = {};
  [['ADVANCEMENTS', 'advancements'], ['STATS', 'stats'], ['PLAYERDATA', 'playerdata'], ['PLAYERS', 'players'], ['LEVEL_DAT', 'level.dat'],
   ['GENERATED', 'generated'], ['DATAPACKS', 'datapacks'], ['RESOURCES_ZIP', 'resources.zip'], ['ROOT', '.']].forEach(function (p) {
    U.WorldSavePath[p[0]] = { getRelativePath: function () { return p[1]; }, toString: function () { return '/' + p[1]; } };
  });
  // MetricsData: 240-sample ring. Method names follow the decomp (method_34912 = getAverage over n samples).
  U.MetricsData = function () {
    var N = 240, s = new Array(N).fill(0), start = 0, count = 0, w = 0, m = {};
    m.pushSample = function (v) {
      s[w] = v; w++; if (w === N) w = 0;
      if (count < N) { start = 0; count++; } else start = m.wrapIndex(w + 1);
    };
    m.average = function (n) {   // method_34912; Java long division truncates
      var e = (start + n) % N, i = start, t = 0;
      for (; i !== e; i++) t += s[i];
      return Math.trunc(t / n);
    };
    m.scaled = function (ns, h, fps) { return Math.trunc((ns / Math.trunc(1e9 / fps)) * h); };   // method_15248
    m.averageHeight = function (n, h) { return m.scaled(m.average(n), h, 60); };                 // method_34913
    m.getStartIndex = function () { return start; }; m.getCurrentIndex = function () { return w; };
    m.wrapIndex = function (i) { return i % N; }; m.getSamples = function () { return s; };
    return m;
  };
  // ModStatus: Confidence ordinal order is "Probably not." < "Very likely;" < "Definitely;".
  var CONF = [{ description: 'Probably not.', modded: false }, { description: 'Very likely;', modded: true }, { description: 'Definitely;', modded: true }];
  function ms(c, m) {
    return { confidence: c, message: m, isModded: function () { return CONF[c].modded; },
      combine: function (o) { return ms(Math.max(c, o.confidence), m + '; ' + o.message); },
      getMessage: function () { return CONF[c].description + ' ' + m; } };
  }
  U.ModStatus = { Confidence: CONF, create: ms,
    check: function (vanillaBrand, brand, name, signed) {
      var b = brand();
      if (vanillaBrand !== b) return ms(2, name + " brand changed to '" + b + "'");
      return signed ? ms(0, name + ' jar signature and brand is untouched') : ms(1, name + ' jar signature invalidated');
    } };
  // Nameable: mixin over {getName}; hasCustomName/getDisplayName/getCustomName defaults.
  U.Nameable = function (o) {
    if (!o.getCustomName) o.getCustomName = function () { return null; };
    if (!o.hasCustomName) o.hasCustomName = function () { return o.getCustomName() != null; };
    if (!o.getDisplayName) o.getDisplayName = function () { return o.getName(); };
    return o;
  };
  // ProgressListener: no-op base the loading screens override.
  U.ProgressListener = function (o) {
    var b = { setTitle: function () {}, setTitleAndTask: function () {}, setTask: function () {}, progressStagePercentage: function () {}, setDone: function () {} };
    for (var k in o) b[k] = o[k];
    return b;
  };
  // StringIdentifiable: asString lookup over an enum-like array; createCodec -> {encode, decode(by name | raw ordinal)}.
  U.StringIdentifiable = { createCodec: function (values) {
    return { encode: function (e) { return e.asString(); },
      decode: function (x) { var r = typeof x === 'number' ? (x >= 0 && x < values.length ? values[x] : null) : values.find(function (v) { return v.asString() === x; }) || null;
        if (!r) throw new Error('Unknown element: ' + x); return r; } };
  }, keys: function (values) { return values.map(function (v) { return v.asString(); }); } };
  // ThrowableDeliverer: first error is thrown, later ones attach as suppressed.
  U.ThrowableDeliverer = function () {
    var t = null;
    return { add: function (e) { if (t === null) { t = e; t.suppressed = t.suppressed || []; } else t.suppressed.push(e); },
      deliver: function () { if (t !== null) throw t; } };
  };
  // TypeFilter.instanceOf(ctor).
  U.TypeFilter = { instanceOf: function (c) { return { downcast: function (o) { return o instanceof c ? o : null; }, getBaseClass: function () { return c; } }; } };
  // ToFloatFunction / MaterialPredicate (material = the state's material name; air matches isAir).
  U.ToFloatFunction = function (f) { return { apply: f }; };
  U.MaterialPredicate = { create: function (mat, getMat, isAir) {
    if (mat === 'AIR') return function (st) { return st != null && isAir(st); };
    return function (st) { return st != null && getMat(st) === mat; };
  } };
  // TickDurationMonitor: creates a profiler per tick and reports a tick longer than `overtime` through `save`.
  U.TickDurationMonitor = function (time, name, overtime, save) {
    var t0 = null, n = 0, m = {};
    m.nextProfiler = function () { t0 = time(); n++; return { startTick: t0, tick: n - 1 }; };
    m.endTick = function () {
      if (t0 === null) return;
      var span = time() - t0; t0 = null;
      if (span >= overtime) save('debug/' + name, span);
    };
    return m;
  };
  U.TickDurationMonitor.create = function () { return null; };
  // CsvWriter: header then rows, CRLF terminated, escapeCsv quoting, null -> "[null]".
  function esc(v) {
    var s = v != null ? String(v) : '[null]';
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  U.CsvWriter = { makeHeader: function () {
    var cols = [], h = { addColumn: function (c) { cols.push(c); return h; },
      startBody: function (sink) {
        sink(cols.map(esc).join(',') + '\r\n');
        return { printRow: function () {
          if (arguments.length !== cols.length) throw new Error('Invalid number of columns, expected ' + cols.length + ', but got ' + arguments.length);
          sink(Array.prototype.map.call(arguments, esc).join(',') + '\r\n');
        } };
      } };
    return h;
  } };
  // FileNameUtil: pure string parts. getNextUniqueName takes an exists(name) predicate in place of the directory probe.
  var INVALID = ['/', '\n', '\r', '\t', '\u0000', '\f', '`', '?', '*', '\\', '<', '>', '|', '"', ':'];
  var RESERVED = /^(?:.*\.|(?:COM|CLOCK\$|CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?)$/i;
  U.FileNameUtil = {
    isReserved: function (n) { return RESERVED.test(n); },
    isAllowedName: function (path) { return path.split('/').every(function (p) { return !RESERVED.test(p); }); },
    isNormal: function (p) { return U.FileNameUtil.normalizeToPosix(p) === p; },
    normalizeToPosix: function (p) {
      var parts = [], abs = p.charAt(0) === '/';
      p.replace(/\\/g, '/').split('/').forEach(function (s) { if (s === '..') { if (parts.length) parts.pop(); } else if (s !== '.' && s !== '') parts.push(s); });
      return (abs ? '/' : '') + parts.join('/');
    },
    getPosixFullPath: function (p) { p = p.replace(/\\/g, '/'); return p.slice(0, p.lastIndexOf('/') + 1); },
    getNextUniqueName: function (exists, name, ext) {
      INVALID.forEach(function (c) { name = name.split(c).join('_'); });
      name = name.replace(/[.\/"]/g, '_');
      if (RESERVED.test(name)) name = '_' + name + '_';
      var m = /^(.*) \((\d*)\)$/s.exec(name), n = 0;
      if (m) { name = m[1]; n = parseInt(m[2], 10); }
      if (name.length > 255 - ext.length) name = name.substring(0, 255 - ext.length);
      for (;;) {
        var c = name;
        if (n !== 0) { var sfx = ' (' + n + ')', lim = 255 - sfx.length; if (name.length > lim) c = name.substring(0, lim); c += sfx; }
        c += ext;
        if (!exists(c)) return c;
        n++;
      }
    }
  };
  // JsonHelper: the typed getters (throw on a wrong type, like JsonSyntaxException) used by recipe/advancement parsing.
  function jerr(what, name, j) { return new Error('Expected ' + name + ' to be ' + what + ', was ' + (j === null ? 'null' : typeof j)); }
  U.JsonHelper = {
    hasString: function (o, k) { return typeof o[k] === 'string'; }, hasNumber: function (o, k) { return typeof o[k] === 'number'; },
    hasBoolean: function (o, k) { return typeof o[k] === 'boolean'; }, hasArray: function (o, k) { return Array.isArray(o[k]); },
    hasJsonObject: function (o, k) { return o[k] !== null && typeof o[k] === 'object' && !Array.isArray(o[k]); },
    getString: function (o, k, d) { if (o[k] === undefined && d !== undefined) return d; if (typeof o[k] !== 'string') throw jerr('a string', k, o[k]); return o[k]; },
    getInt: function (o, k, d) { if (o[k] === undefined && d !== undefined) return d; if (typeof o[k] !== 'number') throw jerr('a number', k, o[k]); return Math.trunc(o[k]); },
    getFloat: function (o, k, d) { if (o[k] === undefined && d !== undefined) return d; if (typeof o[k] !== 'number') throw jerr('a number', k, o[k]); return o[k]; },
    getBoolean: function (o, k, d) { if (o[k] === undefined && d !== undefined) return d; if (typeof o[k] !== 'boolean') throw jerr('a boolean', k, o[k]); return o[k]; },
    getArray: function (o, k) { if (!Array.isArray(o[k])) throw jerr('an array', k, o[k]); return o[k]; },
    getObject: function (o, k) { if (!U.JsonHelper.hasJsonObject(o, k)) throw jerr('an object', k, o[k]); return o[k]; }
  };
})(MCL);
