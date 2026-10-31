// tools/takeovercheck.mjs - every GitHub WRITE in go.mjs's claim() has the cloud relay fallback (28 Sept: the stale-
// claim takeover's POST git/commits had none, so a cloud session died with "403 ... not permitted through this proxy"
// on the first stale claim at the head of the queue). Pure: reads tools/go.mjs.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('./go.mjs', import.meta.url), 'utf8');
function verdicts(src) {
  const bad = [];
  const fn = (src.match(/async function claim\(issue, inReview\) \{[\s\S]*?\n\}/) || [''])[0];
  if (!fn) return ['claim() not found'];
  // each write call must sit inside a try whose catch reaches proxyBlocked(...) before the next write
  const writes = [...fn.matchAll(/gh\('(POST|PATCH|PUT|DELETE)'/g)].map((m) => m.index);
  // a best-effort label is not a claim write (the next claim re-reads the hand-offs): its failure is swallowed on purpose
  const labelBestEffort = (i) => /^[^;]*\/(labels|comments)`[^;]*\.catch\(\(\) => \{\}\)/.test(fn.slice(i, i + 300));
  const posts = writes.filter((i) => /gh\('POST'/.test(fn.slice(i, i + 9)) && !labelBestEffort(i));
  for (const i of posts) {
    const after = fn.slice(i, i + 900);
    if (!/proxyBlocked\(e\)/.test(after)) bad.push(`a POST at ${fn.slice(i, i + 50).replace(/\s+/g, ' ')} has no relay fallback`);
  }
  if (posts.length < 2) bad.push('expected both claim writes (takeover commit, new ref)');
  if (!/opCommit\(ROOT, 'claim'[\s\S]*resumed: true, relayed: true/.test(fn)) bad.push('the takeover does not relay a claim op');
  return bad;
}
const real = verdicts(SRC);
const BREAKS = [
  ['the 28 Sept code: takeover without fallback', (s) => s.replace(/    catch \(e\) \{\n      \/\/ cloud: the proxy refuses API writes[\s\S]*?resumed: true, relayed: true \};\n    \}/, '    catch (e) { throw e; }')],
  ['new-claim fallback removed', (s) => s.replace('if (proxyBlocked(e) && outBranch(ROOT)) {           // cloud: optimistic claim', 'if (false) {')],
];
let caught = 0;
for (const [name, br] of BREAKS) { const m = br(SRC); if (m !== SRC && verdicts(m).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ break NOT caught: ${name}`); }
for (const b of real) console.log(`  ✗ ${b}`);
console.log(`takeovercheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${3 - Math.min(3, real.length)}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
