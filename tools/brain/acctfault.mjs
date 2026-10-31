// acctfault.mjs - #10723. 30 Oct 23:01Z the Max plan ended: a worker died at start with "Your organization has disabled Claude subscription access for
// Claude Code" (usage HTTP 429 UNKNOWN), released its claim with no code, and the fill kept FILL_WORKERS_MAX=10. That text is an ACCOUNT fault, not a
// burned run: the account's fill is parked (FILL_WORKERS_<ACCOUNT>=0, what `go.mjs loop <acct> 0` does) until a run on it succeeds.

/** true when the run text says the account itself has no subscription access. Pure. */
export const accountDisabled = (text) => /disabled\s+claude\s+subscription\s+access|subscription access (is )?disabled/i.test(String(text || ''));

/** The account fault of a finished run: {park} (account to park, saved = its previous switch value) or {unpark} (a run on a parked account succeeded) or null. Pure.
 *  run = {text, ok, turns, account}; parked = history.parked {account: previous value}. */
export function accountFault({ text, ok, turns, account }, parked = {}) {
  if (!account) return null;
  if (accountDisabled(text)) return parked[account] !== undefined ? { hold: true } : { park: account };
  if (ok && (turns || 0) > 0 && parked[account] !== undefined) return { unpark: account, restore: parked[account] };
  return null;
}

/** A claim by a run that exited before any turn is not a claim on the issue (it must be released, never counted as a burn). Pure. */
export const claimIsVoid = ({ turns, code }) => code !== 0 && !(turns > 0);
