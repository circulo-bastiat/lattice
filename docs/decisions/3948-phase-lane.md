# 3948 - the phase lane

`go.mjs queue()` sorts by milestone, so `01 BUGS` always beat the phases and phases starved. Dan (6 Oct): exactly ONE worker on phases, in phase order.

- `roles.json fill.phaseLane {workers: 1, passGate: false, prompt}`. `brain.mjs fill()` makes one of its worker dispatches a lane run (`account: phase`, run title `brain worker @phase`) when none runs or waits; it is not subtracted from the primary count, so it sits inside the total and the same caps / quiet window / maxPerHour.
- `brain.yml` exports `MCLITE_LANE=phase` for that run; `launch.mjs` does too and prepends the lane prompt (smart unit choice, splitting, `--already-fixed`).
- `go.mjs queue()` with the lane env keeps only `tools/infra/phaselane.mjs laneFilter` (phase milestone, not done by its marks, no blocked/tracking/needs-pc/pc-gpu/env-fault), then the existing sort. The gate still applies unless `passGate` is true (lane only). Dependencies were already filtered.
- Hold marker is `noclaim-<account>` so the lane's is `noclaim-phase`: independent of `noclaim-default`; fill() arms a waker for it (#1575).
- Proof: `phaselanecheck` (17 breaks), `fillwakecheck`.
- `passGate` stays false; the commander flips it.
