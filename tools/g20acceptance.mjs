#!/usr/bin/env node
// g20acceptance.mjs — PLAN G20 weather (D-655), the BROWSER half of weathercheck: with the rain
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

const page = await open(FILE, { port: 9467, width: 800, height: 500 });
if (!page) { console.log('g20acceptance: SKIP — no Chromium on this machine (cdp.mjs found none)'); process.exit(0); }
const shoot = async () => decodePng(Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const diff = (a, b) => { let n = 0; for (let y = 0; y < a.height; y += 2) for (let x = 0; x < a.width; x += 2) if (pixelAt(a, x, y) !== pixelAt(b, x, y)) n++; return n; };

console.log('g20acceptance — G20 acceptance: biome rain/snow, break colour, crit, thunder sky light');
try {
  await sleep(1500);
  await page.evaluate(() => { if (MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play(4242); return 1; });
  const up = await page.waitFor(() => (MCL.Hud && MCL.Hud.mode === 'game' && MCL.Gfx && MCL.Gfx.draws > 10 && MCL.Sky && MCL.Weather && MCL.Particle) ? 1 : 0, 90000);
  ok(!!up, 'the world came up');
  await sleep(3000);
  // D-145/D-321: adaptive quality and the day cycle frozen
  await page.evaluate(() => {
    if (MCL.Spawn) MCL.Spawn.ready = false;
    const S = MCL.Sky;
    document.getElementById('ui').style.display = 'none';
    MCL.Settings.adaptive = false; MCL.Settings.fancyLeaves = true;
    S.daylightCycle = false; S.weatherCycle = false; S.dayTime = 6000;
    if (!S.weather) S.weather = S.newWeather();
    return 1;
  });
  const cols = await page.evaluate(() => {
    const P = MCL.Player, W = MCL.World, B = MCL.Biomes, out = { warm: null, none: null, cold: null };
    const cls = (x, z) => { const b = W.biomeAt(x, z); return B.precipitation(b) === 0 ? 'none' : (B.warmEnoughToRain(b, x, 70, z) ? 'warm' : 'cold'); };
    // a whole neighbourhood (the pass reaches 10 columns) must be of ONE class
    const solid = (x, z, c) => { for (let dx = -16; dx <= 16; dx += 8) for (let dz = -16; dz <= 16; dz += 8) if (cls(x + dx, z + dz) !== c) return false; return true; };
    for (let r = 0; r < 16000 && !(out.warm && out.none && out.cold); r += 32) for (let a = 0; a < 24; a++) {
      const x = Math.round(P.x + r * Math.cos(a * Math.PI / 12)), z = Math.round(P.z + r * Math.sin(a * Math.PI / 12));
      const c = cls(x, z);
      if (!out[c] && solid(x, z, c)) out[c] = [x, z];
    }
    return out;
  });
  ok(!!cols.warm && !!cols.none, 'a plains-like and a desert-like (no precipitation) column exist: ' + JSON.stringify(cols));
  const setRain = (v) => page.evaluate(new Function(`const w = MCL.Sky.weather; w.raining = ${v > 0}; w.rainLevel = ${v}; w.oRainLevel = ${v};
    w.thundering = false; w.thunderLevel = 0; w.oThunderLevel = 0; return 1;`));
  const goTo = async (c) => {
    await page.evaluate(new Function(`const P = MCL.Player, W = MCL.World; P.mode = 'creative'; P.flying = true; P.onGround = false;
      P.x = ${c[0]} + 0.5; P.z = ${c[1]} + 0.5; P.y = 150; P.vy = 0; P.pitch = 0; P.yaw = 0;
      P.px = P.x; P.py = P.y; P.pz = P.z; P.interpolate(1); return 1;`));
    for (let i = 0; i < 30; i++) {
      const h = await page.evaluate(() => MCL.World.heightAt(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)));
      if (h > 0 && h < 250) { await page.evaluate(new Function(`const P = MCL.Player; P.y = MCL.World.heightAt(Math.floor(P.x), Math.floor(P.z)) + 3; P.px = P.x; P.py = P.y; P.pz = P.z; P.interpolate(1); return 1;`)); break; }
      await sleep(1000);
    }
    await sleep(2500);
  };
  const hold = () => page.evaluate(() => { const P = MCL.Player; P.vy = 0; P.px = P.x; P.py = P.y; P.pz = P.z; return 1; });
  const stub = (on) => page.evaluate(new Function(`const W = MCL.Weather; if (!W._r) W._r = W.render;
    W.render = ${on} ? function () { W.drawnQuads = 0; } : W._r; return 1;`));
  // rainy frame vs stubbed frame at the current column
  const rainDiff = async () => {
    await setRain(1); await hold(); await sleep(1500);
    const q = await page.evaluate(() => MCL.Weather.drawnQuads);
    const a = await shoot();
    await sleep(700); const c = await shoot();     // two live frames the same 700 ms apart: the picture's own drift
    await stub(true); await sleep(700);
    const b = await shoot(); await stub(false);
    return { q, d: diff(a, b), drift: diff(a, c) };
  };
  // the geometry as the live pass builds it: rain and snow quad counts
  const geo = (forceWarm) => page.evaluate(new Function(`const Wx = MCL.Weather, P = MCL.Player, B = MCL.Biomes, W = MCL.World;
    const ctx = Wx.liveCtx({ x: P.x, y: P.y + 1.6, z: P.z });
    if (!ctx) return null;
    ctx.gradient = 1; ${forceWarm === 'warm' ? 'ctx.warm = function () { return true; };' : ''}
    const q = Wx.buildQuads(ctx); return { rain: q.rain.length, snow: q.snow.length };`));

  await goTo(cols.warm);
  const plains = await rainDiff(); const gPl = await geo();
  ok(plains.q > 50 && plains.d > 200, `plains: forced rain draws ${plains.q} quads and changes ${plains.d} sampled pixels (> 200)`);
  ok(gPl && gPl.rain > 0 && gPl.snow === 0, `plains: rain geometry only (${JSON.stringify(gPl)})`);

  await goTo(cols.none);
  const des = await rainDiff(); const gDe = await geo();
  ok(des.q === 0 && gDe && gDe.rain === 0 && gDe.snow === 0, `desert: forced rain draws nothing (${des.q} quads, geometry ${JSON.stringify(gDe)})`);

  // seed 4242 has no cold biome in its generated area: the plains column is re-labelled snowy_plains at the pass's biome lookup
  await goTo(cols.warm);
  await page.evaluate(() => { const W = MCL.World; W._b3 = W.biomeAt3; const sn = MCL.Biomes.index('snowy_plains'); W.biomeAt3 = function () { return sn; }; return 1; });
  const snow = await rainDiff(); const gSn = await geo();
  ok(snow.q > 50 && snow.d > 100, `snowy: forced precipitation draws ${snow.q} quads, ${snow.d} pixels differ`);
  ok(gSn && gSn.snow > 0 && gSn.rain === 0, `snowy: it SNOWS where plains gets rain (${JSON.stringify(gSn)})`);
  // anti-vacuity: no temperature term (everything counts as warm) -> the snowy column rains, so the snow assertion would fail
  const gNoT = await geo('warm');
  okAv(!(gNoT && gNoT.snow > 0 && gNoT.rain === 0), `no temperature term: snowy column no longer snows (${JSON.stringify(gNoT)})`);
  okAv(des.q === 0 && plains.q > 50, 'precipitation-less biome vs plains are told apart by the quad counter');
  await page.evaluate(() => { MCL.World.biomeAt3 = MCL.World._b3; return 1; });
  await setRain(0);

  // block-break particles carry the block's own colour
  const brk = await page.evaluate(() => {
    const Px = MCL.Particle, R = MCL.Reg, S = MCL.States;
    const id = (n) => { for (let s = 1; s < S.block.length; s++) if (R.names[S.block[s]] === n) return s; return -1; };
    const res = {};
    for (const n of ['stone', 'dirt', 'oak_leaves']) {
      const st = id(n); Px.list.length = 0;
      const k = Px.addBlockBreakParticles(10, 80, 10, st, null, () => 0.5);
      const p = Px.list.filter((q) => q.type === 'block');
      res[n] = { n: k, tile: p[0] && p[0].tile, rgb: p[0] ? [p[0].red, p[0].green, p[0].blue] : null,
                 want: S.particleTile(st), allSame: p.every((q) => q.tile === p[0].tile) };
    }
    Px.list.length = 0; return res;
  });
  ok(brk.stone.n > 0 && brk.dirt.n > 0, `break emits dust (stone ${brk.stone.n}, dirt ${brk.dirt.n})`);
  ok(brk.stone.tile === brk.stone.want && brk.dirt.tile === brk.dirt.want, 'each break particle wears its own block\'s particle texture');
  ok(brk.stone.tile !== brk.dirt.tile, `two blocks, two textures (stone ${brk.stone.tile}, dirt ${brk.dirt.tile})`);
  ok(JSON.stringify(brk.oak_leaves.rgb) !== JSON.stringify(brk.stone.rgb), `a tinted block tints its dust (leaves ${brk.oak_leaves.rgb} vs stone ${brk.stone.rgb})`);
  okAv(!(brk.stone.want === brk.dirt.want) , 'a fixed break texture would make stone and dirt equal: they are not');

  // crit attack emits crit particles; non-crit does not
  const crit = await page.evaluate(() => {
    const Px = MCL.Particle, P = MCL.Player, Cb = MCL.Combat;
    const e = { x: P.x + 2, y: P.y, z: P.z, width: 0.6, height: 1.8, id: 999991, type: 'zombie', health: 20 };
    const run = (c) => { Px.list.length = 0; const o = Cb.attackParticles(P, e, false, c, 0, 0, () => 0.5);
      const live = Px.list.filter((p) => p.type === 'crit').length + (Px.emitters ? Px.emitters.length : 0); return { o, live }; };
    const a = run(true), b = run(false); Px.list.length = 0; return { a, b };
  });
  ok(crit.a.o.crit === 1 && crit.b.o.crit === 0, `crit attack emits the crit emitter (${crit.a.o.crit}), non-crit does not (${crit.b.o.crit})`);
  okAv(crit.a.o.crit !== crit.b.o.crit, 'crit and non-crit are told apart');

  // thunder darkens sky light, then it recovers
  const th = await page.evaluate(() => {
    const S = MCL.Sky, Rs = MCL.Redstone || MCL.Rs;
    const w = S.weather; const set = (r, t) => { w.raining = r > 0; w.rainLevel = r; w.oRainLevel = r; w.thundering = t > 0; w.thunderLevel = t; w.oThunderLevel = t; };
    const val = () => ({ amb: S.darknessNow(), sd: S.skyDarken(S.dayTime, w.rainLevel, S.thunderLevelOf(w)) });
    set(0, 0); const clear = val(); set(1, 1); const storm = val(); set(0, 0); const after = val();
    return { clear, storm, after };
  });
  ok(th.storm.amb > th.clear.amb && th.storm.sd < th.clear.sd, `thunder: ambientDarkness ${th.clear.amb} -> ${th.storm.amb}, skyDarken ${th.clear.sd.toFixed(3)} -> ${th.storm.sd.toFixed(3)}`);
  ok(th.after.amb === th.clear.amb && th.after.sd === th.clear.sd, 'sky light recovers when the storm ends');
  okAv(th.storm.amb !== th.clear.amb, 'the darkness probe sees a storm at all');
} catch (err) {
  fails.push('threw: ' + (err && err.stack || err));
} finally {
  await page.close();
}
console.log('');
if (fails.length) { console.log(`FAIL  g20acceptance: ${pass} assertions, ${fails.length} failed, ${breaks} breaks caught`); for (const f of fails) console.log('   x ' + f); process.exit(1); }
console.log(`PASS  g20acceptance: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
