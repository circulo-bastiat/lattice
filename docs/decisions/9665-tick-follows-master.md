# 9665 - the brain VM's clock runs master's tick.sh, not a copy installed once

Date: 22 Oct 2026. Decided by: commander.

**Problem.** systemd ran `~/brain-tick/tick.sh`, downloaded once by vm-setup.sh (19 Oct). The tick refreshed its clone of master but never ran the
clone's tick.sh, so #9545 (MIRROR_* exports: workers on the mirror) and the FULL_MODE export never took effect, while brainclockcheck (which reads
the repo copy) stayed green.

**Decision.** After refreshing its clone, tick.sh replaces its installed copy with `tools/brain/tick.sh` when they differ and re-runs once
(TICK_UPDATED guard). General rule for this repo: anything the VM runs from an installed copy must update itself from master or run the clone's
file directly. Check: brainclockcheck (rule + break).
