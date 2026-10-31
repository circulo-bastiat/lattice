# For Dan

- **What to try in the game:** every landed change has a "Try in the game" line. Newest first:
  https://github.com/owner/mclite/pulls?q=is%3Apr+is%3Amerged  (or ask any session: `node tools/go.mjs status`)
- **What's being worked on, and what's next:** https://github.com/owner/mclite/milestones
  (the milestones are the Track G phases, in order).
- **Found a bug?** Tell any session in one sentence, or open an issue yourself. Label it `dan` and it goes first
  within its phase.
- **Is the game healthy?** After every landing the full suite runs on your GPU. Each check that fails opens its own issue
  "RED <check>: full-suite check red on master" (label `severe`); the list of open ones is what is red right now. None open = green.
  Checks listed in `tools/quarantine.json` are known red and never block a landing.
- **Usage:** double-click `USAGE.cmd` in the Projects folder (live, both accounts), or read `_status/usage.json`. `SWITCH-ACCOUNT.cmd` picks which account the loop
  budgets against; `ADD-CLAUDE-ACCOUNT.cmd` adds one.
- **Talk to the sessions:** post a comment on the "Session bus" issue (#53) on GitHub, first line `to: loop`,
  `to: cloud`, `to: #52` (whoever holds issue 52) or `to: all` + a line `reply: required`. The addressed session must
  answer before doing anything else; its answer appears in the same thread.
- **The brain:** it starts the workers, the tester, the commander and the fixer by itself when mail or a health alert needs them,
  and pushes to your phone for anything only you can answer. `node tools/go.mjs status` says whether it is online.
- **Workers on/off:** `LOOP-OFF.cmd` / `LOOP-ON.cmd`, or the phone app's Control tab (running workers finish their
  issue). No scheduled tasks anywhere. A cloud session: type `cloud session` at claude.ai/code.
