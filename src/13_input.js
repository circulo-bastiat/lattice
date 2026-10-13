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
    F3:       'debug',
    F9:       'backend',
    KeyV:     'perspective',   // vanilla's F5; the browser owns F5 (reload), so V
    F2:       'save',
    F10:      'bench',
    KeyN:     'noclip',
    KeyC:     'creative',
    KeyR:     'respawn',
    KeyQ:     'drop',
    KeyT:     'chat',
    Slash:    'chatCommand'
  };
  for (var d = 1; d <= 9; d++) KEYMAP['Digit' + d] = 'slot' + (d - 1);
  for (d = 1; d <= 9; d++) KEYMAP['Numpad' + d] = 'slot' + (d - 1);
  I.KEYMAP = KEYMAP;

  /** Keys we swallow so the browser does not act on them (F3 = find, F9 = nothing, but be safe). */
  var SWALLOW = { F2: 1, F3: 1, F9: 1, F10: 1, Tab: 1 };

  function fire(name, arg) { if (I.onAction) I.onAction(name, arg); }

  I.attach = function (el) {
    if (I.attached) return I;
    I.attached = true;
    I.el = el;

    window.addEventListener('keydown', function (e) {
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

      // double-tap W = sprint, double-tap Space = toggle creative flight
      var t = NS.U.now();
      if (e.code === 'KeyW') {
        if (t - I._lastW < 300) I.sprintLatch = true;
        I._lastW = t;
      } else if (e.code === 'Space') {
        if (t - (I._lastSpace || -1e9) < 300) fire('fly');
        I._lastSpace = t;
      }

      // ⚠ RECORDED ON THE EVENT, not polled later: by the time an action handler runs the
      // modifier state is whatever the OS last told us, and Ctrl+Q must mean the whole stack.
      I.ctrl = !!(e.ctrlKey || e.metaKey);
      I.shift = !!e.shiftKey;
      var act = KEYMAP[e.code];
      if (act) fire(act);

      if (SWALLOW[e.code]) e.preventDefault();
      else if (I.locked && e.code.charAt(0) !== 'F') e.preventDefault();
    }, { passive: false });

    window.addEventListener('keyup', function (e) {
      I.keys[e.code] = false;
      if (e.code === 'KeyW') I.sprintLatch = false;
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
      I.mouse[e.button] = true;
      I.mousePressed[e.button] = true;
      e.preventDefault();
    });

    window.addEventListener('mouseup', function (e) {
      I.mouse[e.button] = false;
      // G11c: a held slider is released here, wherever the pointer ended up.
      if (I.uiOpen) fire('uirelease', e.button);
    });
    window.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    window.addEventListener('wheel', function (e) {
      if (NS.Chat && NS.Chat.open) { I.chatWheel(e.deltaY, e.shiftKey); fire('chatRedraw'); e.preventDefault(); return; }
      if (I.uiOpen) { fire('uiscroll', e.deltaY); e.preventDefault(); return; }
      I.wheel += (e.deltaY > 0 ? 1 : (e.deltaY < 0 ? -1 : 0));
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerlockchange', function () {
      var was = I.locked;
      I.locked = (document.pointerLockElement === I.el);
      if (!I.locked) {
        I.mouse[0] = I.mouse[1] = I.mouse[2] = false;
        if (was) fire('unlock');
      } else fire('lock');
    });
    document.addEventListener('pointerlockerror', function () { fire('lockerror'); });

    window.addEventListener('mousemove', function (e) {
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
    if (!I.el || I.locked || I.uiOpen || !I.el.requestPointerLock) return;
    try {
      var p = I.el.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(function () { fire('lockerror'); });
    } catch (e) { fire('lockerror'); }
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
  };
})(MCL);
