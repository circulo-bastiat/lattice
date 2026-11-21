// lockstepstore.mjs (#9364 R2): lockstep pilot results travel on the `store` branch (lockstep/<lane>-<salt>.json), like goldens (golden.mjs).
//   publishLockstep: pushes every result of `dir` that is CREDITED (inputs equal today's files, same:true) and not already identical on store
//   syncLockstep:    copies store lockstep/ into `dir`, so a cold shard is warm for every lane whose inputs did not change (lockstepplan.mjs then credits it)
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gitExec } from './gitenv.mjs';
import { credited } from '../referee/lockstep/inputs.mjs';
export const resultsDir = (root) => join(root, 'tools', 'referee', 'lockstep', 'pilot-results');
export async function publishLockstep(dir, root, gh) {
  const out = { pushed: [], same: [], refused: [] };
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => /^[\w-]+-\d+\.json$/.test(x))) {
    const buf = readFileSync(join(dir, f)); let r; try { r = JSON.parse(String(buf)); } catch { out.refused.push(f); continue; }
    if (r.same !== true || !credited(r, join(root, 'tools'))) { out.refused.push(f); continue; }   // stale / doctored / diverging results never reach the store
    const b64 = buf.toString('base64'), cur = await gh('GET', `/repos/{repo}/contents/lockstep/${f}?ref=store`, null, { ok404: true });
    if (cur && String(cur.content || '').replace(/\n/g, '') === b64) { out.same.push(f); continue; }
    await gh('PUT', `/repos/{repo}/contents/lockstep/${f}`, { message: `lockstep result ${f} (#9364)`, content: b64, branch: 'store', ...(cur && cur.sha ? { sha: cur.sha } : {}) });
    out.pushed.push(f);
  }
  return out;
}
export function syncLockstep(cwd, dir) {
  const run = (...a) => gitExec(a, { cwd, maxBuffer: 1 << 28 });
  run('fetch', '-q', 'origin', '+refs/heads/store:refs/remotes/origin/store');
  const names = run('ls-tree', '--name-only', 'origin/store', 'lockstep/').toString().split('\n').filter((n) => /^lockstep\/[\w-]+-\d+\.json$/.test(n)).map((n) => n.slice(9));
  mkdirSync(dir, { recursive: true });
  const wrote = [];
  for (const n of names) { const data = run('show', `origin/store:lockstep/${n}`), f = join(dir, n); if (existsSync(f) && readFileSync(f).equals(data)) continue; writeFileSync(f, data); wrote.push(n); }
  return wrote;
}
