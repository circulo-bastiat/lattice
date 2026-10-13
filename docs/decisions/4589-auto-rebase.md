# 4589 - bounced merge-conflict PRs re-queue themselves

PR #4351 sat 5.8 h after a conflict bounce; #3170, #2630, #2612 for days. `tools/infra/autorebase.mjs`, run by the brain's 15-min health pass:

1. Latest lander comment is "conflicts with master" and GitHub now reports the PR `mergeable` -> label `land` again (the lander re-tests it on master; no session, no model).
2. True conflict -> a worker: `go.mjs queue()` now puts `needs-rebase` issues ahead of every milestone and the `gate` no longer hides them (finished work should land). The third conflict bounce (original + 2 attempts) -> issue `blocked`, fixer mailed.
3. Issue closed and PR untouched for 7 days -> PR closed with a comment.
- Red (non-conflict) bounces are left to workers. A sweep error is mailed (fixer + commander) at most hourly and never retried in a loop.
- Check: `tools/autorebasecheck.mjs` (10 breaks caught).
