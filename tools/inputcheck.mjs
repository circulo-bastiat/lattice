#!/usr/bin/env node
// inputcheck.mjs — THE GAME, DRIVEN FROM THE OUTSIDE EDGE (D-339).
//
//   MCLITE_PRESET=medium node tools/inputcheck.mjs [dist/mclite.html]
//
// ⚠⚠ WHY THIS EXISTS, AND IT IS THE LARGEST THING SESSION 11 LEARNED. Four of the seven faults
// Dan reported that night were a **complete, correct model with no input edge**, and every check
// over them was green:
//
//   · `Options.drag` was perfect and `uidrag` had never fired once, because `mousedown` returned
//     before it recorded the button (D-330). `optionscheck` called `O.drag` itself.
//   · `Hand.swing` was perfect and its only callers were "a block broke" and "a block was
//     placed", so a punch at the sky did nothing (D-334). `handcheck` calls `H.swing()` itself.
//   · The candle stacking rule was implemented twice and unreachable, because no candle item
//     could produce a candle state (D-331). `placecheck` drives it with raw block states.
//   · `Hand.attackSpeedTable` was null for fourteen sessions (D-271, D-335).
//
// ⚠ **THE RULE: A CHECK THAT CALLS THE FUNCTION UNDER TEST HAS NOT TESTED THE THING THAT IS
// SUPPOSED TO CALL IT.** Every other check in this project enters the system at a model. This one
// enters it at a `MouseEvent` and a `KeyboardEvent` on `window`, and asserts what the PLAYER would
// see. It is the only check that can fail when the wiring is missing and the model is fine.
//
// ⚠ ONE THING IS REACHED INTO AND IT IS NAMED: `Input.locked`. Pointer lock cannot be granted to a
// headless browser without a real user gesture, and `mousedown` refuses to record a press while
// unlocked *by design* (it requests the lock instead). Everything else — the events, the handlers,
// the actions, the model — is the shipped path.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, sleep } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv[2] || join(ROOT, 'dist', 'mclite.html');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const s = await open(FILE, { width: 1024, height: 640 });
if (!s) {
  console.log('inputcheck: SKIP — no Chromium on this machine (cdp.mjs found none)');
  process.exit(0);
}
const ev = (src) => s.evaluate(new Function(src));

try {
  await sleep(2000);
  await s.evaluate(() => { MCL.Main.play(1337); return 1; });
  const up = await s.waitFor(() => (MCL.Hud && MCL.Hud.mode === 'game'
    && MCL.Player && MCL.Gfx && MCL.Gfx.cam) ? 1 : 0, 90000);
  if (!ok(!!up, 'the world came up')) throw new Error('no world');
  await sleep(6000);

  // ── the event helpers, in the page ───────────────────────────────────────────────────────
  // ⚠ THEY DISPATCH ON `window`, WHICH IS WHERE `Input.attach` BINDS. Calling the handler
  // directly would test the handler and not the binding, which is the whole point of this file.
  await s.send('Runtime.evaluate', { expression: `
    window.__in = {
      mouse: function (type, x, y, button) {
        window.dispatchEvent(new MouseEvent(type, {
          clientX: x, clientY: y, button: button || 0, bubbles: true, cancelable: true
        }));
      },
      key: function (type, code, mods) {
        mods = mods || {};
        window.dispatchEvent(new KeyboardEvent(type, {
          code: code, key: code, bubbles: true, cancelable: true,
          ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift
        }));
      },
      // ⚠⚠ A FLAT, KNOWN PLATFORM. Sections that place and break must not depend on whatever
      // terrain the player happened to spawn on: a stone floor drops nothing to a bare hand, a
      // slope changes which face the ray hits, and a cell the player is standing in refuses a
      // placement. This builds five by five of dirt under a known spot and stands the player on
      // it, so every later assertion is about the code and not about the world.
      stage: function (block) {
        var W = MCL.World, S = MCL.States, P = MCL.Player;
        var cx = Math.floor(P.x), cz = Math.floor(P.z), cy = Math.floor(P.y);
        var id = S.stateOf(block || 'dirt');
        // ⚠ EIGHT BLOCKS OF HEADROOM, NOT FOUR. §2 aims STRAIGHT UP and the reach is five, so a
        // ceiling four cells up is a target — and "looking straight up there is nothing to hit"
        // failed on a roof the check had left in place.
        for (var dx = -3; dx <= 3; dx++) for (var dz = -3; dz <= 3; dz++) {
          W.setBlock(cx + dx, cy - 1, cz + dz, id);
          for (var dy = 0; dy < 9; dy++) W.setBlock(cx + dx, cy + dy, cz + dz, 0);
        }
        P.x = cx + 0.5; P.z = cz + 0.5; P.y = cy;
        P.vx = P.vy = P.vz = 0; P.onGround = true;
        // THE RENDER POSITION TOO. P.retarget casts from P.ex/ey/ez -- the INTERPOLATED position
        // the camera uses -- not from P.x/y/z. Teleporting without moving those casts the ray from
        // where the player WAS, which is how "looking straight up there is nothing to hit" kept
        // finding a ceiling that had just been cleared.
        // (no backticks in here: this block lives inside a template literal -- sixth time)
        P.ex = P.x; P.ey = P.y; P.ez = P.z;
        return { x: P.x, y: P.y, z: P.z, cy: cy };
      },
      // one real frame of the game loop, so an action taken by an event is acted on
      frame: function () { MCL.Main.frameOnce ? MCL.Main.frameOnce() : MCL.Hud.draw(); }
    };
    1;`, returnByValue: true });

  // ═══════════ 1. A SLIDER FOLLOWS THE POINTER (D-330) ═══════════════════════════════════
  console.log('\n1. a slider follows the pointer');
  {
    const setup = await ev(`
      var H = MCL.Hud, O = MCL.Options, I = MCL.Input;
      // ⚠ THE SCREEN IS OPENED BY A REAL Escape KEY, so \`I.uiOpen\` is set by the shipped action
      // handler rather than by this file. Which SCREEN of the tree is then shown is navigation,
      // not the thing under test, so it is set directly and said so.
      window.__in.key('keydown', 'Escape');
      // ⚠ THE SOUND SCREEN, NOT THE VIDEO ONE. Render distance CLAMPS to the preset's maximum, so
      // dragging its slider to the far right lands at 24 of 32 and reads 0.733 — the drag was
      // perfect and the assertion was measuring a clamp. A volume has no cap but its own ends.
      O.screen = 'sound';
      H.draw();
      // find the FOV or render-distance slider's hit rect, as the screen itself built it
      var row = null;
      for (var i = 0; i < O.hit.length; i++) if (O.hit[i].row && O.hit[i].row.t === 'slide') { row = O.hit[i]; break; }
      return row ? { x: row.x, y: row.y, w: row.w, h: row.h, uiOpen: I.uiOpen,
                     label: row.label, frac: row.row.frac() } : null;`);
    ok(!!setup, 'the options screen offered a slider to drag');
    if (setup) {
      ok(setup.uiOpen === true, 'and the input layer knows a screen is open');
      const midY = Math.round(setup.y + setup.h / 2);
      const left = Math.round(setup.x + 6), right = Math.round(setup.x + setup.w - 6);

      // press at the LEFT end
      const pressed = await ev(`
        window.__in.mouse('mousedown', ${left}, ${midY}, 0);
        var O = MCL.Options, I = MCL.Input;
        return { frac: O.hit.length ? null : null, dragging: !!O.dragging, mouse0: I.mouse[0],
                 value: (function(){ for (var i=0;i<O.hit.length;i++) if (O.hit[i].row===O.dragging) return O.hit[i].row.frac(); return -1; })() };`);
      ok(pressed.dragging === true, 'pressing on a slider starts a drag');
      // ⚠ THIS IS THE ASSERTION THAT WOULD HAVE CAUGHT D-330. The whole fault was that the
      // button was never recorded, so the drag gate could never open.
      ok(pressed.mouse0 === true,
         'and `mousedown` RECORDED the button while a screen is open — without this the drag ' +
         'gate `uiOpen && mouse[0]` can never open and no slider can ever move');
      const atLeft = pressed.value;

      // now MOVE, without releasing
      // ⚠⚠ THE POINTER IS MOVED TWICE, AND THAT IS THE WHOLE VALUE OF THIS SECTION. One move
      // passes even when the row set is rebuilt between moves; the SECOND finds no matching row
      // and does nothing, which is D-340 — a slider that moves once and then sticks.
      const moved = await ev(`
        window.__in.mouse('mousemove', ${Math.round((left + right) / 2)}, ${midY}, 0);
        window.__in.mouse('mousemove', ${right}, ${midY}, 0);
        var O = MCL.Options;
        return { value: (function(){ for (var i=0;i<O.hit.length;i++) if (O.hit[i].row===O.dragging) return O.hit[i].row.frac(); return -1; })(),
                 dragging: !!O.dragging, hits: O.hit.length };`);
      console.log(`   slider: pressed at the left -> ${atLeft.toFixed(3)}, dragged to the right -> ${moved.value.toFixed(3)}`);
      ok(moved.value > atLeft + 0.5,
         `dragging to the far end MOVED the value (${atLeft.toFixed(3)} -> ${moved.value.toFixed(3)}) — ` +
         'a slider that only acts on the press would still read what it did at the left end');
      // ⚠ "IT CANNOT GO FURTHER", NOT "IT REACHED ONE". A setting may clamp below its slider's
      // end — render distance does — and the question here is whether the DRAG ran out of track.
      const past = await ev(`
        window.__in.mouse('mousemove', ${right + 40}, ${midY}, 0);
        var O = MCL.Options;
        return (function(){ for (var i=0;i<O.hit.length;i++) if (O.hit[i].row===O.dragging) return O.hit[i].row.frac(); return -1; })();`);
      ok(Math.abs(past - moved.value) < 1e-6,
         `dragging past the right-hand end changes nothing more (${moved.value.toFixed(3)} -> ${past.toFixed(3)})`);
      ok(moved.value > 0.9, `and it reached the end of the track (${moved.value.toFixed(3)})`);

      // release, and a later move must NOT keep changing it
      const after = await ev(`
        window.__in.mouse('mouseup', ${right}, ${midY}, 0);
        window.__in.mouse('mousemove', ${left}, ${midY}, 0);
        var O = MCL.Options;
        var v = -1;
        for (var i=0;i<O.hit.length;i++) if (O.hit[i].row && O.hit[i].row.t==='slide') { v = O.hit[i].row.frac(); break; }
        return { dragging: !!O.dragging, value: v };`);
      ok(after.dragging === false, 'releasing ends the drag');
      ok(Math.abs(after.value - moved.value) < 1e-6,
         `and moving the pointer afterwards does not move the slider (${after.value.toFixed(3)})`);
      okAv(Math.abs(moved.value - atLeft) > 0.5,
           'anti-vacuity: the two ends of the track really are different values, so §1 measured a move');
    }
    await ev(`MCL.Options.screen = null; MCL.Hud.close(); MCL.Input.uiOpen = false; return 1;`);
  }

  // ═══════════ 2. A CLICK SWINGS THE HAND, HIT OR MISS (D-334) ═══════════════════════════
  console.log('\n2. a click swings the hand');
  {
    // ⚠⚠ THE SWING IS COUNTED, NOT WATCHED. A swing is six ticks and this browser draws about
    // four frames a second with the loop catching up twenty ticks a frame, so by the time this
    // file can look, a correct swing is already over. Waiting for a momentary state here is
    // D-321's mistake; the counter is the state that survives.
    const before = await ev(`
      var P = MCL.Player, I = MCL.Input, H = MCL.Hand, G = MCL.Gamemode;
      MCL.Hud.close(); I.uiOpen = false;
      // ⚠ THE ONE THING REACHED INTO: a headless browser cannot be granted pointer lock.
      I.locked = true;
      G.set(P, G.CREATIVE);
      window.__in.stage('dirt');
      // ⚠⚠ POSITIVE PITCH IS UP IN THIS ENGINE. The ray is (sin(yaw)cos(pitch), SIN(PITCH),
      // -cos(yaw)cos(pitch)), so -PI/2 points at the FLOOR — which is what every other check in
      // the project uses it for. Aiming "at the sky" with a negative pitch aimed at the ground,
      // the swing counter went up anyway because MINING swings too, and the section passed its
      // real assertion while its precondition told the truth: there was something to hit.
      P.pitch = Math.PI / 2 - 0.02;           // straight up: nothing to hit
      P.retarget();
      // WARNING: 'P.missTime = 0' USED TO BE HERE AND IT IS WHY THIS SECTION SHIPPED GREEN OVER
      // A GAME NOBODY COULD PUNCH IN (D-357). The field was declared nowhere, 'undefined <= 0'
      // is false, and act's click gate — and the whole mining branch — was false for ever.
      // This file set the state the game never set, so the one check written to enter at the
      // real edge still tested a player the real edge could never produce. A CHECK THAT REPAIRS
      // THE OBJECT UNDER TEST HAS STOPPED TESTING IT. The value is now asserted, not assigned.
      return { swings: H.swings, hasTarget: P.hasTarget,
               missType: typeof P.missTime, miss: P.missTime };`);
    ok(before.missType === 'number',
       `a FRESH player's missTime is a number (${before.missType}) — undefined here is D-357`);
    ok(before.miss <= 0, 'and it starts at zero, so the very first click is allowed through');
    ok(before.hasTarget === false, 'looking straight up there is nothing to hit');
    await ev(`window.__in.mouse('mousedown', 512, 320, 0); return 1;`);
    await sleep(1200);                                   // several real frames of the real loop
    const r = await ev(`
      var H = MCL.Hand, P = MCL.Player;
      window.__in.mouse('mouseup', 512, 320, 0);
      return { swings: H.swings, miss: P.missTime };`);
    console.log(`   swings: ${before.swings} -> ${r.swings} after a real mousedown at the sky`);
    ok(r.swings > before.swings,
       'clicking at NOTHING swings the hand — which is the whole of Dan\'s "no mid air punching"');

    // ⚠ AND IT SWINGS ON A HIT BEFORE THE BLOCK BREAKS. In survival, one frame of holding the
    // button on stone breaks nothing — and used to swing nothing.
    const hitBefore = await ev(`
      var P = MCL.Player, H = MCL.Hand, G = MCL.Gamemode;
      G.set(P, G.SURVIVAL);
      P.pitch = -Math.PI / 2 + 0.45;          // down at the floor
      P.retarget();
      P.breakProgress = 0;                    // ⚠ NOT missTime — see D-357 above
      return { swings: H.swings, had: P.hasTarget, id: P.tid, miss: P.missTime };`);
    ok(hitBefore.had === true, 'looking down there IS a block');
    await ev(`window.__in.mouse('mousedown', 512, 320, 0); return 1;`);
    await sleep(400);
    const hit = await ev(`
      var P = MCL.Player, H = MCL.Hand;
      var n = H.swings;
      window.__in.mouse('mouseup', 512, 320, 0);
      return { swings: n, progress: P.breakProgress };`);
    ok(hit.swings > hitBefore.swings,
       `clicking a block swings the hand (${hitBefore.swings} -> ${hit.swings})`);
    // ⚠⚠ **AND THE BLOCK IS ACTUALLY BEING BROKEN, WHICH IS THE HALF THAT WAS DEAD (D-357).**
    // The swing counter alone cannot see it: `act` swings on the CLICK and again once per tick
    // of real progress, so a gate that kills mining outright still leaves the click swing. This
    // asserts the thing a player would see — the crack advancing — and on the shipped build of
    // sessions 11 and 12 it measured 0 after two and a half seconds of holding the button.
    ok(hit.progress > 0,
       `holding the button on a block makes real break progress (${hit.progress.toFixed(3)} after 400 ms)`);
    okAv(r.swings > before.swings && hit.swings > r.swings,
         'anti-vacuity: the counter moved for BOTH the miss and the hit, so §2 is counting swings');
    okAv(before.missType === 'number' && hitBefore.miss <= 0,
         'anti-vacuity: the miss gate is a real number at both sample points, so §2 measured the real gate');
  }

  // ═══════════ 2b. THE HAND IS DRAWN, AND A SWING RASTERISES NOTHING (D-359) ═════════════
  // ⚠⚠ **THIS IS THE PLACE-FPS AUDIT'S PERMANENT GUARD.** Dan, 15 Sept 2026: *"placing is still
  // low fps."* The cause was not placement: every placement SWINGS the hand, and every frame of
  // a swing re-rasterised the player's arm in software — **5.1 ms a frame measured at 1920x993
  // on the two-core box, 7.7 ms at 1080p when D-328 measured it on a faster one.** At 60 Hz a
  // six-tick swing is eighteen frames of that, which is exactly what "placing is low fps" feels
  // like from inside the game.
  //
  // ⚠ **THE ASSERTION IS STRUCTURAL, NOT A THRESHOLD** (D-291's rule). A frame-time budget in a
  // headless software renderer is noise; "the software rasteriser was not entered at all" is a
  // counter, and a counter that moves is a regression no matter what the machine is. The budget
  // on the build cost is a second, generous belt.
  console.log('\n2b. the hand is 3D geometry, and a swing rasterises nothing');
  {
    const before = await ev(`
      var BI = MCL.BlockIcon, P = MCL.Player, IT = MCL.Items, Iv = MCL.Inventory, G = MCL.Gamemode;
      G.set(P, G.CREATIVE);
      Iv.setItem(P.inventory, 0, { i: IT.of('stone'), n: 64 }); P.slot = 0; P.syncHotbar();
      return { rasters: BI.armRasters | 0, quads: MCL.Gfx.handQuads | 0 };`);
    await sleep(700);
    const drawn = await ev(`return { quads: MCL.Gfx.handQuads | 0, err: MCL.Gfx.handError || null };`);
    ok(drawn.quads > 0, `the hand is drawn as real geometry (${drawn.quads} quads)`);
    ok(!drawn.err, `and the hand pass reported no error (${drawn.err})`);

    await ev(`window.__in.mouse('mousedown', 512, 320, 0); return 1;`);
    await sleep(900);
    await ev(`window.__in.mouse('mouseup', 512, 320, 0); return 1;`);
    const after = await ev(`
      return { rasters: MCL.BlockIcon.armRasters | 0, swings: MCL.Hand.swings,
               quads: MCL.Gfx.handQuads | 0 };`);
    ok(after.swings > 0, 'the click swung the hand');
    ok(after.rasters === before.rasters,
       `a whole swing rasterised NOTHING in software (${before.rasters} -> ${after.rasters}) — `
       + 'this counter moving again is D-328 coming back');

    // ...and the per-frame cost of building the hand, measured in the page, under a budget that
    // a two-core software-rendering box can still meet.
    const cost = await ev(`
      var H3 = MCL.Hand3D, P = MCL.Player, a = [];
      for (var i = 0; i < 40; i++) { var t = performance.now(); H3.build(P, i / 40); a.push(performance.now() - t); }
      a.sort(function (x, y) { return x - y; });
      return { med: a[a.length >> 1], max: a[a.length - 1] };`);
    ok(cost.med < 1.0, `building the hand costs ${cost.med.toFixed(3)} ms a frame, budget 1.0`);
    okAv(before.rasters >= 0 && after.quads > 0,
         'anti-vacuity: the counter exists and the hand really was being drawn while it did not move');
  }

  // ═══════════ 3. BREAKING DROPS AN ITEM, AND WALKING OVER IT PICKS IT UP (D-333) ═════════
  console.log('\n3. breaking drops an item, and walking over it picks it up');
  {
    const broke = await ev(`
      var P = MCL.Player, EL = MCL.EntityList, Iv = MCL.Inventory, G = MCL.Gamemode, I = MCL.Input;
      G.set(P, G.SURVIVAL);
      EL.clear();
      // ⚠ DIRT, ON A BUILT PLATFORM. Stone drops NOTHING to a bare hand, which is correct vanilla
      // and would have failed this section for a reason that has nothing to do with item entities.
      window.__in.stage('dirt');
      P.pitch = -Math.PI / 2 + 0.45;
      P.retarget();
      var before = EL.count();
      var name = MCL.Reg.names[MCL.States.block[P.tid]];
      P.breakBlock();
      var items = EL.all().filter(function (e) { return e.type === 'item'; });
      return { before: before, after: EL.count(), items: items.length,
               name: name, count: items.length ? items[0].count : 0,
               delay: items.length ? items[0].pickupDelay : -1 };`);
    ok(broke.before === 0, 'the world starts with no entities');
    ok(broke.items >= 1, `breaking a ${broke.name} dropped ${broke.items} item entity`);
    ok(broke.count >= 1, `and it holds ${broke.count}, not zero or undefined`);
    ok(broke.delay === 10, `with vanilla's ten-tick pickup delay (${broke.delay})`);

    // ⚠ AND THE INVENTORY MUST NOT HAVE IT YET. The whole point of D-333 is that a broken block
    // does not teleport into your pocket.
    const held = await ev(`
      var P = MCL.Player, Iv = MCL.Inventory, EL = MCL.EntityList;
      var e = EL.all().filter(function (x) { return x.type === 'item'; })[0];
      var n = Iv.countOf(P.inventory, MCL.Items.names[e.item]);
      return { n: n, item: MCL.Items.names[e.item] };`);
    ok(held.n === 0, `the ${held.item} is on the FLOOR, not in the inventory (${held.n} held)`);

    // now let the delay run out and stand on it
    const got = await ev(`
      var P = MCL.Player, Iv = MCL.Inventory, EL = MCL.EntityList;
      var e = EL.all().filter(function (x) { return x.type === 'item'; })[0];
      var name = MCL.Items.names[e.item];
      e.pickupDelay = 0;
      P.x = e.x; P.z = e.z; P.y = e.y;       // stand on it
      P.pickupItems();
      return { n: Iv.countOf(P.inventory, name), gone: e.removed, name: name };`);
    ok(got.n >= 1, `standing on it put the ${got.name} in the inventory (${got.n})`);
    ok(got.gone === true, 'and the entity is gone');
    okAv(held.n === 0 && got.n >= 1,
         'anti-vacuity: the inventory was empty of it before and holds it after — §3 measured a pickup');
  }

  // ═══════════ 4. Q THROWS THE HELD ITEM (D-333) ═════════════════════════════════════════
  console.log('\n4. Q throws the held item');
  {
    const r = await ev(`
      var P = MCL.Player, Iv = MCL.Inventory, EL = MCL.EntityList, I = MCL.Input;
      EL.clear();
      MCL.Hud.close(); I.uiOpen = false; I.locked = true;
      // AIM IS SET HERE, DELIBERATELY, AND IT IS THE WHOLE POINT OF THIS SECTION (D-343).
      // This block used to inherit whatever pitch section 3 left behind -- which was aimed DOWN
      // at a block to mine it -- and then assert vy > 0. That passed only because dropHeld had
      // the sign of its look vector inverted: looking down threw the item UP. When the three
      // copies of the look vector were unified and the sign fixed, this assertion failed on
      // correct code, which is exactly what guicheck did with the hotbar selector. A check that
      // does not set the input it depends on is asserting whatever ran before it.
      // (no backticks: inside a template literal)
      P.yaw = 0; P.pitch = 0.9; if (P.interpolate) P.interpolate(1);
      Iv.setItem(P.inventory, P.slot, Iv.stack('cobblestone', 5));
      P.syncHotbar();
      // THE COUNT IS COPIED, NOT REFERENCED. Inv.getItem hands back the LIVE stack object and
      // Inv.removeItem mutates it in place, so reading .n after the keypress reads the value
      // AFTER the throw -- this section reported "holding four" for a stack it had just set to
      // five. (no backticks: inside a template literal)
      var beforeStack = Iv.getItem(P.inventory, P.slot);
      var beforeN = beforeStack ? beforeStack.n : 0;
      var beforeItem = beforeStack && beforeStack.i !== undefined ? MCL.Items.names[beforeStack.i] : null;
      window.__in.key('keydown', 'KeyQ');
      var after = Iv.getItem(P.inventory, P.slot);
      var items = EL.all().filter(function (e) { return e.type === 'item'; });
      return { slot: P.slot, sel: P.inventory.selected, beforeItem: beforeItem,
               before: beforeN, after: after ? after.n : 0,
               spawned: items.length, count: items.length ? items[0].count : 0,
               delay: items.length ? items[0].pickupDelay : -1,
               vy: items.length ? items[0].vy : 0,
               vx: items.length ? items[0].vx : 0,
               vz: items.length ? items[0].vz : 0,
               look: P.lookVec ? [P.lookVec()[0], P.lookVec()[1], P.lookVec()[2]] : null,
               speed: P.DROP_SPEED, lift: P.DROP_LIFT };`);
    ok(r.before === 5,
       `the player is holding five cobblestone (slot ${r.slot}, inv.selected ${r.sel}, ` +
       `holding ${r.beforeItem} x${r.before})`);
    ok(r.spawned === 1, `pressing Q spawned ${r.spawned} item entity`);
    ok(r.after === 4, `and took ONE out of the stack (${r.before} -> ${r.after})`);
    ok(r.count === 1, 'the thrown entity holds one');
    ok(r.delay === 40, `with the forty-tick delay a THROWN item gets, not ten (${r.delay})`);
    // ⚠ THE CLAIM IS "IT GOES WHERE THE PLAYER IS LOOKING", not "vy is positive". The pitch is
    // set to +0.9 above, which is UP in this engine (10_camera.js: "+pitch looks up"), so an
    // item thrown from there must rise — and it must rise by MORE than the fixed lift, or the
    // look vector is contributing nothing and only DROP_LIFT is being measured.
    ok(!!r.look && r.look[1] > 0.5,
       `the test pose really is looking upwards (look.y ${r.look ? r.look[1].toFixed(3) : '?'})`);
    ok(r.vy > r.lift,
       `and it is thrown UPWARDS along the look vector, not merely lifted ` +
       `(vy ${r.vy.toFixed(3)} vs a lift of ${r.lift})`);
    const along = r.look ? (r.vx * r.look[0] + r.vz * r.look[2]) : -1;
    ok(along >= 0,
       `and forwards, not backwards (horizontal component ${along.toFixed(4)})`);

    const all = await ev(`
      var P = MCL.Player, Iv = MCL.Inventory, EL = MCL.EntityList;
      EL.clear();
      window.__in.key('keydown', 'KeyQ', { ctrl: true });
      var after = Iv.getItem(P.inventory, P.slot);
      var items = EL.all().filter(function (e) { return e.type === 'item'; });
      return { after: after && after.n ? after.n : 0, spawned: items.length,
               count: items.length ? items[0].count : 0 };`);
    ok(all.count === 4, `Ctrl+Q threw the WHOLE stack (${all.count})`);
    ok(all.after === 0, 'and left the slot empty');
    okAv(r.count === 1 && all.count === 4,
         'anti-vacuity: Q and Ctrl+Q do different things — one item against four');
  }

  // ═══════════ 5. PLACING PUTS BOTH HALVES OF A DOOR DOWN (D-331, D-332) ═════════════════
  console.log('\n5. a door places both of its halves');
  {
    const r = await ev(`
      var P = MCL.Player, Iv = MCL.Inventory, W = MCL.World, S = MCL.States, R = MCL.Reg;
      var G = MCL.Gamemode, I = MCL.Input;
      MCL.EntityList.clear();
      G.set(P, G.CREATIVE);
      MCL.Hud.close(); I.uiOpen = false; I.locked = true;
      window.__in.stage('dirt');
      Iv.setItem(P.inventory, P.slot, Iv.stack('oak_door', 8));
      P.syncHotbar();
      var held = P.hotbar[P.slot];
      // ⚠⚠ AIMED TWO BLOCKS AHEAD, NOT STRAIGHT DOWN. A door placed on the cell the player is
      // standing in is refused by the self-collision veto — correctly — and the section would
      // have failed on a rule it is not testing.
      P.yaw = 0;
      P.pitch = -Math.PI / 2 + 0.9;
      P.retarget();
      if (!P.hasTarget) return { err: 'no target' };
      var bx = P.tx + MCL.CFG.FACE_DX[P.tface], by = P.ty + MCL.CFG.FACE_DY[P.tface],
          bz = P.tz + MCL.CFG.FACE_DZ[P.tface];
      var before = [W.getBlock(bx, by, bz), W.getBlock(bx, by + 1, bz)];
      P.placeCooldown = 0;
      var okp = P.placeBlock();
      var lo = W.getBlock(bx, by, bz), hi = W.getBlock(bx, by + 1, bz);
      return {
        held: held, placed: okp,
        beforeLo: before[0], beforeHi: before[1],
        loName: lo ? R.names[S.block[lo]] : 'air', hiName: hi ? R.names[S.block[hi]] : 'air',
        loHalf: S.propValue(lo, R.PROP.half), hiHalf: S.propValue(hi, R.PROP.half),
        upper: R.PVAL.upper, lower: R.PVAL.lower,
        hinge: S.propValue(lo, R.PROP.hinge)
      };`);
    ok(!r.err, `the check could target a block (${r.err || 'ok'})`);
    // ⚠ THE FIRST ASSERTION IS D-331's: an oak door had NO state at all until this session, so
    // `P.hotbar[P.slot]` was zero and `placeBlock` refused on its second line, silently.
    ok(r.held > 0, `an oak door in the hotbar resolves to a real block state (${r.held})`);
    ok(r.placed === true, 'and placing it succeeds');
    ok(r.loName === 'oak_door' && r.hiName === 'oak_door',
       `both cells are oak_door (${r.loName} / ${r.hiName})`);
    ok(r.loHalf === r.lower && r.hiHalf === r.upper,
       'the lower half is below and the upper half above');
    ok(r.hinge >= 0, 'and the door carries a hinge');
    okAv(r.beforeLo === 0 && r.beforeHi === 0,
         'anti-vacuity: both cells were AIR before — §5 is measuring a placement');
  }

  // ═══════════ 6. A CANDLE PLACES, AND A SECOND ONE STACKS (D-331) ═══════════════════════
  console.log('\n6. a candle places, and a second one stacks');
  {
    const r = await ev(`
      var P = MCL.Player, Iv = MCL.Inventory, W = MCL.World, S = MCL.States, R = MCL.Reg;
      window.__in.stage('dirt');
      Iv.setItem(P.inventory, P.slot, Iv.stack('candle', 8));
      P.syncHotbar();
      var held = P.hotbar[P.slot];
      P.yaw = 0;
      P.pitch = -Math.PI / 2 + 0.9;
      P.retarget();
      var bx = P.tx + MCL.CFG.FACE_DX[P.tface], by = P.ty + MCL.CFG.FACE_DY[P.tface],
          bz = P.tz + MCL.CFG.FACE_DZ[P.tface];
      P.placeCooldown = 0; P.placeBlock();
      var one = W.getBlock(bx, by, bz);
      P.retarget(); P.placeCooldown = 0; P.placeBlock();
      var two = W.getBlock(bx, by, bz);
      return { held: held,
               oneName: one ? R.names[S.block[one]] : 'air',
               oneN: S.propValue(one, R.PROP.candles),
               twoName: two ? R.names[S.block[two]] : 'air',
               twoN: S.propValue(two, R.PROP.candles) };`);
    ok(r.held > 0, `a candle resolves to a real block state (${r.held}) — it did not before D-331`);
    ok(r.oneName === 'candle', `placing one puts a candle down (${r.oneName})`);
    // ⚠ THE STACKING RULE HAS BEEN IMPLEMENTED, CORRECTLY, TWICE, SINCE D-263 — and no candle
    // item could ever reach it. This is the assertion that proves it is reachable.
    ok(r.twoN === r.oneN + 1,
       `a second candle on the same cell makes it ${r.twoN} candles, not ${r.oneN} ` +
       '(the rule was implemented twice and unreachable until D-331)');
    okAv(r.oneN >= 0 && r.twoN > r.oneN, 'anti-vacuity: the count really went up');
  }

  // ═══════════ 7. THE SELECTED HOTBAR SLOT'S ICON SURVIVES ITS FRAME (D-329) ══════════════
  console.log('\n7. the selection frame does not paint over the selected item');
  {
    const r = await ev(`
      var P = MCL.Player, Iv = MCL.Inventory, H = MCL.Hud, G = MCL.Gamemode;
      MCL.Hud.close();
      G.set(P, G.CREATIVE);
      // the same block in two slots: one selected, one not
      Iv.setItem(P.inventory, 0, Iv.stack('stone', 1));
      Iv.setItem(P.inventory, 1, Iv.stack('stone', 1));
      P.syncHotbar();
      var ink = function (x0, y0, x1, y1) {
        var d = H.ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        var n = 0, sum = 0;
        for (var i = 3; i < d.length; i += 4) if (d[i] > 8) { n++; sum += d[i-1] + d[i-2] + d[i-3]; }
        return { px: n, sum: sum };
      };
      var r0 = H.hotbarRect(), s2 = r0.s;
      var slot = function (i) {
        var x = Math.round(r0.x + (3 + i * 20) * s2), y = Math.round(r0.y + 3 * s2);
        return [x, y, x + Math.round(16 * s2), y + Math.round(16 * s2)];
      };
      P.slot = 0; H.draw();
      var a = slot(0), b = slot(1);
      var sel = ink(a[0], a[1], a[2], a[3]), unsel = ink(b[0], b[1], b[2], b[3]);
      return { sel: sel, unsel: unsel, scale: s2 };`);
    console.log(`   selected slot ${r.sel.px} px · unselected slot ${r.unsel.px} px (scale ${r.scale})`);
    ok(r.unsel.px > 100, `the unselected slot draws its block (${r.unsel.px} px)`);
    // ⚠⚠ THE ASSERTION D-329 NEEDED. With the frame drawn AFTER the items it was composited over
    // the selected slot's icon and over nothing else, so the two slots — holding the same block —
    // drew differently. They must not.
    const ratio = r.unsel.px ? r.sel.px / r.unsel.px : 0;
    ok(ratio > 0.92,
       `the SELECTED slot draws the same block as much as an unselected one ` +
       `(${r.sel.px} vs ${r.unsel.px}, ${(ratio * 100).toFixed(1)}%) — the selection frame must ` +
       'be drawn BEFORE the slots, or it paints over the one item it surrounds');
    okAv(r.sel.px > 100 && r.unsel.px > 100,
         'anti-vacuity: both slots actually drew something, so §7 compared two pictures');
  }

  // ── 8. THE OPTIONS SCREEN UNDER THE KEYBOARD (D-353) ─────────────────────────────────────
  //
  // ⚠⚠ **THIS IS THE ONLY PLACE THE FOCUS MODEL CAN BE TESTED.** `O.hit` is built by `O.draw`
  // and by nothing else, so a headless check would have to lay the widgets out itself — which is
  // the check re-implementing the thing under test. Here the screen is really drawn, the keys are
  // really `KeyboardEvent`s on `window`, and the assertions are about what a player would see.
  // ⚠ AND EVERY MOVE IS MADE TWICE WITH A REDRAW BETWEEN THEM, because the bug this file found
  // in the slider drag (D-340) was a lookup that worked for exactly one frame.
  console.log('\n8. the options screen answers the keyboard');
  {
    const setup = await s.evaluate(function () {
      MCL.Hud.screen = 'pause';
      MCL.Options.open('video');
      MCL.Hud.draw();
      var O = MCL.Options;
      return { screen: O.screen, widgets: O.hit.length, focus: O.focus };
    });
    ok(!!setup && setup.screen === 'video', `the video options screen is open (${setup && setup.screen})`);
    ok(setup.widgets > 4, `it laid out ${setup.widgets} focusable widgets`);
    ok(setup.focus === -1, `and nothing is focused to begin with (${setup.focus})`);

    const tab = (shift) => s.evaluate(new Function(`
      window.__in.key('keydown', 'Tab', { shift: ${shift ? 'true' : 'false'} });
      MCL.Hud.draw();
      return { focus: MCL.Options.focus, n: MCL.Options.hit.length };`));

    const t1 = await tab(false);
    ok(t1.focus === 0, `Tab from nothing focuses the FIRST widget (${t1.focus})`);
    const t2 = await tab(false);
    // ⚠⚠ **THE ASSERTION THAT WOULD HAVE CAUGHT D-340.** A focus that held the widget OBJECT
    // would be correct for the first press and match nothing after the redraw between them.
    ok(t2.focus === 1, `and Tab again, ACROSS A REDRAW, advances to the second (${t2.focus})`);
    const back = await tab(true);
    ok(back.focus === 0, `Shift-Tab goes back (${back.focus})`);

    // wrap, both ways
    const wrapDown = await s.evaluate(function () {
      var O = MCL.Options;
      O.focus = O.hit.length - 1;
      window.__in.key('keydown', 'Tab', {});
      MCL.Hud.draw();
      return O.focus;
    });
    ok(wrapDown === 0, `Tab off the end wraps to the first (${wrapDown})`);
    const wrapUp = await s.evaluate(function () {
      var O = MCL.Options;
      O.focus = 0;
      window.__in.key('keydown', 'Tab', { shiftKey: true });
      return O.focus;
    });
    void wrapUp;
    const wrapUp2 = await s.evaluate(function () {
      var O = MCL.Options;
      O.focus = 0;
      window.dispatchEvent(new KeyboardEvent('keydown',
        { code: 'Tab', key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
      MCL.Hud.draw();
      return { focus: O.focus, n: O.hit.length };
    });
    ok(wrapUp2.focus === wrapUp2.n - 1,
       `Shift-Tab off the front wraps to the last (${wrapUp2.focus} of ${wrapUp2.n})`);

    // ── the focused widget is DRAWN differently, which is the only feedback there is ────────
    // ⚠ MEASURED IN THE WIDGET'S OWN RECTANGLE, from the hit rect the draw produced — the same
    // rule D-347 settled for the entity: a claim about one widget is made where that widget is.
    const look = await s.evaluate(function () {
      // ⚠ THE **UI** CANVAS, NOT THE GL ONE. The game has two — `gl` for the world and `ui` for
      // the software-rasterised HUD — and `getContext('2d')` on a canvas already bound to WebGL
      // returns NULL. The first draft read `Gfx.canvas` and threw one line later, which is a
      // harness fault reported as a failure of the thing under test: the exact class of mistake
      // D-345 named in `smoke`. The HUD owns its own context and this asks the HUD for it.
      var O = MCL.Options, ctx = MCL.Hud.ctx;
      function ink(r) {
        var d = ctx.getImageData(r.x | 0, r.y | 0, Math.max(1, r.w | 0), Math.max(1, r.h | 0)).data;
        var sum = 0;
        for (var i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
        return sum;
      }
      MCL.Input.mx = -10000; MCL.Input.my = -10000;      // the pointer is nowhere near it
      O.focus = -1; MCL.Hud.draw();
      var r0 = O.hit[0], plain = ink(r0);
      O.focus = 0; MCL.Hud.draw();
      var lit = ink(O.hit[0]);
      O.focus = -1; MCL.Hud.draw();
      var back2 = ink(O.hit[0]);
      return { plain: plain, lit: lit, back: back2, w: r0.w, h: r0.h };
    });
    console.log(`   widget 0 is ${look.w}x${look.h}: ${look.plain} ink unfocused, ${look.lit} focused`);
    ok(look.lit !== look.plain,
       `the focused widget is drawn differently from the same widget unfocused ` +
       `(${look.lit} vs ${look.plain})`);
    // ⚠ AND IT GOES BACK, which is what makes the line above about the focus rather than about
    // anything else that might have changed between two draws.
    ok(look.back === look.plain,
       `and unfocusing it puts the picture back (${look.back} vs ${look.plain})`);

    // ── Enter presses the focused button, by the same path a click takes ────────────────────
    const enter = await s.evaluate(function () {
      var O = MCL.Options;
      O.screen = 'video'; O.invalidate(); MCL.Hud.draw();
      // find the DONE button, which is always the last widget, and press it with the keyboard
      O.focus = O.hit.length - 1;
      var before = O.screen;
      window.__in.key('keydown', 'Enter', {});
      return { before: before, after: O.screen };
    });
    ok(enter.before === 'video' && enter.after !== 'video',
       `Enter on the focused Done button leaves the screen (${enter.before} -> ${enter.after})`);

    // ── the arrows step a focused SLIDER by one GUI pixel of travel ─────────────────────────
    const slide = await s.evaluate(function () {
      var O = MCL.Options;
      O.open('video'); MCL.Hud.draw();
      var i = -1;
      for (var k = 0; k < O.hit.length; k++) if (O.hit[k].row.t === 'slide') { i = k; break; }
      if (i < 0) return null;
      O.focus = i;
      var h = O.hit[i], gw = h.w / (h.s || 1);
      var travel = gw - O.SLIDER_KNOB_W;
      // park it in the middle so a step in either direction is measurable and neither clamps
      O.setRaw(h.row, 0.5);
      MCL.Hud.draw();
      var a = O.rawFrac(O.hit[i].row);
      window.__in.key('keydown', 'ArrowRight', {});
      MCL.Hud.draw();
      var b = O.rawFrac(O.hit[i].row);
      window.__in.key('keydown', 'ArrowLeft', {});
      MCL.Hud.draw();
      var c2 = O.rawFrac(O.hit[i].row);
      // ⚠⚠ AND THE SETTING ITSELF, over enough presses to CROSS a quantisation boundary. The
      // raw value above is what vanilla's widget holds; the snapped one is what the player sees,
      // and a check that only watched the raw number would pass on a slider wired to nothing.
      var snapBefore = O.hit[i].row.frac();
      for (var p2 = 0; p2 < Math.ceil(travel) + 2; p2++) {
        window.__in.key('keydown', 'ArrowRight', {});
      }
      MCL.Hud.draw();
      var snapAfter = O.hit[i].row.frac();
      return { travel: travel, a: a, b: b, c: c2, label: O.hit[i].label,
               snapBefore: snapBefore, snapAfter: snapAfter, presses: Math.ceil(travel) + 2 };
    });
    ok(!!slide, 'the video screen has a slider to step');
    if (slide) {
      console.log(`   "${slide.label}": travel ${slide.travel} gui px, ` +
                  `${slide.a.toFixed(4)} -> ${slide.b.toFixed(4)} -> ${slide.c.toFixed(4)}`);
      ok(slide.b > slide.a, `Right moves the slider up (${slide.a} -> ${slide.b})`);
      // ⚠⚠ **THE STEP IS `1 / (width - 8)` AND THE CHECK DERIVES IT FROM THE WIDGET'S OWN WIDTH**
      // — it owns no number. Vanilla's `AbstractSliderButton.keyPressed` divides by the same
      // travel the knob is laid out across and the same one a pointer-drag divides by, and using
      // the full width instead would make a keypress and a drag of one pixel disagree (D-330).
      // ⚠ A step is quantised by the slider's own value set, so the claim is that the move is
      // no larger than one step of travel, not that it equals it exactly.
      const want = 1 / slide.travel;
      ok(slide.b - slide.a <= want + 1e-6,
         `and by no more than one GUI pixel of travel (${(slide.b - slide.a).toFixed(5)} <= ` +
         `${want.toFixed(5)})`);
      ok(Math.abs(slide.c - slide.a) < 1e-6 || slide.c < slide.b,
         `and Left brings it back (${slide.c} vs ${slide.a})`);
      // ⚠⚠ **THE ASSERTION THAT MATTERS TO A PLAYER.** A step of 1/142 is smaller than one chunk
      // of render distance, so a single press changes the SETTING by nothing — and the first
      // draft of the rule stepped from the snapped value, which meant the arrow keys never moved
      // a coarse slider at all, ever. This presses enough times to cross a boundary and asserts
      // the setting the player sees actually changed.
      console.log(`   ${slide.presses} presses: the setting went ` +
                  `${slide.snapBefore.toFixed(4)} -> ${slide.snapAfter.toFixed(4)}`);
      ok(slide.snapAfter > slide.snapBefore,
         `and held down it moves the SETTING, not just the widget's raw value ` +
         `(${slide.snapBefore} -> ${slide.snapAfter})`);
    }

    // ── anti-vacuity: with the handler unhooked, none of it happens ────────────────────────
    {
      const broke = await s.evaluate(function () {
        var O = MCL.Options;
        O.open('video'); MCL.Hud.draw();
        var real = O.key;
        O.key = function () { return false; };
        O.focus = -1;
        window.__in.key('keydown', 'Tab', {});
        var dead = O.focus;
        O.key = real;
        window.__in.key('keydown', 'Tab', {});
        MCL.Hud.draw();
        return { dead: dead, alive: O.focus };
      });
      okAv(broke.dead === -1,
           'with Options.key unhooked, Tab moves nothing — so section 8 was measuring the wiring');
      okAv(broke.alive === 0, 'and with it back, Tab focuses the first widget again');
    }
    // ⚠ AND THE GAP LIST IS EMPTY, asserted here as well as in `optionscheck`, because this is
    // the file that can prove the four entries are actually gone rather than merely deleted.
    const owed = await s.evaluate(function () { return MCL.Options.OWED_INPUT.length; });
    ok(owed === 0, `Options.OWED_INPUT is empty (${owed})`);
  }

  ok(s.problems.length === 0, `the page logged no errors (${s.problems.slice(0, 2).join(' | ')})`);
} catch (e) {
  fails.push('threw: ' + (e && e.message ? e.message : e));
  console.log('FAIL  threw: ' + e);
} finally {
  await s.close();
}

console.log('\n===========================================');
console.log(` inputcheck: ${pass} assertions, ${fails.length} failed, ${breaks} breaks`);
for (const f of fails) console.log('   x ' + f);
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
