# 9642 - with TEST_REMOTE=mirror a shard fault is the MIRROR's, never the PC runner's

Date: 22 Oct 2026. Decided by: commander.

**Problem.** Under TEST_REMOTE=mirror the PC only snapshots and aggregates, yet full.mjs treated `pack-shard-timeout` (a shard that hit its wall)
and any mass failure as an ENVIRONMENT FAULT of the PC runner (#9232): it mailed fixer + commander, filed no RED issue and no proof matrix for
the whole run (9 shard timeouts and 7 "N NEW stages failed" faults in runner-full-suite.log), which is one reason the matrix went STALE.

**Decision.** mergeShards moves a shard's `pack-shard-*` setup failure to `ledger.mirrorFaults` and that shard's stages to `skipped` (not concluded:
no RED opened or closed for them); the other shards report normally; the fixer gets one bus line. A mass failure under AGG mails the fixer and never
opens a runner fault issue or quarantines the PC. A shard that never reported (`pack-shard-N-missing`) still stops the run, unchanged.
Check: mirrorfaultcheck (core).
