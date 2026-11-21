# MC-Lite — why it stalled, and what would fix it

27 Sept 2026. Measured against the repo at `6c11acd` while the local loop pass (session 170) was running.

## Is the other session right?

**Partly. The numbers are close, but it leaves out the biggest cost and blames the wrong cause.**

| It said | What I measured |
|---|---|
| 257 commits today, 94 claiming, 38 re-merging | 267 ordinary commits: **104 claim/hand-off, 48 reconcile/re-land**, 34 D-entries, only ~81 actually doing something. It left out the **653 merge commits** made today. **553 of them are cloud sessions merging each other's branches into themselves** ("stacking"). That is the biggest single cost, and it grows with the square of the number of sessions. |
| Game code ~7,400 lines vs 7,800 tests, 5,400 docs | Over the last 7 days: **src +56.5k lines, tools +101.5k, docs +19k.** The test harness grew almost twice as fast as the game. |
| "The game code is 14 MB" | 8.3 MB of that is one generated data file. The hand-written game is about 101k lines; **the tools folder is 172k lines, so the harness is bigger than the game.** There are 428 tools, 276 of them `*check.mjs`, and 422 suite stages. |
| The claim bugs are fixed (D-823..D-833) | The patches are real, but the design they patch keeps colliding: tonight's reconcile runs **archived 7, then 8 cloud units** as collisions. Each one comes back as a `reland-*` item, and those items need more claims. |
| Bigger jobs would help | True, but it treats the symptom. The real cost is **the machinery that exists so parallel branches can share one tree.** |

## Why it feels sloppy: seven root causes

**1. The harness became the project.** Every ruling you made turned into a tool, a gate and a paragraph, and nothing was ever taken away. There are 838 decisions in three weeks. There are checks of the documents (`briefcheck`, `doccheck`, `toolscheck`, `statecheck`, `startgatecheck`, `gatecheck`, `nopollcheck`, `knowncheck`), and hooks that block tool calls. `briefcheck` even fails any four-digit number typed into a doc. A session spends its first stretch satisfying the machine before it touches the game.

**2. There is no single source of instructions, and the sources contradict each other.** A session can be steered by about ten places: two `CLAUDE.md`s (MineHTML's loads into every MC-Lite session because both folders are connected), `STATE.md`, `START.md`, `CLOUD.md`, `.claude/loop-prompt.md`, `.claude/infra-prompt.md`, `AGENTS.md`, QUEUE's "how this file works", NEXT's standing rules, and **the scheduled-task prompts themselves**. Some examples:
- `STATE.md` claims to "win over every other document", but it was last updated in **session 47** (it is now 170). It still says `cullcheck` is red on purpose, which was fixed long ago.
- STATE §5 says to ask for delete permission. The loop prompt says never ask.
- `START.md` says copies go through GitHub, not Syncthing. MineHTML's `CLAUDE.md` §7 says Syncthing mirrors everything.
- `CLOUD.md` says "ONE unit, then STOP". The cloud scheduled task's prompt says to chain the next unit. That task's last run **FAILED**.
- The loop's scheduled prompt is flagged as stale inside `loop-prompt.md`.
- The QUEUE table still shows row 0 as "Dan's list, 20 Sept" and shows sleeping and particles as not started.
- NEXT's "What a human should look at" still opens with session ~50's mob notes.

Instructions that live in scheduled-task prompts are tied to one account, and they go stale silently. That is exactly why "just say cloud session" doesn't work from another account.

**3. The substrate fights every step.** Sessions work on a Windows folder through a Linux VM that **cannot delete files** and **dies at 180 seconds**. Everything below exists only to work around those two limits:
- the git lock-file dance
- merging in a `/tmp` clone, then `cp` + `update-ref` back
- 124 MB of `_to_delete/` and 30 parked lock files
- 37 stale worktrees registered to dead sessions
- the lanes, a second runner (`.shell`), and the suite split into `--only/--from/--to`

Together with the no-polling rule, this means **a session never sees its own full test result; the next session does.** The feedback loop is one whole session long.

**4. MC-Lite runs on a dormant project's engine.** `lane.mjs`, `git push` and the full suite all go through `C:\claudeisthegoat\ai-jobs.js`, MineHTML's runner. MineHTML itself has had no commit since 17 Sept. A second, separate runner (`.shell`) exists for when the first one isn't enough.

**5. Two work lists and many writers.** The PC loop takes work from `QUEUE.md` row 0. Cloud sessions take it from `docs/cloud-order.json`. Then claims-in-git, stacking, fences, reconcile, archive and re-land try to keep them apart. The rule "workers can't share a file" means most loop waves shrink to **1 worker** anyway (sessions 161-167).

**6. Work drifted away from what you can see.** Sessions 155-169 (about 15 passes) went into Wither and Ender Dragon internals: phases, crystals, beam geometry. **There is no End dimension, so none of it can be reached in play.** Meanwhile **KW-48, blocks going invisible (severe, found by you playing today),** is second on the cloud list, and the PC loop's order doesn't reach it. Hence "a lot of commits and not much you can see".

**7. Green never means anything.** The last full suite had 9 reds. Red is the normal state, so a red can't tell a session it broke something.

## Radical changes, for you to pick

A. **One front door, in the repo.** A single `RUN.md` and a single `node tools/go.mjs cloud|loop` that detects where it is running (cloud container, Cowork on the PC, or Claude Code on the PC) and does all the setup. Every scheduled-task prompt becomes one line: `loop session`. Any account works, because nothing important lives in the task.

B. **One writer at a time, straight onto master.** Delete claims, stacking, reconcile, archive, re-land, fences and `cloud-order.json`. Sessions take the top line of one backlog, commit to master and push. A small lease file stops two sessions starting on the same line. After 30 Sept the cloud credit is gone anyway, and Pro usage won't feed four workers.

C. **Stop working through the VM mount.** Run sessions somewhere with real git and no 180 s cap: Claude Code on Windows, or a full clone that pushes to GitHub itself. The lock dance, both lanes, the `.shell` runner, the dependency on MineHTML's runner and the suite splitting all go.

D. **A harness diet.** A ~2-minute core suite that must be green before every commit, a nightly full run, and known-red checks quarantined so green means green. Delete the checks-of-docs and the gates and hooks; the rules live in `RUN.md`.

E. **A docs diet: 5 files.** `README` (what it is, how to play), `RUN.md` (how sessions run), `BACKLOG.md` (QUEUE + cloud order + KNOWN-WRONG merged into one ordered list), `DECISIONS.md` (append-only, never read at start) and `FOR-DAN.md` (what to try). STATE, NEXT, PLAN, ARCH, AGENTS and CLOUD get archived.

F. **Player-visible first.** KW-48 first. Nothing for content you can't reach (the End) until you can reach it. Every unit ends with one line on what you can try.

G. **Whole-feature units.** "Every piglin behaviour", not one failing test. The other session is right about this.

## The work-sharing design: how real teams run many developers on one codebase

Today's system has sessions coordinate with each other *through git commits* — claims, stacking, reconcile. Real projects don't do that. They put three pieces of infrastructure between the developers: **a tracker, a merge queue and CI.** Here is that design, mapped onto MC-Lite.

**1. The backlog is GitHub Issues, in phase order.** One issue per unit, sized as a whole feature. One milestone per phase (G19b, G18e, G18f, G20…), in PLAN order, so "what's next" is simply the lowest open issue in the earliest open milestone. You can watch it on a GitHub Project board from your phone. Bugs you report become issues. QUEUE.md, cloud-order.json and KNOWN-WRONG.md all go.

**2. Claiming is one atomic operation on GitHub, not a commit.** A session claims issue #123 by *creating* the branch `work/123` on GitHub. GitHub refuses to create a branch that already exists, so two sessions can never both win, even if they start in the same millisecond. There is no 20-second wait, no race resolution, no claim commits and no TTL guessing: a stale claim is just a branch with no push for N hours, and the next session takes it over *from where it stopped*.

**3. Sessions never touch master. A bot lands the work (a merge queue).** When a session finishes, it pushes `work/123` and it's done. A GitHub Actions workflow, running **one landing at a time**, then:
- rebases the branch onto the latest master
- builds
- runs the core suite
- if everything is green, fast-forwards master, closes the issue, and writes the "what Dan can try" line

If the rebase conflicts or a test goes red, the issue goes back to the top of the queue labelled `needs-rebase`, **with the branch kept**. The next session picks it up and resolves the conflict with full context. Nothing is ever shelved, archived or redone from scratch. This is how Rust, Kubernetes and most big companies land code.

**4. Remove the files everyone edits.** Most of today's collisions aren't in game code at all. They're in the shared lists:
- `suite.mjs` registrations → every check lives in `tools/stages.d/`, found automatically
- `build.mjs` module order → read from the folder
- DECISIONS.md appends → one file per decision, numbered by the bot at landing
- NEXT/QUEUE/state.json/TOOLS.md → generated by CI after landing, never hand-edited

Once those are gone, two sessions only collide when they really change the same lines of game code, which is rare with feature-sized units.

**5. CI runs the tests, not the session.**
- **GitHub-hosted:** the build plus the fast core checks, on every landing.
- **Your PC as a registered GitHub "self-hosted runner":** the full browser suite on the real GPU, on every new master when the PC is on. This replaces MineHTML's ai-jobs runner, the `.shell` runner, lanes, `lane.mjs answer` and the "read it next session" dance.

A red on master **automatically opens a top-priority issue**. Results show on GitHub, and Claude sessions get them as notifications instead of polling.

**6. One front door.** `node tools/go.mjs` does the same thing in a cloud session, a loop session or any Workflow worker: sync, bootstrap, claim the next issue, print the brief. At the end, `go.mjs done` pushes and hands off. A loop session is just a session that claims up to 4 issues and gives each to a worker. **They're all equal citizens of the same queue**, so cloud and loop run side by side with no special "only writer" role. It works from any account: the repo holds the instructions, and each account needs only its GitHub connection plus one token.

**The cost:**
- a fine-grained GitHub token, made once (I can do it in your browser with your OK) and stored for cloud and loop
- registering your PC as a runner (a double-click)
- GitHub Actions minutes: private repos get 2,000/month free, and the core landing gate must stay around 3 minutes (so ~600 landings/month)
- about one large session to build, plus migrating the backlog into issues
- the loop pauses while its machinery is swapped
