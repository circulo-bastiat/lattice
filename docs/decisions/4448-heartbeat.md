# 4448 - independent 60-min heartbeat (Dan, 8 Oct 2026)

Every watchdog ran only on bus traffic; on 7 Oct the fill sat dead 10.5 h. `.github/workflows/heartbeat.yml` is a plain
Actions schedule (hosted runner, no PC): if FILL_WORKERS > 0, no brain worker/tester runs and master is >= 60 min old, it
posts `restarting the fill` on the bus and dispatches a waker (github.token comments do not trigger workflows; set
secret BRAIN_TOKEN to a PAT for the comment to wake the brain too). Caps and holds are still decided by `brain.mjs fill`.
Error path: any failing step, or no worker within 10 min, mails `fixer` and `commander`; if mailing fails it opens a
`severe` + `fill-idle` issue. Check: tools/heartbeatcheck.mjs. Related: #4317.
