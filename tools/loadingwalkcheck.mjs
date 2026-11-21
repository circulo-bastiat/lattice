#!/usr/bin/env node
// loadingwalkcheck.mjs — #11401: WALK every path that can show a loading/progress screen in the BUILT dist/mclite.html (file://, real clicks) and fail if any
// text drawn while Hud.mode is 'loading' or 'saving' is not a vanilla one, or if the old custom screen ('MC-Lite' title, 'loading…' label, #0b0d10 bar) is drawn.
// Paths: first boot (no GUI yet -> SplashOverlay red fill), Singleplayer > Create New World > world warm-up (LevelLoadingScreen / DownloadingTerrainScreen),
// pause > Save and Quit to Title (ProgressScreen 'Saving level'; the page reloads, so the log lives in sessionStorage), then the title again.
// Portal / respawn / End exit draw NO loading screen in MC-Lite (instant teleport); the static half pins that: only the five Hud modes exist and the
// only callers of the Progress screens are the three known sites, so a new screen cannot appear without this check being updated.
// Vanilla allow-list: .decomp DownloadingTerrainScreen ("Loading terrain..."), LevelLoadingScreen ("N%"), ProgressScreen (title + "task N%").
// ANTI-VACUITY: mutated copies of the built page that bring the old screen back, or an unknown string, must each fail the walk.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { open, sleep } from './cdp.mjs';

const DIST = resolve('dist/mclite.html');
const VANILLA = [/^Loading terrain\.\.\.$/, /^\d{1,3}%$/, /^Saving level$/, /^Saving chunks$/, /^Working\.\.\. ?\d{0,3}%?$/];
const OLD = [/MC-Lite/i, /loading…/i, /^loading\.\.\.?$/i, /^Generating/i, /^Building/i];
// the recorder runs BEFORE the page's scripts: it wraps Gui.text (the only way text reaches the overlay; re-installed in every rAF so a replaced Gui.text is still seen) and full-screen fills, tags each with Hud.mode
const INIT = `(function(){var log=[];try{log=JSON.parse(sessionStorage.__lw||'[]')}catch(e){}
function rec(k,v){var m=(window.MCL&&MCL.Hud&&MCL.Hud.mode)||'?';var s=m+'|'+k+'|'+v;if(log.indexOf(s)<0){log.push(s);try{sessionStorage.__lw=JSON.stringify(log)}catch(e){}}}
var fr=CanvasRenderingContext2D.prototype.fillRect;CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){if(w>=300&&h>=200&&typeof this.fillStyle==='string')rec('fill',this.fillStyle);return fr.apply(this,arguments)};
var ft=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(t){rec('text',String(t));return ft.apply(this,arguments)};
function wrapGui(){var g=window.MCL&&MCL.Gui;if(g&&g.text&&!g.text.__w){var t=g.text;g.text=function(c,s){rec('text',String(s));return t.apply(this,arguments)};g.text.__w=1}}
var raf=window.requestAnimationFrame;window.requestAnimationFrame=function(cb){return raf.call(window,function(ts){wrapGui();return cb(ts)})};
window.__lwLog=function(){return log}})();`;

async function scenario(file, port) {
  const page = await open(file, { port, width: 900, height: 600, initScript: INIT });
  if (!page) { console.log('SKIP  loadingwalkcheck: no Chromium'); process.exit(0); }
  const a = (c, m) => { if (!c) throw new Error(m); };
  const click = async (label) => {
    const r = await page.evaluate(new Function('return (() => { const h = MCL.Hud.hit.find((q) => q.label === ' + JSON.stringify(label) + '); return h ? { x: h.x + h.w / 2, y: h.y + h.h / 2 } : null; })()'));
    if (!r) throw new Error('no "' + label + '" on screen: ' + JSON.stringify(await page.evaluate(() => [MCL.Hud.mode, MCL.Hud.screen, MCL.Options.screen, MCL.Hud.hit.map((q) => q.label)])));
    await page.click(r.x, r.y); await sleep(350);
  };
  try {
    await sleep(2500);
    a(await page.waitFor(() => !!(window.MCL && MCL.Main.titleShown && MCL.Hud.mode === 'title' && MCL.Hud.titleView === 'main'), 60000), 'title never shown');
    await click('Singleplayer'); await sleep(400);
    await click('Create New World'); await click('Create New World');
    a(await page.waitFor(() => !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20), 240000), 'world never reached game mode');
    await sleep(1500);
    await page.evaluate(() => { MCL.Hud.open('pause'); MCL.Options.open('pause'); }); await sleep(600);   // the pause screen, as Esc opens it
    await page.evaluate(() => MCL.Options.pauseRows().find((r) => r.label === 'Save and Quit to Title').fn());   // the row's own handler (the pause screen keeps its rows in Options, not Hud.hit)
    await sleep(4000);   // reload; sessionStorage carries the log
    a(await page.waitFor(() => !!(window.MCL && MCL.Hud.mode === 'title'), 60000), 'no title after Save and Quit');
    const log = await page.evaluate(() => window.__lwLog());
    const shown = log.filter((s) => /^(loading|saving)\|/.test(s));
    const bad = [];
    for (const s of shown) {
      const [mode, kind, v] = s.split('|');
      if (kind === 'text') { if (OLD.some((r) => r.test(v)) || !VANILLA.some((r) => r.test(v))) bad.push(s); }
      else if (/^#?0b0d10$/i.test(v) || /rgb\(11, ?13, ?16\)/.test(v)) bad.push(s);
    }
    if (bad.length) return 'non-vanilla loading/progress drawing: ' + bad.join(' ; ');
    if (!shown.some((s) => /^loading\|fill\|#ef323d/i.test(s)) && !shown.some((s) => /^loading\|text\|/.test(s))) return 'vacuous: no loading screen was observed at all (' + log.length + ' log lines)';
    if (!shown.includes('saving|text|Saving level')) return 'Save and Quit did not show the vanilla "Saving level" screen: ' + shown.join(' ; ');
    return { ok: shown };
  } catch (e) { return 'walk failed: ' + e.message; }
  finally { await page.close(); }
}

const html = readFileSync(DIST, 'utf8');
const fails = [];
// static half: modes and Progress callers
const modes = new Set([...html.matchAll(/\b(?:H|NS\.Hud|Hud)\.mode = '(\w+)'/g)].map((m) => m[1]));
for (const m of modes) if (!['loading', 'title', 'game', 'fatal', 'saving'].includes(m)) fails.push('unknown Hud mode assigned: ' + m + ' (a new screen: audit it against .decomp and extend this check)');
const callers = (html.match(/NS\.Progress\.(?:start\w+|set\w*|draw\w+)\(/g) || []).sort().join(',');
const want = ['NS.Progress.drawDownloading(', 'NS.Progress.drawLevelLoading(', 'NS.Progress.drawLevelLoading(', 'NS.Progress.drawProgress(', 'NS.Progress.setGrid(', 'NS.Progress.startSaving('].sort().join(',');
if (callers !== want) fails.push('Progress screen call sites changed: ' + callers + ' (audit the new screen, then update this list)');

const real = await scenario(DIST, 9491);
if (typeof real === 'string') fails.push(real);
else console.log('walk ok; drawn while loading/saving: ' + real.ok.join(' ; '));

const dir = mkdtempSync(join(tmpdir(), 'lwc-'));
const mutants = [
  ['old title returns on the splash', "c.fillStyle = '#EF323D'; c.fillRect(0, 0, H.w, H.h);", "c.fillStyle = '#0b0d10'; c.fillRect(0, 0, H.w, H.h);"],
  ['old MC-Lite label in Downloading', "ctext(c, P.TEXT.loadingTerrain,", "ctext(c, 'MC-Lite loading…',"],
  ['unknown string on Saving', "P.TEXT.savingLevel, P.TEXT.working, 0", "'Generating world', P.TEXT.working, 0"],
];
let caught = 0, n = 0;
for (const [name, from, to] of mutants) {
  if (!html.includes(from)) { fails.push('mutant target missing: ' + name); continue; }
  const f = join(dir, 'm' + n + '.html'); writeFileSync(f, html.split(from).join(to));
  const bad = await scenario(f, 9492 + n++);
  if (typeof bad === 'string') { caught++; console.log('  ✓ break caught: ' + name + ' (' + bad.slice(0, 110) + ')'); } else fails.push('break NOT caught: ' + name);
}
console.log(`loadingwalkcheck: ${caught} breaks caught (of ${mutants.length})`);
console.log(`loadingwalkcheck: ${3 + mutants.length} assertions, ${fails.length} failed`);
if (fails.length) { console.log('FAIL loadingwalkcheck'); fails.forEach((f) => console.log('  x ' + f)); process.exit(1); }
console.log('PASS loadingwalkcheck');
