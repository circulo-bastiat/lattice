# 9747: a draining land backlog never pages Dan

Date: 22 Oct 2026 (commander). Status: in force.

**Decision.** `land-backlog` still mails the commander at the threshold. When master moved in the last 45 minutes the finding is marked
`draining`, and `dueAlerts` never pages Dan for a draining finding. A stuck lander still pages Dan, through `lander-idle` and through
`land-backlog` without progress.

**Why.** A backlog after a burst of worker PRs is normal; a page should mean that something is broken.

**Guard.** fillresumecheck.
