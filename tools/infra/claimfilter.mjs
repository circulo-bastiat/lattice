// tools/infra/claimfilter.mjs - #8981: the pure part of go.mjs queue() and freeQueue(): which open issues a worker may claim.
// go.mjs calls these; claimfiltercheck RUNS them on fixture issues (a grep of go.mjs passed while 9 rollouts were unclaimable for 28 h).
import { isHeld } from './heldnow.mjs';
const lab = (i, l) => i.labels.some((x) => x.name === l);
export const deps = (i) => [...((i.body || '').matchAll(/^Depends on:\s*(.+)$/gim))].flatMap((m) => [...m[1].matchAll(/#(\d+)/g)].map((x) => Number(x[1])));
/** issues = every open item {number, body, labels:[{name}], pull_request?}. vm: a brain worker (no Java / GPU). opus: the Opus pool. */
export function claimFilter(issues, { vm = false, opus = false } = {}) {
  const list = issues.filter((i) => !i.pull_request && !lab(i, 'blocked') && !lab(i, 'ask-dan') && !lab(i, 'tracking') && !lab(i, 'env-fault') && !lab(i, 'bus') && lab(i, 'opus') === opus
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
