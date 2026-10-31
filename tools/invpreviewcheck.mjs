#!/usr/bin/env node
// invpreviewcheck.mjs -- #5785: InventoryScreen.drawEntity(x+51, y+75, 30, x+51-mx, y+75-50-my, player)
//
//   MCLITE_PRESET=medium node tools/invpreviewcheck.mjs [dist/mclite.html]
//
// Asserts (1) the preview pixels differ with the cursor left vs right, (2) the head/body yaw it used equal
// 180+atan(dx/40)*40 / *20 to 1e-6 and pitch -atan(dy/40)*20, (3) worn armour changes the preview, (4) the
// player's real yaw is unchanged afterwards. Anti-vacuity: cursor ignored; real yaw left modified.
import { open, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   x ' + m); } };

const page = await open(FILE, { port: 9448, width: 960, height: 540 });
if (!page) { console.log('SKIP  invpreviewcheck: no Chromium found'); process.exit(0); }
try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up')) throw new Error('never reached the game');

  await page.evaluate(new Function('window.__mode = 0;'));
  const run = async (mode) => {
    await page.evaluate(new Function('window.__mode = ' + mode + ';'));
    return page.evaluate(new Function(`
    var mode = window.__mode, H = MCL.Hud, P = MCL.Player, I = MCL.Inventory, IT = MCL.Items;
    // mode 1: cursor ignored (always the centre); mode 2: draw leaves the real yaw modified
    var oldDraw = H.drawEntityPreview;
    if (mode === 2) H.drawEntityPreview = function (c, e, x, y, size, mx, my, s) {
      var n = oldDraw.apply(this, arguments); P.yaw += 0.5; return n;
    };
    var cv = document.createElement('canvas'); cv.width = H.w; cv.height = H.h;
    var c = cv.getContext('2d'), out = { shots: [], lp: [] };
    var yaw0 = P.yaw, s = Math.max(2, H.scale);
    var ox = Math.round((H.w - MCL.Gui.INV.w * s) / 2), oy = Math.round((H.h - MCL.Gui.INV.h * s) / 2);
    function shot(mx, my) {
      MCL.Input.mx = mode === 1 ? ox + 51 * s : mx; MCL.Input.my = mode === 1 ? oy + 25 * s : my;
      c.clearRect(0, 0, H.w, H.h); H.drawInventory(c);
      out.lp.push(H.lastPreview);
      return Array.prototype.slice.call(c.getImageData(ox + 26 * s, oy + 8 * s, 50 * s, 70 * s).data);
    }
    out.shots.push(shot(ox - 100, oy + 40 * s));
    out.shots.push(shot(ox + H.w / 2 + 300, oy + 20 * s));
    out.mx = [ox - 100, ox + H.w / 2 + 300]; out.my = [oy + 40 * s, oy + 20 * s]; out.ox = ox; out.oy = oy; out.s = s;
    // armour: put iron chestplate + helmet on
    var a = I.ARMOR_START;
    P.inventory.slots[a + 3] = { i: IT.of('iron_helmet'), n: 1 };
    P.inventory.slots[a + 2] = { i: IT.of('iron_chestplate'), n: 1 };
    out.armour = shot(ox + 51 * s - 100, oy + 25 * s);
    P.inventory.slots[a + 3] = null; P.inventory.slots[a + 2] = null;
    out.bare = shot(ox + 51 * s - 100, oy + 25 * s);
    out.yawDelta = P.yaw - yaw0;
    P.yaw = yaw0; H.drawEntityPreview = oldDraw;
    return out;
  `));
  };
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) n++; return n; };

  const real = await run(0);
  if (real.err) throw new Error(real.err);
  const cursorDiff = diff(real.shots[0], real.shots[1]);
  ok(cursorDiff > 100, 'the preview pixels change with the cursor left vs right (' + cursorDiff + ' px)');
  let worst = 0;
  real.lp.slice(0, 2).forEach((lp, i) => {
    const dx = (real.ox + 51 * real.s - real.mx[i]) / real.s, dy = (real.oy + 75 * real.s - 50 * real.s - real.my[i]) / real.s;
    const f = Math.atan(dx / 40), g = Math.atan(dy / 40);
    worst = Math.max(worst, Math.abs(lp.headYaw - (180 + f * 40)), Math.abs(lp.bodyYaw - (180 + f * 20)), Math.abs(lp.pitch + g * 20));
  });
  ok(worst < 1e-6, 'head/body yaw and pitch match the formula (worst error ' + worst + ')');
  const armourDiff = diff(real.armour, real.bare);
  ok(armourDiff > 100, 'armour on the player appears in the preview (' + armourDiff + ' px)');
  ok(Math.abs(real.yawDelta) < 1e-9, 'the real yaw is unchanged afterwards (' + real.yawDelta + ')');

  const blind = await run(1);
  okAv(diff(blind.shots[0], blind.shots[1]) < 20, 'cursor ignored: the preview no longer follows it');
  const dirty = await run(2);
  okAv(Math.abs(dirty.yawDelta) > 1e-9, 'real yaw left modified: the yaw check sees it');
} catch (err) {
  fails.push('threw: ' + (err && err.message || err)); console.log('FAIL  ' + (err && err.message || err));
} finally { if (page.close) await page.close(); }
console.log(`\ninvpreviewcheck: ${pass} assertions, ${fails.length} failed, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
