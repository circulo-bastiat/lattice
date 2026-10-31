// 16_settings.js — quality presets, hardware probing, adaptive render distance.
// Main thread only. docs/archive/ARCH.md §16, D-44, D-46, D-84, D-91.
//
// THIS FILE IS THE ONE PLACE THAT DECIDES HOW EXPENSIVE THE GAME IS.
// Every other module reads its numbers and obeys; none of them second-guesses it, and none of
// them keeps its own copy. A preset is not a label — it is fourteen numbers, and applying one
// reaches into the renderer, the streamer, the worker pool and the mesher in one call.

(function (NS) {
  'use strict';

  var S = NS.Settings = {
    // --- identity -----------------------------------------------------------
    preset: 'low',              // 'celeron' | 'low' | 'medium' | 'high' | 'custom'
    detected: 'low',            // what the boot probe chose, before any saved override
    tier: 1,                    // index of `preset` in ORDER; nothing reads it but the save file
                                // and the debug line — quality is decided by NAME, not by tier
    probeMs: 0,                 // the CPU timing probe's result, for the F3 overlay

    // --- what the renderer reads (Gfx.applyQuality) -------------------------
    maxFps: 120,                // options.framerateLimit: 10..260 step 10, 260 = Unlimited (not a preset key)
    renderDistance: 8,
    rdBase: 8,                  // what the PLAYER asked for; `adapt` bands around this (D-160)
    // D-452 — vanilla's own SEPARATE option (Video Settings, since 1.18): entities, spawning and
    // random ticks only run within this many chunks of the player; render distance only decides
    // what is MESHED and DRAWN. Independent of the quality preset (like `viewBobbing`), clamped
    // to <= renderDistance everywhere it is read (`S.effectiveSimDistance`) because a sim radius
    // wider than what is even loaded is meaningless, not an error worth surfacing to the player.
    simDistance: 8,
    maxDPR: 1,
    fov: 70,
    guiScale: 0,         // 'GUI Scale': 0 = Auto, else 1..max (Window.calculateScaleFactor); not a preset key
    biomeBlendRadius: 2, // 'Biome Blend' slider, 0..7 (GameOptions.biomeBlendRadius); not a preset key
    fovEffectScale: 1,   // 'FOV Effects' slider, 0..1
    gamma: 0.5,          // 'Brightness' slider (GameOptions.gamma 0..1, Moody..Bright); not a preset key
    // ⚠ VANILLA'S OWN OPTION, DEFAULT ON (D-359). `GameRenderer.renderItemInHand` gates
    // `bobView` on `options.bobView`, so the walk bob is a choice in the real game too — some
    // people turn it off because it makes them motion sick, and a clone that hard-codes it on
    // has taken that choice away. It is NOT a quality setting: no preset touches it.
    viewBobbing: true,
    showSubtitles: false,   // options.showSubtitles (GameOptions default false)
    entityDistanceScaling: 1,   // options.entityDistanceScaling, 0.5..5 step 0.25 -> ER.renderDistanceMultiplier
    entityShadows: true,        // options.entityShadows
    autoJump: true,   // options.autoJump (GameOptions default true)
    // G26g: GameOptions' chat + accessibility fields, defaults as in GameOptions.java. Not preset keys.
    chatVisibility: 0,      // ChatVisibility id: 0 full, 1 system (commands only), 2 hidden
    chatColors: true, chatLinks: true, chatLinksPrompt: true,
    chatOpacity: 1, textBackgroundOpacity: 0.5, chatScale: 1, chatLineSpacing: 0, chatDelay: 0,
    chatWidth: 1, chatHeightFocused: 1, chatHeightUnfocused: 0.44366196,
    narrator: 0,            // NarratorMode id; MC-Lite has no narrator, so this is a stored flag only
    autoSuggestions: true, hideMatchedNames: true, reducedDebugInfo: false,
    backgroundForChatOnly: true, distortionEffectScale: 1, monochromeLogo: false, hideLightningFlashes: false,
    // vanilla's GameOptions.advancedItemTooltips (F3+H); persisted, not a preset key.
    advancedTooltips: false,
    // vanilla's options.fullscreen; kept in sync with the real state by NS.Fullscreen.
    fullscreen: false,
    // vanilla's own option (ParticlesMode: 0 All, 1 Decreased, 2 Minimal); not a preset key.
    particles: 0,
    // vanilla's GameOptions.cloudRenderMode (CloudRenderMode: 0 Off, 1 Fast, 2 Fancy (default)); not a preset key.
    cloudRenderMode: 2,
    // vanilla's AttackIndicator (0 Off, 1 Crosshair (default), 2 Hotbar); not a preset key.
    attackIndicator: 1,
    // vanilla's PlayerModelPart toggles (GameOptions `modelPart_<name>`, default all ON) and
    // `mainHand` ('right' default); options.txt keys are the vanilla names, see optionsTxt().
    modelPart_cape: true, modelPart_jacket: true, modelPart_left_sleeve: true,
    modelPart_right_sleeve: true, modelPart_left_pants_leg: true, modelPart_right_pants_leg: true,
    modelPart_hat: true, mainHand: 'right',
    // vanilla's F1. Nothing binds it yet; the hand pass and the HUD both read it, so when F1
    // is bound it works everywhere at once rather than in one place.
    hideGui: false,
    mipmaps: true,
    occlusion: true,            // section visibility graph (ARCH 9.1)
    depthPrepass: false,
    fogStart: 0.55,             // fog begins at this fraction of the fog wall
    fogEnd: 1.0,                // fog wall = fogEnd * renderDistance * 16 blocks
    uploadsPerFrame: 4,
    uploadBytesPerFrame: 262144,

    // --- what the mesher reads (worker init / Jobs.setMeshOptions) ----------
    ao: true,                   // bake per-vertex ambient occlusion (D-24)
    crossModels: true,          // emit grass tufts and flowers (D-56). No preset turns it
                                // off any more — Dan's ruling, D-166.
    smoothLighting: true,       // kept for the menu; AO is the visible half of it
    // ⚠ D-415 — the sky disc's own fog (vanilla's `FogMode.FOG_SKY`), which is what makes the
    // horizon a gradient instead of a hard line straight across the screen. It is NOT a quality
    // setting: it is one mix() per sky fragment over nine vertices of geometry, and turning it
    // off costs nothing and gains nothing. It is here because Dan asked for a switch for the
    // line, and a switch you can flip is how he can tell me whether the line I fixed is the
    // line he saw. Not a PRESET key for the same reason `viewBobbing` is not (D-359).
    horizonFade: true,
    fancyLeaves: true,          // false = vanilla's fast leaves: opaque, no cutout pass (D-93)

    // --- what the streamer and the loop read --------------------------------
    workers: 3,
    maxGenInflight: 4,
    maxMeshInflight: 6,
    maxMeshPerFrame: 6,
    maxChunks: 1024,
    lightBudgetUs: 2000,        // Light.step's per-frame microsecond budget
    targetMs: 16.7,

    // --- preferences that are not quality -----------------------------------
    // 'auto' | 'webgpu' | 'webgl2'. ⚠ 'auto' means WEBGL2, not "try the newest first":
    // WebGPU renders a black world on Dan's RX 6800XT without reporting a failure, so it is
    // opt-in (D-15, blocker B1). See 10_gfx.js G.init.
    backend: 'auto',
    sensitivity: 0.0022,
    invertY: false,
    toggleSneak: false,
    toggleSprint: false,
    noLock: false,            // #2091 play without pointer lock (VM / RDP)
    keyBinds: {},             // KeyBindings that differ from their default: { 'key.jump': 'key.keyboard.q' } (15g_keybinds.js)
    pauseOnLostFocus: true,   // GameOptions.pauseOnLostFocus; F3+P toggles it
    adaptive: true,             // let measured frame time nudge the render distance (D-46)

    _acc: 0, _n: 0
  };

  /**
   * The four presets, weakest first. The names are the owner's target machines, because a
   * number ("8 chunks") means nothing to a player and "this is the one for a Celeron" does.
   *
   *   celeron  Intel Celeron / any 2-core iGPU laptop
   *   low      Ryzen 5 2200G iGPU            <- THE machine this project exists for
   *   medium   Ryzen 5 3600 + RTX 3060
   *   high     Ryzen 5 7600 + RX 6800XT
   *
   * Read the differences as a story: everything that costs the CPU per frame shrinks going left
   * (workers, streaming budget, tick budget), everything that costs the GPU per pixel shrinks
   * too (render distance, DPR, mip mapping), and the two things that only cost MEMORY —
   * occlusion culling and the resident chunk cap — get *more* aggressive going left, because on
   * these machines memory bandwidth is the wall and not drawing something is always free.
   */
  S.PRESETS = {
    celeron: {
      label: 'Celeron',
      renderDistance: 4,  maxDPR: 0.75, mipmaps: false, occlusion: true,  depthPrepass: false,
      fogStart: 0.35, fogEnd: 0.95,
      uploadsPerFrame: 2, uploadBytesPerFrame: 98304,
      // ⚠ `crossModels` stays TRUE even here (D-166). Dropping grass tufts and flowers is the
      // cheapest frame in the game and Dan's ruling is that it is not a frame worth having:
      // "that's just a cheap solution and may hurt gameplay". The weakest tier gets its budget
      // from render distance, DPR, AO and leaves instead — all of which change how the world
      // LOOKS, not what is in it.
      ao: false, crossModels: true,  smoothLighting: false, fancyLeaves: false,
      workers: 1, maxGenInflight: 2, maxMeshInflight: 3, maxMeshPerFrame: 2,
      maxChunks: 160, lightBudgetUs: 800, targetMs: 33.3
    },
    low: {
      label: 'Low',
      renderDistance: 8,  maxDPR: 1,    mipmaps: true,  occlusion: true,  depthPrepass: false,
      fogStart: 0.5,  fogEnd: 1.0,
      uploadsPerFrame: 4, uploadBytesPerFrame: 262144,
      ao: true,  crossModels: true,  smoothLighting: true,  fancyLeaves: false,
      workers: 3, maxGenInflight: 4, maxMeshInflight: 6, maxMeshPerFrame: 4,
      maxChunks: 420, lightBudgetUs: 2000, targetMs: 16.7
    },
    medium: {
      label: 'Medium',
      renderDistance: 12, maxDPR: 1.5,  mipmaps: true,  occlusion: true,  depthPrepass: false,
      fogStart: 0.6,  fogEnd: 1.0,
      uploadsPerFrame: 6, uploadBytesPerFrame: 786432,
      ao: true,  crossModels: true,  smoothLighting: true,  fancyLeaves: true,
      workers: 4, maxGenInflight: 6, maxMeshInflight: 10, maxMeshPerFrame: 8,
      maxChunks: 900, lightBudgetUs: 3000, targetMs: 16.7
    },
    high: {
      label: 'High',
      renderDistance: 16, maxDPR: 2,    mipmaps: true,  occlusion: true,  depthPrepass: true,
      fogStart: 0.7,  fogEnd: 1.0,
      uploadsPerFrame: 8, uploadBytesPerFrame: 2097152,
      ao: true,  crossModels: true,  smoothLighting: true,  fancyLeaves: true,
      workers: 4, maxGenInflight: 8, maxMeshInflight: 14, maxMeshPerFrame: 12,
      maxChunks: 1600, lightBudgetUs: 4000, targetMs: 16.7
    }
  };

  S.ORDER = ['celeron', 'low', 'medium', 'high'];

  /** Every key a preset owns. Used by applyPreset and by the "did the player change it" check. */
  S.PRESET_KEYS = ['renderDistance', 'maxDPR', 'mipmaps', 'occlusion', 'depthPrepass',
    'fogStart', 'fogEnd', 'uploadsPerFrame', 'uploadBytesPerFrame',
    'ao', 'crossModels', 'smoothLighting', 'fancyLeaves',
    'workers', 'maxGenInflight', 'maxMeshInflight', 'maxMeshPerFrame',
    'maxChunks', 'lightBudgetUs', 'targetMs'];

  // ---------------------------------------------------------------------------
  // Hardware detection (D-91)
  // ---------------------------------------------------------------------------

  /**
   * probe() — a short, fixed integer+float workload, timed. Core COUNT tells you how many
   * threads there are and nothing about how fast they are; a 2-core Celeron and a 2-core cloud
   * VM report the same number and are an order of magnitude apart. This runs ~4 ms on a fast
   * desktop and ~25 ms on the machines the Celeron preset is for, and 4 ms is a price worth
   * paying once on the loading screen to not guess wrong for the next hour.
   *
   * The work is deliberately shaped like the mesher's inner loop — typed-array reads, integer
   * masking, a multiply-heavy hash — rather than like a floating-point benchmark.
   */
  S.probe = function () {
    var N = 1 << 16;
    var a = new Uint32Array(N), b = new Float32Array(256);
    var t0 = NS.U.now();
    var h = 2166136261, acc = 0;
    for (var pass = 0; pass < 6; pass++) {
      for (var i = 0; i < N; i++) {
        h ^= i; h = Math.imul(h, 16777619);
        a[i] = h >>> 0;
        acc += (h & 255) * 0.00390625;
      }
      for (i = 0; i < N; i += 7) {
        var v = a[i] & 4095;
        b[v & 255] += (v * 0.000244140625) - acc * 1e-9;
      }
    }
    S._probeSink = b[0] + acc;
    return NS.U.now() - t0;
  };

  /**
   * detect() -> preset name. Three signals, each able to veto upward:
   *   cores   how many workers we can actually use
   *   memory  navigator.deviceMemory, when the browser gives it (Chromium does)
   *   probeMs the timing probe above — the only one that measures the machine rather than
   *           describing it
   * Anything unknown is assumed weak. Guessing low costs the player one menu click; guessing
   * high costs them the first two minutes of the game at 9 fps, which is when they close the tab.
   */
  S.detect = function () {
    // ⚠ D-196 — THE TEST HOOK, and it exists because every browser check had only ever run at
    // CELERON. The headless machine that runs them has two cores, so `cores <= 2` clamped the
    // result to the weakest preset every time — and `fancyLeaves` is FALSE below medium, so the
    // FANCY leaf path (D-178's whole subject) was never once drawn by a check, while Dan plays
    // at medium and above. A harness sets `window.__MCLITE_FORCE_PRESET` before the page's
    // scripts run; nothing in the game writes it and no player can reach it.
    var forced = (typeof window !== 'undefined' && window.__MCLITE_FORCE_PRESET) || null;
    if (forced && S.PRESETS[forced]) { S.probeMs = S.probeMs || 0; return forced; }
    var cores = NS.ENV.cores || 2;
    var mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 0;
    var ms = S.probeMs = S.probe();

    // Score from the timing probe first: it is the only real measurement.
    var name;
    if (ms > 90) name = 'celeron';
    else if (ms > 45) name = 'low';
    else if (ms > 22) name = 'medium';
    else name = 'high';

    // Cores and memory can only pull the choice DOWN.
    var idx = S.ORDER.indexOf(name);
    if (cores <= 2) idx = Math.min(idx, 0);
    else if (cores <= 4) idx = Math.min(idx, 1);
    else if (cores <= 6) idx = Math.min(idx, 2);
    if (mem && mem <= 2) idx = Math.min(idx, 0);
    else if (mem && mem <= 4) idx = Math.min(idx, 1);
    else if (mem && mem < 8) idx = Math.min(idx, 2);
    // No WebGPU almost always means an older driver stack; do not promise High to it.
    if (!NS.ENV.hasWebGPU) idx = Math.min(idx, 2);

    return S.ORDER[Math.max(0, idx)];
  };

  // ---------------------------------------------------------------------------
  // Applying a preset
  // ---------------------------------------------------------------------------

  /**
   * applyPreset(name, opts) — copy the preset's numbers in and push them everywhere they matter.
   *
   *   opts.remesh  false to skip the remesh even when the mesh detail changed (used at boot,
   *                where nothing has been meshed yet)
   *   opts.save    false to skip persisting (used at boot)
   *
   * The mesh-detail keys (`ao`, `crossModels`) are the only ones that invalidate geometry that
   * is already on the GPU, so they are the only ones that trigger World.remeshAll().
   */
  S.applyPreset = function (name, opts) {
    var p = S.PRESETS[name];
    if (!p) return false;
    opts = opts || {};
    var oldAO = S.ao, oldCross = S.crossModels, oldDPR = S.maxDPR, oldLeaves = S.fancyLeaves;

    for (var i = 0; i < S.PRESET_KEYS.length; i++) {
      var k = S.PRESET_KEYS[i];
      if (p[k] !== undefined) S[k] = p[k];
    }
    S.preset = name;
    // a preset IS a choice of render distance, so it moves the adaptive band with it (D-160)
    S.rdBase = S.renderDistance;
    S.tier = Math.max(0, S.ORDER.indexOf(name));
    // D-428 — the pool is no longer fixed at start-up (`Jobs.resize` retires a busy worker
    // rather than terminating it), and the clamp is the MACHINE'S thread count rather than the
    // recommendation: `ENV.workers` is capped at 4, and using it as the ceiling is what made
    // this setting unraisable. A preset still carries a worker count, like every other preset key.
    S.workers = Math.max(1, Math.min(NS.ENV.workersMax || NS.ENV.workers, p.workers));

    S.push({
      remesh: opts.remesh !== false &&
              (oldAO !== S.ao || oldCross !== S.crossModels || oldLeaves !== S.fancyLeaves),
      resize: opts.resize !== false && oldDPR !== S.maxDPR
    });
    if (opts.save !== false) S.save();
    return true;
  };

  /**
   * push(what) — the one function that tells the rest of the program a setting changed.
   * Called by applyPreset and by every individual control in the pause menu, so a hand-tweaked
   * setting takes effect exactly the same way a preset does.
   */
  S.push = function (what) {
    what = what || {};
    if (NS.Gfx && NS.Gfx.applyQuality) NS.Gfx.applyQuality();
    var W = NS.World;
    if (W) {
      W.maxGenInflight  = S.maxGenInflight;
      W.maxMeshInflight = S.maxMeshInflight;
      W.maxMeshPerFrame = S.maxMeshPerFrame;
      W.maxChunks       = S.maxChunks;
    }
    if (NS.Jobs && NS.Jobs.setMeshOptions) {
      NS.Jobs.setMeshOptions({ ao: S.ao, cross: S.crossModels, fastLeaves: !S.fancyLeaves,
                               smooth: S.smoothLighting !== false });
    } else if (NS.Mesher) {
      NS.Mesher.setOptions({ ao: S.ao, cross: S.crossModels, fastLeaves: !S.fancyLeaves,
                             smooth: S.smoothLighting !== false });
    }
    if (what.resize && NS.Main && NS.Main.resize) NS.Main.resize();
    // ⚠ NO `Gfx.dropAll()` HERE (D-162). It destroyed every section mesh on the GPU, so the whole
    // world vanished until the mesher had rebuilt all of it — and the clear colour is the SKY, so
    // for that second the player got a full screen of pale blue. Turning AO on flashed the
    // screen. The buffers are not INVALID here, only STALE: `remeshAll` marks every section dirty
    // and each new mesh replaces its predecessor in place, which is what vanilla does when you
    // change a graphics setting. `dropAll` is still right where the buffers really are gone —
    // the backend swap (17_main) and loading a different world (16b_save).
    if (what.remesh && W && W.remeshAll) W.remeshAll();
  };

  /** A control the player moved by hand: the preset no longer describes the settings. */
  /** Window.calculateScaleFactor(guiScale, forceUnicode=false): grow while the next scale still leaves >= 320x240;
   *  0 = Auto = no cap. Force Unicode is irrelevant here (no even-scale rule). */
  S.calculateScaleFactor = function (guiScale, w, h) {
    var i = 1;
    while ((guiScale === 0 || i < guiScale) && ((w / (i + 1)) | 0) >= 320 && ((h / (i + 1)) | 0) >= 240) i++;
    return i;
  };
  /** scaled width/height are ceil(size / scale) */
  S.scaledSize = function (size, scale) { return Math.ceil(size / scale); };

  S.markCustom = function () { S.preset = 'custom'; };

  /**
   * setRenderDistance(n) — the ONE place the player's chosen render distance is written (D-160).
   *
   * ⚠ It has to move `rdBase` as well as `renderDistance`, and that is the whole point of the
   * function existing. `S.adapt` nudges the render distance within a band around a base, and the
   * base used to be read from `PRESETS[S.preset]` — but changing the slider calls `markCustom`,
   * `PRESETS.custom` does not exist, and the fallback was the DETECTED preset. So a player on a
   * machine detected as `high` who pulled the distance down to 4 got a band of 13..18 and the
   * adaptive loop walked their setting straight back up, one chunk at a time, which reads
   * exactly as "the render distance does nothing". Dan reported it from play.
   */
  S.setRenderDistance = function (n) {
    n = Math.max(2, Math.min(24, n | 0));
    S.renderDistance = n;
    S.rdBase = n;
    if (S.simDistance > n) S.simDistance = n;    // D-452 — sim can never exceed render
    return n;
  };

  /** setSimDistance(n) — the ONE place the player's chosen simulation distance is written. */
  S.setSimDistance = function (n) {
    n = Math.max(2, Math.min(S.renderDistance, n | 0));
    S.simDistance = n;
    return n;
  };

  /** What every tick-distance gate actually reads (D-452): never wider than what is loaded,
   *  even if `adapt()` pulled `renderDistance` down without going through `setRenderDistance`. */
  S.effectiveSimDistance = function () {
    var sd = S.simDistance || S.renderDistance;
    return sd < S.renderDistance ? sd : S.renderDistance;
  };

  S.cyclePreset = function (dir) {
    var i = S.ORDER.indexOf(S.preset);
    if (i < 0) i = S.ORDER.indexOf(S.detected);          // coming back from 'custom'
    if (i < 0) i = 1;
    else i = (i + dir + S.ORDER.length * 2) % S.ORDER.length;
    S.applyPreset(S.ORDER[i]);
    return S.preset;
  };

  S.presetLabel = function () {
    var p = S.PRESETS[S.preset];
    return p ? p.label : 'Custom';
  };

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  // ⚠ `viewBobbing` IS PERSISTED AND IS NOT A PRESET KEY (D-359). A player who turns the bob off
  // because it makes them ill must not have it turned back on by the quality preset changing.
  var PERSIST = S.PRESET_KEYS.concat(['preset', 'fov', 'fovEffectScale', 'biomeBlendRadius', 'gamma', 'guiScale', 'backend', 'sensitivity', 'invertY', 'toggleSneak', 'toggleSprint', 'noLock', 'keyBinds', 'pauseOnLostFocus',
                                      'adaptive', 'rdBase', 'viewBobbing', 'autoJump', 'entityDistanceScaling', 'entityShadows', 'showSubtitles', 'advancedTooltips', 'fullscreen', 'particles', 'cloudRenderMode', 'attackIndicator', 'horizonFade',
                                      'modelPart_cape', 'modelPart_jacket', 'modelPart_left_sleeve', 'modelPart_right_sleeve',
                                      'modelPart_left_pants_leg', 'modelPart_right_pants_leg', 'modelPart_hat', 'mainHand',
                                      'simDistance', 'maxFps',
                                      'chatVisibility', 'chatColors', 'chatLinks', 'chatLinksPrompt', 'chatOpacity', 'textBackgroundOpacity', 'chatScale',
                                      'chatLineSpacing', 'chatDelay', 'chatWidth', 'chatHeightFocused', 'chatHeightUnfocused', 'narrator',
                                      'autoSuggestions', 'hideMatchedNames', 'reducedDebugInfo', 'backgroundForChatOnly',
                                      'distortionEffectScale', 'monochromeLogo', 'hideLightningFlashes']);

  // PACER-BEGIN (tools/maxfpscheck.mjs evaluates this block alone)
  /** Window.getFramerateLimit: no world and a screen open (the title) caps at 60. */
  S.framerateLimit = function (hasWorld, hasScreen) {
    return (!hasWorld && hasScreen) ? 60 : S.maxFps;
  };
  /** RenderSystem.limitDisplayFPS as a rAF gate: true when this frame should render. st = {next:0}. */
  S.paceFrame = function (st, now, limit) {
    if (limit >= 260) return true;
    var iv = 1000 / limit;
    if (now < st.next - 0.5) return false;
    st.next += iv;
    if (st.next < now - iv) st.next = now;
    return true;
  };
  // PACER-END

  S.load = function () {
    S.detected = S.detect();
    S.applyPreset(S.detected, { save: false, remesh: false, resize: false });
    S.preset = S.detected;

    try {
      var raw = (typeof localStorage !== 'undefined') && localStorage.getItem('mclite.settings');
      if (raw) {
        var o = JSON.parse(raw);
        // A saved PRESET name replays the preset first, so a preset table that has been retuned
        // since the save reaches the player rather than the old numbers.
        if (typeof o.preset === 'string' && S.PRESETS[o.preset]) {
          S.applyPreset(o.preset, { save: false, remesh: false, resize: false });
        }
        for (var i = 0; i < PERSIST.length; i++) {
          var k = PERSIST[i];
          if (o[k] !== undefined && typeof o[k] === typeof S[k]) S[k] = o[k];
        }
        S.workers = Math.max(1, Math.min(NS.ENV.workersMax || NS.ENV.workers, S.workers));
      }
    } catch (e) { /* file:// may deny localStorage entirely; defaults are fine */ }
    S.applyEntityOptions();
    if (NS.Chat && NS.Chat.syncOptions) NS.Chat.syncOptions();
    return S;
  };

  /** Push the entity options into the renderer (ER.renderDistanceMultiplier is Entity.shouldRender's multiplier). */
  S.applyEntityOptions = function () {
    var v = Math.round(Math.max(0.5, Math.min(5, +S.entityDistanceScaling || 1)) * 4) / 4;
    S.entityDistanceScaling = v;
    if (NS.EntityRender) NS.EntityRender.renderDistanceMultiplier = v;
  };

  S.save = function () {
    S.applyEntityOptions();
    try {
      var o = {};
      for (var i = 0; i < PERSIST.length; i++) o[PERSIST[i]] = S[PERSIST[i]];
      localStorage.setItem('mclite.settings', JSON.stringify(o));
    } catch (e) {}
  };

  /** The skin keys as options.txt lines (GameOptions.write: `key:value`, mainHand via saveArm). */
  S.optionsTxt = function () {
    var out = [], K = PERSIST.filter(function (k) { return k.indexOf('modelPart_') === 0; });
    out.push('mainHand:' + (S.mainHand === 'left' ? 'left' : 'right'));
    for (var i = 0; i < K.length; i++) out.push(K[i] + ':' + (S[K[i]] !== false));
    return out.join('\n') + '\n';
  };
  S.parseOptionsTxt = function (txt) {
    var lines = String(txt).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var j = lines[i].indexOf(':'); if (j < 0) continue;
      var k = lines[i].slice(0, j), v = lines[i].slice(j + 1).trim();
      if (k === 'mainHand') S.mainHand = v === 'left' ? 'left' : 'right';
      else if (k.indexOf('modelPart_') === 0 && typeof S[k] === 'boolean') S[k] = v === 'true';
    }
  };

  S.reset = function () {
    S.applyPreset(S.detected);
  };

  // ---------------------------------------------------------------------------
  // Adaptive render distance (D-46)
  // ---------------------------------------------------------------------------

  /**
   * adapt(frameMs) — nudge the render distance by one chunk at a time, from a 120-frame mean,
   * within ±3/+2 of what the preset asked for. Static presets always mis-guess someone's
   * machine; this is the correction, and it is deliberately slow enough that the player reads it
   * as the world loading in rather than as the settings fighting them.
   */
  S.adapt = function (frameMs) {
    if (!S.adaptive) return;
    S._acc += frameMs; S._n++;
    if (S._n < 120) return;
    var avg = S._acc / S._n;
    S._acc = 0; S._n = 0;
    // ⚠ the band is centred on what the PLAYER asked for, not on a preset (D-160). Reading it
    // from `PRESETS[S.preset]` meant a custom distance had no entry and fell back to the
    // detected preset's, so the adaptive loop undid every manual change.
    var base = S.rdBase || S.renderDistance;
    var lo = Math.max(2, base - 3);
    var hi = base + 2;
    if (avg > S.targetMs * 1.35 && S.renderDistance > lo) S.renderDistance--;
    else if (avg < S.targetMs * 0.75 && S.renderDistance < hi) S.renderDistance++;
  };

  /** One line for the F3 overlay and the benchmark report. */
  S.describe = function () {
    return S.presetLabel() + '  rd ' + S.renderDistance + '  sim ' + S.effectiveSimDistance() +
           '  dpr ' + S.maxDPR + '  ao ' + (S.ao ? 1 : 0) +
           '  mip ' + (S.mipmaps ? 1 : 0) + '  occl ' + (S.occlusion ? 1 : 0) +
           '  leaves ' + (S.fancyLeaves ? 'fancy' : 'fast') +
           '  fog ' + Math.round(S.renderDistance * 16 * S.fogEnd) +
           '  w' + S.workers + '  probe ' + S.probeMs.toFixed(1) + 'ms';
  };
})(MCL);
