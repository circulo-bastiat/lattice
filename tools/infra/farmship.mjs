// farmship.mjs (22 Oct): the first pilot-farm run (39717561616) ran 38 min, produced 200 real-server results, pushed branch farm/<run> and then died: GITHUB_TOKEN
// gets `/pulls 403` in this repo, so the workflow could not open the PR and the results sat on a branch nobody merged. The brain tick holds the PAT, so IT opens
// the PR for every farm/* branch that has commits master lacks and no PR yet (open or closed: a closed one was closed on purpose), labels it `land`.
export const FARM_PREFIX = 'farm/';
export const farmBranches = (branches) => (branches || []).map((b) => (b && b.name) || '').filter((n) => n.startsWith(FARM_PREFIX));
export const RESULTS_DIR = 'tools/referee/lockstep/pilot-results/';
/** #10101: the result files of branch `name` that master does not have: [{ path, sha }].
 *  #10530: read from the git TREES of the results dir on both sides, never from compare: compare returns at most 300 files in total (its pages are commits),
 *  and a farm batch that also deleted ~5000 dead files showed 300 removed entries and no results, so 262+60 results were closed as "already in master". */
export async function resultTree({ gh, ref }) {
  const t = await gh('GET', `/repos/{repo}/git/trees/${ref}:${RESULTS_DIR.slice(0, -1)}?recursive=1`).catch(() => null);
  return ((t && t.tree) || []).filter((e) => e && e.type === 'blob' && typeof e.path === 'string' && e.path.endsWith('.json') && e.sha).map((e) => ({ path: RESULTS_DIR + e.path, sha: e.sha }));
}
export async function missingFromMaster({ gh, name }) {
  const have = new Set((await resultTree({ gh, ref: 'master' })).map((e) => e.path));
  return (await resultTree({ gh, ref: name })).filter((e) => !have.has(e.path));
}
export async function shipFarm({ gh }) {
  const owner = (await gh('GET', '/repos/{repo}')).owner.login, opened = [], skipped = [], closed = [];
  const brs = await gh('GET', '/repos/{repo}/branches?per_page=100');
  for (const name of farmBranches(brs)) {
    const prs = await gh('GET', `/repos/{repo}/pulls?state=all&head=${owner}:${encodeURIComponent(name)}`);
    // #10101: an OPEN farm PR nobody labelled `land` is never left to conflict forever. Files master already has: the PR is closed. Files master lacks:
    // a fresh branch from the CURRENT master carrying only those (blobs by sha, no merge, so no conflict is possible) replaces it and gets `land`.
    const op = (prs || []).find((p) => p.state === 'open' && !(p.labels || []).some((l) => l.name === 'land'));
    if (op) {
      const miss = await missingFromMaster({ gh, name });
      if (!miss.length) {
        await gh('POST', `/repos/{repo}/issues/${op.number}/comments`, { body: '**Farmship:** closed: every result file of this branch is already in master (or the branch adds none). Nothing to land (#10101).' });
        await gh('PATCH', `/repos/{repo}/pulls/${op.number}`, { state: 'closed' }); closed.push(`#${op.number} ${name} (all in master)`); continue;
      }
      const sha = (await gh('GET', '/repos/{repo}/git/ref/heads/master')).object.sha;
      const tree = await gh('POST', '/repos/{repo}/git/trees', { base_tree: sha, tree: miss.map((x) => ({ path: x.path, mode: '100644', type: 'blob', sha: x.sha })) });
      const commit = await gh('POST', '/repos/{repo}/git/commits', { message: `pilot farm: ${miss.length} lockstep result file(s) (${name} rebuilt on master ${sha.slice(0, 9)})`, tree: tree.sha, parents: [sha] });
      const nb = `${name}-m${sha.slice(0, 7)}`;
      await gh('POST', '/repos/{repo}/git/refs', { ref: `refs/heads/${nb}`, sha: commit.sha });
      const pr = await gh('POST', '/repos/{repo}/pulls', { title: `pilot farm: ${miss.length} lockstep result file(s) (${nb.slice(FARM_PREFIX.length)})`, head: nb, base: 'master', body: `Pilot-farm results only, rebuilt from #${op.number} on the current master by farmship (#10101): just the files master lacks.` });
      await gh('POST', `/repos/{repo}/issues/${pr.number}/labels`, { labels: ['land'] });
      await gh('POST', `/repos/{repo}/issues/${op.number}/comments`, { body: `**Farmship:** superseded by #${pr.number} (the ${miss.length} files master lacks, on a fresh branch from master). Closing (#10101).` });
      await gh('PATCH', `/repos/{repo}/pulls/${op.number}`, { state: 'closed' }); opened.push(`#${pr.number} ${nb} (rebuilt from #${op.number})`); continue;
    }
    if ((prs || []).length) { skipped.push(`${name}: has a PR`); continue; }
    const cmp = await gh('GET', `/repos/{repo}/compare/master...${name}`);
    if (!cmp || !cmp.ahead_by) { skipped.push(`${name}: nothing master lacks`); continue; }
    const n = (cmp.files || []).length;
    const pr = await gh('POST', '/repos/{repo}/pulls', { title: `pilot farm: ${n} lockstep result file(s) (${name.slice(FARM_PREFIX.length)})`, head: name, base: 'master', body: 'Pilot-farm results (tools/infra/pilotfarm.mjs). Opened by the brain tick because the workflow token cannot open PRs (farmship.mjs). Results only.' });
    await gh('POST', `/repos/{repo}/issues/${pr.number}/labels`, { labels: ['land'] });
    opened.push(`#${pr.number} ${name}`);
  }
  return { opened, skipped, closed };
}
