# 9651 - a stage that only TIMED OUT on a mirror shard is inconclusive, never RED, and is not retried

Date: 22 Oct 2026. Decided by: commander (Dan's brief: "audit, don't patch").

**Problem.** fullshard.mjs retried every failed stage once inside a 10-min wall while the stage limit is 12 min, so a stage that timed out was always
killed again before it printed a row, and the verdict (read from the retry segment only) left it RED. ~17 `RED lockstep-*` issues per full run
were timeouts; workers reran them warm, found them green, closed them; the next run reopened them.

**Decision.** (1) A stage whose first-run row is a TIMEOUT is not retried. (2) The verdict for each id is the LAST row it printed anywhere in the
shard log. (3) The ledger is deleted before a retry, so a killed retry never reads the first run's ledger as its own. Timeouts go to the single
FULL-SUITE TIMEOUTS tracking issue (21 Oct design). Check: fulltimeoutcheck (core).

**Not chosen.** Raising the retry wall above 12 min: costs up to 12 more minutes of a 32-min shard for a result that is already inconclusive.
