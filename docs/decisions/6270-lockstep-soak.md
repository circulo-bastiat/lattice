# 6270 lockstep soak (12 mixed mobs, 3000 ticks)
Landed: `tools/referee/lockstep/soak.mjs` (summon list, neighbours, report table, spawn-shift break), `soaktracecheck`;
real-server capture (#9446, `soakcapture`); engine run + measured first-divergence table (#9447, `soakdivcheck`, 14 breaks caught).
The table is in `9447-soak-divergence-table.md` (10 of 12 mobs differ in lifetime). The check is `soakdivcheck` (the id `soakcheck` is the flight soak).
OWED: diagnosis of each lifetime loss, and a richer capture (position/health) so divergence is visible before removal.
