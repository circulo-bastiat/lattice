# 10977 — G27c: per-dimension entity / block-entity / fight state

- `World.setDimension` -> `World.swapDimState`: every entity in `EL.list` goes to its own dimension's stash
  (`World.dimState[d].ents`), the new dimension's stash becomes `EL.list`; `BlockEntities.setDim` swaps the
  block-entity store; `EnderDragon.activeFight` is stashed per dimension.
- Save: `mobs` already carried `dimension` (now serialised from `World.allEntities()`); `be` records carry an
  optional `dimension` (absent = overworld). On load, foreign-dimension mobs wait in their stash.
- NOT done: per-dimension time (nether/end have fixed time in vanilla; overworld clock is global), restoring the player
  into a non-overworld dimension at boot (G27b+).
- Proof: `tools/dimstatecheck.mjs`.
