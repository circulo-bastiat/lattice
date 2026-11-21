# #2754 hoglinrefcheck vs server: findings (no engine change)

- The check compares ONE seeded engine run against 2 server reps. The server's own reps differ by 2-8 blocks
  (dist9: one rep flees at 0.6 b/s, the other 3.5 b/s, both via random wander into the 8-box; dist8: speed n/a)
  while FINAL_TOL is 1.5 b and speed TOL 5%. Engine cruise 3.96 b/s is within 2% of the server's best cruise (3.87).
- So most of the 13 reds are RNG noise, not an engine rule difference. Next step: raise REPS (runhoglin.mjs) and derive
  tolerances from the server spread / compare distributions; dist9 needs the stroll model (StrollTask 0.4, RandomTask) checked.
- Only vert4 (engine 1.72 vs server 2.9-3.0 b/s) looks like a genuine pathing difference (flee target 4 up).
