# 8083 — end_crystal sheet is 128x64 under a 64x32 model: vanilla, not a bug

.decomp `EndCrystalEntityRenderer` uses `textures/entity/end_crystal/end_crystal.png` with `TexturedModelData.of(…, 64, 32)`.
The jar PNG is 128x64. Vanilla normalises UVs by 64x32, so the whole sheet is sampled at 2x resolution. The engine's
tile packer (`tools/pack-mobtex.mjs`, scale `sx/sy` = sheet/model) does the same, and `mobl3check` (halved reference, #5847)
compares the raster. `mobtexproofcheck` therefore expects exactly 2x for `end_crystal` (`HIRES`); any other size still fails.
