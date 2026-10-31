# #7726 - lockstep pilot cap follows the mirror's live headroom

Dan, 16 Oct 02:50Z (chose this over a fixed number): "1" = the lockstep pilot cap follows the GitHub test mirror's real headroom instead of a hand-set number. Self-calibrating, never a constant.

## Ruling
- `fill.lockstepPilotCap: "mirror"`. `claim` path only (`queue(true)`); `claimable` / fill-shape unchanged.
- Another lockstep issue may be held while `running+queued mirror jobs + held * jobsPerPilot < fill.mirrorJobBudget` (14 of the mirror's 20; `ci` / `ci-full` keep 6). Code: `tools/infra/mirrorcap.mjs`.
- `jobsPerPilot` is measured: mean job count of the last 10 finished `ci-pilot` runs; 20 until there are samples.
- One cached read (60 s) of queued + in_progress runs and their jobs, with `MIRROR_REPO` / `MIRROR_TOKEN`.
- Fallback: read failed, no credentials, or reading older than 5 min -> the old `"auto"` value (capacity-profile slots, 3). A held pilot is never evicted (cap >= held).
- `go.mjs status` prints `mirror headroom: ...`. Proven by `mirrorcapcheck`.
