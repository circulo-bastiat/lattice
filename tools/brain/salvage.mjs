// tools/brain/salvage.mjs - #5052 (Dan, 11 Oct: "make a way for runs that got their turns cut off their work to be salvagable").
// A headless run that hits --max-turns (or the 100-minute kill) ends mid-work: no hand-off, no push, and its edits died with the
// runner checkout (gate.mjs's 10-minute autosave does not run on the brain VM). launch.mjs now, after such a run:
//  1. snapshots the run's working tree - committed or not - to wip/<branch> on GitHub (go.mjs start restores it for whoever
//     resumes the issue), and releases the claim with a `handoff: released` commit so the next worker can take it at once;
//  2. re-parks a cut-off commander/fixer task ONCE as a CONTINUE mail, so the next run finishes it instead of it being lost.
// Pure parts (cutOff, continuation) are exported for tools/salvagecheck.mjs.
import { gitSync } from '../infra/gitenv.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const CONT = 'CONTINUE (salvaged)';
// claude -p --output-format json reports subtype error_max_turns when the turn cap ends the run
export function cutOff(res, err) {
  return (!!res && res.subtype === 'error_max_turns') || /\[brain\] killed at the 100-minute limit/.test(String(err || ''));
}
// one continuation per task, never a loop; workers resume through the queue + wip/, testers simply run again
export function continuation(role, reason, maxTurns) {
  if (!['commander', 'fixer', 'chore'].includes(role)) return null;
  if (!reason || String(reason).startsWith(CONT)) return null;
  return `${CONT}: your previous ${role} run was cut off at its ${maxTurns}-turn cap before it finished. First read \`go.mjs inbox\` and the issues/PRs it already made, do NOT redo them, finish only the rest, and keep tool calls few. Original task: ${reason}`.slice(0, 4000);
}
export const WIP_EXCLUDE = [':!assets', ':!dist', ':!jars', ':!.mcdata', ':!.mcsnd', ':!.chromium', ':!.decomp', ':!src/19_data.gen.js'];
// the working tree (committed or not) as one commit on top of HEAD, without touching the run's index or files
export function wipCommit(root, ref) {
  const idx = join(root, '.git', 'mclite-salvage-index');
  const g = (args, env = {}) => gitSync(args, { cwd: root, encoding: 'utf8', env, timeout: 60e3 });
  try {
    const E = { GIT_INDEX_FILE: idx };
    g(['read-tree', 'HEAD'], E); g(['add', '-A', '--', '.', ...WIP_EXCLUDE], E);
    const tree = g(['write-tree'], E).stdout.trim();
    if (!tree) return null;
    const commit = g(['-c', 'user.name=MC-Lite salvage', '-c', 'user.email=salvage@mclite.invalid', 'commit-tree', tree, '-p', 'HEAD', '-m', `WIP salvaged from a cut-off run of ${ref} ${new Date().toISOString()}`]).stdout.trim();
    return commit ? { commit, tree } : null;
  } finally { try { unlinkSync(idx); } catch {} }
}
export function claimRef(root) {
  const cf = join(root, '.git', 'mclite-claim');
  const ref = existsSync(cf) ? readFileSync(cf, 'utf8').trim() : '';
  return /^work\/\d+-/.test(ref) ? ref : '';
}
// returns { ref, changed, pushed, released, why }
export async function salvage({ root, gh, env, turns, last }) {
  const ref = claimRef(root);
  if (!ref) return { ref: '', changed: false, why: 'no claimed work branch in this checkout' };
  const num = Number(ref.match(/^work\/(\d+)-/)[1]);
  const w = wipCommit(root, ref);
  if (!w) return { ref, changed: false, why: 'could not snapshot the tree' };
  // compare with what GitHub already has for the branch: nothing new = nothing to salvage
  let remote = null; try { remote = await gh('GET', `/repos/{repo}/git/ref/heads/${ref}`, null, { ok404: true }); } catch {}
  const rsha = remote && remote.object && remote.object.sha;
  let rtree = ''; if (rsha) { try { rtree = (await gh('GET', `/repos/{repo}/git/commits/${rsha}`)).tree.sha; } catch {} }
  if (rtree && rtree === w.tree) return { ref, changed: false, why: 'the branch on GitHub already holds this tree' };
  const p = spawnSync(process.execPath, [join(root, 'tools', 'go.mjs'), 'git-push', `${w.commit}:refs/heads/wip/${ref}`, '--force', '--dir', root],
    { cwd: root, encoding: 'utf8', timeout: 120e3, env: { ...process.env, ...env, MCLITE_GATE: 'off' } });
  const pushed = p.status === 0;
  if (!pushed) return { ref, changed: true, pushed, why: `wip push failed: ${String(p.stderr || p.stdout || '').trim().slice(-200)}` };
  // release the claim (fast-forward only) unless the branch already has a PR or is already released
  let released = false;
  try {
    const owner = (await gh('GET', '/repos/{repo}')).owner.login;
    const prs = await gh('GET', `/repos/{repo}/pulls?state=open&head=${owner}:${encodeURIComponent(ref)}`);
    if (rsha && !(prs || []).length) {
      const head = await gh('GET', `/repos/{repo}/git/commits/${rsha}`);
      if (!/^handoff: released/.test(head.message)) {
        const c = await gh('POST', '/repos/{repo}/git/commits', { message: `handoff: released (salvaged: the run hit its turn cap; its work is on wip/${ref})`, tree: head.tree.sha, parents: [rsha] });
        await gh('PATCH', `/repos/{repo}/git/refs/heads/${ref}`, { sha: c.sha, force: false });
      }
      released = true;
    }
  } catch {}
  await gh('POST', `/repos/{repo}/issues/${num}/comments`, { body: `**Salvaged by the brain** (#5052): this run was cut off (${turns ?? '?'} turns) before it handed off. Its working tree, committed or not and UNVERIFIED, is on \`wip/${ref}\`; the next \`go.mjs start\` on this issue restores it into the working tree (read \`git diff HEAD\` first).${released ? ' The claim is released.' : ''}\n\nLast words: ${String(last || '').replace(/\s+/g, ' ').slice(0, 500)}` }).catch(() => {});
  return { ref, changed: true, pushed, released, why: '' };
}
