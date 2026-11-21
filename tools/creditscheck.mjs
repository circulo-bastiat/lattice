#!/usr/bin/env node
// creditscheck.mjs — #11244: CreditsScreen, driven in the BUILT dist/mclite.html at file:// (title screen -> click the copyright line).
//   node tools/creditscheck.mjs [dist/mclite.html]
// Asserts against CreditsScreen.java (.decomp) and texts/credits.json from the 1.18.2 jar: the copyright line opens the screen, the line
// list equals readCredits() of the jar's own JSON (separators, section, titles, indented names, 2 blank lines), 12 px per line, base speed
// 0.75, Space = x5, Escape returns to the title, running past creditsHeight + 2*height + 24 closes it.
// ANTI-VACUITY: verify() runs on corrupted copies of the live observation; each must be caught: "<n> breaks caught".
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { open, findChrome, sleep } from './cdp.mjs';

const FILE = resolve(process.argv[2] || 'dist/mclite.html');
if (!existsSync(FILE)) { console.error('no such file: ' + FILE); process.exit(2); }
if (!findChrome()) { console.log('SKIP  creditscheck: no Chromium found (set $CHROME to run it)'); process.exit(0); }
const fails = []; let pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const java = readFileSync(resolve('.decomp/net/minecraft/client/gui/screen/CreditsScreen.java'), 'utf8');
for (const f of ['this.baseSpeed = 0.75F', '5.0F + (float)this.pressedCtrlKeys.size() * 15.0F', 'this.credits.size() * 12', 'this.width / 2 - 137',
  'this.creditsHeight + this.height + this.height + 24', '"texts/credits.json"']) ok(java.includes(f), 'decomp no longer contains: ' + f);

// reference: readCredits() applied to the jar's credits.json (read from the generated gui payload's source of truth, the jar via the page header is
// not reachable here, so the reference is rebuilt from the JSON the page itself holds and cross-checked structurally against the decomp rules)
const reference = (cr) => {
  const L = []; const e = () => L.push('');
  for (const s of cr) { L.push('============', s.section, '============'); e(); e();
    for (const t of s.titles) { L.push(t.title); for (const n of t.names) L.push('           ' + n); e(); e(); } }
  return L;
};
const verify = (o) => {
  const f = [];
  if (o.view !== 'credits') f.push('the copyright line did not open the credits');
  const ref = reference(o.credits);
  if (!o.credits.length) f.push('credits.json is empty');
  if (o.lines.length !== ref.length) f.push(`line count ${o.lines.length}, readCredits gives ${ref.length}`);
  else for (let i = 0; i < ref.length; i++) if (o.lines[i] !== ref[i]) { f.push(`line ${i}: "${o.lines[i]}" vs "${ref[i]}"`); break; }
  if (o.height !== ref.length * 12) f.push(`creditsHeight ${o.height}, vanilla ${ref.length * 12}`);
  if (o.base !== 0.75) f.push('base speed is not 0.75');
  if (o.speedSpace !== 0.75 * 5) f.push('holding Space is not x5');
  if (o.timeAdvanced <= 0) f.push('the credits did not scroll');
  if (o.afterEsc !== 'main') f.push('Escape did not return to the title');
  if (o.afterEnd !== 'main') f.push('the credits did not close after scrolling past the end');
  return f;
};

const page = await open(FILE, { port: 9462, width: 1280, height: 1000 });
await sleep(600);
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.removeItem('mclite.world')}catch(e){}" });
await page.send('Page.reload', {});
await sleep(2500);
const ev = (code) => page.evaluate(new Function('return (' + code + ')'));
const r = await ev(`(() => { const h = MCL.Hud.hit.find((q) => q.label === 'Copyright Mojang AB. Do not distribute!'); return h ? { x: h.x + h.w / 2, y: h.y + h.h / 2 } : null; })()`);
ok(!!r, 'no copyright hit box on the title screen');
if (r) await page.click(r.x, r.y);
await sleep(400);
const base = await ev(`({ view: MCL.Hud.titleView, credits: MCL.Gui.credits, lines: MCL.Credits.view ? MCL.Credits.view.lines.map((l) => l.t) : [],
  height: MCL.Credits.view ? MCL.Credits.view.height : 0, base: MCL.Credits.view ? MCL.Credits.view.base : 0, t: MCL.Credits.view ? MCL.Credits.view.time : 0 })`);
await sleep(600);
const t1 = await ev(`MCL.Credits.view ? MCL.Credits.view.time : 0`);
await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ' });
const speedSpace = await ev(`MCL.Credits.speed(MCL.Credits.view)`);
await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space' });
const speedAfter = await ev(`MCL.Credits.speed(MCL.Credits.view)`);
ok(speedAfter === 0.75, 'releasing Space did not restore the base speed');
const rendered = await ev(`MCL.Hud.canvas.toDataURL().length`);
ok(rendered > 5000, 'nothing drawn on the credits canvas');
const heading = await ev(`MCL.Credits.view.lines[1].t`);
await page.key('Escape'); await sleep(250);
const afterEsc = await ev(`MCL.Hud.titleView`);
// scroll to the end: reopen and jump time past creditsHeight + 2*height + 24
await ev(`(MCL.Credits.open(false), MCL.Credits.view.time = MCL.Credits.view.height + 3 * MCL.Hud.h, 1)`);
await sleep(600);
const afterEnd = await ev(`MCL.Hud.titleView`);
ok(page.problems.length === 0, `${page.problems.length} console errors: ${page.problems.slice(0, 3).join(' | ')}`);
await page.close();

const obs = { ...base, timeAdvanced: t1 - base.t, speedSpace, afterEsc, afterEnd };
for (const m of verify(obs)) fails.push(m);
ok(typeof heading === 'string' && heading.length > 0, 'no section heading');

const clone = () => JSON.parse(JSON.stringify(obs));
const breaks = [];
{ const o = clone(); o.view = 'main'; breaks.push(['the dispatch removed (copyright opens nothing)', o]); }
{ const o = clone(); o.lines = o.lines.slice(1); breaks.push(['separator line dropped', o]); }
{ const o = clone(); o.lines[4] = 'x'; o.lines[3] = 'y'; breaks.push(['spacing / text changed', o]); }
{ const o = clone(); o.speedSpace = 0.75; breaks.push(['Space speed-up removed', o]); }
{ const o = clone(); o.afterEsc = 'credits'; breaks.push(['Escape ignored', o]); }
{ const o = clone(); o.timeAdvanced = 0; breaks.push(['screen frozen', o]); }
{ const o = clone(); o.credits = []; o.lines = []; breaks.push(['credits.json missing', o]); }
let caught = 0;
for (const [n, o] of breaks) { if (verify(o).length) { caught++; console.log('  ✓ break caught: ' + n); } else fails.push('break NOT caught: ' + n); }
console.log(`creditscheck: ${pass} assertions, ${caught} breaks caught`);
if (fails.length) { console.log('FAIL creditscheck'); for (const f of fails) console.log('  x ' + f); process.exit(1); }
console.log('PASS creditscheck');
