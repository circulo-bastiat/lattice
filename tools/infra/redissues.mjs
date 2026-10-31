// tools/infra/redissues.mjs - #1912: one issue per red full-suite check, opened and closed by the full suite itself
// (full.mjs), so no commander has to split the aggregate `master is red` issue by hand (2 Oct: #1660-#1683 were filed
// that way, and the next run's new reds had no issue at all).
// planRedIssues() is PURE (redissuecheck tests it); applyRedIssues() does the GitHub calls.
export const LABEL = 'red-check';
export const titleFor = (id) => `RED ${id}: full-suite check red on master`;
// #9647: the id is ESCAPED, never stripped (stripping the '-' made every lockstep-* red invisible, so each full run filed a duplicate), and '-' is part of a name (lockstep-skeleton is not lockstep-skeleton-server)
export const named = (title, id) => new RegExp(`(^|[^a-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9_-]|$)`, 'i').test(title);

/**
 * failed: red stage ids this run; skipped: stage ids that did not run; quarantine: {id: ...}
 * issues: every issue that could matter [{number, title, state:'open'|'closed', labels:[names]}]
 * -> [{op:'create', id} | {op:'reopen', id, number} | {op:'close', id, number}]
 */
export function planRedIssues({ failed, skipped, quarantine, issues }, match = named) {
  const q = quarantine || {}, skip = new Set(skipped || []), red = new Set(failed || []), acts = [];
  const open = issues.filter((i) => i.state === 'open'), closed = issues.filter((i) => i.state === 'closed');
  for (const id of red) {
    if (q[id] || id === 'suite-ledger-missing') continue;              // quarantined checks carry their own issue
    if (open.some((i) => match(i.title, id))) continue;                // already tracked (ours or filed by hand)
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

// 21 Oct: stages that only TIMED OUT in the full suite are inconclusive, not red (no per-check RED issue is opened, an open one is left alone).
// So that a stage that always hangs cannot hide, ONE tracking issue lists them every run and closes itself when none timed out.
export const TIMEOUT_TITLE = 'FULL-SUITE TIMEOUTS: stages that only timed out (inconclusive, not red)';
/** issues: [{number, title, state}] -> {op:'create'|'update'|'close'|null, number?} */
export function planTimeoutIssue({ ids, issues }) {
  const mine = (issues || []).filter((i) => i.title === TIMEOUT_TITLE && i.state === 'open').sort((a, b) => a.number - b.number)[0];
  if (ids && ids.length) return mine ? { op: 'update', number: mine.number } : { op: 'create' };
  return mine ? { op: 'close', number: mine.number } : { op: null };
}
export async function applyTimeoutIssue(gh, ghAll, { ids, sha }) {
  const all = (await ghAll('/repos/{repo}/issues?state=open&labels=full-timeouts')).filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, state: i.state }));
  const a = planTimeoutIssue({ ids, issues: all });
  const body = `At master ${sha} the full suite had ${(ids || []).length} stage(s) that ONLY timed out (no failed assertion). They are inconclusive: no RED issue is opened for them. Rewritten by the full suite every run; it closes itself when none times out.\n\n${(ids || []).map((x) => '- `' + x + '`').join('\n')}\n\nThe cause for lockstep stages is a cold pilot cache on the hosted shards (480 lockstep stages = 9.5 h cold). The fix is to credit a lockstep result by its input hash instead of re-running it; if a stage here has timed out for days it may really hang: run \`node tools/suite.mjs --only <id>\`.`;
  try {
    if (a.op === 'create') await gh('POST', '/repos/{repo}/issues', { title: TIMEOUT_TITLE, body, labels: ['infra', 'full-timeouts'] });
    else if (a.op === 'update') await gh('PATCH', `/repos/{repo}/issues/${a.number}`, { body });
    else if (a.op === 'close') { await gh('POST', `/repos/{repo}/issues/${a.number}/comments`, { body: `No stage timed out at ${sha}.` }); await gh('PATCH', `/repos/{repo}/issues/${a.number}`, { state: 'closed' }); }
    if (a.op) console.log(`timeout-tracking ${a.op}${a.number ? ' #' + a.number : ''} (${(ids || []).length} stage(s))`);
  } catch (e) { console.log(`timeout-tracking ${a.op} FAILED: ${e.message}`); }
  return a;
}
