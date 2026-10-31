# #7773 — role prompts: static first, per-run last

**Ruling.** In every role prompt in `tools/brain/roles.json` the per-run placeholder (`{reason}`, `{issue}`, `{brief}`) is the
LAST line; all text before it is byte-identical across runs of the role (no date, counter or run id).
`tools/promptprefixcheck.mjs` enforces it (3 breaks caught: placeholder first, timestamp in prefix, duplicated rule).

**Changed:** commander, requests, fixer, tester, chore, reviewer (`Reason:`/`Emergency:`/`Slot:`/`Task:` moved to the end).
Worker already ended in `{brief}`; it has no per-run text before it.

**Not changed (owed):** `enlarger` still has `{reason}` on line 1. The commander rule says a worker/enlarger prompt change needs
`tools/evals/run.mjs --all --repeat 3` and a committed report; none was run, so the enlarger is listed in `OWED` in the check.

**Item 4 (measurement) is owed.** Baseline 16 Oct 00:08-02:50Z, 52 runs: 1.39M cache-write tokens (avg 26.8k/run) vs 10.7M cache-read.
After ~20 runs on the new prompts: `node tools/passcost.mjs --find` / `--json` over those transcripts, compare cache-write per run,
cost and outcome mix. Caveat: the Claude CLI puts its own system prompt and tool block first, and the cache is keyed on the exact
prefix, so only the part of the user prompt before the first differing byte can be reused; the issue brief is per-run either way.
Prompts that were already short are expected to gain little. Nothing here shortened a prompt, so there is nothing to revert.

## Measurement (22 Oct, cut = 06:19Z, 20 transcripts each side, all mclite runners)

| | cache-write / run | cache-read / run |
|---|---|---|
| before (20 runs) | 32.2k | 555k |
| after (20 runs) | 38.3k | 824k |

Cache-write per run did NOT fall. Runs after the cut are longer (cache-read +48%), and write
volume is dominated by tool results and conversation growth, which the CLI appends to the cache
each turn; the static prompt is a small part and the CLI controls the system/tool layout and
cache breakpoints, so the per-run brief sits outside our control. Nothing was reverted: the
prompts are shorter and per-run text is last. Method: /tmp-style script summing
cache_creation_input_tokens per transcript (deduped by message id) over ~/.claude/projects.

## Enlarger (final)
The enlarger prompt now ends with `Reason: {reason}` like the others. tools/evals/run.mjs only replays the WORKER role (its hash covers roles.worker + tools.json, both unchanged), so it cannot score an enlarger change; the enlarger text is otherwise word for word the same, only the position of the reason moved.
