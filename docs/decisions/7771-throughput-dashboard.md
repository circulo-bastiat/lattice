# 7771 - throughput and cost dashboard
Core is `tools/infra/metrics.mjs` (pure); `tools/metrics.mjs` reads the bus and writes `_status/metrics.json` (append-only by bus comment id) and `metrics.html`; `.github/workflows/metrics.yml` rebuilds every 30 min and publishes to the `metrics` branch. `go.mjs status` prints the 24 h headline line. Check: `metricscheck` (4 breaks).
Run cost is attributed to the issue it ran on, so a bounce counts toward the PR that finally lands.
NOT done, owed: lander log and mirror workflow-run metrics (concurrency/wait), per-check bounce rate, usage per account vs pace, full-suite shard time (needs #7727), a Pages/Artifact host. Queue depth is open-issue count only.
