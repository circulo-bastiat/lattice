# 7216 — blaze lockstep: compare after target acquisition

The server's SeedAgent-seeded java.util.Random and the engine's LCG stream(salt) cannot agree on ActiveTargetGoal's nextInt(10) roll,
so the engine acquires its target on a different tick than the server. RULING: in the server comparison of `tools/lockstep-blaze.mjs`
the engine is driven from the server's observed first-target tick k (`engineBlazeTrace(..., {acquireAt: k})`: held NoAI until k-1,
then aggroed). The comparison covers everything after acquisition. Salt 0: ticks 0-3 now identical; first divergence is tick 4
(pitch engine 0 vs server -0.47, pos y 0 vs 0.0351) — a separate look/flight bug, not acquisition timing.
