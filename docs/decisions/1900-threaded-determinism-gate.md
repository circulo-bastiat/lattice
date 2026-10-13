# #1900 C2ME-2 — the determinism gate (lands before any speed-up, stays forever)

`tools/wkhashcheck.mjs` hosts the REAL `src/workers/chunk.worker.js` in node `worker_threads`, generates a region at pool 1/2/4/8
(shuffled dispatch, a different shuffled delivery order, and once with a worker terminated mid-region and its job restarted), fingerprints each chunk
ON ARRIVAL with the engine's own `NS.Gen.fingerprint`, and compares to the inline golden of #1899. Zero drift; drift names the chunk.
Core = 7x7 of seed 1337 (~10 s). `WKHASH_FULL=1` = 21x21 of all three seeds (~2.5 min) for the full suite.

## What reaches into neighbours today (the safe delivery radius)
| stage | reach | how |
|---|---|---|
| carvers | 8 chunks (`CV.RANGE`) | source chunks within 8 re-walked for the target, kept where they land in it |
| features | 1 chunk (`F.RANGE`) | the 3x3 of source chunks' placements re-run for the target |
| structures | starts/references up to 8 (`set.reach`) | recomputed per target, pieces clipped to it |

None of them READS a generated neighbour: `genColumn(cx,cz)` is pure in (seed,cx,cz) (D-61), so MC-Lite's safe delivery radius is **0** — a chunk is
complete when its own job ends, unlike MineHTML's cursor-ordered generation (`shipIndexFor`). The gate keeps that true: a stage that starts depending on
a neighbour's output delivers a wrong chunk early and drifts here.

## The two rules from MineHTML s168
- Fingerprint AT INSTALL: `World.installChunk` records `NS.Gen.fingerprint(res)` into `World.wkHashes` first thing, before Save edits / fluid wakes / ticks, only with `?wkhash=1` (one boolean test when off).
- The referee is the inline golden (made single-threaded by a different path), and the check pins engine fingerprint == tools `hashColumn` == golden entry, so the two sides cannot share one wrong assumption.

## Anti-vacuity
A worker patched to skip features for chunk (3,-2) (one stage too early) must be reported as exactly that chunk; a missing chunk, two swapped chunks and a one-block flip are each caught.
