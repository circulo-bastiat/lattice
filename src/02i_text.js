// 02i_text.js — PLAN G12. Vanilla's text: the language table, the formatter, and components.
//
// ⚠ THIS IS A PARITY STAGE, NOT A CONVENIENCE. Up to here the game named a diamond sword by
// taking its registry id and swapping underscores for spaces — "diamond sword", lower case, in a
// GUI that has said "Diamond Sword" since 2011. Every string a player reads is on the parity side
// of the charter, and every one of them comes from `en_us.json` now (D-282).
//
// ── THE FORMATTER IS THE PART THAT IS EASY TO GET WRONG ──────────────────────────────────────
// ⚠⚠ `%s` AND `%N$s` INTERACT, AND NOT THE WAY YOU WOULD GUESS. Vanilla's `Language.getOrDefault`
// hands the template to a decomposer that keeps ONE sequential counter: a bare `%s` takes the next
// argument and advances it, while an indexed `%N$s` takes argument N-1 and **does not advance
// anything**. So in `"%s%2$s again %s"` with (a, b, c) the third placeholder is `b`, not `c` —
// the indexed one in the middle did not move the counter past it.
// ⚠ MOJANG SHIPS THE TEST VECTORS FOR THIS. `translation.test.complex` and its five siblings are
// in `en_us.json` for the sole purpose of Mojang's own unit tests, and `textcheck` evaluates all
// of them. The formatter here is graded against the game's fixtures, not against this project's
// reading of the rule — which is the same discipline as D-263's bytecode referee, for free.
//
// ── COMPONENTS ───────────────────────────────────────────────────────────────────────────────
// A component is a tree: a node with `text` (literal) or `translate` + `with` (translatable),
// an optional `extra` array of children, and a `style`. Style INHERITS down the tree and a child
// overrides only what it names — which is why a bold parent with a plain child still renders the
// child bold. `T.runs()` flattens a tree to the `[{text, style}]` list the HUD draws, resolving
// inheritance once, so nothing downstream has to know the tree exists.

(function (NS) {
  'use strict';

  var T = NS.Text = {
    ready: false,
    map: null,          // key -> template
    overrides: null,    // block name -> the key that names it, when it is not its own (D-282)
    keys: 0
  };

  // ── the sixteen colours, and the formatting codes ─────────────────────────────────────────
  // ⚠ THE RGB IS VANILLA'S `ChatFormatting`, not a guess at what "dark aqua" looks like. The
  // legacy `§` codes index the same table, which is why they are one list and not two.
  T.COLORS = {
    black: { code: '0', rgb: 0x000000 },
    dark_blue: { code: '1', rgb: 0x0000AA },
    dark_green: { code: '2', rgb: 0x00AA00 },
    dark_aqua: { code: '3', rgb: 0x00AAAA },
    dark_red: { code: '4', rgb: 0xAA0000 },
    dark_purple: { code: '5', rgb: 0xAA00AA },
    gold: { code: '6', rgb: 0xFFAA00 },
    gray: { code: '7', rgb: 0xAAAAAA },
    dark_gray: { code: '8', rgb: 0x555555 },
    blue: { code: '9', rgb: 0x5555FF },
    green: { code: 'a', rgb: 0x55FF55 },
    aqua: { code: 'b', rgb: 0x55FFFF },
    red: { code: 'c', rgb: 0xFF5555 },
    light_purple: { code: 'd', rgb: 0xFF55FF },
    yellow: { code: 'e', rgb: 0xFFFF55 },
    white: { code: 'f', rgb: 0xFFFFFF }
  };
  var CODE_TO_COLOR = Object.create(null);
  for (var cn in T.COLORS) CODE_TO_COLOR[T.COLORS[cn].code] = cn;
  // k l m n o are obfuscated, bold, strikethrough, underline, italic; r resets everything.
  T.STYLE_CODES = { k: 'obfuscated', l: 'bold', m: 'strikethrough', n: 'underlined', o: 'italic' };

  /** A colour as 0xRRGGBB, from a name or a `#rrggbb` literal. -1 when it is neither. */
  T.colorOf = function (name) {
    if (typeof name !== 'string') return -1;
    if (name.charAt(0) === '#') {
      var v = parseInt(name.slice(1), 16);
      return (isFinite(v) && name.length === 7) ? (v & 0xFFFFFF) : -1;
    }
    var c = T.COLORS[name];
    return c ? c.rgb : -1;
  };

  // ── the language table ────────────────────────────────────────────────────────────────────
  T.init = function (data) {
    if (!data || !data.lang) { T.ready = false; return T; }
    var bytes = NS.Z.unpack(data.lang, data.langBytes);
    var CH = 8192, parts = [];
    for (var i = 0; i < bytes.length; i += CH) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length))));
    }
    // ⚠ the blob is UTF-8 and the loop above read it as bytes, so it is decoded here rather than
    // char by char: `en_us.json` carries real non-ASCII (the em dashes in the credits, "Ō" in a
    // music disc's author) and `String.fromCharCode` over raw bytes would mangle every one.
    var json = (typeof TextDecoder !== 'undefined')
      ? new TextDecoder('utf-8').decode(bytes)
      : decodeURIComponent(escape(parts.join('')));
    T.map = JSON.parse(json);
    T.keys = 0;
    for (var k in T.map) T.keys++;
    T.overrides = (data.langOverrides && JSON.parse(data.langOverrides)) || Object.create(null);
    T.ready = true;
    return T;
  };

  /** The raw template for a key, or the key itself — which is exactly what vanilla renders. */
  T.template = function (key) {
    if (!T.map) return key;
    var v = T.map[key];
    return (typeof v === 'string') ? v : key;
  };
  T.has = function (key) { return !!(T.map && typeof T.map[key] === 'string'); };

  /**
   * `Language.getOrDefault(key)` with `%s`/`%N$s` substitution — vanilla's `decomposeTemplate`.
   *
   * ⚠ ONE SEQUENTIAL COUNTER, AND THE INDEXED FORM DOES NOT ADVANCE IT. See this file's header;
   * `textcheck` runs Mojang's own `translation.test.*` fixtures through this function.
   * ⚠ `%%` IS A LITERAL PERCENT and is consumed before anything else looks at it, so `"%%s"` is
   * the two characters `%s` and takes no argument at all.
   * ⚠ A MALFORMED TEMPLATE IS LEFT ALONE. `"hi %"` and `"hi %  s"` render as themselves; vanilla
   * throws and the caller falls back to the raw string, which comes to the same picture.
   */
  T.format = function (template, args) {
    if (typeof template !== 'string') return '';
    if (template.indexOf('%') < 0) return template;
    var out = '', i = 0, next = 0, n = template.length;
    args = args || [];
    while (i < n) {
      var ch = template.charAt(i);
      if (ch !== '%') { out += ch; i++; continue; }
      if (i + 1 >= n) { out += '%'; i++; continue; }          // a trailing % is literal
      var c1 = template.charAt(i + 1);
      if (c1 === '%') { out += '%'; i += 2; continue; }        // %% -> %
      if (c1 === 's') { out += argAt(args, next++); i += 2; continue; }
      // %N$s — digits, a dollar, an s. Anything else is not a placeholder and stays as it is.
      var j = i + 1, digits = '';
      while (j < n && template.charAt(j) >= '0' && template.charAt(j) <= '9') { digits += template.charAt(j); j++; }
      if (digits && j + 1 < n && template.charAt(j) === '$' && template.charAt(j + 1) === 's') {
        out += argAt(args, parseInt(digits, 10) - 1);          // 1-based, and it does NOT advance `next`
        i = j + 2;
        continue;
      }
      out += '%'; i++;                                         // not a placeholder after all
    }
    return out;
  };

  function argAt(args, idx) {
    if (idx < 0 || idx >= args.length) return '';
    var a = args[idx];
    if (a === null || a === undefined) return '';
    return (typeof a === 'object') ? T.plain(a) : String(a);
  }

  /** `translate(key, ...)` — the template for `key`, formatted. The one call most code wants. */
  T.translate = function (key, args) { return T.format(T.template(key), args); };

  // ── names ─────────────────────────────────────────────────────────────────────────────────
  /**
   * A block's display name.
   * ⚠ THE 18 OVERRIDES ARE VANILLA'S OWN RULE, NOT A FALLBACK CHAIN (D-282). A wall banner has no
   * string of its own — `WallBannerBlock.getDescriptionId()` returns the standing banner's — and
   * the two item frames are entities, named by their item. `pack-lang` derives the table and
   * asserts it is exactly those eighteen, so this is one lookup with a table beside it rather
   * than three lookups in a row (D-280).
   */
  T.blockName = function (name) {
    if (!name) return '';
    var bare = String(name).replace(/^minecraft:/, '');
    var over = T.overrides && T.overrides[bare];
    return T.template(over || ('block.minecraft.' + bare));
  };

  /**
   * An item's display name. ⚠ A BLOCK ITEM IS NAMED BY ITS BLOCK KEY — `item.minecraft.stone`
   * does not exist and never has — so this asks for the item key and takes the block key when
   * there is none. That is two named cases, not an open-ended search.
   */
  T.itemName = function (name) {
    if (!name) return '';
    var bare = String(name).replace(/^minecraft:/, '');
    if (T.has('item.minecraft.' + bare)) return T.template('item.minecraft.' + bare);
    return T.blockName(bare);
  };

  // ── components ────────────────────────────────────────────────────────────────────────────
  /** A literal. */
  T.literal = function (text, style) {
    var c = { text: String(text) };
    if (style) c.style = style;
    return c;
  };
  /** A translatable node. `args` are components or plain values, as vanilla's `with` is. */
  T.translatable = function (key, args, style) {
    var c = { translate: key };
    if (args && args.length) c.with = args.slice();
    if (style) c.style = style;
    return c;
  };
  /**
   * ⚠ THE STYLE KEYS THIS ENGINE UNDERSTANDS, and the ONLY place they are listed. Vanilla's JSON
   * puts them at the TOP LEVEL of a node — `{"text":"hi","color":"red","bold":true}` — while this
   * engine keeps them under `.style`, so `fromJson` lifts them and `toJson` would put them back.
   */
  T.JSON_STYLE = ['color', 'bold', 'italic', 'underlined', 'strikethrough', 'obfuscated'];

  /**
   * ⚠ WHAT A COMPONENT CAN BE IN VANILLA AND IS NOT HERE. Named, because a `/tellraw` that
   * silently renders `{"selector":"@p"}` as nothing is indistinguishable from a broken command.
   * `score` and `nbt` need a scoreboard and an NBT store, neither of which exists yet; `keybind`
   * needs the key map to be queryable by name; the two EVENTS need a clickable chat line.
   */
  T.JSON_OWED = ['score', 'selector', 'keybind', 'nbt', 'clickEvent', 'hoverEvent'];

  /**
   * `Component.Serializer.fromJson` — a JSON value to a component tree.
   *
   * ⚠⚠ **AN ARRAY IS NOT A LIST OF SIBLINGS: ITS FIRST ELEMENT IS THE PARENT.** Vanilla folds
   * `["a", "b", "c"]` into `"a"` with `b` and `c` as its `extra`, which means the FIRST element's
   * style is inherited by the rest. Building a bare container instead gives a line where the
   * first word's colour mysteriously fails to reach the others.
   *
   * ⚠ AND A BARE STRING IS A COMPONENT. `/tellraw @s "hello"` is legal and common.
   *
   * Throws `{ json: true, why: <string> }` on anything it cannot read, so the caller can raise
   * the game's own `argument.component.invalid` with the reason in it.
   */
  T.fromJson = function (v) {
    var bad = function (why) { var e = new Error(why); e.json = true; e.why = why; throw e; };
    var one = function (node) {
      if (node === null || node === undefined) bad('null');
      if (typeof node === 'string') return T.literal(node);
      if (typeof node === 'number' || typeof node === 'boolean') return T.literal(String(node));
      if (Object.prototype.toString.call(node) === '[object Array]') {
        if (!node.length) bad('empty array');
        var head = one(node[0]);
        for (var a = 1; a < node.length; a++) T.append(head, one(node[a]));
        return head;
      }
      if (typeof node !== 'object') bad('not an object');
      var out = null;
      if (typeof node.text === 'string') out = T.literal(node.text);
      else if (typeof node.translate === 'string') {
        var args = [];
        if (node['with'] && node['with'].length) {
          for (var w = 0; w < node['with'].length; w++) {
            var a2 = node['with'][w];
            args.push(typeof a2 === 'object' ? one(a2) : a2);
          }
        }
        out = T.translatable(node.translate, args);
      } else {
        for (var o = 0; o < T.JSON_OWED.length; o++) {
          if (node[T.JSON_OWED[o]] !== undefined) bad(T.JSON_OWED[o] + ' is not supported');
        }
        bad('no text or translate');
      }
      var style = null;
      for (var k = 0; k < T.JSON_STYLE.length; k++) {
        var key = T.JSON_STYLE[k];
        if (node[key] === undefined) continue;
        if (!style) style = {};
        style[key] = key === 'color' ? String(node[key]) : !!node[key];
      }
      if (style) out.style = style;
      if (node.extra) {
        if (Object.prototype.toString.call(node.extra) !== '[object Array]') bad('extra is not an array');
        for (var e2 = 0; e2 < node.extra.length; e2++) T.append(out, one(node.extra[e2]));
      }
      return out;
    };
    return one(v);
  };

  /** Append a child. Returns the parent, so trees read left to right. */
  T.append = function (parent, child) {
    if (!parent.extra) parent.extra = [];
    parent.extra.push(child);
    return parent;
  };

  var STYLE_KEYS = ['color', 'bold', 'italic', 'underlined', 'strikethrough', 'obfuscated'];

  /**
   * ⚠ STYLE INHERITS AND A CHILD OVERRIDES ONLY WHAT IT NAMES. `undefined` is not `false`: a
   * child that says nothing about `bold` inside a bold parent is bold, and a child that says
   * `bold: false` is not. Collapsing the two is the commonest component bug there is, and it
   * shows up as a whole death message going bold because one name in it was.
   */
  T.mergeStyle = function (parent, child) {
    if (!child) return parent || null;
    var out = {}, k, i;
    if (parent) for (i = 0; i < STYLE_KEYS.length; i++) { k = STYLE_KEYS[i]; if (parent[k] !== undefined) out[k] = parent[k]; }
    for (i = 0; i < STYLE_KEYS.length; i++) { k = STYLE_KEYS[i]; if (child[k] !== undefined) out[k] = child[k]; }
    return out;
  };

  /**
   * Flatten a component tree to `[{text, style}]`, style resolved.
   * ⚠ THE ORDER IS VANILLA'S: a node's own content comes before its `extra`, and a translatable
   * node's arguments are visited in the order the TEMPLATE puts them, not the order they were
   * given — which is why the substitution happens here rather than by string concatenation.
   */
  T.runs = function (component, inherited) {
    var out = [];
    visit(component, inherited || null, out);
    return out;
  };

  function visit(c, inherited, out) {
    if (c === null || c === undefined) return;
    if (typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean') {
      if (String(c)) out.push({ text: String(c), style: inherited || null });
      return;
    }
    if (Array.isArray(c)) { for (var a = 0; a < c.length; a++) visit(c[a], inherited, out); return; }
    var style = T.mergeStyle(inherited, c.style);
    if (typeof c.text === 'string') {
      // legacy § codes inside a literal become style changes, as vanilla's own chat does
      pushLegacy(c.text, style, out);
    } else if (typeof c.translate === 'string') {
      var tpl = T.template(c.translate);
      var args = c.with || [];
      // ⚠ the template is walked HERE so an argument that is itself a component keeps its style
      // instead of being flattened to text first.
      walkTemplate(tpl, args, style, out);
    }
    if (c.extra) for (var i = 0; i < c.extra.length; i++) visit(c.extra[i], style, out);
  }

  /** The same scan as `T.format`, but emitting runs so component arguments survive. */
  function walkTemplate(tpl, args, style, out) {
    var i = 0, next = 0, n = tpl.length, lit = '';
    while (i < n) {
      var ch = tpl.charAt(i);
      if (ch !== '%') { lit += ch; i++; continue; }
      if (i + 1 >= n) { lit += '%'; i++; continue; }
      var c1 = tpl.charAt(i + 1);
      if (c1 === '%') { lit += '%'; i += 2; continue; }
      var idx = -1, adv = 0;
      if (c1 === 's') { idx = next++; adv = 2; }
      else {
        var j = i + 1, digits = '';
        while (j < n && tpl.charAt(j) >= '0' && tpl.charAt(j) <= '9') { digits += tpl.charAt(j); j++; }
        if (digits && j + 1 < n && tpl.charAt(j) === '$' && tpl.charAt(j + 1) === 's') {
          idx = parseInt(digits, 10) - 1; adv = (j + 2) - i;
        } else { lit += '%'; i++; continue; }
      }
      if (lit) { pushLegacy(lit, style, out); lit = ''; }
      visit(args[idx], style, out);
      i += adv;
    }
    if (lit) pushLegacy(lit, style, out);
  }

  /**
   * ⚠ `§` CODES ARE A SECOND STYLE SYSTEM AND BOTH ARE LIVE. A literal carrying `§cred§r` must
   * come out as two runs, because that is how every sign, book and server message written before
   * components still reads. `§r` resets to the INHERITED style, not to nothing.
   */
  function pushLegacy(text, style, out) {
    if (text.indexOf('§') < 0) { if (text) out.push({ text: text, style: style || null }); return; }
    var cur = style, buf = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '§' && i + 1 < text.length) {
        var code = text.charAt(i + 1).toLowerCase();
        var known = (code === 'r') || !!CODE_TO_COLOR[code] || !!T.STYLE_CODES[code];
        if (known) {
          if (buf) { out.push({ text: buf, style: cur || null }); buf = ''; }
          if (code === 'r') cur = style;
          else if (CODE_TO_COLOR[code]) {
            // ⚠ a COLOUR code clears the decorations, which is vanilla's `§` behaviour and is why
            // `§lbold §ered` is not bold: the colour reset it.
            cur = T.mergeStyle(null, { color: CODE_TO_COLOR[code] });
          } else {
            var add = {}; add[T.STYLE_CODES[code]] = true;
            cur = T.mergeStyle(cur, add);
          }
          i++;
          continue;
        }
      }
      buf += ch;
    }
    if (buf) out.push({ text: buf, style: cur || null });
  }

  /** The whole tree as one string, styles discarded — for logs, checks and window titles. */
  T.plain = function (component) {
    var runs = T.runs(component, null), s = '';
    for (var i = 0; i < runs.length; i++) s += runs[i].text;
    return s;
  };

  // ── death messages ────────────────────────────────────────────────────────────────────────
  /**
   * ⚠ THE KEY IS THE DAMAGE SOURCE'S, and G5's ten sources are named exactly as vanilla names
   * them so the mapping is the identity. `death.attack.<id>` with the victim's name; the
   * `.player` variant when a killer is known, which is the shape vanilla uses for every source.
   * `textcheck` asserts every one of G5's sources resolves to a real key IN BOTH DIRECTIONS —
   * `pack-lang` refuses to build without the ten keys, and the check refuses a source with no key.
   */
  T.deathMessage = function (victim, cause, killer) {
    var base = 'death.attack.' + (cause || 'generic');
    // DamageSource.badRespawnPoint: "%s was killed by [Intentional Game Design]" (lang has it as .message + .link).
    if (cause === 'badRespawnPoint' && !T.has(base)) return victim + ' was killed by [Intentional Game Design]';
    if (killer) {
      var withKiller = base + '.player';
      if (T.has(withKiller)) return T.translatable(withKiller, [victim, killer]);
    }
    if (!T.has(base)) base = 'death.attack.generic';
    // #647 -- `death.attack.fireball` ("%1$s was fireballed by %2$s") takes the attacker itself
    // (no `.player` variant); an unused %2 in any other template is ignored.
    return T.translatable(base, killer ? [victim, killer] : [victim]);
  };
})(MCL);
