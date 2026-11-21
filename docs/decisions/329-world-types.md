# #329 — World Type: Default / Large Biomes / AMPLIFIED

**Ruling.** Vanilla's `GeneratorType.LARGE_BIOMES` and `AMPLIFIED` are the noise generator reading other
data, so they are parity, not worldgen deviation. `Column.init(seed, worldType)` selects
`noise_settings/{overworld,large_biomes,amplified}`; large biomes also swaps continents/erosion/temperature/
vegetation to their `_large` noises (`DensityFunctions.method_41209(shape, true)`), each seeded by its own id.
It is a world-creation setting like the climate (D-111): `Save.worldType` (absent = `default`), `Gen.params.worldType`,
and a "World Type: …" cycling button on the title screen (click forward, shift-click back, locked once a world exists,
`generator.amplified.info` shown while AMPLIFIED is chosen).

**Facts that are easy to get wrong.**
- The amplifier is applied **per spline constant** (`Spline.Builder.add(loc, float, deriv)`), not to the finished value.
  `amplified.json`'s `terrain_shaper` already holds `createSurfaceParameters(true)`, so nothing is recomputed. `offsetAt`
  is exactly 2x the default only ON a positive constant; between a negative and a positive constant it is not.
- The factor spline's first two continents points (-0.19, -0.15) are built with the identity amplifier.
- Superflat, single biome and debug are separate generators and are not offered.

**Not ported.** Amplified's slide changes (top-slide offset 0, bottom-slide target 0.4): MC-Lite has no top slide
(its world ends at y=255, D-19, so amplified peaks are clamped there) and its cave floor taper (D-231) does not model the
slide target.

**Checks.** `colcheck` §6 compares each world type against the SOURCE rule (default tree + amplifier), not against
`amplified.json`, and against independently seeded `_large` noises; 4 breaks. `titlecheck` drives the button's cycle
and plays a Large Biomes world (workers sent the type, main-thread Column runs it, save round trip).
