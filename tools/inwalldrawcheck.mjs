#!/usr/bin/env node
// inwalldrawcheck.mjs — G17-O2b (#9242): the in-wall overlay, on a real screen, WebGL2 and WebGPU.
//   node tools/inwalldrawcheck.mjs [dist/mclite.html]
// Same camera, three scenes: eye in air (baseline), eye inside sandstone (sand itself falls out of the eye)stone (frame goes dark, near-uniform),
// eye inside glass (frame unchanged). Breaks: draw skipped, colour not scaled by 0.1.
import { open, sleep } from './cdp.mjs';
import { decodePng, toRgba } from './pngdec.mjs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } };
const okAv = (c, m, d) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m + (d !== undefined ? ' (' + d + ')' : '')); console.log('   x ' + m + (d !== undefined ? '   ' + d : '')); } };

function stats(img) {
  let sum = 0, n = 0;
  for (let i = 0; i < img.data.length; i += 4) { sum += img.data[i] + img.data[i + 1] + img.data[i + 2]; n += 3; }
  return sum / n;
}

async function run(backend, port) {
  console.log('\n== ' + backend);
  const page = await open(FILE, { port, width: 960, height: 540 });
  if (!page) { console.log('SKIP  inwalldrawcheck: no Chromium found'); return; }
  try {
    await sleep(1200);
    await page.evaluate(new Function('MCL.Gfx.force = ' + JSON.stringify(backend) + '; if (MCL.Main && !MCL.Main.ready) MCL.Main.play({});'));
    const up = await page.waitFor(new Function('return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === "game" && MCL.World.chunks.size > 20);'), 60000);
    ok(up, backend + ': the world came up', page.lastThrow);
    if (!up) return;
    const name = await page.evaluate(new Function('return MCL.Gfx.name;'));
    if (name !== backend) { console.log('SKIP  ' + backend + ': backend not available here (got ' + name + ')'); return; }
    await page.evaluate(new Function('if (MCL.Spawn) MCL.Spawn.ready = false; if (MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; } return 1;'));
    await sleep(2500);
    const ev = (src) => page.evaluate(new Function(src));
    const shot = async () => {
      await page.waitFor(new Function('if (window.__fb === undefined) { window.__fb = MCL.Main.frame | 0; return 0; } if (((MCL.Main.frame | 0) - window.__fb) < 6) return 0; window.__fb = undefined; return 1;'), 20000);
      const s = await page.send('Page.captureScreenshot', { format: 'png' });
      return toRgba(decodePng(Buffer.from(s.data, 'base64')));
    };
    // put the block at the eye AND one below: a suffocating player drops to the crawl pose (eye ~0.5 up from the feet)
    await ev('var P = MCL.Player; window.__eye = [Math.floor(P.x), Math.floor(P.y + (P.height || MCL.Physics.H) * MCL.Physics.EYE_FRACTION), Math.floor(P.z)]; return 1;');
    const setEye = (n) => ev('var e = window.__eye, S = MCL.States; var id = ' + (n === 'air' ? '0' : 'S.stateOf("' + n + '")') + '; MCL.World.setBlock(e[0], e[1], e[2], id, true); MCL.World.setBlock(e[0], e[1] - 1, e[2], id, true); return 1;');
    const off = async () => { await ev('window.__orig = window.__orig || MCL.Hud.drawInWall; MCL.Hud.drawInWall = function () {}; return 1;'); const v = stats(await shot()); await ev('MCL.Hud.drawInWall = window.__orig; return 1;'); return v; };
    const dark = (on, of) => on < 40 && on < of * 0.6;
    // same camera, same block: overlay on vs overlay off, so the pose change of a suffocating player cancels out
    await setEye('sandstone');
    ok(await ev('return !!MCL.Physics.inWallState(MCL.Player);'), backend + ': Physics.inWallState sees the sandstone');
    const sandOn = stats(await shot()), sandOff = await off();
    await setEye('glass');
    ok(!(await ev('return !!MCL.Physics.inWallState(MCL.Player);')), backend + ': Physics.inWallState ignores glass');
    const glassOn = stats(await shot()), glassOff = await off();
    console.log('   mean brightness on/off: sandstone ' + sandOn.toFixed(1) + '/' + sandOff.toFixed(1) + '  glass ' + glassOn.toFixed(1) + '/' + glassOff.toFixed(1));
    ok(dark(sandOn, sandOff), backend + ': inside sandstone the whole frame is dark (0.1 * sprite)', sandOn.toFixed(1) + ' vs off ' + sandOff.toFixed(1));
    ok(Math.abs(glassOn - glassOff) < 3, backend + ': inside glass the overlay changes nothing', glassOn.toFixed(1) + ' vs ' + glassOff.toFixed(1));

    // anti-vacuity: the dark test must fail when the draw is skipped or the colour is not scaled
    await setEye('sandstone');
    const skipped = await off();
    okAv(!dark(skipped, sandOff), backend + ': with the draw call skipped the dark test fails', skipped.toFixed(1));
    await ev('MCL.Hud.drawInWall = function (c) { c.fillStyle = "rgb(200,180,120)"; c.fillRect(0, 0, c.canvas.width, c.canvas.height); }; return 1;');
    const bright = stats(await shot());
    okAv(!dark(bright, sandOff), backend + ': with the colour not scaled by 0.1 the dark test fails', bright.toFixed(1));
    await ev('MCL.Hud.drawInWall = window.__orig; return 1;');
    okAv(dark(stats(await shot()), sandOff), backend + ': restoring the draw darkens it again');
    ok(page.problems.length === 0, backend + ': no page errors (' + page.problems.slice(0, 2).join(' | ') + ')');
  } catch (e) {
    fails.push('harness: ' + (e && e.message));
    console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
  } finally { await page.close(); }
}

await run('webgl2', 9461);
await run('webgpu', 9462);
console.log('\n inwalldrawcheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
