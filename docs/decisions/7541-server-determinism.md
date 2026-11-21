# #7541 real-server determinism: sources of run-to-run variation

Found by diffing the SeedAgent draw logs (`-Dmclite.lockstep.logall`) of two fresh zombie salt-2 runs:

1. **Entity draw counters shared across threads.** The `ent|<class>` key (D-7440) had no thread, so a villager built by
   structure worldgen on a `Worker-Main-N` thread advanced the same counter as one built on the Server thread
   (`ent|bnw` = VillagerEntity: `#1` in one run, `#4` in the other). Pinned: non-summoned entity keys now carry the
   normalised thread name unless it is the Server thread (SeedAgent.next).
2. Already pinned earlier: pool-thread numbers (`Worker-Main-6` vs `-10`), `java.*` helper frames, summon vs. non-summon entities.

Not yet done: the 6 mobs x 3 salts check (`tools/stages.d`) and the pilot re-runs; the salt-2 positions matched in
this one sample, so the flake is intermittent and needs repeated pilots to confirm.

## Update (second session)
- drowned salt 2 and silverfish salt 2 are still bimodal (drowned hashes are always one of `b66671da…` / `d4b76d3d…`); ocelot 2 and zombie 2 now agree.
  The two drowned traces differ by a one-tick start offset (the mob's first move is a tick earlier), and the draw logs differ by a few
  `Server thread|axy`, `ent|bli` and `Worker-Main-#|bbq` draws, so the cause is timing-dependent entity/chunk activity, not the Random seeds.
- Added (SeedAgent `lockstep-idpin` thread + runchase writing `repNarm` to the reset file just before the arm): the global entity id counter
  (`axk.c`, Entity.CURRENT_ID) is re-based to 1000000 so id parity at spawn no longer depends on stray entities. It did NOT remove the
  drowned/silverfish bimodality, so the id parity is not the (only) cause: next suspects are `server.getTicks()` vs gametime phase and
  drowned/silverfish goal start timing. Next step: diff the per-tick Pos and `ENTX` lines of an `a`/`b` pair.
- Still owed: the 6 mobs x 3 salts stage with breaks caught, pilot re-runs for all six lanes, and the comments on the dependent issues.

## Ruling (commander, 15 Oct, third unblock): this is a research tracker, not a prerequisite
- Dan's #7474 ruling already handles a server-unstable salt: `pilotplan.planTasks` excludes a salt whose two real-server runs differ and
  runs the next one. Pilots for drowned, silverfish and the other lanes have since landed with `divergences []` and the unstable salts listed
  (e.g. drowned 2,19; donkey 19; horse 15,16,19). So no lane waits for the server to become repeatable.
- The issue kept being claimed, then handed off in ~10 s with "no new code": the remaining hunt (diff per-tick Pos of an a/b pair at ~110 s per
  server run) does not fit one worker session, and `go.mjs done` counts every unfinished hand-off, so it re-blocked after 3.
- Therefore: #7541 is labelled `tracking` (not claimable, not `blocked`), and the seven issues that carried `Depends on: #7541`
  (#7391 #7361 #7265 #7264 #7186 #5247 #5108) were closed as covered by #7474. The open question (drowned/silverfish salt 2 one-tick start
  offset) is unchanged and stays recorded above for whoever has a host with quiet CPUs.
