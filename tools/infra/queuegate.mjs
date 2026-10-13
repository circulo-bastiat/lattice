// queuegate.mjs - Dan's GATES in the work queue (30 Sept: "i want rigorous testing on every mob texture and behavior,
// porting, etc, we dont move on until its perfect"). While an open issue labelled `gate` exists, go.mjs hands out only
// the bug milestone and the entity/mob milestones (G17*, G18*) or issues labelled `mobs` - no session can move on by
// its own choice. queuegatecheck proves it.
const lab = (i, l) => (i.labels || []).some((x) => (x.name || x) === l);
const PHASES = /\bG1[78][a-z]?\b/;
// #5965 COMPUTED gate (Dan, 12 Oct: "ABSOLUTELY NO SKIPPING FORWARD"): also up while ANY open issue (lockstep units included) sits in a G17*/G18* milestone
export const handGate = (issues) => issues.find((i) => !i.pull_request && lab(i, 'gate'));
export const phaseOpen = (issues) => issues.filter((i) => !i.pull_request && PHASES.test((i.milestone && i.milestone.title) || ''));
export const gateOpen = (issues) => !!handGate(issues) || phaseOpen(issues).length > 0;
export const inGate = (i) => { const t = (i.milestone && i.milestone.title) || ''; return /^01 BUGS/.test(t) || /\bG1[78][a-z]?\b/.test(t) || lab(i, 'mobs'); };
export function gateFilter(list, issues) { return gateOpen(issues) ? list.filter(inGate) : list; }
// a child filed with `go.mjs newissue` inherits the parent's labels (mobs/opus/severe/dan/bug...) or the gate hides it (#1515);
// not blocked/tracking/land (their meaning is the parent's own) and not `gate` (a child must not open a second gate)
export const inheritLabels = (parent) => (parent.labels || []).map((x) => x.name || x).filter((n) => !/^(blocked|tracking|land|gate)$/.test(n));
