// #8916: pure helpers for TEST_RUNNER=mirror - which land job runs, what the dispatch carries, how the verdict is read.
export const landMode = (v) => (v === 'mirror' || v === 'pc' ? v : 'hosted');
export const dispatchBody = ({ pr }) => {
  if (!Number.isInteger(pr) || pr < 1) throw new Error('bad pr');
  return { ref: 'master', inputs: { pr: String(pr) } };
};
/** the lattice run's conclusion -> the line posted to the PR and the bus (no account names, no paths) */
export const verdictLine = (pr, conclusion) =>
  conclusion === 'success' ? `LANDED #${pr}` : conclusion === 'failure' ? `BOUNCED #${pr}` : `UNKNOWN #${pr} (${conclusion || 'no run'})`;

// CLI: `landmirror.mjs run <pr>` dispatches the lattice land.yml, waits, posts the verdict to the PR and the bus.
if (process.argv[2] === 'run') {
  const { gh, busIssue } = await import('./gh.mjs');
  const pr = Number(process.argv[3]), repo = process.env.MIRROR_REPO, H = { Authorization: `Bearer ${process.env.MIRROR_TOKEN}`, Accept: 'application/vnd.github+json' };
  const api = (m, p, b) => fetch(`https://api.github.com/repos/${repo}${p}`, { method: m, headers: H, body: b && JSON.stringify(b) });
  const t0 = new Date(Date.now() - 5000).toISOString();
  const d = await api('POST', '/actions/workflows/land.yml/dispatches', dispatchBody({ pr }));
  if (!d.ok) { console.log('dispatch failed', d.status); process.exit(1); }
  let conclusion = null;
  for (let i = 0; i < 340 && !conclusion; i++) {
    await new Promise((r) => setTimeout(r, 30000));
    const j = await (await api('GET', `/actions/workflows/land.yml/runs?event=workflow_dispatch&created=>${t0}`)).json();
    const r = (j.workflow_runs || []).find((x) => x.status === 'completed'); if (r) conclusion = r.conclusion;
  }
  const line = verdictLine(pr, conclusion);
  console.log(line);
  await gh('POST', `/repos/{repo}/issues/${pr}/comments`, { body: line }).catch(() => {});
  await gh('POST', `/repos/{repo}/issues/${await busIssue()}/comments`, { body: `to: log\nfrom: lander\n\n${line}` }).catch(() => {});
  process.exit(conclusion === 'success' ? 0 : 1);
}
