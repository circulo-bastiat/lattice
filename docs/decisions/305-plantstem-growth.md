# #305 — AbstractPlantStemBlock growth (kelp, twisting/weeping vines, cave vines)

**Engine.** `src/07b_behaviour.js` ports AbstractPlantStemBlock / AbstractPlantBlock and the four subclasses as one
table (`STEM_FAMS`: head, body, direction, growthChance, getGrowthLength, chooseStemState, berries):
the random tick (`age < 25 && nextDouble() < chance`, `age()` = cycle(AGE), cave vines roll BERRIES < 0.11),
the head/body swap in `updateShape` (getStateForNeighborUpdate, recomputed from the growth-direction cell),
`getRandomGrowthState` on placement and when a body loses its head, and the Fertilizable pair
`Behave.plantStemFertilizable` / `Behave.plantStemGrow` (VineLogic length, findColumnEnd) for the bone-meal unit.
`src/14l_use.js` has CaveVines.pickBerries. Proof: `tools/plantstem.mjs` (age 25 caps a column at 26 cells).

**Referee (growthscen / growthrefcheck).** Two `kind: 'stem'` scenarios (kelp, weeping_vines) compared by column
length. Three layout findings, all in growthscen.mjs's comments:
- scenarios 9+ go in a SECOND ROW (z chunk 1): kelp at x chunk 9 never random-ticked, bot or not;
- the setup clear is per scenario: one box over 10 chunks passes `fill`'s 32768 limit and failed silently
  (rungrowth now notes "Too many");
- the GY layer is reset to GRASS, not air: over an air GY, `wheat_moist`'s water spread 7 blocks and hydrated
  half of `wheat_dry`'s farmland on the server, which is why the old golden's wheat_dry ran ~1.3 mean ages ahead
  of the engine (just inside tolerance).
The store's growth-timing.json predates this; growthrefcheck SKIPs a scenario missing from the golden until
`node tools/referee/rungrowth.mjs` is re-run (JAVA 17: `JAVA_HOME=...`) and the golden re-published.
