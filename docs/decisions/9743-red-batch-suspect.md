# 9743: a red batch tests the one PR its red check names first

Date: 22 Oct 2026 (commander). Status: in force.

**Measured.** 3 of about 15 batches went red between 20:00 and 22:20Z; each cost 3 single rounds of 5-9 min while about 30 PRs waited.

**Decision.** `suspects()` matches the failed check ids against each member's diff: a change to the check itself, to its stage file, or to a file
the check's source names (basename of 5+ characters; the shared lists do not count). With exactly one suspect, the lander runs one single round
on it. That round runs the full core suite, so no PR is bounced on a guess. If the suspect lands anyway, the other members get the usual
single rounds. Any other count keeps the old 3 rounds.

**Rejected.** Bisecting, which needs more mirror rounds per batch. Bouncing the suspect without testing it: a wrong guess would bounce a good PR.

**Guard.** landbatchcheck.
