#!/usr/bin/env node
// guilayoutcheck.mjs - #11262: no two interactive widgets of any screen overlap and none leaves the screen, at GUI scales 1..4
// and 6 window sizes (small, tall, wide), driven in the BUILT dist/mclite.html at file:// by reading the real Hud.hit / Options.hit
// rectangles (the same rectangles click() walks). Scaled size = ceil(window / scale) exactly as Window.getScaledWidth.
//   node tools/guilayoutcheck.mjs [dist/mclite.html]
// ANTI-VACUITY: verify() runs on corrupted copies of what the live page reported (a widget moved onto its neighbour, pushed off
// the screen) and each must be caught: "<n> breaks caught".
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { open, findChrome, sleep } from './cdp.mjs';

const FILE = resolve(process.argv[2] || 'dist/mclite.html');
if (!existsSync(FILE)) { console.error('no such file: ' + FILE); process.exit(2); }
if (!findChrome()) { console.log('SKIP  guilayoutcheck: no Chromium found (set $CHROME to run it)'); process.exit(0); }

const SIZES = [[854, 480], [640, 480], [1280, 720], [1920, 1080], [480, 900], [1366, 768]];
const SCALES = [1, 2, 3, 4];
const TITLE_VIEWS = ['main', 'worlds', 'create', 'create:more', 'editworld', 'confirmdelete', 'credits', 'quit'];

// verify(obs): obs = [{ screen, w, h, scale, gw, gh, hits:[{label,x,y,w,h}] }] (pixel rects) -> failures
const verify = (obs) => {
  const f = [];
  for (const o of obs) {
    const tag = `${o.screen} ${o.w}x${o.h} g${o.scale}`;
    const hs = o.hits.filter((q) => q.w > 0 && q.h > 0 && !q.skip);
    for (const q of hs) if (q.x < 0 || q.y < 0 || q.x + q.w > o.w + 0.01 || q.y + q.h > o.h + 0.01)
      f.push(`${tag}: "${q.label}" leaves the screen (${q.x},${q.y} ${q.w}x${q.h})`);
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
      const a = hs[i], b = hs[j];
      if (a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01)
        f.push(`${tag}: "${a.label}" overlaps "${b.label}"`);
    }
  }
  return f;
};

const page = await open(FILE, { port: 9471, width: 1280, height: 1000 });
await sleep(600);
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.removeItem('mclite.world')}catch(e){}" });
await page.send('Page.reload', {});
await sleep(2500);
const ev = (code) => page.evaluate(new Function('return (' + code + ')'));
const ONLY = new Set(process.argv.slice(3));

const screens = await ev(`(() => ({ opts: Object.keys(MCL.Options.ROWS) }))()`);
const list = [...TITLE_VIEWS.map((v) => ['title:' + v, v, null]), ...screens.opts.filter((n) => n !== 'gamerules').concat(['gamerules']).map((n) => ['options:' + n, 'options', n])];
const obs = [];
for (const [name, view, opt] of list) for (const [w, h] of SIZES) for (const sc of SCALES) {
  const o = await ev(`((name, view, opt, w, h, sc) => {
    const H = MCL.Hud, O = MCL.Options, SW = MCL.SelectWorld;
    const more = view === 'create:more'; if (more) view = 'create';
    H.mode = 'title'; O.screen = null; O.stack.length = 0; H.titleHasSave = false; H.titleView = view;
    if (MCL.CreateWorld && !MCL.CreateWorld.st) { MCL.CreateWorld.open(); H.titleView = 'main'; H.titleView = view; }
    if (MCL.CreateWorld && MCL.CreateWorld.st) { MCL.CreateWorld.st.more = more; MCL.CreateWorld.st.sub = false; }
    if (SW) { SW.edit = view === 'editworld' ? { id: 'x', name: 'New World' } : null; SW.confirm = view === 'confirmdelete' ? { id: 'x', name: 'New World' } : null; }
    if (opt === 'gamerules') MCL.GameRules.open(); else if (opt) O.open(opt);
    MCL.Settings.guiScale = sc; O.hit.length = 0; H.hit.length = 0; H.resize(w, h, 1); H.draw();
    const GRS = opt === 'gamerules' ? MCL.GameRules.state : null;
    const src = GRS ? GRS.hit.map((q) => ({ x: q.x * H.scale, y: q.y * H.scale, w: q.w * H.scale, h: q.h * H.scale, label: q.kind + (q.name || '') })) : opt ? O.hit : H.hit;
    return { screen: name, w, h, scale: H.scale, gw: Math.ceil(w / H.scale), gh: Math.ceil(h / H.scale),
      view: H.titleView, hits: src.map((q) => ({ label: String(q.label || ''), x: q.x, y: q.y, w: q.w, h: q.h })) };
  })(${JSON.stringify(name)}, ${JSON.stringify(view)}, ${JSON.stringify(opt)}, ${w}, ${h}, ${sc})`);
  if (!o) { console.log("null result", name, w, h, sc, page.problems.slice(-2)); continue; }
  if (!obs.some((x) => x.screen === o.screen && x.w === o.w && x.h === o.h && x.scale === o.scale)) obs.push(o);
}
const fails = [];
for (const o of obs) if (!o.hits.length && !/credits|quit/.test(o.screen)) fails.push(`${o.screen} ${o.w}x${o.h} g${o.scale}: no widgets read`);
fails.push(...verify(obs));
fails.push(...page.problems.map((p) => 'console: ' + p).slice(0, 3));
await page.close();

// anti-vacuity
const clone = () => JSON.parse(JSON.stringify(obs));
const breaks = [];
{ const o = clone(); const t = o.find((x) => x.hits.length > 2); t.hits[1].x = t.hits[0].x; t.hits[1].y = t.hits[0].y; breaks.push(['widget moved onto its neighbour', o]); }
{ const o = clone(); const t = o.find((x) => x.hits.length > 2); t.hits[0].y = t.h - 1; breaks.push(['widget pushed off the bottom', o]); }
{ const o = clone(); const t = o.find((x) => x.hits.length > 2); t.hits[0].x = -3; breaks.push(['widget pushed off the left', o]); }
let caught = 0;
const baseline = verify(obs).length;
for (const [n, o] of breaks) { if (verify(o).length > baseline) caught++; else fails.push('break NOT caught: ' + n); }
console.log(`guilayoutcheck: ${obs.length} screen/size/scale cases, ${caught} breaks caught`);
const uniq = [...new Set(fails)];
if (uniq.length) { console.log('FAIL guilayoutcheck (' + uniq.length + ')'); for (const f of uniq) console.log('  x ' + f); process.exit(1); }
console.log('PASS guilayoutcheck');
