# 8893 - the brain clock is one 5-minute GitHub schedule (Dan, 19 Oct)
- brain.yml `schedule: */5 * * * *` runs `health --if-due` + `fill` on the brain runners. Idempotent: it runs everything due, so a dropped tick is caught up.
- issue_comment routes only mail to commander/fixer/requests/enlarger/dan and skips `from: brain` (no self-triggering on `to: log`).
- Wakers are gone: `arm()` / `brain.mjs wake` only record the wanted time in history.wakes; the tick revisits it. No job sleeps.
- Claude-app scheduled tasks, update_trigger and approval prompts stay banned (28 Sept); a GitHub Actions schedule has none (precedent: heartbeat #4448).
- Checks: fillwakecheck (53 breaks caught), braincheck.
- R4 (before/after runs per hour) is measured after landing; owed on this issue.
