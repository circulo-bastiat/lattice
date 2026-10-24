// farmship.mjs (22 Oct): the first pilot-farm run (39717561616) ran 38 min, produced 200 real-server results, pushed branch farm/<run> and then died: GITHUB_TOKEN
// gets `/pulls 403` in this repo, so the workflow could not open the PR and the results sat on a branch nobody merged. The brain tick holds the PAT, so IT opens
// the PR for every farm/* branch that has commits master lacks and no PR yet (open or closed: a closed one was closed on purpose), labels it `land`.
export const FARM_PREFIX = 'farm/';
export const farmBranches = (branches) => (branches || []).map((b) => (b && b.name) || '').filter((n) => n.startsWith(FARM_PREFIX));
export async function shipFarm({ gh }) {
  const owner = (await gh('GET', '/repos/{repo}')).owner.login, opened = [], skipped = [];
  const brs = await gh('GET', '/repos/{repo}/branches?per_page=100');
  for (const name of farmBranches(brs)) {
    const prs = await gh('GET', `/repos/{repo}/pulls?state=all&head=${owner}:${encodeURIComponent(name)}`);
    // #9716: an OPEN farm PR the lander bounced for a conflict has no issue, so no worker or rebase sweep ever re-queues it: re-label it, at most every 6 h
    const op = (prs || []).find((p) => p.state === 'open' && !(p.labels || []).some((l) => l.name === 'land'));
    if (op) {
      const cm = (await gh('GET', `/repos/{repo}/issues/${op.number}/comments?per_page=100`)) || [], last = (re) => Math.max(0, ...cm.filter((c) => re.test(c.body || '')).map((c) => Date.parse(c.created_at) || 0));
      if (last(/^\*\*Lander:\*\* conflicts with master/) && Date.now() - last(/^\*\*Farmship:\*\* re-queued/) > 6 * 3600e3) {
        await gh('POST', `/repos/{repo}/issues/${op.number}/comments`, { body: '**Farmship:** re-queued: a conflict on result files is finished by keeping master\'s result (#9716).' });
        await gh('POST', `/repos/{repo}/issues/${op.number}/labels`, { labels: ['land'] }); opened.push(`#${op.number} ${name} (re-queued)`); continue;
      }
    }
    if ((prs || []).length) { skipped.push(`${name}: has a PR`); continue; }
    const cmp = await gh('GET', `/repos/{repo}/compare/master...${name}`);
    if (!cmp || !cmp.ahead_by) { skipped.push(`${name}: nothing master lacks`); continue; }
    const n = (cmp.files || []).length;
    const pr = await gh('POST', '/repos/{repo}/pulls', { title: `pilot farm: ${n} lockstep result file(s) (${name.slice(FARM_PREFIX.length)})`, head: name, base: 'master', body: 'Pilot-farm results (tools/infra/pilotfarm.mjs). Opened by the brain tick because the workflow token cannot open PRs (farmship.mjs). Results only.' });
    await gh('POST', `/repos/{repo}/issues/${pr.number}/labels`, { labels: ['land'] });
    opened.push(`#${pr.number} ${name}`);
  }
  return { opened, skipped };
}
