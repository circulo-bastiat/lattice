// #9513 (22 Oct 2026): the issue a PR's branch names (`work/<n>-slug`). A hand-made branch carried the number of the OPEN
// message bus (work/9482-...), the lander's afterMerge() closed that issue on landing, and the whole system lost its mail
// for 4 hours (no open `bus` issue: inbox fails, the brain cannot route, the fill sat at 0 workers). A `bus`-labelled
// issue is never a work issue: the lander must not bounce, refuse or close it on a PR's behalf.
export const branchIssueNumber = (ref) => (String(ref || '').match(/^work\/(\d+)-/) || [])[1];

/** getIssue(n) -> the issue object (labels: [{name}]). A failed lookup keeps the old behaviour (the number is returned). */
export async function workIssue(ref, getIssue) {
  const n = branchIssueNumber(ref);
  if (!n) return undefined;
  const i = await Promise.resolve(getIssue(n)).catch(() => null);
  if (i && (i.labels || []).some((l) => (l && l.name !== undefined ? l.name : l) === 'bus')) return undefined;
  return n;
}
