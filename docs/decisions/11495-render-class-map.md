# #11495 — client/render classes the class map listed as missing (first 40)

Ruling: the governing principle makes **rendering cheap** (method need not match; picture must). Vanilla's render plumbing
(vertex formats, buffer builders, consumers, layers, chunk builder/region, occlusion graph, BE dispatcher) is therefore
**replaced, not ported**. Each class is cited in the src module that does its job:

| Classes | Where | Verdict |
|---|---|---|
| BlockModelRenderer, BlockRenderManager, ChunkBuilder, ChunkRendererRegion(+Builder), RenderedChunk, BlockBufferBuilderStorage, BuiltChunkStorage, DiffuseLighting | 05_mesher.js | replaced by greedy mesher over a 27-section snapshot |
| ChunkOcclusionData(+Builder) | 05_mesher.js / 10_camera.js | out of scope: no cave-visibility graph; frustum + face culling (render-only) |
| BufferBuilderStorage, BufferRenderer, *VertexConsumer*, VertexConsumers(Provider), Tessellator, VertexFormat(+Element,s), RenderLayers, FogShape, ChunkBuilderMode | 10_gfx.js | replaced by packed vertex layout + 2 backends |
| RenderTickCounter, FpsSmoother | 17_main.js | frame clock + Profiler ring |
| MapRenderer | 07pm_mapcontent.js | data ported, drawn by HUD/hand code |
| BlockEntityRender* (4), LightmapCoordinatesRetriever, SkullBlockEntityModel, StructureBlockBlockEntityRenderer | 15h_bemodel.js | table of BE models; structure-block box not drawn (deviation) |
| ArmorStandEntityRenderer, ArrowEntityRenderer | 07zzt_armorstand.js, 07j_entityrender.js | drawn from entity state |
| debug/NameGenerator | — | debug HUD helper, out of scope |

Nothing here is gameplay; no behaviour changes. The remaining ~90 classes in the issue's list (entity renderers/models, baked
models) are not in its first-40 triage and stay with #11465.

## Part 2 — the remaining 90

Entity renderers/features/models (07j_entityrender.js) and the baked-model/JSON-model/item-model pipeline (06_atlas.js) are
**replaced, not ported**: mobs are box-part shapes drawn from entity state; block geometry comes from the state table and
mesher; there is no resource-pack model loading in a single-file build. Rendering is the "cheap" area; no gameplay behaviour changes.
