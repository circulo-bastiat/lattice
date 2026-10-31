# 5367 lockstep evoker: real-server trace is NOT repeatable per salt

Added the `evoker` lane to `LOCKSTEP_ONLY` (tools/referee/chasescen.mjs); `engineZombieTrace(salt,{mob:'evoker'})` already emits 160 rows.
Real 1.18.2 server, SeedAgent salt 0, 3 reps (`run.mjs --mob evoker --salt 0`): repsEqual=false, rep0 vs rep1 first diverge at tick 28
(pos, i.e. after the evoker starts casting/targeting). Per #5108 this is recorded here; the unit falls back to the distribution test.
Dimension not yet isolated (candidate: unpinned Random in spell/fangs/vex spawn, or entity UUID-seeded randoms). Owed: isolate which
Random is unpinned in SeedAgent, then run the 20 salts and tools/stages.d/lockstep-evoker.json with anti-vacuity.
