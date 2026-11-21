#!/usr/bin/env node
// fovcheck.mjs — #11260: the FOV slider, driven through real mouse/key events on the BUILT dist/mclite.html,
// and the projection the camera really uses, against GameRenderer.getFov / SliderWidget (1.18.2, .decomp).
//   vanilla: slider value = round(30 + t*80), t = (mouseX-(x+4))/(w-8) clamped; key step = 1/(w-8) of t;
//   label 70 'Normal', 110 'Quake Pro'; world fov = option * lerp(partial,last,mult) [* /deathDiv]
//   [* lerp(fovEffectScale,1,0.85714287) when the eye is in water/lava].
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, sleep } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv[2] || join(ROOT, 'dist', 'mclite.html');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } return c; };

const s = await open(FILE, { width: 1024, height: 640 });
if (!s) { console.log('fovcheck: SKIP — no Chromium'); process.exit(0); }
const ev = (src) => s.evaluate(new Function(src));
const near = (a, b, e) => Math.abs(a - b) <= (e || 0.02);

try {
  await sleep(2000);
  await s.evaluate(() => { MCL.Main.play(1337); return 1; });
  const up = await s.waitFor(() => (MCL.Hud && MCL.Hud.mode === 'game' && MCL.Player && MCL.Gfx && MCL.Gfx.cam) ? 1 : 0, 90000);
  if (!up) throw new Error('no world');
  await sleep(4000);
  await s.send('Runtime.evaluate', { expression: `
    window.__f = {
      mouse: function (t, x, y) { window.dispatchEvent(new MouseEvent(t, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true })); },
      key: function (t, c) { window.dispatchEvent(new KeyboardEvent(t, { code: c, key: c, bubbles: true, cancelable: true })); },
      slider: function () { var O = MCL.Options; MCL.Hud.draw();
        for (var i = 0; i < O.hit.length; i++) if (O.hit[i].row && O.hit[i].row.t === 'slide') return { i: i, x: O.hit[i].x, y: O.hit[i].y, w: O.hit[i].w, h: O.hit[i].h, s: O.hit[i].s || 1 };
        return null; },
      // the vertical field of view the camera projection actually carries, in degrees
      projFov: function () { var G = MCL.Gfx; if (MCL.Main.frameOnce) MCL.Main.frameOnce(); else G.render(0);
        return 2 * Math.atan(1 / G.cam.proj[5]) * 180 / Math.PI; }
    }; 1;`, returnByValue: true });

  // ── 1. mouse: press/drag at several x positions, value + label + projection ──
  await ev(`window.__f.key('keydown', 'Escape'); MCL.Options.screen = 'options'; MCL.Hud.draw(); return 1;`);
  const sl = await ev(`return window.__f.slider();`);
  if (!ok(!!sl, 'the Options screen has the FOV slider')) throw new Error('no slider');
  await ev(`MCL.Player.eyeInWater = false; MCL.Player.eyeInLava = false; MCL.Settings.fovEffectScale = 1; MCL.FovMult.cur = MCL.FovMult.last = 1; return 1;`);
  const y = Math.round(sl.y + sl.h / 2);
  const measure = async (tag) => {
    const out = [];
    for (const f of [0, 0.1, 0.25, 0.5, 0.77, 1]) {
      const x = Math.round(sl.x + 4 * sl.s + f * (sl.w - 8 * sl.s));
      const r = await ev(`
        var F = window.__f; F.mouse('mousedown', ${x}, ${y}); F.mouse('mousemove', ${x}, ${y}); F.mouse('mouseup', ${x}, ${y});
        var S = MCL.Settings, O = MCL.Options; MCL.FovMult.cur = MCL.FovMult.last = 1;
        var row = null; MCL.Hud.draw(); for (var i = 0; i < O.hit.length; i++) if (O.hit[i].row && O.hit[i].row.t === 'slide') { row = O.hit[i]; break; }
        var p = F.projFov();
        return { fov: S.fov, label: row.label, proj: p };`);
      const t = (x - (sl.x + 4 * sl.s)) / (sl.w - 8 * sl.s);
      const want = Math.round(30 + Math.min(1, Math.max(0, t)) * 80);
      const lab = 'FOV: ' + (want === 70 ? 'Normal' : want === 110 ? 'Quake Pro' : want);
      out.push(ok(r.fov === want, `${tag} x=${x}: slider value ${r.fov} == vanilla ${want}`)
        & ok(r.label === lab, `${tag} label '${r.label}' == '${lab}'`)
        & ok(near(r.proj, want), `${tag} projection fov ${r.proj.toFixed(2)} == ${want}`));
    }
    return out.every(Boolean);
  };
  await measure('drag');

  // ── 2. arrow keys step by 1/(w-8) of the track (1 option unit = 80/travel ... vanilla: value += 1/(w-8)) ──
  const kr = await ev(`
    var F = window.__f, O = MCL.Options, S = MCL.Settings;
    var h = F.slider(); O.focus = h.i;
    F.mouse('mousedown', ${Math.round(sl.x + sl.w / 2)}, ${y}); F.mouse('mouseup', ${Math.round(sl.x + sl.w / 2)}, ${y});
    O.focus = h.i; var a = S.fov;
    for (var k = 0; k < 40; k++) F.key('keydown', 'ArrowRight');
    var b = S.fov;
    for (var k = 0; k < 40; k++) F.key('keydown', 'ArrowLeft');
    return { a: a, b: b, c: S.fov, w: h.w, s: h.s };`);
  const travel = kr.w / kr.s - 8;
  ok(kr.b > kr.a && near(kr.b - kr.a, 40 * 80 / travel, 1.01), `40 Right presses: ${kr.a} -> ${kr.b} (vanilla ≈ +${(40 * 80 / travel).toFixed(1)})`);
  ok(near(kr.c, kr.a, 1.01), `40 Left presses return to ${kr.a} (got ${kr.c})`);

  // ── 3. saved and restored ──
  const sv = await ev(`MCL.Settings.fov = 93; MCL.Settings.save(); var raw = null;
    try { for (var k in localStorage) if (/mclite|settings/i.test(k) && /"fov":93/.test(localStorage.getItem(k))) raw = k; } catch (e) {}
    MCL.Settings.fov = 50; if (MCL.Settings.load) MCL.Settings.load(); return { key: raw, back: MCL.Settings.fov };`);
  ok(!!sv.key, 'save() wrote fov 93 to storage');
  ok(sv.back === 93, `load() restores it (${sv.back})`);

  // ── 4. world modifiers vs vanilla getFov ──
  await ev(`MCL.Options.screen = null; MCL.Hud.close(); MCL.Input.uiOpen = false; MCL.Settings.fov = 90; MCL.Settings.fovEffectScale = 1; return 1;`);
  const world = async (tag, setup, want) => {
    const r = await ev(`var P = MCL.Player; P.eyeInWater = false; P.eyeInLava = false; P.dead = false; P.sprinting = false;
      ${setup}; MCL.FovMult.cur = MCL.FovMult.last = ${tag.includes('mult') ? 'MCL.FovMult.cur' : '1'}; return window.__f.projFov();`);
    return ok(near(r, want, 0.05), `${tag}: projection fov ${r.toFixed(2)} == vanilla ${want.toFixed(2)}`);
  };
  const wk = [
    ['plain', '', 90],
    ['underwater x lerp(1,1,.857)', 'P.eyeInWater = true', 90 * 0.85714287],
    ['underwater, FOV Effects 0', 'P.eyeInWater = true; MCL.Settings.fovEffectScale = 0', 90],
    ['lava', 'P.eyeInLava = true', 90 * 0.85714287],
    ['underwater, FOV Effects 50%', 'P.eyeInWater = true; MCL.Settings.fovEffectScale = 0.5', 90 * (1 + (0.85714287 - 1) * 0.5)],
    ['multiplier 0.5 scale', 'MCL.Settings.fovEffectScale = 1; MCL.FovMult.cur = MCL.FovMult.last = 1.1', 99],
  ];
  const wres = [];
  for (const [t, st, w] of wk) wres.push(await (async () => {
    const r = await ev(`var P = MCL.Player; P.eyeInWater = false; P.eyeInLava = false; MCL.Settings.fovEffectScale = 1; MCL.Settings.fov = 90;
      ${st}; var F = MCL.FovMult; if (F.cur === 1.1) { F.tick = function () {}; } return window.__f.projFov();`);
    return ok(near(r, w, 0.05), `world ${t}: projection fov ${r.toFixed(2)} == vanilla ${w.toFixed(2)}`);
  })());

  // ── anti-vacuity: break the wiring and require the measurements to notice ──
  const brk = async (name, patch, rerun) => {
    const before = fails.length, pb = pass;
    await ev(patch);
    await rerun();
    const caught = fails.length > before;
    fails.length = before; pass = pb;
    await ev(`if (window.__undo) { window.__undo(); window.__undo = null; } return 1;`);
    breaks += caught ? 1 : 0;
    console.log(caught ? `   ✓ break caught: ${name}` : `   ✗ break NOT caught: ${name}`);
    if (!caught) fails.push('anti-vacuity: ' + name);
  };
  await ev(`MCL.Options.screen = 'options'; MCL.Input.uiOpen = true; return 1;`);
  await brk('the writer is removed (set() no longer stores the FOV)',
    `var O = MCL.Options, r = O.optionsRows()[0]; var o = O.optionsRows; O.optionsRows = function () { var a = o(); a[0].set = function () {}; return a; }; window.__undo = function () { O.optionsRows = o; }; return 1;`,
    () => measure('broken'));
  await brk('the drag dispatch is removed', `var O = MCL.Options, d = O.drag; O.drag = function () { return false; }; window.__undo = function () { O.drag = d; }; return 1;`, () => measure('broken'));
  await ev(`MCL.Options.screen = null; MCL.Hud.close(); MCL.Input.uiOpen = false; return 1;`);
  await brk('the underwater factor is removed', `var H = MCL.Hand3D, f = H.handFov; H.handFov = function () { return 70; }; window.__undo = function () { H.handFov = f; }; return 1;`,
    async () => { const r = await ev(`var P = MCL.Player; P.eyeInWater = true; MCL.Settings.fov = 90; MCL.Settings.fovEffectScale = 1; var v = window.__f.projFov(); P.eyeInWater = false; return v;`);
      ok(near(r, 90 * 0.85714287, 0.05), 'underwater under break'); });
} catch (e) { fails.push('crash: ' + (e && e.message || e)); }
await s.close?.();
console.log(`fovcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length || breaks < 3) { console.log(fails.join('\n')); console.log('FAIL'); process.exit(1); }
