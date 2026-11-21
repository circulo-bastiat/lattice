# #339 — redstone dust stores its connections (north/east/south/west = none | side | up)

Ported from `RedstoneWireBlock` (.decomp) into `src/07f_redstone.js`: `Rs.wireShape` (getPlacementState(world, seed, pos)),
`Rs.wirePlace` (placement from the cross), `Rs.wireNeighbourShape` (getStateForNeighborUpdate), `Rs.wirePrepare`
(prepare: the diagonal wires), `Rs.wireUse` (onUse + updateForNewState). Hooked from `Behave.place`, `Behave.updateShape`
(which now takes `from`, the direction to the changed neighbour; `changedInner` passes it), `changedInner` (prepare for the
old and the new state) and `Use.blockUse`.

- **The dot/cross is state, not geometry.** `Rs.wireSides` (the weak-power sides) now reads the STORED state through
  `wireShape`, as vanilla's `getWeakRedstonePower` does: a PLACED lone dust is a cross and powers all four sides; a
  right-clicked (or /setblock'd) dot powers none. Before #339 every lone dust behaved as a dot.
- **The raw side test is vanilla's `getRenderConnectionType`**: the climb asks `canRunOnTop` (sturdy top or hopper), not
  `isRedstoneConductor`, so dust climbs glass and top slabs; UP vs SIDE is the side block's sturdy face toward the wire.
- **`prepare` asks wire only.** Vanilla calls `getStateForNeighborUpdate` on every non-observer block diagonal to a
  connected side; every other block answers its current state from a direction whose neighbour did not change, and this
  engine's non-wire `updateShape` is non-directional, so asking them would only risk re-deriving unrelated state.

Check: `tools/wireshapecheck.mjs` (expected shapes derived by hand from the decomp; no referee capture yet — a runner
placing dust with the growbot and right-clicking it would make it a referee check).
