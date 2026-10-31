#!/usr/bin/env node
// phonegaugescheck.mjs - #4177: the phone Home gauges strip (usage disk, runners n/total, queue, regime, badges) with a mocked GitHub API.
// ANTI-VACUITY: each break must be caught ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const rd = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const SRC = { home: rd('phone-web/home.js'), app: rd('phone-web/app.js'), css: rd('phone-web/theme.css') };
let N = 0;
function run(S) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  const mod = { exports: {} }; new Function('module', S.home)(mod); const H = mod.exports;
  const T = (g) => Object.fromEntries(H.gauges(g).tiles.map((t) => [t.key, t])), B = (g) => H.gauges(g).badges.map((b) => b.key).join();
  const base = { disk: 50, runners: { online: 14, total: 16 }, quarantined: [], queue: 3, reds: 0, live: 2, fill: '3', factor: 1 };
  ok(H.parseDisk('{"diskFreeGB":42.5}') === 42.5 && H.parseDisk('{}') === null && H.parseDisk('junk') === null && H.parseDisk('{"diskFreeGB":-1}') === null, 'parseDisk');
  const runners = { runners: [{ name: 'a', labels: [{ name: 'gpu' }] }, { name: 'b', labels: [{ name: 'self-hosted' }] }] };
  ok(H.quarantined(runners).join() === 'b' && H.quarantined({ runners: [{ name: 'c', labels: [] }] }).length === 0 && H.quarantined(undefined).length === 0, 'quarantined: a runner without gpu while another has it');
  ok(T(base).runners.big === '14/16' && T(base).queue.big === '3' && T(base).disk.big === '50.0 GB' && T(base).disk.tone === 'ok', 'tiles read');
  ok(T({ ...base, disk: 7 }).disk.tone === 'bad' && T({ ...base, disk: 12 }).disk.tone === 'warn', 'disk tones');
  ok(T(base).regime.big === 'full' && T({ ...base, factor: 0.5 }).regime.big === 'quiet', 'regime full/quiet');
  ok(T({ ...base, runners: null, disk: null, queue: null }).runners.big === '?' && T({ ...base, disk: null }).disk.big === '?', 'unknown shows ?');
  ok(B(base) === '', 'no badges when healthy');
  ok(B({ ...base, reds: 3 }) === 'red' && B({ ...base, quarantined: ['b'] }) === 'quarantine', 'red and quarantine badges');
  ok(B({ ...base, live: 0 }) === 'idle' && B({ ...base, live: 0, fill: '0' }) === '' && B({ ...base, live: 0, runners: { online: 0, total: 16 } }) === '', 'fill-idle only when the fill is on, runners are up and nothing runs');
  ok(/Home\.gauges\(/.test(S.app) && /\$\{gaugesHtml\(live, red\)\}/.test(S.app) && /disk: Home\.parseDisk\(u\)/.test(S.app) && /\.gauges\{/.test(S.css), 'wired into Home and styled');
  return f;
}
const bad = run(SRC), total = N; if (bad.length) { for (const m of bad) console.log('FAIL ' + m); process.exit(1); }
const rep = (k, a, b) => (S) => { if (!S[k].includes(a)) throw new Error('no text: ' + a); return { ...S, [k]: S[k].split(a).join(b) }; };
const BREAKS = [
  ['disk bad threshold', rep('home', 'g.disk < dm ? \'bad\'', 'false ? \'bad\'')],
  ['quiet never shown', rep('home', "quiet ? 'quiet' : 'full'", "'full'")],
  ['red badge dropped', rep('home', 'if (g.reds) badges', 'if (false) badges')],
  ['quarantine badge dropped', rep('home', 'g.quarantined && g.quarantined.length', 'false')],
  ['idle ignores paused fill', rep('home', '!paused && ', '')],
  ['idle ignores live sessions', rep('home', 'g.live === 0 &&', 'true &&')],
  ['quarantine ignores gpu label', rep('home', "=== 'gpu'", "=== 'zzz'")],
  ['negative disk accepted', rep('home', 'g >= 0 ?', 'true ?')],
  ['runners tile loses total', rep('home', '${g.runners.online}/${g.runners.total}', '${g.runners.online}')],
  ['strip not on Home', rep('app', '${gaugesHtml(live, red)}', '')],
  ['disk never read', rep('app', 'disk: Home.parseDisk(u)', 'disk: null')],
  ['no css', rep('css', '.gauges{', '.gaugesx{')],
];
let caught = 0;
for (const [n, fn] of BREAKS) { let S; try { S = fn(SRC); } catch (e) { console.log('BROKEN BREAK ' + n + ': ' + e.message); process.exit(1); } if (run(S).length) { caught++; console.log(" ✓ break caught: " + n); } else console.log('NOT CAUGHT: ' + n); }
console.log(`phonegaugescheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${total}`);
console.log(" failures ........... 0");
process.exit(caught === BREAKS.length ? 0 : 1);
