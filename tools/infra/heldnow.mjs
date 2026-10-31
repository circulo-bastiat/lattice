// tools/infra/heldnow.mjs - #5116: is an issue's work/ branch held right now? ONE rule for claim() (go.mjs) and for the queue count, so the count a
// commander reads can never include an issue a worker is refused. head = {age (hours since the branch's last commit), message, bouncedFree}.
export function isHeld(head, staleH) {
  return head.age < staleH && !/^handoff: released/.test(head.message || '') && !head.bouncedFree;
}

/** #7579: the work/ branches HELD right now, from GraphQL ref nodes [{ name: '<n>-slug', target: { committedDate, message } }] - the same rule claim() uses (heldnow.mjs).
 *  A released / stale branch is NOT busy (before this, ~70 'handoff: released' lockstep branches counted as busy and the cap never led anything). */
export const heldRefs = (nodes, inReview, staleH, now = Date.now()) => (nodes || []).filter((n) => n && n.target && n.target.committedDate).map((n) => ({ ref: 'work/' + n.name, t: n.target }))
  .filter(({ ref, t }) => isHeld({ age: (now - Date.parse(t.committedDate)) / 36e5, message: t.message || '', bouncedFree: !!(inReview && inReview.rebase && inReview.rebase.has(ref)) && !/^takeover:/.test(t.message || '') }, staleH)).map((x) => x.ref);
