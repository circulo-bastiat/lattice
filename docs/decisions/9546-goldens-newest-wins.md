# 9546 - referee goldens: the store branch is the single source, the newest `generatedAt` wins

Date: 22 Oct 2026. Decided by: commander.

**Problem.** Goldens are generated on the real 1.18.2 server and are not in git (D-6). The lander and the mirror read the `store` branch. A worker that
regenerated a golden made the check green on its machine, closed the RED issue as already-fixed, and never published the golden; meanwhile every
worker's `go.mjs prep` (syncGolden) overwrote the shared referee dir with the store copy. Measured: mob-xp.json regenerated at 18:42Z (75 variants)
was overwritten with the 25 Sept copy (50 variants) at 18:44:55Z.

**Decision.** Goldens stay out of git. (1) syncGolden keeps a local golden whose `generatedAt` is newer than the store copy. (2) publishGolden never
pushes a golden older than the store copy, even when forced. (3) `done --already-fixed` and `done --finished` of a RED issue publish (force) the
goldens that issue's check reads. Files without `generatedAt` keep the old rules. Check: goldenredcheck (core).

**Not chosen.** Committing goldens to git (D-6, sizes up to ~1 MB, regenerated often) and a core check that every golden is tracked (#9546 step 3).
