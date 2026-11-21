# CLOUD.md — MC-Lite cloud sessions (claude.ai/code, no PC needed)

Dan, 23 Sept 2026: an infra task beside the loop; "make sure the 2 loops never conflict"; jars in a PRIVATE
GitHub store; "CLOUD SHOULDNT WORK ON WORLDGEN"; "no boondoggling — theres plenty of work, and especially
testing to do". The cloud credit on the Max account ends at the start of 30 Sept 2026 — until then cloud
sessions are how it gets used.

## 1. Dan's one-time setup (about 2 minutes)

1. **The store repo.** It must exist as `owner/mclite-store`, **Private**. The infra task pushes
   it from your PC through the runner; if its answer says `DAN-STEP`, open https://github.com/new, name it
   `mclite-store`, tick **Private**, no README, Create — the next infra pass pushes into it.
2. **The environment.** At https://claude.ai/code, start a new session and choose **both** repositories:
   `owner/mclite` and `owner/mclite-store`. (Without the store the bootstrap stops
   and says so — nothing breaks.)
3. **Type `cloud session`** as the first message (D-779). It keeps going on its own until the order is empty,
   the credit runs out, or `CHAIN_STOP`.

If claude.ai/code only lets the session push the `claude/<name>` branch it created, that is fine: `start`
stays on it, `close` accepts it, and `fetch-cloud.mjs` fetches `claude/*` too — only commits made by
`session-cloud.mjs close` carry the Suite line the loop looks for.

Several cloud sessions can run at once: each works on its own branch, and `start` hands each a different item
(claims + race resolution in `tools/cloud/claims.mjs`, D-779).

## 2. Starting a cloud session (D-779, 27 Sept: "i should have to just say cloud session")

Dan opens a session at claude.ai/code (repos `mclite` + `mclite-store`) and types **`cloud session`**. Nothing else.
`CLAUDE.md` routes those two words here, and the project's software does every piece of bookkeeping:

| step | done by | what the session no longer does by hand |
|---|---|---|
| pick the next item | `session-cloud.mjs start` ← `docs/cloud-order.json` + archived units (`reland-*`, first) | read QUEUE, choose, type an item name |
| claim it | start writes `## Item/## Status` in the findings file, commits, pushes | write the claim, push it |
| settle a race | start re-reads every live claim after its push, waits ONE fixed 20 s (D-781) and re-reads again: earliest wins, the loser yields and takes the next item (`claims.mjs`) — sessions can be started at the same moment | notice a duplicate hours later; stagger starts |
| release dead claims | a claim is live only on an UNMERGED branch, status `working`, pushed < 2 h ago | relinquish by hand |
| stack earlier units | start merges every unmerged `claude/*`/`cloud/*` branch | merge other branches |
| hand-off | close writes the unit block from `--done/--left/--finished`; start prints the item's last hand-offs | write findings sections |
| master moved | close parks the work, merges `origin/master`, re-fences | `git merge origin/master`, close again |
| suite in two halves | close with no `--part` runs the next unrecorded half — the SAME command, twice | count parts |
| land on master | `reconcile.mjs` on the PC (queued by every PC `close`) builds branch `cloud-merged` in its OWN worktree (D-816: never master's tree): merges oldest-first, union-merges `build.mjs`, archives real collisions as `cloud-archive/*` tags (→ `reland-*` items), releases claims, pushes, prunes what master contains. The next PC `close` merges `cloud-merged` into master; cloud `start` merges it too | merge branches, delete branches |
| PC loop shares the list | `session.mjs start` claims the next item as `cloud/pc-loop` (`pcclaim.mjs`), close hands off and releases it (D-816) | the PC and the cloud working the same item |

**The session's whole loop** (this is the prompt — `CLAUDE.md` points here):

```
MC-Lite CLOUD session (Dan approved; valid until CHAIN_STOP in session-cloud.mjs). ONE unit per session (D-832, Dan's small-session rule: ~75 tool calls, a long session re-reads its whole context every turn) — then report and STOP; Dan starts a fresh session for the next unit:
1. `node tools/cloud/session-cloud.mjs start` — work ONLY on the YOUR ITEM it prints, using its HOW and HANDOFF lines. If it FAILS, tell Dan its fix line in plain English and stop.
2. Never: master, worldgen, docs/DECISIONS|QUEUE|NEXT|KNOWN-WRONG|STATE.md, cloud-order.json, cloud-ledger.json, polling, guessed numbers or hand-typed models (use .decomp/, the extractors, the referee).
3. New checks go in a NEW tools/stages.d/<slug>.json, each proving it can fail. Every ~20 tool calls run `node tools/cloud/session-cloud.mjs check` (D-829): OWNER = carry on; YIELD = another unit claimed your item first — discard the work (`git reset --hard HEAD && git clean -fd`) and go to 1. close runs the same check and refuses to push a lost item, and refuses a unit that never ran start.
4. At ~65 tool calls, or when the item is done and proven: run the CLOSE line start printed (add --finished only if the WHOLE item is done), repeating the same line until it prints OK. Then 2 plain sentences for Dan and STOP. Never start a second unit in the same session, even if asked to "keep going".
```

The order itself (`docs/cloud-order.json`) is written by the PC loop from `docs/QUEUE.md` 0.00; an item marked `"ask": true`
(mob sounds) is never handed out — start says "waiting on Dan" instead. `tools/cloud/claimcheck.mjs` proves the ledger
(race, TTL, merged-releases, idempotent hand-off) with anti-vacuity; it is in `tools/stages.d/cloud.json`.

~~Old prompt (D-778, `/loop … follow docs/CLOUD.md section 2 exactly`, hand-written `## Claim:` lines)~~ — replaced by
the above; the three-shulker-AI duplication of 27 Sept is why (D-779).

**Browser stages.** Proven 24 Sept in a fresh 2-core container: the bootstrap, the build and every
non-browser check run (only real reds); the browser stages do NOT — SwiftShader on 2 cores never gets the
game drawn in time (titlecheck/smoke/mobdrawcheck: `renderer=none`, unlit ground). So on a container with
fewer than 4 cores `close` runs the suite `--fast` and its commit line says the browser stages are left to
the PC lane; the loop runs them after merging. `close --browser` forces them.

## 3. How the two loops never conflict

| | PC loop (`.claude/loop-prompt.md`) | cloud session (this file) |
|---|---|---|
| writes master | **yes — the only writer** | never |
| branch | master (merges others) | `cloud/<slug>`, pushed to GitHub |
| worldgen | yes | **never** (`session-cloud.mjs close` refuses `WORLDGEN_PATHS`) |
| files master changed after the branch's base | yes | **never** (D-772: close refuses → `git merge origin/master`; `fetch-cloud.mjs` re-checks at merge) |
| new suite stages | edits `tools/suite.mjs` | a NEW `tools/stages.d/*.json` |
| QUEUE rows 9–12 | not until 30 Sept | yes, bottom-up |
| long jobs | Windows runner (`lane.mjs`) | foreground in the container |

The loop lands cloud work with `tools/cloud/reconcile.mjs`, queued by every PC `session.mjs close` (D-779): merge
oldest-first, union-merge `build.mjs`, archive real collisions (`cloud-archive/*` tags → `reland-*` order items),
release claims, push, prune. `docs/cloud-ledger.json` is its record. (`fetch-cloud.mjs` still lists what is waiting.)
`tools/cloud/cloudcheck.mjs` (suite stage via `tools/stages.d/cloud.json`) keeps the fence honest in both directions.

## 4. The pieces

- `tools/cloud/make-store.mjs <dir>` — builds the store (PC side): jars as-is, `.mcdata` (minus the worldgen
  chunk cache), `.mcsnd`, `.decomp` as gzip'd tars in < 90 MB parts, `MANIFEST.json` with every sha256.
- `tools/cloud/bootstrap.mjs [--store <url|dir|bundle>]` — fresh container → store cloned and verified →
  files in place → Chromium (`/opt/pw-browsers` or get-chromium) → `node build.mjs` → `suite.mjs --fast`.
- `tools/cloud/session-cloud.mjs start|close` — above. `close --dry` shows the fence + suite without committing.
  `close --part N/M` runs 1/M of the stages; parts are recorded per staged tree in `.git/cloud-suite.json`
  and the commit happens only after the last part (same tree). close resets `BUILD_OUTPUTS`
  (`src/19_data.gen.js`: a Linux build deflates it to different bytes) before staging, and reads the suite's
  output from a file, never a pipe (a piped stdout lost its tail at `process.exit`).
- **I5 gate, 24 Sept 2026** (fresh 2-core container, store bundle + master `61be2a6`): start (bootstrap 1 s
  after the store clone) → a findings file → `close --part 1/2` (3 min 20) + `--part 2/2` (1 min 30) →
  pushed `cloud/i5test` → `fetch-cloud.mjs` from a loop clone: `MERGE`, suite line carried. Reds at that
  master: briefcheck (docs/state.json stale on master), mobdefaultscheck (real findings).
- `tools/cloud/fetch-cloud.mjs` — the loop's side.
