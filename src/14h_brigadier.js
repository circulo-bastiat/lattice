// 14h_brigadier.js — PLAN G12b: BRIGADIER. The command parser, not a `split(' ')`.
//
// Runs on: MAIN THREAD. No DOM, no canvas — this is a parser.
//
// ⚠⚠ **WHY A REAL PARSER.** Dan chose it explicitly: *"real parser, player commands first"*. A
// clone that splits on spaces gets `/give @p minecraft:stone 64` right and then gets
// `/give @e[type=item,limit=3] diamond_sword{display:{Name:"a b"}}` wrong, gives no error
// position, no tab completion, and no `<--[HERE]`. The charter puts commands on the "absolute
// full parity" side of the line, and the thing being copied is Brigadier: a TREE of literal and
// argument nodes, each argument a type that parses itself out of a cursor, and a dispatcher that
// tries every relevant child and keeps the best partial parse.
//
// ⚠⚠ **EVERY ERROR MESSAGE HERE IS VANILLA'S OWN STRING, AND NONE OF THEM IS TYPED IN THIS FILE.**
// Brigadier is a separate library and is not in the 1.18.2 jar, so there was no bytecode referee
// for its text — but Mojang TRANSLATE those messages, so all of them are keys in the game's own
// `en_us.json`, which this game already ships whole: `parsing.int.expected`,
// `command.unknown.argument`, `command.context.here`. They come out of `NS.Text`, which means
// "Expected integer" is the game's wording rather than mine, and a typo is impossible.
//
// ⚠ `Text.translate` IS THE ONLY SOURCE OF USER-FACING TEXT IN THIS FILE. `commandcheck` asserts
// that: it scans the source for quoted English and fails on any it finds.

(function (NS) {
  'use strict';

  var B = NS.Brig = {};

  /** The message for a key, with vanilla's own `%s` substitution. */
  function T(key, args) {
    var Tx = NS.Text;
    if (Tx && Tx.has && Tx.has(key)) return Tx.translate(key, args || []);
    return key;                              // before the lang payload decodes
  }
  B.T = T;

  // ── the exception ─────────────────────────────────────────────────────────────────────────
  /**
   * ⚠ AN ERROR CARRIES ITS CURSOR, which is the whole reason a parser beats a split. Vanilla
   * prints the offending command back with `<--[HERE]` at the failure point, and it can only do
   * that because every throw knows where it was.
   */
  B.Err = function (key, args, cursor, input) {
    this.key = key;
    this.args = args || [];
    this.cursor = cursor === undefined ? -1 : cursor;
    this.input = input || null;
    this.message = T(key, this.args);
  };
  B.Err.prototype.isBrig = true;
  /** vanilla's `getContext()`: up to ten characters before the cursor, then `<--[HERE]`. */
  B.Err.prototype.context = function () {
    if (this.input === null || this.cursor < 0) return '';
    var cursor = Math.min(this.input.length, this.cursor);
    var start = Math.max(0, cursor - 10);
    return (start > 0 ? '...' : '') + this.input.substring(start, cursor) + T('command.context.here');
  };

  function err(key, args, reader) {
    return new B.Err(key, args, reader ? reader.cursor : -1, reader ? reader.string : null);
  }
  B.err = err;

  // ── StringReader ──────────────────────────────────────────────────────────────────────────
  /**
   * Brigadier's cursor. ⚠ EVERY METHOD LEAVES THE CURSOR WHERE IT STOPPED, including the ones
   * that throw — the dispatcher rewinds explicitly when a child fails, and a reader that tidied
   * up after itself would make the error position meaningless.
   */
  function Reader(str, cursor) {
    this.string = str;
    this.cursor = cursor || 0;
  }
  B.Reader = Reader;
  var R = Reader.prototype;
  R.remaining = function () { return this.string.substring(this.cursor); };
  R.read0 = function () { return this.string.substring(0, this.cursor); };
  R.canRead = function (n) { return this.cursor + (n === undefined ? 1 : n) <= this.string.length; };
  R.peek = function (o) { return this.string.charAt(this.cursor + (o || 0)); };
  R.read = function () { return this.string.charAt(this.cursor++); };
  R.skip = function () { this.cursor++; };
  R.skipWhitespace = function () { while (this.canRead() && this.peek() === ' ') this.skip(); };
  R.expect = function (ch) {
    if (!this.canRead() || this.peek() !== ch) throw err('parsing.expected', [ch], this);
    this.skip();
  };

  // ⚠ BRIGADIER'S OWN CHARACTER CLASS, not `/\w/`: a bare word may contain letters, digits,
  // underscore, hyphen, dot and plus. `minecraft:oak_log`, `-1.5` and `1e4` all depend on it.
  var ALLOWED = /[0-9A-Za-z_\-.+]/;
  B.isAllowed = function (ch) { return ALLOWED.test(ch); };

  R.readUnquoted = function () {
    var start = this.cursor;
    while (this.canRead() && ALLOWED.test(this.peek())) this.skip();
    return this.string.substring(start, this.cursor);
  };
  /**
   * `ResourceLocationArgument`'s character set, which is the bare-word set PLUS `:` and `/`.
   * ⚠ IT IS A SEPARATE READER AND HAS TO BE. `readUnquoted` stops at the colon — that is correct
   * and load-bearing for selector options like `type=cow` — so an item or entity id read with it
   * comes back as `minecraft` and the command fails on a perfectly valid line. Vanilla accepts
   * `minecraft:stone` and `stone` interchangeably everywhere an id is expected.
   */
  var ALLOWED_ID = /[0-9a-zA-Z_\-.+:/]/;
  R.readId = function () {
    var start = this.cursor;
    while (this.canRead() && ALLOWED_ID.test(this.peek())) this.skip();
    return this.string.substring(start, this.cursor);
  };
  B.isAllowedId = function (ch) { return ALLOWED_ID.test(ch); };
  R.readQuoted = function () {
    if (!this.canRead()) return '';
    var q = this.peek();
    if (q !== '"' && q !== "'") throw err('parsing.quote.expected.start', [], this);
    this.skip();
    var out = '', escaped = false;
    while (this.canRead()) {
      var ch = this.read();
      if (escaped) {
        if (ch === q || ch === '\\') { out += ch; escaped = false; continue; }
        this.cursor--;
        throw err('parsing.quote.escape', [ch], this);
      }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === q) return out;
      out += ch;
    }
    throw err('parsing.quote.expected.end', [], this);
  };
  /** A quoted string if it starts with a quote, otherwise a bare word. Vanilla's `readString`. */
  R.readString = function () {
    if (!this.canRead()) return '';
    var ch = this.peek();
    if (ch === '"' || ch === "'") return this.readQuoted();
    return this.readUnquoted();
  };
  R.readInt = function () {
    var start = this.cursor;
    while (this.canRead() && /[0-9\-]/.test(this.peek())) this.skip();
    var s = this.string.substring(start, this.cursor);
    if (!s.length) throw err('parsing.int.expected', [], this);
    if (!/^-?\d+$/.test(s)) { this.cursor = start; throw err('parsing.int.invalid', [s], this); }
    return parseInt(s, 10);
  };
  R.readDouble = function () {
    var start = this.cursor;
    while (this.canRead() && /[0-9\-.]/.test(this.peek())) this.skip();
    var s = this.string.substring(start, this.cursor);
    if (!s.length) throw err('parsing.double.expected', [], this);
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) { this.cursor = start; throw err('parsing.double.invalid', [s], this); }
    return parseFloat(s);
  };
  R.readFloat = function () {
    var start = this.cursor;
    while (this.canRead() && /[0-9\-.]/.test(this.peek())) this.skip();
    var s = this.string.substring(start, this.cursor);
    if (!s.length) throw err('parsing.float.expected', [], this);
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) { this.cursor = start; throw err('parsing.float.invalid', [s], this); }
    return parseFloat(s);
  };
  R.readBoolean = function () {
    var start = this.cursor;
    var s = this.readString();
    if (!s.length) throw err('parsing.bool.expected', [], this);
    if (s === 'true') return true;
    if (s === 'false') return false;
    this.cursor = start;
    throw err('parsing.bool.invalid', [s], this);
  };

  // ── argument types ────────────────────────────────────────────────────────────────────────
  // A type is `{ name, parse(reader, source), suggest(source, prefix) }`. `parse` returns the
  // value or throws a `B.Err`.
  // ⚠ BRIGADIER'S `examples()` IS DELIBERATELY ABSENT. Every type had one and nothing called it —
  // a table nothing consumes (D-289's shape), and its contents were the only hard-coded English
  // left in this file. `suggest` is the live completion path and is asserted by `commandcheck`.
  B.types = {};

  B.bool = function () {
    return { name: 'brigadier:bool',
      parse: function (r) { return r.readBoolean(); } };
  };
  /**
   * ⚠ THE RANGE CHECK IS A DIFFERENT MESSAGE FROM THE PARSE FAILURE, and its cursor is the START
   * of the number rather than the end — vanilla points at the value that is out of range, not at
   * the space after it.
   */
  B.integer = function (min, max) {
    if (min === undefined) min = -2147483648;
    if (max === undefined) max = 2147483647;
    return { name: 'brigadier:integer', min: min, max: max,
      parse: function (r) {
        var start = r.cursor;
        var v = r.readInt();
        if (v < min) { r.cursor = start; throw err('argument.integer.low', [min, v], r); }
        if (v > max) { r.cursor = start; throw err('argument.integer.big', [max, v], r); }
        return v;
      } };
  };
  B.double = function (min, max) {
    if (min === undefined) min = -Infinity;
    if (max === undefined) max = Infinity;
    return { name: 'brigadier:double', min: min, max: max,
      parse: function (r) {
        var start = r.cursor;
        var v = r.readDouble();
        if (v < min) { r.cursor = start; throw err('argument.double.low', [min, v], r); }
        if (v > max) { r.cursor = start; throw err('argument.double.big', [max, v], r); }
        return v;
      } };
  };
  B.float = function (min, max) {
    var d = B.double(min, max);
    d.name = 'brigadier:float';
    return d;
  };
  B.word = function () {
    return { name: 'brigadier:string', kind: 'word',
      parse: function (r) { return r.readUnquoted(); } };
  };
  B.string = function () {
    return { name: 'brigadier:string', kind: 'phrase',
      parse: function (r) { return r.readString(); } };
  };
  /** ⚠ GREEDY EATS THE REST OF THE LINE, quotes and spaces and all. `/say` and `/me` need it. */
  B.greedy = function () {
    return { name: 'brigadier:string', kind: 'greedy',
      parse: function (r) { var s = r.remaining(); r.cursor = r.string.length; return s; } };
  };

  // ── the node tree ─────────────────────────────────────────────────────────────────────────
  function Node(kind, name, type) {
    this.kind = kind;                 // 'root' | 'literal' | 'argument'
    this.name = name;
    this.type = type || null;
    this.children = [];
    this.byName = Object.create(null);
    this.command = null;
    this.requirement = null;
    this.redirect = null;
    this.modifier = null;
    this.forks = false;
  }
  B.Node = Node;

  Node.prototype.canUse = function (source) {
    return this.requirement ? !!this.requirement(source) : true;
  };
  /**
   * ⚠ LITERALS ARE TRIED BEFORE ARGUMENTS, always. `/execute run …` has a literal `run` and
   * `/scoreboard players set` has literals where another command has a word argument; if an
   * argument node were allowed to swallow a literal first, `run` would parse as a player name.
   * Vanilla sorts the same way and for the same reason.
   */
  Node.prototype.relevant = function (reader) {
    var lits = [], args = [];
    for (var i = 0; i < this.children.length; i++) {
      var c = this.children[i];
      if (c.kind === 'literal') lits.push(c); else args.push(c);
    }
    if (!lits.length) return args;
    // a fast path exactly like vanilla's: if the next word names a literal, that literal alone
    var cursor = reader.cursor;
    while (cursor < reader.string.length && reader.string.charAt(cursor) !== ' ') cursor++;
    var word = reader.string.substring(reader.cursor, cursor);
    var hit = this.byName[word];
    if (hit && hit.kind === 'literal') return [hit].concat(args);
    return lits.concat(args);
  };

  Node.prototype.parseWith = function (reader, ctx) {
    if (this.kind === 'literal') {
      var start = reader.cursor;
      if (reader.string.substr(start, this.name.length) === this.name) {
        var end = start + this.name.length;
        if (end === reader.string.length || reader.string.charAt(end) === ' ') {
          reader.cursor = end;
          return;
        }
      }
      throw err('argument.literal.incorrect', [this.name], reader);
    }
    var s = reader.cursor;
    var value = this.type.parse(reader, ctx.source);
    ctx.args[this.name] = { value: value, start: s, end: reader.cursor };
  };

  // ── builders ──────────────────────────────────────────────────────────────────────────────
  function Builder(node) { this.node = node; }
  B.Builder = Builder;
  Builder.prototype.then = function (child) {
    var n = child instanceof Builder ? child.node : child;
    this.node.children.push(n);
    if (n.kind === 'literal') this.node.byName[n.name] = n;
    return this;
  };
  Builder.prototype.executes = function (fn) { this.node.command = fn; return this; };
  Builder.prototype.requires = function (pred) { this.node.requirement = pred; return this; };
  /**
   * Point this node's children at another node's.
   *
   * ⚠⚠ **THE MODIFIER IS THE WHOLE POINT AND IT RUNS AT EXECUTE TIME, NOT PARSE TIME.**
   * `/execute as @e at @s run say hi` parses ONCE and runs once per entity, and what makes that
   * possible is that a redirect carries a function from "the context parsed here" to "the source
   * or sources the rest of the line should run against". Applying it while parsing would fix the
   * source before the selector had anything to select — and would make `as @e` mean "the first
   * one" for ever (D-327).
   *
   * `modifier(ctx)` returns a source, an array of sources, or null to run nothing.
   */
  Builder.prototype.redirect = function (target, modifier) {
    this.node.modifier = modifier || null;
    this.node.forks = !!(modifier && modifier.forks);
    this.node.redirect = target instanceof Builder ? target.node : target;
    return this;
  };
  Builder.prototype.build = function () { return this.node; };

  B.literal = function (name) { return new Builder(new Node('literal', name)); };
  B.arg = function (name, type) { return new Builder(new Node('argument', name, type)); };

  // ── the dispatcher ────────────────────────────────────────────────────────────────────────
  function Dispatcher() { this.root = new Node('root', ''); }
  B.Dispatcher = Dispatcher;
  var D = Dispatcher.prototype;

  D.register = function (builder) {
    var n = builder instanceof Builder ? builder.node : builder;
    this.root.children.push(n);
    if (n.kind === 'literal') this.root.byName[n.name] = n;
    return n;
  };
  D.get = function (name) { return this.root.byName[name] || null; };
  D.names = function (source) {
    var out = [];
    for (var i = 0; i < this.root.children.length; i++) {
      var c = this.root.children[i];
      if (c.kind === 'literal' && (source === undefined || c.canUse(source))) out.push(c.name);
    }
    out.sort();
    return out;
  };

  /** A node's own display text: `<name>` for an argument, the bare word for a literal. */
  B.usageText = function (node) {
    return node.kind === 'argument' ? '<' + node.name + '>' : node.name;
  };

  /**
   * vanilla's `CommandDispatcher.getSmartUsage` (jar-verified against brigadier-1.3.10.jar's
   * constant pool: `[` `]` `(` `)` `|` ` ` `...` `-> ` are its ONLY literal strings, in that
   * order — `CommandDispatcher.class`'s own `USAGE_OPTIONAL_OPEN/CLOSE`,
   * `USAGE_REQUIRED_OPEN/CLOSE`, `USAGE_OR`, `ARGUMENT_SEPARATOR` fields, no javap/decompiler
   * available to double check the control flow, so the shape is reproduced field-for-field: one
   * compact string per reachable branch below `node`, brackets/parens/pipe collapsing
   * optional-vs-required and alternative children instead of `C.usage`'s one line per runnable
   * path. Returns an ordered `[{node, text}]` — a real `LinkedHashMap`'s iteration order,
   * keyed by `node`'s immediate children in registration order.
   */
  D.getSmartUsage = function (node, source) {
    var optional = !!node.command;
    var out = [];
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];
      var text = this._smartUsage(child, source, optional, false);
      if (text !== null) out.push({ node: child, text: text });
    }
    return out;
  };
  /** The recursive half of `getSmartUsage`, private to this file. */
  D._smartUsage = function (node, source, optional, deep) {
    if (!node.canUse(source)) return null;
    var own = B.usageText(node);
    var self = optional ? '[' + own + ']' : own;
    var childOptional = !!node.command;
    var open = childOptional ? '[' : '(', close = childOptional ? ']' : ')';

    if (!deep) {
      if (node.redirect) {
        var redirect = node.redirect === this.root ? '...' : '-> ' + B.usageText(node.redirect);
        return self + ' ' + redirect;
      }
      var kids = [];
      for (var i = 0; i < node.children.length; i++) {
        if (node.children[i].canUse(source)) kids.push(node.children[i]);
      }
      if (kids.length === 1) {
        var one = this._smartUsage(kids[0], source, childOptional, childOptional);
        if (one !== null) return self + ' ' + one;
      } else if (kids.length > 1) {
        var seen = [], childUsage = [];
        for (var j = 0; j < kids.length; j++) {
          var u = this._smartUsage(kids[j], source, childOptional, true);
          if (u !== null && seen.indexOf(u) === -1) { seen.push(u); childUsage.push(u); }
        }
        if (childUsage.length === 1) {
          return self + ' ' + (childOptional ? '[' + childUsage[0] + ']' : childUsage[0]);
        } else if (childUsage.length > 1) {
          var builder = open, count = 0;
          for (var k = 0; k < kids.length; k++) {
            if (count > 0) builder += '|';
            builder += B.usageText(kids[k]);
            count++;
          }
          if (count > 0) return self + ' ' + builder + close;
        }
      }
    }
    return self;
  };

  function newCtx(source) { return { source: source, args: Object.create(null), nodes: [], command: null }; }
  function copyCtx(c) {
    var o = { source: c.source, args: Object.create(null), nodes: c.nodes.slice(), command: c.command };
    for (var k in c.args) o.args[k] = c.args[k];
    return o;
  }

  /**
   * vanilla's `parseNodes`. ⚠ IT TRIES EVERY RELEVANT CHILD AND KEEPS THE BEST, rather than
   * committing to the first that matches — which is what makes `/execute as @e run say hi`
   * possible at all, and what makes a failure report the deepest error rather than the first.
   */
  D.parseNodes = function (node, reader, ctxSoFar) {
    var errors = [], potentials = [];
    var cursor = reader.cursor;
    var children = node.relevant(reader);
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (!child.canUse(ctxSoFar.source)) continue;
      var ctx = copyCtx(ctxSoFar);
      try {
        child.parseWith(reader, ctx);
        if (reader.canRead() && reader.peek() !== ' ') {
          throw err('command.expected.separator', [], reader);
        }
      } catch (e) {
        if (!e || !e.isBrig) throw e;
        errors.push({ node: child, e: e });
        reader.cursor = cursor;
        continue;
      }
      ctx.nodes.push(child);
      if (child.command) ctx.command = child.command;
      if (reader.canRead(child.redirect ? 2 : 1)) {
        reader.skip();
        if (child.redirect) {
          // ⚠⚠ **A CHAIN, NOT A MERGE.** The first version folded the parent's arguments into the
          // child's one namespace, and that is fine until a command uses the same argument NAME
          // twice on one line: `/execute positioned 1 2 3 positioned ~ ~1 ~ run ...` is legal,
          // common, and would have had its two `pos` arguments collapse into one. Vanilla keeps a
          // CommandContext per redirect level and walks the chain at execute time; so does this.
          var sub = this.parseNodes(child.redirect, reader, newCtx(ctx.source));
          // ⚠⚠ **ATTACH AT THE SUB-CHAIN'S ROOT, NOT AT WHAT COMES BACK.** `parseNodes` returns
          // the DEEPEST context, and a nested redirect has already linked several levels below
          // it. Writing `sub.context.parent` at every level as the recursion unwinds sets the
          // same field over and over, and the last write wins: a four-level
          // `/execute positioned .. positioned .. run ..` collapsed to TWO and quietly dropped
          // every clause but the first. Walk to the top of what came back and link there.
          var top = sub.context;
          while (top.parent) top = top.parent;
          top.parent = ctx;
          return sub;
        }
        potentials.push(this.parseNodes(child, reader, ctx));
      } else {
        potentials.push({ context: ctx, reader: new Reader(reader.string, reader.cursor), errors: [] });
      }
      reader.cursor = cursor;
    }
    if (potentials.length) {
      // ⚠ THE BEST PARSE, BY VANILLA'S OWN ORDER: one that consumed the whole line beats one that
      // did not, then one that has a command to run, then one with fewer errors.
      potentials.sort(function (a, b) {
        if (!a.reader.canRead() && b.reader.canRead()) return -1;
        if (a.reader.canRead() && !b.reader.canRead()) return 1;
        if (a.errors.length === 0 && b.errors.length !== 0) return -1;
        if (a.errors.length !== 0 && b.errors.length === 0) return 1;
        return 0;
      });
      return potentials[0];
    }
    return { context: ctxSoFar, reader: new Reader(reader.string, cursor), errors: errors };
  };

  D.parse = function (input, source) {
    var reader = new Reader(input);
    var res = this.parseNodes(this.root, reader, newCtx(source));
    return res;
  };

  /**
   * Run a command line. Returns `{ ok, result, error }`; `error` is a `B.Err` with a cursor, so
   * the caller can print vanilla's two-line failure with `<--[HERE]` under it.
   */
  D.execute = function (input, source) {
    var parse = this.parse(input, source);
    if (parse.reader.canRead()) {
      if (parse.errors.length === 1) return { ok: false, error: parse.errors[0].e };
      if (parse.context.nodes.length === 0) {
        return { ok: false, error: new B.Err('command.unknown.command', [], parse.reader.cursor, input) };
      }
      return { ok: false, error: new B.Err('command.unknown.argument', [], parse.reader.cursor, input) };
    }
    if (!parse.context.command) {
      return { ok: false, error: new B.Err('command.unknown.command', [], parse.reader.cursor, input) };
    }
    try {
      var r = D.runChain(parse.context, source);
      return { ok: true, result: (r === undefined ? 1 : r) };
    } catch (e) {
      if (e && e.isBrig) return { ok: false, error: e };
      return { ok: false, error: new B.Err('command.failed', [], -1, input) };
    }
  };

  /**
   * vanilla's `ContextChain`: walk the parsed contexts from the OUTERMOST in, letting each
   * redirect's modifier say what source or sources the next level runs against, and run the leaf
   * command once per surviving source.
   *
   * ⚠ **THE RESULT OF A FORK IS THE COUNT OF SUCCESSES, NOT THE LAST RETURN VALUE.** `/execute as
   * @e run say hi` with four entities returns 4, and that number is what a command block reads.
   * Returning the last `say`'s result instead gives 1 whatever happened.
   *
   * ⚠ AND A MODIFIER THAT SELECTS NOTHING IS NOT AN ERROR — `/execute as @e[type=pig] run ...`
   * in a world with no pigs runs nothing and returns 0, exactly as vanilla does.
   */
  D.runChain = function (leaf, source) {
    var levels = [];
    for (var c = leaf; c; c = c.parent) levels.unshift(c);
    var sources = [source], i, j;
    for (i = 0; i < levels.length - 1; i++) {
      var lvl = levels[i];
      // the node that redirected out of this level is its last one
      var node = lvl.nodes.length ? lvl.nodes[lvl.nodes.length - 1] : null;
      var next = [];
      for (j = 0; j < sources.length; j++) {
        lvl.source = sources[j];
        if (!node || !node.modifier) { next.push(sources[j]); continue; }
        var out = node.modifier(lvl);
        if (out === null || out === undefined) continue;
        if (Array.isArray(out)) {
          for (var k = 0; k < out.length; k++) next.push(out[k]);
        } else next.push(out);
      }
      sources = next;
      if (!sources.length) return 0;
    }
    var total = 0, ran = 0;
    for (j = 0; j < sources.length; j++) {
      leaf.source = sources[j];
      var got, cb = sources[j].resultCb;
      try { got = leaf.command(leaf); }
      catch (e) { if (cb && e && e.isBrig) cb(false, 0); throw e; }   // /execute store: a failure stores 0
      if (cb) cb(got !== false, typeof got === 'number' ? got : (got === false ? 0 : 1));
      ran++;
      total += (typeof got === 'number' ? got : (got === false ? 0 : 1));
    }
    // ⚠ ONE SOURCE MEANS ONE ANSWER; many means a COUNT. Vanilla's `ContextChain` returns the
    // single command's own result when it did not fork, so `/execute run seed` still reports the
    // seed rather than the number 1.
    return sources.length === 1 ? total : ran;
  };

  /** The value of one argument, or `dflt`. */
  B.get = function (ctx, name, dflt) {
    var a = ctx.args[name];
    return a === undefined ? dflt : a.value;
  };

  /**
   * Completions for a partially typed line: `{ start, matches: [string] }`.
   * ⚠ THE `start` IS THE CURSOR OF THE WORD BEING COMPLETED, not of the whole line — a completer
   * that returns whole lines makes tab replace what the player already typed.
   */
  D.suggest = function (input, source) {
    var reader = new Reader(input);
    var parse = this.parseNodes(this.root, reader, newCtx(source));
    // walk from the deepest successfully parsed node
    var node = this.root;
    for (var i = 0; i < parse.context.nodes.length; i++) node = parse.context.nodes[i];
    var start = input.length;
    while (start > 0 && input.charAt(start - 1) !== ' ') start--;
    var prefix = input.substring(start).toLowerCase();
    var out = [];
    var kids = node.redirect ? node.redirect.children : node.children;
    for (var k = 0; k < kids.length; k++) {
      var c = kids[k];
      if (!c.canUse(source)) continue;
      if (c.kind === 'literal') {
        if (c.name.toLowerCase().indexOf(prefix) === 0) out.push(c.name);
      } else if (c.type && c.type.suggest) {
        var s = c.type.suggest(source, prefix) || [];
        for (var q = 0; q < s.length; q++) if (s[q].toLowerCase().indexOf(prefix) === 0) out.push(s[q]);
      }
    }
    out.sort();
    return { start: start, matches: out };
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
