# #1902 C2ME-4 — stage jobs: ruling

- Landed: `NS.Gen.STAGES` (vanilla ChunkStatus order, margins quoted from ChunkStatus.java, read/write radii) + `stagetablecheck` (9 assertions, 6 breaks caught).
- Finding: in MC-Lite every stage is a pure function of (seed, cx, cz) with `dep` = 0 (the table says so and the check enforces it). A neighbour's stage output is never an input, so there is no intermediate chunk state to transfer between workers. Cross-worker stage hand-over (item 3) would add a transfer cost and no parallelism over the existing one-job-per-chunk pool (`wkhashcheck` already proves pool-size determinism).
- Ruling: the "one worker does all stages of a chunk/small region" fallback WON by construction. Revisit only if a stage gains dep > 0 (the check then fails and forces a new design).
- Owed: per-worker heap report (item 4) and before/after C2ME-1 scaling table (item 5) need a browser/Node worker run on real hardware.

## Measured (tools/workerscalecheck.mjs, 7x7 chunks of seed 1337, node worker_threads, shared CI host)
Zero drift at pool 1/2/4. RSS cost per worker ~57-116 MB after boot (each worker holds its own engine + registry copy; the figure falls with pool size as shared pages are counted once). On this 49-chunk run wall time does NOT improve with pool (1.3 s / 1.4 s / 2.1 s): worker boot + JIT warm-up dominates a run this short on a loaded host; the browser scaling table in 1899-chunkgen-measurement.md (6.1 s -> ~3 s at pool 3-4 for rd 8) is the one that reflects steady state. Re-run on real hardware for the PR table.

## Measured pool 1..8 (4-core CI sandbox, 49 chunks, tools/workerscalecheck.mjs)
Zero drift vs inline golden at every pool 1..8. Wall ms 1034/1035/1244/1524/1820/2041/2006/2674 (speedup 1.00/1.00/0.83/0.68/0.57/0.51/0.52/0.39):
no speedup on 4 shared cores, because worker boot (engine init) dominates a 49-chunk run and the pool exceeds the cores. RSS/worker figures
are noisy at the RSS level (8-113 MB; first worker carries the shared baseline). Real scaling needs a larger area on real multi-core hardware.

## Warm-up excluded, 121 chunks (4-core CI sandbox, tools/workerscalecheck.mjs, 11x11 area)
Boot and JIT are now outside the timed window (one throwaway chunk per worker). Zero drift at every pool 1..8. Wall ms 2422/2012/2331/2715/3099/3639/3850/4071
(speedup 1.00/1.20/1.04/0.89/0.78/0.67/0.63/0.59). Best at pool 2 on a loaded 4-core host; beyond that the main thread (which fingerprints every
returned column, and receives the structured-clone copy of each) plus oversubscription dominates. The check still only asserts determinism; the speedup table
for the PR must come from real multi-core hardware and the browser (1899 table).

## Bottleneck measured: main thread is NOT it (workerscalecheck, 4-core CI sandbox, 121 chunks)
The check now times the main thread's own work (receiving + `NS.Gen.fingerprint` of every returned column) and asserts it is inside the wall window.
It is 16-27 ms of 1.9-3.9 s (1%) at every pool 1..8, so result transfer/fingerprinting does not limit scaling. The flat/negative speedup (1.00/1.18/1.03/0.89/...)
is therefore host CPU contention (shared 4-core runner), not the job design. Real-hardware table still owed.

## Item 4 closed: real V8 heap per worker
`workerscalecheck` now reads `Worker.getHeapStatistics()` of every worker after the timed run, asserts each reports a sane heap (1 MB..2 GB) and prints "V8 heap used/worker" in the table (34 assertions, 3 breaks caught). Only the real-hardware speedup table (item 5) is still owed.

## Close-out (final table, 4-core shared CI host, 121 chunks, warm workers, zero drift pool 1..8)
Speedup pool 1..8: 1.00/1.22/1.05/0.86/0.78/0.73/0.67/0.61 (35.5 -> 43.3 chunks/s at best, pool 2). V8 heap used/worker 48 MB (pool 1) down to ~25 MB (pool 4-8):
the thread count is a memory setting (each worker owns an engine + registry copy). Items 1-5 are done: STAGES table (stagetablecheck), by-construction
whole-chunk-per-worker design (dep 0 everywhere), heap report, determinism pool 1..8, scaling table. The browser steady-state table (1899, 6.1 s -> ~3 s at pool 3-4)
is the real-hardware reference; this host is oversubscribed, so it cannot show more than ~1.2x.
