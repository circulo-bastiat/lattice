# 0001 — Infrastructure v2 (28 Sept 2026, Dan live)

Why: a day's 919 commits held 653 merges (553 of them cloud sessions stacking each other's branches) and ~150
claim/reconcile commits; the harness (172k lines) outgrew the game (101k); ten contradicting instruction sources;
the loop drifted to G27 while G19b–G26 waited. Report: `for-dan/STANDSTILL-REPORT.md`.

Decided (Dan's picks): GitHub Issues backlog in Track G phase order; atomic claims = creating `work/<issue>`;
sessions never write master; a lander on Dan's own PCs (self-hosted runners, no Actions minutes) merges one PR at
a time and bounces conflicts with the branch kept; full GPU suite per master, a red opens `master is red`;
VM-local clones pushing to GitHub; `RUN.md` + `tools/go.mjs` as the only front door; checks-of-docs, gates, hooks,
claims/reconcile/session machinery deleted; docs down to five; usage via `/api/oauth/usage` (tools/usaged.mjs),
multi-account. Projects consolidated in `Downloads\Projects`, one Syncthing folder, VM excluded.
Remaining work: `docs/INFRA-V2.md` (issue #1).
