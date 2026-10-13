# AGENTS — when to dispatch a sub-agent, at what strength, and what proves it worked

Transposed from MineHTML's `STANDING-ORDERS.md` §108.3 / §108.4 and `RULES.md` §2.12 on Dan's
instruction (6 Sept 2026): *"dont be afriad to use worldflows, read mchtmls rules on agents and
transpose them to this project, max 2 at a time"*.

MineHTML learned these over ~180 sessions and paid for each of them. They are not re-derived here.

---

## 0. ⚠ WORKFLOWS AND ONLY WORKFLOWS (Dan, 8 September 2026)

> *"i told you to use workflows? from now on im permanently banning how you keep dispatching
> subagents"* … *"workflows and only workflows"*

A one-off `Agent` dispatch is **banned**, permanently. Parallel work goes through the **Workflow**
tool — a script that fans out, or it does not happen. Everything below still applies to the agents
a workflow starts.

⚠⚠ **AND THE HALF THIS FILE GOT WRONG UNTIL SESSION 14: A DOCUMENT MAY DESCRIBE THE RULES FOR A
WORKFLOW. IT MAY NOT AUTHORISE ONE.** `[Dan, 16 September 2026: "make sure workflows permission
isnt granted by a doc, only by me"]`

Read the two halves separately, because they are different kinds of statement:

| | |
|---|---|
| **"Workflows and only workflows"** | a **restriction**, and it stands. It says which mechanism parallel work may use. A session may never route around it. |
| **"Use workflows"** | a **permission**, and no file grants it. It comes from Dan, in the session that runs it, in his words. |

▶ So: *if Dan authorises parallel work in this session, it goes through the Workflow tool and
obeys everything below. If he has not, the session works alone.* **Reading §0 and starting a
workflow is not compliance — it is a session granting itself permission out of a file.** The cap
in §1, the strength rule in §2 and the record in §4 bound a workflow he has authorised; none of
them is a reason to start one.

⚠ **Two operational lessons session 6 paid for with four agents in the same tree:**

1. **Decision numbers collide.** Five agents took "the next free number" from `DECISIONS.md`
   within twenty minutes and four collided; `doccheck` §3 caught it each time. **Take your number
   as late as you can — after the code is written — and re-check the tail before you commit.**
2. **`docs/DECISIONS.md` is append-only and SHARED, so `git add docs/DECISIONS.md` will stage
   another agent's half-written entry under your message.** The recipe: commit through a temporary
   index (`git commit-tree` with `docs/DECISIONS.md` = HEAD's blob plus your entry alone, then a
   CAS `update-ref`), then re-run `git add` so the shared index is consistent again.
3. ⚠ **`rm` is blocked on this mount and git cannot unlink its own lock files**, so a commit
   leaves `.git/index.lock` behind and the NEXT commit fails with `cannot lock ref 'HEAD'`. That
   is a stale lock, not a running git: `mv` it aside and retry.

## 1. The cap — **FOUR, THEN TWO**

Dan set two when the rules were transposed and raised it mid-session (6 Sept 2026):
*"Remember to multitask, 4 at a time until the 5 hour resets, than 2."*

So the cap is a function of where the session is in its usage window: **four agents in flight
while the five-hour window is fresh, two once it has reset** and the budget is the constraint
again. A fifth (or third) waits. ⚠ The cap is about COST, not about correctness — nothing about
running four agents relaxes rule 2's bright line or rule 4's record, and W8 dispatched five
generator files two and three at a time under exactly these numbers.

## 2. ⚠ Model strength is a RULE, not a preference

| model | what it is for |
|---|---|
| **Opus** (the orchestrator) | all thinking, every interpretation, every decision, the last word on anything |
| **Sonnet** | mechanical work needing more context or more care than Haiku holds |
| **Haiku** | bottom-of-the-barrel mechanical work: enumeration, transcription, counting |

⚠ **THE BRIGHT LINE, and it does not depend on how good the weaker model turns out to be: a
weaker sub-agent may be used ONLY where a MACHINE verifies its output afterwards** — a
re-runnable `grep`, a tool-derived count, a check in `tools/` that grades the result. **Never for
interpretation, never for a decision, never for the last word on what vanilla does.**

▶ **Before dispatching, answer out loud: WHAT MACHINE CHECKS THIS WORKER?** If the answer is
"nothing", the task is not delegable to a weaker model — it stays with the orchestrator, or it
goes out at full strength and the dispatch record says so.

In this project the machine is usually one of: a `tools/*check.mjs` that already exists, a `grep`
the orchestrator re-runs, or a count the orchestrator recomputes. "I read the agent's answer and
it seemed right" is not a machine.

**Effort gate:** Sonnet at `low` and `medium` only — never `high` or above; effort scaling is the
real cost driver. **Fable is rejected and must not be re-proposed** (Dan, MineHTML: *"I do not
have infinite money"*).

## 3. ⚠ The cost driver is what the agent READS on the way in

MineHTML §108.3, and it is the half that matters: a fresh agent's cost is dominated by its
orientation, not by its thinking. **Every worker prompt must carry the cheap-orientation
clause**, in these words or better:

> Orient cheaply. Use `grep -n` and `sed -n '<a>,<b>p'` over line ranges. Do NOT `cat` a whole
> file, do not read `19_data.gen.js` at all (it is a 900 KB generated blob), and do not paste
> file contents into your reply. Report findings — names, counts, line numbers, one-line
> summaries — not source.

A worker that returns 400 lines of source has cost more than doing the job in the parent.

## 4. Every dispatch is recorded, and the record is the agent's own testimony

A tier alias is never an acceptable record: the bare alias `sonnet` resolves to whatever the
platform currently means by it. So **every worker prompt ends by requiring the agent's FIRST line
to be**

```
DISPATCH-RECORD model=<exact identifier its own environment reports> task=<slug>
```

reporting what the agent's environment says rather than what the dispatcher intended. A missing
or family-named line means the run is discarded and re-run: an unrecorded run looks like evidence
and is not.

The ledger is section 6 of this file. Append one row per dispatch, including non-compliant ones,
labelled — a dispatch that broke a rule and was recorded is worth more than one that was quietly
dropped.

## 5. What is worth dispatching in THIS project

Good (mechanical, machine-checked):

* enumerating vanilla data — "list every distinct `placement_modifier` type across the 220 placed
  features, with counts", which the orchestrator re-derives with one script;
* sweeping the source for a pattern — stale comments, a removed symbol, a naming inconsistency —
  where the finding is a line number the orchestrator re-greps;
* running an existing check under N configurations and reporting the numbers;
* transcribing a table out of a JSON file into the shape a check wants.

Bad (never delegate):

* deciding what vanilla does, or what a deviation is allowed to be;
* writing or changing a `docs/` decision;
* anything whose output nothing can grade.

## 6. Ledger

⚠ **The rows are gone and the rule that produced them is not.** Session 3 recorded the model for
none of its nine agents; session 6 recorded it partially across fifteen; session 8's eight were
every one a REFEREE job and its diagnoses are **D-254** to **D-257**. A growing table inside a
file with a reading budget cost more than it taught. **Every prompt still opens with
`DISPATCH-RECORD`**; what a dispatch produced belongs in a DECISION, with a number.

## 7. What the ledger has taught, in four findings

1. ⚠ **`DISPATCH-RECORD` compliance was 5 of 9** and moving the requirement to the first sentence
   did not fix it: a tier name in "model requested" is a REQUEST, not a record.
2. ⚠ **What the dispatches could NOT catch, and it is the useful half:** all four bugs W8 shipped
   were in the PIPELINE the agents wrote against, not in what any agent wrote. **Write the check
   for the contract before fanning out against it.**
3b. ⚠⚠ **AND AGAIN, SESSION 11:** a worker asked what vanilla's hotbar selector rect is answered
   **24x24 from memory**, in a report that read as a source reading throughout. The bytecode says
   **24x22** (D-329). **A worker's claim about what vanilla does is a REQUEST for a referee.**
3. ⚠ **The bright line paid for itself, in one number:** a census re-derived by the orchestrator
   matched **13 of 14** — the worker said 52 generator types, the machine says 53 — inside a report
   that read as authoritative throughout.
4. **The value was real:** two sweeps found 24 false statements in the docs and 18 in the code.
5. ⚠ **Session 6's fifteen agents found ~25 bugs and EVERY ONE CAME FROM A NEW REFEREE**, not
   from a second reading of the same source. A worker that re-reads what you read agrees with you;
   a worker pointed at the JAR disagrees, and the disagreement is the finding.

6. ⚠⚠ **A DIGGER IS DELEGABLE; A DECIDER IS NOT.** Session 12 sent one agent into the jar to find
   `ItemModelGenerator`, told in as many words it was **a digger, not a decider**: no claim that is
   not in a `javap` excerpt it quotes, and *"I could not identify it, here is what I ruled out"* is
   a useful answer. Back in 169 s for 76.6k tokens with the class and a two-anchor evidence chain —
   **and the machine that checked it was the orchestrator re-running every one of its commands.**
   The agent ENUMERATED; every reading a number depended on stayed here.
   ⚠ **Ask before dispatching: does this have an answer a `grep` can re-check?** "Find the class"
   does. "What does the span walker do" does not.

7. ⚠⚠ **ANCHOR THE WORKERS ON FACTS YOU ALREADY VERIFIED, AND THE OVERLAP IS THE CHECK.** Session
   12 sent **three agents over 35 obfuscated classes**, each given the same four anchors the
   orchestrator had read by hand — `torch`, `wall_torch`, `nether_wart`, `wheat` — with the rule
   that *a reading which disagrees with an anchor is the READING that is wrong, and say so
   loudly*. Two agents overlapped those four and agreed. 240k tokens, 9m26s, 0 errors.
   ⚠ **The preparation is what made it cheap:** they were handed a resolver script with the
   `Blocks` and `BlockTags` constant maps ALREADY built, so their job was reading rather than
   archaeology — which is a digger's job (finding 6). Ten minutes here saved three agents doing it
   three times, differently.
   ⚠ **And "name what you could not read" earned its place:** two uncertain readings came back
   flagged, and both were checked here rather than shipped.

## 8. Where a sub-agent actually runs — CORRECTED, session 14 (16 September 2026)

⚠⚠ **THE PROJECT LIVES ON DAN'S DISK AT `C:\Users\user\Downloads\mclite`, AND `device_bash`
REACHES IT.** Verified session 14. Worker prompts give paths under `$HOME/mnt/mclite` and use
`device_bash`; nothing needs committing back, the files are already his.

⚠⚠ **THE PARAGRAPH THIS REPLACES WAS TRUE FOR ABOUT A DAY AND AUTHORITATIVE FOR A WEEK, AND IT IS
THE MOST EXPENSIVE THING THIS PROJECT HAS EVER WRITTEN DOWN.** Session 9 hit
*"Workspace unavailable"* after the 8 September Windows update and concluded, reasonably, that
*"the project lives in the cloud container."* The shell came back. The sentence did not. What it
cost, measured on 16 September:

**four costs, measured, and recorded in full in `git show 2a8efe1:MC-LITE-INFRASTRUCTURE-DIAGNOSIS.md` (project
root):** work destroyed (`extract-gamerules.mjs`, required by `suite.mjs`, written in a reclaimed
container and in neither git nor the tree — D-360); **the tar shuttle back from the dead** (five
archives, 46 MB, 36 hours, forbidden by this very section); **the referee dark** — `vanillacheck`
needs pregens from the PC through the ai-jobs lane (D-199), so arguments got settled by re-reading
our own source, which §3.10 says is not a referee at all, **and every "be more rigorous" complaint
Dan made that week traces here**; and **orientation paid twice**.

▶ **THE RULE THAT COMES OUT OF IT, AND IT IS BIGGER THAN THIS SECTION.** A session that loses a
tool does not get to relocate the project. **Say so in the session and in `STATE.md`, with the
date, and keep working from the disk.** A container copy is a workaround with an expiry, never a
home. `still_true.mjs` now grades the claims in this file for exactly this reason: this paragraph
would have gone red on 10 September.

⚠ **The tar shuttle is DEAD and must not be re-proposed** — unchanged, and now true again. A worker
prompt that says "unpack the tarball" is describing a workspace that does not exist.

⚠ **Two shells, two machines.** `device_bash` is Dan's computer (`$HOME/mnt/mclite`); `Bash` is a
cloud container with none of his files. Neither sees the other's writes. Name which, per file.
