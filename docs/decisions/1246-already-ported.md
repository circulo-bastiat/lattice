# #1246 zombified_piglin anger passing / angry sound — already ported

Filed as unported; master already has both parts:
- `Ai.ZombifiedPiglinAngerPassingGoal` (src/07k_goals.js, #1219), proven by `zpangerpasscheck` (3 breaks caught).
- `Undead.tickAngrySound` (src/07zk_undead.js, #1220), proven by the piglin angry-on-target case in `hostilesoundcheck`.

No code change. Note: `hostilesoundcheck` run alone with `--only` fails 2 husk/zombie_villager hurt/death
assertions on a clean tree (unrelated to piglins; likely needs generated data stages).
