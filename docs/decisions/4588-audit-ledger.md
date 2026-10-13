# 4588 - tester audit ledger

Dan, 8 Oct: testers were ~75% of spend and 72% of their runs filed 0 bugs (clean mobs re-audited from scratch).

- `tools/brain/auditledger.mjs`: ledger `~/.brain/audit-ledger.json` = `{mob: {at, hash}}` of CLEAN audits. `hash` covers every `src/` and `tools/stages.d` line that names the mob (line-level: an edit to shared goal code that never names the mob does not reopen it; widen to whole files if audits go stale).
- `fill()` (brain.mjs), while a `gate` issue is open: picks the mobs BEFORE dispatch (never-audited, then changed, then oldest clean), skips clean+unchanged and in-flight ones, names the mob in the slot text (`test slot N mob cow`). Every mob clean+unchanged = no tester starts.
- `launch.mjs`: records the hash at start; after the run `0 bugs filed` stores the entry, any bug or an unreadable report clears it.
- Unreadable ledger: today's slot rotation, mail to the fixer.
- `go.mjs status` prints `audited-clean n/N mobs`. Check: `tools/auditledgercheck.mjs` (7 breaks caught).
