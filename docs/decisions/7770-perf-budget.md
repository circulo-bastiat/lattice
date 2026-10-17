# 7770 — performance budget in CI (replaces #133 lowend.yml)
- `.github/workflows/bench.yml` runs tools/bench.mjs (low preset, headless) on a free hosted runner after each master push; results stored in branch `bench-data` (store.json, keyed by sha).
- Benchmarks: per-preset meanMs, p95Ms, drawsPerFrame, trisPerFrame, worldMB, arenaMB (frame prep CPU, stalls, geometry, memory). Chunk-gen/entity-tick microbenchmarks are NOT yet built (owed).
- Rule (tools/benchbudget.mjs): regression if > max(3x spread, 10%) over median of last 5; alert-only `perf-regression` issue, never blocks the lander.
- Spread: `benchbudget.mjs spread` on a 10-run store; >10% means rewrite/drop. The 10-run measurement must be taken on the runner (owed, not measurable locally).
- `go.mjs status` prints latest values and 7-day trend. Check: benchbudgetcheck.
