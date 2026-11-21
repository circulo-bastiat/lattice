# NEXT — the board

⚠ **This file is a board, not a log.** It says what to do now and what Dan should look at. The
order of work is `docs/QUEUE.md`; where the project stands is `docs/STATE.md` (via `brief`); what
happened is the git log and `docs/DECISIONS.md`. A session appends NOTHING here — it edits the
"Now" block and the lists below in place, and `doccheck` holds this file to 24,000 bytes.

## ▶ Now

**D-773: order = QUEUE 0.00 (reds green → G18 leftovers, ported not hand-made, sounds last → ask Dan).** QUEUE 0.00 part 1 ALL GREEN (D-812/D-813). **D-779: cloud = `cloud session`, all bookkeeping automatic (CLOUD.md §2).**

**Session 170 (D-839..D-841), 4-worker Workflow wave (usage 16%/25% at open):** closed 3 more ED.OWED residue items -- `Cb.tickTrident` can strike a crystal (D-839); its beam now actually draws, untextured pending a future extract pass (D-840); `EnderDragonFight` spawns real live crystals at the ring positions (D-841). Clean merges; 381-assertion recheck green. 4th worker (harness-gpu-reds) found no fix to make -- ruling in QUEUE.md. Dan said stop the loop after this pass -- trigger disabled. Detail: DECISIONS D-839..D-841. Queued: push/reconcile/suite.

**Session 169 (D-836..D-838), autonomous loop pass, 3-worker Workflow wave (usage 15% weekly/15% window at open; the three ED.OWED residue items named at D-835's close turned out to be independently file-scoped: `src/14j_combat.js`, `src/07zzl_enderdragon.js`, `src/07j_entityrender.js`):** closed all three -- real player melee/arrow destruction of `end_crystal` now reaches `EC.damage` (D-836); `ED.buildCrystalRing`'s alive-bookkeeping now correctly flips for a real live crystal kill, ported off `.decomp`'s own column-based `countAliveCrystals()` rule rather than guessed (D-837); the crystal's real render model plus a new beam-geometry primitive (`ER.crystalBeamQuads`) are built, off `.decomp` verbatim, though GPU submission of the beam isn't wired yet (D-838). All three merges clean, no conflicts (`tools/suite.mjs`'s three registration lines auto-merged); combined recheck on master green (532 assertions, 55 breaks caught, 0 failures). Separately, the PC-loop shared claim list's `harness-gpu-reds` item: 8 of the 10 previously-reported full-suite reds are already fixed (a stale report, predating the D-834/D-835 reconcile); `worldcheck` (redstone-scheduled-shutoff + piston-sync-extend) and `mobdrawcheck` (sealed-room skylight stuck at 7) are confirmed real bugs, not GPU artefacts, and handed off unfixed; `flashcheck` could not be run this pass (structurally exceeds `device_bash`'s 180s cap). Queued: push/reconcile/full suite; answers at next `start`.

**Session 168 (D-834..D-835), autonomous loop pass, 2-worker Workflow wave (usage 13% weekly/3% window at open; only 2 row-0 units were independently file-scoped -- the shared claim list's reland job and ED.OWED's next substrate step):** re-landed archived cloud unit `relaxed-goldberg-93jfut` -- its referee-looting change was a pure duplicate of master's own independent fix, kept master's side; its evoker/illusioner flee AI (`tools/illagerfleecheck.mjs`) was new and kept (D-834). Built the real `end_crystal` entity this engine was missing entirely -- registered in `EL`, real invulnerable-except-explosion damage rule ported off `.decomp`, wired into the already-real fight->dragon->phase `crystalDestroyed()` chain, and TNT/creeper explosions now reach it too; still owed: melee/arrow destruction (one line in `14j_combat.js`), the render model + beam visual, and the crystal ring's synthetic bookkeeping not yet reconciled with real entities (D-835). Both merges clean (299 assertions, 4 breaks caught, 0 failures on the combined recheck); the concurrent runner's own reconcile landed D-832/D-833 mid-session, unrelated to this pass's units. Queued: push/reconcile/full suite; answers at next `start`.

**Sessions 164-167 (D-816..D-831), compacted:** PC loop shares the cloud claim list (pcclaim), reconcile in its own worktree → `cloud-merged`, suite stopped grabbing Dan's cursor/sound (D-816..D-817); re-landed `keen-johnson-xickva` (armor fire/feather-falling/blast enchants) and built real `ED.EnderDragonFight` -- crystal ring, exit-portal search, spawn-state timer sequence (D-824..D-826); re-landed `sweet-dirac-i8z3xm`, armor_stand physics + arrow water drag/bounce (D-828); re-landed `clever-brown-t6gsew` (husk hunger fix, real `FleeEntityGoal` rewrite, wandering trader flee), wired `EnderDragonFight` into spawn + the crystalDestroyed->dragon->phase chain (D-830..D-831).

**Sessions 162-163 (D-812..D-815), compacted, autonomous loop passes:** 1-worker waves both times (only one `ED.OWED` unit independent; usage 4-8% weekly). Pinned `ender_dragon`'s real `[gravity,drag]` `[0,1]`; declined `canSpawn`/`motionFor` wiring as premature (D-812); QUEUE 0.00 part 1 verified ALL GREEN (D-813); then built it -- `ender_dragon` registered in `EL`, flying its `HoldingPattern` ring for real (D-814); swept several older stray git locks (D-815).

**Session 161 (D-810..D-811), compacted, autonomous loop pass:** usage checked (7% weekly, 41% five-hour window) -- wave size 4 allowed but only one `ED.OWED` unit was independent this pass (the rest share `src/07zzl_enderdragon.js`), so a 1-worker wave. Closed LandingPhase/SittingAttackingPhase/ChargingPlayerPhase/AbstractSittingPhase.modifyDamageTaken and SittingFlamingPhase (minus its breath-cloud spawn) off `.decomp` (D-810); SittingScanningPhase declined -- needs per-part head position and a bounded closest-player query, neither exists in this engine. Clean merge; a stale `master.lock`/`HEAD.lock`/`index.lock`/`packed-refs.lock` (one dating to session 103) genuinely blocked the first `update-ref` attempt this time (not just cosmetic noise like D-809) -- swept the same way, retry succeeded (D-811). Queued (not run): push, reconcile, full suite; answers at next `start`.

**Sessions 155-160 (D-784..D-809), compacted:** Nether/End mob waves closing out `Wi.OWED`/`ED.OWED` --
mob-giant CLOSED, shulker teleport-on-hurt, wither's AI slice + ranged skull attack + 3-head/tail
renderer + DescendAtHalfHealthGoal/invuln/regen/expiry-explosion + two independent side-heads,
`Wi.OWED` fully EMPTIED; dragon's 24-node A* path ring, PhaseManager + per-part damage routing +
8-part renderer, StrafePlayerPhase, tickMovement motion blend, DyingPhase, rotation-methods +
Landing/TakeoffPhase; a real cross-mob ARMOR substrate. All merges clean (one hand-fixed conflict,
one gatecheck anti-vacuity gap fixed); the unlink-blocked-checkout workaround
(`git show <rev>:<path> > <path>`) found; a duplicate `enderdragonphasecheck` stage-id (stale red,
not a game bug) and a few stale-doc/lock-sweep fixes along the way. Full detail: DECISIONS D-784..D-809.

**Sessions 150-154 (D-758..D-779), compacted:** 3-worker command-testing wave fixed `/setblock`+`/setworldspawn`+`/spawnpoint`+`/playsound`+whisper style; parallel-night 15th/16th waves closed KW-38..47; cloud bookkeeping made automatic (since-base fence, browser-stages-to-PC-lane, `assets` store pack, STACK, hand-off files, claims.mjs/reconcile.mjs/claimcheck), every cloud unit reconciled onto master incl. cloud unit 1's AvoidEntityGoal rewrite. Full detail: DECISIONS D-758..D-779.

**Sessions 136-149 (D-692..D-757), compacted:** vanilla-parity command fixes (`/teleport`+`tpcheck.mjs`, `/kill`/`@e[type=]`/`/execute`-as-mob, `/give /clear /clone /fill /time /weather /locatebiome /locate /stopsound`, whisper style, `/setblock`+`/setworldspawn`+`/spawnpoint`+`/playsound`); `cullcheck` occlusion-flood determinism fixed (KW-2, KW-37 flake chased and finally closed as a harness race); piglin/brute + witch hat + zombie head/hole-in-head + goatcheck (KW-34/KW-35) all closed; cross-mob/mixed-crowd testing (rule 7) and `/summon` engine-wide break fixed; infra hand-offs (16 referee bundles) merged throughout. Full detail: DECISIONS D-692..D-757.

**Session 135 (D-683..D-691), compacted:** mob freeze/creative-chase/knockback fixed; turtle speed; piglin limbs + AI; blazes/ghasts/striders new; Dan's testing-only order (QUEUE 0.0) begins.

**Session 134 (D-680..D-682), compacted:** hoglins + zoglins; hoglin model parts; mobs hold their swords/axes/bows visibly.

**Session 133 (D-676..D-679), compacted:** piglins + brutes exist (gear, gold-armour AI, zombified-piglin timer); phantoms sit on their hitbox; mobs swing their arm when they hit; baby zombies stop growing up.

**Session 132 (D-673..D-675), compacted:** wither skeletons exist; every mob drawn at its renderer's real scale; left-handed bows.

**Session 131 (D-669..D-672), compacted:** villager trades match the real server; mob spawn gear (enchants, left-handed, captains, babies).

**Session 130 (D-665..D-668), compacted:** bow/sweep/wolf kills count as yours; real LocalDifficulty; fresh-world mobs rarely armoured; phantom bite 2.

**Sessions 115-129 (D-625..D-664), compacted:** snow golems/phantoms/lightning+skeleton-horse trap/infested strongholds/endermites; beds+sleeping+phantom reset; throwables incl. ender pearl; throw sounds/particles+potion arc; bed wake-up search+sleeping camera; pearl portal specks+egg crumbs; snowball crumbs; spawn eggs whole; blocked chests; container titles+chest/shulker slot pixels; rain/snow drawn+splash+sunrise/sunset glow; undead potion reversal+immunities+axolotl dry-out+enderman rain; hit/block-dust particles lit by where they are; lightning rods+copper weathering/wax/scrape; mob list's raid line confirmed. Full detail: DECISIONS D-625..D-664.

**Sessions 88-114 (D-486..D-624), compacted:** the parallel night begins (D-487, `.claude/loop-prompt.md`); iron
golem/villager AI+trading; horse riding/leads/baby models; Raid state machine + evoker/illusioner + mob equipment/gear;
TNT/creeper explosions; fox/goat/dolphin/raid riders/enderman/rabbit/bat/slime/llama; villager job/sleep/gossip/NBT
save; jockeys/wolf goals/XP orbs/ravager roar/zombie reinforcements; name tags/tipped arrows/spawner cages/silverfish/
parrot goals. Full detail: DECISIONS D-486..D-624.

**Sessions 84-87 (D-482..D-485), compacted:** trading screen slots/background, villager xp/levels + restocking, iron golem exists.

**Sessions 80-83 (D-478..D-481), compacted:** villager exists; professions/workstations; offer tables; trading mechanism. (DECISIONS)

**Sessions 64-79 (D-456..D-477), compacted:** shared chunk cache; wolf/cat/ocelot/parrot + taming; horse; the session loop; tame looks + collar; mob textures on the GPU; weapon enchants; Fire Aspect + burn tick; wolf anger, follow-owner, pack alert. (DECISIONS)

**Owed and named** (from sessions 54/55, unchanged): `ER.ZARM_OWED` swing animation; the F4 per-entity
tint; the heart/growth-puff cadences (G20, `Breed.OWED`); experience-orb pickup (G21); `Breed.SPECIAL`;
15/25 baby models. **KW-25** still open (the worldgen gate asks the weaker `Features.setBlock` question
for 13,799 feature-placed blocks). The block-entity holes (beds G19c, banners G26, signs G19e, shulker,
skulls G25) are packed and unwired.

## The browser — what a session can run, and where

* **`device_bash`, Dan's PC:** `.chromium/chrome` (Chrome for Testing, headless, SwiftShader). Every
  browser tool finds it through `tools/cdp.mjs`'s one list. If `.chromium/` is missing:
  `node tools/get-chromium.mjs` (~1 min, no sudo). `--probe` prints the GPU limits.
* ⚠ **It reports `MAX_ARRAY_TEXTURE_LAYERS` = 2048 — the same ceiling as every Windows Chrome/Edge
  (D3D11, D-379).** That is the right thing to test against: the atlas is larger and boots only
  through its two shards (D-380). A change that pushes the atlas past two shards' worth fails here
  first, which is where it should fail.
* ⚠ **A `device_bash` call is killed at ~180 s and nothing survives it** (every call is a fresh
  sandbox; `nohup`/`setsid` die with it) — this is a TIME budget, not a connectivity problem:
  Chromium binds and drives the real game fine here (D-457, `diagcheck` confirmed it). 16 of the
  20 browser stages fit under that ceiling. **The whole suite, and
  `palettecheck`/`cullcheck`/`flashcheck`/`lumacheck` (its own default soak alone is 75s), go to
  the Windows runner:** `node tools/lane.mjs suite`
  (or `lane.mjs run <tag> — node tools/<check>.mjs dist/mclite.html`) — no cap, Edge, real GPU.
* One browser stage per call, `MCLITE_PRESET=medium`, and `pkill -x chrome` between them (D-281,
  D-322) — **not** `pkill -f chrome`, which matches the shell's own command line and kills it.

```
node tools/suite.mjs --fast --to structcheck        # headless half 1 (~200 s — split with --only if needed)
node tools/suite.mjs --fast --from vanillacheck     # headless half 2
MCLITE_PRESET=medium node tools/suite.mjs --only <browser stage>   # one per call
```

## Known gaps, named and open (each held by a list a check keeps closed)

* **Mobs** — cow, zombie, skeleton, spider (+ guardian, dolphin, turtle drawn) wander, path,
  spawn, strike and shoot, and since D-417 they COLLIDE: goals aim, `Ph.travelMob` moves, and
  fall damage, step-up, the water branch, `Entity.push` and suffocation all came with it. A drawing
  skeleton now shows a real bow and its arrow renders (D-449) — `EL.owed()` names the ~100 types it
  refuses; `ER.OWED` names the three spawnable types still with no picture (**spectral arrow is
  still invisible**, left on purpose; experience orb G21; fishing bobber G24). `Ai.OWED` names the
  goals not built.
* **`Cb.OWED`** — Blindness-suppresses-crit, thorns (formula known, needs an armor-item substrate), experience, attack sounds and particles (G20–G23).
* **`Use.OWED`** — the right-click interactions not built (G19b–G19e, G24).
* **`Rs.OWED_SOURCES`** and five analog blocks — `redcheck` holds both (G19b, G20, G25).
* **The offhand is not drawn** (G19d) · **the sunrise/sunset band** (G20) · **the moving piston
  block between cells** (G25) · G15's intra-tick ordering quirks.
* **WebGPU**: black on real hardware (KW-1); has the sky's colours, not its bodies; its hand pass
  has never executed (D-359, no adapter headless — D-310).
* ~~`cullcheck` is red on purpose~~ (KW-2, D-356) — FIXED D-752 (session 148): the flood's own
  BFS was fine, `cullcheck.mjs`'s settle-guard was silently no-op'ing. Clean at default AND
  `MCLITE_PRESET=high`, 3x each, verified independently by two parties.
* **`backupcheck` is red and honest** (KW-13): until D-407 it wrote bundles into a stray `C:`
  folder INSIDE the project and passed. The two it made are in `.trash/` — copy them to
  `C:\claudeisthegoat\_backups\`. It needs that folder connected to the session to write one.
* The open worldgen gaps (refused structure sites, sea-level ground, per-biome feature ratios,
  `magma_block` never generating — D-67) are in PLAN's gap table with their decision numbers.

## What a human should look at

> Session 148 (D-750..D-753): nothing new to LOOK at, but one thing to FEEL — teleport (`/tp` or a
> command block) while moving or mid-fall: you should now keep your horizontal speed and direction
> on landing instead of stopping dead, matching vanilla. Everything else this session was test
> infrastructure (a flood-culling determinism check fixed, a flaky clone-test caught and reopened
> rather than papered over) — nothing else should look or feel different.

> Session 139 (D-703..D-707): mostly testing/bugfixing, little new to LOOK at — but 2 bugs the
> testing found and fixed would've hit you eventually: a ghast that could get stuck unable to
> wander/attack (silent console errors), and a rare crash spawning a baby zombie/husk/drowned/
> zombie-villager/zombified-piglin/polar-bear-cub too early. Should just work now. ⚠ Asking again,
> plainly: **mob sounds just need your size call** (D-12/D-645). Ground bug STILL not reproduced
> (3 sessions, incl. real walking + eyes on screenshots) — the "snowy village" test spot turned out
> to be plain forest, so a real location from you (structure/terrain, surface/cave, day/night,
> direction) would help a lot — we're out of good guesses.

> Session 133 (D-676..D-679): spawn a piglin (no gold on) — it should come at you; put on a gold
> helmet and spawn another — it leaves you alone. Wait 15 seconds: both turn into zombified piglins
> holding the same weapon. Spawn a phantom near you: it should fly at its own height, not float a
> block above its shadow. Let a zombie hit you: its arm and body jerk on the hit.

> Session 121 (D-647..D-649): throw a splash potion of healing at a zombie — it should take
> damage, not heal. Throw a splash water bottle onto a campfire or a lit candle — it goes out.
> Leave an axolotl on dry land in the sun for five minutes — it starts taking damage.

> Session 117 (D-635..D-637): throw a snowball and an ender pearl — you should HEAR each throw
> and see a purple trail where the pearl lands. Sleep in a bed: the view should drop low and
> face along the bed, no hand. Build a fence ring round a cow and walk away with wheat — it
> should follow you to the fence and no further.

> Session 108 (D-584..D-588): find a village with a farmer and some wheat/carrots — the farmer
> should walk the field, break ripe crops and replant them. Breed two cows: hearts should now
> FLOAT UP and fade, not just be invisible. Trade with any villager: green sparkles pop around it
> after each trade. Rarely at night you may meet a baby zombie riding a chicken, or a skeleton
> riding a spider. A wild wolf near sheep should go after them.


0. ⚠ **Every big find came from Dan PLAYING and typing a sentence.** Tell me what is still wrong.
1. ⚠⚠ **MOBS — start here, it is the one that changed most (D-415).** A cow, zombie, skeleton or
   spider egg should now give you something that LOOKS like that mob: right way up, standing on
   the ground, facing the way it is walking, with its legs and arms swinging as it moves. Before
   this session every one of them was upside down and half-buried. The six types the eggs will
   spawn are still all there are (the other 107 say so out loud when you use the egg) — that is
   D-307's closed set and it is the next mob job. **The SPIDER got its own `setupAnim` too
   (D-416)** — eight legs splayed under it and lifting as it walks — and its model was rebuilt
   along the way: it had been shipping twelve parts with one leg's name used twice and seven of
   the eight at the wrong texture.
2. ⚠ **The four other things you found (D-415), each worth ten seconds:** turn on the spot with
   something in your hand and watch it STAY where it should (spin a few full turns — that is what
   broke it); look at the horizon and check the hard pale line across the sky is gone (Video →
   Horizon Fade turns it back on if you want to see what it was); toggle Video → Smooth Lighting
   under a tree or in a cave and watch the light go soft instead of stepping per face; and pour a
   water bucket onto lava (a source becomes OBSIDIAN, a flow becomes COBBLESTONE, and lava falling
   into water becomes STONE — none of that existed before).
3. **A NEW world is now genuinely new (D-415).** Title screen → "New world — erase saved changes"
   clears everything and comes back to the title with a fresh random seed in the box; press Create
   world from there. It used to hand you the same seed and put you back where you were standing.
4. **Worldgen, if you go looking (D-415):** lava lakes should have a stone wall all the way round,
   lava with somewhere to fall should now actually fall when the chunk loads, and there should be
   no air pockets under the sea (those were dungeons dug into a seabed with no wall on the water
   side). ⚠ Candles were checked against your report and were already right — four to a block,
   four different models; if they still misbehave for you it is the AIMING, not the stacking, so
   say what you clicked on.
5. **Mobs in play, as before.** A zombie in a dark room should find you and hit on a cooldown; a
   skeleton should shoot (the arrow is invisible — known); a hit cow should run; a spawner block
   from creative should tick and produce its mob.
6. **The containers:** chest, barrel, ender chest, shulker box (it must refuse another shulker),
   crafting table — shift-click, drag, close and reopen.
   **The double chest** — place two chests side by side (same way facing); they join into one
   54-slot chest. Break one half and the other goes back to 27. (Sneak-click a chest's side to force a
   join. The chest is not drawn in the world yet — see QUEUE — so judge it by opening it.)
   **The furnaces** — right-click a furnace, blast furnace or smoker. Shift-click coal and raw iron in
   (coal goes to the fuel slot, the ore to the top); watch the flame shrink and the arrow fill; shift-click
   the ingot out. A blast furnace should refuse a raw porkchop and a smoker a raw iron.
7. **The white flashes** (D-247): the fifth cause was `desynchronized: true` and it is out. If they
   come back, D-247 is wrong — do not stack a sixth cause.
8. **The sky** (D-300/303/304): ten game minutes — dusk, the moon's phases, stars; walk plains →
   swamp and watch the colour blend. Look up at the LOWEST preset too.
9. **Survival:** C cycles gamemodes; hearts, hunger, ice, crouching; E opens the inventory; wear
   iron; close the tab and everything comes back. Mine underwater; hold your breath.
10. **Sound** (click first): footsteps count distance, so a row of the same block must not sound
   like a machine gun.
11. **Creative E and `/help`**: 12 tabs, 29 commands with Tab completion — try `/locate village`.
12. **Terrain** (D-161): do mountains read as mountains? Two constants in `04d_column.js`.
13. **Placement and light**: stairs, wall torches, sideways logs; break a block and watch the light;
   F8 toggles the occlusion flood (a thin horizon band is expected, a hole is not); run
   `bench.mjs --profile low` on the 2200G. ⚠ Smooth lighting costs +8.8% mesh time now — if the
   2200G feels worse when streaming, that is the first thing to turn off.

## Standing rules that live only here

* `C:\claudeisthegoat` (MineHTML) is **READ-ONLY** — a session may be running there.
* `assets/`, `.mcdata/`, `.chromium/` and the data cache never enter the repo (D-6).
* **Any A/B screenshot freezes `Settings.adaptive` and the day/night cycle first** (D-145, D-321),
  and a check that counts entities holds `MCL.Spawn.ready = false` (D-397, D-407).
* `node build.mjs` refuses a stale data module (D-318): run `node tools/gen-data.mjs` and rebuild.
* **Parallel work goes through the WORKFLOW tool and nothing else** (Dan, 8 Sept) — `docs/AGENTS.md`.
* Stop at ~97% of the window; never touch usage credits (D-24).
* The lessons that cost the most, by number: a check that never looks at the picture cannot see the
  world (PLAN §23) · a passing check proves only what it touches (D-276) · a check that fixes one
  configuration/seed/example/average tests only that (D-196, D-227, D-228, D-241) · a check that
  enters BELOW the broken layer (D-331).
