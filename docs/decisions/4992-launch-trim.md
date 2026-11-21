# 4992: trim what every worker/tester run loads (Dan, 10 Oct 2026, usage research session)

Why: 2,537 brain runs (5-10 Oct) cost about $708 list price; cost is linear in turns (about $0.021 per turn) and each turn re-reads the
whole base context. Measured on the brain VM with the Pro token (1-turn runs): 19.8k tokens per call with the old setup; ponytail off
16.9k; plus --disable-slash-commands and auto memory off about 13.6k; plus --tools "Bash,Read,Edit,Write" 7.2k. Full numbers:
_status/USAGE-RESEARCH-2026-10-10.md.

What: roles.json `roles.worker.trim` and `roles.tester.trim` (commander/fixer keep their full tool set). `trimLaunch` (route.mjs) turns the
block into `--tools`, `--disable-slash-commands`, `--strict-mcp-config`, a `--settings` override disabling the listed plugins, and
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1. `plugins.ponytail.mode` is `off`. Tester `maxTurns` 80 -> 60 and its prompt says to batch reads.
`--bare` is NOT used: it ignores the OAuth login the brain runs on.

Revert: set a role's `trim` to false (or delete it); ponytail back on = mode `lite` and drop `ponytail@ponytail` from `disablePlugins`.
Check: tools/trimcheck.mjs (13 breaks caught), core suite.

Verify after the next fill, from the run lines on the bus (`trim tools=...; plugins ponytail=off`): cost per turn, turns per run, median
run cost. Baselines: worker 8 turns $0.17, tester 17 turns $0.36. If workers over-build without ponytail, or fail for want of Glob/Grep/WebFetch,
widen `tools` rather than reverting the rest.
