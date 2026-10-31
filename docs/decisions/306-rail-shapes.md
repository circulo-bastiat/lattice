# 306 — G25a: rail shapes

- `src/07zzq_rail.js` (`NS.Rail`) ports `AbstractRailBlock` (onBlockAdded/updateCurves, neighborUpdate,
  shouldDropRail, onStateReplaced), `RailPlacementHelper` whole, `RailBlock.updateBlockState` (the powered T-junction)
  and the rotate/mirror tables of all three rail classes. Placement shape (`placeFacing` 'rail') and `canPlaceAt`
  (survival rule 1) already existed; PoweredRailBlock power stays in `07f_redstone.js` (`updateRails`).
- `World.setBlock` now hands the REPLACED state to `Behave.changed(x, y, z, old)`: `onBlockAdded` fires only when
  the old block differs (vanilla `!oldState.isOf(block)`), and `neighborUpdate`'s source block is the OLD block
  (`World.setBlockState` -> `updateNeighbors(pos, oldState.getBlock())`). A caller that passes no `old` (mock worlds)
  gets no onBlockAdded rather than a guess.
- Kept as vanilla: `rotate(CLOCKWISE_180)` has no north_south/east_west case and FALLS THROUGH to
  COUNTERCLOCKWISE_90, so a 180-turned straight rail comes out perpendicular; removing the upper rail of a slope
  leaves the lower one ascending; placing a redstone block beside a junction does not flip it (the source is the
  air it replaced) — a lever does.
- `Rail.rotate/mirror` have no caller yet: the template path's rotation table (D-187) and `rotateStateReal` (D-188)
  are unchanged.
- `railcheck`: 14 layouts compared cell by cell against a re-derivation of RailPlacementHelper written in the check
  and against hand-pinned shapes, the lever junction, the slope drop, and rotate/mirror parsed from the .decomp source.
