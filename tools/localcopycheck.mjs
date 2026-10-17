// tools/localcopycheck.mjs - Dan's Projects copy stays current (tools/infra/localcopy.mjs): even after a Cowork VM git op
// left lock files (28 Sept), a rebuild left src/19_data.gen.js modified, a local RUN.md edit sat in it (2 Oct, #1652), and
// - #1684 - when no full suite ever FINISHES because every landing cancels it: land.mjs updates it after a drain too.
// Pure: reads the sources.
import { readFileSync } from 'node:fs';
const rd = (f) => readFileSync(new URL('./infra/' + f, import.meta.url), 'utf8');
const SRC = { lc: rd('localcopy.mjs'), land: rd('land.mjs'), full: rd('full.mjs'), build: readFileSync(new URL('../build.mjs', import.meta.url), 'utf8') };
function verdicts(S) {
  const bad = [], src = S.lc, pull = src.indexOf("git('pull', '-q', '--ff-only', 'origin', 'master')");
  if (pull < 0) return ['localcopy.mjs no longer fast-forwards the Projects copy'];
  const before = src.slice(0, pull);
  for (const l of ['index.lock', 'refs/remotes/origin/master.lock']) if (!before.includes(`'${l}'`)) bad.push(`a stale ${l} is not cleared before the pull`);
  if (!/unlinkSync\(f\)/.test(before)) bad.push('stale locks are listed but never removed');
  if (!/mtimeMs > 10 \* 60e3/.test(before)) bad.push('a LIVE lock (younger than 10 min) could be removed');
  if (!before.includes("git('checkout', '--', 'src/19_data.gen.js')")) bad.push('the rebuilt src/19_data.gen.js is not reset before the pull');
  if (!/git\('stash', 'push', '-q'/.test(before)) bad.push('a local edit in the copy is not stashed before the pull, so it blocks the update');
  if (!/REBUILD_AFTER_MS/.test(src) || !/statSync\(dist\)\.mtimeMs > REBUILD_AFTER_MS/.test(src)) bad.push('the rebuild is not throttled: every landing would rebuild the copy');
  if (!/import \{ gitAuthArgs \} from '\.\/gh\.mjs'/.test(src) || !/a\[0\] === 'pull' \? gitAuthArgs\(\)/.test(src)) bad.push('the pull carries no token: with the credential helper off (gitenv) it fails with Invalid username or token (#8328)');
  if (!/updateLocalCopy\(DATA, \{ force: true \}\)/.test(S.full)) bad.push('full.mjs no longer updates the copy');
  if (!/if \(landed\) \{ try \{ updateLocalCopy\(DATA\)/.test(S.land)) bad.push('land.mjs never updates the copy after a landing, so it waits on a full suite every landing cancels');
  if (!/sync-conflict-/.test(src) || !/unlinkSync\(f\); swept\+\+/.test(src) || src.indexOf('swept++') > src.indexOf("'tools/suite.mjs'")) bad.push('*.sync-conflict-* files are not deleted before the rebuild');
  if (!/!f\.includes\('\.sync-conflict-'\)/.test(S.build)) bad.push('build.mjs counts *.sync-conflict-* files as src modules');
  return bad;
}
const real = verdicts(SRC);
const BREAKS = [
  ['conflict files not swept', (S) => ({ ...S, lc: S.lc.replace('unlinkSync(f); swept++', 'swept++') })],
  ['build.mjs trips on conflict files', (S) => ({ ...S, build: S.build.replaceAll(" && !f.includes('.sync-conflict-')", '') })],
  ['no lock sweep', (S) => ({ ...S, lc: S.lc.replace(/  for \(const l of \['index\.lock'[\s\S]*?\n  \}\n/, '') })],
  ['gen file not reset', (S) => ({ ...S, lc: S.lc.replace(/  git\('checkout', '--', 'src\/19_data\.gen\.js'\);[^\n]*\n/, '') })],
  ['local edits not stashed', (S) => ({ ...S, lc: S.lc.replace(/  if \(git\('status'[\s\S]*?\n  \}\n/, '') })],
  ['live locks removed too', (S) => ({ ...S, lc: S.lc.replace(' && Date.now() - statSync(f).mtimeMs > 10 * 60e3', '') })],
  ['rebuild on every landing', (S) => ({ ...S, lc: S.lc.replace('Date.now() - statSync(dist).mtimeMs > REBUILD_AFTER_MS', 'true') })],
  ['land.mjs never updates the copy', (S) => ({ ...S, land: S.land.replace(/if \(landed\) \{ try \{ updateLocalCopy[^\n]*\n/, '') })],
  ['pull without a token', (S) => ({ ...S, lc: S.lc.replace("a[0] === 'pull' ? gitAuthArgs() : []", '[]') })],
  ['full.mjs stops updating it', (S) => ({ ...S, full: S.full.replace('updateLocalCopy(DATA, { force: true })', '') })],
];
let caught = 0;
for (const [n, br] of BREAKS) { const m = br(SRC); if (JSON.stringify(m) !== JSON.stringify(SRC) && verdicts(m).length) { caught++; console.log(`  ✓ break caught: ${n}`); } else console.log(`  ✗ break NOT caught: ${n}`); }
for (const b of real) console.log(`  ✗ ${b}`);
console.log(`localcopycheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${12 - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
