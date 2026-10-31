# #5524: player_slim has no server entity; its lockstep lane is the `player` lane (ruling)

`player_slim` is the client's slim-arm skin model of the server entity `player` (`net.minecraft.world.entity.player.Player`).
The model choice is client-only: hitbox, attributes and movement are the `player` entity's. `EL.spawn` has nothing to spawn for it,
so `tools/referee/chasescen.mjs` cannot have a `player_slim` lane and `pilot.mjs --lanes player_slim` cannot exist.

- Server comparison: `lockstep_player` (`pilot.mjs --seeds 20 --lanes player`). Any divergence there is a `player` divergence.
- `lockstep_player_slim` (`tools/lockstep-player-slim-20.mjs`) runs the player trace under the alias for 20 seeds, asserts
  `player_slim: 'player'` in `tools/extract-hitbox-extras.mjs`, and catches 4 injected faults (wrong alias, attribute, goal tick, consumption order).
- No `src/` change: the 20 seeds show 0 divergences, so there is nothing to fix at a cause. The stage id uses an underscore like
  `lockstep_player`, so it is not a row in `tools/golden/lockstep-table.tsv`; the `player` rows there cover the same lines.
