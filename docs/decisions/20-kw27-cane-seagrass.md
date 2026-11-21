# #20 KW-27 — the "sand overwrites cane's water" was seagrass, and the check miscounted it

At seed 1337 the one "dry" cane base (211,63,100) has `seagrass_river` at its -x cardinal (210,62,100), written by the
seagrass feature. Seagrass holds water (`States.waterIn`, D-168; vanilla `getFluidState` = water), so the cane IS
water-adjacent. No sand is written there; decoration order (disks in step 6, cane in step 9, sorted by step in
`applyChunk`) was already right. `canefeaturecheck` §3 compared against the bare `water` state only; it now treats
any `waterIn` state as wet and hard-asserts zero overwrites (0/101).
