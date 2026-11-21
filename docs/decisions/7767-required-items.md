# #7767 Required items: the issue contract

- An issue body may carry a fenced ```required block (`- [ ] text` lines). The body's own box state is ignored; workers answer in `done --msg`:
  `- [x] R1 :: evidence: ...`, `- [ ] R2 :: blocked: <cmd + output>`, `- [ ] R3 :: does-not-fit: <why> :: follow-up: #N`.
- `done --finished` (not --part) refuses unless every item is ticked with evidence. A partial (no --finished, or --part) is always accepted
  if each unticked item has a concrete reason; `does-not-fit` needs the follow-up issue to exist and be open. Silent skips and unevidenced ticks are refused.
- The PR body carries `<!-- mclite:required-done -->` or `-open-`; the lander keeps the issue open unless the done marker is present (the PR still lands).
- Hand-offs carry `<!-- outcome:CLASS -->` and an "Unticked required items" list the next brief prints first. Classes: landed, partial-handoff,
  honest-partial, already-fixed, no-claim, gave-up (a `brain-run` marker with no outcome). Two gave-ups in a row label the issue `needs-commander`+`blocked`; `go.mjs status` prints counts.
- `--already-fixed` needs an evidence line in --msg.
- Items 9/10 (template wording, split after two does-not-fit partials, dashboard #7771) are commander/dashboard-side: the classes are exposed via `classifyIssue`/`countClasses`.
