// lockstepdrop.mjs (#9844): the proof-matrix status line names the lockstep dimension, and when it fell by more than 10 between two builds it names the first
// commit in between that touched a SHARED lockstep file (the 72 -> 1 wipe of #9742 went unnoticed for hours).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { SHARED } from '../referee/lockstep/inputs.mjs';
export const FALL = 10;
export const lockstepCount = (mx) => Object.values((mx && mx.rows) || {}).filter((r) => r && r.lockstep === 'green').length;
/** first commit in prev..cur (oldest first) touching a SHARED file, as 'sha subject', or null; `git(args)` is injectable */
export function firstSharedCommit(prev, cur, git) {
  const out = String(git(['log', '--reverse', '--format=%h %s', `${prev}..${cur}`, '--', ...SHARED.map((f) => 'tools/' + f)]) || '').split('\n').filter(Boolean);
  return out[0] || null;
}
/** the status line; `store` = { count, sha } of the previous build (or null) */
export function statusLine(mx, store, git) {
  const n = lockstepCount(mx), roster = (mx && mx.roster) || 0;
  let s = `lockstep dimension ${n}/${roster}`;
  if (store && store.sha !== (mx && mx.sha) && store.count - n > FALL) {
    let c = null; try { c = firstSharedCommit(store.sha, mx.sha, git); } catch {}
    s += ` - FELL ${store.count - n} points since ${String(store.sha).slice(0, 7)}${c ? '; first SHARED-file commit in between: ' + c : ''}`;
  }
  return s;
}
/** #10102: how old the matrix is against the code and results it is read next to (the status printed 78/91 for hours while the real credit was lower). `git(args)` is injectable */
export function staleNote(mx, git) {
  if (!(mx && mx.full === true && mx.sha)) return ' - NOT a full run (restored by hand or a partial build): do not trust this number';
  const s7 = String(mx.sha).slice(0, 7), lines = (a) => String(git(a) || '').split('\n').filter(Boolean);
  try {
    const inputs = lines(['log', '--format=%h %s', `${mx.sha}..HEAD`, '--', ...SHARED.map((f) => 'tools/' + f), 'tools/referee/lanes.d', 'tools/referee/steplanes.d', 'tools/referee/lockstep', ':(exclude)tools/referee/lockstep/pilot-results']);
    const results = lines(['log', '--format=%h', `${mx.sha}..HEAD`, '--', 'tools/referee/lockstep/pilot-results']);
    let s = '';
    if (inputs.length) s += ` - OLDER THAN THE CODE: ${inputs.length} commit(s) since ${s7} changed lockstep inputs (oldest: ${inputs[inputs.length - 1]}); results at the new hash are not counted until the next full run`;
    if (results.length) s += ` - ${results.length} result commit(s) landed since ${s7} and are not counted yet`;
    return s;
  } catch { return ` - built at ${s7}, which is not in this clone: its age against the results is unknown`; }
}
const gitIn = (root) => (a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
/** prints the line and remembers this build in .ledger/lockstep-count.json (only when the matrix sha changed) */
export function report(mx, root) {
  const f = join(root, '.ledger', 'lockstep-count.json'); let store = null;
  try { store = JSON.parse(readFileSync(f, 'utf8')); } catch {}
  const line = statusLine(mx, store, gitIn(root)) + staleNote(mx, gitIn(root));
  if (mx && mx.sha && (!store || store.sha !== mx.sha)) { try { mkdirSync(join(root, '.ledger'), { recursive: true }); writeFileSync(f, JSON.stringify({ count: lockstepCount(mx), sha: mx.sha })); } catch {} }
  return line;
}
