// #7768: wires reviewer.mjs into the brain. plan() is pure (tested by reviewercheck); tick()/record() talk to GitHub.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { shouldSample, allowed, parseVerdict, actions, CAPS } from './reviewer.mjs';

/** prs = recently merged [{number, issue, labels, workerTurns}], seen = PR numbers already handled, times = past review starts (ms).
 *  Returns the PRs to review now (cap respected, usageStop honoured) and the updated sampling counter. */
export function plan({ prs, seen = [], times = [], now = Date.now(), usageStop = false, n = 0, caps = CAPS }) {
  const out = [], used = [...times];
  for (const pr of prs) {
    if (seen.includes(pr.number)) continue;
    n++;
    if (!shouldSample(pr, n, caps)) continue;
    if (!allowed(used, now, usageStop, caps)) break;
    used.push(now); out.push(pr);
  }
  return { out, n };
}

/** Apply a verdict: log line for go.mjs status, then comment / label / reopen / mail through the injected gh and say. */
export async function record({ issue, verdict, tokens = 0, evidence = '', gh, say, log, now = Date.now() }) {
  const v = parseVerdict(verdict);
  if (log) { mkdirSync(dirname(log), { recursive: true }); appendFileSync(log, JSON.stringify({ t: now, issue, verdict: v, tokens }) + '\n'); }
  for (const a of actions(v, issue)) {
    if (a.do === 'comment') await gh('POST', `/repos/{repo}/issues/${issue}/comments`, { body: `reviewer: **${v}** (${tokens} tokens)\n${evidence}` });
    else if (a.do === 'bus') await say('log', a.line);
    else if (a.do === 'reopen') { await gh('PATCH', `/repos/{repo}/issues/${issue}`, { state: 'open' }); await gh('POST', `/repos/{repo}/issues/${issue}/labels`, { labels: [a.label] }); }
    else if (a.do === 'mail') await say(a.to, `reviewer: #${issue} review-mismatch - reopened. ${evidence}`.slice(0, 600));
  }
  return v;
}

/** #9739: the reviewer's inputs, fetched by the brain before Claude starts. A haiku reviewer that fetched the issue, the diff and the check output itself
 *  ended error_max_turns (6 turns) in 6 of 19 runs on 22 Oct and recorded nothing. Pure: issue {title, body}, files [{filename, patch}], note = the lander's last comment. */
export function briefText({ issue = {}, pr = 0, files = [], note = '' }) {
  const diff = files.map((f) => `--- ${f.filename}\n${(f.patch || '(binary or too large)').slice(0, 2500)}`).join('\n').slice(0, 9000);
  return `## REVIEW INPUT (fetched by the brain; do not fetch anything else)\n### Issue #${issue.number || '?'}: ${issue.title || ''}\n${String(issue.body || '').slice(0, 4000)}\n` +
    `### PR #${pr || '?'} diff (${files.length} files)\n${diff || '(no diff found)'}\n### Check output (the lander's last comment on the PR)\n${String(note || '(none)').slice(0, 2000)}`;
}
/** Fetch the brief for `review #<issue> (PR <pr>)`. Never throws: an unreadable input is named in the brief, the reviewer then answers unclear. */
export async function reviewBrief(reason, gh) {
  const issue = Number((/#(\d+)/.exec(reason || '') || [])[1] || 0), pr = Number((/PR (\d+)/.exec(reason || '') || [])[1] || 0);
  const get = (p) => gh('GET', p).catch(() => null);
  const [iss, files, cm] = await Promise.all([issue ? get(`/repos/{repo}/issues/${issue}`) : null, pr ? get(`/repos/{repo}/pulls/${pr}/files?per_page=40`) : null, pr ? get(`/repos/{repo}/issues/${pr}/comments?per_page=100`) : null]);
  const note = (Array.isArray(cm) ? cm : []).filter((c) => /land|core|check|suite/i.test(c.body || '')).map((c) => c.body).pop() || '';
  return briefText({ issue: iss || { number: issue, title: '(issue unreadable)' }, pr, files: Array.isArray(files) ? files : [], note });
}

// CLI (the reviewer role runs this): node tools/brain/reviewtick.mjs record --issue N --verdict pass|mismatch|unclear --tokens T --evidence "3 lines"
if (process.argv[1] && process.argv[1].endsWith('reviewtick.mjs') && process.argv[2] === 'record') {
  const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : ''; };
  const { gh } = await import('../infra/gh.mjs'), { post } = await import('./home.mjs');
  const log = join(process.env.MCLITE_PROJECTS || process.cwd(), '_status', 'reviews.jsonl');
  console.log(await record({ issue: Number(arg('issue')), verdict: arg('verdict'), tokens: Number(arg('tokens') || 0), evidence: arg('evidence'), gh, say: post, log }));
}
