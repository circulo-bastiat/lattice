#!/usr/bin/env node
// phonerunscheck.mjs - #4175 (PHONE step 2): the live runs home screen of the phone PWA.
// Part 1 (node): the pure logic in phone-web/runs.js - role, issue tag, last line, finished-run summaries, timers - and the launcher's issue tag.
// Part 2 (headless Chromium, phone-sized): the real app against a MOCKED GitHub API on localhost - cards, live timer, auto-refresh (shortened for
// the test), queued runs, collapsed finished runs, the tap-through detail, an API error. Screenshots go to assets/phone-runs-*.png (never the lander's job to start).
// ANTI-VACUITY: every break below must be caught ("<n> breaks caught").
import http from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { open, findChrome, sleep } from './cdp.mjs';
const T = fileURLToPath(new URL('.', import.meta.url)), ROOT = join(T, '..'), rd = (p) => readFileSync(join(T, p), 'utf8');
const SRC = { runs: rd('phone-web/runs.js'), home: rd('phone-web/home.js'), controls: rd('phone-web/controls.js'), app: rd('phone-web/app.js'), html: rd('phone-web/index.html'), build: rd('phone-web/build.mjs'), subs: rd('phone-web/subs.js'), sw: rd('phone-web/sw.js'), manifest: rd('phone-web/manifest.webmanifest'), launch: rd('brain/launch.mjs') };
const SHOTS = join(ROOT, 'assets');
const REPO = 'owner/mclite', NOW = () => Date.now(), ago = (min) => new Date(NOW() - min * 60e3).toISOString();
let N = 0;

// ---------- part 1: the pure logic
function logic(S, d) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  writeFileSync(join(d, 'runs.cjs'), S.runs); const Runs = createRequire(import.meta.url)(join(d, 'runs.cjs'));
  ok(Runs.roleOf({ display_title: 'brain worker @max' }) === 'worker' && Runs.accountOf({ display_title: 'brain worker @max' }) === 'max', 'a worker run is a worker, on account max');
  ok(['commander', 'fixer', 'tester', 'waker'].every((r) => Runs.roleOf({ display_title: `brain ${r}` }) === r), 'commander, fixer, tester, waker are told apart');
  ok(Runs.roleOf({ display_title: 'brain issue_comment', name: 'brain issue_comment' }) === 'mail', 'a bus-woken run is a mail run');
  ok(Runs.roleOf({ name: 'land', display_title: '#4338 land' }) === 'land' && Runs.roleOf({ name: 'full-suite', display_title: 'full-suite' }) === 'full-suite' && Runs.roleOf({ name: 'localcopy', display_title: 'localcopy' }) === 'other', 'lander and full suite are recognised, anything else is just a run');
  ok(new Set(['worker', 'tester', 'fixer', 'commander', 'waker', 'land', 'full-suite'].map((r) => Runs.COLOURS[r])).size === 7, 'every role has its own colour');
  // the launcher's tag round-trips through the app's parser
  const m = /body: `(<!-- brain-run [^`]*)`/.exec(S.launch);
  ok(!!m, 'launch.mjs tags the worker issue with a brain-run comment');
  if (m) {
    const body = m[1].replace(/\\n/g, '\n').replace('${process.env.GITHUB_RUN_ID}', '37700000001').replace('${issueNo}', '4175').replace('${MODEL}', 'claude-haiku-5-5').replace(/\$\{ttl[^}]*\}(?:\.trim\(\))?/, 'PHONE step 2: live runs view');
    const mk = Runs.parseMarkers([{ body, html_url: 'u' }])['37700000001'];
    ok(mk && mk.issue === 4175 && mk.role === 'worker' && mk.title === 'PHONE step 2: live runs view' && mk.model === 'claude-haiku-5-5', 'the launcher\'s tag is read back as run -> issue + title + model');
  }
  ok(/role === 'worker' && issueNo && process\.env\.GITHUB_RUN_ID/.test(S.launch) && /\/issues\/\$\{issueNo\}\/comments/.test(S.launch), 'the tag goes on the ISSUE (not the bus), only for workers that hold one');
  ok(Runs.markerBody(5, 'worker', 7, ' a \n b ') === '<!-- brain-run 5 worker #7 -->\na b', 'markerBody is one clean title line');
  const t0 = ago(10), cm = [
    { created_at: ago(1), body: 'to: log\nfrom: #4175\n\n#4175 phone: runs view drawn, now the check' },
    { created_at: ago(3), body: 'to: log\nfrom: commander\n\ntester: vindicator (gate M) - 1 bugs filed' },
    { created_at: ago(2), body: 'to: log\nfrom: brain\n\nbrain: worker run ended (ok, 8 turns, max) [usage x] - merged master, PR #4325 queued' },
    { created_at: ago(70), body: 'to: log\nfrom: brain\n\nbrain: tester run ended (ok, 3 turns, max) - too old' },
    { created_at: ago(4), body: 'to: log\nfrom: brain\n\nbrain: fixer run ended (exit 1, 2 turns, pro) - could not start' },
    { created_at: ago(9), body: '<!-- brain-run 11 worker #4175 -->\nPHONE step 2: live runs view' }];
  const runs = [{ id: 11, display_title: 'brain worker @max', name: 'brain worker @max', run_started_at: t0, html_url: 'r11' }, { id: 12, display_title: 'brain tester', name: 'brain tester', run_started_at: ago(8), html_url: 'r12' }, { id: 14, display_title: 'brain waker x', name: 'brain waker x', run_started_at: ago(30), html_url: 'r14' }];
  const cs = Runs.cards(runs, [{ id: 13, display_title: 'brain worker @pro', name: 'brain worker @pro', created_at: ago(1), html_url: 'r13' }], cm);
  ok(cs.map((c) => c.id).join() === '14,11,12,13', `running cards oldest first, queued after (got ${cs.map((c) => c.id)})`);
  const w = cs.find((c) => c.id === 11), tt = cs.find((c) => c.id === 12);
  ok(w.issue === 4175 && w.title === 'PHONE step 2: live runs view' && w.state === 'running', 'the worker card carries its issue number and title');
  ok(w.last && /runs view drawn/.test(w.last.text) && !/to:|from:/.test(w.last.text), 'the worker\'s last line is its own newest bus line, without the mail header');
  ok(tt.last && /^tester: vindicator/.test(tt.last.text), 'the tester\'s last line is its own "tester:" line');
  ok(cs.find((c) => c.id === 13).state === 'queued' && cs.find((c) => c.id === 13).last === null, 'queued cards say so and have no last line');
  ok(!Runs.lastLine([{ created_at: ago(20), body: '#4175 old news' }], { issue: 4175, role: 'worker', startedAt: t0 }), 'a line from before the run started is not its last line');
  ok(!Runs.lastLine([{ created_at: ago(1), body: 'brain: worker run ended (ok) - #4175 done' }], { issue: 4175, role: 'worker', startedAt: t0 }), 'another run ending is not this run talking');
  const en = Runs.ended(cm, NOW());
  ok(en.length === 2 && en[0].role === 'worker' && en[0].ok && /merged master/.test(en[0].text) && en[1].role === 'fixer' && !en[1].ok, 'finished runs: only the last hour, newest first, ok flag, one-line outcome');
  const T0 = Date.parse('2026-10-08T00:00:00Z');
  ok(Runs.elapsed('2026-10-08T00:00:00Z', T0 + 7e3) === '7s' && Runs.elapsed('2026-10-08T00:00:00Z', T0 + 723e3) === '12m 03s' && Runs.elapsed('2026-10-08T00:00:00Z', T0 + 3720e3) === '1h 02m', 'elapsed time reads 7s / 12m 03s / 1h 02m');
  ok(Runs.esc('<b onclick="x">&\'') === '&lt;b onclick=&quot;x&quot;&gt;&amp;&#39;', 'text from GitHub is escaped before it reaches the page');
  ok(/setInterval\(refresh, Number\(localStorage\.getItem\('gh-refresh-ms'\)\) \|\| 15000\)/.test(S.app) && /addEventListener\('touchstart'/.test(S.app) && /addEventListener\('touchend'[^\n]*> 90\) refresh\(\)/.test(S.app) && /visibilitychange/.test(S.app), 'the app refreshes every 15 s, on pull-down, and on return to the app');
  ok(!/while \(true\)|sleep\(/.test(S.app + S.runs + S.build), 'no polling loops in the app or the build');
  ok(/runs\.js/.test(S.html) && /'runs\.js'/.test(S.build), 'index.html loads runs.js and the build ships it');
  ok(/Finished in the last hour/.test(S.app) && /<details class="done">/.test(S.app) && /Waiting to start/.test(S.app), 'finished runs are collapsed, queued runs sit underneath');
  return f;
}

// ---------- part 2: the real app against a mocked GitHub
function mock(state) {
  const hits = {}; let site = '';
  const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname, q = u.searchParams;
    if (!p.startsWith('/repos/')) { const f = join(site, p === '/' ? 'index.html' : p.slice(1)); if (!existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[extname(f)] || 'text/plain' }); return res.end(readFileSync(f)); }
    const k = p.replace(`/repos/${REPO}`, '') + (q.get('status') ? '?' + q.get('status') : ''); hits[k] = (hits[k] || 0) + 1;
    if (state.fail && /actions\/runs/.test(p)) return json(res, 500, { message: 'down' });
    if (p === `/repos/${REPO}`) return json(res, 200, { full_name: REPO });
    if (p.endsWith('/actions/runs')) return json(res, 200, { workflow_runs: state[q.get('status')] || [] });
    if (/\/actions\/runs\/\d+\/jobs$/.test(p)) return json(res, 200, { jobs: [{ id: 900, status: 'in_progress', runner_name: 'brain-vm-3', steps: [{ name: 'Set up job', status: 'completed' }, { name: 'Run the role', status: 'in_progress' }] }] });
    if (/\/actions\/jobs\/\d+\/logs$/.test(p)) return json(res, 403, { message: 'no' });
    if (p.endsWith('/pulls')) return json(res, 200, state.pulls || []);
    if (p.endsWith('/issues/comments')) { const since = Date.parse(q.get('since')) || 0; let a = state.comments.filter((c) => Date.parse(c.created_at) >= since).sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at)); if (q.get('direction') === 'asc') a = a.reverse(); return json(res, 200, a.slice(0, 100)); }
    json(res, 404, { message: 'not mocked ' + p });
  });
  return { srv, hits, setSite: (s) => { site = s; } };
}
const fixture = () => ({
  in_progress: [
    { id: 101, display_title: 'brain worker @max', name: 'brain worker @max', run_started_at: ago(12), html_url: 'https://github.com/r/101' },
    { id: 102, display_title: 'brain tester', name: 'brain tester', run_started_at: ago(3), html_url: 'https://github.com/r/102' },
    { id: 103, display_title: 'brain issue_comment', name: 'brain issue_comment', run_started_at: ago(1), html_url: 'https://github.com/r/103' },
    { id: 104, display_title: '#4338 land', name: 'land', run_started_at: ago(6), html_url: 'https://github.com/r/104' }],
  queued: [{ id: 105, display_title: 'brain worker @pro', name: 'brain worker @pro', created_at: ago(0.5), html_url: 'https://github.com/r/105' }],
  pulls: [{ number: 4400, title: '#4175: phone live runs', html_url: 'https://github.com/pr/4400', head: { ref: 'work/4175-phone-step-2' } }],
  comments: [
    { id: 1, created_at: ago(11), html_url: 'u1', body: '<!-- brain-run 101 worker #4175 -->\nPHONE step 2: live runs view (home screen of the PWA)' },
    { id: 2, created_at: ago(2), body: 'to: log\nfrom: #4175\n\n#4175 runs view drawn, writing the check' },
    { id: 3, created_at: ago(2.5), body: 'to: log\nfrom: commander\n\ntester: ravager - 2 bugs filed' },
    { id: 4, created_at: ago(5), body: 'to: log\nfrom: brain\n\nbrain: worker run ended (ok, 13 turns, max) [usage $0.38] - Zoglin idle behaviour now follows vanilla, PR #4332 queued for the lander.' },
    { id: 5, created_at: ago(20), body: 'to: log\nfrom: brain\n\nbrain: fixer run ended (exit 1, 4 turns, pro) - could not push' }],
});
async function browser(S, d, shots) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  const site = join(d, 'site'), bmod = join(d, 'bm'); mkdirSync(bmod, { recursive: true });
  for (const [n, k] of [['build.mjs', 'build'], ['app.js', 'app'], ['index.html', 'html'], ['subs.js', 'subs'], ['runs.js', 'runs'], ['home.js', 'home'], ['controls.js', 'controls'], ['sw.js', 'sw'], ['manifest.webmanifest', 'manifest']]) writeFileSync(join(bmod, n), S[k]);
  (await import(pathToFileURL(join(bmod, 'build.mjs')).href)).build(site);
  const state = fixture(), m = mock(state); m.setSite(site);
  await new Promise((r) => m.srv.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${m.srv.address().port}`;
  const page = await open(origin + '/index.html', { port: 9437, width: 390, height: 844, initScript: `localStorage.setItem('gh-token','t');localStorage.setItem('gh-api','${origin}');localStorage.setItem('gh-refresh-ms','1500');` });
  if (!page) { m.srv.close(); return f; }
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const shot = async (name) => { if (!shots) return; const r = await page.send('Page.captureScreenshot', { format: 'png' }); mkdirSync(SHOTS, { recursive: true }); writeFileSync(join(SHOTS, `phone-runs-${name}.png`), Buffer.from(r.data, 'base64')); };
    ok(await page.waitFor(() => document.querySelectorAll('a.run').length >= 5, 8000), 'home screen: a card per running and queued run appears');
    const h = await page.evaluate(() => ({ cards: [...document.querySelectorAll('a.run')].map((c) => ({ t: c.innerText.replace(/\s+/g, ' '), cls: c.className, bg: c.querySelector('.badge') && c.querySelector('.badge').style.backgroundColor })), bar: document.querySelector('.bar') ? document.querySelector('.bar').innerText : '', doneOpen: document.querySelector('details.done') ? document.querySelector('details.done').open : null, doneText: document.querySelector('details.done summary') ? document.querySelector('details.done summary').innerText : '', overflow: document.documentElement.scrollWidth > innerWidth })) || { cards: [] };
    const by = (re) => h.cards.find((c) => re.test(c.t)) || { t: '', cls: '' };
    ok(/Worker/.test(by(/#4175/).t) && /#4175 PHONE step 2: live runs view/.test(by(/#4175/).t) && /@max/.test(by(/#4175/).t), 'worker card: role badge, @account, issue number and title');
    ok(/runs view drawn/.test(by(/#4175/).t), 'worker card: the last bus line it posted');
    ok(/Tester/.test(by(/Tester/).t) && /tester: ravager/.test(by(/Tester/).t), 'tester card: its own last line');
    ok(/Mail run/.test(by(/Mail run/).t) && /Lander/.test(by(/Lander/).t), 'mail run and lander cards');
    ok(new Set(h.cards.map((c) => c.bg)).size >= 4, 'role colours differ between cards');
    ok(/queued/.test(by(/@pro/).cls) && /waiting to start/i.test(await page.evaluate(() => document.body.innerText)), 'queued run sits under "Waiting to start"');
    ok(/4 running/.test(h.bar) && /1 waiting/.test(h.bar), `summary bar says 4 running, 1 waiting (got "${h.bar}")`);
    ok(h.doneOpen === false && /Finished in the last hour \(2\)/.test(h.doneText), `finished runs are collapsed with a count (got "${h.doneText}")`);
    ok(!h.overflow, 'no sideways scrolling at phone width');
    await shot('home');
    // the auto-refresh sees a new run and a finished one
    state.in_progress.push({ id: 106, display_title: 'brain fixer', name: 'brain fixer', run_started_at: ago(0.2), html_url: 'https://github.com/r/106' }); state.in_progress = state.in_progress.filter((r) => r.id !== 102);
    ok(await page.waitFor(() => { const t = [...document.querySelectorAll('a.run.running')].map((c) => c.innerText).join('|'); return /Fixer/.test(t) && !/Tester/.test(t); }, 6000), 'auto-refresh: a new run appears and a finished one leaves, with no tap');
    ok((m.hits['/actions/runs?in_progress'] || 0) >= 2, `the app asked GitHub again on its own (${m.hits['/actions/runs?in_progress']} asks)`);
    await page.evaluate(() => { document.querySelector('details.done summary').click(); }); await sleep(1800);
    const dd = await page.evaluate(() => ({ open: document.querySelector('details.done').open, t: document.querySelector('details.done').innerText.replace(/\s+/g, ' ') }));
    ok(dd.open && /Zoglin idle behaviour/.test(dd.t) && /could not push/.test(dd.t), 'the finished list keeps its one-line outcomes, and stays open across a refresh');
    await shot('finished');
    await page.evaluate(() => { [...document.querySelectorAll('a.run')].find((c) => /#4175/.test(c.innerText)).click(); });
    ok(await page.waitFor(() => /last lines it posted/i.test(document.body.innerText) && /brain-vm-3/.test(document.body.innerText), 6000), 'tap: the detail screen opens with the runner');
    const dt = await page.evaluate(() => ({ t: document.body.innerText.replace(/\s+/g, ' '), links: [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')) }));
    const a1 = await page.evaluate(() => document.querySelector('.age').innerText); await sleep(2300);
    const a2 = await page.evaluate(() => document.querySelector('.age').innerText);
    ok(a1 !== a2, `the elapsed timer ticks by itself, with no refresh to redraw it (${a1} -> ${a2})`);
    ok(/Run the role/.test(dt.t) && /runs view drawn/.test(dt.t), 'detail: the running step and the lines it posted');
    ok(dt.links.includes('https://github.com/pr/4400') && dt.links.includes('https://github.com/owner/mclite/issues/4175') && dt.links.includes('https://github.com/r/101'), 'detail: links to its issue, its PR and the run');
    ok(/did not let the phone read the log/.test(dt.t), 'detail: an unreadable log is said plainly, with the way out');
    await shot('detail');
    await page.evaluate(() => { location.hash = '#/'; });
    ok(await page.waitFor(() => document.querySelectorAll('a.run').length >= 3, 4000), 'back to the runs list');
    state.fail = true;
    ok(await page.waitFor(() => /Could not refresh/.test(document.body.innerText) && document.querySelectorAll('a.run').length >= 3, 6000), 'an API failure shows a plain message and keeps the last good cards');
    await shot('error'); state.fail = false;
    state.in_progress = []; state.queued = [];
    ok(await page.waitFor(() => /Nothing is running right now/.test(document.body.innerText), 6000), 'empty state says nothing is running');
    await shot('empty');
    ok(page.problems.length === 0, `no console errors in the app (${page.problems.slice(0, 2).join(' | ')})`);
  } finally { await page.close(); m.srv.close(); }
  return f;
}

// ---------- the run, then the breaks
const chrome = !!findChrome();
if (!chrome) console.log('SKIP  phonerunscheck browser part: no Chromium found (set $CHROME to run it)');
const d0 = mkdtempSync(join(tmpdir(), 'pr-')); let fails = [...logic(SRC, d0)]; if (chrome) fails.push(...await browser(SRC, d0, true)); rmSync(d0, { recursive: true, force: true });
const total = N;
const rep = (k, a, b) => (S) => { if (!S[k].includes(a)) throw new Error(`no such text in ${k}: ${a}`); return { ...S, [k]: S[k].split(a).join(b) }; };
const LOGIC_BREAKS = [
  ['roles read from the wrong word', rep('runs', '/^brain (commander|fixer|worker|tester|chore|waker)\\b/', '/^xbrain (commander)\\b/')],
  ['mail runs not recognised', rep('runs', "return 'mail';", "return 'other';")],
  ['two roles share a colour', rep('runs', "tester: '#26a69a'", "tester: '#4caf50'")],
  ['marker regex ignores the issue', rep('runs', 'issue: m[3] ? Number(m[3]) : 0', 'issue: m[3] ? Number(m[3]) + 1 : 0')],
  ['the launcher tags the bus instead', rep('launch', '`/repos/{repo}/issues/${issueNo}/comments`', '`/repos/{repo}/issues/4331/comments`')],
  ['the launcher tags every role', rep('launch', "role === 'worker' && issueNo && process.env.GITHUB_RUN_ID", 'issueNo && process.env.GITHUB_RUN_ID')],
  ['last line takes any comment', rep('runs', 'mine && (', 'true && (')],
  ['last line ignores the run start', rep('runs', 'ms(c.created_at) < since', 'false')],
  ['last line keeps the mail header', rep('runs', '(to|from|re|about|reply|id|at)', '(zzz)')],
  ['queued runs sort first', rep('runs', '.sort(byAge).concat((queued', '.sort(byAge).reverse().concat((queued')],
  ['finished runs older than an hour stay', rep('runs', 'const out = [], span = win || 3600e3;', 'const out = [], span = 360000e3;')],
  ['a failed run counts as ok', rep('runs', "ok: m[2] === 'ok'", 'ok: true')],
  ['seconds are not padded', rep('runs', "String(s % 60).padStart(2, '0')", 's % 60')],
  ['GitHub text is not escaped', rep('runs', "'&': '&amp;', '<': '&lt;'", "'&': '&', '<': '<'")],
  ['a polling loop in the app', rep('app', "document.addEventListener('visibilitychange'", "while (true) { break; } document.addEventListener('visibilitychange'")],
  ['no refresh on a 15 s clock', rep('app', '|| 15000', '|| 0')],
  ['no pull to refresh', rep('app', "addEventListener('touchend'", "addEventListener('touchendx'")],
  ['index.html drops runs.js', rep('html', '<script src="runs.js"></script>', '')],
  ['the build forgets runs.js', rep('build', "'subs.js', 'runs.js', 'home.js', 'controls.js'", "'subs.js'")],
  ['finished runs always open', rep('app', '<details class="done">', '<details class="done" open>')],
];
const BROWSER_BREAKS = [
  ['no live timer', rep('app', 'e.textContent = Runs.elapsed(e.dataset.since, Date.now());', '')],
  ['cards forget the issue', rep('app', '<b>#${c.issue}</b> ${E(c.title)}', '${E(c.runTitle)}')],
  ['queued runs never fetched', rep('app', 'status=queued', 'status=nothing')],
  ['detail forgets the PR', rep('app', ' &middot; <a href="${E(pr.html_url)}">PR #${pr.number}</a> <small>(${E(pr.head.ref)})</small>', '')],
  ['an API error wipes the screen', rep('app', 'catch (e) { data.err = String(e.message || e); }', 'catch (e) { data.err = String(e.message || e); data.running = []; data.queued = []; }')],
  ['auto-refresh reads once', rep('app', "async function refresh() { if (route.at !== 'home') return;", "async function refresh() { if (route.at !== 'home' || data.loaded) return;")],
];
let caught = 0, ran = 0;
const attempt = async (name, mut, withBrowser) => {
  const d = mkdtempSync(join(tmpdir(), 'pr-')); let r;
  try { const S = mut(SRC); r = logic(S, d); if (withBrowser && !r.length) r = await browser(S, d, false); } catch (e) { r = [`threw: ${e.message}`]; if (/no such text/.test(e.message)) fails.push(`break "${name}": ${e.message}`); }
  rmSync(d, { recursive: true, force: true }); ran++;
  if (r.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
};
for (const [n, mut] of LOGIC_BREAKS) await attempt(n, mut, false);
if (chrome) for (const [n, mut] of BROWSER_BREAKS) await attempt(n, mut, true);
console.log(`phonerunscheck: ${caught} breaks caught (of ${ran})${chrome ? '' : ' [browser breaks skipped: no Chromium]'}`);
for (const x of fails) console.log(`  ✗ ${x}`);
console.log(` assertions passed .... ${total - fails.filter((x) => !/^break/.test(x)).length}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
