// tools/infra/matrixlive.mjs - #9733: the proof matrix a full run builds reaches every clone. full.mjs writes it to branch `proof` (publishMatrixBranch);
// go.mjs refreshes .ledger/matrix-live.json from there (refreshMatrix: untracked, so a worker never commits it) and reads loadMatrix(): the newest of the
// live copy and the committed tools/mobproof/matrix.json, by builtAt. Status, the tester gate and GATE-AUTO (#8878) used the stale committed copy.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
export const BRANCH = 'proof';
export const livePath = (root) => join(root, '.ledger', 'matrix-live.json');
const rd = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const at = (m) => (m && Date.parse(m.builtAt || '')) || 0;
/** The newest matrix this clone has (live copy or committed file), or null. */
export function loadMatrix(root) {
  const a = rd(livePath(root)), b = rd(join(root, 'tools', 'mobproof', 'matrix.json'));
  return at(a) >= at(b) ? (a || b) : b;
}
/** Download the branch copy when it is newer than what this clone has. Never throws; returns loadMatrix(root). */
export async function refreshMatrix(gh, root) {
  try {
    const br = await gh('GET', `/repos/{repo}/branches/${BRANCH}`, null, { ok404: true }); if (!br) return loadMatrix(root);
    const t = Date.parse(br.commit && br.commit.commit && br.commit.commit.committer && br.commit.commit.committer.date || '') || 0;
    if (t && at(loadMatrix(root)) >= t - 10 * 60e3) return loadMatrix(root);
    const c = await gh('GET', `/repos/{repo}/contents/matrix.json?ref=${BRANCH}`);
    if (c && c.content) { const m = JSON.parse(Buffer.from(c.content, 'base64').toString('utf8')); if (m && m.full) { mkdirSync(join(root, '.ledger'), { recursive: true }); writeFileSync(livePath(root), JSON.stringify(m)); } }
  } catch { /* offline or no branch yet: the committed copy */ }
  return loadMatrix(root);
}
/** full.mjs: put a FULL run's matrix on branch `proof` (created from master the first time). */
export async function publishMatrixBranch(gh, mx) {
  if (!mx || !mx.full) return 'not a full matrix';
  if (!(await gh('GET', `/repos/{repo}/branches/${BRANCH}`, null, { ok404: true }))) { const m = await gh('GET', '/repos/{repo}/git/ref/heads/master'); await gh('POST', '/repos/{repo}/git/refs', { ref: `refs/heads/${BRANCH}`, sha: m.object.sha }); }
  const cur = await gh('GET', `/repos/{repo}/contents/matrix.json?ref=${BRANCH}`, null, { ok404: true });
  await gh('PUT', '/repos/{repo}/contents/matrix.json', { message: `proof matrix ${mx.sha || ''} ${mx.builtAt || ''} (full run, #9733)`, content: Buffer.from(JSON.stringify(mx)).toString('base64'), branch: BRANCH, ...(cur && cur.sha ? { sha: cur.sha } : {}) });
  return 'published';
}
