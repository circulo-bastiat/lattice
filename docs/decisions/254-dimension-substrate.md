# 254 — G27a: multi-dimension substrate

- `src/02l_dimension.js` (`NS.Dim`, shared with workers) is `DimensionType.java:78-90` argument for argument
  (overworld, the_nether, the_end, overworld_caves) + `DimensionOptions` keys. 1.18.2 has no dimension_type data
  file (built-in registry); `dimcheck` parses the decomp source, so the table cannot drift.
- RULING: the voxel volume stays -64..256 for every dimension (D-5). `minY/height/logicalHeight` are the
  dimension's vanilla numbers; Nether/End use y 0..255 of the shared volume.
- `World.chunks` is the LIVE dimension's map; `World.dims[name]` holds each store, `World.setDimension` swaps.
- Save: `dims` envelope field (optional, one `encode()` blob per non-overworld dimension, no VERSION bump); the
  overworld stays in `data`. Player `dimension` and mob-record `dimension` are optional (absent = overworld).
- Light: `Light.hasSky()` / worldgen `lightPass` drop the sky channel when `!hasSkyLight`. Worker `init` takes `dim`.
- NOT done here (G27b+): restoring the player into a non-overworld dimension at boot, per-dimension generators,
  portals, entity lists per dimension (entities carry `dimension`; `EL.list` is still one list).
