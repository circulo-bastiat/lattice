#!/usr/bin/env node
// vaoleakcheck.mjs — #2571: the passes in G.render's hook slot (leash, particles, weather, orbs, beams) own no
// VAO and set ELEMENT_ARRAY_BUFFER / vertexAttribPointer on whatever is bound. Before the fix that was the last
// section arena drawn: its uint attributes became float pointers and up to 48 sections stopped drawing until a
// remesh moved them (Dan's random black / invisible regions). The same passes also leave a foreign 2D_ARRAY on
// texture unit 0, which the world samples as its atlas.
//
//   node tools/vaoleakcheck.mjs [dist/mclite.html]
//
// In the real game on WebGL2 it installs a HOSTILE pass in that slot (what every one of those passes does, so a
// new one cannot reintroduce the class), lets frames run, then reads back every arena VAO (attrib 0/1 buffer,
// integer flag, enabled, element buffer) and the atlas units at the start of the world passes.
// Anti-vacuity: with Gfx's releaseVao disabled the corruption is caught; with the atlas rebind disabled the
// foreign unit-0 texture is caught.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { open, sleep } from './cdp.mjs';

const FILE = resolve(process.argv[2] || 'dist/mclite.html');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'ANTI-VACUITY FAILURE: ' + m); console.log(`   ${c ? '✓' : '✗'} ${m}`); };
const say = (...a) => console.log(...a);

if (!existsSync(FILE)) { say('vaoleakcheck: SKIP — no dist/mclite.html; run build.mjs'); process.exit(0); }
const page = await open(FILE, { width: 800, height: 500 });
if (!page) { say('vaoleakcheck: SKIP — no Chromium here'); process.exit(0); }
const mk = (b) => ({ toString: () => 'function(){' + b + '}' });

// Bad arena VAOs + whether unit 0 held the atlas when the opaque pass began (recorded by the probe).
const AUDIT = mk(`var L = MCL.Gfx.backend, gl = L.gl, bad = [], n = 0;
  [[L.arenas, 2, 1], [L.modelArenas, 1, 4]].forEach(function (p) {
    var A = p[0]; if (!A) return;
    A.byClass.forEach(function (pool) { (pool || []).forEach(function (a) {
      n++; gl.bindVertexArray(a.vao);
      var why = [];
      if (gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING) !== L.idxBuf) why.push('element buffer');
      for (var i = 0; i < p[1]; i++) {
        if (gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING) !== a.vbo) why.push('attr' + i + ' buffer');
        if (!gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_INTEGER)) why.push('attr' + i + ' not integer');
        if (!gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_ENABLED)) why.push('attr' + i + ' disabled');
        if (gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_SIZE) !== p[2]) why.push('attr' + i + ' size');
      }
      if (why.length) bad.push('arena ' + a.id + ': ' + why.join(', '));
    }); });
  });
  gl.bindVertexArray(null); L.curVao = null;
  return { arenas: n, bad: bad, unit0: MCL._vaoProbe.unit0, frames: MCL._vaoProbe.frames, err: gl.getError() };`);

const run = async () => { await page.evaluate(mk('MCL._vaoProbe.frames = 0; MCL._vaoProbe.unit0 = true; return 1;')); await sleep(1500);
  // a loaded box (full suite) can starve the render loop: wait for real frames, not a fixed time
  for (let i = 0; i < 20 && (await page.evaluate(mk('return MCL._vaoProbe.frames'))) < 8; i++) await sleep(500);
  return page.evaluate(AUDIT); };

try {
  await sleep(1500);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  await page.waitFor(function () { return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20 && MCL.Gfx.meshList.length > 40); }, 120000);
  ok(await page.evaluate(mk('return MCL.Gfx.name')) === 'webgl2', 'not running on WebGL2');
  await sleep(4000);
  // The hostile pass rides the leash hook (the first call in the slot) and does what particles/weather do;
  // the probe on setPass('opaque') records whether unit 0 holds the atlas when the world starts drawing.
  await page.evaluate(mk(`var G = MCL.Gfx, L = G.backend, gl = L.gl, Ls = MCL.Leash, orig = Ls.render;
    var buf = gl.createBuffer(), ib = gl.createBuffer(), tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex); gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, 64, gl.DYNAMIC_DRAW);
    MCL._vaoProbe = { frames: 0, unit0: true };
    Ls.render = function (g, cam) {
      if (orig) orig.apply(this, arguments);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
      gl.disableVertexAttribArray(0); gl.disableVertexAttribArray(1);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    };
    var sp = L.setPass;
    L.setPass = function (p) {
      if (p === 'opaque') { MCL._vaoProbe.frames++;
        var cur = gl.getParameter(gl.ACTIVE_TEXTURE); gl.activeTexture(gl.TEXTURE0);
        if (gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY) !== L.atlasTex) MCL._vaoProbe.unit0 = false;
        gl.activeTexture(cur); }
      return sp.apply(this, arguments);
    };
    MCL._vaoProbe.hand = L.drawHand; L.drawHand = function () {};   // no hand: nothing else restores unit 0
    return 1;`));
  let r = await run();
  say(`fixed: ${r.arenas} arenas, ${r.bad.length} corrupted, unit0 atlas ${r.unit0}, ${r.frames} frames`);
  ok(r.frames > 5, `only ${r.frames} frames ran with the hostile pass installed`);
  ok(r.arenas > 0, 'no section arenas to audit');
  ok(r.bad.length === 0, `hook-slot passes corrupt section arena VAOs: ${r.bad.slice(0, 3).join(' | ')}`);
  ok(r.unit0, 'texture unit 0 does not hold the atlas when the opaque pass starts');
  ok(r.err === 0, `gl error 0x${(r.err || 0).toString(16)} after the frames`);

  // ── anti-vacuity: put each fix back the way it was ──────────────────────────────────────────
  await page.evaluate(mk(`var L = MCL.Gfx.backend; MCL._vaoProbe.rel = L.releaseVao; L.releaseVao = null; return 1;`));
  r = await run();
  okAv(r.bad.length > 0, `without releaseVao the hostile pass corrupts arenas and the audit says so (${r.bad.length}: ${r.bad[0] || 'none'})`);
  await page.evaluate(mk(`var L = MCL.Gfx.backend, gl = L.gl, bf = L.beginFrame; L.releaseVao = MCL._vaoProbe.rel;
    L.beginFrame = function (s) { bf.apply(this, arguments); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null); };
    return 1;`));
  r = await run();
  okAv(r.unit0 === false, 'with the atlas rebind undone the probe sees a foreign texture on unit 0');
} finally {
  await page.close();
}

say('');
say('================= vaoleakcheck =================');
say(`vaoleakcheck: ${pass} assertions, ${breaks} breaks caught`);
say(` failures ........... ${fails.length}`);
for (const f of fails) say('   ✗ ' + f);
say('================================================');
process.exit(fails.length ? 1 : 0);
