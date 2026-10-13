# 4986 — Lockstep against the real 1.18.2 server: which RNG sources can be pinned (G17-L0 spike)

Runner: OpenJDK 17.0.20.1 (2026-08-18). Tools: `tools/referee/lockstep/{SeedAgent.java,Probe.java,run.mjs}`,
check `tools/referee/lockstepcheck.mjs` (stage `lockstepcheck`). `server.mjs` takes `MCLITE_JVM_ARGS`; `runchase.mjs`
takes `MCLITE_CHASE_ONLY` / `MCLITE_CHASE_OUT`.

## What was built and measured

`SeedAgent` is a `-javaagent` that retransforms `java.util.Random.<init>()` (JDK-internal ASM, `--add-exports`
needed; `Boot-Class-Path` puts the helper on the bootstrap path). `Random()` is `this(seedUniquifier() ^ nanoTime())`;
the agent replaces `nanoTime()` with `0` and `seedUniquifier()` with `SeedAgent.seed()` = hash(thread name, calling class,
per-(thread, class) construction count, `-Dmclite.lockstep.salt`).

| Setting | Result |
|---|---|
| Plain JVM probe (`lockstepcheck`), same salt twice, main + named worker thread | identical; other salt / no agent differ (3 breaks caught) |
| Real server, zombie lane (chasescen), no agent | rep0 trace differs run to run (2 runs, 2 hashes) |
| Real server, global counter only (first agent) | not pinned: the construction order across threads leaks in |
| Real server, per-(thread, class) seeds, salt 0, 6 runs | rep0 trace identical in **5 of 6**; 1 run started chasing ~10 ticks later |
| Real server, salt 7, 2 runs | two different rep0 traces (so the salt does steer the mob) |

Later reps in one process (rep 1, 2) always differ from rep 0: the per-class counter has moved on. They are
reproducible only in sequence from a fresh process.

## Verdict by RNG source

Can be pinned (agent, zero server patching):
- every `new java.util.Random()` — `Entity.random` (mob AI: `NearestAttackableTargetGoal` interval, stroll, look),
  all goal/navigation/loot Randoms. Pinned as a function of (thread, constructing class, nth), NOT of wall time.

Cannot be pinned by this agent (not shown to be the cause of the 1-in-6 miss, but unproven either way):
- `ThreadLocalRandom`, `Math.random`, `SecureRandom` / `UUID.randomUUID` (the summoned mob's UUID), `SplittableRandom`:
  different classes, different hooks. Not instrumented in this spike.
- Thread-timing effects that are not RNG: RCON/bot join order, chunk-load completion, the tick phase at which the
  summon lands. Whatever causes the 1-in-6 outlier is one of these or an un-hooked source.
- Per-class counters assume the same prior construction history on the server thread; any extra entity or
  differing command sequence before the summon shifts every later seed. Lockstep needs the scenario script
  byte-identical, from a fresh process.

## Ruling for G17 (#4984)

1. Deterministic dimensions (movement integration, pathing given a fixed target, damage, drops without RNG): compare
   by lockstep traces from a fresh server with the agent, taking the mode of 3 runs (a single run is 83% reliable here).
2. Everything that draws from a Random whose seed we cannot reproduce in the engine (the engine's RNG is not
   `java.util.Random`-seeded identically in any case): distribution test, KS / chi-square over >= 2000 runs.
   Lockstep against the server does NOT mean the engine consumes the same stream; it only makes the SERVER side
   repeatable so a golden is stable.
3. Do not build a patched server jar from `.decomp`: the agent reached 5/6 with no source changes, and the jar is
   obfuscated, so name-based hooks (`Entity.<init>`) would need mappings.

Next, if tighter than 5/6 is required: add hooks for the sources listed above, and log which RNG
constructor/call sites fire between summon and tick 40 in a miss vs a hit to find the leak.

## #6223 (G17-L18): ThreadLocalRandom and Math.random hooked

`SeedAgent` now also rewrites `ThreadLocalRandom.nextSeed()` and `Math.random()` to `SeedAgent.tlrSeed()/mathRandom()`: the
n-th draw is a function of (source, thread, calling class, n, salt). `-Dmclite.lockstep.nohook=true` leaves them un-hooked (the
check's break). `-Dmclite.lockstep.log=<file>` appends one line per first-seen (source, thread, class) with ms since agent start,
for diffing the call sites that fire between summon and tick 40. `lockstepcheck` probes 20 draws of each in main and a named thread (twice).
Still un-hooked: SecureRandom/UUID, SplittableRandom.
