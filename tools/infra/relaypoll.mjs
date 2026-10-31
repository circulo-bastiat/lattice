// tools/infra/relaypoll.mjs - #10420: relay.yml ran on the PC on every push to claude/**; the private repo has no hosted minutes, so the hosted brain tick POLLS instead.
// The last sha handed to relay.mjs for a branch is kept in the private ref refs/relay/<branch>; a branch whose head differs gets relay.mjs run over before..head, then the ref moves.
import { execFileSync } from 'node:child_process';
import { gh } from './gh.mjs';
import { gitExec } from './gitenv.mjs';
export const ZERO = '0'.repeat(40);
/** branches: [{name, sha}] (claude/** heads); done: {name: sha} already relayed. -> [{branch, before, after}] oldest-first not needed: branches are independent. */
export function plan(branches, done = {}) {
  return (branches || []).filter((b) => /^claude\//.test(b.name) && b.sha && done[b.name] !== b.sha)
    .map((b) => ({ branch: b.name, before: done[b.name] || ZERO, after: b.sha }));
}
const refOf = (n) => `relay/${n}`;
export async function main() {
  const heads = (await gh('GET', '/repos/{repo}/git/matching-refs/heads/claude/')) || [];
  const branches = heads.map((r) => ({ name: r.ref.replace('refs/heads/', ''), sha: r.object.sha }));
  const marks = (await gh('GET', '/repos/{repo}/git/matching-refs/relay/claude/')) || [];
  const done = Object.fromEntries(marks.map((r) => [r.ref.replace('refs/relay/', ''), r.object.sha]));
  for (const p of plan(branches, done)) {
    gitExec(['fetch', '-q', 'origin', `${p.branch}:refs/remotes/origin/${p.branch}`], { stdio: 'ignore' });
    if (p.before !== ZERO) { try { gitExec(['cat-file', '-e', p.before], { stdio: 'ignore' }); } catch { p.before = ZERO; } }
    try { execFileSync('node', ['tools/infra/relay.mjs', p.before, p.after, p.branch], { stdio: 'inherit' }); }
    catch (e) { console.log('relay failed', p.branch, e.status); continue; }   // the mark stays: the next poll retries
    const ref = refOf(p.branch);
    try { await gh('PATCH', `/repos/{repo}/git/refs/${ref}`, { sha: p.after, force: true }); }
    catch { await gh('POST', '/repos/{repo}/git/refs', { ref: `refs/${ref}`, sha: p.after }); }
  }
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
