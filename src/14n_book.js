// 14n_book.js -- #8067 (G19e): reading a written book. Port of WrittenBookItem (isValid, getName, appendTooltip, use) and the page
// model of BookScreen (114px text wrap, page buttons, item.book.page_turn). A stack's NBT is stack.t (D-267); no DOM here.
(function (NS) {
  'use strict';

  var B = NS.Book = {
    MAX_TITLE_LENGTH: 32, MAX_PAGE_LENGTH: 32767, TEXT_WIDTH: 114, MAX_LINES: 14, PAGE_TURN_SOUND: 'item.book.page_turn',
    GRAY: 0xAAAAAA   // Formatting.GRAY, the colour of both tooltip lines
  };

  function str(v) { return typeof v === 'string' ? v : ''; }

  /** WritableBookItem.isValid: a "pages" list whose every string is at most 32767 long. */
  B.isWritableValid = function (t) {
    if (!t || !Array.isArray(t.pages)) return false;
    for (var i = 0; i < t.pages.length; i++) if (str(t.pages[i]).length > B.MAX_PAGE_LENGTH) return false;
    return true;
  };

  /** WrittenBookItem.isValid: as above, plus a string title of at most 32 and a string author. */
  B.isValid = function (t) {
    if (!B.isWritableValid(t)) return false;
    if (typeof t.title !== 'string' || t.title.length > B.MAX_TITLE_LENGTH) return false;
    return typeof t.author === 'string';
  };

  B.generation = function (s) { return (s && s.t && s.t.generation) | 0; };
  B.pageCount = function (s) { return s && s.t && Array.isArray(s.t.pages) ? s.t.pages.length : 0; };

  /** getName: the title when it is not blank, else null (the caller falls back to the item's own name). */
  B.name = function (s) {
    var title = s && s.t ? str(s.t.title) : '';
    return title.trim().length ? title : null;
  };

  /** appendTooltip: "by <author>" when the author is not blank, then "book.generation.<n>"; both gray. Only if the stack has NBT. */
  B.tooltip = function (s) {
    var out = [], T = NS.Text;
    if (!s || !s.t) return out;
    var author = str(s.t.author);
    if (author.trim().length) out.push({ text: T.translate('book.byAuthor', [author]), rgb: B.GRAY });
    out.push({ text: T.translate('book.generation.' + B.generation(s)), rgb: B.GRAY });
    return out;
  };

  /** hasGlint: a written book always glints. */
  B.hasGlint = function () { return true; };

  /**
   * Word-wrap one page to `width` (BookScreen wraps at 114). `measure(str)` is the pixel width (G.textWidth in the game).
   * Explicit \n breaks a line; a word longer than a line is split by characters.
   */
  B.wrap = function (text, width, measure) {
    width = width || B.TEXT_WIDTH;
    var lines = [];
    var paras = str(text).split('\n');
    for (var p = 0; p < paras.length; p++) {
      var line = '', words = paras[p].match(/\S+\s*|\s+/g) || [];
      for (var k = 0; k < words.length; k++) {
        var w = words[k];
        if (line && measure((line + w).replace(/\s+$/, '')) > width) { lines.push(line); line = ''; w = w.replace(/^\s+/, ''); }
        while (w && measure(w.replace(/\s+$/, '')) > width) {
          var take = 0;
          while (take < w.length && measure(w.slice(0, take + 1)) <= width) take++;
          if (take === 0) take = 1;
          lines.push(w.slice(0, take)); w = w.slice(take);
        }
        line += w;
      }
      lines.push(line);
    }
    return lines;
  };

  /** Reading state (BookScreen): open on page 0; next/back buttons clamp and play the page-turn sound only when the page changes. */
  B.open = function (stack) {
    if (!stack || !stack.t || !B.isValid(stack.t)) return null;   // useBook only opens a valid book
    return { stack: stack, page: 0, pages: B.pageCount(stack), sounds: [] };
  };
  B.turn = function (r, d) {
    var np = Math.max(0, Math.min(Math.max(r.pages - 1, 0), r.page + d));
    if (np === r.page) return false;
    r.page = np; r.sounds.push(B.PAGE_TURN_SOUND); return true;
  };
  B.nextVisible = function (r) { return r.page < r.pages - 1; };
  B.backVisible = function (r) { return r.page > 0; };
  B.indicator = function (r) { return NS.Text.translate('book.pageIndicator', [String(r.page + 1), String(Math.max(r.pages, 1))]); };
  /** LecternScreen state: reads the lectern BE's book; the page buttons go through Use.lecternButton (prev 1, next 2, take 3). */
  B.openLectern = function (x, y, z) {
    var be = NS.BlockEntities.get(x, y, z);
    if (!be || !be.book) return null;
    var r = { x: x, y: y, z: z, stack: be.book, page: be.page | 0, pages: B.pageCount(be.book), sounds: [] };
    r.button = function (id) { var ok = NS.Use.lecternButton(x, y, z, null, id); var b = NS.BlockEntities.get(x, y, z); r.page = b && b.book ? b.page | 0 : r.page; return ok; };
    return r;
  };
  NS.Use = NS.Use || {};
  if (!NS.Use.onLecternScreen) NS.Use.onLecternScreen = function (x, y, z) { B.screen = B.openLectern(x, y, z); };
})(typeof MCL !== 'undefined' ? MCL : globalThis);
