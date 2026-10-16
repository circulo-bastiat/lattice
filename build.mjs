#!/usr/bin/env node
// MC-Lite build — dependency-free. Concatenates src/ in a declared order, inlines the worker
// bundle as an escaped string constant, and emits ONE self-contained dist/mclite.html.
//
// Rules it enforces (see docs/DECISIONS.md):
//   D-1 single file, D-10 no ES module tokens, D-15 no literal </script,
//   D-47 idempotent (no timestamps), D-48 whitespace-only minify by default, D-49 syntax check.
//
// Usage: node build.mjs [--min] [--quiet]

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT     = dirname(fileURLToPath(import.meta.url));
// mail and claim gate, automatic: no build while a message to this session is unanswered or its issue is gone
await import('./tools/infra/gate.mjs').then((m) => m.gate(ROOT)).catch(() => {});
const SRC      = join(ROOT, 'src');

/**
 * ⚠⚠ **`build.mjs` DOES NOT REBUILD `src/19_data.gen.js`, AND THAT HAS COST THIS PROJECT FOUR
 * DEBUGGING SESSIONS.** The data module is generated from `assets/*.bin` by `tools/gen-data.mjs`;
 * this file only concatenates. So a session that repacks an asset and then runs `node build.mjs`
 * gets a build that is GREEN, IDEMPOTENT AND STALE — and the symptom is never "the asset is
 * missing", it is a feature that silently does nothing: the sun and moon never drew (D-303), the
 * creative tab strip came back empty, and a block-entity icon rendered at the wrong angle because
 * its display transform was not in the blob yet.
 *
 * The fix is not a note in a document. It is this: if any `assets/*.bin` is NEWER than
 * `src/19_data.gen.js`, the build stops and says which one. Four sessions of "why is nothing
 * happening" against one mtime comparison.
 */
function assertDataFresh() {
  const gen = join(SRC, '19_data.gen.js');
  const assets = join(ROOT, 'assets');
  if (!existsSync(gen) || !existsSync(assets)) return;
  const genAt = statSync(gen).mtimeMs;
  const stale = [];
  for (const f of readdirSync(assets)) {
    if (!f.endsWith('.bin')) continue;
    const at = statSync(join(assets, f)).mtimeMs;
    if (at > genAt + 1000) stale.push(f + ' (' + Math.round((at - genAt) / 1000) + 's newer)');
  }
  if (!stale.length) return;
  console.error('build: src/19_data.gen.js is OLDER than ' + stale.length + ' asset'
    + (stale.length === 1 ? '' : 's') + ' — the build would ship the previous payload.');
  for (const f of stale) console.error('   x ' + f);
  console.error('   Run `node tools/gen-data.mjs` first. (This file only concatenates; it does');
  console.error('   not regenerate the data module, and a stale one fails SILENTLY.)');
  process.exit(1);
}
assertDataFresh();
const WORKERS  = join(SRC, 'workers');
const DIST     = join(ROOT, 'dist');
const OUT      = join(DIST, 'mclite.html');

const ARGS  = new Set(process.argv.slice(2));
const MIN   = !ARGS.has('--no-min');   // #6636 (Dan, 13 Oct: "Both"): comments stripped by DEFAULT (was opt-in, D-48); --no-min keeps them
const QUIET = ARGS.has('--quiet');

// ---------------------------------------------------------------------------
// Declared file order. Adding a file to src/ without listing it here is a build
// error, not a silent omission.
// ---------------------------------------------------------------------------

/** Modules shared by the main thread AND the worker bundle. Must not touch the DOM. */
const SHARED_MODULES = [
  '00_ns.js',
  '01_util.js',
  // 01b/02b are the generated 1.18.2 roster and the decoder it needs. They are SHARED
  // because the mesher runs in the worker bundle and cannot ask the main thread what a
  // block looks like. The DATA they decode is main-only (19_data.gen.js) and reaches the
  // workers as bytes over postMessage — see the note at the top of tools/gen-data.mjs.
  '01b_inflate.js',
  '02_blocks.js',
  '02b_registry.js',
  // 02c derives the per-real-state property tables the mesher indexes by. SHARED for the same
  // reason 02b is: the mesher runs in the worker bundle and a cell now holds a real state.
  '02c_states.js',
  // 02k is #19's survival rules, written once against a LEVEL (the live world, or a worldgen scratch
  // buffer). SHARED: worldgen runs in the worker bundle and asks the same rules the live world does.
  '02k_survive.js',
  // 02l is DimensionType/DimensionOptions (G27a): SHARED, worldgen and lighting ask it in the worker too.
  '02l_dimension.js',
  '02m_jrandom.js',
  // 02d is the vanilla worldgen registries (PLAN W1). SHARED because worldgen runs in the
  // worker bundle; the 37.8 KB payload itself is main-only and reaches the workers as bytes.
  '02d_wgdata.js',
  // 02e is PLAN W15's 866 structure templates. SHARED, and decoded from inside `WG.init`, for
  // 02d's reason: the worldgen that assembles a village runs in the worker bundle.
  '02e_templates.js',
  '03_section.js',
  // 03b is Mojang's noise stack, ported exactly (PLAN W2). SHARED: worldgen runs in workers.
  '03b_noise.js',
  '04_worldgen.js',
  '04b_caves.js',
  // 04d is PLAN W3's column function — vanilla's splines, a closed-form surface. SHARED.
  '04d_column.js',
  // 04e is PLAN W4's biome dispatch — the multi-noise table and vanilla's R-tree over it.
  // 04f is the other half of W4's toggle, the physical climate model. Both SHARED: the
  // worldgen that asks "which biome is here" runs in the worker bundle.
  '04e_climate.js',
  '04f_earth.js',
  // 04g is PLAN W5's biome registry — colours, weather, spawners, carvers, features. SHARED:
  // the mesher asks it for a tint colour and the worldgen asks it for everything else.
  '04g_biomes.js',
  // 04h is PLAN W6's surface rules — the interpreter over Mojang's own rule tree that decides
  // what the ground is MADE of. SHARED: it runs inside the chunk generator.
  '04h_surface.js',
  // 04i is PLAN W7's configured carvers. SHARED: they run inside the chunk generator, and a
  // worker that carved differently from the main thread would produce a seam at every border.
  '04i_carvers.js',
  // 04j is PLAN W8's feature pipeline — ores, plants, trees, out of vanilla's own placed
  // features. SHARED for the same reason as the carvers: it runs inside the chunk generator.
  '04j_features.js',
  // 04k/04m/04n/04p are W8's feature GENERATORS, one file per family, each registering itself
  // with `Features.register`. They are separate files because they were written in parallel and
  // because a 3,000-line generator switch is a file nobody reads. SHARED, like the pipeline.
  '04k_feat_trees.js',
  '04m_feat_water.js',
  '04n_feat_terrain.js',
  '04p_feat_cold.js',
  '04q_feat_coral.js',
  // 04r is PLAN W13's structure registry and start pass, 04s W14's mineshaft grammar. SHARED
  // for the carvers' reason: a worker that started a structure differently from the main thread
  // would produce half a mineshaft at every chunk border.
  '04r_structures.js',
  '04s_struct_mineshaft.js',
  // 04t is PLAN W15's NBT/jigsaw pipeline: the template writer, the processors and the matcher.
  '04t_jigsaw.js',
  // 04u is PLAN W16's S3: the beard, the flatness test, and the five small surface buildings.
  '04u_struct_surface.js',
  // 04v is PLAN W17's S4: villages and the pillager outpost, jigsaw plus beard.
  '04v_struct_village.js',
  // 04w is PLAN W18's S5/S6 — shipwrecks, ocean ruins, buried treasure, the monument and the
  // mansion — and 04x the stronghold's own room grammar, which PLAN names separately.
  '04w_struct_rest.js',
  '04x_struct_stronghold.js',
  '04y_struct_nether_fortress.js',
  '04z_struct_end_city.js',
  '04y_biome_dims.js',
  '05_mesher.js',
];

/** Main-thread-only modules, appended after the shared ones. */
const MAIN_MODULES = [
  // 02g is PLAN G7/G8's item table — MAIN ONLY. A worker never holds an item stack, and the
  // block registry is keyed by REAL STATE while this one is keyed by name: two questions, two
  // formats, rather than one format serving both.
  '02g_items.js',
  // 02h is PLAN G9's recipe table and matcher. Main only: a worker never crafts.
  '02h_recipes.js',
  // 02l is PLAN G26c's advancement data + manager/positioner/progress. Main only; pure data and
  // arithmetic, no load-time reads of other modules.
  '02l_advancements.js',
  '02i_text.js',
  '02j_sounds.js',
  // ⚠ 19_data.gen.js is ~0.83 MB of base64 and MUST stay main-only: build.mjs inlines every
  // SHARED module into the worker bundle as an escaped string, so listing it there would put
  // the whole payload in the file twice.
  '19_data.gen.js',
  // 02f is PLAN G1's tag substrate. MAIN-ONLY on purpose: no worker asks a tag question, and a
  // shared module is inlined into the worker bundle as a string and so appears TWICE in the
  // built file. Its header carries the argument in full.
  '02f_tags.js',
  '06_atlas.js',
  // 06b is PLAN W6's biome tint map: a texture of the loaded area's grass, foliage and water
  // colours, sampled by world position. MAIN-ONLY — it is a GPU resource and the workers have
  // no GPU.
  '06b_tintmap.js',
  '07_world.js',
  // PLAN G2 and G3 — block behaviour, block entities, mining and drops. All MAIN-ONLY for the
  // same reason as 02f: the survival loop is not a worker's business, and every one of these
  // reads NS.Tags. 07b before 07c because the behaviour layer registers the block-entity
  // types; 07d before 07e because the loot context carries the mining result.
  '07b_behaviour.js',
  '07c_blockentity.js',
  '07d_mining.js',
  '07e_loot.js',
  // PLAN G15a — the redstone SIGNAL. AFTER 07b because it uses `Behave`'s direction tables,
  // its property helpers and its scheduled-tick queue, and MAIN-ONLY for the same reason the
  // rest of this band is: a worker generates terrain and has no business running a circuit.
  '07f_redstone.js', '07fn_noteblock.js', '07g_piston.js',
  // PLAN G17a — the entity TYPE table, read out of the bytecode because no data pack carries
  // it. Data only: no behaviour, by the three-way ruling in PLAN's G17 (D-306).
  '07h_entities.js',
  // QUEUE 0.2 (G18 mobs remainder, D-517) -- MOB EQUIPMENT SLOTS (MobEntity's own
  // mainhand/offhand/head/chest/legs/feet, the difficulty-scaled armour roll and the fixed
  // skeleton/vindicator/pillager weapon). AFTER 07h_entities.js (reads nothing off it, just
  // sits in the entity band) and BEFORE 07i_entitylist.js: EL.spawn's own DEFAULTS hook
  // (zombie/skeleton/vindicator/pillager) calls Equip.initMob at spawn time.
  '07y_equip.js',
  // PLAN G17b — the entity LIST and the motion every entity shares. AFTER 07h, whose table it
  // reads; the PHYSICS it calls is 14b, resolved lazily like every other cross-module use.
  '07i_entitylist.js',
  '07j_entityrender.js',
  '08_lighting.js',
  '09_jobs.js',
  // PLAN G16 — the sky's NUMBERS: time of day, moon phase, sky and fog colour, the star field
  // and the weather cycle. BEFORE the three renderer modules, which all read it.
  '09b_sky.js',
  // D-655 (G20) -- the falling rain/snow draw (WorldRenderer.renderWeather). After 09b_sky.js
  // (Sky.weather, read live) -- every other NS read is lazy, at draw time.
  '09c_weather.js',
  '10_camera.js',
  '10_gfx.js',
  '11_gfx_webgpu.js',
  '12_gfx_webgl2.js',
  '13_input.js',
  '14_player.js',
  '14b_physics.js',
  '14c_raycast.js',
  // 14d is PLAN G5's survival loop — health, hunger, damage, death, XP. Main-thread only, and
  // like the physics it takes an entity rather than reading input, so a whole simulated life
  // runs inside `survcheck` without a browser.
  '14d_survival.js',
  // 14e is PLAN G6's gamemodes. It replaces the `creative` boolean with vanilla's Abilities,
  // which is what makes adventure and spectator expressible at all.
  '14e_gamemode.js',
  // 14f is PLAN G8's storage half — stacks, the 41-slot index space and Inventory.add's search
  // order. 14g is the CLICK half: `AbstractContainerMenu.doClick` off the 1.18.2 bytecode —
  // pickup, quick-move, swap, clone, throw, pickup-all and the quick-craft DRAG (D-265).
  '14f_inventory.js',
  '14g_menu.js',
  // PLAN G12b — Brigadier. It is a PARSER: no DOM, no canvas, and nothing above it in the list
  // depends on it, so it sits with the other logic modules rather than with the screens.
  '14h_brigadier.js',
  // 14i is PLAN G10's hand: the swing, the attack cooldown and the ten crack stages. Arithmetic
  // over ticks, so `handcheck` runs a whole mining session without a browser.
  '14i_hand.js',
  // PLAN QUEUE 0.2 -- the status-effect store (StatusEffectInstance: effect, amplifier,
  // duration, ambient, showParticles) and the combat residue it closes on Cb.OWED (Blindness
  // suppressing a crit, Strength/Weakness/Resistance, poison/wither/regen ticks, Thorns).
  // BEFORE 14j_combat.js: that file reads NS.Effects directly (crit suppression, the attack-
  // damage bonus, Cb.hurt's resistance reduction) rather than lazily, same as 14i_hand.js's
  // own attack-strength table is read eagerly by the file after it.
  '07q_effects.js',
  // QUEUE 0.2 raid loop (loop/witchpotion-s95) -- the witch's real thrown-potion
  // substrate: a live `potion` projectile, PotionEntity.applySplashPotion's splash,
  // and WitchEntity's own potion CHOICE (thrown + self-drunk). AFTER 07q_effects.js,
  // which its splash reads (NS.Effects.addStatusEffect); BEFORE 07k_goals.js, whose
  // Ai.ProjectileAttackGoal/witch ROSTER entry call into it lazily at throw time.
  '07z_potion.js',
  // G23 (#299) -- BrewingRecipeRegistry, the recipe tree. AFTER 07z_potion.js: its load-time
  // row validation reads Po.POTIONS. 14g_menu.js's ingredient slot reads it lazily.
  '07zzq_brewing.js',
  '14j_combat.js',
  // QUEUE 0.2 raid loop (loop/spells-s93) -- the evoker/illusioner spell-cast state
  // machine (SpellcastingIllagerEntity.spellTicks/getSpell) and its concrete spells.
  // BEFORE 07k_goals.js: the evoker/illusioner roster entries construct NS.Spell.*Goal.
  '07v_spell.js',
  // PLAN G18b (PASS 16 JOB 1, first slice) -- the goal selector and pathfinding.
  // AFTER 14j_combat.js: not a hard dependency (everything it reads is resolved
  // lazily, same as 07i's own note above), but it belongs with the other G17/G18
  // logic modules in reading order.
  '07k_goals.js',
  // PLAN G18c (PASS 16 JOB 2, D-393) -- spawning. AFTER 07k_goals.js: it spawns
  // through EL.spawn, which attaches a goal selector only when Ai.ROSTER already
  // knows the type, so Ai must exist first.
  '07l_spawn.js',
  // PLAN G18e -- love mode, breeding and age. AFTER 07l_spawn.js: it spawns a child through
  // `EntityList.spawn` and reads the breeding table `07h_entities.js` carries.
  '07m_breed.js',
  // QUEUE 0.2 (G18c) -- sheep/chicken/pig's own leftover state (wool colour, egg timer,
  // chicken slow-fall). AFTER 07m_breed.js: `Breed.CHILD.sheep` calls `Passive.childWoolColor`.
  '07w_passive.js',
  // PLAN G18e unit 3 (D-458) -- taming: the wolf/cat feed-and-roll, sitting, and the owner
  // mark. AFTER 07m_breed.js: it shares `Use.entityUse`'s single feed dispatch and Animal's
  // `isFood` the same way breeding already reads it.
  '07n_tame.js',
  // QUEUE 0.2 (leashing) -- the rope/knot render pass. AFTER 07n_tame.js: it reads
  // NS.Tame's own leashHolder/knots state and nothing else. Its call site is in 10_gfx.js's
  // G.render, executed long after full load, so file ORDER here does not matter for
  // correctness -- it sits next to 07n_tame.js for readability only.
  '07u_leash.js',
  // QUEUE 0.2 "G18e remainder" -- HORSE: the equip/tame/ride substrate (mounting-based taming,
  // riding, saddle+armour slots, the inventory container). AFTER 07n_tame.js, same slot in the
  // bundle: it reads `Breed.ageUp`/`Breed.isBaby`/`Breed.setInLove` the same way tame does, and
  // BEFORE 14l_use.js, which dispatches a right-click on a mountable type straight to it.
  '07r_mount.js',
  // loop/llama-s97 (QUEUE 0.2 G18e remainder close) -- the two LLAMA pieces that do not
  // belong inside Mount/Breed: the spit projectile's kinematics/hit consequence and the
  // FormCaravanGoal follow-chain. AFTER 07r_mount.js: same slot in the bundle, stateless
  // (no init() -- see the file's own header), read from 07k_goals.js/07i_entitylist.js.
  '07ze_llama.js',
  // PLAN G18f unit 2 (D-479) -- professions/workstations: the registry (15 professions,
  // jar-verified) and an adjacency claim. AFTER 07n_tame.js: same slot in the bundle,
  // same "per-species extra state" role Tame plays for wolf/cat.
  '07o_profession.js',
  '07ox_enchhelper.js',
  '07oy_enchtable.js',      // PLAN G22c -- the enchanting table's roll (java.util.Random), item facts, bookshelves
  // PLAN G18f follow-up -- EnchantmentHelper.enchant/generateEnchantments/getPossibleEntries
  // (the SellEnchantedToolFactory power-window/multi-enchant algorithm), a NS.EnchHelper 07p_trade.js
  // reads from. BEFORE 07p_trade.js (sorts 07o.. < 07p, same load slot).
  // PLAN G18f (D-48x) — villager TRADING, the mechanism (offers off the jar-verified table,
  // the transaction, uses/maxUses). AFTER 07o_profession.js: same slot, and it reads
  // `e.profession`, which that file is the only writer of.
  '07pm_mapcontent.js',
  // PLAN G18f-b (#229) -- MapColor + FilledMapItem.fillExplorationMap; Trade tags read it lazily.
  '07p_trade.js',
  // QUEUE 0.2 "G18e remainder" -- the FLYING-AI SUBSTRATE (FlightMoveControl/BirdNavigation's
  // own steer-straight-at-target stand-in, FlyOntoTreeGoal, the flying FollowOwnerGoal,
  // SitOnOwnerShoulderGoal's real gate) and PARROT TAMING. AFTER 07n_tame.js: it strikes that
  // file's own OWED line naming this exact gap. AFTER 07q_effects.js/14j_combat.js (loaded
  // earlier in this list): the cookie kill reads NS.Effects.addStatusEffect and NS.Combat.hurt.
  '07t_fly.js',
  // loop/raidpoi-s103 -- the minimal PointOfInterestStorage substrate (HOME bed / MEETING bell),
  // read lazily by 07s_raid.js/07k_goals.js's raider HOME goal (NS.Poi.*, no init()-order
  // dependency: it self-inits on its own first `Poi.tick()` call) -- placed just before
  // 07s_raid.js, the file that documents its one live caller.
  '07zu_poi.js',
  // loop/sleep-s104 -- villager SLEEP + MEETING-POINT behaviour (07zv_villagerbrain.js):
  // reads Poi/Ai lazily (no init()-order dependency, same self-init shape 07zu_poi.js's own
  // header already uses), placed right after it since it is Poi's own first live ticket
  // reserver (closes Poi.OWED's "tickets are never RESERVED" line).
  '07zv_villagerbrain.js',
  '07zzv_siege.js',
  // loop/vbplay -- baby villager PLAY activity (PlayWithVillagerBabiesTask, see the new
  // file's own header). AFTER 07zv_villagerbrain.js: it extends the SAME NS.VB namespace
  // that file creates (VB.tickPlay), same load-order reasoning as every other NS.X-extending
  // module in this list.
  '07zv2_vbplay.js',
  // loop/vbpanic -- villager Activity.PANIC (danger-memory substrate + PanicTask/
  // StopPanickingTask/createPanicTasks stand-ins, src/07zv3_vbpanic.js's own header).
  // AFTER 07zv_villagerbrain.js: reads its own NS.VB.localFuzzToward/fuzzyFind, and
  // 07zv_villagerbrain.js's own VB.tick hook calls into NS.VBPanic at tick time (lazy,
  // no init()-order dependency either way, same shape 07zu_poi.js's own header uses).
  '07zv3_vbpanic.js',
  // G18f-B3 -- HideWhenBellRingsTask/ForgetBellRingTask (HIDE activity), src/07zv7_vbbell.js.
  '07zv7_vbbell.js',
  '07zv8_vbhidehome.js',
  // G18f-D1 -- OpenDoorsTask, src/07zv9_vbdoors.js.
  '07zv9_vbdoors.js',
  // loop/vbidle -- createIdleTasks' priority-2 RandomTask's own five remaining entries
  // (breed-interest/trader-interest FindEntityTask, GoTowardsLookTarget, JumpInBedTask,
  // WaitTask, src/07zv4_vbidle.js's own header). AFTER 07zv_villagerbrain.js: it extends
  // the SAME NS.VB namespace (07zv2_vbplay.js's own pattern), overwriting VB.IDLE_FALLBACK
  // with the real 7-entry weighting once loaded; 07zv_villagerbrain.js's own tickIdle
  // hook calls VB.idleContinue/VB.IDLE_START lazily, no init()-order dependency either way.
  '07zv4_vbidle.js',
  // loop/vbbreed -- VillagerBreedTask itself (courting/eat/goHome/createChild, src/
  // 07zv5_vbbreed.js's own header) plus createPlayTasks' OWN priority-5 RandomTask
  // (VB.PLAY_FALLBACK, wired in src/07zv2_vbplay.js). AFTER 07zv4_vbidle.js: reuses its
  // VB.IDLE_START/VB.villagerReadyToBreed/VB.villagerFoodValue; reads NS.Breed/NS.Poi/NS.Ai/
  // NS.Particle/NS.EntityList lazily (no init()-order dependency, same self-init shape every
  // other NS.X-extending module in this list already uses).
  '07zv5_vbbreed.js',
  // loop/vbgather -- GatherItemsVillagerTask itself + the villager item-pickup substrate it
  // needs (canGather/GATHERABLE_ITEMS, src/07zv6_vbgather.js's own header). AFTER
  // 07zv5_vbbreed.js: reuses VB.villagerFoodValue/VB.BREED_FOOD_MIN (07zv4_vbidle.js) and
  // VB.ensureInv/VB.invCount/VB.invAddStack (07zv_villagerbrain.js); 07zv_villagerbrain.js's
  // own VB.tick hook calls NS.VBGather.lootTick/NS.VBGather.tick lazily, no init()-order
  // dependency either way.
  '07zv6_vbgather.js',
  // loop/gifts -- GiveGiftsToHeroTask itself + the 13-profession GIFTS loot-table map
  // (src/07zv7_vbgifts.js's own header). AFTER 07zv6_vbgather.js: reuses `Gt.giveItemTo`
  // (exported this session); 07zv_villagerbrain.js's own VB.tick hook calls
  // NS.VBGifts.tick lazily, same no-init()-order-dependency shape as its sibling above.
  '07zv7_vbgifts.js',
  // G18f-N2 -- FindInteractionTargetTask + HoldTradeOffersTask (src/07zv8_vbhold.js). AFTER 07p_trade.js (Trade.needGive).
  '07zv8_vbhold.js',
  // QUEUE 0.2 -- the raid loop's own state: Raid/RaidManager (wave tables, Bad Omen exchange,
  // victory/loss). AFTER 07q_effects.js's own slot (bad_omen/hero_of_the_village) is what it
  // reads and writes, but this sits with the other logic modules; it has no DOM dependency.
  '07s_raid.js',
  '07x_patrol.js',   // QUEUE 0.2 (raid loop remainder) -- PatrolSpawner + Ai.PatrolGoal's own module; after 07s_raid.js (reuses Rd.canPlaceRaiderAt/Rd.isNearOccupiedPOI)
  '07x2_catspawner.js',   // #1701 -- CatSpawner (village / swamp-hut wild cats)
  // loop/creeper-s95 (QUEUE 0.2 G18c) -- the EXPLOSION substrate (new, nothing existed
  // before this unit) and the creeper's own fuse/explode wiring. MAIN-ONLY, same band as
  // the rest of G18. 07za before 07zb: the creeper module's own Ex.ready check at init time
  // reads NS.Explosion, which must already be assigned (cross-module CALLS resolve lazily
  // everywhere else in this list, but a module-scope `NS.X = {}` assignment does not).
  '07za_explosion.js',
  '07zb_creeper.js',
  // loop/tnt-s96 (QUEUE 0.2 G18c remainder) -- TntEntity's own fuse-tick/explode trigger
  // and TntBlock's ignition paths (07zc_tnt.js). AFTER 07za_explosion.js (reads
  // NS.Explosion at init time, same module-scope-assignment reason 07zb_creeper.js is
  // already after it).
  '07zc_tnt.js',
  // D-533 (G18c) -- the bat's own roost/flight tick (07zf_bat.js); no load-order dependency.
  '07zf_bat.js',
  // loop/enderman-s98 -- the enderman's own goals/teleport/water-damage tick (07zg_
  // enderman.js); no load-order dependency (07k_goals.js's ROSTER.enderman only calls into
  // NS.Enderman.* at goal-construction time, long after both modules have loaded).
  '07zg_enderman.js',
  // loop/slime-s97 (QUEUE 0.2 G18c) -- the slime. AFTER 07k_goals.js (assigns
  // Ai.ROSTER.slime onto it, the same pattern 07t_fly.js already uses for parrot) and AFTER
  // 07i_entitylist.js/03b_noise.js (NS.Entities.dimensions, NS.Noise.LegacyRandom).
  '07zd_slime.js',
  // loop/rabbit-s98 (QUEUE 0.2 G18c) -- the rabbit. AFTER 07k_goals.js (Ai.ROSTER.rabbit
  // reads NS.Rabbit.EatCarrotCropGoal at spawn time) and AFTER 07i_entitylist.js/04g_biomes.js
  // (EL.DEFAULTS.rabbit rolls a biome-based type via NS.Rabbit.chooseTypeAt).
  '07zh_rabbit.js',
  // loop/squid-s98 (QUEUE 0.2 G18c) -- the squid + glow squid. AFTER 07i_entitylist.js
  // (Ent.attrsOf/dimensions, EL.motionFor's own squid/glow_squid inert row) and after
  // 14j_combat.js (Cb.hurt/Cb.notifyHurt's own onDamaged/onAttacked hooks) is NOT required --
  // those are cross-module CALLS, resolved lazily, the same standing rule 07zd_slime.js's own
  // comment states for its load-order neighbours.
  '07zi_squid.js',
  // loop/fox-s99 (QUEUE 0.2 G18c) -- the fox. AFTER 07k_goals.js (Ai.ROSTER.fox reads
  // NS.Fox.EatSweetBerriesGoal/PickupItemGoal/HuntGoal/SleepByDayGoal at goal-construction
  // time) and AFTER 07i_entitylist.js/04g_biomes.js (EL.DEFAULTS.fox rolls a biome-based
  // type via NS.Fox.typeAt) -- the same load-order shape 07zh_rabbit.js's own comment
  // states immediately above.
  '07zj_fox.js',
  // loop/goat-s99 (QUEUE 0.2 G18c) -- the goat. AFTER 07k_goals.js (Ai.ROSTER.goat reads
  // NS.Goat.RamGoal/NS.Goat.LongJumpGoal at spawn time) and AFTER 07i_entitylist.js (Ent.
  // attrsOf/dimensions) -- those are cross-module CALLS resolved lazily, the same standing
  // rule 07zd_slime.js's/07zh_rabbit.js's own load-order comments state.
  '07zj_goat.js',
  // Dan's scheduled parallel night, QUEUE 0.2 (G18c) -- the polar bear. AFTER
  // 07k_goals.js (Ai.ROSTER.polar_bear reads Pb.AttackGoal/EscapeDangerGoal/RevengeGoal/
  // ProtectBabiesGoal at goal-construction time) and AFTER 07i_entitylist.js/07m_breed.js
  // (EL.DEFAULTS.polar_bear's baby roll calls NS.Breed.setBaby; NS.Entities.dimensions) --
  // no load-order dependency, same standing rule 07zd_slime.js's own comment states.
  '07zj_polarbear.js',
  // loop/fish-s99 (QUEUE 0.2 G18c) -- the cod + salmon + pufferfish + tropical fish. AFTER
  // 07i_entitylist.js (Ent.attrsOf/dimensions, EL.motionFor's own fish inert row) and AFTER
  // 07zi_squid.js (no load-order dependency on squid itself, just this file's own convention
  // of sitting with the rest of the QUEUE 0.2 G18c mob modules, newest last).
  '07zj_fish.js',
  // #717 -- dolphin AquaticMoveControl + DolphinEntity.travel.
  '07zjd_dolphin.js',
  '07zj2_dolphin.js',
  // loop/zombievariants-s100 (QUEUE 0.2 G18c) -- husk + stray + drowned. AFTER 07k_goals.js
  // (Ai.ROSTER.husk/.stray/.drowned reference NS.Undead.* -- and Ai.ROSTER.husk/.stray are
  // themselves aliased directly onto Ai.ROSTER.zombie/.skeleton right after that object
  // literal) and AFTER 07i_entitylist.js/07y_equip.js/14j_combat.js (Ent.attrsOf/dimensions,
  // Eq.initDrowned, Cb.eyeHeightOf) -- those are cross-module CALLS resolved lazily, the same
  // standing rule 07zd_slime.js's/07zh_rabbit.js's own load-order comments state.
  '07zk_undead.js',
  // s101 orchestrator (QUEUE 0.2 G18c) -- the mooshroom + cow milking. AFTER 07k_goals.js
  // (Ai.ROSTER.mooshroom aliases cow's) and 02h_recipes.js (R.flowers, the stew-effect table).
  '07zn_mooshroom.js',
  // loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- the panda. AFTER 07k_goals.js
  // (Ai.ROSTER.panda reads Pd.AttackGoal/RevengeGoal/LieOnBackGoal/SneezeGoal at goal-
  // construction time) and AFTER 07i_entitylist.js/07m_breed.js (EL.DEFAULTS.panda's gene
  // roll, Breed.CHILD.panda) -- cross-module CALLS resolved lazily, the same standing rule
  // every prior QUEUE 0.2 mob module's own load-order comment states.
  '07zl_panda.js',
  // loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- the axolotl. Same standing rule, AFTER
  // 07k_goals.js (Ai.ROSTER.axolotl reads Ax.WanderGoal) and AFTER 07i_entitylist.js/
  // 07m_breed.js/14j_combat.js (EL.DEFAULTS.axolotl's variant roll, Breed.CHILD.axolotl,
  // Cb.hurt's play-dead hook).
  '07zm_axolotl.js',
  // QUEUE 0.2 (G18 mobs) -- the bee. Same standing rule, AFTER 07k_goals.js (Ai.ROSTER.bee
  // reads Bee.PollinateGoal/GrowCropsGoal/GoToHiveGoal/StingGoal) and AFTER 07i_entitylist.js/
  // 07m_breed.js/07t_fly.js (EL.DEFAULTS.bee's e.flyMove attach, Breed.SPECIAL.bee removed,
  // Fl.FLYING_SPEED.bee) -- cross-module CALLS resolved lazily, the same standing rule every
  // prior QUEUE 0.2 mob unit above already uses.
  '07zo_bee.js',
  // loop/turtle-s102 (QUEUE 0.2 G18 mobs) -- the turtle. Same standing rule, AFTER
  // 07k_goals.js (Ai.ROSTER.turtle reads Tu.WanderGoal/GoHomeGoal/LayEggGoal/MateGoal) and
  // AFTER 07i_entitylist.js/07m_breed.js (EL.DEFAULTS.turtle's home-pos init, Breed.spawnXp
  // read live by Tu.MateGoal) -- cross-module CALLS resolved lazily, the same standing rule
  // every prior QUEUE 0.2 mob module's own load-order comment states.
  '07zp_turtle.js',
  // loop/zvillager-s102 (QUEUE 0.2 G18 mobs) -- ZombieVillagerEntity + the whole cure/kill-
  // conversion. AFTER 07k_goals.js (Ai.ROSTER.zombie_villager aliases zombie's), 07o_profession.js
  // /07p_trade.js (villager profession/trade/xp fields it copies both directions) and
  // 07l_spawn.js (Village.startGossip, the cure gossip) -- all read LAZILY (NS.Profession/NS.
  // Village), so this is a load-order comment, not a hard dependency; placed last among the
  // mob units since it is the newest.
  '07zr_zvillager.js',
  // loop/spawner-s114 (PLAN G18c, D-395's own remainder) -- the monster SPAWNER block's
  // entity assignment + cave_spider's poison hook (07zs_spawner.js's own header). AFTER
  // 07c_blockentity.js (BE.create/BE.get) and 07l_spawn.js (Spawn.tickSpawner, sits with
  // the mob unit that owns the block, not read at load time) -- alphabetically between
  // 07zr and 07zt, same numbering scheme every 07z*.js mob unit here already follows.
  '07zs_spawner.js',
  // loop/wtrader-s103 (QUEUE 0.2 G18e/Breed remainder) -- the wandering trader + trader llama +
  // WanderingTraderManager spawner. AFTER 07k_goals.js (Ai.ROSTER.wandering_trader/
  // .trader_llama read NS.WT), 07p_trade.js (Trade.pickFromPool/resolveOffers/disabled/
  // previewFor, REUSED not reimplemented), 07q_effects.js (Effects.addStatusEffect/
  // hasStatusEffect), 09b_sky.js (Sky.isDay), 07i_entitylist.js (EntityList.spawn/list),
  // 07u_leash.js ({kind:'entity'} leash holder) and 07ze_llama.js (Ll.DefendTraderGoal/
  // tickTraderLlamaDespawn) -- all read LAZILY, the same standing rule every prior QUEUE 0.2
  // mob unit's own load-order comment states; placed last since it is the newest.
  '07zt_wtrader.js',
  // loop/nbtsave-s104 (Mnt.OWED's entity-NBT-persistence entry) -- the generic mob-NBT
  // serializer 16b_save.js calls on save/load. AFTER every 07z*.js mob unit above (it reads
  // none of them at load time, only names their field lists, but sits with them for the
  // same reason 07zt_wtrader.js is last among mob units: it is the newest) and BEFORE
  // 16b_save.js, its one caller.
  // loop/silverfish (SILVERFISH + INFESTED BLOCKS) -- AFTER 07k_goals.js (Ai.ROSTER.silverfish
  // reads NS.Silverfish.CallForHelpGoal/WanderAndInfestGoal at spawn time, the same lazy-
  // reference pattern 07zh_rabbit.js/07zj_fox.js/07zj_goat.js's own comments above already
  // state) and AFTER 07i_entitylist.js (EntityList.spawn) and 07_world.js/02c_states.js
  // (World.getBlock/setBlock, States.name/block) -- all read LAZILY, inside function bodies
  // only, so nothing here is load-order-sensitive beyond sitting with the other mob units.
  '07zn_silverfish.js',
  // s115 ENDERMITE -- NS.Endermite is read lazily (Ai.ROSTER.enderman/endermite, EL.tickMob).
  '07zn2_endermite.js',
  // loop/snowgolem -- the SNOW GOLEM (07zq_snowgolem.js). AFTER 07k_goals.js
  // (Ai.ROSTER.snow_golem reads NS.SnowGolem.hostileTargets at spawn time, the same lazy-
  // reference pattern 07zn_silverfish.js's own comment above already states) and AFTER
  // 07i_entitylist.js/14j_combat.js/07l_spawn.js (EntityList.spawn/list, Combat.hurt,
  // Spawn.PEACEFUL_DISALLOWED) and 07_world.js/02c_states.js (World.getBlock/setBlock,
  // States.solid/withLocal) -- all read LAZILY, inside function bodies only, so nothing
  // here is load-order-sensitive beyond sitting with the other mob units.
  '07zq_snowgolem.js',
  // #909 -- wolf wet-fur shake (07zq2_wolfshake.js), lazily reads Sound/Particle/EntityList.
  '07zq2_wolfshake.js',
  // loop/phantom -- PHANTOM (PhantomEntity + PhantomSpawner, 07zz1_phantom.js). AFTER
  // 07k_goals.js (Ai.ROSTER.phantom reads NS.Phantom.* lazily, the same standing pattern
  // 07zn_silverfish.js's own comment above already states for Ai.ROSTER.silverfish) and
  // AFTER 07i_entitylist.js/07_world.js/07t_fly.js (EntityList.spawn/World.canSeeSky/
  // Fly.travelMob, all read LAZILY) -- sits with the other mob units for the same
  // reading-order reason, not a load-order requirement of its own.
  '07zz1_phantom.js',
  '07zz2_dolphin.js',
  '07zw_mobnbt.js',
  // loop/composter — ComposterBlock's LEVEL-manipulation substrate (07zy_composter.js) for
  // G18's farmer villager (FarmerWorkTask.performAdditionalWork). AFTER the mob units it sits
  // with numerically and BEFORE 14l_use.js, the one caller that hooks its `onUse` (both reads
  // are lazy — `NS.Composter` is only touched inside function bodies at call time, so nothing
  // here is load-order-sensitive; it sits here for reading-order neighbourliness only).
  '07zy_composter.js',
  // G21 -- EXPERIENCE ORBS (07zz_xporb.js): the substrate Br.OWED/Passive.OWED/ER.OWED/
  // Cb.OWED were all waiting on. AFTER 07m_breed.js (Br.isBaby/Br.mobLoot, read live) and
  // 07y_equip.js (Eq.getEquipped/Eq.dropChance, read live) and BEFORE 14j_combat.js (Cb.dropLoot
  // calls NS.Xp.dropMobXp) and 17_main.js (NS.Xp.pickupTick) -- both of those reads are lazy
  // (inside function bodies), so this only needs to be loaded before it is ever CALLED, same
  // standing rule every 07z*.js mob unit here already follows.
  '07zz_xporb.js',
  // G22e -- grindstone menu (07zzq_grindstone.js); reads Xp/EnchHelper/Combat live.
  '07zzq_grindstone.js',
  // loop/lightning -- LightningEntity + the skeleton-horse thunder trap (07zzc_lightning.js).
  // AFTER 07i_entitylist.js/07k_goals.js/07y_equip.js/07m_breed.js/07zn_mooshroom.js/09b_sky.js
  // (all read live via NS.* at call time, not at load time, but keeping every 07z*.js mob unit
  // in one place after 07zz_xporb.js is the standing convention this file's own comments name).
  '07zzc_lightning.js',
  '07zzu_sculk.js',
  '07zzw_gameevent.js',
  // loop/throwables-s116 -- the player's own thrown snowball/egg/ender_pearl/splash+
  // lingering potion (07zzd_throw.js). AFTER 07i_entitylist.js (EL.spawn/EL.DEFAULTS)/
  // 07m_breed.js (Breed.setBaby)/07z_potion.js (Potion.tipFromTag/tickCloud)/14j_combat.js
  // (Cb.gauss/ARROW_*)/14d_survival.js (Sv.hurt) -- all read live via NS.* at call time,
  // same standing rule 07zzc_lightning.js's own comment just above already states.
  '07zzd_throw.js',
  // G17-F1 -- FishingRodItem.use cast/retract (07zzq_fishing.js). Reads EL/Combat/Sound live.
  '07zzq_fishing.js',
  // s128 -- Oxidizable/Degradable (copper weathering + the lightning strike's copper ring).
  '07zze_oxidize.js',
  // #5666 -- PointedDripstoneBlock drips/growth + cauldron fill. Reads Behave/World live.
  '07zzi_dripstone.js',
  // s133 (KW-32) -- piglin + piglin_brute: zombification clock, spawn init, brain-as-goals.
  // AFTER 07k_goals.js (registers Ai.ROSTER.piglin at load) and 07i/07y/07m (read live).
  '07zzf_piglin.js',
  // s134 (KW-32) -- hoglin + zoglin: Hoglin.tryAttack/knockback, the brain as goals, zombification.
  // AFTER 07k_goals.js (registers Ai.ROSTER.hoglin at load); 14j reads it live.
  '07zzg_hoglin.js',
  // loop/blazeghast -- blaze + the two fireball projectile entities. AFTER 07k_goals.js
  // (registers Ai.ROSTER.blaze at load); 14j/07i read it live.
  '07zzh_blaze.js',
  // loop/blazeghast -- ghast. AFTER 07zzh_blaze.js (reads NS.Blaze.Fireball live) and 07t_fly.js
  // (Fl.MoveControl/Fl.FLYING_SPEED.ghast); registers Ai.ROSTER.ghast at load.
  '07zzi_ghast.js',
  // #742 -- every mob's ambient/hurt/death/step voice off NS.DATA.mobSounds; 14j/07i call it live.
  '07zzp_mobvoice.js',
  // #1011 -- guardian/elder guardian AI (beam, move control, thorns). AFTER 07k_goals.js (registers Ai.ROSTER).
  '07zzr_guardian.js',
  // s135 (KW-33) -- strider: cold state, saddle+ride (reuses Passive.pigBoost/pigTravelSpeed,
  // grep pigridecheck), breeding via Ent.breeding.strider (data-driven, Br.interact), the
  // natural-spawn zombie-rider / baby-strider-rider rolls.
  // AFTER 07w_passive.js (Passive.pigBoost/pigTravelSpeed) and 07s_raid.js (Raid.startRiding).
  '07zzj_strider.js',
  // D-773 cloud unit (confident-lamport-hlerdd) -- shulker AI: the wall-attach/teleport identity
  // (`Ai.MOVE`-less by design, matching ShulkerEntity's own move()/getVelocity() override) and
  // the PeekGoal. AFTER 07k_goals.js (Ai.GoalSelector/Ai.LookAtPlayerGoal/Ai.RandomLookAroundGoal)
  // and 14b_physics.js (the `e.noGravity` guard this file's stillness depends on); registers
  // Ai.ROSTER.shulker at load, same external-assignment shape as piglin/hoglin/blaze/ghast above.
  '07zzk_shulker.js',
  // D-773 cloud unit (confident-lamport-1851se) -- ender dragon registry-level identity: the
  // 8-part hitbox (EnderDragon.PARTS) and the 11 phase names (EnderDragon.PHASE_NAMES), data
  // only. No dependency on any other module (no Ai/World/Entities read), so it needs no
  // particular position beyond staying after 07zzk_shulker.js in the Nether/End mob sequence.
  '07zzl_enderdragon.js',
  // loop/endcrystal-entity -- the real `end_crystal` entity (registration + damage rule +
  // crystalDestroyed wiring). AFTER 07i_entitylist.js (EL.remove/EL.spawn), 07za_explosion.js
  // (NS.Explosion.explode) and 07zzl_enderdragon.js (ED.getActiveFight) -- all read live via
  // NS.*, not at load time, but grouped here with the other dragon-fight files for clarity.
  '07zzn_endcrystal.js',
  // G17-HG1 -- AbstractDecorationEntity core (painting/item frames' shared box + survival check).
  '07zzv_hanging.js',
  // G22d — the anvil's rules (AnvilScreenHandler); pure, reads NS.EnchHelper/Items/Inventory live.
  // #5081 -- FireworkRocketEntity tick/explode + FireworkRocketItem use; read live via NS.*.
  '07zzy_firework.js',
  '07zzp_anvil.js',
  // G26a -- the statistics substrate (Stats.java/StatHandler/StatFormatter); read live via NS.Stats.
  '07zzo_stats.js',
  // #306 (G25a) -- rail shapes (AbstractRailBlock/RailPlacementHelper/RailBlock). AFTER 07b (Behave.w,
  // the changed hook calls NS.Rail live) and 07f (Redstone.receivedPower/isSignalSource, read live).
  '07zzq_rail.js',
  // #1564 (G25) -- minecart entities (movement/logic); reads NS.Rail live, hooked from 07i's tickOne/DEFAULTS/motionFor.
  '07zzr_minecart.js',
  '07zzs_portal.js',
  // #5227 (G17-B1) -- BoatEntity core tick (location/float/slipperiness/fall); hooked from 07i's tickOne/DEFAULTS/motionFor.
  '07zzt_boat.js',
  // #7886 (G17-H1) -- F3+B hitbox line list (EntityRenderDispatcher.renderHitbox); toggled from 13_input.
  '07zzu_hitbox.js',
  // #4391 -- armor_stand placement/interaction; hooked from 14l_use (place, entityUse) and 14j_combat (hurt).
  // #4772 -- command block screen model (Hud.openCommandBlock draws it).
  '07zzu_cmdscreen.js',
  '07zzt_armorstand.js',
  // D-773 cloud unit (tender-carson-7zokog) -- the shulker as vanilla DRAWS it: lid open
  // progress + wobble/twist, head pose, attached-face rotation, teleport slide, no-op body
  // control. AFTER 07zzk_shulker.js (reads e.shulkerPeek/e.shulkerFace); 07j/07i/07k read it live.
  '07zzl_shulkerdraw.js',
  // #1564 (G25) -- the minecart model/renderer (MinecartEntityRenderer). AFTER 07j_entityrender.js; read live by ER.animOf/ER.visible.
  '07zzs_minecartrender.js',
  // QUEUE 0.00 part 2 -- wither AI (goal roster + tickMovement homing blend, no attack/invuln/
  // structure-detector/renderer -- Wi.OWED). AFTER 07zzi_ghast.js (reuses NS.Ghast.
  // FlyRandomlyGoal live) and 07k_goals.js/07t_fly.js (Ai.GoalSelector/Fl.MoveControl);
  // registers Ai.ROSTER.wither at load, same external-assignment shape as shulker/ghast above.
  '07zzm_wither.js',
  // #1009 -- ElderGuardianEntity.mobTick (mining fatigue III curse).
  '07zzq_elderguardian.js',
  // PLAN G10d — the first-person hand as REAL GEOMETRY (D-359). AFTER 14i (its swing and equip
  // state) and after 15d_blockicon would be too late: this is pure arithmetic over the baked
  // quads and the renderer calls it, so it sits with the other logic modules. It reads
  // `BlockIcon.ARM`, which is declared later in the bundle — that is fine, because nothing here
  // runs at load time; `Gfx.render` is the only caller and the whole bundle is up by then.
  '14k_hand3d.js',
  '14kb_fovmult.js',
  // PLAN G19 — RIGHT-CLICK (D-361): the block's own `use` and then the item's. AFTER the hand
  // and before the screens, because it is pure model: a state change, a sound and a schedule.
  '14l_use.js',
  // loop/beds (G19c) -- sleeping, the night skip and the spawn point. AFTER 14l_use.js,
  // which hooks its own `Sleep.use` for the `beds` tag, and after 14_player.js, whose
  // `P.dirStep` it reuses; nothing here runs at load time so the exact slot is not
  // load-bearing beyond that.
  '14m_sleep.js',
  // 15b is PLAN G11's GUI: vanilla's sheets, the legacy font and the slot geometry. BEFORE the
  // HUD, which draws with it.
  '15b_gui.js',
  // PLAN G10b — a block as an ITEM is its MODEL in three dimensions, not one flat atlas tile
  // (D-311). AFTER 15_hud.js, whose sheet dimensions it reads, and before anything draws.
  '15d_blockicon.js',
  // PLAN G11b — the creative inventory. AFTER 15d because its icons are 3D block renders, and it
  // is what makes D-312's removal of the starter kit correct rather than merely tidy.
  '15e_creative.js',
  // PLAN G11c — vanilla's Options tree. AFTER 15b_gui.js (its widgets and font) and after
  // 15e_creative.js so the two screen modules sit together; it REPLACES `Hud.drawPause`.
  // PLAN G10c — the block-entity item models: the sixty items with no sprite and no block model.
  // AFTER 15b_gui.js, whose sheets carry the entity textures, and after 15d, whose rasteriser it
  // is a sibling of.
  '15h_bemodel.js',
  '15f_options.js',
  // PLAN G12b — the command tree itself. LAST of the 15s, because every command reaches into
  // something earlier: the item table, the gamemode abilities, the sky's clock, the entity list.
  '15g_commands.js',
  '15c_chat.js',
  '15_hud.js',
  // loop/hearts (this session) -- the PARTICLE substrate (love-mode/breed-complete HEART,
  // growth/bonemeal HAPPY_VILLAGER, tame success/fail HEART/SMOKE). AFTER 15_hud.js only for
  // reading-order neighbourliness (it does not touch `Hud`, and every breed/tame call site
  // that reaches it is far earlier in this list) -- no functional dependency either way.
  '07zx_particle.js',
  // D-431 — the F4 diagnostics overlay. AFTER the HUD (it reads `Hud.fps`) and it is the one
  // piece of UI in this engine that is DOM rather than canvas; its own header says why.
  '15i_diag.js',
  // #1890 -- `/ss` and F2: ONE png = the frame + the debug dump. AFTER the HUD (it composites Hud.canvas) and
  // before 17_main.js (Main.loop calls SS.afterFrame() right after the frame is drawn).
  '15j_ss.js',
  '16_settings.js',
  '16b_save.js',
  // #1529 -- GATE M L3's GPU half: one mob layer drawn through the active backend's own model pass, read back.
  // AFTER both gfx backends and the entity renderer (it calls into all three); nothing in the game calls it.
  '16z_l3render.js',
  '17_main.js',
  '18_bench.js',
];

/** Worker bundles: name -> entry file in src/workers/. Each gets SHARED_MODULES prepended. */
const WORKER_BUNDLES = {
  CHUNK: 'chunk.worker.js',
};

const FILE_ORDER = SHARED_MODULES.concat(MAIN_MODULES);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const log = (...a) => { if (!QUIET) console.log(...a); };

function die(msg) {
  console.error('BUILD FAILED: ' + msg);
  process.exit(1);
}

function read(path) {
  try { return readFileSync(path, 'utf8'); }
  catch (e) { die('cannot read ' + path + ' (' + e.code + ')'); }
}

/** Normalise line endings, strip trailing whitespace, collapse blank-line runs. Safe (D-48). */
function normalise(src) {
  return src
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

/**
 * Opt-in comment stripper (--min). Lexes strings, template literals (with ${} nesting) and
 * regex literals so it never eats code. Still opt-in: see D-48.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let prev = '';                 // last significant char, for the regex-vs-divide heuristic
  const tplStack = [];           // template literal ${ } nesting depths
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; out += ' '; continue; }
    if (c === '"' || c === "'") {
      const q = c; out += c; i++;
      while (i < n) { const ch = src[i]; out += ch; i++; if (ch === '\\') { out += src[i]; i++; } else if (ch === q) break; }
      prev = q; continue;
    }
    if (c === '`') {
      out += c; i++; tplStack.push(0);
      while (i < n && tplStack.length) {
        const ch = src[i];
        if (ch === '\\') { out += ch + src[i + 1]; i += 2; continue; }
        if (ch === '`') { out += ch; i++; tplStack.pop(); continue; }
        if (ch === '$' && src[i + 1] === '{') { out += '${'; i += 2; let depth = 1;
          while (i < n && depth) { const c2 = src[i];
            if (c2 === '{') depth++; else if (c2 === '}') depth--;
            if (depth) { out += c2; i++; } else { out += '}'; i++; }
          }
          continue; }
        out += ch; i++;
      }
      prev = '`'; continue;
    }
    if (c === '/' && /[=(,:[!&|?{};+\-*%~^<>]/.test(prev)) { // regex literal
      out += c; i++; let cls = false;
      while (i < n) { const ch = src[i]; out += ch; i++;
        if (ch === '\\') { out += src[i]; i++; continue; }
        if (ch === '[') cls = true; else if (ch === ']') cls = false;
        else if (ch === '/' && !cls) break;
      }
      while (i < n && /[a-z]/.test(src[i])) { out += src[i]; i++; }
      prev = '/'; continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

/** Reject anything that cannot survive file:// or an inline <script>. */
function auditModule(name, src) {
  if (/^\s*(import|export)\s/m.test(src) && !/\/\/\s*build-ok/.test(src)) {
    die(name + ' contains an ES module `import`/`export` — forbidden by D-10 (breaks file://).');
  }
  if (/<\/script/i.test(src)) {
    die(name + ' contains a literal "</script" — forbidden by D-15 (truncates the page).');
  }
  if (/\bfetch\s*\(|XMLHttpRequest|importScripts\s*\(/.test(src)) {
    die(name + ' performs a network/script load — forbidden by D-1/D-2.');
  }
  if (/SharedArrayBuffer/.test(src)) {
    die(name + ' uses SharedArrayBuffer — unavailable on file:// (D-13).');
  }
}

/** Syntax-check without executing (D-49). */
function syntaxCheck(label, src) {
  try { new Function(src); }
  catch (e) { die('syntax error in assembled ' + label + ': ' + e.message); }
}

function banner(name) {
  return '/* ==== ' + name + ' ' + '='.repeat(Math.max(0, 62 - name.length)) + ' */\n';
}

function concat(dir, files) {
  let out = '';
  for (const f of files) {
    const src = normalise(read(join(dir, f)));
    auditModule(f, src);
    out += banner(f) + (MIN ? normalise(stripComments(src)) : src) + '\n';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Verify the declared order covers src/ exactly
// ---------------------------------------------------------------------------

const onDisk = readdirSync(SRC).filter(f => f.endsWith('.js') && !f.includes('.sync-conflict-')).sort();   // Syncthing litter, never source (#3163)
const declared = FILE_ORDER.slice().sort();
for (const f of onDisk) if (!declared.includes(f)) die('src/' + f + ' exists but is not in FILE_ORDER in build.mjs.');
for (const f of declared) if (!onDisk.includes(f)) die('FILE_ORDER lists src/' + f + ' but it does not exist.');

const wOnDisk = existsSync(WORKERS) ? readdirSync(WORKERS).filter(f => f.endsWith('.js') && !f.includes('.sync-conflict-')).sort() : [];
const wDeclared = Object.values(WORKER_BUNDLES).slice().sort();
for (const f of wOnDisk) if (!wDeclared.includes(f)) die('src/workers/' + f + ' exists but is not in WORKER_BUNDLES.');
for (const f of wDeclared) if (!wOnDisk.includes(f)) die('WORKER_BUNDLES lists src/workers/' + f + ' but it does not exist.');

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

const sharedJs = concat(SRC, SHARED_MODULES);
const mainJs   = concat(SRC, MAIN_MODULES);

// --- worker bundles: shared modules + entry, wrapped in their own IIFE, escaped as a string ---
const workerConsts = [];
const workerSizes  = [];
for (const [constName, file] of Object.entries(WORKER_BUNDLES)) {
  const entry  = concat(WORKERS, [file]);
  const bundle = "'use strict';\n(function(){\n" + sharedJs + entry + '})();\n';
  syntaxCheck('worker bundle ' + file, bundle);
  // JSON.stringify handles quotes/newlines/unicode; "</" must still be broken up (D-15).
  const escaped = JSON.stringify(bundle).replace(/<\//g, '<\\/');
  workerConsts.push('MCL.WORKER_SRC.' + constName + ' = ' + escaped + ';');
  workerSizes.push([file, bundle.length]);
}

const appJs =
  "'use strict';\n" +
  '(function(){\n' +
  sharedJs +
  mainJs +
  banner('worker bundles (inlined)') +
  'MCL.WORKER_SRC = {};\n' +
  workerConsts.join('\n') + '\n\n' +
  banner('entry') +
  // Expose the namespace on window. It costs 30 bytes and it is the only way to inspect a
  // running file:// page from devtools — this project ships F3/F4/F7 debug paths and a
  // Gfx.selfTest() that are unreachable without it (D-80). Also what tools/smoke tests read.
  'if (typeof window !== "undefined") window.MCL = MCL;\n' +
  'if (document.readyState === "loading") {\n' +
  '  document.addEventListener("DOMContentLoaded", function(){ MCL.Main.boot(); });\n' +
  '} else { MCL.Main.boot(); }\n' +
  '})();\n';

syntaxCheck('main script', appJs);

const HASH = createHash('sha256').update(sharedJs + mainJs + workerConsts.join('')).digest('hex').slice(0, 12);

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const CSS = `
html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#000;
  color:#e8e8e8;font:13px/1.4 "Segoe UI",Tahoma,DejaVu Sans,sans-serif;
  -webkit-user-select:none;user-select:none;touch-action:none}
#gl,#ui{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
#gl{background:#000;z-index:0}
#ui{z-index:1;pointer-events:none;image-rendering:pixelated}
#fatal{position:absolute;inset:0;z-index:2;display:none;padding:24px;
  background:#000;color:#ff8a7a;white-space:pre-wrap;font:12px/1.5 ui-monospace,Consolas,monospace}
canvas{image-rendering:pixelated;image-rendering:crisp-edges}
`.trim();

const html =
  '<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">\n' +
  '<title>MC-Lite</title>\n' +
  '<!-- MC-Lite ' + HASH + ' — generated by build.mjs; do not edit. Source lives in src/. -->\n' +
  '<style>\n' + CSS + '\n</style>\n' +
  '<canvas id="gl"></canvas>\n' +
  '<canvas id="ui"></canvas>\n' +
  '<pre id="fatal"></pre>\n' +
  '<script>\n' + appJs + '</script>\n';

mkdirSync(DIST, { recursive: true });

const prev = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
// s118: ATOMIC write. A full suite on the runner loads dist/mclite.html in its browser stages
// while a session's `close` rebuilds it; a plain write let `smoke` open a half-written 14 MB file
// ("MCL is undefined", suite 202609241434) and `flashcheck` read a stutter. Write beside it and
// rename over it, so a reader sees the old file or the new one, never a torn one. Windows may
// refuse the rename while Chrome holds the file open: then fall back to the plain write.
{
  const tmp = OUT + '.tmp-' + process.pid;
  writeFileSync(tmp, html, 'utf8');
  try { renameSync(tmp, OUT); }
  catch (e) { writeFileSync(OUT, html, 'utf8'); try { unlinkSync(tmp); } catch (e2) { /* VM: no unlink */ } }
}

const kb = n => (n / 1024).toFixed(1) + ' KB';
log('MC-Lite build ' + HASH + (MIN ? ' [min]' : ' [--no-min]'));
log('  modules  : ' + FILE_ORDER.length + ' (' + SHARED_MODULES.length + ' shared, ' + MAIN_MODULES.length + ' main-only)');
for (const [f, len] of workerSizes) log('  worker   : ' + f + ' -> ' + kb(len));
// ⚠ BYTES, NOT CHARACTERS. `html.length` is UTF-16 code units; the file that lands on disk is
// UTF-8, and this project's source is full of —, ⚠ and ° in its comments. Session 5 caught the
// build reporting 3,319,830 for a file that was 3,381,625 on disk — 61,795 bytes, 1.9%, all of
// it multi-byte comment characters. D-12's ceiling is 15 MB of FILE, so the number that matters
// is the one `ls` agrees with, and a build that under-reports its own size is a build that will
// sail past the ceiling and say it did not.
const htmlBytes = Buffer.byteLength(html, 'utf8');
log('  script   : ' + kb(Buffer.byteLength(appJs, 'utf8')));
log('  output   : dist/mclite.html  ' + kb(htmlBytes) + '  (' + htmlBytes + ' bytes)');

// ⚠ D-12's ceiling, asserted rather than remembered (D-195), RAISED to 18 MB by D-742 (Dan, 25
// Sept 2026, live: "raise") to fit mob sounds (D-645). Until session 5 nothing in the
// project checked it: the number lived in the charter and in a comment in bake-geometry.mjs,
// and the only thing standing between the shipped file and the limit was somebody noticing.
// A hard constraint with no check is a preference. W15 alone added 866 structure templates,
// and the reason that was affordable — 2,404 KB of jar NBT packed to 142 KB — is exactly the
// kind of decision this line exists to force.
const CEILING = 20 * 1024 * 1024; // #6636: 18 -> 20 MB (Dan, 13 Oct 2026, with comment stripping by default); D-742 raised 15 -> 18 MB
log('  ceiling  : ' + kb(CEILING) + '  (D-12) — headroom ' + kb(CEILING - htmlBytes)
    + ', ' + (100 * htmlBytes / CEILING).toFixed(1) + '% used');
if (htmlBytes > CEILING) {
  console.error('\nFAIL  build: dist/mclite.html is ' + kb(htmlBytes) + ', over D-12\'s '
    + kb(CEILING) + ' ceiling by ' + kb(htmlBytes - CEILING) + '.');
  console.error('      The file ships as ONE self-contained page. Compress a payload or drop\n'
    + '      one, and say which in the decision log — do not raise the ceiling quietly.');
  process.exit(1);
}
log('  idempotent: ' + (prev === null ? 'n/a (first build)' : (prev === html ? 'yes (unchanged)' : 'output changed')));

// #46: ADD-CLAUDE-ACCOUNT.cmd and SWITCH-ACCOUNT.cmd must stay byte-identical at the Projects root
// (one double-click away, no need to dig into mclite/). Every session runs this build constantly
// per RUN.md, so this self-heals the root copies whenever they drift from the committed source —
// but only on Dan's real, consolidated Projects folder (the guard inside the module itself is what
// keeps this a no-op everywhere else: a cloud container, a Cowork clone, a per-issue Windows
// workspace). See tools/sync-root-scripts.mjs and tools/rootscriptscheck.mjs.
await import('./tools/sync-root-scripts.mjs').then((m) => m.syncRootScripts(ROOT, { quiet: QUIET })).catch((e) => {
  console.error('sync-root-scripts: non-fatal error, root copies left as they were: ' + (e && e.message || e));
});
