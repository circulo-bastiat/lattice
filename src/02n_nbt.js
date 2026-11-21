// NS.Nbt: net/minecraft/nbt, ported as typed tags (#11743). Cited classes (Yarn names, all in this file):
//  tags: NbtElement NbtType NbtTypes NbtEnd NbtByte NbtShort NbtInt NbtLong NbtFloat NbtDouble NbtString NbtByteArray NbtIntArray
//        NbtLongArray AbstractNbtNumber AbstractNbtList (list helpers shared by NbtList and the arrays) NbtCompound NbtList.
//  io:   NbtIo (read/write of the uncompressed binary form, big-endian, root name ""), NbtTagSizeTracker, NbtOps (the DynamicOps
//        surface the codecs use: createX/getX/mergeToList/mapEntries, over these tags).
//  text: StringNbtReader (SNBT), visitor/NbtElementVisitor, StringNbtWriter, NbtTextFormatter (coloured pretty text, what /data get
//        prints), NbtOrderedStringFormatter (structure-file key order).
//  scanner: NbtScanner NbtScanQuery NbtTreeNode NbtCollector SelectiveNbtCollector ExclusiveNbtCollector SimpleNbtScanner.
// Longs are BigInt. Gzip (NbtIo.readCompressed) is not ported: saves here are not .dat files.
// Reached from /data get and /summon//setblock replay (15g_commands.js snbtStr) and the SNBT argument.
(function (NS) {
  'use strict';
  var N = NS.Nbt = {};
  var IDS = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12 };
  var NAMES = ['TAG_End', 'TAG_Byte', 'TAG_Short', 'TAG_Int', 'TAG_Long', 'TAG_Float', 'TAG_Double', 'TAG_Byte_Array', 'TAG_String', 'TAG_List', 'TAG_Compound', 'TAG_Int_Array', 'TAG_Long_Array'];
  var CMD = ['Tag_End', 'Byte', 'Short', 'Int', 'Long', 'Float', 'Double', 'Byte_Array', 'String', 'List', 'Compound', 'Int_Array', 'Long_Array'];
  N.ID = IDS;
  /** NbtTypes.byId / NbtType.getCommandFeedbackName / getCrashReportName. */
  N.typeName = function (id) { return NAMES[id] || 'UNKNOWN_' + id; };
  N.commandName = function (id) { return CMD[id] || 'UNKNOWN_' + id; };
  function Tag(type, value) { this.type = type; this.value = value; }
  var wrapI = function (v, bits) { return bits === 8 ? (v << 24) >> 24 : bits === 16 ? (v << 16) >> 16 : v | 0; };
  N.byte = function (v) { return new Tag(1, wrapI(v, 8)); };
  N.short = function (v) { return new Tag(2, wrapI(v, 16)); };
  N.int = function (v) { return new Tag(3, v | 0); };
  N.long = function (v) { return new Tag(4, BigInt.asIntN(64, BigInt(v))); };
  N.float = function (v) { return new Tag(5, Math.fround(v)); };
  N.double = function (v) { return new Tag(6, +v); };
  N.string = function (v) { return new Tag(8, String(v)); };
  N.byteArray = function (a) { return new Tag(7, Array.from(a, function (x) { return wrapI(x, 8); })); };
  N.intArray = function (a) { return new Tag(11, Array.from(a, function (x) { return x | 0; })); };
  N.longArray = function (a) { return new Tag(12, Array.from(a, function (x) { return BigInt.asIntN(64, BigInt(x)); })); };
  N.list = function (items) { var t = new Tag(9, []); (items || []).forEach(function (e) { N.listAdd(t, e); }); return t; };
  N.compound = function () { return new Tag(10, new Map()); };
  N.end = new Tag(0, null);
  N.ZERO = N.byte(0); N.ONE = N.byte(1);
  /** NbtList.add: the held type is the first element's; a different type is refused (false), as NbtList.addElement does. */
  N.listAdd = function (list, e) {
    if (e.type === 0) return false;
    if (list.value.length && N.heldType(list) !== e.type) return false;
    list.value.push(e); return true;
  };
  N.heldType = function (list) { return list.value.length ? list.value[0].type : 0; };
  N.put = function (c, k, e) { c.value.set(k, e); return c; };
  N.get = function (c, k) { return c.value.get(k) || null; };
  N.isNumber = function (t) { return t.type >= 1 && t.type <= 6; };
  /** AbstractNbtNumber: byteValue/shortValue/intValue/longValue/floatValue/doubleValue (Java narrowing). */
  N.numberValue = function (t) { return typeof t.value === 'bigint' ? Number(t.value) : t.value; };
  N.intValue = function (t) { return typeof t.value === 'bigint' ? Number(BigInt.asIntN(32, t.value)) : (t.type >= 5 ? (isNaN(t.value) ? 0 : Math.max(-2147483648, Math.min(2147483647, Math.trunc(t.value)))) : t.value | 0); };
  N.longValue = function (t) { return typeof t.value === 'bigint' ? t.value : BigInt(t.type >= 5 ? (isNaN(t.value) ? 0 : Math.trunc(t.value)) : t.value); };
  N.byteValue = function (t) { return wrapI(N.intValue(t), 8); };
  N.shortValue = function (t) { return wrapI(N.intValue(t), 16); };
  N.doubleValue = function (t) { return typeof t.value === 'bigint' ? Number(t.value) : t.value; };
  /** NbtElement.copy / equals (deep). */
  N.copy = function (t) {
    switch (t.type) {
      case 9: return N.list(t.value.map(N.copy));
      case 10: var c = N.compound(); t.value.forEach(function (v, k) { c.value.set(k, N.copy(v)); }); return c;
      case 7: case 11: case 12: return new Tag(t.type, t.value.slice());
      default: return t;
    }
  };
  N.equals = function (a, b) {
    if (a.type !== b.type) return false;
    if (a.type === 10) { if (a.value.size !== b.value.size) return false; var ok = true; a.value.forEach(function (v, k) { var o = b.value.get(k); if (!o || !N.equals(v, o)) ok = false; }); return ok; }
    if (a.type === 9) return a.value.length === b.value.length && a.value.every(function (v, i) { return N.equals(v, b.value[i]); });
    if (a.type >= 7 && a.type !== 8 && a.type !== 9 && a.type !== 10) return a.value.length === b.value.length && a.value.every(function (v, i) { return v === b.value[i]; });
    return a.value === b.value || (a.value !== a.value && b.value !== b.value);
  };

  // ── plain JS <-> tags (the command layer holds plain objects) ──────────────────────────────────────────────
  N.fromJs = function (v) {
    if (v && v.type !== undefined && v.value !== undefined && v instanceof Tag) return v;
    if (Array.isArray(v)) return N.list(v.map(N.fromJs));
    if (v && typeof v === 'object') { var c = N.compound(); Object.keys(v).forEach(function (k) { c.value.set(k, N.fromJs(v[k])); }); return c; }
    if (typeof v === 'string') return N.string(v);
    if (typeof v === 'boolean') return v ? N.ONE : N.ZERO;
    if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) <= 2147483647 ? N.int(v) : N.double(v);
    return N.string(String(v));
  };
  N.toJs = function (t) {
    switch (t.type) {
      case 9: return t.value.map(N.toJs);
      case 10: var o = {}; t.value.forEach(function (v, k) { o[k] = N.toJs(v); }); return o;
      case 7: case 11: return t.value.slice();
      case 12: return t.value.map(Number);
      case 8: return t.value;
      default: return N.numberValue(t);
    }
  };

  // ── Java number formatting (Float/Double.toString) ─────────────────────────────────────────────────────────────
  function javaFloat(v, f32) {
    if (v !== v) return 'NaN';
    if (v === Infinity) return 'Infinity'; if (v === -Infinity) return '-Infinity';
    if (v === 0) return (1 / v < 0) ? '-0.0' : '0.0';
    var s = String(v);
    if (f32) { for (var p = 1; p <= 9; p++) { var c = v.toPrecision(p); if (Math.fround(parseFloat(c)) === v) { s = String(parseFloat(c)); break; } } }
    var a = Math.abs(v);
    if (a >= 1e7 || a < 1e-3) {
      var e = Number(s).toExponential(), m = e.split('e'), mant = m[0].indexOf('.') < 0 ? m[0] + '.0' : m[0];
      return mant + 'E' + parseInt(m[1], 10);
    }
    return s.indexOf('.') < 0 ? s + '.0' : s;
  }
  N.javaFloat = function (v) { return javaFloat(v, true); };
  N.javaDouble = function (v) { return javaFloat(v, false); };

  // ── NbtString.escape ──────────────────────────────────────────────────────────────────────────────────────
  N.escape = function (s) {
    var out = ' ', q = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '\\') out += '\\';
      else if (c === '"' || c === "'") {
        if (q === '') q = c === '"' ? "'" : '"';
        if (q === c) out += '\\';
      }
      out += c;
    }
    if (q === '') q = '"';
    return q + out.substring(1) + q;
  };
  var SIMPLE = /^[A-Za-z0-9._+-]+$/;
  var escapeName = function (k) { return SIMPLE.test(k) ? k : N.escape(k); };

  // ── NbtElementVisitor: accept(tag, visitor) ────────────────────────────────────────────────────────────────────
  var VISIT = { 0: 'visitEnd', 1: 'visitByte', 2: 'visitShort', 3: 'visitInt', 4: 'visitLong', 5: 'visitFloat', 6: 'visitDouble', 7: 'visitByteArray', 8: 'visitString', 9: 'visitList', 10: 'visitCompound', 11: 'visitIntArray', 12: 'visitLongArray' };
  N.accept = function (t, vis) { vis[VISIT[t.type]](t); };

  /** StringNbtWriter (compact, keys sorted, as 1.18.2 writes them). */
  N.StringNbtWriter = function () {
    var self = this, r = '';
    this.apply = function (t) { r = ''; N.accept(t, self); return r; };
    this.visitString = function (t) { r += N.escape(t.value); };
    this.visitByte = function (t) { r += t.value + 'b'; };
    this.visitShort = function (t) { r += t.value + 's'; };
    this.visitInt = function (t) { r += t.value; };
    this.visitLong = function (t) { r += t.value + 'L'; };
    this.visitFloat = function (t) { r += N.javaFloat(t.value) + 'f'; };
    this.visitDouble = function (t) { r += N.javaDouble(t.value) + 'd'; };
    this.visitByteArray = function (t) { r += '[B;' + t.value.map(function (x) { return x + 'B'; }).join(',') + ']'; };
    this.visitIntArray = function (t) { r += '[I;' + t.value.join(',') + ']'; };
    this.visitLongArray = function (t) { r += '[L;' + t.value.map(function (x) { return x + 'L'; }).join(',') + ']'; };
    this.visitList = function (t) { r = '[' + t.value.map(function (e) { return new N.StringNbtWriter().apply(e); }).join(',') + ']'; };
    this.visitCompound = function (t) {
      var keys = Array.from(t.value.keys()).sort();
      r = '{' + keys.map(function (k) { return escapeName(k) + ':' + new N.StringNbtWriter().apply(t.value.get(k)); }).join(',') + '}';
    };
    this.visitEnd = function () { r += 'END'; };
  };
  N.toSnbt = function (t) { return new N.StringNbtWriter().apply(t); };

  /** NbtTextFormatter: {text, extra, style:{color}} components. `prefix` '' = single line (what /data get prints). */
  var C_NAME = 'aqua', C_STR = 'green', C_NUM = 'gold', C_SUF = 'red';
  var lit = function (s, color) { var c = { text: s }; if (color) c.style = { color: color }; return c; };
  var cat = function (parent) { parent.extra = parent.extra || []; for (var i = 1; i < arguments.length; i++) parent.extra.push(typeof arguments[i] === 'string' ? lit(arguments[i]) : arguments[i]); return parent; };
  var numText = function (s, suffix) { var c = lit(s); if (suffix) cat(c, lit(suffix, C_SUF)); c.style = { color: C_NUM }; return c; };
  var quoted = function (s, color) { var e = N.escape(s); return cat(lit(e[0]), lit(e.substring(1, e.length - 1), color), e[0]); };
  N.NbtTextFormatter = function (prefix, level) {
    prefix = prefix || ''; level = level | 0;
    var self = this, res = lit('');
    var rep = function (n) { return prefix.repeat(n); };
    this.apply = function (t) { N.accept(t, self); return res; };
    this.visitString = function (t) { res = quoted(t.value, C_STR); };
    this.visitByte = function (t) { res = numText(String(t.value), 'b'); };
    this.visitShort = function (t) { res = numText(String(t.value), 's'); };
    this.visitInt = function (t) { res = numText(String(t.value)); };
    this.visitLong = function (t) { res = numText(String(t.value), 'L'); };
    this.visitFloat = function (t) { res = numText(N.javaFloat(t.value), 'f'); };
    this.visitDouble = function (t) { res = numText(N.javaDouble(t.value), 'd'); };
    var arr = function (letter, vals, suffixEach) {
      var r = cat(lit('['), lit(letter, C_SUF), ';');
      vals.forEach(function (x, i) {
        cat(r, ' ', lit(String(x), C_NUM));
        if (suffixEach) cat(r, lit(letter, C_SUF));
        if (i !== vals.length - 1) cat(r, ',');
      });
      return cat(r, ']');
    };
    this.visitByteArray = function (t) { res = arr('B', t.value, true); };
    this.visitIntArray = function (t) { res = arr('I', t.value, false); };
    this.visitLongArray = function (t) { res = arr('L', t.value, true); };
    this.visitList = function (t) {
      var n = t.value.length;
      if (!n) { res = lit('[]'); return; }
      var held = N.heldType(t);
      if (held >= 1 && held <= 6 && n <= 8) {
        var r = lit('[');
        t.value.forEach(function (e, i) { if (i) cat(r, ', '); cat(r, new N.NbtTextFormatter(prefix, level).apply(e)); });
        res = cat(r, ']'); return;
      }
      var r2 = lit('[');
      if (prefix) cat(r2, '\n');
      t.value.forEach(function (e, i) {
        var row = lit(rep(level + 1));
        cat(row, new N.NbtTextFormatter(prefix, level + 1).apply(e));
        if (i !== n - 1) cat(row, ',', prefix ? '\n' : ' ');
        cat(r2, row);
      });
      if (prefix) cat(r2, '\n', rep(level));
      res = cat(r2, ']');
    };
    this.keys = function (c) { return Array.from(c.value.keys()); };
    this.visitCompound = function (t) {
      if (!t.value.size) { res = lit('{}'); return; }
      var r = lit('{'), keys = self.keys(t);
      if (prefix) cat(r, '\n');
      keys.forEach(function (k, i) {
        var row = lit(rep(level + 1));
        cat(row, SIMPLE.test(k) ? lit(k, C_NAME) : quoted(k, C_NAME), ':', ' ', new N.NbtTextFormatter(prefix, level + 1).apply(t.value.get(k)));
        if (i !== keys.length - 1) cat(row, ',', prefix ? '\n' : ' ');
        cat(r, row);
      });
      if (prefix) cat(r, '\n', rep(level));
      res = cat(r, '}');
    };
    this.visitEnd = function () { res = lit(''); };
  };
  /** NbtHelper.toPrettyPrintedText's single-line form: the plain string of the coloured text. */
  N.prettyText = function (t) { return NS.Text.plain(new N.NbtTextFormatter('', 0).apply(t)); };

  /** NbtOrderedStringFormatter: structure-file order (DataVersion, author, size, data, entities, palette(s)), indent 4. */
  var ORDER = { '{}': ['DataVersion', 'author', 'size', 'data', 'entities', 'palette', 'palettes'], '{}.data.[].{}': ['pos', 'state', 'nbt'], '{}.entities.[].{}': ['blockPos', 'pos'] };
  var IGNORED = { '{}.size.[]': 1, '{}.data.[].{}': 1, '{}.palette.[].{}': 1, '{}.entities.[].{}': 1 };
  N.NbtOrderedStringFormatter = function (prefix, level, path) {
    prefix = prefix === undefined ? '    ' : prefix; level = level | 0; path = path || [];
    var self = this, res = '';
    this.apply = function (t) { N.accept(t, self); return res; };
    this.visitString = function (t) { res = N.escape(t.value); };
    this.visitByte = function (t) { res = t.value + 'b'; };
    this.visitShort = function (t) { res = t.value + 's'; };
    this.visitInt = function (t) { res = String(t.value); };
    this.visitLong = function (t) { res = t.value + 'L'; };
    this.visitFloat = function (t) { res = N.javaFloat(t.value) + 'f'; };
    this.visitDouble = function (t) { res = N.javaDouble(t.value) + 'd'; };
    this.visitByteArray = function (t) { res = '[B;' + t.value.map(function (x) { return ' ' + x + 'B'; }).join(',') + ']'; };
    this.visitIntArray = function (t) { res = '[I;' + t.value.map(function (x) { return ' ' + x; }).join(',') + ']'; };
    this.visitLongArray = function (t) { res = '[L;' + t.value.map(function (x) { return ' ' + x + 'L'; }).join(',') + ']'; };
    this.visitList = function (t) {
      if (!t.value.length) { res = '[]'; return; }
      var n = t.value.length, held = N.heldType(t);
      path.push('[]');
      var p = IGNORED[path.join('.')] ? '' : prefix;
      var s = '[';
      if (p) s += '\n';
      t.value.forEach(function (e, i) {
        s += p.repeat(level + 1) + new N.NbtOrderedStringFormatter(p, level + 1, path).apply(e);
        if (i !== n - 1) s += ',' + (p ? '\n' : ' ');
      });
      if (p) s += '\n' + p.repeat(level);
      path.pop();
      res = s + ']'; void held;
    };
    this.visitCompound = function (t) {
      if (!t.value.size) { res = '{}'; return; }
      path.push('{}');
      var p = IGNORED[path.join('.')] ? '' : prefix, s = '{';
      if (p) s += '\n';
      var keys = Array.from(t.value.keys()), ord = ORDER[path.join('.')];
      keys.sort(function (a, b) {
        var ia = ord ? ord.indexOf(a) : -1, ib = ord ? ord.indexOf(b) : -1;
        if (ia >= 0 && ib >= 0) return ia - ib; if (ia >= 0) return -1; if (ib >= 0) return 1;
        return a < b ? -1 : a > b ? 1 : 0;
      });
      keys.forEach(function (k, i) {
        path.push(k);
        s += p.repeat(level + 1) + escapeName(k) + ': ' + new N.NbtOrderedStringFormatter(p, level + 1, path).apply(t.value.get(k));
        path.pop();
        if (i !== keys.length - 1) s += ',' + (p ? '\n' : ' ');
      });
      if (p) s += '\n' + p.repeat(level);
      path.pop();
      res = s + '}';
    };
    this.visitEnd = function () { res = ''; };
  };

  // ── StringNbtReader ────────────────────────────────────────────────────────────────────────────────────────────
  var P_DBL_IMPL = /^[-+]?(?:[0-9]+[.]|[0-9]*[.][0-9]+)(?:e[-+]?[0-9]+)?$/i;
  var P_DBL = /^[-+]?(?:[0-9]+[.]?|[0-9]*[.][0-9]+)(?:e[-+]?[0-9]+)?d$/i;
  var P_FLT = /^[-+]?(?:[0-9]+[.]?|[0-9]*[.][0-9]+)(?:e[-+]?[0-9]+)?f$/i;
  var P_BYTE = /^[-+]?(?:0|[1-9][0-9]*)b$/i, P_LONG = /^[-+]?(?:0|[1-9][0-9]*)l$/i, P_SHORT = /^[-+]?(?:0|[1-9][0-9]*)s$/i, P_INT = /^[-+]?(?:0|[1-9][0-9]*)$/;
  var inRange = function (s, lo, hi) { var b = BigInt(s); return b >= lo && b <= hi; };
  /** StringNbtReader.parsePrimitive: the first pattern that matches AND parses wins; a failed parse falls to a string. */
  N.parsePrimitive = function (w) {
    var body = w.substring(0, w.length - 1);
    if (P_FLT.test(w)) return N.float(parseFloat(body));
    if (P_BYTE.test(w) && inRange(body, -128n, 127n)) return N.byte(Number(body));
    if (P_LONG.test(w) && inRange(body, -(1n << 63n), (1n << 63n) - 1n)) return N.long(BigInt(body));
    if (P_SHORT.test(w) && inRange(body, -32768n, 32767n)) return N.short(Number(body));
    if (P_INT.test(w) && inRange(w, -2147483648n, 2147483647n)) return N.int(Number(w));
    if (P_DBL.test(w)) return N.double(parseFloat(body));
    if (P_DBL_IMPL.test(w)) return N.double(parseFloat(w));
    var lw = w.toLowerCase();
    if (lw === 'true') return N.ONE; if (lw === 'false') return N.ZERO;
    return N.string(w);
  };
  /**
   * StringNbtReader over a brigadier-style reader `r` (15g_commands' B.Reader: peek/read/skip/canRead/skipWhitespace/expect/
   * readString/readQuoted/readUnquoted/cursor) and an error factory `err(key, args)`.
   */
  N.StringNbtReader = function (r, err) {
    var self = this;
    err = err || function (key, args) { var e = new Error(key + (args && args.length ? ' ' + args.join(' ') : '')); e.key = key; return e; };
    var expect = function (c) { r.skipWhitespace(); r.expect(c); };
    var comma = function () {
      r.skipWhitespace();
      if (r.canRead() && r.peek() === ',') { r.skip(); r.skipWhitespace(); return true; }
      return false;
    };
    this.readString = function () {
      r.skipWhitespace();
      if (!r.canRead()) throw err('argument.nbt.expected.key', []);
      return r.readString();
    };
    this.parseElementPrimitive = function () {
      r.skipWhitespace();
      var c0 = r.cursor();
      if (r.peek() === '"' || r.peek() === "'") return N.string(r.readQuoted());
      var w = r.readUnquoted();
      if (!w.length) { r.setCursor(c0); throw err('argument.nbt.expected.value', []); }
      return N.parsePrimitive(w);
    };
    this.parseElement = function () {
      r.skipWhitespace();
      if (!r.canRead()) throw err('argument.nbt.expected.value', []);
      var c = r.peek();
      if (c === '{') return self.parseCompound();
      return c === '[' ? self.parseArray() : self.parseElementPrimitive();
    };
    this.parseArray = function () {
      var q = r.peek(1);
      return r.canRead(3) && q !== '"' && q !== "'" && r.peek(2) === ';' ? parsePrimitiveArray() : parseList();
    };
    this.parseCompound = function () {
      expect('{');
      var c = N.compound();
      r.skipWhitespace();
      while (r.canRead() && r.peek() !== '}') {
        var c0 = r.cursor(), k = self.readString();
        if (!k.length) { r.setCursor(c0); throw err('argument.nbt.expected.key', []); }
        expect(':');
        c.value.set(k, self.parseElement());
        if (!comma()) break;
        if (!r.canRead()) throw err('argument.nbt.expected.key', []);
      }
      expect('}');
      return c;
    };
    var parseList = function () {
      expect('[');
      r.skipWhitespace();
      if (!r.canRead()) throw err('argument.nbt.expected.value', []);
      var l = N.list([]), held = null;
      while (r.peek() !== ']') {
        var c0 = r.cursor(), e = self.parseElement();
        if (held === null) held = e.type;
        else if (e.type !== held) { r.setCursor(c0); throw err('argument.nbt.list.mixed', [N.commandName(e.type), N.commandName(held)]); }
        l.value.push(e);
        if (!comma()) break;
        if (!r.canRead()) throw err('argument.nbt.expected.value', []);
      }
      expect(']');
      return l;
    };
    var parsePrimitiveArray = function () {
      expect('[');
      var c0 = r.cursor(), k = r.read(); r.read(); r.skipWhitespace();
      if (!r.canRead()) throw err('argument.nbt.expected.value', []);
      var want = k === 'B' ? 1 : k === 'L' ? 4 : k === 'I' ? 3 : 0;
      if (!want) { r.setCursor(c0); throw err('argument.nbt.array.invalid', [k]); }
      var out = [], arrType = want === 1 ? 7 : want === 4 ? 12 : 11;
      while (r.peek() !== ']') {
        var c1 = r.cursor(), e = self.parseElement();
        if (e.type !== want) { r.setCursor(c1); throw err('argument.nbt.array.mixed', [N.commandName(e.type), N.commandName(arrType)]); }
        out.push(want === 1 ? N.byteValue(e) : want === 4 ? N.longValue(e) : N.intValue(e));
        if (!comma()) break;
        if (!r.canRead()) throw err('argument.nbt.expected.value', []);
      }
      expect(']');
      return new Tag(arrType, out);
    };
    this.readCompound = function () {
      var c = self.parseCompound();
      r.skipWhitespace();
      if (r.canRead()) throw err('argument.nbt.trailing', []);
      return c;
    };
  };
  /** A minimal reader over a string, for StringNbtReader.parse outside the command layer. */
  N.stringReader = function (s) {
    var i = 0, R = {
      cursor: function () { return i; }, setCursor: function (n) { i = n; },
      canRead: function (n) { return i + (n || 1) <= s.length; },
      peek: function (o) { return s[i + (o || 0)]; }, skip: function () { i++; }, read: function () { return s[i++]; },
      skipWhitespace: function () { while (i < s.length && /\s/.test(s[i])) i++; },
      expect: function (c) { if (s[i] !== c) throw new Error('Expected \'' + c + '\''); i++; },
      readUnquoted: function () { var a = i; while (i < s.length && /[0-9A-Za-z_\-.+]/.test(s[i])) i++; return s.substring(a, i); },
      readQuoted: function () {
        var q = s[i++], o = '';
        while (i < s.length) { var c = s[i++]; if (c === '\\') o += s[i++]; else if (c === q) return o; else o += c; }
        throw new Error('Unclosed quoted string');
      },
      readString: function () { return (s[i] === '"' || s[i] === "'") ? R.readQuoted() : R.readUnquoted(); },
    };
    return R;
  };
  N.parse = function (s) { return new N.StringNbtReader(N.stringReader(s)).readCompound(); };

  // ── NbtTagSizeTracker ──────────────────────────────────────────────────────────────────────────────────────────
  N.NbtTagSizeTracker = function (maxBytes) {
    this.maxBytes = maxBytes; this.allocated = 0;
    this.add = function (bits) {
      if (this.maxBytes === 0 && this.empty) return;
      this.allocated += Math.floor(bits / 8);
      if (this.allocated > this.maxBytes) throw new Error('Tried to read NBT tag that was too big; tried to allocate: ' + this.allocated + 'bytes where max allowed: ' + this.maxBytes);
    };
  };
  N.NbtTagSizeTracker.EMPTY = { empty: true, add: function () {} };

  // ── NbtIo: binary, big-endian, root = type byte + name "" + payload ────────────────────────────────────────────
  var te = new TextEncoder(), td = new TextDecoder();
  function Out() { this.b = []; }
  Out.prototype.byte = function (v) { this.b.push(v & 255); };
  Out.prototype.short = function (v) { this.b.push((v >> 8) & 255, v & 255); };
  Out.prototype.int = function (v) { this.b.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); };
  Out.prototype.long = function (v) { var u = BigInt.asUintN(64, v); this.int(Number(u >> 32n)); this.int(Number(u & 0xFFFFFFFFn)); };
  Out.prototype.utf = function (s) { var e = te.encode(s); this.short(e.length); for (var i = 0; i < e.length; i++) this.b.push(e[i]); };
  function writePayload(o, t) {
    switch (t.type) {
      case 1: o.byte(t.value); break;
      case 2: o.short(t.value); break;
      case 3: o.int(t.value); break;
      case 4: o.long(t.value); break;
      case 5: var f = new DataView(new ArrayBuffer(4)); f.setFloat32(0, t.value); o.int(f.getInt32(0)); break;
      case 6: var d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, t.value); o.int(d.getInt32(0)); o.int(d.getInt32(4)); break;
      case 7: o.int(t.value.length); t.value.forEach(function (x) { o.byte(x); }); break;
      case 8: o.utf(t.value); break;
      case 9: o.byte(t.value.length ? t.value[0].type : 0); o.int(t.value.length); t.value.forEach(function (e) { writePayload(o, e); }); break;
      case 10: t.value.forEach(function (e, k) { o.byte(e.type); o.utf(k); writePayload(o, e); }); o.byte(0); break;
      case 11: o.int(t.value.length); t.value.forEach(function (x) { o.int(x); }); break;
      case 12: o.int(t.value.length); t.value.forEach(function (x) { o.long(x); }); break;
    }
  }
  /** NbtIo.write(NbtCompound, DataOutput) -> Uint8Array. */
  N.write = function (t) {
    var o = new Out(); o.byte(t.type);
    if (t.type !== 0) { o.utf(''); writePayload(o, t); }
    return Uint8Array.from(o.b);
  };
  function In(u8, tracker) { this.u = u8; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.p = 0; this.tr = tracker || N.NbtTagSizeTracker.EMPTY; }
  In.prototype.need = function (n) { if (this.p + n > this.u.length) throw new Error('EOF'); };
  In.prototype.byte = function () { this.need(1); return this.dv.getInt8(this.p++); };
  In.prototype.short = function () { this.need(2); var v = this.dv.getInt16(this.p); this.p += 2; return v; };
  In.prototype.int = function () { this.need(4); var v = this.dv.getInt32(this.p); this.p += 4; return v; };
  In.prototype.long = function () { this.need(8); var v = this.dv.getBigInt64(this.p); this.p += 8; return v; };
  In.prototype.utf = function () { var n = this.dv.getUint16(this.p); this.need(2 + n); var s = td.decode(this.u.subarray(this.p + 2, this.p + 2 + n)); this.p += 2 + n; return s; };
  function readPayload(i, type, depth) {
    if (depth > 512) throw new Error('Tried to read NBT tag with too high complexity, depth > 512');
    switch (type) {
      case 1: i.tr.add(72); return N.byte(i.byte());
      case 2: i.tr.add(80); return N.short(i.short());
      case 3: i.tr.add(96); return N.int(i.int());
      case 4: i.tr.add(128); return N.long(i.long());
      case 5: i.tr.add(96); i.need(4); var f = i.dv.getFloat32(i.p); i.p += 4; return N.float(f);
      case 6: i.tr.add(128); i.need(8); var d = i.dv.getFloat64(i.p); i.p += 8; return N.double(d);
      case 7: { i.tr.add(224); var n = i.int(); i.tr.add(8 * n); var a = []; for (var k = 0; k < n; k++) a.push(i.byte()); return new Tag(7, a); }
      case 8: { i.tr.add(288); var s = i.utf(); i.tr.add(16 * s.length); return N.string(s); }
      case 9: {
        i.tr.add(296); var ht = i.byte(), len = i.int();
        if (ht === 0 && len > 0) throw new Error('Missing type on ListTag');
        i.tr.add(32 * len); var l = N.list([]);
        for (var q = 0; q < len; q++) l.value.push(readPayload(i, ht, depth + 1));
        return l;
      }
      case 10: {
        i.tr.add(384); var c = N.compound(), tb;
        while ((tb = i.byte()) !== 0) { var key = i.utf(); i.tr.add(224 + 16 * key.length); i.tr.add(288); c.value.set(key, readPayload(i, tb, depth + 1)); }
        return c;
      }
      case 11: { i.tr.add(192); var m = i.int(); i.tr.add(32 * m); var ia = []; for (var z = 0; z < m; z++) ia.push(i.int()); return new Tag(11, ia); }
      case 12: { i.tr.add(192); var m2 = i.int(); i.tr.add(64 * m2); var la = []; for (var y = 0; y < m2; y++) la.push(i.long()); return new Tag(12, la); }
    }
    throw new Error('Invalid tag id: ' + type);
  }
  /** NbtIo.read(DataInput, NbtTagSizeTracker): the root must be a named compound. */
  N.read = function (u8, tracker) {
    var i = new In(u8, tracker), t = i.byte();
    if (t === 0) throw new Error('Root tag must be a named compound tag');
    i.utf();
    var e = readPayload(i, t, 0);
    if (e.type !== 10) throw new Error('Root tag must be a named compound tag');
    return e;
  };

  // ── NbtScanner (NbtScanner.Result CONTINUE/BREAK/HALT; NestedResult ENTER/SKIP/BREAK/HALT) + NbtIo.scan ────────────────
  var R = N.Result = { CONTINUE: 0, BREAK: 1, HALT: 2 }, NR = N.NestedResult = { ENTER: 0, SKIP: 1, BREAK: 2, HALT: 3 };
  /** SimpleNbtScanner: every callback continues/enters. Subclass by overriding members. */
  N.SimpleNbtScanner = function () {
    ['visitEnd', 'visitString', 'visitByte', 'visitShort', 'visitInt', 'visitLong', 'visitFloat', 'visitDouble', 'visitByteArray', 'visitIntArray', 'visitLongArray', 'visitListMeta', 'endNested', 'start'].forEach(function (m) { this[m] = function () { return R.CONTINUE; }; }, this);
    ['startListItem', 'visitSubNbtType', 'startSubNbt'].forEach(function (m) { this[m] = function () { return NR.ENTER; }; }, this);
  };
  /** NbtScanQuery(path[], type, key) and NbtTreeNode (depth, scalar-type map, children). */
  N.NbtScanQuery = function (a, b, c, d) {
    // overloads: (type,key) (path,type,key) (path1,path2,type,key)
    if (typeof a === 'number') { this.path = []; this.type = a; this.key = b; }
    else if (typeof b === 'number') { this.path = [a]; this.type = b; this.key = c; }
    else { this.path = [a, b]; this.type = c; this.key = d; }
  };
  N.NbtTreeNode = function (depth) { this.depth = depth || 1; this.scalars = {}; this.children = {}; };
  N.NbtTreeNode.createRoot = function () { return new N.NbtTreeNode(1); };
  N.NbtTreeNode.prototype.add = function (q) {
    if (this.depth <= q.path.length) { var k = q.path[this.depth - 1]; (this.children[k] || (this.children[k] = new N.NbtTreeNode(this.depth + 1))).add(q); }
    else this.scalars[q.key] = q.type;
  };
  N.NbtTreeNode.prototype.isTypeEqual = function (type, key) { return this.scalars[key] === type; };
  /** NbtCollector: builds the tree of what the scanner is let see (the result compound). */
  N.NbtCollector = function () {
    N.SimpleNbtScanner.call(this);
    var stack = [], depth = 0, root = null, pend = null;
    this.depth = function () { return depth; };
    this.getRoot = function () { return root; };
    var put = function (tag) {
      var top = stack[stack.length - 1];
      if (top.type === 10) top.value.set(pend, tag); else top.value.push(tag);
    };
    this.start = function (type) { if (type === 10) { root = N.compound(); stack = [root]; depth = 1; } return R.CONTINUE; };
    var enter = function (type) {
      if (type === 10 || type === 9) { var t = type === 10 ? N.compound() : N.list([]); put(t); stack.push(t); depth++; }
      return NR.ENTER;
    };
    this.startSubNbt = function (type, key) { pend = key; return enter(type); };
    this.startListItem = function (type) { return enter(type); };
    this.endNested = function () { depth--; stack.pop(); return R.CONTINUE; };
    var leaf = function (mk) { return function (v) { put(mk(v)); return R.CONTINUE; }; };
    this.visitString = leaf(N.string); this.visitByte = leaf(N.byte); this.visitShort = leaf(N.short); this.visitInt = leaf(N.int);
    this.visitLong = leaf(N.long); this.visitFloat = leaf(N.float); this.visitDouble = leaf(N.double);
    this.visitByteArray = leaf(N.byteArray); this.visitIntArray = leaf(N.intArray); this.visitLongArray = leaf(N.longArray);
  };
  /** SelectiveNbtCollector: only the queried (path, key, type) scalars are kept; scan halts when all are found. */
  N.SelectiveNbtCollector = function (queries) {
    N.SimpleNbtScanner.call(this);
    var tree = N.NbtTreeNode.createRoot(); queries.forEach(function (q) { tree.add(q); });
    var out = N.compound(), stack = [tree], depth = 0, remaining = queries.length, nameStack = [], pend = null, self = this;
    this.getRoot = function () { return out; };
    this.start = function () { return R.CONTINUE; };
    this.visitSubNbtType = function (type) { return NR.ENTER; };
    var holder = function () { var h = out; for (var i = 0; i < nameStack.length; i++) { var n = h.value.get(nameStack[i]); if (!n) { n = N.compound(); h.value.set(nameStack[i], n); } h = n; } return h; };
    this.startSubNbt = function (type, key) {
      var node = stack[stack.length - 1];
      if (type === 10 && node.children[key]) { stack.push(node.children[key]); nameStack.push(key); depth++; return NR.ENTER; }
      if (node.isTypeEqual(type, key)) { pend = key; return NR.ENTER; }
      return NR.SKIP;
    };
    var leaf = function (mk) { return function (v) { if (pend !== null) { holder().value.set(pend, mk(v)); pend = null; remaining--; if (!remaining) return R.HALT; } return R.CONTINUE; }; };
    this.visitString = leaf(N.string); this.visitByte = leaf(N.byte); this.visitShort = leaf(N.short); this.visitInt = leaf(N.int);
    this.visitLong = leaf(N.long); this.visitFloat = leaf(N.float); this.visitDouble = leaf(N.double);
    this.visitByteArray = leaf(N.byteArray); this.visitIntArray = leaf(N.intArray); this.visitLongArray = leaf(N.longArray);
    this.endNested = function () { if (stack.length > 1) { stack.pop(); nameStack.pop(); } return R.CONTINUE; };
    void self;
  };
  /** ExclusiveNbtCollector: everything EXCEPT the queried keys is kept (startSubNbt skips matches). */
  N.ExclusiveNbtCollector = function (queries) {
    N.NbtCollector.call(this);
    var tree = N.NbtTreeNode.createRoot(); queries.forEach(function (q) { tree.add(q); });
    var ts = [tree], base = this.startSubNbt, baseEnd = this.endNested, self = this;
    this.startSubNbt = function (type, key) {
      var node = ts[ts.length - 1];
      if (node.isTypeEqual(type, key)) return NR.SKIP;
      if (type === 10 && node.children[key]) ts.push(node.children[key]);
      return base.call(self, type, key);
    };
    this.endNested = function () { if (ts.length > 1 && self.depth() === ts[ts.length - 1].depth) ts.pop(); return baseEnd.call(self); };
  };
  /** NbtIo.scan(DataInput, NbtScanner): drives `scanner` over the binary form without building the tree it does not want. */
  N.scan = function (u8, scanner) {
    var i = new In(u8), t = i.byte();
    if (t === 0) { if (scanner.start(0) === R.CONTINUE) scanner.visitEnd(); return; }
    var st = scanner.start(t);
    if (st === R.HALT) return;
    i.utf();
    if (st === R.BREAK) { skipPayload(i, t); return; }
    scanPayload(i, t, scanner);
  };
  var skipPayload = function (i, t) { readPayload(i, t, 0); };
  var VIS = { 1: 'visitByte', 2: 'visitShort', 3: 'visitInt', 4: 'visitLong', 5: 'visitFloat', 6: 'visitDouble', 7: 'visitByteArray', 8: 'visitString', 11: 'visitIntArray', 12: 'visitLongArray' };
  // Returns false when the scanner HALTed.
  function scanPayload(i, t, sc) {
    if (t === 10) {
      var tb;
      while ((tb = i.byte()) !== 0) {
        var key = i.utf(), nr = sc.startSubNbt(tb, key);
        if (nr === NR.HALT) return false;
        if (nr === NR.BREAK) { skipPayload(i, tb); while ((tb = i.byte()) !== 0) { i.utf(); skipPayload(i, tb); } return true; }
        if (nr === NR.SKIP) { skipPayload(i, tb); continue; }
        if (!scanPayload(i, tb, sc)) return false;
      }
      return sc.endNested() !== R.HALT;
    }
    if (t === 9) {
      var ht = i.byte(), n = i.int();
      var lm = sc.visitListMeta(ht, n);
      if (lm === R.HALT) return false;
      for (var k = 0; k < n; k++) {
        var r = sc.startListItem(ht, k);
        if (r === NR.HALT) return false;
        if (r === NR.BREAK) { for (var j = k; j < n; j++) skipPayload(i, ht); return true; }
        if (r === NR.SKIP) { skipPayload(i, ht); continue; }
        if (!scanPayload(i, ht, sc)) return false;
      }
      return sc.endNested() !== R.HALT;
    }
    var v = readPayload(i, t, 0);
    return sc[VIS[t]](v.value) !== R.HALT;
  }

  // ── NbtOps: the DynamicOps surface (create/get/merge/map) over these tags ───────────────────────────────────────────
  N.NbtOps = {
    empty: function () { return N.end; },
    createNumeric: function (n) { return N.double(n); },
    createByte: N.byte, createShort: N.short, createInt: N.int, createLong: N.long, createFloat: N.float, createDouble: N.double,
    createBoolean: function (b) { return b ? N.ONE : N.ZERO; },
    createString: N.string,
    createList: function (items) { return N.list(items); },
    createMap: function (entries) { var c = N.compound(); entries.forEach(function (e) { c.value.set(e[0].value, e[1]); }); return c; },
    getNumberValue: function (t) { return N.isNumber(t) ? N.numberValue(t) : null; },
    getStringValue: function (t) { return t.type === 8 ? t.value : null; },
    getStream: function (t) { return t.type === 9 || t.type === 7 || t.type === 11 || t.type === 12 ? (t.type === 9 ? t.value.slice() : t.value.map(function (x) { return t.type === 7 ? N.byte(x) : t.type === 11 ? N.int(x) : N.long(x); })) : null; },
    getMapValues: function (t) { return t.type === 10 ? Array.from(t.value.entries()).map(function (e) { return [N.string(e[0]), e[1]]; }) : null; },
    /** mergeToList: an empty/list target gets the value appended; an array target stays its type when the element matches. */
    mergeToList: function (list, value) {
      if (list.type !== 0 && list.type !== 9 && list.type !== 7 && list.type !== 11 && list.type !== 12) return null;
      if (list.type === 0) return N.list([value]);
      if (list.type === 9) { var l = N.copy(list); return N.listAdd(l, value) || !l.value.length ? l : N.list(l.value.concat([value]).map(N.copy)); }
      var want = list.type === 7 ? 1 : list.type === 11 ? 3 : 4;
      if (value.type === want) { var c = N.copy(list); c.value.push(want === 4 ? value.value : value.value); return c; }
      return N.list(N.NbtOps.getStream(list).concat([value]));
    },
    mergeToMap: function (map, k, v) {
      if (map.type !== 0 && map.type !== 10) return null;
      if (k.type !== 8) return null;
      var c = map.type === 10 ? N.copy(map) : N.compound(); c.value.set(k.value, v); return c;
    },
    remove: function (t, key) { if (t.type !== 10) return t; var c = N.copy(t); c.value.delete(key); return c; },
    convertTo: function (t) { return N.copy(t); },
  };
})(MCL);
