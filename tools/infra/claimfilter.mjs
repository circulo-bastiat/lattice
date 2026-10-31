// tools/infra/claimfilter.mjs - #8981: the pure part of go.mjs queue() and freeQueue(): which open issues a worker may claim.
// go.mjs calls these; claimfiltercheck RUNS them on fixture issues (a grep of go.mjs passed while 9 rollouts were unclaimable for 28 h).
import { isHeld } from './heldnow.mjs';
import { stubBody } from './briefguard.mjs';
import { splittable } from './phaselane.mjs';
const lab = (i, l) => i.labels.some((x) => x.name === l);
export const deps = (i) => [...((i.body || '').matchAll(/^Depends on:\s*(.+)$/gim))].flatMap((m) => [...m[1].matchAll(/#(\d+)/g)].map((x) => Number(x[1])));
/** #9889: the brain's burn verdict labels `blocked` + `burn-blocked`. Once the issue has a bounced PR (`needs-rebase`) that block is stale (finished work, #4589). autorebase's own `blocked` has no `burn-blocked`, so it stays. */
export const staleBurnBlock = (i) => lab(i, 'burn-blocked') && lab(i, 'needs-rebase');
/** labels to remove when a PR is opened or bounced for this issue's label set (names). */
export const burnLabelsToClear = (names) => (names.includes('burn-blocked') || names.includes('handoff-blocked') ? ['blocked', ...['burn-blocked', 'handoff-blocked'].filter((l) => names.includes(l))] : []);
/** #10601: the 3-unfinished-hand-off block (#4335) also carries `handoff-blocked` and EXPIRES: quiet for HANDOFF_BLOCK_HOURS, the issue is claimable again (a hold must arm its own wake; big issues are delivered a slice at a time and a commander had to unblock them by hand, the queue sat at 1 claimable). Autorebase's and the brain's blocks have no such label and stay. */
export const HANDOFF_BLOCK_HOURS = 12;
export const staleHandoffBlock = (i, now = Date.now()) => lab(i, 'handoff-blocked') && now - (Date.parse(i.updated_at || '') || now) > HANDOFF_BLOCK_HOURS * 3600e3;
/** issues = every open item {number, body, labels:[{name}], pull_request?}. vm: a brain worker (no Java / GPU). opus: the Opus pool. */
export function claimFilter(issues, { vm = false, opus = false, now = Date.now(), briefMin = 0, lane = false } = {}) {
  // #10712: a stub body is no brief (briefMin > 0 turns the rule on; go.mjs passes 200); a bounced PR (needs-rebase) is exempt
  const list = issues.filter((i) => !i.pull_request && !lab(i, 'needs-brief') && !(briefMin > 0 && !lab(i, 'needs-rebase') && !(lane && lab(i, 'tracking')) && stubBody(i.body, briefMin)) && (!lab(i, 'blocked') || staleBurnBlock(i) || staleHandoffBlock(i, now)) && !lab(i, 'ask-dan') && (!lab(i, 'tracking') || (lane && splittable(i, issues))) && !lab(i, 'env-fault') && !lab(i, 'bus') && lab(i, 'opus') === opus
    && !(vm && (lab(i, 'needs-pc') || lab(i, 'pc-gpu') || lab(i, 'needs-java'))));
  // #8968: a `tracking` umbrella never closes, so naming one must not starve its units (9 lockstep units, 28 h)
  const openNums = new Set(issues.filter((i) => !i.pull_request && !lab(i, 'tracking')).map((i) => i.number));
  return list.filter((i) => !deps(i).some((d) => openNums.has(d)));
}
/** is the issue's work/ branch taken? ref 'work/N-slug'; head {age (h), message}; inReview as in go.mjs queue(). */
export function branchTaken(ref, head, inReview, staleH) {
  if (inReview.has(ref)) return true;
  return !!head && isHeld({ age: head.age, message: head.message, bouncedFree: !!(inReview.rebase && inReview.rebase.has(ref)) && !/^takeover:/.test(head.message) }, staleH);
}
