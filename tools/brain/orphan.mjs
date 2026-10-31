// tools/brain/orphan.mjs - #8977: a worker run that ends with no PR and no new code must not leave its claim HELD. isHeld() (infra/heldnow.mjs) calls
// any work/ branch whose tip is younger than STALE_H (3 h) held; a claim made off master carries the master commit's date, so 3 orphan claims
// (work/8625-8627, 20 Oct 03:45Z, mirror idle, no run in progress) held the whole lockstep pilot cap for hours. Same release as salvage.mjs:
// an empty `handoff: released` commit on top of the head, fast-forward only. A branch with an open PR, or already released, is left alone.
export async function releaseOrphan({ gh, branch }) {
  if (!branch) return { released: false, why: 'no branch' };
  const owner = (await gh('GET', '/repos/{repo}')).owner.login;
  const prs = await gh('GET', `/repos/{repo}/pulls?state=open&head=${owner}:${encodeURIComponent(branch)}`);
  if ((prs || []).length) return { released: false, why: 'open PR' };
  const ref = await gh('GET', `/repos/{repo}/git/ref/heads/${branch}`);
  const sha = ref && ref.object && ref.object.sha;
  if (!sha) return { released: false, why: 'no ref' };
  const head = await gh('GET', `/repos/{repo}/git/commits/${sha}`);
  if (/^handoff: released/.test(head.message || '')) return { released: false, why: 'already released' };
  const c = await gh('POST', '/repos/{repo}/git/commits', { message: 'handoff: released (the run ended with no PR and no new code; the next worker may claim it at once)', tree: head.tree.sha, parents: [sha] });
  await gh('PATCH', `/repos/{repo}/git/refs/heads/${branch}`, { sha: c.sha, force: false });
  return { released: true, sha: c.sha };
}
