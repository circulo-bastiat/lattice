// tools/infra/localcopy.mjs - #1684: keep Dan's own copy (Projects\mclite, where he double-clicks dist/mclite.html) current.
// Called by full.mjs AND by land.mjs after a drain that landed something: 2 Oct the copy only updated when a full suite
// FINISHED, and every newer master cancels the running one, so with a landing every few minutes it almost never did.
// It only ever fast-forwards; a local edit is stashed (kept), never allowed to block the update.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const REBUILD_AFTER_MS = 20 * 60e3;   // a landing every few minutes must not mean a 2-minute rebuild every few minutes
export function updateLocalCopy(DATA, { log = console.log, force = false } = {}) {
  if (!DATA || !existsSync(join(DATA, '.git'))) return 'no copy';
  const git = (...a) => spawnSync('git', a, { cwd: DATA, encoding: 'utf8' });
  // 28 Sept: a Cowork VM git op left .git/*.lock files it may not delete; the copy's own rebuild leaves
  // src/19_data.gen.js modified, which blocks a fast-forward. Clear both first.
  for (const l of ['index.lock', 'HEAD.lock', 'ORIG_HEAD.lock', 'refs/remotes/origin/master.lock', 'refs/heads/master.lock']) {
    const f = join(DATA, '.git', l);
    try { if (existsSync(f) && Date.now() - statSync(f).mtimeMs > 10 * 60e3) { unlinkSync(f); log('removed stale ' + l); } } catch {}
  }
  git('checkout', '--', 'src/19_data.gen.js');   // a build output, never an edit
  // 2 Oct: an uncommitted edit to RUN.md in the copy blocked every update for hours. Keep such an edit (stash), never block on it.
  if (git('status', '--porcelain', '--untracked-files=no').stdout.trim()) {
    const st = git('stash', 'push', '-q', '-m', 'localcopy-auto-stash');
    log(st.status ? `could not stash local edits: ${st.stderr.trim()}` : 'stashed local edits in the Projects copy (git stash list)');
  }
  const ff = git('pull', '-q', '--ff-only', 'origin', 'master');
  if (ff.status) { const m = `Projects copy NOT updated: ${ff.stderr.trim()}`; log(m); return m; }
  const dist = join(DATA, 'dist', 'mclite.html');
  const stale = force || !existsSync(dist) || Date.now() - statSync(dist).mtimeMs > REBUILD_AFTER_MS;
  const sha = git('rev-parse', '--short', 'HEAD').stdout.trim();
  if (!stale) { const m = `Projects copy at ${sha}, dist is under 20 min old (not rebuilt)`; log(m); return m; }
  // 5 Oct (#3163): Syncthing's resync left src/*.sync-conflict-*.js; build.mjs died on them for 15 h. Delete them before building.
  let swept = 0;
  const sweep = (d) => { try { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) sweep(f); else if (e.name.includes('.sync-conflict-')) { unlinkSync(f); swept++; } } } catch {} };
  sweep(join(DATA, 'src')); sweep(join(DATA, 'assets'));
  if (swept) log(`removed ${swept} Syncthing *.sync-conflict-* file(s) from src/ and assets/`);
  const bd = spawnSync('node', ['tools/suite.mjs', '--fast', '--to', 'build'], { cwd: DATA, encoding: 'utf8', maxBuffer: 1 << 26 });   // regenerates assets/ first (D-6)
  const m = `Projects copy at ${sha}, dist rebuilt: ${bd.status ? 'FAILED' : 'ok'}`; log(m); return m;
}
