# #1159 (KW-48c): the mesh worker was started without the per-block occlusion tables

`Jobs.start` posted `reg` to each worker without `canOcclude` / `outlineFull` (nor supportRule, solidMaterial,
groundRule, iceMaterial, ignite/burn odds, sidedLight, luminance). In a worker `States.build` then defaulted
canOcclude = 1 and outlineFull = 255 for every block, so `visOpaque` (D-440, the section-visibility flood's occluder
test) fell back to the collision box: glass, leaves, ice, shulker boxes... (35 of 2,907 sampled states) were full walls.
Worker-built visibility masks therefore cut the flood at every see-through block and the sections behind them were
culled while real geometry sat there. Natural terrain hid it (almost no glass); any placed glass/leaves showed it.

Fix: send the same tables the main thread passes. Check: `tools/livemeshcheck.mjs` (real page, workers on) -- worker
occluder parity for every 7th state, settled-section mesh/vis vs from-scratch truth while flying and editing, and the
flood vs a voxel flood. Without the fix it reports 35 states differing and settled sections with wrong vis masks.
Mesh upload/async ordering (suspects a, c) audited clean: 0 missing / stale / extra over ~3,000 settled sections.
Not covered: WebGPU draw list (suspect d; WebGL2 only here).
