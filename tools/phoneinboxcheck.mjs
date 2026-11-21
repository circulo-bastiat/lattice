#!/usr/bin/env node
// phoneinboxcheck.mjs - #4180: the phone Inbox. Pure logic of phone-web/inbox.js (record -> feed, 7-day window, order, deep link, escaping), load() against a MOCKED GitHub API,
// and the wiring (brain notify() records each push, the app route, the build ships inbox.js). ANTI-VACUITY: broken copies of the sources must be caught ("<n> breaks caught").
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const T = fileURLToPath(new URL('.', import.meta.url)), rd = (p) => readFileSync(join(T, p), 'utf8');
const SRC = { inbox: rd('phone-web/inbox.js'), app: rd('phone-web/app.js'), build: rd('phone-web/build.mjs'), html: rd('phone-web/index.html'), home: rd('brain/home.mjs') };
const NOW = Date.parse('2026-10-26T12:00:00Z'), D = 86400e3;
let N = 0, U = 0;
async function run(S, d) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  const fn = join(d, `inbox${++U}.cjs`); writeFileSync(fn, S.inbox); const I = createRequire(import.meta.url)(fn);
  const c = (id, at, o = {}) => ({ id, body: I.record({ at, title: 'T' + id, text: 'text ' + id, url: o.url || '/', ...o }) });
  const comments = [c(1, NOW - 8 * D), c(2, NOW - 6 * D), c(3, NOW - 1000, { url: '/#/questions' }), { id: 4, body: 'hello' }, { id: 5, body: '<!-- push-log -->\n{bad' }, c(6, NOW - 3 * D)];
  const fd = I.feed(comments, NOW);
  ok(fd.map((e) => e.id).join() === '3,6,2', `feed: last 7 days only, newest first, junk skipped (got ${fd.map((e) => e.id)})`);
  ok(fd[0].title === 'T3' && fd[0].text === 'text 3' && fd[0].url === '/#/questions', 'an entry keeps title, text and deep link');
  ok(I.hashOf('/#/questions') === '#/questions' && I.hashOf('/') === '#/' && I.hashOf('/#/requests/12') === '#/requests/12', 'tap = the same deep link (hash route)');
  const h = I.html(fd, () => '1m ago');
  ok(/href="#\/questions"/.test(h) && /<b>T3<\/b>/.test(h) && /1m ago/.test(h), 'the feed rows link to the push deep link');
  ok(/No pushes in the last 7 days/.test(I.html([], () => '')), 'an empty feed says so');
  ok(!/<script|<img/.test(I.html([{ title: '<script>x</script>', text: '<img onerror=1>', at: NOW, url: '/#/"><x' }], () => '')), 'titles, texts and links are escaped');
  const seen = [];
  const gh = async (m, p) => { seen.push(m + ' ' + p); if (p.includes('labels=push-log')) return [{ number: 77 }]; if (p.startsWith('/repos/{repo}/issues/77/comments')) return comments; throw new Error('unexpected ' + p); };
  const L = await I.load(gh, NOW);
  ok(L.length === 3 && seen.length === 2 && seen[1].includes('/issues/77/comments'), 'load(): finds the push-log issue and reads its comments through the API');
  ok((await I.load(async () => [], NOW)).length === 0, 'load(): no push-log issue yet = empty feed');
  ok(/Inbox\.record\(/.test(S.home) && /await logPush\(text, title, url\)/.test(S.home), 'brain notify() records every push');
  ok(/h === '#\/inbox'/.test(S.app) && /Inbox\.load\(gh/.test(S.app), 'the app has the #/inbox route');
  ok(/'inbox\.js'/.test(S.build) && /inbox\.js/.test(S.html), 'the build ships inbox.js and index.html loads it');
  return f;
}
const breaks = [
  ['inbox', 'now - e.at < WEEK', 'true', 'no 7-day window'],
  ['inbox', '.sort((a, b) => b.at - a.at)', '', 'no newest-first order'],
  ['inbox', "startsWith(MARK)", "startsWith('x')", 'marker ignored'],
  ['inbox', 'esc(e.text)', 'e.text', 'text not escaped'],
  ['inbox', "String(url).slice(i)", "'#/'", 'deep link dropped'],
  ['inbox', "labels=${LABEL}", 'labels=other', 'wrong label'],
  ['home', 'await logPush(text, title, url);', '', 'brain does not record'],
  ['app', "'#/inbox'", "'#/nope'", 'route missing'],
  ['build', "'inbox.js', ", '', 'build omits inbox.js'],
];
const d = mkdtempSync(join(tmpdir(), 'inbox-'));
try {
  const f = await run(SRC, d);
  for (const m of f) console.log('FAIL: ' + m);
  let caught = 0;
  for (const [k, from, to, name] of breaks) {
    if (!SRC[k].includes(from)) { console.log(`FAIL: break "${name}" does not apply`); f.push(name); continue; }
    const r = await run({ ...SRC, [k]: SRC[k].split(from).join(to) }, d).catch(() => ['threw']);
    if (r.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else { console.log(`FAIL: break not caught: ${name}`); f.push(name); }
  }
  console.log(`phoneinboxcheck: ${caught} breaks caught (of ${breaks.length})`);
  console.log(` assertions passed .... ${N}`);
  console.log(` failures ........... ${f.length}`);
  process.exitCode = f.length ? 1 : 0;
} finally { rmSync(d, { recursive: true, force: true }); }
