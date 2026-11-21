# The behaviour referee (unit I4)

The referee asks a REAL 1.18.2 dedicated server what a mob's numbers are, over RCON, so
`tools/referee/*check.mjs` checks can compare the engine against the game itself rather than
against another number someone typed into a check by hand (D-263).

## Layout

- `tools/referee/rcon.mjs` — a minimal Source RCON client (node:net, no deps).
- `tools/referee/server.mjs` — starts/stops the real `jars/1.18.2/server.jar` headless
  (eula, flat/void world, rcon enabled with a random password). Needs Java 17+; refuses with a
  clear message on an older `java`.
- `tools/referee/run.mjs <pack.json>` — the scenario runner: for each mob in a pack, forceloads
  a chunk, summons it tagged, reads `/attribute ... base get` and `/data get entity ...` for the
  requested fields, and writes a golden JSON snapshot.
- `tools/referee/genpack.mjs` — regenerates `packs/mob-defaults.json` from the engine's own
  `assets/entities.json` registry (never hand-typed).
- `tools/referee/packs/mob-defaults.json` — the first pack (G18): every living mob type the
  engine defines (`DATA.entities.attrs`'s own keys), its non-null base attributes, and
  `CanPickUpLoot` / `PersistenceRequired` / (for breedable mobs) `Age`.
- `tools/referee/mobdefaultscheck.mjs` — the check the suite runs: loads the engine's own
  `Entities.attrsOf`, loads the golden JSON, compares. Registered via `tools/stages.d/referee.json`.

## Running it

Golden data is GENERATED, never committed (D-6):

```
node tools/referee/run.mjs tools/referee/packs/mob-defaults.json
node tools/referee/mobdefaultscheck.mjs --verbose
```

`MCLITE_REFEREE_DIR` points both at a work directory (default `~/.mclite-referee/1.18.2`) —
the server's own world/logs land there, and golden JSON at `<dir>/golden/<pack>.json`. Point it
at wherever the golden was generated (e.g. a small directory copied over from another machine)
to run the check without a local server.

Without golden present, `mobdefaultscheck` prints `SKIP` and exits 0 rather than guessing.

## Adding a pack

1. Write `packs/<name>.json`: `{ "name", "version", "mobs": [{ "id", "attrs": [...], "nbt": [...] }] }`.
   `attrs` are vanilla attribute ids (`minecraft:generic.max_health`, ...); `nbt` are `/data get`
   paths relative to the entity root.
2. `node tools/referee/run.mjs tools/referee/packs/<name>.json`
3. Write `tools/referee/<name>check.mjs` following `mobdefaultscheck.mjs`'s shape: load golden,
   load the engine, compare, and include an anti-vacuity section that perturbs an engine value
   in memory and asserts the perturbation is caught (D-30/D-305).
4. Add `{ "id": "<name>check", "kind": "check", "file": "tools/referee/<name>check.mjs", "args": [] }`
   to `tools/stages.d/referee.json` (or a new `tools/stages.d/<name>.json`).

## Why mismatches are findings, not bugs in this check

The referee's fence is `tools/referee/**`, `tools/stages.d/referee.json`, `docs/REFEREE.md` —
never `src/`. A real engine-vs-vanilla difference makes `mobdefaultscheck` fail and stay failing;
that is correct. The mismatch belongs to whichever unit owns the affected `src/` file to fix.

## Known caveats

- `AbstractHorse` family (`horse`, `donkey`, `mule`, `llama`, `trader_llama`) has its
  `generic.max_health` RE-ROLLED per spawn by vanilla itself (`initAttributes`); one live RCON
  sample cannot be compared for equality, so `mobdefaultscheck` records it and skips it rather
  than asserting a coincidence.
- The engine has no `CanPickUpLoot` or `PersistenceRequired` field on any mob at all (checked
  across `src/*.js`); `mobdefaultscheck` asserts these anyway and they fail — that gap is itself
  the finding this pass exists to surface, not a bug in the check.
- Mobs summoned by `/summon ... {Tags:[...]}` are not naturally spawned; a small number of
  vanilla defaults that differ between the two spawn paths (chiefly persistence-related fields)
  are exactly the ones this pack currently cannot assert cleanly — see the caveat above.
- `server-npcs=false`/`spawn-npcs=false` in server.properties does not just stop natural village
  generation -- it actively discards every Villager and Wandering Trader server-wide, even ones
  just `/summon`-ed (observed empirically: a freshly summoned Villager vanished with no kill and
  no error logged, before the very next RCON command could read it). `server.mjs` sets it `true`.
- `difficulty=peaceful` does the same to every hostile `Monster`-class mob (vanilla discards them
  on its own tick check); `server.mjs` uses `easy` instead. No player ever joins this server, so
  nothing is actually at risk from a hostile mob existing unattacked.
- The live server's own answer for the horse family's rerolled `max_health` was a surprise: every
  sample (`horse`, `donkey`, `mule`, `llama`, `trader_llama`), summoned alone in a fresh world or
  alongside the other 73 mobs, came back as exactly 53 -- outside the 15-32ish range remembered
  from vanilla's documented `15 + random(0,8) + random(0,9)` formula, and identical across five
  different mob classes that should each roll independently. This is the real server's own
  answer, taken as-is (never guessed, per the referee's whole reason to exist) rather than
  overridden by memory of the formula; it is left as an open question for whoever picks up this
  pack's random-attribute handling next, not resolved here.

## The packs so far (infra I4/I6)

| Pack | Runner (the real server) | Check (the engine) | Golden |
|---|---|---|---|
| mob defaults (74 mobs: attributes, NBT) | `run.mjs packs/mob-defaults.json` | `mobdefaultscheck` | `mob-defaults.json` |
| mob loot (110 tables x 600 rolls, no-killer context) | `runloot.mjs` | `mobreflootcheck` | `mob-loot.json` |
| villager trades (13 professions x 5 levels x 150 fresh villagers) | `runtrades.mjs` (~7 min; `--only a,b --merge` to split) | `villagerreftradecheck` | `villager-trades.json` |
| mob spawn equipment (16 mobs x 600 `/summon`s, hard, day 64, full moon) | `runequip.mjs` (~5 min; `--only a,b --merge` to split) | `mobrefequipcheck` | `mob-equipment.json` |
| mob spawn attributes (14 mobs x 600 `/summon`s, same scenario) | `runattrs.mjs` (~4 min) | `mobrefattrcheck` | `mob-attributes.json` |
| enchanting (`EnchantmentHelper.enchant`: 14 trade tools + 8 mob-gear items x 3 levels, 1026 rolls each) | `runenchant.mjs` (~3.5 min) | `enchrefcheck` | `enchanting.json` |
| TNT (7 blast scenes x 100 one-TNT blasts, per-cell break rate + drops; 40 redstone-primed fuse stations x 120 ticks) | `runtnt.mjs` (~7 min; `--only A\|B`) | `tntrefcheck` | `tnt.json` |
| mob fall damage (23 mob x height x landing-block scenes, 3 reps, AI on) | `runfall.mjs` (~20 s) | `fallrefcheck` | `fall.json` |
| breeding + furnace-break XP (5 species x 100 pairs; 5 recipes x 4 counts x 100 breaks) | `runxp2.mjs` (~40 s) | `xp2refcheck` | `xp2.json` |
| mob chase speed (36 scenes: 20 chasers incl. 4 zombie-family babies + 16 vs-CREATIVE refusals, x 3 reps, per-tick Pos) | `runchase.mjs` (~60 s) | `chaserefcheck` | `chase.json` |
| hurt panic (10 animals punched bare-handed by a survival growbot x 3 reps; per-tick Pos+HurtTime from the hit) | `runhurt.mjs` (~6 min) | `hurtrefcheck` | `hurt.json` |
| sheep eat grass (6 scenarios: adult grass_block, adult grass-plant, baby grass_block + dirt control, no-grass control, mobGriefing=false; 4000-sheep engine flock per scenario x 9 checkpoints) | `runsheepgrass.mjs` (~90 s) | `sheepgrassrefcheck` | `sheep-grass.json` |
| burning-mob panic (12 animals x 4 reps, `{Fire:160s}`, open pen, per-tick Pos) | `runpanic.mjs` (~70 s) | `panicrefcheck` | `panic.json` |
| knockback (A: 8 attackers x none/netherite -> the bot's own Set Entity Velocity packet; B: bot hits zombie/kb-resistant zombie/ravager bare, iron sword, Knockback I/II -> tick-exact datapack Motion log, hit tick found from the data) | `runkb.mjs` | `kbrefcheck` | `knockback.json` |
| goat ram (6 scenes x 3: adult at 5/7/9 blocks, baby, screaming, vs a CREATIVE bot; NBT-form summon = ram-ready, long jump held off by a `long_jump_cooling_down` memory) | `runram.mjs` (~3.5 min) | `ramrefcheck` | `ram.json` |
| piglin bartering (a: `gameplay/piglin_bartering` x 3000; b: live piglin + a gold stack on the ground, 5 scenes x 3, per-tick ground gold + drops) | `runbarter.mjs` (~10 min) | `barterrefcheck` | `barter.json` |
| player hazards + falls (12 hazard lanes + 7 client-driven falls, one growbot player per lane, x 2) | `runphazard.mjs` (~65 s) | `phazardrefcheck` | `player-hazards.json` |
| player melee (22 one-blow scenes: 9 weapons, Sharpness/Smite/Bane, target armour, Strength/Weakness, crits, sweep, x 3) | `runpmelee.mjs` (~3.5 min) | `pmeleerefcheck` | `player-melee.json` |
| taming by right-click (7 scenes x 300 fresh wild mobs: wolf bone/rotten flesh, cat cod/salmon, parrot seeds/cookie) | `runtame.mjs` (~6.5 min) | `tamerefcheck` | `tame.json` |
| player attack cooldown (11 scenes: a 2nd blow after a hit / a hand swing at the air / a hotbar switch, same tick or 150-500 ms later; crit + sweep gates at low charge, x 3) | `runpcool.mjs` (~2 min) | `pcoolrefcheck` | `player-cooldown.json` |
| mob gear drop on a player kill (zombie wearing 6 pieces at drop chance 0.02/1.0/2.0, Curse of Vanishing, Feather Falling; 800 bot kills x Looting 0/III) | `rungeardrop.mjs` (~7 min) | `geardroprefcheck` | `gear-drop.json` |
| feeding + breeding (44 feed scenes: 17 species' breeding foods, wrong foods, breeding cooldown, 4 baby ages, axolotl's bucket; 5 mate scenes x 6 AI pens) | `runbreed.mjs --only <regex>` (~12 min total, run in 3 slices) | `breedrefcheck` | `breed.json` |
| mob right-click interactions (31 scenes: milking cow/goat/mooshroom incl. a 16-bucket stack, stew, shearing sheep/mooshroom/snow golem, dye, saddles, fish/axolotl bucketing) | `runinteract.mjs [--only <regex>]` (~8 min) | `interactrefcheck` | `interact.json` |
| player hunger/exhaustion (9 scenes: jump, sprint-jump, dry walk/sprint, swim, one melee blow, saturated regen, `add()` via `minecraft:saturation`) | `runhunger.mjs` (~30 s) | `hungerrefcheck` | `player-hunger.json` |
| player food + starvation (10 real eats via a real Use Item packet — bread, cooked beef, golden carrot, cookie, beetroot soup, honey bottle, raw chicken/rotten flesh x 15 reps, golden apple, spider eye — + 4 starvation-cadence scenes across easy/normal/hard) | `runfood.mjs` (~5 min) | `foodrefcheck` | `player-food.json` |
| buckets at a block (15 scenes x 3: pick up water/lava sources incl. a 16-stack, a flowing cell, a waterlogged slab, powder snow, creative; pour water/lava on stone and on a slab, creative, cod/axolotl buckets; a growbot looking straight down, one Use Item packet) | `runbucket.mjs [--only <regex>]` (~70 s) | `bucketrefcheck` | `bucket.json` |
| use on a block (19 scenes x 3: hoe/shovel/axe/honeycomb/flint and steel/shears/torch/slab/cobblestone/glass bottle on a block, looking straight down; Player Block Placement 0x2e or Use Item 0x2f) | `runbucket.mjs --pack useon` (~80 s) | `useonrefcheck` (= `bucketrefcheck.mjs --pack useon`) | `useon.json` |
| block use (18 scenes x 3: lever, button, trapdoors wood/iron, gate, note block, repeater, comparator, daylight detector, cake survival/creative, full composter, ripe berries, cauldron bucket/bottle, flower pot; + an engine-only container-open row set) | `runbucket.mjs --pack blockuse` (~70 s) | `blockuserefcheck` (= `bucketrefcheck.mjs --pack blockuse`) | `blockuse.json` |
| item use: spawn eggs + bone meal (12 scenes x 20: pig/zombie/cow eggs on stone, egg on a spawner survival/creative, egg via Use Item into water, bone meal on wheat age 0 (distribution)/mature/creative, on an oak sapling, on stone) | `runbucket.mjs --pack itemuse` (~5 min) | `itemuserefcheck` (= `bucketrefcheck.mjs --pack itemuse`) | `itemuse.json` |
| block placement state (63 scenes x 2 — 41 facing south + 22 of them facing east: stairs/logs/pillars/slabs/torches/buttons/lever/ladder/furnace/chest/piston/observer/dispenser/hopper/signs/door/bed/rail/pumpkin/anvil/trapdoors/gate/end rod/lantern/chain/grindstone/bell/vine on a side face or the floor, every property read back) | `runplace.mjs [--only <regex>]` (~2.5 min) | `placerefcheck` | `place.json` |
| mining — the left-click join (21 scenes x 3: break ticks for dirt/stone/ores/glass/log/cobweb/leaves/torch by hand, wooden/stone/iron/diamond pickaxe, axe, sword, shears; Efficiency I/V, Haste II, Mining Fatigue I; Silk Touch on glass + diamond ore; harvest refusals; tool wear; creative hand/pickaxe/sword) | `runmine.mjs` (~3 min) | `minerefcheck` | `mine.json` |
| idle wander — goal-selector start rate (6 mobs x 6 pens x 3 reps, 1200 ticks each, alone in a 13x13 stone pen, persistent, no player: cow, pig, chicken, sheep, iron golem + the villager as the Brain-driven control) | `runwander.mjs` (~3.5 min) | `wanderrefcheck` | `wander.json` |
| mob ranged (7 scenes x 3: skeleton easy/normal/hard, stray normal/hard, pillager normal/hard; bare summon 10 blocks down a walled lane from a still survival bot under Resistance IV, 400 ticks: volley cycle, mean hit damage, first volley, stray Slowness) | `runranged.mjs` (~3.5 min) | `rangedrefcheck` | `mob-ranged.json` |
| player potions (10 real drinks via a real Use Item packet x 3 reps — healing/harming at reduced/full health, regeneration, poison, strong poison (amplifier), long swiftness (duration), water bottle (no effect), night vision, creative keeps the potion, milk while poisoned) | `runpotion.mjs` (~2 min) | `potionrefcheck` | `player-potion.json` |
| hurt window (12 hit sequences of instant_damage 6/12 at tick-exact gaps 2..25 via a datapack `schedule` chain, on a growbot survival player AND a NoAI iron golem at once, x 3) | `runhurtwin.mjs` (~3 min) | `hurtwinrefcheck` | `hurt-window.json` |
| despawning (23 lanes: zombie/skeleton/pillager/cow/chicken/villager/bat at 20/48/140 blocks + zombie at block light 12/11, sealed dark tunnels, 3 rounds x 12 /summon'ed mobs, survivors at t 5/300/700/1000/1300/1600) | `rundespawn.mjs` (~4.5 min) | `despawnrefcheck` | `despawn.json` |
| raid wave composition (easy/normal/hard base wave x reps + Bad Omen II extra wave on normal — per-wave pillager/vindicator/ravager/witch/evoker counts, ravager passenger rule) | `runraid.mjs` (real bed+villager POI trigger; ~8.5 min per 2 scenarios, split with MCLITE_RAID_ONLY) | `raidrefcheck` | `raid-waves.json` (10 real raids, s149) |
| mob spawner (21 scenarios: zombie dark/lamp-lit/kept (6-nearby cap)/with 80 un-persistent zombies loaded (monster cap), cow on grass/one grass row/stone, 12 more types dark or lit, blaze dark+lit, slime at y=100; 3-12 rooms each, 6000 ticks, spawned mobs counted + voided every tick) | `runspawner.mjs` (~5.5 min per `--set 1\|2\|3`, `--merge`) | `spawnerrefcheck` | `spawner.json` |
| items + xp orbs (worker; item pairs at gaps 0.3/0.6/0.9/1.2 + 0.4 vertical, 40+40 / 10+10 pearls / different items / named vs plain, Age 5990/5900/-32768 despawn, a 10-block drop traced per tick, 5 same-tick orbs same/mixed value, orb Age despawn) | `runitems.mjs` | `itemrefcheck` | `items.json` |
| natural-spawn floors (36 floor blocks x 2 sealed dark 14x14 boxes, one per chunk at chebyshev 2..4, glass ground elsewhere, natural spawning on at night for 2000 ticks; spawned mobs counted + voided every tick) | `runfloor.mjs` (~2.5 min) | `floorrefcheck` | `floor.json` |
| mob ranged II (witch, blaze, trident drowned, evoker, illusioner, ghast (open arena, 16 out 2 up), snow golem vs a NoAI zombie — one each DIST 10 down a walled lane from a still survival bot, normal, night, 600 ticks x 3; a datapack tick function records every new projectile/spell entity's exact gametime + a thrown potion's id) | `runranged2.mjs` (~2 min) | `ranged2refcheck` | `mob-ranged2.json` |
| zombie reinforcements (one bare-hand / diamond-sword-sweep blow on a NoAI caller with spawn_reinforcements base 0/0.5/1 in a stone-roofed 85x85 dark arena; hard vs normal, doMobSpawning off, open noon sky, a husk caller; counts the callees, their TYPE (vanilla: always a plain zombie) and the caller's -0.05 charge) | `runreinf.mjs` (~6 min) | `reinfrefcheck` | `zombie-reinf.json` |

`runtrades.mjs` summons each villager straight at its level (`VillagerData`, NoAI) and reads
`Offers.Recipes` through `/data ... from entity`, which runs the lazy `fillRecipes` — one independent
2-of-N draw of that level's pool per villager. `snbt.mjs` parses the replies (nested tags: enchantments,
potions, stew effects, dye colours). The check drives the engine through the joins a player hits:
`Trade.rollLevel` → `Trade.previewFor` (what the screen shows and `attempt` charges) → the stack
`Trade.attempt` actually pays out. Rates use an exact binomial test against the engine's 4000-villager
rate (P < 1e-5 fails); counts are exact when both sides are constant. World facts as the golden's:
plains villager type, no structures (map offers dropped on both sides).

Golden lives in `<referee dir>/golden/` or, in a cloud container, `../mclite-store/golden/` (the store
carries every pack's golden; regenerate with the runner when the jar or the pack changes).

`runequip.mjs` summons with NO NBT argument — the only `/summon` form that runs `MobEntity.initialize`
(SpawnReason.COMMAND): gear, enchantments, left-handedness, babies, raid-captain banners. The golden records
`World.getLocalDifficulty`'s inputs; `mobrefequipcheck` recomputes vanilla's clamped local difficulty from them
(LocalDifficulty.java float math), asserts the engine's own `Equip.clampedLocalDifficulty()` against it (§1), then
feeds vanilla's value to the engine so the rest of the roll is compared on equal inputs (§2).

`runattrs.mjs` reads a fresh mob's EFFECTIVE attributes with `execute store result storage ... run attribute
<mob> <attr> get 1000000` (base + every modifier, clamped — no modifier arithmetic in the harness): follow_range,
knockback_resistance, max_health, Health, and for the zombie family zombie.spawn_reinforcements + CanBreakDoors.
`mobrefattrcheck` compares DISTRIBUTIONS (two-sample Kolmogorov-Smirnov, P < 1e-5) and the door rate (binomial),
feeding the engine vanilla's clamped local difficulty exactly as `mobrefequipcheck` §2 does.

`runenchant.mjs` runs `EnchantmentHelper.enchant` through the loot function `enchant_with_levels` (a datapack loot
table per case, 27 rolls into a chest per read). `trade:<item>` draws its level uniform 5..19 (= the villager's
`5 + nextInt(15)`) and is compared to `Trade.resolveOffers` on a `sell_enchanted_tool_for_emeralds` row;
`mob:<item>:<level>` fixes the level and is compared to `Equip.rollEnchants` (the mob-gear roll). Per case:
every enchantment's rate, the enchantment-count distribution, and level means (pooled variance, 5 sigma).
The horse family is in `runattrs.mjs` too (max_health, movement_speed, horse.jump_strength after
`AbstractHorseEntity.initAttributes`). It settles the "every horse is 53" puzzle above: 53 is the builder's
default max_health, which a `/summon` WITH NBT never re-rolls (no `initialize`). With no NBT the max is rolled
(15..30, matches the engine) — but `Health` stays 53: the LivingEntity constructor filled it at the old max and
nothing clamps it (still 53.0 after 100 ticks, max 21; read on the real server 24 Sept). `mobrefattrcheck`
reports that as a red Health line for horse/donkey/mule/llama.

`runblocks.mjs` breaks blocks on the real server with `/loot replace block <chest> ... mine <pos> [tool]`
(Block.getDroppedStacks: ORIGIN, TOOL, BLOCK_STATE, BLOCK_ENTITY — no entity, no explosion). Cases come from the
jar: every `blocks/*` table that can vary (bonus, chance, match_tool, uniform/binomial counts, state conditions) x
the default state + each state its own `block_state_property` rows name x the tools it can tell apart (hand;
fortune I/III; shears, plain and silk-touch diamond pickaxe) — ~1000 cases, 160 rolls each; every FIXED table
too, one 40-roll batch with a bare hand and one with a pickaxe (~1160 more, 2171 in all), `--jobs 2` servers,
`--slice s/4` per call (each slice ~2 min; slices merge into one golden). `blockrefdropcheck` compares
`Loot.drops` (the table, not `breakDrops`' correct-tool rule) per case: rates + means, 5 sigma, POOLED variance
(a rare drop seen 0/160 times on one side is not a red by itself). Reds seen 24 Sept: snow's and
chorus_flower's `entity_properties {}` with no entity (vanilla false — EntityPredicate.fromJson builds a non-ANY predicate), and
sweet_berry_bush (pool-level `functions` never applied by the engine).

`runfire.mjs` rolls `/loot ... kill <mob>` (LootCommand.executeKill: THIS_ENTITY = the mob, DAMAGE_SOURCE, ORIGIN, no
killer from RCON) on a NoAI, Invulnerable mob summoned cold and with `Fire:32000s`, for every entity table with an
`is_on_fire` row (16 in the jar; sheep as Color:0b -> `sheep/white`). `mobreffirecheck` compares
`Loot.rollTable('entities/<table>', {type, isOnFire})`. 24 Sept: all 32 cases match (the cooked-drop rule is right
in the interpreter; whether every death path PASSES `isOnFire` is `mobslootcheck`'s question).

`runredstone.mjs` is the first TIMING pack: `redstonescen.mjs` holds 30 little circuits (repeaters 1-4 held and
pulsed, a repeater chain, comparators, torch inverters, lamps, observers, normal/sticky pistons held and 1-tick
pulsed, a piston pushing a redstone block to a lamp, iron door/trapdoor, fence gate, note block, dropper, powered
rail). The server builds them with `/setblock`, then a `#minecraft:tick` datapack function (functions run before
the worlds tick, where a player's action lands) toggles each circuit's trigger cell air <-> redstone_block and
appends every probe's `execute if block` to storage, 40 ticks — tick-exact, no clock read over RCON.
`redrefcheck` runs the same clock in the engine (toggle via set + `Behave.changed`, sample, `Behave.tick` +
`BlockEntities.tick`) and wants every 40-tick timeline EXACTLY equal; every golden probe must change at least once.
24 Sept: repeaters, pulse extension, comparators, torches, observer, dropper all match; reds: the lamp's 4-tick
turn-off, pistons one tick early (no block-event queue), a piston powered by a redstone block in FRONT of it
(`Rs.signalAt` counts weak power into a solid cell), an observer not seeing an observer, and doors/trapdoors/
gates/note blocks/powered rails not reacting to redstone at all.

`runfurnace.mjs` (same tick-function clock, `furnacescen.mjs`) places a furnace / blast furnace / smoker at tick 1
with its slots filled by NBT (plus `CookTimeTotal`, which a player's `setStack` sets and a bare `/setblock` NBT
would load as 0) and logs BurnTime, CookTime, the three slot counts, `lit` and "fuel slot holds a bucket" every
tick for up to 440 ticks: coal, a stick running out mid-cook (cook cools by 2), two sticks back to back, lava ->
bucket, a full / different output slot, food refused by a blast furnace. `furnacerefcheck` drives
`BlockEntities.tick` and wants every series equal. 24 Sept: every furnace series matches to the tick; reds: the
blast furnace and smoker burn fuel for the FULL time (coal 1600) where vanilla halves it
(Blast/SmokerBlockEntity.getFuelTime = super / 2 -> coal 800).

`runhopper.mjs` (same clock, `hopperscen.mjs`) places chest/hopper/furnace lines at tick 1 (NBT-filled, in list
order = block-entity tick order) and logs the watched slot counts every tick: chest -> hopper -> chest, a two-hopper
chain placed in both orders, two item kinds, a redstone-locked hopper, chest -> hopper -> furnace -> hopper -> chest,
a side hopper feeding fuel. `hopperrefcheck` drives `BlockEntities.tick` (with `NS.World.getBlock` over the same
cells — `BE.hopperFacing` reads the facing there). 24 Sept reds: (1) the engine moves every 9 ticks, vanilla 8
(`serverTick` decrements THEN acts the same tick; `tickHopper` returns on the decrement); (2) a hopper receiving
into an EMPTY hopper does not give it the 8 (or 7) tick cooldown (HopperBlockEntity.java:268-274), so a chain
passes items straight through; (3) a hopper under a furnace pulls COAL out of the fuel slot — `canExtract` allows
slot 1 downward only for a bucket / water bucket (AbstractFurnaceBlockEntity.java:369-371).

`rundispense.mjs` (same clock as the redstone pack, `dispensescen.mjs`, 60 ticks) pulses droppers and dispensers
from a redstone-block trigger and logs slot counts and block bits every tick: dropper -> chest, a dropper chain,
dropper -> hopper -> chest, a 2-tick clock, a dropper feeding a furnace from below (fuel slot) and from the side (a
non-fuel item stays), a QUASI-CONNECTED dropper (powered only diagonally; fires 4 ticks after a later neighbour
update), a dispenser at a chest (throws, never inserts), arrows on a clock, a water bucket. `dispenserefcheck`
drives `Behave.tick` + `BlockEntities.tick` with `EntityList` live (a throw needs it). 24 Sept reds: (1) a dropper
into an empty hopper does not start the hopper's 8-tick cooldown, so the item reaches the chest at once (same root as
hopper finding 2); (2) the engine fires a quasi-powered dropper at once — `Rs.updateDispensers` re-polls a 5x5x5 box
around any change, while vanilla `DispenserBlock.neighborUpdate` (:97-105) only runs on a DIRECT neighbour update
(no BUD behaviour); (3) no dispenser behaviours: a water bucket is thrown as an item instead of placing water
(already named in `BE` OWED, 07c_blockentity.js:685).

`runfluid.mjs` (`fluidscen.mjs`, up to 200 ticks) places water/lava by setblock at tick 1 and logs each probed cell's
`level` every tick (-1 = not that fluid) plus obsidian/cobblestone bits: a 1-wide channel, an open floor with
diagonals, a source removed at tick 30, a 3-high ledge, a hole 3 blocks away (getSpread), two sources making a third,
a lava channel, lava meeting water, water poured on a lava source. `fluidrefcheck` drives `Behave.tick`. 24 Sept reds:
(1) a removed source's flow FREEZES in the engine — the recession runs ~10 ticks then stops, leaving flowing water
(levels 4/3/2/3/4...) standing forever, where vanilla drains the channel by tick ~64; (2) the cell between two
sources is first flowing (level 1) and only 5 ticks later a source — vanilla's spread computes the target's
`getUpdatedState` (FlowableFluid.java:349, :171 `isInfinite() && sources >= 2`), so it is a source at once; (3) a
lava SOURCE with flowing water arriving beside it stays lava — vanilla `FluidBlock.neighborUpdate` ->
`receiveNeighborFluids` (FluidBlock.java:122-128) turns it to obsidian that tick (water from ABOVE already matches).

`runmotion.mjs` (`motionscen.mjs`, 60 ticks) summons ONE no-will entity per scene at tick 1 (item dropped / thrown /
into a wall, sand and gravel falling blocks, TNT dropped and pushed, an arrow lobbed and dropped, an XP orb, an armor
stand dropped and thrown) and logs Pos/Motion x 10000 (`data get entity ... 10000`), `alive`, and the landed block.
`motionrefcheck` spawns the same entity through `EntityList.spawn` in a real `World` and compares within 2e-4 block
while both are alive; `alive`/landed exactly. 24 Sept reds: (1) ARROWS apply gravity before the move — vanilla moves,
then drags (0.99), then subtracts 0.05F (PersistentProjectileEntity.java:237-251), so every arrow flies lower than
vanilla from tick 1; (2) a FALLING BLOCK never lands — it sits on the floor as an entity for ever and never becomes
sand/gravel (and no `spawn('falling_block')` exists in src: gravity blocks do not fall at all); (3) a grounded TNT
keeps sliding — vanilla multiplies (0.7, -0.5, 0.7) on the ground (TntEntity.java:61); (4) a grounded, slow ITEM moves
every tick — vanilla only when `(age + id) % 4 == 0` (ItemEntity.java:116; after a fix the check must align the phase
to the engine's id); (5) `armor_stand` cannot be spawned (no motion pair in entities.json).

`runplate.mjs` (`platescen.mjs`, 80 ticks) summons items / an armor stand onto oak, stone and weighted plates and
kills them at set ticks; logs the plate's `powered`/`power`. Vanilla: pressed the tick after the entity arrives, held
for the 20-tick recheck (simple) or 10-tick (weighted) after it leaves, weighted power = entity count (light) /
ceil(count/10) (heavy), a stone plate ignores items. 24 Sept: the engine's plates sense NO entity at all (no
`PressurePlateBlock.onEntityCollision` path anywhere in src) — every moving series is red; the golden is the
spec a fix must meet.

`runbutton.mjs` (`buttonscen.mjs`, 80 ticks) covers 8 button/arrow-press scenarios (stone, wooden and polished
blackstone buttons pressed and held, a floor-mounted button, a re-press mid-hold, a wooden button with an arrow
lodged in it, a stone button an arrow can't budge, an arrow landing on a wooden plate) and logs each button's/
plate's `powered` AND a redstone lamp one hop downstream. Two honest limitations, both named in the scenario file
(D-Button-1/2): no server command reaches `AbstractButtonBlock.onUse` (only a real player click does), so a
`press` scenario fakes it with `setblock ...[powered=true]`, gated on the block's own current state so a re-press
mid-hold is a genuine no-op, not tracked; and a `summon`ed/dispensed `PersistentProjectileEntity` never calls
`Entity.move()` (`.decomp`: every position update is `this.setPosition`, never `this.move`), so it never reaches
`Entity.checkBlockCollision()` and never trips `AbstractButtonBlock.onEntityCollision` in this rig either — verified
live against the real server, an arrow shot at an oak button never powers it in 80 ticks, though real play does
this routinely by some path this rig couldn't reproduce. `wooden_button_arrow_stuck` works around it: press faked,
then AbstractButtonBlock.scheduledTick's wooden branch (`tryPowerWithProjectiles`'s "is a projectile still here?"
recheck) is re-derived ourselves at press+30 and press+60, each time querying the real, genuinely flying-then-
landed arrow's actual presence rather than a tracked flag. 24 Sept: (1) `Use.buttonTick` (14l_use.js:1439) always
unpowers on the scheduled tick regardless of material or a still-present projectile — vanilla's stone branch is
unconditional but the wooden branch rechecks (`AbstractButtonBlock.java` `scheduledTick`/`tryPowerWithProjectiles`,
:145-180) and holds; `wooden_button_arrow_stuck` releases at tick ~37 in the engine against tick 65 on the server.
(2) wooden pressure plates still don't sense the arrow at all (same `PressurePlateBlock.onEntityCollision` gap as
above — `oak_plate_arrow` is red from tick 7). (3) `Rs.updateConsumers` (07f_redstone.js:1069-1086) relights AND
un-lights a redstone lamp in the same tick the signal changes — vanilla's `RedstoneLampBlock.neighborUpdate`/
`scheduledTick` (`RedstoneLampBlock.java`:27-45) schedules the UN-lighting 4 ticks later, so every `.lamp` probe
in a press scenario goes dark 4 ticks early in the engine. The plain press/release timing itself (stone 20 ticks,
wooden 30, the floor mount, the re-press no-op) matches the server exactly — only the lamp delay and the two
arrow paths are red.

`runcmp.mjs` (`cmpscen.mjs`) reads 24 static scenes through a comparator into a wire: chests at 0/1/64 items, 2/14/27
stacks, 16-stack pearls and 1-stack swords, a hopper, a dispenser, a furnace's fuel, a half barrel, cauldrons,
composters, cakes, an end portal frame with an eye, an empty jukebox. `cmprefcheck` compares the settled wire power.
24 Sept: ALL 24 MATCH (the engine's `Rs.analogOutput` is vanilla's) — a green pack, kept as the regression guard.

`rundaylight.mjs` (RCON only, no datapack) sets 57 times of day (0..24000 by 500 + dusk/dawn points) with the
daylight cycle off and clear weather, and reads a normal and an inverted daylight detector's `power`.
`daylightrefcheck` compares `Redstone.daylightSignal(15, inverted, t, 0, 0)`. 24 Sept: ALL MATCH (green guard).
Harness note: `Sky.ready` is only set by the renderer's `Sky.init`; without it `Rs.skyDarken`/`daylightSignal` fall
back to angle 0 (noon) — the check sets the flag. In the game it is set, so not a game bug, but a join worth knowing.
`rungrowth.mjs` (`growth-timing`, 24 Sept) is the first DISTRIBUTION pack, not a tick-exact one: growth is random
(`gamerule randomTickSpeed`, then each block's own chance roll), so it plants 8 scenarios — wheat isolated on
moist vs dry farmland, wheat dense (the same-crop row penalty), carrots/potatoes isolated moist, beetroot
(the extra 1-in-3 gate), an oak sapling, nether wart — 64 cells each (wheat's dense one 252) across 8 CONTIGUOUS
chunks (x 0-143) and samples an age/stage histogram at 6 checkpoints up to 2400 ticks, both sides driven by the
SAME `speed` through `Behave.randomTickSection` (D-331). ⚠ Getting real growth at all took two fixes neither
suite this size had needed before: (1) `fill <box> <block> replace <block>[<state>]` always reports "No blocks
were filled" for a query that MATCHES what is already there (`Level.setBlock`'s own no-op-write behaviour), so
every histogram bucket is read through a one-tick `minecraft:glass` marker swap instead; (2) `/forceload` alone
never enables RANDOM ticks — confirmed by reading `ThreadedAnvilChunkStorage.shouldTick`
(.decomp/net/minecraft/server/world/ThreadedAnvilChunkStorage.java:917-923), which requires an actual PLAYER
watching the chunk — so `tools/referee/growbot.mjs` is a from-scratch ~150-line offline-mode play-state client
(handshake, login, the compression switch, Keep Alive; every other packet is skipped by its own length prefix)
that parks one bot per scenario. That same investigation found the watched window does not reliably follow
`/tp` past about 8-9 chunks from spawn (unexplained; every scenario now fits inside the verified-working span
instead — see growthscen.mjs's own note). `growthrefcheck` compares mean age / mature fraction (or, for a
column plant, height fraction) per checkpoint against a tolerance from each side's own sample variance (5
sigma — a first-passage process, not a simple proportion, needs more room than the usual 4; the first
checkpoint of a many-step crop gets more still, see the check's own SIGMA comment) and requires the server's
own series to have moved. 24 Sept: wheat (moist/dry/dense), carrots, potatoes and nether wart all match: reds —
beetroot matures measurably faster than the server (BeetrootsBlock.randomTick's `random.nextInt(3) != 0` gate,
.decomp/net/minecraft/block/BeetrootsBlock.java:42-46, has no counterpart in `tickCrop`, src/07b_behaviour.js:
1087-1097, which treats every crop identically); and an oak sapling that reaches stage 1 never becomes a tree —
`tickSapling` (src/07b_behaviour.js:1234-1241) only increments `B.grownSaplings` where vanilla's
`SaplingBlock.generate` (.decomp/net/minecraft/block/SaplingBlock.java:38-44) calls the SHARED tree-feature
generator, which is out of this headless check's reach (never asserted, only reported: the server grew ~380
`oak_log` blocks by the last checkpoint). A sugar-cane column-height scenario was DROPPED from this pack: its
own golden came back self-contradictory (more columns reported at height >=3 than at height >=2, which cannot
happen) and the cause was not found in the time this pass had — `kind: 'column'`'s probe and compare code
stays in growthscen.mjs/growthrefcheck.mjs for whoever picks it back up, but nothing in the suite exercises it.

**Mob XP (`runxp.mjs` / `xprefcheck.mjs`, 50 variants, golden `mob-xp.json`).** XP drops only for a PLAYER kill
(LivingEntity.dropXp), and a projectile's attacker is its owner only while that owner is in the world, so a growbot client
(`xpbot`) joins and parks 200 blocks away (orbs chase a player within 8 blocks), and each NoAI mob, summoned WITH NBT (no
`initialize`, so its gear is exactly the NBT's), is killed by an arrow owned by xpbot's offline UUID. Each mob stands in its
own 4x4 glass well on a 5-block pitch — in an open grid the orbs' spawn velocity carried them between cells (a zombie read
1..11) — and a datapack function sums Value x Count over the well's orbs into storage, one RCON read per variant (single
RCON commands cost ~23 s per variant). A second, low arrow volley catches the 0.7-high mobs the first one flies past. The
engine side kills 400 of each through `Cb.dropLoot` (loot, equipment, then xp — LivingEntity.drop's order: a dropped item
no longer adds its bonus, which the server confirms, ~8.5% of equipped kills get none). Constant golden → exact; spread →
same support + mean within 4 se. A variant the engine cannot spawn is named, not asserted. 3 breaks. ~3 min.

`runtnt.mjs` (`tntscen.mjs`) is two parts. A: a scene (a solid 13^3 cube of dirt/stone/oak planks/end stone/glass with one
air cell, the same stone cube with a WATER source in that cell, or a dirt slab under open air) is rebuilt with `/fill`, ONE
`tnt {Fuse:1s,NoGravity:1b}` is summoned in the cell and, 5 ticks later, a datapack function reads the 11^3 box around it
(air or not) and sums the dropped items. `tntrefcheck` spawns the engine's `tnt` entity and runs one `EL.tick` (-> Tnt.tick ->
Explosion.explode) in a cell map, 300 trials, and compares every cell's break RATE (pooled 5 sigma), the destroyed count and
the dropped-item mean. B: the redstone clock -- 40 stations, a redstone block beside a TNT at tick 1, a second TNT 3 cells
away; the first blast tick, the chained fuse delay (random(20)+10) and the lit TNT's y per tick. 25 Sept: the blast SHAPE matches
in all 7 scenes (water: nothing breaks, both sides) and the whole fuse timeline matches; the red is the DROPS -- TntEntity.explode
uses DestructionType.BREAK (.decomp entity/TntEntity.java:81; enum order NONE, BREAK, DESTROY), and Explosion.affectWorld only
sets EXPLOSION_RADIUS for DESTROY (Explosion.java:282-283), so a TNT-broken block ALWAYS drops (server: dirt 224.7 items for
225.7 cells); the engine's Tnt.explode passes griefing=true -> Loot `explosionRadius` 4 -> survives_explosion keeps 1 in 4.
Creeper (DESTROY under mobGriefing) is right to keep the 1-in-4.
**Breeding + furnace-break XP (`runxp2.mjs` / `xp2refcheck.mjs`, golden `xp2.json`).** Two scenarios, neither needing a
player nearby (unlike mob-kill xp): (A) `AnimalEntity.breed` (.decomp, 214-238) rolls `nextInt(7) + 1` and spawns one orb
regardless of who is watching, so cow/sheep/pig/chicken/rabbit are put straight into love mode two-to-a-well (100 wells,
1 block apart so vanilla's own `MateGoal` pathfinding — not a teleport — closes the gap) and read the same
`Value x Count`-per-cell way as mob-xp; the engine side drives `Breed.breed(a, b, ctx)` itself (the exact function
`Br.tickLove`'s own caller uses), which matched vanilla's support and mean for all five species with no fix needed. (B)
furnace xp-on-break (`AbstractFurnaceBlock.onStateReplaced` -> `getRecipesUsedAndDropExperience`, .decomp
`AbstractFurnaceBlockEntity.java:468-489`: `floor(count*xp)` plus one more with probability `frac(count*xp)`) is set via
`RecipesUsed` NBT and broken with `/setblock air` for 5 real recipes (iron/gold ore, cobblestone, kelp, sand) x 4 counts x
100 reps each. The engine has **no break-drop path at all** — `BlockEntities.onChanged` (src/07c_blockentity.js:193) just
deletes the block-entity and its `recipesUsed` ledger with it; the engine's only furnace-xp payout,
`Menu.furnaceAwardXp` (14g_menu.js:875-890), fires solely from the GUI result slot's `onTake` — so `xp2refcheck` drives
`BlockEntities.create`/`.remove` directly (the literal call `onChanged` makes on removal) and reports the gap as 20 red
lines plus one named FINDING; that redness is expected, not a bug in the check. 4 breaks. ~40 s.

`runfall.mjs` (`fallscen.mjs`) drops ONE mob per glass shaft (AI on: a NoAI mob never travels, so never falls --
MobEntity.canMoveVoluntarily) h blocks onto a 3x3 pad (stone, hay, honey, slime, water), reads Health before and 80 ticks
after; constant over 3 reps (pig 4/5/8 -> 1/2/5, cow 12 -> 8, hay/honey 2, slime/water 0, zombie 23 -> 19, feather falling IV
-> 5, full diamond armour still 8 (fall bypasses armour), chicken/cat/iron golem 0, goat 12 -> 0 and 23 -> 9, horse 12 -> 3).
`fallrefcheck` runs the engine mob through T x `EL.tick` in the same shaft. 25 Sept: 17 of 23 red -- the engine's mobs take
NO fall damage: `EL.spawn` builds every entity with `living: false` (07i_entitylist.js:381), so `Ph.move` never calls
`Ph.landed` for a mob (14b_physics.js:365), and only the player ever spends `pendingFallDamage` (14_player.js:525).
The six greens are the scenes where vanilla also deals 0.

`runconv.mjs` (`convscen.mjs`) -- MOB CONVERSIONS. One mob per 1x1 glass cell (air / water 4 or 1 deep / powder snow), AI on,
difficulty normal, 1000 ticks; a datapack TICK function stores the first tick the converted type stands in each cell (exact,
no RCON timing) and the nausea it carries on that tick; baby/health/held/worn read after. 2 reps, constant: piglin, baby
piglin, brute -> zombified piglin after 301 ticks (TimeInOverworld 250 -> 51), hoglin/baby -> zoglin 301, nausea 200 on
arrival, gear kept, health NOT carried (zombified 20, zoglin 40); IsImmuneToZombification never; zombie/baby/husk submerged
903 (a summoned InWaterTime is wiped: the first tick reads `isSubmergedIn` before `baseTick` has set it, so inWaterTime
-> -1), 1-deep water never; skeleton in powder snow -> stray 443. `convrefcheck` loads the engine the way the game does
(every 07*.js, so mobs get `e.ai`) and runs T x `EL.tick`. 25 Sept: 17 red -- piglins/brutes/hoglins NEVER convert in the
engine (their `Piglin.tickEntity`/`Hoglin.tickEntity` dispatch sits in `EL.tickOne` AFTER `if (e.ai) return EL.tickMob(e)`,
07i_entitylist.js ~:1683 vs :1786-1788, and both are rostered); zombie/husk convert at 901 not 903 and carry health (10 ->
10, vanilla 20); a baby zombie's drowned re-rolls gear (fishing rod); skeleton -> stray missing. 3 breaks. ~1 s + ~2 min server.

`runtnt.mjs --creeper` -- the CREEPER blast (part A only, golden creeper-blast.json): the same 7 scenes x 100, the blast
from a creeper summoned {Fuse:0s,ignited:1b,NoAI:1b} in the centre cell (explode(): createExplosion at its feet, power 3,
DESTROY). `creeperrefcheck` spawns the engine's creeper there (ignited, fuseTime 0) and runs one `EL.tick` with every 07*.js
loaded (Creeper.tick lives in EL.tickMob, reached only with `e.ai`). 25 Sept: ALL 7 GREEN -- per-cell break rates, destroyed
cells and the 1-in-3 drops match (dirt 111.6 cells / 37.1 items), so tntrefcheck's red is TNT-only (BREAK vs DESTROY), as
named. 2 breaks (power 3 -> 2.6, a golden cell flipped). ~11 s; server ~7 min.
**Mob melee (`runmelee.mjs` / `meleerefcheck.mjs`, 34 cases, golden `mob-melee.json`, infra W, 25 Sept
2026).** How much damage a mob's melee hit does to a PLAYER: 8 mobs (zombie, zombie+iron_sword, husk,
vindicator, piglin_brute, spider, cave_spider, wither_skeleton) x 4 of the PLAYER's own armour tiers
(none, full iron, full diamond, diamond+Protection IV) at normal difficulty, plus cave_spider re-run at
easy/hard for its Poison duration -- 34 scenarios, REPS=3, ~80 s server time. `growbot.mjs`'s offline
fake client is a real SURVIVAL player here (gamemode survival, one bot per mob lane, `/tp` back to its
lane origin every rep -- a mob's own strike knocks the DEFENDER back, `MobEntity.tryAttack`, .decomp
:1324-1332, and an un-reset drift compounds rep over rep until the fresh attacker can no longer reach
it in time); armour is `/item replace entity <bot> armor.*`; a fresh attacker (AI on, tagged per-lane)
is summoned 1 block away, and the runner polls Health every 3 ticks and KILLS that lane's attacker the
instant it detects the first drop, so only the FIRST hit is measured -- reading before/after the whole
window once (an earlier version of this runner) let a second swing land inside it and doubled some
numbers, and NOT killing the attacker on detection let it go on hitting an already-recorded bot until
it died outright, which (this offline client can never send a respawn packet) silently zeroed every
scenario after the first for the rest of the run. `naturalRegeneration` is off and the world is
midnight (`time set 18000`, not noon -- daylight briefly made the zombie/husk lanes flee to shade
instead of attacking) so a hit is never confounded by regen or sun-avoidance AI. `meleerefcheck` spawns
the same mob (`EL.spawn`, which already runs `EL.DEFAULTS[type]`), equips the PLAYER's real inventory
armour slots (`Sv.updateArmor`), and calls `Cb.mobAttack(mob, M.Player)` once -- the engine's own
mob-hits-player entry point (src/14j_combat.js:819), never a re-derived formula (D-331). 25 Sept: 19/34
green; the 15 red are real, three of them load-bearing: (1) **`zombie_sword` (iron_sword in hand):
server loses 8, engine 3** -- `Cb.mobAttack` (14j_combat.js:830) reads only `e.attackDamage`/the type's
base attribute, with NO equivalent of `Player.attack`'s own `H.attackDamageFor(held)` for a MOB's held
weapon; vindicator/piglin_brute's own guaranteed axes are not exercised as their own scenario but are
the same gap. (2) ~~`wither_skeleton`: server 2, engine 4~~ -- WITHDRAWN by the orchestrator (25 Sept): a HARNESS artefact, not a
finding. runmelee summons with NBT, and SummonCommand runs `MobEntity.initialize` only for an NBT-less summon
(.decomp SummonCommand.java:90); `WitherSkeletonEntity.initialize` (:80-82) is what sets generic.attack_damage
(`field_23721`) to 4.0, so every natural/spawn-egg wither skeleton hits for 4 and the engine's `EL.WITHER_SKELETON_ATTACK`
is RIGHT (mob-defaults' no-NBT sample already says 4). meleerefcheck skips wither_skeleton until runmelee summons it bare. (3) **Protection IV on the DEFENDER never reduces a mob's hit**:
every `diamond_prot4` engine number is IDENTICAL to its `diamond` twin (e.g. spider: engine 0.44 both
tiers, server 0.44 -> 0.16) -- `Sv.updateArmor` (14d_survival.js:127-164) sums only `IT.defenseOf`/
`toughnessOf` off the ARMOR slots, and nothing in `Sv.hurt`/`Cb.mobAttack` ever calls
`Cb.enchantLevel`/`NS.Equip.protectionReduce` for the PLAYER side of a hit (that helper,
14j_combat.js:416-417, only fires for a MOB's OWN worn armour -- the opposite direction). The three
anti-vacuity breaks (a golden damage shifted a full point, the golden's own Protection IV numbers
silently swapped for the plain-diamond ones, the engine's own health forced down an extra point) are
each asserted caught. **Scope cut, named rather than guessed (`meleescen.mjs`'s own header):**
hoglin/zoglin/slime/magma_cube (random/size-scaled damage, needing more cross-checking of the engine's
own size <-> NBT `Size` convention than this pass had time for) and enderman (will not anger without a
real player action this headless bot cannot perform) are not in this pack.

**Movement packs (infra I6, 25 Sept 2026 — QUEUE 0.0's "speed in blocks/s").** Both runners log the mob's `Pos` from a
datapack tick function into storage (`data modify storage ... append from entity`), so entry i is the position after i
world ticks — no RCON timing in the numbers. `@e` matches LIVING entities only, so a log ends at death, not at removal.
`chaserefcheck` compares the CRUISE speed (blocks/tick between the ticks the mob has covered 1 and 6 blocks; the median
of 3 reps — target acquisition is random, cruising is exact to 4 digits) within 1%. It measured, 25 Sept, that every
walking mob in the engine is **+2.04 % fast** (= 1/0.98: `LivingEntity.tickMovement` damps `forwardSpeed`/`sidewaysSpeed`
by 0.98F every tick, .decomp LivingEntity.java:2550-2551, and `Ph.travelMob` never does — the player's `INPUT_SCALE` does);
a baby zombie gets no `BABY_SPEED_BONUS` (+50 % MULTIPLY_BASE, ZombieEntity.java:70-71, 179-181); a ravager lacks
`tickMovement`'s lerp of its base speed toward 0.35 while it has a target (RavagerEntity.java:154-156). The brute's 5.27
blocks/s IS vanilla. `panicrefcheck` burns each animal for 160 ticks (vanilla's `EscapeDangerGoal.isInDanger` is
`getAttacker() != null || shouldEscapePowderSnow() || isOnFire()`, .decomp EscapeDangerGoal.java:47-48 — so a burning
animal panics with no attacker) and compares how much of the time it moves, its panic speed (90th percentile per-tick
speed, 3%) and its death tick (fire damage timing — all green).

**Chase widening (s137).** Added the zombie family's other babies (husk/drowned/zombie villager — `BABY_SPEED_BONUS` is
ZombieEntity's, so all inherit it: server 5.13 b/s, engine 2.33) and a vs-CREATIVE lane for EVERY chaser. "Closes in" is now
PURSUES (>= 30 ticks within 2.5 blocks; the server's majority of 3 reps): a creative-ignoring wanderer brushes ~2 blocks by
chance (the server's vindicator did once). Harness facts: /summon WITH an NBT argument skips `MobEntity.initialize`
(SummonCommand.java:89-90 — `initialize` only when no NBT is given), so every server lane is an unarmed, never-randomly-baby
adult; the engine's `EL.spawn` DOES roll initialize (a piglin gets a crossbow/sword, 20 % baby). The server's piglin cruise
varies 2.8-5.1 b/s over reps (its brain approaches at a lower walk speed until its sensor picks the player) — treat the piglin
speed red as unconfirmed. Forceload is added in slices of 20 lanes (the command refuses > 256 chunks).

**Knockback pack (infra worker, 25 Sept 2026 — D-685's proof).** `growbot.mjs` now also parses Join Game (its own entity
id), captures Set Entity Velocity (0x4F) for itself, tracks Spawn Living Entity ids and can send Interact Entity attacks
(0x0D type 1); existing callers are unchanged. A (mob hits the bot) compares the packet the server sends — exact.

B (the bot hits a mob) is now TICK-EXACT too (infra worker, 25 Sept 2026): `runkb.mjs` loads a small datapack
(`mclitekb`, copied from the sibling chase pack's own tick-function pattern) that appends the target's `Motion` to
`mclite:kb` storage EVERY TICK, armed (storage cleared, tick counter zeroed) in one RCON round trip immediately before
`bot.attack()` fires — which logged tick is "the tick of the hit" is not assumed from a `sleep()`, it is found from the
data itself (`kbrefcheck.mjs`'s `findHitTick`: the one tick within the settle window whose horizontal |Motion| jumps by
a wide margin over the previous tick, well above the target's own AI-wander baseline). That sample is compared RAW-TO-RAW
against the engine's `Cb.attack`/`Cb.knockback` result — no decay correction, because the datapack's log write for that
tick is BEFORE that same tick's own `LivingEntity.travel()` drag has run (confirmed empirically: the jump-tick average
lands within ~0.5% of the engine's own raw magnitude for every one of the 12 B scenarios, and the FOLLOWING tick decays
by exactly the 0.6·0.91 constant `cmp`/the old B path already knew, now dated to the right tick instead of guessed at
~2-3 of them). Result: all 12 B cases (bare hand / iron sword / Knockback I / Knockback II × plain zombie / 0.5-resistant
zombie / ravager's own 0.75) are GREEN — the previous pack's 4 reds (Knockback I/II and the resistant targets reading
15-80% "high") were HARNESS artifacts of the old ~2-3-tick, single-fixed-decay capture, not engine bugs; `Cb.knockback`'s
halving/clamp math (src/14j_combat.js:277-289) and `Cb.attack`'s own two-call structure (base 0.4 via `Cb.hurt` ->
`Cb.baseKnockback`, then a second `Cb.knockback` for the enchant bonus, src/14j_combat.js:783-786) both match
`PlayerEntity.attack`/`LivingEntity.takeKnockback` (.decomp PlayerEntity.java:1136-1152, LivingEntity.java:1386-1393)
component-for-component once the capture is dated correctly. (Harness note, `still_owed`: on a real server, one long-lived
fake-player connection's own Spawn Living Entity capture eventually stops delivering fresh ids at all, at a different
case each run and never recovering on its own — cause unlocated this pass; `runkb.mjs` works around it by reconnecting
the bot before every B case, which is reliable but does not explain the underlying stall.)

The iron golem's throw never produced a packet (its `tryAttack` adds a raw vertical
0.4, IronGolemEntity.java:205-217) and the hoglin/zoglin push is random (Hoglin.knockback ±10°, ×0.2-0.7): both are
listed, not compared, until a distribution comparison exists.


**Hurt-panic pack (s137).** The growbot punches the animal with the real Interact-attack packet (`captureVelocity: true` is
what turns on growbot's `lastSpawnedEntityId`); the logger records Pos and HurtTime each tick and the log is re-based at the
first HurtTime 10. `hurtrefcheck` compares ticks 12..100 after the hit: the share of ticks the animal moves (vanilla keeps
re-picking random `NoPenaltyTargeting.find(mob, 5, 4)` spots while `getAttacker()` holds the player, 100 ticks) and the 90th
percentile per-tick speed (5 %). First run: cow/pig/rabbit panic stops early in the engine (39/33/16 % vs 96-100 %); the rabbit
panics at 1.26 b/s (server 6.7-6.9 — no panic hop); the horse runs 13.97 b/s (server 3.15 — the engine walks the horse AI by
`entities.json` horse speed 0.7, which is MobEntity's generic default: HorseBaseEntity.createBaseHorseAttributes registers
0.225F, HorseBaseEntity.java:394-398); the server's goat moves at 13.5 b/s after the punch staying ~1 block from the bot (it
RAMS — unconfirmed why, listed); mooshroom/sheep/chicken/donkey/turtle agree.

**Knockback part C** (infra W, s138): iron_golem's push and hoglin/zoglin's randomised push are real comparisons, not skips.
The golem has no player-hostile goal (IronGolemEntity.initGoals:82-85), so `runkb.mjs` provokes it with a tap first; its own
extra `+0.4` vertical throw (IronGolemEntity.tryAttack:211) is judged by the decay-free none/netherite vy ratio. Hoglin/zoglin
pushes are a two-sample KS test (30 reps per mob per armour tier) on decay-corrected |h| and vy. `--only=a|b` now keeps the
other half of `knockback.json` (it used to write the missing half as `{}`).

**Goat ram** (`runram.mjs`): `/summon` WITH NBT skips `GoatEntity.initialize`, the only place a fresh goat gets its
`ram_cooldown_ticks` and `long_jump_cooling_down` memories (GoatBrain.resetLongJumpCooldown) — so it rams at once; the runner
uses that on purpose and hands the long-jump memory in by NBT so the goat cannot leap the pen. The check reads the charge from
the per-tick Pos (> 0.4 b/t), the knock from the bot's own Set Entity Velocity packet, through kbrefcheck's ground decay.

**Piglin barter** (`runbarter.mjs`): the table half rolls through a chest like `runloot.mjs`; the live half logs the gold item's
Count and the number of other item entities every tick. Between reps the runner kills twice — a killed piglin DROPS the
ingot it was admiring.

**Leaf decay** (`runleaf.mjs`, infra s139): a felled oak (x3), the same tree with `persistent=true`, a one-log leaf line
and a two-trunk slab with one trunk cut. Every cell is written by `setblock` and read by `execute if block` (a probe that
edits blocks would itself schedule leaf ticks). `leafrefcheck` compares W(t) = gone + distance-7 every tick EXACTLY (the
wave is deterministic), every leaf's final DISTANCE exactly, and the decay rate (Σ d7) by a z test. First run: the felled
canopy's wave is one ring short at tick 25 (server 28, engine 25) — `Behave.tick` (src/07b_behaviour.js ~636-649) clears a
due tick's `pending` mark only just before running it, so a leaf re-scheduled by a neighbour earlier in the SAME batch is
dropped; vanilla polls every due tick out of `queuedTicks` before running any (WorldTickScheduler.addTickableTicks →
ChunkTickScheduler.pollNextTick:50-56). Clearing the marks for the whole due batch first turns it green and changes no
other referee check's output (red/fluid/button/plate/dispense/hopper compared line by line).

**Farmland moisture** (`runfarm.mjs`): bare, wheat-topped and melon-stem-topped fields drying from 7, a field hydrating
from 0 beside a water row, the 4-block radius edge, and the same hydration with waterlogged slabs as the only water. Grass
spreads back over dried-out dirt on the server, so the engine harness lays the same flat-world ground. First run: the
engine never counts a waterlogged block as water (`tickFarmland` asks `isWater` = the water BLOCK, src/07b_behaviour.js:1188;
vanilla `isWaterNearby` asks the FLUID state, FarmlandBlock.java:106-110) — with `S.waterIn` there, all green.

**Column plants (sugar cane, cactus)** (`runcolumn.mjs`, infra worker): three scenarios (cane on sand and on dirt beside
water, cactus on sand), 36 cells each, `randomTickSpeed 256`, six checkpoints; heights 2 and 3 are read by a direct
`execute if block` count (growthscen.mjs's dropped swap-to-glass probe had produced a self-contradictory golden) and the
runner refuses to write a golden where h≥3 ever exceeds h≥2. 5σ binomial tolerance, two breaks (4-tall cap, age-7
threshold). First run: GREEN. Not covered: cactus breaking beside a solid block (a scheduled/neighbour rule).

**Column-plant SURVIVAL (cactus, sugar cane)** (`survivescen.mjs`/`runsurvive.mjs`/`surviverefcheck.mjs`, infra
referee-survive, 25 Sept 2026) — the gap the column-plants entry above named ("Not covered: cactus breaking beside a
solid block"). 14 scenarios, ONE plant column each, no fake player needed (scheduled ticks, unlike random ticks, need
only a loaded/forceloaded chunk — confirmed by `growbot.mjs`'s own header). Clock: tick 1 places everything, tick
`TRIGGER` (10) makes the ONE support-breaking change, every probe cell is sampled boolean (still the plant) every
tick through T=30, tick-exact (not statistical — support either holds or it doesn't). Cactus covers all four
`canPlaceAt` horizontal cases (stone/glass/fence/sign all break it — Material.WOOD and Material.GLASS never call
`.notSolid()`, so a fence and even a see-through pane of glass are "solid" by the one property this rule reads; a
torch's Material.DECORATION does call `.notSolid()`, so it MUST NOT break it), lava beside (breaks) vs water beside
(does not — only `FluidTags.LAVA` is checked, not "any fluid"), water placed directly above (breaks — a separate,
vertical-only rule), and a 3-tall column losing its sand (a STAGGERED collapse: vanilla breaks it bottom-up across
three separate ticks, each break itself the neighbour change that schedules the next). Sugar cane covers water lost
beside its ground block (see finding, below), frosted_ice and a WATERLOGGED fence as the water-neighbour (both must
survive — `canPlaceAt` reads the `FluidState`, not the block identity), the ground block itself changed, and a 3-tall
cane cut in the middle (the bottom stays, the top breaks one tick after — its "below" is no longer cane and the
ground rule fails at that height too). A lone `/setblock` water source given ~9 ticks WILL wrap around a 1-block
obstacle and re-touch a ground block from a different side than the one you removed it from — every cane scenario
walls the ground block's other three horizontal sides in stone and floors its water cell, or the removal scenario
tests nothing (found empirically, not guessed, D-30).

⚠⚠ **TWO REAL FINDINGS, BOTH LEFT RED ON PURPOSE (D-30/D-305 — a mismatch is not this pack's bug to fix):**
1. **Cactus is never cascade-broken by a live neighbour change, at all.** `cascadeFrom`'s guard (src/07_world.js:900,
   `if (st === 0 || !NS.States.support[st]) continue;`) only recognises the six GENERIC material-derived support
   classes; cactus's survival comes entirely from the jar's own rule table (D-346's rule 4) with `support=0`, so the
   guard skips it before `canSurvive` is ever called. This is the exact bug the PLACEMENT gate two lines below it
   (src/07_world.js:927) was already fixed for — its comment says so — but the fix was never mirrored onto
   `cascadeFrom`'s own guard. Sugar cane happens to dodge total blindness only because it ALSO carries a generic
   class (`support=1`, floor) alongside its rule 22. `surviverefcheck.mjs --verbose` proves the one-line fix
   (`!NS.States.support[st]` → `!(NS.States.support[st] || (NS.States.rule && NS.States.rule[st]))`) with the REAL
   engine, source text patched in memory only — `src/**` is never written.
2. **Where the cascade does fire, it fires one tick too early.** Vanilla never breaks cactus/cane in the same tick
   support disappears: `getStateForNeighborUpdate` (CactusBlock.java:73-79 / SugarCaneBlock.java:61-67) schedules a
   recheck ONE TICK LATER (`createAndScheduleBlockTick(pos, this, 1)`); `scheduledTick`
   (CactusBlock.java:32-36 / SugarCaneBlock.java:33-37) breaks it only when that fires. `cascadeFrom` pops the block
   synchronously, before `W.setBlock` even returns — there is no scheduling path for a cactus/cane support recheck
   anywhere (07b_behaviour.js's own header names layer 4, `Behave.schedule`/`Behave.tick`, as water/lava only).
   `cane_base_changed` and `cane_cut_middle`'s top cell show it directly: server gone at TRIGGER+1, engine gone AT
   TRIGGER. This one has no one-line fix — it needs an actual scheduling path — so the check only illustrates the
   shape of it over a scratch Map world.

Anti-vacuity: `W.canSurvive` patched to always return true (every breaking scenario must then mismatch — it does),
and the golden shifted one tick on a scenario whose series actually moves (`cane_base_changed` — a scenario whose
golden never changes, like `cane_water_removed`'s constant all-present series, can't be perturbed by a shift). Both
caught, 2/2. First (and, as of this pass, only) run: RED on both findings above, by design — `node
tools/referee/surviverefcheck.mjs` names them with tick numbers and file:line citations on both sides.

**Caveat (all runners):** one `/fill` is capped at 32768 blocks — a bigger one is REFUSED ("Too many blocks") and the
previous pack's blocks survive into the next run (leaves left over from the leaf pack turned farmland to dirt). Clear per
16-wide slab, and reset every storage key the run appends to: storage is saved with the world.

### MOB MELEE x DIFFICULTY + EFFECT DURATION (infra I6, s148, 25 Sept 2026)

`runmelee.mjs` now also runs 7 mobs (`DIFF_MOBS` in meleescen.mjs: zombie, zombie_sword, husk, vindicator, piglin_brute,
spider, cave_spider) at EASY and HARD on an unarmoured player (all lanes per rep, x3), and reads each applied effect's
`Duration` the moment the hit is seen (`effDur` per rep). `meleerefcheck` compares damage per difficulty (the key
`<mob>@none@<diff>`, already understood) and the engine's at-hit duration against [server max, server max + 25] (the
server read lags the hit by up to ~19 ticks: poll gap + RCON on 2 cores). Anti-vacuity break 4: golden husk Hunger +70.
Result 25/42 (17 red). Difficulty damage scaling (easy min(d/2+1,d), hard x1.5) matches for every unarmed mob.
New reds: **husk Hunger duration** — `Undead.huskHungerDuration` (src/07zk_undead.js:94-98) is `floor(140 * localDifficulty)`;
vanilla HuskEntity.tryAttack is `140 * (int)localDifficulty` (truncate FIRST): easy 0.75 -> none at all (engine 105 ticks),
normal 1.5 -> 140 (engine 210), hard 2.25 -> 280 (engine 315). cave_spider Poison 7 s / 15 s and none on easy: exact.
The `zombie_sword` reds (held weapon damage never added) and the Protection-IV reds are the pack's older findings.

### MOB RANGED — skeleton / stray / pillager shooting a player (infra I6, s148, 25 Sept 2026)

`rangedscen.mjs` / `runranged.mjs` (port 25653, ~3.5 min) / `rangedrefcheck.mjs` (stages.d `referee-ranged.json`). The shooter
is summoned BARE (so `MobEntity.initialize` hands it its bow/crossbow) 10 blocks down a 3-wide walled lane; the bot is
re-teleported every poll (knockback) and healed below 10. Server side, an arrow that hits is gone before a poll can tag it, so
the HIT stream is the clean one (a rep with < 3 hits falls back to tagged launches); gaps >= 1.5x the smallest (a missed
volley) are dropped. Engine side: the real player, `EL.tick` + the player's own invulnerability countdown and effect tick
(without those the first hit's window never closes and every later arrow bounces — a harness artifact, not a finding).
Result 5/7: skeleton/stray cycles (60 normal/easy, 40 hard, server 58/38 — the poll clock reads ~2 short), mean damage, Slowness
all match; arrows are correctly NOT difficulty-scaled (EntityDamageSource.isScaledWithDifficulty asks the DIRECT source).
Reds: **pillager crossbow arrows hit too hard** (server mean 3.5, engine 4.4) — the engine fires them through `Cb.mobShoot`
(the skeleton's `applyEnchantmentEffects` roll: 2 + gaussian*0.25 + difficulty*0.11); vanilla CrossbowItem.createArrow
(:229-243) never calls it, a crossbow arrow keeps the flat 2.0. **Pillager opens fire ~3-4x late** (server's slowest first
volley tick 88-99, engine ~290-315); once firing the charge cycle matches. Cause not isolated — its CrossbowAttackGoal range is
8 (PillagerEntity), so it must first walk 2 blocks in; the engine's goal (07k_goals.js:2370) mirrors vanilla's state machine,
so the delay is upstream (target acquisition or the approach). Worth one browser look before a fix.

### MELT — ice and snow layers by block light (infra I6, 25 Sept 2026)

`meltscen.mjs` / `runmelt.mjs` / `meltrefcheck.mjs` (stage `tools/stages.d/referee-melt.json`), golden `melt.json`.
Seven scenes: an 11-cell ice line and an 11-cell snow-layer line lit by glowstone (15) and by a 3-charge respawn anchor
(11), each inside a closed stone box; the same lines in the open noon sun with no source; ice hanging over air.
The BLOCK light at every cell, above it and below it is MEASURED on the server (a `location_check` light predicate
`mcliteref:l0..l15`, at midnight — inside a box the sky adds nothing), and the engine is handed exactly those readings.
Server answers: ice melts to WATER at block light > 10 (11 − ice's opacity 1), in the air too; snow layers go at > 11;
the sun never melts either. Part A checks the join: the real `World` module bound into `Behave` must pass its light on.
Caveats: a torch or an end rod as the source is washed away by the melt water mid-run (both tried) — only full-block
sources; a first run once left the last scene un-ticked (every cell kept) — the float scene now carries a floor-level
control cell, and a scene whose lit cells all survive is visible in the final-state line `runmelt` prints.

### LIGHT GATE — wheat and oak saplings by light (infra I6, 25 Sept 2026)

`gatescen.mjs` / `rungate.mjs` / `gaterefcheck.mjs` (stage `tools/stages.d/referee-gate.json`), golden `light-gate.json`.
The melt pack's measured-light method, the whole run at MIDNIGHT: a spaced line of wheat (farmland) and of oak saplings
(dirt), each lit by glowstone in a closed stone box, dark in a box, and in the open sky. Server answers: wheat grows at
block light ≥ 9 and ALSO in the open at midnight (CropBlock:77 `getBaseLightLevel(pos, 0)` — the sky undimmed, at the
crop itself); a sapling does not grow at midnight in the open (SaplingBlock:33 `getLightLevel(up)` — the night sky);
wheat below light 8 with no sky is GONE within ~300 ticks — its farmland's moisture change is a neighbour update and
CropBlock.canPlaceAt (:148) then fails. Cells are spaced so a placement never pops a neighbour.

### SPREAD — grass spread, grass under a cover, pumpkin stems (infra I6, 25 Sept 2026)

`spreadscen.mjs` / `runspread.mjs` / `spreadrefcheck.mjs` (stage `tools/stages.d/referee-spread.json`), golden `spread.json`.
The light gate pack's measured-light method in two phases on one server — A at MIDNIGHT (stems in a lit box / a dark box /
the open, stems at age 7 with dirt around them, a grass night control), B at NOON (grass spreading into a dirt cell in a lit
box / a dark box / the open; grass under stone, glass, a bottom slab, a top slab, snow layers 1 and 2). A phase's scenes are
built at its start. Server answers: a stem grows at midnight in the open (getBaseLightLevel, like wheat) and does NOT die in
the dark (PlantBlock — only the soil); at age 7 it sets its pumpkin and becomes the attached stem; grass spreads only where
getLightLevel(up) >= 9 (the time-of-day-dimmed sky — not at midnight, yes at noon); grass dies under stone, a BOTTOM slab and
snow[layers=2] (getRealisticOpacity: the cover's full down face), survives glass, a top slab and one snow layer.
⚠ Harness fact (all random-tick packs): a fake player's `/tp` does NOT move its chunk ticket (it never confirms the
teleport), so random ticks only run within the simulation distance (10 chunks) of the WORLD SPAWN. A first run laid out in
one 336-block row left every scene past x~160 un-ticked — the same cause as the melt pack's one "last scene un-ticked" run
(its row reaches x=159). Lay scenes out in a grid near the origin (this pack: 4 wide, 24 apart).
### HOGLIN REPELLENT — hoglins avoiding `#hoglin_repellents` (infra W, 25 Sept 2026)

`hoglinscen.mjs` / `runhoglin.mjs` / `hoglinrefcheck.mjs` (stage `tools/stages.d/referee-hoglin.json`), golden
`hoglin-repel.json`. Eleven pens (a stone floor + 2-high walls, mirrors panicscen.mjs): an adult hoglin with a
warped fungus at horizontal distance 3, 7, 8, 9 blocks and 4, 5 blocks straight up (the sensor's search box is
`BlockPos.findClosest(pos, 8, 4, ...)` — PER-AXIS, not a radius — .decomp `HoglinSpecificSensor.java:60`, so 8 across
/4 up-down is inside and 9/5 is the first block outside); the same with a respawn anchor, a nether portal and a
potted warped fungus as the repellent; a baby hoglin; a control with no repellent. Both sides log x/y/z every tick
for 200 ticks (`REPS=2`, "run the server twice to see the spread" — every scenario's own reps agree to well under a
block on final distance, printed under `--verbose`). Compared: does it flee at all (checked BOTH directions — a
scenario the server flees that the engine doesn't, AND vice versa, are both red), the cruise speed moving away
(`chaserefcheck.mjs`'s window method, applied to distance-from-repellent), and the final distance.

**Finding (not fixed here — `07zzg_hoglin.js`/`07i_entitylist.js` are out of this pack's fence):**
`tools/referee/hoglinrefcheck.mjs` is red on every repellent scenario. Root cause, proved in memory: `EL.spawn`
gives every hoglin (and every piglin/blaze/strider — anything rostered in `Ai.ROSTER`) a goal selector, so
`e.ai` is truthy; `EL.tickOne` (`07i_entitylist.js:1725-1726`) then does `var mob = !!e.ai; if (mob) return
EL.tickMob(e);` — an EARLY RETURN before the dispatch block at `07i_entitylist.js:1843-1849` that calls
`NS.Hoglin.tickEntity`, `NS.Piglin.tickEntity`, `NS.Blaze.mobTick` and `NS.Strider.tickEntity`. Nothing in
`EL.tickMob` (`07i_entitylist.js:1388-1630`) calls any of the four. So `Hg.tickEntity` — which is what refreshes
`e.hgRepellent` from `Hg.nearestRepellent` every 20 ticks, the memory `Hg.FleeGoal`'s repellent branch reads as its
threat — never runs for an actually-spawned hoglin, and the repellent-flee goal's `canUse` is permanently false
(confirmed: `e.hgRepellent` stays `undefined` for the whole 200-tick run in every scenario). The handful of
scenarios the check still reports "engine flees" are FALSE POSITIVES — coincidental net drift from the unrelated
`WaterAvoidingRandomStrollGoal` clearing `FLEE_MARGIN` (1 block) over 200 ticks by chance, not real fleeing.
One-line fix direction: call the four `tickEntity`/`mobTick` dispatches from inside `EL.tickMob` (gated on `e.type`
exactly as `07i_entitylist.js:1843-1849` already does), not only from the dead branch below `tickOne`'s early
return. `hoglinrefcheck --verbose` prints each scenario's `fled true/false`, final distance and cruise speed for
both sides so the fix can be checked against the same golden once applied.

### MOB AVOID/FLEE — mob-vs-mob and mob-vs-sunlight (infra W, 25 Sept 2026)

`avoidscen.mjs` / `runavoid.mjs` / `avoidrefcheck.mjs` (stage `tools/stages.d/referee-avoid.json`), golden
`avoid.json`. QUEUE 0.0's "run its AI for real ... flee" for every AVOID/FLEE goal that is NEITHER the burning-mob
PANIC pack (`panicscen.mjs`, `EscapeDangerGoal.isOnFire`) NOR the hoglin-repellent-BLOCK pack (`hoglinscen.mjs`).
Two kinds of pen, both the same "stone floor, 2-high walls, no player" shape every pack in this file uses:

- **kind 'ent'** (17 scenarios) — a FLEER and a THREAT mob, both real, both AI-on/persistent, in one pen; both
  sides log BOTH mobs' Pos every tick, so "distance" is always fleer-to-THREAT's *live* position (the threat has
  its own AI and may itself wander), never a fixed point. `creeper`/`skeleton`/`stray` vs `cat`/`ocelot`/`wolf` at
  3/6/9 blocks (the creeper's own 6-block `FleeEntityGoal` trigger, CreeperEntity.java:71-73); `villager`/
  `wandering_trader` vs `zombie` at 4/8/9 (WanderingTraderEntity.java:71-77's own 8-block zombie row);
  `rabbit`/`fox` vs `wolf` at 6; a no-threat creeper control.
- **kind 'shade'** (3 scenarios) — one mob, on fire (`Fire:<n>s`, the same owner-free trigger `panicscen.mjs`'s
  own header already documents), in a pen roofed over its RIGHT half only (closes `world.isSkyVisible` there,
  open over the spawn half) — `skeleton`/`zombie` at noon (`time set 6000`) and `skeleton` at midnight (control:
  `EscapeSunlightGoal.canStart`'s own `!world.isDay()` gate). **Both golden reps show NEITHER species ever reaches
  the shaded half, even the noon skeleton** — this is a real, decomp-proven vanilla fact, not a harness bug:
  `EscapeSunlightGoal.locateShadedPos` (.decomp, read in full) requires
  `this.mob.getPathfindingFavor($$3) < 0.0F`, and `AbstractSkeletonEntity` never overrides
  `PathAwareEntity.getPathfindingFavor` (`.decomp/net/minecraft/entity/mob/PathAwareEntity.java:25-27` returns a
  flat `0.0F`), so the random-sampled shaded position is NEVER accepted and the goal's own `canStart` is
  permanently false for this entity — vanilla skeletons do not actually path to shade in 1.18.2. Proved live: the
  golden's `HandItems:[{},{}]` NBT (a bow-holding skeleton blocks the goal outright, `EscapeSunlightGoal.java:36`'s
  own equipped-mainhand check) made no difference to the outcome. The three SHADE scenarios therefore come back
  GREEN for a reason worth flagging on its own: the engine has ZERO code for either `AvoidSunlightGoal` or
  `EscapeSunlightGoal` (confirmed absent from `Ai.ROSTER.skeleton`, `07k_goals.js:3746-3757`, the whole function
  body read), and it only *matches* the server here because the server's own Escape half never fires either. The
  proactive half (`AvoidSunlightGoal` — a navigation-penalty flag, not a directed walk, `AvoidSunlightGoal.java`)
  is genuinely untested by this pack (no scene gives a skeleton a real route choice between sun and shade) and
  remains an open gap, not a scenario result.

**Anti-vacuity (D-30/D-305), 3/3 caught:** the golden `creeper_ocelot_6` log's away-movement scaled 0.8x (speed
and final-distance TOL breaks, same generic probe as `hoglinrefcheck.mjs`'s own `dist3` break); the engine's
`WT.FLEE_TYPES.zombie` (07zt_wtrader.js:304) widened 8→20 (`trader_zombie_9`, outside vanilla's own 8-block row,
falsely flees — the search-box-edge break); the engine's `WT.FLEE_SPEED` (07zt_wtrader.js:305) zeroed
(`trader_zombie_4`, server flees, falsely stands still).

**Findings (not fixed here — `07k_goals.js`/`07zt_wtrader.js` are out of this pack's fence), `node tools/referee/avoidrefcheck.mjs --verbose` against the checked-in golden, 6/20 scenarios green, 18 red:**

1. **Skeleton/stray have NO flee-wolf goal at all — three whole vanilla goal rows missing.**
   `AbstractSkeletonEntity.java:69-72` initGoals is `AvoidSunlightGoal(this)` (2), `EscapeSunlightGoal(this,1.0)`
   (3) AND `FleeEntityGoal<>(this,WolfEntity,6F,1.0,1.2)` (3) — `Ai.ROSTER.skeleton` (`07k_goals.js:3746-3757`,
   read whole, `stray` reuses it verbatim per `07k_goals.js:3905`) builds NONE of the three: no
   `Ai.AvoidEntityGoal` call, no sunlight call anywhere in the function. `skeleton_wolf_3`/`_6` came back green by
   coincidence (the server itself barely flees a wolf at those distances — majority "does not flee" both sides);
   `stray_wolf_3`/`_6` came back RED (`avoidrefcheck: stray vs wolf at 3b/6b: server does not flee, engine
   flees`) — the engine's apparent "flee" is `WaterAvoidingRandomStrollGoal`'s own random drift crossing the
   1-block `FLEE_MARGIN` by chance over 160 ticks, the same phantom-flee shape this file's HOGLIN REPELLENT
   section and this pack's own `creeper_control` case both already name, not a real goal.
2. **Villager has NO flee-danger goal at all — `Ai.ROSTER.villager`'s own header already names the gap.**
   `07k_goals.js:4117-4133` (read whole): FloatGoal, a stroll placeholder, two LOOK goals — its own comment cites
   "fleeing danger" as `Ai.OWED`, unwritten. There is no `.decomp/net/minecraft/entity/passive/VillagerEntity.java`
   in this checkout at all, so the vanilla fact here is the REFEREE SERVER itself (D-263's own rule), not a
   decompiled class: `villager_zombie_4`/`_8` both came back red on SPEED/FINAL-DISTANCE
   (`villager_zombie_4`: server flee speed 3.75 b/s final 6.56b, engine 6.15 b/s final **24.06b** — nearly 4x
   the server's separation) and `villager_zombie_8` flips the FLEE VERDICT itself (server: does not flee in 2 of
   3 reps; engine: flees). ⚠ Caveat worth carrying forward: since the engine's villager goal roster truly has no
   flee code, what the check is measuring here is **zombie-hit KNOCKBACK alone** separating the two entities, not
   an escape goal — real vanilla villagers flee via a Brain/Activity panic sensor this checkout has no decompiled
   source for, so the mechanism differs even where the numbers happen to line up. `wandering_trader` is the
   working contrast: `WT.FleeHostilesGoal` (`07zt_wtrader.js:307-333`) IS wired into `WT.rosterGoals`
   (`07zt_wtrader.js:354`) as an ordinary goal-selector row — a REAL, working flee, unlike hoglin/piglin/blaze/
   strider's own `tickEntity` dispatch this file's HOGLIN REPELLENT section found dead for a rostered mob (same
   root cause does NOT apply here: `WT.FleeHostilesGoal` runs via `e.ai.tick()`, `07i_entitylist.js:1426`, inside
   the REACHED path, not the dead branch after `tickOne`'s early return) — yet `trader_zombie_9` still flips the
   verdict (server: does not flee 2 of 3 reps at the boundary; engine: flees), matching the finding below.
3. **Every working flee goal measured here cruises 1.6x–3x too fast.** `creeper_cat_3`: server 3.560 b/s, engine
   8.828 b/s (+148%); `creeper_cat_6`: server 2.198 b/s, engine 8.038 b/s (+266%); `creeper_ocelot_3`: +148%;
   `creeper_ocelot_6`: +263% — all through `Ai.AvoidEntityGoal` (`07k_goals.js:2871-2899`), called from
   `Ai.ROSTER.creeper` (`07k_goals.js:3828`). `trader_zombie_4`: server 3.373 b/s, engine 5.342 b/s (+58%) and
   `villager_zombie_4`: server 3.749 b/s, engine 6.148 b/s (+64%) — through the UNRELATED `WT.FleeHostilesGoal`/
   knockback path — same direction, smaller magnitude. Both paths call the same
   `Ai.stepToward`→`Ai.setMobSpeed(e, speedModifier * Ai.movementSpeedOf(e))` conversion (`07k_goals.js:1237,
   1249`, `Ai.movementSpeedOf` at `07k_goals.js:1186-1200`) that the chase pack's own `MeleeAttackGoal`-driven
   scenarios (`chasescen.mjs`) already exercise for the SAME entities without this file recording a comparable
   gap — worth checking whether `AvoidEntityGoal`'s point-`range`-away path target (`07k_goals.js:2887-2889`,
   picking a waypoint exactly `range` blocks out rather than vanilla's own re-picked-nearer-node behavior) feeds
   `Ai.findPath` a route this engine's pathfinder straight-lines faster than a real navigated path would.
4. **`creeper_cat_9`/`creeper_ocelot_9` flee outside the goal's own declared range.** Both threats spawn 9 blocks
   out — beyond `Ai.AvoidEntityGoal(e,6,...)`'s own `canUse` trigger (`07k_goals.js:2874-2880`,
   `d <= range` with `range=6`) and beyond `FleeEntityGoal<>`'s vanilla 6F (`CreeperEntity.java:71-73`) — yet the
   engine still flees in both (`creeper_cat_9`: server does not flee (0/3 reps), engine flees, final 13.6b;
   `creeper_ocelot_9`: final distance server 11.10b, engine 17.08b). Rule 6's "flees when vanilla does not" case,
   live: either the 6-block trigger is being read past its own edge somewhere between `AvoidEntityGoal`'s
   `canUse`/`canContinueToUse` (the `range * 1.5` leash-back at `07k_goals.js:2882-2885` reads only the
   CONTINUATION distance, not a second, wider TRIGGER distance — worth checking nothing conflates the two), or
   the two summoned cats/ocelots simply wander into the 6-block ring far more often in this engine's own
   `WaterAvoidingRandomStrollGoal` than the server's threats do over the same 160 ticks.

`avoidrefcheck --verbose` prints each scenario's server `fled true/false` (per rep) / final distance / cruise
speed alongside the engine's own, and the SHADE cases' `reached-shade true/false`, so every fix above can be
checked against the same checked-in golden.

### FIRE — burn-out, infiniburn, fuel burning away, TNT (infra I6, 25 Sept 2026)

`firescen.mjs` / `runfire2.mjs` (~2 min) / `firerefcheck.mjs`, golden `fire.json`. (`runfire.mjs` is the unrelated on-fire LOOT runner.)
Eight scenes x 6 reps on a stone floor near the origin, difficulty normal, clear weather: a fire on stone, on netherrack, on
magma; a fire on top of one oak planks / oak log / white wool; on top of a 3x3x2 planks pile; beside a TNT block. Fire runs on
SCHEDULED ticks, so a forceloaded chunk is enough — no fake player. The fires are `/setblock`ed with doFireTick OFF (their own
tick is queued and does nothing), then the clock starts and doFireTick goes on. A datapack TICK function (`mclitefire:watch`)
stamps the game time the tick each watched cell stops being its block, and stamps + kills a primed TNT (so no blast reaches a
neighbour) — tick-exact, where an RCON sample loop is not (each RCON command costs ~a tick; 150 per sample = 150-tick gaps).
Times past T are clipped (the watcher runs a little past it). Verdicts per scene over the reps: stone burn-out (all gone both
sides, engine median lifetime 0.5x..2x the server's), still-burning count on netherrack/magma (exact), fuel-burnt count (±2),
pile mean fraction burnt (±0.25), TNT-primed count (±2). Anti-vacuity: fire never reschedules / T/20 ticks / no floor.

⚠ **RED on 7 (the engine's own D-210 gap, measured):** `tickFire` (src/07b_behaviour.js:734) has no infiniburn (a fire on
netherrack or magma dies at age > 3 — vanilla: 6/6 burn forever, FireBlock:152/163), no `trySpreadingFire` (planks 5/6, log
4/6, wool 6/6, pile 58% burnt away on the server — the engine 0), no TNT priming (server 6/6), no spread into the air box.
Stone burn-out agrees (server median ~500-590 ticks, engine ~400).
RAIN phase (s142, `weather rain`, the same columns reused): rain-stone (server median ~210 ticks — the 0.5x..2x band still
passes an engine with no rain rule, so rain dousing is only weakly seen there), rain-netherrack (infiniburn ignores rain:
6/6 live — red, the same infiniburn gap), rain-planks1 (server 1/6 burnt), rain-pile (server 0%: no spread onto rained-on
cells — agrees today only because the engine has no spread at all; it goes red the day spread lands without the rain test).
The pile's burnt fraction varies run to run on the server (23%..58%), hence its ±0.35.

**SPREAD pack addendum (s142):** `melon-night` + `melon-fruit` — the same StemBlock rules with gourdBlock = melon; same two reds
as pumpkin. `runspread.mjs --phase A|B` regenerates ONE phase and merges it into the existing golden (half the time).

**AVOID pack addendum (s142, orchestrator):** the worker's "flee goals cruise 1.6-3x too fast" was the SEPARATION rate, which
folds in the threat's own motion. The check now also judges the fleer's OWN ground speed (displacement from its spawn, the
same 1..4-block window, 15%): the engine creeper flees 50-65% too SLOWLY (or never covers 1 block) while the engine cat/ocelot
walks off; the villager 64% too slowly. `VB.rand` is now seeded in the check (07zv:192 captured Math.random at load — the
villager scenes were nondeterministic run to run).

### ARMOR — one arrow through armour, toughness, Protection family, Resistance (infra I6, s142, 25 Sept 2026)
`armorscen.mjs` / `runarmor.mjs` (~20 s, own port 25643) / `armorrefcheck.mjs`, golden `armor.json`. 19 scenarios: a NoAI
skeleton or zombie (summoned WITH NBT — no `initialize`, so no random gear or leader bonus; the zombie's own 2.0 base armour
stays) wearing a scenario's `ArmorItems`, optionally `ActiveEffects` Resistance; an OWNER-LESS arrow summoned 2 blocks in front,
`Motion` +z at v, NBT `damage` d. Health is read with `/data get` (float as printed) before and 20 ticks after. The server is
exactly constant over reps (the 1.18 protection formula has no randomness). The check compares the health LOST to 0.001.
`v = 2.01` is there on purpose: `ceil(|v| * d)` = 5 at the hit, 4 if the velocity is read after that tick's 0.99 drag.
First run (engine = master's src minus the s138 render/particle files): **15/19 agree** — armour points + toughness
(leather/iron/diamond/netherite, big and small hits, zombie base armour), generic Protection, fire/blast protection correctly
ignored on an arrow, Resistance I/III and Resistance + Protection all exact. Reds:
- 🔴 `skel_iron_projprot4`, `skel_boots_projprot2`, `skel_gold_mixed`: **Projectile Protection does nothing on a mob**.
  `EnchantmentHelper.getProtectionAmount` asks every piece `ProtectionEnchantment.getProtectionAmount(level, source)` —
  projectile protection = 2 x level on a projectile source (ProtectionEnchantment.java, `Type.PROJECTILE`), summed with generic
  protection's 1 x level, capped at 20 in `DamageUtil.getInflictedDamage`. `Eq.armorOf` (07y_equip.js:314-327) sums only
  `protection`; `Cb.hurt` (14j_combat.js:~430) says the other kinds have no source substrate — the arrow path (Cb.tickArrow,
  `{attacker}` only) is that substrate. Server: iron set + PP IV loses 0.624 of 6 (EPF 32 -> 20 = 80 %); engine 3.12.
- 🔴 `skel_bare_v201`: **arrow damage is read after the tick's drag**. `Cb.arrowHitDamage` (14j_combat.js:1041) reads
  `e.vx/vy/vz` inside `Cb.tickArrow`, after `EL.tickOne`'s 0.99 drag (and the arrow's own gravity) — vanilla's `onEntityHit`
  reads the velocity the raycast used (PersistentProjectileEntity.tick, before `velocity *= 0.99`). 1 % low: only visible when
  `|v| * d` sits within 1 % above an integer (v 2.01 d 2: server 5, engine 4) — but every such arrow, every shot.
Anti-vacuity 3/3: a golden health shifted 0.5, the engine's Resistance switched off, the engine arrow's damage doubled.

### STATUS EFFECTS on mobs — poison/wither/regeneration cadence, immunities, instant effects (infra I6, s142)
`effectscen.mjs` / `runeffect.mjs` (~40 s, own port 25644) / `effectrefcheck.mjs`, golden `effects.json`. 20 scenarios: a
NoAI mob summoned at a set Health (optionally diamond + Protection IV, or Resistance II by NBT), then `/effect give` (NOT an
`ActiveEffects` NBT tag — NBT loading skips `canHaveStatusEffect`, so a zombie would take poison) and a datapack tick function
appending its Health every tick (entry 0 = before any world tick: tick functions run before the world). Judged: the ordered
health values after each change, the tick gaps between changes, death and its tick relative to the first change.
Harness fact: `EffectCommand.executeGive` (EffectCommand.java:101-106) gives an INSTANT effect a duration of the seconds
argument in TICKS (1) — handing `addStatusEffect` 20 ticks of instant damage would apply it every tick (vanilla too,
`InstantStatusEffect.canApplyUpdateEffect` is `duration >= 1`). First run: **20/20 agree** — poison 25>>amp stopping at 1
health, spiders/undead refusing poison, wither 40>>amp killing, wither skeleton immune, wither through Protection IV (bypasses
armour, not enchantments) and through Resistance II, regeneration 50>>amp capped at max health, undead refusing it, instant
health/damage 6<<amp / 4<<amp with the undead swap (and through Protection IV). A green guard over 07q_effects.js.
Anti-vacuity 3/3: every golden step -1, the engine's poison cadence 25 -> 20, the engine's undead gate removed.

### PLAYER ARMOR — the same arrow scenes on a real survival player (infra I6, s142)
`runplayerarmor.mjs` (~100 s, own port 25645; armorscen.mjs's 16 skeleton scenes) / `playerarmorrefcheck.mjs`, golden
`player-armor.json`. A growbot in survival (difficulty normal, naturalRegeneration false — a joined player's saturation heals 1
every 10 ticks), armour by `/item replace entity pa0 armor.*`, Resistance by `/effect give`, topped up with instant_health,
1.3 s between shots (past the 20-tick invulnerability). The server's player numbers are IDENTICAL to the mob pack's (same
`applyArmorToDamage` -> `applyEnchantmentsToDamage` in LivingEntity). The engine's player path: Survival.init +
inventory slots ARMOR_START..+3 -> `Survival.updateArmor` (what 14_player.js:523 runs each tick) -> the arrow's hit ->
`Survival.hurt`. First run: **10/16 agree** — armour points/toughness and Resistance exact. Reds:
- 🔴🔴 `skel_chest_prot4`, `skel_diamond_prot4_resist2`, `skel_iron_projprot4`, `skel_boots_projprot2`, `skel_gold_mixed`:
  **the PLAYER gets no Protection-family reduction at all** — `Survival.hurt` (14d_survival.js:233-270) runs armour, then
  Resistance, then absorption, and never `applyEnchantmentsToDamage`'s `EnchantmentHelper.getProtectionAmount` ->
  `DamageUtil.getInflictedDamage` step (LivingEntity.java:1545-1560). A full diamond Protection IV set + Resistance II takes
  2.30 from a 12-damage arrow in the engine, 0.83 on the server; Protection IV on a chestplate alone does nothing. The same gap
  covers every source: generic Protection vs everything, Fire Protection vs fire/lava, Blast Protection vs explosions,
  Feather Falling vs falls (Survival has no enchantment read at all). The mob path (`Cb.hurt`) has generic Protection only.
- 🔴 `skel_bare_v201`: the arrow's damage read after drag — the same finding as the mob pack.
Anti-vacuity 3/3: a golden health -0.5, `Survival.afterArmor` -> identity, the arrow's damage doubled.

### PLAYER-KILL / LOOTING loot (infra I6, s142)
`lootingscen.mjs` / `runlooting.mjs` (~90 s, own port 25646) / `lootingrefcheck.mjs`, golden `looting.json`. The mob-loot pack
rolled every table with no killer; this one rolls the context of a real player kill: `execute as lt0 run loot replace block
<chest> container.0 27 kill @e[tag=<mob>]` (LootCommand.executeKill, LootCommand.java:451-473: the executing player becomes
KILLER_ENTITY / DIRECT_KILLER_ENTITY / LAST_DAMAGE_PLAYER, and `looting_enchant` / `random_chance_with_looting` read its main
hand). 25 mob tables x 2 lanes (L0 plain netherite sword, L3 Looting III) x 300 rolls, at NIGHT (a NoAI zombie still burns by
day and a burning mob's table smelts). The engine side is the real kill join: a Survival.init player holding the lane's sword,
`Combat.attack` on a 0.001-health mob, `Combat.tickEntity` (the death drop), count the item entities; spawn gear stripped
(`/loot ... kill` never runs dropEquipment). Statistics as mobreflootcheck (rate + mean per kill, 5 sigma).
First run: **L0 24/25 agree** (killed_by_player rows — blaze rods, the zombie family's iron/carrot/potato, wither skull,
vindicator/evoker emeralds — all right), **L3 2/25**. Reds:
- 🔴🔴 **Looting does nothing.** `Cb.dropLoot` (14j_combat.js:618-624) hands `Loot.entityDrops` `looting: 0` — hard-coded,
  its own comment "Cb.OWED ... G22". Vanilla reads the killer's main-hand Looting level (LootingEnchantLootFunction /
  RandomChanceWithLootingLootCondition via KILLER_ENTITY). Every mob, every Looting sword: e.g. Looting III cow beef 3.59/kill
  on the server vs 2.01, blaze rods 94 % vs 52 %, wither skeleton coal 89 % vs 32 %. The FORMULA in 07e_loot.js is right
  (mobreflootcheck) — only the join is missing. The same gap likely hides in MobEntity.dropEquipment's `+ 0.01 * looting`.
- 🔴🔴 **A killed sheep never drops wool.** `SheepEntity.getLootTableId` (SheepEntity.java) returns `entities/sheep/<colour>`
  for an unsheared sheep — that table has the wool AND a `loot_table` entry pulling in `entities/sheep` (mutton). The engine
  always rolls `entities/<type>` = `entities/sheep` (mutton only): 0 % wool vs 100 % on the server, any colour, any killer.
Anti-vacuity 3/3: a golden rotten-flesh rate halved, the engine's killed_by_player forced false (blaze rods), L0 golden vs L3.

### BLOCK HAZARDS — magma, campfires, wither rose, fire, lava, powder snow, suffocation (infra I6, s142)
`hazardscen.mjs` / `runhazard.mjs` (~35 s, own port 25647) / `hazardrefcheck.mjs`, golden `hazards.json`. 15 scenarios: an
AI-on mob (NBT summon) in a 1x1 glass pen; the hazard is placed in the same tick the per-tick Health log starts (the magma floor
is part of the arena, so the pig is already hit once at entry 0). The pens are not perfectly deterministic (a pig shuffles), so
the judgement is coarse: damage or none, the set of per-hit amounts, death and ticks-to-death within 20 %.
First run: **7/15 agree** — suffocation (inside stone / stone at head height: 1 per 10 ticks, dead in 90), the controls and
the fire-immune zombified piglin (it takes nothing from magma/fire/lava on either side). Reds — **the engine has NO block
hazard damage at all**:
- 🔴🔴 lava (server: 4 per hit + set alight, a pig dies in 20 ticks), a fire block (1 per 10 ticks + alight), campfire (1) /
  soul campfire (2) (lit only — the unlit control agrees), magma (HOT_FLOOR 1; the zombie's 0.94 is its 2.0 base armour),
  a wither rose (Wither II), powder snow (freeze: FREEZE 1 every 40 ticks once frozen after 140) — engine: 0 damage for all.
  `Ph.updateFluids` sets `e.inLava` (14b_physics.js:533) but nothing reads it for damage; nothing calls `Survival.hurt` with
  'lava' / 'inFire' either (the source types exist in `Sv.DAMAGE`, 14d_survival.js:74-76, and are never used) — so by the code
  the PLAYER walks through lava, fire, campfires and magma unharmed too (not yet measured with a growbot).
  Vanilla: Entity.baseTick `if (isInLava()) setOnFireFromLava()` (LAVA 4, 15 s), AbstractFireBlock/CampfireBlock/
  WitherRoseBlock.onEntityCollision via Entity.checkBlockCollision, MagmaBlock.onSteppedOn, LivingEntity.tickMovement's freeze.
Anti-vacuity 3/3: a golden series made harmless, the engine's Combat.hurt made a no-op, a golden hit amount doubled.
### PHANTOM — swoop/circle AI vs a survival bot, and the cat abort (infra W, 25 Sept 2026)

`phantomscen.mjs` / `runphantom.mjs` (~3 min) / `phantomrefcheck.mjs`, golden `phantom.json`. Two lanes, one growbot each,
on a floor at y=100 (well above sea level 63, so `StartAttackGoal.startSwoop`'s own circling-height clamp — `max(target.y+20+
rand(20), seaLevel+1)`, .decomp `PhantomEntity.java` — never engages; phantomscen.mjs's own header cites the exact formula):
BARE is the bot alone; WITH_CAT parks a frozen (`NoAI:1b`) cat `CAT_DX` (2.5) blocks away, inside `SwoopMovementGoal`'s own
16-block/20-tick cat-abort check (`.decomp/net/minecraft/entity/mob/PhantomEntity.java:464-501`, `catsNearby`/`getEntitiesByClass
(CatEntity.class, ...expand(16.0))`), mirrored in this engine's own `07zz1_phantom.js` `SwoopMovementGoal` (same 16-block/
20-tick numbers, cited in that file's own header). A datapack tick function appends the phantom's Pos, the bot's own Pos and
the bot's health (a `health`-criterion scoreboard read, sampled via `execute store result storage ... run scoreboard players
get`) every tick from the same RCON burst that `/summon`s the phantom — tick-exact, the same method FIRE/KB already use.
**Harness facts, found empirically:** `/data merge entity <player> {Health:...}` is refused ("Unable to modify player data") —
health is instead topped up every rep with `/effect give ... instant_health 1 <amp> true`; amplifier 255 (the packs' usual
"make it unconditional" idiom) OVERFLOWS the server's own `4 << amplifier` heal math and heals *nothing* — amplifier 10 is
what actually works, and `/attribute ... generic.max_health base set 200` raises the cap first so a dive's damage shows as a
drop, not a death. Also found empirically: `execute store result storage <target> <path> ... run <command>` has **no `append`
keyword** (unlike `data modify`) — one written with it PARSES TO NOTHING, and the function that contains it becomes an
"Unknown function" as a *whole*, not a runtime error on that one line; the datapack stores into a scratch path first, then
`data modify ... append from storage` that.

**Verdicts** (both directions, rule 6): did the phantom ever get within `TOUCH` (2 blocks) of the bot at all — this is the
cat-abort's own headline question, and it is GREEN both ways today (BARE: swoops every rep, median tick ~80 and a real hit
sequence later past tick 400; WITH_CAT: never once inside `TOUCH` on either side — the engine's cat-abort gate is correctly
wired). Once both sides agree a swoop happened: first-swoop tick (a wide ±220-tick band — `StartAttackGoal`'s own
`(8+rand(4))x20`-tick cooldown plus an unspecified spawn phase makes this a distribution, not an exact tick), swoop count in
T=500 ticks (±1), circling height band (median `phantom.y - bot.y` while `dist > 6`, ±15 blocks — `CircleMovementGoal`'s own
`rand(20)+rand(9)` spread), and damage dealt (health start − end, ±60% relative).

⚠ **RED on damage (a real engine-vs-server gap, measured):** over 500 ticks the server lands a **median of 6 points of
damage** on the bot per BARE rep (consistent 200→194 all 3 reps — almost certainly three separate 2-damage hits across one
or more dives, `phantom`'s own base `ATTACK_DAMAGE` per `assets/entities.json`'s `attrs.phantom.dmg`), while this engine's
own `07zz1_phantom.js` port lands only **2** (one hit) in the same window — the swoop-count and first-touch numbers otherwise
agree, so the gap is in what happens *after* a dive starts (a hit vs. a miss vs. how many touches one dive is allowed before
`SwoopMovementGoal.stop()` snaps it back to circling), not in whether the AI finds/dives at all. Not fixed here (D-30/D-305):
whoever owns `07zz1_phantom.js` reads this against `phantomrefcheck --verbose`'s own per-rep printout.

Anti-vacuity (3/3): golden BARE with every logged phantom position pushed 50 blocks away (should never register a touch —
the engine still does); golden WITH_CAT with the BARE case's own close approach spliced in (as if the server's cat-abort had
failed — the engine, correctly wired, still shows none); the engine re-run with the phantom spawned 200 blocks away, outside
`FindTargetGoal`'s own 64-block search (it should never find the bot at all, while the golden still shows a dive every rep).
All three are anchored to the "did a swoop happen" verdict rather than the already-red damage number, on purpose — a break
built on top of a metric that is already failing risks being masked by that pre-existing red rather than actually being
caught (found the hard way running this pack: an earlier hp-based break landed inside the pre-existing tolerance band by
coincidence and had to be redesigned).

**Scope cut, named rather than guessed:** the optional creative-mode lane (a creative bot should never be targeted at all,
`RAM_TARGET_PREDICATE`-style attackable check) is not built — BARE and WITH_CAT already exercise the swoop/circle/cat-abort
AI this pack exists to referee, and a third lane was judged lower value than the time it would cost.

### PLAYER HAZARDS + PLAYER FALLS — the block hazards and client-driven falls on a real survival player (infra I6, s143)

`phazardscen.mjs` / `runphazard.mjs` (port 25673, ~65 s) / `phazardrefcheck.mjs` (stages.d `referee-phazard.json`).
One growbot PLAYER per lane (fresh names each rep — a name that died last run rejoins dead, so the runner also wipes
`world/playerdata`). ⚠ **growbot `confirmTeleports`** (new, additive): a server player's block collisions (magma, campfire,
wither rose, fire block, powder snow) run inside `ServerPlayNetworkHandler.onPlayerMove -> player.move ->
checkBlockCollision`, and onPlayerMove DROPS every Player Position while the join/tp teleport is unconfirmed — so the bot
answers 0x38 with Teleport Confirm and then reports its lane position every 50 ms. Falls are driven by the bot's own
client (vy = (vy - 0.08) * 0.98 per packet, onGround only on the landing packet); the server's fallDistance is what the
client reported. Engine side: the player through 14_player.js's per-tick joins (Physics.tick -> updateArmor ->
pendingFallDamage -> Survival.tick). Hazards judged coarsely both ways; falls exactly (0.01).

First run (25 Sept): 6/19 agree. RED: the player takes NO damage from magma, campfire, soul campfire, wither rose, fire,
lava (with or without Fire Protection), powder snow; Feather Falling IV and Protection IV do nothing on a fall (server
10 blocks + FF IV boots 3.64, engine 7; 23 blocks + FF IV 9.88 vs 19; 23 blocks in Prot IV iron 6.84 vs 19). GREEN: bare
falls 5/10/23, iron armour does not reduce a fall (fall bypasses armour), unlit campfire and plain stone harmless.
Harness fact: a player with stone in its HEAD cell takes ONE suffocation hit and then none — `PlayerEntity.updatePose`
drops it to the swimming ("crawl") pose, whose eye is below the block; the engine's single red there (0 vs 1) is minor.

### PLAYER MELEE — one full-cooldown blow from a real survival player (infra I6, s143)

`pmeleescen.mjs` / `runpmelee.mjs` (port 25675, ~3.5 min) / `pmeleerefcheck.mjs` (stages.d `referee-pmelee.json`). ONE
growbot (`confirmTeleports` + `captureVelocity`; new additive `spawnedIds` = every Spawn Living Entity id in order, so a
sweep scene knows both targets) sends its own Attack packet at a NoAI NBT-summoned target (max health 100) 2 blocks +z,
> 1.5 s after the weapon went in (full cooldown); a crit scene first reports two descending not-on-ground positions.
⚠ Run at MIDNIGHT (`time set 18000`): a NoAI zombie still burns by day and the first run's zombie numbers wobbled by one
point per rep. Engine: `Combat.attack(P, target)` with the weapon in hotbar slot 0, `Hand.attackStrengthTicker` full, the
weapon attribute table bound from `tools/golden/item-attributes-1.18.2.tsv` (the mobpickupcheck recipe).
First run (25 Sept): 21/22 exact — every sword/axe/pickaxe, Sharpness/Smite/Bane (incl. Smite on a pig = no bonus), the
target's own armour, Strength II / Weakness I, crits (x1.5 before the enchant bonus), and the sweep (1 plain, 1 + 0.75 x 7
with Sweeping Edge III, none from an axe). RED: the TRIDENT's melee — server 8.856 (9 damage), engine 0.94 (bare hand): the
trident is not in the item-attribute table at all (its modifiers live in TridentItem's constructor, not a ToolMaterial), so
the engine also swings it at hand speed 4.0 instead of 1.1.

### TAMING — a real player's right-click on 300 fresh wild mobs per scene (infra I6, s143)

`tamescen.mjs` / `runtame.mjs` (port 25677, ~6.5 min) / `tamerefcheck.mjs` (stages.d `referee-tame.json`). growbot's new
additive `interact(id)` = Interact Entity type 0, main hand (a real right-click). Per batch 20 NoAI NBT-summoned wild mobs
on a grid inside the 6-block interact range, 64 of the item in hand, one click each; then owned (`Owner` present), alive,
items used. Engine: `Use.entityUse(P, mob, stack)` on 3000 seeded fresh mobs per scene; the tame RATE by a two-proportion
z-test (|z| > 4.5), items per click and alive-rate exact.
First run (25 Sept): 7/7 GREEN — a guard. Wolf+bone 31.3 % (1/3), cat+cod/salmon ~33 %, parrot+seeds ~10 % (1/10), a
cookie kills every parrot, every click uses one item — including rotten flesh on a WILD wolf (not a tame: it is the
wolf's breeding food, so AnimalEntity.interactMob eats it and sets love mode; the engine agrees).
### MOB DROWNING / AIR SUPPLY (infra W, drown unit, 25 Sept 2026)

`drownscen.mjs` / `rundrown.mjs` (~2 min, own port 25671) / `drownrefcheck.mjs`, golden `drown.json`. 11 scenarios, the
BLOCK HAZARDS pen shape (an AI-on NBT-summoned mob in a 1x1 glass pen) extended one cell taller for a `lid` — floor, feet
cell, head cell, and a sealing glass block over the head so a fully-submerged mob cannot climb out and break the water
column. Both Health and the NBT short `Air` are logged every tick. Vanilla facts, `.decomp` read whole:
`LivingEntity.baseTick` (:328-390) runs the air/drowning step for **every** `LivingEntity`, not only the player —
`getNextAirUnderwater` (:584-587) is `air - 1` (Respiration gives a `random.nextInt(level+1) > 0` free tick instead); at
`air == -20` it resets to 0 and deals `DamageSource.DROWN` 2.0. The gate is `!canBreatheInWater() && !hasWaterBreathing`,
and `LivingEntity.canBreatheInWater()` **defaults to `getGroup() == EntityGroup.UNDEAD`** (:319-321) — not overridden by
`ZombieEntity`/`AbstractSkeletonEntity` — so **undead mobs never drown at all**, full stop, independent of the zombie's
own separate water-to-drowned conversion timer (`ZombieEntity.tick`, `inWaterTime`/`ticksUntilWaterConversion`). Measured
directly (a bare `/summon` + polled `/data get entity`): a submerged zombie's `Air` sits at exactly `300` for 900+ ticks
while `InWaterTime` climbs past 600 and it converts at ~903 — confirms real submersion was detected the whole time, air
just never drains. `DolphinEntity` overrides `canBreatheInWater()` false and `getMaxAir()` 4800 (240 s) — it drowns exactly
like a land mob, only slower. `TurtleEntity.canBreatheInWater()` is true (never drains). `WaterCreatureEntity` (squid,
cod/fish family) keeps its own separate out-of-water air counter (300/-20/2.0, `WaterCreatureEntity`/`FishEntity`), which
is why two of the eleven scenarios put a squid/cod on DRY stone rather than underwater. `AxolotlEntity` is the same shape
again, its own 6000-tick air and a DRYOUT (not DROWN) source.

**First run: 6/11 agree.** Two very different kinds of red, one much bigger than the other:

- 🔴🔴 **The engine has no generic LivingEntity drowning at all.** `pig_submerged`/`cow_submerged`: server 4 hits of 2
  each (dies at tick ~400, `getAir` 300→-19 exactly on the vanilla arithmetic), engine 0 damage — there is no `e.air`
  field, no `getAir`/`setAir`, no -20/DROWN step anywhere for an ordinary land mob (`grep -n -i 'air\b\|drown\|breath'
  src/07*.js src/14*.js` turns up only the type-gated pieces below; nothing generic). `dolphin_submerged` shows the same
  gap for the air FIELD specifically (server 4800→4301 over 500 ticks, no `dolphin.js` module exists at all, `EL.spawn`
  falls back to a bare generic entity with no air of any kind) — Health still coincidentally agrees (500 ticks is not
  long enough to hit -20 on a 4800 budget either side).
- 🔴🔴🔴 **Squid and the whole fish family never tick at all — a much bigger bug than drowning.** `squid_dry`/`cod_dry`:
  server drowns them out of water (4 hits/1 hit of 2 each, matching `Sq.tickAir`/`Fish.tickAir`'s own 300/-20/2.0 numbers
  verbatim), engine 0 damage AND a frozen `squidAir` (300→300, never decremented). Traced past the type check
  (`07i_entitylist.js:1562`/`1566`, `NS.Squid.ready`/`NS.Fish.ready` — true once `Squid.init()`/`Fish.init()` are called,
  which this check's own bootstrap was missing and now does) to the real cause: `EL.tickOne` (`07i_entitylist.js:1719`)
  only calls `EL.tickMob` — the ONLY place `Sq.tick`/`Fish.tick` are ever invoked — when `!!e.ai`, and `e.ai` is attached
  by `EL.spawn` (`:489`) only `if (NS.Ai.ROSTER[name])`. `Ai.ROSTER` (`07k_goals.js:3697` object literal + the
  `Ai.ROSTER.x = Ai.ROSTER.y` aliases below it) has **no entry for `squid`, `glow_squid`, `cod`, `salmon`,
  `tropical_fish`, `pufferfish` or `dolphin`** (turtle and axolotl ARE rostered, which is why they tick correctly).
  Every line in `07zi_squid.js`/`07zj_fish.js` beyond `spawnInit` — swimming, schooling, ink squirt, air, drowning — is
  unreachable dead code for any squid or fish spawned the normal way. Not fixed here (D-30/D-305): this is a roster gap
  in `07k_goals.js`/`07i_entitylist.js`, not a drowning-specific fix, and belongs to whoever owns AI wiring.
- 🔴 **A genuine, separate physics bug in the opposite direction.** `pig_feet_only` (water in the feet cell only, no
  head water, the "no drowning" control): server 0 damage, engine 1 hit of 2 (fall damage, `src: "fall"`, confirmed with
  a standalone repro logging `Combat.hurt`'s call site). A land mob standing in a single water block **porpoises** —
  buoyancy bobs it up past the water's top face and back down onto the solid floor beneath it every so often — and
  `Ph.landed` (`14b_physics.js:705`, called from the fall-distance accrual at `:372`) reads the block "landed on"
  (`blockIdAt(e.x, e.y-0.2, e.z)`) at that moment as the STONE FLOOR, not the water above it, so `FALL_MULT.water = 0`
  (`:702`) never applies and the bob-then-splash counts as a real fall onto stone. The real server does not porpoise
  this way in a single shallow pool.
- 🟢 **zombie_submerged / skeleton_submerged / turtle_submerged / pig_water_breathing** agree — but two of the four for
  the "right" reason (turtle/undead correctly never drown, matched by the engine simply never drowning ANYONE) and one
  (`pig_water_breathing`) for the WRONG one: the server correctly honours Water Breathing (0 damage), the engine also
  shows 0 damage, but only because it never implements drowning at all — this scenario is a **vacuous pass that would
  flip red the moment `pig_submerged`'s gap above is fixed without the effect gate alongside it**, named here so
  whoever fixes the generic drowning step does not ship it without also reading `hasWaterBreathing`.

Anti-vacuity 3/3: a golden series made harmless, the engine's `Combat.hurt` made a no-op, a golden hit amount doubled —
each run against `pig_submerged` (the only scenario with real golden damage to break), so each break is asserted against
an already-red baseline; the phantom pack's own header names the same risk (a break can be masked by a pre-existing
red) — not hit here (all three still flip the comparison), but worth a second scenario with real agreement once the
drowning gap above is closed, so a future break is not silently absorbed by it.

Harness facts, found empirically: `Squid.init()`/`Fish.init()` gate `Sq.ready`/`Fish.ready` and are not called by the
`hazardrefcheck.mjs` bootstrap this file's loader was copied from (that pack never spawns a squid or a fish) — any
future referee that spawns one needs both calls. A mob's `Air` NBT short is read the same way `Health` already is
(`data get storage ... append from entity ... Air`). `/summon ... {ActiveEffects:[...]}` bypasses
`canHaveStatusEffect` entirely — `LivingEntity.readCustomDataFromNbt` (:702-703) loads the list with no gate, which
only exists on the runtime `addStatusEffect` path (:924/941) — so the Water Breathing scenario here uses a real
`/effect give` instead, to measure the normal runtime path rather than the NBT bypass.

`runpcool.mjs` (ATTACK COOLDOWN): one growbot survival player; per scene two NBT NoAI zombies (A at x-2, B at x+1, max health 100),
> 1.9 s so the charge is full, then the packet(s) that empty the cooldown — an Attack on A, a Hand Swing (0x2c: `ServerPlayerEntity.swingHand`
-> `resetLastAttackedTicks`, i.e. a real client's click at the air), or a Held Item Change (0x25: the reset happens on the NEXT player tick,
`PlayerEntity.tick`) — then `gap` ms, the Attack on B. Same-write packets land in one task batch (lastAttackedTicks 0, every rep constant).
`pcoolrefcheck` drives `Combat.attack` / `Hand.swing` (the miss path, 14_player.js:673) / `P.slot`, `Hand.tickAttackStrength` per tick, and
accepts the engine at ANY tick of the scene's window (printed) but wants a partial scene's server blow below a full one. 25 Sept: the
ramp (0.2 + 0.8p^2), enchant x p, crit/sweep gated at p > 0.9 all exact; reds: a swing at the air does NOT empty the engine's cooldown;
a hotbar switch never empties it; and a switch + hit in the SAME tick uses the OLD weapon's attack_damage on the server (the attribute
modifiers only follow the held item at the next LivingEntity tick) — engine uses the new one.

`rungeardrop.mjs` (GEAR DROP): one growbot survival player with Strength 101 (every blow kills, even the 0.04-charge 2nd..20th blow of a
batch) and a netherite sword (Looting 0 / III); 40 batches of 20 NBT zombies (Health 1) wearing the `geardropscen` GEAR list, one Attack
each; dropped gear counted per id; leggings' `Damage` read for 200 kills, boots' tag for the first batch. Counting goes through a
scoreboard: an `execute if entity` that matches nothing sends no RCON reply (10 s timeout). `geardroprefcheck` runs the engine's kill join
(`Combat.attack` -> `Combat.tickEntity` -> `Equip.dropEquipment` -> `EL.dropStack`). 25 Sept reds: Looting's -0.01/level on the drop roll is
missing (0.02 pieces: server 4.6% with Looting III, engine 2.1%); a Curse of Vanishing piece drops (server never); a dropped piece with
chance <= 1.0 comes back brand new (server: random wear, mean ~170 of 225); a dropped enchanted piece loses its enchantments
(EL.dropStack carries id + count only).

### PLAYER HUNGER / EXHAUSTION (infra W, 25 Sept 2026)

`hungerscen.mjs` / `runhunger.mjs` (port 25721, ~30 s) / `hungerrefcheck.mjs` (stages.d `referee-hunger.json`), golden
`player-hunger.json`. ONE growbot survival player (`hg0`, `confirmTeleports` + `captureVelocity`), REPS=1 (every formula
here is pure arithmetic — no RNG — and vanilla hands out no command to reset a player's `foodLevel`, so a second rep would
only carry the first one's leftover hunger forward). Two new additive growbot pieces: `setSprinting()` sends Player
Command (0x1B c2s: entity id, action 3/4) — `PlayerEntity.increaseTravelMotionStats` (.decomp :1478) branches on the
SERVER's own `isSprinting()` flag, not on how fast the Player Position packets move; and Join Game's entity id is now
captured unconditionally (used to send it). 9 scenes, three shapes:
- **jump/move/attack** — exhaustion read before and after ONE action (one jump packet, N one-block Player Position steps,
  one Attack packet on a NoAI zombie). All three stay under `HungerManager`'s own 4.0-exhaustion spend line, so a bare
  before/after delta is exact — nothing else can move the number in that window.
- **regen** — the bot is dented with `effect give ... instant_damage` (`DamageSource.magic`: no armour, no exhaustion of
  its own — `setBypassesArmor()` also zeroes a source's `exhaustion` field, .decomp `DamageSource.java:176`), then left
  to heal. ⚠ Reading health/food/saturation/exhaustion as FIVE separate RCON round-trips (one per field) let the world
  tick between them — caught because the resulting numbers were off by exactly one 4.0-exhaustion/1-saturation spend
  cycle, consistently. Fixed by reading the bot's WHOLE entity NBT in one `/data get entity hg0` (no path) and pulling
  every field out of that one atomic string, plus reading `foodTickTimer` itself (`HungerManager.writeNbt` saves it
  right alongside `foodLevel`) so the engine replay starts its `Survival.tick()` loop from the SAME regen-countdown
  value the server had already reached, rather than needing to land on the same real tick the damage applied on
  (impossible to guarantee over RCON's own latency). The real elapsed tick count is measured with `/time query
  gametime` around the wait, not assumed from the `sleep()` duration.
- **add** (`HungerManager.eat->add`, .decomp :21-30) — ⚠ **not fed via a real Use Item packet.** This protocol's
  serverbound Play packet ids past Interact Entity/Keep Alive/Player Position (the three growbot already had verified)
  are not in `.decomp` (Mojang's mappings do not cover network registration ids), and the one candidate tried (0x2E) does
  not decode as Use Item on this jar — the bot was disconnected outright (`IndexOutOfBoundsException` in the server's
  own frame decoder), logged, not shipped. `add()` is driven instead through `minecraft:saturation`, confirmed
  empirically against this jar to call `HungerManager.add(amplifier+1, 1.0F)` — the exact function every food's `eat()`
  delegates to, just with `saturationModifier` fixed at 1.0 rather than a specific food's (bread 0.6, cooked beef 0.8).
  `nutrition` is still bread's/cooked beef's own hunger-point count (5, 8), so the two scenes still exercise `add()`'s
  two different clamps (food capped at 20; saturation capped at the FOOD level, not 20). **A real per-item
  `saturationModifier` remains untested** — still owed, pending a verified Use Item packet id for protocol 758.

First run (25 Sept): 7/9 agree, anti-vacuity 4/4. Two red:
- 🔴 **Dry-ground walking costs exhaustion in the engine and costs NOTHING in vanilla.** `walk_dry` (5 blocks, on the
  ground, not sprinting, not sneaking): server delta **0** exactly — `PlayerEntity.increaseTravelMotionStats`'s onGround
  branch (.decomp :1478-1489) is a literal `this.addExhaustion(0.0F * (float)$$6 * 0.01F)` for both the plain-walk and
  the sneaking cases, only the SPRINT branch is nonzero (`0.1F * cm * 0.01F`). Engine: `src/14_player.js:516` calls
  `Sv.movement(P, dist, { sprinting: !!P.sprinting, walking: true })` for EVERY on-ground step, sprinting or not, and
  `Sv.movement` (`src/14d_survival.js:442-447`) charges `EX_WALK` (0.01/block, the SAME rate as swimming) whenever
  `o.walking` is true regardless of `o.sprinting` — so dry walking silently costs exhaustion (0.05 for 5 blocks here)
  that no vanilla player ever pays. `EX_WALK`'s own comment (`14d_survival.js:56`) already says "read off
  `Player.checkMovementStatistics`" but transcribed the SWIM rate (0.01) as if it also covered plain walking, which the
  jar gives a separate, zero, coefficient.
- 🔴 **Swimming/touching-water costs slightly more on the server than the engine's own (correct) 0.01/block predicts.**
  `swim_water` (5 blocks, submerged, `Player Position` onGround=false): server delta 0.0516-0.0518 across repeated runs
  (consistent, not noisy), engine 0.05 exactly (`EX_WALK * 5`, matching `PlayerEntity.java:1467-1479`'s own
  `0.01F * cm * 0.01F` formula bit-for-bit). The ~3-4% gap is small, stable across reruns, and this pack could not pin
  it to a specific `src/` line — flagged as a real, reproducible mismatch by this check's own methodology, but lower
  confidence than the walk finding above; worth a second pass with a tick-exact (datapack-logged) trajectory rather
  than sleep-spaced Player Position packets, which the walk/sprint/jump scenes did not need and this one might.

Anti-vacuity 4/4: a golden `jump_sprint` delta +1, the engine's `EX_SPRINT` constant zeroed (`sprint_dry`), a golden
`add_bread_nutrition` saturation +2, and the engine's `eat()` saturationModifier zeroed (`add_beef_nutrition`).

### FEEDING + BREEDING (infra I6, s145)
`runbreed.mjs` FEED: one growbot survival player; per batch 10 NBT NoAI mobs with the scene's Age that it right-clicks (Interact type 0)
and 10 identical CONTROL mobs it never touches — the growUp step is read as SUM(ForcedAge) of the fed mobs (exact), and fed-minus-control
Age only as a sanity figure (summon order skews it by a few ticks). ⚠ Age keeps ticking under NoAI, and toGrowUpAge only changes every 200
ticks, so baby ages sit MID-PLATEAU (-23900 / -1100 / -350; the bucket scene -23790 because it clicks slower): a first run at -24000 read
119 s, not 120 s. Bucket items are re-given one at a time (stack size 1). MATE: two adults summoned with InLove:600 per 3x3 glass pen on a
STONE floor (a baby sheep eating grass grows up 60 s and breaks the invariant), real AI, 14 s; per pen babies and 2*babyAge + parents' Age
(the server reads -36001: the breeding parent has already ticked that tick; the check allows +-1 and says so), plus the XP orb values.
Goat pairs were too slow (2/6 in 14 s) and are left out. `breedrefcheck` drives `Use.entityUse` and `Breed.breed`. `--only <regex>` merges
into an existing breed.json — a full run does not fit one 10-minute call on 2 cores.

### SPRINT KNOCKBACK (infra I6, s145 — three rows added to the KNOCKBACK pack's (B) weapons)
`hand_sprint`, `iron_sword_sprint`, `iron_sword_kb1_sprint` x the 3 targets: the bot sends Client Command START_SPRINTING
(growbot.setSprinting) 100 ms before each rep's blow (a sprint blow ends the sprint server-side). Server: sprint adds one knockback
level at full charge (0.4 -> 0.7 on a zombie; kb I 0.7 -> 1.2). Engine exact on all 9. ⚠ kbrefcheck now charges the engine's attack
(`Hand.attackStrengthTicker = 1000`, the pmeleerefcheck recipe) — without it `full` was false and the sprint bonus never fired (a
harness false red on the first run). Anti-vacuity: the sprint dropped from iron_sword_sprint->zombie must turn red (caught).

### MOB RIGHT-CLICK INTERACTIONS (infra I6, s145)
`runinteract.mjs`: one growbot survival player; per click the inventory is cleared and exactly n of the item put in the main hand,
one Interact on a NoAI NBT mob 4..5 blocks away (⚠ at 2 blocks the bot PICKS UP part of the drops — 55/60 mushrooms on the first run),
then `data get entity br0 SelectedItem` + the `gets` item counted inventory-wide; drops / flag NBT / alive / converted mobs through a
scoreboard. `interactrefcheck` runs `Use.entityUse` with the NBT summon's own defaults restored first (EL.spawn may roll a baby, a
natural wool colour or a jockey saddle — a harness false red on the first run). Wool (1 + nextInt(3)) is compared by mean.
### PLAYER FOOD + STARVATION (infra W, 25 Sept 2026)

`foodscen.mjs` / `runfood.mjs` (port 25851, rcon 26851, ~5 min) / `foodrefcheck.mjs` (stages.d `referee-food.json`),
golden `player-food.json`. Follow-on to the hunger pack above — same growbot, same one-lane shape — but this one eats
for real: `growbot.mjs` gained `useItem(hand=0)`, sending **Use Item (0x2f c2s, protocol 758: Hand VarInt)** — the id the
hunger pack's own note left owed. ⚠ **0x2E is Player Block Placement and disconnects the bot outright** (an
out-of-range/garbage block placement `ServerPlayNetworkHandler.onPlayerInteractBlock` throws on); 0x2f is Use Item,
confirmed empirically (`foodLevel` measurably rises after it — see the smoke check this pack's own commit ran before
trusting it for real). Eating needs the item held through `Item.getMaxUseTime()` — 32 ticks for ordinary food, 40 for a
honey bottle (`HoneyBottleItem.java`'s own override, .decomp) — while the server's `LivingEntity.tickActiveItemStack`
finishes it unprompted; no "release" packet is needed or sent.

⚠⚠ **`/data merge entity <player>` REFUSES** ("Unable to modify player data" — a real vanilla guard, `DataCommand` only
allows `get` on a player, confirmed empirically the first cut of this runner). So unlike every mob-side referee pack,
a player's `foodLevel`/`Health` cannot be poked directly to set up a scene: every pre-state here is reached with real
game mechanics — `sprintBurn()` (bouncing the bot back and forth across a short lane, since a first cut sent it 2400
blocks in a straight line off the edge of a narrow platform and the server removed it — "No entity was found" on every
read after, logged so it is not retried) spends exhaustion through `PlayerEntity.increaseTravelMotionStats` the same
way the hunger pack's own `add` scenes did, and spaced `effect give ... instant_damage 1 0 true` hits (6 damage each,
non-undead, amplifier 0) reach a starting health near whatever edge a scene is testing. ⚠ **Every eat scene needs its
own short burn first, even the ones not testing exhaustion**: a fresh spawn is always at `foodLevel` 20, and
`HungerManager.isNotFull()` (`Sv.canEat` mirrors it) refuses to let a player eat ANY non-`alwaysEdible` food at full
hunger — confirmed the hard way when the first full run came back with every single "eat" scene a server-side no-op
(`postFood === preFood` for bread!) before this burn was added.

10 eating scenes (nutrition/saturationModifier straight out of `FoodComponents.java`, .decomp, never re-derived):
bread (5/0.6), cooked beef (8/0.8), golden carrot (6/1.2, alone among these NOT alwaysEdible and — the recorded
pre-state happened to already be at full food — the one scene this pack could not actually exercise a real eat on, a
runner limitation flagged plainly rather than hidden), cookie (2/0.1), beetroot soup (6/0.6, returns a `bowl`), honey
bottle (6/0.1, returns a `glass_bottle` AND unconditionally cures POISON — `HoneyBottleItem.java:29-31`), raw chicken
(2/0.3 + 30% HUNGER, id 17, 600 ticks — 15 reps), rotten flesh (4/0.1 + 80% HUNGER — 15 reps), golden apple (4/1.2 +
REGENERATION II/100t + ABSORPTION I/2400t, both unconditional), spider eye (2/0.8 + 100% POISON, id 19, 100 ticks).
Plus 4 starvation scenes (food floored at 0 by one big burn on the FIRST scene only — food is never eaten again after
it, so all four CHAIN off the same floored state and real damage, never a number this file invented): `starve_cadence`
watches the raw 80-tick/1.0-damage cadence from near-full health; `starve_easy_floor`/`starve_normal_floor` ride that
same descent onto each difficulty's own floor (`health > 10` on EASY, `health > 1` on NORMAL, both checked BEFORE the
hit — so the real floor is "one hit below the threshold", not the threshold itself, e.g. easy settled at 9.23, not
10.0); `starve_hard_kills` needs no setup hit at all — HARD's gate is unconditional, so the very next 80-tick cycle
from ~1 hp kills it outright.

⚠⚠ **THE HEADLINE FINDING: eating is not wired in this engine at all.** `14l_use.js`'s own `Use.OWED` list names it —
"eating, and the three-tick use-item hold that drives it — G19d" (`14l_use.js` ~line 93) — and `Use.rightClick`
(`14l_use.js:902-967`) never once branches on a food item: no UseAction dispatch, nothing spends `P.food`/`P.saturation`
from a held item, no container swap, no status effect. `Survival.eat` (`14d_survival.js:187`) — the exact
`HungerManager.add` arithmetic — exists and is correct (this pack's own `math` diagnostic replays it from the server's
recorded pre-state for every scene except `eat_honey_bottle`/`eat_golden_carrot`, both skipped for a stated reason —
see `foodrefcheck.mjs`'s own `MATH_SKIP` comment — and every other one agrees exactly), but grepping every call site in
`src/` finds exactly ONE caller: `07q_effects.js:177`, the hunger pack's own `minecraft:saturation` stand-in — never an
item-use path. So `foodrefcheck` judges TWO things per scene: `join` (drive the REAL right-click join,
`Use.rightClick`) and `math` (is `Sv.eat`'s formula itself right, seeded from the server's own numbers). Every `join`
scene is RED today — food/saturation/inventory/status-effects all unchanged where the server changed all four — which
is the correct, expected shape of this finding, not a check bug: a red here is direct engine-behaviour evidence that
G19d has not shipped, the same way a stage marked owed in `docs/PLAN.md` is not itself a bug report.

One structural `WIRE` assertion (re-reads `src/` from disk, not the loaded module, so the anti-vacuity break below
actually exercises it): confirms `Sv.eat`'s only caller is `07q_effects.js:177` and that `14l_use.js` still lists
eating as owed — if this ever goes green on its own, G19d shipped and every `join` red above is stale, not a fresh bug.

First run (25 Sept): 14 scenarios, 2 structural checks (WIRE + per-scene math) — 16 `join`-family reds (10 eat/food
deltas + 2 container swaps + 1 poison-cure + 2 probabilistic-effect z-tests + 3 deterministic-effect mismatches, the
exact count `foodrefcheck.mjs` prints), 8 `math` assertions agree, 4 starvation assertions agree, WIRE agrees.
Anti-vacuity 4/4: a golden `starve_cadence` `postHealth` +5, the engine's `Sv.STARVE_TICKS` set to 4 on `starve_cadence`
(⚠ NOT on a floor scene — `starve_easy_floor`/`starve_normal_floor` plateau at the SAME floor value however fast the
timer runs, so a break there proves nothing; found writing this anti-vacuity block, not guessed), a golden
`eat_cooked_beef` `postSaturation` +3, and the engine's `Sv.eat` `saturationModifier` zeroed on `eat_bread`.

**Still owed**: a real per-item Use Item join in `14l_use.js` (G19d itself — out of this pack's own scope, `src/` is
never touched here); `eat_honey_bottle`'s recorded `postSaturation` (0.2) is 1.0 short of the formula's own 1.2 — a
single stray exhaustion-spend crossing from exhaustion left over BETWEEN scenes (`/effect clear` never resets
`foodExhaustionLevel`, and nothing in this runner does either) rather than a bug in the formula itself, flagged in
`foodrefcheck.mjs` and skipped from `math` rather than silently miscounted as a formula error; `eat_golden_carrot`
never got a real eat (see above) — a longer burn or a purpose-built low-hunger lane would fix both in a follow-on pass.

### BUCKETS AT A BLOCK (infra I6, s146, 25 Sept 2026)

`runbucket.mjs` stands one growbot at (0.5, F, 0.5), `/tp ... 0 90` (vanilla pitch 90 = straight down), rebuilds a 5x5 stone box
under it per click, sets the scene's cells, gives n of the item and sends ONE Use Item packet (0x2f): `BucketItem.use` does its
own raycast from the eye (SOURCE_ONLY for an empty bucket, NONE for a full one), so the server decides which cell the click
means. Measured per click: the main hand, `gets` items anywhere in the inventory, `execute if block` predicates, entities.
`bucketrefcheck` drives the engine's whole join the same way: the real `NS.Player` (14_player.js) at the same spot with engine
pitch -PI/2, `P.retarget()` (the crosshair ray, 14c_raycast.js), `Use.rightClick(P)`. It never calls `Use.itemUseOn` on a
hand-picked cell — that is exactly the shortcut that hid finding 1 below.
Harness facts: lava poured at the bot's own feet killed it once in 3 reps (an empty main hand) — every click now gives fire
resistance + instant health first; an un-sourced flowing water cell dries up on the server by fluid ticks the engine harness
doesn't run, so that scene judges only the hand/inventory; the bot "standing" on water/powder snow is not kicked for flying
(the floating test sees a non-air block within 0.55 below the feet).
Findings (s146, all red in `bucketrefcheck`): (1) an EMPTY bucket never picks anything up in the live game — the crosshair ray
(`Ray.targetable`, 14c_raycast.js:29-35) skips every fluid block, so `Use.itemUseOn`'s `bucket` branch (14l_use.js:576-583)
only ever sees the block BEHIND the water; vanilla re-casts SOURCE_ONLY (the spawn-egg path at 14l_use.js:756-757 already does
this); (2) a waterlogged slab and powder snow are not drainable (FluidDrainable) — no water_bucket / powder_snow_bucket;
(3) filling from a stack replaces the whole stack (`Use.swapHeld`, ItemUsage.exchangeStack keeps n-1 and adds the output);
creative adds the output to the inventory when absent; (4) a water bucket on a bottom slab pours water ABOVE it instead of
waterlogging it (FluidFillable); (5) a cod bucket does nothing (no EntityBucketItem for fish); (6) an axolotl bucket releases
the axolotl but places no water. Exact already: water/lava poured on stone, lava on a slab (no waterlogging with lava),
creative pour keeps the water bucket.

### USE ON A BLOCK (infra I6, s146, 25 Sept 2026)

The BUCKET harness with `--pack useon` (useonscen.mjs): the growbot sends what a real client sends for a right-click on a block,
Player Block Placement (0x2e, `growbot.useOnBlock`, new and additive: Hand, packed Position, Face, cursor floats, inside=false)
at (0, F-1, 0) face UP, cursor (0.5, 1, 0.5); the glass bottle scene sends Use Item (its own SOURCE_ONLY raycast). The engine
side is the same `P.retarget()` + `Use.rightClick(P)` join. Held keys carry the tool's Damage (`@1`).
Findings (s146, red in `useonrefcheck`): (1) 🔴 PLACING A BLOCK IN SURVIVAL NEVER SPENDS IT — `P.placeBlock` (14_player.js
1133-1220) sets the block and never shrinks the held stack (torch x4 stays x4, oak slab x4 stays x4; vanilla BlockItem.place
decrements unless creative); (2) a shovel on a lit campfire does nothing (vanilla: extinguished + 1 damage; ShovelItem.useOnBlock);
(3) shears on a pumpkin do nothing (vanilla: carved_pumpkin facing the player's opposite horizontal facing, 4 seeds, 1 damage;
PumpkinBlock.onUse); (4) a glass bottle never fills from water — the same fluid-skipping crosshair as the bucket pack's finding 1.
Exact already: hoe tilling (dirt/grass -> farmland, coarse -> dirt, creative no damage), shovel paths, axe stripping (axis kept),
wax scraping and one oxidation step back, honeycomb waxing, flint and steel on stone/TNT/an unlit campfire, torch and slab-on-slab
placement (the block half), a block refused in the player's own cell.

### BLOCK USE (infra I6, s146, 25 Sept 2026)

Same harness (`--pack blockuse`, blockusescen.mjs), mostly an EMPTY hand (item 'air'), Player Block Placement on the block's top
face. Drops are not judged: the bot one block above picks some up inside the 0.4 s. §2 is engine-only: vanilla's container
blocks open their screen on a plain right-click (not an NBT change the server can report), so the check counts calls into a
stub `Hud.openChest` through the same join; the crafting table is the control row (it opens).
Findings (s146, red in `blockuserefcheck`): (1) 🔴 CHESTS, TRAPPED CHESTS, BARRELS, ENDER CHESTS AND COMPOSTERS CANNOT BE
RIGHT-CLICKED — `Use.blockUse` asks `isBlock(state, 'chest')` etc. (14l_use.js:219-220, 263), but `isBlock` reads the private
`id` map that 14l_use.js:145-149 fills from a fixed name list which lacks chest/trapped_chest/barrel/ender_chest/composter, so
the comparison is `S.block[state] === undefined` — always false (confirmed in the built game: a chest placed by the real
placement path does nothing on right-click; a crafting table opens); (2) note block pitch doesn't cycle; (3) daylight detector
doesn't invert; (4) creative can't eat cake (vanilla: `canConsume` is true for invulnerable abilities); (5) cauldrons: a water
bucket, an empty bucket and a glass bottle do nothing (CauldronBehavior); (6) a flower pot takes no flower.
Exact already: lever, stone button, wooden trapdoor (and iron refusing a hand), fence gate, repeater delay 1->2 and 4->1,
comparator mode, cake refused at full hunger in survival.


### ITEM USE — spawn eggs + bone meal (infra W, 25 Sept 2026)

The BUCKET harness with `--pack itemuse` (itemusescen.mjs): the growbot at (0.5, F, 0.5) looking straight
down, target cell (0, F-1, 0), face UP. Spawn eggs go through Player Block Placement (`via: 'block'`,
`SpawnEggItem.useOnBlock`) except one Use Item scene (`via: 'item'`, the SOURCE_ONLY water raycast).
Bone meal is judged the same way as USE-ON-BLOCK's tools: `BoneMealItem.useOnFertilizable` decrements the
stack whenever the target `isFertilizable`, REGARDLESS of whether growth actually happens — a SEPARATE
random roll (`CropBlock.canGrow` is always true, `getGrowthAmount` is uniform 2-5; `SaplingBlock.canGrow`
is a 45% roll, `generate` at stage 0 is then deterministic). `prob: true` scenes are compared with a
binomial tolerance (`tolFrac`, bucketrefcheck.mjs), not exact fraction equality. A spawn egg on a
mob_spawner reads the block entity's assigned mob (`spawner: true` scenes; SpawnData carries no vanilla
block-state property, so it is read via a dedicated readout, not the `test` block-predicate mechanism).
Findings (infra W, red in `itemuserefcheck`): (1) 🔴 BONE MEAL DOES NOTHING — nothing in `14l_use.js`
answers `bone_meal` at all (no `BoneMealItem`/`Fertilizable` join exists for a player's own right-click;
the only bone-meal code in the engine is `07zv_villagerbrain.js`'s villager-only `BoneMealTask` port,
which does not share a `Fertilizable` substrate anything else could reuse): wheat at age 0 never grows
(`bonemeal_wheat_age0`, `bonemeal_creative_wheat0`) and an oak sapling at stage 0 never advances
(`bonemeal_sapling_stage0`) — in every case the stack is not spent either, since nothing reaches
`isFertilizable`. (2) [s147 merge: NOT an engine bug] the worker's
zombie-egg red was the harness — runbucket's server is PEACEFUL and `MobEntity.checkDespawn` discards the
zombie on its first tick, while the engine side stubbed NS.Diff to normal and never ticked; the engine owns
the same rule (`Spawn.despawnTick`, 07l_spawn.js), so bucketrefcheck now runs one despawn pass on peaceful
after an itemuse click, and `egg_zombie_on_stone` is green. Pig and cow are unaffected, matching vanilla. Exact already: a spawn egg on stone (survival spends it, creative does not),
on a spawner (assigns `SpawnData` without spawning, survival spends it, creative does not), through Use
Item into water (SOURCE_ONLY raycast spawns in the water); bone meal on already-mature wheat and on stone
(vanilla does nothing either way, and neither does the engine — not spent).

### BLOCK PLACEMENT STATE (infra I6, s146, 25 Sept 2026)

`runplace.mjs` (placescen.mjs): the growbot at (0.5, F, 0.5) is /tp'd with the yaw/pitch of the exact eye->click-point vector and
sends one Player Block Placement on either the north face of a stone at (0, F, 2) (cursor height cy: 0.25 / 0.5 / 0.75) or the
floor's top face at (0.5, F, 2.5); every property of each landing cell is read back with one `execute if block` per value (the
property lists from .mcdata/pc/blocks.json), so the golden is the full state string. `placerefcheck` aims the engine's real player
along the same vector (engine yaw = atan2(dx, -dz), pitch = atan2(dy, horizontal)), asserts its crosshair hits the scene's block
(a harness-aim guard), then `Use.rightClick(P)`. Harness fact: the headless World stub's `setBlock` MUST return true —
`P.placeBlock` does `if (!World.setBlock(...)) return false` and only writes a door's/bed's second cell after it (a stub returning
undefined showed a false "door has no upper half" red; the built game places both, checked in the browser).
Findings (s146, red in `placerefcheck`, the player facing SOUTH): on the floor, stone_button / oak_fence_gate / grindstone / bell
face NORTH in the engine (vanilla: the player's own facing, south); observer faces north (vanilla: south — it faces the look
direction); hopper ignores the clicked face (vanilla: the opposite of the side clicked, DOWN on a floor); a standing sign gets
rotation 0 (vanilla 8 = the player's yaw + 180, in 16ths); anvil faces north (vanilla: the player's facing rotated clockwise,
west); end rod on the floor faces north (vanilla: the clicked face, up); a vine on a side face attaches to nothing (vanilla:
south=true — the face it was put against). The `_east` copies (22 facing-dependent scenes turned to face east) repeat every
one of those and add: a rail placed facing east is still north_south (vanilla: east_west — AbstractRailBlock takes the player's
facing axis). Exact already: stairs (facing + half from the click height), logs/pillars/chains
(axis from the face), slabs (top/bottom from the click height), wall vs floor torch/sign, wall button/lever/ladder/grindstone,
furnace/chest/piston/dispenser, door (both halves + hinge), bed (both parts), rail, carved pumpkin, trapdoors, lantern.

### SHEEP EAT GRASS (infra W, 25 Sept 2026)
`runsheepgrass.mjs`: no growbot needed — entity AI ticks under a plain `/forceload`, the same fact `runbreed.mjs`'s
own MATE pens already rely on. Two PHASES on the one server: PHASE1 (`mobGriefing` true) runs `adult_grass_block`
(120 sheared adults on grass_block, 1-wide stone pens), `adult_grass_plant` (80, a `minecraft:grass` plant at the
feet cell instead), `baby_grass_block` (60 babies, Age -24000) + `baby_control` (60 babies on dirt, never eat — a
fed-minus-control baseline for the +1200-tick `growUp(60)` boost), and `adult_no_grass` (40, plain dirt, an exact
zero); PHASE2 (`mobGriefing` false) runs `adult_griefing_off` (100, grass_block). Per checkpoint (50 ticks to 700):
a `scoreboard players operation ... one` SUM gives the eaten count (`Sheared:0b`, the same per-tag SUM trick
`runbreed.mjs`'s own FEED loop uses), and a `fill ... minecraft:glass replace minecraft:dirt` / restore swap-read
(`rungrowth.mjs`'s own technique) gives the grass_block->dirt count on the three CONVERTIBLE scenarios.
`sheepgrassrefcheck` drives the engine's own `Passive.EatGrassGoal` directly, one instance per sheep (exactly
`passivecheck.mjs` §10's own shape: `canUse()`/`start()`/`tick()`/`canContinueToUse()`/`stop()`, driven by hand the
way a `GoalSelector` would), on a 4000-sheep synthetic flock per scenario — `canStart`'s roll is a per-tick
Bernoulli draw (p=1/1000 adult, 1/50 baby), so every rate is compared against the server's own observed rate by an
exact two-sided binomial test (P < 1e-5 fails, `mobrefattrcheck.mjs`/`hurtrefcheck.mjs`'s own threshold); the
"never eats on dirt" and "mobGriefing=false never converts the block" facts are exact (0 tolerance — vanilla does
not roll a dice for those; `EatGrassGoal.tick()`, .decomp, gates the block edit on the gamerule but calls
`mob.onEatingGrass()` UNCONDITIONALLY either way — the wool-regrow/baby-growth callback is NOT itself gated).
Anti-vacuity (D-30/D-305), 4 breaks: `Passive.EAT_GRASS_ADULT_ROLL` moved to 1e9 (canUse never fires),
`Passive.EAT_GRASS_TRIGGER` moved to -1 (the edit + callback never fire), `adult_griefing_off` re-run with the
gate forced true, and `Breed.ageUp` no-op'd (the growth boost never applies) — all 4 caught.
⚠ FINDING (first real run, 25 Sept 2026): the engine eats grass roughly 1.7-2x FASTER than the real server at
every checkpoint, both adult and baby (e.g. `adult_grass_block`@700: server 27.0% (81/300), engine 49.6%
(1985/4000); `baby_grass_block`@700: server 72.0% (108/150), engine 100% (4000/4000)) — a genuine engine-vs-
vanilla mismatch in `Passive.EatGrassGoal.canUse`/`tick` (src/07w_passive.js:262-301), left red per this doc's
own "mismatches are findings" charter; not chased further here (`canStart`'s own roll and `MAX_TIMER`/trigger
math were unit-verified real, `passivecheck.mjs` §10, so the gap is in something this pack's own harness cannot
see, e.g. real goal-selector contention this project's `07k_goals.js` does not reproduce). ⚠ CAVEAT: the
`babyGrowth` red (server mean Age delta 1637, engine 1200) is partly a HARNESS artifact, not a second finding —
the server's own sheep share an open corridor and can WANDER to a fresh grass_block cell after eating their own
(so one baby can rack up more than one +1200 `growUp` over 700 ticks), while `sheepgrassrefcheck.mjs` gives each
synthetic sheep its own isolated, un-refillable cell (one eat, ever) for simplicity — the EATEN-flag rate finding
above does not share this confound (`Sheared` is a one-way flag), only this one averaged-delta readout does.


**Mining — the left-click join (`runmine.mjs` / `minerefcheck.mjs`, golden `mine.json`; scenes `minescen.mjs`).** infra I6, s147, 25 Sept 2026.
The growbot stands at (0.5, F, 0.5) looking straight down and sends Player Digging (0x1a, `growbot.dig`) START then STOP back to back.
Vanilla's server then does the timing itself (.decomp ServerPlayerInteractionManager: STOP with `delta*(ticks+1) < 0.7` sets
`failedToMine`; `update()` breaks the block on the tick `continueMining >= 1`), so `k` = gametime from START to air is the server's own
ceil(1/delta) - 1 (0 for >= 0.7). The RCON read of the start tick lands one between-tick window either side (stone/iron pickaxe read 6,7,8
for a true 7), so the check takes the median of 3 reps and allows 1 tick. The engine side is the real join: `P.retarget()` then
`P.act(0.05)` per tick with a stub NS.Input's left button held, the tool a real hotbar stack with `t.Enchantments`, effects through
`Effects.addStatusEffect`; judged: ticks, the main hand after (id x count @ damage; not for a bare hand — the server bot's empty hand
picks its own drop up), and `P.lastDrops` per break. 4 breaks (golden k +3, P.act no-op, a golden drop zeroed, a golden wear undone).
First run: 7/21 — timing is exact for every plain tool/block pair (dirt 15, stone by hand 150, wooden pick 23, iron pick 8, stone pick
on iron ore 23, silk-less glass 9, cobweb by sword 8, log by axe 10) and the harvest refusals (stone/glass by hand, iron ore by wooden pick)
drop nothing, as vanilla. Reds (all FINDINGS, engine side): (1) **no tool ever wears when mining** — `P.breakBlock` (src/14_player.js
840-900) has no `ItemStack.postMine` (tools 1, swords 2, nothing for a hardness-0 block, nothing in creative); (2) **Efficiency, Haste and
Mining Fatigue never reach the break** — `P.miningContext` (14_player.js:822-829) reads `P.efficiency/haste/fatigue`, which nothing
assigns (07d_mining.js's formula itself is right); (3) **Silk Touch never reaches the drops** — the context carries no `enchants`/
`silkTouch` (glass drops nothing, diamond ore drops a diamond); (4) **a sword breaks blocks in creative** — vanilla SwordItem.canMine
is `!player.isCreative()`; `Gamemode.mayBreak` (14e_gamemode.js:90) never asks the item.

**Idle wander — the goal-selector start rate (`runwander.mjs` / `wanderrefcheck.mjs`, golden `wander.json`; `wanderscen.mjs`).** infra I6,
s147, 25 Sept 2026 — the second, independent measurement behind the sheep-grass pack's finding 6. Vanilla MobEntity.tickNewAi
(.decomp MobEntity.java:688-693) evaluates goal canStart only on EVEN ticks, so a `chance`-N goal starts at about half the rate a
per-tick roll gives. One stone pen per sample (the runpanic.mjs datapack harness, Pos logged every 2 ticks), the mob alone,
persistent, no player, stone floor (nothing to eat). Walks = moving (> 0.02 b per 2 ticks) after >= 3 still samples. First run:
server cow 4.86, pig 5.17, chicken 5.47, sheep 5.42, iron golem 2.42 walks/1000 ticks; engine 6.54, 8.72, 9.23, 8.07, 5.29 — every
goal-selector mob x1.3-2.2 too restless and its first walk ~2.5-5x sooner (server ~140-220 ticks, engine ~45-60) — while the villager,
whose strolls are Brain tasks, is the one mob NOT faster (7.27 vs 6.26). Red at Poisson z > 4 and a ratio outside 0.8-1.25: pig,
chicken, iron golem (cow/sheep x1.35/1.49 at z < 4 with 18 server runs). Harness caveat: ~1/3 of the server logs stop mid-rep (the
mob's `@e[tag=..]` stops matching on a loaded 2-core server — not RCON, the reads are complete; not reproduced with 10 pens and
no load); the rate counts logged samples only. 3 breaks. Engine ~4 s; server ~3.5 min.

### PLAYER POTIONS (infra W, 25 Sept 2026)

`potionscen.mjs` / `runpotion.mjs` (port 25852, rcon 26852, ~2 min) / `potionrefcheck.mjs` (stages.d
`referee-potion.json`), golden `player-potion.json`. Follow-on to the PLAYER FOOD pack above — same growbot, same
one-lane shape, the SAME `useItem(hand=0)` (Use Item, 0x2f c2s) — but this one drinks: `PotionItem`/`MilkBucketItem`
both override `getMaxUseTime()` to the same 32 ticks ordinary food uses (`UseAction.DRINK`, .decomp, both classes read
in full) — no 40-tick honey-bottle-style exception for potions or milk. `/data merge entity <player>` is refused
outright on a player (the food pack's own guard, re-confirmed) — the healing/harming scenes reset to full HP each rep
with a massively-amplified `instant_health` (amplifier 10, the same technique `runhunger.mjs`/`runphantom.mjs` already
use) rather than a data merge, then reach their own pre-state with real `instant_damage` hits.

10 scenarios x 3 reps, every number read off `.decomp/net/minecraft/{item/{PotionItem,MilkBucketItem},potion/Potions,
entity/effect/StatusEffects}.java` (never re-derived): `drink_healing` (instant_health, amplifier 0, heals
`(int)(1.0*(4<<0)+0.5)=4` from a reduced 14 hp), `drink_harming` (instant_damage, `6<<0=6` damage from full health),
`drink_regeneration` (id 10, 900 ticks, amp 0), `drink_poison` (id 19, 900 ticks, amp 0), `drink_strong_poison` (id 19,
432 ticks, amp **1**), `drink_long_swiftness` (id 1, 9600 ticks, amp 0), `drink_night_vision` (id 16, 3600 ticks, amp
0), `drink_water` (`Potions.water` carries NO effect instances at all — still runs the full bottle-swap, the pack's own
"no effect, still drunk" control), `drink_water_creative` (creative gamemode — `PotionItem.finishUsing`'s own
`!creativeMode` gate means the stack comes back UNCHANGED, still a potion, no glass bottle), and
`drink_milk_while_poisoned` (`MilkBucketItem.finishUsing` calls `clearStatusEffects()` unconditionally — ALL effects,
not just poison, no `curesPoison`-style single-effect gate the way `HoneyBottleItem` only removes POISON). Every
non-creative, non-water scene leaves a `glass_bottle` behind in survival; milk leaves a `bucket`. Hunger/saturation
were recorded on every scene and never moved (drinking does not touch them, confirmed against the server, not assumed).

⚠⚠ **THE HEADLINE FINDING: drinking is not wired in this engine at all — the same shape as the FOOD pack's finding.**
`Use.rightClick` (`14l_use.js:902-967`) has no dispatch for a `potion` or `milk_bucket` item at all. Unlike eating,
this engine DOES already have the full formula machinery for potion effects — `Effects.applyInstantEffect` /
`Effects.addStatusEffect` (`07q_effects.js`), used for real by splash/lingering potions (`07z_potion.js`), tipped
arrows (`14j_combat.js`), raid Bad Omen, puffer fish, cookies, and even the wandering trader's OWN milk drink
(`07zt_wtrader.js:222-223`, the exact `e.effects={}` primitive `MilkBucketItem.finishUsing` uses) — just never reached
from a PLAYER right-clicking a held potion or milk bucket. `14l_use.js`'s own `Use.OWED` list still names "eating, and
the three-tick use-item hold that drives it — G19d" (~line 93): the SAME missing use-item-hold/`finishUsing` dispatch
blocks both eating and drinking: this pack does not add a second OWED entry, it shows drinking already lives inside
that one. So `potionrefcheck` judges TWO things per scene: `join` (drive the REAL right-click, `Use.rightClick`) and
`math` (are `Effects.applyInstantEffect`/`addStatusEffect` themselves right, seeded from the server's own numbers).
Every `join` scene except `drink_water_creative` is RED today (health/effects/inventory all unchanged where the server
changed them) — `drink_water_creative` is excluded from `join` scoring the same way `foodrefcheck.mjs` excludes
`eat_golden_carrot`: the server's own observable state does not change either (full health, no effect, same item), so
there is no server-acted/engine-acted contrast left to score.

One structural `WIRE` assertion (re-reads `src/14l_use.js` from disk, not the loaded module, so the anti-vacuity break
below actually exercises it): confirms `14l_use.js` calls neither `Effects.addStatusEffect` nor
`Effects.applyInstantEffect` anywhere (no player-drink dispatch exists) and still lists the use-item-hold gap as owed —
if this ever goes green on its own, G19d shipped for drinking and every `join` red above is stale, not a fresh bug.

First run (25 Sept): 10 scenarios — 9 `join`-family reds (2 instant-effect deltas + 5 live-effect presences + 1 bottle
swap + 1 poison-cure, the exact count `potionrefcheck.mjs` prints; `drink_water_creative` excluded from scoring), 8
`math` assertions agree (2 instant-effect formulas, 5 live-effect duration/amplifier pairs, 1 milk clear), WIRE agrees.
Anti-vacuity 4/4: a golden `drink_healing` delta forced to +99, a golden `drink_strong_poison` duration forced to 1, the
engine's own `Effects.applyInstantEffect` healing branch corrupted in memory, and the WIRE substring predicate run
against a mutated copy of `14l_use.js` with the OWED phrase stripped out — all four caught. Engine ~1 s; server ~110 s.

## Hurt window (infra I6, s149)

`LivingEntity.damage`'s half-second grace (.decomp LivingEntity.java:1059-1069): while `timeUntilRegen > 10` a new
hit lands only its EXCESS over `lastDamageTaken`, then `lastDamageTaken = amount` (the full new amount) and the
window is NOT reset; otherwise the hit is fresh (full damage, window back to 20). The server answers identically
for a player and a mob: 2nd hit 9 ticks later = in-window, 10 ticks later = fresh; 6/12/12 two ticks apart = 12.
The engine's mob path (`Combat.hurt`) matches all 12 scenes; the PLAYER path (`Survival.hurt`, 14d_survival.js
:244-262) uses the whole 20-tick countdown as the window (`invulnerable > 0`, not `> 10`) and stores the excess as
`lastHurt` — 5 red rows (inc2eq/inc10/inc11/inc15/dec15).
Harness fact: every hit, the first included, goes through `schedule function` — an RCON-issued command runs between
ticks and a scheduled one at the start of a tick, and mixing them shortened the first gap by one tick.

## Despawning (infra I6, s149)

`MobEntity.checkDespawn` + the despawnCounter bumps (.decomp MobEntity.java:655-683, HostileEntity.java:43-48,
RaiderEntity.java:112-114) against `Spawn.despawnTick`: all 23 lanes agree — the 128 instant band (monsters and
bats gone at t5, animals/chicken/villager kept), the 32 band, the >600 idle gate + 1/800 roll, pillager's +2 always,
and the light edge (light 12 counts +3, light 11 +1: survivors 21 vs 33 of 36 at t700).
Harness facts: all summons of a round come from ONE datapack function (one tick); mobs sit on cell centres
z -3.5..4.5 (a mob at 4.75 overlapped the wall, suffocated, and every hurt resets the counter); no iron golem
(1.4 wide in a 1-wide tunnel it suffocates by t1000).


## RAIDS (wave composition per difficulty)

`raidscen.mjs` / `runraid.mjs` (port 25861, rcon 26861) / `raidrefcheck.mjs` (stages.d
`referee-raid.json`), golden `raid-waves.json` (optional). Compares `src/07s_raid.js`'s `Rd.getCount`/
`Rd.getBonusCount`/`Rd.MAX_WAVES`/`Rd.MEMBERS`/`Rd.CAN_LEAD`/`Rd.ravagerPassengerType` against
`.decomp/net/minecraft/village/raid/Raid.java` (`getMaxWaves`:764-774, the five `Member` enum
constants, `getBonusCount`:702-726, `spawnNextWave`'s ravager-passenger branch:504-514) and
`RaiderEntity`/`WitchEntity`/`RavagerEntity`'s own `canLead()` overrides.

Two layers need no live server at all and are the check's real teeth: TABLE (every constant
table diffed line-for-line against `.decomp`) and DIST (`Rd.getBonusCount` driven through its own
`randInt` hook thousands of times per case, checked against probabilities derived analytically
from `Raid.java:702-726`'s own branches). Both are green today, and the anti-vacuity block proves
each one catches a real corruption of the engine's own tables/functions (4/4 breaks caught).

A third, GOLDEN layer cross-checks real per-wave raider counts against `Rd.getCount`'s own
support range when `runraid.mjs`'s golden is present — SKIPPED, not failed, when it is absent
(the same D-30/D-305 contract `potionrefcheck.mjs` already uses).

**Finding, not an engine bug:** the `/raid` debug command (`RaidCommand.java`: start/stop/check/
setomen/glow/spawnleader) is never registered by `CommandManager.java` on the real 1.18.2
dedicated server — confirmed empirically (`raid`, `raid start 1`, `help raid` all "Unknown or
incomplete command" from a level-4 rcon console) and then by its absence from
`CommandManager.java`'s own registration list. `runraid.mjs` uses the REAL trigger instead — a
placed bed, a summoned villager that claims it (`Brain.memories."minecraft:home"`, confirmed via
`/data get`), then `/effect give <bot> minecraft:bad_omen` — exactly the path
`StatusEffects.java:94-107` reads (`isNearOccupiedPointOfInterest` then `RaidManager.startRaid`).

**Still owed:** a full real-server golden (all four scenarios in `raidscen.mjs`, several reps
each) was not collected this session — the bed+villager+Bad-Omen trigger was verified end to end
against `.decomp` and the POI claim itself was confirmed live (`Brain.memories."minecraft:home"`
populates within a couple seconds), but the raid itself did not spawn within this session's
available server-run time budget (each tool call in this environment is capped and a background
server process does not survive between calls, so a raid's own real-time waits — a 15 s
`preRaidTicks` countdown per wave, several waves per raid, several reps per difficulty — could
not be run end to end here). `runraid.mjs` is complete and takes `MCLITE_RAID_ONLY`/
`MCLITE_RAID_REPS_CAP`/`MCLITE_RAID_HOME_WAIT_MS`/`MCLITE_RAID_TRIGGER_WAIT_MS` env overrides for
a bounded run; the next session that can run it uninterrupted for several minutes should get a
real golden and re-run `raidrefcheck.mjs` to light up the GOLDEN layer.

s149 (infra): the golden was collected in the cloud container (10 raids: easy x3, normal x3, hard x2, normal Bad Omen II
x2; two runs merged) after two harness fixes — the one 3216-block `/fill` floor exceeded /fill's 32768 limit and built
nothing (the bed floated, the villager fell and never claimed it), and the console's `distance=..80` was measured from
the world spawn, not the rep's spot. The GOLDEN layer's support is now the engine's own (Rd.getCount + both ends of
Rd.getBonusCount + ravager riders via Rd.ravagerPassengerType): all 250 per-wave counts agree with the server.

## Mob spawner (infra I6, s150)

`runspawner.mjs` builds 9x9x4 rooms (floor Y-2, walls +-5, sealed rooms roofed) around real `minecraft:spawner`
blocks placed in ONE tick by a datapack function (`Delay:20s` — a /setblock without it reads 0; `MaxNearbyEntities`
must be given for `RequiredPlayerRange` to be read at all, MobSpawnerLogic.java:223-226). A datapack tick function
counts each room's mobs by type inside its box, tags them (a mob the void-tp fails to move must not be counted twice —
an untagged first version counted 47 zombies by t500 in one room), remembers the first gametime it saw one, and sends
them to y=-300, so the 6-nearby cap never binds except in `keep` rooms. Three server runs (`--set 1` twice merged,
`--set 2`, `--set 3`). `spawnerrefcheck` drives the engine's own `Spawn.tickSpawner` over a block entity from
`BlockEntities.create(…, 'mob_spawner')` in the same room (cell map, lamp light spread one level per block, sky 15 in
open rooms, a 17x17 ticking-chunk area), 40 rooms per scenario, same count/void rule; compared per checkpoint (mean,
4 engine-sd / sqrt(server rooms)) and first-spawn (who spawned at all; share within 5 ticks of the earliest).

Harness facts: the flat world's sea level is far below y=100 (no bat/slime surface rules apply as in a real world);
a keep room 32 blocks from the player lost a zombie to the random despawn — keep rooms sit in the middle column; the
80-zombie pen at 65 blocks had fully despawned by t6000 — it floats 14 blocks over the player now.

Findings (26 Sept pass): (1) `Spawn.tickSpawner` re-rolls the 200..800 delay after EVERY batch — vanilla
(MobSpawnerLogic.java:165-167) re-rolls only after a batch that spawned something (or on the nearby cap, :135-137);
a batch whose tries all fail retries next tick. cow on one grass row: server 11-14 cows per 6000 ticks, engine 2.2.
Also the roll is `min + nextInt(max - min)` (200..799), engine `min + rnd(max - min + 1)`. (2) the engine spawner
refuses at the MOB CAP (`catRule.cap` break in tickSpawner) — vanilla's spawner has no cap check: with 80
un-persistent zombies loaded the server spawned 40-57 per room, the engine 0. Both fixed in memory -> 7/7 set-1
scenarios green. (3) cave_spider, silverfish, magma_cube, blaze spawners spawn NOTHING in the engine
(`Spawn.canPlace` false — no `Spawn.RULES` entry): server 45-55 cave spiders, 17-23 silverfish (lit room), 27-34
magma cubes (lit room), 36-46 blazes (dark room; 0 in a lit room — blaze is a dark-only spawn in 1.18.2). Matching
today: zombie/spider/skeleton/creeper dark rates, lamp-lit 0, the 6-nearby cap, slime at y=100 never (no SPAWNER
exemption), pig/chicken/sheep/rabbit/wolf/cow on grass, cow on stone 0.

## Items + experience orbs (infra I6, s150 — the pass's worker)

Every lane sits on its own forceloaded 3x3 stone pad, 12 blocks apart, no player (forceloaded chunks tick without one;
lanes further than ~280 blocks out were not reliably ticked in this harness). `runitems.mjs` schedules each
checkpoint read SERVER-side (`schedule function … <cp+1>t` — a scheduled function runs at the START of its tick, so
+1 reads the state after exactly cp ticks; RCON-polling gametime missed exact-tick despawn/merge edges).
`itemrefcheck` drives the engine's own item/orb ticks in a cell-map world. Anti-vacuity: `EL.ITEM_MERGE_BOX` widened,
`Xp.DESPAWN_AGE` doubled. Matching: despawn at Age 6000 (incl. -32768 never), the 64/16 stack caps, different items
never merging, the per-tick fall trace, orb despawn. Findings (8 red): (1) item merge cadence — the engine retries
every 2 ticks always (07i_entitylist.js ~1364, `EL.ITEM_MERGE_EVERY`); vanilla ItemEntity.tick (:137) tries every 2
ticks only when the item's block cell changed, else every 40 — a still pair at 0.3 / 0.4-vertical is 2 entities at
+5 on the server, 1 in the engine; (2) merge reach — `EL.mergeNear` (~1385) compares centre distance to 0.5; vanilla
expands the item's own bounding box by 0.5 (ItemEntity.java:171), ~0.75 between centres: a 0.6 gap merges on the
server by +40, never in the engine; (3) `EL.canMerge` (~1350) ignores NBT — a custom-named stack merges with a plain
one ([16]); the server keeps [8,8]; (4) `Xp.mergeNear` (07zz_xporb.js ~292) merges any same-value orbs every 20 ticks;
vanilla's isMergeable (ExperienceOrbEntity.java:158-159) also requires `(otherId - id) % 40 == 0`, so 5 orbs summoned
in one tick never merge on the server (5 entities through +60), the engine collapses them. (The worker's check printed
these as "named" and exited 0; the orchestrator made them failures.)

## Natural-spawn floors (infra I6, s150)

The last pass flagged natural spawning; the engine names its SEARCH order non-parity, so this pack asks only the set
question: on which floor may a monster spawn naturally? `runfloor.mjs`: natural spawning on, night frozen, a
creative growbot on the flat world at chunk (0,0); the whole 9x9-chunk ground turned to glass; one sealed dark box
per chunk at chebyshev distance 2..4 (72 boxes = 36 floors x 2), interior 14x14 x 3 high over the floor at y=-61.
A tick function counts (and tags) every non-player entity in each box, then voids every tagged entity — the cap never
fills, and a legal floor draws 300-600 spawns per box in 2000 ticks, an illegal one exactly 0. Harness facts: a 5x5
box drew 0-8 spawns in 6000 ticks (a pack's random walk leaves it); counting without tags counted one stuck mob
~6000 times; a `tp @e[…,y=-100,dy=400]` guard silently became a 1-wide box at 0,0 (dx/dz default 0 once any of
dx/dy/dz is given) and moved nothing, filling the cap with 17 stuck mobs. `floorrefcheck`: the engine allows a floor
when `Spawn.checkPlacement` accepts some interior cell (y -61..-58) for zombie/skeleton/spider/creeper, rolls at their
most permissive; anti-vacuity: `Spawn.NO_SPAWN_BLOCKS` emptied, `Behave.faceSturdy` forced true.
Findings (7 red): the engine lets monsters spawn on jungle and azalea leaves (NO_SPAWN_BLOCKS lists only oak/birch/
spruce — vanilla's `canSpawnOnLeaves` covers every leaves block: ocelot/parrot only), on bedrock and barrier
(vanilla `Blocks::never`), and refuses soul_sand, farmland and snow[layers=8], all of which the server spawns on.
Matching: stone, glass/tinted/stained glass, oak leaves, ice (never) vs packed/blue ice (yes), magma block, soul soil,
dirt path (never), snow layer 1 (inside the layer, on the dirt), snow block, carpet, slabs and stairs by half, hopper,
chest, obsidian, slime block, honey block (never), mycelium, sand, redstone block, spawner, glass pane, fence.


## Mob ranged II (infra I6, s151)

Witch/blaze/trident-drowned/evoker/illusioner vs the real server. Recording is a datapack TICK function (`as @e[type=<kind>,tag=!seen,<lane box>] run function rec`: append gametime to storage, tag), so every tick is exact — an RCON poll with five lanes was 40-60 ticks coarse on the 2-core container. Server (3 reps, identical to the tick): witch throws every 60 ticks, first three potions slowness, poison, harming; blaze 3 fireballs 6 ticks apart every 178; trident drowned every 40, first at 38-50; evoker fangs every 100 (9-12 per cast), 3 vexes at ~19 and 3 more at ~365; illusioner an arrow every 40, first at 42-48, and NO Blindness on normal (BlindTargetGoal needs LocalDifficulty > 2.0, IllusionerEntity.java:229 — a fresh world's normal is 1.5); ghast a fireball every 60 once it has a target (its target filter wants |dy| <= 4 — a ghast 6 up never targets); snow golem a snowball every 20 at a NoAI zombie. The engine stub world must answer `biomeAt` = plains (the real World's seed put the golem in a hot biome, where it burned to death).
Engine side: the same lane in a cell map, the real player, `EL.spawn` + `EL.tick`; drowned handed the trident with `Equip.setEquipped` (a summon with NBT skips `initialize` on the server). Compared: volley cycle +-4, first volley within the server's range +-30, volley size, vex count, witch's first three potions, illusioner Blindness. Anti-vacuity: 4 forged golden values, each must flip a verdict.
