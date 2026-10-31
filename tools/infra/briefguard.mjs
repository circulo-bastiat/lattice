// tools/infra/briefguard.mjs - #10712: an issue whose body is a stub ("Part of #7335." only) is not a brief. #7348 cycled 8 times:
// brain unblock -> worker claims -> nothing to act on -> no-code hand-off -> re-blocked. Pure helpers; briefguardcheck RUNS them.
export const BRIEF_MIN = 200;
/** the body without its `Part of` / `Depends on` lines, trimmed */
export const briefText = (body) => String(body || '').split('\n').filter((l) => !/^\s*(Part of|Depends on)\b/i.test(l)).join('\n').trim();
export const stubBody = (body, min = BRIEF_MIN) => briefText(body).length < min;
/** how many times the brain unblocked this issue (its #6663 / #9168 comments); 3 = the unblock -> no-code -> block loop */
export const unblockCycles = (comments) => (comments || []).filter((c) => /\*\*Unblocked by the brain\*\*/.test((c && c.body) || '')).length;
/** may the brain unblock it? why = null | 'stub' | 'loop' (then it mails the commander once instead of commenting again) */
export function unblockVerdict(issue, comments, mailed = {}) {
  const why = stubBody(issue && issue.body) ? 'stub' : unblockCycles(comments) >= 3 ? 'loop' : null;
  return { ok: !why, why, mail: !!why && !(mailed || {})[issue && issue.number] };
}
