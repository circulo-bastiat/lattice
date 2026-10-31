# 7768 reviewer role
Fresh-context judge (`tools/brain/reviewer.mjs`): sees issue text + `required:` list, PR diff, check output; never the worker summary. Verdict pass|mismatch|unclear. Samples every verifier-change PR, every <=3-turn run, 1 in 5 of the rest; cap 6/h, 40/day; off when usage caps stop. Mismatch reopens (`review-mismatch`) and mails commander. Model: haiku (provisional, pending calibration, item 4).

## Wiring (22 Oct)
`tools/brain/reviewtick.mjs`: `plan()` (sampling + caps + usage stop, pure) is called from brain.mjs fill() over recently merged `work/<issue>-*` PRs and dispatches role `reviewer`; `record` (CLI, used by the reviewer prompt) comments, appends `_status/reviews.jsonl`, and on mismatch reopens with `review-mismatch` and mails the commander. Worker turn counts are not available to the fill yet (null), so the <=3-turn rule is inactive there; verifier-change and 1-in-5 sampling run. Calibration (item 4) still owed: needs live model runs over 30 landed + 10 reverted PRs.

## Calibration harness (22 Oct)
`tools/brain/calibrate.mjs`: `cases` lists the last 30 kept merged `work/` PRs (truth pass) + 10 reverted/bounced (truth mismatch) via gh; `score cases.json verdicts.jsonl` prints per-model mismatch precision/recall/agreement and `pickModel` chooses the cheapest tier within 5 points of the best. `calibratecheck` 4 breaks caught. The live model runs (feed each case's input to the reviewer per tier, append `{pr,model,verdict}` to verdicts.jsonl) are still owed; results go on the issue.
