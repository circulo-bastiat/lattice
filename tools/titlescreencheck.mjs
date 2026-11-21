#!/usr/bin/env node
// titlescreencheck.mjs — #11228: the vanilla TITLE SCREEN, driven in the BUILT dist/mclite.html at file:// (like titlecheck.mjs).
//   node tools/titlescreencheck.mjs [dist/mclite.html]
// Asserts, against TitleScreen.java's own layout (tools reads .decomp for the constants):
//   * buttons present with vanilla labels and positions at GUI scales 1, 2 and 3
//   * the panorama advances (RotatingCubeMapRenderer.time) and is drawn
//   * NO world is generated before Singleplayer -> Create world
//   * Options... / language / accessibility open the existing options screens and Escape returns; Quit Game shows the closed screen
// ANTI-VACUITY: the verifier is run on corrupted copies of what the live page reported (button removed, moved, renamed, world
// generated early, panorama frozen) and each must be caught: "<n> breaks caught".
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { open, findChrome, sleep } from './cdp.mjs';

const FILE = resolve(process.argv[2] || 'dist/mclite.html');
if (!existsSync(FILE)) { console.error('no such file: ' + FILE); process.exit(2); }
if (!findChrome()) { console.log('SKIP  titlescreencheck: no Chromium found (set $CHROME to run it)'); process.exit(0); }

// the layout constants come from the decomp, not memory
const SRC = resolve('.decomp/net/minecraft/client/gui/screen/TitleScreen.java');
const java = existsSync(SRC) ? readFileSync(SRC, 'utf8') : '';
const fails = []; let pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
if (java) {
  for (const frag of ['this.height / 4 + 48', 'this.width / 2 - 124', 'this.width / 2 + 104', '$$3 + 72 + 12', 'new TranslatableText("menu.quit")',
    'new TranslatableText("menu.singleplayer")', 'new TranslatableText("menu.options")', 'this.width / 2 - 137', 'Copyright Mojang AB. Do not distribute!'])
    ok(java.includes(frag), 'the decomp no longer contains: ' + frag);
}

const expected = (gw, gh) => {
  const y0 = Math.floor(gh / 4) + 48, cx = Math.floor(gw / 2), by = y0 + 72 + 12;
  return [['Singleplayer', cx - 100, y0, 200, 20, true], ['Multiplayer', cx - 100, y0 + 24, 200, 20, false],
    ['Minecraft Realms', cx - 100, y0 + 48, 200, 20, false], ['Options...', cx - 100, by, 98, 20, true],
    ['Quit Game', cx + 2, by, 98, 20, true], ['Language', cx - 124, by, 20, 20, true], ['Accessibility Settings', cx + 104, by, 20, 20, true]];
};
// verify(obs): obs = { scales: [{scale, gw, gh, hits:[{label,x,y,w,h,disabled}]}], worldBuilt, t0, t1, px0, px1 } -> list of failures
const verify = (o) => {
  const f = [];
  for (const s of o.scales) for (const [label, x, y, w, h, active] of expected(s.gw, s.gh)) {
    const hit = s.hits.find((q) => q.label === label);
    if (!hit) { f.push(`scale ${s.scale}: no "${label}" button`); continue; }
    if (hit.x !== x * s.scale || hit.y !== y * s.scale || hit.w !== w * s.scale || hit.h !== h * s.scale)
      f.push(`scale ${s.scale}: "${label}" at ${hit.x},${hit.y} ${hit.w}x${hit.h}, vanilla ${x * s.scale},${y * s.scale} ${w * s.scale}x${h * s.scale}`);
    if (!!hit.disabled === active) f.push(`scale ${s.scale}: "${label}" active state wrong`);
  }
  if (o.worldBuilt) f.push('a world was generated before Singleplayer -> Create world');
  if (!(o.t1 > o.t0)) f.push('the panorama did not advance');
  if (o.px0 === o.px1) f.push('the panorama pixels did not change');
  return f;
};

const page = await open(FILE, { port: 9461, width: 1280, height: 1000 });
await sleep(600);
await page.evaluate(() => { try { localStorage.removeItem('mclite.world'); } catch (e) { /* none */ } return 1; });
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.removeItem('mclite.world')}catch(e){}" });
await page.send('Page.reload', {});
await sleep(2500);

const ev = (code) => page.evaluate(new Function('return (' + code + ')'));
const scales = [];
for (const sc of [1, 2, 3]) {
  scales.push(await ev(`((sc) => {
    const H = MCL.Hud; MCL.Settings.guiScale = sc; H.resize(H.w, H.h, H.dpr);
    return { scale: H.scale, gw: H.w / H.scale, gh: H.h / H.scale, mode: H.mode, view: H.titleView,
      hits: H.hit.map((q) => ({ label: q.label, x: q.x, y: q.y, w: q.w, h: q.h, disabled: !!q.disabled })) };
  })(${sc})`));
}
ok(scales.every((s) => s.mode === 'title' && s.view === 'main'), 'the game does not open on the title view');
ok(scales.map((s) => s.scale).join() === '1,2,3', 'the three GUI scales did not apply: ' + scales.map((s) => s.scale));
const snap = () => page.evaluate(() => { const c = MCL.Hud.ctx; const d = c.getImageData(0, 0, MCL.Hud.canvas.width, 4).data; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0; return { t: MCL.Title.time, h }; });
const a = await snap(); await sleep(1500); const b = await snap();
const st = await page.evaluate(() => ({ worldBuilt: !!(MCL.World && MCL.World.chunks && MCL.World.chunks.size), ready: !!MCL.Main.ready,
  splash: MCL.Title.splash, labels: MCL.Hud.hit.map((q) => q.label), logo: !!MCL.Gui.sheets.title_logo && !!MCL.Gui.sheets.title_edition && !!MCL.Gui.sheets.accessibility }));
const obs = { scales, worldBuilt: st.worldBuilt || st.ready, t0: a.t, t1: b.t, px0: a.h, px1: b.h };
for (const m of verify(obs)) fails.push(m);
ok(st.logo, 'the logo / edition / accessibility sheets are not in the gui payload');
ok(typeof st.splash === 'string' && st.splash.length > 0, 'no splash text picked');
ok(st.labels.includes(`Copyright Mojang AB. Do not distribute!`), 'no copyright line');
// the old seed-field + Play screen is NOT the root
ok(!st.labels.includes('Create world') && !st.labels.includes('Earth'), 'the old seed/Play/climate rows are still on the root screen');

const click = async (label) => {
  const r = await ev(`(() => { const h = MCL.Hud.hit.find((q) => q.label === ${JSON.stringify(label)}); return h ? { x: h.x + h.w / 2, y: h.y + h.h / 2 } : null; })()`);
  if (r) { await page.click(r.x, r.y); await sleep(250); }
  return !!r;
};
const view = () => page.evaluate(() => ({ v: MCL.Hud.titleView, o: MCL.Options.screen, built: !!(MCL.World && MCL.World.chunks && MCL.World.chunks.size) }));
// disabled buttons do nothing
await click('Multiplayer'); ok((await view()).v === 'main', 'Multiplayer (inactive) did something');
await click('Options...'); let v = await view(); ok(v.v === 'options' && v.o === 'options', 'Options... did not open the options screen');
await page.key('Escape'); await sleep(200); v = await view(); ok(v.v === 'main' && !v.o, 'Escape did not return from Options to the title');
await click('Accessibility Settings'); v = await view(); ok(v.o === 'accessibility', 'accessibility button did not open Accessibility Settings');
await page.key('Escape'); await sleep(200);
await click('Language'); v = await view(); ok(v.o === 'language', 'language button did not open Language');
await page.key('Escape'); await sleep(200);
await click('Singleplayer'); v = await view(); ok(v.v === 'worlds' && !v.built, 'Singleplayer did not open the Select World screen (or built a world)');
await click('Create New World'); v = await view(); ok(v.v === 'create' && !v.built, 'Create New World did not open the create-world panel (or built a world)');
// #11262: the climate row sits on the create-world panel itself when it fits (More World Options only in a short window)
ok(await page.evaluate(() => MCL.Hud.hit.some((h) => h.label === 'Earth')), 'the Earth/climate toggle is not reachable from Create New World');
await click('More World Options...');
await click('Done');
await page.key('Escape'); await sleep(200); ok((await view()).v === 'worlds', 'Escape did not leave the create-world panel for Select World');
await page.key('Escape'); await sleep(200); ok((await view()).v === 'main', 'Escape did not leave Select World');
await page.evaluate(() => { window.__closed = 0; window.close = () => { window.__closed++; }; return 1; });
await click('Quit Game'); ok((await view()).v === 'quit', 'Quit Game did not show the closed screen');
ok(await page.evaluate(() => window.__closed === 1), 'Quit Game did not try window.close()');
ok(page.problems.length === 0, `${page.problems.length} console errors: ${page.problems.slice(0, 3).join(' | ')}`);
await page.close();

// ── anti-vacuity: corrupt what the live page reported, each break must be caught ──────────────
ok(verify(obs).length === 0 || fails.length > 0, 'verify() disagrees with the live checks');
const clone = () => JSON.parse(JSON.stringify(obs));
const breaks = [];
{ const o = clone(); o.scales[1].hits = o.scales[1].hits.filter((q) => q.label !== 'Quit Game'); breaks.push(['Quit Game removed', o]); }
{ const o = clone(); o.scales[2].hits.find((q) => q.label === 'Options...').y += 1; breaks.push(['Options... moved 1px', o]); }
{ const o = clone(); o.scales[0].hits.find((q) => q.label === 'Singleplayer').label = 'Play'; breaks.push(['Singleplayer renamed', o]); }
{ const o = clone(); o.worldBuilt = true; breaks.push(['world generated at title', o]); }
{ const o = clone(); o.t1 = o.t0; breaks.push(['panorama frozen', o]); }
{ const o = clone(); o.scales[0].hits.find((q) => q.label === 'Multiplayer').disabled = false; breaks.push(['Multiplayer active', o]); }
let caught = 0;
for (const [n, o] of breaks) { if (verify(o).length) { caught++; console.log("  ✓ break caught: " + n); } else fails.push('break NOT caught: ' + n); }
console.log(`titlescreencheck: ${pass} assertions, ${caught} breaks caught`);
if (fails.length) { console.log('FAIL titlescreencheck'); for (const f of fails) console.log('  x ' + f); process.exit(1); }
console.log('PASS titlescreencheck');
