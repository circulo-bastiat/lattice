// 15c_chat.js — PLAN G12. The chat line, its history, and the text field that feeds it.
//
// ⚠ THE NUMBERS ARE `ChatComponent`'s OWN, not a look that reads about right. A message is visible
// for **200 ticks**, and the fade is `clamp((1 - t/200) * 10, 0, 1)` SQUARED — so it sits at full
// opacity for 180 ticks and then falls off over the last 20 in a curve, rather than dimming
// steadily for ten seconds. The box is 320 GUI pixels wide (`chatWidth` 1.0 -> `value * 280 + 40`),
// nine pixels a line, ten lines closed and twenty open, its bottom edge at `height - 40`, its left
// edge at 4, and the background is drawn at HALF the text's alpha. Every one of those is a number
// a clone gets approximately right and that reads as not-Minecraft at a glance (D-283).
//
// ⚠ AND THE HISTORY IS SEPARATE FROM THE DISPLAY. Vanilla keeps `allMessages` (the scrollback,
// capped at 100) and `trimmedMessages` (the same content word-wrapped to the current width); a
// resize re-wraps from the first, never from the second, because re-wrapping already-wrapped
// lines compounds. That split is here for the same reason (D-283).

(function (NS) {
  'use strict';

  var C = NS.Chat = {
    MAX_HISTORY: 100,       // `ChatComponent.addMessage` trims to this
    VISIBLE_TICKS: 200,     // ten seconds at 20 Hz
    LINE: 9,                // the legacy font's line height
    WIDTH: 320,             // chatWidth 1.0 -> 280 * 1.0 + 40
    LINES_CLOSED: 10,
    LINES_OPEN: 20,
    BOTTOM: -40,            // from the bottom of the screen
    LEFT: 4,
    // ⚠ THE INPUT BAR IS THE FULL SCREEN WIDTH, not the chat box's 320. `ChatScreen.render` fills
    // `(2, height - 14) .. (width - 2, height - 2)` — a band right across the bottom that the
    // hotbar is then drawn over, which is what pressing T actually looks like. Boxing it to the
    // chat's own width is the obvious thing to do and is wrong.
    INPUT_INSET: 2,
    INPUT_TOP: -14,
    INPUT_BOTTOM: -2,
    INPUT_TEXT_X: 4,
    INPUT_TEXT_Y: -12,

    messages: [],           // { component, tick } — the scrollback, newest LAST
    lines: [],              // { text, style, tick } — wrapped, newest FIRST, what is drawn
    tick: 0,
    open: false,
    input: '',
    caret: 0,
    scroll: 0,
    unread: false,          // hasUnreadNewMessages: a message arrived while scrolled up
    sent: [],               // the up-arrow history
    sentIndex: -1,
    draft: ''
  };

  /** Add a component to the chat. Everything that speaks goes through here. */
  C.add = function (component) {
    C.messages.push({ component: component, tick: C.tick });
    if (C.messages.length > C.MAX_HISTORY) C.messages.shift();
    var before = C.lines.length;
    C.rewrap();
    // vanilla ChatHud.addMessage: a focused, scrolled-up chat keeps the reader on the same text
    // (scroll(1) per new line) and flags an unread message for the scrollbar colour.
    var added = C.lines.length - before;
    if (C.open && C.scroll > 0 && added > 0) {
      C.unread = true;
      C.scroll = Math.min(Math.max(0, C.lines.length - C.LINES_OPEN), C.scroll + added);
    }
    return C.messages[C.messages.length - 1];
  };

  /** A plain string, for the places that have one. */
  C.say = function (text) { return C.add(NS.Text ? NS.Text.literal(text) : { text: String(text) }); };

  /**
   * Re-wrap every message from the SCROLLBACK.
   * ⚠ NOT from `lines`. Re-wrapping already-wrapped text compounds: a resize narrower then wider
   * leaves breaks where the first pass put them, and vanilla's split exists to stop exactly that.
   */
  C.rewrap = function () {
    var T = NS.Text, G = NS.Gui;
    C.lines = [];
    for (var m = C.messages.length - 1; m >= 0; m--) {
      var msg = C.messages[m];
      var runs = T ? T.runs(msg.component, null) : [{ text: String(msg.component && msg.component.text || ''), style: null }];
      var wrapped = wrapRuns(runs, C.WIDTH, G);
      // ⚠ the wrapped lines of ONE message go in top-to-bottom order, but the list is newest
      // first, so they are pushed in reverse — otherwise a two-line message reads upside down.
      for (var w = wrapped.length - 1; w >= 0; w--) {
        C.lines.push({ runs: wrapped[w], tick: msg.tick });
      }
    }
  };

  /** Measure a string in GUI pixels, using the real glyph widths when the font is up. */
  function widthOf(s) {
    var G = NS.Gui;
    return (G && G.widths) ? G.textWidth(s) : s.length * 6;
  }
  C.widthOf = widthOf;

  /**
   * Word-wrap a run list to `max` GUI pixels, keeping each run's style.
   * ⚠ A WORD LONGER THAN THE LINE IS BROKEN MID-WORD rather than overflowing, which is what
   * vanilla's `StringSplitter` does — a 400-pixel unbroken string of `m`s must not draw past the
   * edge of the box and over the world.
   */
  function wrapRuns(runs, max, G) {
    var out = [], line = [], x = 0;
    function flush() { if (line.length) { out.push(line); line = []; x = 0; } }
    for (var i = 0; i < runs.length; i++) {
      var style = runs[i].style, text = runs[i].text;
      // split into words, keeping the spaces attached to the word before them
      var tokens = text.match(/\S+\s*|\s+/g) || [];
      for (var t = 0; t < tokens.length; t++) {
        var tok = tokens[t], w = widthOf(tok);
        if (x > 0 && x + w > max) { flush(); tok = tok.replace(/^\s+/, ''); w = widthOf(tok); }
        while (w > max) {
          // one token longer than a whole line: take as many characters as fit
          var take = 0, tw = 0;
          while (take < tok.length) {
            var cw = widthOf(tok.charAt(take));
            if (tw + cw > max) break;
            tw += cw; take++;
          }
          if (take === 0) take = 1;
          line.push({ text: tok.slice(0, take), style: style });
          flush();
          tok = tok.slice(take); w = widthOf(tok);
        }
        if (tok) { line.push({ text: tok, style: style }); x += w; }
      }
    }
    flush();
    return out.length ? out : [[{ text: '', style: null }]];
  }
  C.wrapRuns = wrapRuns;

  /**
   * `ChatComponent.getTimeFactor`, exactly.
   * ⚠ THE SQUARE IS THE POINT. `(1 - t/200) * 10` clamped is 1 until t = 180 and then falls
   * linearly to 0 over twenty ticks; squaring it makes the last of those twenty much faster than
   * the first, which is the shape the real thing has. A plain linear fade over ten seconds looks
   * like a different game.
   */
  C.alphaAt = function (ticksAgo) {
    var d = 1 - (ticksAgo / C.VISIBLE_TICKS);
    d *= 10;
    if (d < 0) d = 0; else if (d > 1) d = 1;
    return d * d;
  };

  /** One tick. The age of every message is measured against this counter, not against the clock. */
  C.tickChat = function () { C.tick++; };

  /** The lines that should be drawn this frame, newest first, with their alpha. */
  C.visible = function () {
    var out = [], limit = C.open ? C.LINES_OPEN : C.LINES_CLOSED;
    var start = C.open ? C.scroll : 0;
    for (var i = start; i < C.lines.length && out.length < limit; i++) {
      var age = C.tick - C.lines[i].tick;
      // ⚠ AN OPEN CHAT SHOWS EVERYTHING AT FULL OPACITY, however old. Vanilla's `flag` again:
      // opening the chat is how you read what you missed, so the fade is suspended while it is up.
      var a = C.open ? 1 : C.alphaAt(age);
      if (a <= 0) break;                 // the list is newest first, so everything after is older
      out.push({ runs: C.lines[i].runs, alpha: a });
    }
    return out;
  };

  // ── the text field ────────────────────────────────────────────────────────────────────────
  C.openChat = function (prefill) {
    C.open = true;
    C.unread = false;
    C.input = prefill || '';
    C.caret = C.input.length;
    C.scroll = 0;
    C.sentIndex = -1;
  };
  C.closeChat = function () { C.open = false; C.input = ''; C.caret = 0; C.scroll = 0; C.unread = false; };

  /** Vanilla's 256-character cap, and the same trim on send. */
  C.MAX_INPUT = 256;

  C.type = function (str) {
    if (!C.open || !str) return;
    var room = C.MAX_INPUT - C.input.length;
    if (room <= 0) return;
    var add = str.slice(0, room);
    C.input = C.input.slice(0, C.caret) + add + C.input.slice(C.caret);
    C.caret += add.length;
  };

  C.backspace = function () {
    if (!C.open || C.caret <= 0) return;
    C.input = C.input.slice(0, C.caret - 1) + C.input.slice(C.caret);
    C.caret--;
  };
  C.del = function () {
    if (!C.open || C.caret >= C.input.length) return;
    C.input = C.input.slice(0, C.caret) + C.input.slice(C.caret + 1);
  };
  C.move = function (d) { C.caret = Math.max(0, Math.min(C.input.length, C.caret + d)); };

  /**
   * Tab completion. ⚠ IT REPLACES THE WORD UNDER THE CARET, not the line: the completer hands
   * back the cursor of the word it is completing, and anything else makes Tab eat what the
   * player already typed. Repeated Tab cycles, which is what vanilla does.
   */
  C.completeIndex = -1;
  C.completeAt = -1;
  C.complete = function () {
    if (!C.open || !NS.Commands) return false;
    if (C.input.charAt(0) !== '/') return false;
    var s2 = NS.Commands.suggest(C.input.substring(0, C.caret), NS.Player, {});
    if (!s2.matches.length) { C.completeIndex = -1; return false; }
    if (C.completeAt !== s2.start) { C.completeAt = s2.start; C.completeIndex = 0; }
    else C.completeIndex = (C.completeIndex + 1) % s2.matches.length;
    var pick = s2.matches[C.completeIndex];
    C.input = C.input.substring(0, s2.start) + pick + C.input.substring(C.caret);
    C.caret = s2.start + pick.length;
    return true;
  };
  C.home = function () { C.caret = 0; };
  C.end = function () { C.caret = C.input.length; };

  /** Up and down walk the sent history, as vanilla's `ChatScreen.moveInHistory` does. */
  C.history = function (d) {
    if (!C.sent.length) return;
    var i = C.sentIndex + d;
    if (i < -1) i = -1;
    if (i >= C.sent.length) i = C.sent.length - 1;
    if (i === C.sentIndex) return;
    if (C.sentIndex < 0) C.draft = C.input;   // vanilla chatLastMessage: saved when leaving the bottom entry
    C.sentIndex = i;
    C.input = (i < 0) ? (C.draft || '') : C.sent[C.sent.length - 1 - i];
    C.caret = C.input.length;
  };

  C.scrollBy = function (d) {
    if (!C.open) return;
    C.scroll = Math.max(0, Math.min(Math.max(0, C.lines.length - C.LINES_OPEN), C.scroll + d));
    if (C.scroll === 0) C.unread = false;
  };

  /**
   * Send what is typed.
   * ⚠ THE FORMAT IS `chat.type.text` — `<%s> %s` — and it comes from the language table rather
   * than being built with string concatenation, because that is the key a resource pack changes
   * and the only reason the translatable form exists.
   */
  C.send = function (playerName) {
    if (!C.open) return null;
    var text = C.input.trim();
    C.closeChat();
    if (!text) return null;
    // vanilla ChatHud.addToMessageHistory: no consecutive duplicates, and no cap
    if (C.sent[C.sent.length - 1] !== text) C.sent.push(text);
    var T = NS.Text;
    // ⚠ PLAN G12b — A LINE THAT STARTS WITH `/` IS A COMMAND AND IS NOT SAID. Vanilla does not
    // echo it into the chat as `<Player> /seed`; it runs it and prints whatever the command
    // produced, and a failure comes back in RED with the offending text and `<--[HERE]` under
    // it. `//` is not an escape in vanilla either — it is an unknown command.
    if (text.charAt(0) === '/') {
      // #1890: `/ss` is a debug command, not one of vanilla's 74, so it is taken here and never reaches Brigadier
      if (/^\/ss(\s|$)/i.test(text) && NS.SS) { NS.SS.request('/ss'); return null; }
      var res = NS.Commands ? NS.Commands.run(text, NS.Player, { name: playerName || 'Player' }) : null;
      if (!res) { C.say(text); return null; }
      for (var i = 0; i < res.lines.length; i++) {
        C.add(res.ok ? (T ? T.literal(res.lines[i]) : { text: res.lines[i] })
                     : (T ? T.literal(res.lines[i], { color: 'red' }) : { text: res.lines[i] }));
      }
      return null;
    }
    var msg = T ? T.translatable('chat.type.text', [playerName || 'Player', text])
      : { text: '<' + (playerName || 'Player') + '> ' + text };
    C.add(msg);
    return msg;
  };

  C.reset = function () {
    C.messages = []; C.lines = []; C.tick = 0; C.open = false;
    C.input = ''; C.caret = 0; C.scroll = 0; C.sent = []; C.sentIndex = -1; C.draft = '';
  };
})(MCL);
