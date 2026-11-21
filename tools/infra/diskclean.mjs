// diskclean.mjs - #4965: the guest's root disk hit 100% (10 Oct) and every run died at 'Set up job'. What grows without bound is the
// runner _diag logs (~440 MB per runner) and the /tmp scratch dirs the checks leave behind; both are regenerable.
import { readdirSync, statSync, rmSync, statfsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME_RE = /^scoped_dir/;
export const TMP_RE = /^(bpc|dorm|dm|org|fsc|goals|clr|bslots|mc|lockstep|lockstepchk|lstable|lockproof|knotlane|lanesd|ag|mclite-mdl)-/;
/** pure: which of [{path, name, mtime}] to delete. kind 'tmp' = scratch dir by name, older than 1 day; 'diag' = any file older than 2 days;
 *  'chrome' = a headless-Chrome scoped_dir* older than 1 day (#8919: 3,100 of them, 4.5 GB, were left behind by the browser stages). */
export function stale(entries, kind, now) {
  const age = kind === 'diag' ? 2 * 86400e3 : 86400e3;
  return entries.filter((e) => now - e.mtime > age && (kind === 'diag' || (kind === 'chrome' ? CHROME_RE : TMP_RE).test(e.name)));
}
export const freeGB = (p = '/') => { const s = statfsSync(p); return s.bavail * s.bsize / 2 ** 30; };
const list = (d) => { try { return readdirSync(d).map((n) => { const path = join(d, n); try { return { path, name: n, mtime: statSync(path).mtimeMs }; } catch { return null; } }).filter(Boolean); } catch { return []; } };
/** deletes the stale ones; returns how many. `roots` is injectable for the check. */
export function clean(now = Date.now(), roots = {}) {
  const runners = roots.runners || join(homedir(), 'runners'), tmp = roots.tmp || tmpdir();
  const hit = [...stale(list(tmp), 'tmp', now)];
  for (const r of list(runners)) hit.push(...stale(list(join(r.path, '_diag')), 'diag', now));
  for (const d of roots.chrome || ['.config', '.cache'].map((c) => join(homedir(), c, 'google-chrome-for-testing-headless'))) hit.push(...stale(list(d), 'chrome', now));
  for (const e of hit) try { rmSync(e.path, { recursive: true, force: true }); } catch {}
  return hit.length;
}

// #9245: actions/checkout writes gc.auto=0, so every runner clone grows to 2.5 GB of packs + loose objects. Compact idle ones.
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
/** pure: should this clone be compacted? never when its runner is busy. */
export function needsGc({ packs, loose, busy }) { return !busy && (packs > 20 || loose > 5000); }
const count = (d, f) => { try { return readdirSync(d).filter(f).length; } catch { return 0; } };
export function cloneStats(git) {
  const o = join(git, 'objects');
  let loose = 0; for (const n of list(o)) if (/^[0-9a-f]{2}$/.test(n.name)) loose += count(n.path, () => true);
  return { packs: count(join(o, 'pack'), (n) => n.endsWith('.pack')), loose };
}
const defaultBusy = (runnerDir) => { try { return execFileSync('pgrep', ['-af', 'Runner.Worker'], { encoding: 'utf8' }).split('\n').some((l) => l.includes(runnerDir)); } catch { return false; } };
const defaultRun = (git, args) => execFileSync('git', ['--git-dir', git, ...args], { stdio: 'ignore' });
/** compacts idle clones under runners/*\/_work/*\/*; at most once per `every` ms per clone. Returns the list of compacted .git dirs. */
export function gcClones(now = Date.now(), o = {}) {
  const runners = o.runners || join(homedir(), 'runners'), busy = o.busy || defaultBusy, run = o.run || defaultRun, every = o.every ?? 6 * 3600e3, done = [];
  for (const r of list(runners)) for (const w of list(join(r.path, '_work'))) for (const c of list(w.path)) {
    const git = join(c.path, '.git'), pack = join(git, 'objects', 'pack');
    if (!existsSync(git)) continue;
    if (busy(r.path)) continue;
    for (const t of list(pack)) if (/^tmp_/.test(t.name) && now - t.mtime > 86400e3) try { rmSync(t.path, { force: true }); } catch {}
    const stamp = join(git, 'mclite-gc-stamp');
    try { if (now - Number(readFileSync(stamp, 'utf8')) < every) continue; } catch {}
    if (!needsGc({ ...cloneStats(git), busy: false })) continue;
    try { run(git, ['-c', 'gc.auto=1', 'gc', '--prune=now']); done.push(git); writeFileSync(stamp, String(now)); } catch {}
  }
  if (done.length && !o.run) try { execFileSync('sudo', ['-n', 'fstrim', '-v', '/'], { stdio: 'ignore' }); } catch {}
  return done;
}
