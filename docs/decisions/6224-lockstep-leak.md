# 6224 — G17-L19: what leaks into the 1-in-6 lockstep miss (PARTLY found)

Tools: `lockstep/SeedAgent.java` (`-Dmclite.lockstep.log=<file>`, new `-Dmclite.lockstep.logall=true`, new `-Dmclite.lockstep.noleakfix=true`),
`lockstep/run.mjs` `runLane({logFile})`. Salt 0, zombie lane, real 1.18.2 server, ~50 s a run, rep0 hash per run.
Note: on a busy runner the miss rate was nearer 1 in 2 than 1 in 6 (two other sessions shared the box); the miss is timing-sensitive.

## Named leaks (fixed in SeedAgent)

1. **Pool-thread names.** `Worker-Main-6` in one run, `-10` in the next: which worker runs a chunk-gen task is scheduler timing, and the
   seed was keyed by thread name. Names now lose their trailing digits (`Worker-Main-#`).
2. **java.* helper frames** (`Collections.shuffle`) were the "calling class", so one counter was shared by every caller on the thread. Frames
   under `java.` are now skipped.
3. **Entity/LivingEntity counters (`axk`/`axy` = Entity/LivingEntity, via `.decomp/names.tsv`).** Every entity's constructor draws from the
   same (Server thread, Entity) counter, including worldgen/chunk-load mobs, which are built on a worker or inline on the Server thread
   depending on timing (a miss run had 2 extra `Entity` draws on the Server thread). The summoned zombie was "the nth Entity". Draws under
   `SummonCommand` (`acd`) now have their own counter, so the zombie is "the nth summoned entity".

After 1+2 the call-site set (first-seen log) was identical in hit and miss, so site SETS are not the leak; after 3 the per-draw logs of a hit
and a miss were byte-identical (`diff` empty) and **the rep0 traces still split in two** (5 distinct values became 2, 3 of 10 in the other mode).

## What remains (owed)

Hit and miss draw the same random numbers in the same order, yet the mob starts moving at tick **21** (hit) vs **22** (miss): a one-tick
phase shift, not an RNG source. Suspect: the tick at which the RCON-run `spawn` function lands relative to the datapack tick function and the
level tick (`Mob.serverAiStep` runs `goalSelector.tick()` on `tickCount % 2` parity, so a one-tick landing difference moves everything).
Next step: have `runchase` wait for a tick boundary (poll `#t`/`gametime` and issue `spawn` right after it changes), or run the summon
from the tick function itself, then re-measure 12 runs.

## Re-measure (29 Oct) — closes the owed item

The one-tick summon phase is already handled: `runchase.mjs` arms the `spawn` function for a tick whose `gametime % 20 == 0` (#6623), and
`lockstepleakcheck` now pins that too. Salt 0, zombie lane, real 1.18.2 server, SeedAgent with the leak fixes: **12 runs, all rep0 hashes equal**
(`44f6b71aeb08`; 4+5+3 runs). (Reps 1+ legitimately differ between runs; only rep0 is the lockstep reference.)
With `-Dmclite.lockstep.noleakfix=true` (now reachable from `run.mjs` via `MCLITE_LOCKSTEP_EXTRA`) 5 runs gave one stable but different hash
(`5abf9cd5337c`): the fix changes the seeding, but the original 1-in-6 miss did not recur in 5 runs on this quiet runner, so the
"reverted fix reports >1 hash" half is shown by the source check's breaks, not by a live repro.
