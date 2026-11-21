# #248 G26c — advancement data, manager, positioner

- `tools/pack-advancements.mjs` packs all 1,141 `data/minecraft/advancements/**.json` (1,046 recipe unlocks + 95 displayed tab advancements, 6 roots) into `advancements.bin` (30 KB deflated), validated by `Advancement.Builder.fromJson`'s rules; criterion conditions stay raw JSON for the trigger layer (G26d).
- `src/02l_advancements.js` (main only) ports Advancement/Display/Frame/Criterion/Rewards/Merger/Progress/Manager/Positioner. Positioner floats go through `Math.fround`.
- RULING: load order is Java `HashMap<Identifier,…>` iteration order (`hashOrder`), because it fixes the order of `Advancement.children` and therefore sibling rows. Ties inside one bucket keep jar order (vanilla's depends on resource listing; unobservable).
- No JVM here, so "positioner equals vanilla" is proved by a line-for-line float32 port plus invariants (x==depth, siblings/columns >=1 row apart, top row 0, float-representable rows) and an independent BigInt oracle for hash and build order, not by diffing vanilla output.
- `advancementcheck` breaks the module source and the data and must catch every break (8).
