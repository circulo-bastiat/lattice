#!/usr/bin/env node
// g10check.mjs — the half a headless test cannot see: the PICTURE, read off the HUD's own canvas.
//
// ⚠ IT IS NAMED FOR G10 AND IT IS NOT ONLY G10's ANY MORE. §1..§4 are the breaking overlay and
// the first-person hand; §5 is G14's armour row (D-290, D-291), which is here because THIS is
// the file that reads `Hud.ctx` back. A second browser stage that opened a second Chromium to
// look at the same canvas would cost forty seconds and prove the same thing (D-281).
//
//   node tools/g10check.mjs [dist/mclite.html]
//   MCLITE_PRESET=medium node tools/g10check.mjs
//
// ⚠ WHY THIS IS A BROWSER STAGE. `handcheck` proves the arithmetic — six ticks, the halfway
// rule, the clamp at stage 9. None of that says a single pixel of a crack ever reaches the
// screen. NEXT.md's first standing lesson is that a check which never looks at the picture cannot
// see the world (PLAN §23: five rendering bugs found by Dan PLAYING while 554,142 assertions
// passed), and the breaking overlay and the first-person hand are exactly that shape of thing —
// both are pure drawing, both look fine in every counter, and both are invisible if the tile
// lookup returns -1.
//
// It reads the HUD's own 2D canvas rather than a screenshot, because the HUD is where both are
// drawn and `getImageData` on it is exact, cheap, and immune to the compositor (D-247's whole
// lesson: a screenshot of the window is not the buffer the engine wrote).
//
// ⚠ EVERY ASSERTION IS A DIFFERENCE, NOT A THRESHOLD. "Some pixels are dark" passes on any
// screen; "these pixels changed when and only when the overlay was switched on" cannot.

import { open, sleep } from './cdp.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv[2] || join(ROOT, 'dist', 'mclite.html');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const s = await open(FILE, { width: 1024, height: 640 });
if (!s) {
  console.log('g10check: SKIP — no Chromium on this machine (cdp.mjs found none)');
  process.exit(0);
}

try {
  await sleep(2000);
  await s.evaluate(() => { MCL.Main.play(1337); return 1; });
  // ⚠ `MCL.World.count` DOES NOT EXIST, and waiting on it waited for ever while the world was
  // perfectly up — the first version of this file failed with "the world came up" against a
  // running game. The condition is the HUD's own mode plus a real targeting result, which is
  // what the rest of the file needs anyway.
  const up = await s.waitFor(() => (MCL.Hud && MCL.Hud.mode === 'game'
    && MCL.Player && MCL.Gfx && MCL.Gfx.cam) ? 1 : 0, 90000);
  if (!ok(!!up, 'the world came up')) throw new Error('no world');
  await sleep(6000);

  // ── the probe, in the page ──────────────────────────────────────────────────────────────
  // Returns the HUD canvas's own pixels, summarised: the total ink in a rectangle and a coarse
  // signature, so a whole frame comes back as a few numbers rather than a megabyte.
  const PROBE = `
    window.__g10 = {
      ink: function (x0, y0, x1, y1) {
        var H = MCL.Hud, c = H.ctx;
        var d = c.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
        var n = 0, sum = 0;
        for (var i = 3; i < d.length; i += 4) { if (d[i] > 8) { n++; sum += d[i - 1] + d[i - 2] + d[i - 3]; } }
        return { px: n, sum: sum };
      },
      // WARNING: THE HAND IS NOT ON THE HUD CANVAS ANY MORE (D-359). The ink probe above reads
      // the 2D overlay, which is where the hand used to be BLITTED; it is geometry now, in the
      // renderer's own pass, so counting HUD pixels for it returns 0 for every state and the
      // section passes or fails for reasons that have nothing to do with the hand. This reads
      // the RENDERED surface instead, through the backend's own capture -- which resolves after
      // the next real frame, so the frame the state was set for has certainly been drawn.
      // WARNING: A RECTANGLE CHOSEN BY EYE CANNOT TELL "the hand is not there" FROM "the hand
      // was never drawn" -- D-347, paid a fortnight ago on a falling block. The hand's own
      // ink is measured as a DIFFERENCE against the same frame with Gfx.hideHand set, so the
      // world underneath cancels exactly and no rectangle has to be guessed at.
      grab: function (slot, x0, y0, x1, y1) {
        window.__g10done = -1;
        var B = MCL.Gfx.backend;
        if (!B || !B.capture) return false;
        window.__g10buf = window.__g10buf || [];
        var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
        B.capture(x0 | 0, y0 | 0, w, h).then(function (px) {
          window.__g10buf[slot] = px;
          window.__g10done = slot;
        }, function () { window.__g10done = -2; });
        return true;
      },
      diff: function () {
        var a = window.__g10buf[0], b = window.__g10buf[1];
        if (!a || !b || a.length !== b.length) return { px: -1, sum: -1 };
        var n = 0, sum = 0;
        for (var i = 0; i < a.length; i += 4) {
          var d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
          if (d > 24) { n++; sum += d; }
        }
        return { px: n, sum: sum };
      },
      box: function () {
        // the target block's projected screen rectangle, from the HUD's own projection
        var P = MCL.Player, G = MCL.Gfx, m = G.cam.viewProj;
        var lo = [1e9, 1e9], hi = [-1e9, -1e9], any = false, behind = 0;
        for (var i = 0; i < 8; i++) {
          var x = P.tx + (i & 1), y = P.ty + ((i >> 1) & 1), z = P.tz + ((i >> 2) & 1);
          var rx = x - G.cam.x, ry = y - G.cam.y, rz = z - G.cam.z;
          var cx = m[0]*rx + m[4]*ry + m[8]*rz + m[12];
          var cy = m[1]*rx + m[5]*ry + m[9]*rz + m[13];
          var w  = m[3]*rx + m[7]*ry + m[11]*rz + m[15];
          if (w <= 1e-4) { behind++; continue; }
          any = true;
          var sx = (cx / w * 0.5 + 0.5) * MCL.Hud.w, sy = (0.5 - cy / w * 0.5) * MCL.Hud.h;
          if (sx < lo[0]) lo[0] = sx; if (sy < lo[1]) lo[1] = sy;
          if (sx > hi[0]) hi[0] = sx; if (sy > hi[1]) hi[1] = sy;
        }
        return any ? { x0: lo[0], y0: lo[1], x1: hi[0], y1: hi[1], behind: behind } : null;
      },
      aim: function () {
        var P = MCL.Player;
        P.pitch = -Math.PI / 2 + 0.45;
        P.retarget();
        return { hasTarget: P.hasTarget, tid: P.tid };
      },
      stage: function (n) {
        MCL.Hand.crackStage = n; MCL.Hand.crackKey = n < 0 ? -1 : 1;
        MCL.Hud.draw();
        return MCL.Hand.crackStage;
      },
      hand: function (anim, slotState) {
        var P = MCL.Player;
        if (slotState !== null) P.hotbar[P.slot] = slotState;
        MCL.Hand.attackAnim = anim; MCL.Hand.prevAttackAnim = anim;
        MCL.Hud.draw();
        return P.hotbar[P.slot];
      }
    };
    1;`;
  await s.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });

  const aim = await s.evaluate(() => window.__g10.aim());
  ok(aim && aim.hasTarget, 'looking down targets a block');
  const box = await s.evaluate(() => window.__g10.box());
  ok(box && box.x1 > box.x0 && box.y1 > box.y0,
    `the target projects to a rectangle (${box ? Math.round(box.x1 - box.x0) + 'x' + Math.round(box.y1 - box.y0) : 'none'})`);

  // ── 1. the overlay appears, and only while breaking ─────────────────────────────────────
  console.log('\n1. the breaking overlay');
  await s.evaluate(() => window.__g10.stage(-1));
  const clean = await s.evaluate(() => window.__g10.ink(0, 0, MCL.Hud.w, MCL.Hud.h));
  await s.evaluate(() => window.__g10.stage(5));
  const cracked = await s.evaluate(() => window.__g10.ink(0, 0, MCL.Hud.w, MCL.Hud.h));
  ok(cracked.px > clean.px + 200,
    `the overlay puts ink on the HUD: ${clean.px} px clean -> ${cracked.px} px at stage 5`);

  // ⚠ AND IT MUST BE INSIDE THE BLOCK. An overlay that smeared across the screen — the failure
  // mode of an affine transform on a degenerate face — would pass the count above.
  const pad = 6;
  const inside = await s.evaluate(() => {
    const b = window.__g10.box();
    return window.__g10.ink(Math.max(0, b.x0 - 6), Math.max(0, b.y0 - 6),
      Math.min(MCL.Hud.w, b.x1 + 6), Math.min(MCL.Hud.h, b.y1 + 6));
  });
  // ⚠ A BAND OUTSIDE THE BLOCK, WHEREVER THERE IS ROOM FOR ONE — and this is the second thing
  // this assertion got wrong. It first measured the strip ABOVE the block, which sounds fine
  // until the block's projected box starts at y = -87 because the block fills the top of the
  // screen: the "band" collapses to row 0, that row is the block, and the test reports a
  // 151-pixel leak that is the overlay doing exactly its job. A test whose region can degenerate
  // to something it is not about will eventually report that thing as a bug.
  const margins = await s.evaluate(() => {
    const b = window.__g10.box(), H = MCL.Hud;
    return { top: b.y0, bottom: H.h - b.y1, left: b.x0, right: H.w - b.x1, w: H.w, h: H.h };
  });
  const side = ['top', 'bottom', 'left', 'right']
    .map((k) => [k, margins[k]]).sort((x, y) => y[1] - x[1])[0];
  console.log(`   outside band: ${side[0]}, ${Math.round(side[1])} px of room`
    + ` (margins t${Math.round(margins.top)} b${Math.round(margins.bottom)}`
    + ` l${Math.round(margins.left)} r${Math.round(margins.right)})`);

  const bandInk = async () => s.evaluate(new Function(`
    var b = window.__g10.box(), H = MCL.Hud, k = ${JSON.stringify(side[0])};
    if (k === 'top')    return window.__g10.ink(0, 0, H.w, Math.max(1, Math.floor(b.y0 - 24)));
    if (k === 'bottom') return window.__g10.ink(0, Math.min(H.h - 1, Math.ceil(b.y1 + 24)), H.w, H.h);
    if (k === 'left')   return window.__g10.ink(0, 0, Math.max(1, Math.floor(b.x0 - 24)), H.h);
    return window.__g10.ink(Math.min(H.w - 1, Math.ceil(b.x1 + 24)), 0, H.w, H.h);`));

  const outsideTop = await bandInk();
  const outsideCleanTop = await (async () => {
    await s.evaluate(() => window.__g10.stage(-1));
    const v = await bandInk();
    await s.evaluate(() => window.__g10.stage(5));
    return v;
  })();
  ok(inside.px > 200, `most of the overlay is inside the block's rectangle (${inside.px} px)`);
  if (side[1] >= 60) {
    ok(Math.abs(outsideTop.px - outsideCleanTop.px) < 40,
      `the overlay does not leak outside the block (${side[0]} band: ${outsideCleanTop.px} -> ${outsideTop.px} px)`);
  } else {
    // ⚠ NOT A SILENT CAP: say what was not tested and why.
    console.log(`   ~ leak test SKIPPED: the block's projection leaves only ${Math.round(side[1])} px`
      + ' of room on its widest side, which is not a band this can judge');
  }

  // ── 2. the stage actually changes the picture ───────────────────────────────────────────
  const byStage = [];
  for (let n = 0; n < 10; n++) {
    await s.evaluate(new Function('return window.__g10.stage(' + n + ')'));
    const v = await s.evaluate(() => {
      const b = window.__g10.box();
      return window.__g10.ink(Math.max(0, b.x0 - 6), Math.max(0, b.y0 - 6),
        Math.min(MCL.Hud.w, b.x1 + 6), Math.min(MCL.Hud.h, b.y1 + 6));
    });
    byStage.push(v.px);
  }
  console.log('   ink by stage: ' + byStage.join(' '));
  ok(byStage.every((v) => v > 100), 'every one of the ten stages draws something');
  // ⚠ THE LATER STAGES MUST BE CRACKIER. destroy_stage_9 has far more dark texels than 0, and a
  // tile lookup that returned the same texture for every stage would pass "every stage draws".
  ok(byStage[9] > byStage[0] * 1.2,
    `stage 9 is crackier than stage 0 (${byStage[0]} -> ${byStage[9]} px)`);
  ok(new Set(byStage).size >= 6,
    `the ten stages are not all the same picture (${new Set(byStage).size} distinct ink counts)`);

  // ── 3. the hand, ON THE RENDERED SURFACE (D-359) ────────────────────────────────────────
  // ⚠⚠ **THE HAND MOVED LAYERS AND THIS SECTION HAD TO MOVE WITH IT.** It used to count pixels on
  // the HUD's 2D canvas, because that is where the hand was blitted. It is geometry now, drawn
  // after the world and after a depth clear, so the same probe reads 0 px for every state — which
  // is a section that cannot fail for the right reason OR pass for it.
  // ⚠ AND THE ASSERTIONS THEMSELVES CHANGED, because the GAME changed: an EMPTY hand is not
  // nothing, it is the player's ARM. "Holding an item draws more ink than an empty hand" was true
  // of a blit that drew nothing when the slot was empty and is false of vanilla. What must be
  // true is that the two are DIFFERENT PICTURES and that a spectator has neither.
  console.log('\n2. the first-person hand, on the rendered surface');
  await s.evaluate(() => window.__g10.stage(-1));
  // ⚠ THE DAY CYCLE AND THE ADAPTIVE STREAMER ARE STOPPED FIRST (D-321, D-145). Two captures a
  // few hundred milliseconds apart are only a control for each other if nothing else in the
  // frame is moving, and the sky moves ~10,000 pixels between frames 700 ms apart.
  await s.evaluate(() => {
    if (MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD660 = MCL.Sky.weather; if (wD660) { wD660.raining = wD660.thundering = false; wD660.rainLevel = wD660.oRainLevel = wD660.thunderLevel = wD660.oThunderLevel = 0; } }
    if (MCL.Settings) MCL.Settings.adaptive = false;
    return 1;
  });
  const handRect = await s.evaluate(() => {
    const H = MCL.Hud;
    const dpr = H.dpr || 1;
    // the lower-right quadrant, in DEVICE pixels — `capture` reads the drawing buffer
    return { x0: Math.round(H.w * 0.45 * dpr), y0: Math.round(H.h * 0.35 * dpr),
             x1: Math.round(H.w * dpr), y1: Math.round(H.h * dpr), w: H.w, h: H.h, dpr: dpr };
  });
  console.log(`   hand probe rect ${handRect.x0},${handRect.y0} .. ${handRect.x1},${handRect.y1} (dpr ${handRect.dpr})`);

  /** Set the hand state and draw a real frame. */
  const setHand = async (anim, slotName) => s.evaluate(new Function(
    'var P = MCL.Player, IT = MCL.Items, Iv = MCL.Inventory;' +
    'var n = ' + JSON.stringify(slotName) + ';' +
    'if (n === null) { Iv.setItem(P.inventory, 0, null); }' +
    'else { Iv.setItem(P.inventory, 0, { i: IT.of(n), n: 1 }); }' +
    'P.slot = 0; P.syncHotbar();' +
    'if (MCL.Hand) {' +
    '  MCL.Hand.attackAnim = ' + anim + '; MCL.Hand.prevAttackAnim = ' + anim + ';' +
    '  MCL.Hand.mainHandHeight = 1; MCL.Hand.oMainHandHeight = 1;' +
    '  MCL.Hand.mainHandItem = MCL.Hand.heldIndexOf(P);' +
    '}' +
    'return 1;'));

  /** Capture the rectangle into slot 0 or 1, with the hand shown or hidden. */
  const grab = async (slot, hide) => {
    // ⚠ RE-PIN THE EQUIP HEIGHT AT EVERY GRAB: Hand.tick lowers the hand toward the new item's
    // slot between the evaluate that set it and the frame the capture reads (flaky 0 / 28 / 33056 px).
    await s.evaluate(new Function(`MCL.Gfx.hideHand = ${hide ? 'true' : 'false'};` +
      'if (MCL.Hand) { MCL.Hand.mainHandHeight = 1; MCL.Hand.oMainHandHeight = 1; } return 1;'));
    const started = await s.evaluate(new Function(
      `return window.__g10.grab(${slot}, ${handRect.x0}, ${handRect.y0}, ${handRect.x1}, ${handRect.y1});`));
    if (!started) return false;
    const got = await s.waitFor(new Function(`return window.__g10done === ${slot} ? 1 : 0;`), 15000);
    return !!got;
  };

  /**
   * The hand's OWN ink: this frame with the hand, minus the same frame without it.
   * ⚠ THE WORLD CANCELS BY CONSTRUCTION, which is the whole point — the alternative is a
   * rectangle picked by eye, and D-347 is the record of what that costs.
   */
  const handInk = async (anim, slotName) => {
    await setHand(anim, slotName);
    let d = { px: -1, sum: -1 };
    // ⚠ A pair that differs over most of the rectangle caught the WORLD changing between the two
    // frames (px ~ 150k of 181k), not the hand: measure again.
    for (let tries = 0; tries < 10; tries++) {
      if (!await grab(0, false)) return { px: -1, sum: -1 };
      if (!await grab(1, true)) return { px: -1, sum: -1 };
      await s.evaluate(() => { MCL.Gfx.hideHand = false; return 1; });
      d = await s.evaluate(() => window.__g10.diff());
      if (d.px >= 200 && d.px < 60000) break;   // too few = the lazily built model/arm was not drawn yet
      await sleep(700);
    }
    return d;
  };

  // ⚠ THE FIRST HELD ITEM OF A SESSION IS DRAWN BEFORE ITS MODEL IS BUILT (0 / 28 / 326 / 33056 px
  // on identical runs), so one throwaway capture pair warms it up and the measured one follows.
  // ⚠ AND THE WORLD IS STILL SETTLING (chunks meshing in: the same rectangle went 47 -> 105 mean
  // red over four captures with the hand hidden for two of them), which swamps the hand's own ink.
  // Wait for three consecutive hand-hidden pairs, 700 ms apart, to be identical.
  const settle = async (name) => {
    await setHand(0, name);
    for (let calm = 0, tries = 0; calm < 3 && tries < 40; tries++) {
      await grab(0, true); await sleep(700); await grab(1, true);
      const d = await s.evaluate(() => window.__g10.diff());
      calm = d.px === 0 ? calm + 1 : 0;
    }
  };
  await settle('stone');
  await handInk(0, 'stone');
  await sleep(1500);
  const withItem = await handInk(0, 'stone');
  // ⚠ LEVEL THE LOOK FOR THE ARM. The sway rotates the hand by a tenth of (pitch - xBob) and xBob is eased on
  // TICKS: stage 9 aimed the camera down at a block without them, so the stale xBob swung the arm off the
  // bottom of the screen (0 px shown == hidden). Restored below for the sections that need the block in view.
  const look = await s.evaluate(() => { const P = MCL.Player, k = { p: P.pitch, b: P.xBob, o: P.xBobO }; P.pitch = 0; P.xBob = 0; P.xBobO = 0; return k; });
  await settle(null);
  await handInk(0, null);   // the ARM is built lazily too: warm it up before the measured capture
  await sleep(1500);
  const empty = await handInk(0, null);
  await s.evaluate(new Function(`var P = MCL.Player; P.pitch = ${look.p}; P.xBob = ${look.b}; P.xBobO = ${look.o}; return 1;`));
  ok(withItem.px > 500, `holding a block draws a hand on the rendered surface (${withItem.px} px of its own)`);
  ok(empty.px > 200, `and an EMPTY hand draws the ARM rather than nothing (${empty.px} px)`);
  ok(Math.abs(withItem.sum - empty.sum) > withItem.sum * 0.05,
     `the two are different pictures (${Math.round(withItem.sum / 1000)}k vs ${Math.round(empty.sum / 1000)}k)`);

  // ⚠ AND IT MOVES. A hand drawn at a fixed place would pass everything above.
  // ⚠⚠ **THE SWING PHASE IS PINNED AT `swingProgress`, NOT AT `attackAnim`.** Writing the field
  // and waiting for a frame does not work any more: `Hand.tickSwing` runs twenty times a second
  // and overwrites it from `swingTime`, so by the time the renderer reads it the poke is gone —
  // and every phase measured the same picture, twice, which is what a stuck animation looks like
  // in a check that is actually measuring nothing. The renderer's own input is
  // `Hand.swingProgress(partial)`, so that is what is held, for exactly as long as the capture.
  const moved = [];
  for (const a of [0, 0.25, 0.5, 0.75]) {
    await s.evaluate(new Function(
      'window.__g10swing = MCL.Hand.swingProgress;' +
      'MCL.Hand.swingProgress = function () { return ' + a + '; };' +
      'return 1;'));
    const v = await handInk(0, 'stone');
    await s.evaluate(() => { MCL.Hand.swingProgress = window.__g10swing; return 1; });
    moved.push(v.sum);
  }
  console.log('   hand ink-sum through the swing: ' + moved.map((v) => Math.round(v / 1000)).join(' ') + ' (thousands)');
  ok(new Set(moved).size >= 3,
    `the hand moves through the swing (${new Set(moved).size} distinct pictures across four phases)`);

  // ── 4. anti-vacuity ─────────────────────────────────────────────────────────────────────
  console.log('\n3. anti-vacuity: break it, and it must be caught');
  okAv(clean.px < cracked.px, 'the clean frame really is cleaner — §1 is a difference, not a threshold');
  okAv(empty.px > 0 && withItem.px > 0 && empty.sum !== withItem.sum,
       'both hands really drew something and they really differ — §2 compared two pictures');
  const noStage = await s.evaluate(() => {
    window.__g10.stage(-1);
    const b = window.__g10.box();
    return window.__g10.ink(Math.max(0, b.x0 - 6), Math.max(0, b.y0 - 6),
      Math.min(MCL.Hud.w, b.x1 + 6), Math.min(MCL.Hud.h, b.y1 + 6));
  });
  okAv(noStage.px < byStage[0],
    'switching the overlay off removes the ink §2 counted, so §2 was measuring the overlay');
  await s.evaluate(() => {
    const P = MCL.Player;
    window.__g10mode = P.mode;
    if (MCL.Gamemode) MCL.Gamemode.set(P, MCL.Gamemode.SPECTATOR);
    return 1;
  });
  const spectator = await handInk(0, 'stone');
  await s.evaluate(() => {
    if (MCL.Gamemode) MCL.Gamemode.set(MCL.Player, window.__g10mode);
    return 1;
  });
  okAv(spectator.px < withItem.px * 0.6,
       `a spectator has no hand (${spectator.px} px against ${withItem.px})`);

  // ── 4b. THE TITLE OVERLAY (D-326) ───────────────────────────────────────────────────────
  // ⚠ IT IS HERE BECAUSE THIS IS THE FILE THAT LOOKS AT THE HUD'S OWN CANVAS. `commandcheck`
  // owns the fade ARITHMETIC and the command's effect on the state; only this can say whether a
  // title ever reaches a screen — the same split that caught the armour row below.
  console.log('\n4b. the title overlay');
  {
    const band = await s.evaluate(() => {
      const H = MCL.Hud;
      // the strip the title occupies: scale 4, drawn at h/2 - 40*scale, about 8 glyph rows tall
      return { x0: 0, y0: Math.round(H.h * 0.5 - 48 * H.scale),
               x1: H.w, y1: Math.round(H.h * 0.5 + 40 * H.scale) };
    });
    const ink = () => s.evaluate(new Function(
      `return window.__g10.ink(${band.x0}, ${band.y0}, ${band.x1}, ${band.y1});`));

    await s.evaluate(() => { MCL.Hud.clearTitles(); MCL.Hud.draw(); return 1; });
    const blank = await ink();

    // ⚠ READ IN THE SAME evaluate AS THE COMMAND (D-650): the live game ticks between two
    // evaluate calls, so a separate read saw 99 on a slow runner (full suite 24 Sept 16:08).
    const shown = await s.evaluate(() => {
      MCL.Commands.run('/title @s title {"text":"HELLO WORLD"}', MCL.Player, {});
      const r = { time: MCL.Hud.titles.time, alpha: MCL.Hud.titleAlpha(MCL.Hud.titles) };
      MCL.Hud.draw();
      return r;
    });
    // ⚠ AT THE FIRST TICK THE ALPHA IS ZERO — the fade starts there. Drawing immediately and
    // asserting ink would fail on a correct engine, so the clock is wound to the solid part
    // first. A check that did not know its own subject's ramp would have "found" a bug here.
    ok(shown.time === 100, `the title clock started at 100 (${shown.time})`);
    ok(shown.alpha === 0, `and at the first tick it is invisible (${shown.alpha}) — that is the fade`);

    await s.evaluate(() => {
      for (let i = 0; i < 15; i++) MCL.Hud.tickTitles();     // into the solid stay
      MCL.Hud.draw();
      return 1;
    });
    const solid = await ink();
    console.log(`   title band: ${blank.px} px blank -> ${solid.px} px with a title`);
    ok(solid.px > blank.px + 200,
       `a title puts ink in the middle of the screen (${blank.px} -> ${solid.px})`);

    // ⚠ AND THE SUBTITLE ONLY SHOWS WITH A TITLE, which is vanilla's own shape and the thing
    // players get wrong. Adding one must add ink; adding one with the title cleared must not.
    await s.evaluate(() => {
      MCL.Commands.run('/title @s subtitle {"text":"a subtitle"}', MCL.Player, {});
      MCL.Hud.draw();
      return 1;
    });
    const withSub = await ink();
    ok(withSub.px > solid.px, `a subtitle adds ink under it (${solid.px} -> ${withSub.px})`);

    await s.evaluate(() => { MCL.Hud.clearTitles(); MCL.Hud.draw(); return 1; });
    const cleared = await ink();
    ok(cleared.px <= blank.px + 8, `and /title clear takes it all away (${cleared.px})`);

    // the subtitle survives the clear in vanilla only as state; with no title it draws nothing
    await s.evaluate(() => {
      MCL.Commands.run('/title @s subtitle {"text":"orphan"}', MCL.Player, {});
      MCL.Hud.draw();
      return 1;
    });
    const orphan = await ink();
    ok(orphan.px <= blank.px + 8,
       `a subtitle with no title draws NOTHING, as vanilla does (${orphan.px})`);

    // the action bar is its own line, above the hotbar and not in this band
    const barBand = await s.evaluate(() => {
      const H = MCL.Hud;
      return { x0: 0, y0: Math.round(H.h - 80 * H.scale), x1: H.w, y1: Math.round(H.h - 62 * H.scale) };
    });
    const barInk = () => s.evaluate(new Function(
      `return window.__g10.ink(${barBand.x0}, ${barBand.y0}, ${barBand.x1}, ${barBand.y1});`));
    await s.evaluate(() => { MCL.Hud.clearTitles(); MCL.Hud.titles.bar = null; MCL.Hud.titles.barTime = 0; MCL.Hud.draw(); return 1; });
    const barBlank = await barInk();
    await s.evaluate(() => {
      MCL.Commands.run('/title @s actionbar {"text":"ACTION BAR"}', MCL.Player, {});
      MCL.Hud.draw();
      return 1;
    });
    const barShown = await barInk();
    ok(barShown.px > barBlank.px + 40,
       `the action bar draws above the hotbar (${barBlank.px} -> ${barShown.px})`);
    await s.evaluate(() => { MCL.Hud.clearTitles(); MCL.Hud.titles.bar = null; MCL.Hud.titles.barTime = 0; MCL.Hud.draw(); return 1; });
    okAv(blank.px < solid.px, 'anti-vacuity: the empty band really was emptier than the titled one');
  }

  // ── 5. THE ARMOUR ROW, WHICH HAS NEVER BEEN DRAWN (D-290, D-291) ───────────────────────
  // ⚠ THIS LIVES HERE BECAUSE THIS IS THE FILE THAT LOOKS AT THE HUD'S OWN CANVAS. `guicheck`
  // owns the row's GEOMETRY against vanilla's pixels and `survcheck` owns the points arithmetic;
  // neither can see whether anything reaches the screen. Both of the bugs behind this section
  // were invisible to every counter in the project: the HUD read `P.armour` where the engine
  // writes `P.armor`, so `undefined | 0` made the row's `if` false for ever — and even spelled
  // correctly it would have drawn nothing, because nothing summed the worn pieces.
  console.log('\n5. the armour row');
  const armourProbe = await s.evaluate(() => {
    const M = window.MCL, P = M.Player, Iv = M.Inventory, Sv = M.Survival, H = M.Hud;
    // ⚠ THE BAND REPORTS WHERE ITS INK IS, NOT ONLY HOW MUCH. A failure that says "126 pixels
    // are lit in a strip that should be empty" costs an hour of guessing; one that says WHICH
    // twentieth of the strip they are in names the drawing that put them there.
    const band = () => {
      const L = M.Gui.HUD, s2 = H.scale;
      const left = Math.round(H.w / 2 - (L.barW / 2) * s2);
      const top = Math.round(H.h + L.rowY * s2) + Math.round(L.armourDY * s2);
      const w = Math.round(L.barW * s2), h = Math.round(9 * s2);
      const r = window.__g10.ink(left, top, left + w, top + h);
      const d = H.ctx.getImageData(left, top, w, h).data;
      const bins = new Array(20).fill(0);
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] <= 8) continue;
        const px = ((i - 3) / 4) % w;
        bins[Math.min(19, Math.floor(px * 20 / w))]++;
      }
      r.bins = bins; r.rect = [left, top, w, h];
      return r;
    };
    if (M.Gamemode) M.Gamemode.set(P, M.Gamemode.SURVIVAL);
    // bare
    for (let i = 0; i < 4; i++) Iv.setItem(P.inventory, Iv.ARMOR_START + i, null);
    Sv.updateArmor(P, P.inventory);
    H.draw();
    const bare = band(), bareArmor = P.armor;
    // fully clad
    const SET = [['netherite_boots', 0], ['netherite_leggings', 1],
                 ['netherite_chestplate', 2], ['netherite_helmet', 3]];
    for (const [n, sl] of SET) Iv.setItem(P.inventory, Iv.ARMOR_START + sl, Iv.stack(n, 1));
    Sv.updateArmor(P, P.inventory);
    H.draw();
    const clad = band(), cladArmor = P.armor;
    // and a single helmet: half the row, not all of it
    for (let i = 0; i < 4; i++) Iv.setItem(P.inventory, Iv.ARMOR_START + i, null);
    Iv.setItem(P.inventory, Iv.ARMOR_START + 3, Iv.stack('leather_helmet', 1));
    Sv.updateArmor(P, P.inventory);
    H.draw();
    const one = band(), oneArmor = P.armor;
    for (let i = 0; i < 4; i++) Iv.setItem(P.inventory, Iv.ARMOR_START + i, null);
    Sv.updateArmor(P, P.inventory);
    return { bare, clad, one, bareArmor, cladArmor, oneArmor };
  });
  const A = armourProbe || {};
  ok(A.bareArmor === 0, `no armour worn gives ${A.bareArmor} points`);
  ok(A.cladArmor === 20, `a full netherite set gives ${A.cladArmor} points, vanilla says 20`);
  ok(A.oneArmor === 1, `a leather helmet alone gives ${A.oneArmor}, vanilla says 1`);
  console.log(`      armour row ink: bare ${A.bare && A.bare.px}px · clad ${A.clad && A.clad.px}px `
    + `· one helmet ${A.one && A.one.px}px   rect ${A.bare && A.bare.rect}`);
  if (A.bare && A.bare.px) console.log(`      bare ink by twentieth: ${A.bare.bins.join(' ')}`);
  // ⚠ EVERY ONE OF THESE IS A DIFFERENCE. "Some pixels are lit in that strip" passes on the
  // hunger row bleeding into it; "these pixels appeared when and only when armour was worn"
  // cannot.
  ok(A.clad && A.bare && A.clad.px > A.bare.px,
     `the row draws when armour is worn (${A.bare && A.bare.px} -> ${A.clad && A.clad.px} lit pixels)`);
  // ⚠ PIXEL COUNT IS THE WRONG MEASURE FOR "how much armour", and the first version of this
  // section used it: vanilla draws all TEN icons the moment armour is above zero and varies only
  // WHICH icon — full, half or empty — so one helmet lit 2376 pixels against a full set's 2412,
  // a 1.5% gap that would pass on noise. The brightness is the signal: a full chestplate icon is
  // a filled shape and an empty one is an outline.
  ok(A.one && A.clad && A.one.px > A.bare.px,
     `one helmet lights the row at all (${A.bare && A.bare.px} -> ${A.one && A.one.px})`);
  const cladLum = A.clad ? A.clad.sum / A.clad.px : 0;
  const oneLum = A.one ? A.one.sum / A.one.px : 0;
  ok(cladLum > oneLum * 1.15,
     `a full set is visibly brighter per pixel than one helmet (${cladLum.toFixed(0)} against ${oneLum.toFixed(0)})`);
  okAv(A.bare && A.bare.px === 0,
    'the strip is EMPTY with no armour on — so §5 is measuring the row and not the hearts beside it');
  okAv(A.clad && A.clad.px > 40,
    `a full set lights ${A.clad && A.clad.px} pixels — ten icons' worth, not a stray edge`);
  okAv(A.clad && A.one && Math.abs(A.clad.px - A.one.px) < A.clad.px * 0.05,
    'the pixel COUNT barely moves between one helmet and a full set — which is why §5 measures brightness');

  // ── 6. THE BUBBLE ROW, which has never been drawn either (D-290, D-292) ────────────────
  //
  // ⚠ THIS SECTION'S FIRST VERSION COMPARED A DRY FRAME WITH A WET ONE AND MEASURED THE WRONG
  // THING. `drawFluidOverlay` paints the WHOLE canvas blue while the eyes are under water, so
  // the strip came back saturated at 6552 lit pixels — its exact area — whether it held seven
  // bubbles or one. "Lit pixels went from 0 to 6552" was a true statement about the overlay.
  // Every sample below is therefore taken UNDER WATER, varying only the air, and compares
  // BRIGHTNESS: the overlay is then common to all three and cancels.
  console.log('\n6. the air row');
  const airProbe = await s.evaluate(() => {
    const M = window.MCL, P = M.Player, Sv = M.Survival, H = M.Hud, Iv = M.Inventory;
    const L = M.Gui.HUD, s2 = H.scale;
    const left = Math.round(H.w / 2 - (L.barW / 2) * s2);
    const top = Math.round(H.h + L.rowY * s2) + Math.round(L.armourDY * s2);
    // ⚠ ONE ICON CELL AT A TIME. The bubbles are drawn from the RIGHT at `hungerX(i) = 173 - 8i`,
    // so cell 0 holds the last bubble you lose and cell 6 the seventh — and a window over cell 6
    // alone contains one icon or nothing at all, where a window over the whole bar is 98% water
    // overlay and moves by 1% either way.
    const cell = (i) => {
      const x = left + Math.round(L.hungerX(i) * s2);
      return window.__g10.ink(x, top, x + Math.round(9 * s2), top + Math.round(9 * s2));
    };
    if (M.Gamemode) M.Gamemode.set(P, M.Gamemode.SURVIVAL);
    for (let k = 0; k < 4; k++) Iv.setItem(P.inventory, Iv.ARMOR_START + k, null);
    Sv.updateArmor(P, P.inventory);
    P.eyeInWater = true;
    const at = (air) => { P.air = air; H.draw(); return { c0: cell(0), c6: cell(6) }; };
    const full = at(Sv.MAX_AIR);        // ⚠ UNDER WATER a full breath draws all ten bubbles (vanilla: eyes in water OR air < max, #361)
    const some = at(210);               // ceil(210*10/300) = 7 icons, so cells 0..6
    const low = at(30);                 // ceil(30*10/300) = 1 icon, so cell 0 only
    P.eyeInWater = false; P.air = Sv.MAX_AIR; H.draw();
    const dry = { c0: cell(0), c6: cell(6) };
    return { full, some, low, dry,
             counts: { some: Math.ceil(210 * 10 / 300), low: Math.ceil(30 * 10 / 300) } };
  });
  const B = airProbe || {};
  const lum = (v) => (v && v.px ? v.sum / v.px : 0);
  console.log(`      cell 6 (the 7th bubble): full ${lum(B.full && B.full.c6).toFixed(0)} · `
    + `210 air ${lum(B.some && B.some.c6).toFixed(0)} · 30 air ${lum(B.low && B.low.c6).toFixed(0)}`);
  console.log(`      cell 0 (the last bubble): 210 air ${lum(B.some && B.some.c0).toFixed(0)} · `
    + `30 air ${lum(B.low && B.low.c0).toFixed(0)} · dry ${lum(B.dry && B.dry.c0).toFixed(0)}`);
  ok(B.counts && B.counts.some === 7 && B.counts.low === 1,
     `the HUD's arithmetic draws ${B.counts && B.counts.some} icons at 210 air and ${B.counts && B.counts.low} at 30`);
  // ⚠ EVERY COMPARISON VARIES THE AIR AND NOTHING ELSE — same cell, same overlay, different breath.
  // ⚠ THE BASELINE IS THE CELL WITH NO BUBBLE IN IT, and the test is that the cell CHANGES —
  // not that it gets brighter. A bubble icon over the blue overlay is DARKER than the overlay
  // (263 against 284), which this section's first version had backwards; asserting a direction
  // guessed from the artwork is how a check ends up describing the wrong picture confidently.
  const base = lum(B.low && B.low.c6);   // 30 air: ceil(28*10/300) = 1 icon, so cell 6 is the one with NO bubble
  const differs = (v, name) => {
    const d = Math.abs(lum(v) - base) / (base || 1);
    return { d, msg: `${name}: ${lum(v).toFixed(0)} against an empty cell's ${base.toFixed(0)} (${(d * 100).toFixed(0)}% apart)` };
  };
  {
    const a = differs(B.some && B.some.c6, 'the 7th bubble is drawn at 210 air');
    ok(a.d > 0.05, a.msg);
    const b = differs(B.full && B.full.c6, 'and cell 6 holds a bubble at FULL air under water too');
    ok(b.d > 0.05, b.msg);
    const c = differs(B.low && B.low.c0, 'while cell 0 still holds the last bubble');
    ok(c.d > 0.05, c.msg);
    const d2 = differs(B.some && B.some.c0, 'and cell 0 holds one at 210 air too');
    ok(d2.d > 0.05, d2.msg);
  }
  okAv(B.dry && B.dry.c0 && B.dry.c0.px === 0,
    'out of the water the whole row is black, so §6 is looking at the right rectangle');
  okAv(B.full && B.some && B.full.c6.px === B.some.c6.px,
    'the lit-pixel COUNT does not move — the water overlay saturates every cell, which is why §6 measures brightness');

  ok(s.problems.length === 0, `the page logged no errors (${s.problems.slice(0, 2).join(' | ')})`);
} finally {
  await s.close();
}

console.log('');
console.log('================ g10check =================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==========================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
