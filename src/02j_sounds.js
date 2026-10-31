// 02j_sounds.js — PLAN G13. Vanilla's sound events, and the Web Audio engine that plays them.
//
// ⚠ THE TABLES ARE THE GAME'S OWN (D-285). `sounds.json` decides which files an event may play,
// with their WEIGHTS, per-entry volume and per-entry pitch; `SoundType` decides which event a
// block uses for break, step, place, hit and fall, and it came out of the bytecode rather than a
// hand-written list. Nothing here guesses which sound a block makes.
//
// ── THE THREE THINGS A CLONE GETS WRONG ──────────────────────────────────────────────────────
//  1. ⚠ **THE VARIANT IS WEIGHTED, NOT UNIFORM.** `sounds.json` gives some entries a `weight`,
//     and `Random.nextInt(totalWeight)` picks among them — so a four-variant event with weights
//     1,1,1,4 plays the fourth more than half the time. Rolling uniformly makes the common case
//     rarer, which is audible as "that sound is wrong more often than it should be".
//  2. ⚠ **BLOCK SOUNDS ARE PITCHED AND ATTENUATED BY THE SOUND TYPE**, and vanilla adds its own
//     no jitter (#456): place/break are `(v+1)/2` at `pitch*0.8`, a footstep `v*0.15`.
//     Playing everything at 1.0 makes the world flat.
//  3. ⚠ **THE CONTEXT CANNOT EXIST UNTIL A CLICK.** Every browser suspends an AudioContext made
//     before a gesture; one made at load and never resumed plays nothing, silently, for ever. It
//     is created on the first input here and `Sound.blocked` says so until then.
//
// ── THE DECODE IS LAZY, AND THAT IS NOT AN OPTIMISATION ──────────────────────────────────────
// `decodeAudioData` on 1,200 clips at load would cost seconds and a hundred megabytes of PCM for
// sounds most sessions never play. Each clip is decoded the first time it is asked for and kept.

(function (NS) {
  'use strict';

  var S = NS.Sound = {
    ready: false,
    ctx: null,
    blocked: true,          // true until a gesture lets the context start
    master: null,
    volume: 1,
    // ⚠ PLAN G11c — VANILLA'S TEN SOUND SOURCES, and they are a real gain graph rather than ten
    // numbers the options screen writes and nothing reads. `SoundSource` is a Java enum whose
    // members are chosen BY THE CALLER at play time, not stored in `sounds.json`, so the name
    // travels in `play`'s options. Everything G13 plays is a block sound, which is why `block`
    // is the default; the sliders for the sources nothing feeds yet are real controls over real
    // gain nodes, and `Sound.OWED_SOURCES` names what has not started using them.
    SOURCES: ['master', 'music', 'record', 'weather', 'block', 'hostile', 'neutral', 'player',
              'ambient', 'voice'],
    gains: null,            // source -> GainNode, all feeding `master`
    volumes: null,          // source -> 0..1, the numbers the options screen moves
    bytes: null,            // the whole payload
    base: 0,                // where the audio blobs start
    files: null,            // [{ n, o, l }]
    events: null,           // name -> { s: [{i|e, w, v, p}], t: subtitleKey }
    types: null,            // [[breakEv, stepEv, placeEv, hitEv, fallEv], ...]
    typeVP: null,           // [[volume, pitch], ...] parallel to types (SoundType constructor)
    blockType: null,        // block name -> index into types
    roles: ['break', 'step', 'place', 'hit', 'fall'],
    byBlockId: null,        // Int16Array: registry block index -> type index
    decoded: null,          // file index -> AudioBuffer (or 'pending' / null)
    played: 0, missed: 0, decodeFails: 0,
    // every currently-playing buffer source, so `/stopsound` can stop it (D-358)
    live: []
  };

  // ── vanilla's own constants, from `SoundType` and the callers that use it ──────────────────
  // ⚠ These five are `BlockBehaviour`'s, not invented: a footstep plays at 0.15 of the type's volume;
  // see S.blockMix for the rest.
  NS.Sounds = S;
  S.STEP_VOLUME = 0.15;
  S.MAX_DISTANCE = 16;      // vanilla attenuates a normal-volume sound to nothing at 16 blocks

  /**
   * ⚠ OWED, NAMED. These sources have a working slider and a working gain node and NOTHING
   * routed into them yet, because the stage that makes the sound does not exist. Listing them is
   * the difference between "the screen has ten sliders like the game's" and "six of those ten do
   * nothing and no document says so".
   */
  // struck s117: 'player' removed -- `Th.use`'s own throw sound (07zzd_throw.js) now feeds
  // it (`EggItem`/`SplashPotionItem.use`, SoundCategory.field_15248 == PLAYERS,
  // .decomp/net/minecraft/item/{EggItem,SplashPotionItem}.java, both read in full) alongside
  // the block-break/place calls `14_player.js` already routes through no named source at all
  // (those pass `null`/`P` as LISTENER, not SOURCE -- they still default to 'block').
  S.OWED_SOURCES = {
    record: 'jukeboxes and note blocks (G19e)',
    // struck #210: 'hostile' and 'neutral' -- every mob's own sound goes through `S.mobSound`,
    // which names `S.mobSource(type)` (== `Entity.getSoundCategory()` per .decomp) as its source.
    voice: 'villagers and narrator (G26)'
  };

  // ── music + cave ambience (#253) ─────────────────────────────────────────────────────────
  // MusicType.java: [event, minDelay, maxDelay, replaceCurrent]
  S.MUSIC = {
    menu: ['music.menu', 20, 600, true], flyer: ['music.' + 'creative', 12000, 24000, false],
    credits: ['music.credits', 0, 0, true], dragon: ['music.dragon', 0, 0, true],
    end: ['music.end', 6000, 24000, true], underwater: ['music.under_water', 12000, 24000, false],
    game: ['music.game', 12000, 24000, false]
  };
  /** MinecraftClient.getMusicType(): ctx {credits, inGame, dimension, dragonFight, submergedInOcean, playingUnderwater, canFlyNow, biomeMusic}. */
  S.musicType = function (c) {
    if (c.credits) return S.MUSIC.credits;
    if (!c.inGame) return S.MUSIC.menu;
    if (c.dimension === 'end') return c.dragonFight ? S.MUSIC.dragon : S.MUSIC.end;
    if (c.playingUnderwater || c.submergedInOcean) return S.MUSIC.underwater;
    if (c.dimension !== 'nether' && c.canFlyNow) return S.MUSIC.flyer;
    return c.biomeMusic || S.MUSIC.game;
  };
  var nextInt = function (rnd, lo, hi) { return lo >= hi ? lo : lo + rnd(hi - lo + 1); };
  /**
   * MusicTracker. `rnd(n)` is Random.nextInt(n); `io` = {play(event) -> handle, isPlaying(handle), stop(handle)}.
   * Plays through the 'music' source; the slider is S.setSourceVolume('music').
   */
  S.MusicTracker = function (rnd, io) {
    this.rnd = rnd; this.io = io; this.current = null; this.currentEvent = null; this.timeUntilNextSong = 100;
  };
  S.MusicTracker.prototype.tick = function (type) {
    var io = this.io;
    if (this.current !== null) {
      if (type[0] !== this.currentEvent && type[3]) {
        io.stop(this.current);
        this.timeUntilNextSong = nextInt(this.rnd, 0, (type[1] / 2) | 0);
      }
      if (!io.isPlaying(this.current)) {
        this.current = null; this.currentEvent = null;
        this.timeUntilNextSong = Math.min(this.timeUntilNextSong, nextInt(this.rnd, type[1], type[2]));
      }
    }
    this.timeUntilNextSong = Math.min(this.timeUntilNextSong, type[2]);
    if (this.current === null && this.timeUntilNextSong-- <= 0) this.play(type);
  };
  S.MusicTracker.prototype.play = function (type) {
    this.current = this.io.play(type[0]); this.currentEvent = type[0];
    if (this.current === null || this.current === undefined) this.current = false;   // played something (even if silent)
    this.timeUntilNextSong = 2147483647;
  };
  S.MusicTracker.prototype.stop = function () {
    if (this.current !== null) { this.io.stop(this.current); this.current = null; this.currentEvent = null; }
    this.timeUntilNextSong += 100;
  };
  S.MusicTracker.prototype.isPlayingType = function (type) { return this.current !== null && this.currentEvent === type[0]; };

  /** BiomeMoodSound.CAVE: ambient.cave, 6000 cultivation ticks, 8 block range, +2.0 offset. */
  S.MOOD_CAVE = { event: 'ambient.cave', ticks: 6000, range: 8, extra: 2.0 };
  /**
   * BiomeEffectSoundPlayer's mood half. `rnd(n)` = nextInt; `env` = {x,y,z (eye), sky(bx,by,bz), block(bx,by,bz)};
   * `emit(event,x,y,z)` plays it on the 'ambient' source. Returns the mood percentage via .mood.
   */
  S.MoodPlayer = function (rnd, mood) { this.rnd = rnd; this.m = mood; this.mood = 0; };
  S.MoodPlayer.prototype.tick = function (env, emit) {
    var m = this.m; if (!m) return;
    var n = m.range * 2 + 1;
    var bx = Math.floor(env.x + this.rnd(n) - m.range), by = Math.floor(env.y + this.rnd(n) - m.range), bz = Math.floor(env.z + this.rnd(n) - m.range);
    var sky = env.sky(bx, by, bz);
    if (sky > 0) this.mood = this.mood - Math.fround(sky / 15 * 0.001);
    else this.mood = this.mood - (env.block(bx, by, bz) - 1) / m.ticks;
    if (this.mood >= 1) {
      var dx = bx + 0.5 - env.x, dy = by + 0.5 - env.y, dz = bz + 0.5 - env.z;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz), t = d + m.extra;
      emit(m.event, env.x + dx / d * t, env.y + dy / d * t, env.z + dz / d * t);
      this.mood = 0;
    } else this.mood = Math.max(this.mood, 0);
  };

  /** Real io for a MusicTracker: plays through the 'music' node (the music slider), tracked by the live list. */
  S.musicIO = function () {
    return {
      play: function (ev) { S.play(ev, { source: 'music' }); return { ev: ev, t: Date.now() }; },
      isPlaying: function (h) {
        if (!S.ctx || S.blocked) return false;
        for (var i = 0; i < S.live.length; i++) if (S.live[i].source === 'music' && S.live[i].sound === h.ev) return true;
        return Date.now() - h.t < 250;   // clip still decoding
      },
      stop: function (h) { S.stopAll('music', h.ev); }
    };
  };
  /** Cave mood emit: positional, on the 'ambient' node (PositionedSoundInstance.ambient). */
  S.moodEmit = function (ev, x, y, z) { return S.play(ev, { source: 'ambient', x: x, y: y, z: z }); };

  /** The current gain of one source, 0..1. `master` multiplies all of them, as it does in vanilla. */
  S.volumeOf = function (src) {
    if (!S.volumes) return src === 'master' ? S.volume : 1;
    var v = S.volumes[src];
    return v === undefined ? 1 : v;
  };

  /**
   * Set one source's volume. `master` moves the master node; anything else moves its own node,
   * so the two multiply in the graph rather than in arithmetic somebody has to remember to do.
   */
  S.setSourceVolume = function (src, v) {
    v = Math.max(0, Math.min(1, v));
    if (!S.volumes) S.volumes = {};
    S.volumes[src] = v;
    if (src === 'master') { S.volume = v; if (S.master) S.master.gain.value = v; return v; }
    if (S.gains && S.gains[src]) S.gains[src].gain.value = v;
    return v;
  };

  /**
   * ⚠ THE HEADER IS DEFLATED AND THE AUDIO IS NOT (D-284). Opus is already entropy-coded —
   * deflating the whole payload saved 9.89% on a 1.08 MB build and almost all of that came from
   * the JSON — so only the header is inflated here, and the clips are sliced out of the base64
   * as they sit. Inflating megabytes of incompressible audio at load is the part the 2200G feels.
   * Layout: [u32 deflated header length][u32 header length][deflated header][raw Ogg clips].
   */
  S.init = function (data) {
    if (!data || !data.sounds) { S.ready = false; return S; }
    var bytes = NS.Z.fromBase64(data.sounds);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var zlen = dv.getUint32(0, true), hlen = dv.getUint32(4, true);
    var raw = NS.Z.inflateRaw(bytes.subarray(8, 8 + zlen), hlen);
    var head = JSON.parse(
      (typeof TextDecoder !== 'undefined')
        ? new TextDecoder('utf-8').decode(raw)
        : String.fromCharCode.apply(null, raw)
    );
    S.bytes = bytes;
    S.base = 8 + zlen;
    S.files = head.files;
    S.events = head.events;
    S.types = head.types;
    S.typeVP = head.typeVP || null;
    S.blockType = head.blockType;
    S.roles = head.roles || S.roles;
    S.bitrate = head.bitrate;
    S.decoded = new Array(S.files.length);
    S.buildBlockTable();
    S.ready = true;
    return S;
  };

  /**
   * block registry index -> sound type index, built once.
   * ⚠ BY INDEX, NOT BY NAME. Every hot path here is reached from a block STATE, and a string
   * lookup per footstep is the kind of thing that shows up on the 2200G and nowhere else.
   */
  S.buildBlockTable = function () {
    var R = NS.Reg;
    if (!R || !R.names || !S.blockType) return;
    S.byBlockId = new Int16Array(R.names.length);
    for (var i = 0; i < R.names.length; i++) {
      var t = S.blockType[R.names[i]];
      S.byBlockId[i] = (t === undefined) ? -1 : t;
    }
  };

  // ── the context, which cannot exist before a gesture ──────────────────────────────────────
  S.start = function () {
    if (S.ctx) { if (S.ctx.state === 'suspended') S.ctx.resume(); S.blocked = (S.ctx.state !== 'running'); return S.ctx; }
    var AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) { S.blocked = true; return null; }
    try {
      S.ctx = new AC();
      S.master = S.ctx.createGain();
      S.master.gain.value = S.volume;
      S.master.connect(S.ctx.destination);
      // ⚠ ONE NODE PER SOURCE, ALL FEEDING THE MASTER. Multiplying the two numbers at each
      // `play` would give the same sound today and would silently stop being vanilla's graph the
      // moment anything wants to fade a category, duck the music, or read a live level.
      if (!S.volumes) S.volumes = {};
      S.gains = {};
      for (var q = 0; q < S.SOURCES.length; q++) {
        var nm = S.SOURCES[q];
        if (nm === 'master') continue;
        if (S.volumes[nm] === undefined) S.volumes[nm] = 1;
        var gn = S.ctx.createGain();
        gn.gain.value = S.volumes[nm];
        gn.connect(S.master);
        S.gains[nm] = gn;
      }
      S.volumes.master = S.volume;
      S.blocked = (S.ctx.state !== 'running');
      if (S.blocked && S.ctx.resume) S.ctx.resume().then(function () { S.blocked = false; });
    } catch (e) { S.ctx = null; S.blocked = true; }
    return S.ctx;
  };

  S.setVolume = function (v) {
    S.volume = Math.max(0, Math.min(1, v));
    if (S.master) S.master.gain.value = S.volume;
  };

  // ── picking a variant ─────────────────────────────────────────────────────────────────────
  /**
   * `WeighedSoundEvents.getSound` — a weighted roll, NOT a uniform one.
   * ⚠ `rnd` is injectable so `soundcheck` can drive every branch deterministically; the game
   * passes nothing and gets `Math.random`.
   */
  S.pick = function (ev, rnd, depth) {
    if (!S.ready) return null;
    var e = S.events[ev];
    if (!e || !e.s || !e.s.length) return null;
    var total = 0, i;
    for (i = 0; i < e.s.length; i++) total += (e.s[i].w || 1);
    if (total <= 0) return null;
    var r = Math.floor((rnd === undefined ? Math.random() : rnd) * total);
    if (r >= total) r = total - 1;
    for (i = 0; i < e.s.length; i++) {
      r -= (e.s[i].w || 1);
      if (r < 0) {
        var s = e.s[i];
        // ⚠ AN `event` REFERENCE IS RE-ROLLED, not flattened: vanilla asks the target event for a
        // fresh choice, so a reference to a four-variant event is four outcomes, not one.
        if (s.e !== undefined) {
          if ((depth | 0) > 4) return null;                 // a cycle in the data, refused
          var inner = S.pick(s.e, undefined, (depth | 0) + 1);
          if (!inner) return null;
          return { i: inner.i, v: inner.v * (s.v === undefined ? 1 : s.v), p: inner.p * (s.p === undefined ? 1 : s.p), a: inner.a };
        }
        return { i: s.i, v: (s.v === undefined ? 1 : s.v), p: (s.p === undefined ? 1 : s.p), a: s.a };
      }
    }
    return null;
  };

  // ── decoding, lazily ──────────────────────────────────────────────────────────────────────
  S.clip = function (idx, then) {
    if (!S.ready || idx === undefined || idx < 0 || idx >= S.files.length) return null;
    var d = S.decoded[idx];
    if (d && d !== 'pending') { if (then) then(d); return d; }
    if (d === 'pending') return null;
    if (!S.ctx) return null;
    var f = S.files[idx];
    S.decoded[idx] = 'pending';
    var slice = S.bytes.slice(S.base + f.o, S.base + f.o + f.l);
    var buf = slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
    var done = function (b) { S.decoded[idx] = b; if (then) then(b); };
    var fail = function () { S.decoded[idx] = null; S.decodeFails++; };
    try {
      var p = S.ctx.decodeAudioData(buf, done, fail);
      if (p && p.then) p.then(done, fail);
    } catch (e) { fail(); }
    return null;
  };

  // ── playing ───────────────────────────────────────────────────────────────────────────────
  /**
   * play(event, opts) — opts: { volume, pitch, x, y, z, listener: {x,y,z} }
   * ⚠ THE ATTENUATION IS LINEAR TO 16 BLOCKS, which is vanilla's default rolloff for a
   * normal-volume sound; a sound louder than 1 reaches proportionally further, as it does there.
   */
  S.panned = 0;
  /** The camera as a sound listener, or null when there is no player yet. */
  S.listenerNow = function () {
    var P = NS.Player;
    if (!P) return null;
    return { x: (P.ex !== undefined ? P.ex : P.x), y: (P.ey !== undefined ? P.ey : P.y), z: (P.ez !== undefined ? P.ez : P.z), yaw: P.yaw || 0 };
  };
  /**
   * SoundSystem.play + OpenAL LINEAR_DISTANCE: the source volume is clamped to 1 FIRST, then the
   * rolloff runs out at `max(volume,1) * attenuation_distance` (reference distance 0).
   */
  S.attenuate = function (vol, dx, dy, dz, att) {
    var reach = Math.max(vol, 1) * att, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d >= reach) return 0;
    return Math.max(0, Math.min(1, vol)) * (1 - d / reach);
  };
  /**
   * #6257 lockstep log: `S.trace(true)` records {tick,id,volume,pitch} for every ENTITY-origin sound (a positional sound
   * whose source is not 'block') exactly as passed to play, before the event's own v/p are applied (= vanilla's playSound args).
   * `S.trace.tick` is set by the caller; `S.drain()` returns and clears the log.
   */
  S.trace = function (on) { S.tracing = !!on; S.traceLog = []; S.traceTick = 0; };
  S.drain = function () { var l = S.traceLog || []; S.traceLog = []; return l; };
  S.play = function (ev, opts) {
    opts = opts || {};
    if (S.tracing && opts.x !== undefined && opts.source && opts.source !== 'block') {
      S.traceLog.push({ tick: S.traceTick, id: ev, volume: opts.volume === undefined ? 1 : opts.volume, pitch: opts.pitch === undefined ? 1 : opts.pitch });
    }
    if (!S.ready) return false;
    if (!S.ctx) S.start();
    if (!S.ctx || S.blocked) return false;
    var choice = S.pick(ev);
    if (!choice) { S.missed++; return false; }
    var vol = (opts.volume === undefined ? 1 : opts.volume) * choice.v;
    var pitch = (opts.pitch === undefined ? 1 : opts.pitch) * choice.p;
    // ⚠ EVERY POSITIONAL SOUND IS ATTENUATED AGAINST THE CAMERA, whether or not the caller named a
    // listener (SoundSystem.play): a caller that passes none, or `null`, gets the player.
    var gain = Math.max(0, Math.min(1, vol)), pos = null;
    if (opts.x !== undefined) {
      var L = opts.listener || S.listenerNow();
      if (L) {
        var att = (choice.a !== undefined ? choice.a : S.MAX_DISTANCE);
        gain = S.attenuate(vol, opts.x - L.x, opts.y - L.y, opts.z - L.z, att);
        pos = { x: opts.x - L.x, y: opts.y - L.y, z: opts.z - L.z, L: L };
      }
    }
    if (gain <= 0) return false;
    if (opts.x !== undefined && NS.SubtitlesHud && NS.Settings && NS.Settings.showSubtitles === true) {
      var SL = opts.listener || S.listenerNow();
      // engine yaw is radians with 0 = -Z; the model wants MC degrees (0 = +Z)
      if (SL) NS.SubtitlesHud.onSoundPlayed(ev, { x: opts.x, y: opts.y, z: opts.z }, Date.now(), { x: SL.x, y: SL.y, z: SL.z, yaw: (SL.yaw || 0) * 180 / Math.PI + 180 });
    }
    var start = function (buffer) {
      if (!buffer) return;
      var src = S.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = !!opts.loop;
      src.playbackRate.value = Math.max(0.5, Math.min(2, pitch));
      var g = S.ctx.createGain();
      g.gain.value = gain; S.lastGain = gain;
      // ⚠ INTO ITS SOURCE'S NODE, not straight into the master. `opts.source` is vanilla's
      // `SoundSource` and the caller picks it; a sound with no source named is a block sound,
      // which is everything G13 plays.
      var bus = (S.gains && S.gains[opts.source || 'block']) || S.master;
      src.connect(g);
      // ⚠ 3D POSITION (`setPosition`): a PannerNode relative to the listener, whose distance model
      // is switched off (rolloffFactor 0) because the gain above is already vanilla's linear rolloff.
      var last = g, pn = null;
      if (pos && S.ctx.createPanner) {
        pn = S.ctx.createPanner();
        pn.panningModel = 'equalpower'; pn.distanceModel = 'linear'; pn.rolloffFactor = 0;
        var yaw = pos.L.yaw || 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
        // listener frame: forward = (-sin yaw... ) per ARCH §9 (yaw 0 looks -Z, +yaw turns toward +X)
        var fx = Math.sin(yaw), fz = -Math.cos(yaw);
        var rx = -fz, rz = fx;            // right-hand side in world XZ
        var px = pos.x * rx + pos.z * rz, pz = -(pos.x * fx + pos.z * fz);
        if (pn.positionX) { pn.positionX.value = px; pn.positionY.value = pos.y; pn.positionZ.value = pz; }
        else if (pn.setPosition) pn.setPosition(px, pos.y, pz);
        g.connect(pn); last = pn; S.panned++;
      }
      last.connect(bus);
      src.start(0);
      S.played++;
      // ⚠ EVERY PLAYING SOURCE IS HELD, BECAUSE `/stopsound` HAS TO REACH IT (D-358). The
      // command has existed since G12 and called `NS.Sound.stopAll`, which was defined NOWHERE —
      // behind an `if (NS.Sound && NS.Sound.stopAll)` guard, so typing `/stopsound` silently did
      // nothing and said it had worked. That is D-293's exact shape and `dupcheck` §5 names it.
      // The list is pruned by the node's own `onended`, so a finished sound does not accumulate.
      var rec = { src: src, source: opts.source || 'block', sound: ev };
      // #2645: a looping play's handle (returned below) drives gain/pitch/position per tick
      if (handle) { handle.rec = rec; handle.g = g; handle.pn = pn || null; handle.bus = bus; if (handle.stopped) { try { src.stop(0); } catch (e) {} } }
      S.live.push(rec);
      src.onended = function () {
        var i = S.live.indexOf(rec);
        if (i >= 0) S.live.splice(i, 1);
      };
    };
    var handle = null;
    if (opts.loop) {
      // ⚠ A LOOP RETURNS A HANDLE, NOT `true`. `update({volume,pitch,x,y,z,listener})` re-derives the
      // gain/pan exactly as `play` does (the caller owns the per-tick cadence); `stop()` ends it.
      handle = {
        stopped: false, rec: null, g: null, pn: null,
        update: function (o) {
          if (this.stopped || !this.g) return;
          var v = (o.volume === undefined ? 1 : o.volume) * choice.v, gn = Math.max(0, Math.min(1, v));
          if (o.x !== undefined) {
            var L2 = o.listener || S.listenerNow();
            if (L2) {
              var dx = o.x - L2.x, dy = o.y - L2.y, dz = o.z - L2.z;
              gn = S.attenuate(v, dx, dy, dz, choice.a !== undefined ? choice.a : S.MAX_DISTANCE);
              if (this.pn && this.pn.positionX) {
                var yw = L2.yaw || 0, ffx = Math.sin(yw), ffz = -Math.cos(yw);
                this.pn.positionX.value = dx * -ffz + dz * ffx; this.pn.positionY.value = dy; this.pn.positionZ.value = -(dx * ffx + dz * ffz);
              }
            }
          }
          this.g.gain.value = gn; S.lastGain = gn;
          if (o.pitch !== undefined) this.rec.src.playbackRate.value = Math.max(0.5, Math.min(2, o.pitch * choice.p));
        },
        stop: function () {
          this.stopped = true;
          if (!this.rec) return;
          try { this.rec.src.stop(0); } catch (e) { /* already stopped */ }
          var i = S.live.indexOf(this.rec); if (i >= 0) S.live.splice(i, 1);
        }
      };
    }
    S.clip(choice.i, start);          // ⚠ `start` runs from inside clip (at once if cached); calling it again doubled every cached sound
    return handle || true;
  };

  /**
   * struck s117: `Th.OWED`'s own "no one-shot 'play this named event' helper" line
   * (07zzd_throw.js). entitySound(ev, x, y, z, volume, pitch, source, listener) -- a thin
   * `S.play` wrapper for the one-shot ENTITY sounds (throws, breaks) that carry an explicit
   * `SoundCategory` at the call site in `.decomp` (unlike the five block hooks above, which are
   * always 'block'). Not block-pitch-jittered -- none of `EggItem`/`SnowballItem`/
   * `EnderPearlItem`/`ThrowablePotionItem.use`'s own playSound calls apply `S.PITCH_JITTER`;
   * their own pitch formula (`0.4F / (random*0.4F+0.8F)`) is the caller's to compute and pass.
   */
  S.entitySound = function (ev, x, y, z, volume, pitch, source, listener) {
    return S.play(ev, { volume: volume, pitch: pitch, x: x, y: y, z: z, source: source, listener: listener });
  };

  /**
   * #210: the `SoundCategory` of a mob's OWN sounds. `Entity.getSoundCategory` is NEUTRAL;
   * `HostileEntity`, `GhastEntity`, `HoglinEntity`, `PhantomEntity`, `ShulkerEntity`,
   * `ShulkerBulletEntity` and `EnderDragonEntity` override it to HOSTILE, `PlayerEntity` to
   * PLAYERS (.decomp/net/minecraft/entity, `tools/mobsoundcheck.mjs` re-derives this whole set
   * from the class chain of every `EntityType`). `RabbitEntity` is HOSTILE only as the killer
   * bunny (rabbit type 99). A type in neither list is NEUTRAL, as `Entity` says.
   */
  S.HOSTILE_MOBS = ['blaze', 'cave_spider', 'creeper', 'drowned', 'elder_guardian', 'ender_dragon',
    'enderman', 'endermite', 'evoker', 'ghast', 'giant', 'guardian', 'hoglin', 'husk', 'illusioner',
    'phantom', 'piglin', 'piglin_brute', 'pillager', 'ravager', 'shulker', 'shulker_bullet',
    'silverfish', 'skeleton', 'spider', 'stray', 'vex', 'vindicator', 'witch', 'wither',
    'wither_skeleton', 'zoglin', 'zombie', 'zombie_villager', 'zombified_piglin'];
  var hostileSet = null;
  S.mobSource = function (type, e) {
    if (type === 'player') return 'player';
    if (type === 'experience_orb' || type === 'item') return 'ambient';   // their own overrides
    if (type === 'lightning_bolt') return 'weather';
    if (type === 'rabbit') return e && e.rabbitType === 99 ? 'hostile' : 'neutral';
    if (!hostileSet) { hostileSet = {}; for (var i = 0; i < S.HOSTILE_MOBS.length; i++) hostileSet[S.HOSTILE_MOBS[i]] = true; }
    return hostileSet[type] ? 'hostile' : 'neutral';
  };

  /**
   * #210: play a named event as mob `e`'s own sound (ambient/hurt/death/step/shoot ...) at its
   * position, into the gain node of `S.mobSource(e.type, e)`, so the Hostile/Friendly Creatures
   * sliders move it. Silent mobs (`e.silent`) make no sound, as `Entity.playSound` says.
   */
  S.mobSound = function (e, ev, volume, pitch, listener) {
    if (!e || e.silent) return false;
    return S.play(ev, { volume: volume, pitch: pitch, x: e.x, y: e.y, z: e.z, source: S.mobSource(e.type, e), listener: listener });
  };

  /**
   * `/stopsound` — stop everything playing, or everything on one SoundSource (D-358).
   * Returns how many were stopped, which is what the command prints.
   *
   * ⚠ IT ITERATES A COPY. `stop()` fires `onended`, which splices the very array being walked,
   * so walking the live list directly stops every other sound — the classic mutate-while-you-walk
   * bug, and one that would look like "it half works" rather than like a crash.
   */
  /**
   * loopVoice(event, source) -- a MovingSoundInstance: a looping source whose volume/pitch/position
   * the owner re-sets every tick (#2621, AbstractBeeSoundInstance). Returns {set(vol,pitch,x,y,z),
   * stop(), vol, pitch, event, done}; the record is kept even with no audio context so the law is testable.
   * Gain is attenuated against the camera exactly like S.play (volume 0 stays running, as in vanilla).
   */
  S.loopVoice = function (ev, source) {
    var v = { event: ev, source: source || 'neutral', vol: 0, pitch: 0, done: false, src: null, g: null };
    var choice = S.ready ? S.pick(ev) : null;
    if (choice && !S.ctx) S.start();
    if (choice && S.ctx && !S.blocked) S.clip(choice.i, function (buffer) {
      if (!buffer || v.done) return;
      var src = S.ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
      var g = S.ctx.createGain(); g.gain.value = 0;
      src.connect(g); g.connect((S.gains && S.gains[v.source]) || S.master); src.start(0);
      v.src = src; v.g = g; v.apply();
      S.live.push(v.rec = { src: src, source: v.source, sound: ev });
    });
    v.apply = function () {
      if (!v.g) return;
      v.src.playbackRate.value = Math.max(0.5, Math.min(2, v.pitch || 1));
      var L = S.listenerNow();
      v.g.gain.value = L ? S.attenuate(v.vol, v.x - L.x, v.y - L.y, v.z - L.z, S.MAX_DISTANCE) : Math.min(1, v.vol);
    };
    v.set = function (vol, pitch, x, y, z) { v.vol = vol; v.pitch = pitch; v.x = x; v.y = y; v.z = z; v.apply(); };
    v.stop = function () {
      v.done = true;
      if (v.src) { try { v.src.stop(0); } catch (e) { /* ended */ } }
      var i = v.rec ? S.live.indexOf(v.rec) : -1; if (i >= 0) S.live.splice(i, 1);
    };
    return v;
  };

  S.stopAll = function (source, sound) {
    var list = S.live.slice(), n = 0;
    for (var i = 0; i < list.length; i++) {
      if (source && list[i].source !== source) continue;
      // ⚠ THE SOUND FILTER, WHICH `/stopsound <targets> [source] <sound>` NEEDS TO BE ANYTHING
      // MORE THAN A LOUDER `/stopsound <targets> [source]` (live-tested, session 146 worker 4):
      // naming a specific sound used to stop EVERY sound on the matched source, silently. A
      // sound this engine started before this record's own field existed carries no `sound` at
      // all, so a specific-sound stop leaves it alone rather than guessing.
      if (sound && list[i].sound !== sound) continue;
      try { list[i].src.stop(0); n++; } catch (e) { /* already finished */ }
      var at = S.live.indexOf(list[i]);
      if (at >= 0) S.live.splice(at, 1);
    }
    return n;
  };

  // ── block sounds ──────────────────────────────────────────────────────────────────────────
  /** The event name a block state uses for a role, or null. */
  S.blockEvent = function (state, role) {
    if (!S.ready || !S.byBlockId) return null;
    var SR = NS.States;
    if (!SR || !SR.block) return null;
    var b = SR.block[state];
    if (b === undefined) return null;
    var t = S.byBlockId[b];
    if (t < 0) return null;
    var r = S.roles.indexOf(role);
    if (r < 0) return null;
    var row = S.types[t];
    return row ? row[r] : null;
  };

  /**
   * The five block hooks, with vanilla's own volume and pitch for each, from the SoundType's
   * (v, p) (S.blockVP: 1,1 except METAL, ANVIL, WEEPING_VINES_LOW_PITCH): break/place `((v+1)/2, p*0.8)` (WorldRenderer event 2001, BlockItem), hit
   * `((v+1)/8, p*0.5)`, step `(v*0.15, p)`, fall `(v*0.5, p*0.75)`. No randomness: none of the five
   * vanilla calls varies the pitch.
   */
  S.blockMix = function (role, v, p) {
    switch (role) {
      case 'break': case 'place': return { volume: (v + 1) / 2, pitch: p * 0.8 };
      case 'hit': return { volume: (v + 1) / 8, pitch: p * 0.5 };
      case 'step': return { volume: v * S.STEP_VOLUME, pitch: p };
      case 'fall': return { volume: v * 0.5, pitch: p * 0.75 };
    }
    return null;
  };
  /** The (volume, pitch) of a state's SoundType: METAL 1/1.5, ANVIL 0.3/1, WEEPING_VINES_LOW_PITCH 1/0.5, else 1/1. */
  S.blockVP = function (state) {
    var SR = NS.States;
    if (!S.byBlockId || !S.typeVP || !SR || !SR.block) return [1, 1];
    var b = SR.block[state];
    var t = b === undefined ? -1 : S.byBlockId[b];
    return (t >= 0 && S.typeVP[t]) || [1, 1];
  };
  function blockPlay(role, state, x, y, z, listener, source) {
    var vp = S.blockVP(state);
    var m = S.blockMix(role, vp[0], vp[1]);
    return S.play(S.blockEvent(state, role), { volume: m.volume, pitch: m.pitch, x: x, y: y, z: z, listener: listener, source: source });
  }
  S.blockBreak = function (state, x, y, z, listener) { return blockPlay('break', state, x, y, z, listener); };
  S.blockPlace = function (state, x, y, z, listener) { return blockPlay('place', state, x, y, z, listener); };
  S.blockHit = function (state, x, y, z, listener) { return blockPlay('hit', state, x, y, z, listener); };
  S.blockStep = function (state, x, y, z, listener, source) { return blockPlay('step', state, x, y, z, listener, source); };
  S.blockFall = function (state, x, y, z, listener, source) { return blockPlay('fall', state, x, y, z, listener, source); };

  /** Whether an event has any audio at all — `soundcheck` counts with this, and so does the HUD. */
  S.voiced = function (ev) {
    var e = S.ready && S.events[ev];
    return !!(e && e.s && e.s.length);
  };
  S.subtitle = function (ev) {
    var e = S.ready && S.events[ev];
    return (e && e.t) || null;
  };
})(MCL);
