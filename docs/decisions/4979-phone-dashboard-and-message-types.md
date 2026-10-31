# 4979 - phone dashboard (Home + Talk) and message types

Dan, 10 Oct 2026: the phone app was "crude" with few features and no way to talk to the runners; asked for a Home dashboard, talking to runners and a proper redesign, then: messages he sends must reach sessions whatever they are doing, with types ("reply required, announcement etc").

- **Home** (`tools/phone-web/home.js` + app.js): headline sentence; Max/Pro week and 5-hour meters as 20 voxel cells (repo variable `MCLITE_USAGE`, a reading older than 15 min is dimmed); tiles for red checks on master, PRs waiting to land, fill, runners online, last landing. Each piece loads on its own and fails alone; refreshed at most once a minute.
- **Talk**: a bus tab (conversations by default, "everything" shows the brain's log lines, repeats folded) and a message box on every run. Addresses: commander, fixer, everyone, each running `#issue`.
- **Types** (`tools/infra/bus.mjs`): `reply`, `urgent`, `announce`, `info`. No `type:` = the old rules, so every existing session keeps working.
- **Pervasion**: the PreToolUse hook already ran on every tool; the real gap was its exemption (any command containing `go.mjs say|reply|inbox|pending` skipped the gate, chained commands too). Now only a lone mail command passes. Announcements stop the next call once (hook stderr is the only channel guaranteed to reach the model). Latency is the 60 s mailbox cache (API budget, `apibudgetcheck`), not changed here; ETag conditional reads would cut it and are a follow-up.
- Not done: PR queue and backlog screens (Dan declined for now); hooks do not exist in Cowork sessions.
- Proof: `phonehomecheck`, `mailhookcheck`, `buscheck`, `phonewebcheck`, `phonerunscheck`, `phonecontrolscheck`.
