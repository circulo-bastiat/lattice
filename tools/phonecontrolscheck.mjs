#!/usr/bin/env node
// phonecontrolscheck.mjs - #4176 (PHONE step 3): the phone PWA's one-tap controls and the questions to Dan.
// Part 1 (node): phone-web/controls.js (answer format, pause plan, question mirror) and the brain's mirror of `to: dan` questions.
// Part 2 (headless Chromium, phone-sized): the real app against a MOCKED GitHub API on localhost - the fill stepper writes FILL_WORKERS and
// posts the bus line, pause/resume remembers the count, start commander/fixer dispatches brain.yml (second tap), questions are button cards
// answered in the format sessions expect, the icon badge follows the open count. Screenshots: assets/phone-controls-*.png.
// ANTI-VACUITY: every break below must be caught ("<n> breaks caught").
import http from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { open, findChrome, sleep } from './cdp.mjs';
const T = fileURLToPath(new URL('.', import.meta.url)), ROOT = join(T, '..'), rd = (p) => readFileSync(join(T, p), 'utf8');
const SRC = { controls: rd('phone-web/controls.js'), requests: rd('phone-web/requests.js'), runs: rd('phone-web/runs.js'), home: rd('phone-web/home.js'), app: rd('phone-web/app.js'), html: rd('phone-web/index.html'), build: rd('phone-web/build.mjs'), subs: rd('phone-web/subs.js'), sw: rd('phone-web/sw.js'), manifest: rd('phone-web/manifest.webmanifest'), brainhome: rd('brain/home.mjs'), brain: rd('brain/brain.mjs') };
const SHOTS = join(ROOT, 'assets');
const REPO = 'owner/mclite', ago = (min) => new Date(Date.now() - min * 60e3).toISOString();
let N = 0;

// ---------- part 1: the pure logic
function logic(S, d) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  writeFileSync(join(d, 'controls.cjs'), S.controls); const C = createRequire(import.meta.url)(join(d, 'controls.cjs'));
  const bus = 'to: dan\nfrom: commander\n\nWhich fill shape should the brain use?\nCase for A: simple.\noptions: Keep 1 worker | Auto-flip | Stop the fill';
  const cs = [{ id: 21, created_at: ago(30), body: C.mirrorBody(555, bus) }, { id: 22, created_at: ago(10), body: `${C.QMARK}556 answered -->\nto: dan\nfrom: fixer\n\nOld?\noptions: Yes | No` }, { id: 23, created_at: ago(5), body: 'a human comment' }, { id: 24, created_at: ago(60), body: C.mirrorBody(554, 'to: dan\nfrom: fixer\n\nA note with no options') }];
  const q = C.openQuestions(cs);
  ok(q.length === 1 && q[0].busId === '555' && q[0].mirrorId === 21 && q[0].from === 'commander', 'only unanswered questions that carry options are open');
  ok(q[0].options.join('|') === 'Keep 1 worker|Auto-flip|Stop the fill' && /^Which fill shape/.test(q[0].text) && !/options:|to:|from:/.test(q[0].text) && /Case for A/.test(q[0].text), 'a question keeps its text and case, loses the mail header and the options line');
  ok(C.parseQuestions(cs).map((x) => x.busId).join() === '554,555,556', `questions oldest first, answered last, oldest first (got ${C.parseQuestions(cs).map((x) => x.busId)})`);
  const am = C.answerMessage(q[0], 'Auto-flip');
  ok(am === "to: commander\nfrom: dan\nabout: 555\n\nAuto-flip\n\n(Dan's answer to: Which fill shape should the brain use?)", 'the answer is the bus format sessions expect: to the asker, from dan, about the question id');
  ok(C.answerMessage({ ...q[0], from: 'Fixer' }, 'x').startsWith('to: fixer\n'), 'the answer goes to whoever asked, lower-cased');
  const ab = C.answeredBody(q[0], 'Auto-flip');
  ok(C.parseQuestions([{ id: 1, created_at: ago(1), body: ab }])[0].answered === true && C.openQuestions([{ id: 1, created_at: ago(1), body: ab }]).length === 0, 'an answered mirror is no longer open');
  ok(C.clampFill(-3) === 0 && C.clampFill(14) === 10 && C.clampFill('7') === 7 && C.clampFill('x') === 0, 'the fill count stays between 0 and 10');
  ok(/restarting the fill/.test(C.busFillLine(6)) && /fill set to 6/.test(C.busFillLine(6)) && /^to: log\nfrom: dan\n/.test(C.busFillLine(6)), "the stepper's bus line says 'restarting the fill' (it wakes the brain's fill)");
  ok(JSON.stringify(C.pausePlan('6', null)) === '{"paused":false,"saveBefore":"6","setTo":"0"}' && JSON.stringify(C.pausePlan(null, null)) === '{"paused":false,"saveBefore":"auto","setTo":"0"}' && JSON.stringify(C.pausePlan('0', '6')) === '{"paused":true,"resumeTo":"6"}' && C.pausePlan('0', null).resumeTo === 'auto', 'pause remembers the count (or auto), resume gives it back');
  ok(C.badgeCount([1, 2]) === 2 && C.badgeCount() === 0, 'the badge is the number of open questions');
  // #5045/#5110: the per-account fill (FILL_WORKERS_MAX / FILL_WORKERS_PRO) as the phone shows and sets it
  writeFileSync(join(d, 'home.cjs'), S.home); const Hm = createRequire(import.meta.url)(join(d, 'home.cjs'));
  const qz = { tz: 'America/New_York', from: '08:00', to: '14:00', factor: 0.5 };
  ok(Hm.quietFactor(qz, Date.parse('2026-10-11T15:53:00Z')) === 0.5 && Hm.quietFactor(qz, Date.parse('2026-10-11T19:00:00Z')) === 1 && Hm.quietFactor(null, 0) === 1, 'the quiet factor halves 08:00-14:00 New York time only');
  const af = Hm.acctFill({ max: '8', pro: '2' }, 0.5);
  ok(af[0].set === 8 && af[0].target === 4 && af[1].set === 2 && af[1].target === 1 && Hm.acctFill({ max: 'x' }, 1)[0].set === null && Hm.acctFill({ max: '14' }, 1)[0].set === 10, 'per-account targets are the set count x the quiet factor, rounded up (go.mjs status: max 4, pro 1)');
  ok(Hm.fillSummary(af, '2', 0.5).big === 'Max 4 \u00b7 Pro 1' && Hm.fillSummary(Hm.acctFill({}, 1), '3', 1).big === '3' && Hm.fillSummary(Hm.acctFill({}, 1), null, 1).big === 'auto', 'the Home tile shows each account when a switch is set, else the single number');
  ok(/max fill set to 8/.test(C.busAcctLine('max', 8)) && /restarting the fill/.test(C.busAcctLine('pro', null)) && /pro fill set to auto/.test(C.busAcctLine('pro', null)), "the account line says 'restarting the fill' so the brain tops up");
  // the brain mirrors what the phone reads
  const m = /body: `(<!-- dan-q [^`]*)`/.exec(S.brainhome);
  ok(!!m, 'home.mjs mirrors a question onto the dan-questions issue');
  if (m) { const body = m[1].replace(/\\n/g, '\n').replace('${commentId}', '555').replace('${body}', bus); ok(C.parseQuestions([{ id: 9, created_at: ago(1), body }])[0].busId === '555' && C.openQuestions([{ id: 9, created_at: ago(1), body }]).length === 1, "the brain's mirror is read back by the phone as an open question"); }
  ok(/\^options:\\s\*\\S\/m\.test\(String\(body\)\)\) return false/.test(S.brainhome) && /labels=dan-questions&state=open/.test(S.brainhome), 'only messages with an options line are mirrored, onto the open dan-questions issue');
  ok(/mirrorQuestion\(ev\.comment\.id, ev\.comment\.body\)/.test(S.brain) && /url: asks \? '\/#\/questions' : '\/'/.test(S.brain), 'a question to Dan is mirrored when the brain pushes it, and the push opens the Questions tab');
  ok(/'controls\.js'/.test(S.build) && /controls\.js/.test(S.html), 'index.html loads controls.js and the build ships it');
  ok(/setAppBadge/.test(S.app) && /clearAppBadge/.test(S.app), 'the app sets and clears the icon badge');
  ok(/actions\/workflows\/brain\.yml\/dispatches/.test(S.app) && /ref: 'master'/.test(S.app) && /ctl\.armed !== role/.test(S.app), 'start commander/fixer dispatches brain.yml, after a second tap');
  return f;
}

// ---------- part 2: the real app against a mocked GitHub (variables, bus, dan-questions, workflow dispatch)
function mock(st) {
  let site = '';
  const json = (res, code, o) => { if (code === 204) { res.writeHead(204); return res.end(); } res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname.replace(`/repos/${REPO}`, ''), q = u.searchParams; let raw = '';
    req.on('data', (c) => { raw += c; }); req.on('end', () => {
      if (!u.pathname.startsWith('/repos/')) { const f = join(site, u.pathname === '/' ? 'index.html' : u.pathname.slice(1)); if (!existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[extname(f)] || 'text/plain' }); return res.end(readFileSync(f)); }
      const body = raw ? JSON.parse(raw) : {}, m = req.method;
      if (p === '' && m === 'GET') return json(res, 200, { full_name: REPO });
      const v = /^\/actions\/variables(?:\/(\w+))?$/.exec(p);
      if (v) {
        if (st.denyVars && m !== 'GET') return json(res, 403, { message: 'Resource not accessible' });
        if (m === 'GET') return v[1] && v[1] in st.vars ? json(res, 200, { name: v[1], value: st.vars[v[1]] }) : json(res, 404, {});
        if (m === 'PATCH') { if (!(v[1] in st.vars)) return json(res, 404, {}); st.vars[v[1]] = body.value; st.log.push(['var', v[1], body.value]); return json(res, 204); }
        if (m === 'POST') { st.vars[body.name] = body.value; st.log.push(['var', body.name, body.value]); return json(res, 201, {}); }
        if (m === 'DELETE') { if (!(v[1] in st.vars)) return json(res, 404, {}); delete st.vars[v[1]]; st.log.push(['var', v[1], null]); return json(res, 204); }
      }
      if (p === '/issues' && /labels=bus/.test(u.search)) return json(res, 200, [{ number: 777 }]);
      if (p === '/issues' && /labels=dan-questions/.test(u.search)) return json(res, 200, [{ number: 888 }]);
      if (p === '/issues/777/comments' && m === 'POST') { st.bus.push(body.body); return json(res, 201, { id: 5000 + st.bus.length }); }
      if (p === '/issues/888/comments' && m === 'GET') return json(res, 200, st.mirrors);
      const pc = /^\/issues\/comments\/(\d+)$/.exec(p);
      if (pc && m === 'PATCH') { const c = st.mirrors.find((x) => String(x.id) === pc[1]); if (c) c.body = body.body; st.log.push(['patch', pc[1]]); return json(res, 200, c || {}); }
      if (p === '/actions/workflows/brain.yml/dispatches' && m === 'POST') { st.dispatches.push(body); return json(res, 204); }
      if (p === '/actions/runs') return json(res, 200, { workflow_runs: [] });
      if (p === '/issues/comments') return json(res, 200, []);
      json(res, 404, { message: 'not mocked ' + m + ' ' + p });
    });
  });
  return { srv, setSite: (s) => { site = s; } };
}
const QBODY = (id, from, text, opts) => `<!-- dan-q ${id} -->\nto: dan\nfrom: ${from}\n\n${text}\noptions: ${opts}`;
const fixture = () => ({ vars: { FILL_WORKERS: '4' }, bus: [], log: [], dispatches: [], denyVars: false,
  mirrors: [{ id: 31, created_at: ago(200), body: QBODY(555, 'commander', 'Which fill shape should the brain use?', 'Keep 1 worker | Auto-flip | Stop the fill') },
    { id: 32, created_at: ago(90), body: QBODY(556, 'fixer', 'Retire lane.mjs now?', 'Yes | Not yet') },
    { id: 33, created_at: ago(50), body: `<!-- dan-q 557 answered -->\nto: dan\nfrom: fixer\n\nOld question\noptions: A | B` }] });
async function browser(S, d, shots) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  const site = join(d, 'site'), bmod = join(d, 'bm'); mkdirSync(bmod, { recursive: true });
  for (const [n, k] of [['build.mjs', 'build'], ['app.js', 'app'], ['index.html', 'html'], ['subs.js', 'subs'], ['runs.js', 'runs'], ['home.js', 'home'], ['controls.js', 'controls'], ['requests.js', 'requests'], ['sw.js', 'sw'], ['manifest.webmanifest', 'manifest']]) writeFileSync(join(bmod, n), S[k]); for (const f of ['ui.js', 'tabs.js', 'theme.css']) writeFileSync(join(bmod, f), readFileSync(join(T, 'phone-web', f), 'utf8'));
  (await import(pathToFileURL(join(bmod, 'build.mjs')).href)).build(site);
  const st = fixture(), m = mock(st); m.setSite(site);
  await new Promise((r) => m.srv.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${m.srv.address().port}`;
  const page = await open(origin + '/index.html', { port: 9438, width: 390, height: 844, initScript: `localStorage.setItem('gh-token','t');localStorage.setItem('gh-api','${origin}');localStorage.setItem('gh-refresh-ms','1500');window.__badge=-1;navigator.setAppBadge=function(n){window.__badge=n;return Promise.resolve();};navigator.clearAppBadge=function(){window.__badge=0;return Promise.resolve();};` });
  if (!page) { m.srv.close(); return f; }
  const txt = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const shot = async (name) => { if (!shots) return; const r = await page.send('Page.captureScreenshot', { format: 'png' }); mkdirSync(SHOTS, { recursive: true }); writeFileSync(join(SHOTS, `phone-controls-${name}.png`), Buffer.from(r.data, 'base64')); };
    const click = (id) => page.evaluate(new Function(`document.getElementById(${JSON.stringify(id)}).click()`));
    // -- the tab bar and the fill stepper
    await page.evaluate(() => { location.hash = '#/controls'; });
    ok(await page.waitFor(() => document.getElementById('fillN') && document.getElementById('fillN').innerText === '4', 8000), 'controls: the stepper shows the current FILL_WORKERS (4)');
    ok(await page.evaluate(() => [...document.querySelectorAll('#tabs a')].map((a) => a.innerText.replace(/\s+/g, ' ')).join('|')) === 'Home|Bugs|Mobs|Runs|Requests', 'the tab bar is always there: Home | Bugs | Mobs | Runs | Requests');
    await page.evaluate(() => { location.hash = '#/'; });
    ok(await page.waitFor(() => /\(2\)/.test((document.getElementById('gear') || {}).innerText || ''), 6000), 'the gear on Home shows the 2 open questions');
    await page.evaluate(() => { location.hash = '#/controls'; });
    ok(await page.waitFor(() => window.__badge === 2, 6000), 'the icon badge shows the 2 open questions');
    await shot('controls');
    await click('plus'); await click('plus');
    ok(await page.waitFor(() => document.getElementById('fillN').innerText === '6', 3000) && st.log.every((l) => l[0] !== 'var'), 'two taps move the number at once; nothing is written yet (one write after the last tap)');
    ok(await page.waitFor(() => /fill set to 6/i.test(document.body.innerText), 5000), 'the stepper writes the count after the last tap');
    ok(st.vars.FILL_WORKERS === '6' && st.log.filter((l) => l[0] === 'var').length === 1, `FILL_WORKERS is 6, written once (log ${JSON.stringify(st.log)})`);
    ok(st.bus.length === 1 && /^to: log\nfrom: dan\n\nrestarting the fill \(phone: fill set to 6\)$/.test(st.bus[0]), `the 'restarting the fill' bus line was posted (${JSON.stringify(st.bus[0])})`);
    // -- pause and resume
    await click('pause');
    ok(await page.waitFor(() => /Resume the fill \(back to 6\)/.test(document.body.innerText), 5000) && st.vars.FILL_WORKERS === '0' && st.vars.FILL_WORKERS_BEFORE_PAUSE === '6', 'pause: FILL_WORKERS 0, the old count kept, the button offers to resume it');
    ok(st.bus.length === 2 && /fill set to 0/.test(st.bus[1]), 'pause tells the brain on the bus');
    await shot('paused');
    await click('pause');
    ok(await page.waitFor(() => /Pause the fill/.test(document.body.innerText), 5000) && st.vars.FILL_WORKERS === '6' && !('FILL_WORKERS_BEFORE_PAUSE' in st.vars), 'resume: the count is back, the memory variable is gone');
    // -- pause from "auto" (no variable): resume removes the variable again
    delete st.vars.FILL_WORKERS; await page.evaluate(() => { location.hash = '#/'; }); await sleep(300); await page.evaluate(() => { location.hash = '#/controls'; });
    ok(await page.waitFor(() => document.getElementById('fillN') && document.getElementById('fillN').innerText === 'auto', 4000), 'no variable shows "auto" (the brain decides)');
    await click('pause'); ok(await page.waitFor(() => /Resume the fill/.test(document.body.innerText), 5000) && st.vars.FILL_WORKERS === '0', 'pause from auto works');
    await click('pause'); ok(await page.waitFor(() => /Pause the fill/.test(document.body.innerText), 5000) && !('FILL_WORKERS' in st.vars), 'resume from auto removes the variable again (back to roles.json)');
    // -- start commander / fixer
    await click('s-commander');
    ok(await page.waitFor(() => /Tap again to start the commander/.test(document.body.innerText), 2000) && st.dispatches.length === 0, 'start commander: the first tap only arms the button, nothing starts');
    await shot('armed');
    await click('s-commander');
    ok(await page.waitFor(() => /commander is starting/.test(document.body.innerText), 4000) && st.dispatches.length === 1 && st.dispatches[0].ref === 'master' && st.dispatches[0].inputs.role === 'commander', `the second tap dispatches brain.yml with role commander (${JSON.stringify(st.dispatches)})`);
    await click('s-fixer'); await click('s-fixer');
    ok(await page.waitFor(() => /fixer is starting/.test(document.body.innerText), 4000) && st.dispatches[1] && st.dispatches[1].inputs.role === 'fixer', 'the fixer starts the same way');
    // -- a token that may not write says so
    st.denyVars = true; await click('plus');
    ok(await page.waitFor(() => /not allowed to do that/.test(document.body.innerText), 5000), 'a token without write access gets a plain explanation');
    st.denyVars = false;
    // -- questions
    await page.evaluate(() => { location.hash = '#/questions'; });
    ok(await page.waitFor(() => document.querySelectorAll('button.opt').length === 5, 5000), 'questions: a card per open question with a button per option (3 + 2)');
    const qt = await txt();
    ok(/Which fill shape should the brain use/.test(qt) && /Retire lane\.mjs now/.test(qt) && !/Old question/.test(qt), 'questions: asked text shown, answered ones hidden');
    await shot('questions');
    const bus0 = st.bus.length;
    await page.evaluate(() => { [...document.querySelectorAll('button.opt')].find((b) => b.innerText === 'Auto-flip').click(); });
    ok(await page.waitFor(() => /Sent: Auto-flip/.test(document.body.innerText), 5000) && st.bus.length === bus0 + 1, 'tapping an option answers at once');
    ok(st.bus[bus0] === "to: commander\nfrom: dan\nabout: 555\n\nAuto-flip\n\n(Dan's answer to: Which fill shape should the brain use?)", `the answer is in the format sessions expect (${JSON.stringify(st.bus[bus0])})`);
    ok(/dan-q 555 answered/.test(st.mirrors[0].body) && /answered from the phone: Auto-flip/.test(st.mirrors[0].body), 'the question is marked answered, so it stays gone on every device');
    ok(await page.waitFor(() => document.querySelectorAll('button.opt').length === 2 && window.__badge === 1, 4000), 'the card leaves and the icon badge counts down to 1');
    await shot('answered');
    await page.evaluate(() => { [...document.querySelectorAll('button.opt')].find((b) => b.innerText === 'Not yet').click(); });
    ok(await page.waitFor(() => /No questions waiting for you/.test(document.body.innerText) && window.__badge === 0, 5000) && /to: fixer/.test(st.bus[st.bus.length - 1]), 'the last answer goes to its own asker, and the badge clears');
    ok(page.problems.length === 0, `no console errors in the app (${page.problems.slice(0, 2).join(' | ')})`);
  } finally { await page.close(); m.srv.close(); }
  return f;
}

// ---------- the run, then the breaks
const chrome = !!findChrome();
if (!chrome) console.log('SKIP  phonecontrolscheck browser part: no Chromium found (set $CHROME to run it)');
const d0 = mkdtempSync(join(tmpdir(), 'pc-')); let fails = [...logic(SRC, d0)]; if (chrome) fails.push(...await browser(SRC, d0, true)); rmSync(d0, { recursive: true, force: true });
const total = N;
if (process.env.CLEAN_ONLY) { console.log(fails.length ? fails.map((x) => `  ✗ ${x}`).join('\n') : 'clean run ok'); console.log(` assertions ${N}`); process.exit(fails.length ? 1 : 0); }
const rep = (k, a, b) => (S) => { if (!S[k].includes(a)) throw new Error(`no such text in ${k}: ${a}`); return { ...S, [k]: S[k].split(a).join(b) }; };
const LOGIC_BREAKS = [
  ['the quiet factor is ignored', rep('home', 'return m >= hm(q.from) && m < hm(q.to) ? Number(q.factor) : 1;', 'return 1;')],
  ['the target ignores the quiet factor', rep('home', 'target: set === null ? null : Math.ceil(set * (factor || 1))', 'target: set')],
  ['the tile hides the accounts', rep('home', 'if (!on.length) return', 'if (true) return')],
  ['the account bus line does not wake the fill', rep('controls', 'restarting the fill (phone: ${name} fill set to', 'fill (phone: ${name} fill set to')],
  ['answer goes to the wrong address', rep('controls', "`to: ${String(q.from || 'commander').toLowerCase()}\\nfrom: dan", '`to: commander\\nfrom: dan')],
  ['answer uses re: not about:', rep('controls', 'about: ${q.busId}', 're: ${q.busId}')],
  ['answer is not from dan', rep('controls', '\\nfrom: dan\\nabout:', '\\nfrom: phone\\nabout:')],
  ['answered questions stay open', rep('controls', '!!m[2]', 'false')],
  ['questions without options are open', rep('controls', '.filter((q) => !q.answered && q.options.length)', '.filter((q) => !q.answered)')],
  ['options are not split', rep('controls', ".split('|')", ".split(';')")],
  ['the mail header stays in the text', rep('controls', '(to|from|re|about|reply|options)', '(zzz)')],
  ['fill count is not clamped', rep('controls', 'Math.min(10, Math.max(0, Math.round(Number(n)) || 0))', 'Number(n)')],
  ['the bus line does not wake the fill', rep('controls', 'restarting the fill (phone: fill set to', 'fill (phone: fill set to')],
  ['pause forgets the count', rep('controls', 'saveBefore: cur', 'saveBefore: 0')],
  ['resume from auto sets a number', rep('controls', "before == null || before === '' ? 'auto' : before", "before == null || before === '' ? 5 : before")],
  ['the brain never mirrors questions', rep('brain', 'mirrorQuestion(ev.comment.id, ev.comment.body)', 'Promise.resolve(false)')],
  ['the brain mirrors everything', rep('brainhome','!/^options:\\s*\\S/m.test(String(body))', 'false')],
  ['the mirror loses the id', rep('brainhome','<!-- dan-q ${commentId} -->', '<!-- dan-q 0 -->')],
  ['a push does not open Questions', rep('brain', "'/#/questions' : '/'", "'/' : '/'")],
  ['index.html drops controls.js', rep('html', '<script src="controls.js"></script>', '')],
  ['the build forgets controls.js', rep('build', "'home.js', 'controls.js'", "'home.js'")],
  ['start fires on the first tap', rep('app', 'ctl.armed !== role', 'false')],
];
const BROWSER_BREAKS = [
  ['no badge', rep('app', 'navigator.setAppBadge(n)', 'void n')],
  ['the stepper never posts the bus line', rep('app', 'await postBus(Controls.busFillLine(n)); ctl.fill', 'ctl.fill')],
  ['every tap writes at once', rep('app', ', 900);', ', 0);')],
  ['pause forgets to keep the count', rep('app', "await setVar(BEFORE, 'FILL_WORKERS_BEFORE_PAUSE', p.saveBefore);", '')],
  ['resume leaves the memory variable', rep('app', "await setVar(BEFORE, 'FILL_WORKERS_BEFORE_PAUSE', null);", '')],
  ['dispatch names the wrong role', rep('app', 'inputs: { role, reason', "inputs: { role: 'worker', reason")],
  ['answer is never marked answered', rep('app', 'await gh(\'PATCH\', `/repos/{repo}/issues/comments/${q.mirrorId}`', 'await gh(\'GET\', `/repos/{repo}/issues/comments/${q.mirrorId}`')],
  ['answer posts nothing on the bus', rep('app', 'await postBus(Controls.answerMessage(q, c));', '')],
  ['write errors are swallowed', rep('app', "const need = (e) => (/ (401|403) /.test(e.message) ? 'This token is not allowed to do that.", "const need = (e) => (/ (401|403) /.test(e.message) ? 'Done.")],
  ['the gear count never updates', (S) => { const a = rep('app', "t.textContent = n ? ` (${n})` : ''", "t.textContent = ''")(S); return rep('app', 'q.textContent = ` (${nq})`', "q.textContent = ''")(a); }],
];
let caught = 0, ran = 0;
const attempt = async (name, mut, withBrowser) => {
  const d = mkdtempSync(join(tmpdir(), 'pc-')); let r;
  try { const S = mut(SRC); r = logic(S, d); if (withBrowser && !r.length) r = await browser(S, d, false); } catch (e) { r = [`threw: ${e.message}`]; if (/no such text/.test(e.message)) fails.push(`break "${name}": ${e.message}`); }
  rmSync(d, { recursive: true, force: true }); ran++;
  if (r.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
};
for (const [n, mut] of LOGIC_BREAKS) await attempt(n, mut, false);
if (chrome) for (const [n, mut] of BROWSER_BREAKS) await attempt(n, mut, true);
console.log(`phonecontrolscheck: ${caught} breaks caught (of ${ran})${chrome ? '' : ' [browser breaks skipped: no Chromium]'}`);
for (const x of fails) console.log(`  ✗ ${x}`);
console.log(` assertions passed .... ${total - fails.filter((x) => !/^break/.test(x)).length}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
