// tools/infra/handoffstuck.mjs - #4998 (Dan, 10 Oct): a RED-check issue whose last hand-offs all say "passes on the current tree, no code change"
// is not work: #2059 collected 16 hand-offs that way and a Haiku run spent its turn on the 16th. claim() labels such an issue `blocked` and skips it.
// Pure: takes the issue's comments (objects with .body), returns true when 2 of the last 3 hand-offs say nothing needed changing (#5010: #4948 was re-queued unchanged twice).
const NOTHING = /no code change|nothing to change|needs no change|passes on (the )?current tree|already passes|already pass\b|prelaunch \(#7683\)|without changing any code|re-?queued[^.]{0,80}unchanged|already (fixed|landed)/i;
export function stuckByHandoffs(comments, last = 3, need = 2) {
  const hs = (comments || []).filter((c) => typeof c?.body === 'string' && c.body.startsWith('**Hand-off**')).slice(-last);
  return hs.length >= need && hs.filter((c) => NOTHING.test(c.body)).length >= need;
}

// #9933 (commander, 23 Oct): the 12 checks that stayed RED on every full run since 21 Oct were answered by "already pass" hand-offs
// (prelaunch #7683 and workers) and then labelled `blocked`, so nobody worked them and master stayed red. The full run is the JUDGE:
//   a red comment ("The full suite on master at <sha> has `<check>` red") NEWER than the last hand-off = fresh, work it, never stuck;
//   two red -> "already passes" cycles in a row, or 2 "already passes" since the last red = the environments DISAGREE: `env-diverges`
//   (never `blocked`, never a burn), the commander is mailed once.
export const RED_COMMENT = /The full suite on master at \w+ has `[\w-]+` red\./;
const isHand = (c) => typeof c?.body === 'string' && /^\*\*(Hand-off|Already fixed on master)\*\*/.test(c.body);
export function handoffVerdict(comments) {
  const cs = (comments || []).filter((c) => typeof c?.body === 'string');
  const reds = cs.map((c, i) => (RED_COMMENT.test(c.body) ? i : -1)).filter((i) => i >= 0);
  if (!reds.length) return 'ok';   // no judge comment: the old #4998 rule (stuckByHandoffs) decides
  const said = (a, b) => cs.slice(a, b).filter((c) => isHand(c) && NOTHING.test(c.body)).length;
  const segs = reds.map((r, k) => said(r + 1, k + 1 < reds.length ? reds[k + 1] : cs.length));
  const n = segs.length;
  if (segs[n - 1] >= 2 || (n >= 3 && segs[n - 2] >= 1 && segs[n - 3] >= 1) || (n === 2 && segs[0] >= 2)) return 'diverges';
  return segs[n - 1] === 0 ? 'fresh' : 'ok';
}

// #10355: the 3rd-unfinished-hand-off block counts only the hand-offs AFTER the latest sign of progress (`**Partly landed**` or an
// outcome:landed comment that is not itself a hand-off). A big phase issue delivers one slice per hand-off, so landed slices reset the count.
export function blockedByHandoffs(comments, limit = 3) {
  let n = 0;
  for (const c of comments || []) {
    const b = c?.body;
    if (typeof b !== 'string') continue;
    if (b.startsWith('**Hand-off**')) n++;
    else if (b.startsWith('**Partly landed**') || /<!-- outcome:landed -->/.test(b)) n = 0;
  }
  return n >= limit;
}
