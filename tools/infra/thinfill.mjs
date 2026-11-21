// #8897 R2: the fill (plain node, no Claude) decides on a thin queue. Workers leave only a 'queue-thin' log marker.
// Order: prooffeed first (files RED proof cells); only if that filed nothing, ONE enlarger round, and only while free < thin.
// #11331 (Dan, 9 Nov: need-based, not a 6 h timer; a worker that finds nothing claimable is the request): a round starts whenever the need is there -
// no enlarger run in flight, at least GAP_MS since the last round, and something new to find (the last round filed units, or the probe evidence changed).
export const GAP_MS = 45 * 60e3;
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// #10799: slices are DERIVED from evidenced gaps (probes), never constants. A probe returns {slice, evidence[], count} or null.
export const HOLD_MS = 24 * 3600e3;
const rd = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const DIMS = ['model', 'texture', 'animation', 'drops', 'spawn', 'lockstep', 'goals'];
/** roster mobs with neither a step lane nor an N/A row */
export function stepLaneGap(roster, laneMobs, na) {
  const have = new Set([...laneMobs, ...Object.keys(na || {}).filter((k) => !k.startsWith('_'))]);
  return roster.filter((m) => !have.has(m));
}
/** #11320 (Dan, 8 Nov: "the enlargers should be responsible for the owed ... their dividing up and all related corollaries"): the OWED rows in src/ and the unsplit whole-phase trackers are evidence too. */
export function owedFiles(root) {
  let fs = []; try { fs = readdirSync(join(root, 'src')).filter((f) => f.endsWith('.js') && !/\.gen\.js$/.test(f)); } catch { return []; }
  const rows = [];
  for (const f of fs) { let n = 0; try { n = (readFileSync(join(root, 'src', f), 'utf8').match(/OWED/g) || []).length; } catch { /* unreadable */ } if (n) rows.push({ f, n }); }
  return rows.sort((a, b) => b.n - a.n || a.f.localeCompare(b.f));
}
/** greedy balance of the OWED files into `parts` slices (biggest file to the lightest slice); each slice is a probe */
export function owedSlices(rows, parts = 1) {
  const B = Array.from({ length: parts }, () => ({ files: [], n: 0 }));
  for (const r of rows) { const b = B.reduce((m, x) => (x.n < m.n ? x : m)); b.files.push(r); b.n += r.n; }
  return B.filter((b) => b.files.length).map((b, i, a) => ({ slice: `OWED tables in src/ (part ${i + 1} of ${a.length}): every non-empty *.OWED row without an open or closed issue`, evidence: b.files.map((x) => `src/${x.f}: ${x.n} OWED lines`), count: b.n }));
}
export const unsplitTrackers = (titles) => titles.filter((t) => /whole phase\s*[\u2014-]+\s*split it into issues/i.test(t));
export function probeSlices(root, { openTitles = [] } = {}) {
  const T = join(root, 'tools'), out = [];
  const unsplit = unsplitTrackers(openTitles);   // #11320: the owed work comes first, the 3-slice cap would starve it otherwise
  if (unsplit.length) out.push({ slice: 'whole-phase trackers still unsplit: each is stale text or real OWED work - prove which, then close it with evidence or split it into units', evidence: unsplit, count: unsplit.length });
  out.push(...owedSlices(owedFiles(root)));
  const roster = Object.keys((rd(join(T, 'mobl3-mobs.json'), {}).mobs) || {});
  let lanes = []; try { lanes = readdirSync(join(T, 'referee', 'steplanes.d')).filter((f) => f.endsWith('.json')).map((f) => rd(join(T, 'referee', 'steplanes.d', f), {}).mob).filter(Boolean); } catch { /* none */ }
  const gap = stepLaneGap(roster, lanes, rd(join(T, 'referee', 'steplanes.na.json'), {}));
  if (gap.length) out.push({ slice: 'roster mobs with no step lane and no N/A row (tools/referee/steplanes.d, steplanes.na.json)', evidence: gap.map((m) => `${m}: no lane, no N/A row`), count: gap.length });
  const M = rd(join(T, 'mobproof', 'matrix.json'), {}), reds = [];
  for (const [m, r] of Object.entries(M.rows || {})) for (const d of DIMS) if (r[d] === 'red') reds.push(`${m} x ${d}: red`);
  if (reds.length) out.push({ slice: 'red mob proof matrix cells (tools/mobproof/matrix.json)', evidence: reds, count: reds.length });
  const FG = rd(join(T, 'finalgate.json'), {}).areas || [], so = rd(join(T, 'finalgate-signoff.json'), {});
  const open = openTitles.join('\n').toLowerCase();
  const rows = FG.filter((a) => (a.proof === 'C' || a.proof === 'G') && !so[a.id] && !open.includes(a.id.toLowerCase())).map((a) => `${a.id} (proof ${a.proof}): no sign-off, no open issue naming it`);
  // #11320: final-gate rows (proof C/G) are human sign-offs: every enlarger they woke filed 0 units (8 and 9 Nov), so they are Dan's mail, not a slice
  void rows;
  return out;
}
/** hold: { [slice]: {at, count} } - a slice that filed 0 units is not offered for 24 h unless its count changed. The epoch is INSIDE the marker (#10653). */
export function liveSlices(probes, hold = {}, now) {
  return probes.filter((p) => { const h = hold[p.slice]; return !(h && now - h.at < HOLD_MS && h.count === p.count); });
}
export const sliceReason = (p, k, n) => `slice ${k} of ${n}: ${p.slice}. EVIDENCE (${p.count}): ${p.evidence.slice(0, 12).join('; ')}${p.evidence.length > 12 ? '; ...' : ''}`;
export const continueNote = (left) => (left ? `\nLEFT FROM THE LAST RUN (continue these first): ${left}` : '');   // #11333
export function decide({ free, thin, markerAt = 0, lastRoundAt = 0, lastDecisionAt = 0, now, filed = null, slices = [], inFlight = false, lastFiled = null, sig = '', lastSig = '' }) {
  if (!(markerAt > lastDecisionAt)) return { act: 'none', why: 'no new queue-thin marker' };
  if (free >= thin) return { act: 'none', why: `queue deep enough (${free} >= ${thin})` };
  if (filed === null) return { act: 'prooffeed', why: 'prooffeed first' };
  if (filed > 0) return { act: 'none', why: `prooffeed filed ${filed}` };
  if (inFlight) return { act: 'none', why: 'an enlarger run is still in flight' };
  if (now - lastRoundAt < GAP_MS) return { act: 'none', why: 'enlarger round within 45 min' };
  if (!slices.length) return { act: 'none', why: 'no evidenced slice' };
  if (lastFiled === 0 && sig && sig === lastSig) return { act: 'none', why: 'the last round filed 0 units and the evidence is unchanged' };
  return { act: 'enlargers', why: 'prooffeed filed nothing', slices };
}
