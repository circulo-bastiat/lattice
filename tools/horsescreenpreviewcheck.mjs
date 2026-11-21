#!/usr/bin/env node
// horsescreenpreviewcheck.mjs -- #5908: HorseScreen.drawBackground -> InventoryScreen.drawEntity(x+51, y+60, 17, ...)
//
//   MCLITE_PRESET=medium node tools/horsescreenpreviewcheck.mjs [dist/mclite.html]
//
// Opens the horse screen on a horse wearing an iron horse armour, reads the 2D canvas the screen was drawn on
// and asserts (1) the entity box is not the panel colour, (2) the pixels move with the mouse (the animal turns
// to follow it). Anti-vacuity: with H.drawEntityPreview stubbed out the box must read as the bare panel and
// both claims must fail.
import { open, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   x ' + m); } };

const page = await open(FILE, { port: 9447, width: 960, height: 540 });
if (!page) { console.log('SKIP  horsescreenpreviewcheck: no Chromium found'); process.exit(0); }
try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up')) throw new Error('never reached the game');

  // page.evaluate takes a function; pass the flag through a global instead
  const go = async (stub) => {
    await page.evaluate(new Function('window.__stub = ' + (stub ? 1 : 0) + ';'));
    return page.evaluate(new Function(`
    var stub = window.__stub, H = MCL.Hud, EL = MCL.EntityList, P = MCL.Player;
    var e = EL.spawn('horse', P.x + 2, P.y, P.z, {});
    if (!e) return { err: 'no horse' };
    e.armorItem = 'iron_horse_armor'; e.saddled = true;
    if (!H.openHorse(e)) return { err: 'openHorse refused' };
    var old = H.drawEntityPreview;
    if (stub) H.drawEntityPreview = function () { return 0; };
    var cv = document.createElement('canvas'); cv.width = H.w; cv.height = H.h;
    var c = cv.getContext('2d');
    var out = { shots: [] }, mice = [[0, 0], [-150, 20], [150, -30]]; var o0 = H.horseOrigin || { x: Math.round((H.w - MCL.Gui.HORSE.w * Math.max(2, H.scale)) / 2), y: Math.round((H.h - MCL.Gui.HORSE.h * Math.max(2, H.scale)) / 2), s: Math.max(2, H.scale) }; mice[0] = [o0.x + 51 * o0.s - H.w / 2, o0.y + 25 * o0.s - H.h / 2];
    for (var i = 0; i < mice.length; i++) {
      MCL.Input.mx = H.w / 2 + mice[i][0]; MCL.Input.my = H.h / 2 + mice[i][1];
      c.clearRect(0, 0, H.w, H.h);
      H.drawHorse(c);
      var o = H.horseOrigin, s = o.s;
      var d = c.getImageData(o.x + 26 * s, o.y + 18 * s, 52 * s, 52 * s).data;
      out.shots.push(Array.prototype.slice.call(d));
    }
    H.drawEntityPreview = old;
    H.close();
    return out;
  `));
  };
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) n++; return n; };
  // pixels that are not the panel's own window colour (the first pixel of the stubbed box is that colour)
  const nonPanel = (a, ref) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - ref[0]) + Math.abs(a[i + 1] - ref[1]) + Math.abs(a[i + 2] - ref[2]) > 12) n++; return n; };

  const real = await go(false);
  const stub = await go(true);
  if (!ok(!real.err && !stub.err, 'the horse screen opened on a horse (' + (real.err || stub.err || 'ok') + ')')) throw new Error('no screen');
  // the panel colour is the stubbed box's commonest colour
  const hist = new Map(); const sa = stub.shots[0];
  for (let i = 0; i < sa.length; i += 4) { const k = sa[i] + ',' + sa[i + 1] + ',' + sa[i + 2]; hist.set(k, (hist.get(k) || 0) + 1); }
  const ref = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  if (process.env.DUMP) { const { writeFileSync } = await import('node:fs'); const n = Math.sqrt(sa.length / 4);
    real.shots.forEach((d, i) => writeFileSync(process.env.DUMP + i + '.ppm', Buffer.concat([Buffer.from('P6 ' + n + ' ' + n + ' 255\n'), Buffer.from(d.filter((_, j) => j % 4 < 3))]))); }
  const filled = nonPanel(real.shots[0], ref), moved = Math.max(diff(real.shots[0], real.shots[1]), diff(real.shots[0], real.shots[2]));
  console.log('      box pixels off the panel colour: ' + filled + ', changed by the mouse: ' + moved);
  okAv(nonPanel(stub.shots[0], ref) * 5 < filled, 'draw disabled: the box is near-empty vs the drawn one (' + nonPanel(stub.shots[0], ref) + ' vs ' + filled + ' px)');
  ok(filled > 300, 'the entity box is not empty (' + filled + ' px)');
  ok(moved > 100, 'the animal turns with the mouse (' + moved + ' px change)');
  okAv(diff(stub.shots[0], stub.shots[1]) < 20 && diff(stub.shots[0], stub.shots[2]) < 20, 'draw disabled: the mouse moves nothing');
} catch (err) {
  fails.push('threw: ' + (err && err.message || err)); console.log('FAIL  ' + (err && err.message || err));
} finally { if (page.close) await page.close(); }
console.log(`\nhorsescreenpreviewcheck: ${pass} assertions, ${fails.length} failed, ${breaks} breaks caught`);
for (const f of fails) console.log('  - ' + f);
process.exit(fails.length ? 1 : 0);
