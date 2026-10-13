# 4975 - self-healing ladder instead of alarms (Dan, 10 Oct 2026)

Four standstills on 9-10 Oct (FILL_WORKERS=0, hosted minutes gone, VM disk full, CRLF PRs bouncing) went unseen because the watcher shared the
failure domain of the thing that broke. Now: ONE symptom - no PR merged and no worker/tester run for 45 min while work is claimable
(`stalled()`, tools/infra/ladder.mjs) - and a fixed ladder, one rung per pass, each idempotent, each one `to: log` line `ladder: <rung> - ...`:
restart-fill, clear-noclaim, free-disk, restart-runners, rerun-smoke, flip-test-runner, relabel-bounced, then (once) a page to Dan.
A rung with nothing to fix returns null and the climb continues in the same pass.

Two watchers, different domains, neither on hosted minutes: the VM's brain health pass (`ladderPass`, brain.mjs) and the PC's usaged
`vmwatch.tick` (`ladderTick`; its "restart runner services" is a VM restart). Each watches the other: the VM publishes repo variable
BRAIN_HEALTH_AT (stale 45 min = dead VM, the PC restarts it); the PC's MCLITE_USAGE beat stale 45 min = dead PC watcher, the VM sets TEST_RUNNER=hosted.
Check: tools/laddercheck.mjs (chaos drill of the four standstills + an unfixable one, five breaks).

Not done: landing throughput (batching #139 / merge queue) - the lander is still one-at-a-time; needs its own issue. The hourly hosted
heartbeat.yml is unchanged (it is a third, weaker watcher).
