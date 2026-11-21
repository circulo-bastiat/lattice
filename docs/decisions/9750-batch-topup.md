# 9750: lander batches fill up past closed and just-landed PRs

Date: 22 Oct 2026 (commander). Status: in force.

**Measured.** 7 of 13 batches between 21:12 and 22:40Z were 2-3 PRs wide while 30-55 PRs waited. A PR whose issue is closed held a seat
in every batch, because only a single round refuses such a PR and single rounds only follow a red batch. A just-landed PR still on the
lagging `labels=land` list took another seat.

**Decision.** `landBatch` refuses a closed-issue PR on the spot, with the same comment and close as the single path (`refuseClosed`), and fills
the batch up to BATCH from up to 8 more queue entries.

**Guard.** landbatchcheck.
