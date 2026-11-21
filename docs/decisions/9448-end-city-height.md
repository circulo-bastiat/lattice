# 9448 — End City start height ignores base_3d_noise

`ST.endHeight(cx, cz)` ports EndCityFeature.getGenerationHeight (min of four WORLD_SURFACE_WG samples at (7,7) and a
rotation-chosen +-5 corner, rotation from `Random(x + z*10387313)`, reject < 60, biome end_highlands/end_midlands).
The End surface is `end/sloped_cheese` slid by the End shape config; RULING (worldgen is the cheap part): `base_3d_noise`
is dropped, so the surface is the island function alone, trilinear over vanilla's 8x4x8 cells. Heights land at y 60-62
instead of vanilla's noisier tops. The piece origin is the chunk centre (+8), as `ChunkPos.getCenterAtY`.
