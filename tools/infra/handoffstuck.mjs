// tools/infra/handoffstuck.mjs - #4998 (Dan, 10 Oct): a RED-check issue whose last hand-offs all say "passes on the current tree, no code change"
// is not work: #2059 collected 16 hand-offs that way and a Haiku run spent its turn on the 16th. claim() labels such an issue `blocked` and skips it.
// Pure: takes the issue's comments (objects with .body), returns true when 2 of the last 3 hand-offs say nothing needed changing (#5010: #4948 was re-queued unchanged twice).
const NOTHING = /no code change|nothing to change|needs no change|passes on (the )?current tree|already passes|without changing any code|re-?queued[^.]{0,80}unchanged|already (fixed|landed)/i;
export function stuckByHandoffs(comments, last = 3, need = 2) {
  const hs = (comments || []).filter((c) => typeof c?.body === 'string' && c.body.startsWith('**Hand-off**')).slice(-last);
  return hs.length >= need && hs.filter((c) => NOTHING.test(c.body)).length >= need;
}
