# 9447 soak divergence table (G17-L38b, part of #6270)
Server: `tools/referee/lockstep/soakcapture.mjs --salt 0 --one` (seed 9446, 12 mobs of `soak.mjs`, 3000 ticks, noon, difficulty normal, no natural spawning), stored run-length coded
in `lockstep/golden/soak9446.json` (every mob's ENTX row is constant while it lives: type, conversion -1, no effects). Engine: `lockstep/soakengine.mjs` (stone plain, same x/z, persistent, no player nearby).
Compared by `tools/referee/soakdivcheck.mjs` (field `entities`). A mob's trace ends when the entity is removed, so the first divergence is the tick one side lost the mob.

| mob | id | first divergent tick | field | meaning |
|---|---|---|---|---|
| 0 | zombie | 393 | (length) | server loses it at 393 (daylight burn / death); engine keeps it to 3000 |
| 1 | villager | 2344 | (length) | server loses it at 2344; engine at 2937 |
| 2 | skeleton | 237 | (length) | server loses it at 237; engine never |
| 3 | wolf | 268 | (length) | server loses it at 268 (killed by a neighbour); engine never |
| 4 | creeper | 903 | (length) | server loses it at 903; engine never |
| 5 | cat | 2074 | (length) | server loses it at 2074; engine never |
| 6 | cow | 1594 | (length) | server loses it at 1594; engine never |
| 7 | cow | identical | | |
| 8 | sheep | 451 | (length) | engine loses it at 451; server never |
| 9 | sheep | 1963 | (length) | engine loses it at 1963; server never |
| 10 | pig | 2611 | (length) | server loses it at 2611; engine never |
| 11 | chicken | identical | | |

Reading: ENTX carries only type/conversion/effects, so the only observable divergence is entity lifetime; 10 of 12 differ. The cause of each loss (sunburn in the engine's skyless stub world,
mob-vs-mob attacks, fall/suffocation, the engine's sheep/villager deaths) is NOT diagnosed here: it is the work this table hands on. Position/health fields need a richer capture (owed).
Anti-vacuity: moving one mob's engine spawn by 1 tick diverges that mob at tick 2 for all 12 mobs, and changes neighbours' engine traces (22 neighbour moves over the 12 shifts); a truncated capture is caught.
