#!/usr/bin/env node
// weathercheck.mjs — PLAN G20 weather (D-655): `WorldRenderer.renderWeather` (.decomp/net/minecraft/
// client/render/WorldRenderer.java:223-397) against `Wx.buildQuads` (src/09c_weather.js).
//
// The REFEREE for the java.util.Random / Java-int half is `tools/golden/weather-1.18.2.tsv`, printed by
// a real JDK running `tools/golden/weather-1.18.2.java.txt` (renderWeather's own per-column
// expressions, verbatim) — not this file re-deriving them (rules 3-4). The geometry rules (radius,
// the heightmap clamp, rain vs snow, the NaN camera column, alpha) are asserted in BOTH directions.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

console.log('weathercheck — G20, the rain/snow draw (09c_weather.js, WorldRenderer.renderWeather)');
const M = loadEngine({ extra: ['07zx_particle.js', '09c_weather.js'], initReg: false });
const Wx = M.Weather;
ok(!!Wx && typeof Wx.buildQuads === 'function', 'NS.Weather.buildQuads exists');

// ── golden ────────────────────────────────────────────────────────────────────────────────
const rows = [], offs = [];
for (const line of readFileSync(join(ROOT, 'tools/golden/weather-1.18.2.tsv'), 'utf8').split('\n')) {
  if (!line || line[0] === '#' || line.startsWith('x\t')) continue;
  const f = line.split('\t');
  if (f[0] === 'off') offs.push(f.slice(1).map(Number));
  else rows.push(f.map(Number));
}
ok(rows.length === 48 && offs.length === 42, `golden has 48 column rows and 42 offset rows (got ${rows.length}, ${offs.length})`);

const R = Wx.RADIUS_FANCY, FV = Wx.VERTEX_FLOATS;
/** A one-column world: precipitation only at (tx,tz), camera 3 blocks west, flat top at 0. */
function oneColumn(tx, tz, ticks, cold) {
  return {
    x: tx - 3 + 0.5, y: 100.5, z: tz + 0.5, ticks, partial: 0.25, gradient: 1, fancy: true,
    biomeAt: (x, z) => (x === tx && z === tz ? 1 : 0), precipitation: (b) => b,
    warm: () => !cold, topY: () => 0, light: () => [15, 0], skyScale: 1,
  };
}
function checkGolden(label) {
  let bad = 0;
  for (const [x, z, t, seed, phase, rainF, scroll, s35, s36] of rows) {
    if (Wx.columnSeed(x, z) !== seed) bad++;
    if (Wx.rainPhase(t, x, z) !== phase) bad++;
    const d = Wx.columnDraws(x, z);
    if (!d || !near(d.rainF, rainF, 1e-7)) bad++;
    const qr = Wx.buildQuads(oneColumn(x, z, t, false));
    const y0 = 100 - R;
    if (qr.rain.length !== 4 * FV || !near(qr.rain[4] - y0 * 0.25, scroll, 2e-6)) bad++;
    const qs = Wx.buildQuads(oneColumn(x, z, t, true));
    const s34 = -((t & 511) + 0.25) / 512;
    if (qs.snow.length !== 4 * FV || !near(qs.snow[3], s35, 2e-6) || !near(qs.snow[4] - y0 * 0.25 - s34, s36, 2e-5)) bad++;
    if (label === 'real' && bad && fails.length < 10) fails.push(`golden row x=${x} z=${z} ticks=${t} disagrees`);
  }
  return bad;
}
say('\n 1. per-column seed / phase / Random draws vs the JDK golden');
ok(checkGolden('real') === 0, 'every golden row (seed, rain phase, rain nextFloat + scroll, snow u/v drift) matches the JDK');
for (const [dx, dz, ox, oz] of offs) {
  const [a, b] = Wx.offsetAt(dx, dz);
  ok(near(a, ox, 1e-7) && near(b, oz, 1e-7), `offset table (${dx},${dz}) = (${ox},${oz}), got (${a},${b})`);
}
ok(Number.isNaN(Wx.offsetAt(0, 0)[0]), 'the camera column\'s own offset is NaN (0/0), as vanilla\'s table is');
// break: a wrong seed must be caught by the golden
{
  const real = Wx.columnSeed;
  Wx.columnSeed = (x, z) => (x ^ z) | 0; Wx._resetForTest();
  okAv(checkGolden('break') > 0, 'a wrong column seed is caught by the golden rows');
  Wx.columnSeed = real; Wx._resetForTest();
}

// ── the geometry rules ────────────────────────────────────────────────────────────────────
say('\n 2. radius, gradient, precipitation gate, heightmap clamp, NaN column');
function flat(over) {
  return Object.assign({
    x: 0.5, y: 64.5, z: 0.5, ticks: 100, partial: 0, gradient: 1, fancy: true,
    biomeAt: () => 1, precipitation: () => 1, warm: () => true, topY: () => 61,
    light: () => [15, 0], skyScale: 1,
  }, over || {});
}
ok(Wx.buildQuads(flat()).columns === 21 * 21 - 1, 'Fancy: a radius-10 square, less the camera\'s own NaN column (440)');
ok(Wx.buildQuads(flat({ fancy: false })).columns === 11 * 11 - 1, 'Fast: radius 5 (120)');
ok(Wx.buildQuads(flat({ gradient: 0 })).columns === 0, 'rain gradient 0 draws nothing');
ok(Wx.buildQuads(flat({ gradient: 0.01 })).columns === 440, '...and any gradient above 0 draws (the other direction)');
ok(Wx.buildQuads(flat({ precipitation: () => 0 })).columns === 0, 'a biome with no precipitation draws nothing');
ok(Wx.buildQuads(flat({ topY: () => 64 + 10 })).columns === 0, 'a roof at/above the band top (both ends clamp to it) draws nothing');
ok(Wx.buildQuads(flat({ topY: () => 64 + 9 })).columns === 440, '...one block lower it draws again');
{
  const q = Wx.buildQuads(flat({ topY: () => 60 }));
  ok(q.rain[1] === 74 - 64.5 && q.rain[15] === 60 - 64.5, 'band: top at camY+R, bottom at max(camY-R, top) (74 / 60)');
  const q2 = Wx.buildQuads(flat({ topY: () => 50 }));
  ok(q2.rain[15] === 54 - 64.5, 'a low top leaves the bottom at camY-R (54)');
  let nan = false; for (const v of q.rain) if (v !== v) nan = true;
  ok(!nan, 'no NaN vertex ever reaches the buffer');
}
{
  const cold = Wx.buildQuads(flat({ warm: () => false }));
  ok(cold.snow.length === 440 * 4 * FV && cold.rain.length === 0, 'cold (temperature < 0.15) columns snow, not rain');
  const warm = Wx.buildQuads(flat());
  ok(warm.rain.length === 440 * 4 * FV && warm.snow.length === 0, 'warm columns rain, not snow');
  const seen = [];
  Wx.buildQuads(flat({ warm: (b, x, y) => { seen.push(y); return true; }, topY: () => 58 }));
  ok(seen.every((y) => y === 58), 'the rain/snow question is asked at the band\'s LOWER end (doesNotSnow($$23))');
}
say('\n 3. alpha, light');
{
  // column (3,0) (centre 3.5) from camera (0.5,64.5,0.5): dist = 3/10
  const pick = (q, list, x, z) => { for (let i = 0; i < q[list].length; i += 4 * FV) { const cx = q[list][i] + q[list][i + FV] ; if (Math.abs(cx / 2 - (x + 0.5 - 0.5)) < 1e-6 && Math.abs((q[list][i + 2] + q[list][i + FV + 2]) / 2 - (z + 0.5 - 0.5)) < 1e-6) return i; } return -1; };
  const d = 3 / 10;
  const q = Wx.buildQuads(flat({ gradient: 0.5 }));
  const i = pick(q, 'rain', 3, 0);
  ok(i >= 0 && near(q.rain[i + 6], ((1 - d * d) * 0.5 + 0.5) * 0.5, 1e-6), 'rain alpha ((1-d^2)*0.5+0.5)*gradient');
  const qs = Wx.buildQuads(flat({ gradient: 0.5, warm: () => false }));
  const j = pick(qs, 'snow', 3, 0);
  ok(j >= 0 && near(qs.snow[j + 6], ((1 - d * d) * 0.3 + 0.5) * 0.5, 1e-6), 'snow alpha ((1-d^2)*0.3+0.5)*gradient');
  const dark = Wx.buildQuads(flat({ light: () => [0, 0] })), darkS = Wx.buildQuads(flat({ light: () => [0, 0], warm: () => false }));
  ok(near(dark.rain[5], Wx.brightness(0, 0, 1), 1e-9), 'rain in the dark is lit at light 0 (no lift)');
  ok(darkS.snow[5] > dark.rain[5] && near(darkS.snow[5], Wx.brightness(3.75, 3.75, 1), 1e-9), 'snow in the dark is lifted to (3*0+15)/4 = 3.75 levels');
  const lit = [];
  Wx.buildQuads(flat({ light: (x, y, z) => { lit.push(y); return [15, 0]; }, topY: () => 70 }));
  ok(lit.every((y) => y === 70), 'light is sampled at max(top, camY) — the top when it is above the camera');
}
// breaks: the radius and the alpha term
{
  const r = Wx.RADIUS_FANCY; Wx.RADIUS_FANCY = 9;
  okAv(Wx.buildQuads(flat()).columns !== 440, 'a radius of 9 is caught by the 440-column count');
  Wx.RADIUS_FANCY = r;
  const bq = Wx.buildQuads; const real = bq(flat({ gradient: 0 }));
  okAv(real.columns === 0, 'gradient gate: the zero-gradient case really returns nothing (not a sampling accident)');
}

say('\n 4. the sheets');
{
  const bin = readFileSync(join(ROOT, 'assets/weather-tex.bin'));
  const meta = JSON.parse(readFileSync(join(ROOT, 'assets/weather-tex.meta.json'), 'utf8'));
  M.DATA = Object.assign({}, M.DATA, { weatherTiles: bin.toString('base64'), weatherTilesBytes: meta.rawBytes, weatherW: meta.width, weatherH: meta.height });
  Wx._resetForTest();
  const sh = Wx.sheets();
  ok(!!sh && sh.w === 64 && sh.h === 256, 'rain + snow sheets decode at 64x256');
  if (sh) {
    const lit = (a) => { let n = 0; for (let k = 3; k < a.length; k += 4) if (a[k]) n++; return n; };
    ok(lit(sh.rain) === 404 && lit(sh.snow) === 129, `rain/snow carry their own texels (404/129 visible, got ${lit(sh.rain)}/${lit(sh.snow)})`);
  }
}

say('\n 5. the splashes (D-656, WorldRenderer.tickRainSplashing + RainSplashParticle)');
{
  // the referee: tools/golden/splash-1.18.2.tsv, printed by the JDK off splash-1.18.2.java.txt
  const tries = [], snd = new Map(), ns = [];
  for (const line of readFileSync(join(ROOT, 'tools/golden/splash-1.18.2.tsv'), 'utf8').split('\n')) {
    if (!line || line[0] === '#' || line.startsWith('Picked up')) continue;
    const f = line.split('\t');
    if (f[0] === 'snd') snd.set(+f[1], +f[2]);
    else if (f[0] === 'n') ns.push([+f[1], +f[2], +f[3]]);
    else tries.push(f.map(Number));
  }
  ok(tries.length === 35 && snd.size === 7 && ns.length === 14, `splash golden: 35 tries, 7 sound draws, 14 counts (got ${tries.length}, ${snd.size}, ${ns.length})`);
  const countsMatch = () => ns.every(([g, fancy, n]) => Wx.splashTries(g, !!fancy) === n);
  ok(countsMatch(), 'try count (int)(100*f*f), f = gradient/(Fancy?1:2), float — every golden row');
  ok(Wx.splashTries(1, true) === 100 && Wx.splashTries(1, false) === 25 && Wx.splashTries(0, true) === 0, '100 tries on Fancy at full rain, 25 on Fast, none dry');
  // an every-column-passes world; gradient 0.23 on Fancy = exactly 5 tries (the golden's count)
  const P0 = Wx.splashTries(0.23, true);
  ok(P0 === 5, `gradient 0.23 Fancy gives the golden's 5 tries (got ${P0})`);
  const world = (over) => Object.assign({
    x: 0.5, y: 64.5, z: 0.5, ticks: 0, gradient: 0.23, fancy: true, bottomY: -64,
    topY: () => 64, biomeAt: () => 1, precipitation: (b) => b, warm: () => true,
    cellTop: () => 0, hot: () => false,
  }, over || {});
  const seqMatches = () => {
    let bad = 0;
    for (const t of snd.keys()) {
      const res = Wx.tickRainSplashing(world({ ticks: t }));
      const rows = tries.filter((r) => r[0] === t);
      if (res.spawns.length !== rows.length) { bad++; continue; }
      rows.forEach(([, k, dx, dz, u, v]) => {
        const sp = res.spawns[k];
        if (sp.x !== dx + u || sp.z !== dz + v || sp.y !== 63 || sp.type !== 'rain') bad++;
      });
    }
    return bad === 0;
  };
  ok(seqMatches(), 'the fresh Random((long)ticks*312987231L): every try\'s column and (u,v) equal the JDK\'s, for 7 tick values');
  // the sound counter: nextInt(3) < counter++, reset on a hit
  {
    let good = true;
    for (const [t, r3] of snd) {
      Wx.splashSoundCounter = 0;
      const a = Wx.tickRainSplashing(world({ ticks: t }));
      if (a.sound !== null || Wx.splashSoundCounter !== 1) good = false;          // r3 < 0 never
      Wx.splashSoundCounter = 2;
      const b = Wx.tickRainSplashing(world({ ticks: t }));
      if ((b.sound !== null) !== (r3 < 2)) good = false;
      if (Wx.splashSoundCounter !== (r3 < 2 ? 0 : 3)) good = false;
    }
    ok(good, 'the sound counter: nextInt(3) < counter++ (JDK draw), reset to 0 when it fires');
    Wx.splashSoundCounter = 5;
    const out = Wx.tickRainSplashing(world({ ticks: 7, topY: (x, z) => (x === 0 && z === 0 ? 80 : 64) }));
    ok(out.sound && out.sound.id === 'weather.rain' && out.sound.volume === 0.2 && out.sound.pitch === 1, 'under open sky the counter asks for weather.rain (0.2, 1.0)');
    Wx.splashSoundCounter = 5;
    const out2 = Wx.tickRainSplashing(world({ ticks: 7, y: 60.5, topY: (x, z) => (x === 0 && z === 0 ? 80 : 64) }));
    ok(out2.sound && out2.sound.id === 'weather.rain.above' && out2.sound.volume === 0.1 && out2.sound.pitch === 0.5,
      'under a roof with the splash over a block above, weather.rain.above (0.1, 0.5)');
    Wx.splashSoundCounter = 0;
  }
  // the gates, both directions
  const n = (over) => Wx.tickRainSplashing(world(over)).spawns.length;
  ok(n({ topY: () => 74 }) === 5 && n({ topY: () => 75 }) === 0, 'a top 10 above the camera block splashes, 11 above does not');
  ok(n({ topY: () => 54 }) === 5 && n({ topY: () => 53 }) === 0, 'a top 10 below splashes, 11 below does not');
  ok(n({ precipitation: () => 2 }) === 0 && n({ precipitation: () => 0 }) === 0 && n() === 5, 'only a RAIN biome splashes (not snow, not none)');
  ok(n({ warm: () => false }) === 0, 'where it snows (temperature < 0.15) nothing splashes');
  ok(n({ topY: () => -64, y: -60.5 }) === 0 && n({ topY: () => -63, y: -60.5 }) === 5, 'a top at the world bottom is refused; one above is not');
  ok(n({ gradient: 0 }) === 0, 'no rain, no splashes');
  {
    const seen = [];
    Wx.tickRainSplashing(world({ warm: (b, x, y) => { seen.push(y); return true; } }));
    ok(seen.length === 5 && seen.every((y) => y === 64), 'doesNotSnow is asked at the top position itself');
    const r = Wx.tickRainSplashing(world({ hot: (x, y) => y === 63, cellTop: () => 0.5 }));
    ok(r.spawns.every((s) => s.type === 'smoke' && s.y === 63.5), 'a hot block under the top (lava/magma/lit campfire) smokes, at its shape/fluid top');
    ok(Wx.tickRainSplashing(world({ cellTop: () => 0.875 })).spawns.every((s) => s.type === 'rain' && s.y === 63.875), 'else it rains, at the top of what it lands on');
  }
  // getEndingCoord(Y, a, b) reads (z=a, x=b)
  const halfX = [[0, 0, 0, 0.5, 1, 1]];       // the west half of a cell, full height
  const transposed = () => Wx.shapeTop(halfX, 0.75, 0.25) === 1 && Wx.shapeTop(halfX, 0.25, 0.75) === -Infinity;
  ok(transposed(), 'getEndingCoord(Y, a, b) reads the shape at x=b, z=a (AxisCycle), as vanilla does');
  ok(Wx.shapeTop(null, 0.5, 0.5) === -Infinity && Wx.shapeTop([[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 1, 0.875, 1]], 0.1, 0.1) === 0.875, 'no shape is -Infinity; a stack reads its highest box');
  // RainSplashParticle
  const Px = M.Particle; Px.init();
  const seq = (arr) => { let i = 0; return () => arr[i++ % arr.length]; };
  const p = Px.spawn('rain', 0.5, 64, 0.5, 0, 0, 0, seq([0.5]));
  ok(p && p.type === 'rain' && p.gravityStrength === 0.06 && p.width === 0.01, 'rain spawns a RainSplashParticle (gravity 0.06, box 0.01)');
  ok(p && Math.abs(p.vy - 0.2) < 1e-12 && p.maxAge === Math.floor(8 / 0.6), 'vy = rand*0.2+0.1, maxAge = (int)(8/(rand*0.8+0.2))');
  const q = Px.spawn('rain', 0.5, 64, 0.5, 0, 0, 0, seq([0.5, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));   // scale, then dir (1,0,0), mag 0.3
  ok(q && Math.abs(q.vx - 0.3 * 0.4 * 0.3) < 1e-12 && q.vz === 0, 'x velocity is the base direction roll * 0.3 (renormalised to (r+r+1)*0.15*0.4)');
  // a floor at y=64 under a stub collider (Physics.clip's contract: the allowed part of d)
  const floorY = 64;
  const stubPh = { clip: (x0, y0, z0, x1, y1, z1, axis, d) => (axis === 1 && d < 0 ? Math.max(d, floorY - y0) : d) };
  const savedPh = M.Physics; M.Physics = stubPh;
  const land = (grav) => {
    Px.list.length = 0;
    const r = Px.spawn('rain', 0.5, 64, 0.5, 0, 0, 0, seq([0.5]));
    r.maxAge = 40; if (grav !== undefined) r.gravityStrength = grav;
    Px.rainRand = () => 0.9;                  // the coin says live
    let t = 0; while (!r.onGround && t < 40) { Px.tick(); t++; }
    return { r, t };
  };
  const L1 = land();
  ok(L1.r.onGround && !L1.r.stopped && Math.abs(L1.r.y - 64) < 1e-12 && L1.t === 6, `it rises, falls under 0.06/tick and lands on the floor on tick 6 (hand-stepped: 64.14, .217, .233, .188, .085, floor; got ${L1.t})`);
  const vx0 = L1.r.vx; Px.tick();
  ok(Px.list.length === 1 && L1.r.stopped && Math.abs(L1.r.y - 64) < 1e-12 && L1.r.vx === vx0 * 0.98 * 0.7,
    'the next tick its fall is clipped to nothing and it STOPS for good (field_21507); on the ground x slows by 0.98*0.7');
  { const y1 = L1.r.y, x1 = L1.r.x; Px.tick(); ok(L1.r.x === x1 && L1.r.y === y1, 'a stopped splash never moves again'); }
  Px.rainRand = () => 0.1; Px.tick();
  ok(Px.list.length === 0, 'on the ground, the coin (Math.random() < 0.5) kills it');
  {
    Px.list.length = 0; Px.rainRand = () => 0.9;
    const r = Px.spawn('rain', 0.5, 70, 0.5, 0, 0, 0, seq([0.5]));
    M.Physics = { clip: (x0, y0, z0, x1, y1, z1, axis, d) => d };
    const saveTop = Px.cellTopAt;
    Px.cellTopAt = () => 0; Px.tick();
    ok(Px.list.length === 1, 'in a cell with no shape and no fluid it lives');
    Px.cellTopAt = () => 1; Px.tick();
    ok(Px.list.length === 0, 'inside the top of its cell\'s collision shape or fluid it dies');
    Px.cellTopAt = saveTop;
    const d = Px.spawn('rain', 0.5, 200, 0.5, 0, 0, 0, seq([0.5]));
    const life = d.maxAge; let t = 0; Px.cellTopAt = () => 0;
    while (Px.list.includes(d) && t < 100) { Px.tick(); t++; }
    Px.cellTopAt = saveTop;
    ok(t === life + 1, `maxAge counts down and is checked first: it lives maxAge ticks, dies on the next (${t} vs ${life + 1})`);
  }
  // breaks
  const saveMul = Wx.SPLASH_SEED_MUL; Wx.SPLASH_SEED_MUL = 312987232n;
  okAv(!seqMatches(), 'a seed multiplier off by one is caught by the JDK sequence');
  Wx.SPLASH_SEED_MUL = saveMul;
  const saveTop2 = Wx.shapeTop;
  Wx.shapeTop = (boxes, a, b) => saveTop2(boxes, b, a);
  okAv(!transposed(), 'an un-transposed getEndingCoord (x=a, z=b) is caught');
  Wx.shapeTop = saveTop2;
  M.Physics = stubPh;
  okAv(land(0.06 * 0.04).t !== 6, 'gravity applied as the base Particle\'s 0.04*g (not RainSplash\'s raw 0.06) lands on another tick');
  M.Physics = savedPh; Px.rainRand = null; Px.list.length = 0;
  const saveTries = Wx.splashTries; Wx.splashTries = (g, f) => Math.trunc(100 * g * g);
  okAv(!countsMatch(), 'dropping the Fast halving is caught by the count golden');
  Wx.splashTries = saveTries;
  // the rain sounds are PLAYED (#6227): 400 seeded ticks, counted through Wx.playSplashSound
  const played = [];
  const saveSnd = M.Sound; M.Sound = { play: (id, o) => { played.push([id, o.source, o.volume, o.pitch]); return true; } };
  const run = (over) => {
    played.length = 0;
    for (let t = 0; t < 400; t++) Wx.playSplashSound(Wx.tickRainSplashing(world(Object.assign({ ticks: t }, over))));
    return played.slice();
  };
  const wet = run({}), roof = run({ y: 70.5, topY: (x, z) => (x === 0 && z === 0 ? 90 : 80) }), dry = run({ gradient: 0 });
  ok(wet.length > 10 && wet.every((p) => p[0] === 'weather.rain' && p[1] === 'weather' && p[2] === 0.2 && p[3] === 1), `rain plays weather.rain 0.2/1.0 on source weather (${wet.length} plays)`);
  ok(dry.length === 0, 'no rain, no sound');
  ok(roof.some((p) => p[0] === 'weather.rain.above' && p[2] === 0.1 && p[3] === 0.5), 'under a roof the .above sound plays at 0.1/0.5');
  const savePl = Wx.playSplashSound; Wx.playSplashSound = () => false;
  okAv(run({}).length === 0, 'dropping the play call is caught');
  Wx.playSplashSound = savePl; M.Sound = saveSnd;
}

console.log('');
if (fails.length) {
  console.log(`FAIL  weathercheck: ${pass} assertions, ${fails.length} failures, ${breaks} anti-vacuity checks`);
  for (const f of fails) console.log('   x ' + f);
  process.exit(1);
}
console.log(`PASS  weathercheck: ${pass} assertions, 0 failures, ${breaks} anti-vacuity checks`);
