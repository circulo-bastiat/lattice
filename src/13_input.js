// 13_input.js — pointer lock, key/button state, mouse deltas, and the key map. Main thread only.
//
// This file knows about DEVICES, not about the game. Everything a key is supposed to *do* is
// emitted as a named action through I.onAction, which 17_main.js wires up. That is what keeps
// the renderer's debug keys, the HUD's menus and the player's hotbar from all having to import
// each other.

(function (NS) {
  'use strict';

  var I = NS.Input = {
    keys: Object.create(null),
    edge: Object.create(null),     // codes pressed since the last frame; cleared by endFrame()
    mouse: [false, false, false],
    mousePressed: [false, false, false],
    dx: 0, dy: 0,                  // accumulated raw mouse movement
    wheel: 0,                      // accumulated notches
    mx: 0, my: 0,                  // client-space cursor, for the menus
    locked: false,
    noLock: false,                 // #2091: no-pointer-lock mode (VM/RDP): `locked` is true while it is on, with no real lock
    attached: false,
    el: null,

    sensitivity: 0.0022,           // radians per raw mouse unit
    invertY: false,

    // true while a full-screen HUD screen wants the cursor: suppresses look, movement and
    // click-to-lock. 15_hud.js owns the screens; this is the one bit it publishes back.
    uiOpen: false,

    // vanilla double-tap-forward sprint. Latched until W is released.
    ctrl: false,
    shift: false,
    sprintLatch: false,

    // GameOptions.sneakToggled / sprintToggled (ToggleKeyBinding): false = HOLD, true = TOGGLE.
    toggleSneak: false,
    toggleSprint: false,
    sneakToggled: false,           // the latched state while toggleSneak
    sprintToggled: false,
    _lastW: -1e9,

    onAction: null                 // function(name, arg)
  };

  /**
   * code -> action. Only keys that DO something are listed; everything else is polled by name.
   * Digit1..Digit9 are generated rather than typed out.
   */
  var KEYMAP = {
    Escape:   'pause',
    KeyE:     'inventory',
    // F3 -> 'debug' fires on KEY-UP (I.f3Release), so F3+key chords do not toggle the overlay
    F9:       'backend',
    KeyV:     'perspective',   // vanilla's F5; the browser owns F5 (reload), so V
    F2:       'save',
    F3:       'debug',
    F10:      'bench',
    KeyN:     'noclip',
    KeyC:     'creative',
    KeyR:     'respawn',
    KeyQ:     'drop',
    KeyF:     'swapOffhand',
    KeyT:     'chat',
    Slash:    'chatCommand'
  };
  for (var d = 1; d <= 9; d++) KEYMAP['Digit' + d] = 'slot' + (d - 1);
  for (d = 1; d <= 9; d++) KEYMAP['Numpad' + d] = 'slot' + (d - 1);
  I.KEYMAP = KEYMAP;

  /**
   * binding id -> the vanilla key id it is bound to (`key.keyboard.space`, `key.mouse.left`), the
   * form `KeyBinding.getBoundKeyTranslationKey` returns. `''` is unbound. `Text` reads this for
   * `{"keybind":...}`, so a rebind here is what the chat line shows. Vanilla's 1.18.2 defaults.
   */
  I.BINDINGS = {
    'key.attack': 'key.mouse.left', 'key.use': 'key.mouse.right', 'key.pickItem': 'key.mouse.middle',
    'key.forward': 'key.keyboard.w', 'key.left': 'key.keyboard.a', 'key.back': 'key.keyboard.s',
    'key.right': 'key.keyboard.d', 'key.jump': 'key.keyboard.space', 'key.sneak': 'key.keyboard.left.shift',
    'key.sprint': 'key.keyboard.left.control', 'key.inventory': 'key.keyboard.e', 'key.drop': 'key.keyboard.q',
    'key.chat': 'key.keyboard.t', 'key.command': 'key.keyboard.slash', 'key.swapOffhand': 'key.keyboard.f'
  };
  /** Rebind (or, with '', unbind) a binding; unknown ids are refused. */
  I.setBinding = function (id, keyId) {
    if (!Object.prototype.hasOwnProperty.call(I.BINDINGS, id)) return false;
    I.BINDINGS[id] = keyId || '';
    return true;
  };

  /**
   * The DOM code a binding is on NOW (15g_keybinds.js owns the table; before it loads, vanilla's defaults).
   * `bdown` / `bpressed` poll by binding id, so the game never names a physical key.
   */
  I.codeOf = function (id) { return NS.KeyBinds ? NS.KeyBinds.codeOf(id) : ''; };
  I.bdown = function (id) { var c = I.codeOf(id); return !!c && !!I.keys[c]; };
  I.bpressed = function (id) { var c = I.codeOf(id); return !!c && !!I.edge[c]; };
  I.isDefaultBinding = function (id) { return !NS.KeyBinds || NS.KeyBinds.isDefault(id); };
  /** action name -> the binding that fires it. Everything else in KEYMAP is MC-Lite's own and stays fixed. */
  var ACTION_BINDINGS = { inventory: 'key.inventory', drop: 'key.drop', swapOffhand: 'key.swapOffhand', chat: 'key.chat',
    chatCommand: 'key.command', perspective: 'key.togglePerspective' };
  for (var hb = 0; hb < 9; hb++) ACTION_BINDINGS['slot' + hb] = 'key.hotbar.' + (hb + 1);
  // keys MC-Lite adds beside the vanilla default (browser owns F5 -> V; the numpad row): valid only while the binding is default
  var ALIAS = { KeyV: 'perspective' };
  for (var an = 1; an <= 9; an++) ALIAS['Numpad' + an] = 'slot' + (an - 1);
  /** the action a key press fires: a rebindable action follows its binding, never its old key. */
  I.actionFor = function (code) {
    var a, id;
    for (a in ACTION_BINDINGS) { if (I.codeOf(ACTION_BINDINGS[a]) === code) return a; }
    a = KEYMAP[code];
    if (!a) return undefined;
    id = ACTION_BINDINGS[a];
    if (!id) return a;
    return (ALIAS[code] === a && I.isDefaultBinding(id)) ? a : undefined;
  };

  /** Keys we swallow so the browser does not act on them (F3 = find, F9 = nothing, but be safe). */
  var SWALLOW = { F2: 1, F3: 1, F9: 1, F10: 1, Tab: 1 };

  // vanilla Keyboard.processF3: a chord key does its thing and sets `f3Used`, so the F3 KEY-UP does not
  // toggle the overlay. Every handled key (and, as in vanilla, any key pressed while F3 is held) counts.
  var HELP = ['reload_chunks', 'show_hitboxes', 'copy_location', 'clear_chat', 'cycle_renderdistance',
    'chunk_boundaries', 'advanced_tooltips', 'inspect', 'profiling', 'creative_spectator', 'pause_focus',
    'help', 'reload_resourcepacks', 'pause', 'gamemodes'];
  function dbg(key) {
    var T = NS.Text;
    if (!NS.Chat || !T) return;
    // Keyboard.addDebugMessage: "" + [debug.prefix, yellow bold] + " " + message (the message is yellow too)
    var msg = T.translatable(key, [], { color: 'yellow' });
    NS.Chat.add({ text: '', extra: [T.translatable('debug.prefix', [], { color: 'yellow', bold: true }), T.literal(' '), msg] });
  }
  I.f3Held = false; I.f3Used = false;
  I.F3_CHORDS = {
    KeyA: function () { if (NS.World && NS.World.remeshAll) NS.World.remeshAll(); dbg('debug.reload_chunks.message'); },
    KeyB: function () { fire('hitboxes'); },
    F4: function () { fire('gmSwitcher'); },
    KeyN: function () { fire('gmToggle'); },
    KeyH: function () {
      var St = NS.Settings; if (!St) return;
      St.advancedTooltips = !St.advancedTooltips;
      if (NS.Chat && NS.Chat.add && NS.Text && NS.Text.ready) NS.Chat.add(NS.Text.translate(St.advancedTooltips ? 'debug.advanced_tooltips.on' : 'debug.advanced_tooltips.off', []));
      if (St.save) St.save();
    },
    KeyD: function () { if (NS.Chat && NS.Chat.clearAll) NS.Chat.clearAll(); },
    KeyP: function () {
      var S = NS.Settings; if (!S) return;
      S.pauseOnLostFocus = !S.pauseOnLostFocus; if (S.save) S.save();
      dbg(S.pauseOnLostFocus ? 'debug.pause_focus.on' : 'debug.pause_focus.off');
    },
    KeyQ: function () {
      dbg('debug.help.message');
      if (!NS.Chat || !NS.Text) return;
      for (var i = 0; i < HELP.length; i++) NS.Chat.add(NS.Text.translatable('debug.' + HELP[i] + '.help', []));
    }
  };
  /** A key went down. Returns true when it was an F3 chord (handled or not) and must not reach the keymap. */
  I.processF3 = function (code) {
    if (!I.f3Held || code === 'F3') return false;
    I.f3Used = true;
    var h = I.F3_CHORDS[code]; if (h) h();
    return true;
  };
  /** F3 went up: true when the bare-F3 toggle should fire. */
  I.f3Release = function () {
    var toggle = I.f3Held && !I.f3Used;
    I.f3Held = false; I.f3Used = false;
    return toggle;
  };
  I.HELP_KEYS = HELP;

  function fire(name, arg) { if (I.onAction) I.onAction(name, arg); }

  /**
   * Vanilla Window.toggleFullscreen on KEY_F11 + options.fullscreen. The browser only grants
   * requestFullscreen from a user gesture, so the option is applied from the F11 keydown / the
   * Video row click, and a saved `fullscreen: true` waits for the first gesture (`pending`).
   * `fullscreenchange` is the truth: it sets the option (F11 / browser Esc leave) and re-runs the resize.
   */
  var FS = NS.Fullscreen = {
    doc: null,
    target: function () { var d = FS.doc; return (NS.Main && NS.Main.glCanvas && NS.Main.glCanvas.parentNode) || d.documentElement; },
    active: function () { return !!(FS.doc && FS.doc.fullscreenElement); },
    set: function (on) {
      var d = FS.doc; if (!d) return;
      if (on && !d.fullscreenElement) { var t = FS.target(); if (t && t.requestFullscreen) { var r = t.requestFullscreen(); if (r && r.catch) r.catch(function () {}); } }
      else if (!on && d.fullscreenElement && d.exitFullscreen) { var q = d.exitFullscreen(); if (q && q.catch) q.catch(function () {}); }
    },
    toggle: function () { FS.set(!FS.active()); },
    onChange: function () {
      var S = NS.Settings; if (S) { S.fullscreen = FS.active(); if (S.save) S.save(); }
      if (NS.Main && NS.Main.resize) NS.Main.resize();      // canvas size + GUI scale
    },
    install: function (doc) {
      FS.doc = doc;
      doc.addEventListener('fullscreenchange', FS.onChange);
    },
    /** Called on every user gesture: a saved fullscreen:true is honoured at the first one. */
    gesture: function () {
      var S = NS.Settings;
      if (S && S.fullscreen && FS.doc && !FS.active() && !FS.tried) { FS.tried = true; FS.set(true); }
    }
  };
  if (typeof document !== 'undefined') FS.install(document);

  I.attach = function (el) {
    if (I.attached) return I;
    I.attached = true;
    I.el = el;

    window.addEventListener('keydown', function (e) {
      if (e.code === 'F11') { FS.toggle(); e.preventDefault(); return; }
      FS.gesture();
      // F3+G: chunk borders (vanilla Keyboard.processF3 case G). The chord eats the G.
      if (e.code === 'KeyG' && I.keys && I.keys.F3 && NS.ChunkBorder) {
        var cbMsg = NS.ChunkBorder.toggle();
        if (NS.Hud && NS.Hud.say) NS.Hud.say(cbMsg);
        e.preventDefault(); return;
      }
      // ⚠ THE CHAT FIELD SWALLOWS THE KEYBOARD WHOLE (D-283). While it is open, `w` types a `w`
      // and does not walk, `e` does not open the inventory, and `1` does not change slot — that
      // is not a special case, it is what a focused text field means. Only Escape and Enter get
      // out, and this branch is FIRST so no other handler can see the key.
      var Ch = NS.Chat;
      if (Ch && Ch.open) {
        I.keys = Object.create(null);              // nothing is "held" while typing
        if (e.code === 'Escape') { fire('chatCancel'); }
        else if (e.code === 'Enter' || e.code === 'NumpadEnter') { fire('chatSend'); }
        else if (e.code === 'Tab') { Ch.complete(); }
        else if (e.code === 'Backspace') { Ch.backspace(); }
        else if (e.code === 'Delete') { Ch.del(); }
        else if (e.code === 'ArrowLeft') { Ch.move(-1); }
        else if (e.code === 'ArrowRight') { Ch.move(1); }
        else if (e.code === 'ArrowUp') { Ch.history(1); }
        else if (e.code === 'ArrowDown') { Ch.history(-1); }
        else if (e.code === 'Home') { Ch.home(); }
        else if (e.code === 'End') { Ch.end(); }
        else if (I.chatPage(e.code)) { /* PageUp / PageDown scrolled the history */ }
        else if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey) { Ch.type(e.key); }
        else if (e.key === 'v' && (e.ctrlKey || e.metaKey)) { /* the paste event carries the text */ }
        if (e.code !== 'F5' && e.code !== 'F12') e.preventDefault();
        fire('chatRedraw');
        return;
      }
      // ⚠ PLAN G11b — THE CREATIVE SEARCH BOX SWALLOWS THE KEYBOARD THE SAME WAY, for the same
      // reason as the chat field above: a focused text field means `e` types an `e`. It is a
      // SECOND branch rather than a widened first one because only two keys get out of this one
      // — Escape closes the screen and E is not one of them — and because the box is only
      // focused on the search tab, so the other eleven tabs keep their keys.
      var Cr = NS.Creative, Hd = NS.Hud;
      if (Cr && Hd && Hd.screen === 'creative' && Cr.searching) {
        I.keys = Object.create(null);
        if (e.code === 'Escape') { fire('pause'); e.preventDefault(); return; }
        // vanilla keyPressed on the search tab: a digit over a slot is the hotbar swap, not text
        var dg = /^Digit([1-9])$/.exec(e.code);
        if (dg && Hd.creativeHotbarKey && Hd.creativeHotbarKey(+dg[1] - 1)) { e.preventDefault(); fire('uiredraw'); return; }
        if (Cr.key(e.code, e.key)) { e.preventDefault(); fire('uiredraw'); return; }
      }
      // G22d — THE ANVIL'S NAME FIELD TAKES TYPING while an input is present (E must type an `e`).
      if (Hd && Hd.screen === 'anvil' && Hd.anvilKey && Hd.anvilKey(e.code, e.key)) {
        I.keys = Object.create(null); e.preventDefault(); fire('uiredraw'); return;
      }
      if (Hd && Hd.screen === 'book' && Hd.bookKey && Hd.bookKey(e.code, e.key)) {
        I.keys = Object.create(null); e.preventDefault(); fire('uiredraw'); return;
      }
      if (Hd && Hd.screen === 'command' && Hd.commandKey && Hd.commandKey(e.code, e.key)) {
        I.keys = Object.create(null); e.preventDefault(); fire('uiredraw'); return;
      }
      // vanilla `keyPressed`: the chat key on any other creative tab jumps to the search tab
      if (Cr && Hd && Hd.screen === 'creative' && !Cr.searching && e.code === 'KeyT') {
        Cr.setTab(Cr.SEARCH_COL); e.preventDefault(); fire('uiredraw'); return;
      }
      // ⚠ PLAN G11c — THE OPTIONS SCREEN TAKES THE KEYBOARD WHILE IT IS OPEN (D-353). Tab walks
      // its widgets, Enter and Space press the focused one, and the arrows step a focused slider.
      // ⚠ A THIRD BRANCH, not a widened one: unlike the chat field and the search box this screen
      // swallows only the four keys it uses, so every other key still reaches the game — and
      // ESCAPE is deliberately not among them, because `15_hud.js` owns the screen stack and two
      // handlers for one key is two answers (D-314).
      // ⚠ AND IT IS BEFORE THE `e.repeat` GUARD, because holding an arrow to run a slider along
      // is exactly what a keyboard user does, and vanilla's `keyPressed` fires on every repeat.
      var Op = NS.Options;
      if (Op && Op.screen && Op.key && Op.key(e.code, !!e.shiftKey)) {
        e.preventDefault();
        fire('uiredraw');
        return;
      }
      if (e.repeat) { if (SWALLOW[e.code]) e.preventDefault(); return; }
      I.keys[e.code] = true;
      I.edge[e.code] = true;
      I.togglePress(e.code);

      // double-tap W = sprint, double-tap Space = toggle creative flight
      var t = NS.U.now();
      if (e.code === I.codeOf('key.forward')) {
        if (t - I._lastW < 300) I.sprintLatch = true;
        I._lastW = t;
      } else if (e.code === I.codeOf('key.jump')) {
        if (t - (I._lastSpace || -1e9) < 300) fire('fly');
        I._lastSpace = t;
      }

      // ⚠ RECORDED ON THE EVENT, not polled later: by the time an action handler runs the
      // modifier state is whatever the OS last told us, and Ctrl+Q must mean the whole stack.
      I.ctrl = !!(e.ctrlKey || e.metaKey);
      I.shift = !!e.shiftKey;
      if (e.code === 'F3') { if (!e.repeat) { I.f3Held = true; I.f3Used = false; } e.preventDefault(); return; }
      if (I.processF3(e.code)) { e.preventDefault(); return; }
      var act = I.actionFor(e.code);
      if (e.code === 'KeyI' && I.keys.F3) { fire('copyLookAt'); e.preventDefault(); return; }   // F3+I
      if (act && e.code !== 'F3') fire(act);

      if (SWALLOW[e.code]) e.preventDefault();
      else if (I.locked && e.code.charAt(0) !== 'F') e.preventDefault();
    }, { passive: false });

    window.addEventListener('keyup', function (e) {
      I.keys[e.code] = false;
      if (e.code === 'F3' && I.f3Release()) fire('debug');
      if (e.code === I.codeOf('key.forward')) I.sprintLatch = false;
      if (e.code === 'F3') fire('gmSwitcherRelease');
    });

    // Losing focus with keys held is the classic "why am I still walking" bug.
    window.addEventListener('blur', function () {
      I.keys = Object.create(null);
      I.mouse[0] = I.mouse[1] = I.mouse[2] = false;
      I.sprintLatch = false;
    });

    // Mouse listeners live on WINDOW, not on the canvas. The canvas is replaced wholesale when
    // the renderer backend is swapped at runtime (F9) — a canvas that has handed out one context
    // type can never hand out another — and listeners bound to the old element would die with it.
    // ⚠⚠ **THE BUTTON STATE IS RECORDED BEFORE ANYTHING ELSE, AND THAT IS THE WHOLE SLIDER BUG**
    // (D-330). Dan, session 11: *"sliders dont work as sliders"*. `mousedown` fired `uiclick` and
    // RETURNED — three lines above `I.mouse[e.button] = true` — so while a screen was open the
    // button was never recorded as down. `mousemove`'s drag gate is `if (I.uiOpen && I.mouse[0])`,
    // and `I.mouse[0]` was the one thing that could never be true there, so **`uidrag` was never
    // fired once in the life of the program**. A slider set its value on the press and then
    // ignored the pointer: a stepper wearing a slider's art.
    //
    // ⚠ **BOTH HALVES OF THE GATE WERE WRITTEN, IN TWO FILES, AND NOTHING EXERCISED THE PAIR.**
    // `Options.dragging`, `O.drag`, `O.release`, the `uidrag`/`uirelease` events and their routing
    // in `17_main.js` are all correct and all complete. `optionscheck` drives `O.drag` directly, so
    // it was green; the browser stage never dragged. **A gate whose two sides live in different
    // files is a gate nothing is testing unless something drives it end to end.**
    window.addEventListener('mousedown', function (e) {
      I.mx = e.clientX; I.my = e.clientY;
      // ⚠ RECORDED IN THE UI BRANCH, NOT MOVED ABOVE ALL THREE. Hoisting it to the top of the
      // handler also records the click that merely RECAPTURES the pointer, and that click is
      // swallowed on purpose — it would otherwise start mining the block under the crosshair the
      // instant the window is clicked back into focus. The lock-request branch still swallows it.
      if (I.uiOpen) { I.mouse[e.button] = true; fire('uiclick', e.button); e.preventDefault(); return; }
      if (!I.locked) { I.requestLock(); e.preventDefault(); return; }
      // #2091 no-lock look: middle button, and the right button, DRAG to look. A right press that
      // never moves is still a place click (delivered on release); left stays break/attack.
      if (I.noLock && e.button !== 0) {
        I.dragBtn = e.button; I.dragMoved = (e.button === 1); I.dragX = e.clientX; I.dragY = e.clientY;
        e.preventDefault(); return;
      }
      I.mouse[e.button] = true;
      I.mousePressed[e.button] = true;
      e.preventDefault();
    });

    window.addEventListener('mouseup', function (e) {
      I.mouse[e.button] = false;
      if (I.noLock && I.dragBtn === e.button) {
        if (e.button === 2 && !I.dragMoved && !I.uiOpen) { I.mouse[2] = true; I.mousePressed[2] = true; I.mouseRelease2 = true; }
        I.dragBtn = -1;
      }
      // G11c: a held slider is released here, wherever the pointer ended up.
      if (I.uiOpen) fire('uirelease', e.button);
    });
    window.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    window.addEventListener('wheel', function (e) {
      if (NS.Chat && NS.Chat.open) { I.chatWheel(e.deltaY, e.shiftKey); fire('chatRedraw'); e.preventDefault(); return; }
      if (I.uiOpen && NS.Options && NS.Options.screen === 'keybinds' && NS.KeyBinds) { NS.KeyBinds.scrollBy(e.deltaY > 0 ? 20 : -20, NS.Options.lastGH); fire('uiredraw'); e.preventDefault(); return; }
      if (I.uiOpen) { fire('uiscroll', e.deltaY); e.preventDefault(); return; }
      I.wheel += (e.deltaY > 0 ? 1 : (e.deltaY < 0 ? -1 : 0));
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerlockchange', function () {
      var was = I.locked;
      if (I.noLock) return;   // #2091: the fake lock is not the browser's to take away
      I.locked = (document.pointerLockElement === I.el);
      if (!I.locked) {
        I.mouse[0] = I.mouse[1] = I.mouse[2] = false;
        if (was) fire('unlock');
      } else fire('lock');
    });
    document.addEventListener('pointerlockerror', function () { I.setNoLock(true); fire('lockerror'); });
    if (/[?&]nolock\b/.test(String(window.location && window.location.search))) I.setNoLock(true);

    window.addEventListener('mousemove', function (e) {
      if (I.noLock && I.dragBtn > 0 && !I.uiOpen) {
        if (!I.dragMoved && Math.abs(e.clientX - I.dragX) + Math.abs(e.clientY - I.dragY) > 3) I.dragMoved = true;
        if (I.dragMoved) { I.dx += e.movementX || 0; I.dy += e.movementY || 0; }
        return;
      }
      if (I.locked) { I.dx += e.movementX || 0; I.dy += e.movementY || 0; }
      else {
        I.mx = e.clientX; I.my = e.clientY;
        // G11c: while a UI screen is open and the button is down, this is a DRAG — which is what
        // a slider needs and a click alone cannot give it.
        if (I.uiOpen && I.mouse[0]) fire('uidrag', 0);
        else if (I.uiOpen && I.mouse[2]) fire('uidrag', 2);   // #366: a right-drag distributes one each
      }
    });

    return I;
  };

  /**
   * requestPointerLock returns a PROMISE in current Chrome, and it rejects (rather than throws)
   * when there is no user gesture — closing a menu with Esc can land in exactly that case
   * because Chromium also enforces a ~1.25 s cooldown after a user-initiated unlock. An
   * uncaught rejection there would be the only unhandled error in the whole game.
   */
  I.requestLock = function () {
    if (I.noLock && !I.locked && !I.uiOpen) { I.locked = true; fire('lock'); return; }
    if (!I.el || I.locked || I.uiOpen || !I.el.requestPointerLock) return;
    try {
      var p = I.el.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(function () { I.setNoLock(true); fire('lockerror'); });
      // a lock that never arrives (VM / RDP) within ~2 s of the click turns no-lock mode on
      setTimeout(function () { if (!I.locked && !I.noLock && !I.uiOpen) { I.setNoLock(true); } }, 2000);
    } catch (e) { I.setNoLock(true); fire('lockerror'); }
  };

  /**
   * #2091 no-lock mode. While on, `locked` means "the game has the input" without a browser lock,
   * so nothing pauses on unlock (the 'unlock' action only ever fires from a real pointerlockchange).
   * Look: hold right or middle mouse and drag, or arrows / IJKL at LOOK_RATE rad/s (applyLook).
   * Break/place stay on left/right CLICK, but a right press that turns into a drag is look only.
   */
  I.LOOK_RATE = 2.2;
  I.dragBtn = -1;
  I.setNoLock = function (on) {
    on = !!on;
    if (I.noLock === on) return;
    I.noLock = on; I.dragBtn = -1;
    if (on) {
      if (!I.uiOpen) { I.locked = true; fire('lock'); }
    } else if (document.pointerLockElement !== I.el && I.locked) {
      I.locked = false; I.mouse[0] = I.mouse[1] = I.mouse[2] = false; fire('unlock');
    }
  };

  I.releaseLock = function () {
    try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
  };

  // vanilla ChatScreen.keyPressed 266/267: ChatHud.scroll(±(getVisibleLineCount() - 1))
  I.chatPage = function (code) {
    if (code !== 'PageUp' && code !== 'PageDown') return false;
    NS.Chat.scrollBy((code === 'PageUp' ? 1 : -1) * (NS.Chat.LINES_OPEN - 1));
    return true;
  };
  // vanilla ChatScreen.mouseScrolled: delta clamped to ±1, ×7 unless Shift is held; wheel up = older
  I.chatWheel = function (deltaY, shift) {
    var d = deltaY < 0 ? 1 : (deltaY > 0 ? -1 : 0);
    NS.Chat.scrollBy(shift ? d : d * 7);
  };
  /** press edge of a key: flips the latched sneak / sprint when that binding is in TOGGLE mode. */
  // the right-hand Shift / Control stay aliases only while the binding is the default left one
  I.isSneakKey = function (code) { return code === I.codeOf('key.sneak') || (code === 'ShiftRight' && I.isDefaultBinding('key.sneak')); };
  I.isSprintKey = function (code) { return code === I.codeOf('key.sprint') || (code === 'ControlRight' && I.isDefaultBinding('key.sprint')); };
  I.togglePress = function (code) {
    if (I.toggleSneak && I.isSneakKey(code)) I.sneakToggled = !I.sneakToggled;
    if (I.toggleSprint && I.isSprintKey(code)) I.sprintToggled = !I.sprintToggled;
  };
  /** the sneak binding's pressed state: held in HOLD, latched in TOGGLE. */
  I.sneakOn = function () {
    return I.toggleSneak ? I.sneakToggled : I.bdown('key.sneak') || (I.down('ShiftRight') && I.isDefaultBinding('key.sneak'));
  };
  /** sprint binding; a toggled sprint ends when the player stops moving forward (fwd == 0). */
  I.sprintOn = function (fwd) {
    if (I.toggleSprint) { if (!fwd) I.sprintToggled = false; return I.sprintToggled || I.sprintLatch; }
    return I.bdown('key.sprint') || (I.down('ControlRight') && I.isDefaultBinding('key.sprint')) || I.sprintLatch;
  };
  /** opening a screen un-latches the toggles (KeyBinding.unpressAll). */
  I.clearToggles = function () { I.sneakToggled = I.sprintToggled = false; };
  I.down = function (code) { return !!I.keys[code]; };
  I.pressed = function (code) { return !!I.edge[code]; };

  /**
   * Apply the frame's accumulated mouse movement to the player's look angles, and hand back the
   * wheel notches. Look runs at FRAME rate, not tick rate: turning is the one thing a 20 Hz tick
   * would make feel broken (D-79).
   */
  I.applyLook = function (player) {
    if (I.locked && !I.uiOpen && (I.dx || I.dy)) {
      player.yaw += I.dx * I.sensitivity;
      player.pitch -= (I.invertY ? -I.dy : I.dy) * I.sensitivity;
      var lim = NS.Cam.PITCH_LIMIT;
      if (player.pitch > lim) player.pitch = lim;
      else if (player.pitch < -lim) player.pitch = -lim;
      // keep yaw in (-pi, pi] so the debug readout and the save file stay tidy
      var TAU = Math.PI * 2;
      if (player.yaw > Math.PI || player.yaw < -Math.PI) {
        player.yaw -= Math.floor((player.yaw + Math.PI) / TAU) * TAU;
      }
    }
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var dt = Math.min(0.1, Math.max(0, (now - (I._lookT || now)) / 1000));
    I._lookT = now;
    if (I.noLock && I.locked && !I.uiOpen) {
      var ky = (I.down('ArrowRight') || I.down('KeyL') ? 1 : 0) - (I.down('ArrowLeft') || I.down('KeyJ') ? 1 : 0);
      var kp = (I.down('ArrowDown') || I.down('KeyK') ? 1 : 0) - (I.down('ArrowUp') || I.down('KeyI') ? 1 : 0);
      if (ky || kp) {
        player.yaw += ky * I.LOOK_RATE * dt;
        player.pitch -= (I.invertY ? -kp : kp) * I.LOOK_RATE * dt;
        var lim2 = NS.Cam.PITCH_LIMIT;
        player.pitch = Math.max(-lim2, Math.min(lim2, player.pitch));
        var T2 = Math.PI * 2;
        if (player.yaw > Math.PI || player.yaw < -Math.PI) player.yaw -= Math.floor((player.yaw + Math.PI) / T2) * T2;
      }
    }
    I.dx = 0; I.dy = 0;
    var w = I.wheel; I.wheel = 0;
    return w;
  };

  /** Backwards-compatible raw delta read. Kept because ARCH §10 names it in the loop order. */
  I.sample = function () {
    var o = { dx: I.dx * I.sensitivity, dy: I.dy * I.sensitivity };
    I.dx = 0; I.dy = 0;
    return o;
  };

  /** Clear one frame's worth of edge state. Must be the LAST thing the frame does. */
  I.endFrame = function () {
    I.edge = Object.create(null);
    I.mousePressed[0] = I.mousePressed[1] = I.mousePressed[2] = false;
    if (I.mouseRelease2) { I.mouseRelease2 = false; I.mouse[2] = false; }   // #2091 the click-sized right press
  };
})(MCL);
