# 7766 - protect the verifier
- `tools/protected.json` is the one list of gate files. `tools/infra/verifierguard.mjs` (pure `guard()`) classifies a PR; `land.mjs landOne` holds it (label `verifier-change`, comment naming each rule, `land` removed) unless a `**Commander` comment exists. `go.mjs status` lists held PRs.
- Additive passes: new stage file, new core check, new quarantine/waiver entry carrying an issue number. Held: removals, shortened justification, widened waiver classes, changed/deleted stage, edits to land/gate/workflows/roles quarantine+cap keys, edits to the set.
- Weakening detector (every PR, changed tools/*.mjs): new vacuity class V1-V4, `|| true`, constant-true ok(), early `process.exit(0)`, new SKIP-exit-0. 
- Gap: "breaks caught" count drop is supported by `guard({breakCounts})` and checked, but the lander does not yet run changed checks on master vs PR to supply counts (costly); also `landBatch` has no hook yet. Both owed.
