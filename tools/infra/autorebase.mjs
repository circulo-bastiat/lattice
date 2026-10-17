// autorebase.mjs - #4589: a PR the lander bounced for a merge conflict re-queues itself (decision: docs/decisions/4589-auto-rebase.md).
// decide() is pure; sweep() reads GitHub and acts. The brain's 15-minute health pass calls sweep().
//   requeue  GitHub says it merges clean now -> label `land` again (the lander re-tests it on master: no session, no model)
//   close    its issue is closed and nothing touched it for 7 days -> closed with a comment, not rebased
//   block    the third conflict bounce (the original + 2 worker attempts) -> issue `blocked`, fixer mailed
//   none     a true conflict: the queue hands the branch to a worker first (go.mjs queue(): needs-rebase leads)
export const STALE_MS = 7 * 86400e3, MAX_BOUNCES = 3;
const lab = (o, l) => (o.labels || []).some((x) => (x.name || x) === l);
const CONFLICT = /^\*\*Lander:\*\* conflicts with master/;
const UNBLOCK = /^\*\*Commander/;

/** #8198: a bounce counts 0 when a family sibling merged between the comment before it (the worker's rebase) and the bounce itself. */
export function siblingCaused(comments, i, siblingMerges) {
  const t = Date.parse(comments[i].created_at || '') || 0, prev = i ? Date.parse(comments[i - 1].created_at || '') || 0 : 0;
  return siblingMerges.some((m) => m > prev && m <= t);
}

/** #8198: families = modified (not added, not stages.d) files shared by >= 3 open PRs. prs = [{number, created_at, files:[{filename,status}]}].
 *  Per family at most FAMILY_ACTIVE members are active (oldest first); returns { active:Set, queued: Map(number -> [active numbers it waits behind]) }. */
export const FAMILY_MIN = 3, FAMILY_ACTIVE = 3;
export function families(prs) {
  const by = new Map();
  for (const p of prs) for (const f of p.files || []) {
    if (f.status !== 'modified' || /^tools\/stages\.d\//.test(f.filename)) continue;
    if (!by.has(f.filename)) by.set(f.filename, []);
    by.get(f.filename).push(p);
  }
  const queued = new Map();
  for (const [, m] of by) {
    if (m.length < FAMILY_MIN) continue;
    m.sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || a.number - b.number);
    const act = m.slice(0, FAMILY_ACTIVE).map((x) => x.number);
    for (const p of m.slice(FAMILY_ACTIVE)) queued.set(p.number, [...new Set([...(queued.get(p.number) || []), ...act])]);
  }
  const active = new Set(prs.map((p) => p.number).filter((n) => !queued.has(n)));
  return { active, queued };
}

/** pr = pulls/N, issue = its issue, comments = the PR's comments (oldest first). */
export function decide({ pr, issue, comments, issueComments = [], now, siblingMerges = [] }) {
  if (lab(pr, 'land')) return 'none';                                          // already queued
  const lander = comments.filter((c) => /^\*\*Lander:\*\*/.test(c.body || ''));
  if (!lander.length || !CONFLICT.test(lander[lander.length - 1].body)) return 'none';   // a red bounce is a worker's job, not a conflict
  if (issue.state === 'closed' && now - Date.parse(pr.updated_at) > STALE_MS) return 'close';
  const reset = comments.reduce((n, c, i) => (UNBLOCK.test(c.body || '') ? i : n), -1);                  // #7478: a commander's unblock note restarts the count
  const since = Math.max(0, ...[...comments, ...issueComments].filter((c) => UNBLOCK.test(c.body || '')).map((c) => Date.parse(c.created_at || '') || 0));   // #7514: the unblock note is usually on the ISSUE, not the PR
  if (comments.filter((c, i) => i > reset && (Date.parse(c.created_at || '') || 0) >= since && /^\*\*Lander:\*\*/.test(c.body || '') && CONFLICT.test(c.body) && !siblingCaused(comments, i, siblingMerges)).length >= MAX_BOUNCES) return lab(issue, 'blocked') ? 'none' : 'block';
  return pr.mergeable === true ? 'requeue' : 'none';                          // null = GitHub has not computed it yet: next pass
}

/** One pass. Returns the lines it acted on; per-PR failures are returned as errors (the caller mails them), never retried in a loop. */
export async function sweep({ gh, ghAll, post, now = Date.now() }) {
  const flagged = new Set((await ghAll('/repos/{repo}/issues?state=open&labels=needs-rebase')).filter((i) => !i.pull_request).map((i) => i.number));
  const acts = [], errors = [];
  try {   // #8198: park queued family members, release the next when an active one has merged/closed (the open list shrinks)
    const open = await ghAll('/repos/{repo}/pulls?state=open'), cand = [];
    for (const p of open) {
      if (!(lab(p, 'land') || lab(p, 'needs-rebase') || lab(p, 'queued-family'))) continue;
      cand.push({ number: p.number, created_at: p.created_at, files: await ghAll(`/repos/{repo}/pulls/${p.number}/files`), p });
    }
    const { queued } = families(cand);
    for (const c of cand) {
      const n = Number((c.p.head.ref.match(/^work\/(\d+)-/) || [])[1]); if (!n) continue;
      const iss = await gh('GET', `/repos/{repo}/issues/${n}`), parked = lab(c.p, 'queued-family');
      const cm = await ghAll(`/repos/{repo}/issues/${n}/comments`);
      if (cm.some((x) => UNBLOCK.test(x.body || '')) && !queued.has(c.number)) continue;
      if (queued.has(c.number) && !parked && !cm.some((x) => UNBLOCK.test(x.body || '') && (Date.parse(x.created_at) || 0) > Date.parse(c.p.updated_at || 0))) {
        await gh('POST', `/repos/{repo}/issues/${n}/labels`, { labels: ['blocked'] });
        await gh('POST', `/repos/{repo}/issues/${c.number}/labels`, { labels: ['queued-family'] });
        await gh('POST', `/repos/{repo}/issues/${c.number}/comments`, { body: `**Auto-rebase (#8198):** queued behind ${queued.get(c.number).map((x) => '#' + x).join(' ')} (same hot file); no bounces are spent meanwhile.` });
        acts.push(`#${c.number} queued`);
      } else if (parked && !queued.has(c.number)) {
        await gh('DELETE', `/repos/{repo}/issues/${n}/labels/blocked`).catch(() => {});
        await gh('DELETE', `/repos/{repo}/issues/${c.number}/labels/queued-family`).catch(() => {});
        await gh('POST', `/repos/{repo}/issues/${c.number}/comments`, { body: '**Auto-rebase (#8198):** a family sibling is done; released (`blocked` removed).' });
        acts.push(`#${c.number} released`);
      }
    }
  } catch (e) { errors.push(`family: ${String(e.message).slice(0, 160)}`); }
  for (const p of await ghAll('/repos/{repo}/pulls?state=open')) {
    const issueNo = Number((p.head.ref.match(/^work\/(\d+)-/) || [])[1]);
    if (lab(p, 'land') || !(lab(p, 'needs-rebase') || flagged.has(issueNo))) continue;
    try {
      const pr = await gh('GET', `/repos/{repo}/pulls/${p.number}`), issue = issueNo ? await gh('GET', `/repos/{repo}/issues/${issueNo}`) : { state: 'open', labels: [] };
      const d = decide({ pr, issue, comments: await ghAll(`/repos/{repo}/issues/${p.number}/comments`), issueComments: issueNo ? await ghAll(`/repos/{repo}/issues/${issueNo}/comments`) : [], now });
      if (d === 'none') continue;
      const say = (t) => gh('POST', `/repos/{repo}/issues/${p.number}/comments`, { body: `**Auto-rebase (#4589):** ${t}` });
      if (d === 'requeue') {
        await say('GitHub reports this merges cleanly onto master now; re-labelled `land` so the lander re-tests it.');
        await gh('POST', `/repos/{repo}/issues/${p.number}/labels`, { labels: ['land'] });
        if (issueNo) await gh('DELETE', `/repos/{repo}/issues/${issueNo}/labels/needs-rebase`).catch(() => {});
      } else if (d === 'close') {
        await say(`issue #${issueNo} is closed and nothing touched this PR for 7 days; closed instead of rebased.`);
        await gh('PATCH', `/repos/{repo}/pulls/${p.number}`, { state: 'closed' });
      } else {
        await gh('POST', `/repos/{repo}/issues/${issueNo}/labels`, { labels: ['blocked'] });
        await say(`bounced for a merge conflict ${MAX_BOUNCES} times (the original and 2 worker attempts); issue #${issueNo} labelled \`blocked\`.`);
        await post('fixer', `PR #${p.number} (issue #${issueNo}) conflicted with master ${MAX_BOUNCES} times and two rebase attempts failed; it is labelled blocked. Rebase it by hand or close it.`);
      }
      acts.push(`#${p.number} ${d}`);
    } catch (e) { errors.push(`#${p.number}: ${String(e.message).slice(0, 160)}`); }
  }
  return { acts, errors };
}
