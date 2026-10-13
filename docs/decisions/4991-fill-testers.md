# 4991: the worker switch means off, and testers get their own switch (Dan, 10 Oct 2026)

Bug: with FILL_WORKERS=0 the brain still started a fill-reserve tester on Pro (22:23Z): a tester parked at the usage cap was re-dispatched by
`pendingMailDue` at the reset. Fix: fill() drops parked fill/tester mail while the switch is 0 (or FILL_TESTERS=0 for testers), and launch.mjs
refuses a fill-made run (reason starts `fill` / `test slot`) while the repo variable is 0. Check: tools/fillzerocheck.mjs.

Dan: "split fill workers into fill workers and fill testers". New repo variable FILL_TESTERS: a number 0-10 = exactly that many testers (the
Pro reserve tester is part of it, not extra); FILL_WORKERS then counts workers only. Unset, empty or `auto` = the old behaviour (FILL_WORKERS is
the total and the brain splits it, #4549). Usage and API caps still apply. Double-click: LOOP-TESTERS-OFF.cmd, LOOP-TESTERS-AUTO.cmd, or
`node tools/go.mjs loop testers <n|auto>`.
