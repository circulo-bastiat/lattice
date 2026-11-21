// #12214: fullStale honours the once-a-day same-sha rule (#11387). Feeds it cases, then breaks it.
import { readFileSync } from 'node:fs';
import { fullStale } from './infra/runnerguard.mjs';
const H = 3600e3, now = Date.parse('2026-11-17T12:00:00Z'), at = new Date(now - 17 * H).toISOString();
const run = (c, sha = 'aaa') => [{ status: 'completed', conclusion: c, updated_at: at, head_sha: sha }];
const gpu = [{ name: 'g', status: 'online', labels: ['gpu'] }];
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const cases = (f) => [
  f(run('success'), gpu, now, 6, true, { masterSha: 'aaa' }) === null,
  f(run('success'), gpu, now, 6, true, { sameSha: true }) === null,
  /no full-suite result for 17 h/.test(f(run('success'), gpu, now, 6, true, { masterSha: 'bbb' }) || ''),
  /no full-suite result for 17 h/.test(f(run('failure'), gpu, now, 6, true, { masterSha: 'aaa', sameSha: true }) || ''),
  /no full-suite result/.test(f(run('success'), gpu, now + 8 * H, 6, true, { masterSha: 'aaa' }) || ''),
];
ok(cases(fullStale).every(Boolean), 'cases: ' + cases(fullStale).join(','));
const brks = { 'ignores sameSha': (r, g, n, h, o) => fullStale(r, g, n, h, o), 'always null': () => null, 'exempts failures': (r, g, n, h, o, x) => fullStale(r.map((y) => ({ ...y, conclusion: 'success' })), g, n, h, o, x), 'no day limit': (r, g, n, h, o, x) => fullStale(r, g, n - 8 * H, h, o, x) };
let n = 0; for (const [k, f] of Object.entries(brks)) { if (cases(f).every(Boolean)) { bad++; console.log('NOT caught: ' + k); } else n++; }
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
ok(/masterSha: msha0/.test(src('brain/brain.mjs')), 'wired in brain');
ok(/1440 \* 60e3/.test(src('go.mjs')), 'wired in go.mjs status');
console.log(`fullstalesameshacheck: ${bad ? 'FAILED' : 'ok'}, ${n} breaks caught`); process.exit(bad ? 1 : 0);
