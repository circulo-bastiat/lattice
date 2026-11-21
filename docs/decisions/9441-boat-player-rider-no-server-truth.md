# 9441: a boat with a Player rider has no server-side physics to compare against

Finding for G17-L72a-1 (#9441, unit 1 of #6359). The lane as written ("boat on open water, scripted Player rider
forward/left/right, per-tick rows, compare to the real 1.18.2 server") cannot produce a golden, from .decomp (1.18.2):

- `BoatEntity.tick` (`.decomp/net/minecraft/entity/vehicle/BoatEntity.java:290`) runs `updateVelocity`, `move` and the
  paddle logic only `if (isLogicalSideForUpdatingMovement())`.
- `Entity.isLogicalSideForUpdatingMovement` (`Entity.java:2720`): a PlayerEntity primary passenger -> `isMainPlayer()`;
  `PlayerEntity.isMainPlayer` (`PlayerEntity.java:1299`) is `false`, only ClientPlayerEntity overrides it. On the dedicated
  server a player-ridden boat therefore never steers, floats or moves by itself.
- Its position comes from the client's `VehicleMoveC2SPacket` (`ServerPlayNetworkHandler.onVehicleMove`, line 344), which the
  server only range-checks. `BoatEntity.setInputs` is client-only. A bot that sends those packets would be sending positions
  the engine computed: the comparison would be circular.

What the real server CAN be the truth for: a boat with a NON-player passenger (summon `Passengers:[{id:...}]`): then the
server side is the logical side, `updateVelocity` (buoyancy, drag, location) runs, and per-tick vehicle / passengers / seat rows
are real. The paddle/steering rule (`updatePaddles`) stays engine-only (reference: .decomp + `boatphys`/`boatsimcheck`).

Owed (not done in #9441): a `boatpassenger` lane in `lanes.d` + `chasescen` with a pig passenger on open water, rows
pos/vel/vehicle/passengers/seat, 20 salts, mirror pilot.
