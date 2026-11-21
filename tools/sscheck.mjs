#!/usr/bin/env node
// sscheck.mjs — #1890: `/ss` and F2 save ONE png = the frame + the debug dump, in the REAL game.
//
//   node tools/sscheck.mjs [dist/mclite.html]
//
// Dan (3 Oct): the ocean-mob and invisible-block glitches could not be reproduced headless, so the game
// itself must report what his screen shows. This check proves the whole chain on the shipped file:
//   0. the module ships (build.mjs FILE_ORDER, Main.loop calls SS.afterFrame, Chat.send handles `/ss`)
//   1. F2 saves a decodable, NON-BLANK png (the capture happens inside the frame, or WebGL gives black)
//   2. typing `/ss` through the chat saves one too
//   3. the dump is embedded in the png (`tEXt` chunk `mclite-dump`) and carries EVERY field workers need:
//      world/seed/climate, player pose, backend + renderDistance, entities (with the y the renderer drew),
//      the first-tick ring, for the look-ray cell all 6 face decisions + section/chunk state + light, and a
//      per-section map of what was DRAWN vs hidden by the visibility flood / frustum / not meshed
//   4. anti-vacuity: the field validator, the blank detector and the extractor each fail on broken input
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, sleep } from './cdp.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = resolve(process.argv[2] || 'dist/mclite.html');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'ANTI-VACUITY FAILURE: ' + m); console.log(`   ${c ? '✓' : '✗'} ${m}`); };
const say = (...a) => console.log(...a);

if (!existsSync(FILE)) { say('sscheck: SKIP — no dist/mclite.html; run build.mjs'); process.exit(0); }

// ── 0. the module ships ──────────────────────────────────────────────────────────────────────
const build = readFileSync(resolve(ROOT, 'build.mjs'), 'utf8');
const iSS = build.indexOf("'15j_ss.js'"), iMain = build.indexOf("'17_main.js'"), iHud = build.indexOf("'15_hud.js'");
ok(iSS > 0, "'15j_ss.js' is not in build.mjs FILE_ORDER");
ok(iSS > iHud && iSS < iMain, '15j_ss.js must come after 15_hud.js (it composites Hud.canvas) and before 17_main.js');
ok(/NS\.SS\.afterFrame\(\)/.test(readFileSync(resolve(ROOT, 'src/17_main.js'), 'utf8')), 'Main.loop does not call SS.afterFrame() after the frame is drawn');
ok(/\^\\\/ss\(\\s\|\$\)/.test(readFileSync(resolve(ROOT, 'src/15c_chat.js'), 'utf8')), 'Chat.send does not take `/ss` before Commands.run');

// ── the validator: every field a worker needs (also what the anti-vacuity breaks) ────────────────
const VALIDATOR = `
  function (d) {
    var miss = [];
    function need(path) { var o = d, p = path.split('.'); for (var i = 0; i < p.length; i++) { if (o === null || o === undefined || !(p[i] in Object(o))) { miss.push(path); return; } o = o[p[i]]; } }
    ['world.seed', 'world.climate', 'player.x', 'player.y', 'player.z', 'player.yaw', 'player.pitch', 'timing.mainTicks', 'timing.fps',
     'gfx.backend', 'gfx.renderDistance', 'entitiesNear.count', 'entitiesNear.list', 'firstTickRing.records', 'focus', 'image.width', 'sectionDraw.occlusion', 'sectionDraw.grids', 'sectionDraw.legend'].forEach(need);
    if (d.entitiesNear && d.entitiesNear.list) d.entitiesNear.list.forEach(function (e, i) {
      ['type', 'x', 'y', 'z', 'renderedY', 'renderedMinusY', 'inWater', 'onGround', 'feet', 'above', 'below', 'age'].forEach(function (k) { if (!(k in e)) miss.push('entitiesNear.list[' + i + '].' + k); });
    });
    var f = d.focus && (d.focus.crosshairTarget || d.focus.firstNonAir);
    if (!f) miss.push('focus.(crosshairTarget|firstNonAir)');
    else {
      ['cell', 'section', 'faces', 'neighbourhood'].forEach(function (k) { if (!(k in f)) miss.push('focus.cell.' + k); });
      ['+x', '-x', '+y', '-y', '+z', '-z'].forEach(function (k) {
        var fd = f.faces && f.faces[k];
        if (!fd) { miss.push('face ' + k); return; }
        ['verdict', 'neighbour', 'neighbourSection', 'cullsBit'].forEach(function (q) { if (!(q in fd)) miss.push('face ' + k + '.' + q); });
      });
      ['loaded', 'meshed', 'dirty', 'meshGen', 'vis', 'neighbours'].forEach(function (k) { if (!(k in (f.section || {}))) miss.push('section.' + k); });
      if (!f.cell || !f.cell.light) miss.push('cell.light');
    }
    return miss;
  }`;

const page = await open(FILE, { width: 800, height: 500 });
if (!page) { say('sscheck: SKIP — no Chromium here'); process.exit(0); }
const mk = (b) => ({ toString: () => 'function(){' + b + '}' });

try {
  await sleep(1500);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  await page.waitFor(function () { return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20); }, 120000);
  ok(await page.evaluate(mk('return typeof MCL.SS === "object" && typeof MCL.SS.afterFrame === "function"')), 'MCL.SS did not initialise');

  // hover above the ground looking down so the look ray has a block to report
  await page.evaluate(mk(`MCL.SS.noDownload = true; var P = MCL.Player, W = MCL.World;
    P.flying = true; P.vy = 0; P.pitch = -1.3; P.y = W.heightAt(Math.floor(P.x), Math.floor(P.z)) + 4; return 1;`));
  await sleep(6000);

  const capture = async (how) => {
    const before = await page.evaluate(mk('return MCL.SS.saved'));
    if (how === 'F2') await page.key('F2', undefined, 'F2');
    else await page.evaluate(mk(`var C = MCL.Chat; C.openChat(); C.input = '/ss'; C.caret = 3; C.send('Dan'); return 1;`));
    await page.waitFor(function () { return true; }, 10);
    for (let i = 0; i < 30; i++) { await sleep(300); if ((await page.evaluate(mk('return MCL.SS.saved'))) > before) break; }
    const after = await page.evaluate(mk('return MCL.SS.saved'));
    ok(after === before + 1, `${how}: expected one saved capture (saved ${before} -> ${after}); errors: ${await page.evaluate(mk('return JSON.stringify(MCL.SS.errors)'))}`);
    return await page.evaluate(mk(`var b = MCL.SS.last && MCL.SS.last.bytes; if (!b) return null; var s = ''; for (var i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return btoa(s);`));
  };

  for (const how of ['F2', '/ss']) {
    const b64 = await capture(how);
    ok(!!b64, `${how}: no png bytes`);
    if (!b64) continue;
    // 1. a decodable, non-blank png
    const res = await page.evaluate(mk(`return new Promise(function (res) {
      var bin = atob(${JSON.stringify(b64)}), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      var sig = u[0] === 137 && u[1] === 80 && u[2] === 78 && u[3] === 71;
      createImageBitmap(new Blob([u], { type: 'image/png' })).then(function (bm) {
        var c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; var g = c.getContext('2d'); g.drawImage(bm, 0, 0);
        var seen = {}, n = 0, d = g.getImageData(0, 0, c.width, c.height).data;
        for (var k = 0; k < d.length; k += 4 * 37) { var key = d[k] + ',' + d[k + 1] + ',' + d[k + 2]; if (!seen[key]) { seen[key] = 1; n++; } }
        var dump = MCL.SS.extract(u, 'mclite-dump'), parsed = null; try { parsed = JSON.parse(dump); } catch (e) {}
        var wrong = MCL.SS.extract(u, 'not-the-keyword');
        res({ sig: sig, w: bm.width, h: bm.height, colours: n, hasDump: !!dump, parsed: parsed, wrong: wrong, missing: parsed ? (${VALIDATOR})(parsed) : ['unparseable'] });
      }, function (e) { res({ sig: sig, decodeError: String(e) }); });
    })`));
    ok(res && res.sig, `${how}: not a png`);
    ok(res && !res.decodeError, `${how}: png does not decode: ${res && res.decodeError}`);
    ok(res && res.colours > 40, `${how}: screenshot looks blank (${res && res.colours} distinct colours) — captured outside the frame?`);
    ok(res && res.hasDump && res.parsed, `${how}: no parseable mclite-dump chunk in the png`);
    ok(res && res.missing && res.missing.length === 0, `${how}: dump is missing fields: ${res && res.missing && res.missing.join(', ')}`);
    if (how === 'F2' && res && res.parsed) {
      okAv(res.wrong === null, 'extract() returns null for a keyword that is not in the png');
      // 4. anti-vacuity: the validator fails when a field goes missing
      const bad = await page.evaluate(mk(`var d = JSON.parse(${JSON.stringify(JSON.stringify(res.parsed))}); delete d.world.seed; delete d.gfx.backend;
        var f = d.focus.crosshairTarget || d.focus.firstNonAir; if (f) delete f.faces['+y'];
        d.entitiesNear.list = [{ type: 'cow', x: 0, y: 0, z: 0 }];
        return (${VALIDATOR})(d);`));
      okAv(bad.includes('world.seed') && bad.includes('gfx.backend') && bad.includes('face +y') && bad.some((m) => /renderedY/.test(m)),
        `the validator names missing fields (${bad.slice(0, 4).join(', ')}…)`);
      const blank = await page.evaluate(mk(`var c = document.createElement('canvas'); c.width = c.height = 64; var g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64);
        var d = g.getImageData(0, 0, 64, 64).data, seen = {}, n = 0; for (var k = 0; k < d.length; k += 4) { var key = d[k] + ',' + d[k + 1] + ',' + d[k + 2]; if (!seen[key]) { seen[key] = 1; n++; } } return n;`));
      okAv(blank <= 40, `a black frame has ${blank} distinct colours, below the >40 blank threshold`);
      const emb = await page.evaluate(mk(`var png = MCL.SS.last.bytes, stripped = MCL.SS.embed(png, 'other', 'x'); return [MCL.SS.extract(stripped, 'mclite-dump') !== null, MCL.SS.extract(stripped, 'other')];`));
      okAv(emb[0] === true && emb[1] === 'x', 'embed() adds a tEXt chunk the extractor reads back and leaves the first one intact');
    }
  }
} finally {
  await page.close();
}

const problems = page.problems.filter((p) => !/favicon/i.test(p));
ok(problems.length === 0, `the page logged ${problems.length} errors: ${problems.slice(0, 3).join(' | ')}`);

say('');
say('================= sscheck =================');
say(` ${pass} assertions, ${breaks} breaks caught`);
say(` failures ........... ${fails.length}`);
for (const f of fails) say('   ✗ ' + f);
say('===========================================');
process.exit(fails.length ? 1 : 0);
