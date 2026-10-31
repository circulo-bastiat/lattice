// #10420: the DONE WHEN of the hosted lander as a number. Reads the mirror's land.yml runs (newest first) and says whether the last N completed runs all landed
// (conclusion success) and whether the bounce rate (failed / completed) is within the PC baseline, so retiring -land/-land2/usaged is a measured step, not a guess.
export const STREAK_NEEDED = 10, BOUNCE_MAX = 0.06;

/** pure: `runs` = [{status, conclusion}] newest first. Cancelled/skipped runs are neither a landing nor a bounce. */
export function landStreak(runs, { needed = STREAK_NEEDED, bounceMax = BOUNCE_MAX } = {}) {
  const done = (runs || []).filter((r) => r.status === 'completed' && (r.conclusion === 'success' || r.conclusion === 'failure'));
  let streak = 0; for (const r of done) { if (r.conclusion !== 'success') break; streak++; }
  const failed = done.filter((r) => r.conclusion === 'failure').length;
  const window = done.slice(0, Math.max(needed, 20)), wf = window.filter((r) => r.conclusion === 'failure').length;
  const bounce = window.length ? wf / window.length : 0;
  const ok = streak >= needed && bounce <= bounceMax;
  return { ok, streak, completed: done.length, failed, bounce: +bounce.toFixed(3), why: ok ? `${streak} consecutive hosted landings, bounce ${bounce.toFixed(3)} <= ${bounceMax}: -land/-land2/usaged may be retired` : streak < needed ? `only ${streak} of ${needed} consecutive hosted landings so far` : `bounce ${bounce.toFixed(3)} is above ${bounceMax}` };
}
export async function readLandRuns({ repo, token, f = fetch }) {
  const r = await f(`https://api.github.com/repos/${repo}/actions/workflows/land.yml/runs?per_page=30`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`land runs -> ${r.status}`);
  return ((await r.json()).workflow_runs || []).map((x) => ({ status: x.status, conclusion: x.conclusion }));
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const { MIRROR_REPO: repo, MIRROR_TOKEN: token } = process.env;
  if (!repo || !token) { console.log('landstreak: no MIRROR_REPO/MIRROR_TOKEN'); process.exit(2); }
  const s = landStreak(await readLandRuns({ repo, token })); console.log(JSON.stringify(s)); process.exit(s.ok ? 0 : 1);
}
