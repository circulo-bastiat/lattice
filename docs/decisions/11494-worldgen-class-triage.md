# 11494 — world/gen class triage (part 1: the 37 classes named in the issue)

Cited now (comments in src): blockpredicate/* in `04j_features.js` (HasSturdyFacePredicate flagged as an approximation, `solid`);
carver/* in `04i_carvers.js`; FlatChunkGeneratorLayer in `04_worldgen.js` (applyFlat). CarvingMask is genuinely not ported (carvers write straight into the column).

Ruled deviation (worldgen is the "cheap" area; Deviation #1 replaced the density stack, D-32/D-64 noise caves):
- BlockSource, ChainedBlockSource, OreVeinSampler, StructureWeightSampler (beard), StructureWeightType, NoiseSamplingConfig,
  SlideConfig (bottom slide is hand-fit in `04b_caves.js`, D-231): part of vanilla's density/aquifer stack, not reproduced.
- Blender, BlendingData: only matter when loading pre-1.18 chunks; MC-Lite has none (identity for fresh worlds, `04d_column.js`).
- BlockColumn, VerticalBlockSample, HeightContext, CountConfig, ProbabilityConfig: Java-side plumbing; JSON configs are decoded inline.

Still open under #11494: the other ~187 classes (feature, foliage, trunk, placementmodifier, stateprovider, heightprovider, random, ...)
are not triaged yet.
