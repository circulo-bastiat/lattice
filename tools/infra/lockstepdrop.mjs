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
const gitIn = (root) => (a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
/** prints the line and remembers this build in .ledger/lockstep-count.json (only when the matrix sha changed) */
export function report(mx, root) {
  const f = join(root, '.ledger', 'lockstep-count.json'); let store = null;
  try { store = JSON.parse(readFileSync(f, 'utf8')); } catch {}
  const line = statusLine(mx, store, gitIn(root));
  if (mx && mx.sha && (!store || store.sha !== mx.sha)) { try { mkdirSync(join(root, '.ledger'), { recursive: true }); writeFileSync(f, JSON.stringify({ count: lockstepCount(mx), sha: mx.sha })); } catch {} }
  return line;
}
