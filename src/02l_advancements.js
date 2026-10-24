// 02l_advancements.js — PLAN G26c. Advancement, AdvancementDisplay, AdvancementFrame,
// AdvancementCriterion, AdvancementRewards, CriterionMerger, AdvancementProgress,
// AdvancementManager and AdvancementPositioner, translated from `net.minecraft.advancement`.
//
// MAIN THREAD ONLY, no DOM. The data is `tools/pack-advancements.mjs`'s 1,141 files; the
// classes here are the rules around it. Criterion CONDITIONS stay raw JSON — the trigger layer
// (G26d) reads them; an AdvancementCriterion here is `{ trigger, conditions }`.
//
// ⚠ THE POSITIONER IS FLOAT ARITHMETIC. Vanilla's rows are Java `float`s and `pushDown` divides
// by an int, so thirds appear and the order of additions decides the low bits. Every float
// assignment below goes through Math.fround so the layout is the same numbers, not close ones.
//
// ⚠ LOAD ORDER IS JAVA HASH ORDER. `AdvancementManager.load` walks a `HashMap<Identifier,…>`
// and links a child to its parent as it builds it, so the order of `Advancement.children` — and
// with it every sibling's row — is the map's iteration order. `hashOrder` reproduces it:
// Identifier.hashCode is `31*ns.hashCode + path.hashCode`, HashMap spreads with `h ^ h>>>16`
// and walks buckets low to high, table sized by the same tableSizeFor rule. Ties inside one
// bucket keep the caller's order (the jar listing's, in vanilla — unobservable here).

(function (NS) {
  'use strict';

  var Adv = NS.Adv = { ready: false, data: null, manager: null };
  var fr = Math.fround;

  // ── AdvancementFrame ──────────────────────────────────────────────────────────────────────
  // id, textureV, title format (Formatting.field_1060 = GREEN, field_1064 = DARK_PURPLE)
  Adv.FRAMES = [
    { id: 'task', textureV: 0, titleFormat: 'green', toast: 'advancements.toast.task' },
    { id: 'challenge', textureV: 26, titleFormat: 'dark_purple', toast: 'advancements.toast.challenge' },
    { id: 'goal', textureV: 52, titleFormat: 'green', toast: 'advancements.toast.goal' }
  ];
  Adv.frameForName = function (name) {
    for (var i = 0; i < Adv.FRAMES.length; i++) if (Adv.FRAMES[i].id === name) return Adv.FRAMES[i];
    throw new Error("Unknown frame type '" + name + "'");
  };

  // ── CriterionMerger ───────────────────────────────────────────────────────────────────────
  Adv.Merger = {
    AND: function (names) { return names.map(function (n) { return [n]; }); },
    OR: function (names) { return [names.slice()]; }
  };

  // ── AdvancementCriterion ──────────────────────────────────────────────────────────────────
  Adv.criterion = function (trigger, conditions) {
    return { trigger: trigger, conditions: conditions || {} };
  };

  // ── AdvancementRewards ────────────────────────────────────────────────────────────────────
  Adv.NONE = { experience: 0, loot: [], recipes: [], fn: null };
  Adv.rewards = function (r) {
    if (!r) return Adv.NONE;
    return { experience: r.xp | 0, loot: r.loot || [], recipes: r.recipes || [], fn: r.fn || null };
  };
  // AdvancementRewards.apply: the experience, the recipes, the loot rolls and the function are
  // the SERVER PLAYER's (G26d); this hands the host the four parts in vanilla's order.
  Adv.applyRewards = function (rw, host) {
    if (rw.experience && host.addExperience) host.addExperience(rw.experience);
    if (rw.loot.length && host.giveLoot) for (var i = 0; i < rw.loot.length; i++) host.giveLoot(rw.loot[i]);
    if (rw.recipes.length && host.unlockRecipes) host.unlockRecipes(rw.recipes);
    if (rw.fn && host.runFunction) host.runFunction(rw.fn);
  };

  // ── AdvancementDisplay ────────────────────────────────────────────────────────────────────
  function display(d) {
    return {
      title: d.t, description: d.ds, icon: { item: d.i, nbt: d.n === undefined ? null : d.n },
      background: d.b === undefined ? null : d.b, frame: Adv.FRAMES[d.f],
      showToast: d.s, announceToChat: d.a, hidden: d.h, x: 0, y: 0,
      setPos: function (x, y) { this.x = x; this.y = y; }
    };
  }

  // ── Advancement ───────────────────────────────────────────────────────────────────────────
  // A Builder is the packed record; `build` links the parent and the parent's children set.
  Adv.Advancement = function (id, parent, disp, rewards, criteria, requirements) {
    this.id = id; this.parent = parent; this.display = disp; this.rewards = rewards;
    this.criteria = criteria; this.requirements = requirements; this.children = [];
    if (parent) parent.addChild(this);
  };
  Adv.Advancement.prototype.addChild = function (a) {
    if (this.children.indexOf(a) < 0) this.children.push(a);       // LinkedHashSet
  };
  Adv.Advancement.prototype.getRequirementCount = function () { return this.requirements.length; };
  // toHoverableText: `[title]` in the frame's colour, hovering title\ndescription
  Adv.Advancement.prototype.toHoverableText = function () {
    if (!this.display) return { text: this.id };
    return { bracketed: true, title: this.display.title, description: this.display.description,
             color: this.display.frame.titleFormat };
  };

  Adv.builder = function (rec) {
    var criteria = {}, k;
    for (k in rec.c) criteria[k] = Adv.criterion(rec.c[k][0], rec.c[k][1]);
    return {
      parentId: rec.p === undefined ? null : rec.p, parentObj: null,
      display: rec.d ? display(rec.d) : null, rewards: Adv.rewards(rec.r),
      criteria: criteria, requirements: rec.q,
      findParent: function (lookup) {
        if (this.parentId === null) return true;
        if (this.parentObj === null) this.parentObj = lookup(this.parentId) || null;
        return this.parentObj !== null;
      },
      build: function (id) {
        if (!this.findParent(function () { return null; })) throw new Error('Tried to build incomplete advancement!');
        return new Adv.Advancement(id, this.parentObj, this.display, this.rewards, this.criteria, this.requirements);
      }
    };
  };

  // ── java.util.HashMap iteration order over Identifier keys ────────────────────────────────
  function strHash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h;
  }
  Adv.identifierHash = function (id) {
    var c = id.indexOf(':'), ns = c < 0 ? 'minecraft' : id.slice(0, c), p = c < 0 ? id : id.slice(c + 1);
    return (Math.imul(31, strHash(ns)) + strHash(p)) | 0;
  };
  function tableSizeFor(c) { var n = 1; while (n < c) n <<= 1; return n; }
  // `size` is the entry count: Maps.newHashMap(map) sizes for size/0.75+1, and a map filled
  // one by one has grown to the same power of two for every size that matters here (1,141).
  Adv.hashOrder = function (ids) {
    var n = tableSizeFor(Math.floor(ids.length / 0.75 + 1));
    var idx = ids.map(function (id, i) {
      var h = Adv.identifierHash(id);
      return { id: id, i: i, b: ((h ^ (h >>> 16)) & (n - 1)) };
    });
    idx.sort(function (a, b) { return a.b - b.b || a.i - b.i; });
    return idx.map(function (e) { return e.id; });
  };

  // ── AdvancementManager ────────────────────────────────────────────────────────────────────
  Adv.Manager = function () {
    this.advancements = new Map(); this.roots = []; this.dependents = []; this.listener = null;
  };
  var M = Adv.Manager.prototype;
  function without(list, x) { var i = list.indexOf(x); if (i >= 0) list.splice(i, 1); }
  M.remove = function (a) {
    for (var i = 0; i < a.children.length; i++) this.remove(a.children[i]);
    this.advancements.delete(a.id);
    if (a.parent === null) {
      without(this.roots, a);
      if (this.listener) this.listener.onRootRemoved(a);
    } else {
      without(this.dependents, a);
      if (this.listener) this.listener.onDependentRemoved(a);
    }
  };
  M.removeAll = function (ids) {
    for (var i = 0; i < ids.length; i++) {
      var a = this.advancements.get(ids[i]);
      if (a) this.remove(a);
    }
  };
  // `builders`: an ordered array of [id, builder] — the map's iteration order (see hashOrder).
  // Returns the entries that never found a parent (vanilla logs them and stops).
  M.load = function (builders) {
    var left = builders.slice(), self = this;
    while (left.length) {
      var progressed = false, next = [];
      for (var i = 0; i < left.length; i++) {
        var id = left[i][0], b = left[i][1];
        if (b.findParent(function (pid) { return self.advancements.get(pid); })) {
          var a = b.build(id);
          this.advancements.set(id, a);
          progressed = true;
          if (a.parent === null) {
            this.roots.push(a);
            if (this.listener) this.listener.onRootAdded(a);
          } else {
            this.dependents.push(a);
            if (this.listener) this.listener.onDependentAdded(a);
          }
        } else next.push(left[i]);
      }
      left = next;
      if (!progressed) break;
    }
    return left;
  };
  M.clear = function () {
    this.advancements.clear(); this.roots = []; this.dependents = [];
    if (this.listener) this.listener.onClear();
  };
  M.get = function (id) { return this.advancements.get(id) || null; };
  M.setListener = function (l) {
    this.listener = l;
    if (l) {
      this.roots.forEach(function (a) { l.onRootAdded(a); });
      this.dependents.forEach(function (a) { l.onDependentAdded(a); });
    }
  };

  // ── CriterionProgress + AdvancementProgress ───────────────────────────────────────────────
  Adv.Progress = function () { this.criteria = new Map(); this.requirements = []; };
  var P = Adv.Progress.prototype;
  P.init = function (criteria, requirements) {
    var keys = Object.keys(criteria), self = this;
    Array.from(this.criteria.keys()).forEach(function (k) { if (!(k in criteria)) self.criteria.delete(k); });
    keys.forEach(function (k) { if (!self.criteria.has(k)) self.criteria.set(k, { date: null }); });
    this.requirements = requirements;
  };
  P._req = function (row) {
    for (var i = 0; i < row.length; i++) {
      var c = this.criteria.get(row[i]);
      if (c && c.date !== null) return true;
    }
    return false;
  };
  P.isDone = function () {
    if (!this.requirements.length) return false;
    for (var i = 0; i < this.requirements.length; i++) if (!this._req(this.requirements[i])) return false;
    return true;
  };
  P.isAnyObtained = function () {
    var any = false;
    this.criteria.forEach(function (c) { if (c.date !== null) any = true; });
    return any;
  };
  P.obtain = function (name, now) {
    var c = this.criteria.get(name);
    if (c && c.date === null) { c.date = now === undefined ? Date.now() : now; return true; }
    return false;
  };
  P.reset = function (name) {
    var c = this.criteria.get(name);
    if (c && c.date !== null) { c.date = null; return true; }
    return false;
  };
  P.countObtainedRequirements = function () {
    var n = 0;
    for (var i = 0; i < this.requirements.length; i++) if (this._req(this.requirements[i])) n++;
    return n;
  };
  P.getProgressBarPercentage = function () {
    if (!this.criteria.size) return 0;
    return fr(fr(this.countObtainedRequirements()) / fr(this.requirements.length));
  };
  P.getProgressBarFraction = function () {
    if (!this.criteria.size) return null;
    var n = this.requirements.length;
    if (n <= 1) return null;
    return this.countObtainedRequirements() + '/' + n;
  };
  P.getUnobtainedCriteria = function () {
    var out = []; this.criteria.forEach(function (c, k) { if (c.date === null) out.push(k); }); return out;
  };
  P.getObtainedCriteria = function () {
    var out = []; this.criteria.forEach(function (c, k) { if (c.date !== null) out.push(k); }); return out;
  };
  P.getEarliestProgressObtainDate = function () {
    var d = null;
    this.criteria.forEach(function (c) { if (c.date !== null && (d === null || c.date < d)) d = c.date; });
    return d;
  };
  P.compareTo = function (o) {
    var a = this.getEarliestProgressObtainDate(), b = o.getEarliestProgressObtainDate();
    if (a === null && b !== null) return 1;
    if (a !== null && b === null) return -1;
    if (a === null && b === null) return 0;
    return a < b ? -1 : a > b ? 1 : 0;
  };
  // Serializer: only obtained criteria are written, plus `done`
  P.toJson = function () {
    var o = {}, cr = {}, any = false;
    this.criteria.forEach(function (c, k) { if (c.date !== null) { cr[k] = c.date; any = true; } });
    if (any) o.criteria = cr;
    o.done = this.isDone();
    return o;
  };
  Adv.Progress.fromJson = function (j) {
    var p = new Adv.Progress(), cr = (j && j.criteria) || {};
    for (var k in cr) p.criteria.set(k, { date: cr[k] });
    return p;
  };

  // ── AdvancementPositioner ─────────────────────────────────────────────────────────────────
  function Pos(advancement, parent, previousSibling, childrenSize, depth) {
    if (!advancement.display) throw new Error("Can't position an invisible advancement!");
    this.advancement = advancement; this.parent = parent; this.previousSibling = previousSibling;
    this.childrenSize = childrenSize; this.children = []; this.optionalLast = this;
    this.substituteChild = null; this.depth = depth; this.row = -1;
    this.relativeRowInSiblings = 0; this.f1266 = 0; this.f1265 = 0;
    var prev = null;
    for (var i = 0; i < advancement.children.length; i++) prev = this.findChildrenRecursively(advancement.children[i], prev);
  }
  var PP = Pos.prototype;
  PP.findChildrenRecursively = function (a, prev) {
    if (a.display) {
      prev = new Pos(a, this, prev, this.children.length + 1, this.depth + 1);
      this.children.push(prev);
    } else {
      for (var i = 0; i < a.children.length; i++) prev = this.findChildrenRecursively(a.children[i], prev);
    }
    return prev;
  };
  PP.calculateRecursively = function () {
    if (!this.children.length) {
      this.row = this.previousSibling ? fr(this.previousSibling.row + 1) : 0;
    } else {
      var last = null;
      for (var i = 0; i < this.children.length; i++) {
        var c = this.children[i];
        c.calculateRecursively();
        last = c.onFinishCalculation(last === null ? c : last);
      }
      this.onFinishChildrenCalculation();
      var mid = fr(fr(this.children[0].row + this.children[this.children.length - 1].row) / 2);
      if (this.previousSibling) {
        this.row = fr(this.previousSibling.row + 1);
        this.relativeRowInSiblings = fr(this.row - mid);
      } else this.row = mid;
    }
  };
  PP.findMinRowRecursively = function (a, depth, min) {
    this.row = fr(this.row + a);
    this.depth = depth;
    if (this.row < min) min = this.row;
    for (var i = 0; i < this.children.length; i++) {
      min = this.children[i].findMinRowRecursively(fr(a + this.relativeRowInSiblings), depth + 1, min);
    }
    return min;
  };
  PP.increaseRowRecursively = function (a) {
    this.row = fr(this.row + a);
    for (var i = 0; i < this.children.length; i++) this.children[i].increaseRowRecursively(a);
  };
  PP.onFinishChildrenCalculation = function () {
    var a = 0, b = 0;
    for (var i = this.children.length - 1; i >= 0; i--) {
      var c = this.children[i];
      c.row = fr(c.row + a);
      c.relativeRowInSiblings = fr(c.relativeRowInSiblings + a);
      b = fr(b + c.f1266);
      a = fr(a + fr(c.f1265 + b));
    }
  };
  PP.getFirstChild = function () {
    if (this.substituteChild) return this.substituteChild;
    return this.children.length ? this.children[0] : null;
  };
  PP.getLastChild = function () {
    if (this.substituteChild) return this.substituteChild;
    return this.children.length ? this.children[this.children.length - 1] : null;
  };
  PP.onFinishCalculation = function (p0) {
    if (!this.previousSibling) return p0;
    var p1 = this, p2 = this, p3 = this.previousSibling, p4 = this.parent.children[0];
    var f5 = this.relativeRowInSiblings, f6 = this.relativeRowInSiblings;
    var f7 = p3.relativeRowInSiblings, f8 = p4.relativeRowInSiblings;
    while (p3.getLastChild() !== null && p1.getFirstChild() !== null) {
      p3 = p3.getLastChild(); p1 = p1.getFirstChild(); p4 = p4.getFirstChild(); p2 = p2.getLastChild();
      p2.optionalLast = this;
      var f9 = fr(fr(fr(p3.row + f7) - fr(p1.row + f5)) + 1);
      if (f9 > 0) {
        p3.getLast(this, p0).pushDown(this, f9);
        f5 = fr(f5 + f9);
        f6 = fr(f6 + f9);
      }
      f7 = fr(f7 + p3.relativeRowInSiblings);
      f5 = fr(f5 + p1.relativeRowInSiblings);
      f8 = fr(f8 + p4.relativeRowInSiblings);
      f6 = fr(f6 + p2.relativeRowInSiblings);          // the for-loop update expression
    }
    if (p3.getLastChild() !== null && p2.getLastChild() === null) {
      p2.substituteChild = p3.getLastChild();
      p2.relativeRowInSiblings = fr(p2.relativeRowInSiblings + fr(f7 - f6));
    } else {
      if (p1.getFirstChild() !== null && p4.getFirstChild() === null) {
        p4.substituteChild = p1.getFirstChild();
        p4.relativeRowInSiblings = fr(p4.relativeRowInSiblings + fr(f5 - f8));
      }
      p0 = this;
    }
    return p0;
  };
  PP.pushDown = function (p, amount) {
    var d = fr(p.childrenSize - this.childrenSize);
    if (d !== 0) {
      p.f1266 = fr(p.f1266 - fr(amount / d));
      this.f1266 = fr(this.f1266 + fr(amount / d));
    }
    p.f1265 = fr(p.f1265 + amount);
    p.row = fr(p.row + amount);
    p.relativeRowInSiblings = fr(p.relativeRowInSiblings + amount);
  };
  PP.getLast = function (p, other) {
    return this.optionalLast !== null && p.parent.children.indexOf(this.optionalLast) >= 0 ? this.optionalLast : other;
  };
  PP.apply = function () {
    if (this.advancement.display) this.advancement.display.setPos(this.depth, this.row);
    for (var i = 0; i < this.children.length; i++) this.children[i].apply();
  };
  Adv.arrangeForTree = function (root) {
    if (!root.display) throw new Error("Can't position children of an invisible root!");
    var p = new Pos(root, null, null, 1, 0);
    p.calculateRecursively();
    var min = p.findMinRowRecursively(0, 0, p.row);
    if (min < 0) p.increaseRowRecursively(fr(-min));
    p.apply();
  };

  // ── PlayerAdvancementTracker + the trigger entry point (G26d) ─────────────────────────────
  // `host` is the server player: { addExperience, giveLoot, unlockRecipes, runFunction (rewards),
  // onGrant(adv) (toast + chat; vanilla gates the chat line on gamerule announceAdvancements) }.
  Adv.Tracker = function (host) { this.host = host; this.progress = new Map(); };
  var T = Adv.Tracker.prototype;
  T.getProgress = function (a) {
    var p = this.progress.get(a.id);
    if (!p) { p = new Adv.Progress(); p.init(a.criteria, a.requirements); this.progress.set(a.id, p); }
    return p;
  };
  T.grantCriterion = function (a, name) {
    var p = this.getProgress(a), was = p.isDone();
    if (!p.obtain(name)) return false;
    if (!was && p.isDone()) {
      Adv.applyRewards(a.rewards, this.host);
      if (this.host.onGrant) this.host.onGrant(a);
    }
    return true;
  };
  // PlayerAdvancementTracker.save/load: advancements/<uuid>.json, here the `advancements` key of the MC-Lite save.
  // { id: Progress.toJson } for every advancement with any obtained criterion; load never re-grants (no rewards, no toast).
  T.toJson = function () {
    var o = {};
    this.progress.forEach(function (p, id) { if (p.isAnyObtained()) o[id] = p.toJson(); });
    return o;
  };
  T.load = function (j) {
    this.progress.clear();
    if (!j || !Adv.manager) return this;
    for (var id in j) {
      var a = Adv.manager.advancements.get(id);
      if (!a) continue;   // an advancement the data pack no longer has is dropped, as vanilla does
      var p = this.getProgress(a), cr = (j[id] && j[id].criteria) || {};
      for (var k in cr) { var c = p.criteria.get(k); if (c) c.date = cr[k]; }
    }
    return this;
  };
  T.revokeCriterion = function (a, name) { return this.getProgress(a).reset(name); };
  // Per-trigger condition tests: matchers[triggerId](conditions, ctx) -> bool. A trigger with no
  // matcher fires only for criteria with no conditions (bar `player`); the rest are owed per trigger.
  // ── predicate substrate (G17-AT0): NumberRange, EntityPredicate & friends over the raw conditions JSON ──
  // Adv.pred.<kind>(json, ctx[, subject]) -> bool; an absent/null json is ANY. Subjects are plain objects the
  // trigger host builds: entity { type, x, y, z, onFire, sneaking, sprinting, swimming, baby, equipment:{head,
  // chest,legs,feet,mainhand,offhand}, vehicle, passengers[], target, nbt }, stack { id, count, damage,
  // maxDamage, nbt, enchants:{id:lvl}, storedEnchants, potion }, damage { projectile, explosive, bypassesArmor,
  // outOfWorld, unblockable, fire, magic, lightning, source, attacker }. ctx { origin:[x,y,z], dimension,
  // inTag(kind, tagId, id), biomeAt, structureAt, smokeyAt, lightAt, blockAt, fluidAt } - a missing hook with a
  // condition that needs it fails closed.
  var P = Adv.pred = {};
  function has(j) { return j !== undefined && j !== null; }
  function stripNs(id) { return String(id).indexOf(':') < 0 ? 'minecraft:' + id : String(id); }
  // NumberRange: a bare number is min==max; {min,max} either optional. Int test, float test, testSqrt.
  P.range = function (j, v) {
    if (!has(j)) return true;
    var min, max;
    if (typeof j === 'number') min = max = j; else { min = j.min; max = j.max; }
    return !((has(min) && min > v) || (has(max) && max < v));
  };
  P.rangeSqrt = function (j, v) {
    if (!has(j)) return true;
    var min, max;
    if (typeof j === 'number') min = max = j; else { min = j.min; max = j.max; }
    return !((has(min) && min * min > v) || (has(max) && max * max < v));
  };
  var fround = Math.fround;
  P.distance = function (j, ax, ay, az, bx, by, bz) {
    if (!has(j)) return true;
    var dx = fround(ax - bx), dy = fround(ay - by), dz = fround(az - bz);
    return P.range(j.x, Math.abs(dx)) && P.range(j.y, Math.abs(dy)) && P.range(j.z, Math.abs(dz)) &&
      P.rangeSqrt(j.horizontal, fround(dx * dx + dz * dz)) && P.rangeSqrt(j.absolute, fround(dx * dx + dy * dy + dz * dz));
  };
  // NbtPredicate: the stored compound must contain the predicate's (NbtHelper.matches, subset, lists any-order)
  function nbtSub(want, have) {
    if (want === have) return true;
    if (want && typeof want === 'object') {
      if (!have || typeof have !== 'object') return false;
      if (Array.isArray(want)) {
        if (!Array.isArray(have)) return false;
        return want.every(function (w) { return have.some(function (h) { return nbtSub(w, h); }); });
      }
      for (var k in want) if (!nbtSub(want[k], have[k])) return false;
      return true;
    }
    return false;
  }
  P.nbt = function (j, nbt) {
    if (!has(j)) return true;
    var want = typeof j === 'string' ? JSON.parse(j.replace(/(\w+):/g, '"$1":')) : j;
    return nbt ? nbtSub(want, nbt) : false;
  };
  P.entityType = function (j, ctx, type) {
    if (!has(j)) return true;
    if (j.charAt(0) === '#') return !!(ctx && ctx.inTag && ctx.inTag('entity_type', j.slice(1), stripNs(type)));
    return stripNs(j) === stripNs(type);
  };
  function enchOk(list, have) {
    if (!list) return true;
    for (var i = 0; i < list.length; i++) {
      var e = list[i], lvl = have ? have[stripNs(e.enchantment || '')] : undefined;
      if (has(e.enchantment) ? lvl === undefined : !have || !Object.keys(have).some(function (k) { return P.range(e.levels, have[k]); })) return false;
      if (has(e.enchantment) && !P.range(e.levels, lvl)) return false;
    }
    return true;
  }
  P.item = function (j, ctx, st) {
    if (!has(j)) return true;
    if (!st) return false;
    if (has(j.tag) && !(ctx && ctx.inTag && ctx.inTag('item', stripNs(j.tag), stripNs(st.id)))) return false;
    if (j.items && j.items.map(stripNs).indexOf(stripNs(st.id)) < 0) return false;
    if (!P.range(j.count, st.count)) return false;
    if (has(j.durability) && !(st.maxDamage > 0)) return false;
    if (!P.range(j.durability, (st.maxDamage || 0) - (st.damage || 0))) return false;
    if (!P.nbt(j.nbt, st.nbt)) return false;
    if (!enchOk(j.enchantments, st.enchants) || !enchOk(j.stored_enchantments, st.storedEnchants)) return false;
    return !has(j.potion) || stripNs(j.potion) === stripNs(st.potion || 'minecraft:empty');
  };
  P.location = function (j, ctx, x, y, z) {
    if (!has(j)) return true;
    var pos = j.position || {};
    if (!P.range(pos.x, x) || !P.range(pos.y, y) || !P.range(pos.z, z)) return false;
    if (has(j.dimension) && (!ctx || stripNs(j.dimension) !== stripNs(ctx.dimension))) return false;
    var bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (has(j.biome) && !(ctx && ctx.biomeAt && stripNs(ctx.biomeAt(bx, by, bz)) === stripNs(j.biome))) return false;
    if (has(j.feature) && !(ctx && ctx.structureAt && ctx.structureAt(bx, by, bz, stripNs(j.feature)))) return false;
    if (has(j.smokey) && !(ctx && ctx.smokeyAt && ctx.smokeyAt(bx, by, bz) === j.smokey)) return false;
    if (has(j.light) && !(ctx && ctx.lightAt && P.range(j.light.light, ctx.lightAt(bx, by, bz)))) return false;
    if (has(j.block) && !(ctx && ctx.blockAt && P.block(j.block, ctx, ctx.blockAt(bx, by, bz)))) return false;
    if (has(j.fluid) && !(ctx && ctx.fluidAt && P.fluid(j.fluid, ctx, ctx.fluidAt(bx, by, bz)))) return false;
    return true;
  };
  // block { id, state:{}} ; BlockPredicate: blocks[] / tag / state / nbt
  P.block = function (j, ctx, b) {
    if (!has(j)) return true;
    if (!b) return false;
    if (has(j.tag) && !(ctx && ctx.inTag && ctx.inTag('block', stripNs(j.tag), stripNs(b.id)))) return false;
    if (j.blocks && j.blocks.map(stripNs).indexOf(stripNs(b.id)) < 0) return false;
    for (var k in (j.state || {})) if (String((b.state || {})[k]) !== String(j.state[k])) return false;
    return P.nbt(j.nbt, b.nbt);
  };
  P.fluid = function (j, ctx, f) {
    if (!has(j)) return true;
    if (!f) return false;
    if (has(j.tag) && !(ctx && ctx.inTag && ctx.inTag('fluid', stripNs(j.tag), stripNs(f.id)))) return false;
    if (has(j.fluid) && stripNs(j.fluid) !== stripNs(f.id)) return false;
    for (var k in (j.state || {})) if (String((f.state || {})[k]) !== String(j.state[k])) return false;
    return true;
  };
  function flag(j, v) { return !has(j) || !!v === j; }
  P.flags = function (j, e) {
    if (!has(j)) return true;
    return flag(j.is_on_fire, e.onFire) && flag(j.is_sneaking, e.sneaking) && flag(j.is_sprinting, e.sprinting) &&
      flag(j.is_swimming, e.swimming) && (!has(j.is_baby) || e.baby === undefined || !!e.baby === j.is_baby);
  };
  P.equipment = function (j, ctx, e) {
    if (!has(j)) return true;
    if (!e.equipment) return false;
    var slots = ['head', 'chest', 'legs', 'feet', 'mainhand', 'offhand'];
    return slots.every(function (s) { return P.item(j[s], ctx, e.equipment[s]); });
  };
  // EntityPredicate.test(world, origin, entity)
  P.entity = function (j, ctx, e) {
    if (!has(j) || (typeof j === 'object' && !Object.keys(j).length)) return true;
    if (!e) return false;
    if (!P.entityType(j.type, ctx, e.type)) return false;
    var o = ctx && ctx.origin;
    if (!o) { if (has(j.distance)) return false; }
    else if (!P.distance(j.distance, o[0], o[1], o[2], e.x, e.y, e.z)) return false;
    if (!P.location(j.location, ctx, e.x, e.y, e.z)) return false;
    if (has(j.stepping_on) && !P.location(j.stepping_on, ctx, Math.floor(e.x) + 0.5, Math.floor(e.y - 0.2) + 0.5, Math.floor(e.z) + 0.5)) return false;
    if (has(j.effects)) {
      for (var id in j.effects) {
        var fx = (e.effects || {})[stripNs(id)], w = j.effects[id];
        if (!fx || !P.range(w.amplifier, fx.amplifier) || !P.range(w.duration, fx.duration) ||
          (has(w.ambient) && w.ambient !== !!fx.ambient) || (has(w.visible) && w.visible !== !!fx.visible)) return false;
      }
    }
    if (!P.nbt(j.nbt, e.nbt) || !P.flags(j.flags, e) || !P.equipment(j.equipment, ctx, e)) return false;
    if (has(j.lightning_bolt)) {   // LightningBoltPredicate.test
      if (e.type !== 'lightning_bolt' || !P.range(j.lightning_bolt.blocks_set_on_fire, e.blocksSetOnFire || 0)) return false;
      if (has(j.lightning_bolt.entity_struck)) {
        var EL = NS.EntityList, st = e.struckIds || {};
        if (!((EL && EL.list) || []).some(function (q) { return q && st[q.id] && P.entity(j.lightning_bolt.entity_struck, ctx, q); })) return false;
      }
    }
    // PlayerPredicate.looking_at: the entity under the crosshair (P.targetEntity, reach-limited) matches
    if (has(j.player) && has(j.player.looking_at) && !P.entity(j.player.looking_at, ctx, e.targetEntity)) return false;
    if (has(j.vehicle) && !P.entity(j.vehicle, ctx, e.vehicle)) return false;
    if (has(j.passenger) && !(e.passengers || []).some(function (q) { return P.entity(j.passenger, ctx, q); })) return false;
    if (has(j.targeted_entity) && !P.entity(j.targeted_entity, ctx, e.target)) return false;
    return !has(j.team) || e.team === j.team;
  };
  // DamageSourcePredicate.test(world, origin, source)
  P.damage = function (j, ctx, d) {
    if (!has(j) || !Object.keys(j).length) return true;
    if (!d) return false;
    if (!flag(j.is_projectile, d.projectile) || !flag(j.is_explosion, d.explosive) || !flag(j.bypasses_armor, d.bypassesArmor) ||
      !flag(j.bypasses_invulnerability, d.outOfWorld) || !flag(j.bypasses_magic, d.unblockable) || !flag(j.is_fire, d.fire) ||
      !flag(j.is_magic, d.magic) || !flag(j.is_lightning, d.lightning)) return false;
    return P.entity(j.direct_entity, ctx, d.source) && P.entity(j.source_entity, ctx, d.attacker);
  };
  // the player_killed_entity-style `entity` field: a list of loot conditions (AdvancementEntityPredicateDeserializer);
  // only entity_properties (entity this / killer / killer_player) is a predicate on a trigger subject here.
  P.extended = function (list, ctx, subjects) {
    if (!has(list)) return true;
    return list.every(function one(c) {
      if (c.condition === 'minecraft:inverted') return !one(c.term);   // InvertedLootCondition
      if (c.condition !== 'minecraft:entity_properties') return false;
      return P.entity(c.predicate, ctx, subjects[c.entity || 'this']);
    });
  };

  Adv.matchers = {};
  // TameAnimalCriterion.Conditions.matches: the `entity` loot-condition list tested on the tamed animal
  // HeroOfTheVillageCriterion.Conditions.matches: always true (only the player predicate, handled by the caller)
  Adv.matchers['minecraft:hero_of_the_village'] = function () { return true; };
  Adv.matchers['minecraft:tame_animal'] = function (cond, ctx) {
    var e = ctx && ctx.entity;
    return P.extended(cond.entity, { origin: ctx && ctx.origin }, { 'this': e });
  };
  // PlayerHurtEntityCriterion.Conditions.matches: ctx { target, source (damage subject), dealt, taken, blocked }.
  // DamagePredicate.test(dealt, taken, source_entity vs the attacker, blocked, type) then the `entity` predicate.
  Adv.matchers['minecraft:player_hurt_entity'] = function (cond, ctx) {
    var d = cond.damage;
    if (has(d) && Object.keys(d).length) {
      if (!P.range(d.dealt, ctx.dealt) || !P.range(d.taken, ctx.taken)) return false;
      if (!P.entity(d.source_entity, ctx.pctx, ctx.source && ctx.source.attacker)) return false;
      if (has(d.blocked) && d.blocked !== !!ctx.blocked) return false;
      if (!P.damage(d.type, ctx.pctx, ctx.source)) return false;
    }
    return P.extended(cond.entity, ctx.pctx, { 'this': ctx.target });
  };
  // EntityHurtPlayerCriterion.Conditions.matches: DamagePredicate.test(player, source, dealt, taken, blocked); ctx { source, dealt, taken, blocked, pctx }.
  Adv.matchers['minecraft:entity_hurt_player'] = function (cond, ctx) {
    var d = cond.damage;
    if (!has(d) || !Object.keys(d).length) return true;
    if (!P.range(d.dealt, ctx.dealt) || !P.range(d.taken, ctx.taken)) return false;
    if (!P.entity(d.source_entity, ctx.pctx, ctx.source && ctx.source.attacker)) return false;
    if (has(d.blocked) && d.blocked !== !!ctx.blocked) return false;
    return P.damage(d.type, ctx.pctx, ctx.source);
  };
  // BredAnimalsCriterion.Conditions.matches: child (absent = ANY, else needs a child) then parent/partner either way round.
  Adv.matchers['minecraft:bred_animals'] = function (c, ctx) {
    var x = ctx || {}, pc = x.parent, pt = x.partner, ch = x.child;
    function t(list, e) { return P.extended(list, x, { 'this': e }); }
    if (has(c.child) && (!ch || !t(c.child, ch))) return false;
    return (t(c.parent, pc) && t(c.partner, pt)) || (t(c.parent, pt) && t(c.partner, pc));
  };
  // EnchantedItemCriterion.Conditions.matches(stack, levels): item predicate then the levels range; ctx { player, item, levels }.
  Adv.matchers['minecraft:enchanted_item'] = function (c, ctx) {
    return P.item(c.item, ctx, ctx.item) && P.range(c.levels, ctx.levels);
  };
  // DurabilityChangedCriterion.Conditions.matches(stack, damage): item, durability = maxDamage - newDamage,
  // delta = stack.getDamage() - newDamage (the stack still holds the OLD damage); ctx { player, item, newDamage }.
  Adv.matchers['minecraft:item_durability_changed'] = function (c, ctx) {
    var st = ctx.item, mx = st && st.maxDamage || 0;
    return P.extended(c.player, ctx, { 'this': ctx.player }) && P.item(c.item, ctx, st) &&
      P.range(c.durability, mx - ctx.newDamage) && P.range(c.delta, ((st && st.damage) || 0) - ctx.newDamage);
  };
  // VillagerTradeCriterion.Conditions.matches: the villager (entity_properties list) and the sold item.
  // ctx { player, villager: entity subjects, item: stack subject, ...hooks }
  Adv.matchers['minecraft:villager_trade'] = function (c, ctx) {
    return P.extended(c.player, ctx, { this: ctx.player }) && P.extended(c.villager, ctx, { this: ctx.villager }) && P.item(c.item, ctx, ctx.item);
  };
  // VoluntaryExileCriterion: a TickCriterion-style condition (only the `player` predicate); RaidManager.startRaid triggers it.
  Adv.matchers['minecraft:voluntary_exile'] = function (c, ctx) {
    var pl = ctx && ctx.player;
    return P.extended(c.player, { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl }, { 'this': pl });
  };
  // ConstructBeaconCriterion.Conditions.matches: the `level` IntRange over the new pyramid level; ctx { level }.
  Adv.matchers['minecraft:construct_beacon'] = function (c, ctx) {
    return P.range(c.level, ctx.level);
  };
  function plain(cond) { for (var k in cond) if (k !== 'player') return false; return true; }
  // OnKilledCriterion.Conditions.test(player, lootContext, source): `entity` (this = victim, killer = source attacker,
  // killer_player = the player) and `killing_blow`; ctx { player, entity, damage }.
  Adv.matchers['minecraft:player_killed_entity'] = function (c, ctx) {
    var pl = ctx.player, o = pl ? [pl.x, pl.y, pl.z] : null;
    var lc = { origin: o, player: pl };
    var subj = { 'this': ctx.entity, killer: ctx.damage && ctx.damage.attacker, killer_player: pl };
    return P.extended(c.player, lc, { 'this': pl }) && P.extended(c.entity, lc, subj) && P.damage(c.killing_blow, lc, ctx.damage);
  };
  // FishingRodHookedCriterion.Conditions.matches(rod, lootContext, caught): ctx { player, rod, entity (hooked entity, else the
  // bobber), caught: [stack] }; `item` matches the caught ItemEntity (entity when it is an item) or any stack in `caught`.
  Adv.matchers['minecraft:fishing_rod_hooked'] = function (c, ctx) {
    var pl = ctx.player, lc = { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl };
    if (!P.extended(c.player, lc, { 'this': pl }) || !P.item(c.rod, lc, ctx.rod) ||
      !P.extended(c.entity, lc, { 'this': ctx.entity, killer_player: pl })) return false;
    if (!has(c.item)) return true;
    var e = ctx.entity;
    if (e && e.type === 'item' && e.stack && P.item(c.item, lc, e.stack)) return true;
    return (ctx.caught || []).some(function (st) { return P.item(c.item, lc, st); });
  };
  // TravelCriterion.Conditions.matches(world, start, pos): start_position (LocationPredicate) then distance; ctx { player, start }.
  Adv.matchers['minecraft:ride_entity_in_lava'] = function (c, ctx) {
    var pl = ctx.player, s = ctx.start, lc = { origin: [pl.x, pl.y, pl.z], player: pl, dimension: pl.dimension || 'overworld' };
    return P.extended(c.player, lc, { 'this': pl }) && P.location(c.start_position, lc, s[0], s[1], s[2]) &&
      P.distance(c.distance, s[0], s[1], s[2], pl.x, pl.y, pl.z);
  };
  // SlideDownBlockCriterion.Conditions.test(state): `block` (id) and `state` (property map); ctx { player, state:{id,state} }.
  Adv.matchers['minecraft:slide_down_block'] = function (c, ctx) {
    var b = ctx.state;
    if (!b) return false;
    if (has(c.block) && stripNs(c.block) !== stripNs(b.id)) return false;
    return P.block({ state: c.state }, null, b);
  };
  // EntityKilledPlayerCriterion.Conditions.test(player, lootContext, source): `entity` (this = the killer) and
  // `killing_blow`; ctx { player, entity (killer or null), damage }.
  Adv.matchers['minecraft:entity_killed_player'] = function (c, ctx) {
    var pl = ctx.player, lc = { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl };
    return P.extended(c.player, lc, { 'this': pl }) && P.extended(c.entity, lc, { 'this': ctx.entity }) && P.damage(c.killing_blow, lc, ctx.damage);
  };
  // TravelCriterion.Conditions.matches(world, start, pos) (fall_from_height): start_position, then distance;
  // ctx { player, start: [x,y,z] }.
  Adv.matchers['minecraft:fall_from_height'] = function (c, ctx) {
    var pl = ctx.player, s = ctx.start, lc = { origin: [pl.x, pl.y, pl.z], player: pl };
    return P.extended(c.player, lc, { 'this': pl }) && P.location(c.start_position, lc, s[0], s[1], s[2]) &&
      P.distance(c.distance, s[0], s[1], s[2], pl.x, pl.y, pl.z);
  };
  // UsedTotemCriterion.Conditions.matches(stack): `item` predicate on the consumed totem; ctx { player, item }.
  Adv.matchers['minecraft:used_totem'] = function (c, ctx) {
    return P.extended(c.player, { origin: ctx.player ? [ctx.player.x, ctx.player.y, ctx.player.z] : null, player: ctx.player }, { 'this': ctx.player }) &&
      P.item(c.item, null, ctx.item);
  };
  // BrewedPotionCriterion.Conditions.matches: no `potion` = any, else the registry id must equal; ctx { player, potion }.
  Adv.matchers['minecraft:brewed_potion'] = function (c, ctx) {
    var pl = ctx.player;
    if (!P.extended(c.player, { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl }, { 'this': pl })) return false;
    if (!has(c.potion)) return true;
    var id = String(c.potion); if (id.indexOf(':') < 0) id = 'minecraft:' + id;
    var got = String(ctx.potion); if (got.indexOf(':') < 0) got = 'minecraft:' + got;
    return id === got;
  };
  // LightningStrikeCriterion.Conditions.test(lightning, bystanders): ctx { player, bolt, bystanders }.
  Adv.matchers['minecraft:lightning_strike'] = function (c, ctx) {
    var pl = ctx.player, lc = { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl };
    if (!P.extended(c.player, lc, { 'this': pl })) return false;
    if (!P.extended(c.lightning, lc, { 'this': ctx.bolt })) return false;
    if (!has(c.bystander)) return true;
    return (ctx.bystanders || []).some(function (b) { return P.extended(c.bystander, lc, { 'this': b }); });
  };
  // UsingItemCriterion.Conditions.test(stack): the `item` predicate on the held stack; ctx { player, item }.
  Adv.matchers['minecraft:using_item'] = function (c, ctx) {
    var pl = ctx.player, lc = { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl };
    return P.extended(c.player, lc, { 'this': pl }) && P.item(c.item, lc, ctx.item);
  };
  // ItemUsedOnBlockCriterion.Conditions.test(state, world, pos, stack): location tested at pos + 0.5, then item;
  // ctx { player, x, y, z, state, stack } (stack = the copy taken before the use; state = the block as it was before
  // the use: the packed wax_on/wax_off lists name the PRE-use block, which the use itself has already replaced).
  Adv.matchers['minecraft:item_used_on_block'] = function (c, ctx) {
    var pl = ctx.player, W = NS.World, S = NS.States, Cl = NS.Climate;
    var lc = { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl, dimension: 'minecraft:overworld',
      inTag: function (kind, tag, id) {
        var n = tag.replace(/^minecraft:/, '');
        if (kind === 'item') return !!(NS.Tags && NS.Items && NS.Tags.itemIn(n, NS.Items.of(id.replace(/^minecraft:/, ''))));
        return false;
      },
      blockAt: function (x, y, z) {
        var st = ctx.state !== undefined && x === ctx.x && y === ctx.y && z === ctx.z ? ctx.state : W.getBlock(x, y, z);
        return { id: 'minecraft:' + NS.Reg.names[S.block[st]], state: {}, st: st };
      },
      biomeAt: function (x, y, z) { try { return Cl && Cl.biomeNameAt ? Cl.biomeNameAt(x, y, z) : ''; } catch (e) { return ''; } } };
    if (!P.extended(c.player, lc, { 'this': pl })) return false;
    return P.location(c.location, lc, ctx.x + 0.5, ctx.y + 0.5, ctx.z + 0.5) && P.item(c.item, lc, ctx.stack);
  };
  // ChangedDimensionCriterion.Conditions.matches(from, to): an absent `from`/`to` matches any; ctx { player, from, to } (dimension names).
  function dimId(d) { return String(d).replace(/^minecraft:/, ''); }
  Adv.matchers['minecraft:changed_dimension'] = function (c, ctx) {
    if (!P.extended(c.player, { origin: null, player: ctx.player }, { 'this': ctx.player })) return false;
    if (c.from != null && dimId(c.from) !== dimId(ctx.from)) return false;
    return c.to == null || dimId(c.to) === dimId(ctx.to);
  };
  // TargetHitCriterion.Conditions.test(lootContext, hitPos, signalStrength): ctx { player, projectile, signal }.
  Adv.matchers['minecraft:target_hit'] = function (c, ctx) {
    var pl = ctx.player, lc = { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl };
    if (!P.extended(c.player, lc, { 'this': pl })) return false;
    return P.range(c.signal_strength, ctx.signal) && P.extended(c.projectile, lc, { 'this': ctx.projectile });
  };
  // LevitationCriterion.Conditions.matches: distance from where levitation began, and ticks since; ctx { player, start, ticks }.
  Adv.matchers['minecraft:levitation'] = function (c, ctx) {
    var pl = ctx.player, s = ctx.start, lc = { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl };
    if (!P.extended(c.player, lc, { 'this': pl })) return false;
    return P.distance(c.distance, s[0], s[1], s[2], pl.x, pl.y, pl.z) && P.range(c.duration, ctx.ticks);
  };
  // EffectsChangedCriterion.Conditions.matches(player, source): EntityEffectPredicate.test over the player's active
  // effects (a named effect must be present; amplifier/duration ranges, ambient, visible = showParticles), then
  // `source` when given. ctx { player, source }.
  Adv.matchers['minecraft:effects_changed'] = function (c, ctx) {
    var pl = ctx.player, lc = { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl };
    if (!P.extended(c.player, lc, { 'this': pl })) return false;
    var fxs = (pl && pl.effects) || {};
    for (var id in (c.effects || {})) {
      var w = c.effects[id], fx = fxs[stripNs(id).replace('minecraft:', '')];
      if (!fx || !P.range(w.amplifier, fx.amplifier) || !P.range(w.duration, fx.duration) ||
        (has(w.ambient) && w.ambient !== !!fx.ambient) || (has(w.visible) && w.visible !== !!fx.showParticles)) return false;
    }
    if (!has(c.source) || (Array.isArray(c.source) && !c.source.length)) return true;
    return !!ctx.source && P.extended(c.source, lc, { 'this': ctx.source });
  };
  // SleptInBedCriterion.Conditions: only the player predicate (AbstractCriterionConditions); ctx { player }.
  Adv.matchers['minecraft:slept_in_bed'] = function (c, ctx) {
    var pl = ctx.player;
    return P.extended(c.player, { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl }, { 'this': pl });
  };
  // ThrownItemPickedUpByEntityCriterion.Conditions.test: item.test(stack) then `entity` (this = the picking mob);
  // ctx { player (the thrower), stack, entity }.
  Adv.matchers['minecraft:thrown_item_picked_up_by_entity'] = function (c, ctx) {
    var pl = ctx.player, lc = { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl, inTag: ctx.inTag };
    return P.extended(c.player, lc, { 'this': pl }) && P.item(c.item, lc, ctx.stack) && P.extended(c.entity, lc, { 'this': ctx.entity });
  };
  // BeeNestDestroyedCriterion.Conditions.test(state, stack, beeCount): ctx { player, block (id), stack, bees }.
  Adv.matchers['minecraft:bee_nest_destroyed'] = function (c, ctx) {
    var pl = ctx.player, lc = { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl };
    if (!P.extended(c.player, lc, { 'this': pl })) return false;
    if (has(c.block) && stripNs(c.block) !== stripNs(ctx.block)) return false;
    return P.item(c.item, lc, ctx.stack) && P.range(c.num_bees_inside, ctx.bees | 0);
  };
  // PlayerGeneratesContainerLootCriterion.Conditions.test: `loot_table` identifier equals the container's table; ctx { player, table }.
  Adv.matchers['minecraft:player_generates_container_loot'] = function (c, ctx) {
    var pl = ctx.player;
    if (!P.extended(c.player, { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl }, { 'this': pl })) return false;
    return stripNs(c.loot_table) === stripNs(ctx.table);
  };
  // SummonedEntityCriterion.Conditions.matches: the `entity` predicate against the summoned entity; ctx { entity }.
  Adv.matchers['minecraft:summoned_entity'] = function (c, ctx) {
    var pl = ctx.player, lc = { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl };
    return P.extended(c.player, lc, { 'this': pl }) && P.extended(c.entity, lc, { 'this': ctx.entity });
  };
  // ChanneledLightningCriterion.Conditions.matches: every `victims` predicate is met by at least one struck entity;
  // ctx { player, entities }.
  Adv.matchers['minecraft:channeled_lightning'] = function (c, ctx) {
    var pl = ctx.player, o = pl ? [pl.x, pl.y, pl.z] : null, lc = { origin: o, player: pl };
    if (!P.extended(c.player, lc, { 'this': pl })) return false;
    return (c.victims || []).every(function (v) {
      return (ctx.entities || []).some(function (t) { return P.extended(v, lc, { 'this': t }); });
    });
  };
  // UsedEnderEyeCriterion.Conditions.matches(d): distance.testSqrt(squared horizontal distance to the stronghold); ctx { player, distSq }.
  Adv.matchers['minecraft:used_ender_eye'] = function (c, ctx) {
    var pl = ctx.player, lc = { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl };
    return P.extended(c.player, lc, { 'this': pl }) && P.rangeSqrt(c.distance, ctx.distSq);
  };
  // CuredZombieVillagerCriterion.Conditions.matches: the `zombie` and `villager` entity lists; ctx { zombie, villager }.
  Adv.matchers['minecraft:cured_zombie_villager'] = function (c, ctx) {
    var pl = ctx.player, lc = { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl };
    return P.extended(c.player, lc, { 'this': pl }) && P.extended(c.zombie, lc, { 'this': ctx.zombie }) &&
      P.extended(c.villager, lc, { 'this': ctx.villager });
  };
  // StartedRidingCriterion.Conditions: only the `player` predicate (trigger(player) is always true otherwise); ctx { player }.
  Adv.matchers['minecraft:started_riding'] = function (c, ctx) {
    var pl = ctx && ctx.player, me = pl && ctx.vehicle ? Object.assign({}, pl, { vehicle: ctx.vehicle }) : pl;
    return P.extended(c.player, { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl }, { 'this': me });
  };
  // Criteria.<trigger>.trigger(player, ...): every criterion of that trigger on every advancement
  // the player has not finished. Returns the number granted.
  T.trigger = function (triggerId, ctx) {
    if (!Adv.manager) return 0;
    var m = Adv.matchers[triggerId], n = 0, self = this;
    Adv.manager.advancements.forEach(function (a) {
      var p = self.getProgress(a);
      if (p.isDone()) return;
      for (var name in a.criteria) {
        var c = a.criteria[name];
        if (c.trigger !== triggerId || p.criteria.get(name).date !== null) continue;
        if (m ? m(c.conditions, ctx) : plain(c.conditions)) { if (self.grantCriterion(a, name)) n++; }
      }
    });
    return n;
  };
  // TickCriterion: trigger(player) tests `true`; only the (extended) `player` predicate of the conditions applies.
  Adv.matchers['minecraft:tick'] = function (c, ctx) {
    var pl = ctx && ctx.player;
    return P.extended(c.player, { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl }, { 'this': pl });
  };
  // PlayerInteractedWithEntityCriterion.Conditions.test(stack, ctx): item predicate, then `entity` on the clicked entity.
  Adv.matchers['minecraft:player_interacted_with_entity'] = function (c, ctx) {
    var pl = ctx.player;
    return P.extended(c.player, ctx, { 'this': pl }) && P.item(c.item, ctx, ctx.stack) && P.extended(c.entity, ctx, { 'this': ctx.entity });
  };
  // ShotCrossbowCriterion.Conditions.matches: item.test(stack); ctx.stack is a stack subject
  // ConsumeItemCriterion.Conditions.matches(stack): ItemPredicate over the stack as it was before the shrink. ctx { stack }.
  Adv.matchers['minecraft:consume_item'] = function (cond, ctx) { return P.item(cond.item, ctx, ctx && ctx.stack); };
  // EnterBlockCriterion.Conditions.matches(state): block id equal (absent = any), then StatePredicate over the state's
  // properties. ctx { block: id, prop(name) -> value string|undefined }; a state-predicate entry is an exact string or {min,max}.
  Adv.matchers['minecraft:enter_block'] = function (cond, ctx) {
    if (!ctx) return false;
    if (has(cond.block) && stripNs(cond.block) !== stripNs(ctx.block)) return false;
    for (var k in (cond.state || {})) {
      var want = cond.state[k], v = ctx.prop ? ctx.prop(k) : undefined;
      if (v === undefined) return false;
      if (want !== null && typeof want === 'object') {
        if ((has(want.min) && String(v) < String(want.min)) || (has(want.max) && String(v) > String(want.max))) return false;
      } else if (String(v) !== String(want)) return false;
    }
    return true;
  };
  Adv.matchers['minecraft:shot_crossbow'] = function (cond, ctx) { return P.item(cond.item, ctx, ctx && ctx.stack); };

  // FilledBucketCriterion.Conditions.matches: item.test(stack)
  Adv.matchers['minecraft:filled_bucket'] = function (cond, ctx) { return P.item(cond.item, ctx, ctx && ctx.stack); };

  // engine stack {i,n,d,t} -> the predicate subject P.item reads
  Adv.stackSubject = function (s) {
    var IT = NS.Items, dur = (IT && IT.durability && IT.durability[s.i]) || 0;
    return { id: 'minecraft:' + IT.nameOf(s.i | 0), count: s.n | 0, damage: s.d || 0, maxDamage: dur, nbt: s.t };
  };
  // InventoryChangedCriterion.Conditions.matches(inv, stack, full, empty, occupied); ctx { slots:[engine stacks], stack }
  Adv.matchers['minecraft:inventory_changed'] = function (cond, ctx) {
    var slots = (ctx && ctx.slots) || [], full = 0, empty = 0, occ = 0, IT = NS.Items;
    slots.forEach(function (s) {
      if (!s || s.n <= 0) empty++; else { occ++; if (s.n >= IT.maxStack(s.i)) full++; }
    });
    if (!ctx.inTag) ctx = Object.assign({}, ctx, { inTag: function (kind, tag, id) {
      return kind === 'item' && !!NS.Tags && NS.Tags.itemIn(String(tag).replace(/^minecraft:/, ''), String(id).replace(/^minecraft:/, '')); } });
    var sl = cond.slots || {};
    if (!P.range(sl.full, full) || !P.range(sl.empty, empty) || !P.range(sl.occupied, occ)) return false;
    var items = cond.items ? (Array.isArray(cond.items) ? cond.items : [cond.items]) : [];
    if (!items.length) return true;
    var st = ctx.stack && ctx.stack.n > 0 ? ctx.stack : null;
    if (items.length === 1) return !!st && P.item(items[0], ctx, Adv.stackSubject(st));
    var left = items.slice();
    for (var i = 0; i < slots.length && left.length; i++) {
      var q = slots[i];
      if (q && q.n > 0) { var sub = Adv.stackSubject(q); left = left.filter(function (j) { return !P.item(j, ctx, sub); }); }
    }
    return !left.length;
  };

  // KilledByCrossbowCriterion.Conditions.matches(victims, uniqueTypes): every `victims` predicate claims a DISTINCT
  // killed entity; unique_entity_types tests the count of distinct entity types. ctx { victims: [entity] }.
  Adv.matchers['minecraft:killed_by_crossbow'] = function (cond, ctx) {
    var vs = (ctx && ctx.victims) || [], types = {}, n = 0, left = vs.slice();
    vs.forEach(function (v) { if (!types[v.type]) { types[v.type] = 1; n++; } });
    var req = cond.victims || [];
    for (var i = 0; i < req.length; i++) {
      var hit = -1;
      for (var k = 0; k < left.length; k++) if (P.extended(req[i], ctx, { 'this': left[k] })) { hit = k; break; }
      if (hit < 0) return false;
      left.splice(hit, 1);
    }
    return P.range(cond.unique_entity_types, n);
  };
  // LocationArrivalCriterion.Conditions.matches(world, x, y, z) (location, slept_in_bed): the `player` list, then the
  // `location` predicate (or the conditions object itself when absent) at the player's position;
  // ctx { player, ...hooks }.
  Adv.matchers['minecraft:location'] = function (c, ctx) {
    var pl = ctx.player, lc = { origin: [pl.x, pl.y, pl.z], player: pl };
    for (var k in ctx) if (k !== 'player') lc[k] = ctx[k];
    return P.extended(c.player, lc, { 'this': pl }) && P.location(has(c.location) ? c.location : c, lc, pl.x, pl.y, pl.z);
  };
  // PlacedBlockCriterion.Conditions.matches(state, pos, world, stack): block id, state props, location, item.
  // ctx { block:{id,state}, pos:[x,y,z], stack, ...location hooks }
  Adv.matchers['minecraft:placed_block'] = function (cond, ctx) {
    var b = ctx && ctx.block;
    if (has(cond.block) && !(b && stripNs(cond.block) === stripNs(b.id))) return false;
    for (var k in (cond.state || {})) if (!b || !b.state || !P.range(cond.state[k], +b.state[k]) && String(b.state[k]) !== String(cond.state[k])) return false;
    var p = ctx.pos || [0, 0, 0];
    return P.location(cond.location, ctx, p[0], p[1], p[2]) && P.item(cond.item, ctx, ctx.stack);
  };
  // RecipeUnlockedCriterion.Conditions.matches: the condition's `recipe` id equals the unlocked recipe's id; ctx { recipe: id }.
  Adv.matchers['minecraft:recipe_unlocked'] = function (c, ctx) {
    return String(c.recipe).indexOf(':') < 0 ? 'minecraft:' + c.recipe === ctx.recipe : c.recipe === ctx.recipe;
  };
  // ServerRecipeBook.unlockRecipes: each recipe not yet in the book is added, then RECIPE_UNLOCKED fires; returns the count.
  Adv.unlockRecipes = function (player, ids) {
    var book = player.recipeBook || (player.recipeBook = new Set()), n = 0;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i].indexOf(':') < 0 ? 'minecraft:' + ids[i] : ids[i];
      if (book.has(id)) continue;
      book.add(id); n++;
      Adv.trigger(player, 'minecraft:recipe_unlocked', { recipe: id });
    }
    return n;
  };
  // NetherTravelCriterion.Conditions.matches (class absent from .decomp; shape = entered/exited location + distance):
  // ctx { player, entered:[x,y,z] }.
  Adv.matchers['minecraft:nether_travel'] = function (c, ctx) {
    var pl = ctx.player, e = ctx.entered, lc = { origin: [pl.x, pl.y, pl.z], player: pl };
    if (!P.extended(c.player, lc, { 'this': pl })) return false;
    return P.location(c.entered, lc, e[0], e[1], e[2]) && P.location(c.exited, lc, pl.x, pl.y, pl.z) &&
      P.distance(c.distance, e[0], e[1], e[2], pl.x, pl.y, pl.z);
  };
  // PlayerAdvancementTracker.grant + AdvancementToast: toast when display.showToast, chat line when
  // display.announceToChat and the announceAdvancements rule is on. Toasts queue on Adv.toasts (5 s each, HUD draws).
  Adv.toasts = [];
  Adv.announce = function (a, player) {
    var d = a.display;
    if (!d) return;
    var T = NS.Text;
    if (d.showToast) Adv.toasts.push({ id: a.id, title: d.title, frame: d.frame.id, header: d.frame.toast, icon: d.icon, t: NS.U && NS.U.now ? NS.U.now() : 0 });
    var C = NS.Commands, on = !(C && typeof C.ruleGet === 'function' && C.ruleGet('announceAdvancements') === 'false');
    if (d.announceToChat && on && NS.Chat && NS.Chat.add && T)
      NS.Chat.add(T.translatable('chat.type.advancement.' + d.frame.id, [player && player.name || 'Player', d.title]));
  };
  // The world-load path: the player owns a live Tracker whose host adds experience and announces grants.
  Adv.attachPlayer = function (player, saved) {
    player.addExperience = player.addExperience || function (n) { if (NS.Survival) NS.Survival.addXp(player, n); };
    player.onGrant = player.onGrant || function (a) { Adv.announce(a, player); };
    player.advancements = new Adv.Tracker(player).load(saved);
    return player.advancements;
  };
  Adv.trigger = function (player, triggerId, ctx) { return player.advancements ? player.advancements.trigger(triggerId, ctx) : 0; };

  // ── load the packed data, position every tab (ServerAdvancementLoader.apply) ──────────────
  Adv.init = function (data) {
    if (!data || !data.advancements) { Adv.ready = false; return Adv; }
    var bytes = NS.Z.unpack(data.advancements, data.advancementsBytes);
    var parts = [], CH = 8192;
    for (var i = 0; i < bytes.length; i += CH) parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CH)));
    Adv.data = JSON.parse(parts.join('')).a;
    Adv.manager = new Adv.Manager();
    var order = Adv.hashOrder(Object.keys(Adv.data));
    Adv.manager.load(order.map(function (id) { return [id, Adv.builder(Adv.data[id])]; }));
    Adv.manager.roots.forEach(function (r) { if (r.display) Adv.arrangeForTree(r); });
    Adv.ready = true;
    return Adv;
  };
})(MCL);
