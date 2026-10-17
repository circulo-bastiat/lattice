// 15f_options.js — PLAN G11c: VANILLA'S OPTIONS TREE.
//
// MAIN THREAD. Draws through NS.Gui, on vanilla's own `widgets.png` button sprites and its
// bitmap font.
//
// ⚠⚠ **WHAT THIS REPLACES, AND WHY THE OLD ONE HAD TO GO.** `Hud.drawPause` drew a settings
// screen out of filled rectangles in the BROWSER'S OWN FONT — `'13px "Segoe UI",Tahoma'` — with
// twenty-odd rows that reflowed into two columns when the window got short. It worked, and it
// looked nothing like Minecraft, which the charter forbids in as many words: the GUI is on the
// "absolute full parity" side of the line, explicitly. D-139's rule applies — the stage that
// replaces something deletes the something, in the same commit — so `pauseRows` and its
// rectangle painter are gone, not flagged off.
//
// ⚠ **THE LAYOUT NUMBERS ARE VANILLA'S OWN AND THEY ARE IN GUI PIXELS.** A 150x20 button at
// `width/2 - 155`, rows 24 apart, the title at y=15, `Done` 200 wide at `height/6 + 168`. They
// are constants here rather than ratios because they are constants THERE: vanilla's options
// screen does not reflow, it is the same two columns at every window size, and a version that
// reflowed would stop being the screen a player recognises.
//
// ⚠ **THE THREE BUTTON STATES ARE THREE SPRITES, NOT THREE FILL COLOURS.** `widgets.png` rows
// y=46 (disabled), y=66 (normal), y=86 (hovered), each 200x20 — measured off the texture, and
// `optionscheck` asserts all three against its pixels in both directions. A button drawn 200
// wide from a 200-wide sprite is trivial; every other width is TWO BLITS, the left half from the
// sprite's left and the right half from its right, because the sprite has rounded ends and
// stretching it gives a button with soft edges that reads as "not quite Minecraft".

(function (NS) {
  'use strict';

  var O = NS.Options = {
    screen: null,          // 'pause' | 'options' | 'video' | 'controls' | 'sound' | 'language'
    stack: [],             // where Done goes back to
    hit: [],               // rebuilt every frame; { x, y, w, h, fn, label } in DEVICE pixels
    dragging: null         // the slider the pointer is holding
  };

  // ── vanilla's widget geometry, in GUI pixels ───────────────────────────────────────────────
  O.BTN_W = 200;           // the sprite's width, and the width of a full-width button
  O.BTN_H = 20;
  O.HALF_W = 150;          // the two-column width
  O.COL_DX = 160;          // ...and the gap between the columns' left edges
  O.LEFT_DX = -155;        // the left column, from the centre
  O.ROW_DY = 24;           // one row to the next
  O.TITLE_Y = 15;
  O.TOP_DY = -12;          // the first row sits at height/6 - 12
  O.DONE_DY = 168;         // ...and Done at height/6 + 168
  O.SPRITE = { disabled: 46, normal: 66, hover: 86 };
  O.SLIDER_KNOB_W = 8;
  // vanilla's text colours: white on a live button, 0xFFFFA0 hovered, 0xA0A0A0 disabled
  O.FG = 0xFFFFFF;
  O.FG_HOVER = 0xFFFFA0;
  O.FG_OFF = 0xA0A0A0;

  /**
   * ⚠ OWED, NAMED — the screens vanilla has that MC-Lite does not. They are drawn as DISABLED
   * buttons rather than left out, because a player reads an options screen by SHAPE: a grid with
   * two entries missing is a different grid, and "Resource Packs..." greyed out is the truth.
   */
  O.OWED = {
    'Advancements': 'there are no advancements and no advancement tree (G26)',
    'Statistics': 'nothing counts blocks mined, distance walked or time played yet (G26)',
    'Open to LAN': 'there is no server and no networking (out of scope)',
    'Force Unicode Font': 'only the legacy 8x8 ascii sheet ships; there is no unicode page (D-12)',
    'Online...': 'there is no multiplayer and no account (out of scope)',
    'Chat Settings...': 'G12 has chat; its width, height, opacity and scale are not options yet (G26)',
    'Resource Packs...': 'the textures are baked into the one file at build time (D-12)',
    'Accessibility Settings...': 'no narrator, no text background, no toggle-sprint (G26)',
    'Key Binds...': 'the key map is a table in 13_input.js and nothing rebinds it yet',
    'Realms Notifications': 'there is no Realms and never will be'
  };

  // ── drawing primitives ────────────────────────────────────────────────────────────────────
  /**
   * One vanilla button. `state` is 'normal' | 'hover' | 'disabled'.
   *
   * ⚠ TWO BLITS FOR ANY WIDTH BELOW 200, and the seam is at the MIDDLE of the destination, not
   * of the source: the left half comes from the sprite's x=0 and the right half from
   * x = 200 - w/2, so both rounded ends survive and the flat middle is what gets shortened.
   * Scaling one blit to fit would round the corners by however much the button was narrowed.
   */
  O.drawButton = function (c, gx, gy, gw, label, state, s, ox, oy) {
    var g = NS.Gui;
    if (!g || !g.ready) return;
    var sy = O.SPRITE[state] !== undefined ? O.SPRITE[state] : O.SPRITE.normal;
    var half = gw * 0.5;
    var x = ox + gx * s, y = oy + gy * s;
    g.blit(c, 'widgets', [0, sy, Math.ceil(half), O.BTN_H], x, y, s);
    g.blit(c, 'widgets', [O.BTN_W - Math.floor(half), sy, Math.floor(half), O.BTN_H],
           x + Math.ceil(half) * s, y, s);
    if (label) {
      var rgb = state === 'disabled' ? O.FG_OFF : (state === 'hover' ? O.FG_HOVER : O.FG);
      var tw = g.textWidth(label);
      g.text(c, label, x + (gw - tw) * 0.5 * s, y + (O.BTN_H - 8) * 0.5 * s, s, rgb, true);
    }
  };

  /**
   * One vanilla slider. The TRACK is the disabled button sprite and the KNOB is a live one, 8
   * wide — that is why a slider looks like a button with a bump in it, and why it goes pale when
   * you grab it.
   */
  O.drawSlider = function (c, gx, gy, gw, label, frac, hover, s, ox, oy) {
    var g = NS.Gui;
    if (!g || !g.ready) return;
    O.drawButton(c, gx, gy, gw, null, 'disabled', s, ox, oy);
    // ⚠ TRUNCATION, NOT ROUNDING. `AbstractSliderButton.renderBg` is
    // `this.x + (int)(this.value * (double)(this.width - 8))` — a `d2i`, which truncates toward
    // zero. Rounding puts the knob half a pixel further right for most of the track and makes the
    // knob and the value disagree at exactly the ends, which is where a slider is read.
    var kx = gx + ((frac * (gw - O.SLIDER_KNOB_W)) | 0);
    var ky = O.SPRITE[hover ? 'hover' : 'normal'];
    var x = ox + kx * s, y = oy + gy * s;
    g.blit(c, 'widgets', [0, ky, 4, O.BTN_H], x, y, s);
    g.blit(c, 'widgets', [O.BTN_W - 4, ky, 4, O.BTN_H], x + 4 * s, y, s);
    var tw = g.textWidth(label);
    g.text(c, label, ox + (gx + (gw - tw) * 0.5) * s, y + (O.BTN_H - 8) * 0.5 * s, s, O.FG, true);
  };

  // ── the rows of each screen ───────────────────────────────────────────────────────────────
  // A row is { t, label, ... }:
  //   't:btn'    label, fn            a plain button
  //   't:owed'   label                a button vanilla has and this does not — drawn disabled
  //   't:cycle'  label, val(), fn     vanilla's "Label: Value" button, which cycles on click
  //   't:slide'  label(), frac(), set(frac)
  // Every value is a FUNCTION, so a screen redrawn after a click shows the new value without
  // anybody remembering to invalidate anything.

  var S = function () { return NS.Settings; };

  /** vanilla's `PauseScreen`. */
  O.pauseRows = function () {
    return [
      { t: 'btn', wide: true, label: 'Back to Game', fn: function () { NS.Hud.close(); } },
      { t: 'owed', label: 'Advancements' },
      { t: 'owed', label: 'Statistics' },
      { t: 'btn', label: 'Options...', fn: function () { O.go('options'); } },
      { t: 'owed', label: 'Open to LAN' },
      { t: 'btn', wide: true, label: 'Save and Quit to Title', fn: function () {
        if (NS.Save) NS.Save.save(true);
        NS.Hud.close();
        if (NS.Main && NS.Main.toTitle) NS.Main.toTitle();
      } }
    ];
  };

  /** vanilla's `OptionsScreen`: one FOV slider, then a 2x4 grid, then Done. */
  O.optionsRows = function () {
    return [
      { t: 'slide', wide: true, top: true,
        label: function () {
          var f = S().fov;
          return 'FOV: ' + (f === 70 ? 'Normal' : (f >= 110 ? 'Quake Pro' : f.toFixed(0)));
        },
        frac: function () { return (S().fov - 30) / (110 - 30); },
        set: function (f) { S().fov = Math.round(30 + f * 80); S().save(); } },
      { t: 'btn', label: 'Skin Customization...', fn: function () { O.go('skin'); } },
      { t: 'owed', label: 'Online...' },
      { t: 'btn', label: 'Music & Sounds...', fn: function () { O.go('sound'); } },
      { t: 'btn', label: 'Video Settings...', fn: function () { O.go('video'); } },
      { t: 'btn', label: 'Controls...', fn: function () { O.go('controls'); } },
      { t: 'btn', label: 'Language...', fn: function () { O.go('language'); } },
      { t: 'owed', label: 'Chat Settings...' },
      { t: 'owed', label: 'Resource Packs...' },
      { t: 'owed', label: 'Accessibility Settings...' }
    ];
  };

  /**
   * vanilla's `VideoSettingsScreen`, with MC-Lite's own controls folded in AFTER vanilla's —
   * which is where a player looks for them and is also where OptiFine has always put its own.
   */
  /** slider max = the Auto result for the current window */
  O.guiScaleMax = function () { var H = NS.Hud || {}; return S().calculateScaleFactor(0, H.w || 854, H.h || 480); };
  O.videoRows = function () {
    var cycle = function (label, val, fn) { return { t: 'cycle', label: label, val: val, fn: fn }; };
    var toggle = function (label, on, fn) {
      return { t: 'cycle', label: label, val: function () { return on() ? 'ON' : 'OFF'; }, fn: fn };
    };
    return [
      { t: 'slide', label: function () { return 'Max Framerate: ' + (S().maxFps >= 260 ? 'Unlimited' : S().maxFps + ' fps'); },
        frac: function () { return (S().maxFps - 10) / 250; },
        set: function (f) { S().maxFps = Math.max(10, Math.min(260, Math.round((10 + f * 250) / 10) * 10)); S().save(); } },
      { t: 'slide', label: function () { return 'Render Distance: ' + S().renderDistance + ' chunks'; },
        frac: function () { return (S().renderDistance - 2) / (32 - 2); },
        set: function (f) { S().setRenderDistance(Math.round(2 + f * 30)); S().markCustom(); S().save(); } },
      // D-452 — vanilla's own separate option: entities/spawning/random-ticks run only this far;
      // render distance keeps deciding what is meshed and drawn. Clamped to <= render distance
      // (the slider's own top end moves with it, same shape as vanilla's Video Settings screen).
      { t: 'slide', label: function () { return 'Simulation Distance: ' + S().effectiveSimDistance() + ' chunks'; },
        frac: function () { return (S().effectiveSimDistance() - 2) / Math.max(1, S().renderDistance - 2); },
        set: function (f) { S().setSimDistance(Math.round(2 + f * (S().renderDistance - 2))); S().markCustom(); S().save(); } },
      { t: 'slide', label: function () { return 'GUI Scale: ' + (S().guiScale ? S().guiScale : 'Auto'); },
        frac: function () { return S().guiScale / O.guiScaleMax(); },
        set: function (f) { S().guiScale = Math.round(f * O.guiScaleMax()); if (NS.Hud && NS.Hud.w) NS.Hud.resize(NS.Hud.w, NS.Hud.h, NS.Hud.dpr); S().save(); } },
      { t: 'slide', label: function () { var v = S().fovEffectScale; return 'FOV Effects: ' + (v === 0 ? 'Off' : Math.round(v * 100) + '%'); },
        frac: function () { return S().fovEffectScale; },
        set: function (f) { S().fovEffectScale = Math.round(f * 100) / 100; S().save(); } },
      toggle('Fullscreen', function () { return NS.Fullscreen.active(); }, function () { NS.Fullscreen.toggle(); }),
      { t: 'slide', label: function () { return NS.Lightmap.label(S().gamma); },
        frac: function () { return S().gamma; },
        set: function (f) { S().gamma = Math.round(f * 100) / 100; S().save(); } },
      cycle('Graphics', function () { return S().fancyLeaves ? 'Fancy' : 'Fast'; }, function () {
        var t = S();
        t.fancyLeaves = !t.fancyLeaves;
        t.crossModels = t.fancyLeaves;
        t.markCustom(); t.push({ remesh: true }); t.save();
      }),
      // ⚠ VANILLA HAS THIS OPTION AND SO DOES THIS (D-359). It is on the VIDEO screen in the
      // real game too, and it is NOT a quality setting — turning it off changes nothing about
      // how expensive a frame is, only whether the camera rocks as you walk.
      // ParticlesMode (.decomp option/ParticlesMode.java): All / Decreased / Minimal; byId floorMods the id.
      cycle('Attack Indicator', function () { return ['Off', 'Crosshair', 'Hotbar'][(S().attackIndicator | 0) % 3]; }, function () {
        var t = S(); t.attackIndicator = ((t.attackIndicator | 0) + 1) % 3; t.save();
      }),
      cycle('Particles', function () { return ['All', 'Decreased', 'Minimal'][(S().particles | 0) % 3]; }, function () {
        var t = S(); t.particles = ((t.particles | 0) + 1) % 3; t.save();
      }),
      toggle('Auto-Jump', function () { return S().autoJump !== false; }, function () {
        var t = S(); t.autoJump = !(t.autoJump !== false); t.save();
      }),
      toggle('View Bobbing', function () { return S().viewBobbing !== false; }, function () {
        var t = S(); t.viewBobbing = !(t.viewBobbing !== false); t.save();
      }),
      // ⚠ D-415 — "that white line in the sky". ON is the fix (the sky disc fades into the fog
      // the way vanilla's FOG_SKY makes it); OFF is what the game looked like before, a hard
      // horizontal seam at pitch 0. Costs nothing either way — it is not a quality option.
      toggle('Horizon Fade', function () { return S().horizonFade !== false; }, function () {
        var t = S(); t.horizonFade = !(t.horizonFade !== false); t.save();
      }),
      toggle('Smooth Lighting', function () { return S().ao; }, function () {
        var t = S(); t.ao = !t.ao; t.smoothLighting = t.ao;
        t.markCustom(); t.push({ remesh: true }); t.save();
      }),
      cycle('Quality Preset', function () {
        return S().presetLabel() + (S().preset === S().detected ? ' *' : '');
      }, function () { S().cyclePreset(1); }),
      { t: 'slide', label: function () { return 'Resolution: ' + S().maxDPR.toFixed(2) + 'x'; },
        frac: function () { return (S().maxDPR - 0.5) / 1.5; },
        set: function (f) {
          S().maxDPR = Math.round((0.5 + f * 1.5) * 4) / 4;
          S().markCustom(); S().save(); if (NS.Main) NS.Main.resize();
        } },
      // ⚠ D-428 — Dan, session 55: *"add a proper option in settings to toggle amount of web
      // workers; its set to 4 now with no tinkering."* The range is 1 .. this machine's thread
      // count (`ENV.workersMax`), NOT the old 4-capped recommendation, and the pool is resized
      // LIVE: `Jobs.resize` retires a busy worker instead of terminating it, so nothing in
      // flight is dropped and there is no "restart to apply".
      // ⚠ The label shows what the pool ACTUALLY is when it disagrees with the setting — a
      // worker that is finishing a chunk is still alive, and a slider that claimed otherwise
      // would be lying for a second or two every time it is dragged down.
      { t: 'slide', label: function () {
          var max = (NS.ENV.workersMax || 4);
          var inline = NS.Jobs.mode === 'inline';
          var want = inline ? 0 : NS.Jobs.clampSize(S().workers);
          var live = NS.Jobs.mode === 'workers' ? NS.Jobs.workers.length : 0;
          return 'Worker Threads: ' + want + ' of ' + max +
                 (live !== want ? ' (' + live + ' live)' : '') +
                 (inline ? ' — inline' : '');
        },
        frac: function () {
          var max = (NS.ENV.workersMax || 4);
          return max > 1 ? (NS.Jobs.clampSize(S().workers) - 1) / (max - 1) : 1;
        },
        set: function (f) {
          var max = (NS.ENV.workersMax || 4);
          var n = Math.max(1, Math.min(max, Math.round(1 + f * (max - 1))));
          if (n === (S().workers | 0)) return;
          S().workers = n; S().markCustom(); S().save();
          NS.Jobs.resize(n);
        } },
      cycle('Renderer', function () {
        var t = S();
        return t.backend + (t.backend === 'auto' ? ' (' + NS.Gfx.name + ')' : '');
      }, function () { NS.Main.cycleBackend(1); }),
      toggle('Plants and Flowers', function () { return S().crossModels; }, function () {
        var t = S(); t.crossModels = !t.crossModels;
        t.markCustom(); t.push({ remesh: true }); t.save();
      }),
      toggle('Mipmap Levels', function () { return S().mipmaps; }, function () {
        var t = S(); t.mipmaps = !t.mipmaps; t.markCustom(); t.push({}); t.save();
      }),
      toggle('Occlusion Culling', function () { return S().occlusion; }, function () {
        var t = S(); t.occlusion = !t.occlusion; t.markCustom(); t.push({}); t.save();
      }),
      toggle('Depth Prepass', function () { return S().depthPrepass; }, function () {
        var t = S(); t.depthPrepass = !t.depthPrepass; t.markCustom(); t.push({}); t.save();
      }),
      toggle('Adaptive Distance', function () { return S().adaptive; }, function () {
        var t = S(); t.adaptive = !t.adaptive; t.save();
      }),
      toggle('Wireframe', function () { return NS.Gfx.wireframe; }, function () {
        NS.Gfx.wireframe = !NS.Gfx.wireframe;
      })
    ];
  };

  /** vanilla's `ControlsScreen`. */
  O.controlsRows = function () {
    var I = function () { return NS.Input; };
    return [
      { t: 'slide', label: function () {
          var v = I().sensitivity / 0.0022;
          return 'Sensitivity: ' + (Math.abs(v - 1) < 0.02 ? 'Normal' : Math.round(v * 100) + '%');
        },
        frac: function () { return (I().sensitivity - 0.0004) / (0.008 - 0.0004); },
        set: function (f) {
          I().sensitivity = 0.0004 + f * 0.0076;
          S().sensitivity = I().sensitivity; S().save();
        } },
      { t: 'owed', label: 'Key Binds...' },
      { t: 'cycle', label: 'Invert Mouse',
        val: function () { return NS.Input.invertY ? 'ON' : 'OFF'; },
        fn: function () { NS.Input.invertY = !NS.Input.invertY; S().invertY = NS.Input.invertY; S().save(); } },
      { t: 'cycle', label: 'Sneak',
        val: function () { return NS.Input.toggleSneak ? 'Toggle' : 'Hold'; },
        fn: function () { var In = NS.Input; In.toggleSneak = !In.toggleSneak; In.sneakToggled = false; S().toggleSneak = In.toggleSneak; S().save(); } },
      { t: 'cycle', label: 'Sprint',
        val: function () { return NS.Input.toggleSprint ? 'Toggle' : 'Hold'; },
        fn: function () { var In = NS.Input; In.toggleSprint = !In.toggleSprint; In.sprintToggled = false; S().toggleSprint = In.toggleSprint; S().save(); } },
      { t: 'cycle', label: 'Creative Flight',
        val: function () { return NS.Player.flying ? 'ON' : 'OFF'; },
        fn: function () { if (NS.Player.mayFly) { NS.Player.flying = !NS.Player.flying; NS.Player.vy = 0; } } },
      { t: 'cycle', label: 'Noclip',
        val: function () { return NS.Player.noclip ? 'ON' : 'OFF'; },
        fn: function () {
          var P = NS.Player; P.noclip = !P.noclip; if (P.noclip) P.flying = true;
        } }
    ];
  };

  /**
   * vanilla's `SoundOptionsScreen`: a master slider across the top and one per `SoundSource`.
   * ⚠ ALL TEN ARE HERE AND SIX OF THEM CONTROL A GAIN NODE NOTHING FEEDS YET. That is not a
   * placeholder: the node and the slider are real, `Sound.OWED_SOURCES` names what has not
   * started using each one, and a screen with four sliders would be a different screen.
   */
  O.SOUND_LABELS = {
    master: 'Master Volume', music: 'Music', record: 'Jukebox/Note Blocks',
    weather: 'Weather', block: 'Blocks', hostile: 'Hostile Creatures',
    neutral: 'Friendly Creatures', player: 'Players', ambient: 'Ambient/Environment',
    voice: 'Voice/Speech'
  };
  O.soundRows = function () {
    var Sn = NS.Sound, rows = [];
    var srcs = (Sn && Sn.SOURCES) || ['master'];
    for (var i = 0; i < srcs.length; i++) {
      rows.push((function (src, first) {
        return { t: 'slide', wide: first, top: first,
          label: function () {
            var v = Sn.volumeOf(src);
            return O.SOUND_LABELS[src] + ': ' + (v <= 0 ? 'OFF' : Math.round(v * 100) + '%');
          },
          frac: function () { return Sn.volumeOf(src); },
          set: function (f) { Sn.setSourceVolume(src, f); if (S()) { S().sound = Sn.volumes; S().save(); } } };
      })(srcs[i], i === 0));
    }
    return rows;
  };

  /**
   * vanilla's `LanguageSelectScreen`. MC-Lite ships ONE language, and the screen says so rather
   * than pretending to a list: `build-gui`/`pack-lang` embed `en_us.json` and D-12 counts every
   * kilobyte, so a second language is a decision nobody has made, not an oversight.
   */
  O.languageRows = function () {
    return [
      { t: 'btn', wide: true, top: true, label: 'English (US)  ✓', fn: function () {} },
      { t: 'owed', wide: true, label: 'Force Unicode Font' }
    ];
  };

  /** vanilla's `SkinOptionsScreen`: seven PlayerModelPart ON/OFF buttons, then Main Hand. */
  O.MODEL_PARTS = [['cape', 'Cape'], ['jacket', 'Jacket'], ['left_sleeve', 'Left Sleeve'],
    ['right_sleeve', 'Right Sleeve'], ['left_pants_leg', 'Left Pants Leg'],
    ['right_pants_leg', 'Right Pants Leg'], ['hat', 'Hat']];
  O.skinRows = function () {
    var rows = O.MODEL_PARTS.map(function (p) {
      var k = 'modelPart_' + p[0];
      return { t: 'cycle', label: p[1], val: function () { return S()[k] !== false ? 'ON' : 'OFF'; },
               fn: function () { var t = S(); t[k] = !(t[k] !== false); t.save(); } };
    });
    rows.push({ t: 'cycle', label: 'Main Hand', val: function () { return S().mainHand === 'left' ? 'Left' : 'Right'; },
                fn: function () { var t = S(); t.mainHand = t.mainHand === 'left' ? 'right' : 'left'; t.save(); } });
    return rows;
  };
  /** { id: bool } for the seven parts, and 'left' | 'right'. */
  O.modelParts = function () {
    var o = {};
    for (var i = 0; i < O.MODEL_PARTS.length; i++) o[O.MODEL_PARTS[i][0]] = S()['modelPart_' + O.MODEL_PARTS[i][0]] !== false;
    return o;
  };
  O.mainHand = function () { return S().mainHand === 'left' ? 'left' : 'right'; };
  // SkinOptionsScreen: rows from height/6 (no -12), title y=20, Done after the 8th button
  O.GEOM = { skin: { topDy: 0, doneDy: 96, titleY: 20 } };

  O.ROWS = {
    pause: O.pauseRows, options: O.optionsRows, video: O.videoRows,
    controls: O.controlsRows, sound: O.soundRows, language: O.languageRows, skin: O.skinRows
  };
  O.TITLES = {
    pause: 'Game Menu', options: 'Options', video: 'Video Settings',
    controls: 'Controls', sound: 'Music & Sound Options', language: 'Language', skin: 'Skin Customization'
  };

  /**
   * The rows of the current screen, BUILT ONCE PER SCREEN (D-340).
   *
   * ⚠⚠ **THEY USED TO BE REBUILT ON EVERY DRAW, AND THAT BROKE THE DRAG AFTER ONE STEP.** Each
   * `O.*Rows()` returns fresh object literals, and `O.dragging` holds one of them; `O.drag` finds
   * the row it is dragging by OBJECT IDENTITY. The `uidrag` handler in `17_main.js` calls
   * `Options.drag(...)` and then `Hud.draw()` — so the very first pointer move rebuilt the row
   * set, and every move after it found no match and did nothing. **A slider would have moved once
   * and then stuck**, which is a bug the drag fix of D-330 would have shipped with, and which
   * `inputcheck` found on its first run by moving the pointer twice.
   *
   * ⚠ IT IS ALSO WHAT VANILLA DOES. A `Screen` builds its widgets in `init()`, not in `render()`.
   * Nothing is lost by caching: every VALUE on a row is a function, so a cached row still shows
   * the current setting — that was the point of the row contract in the first place.
   */
  O.rowsBuilt = null;
  O.rowsScreen = null;
  O.rowsFor = function () {
    if (O.rowsBuilt && O.rowsScreen === O.screen) return O.rowsBuilt;
    O.rowsBuilt = (O.ROWS[O.screen] || O.pauseRows)();
    O.rowsScreen = O.screen;
    return O.rowsBuilt;
  };
  /** Drop the cache — any change of screen, and closing the menu. */
  // ⚠ FOCUS IS CLEARED HERE TOO (D-353): index 3 of the video screen is not index 3 of the pause
  // screen, and carrying it across would move focus to an unrelated widget with nothing to say so.
  O.invalidate = function () {
    O.rowsBuilt = null; O.rowsScreen = null; O.dragging = null; O.focus = -1;
  };

  // ── navigation ────────────────────────────────────────────────────────────────────────────
  O.go = function (name) {
    if (O.screen) O.stack.push(O.screen);
    O.screen = name;
    O.invalidate();
  };
  O.back = function () {
    O.screen = O.stack.pop() || null;
    O.invalidate();
    if (!O.screen) NS.Hud.close();
  };
  O.open = function (name) { O.stack.length = 0; O.screen = name || 'pause'; O.invalidate(); };

  // ── layout ────────────────────────────────────────────────────────────────────────────────
  /**
   * Where every row of a screen goes, in GUI pixels: `[{ row, x, y, w }]`, plus the Done button.
   *
   * ⚠ A `wide` ROW TAKES A WHOLE LINE AND THE GRID RESUMES BELOW IT, which is vanilla's own
   * behaviour for the FOV and master-volume sliders. Treating it as one cell of the grid would
   * leave a 150-pixel hole beside it and shift every pair after it into the wrong column.
   */
  O.layout = function (rows, gw, gh) {
    var out = [], cx = gw * 0.5;
    var G = O.GEOM[O.screen] || {};
    var top = Math.round(gh / 6) + (G.topDy !== undefined ? G.topDy : O.TOP_DY);
    var line = 0, col = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.wide) {
        if (col) { line++; col = 0; }
        out.push({ row: r, x: Math.round(cx - O.BTN_W * 0.5), y: top + line * O.ROW_DY, w: O.BTN_W });
        line++;
        continue;
      }
      out.push({ row: r, x: Math.round(cx + O.LEFT_DX + col * O.COL_DX), y: top + line * O.ROW_DY,
                 w: O.HALF_W });
      col++;
      if (col === 2) { col = 0; line++; }
    }
    var doneY = Math.round(gh / 6) + (G.doneDy !== undefined ? G.doneDy : O.DONE_DY);
    // ⚠ never UNDER the last row. Vanilla's screens all fit in eight lines; MC-Lite's video
    // screen has more, and a Done button at a fixed offset would land on top of them.
    var lastY = out.length ? out[out.length - 1].y + O.BTN_H : top;
    if (G.doneDy === undefined && doneY < lastY + 8) doneY = lastY + 8;
    return { rows: out, done: { x: Math.round(cx - O.BTN_W * 0.5), y: doneY, w: O.BTN_W } };
  };

  // ── the whole screen ──────────────────────────────────────────────────────────────────────
  O.draw = function (c, w, h, s) {
    var g = NS.Gui;
    if (!g || !g.ready || !O.screen) return false;
    var gw = w / s, gh = h / s;
    var rows = O.rowsFor();
    var L = O.layout(rows, gw, gh);
    O.hit.length = 0;

    g.dim(c, w, h);

    var title = O.TITLES[O.screen] || '';
    g.text(c, title, (w - g.textWidth(title) * s) * 0.5, ((O.GEOM[O.screen] || {}).titleY || O.TITLE_Y) * s, s, 0xFFFFFF, true);

    var I = NS.Input, mx = I ? I.mx : -1e9, my = I ? I.my : -1e9;
    for (var i = 0; i < L.rows.length; i++) {
      var e = L.rows[i], r = e.row;
      var x = e.x * s, y = e.y * s, bw = e.w * s, bh = O.BTN_H * s;
      var hov = mx >= x && mx < x + bw && my >= y && my < y + bh;
      // ⚠ `isHoveredOrFocused` (D-353): vanilla draws a focused widget in the SAME sprite as a
      // hovered one, which is the only feedback a keyboard user gets about where they are.
      // ⚠ THE INDEX IS `O.hit.length` AS THIS ROW IS ABOUT TO BE PUSHED, not `i`: owed rows are
      // drawn and never pushed, so the two counters diverge the moment a screen has one.
      if (O.focus === O.hit.length) hov = true;
      if (r.t === 'owed') {
        O.drawButton(c, e.x, e.y, e.w, r.label, 'disabled', s, 0, 0);
        continue;
      }
      if (r.t === 'slide') {
        O.drawSlider(c, e.x, e.y, e.w, r.label(), r.frac(), hov || O.dragging === r, s, 0, 0);
        O.hit.push({ x: x, y: y, w: bw, h: bh, s: s, row: r, cell: e, label: r.label() });
        continue;
      }
      var label = r.t === 'cycle' ? (r.label + ': ' + r.val()) : r.label;
      O.drawButton(c, e.x, e.y, e.w, label, hov ? 'hover' : 'normal', s, 0, 0);
      O.hit.push({ x: x, y: y, w: bw, h: bh, row: r, cell: e, label: label });
    }
    var dx = L.done.x * s, dy = L.done.y * s, dw = L.done.w * s, dh = O.BTN_H * s;
    var dhov = mx >= dx && mx < dx + dw && my >= dy && my < dy + dh;
    if (O.focus === O.hit.length) dhov = true;
    O.drawButton(c, L.done.x, L.done.y, L.done.w, O.screen === 'pause' ? 'Back to Game' : 'Done',
                 dhov ? 'hover' : 'normal', s, 0, 0);
    O.hit.push({ x: dx, y: dy, w: dw, h: dh, row: { t: 'done' }, label: 'Done' });
    return true;
  };

  // ── input ─────────────────────────────────────────────────────────────────────────────────
  O.at = function (mx, my) {
    for (var i = O.hit.length - 1; i >= 0; i--) {
      var r = O.hit[i];
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) return r;
    }
    return null;
  };

  O.click = function (mx, my) {
    var h = O.at(mx, my);
    if (!h) return false;
    var r = h.row;
    if (r.t === 'done') { O.back(); return true; }
    if (r.t === 'slide') {
      O.dragging = r;
      O.drag(mx);
      return true;
    }
    if (r.fn) { r.fn(); return true; }
    return true;
  };

  /**
   * A slider follows the pointer while it is held, which is the only way one reads as a slider.
   *
   * ⚠⚠ **THE KNOB'S CENTRE GOES UNDER THE POINTER, NOT ITS LEFT EDGE.** Vanilla is
   * `setValue((mouseX - (x + 4)) / (width - 8))` — `AbstractSliderButton`'s own bytecode: subtract
   * half the 8-wide knob from the pointer, divide by the TRAVEL rather than by the width. Dividing
   * by the full width, as this did, makes the knob lag the pointer by up to eight GUI pixels and —
   * worse — makes the DRAWN position disagree with the value, because `drawSlider` already lays
   * the knob out across `gw - 8`. **Two expressions for one geometry, only one of them right.**
   * ⚠ The numbers are GUI units and the rect is in screen pixels, so both terms carry `s`.
   */
  O.valueFromMouse = function (mx, x, w, s) {
    var travel = w - O.SLIDER_KNOB_W * s;
    var f = (mx - (x + O.SLIDER_KNOB_W * 0.5 * s)) / (travel > 0 ? travel : 1);
    return f < 0 ? 0 : (f > 1 ? 1 : f);
  };

  O.drag = function (mx) {
    if (!O.dragging) return false;
    for (var i = 0; i < O.hit.length; i++) {
      if (O.hit[i].row !== O.dragging) continue;
      var e = O.hit[i];
      // ⚠ THE DRAG GOES THROUGH `setRaw` TOO, so a pointer and an arrow key are one value and
      // not two: dragging to 0.49 and then pressing Right steps from 0.49, not from whatever
      // the setting snapped to (D-353, and D-314's rule about one rule with two answers).
      O.setRaw(O.dragging, O.valueFromMouse(mx, e.x, e.w, e.s || 1));
      return true;
    }
    return false;
  };
  O.release = function () { O.dragging = null; };

  /**
   * ── KEYBOARD OPERATION OF THE SCREEN (D-353) ────────────────────────────────────────────────
   *
   * Vanilla's sliders step with the left and right arrows — but only when the widget is FOCUSED,
   * and focus is a `Screen`-wide concept: Tab and Shift-Tab walk `children()`, the focused widget
   * draws in its hover state, and Enter or Space activates a button. Wiring the arrows to a slider
   * without that would be arrow keys that work on whichever slider a hidden variable happened to
   * point at — a feature that is worse than its absence. So the whole of it is here.
   *
   * ⚠⚠ **FOCUS IS AN INDEX, NOT THE WIDGET** (D-340, paid for once already). `O.rowsFor()` is
   * rebuilt whenever the screen changes and `O.hit` is rebuilt EVERY FRAME, so a focus that held
   * the row OBJECT would be correct for exactly one frame — which is the bug `inputcheck` found
   * in the slider drag, where the first pointer move worked and every move after it matched
   * nothing. The index is into `O.hit`, which `draw` lays out in the screen's own order, so it
   * survives a redraw and means the same thing in the next one.
   * ⚠ AND IT IS CLEARED WHENEVER THE SCREEN CHANGES, because index 3 of the video screen is not
   * index 3 of the pause screen and silently keeping it would move focus to an unrelated widget.
   */
  O.focus = -1;                                        // D-353

  /** How many widgets this screen can focus: everything `draw` put in `O.hit`. */
  O.focusCount = function () { return O.hit.length; };

  /**
   * Tab (dir 1) and Shift-Tab (dir -1). Wraps, exactly as vanilla's `changeFocus` does when it
   * runs off either end of `children()`.
   * ⚠ FROM NOTHING, TAB GOES TO THE FIRST WIDGET AND SHIFT-TAB TO THE LAST. Vanilla starts at
   * `null` and asks the list for the next one in the direction of travel; starting both at 0
   * would make Shift-Tab on a fresh screen do nothing visible, which reads as broken.
   */
  O.moveFocus = function (dir) {
    var n = O.hit.length;
    if (!n) { O.focus = -1; return false; }
    if (O.focus < 0 || O.focus >= n) { O.focus = dir > 0 ? 0 : n - 1; return true; }
    O.focus = ((O.focus + dir) % n + n) % n;
    return true;
  };

  /** The row under the focus, or null. */
  O.focused = function () {
    return (O.focus >= 0 && O.focus < O.hit.length) ? O.hit[O.focus] : null;
  };

  /**
   * Enter or Space on the focused widget — the same path a click takes, so a button cannot
   * behave differently depending on how it was pressed.
   * ⚠ IT GOES THROUGH THE SAME CODE, not through a copy of it: two ways to press one button is
   * two answers to one question (D-314).
   */
  O.activate = function () {
    var h = O.focused();
    if (!h) return false;
    var r = h.row;
    if (r.t === 'done') { O.back(); return true; }
    // ⚠ A SLIDER IS NOT "ACTIVATED" BY ENTER IN VANILLA — `AbstractSliderButton.onClick` only
    // begins a drag, and there is no drag without a pointer. Enter on a focused slider does
    // nothing, and that is the faithful answer rather than an invented one.
    if (r.t === 'slide') return false;
    if (r.fn) { r.fn(); return true; }
    return false;
  };

  /**
   * Left and Right on a FOCUSED SLIDER.
   *
   * ⚠⚠ **THE STEP IS `1 / (width - 8)`, WHICH IS ONE GUI PIXEL OF TRAVEL** — vanilla's
   * `AbstractSliderButton.keyPressed` is `setValue(value + dir / (this.width - 8))`, the same
   * `width - 8` the knob is laid out across and the same one `valueFromMouse` divides by. Using
   * the full width here would make a keypress and a pointer-drag of the same distance disagree,
   * which is D-330's "two expressions for one geometry" in a third place.
   * ⚠ THE WIDTH IS THE WIDGET'S OWN, IN GUI UNITS, taken from the hit rect the draw produced —
   * never a constant typed here.
   */
  /**
   * ⚠⚠ **THE WIDGET HOLDS THE RAW VALUE, AND WITHOUT THAT THE ARROW KEYS DO NOTHING AT ALL.**
   * A slider here quantises on `set` — render distance is twelve chunks, not 0.4930 — so
   * `frac()` reads back a SNAPPED number, and a step of 1/142 taken from the snapped number
   * snaps straight back to it. `inputcheck` measured exactly that: *"Right moves the slider up
   * (0.5 -> 0.5)"*, an arrow key that would never have moved a coarse slider in its life.
   * Vanilla does not have the problem because `AbstractSliderButton.value` is a raw double the
   * WIDGET keeps and `applyValue` quantises only the setting — so the presses accumulate and the
   * knob moves a hair at a time until it crosses a boundary.
   * ⚠ IT LIVES ON THE ROW, which is vanilla's widget: `rowsFor()` caches rows per screen and
   * `invalidate()` rebuilds them, so the raw value has exactly the lifetime vanilla gives it. It
   * is NOT keyed on the focus index, which changes meaning between screens, and NOT on `O.hit`,
   * which is rebuilt every frame (D-340).
   */
  O.rawFrac = function (row) {
    if (row.__raw === undefined || row.__rawOf !== row.frac()) row.__raw = row.frac();
    return row.__raw;
  };
  /** Set from a raw 0..1, remembering it so the next step starts where this one left off. */
  O.setRaw = function (row, f) {
    f = f < 0 ? 0 : (f > 1 ? 1 : f);
    row.__raw = f;
    row.set(f);
    // ⚠ AND THE SNAPPED VALUE IS REMEMBERED WITH IT, so that a change made ANYWHERE ELSE — a
    // command, a reload, the other end of a drag — is noticed and the raw value re-seeded from
    // it rather than quietly overriding it on the next keypress.
    row.__rawOf = row.frac();
  };

  O.step = function (dir) {
    var h = O.focused();
    if (!h || !h.row || h.row.t !== 'slide') return false;
    var s = h.s || 1;
    var travel = (h.w / s) - O.SLIDER_KNOB_W;
    if (travel <= 0) return false;
    O.setRaw(h.row, O.rawFrac(h.row) + dir / travel);
    return true;
  };

  /**
   * The screen's own key handler. Returns true when the key was consumed, so `13_input.js` knows
   * whether to let it through to the game.
   * ⚠ ESCAPE IS NOT HERE. It belongs to the screen stack and `15_hud.js` already owns it; a
   * second handler for it would be two answers again.
   */
  O.key = function (code, shift) {
    if (!O.screen) return false;
    if (code === 'Tab') return O.moveFocus(shift ? -1 : 1);
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') return O.activate();
    if (code === 'ArrowLeft') return O.step(-1);
    if (code === 'ArrowRight') return O.step(1);
    return false;
  };

  // ⚠ EMPTY, AND `optionscheck` ASSERTS IT IS EMPTY (D-324). A list that is allowed to shrink
  // quietly is a list nobody reads; this one fails the day something is added to it without a
  // check, and failed the day its last entry was implemented.
  O.OWED_INPUT = [];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
