# #1292 zombified_piglin angry speed boost / angry sound — already fixed

Both halves are on master: ATTACKING_SPEED_BOOST (+0.05 ADDITION, adults only, while angerTime > 0) is in
`Ai.movementSpeedOf` (src/07k_goals.js, #1218, covered by `zpiglinspeedcheck`: 7 assertions, 3 breaks caught);
the angry sound delay (0-20 ticks on target null->set, volume*2, pitch*1.8) is `Undead.tickAngrySound`
(src/07zk_undead.js, #1220, covered by `hostilesoundcheck`). No code change.
