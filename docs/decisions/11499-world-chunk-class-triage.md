# 11499 — world/chunk class triage (30 classes)

Ported without citation (now cited in `src/03_section.js`): the section codec IS the palette container (D-16..D-19):
Palette/ArrayPalette/BiMapPalette/IdListPalette/SingularPalette/PalettedContainer/PaletteResizeListener/EntryMissingException/ChunkSection
(plain-object Section: palette + bit-packed Uint32 words, 1/2/4/8/16 bits, single-value sections), ChunkNibbleArray (light nibbles, D-18 sky high/block low).

Ruled OUT of scope (rendering/lighting is the cheap part; single-player, no server chunk pipeline): LightingView, ChunkLightingView,
LightStorage, BlockLightStorage, SkyLightStorage, ChunkToNibbleArrayMap, LevelPropagator, ChunkBlockLightProvider, ChunkSkyLightProvider
(MC-Lite uses its own cheap propagation, not the vanilla level-propagator); ChunkManager, ChunkProvider, ChunkCache, ChunkStatusChangeListener,
ReadOnlyChunk, EmptyChunk, WorldChunk, ProtoChunk (World/worker job system replaces the server chunk-status pipeline);
UpgradeData, BelowZeroRetrogen (old-world upgrade/retrogen, no pre-1.18 saves exist); BlockEntityTickInvoker (block entities tick in 07c_blockentity.js).
