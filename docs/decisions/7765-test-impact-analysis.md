# #7765 - test impact analysis in the lander

- `tools/infra/tia-hook.mjs` (`node --import`, via `suite.mjs --map`) records every fs read of a stage and its node children; `tia.mjs normalizeReads` adds the static import closure and turns directory reads into `dir/` prefixes. Reading `dist/mclite.html` counts as depending on all of `src/` + `build.mjs`. Output: `.ledger/tia-map.json` (generated, never committed); `full.mjs` runs the full suite with `--map` and copies it to `$MCLITE_DATA/tia-map.json`.
- `tia.mjs select` (called by `land.mjs tiaRun`, after `--core`, single and batch path): stages whose mapped files intersect `origin/master..HEAD`, stages added by the diff, plus a sample of `sampleRate` (5%) of the rest, seeded by branch name (sha1 of seed+id). Non-browser `check` stages only. Capped at `capMin` (6) estimated minutes, cutting the sample before impacted stages. Config: `roles.json` `tia`. Prints each pick and why in the land log. No map yet = core only, logged.
- `full.mjs` appends `tia-history.jsonl` and logs every NEW red the selection (replayed on the commits since the previous run) would not have picked to `_status/tia-misses.jsonl`; `go.mjs status` prints the 7-day `selection-miss` count.
- `tools/tiacheck.mjs`: 10 breaks (file match, prefix, browser, core dedupe, seed, determinism, cap, cap order, new stages, replay).
- Mirror runs: each shard runs `suite --map` and uploads `tia-map-<i>.json`; `fullshard.mjs mergeMaps` unions them and full.mjs stores the result (tiacheck covers it). Known gaps: browser stages are not selected (lander runs `--fast`). Recall baseline over the last 100 PRs could not be measured here (no result history on this runner; history starts accumulating with this change; `tia.mjs replay <jsonl>` prints the table and recall).

## Recall baseline status (22 Oct)

Items 2-5 are on master (map via `suite --map`, lander selection with the 6 min cap and seeded 5% sample, `selection-miss` log + `go.mjs status` line, `tiacheck` 12 breaks).
Item 1 (the 100-PR replay) needs full-run red history, which only the PC/mirror full runs hold. Each full run now appends `{sha, at, failed}` to `tia-history.jsonl`
and replays the previous record against the new one, so the recall baseline accrues on its own. To read it once the file has entries:
`node tools/infra/tia.mjs replay <MCLITE_DATA>/tia-history.jsonl`. Recall figure: not yet measured; no number is claimed.

## Recall baseline (item 1), from git history (22 Oct)

No result history exists, so `node tools/infra/tiagit.mjs [commits]` rebuilds a PROXY from git alone: a "red" is a non-land fix commit whose subject names a stage id with a fix word;
its cause is the latest earlier commit touching a non-test file the fix also touched; "caught" = the stage's static file set (stage file + import closure; `src/`+`build.mjs` when it
mentions dist/src, and for lockstep/pilot/spawn stages) intersects the cause's diff. The real `suite --map` reads more than imports, so true recall should be >= this. Checked by `tiagitcheck` (3 breaks caught).

| window | reds attributed | caught | recall (proxy) |
|---|---|---|---|
| last 600 commits (~178 landed PRs; only 4 pairs, too few to read) | 4 | 2 | 50% |
| last 6000 commits | 70 | 56 | 80% |

Reading: 80% over 70 attributed reds meets the >= 70% target, but it is a proxy (the cause attribution is heuristic; the misses are mostly cross-cutting `Math.random`/RNG sweeps hitting
shared lockstep files, and a fix naming a stage that was only newly added). The exact figure from `tia-history.jsonl` replaces this when the full runs have filled it.
