# 4549 - the brain picks the worker/tester split (Dan, 8 Oct 2026)

"I shouldn't have to make this ratio decision anymore." Supersedes the fixed 1-worker default of #4298.

- `route.mjs fillShape` (pure) runs every fill pass. workers = clamp(ceil(queue / (drain * 0.5 h)), 1, fill.maxWorkers=4); a red master or
  a lander backlog >= fill.landDeep (6) halves them; testers = slots - workers. Slots = fill total (quiet halving) capped by the
  usage/API budget (`usageCap`, which already paces the 5-hour window to the reset and holds the week cap), at least 1.
- Inputs: REAL queue (`go.mjs claimable`, shared with `go.mjs status`: no blocked/needs-pc/pc-gpu/INFRA), drain = issues closed in
  the last 3 h / 3, tester finds (last doneRuns runs, shown in the line), PRs labelled `land`, master-red from the health pass, usage.
- Hysteresis: one slot per move, at most once per 30 min; a shrinking budget clamps at once. State: `history.shape`.
- Visible: a change posts one `to: log` line with its inputs; `go.mjs status` prints the current line.
- Error path: an unreadable input (queue, drain, lander, stale/missing usage) keeps the previous shape, mails the fixer (once an hour); the fill goes on.
- Gate M stays Dan's: nothing here touches `passGate`. The phase lane's issues are inside the queue count, so an empty queue means no phase work either.
- Not done: weekly pacing beyond the existing week cap (no measured %/session-hour for the week yet).
- Check: `tools/fillshapecheck.mjs` (15 breaks caught).
