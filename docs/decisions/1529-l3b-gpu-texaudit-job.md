# #1529 - the GPU texture audit is a controlled background job

Decision: the GPU half of GATE M L3 (WebGL2 and WebGPU drawing every complained mob with the game's mob pipeline, compared
with the jar+.decomp reference) is `tools/texauditjob.mjs`, and it NEVER runs in the foreground or in the suite.

- Only the brain starts it: the health pass (`tools/brain/brain.mjs`) asks `texauditDue` (`route.mjs`) and spawns it detached,
  nice 19, with `MCLITE_TEXAUDIT_BG=1`. Due = the entity/model/texture sources changed (srcHash), 3 h or more since the last
  start, machine not busy (load > 0.5 per core, usage cap, `.infra/STOP-SUITE`), no run holding the lock.
- The CLI refuses without that env var. No stage, `suite.mjs`, `go.mjs` or `RUN.md` path runs it (`texauditjobcheck` greps).
- Controlled: one run at a time (`<dir>/render.lock`, stale = dead pid or older than runMs + 5 min), 60 s per mob, 1536 MB for the
  browser tree, 45 min per run (then state `aborted`), resumable by srcHash (`summary.json`).
- Read it with `node tools/go.mjs texaudit status` (read-only; there is no way to start a render from there). Results:
  `<dir>/summary.json`, `<dir>/<mob>/<layer>.json` + diff PNGs, one bus line, repo variable `MCLITE_TEXAUDIT`.
  `<dir>` = `$MCLITE_TEXAUDIT_DIR` or `<_status>/texaudit` or `~/.brain/_status/texaudit`.
- Mismatching mobs are filed as `L3 render: <mob>` bug issues (deduplicated, source named), only with a GH token.
- Proof: `tools/texauditjobcheck.mjs` (node, fakes, no browser; 15 broken copies must fail).
