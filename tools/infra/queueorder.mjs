// tools/infra/queueorder.mjs - #2632 (Dan, 4 Oct 2026: "priority lane"): the order the lander takes PRs in.
// PRs labelled `priority` (commander only) go first, then the rest; inside each group oldest first, exactly as before.
export const hasPriority = (i) => (i.labels || []).some((l) => (l.name || l) === 'priority');
export function orderQueue(items) {
  const prs = items.filter((i) => i.pull_request);
  return [...prs.filter(hasPriority), ...prs.filter((i) => !hasPriority(i))].map((i) => i.number);
}
