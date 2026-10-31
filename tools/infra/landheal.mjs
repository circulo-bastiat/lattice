// landheal.mjs (#9500, 22 Oct): the lander merges conflicts in the shared lists (tools/core.json ...) BY KEY (listmerge.mjs), builds and tests that merge, then asks GitHub to merge the PR head,
// and GitHub - which does its own textual merge - refuses with `405 Pull Request has merge conflicts` (#9480 and #9481 both bounced that way after passing every check).
// healBranch gives the PR branch the TESTED merge commit through the Git Data API (the locally tested tree, parents [PR head, master tip], a plain fast-forward ref update) so the
// merge that follows is trivial. Best effort: any failure returns null and the PR bounces exactly as before. Never forces, never touches master.
export async function healBranch({ gh, sh, n, pr, log = console.log, head = 'HEAD', master: masterSha = null }) {   // #9683: the batch path passes a member's own tested commit and GitHub's current master
  let pushed = false;
  try {
    const tree = String(sh('git', ['rev-parse', `${head}^{tree}`]).stdout || '').trim();
    const master = masterSha || String(sh('git', ['rev-parse', 'origin/master']).stdout || '').trim();
    if (!/^[0-9a-f]{40}$/.test(tree) || !/^[0-9a-f]{40}$/.test(master)) return null;
    // #9656: the tested tree holds a core.json blob merged BY KEY that exists only here; GitHub refuses a commit on a tree it does not have (422 Tree SHA does not exist).
    // Push the tested HEAD to a scratch ref first (uploads its blobs and tree), delete the ref after.
    // `origin` with the credentials actions/checkout stored: a second Authorization header is refused by GitHub ("Duplicate header", see land.mjs)
    const up = sh('git', ['push', '-q', '--force', 'origin', `${head}:refs/heads/heal/${n}`]);
    if (up && up.status) log(`#${n}: heal: pushing the tested tree failed (${String(up.stderr || '').trim().slice(0, 120)}); trying the API anyway`);
    else pushed = true;
    const c = await gh('POST', '/repos/{repo}/git/commits', { message: `merge master into ${pr.head.ref} (shared lists merged by key; tested by the lander, #9500)`, tree, parents: [pr.head.sha, master] });
    await gh('PATCH', `/repos/{repo}/git/refs/heads/${pr.head.ref}`, { sha: c.sha, force: false });
    log(`#${n}: gave the PR branch the tested master merge ${String(c.sha).slice(0, 8)}`);
    // #9683: GitHub recomputes `mergeable` lazily; a merge right after the ref moved was still refused "merge conflicts" (19:36Z #9653). Wait for it (bounded, inside the job).
    for (let i = 0; i < 12; i++) { const p = await gh('GET', `/repos/{repo}/pulls/${n}`).catch(() => null); if (!p || !('mergeable' in p) || (p.mergeable === true && p.head && p.head.sha === c.sha)) break; await new Promise((r) => setTimeout(r, 2500)); }
    return c.sha;
  } catch (e) { log(`#${n}: heal failed: ${String(e.message || e).slice(0, 160)}`); return null; }
  finally { if (pushed) await gh('DELETE', `/repos/{repo}/git/refs/heads/heal/${n}`).catch(() => {}); }
}
