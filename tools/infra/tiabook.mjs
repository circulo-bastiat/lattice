// #9840: tia bookkeeping helpers for full.mjs. A root/shallow commit has no parent: never let that abort the history append.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export function commitsBetweenIn(root) {
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const lines = (s) => s.split('\n').filter(Boolean);
  const filesOf = (sha) => {
    try { return lines(g('diff', '--name-only', sha + '^', sha)); } catch { /* root or shallow commit: no parent */ }
    try { return lines(g('show', '--name-only', '--format=', sha)); } catch { return []; }
  };
  return (a, b) => {
    let log = '';
    try { log = g('log', '--first-parent', '--format=%H %s', `${a}..${b}`); } catch { return []; }
    return lines(log).map((l) => ({ pr: (/land #(\d+)/.exec(l) || [])[1] || l.slice(0, 8), files: filesOf(l.split(' ')[0]) }));
  };
}

// the history record is appended whether or not the replay worked
export function bookkeep({ hf, rec, replayFn }) {
  try { replayFn(); } catch (e) { console.log('tia replay failed (not fatal): ' + e.message); }
  try { appendFileSync(hf, JSON.stringify(rec) + '\n'); } catch (e) { console.log('tia history append failed: ' + e.message); }
}
