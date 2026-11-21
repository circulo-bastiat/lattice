# #258 — End terrain: base_3d_noise dropped (RULING)

`src/04za_end.js` ports the End's `end_islands` density (exact, simplex seeded 0, Java `/8`), the End slides
(cells), 0.64 squeeze, end-stone fill, sea level 0. `base_3d_noise` (the small ripple on island surfaces) is NOT
added, as the overworld column drops it (PLAN W0 deviation #1): worldgen is the cheap half of the charter.
Features ported verbatim from .decomp: EndSpikeFeature (equals `ED.buildCrystalRing`, asserted by endterraincheck),
EndPortalFeature (podium / open exit portal), EndGatewayFeature, ChorusPlantFeature + ChorusFlowerBlock.generate.
Not done: no real-server End golden exists, so vanillacheck has no End chunks yet; dispatch from `WG.generate` on the
End dimension; the EndGatewayBlockEntity exit data; the end_island feature (small end-stone blob) and chunk-level
decoration ordering.
