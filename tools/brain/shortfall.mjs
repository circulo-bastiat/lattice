// shortfall.mjs - 21 Oct (Dan: "they already are insubordinating, find the deeper reason for the laziness").
// MEASURED on the bus (24 h, 76 worker runs): median 5 turns, 48 runs <= 5 turns, only 1 over 25, though the cap is 60. The cap never
// binds; the prompt does ("hand off if you cannot make real progress in about 20 turns", "land by about 30 tool calls", "if a part it needs is
// not done do NOT build it: file a dependency and hand off"), and the brain scores a no-code hand-off / an already-fixed close as a good run
// while an attempt that does not land is a burn (4 an hour pauses the fill, 2 in a row blocks the issue). Stopping early is the cheapest move.
// A rule in a prompt is a request (Dan: never leave a check to a session's discipline), so the brain enforces it: a worker run that ends
// EARLY with nothing produced is resumed ONCE in the same session with the budget it still has and the list of endings that are allowed.
export const FLOOR = 30;   // Dan, 21 Oct: a worker session is ~30 turns of work (not big sessions); ending below that with nothing produced is a shortfall

/** Pure: should this finished worker run be resumed? res = claude's json result. */
export function wantsResume({ role, issueNo, limit, cut, code, res, resumed, floor = FLOOR }) {
  if (role !== 'worker' || !issueNo || limit || cut || resumed) return false;
  if (code !== 0 || !res || !res.session_id) return false;
  return (Number(res.num_turns) || 0) < floor;
}

/** The same progress rule the burn accounting uses: a PR, real commits on the branch this run, the issue closed, or a `Depends on: #M` with M still open. */
export async function ranProduced({ gh, branch, issueNo, since, dependsOn }) {
  try {
    const owner = (await gh('GET', '/repos/{repo}')).owner.login;
    const prs = await gh('GET', `/repos/{repo}/pulls?state=open&head=${owner}:${encodeURIComponent(branch)}`);
    const cm = branch ? await gh('GET', `/repos/{repo}/commits?sha=${encodeURIComponent(branch)}&since=${new Date(since).toISOString()}&per_page=50`) : [];
    const real = (cm || []).filter((c) => !/^(handoff: released|takeover:|Merge )/.test(c.commit.message) && (c.parents || []).length < 2);
    if ((prs || []).length > 0 || real.length > 0) return true;
    const is = await gh('GET', `/repos/{repo}/issues/${issueNo}`);
    if (is.state === 'closed') return true;
    for (const m of dependsOn(is.body)) { const d = await gh('GET', `/repos/{repo}/issues/${m}`).catch(() => null); if (d && d.state === 'open') return true; }
    return false;
  } catch { return true; }   // cannot tell: never resume on a guess
}

export const resumeMessage = ({ turns, max, issueNo }) =>
  `RESUMED BY THE BRAIN. Your run ended after ${turns} of ${max} turns with no PR, no code on the branch and issue #${issueNo} still open. ` +
  `${Math.max(0, max - turns)} turns are still yours and almost all of the budget is unspent. A thing this issue "needs first" (a scene, a lane, a helper, a data file, a check) is part of THIS issue: build it as the first tested part, do not file it away. ` +
  `The ONLY endings accepted: (1) \`go.mjs done --finished\` with the issue complete; (2) \`go.mjs done --finished --part --owed "<what is left>"\` with TESTED code that lands; (3) \`go.mjs done --already-fixed\` citing the landing commit and the check output you ran; ` +
  `(4) a REAL external failure (a red master, a broken tool, the lander) reported with \`go.mjs say --to fixer "<exact error>"\`. ` +
  `"It needs X first", "it is big", "I could not run the browser stage" are not endings: do X, cut the work into a tested part, and land the part (the lander runs browser stages and the full suite runs the rest). Continue now.`;

/** The args for the resume call: the first run's args with the prompt replaced, --resume added and the turn cap reduced to what is left. */
export function resumeArgs(args, sessionId, message, used, max) {
  const rest = args.slice(2); const i = rest.indexOf('--max-turns');
  if (i >= 0) rest[i + 1] = String(Math.max(10, max - used));
  return ['-p', message, '--resume', sessionId, ...rest];
}

/** Add the first run's turns and cost to the resumed run's result so the bus line shows the whole run. */
export function mergeRun(first, second) {
  if (!second || !Object.keys(second).length) return first;
  return { ...second, num_turns: (Number(first.num_turns) || 0) + (Number(second.num_turns) || 0), total_cost_usd: (first.total_cost_usd || 0) + (second.total_cost_usd || 0),
    duration_ms: (first.duration_ms || 0) + (second.duration_ms || 0) };
}
