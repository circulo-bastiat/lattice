// tools/infra/skipguard.mjs - #9166 (commander, 20 Oct): a RED issue is closed `done --already-fixed` when the check "passes" in the
// worker's workspace. xprefcheck, motionrefcheck and buttonrefcheck print `SKIP (golden not generated)` and exit 0 when the workspace has
// no golden, so the worker saw green, the issue closed, and the next mirror full run (which HAS the golden) reopened it: three or more
// times for #4036 and #3995. go.mjs now re-runs the named check itself and refuses a SKIP. Pure; skipguardcheck drives it.
/** "RED xprefcheck: full-suite check red on master" -> "xprefcheck"; anything else -> null (only red-check issues are guarded) */
export function redCheckName(title) {
  const m = /^RED\s+([A-Za-z0-9_.-]+)\s*:/.exec(String(title || ''));
  return m ? m[1] : null;
}
/** The verdict on one `suite.mjs --only <check>` run: {ok, why}. A SKIP (a check that did not look at anything) is never a pass. */
export function verdict(output, status) {
  const out = String(output || '');
  if (status !== 0) return { ok: false, why: `the check fails here (exit ${status})` };
  if (/(^|[\s:(])SKIP(\s|\(|:|$)/m.test(out)) return { ok: false, why: 'the check printed SKIP (no golden in this workspace): that is not a pass, the mirror has the golden and will keep reopening this' };
  return { ok: true, why: '' };
}
