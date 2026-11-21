// 14p_search.js — #11724: net.minecraft.client.search.* (Searchable, SearchableContainer, SuffixArray, IdentifierSearchableContainer,
// TextSearchableContainer) and net.minecraft.client.toast.* (SystemToast, RecipeToast) data model. Read off .decomp/net/minecraft/client/{search,toast}.
// Runs on: MAIN THREAD ONLY. Search is used by the creative search tab (15e_creative.js C.stacks).
// Toasts are records on NS.Toasts.list {kind,type,title,desc,start,...}; the HUD may draw them. Draw code stays in the HUD.
(function (NS) {
  'use strict';
  // ── SuffixArray<T> (vanilla sorts with fastutil quickSort over (key, next-key) pairs; any correct sort gives the same array) ──
  function SuffixArray() { this.objects = []; this.chars = []; this.textStarts = []; this.sIdx = []; this.off = []; this.maxLen = 0; }
  SuffixArray.prototype.add = function (obj, text) {
    this.maxLen = Math.max(this.maxLen, text.length);
    var n = this.objects.length; this.objects.push(obj); this.textStarts.push(this.chars.length);
    for (var i = 0; i < text.length; i++) { this.sIdx.push(n); this.off.push(i); this.chars.push(text.charCodeAt(i)); }
    this.sIdx.push(n); this.off.push(text.length); this.chars.push(-1);
  };
  SuffixArray.prototype.build = function () {
    var N = this.chars.length, a = new Array(N), b = new Array(N), idx = new Array(N), r = this.chars.slice(), i, k;
    for (k = 1; k * 2 < Math.min(N, this.maxLen); k *= 2) {
      for (i = 0; i < N; i++) { a[i] = r[i]; b[i] = i + k < N ? r[i + k] : -2; idx[i] = i; }
      var A = a.slice(), B = b.slice();
      idx.sort(function (x, y) { return A[x] === A[y] ? B[x] - B[y] : A[x] - A[y]; });
      var sa = new Array(N), sb = new Array(N);
      for (i = 0; i < N; i++) { sa[i] = A[idx[i]]; sb[i] = B[idx[i]]; }
      for (i = 0; i < N; i++) r[idx[i]] = (i > 0 && sa[i] === sa[i - 1] && sb[i] === sb[i - 1]) ? r[idx[i - 1]] : i;
      this._idx = idx.slice();
    }
    // vanilla quirk kept: when the doubling loop never runs (longest text <= 2 chars) its index array is still all zeros
    if (k === 1) { this._idx = []; for (i = 0; i < N; i++) this._idx.push(0); }
    var oS = this.sIdx, oO = this.off; this.sIdx = []; this.off = [];
    for (i = 0; i < N; i++) { this.sIdx.push(oS[this._idx[i]]); this.off.push(oO[this._idx[i]]); }
  };
  SuffixArray.prototype.compare = function (s, i) {
    var st = this.textStarts[this.sIdx[i]], o = this.off[i];
    for (var j = 0; j < s.length; j++) {
      var c = this.chars[st + o + j]; if (c === -1) return 1;
      var d = s.charCodeAt(j); if (d < c) return -1; if (d > c) return 1;
    }
    return 0;
  };
  SuffixArray.prototype.findAll = function (s) {
    var n = this.sIdx.length, lo = 0, hi = n, mid, c;
    while (lo < hi) { mid = lo + ((hi - lo) >> 1); if (this.compare(s, mid) > 0) lo = mid + 1; else hi = mid; }
    if (lo < 0 || lo >= n) return [];
    var first = lo; hi = n;
    while (lo < hi) { mid = lo + ((hi - lo) >> 1); c = this.compare(s, mid); if (c >= 0) lo = mid + 1; else hi = mid; }
    var seen = Object.create(null), ids = [], i;
    for (i = first; i < lo; i++) if (!seen[this.sIdx[i]]) { seen[this.sIdx[i]] = 1; ids.push(this.sIdx[i]); }
    ids.sort(function (x, y) { return x - y; });
    return ids.map(function (j) { return this.objects[j]; }, this);
  };
  // ── IdentifierSearchableContainer<T> (Searchable + SearchableContainer: add/clear/reload/findAll) ──
  // idFinder(o) -> ['ns:path', ...]; findAll('ns:path') intersects the namespace and path hits in entry order (Iterator.computeNext)
  function IdContainer(idFinder) { this.idFinder = idFinder; this.entries = []; this.entryIds = new Map(); this.byNamespace = new SuffixArray(); this.byPath = new SuffixArray(); }
  IdContainer.prototype.index = function (o) {
    this.idFinder(o).forEach(function (id) {
      var c = id.indexOf(':'), ns = c < 0 ? 'minecraft' : id.slice(0, c), p = c < 0 ? id : id.slice(c + 1);
      this.byNamespace.add(o, ns.toLowerCase()); this.byPath.add(o, p.toLowerCase());
    }, this);
  };
  IdContainer.prototype.reload = function () {
    this.byNamespace = new SuffixArray(); this.byPath = new SuffixArray();
    this.entries.forEach(this.index, this); this.byNamespace.build(); this.byPath.build();
  };
  IdContainer.prototype.add = function (o) { this.entryIds.set(o, this.entries.length); this.entries.push(o); this.index(o); };
  IdContainer.prototype.clear = function () { this.entries = []; this.entryIds.clear(); };
  IdContainer.prototype.cmp = function (x, y) { return this.entryIds.get(x) - this.entryIds.get(y); };
  // Iterator: both lists ascending by entry id; yields those in BOTH (identifier) / in EITHER, merged (text)
  function both(a, b, cmp) { var out = [], i = 0, j = 0; while (i < a.length && j < b.length) { var c = cmp(a[i], b[j]); if (c === 0) { out.push(a[i]); i++; j++; } else if (c < 0) i++; else j++; } return out; }
  function either(a, b, cmp) { var out = [], i = 0, j = 0; while (i < a.length || j < b.length) { if (i >= a.length) out.push(b[j++]); else if (j >= b.length) out.push(a[i++]); else { var c = cmp(a[i], b[j]); if (c === 0) j++; out.push(c <= 0 ? a[i++] : b[j++]); } } return out; }
  IdContainer.prototype.findAll = function (q) {
    var c = q.indexOf(':'); if (c === -1) return this.byPath.findAll(q);
    var self = this; return both(this.byNamespace.findAll(q.slice(0, c).trim()), this.byPath.findAll(q.slice(c + 1).trim()), function (x, y) { return self.cmp(x, y); });
  };
  // ── TextSearchableContainer<T> ── textFinder(o) -> ['display text', ...]
  function TextContainer(textFinder, idFinder) { IdContainer.call(this, idFinder); this.textFinder = textFinder; this.byText = new SuffixArray(); }
  TextContainer.prototype = Object.create(IdContainer.prototype);
  TextContainer.prototype.reload = function () { this.byText = new SuffixArray(); IdContainer.prototype.reload.call(this); this.byText.build(); };
  TextContainer.prototype.index = function (o) { IdContainer.prototype.index.call(this, o); this.textFinder(o).forEach(function (t) { this.byText.add(o, t.toLowerCase()); }, this); };
  TextContainer.prototype.findAll = function (q) {
    var c = q.indexOf(':'); if (c < 0) return this.byText.findAll(q);
    var self = this, p = q.slice(c + 1).trim(), cmp = function (x, y) { return self.cmp(x, y); };
    return both(this.byNamespace.findAll(q.slice(0, c).trim()), either(this.byPath.findAll(p), this.byText.findAll(p), cmp), cmp);
  };
  NS.Search = { SuffixArray: SuffixArray, IdentifierSearchableContainer: IdContainer, TextSearchableContainer: TextContainer };

  // ── toasts: ToastManager queue shared by SystemToast and RecipeToast (draw is the HUD's) ──
  var Tt = NS.Toasts = { list: [], DURATION: 5000, MIN_WIDTH: 200 };
  Tt.SYSTEM_TYPES = ['tutorial_hint', 'narrator_toggle', 'world_backup', 'pack_load_failure', 'world_access_failure', 'pack_copy_failure', 'periodic_notification', 'unsecure_server_warning'];
  // SystemToast.Type order in .decomp (field_2218..field_36445: 8 values); world_access_failure is field_23774, pack_copy_failure field_25445
  Tt.getToast = function (kind, type) { for (var i = 0; i < Tt.list.length; i++) if (Tt.list[i].kind === kind && Tt.list[i].type === type) return Tt.list[i]; return null; };
  Tt.add = function (t) { Tt.list.push(t); return t; };
  Tt.systemAdd = function (type, title, desc) { return Tt.add({ kind: 'system', type: type, title: title, desc: desc == null ? null : desc, start: 0, justUpdated: true }); };
  Tt.systemShow = function (type, title, desc) {
    var t = Tt.getToast('system', type); if (!t) return Tt.systemAdd(type, title, desc);
    t.title = title; t.desc = desc == null ? null : desc; t.justUpdated = true; return t;
  };
  Tt.worldAccessFailure = function (msg) { return Tt.systemAdd('world_access_failure', 'selectWorld.access_failure', msg); };
  Tt.worldDeleteFailure = function (msg) { return Tt.systemAdd('world_access_failure', 'selectWorld.delete_failure', msg); };
  Tt.packCopyFailure = function (msg) { return Tt.systemAdd('pack_copy_failure', 'pack.copyFailure', msg); };
  // RecipeToast.show: one toast, further recipes join it and restart its 5 s clock
  Tt.recipeShow = function (recipe) {
    var t = Tt.getToast('recipe', 'recipe');
    if (!t) return Tt.add({ kind: 'recipe', type: 'recipe', recipes: [recipe], start: 0, justUpdated: true });
    t.recipes.push(recipe); t.justUpdated = true; return t;
  };
  // the recipe whose icon is showing at `time` (RecipeToast.draw)
  Tt.recipeAt = function (t, time) { var n = t.recipes.length; return t.recipes[Math.floor(time / Math.max(1, Math.floor(Tt.DURATION / n)) % n)]; };
  // draw's visibility step: restart clock on update; hide once 5 s passed (or recipes empty). Returns true while visible.
  Tt.visible = function (t, time) {
    if (t.justUpdated) { t.start = time; t.justUpdated = false; }
    if (t.kind === 'recipe' && !t.recipes.length) return false;
    return time - t.start < Tt.DURATION;
  };
  Tt.tick = function (time) { Tt.list = Tt.list.filter(function (t) { return Tt.visible(t, time); }); };
})(MCL);
