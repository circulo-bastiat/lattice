<!-- ⚠⚠ STATE.md WINS OVER EVERY OTHER DOCUMENT IN THIS REPO, INCLUDING CLAUDE.md.
     If they disagree, the other document is the bug and fixing it is part of this pass.

     ⚠ THIS FILE IS A TEMPLATE. A double-brace key is filled from docs/state.json when brief.mjs
     prints it. DO NOT TYPE A LIVE NUMBER IN HERE — `briefcheck` fails on any bare number
     of four digits or more, because a number typed by a human is wrong by the next
     session and a reader cannot tell which. Cite the key; the tool supplies the value. -->

**Last updated: session 47, 20 September 2026 (D-409).** Update this at every close-out.

> ⛔ **NO POLLING — for the life of this project (D-436, D-438).** <!-- NOPOLL:D436 -->
> No sleeps, loops, `tail -f`, background-and-return, wake-ups, or re-reads of a queued job. Long jobs go
> to a lane (`lane.mjs`) or the file runner (`.shell`, `tools/shell-runner.mjs`); a result is read ONCE by
> the next `start`. A result needed inside a session is run in the FOREGROUND of the call that needs it.
> Enforced three ways — the Claude Code hook, the file runner's own refusal (binds Cowork too), and
> `nopollcheck` at close, which fails the commit if any layer is stripped.

## 0. The one thing to know right now

**The project is at `C:\Users\user\Downloads\mclite`.** When `device_bash` is up it reaches it (mounted
at `$HOME/mnt/mclite`) and is the normal shell; the cloud container is for a tool that does not exist on
the PC — and, since D-407, for the four browser stages longer than one shell call (KW-20) — and nothing else.
(The week of 8 Sept, when a session wrote the opposite into AGENTS.md, is D-360..D-368; the full
diagnosis is `git show 2a8efe1:MC-LITE-INFRASTRUCTURE-DIAGNOSIS.md`.)

**Vanilla source: `.decomp/`** (D-488, gitignored) — Yarn-named 1.18.2 Java: `grep -rln IronGolemEntity .decomp/net`, obf→Yarn via `grep -P '\tbin\t' .decomp/names.tsv`; rebuild recipe `.decomp/README.md`.

⚠ **`device_bash` CAN GO DOWN ENTIRELY** — a Windows update did on 8 Sept 2026 ("Workspace unavailable …
prevents Claude's workspace from reaching your files"). File staging and computer-use still work.
When it is down, drive the PC through the **file runner** (`.shell` + `tools/shell-runner.mjs`, D-438,
§3): DROP a `.job` in `.shell/inbox`, READ the result in `.shell/done`. It has no time limit and needs
only file access, so it is the resilient path even when `device_bash` returns.

**The order of work is `docs/QUEUE.md`; the board is `docs/NEXT.md`.**

## 1. What is live

* **`cullcheck` is RED ON PURPOSE** and it is still the first thing to settle (D-356). The
  decision owed is whether to make the occlusion flood deterministic per frame or to restate
  the claim with the fogged band named — **not** to move a threshold (D-329, inverted).
* Right-click exists as of D-361, with **ten owed interactions** named and each waiting on a
  stage. `usecheck` holds that list closed.
* The highest decision number is **D-{{decisions.highest}}**. ⚠ Take yours as late as you can
  and re-check the tail: session 14 collided on D-362, which is exactly what `docs/AGENTS.md`
  warns about. The decision COUNT is `doccheck`'s to report — `brief` deliberately does not
  duplicate its parser.

> ⛔ **READING CHAIN MANDATORY + LOUD BREACH LOG (D-454).** A second `PreToolUse` hook
> (`tools/startgate.mjs`) blocks EVERY tool call until this session has run `node tools/session.mjs
> start` — the brief IS the reading chain (D-408), so that one command is the only permitted first
> action. Keyed by Claude Code's `session_id` (a prior session's marker cannot satisfy it); opened
> by the `SessionStart` `--stamp` hook or by the gate observing the `start` command, so it never
> deadlocks. A breach of EITHER gate — poll ban or reading gate, on the hook path or the `.shell`
> runner — appends to `.claude/breaches.log` (gitignored) and is surfaced as a `⚠⚠` banner atop the
> next `start`. The mandatory read is kept lean by `startgatecheck` (required docs ≤ 82 KB total).

## 2. What the suite can and cannot see

* {{tools.suite_stages}} stages, {{tools.suite_checks}} of them checks, over {{tools.files}}
  tools — and **{{tools.not_run_by_suite}} tools the suite does not run.** That last number is
  not a defect (probes and generators belong outside it) but until session 14 nobody could see it.
* **`--fast` does not see the game.** The browser stages are the only checks that look at the
  picture. Read the summary line that names every stage that did not run.
* ▶ **There is a browser now, permanently** (D-407): `.chromium/chrome`, project-local and
  gitignored, found by `tools/cdp.mjs`; `node tools/get-chromium.mjs` rebuilds it. It reports the
  same 2048-layer ceiling as Windows Chrome, which is what the atlas shards are for (D-380).
  ⚠ A shell call dies at ~180 s with everything it started; four stages need the container
  (`palettecheck`/`cullcheck`/`flashcheck`/`lumacheck`, KW-20; `NEXT.md`, "The browser") — a
  call-length limit, not a connectivity one (D-457): the VM itself launches and drives
  Chromium fine for anything shorter.
* ⚠ **Run them at Dan's preset.** `detect()` clamps to CELERON on a two-core box, so five
  sessions of browser checks ran at render distance 4 with FAST leaves — the one setup where the
  flash cannot happen and the fancy leaf path is never drawn (D-196).
* **The ledger (D-408):** `.ledger/suite-full.json` is the last FULL run — machine, HEAD, time,
  failures — written by the suite itself and printed by `session.mjs start`. A remembered green is
  not a green; a ledger older than HEAD says so.

## 3. The lanes — what a long job can use

* ▶ **The file runner (D-438) — `.shell` + `tools/shell-runner.mjs`.** A permanent Windows daemon
  (Task Scheduler at logon, supervised by `START-SHELL.cmd`; install with `INSTALL-SHELL.cmd`). DROP a
  command as `.shell/inbox/<id>.job`, READ `.shell/done/<id>.json` (exists ⇒ finished) and `.out`. No
  180 s cap; needs only file staging, so it works when `device_bash` is down. It imports `nopoll` and
  REFUSES polling-shaped commands from any session — the one ban layer that binds Cowork. `--status`
  prints the heartbeat; `--once` drains the queue on a double-click if a daemon can't stay up.
* **The ai-jobs lane accepts MC-Lite jobs now** (`root: mclite`, added 16 Sept). Before that it
  was locked to `C:\claudeisthegoat`, which is why a shadow copy of MC-Lite's referee data lived
  inside MineHTML's repo. ⚠ Pin any `root:` job with `assign:`, and note the runner must be
  restarted to understand the field — **from the dashboard** (`AI-7600.bat` → "Restart runner here"),
  or `node claudeisthegoat/harness/tools/runner_ctl.js restart`. ⚠ `run-bridge.bat` was deleted in
  s153 and parked in `_to_delete\`; several documents, MineHTML's `CLAUDE.md` among them, still
  name it.
* **Never trust one read of the runner heartbeat** — `node tools/bridgecheck.mjs` (D-363).
* The Hyper-V VM (`C:\Users\user\Downloads\tentativevirtualmachine`) is a second lane with no
  time limit that restarts itself at logon. It has no GPU (passthrough was reverted 9 Sept), so
  it measures the **software-rendering floor**, which is the right floor for this project and is
  not a substitute for a real-hardware WebGPU test.

## 3b. Backups and copies (D-408)

* ▶ **GitHub is the backup**: private `owner/mclite`, pushed at every
  `session.mjs close` through the Windows runner (Dan's saved git login; the Cowork shell has none).
  `backupcheck` passes when `origin/*` contains HEAD; a dated bundle in `C:\claudeisthegoat\_backups\`
  is the fallback only.
* ▶ **Copies elsewhere come FROM GitHub** (D-409): `sync\SETUP-SYNC.cmd`, double-clicked once per
  machine, clones every repo into `%USERPROFILE%\Projects` and pulls every 15 min (Task Scheduler,
  Git's own sign-in). ⚠ Set up on NO other machine yet — not the second PC, not the Windows VM.
  ▶ Dan's ruling (20 Sept): **Syncthing goes off once BOTH have run SETUP-SYNC** — confirm with him
  first (MineHTML's runner used it between the two PCs). The same session system is to be ported
  to `claudeisthegoat`, `tentativevirtualmachine` and `my_life`, each in its OWN session.
* ⚠ The VM tooling folder is still NOT on GitHub: it tracks a plaintext guest password
  (`host/lib/guest-secret.json`). Untrack it and rotate the password before it gets a remote.
* The ledger: every suite run writes `.ledger/suite-last.json`; a full run also `.ledger/suite-full.json`
  (KW-10). `session.mjs start` prints both.

## 4. Where the project stands

The reading chain this brief replaces is **{{reading_chain.bytes}} bytes across
{{reading_chain.files}} files**. `src/` is {{src.modules}} modules. HEAD is
`{{git.head}}` on `{{git.branch}}`.

This file says where the project *is*; `QUEUE.md` says what to do, in order; `NEXT.md` says what
to do *now* and what Dan should look at.

## 5. Committing on this mount — ASK FOR DELETE PERMISSION FIRST (D-369)

⚠⚠ **THE SIX-STEP LOCK DANCE IS NOT NECESSARY AND NEVER WAS.** `rm` is blocked on this mount
*by default*, and the session can **ask for it to be unblocked**
(`device_request_delete_permission`, one prompt, granted for the folder's whole subtree for the
rest of the session). Thirteen sessions worked around a permission nobody had asked for.

**Do this once, at the start of a pass that will commit:** request delete permission for
`C:\Users\user\Downloads\mclite`, then commit normally — `git add`, `git commit`, no
`mv` dance, no aside files. Git can unlink its own locks again and everything behaves.

▶ **What the workaround had been costing, measured 16 Sept 2026:** `.git/objects` held **902
orphaned `tmp_obj_*` files** — one or more per interrupted object write, accumulating since the
repo was created, and unremovable, so `git gc` refused and the count only ever went up. Plus
seven stale `.lock.aside*` files. After the permission was granted and a real `git gc` ran —
**the first in this repo's history** — `.git` went from **29 MB to 9.5 MB** with `garbage: 0`.

⚠ If the permission is declined or unavailable, the old recipe still works and is kept below.
⚠ Deleting here is permanent — there is no Trash. Anything uncertain is MOVED into `.trash/`.

### The fallback, for a session with no delete permission

⚠ Without delete permission, git cannot unlink its own lock files, and **there are two**:
`.git/index.lock` AND `.git/HEAD.lock`. `git add` itself leaves a fresh one that has to be moved
between the add and the commit. **All of it in ONE shell call** — doing it in two never
converges, because each failed attempt leaves another lock. Session 13 spent six attempts
learning this.

```
mv .git/HEAD.lock  .git/HEAD.lock.aside
mv .git/index.lock .git/index.lock.aside
git add -A <paths>
mv .git/index.lock .git/index.lock.aside2
git commit -q -F msg
```

⚠ `warning: unable to unlink .git/objects/../tmp_obj_*` on the way past is this same mount and is
harmless — the commit still lands. Check `git log --oneline -1` rather than believing the noise.

⚠ Without the permission, nothing here can delete; anything that would be removed is MOVED into
`.trash/` instead. **With it, prefer asking over working around.**

## 6. What a request costs (D-371), and which model (D-372..D-374)

Measured with `node tools/passcost.mjs <transcript> --record <tag>` and cited, never retyped:
**{{last_pass.requests}} requests · ${{last_pass.per_request_usd}} each · median context
{{last_pass.median_context}} tokens · {{last_pass.hit_rate_pct}}% cached · ${{last_pass.cost_usd}}**
({{last_pass.output}} output tokens).

* **Cost is requests × context size.** A shell call is at least one request and re-sends the whole
  conversation — batch commands into one call; **a new session for unrelated work is cheaper than
  a long one** (the last quarter of a pass costs several times the first for the same work).
* **Pick the model AND the effort at the start and never switch** — a switch re-processes the whole
  conversation. Mechanical → Sonnet 5 `low`; ordinary building → Sonnet 5 `medium`; deciding what
  vanilla does → its own Opus 5 session, written up as a DECISION and carried back in one line.
  Never Sonnet at `high`. Workers only where a machine checks them.
* The research behind this (benchmarks, the Claude/ChatGPT comparison, unused levers) is
  `git show 2a8efe1:EFFICIENCY-AUDIT.md`.
