#!/usr/bin/env node
// spawnerdraw.mjs — #6337 (Spawn.OWED row 1): THE SPAWNER'S SPINNING MINIATURE MOB IS ON THE SCREEN.
//
//   MCLITE_PRESET=medium node tools/spawnerdraw.mjs [dist/mclite.html]
//
// Vanilla MobSpawnerBlockEntityRenderer.render: rotateY(lerp(prev,rot)*10), offset .5/.4/.5, scale .53125.
// `ER.spawnerPoseOf` builds it; until now no browser had watched it. Same shape as spritecheck: enter through
// the game, place a zombie spawner in front of the camera, and grade pixels against a CONTROL (the same view with
// the mob draw disabled), because two live frames are never identical (D-234). Anti-vacuity: with the draw
// disabled the assertions must fail.
import { open, sleep } from './cdp.mjs';
import { decodePng, toRgba } from './pngdec.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   x ' + m); } };

// pixels differing between two frames inside the central box (the cage is placed on the view axis)
function diffBox(a, b, box) {
  let n = 0;
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
    const i = (y * a.width + x) * 4;
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (d > 24) n++;
  }
  return n;
}

const page = await open(FILE, {
  port: 9442, width: 960, height: 540,
  initScript: 'window.addEventListener("load", function () { setTimeout(function () {' +
    ' if (window.MCL && MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; } }, 50); });',
});
if (!page) { console.log('SKIP  spawnerdraw: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await page.evaluate(function () {
    if (MCL.Spawn) MCL.Spawn.ready = false;
    if (MCL.EntityList) MCL.EntityList.clear();
    // the cage's flame/smoke particles are a second moving thing in the box: hold them off, grade the mob alone
    if (MCL.Particle) { MCL.Particle.spawn = function () {}; if (MCL.Particle.clear) MCL.Particle.clear(); }
    window.__realDisplays = MCL.EntityRender.spawnerDisplays;
  });
  await sleep(6000);

  const shot = async () => {
    const s = await page.send('Page.captureScreenshot', { format: 'png' });
    return toRgba(decodePng(Buffer.from(s.data, 'base64')));
  };
  const ev = (src) => page.evaluate(new Function(src));
  const frames = (n) => page.waitFor(new Function(
    'if (window.__fb === undefined) { window.__fb = MCL.Main.frame | 0; return 0; }' +
    'if (((MCL.Main.frame | 0) - window.__fb) < ' + n + ') return 0;' +
    'window.__fb = undefined; return 1;'), 20000);

  // a zombie spawner 2 blocks ahead of the eye, with air around it so the cage box is the view centre
  const placed = await ev(
    'var P = MCL.Player, f; P.pitch = 0; if (P.interpolate) P.interpolate(1); f = P.lookVec();' +
    'var eye = P.y + (P.eyeHeight === undefined ? 1.62 : P.eyeHeight);' +
    'var x = Math.floor(P.x + f[0] * 2.5), y = Math.floor(eye - 0.5), z = Math.floor(P.z + f[2] * 2.5);' +
    'MCL.World.setBlock(x, y, z, MCL.States.stateOf("spawner")); var ok = MCL.Spawner.assign(x, y, z, "zombie"); var e = MCL.BlockEntities.get(x, y, z);' +
    'window.__sp = e; return { ok: ok, type: e && e.type, entity: e && e.entity };');
  ok(placed && placed.ok && placed.type === 'mob_spawner' && placed.entity === 'zombie', 'a zombie spawner entity is in front of the camera', JSON.stringify(placed));

  const pose = (deg) => ev('var e = window.__sp; e.spinO = e.spin = ' + deg / 10 + '; return 1;');
  const box = { x0: 330, x1: 630, y0: 120, y1: 420 };
  const take = async (deg) => { await pose(deg); await frames(1); await pose(deg); return shot(); };

  await ev('var P = MCL.Player; P.vx = P.vy = P.vz = 0; P.yawRate = 0; return 1;');
  await frames(90);   // let the new cage block mesh and the chunk settle before any control is taken
  await ev('MCL.EntityRender.spawnerDisplays = function () { return []; }; return 1;');
  const ctlA = await take(0), ctlB = await take(0);
  const control = diffBox(ctlA, ctlB, box);
  await ev('MCL.EntityRender.spawnerDisplays = window.__realDisplays; return 1;');
  const f0 = await take(0), f90 = await take(90);
  const drawn = diffBox(ctlA, f0, box);
  const rot = diffBox(f0, f90, box);
  console.log('      control ' + control + ' px, mob vs no-mob ' + drawn + ' px, rotated ' + rot + ' px');
  ok(drawn > control + 200, 'mob-coloured pixels exist inside the cage box (vs the draw-disabled control)');
  ok(rot > control + 200, 'and they move when the spinner turns 90 degrees');

  // anti-vacuity: the same two measurements with the draw disabled must fail
  await ev('MCL.EntityRender.spawnerDisplays = function () { return []; }; return 1;');
  const d0 = await take(0), d90 = await take(90);
  okAv(!(diffBox(ctlA, d0, box) > control + 200), 'draw disabled: no extra pixels in the cage box');
  okAv(!(diffBox(d0, d90, box) > control + 200), 'draw disabled: nothing rotates');
} catch (e) {
  fails.push('threw: ' + (e && e.message));
  console.log('FAIL  threw: ' + (e && e.stack || e));
} finally {
  try { await page.close(); } catch (e) {}
}
console.log(' spawnerdraw: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
