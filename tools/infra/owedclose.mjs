// tools/infra/owedclose.mjs - #11907: a PR handed in with `done --part --owed "<what is left>"` lands tested work and keeps the issue open. When what is left is
// nothing, or every owed item names another issue that already tracks it, the open issue is only a husk: a fresh worker run was spent to find it done and close it
// (#11500, #11503, #11505 on 15 Nov). The lander closes it instead, naming the tracking issues.
const NONE = /^(?:nothing|none|n\/a|no(?:thing)? (?:left|owed))\.?$|^[-—–]$/i;

/** The owed text of a PR body line `Part of #N. **Owed (the issue stays open):** <text>`, or null when the body has no Owed marker. */
export const parseOwed = (line) => { const m = /\*\*Owed[^:\n]*:\*\*\s*([^\n]*)/.exec(String(line || '')); return m ? m[1].trim() : null; };

/** { close, refs }: close = nothing is owed, or every owed item (split on ; and , outside parentheses) cites an issue other than `self`. refs = those issue numbers. Pure. */
export function owedTracked(owed, self) {
  if (owed == null) return { close: false, refs: [] };
  if (!owed || NONE.test(owed)) return { close: true, refs: [] };
  const refs = new Set();
  for (const item of owed.split(/[;,](?![^()]*\))/).map((x) => x.trim()).filter(Boolean)) {
    const mine = [...item.matchAll(/#(\d+)/g)].map((m) => Number(m[1])).filter((k) => k !== Number(self));
    if (!mine.length) return { close: false, refs: [] };
    mine.forEach((k) => refs.add(k));
  }
  return { close: refs.size > 0, refs: [...refs] };
}
