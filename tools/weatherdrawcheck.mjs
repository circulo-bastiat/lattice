#!/usr/bin/env node
// weatherdrawcheck.mjs — PLAN G20 weather (D-655), the BROWSER half of weathercheck: with the rain
// ramp held at 1, 09c_weather.js's pass must actually put streaks in the picture (the same frame
// with the pass stubbed out differs), and with the ramp at 0 it must draw nothing at all.
// Run at MCLITE_PRESET=medium (D-196). Natural spawning held off (D-397).
import { resolve } from 'node:path';
import { open, sleep } from './cdp.mjs';
import { decodePng, pixelAt } from './pngdec.mjs';

const FILE = resolve(process.argv[2] || 'dist/mclite.html');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   ✗ ' + m); } };

const page = await open(FILE, { port: 9431, width: 800, height: 500 });
if (!page) { console.log('weatherdrawcheck: SKIP — no Chromium on this machine (cdp.mjs found none)'); process.exit(0); }
const shoot = async () => decodePng(Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const diff = (a, b) => { let n = 0; for (let y = 0; y < a.height; y += 2) for (let x = 0; x < a.width; x += 2) if (pixelAt(a, x, y) !== pixelAt(b, x, y)) n++; return n; };

console.log('weatherdrawcheck — G20, rain streaks in the picture (09c_weather.js)');
try {
  await sleep(1500);
  await page.evaluate(() => { if (MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play(4242); return 1; });
  const up = await page.waitFor(() => (MCL.Hud && MCL.Hud.mode === 'game' && MCL.Gfx && MCL.Gfx.draws > 10 && MCL.Sky && MCL.Weather) ? 1 : 0, 90000);
  ok(!!up, 'the world came up with NS.Weather loaded');
  await sleep(4000);
  const where = await page.evaluate(() => {
    if (MCL.Spawn) MCL.Spawn.ready = false;
    const P = MCL.Player, S = MCL.Sky, W = MCL.World, B = MCL.Biomes;
    document.getElementById('ui').style.display = 'none';
    S.daylightCycle = false; S.weatherCycle = false; S.dayTime = 6000;
    if (!S.weather) S.weather = S.newWeather();
    // find a raining column near spawn (a warm biome with precipitation)
    let px = Math.floor(P.x), pz = Math.floor(P.z), found = null;
    for (let r = 0; r < 64 && !found; r += 4) for (let a = 0; a < 8 && !found; a++) {
      const x = px + Math.round(r * Math.cos(a)), z = pz + Math.round(r * Math.sin(a));
      const b = W.biomeAt(x, z);
      if (B.precipitation(b) !== 0 && B.warmEnoughToRain(b, x, W.heightAt(x, z) + 1, z)) found = [x, z];
    }
    if (!found) return null;
    P.mode = 'creative'; P.flying = true; P.onGround = false;
    P.x = found[0] + 0.5; P.z = found[1] + 0.5; P.y = W.heightAt(found[0], found[1]) + 3; P.vy = 0;
    P.px = P.x; P.py = P.y; P.pz = P.z; P.pitch = 0; P.yaw = 0; P.interpolate(1);
    return found;
  });
  ok(!!where, 'a warm, precipitating column exists near spawn (seed 4242)');
  const setRain = (v) => page.evaluate(new Function(`const w = MCL.Sky.weather; w.raining = ${v > 0}; w.rainLevel = ${v}; w.oRainLevel = ${v};
    w.thundering = false; w.thunderLevel = 0; w.oThunderLevel = 0; return 1;`));
  const hold = () => page.evaluate(() => { const P = MCL.Player; P.vy = 0; P.px = P.x; P.py = P.y; P.pz = P.z; return 1; });

  // #2100: the assertions below say Fancy (100 tries); the preset may have Fast leaves, which halves the gradient (25 tries)
  await page.evaluate(() => { MCL.Settings.fancyLeaves = true; return 1; });
  await setRain(1); await hold(); await sleep(2500);
  const st = await page.evaluate(() => ({ q: MCL.Weather.drawnQuads, cols: MCL.Weather.lastColumns, gl: MCL.Weather.glError || MCL.Weather.gpuError || null, name: MCL.Gfx.name }));
  ok(!st.gl, `the weather pass compiled on ${st.name} (${st.gl || 'no error'})`);
  ok(st.q > 50, `raining: the pass drew ${st.q} quads over ${st.cols} columns (> 50)`);
  // D-656: the splashes (WorldRenderer.tickRainSplashing) — live, ticking, and drawable
  const sp = await page.evaluate(() => {
    const L = MCL.Weather.lastSplash, rain = MCL.Particle.list.filter((p) => p.type === 'rain');
    return { tries: L ? L.tries : -1, spawned: L ? L.spawns.length : -1, live: rain.length,
             layer: rain.length ? MCL.Particle.frameLayer(rain[0]) : -2 };
  });
  ok(sp.tries === 100, `raining on Fancy: tickRainSplashing makes its 100 tries a tick (got ${sp.tries})`);
  ok(sp.live > 0, `rain splash particles are alive in the particle list (${sp.live}; last tick spawned ${sp.spawned})`);
  ok(sp.layer >= 0, `a splash resolves to one of rain.json's frames in the particle atlas (layer ${sp.layer})`);
  // G20: the streak fog is the world shader's term: a streak at distance d is mixed to the fog colour by clamp((d-near)/max(1,far-near))
  const fg = await page.evaluate(() => {
    const W = MCL.Weather, f = W.lastFog; if (!f) return null;
    const c = [0.8, 0.8, 0.8], fc = [f.r, f.g, f.b], far = f.far, near = f.near;
    const at = (d) => W.fogMix(c, fc, W.fogFactor(d, near, far));
    const zero = (d) => W.fogMix(c, fc, W.fogFactor(d, 1e9, 2e9));
    return { near, far, fc, mid: at((near + far) / 2), wall: at(far), close: at(0), zmid: zero((near + far) / 2) };
  });
  ok(!!fg && fg.far > fg.near, `the weather pass uploaded the fog range (${fg && fg.near}..${fg && fg.far})`);
  if (fg) {
    const near3 = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
    ok(near3(fg.wall, fg.fc), 'a streak at the fog wall is exactly the fog colour');
    ok(near3(fg.close, [0.8, 0.8, 0.8]), 'a streak inside fogNear is unfogged');
    const half = fg.fc.map((v) => 0.8 + (v - 0.8) * 0.5);
    const exp = fg.fc.every((v) => Math.abs(v - 0.8) < 1e-6) || near3(fg.mid, half);
    ok(exp, 'a streak half way through the fog band is the half mix');
    okAv(fg.fc.every((v) => Math.abs(v - 0.8) < 1e-6) || !near3(fg.zmid, half), 'zero fog (range pushed away) breaks the half-mix assertion');
  }
  // same frame state, with and without the pass — only the streaks can differ
  await page.evaluate(() => { MCL.Weather._render = MCL.Weather.render; return 1; });
  const withRain = await shoot();
  await page.evaluate(() => { MCL.Weather.render = function () { MCL.Weather.drawnQuads = 0; }; return 1; });
  await sleep(700);
  const noPass = await shoot();
  const stubQ = await page.evaluate(() => MCL.Weather.drawnQuads);
  okAv(stubQ === 0 && st.q > 50, `the quad counter sees a stubbed pass as drawing nothing (${stubQ}) where the real one drew ${st.q}`);
  await page.evaluate(() => { MCL.Weather.render = MCL.Weather._render; return 1; });
  const d = diff(withRain, noPass);
  ok(d > 200, `the streaks change the picture: ${d} sampled pixels differ with the pass on vs stubbed (> 200)`);
  // the other direction: ramp 0 → nothing drawn, and the pass is a no-op on the picture
  await setRain(0); await sleep(1500);
  // #2100: the splash particles fade by game ticks, and the hosted software renderer ticks slowly, so a fixed sleep left ~500 of them
  // drifting into the first clear pair (2407 px vs a settled 17). Wait, bounded, until none are alive before any clear-sky shot.
  for (let i = 0; i < 40; i++) {
    const live = await page.evaluate(() => MCL.Particle.list.filter((p) => p.type === 'rain').length);
    if (live === 0) break;
    await sleep(500);
  }
  const st0 = await page.evaluate(() => MCL.Weather.drawnQuads);
  ok(st0 === 0, `clear sky: the pass draws nothing (${st0} quads)`);
  const sp0 = await page.evaluate(() => (MCL.Weather.lastSplash ? MCL.Weather.lastSplash.tries : -1));
  ok(sp0 === 0, `clear sky: no splash tries (${sp0})`);
  const clearA = await shoot();
  await page.evaluate(() => { MCL.Weather.render = function () { MCL.Weather.drawnQuads = 0; }; return 1; });
  await sleep(700);
  const clearB = await shoot();
  await page.evaluate(() => { MCL.Weather.render = MCL.Weather._render; return 1; });
  const d0 = diff(clearA, clearB);
  // the clear picture drifts by itself (clouds, water, fading splashes): the baseline is two live frames the same 700 ms apart
  const clearC = await shoot(); await sleep(700); const clearD = await shoot();
  const drift = diff(clearC, clearD);
  ok(d0 <= drift + 200, `clear sky: stubbing the pass changes nothing beyond the picture's own drift (${d0} px vs ${drift} drift, ${d} while raining)`);
  okAv(d > 200 && d > d0 - drift, 'the pixel diff is able to see the pass at all (raining diff dwarfs the clear diff)');
} catch (err) {
  fails.push('threw: ' + (err && err.stack || err));
} finally {
  await page.close();
}
console.log('');
if (fails.length) { console.log(`FAIL  weatherdrawcheck — ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const f of fails) console.log('   x ' + f); process.exit(1); }
console.log(`PASS  weatherdrawcheck — ${pass} assertions, 0 failures, ${breaks} breaks caught`);
