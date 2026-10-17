// diskclean.mjs - #4965: the guest's root disk hit 100% (10 Oct) and every run died at 'Set up job'. What grows without bound is the
// runner _diag logs (~440 MB per runner) and the /tmp scratch dirs the checks leave behind; both are regenerable.
import { readdirSync, statSync, rmSync, statfsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const TMP_RE = /^(bpc|dorm|dm|org|fsc|goals|clr|bslots|mc|lockstep|lockstepchk|lstable|lockproof|knotlane|lanesd|ag|mclite-mdl)-/;
/** pure: which of [{path, name, mtime}] to delete. kind 'tmp' = scratch dir by name, older than 1 day; 'diag' = any file older than 2 days. */
export function stale(entries, kind, now) {
  const age = kind === 'diag' ? 2 * 86400e3 : 86400e3;
  return entries.filter((e) => now - e.mtime > age && (kind === 'diag' || TMP_RE.test(e.name)));
}
export const freeGB = (p = '/') => { const s = statfsSync(p); return s.bavail * s.bsize / 2 ** 30; };
const list = (d) => { try { return readdirSync(d).map((n) => { const path = join(d, n); try { return { path, name: n, mtime: statSync(path).mtimeMs }; } catch { return null; } }).filter(Boolean); } catch { return []; } };
/** deletes the stale ones; returns how many. `roots` is injectable for the check. */
export function clean(now = Date.now(), roots = {}) {
  const runners = roots.runners || join(homedir(), 'runners'), tmp = roots.tmp || tmpdir();
  const hit = [...stale(list(tmp), 'tmp', now)];
  for (const r of list(runners)) hit.push(...stale(list(join(r.path, '_diag')), 'diag', now));
  for (const e of hit) try { rmSync(e.path, { recursive: true, force: true }); } catch {}
  return hit.length;
}
