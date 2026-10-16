#!/usr/bin/env node
// phonerequestscheck.mjs - #7685: the Requests tab of the phone PWA (a request in words, the handler's comments live, dashboards, results, Undo).
// Part 1 (node): the pure logic in phone-web/requests.js - the request contract (issue title/body/labels, the bus mail, follow-up and undo comments), parsing the handler's comments and
// fenced ```dashboard / ```result / ```undo blocks, list order, the unseen badge, the sandboxed dashboard frame.
// Part 2 (headless Chromium, phone-sized): the real app against a MOCKED GitHub on localhost - list order, optimistic new card, the exact writes, thread bubbles, thread polling,
// the iframe's sandbox (exactly allow-scripts, never allow-same-origin), Undo, reply, the badge.
// ANTI-VACUITY: every break below must be caught ("<n> breaks caught").
import http from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { open, findChrome, sleep } from './cdp.mjs';
const T = fileURLToPath(new URL('.', import.meta.url)), rd = (p) => readFileSync(join(T, p), 'utf8');
const SRC = { requests: rd('phone-web/requests.js'), runs: rd('phone-web/runs.js'), home: rd('phone-web/home.js'), controls: rd('phone-web/controls.js'), app: rd('phone-web/app.js'), html: rd('phone-web/index.html'), build: rd('phone-web/build.mjs'), subs: rd('phone-web/subs.js'), sw: rd('phone-web/sw.js'), manifest: rd('phone-web/manifest.webmanifest') };
const REPO = 'owner/mclite', ago = (min) => new Date(Date.now() - min * 60e3).toISOString();
let N = 0;

// ---------- part 1: the pure logic
function logic(S, d) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  writeFileSync(join(d, 'requests.cjs'), S.requests); const R = createRequire(import.meta.url)(join(d, 'requests.cjs'));
  const c = R.composeIssue('  Why are runs\nshort?  ');
  ok(c && c.title === 'Why are runs' && c.body === 'Why are runs\nshort?\n<!-- request -->' && c.labels.join() === 'request,req:waiting', 'a new request: title = first line, body = his words then the marker line, labels request + req:waiting');
  ok(R.composeIssue('   ') === null && R.composeIssue('') === null, 'an empty request is not sent');
  ok(R.titleOf('x'.repeat(200)).length <= 80, 'the title is at most 80 characters');
  ok(R.busMail(7690) === 'to: requests\nfrom: dan\ntype: info\n\n#7690', 'the bus mail that wakes the handler has the exact format');
  ok(R.followUp(' more detail ') === 'from: dan\n\nmore detail' && R.followUp('  ') === null, 'a follow-up is a comment that starts "from: dan"');
  ok(R.undoComment('u1') === 'from: dan\n\nundo u1', 'undo is the comment "undo <id>" from dan');
  ok(R.statusOf({ labels: [{ name: 'request' }, { name: 'req:working' }] }) === 'working' && R.statusOf({ labels: ['req:waiting', 'req:done'] }) === 'done' && R.statusOf({ labels: ['request'] }) === '', 'status comes from the req: label (done beats waiting)');
  ok(R.parseIssue({ number: 5, title: 't', body: 'my words\n<!-- request -->', labels: ['req:waiting'], updated_at: 'u' }).text === 'my words', 'the request text is shown without the marker line');
  const l = R.sortList([{ n: 1, status: 'done', updated: ago(1) }, { n: 2, status: 'working', updated: ago(30) }, { n: 3, status: 'waiting', updated: ago(5) }, { n: 4, status: 'done', updated: ago(60) }]);
  ok(l.map((r) => r.n).join() === '3,2,1,4', `list order: open by latest activity, then done by latest activity (got ${l.map((r) => r.n)})`);
  const cm = [
    { id: 1, created_at: ago(9), body: 'from: requests\n\nLooking into **it**.\n```result\nCause: idle runs\n```\n```undo\n{"id":"u1","what":"set FILL to 3","undo":"gh variable set FILL --body 5"}\n```\n```dashboard\n<!doctype html><b>chart</b>\n```' },
    { id: 2, created_at: ago(8), body: 'from: dan\n\nundo u1' },
    { id: 3, created_at: ago(7), body: '<!-- brain-run 99 requests -->\nmarker' },
    { id: 4, created_at: ago(6), body: 'from: commander\n\nline one\nlast line\n```undo\nnot json\n```' }];
  const th = R.thread(cm);
  ok(th.length === 3 && th[0].from === 'requests' && th[0].text === 'Looking into **it**.' && !/from:/.test(th[0].text), 'comments: labelled by from:, the header line is not part of the text');
  ok(th[0].blocks.map((b) => b.type).join() === 'result,undo,dashboard' && th[0].blocks[1].undo.id === 'u1' && /chart/.test(th[0].blocks[2].body), 'the result, undo and dashboard blocks are pulled out of the comment');
  ok(th[2].blocks.length === 0 && /not json/.test(th[2].text), 'an undo block that is not valid JSON stays plain text (no Undo button)');
  ok(!th.some((x) => /marker/.test(x.text)), "the brain's own run marker comment is not part of the conversation");
  ok(R.undone(cm).has('u1') && !R.undone(cm).has('u2'), 'an "undo u1" comment marks block u1 as already requested');
  ok(R.latest(cm) === 'Cause: idle runs' && R.latest([cm[3]]) === 'not json' && R.latest([cm[1]]) === '', 'a card shows the newest result block, else the last line of the newest non-Dan comment');
  ok(R.unseenCount([{ n: 1, updated: ago(1) }, { n: 2, updated: ago(1) }, { n: 3, updated: ago(1) }], { 1: Date.now() + 5000, 2: Date.now() - 600000 }) === 2, 'unseen = changed after the time Dan last opened it');
  const fr = R.dashboardFrame('<p title="x">"hi"</p>');
  ok(/<iframe[^>]* sandbox="allow-scripts"/.test(fr) && !/allow-same-origin/.test(fr) && /srcdoc="&lt;p title=&quot;x&quot;&gt;&quot;hi&quot;&lt;\/p&gt;"/.test(fr), 'a dashboard is an iframe sandboxed with exactly allow-scripts, its HTML escaped into srcdoc');
  ok(R.dashboardFrame('x'.repeat(60001)) === '' && R.dashboardFrame('x'.repeat(60000)) !== '', 'a dashboard over 60,000 characters is refused');
  ok(R.md('<script>alert(1)</script> **b** `c`') === '&lt;script&gt;alert(1)&lt;/script&gt; <b>b</b> <code>c</code>', 'handler text is escaped before the tiny Markdown is applied');
  ok(/requests\.js/.test(S.html) && /data-t="requests"/.test(S.html) && /id="rn"/.test(S.html), 'index.html loads requests.js and has the Requests tab with its badge');
  ok(/'requests\.js'/.test(S.build), 'the build ships requests.js');
  ok(!/while \(true\)|sleep\(/.test(S.app + S.requests), 'no polling loops in the app');
  ok(/#\\\/requests\(\?:\\\/\(\\d\+\)\)\?\$/.test(S.app) && /setInterval\(pollRequests, RQ_MS\)/.test(S.app), 'the route #/requests[/<n>] exists and polls on a timer');
  return f;
}

// ---------- part 2: the real app against a mocked GitHub
function mock(state) {
  const posts = []; let site = '';
  const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname, q = u.searchParams;
    if (!p.startsWith('/repos/')) { const f = join(site, p === '/' ? 'index.html' : p.slice(1)); if (!existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/json', '.png': 'image/png' }[extname(f)] || 'text/plain' }); return res.end(readFileSync(f)); }
    const r = p.replace(`/repos/${REPO}`, '');
    let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
      const b = body ? JSON.parse(body) : null;
      if (r === '') return json(res, 200, { full_name: REPO });
      if (req.method === 'GET' && r === '/issues') {
        const lb = q.get('labels');
        if (lb === 'request') return json(res, 200, state.issues);
        if (lb === 'bus') return json(res, 200, [{ number: 53 }]);
        return json(res, 200, []);
      }
      if (req.method === 'POST' && r === '/issues') {
        return setTimeout(() => { const n = state.next++; const i = { number: n, title: b.title, body: b.body, labels: b.labels.map((name) => ({ name })), updated_at: new Date().toISOString(), comments: 0, html_url: 'u' }; state.issues.unshift(i); state.comments[n] = []; posts.push({ kind: 'issue', n, b }); json(res, 201, i); }, state.slow ? 900 : 0);
      }
      let m = /^\/issues\/(\d+)$/.exec(r);
      if (req.method === 'GET' && m) { const i = state.issues.find((x) => x.number === Number(m[1])); return i ? json(res, 200, i) : json(res, 404, { message: 'no' }); }
      m = /^\/issues\/(\d+)\/comments$/.exec(r);
      if (m && req.method === 'GET') return json(res, 200, state.comments[m[1]] || []);
      if (m && req.method === 'POST') { const n = Number(m[1]); posts.push({ kind: n === 53 ? 'bus' : 'comment', n, body: b.body }); if (n !== 53) (state.comments[n] = state.comments[n] || []).push({ id: 1000 + posts.length, created_at: new Date().toISOString(), body: b.body }); return json(res, 201, { id: 1 }); }
      json(res, 404, { message: 'not mocked ' + r });
    });
  });
  return { srv, posts, setSite: (s) => { site = s; } };
}
const issue = (n, title, labels, upd) => ({ number: n, title, body: title + '\n<!-- request -->', labels: ['request', ...labels].map((name) => ({ name })), updated_at: upd, comments: 1, html_url: 'u' + n });
const fixture = () => ({
  next: 7800, slow: false,
  issues: [issue(7689, 'Ask all workers for status', ['req:waiting'], ago(1)), issue(7690, 'Why are worker runs shorter?', ['req:working'], ago(5)), issue(7688, 'Ask the workers what they are doing', ['req:done'], ago(2)), issue(7687, 'Add a Requests section', ['req:done'], ago(30))],
  comments: {
    7690: [{ id: 1, created_at: ago(9), body: 'from: commander\n\nMeasuring 259 runs.\n```result\nIdle runs are 25% of all runs\n```\n```undo\n{"id":"u1","what":"set FILL to 3","undo":"gh variable set FILL --body 5"}\n```\n```dashboard\n<!doctype html><body><h1 id="dh">Runs per hour</h1><script>document.title="ran"</script></body>\n```' }],
    7689: [{ id: 2, created_at: ago(2), body: 'from: requests\n\nWaiting for 7 workers to run.' }], 7688: [{ id: 3, created_at: ago(3), body: 'from: requests\n\nOne worker is running #6113.' }], 7687: [],
  },
});
async function browser(S, d) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  const site = join(d, 'site'), bmod = join(d, 'bm'); mkdirSync(bmod, { recursive: true });
  for (const [n, k] of [['build.mjs', 'build'], ['app.js', 'app'], ['index.html', 'html'], ['subs.js', 'subs'], ['runs.js', 'runs'], ['home.js', 'home'], ['controls.js', 'controls'], ['requests.js', 'requests'], ['sw.js', 'sw'], ['manifest.webmanifest', 'manifest']]) writeFileSync(join(bmod, n), S[k]);
  (await import(pathToFileURL(join(bmod, 'build.mjs')).href)).build(site);
  const state = fixture(), m = mock(state); m.setSite(site);
  await new Promise((r) => m.srv.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${m.srv.address().port}`;
  const page = await open(origin + '/index.html', { port: 9438, width: 390, height: 844, initScript: `localStorage.setItem('gh-token','t');localStorage.setItem('gh-api','${origin}');localStorage.setItem('rq-poll-ms','600');` });
  if (!page) { m.srv.close(); return f; }
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await page.evaluate(() => { location.hash = '#/requests'; });
    const listed = await page.waitFor(() => document.querySelectorAll('a.rq').length >= 4, 8000);
    if (!listed) console.log('DEBUG body:', (await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 300), '| problems:', page.problems.slice(0, 3).join(' ; ').slice(0, 400));
    ok(listed, 'list: a card per request appears');
    const h = await page.evaluate(() => ({ cards: [...document.querySelectorAll('a.rq')].map((c) => c.innerText.replace(/\s+/g, ' ')), tabs: [...document.querySelectorAll('#tabs a')].map((a) => a.innerText.replace(/\s+/g, ' ')).join('|'), overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
    ok(h.cards.map((c) => (/(Ask all workers|Why are worker|Ask the workers what|Add a Requests)/.exec(c) || [])[1]).join() === 'Ask all workers,Why are worker,Ask the workers what,Add a Requests', `list order: open by activity, then done (got ${h.cards.map((c) => c.slice(0, 30)).join(' / ')})`);
    ok(/Waiting/.test(h.cards[0]) && /Working/.test(h.cards[1]) && /Done/.test(h.cards[2]), 'each card has its status chip');
    ok(/Idle runs are 25% of all runs/.test(h.cards[1]) && /Waiting for 7 workers/.test(h.cards[0]), 'a card shows the latest result block, else the last comment line');
    ok(/Requests \(4\)/.test(h.tabs), `the Requests tab shows how many have news (got "${h.tabs}")`);
    ok(!h.overflow, 'no sideways scrolling at phone width, six tabs included');
    const fit = await page.evaluate(() => { document.getElementById('qn').textContent = ' (12)'; document.getElementById('rn').textContent = ' (12)'; const as = [...document.querySelectorAll('#tabs a')]; return { n: as.length, clipped: as.filter((a) => a.scrollWidth > a.clientWidth + 1).map((a) => a.innerText), h: document.getElementById('tabs').offsetHeight }; });
    ok(fit.n === 6 && fit.clipped.length === 0 && fit.h < 70, `all six tabs fit the bottom bar at 390 px, even with two badges of (12) (clipped: ${fit.clipped.join(',') || 'none'}; bar ${fit.h}px)`);
    // a new request: an optimistic card at once, then the issue + the bus mail in the exact format
    state.slow = true;
    await page.evaluate(() => { const t = document.getElementById('rqt'); t.value = 'Please check the lander\nand tell me why it is slow'; t.dispatchEvent(new Event('input')); document.getElementById('rqsend').click(); });
    ok(await page.waitFor(() => /Sending/.test(document.querySelector('a.rq').innerText) && /Please check the lander/.test(document.querySelector('a.rq').innerText), 1500), 'a new request shows as a card at once, before GitHub answers');
    ok(await page.waitFor(() => /Waiting/.test(document.querySelector('a.rq').innerText) && !/Sending/.test(document.body.innerText), 5000), 'the card becomes the real request when GitHub answers');
    state.slow = false;
    const pi = m.posts.find((p) => p.kind === 'issue'), pb = m.posts.find((p) => p.kind === 'bus');
    ok(pi && pi.b.title === 'Please check the lander' && pi.b.body === 'Please check the lander\nand tell me why it is slow\n<!-- request -->' && pi.b.labels.join() === 'request,req:waiting', 'sending creates the issue: title, body + marker, labels request and req:waiting');
    ok(pb && pb.body === `to: requests\nfrom: dan\ntype: info\n\n#${pi && pi.n}` && pb.n === 53, 'and posts the bus mail that wakes the handler');
    // the thread
    await page.evaluate(() => { [...document.querySelectorAll('a.rq')].find((c) => /Why are worker/.test(c.innerText)).click(); });
    ok(await page.waitFor(() => /Measuring 259 runs/.test(document.body.innerText) && document.querySelector('iframe.dash'), 6000), "tap a card: the thread opens with the handler's comment and the dashboard");
    const t = await page.evaluate(() => { const i = document.querySelector('iframe.dash'); if (!i) return null; let same = false; try { same = !!i.contentDocument; } catch { same = false; } return { sb: i.getAttribute('sandbox'), srcdoc: (i.getAttribute('srcdoc') || '').includes('Runs per hour'), same, who: [...document.querySelectorAll('.msg .who b')].map((b) => b.innerText), result: !!document.querySelector('.result'), undo: !!document.querySelector('button[data-undo="u1"]'), overflow: document.documentElement.scrollWidth > innerWidth + 1 }; });
    if (!t) console.log('DEBUG problems:', page.problems.join(' ; '));
    ok(t && t.sb === 'allow-scripts' && t.srcdoc, `the dashboard is an iframe with sandbox="allow-scripts" and its HTML in srcdoc (got ${t && t.sb})`);
    ok(!(t && t.same), 'the dashboard cannot reach the app (no same-origin access to its document)');
    ok(t && t.who.includes('commander') && t.result && t.undo, 'the thread has a bubble labelled by who wrote it, the result card and an Undo button');
    ok(t && !t.overflow, 'the thread has no sideways scrolling');
    await page.evaluate(() => { document.querySelector('button.fsb').click(); });
    ok(await page.waitFor(() => document.querySelector('.dashbox.fs'), 2000), 'a dashboard goes full screen on tap');
    await page.evaluate(() => { document.querySelector('button.fsb').click(); });
    // the handler writes a new comment: it appears within a poll or two
    state.comments[7690].push({ id: 50, created_at: new Date().toISOString(), body: 'from: requests\n\nSecond finding: the pilot cap.' });
    ok(await page.waitFor(() => /Second finding: the pilot cap/.test(document.body.innerText), 4000), 'thread polling: a new comment shows up within one poll');
    await page.evaluate(() => { document.querySelector('button[data-undo="u1"]').click(); });
    ok(await page.waitFor(() => /undo requested/.test(document.body.innerText) && !document.querySelector('button[data-undo="u1"]'), 4000), 'tapping Undo replaces the button with "undo requested"');
    const pu = m.posts.filter((p) => p.kind === 'comment' && p.n === 7690), bu = m.posts.filter((p) => p.kind === 'bus');
    ok(pu.some((p) => p.body === 'from: dan\n\nundo u1') && bu.length >= 2 && bu[bu.length - 1].body === 'to: requests\nfrom: dan\ntype: info\n\n#7690', 'undo posts the comment "undo u1" and the bus mail');
    await page.evaluate(() => { const t = document.getElementById('rqr'); t.value = 'also check the lander'; t.dispatchEvent(new Event('input')); document.getElementById('rqrsend').click(); });
    ok(await page.waitFor(() => /also check the lander/.test(document.body.innerText), 4000), 'a reply shows in the thread');
    ok(m.posts.some((p) => p.kind === 'comment' && p.body === 'from: dan\n\nalso check the lander'), 'the reply is a comment that starts "from: dan"');
    ok(m.posts.filter((p) => p.kind === 'bus').length >= 3, 'and wakes the handler');
    ok(page.problems.length === 0, `no console errors in the app (${page.problems.slice(0, 2).join(' | ')})`);
  } finally { await page.close(); m.srv.close(); }
  return f;
}

// ---------- the run, then the breaks
const chrome = !!findChrome();
if (!chrome) console.log('SKIP  phonerequestscheck browser part: no Chromium found (set $CHROME to run it)');
const d0 = mkdtempSync(join(tmpdir(), 'rq-')); let fails = [...logic(SRC, d0)]; if (chrome) fails.push(...await browser(SRC, d0)); rmSync(d0, { recursive: true, force: true });
const total = N;
const rep = (k, a, b) => (S) => { if (!S[k].includes(a)) throw new Error(`no such text in ${k}: ${a}`); return { ...S, [k]: S[k].split(a).join(b) }; };
const LOGIC_BREAKS = [
  ['done does not beat waiting', rep('requests', "L.includes('req:done') ? 'done'", "L.includes('req:donex') ? 'done'")],
  ['titles are not clipped', rep('requests', "|| '', 80)", "|| '', 8000)")],
  ['the body loses its marker', rep('requests', "body: t + '\\n' + MARK", 'body: t')],
  ['a new request forgets its label', rep('requests', "labels: ['request', 'req:waiting']", "labels: ['request']")],
  ['the bus mail is a reply, not info', rep('requests', 'type: info', 'type: reply')],
  ['the bus mail goes to the wrong address', rep('requests', 'to: requests', 'to: commander')],
  ['undo has the wrong words', rep('requests', 'undo ${id}', 'undo: ${id}')],
  ['done requests sort first', rep('requests', "return open.concat(list.filter((r) => r.status === 'done').sort(by));", "return list.filter((r) => r.status === 'done').sort(by).concat(open);")],
  ['oldest activity first', rep('requests', 'ms(b.updated) - ms(a.updated)', 'ms(a.updated) - ms(b.updated)')],
  ['the dashboard may touch the app', rep('requests', "SANDBOX = 'allow-scripts'", "SANDBOX = 'allow-scripts allow-same-origin'")],
  ['the dashboard has no size limit', rep('requests', 'MAX_DASH = 60000', 'MAX_DASH = 60000000')],
  ['handler text is not escaped', rep('requests', 'const md = (t) => esc(t)', 'const md = (t) => String(t)')],
  ['the from: line stays in the text', rep('requests', 'b = m ? b.slice(m[0].length) : b;', '')],
  ['run markers show as comments', rep('requests', "if (b.startsWith('<!-- brain-run')) return null;", '')],
  ["a card shows Dan's own words", rep('requests', "filter((c) => c.from !== 'dan')", 'filter(Boolean)')],
  ['the badge counts nothing', rep('requests', 'ms(r.updated) > ((seen', 'ms(r.updated) < ((seen')],
  ['index.html drops requests.js', rep('html', '<script src="requests.js"></script>', '')],
  ['the build forgets requests.js', rep('build', "'controls.js', 'requests.js'", "'controls.js'")],
  ['a polling loop in the app', rep('app', 'async function pollRequests() {', 'async function pollRequests() { while (true) { break; }')],
];
const BROWSER_BREAKS = [
  ['no card until GitHub answers', rep('app', 'rq.list.unshift(card);', '')],
  ['the handler is never woken by a new request', rep('app', 'try { await postBus(Requests.busMail(iss.number));', 'try { await 0;')],
  ['undo posts nothing', rep('app', 'sendThread(Requests.undoComment(b.dataset.undo)', 'sendThread(null')],
  ['the thread never polls', rep('app', "if (route.at === 'requests' && rq.open) { await loadThread(rq.open);", "if (route.at === 'requests' && rq.open && 0) { await loadThread(rq.open);")],
  ['a reply does not wake the handler', rep('app', 'try { await postBus(Requests.busMail(n)); rq.msg = ok;', 'try { rq.msg = ok;')],
  ['cards show no result line', rep('app', 'rq.last[r.n] && rq.last[r.n].text ?', 'false ?')],
  ['tab text too big for six tabs', rep('html', 'font-size: 11.5px; white-space: nowrap;', 'font-size: 17px; white-space: nowrap;')],
  ['no badge on the tab', rep('app', "document.getElementById('rn'); if (t) t.textContent = n ?", "document.getElementById('rn'); if (t) t.textContent = 0 ?")],
];
let caught = 0, ran = 0;
const attempt = async (name, mut, withBrowser) => {
  const d = mkdtempSync(join(tmpdir(), 'rq-')); let r;
  try { const S = mut(SRC); r = logic(S, d); if (withBrowser && !r.length) r = await browser(S, d); } catch (e) { r = [`threw: ${e.message}`]; if (/no such text/.test(e.message)) fails.push(`break "${name}" does not apply: ${e.message}`); }
  rmSync(d, { recursive: true, force: true }); ran++;
  if (r.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
};
for (const [n, mut] of LOGIC_BREAKS) await attempt(n, mut, false);
if (chrome) for (const [n, mut] of BROWSER_BREAKS) await attempt(n, mut, true);
console.log(`phonerequestscheck: ${caught} breaks caught (of ${ran})${chrome ? '' : ' [browser breaks skipped: no Chromium]'}`);
for (const x of fails) console.log(`  ✗ ${x}`);
console.log(` assertions passed .... ${total - fails.filter((x) => !/^break/.test(x)).length}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
