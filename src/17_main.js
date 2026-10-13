// 17_main.js — boot sequence, warm-up, and the game loop (docs/archive/ARCH.md §10). Main thread only.
//
// THE LOOP IS TWO CLOCKS (D-79):
//   simulation  fixed 20 Hz, accumulator, at most MAX_TICKS catch-up steps
//   render      whatever the display gives us, interpolating between the last two ticks
// 20 Hz is not a compromise, it is the point: every constant in 14b_physics.js is a vanilla
// per-tick number, and they are only correct at vanilla's tick rate. Mouse look is deliberately
// NOT on the simulation clock — turning at 20 Hz is the one thing that would feel broken.

(function (NS) {
  'use strict';

  var Main = NS.Main = {
    glCanvas: null,
    uiCanvas: null,
    running: false,
    lastT: 0,
    acc: 0,
    TICK: 1 / 20,
    MAX_TICKS: 5,
    frame: 0,
    ticks: 0,
    fpsProf: null,
    ready: false,
    seed: 1337,
    seed64: 1337n,
    DEFAULT_SEED: 1337
  };

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  /**
   * Leave the title screen and actually build the world. Called by the menu's Play button.
   * It re-enters boot() with the title suppressed rather than duplicating the sequence,
   * so there is exactly one copy of the boot order and it cannot drift.
   */
  Main.play = function (opts) {
    opts = opts || {};
    if (opts.seed !== undefined && opts.seed !== null) {
      Main.seed64 = Main.resolveSeed64(opts.seed);
      Main.seed = Number(BigInt.asIntN(32, Main.seed64));
      if (NS.Save) { NS.Save.seed = Main.seed; NS.Save.seed64 = Main.seed64; }
    }
    Main.skipTitle = true;
    if (Main.titleInput) Main.titleInput();
    if (Main.titleRaf) { cancelAnimationFrame(Main.titleRaf); Main.titleRaf = 0; }
    NS.Hud.mode = 'loading';
    NS.Hud.draw();
    // one frame of loading screen before the synchronous world build blocks the thread
    requestAnimationFrame(function () { Main.boot(); });
  };

  /**
   * genParams() — the generation parameters for THIS world, built once and used by both
   * `Gen.init` here and `Jobs.start`'s message to every worker.
   *
   * ⚠ It must be the same object shape in both places or the main thread and the workers
   * generate different worlds. It used to be two separate `Gen.defaults()` calls, which was
   * safe only for as long as the defaults were the whole story; W4's climate mode is a
   * world-creation setting that lives in the save, so the two calls now have to agree about
   * something that is not a constant.
   */
  Main.genParams = function () {
    var p = NS.Gen.defaults();
    p.climate = (NS.Save && NS.Save.climate === 'earth') ? 'earth' : 'vanilla';
    p.worldScale = (NS.Save && NS.Save.worldScale) || p.worldScale;
    p.worldType = (NS.Save && NS.Save.worldType) || p.worldType;
    return p;
  };

  /**
   * GeneratorOptions.parseSeed: trim; empty keeps the current seed; Long.parseLong if the text is
   * one (optional + or -, decimal digits, inside the signed 64-bit range), else (long)
   * String.hashCode (h = 31*h + c over UTF-16 units). parseSeed64 is the exact long (BigInt).
   * parseSeed is its low 32 bits as a signed int (the engine's own int hashing); the exact long
   * travels as Main.seed64 / W.seed64 / G.seed64 / Save.seed64 (#546).
   */
  Main.parseSeed64 = function (txt) {
    txt = String(txt).trim();
    if (!txt.length) return null;
    if (/^[+-]?\d+$/.test(txt)) {
      var v = BigInt(txt);
      if (v >= -(1n << 63n) && v < (1n << 63n)) return v;
    }
    var h = 0;
    for (var i = 0; i < txt.length; i++) h = (Math.imul(h, 31) + txt.charCodeAt(i)) | 0;
    return BigInt(h);
  };
  Main.parseSeed = function (txt) {
    var v = Main.parseSeed64(txt);
    return v === null ? Main.seed : Number(BigInt.asIntN(32, v));
  };

  /**
   * The seed a New World gets from the field's text. Vanilla (GeneratorOptions.parseSeed +
   * getDefaultOptions): an empty or whitespace field is OptionalLong.empty() and the world
   * gets new Random().nextLong() — a fresh random seed every time, never a fixed one.
   */
  Main.resolveSeed64 = function (txt) {
    if (!String(txt).trim().length) {
      var hi = BigInt((Math.random() * 4294967296) >>> 0), lo = BigInt((Math.random() * 4294967296) >>> 0);
      return BigInt.asIntN(64, (hi << 32n) | lo);
    }
    var v = Main.parseSeed64(txt);
    return v === null ? Main.seed64 : v;
  };
  Main.resolveSeed = function (txt) {
    return Number(BigInt.asIntN(32, Main.resolveSeed64(txt)));
  };

  Main.skipTitle = false;
  Main.titleShown = false;
  Main.titleRaf = 0;

  /**
   * The title screen needs its own input and its own frame loop, because 13_input.js attaches
   * to a running world (pointer lock, movement keys, block breaking) and 17_main's loop does
   * not exist yet. Both are removed the moment Play is pressed, so exactly one input system
   * and one loop are ever live.
   */
  Main.attachTitleInput = function () {
    if (Main.titleInput) return;
    var move = function (e) { NS.Input.mx = e.clientX; NS.Input.my = e.clientY; };
    var down = function (e) { NS.Hud.click(e.clientX, e.clientY); };
    var key = function (e) {
      if (NS.Hud.titleKey(e.key)) { e.preventDefault(); }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    Main.titleInput = function () {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
      Main.titleInput = null;
    };
  };

  /** Redraw the title at a lazy rate — it only has to animate a caret. */
  Main.titleLoop = function () {
    if (NS.Hud.mode !== 'title') return;
    NS.Hud.draw();
    Main.titleRaf = requestAnimationFrame(Main.titleLoop);
  };

  Main.boot = function () {
    Main.glCanvas = document.getElementById('gl');
    Main.uiCanvas = document.getElementById('ui');
    if (!Main.glCanvas || !Main.uiCanvas) return;

    // Step 2 of the boot sequence, and it comes before anything that can be slow: a
    // double-clicked file must paint black + a loading line immediately.
    if (!Main.titleShown) {
      NS.Hud.init(Main.uiCanvas);
      Main.resize();
      window.addEventListener('resize', Main.resize);
    }

    var log = function (s) { NS.Hud.pushStatus(s); };
    var step = function (frac, label) { NS.Hud.setProgress(frac, label); NS.Hud.draw(); };

    step(0.02, 'starting');
    log('file://           ' + (NS.ENV.fileProto ? 'yes' : 'no'));

    try {
      NS.Settings.load();
      NS.Input.sensitivity = NS.Settings.sensitivity;
      NS.Input.invertY = NS.Settings.invertY;
      log('quality           ' + NS.Settings.describe());
      log('detected          ' + NS.Settings.detected + ' preset from ' +
          (NS.ENV.cores || '?') + ' cores, ' +
          ((typeof navigator !== 'undefined' && navigator.deviceMemory) || '?') + ' GB, ' +
          NS.Settings.probeMs.toFixed(1) + ' ms probe');

      NS.Save.init();
      NS.Save.probeIDB();
      var restored = NS.Save.load();
      // ⚠ On the second pass — the one Main.play() triggers after the title screen — the seed
      // has already been chosen by the player and must NOT be overwritten by the saved or
      // default one. Caught by tools/titlecheck.mjs: typing 1330000 and pressing Play built
      // seed 1337 instead, silently, because this line ran again.
      if (!Main.skipTitle) {
        Main.seed = restored ? NS.Save.seed : Main.DEFAULT_SEED;
        Main.seed64 = restored ? NS.Save.seed64 : BigInt(Main.DEFAULT_SEED);
      }
      if (Main.seed64 === undefined || Number(BigInt.asIntN(32, Main.seed64)) !== Main.seed) Main.seed64 = BigInt(Main.seed);
      NS.Save.seed = Main.seed; NS.Save.seed64 = Main.seed64;
      log('storage           ' + (NS.Save.backend === 'none'
            ? '! none (' + NS.Save.lsError + ')'
            : 'localStorage' + (restored ? ' — ' + NS.Save.count + ' saved changes' : ' (new world)')));

      // ── the real 1.18.2 roster (PLAN F8b) ───────────────────────────────────────
      // Decoded from ~334 KB of base64 into typed arrays: 900 blocks, 8,933 visual states,
      // 20,344 real states, 4,105 collision shapes, 4,027 baked geometry parts. Measured at
      // ~90 ms on this machine, once, before anything can be drawn.
      //
      // It is decoded here rather than lazily because everything after this point wants to
      // ask it questions, and because a failure has to land on the loading screen with a
      // real message rather than three seconds later as a black world.
      step(0.06, 'decoding the block roster');
      NS.Reg.init(NS.DATA);
      // PLAN G7/G8's item table (D-260). Main thread only; a worker never holds an item stack.
      if (NS.Items) NS.Items.init(NS.DATA);
      // PLAN G9's recipe table. AFTER Items (ingredients resolve to item indices) and after
      // Reg.init has decoded the tags a `#minecraft:planks` ingredient reads.
      if (NS.Recipes) NS.Recipes.init(NS.DATA);
      // PLAN G26c's advancement tree, positioned once at load like ServerAdvancementLoader.
      if (NS.Adv) NS.Adv.init(NS.DATA);
      // PLAN G11's GUI sheets and font. Before the HUD draws anything with them.
      if (NS.Gui) NS.Gui.init(NS.DATA);
      // PLAN G10c — the block-entity model boxes. AFTER Gui.init, because the textures they are
      // drawn from are Gui's sheets.
      if (NS.BEModel) NS.BEModel.init(NS.DATA);
      // PLAN G12's language table (D-282). Before the HUD names anything, and before the item
      // icon cache is built, because a tooltip asks for a display name the frame it is drawn.
      if (NS.Text) NS.Text.init(NS.DATA);
      // PLAN G13's sound tables (D-285). AFTER Reg.init, because the block->sound-type table is
      // built by registry INDEX rather than by name — a string lookup per footstep is the kind of
      // cost that only shows up on the 2200G.
      if (NS.Sound) NS.Sound.init(NS.DATA);
      log('roster            ' + NS.Reg.blockCount + ' blocks, ' + NS.Reg.visualCount +
          ' states, ' + NS.Reg.quadCount + ' quads in ' + Math.round(NS.Reg.decodeMs) + ' ms');
      // PLAN G1/G2/G3. `Reg.init` decoded the three payloads; these two build the derived tables
      // that need the roster AND the tags — the block-entity type map and the connection
      // families — so they run here, once, after the roster and before any world exists.
      if (NS.Behave) NS.Behave.init(NS.World);
      if (NS.BlockEntities) NS.BlockEntities.init();
      // PLAN G15a — the redstone signal, after Behave because it borrows its direction tables
      // and its scheduled-tick queue (D-294).
      if (NS.Redstone) NS.Redstone.init();
      // PLAN G15c — pistons, after the redstone signal they read (D-298).
      if (NS.Piston) NS.Piston.init();
      // PLAN G16 — the sky's clock and weather, which `Main.worldTick` advances (D-300).
      if (NS.Sky) NS.Sky.init();
      // PLAN G17a — the entity type table. Data only; nothing ticks it yet, and `tickcheck`
      // knows that because it has no `tick` to reach (D-306).
      if (NS.Entities) NS.Entities.init();
      // D-517 -- mob equipment slots. AFTER NS.Items (needs the item table), BEFORE
      // EntityList: EL.spawn's own DEFAULTS hook calls NS.Equip.initMob at spawn time.
      if (NS.Equip && NS.Equip.init) NS.Equip.init();
      // PLAN G17b — the entity list. ⚠ `Main.worldTick` CALLS IT; that call is the whole of
      // D-301, and `tickcheck` will fail if it is ever removed.
      if (NS.EntityList) NS.EntityList.init();
      // G21 -- experience orbs. After Entities/EntityList, both of which Xp.ready checks
      // (Xp.spawn calls EL.spawn); Xp.dropMobXp/Xp.pickupTick are called lazily later
      // (14j_combat.js/17_main.js's own tick, below) so load order past this line is free.
      if (NS.Xp && NS.Xp.init) NS.Xp.init();
      if (NS.EntityRender) NS.EntityRender.init();
      // D-335 — the per-item attack damage and speed table (D-271's debt, paid).
      if (NS.Hand && NS.Hand.init) NS.Hand.init();
      // PLAN G10d — the first-person hand's geometry builder (D-359). After the registry and the
      // item table, both of which it indexes.
      if (NS.Hand3D && NS.Hand3D.init) NS.Hand3D.init();
      // PLAN G19 — right-click. After the registry, the tags and the world.
      if (NS.Use && NS.Use.init) NS.Use.init(NS.World);
      if (NS.Sleep && NS.Sleep.init) NS.Sleep.init(NS.World);   // loop/beds (G19c)
      // D-338 — melee combat: entity picking, damage, knockback.
      if (NS.Combat && NS.Combat.init) NS.Combat.init();
      // PLAN G18b (PASS 16 JOB 1) — the goal selector and pathfinding, wired into a live mob
      // for the first time (D-391). After Combat: `Ai.selectorFor`'s zombie roster reads
      // `e.lastHurtByEntity`, which `Combat.attack` is the one thing in this engine that sets.
      // ⚠ `tickcheck` (D-306's rule) fails the day this init call is removed but `EntityList`
      // still attaches an `e.ai` nothing ever ticks — same shape as D-301's own history.
      if (NS.Ai && NS.Ai.init) NS.Ai.init();
      // PLAN G18c (PASS 16 JOB 2, D-393) — spawning. After Ai and EntityList, both of which
      // it calls through (EL.spawn/EL.canSpawn, Ai.ROSTER indirectly via EL.spawn itself).
      if (NS.Spawn && NS.Spawn.init) NS.Spawn.init();
      // PLAN G18e — love mode, breeding and age. After Entities (whose table it reads) and
      // after EntityList (through which it spawns the child).
      if (NS.Breed && NS.Breed.init) NS.Breed.init();
      // QUEUE 0.2 (G18c) — sheep/chicken/pig's own leftover state (wool colour, egg timer).
      // After Breed: `Breed.CHILD.sheep` reads `Passive.childWoolColor`.
      if (NS.Passive && NS.Passive.init) NS.Passive.init();
      // PLAN G18e unit 3 (D-458) — taming. After Breed: it reads `Br.isFood` rather than
      // keeping a second food table.
      if (NS.Tame && NS.Tame.init) NS.Tame.init();
      // PLAN G18f unit 2 (D-479) -- professions/workstations. After EntityList (villager
      // spawns through it) and independent of Tame/Breed -- it only reads Physics/Reg/States.
      if (NS.Profession && NS.Profession.init) NS.Profession.init();
      // ROW 0.2 REMAINDER (D-golem-village) -- reputation/gossip substrate + the village
      // spawn trigger. After EntityList/World (both of which Village.tick reads through).
      if (NS.Village && NS.Village.init) NS.Village.init();
      // QUEUE 0.2 (sessions 91/92) — horse mounting/riding and the raid state machine. Mount
      // reads Breed/Entities, so after both; without this `Mount.ready` stayed false in the
      // live game and a horse could never be mounted outside a check (tickcheck caught it).
      if (NS.Mount && NS.Mount.init) NS.Mount.init();
      if (NS.Raid && NS.Raid.init) NS.Raid.init();
      if (NS.Patrol && NS.Patrol.init) NS.Patrol.init();   // QUEUE 0.2 (raid loop remainder) -- roaming pillager patrols
      if (NS.CatSpawner && NS.CatSpawner.init) NS.CatSpawner.init();   // #1701
      if (NS.Spell && NS.Spell.init) NS.Spell.init();   // D-512 — was never called at boot
      if (NS.Particle && NS.Particle.init) NS.Particle.init();   // D-595 — tickcheck: was only lazily inited on first spawn
      // loop/creeper-s95 — the EXPLOSION substrate (07za_explosion.js) needs only World/Reg/
      // States, all ready well above; Creeper (07zb_creeper.js) needs Explosion ready first,
      // so it inits second, same "depends-on inits after" ordering Mount's own comment above
      // already states for Breed/Entities.
      if (NS.Explosion && NS.Explosion.init) NS.Explosion.init();
      if (NS.Creeper && NS.Creeper.init) NS.Creeper.init();
      // loop/tnt-s96 -- Tnt (07zc_tnt.js) needs Explosion ready first too, same reason.
      if (NS.Tnt && NS.Tnt.init) NS.Tnt.init();
      if (NS.Bat && NS.Bat.init) NS.Bat.init();   // D-533 (G18c)
      if (NS.Enderman && NS.Enderman.init) NS.Enderman.init();   // loop/enderman-s98
      // loop/slime-s97 -- Slime (07zd_slime.js) needs EntityList/Entities ready first
      // (Sl.setSize reads NS.Entities.dimensions), both already inited well above.
      if (NS.Slime && NS.Slime.init) NS.Slime.init();
      // loop/squid-s98 -- Squid (07zi_squid.js) needs EntityList/Entities ready first
      // (Sq.ready's own gate), both already inited well above.
      if (NS.Squid && NS.Squid.init) NS.Squid.init();
      // loop/fish-s99 -- Fish (07zj_fish.js) needs EntityList/Entities ready first
      // (Fish.ready's own gate), both already inited well above, the SAME standing squid's
      // own line just above already sets.
      if (NS.Fish && NS.Fish.init) NS.Fish.init();
      if (NS.Dolphin && NS.Dolphin.init) NS.Dolphin.init();   // #716
      log('game layer        ' + (NS.Tags.ready ? NS.Tags.tagCount : 0) + ' tags, ' +
          (NS.Loot.ready ? NS.Loot.tableCount : 0) + ' loot tables, ' +
          (NS.BlockEntities.ready ? NS.BlockEntities.typeCount : 0) + ' block-entity types, ' +
          (NS.Entities && NS.Entities.ready ? NS.Entities.count : 0) + ' entity types');

      // ── TITLE SCREEN (blocker B2, D-16) ──────────────────────────────────────────
      // Everything above this line is cheap and has to happen before anything can be drawn:
      // settings, storage, the seed. Everything BELOW it generates a world, which is the
      // expensive, irreversible thing the player should get to decide on first.
      //
      // Dan: "have there be an ultra crude menu so it just doesnt instantly laUNCH ME IN."
      // The menu is also the right home for the seed, the backend picker and the quality
      // preset, because all three are read once at world start and cannot be changed after.
      if (!Main.skipTitle) {
        NS.Hud.mode = 'title';
        NS.Hud.screen = null;
        // vanilla: a new world's seed field starts empty (blank = random); a saved world shows its seed
        NS.Hud.titleSeed = restored ? String(Main.seed64) : '';
        // #2092: ANY restored save is a save (a 0-edit one still carries player, sky, mobs): 'Create world' on it
        // kept them all while the seed box looked fresh.
        NS.Hud.titleHasSave = !!restored;
        Main.attachTitleInput();
        Main.titleShown = true;
        Main.titleLoop();
        return;
      }
      // ⚠ SESSION 2: the swap landed. The world stores REGISTRY REAL STATES — the mesher, the
      // lighting, the physics, the break timer and the save format all index by one — and the
      // hand-written 49-block table no longer supplies a single block id. What it still owns is
      // `B.T`, the canonical atlas tile NAMES that layers 0..56 are pinned to (D-57), which is
      // why it is still initialised here and why 06_atlas.js still cross-checks against it.
      step(0.08, 'registering blocks');
      NS.Blocks.init();   // still the source of the atlas's B.T tile names; no longer block ids
      log('blocks            ' + NS.Reg.blockCount + ' blocks, ' + NS.Reg.realCount +
          ' real states  (the world stores real states as of session 2)');

      step(0.14, 'generating textures');
      NS.Atlas.build(1);
      NS.Hud.buildIcons();
      // ⚠⚠ THE ITEM SHEET IS BUILT HERE, AFTER THE ATLAS, AND THAT IS NOT COSMETIC (D-341).
      // Until D-341 the item sprites were a separate PNG decoded through an `Image`, so this
      // call could sit up in the table-loading band and the decode would land a few frames
      // later on its own. They are texture-array LAYERS now, so the sheet is cut straight out
      // of `Atlas.mips[0]` and the call has one input that must already exist. Left where it
      // was, it read a null `A.mips`, returned early, and — being a build-once function — never
      // ran again: every sprite item in the HUD was invisible, in silence, for ever.
      // `iconcheck` could not see it, because a check that CALLS the function under test has
      // not tested the thing that is supposed to call it; `smoke` §item asserts the running
      // game's `Hud.itemSheetReady` instead.
      NS.Hud.buildItemIcons();
      log('atlas             ' + NS.Atlas.size() + 'px, ' + NS.Atlas.tiles + ' tiles from ' +
          (NS.Atlas.source === 'jar' ? "Dan's jars (1.13.2 where it exists)" : 'the procedural generators'));

      NS.Light.init();
      NS.World.init(Main.seed64);
      // The tint map is anchored on the spawn column before any chunk arrives, so the first
      // chunk installed already lands inside the window.
      NS.Tint.init();
      NS.Tint.anchor(0, 0);
      // Push the preset's streaming budgets into World now that it exists. Settings decided them
      // at load(); this is the moment there is something to decide them for (ARCH 16).
      NS.Settings.push({});
      NS.Gen.init(Main.seed64, Main.genParams());
      NS.Player.init();
      log('world             seed ' + Main.seed64 + '  ·  climate ' + NS.Save.climate +
          (NS.Save.climate === 'earth' ? '  (' + NS.Save.worldScale + ' blocks equator to pole)' : ''));
    } catch (e) {
      NS.Hud.fatal((e && e.stack) || String(e));
      return;
    }

    step(0.2, 'starting renderer');
    NS.Gfx.force = (NS.Settings.backend === 'auto') ? null : NS.Settings.backend;
    // the boot fallback needs a canvas WebGPU has not touched, exactly as the F9 swap does (D-310)
    NS.Gfx.replaceCanvas = Main.swapCanvas;

    NS.Gfx.init(Main.glCanvas, NS.Atlas.canvas).then(function (ok) {
      log(ok ? 'renderer          ' + NS.Gfx.name
             : '! renderer        none (' + (NS.Gfx.fallbackReason || 'both backends failed') + ')');
      if (!ok) throw new Error('no GPU backend');
      step(0.3, 'starting workers');
      // ⚠ D-415 — `smooth` travels with the other three. A worker that starts without it falls
      // back to the mesher's own default, which is ON, so a player who turned Smooth Lighting
      // off and restarted got it back in every worker-meshed section and not on the main
      // thread — the two halves of the world lit differently, silently.
      return NS.Jobs.start(Main.seed64, Main.genParams(),
                           { ao: NS.Settings.ao, cross: NS.Settings.crossModels,
                             fastLeaves: !NS.Settings.fancyLeaves,
                             smooth: NS.Settings.smoothLighting !== false });
    }).then(function (mode) {
      log('jobs              ' + mode + ' x' + (mode === 'workers' ? NS.Jobs.workers.length : 1) +
          (NS.Jobs.failReason ? '  (' + NS.Jobs.failReason + ')' : ''));

      NS.Input.attach(Main.glCanvas);
      NS.Input.onAction = Main.action;
      NS.Save.attachUnload();

      step(0.35, 'generating spawn area');
      Main.warmup();
    }).catch(function (e) {
      NS.Hud.fatal((e && e.stack) || String(e));
    });
  };

  /**
   * Warm-up: generate and mesh the spawn neighbourhood BEFORE the loading screen goes away, and
   * report real progress while doing it — fraction of the required columns generated, then
   * fraction meshed. A fake progress bar on a machine this slow is a lie the player can see
   * through in about two seconds.
   */
  Main.WARM_RADIUS = 2;
  Main.WARM_TIMEOUT_MS = 20000;

  Main.warmup = function () {
    var W = NS.World, S = NS.Save;
    var sx = 0, sz = 0;
    if (S.playerState && typeof S.playerState.x === 'number') {
      sx = Math.floor(S.playerState.x); sz = Math.floor(S.playerState.z);
    }
    var ccx = sx >> 4, ccz = sz >> 4;
    var list = W.spiral(Main.WARM_RADIUS);
    var need = list.length >> 1;
    var t0 = NS.U.now();

    var pump = function () {
      W.stream(ccx, ccz, Math.max(Main.WARM_RADIUS, Math.min(4, NS.Settings.renderDistance)));

      var gen = 0, meshed = 0;
      for (var i = 0; i < list.length; i += 2) {
        var c = W.get(ccx + list[i], ccz + list[i + 1]);
        if (c && c.state >= NS.CH.GENERATED) gen++;
        if (c && c.meshed[0]) meshed++;
      }
      var frac = 0.35 + 0.4 * (gen / need) + 0.2 * (meshed / need);
      NS.Hud.setProgress(frac, 'generating spawn area   ' + gen + '/' + need + ' columns');
      NS.Hud.draw();

      var timedOut = (NS.U.now() - t0) > Main.WARM_TIMEOUT_MS;
      var centre = W.get(ccx, ccz);
      var done = centre && centre.state >= NS.CH.GENERATED && gen === need &&
                 meshed >= Math.min(need, 5) && W.meshInflight === 0;
      if (!done && !timedOut) { requestAnimationFrame(pump); return; }
      if (timedOut) NS.Hud.pushStatus('! spawn area timed out — starting anyway');
      Main.finishBoot(sx, sz);
    };
    requestAnimationFrame(pump);
  };

  Main.finishBoot = function (sx, sz) {
    var P = NS.Player, S = NS.Save;
    NS.Hud.setProgress(0.97, 'placing player');

    // loop/nbtsave-s104 (Mnt.OWED's entity-NBT-persistence entry) — the actual mob-restore
    // point: every system a species' own spawn hook reads (Ai/Mount/Bee/Profession/Tame/...)
    // is initialized by the time `finishBoot` runs (see the long `init` sequence above), and
    // `S.load` (16b_save.js) only STASHED the records because EL did not exist yet when it ran.
    if (NS.MobNbt && NS.MobNbt.restoreAll) NS.MobNbt.restoreAll(S.mobRecords || []);
    S.mobRecords = null;
    if (NS.RaidManager && NS.RaidManager.world && NS.EntityList) NS.RaidManager.relink(NS.RaidManager.world, NS.EntityList.list);   // #5783

    // loop/besave-s105 — the actual block-entity restore point, for the identical reason: `BE`
    // exists (`BlockEntities.init()` runs earlier in this same boot sequence) but `S.load` only
    // STASHED the records because it ran before that init. `BE.restoreAll` lazy-creates any
    // block entity a saved record names but the chunk hasn't generated yet (its own header).
    if (NS.BlockEntities && NS.BlockEntities.restoreAll) NS.BlockEntities.restoreAll(S.beRecords || []);
    S.beRecords = null;

    var placed = false;
    if (S.playerState) placed = P.fromJSON(S.playerState);
    if (!placed) {
      // A brand-new world: pick dry land rather than dropping the player into the ocean that
      // happens to sit at (0,0) for this seed.
      var sp = P.findSpawn(sx >> 4, sz >> 4);
      P.spawn(sp ? sp.x : sx, sp ? sp.z : sz);
    }
    else if (!P.flying && !P.noclip) {
      // A saved position can be inside terrain if the seed or the block table ever changed.
      if (NS.Physics.solidAt(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z))) P.spawn(P.x, P.z);
    }
    // #6791: the level spawn is the player's first spawn point; an older save without one gets it now.
    if (!S.worldSpawn) S.worldSpawn = { x: Math.floor(P.x), y: Math.floor(P.y), z: Math.floor(P.z) };
    P.interpolate(0);

    // Pin the seed and the spawn on disk immediately, so a world that has never been edited is
    // still the same world next time it is opened.
    if (!S.loaded) { S.dirty = true; S.save(false); }

    Main.ready = true;
    NS.Hud.setProgress(1, 'ready');
    NS.Hud.mode = 'game';
    NS.Hud.say('Click to play  ·  Esc menu  ·  E inventory  ·  F3 debug');
    NS.Hud.needClick = true;
    Main.start();
  };

  // ---------------------------------------------------------------------------
  // Actions from 13_input.js
  // ---------------------------------------------------------------------------

  Main.action = function (name, arg) {
    var P = NS.Player, H = NS.Hud, I = NS.Input;
    if (!Main.ready && name !== 'lock' && name !== 'unlock') return;

    switch (name) {
      case 'pause':
        if (NS.Bench.running) { NS.Bench.abort(); return; }
        if (H.screen === 'bench') { H.benchReport = null; H.close(); return; }
        // ⚠ G11c — ESCAPE WALKS BACK UP THE OPTIONS TREE ONE SCREEN AT A TIME, as it does in the
        // game. Closing the whole thing from Video Settings would throw away a player's place in
        // a menu they opened on purpose, and is the single most irritating way to get a settings
        // screen wrong.
        if (H.screen === 'pause' && NS.Options && NS.Options.stack.length) { NS.Options.back(); return; }
        if (H.screen) { H.close(); return; }
        if (NS.Options) NS.Options.open('pause');
        H.open('pause');
        return;
      case 'drop':
        // ⚠ CTRL DROPS THE WHOLE STACK, which is vanilla and is the only way to empty a slot
        // without opening the inventory.
        if (!H.screen && P.dropHeld) P.dropHeld(!!(NS.Input && NS.Input.ctrl));
        else if (H.screen === 'inventory') H.inventoryKey('throw', !!(NS.Input && NS.Input.ctrl));
        break;
      case 'inventory':
        // ⚠ PLAN G11b — E OPENS A DIFFERENT SCREEN IN CREATIVE, which is vanilla's behaviour and
        // is now load-bearing: D-312 deleted the starter kit, so in creative this screen is the
        // ONLY source of blocks. `instabuild` rather than `mode === CREATIVE` because that is the
        // ability the screen actually depends on, and G6 keeps the two in step.
        if (H.screen === 'inventory' || H.screen === 'creative' || H.screen === 'chest' ||
            H.screen === 'crafting' || H.screen === 'furnace' ||
            H.screen === 'hopper' || H.screen === 'anvil' || H.screen === 'dispenser' || H.screen === 'brewing' || H.screen === 'enchanting' ||
            H.screen === 'grindstone' || H.screen === 'horse') H.close();
        // QUEUE 0.2 (G18e remainder) -- `PlayerEntity.openInventory` while riding a saddled
        // mount opens the MOUNT's own screen instead of the player's (vanilla: pressing the
        // inventory key on a ridden, saddled horse is the other real way in, besides sneak-use).
        else if (!H.screen && P.vehicle && NS.Mount && NS.Mount.isRidden(P.vehicle) &&
                 NS.Mount.isMountable(P.vehicle)) H.openHorse(P.vehicle);
        else if (!H.screen) H.open(P.instabuild ? 'creative' : 'inventory');
        return;
      case 'debug':     H.showDebug = !H.showDebug; return;
      // ── PLAN G12's chat (D-283) ───────────────────────────────────────────────────────────
      case 'chat':
      case 'chatCommand':
        if (H.screen || !NS.Chat) return;
        // ⚠ THE POINTER LOCK HAS TO GO, or the typed characters land in a locked canvas and the
        // mouse keeps turning the player while they write. Vanilla releases it for the same reason.
        NS.Chat.openChat(name === 'chatCommand' ? '/' : '');
        I.uiOpen = true;
        if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();
        H.draw();
        return;
      case 'chatCancel':
        if (!NS.Chat) return;
        NS.Chat.closeChat();
        I.uiOpen = !!H.screen;
        H.draw();
        return;
      case 'chatSend': {
        if (!NS.Chat) return;
        var sent = NS.Chat.send(Main.playerName || 'Player');
        I.uiOpen = !!H.screen;
        H.draw();
        return;
      }
      case 'chatRedraw': H.draw(); return;
      case 'bench':
        if (NS.Bench.running) NS.Bench.abort();
        else if (!NS.Bench.start({})) H.say('benchmark could not start');
        return;
      case 'backend':   Main.cycleBackend(1); return;
      case 'perspective': P.thirdPerson = ((P.thirdPerson | 0) + 1) % 3; return;   // 0 first, 1 back, 2 front
      case 'save':      NS.Save.save(true); return;
      case 'noclip':
        if (!I.locked && !H.screen) return;
        P.noclip = !P.noclip;
        if (P.noclip) P.flying = true;
        H.say('noclip ' + (P.noclip ? 'on' : 'off'));
        return;
      case 'creative': {
        // ⚠ C CYCLES THE FOUR GAMEMODES NOW (G6, D-253) rather than toggling a boolean, because
        // there are four of them: survival -> creative -> adventure -> spectator.
        if (!I.locked) return;
        var Gm = NS.Gamemode;
        var next = ((P.mode | 0) + 1) % 4;
        Gm.set(P, next);
        H.say(Gm.name(next) + (next === Gm.SURVIVAL ? ' (blocks take time to break)'
              : next === Gm.ADVENTURE ? ' (you cannot build)'
              : next === Gm.SPECTATOR ? ' (you pass through the world)' : ''));
        return;
      }
      case 'fly':
        if (!P.mayFly || !I.locked || H.screen) return;
        P.flying = !P.flying;
        P.vy = 0;
        H.say(P.flying ? 'flying' : 'falling');
        return;
      case 'respawn':
        if (!I.locked && !(P.dead && NS.Commands && NS.Commands.ruleGet('doImmediateRespawn') === 'true')) return;
        // G5: R is the death screen's respawn as well as the un-stuck key. A dead player is
        // restored and moved to the spawn point; a living one is only un-stuck, which is what
        // the key did before there was any such thing as death.
        if (NS.Survival && P.dead) {
          NS.Survival.respawn(P);
          // loop/beds (G19c) -- `PlayerEntity.findRespawnPosition`'s BedBlock branch
          // (Sleep.respawnPos, 14m_sleep.js): the bed the player last slept in, if it still
          // exists and its wake spot is clear, else vanilla's own world-spawn fallback and
          // its own "no home bed" text (block.minecraft.spawn.not_valid).
          var sp = NS.Sleep && NS.Sleep.respawnPos && NS.Sleep.respawnPos(P);
          if (sp) {
            P.spawn(sp.x, sp.z);
            P.y = sp.y; P.py = sp.y; P.ey = sp.y;
            P.yaw = sp.yaw;
          } else {
            var sc = NS.Survival.spawnScatter(0, 0);
            P.spawn(sc.x, sc.z);
            H.say('You have no home bed or charged respawn anchor, or it was obstructed');
          }
          H.say('respawned');
          return;
        }
        P.spawn(P.x, P.z);
        H.say('un-stuck');
        return;
      case 'unlock':
        if (!H.screen && Main.ready) { if (NS.Options) NS.Options.open('pause'); H.open('pause'); }
        return;
      case 'lock':
        H.needClick = false;
        // ⚠ PLAN G13: THE AUDIO CONTEXT CANNOT EXIST BEFORE A GESTURE (D-285). Every browser
        // suspends one made at load, and a suspended context that is never resumed plays nothing
        // — silently, for ever. The pointer lock IS the gesture, so this is where it starts.
        if (NS.Sound) NS.Sound.start();
        return;
      case 'lockerror': H.needClick = true; return;
      // ⚠ the BUTTON travels: `uiclick` already carries it, and G11's inventory needs it to tell
      // a left click (take the stack) from a right click (take half).
      case 'uiclick':   H.click(I.mx, I.my, arg); return;
      case 'uiredraw':  H.draw(); return;
      // ⚠ G11c — A SLIDER HAS TO FOLLOW THE POINTER, and that needs the two events a click does
      // not carry: the move while the button is down, and the release. Without them the FOV
      // slider jumps to wherever you press and stops, which is a stepper wearing a slider's art.
      case 'uidrag':
        if (H.screen === 'inventory') { H.inventoryDrag(I.mx, I.my); H.draw(); return; }
        if (H.screen === 'creative') { H.creativeDrag(I.my); H.draw(); return; }
        if (H.screen === 'pause' && NS.Options && NS.Options.dragging) { NS.Options.drag(I.mx); H.draw(); }
        return;
      case 'uirelease':
        if (NS.Creative) NS.Creative.dragging = false;
        if (H.screen === 'inventory') { H.inventoryRelease(I.mx, I.my, arg, !!(I.down('ShiftLeft') || I.down('ShiftRight'))); return; }
        if (NS.Options) NS.Options.release();
        return;
      case 'uiscroll':  H.scroll(arg); return;
      default:
        if (name.indexOf('slot') === 0) {
          // HandledScreen.handleHotbarKeyPressed: with a screen open the digit is SWAP, and the
          // game's own hotbar binding does not fire.
          if (H.screen) {
            if (H.screen === 'inventory') H.inventoryKey('swap', +name.slice(4) || 0);
            else if (H.screen === 'creative') { if (H.creativeHotbarKey((+name.slice(4) || 0))) H.draw(); }
            return;
          }
          P.selectSlot(+name.slice(4) || 0);
        }
    }
  };

  // ---------------------------------------------------------------------------
  // Renderer swap (F9)
  //
  // A canvas that has handed out a 'webgpu' context can never hand out a 'webgl2' one, so the
  // swap replaces the element. Every section mesh belongs to the old device and has to be
  // rebuilt, which is what World.remeshAll is for.
  // ---------------------------------------------------------------------------

  var BACKENDS = ['auto', 'webgpu', 'webgl2'];

  /**
   * Replace the drawing canvas with a fresh element and return it.
   *
   * ⚠ ONE COPY, TWO CALLERS (D-310). The F9 swap has always done this because a canvas that has
   * handed out a 'webgpu' context can never hand out a 'webgl2' one. The BOOT fallback needed it
   * for exactly the same reason and did not have it, so a WebGPU failure at boot took the whole
   * game down instead of falling back. `Gfx.replaceCanvas` is this function, and `Gfx.init` calls
   * it when WebGPU has already touched the canvas.
   * ⚠ `Input.el` MOVES WITH IT. A replaced canvas with the input layer still listening to the
   * removed node is a game that draws and cannot be played.
   */
  /**
   * "Save and Quit to Title". ⚠ IT RELOADS THE PAGE, and that is the honest implementation
   * rather than a shortcut: MC-Lite builds its world, its workers, its atlas and its GPU device
   * once at boot and has no teardown path, so a "return to title" that left all of that standing
   * would be a title screen with a live world behind it. The save is written FIRST, so the
   * reload comes back to exactly the world that was quit.
   */
  Main.toTitle = function () {
    try { if (NS.Save) NS.Save.save(true); } catch (e) { /* a failed save must not trap the player */ }
    if (typeof location !== 'undefined' && location.reload) location.reload();
  };

  Main.swapCanvas = function () {
    var old = Main.glCanvas;
    if (!old || !old.parentNode || typeof document === 'undefined') return null;
    var nc = document.createElement('canvas');
    nc.id = old.id || 'gl';
    nc.className = old.className;
    old.parentNode.insertBefore(nc, old);
    old.parentNode.removeChild(old);
    Main.glCanvas = nc;
    if (NS.Input) NS.Input.el = nc;
    return nc;
  };

  Main.cycleBackend = function (dir) {
    var i = BACKENDS.indexOf(NS.Settings.backend);
    if (i < 0) i = 0;
    NS.Settings.backend = BACKENDS[(i + dir + BACKENDS.length * 2) % BACKENDS.length];
    NS.Settings.save();
    Main.applyBackend();
  };

  Main.applyBackend = function () {
    var want = NS.Settings.backend;
    NS.Hud.say('switching renderer to ' + want + '…');
    NS.Gfx.dropAll();
    NS.Gfx.force = (want === 'auto') ? null : want;

    var nc = Main.swapCanvas();

    return Promise.resolve(NS.Gfx.init(nc, NS.Atlas.canvas)).then(function (ok) {
      Main.resize();
      // the backend swap is the ONE caller whose GPU buffers really died (D-162)
      NS.World.remeshAll(true);
      NS.Hud.say(ok ? ('renderer: ' + NS.Gfx.name) : 'renderer failed to start');
    }, function (e) {
      NS.Hud.say('renderer swap failed: ' + ((e && e.message) || e));
    });
  };

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  Main.resize = function () {
    var w = window.innerWidth, h = window.innerHeight;
    // DPR is capped by tier: a 2200G iGPU at DPR 2 loses ~4x fill rate for nothing (D-44).
    var dpr = Math.min(window.devicePixelRatio || 1, NS.Settings.maxDPR || 1);
    Main.glCanvas.width  = Math.max(1, (w * dpr) | 0);
    Main.glCanvas.height = Math.max(1, (h * dpr) | 0);
    NS.Hud.resize(w, h, 1);
    NS.Gfx.resize(Main.glCanvas.width, Main.glCanvas.height);
  };

  Main.start = function () {
    if (Main.running) return;
    Main.running = true;
    Main.fpsProf = new NS.U.Profiler(120);
    NS.Hud.frameProf = Main.fpsProf;
    // D-431 — one ring per phase, for the F4 overlay. 128 samples is about two seconds at 60 fps
    // and is what the frame-time graph draws.
    Main.prof = {
      frame: new NS.U.Profiler(128), tick: new NS.U.Profiler(128),
      stream: new NS.U.Profiler(128), render: new NS.U.Profiler(128),
      hud: new NS.U.Profiler(128), lag: new NS.U.Profiler(128), drops: 0
    };
    if (NS.Diag && NS.Diag.init) NS.Diag.init();
    Main.lastT = NS.U.now();
    Main.acc = 0;
    requestAnimationFrame(Main.loop);
  };

  /** Frame order is fixed in docs/archive/ARCH.md §10. Do not reorder without updating it. */
  Main.loop = function () {
    if (!Main.running) return;
    var t = NS.U.now();
    var dt = Math.min(0.25, (t - Main.lastT) / 1000);
    Main.lastT = t;
    Main.frame++;

    var P = NS.Player, H = NS.Hud;
    var benching = NS.Bench.running;

    // PLAN W6: keep the biome colour map centred on the player. Does nothing until they have
    // walked a quarter of the map's width, and then re-anchors and refills from the chunks
    // already loaded — see 06b_tintmap.js.
    if (NS.Tint && NS.Tint.ready) NS.Tint.follow(NS.World, P.x, P.z);

    // --- look and hotbar run at frame rate ---------------------------------
    if (!benching) {
      var wheel = NS.Input.applyLook(P);
      if (wheel && !H.screen) P.scrollSlot(wheel);
    }

    // --- fixed 20 Hz simulation --------------------------------------------
    if (benching) {
      // The benchmark owns the camera outright: no input, no physics, no interpolation, so the
      // path is a pure function of elapsed time and two runs describe the same scene (D-92).
      Main.acc = 0;
    } else if (H.screen) {
      // A menu freezes the player but NOT the streamer: chunks keep loading while you are
      // fiddling with the render distance, which is the whole reason to fiddle with it.
      Main.acc = 0;
      P.px = P.x; P.py = P.y; P.pz = P.z;
    } else {
      Main.acc += dt;
      var steps = 0;
      // D-431 — the phase clock the F4 overlay reads. `U.now()` twice per phase is a handful of
      // nanoseconds; without it the overlay can show a frame time and NOT what is in it, which
      // is the difference between "the game is slow" and "the mesher is slow".
      var _t0 = NS.U.now();
      while (Main.acc >= Main.TICK && steps < Main.MAX_TICKS) {
        Main.worldTick();
        P.tick();
        Main.ticks++;
        Main.acc -= Main.TICK;
        steps++;
      }
      if (Main.prof) Main.prof.tick.add(NS.U.now() - _t0);
      if (steps === Main.MAX_TICKS) Main.acc = 0;      // never spiral
    }
    // ANIM-1 (#1891): TextureManager.tick runs from MinecraftClient.tick every 20 Hz tick, menus included,
    // so the texture clock has its own accumulator rather than riding the (menu-frozen) sim one.
    if (NS.Atlas && NS.Atlas.animTick) {
      Main.animAcc = Math.min((Main.animAcc || 0) + dt, 0.25);
      while (Main.animAcc >= Main.TICK) { NS.Atlas.animTick(); Main.animAcc -= Main.TICK; }
    }
    if (!benching) {
      P.interpolate(Main.partial());

      // --- interaction ------------------------------------------------------
      P.retarget();
      P.act(dt);
    }

    // --- world --------------------------------------------------------------
    // Frame budgeting (D-87). W.load scales the per-frame streaming caps from how the last few
    // frames actually went: at target frame time it is 1, and it falls off toward 0.2 as frames
    // get long. Recovering from a hitch is the expensive part, so the streamer backs off BEFORE
    // the next one rather than after it.
    var tgt = NS.Settings.targetMs || 16.7;
    var recent = Main.fpsProf ? Main.fpsProf.avg() : tgt;
    var load = tgt * 1.15 / Math.max(tgt * 0.5, recent);
    NS.World.load = load > 1 ? 1 : (load < 0.2 ? 0.2 : load);
    var _t1 = NS.U.now();
    NS.Light.step(Math.round((NS.Settings.lightBudgetUs || 2000) * NS.World.load));
    NS.World.stream(Math.floor(P.ex) >> 4, Math.floor(P.ez) >> 4, NS.Settings.renderDistance);
    var _t2 = NS.U.now();
    if (Main.prof) Main.prof.stream.add(_t2 - _t1);

    // --- draw ---------------------------------------------------------------
    NS.Gfx.render(t / 1000);
    var _t3 = NS.U.now();
    if (Main.prof) Main.prof.render.add(_t3 - _t2);

    Main.fpsProf.add(dt * 1000);
    H.fps = 1000 / Math.max(0.001, Main.fpsProf.avg());
    H.draw();
    if (NS.SS) NS.SS.afterFrame();      // #1890: `/ss`/F2 capture, in the frame that was just drawn
    if (Main.prof) {
      Main.prof.hud.add(NS.U.now() - _t3);
      // ⚠ THE LOOP LAG IS THE GAP BETWEEN FRAMES MINUS THE WORK IN THEM — time this loop did
      // not spend and cannot account for (the browser's own compositing, GC, another tab). It
      // is the number that tells a stutter caused by this game from one caused by the machine.
      var acct = Main.prof.tick.last + Main.prof.stream.last + Main.prof.render.last + Main.prof.hud.last;
      Main.prof.lag.add(Math.max(0, dt * 1000 - acct));
      Main.prof.frame.add(dt * 1000);
      if (dt * 1000 > 33.3) Main.prof.drops++;
    }
    if (NS.Diag && NS.Diag.ready) NS.Diag.update(dt * 1000);

    // The benchmark samples AFTER the draw, so the frame time it records belongs to the camera
    // position it just rendered from, and it moves the camera for the next one.
    if (benching || NS.Bench.running) NS.Bench.tick(dt * 1000);

    if (!benching) NS.Save.tick();
    NS.Settings.adapt(dt * 1000);
    NS.Input.endFrame();

    requestAnimationFrame(Main.loop);
  };

  /**
   * ⚠⚠ ONE GAME TICK OF THE WORLD, AND UNTIL SESSION 9 THIS FUNCTION DID NOT EXIST (D-301).
   *
   * The main loop ran `P.tick()` — the PLAYER — and nothing else. Every per-tick entry point in
   * the behaviour layer was written, checked and shipped, and **none of them was ever called by
   * the game**: `Behave.tick` drains the scheduled-tick queue, so water and lava never spread
   * past their first update, fire never burnt out, furnaces never smelted (D-289 fixed the
   * furnace's HOOKS and it still never ran), and G15's torches, repeaters, observers and pistons
   * would each have started and frozen mid-flip for ever.
   *
   * ⚠ EVERY CHECK WAS GREEN ACROSS IT, because every check drives the tick ITSELF —
   * `redcheck.runTicks`, `pistoncheck.ticks`, `behavcheck`'s own loop. Each honestly proves the
   * RULE and not one of them proves the GAME runs it. That is D-276's lesson at the largest
   * join in the project, and the assertion that was missing is not about any rule: it is
   * "is every per-tick function something the loop CALLS", which `tickcheck` now asks of the
   * shipped bundle rather than of the source.
   *
   * ⚠ THE ORDER IS VANILLA'S: the world first, then the player. A player who moves before the
   * water does is standing in last tick's fluid.
   */
  /**
   * How far through the current tick the frame is, 0..1.
   *
   * ⚠ THE RENDERER NEEDS THIS AND SO DOES ANYTHING THAT MOVES (D-79). The player already
   * interpolated with `Main.acc / Main.TICK` inline; entities need the same number, and two
   * copies of "how far through the tick are we" is how one of them ends up a tick behind.
   */
  Main.partial = function () {
    return Main.TICK > 0 ? Math.max(0, Math.min(1, Main.acc / Main.TICK)) : 1;
  };

  Main.worldTick = function () {
    if (NS.Behave && NS.Behave.ready) NS.Behave.tick();
    // D-452 — the random-tick pass (`Level.tickChunk`'s own per-section loop), gated to
    // SIMULATION distance rather than render distance. `World.randomTick` no-ops safely if
    // `Behave` is not ready, exactly like the line above.
    // `ServerChunkManager.tickChunks` (.decomp :367-369): each ticking chunk near a player gains
    // inhabited time BEFORE its spawn/random-tick pass — the regional half of LocalDifficulty.
    if (NS.Equip && NS.Equip.tickInhabited) NS.Equip.tickInhabited(1);
    if (NS.World && NS.World.randomTick) NS.World.randomTick(NS.Behave && NS.Behave.rng);
    // loop/lightning -- `ServerWorld.tickChunk`'s own "thunder" block (07zzc_lightning.js),
    // the SAME once-a-real-tick, per-loaded-column cost `World.randomTick` immediately above
    // already runs at.
    if (NS.Lightning && NS.Lightning.tickWorldThunder) NS.Lightning.tickWorldThunder();
    if (NS.EntityList && NS.EntityList.ready) NS.EntityList.tick();
    // s108 (Px.OWED line 1, closed): the particle list ages/moves once per game tick, as
    // MinecraftClient.tick -> particleManager.tick() does right after the world tick
    // (.decomp/net/minecraft/client/MinecraftClient.java). Without this, a spawned heart sat forever.
    if (NS.Particle && NS.Particle.ready) NS.Particle.tick();
    // D-656: WorldRenderer.tickRainSplashing — the rain/smoke splashes (09c_weather.js), spawned after
    // the particle tick so each is first moved on the next one, as vanilla's queue does.
    if (NS.Weather && NS.Weather.tickSplashLive) NS.Weather.tickSplashLive();
    // G17-X10: ClientWorld.doRandomBlockDisplayTicks around the camera (07zzc_lightning.js).
    if (NS.Lightning && NS.Lightning.doRandomBlockDisplayTicks && NS.Weather && NS.Weather.lastCam && NS.Sky && NS.Particle && NS.Particle.ready) {
      var dc = NS.Weather.lastCam;
      NS.Lightning.doRandomBlockDisplayTicks(Math.floor(dc.x), Math.floor(dc.y), Math.floor(dc.z), {
        thundering: NS.Sky.isThundering(), time: NS.Sky.dayTime, topY: NS.Weather.motionTop
      });
    }
    // QUEUE 0.2 raid loop (this unit) — the LIVE caller `07s_raid.js`'s own header used to say
    // did not exist: a player's Bad Omen (near this engine's one POI substrate, a claimed
    // workstation) starts a raid, and every raid in `RM.world` is ticked for real, through a
    // real `EntityList.spawn` (07s_raid.js's own `Rd.tickLive` doc). After EntityList's own
    // tick, same reasoning D-393 already used below: a raider should not act on the same tick
    // it was placed.
    if (NS.Raid && NS.Raid.ready && NS.RaidManager && NS.RaidManager.ready) NS.Raid.tickLive(NS);
    if (NS.Siege) NS.Siege.tick(NS);   // ZombieSiegeManager state machine (07zzv_siege.js; zombies = G18c-Z4)
    // QUEUE 0.2 (raid loop remainder, this unit) -- PatrolSpawner's own live caller: a
    // roaming pillager patrol (the ominous-banner-carrying leader `Rd.onPatrolLeaderDeath`
    // already existed for, `Rd.OWED`'s own "patrol spawning" line) can now actually spawn.
    // After Rd.tickLive so a raid this same tick starting near the player is read as "near
    // a village" before a patrol roll checks the same thing.
    if (NS.Patrol && NS.Patrol.ready) NS.Patrol.tick(NS);
    // QUEUE 0.2 (G18e, s103 orchestrator) -- WanderingTraderManager's own live caller (it runs
    // among ServerWorld's custom spawners beside PatrolSpawner, same doMobSpawning gate = this
    // engine's `Spawn.ready`, D-397). `WT.tickManager` is the verbatim countdown (07zt_wtrader.js);
    // this ctx only hands it the live world. heightAt+1: `W.heightAt` is the top SOLID block, vanilla's
    // getTopPosition(WORLD_SURFACE) is the first open block above it.
    if (NS.WT && NS.WT.ready && NS.WT.tickManager && NS.World && NS.EntityList && NS.EntityList.ready) {
      var WW = NS.World, SPW = NS.Spawn;
      NS.WT.tickManager({
        doMobSpawning: !(SPW && SPW.ready === false),
        doTraderSpawning: !(NS.Commands && NS.Commands.ruleGet && String(NS.Commands.ruleGet('doTraderSpawning')) === 'false'),   // #1798
        players: function () { return NS.Player && !NS.Player.isSpectator ? [NS.Player] : []; },
        heightAt: function (x, z) { return (WW.loadedAt && !WW.loadedAt(x, z)) ? null : WW.heightAt(x, z) + 1; },
        isSpawnable: function (t, x, y, z) { return !SPW || !SPW.canSpawnOnGround || SPW.canSpawnOnGround(t, x, y, z); },
        collisionEmpty: function (x, y, z) { return !NS.Physics || !NS.Physics.shapeAt || !NS.Physics.shapeAt(x, y, z); },
        spawnFn: function (t, x, y, z) { return NS.EntityList.spawn(t, x, y, z); }
      });
    }
    // PLAN G18c (PASS 16 JOB 2, D-393) — natural spawning and despawning, once a tick. After
    // EntityList's own tick so a freshly spawned mob is not asked to move on the same tick it
    // was placed, and before the player's own pickup pass below (spawning never drops an item).
    // loop/phantom -- PhantomSpawner.spawn (.decomp/net/minecraft/world/spawner/
    // PhantomSpawner.java), a WORLD-level spawner outside the biome cycle NS.Spawn.tick()
    // runs, the same standing WT.tickManager/Patrol.tick already have above. Same slot.
    if (NS.Phantom && NS.Phantom.ready) NS.Phantom.tickSpawner();
    if (NS.CatSpawner && NS.CatSpawner.ready) NS.CatSpawner.tick(NS);   // #1701 CatSpawner
    if (NS.Spawn && NS.Spawn.ready) { NS.Spawn.tick(); }   // despawn: Spawn.despawnOne from EL.tickMob (#6336)
    // ⚠ AFTER THE ENTITIES MOVE, NOT BEFORE (D-333). `Player.aiStep` collects what its inflated
    // box touches at the end of the tick; picking up first would test last tick's positions and
    // let a dropped item be taken the instant it appears, before its pop is visible.
    if (NS.Player && NS.Player.pickupItems) NS.Player.pickupItems();
    if (NS.Xp && NS.Xp.ready) NS.Xp.pickupTick();   // G21 -- the SAME after-motion slot, xp orbs
    if (NS.BlockEntities && NS.BlockEntities.ready) NS.BlockEntities.tick();
    if (NS.Sky && NS.Sky.ready) NS.Sky.tick();
  };

  Main.stop = function () { Main.running = false; };
})(MCL);
