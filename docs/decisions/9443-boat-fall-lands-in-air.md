# 9443: a boat sliding off a ledge lands IN_AIR, so it does not break

G17-L72a-3 (unit 3 of #6359). From `.decomp` `BoatEntity.fall` (:786) and `tick` (:268): `location` is computed at the START of the tick
(`checkLocation`), the landing happens in that tick's `move`, so a boat falling onto stone has `location == IN_AIR` when it lands and
`fallDistance > 3` takes the `onLanding()` branch: no fall damage, no `kill()`, no drops, the passenger stays seated (pig Health 10).
Over water `fallDistance` stops accruing at the surface (`!fluidState(blockPos.down()).isIn(WATER)`), and the boat re-enters as IN_WATER and floats.
Lanes `boatfallland` / `boatfallwater` (lanes.d: ledge 5, Motion 3.0 +x so the slide clears the shelf, pig passenger, `paxhp` logs the pig's Health,
`lowpool` floods only the low floor). Engine check `lockstep-boatfall` (20 salts x 2 lanes, 5 breaks caught). The local referee server cannot start in
this runner, so the per-tick server rows were not read; the mirror pilot proves the real server repeats itself per salt.
