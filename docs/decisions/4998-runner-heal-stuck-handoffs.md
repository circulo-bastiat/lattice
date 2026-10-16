# #4998 - heal a stale runner workspace; stop claiming "already passes" RED issues (Dan, 10 Oct)

**Why.** brain-4's workspace held CRLF blobs for `tools/golden/*.tsv` in its index while `.gitattributes` says `eol=lf`;
`actions/checkout` then died with "Entry ... not uptodate" and every job sent to that runner failed from 20:14Z to 22:39Z
(12+ runs, including the Sonnet usage test). Separately #2059 (RED mountcheck) took 16 hand-offs, the last four "passes on
current tree, no code change"; a Haiku run spent its turn on the 16th.

**What.** (1) `brain.yml` route + run jobs run a step before checkout: `rm -f .git/index`, `git reset --hard HEAD`, never fails
(untracked `.mcdata` is kept). (2) `claim()` reads the comments of a `red-check`/`needs-rebase` candidate (never on an explicit
`--issue`): 3 of its last 4 hand-offs saying nothing needed changing -> label `blocked`, skip (`tools/infra/handoffstuck.mjs`).
`tools/handoffstuckcheck.mjs` pins both with 9 breaks.

**Revert.** Delete the heal step / the `if` at the top of `claim()`.
**Cost.** One extra API call per red-check/needs-rebase candidate walked by a claim.
