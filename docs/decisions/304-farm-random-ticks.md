# #304 — G24a: bamboo, cocoa, sweet-berry random ticks; the crop light gate restated

**Ported** (src/07b_behaviour.js, from .decomp 1.18.2): `BambooBlock.randomTick`/`updateLeaves`/`countBambooBelow`,
`BambooSaplingBlock.randomTick`/`grow`, `CocoaBlock.randomTick`, `SweetBerryBushBlock.randomTick`, plus the two
`getStateForNeighborUpdate` halves bamboo growth depends on (sapling -> bamboo when bamboo is above; a stalk takes the
age of a thicker stalk above), in `updateShape`.

**The light gate, from .decomp, not the phase text.** `CropBlock.randomTick` grows only at
`getBaseLightLevel(pos, 0) >= 9` on the crop's OWN cell; `CropBlock.canPlaceAt` keeps a crop alive at `>= 8` OR open
sky. So "light 8 grows, 7 does not" is wrong: at 8 a crop stands and never grows, at 9 it grows, at 7 under a roof it
breaks on its next neighbour update (02k rule 15 already had this). Sweet berries and bamboo read the cell ABOVE;
cocoa has no light gate. The real server agrees (growthrefcheck `wheat_light8`: 49 of 49 at age 0 after 2400 ticks at
randomTickSpeed 256; `wheat_light9` matures).

**Cane/cactus audit.** `tickColumnPlant` matches `SugarCaneBlock`/`CactusBlock.randomTick` (no draw, no light, air
above, `h < 3`, age 15 wraps and places); columnrefcheck already referees both, so they are not duplicated in
growthscen (its swap probe is the one that failed for columns).

**A scenario bug found on the way.** growthscen cleared its GY layer to air, so every WATER_4 source flowed across it,
into `wheat_dry`'s own chunk: the server's "dry" plot was partly hydrated (mean age 2.92 at tick 400 where 1-in-13
predicts ~1.9). The layer is now stone (only farmland counts in `getAvailableMoisture`); the server's dry plot now
reads ~2.0, in line with the engine.
