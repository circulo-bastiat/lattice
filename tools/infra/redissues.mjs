// tools/infra/redissues.mjs - #1912: one issue per red full-suite check, opened and closed by the full suite itself
// (full.mjs), so no commander has to split the aggregate `master is red` issue by hand (2 Oct: #1660-#1683 were filed
// that way, and the next run's new reds had no issue at all).
// planRedIssues() is PURE (redissuecheck tests it); applyRedIssues() does the GitHub calls.
export const LABEL = 'red-check';
export const titleFor = (id) => `RED ${id}: full-suite check red on master`;
const named = (title, id) => new RegExp(`(^|[^a-z0-9_])${id.replace(/[^a-z0-9_]/gi, '')}([^a-z0-9_]|$)`, 'i').test(title);

/**
 * failed: red stage ids this run; skipped: stage ids that did not run; quarantine: {id: ...}
 * issues: every issue that could matter [{number, title, state:'open'|'closed', labels:[names]}]
 * -> [{op:'create', id} | {op:'reopen', id, number} | {op:'close', id, number}]
 */
export function planRedIssues({ failed, skipped, quarantine, issues }) {
  const q = quarantine || {}, skip = new Set(skipped || []), red = new Set(failed || []), acts = [];
  const open = issues.filter((i) => i.state === 'open'), closed = issues.filter((i) => i.state === 'closed');
  for (const id of red) {
    if (q[id] || id === 'suite-ledger-missing') continue;              // quarantined checks carry their own issue
    if (open.some((i) => named(i.title, id))) continue;                // already tracked (ours or filed by hand)
    const old = closed.filter((i) => i.title === titleFor(id)).sort((a, b) => b.number - a.number)[0];
    acts.push(old ? { op: 'reopen', id, number: old.number } : { op: 'create', id });
  }
  for (const i of open) {
    if (!(i.labels || []).includes(LABEL)) continue;                   // never close an issue a person filed
    const m = /^RED (\S+):/.exec(i.title); if (!m) continue;
    const id = m[1];
    if (!red.has(id) && !skip.has(id)) acts.push({ op: 'close', id, number: i.number });   // it RAN and passed
  }
  return acts;
}

export async function applyRedIssues(gh, ghAll, { failed, skipped, quarantine, sha, why, milestoneTitle = /^01\b/ }) {
  const all = [...await ghAll('/repos/{repo}/issues?state=open'), ...await ghAll(`/repos/{repo}/issues?state=closed&labels=${LABEL}`)]
    .filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, state: i.state, labels: i.labels.map((l) => l.name) }));
  const acts = planRedIssues({ failed, skipped, quarantine, issues: all });
  let ms = null;
  if (acts.some((a) => a.op === 'create')) ms = ((await ghAll('/repos/{repo}/milestones?state=open')).find((m) => milestoneTitle.test(m.title)) || {}).number || null;
  const body = (id) => `The full suite on master at ${sha} has \`${id}\` red. Filed by the full suite itself (#1912); it closes this when the check passes on master again.\n\nFix the CAUSE (a recent landing usually broke it, or the check went stale). Run it: \`node tools/suite.mjs --only ${id}\`.\n\n\`\`\`\n${why(id).slice(0, 6000)}\n\`\`\``;
  for (const a of acts) {
    try {
      if (a.op === 'create') await gh('POST', '/repos/{repo}/issues', { title: titleFor(a.id), body: body(a.id), labels: ['bug', 'severe', LABEL], ...(ms ? { milestone: ms } : {}) });
      else if (a.op === 'reopen') { await gh('PATCH', `/repos/{repo}/issues/${a.number}`, { state: 'open' }); await gh('POST', `/repos/{repo}/issues/${a.number}/comments`, { body: body(a.id) }); }
      else { await gh('POST', `/repos/{repo}/issues/${a.number}/comments`, { body: `Green on master at ${sha}.` }); await gh('PATCH', `/repos/{repo}/issues/${a.number}`, { state: 'closed' }); }
      console.log(`red-check ${a.op} ${a.id}${a.number ? ' #' + a.number : ''}`);
    } catch (e) { console.log(`red-check ${a.op} ${a.id} FAILED: ${e.message}`); }
  }
  return acts;
}
