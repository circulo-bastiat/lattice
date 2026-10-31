// serve.mjs - the phone app's QA server (#7806): the built site plus a deterministic mock GitHub API (same gh-api approach as phonerunscheck).
// Fixtures: 40 issues in every state (long titles, with/without `dan`), 8 runs, 2 usage accounts, the real mobproof matrix (91 mobs), 3 requests.
//   node tools/phone-web/qa/serve.mjs [port]   -> prints the origin; open it with localStorage gh-token=t and gh-api=<origin>
import http from 'node:http';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from '../build.mjs';
const here = dirname(fileURLToPath(import.meta.url)), REPO = 'owner/mclite';
const T0 = Date.parse('2026-10-15T12:00:00Z'), ago = (m) => new Date(T0 - m * 60e3).toISOString();
const LONG = 'RED somethingcheck: a very long title that goes on and on about the exact way this check failed on master after the last landing, with detail';
export function fixtures() {
  const states = ['waiting', 'working', 'in review', 'blocked', 'landed'], issues = [];
  for (let i = 0; i < 40; i++) {
    const st = states[i % 5], labels = [{ name: st.replace(' ', '-') }];
    if (i % 3 === 0) labels.push({ name: 'dan' }); if (i % 7 === 0) labels.push({ name: 'severe' });
    issues.push({ number: 7000 + i, title: i % 6 === 0 ? LONG : i === 11 ? 'x'.repeat(5) + 'Supercalifragilistic'.repeat(2) : `Phase ${i}: ${st} item number ${i}`, state: st === 'landed' ? 'closed' : 'open', labels, created_at: ago(900 - i * 20), updated_at: ago(i * 7), html_url: `https://github.com/${REPO}/issues/${7000 + i}`, body: 'body', comments: i % 4 });
  }
  const names = ['brain worker @max', 'brain tester', 'brain fixer', 'brain waker x', '#7001 land', 'full-suite', 'brain worker @pro', 'brain commander'];
  const runs = names.map((n, i) => ({ id: 100 + i, display_title: n, name: n, run_started_at: ago(3 + i * 4), created_at: ago(3 + i * 4), html_url: 'https://github.com/r/' + i }));
  const acct = (e, w, p) => ({ ok: true, email: e, readAt: new Date(T0).toISOString(), week: { pct: w, resets_at: ago(-3000) }, window: { pct: p, resets_at: ago(-120) } });
  const usage = JSON.stringify({ at: ago(0), accounts: { max: acct('max@example.com', 42, 17), pro: acct('pro@example.com', 93, 71) } });
  const requests = [1, 2, 3].map((n) => ({ number: 7900 + n, title: n === 2 ? LONG : `Request ${n}: make the thing nicer`, state: n === 3 ? 'closed' : 'open', labels: [{ name: 'request' }], created_at: ago(300), updated_at: ago(n * 9), body: 'please', html_url: 'u' }));
  const comments = [{ id: 1, created_at: ago(2), body: 'to: log\nfrom: #7001\n\n#7001 drawing the home screen' }, { id: 2, created_at: ago(5), body: 'to: log\nfrom: brain\n\nbrain: worker run ended (ok, 13 turns, max) [usage $0.38] - landed' }];
  return { issues, runs, usage, requests, comments, matrix: JSON.parse(readFileSync(join(here, '..', '..', 'mobproof', 'matrix.json'), 'utf8')) };
}
export function start(siteDir, port = 0) {
  const F = fixtures(), MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const json = (res, o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname.replace(`/repos/${REPO}`, ''), q = u.searchParams;
    if (!u.pathname.startsWith('/repos/')) { const f = join(siteDir, u.pathname === '/' ? 'index.html' : u.pathname.slice(1)); if (!existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'text/plain' }); return res.end(readFileSync(f)); }
    const lab = q.get('labels');
    if (p === '') return json(res, { full_name: REPO });
    if (p === '/actions/runs') return json(res, { workflow_runs: q.get('status') === 'in_progress' ? F.runs : [] });
    if (/\/actions\/runs\/\d+\/jobs$/.test(p)) return json(res, { jobs: [] });
    if (p === '/actions/variables/MCLITE_USAGE') return json(res, { name: 'MCLITE_USAGE', value: F.usage });
    if (p === '/actions/runners') return json(res, { runners: [] });
    if (p === '/commits/master') return json(res, { sha: 'abc1234', commit: { message: 'land #7001: demo', committer: { date: ago(4) } } });
    if (p === '/pulls') return json(res, []);
    if (p === '/issues/comments' || /^\/issues\/\d+\/comments$/.test(p)) return json(res, F.comments);
    if (p === '/issues' && lab === 'bus') return json(res, [{ number: 1, title: 'bus' }]);
    if (p === '/issues' && lab === 'request') return json(res, F.requests);
    if (p === '/issues' && lab === 'dan-questions') return json(res, []);
    if (p === '/issues') return json(res, F.issues.filter((i) => (!lab || i.labels.some((l) => lab.split(',').includes(l.name))) && (q.get('state') === 'all' || i.state === (q.get('state') || 'open'))));
    if (/^\/issues\/\d+$/.test(p)) return json(res, F.issues.concat(F.requests).find((i) => '/issues/' + i.number === p) || {}, 200);
    if (p === '/contents/tools/mobproof/matrix.json') return json(res, { content: Buffer.from(JSON.stringify(F.matrix)).toString('base64'), encoding: 'base64' });
    json(res, { message: 'not mocked ' + p }, 404);
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({ srv, origin: `http://127.0.0.1:${srv.address().port}` })));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const d = mkdtempSync(join(tmpdir(), 'phoneqa-')); build(d); const s = await start(d, Number(process.argv[2]) || 0); console.log(s.origin); }
