# RUN.md — the only instructions a session needs

Dan types **`cloud session`** or **`loop session`**, and nothing else, from any account and any machine.
This file and `node tools/go.mjs` do the rest. If this file and any other document disagree, this file wins,
and the other one is a bug to delete.

> **7 Oct: tests run on GitHub's hosted runners, not Dan's PC** (repo variable `TEST_RUNNER`, default hosted; `pc` rolls back). The lander runs the core suite on ubuntu-latest; `full-suite` runs 16 shards. Dan's PC only refreshes its copy (`localcopy.yml`) and runs the phone/usage services. Do NOT run full suites or many browsers on Dan's PC or VM: push your branch and let the lander test it. Decision: docs/decisions/hosted-runners.md.

## The shape (why there is no bookkeeping any more)

| piece | what it is | replaces |
|---|---|---|
| **Backlog** | GitHub Issues, one per whole-feature unit, grouped into milestones in **Track G phase order** | QUEUE.md, cloud-order.json, KNOWN-WRONG.md, NEXT.md's lists |
| **Claim** | `go.mjs` creates branch `work/<issue>` through the GitHub API. GitHub refuses a duplicate, so exactly one session wins | claims.mjs, pcclaim.mjs, claim commits, the 20 s race wait |
| **Landing** | `go.mjs done --finished` opens a pull request labelled `land`. The **lander** (a GitHub workflow, one PR at a time; since 13 Oct `TEST_RUNNER=pc` + `TEST_REMOTE=mirror`: Dan's PC merges and builds, the core and anti-vacuity suites run free in the public test mirror (#6767, `tools/infra/mirror.mjs`; MIRROR-PRIVATE.cmd turns it off)) tests the PR merged onto master, then merges it. A conflict or a red sends it back to the queue with the branch kept | reconcile.mjs, stacking, archive/re-land, master-only-writer rule, the lock dance |
| **Tests** | lander (the EXPRESS runner, label `express`): build + `--core` (`tools/core.json`, a few minutes) on every PR. `full-suite.yml`: the whole suite (hosted: 16 shards on ubuntu, every 2 h on the newest master; `TEST_RUNNER=pc`: Dan's GPU PC on every new master). A red opens a top-priority issue | lane.mjs, the ai-jobs runner, the `.shell` runner, "read it next start" |
| **Usage** | `go.mjs usage` reads the numbers published by `tools/usaged.mjs` (a PC service using Anthropic's own `/api/oauth/usage`; it renews its own Claude logins since #2329, so they no longer expire). Dan reads them by double-clicking `Projects\USAGE.cmd` (live, both accounts, no browser) | Claude-in-Chrome usage scraping |
| **Decisions** | one file per decision in `docs/decisions/`, named after the issue: no shared file to collide in | appending to DECISIONS.md (kept, read-only history) |

## `cloud session`  or  `loop session`

1. `node tools/go.mjs start` (a loop session: `node tools/go.mjs start --loop`). It detects where it is (cloud container, Cowork on
   Dan's PC, Claude Code on Windows), makes a private clone, links the game data, claims the next issue (or N issues
   for a loop's workers), and prints the brief: the issue, its hand-off notes, and the checks to run. **If it
   fails, it prints ONE line of what Dan must do. Tell him that line and stop.**
2. Work only on that issue, in the clone it printed. Vanilla facts come from `.decomp/`, the extractors or
   `tools/vanillacheck.mjs`, never from memory. Every new check proves it can fail (it breaks its own data and
   asserts the break is caught, printing "<n> breaks caught") and lives in its own `tools/stages.d/<id>.json`. The
   lander enforces it: a new check that never shows it can fail is not merged.
3. Test as you go: `node build.mjs` and `node tools/suite.mjs --fast --only <your checks>`.
4. Finish: `node tools/go.mjs done --msg "<what changed>" --try "<what Dan can try in the game>" [--finished]`.
   Fix already on master and verified, nothing to commit? `done --already-fixed --msg "<which landing, what you ran>"` closes the issue (plain `done` refuses with "nothing to hand in").
   Without `--finished` it pushes the branch and writes the hand-off onto the issue, so the next session continues
   it. With `--finished` it opens the PR for the lander. Either way it releases nothing by hand: the branch IS the
   claim.
5. **Loop only:** `go.mjs start --loop` prints how many workers the usage allows (0-4) and one ready prompt per
   worker. Run them as ONE Workflow (Sonnet 5 medium). Each worker first runs its own `go.mjs prep --dir <workspace>` line
   (builds that workspace's data, ~2 min, in its own command), then steps 2-4 on its own issue. Then end: the brain keeps workers running.
   Never fire, re-arm or update an app scheduled task (each one asks Dan for approval).
6. Tell Dan in 2-4 plain sentences what changed and what to try.

## Talking to each other (cloud, loop, workers, commander, Dan) - mail is answered FIRST

The bus is the GitHub issue labelled `bus` (#53). Addresses: `all`, `sessions` (everyone holding an issue),
`#<issue>`, a branch, `cloud`, `loop` (the loop's orchestrator), `loop-worker`, `commander`.

- Send: `node tools/go.mjs say --to <address> "…"`. Share freely: "I'm in src/07j_entityrender.js", "#52 needs X".
- **A message addressed to you must be answered before you do anything else, and nobody has to remember to look.**
  The check is automatic: `build.mjs`, `tools/suite.mjs` and every `go.mjs` command run it first
  (`tools/infra/gate.mjs`, one GitHub read per 30 s), so a session cannot build, test or hand in while a message to it
  is unanswered - it gets the message instead, and `node tools/go.mjs reply <id> "…"` clears it. In cloud sessions a
  hook also blocks every tool call. Replies (`re:`) need no answer; `to: all` is news unless it says `reply: required`.
- **The same gate stops work on an issue that was closed or taken over** (YIELD), and the lander refuses to merge it.
- Identities are automatic too: a worker is its issue (`#N`), `start --loop` makes its session `loop`, a cloud session
  is `cloud`, anything else is `commander`.
- Dan can post on #53 himself, from GitHub on any device, or from the phone app (`phone/`, release `phone-latest`). The newer phone PWA lives in `tools/phone-web/` (#3920; Pages repo `owner/mclite-phone`, redeployed by hand with `DEPLOY-PHONE.cmd` (`tools/phone-web/deploy.mjs`: builds landed master, force-pushes to the Pages repo; the workflow does it too only if `PHONE_PAGES_TOKEN` is set, it is not); on 8 Oct Dan reported the Pages site as not found) - until that is settled, ask Dan decisions in the chat, not with `--to dan` alone.
- **Asking Dan a decision:** `go.mjs say --to dan "<question>\noptions: A | B | C"` - it pushes to his phone, the app shows
  the options as buttons, and his answer comes back as mail to you (`from: dan`, `about: <your message id>`).
- **Message types (#4979; Dan, 10 Oct: messages must "pervade all ... no matter what they're doing"):** a `type:` header decides how hard a message interrupts. `reply` = answer needed, `urgent` = answer needed and drop what you are doing, `announce` = shown to you once, no answer, `info` = FYI, never interrupts. Dan picks the type on the phone's Talk tab; `go.mjs say` writes the same header by hand (`type: urgent` on its own line under `from:`). The PreToolUse hook (`tools/infra/mailhook.mjs`, matcher `.*`) stops EVERY tool call - Bash, PowerShell, Read, Edit, Write, Grep, Agent - while a reply/urgent message waits, and stops the next call once for an announcement; only a lone `node tools/go.mjs reply|say|inbox|pending|news` command passes (a command that is chained with one, or merely mentions it, does not). A new message reaches a busy session within ~1.5 min (60 s GitHub cache + 15 s hook cache); a tool call already running cannot be interrupted. Cowork sessions run no hooks, so there only the gate inside the go.mjs commands applies. `mailhookcheck` + `buscheck` prove it.
- **The brain wakes whoever the mail needs (#86; Dan, 28 Sept).** Runners labelled `brain` in the sandbox VM watch
  the bus (`.github/workflows/brain.yml`): mail to `commander` or `fixer` starts that role headless within about a
  minute (models in `tools/brain/roles.json`), `--to dan` pushes to Dan's phone, and every 15 minutes a health check
  mails the commander about a red master, an offline runner, or mail nobody answered. So: to wake someone, **just
  send the mail**. Never call update_trigger, never start a session yourself. `go.mjs status` says whether the brain
  is online; `to: log` lines are the brain's own record of each run.
- **Every pause, hold or cap in the fill arms its own wake (#1575; Dan, 2 Oct: "I'm genuinely tired of it").** The fill only
  runs when a bus comment arrives, so anything that holds it back (the boondoggle pause, the no-claim hold, a usage or API
  cap, maxPerHour) MUST dispatch a `waker` for the moment it ends, or the loop sits idle with no worker and no usage (6 h on
  2 Oct). Never add a hold to `fill()` without that waker; `fillwakecheck` and `braincheck` fail if one is missing. If the
  fill wants workers and nothing has run or waited for 45 min the health pass raises `fill-idle` to the commander AND the
  fixer: restart it with `go.mjs say --to log "restarting the fill"`, then fix the hold that left no waker. When the
  commander sees a `to: dan` "PAUSED" line it checks the fill restarted after the pause - never "looking" and walking away.
  The `dormant` health alert (#1966) wakes both too: the fill wants workers, no master commit and no worker/tester/commander/fixer
  run for 60 min, and usage does not explain it (a waker alone is not progress); it re-alerts hourly.
- **Brain workers** never run `go.mjs start`: brain.yml claims the issue and builds the workspace first (hard 15-min
  limit, no session spent on a hang) and hands the brief to the worker in its prompt. Two worker runs in a row with
  no PR and no new code on the branch label the issue `blocked`. No worker starts above the usage caps in roles.json `fill`.

- **Phase lane (#3948; Dan, 6 Oct):** exactly one fill worker (run `brain worker @phase`, env `MCLITE_LANE=phase`, counted inside the worker total) claims only phase-milestone issues (not `00 INFRA`/`01 BUGS`), lowest milestone first, skipping done/tracking/dependent/blocked/needs-pc issues; the others keep bugs-first. It reads the issue's ✅/◐ and `*.OWED` lists first, splits a whole-phase issue into real OWED units, and closes an already-passing unit with `--already-fixed`. Its hold is its own marker `noclaim-phase` (with its own waker). It still obeys the `gate` issue unless the commander sets `fill.phaseLane.passGate` true in roles.json. Decision: docs/decisions/3948-phase-lane.md.

- **Heartbeat (#4448; Dan, 8 Oct):** `.github/workflows/heartbeat.yml` runs hourly (cron `17 * * * *`, hosted) independently of the bus: if the fill wants workers and nothing has run or landed for ~60 min it restarts it; its own errors mail the fixer and commander (fallback: a severe `fill-idle` issue). Check: `tools/heartbeatcheck.mjs`; decision `docs/decisions/4448-heartbeat.md`.

- **"Claimable" means a worker can really claim it (#5116, 11 Oct):** `go.mjs status`'s `queue N claimable` and `go.mjs claimable` exclude issues whose `work/<n>-` branch is held (`tools/infra/heldnow.mjs`, the same rule `claim()` uses) or whose PR is in review; the held count is printed beside it. The commander's thin-queue test reads that number. Check: `freequeuecheck`.
- **Lockstep pilot cap (#7579, 15 Oct; Dan: 'triage it permanently'):** every lockstep issue runs a 20-salt pilot on the real server, and the brain VM serves 3 server slots (each JVM capped to 2 cores by `-XX:ActiveProcessorCount`). With 6 held at once each pilot took 6x as long and 27 workers were killed at the 100-minute limit. `roles.json` `fill.lockstepPilotCap` (3) now bounds how many lockstep issues are HELD at once: when a worker claims (`go.mjs start`), lockstep issues still lead the queue until the cap is reached, then the worker takes the next non-lockstep work. `go.mjs status` prints `lockstep pilots: N held of 3 cap`; `claimable` still counts the waiting lockstep issues. Held = `heldnow.mjs` (a released branch is not busy). Check: `lockstepcapcheck`.
- **Capacity profile (#7584, 15 Oct; Dan: 'weekdays 2 am to 1 pm it runs at 10 cores'):** the brain VM (`claude-sandbox`) is configured at 10 vCPUs once; `roles.json` `fill.capacity` says how much is USED by the New York clock: weekdays 02:00-13:00 = 10 cores = 5 real-server slots (and `lockstepPilotCap` auto = 5; the 08:00-14:00 halving of the total worker count still applies), every other hour 6 cores = 3 slots. A live Hyper-V CPU cap was rejected on purpose (the guest would see 10 cores and get 6, the oversubscription behind #7579). `go.mjs status` prints `capacity now:`. Check: `capacitycheck`.
- **READ THIS BEFORE TELLING DAN HOW MANY WORKERS RUN (#5110, 11 Oct):** the `fill shape: Nw+Mt` line is only the SHARED pool (and the master on/off). When `FILL_WORKERS_<ACCOUNT>` is set (now `go.mjs loop max 8|pro 2`), that account runs exactly that many workers, times the quiet factor (08:00-14:00 ET = 0.5x: Max 8->4, Pro 2->1), held by each account's usage caps, API quota, `fill.maxTotal` x factor and open issues. `go.mjs status` prints the real numbers on the `fill per account` line, with what runs on each account now. Report those, never the shape line. Check: `acctplancheck`.
- **Worker/tester split is automatic (#4549; Dan, 8 Oct: "I shouldn't have to make this ratio decision anymore"):** `fillShape` in `tools/brain/route.mjs` picks workers from the REAL claimable queue and the drain rate (workers = ceil(queue / (drain x 0.5 h)), clamped 1..`fill.maxWorkers`), halves them when the lander is deep or master is red, moves one slot at most every 30 min, keeps the previous shape and mails the fixer if an input is unreadable. `go.mjs status` prints the shape and why. `roles.json` holds only the bounds (total slots, caps, quiet window). Opening Gate M stays Dan's.

- **The full suite (#6767/#7184, Dan 13 Oct):** runs on the public test mirror (16 hosted shards, `tools/infra/mirror/ci-full.yml`; the PC only snapshots, waits and aggregates) every 2 h via the `full-suite` workflow `schedule` (and `workflow_dispatch`; `source=pc` runs it all on the GPU PC as a reference). Repo variable `FULL_MODE` = `on` (reds open one RED issue per check, `master is red`), `dry` (measure only: `_status/full-dry-<source>-<sha>.json`, no issues) or `off`. A failed stage is retried once on its shard (passes the second time = `flaky`, never red). Stages in `tools/hosted-unfit.json` need a real GPU/CPU and are not run on the mirror. Turning it off: set `FULL_MODE=off`. Checks: `fullmirrorcheck`, `fullshardcheck`, `testmirrorcheck`.

- **Priority lane (#2632; Dan, 4 Oct):** the lander takes PRs labelled `priority` before the rest (each group oldest first). Only the commander adds it, for Dan's bug fixes and infra PRs stuck behind a deep queue; it is never a way for workers to cut in.

- **Plugins (#1852; Dan, 3 Oct):** every session loads the `ponytail` plugin (github.com/DietrichGebert/ponytail): declared in `.claude/settings.json`, installed by `tools/brain/launch.mjs` before each brain run. Its intensity is `tools/brain/roles.json` `plugins.ponytail.mode` (lite|full|ultra|off), set to `lite` by Dan (3 Oct). It steers toward writing LESS code: keep it low so workers never do less than their issue asks.

## The rules that stay (Dan's; everything else was machinery)

- **Parity**: worldgen and rendering may be cheap; everything else matches vanilla 1.18.2 exactly (CLAUDE.md).
- **One self-contained .html, runs from `file://`, WebGL2 default + WebGPU, pure JS, world -64..256.**
- **Never guess a number the game owns.** Take it from the jar, `.decomp/` or the referee.
- **Anti-vacuity**: a check that cannot fail does not count.
- **No polling.** Never sleep or loop waiting on a job. Results arrive as GitHub checks and notifications; read
  them once.
- **Dan is not a programmer.** Plain English, and ask only real decisions, in the multiple-choice format.
- **An open phase issue lists what is still OWED in that phase, not the whole phase.** Most of each phase is already
  built (mobs, AI, spawning, combat all exist). Before describing, splitting or estimating a phase, read its ✅/◐ marks,
  `src/` and the core checks - never infer what is missing from an issue title (29 Sept: a commander told Dan mobs did
  not exist yet).
- **Priority is the milestone order** (Track G phases in order). Dan's own bug reports go into the milestone they
  belong to, labelled `dan`, and go first within it.

## Cloud sessions and the relay

A claude.ai/code session's proxy lets it READ the GitHub API and PUSH its own `claude/...` branch, and refuses every
API write. `go.mjs` handles this by itself: a refused write (claim, mail, hand-off, PR) becomes an op commit pushed to
the session's branch, and `.github/workflows/relay.yml` performs it on Dan's express runner within about a minute.
Nothing to do by hand. A claim made this way is optimistic: `go.mjs check` confirms it once the relay has run.

## Accounts and usage

Two Claude accounts (Max on user@, Pro on user@) feed the brain; `tools/brain/roles.json` `accounts` and `fill` say which pool each runs and the caps. Weekly limits are a hard stop or a WAIT-to-reset on every account, whatever the plan term. Read the real numbers with `node tools/go.mjs usage` (or `Projects\USAGE.cmd`), never from a document: a figure written here goes stale the day it is written.

## One-time setup (already done on Dan's machines; only needed on a new account or PC)

- **Runners (#3568):** `node tools/go.mjs runner list | quarantine <name> | restore <name> [--labels gpu,express]` - brain, commander and fixer sessions call it themselves. `full.mjs` quarantines a runner by itself when a run fails >15 stages, >10%, or starts with a setup stage (`pack-*`): ONE `runner <name> environment fault` issue (labels `env-fault`, never handed to a worker), NO per-check RED issues, mail to fixer + commander. The runner gets `gpu` back only when `.github/workflows/smoke.yml` (build + core + pack-entities + a browser stage) passes on it; the brain health pass re-dispatches smoke every 30 min while a fault is open. A new gpu PC must register with labels `mclite,smoke` and NO `gpu`.
- **New PC:** double-click `Projects\SETUP-PC.cmd` (runner + usage service; reads the token Syncthing already carried over).
- **New Claude account, cloud:** at claude.ai/code, make an environment with repos `mclite` + `mclite-store` and the
  variable `GH_TOKEN` = the contents of `Projects\_secrets\github-token.txt`. Then type `cloud session`.
- **Workers:** the brain runs them. `LOOP-ON.cmd` / `LOOP-OFF.cmd` (or the phone app) set how many. This project never uses app scheduled tasks, triggers or cron.
