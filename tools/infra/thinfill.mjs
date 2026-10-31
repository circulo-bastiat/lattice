// #8897 R2: the fill (plain node, no Claude) decides on a thin queue. Workers leave only a 'queue-thin' log marker.
// Order: prooffeed first (files RED proof cells); only if that filed nothing, ONE enlarger round per 6 h, and only while free < thin.
export const ROUND_MS = 6 * 3600e3;
export const SLICES = ['the G17 whole-phase tracking issues', 'the G18 whole-phase tracking issues', 'issue #5043 lockstep ROLLOUT in full, then any other allowed tracking issue'];
export function decide({ free, thin, markerAt = 0, lastRoundAt = 0, lastDecisionAt = 0, now, filed = null }) {
  if (!(markerAt > lastDecisionAt)) return { act: 'none', why: 'no new queue-thin marker' };
  if (free >= thin) return { act: 'none', why: `queue deep enough (${free} >= ${thin})` };
  if (filed === null) return { act: 'prooffeed', why: 'prooffeed first' };
  if (filed > 0) return { act: 'none', why: `prooffeed filed ${filed}` };
  if (now - lastRoundAt < ROUND_MS) return { act: 'none', why: 'enlarger round within 6 h' };
  return { act: 'enlargers', why: 'prooffeed filed nothing' };
}
