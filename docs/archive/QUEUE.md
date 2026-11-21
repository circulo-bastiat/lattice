# QUEUE — the order of work (D-407)

**This file replaces `docs/passes/`.** One file, never renamed. It holds only work that is NOT done.

## How this file works — read this block, then only your job's section

* ⚠ **UNITS ARE BIGGER, AND A SESSION DOES SEVERAL (D-466; Dan, 22 Sept 2026: "Alter the one unit
  rule, and make the units bigger slightly").** Take the top job whose status is ▶ or ◐. **A unit is:**
  in row 0, a whole numbered item with all its lettered parts (all of 2a–2c, not 2a); in a G-row, the
  next TWO unstruck entries of its "units" line taken together. Finish a unit fully, then take the
  next, in order (into the next job when this one empties), until the pass budget (~75 tool calls,
  `loop.mjs pass`) is near — never start one you can't finish; one close covers them all.
* **When a unit is done:** strike it in the units line (`~~double chest~~ D-408`). **When a job is
  done: DELETE its section and its table row in the same commit** (D-139). Its D-number is the
  record; git has the text. Nothing moves, nothing is renamed, nothing is appended as a log.
* **Session narrative goes in the commit message and the D-entry — never in this file or NEXT.md.**
* Model and effort: **Sonnet 5 / medium**, chosen at the start and never switched (D-373/D-374).
  A "what does vanilla do" question is its own Opus session (STATE §7).
* Entry context for EVERY job: `node tools/brief.mjs --route game`, the PLAN section for your stage
  (`grep -n "G19b" docs/PLAN.md`), and the source headers the job names. Nothing else whole.
* Close-out for every job: `node build.mjs` · `node tools/suite.mjs --fast --only stagecheck,<the
  checks you touched>` · each new/affected browser stage at `MCLITE_PRESET=medium` · `node
  tools/brief.mjs --write` · answer `for-dan/INBOX.md` · commit.

### The rules every job carries (cited, not restated, in the job sections)

1. **Anti-vacuity**: every new check breaks its data and asserts the break is caught (D-30); a break
   that cannot fire is not a break (D-305). `gatecheck` counts them.
2. **A check not in `suite.mjs` does not exist** (D-110).
3. **Never let a check own a number the code owns** (D-329), nor ask the question the code asked (D-331).
4. **A worker's claim about vanilla is a request for a referee**, not an answer (D-329).
5. **A stage that replaces something is not done until the something is deleted** (D-139).
6. **Assert in BOTH directions** — a rule that refuses a legal action is worse than one that allows an illegal one.
7. **The bugs live in the JOINS** (D-276): ask who reads your output next.
8. **Browser stages run at `MCLITE_PRESET=medium`** (D-196); `--fast` does not see the game (KW-3).
   The browser is `.chromium/` — `node tools/get-chromium.mjs` (D-407). Natural spawning is live:
   a check that counts entities holds `MCL.Spawn.ready = false` first (D-397, D-407).
9. **Work on Dan's PC through `device_bash`**; the container only for a tool the PC lacks (STATE §0).
10. **Ask for delete permission once at the start** of a session that will commit (STATE §5).
11. ⚠⚠ **NEVER POLL — for the life of this project** (D-436; Dan, 20 Sept 2026). No wait loops, no
    scheduled wake-ups, no "check back later", no repeated `lane.mjs answer`. A job queued on the runner
    is read ONCE by the next `session.mjs start`; a result needed inside a session is produced by
    running the command in that session's own shell. `toolscheck` §D-436 fails if a wait loop returns.

## The table

| # | Stage | What | Status |
|---|---|---|---|
| 0 | **Dan's list, 20 Sept** | suite speed (D-437) and Dan's eight bug/feature reports — see §0 | ▶ **do this first** |
| 1 | **G19b** | the remaining container screens | ◐ 10 of 12 units done |
| 2 | **G18e** | breeding, taming, babies — with their hearts and GUIs | ◐ 2 of 4 units done |
| 3 | G18f | villagers and the trading screen | ◐ 5 units done |
| 4 | G20 | the particle engine, then weather and the sunrise band | ○ |
| 5 | G21 | experience | ○ |
| 6 | G22 | enchanting, anvils, grindstone, the 37 enchantments | ○ |
| 7 | G23 | brewing, potions, status effects — `Cb.OWED` closes | ○ |
| 8 | G19d | eating, the use-item hold, the offhand | ○ |
| 9 | G19c | sleeping | ○ |
| 10 | G24 | farming and fishing | ○ |
| 11 | G25 | vehicles, frames, paintings, armour stands, the moving piston | ○ |
| 12 | G19e | the last item uses and interactable blocks — `Use.OWED` empties | ○ |
| 13 | G26 + debts | statistics, advancements, scoreboard, music, accessibility; KW-1, KW-2, KW-6, KW-10, KW-13 | ○ |
| 14 | G27 | the Nether and the End, including the dragon (two sessions at least) | ○ |
| 15 | GATE G | reached and then **not** breached: everything left goes on testing (Dan's standing ruling) | ○ |

Order notes: G19b before G18e/G18f (their screens sit on it). G20 before G18e's hearts if both are
open — or build the minimum particle substrate inside G18e and say so. Rows 1–12 finish the
**overworld**, not Track G.

---

## 0 — The parallel night (Dan, 23 Sept 2026, D-487) — THE order; the loop's mechanics are `.claude/loop-prompt.md`

Work top-down. Parallel = the Workflow tool, sized by `.claude/loop-prompt.md` §1 (it supersedes AGENTS.md §1's
cap and any "one item" wording until the loop stops). Every value from the jar/`.decomp/` or the referee (rules 3–4);
browser stages via the lane at `MCLITE_PRESET=medium`, answers read next `start` (rules 8, 11). Do NOT half-add.

0.00 **▶ ORDER NOW (Dan, 26 Sept, D-773 — supersedes 0.0's "testing only"):** (1) ALL GREEN — the lane full-suite
    reds fixed at the CAUSE, green on the lane at medium; (2) every G18 leftover, in D-773's order (Nether/End mobs, then
    MOB SOUNDS only after every mob is made and proven green), each with a failing-without-it check, PORTED via
    extract-*/.decomp/referee, never hand-written (D-773); (3) STOP and ask Dan.
0.0 **⛔ MOBS FIRST — THE TESTING PASSES (Dan, live, 25 Sept 2026).** Dan played and found many G18 bugs. His order:
    "next few passes testing it rigorously, every single ounce of code and every mob and feature … should be flawless
    and every inch tested before anything else is done." Until Dan lifts it, EVERY pass is testing + fixing
    (no new features). Per mob: spawn it in the browser at `MCLITE_PRESET=medium`, screenshot it from 4 sides +
    above, compare model/texture/pose/scale to the jar's renderer; run its AI for real (walk, target, attack,
    knockback, flee, speed in blocks/s vs `.decomp`), in survival AND creative; the page console must stay clean.
    Every bug found gets a check that fails on it. Workers split the mobs; you judge the screenshots.
    Dan's original 8 reports (s135) — 6 of 8 CLOSED: canSee console crash (D-683), creative-chase (D-684),
    knockback (D-685), turtle spin/race (D-686), piglin/brute (D-693), witch hat + every hat/nose pivot (D-694),
    potion splash in-flight+impact (D-694/D-701), zombie head icon (D-695), referee reds incl. KW-34/KW-35
    (D-696/D-697), zombie hole-in-head (D-698), zombie-villager profession texture (D-699) — see DECISIONS for detail.
    Still OPEN (1):
    - [ ] no mob sounds — UNBLOCKED D-742 (D-12 raised 15→18 MB, Dan live, 25 Sept 2026); still a
          NEW FEATURE, so it waits for Dan to lift 0.0's testing-only order, same as every other
          G18 item
    - [x] ~~see-through ground~~ D-715 · ~~mob deep-test pass (60 mobs)~~ D-713..D-729 · ~~cross-mob/crowd testing~~ D-731..D-733 (DECISIONS)
0.1 ~~Readable 1.18.2 source (`.decomp/`)~~ — DONE D-488 (Yarn-named, `.decomp/names.tsv`; how to grep: STATE §0).
0.2 **G18 — mobs — COMPLETELY finished (Dan).** Finished = every mob browser stage green on the lane AND every OWED
    list below empty or a numbered ruling. Substrates G18 needs are IN scope (build, don't name blocked). Checklist —
    strike in place:
    - [x] ~~red full-suite mob stages~~ — D-494 (green in the worker's runs; confirm on the lane's full suite)
    - [x] ~~iron golem remainder~~ — D-495; residue in `Village.OWED`: POI wander, sleep gate, flower render (gossip sharing DONE D-554)
    - [x] ~~villager remainder~~ — D-496; residue in `Trade.OWED`: enchant power windows/combos, map pixels
    - [x] ~~G18e remainder~~ — CLOSED D-574/D-576 (history: D-500..D-571, DECISIONS) — residue: ~~villager type/profession
          overlay TEXTURES~~ D-580; `BE.PERSIST_OWED` cosmetic kinds
    - [ ] `Tame.OWED`/`Breed.OWED` — history D-503..D-620 (DECISIONS); left: /difficulty (held, D-327)
    - [x] raid loop + villager brain — D-502..D-664 (DECISIONS)
    - [x] ~~trade selection/prices~~ D-504/D-505 · ~~combat residue~~ D-494/D-497
    - [ ] G18c: MISSING OVERWORLD MOBS — list EMPTY (D-518..D-642, DECISIONS); Nether/End mobs: see ▶ NEXT
    - [ ] anything else PLAN.md's G18 section (`grep -n "G18" docs/PLAN.md`) still marks ☐/◐ — G18b closed
          D-637/D-643 — left: MOB SOUNDS (`S.OWED_SOURCES`), same D-645 size-call block as above
0.3 ~~red non-mob suite~~ D-532 · 0.4 ~~`vanillacheck`~~ D-558/D-567 (DECISIONS).
0.5 Then QUEUE rows 1… in order, same fan-out.
    **▶ NEXT (s171+):** lane answers at `start`. `ED.OWED` (detail: DECISIONS D-806..D-841): ~~10 items through crystal-ring spawn/beam-render/trident-strike~~ D-806..D-841. Still owed, named not guessed (shares `07zzl_enderdragon.js`/`07zzn_endcrystal.js`, not parallel): `respawnDragon()` placement-detection caller; `EnderDragonPart` per-part hit-test; natural first spawn (no End worldgen); beam-target-setting AI; SittingScanningPhase (needs per-part head position + bounded closest-player query); StrafePlayerPhase fireball + SittingFlamingPhase breath-cloud + death loot/XP; beam texture unextracted (D-840). Keep closing `ED.OWED` before a fresh G18c mob (list EMPTY).
    **harness-gpu-reds ruling (D-841, detail: DECISIONS):** worldcheck's torch + piston cases test states vanilla itself can't produce -- the CHECKS need revisiting, not `07f_redstone.js`/`07g_piston.js`. mobdrawcheck's skylight-stuck-at-7 case didn't reproduce in 4 attempts -- re-confirm before assigning a fix.

Old-list closures (D-139, D-436..D-470): see DECISIONS.md.

## 1 — G19b: the remaining container screens ◐

**Units:** ~~chest~~ (commit 6aeabed) · ~~barrel~~ D-403 · ~~ender chest~~ D-404 · ~~crafting table~~ D-405 ·
~~shulker box~~ D-406 · ~~double chest~~ D-413 · ~~furnace/blast furnace/smoker~~ D-414 · ~~hopper~~ D-419 ·
~~dispenser/dropper~~ D-420 · ~~trapped_chest + lectern signals~~ D-432 ·
**▶ brewing-stand screen — the LAST unit, and it waits on G23 to fill it**.

**Read:** `src/14g_menu.js` header (first 40 lines — the `doClick` model) · `src/15b_gui.js` header ·
`chestcheck.mjs` §7 and `guicheck.mjs` §4d/§4e as the worked examples.

* The substrate is done: `14g_menu.js` is the whole of `AbstractContainerMenu.doClick` off the
  bytecode. This job is screens over it, each with its own menu and slot layout **taken from the
  jar's GUI texture** the way `extract-guigeom.mjs` does (rule 3).
* ~~Double chest~~ D-413 is in: `chestpaircheck` (placement, pairing, breaking) + `chestcheck` §8 (the merge).
  ⚠ Found and NOT done, owed to whichever chest unit comes next: **a chest with a solid block above it,
  or a cat sitting on it, must refuse to open** — ~~DONE D-644~~ (`Hud.chestBlockedAt`; ocelots do not count, CatEntity only); and **check how a chest is drawn in the world at all** (its block bakes no quads, 07j ~l.494;
  whether a block-entity renderer draws it was not looked at) — a double needs the `type=left/right` model. And `type=right` is FIRST (top rows) is transcribed, not refereed — no javap here.
* ~~Furnace family~~ D-414 is in (`furnacecheck`, `guicheck` §4f).
  ~~the other container screens draw no title and no "Inventory" label~~ — DONE D-650 (`labelcheck`). The recipe-book button at (20, 49) is not
  drawn on any screen (no recipe book).
* ~~Hopper~~ D-419 is in (`hoppercheck`, `guicheck` §4g), including the transfer itself:
  `BlockEntities.tickHopper`, one item every eight ticks, the furnace's per-face slot table, and
  `Menu.furnaceSetItem`'s door. `BE.HOPPER_OWED` names what it still cannot do (item entities on
  top of it, minecarts, a composter).
* ~~Dispenser/dropper~~ D-420 is in (`dispensercheck`, `guicheck` §4h), including the four-tick
  latch, quasi-connectivity (`hasNeighborSignal(pos.above())`) and the dropper/dispenser split.
  `BE.DISPENSER_OWED` names the whole `DispenseItemBehavior` registry, which waits on projectiles,
  buckets, boats and mobs to equip — a dispenser THROWS every item today, which is what vanilla
  does for anything the registry has no entry for.
* ~~trapped_chest + lectern~~ D-432 is in (`redcheck` §17): both refereed off `clg`/`chp`. A trapped
  chest's power is the OPENER COUNT clamped to 15, not a boolean — the two rules agree in every
  single-player case, which is why the check drives four openers. The lectern's signal rule is LIVE;
  its page-turn (`powered`) is G19e's screen. `trapped_chest` is now an exemption in `redcheck`'s closed-set test
  alongside the comparator — both keep their strength outside their block state.

**Acceptance:** a scripted click sequence moves a stack **into** a container, **shift-clicks** it back,
and the contents survive a **close and reopen** (catches a screen that edits a copy) · a furnace with
coal and raw iron **progresses**, and the arrow length is a function of the counter at **three**
values (D-241, D-296) · closing a screen with items in a crafting grid drops them · (double chest, done: an
item put in the right half is in the right block entity, and breaking one half leaves a 27-slot chest).
**Anti-vacuity:** constant furnace counter → the three-value test fails; edit a copy → close-and-reopen fails;
swap left/right → the merge test fails.
**Closes** two `Use.OWED` rows; then build `trapped_chest` and `lectern` — `redcheck` FAILS if they stay
owed against a completed stage.

---

## 2 — G18e: breeding, taming, babies — and their particles and GUIs ◐

Dan, 17 Sept: *"with the exact GUIs and textures of the processes like sheep hearts and trade UIs
too."* **The hearts are part of the feature.** ⚠ Dan, this session: the PARTICLE substrate is
**deferred to G20** — the two cadences are extracted and carried unread, and `Breed.OWED` names
the wiring so `redcheck` can see it.

**Units:** ~~breeding/babies/taming(wolf+cat)/horse(motion+AI)/skin-collar-selection/texture-variants/collar-box/follow-owner/wolf-anger/pack-alert+owner-defence~~ D-423/D-424/D-458..D-477 (detail: DECISIONS) — **▶ NEXT:** leash+riding/G25 and multiplayer ownership (each needs a missing substrate, named not guessed) — **then horse/llama screens, RESCOPED (D-474):** not a screen-only unit — no `saddle`/`horse_armor` equip mechanic, no horse taming (separate roll from wolf/cat's, unread), no riding exists yet; item MODELS already extract but nothing wires them. ⚠ **Named not chased — row 0 item 5's "red-flash browser coverage":** `e.hurtTime` is bookkept but `07j_entityrender.js` never reads it; needs an unlocated CLIENT-side bytecode class (D-474).

**Read:** `src/07m_breed.js` header (250 lines, its own map) · `tools/golden/breeding-1.18.2.tsv` · `breedcheck.mjs` §4/§5 as worked examples.

* ~~**Breeding**~~ D-423 is in: love mode off `tools/extract-breeding.mjs` (`AgeableMob` and
  `Animal` found by their `ForcedAge`/`InLove` save keys), the 600-tick timer, the 6000-tick
  cooldown, feeding through a NEW entity-interaction path (`Use.entityUse` — vanilla switches
  ENTITY before BLOCK and this engine never did), the child, and the orb at `nextInt(7) + 1`.
  `EL.aiCtx`'s `onBreed`/`isTempting` are live for the first time since D-383.
* ~~**Babies**~~ D-424 is in: `AgeableListModel`'s per-group transform (the head and the body are
  NOT the same rule — four of ten models do not scale the head at all), read by
  `tools/extract-babymodel.mjs`, plus the box off `LivingEntity.getScale`.
* ⚠ **KW-26 IS STRUCK — IT WAS A WRONG FORWARD VECTOR IN THE TEST, NOT A FAULT IN THE GAME**
  (D-425). Every spawnable mob is drawn, lit and textured; `tools/mobdrawcheck.mjs` now
  photographs all seven every suite run, where only the guardian had ever been photographed.
* ~~**Taming: wolf + cat**~~ D-458 — full account in DECISIONS.md. Wolf/ocelot/cat/parrot did
  not exist as mobs at all before this session (no motion, and cat had no texture); fixed at the
  MECHANISM level in `extract-entity-motion.mjs` (D-390's generic-candidate referee, extended)
  and `extract-mob-textures.mjs` (a second, optional 1.18.2-jar fallback) rather than by hand.
  Horse refuses the same motion check (`AbstractHorse` overrides `travel()` for real) —
  **now closed, D-459**: the override's own body gates its custom branch behind a
  never-true rider condition (no riding system exists) and falls through to `axy.h()`, the same
  generic body every other mob uses; horse now exists (spawns, walks, breeds/tempts/flees) with
  a placement-tier AI roster, same caveat wolf/cat/ocelot carry. `07n_tame.js` (new) is the wolf/cat feed-and-roll (1-in-3, read by
  hand off both classes' own bytecode) plus sitting. **Ocelot cannot be tamed in vanilla 1.18.2
  at all** (verified, not assumed) and **parrot needs a flying-AI substrate this engine does not
  have** — both refused on purpose, not left out; see `Tame.OWED` in the module itself for the
  taming-specific remainder (collar tint, skin-state swap, anger, leash, riding, follow-owner).
* Then **the horse and llama inventories and screens** (saddle/armour; llama chest slots by
  strength), over the finished `14g_menu` substrate.
* ⚠ Still owed by D-423/D-424 and named rather than silent: the hearts and the growth puff (G20);
  orb PICKUP (G21); the thirteen species in `Breed.SPECIAL` whose `getBreedOffspring` is not the
  generic path (a turtle lays an EGG; a lamb's colour is the parents' dye-mix); 15 of 25 baby
  models unread, each with its reason.
* ⚠ A species rostered in `Ai.ROSTER` later needs **its own** `TemptGoal` ingredient read: cow's
  was refereed (`bij.u()` builds it with `Ingredient.of(Items.WHEAT)`, the same item `isFood`
  reads) and the others are not.

**Acceptance:** ~~two cows fed wheat produce ONE baby and **refuse** before the cooldown~~ (done,
`breedcheck` §4/§5) · ~~a baby's box and scale differ and it **grows**~~ (done, `babycheck`
§2/§4) · the wolf tame rate holds **across a distribution** (D-228) · hearts emitted in love mode
**and not outside it** (G20) · a llama's chest slots track its strength.
**Anti-vacuity:** no cooldown → refusal fails; tame always succeeds → rate fails; hearts unconditional → both-directions fails.

---

## 3 — G18f: villagers and the trading screen ◐

Villages generate (W17); empty villages were the visible hole.

**Units:** ~~villager exists~~ D-478 · ~~professions/workstations~~ D-479 · ~~offer tables~~
D-480 · ~~trading mechanism~~ D-481 (level 1 only, RESCOPED, Trade.OWED) · ~~GUI polish~~
D-482/D-483 · ~~levels/XP~~ ~~restocking~~ D-484 · ~~iron golem exists~~ D-485 (motion+AI+texture
only, real goals owed) · ~~real registerGoals: retaliation + hostile-mob attack AI, shared anger
timer~~ D-486 (`bin.u()` javap'd in full, exact classes/priorities/args in DECISIONS.md D-486 —
no second javap pass needed). NEXT: village golem spawn trigger (population/bed ratio — nothing
spawns one naturally yet), then registerGoals' owed halves (angry-player TARGET goal,
DefendVillageTargetGoal, ResetUniversalAngerTargetGoal's alert-others half, `bei`/`bee` movement,
OfferFlowerGoal — all named in D-486). Raid loop ⚠ BLOCKED (D-485) — needs illager mobs + G23's
status-effect substrate; don't re-chase without one landing first.

* No slot-PLACEMENT economy (you don't drag payment into input slots by hand) and restocking
  isn't gated on workstation standing — both on Trade.OWED. Gossip/price/demand remain too.

**Acceptance:** level-1 offers **exactly** match the table for three professions at two levels · an
an over-traded offer **disables**/**restocks** · price **rises**/**falls** after hurting/a won
raid · the list scrolls past what fits · N villagers + N beds spawn a golem, fewer do not.
**Anti-vacuity:** no disable rule; frozen gossip; one-offer scroll list.

---

## 4 — G20: the particle engine, then weather ◐

**Units:** ~~particles(substrate+draw)/weather-state/lightning+trap/rain-snow-drawn/rain-splash/sunrise-sunset-band/hit-particles/block-dust/particle-lighting/lightning-rod/copper-weathering/GlowParticle~~ D-581..D-664 (detail: DECISIONS) — **▶ NEXT:** what is left of G20 is named in `Wx.OWED`/`Cb.OWED`; rain/thunder sounds wait on D-12.

**Read:** `src/09b_sky.js` header · `src/14j_combat.js` lines 17–50 (`Cb.OWED`).

* **Particles first** — billboards with position, velocity, gravity, age and a per-type sprite
  animation, on the §8 mesh path `07j_entityrender.js` already uses. Types: block break (the
  block's own texture), crit, enchanted hit, smoke, large smoke, splash, bubble, flame, heart,
  angry/happy villager, damage indicator, portal, note, explosion, item crack, effect.
  **A cap and a degradation rule, not a hang** (like `ER.MAX_QUADS`).
* **Weather** by biome temperature and altitude; sky and light changes in rain and thunder; rain
  and thunder sounds (`S.OWED_SOURCES.weather`); lightning, the lightning rod, lightning fire, mob
  conversion (pig→zoglin, villager→witch, creeper→charged).
* ~~**The sunrise/sunset band** G16b left undrawn.~~ DONE D-657 (WebGL2; WebGPU has no sky pass, KW-24).

**Acceptance (a BROWSER stage; freeze `Settings.adaptive` and the day cycle first, D-145/D-321):**
forced rain changes pixels in plains and **not** in desert · snow where plains gets rain · break
particles carry the block's **own** colour · a crit emits crit particles and a non-crit does not ·
sky light **drops in thunder** and recovers · 100,000 particles degrade frame time **and the cap holds**.
**Anti-vacuity:** no temperature term; a fixed break texture; no cap.
**Closes** ~~`Cb.OWED`'s crit/sweep row~~ (D-658), `S.OWED_SOURCES.weather`, ~~`Rs.OWED_SOURCES.lightning_rod`~~ (D-662).
Close-out adds `node tools/bench.mjs --profile low` — particles are what could cost frames.

---

## 5 — G21: experience ○

The orb entity (`ER.OWED`'s `experience_orb`): merge, attraction, pickup delay, the size-by-value
sprite. The level curve — **three** expressions (changes at 16 and 31), from the jar. Drop-on-death
and its cap. Mob XP on death (closes `Cb.OWED`'s experience row).

**Acceptance:** the level for a total XP matches the jar **at 5, 20 and 40** (D-234) · orbs merge ·
an orb approaches inside its radius and not outside · death drops the capped amount.
**Anti-vacuity:** the level-1–15 expression everywhere → the level-40 test fails.

---

## 6 — G22: enchanting, anvils, grindstone, the enchantments ○

* **Table:** bookshelf power (cap 15, **line of sight** — a torch between breaks it), the seeded
  offer roll (stable until an enchant is taken), lapis and level cost, the Standard Galactic label.
* **Anvil:** repair, combine, rename; the doubling prior-work penalty; "Too Expensive!" at 40; damage on use.
* **Grindstone:** disenchant and the XP returned.
* **All 37 enchantments** (weights, caps, incompatibilities, applicability) from the jar; wire
  Sharpness/Smite/Bane, Sweeping Edge, Knockback, Fire Aspect, Thorns, Protection, Efficiency,
  Unbreaking, Fortune, Looting, Silk Touch, Feather Falling, Respiration, Aqua Affinity, Depth
  Strider, Frost Walker, Mending.

**Acceptance:** bookshelf power falls with a torch between · offers stable across reopens and change
after an enchant · anvil cost matches the jar at three prior-work values, and 40 refuses · Sharpness V
does the jar's damage and the plain sword the base · **Fire Aspect → a burning cow drops cooked beef**
(G18d's rule — the join) · Looting raises the drop distribution and Looting 0 leaves it at baseline.
**Anti-vacuity:** no line-of-sight term; seed fixed after an enchant; Sharpness unconditional.
After this, `Cb.OWED` is at most one row, and it names its stage.

---

## 7 — G23: brewing, potions, status effects ○

Status effects first (amplifier, duration, ambient/particle flags, attribute modifiers, HUD icons,
regeneration/poison/wither/harming ticks — and Blindness suppressing a crit, `Cb.OWED`'s last row).
The brewing stand (three bottles, ingredient, blaze fuel, 20-s timer, bubbles; the screen is G19b's).
The recipe tree from the jar (awkward, modifiers: redstone extends, glowstone amplifies, gunpowder
splashes, dragon's breath lingers; fermented spider eye inversions). Splash/lingering potions and the
area-effect cloud. Colours already come from D-259.

**Acceptance:** awkward + sugar = Swiftness and nothing else · redstone extends to the jar's value;
glowstone amplifies **and shortens** · spider eye inverts Swiftness to Slowness · a cloud affects inside
its radius and not outside · Blindness suppresses a crit and its absence does not.
**Anti-vacuity:** every ingredient → one potion; the cloud at any distance.

---

## 8 — G19d: eating, the use-item hold, the offhand ○

**Read:** `src/14l_use.js` lines 32–75 (`Use.OWED`). Do this before 9–12: the hold is what they sit on.

The `useItem` hold with its tick count and per-item duration; the eating animation, particles and
sound; food and saturation (already in `foods.json` since G7, with `isFastFood`/`canAlwaysEat`) wired
to G5's hunger; potion drinking and milk. **The offhand, which is not drawn** (the golden table has
both frames; `guicheck` names the gap): F to swap, shield and food in it.

**Acceptance:** a full hold on bread restores the jar's exact food and saturation; releasing early
restores **nothing** · a full player refuses bread and accepts a golden apple · the offhand is drawn and
`guicheck`'s gap assertion is **deleted**, not weakened.
**Anti-vacuity:** an instant hold → the release-early test fails.

---

## 9 — G19c: sleeping ○

Beds and the sleep state, the camera move and fade, the night skip and its rule, the spawn point,
each refusal with its own message (monsters nearby, not tired, obstructed, **the bed exploding in the
Nether** — implement now against a dimension flag).

**Acceptance:** sleeping at night reaches morning and **by day refuses** · the spawn point moves and a
death returns there · a hostile within the radius refuses and one outside does not.
**Anti-vacuity:** no radius test → monsters-nearby fails.

---

## 10 — G24: farming and fishing ○

Crop growth (random-tick rate, stages, hydration within four blocks, light, the neighbour-weighted
speed) for wheat, carrots, potatoes, beetroot, melon/pumpkin stems, sugar cane, cactus, bamboo, cocoa,
nether wart, sweet berries, and **saplings growing into the W track's own tree features** (the join).
Bone meal (per block; grass spreading flowers — `Use.OWED`'s row). Trampling; the composter. Fishing:
rod, bobber (`ER.OWED`), catch timer with rain/open-water modifiers, the three loot tables, Luck of
the Sea and Lure.

**Acceptance:** hydrated wheat matures in fewer ticks than dry (a comparison, D-291) · light 8 grows,
7 does not · bone meal advances a crop and **not** a mature one · a bone-mealed sapling makes **the same
feature** the W track generates · jumping reverts farmland and walking does not · fishing over open
water draws from the right table.
**Anti-vacuity:** no moisture term; a separate tree generator.

---

## 11 — G25: vehicles, frames, paintings, armour stands, the moving piston ○

Boats (water/land physics, passengers, paddling, breaking to planks). Minecarts and all rail types
(powered boost, **detector signal**, curves and slopes; chest/furnace/hopper/TNT/spawner carts). Item
frames (rotation, **comparator output by rotation**). Paintings (the motive table and the size-fitting
rule). Armour stands. Tripwire hook and target block (`Rs.OWED_SOURCES`). **The moving piston block
drawn part-way between its cells** (a render interpolation over G15's block entity).

**Acceptance:** a cart accelerates on powered rail and slows on unpowered · a detector emits with a
cart on it and not after · frame comparator output across **all eight** rotations · a 2x2 gap only
ever gets a motive that fits · the piston's block is drawn between cells at a mid-tick (pixels).
**Anti-vacuity:** snap the piston to its end cell; allow any motive.
**Closes** every `Rs.OWED_SOURCES` row except `sculk_sensor` (leave it named with its stage).

---

## 12 — G19e: the last item uses and interactable blocks ○

Shears · fire charge · lead · name tag (and the persistence flag G18c reads) · written book · spyglass
zoom · honeycomb waxing · note blocks (instrument by block below, 25 pitches) · jukeboxes and discs
(`S.OWED_SOURCES.record`) · lecterns (screen G19b, comparator G15) · cauldrons (three levels, dyeing,
washing) · composters (shared with 10) · the bell.

**Acceptance (both directions each):** shears drop leaves and a pickaxe does not · note block over wood
is harp and over sand is snare, across four families · a jukebox plays and **stops on removal** · a
cauldron drops exactly one level per use. **`Use.OWED` is EMPTY** at the end, or every row left names
G26/G27 with a reason — `usecheck` holds it.

**What Dan should try after row 12:** plant a farm and come back; catch a fish; ride a minecart;
hang a painting; sleep through a night; eat while hurt. Then play an hour and write down everything
that looks wrong.
