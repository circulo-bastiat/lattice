// queuegate.mjs - Dan's GATES in the work queue (30 Sept: "i want rigorous testing on every mob texture and behavior,
// porting, etc, we dont move on until its perfect"). While an open issue labelled `gate` exists, go.mjs hands out only
// the bug milestone and the entity/mob milestones (G17*, G18*) or issues labelled `mobs` - no session can move on by
// its own choice. queuegatecheck proves it.
const lab = (i, l) => (i.labels || []).some((x) => (x.name || x) === l);
const PHASES = /\bG1[78][a-z]?\b/;
// #5965 COMPUTED gate (Dan, 12 Oct: "ABSOLUTELY NO SKIPPING FORWARD"): also up while ANY open issue (lockstep units included) sits in a G17*/G18* milestone
export const handGate = (issues) => issues.find((i) => !i.pull_request && lab(i, 'gate'));
export const phaseOpen = (issues) => issues.filter((i) => !i.pull_request && PHASES.test((i.milestone && i.milestone.title) || ''));
// 22 Oct (Dan: "everything opens once 91/91 is hit"): go.mjs sets issues.allProven when the live proof matrix is fresh, fully proven and dry; the COMPUTED rule then lifts (a hand `gate` issue still holds)
export const gateOpen = (issues) => !!handGate(issues) || (phaseOpen(issues).length > 0 && !issues.allProven);
export const inGate = (i) => { const t = (i.milestone && i.milestone.title) || ''; return /^01 BUGS/.test(t) || /\bG1[78][a-z]?\b/.test(t) || lab(i, 'mobs') || lab(i, 'mobfree') || lab(i, 'red') || lab(i, 'env-gap'); };   // 21 Oct: an env-gap issue PROVISIONS what workers lack (envgap.mjs); the gate must never hide it   // 20 Oct: a RED issue (no milestone) was hidden by the gate - 0 claimable, fill dormant 61 min
// #9120: an in-gate issue that Depends on an out-of-gate one (#7883 on #188) deadlocked: the gate hid the dependency. Those (transitively) pass.
const depsOf = (i) => [...((i.body || '').matchAll(/^Depends on:\s*(.+)$/gim))].flatMap((m) => [...m[1].matchAll(/#(\d+)/g)].map((x) => Number(x[1])));
export function gateFilter(list, issues) {
  if (!gateOpen(issues)) return list;
  const by = new Map(list.map((i) => [i.number, i])), need = new Set(), todo = issues.filter((i) => !i.pull_request && inGate(i) && !i.labels.some((x) => /^(blocked|tracking|ask-dan)$/.test(x.name)));   // #9126: seed from ALL open in-gate issues - claimFilter already dropped the ones that Depend on something open
  for (let i; (i = todo.pop()); ) for (const d of depsOf(i)) if (by.has(d) && !need.has(d)) { need.add(d); todo.push(by.get(d)); }
  return list.filter((i) => inGate(i) || need.has(i.number));
}
// a child filed with `go.mjs newissue` inherits the parent's labels (mobs/opus/severe/dan/bug...) or the gate hides it (#1515);
// not blocked/tracking/land (their meaning is the parent's own) and not `gate` (a child must not open a second gate)
export const inheritLabels = (parent) => (parent.labels || []).map((x) => x.name || x).filter((n) => !/^(blocked|tracking|land|gate)$/.test(n));
