// phaselane.mjs - #3948 (Dan, 6 Oct: "only one worker works on the phases, in order, G17 then G18"). The PHASE LANE is one
// fill worker (run tagged `@phase`, env MCLITE_LANE=phase) that claims only phase-milestone issues, lowest milestone first.
// Pure rules shared by go.mjs queue() and brain.mjs fill(); phaselanecheck proves them.
const lab = (i, l) => (i.labels || []).some((x) => (x.name || x) === l);
const ms = (i) => (i.milestone && i.milestone.title) || '';
export const LANE = 'phase';                       // the account tag of a lane run (`brain worker @phase`) and its noclaim-<tag> marker
export const isLaneRun = (title) => new RegExp(`^brain worker @${LANE}$`).test(title || '');
export const isPhase = (i) => !!ms(i) && !/^(00 INFRA|01 BUGS)/.test(ms(i));
// the body shows the whole ask is done: ✅ marks and nothing owed (no ◐ / ☐ / OWED)
export const doneOnMaster = (i) => { const b = i.body || ''; return /✅/.test(b) && !/[◐☐⬜]|\bOWED\b/i.test(b); };
const skipLabels = ['needs-pc', 'pc-gpu', 'env-fault', 'blocked', 'tracking'];
export const laneCandidate = (i) => isPhase(i) && !doneOnMaster(i) && !skipLabels.some((l) => lab(i, l));
/** 11 Oct (Dan: "divert any two of the workers to the lockstep"): lockstep issues (the gold-standard comparison against the real server, G17-L*) go first for the next (cap - busy) claims.
 *  busy = lockstep issues with a live work/ branch that is not waiting in review. Pure: list = go.mjs queue() list, refs = 'work/<n>-slug' names, inReview = Set of PR head refs. Stable. */
export const isLockstep = (i) => /lockstep/i.test(i.title || '') && !skipLabels.some((l) => lab(i, l));
export function lockstepFront(list, refs, inReview, cap) {
  const live = (n) => (refs || []).some((r) => r.startsWith('work/' + n + '-') && !(inReview && inReview.has(r)));
  const busy = list.filter((i) => isLockstep(i) && live(i.number)).length;
  const free = list.filter((i) => isLockstep(i) && !live(i.number)).slice(0, Math.max(0, cap - busy));
  return [...free, ...list.filter((i) => !free.includes(i))];
}
/** go.mjs queue(): the lane's list (go.mjs sorts it by milestone number, then its usual order). */
export const laneFilter = (list) => list.filter(laneCandidate);
/** brain fill(): lane workers to dispatch now (0|1) - only when the lane is configured, none runs or waits, and its own hold is off. */
export const laneSlots = (cfg, runTitles, held) => ((cfg.fill || {}).phaseLane || {}).workers && !held && !runTitles.some(isLaneRun) ? 1 : 0;
