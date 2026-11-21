# 256 — G27c: Nether terrain

- `src/04yn_nether_terrain.js` (`NS.NetherTerrain`, shared with workers) ports `createNetherSettings()`: shape config
  (cells 4x8, sampling 1/3/80/60, top slide 0.9375/3/0, bottom slide 2.5/4/-1), `old_blended_noise`
  (InterpolatedNoiseSampler: 16+16+8 legacy octaves from `LegacyRandom(seed)`, y-smear), Y-then-X-then-Z cell
  interpolation, solid iff density > 0 (`squeeze` and `* 0.64` keep the sign), lava below sea level 32 (y < 32).
- Surface: `createNetherSurfaceRule` by hand (bedrock gradients on the legacy deriver, y >= 123 netherrack, basalt
  deltas, soul sand valley, nylium/wart, wastes soul sand/gravel, lava on holes). Noises use the legacy deriver
  (`LegacyRandom(seed).nextLong()`; `createRandom(name)` = `hashCode(name) ^ seed`).
- Biomes: legacy temperature/humidity (`createLegacy`, -7, [1,1], seed and seed+1) into `BiomeDims.netherBiome`.
- RULING: the surface rules read the biome of the 4x4 quart cell, not through BiomeAccess's SHA-256 voronoi zoom.
- NOT done (owed): hook on `Dim.current()` in the chunk pipeline (`WG.generate` still builds the overworld),
  Nether carver/features/structures, and a REAL-SERVER golden for the density (the pinned hash in
  `netherterraincheck` is a regression pin of this port, not vanilla proof).
