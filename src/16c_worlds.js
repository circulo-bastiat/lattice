// 16c_worlds.js — #11245: the multi-world store (data layer of SelectWorldScreen, #11229).
// Layout and reasoning: docs/decisions/11229-worlds.md.
//
// IndexedDB 'mclite.worlds' / store 'worlds', one record per world:
//   { id, name, seed (string, 64-bit), lastPlayed, gameMode, difficulty, version, payload }
// `payload` is exactly the string Save.save writes. The ACTIVE world's payload also lives in
// localStorage 'mclite.world' (Save.KEY) because boot (Save.load) and unload saves are synchronous;
// every Save.save mirrors it into the active record. open(id) swaps the localStorage slot and
// the caller reloads the page (no UI here).
(function (NS) {
  'use strict';
  var W = NS.Worlds = { DB: 'mclite.worlds', STORE: 'worlds', ACTIVE: 'mclite.worlds.active',
                        VERSION_LABEL: '1.18.2', ready: null, lastError: null };
  var dbp = null;

  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var rq = indexedDB.open(W.DB, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore(W.STORE, { keyPath: 'id' }); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
      rq.onblocked = function () { rej(new Error('blocked')); };
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(W.STORE, mode), out = fn(t.objectStore(W.STORE));
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  function get(id) { return tx('readonly', function (s) { return s.get(id); }); }
  function put(rec) { return tx('readwrite', function (s) { return s.put(rec); }); }
  function newId() { return 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  function strip(r) { var o = {}; for (var k in r) if (k !== 'payload') o[k] = r[k]; o.bytes = r.payload ? r.payload.length : 0; return o; }
  function blank(o) {
    return { id: newId(), name: o.name || 'New World', seed: String(o.seed === undefined ? 0 : o.seed),
             lastPlayed: Date.now(), gameMode: o.gameMode || 'survival', difficulty: o.difficulty || 'normal',
             version: W.VERSION_LABEL, payload: null };
  }
  W.active = function () { return ls(W.ACTIVE); };

  /** Migration: a single pre-store save becomes world 1 ('New World'), edits intact. */
  W.init = function () {
    if (W.ready) return W.ready;
    if (typeof indexedDB === 'undefined' || !indexedDB) return (W.ready = Promise.resolve(null));
    W.ready = W.list().then(function (l) {
      var act = W.active();
      if (act && l.some(function (r) { return r.id === act; })) return act;
      var raw = ls(NS.Save.KEY);
      if (!raw) return null;
      var meta = {}; try { var o = JSON.parse(raw); meta = { seed: o.seed64 || o.seed, difficulty: o.difficulty, gameMode: o.player && o.player.mode }; } catch (e) {}
      var rec = blank({ name: 'New World', seed: meta.seed, difficulty: meta.difficulty, gameMode: meta.gameMode });
      rec.payload = raw;
      return put(rec).then(function () { ls(W.ACTIVE, rec.id); return rec.id; });
    }).catch(function (e) { W.lastError = String(e); return null; });
    return W.ready;
  };

  /** Called by Save.save after the localStorage write. meta: {seed, difficulty, gameMode}. */
  W.mirror = function (payload, meta) {
    if (!W.ready) return;
    var id = W.active();   // captured NOW: open() may switch the active world before the write runs
    W.q = (W.q || Promise.resolve()).then(function () { return W.ready; }).then(function () {
      var p = id ? get(id) : Promise.resolve(null);
      return p.then(function (rec) {
        if (!rec) { var bm = {}; for (var bk in (meta || {})) bm[bk] = meta[bk]; if (W.pendingName) { bm.name = W.pendingName; W.pendingName = null; } rec = blank(bm); ls(W.ACTIVE, rec.id); }
        rec.payload = payload; rec.lastPlayed = Date.now(); rec.version = W.VERSION_LABEL;
        if (meta) { rec.seed = String(meta.seed); if (meta.difficulty) rec.difficulty = meta.difficulty; if (meta.gameMode) rec.gameMode = meta.gameMode; }
        return put(rec);
      });
    }).catch(function (e) { W.lastError = String(e); });
    return W.q;
  };
  /** Save.reset (a brand-new world from the title): the next save makes a new record. */
  W.detach = function () { ls(W.ACTIVE, null); };

  W.list = function () {
    return tx('readonly', function (s) { return s.getAll(); }).then(function (a) {
      return a.map(strip).sort(function (x, y) { return y.lastPlayed - x.lastPlayed; });
    });
  };
  /** A fresh world with its own seed and a minimal loadable payload; returns its id. */
  W.create = function (o) {
    o = o || {};
    var rec = blank(o), S = NS.Save;
    var seed = BigInt.asIntN(64, BigInt(rec.seed));
    rec.payload = JSON.stringify({ v: S.VERSION, seed: Number(BigInt.asIntN(32, seed)), seed64: String(seed),
                                   gen: S.GEN_VERSION, t: Date.now(), difficulty: rec.difficulty });
    return put(rec).then(function () { return rec.id; });
  };
  /** Make `id` the active world: flush the current one, install the target's payload. Caller reloads. */
  W.open = function (id) {
    return W.init().then(function () { return get(id); }).then(function (rec0) {
      var rec = rec0;
      if (!rec) throw new Error('no such world ' + id);
      if (NS.Save.dirty) NS.Save.save(false);
      var cur = W.active(), curRaw = ls(NS.Save.KEY);
      var flush = (cur && curRaw && cur !== id) ? get(cur).then(function (c) { if (c) { c.payload = curRaw; return put(c); } }) : Promise.resolve();
      return (W.q || Promise.resolve()).then(function () { return flush; }).then(function () {
        NS.Save.frozen = true;   // no save (autosave/unload) may touch the slot until the reload
        if (rec.payload) ls(NS.Save.KEY, rec.payload); else ls(NS.Save.KEY, null);
        ls(W.ACTIVE, id);
        rec.lastPlayed = Date.now();
        return put(rec).then(function () { return strip(rec); });
      });
    });
  };
  W.rename = function (id, name) { return get(id).then(function (r) { if (!r) throw new Error('no such world'); r.name = String(name); return put(r); }); };
  W.remove = function (id) {
    return tx('readwrite', function (s) { return s.delete(id); }).then(function () {
      if (W.active() === id) { W.detach(); ls(NS.Save.KEY, null); }
    });
  };
  /** duplicate = backup: a copy with a new id and ' (copy)' appended. */
  W.duplicate = function (id) {
    return get(id).then(function (r) {
      if (!r) throw new Error('no such world');
      var c = JSON.parse(JSON.stringify(r)); c.id = newId(); c.name = r.name + ' (copy)'; c.lastPlayed = Date.now();
      return put(c).then(function () { return c.id; });
    });
  };
})(MCL);
