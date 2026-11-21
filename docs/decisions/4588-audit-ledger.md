# 4588 - tester audit ledger

Dan, 8 Oct: testers were ~75% of spend and 72% of their runs filed 0 bugs (clean mobs re-audited from scratch).

- `tools/brain/auditledger.mjs`: ledger `~/.brain/audit-ledger.json` = `{mob: {at, hash}}` of CLEAN audits. `hash` covers every `src/` and `tools/stages.d` line that names the mob (line-level: an edit to shared goal code that never names the mob does not reopen it; widen to whole files if audits go stale).
- `fill()` (brain.mjs), while a `gate` issue is open: picks the mobs BEFORE dispatch (never-audited, then changed, then oldest clean), skips clean+unchanged and in-flight ones, names the mob in the slot text (`test slot N mob cow`). Every mob clean+unchanged = no tester starts.
- `launch.mjs`: records the hash at start; after the run `0 bugs filed` stores the entry, any bug or an unreadable report clears it.
- Unreadable ledger: today's slot rotation, mail to the fixer.
- `go.mjs status` prints `audited-clean n/N mobs`. Check: `tools/auditledgercheck.mjs` (7 breaks caught).

## #7540 (Dan, 15 Oct): the line-hash erase rule is retired
With workers landing all day, any line naming a mob changed its hash, so 0/91 mobs ever stayed clean. Replaced by machine proofs:
- A mob is skipped by testers when `tools/mobproof/matrix.json` says it is PROVEN **and** it has a visual sign-off in `tools/mobproof-visual.json` (`{mob:{build,at}}`, committed).
- A tester audit now covers only what machines cannot see: the in-game look and feel (screenshot review in 3 poses, sound heard, drop seen). Proven-but-unsigned mobs still get that audit.
- A sign-off is void exactly when the mob's proof is not proven (`pruneVisual`); source edits do not erase it.
- The old `~/.brain/audit-ledger.json` stays readable for one release and only applies to mobs that are not proven.
- `go.mjs status` prints `proven N/91` and `visually signed-off N/91`. Check: `auditledgercheck` (breaks for each new rule).
