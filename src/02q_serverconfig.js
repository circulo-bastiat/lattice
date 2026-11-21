// NS.ServerConfig: net/minecraft/server config lists + world-gen progress (#11751). Cited (Yarn): BanEntry BannedIpEntry
//  BannedIpList BannedPlayerEntry BannedPlayerList OperatorEntry OperatorList ServerConfigEntry ServerConfigList
//  Whitelist WhitelistEntry ServerTask WorldGenerationProgressListener(+Factory) WorldGenerationProgressLogger.
// A "file" is a store {text:string|null} (no filesystem under file://); JSON is Gson pretty-print shaped (2 spaces).
// A GameProfile is {id, name}. Entries are plain objects with key/write()/isInvalid(); lists hold a Map keyed by toString(key).
// Not ported (no network or LAN in a file:// single-player build): LanServerPinger ServerNetworkIo ChaseClient ChaseServer.
(function (NS) {
  'use strict';
  var C = NS.ServerConfig = {};
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  // BanEntry.DATE_FORMAT "yyyy-MM-dd HH:mm:ss Z"
  C.formatDate = function (d) {
    var o = -d.getTimezoneOffset(), s = o < 0 ? '-' : '+'; o = Math.abs(o);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2) + ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2) + ' ' + s + pad(Math.floor(o / 60), 2) + pad(o % 60, 2);
  };
  C.parseDate = function (s) {
    var m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) ([+-])(\d\d)(\d\d)$/.exec(s);
    if (!m) throw new Error('Unparseable date');
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - (m[7] === '-' ? -1 : 1) * (+m[8] * 60 + +m[9]) * 60000;
    return new Date(t);
  };
  var UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  function profileFromJson(j) {
    if (j.uuid !== undefined && j.name !== undefined) {
      if (!UUID_RE.test(String(j.uuid))) return null;
      return { id: String(j.uuid).toLowerCase(), name: String(j.name) };
    }
    return null;
  }
  function writeProfile(j, p) { j.uuid = p.id == null ? '' : p.id; j.name = p.name; }
  function entry(key) { return { key: key, isInvalid: function () { return false; }, write: function () {} }; }
  function banEntry(key, created, source, expires, reason, json) {
    var e = entry(key);
    if (json) {
      try { e.creationDate = json.created !== undefined ? C.parseDate(json.created) : new Date(); } catch (x) { e.creationDate = new Date(); }
      e.source = json.source !== undefined ? String(json.source) : '(Unknown)';
      try { e.expiryDate = json.expires !== undefined ? C.parseDate(json.expires) : null; } catch (x) { e.expiryDate = null; }
      e.reason = json.reason !== undefined ? String(json.reason) : 'Banned by an operator.';
    } else {
      e.creationDate = created == null ? new Date() : created;
      e.source = source == null ? '(Unknown)' : source;
      e.expiryDate = expires == null ? null : expires;
      e.reason = reason == null ? 'Banned by an operator.' : reason;
    }
    e.isInvalid = function () { return this.expiryDate == null ? false : this.expiryDate.getTime() < Date.now(); };
    e.writeBan = function (j) {
      j.created = C.formatDate(this.creationDate); j.source = this.source;
      j.expires = this.expiryDate == null ? 'forever' : C.formatDate(this.expiryDate); j.reason = this.reason;
    };
    return e;
  }
  C.BannedIpEntry = function (ip, created, source, expires, reason) {
    var e = banEntry(ip, created, source, expires, reason);
    e.write = function (j) { if (this.key != null) { j.ip = this.key; this.writeBan(j); } };
    e.toText = function () { return String(this.key); };
    return e;
  };
  C.BannedIpEntry.fromJson = function (j) {
    var e = banEntry(j.ip !== undefined ? String(j.ip) : null, null, null, null, null, j);
    e.write = function (o) { if (this.key != null) { o.ip = this.key; this.writeBan(o); } };
    e.toText = function () { return String(this.key); };
    return e;
  };
  C.BannedPlayerEntry = function (profile, created, source, expires, reason) { return bannedPlayer(banEntry(profile, created, source, expires, reason)); };
  C.BannedPlayerEntry.fromJson = function (j) { return bannedPlayer(banEntry(profileFromJson(j), null, null, null, null, j)); };
  function bannedPlayer(e) {
    e.write = function (j) { if (this.key != null) { writeProfile(j, this.key); this.writeBan(j); } };
    e.toText = function () { return this.key.name != null ? this.key.name : (this.key.id != null ? this.key.id : '(Unknown)'); };
    return e;
  }
  C.OperatorEntry = function (profile, level, bypass) {
    var e = entry(profile); e.permissionLevel = level; e.bypassPlayerLimit = !!bypass; return op(e);
  };
  C.OperatorEntry.fromJson = function (j) {
    var e = entry(profileFromJson(j));
    e.permissionLevel = j.level !== undefined ? j.level | 0 : 0;
    e.bypassPlayerLimit = j.bypassesPlayerLimit === true; return op(e);
  };
  function op(e) {
    e.getPermissionLevel = function () { return this.permissionLevel; };
    e.canBypassPlayerLimit = function () { return this.bypassPlayerLimit; };
    e.write = function (j) { if (this.key != null) { writeProfile(j, this.key); j.level = this.permissionLevel; j.bypassesPlayerLimit = this.bypassPlayerLimit; } };
    return e;
  }
  C.WhitelistEntry = function (profile) { return wl(entry(profile)); };
  C.WhitelistEntry.fromJson = function (j) { return wl(entry(profileFromJson(j))); };
  function wl(e) { e.write = function (j) { if (this.key != null) writeProfile(j, this.key); }; return e; }

  // ServerConfigList<K,V>: opts {fromJson, toString}
  function ServerConfigList(store, opts) {
    var map = new Map(), self = { store: store, map: map };
    var ts = opts.toString;
    function removeInvalid() {
      var dead = [];
      map.forEach(function (v) { if (v.isInvalid()) dead.push(v.key); });
      dead.forEach(function (k) { map.delete(ts(k)); });
    }
    self.add = function (e) { map.set(ts(e.key), e); self.save(); };
    self.get = function (k) { removeInvalid(); return map.get(ts(k)); };
    self.remove = function (k) { map.delete(ts(k)); self.save(); };
    self.removeEntry = function (e) { self.remove(e.key); };
    self.contains = function (k) { return map.has(ts(k)); };
    self.isEmpty = function () { return map.size < 1; };
    self.values = function () { return Array.from(map.values()); };
    self.getNames = opts.getNames || function () { return Array.from(map.keys()); };
    self.save = function () {
      var arr = self.values().map(function (e) { var o = {}; e.write(o); return o; });
      store.text = JSON.stringify(arr, null, 2);
    };
    self.load = function () {
      if (store.text == null) return;
      var arr = JSON.parse(store.text);
      if (!Array.isArray(arr)) throw new Error('Expected a JSON array');
      map.clear();
      arr.forEach(function (j) {
        if (j === null || typeof j !== 'object' || Array.isArray(j)) throw new Error('Expected entry to be a JsonObject');
        var e = opts.fromJson(j);
        if (e.key != null) map.set(ts(e.key), e);
      });
    };
    return self;
  }
  function names(self) { return function () { return self.values().map(function (e) { return e.key; }).filter(function (k) { return k != null; }).map(function (k) { return k.name; }); }; }
  function profileList(store, fromJson) {
    var self = ServerConfigList(store, { fromJson: fromJson, toString: function (p) { return p.id; } });
    self.getNames = names(self); return self;
  }
  C.BannedPlayerList = function (store) {
    var s = profileList(store, C.BannedPlayerEntry.fromJson);
    return s;
  };
  C.OperatorList = function (store) {
    var s = profileList(store, C.OperatorEntry.fromJson);
    s.canBypassPlayerLimit = function (p) { var e = s.get(p); return e ? e.canBypassPlayerLimit() : false; };
    return s;
  };
  C.Whitelist = function (store) {
    var s = profileList(store, C.WhitelistEntry.fromJson);
    s.isAllowed = function (p) { return s.contains(p); };
    return s;
  };
  C.BannedIpList = function (store) {
    var s = ServerConfigList(store, { fromJson: C.BannedIpEntry.fromJson, toString: function (k) { return String(k); } });
    function str(a) { a = String(a); if (a.indexOf('/') >= 0) a = a.substring(a.indexOf('/') + 1); if (a.indexOf(':') >= 0) a = a.substring(0, a.indexOf(':')); return a; }
    s.isBanned = function (a) { return s.contains(str(a)); };
    s.getAddress = function (a) { return s.get(str(a)); };
    return s;
  };

  // ServerTask
  C.ServerTask = function (ticks, fn) { return { creationTicks: ticks, getCreationTicks: function () { return ticks; }, run: fn }; };

  // WorldGenerationProgressListener(Factory) + Logger
  C.WorldGenerationProgressListener = ['start', 'setChunkStatus', 'stop'];
  C.WorldGenerationProgressLogger = function (radius, clock, log) {
    clock = clock || Date.now; log = log || function () {};
    var side = radius * 2 + 1, total = side * side, generated = 0, startTime = 0, next = Infinity;
    var self = {
      totalCount: total,
      start: function () { next = clock(); startTime = next; },
      setChunkStatus: function (pos, status) {
        if (status === 'full') generated++;
        var p = self.getProgressPercentage();
        if (clock() > next) { next += 500; log('Preparing spawn area: ' + Math.max(0, Math.min(100, p)) + '%'); }
      },
      stop: function () { log('Time elapsed: ' + (clock() - startTime) + ' ms'); next = Infinity; },
      getProgressPercentage: function () { return Math.floor(generated * 100 / total); }
    };
    return self;
  };
  C.WorldGenerationProgressListenerFactory = function (radius) { return C.WorldGenerationProgressLogger(radius); };

  // QueueingWorldGenerationProgressListener: forwards each call through an executor (a function taking a task).
  C.QueueingWorldGenerationProgressListener = {
    create: function (listener, executor) {
      var q = [], busy = false;
      function send(fn) { q.push(fn); if (!busy) { busy = true; executor(drain); } }
      function drain() { while (q.length) q.shift()(); busy = false; }
      var self = {
        start: function (pos) { send(function () { pos === undefined ? listener.start() : listener.start(pos); }); },
        setChunkStatus: function (pos, status) { send(function () { listener.setChunkStatus(pos, status); }); },
        stop: function () { send(function () { listener.stop(); }); }
      };
      return self;
    }
  };

  // ServerMetadata (+Players, Version) and its JSON (de)serializer. Description is passed through as a JSON value.
  C.ServerMetadata = function () {
    var m = { description: null, players: null, version: null, favicon: null };
    m.getDescription = function () { return m.description; }; m.setDescription = function (d) { m.description = d; };
    m.getPlayers = function () { return m.players; }; m.setPlayers = function (p) { m.players = p; };
    m.getVersion = function () { return m.version; }; m.setVersion = function (v) { m.version = v; };
    m.getFavicon = function () { return m.favicon; }; m.setFavicon = function (f) { m.favicon = f; };
    return m;
  };
  C.ServerMetadata.FAVICON_WIDTH = 64; C.ServerMetadata.FAVICON_HEIGHT = 64;
  C.ServerMetadata.Players = function (max, online) {
    var p = { max: max, online: online, sample: null };
    p.getPlayerLimit = function () { return max; }; p.getOnlinePlayerCount = function () { return online; };
    p.getSample = function () { return p.sample; }; p.setSample = function (s) { p.sample = s; };
    return p;
  };
  C.ServerMetadata.Version = function (name, protocol) {
    return { gameVersion: name, protocolVersion: protocol, getGameVersion: function () { return name; }, getProtocolVersion: function () { return protocol; } };
  };
  function need(o, k, t) { if (typeof o[k] !== t) throw new Error('Expected ' + k + ' to be a ' + t); return o[k]; }
  C.ServerMetadata.toJson = function (m) {
    var o = {};
    if (m.description != null) o.description = m.description;
    if (m.players != null) {
      var p = { max: m.players.max, online: m.players.online };
      if (m.players.sample && m.players.sample.length > 0) p.sample = m.players.sample.map(function (g) { return { id: g.id == null ? '' : g.id, name: g.name }; });
      o.players = p;
    }
    if (m.version != null) o.version = { name: m.version.gameVersion, protocol: m.version.protocolVersion };
    if (m.favicon != null) o.favicon = m.favicon;
    return o;
  };
  C.ServerMetadata.fromJson = function (o) {
    if (o == null || typeof o !== 'object' || Array.isArray(o)) throw new Error('Expected status to be a JsonObject');
    var m = C.ServerMetadata();
    if ('description' in o) m.setDescription(o.description);
    if ('players' in o) {
      var j = o.players; if (j == null || typeof j !== 'object') throw new Error('Expected players to be a JsonObject');
      var p = C.ServerMetadata.Players(need(j, 'max', 'number') | 0, need(j, 'online', 'number') | 0);
      if (Array.isArray(j.sample) && j.sample.length > 0) {
        p.setSample(j.sample.map(function (e, i) {
          if (e == null || typeof e !== 'object') throw new Error('Expected player[' + i + '] to be a JsonObject');
          var id = need(e, 'id', 'string'); if (!UUID_RE.test(id)) throw new Error('Invalid UUID string: ' + id);
          return { id: id.toLowerCase(), name: need(e, 'name', 'string') };
        }));
      }
      m.setPlayers(p);
    }
    if ('version' in o) {
      var v = o.version; if (v == null || typeof v !== 'object') throw new Error('Expected version to be a JsonObject');
      m.setVersion(C.ServerMetadata.Version(need(v, 'name', 'string'), need(v, 'protocol', 'number') | 0));
    }
    if ('favicon' in o) m.setFavicon(need(o, 'favicon', 'string'));
    return m;
  };
  // ServerConfigHandler (legacy .txt list conversion helpers; profile lookups need Mojang's network, not ported).
  C.ServerConfigHandler = {
    processSimpleListFile: function (text, map) {
      var lines = text.split(/\r\n|\r|\n/);
      lines.forEach(function (l) { l = l.trim(); if (l.charAt(0) !== '#' && l.length >= 1) { var a = l.split('|'); map[a[0].toLowerCase()] = a; } });
      return lines;
    },
    parseDate: function (s, dflt) { try { return C.parseDate(s); } catch (e) { return dflt; } }
  };
  // LanServerPinger (announcement string codec; the UDP multicast thread needs sockets, not available in a browser).
  C.LanServerPinger = {
    PING_ADDRESS: '224.0.2.60', PING_PORT: 4445, PING_INTERVAL: 1500,
    createAnnouncement: function (motd, addr) { return '[MOTD]' + motd + '[/MOTD][AD]' + addr + '[/AD]'; },
    parseAnnouncementMotd: function (s) {
      var a = s.indexOf('[MOTD]'); if (a < 0) return 'missing no';
      var b = s.indexOf('[/MOTD]', a + 6); return b < a ? 'missing no' : s.substring(a + 6, b);
    },
    parseAnnouncementAddressPort: function (s) {
      var a = s.indexOf('[/MOTD]'); if (a < 0) return null;
      if (s.indexOf('[/MOTD]', a + 7) >= 0) return null;
      var c = s.indexOf('[AD]', a + 7); if (c < 0) return null;
      var d = s.indexOf('[/AD]', c + 4); return d < c ? null : s.substring(c + 4, d);
    }
  };
  // Chase (ChaseServer/ChaseClient wire protocol; the sockets need a network, so only the line codec + state logic is ported).
  // Java's %.nf rounds HALF_UP on the shortest decimal repr (not on the binary value like toFixed).
  function fmtF(x, n) {
    if (!isFinite(x)) return String(x);
    var neg = x < 0 || (x === 0 && 1 / x < 0), s = String(Math.abs(x));
    if (/e/.test(s)) s = Math.abs(x).toFixed(20).replace(/0+$/, '');
    var dot = s.indexOf('.'); if (dot < 0) { s += '.'; dot = s.length - 1; }
    var ip = s.substring(0, dot), fp = s.substring(dot + 1);
    var up = fp.length > n && fp.charCodeAt(n) >= 53; while (fp.length < n) fp += '0'; fp = fp.substring(0, n);
    var digs = (ip + fp).split('').map(Number), carry = up;
    for (var i = digs.length - 1; i >= 0 && carry; i--) { if (digs[i] === 9) digs[i] = 0; else { digs[i]++; carry = false; } }
    var r = (carry ? '1' : '') + digs.join('');
    return (neg ? '-' : '') + r.substring(0, r.length - n) + (n ? '.' + r.substring(r.length - n) : '');
  }
  C.Chase = {
    DIMENSIONS: { o: 'minecraft:overworld', n: 'minecraft:the_nether', e: 'minecraft:the_end' },
    CONNECTION_RETRY_INTERVAL: 5,
    fmtF: fmtF,
    // ChaseServer.TeleportPos.getTeleportCommand
    teleportCommand: function (dim, x, y, z, yaw, pitch) {
      return 't ' + dim + ' ' + fmtF(x, 2) + ' ' + fmtF(y, 2) + ' ' + fmtF(z, 2) + ' ' + fmtF(yaw, 2) + ' ' + fmtF(pitch, 2) + '\n';
    },
    // ChaseServer.getTeleportPosition: first player, dimension key -> short name (null when unknown/no players).
    getTeleportPosition: function (players) {
      if (!players.length) return null;
      var p = players[0], inv = null;
      for (var k in C.Chase.DIMENSIONS) if (C.Chase.DIMENSIONS[k] === p.dimension) inv = k;
      return inv == null ? null : { dimensionName: inv, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch };
    },
    // ChaseClient.parseMessage: returns the "/execute ..." command to run, or null (unknown type / unparsable: warn + ignore).
    parseMessage: function (line, warn) {
      var t = line.split(/\s+/).filter(function (w) { return w.length; });
      warn = warn || function () {};
      if (!t.length) { warn('Could not parse message \'' + line + '\', ignoring'); return null; }
      if (t[0] !== 't') { warn('Unknown message type \'' + t[0] + '\''); return null; }
      var dim = C.Chase.DIMENSIONS[t[1]];
      if (t.length < 2) { warn('Could not parse message \'' + line + '\', ignoring'); return null; }
      if (dim === undefined) return null;
      var f = [];
      for (var i = 2; i < 7; i++) {
        var v = Number(t[i]);
        if (t[i] === undefined || t[i] === '' || isNaN(v)) { warn('Could not parse message \'' + line + '\', ignoring'); return null; }
        f.push(Math.fround(v));
      }
      return '/execute in ' + dim + ' run tp @s ' + fmtF(f[0], 3) + ' ' + fmtF(f[1], 3) + ' ' + fmtF(f[2], 3) + ' ' + fmtF(f[3], 3) + ' ' + fmtF(f[4], 3);
    }
  };
  // FunctionLoader: resource id "ns:functions/a/b.mcfunction" -> function id "ns:a/b"; only .mcfunction files under functions/.
  C.FunctionLoader = {
    PATH_PREFIX_LENGTH: 'functions/'.length,
    EXTENSION_LENGTH: '.mcfunction'.length,
    isFunctionPath: function (path) { return path.length >= 11 && path.substring(path.length - 11) === '.mcfunction'; },
    functionId: function (ns, path) { return ns + ':' + path.substring(10, path.length - 11); },
    // load(resources[{ns,path,lines}], create(id, lines)) -> Map id->fn; a function that throws is logged and left out.
    load: function (resources, create, logError) {
      var m = new Map();
      resources.forEach(function (r) {
        if (!C.FunctionLoader.isFunctionPath(r.path)) return;
        var id = C.FunctionLoader.functionId(r.ns, r.path);
        try { m.set(id, create(id, r.lines)); } catch (e) { (logError || function () {})('Failed to load function ' + id, e); }
      });
      return m;
    }
  };
  // DataPackContents.getContents: reload order of the data-pack reloaders.
  C.DataPackContents = {
    CONTENTS_ORDER: ['tags', 'loot_conditions', 'recipes', 'loot_tables', 'loot_functions', 'functions', 'advancements'],
    getContents: function () { return C.DataPackContents.CONTENTS_ORDER.slice(); }
  };
  // SaveLoader.ofLoaded: resources are closed when the reload fails; otherwise the loader owns them. Failure is returned, not thrown.
  C.SaveLoader = {
    ofLoaded: function (resources, reload) {
      try { var contents = reload(resources); return { ok: true, resources: resources, contents: contents }; }
      catch (e) { resources.closed = true; return { ok: false, error: e }; }
    },
    close: function (loader) { loader.resources.closed = true; }
  };
  // IntegratedServer fixed rules + IntegratedServer.setDefaultGameMode (clears forcedGameMode) and IntegratedPlayerManager
  // (view distance 10, max players 8, name-taken check, userData saved only for the single player).
  C.IntegratedServer = {
    OP_PERMISSION_LEVEL: 2, FUNCTION_PERMISSION_LEVEL: 2, VIEW_DISTANCE: 10, MAX_PLAYERS: 8,
    areCommandBlocksEnabled: function () { return true; },
    isHost: function (name, singlePlayerName) { return singlePlayerName != null && name.toLowerCase() === singlePlayerName.toLowerCase(); },
    setDefaultGameMode: function (st, mode) { st.defaultGameMode = mode; st.forcedGameMode = null; },
    adjustTrackingDistance: function (scaling, d) { return Math.trunc(Math.fround(scaling) * d); }
  };
  C.IntegratedPlayerManager = {
    // checkCanJoin(name, single, online[names]) -> translation key or null (superclass checks not modelled)
    checkCanJoin: function (name, single, online) {
      if (single != null && name.toLowerCase() === single.toLowerCase() && online.indexOf(name) >= 0) return 'multiplayer.disconnect.name_taken';
      return null;
    },
    // savePlayerData: returns the new userData (only the host's data is kept), else the old one.
    savePlayerData: function (st, name, single, nbt) { if (name === single) st.userData = nbt; return st.userData; }
  };
})(MCL);
