# #7690 — Why are worker runs getting shorter?

Measured from `origin/metrics:metrics.json` (worker rows only, 22–26 Oct 2026, 504 runs).

| day | runs | median turns | landed | partial | already-fixed | gave-up |
|---|---|---|---|---|---|---|
| 22 Oct | 163 | 11 | 105 | 32 | 23 | 3 |
| 23 Oct | 173 | 10 | 130 | 25 | 16 | 2 |
| 24 Oct | 63 | 7 | 55 | 1 | 3 | 4 |
| 25 Oct | 81 | 7 | 67 | 2 | 12 | 0 |
| 26 Oct (part) | 24 | 9 | 15 | 2 | 6 | 1 |

Finding: the short runs are not early quits. `gave-up` stays at 0–6% and the other 94%+ are landed
or already-fixed. They are short because the issues are small (one check or one table each,
"still small sessions", 29 Sept) and the TURN BUDGET (#5010: land by ~30 calls, hard stop 60)
now ends a run at the first tested part. The median fell from ~11 to ~7 turns as `partial`
dropped from ~18% to ~2%: fewer issues are split, so fewer runs go back for a second part.
Cost per run falls with it (avg cache-read 340k → 215k tokens), so this is the intended effect
of the budget, not a defect. No code change; `already-fixed` (about 10%) is the only waste
and is owned by the claim filter.
