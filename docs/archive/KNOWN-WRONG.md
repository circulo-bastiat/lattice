# KNOWN-WRONG — what this project already knows is wrong, so nobody rediscovers it

⚠ **SEARCH THIS WITH THE TOOL, NEVER WITH `grep` ON AN INDEX.**

```
node tools/knowncheck.mjs --find <word>
```

It searches entry **bodies**, not just titles, and it refuses to answer from an index that does
not match this file. MineHTML learned that the expensive way: a false NO from grepping a
bodyless index cost session 120 a published claim.

## Format

Each entry is `### KW-<n> <status> <severity> — <title>`, then free prose. Status is `open` or
`struck`. Severity is `severe`, `warn` or `note`. **Nothing is ever deleted** — an entry that is
no longer true is marked `struck` and keeps its body, because the fact that we once believed it
is itself worth knowing.

---

### KW-1 open severe — the WebGPU path renders the world black on real hardware
GUI draws fine; the world is black. F9 falls back to WebGL2 and fixes it. WebGL2 is the default
until WebGPU is proven. ⚠ The VM cannot settle this: GPU passthrough was reverted on 9 Sept
2026, so the VM measures the **software-rendering floor** and a green there says nothing about
real hardware. This needs one of Dan's actual PCs.

### KW-2 struck severe — `cullcheck`'s occlusion-flood determinism claim fixed (D-743, session 148)
The occlusion flood is exact in the near field (0 px at render distance 4) and invisible in play
(0 px with the sky drawn), but its dropped SET varies frame to frame at the fogged horizon
(3,268 px). §2f's claim is stronger than D-173's accepted design. **The decision owed is whether
to make the flood deterministic per frame or to restate the claim with the fogged band named
(D-356).** ⚠ NOT by moving a threshold — that is D-329 inverted.
⚠ **DECISION TAKEN (D-743, Dan, live, 25 Sept 2026): Option A — make the flood deterministic.**
Not yet implemented; queued as a concrete unit for the next pass that reaches it. This entry
stays open (not struck) until the fix lands and `cullcheck` §2f is actually green.
⚠ **Session 147: still not implemented.** A worker inspected `floodVisible`/`floodHas`
(`src/10_gfx.js`, fed by `src/05_mesher.js`'s `M.visibility`) and found a fixed-order BFS with no
Set/Map iteration in its hot path -- no in-algorithm nondeterminism by inspection. Unconfirmed
guess: `ch.vis[sy]` for horizon-band sections may still hold its placeholder (`0x7FFF`,
`07_world.js:1117`) instead of the real mesher mask (`07_world.js:1389`) when that section's mesh
job hasn't landed by flood time -- an async completion race, right where the wobble is. Could not
get a `cullcheck` baseline to confirm it (KW-20: run it via `lane.mjs`, not a direct `device_bash`
call).

⚠⚠ **Session 148: FIXED, verified by both worker 2 and the orchestrator independently.** The
orchestrator got the missing baseline (per KW-20: run it in the cloud Bash container, not
`lane.mjs` -- no cap there, no round trip): at the DEFAULT preset `cullcheck` was already clean,
but `MCLITE_PRESET=high` reliably failed section 3 ("turning around and back changed 128 pixels...
the cull state is not a function of the camera") with §2f's own floor inflated to 465-2642 px
across repeated runs -- confirming session 147's placeholder-race hypothesis and giving worker 2 a
fast, capless repro loop to fix against. The real defect turned out to be one level up from the
hypothesis: `cullcheck.mjs` already had a `quiet()` settle-helper meant to wait out exactly this
kind of in-flight-mesh race, but (a) every call site discarded its boolean return instead of
asserting it, and (b) it demanded the WHOLE render distance be mesh-dirty-free, which structurally
never happens at the outer 1-2 chunk rings (they need neighbour chunks that never stream in) -- so
it always silently "passed" without actually waiting. Fixed entirely inside `tools/cullcheck.mjs`,
no `src/` engine changes: `quiet()`'s dirty-radius capped to `max(4, rd-2)` (the same margin
`evictMargin` already treats as "the edge"), a new `mustSettle()` wrapper that actually asserts
settling succeeded before every determinism-critical comparison (§2f, §3 -- including a second
settle after §3's 180° turn that was missing before), §2f's own render distance clamped to
`Math.min(ambient, 6)` so its exact-identity claim is provable in a real time budget, and random
block ticks frozen for the check's run (same pattern as D-434's mob-spawn freeze). Orchestrator
independently re-verified on the actual merged master build (commit 0c606b0, not just worker 2's
branch): default preset 40/40 clean, `MCLITE_PRESET=high` 40/40 clean on THREE separate runs.
Struck. Named, out of scope, for whoever next touches `src/07_world.js`'s tick plumbing:
`Main.worldTick` calls `World.randomTick` with no `speed` argument, so a player's `/gamerule
randomTickSpeed` is never actually wired to it (always the hardcoded default of 3).

### KW-3 open severe — `--fast` does not see the game, and a partial run is not a green suite
The six browser stages are the only checks that look at the picture, and `cdp.mjs` prints SKIP
and exits 0 where there is no Chromium — by design. The summary line naming every stage that did
not run is not decoration. Separately, a full `--fast` does not fit one remote-shell call
(~180 s), so `--only` / `--from` / `--to` exist and a partial run **prints that it is not a green
suite** (D-218). Both together mean a green can be reported over a game nobody looked at.

### KW-4 open warn — the browser checks default to a machine Dan does not play on
`detect()` clamps to CELERON on a two-core box, so five sessions of browser checks ran at render
distance 4 with FAST leaves — the one setup where the flash cannot happen and the fancy leaf path
is never drawn. He plays at medium and above. Force it: `MCLITE_PRESET=medium` (D-196).

### KW-5 open warn — ten right-click interactions are named and not built
D-361 built right-click and audited the rest of Dan's list. Ten interactions are named with the
stage each waits for, spawn eggs among them (G18). `usecheck` holds the list closed, so this is
tracked rather than forgotten — it is here so nobody re-audits it.

### KW-6 open severe — nothing restarts the ai-jobs bridge after a reboot
The runner is started by hand from the dashboard (`AI-7600.bat` → "Restart runner here", which
calls `harness/tools/runner_ctl.js`). `runner-restarts.log` has no entry after 27 Aug
2026 and `ai-jobs/done/` had nothing newer than 9 Sept when session 14 looked — a week of no
jobs. The VM bridge survived the same 8 Sept Windows update because it is a registered scheduled
task with a logon trigger. **The fix is to register the runner the same way** — `runner_ctl.js start`
under a logon trigger — and it has not been done.
⚠ **AND THE NAME IS A TRAP.** `run-bridge.bat` was deleted in s153 and parked in
`_to_delete\s153-archaic-launchers\`, but MineHTML's `CLAUDE.md` §4 and §5 still tell a session
to ask Dan to start it, and `harness/tools/brief.js` PRINTS that instruction whenever the runner
looks down. Session 14 read it, believed it, and repeated it to Dan three times. See KW-11.

### KW-7 open severe — the connected-folder mount can serve a stale first read
Session 14 read `ai-jobs/runner-status.json` and got a copy **seven days old** that said
`"alive": true`; six seconds later the same file was ticking. A cached or mid-sync first read is
indistinguishable from a dead process if you read once. **Any tool that decides something from a
file's timestamp on this mount needs two reads** — `node tools/bridgecheck.mjs` (D-363).

### KW-8 struck warn — MC-Lite's referee data had a second home inside MineHTML's repo
`C:\claudeisthegoat\claudeisthegoat\_scratch\mclite` is **609 MB** of MC-Lite pregen and mapping
data, kept there because the jobs lane refused any working directory outside that folder. The
lane now accepts `root: mclite` (16 Sept 2026), so the copy is no longer needed — and it is
inside the Syncthing mirror, so it is 609 MB on both PCs. It has not been moved yet.

### KW-9 open note — transfer archives keep coming back
`mclite-xfer.tgz`, `snd-xfer.tgz` and three `mclite-src*.tgz` were written in 36 hours on 15–16
Sept, in a project whose `AGENTS.md` said the tar shuttle was dead. They are gitignored. A
tarball is what a session reaches for when it believes it has no path to the disk — the belief
was the bug (AGENTS.md §8), and the archives are the symptom to watch for if it returns.

### KW-10 struck note — there is no suite ledger, so "the last run was green" is never a fact
Nothing records a suite run, so `brief` reports the last run as **not measured**. That is the
honest shape and it is also a gap: a remembered green is not a green, and today nobody can tell
a fresh green from a two-week-old one.

▶ **KW-10 struck 20 Sept 2026 (D-408):** `suite.mjs` writes `.ledger/suite-last.json` and, for a full
run, `.ledger/suite-full.json`; `session.mjs close` queues a full run on Windows every session.

### KW-11 open severe — the docs name a launcher that was deleted three weeks ago
`run-bridge.bat` was deleted in s153 (28 Aug 2026) and parked in
`_to_delete\s153-archaic-launchers\`, together with eleven other entry points, because each one
"knew a different part of the truth". `AI-7600.bat` — a dashboard on `127.0.0.1:8390` with a
**"Restart runner here"** button calling `harness/tools/runner_ctl.js` — replaced all of them.
⚠ **MineHTML's `CLAUDE.md` §4 and §5 still tell a session to ask Dan to start `run-bridge.bat`,
and `harness/tools/brief.js` PRINTS that instruction whenever the runner looks down** — so the
error is generated fresh, on demand, by the tool that is supposed to be the cure for stale
documents. Session 14 read it, believed it, told Dan three times, and wrote the dead name into
four MC-Lite files before catching it. Those are corrected; **the MineHTML side is not**, and it
will keep producing the error until it is.
▶ The general shape, which is the reason this is `severe` rather than `note`: **a generated
document is only as fresh as the facts it was written from.** `brief.js` re-derives every
NUMBER and hardcodes this SENTENCE. A number that cannot go stale sitting next to an instruction
that can is the most convincing kind of wrong.

### KW-12 struck severe — `doccheck`'s citation-scan trap only worked on Linux
Found 16 Sept 2026 **by the first job ever run through the ai-jobs lane in this folder**, which
is the whole argument for having the lane. §9's trap "the citation scan reading only some files"
asserts `from(93).includes('src/')`. The path it tests is built with `f.slice(ROOT.length)`, which
on Windows is `src\02c_states.js` — **backslash** — so the trap went red the moment the suite ran
on Windows instead of on the Linux side of the device bridge. The check was right and its path
spelling was platform-dependent.
▶ Fixed by normalising the separator at all three sites. **Struck rather than deleted because the
class is not fixed:** every check in this repo has only ever run on Linux, and this is the first
evidence that some of them encode that. ⚠ Expect more when the full suite runs on Windows for the
first time — and note the shape, which is worse than a plain bug: **a check that passes on one OS
and fails on the other is a coin flip with a history.**

### KW-13 open severe — a mirror is not a backup, and two of the three projects have neither
Audited 16 Sept 2026. MineHTML has both a Syncthing mirror and a GitHub remote, and is safe.
**MC-Lite had 97 commits, no remote, and was not one of Syncthing's two folders** — one disk.
**The VM folder had no version control at all**: the host bridge, the Windows GUI agent, the
UI-Automation wrapper, the displayed-FPS harness and nine docs, none of it rebuildable by
`1-INSTALL.cmd` because that script is in the folder too.
▶ Partly addressed the same day: both now have git bundles in `C:\claudeisthegoat\_backups\`,
which **is** a synced folder, so they reach the second PC within seconds; the VM folder is now a
git repo with the keys and the 56 GB of `.vhdx` excluded; `tools/backupcheck.mjs` fails when HEAD
is not inside the newest bundle; and `ADD-MCLITE-TO-SYNC.cmd` is written and **not yet run**.
⚠ **STILL OPEN, and this is why it stays `severe`:** neither has a REMOTE. A bundle and a mirror
both live on hardware in one house. ⚠ And keep the two straight — a mirror propagates a delete in
seconds and keeps 30 days of `.stversions`; a bundle is frozen history. They protect against
different things and neither substitutes for the other.

### KW-14 open warn — the VM folder holds 11 GB of parked virtual disk
`tentativevirtualmachine\_to_delete\claude-windows.vhdx.20260905-210222` is an old Windows guest
image from the 5 Sept rebuild. The folder totals about 67 GB, of which 56 GB is the live `vm\`
directory and 11 GB is this. ⚠ Unlike the MineHTML shadows this is **not** in the Syncthing
mirror, so it is 11 GB on one disk rather than two. It is gitignored. Nobody has confirmed it is
disposable, so it has not been touched.

### KW-15 open warn — the standing ban on Fable was priced per token, and this workload is cache-shaped
`docs/AGENTS.md` §2 records **"Fable is rejected and must not be re-proposed"** (Dan, MineHTML:
*"I do not have infinite money"*), on the ground that its per-token price is the highest of the
family — input $10/MTok against Opus's $5, output $50 against $25.
⚠ **Its cache reads are $0.025/MTok against Opus's $0.50 — twenty times cheaper** — and on a long
agentic session cache reads are the bill: **67.9% of this one**. Priced on this session's exact
token shape: **Opus $107.17, Sonnet $42.87, Haiku $21.43, Fable $72.37.** The nominally most
expensive model came out at **68% of Opus** for this shape, because a long session is almost
entirely re-reading its own conversation.
⚠ It is not a general win. Fable's cache WRITES are $20/MTok and its output is $50, so it loses
badly on short, chatty, write-heavy work and wins on long, cache-heavy runs. Which this is.
▶ **This is recorded, not re-proposed.** The ban stands until Dan moves it; his rule is his.
What is new is that the ground it was decided on — per-token price — is not the ground this
workload is billed on, and the precedent for re-opening a ruling on new measurement is his own
(`STANDING-ORDERS.md` §24.7d, declined, then reversed five hours later to build `usage_meter.js`,
on the stated ground that cutting usage without measuring it is guesswork).

### KW-16 struck severe — an owed row whose reason has expired sits there until somebody notices
Found 17 Sept 2026 by the audit. `Rs.OWED_SOURCES.daylight_detector` says *"sky light and a time
of day — G16 builds both"*. **G16 has been complete since session 9.** The excuse expired five
sessions ago and the detector has been buildable ever since; nothing said so, because nothing
asks the question. `lectern` has the same shape ("G8 item stacks in a block entity", G8 complete)
and survives only because it also needs a screen.
▶ This is **D-324's rule failing in the other direction.** D-324 says *a documented limitation
should carry an assertion that fires when the limitation ends* — and it does, for limitations
whose end is a MEASUREMENT. It does not, for limitations whose end is **another stage completing**.
▶ The fix is `tools/stagecheck.mjs` (pass 15, JOB 1): it fails on any owed row citing a stage that
is already ✅, across all eight owed lists. Until that check is in `suite.mjs`, assume there are
more of these than the two found by hand.
▶ **Struck 28 Sept** (issue #13): `tools/stagecheck.mjs` was built, registered in `tools/stages.d/`
and `suite.mjs`, and both named rows were fixed — `daylight_detector` wired up for real (PASS 15
JOB 2: `Sky.sunAngle` + `Sky.weather`, referee-checked) and `lectern`'s row narrowed to name only
what is still missing (the screen, G19e), not the whole signal rule. `stagecheck --roster` now
scans all eight owed lists and finds zero rows citing an already-✅ stage. This entry stays
struck rather than deleted for the same reason KW-17 does: the audit found this row stale by hand
five sessions after it expired, which is the exact cost `stagecheck` now makes impossible to repeat
silently.

### KW-17 struck severe — "G19" meant four different things and "G20" meant two
`docs/PLAN.md` carried **two** `### G19` headings twenty-three lines apart (right-click, shipped
as D-361; and the Nether and the End, not started), while `15f_options.js` used "G19" for
advancements and statistics and `02j_sounds.js` used it for music and ambience. `G20` was
statistics in PLAN and farming in `14l_use.js`. `02j_sounds.js` also cited a `G16c` that has never
existed.
▶ **Struck 17 Sept**: Dan ruled renumber-cleanly, the roster is in `docs/PLAN.md` (shipped stages
keep their numbers; the Nether/End became **G27** and statistics **G26**; eight new stages took
G17e, G18a–f, G19b–e, G20–G25), and `tools/stagecheck.mjs` holds it closed.
▶ **Struck rather than deleted because the class is not fixed:** the collision was possible
because no machine ever checked that a stage id in a comment referred to a stage that exists.
Every owed gap in this codebase names the stage that will close it, so the id is load-bearing —
and it was the one piece of this project's own discipline that nothing enforced. See KW-16 for
what it cost.

### KW-18 open note — a check run on its own against stale `assets/` dies with a RangeError
Found 17 Sept 2026. `node tools/coherecheck.mjs` on a checkout whose `assets/` predates `src/`
throws `RangeError: Offset is outside the bounds of the DataView` out of `R.decodeConstants`,
five frames deep in an `eval`'d engine. It is not a bug in the engine: `assets/` is GENERATED and
deliberately never preserved between sessions (D-6), `suite.mjs` rebuilds the whole data pipeline
as its first stages, and `node build.mjs` on the same tree exits 0.
▶ The defect is the **error**, not the state. `build.mjs` already refuses a stale data module and
NAMES the asset (D-318); a check that loads the engine directly should do the same thing instead
of dying inside a decoder. ⚠ The cost is a session losing time to a stack trace that looks like a
corrupt file, which is the most expensive kind of misleading error.
▶ Cheap fix, for whichever pass touches it: `tools/loadsrc.mjs` asserts the constants blob's
header against `src/` before decoding, and says "run `node tools/gen-data.mjs`".

### KW-19 open severe — `backupcheck` wrote every bundle into the project itself and passed
Found 20 Sept 2026 (session 46, D-407). On Linux, `backupcheck`'s Windows candidate
`C:/claudeisthegoat/_backups` is a RELATIVE path, so `--write` from `device_bash` created a literal
`C:` folder inside `mclite/`, put the bundles there, and on the next run found HEAD in its own
stray bundle — green, with nothing reaching the Syncthing mirror. (`.trash/stray-C-dir-20260917`
shows it happened once before and was tidied without the cause being named.) KW-13's "partly
addressed" was therefore not true for MC-Lite. ▶ Fixed: the Windows path is used only on win32
and `--write` refuses to create a missing mirror folder. ⚠ **Still open:** the check is honestly
red until a bundle lands in the real mirror — connect `C:\claudeisthegoat` to the session or
copy `.trash/mclite-*.bundle` there by hand.

### KW-20 open warn — four browser stages do not fit one `device_bash` call
Every `device_bash` call is its own sandbox (`bwrap --die-with-parent`, fresh PID namespace):
at ~180 s it is killed with everything it started, so `setsid nohup` does NOT keep a job alive
(NEXT.md used to say it did). `palettecheck`, `cullcheck`, `flashcheck` and `lumacheck` run longer
than that (D-457 confirmed `lumacheck` belongs on this list too — its own default soak alone is
75s, well before Chrome startup, world-load or reporting are added).
▶ Workaround, D-407: run those four in the cloud container (Chromium at `/opt/pw-browsers`, no
cap); they import only `cdp.mjs` and `pngdec.mjs`, so staging four files and `dist/mclite.html`
is enough. The permanent fix would be splitting each into phases a call can hold.
⚠ D-457 — WHAT THIS ENTRY IS NOT: it is a call-length ceiling, not a connectivity failure.
`device_bash`'s own Linux VM launches and drives Chromium fine (`diagcheck`, well under budget,
ran there and found a real bug). A different session's note ("Chromium's remote-debug port never
binds") mixed the two up; corrected in NEXT.md.

### KW-21 open warn — no machine but this one has a copy yet, and the VM tooling tracks a password
D-408 first built a pull-mirror in the VM's LINUX guest with SSH deploy keys; Dan wanted it in the
WINDOWS guest and wanted it simple, so D-409 removed it (cron, keys, `~/mirror`) and replaced it with
`sync\SETUP-SYNC.cmd` — Git over HTTPS with Git's own one-time sign-in, no keys. ⚠ It has been
tested on this PC only (clone + fast-forward, both repos). The second PC and the Windows VM have NOT
run it. ⚠ MineHTML's GitHub default branch is not the `workspace` branch its sessions work on, so its
copy can lag; MineHTML is read-only to MC-Lite sessions — raise it there. Separately, the VM tooling
repo tracks `host/lib/guest-secret.json` (guest console password, plaintext) and
`guest/cloud-init/user-data`; untrack both and rotate the password before it gets a remote.

### KW-22 struck severe — `lumacheck` FAILED on real hardware at medium: the sky flashes
Found 20 Sept 2026 by the first full suite on Dan's Windows PC (Edge, real GPU, D-408's lane):
*"2 run(s) of >=2 frames sat 0.25 above the flight's own median sky: longest 111 frames"*,
preset medium, 1,909 frames. The same check passes under SwiftShader (D-407). This is the white-flash
class Dan reported repeatedly; D-247 said the fifth cause was `desynchronized: true` and that a
return means D-247 is WRONG — do not stack a sixth cause without first re-reading D-247. Reproduce:
`node tools/lane.mjs run luma — node tools/lumacheck.mjs dist/mclite.html --seconds 75` (preset via
suite: `node tools/suite.mjs --only lumacheck --preset medium`).

**STRUCK (D-411, 20 Sept 2026): it was never a flash.** The photographed frame is a healthy savanna
river valley whose far terrain fades into fog; the check counts fog colour as sky and scored it
against the flight's GLOBAL median. On Dan's GPU the 75 s flight covers ~800 blocks (software: ~170),
so it reaches terrain software never sees. D-247 stands; no sixth cause was found because there was
no fifth-and-a-half defect. The rule now scores a frame against its own neighbourhood.

---

### KW-23 struck warn — the spider's eight legs have no `setupAnim`, so they stand out as straight bars
⚠ **STRUCK the same session it was written (D-416).** Both halves are done: the extractor's
hoisted-builder reuse now carries its boxes' texture and mirror flag and stops leaking them onto
the next part (the spider is 11 parts, not 12 with a duplicated name), and `SpiderModel.setupAnim`
is ported from `elg.a`'s own bytecode behind `ER.modelKindOf`. The body below is what was true
before that, kept because the reasoning — a pose on the wrong boxes proves nothing — is the
part worth remembering.

D-415 gave every mob the `LivingEntityRenderer` base pose and the shared `setupAnim` of the two
base classes (`HumanoidModel`, `QuadrupedModel`). `SpiderModel` is neither: it is its own override
and it sets `zRot` and `yRot` on all eight legs from constants, plus a `limbSwing` sway. Nothing
here does, so a spider's legs sit at their constructor rest angles — sixteen-unit bars sticking
straight out sideways. It looks wrong the moment you spawn one and it is not a regression: the
legs were always like that, they were just upside down as well and nobody could tell.

⚠ There is a second half to it, in the extractor rather than the renderer: the spider's leg
builder is stored in a local and reused for all eight legs (`astore_3` / `aload_3`), and
`tools/extract-models.mjs` reads that reuse only once with `!box` guarding it — so the layer ships
`right_hind_leg` TWICE (once at x −15 and once at x −1) and most of the legs lose their
`texOffs(18, 0)` and come out at (0, 0). Fix the extractor's local-box reuse before writing the
`setupAnim`, or the pose will be applied to the wrong boxes.

### KW-24 open note — the WebGPU backend has no sky pass at all
`11_gfx_webgpu.js` contains no `drawSky`, no sky pipeline and no sky shader: the sky is WebGL2's
alone, and on the WebGPU path the clear colour is all there is. CLAUDE.md's hard constraint 3 says
both backends must render identically, so this is a real breach of it — it just cannot be SEEN
today because KW-1 (the WebGPU world renders black on real hardware) makes the path unusable
anyway. D-415's horizon fade is therefore also WebGL2's alone. Whoever fixes KW-1 inherits this.

### KW-25 open warn — the two survival doors ask different rules, and worldgen asks the weaker one
`World.setBlock` asks `States.rule` first — the jar-derived table D-346 read out of vanilla's 55
`canSurvive` overrides — and falls back to the material-derived support CLASS only where the jar
has no rule for that block. `Features.setBlock` never got that second half: it asks the class and
the feature-time `fsv` families and nothing else. D-346 found a finished rule with no caller; this
is the same shape one door along.

**Measured (D-418, `tools/featgroundcheck.mjs` §3, 121 chunks at seed 1337):** every one of the
13,799 feature-placed blocks that carries a survival rule carries a **jar** rule — **zero** are
judged by the class alone — and **12** of them stand somewhere the live rule will not have them.
They are glow lichen, small dripleaf, vine and amethyst buds, all underground, all placed by
worldgen and all due to be broken by the first edit near them.

⚠ **THE FIX IS NOT A LINE, WHICH IS WHY IT IS HERE AND NOT DONE.** `surviveRuleInner`
(`07_world.js`) is 440 lines of switch bound to `W.getBlock`/`W.loadedAt` and, for 13 of its 40
rules, to light (`rawBrightness`, `canSeeSky`), to tags (`tagBelow`) or to the grow helpers. The
other 27 need only `getBlock`/`loadedAt`. The unit is a LEVEL INTERFACE the switch is written
against, with a worldgen implementation that answers the pure questions and returns the
unanswerable sentinel for light and tags — the same `-1` the World side already returns for an
unanswered tag. Two things must be decided with it: whether the shared module goes into the
worker bundle (build.mjs's own note says no worker asks a tag question, which the sentinel keeps
true), and what worldgen answers for a light-level rule.

⚠ A SECOND, SMALLER GAP RIDES WITH IT. `featgroundcheck` §2 scopes its floating-component claim
to at-or-above sea level, because below it the world is cut by carvers — a 240-block random walk
no point query can answer, which 04j's header and 04k's `maxFreeHeight` already name as this
pipeline's one approximation. **4 floating components per 121 chunks remain below sea level**
(a calcite, two vines, a glow lichen), printed on every run. Two of the four are the rule-gate
gap above; the calcite is a geode cell placed into carved cave air and is its own question.

### KW-26 struck severe — "only the guardian appears on the screen" was a WRONG FORWARD VECTOR (D-425)
⚠⚠ **THIS ENTRY IS KEPT, STRUCK, BECAUSE THE MISTAKE IS MORE USEFUL THAN THE ENTRY WAS.** It was
opened in the same session it was closed in, and everything in it was measured and wrong.

**What it claimed:** that every mob but the guardian was effectively invisible — guardian 3,098
px changed against cow 111, spider 68, turtle 54, with `ER.build` reporting `drawn: 1` and the
right quad count for all of them. The suspect named was the base-pose flip (D-415) against the
per-quad derived winding.

**What was actually wrong:** the measuring harness spawned each mob along
`[-sin(yaw), 0, cos(yaw)]` instead of the engine's own `Player.lookVec()`. Every mob went off to
the SIDE — into tree trunks and behind foliage. A mob's light is the light of the block its feet
are in (`ER.build`: `W.getLight(it.wx, it.wy, it.wz)`), a log's light is zero, and a mob lit at
zero is a **black silhouette** — which is what vanilla draws too. So the mobs were there, in the
wrong place, unlit, and the pixel counts were the truth about a bad test.

**What settled it** (D-425): the same mobs, spawned through `P.lookVec()` onto a spot the test
CHOOSES — open air, a solid floor, skylight 12+ — are all drawn, lit and textured:

| mob | pixels | mean brightness | colour spread |
|---|---|---|---|
| cow | 24,636 | 67 | 66 |
| guardian | 29,096 | 104 | 55 |
| dolphin | 22,443 | 183 | 30 |
| turtle | 17,973 | 102 | 69 |
| zombie | 17,679 | 92 | 90 |
| spider | 17,530 | 41 | 24 |
| skeleton | 13,580 | 129 | 21 |

and a screenshot of a brown-and-white cow, correctly shaded, standing in grass.

⚠ **THE REAL GAP IT UNCOVERED IS CLOSED, AND IT WAS A CHECK GAP.** `g18ccheck` has photographed
a live mob since session 30 and the mob it photographs is the **guardian** — the one type that
is not like the others (a cube with no `LivingEntityRenderer` preamble). Nothing had ever
photographed the other six. `tools/mobdrawcheck.mjs` now does: every spawnable mob, on a lit
stage it picks itself, asserting that the frame builds it, that it reaches the screen, and that
it is drawn **LIT and in colour** rather than as a black cut-out — because a silhouette changes
pixels and passes a naive "is it drawn" test, which is precisely what this entry fell for. Its
own anti-vacuity break stands a mob inside a solid block and confirms it goes dark.

⚠ **AND THE RULE THAT WOULD HAVE SAVED TWO HOURS:** ask the engine where forward is. `lookVec()`
exists; `g18ccheck` uses it; re-deriving it from the yaw is how a test ends up measuring a tree.


### KW-27 open warn — a sand disk overwrites coastal cane's cardinal water after cane is placed
D-455 fixed the heightmap waterline off-by-one that had kept sugar cane from generating at all
(0 → 101 water-adjacent bases in the seed-1337 41×41 sweep). One base in 101 is left dry: at
gen(211,63,100) the pre-feature terrain has water at the −x cardinal cell (`terrainAt` = water),
but the built world has sand there — a later feature (a `disk_sand`-class beach modification,
D-217) overwrote the water AFTER `patch_sugar_cane` ran and passed its water-adjacency predicate.
Vanilla runs disk / local-modification features BEFORE VEGETAL_DECORATION, so cane there would
see sand and never place; this engine's 3×3 decoration fill does not reproduce vanilla's
cross-chunk, step-by-step feature ordering, so an out-of-order overwrite can dry a placement. This
is a feature-ORDERING bug, distinct from the placement-geometry bug D-455 fixed and cross-cutting
(it can affect any feature whose predicate reads a cell a later feature changes).
`canefeaturecheck` §3 separates the two: it hard-asserts zero predicate false-positives (cane on a
never-wet cell) and reports the overwrite count against this entry. Fixing it means porting
vanilla's decoration order and is referee-sensitive (run `vanillacheck` after) — a session of its
own. Measured rate at seed 1337: ~1% (1/101).


### KW-28 struck warn — the F4 diagnostics panel's own repaint work is over diagcheck's budget
`diagcheck` sec6 measured, in this session's Linux VM at MCLITE_PRESET=medium: closed 80.10 ms/frame,
open+inert (D.paint replaced with a no-op, isolating compositing noise from the panel's own work)
85.63 ms/frame, open+repainting 97.89 ms/frame — the panel's own work is 12.26 ms/frame against
its budget of max(2.5, closedMs*0.05) = ~4.0 ms, about 3x over. `L.info()`'s D-434 fix (a cached
`staticInfo` object, so repeat calls no longer re-query the GL context) is confirmed still in
place and is NOT the cause this time; nothing else in `D.paint()` was isolated as the culprit.
Attempted to localise it further this session with a hand-rolled before/after harness (see the
session's D-457 note) comparing paint() with the frame-budget bar's DOM writes short-circuited:
inconclusive — this VM's frame times swung from ~85 ms to ~250 ms between consecutive runs with
no code change, well outside the ~12 ms signal being hunted, so no attribution from here can be
trusted. `diagcheck` itself still reports a real, reproducible 3x overage against its OWN A/B
control (which cancels ambient noise by construction, unlike this session's one-off probe) — the
bug is real, only its exact line is not yet found. Next step: re-run the same before/after
isolation `diagcheck` sec6 does (real paint vs. inert vs. selected DOM writes stubbed one at a
time — budget bar, per-row `setText`, `paintGraph`'s canvas draw, `paintEntities`) on quieter
hardware (the lane, or Dan's own machine) where a 12 ms signal is not lost in 150 ms of jitter.

**D-467 addendum (session 72):** reproduced on Dan's own machine (not just a cloud VM) at ~3.7x over
budget, the same order of magnitude as before. Isolating `paintGraph`/`paintEntities`/`paintLog`/
`paintVerdicts` one at a time (the next step named above) read a flat, clamped 250.00ms frame average
in every configuration -- `17_main.js`'s own spiral guard saturating -- while the `ai-jobs` runner was
`command busy` the whole session. Leading theory now: the runner and an agent session contend for the
same desktop's CPU/GPU, so no measurement taken while it is mid-job is quiet, wherever taken from. Next
step revised: confirm the runner idle first, then re-isolate.

**STRUCK, D-499 (session 91):** CSS containment on the panel; `diagcheck` §6 0.71 ms/frame, green.

### KW-29 open warn — dropping a job into `.shell/inbox/` failed this session, cause not found
D-459 (session 66, 22 Sept): tried to queue `mobdrawcheck`/`briefcheck` on the file runner after
`node tools/suite.mjs --fast --only mobdrawcheck` genuinely timed out at the ~180 s call ceiling
(confirmed by a real timeout, not assumed). `mkdir -p .shell/inbox` and `touch .shell/inbox/
testfile.txt` both succeeded in the same shell, but writing a `.job` file into that directory did
not: a plain `>` redirect AND a `mv` of a file built elsewhere both failed with "No such file or
directory" against a destination path in a directory that demonstrably exists and accepts other
writes. `node tools/shell-runner.mjs --status` showed the daemon alive (`"alive": true`) at the
time. Not chased further this session — this file's own body is where a future session should
start rather than rediscovering the same failure. Possibly: the daemon's own claim/rename logic
racing an in-progress write (see the file's own header comment on atomic drops); possibly
something specific to the `.job` extension (antivirus/EDR on Dan's machine, a watched-folder
lock); possibly transient. Whatever it is, it left `mobdrawcheck` unverified for horse this
session, same open state D-458 already left it in for wolf/cat/ocelot/parrot — check it did NOT
recur before spending time on root-causing it.

**D-467 addendum (session 72):** did not reproduce -- a plain `>` redirect into `.shell/inbox/` succeeded
first try this session, with the daemon alive and idle (`running: null`). Left open (one non-repro is
not a fix), but a future session should try its own write before assuming this is still broken.

### KW-30 struck warn — `session.mjs close`'s own git commit reliably fails on this machine, leaving stale `.git/*.lock` files (D-472)
Session 71 (D-465, 22 Sept 2026): `close`'s commit step (`git('add','-A')` then a bare
`execFileSync('git',['commit',...])`, both with no timeout of their own — `tools/session.mjs`
lines ~191-193) failed BOTH times it ran this session, every time with the identical message
`fatal: Unable to create '.../.git/index.lock': File exists`, immediately (not a hang) — meaning
a lock was already sitting there before `close`'s own commit even tried. The session opened with
one such lock already present (from the 19:13Z loop fire, moved into `_to_delete/` per STATE §5's
usual handling), and a fresh one appeared again after each of the two `close` runs, and again
after a manual `git add -A && git commit` with the tool's own full 180s timeout — that one
DID succeed, printing a page of benign `warning: unable to unlink '.git/objects/*/tmp_obj_*'`
lines first (git's own post-commit temp-file cleanup, blocked by the same no-delete-permission
gate that blocks removing the lock files themselves).
Leading theory, not yet confirmed: this device_bash Linux VM and the Windows `runner`
(PC) share the SAME physical working tree (`C:\Users\user\Downloads\mclite`,
mounted here) rather than each having their own checkout — and the runner was `command busy`
the entire session, processing a backlog of 8 queued suite jobs. If any queued job's own script
touches git (a `git stash`/`checkout`/`clean` for an isolated build, say), it would race this
session's own git commands on the identical `.git` directory, which is exactly the shape of a
lock one side creates and the other can't remove (no delete permission was grantable this
session either — the approval prompt went unanswered, unattended). Not confirmed by reading the
runner's own job scripts this session — that is the next step, not a guess to act on.
Workaround that worked twice: `mv` (not `rm`) the stale `.git/index.lock` (and `.git/HEAD.lock`
when that one blocks too) into `_to_delete/`, then run `git add -A && git commit` directly with
a generous timeout (120s+) rather than relying on `session.mjs close`'s own commit step, which
has no such margin and no retry. `_to_delete/` now holds git lock files from at least sessions
69, 70 and 71 — worth Dan clearing that folder out (and this session's own delete-permission
prompt going unanswered is exactly why they're still there rather than actually removed).

Session 73 (D-468, 22 Sept 2026): reproduced again, three more times in one session — `index.lock`, then `HEAD.lock`, then `refs/heads/master.lock` while building D-468's own commit by hand, and `session.mjs close`'s own commit step failed all three times it ran, identically. The `ai-jobs` runner was `command busy` (11-job backlog) for this session's entire duration too, same as every other session that has hit this — still consistent with, but not yet proof of, the shared-working-tree theory above. This session's own delete-permission request also went unanswered (unattended run); `_to_delete/` now also holds this session's lock files.

Session 76 (D-471/D-472, 22 Sept 2026, autonomous loop): **the real cause, confirmed, and struck.** Not a race with the Windows runner (the leading theory above, never actually confirmed by either session that proposed it) — this session's OWN close hit the identical `index.lock: File exists` failure with the runner in the exact same `command busy`/17-job-deep state prior sessions already blamed, then proved the real mechanism directly: `rm -f .git/index.lock` fails with `Operation not permitted` — the SAME delete-permission gate this session's own `device_request_delete_permission` call hit (`requires approval`, unattended, as every prior session's did too). Git itself writes its lock files and loose objects fine (rename works on this mount); it is only the CLEANUP unlink — of a lock after a successful commit, or of a `tmp_obj_*` loose object after it's folded in — that this mount refuses until a human grants delete, which nobody unattended can do. That is why the lock is there BEFORE `close` even starts (the previous session's own cleanup never landed) and why it reappears after every git command that ran clean (`git add`, `git commit` each leave a fresh one behind on THIS run, not a stolen one from a concurrent process). The shared-working-tree race may still be real for OTHER symptoms (KW-29, D-467's own note) — this entry is narrowly about the lock files, and for those the simpler, fully-sufficient explanation wins (D-263's own referee habit: read the actual syscall failure before reaching for a race). **The fix**: `mv` needs no delete permission (it's a rename), so `tools/session.mjs`'s own `close` now sweeps `.git/index.lock`, `.git/HEAD.lock` and every `.git/objects/*/tmp_obj_*` into `_to_delete/` immediately before `git add -A` (`sweepGitLocks`, D-472) — proven this session by hand first (twice, unblocking this exact session's own D-471 commit), then made permanent so the next session's close needs no manual rediscovery. `_to_delete/` keeps growing (now also holding this session's swept objects) — still Dan's own cleanup, not something a delete-blocked session can do for him.

### KW-31 open warn — WebGPU cannot hold the atlas on a 2048-layer adapter (no sharding on that backend)
D-589 (s109): the atlas is 4158 layers (mob textures live in it). WebGL2 now shards it four ways; WebGPU still creates ONE
`texture_2d_array` and `P.init` refuses when the adapter's `maxTextureArrayLayers` is below the atlas (D3D12 reports 2048),
so on Dan's PC choosing WebGPU falls back to WebGL2 — it has since D-380. Fix: the same four shards in `11_gfx_webgpu.js`
(bindings for shards 2–4; branch with `textureSampleGrad` off derivatives taken in uniform flow, since WGSL forbids
`textureSample` in non-uniform control flow).

### KW-33 struck severe — the piglin family is drawn with no arms and no legs (s134; fixed D-687)
`PiglinEntityModel.getModelData` starts from `PlayerEntityModel.getTexturedModelData(dilation, false)` and then adds/replaces body, head
(+ears) and hat. `tools/extract-models.mjs` keeps only the caller's own addChild boxes, so the `piglin`, `piglin_brute` and
`zombified_piglin` layers are body + head + ears (their `#b`/`#c` layers are the armour meshes — and `zombified_piglin#c` is a boat's).
No arms, no legs, so nothing to hold a sword on either (helditemcheck waits on it). Fix: resolve the delegate's parts first, let the
caller's children replace same-named ones; re-pack models.bin; mobdrawcheck/mobboxcheck confirm.

### KW-32 open warn — the real-server referee packs (D-665): trades GREEN, equipment 2 reds (D-669..D-673)
`villagerreftradecheck` 0 reds since D-669 (mason/wandering-trader leak, 0.2 multipliers, book cost, boat direction, stew tags, horse
armour). `mobrefequipcheck` 108 -> 3 since D-670..D-672; wither_skeleton spawns since D-673: piglin/piglin_brute spawn since D-676 (the
referee equipment pack should now see them; confirm on the next referee run). `mobdefaultscheck` — 10 mobs EL.spawn cannot make (hoglin/zoglin spawn since D-680: blaze, ghast, shulker, strider, wither,
giant, elder_guardian, ender_dragon, …). Owed, named: animateArms D-678, phantom translate D-677, wither skeleton -> piglin target D-676 are CLOSED; the piglin brain residue
is `Piglin.OWED` (07zzf_piglin.js); the chicken-jockey tries run on natural spawns only. Details: `.infra/infra-20260924T1945Z.md`, `docs/REFEREE.md`.

### KW-34 open severe — real-server referee reds merged s135 (infra I6 passes 2045Z..0300Z, `.infra/infra-*.md` "Findings")
The referee packs merged in s135 (D-691) name red lines the engine owes; each check is in the suite and stays red until fixed.
MOBS, struck s136 (D-693): fall damage (fallrefcheck — EL.spawn built `living:false` for every mob, so the landing/damage path
never ran outside the player); XP from animals/fish/baby zombies+piglins+hoglins/silverfish/endermite/phantom/size>1 slimes (mob
XP pack, exact referee numbers); arrows applied gravity one tick early (now move-then-drag-then-gravity, matching the real order).
`fallrefcheck`'s golden comparison against a fresh real-server capture is still owed (no 1.18.2 server.jar reachable from this box
this pass) — its SELFCHECK section (engine's own Ph.fallDamage formula) is what's green today, named so a future pass doesn't
assume the golden half ran. WORLD: TNT-broken blocks must always drop
(BREAK not DESTROY); furnace xp on break; redstone lamp 4-tick off; pistons one tick early; observer chains; iron door/trapdoor/
gate/rail ignore redstone; blast furnace/smoker full fuel time; hopper 9 vs 8 ticks + cooldown + fuel-slot pull; fluid recession
freezes; no gravity blocks; pressure plates sense nothing; beetroot 2x fast; saplings never grow; loot pool functions; entity_properties {}.

### KW-36 struck note — sheep fur#null quad-count mismatch was a real ER.build buffer undercount (D-700, s138)
Was: `mobrendercheck`'s `emitMobLayer('fur#null')` wrote 40 quads against a 36-quad golden expectation. Root cause (D-700):
`ER.mobQuadCount(layerName)` never took a `texKey`, so `ER.build`'s own `it.n = ER.mobQuadCount(it.mobLayer)` sized the
fleece overlay's buffer slice off the bare 'sheep' layer while the real draw call used the texKey-aware, D-698-dilated
geometry — a genuine live rendering undercount (silent TypedArray truncation), not just a stale test constant. Fixed:
`ER.mobQuadCount(layerName, texKey)` now threads texKey through to `ER.mobGeomFor` the same way `emitMobLayer` already
does; `ER.build`'s call site passes `it.texKey`. See D-700 for the full account.

### KW-37 struck warn — `blockcmdlivecheck`'s masked/filtered `/clone` assertions: harness race, fixed (D-755, session 149)
Session 146's worker 2 (loop/s146-w2) reported this check green (37 assertions, 0 failures) before
merging. After merge, three consecutive re-runs on the merged tree gave three different results:
34 assertions/3 failed, 25/12 failed, 24/13 failed -- both the total assertion count AND the
failure count changed run to run, which means some run either short-circuits early (an unhandled
error partway through) or the world state the masked/filtered scenes depend on isn't what the
check assumes every time. The consistent failure signature: `masked clone copies 8 of 9` and
`filtered stone clone copies only the 8 stone cells` both fail with `commands.clone.failed` / "No
blocks were cloned" -- i.e. `clone()`'s `buf` came back empty, which only happens if `W.getBlock`
read every cell in the 3x3 source region as air (id 0) at read time, not just the one deliberately
punched hole. `run()`/`at()` in the check are synchronous CDP evaluates with no gap between the
`/fill ... stone` setup and the `/clone ... masked` read, so this is not an obvious async race at
the JS level -- more likely the test's coordinates (offset from the player's spawn point, not from
a cleared/known-flat region) land somewhere the world's own natural terrain doesn't match what the
scene assumes, and that varies by world seed/spawn on different boots. NOT investigated further
this session (budget; the merge's own bug fixes -- `/clone ... move` overlap, `/fill ... destroy`
drops -- are separately verified via each worker's anti-vacuity pass and are not in question).
Next session should either pin the check's test region to `/fill`-cleared coordinates well away
from natural terrain (clear a large air volume first, the way `chestcheck`'s platform helper does
elsewhere) or add a settle/clear step before the masked/filtered scenes specifically, then confirm
three clean reruns before trusting `blockcmdlivecheck` green.
⚠ **Session 147: still not investigated.** Worker 1 read this entry but never reached the browser
(spent its pass on recon only) — no new evidence either way on session 146's own hypothesis above
(test region overlapping natural terrain vs. a genuine async gap). Unchanged, still open.

**Session 148, worker 1: confirmed not reproducible, hypothesis above refuted.** Staged
`dist/mclite.html` + `tools/blockcmdlivecheck.mjs` + `tools/cdp.mjs` into the cloud Bash
container (per KW-20) and ran the check 3 times in a row against the CURRENT merged tree
(commit 3269bb8, post D-741..D-749): **37 assertions, 0 failed, every single run.** The
session 146 hypothesis ("the test's coordinates are offset from the player's spawn point,
not a cleared/known-flat region, so natural terrain corrupts the scene") does not hold up
against the check's own code: its section 0 (`tools/blockcmdlivecheck.mjs` ~lines 64-82)
explicitly `makeChunk`s a 12x12 synthetic chunk grid around its own anchor (`PX=4700,
PZ=4700`) and floor-fills the ENTIRE range every later offset in the file uses (up to
`PX+128`) with stone BEFORE any command runs -- there is no natural terrain in play at any
coordinate this check touches, seed-dependent or otherwise; the masked/filtered scenes'
own destination cells are separately `/fill`-cleared or `/fill`-set immediately before each
clone. That guard (the file's own comment: "a `/fill`/`/clone` past the generated-chunk
edge silently no-ops") was ALREADY PRESENT in the one commit that ever touched this file
(3a8aad6, session 146) -- i.e. the exact tree KW-37's three flaky re-runs were measured
against already had it. The real explanation is almost certainly what the entry's own
"NOT investigated further this session (budget)" left open: the merge that produced KW-37's
flaky tree combined session 146's four workers' branches together for the first time, and
one of the OTHER three workers' own changes (before D-741..D-748's later fixes landed) was
transiently interacting with `/clone`'s live world state -- not this check's own coordinates.
No code change made to `blockcmdlivecheck.mjs` itself; nothing here needs a `/fill`-pinned
region, because it already had one.

⚠ **Orchestrator, same session (148), post-merge verification: RE-OPENED, worker 1's "struck" does
not hold.** Immediately after merging worker 1's and worker 2's branches to master (commit 0c606b0)
and rebuilding, ran `blockcmdlivecheck.mjs` against the actual merged-master build three times in a
row in the cloud Bash container (identical method to worker 1's: staged `dist/mclite.html` +
`tools/blockcmdlivecheck.mjs` + `tools/cdp.mjs` + `tools/pngdec.mjs`, `CHROME=` the same pinned
`/opt/pw-browsers` binary): **all three runs gave the identical failing result, 24 assertions/13
failed**, with the exact same two lead failures session 146 first saw (`masked clone copies 8 of 9`
and `filtered stone clone copies only the 8 stone cells`, both `commands.clone.failed` / "No blocks
were cloned") — and 24/13 is literally one of session 146's own three original result tuples
(34/3, 25/12, **24/13**). Worker 1's three clean 37/0 runs happened on the pre-merge base tree
(their report cites commit 3269bb8, i.e. before their own and worker 2's changes were combined);
this orchestrator's three runs were against the POST-merge tree, and were fully consistent with
each other (not varying run to run the way session 146's did) — so on the current tree this reads
as a deterministic failure, not flakiness, though it may still be sensitive to which other branches
are merged alongside it (matching worker 1's own alternate theory: "one of the OTHER workers'
changes was transiently interacting with `/clone`'s live world state"). Un-struck. Next session:
reproduce on Dan's own PC (not just the cloud container) to rule out an environment difference,
then bisect which of session 148's two merged changes (teleport/tp velocity fix in
`src/15g_commands.js`, or the cullcheck.mjs/suite.mjs determinism fix — neither obviously touches
`/clone` or world generation) actually flips this check red, by reverting each in isolation on a
throwaway clone and re-running `blockcmdlivecheck` 3x each time.
⚠ **CLOSED, session 149 (D-754/D-755).** D-751's "deterministic regression from session 148" was
wrong: the orchestrator bisected session 148's two changes in isolation (commits 997a33d and
ea13596, each descending from the same pre-merge base 3269bb8) and found BOTH isolated variants
flake at the same ~30-40% rate with the identical failure signature -- neither session-148 change
is the cause. The real bug, finally confirmed live with temporary instrumentation: this file's own
harness builds its synthetic test-chunk grid in one CDP `eval()`, then teleports the player onto it
in a SEPARATE, later `eval()` -- and in the real wall-clock gap between those two round trips,
`World.stream()`'s eviction pass (running on the player's stale, still-at-spawn camera) sometimes
evicts the brand-new platform before the teleport ever lands, so `World.getBlock` reads air for the
whole region. Fixed by freezing `MCL.Jobs.mode = 'none'` right after the harness's initial
`settleWorld()` (stops `World.stream()` from generating/meshing/evicting anything for the rest of
the check), plus a residency regression-guard assertion before the masked/filtered scenes. 8
consecutive clean live runs post-fix (worker), 5 more independently by the orchestrator against the
actual merged master build -- 13/13 clean, versus the pre-fix ~1-in-3 failure rate. No `src/`
engine file was touched; this was entirely a test-harness ordering bug, three sessions after it was
first seen (146/147/148). Lesson for future browser checks: any check that builds a synthetic scene
and then moves the player in a SEPARATE `eval()` call is exposed to this same race unless it also
freezes `MCL.Jobs.mode` in between -- worth a quick audit of the other browser checks some session,
named but not chased here (out of this unit's scope).

### KW-38 struck severe — splash potions never affect the player, fixed (D-763, session 151)
`Po.applySplashPotion` (`src/07z_potion.js` ~271) skips any target whose `maxHealth` is
`undefined`, and the player object never gets one assigned (`14d_survival.js` uses
`Sv.MAX_HEALTH` instead). `Po.tick`'s direct-hit loop (~474) also only scans `EL.list`, never the
player. Consequence: a witch's slowness/poison/harming splash never lands on the player, so she
throws slowness forever instead of the server's slowness → poison → harming sequence.
`ranged2refcheck`'s `witch` scene is red on this. Verified fix direction: setting `P.maxHealth = 20`
in the test harness turns the scene green. ⚠ `maxHealth` is used as the engine's "is this a living
entity" test in 37 places, so the fix needs a decision — give the player a real `maxHealth`, or add
an explicit player branch to every splash/direct-hit path — not a one-line patch.

### KW-39 struck severe — ghasts never fire their fireball goal, fixed (D-764, session 151)
`Gh.roster` (`src/07zzi_ghast.js:193`) registers `ShootFireballGoal` with `Ai.MOVE | Ai.LOOK`
controls. It sits at the same priority as the always-running `LookAtTargetGoal` (LOOK) and below
`FlyRandomly` (MOVE, priority 5), so the goal selector never starts it. Vanilla's
`ShootFireballGoal` sets NO controls (`GhastEntity.java:257`). `ranged2refcheck`'s `ghast` scene is
red (0 shots vs the server's ~60-tick cadence); dropping the goal's control flags to 0 turns it
green in the referee harness.

### KW-40 struck severe — the illusioner has no bow goal, fixed (D-765, session 151)
Its AI roster (`src/07k_goals.js:4364-4376`) never adds a `BowAttackGoal`; vanilla's
`IllusionerEntity.java:67` adds `BowAttackGoal(0.5, 20, 15.0F)` at priority 6, firing an arrow
every 40 ticks (first shot 37-50). `ranged2refcheck`'s `illusioner` scene is red — the engine never
fires at all.

### KW-41 struck warn — the illusioner blinds on normal difficulty, fixed (D-765, session 151)
`SP.difficultyAboveEasy` (`src/07v_spell.js:388`) checks the wrong threshold against vanilla's
`getLocalDifficulty(pos).isHarderThan(NORMAL.ordinal()=2)` (`IllusionerEntity.java:229`) — a fresh
normal-mode world sits at local difficulty 1.5, which the server treats as NOT harder than normal,
so it never blinds. The engine already computes real `LocalDifficulty` (session 130) — this is a
threshold-comparison bug, not a missing substrate.

### KW-42 struck severe — an arrow damages an enderman instead of making it teleport, fixed (D-766, session 151)
`src/14j_combat.js` ~1387 damages an enderman like any other mob on a projectile hit. Vanilla's
`EndermanEntity.damage` projectile branch (`EndermanEntity.java:351-364`) instead makes up to 64
teleport attempts and takes NO damage. Measured on the real server: 20/20 arrow hits teleported the
enderman with health unchanged; the engine just drops its health every time. Already named as a gap
in `Enderman.OWED`; `endermanrefcheck` now holds it as a red (not just a note).

### KW-43 struck warn — an enderman picks up and places blocks about 2x faster than the real server (infra I6, referee, worker; root cause FOUND, session 152)
Measured: pick-up by tick 40 is 13.3% on the server vs the engine's ~28%; placed by tick 600 is 4%
server vs ~14% engine. `endermanrefcheck` §7 holds the rate, red. The worker's own theory (a missing
`toGoalTicks` halving) was checked by the orchestrator and found backwards -- halving would raise
vanilla's chance, not lower it, so it cannot explain the gap. The test harness also polls `canUse`
every tick rather than going through the engine's real goal-selector cadence, which may itself be
part of the measured gap rather than purely an engine bug. **Re-derive the actual cause (probably
`PickUpBlockGoal`'s tick-gating and/or raycast success rate, `src/07zg_enderman.js:286-300`) before
changing anything** -- this is explicitly not settled.

▶ **KW-43 struck (session 152, loop/kw43-enderman-rate):** the goal-selector's missing every-other-real-tick split (`MobEntity.tickNewAi`'s own `(server.getTicks()+id)%2==0` gate, `.decomp`) is confirmed NOT the cause -- `PICKUP_CHANCE`/`PLACE_CHANCE` already hold the RAW un-halved vanilla constants (20/2000, not `toGoalTicks`'s halved 10/1000) for exactly this reason, so the average per-real-tick activation rate already matches vanilla's (evaluated every tick at 1/20 here vs evaluated every OTHER tick at 1/10 there -- same 1/20 average). The real cause was `PickUpBlockGoal`'s own raycast (`.decomp:462-467`, `RaycastContext.ShapeType.OUTLINE`): this engine's `tick()` only checked the `enderman_holdable` tag on the randomly-sampled block and picked it up unconditionally, with no check that the enderman could actually SEE it -- a block behind glass, a fence, a leaf, or any other solid was picked up here exactly as readily as one in the open, where vanilla's raycast refuses it. Fixed in `src/07zg_enderman.js`'s `PickUpBlockGoal.tick` with `NS.Ray.cast` (the same `shapesForState`-length predicate `Enderman.isPlayerStaring` already uses in this file) from the enderman's own floored x/z at the sampled y to the candidate block's center, requiring the hit resolve to that exact block. New check `endermanraycheck` (`tools/endermanraycheck.mjs`, registered via `tools/stages.d/kw43-enderman-rate.json`) drives `Em.PickUpBlockGoal` directly with a fixed RNG sequence onto one cell and asserts a solid wall on the line to it refuses the pickup (red before this fix, green after), with an anti-vacuity control proving the same roll succeeds once the wall is removed. `PlaceBlockGoal` itself needed no change -- its own elevated placed-by-tick-600 rate was a knock-on of blocks being carried far more often/earlier, not a separate bug (it has no raycast of its own in vanilla, `.decomp:478-527`). `endermanrefcheck` sec7 needs a live rerun against the real server to confirm the rate now matches -- not done this pass (no golden data generated in this sandbox; see that check's own SKIP message).

### KW-44 struck warn — a wild llama spits at a nearby wild wolf in the engine; the real server never does (infra I6, referee; FIXED session 152)
0 spits across 3×300 ticks on the real server (Strength 1/3/5) vs ~7 spits in the engine starting
around tick 41, repeating every ~40 ticks, costing the wolf 3-7 HP each time
(`Ai.ChaseWolvesGoal`, `src/07k_goals.js` ~3563). Vanilla's `ChaseWolvesGoal` is an
`ActiveTargetGoal(llama, Wolf, 16, false, true, !tamed)` at targeting priority 2, behind
`SpitRevengeGoal`, with an effective range of `follow_range(40) × 0.25 = 10` blocks
(`LlamaEntity.java:497-509`). The engine is missing the `reciprocalChance` gate
(`toGoalTicks(16) = 8`), but that alone can't explain a 0-vs-~7 gap -- suspects named but not
confirmed: `TrackTargetGoal.canNavigateToEntity` refusing a path to a fleeing wolf, or the wolf's
own `AvoidLlamaGoal` getting it out of range before the llama's targeting check runs. Tamed wolves
correctly never get targeted (`WolfEntity.java:539`) and retaliation after a player hit matches the
server exactly (t44/41/41 server vs t41/41/41 engine). **Do not just loosen the range/chance check
to make the referee scene pass — the root cause is unconfirmed.**

### KW-45 struck warn — a wolf fleeing a llama ends up closer than the real server (infra I6, referee; FIXED session 152)
`wild_s5_dx12`: the real server ends the chase 19.2-27.4 blocks from the llama; the engine's wolf
only gets to 16.2. Likely the generic `Ai.AvoidEntityGoal` flee-distance approximation
(`src/07k_goals.js` ~3921) undershooting vanilla's flee path, but not pinned to a specific line yet.

**RESOLVED (session 152, loop/kw44-45-llama-wolf, `src/07k_goals.js`):** two separate,
confirmed root causes, both re-derived off `.decomp` (not a range/chance loosening).
KW-44: `Ai.ChaseWolvesGoal` was missing `ActiveTargetGoal`'s own `reciprocalChance` gate
(`.decomp/net/minecraft/entity/ai/goal/ActiveTargetGoal.java` ctor + `canStart`:
`toGoalTicks(16) = 8`, a 1/8-per-tick roll before `findClosestTarget()` even runs) AND its
`canContinueToUse()` carried an invented ×1.5 leash-slack widening that
`.decomp/net/minecraft/entity/ai/goal/TrackTargetGoal.java#shouldContinue` never has — vanilla
drops the target the INSTANT `squaredDistanceTo > getFollowRange()^2`, no slack (that ×1.5 idiom
is `Ai.NearestAttackableTargetGoal`'s own, a different generic goal). `TrackTargetGoal
.canNavigateToEntity` was investigated and RULED OUT: `ActiveTargetGoal` never calls `canTrack`/
`canNavigateToEntity` at all (only `RevengeGoal`/`AttackWithOwnerGoal`/`TrackOwnerAttackerGoal`
do), so that suspect never applied to this goal. Both fixes landed; `Ai.CHASE_WOLVES_RECIPROCAL_CHANCE`
names the gate.
KW-45: `Ai.AvoidEntityGoal`'s escape point was a single deterministic point exactly the caller's
DETECTION `range` blocks directly away from the threat — but vanilla's
`.decomp/net/minecraft/entity/ai/goal/FleeEntityGoal.java#canStart` always searches for its
escape point via `NoPenaltyTargeting.findFrom(mob, 16, 7, threatPos)`, a FIXED 16-block/
7-block/`Math.PI/2`-cone fuzzed, pathfinding-validated search (`FuzzyPositions.localFuzz`, first
of 10 candidates that pass) completely independent of the detection range. In a bounded pen the
old straight-line point can land outside the walls; `Ai.findPath` then legitimately returns
`null` and the goal silently stops making progress the very next tick even with the threat still
present — confirmed directly (see `tools/kw4445check.mjs` §3's anti-vacuity). Fixed via an
opt-in `fleeOpts.random` (only `AvoidLlamaGoal` opts in this pass; every other `AvoidEntityGoal`
caller — cat/ocelot/rabbit/fox/panda flee goals — keeps its prior straight-line behaviour
unchanged, since only the llama/wolf pair was actually re-derived against `.decomp` this pass).
Regression check: `tools/kw4445check.mjs` (fails on the pre-fix goals, green after).

### KW-46 struck warn — the witch's splash-potion effect order, self-resolved with KW-38 (D-763, session 151)
Once the player actually receives a splash potion's effects (KW-38 blocks this entirely today),
the server's first three effects on a hit player are `slowness, poison, harming` in that order; the
engine's potion-selection logic currently would apply `slowness, slowness, slowness` for the same
three throws (`ranged2refcheck`'s `witch` scene). Fix KW-38 first, then re-test this scene before
assuming the ordering logic itself is broken -- it may self-resolve once the player is a valid
splash target, or may be a second, independent bug in which potion type the witch selects.

### KW-47 open warn — `/help` gives no argument syntax, and multi-line output doesn't match vanilla's compact form (orchestrator, session 151)
No-arg `/help` (`src/15g_commands.js:1992-1997`) prints one bare command name per line via
`D.names()` (`src/14h_brigadier.js:334`) -- e.g. `/gamemode` with no arguments shown. Vanilla's
`HelpCommand.register` (`.decomp/net/minecraft/server/command/HelpCommand.java`) instead calls
Brigadier's `getSmartUsage(root, source)`, which gives ONE compact line per top-level command
already carrying its argument shape (e.g. `gamemode <target> <gameMode>`, with `(a|b)`/`[...]`
notation for alternatives/optionals collapsed into a single string). `/help <command>`
(`src/15g_commands.js:1998-2005`) has two more gaps: (1) it only looks at
`get(c,'command').split(' ')[0]` -- the first word -- so `/help gamemode survival` gives the same
output as `/help gamemode`, never narrowing into the parsed sub-path the way vanilla's re-parse of
the whole string does; (2) it uses `C.usage()`, which fully enumerates every runnable path as its
own line, rather than vanilla's single smart-usage string per branch, so a command with several
`execute()` endpoints prints far more lines than the real server would. Not fixed this pass --
matching vanilla's smart-usage compaction (bracket/pipe notation, re-parsing the argument string
into the tree) is its own small feature, not a one-line patch, and `/help`'s own output has no
gameplay effect, so it stayed behind the severe KW-38/39/40/42 fixes this wave.

### KW-48 open severe — blocks turn partly or fully INVISIBLE, especially after breaking blocks (Dan, playing, 27 Sept 2026)
Dan's report: "a lot of the time, especially after breaking blocks, many blocks are partially or fully transparent — they
don't exist visually but you can still break them, with particles." So the WORLD data is right (the block is there, the
raycast hits it, the break particles use its texture) and the PICTURE is wrong: a render-side bug. Candidates, in the order
to rule out: (1) the section-visibility / occlusion flood (KW-2's machinery) not recomputed after a block edit, so a section
opened up by a break stays culled or a neighbour is dropped; (2) a remesh that rebuilds the edited section but not the
NEIGHBOUR section when the break is on a section edge (faces that became exposed are never meshed); (3) a mesh-upload race
(a stale mesh replacing a fresh one when two edits land close together); (4) face culling reading a neighbour's state before
its update. AUDIT, don't patch (Dan's standing rule): find the class, measure it (break N blocks in a scripted world, then
assert every exposed face of every non-air block is in a drawn mesh and its section is in the visible set), fix the cause,
leave that check in the suite. Needs the PC lane's real GPU to confirm the picture; cloud item `bug-invisible-blocks`
(D-783) does the code-side diagnosis + the headless check. Falling blocks (sand/gravel) are known missing (G17, not a bug).
