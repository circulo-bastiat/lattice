#!/usr/bin/env node
// g11bcheck.mjs — PLAN G11b and G11c, the half a headless test cannot see: the CREATIVE SCREEN
// and the OPTIONS TREE, DRAWN.
//
// ⚠ IT IS NAMED FOR G11b AND §8 IS G11c's. A second browser stage that opened a second Chromium
// to look at the same canvas would cost forty seconds and prove the same thing (D-281), which is
// the same argument that put G14's armour row in `g10check` §5.
//
//   node tools/g11bcheck.mjs [dist/mclite.html]
//   MCLITE_PRESET=medium node tools/g11bcheck.mjs
//
// ⚠ WHY THIS EXISTS ALONGSIDE `creativecheck`. That check proves the table, the page model and
// every coordinate against the sheet's own pixels — and every one of those assertions would still
// pass if `Hud.drawCreative` were never called, if `E` opened the wrong screen, if the tab strip
// drew at a scale of zero, or if `H.drawItem` returned early for every one of the 45 cells.
// NEXT.md's first standing lesson is that a check which never looks at the picture cannot see the
// world, and this screen is now LOAD-BEARING: D-312 deleted the starter kit, so a creative player
// who cannot open this has no way to obtain a single block.
//
// ⚠ EVERY ASSERTION IS A DIFFERENCE, NOT A THRESHOLD. "Some pixels are drawn" passes on any
// screen; "these pixels changed when and only when the tab changed" cannot.

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
// ⚠ `session.evaluate` TAKES A ZERO-ARGUMENT FUNCTION AND NOTHING ELSE. Passing a second value
// silently hands the page `undefined`, which comes back as a result object with no fields and
// blows up three lines later on `.sig` — so anything parameterised goes through `ev`, which
// builds the expression itself.
const ev = async (src) => {
  const r = await s.send('Runtime.evaluate', { expression: src, returnByValue: true });
  return r && r.result ? r.result.value : null;
};
const inkOf = (r) => 'window.__g11.ink(' + [r.x0, r.y0, r.x1, r.y1].join(',') + ')';
if (!s) {
  console.log('g11bcheck: SKIP — no Chromium on this machine (cdp.mjs found none)');
  process.exit(0);
}

try {
  await sleep(2000);
  await s.evaluate(() => { MCL.Main.play(1337); return 1; });
  const up = await s.waitFor(() => (MCL.Hud && MCL.Hud.mode === 'game'
    && MCL.Player && MCL.Gfx && MCL.Gfx.cam) ? 1 : 0, 90000);
  if (!ok(!!up, 'the world came up')) throw new Error('no world');
  await sleep(4000);

  // ⚠ NO BACKTICKS ANYWHERE INSIDE THIS TEMPLATE. It is a template literal, and a backtick in a
  // comment inside it ends the string — twice this session that turned into a parse error with
  // no obvious cause (skyviewcheck, then backendcheck).
  const PROBE = `
    window.__g11 = {
      // the ink inside a rectangle of the HUD's own 2D canvas, and a coarse colour signature
      ink: function (x0, y0, x1, y1) {
        var H = MCL.Hud, c = H.ctx;
        x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
        x1 = Math.min(H.w, Math.round(x1)); y1 = Math.min(H.h, Math.round(y1));
        var d = c.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
        var n = 0, solid = 0, sig = 0;
        for (var i = 0; i < d.length; i += 4) {
          if (d[i + 3] > 8) { n++; sig = (sig * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; }
          // the dimming wash behind every modal screen is alpha 140, so "has any ink" is true of
          // the WHOLE canvas while a screen is open and cannot tell a panel from the sky behind
          // it. NEARLY OPAQUE can: only the sheets draw there.
          // WARNING: no backticks below. This is inside a template literal and one ends it.
          // 250, NOT 255. An opaque sheet composited over the 0.55 dim comes back at 252-255,
          // not 255 -- the browser's premultiplied-alpha round trip loses a bit -- so an exact
          // 255 counted 8,679 of 106,080 panel pixels and called a good panel missing.
          if (d[i + 3] >= 250) solid++;
        }
        return { px: n, solid: solid, sig: sig >>> 0 };
      },
      at: function (x, y) {
        var d = MCL.Hud.ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return [d[0], d[1], d[2], d[3]];
      },
      creative: function () { MCL.Gamemode.set(MCL.Player, MCL.Gamemode.CREATIVE); return MCL.Player.instabuild; },
      survival: function () { MCL.Gamemode.set(MCL.Player, MCL.Gamemode.SURVIVAL); return MCL.Player.instabuild; },
      act: function (n) { MCL.Main.action(n); MCL.Hud.draw(); return MCL.Hud.screen; },
      tab: function (col) { MCL.Creative.setTab(col); MCL.Hud.draw(); return MCL.Creative.tab; },
      origin: function () { return MCL.Hud.creOrigin; },
      // the screen rectangle of one picker cell, in device pixels
      cell: function (k) {
        var C = MCL.Creative, o = MCL.Hud.creOrigin, p = C.cellXY(k);
        return { x0: o.x + p[0] * o.s, y0: o.y + p[1] * o.s,
                 x1: o.x + (p[0] + 16) * o.s, y1: o.y + (p[1] + 16) * o.s };
      },
      tabRect: function (col) {
        var C = MCL.Creative, o = MCL.Hud.creOrigin, r = C.tabRect(col);
        return { x0: o.x + r[0] * o.s, y0: o.y + r[1] * o.s,
                 x1: o.x + (r[0] + C.TAB_W) * o.s, y1: o.y + (r[1] + C.TAB_H) * o.s };
      },
      panel: function () {
        var C = MCL.Creative, o = MCL.Hud.creOrigin;
        return { x0: o.x, y0: o.y, x1: o.x + C.W * o.s, y1: o.y + C.H * o.s };
      },
      // a click at the centre of a picker cell, through the real click path
      clickCell: function (k, button, shift) {
        var r = window.__g11.cell(k), I = MCL.Input;
        if (shift) I.keys.ShiftLeft = true;
        MCL.Hud.click((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, button || 0);
        I.keys.ShiftLeft = false;
        MCL.Hud.draw();
        var m = MCL.Menu.getCarried(MCL.Player.menu);
        return m ? { name: MCL.Items.names[m.i], n: m.n } : null;
      },
      clickTab: function (col) {
        var r = window.__g11.tabRect(col);
        MCL.Hud.click((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 0);
        MCL.Hud.draw();
        return { tab: MCL.Creative.tab, screen: MCL.Hud.screen };
      },
      shiftClickCell: function (k) {
        var I = MCL.Input;
        I.keys.ShiftLeft = true;
        var r = window.__g11.cell(k);
        MCL.Hud.click((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 0);
        I.keys.ShiftLeft = false;
        MCL.Hud.draw();
        var m = MCL.Menu.getCarried(MCL.Player.menu);
        return m ? m.n : 0;
      },
      hotbarNames: function () {
        var out = [], P = MCL.Player;
        for (var i = 0; i < 9; i++) {
          var st = MCL.Inventory.getItem(P.inventory, i);
          out.push(MCL.Inventory.isEmpty(st) ? null : MCL.Items.names[st.i]);
        }
        return out;
      },
      mouse: function (x, y) { MCL.Input.mx = x; MCL.Input.my = y; MCL.Hud.draw(); return 1; },
      // ── G10c, the block-entity item icons ───────────────────────────────────────────────
      beInk: function (name) {
        var cv = MCL.Hud.beCanvas(name, 48);
        if (!cv) return null;
        var d = cv.getContext('2d').getImageData(0, 0, 48, 48).data;
        var n = 0, sig = 0, r = 0, g = 0, b = 0;
        for (var i = 0; i < d.length; i += 4) {
          if (d[i + 3] > 24) { n++; r += d[i]; g += d[i + 1]; b += d[i + 2];
            sig = (sig * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; }
        }
        return { px: n, sig: sig >>> 0, r: n ? r / n : 0, g: n ? g / n : 0, b: n ? b / n : 0 };
      },
      // ⚠ loop/skull-item-icon: beInk above calls Hud.beCanvas DIRECTLY, which never
      // exercises the bug — the real hotbar/inventory path is Hud.drawItem, and it has its
      // own block-icon fallback BEFORE the block-entity one. drawItemInk goes through that
      // real path, on a real stack, so it can see the fallback ever winning wrongly.
      drawItemInk: function (name) {
        var IT = MCL.Items, H = MCL.Hud;
        var i = IT.of(name);
        if (i < 0) return null;
        var cv = document.createElement('canvas');
        cv.width = 32; cv.height = 32;
        var c = cv.getContext('2d');
        H.drawItem(c, { i: i, n: 1, d: 0 }, 0, 0, 32);
        var d = c.getImageData(0, 0, 32, 32).data;
        var lit = 0;
        for (var p = 3; p < d.length; p += 4) if (d[p] > 8) lit++;
        var cIdx = (16 * 32 + 16) * 4, kIdx = 0;   // centre pixel, and the top-left corner
        return { name: name, lit: lit, cr: d[cIdx], cg: d[cIdx + 1], cb: d[cIdx + 2], ca: d[cIdx + 3],
                 cornerA: d[kIdx + 3] };
      },
      beCovered: function () {
        var IT = MCL.Items, BE = MCL.BEModel, out = { total: 0, drawn: 0, blank: [] };
        for (var i = 0; i < IT.count; i++) {
          var nm = IT.names[i];
          if (!BE.gui || BE.gui[nm] === undefined) continue;
          out.total++;
          var cv = MCL.Hud.beCanvas(nm, 32);
          if (cv) out.drawn++; else out.blank.push(nm);
        }
        return out;
      },
      // ── G11c, the options tree ──────────────────────────────────────────────────────────
      pause: function () {
        MCL.Options.open('pause');
        MCL.Hud.open('pause');
        MCL.Hud.draw();
        return MCL.Options.screen;
      },
      optScreen: function () { return MCL.Options.screen; },
      optHits: function () {
        return MCL.Options.hit.map(function (h) {
          return { x: h.x, y: h.y, w: h.w, h: h.h, label: h.label, t: h.row.t };
        });
      },
      optClick: function (label) {
        var hs = MCL.Options.hit;
        for (var i = 0; i < hs.length; i++) {
          var hl = hs[i].label; if (typeof hl !== "string") continue;
          if (hl === label || hl.indexOf(label) === 0) {
            MCL.Hud.click(hs[i].x + hs[i].w * 0.5, hs[i].y + hs[i].h * 0.5, 0);
            MCL.Hud.draw();
            return MCL.Options.screen;
          }
        }
        return null;
      },
      optDrag: function (label, frac) {
        var hs = MCL.Options.hit;
        for (var i = 0; i < hs.length; i++) {
          if (hs[i].label.indexOf(label) === 0) {
            MCL.Hud.click(hs[i].x + 2, hs[i].y + hs[i].h * 0.5, 0);
            MCL.Options.drag(hs[i].x + frac * hs[i].w);
            MCL.Options.release();
            MCL.Hud.draw();
            return MCL.Settings.fov;
          }
        }
        return null;
      },
      fontInk: function () {
        // how much of the screen is drawn in the BITMAP font: count pixels that are exactly one
        // of the font's own colours after the shadow pass. A browser font antialiases and would
        // not land on them.
        var H = MCL.Hud, d = H.ctx.getImageData(0, 0, H.w, H.h).data, n = 0;
        for (var i = 0; i < d.length; i += 4) {
          if (d[i + 3] > 200 && d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255) n++;
        }
        return n;
      }
    };
    1;`;
  await s.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });

  // ── 0. D-312: a NEW CREATIVE WORLD HAS AN EMPTY HOTBAR ──────────────────────────────────
  // ⚠ THIS IS THE ASSERTION THAT MAKES THE REST NECESSARY. If the starter kit were still there
  // the screen would be a convenience; with it gone, the screen is the only source of blocks.
  console.log('\n0. the starter kit is gone (D-312)');
  const hot0 = await s.evaluate(() => window.__g11.hotbarNames());
  ok(hot0.every((x) => x === null),
    `a fresh world's hotbar is empty: [${hot0.map((x) => x || '-').join(' ')}]`);

  // ── 1. E opens the creative screen in creative, and the inventory in survival ────────────
  console.log('\n1. E opens the right screen for the gamemode');
  await s.evaluate(() => window.__g11.survival());
  const surv = await s.evaluate(() => window.__g11.act('inventory'));
  ok(surv === 'inventory', `in survival E opens "${surv}"`);
  await s.evaluate(() => window.__g11.act('inventory'));
  await s.evaluate(() => window.__g11.creative());
  const crea = await s.evaluate(() => window.__g11.act('inventory'));
  ok(crea === 'creative', `in creative E opens "${crea}"`);
  const origin = await s.evaluate(() => window.__g11.origin());
  ok(origin && origin.s >= 2, `the panel has an origin and a scale (${origin ? origin.s : 0})`);

  // ── 2. the panel and the tab strip are actually DRAWN ────────────────────────────────────
  console.log('\n2. the screen reaches the canvas');
  const panel = await s.evaluate(() => window.__g11.panel());
  const inPanel = await s.evaluate(() => { const p = window.__g11.panel(); return window.__g11.ink(p.x0, p.y0, p.x1, p.y1); });
  const panelArea = Math.round((panel.x1 - panel.x0) * (panel.y1 - panel.y0));
  // ⚠ `solid`, NOT `px`. The modal dim is alpha 140 over the entire canvas, so "has ink" is
  // true of every rectangle on screen while this is open — the first version of this assertion
  // measured `px` and would have passed with no panel drawn at all.
  ok(inPanel.solid > panelArea * 0.9,
    `the panel is FULLY opaque over ${inPanel.solid} of ${panelArea} pixels (${inPanel.px} have any ink)`);
  // every one of the twelve tab buttons must have ink in it
  let tabsDrawn = 0;
  const tabSigs = [];
  for (let col = 0; col < 12; col++) {
    const r = await ev('(function(){var q=window.__g11.tabRect(' + col + ');'
      + 'return window.__g11.ink(q.x0,q.y0,q.x1,q.y1);})()');
    tabSigs.push(r.sig);
    if (r.px > 200) tabsDrawn++;
  }
  ok(tabsDrawn === 12, `${tabsDrawn} of the 12 tab buttons have ink in them`);
  // ⚠ AND THEY MUST NOT ALL BE THE SAME PICTURE. Twelve buttons drawn from one texture cell —
  // the failure an unresolved icon or a constant `sx` would produce — passes the count above.
  ok(new Set(tabSigs).size >= 11, `the 12 tabs are ${new Set(tabSigs).size} different pictures`);

  // ── 3. the 9x5 grid has items in it ─────────────────────────────────────────────────────
  console.log('\n3. the picker draws items');
  await s.evaluate(() => window.__g11.tab(0));
  const cellInk = [];
  for (let k = 0; k < 45; k++) {
    const r = await ev('(function(){var c=window.__g11.cell(' + k + ');'
      + 'return window.__g11.ink(c.x0,c.y0,c.x1,c.y1);})()');
    cellInk.push(r);
  }
  const filled = cellInk.filter((r) => r.px > 40).length;
  ok(filled === 45, `${filled} of the 45 cells on Building Blocks have an icon drawn in them`);
  ok(new Set(cellInk.map((r) => r.sig)).size >= 40,
    `the 45 icons are ${new Set(cellInk.map((r) => r.sig)).size} different pictures, not one repeated`);

  // ── 4. changing tabs changes the picture ────────────────────────────────────────────────
  console.log('\n4. the tabs show different things');
  const gridInk = async () => {
    const a = await s.evaluate(() => window.__g11.cell(0));
    const b = await s.evaluate(() => window.__g11.cell(44));
    return ev('window.__g11.ink(' + [a.x0, a.y0, b.x1, b.y1].join(',') + ')');
  };
  await s.evaluate(() => window.__g11.tab(0));
  const g0 = await gridInk();
  await s.evaluate(() => window.__g11.tab(9));          // combat
  const g9 = await gridInk();
  ok(g0.sig !== g9.sig, 'Building Blocks and Combat draw different grids');
  await s.evaluate(() => window.__g11.tab(0));
  const g0b = await gridInk();
  ok(g0b.sig === g0.sig, 'and coming back to Building Blocks draws the same grid again');

  // ── 5. clicking, through the real click path ────────────────────────────────────────────
  console.log('\n5. clicking gets you blocks');
  await s.evaluate(() => window.__g11.tab(0));
  const got = await s.evaluate(() => window.__g11.clickCell(0));
  ok(got && got.n === 1, `clicking the first cell carries ${got ? got.n + ' ' + got.name : 'nothing'} (vanilla: 1)`);
  const got2 = await s.evaluate(() => window.__g11.clickCell(0));
  ok(got2 && got2.n === 2, `a second click on the same item makes it ${got2 && got2.n} (+1)`);
  const got3 = await s.evaluate(() => window.__g11.clickCell(0, 2));
  ok(got3 && got3.n === 1, `a right click on the same item makes it ${got3 && got3.n} (-1)`);
  const got4 = await s.evaluate(() => window.__g11.clickCell(0, 0, true));
  const max0 = await s.evaluate(() => MCL.Items.maxStack(MCL.Creative.items()[0]));
  ok(got4 && got4.n === max0, `shift-click on the same item sets the cursor to the max stack (${got4 && got4.n}/${max0})`);
  await s.evaluate(() => MCL.Menu.setCarried(MCL.Player.menu, null));
  const got5 = await s.evaluate(() => window.__g11.clickCell(0, 0, true));
  ok(got5 && got5.n === max0, `shift-click with an empty cursor carries the max stack (${got5 && got5.n})`);
  await s.evaluate(() => MCL.Menu.setCarried(MCL.Player.menu, null));
  await s.evaluate(() => window.__g11.clickCell(0));
  // ⚠ the picker is also the bin — vanilla's rule
  const gone = await s.evaluate(() => window.__g11.clickCell(1));
  ok(gone === null, 'clicking the list again while carrying destroys the stack (vanilla has no trash slot)');
  const count = await s.evaluate(() => window.__g11.shiftClickCell(0));
  ok(count >= 64, `shift-clicking carries ${count} of it on the cursor`);
  await s.evaluate(() => MCL.Inventory.add(MCL.Player.inventory, MCL.Inventory.stack(MCL.Creative.items()[0], 64)));
  const hot1 = await s.evaluate(() => window.__g11.hotbarNames());
  ok(hot1.some((x) => x !== null),
    `and the hotbar now holds something: [${hot1.map((x) => x || '-').join(' ')}]`);
  // clicking a tab button switches tab; the survival tab is a tab of this screen (#553)
  const t = await s.evaluate(() => window.__g11.clickTab(9));
  ok(t.tab === 9 && t.screen === 'creative', `clicking the Combat button selects tab ${t.tab}`);
  const inv = await s.evaluate(() => window.__g11.clickTab(11));
  ok(inv.screen === 'creative' && inv.tab === 11, `clicking the Survival Inventory button stays on the creative screen, tab ${inv.tab}`);
  await s.evaluate(() => window.__g11.act('inventory'));
  await s.evaluate(() => window.__g11.act('inventory'));
  await s.evaluate(() => window.__g11.tab(0));

  // ── 6. the hover highlight, which is the only feedback a click has ───────────────────────
  console.log('\n6. the hover highlight');
  const c3 = await s.evaluate(() => window.__g11.cell(3));
  await s.evaluate(() => window.__g11.mouse(-500, -500));
  const cold = await ev(inkOf(c3));
  await ev('window.__g11.mouse(' + ((c3.x0 + c3.x1) / 2) + ',' + ((c3.y0 + c3.y1) / 2) + ')');
  const hot = await ev(inkOf(c3));
  ok(hot.sig !== cold.sig, 'the cell under the pointer is drawn differently from the same cell cold');
  // ⚠ ...and its NEIGHBOUR is not, or "different" would just mean "the frame moved". The
  // neighbour has to be the cell to the LEFT: the hovered item's name is drawn at pointer+10 and
  // lands squarely on the cell to the RIGHT, so cell 4 legitimately changes and testing it
  // asserted that the tooltip does not work.
  const c4 = await s.evaluate(() => window.__g11.cell(2));
  const nb = await ev(inkOf(c4));
  await s.evaluate(() => window.__g11.mouse(-500, -500));
  const nbCold = await ev(inkOf(c4));
  ok(nb.sig === nbCold.sig, 'the cell beside it is unchanged, so the highlight is one cell wide');

  // ── 7. anti-vacuity (D-30) ──────────────────────────────────────────────────────────────
  console.log('\n7. anti-vacuity — the measurements are broken and the breaks must be caught');
  {
    // ⚠ THE BREAK THAT CAUGHT THE ASSERTION ABOVE. A band of the canvas OUTSIDE the panel has as
    // much `px` as the panel does — the dim covers everything — and almost no `solid`. If §2 had
    // kept measuring `px` this is the number that would have made it vacuous.
    const p = await s.evaluate(() => window.__g11.panel());
    const band = await ev('window.__g11.ink(0,0,' + Math.round(p.x0 - 8) + ',' + Math.round(p.y1 - p.y0) + ')');
    okAv(band.solid < band.px * 0.05,
      `beside the panel ${band.px} pixels have ink and only ${band.solid} are opaque — the dim is not the panel`);
  }
  {
    // the screen closed: the panel rectangle must go dark
    const p = await s.evaluate(() => window.__g11.panel());
    await s.evaluate(() => { MCL.Hud.close(); MCL.Hud.draw(); return 1; });
    const shut = await ev(inkOf(p));
    okAv(shut.px < inPanel.px * 0.5,
      `closing the screen takes the panel off the HUD (${inPanel.px} px open -> ${shut.px} px shut)`);
    await s.evaluate(() => window.__g11.act('inventory'));
  }
  {
    // an empty cell draws no icon — the Saved Toolbars tab (#8145) puts a named paper on the diagonal of its empty rows
    // (cell 0 of row 0), so cells 1 and 2 are the empty ones and cell 0 must differ from them
    await s.evaluate(() => window.__g11.tab(4));
    const inkCell = (n) => ev('(() => { const c = window.__g11.cell(' + n + '); return window.__g11.ink(c.x0, c.y0, c.x1, c.y1); })()');
    const [r, bg, bg2] = [await inkCell(1), await inkCell(2), await inkCell(0)];
    okAv(r.sig === bg.sig && bg2.sig !== bg.sig,
      'the Saved Toolbars tab draws its named paper on the diagonal and nothing in the other cells of an empty row');
    await s.evaluate(() => window.__g11.tab(0));
  }
  {
    // ⚠ THE BLOCK ICONS ARE 3D RENDERS (D-311) AND THEY MUST NOT BE FLAT SQUARES. Counting ink
    // in the cell cannot tell: the panel's own slot interior is opaque underneath, so a full cell
    // is 1024 of 1024 pixels whatever is drawn on it — the first version of this break asserted
    // exactly that and failed against a perfectly good cube. What DOES tell is the CORNERS: a
    // block drawn at vanilla's [30, 225] leaves all four corners of its 16x16 bare, so a filled
    // cell's corner must still be the empty cell's slot grey.
    await s.evaluate(() => window.__g11.tab(4));       // the hotbar tab: cell 1 is empty
    const bare = await ev('window.__g11.at(window.__g11.cell(1).x0+1, window.__g11.cell(1).y0+1)');
    await s.evaluate(() => window.__g11.tab(0));       // building blocks: cell 0 is stone
    const corner = await ev('window.__g11.at(window.__g11.cell(0).x0+1, window.__g11.cell(0).y0+1)');
    const middle = await ev('window.__g11.at((window.__g11.cell(0).x0+window.__g11.cell(0).x1)/2,'
                          + '(window.__g11.cell(0).y0+window.__g11.cell(0).y1)/2)');
    okAv(corner.join(',') === bare.join(',') && middle.join(',') !== bare.join(','),
      'the icon leaves the cell CORNER bare and covers its middle — a cube at [30,225], not a '
      + 'flat square (corner ' + corner.join(',') + ' vs empty ' + bare.join(',')
      + ', middle ' + middle.join(',') + ')');
  }

  // ── 8. PLAN G11c — the options tree, drawn and walked ───────────────────────────────────
  console.log('\n8. the options tree (G11c)');
  await s.evaluate(() => window.__g11.act('inventory'));     // shut the creative screen
  const p0 = await s.evaluate(() => window.__g11.pause());
  ok(p0 === 'pause', `Escape opens the pause screen ("${p0}")`);
  let hits = await s.evaluate(() => window.__g11.optHits());
  ok(hits.length >= 3, `the pause screen has ${hits.length} clickable widgets`);
  ok(hits.some((h) => h.label === 'Options...'), 'one of them is Options...');
  // ⚠ THE BUTTONS ARE VANILLA SPRITES, so a button rectangle must be OPAQUE — the old screen's
  // translucent fills would not be, and neither would an empty rectangle.
  {
    const b = hits.filter((h) => h.label === 'Options...')[0];
    const ink = await ev(inkOf({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }));
    ok(ink.solid > b.w * b.h * 0.9,
       `the Options... button is opaque over ${ink.solid} of ${Math.round(b.w * b.h)} pixels`);
  }
  // walk down the tree and back
  const toOpts = await s.evaluate(() => window.__g11.optClick('Options...'));
  ok(toOpts === 'options', `clicking Options... goes to "${toOpts}"`);
  for (const [label, want] of [['Video Settings...', 'video'], ['Controls...', 'controls'],
                               ['Music & Sounds...', 'sound'], ['Language...', 'language']]) {
    const got = await s.evaluate(new Function('return window.__g11.optClick(' + JSON.stringify(label) + ')'));
    ok(got === want, `${label} opens "${got}"`);
    const back = await s.evaluate(() => window.__g11.optClick('Done'));
    ok(back === 'options', `...and Done comes back to "${back}" rather than closing everything`);
  }
  // ⚠ THE HOVER SPRITE MUST ACTUALLY CHANGE THE PICTURE. Three sprite rows in the texture prove
  // nothing about which one gets blitted.
  {
    hits = await s.evaluate(() => window.__g11.optHits());
    const b = hits.filter((h) => h.t !== 'slide')[0];
    await s.evaluate(() => window.__g11.mouse(-500, -500));
    const cold = await ev(inkOf({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }));
    await ev('window.__g11.mouse(' + (b.x + b.w / 2) + ',' + (b.y + b.h / 2) + ')');
    const warm = await ev(inkOf({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }));
    ok(cold.sig !== warm.sig, `"${b.label}" is drawn differently under the pointer`);
    await s.evaluate(() => window.__g11.mouse(-500, -500));
  }
  // the FOV slider, dragged with the real pointer path
  {
    const left = await s.evaluate(() => window.__g11.optDrag('FOV', 0.0));
    const right = await s.evaluate(() => window.__g11.optDrag('FOV', 1.0));
    ok(left === 30 && right === 110, `dragging the FOV slider end to end gives ${left} and ${right}`);
    await s.evaluate(() => window.__g11.optDrag('FOV', 0.5));
  }
  // ⚠ AND THE TEXT IS THE BITMAP FONT, which is the whole point of the replacement. Vanilla's
  // glyphs are pure white with a quarter-brightness shadow; the browser font antialiases and
  // lands on almost no exactly-255 pixels.
  {
    await s.evaluate(() => window.__g11.optClick('Done'));
    const white = await s.evaluate(() => window.__g11.fontInk());
    ok(white > 400, `${white} pure-white pixels on the pause screen — vanilla's bitmap glyphs`);
  }
  {
    // anti-vacuity: with the screen shut there is no menu text at all
    await s.evaluate(() => { MCL.Hud.close(); MCL.Hud.draw(); return 1; });
    const shut = await s.evaluate(() => window.__g11.fontInk());
    const open = await s.evaluate(() => { window.__g11.pause(); return window.__g11.fontInk(); });
    okAv(shut < open * 0.6, `closing the menu removes its glyphs (${open} open -> ${shut} shut)`);
    await s.evaluate(() => { MCL.Hud.close(); MCL.Hud.draw(); return 1; });
  }

  // ── 9. PLAN G10c — the sixty items that drew nothing ────────────────────────────────────
  console.log('\n9. the block-entity item icons (G10c)');
  {
    const cov = await s.evaluate(() => window.__g11.beCovered());
    ok(cov.total >= 55, `${cov.total} items have a builtin/entity model`);
    ok(cov.drawn >= 50, `${cov.drawn} of them now draw something (was 0)`);
    // ⚠ THE BOUND IS THE OWED LIST ITSELF, NOT A NUMBER. It was `<= 8` while seven items were
    // owed, so closing five of them (D-324) would have left four slots of silent headroom for a
    // regression to hide in. Tied to `BE.OWED.length` it tightens by itself every time one is
    // fixed, and it can never be satisfied by a blank nobody wrote down.
    const owedNow = await s.evaluate(() => MCL.BEModel.OWED.length);
    ok(cov.blank.length <= owedNow,
       `${cov.blank.length} still blank against ${owedNow} owed, and they are named: ${cov.blank.join(' ')}`);
    // ⚠ EVERY STILL-BLANK ITEM MUST BE ON `BE.OWED`. A blank slot nobody has written down is
    // exactly what this stage exists to stop coming back.
    const owed = await s.evaluate(() => MCL.BEModel.OWED);
    for (const n of cov.blank) ok(owed.indexOf(n) >= 0, `"${n}" is blank and is not in BE.OWED`);
  }
  {
    // ⚠ loop/skull-item-icon: `Hud.beCanvas` above proves the RIGHT PICTURE EXISTS. This
    // proves the HOTBAR/INVENTORY PATH (`Hud.drawItem`) ACTUALLY REACHES IT. Before the fix,
    // every builtin/entity BlockItem resolves a real placeable state (D-331), so `drawItem`'s
    // block-icon fallback ran first and "succeeded" by drawing the block's missing-texture
    // placeholder — a solid magenta/black square, every one of its 1024 pixels lit and its
    // corners opaque — and the correct block-entity picture two lines down never ran.
    const names = ['zombie_head', 'player_head', 'chest', 'red_banner'];
    for (const n of names) {
      const di = await ev('window.__g11.drawItemInk(' + JSON.stringify(n) + ')');
      ok(di && di.lit > 0 && di.lit < 32 * 32,
         `${n}'s hotbar icon (Hud.drawItem) is a real picture, not blank or a full square (${di ? di.lit : 'null'}/1024 lit)`);
      ok(di && di.cornerA === 0,
         `${n}'s hotbar icon corner is transparent, not the missing-texture placeholder (alpha ${di ? di.cornerA : 'null'})`);
    }
  }
  {
    // the four families each draw, and each draws something DIFFERENT
    const names = ['chest', 'ender_chest', 'red_bed', 'red_shulker_box', 'red_banner', 'shield'];
    const inks = {};
    for (const n of names) {
      inks[n] = await ev('window.__g11.beInk(' + JSON.stringify(n) + ')');
      ok(inks[n] && inks[n].px > 150, `${n} covers ${inks[n] ? inks[n].px : 0} pixels of its 48x48 icon`);
    }
    const sigs = names.map((n) => inks[n] && inks[n].sig);
    ok(new Set(sigs).size === names.length, `the six are ${new Set(sigs).size} different pictures`);
    // ⚠ A FLIPPED MODEL WITH THE WINDING NOT FLIPPED RENDERS INSIDE OUT — hollow, and much
    // emptier than a solid one. A shulker box is a closed box; it must cover most of its icon.
    ok(inks.red_shulker_box.px > 48 * 48 * 0.25,
       `the shulker box is solid, not hollow (${inks.red_shulker_box.px} of ${48 * 48})`);
  }
  {
    // ⚠ THE SIXTEEN BANNERS ARE ONE TEXTURE AND SIXTEEN TINTS, so they must differ in COLOUR and
    // agree in SHAPE. That is a stronger statement than "they are different pictures" and it is
    // the one that catches a tint that silently did nothing — which is what happened first.
    const red = await ev('window.__g11.beInk("red_banner")');
    const blue = await ev('window.__g11.beInk("blue_banner")');
    const white = await ev('window.__g11.beInk("white_banner")');
    ok(Math.abs(red.px - blue.px) <= 4, `red and blue banners are the same shape (${red.px} vs ${blue.px})`);
    ok(red.r > red.b + 20, `the red banner is red (${red.r.toFixed(0)},${red.g.toFixed(0)},${red.b.toFixed(0)})`);
    ok(blue.b > blue.r + 20, `the blue banner is blue (${blue.r.toFixed(0)},${blue.g.toFixed(0)},${blue.b.toFixed(0)})`);
    ok(white.r > 120 && Math.abs(white.r - white.b) < 30, `the white banner is white (${white.r.toFixed(0)})`);
  }
  {
    // ⚠ AND THE BEDS ARE SIXTEEN TEXTURES, so they differ in colour too — but by a different
    // mechanism, and asserting both is how a wiring mix-up between them is caught.
    const redBed = await ev('window.__g11.beInk("red_bed")');
    const blueBed = await ev('window.__g11.beInk("blue_bed")');
    ok(redBed.r > redBed.b + 15, `the red bed is red (${redBed.r.toFixed(0)},${redBed.b.toFixed(0)})`);
    ok(blueBed.b > blueBed.r + 15, `the blue bed is blue (${blueBed.r.toFixed(0)},${blueBed.b.toFixed(0)})`);
  }
  {
    // anti-vacuity: an ordinary item has no block-entity model at all
    const stone = await ev('window.__g11.beInk("stone")');
    okAv(stone === null, 'anti-vacuity: an ordinary item has no block-entity canvas, so beInk is not measuring the slot');
  }
  {
    // anti-vacuity: the tint really is what colours a banner
    const before = await ev('window.__g11.beInk("red_banner")');
    await s.evaluate(() => { MCL.BEModel.dye.red = 0xFFFFFF; return 1; });
    await s.evaluate(() => { MCL.Hud.beCanvas('__flush__', 1); return 1; });
    const after = await ev('(function(){'
      + 'var BE=MCL.BEModel,H=MCL.Hud;'
      + 'var buf=BE.render("banner","be_banner",48,{flip:true,rotX:30,rotY:20,tint:H.dyeTint("red")});'
      + 'var n=0,r=0,b=0;for(var i=0;i<buf.length;i+=4){if(buf[i+3]>24){n++;r+=buf[i];b+=buf[i+2];}}'
      + 'return {px:n,r:n?r/n:0,b:n?b/n:0};})()');
    okAv(after.r - after.b < before.r - before.b,
      `anti-vacuity: with red set to white the banner stops being red (r-b was `
      + `${(before.r - before.b).toFixed(0)}, now ${(after.r - after.b).toFixed(0)})`);
    await s.evaluate(() => { MCL.BEModel.dye.red = 0xB02E26; return 1; });
  }

  ok(s.problems.length === 0, `the page logged no errors (${s.problems.slice(0, 2).join(' | ')})`);
} finally {
  await s.close();
}

console.log('');
console.log('=============== g11bcheck =================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==========================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
