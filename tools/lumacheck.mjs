#!/usr/bin/env node
// lumacheck.mjs — THE REFEREE THAT LOOKS AT PIXELS, EVERY FRAME.
//
//   MCLITE_PRESET=medium node tools/lumacheck.mjs dist/mclite.html [--seconds 75] [--print]
//
// ⚠ WHY THIS EXISTS, AND WHY IT IS NOT flashcheck. Five white-flash causes have been hunted in
// this project and every instrument used to hunt them scored a COUNTER:
//
//   flashcheck   Gfx.drawn / Gfx.tris / eligible          — what the engine BELIEVES it drew
//   soakcheck    the same counters, over a long flight    — same belief, more of it
//   cullcheck    two screenshots, compared to each other  — one moment, twice
//   palettecheck meanLuma of a handful of screenshots     — a few moments
//
// None of them scores the PIXELS OF EVERY FRAME. So the whole class of "the frame drew a healthy
// number of sections and still came out as sky" is invisible to all four, and that is precisely
// the report that survived D-162, D-171/D-175, D-194 and D-198: *a one-frame blink, at medium and
// above, at random*. This file closes that class the only way it can be closed — by reading the
// back buffer inside the render call and asking what COLOUR the frame actually was.
//
// HOW IT SAMPLES. Three full-width scanlines (upper third, horizon, lower third), every 8th
// pixel, read with `gl.readPixels` from the default framebuffer INSIDE the hooked `Gfx.render`
// — before the rAF callback returns, which is the only window in which `preserveDrawingBuffer:
// false` guarantees the buffer still holds this frame. A pixel counts as SKY when it is within
// ±6/255 of THIS FRAME'S OWN clear colour, taken from `Gfx.frameState` rather than from a
// constant in this file: the clear colour is the fog colour (D-162) and a check that hard-codes
// it stops being a referee the day the sky changes.
//
// THE FENCE, AND WHERE ITS NUMBER CAME FROM (the D-236 rule: never set a bound from a different
// sample than the one it runs at). Over a healthy 386-frame medium flight — a million blocks
// out, streaming hard, in the container — the statistic this check scores (a frame's sky fraction
// MINUS the larger of its two neighbours') read:
//
//        p50 −0.003    p90 0.006    p99 0.011    worst 0.025
//
// so SPIKE = 0.15 is six times the worst healthy frame ever measured here. The frame-to-frame
// absolute delta reached 0.089 on that same flight — that is a SLOPE, the camera turning, and it
// is why the statistic is scored against BOTH neighbours: a turn moves three frames in the same
// direction, a flash moves one. ⚠ The measurement was taken at ~5 fps on a software rasteriser.
// At 60 fps consecutive frames are six times closer together, so honest variation SHRINKS and the
// fence is conservative in the right direction — but it is a measurement to re-take on the first
// machine with a GPU that ever runs this, and §1 prints the observed distribution every run so
// the number can be re-derived rather than trusted.
//
// ⚠ AND THE RULE THAT KEEPS IT HONEST (titlecheck's lesson, D-170): a measurement that always
// returns the same value passes every threshold ever written. §4 therefore asserts that the
// sampler MOVED — that sky fraction and luma both vary across the run, and that the clear colour
// it compared against was read from the engine. A wedged sampler fails §4 before §2 can pass
// vacuously.

import { open, sleep, REAL_GPU } from './cdp.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';
const PRINT = process.argv.includes('--print');
const secIdx = process.argv.indexOf('--seconds');
// D-820: 75 s was sized for SwiftShader's few fps; on the real GPU 30 s samples many times more frames
const SECONDS = secIdx > 0 ? Number(process.argv[secIdx + 1]) : (REAL_GPU ? 30 : 75);
if (!existsSync(FILE)) { console.error('lumacheck: no such file ' + FILE); process.exit(1); }

// ⚠ BEFORE open(): cdp.mjs reads MCLITE_PRESET when it launches the page (D-196). Celeron is
// render distance 4 with fast leaves — the one preset in which the reported flash cannot happen.
if (!process.env.MCLITE_PRESET) process.env.MCLITE_PRESET = 'medium';
const PRESET = process.env.MCLITE_PRESET;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 20) fails.push(m); };
// ⚠ The suite and `gatecheck` both count the deliberate breaks, and a break that passes silently
// is one neither of them can see (D-30). §5's cases announce themselves.
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };

// ── the scorer, defined here so §5 can run the REAL one over synthetic frames ───────────────
// A FLASH is a frame whose sky fraction stands above BOTH of its neighbours by `SPIKE`. A turn,
// a climb or a world arriving move several frames together and are not scored as one.
const SPIKE = 0.15;
const RUNJUMP = 0.25;     // a sustained version: >=2 frames this far above their own neighbourhood
const RUNWIN = 60;        // ...the median of the 60 frames either side (KW-22, D-411)
const RUNABS = 0.85;      // ...or a screen that is nearly all sky, whatever its neighbours were
// ⚠ THE DENOMINATOR, AND THE FIRST RUN OF THIS FILE IS WHY IT EXISTS (D-194's lesson, restated
// in pixels). Gated on "some meshes are resident" the very first run reported three sky runs and
// a p90 of 1.000 — and they were honest: the probe started flying while the world was still
// arriving, so the screen WAS sky and the resident meshes were all behind the camera. `eligible`
// is flashcheck's definition — resident, inside the render distance, AND inside the frustum —
// and `dirtyClose` is soakcheck's near disc, the four chunks a player is standing in. A sustained
// ⚠ #10584: the flight outruns the streamer on a slow runner, so `dirtyView` counts the same thing
// in the whole view: sections inside the render distance AND the frustum that are queued for meshing
// or whose chunk is not generated yet. Sky over geometry that does not exist yet is the streamer's
// (soakcheck's), at any distance; the check was red on master for exactly that, 2 runs in 3.
// sky over a COMPLETE near disc is a defect; over an incomplete one it is the streamer, which is
// soakcheck §5's to answer, not this file's.
const ELIG = 24;
function score(frames) {
  const r = { spikes: [], runs: [], median: 0, worstJump: 0, n: frames.length };
  if (frames.length < 3) return r;
  const s = frames.map((f) => f.sky).slice().sort((a, b) => a - b);
  r.median = s[s.length >> 1];
  for (let i = 1; i < frames.length - 1; i++) {
    const jump = frames[i].sky - Math.max(frames[i - 1].sky, frames[i + 1].sky);
    if (jump > r.worstJump) r.worstJump = jump;
    // ⚠ only where there was a world to draw: a frame with nothing resident is a world still
    // arriving and is honestly sky (the same gate flashcheck's `eligible` applies, D-194).
    if (jump >= SPIKE && (frames[i].eligible | 0) >= ELIG && (frames[i].dirtyView | 0) === 0) {
      r.spikes.push({ n: frames[i].n, jump: +jump.toFixed(3), f: frames[i] });
    }
  }
  // ⚠ KW-22: the baseline of a SUSTAINED run is the frame's OWN NEIGHBOURHOOD, not the flight's
  // global median. On Dan's GPU the flight covers ~800 blocks in 75 s (software: ~170), reached a
  // savanna river valley where far terrain fades into fog for 110 frames, and a global median of
  // 0.18 called a healthy 0.45 a flash. The photograph of it is in D-411. A defect is a frame that
  // stands off from the frames AROUND it; a scene is a slow drift the neighbourhood shares.
  // Measured on that real flight the worst healthy excess over its ±RUNWIN median was 0.103.
  const sk = frames.map((f) => f.sky);
  const local = (i) => {
    const a = sk.slice(Math.max(0, i - RUNWIN), i + RUNWIN + 1).sort((x, y) => x - y);
    return a[a.length >> 1];
  };
  let run = 0;
  for (let i = 0; i < frames.length; i++) {
    // RUNABS closes the gap a local baseline opens: a defect longer than the window becomes its own
    // median, so a screen that is almost ALL sky over a resident world is flagged outright (the
    // healthy maximum on the same real flight was 0.507).
    if ((frames[i].sky >= local(i) + RUNJUMP || frames[i].sky >= RUNABS) && (frames[i].eligible | 0) >= ELIG
        && (frames[i].dirtyClose | 0) === 0 && (frames[i].dirtyView | 0) === 0) run++;
    else { if (run >= 2) r.runs.push({ end: frames[i - 1].n, len: run }); run = 0; }
  }
  if (run >= 2) r.runs.push({ end: frames[frames.length - 1].n, len: run });
  return r;
}

const page = await open(FILE, { port: 9433, width: 960, height: 540 });
if (!page) {
  // ⚠ Same contract as the other five browser stages: a machine with no Chromium SKIPS rather
  // than failing the build, and the suite's summary names it (D-196). Dan's box has no browser.
  console.log('lumacheck: SKIP — no Chromium on this machine');
  process.exit(0);
}
await sleep(1800);
await page.key('Enter');
const ready = await page.waitFor(() => MCL.Main.ready === true, 90000);
ok(ready === true, 'the world never started');
if (!ready) { await page.close(); report(); }

// Dan's own conditions: creative flight, adaptive left ALONE (he plays with the defaults), a
// million blocks out because that is where the renderer's honesty was fenced (D-148/D-149).
await page.send('Runtime.evaluate', { expression:
  'MCL.Player.creative = true; MCL.Player.flying = true; MCL.Hud.showDebug = false;' +
  'MCL.Player.x = 1000000; MCL.Player.z = -600000;' +
  'MCL.Player.y = MCL.Column.height(Math.floor(MCL.Player.x), Math.floor(MCL.Player.z)) + 12;' +
  'MCL.Player.vy = 0; MCL.Player.pitch = -0.08; MCL.Player.yaw = 0.6;' });

// ⚠ A CONDITION, NOT A DURATION (D-224). Wait for the world to be resident before scoring, or
// the first seconds of "sky" are a world arriving and the median is measured against nothing.
// ⚠ THE CONDITION IS THE NEAR DISC, NOT A MESH COUNT AND NEVER A CLOCK (D-224). "200 meshes
// resident" is satisfied by 200 sections BEHIND the camera while the picture in front is still
// empty, and scoring from there measures the probe's impatience.
const settled = await page.waitFor(() => {
  const W = MCL.World;
  const cx = Math.floor(MCL.Player.x) >> 4, cz = Math.floor(MCL.Player.z) >> 4;
  let close = 0;
  W.chunks.forEach((c) => {
    const dx = c.cx - cx, dz = c.cz - cz; if (dx * dx + dz * dz > 16) return;
    for (let i = 0; i < 20; i++) if (c.meshDirty[0] & (1 << i)) close++;
  });
  return close === 0 && W.meshInflight === 0 && (MCL.Gfx.meshes ? MCL.Gfx.meshes.size : 0) > 200;
}, 240000);
// ⚠ #10592: a slow CI runner (full suite 1000025999) timed out here at 240 s and the whole check went red,
// though every scored frame is already excused per frame (dirtyClose/dirtyView) while the disc is unmeshed.
// So a timeout is a NOTE plus a vacuity guard (§1b: enough UNEXCUSED frames were scored), not a failure.
const notSettled = settled === false;
if (notSettled) console.log('   note: the near disc had not finished meshing after 240 s; scoring only frames the streamer had delivered');

await page.send('Runtime.evaluate', { expression: `
  window.__lc = { frames: [], err: null, n: 0, clearSeen: {} };
  (function () {
    const G = MCL.Gfx, W = MCL.World, P = MCL.Player, S = MCL.Settings;
    const cv = document.getElementById('gl');
    const gl = cv && cv.getContext('webgl2');
    if (!gl) { window.__lc.err = 'no webgl2 handle to read pixels from'; return; }
    const f = G.render;
    const rows = [0.35, 0.5, 0.68];
    const buf = new Uint8Array(8192 * 4);
    G.render = function () {
      // a continuous flight, applied in the frame loop: a teleport every three seconds is a
      // different test (it evicts and regenerates), and the report is about ordinary movement.
      P.x += 0.45 * Math.sin(P.yaw); P.z += 0.45 * Math.cos(P.yaw);
      P.y = MCL.Column.height(Math.floor(P.x), Math.floor(P.z)) + 12; P.vy = 0;
      const r = f.apply(this, arguments);
      try {
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const fs = G.frameState;
        // THE FRAME'S OWN CLEAR COLOUR, not a constant in the check (D-162: it is the fog colour)
        const cr = Math.round(fs.fogR * 255), cg = Math.round(fs.fogG * 255), cb = Math.round(fs.fogB * 255);
        window.__lc.clearSeen[cr + ',' + cg + ',' + cb] = 1;
        let sky = 0, tot = 0, lum = 0;
        for (let ri = 0; ri < rows.length; ri++) {
          const y = Math.max(0, Math.min(h - 1, Math.round(h * rows[ri])));
          gl.readPixels(0, y, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          for (let x = 0; x < w; x += 8) {
            const o = x * 4, R = buf[o], Gc = buf[o + 1], B = buf[o + 2];
            tot++;
            lum += 0.2126 * R + 0.7152 * Gc + 0.0722 * B;
            if (Math.abs(R - cr) <= 6 && Math.abs(Gc - cg) <= 6 && Math.abs(B - cb) <= 6) sky++;
          }
        }
        // eligible: resident, in range, IN THE FRUSTUM — geometry this frame could have shown
        const rd = S.renderDistance | 0, cam = G.cam, C = MCL.Cam, MINY = MCL.CFG.WORLD_MIN_Y;
        const ccx = Math.floor(cam.x) >> 4, ccz = Math.floor(cam.z) >> 4;
        const list = G.meshList; let eligible = 0;
        for (let i = 0; i < list.length; i++) {
          const m = list[i], ax = m.cx - ccx, az = m.cz - ccz;
          if (ax * ax + az * az > rd * rd) continue;
          const ox = m.cx * 16, oz = m.cz * 16, oy = MINY + m.sy * 16;
          if (C.aabbVisible(cam, ox, oy, oz, ox + 16, oy + 16, oz + 16)) eligible++;
        }
        // dirtyClose: unmeshed sections within four chunks — the disc no preset is too slow for
        let dirtyClose = 0;
        W.chunks.forEach((c) => {
          const dx = c.cx - ccx, dz = c.cz - ccz; if (dx * dx + dz * dz > 16) return;
          for (let i = 0; i < 20; i++) if (c.meshDirty[0] & (1 << i)) dirtyClose++;
        });
        // dirtyView: what the frustum could show at render distance and the streamer has not delivered
        let dirtyView = 0;
        for (let dx = -rd; dx <= rd; dx++) for (let dz = -rd; dz <= rd; dz++) {
          if (dx * dx + dz * dz > rd * rd) continue;
          const kx = ccx + dx, kz = ccz + dz;
          if (!C.aabbVisible(cam, kx * 16, MINY, kz * 16, kx * 16 + 16, MINY + 384, kz * 16 + 16)) continue;
          const c = W.get(kx, kz);
          if (!c) { dirtyView++; continue; }
          for (let i = 0; i < 20; i++) if (c.meshDirty[0] & (1 << i)) dirtyView++;
        }
        // KW-22 diagnostic: the first frame that stands 0.25 over the last 30's mean is
        // photographed from the back buffer, INSIDE this call, so the run can be looked at
        const ring = window.__lc.ring || (window.__lc.ring = []);
        if (!window.__lc.shot && ring.length >= 30) {
          let m = 0; for (let i = 0; i < ring.length; i++) m += ring[i]; m /= ring.length;
          if (sky / tot >= m + 0.25) window.__lc.shot = { n: window.__lc.n + 1, url: cv.toDataURL('image/png') };
        }
        // and two fixed reference photographs, so a slow sky run can be seen against a normal frame
        if (!window.__lc.hi && window.__lc.n > 100 && sky / tot >= 0.4) window.__lc.hi = { n: window.__lc.n + 1, url: cv.toDataURL('image/png') };
        if (!window.__lc.lo && window.__lc.n === 600) window.__lc.lo = { n: 601, url: cv.toDataURL('image/png') };
        ring.push(sky / tot); if (ring.length > 30) ring.shift();
        window.__lc.frames.push({
          n: ++window.__lc.n, eligible: eligible, dirtyClose: dirtyClose, dirtyView: dirtyView,
          fog: cr + ',' + cg + ',' + cb, cy: Math.round(cam.y), cp: +(cam.pitch || 0).toFixed(2),
          sky: +(sky / tot).toFixed(4), lum: Math.round(lum / tot), samples: tot,
          drawn: G.drawn | 0, tris: (G.tris | 0) + (G.modelTris | 0),
          meshes: G.meshes ? G.meshes.size : -1,
          culled: G.culled | 0, occl: G.occluded | 0, rd: S.renderDistance | 0,
          infl: W.meshInflight | 0, losses: G.contextLosses | 0,
          x: Math.round(P.x), z: Math.round(P.z)
        });
        if (window.__lc.frames.length > 40000) window.__lc.frames.shift();
      } catch (e) { window.__lc.err = String((e && e.message) || e); }
      return r;
    };
  })();
` });

await sleep(SECONDS * 1000);
const res = await page.evaluate(() => ({
  err: window.__lc.err, frames: window.__lc.frames, shot: window.__lc.shot, hi: window.__lc.hi, lo: window.__lc.lo,
  clears: Object.keys(window.__lc.clearSeen), losses: MCL.Gfx.contextLosses | 0
}));
await page.close();

const F = (res && res.frames) || [];
const R = score(F);

// KW-22: `--dump` prints the frames around every sky run and saves the photographed frame
if (process.argv.includes('--dump')) {
  for (const r of R.runs) {
    const end = F.findIndex((f) => f.n === r.end), from = Math.max(0, end - r.len - 4);
    console.log(`   run of ${r.len} ending f${r.end} — frames ${F[from].n}..${F[Math.min(F.length - 1, end + 3)].n}, every 6th:`);
    for (let i = from; i <= Math.min(F.length - 1, end + 3); i += (i > from + 8 && i < end - 4 ? 6 : 1)) {
      const f = F[i];
      console.log(`     f${f.n} sky ${f.sky} lum ${f.lum} elig ${f.eligible} dirty ${f.dirtyClose} drawn ${f.drawn} meshes ${f.meshes} rd ${f.rd} infl ${f.infl} fog ${f.fog} cam.y ${f.cy} pitch ${f.cp} at ${f.x},${f.z}`);
    }
  }
  const { writeFileSync } = await import('node:fs');
  const dir = process.env.LUMA_SHOT_DIR || ROOT;
  writeFileSync(dir + '/luma-frames.json', JSON.stringify(F));
  for (const [k, v] of [['flash', res.shot], ['hi', res.hi], ['lo', res.lo]]) {
    if (!v) continue;
    writeFileSync(dir + '/luma-' + k + '.png', Buffer.from(v.url.split(',')[1], 'base64'));
    console.log(`   photographed ${k} f${v.n} -> ${dir}/luma-${k}.png`);
  }
}

// ── 1. the probe ran long enough, and read real pixels ──────────────────────────────────────
ok(!res.err, 'the in-page probe threw: ' + res.err);
ok(F.length >= 60, `only ${F.length} frames were scored; the probe needs at least 60`);
ok(F.length === 0 || F[0].samples >= 100, `each frame sampled only ${F.length ? F[0].samples : 0} pixels`);
// 1b. the guard that makes the soft settle above honest: if the disc never settled, the run still has to have
// scored a real number of frames that nothing excused, or "no flash" was measured against nothing.
const scorable = F.filter((f) => (f.eligible | 0) >= ELIG && (f.dirtyClose | 0) === 0 && (f.dirtyView | 0) === 0).length;
ok(!notSettled || scorable >= 10, `the near disc never finished meshing and only ${scorable} of ${F.length} frames were scorable, so there was nothing honest to score`);
if (PRINT && F.length) {
  const s = F.map((f) => f.sky).slice().sort((a, b) => a - b);
  console.log(`   ${F.length} frames · sky p50 ${s[s.length >> 1].toFixed(3)} p90 ${s[Math.floor(s.length * 0.9)].toFixed(3)} max ${s[s.length - 1].toFixed(3)} · worst single-frame excess ${R.worstJump.toFixed(4)} (fence ${SPIKE})`);
}

// ── 2. NO SINGLE-FRAME SKY SPIKE — the report itself ────────────────────────────────────────
ok(R.spikes.length === 0, `${R.spikes.length} frame(s) went to sky and back in one frame` +
  (R.spikes.length ? `: first at f${R.spikes[0].n}, +${R.spikes[0].jump} over both neighbours, ` +
    `drawn ${R.spikes[0].f.drawn}, tris ${R.spikes[0].f.tris}, meshes ${R.spikes[0].f.meshes}, ` +
    `at (${R.spikes[0].f.x},${R.spikes[0].f.z})` : ''));

// ── 3. and no sustained one either ──────────────────────────────────────────────────────────
ok(R.runs.length === 0, `${R.runs.length} run(s) of >=2 frames sat ${RUNJUMP} above the flight's own median sky` +
  (R.runs.length ? `: longest ${Math.max(...R.runs.map((x) => x.len))} frames, first ending at f${R.runs[0].end}` : ''));

// ── 4. THE SAMPLER MOVED, AND THE CONTEXT SURVIVED ──────────────────────────────────────────
// A measurement wedged at one value passes every threshold above (D-170). These are the
// assertions that make §2 and §3 mean something.
const skies = F.map((f) => f.sky), lums = F.map((f) => f.lum);
const spread = skies.length ? Math.max(...skies) - Math.min(...skies) : 0;
const lspread = lums.length ? Math.max(...lums) - Math.min(...lums) : 0;
ok(spread > 0.02, `the sky fraction never moved (spread ${spread.toFixed(4)}) — the sampler is wedged, not the world calm`);
ok(lspread > 4, `the mean luma never moved (spread ${lspread}) — the sampler is wedged`);
ok((res.clears || []).length >= 1, 'the probe never read a clear colour out of Gfx.frameState');
ok((res.losses | 0) === 0, `the GL context was lost ${res.losses} time(s) during the run`);
ok(F.every((f) => f.drawn >= 0 && f.meshes >= 0), 'a frame came back with impossible counters');

// ── 5. ANTI-VACUITY — the REAL scorer, over frames it must and must not flag ────────────────
{
  const base = (n, sky) => ({ n, sky, lum: 120, samples: 360, drawn: 400, tris: 90000, meshes: 600,
                              eligible: 300, dirtyClose: 0,
                              culled: 100, occl: 20, rd: 8, infl: 2, losses: 0, x: 0, z: 0 });
  // a) a real spike is caught
  const spike = [base(1, 0.30), base(2, 0.31), base(3, 0.62), base(4, 0.30), base(5, 0.31)];
  okAv(score(spike).spikes.length === 1, 'the scorer failed to flag a fabricated one-frame sky spike');
  // b) a smooth turn is not: three frames climbing together
  const ramp = [base(1, 0.30), base(2, 0.45), base(3, 0.60), base(4, 0.72), base(5, 0.80)];
  okAv(score(ramp).spikes.length === 0, 'the scorer flagged a smooth climb as a flash');
  // c) a flat run is not
  const flat = []; for (let i = 1; i <= 40; i++) flat.push(base(i, 0.42 + (i % 3) * 0.004));
  okAv(score(flat).spikes.length === 0 && score(flat).runs.length === 0, 'the scorer flagged a calm flight');
  // d) a spike with nothing resident is a world arriving, not a flash
  const arriving = [base(1, 0.30), base(2, 0.31), base(3, 0.62), base(4, 0.30)];
  arriving[2].eligible = 4;
  okAv(score(arriving).spikes.length === 0, 'the scorer flagged sky over an empty world as a flash');
  // d2) and a sustained sky while the near disc is still meshing belongs to soakcheck, not here
  const streaming = []; for (let i = 1; i <= 30; i++) streaming.push(base(i, 0.30));
  for (const i of [10, 11, 12]) { streaming[i].sky = 0.70; streaming[i].dirtyClose = 40; }
  okAv(score(streaming).runs.length === 0, 'the scorer charged the streamer backlog as a flash');
  // d3) but the same run with the near disc COMPLETE is a defect and must be flagged
  const complete = []; for (let i = 1; i <= 30; i++) complete.push(base(i, 0.30));
  for (const i of [10, 11, 12]) complete[i].sky = 0.70;
  okAv(score(complete).runs.length === 1, 'the scorer excused a sky run over a complete near disc');
  // d4) the same run while sections in view are unmeshed or ungenerated is the streamer's, spike or run
  const viewS = []; for (let i = 1; i <= 30; i++) viewS.push(base(i, 0.30));
  for (const i of [10, 11, 12]) { viewS[i].sky = 0.70; viewS[i].dirtyView = 12; }
  okAv(score(viewS).runs.length === 0, 'the scorer charged the unmeshed view as a flash');
  const viewP = [base(1, 0.30), base(2, 0.31), base(3, 0.62), base(4, 0.30)]; viewP[2].dirtyView = 5;
  okAv(score(viewP).spikes.length === 0, 'the scorer charged an unmeshed-view spike as a flash');
  // e) the sustained rule fires on a run and not on one frame
  const runF = []; for (let i = 1; i <= 30; i++) runF.push(base(i, 0.30));
  runF[10].sky = 0.70; runF[11].sky = 0.70; runF[12].sky = 0.70;
  okAv(score(runF).runs.length === 1 && score(runF).runs[0].len === 3, 'the sustained rule missed a three-frame sky run');
  const one = []; for (let i = 1; i <= 30; i++) one.push(base(i, 0.30));
  one[10].sky = 0.70;
  okAv(score(one).runs.length === 0, 'the sustained rule fired on a single frame');
  // e2) KW-22: the real GPU flight — a slow drift to 0.50 held 110 frames (a savanna valley whose
  // far terrain fogs out) and back is a SCENE, not a flash; it failed the global-median rule
  const drift = []; for (let i = 1; i <= 400; i++) drift.push(base(i, 0.18));
  for (let i = 0; i < 110; i++) drift[200 + i].sky = 0.18 + 0.32 * Math.min(1, i / 40, (110 - i) / 40);
  okAv(score(drift).runs.length === 0 && score(drift).spikes.length === 0, 'the scorer flagged a slow scene drift as a flash');
  // e3) ...while a 40-frame defect over the same calm flight IS caught (the window still sees the calm)
  const longer = []; for (let i = 1; i <= 400; i++) longer.push(base(i, 0.18));
  for (let i = 200; i < 240; i++) longer[i].sky = 0.60;
  okAv(score(longer).runs.length === 1 && score(longer).runs[0].len === 40, 'the scorer missed a 40-frame sky run');
  // e4) ...and a defect longer than the window, where the neighbourhood is the defect, is caught absolutely
  const wholly = []; for (let i = 1; i <= 400; i++) wholly.push(base(i, 0.18));
  for (let i = 100; i < 300; i++) wholly[i].sky = 0.97;
  okAv(score(wholly).runs.length >= 1, 'the scorer missed a 200-frame all-sky run');
  // f) the fence itself is not vacuous: 0.14 must NOT fire and 0.16 must
  const near = [base(1, 0.30), base(2, 0.30), base(3, 0.44), base(4, 0.30)];
  okAv(score(near).spikes.length === 0, 'the spike fence fired below its own threshold');
  const over = [base(1, 0.30), base(2, 0.30), base(3, 0.47), base(4, 0.30)];
  okAv(score(over).spikes.length === 1, 'the spike fence did not fire above its own threshold');
}

report();

function report() {
  console.log('');
  console.log('1. the probe ran, and read real pixels out of the back buffer');
  console.log('2. no frame went to sky and back in one frame, over a world that was there');
  console.log('3. no sustained sky run over a resident world');
  console.log('4. the sampler moved, the clear colour came from the engine, the context survived');
  console.log('5. anti-vacuity — the real scorer over eight synthetic cases');
  console.log('');
  for (const f of fails) console.log('FAIL  ' + f);
  // the shape `suite.mjs` parses (its note at :198) — a stage that prints its own shape is
  // counted as zero and the suite's headline number quietly loses it
  console.log(` assertions passed .. ${pass}`);
  console.log(` failures ........... ${fails.length}`);
  console.log(`   [preset ${PRESET}, ${F ? F.length : 0} frames]`);
  process.exit(fails.length ? 1 : 0);
}
