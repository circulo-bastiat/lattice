// #7769 secretscancheck: planted secrets in a diff, a log, a bus post, a URL and a key block must each be caught.
import { scanText, scanDiffText } from './secretscan.mjs';
import { redact } from './redact.mjs';
const tok = 'ghp_' + 'A1b2'.repeat(9), pat = 'github_pat_' + 'x9'.repeat(15), sk = 'sk-' + 'ab12'.repeat(8);
const url = `https://x-access-token:${'z'.repeat(20)}@github.com/o/r.git`, key = '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIE\n-----END ' + 'RSA PRIVATE KEY-----';
let bad = 0, caught = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } };
const plants = { token: tok, pat, sk, url, key };
for (const [n, s] of Object.entries(plants)) {
  const diff = `+++ b/tools/x.mjs\n@@ -1,0 +5,1 @@\n+const t = '${s.split('\n')[0]}'`;
  const d = scanDiffText(diff); ok(d.length === 1 && d[0].line === 5 && d[0].file === 'tools/x.mjs', 'diff ' + n);
  ok(!JSON.stringify(d).includes(s.slice(8, 24)), 'scan prints secret ' + n);
  ok(scanText(`log line ${s}`, 'log').length > 0, 'log ' + n);
  const r = redact(`to: all\n\n${s}`); ok(!r.includes(s.split('\n')[0].slice(0, 30)) && /REDACTED/.test(r), 'bus redact ' + n);
  ok(scanText(r).length === 0, 'redacted text still dirty ' + n);
  caught++;
}
ok(scanDiffText('+++ b/a\n@@ -1 +1 @@\n+nothing here sk-short').length === 0, 'false positive');
ok(scanDiffText(`+++ b/a\n@@ -1 +1 @@\n-${tok}`).length === 0, 'removed line flagged');
// commander 16 Oct: code that BUILDS a token URL is not a leak (10 shapes on master)
for (const t of ['x-access-token:${tok}@github.com', 'x-access-token:${process.env.GH_TOKEN}@', 'x-access-token:$GH_TOKEN@github.com', "x-access-token:' + tok + '@", 'x-access-token:<token>@', 'x-access-token:%s@github.com', 'x-access-token:{tok}@', 'x-access-token:${a.b.c.d.e.f.g.h}@'])
  ok(scanText(t, 'code').length === 0 && redact(t) === t, 'template flagged: ' + t);
console.log(bad ? `secretscancheck: ${bad} FAILED` : `secretscancheck ok - ${caught * 4} breaks caught`);
process.exit(bad ? 1 : 0);
