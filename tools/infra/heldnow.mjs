// tools/infra/heldnow.mjs - #5116: is an issue's work/ branch held right now? ONE rule for claim() (go.mjs) and for the queue count, so the count a
// commander reads can never include an issue a worker is refused. head = {age (hours since the branch's last commit), message, bouncedFree}.
export function isHeld(head, staleH) {
  return head.age < staleH && !/^handoff: released/.test(head.message || '') && !head.bouncedFree;
}
