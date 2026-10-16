#!/usr/bin/env node
// phoneshellcheck.mjs - #7807: the phone app's shell. Source checks on tabs.js / ui.js / theme.css / build.mjs / sw.js plus a run of the real registry and components.
// Breaks: a tab missing from the registry, a state colour reused for two meanings, a component without loading/empty/error, sw cache key not changing, reduced-motion ignored.
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const T = dirname(fileURLToPath(import.meta.url)), P = join(T, 'phone-web'), rd = (f) => readFileSync(join(P, f), 'utf8');
const SRC = { tabs: rd('tabs.js'), ui: rd('ui.js'), css: rd('theme.css'), app: rd('app.js'), html: rd('index.html'), screens: rd('qa/screens.json') };
const need = ['home', 'bugs', 'mobs', 'stats', 'requests'];
function run(S) {
  const f = []; const ok = (c, m) => { if (!c) f.push(m); };
  const tmp = mkdtempSync(join(tmpdir(), 'psc-')); mkdirSync(join(tmp, 'phone-web', 'qa'), { recursive: true });
  for (const n of ['build.mjs', 'sw.js', 'home.js', 'runs.js', 'subs.js', 'controls.js', 'requests.js', 'manifest.webmanifest']) cpSync(join(P, n), join(tmp, 'phone-web', n));
  for (const [n, k] of [['tabs.js', 'tabs'], ['ui.js', 'ui'], ['theme.css', 'css'], ['app.js', 'app'], ['index.html', 'html']]) writeFileSync(join(tmp, 'phone-web', n), S[k]);
  const req = createRequire(join(tmp, 'x.js')); let UI, Tabs;
  try { UI = req('./phone-web/ui.js'); globalThis.UI = UI; Tabs = req('./phone-web/tabs.js'); } catch (e) { f.push('modules do not load: ' + e.message); rmSync(tmp, { recursive: true, force: true }); return Promise.resolve(f); }
  const ids = Tabs.REG.map((t) => t.id);
  for (const id of need) ok(ids.includes(id), `tab "${id}" missing from the registry`);
  ok(Tabs.REG.length <= 5, 'more than 5 bottom-bar slots');
  for (const t of Tabs.REG) ok(typeof t.badge === 'function' && typeof t.render === 'function' && t.label && t.icon, `tab ${t.id} lacks badge/render/label/icon`);
  const scr = JSON.parse(S.screens).map((s) => s.hash);
  for (const t of Tabs.REG) ok(scr.includes(t.hash), `qa/screens.json lacks ${t.id}`);
  // fixed state meanings: six states, six different colour variables, each defined for light and dark
  const vars = ['working', 'waiting', 'review', 'blocked', 'landed', 'red'], dark = /prefers-color-scheme: dark\) \{ :root \{([^}]*)\}/.exec(S.css), light = /:root \{([^}]*)\}/.exec(S.css);
  const val = (blk, v) => (new RegExp('--' + v + ':(#[0-9a-f]{6})').exec(blk) || [])[1];
  for (const [nm, blk] of [['light', light && light[1]], ['dark', dark && dark[1]]]) { const vs = vars.map((v) => val(blk || '', v)); ok(vs.every(Boolean), `${nm}: a state colour is undefined`); ok(new Set(vs).size === vars.length, `${nm}: a state colour is used for two meanings`); }
  const chips = [...S.css.matchAll(/\.ui-chip\.(\w+) \{ color: var\(--(\w+)\)/g)].filter((m) => m[1] !== m[2]); ok(chips.length === 0, 'a chip class uses another state\'s colour');
  ok(Object.keys(UI.STATES).length === 6, 'state set is not the six fixed meanings');
  // every data component has loading / empty / error
  ok(UI.Async({ loading: true }, () => 'x').includes('ui-skel'), 'Async: no loading state');
  ok(UI.Async({ empty: true }, () => 'x', { emptyText: 'nothing' }).includes('ui-empty'), 'Async: no empty state');
  const er = UI.Async({ err: new Error('GitHub 403 on GET /repos/x') }, () => 'x'); ok(er.includes('ui-error') && er.includes('Retry') && !/403|GET /.test(er), 'Async: error state missing Retry or leaks the raw GitHub error');
  ok(UI.Async({}, () => 'READY') === 'READY', 'Async: ready state lost');
  ok(UI.status({ live: 6, landed: 4, needs: 0 }) === '6 workers running, 4 landed this hour. Nothing needs you.', 'status sentence wrong');
  ok(UI.ProgressBar(50, 80).includes('<u'), 'ProgressBar: no target tick');
  ok(/reduced\(\)/.test(S.ui) && /prefers-reduced-motion: reduce/.test(S.css) && /animation: none/.test(S.css), 'reduced motion ignored');
  ok(/if \(!isFinite\(to\) \|\| reduced\(\)/.test(S.ui), 'count-up ignores reduced motion');
  ok(/Escape/.test(S.ui) && /popstate/.test(S.ui) && /touchend/.test(S.ui), 'BottomSheet: Esc, back or swipe-down missing');
  ok(/last-tab/.test(S.tabs) && /try \{ localStorage/.test(S.tabs), 'last tab not remembered inside try/catch');
  ok(/\/\*THEME\*\//.test(S.html) && /@media \(prefers-color-scheme: dark\)/.test(S.css), 'theme not inlined or no dark scheme');
  return import('node:child_process').then(({ execFileSync }) => {
    const key = (dir) => { execFileSync('node', [join(tmp, 'phone-web', 'build.mjs'), dir], { stdio: 'pipe' }); return /BUILD = '([^']+)'/.exec(readFileSync(join(dir, 'sw.js'), 'utf8'))?.[1]; };
    const a = key(join(tmp, 'o1')); writeFileSync(join(tmp, 'phone-web', 'runs.js'), readFileSync(join(tmp, 'phone-web', 'runs.js'), 'utf8') + '\n// changed');
    const b = key(join(tmp, 'o2')); ok(a && /^mclite-/.test(a) && b && a !== b, 'sw cache key does not change when a phone-web file changes');
    rmSync(tmp, { recursive: true, force: true }); return f;
  });
}
const fails = await run(SRC); for (const m of fails) console.log('FAIL: ' + m);
const rep = (k, a, b) => (S) => { if (!S[k].includes(a)) throw new Error(`break: no such text in ${k}: ${a}`); return { ...S, [k]: S[k].replace(a, b) }; };
const BR = [
  ['a tab missing from the registry', rep('tabs', "id: 'mobs'", "id: 'mobz'")],
  ['a tab not in qa/screens.json', rep('screens', '"#/bugs"', '"#/nope"')],
  ['two states share a colour', rep('css', '--landed:#17703a', '--landed:#1d62d8')],
  ['dark state colour undefined', rep('css', '--review:#c39bff', '--review:purple')],
  ['no loading state', rep('ui', 'st.loading ? Skeleton(opts.rows) : ', '')],
  ['no empty state', rep('ui', 'st.empty ? EmptyState', 'st.emptyx ? EmptyState')],
  ['error leaks the raw GitHub text', rep('ui', '<p>${E(plain(e))}</p>', '<p>${E(e && e.message)}</p>')],
  ['error has no Retry', rep('ui', '<button class="alt" data-act="${E(retryId)}">Retry</button>', '')],
  ['count-up ignores reduced motion', rep('ui', '|| reduced() ||', '||')],
  ['css ignores reduced motion', rep('css', 'animation: none !important', 'animation: auto')],
  ['no sheet Escape', rep('ui', "e.key === 'Escape'", "e.key === 'Esc0'")],
  ['last tab not remembered safely', rep('tabs', 'try { localStorage.setItem', '{ localStorage.setItem')],
  ['sw key is constant', null],
  ['status sentence changed', rep('ui', ": 'Nothing needs you.'", ": 'All good.'")],
];
let caught = 0;
for (const [name, fn] of BR) {
  let r;
  if (!fn) { const S2 = { ...SRC }; r = await runSwConst(S2); } else { try { r = await run(fn(SRC)); } catch (e) { console.log('NO-OP BREAK: ' + name + ' ' + e.message); continue; } }
  if (r.length) caught++; else console.log('NOT CAUGHT: ' + name);
}
async function runSwConst(S) { // build.mjs that stamps a fixed key
  const orig = rd('build.mjs');
  return (await runWithBuild(S, orig.replace(/'mclite-' \+ createHash\('sha1'\)\.update\(Buffer\.concat\(bufs\)\)\.digest\('hex'\)\.slice\(0, 10\)/, "'mclite-const'")));
}
async function runWithBuild(S, build) { const keep = readFileSync(join(P, 'build.mjs'), 'utf8'); if (build === keep) throw new Error('no-op'); const { execFileSync } = await import('node:child_process'); const d = mkdtempSync(join(tmpdir(), 'pscb-')); mkdirSync(join(d, 'phone-web'), { recursive: true }); for (const n of ['sw.js', 'home.js', 'runs.js', 'subs.js', 'controls.js', 'requests.js', 'manifest.webmanifest', 'tabs.js', 'ui.js', 'theme.css', 'app.js', 'index.html']) cpSync(join(P, n), join(d, 'phone-web', n)); writeFileSync(join(d, 'phone-web', 'build.mjs'), build);
  const k = (o) => { execFileSync('node', [join(d, 'phone-web', 'build.mjs'), o], { stdio: 'pipe' }); return /BUILD = '([^']+)'/.exec(readFileSync(join(o, 'sw.js'), 'utf8'))[1]; };
  const a = k(join(d, 'o1')); writeFileSync(join(d, 'phone-web', 'runs.js'), readFileSync(join(d, 'phone-web', 'runs.js'), 'utf8') + '\n// x'); const b = k(join(d, 'o2')); rmSync(d, { recursive: true, force: true }); return a === b ? ['sw cache key does not change'] : []; }
console.log(`phoneshellcheck: ${fails.length ? fails.length + ' FAILURES, ' : ''}${caught} breaks caught (of ${BR.length})`);
process.exit(fails.length || caught < BR.length ? 1 : 0);
