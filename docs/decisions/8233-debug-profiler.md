# 8233 /debug start|stop|report

Ruling: 1.18.2 DebugCommand has start, stop, function only; `report` is an MC-Lite addition (no file system).
`stop` stores the profile text; `report` downloads it as a Blob (`debug-profile.txt`) and fails with
commands.debug.reportFailed when nothing was profiled. Tick count = NS.Main.ticks delta (same counter as
/time query gametime); elapsed = wall clock. Report reuses commands.debug.function.success.single / traceFailed (1.18.2 has no report keys).
